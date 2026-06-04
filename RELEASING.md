# Releasing whim

## Quick Release

To publish a new version for both Mac and Windows:

```bash
# 1. Bump version in package.json
# 2. Commit, tag, and push
git add package.json
git commit -m "v0.1.0"
git tag v0.1.0
git push origin master --tags

# 3. Trigger the release workflow
gh workflow run release.yml --field tag=v0.1.0
```

The workflow builds, signs, and publishes both platforms in parallel directly to the [`patniko/whim`](https://github.com/patniko/whim/releases) repo's Releases page. The auto-updater (electron-updater) reads `latest-mac.yml` / `latest.yml` from there with no authentication required (the repo is public).

---

## Platform Details

### macOS

- **Signing**: Developer ID Application certificate (Patrick Nikoletich, YFVZ335843)
- **Notarization**: Automated via Apple notary service
- **Output**: `.dmg` installer + `.zip` for updater delta

The signing certificate and private key must be exported as a `.p12` and stored as a base64-encoded GitHub secret (see [Secrets](#github-secrets) below).

#### Local macOS build

```bash
npm run build:mac             # Unpacked app in build/mac-arm64/
npm run build:installer:mac   # Signed + notarized DMG in build/
```

For local notarized builds, set these env vars first:

```bash
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YFVZ335843"
```

To generate an app-specific password: https://account.apple.com/sign-in → Sign-In and Security → App-Specific Passwords.

### Windows

- **Signing**: Azure Artifact Signing (formerly Azure Trusted Signing)
- **No local certificates needed** — signing happens in the cloud
- **Output**: `.exe` NSIS installer
- **SmartScreen**: Immediate trust (no reputation building needed)

The signing config is in `package.json` under `build.win.azureSignOptions`.

#### Local Windows build

```bash
npm run build:win                       # Unpacked app in build/win-unpacked/
npm run build:installer:win             # Signed NSIS installer in build/
npm run build:installer:win:unsigned    # Unsigned NSIS installer (useful for local smoke tests)
```

For local signed builds on Windows, set these env vars first:

```bash
set AZURE_TENANT_ID=your-tenant-id
set AZURE_CLIENT_ID=your-client-id
set AZURE_CLIENT_SECRET=your-client-secret
```

---

## CI Release (GitHub Actions)

The `.github/workflows/release.yml` workflow runs on `workflow_dispatch` with a `tag` input. It runs two parallel jobs:

| Job | Runner | What it does |
|-----|--------|--------------|
| `release-mac` | `macos-latest` | Build, sign, notarize, publish DMG + ZIP + `latest-mac.yml` |
| `release-win` | `windows-2022` | Build, sign (Azure Artifact Signing), publish EXE + `latest.yml` |

Both jobs publish directly to `patniko/whim` using the default `GITHUB_TOKEN` — no PAT is required.

### GitHub Secrets

All values are stored as **Secrets** in Settings → Secrets and variables → Actions:

#### macOS signing & notarization

| Secret | Description |
|--------|-------------|
| `MACOS_CERTIFICATE` | Base64-encoded `.p12` export of the Developer ID certificate + private key |
| `MACOS_CERTIFICATE_PWD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_TEAM_ID` | `YFVZ335843` |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |

#### Windows signing (Azure Artifact Signing)

| Secret | Description |
|--------|-------------|
| `AZURE_TENANT_ID` | Microsoft Entra (Azure AD) Tenant ID |
| `AZURE_CLIENT_ID` | App Registration Application (Client) ID — not the Object ID |
| `AZURE_CLIENT_SECRET` | App Registration Client Secret **value** — not the Secret ID |

---

## Setup Reference

### macOS certificate export

The `.p12` must include both the certificate **and** private key:

```bash
# 1. Find your cert
security find-identity -v -p codesigning

# 2. Export from Keychain Access:
#    - Open Keychain Access
#    - Find "Developer ID Application: Patrick Nikoletich"
#    - Click the disclosure triangle (▶) to reveal the private key
#    - Select BOTH the certificate AND the private key (Shift+click)
#    - Right-click → Export Items → save as .p12 with a password
#    - If .p12 is grayed out, you haven't selected the private key

# 3. Base64-encode (single line, no newlines) and copy to clipboard
base64 -i certificate.p12 | tr -d '\n' | pbcopy

# 4. Paste into the MACOS_CERTIFICATE GitHub secret
```

### Azure Artifact Signing setup

The Azure resources are in the existing Azure subscription used for whim signing.

1. **Artifact Signing Account**: `whim`
   - Endpoint: `https://wus2.codesigning.azure.net/`
   - Location: West US 2

2. **Certificate Profile**: `nurturewhim`
   - Subject: `CN=Patrick Nikoletich, O=Patrick Nikoletich, L=Bothell, S=wa, C=US`
   - Type: Public Trust
   - The `publisherName` in `package.json` must match the CN exactly
   - The profile name (`nurturewhim`) is just an internal Azure identifier — not user-visible. It can be renamed later without affecting trust.

3. **App Registration (Entra ID)**: `whim`
   - This is the service principal used by CI to authenticate with Azure
   - Must have the **"Artifact Signing Certificate Profile Signer"** role on the Artifact Signing Account
   - Role is assigned via: Artifact Signing Account → Access Control (IAM) → Add role assignment
   - Search for the app registration by name ("whim") when assigning the role

4. **Authentication**: The app registration authenticates using a client secret
   - Create secrets at: Entra ID → App registrations → whim → Certificates & secrets
   - The GitHub secret `AZURE_CLIENT_SECRET` must be the secret **Value** (shown only once at creation), not the Secret ID
   - Rotate by creating a new secret, updating GitHub, then deleting the old one
