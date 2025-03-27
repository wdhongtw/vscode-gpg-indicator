# GPG Key Status Indicator and Unlocker for VS Code

Show the status of the GPG signing key for your project!

You can also also unlock the key by clicking the status bar element. :D

![stats bar sample](./images/status-bar.png)

Or unlock the key through command palette.

![unlock command sample](./images/unlock-key-command.png)

## Features

This extension will show the status of GPG signing key in status bar if your local
`.git/config` or any other default `.gitconfig` configuration file (e.g. `~/.gitconfig`):

- has set `commit.gpgSign` as `true` for git, and
- has set `user.signingKey` with GPG key ID for git

If the above conditions are both satisfied, there will be an indicator for your current
signing key, together with a cute icon to tell whether the key is unlocked or not.

When you click the indicator, you will be prompted for passphrase to unlock the key.

### Passphrase Cache

Since [VS Code 1.53](https://code.visualstudio.com/updates/v1_53#_secrets-api), the
[`SecretStorage` API](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.secrets)
is introduced to provide a secure and persistent storage for secrets.
With this API, this extension can maintain passphrase cache for user.

You can enable the `gpgIndicator.enablePassphraseCache` option to opt-in, if so
your passphrase will be cached in the secret storage once you unlock your key.

After that, your key will be unlocked automatically whenever this extension is enabled.

You can list or delete your cached passphrase by command anytime.
When you disable the passphrase-cache option, the whole cache will be cleared.

## Requirements

- Linux (including WSL) or Windows. (Not tested in macOS, but should work.)
- GPG tool chain (`gpg`, `gpg-agent`, `gpg-connect-agent`) above 2.1

## Issues & Reviews

[Submit a issue](https://github.com/wdhongtw/vscode-gpg-indicator/issues) if you found any problem.

And please leave a comment in
[review page](https://marketplace.visualstudio.com/items?itemName=wdhongtw.gpg-indicator&ssr=false#review-details)
if you like this extension!! 😸

## Extension Settings

- `gpgIndicator.statusRefreshInterval`
  - The interval of background key status refresh loop, in seconds. Default to `30`.
- `gpgIndicator.outputLogLevel`
  - The log level for extension log output. Default to `"info"`.
- `gpgIndicator.enablePassphraseCache`
  - Specifies whether to store your passphrase or not. Default to `false`.
- `gpgIndicator.statusStyle`
  - Specifies how to show the current key in the status bar. Default to `"userId"` (Example: `0123456789ABCDEF - Example User <example@example.com>`).

## Known Issues

See issue page on GitHub if interested.

## FAQ

### How to get the key ID of my signing key?

The key ID of the signing key can be retrieved by the command
`gpg --list-keys --keyid-format long` .

Locate the key with singing capability (the `S` flag in square brackets),
and the key ID is the hex string after the algorithm identifier.

## Contributors

- `wdhongtw`
- `kitos9112`
- `altjx`
- `AnnAngela`
- `mptr`
- `Fledra`
- `MocA-Love`

## Release Notes

### 0.7.5

Fix critical bug which breaks version 0.7.4

### 0.7.4

Japanese support, enhancements and library refactoring.

### 0.7.3

Experimental support for Windows and minor bug fixes.

### 0.7.2

Fix a bug which breaks the passphrase cache function.

### 0.7.1

Minor adjustment about config ID and message wording.

### 0.7.0

Adopt `SecreteStore` API to store passphrase for key, if user enabled the feature.
And add more format for key in status bar.

Also i18n/l10n and untrusted workspace is supported.

### 0.6.2

Allow trailing exclamation mark in signing key ID in Git configuration file.

### 0.6.1

Fix bug for passphrases which contain `%` character and some file system path.

### 0.6.0

Finally, remove the dependency of the binary tool, `expect`. :D

### 0.5.0

Support multi-root workspace and let user adjust status refresh interval.

### 0.4.0

Unlock key through command palette directly (by MatthewCash), and minor bug fix.

### 0.3.5

Fix some dependency issues

### 0.3.4

Fix packaging issue which breaks version 0.3.3

### 0.3.3

Enhance the message of error of lacking `expect` tool

### 0.3.2

Remove the limitation of scope of Git configuration values.

### 0.3.1

Add message for unlock action and fix security issue.

### 0.3.0

Design and add icon for this package.

### 0.2.0

User can unlock the key by clicking the status bar element.

### 0.1.0

Initial release. User can check the status of project signing key.
