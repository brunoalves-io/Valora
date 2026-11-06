# Valora Automatic Updates

## Local development and startup configuration

The updater is optional at startup. The repository's `tauri.conf.json` intentionally
does not contain a placeholder `plugins.updater` configuration. The release workflow
populates that block when bundling signed releases.

Previously, Rust registered the updater unconditionally. With the block absent,
Tauri supplied `null` to the plugin's required `Config`, causing startup to fail
before `check_for_update` could return its disabled state.

Rust now validates the compile-time `VALORA_UPDATER_PUBLIC_KEY` and
`VALORA_UPDATER_ENDPOINT` before registering the plugin. The public key must decode
as a Tauri/base64-encoded Minisign public key; the endpoint must be HTTPS, have a
host, and contain no URL credentials. The validation uses the same `base64` and
`minisign-verify` crates already present transitively in the updater dependency tree.
No new crate packages were introduced.

When either value is absent or invalid, Rust skips plugin registration and logs an
explicit disabled message. `check_for_update` continues returning `enabled: false`,
`available: false`, the current version, and `version: null`; `install_update`
continues returning its existing not-enabled error. The frontend contract is unchanged.

When both values are valid, Rust supplies the plugin configuration before startup
deserialization, preserving other release options. Existing update checking,
signature verification and `download_and_install` remain in use. No keys or
endpoints are fabricated and no signature or TLS checks are disabled.

These variables are compiled into the executable (`option_env!`): set them in the
build process environment and rebuild when configuring a real release. A running
development executable does not become update-enabled by changing runtime variables.

Validation on Windows (06/11/2026): frontend build passed; three Rust unit tests
passed (missing/malformed configuration, insecure endpoints, and a public test-vector
key with HTTPS). `npm.cmd run tauri:dev` compiled and ran without the updater panic,
logging the disabled state. Windows process inspection confirmed a responsive
`valora.exe` with native window title `Valora` and a nonzero window handle.
Visual inspection through the Computer Use runtime was unavailable because its
Node runtime failed to start. Real signed-update download/installation was not
executed: no production signing credentials were supplied or fabricated.

The existing `scripts/verify-refinement.mjs` suite also passed with fixture-only
data, no captured JavaScript errors and no external hosts. Its artifacts are in
`%TEMP%\valora-phase1-qa-A3D1Gq`.
`git diff --check` passed. The frontend build retains its existing large-bundle warning.

The automatic updater foundation is implemented in this branch.

## Security requirement

Tauri requires every update artifact to be cryptographically signed. This validation cannot be disabled.

Generate the updater key pair on a trusted computer:

```powershell
npm run tauri signer generate -- -w "$HOME\.tauri\valora.key"
```

Keep the private key outside the repository and backed up securely. Losing it prevents existing installations from trusting future updates.

## GitHub configuration

Add these repository settings:

### Actions variable

- `VALORA_UPDATER_PUBLIC_KEY`: contents of the generated public key.

### Actions secrets

- `TAURI_SIGNING_PRIVATE_KEY`: contents of the private signing key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password chosen when generating the key.

The application already compiles the public key and update endpoint into the desktop build when the variable is present.

## Update endpoint

Stable builds check:

`https://github.com/brunoalves-io/Valora/releases/latest/download/latest.json`

The next implementation step after the keys are configured is to enable `createUpdaterArtifacts` for stable builds and publish the signed NSIS artifact plus `latest.json` with each versioned release.

Official reference: https://v2.tauri.app/plugin/updater/


## Configuration status

The GitHub Actions variable and signing secrets have now been created.

The workflow publishes:
- the Windows NSIS installer;
- its Tauri `.sig` signature;
- a static `latest.json` updater manifest.

Stable installations use the latest non-prerelease GitHub Release through the configured endpoint. Preview and release-candidate builds also publish signed updater assets for validation, but they do not become the stable update channel.
