import * as vscode from 'vscode';

import * as git from './indicator/git';
import * as gpg from './indicator/gpg';
import * as process from './indicator/process';
import type { Logger } from './indicator/logger';
import locker from "./indicator/locker";
import { m } from "./message";

class KeyStatusEvent {
    constructor(public keyId: string, public isLocked: boolean) {
    }

    static equal(left: KeyStatusEvent, right: KeyStatusEvent): boolean {
        return left.keyId === right.keyId && left.isLocked === right.isLocked;
    }
}

export default class KeyStatusManager {
    private activateFolder: string | undefined;
    private _activateFolder: string | undefined;
    private lastEvent: KeyStatusEvent | undefined;
    private keyOfFolders: Map<string, gpg.GpgKeyInfo> = new Map();
    private disposed: boolean = false;
    private updateFunctions: ((event?: KeyStatusEvent) => void)[] = [];
    public isUnlocked = false;
    private isUnlockedPrevious = false;

    /**
     * Construct the key status manager.
     *
     * @param logger - the output logger for debugging logs.
     * @param syncInterval - key status sync interval in seconds.
     */
    constructor(
        private logger: Logger,
        private syncInterval: number,
        private secretStorage: AbstractObjectStorage,
        public enableSecurelyPassphraseCache: boolean,
        private isWorkspaceTrusted: boolean,
        private tmp: string,
    ) { }

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

    async syncStatus(): Promise<void> {
        await locker.acquire("KeyStatusManager#syncStatus", async (release) => {
            if (!this.activateFolder) {
                return release();
            }
            const oldCurrentKey = this.currentKey;
            const shouldParseKey = await git.isSigningActivated(this.activateFolder);
            if (shouldParseKey) {
                const keyId = await git.getSigningKey(this.activateFolder);
                if (!oldCurrentKey?.fingerprint.includes(keyId)) {
                    const keyInfo = await gpg.getKeyInfo(keyId);
                    this.logger.info(`Find updated key ${keyId} / ${keyInfo.fingerprint} from old key ${oldCurrentKey?.fingerprint} for current folder ${this.activateFolder}`);
                    this.keyOfFolders.set(this.activateFolder, keyInfo);
                }
            } else {
                this.currentKey = undefined;
            }
            if (this.currentKey === undefined) {
                if (oldCurrentKey) {
                    this.logger.info('User disabled commit signing or removed the key for current folder, trigger status update functions');
                    for (const update of this.updateFunctions) {
                        update();
                    }
                }
                return release();
            }

            let newEvent: KeyStatusEvent | undefined;
            try {
                this.isUnlocked = await gpg.isKeyUnlocked(this.currentKey.keygrip);
                if (this.enableSecurelyPassphraseCache) {
                    if (!this.isUnlocked) {
                        const passphrase = await this.secretStorage.get(this.currentKey.fingerprint);
                        if (typeof passphrase === "string") {
                            try {
                                await this.unlockCurrentKey(passphrase);
                                if (this.isUnlockedPrevious) {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t(m['keyChangedAndAutomaticallyUnlocked'])
                                            : vscode.l10n.t(m['keyRelockedAndAutomaticallyUnlocked']),
                                    );
                                } else {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t(m['keyChangedAndAutomaticallyUnlocked'])
                                            : vscode.l10n.t(m['keyAutomaticallyUnlocked']),
                                    );
                                }
                            } catch (e) {
                                this.logger.error(`Cannot unlock the key with the cached passphrase: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
                                await this.secretStorage.delete(this.currentKey.fingerprint);
                                if (this.isUnlockedPrevious) {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t(m['keyChangedButAutomaticallyUnlockFailed'])
                                            : vscode.l10n.t(m['keyRelockedButAutomaticallyUnlockFailed']),
                                    );
                                } else {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t(m['keyChangedButAutomaticallyUnlockFailed'])
                                            : vscode.l10n.t(m['keyAutomaticallyUnlockFailed']),
                                    );
                                }
                            }
                            this.isUnlocked = await gpg.isKeyUnlocked(this.currentKey.keygrip);
                        }
                    }
                } else if (this.isUnlockedPrevious && !this.isUnlocked) {
                    vscode.window.showInformationMessage(
                        this.currentKey === oldCurrentKey
                            ? vscode.l10n.t(m['keyChanged'])
                            : vscode.l10n.t(m['keyRelocked']),
                    );
                }
                newEvent = new KeyStatusEvent(this.currentKey.fingerprint, !this.isUnlocked);
            } catch (err) {
                if (!(err instanceof Error)) {
                    throw err;
                }
                this.isUnlocked = false;
                this.logger.error(`Fail to check key status: ${err.message}`);
            }
            this.isUnlockedPrevious = this.isUnlocked;

            if (newEvent === undefined) {
                return release();
            }
            if (this.lastEvent === undefined || !KeyStatusEvent.equal(newEvent, this.lastEvent)) {
                this.lastEvent = newEvent;
                this.notifyUpdate(newEvent);
            }
            release();
        });
    }

    private notifyUpdate(event: KeyStatusEvent): void {
        this.logger.info(`New event, key: ${event.keyId}, is locked: ${event.isLocked}`);
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
        for (const folder of folders) {
            await this.updateFolder(folder, keyInfos);
        }
    }

    private async updateFolder(folder: string, keyInfos?: gpg.GpgKeyInfo[]): Promise<void> {
        await locker.acquire("KeyStatusManager#updateFolder", async (release) => {
            try {
                const shouldParseKey = await git.isSigningActivated(folder);
                if (!shouldParseKey) {
                    return release();
                }
                const keyId = await git.getSigningKey(folder);
                const keyInfo = await gpg.getKeyInfo(keyId, keyInfos);
                this.logger.info(`Find key ${keyInfo.fingerprint} for folder ${folder}`);
                this.keyOfFolders.set(folder, keyInfo);
            } catch (err) {
                this.logger.warn(`Can not find key information for folder: ${folder}`);
            }
            release();
        });
    }

    // Change current key according to activate folder
    async changeActivateFolder(folder: string): Promise<void> {
        this._activateFolder = folder;
        if (!this.isWorkspaceTrusted) {
            this.logger.info(`Running in restricted mode for an untrusted workspace, ${folder} will not be used, ${this.tmp} instead.`);
            folder = this.tmp;
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

    get currentKey() {
        return this.activateFolder ? this.keyOfFolders.get(this.activateFolder) : undefined;
    }

    set currentKey(keyInfo: gpg.GpgKeyInfo | undefined) {
        if (this.activateFolder) {
            if (keyInfo) {
                this.keyOfFolders.set(this.activateFolder, keyInfo);
            } else {
                this.keyOfFolders.delete(this.activateFolder);
            }
        }
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

export type StorageValue = string | boolean | number;

export type StorageObject = Record<string, StorageValue>;

export abstract class AbstractObjectStorage {
    protected key = "gpg-indicator-storage_" + this.constructor.name; // DON'T CHANGE IT AFTER V0.7

    protected abstract logger: Logger;
    protected abstract _getAll(): Promise<StorageObject>;
    protected abstract _setStorage(storage: StorageObject): Promise<void>;

    async getAll(): Promise<StorageObject> {
        return await locker.acquire(this.key, async (release) => {
            try {
                release(undefined, await this._getAll());
            } catch (e) {
                release(e as any);
            }
        });
    }
    protected async setStorage(storage: StorageObject): Promise<void> {
        await locker.acquire(this.key, async (release) => {
            try {
                await this._setStorage(storage);
                release();
            } catch (e) {
                this.logger.error(`Cannot set the raw data to ${this.constructor.name}: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
                release(e as any);
            }
        });
    }
    async get(key: string): Promise<StorageValue | undefined> {
        return (await this.getAll())[key];
    }
    async set(key: string, value: StorageValue): Promise<void> {
        const storage = await this.getAll();
        storage[key] = value;
        await this.setStorage(storage);
    }
    async has(key: string): Promise<boolean> {
        return Reflect.has(await this.getAll(), key);
    }
    async delete(key: string): Promise<void> {
        const storage = await this.getAll();
        Reflect.deleteProperty(storage, key);
        await this.setStorage(storage);
    }
    async clear(): Promise<void> {
        await this.setStorage({});
    }
    async keys(): Promise<string[]> {
        return Object.keys(await this.getAll());
    }
    async values(): Promise<StorageValue[]> {
        return Object.values(await this.getAll());
    }
    async entries(): Promise<[string, StorageValue][]> {
        return Object.entries(await this.getAll());
    }
}

