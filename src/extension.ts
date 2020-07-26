import * as vscode from 'vscode';

import * as git from './indicator/git';
import * as gpg from './indicator/gpg';
import * as process from './indicator/process';

// Default interval to sync key status, in second.
const syncStatusInterval = 30;

interface KeyStatusEvent {
    keyId: string
    isLocked: boolean
}

function toFolders(folders: readonly vscode.WorkspaceFolder[]): string[] {
    return folders.map((folder: vscode.WorkspaceFolder) => folder.uri.path);
}

export function activate(context: vscode.ExtensionContext) {
    const keyStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(keyStatusItem);

    const keyStatusManager = new KeyStatusManager();
    context.subscriptions.push(keyStatusManager);

    const commandId = 'gpgIndicator.unlockCurrentKey';
    const command = vscode.commands.registerCommand(commandId, async () => {
        const passphrase = await vscode.window.showInputBox({
            prompt: 'Input the passphrase for the signing key',
            password: true,
        });
        if (passphrase === undefined) { return; }
        try {
            await keyStatusManager.unlockCurrentKey(passphrase);
        } catch (err) {
            if (err instanceof Error) {
                vscode.window.showInformationMessage(`Failed to unlock: ${err.message}`);
            }
        }
    });
    context.subscriptions.push(command);
    keyStatusItem.tooltip = 'Unlock this key';
    keyStatusItem.command = commandId;

    if (vscode.workspace.workspaceFolders !== undefined) {
        const folders = toFolders(vscode.workspace.workspaceFolders);
        keyStatusManager.updateFolders(folders);
        keyStatusManager.changeActivateFolder(folders[0]);
    }
    // TODO: Monitor change of activate folder

    keyStatusManager.registerUpdateFunction((event) => {
        const shortId = event.keyId.substr(event.keyId.length - 16);
        const lockIcon = event.isLocked ? 'lock' : 'unlock';
        const status = `$(${lockIcon}) ${shortId}`;
        keyStatusItem.text = status;
        keyStatusItem.show();
    });
}

export function deactivate() {}

class KeyStatusManager {
    #activateFolder: string | undefined;
    #lastEvent: KeyStatusEvent | undefined;
    #keyOfFolders: Map<string, gpg.GpgKeyInfo> = new Map();
    #disposed: boolean = false;
    #updateFunctions: ((event: KeyStatusEvent) => void)[] = [];

    constructor() {
        this.syncLoop();
    }

    private async syncLoop(): Promise<void> {
        await process.sleep(1 * 1000);
        while(!this.#disposed) {
            if (this.#activateFolder) {
                await this.syncStatus();
            }
            await process.sleep(syncStatusInterval * 1000);
        }
        return;
    }

    private async syncStatus(): Promise<void> {
        if (!this.#activateFolder) {
            return;
        }

        const keyInfo = this.#keyOfFolders.get(this.#activateFolder);
        if (keyInfo === undefined) {
            return;
        }

        let newEvent: KeyStatusEvent | undefined;
        try {
            const isUnlocked = await gpg.isKeyUnlocked(keyInfo.keygrip);
            newEvent = {
                keyId: keyInfo.fingerprint,
                isLocked: !isUnlocked,
            };
        } catch (err) {
            console.log(`Fail to check key status: ${err.message}`);
        }

        if (newEvent !== undefined && newEvent !== this.#lastEvent) {
            this.#lastEvent = newEvent;
            this.notifyUpdate(newEvent);
        }
    }

    private notifyUpdate(keyStatus: KeyStatusEvent): void {
        for (const update of this.#updateFunctions) {
            update(keyStatus);
        }
    }

    // Update workspace folders
    async updateFolders(folders: string[]): Promise<void> {
        this.#keyOfFolders.clear();
        for (const folder of folders) {
            this.updateFolder(folder);
        }
    }

    private async updateFolder(folder: string): Promise<void> {
        try {
            const shouldParseKey = await git.isSigningActivated(folder);
            if (!shouldParseKey) {
                return;
            }
            const keyId = await git.getSigningKey(folder);
            const keyInfo = await gpg.getKeyInfo(keyId);
            this.#keyOfFolders.set(folder, keyInfo);
        } catch (err) {
            console.log(`Can not found key for folder: ${folder}`);
        }
        return;
    }

    // Change current key according to activate folder
    changeActivateFolder(folder: string): void {
        this.#activateFolder = folder;
    }

    registerUpdateFunction(update: (event: KeyStatusEvent) => void): void {
        this.#updateFunctions.push(update);
    }

    // Lock or unlock current key
    async unlockCurrentKey(passphrase: string): Promise<void> {
        if (this.#activateFolder === undefined) {
            throw new Error('No active folder');
        }

        const theKey = this.#keyOfFolders.get(this.#activateFolder);
        if (theKey === undefined) {
            throw new Error('No key for current folder');
        }

        await gpg.unlockByKeyId(theKey.fingerprint, passphrase);
        await this.syncStatus();
    }

    // Stop sync key status loop
    dispose(): void {
        this.#disposed = true;
    }
}
