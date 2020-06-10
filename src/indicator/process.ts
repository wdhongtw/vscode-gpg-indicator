
import * as child from 'child_process';

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

export function textSpawn(command: string, args: Array<string>, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let proc = child.spawn(command, args);

        proc.stdin.on('error', reject);
        proc.stdin.write(input, 'utf8');
        proc.stdin.end();

        // setEncoding to force 'data' event returns string
        // see: https://nodejs.org/api/stream.html#stream_readable_setencoding_encoding
        let output: string;
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (data) => {
            output = data;
        });
        proc.stderr.setEncoding('utf8');
        let error_message: string;
        proc.stderr.on('data', (data) => {
            error_message = data;
        });

        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Command execution failed, return code: ${code}, stderr: ${error_message}`));
            }
            resolve(output);
        });
    });
}
