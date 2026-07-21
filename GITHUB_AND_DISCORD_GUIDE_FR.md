# Building OSSM HereSphere from source

This repository contains the complete source used for the `v0.1.8-rc4` Windows release.

## Requirements

- Windows 10 or Windows 11, x64
- Node.js with npm available in `PATH`
- Internet access during dependency installation and Electron packaging

Node.js and npm are required only to build or run the source tree. They are not required by users of the packaged installer.

## Verify the source tree

From a Command Prompt or PowerShell opened in the repository folder:

```powershell
npm.cmd run check
```

The expected result is:

```text
Verification of project V0.1.8 RC4: OK
```

The checker validates the expected project structure and the frozen motor-core hashes.

## Run from source

The convenience script is:

```text
INSTALL_AND_RUN_SOURCE.bat
```

Equivalent commands:

```powershell
npm.cmd install --no-audit --no-fund
npm.cmd run check
npm.cmd run start
```

## Build the Windows installer

Run:

```text
BUILD_INSTALLER.bat
```

The script:

1. uses the public npm registry;
2. installs the exact dependency tree from `package-lock.json`;
3. runs the project checks;
4. builds the Windows x64 NSIS installer;
5. creates a SHA-256 checksum file.

Expected output files:

```text
dist\OSSM-HereSphere-Setup-0.1.8-x64.exe
dist\OSSM-HereSphere-Setup-0.1.8-x64.exe.sha256.txt
```

## Packaging notes

- The current release is unsigned.
- `signAndEditExecutable` is disabled because this release does not use a signing certificate or custom executable resources.
- The installer may therefore trigger a Windows SmartScreen warning.
- Builds are based on fixed npm package versions, but installer files are not guaranteed to be byte-for-byte identical across machines because packaging metadata and timestamps can vary.

## Source layout

```text
src/main/       Electron main process, HereSphere discovery, settings and logs
src/renderer/   Interface, BLE control, scheduler and translations
scripts/        Project verification
package.json    Application metadata and Electron Builder configuration
package-lock.json  Exact dependency versions and integrity hashes
```
