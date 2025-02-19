import * as util from 'util';

import * as core from '../core';

const exec = util.promisify(require('child_process').exec);
// exec with default utf-8 encoding always return stdout as string
// see: https://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback


export function fromGitBoolean(data: string): boolean {
    // see: https://git-scm.com/docs/git-config#Documentation/git-config.txt-boolean
    // empty string is hard to handle, ignore that case now

    data = data.toLowerCase();
    let result: boolean = false;
    switch (data) {
        case 'true':
        case 'yes':
        case 'on':
        case '1':
            result = true;
            break;
    }
    return result;
}

export async function getSigningKey(project: string): Promise<string> {
    try {
        // see: https://git-scm.com/docs/git-config#Documentation/git-config.txt-usersigningKey
        const { stdout } = await exec('git config --get user.signingKey', {
            cwd: project
        });

        let output: string = stdout;
        output = output.trimEnd();

        // Some Git/GPG context allow prepending '0x' to the key and appending exclamation mark to specify exact key match
        output = output.replace('0x', '').replace('!', '');
        return output;
    } catch (error) {
        throw new Error('Fail to get signing key');
    }
}

export async function isSigningActivated(project: string): Promise<boolean> {
    try {
        // see: https://git-scm.com/docs/git-config#Documentation/git-config.txt-commitgpgSign
        const { stdout } = await exec('git config --get commit.gpgSign', {
            cwd: project
        });

        let output: string = stdout;
        output = output.trimEnd();
        return fromGitBoolean(output);
    } catch (error) {
        throw new Error('Fail to test whether signing is activated');
    }
}

export class CliGit implements core.GitAdapter {

    async getSigningKey(project: string): Promise<string> {
        return await getSigningKey(project);
    }

    async isSigningActivated(project: string): Promise<boolean> {
        return await isSigningActivated(project);
    }
}
