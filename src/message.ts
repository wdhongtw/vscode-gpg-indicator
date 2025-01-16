export const keys = {
    actionYes: key0("Yes"),
    actionNo: key0("No"),
    actionDoNotAskAgain: key0("Don't ask again"),
    actionOK: key0("OK"),
    actionOpenSetting: key0("Open setting"),
    separator: key0(", "),
    noKeyInCurrentFolder: key0("Unable to retrieve any key in current folder."),
    passphraseInputPromptTitle: key0("Input the passphrase for the signing key"),
    passphraseInputPromptTitleWhenSecurelyPassphraseCacheEnabled: key0("Input the passphrase for the signing key, passphrase cache enabled"),
    keyDescriptionWithUserId: key1("For the key associated with {0}"),
    keyUnlockedWithCachedPassphrase: key0("Key unlocked, and the passphrase is stored in the SecretStorage of VSCode."),
    keyUnlocked: key0("Key unlocked."),
    keyUnlockFailedWithId: key1("Failed to unlock: {0}"),
    noCachedPassphraseForCurrentKey: key0("There is no cached passphrase for your current key."),
    cachedPassphraseListForDeletion: key0("List of keys with stored passphrases, select to delete."),
    cachedPassphraseListForDeletionPlaceHolder: key0("You can search the fingerprint and user id in this search box."),
    passphraseDeleted: key0("Your cached passphrase has been deleted."),
    noCachedPassphrase: key0("There is no cached passphrase."),
    currentKey: key0("Current key"),
    restKey: key0("Rest keys"),
    cachedPassphraseList: key0("List of keys with stored passphrases:"),
    passphraseClearanceConfirm: key0("Do you really want to clear all your cached passphrase? This action CANNOT be reverted."),
    passphraseCleared: key0("All Your cached passphrase has been cleared."),
    keyChangedAndAutomaticallyUnlocked: key0("Key changed, and unlocked automatically using the previous-used stored passphrase."),
    keyRelockedAndAutomaticallyUnlocked: key0("Key re-locked, and unlocked automatically using the previous-used stored passphrase."),
    keyAutomaticallyUnlocked: key0("Key unlocked automatically using the previous-used stored passphrase."),
    keyChangedButAutomaticallyUnlockFailed: key0("Key changed, but the previous-used stored passphrase for this key is unable to unlock the key, so the passphrase has been deleted and you need to unlock the key manually."),
    keyRelockedButAutomaticallyUnlockFailed: key0("Key re-locked automatically, but the previous-used stored passphrase is unable to unlock the key, so the passphrase has been deleted and you need to unlock the key manually."),
    keyAutomaticallyUnlockFailed: key0("The previous-used stored passphrase is unable to unlock current key, so the passphrase has been deleted and you need to unlock the key manually."),
    keyChanged: key0("Key changed."),
    keyRelocked: key0("Key re-locked."),
    noActiveFolder: key0("No active folder"),
    noKeyForCurrentFolder: key0("No key for current folder"),
    enableSecurelyPassphraseCacheNotice: key0("GPG Indicator come with passphrase cache feature, would you like to enable this feature?"),
    enableSecurelyPassphraseCacheNoticeForbidden: key0("OK, you can configure it later in setting."),
    enableSecurelyPassphraseCacheNoticeAgreed: key0("OK, this feature has been enabled, you can configure it later in setting."),
};


/** Formatter models the translator function like `vscode.l10n.t`.*/
export interface Translate {
    (message: string, ...args: Array<string>): string
}

/** WithTranslator models a string key (with potential arguments) for translation. */
export interface WaitTranslate {
    (translate: Translate): string
}

export interface Take0 {
    (): WaitTranslate
}

export interface Take1 {
    (arg0: string): WaitTranslate
}

export interface Take2 {
    (arg0: string, arg1: string): WaitTranslate
}

export interface Take3 {
    (arg0: string, arg1: string, arg2: string): WaitTranslate
}

function ensure(predicate: boolean): void {
    if (!predicate) {
        throw new Error("invalid key message.");
    }
};

export function key0(message: string): Take0 {
    ensure(message.indexOf('{0}') === -1);
    ensure(message.indexOf('{1}') === -1);
    ensure(message.indexOf('{2}') === -1);

    return () => {
        return (translate: Translate) => translate(message);
    };
}

export function key1(message: string): Take1 {
    ensure(message.indexOf('{0}') !== -1);
    ensure(message.indexOf('{1}') === -1);
    ensure(message.indexOf('{2}') === -1);

    return (arg0: string) => {
        return (translate: Translate) => translate(message, arg0);
    };
}

export function key2(message: string): Take2 {
    ensure(message.indexOf('{0}') !== -1);
    ensure(message.indexOf('{1}') !== -1);
    ensure(message.indexOf('{2}') === -1);

    return (arg0: string, arg1: string) => {
        return (translate: Translate) => translate(message, arg0, arg1);
    };
}

export function key3(message: string): Take3 {
    ensure(message.indexOf('{0}') !== -1);
    ensure(message.indexOf('{1}') !== -1);
    ensure(message.indexOf('{2}') !== -1);

    return (arg0: string, arg1: string, arg2: string) => {
        return (translate: Translate) => translate(message, arg0, arg1, arg2);
    };
}

