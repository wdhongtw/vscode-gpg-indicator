import type { VscodeOutputLogger } from '../logger';
import locker from '../indicator/locker';

export type StorageValue = string | boolean | number;

export type StorageObject = Record<string, StorageValue>;

export default abstract class AbstractObjectStorage {
    protected key = "gpg-indicator-storage_" + this.constructor.name; // DON'T CHANGE IT AFTER V0.7

    protected abstract logger: VscodeOutputLogger;
    protected abstract _getAll(): Promise<StorageObject>;
    protected abstract _setStorage(storage: StorageObject): Promise<void>;

    async getAll(): Promise<StorageObject> {
        return await locker.acquire(this.key, async (release) => {
            try {
                release(undefined, await this._getAll());
            } catch (e) {
                release(e as any);
            }
        });
    }
    protected async setStorage(storage: StorageObject): Promise<void> {
        await locker.acquire(this.key, async (release) => {
            try {
                await this._setStorage(storage);
                release();
            } catch (e) {
                this.logger.error(`Cannot set the raw data to ${this.constructor.name}: ${e instanceof Error ? e.message : JSON.stringify(e, null, 4)}`);
                release(e as any);
            }
        });
    }
    async get(key: string): Promise<StorageValue | undefined> {
        return (await this.getAll())[key];
    }
    async set(key: string, value: StorageValue): Promise<void> {
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
    async clear(): Promise<void> {
        await this.setStorage({});
    }
    async keys(): Promise<string[]> {
        return Object.keys(await this.getAll());
    }
    async values(): Promise<StorageValue[]> {
        return Object.values(await this.getAll());
    }
    async entries(): Promise<[string, StorageValue][]> {
        return Object.entries(await this.getAll());
    }
}
