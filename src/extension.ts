import * as vscode from 'vscode';
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";

import * as gpg from './indicator/gpg';
import { VscodeOutputLogger } from './logger';
import SecretObjectStorage from "./ObjectStorages/SecretObjectStorage";
import MementoObjectStorage from "./ObjectStorages/MementoObjectStorage";
import KeyStatusManager from "./KeyStatusManager";

type statusStyleEnum = "fingerprintWithUserId" | "fingerprint" | "userId";

const actions = {
    YES: vscode.l10n.t("actionYes"),
    NO: vscode.l10n.t("actionNo"),
    DO_NOT_ASK_AGAIN: vscode.l10n.t("actionDoNotAskAgain"),
    OK: vscode.l10n.t("actionOK"),
};

const tmp = fs.mkdtempSync(path.join(tmpdir(), "gpgIndicator-"));
fs.chmod(tmp, 0o544, () => { });

function toFolders(folders: readonly vscode.WorkspaceFolder[]): string[] {
    return folders.map((folder: vscode.WorkspaceFolder) => folder.uri.fsPath);
}

/**
 * Use to generate a `vscode.QuickPickItem[]` for listing and deleting cached passphrase
 * @returns When no cached passphrase found, return `false`, otherwise return `vscode.QuickPickItem[]`
 */
async function generateKeyList(secretStorage: SecretObjectStorage, keyStatusManager: KeyStatusManager): Promise<false | vscode.QuickPickItem[]> {
    const list = await secretStorage.keys();
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
    const mementoObjectStorage = new MementoObjectStorage(context.globalState, logger);
    let statusStyle: statusStyleEnum = configuration.get<statusStyleEnum>('statusStyle', "fingerprintWithUserId");

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
        vscode.workspace.isTrusted,
        tmp,
    );
    context.subscriptions.push(keyStatusManager);

    vscode.workspace.onDidGrantWorkspaceTrust(() => {
        keyStatusManager.recoverActivateFolderOnDidGrantWorkspaceTrust();
    });

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
            await keyStatusManager.syncStatus();
            if (keyStatusManager.enableSecurelyPassphraseCache) {
                await secretStorage.set(keyStatusManager.currentKey.fingerprint, passphrase);
                vscode.window.showInformationMessage(vscode.l10n.t('keyUnlockedWithCachedPassphrase'));
            } else {
                vscode.window.showInformationMessage(vscode.l10n.t('keyUnlocked'));
                const enableSecurelyPassphraseCacheNotice = !!(await mementoObjectStorage.get("enableSecurelyPassphraseCacheNotice"));
                if (!enableSecurelyPassphraseCacheNotice) {
                    const result = await vscode.window.showInformationMessage<string>(
                        vscode.l10n.t("enableSecurelyPassphraseCacheNotice"),
                        actions.YES,
                        actions.NO,
                        actions.DO_NOT_ASK_AGAIN,
                    ) || actions.NO;
                    if (result === actions.NO) {
                        return;
                    }
                    await mementoObjectStorage.set("enableSecurelyPassphraseCacheNotice", true);
                    if (result === actions.YES) {
                        configuration.update("enableSecurelyPassphraseCache", true, true);
                        // Due to the fact that vscode automatically collapses ordinary notifications into one line,
                        // causing `enableSecurelyPassphraseCache` setting links to be collapsed,
                        // notifications with options are used instead to avoid being collapsed.
                        await vscode.window.showInformationMessage<string>(
                            vscode.l10n.t("enableSecurelyPassphraseCacheNoticeAgreed"),
                            actions.OK,
                        );
                        return;
                    }
                    if (result === actions.DO_NOT_ASK_AGAIN) {
                        // Same as the reason above.
                        vscode.window.showInformationMessage<string>(
                            vscode.l10n.t('enableSecurelyPassphraseCacheNoticeForbidden'),
                            actions.OK,
                        );
                        return;
                    }
                }
            }
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
        if ((await secretStorage.entries()).length === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('noCachedPassphrase'));
            return;
        }
        if ((await vscode.window.showInformationMessage<vscode.MessageItem>(
            vscode.l10n.t("passphraseClearanceConfirm"),
            { modal: true },
            { title: actions.YES },
            { title: actions.NO, isCloseAffordance: true },
        ))?.title !== actions.YES) {
            return;
        }
        await secretStorage.clear();
        vscode.window.showInformationMessage(vscode.l10n.t('passphraseCleared'));
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
                vscode.window.showInformationMessage(vscode.l10n.t('passphraseCleared'));
            }).catch((e) => {
                logger.error(`Cannot clear the passphrase cache when "enableSecurelyPassphraseCache" turn to off: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
            });
        }
        keyStatusManager.enableSecurelyPassphraseCache = newEnableSecurelyPassphraseCache;
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
    await fs.promises.rm(tmp, {
        recursive: true,
        force: true,
    });
}
