
import * as child from 'child_process';


export function sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

class ProcessError extends Error {
    constructor(
        public command: string,
        public code: number,
        public message: string,
    ) {
        super(message);
    }
}

/**
 * Run specified command, with given input and return output(promise) in string
 *
 * @param command - executable name
 * @param args - options and arguments, executable name is not included
 * @param input - stdin
 * @returns The promise which resolve the stdout. Rejects if fail to run command or command returns not zero value.
 */
export function textSpawn(command: string, args: Array<string>, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = child.spawn(command, args);

        proc.stdin.on('error', reject);
        if (input) { proc.stdin.write(input, 'utf8'); }
        proc.stdin.end();

        // setEncoding to force 'data' event returns string
        // see: https://nodejs.org/api/stream.html#stream_readable_setencoding_encoding

        const results: Array<string> = [];
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('error', reject);
        proc.stdout.on('data', (data) => {
            results.push(data);
        });

        const errors: Array<string> = [];
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('error', reject);
        proc.stderr.on('data', (data) => {
            errors.push(data);
        });

        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new ProcessError(command, code !== null ? code : -1, errors.join('')));
            }
            resolve(results.join(''));
        });
    });
}
