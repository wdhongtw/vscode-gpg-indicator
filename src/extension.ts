import * as vscode from 'vscode';

import * as git from './indicator/git';
import * as gpg from './indicator/gpg';
import * as process from './indicator/process';
import { VscodeOutputLogger } from './logger';
import SecretObjectStorage from "./SecretObjectStorage";
import locker from "./indicator/locker";

const YES = vscode.l10n.t("actionYes");
const NO = vscode.l10n.t("actionNo");

function toFolders(folders: readonly vscode.WorkspaceFolder[]): string[] {
    return folders.map((folder: vscode.WorkspaceFolder) => folder.uri.fsPath);
}

/**
 * Use to generate a `vscode.QuickPickItem[]` for listing and deleting cached passphrase
 * @returns When no cached passphrase found, return `false`, otherwise return `vscode.QuickPickItem[]`
 */
async function generateKeyList(secretStorage: SecretObjectStorage, keyStatusManager: KeyStatusManager): Promise<false | vscode.QuickPickItem[]> {
    const list = Object.keys(await secretStorage.getAll());
    if (list.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('noCachedPassphrase'));
        return false;
    }
    const items: vscode.QuickPickItem[] = [];
    const keyList = Object.fromEntries(
        (await gpg.getKeyInfos())
            .filter(({ userId }) => userId)
            .map(({ userId, fingerprint }) => [fingerprint, userId]),
    );
    if (keyStatusManager.currentKey?.fingerprint && list.includes(keyStatusManager.currentKey.fingerprint)) {
        items.push({
            label: vscode.l10n.t("currentKey"),
            alwaysShow: true,
            kind: vscode.QuickPickItemKind.Separator,
        });
        items.push({
            label: keyStatusManager.currentKey.fingerprint,
            detail: keyList[keyStatusManager.currentKey.fingerprint],
            alwaysShow: true,
            picked: false,
            kind: vscode.QuickPickItemKind.Default,
        });
    }
    const restList = list.filter((fingerprint) => fingerprint !== keyStatusManager.currentKey?.fingerprint);
    if (restList.length > 0) {
        items.push({
            label: vscode.l10n.t("restKey"),
            alwaysShow: false,
            kind: vscode.QuickPickItemKind.Separator,
        });
        for (const label of restList) {
            items.push({
                label,
                detail: keyList[label],
                alwaysShow: false,
                picked: false,
                kind: vscode.QuickPickItemKind.Default,
            });
        }
    }
    return items;
}

export async function activate(context: vscode.ExtensionContext) {
    const configuration = vscode.workspace.getConfiguration('gpgIndicator');
    const logLevel = configuration.get<string>('outputLogLevel', "info");
    const logger = new VscodeOutputLogger('GPG Indicator', logLevel);
    const syncStatusInterval = configuration.get<number>('statusRefreshInterval', 30);
    const secretStorage = new SecretObjectStorage(context.secrets, logger);
    let statusStyle: "fingerprintWithUserId" | "fingerprint" | "userId" = configuration.get('statusStyle', "fingerprintWithUserId");

    logger.info('Active GPG Indicator extension ...');
    logger.info(`Setting: sync status interval: ${syncStatusInterval}`);

    const keyStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(keyStatusItem);

    logger.info('Create key status manager');
    const keyStatusManager = new KeyStatusManager(
        logger,
        syncStatusInterval,
        secretStorage,
        configuration.get<boolean>('enableSecurelyPassphraseCache', false),
    );
    context.subscriptions.push(keyStatusManager);

    const commandId = 'gpgIndicator.unlockCurrentKey';
    context.subscriptions.push(vscode.commands.registerCommand(commandId, async () => {
        if (!keyStatusManager.currentKey) {
            vscode.window.showErrorMessage(vscode.l10n.t("noKeyInCurrentFolder"));
            return;
        }
        const passphrase = await vscode.window.showInputBox({
            prompt: keyStatusManager.enableSecurelyPassphraseCache
                ? vscode.l10n.t('passphraseInputPromptTitleWhenSecurelyPassphraseCacheEnabled')
                : vscode.l10n.t('passphraseInputPromptTitle'),
            password: true,
            placeHolder: keyStatusManager.currentKey.userId
                ? vscode.l10n.t('keyDescriptionWithUsedId', keyStatusManager.currentKey.userId)
                : undefined,
        });
        if (passphrase === undefined) { return; }
        try {
            await keyStatusManager.unlockCurrentKey(passphrase);
            if (keyStatusManager.enableSecurelyPassphraseCache) {
                await secretStorage.set(keyStatusManager.currentKey.fingerprint, passphrase);
                vscode.window.showInformationMessage(vscode.l10n.t('keyUnlockedWithCachedPassphrase'));
            } else {
                vscode.window.showInformationMessage(vscode.l10n.t('keyUnlocked'));
            }
            await keyStatusManager.syncStatus();
        } catch (err) {
            if (err instanceof Error) {
                vscode.window.showErrorMessage(vscode.l10n.t('keyUnlockFailed', err.message));
            }
        }
    }));
    keyStatusItem.tooltip = 'Unlock this key';
    keyStatusItem.command = commandId;

    context.subscriptions.push(vscode.commands.registerCommand("gpgIndicator.deletePassphraseCache", async () => {
        const items: vscode.QuickPickItem[] | false = await generateKeyList(secretStorage, keyStatusManager);
        if (!items) {
            vscode.window.showInformationMessage(vscode.l10n.t('noCachedPassphrase'));
            return;
        }
        const targets = await vscode.window.showQuickPick(items, {
            title: vscode.l10n.t("cachedPassphraseListForDeletion"),
            canPickMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: vscode.l10n.t("cachedPassphraseListForDeletionPlaceHolder"),
        });
        if (!Array.isArray(targets) || targets.length === 0) {
            return;
        }
        for (const target of targets) {
            await secretStorage.delete(target.label);
        }
        vscode.window.showInformationMessage(vscode.l10n.t('passphraseDeleted'));
    }));

    context.subscriptions.push(vscode.commands.registerCommand("gpgIndicator.listPassphraseCache", async () => {
        const items: vscode.QuickPickItem[] | false = await generateKeyList(secretStorage, keyStatusManager);
        if (!items) {
            vscode.window.showInformationMessage(vscode.l10n.t('noCachedPassphrase'));
            return;
        }
        /**
         * Because of the lack of the listing function, use quick pick instead.
         */
        await vscode.window.showQuickPick(items, {
            title: vscode.l10n.t("cachedPassphraseList"),
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand("gpgIndicator.clearPassphraseCache", async () => {
        if (Object.entries(await secretStorage.getAll()).length === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('noCachedPassphrase'));
            return;
        }
        if ((await vscode.window.showInformationMessage<vscode.MessageItem>(
            vscode.l10n.t("passphraseClearanceConfirm"),
            { modal: true },
            { title: YES },
            { title: NO, isCloseAffordance: true },
        ))?.title !== YES) {
            return;
        }
        await secretStorage.clear();
        vscode.window.showInformationMessage(vscode.l10n.t('passphraseCeared'));
    }));

    const updateKeyStatus = () => {
        if (!keyStatusManager.currentKey) {
            keyStatusItem.hide();
            return;
        }
        const shortId = keyStatusManager.currentKey.fingerprint.substring(keyStatusManager.currentKey.fingerprint.length - 16);
        const lockIcon = keyStatusManager.isUnlocked ? 'unlock' : 'lock';
        let shortIdWithUserId = `${shortId}`;
        let userId = "";
        if (keyStatusManager.currentKey.userId) {
            shortIdWithUserId += ` - ${keyStatusManager.currentKey.userId}`;
            userId = keyStatusManager.currentKey.userId;
        } else {
            userId = shortId;
        }
        let status = `$(${lockIcon}) `;
        switch (statusStyle) {
            case "fingerprint":
                status += shortId;
                break;
            case "userId":
                status += userId;
                break;
            case "fingerprintWithUserId":
            default:
                status += shortIdWithUserId;
                break;
        }
        keyStatusItem.text = status;
        keyStatusItem.show();
    };

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        logger.info("[Configuration] Change event detected");
        const configuration = vscode.workspace.getConfiguration('gpgIndicator');
        keyStatusManager.updateSyncInterval(configuration.get<number>('statusRefreshInterval', 30));
        logger.setLevel(configuration.get<string>('outputLogLevel', "info"));
        const newEnableSecurelyPassphraseCache = configuration.get<boolean>('enableSecurelyPassphraseCache', false);
        if (keyStatusManager.enableSecurelyPassphraseCache && !newEnableSecurelyPassphraseCache) {
            secretStorage.clear().then(() => {
                vscode.window.showInformationMessage(vscode.l10n.t('passphraseCeared'));
            }).catch((e) => {
                logger.error(`Cannot clear the passphrase cache when "enableSecurelyPassphraseCache" turn to off: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
            });
        }
        keyStatusManager.enableSecurelyPassphraseCache = newEnableSecurelyPassphraseCache;
        const oldStatusStyle = statusStyle;
        statusStyle = configuration.get('statusStyle', "fingerprintWithUserId");
        if (oldStatusStyle !== statusStyle) {
            updateKeyStatus();
        }
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        const fileUri = editor?.document.uri;
        if (!fileUri) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (!folder) {
            return;
        }
        await keyStatusManager.changeActivateFolder(folder.uri.fsPath);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
        if (vscode.workspace.workspaceFolders === undefined) {
            return;
        }
        const folders = toFolders(vscode.workspace.workspaceFolders);
        keyStatusManager.updateFolders(folders);
    }));

    keyStatusManager.registerUpdateFunction(updateKeyStatus);

    if (vscode.workspace.workspaceFolders !== undefined) {
        const folders = toFolders(vscode.workspace.workspaceFolders);
        await keyStatusManager.updateFolders(folders);
        await keyStatusManager.changeActivateFolder(folders[0]);
    }

    keyStatusManager.syncLoop();
}

export function deactivate() { }

class KeyStatusEvent {
    constructor(public keyId: string, public isLocked: boolean) {
    }

    static equal(left: KeyStatusEvent, right: KeyStatusEvent): boolean {
        return left.keyId === right.keyId && left.isLocked === right.isLocked;
    }
}

class KeyStatusManager {
    private activateFolder: string | undefined;
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
        private logger: VscodeOutputLogger,
        private syncInterval: number,
        private secretStorage: SecretObjectStorage,
        public enableSecurelyPassphraseCache: boolean,
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
                    this.logger.info(`Find updated key ${keyId} / ${keyInfo.fingerprint} from ${oldCurrentKey?.fingerprint} for current folder ${this.activateFolder}`);
                    this.keyOfFolders.set(this.activateFolder, keyInfo);
                }
            } else {
                this.currentKey = undefined;
            }
            if (this.currentKey === undefined) {
                if (oldCurrentKey) {
                    this.logger.info('User disabled commit signning or removed the key for current folder, trigger status update functions');
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
                                            ? vscode.l10n.t('keyChangedAndAutomaticallyUnlocked')
                                            : vscode.l10n.t('keyRelockedAndAutomaticallyUnlocked'),
                                    );
                                } else {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t('keyChangedAndAutomaticallyUnlocked')
                                            : vscode.l10n.t('keyAutomaticallyUnlocked'),
                                    );
                                }
                            } catch (e) {
                                this.logger.error(`Cannot unlock the key with the cached passphrase: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
                                await this.secretStorage.delete(this.currentKey.fingerprint);
                                if (this.isUnlockedPrevious) {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t('keyChangedButAutomaticallyUnlockFailed')
                                            : vscode.l10n.t('keyRelockedButAutomaticallyUnlockFailed'),
                                    );
                                } else {
                                    vscode.window.showInformationMessage(
                                        this.currentKey !== oldCurrentKey
                                            ? vscode.l10n.t('keyChangedButAutomaticallyUnlockFailed')
                                            : vscode.l10n.t('keyAutomaticallyUnlockFailed'),
                                    );
                                }
                            }
                            this.isUnlocked = await gpg.isKeyUnlocked(this.currentKey.keygrip);
                        }
                    }
                } else if (this.isUnlockedPrevious && !this.isUnlocked) {
                    vscode.window.showInformationMessage(
                        this.currentKey === oldCurrentKey
                            ? vscode.l10n.t('keyChanged')
                            : vscode.l10n.t('keyRelocked'),
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
        if (this.activateFolder === folder) {
            return;
        }
        this.logger.info(`Change folder to ${folder}`);
        this.activateFolder = folder;
        await this.syncStatus();
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
            throw new Error(vscode.l10n.t('noActiveFolder'));
        }

        if (this.currentKey === undefined) {
            throw new Error(vscode.l10n.t('noKeyForCurrentFolder'));
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
