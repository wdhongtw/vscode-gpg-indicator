# GPG Key Status Indicator for VS Code

Show the status of the GPG signing key for your project!

## Features

This extension will show the status of GPG signing key in status bar if

- The project folder has set `commit.gpgSign` as `true` for git, and
- The project folder has set `user.signingKey` with GPG key ID for git

If the above condition are satisfied, there will be an indicator for your current
signing key, together with a cute icon to tell whether the key is unlocked or not.

**Note**: currently the extension only support first folder in workspace.

## Requirements

- Linux environment (It's not been tested on other platform)
- GPG tool chain (`gpg`, `gpg-agent`, `gpg-connect-agent`) above 2.1

## Extension Settings

Currently there is no setting available.

## Known Issues

Multi-folder workspace is not supported yet.

## Release Notes

### 0.1.0

Initial release. User can check the status of project signing key.
