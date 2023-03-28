import type * as vscode from 'vscode';
import type { VscodeOutputLogger } from '../logger';

import AbstractObjectStorage, { StorageObject } from './AbstractObjectStorage';

export default class SecretObjectStorage extends AbstractObjectStorage {
    constructor(private storageUtility: vscode.SecretStorage, protected logger: VscodeOutputLogger) {
        super();
    }
    protected async _getAll(): Promise<StorageObject> {
        return JSON.parse(await this.storageUtility.get(this.key) || "{}");
    }
    protected async _setStorage(storage: StorageObject): Promise<void> {
        await this.storageUtility.store(this.key, JSON.stringify(storage));
    }
}
