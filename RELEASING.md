# Releasing Copilot Whim

## Local Release

Your Developer ID certificate is already in your keychain. To build a signed, notarized DMG and publish it to GitHub Releases:

```bash
# Set notarization credentials
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YFVZ335843"

# Publish to GitHub Releases
GH_TOKEN=$(gh auth token) npm run release
```

To generate an app-specific password, go to https://account.apple.com/sign-in → Sign-In and Security → App-Specific Passwords.

### Build without publishing

```bash
npm run build:installer:mac   # Signed + notarized DMG in build/
```

## CI Release (GitHub Actions)

Push a version tag to trigger the release workflow:

```bash
# Bump version in package.json first, then:
git tag v1.0.0
git push origin v1.0.0
```

### Required GitHub Secrets

Configure these in Settings → Secrets and variables → Actions:

**Variables** (Settings → Variables → Actions → Repository variables):

| Variable | Description |
|----------|-------------|
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_TEAM_ID` | `YFVZ335843` |

**Secrets** (Settings → Secrets → Actions → Repository secrets):

| Secret | Description |
|--------|-------------|
| `MACOS_CERTIFICATE` | Base64-encoded .p12 export of your Developer ID certificate |
| `MACOS_CERTIFICATE_PWD` | Password used when exporting the .p12 |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |

### Exporting the certificate

```bash
# Find your cert
security find-identity -v -p codesigning

# Export from Keychain Access:
# 1. Open Keychain Access
# 2. Find "Developer ID Application: Patrick Nikoletich"
# 3. Right-click → Export Items → save as .p12 with a password

# Base64-encode it for the GitHub secret
base64 -i certificate.p12 | pbcopy
# Paste into the MACOS_CERTIFICATE secret
```
