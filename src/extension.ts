import * as vscode from 'vscode';
import * as os from 'os';
import * as crypto from 'crypto';
import * as util from 'util';

import * as git from './indicator/git';
import * as gpg from './indicator/gpg';
import { Logger } from "./manager";
import KeyStatusManager from "./manager";
import { Storage, KeyStatusEvent } from "./manager";
import * as message from "./message";
import { keys } from "./message";

/** Translate a message which already takes some argument. */
function _t(w: message.WaitTranslate): string {
    return w(vscode.l10n.t);
}

type statusStyleEnum = "fingerprintWithUserId" | "fingerprint" | "userId";

const actions = {
    YES: _t(keys.actionYes()),
    NO: _t(keys.actionNo()),
    DO_NOT_ASK_AGAIN: _t(keys.actionDoNotAskAgain()),
    OK: _t(keys.actionOK()),
    OPEN_SETTING: _t(keys.actionOpenSetting()),
};

function toFolders(folders: readonly vscode.WorkspaceFolder[]): string[] {
    return folders.map((folder: vscode.WorkspaceFolder) => folder.uri.fsPath);
}

/**
 * Use to generate a `vscode.QuickPickItem[]` for listing and deleting cached passphrase
 * @returns When no cached passphrase found, return `false`, otherwise return `vscode.QuickPickItem[]`
 */
async function generateKeyList(secretStorage: PassphraseStorage, keyStatusManager: KeyStatusManager): Promise<false | vscode.QuickPickItem[]> {
    const list = [...secretStorage];
    if (list.length === 0) {
        vscode.window.showInformationMessage(_t(keys.noCachedPassphrase()));
        return false;
    }
    const items: vscode.QuickPickItem[] = [];
    const keyInfos = await gpg.getKeyInfos();
    const keyToUser = keyInfos.map(({ userId, fingerprint }): [string, string?] => [fingerprint, userId]);
    const withUsers = keyToUser.filter((pair): pair is [string, string] => pair[1] !== undefined);
    const keyList = new Map<string, string>(withUsers);
    const isCurrentKey = (fingerprint: string) => keyStatusManager.getCurrentKey()?.fingerprint === fingerprint;
    const currentKeyList = list.filter(isCurrentKey);
    const currentKey = currentKeyList.length === 1 ? currentKeyList[0] : undefined;
    if (currentKey) {
        items.push({
            label: _t(keys.currentKey()),
            alwaysShow: true,
            kind: vscode.QuickPickItemKind.Separator,
        });
        items.push({
            label: currentKey,
            detail: keyList.get(currentKey),
            alwaysShow: true,
            picked: false,
            kind: vscode.QuickPickItemKind.Default,
        });
    }
    const restList = list.filter((fp: string) => !isCurrentKey(fp));
    if (restList.length > 0) {
        items.push({
            label: _t(keys.restKey()),
            alwaysShow: false,
            kind: vscode.QuickPickItemKind.Separator,
        });
        for (const fingerprint of restList) {
            items.push({
                label: fingerprint,
                detail: keyList.get(fingerprint),
                alwaysShow: false,
                picked: false,
                kind: vscode.QuickPickItemKind.Default,
            });
        }
    }
    return items;
}

export async function activate(context: vscode.ExtensionContext) {
    const masterKey = await initializeMasterKey(context.secrets);

    const configuration = vscode.workspace.getConfiguration('gpgIndicator');
    const logLevel = configuration.get<string>('outputLogLevel', "info");
    const logger = new VscodeOutputLogger('GPG Indicator', logLevel);
    const syncStatusInterval = configuration.get<number>('statusRefreshInterval', 30);
    const secretStorage = new PassphraseStorage(new AesGcmCipher(masterKey), logger, context.globalState);
    let statusStyle: statusStyleEnum = configuration.get<statusStyleEnum>('statusStyle', "fingerprintWithUserId");

    logger.info('Active GPG Indicator extension ...');
    logger.info(`Setting: sync status interval: ${syncStatusInterval}`);

    const keyStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(keyStatusItem);

    logger.info('Create key status manager');
    const keyStatusManager = new KeyStatusManager(
        _t,
        logger,
        new git.CliGit(),
        new gpg.CliGpg(logger),
        syncStatusInterval,
        secretStorage,
        configuration.get<boolean>('enablePassphraseCache', false),
        vscode.workspace.isTrusted,
        os.homedir(),
    );
    context.subscriptions.push(keyStatusManager);

    vscode.workspace.onDidGrantWorkspaceTrust(() => {
        keyStatusManager.recoverActivateFolderOnDidGrantWorkspaceTrust();
    });

    const commandId = 'gpgIndicator.unlockCurrentKey';
    context.subscriptions.push(vscode.commands.registerCommand(commandId, async () => {
        const currentKey = keyStatusManager.getCurrentKey();
        if (!currentKey) {
            vscode.window.showErrorMessage(_t(keys.noKeyInCurrentFolder()));
            return;
        }
        const passphrase = await vscode.window.showInputBox({
            prompt: keyStatusManager.enablePassphraseCache
                ? _t(keys.passphraseInputPromptTitleWhenSecurelyPassphraseCacheEnabled())
                : _t(keys.passphraseInputPromptTitle()),
            password: true,
            placeHolder: currentKey.userId
                ? _t(keys.keyDescriptionWithUserId(currentKey.userId))
                : undefined,
        });
        if (passphrase === undefined) { return; }
        try {
            await keyStatusManager.unlockCurrentKey(passphrase);
            await keyStatusManager.syncStatus();
        } catch (err) {
            if (err instanceof Error) {
                vscode.window.showErrorMessage(_t(keys.keyUnlockFailedWithId(err.message)));
            }
        }

        if (keyStatusManager.enablePassphraseCache) {
            await secretStorage.set(currentKey.fingerprint, passphrase);
            vscode.window.showInformationMessage(_t(keys.keyUnlockedWithCachedPassphrase()));
        } else {
            vscode.window.showInformationMessage(_t(keys.keyUnlocked()));
            await introduceCacheFeature(context);
        }
    }));
    keyStatusItem.tooltip = 'Unlock this key';
    keyStatusItem.command = commandId;

    context.subscriptions.push(vscode.commands.registerCommand("gpgIndicator.deletePassphraseCache", async () => {
        const items: vscode.QuickPickItem[] | false = await generateKeyList(secretStorage, keyStatusManager);
        if (!items) {
            vscode.window.showInformationMessage(_t(keys.noCachedPassphrase()));
            return;
        }
        const targets = await vscode.window.showQuickPick(items, {
            title: _t(keys.cachedPassphraseListForDeletion()),
            canPickMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: _t(keys.cachedPassphraseListForDeletionPlaceHolder()),
        });
        if (!Array.isArray(targets) || targets.length === 0) {
            return;
        }
        await Promise.all(targets.map((target) => secretStorage.delete(target.label)));
        vscode.window.showInformationMessage(_t(keys.passphraseDeleted()));
    }));

    context.subscriptions.push(vscode.commands.registerCommand("gpgIndicator.listPassphraseCache", async () => {
        const items: vscode.QuickPickItem[] | false = await generateKeyList(secretStorage, keyStatusManager);
        if (!items) {
            vscode.window.showInformationMessage(_t(keys.noCachedPassphrase()));
            return;
        }

        // Because of the lack of the listing function, use quick pick instead.
        await vscode.window.showQuickPick(items, {
            title: _t(keys.cachedPassphraseList()),
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand("gpgIndicator.clearPassphraseCache", async () => {
        if ([...secretStorage].length === 0) {
            vscode.window.showInformationMessage(_t(keys.noCachedPassphrase()));
            return;
        }
        if ((await vscode.window.showInformationMessage<vscode.MessageItem>(
            _t(keys.passphraseClearanceConfirm()),
            { modal: true },
            { title: actions.YES },
            { title: actions.NO, isCloseAffordance: true },
        ))?.title !== actions.YES) {
            return;
        }
        await Promise.all([...secretStorage].map((key) => secretStorage.delete(key)));
        vscode.window.showInformationMessage(_t(keys.passphraseCleared()));
    }));

    const updateKeyStatus = (event?: KeyStatusEvent) => {
        if (!event) {
            keyStatusItem.hide();
            return;
        }
        const shortId = event.info.fingerprint.substring(event.info.fingerprint.length - 16);
        const lockIcon = !event.isLocked ? 'unlock' : 'lock';
        let shortIdWithUserId = `${shortId}`;
        let userId = "";
        if (event.info.userId) {
            shortIdWithUserId += ` - ${event.info.userId}`;
            userId = event.info.userId;
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

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        logger.info("[Configuration] Change event detected");
        const configuration = vscode.workspace.getConfiguration('gpgIndicator');
        keyStatusManager.updateSyncInterval(configuration.get<number>('statusRefreshInterval', 30));
        logger.setLevel(configuration.get<string>('outputLogLevel', "info"));
        const newEnablePassphraseCache = configuration.get<boolean>('enablePassphraseCache', false);
        if (keyStatusManager.enablePassphraseCache && !newEnablePassphraseCache) {
            try {
                await Promise.all([...secretStorage].map((key) => secretStorage.delete(key)));
                vscode.window.showInformationMessage(_t(keys.passphraseCleared()));
            } catch (err) {
                const errors = err instanceof Error ? err.message : JSON.stringify(err);
                logger.error(`Cannot clear the passphrase cache when "enablePassphraseCache" turn to off: ${errors}`);
            }
        }
        keyStatusManager.enablePassphraseCache = newEnablePassphraseCache;
        const oldStatusStyle = statusStyle;
        statusStyle = configuration.get<statusStyleEnum>('statusStyle', "fingerprintWithUserId");
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

export async function deactivate() {
}

async function introduceCacheFeature(context: vscode.ExtensionContext) {
    const configuration = vscode.workspace.getConfiguration('gpgIndicator');

    if (await context.globalState.get("user:is-cache-notice-read")) {
        return;
    }

    const result = await vscode.window.showInformationMessage<string>(
        _t(keys.enableSecurelyPassphraseCacheNotice()),
        actions.YES,
        actions.NO,
        actions.DO_NOT_ASK_AGAIN,
    ) || actions.NO;
    if (result === actions.NO) {
        return;
    }
    await context.globalState.update("user:is-cache-notice-read", true);
    if (result === actions.YES) {
        configuration.update("enablePassphraseCache", true, true);
    }

    let postMessage: message.WaitTranslate;
    if (result === actions.YES) {
        postMessage = keys.enableSecurelyPassphraseCacheNoticeAgreed();
    } else { // do not ask again case
        postMessage = keys.enableSecurelyPassphraseCacheNoticeForbidden();
    }
    // Due to the fact that vscode automatically collapses ordinary notifications into one line,
    // causing `enablePassphraseCache` setting links to be collapsed,
    // notifications with options are used instead to avoid being collapsed.
    const postMessageResult = await vscode.window.showInformationMessage<string>(
        _t(postMessage),
        actions.OK,
        actions.OPEN_SETTING,
    );
    if (postMessageResult === actions.OPEN_SETTING) {
        vscode.commands.executeCommand('workbench.action.openSettings', 'gpgIndicator.enablePassphraseCache');
    }
}

const timeStr = (date = new Date()) => date.toISOString();

enum LogLevel {
    error = 1,
    warning,
    info
}

export class VscodeOutputLogger implements Logger {
    private outputChannel: vscode.OutputChannel;
    private level: LogLevel;
    /**
     * @param name - The name of VS Code output channel on UI
     * @param level - The log level for the logger
     */
    constructor(name: string, level: string) {
        this.outputChannel = vscode.window.createOutputChannel(name);
        this.level = VscodeOutputLogger.levelFromString(level);
    }

    static levelFromString(level: string): LogLevel {
        switch (level) {
            case "error":
                return LogLevel.error;
            case "warning":
                return LogLevel.warning;
            case "info":
                return LogLevel.info;
            default:
                throw new Error(`unknown log level: ${level}`);
        }
    }

    setLevel(level: string): void {
        this.level = VscodeOutputLogger.levelFromString(level);
    }

    info(message: string): void {
        if (this.level < LogLevel.info) {
            return;
        }
        this.outputChannel.appendLine(`[${timeStr()}] [INFO] ` + message);
    }

    warn(message: string): void {
        if (this.level < LogLevel.warning) {
            return;
        }
        this.outputChannel.appendLine(`[${timeStr()}] [WARN] ` + message);
    }

    error(message: string): void {
        if (this.level < LogLevel.error) {
            return;
        }
        this.outputChannel.appendLine(`[${timeStr()}] [ERROR] ` + message);
    }
}

/**
 * A simple storage interface for passphrase.
 * 
 * The passphrase is encrypted before stored into VS Code storage.
 */
export class PassphraseStorage implements Storage {
    private namespace: string = "passphrase";
    constructor(
        private cipher: Cipher,
        private logger: Logger,
        private storage: vscode.Memento,
    ) { }

    async get(key: string): Promise<string | undefined> {
        const encryptedValue = this.storage.get<EncryptedData>(`${this.namespace}:${key}`);
        if (encryptedValue === undefined) {
            return;
        }
        const value: string = await this.cipher.decrypt(encryptedValue);
        return value;
    }

    async set(key: string, value: string): Promise<void> {
        const encryptedValue: EncryptedData = await this.cipher.encrypt(value);
        this.logger.info(`set passphrase with key: ${key}`);
        await this.storage.update(`${this.namespace}:${key}`, encryptedValue);
    }

    async delete(key: string): Promise<void> {
        // undefined value is the documented interface for delete operation
        this.logger.info(`delete passphrase with key: ${key}`);
        await this.storage.update(`${this.namespace}:${key}`, undefined);
    }

    // Support for-of iterator protocol
    *[Symbol.iterator](): Generator<string> {
        const keys = this.storage.keys();
        const passphraseKeys = keys.filter((key) => key.startsWith(`${this.namespace}:`));
        const rawPassphraseKeys = passphraseKeys.map((key) => key.slice(`${this.namespace}:`.length));
        for (const key of rawPassphraseKeys) {
            yield key;
        }
    }
}


const randomBytes = util.promisify(crypto.randomBytes);

/** Encrypted data structure. */
export interface EncryptedData {

    /** Algorithm tag for encrypted data, for future compatibility. */
    algTag: string

    /** Encrypted data in string format. */
    text: string
}

/** Simple cipher interface, only support string type. */
export interface Cipher {

    /** Encrypt plain text to encrypted data. */
    encrypt(plainText: string): Promise<EncryptedData>

    /** Decrypt encrypted data to plain text. */
    decrypt(data: EncryptedData): Promise<string>
}

/** A cipher implementation using AES-GCM */
export class AesGcmCipher implements Cipher {
    private masterKey: string;

    /**
     * @param masterKey - the master key for secret encryption, must be hex string of 32 bytes.
     */
    constructor(masterKey: string) {
        this.masterKey = masterKey;
    }

    async encrypt(plainText: string): Promise<EncryptedData> {
        const iv = await randomBytes(12);
        const masterKey = Buffer.from(this.masterKey, 'hex');

        const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
        const cipherText = Buffer.concat([
            cipher.update(plainText, 'utf8'),
            cipher.final(),
        ]).toString('hex');

        return {
            algTag: 'aes-256-gcm', // mechanism for compatibility in the future.
            text: [cipherText, iv.toString('hex'), cipher.getAuthTag().toString('hex')].join(':')
        };
    }

    async decrypt(data: EncryptedData): Promise<string> {
        if (data.algTag !== 'aes-256-gcm') {
            throw Error(`unexpected algorithm ${data.algTag}`);
        }
        const [cipherTextHex, ivHex, authTagHex] = data.text.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const masterKey = Buffer.from(this.masterKey, 'hex');

        const cipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
        cipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        const plainText = Buffer.concat([
            cipher.update(cipherTextHex, 'hex'),
            cipher.final(),
        ]).toString('utf8');

        return plainText;
    }
}

async function initializeMasterKey(secrets: vscode.SecretStorage): Promise<string> {
    // Notice: can not be changed.
    const keyLabel = 'gpg-indicator-master-key';

    let masterKey = await secrets.get(keyLabel);
    if (masterKey === undefined) {
        const rawKey = await util.promisify(crypto.randomBytes)(32);
        masterKey = rawKey.toString('hex');
        await secrets.store(keyLabel, masterKey);
    }

    return masterKey;
}
