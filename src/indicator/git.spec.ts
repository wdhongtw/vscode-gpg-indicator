import * as assert from 'assert';

import * as git from './git';

describe('git', () => {
    describe('fromGitBoolean', () => {
        it('should return true for "true", "yes", "on", "1"', () => {
            assert.strictEqual(git.fromGitBoolean('true'), true);
            assert.strictEqual(git.fromGitBoolean('yes'), true);
            assert.strictEqual(git.fromGitBoolean('on'), true);
            assert.strictEqual(git.fromGitBoolean('1'), true);
        });
        it('should return false for all other values', () => {
            assert.strictEqual(git.fromGitBoolean('false'), false);
            assert.strictEqual(git.fromGitBoolean('no'), false);
            assert.strictEqual(git.fromGitBoolean('off'), false);
            assert.strictEqual(git.fromGitBoolean('0'), false);
            assert.strictEqual(git.fromGitBoolean(''), false);
        });
    });
});
