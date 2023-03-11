import * as vscode from 'vscode';
import type { VscodeOutputLogger } from './logger';
import locker from './indicator/locker';

export type SecretStorageValue = string | boolean | number;

export type SecretObject = Record<string, SecretStorageValue>;

export default class SecretObjectStorage {
    protected key = "gpg-indicator-storage";
    constructor(private secretStorage: vscode.SecretStorage, private logger: VscodeOutputLogger) { }
    private async setStorage(storage: SecretObject): Promise<void> {
        await locker.acquire("SecretStorage_" + this.key, async (release) => {
            try {
                await this.secretStorage.store(this.key, JSON.stringify(storage));
                release();
            } catch (e) {
                this.logger.error(`Cannot set the raw data to SecretStorage: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
                release(e as any);
            }
        });
    }
    async get(key: string): Promise<SecretStorageValue | undefined> {
        return (await this.getAll())[key];
    }
    async set(key: string, value: SecretStorageValue): Promise<void> {
        const storage = await this.getAll();
        storage[key] = value;
        await this.setStorage(storage);
    }
    async has(key: string): Promise<boolean> {
        return Reflect.has(await this.getAll(), key);
    }
    async delete(key: string): Promise<void> {
        const storage = await this.getAll();
        Reflect.deleteProperty(storage, key);
        await this.setStorage(storage);
    }
    async getAll(): Promise<SecretObject> {
        const raw = await locker.acquire("SecretStorage_" + this.key, async (release) => {
            try {
                release(undefined, await this.secretStorage.get(this.key) || "{}");
            } catch (e) {
                release(e as any);
            }
        });
        try {
            return JSON.parse(raw as string);
        } catch (e) {
            this.logger.error(`Cannot parse the raw data from SecretStorage: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
            this.logger.error(`Raw data: ${raw}`);
            return {};
        }
    }
    async clear(): Promise<void> {
        await this.setStorage({});
    }
}
