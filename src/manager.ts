import * as vscode from 'vscode';

import * as process from './indicator/process';
import { Mutex } from "./indicator/locker";
import { m } from "./message";

/**
 * Logger is a sample interface for basic logging ability.
 */
export interface Logger {

    /**
     * Log some message at info level.
     * @param message - a message without ending new line
     */
    info(message: string): void

    /**
     * Log some message at warning level.
     * @param message - a message without ending new line
     */
    warn(message: string): void

    /**
     * Log some message at error level.
     * @param message - a message without ending new line
     */
    error(message: string): void
}

/** DummyLogger is a sample implementation of Logger. */
export class DummyLogger implements Logger {

    info(message: string): void { }

    warn(message: string): void { }

    error(message: string): void { }
}

export class KeyStatusEvent {
    constructor(public info: GpgKeyInfo, public isLocked: boolean) {
    }

    static equal(left: KeyStatusEvent, right: KeyStatusEvent): boolean {
        return left.info.fingerprint === right.info.fingerprint && left.isLocked === right.isLocked;
    }
}

export default class KeyStatusManager {
    private updateFolderLock: Mutex;
    private syncStatusLock: Mutex;
    private activateFolder: string | undefined;
    private _activateFolder: string | undefined;
    private lastEvent: KeyStatusEvent | undefined;
    private currentKey: GpgKeyInfo | undefined;
    private keyOfFolders: Map<string, GpgKeyInfo> = new Map();
    private disposed: boolean = false;
    private updateFunctions: ((event?: KeyStatusEvent) => void)[] = [];
    private isUnlocked = false;

    /**
     * Construct the key status manager.
     *
     * @param logger - the output logger for debugging logs.
     * @param syncInterval - key status sync interval in seconds.
     */
    constructor(
        private logger: Logger,
        private git: GitAdapter,
        private gpg: GpgAdapter,
        private syncInterval: number,
        private secretStorage: Storage,
        public enablePassphraseCache: boolean,
        private isWorkspaceTrusted: boolean,
        private defaultFolder: string,
    ) {
        this.updateFolderLock = new Mutex();
        this.syncStatusLock = new Mutex();
    }

    async syncLoop(): Promise<void> {
        await process.sleep(1 * 1000);
        while (!this.disposed) {
            if (this.activateFolder) {
                await this.syncStatus();
            }
            await process.sleep(this.syncInterval * 1000);
        }
        return;
    }

    updateSyncInterval(syncInterval: number): void {
        this.syncInterval = syncInterval;
    }

    private show(isChanged: boolean, changedMsg: string, defaultMsg: string) {
        vscode.window.showInformationMessage(isChanged
            ? vscode.l10n.t(changedMsg)
            : vscode.l10n.t(defaultMsg),
        );
    }

    async syncStatus(): Promise<void> {
        await this.syncStatusLock.with(async () => {
            if (!this.activateFolder) {
                return;
            }
            const oldCurrentKey = this.currentKey;
            const isUnlockedPrev = this.isUnlocked;

            this.currentKey = this.keyOfFolders.get(this.activateFolder);
            if (this.currentKey === undefined) {
                if (oldCurrentKey) {
                    this.logger.info('User disabled commit signing or removed the key for current folder, trigger status update functions');
                    for (const update of this.updateFunctions) {
                        update(undefined);
                    }
                }
                return;
            }
            const isChanged = this.currentKey !== oldCurrentKey;

            let newEvent: KeyStatusEvent | undefined;
            const hasPassphrase = (await this.secretStorage.get(this.currentKey.fingerprint) !== undefined);
            try {
                if (this.enablePassphraseCache && hasPassphrase) {
                    this.isUnlocked = await this.tryUnlockWithCache(isChanged, isUnlockedPrev, this.currentKey);
                } else {
                    this.isUnlocked = await this.showInfoOnly(isChanged, isUnlockedPrev, this.currentKey);
                }

                newEvent = new KeyStatusEvent(this.currentKey, !this.isUnlocked);
            } catch (err) {
                if (!(err instanceof Error)) {
                    throw err;
                }
                this.logger.error(`Fail to check key status: ${err.message}`);
            }

            if (newEvent === undefined) {
                return;
            }
            if (this.lastEvent === undefined || !KeyStatusEvent.equal(newEvent, this.lastEvent)) {
                this.lastEvent = newEvent;
                this.notifyUpdate(newEvent);
            }
        });
    }

    /**
     * @param isChanged - whether the key is changed in last sync iteration.
     * @param isUnlockedPrev - whether the key is locked in last sync iteration.
     * @param keyInfo - the key to be unlocked, if required.
     * @returns whether the key is unlocked after trying
     */
    private async tryUnlockWithCache(isChanged: boolean, isUnlockedPrev: boolean, keyInfo: GpgKeyInfo): Promise<boolean> {
        const isUnlocked = await this.gpg.isKeyUnlocked(keyInfo.keygrip);
        if (isUnlocked) {
            return true;
        }

        const passphrase = await this.secretStorage.get(keyInfo.fingerprint);
        if (!passphrase) {
            return false;
        }

        try {
            await this.unlockCurrentKey(passphrase);
            if (isUnlockedPrev) {
                this.show(isChanged, m['keyChangedAndAutomaticallyUnlocked'], m['keyRelockedAndAutomaticallyUnlocked']);
            } else {
                this.show(isChanged, m['keyChangedAndAutomaticallyUnlocked'], m['keyAutomaticallyUnlocked']);
            }
        } catch (err) {
            if (!(err instanceof Error)) {
                throw err;
            }
            this.logger.error(`Cannot unlock the key with the cached passphrase: ${err.message}`);
            await this.secretStorage.delete(keyInfo.fingerprint);
            if (isUnlockedPrev) {
                this.show(isChanged, m['keyChangedButAutomaticallyUnlockFailed'], m['keyRelockedButAutomaticallyUnlockFailed']);
            } else {
                this.show(isChanged, m['keyChangedButAutomaticallyUnlockFailed'], m['keyAutomaticallyUnlockFailed']);
            }
        }

        return await this.gpg.isKeyUnlocked(keyInfo.keygrip);
    }

    /**
     * @param isChanged - whether the key is changed in last sync iteration.
     * @param isUnlockedPrev - whether the key is locked in last sync iteration.
     * @param keyInfo - the key to be unlocked, if required.
     * @returns whether the key is unlocked
     */
    private async showInfoOnly(isChanged: boolean, isUnlockedPrev: boolean, keyInfo: GpgKeyInfo): Promise<boolean> {
        const isUnlocked = await this.gpg.isKeyUnlocked(keyInfo.keygrip);
        if (isUnlockedPrev && !isUnlocked) {
            this.show(isChanged, m['keyChanged'], m['keyRelocked']);
        }

        return isUnlocked;
    }


    private notifyUpdate(event: KeyStatusEvent): void {
        this.logger.info(`New event, key: ${event.info.fingerprint}, is locked: ${event.isLocked}`);
        this.logger.info('Trigger status update functions');
        for (const update of this.updateFunctions) {
            update(event);
        }
    }

    // Update workspace folders
    async updateFolders(folders: string[]): Promise<void> {
        this.logger.info('Update folder information');
        this.keyOfFolders.clear();
        const keyInfos = await this.gpg.getKeyInfos();
        await Promise.all(folders.map((folder) => this.updateFolder(folder, keyInfos)));
    }

    private async updateFolder(folder: string, keyInfos?: GpgKeyInfo[]): Promise<void> {
        await this.updateFolderLock.with(async () => {
            try {
                const shouldParseKey = await this.git.isSigningActivated(folder);
                if (!shouldParseKey) {
                    return;
                }
                const keyId = await this.git.getSigningKey(folder);
                const keyInfo = await this.gpg.getKeyInfo(keyId, keyInfos);
                this.logger.info(`Find key ${keyInfo.fingerprint} for folder ${folder}`);
                this.keyOfFolders.set(folder, keyInfo);
            } catch (err) {
                this.logger.warn(`Can not find key information for folder: ${folder}`);
            }
        });
    }

    // Change current key according to activate folder
    async changeActivateFolder(folder: string): Promise<void> {
        this._activateFolder = folder;
        if (!this.isWorkspaceTrusted) {
            this.logger.info(`Running in untrusted workspace, skip ${folder}, use ${this.defaultFolder} instead.`);
            folder = this.defaultFolder;
        }
        if (this.activateFolder === folder) {
            return;
        }
        this.logger.info(`Change folder to ${folder}`);
        this.activateFolder = folder;
        await this.syncStatus();
    }

    async recoverActivateFolderOnDidGrantWorkspaceTrust(): Promise<void> {
        this.isWorkspaceTrusted = true;
        if (typeof this._activateFolder !== "string") {
            this.logger.info(`The workspace has been granted trust, but no folder passed in before.`);
            return;
        }
        this.logger.info(`The workspace has been granted trust, ${this._activateFolder} will be used.`);
        await this.changeActivateFolder(this._activateFolder);
    }

    registerUpdateFunction(update: (event?: KeyStatusEvent) => void): void {
        this.logger.info('Got one update function');
        this.updateFunctions.push(update);
    }

    getCurrentKey(): GpgKeyInfo | undefined {
        const currentKey = this.activateFolder ? this.keyOfFolders.get(this.activateFolder) : undefined;
        if (!currentKey) {
            return undefined;
        }

        return currentKey;
    }

    // Lock or unlock current key
    async unlockCurrentKey(passphrase: string): Promise<void> {
        if (this.activateFolder === undefined) {
            throw new Error(vscode.l10n.t(m['noActiveFolder']));
        }

        if (this.currentKey === undefined) {
            throw new Error(vscode.l10n.t(m['noKeyForCurrentFolder']));
        }

        if (await this.gpg.isKeyUnlocked(this.currentKey.keygrip)) {
            this.logger.warn(`Key is already unlocked, skip unlock request`);
            return;
        }

        this.logger.info(`Try to unlock current key: ${this.currentKey.fingerprint}`);
        await this.gpg.unlockByKey(this.currentKey.keygrip, passphrase);
    }

    // Stop sync key status loop
    dispose(): void {
        this.disposed = true;
    }
}

export interface Storage {
    get(key: string): Promise<string | undefined>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
}

/** GitAdapter is an interface for git operations. */
export interface GitAdapter {

    /**
     * Get the signing key for the project.
     * @param project - the project path.
     * @returns the signing key.
     */
    getSigningKey(project: string): Promise<string>;

    /**
     * Check whether the signing is activated for the project.
     * @param project - the project path.
     * @returns whether the signing is activated.
     */
    isSigningActivated(project: string): Promise<boolean>;
}

/** GpgKeyInfo is a type for GPG key information. */
export interface GpgKeyInfo {

    /** The type of the key. "pub" for primary key, "sub" for sub key. */
    type: string;

    /** The capabilities of the key. "s" for signing, "e" for encryption, and so on. */
    capabilities: string;

    /** The fingerprint of the key, used for user to identify a key in config. */
    fingerprint: string;

    /** The keygrip of the key, used to identify a key in GPG Assuan protocol. */
    keygrip: string;

    /** The user ID of the key, defined by GPG, usually contains full name and email. */
    userId?: string;
}

/** GpgAdapter is an interface for GPG operations. */
export interface GpgAdapter {

    /**
     * Check whether the key is unlocked.
     * @param keygrip - the keygrip of the key to be checked
     * @returns whether the key is unlocked
     */
    isKeyUnlocked(keygrip: string): Promise<boolean>;

    /**
     * Get all key information.
     * @returns all key information
     */
    getKeyInfos(): Promise<GpgKeyInfo[]>;

    /**
     * Get key information of given ID of GPG key.
     * @param keyId - ID of the GPG key
     * @param keyInfos - the cache of key information, if available
     * @returns key information
     */
    getKeyInfo(keyId: string, keyInfos?: GpgKeyInfo[]): Promise<GpgKeyInfo>;

    /**
     * Unlock some key with the passphrase.
     * @param keygrip - the keygrip of the key to be unlocked
     * @param passphrase - the passphrase for the key
     */
    unlockByKey(keygrip: string, passphrase: string): Promise<void>;
}
