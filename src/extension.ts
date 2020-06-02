// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import * as gitutil from './git/utility';

let myStatusBarItem: vscode.StatusBarItem;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "gpg-indicator" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('gpg-indicator.helloWorld', () => {
        // The code you place here will be executed every time your command is executed

        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World from GPG Indicator!');
    });

    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(myStatusBarItem);
    context.subscriptions.push(vscode.window.onDidChangeActiveTerminal(updateKeyStatus));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateKeyStatus));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(updateKeyStatus));

    updateKeyStatus();
    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

async function getStatusString(): Promise<string> {
    if (vscode.workspace.workspaceFolders === undefined) {
        return '';
    }
    // TODO: Should support multi-folder workspace
    const folderPath = vscode.workspace.workspaceFolders[0].uri.path;
    const shouldParseKey = await gitutil.isSigningActivated(folderPath);
    if (!shouldParseKey) {
        return '';
    }

    const keyId = await gitutil.getSigningKey(folderPath);
    const status = `GPG Key: ${keyId}`;
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
