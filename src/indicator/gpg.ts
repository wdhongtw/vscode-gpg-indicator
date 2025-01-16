import * as process from './process';
import * as assuan from './assuan';

import type { Logger } from '../manager';
import * as core from '../manager';

/**
 * Get the path of socket file for communication with GPG agent.
 *
 * @returns The path of desired GPG agent socket.
 */
async function getSocketPath(): Promise<string> {
    // TODO: Consider supporting other socket files rather than the default one.
    const outputs = await process.textSpawn('gpgconf', ['--list-dir', 'agent-socket'], "");

    return outputs.trim();
}

/**
 * Sign the given hash string with the specified GPG key.
 *
 * @param logger - The logger object for debugging logs.
 * @param socketPath - The path of socket file to communicated with GPG agent.
 * @param keygrip - The keygrip of the GPG key for the signing operation.
 * @param passphrase - The passphrase of the key.
 * @param sha1Hash - The hash string to be signed.
 */
async function sign(logger: Logger, socketPath: string, keygrip: string, passphrase: string, sha1Hash: string): Promise<void> {
    let response: assuan.Response;

    const agent = await assuan.buildAgent(socketPath);
    logger.info("[Assuan] Initialize Assuan client");
    await agent.initialize();
    try {
        response = await agent.receiveResponse();
        response.checkType(assuan.ResponseType.ok);

        logger.info("[Assuan] Set pinentry-mode loopback");
        await agent.sendRequest(assuan.Request.fromCommand(new assuan.RequestCommand('OPTION', 'pinentry-mode loopback')));
        response = await agent.receiveResponse();
        response.checkType(assuan.ResponseType.ok);

        logger.info(`[Assuan] Specifying keygrip: ${keygrip}`);
        await agent.sendRequest(assuan.Request.fromCommand(new assuan.RequestCommand('SIGKEY', keygrip)));
        response = await agent.receiveResponse();
        response.checkType(assuan.ResponseType.ok);

        logger.info("[Assuan] Set hash value for singing");
        await agent.sendRequest(assuan.Request.fromCommand(new assuan.RequestCommand('SETHASH', `--hash=sha1 ${sha1Hash}`)));
        response = await agent.receiveResponse();
        response.checkType(assuan.ResponseType.ok);

        logger.info("[Assuan] Launch the signing operation");
        await agent.sendRequest(assuan.Request.fromCommand(new assuan.RequestCommand('PKSIGN')));
        response = await agent.receiveResponse();
        let type = response.getType();
        if (type === assuan.ResponseType.rawData) { // Key is already unlocked
            logger.info("[Assuan] Key is already unlocked");
            response = await agent.receiveResponse();
            response.checkType(assuan.ResponseType.ok);
        } else if (type === assuan.ResponseType.information) { // S INQUIRE_MAXLEN 255, key is locked
            logger.info("[Assuan] Got information message, key is still locked");
            response = await agent.receiveResponse();
            response.checkType(assuan.ResponseType.inquire); // INQUIRE PASSPHRASE
            logger.info("[Assuan] Send the pass phrase");
            await agent.sendRequest(assuan.Request.fromRawData(new assuan.RequestRawData(Buffer.from(passphrase))));
            await agent.sendRequest(assuan.Request.fromCommand(new assuan.RequestCommand('END')));
            response = await agent.receiveResponse();
            response.checkType(assuan.ResponseType.rawData);
            logger.info("[Assuan] Receive signed message");
            response = await agent.receiveResponse();
            response.checkType(assuan.ResponseType.ok);
        } else {
            throw new Error('unhandled signing flow');
        }

        logger.info("[Assuan] Singing process done, pass phrase kept by the agent");
        await agent.sendRequest(assuan.Request.fromCommand(new assuan.RequestCommand('BYE')));
        response = await agent.receiveResponse();
        response.checkType(assuan.ResponseType.ok);
    } catch (err) {
        logger.warn(`[Assuan] Something wrong in the process: ${err}`);
        throw err;
    } finally {
        logger.info("[Assuan] Destroy Assuan client");
        agent.dispose();
    }
}

/**
 * Parse lots GPG key information from gpg command
 *
 * @param rawText - output string from gpg --fingerprint --fingerprint --with-keygrip --with-colon
 */
export function parseGpgKey(rawText: string): Array<core.GpgKeyInfo> {
    /**
     * group 1: pub or sub, 2: ability (E S C A), 3: fingerprint 4. keygrip
     * For more information, see https://git.gnupg.org/cgi-bin/gitweb.cgi?p=gnupg.git;a=blob_plain;f=doc/DETAILS
     */
    let pattern: RegExp = /(pub|sub):(?:[^:]*:){10}([escaD?]+)\w*:(?:[^:]*:)*?\n(?:fpr|fp2):(?:[^:]*:){8}(\w*):(?:[^:]*:)*?\ngrp:(?:[^:]*:){8}(\w*):(?:[^:]*:)*?(?:\nuid:(?:[^:]*:){8}([^:]*):(?:[^:]*:)*?)?/g;

    // unify line break sequence, since that we need to match LF later.
    let sanitizedText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let infos: Array<core.GpgKeyInfo> = [];
    let matched: RegExpExecArray | null;
    while ((matched = pattern.exec(sanitizedText)) !== null) {
        let info: core.GpgKeyInfo = {
            type: matched[1],
            capabilities: matched[2],
            fingerprint: matched[3],
            keygrip: matched[4],
            userId: matched[5],
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
    const keyInfo = await getKeyInfo(keyId);

    return isKeyUnlocked(keyInfo.keygrip);
}

/**
 * Get key information of all GPG key.
 *
 * Caller should cache the results from this function whenever possible.
 *
 * @returns key information
 */

export async function getKeyInfos(): Promise<core.GpgKeyInfo[]> {
    /**
     * --fingerprint flag is given twice to get fingerprint of subkey
     * --with-colon flag is given to get the key information in a more machine-readable manner
     * For more information, see https://git.gnupg.org/cgi-bin/gitweb.cgi?p=gnupg.git;a=blob_plain;f=doc/DETAILS
     */
    let keyInfoRaw: string = await process.textSpawn('gpg', ['--fingerprint', '--fingerprint', '--with-keygrip', '--with-colon'], '');
    return parseGpgKey(keyInfoRaw);
}

/**
 * Get key information of given ID of GPG key.
 *
 * Caller should cache the results from this function whenever possible.
 *
 * @param keyId - ID of the GPG key
 * @param keyInfos - If caller already had the cache, the cache should be passed to avoid duplicated `getKeyInfos()`
 * @returns key information
 */
export async function getKeyInfo(keyId: string, keyInfos?: core.GpgKeyInfo[]): Promise<core.GpgKeyInfo> {
    for (let info of (Array.isArray(keyInfos) ? keyInfos : await getKeyInfos())) {
        // GPG signing key is usually given as shorter ID
        if (info.fingerprint.includes(keyId)) {
            return info;
        }
    }

    throw new Error(`Cannot find key with ID: ${keyId}`);
}

const SHA1_EMPTY_DIGEST = "da39a3ee5e6b4b0d3255bfef95601890afd80709";

/**
 * Unlock some key with the passphrase.
 *
 * @param logger - The logger for debugging information.
 * @param keygrip - The keygrip of the key to be unlocked
 * @param passphrase - The passphrase for the key.
 */
export async function unlockByKey(logger: Logger, keygrip: string, passphrase: string): Promise<void> {
    const socketPath = await getSocketPath();

    // Hash value is not important here, the only requirement is the length of the hash value.
    await sign(logger, socketPath, keygrip, passphrase, SHA1_EMPTY_DIGEST);
}

export class CliGpg implements core.GpgAdapter {

    constructor(
        private logger: Logger
    ) { }

    async isKeyUnlocked(keygrip: string): Promise<boolean> {
        return await isKeyUnlocked(keygrip);
    }

    async getKeyInfos(): Promise<core.GpgKeyInfo[]> {
        return await getKeyInfos();
    }

    async getKeyInfo(keyId: string, keyInfos?: core.GpgKeyInfo[]): Promise<core.GpgKeyInfo> {
        return await getKeyInfo(keyId, keyInfos);
    }

    async unlockByKey(keygrip: string, passphrase: string): Promise<void> {
        return await unlockByKey(this.logger, keygrip, passphrase);
    }
}
