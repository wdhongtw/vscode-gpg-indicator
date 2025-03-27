# Change Log

All notable changes to the "gpg-indicator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.7.5] - 2025-03-27
### Fixed
- Fix incorrect blocking wait behavior on output-only message box
- Remove incorrect message box when unlock operation fail

## [0.7.4] - 2025-03-22
### Added
- Support Japanese localization
### Changed
- Several simplification around user messages
### Fixed
- More robust support for key ID format

## [0.7.3] - 2025-01-16
### Added
- Add experimental support for TCP-based agent connection
- Add tests to enhance development experience
### Changed
- Adopt inversion of control for core business logic
### Fixed
- Fix parsing logic for different favor of line break sequence
- Correct the lock releasing logic in our mutex implementation

## [0.7.2] - 2023-08-27
### Fixed
- Fix a bug which breaks the passphrase cache function

## [0.7.1] - 2023-04-30
### Changed
- Shorten one configuration ID

## [0.7.0] - 2023-04-30
### Added
- Adopt `SecreteStore` API to store passphrase for key
- Support more key format in status bar
- Support i18n and l10n for setting descriptions and messages.
- Support untrusted workspace by only check user home folder.


## [0.6.2] - 2022-10-30
### Fixed
- Support trailing exclamation mark in singing key ID


## [0.6.1] - 2022-03-09
### Added
- Add options to control output log level
### Changed
- Passphrase no longer shows up in extension output panel
### Fixed
- Support passphrases which contain `%` character
- Use correct folder string representation on Windows


## [0.6.0] - 2022-03-09
### Changed
- Remove the binary tool dependency of `expect`


## [0.5.0] - 2021-10-30
### Added
- Support multi-root workspace.
- Expose refresh interval as a configurable value for user.
- Add unlock command as an activation event.
### Changed
- Upgrade development dependencies and npm lock file version.
### Fixed
- Check key status before unlocking, avoiding error message.


## [0.4.0] - 2021-09-12
### Added
- Unlock key through palette command
- Output channel for basic logging
### Fixed
- Key event equality checking

## [0.3.5] - 2021-08-15
### Fixed
- Fix some dependency issues

## [0.3.4] - 2021-03-08
### Fixed
- Fix packaging issue which breaks version 0.3.3

## [0.3.3] - 2021-03-07
### Fixed
- Enhance the message of error of lacking expect tool

## [0.3.2] - 2020-12-01
### Fixed
- Remove the limitation of scope of Git configuration values

## [0.3.1] - 2020-11-20
### Added
- Add information message for unlock action

### Fixed
- Fix security issue

## [0.3.0] - 2020-07-30
### Added
- Design icon for this package

## [0.2.0] - 2020-07-26
### Added
- Unlock key by clicking the status bar element


## [0.1.0] - 2020-06-04
### Added
- Show whether the signing key is locked or not
