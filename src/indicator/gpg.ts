import * as process from './process';
import * as tempfile from './tempfile';
import * as lookpath from 'lookpath';

export interface GpgKeyInfo {
    type: string;
    capabilities: string;
    fingerprint: string;
    keygrip: string;
}

/**
 * Parse lots GPG key information from gpg command
 *
 * @param rawText - output string from gpg --fingerprint --fingerprint --with-keygrip
 */
function parseGpgKey(rawText: string): Array<GpgKeyInfo> {
    let pattern: RegExp = /(pub|sub)\s+\w+.*\[(.)*\]\n((?:\s*\w+)*)\n\s+Keygrip\s=\s(\w+)/g;
    // group 1: pub or sub, 2: ability (E S C A), 3: fingerprint with spaces 4. keygrip

    let infos: Array<GpgKeyInfo> = [];
    let matched: RegExpExecArray | null;
    while ((matched = pattern.exec(rawText)) !== null) {
        let fingerprint = matched[3].replace(/\s+/g, '');
        let info = {
            type: matched[1],
            capabilities: matched[2],
            fingerprint: fingerprint,
            keygrip: matched[4],
        };
        infos.push(info);
    }

    return infos;
}


export async function isKeyUnlocked(keygrip: string): Promise<boolean> {
    let outputs = await process.textSpawn('gpg-connect-agent', [], `KEYINFO ${keygrip}`);

    let lines = outputs.split("\n");
    if (lines.length === 1) {
        throw new Error(lines[0]);
    }
    // second line is OK
    // Sample: S KEYINFO CB18328AD05158F97CC8F33682F7AD291F52CB08 D - - - P - - -
    let line = lines[0];
    let tokens = line.split(' ');
    if (tokens.length !== 11) {
        throw new Error('Fail to parse KEYINFO output');
    }

    let isUnlocked = tokens[6] === '1';
    return isUnlocked;
}

export async function isKeyIdUnlocked(keyId: string): Promise<boolean> {
    // --fingerprint flag is give twice to get fingerprint of subkey
    let keyInfoRaw: string = await process.textSpawn('gpg', ['--fingerprint', '--fingerprint', '--with-keygrip'], '');
    let infos = parseGpgKey(keyInfoRaw);

    for (let info of infos) {
        // GPG signing key is usually given as shorter ID
        if (info.fingerprint.includes(keyId)) {
            return isKeyUnlocked(info.keygrip);
        }
    }

    throw new Error(`Can not find key with ID: ${keyId}`);
}

/**
 * Get key information of given ID of GPG key.
 *
 * Caller should cache the results from this function whenever possible.
 *
 * @param keyId - ID of the GPG key
 * @returns key information
 */
export async function getKeyInfo(keyId: string): Promise<GpgKeyInfo> {
    // --fingerprint flag is give twice to get fingerprint of subkey
    let keyInfoRaw: string = await process.textSpawn('gpg', ['--fingerprint', '--fingerprint', '--with-keygrip'], '');
    let infos = parseGpgKey(keyInfoRaw);

    for (let info of infos) {
        // GPG signing key is usually given as shorter ID
        if (info.fingerprint.includes(keyId)) {
            return info;
        }
    }

    throw new Error(`Can not find key with ID: ${keyId}`);
}

export async function unlockByKeyId(keyId: string, passphrase: string): Promise<void> {
    // Check existence before spawn, because NodeJS runtime doesn't provide a elegant
    // interface to report this kind of failure.
    // Here we chose lookpath package as it doesn't spawn new process for the checking task.
    let path: string | undefined;
    path = await lookpath.lookpath('expect');
    if (path === undefined) {
        throw new Error(`can not find the expect tool`);
    }

    let document: tempfile.TempTextFile | undefined;
    let signature: tempfile.TempTextFile | undefined;

    try {
        document = new tempfile.TempTextFile();
        signature = new tempfile.TempTextFile();
        await document.create();
        await signature.create();

        const expectCommand =
            `spawn gpg --clear-sign --pinentry-mode loopback --local-user ${keyId} ` +
            `--output ${signature.filePath} ${document.filePath}\n` +
            `expect "*Overwrite? (y/N)*"\n` +
            `send "y\\r"\n` +
            `expect "*Enter passphrase:*"\n` +
            `send "${passphrase}\\r"\n` +
            `set result [lindex [wait] 3]\n` +
            `exit $result\n`;

        await process.textSpawn('expect', [], expectCommand);
    } catch (err) {
        if (err instanceof process.ProcessError) {
            throw new Error('the given passphrase may be wrong');
        } else {
            throw err;
        }
    } finally {
        signature?.dispose();
        document?.dispose();
    }
    // gpg can signed the document even if the document is empty

}

