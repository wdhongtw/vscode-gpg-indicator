import { Mutex } from "./indicator/locker";

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

/** KeyStatusManager is a manager for key status synchronization. */
export default class KeyStatusManager {
    private updateFolderLock: Mutex = new Mutex();
    private syncStatusLock: Mutex = new Mutex();
    private activateFolder: string | undefined = undefined;
    private _activateFolder: string | undefined = undefined;
    private lastEvent: KeyStatusEvent | undefined = undefined;
    private currentKey: GpgKeyInfo | undefined = undefined;
    private keyOfFolders: Map<string, GpgKeyInfo> = new Map();
    private updateFunctions: ((event?: KeyStatusEvent) => void)[] = [];
    private isUnlocked = false;

    constructor(
        private logger: Logger,
        private git: GitAdapter,
        private gpg: GpgAdapter,
        private secretStorage: Storage,
        private receiver: EventReceiver,
        public enablePassphraseCache: boolean,
        private isWorkspaceTrusted: boolean,
        private defaultFolder: string,
    ) {
    }

    /** Trigger key status update once, coroutine-safe is ensured. */
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
            await this.receiver.onEvent(Event.StoredPassphraseUnlockSucceed);
        } catch (err) {
            if (!(err instanceof Error)) {
                throw err;
            }
            this.logger.error(`Cannot unlock the key with the cached passphrase: ${err.message}`);
            await this.secretStorage.delete(keyInfo.fingerprint);
            await this.receiver.onEvent(Event.StoredPassphraseBeDeleted);
            await this.receiver.onEvent(Event.StoredPassphraseUnlockFailed);
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

        // We do not notify key changed event, since that it could be noisy potentially.
        // For the same key, we only notify the change from "unlocked" to "locked".
        if (!isChanged && isUnlockedPrev && !isUnlocked) {
            await this.receiver.onEvent(Event.LockedStateEntered);
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

    /** Update workspace folders */
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

    /** Change current key according to activate folder */
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

    /** Recover activate folder after workspace trust granted */
    async recoverActivateFolderOnDidGrantWorkspaceTrust(): Promise<void> {
        this.isWorkspaceTrusted = true;
        if (typeof this._activateFolder !== "string") {
            this.logger.info(`The workspace has been granted trust, but no folder passed in before.`);
            return;
        }
        this.logger.info(`The workspace has been granted trust, ${this._activateFolder} will be used.`);
        await this.changeActivateFolder(this._activateFolder);
    }

    /** Register update function for key status change */
    registerUpdateFunction(update: (event?: KeyStatusEvent) => void): void {
        this.logger.info('Got one update function');
        this.updateFunctions.push(update);
    }

    /** Get current key information, if any. */
    getCurrentKey(): GpgKeyInfo | undefined {
        const currentKey = this.activateFolder ? this.keyOfFolders.get(this.activateFolder) : undefined;
        if (!currentKey) {
            return undefined;
        }

        return currentKey;
    }

    /** Lock or unlock current key */
    async unlockCurrentKey(passphrase: string): Promise<void> {
        if (this.activateFolder === undefined) {
            this.logger.error("No activate folder");
            return;
        }

        if (this.currentKey === undefined) {
            this.logger.error("No current key");
            return;
        }

        if (await this.gpg.isKeyUnlocked(this.currentKey.keygrip)) {
            this.logger.warn(`Key is already unlocked, skip unlock request`);
            return;
        }

        this.logger.info(`Try to unlock current key: ${this.currentKey.fingerprint}`);
        await this.gpg.unlockByKey(this.currentKey.keygrip, passphrase);
    }

    /** Fetch all available GPG key information in user global scope. */
    async getKeyInfos(): Promise<GpgKeyInfo[]> {
        return await this.gpg.getKeyInfos();
    }
}

/** Types for events from key manager. */
export enum Event {

    /** Use stored passphrase to unlock and succeed. */
    StoredPassphraseUnlockSucceed,

    /** Use stored passphrase to unlock buf failed. */
    StoredPassphraseUnlockFailed,

    /** Previously stored passphrase be deleted. */
    StoredPassphraseBeDeleted,

    /** Some key changed into locked state. */
    LockedStateEntered,
};

/** Receiver interface for events from key manager. */
export interface EventReceiver {

    /** Handle given event. */
    onEvent(event: Event): Promise<void>;
}

/** The abstract storage for our application, focusing on string type. */
export interface Storage {

    /** Get the value for the key. */
    get(key: string): Promise<string | undefined>

    /** Update or insert value for the key. */
    set(key: string, value: string): Promise<void>

    /** Delete a value for some key, if any. */
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
