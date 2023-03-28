import type * as vscode from 'vscode';
import type { VscodeOutputLogger } from '../logger';

import AbstractObjectStorage, { StorageObject } from './AbstractObjectStorage';

export default class MementoObjectStorage extends AbstractObjectStorage {
    constructor(private storageUtility: vscode.Memento, protected logger: VscodeOutputLogger) {
        super();
    }
    protected async _getAll(): Promise<StorageObject> {
        return await this.storageUtility.get(this.key) || {};
    }
    protected async _setStorage(storage: StorageObject): Promise<void> {
        await this.storageUtility.update(this.key, storage);
    }
}
