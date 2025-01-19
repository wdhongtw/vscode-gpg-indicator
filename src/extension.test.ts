import * as vscode from 'vscode';
import * as assert from 'assert';

import * as extension from './extension';
import * as core from './manager';

class FakeCipher implements extension.Cipher {
    constructor() { }

    public async encrypt(plainText: string): Promise<extension.EncryptedData> {
        return { algTag: 'copy', text: plainText };
    }

    public async decrypt(data: extension.EncryptedData): Promise<string> {
        if (data.algTag !== 'copy') { throw new Error('unexpected algorithm tag'); }
        return data.text;
    }
}

// A fake Memento since that it's not easy to get a Memento from vscode context.
class FakeMemento implements vscode.Memento {
    private storage: { [key: string]: any } = {};

    constructor() { }

    public keys(): readonly string[] {
        return Object.keys(this.storage);
    }

    public get<T>(key: string, defaultValue?: T): T | undefined {
        return this.storage[key] || defaultValue;
    }

    public async update(key: string, value: any): Promise<void> {
        this.storage[key] = value;
    }
}

suite('ExtensionTestSuite', () => {

    suite('Extension', () => {

        test('should be able active the extension', async () => {
            // see package.json
            const extensionId = 'wdhongtw.gpg-indicator';

            const extension = vscode.extensions.getExtension(extensionId);
            if (!extension) {
                assert.fail('Extension not found');
            }

            await extension.activate();
            assert.strictEqual(extension.isActive, true);
        });
    });

    suite('PassphraseStorage', () => {
        const storage = new extension.PassphraseStorage(
            new FakeCipher(),
            new core.DummyLogger(),
            new FakeMemento(),
        );

        test('should store and retrieve a passphrase', async () => {
            await storage.set('key-01', 'passphrase-01');
            await storage.set('key-02', 'passphrase-02');

            assert.strictEqual(await storage.get('key-01'), 'passphrase-01');
            assert.strictEqual(await storage.get('key-02'), 'passphrase-02');
        });
        test('should return undefined for a missing passphrase', async () => {

            assert.strictEqual(await storage.get('missing-key'), undefined);
        });
        test('should return undefined for deleted record', async () => {
            await storage.set('key-01', 'passphrase-01');
            await storage.delete('key-01');

            assert.strictEqual(await storage.get('key-01'), undefined);
        });
    });

    suite('AesGcmCipher', () => {
        const fakeMasterKey = 'cb1898b650770d92f4225bf3afe13f854f4ad19ed59a93894cf4dfb624a92ef8';
        const cipher = new extension.AesGcmCipher(fakeMasterKey);

        test('should encrypt and decrypt a string', async () => {
            const plainText = 'hello, world!';

            const encrypted = await cipher.encrypt(plainText);
            const decrypted = await cipher.decrypt(encrypted);

            assert.strictEqual(decrypted, plainText);
        });
        test('should reject invalid cipher text', async () => {
            try {
                await cipher.decrypt({ algTag: 'wrong-tag', text: 'not-care' });
                assert.fail('should have thrown an error');
            } catch (error) {
                // we don't really care about the type of error here.
            }

            try {
                await cipher.decrypt({ algTag: 'aes-256-gcm', text: 'broken-encrypted-data' });
                assert.fail('should have thrown an error');
            } catch (error) {
                // we don't really care about the type of error here.
            }
        });
    });
});
