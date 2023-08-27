import * as vscode from 'vscode';

import * as git from './indicator/git';
import * as gpg from './indicator/gpg';
import * as process from './indicator/process';
import type { Logger } from './indicator/logger';
import { Mutex } from "./indicator/locker";
import { m } from "./message";

export class KeyStatusEvent {
    constructor(public info: gpg.GpgKeyInfo, public isLocked: boolean) {
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
    private currentKey: gpg.GpgKeyInfo | undefined;
    private keyOfFolders: Map<string, gpg.GpgKeyInfo> = new Map();
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
    private async tryUnlockWithCache(isChanged: boolean, isUnlockedPrev: boolean, keyInfo: gpg.GpgKeyInfo): Promise<boolean> {
        const isUnlocked = await gpg.isKeyUnlocked(keyInfo.keygrip);
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

        return await gpg.isKeyUnlocked(keyInfo.keygrip);
    }

    /**
     * @param isChanged - whether the key is changed in last sync iteration.
     * @param isUnlockedPrev - whether the key is locked in last sync iteration.
     * @param keyInfo - the key to be unlocked, if required.
     * @returns whether the key is unlocked
     */
    private async showInfoOnly(isChanged: boolean, isUnlockedPrev: boolean, keyInfo: gpg.GpgKeyInfo): Promise<boolean> {
        const isUnlocked = await gpg.isKeyUnlocked(keyInfo.keygrip);
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
        const keyInfos = await gpg.getKeyInfos();
        await Promise.all(folders.map((folder) => this.updateFolder(folder, keyInfos)));
    }

    private async updateFolder(folder: string, keyInfos?: gpg.GpgKeyInfo[]): Promise<void> {
        await this.updateFolderLock.with(async () => {
            try {
                const shouldParseKey = await git.isSigningActivated(folder);
                if (!shouldParseKey) {
                    return;
                }
                const keyId = await git.getSigningKey(folder);
                const keyInfo = await gpg.getKeyInfo(keyId, keyInfos);
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

    getCurrentKey(): gpg.GpgKeyInfo | undefined {
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

        if (await gpg.isKeyUnlocked(this.currentKey.keygrip)) {
            this.logger.warn(`Key is already unlocked, skip unlock request`);
            return;
        }

        this.logger.info(`Try to unlock current key: ${this.currentKey.fingerprint}`);
        await gpg.unlockByKey(this.logger, this.currentKey.keygrip, passphrase);
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

