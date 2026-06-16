# Code-Signing Credentials

All secrets live in GitHub → Settings → Secrets and variables → Actions.

---

## macOS

| Secret | How to obtain |
|--------|--------------|
| `APPLE_CSC_LINK` | Base64-encoded `.p12` export of your **Developer ID Application** certificate from Keychain Access. Run: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple ID email used to log in to App Store Connect |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated at appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character Team ID from developer.apple.com → Account → Membership |

**To issue a Developer ID Application certificate:**
1. Open Xcode → Settings → Accounts → Manage Certificates.
2. Click `+` → Developer ID Application.
3. Export from Keychain Access as `.p12`.

**Notarisation** is handled automatically by `electron-builder` when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set.

**Rotation:** When the certificate expires (3 years from issue), repeat the steps above and replace `APPLE_CSC_LINK` and `APPLE_CSC_KEY_PASSWORD`.

---

## Windows

| Secret | How to obtain |
|--------|--------------|
| `WIN_CSC_LINK` | Base64-encoded `.p12` / `.pfx` Authenticode certificate |
| `WIN_CSC_KEY_PASSWORD` | Password for the `.p12` / `.pfx` |

**To obtain an Authenticode certificate:**
Purchase an OV (Organisation Validated) or EV (Extended Validation) code-signing certificate from a CA such as DigiCert, Sectigo, or GlobalSign. EV certificates are recommended — they establish SmartScreen reputation immediately.

**Rotation:** Follow the CA's renewal process before expiry and replace the secrets.

---

## Linux

Linux AppImage artefacts can be GPG-signed for integrity verification. This is optional and not yet wired into the CI workflow. If you add it:

| Secret | Description |
|--------|-------------|
| `GPG_PRIVATE_KEY` | Armoured private key (`gpg --armor --export-secret-keys KEY_ID`) |
| `GPG_PASSPHRASE` | Passphrase for the private key |

---

## Smoke-test checklist (first signed release)

Run on each platform after the first signed build is published to GitHub Releases:

- [ ] Download the installer/DMG/AppImage
- [ ] macOS: open the DMG, drag to Applications — Gatekeeper should allow without warning
- [ ] Windows: run the installer — SmartScreen should not block (EV cert) or prompt once (OV cert)
- [ ] Linux: mark AppImage executable (`chmod +x`) and launch
- [ ] Verify the app launches, loads the catalogue, and the scanner functions correctly
- [ ] Publish a second release (bump the patch version), open the previously installed app, and confirm the update prompt appears and the update installs cleanly
