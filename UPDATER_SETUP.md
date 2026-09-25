# Valora Automatic Updates

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
