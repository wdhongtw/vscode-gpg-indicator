import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * TempTextFile rely on NodeJS mkdtemp
 *
 * Note: This object need to call create() before use.
 *
 * NodeJS do not provide something likes mktemp or mkstemp.
 * Use mkdtemp and create single file within the temporary folder
 */
export class TempTextFile {
    #filePath?: string;
    #folderPath?: string;

    constructor() {
    }

    async create(): Promise<void> {
        try {
            this.#folderPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'indicator-'));
            this.#filePath = path.join(this.#folderPath, 'some-file');
            // Ensure this is created by us.
            const flag = fs.constants.O_CREAT | fs.constants.O_EXCL;
            const handle = await fs.promises.open(this.#filePath, flag, 0o600);
            await handle.close();
        } catch (err) {
            if (this.#filePath) { await fs.promises.unlink(this.#filePath); }
            if (this.#folderPath) { await fs.promises.rmdir(this.#folderPath); }
            throw err;
        }
    }

    async read(): Promise<string> {
        if (!this.#filePath) { throw new Error('File not created yet'); }

        let handle: fs.promises.FileHandle | undefined = undefined;
        try {
            handle = await fs.promises.open(this.#filePath, 'r');
            return await handle.readFile('utf8');
        } finally {
            handle?.close();
        }
    }

    async write(content: string): Promise<void> {
        if (!this.#filePath) { throw new Error('File not created yet'); }

        let handle: fs.promises.FileHandle | undefined = undefined;
        try {
            handle = await fs.promises.open(this.#filePath, 'w');
            return await handle.writeFile(content, 'utf8');
        } finally {
            handle?.close();
        }
    }

    get filePath(): string {
        if (!this.#filePath) { throw new Error('File not created yet'); }

        return this.#filePath;
    }

    /**
     * Delete the temporary file together with the containing folder
     */
    async dispose(): Promise<void> {
        if (this.#filePath) { await fs.promises.unlink(this.#filePath); }
        if (this.#folderPath) { await fs.promises.rmdir(this.#folderPath); }
    }
}
