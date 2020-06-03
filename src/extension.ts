import * as vscode from 'vscode';

import * as git from './indicator/git';
import * as gpg from './indicator/gpg';

let myStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(myStatusBarItem);
    context.subscriptions.push(vscode.window.onDidChangeActiveTerminal(updateKeyStatus));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateKeyStatus));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(updateKeyStatus));

    updateKeyStatus();
}

export function deactivate() {}

async function getStatusString(): Promise<string> {
    if (vscode.workspace.workspaceFolders === undefined) {
        return '';
    }
    // TODO: Should support multi-folder workspace
    const folderPath = vscode.workspace.workspaceFolders[0].uri.path;
    const shouldParseKey = await git.isSigningActivated(folderPath);
    if (!shouldParseKey) {
        return '';
    }

    const keyId = await git.getSigningKey(folderPath);
    const isUnlocked = await gpg.isKeyIdUnlocked(keyId);
    const lockedText = isUnlocked ? 'Unlocked' : 'Locked';
    const status = `GPG: ${keyId} (${lockedText})`;
    return status;
}

async function updateKeyStatus(): Promise<void> {
    try {
        myStatusBarItem.text = await getStatusString();
        if (myStatusBarItem.text === '') {
            myStatusBarItem.hide();
        } else {
            myStatusBarItem.show();
        }
    } catch (err) {
        console.error(err);
    }
}
