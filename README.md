# Pet the Cat (Mac wrapper for the web demo)

Small macOS app that opens https://cat-pet-haptic.pages.dev/ and forwards "tick" and "bump" signals from the page to the trackpad via `NSHapticFeedbackManager`.

## What is verified and what is not

- Verified: the Swift code compiles for arm64 and x86_64 on a GitHub macOS runner (see the Actions tab).
- Not verified: the app has never been launched on a real Mac by the author, and trackpad vibration has not been felt. macOS only plays trackpad haptics while a finger is on the trackpad, so a tap from the keyboard or a mouse gives no haptics.
- Sound is played by the web page in the app window (audio is not verified on a real Mac either).

## Use

- Needs macOS 12.3+ and internet access (the page is loaded from the web). If it cannot load, the window shows a retry link.
- Check the download against `PetTheCat-mac.zip.sha256` from the same release: `shasum -a 256 -c PetTheCat-mac.zip.sha256`.
- Only `cat-pet-haptic.pages.dev` can load inside the app; other links open in your default browser.
- The web demo's source is in [`web/`](web/README.md); CI runs its unit and browser tests.
- Sounds in the web demo: [Button Sounds](https://buttons.joshwcomeau.com/) by Josh W. Comeau (MIT).

## If macOS says it cannot check the app for malicious software

macOS shows "Apple could not verify 'Pet the Cat' is free of malware" for a downloaded app that Apple has not notarized. A release is notarized only if it was built with the signing secrets below; v0.1.0 was not, so it is blocked. Pick one:

- **Build it yourself (no warning).** `./build.sh` creates `build/Pet the Cat.app`. An app built on your own Mac is not quarantined, so it opens normally. Needs Xcode Command Line Tools (`xcode-select --install`).
- **Allow the downloaded app once.** Try to open it, then go to System Settings > Privacy & Security and click "Open Anyway" ([Apple guide](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/mac)).
- **Remove the quarantine flag.** `xattr -dr com.apple.quarantine "/path/to/Pet the Cat.app"`. Only do this for a download whose checksum you have checked.

`build/Pet the Cat.app/Contents/MacOS/PetTheCat --selftest` checks the URL rule and the haptic rate limit without opening a window; `build.sh` runs it on every build.

## Notarized releases (maintainers)

The `build-mac` workflow signs with a Developer ID certificate, notarizes and staples the app when these five repository secrets are all set. This needs a paid Apple Developer Program membership. With none of them set it falls back to an ad-hoc signature and prints a warning. Pull request builds are always ad-hoc signed (fork PRs get no secrets, and notarizing every push would be slow).

| Secret | Value |
|---|---|
| `MACOS_CERTIFICATE_P12_BASE64` | "Developer ID Application" certificate exported from Keychain Access with its private key as `.p12`, then `base64 -i cert.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | Password chosen when exporting the `.p12` |
| `APPLE_ID` | Apple ID email of the developer account |
| `APPLE_APP_PASSWORD` | App-specific password created at [account.apple.com](https://account.apple.com/) (not the Apple ID password) |
| `APPLE_TEAM_ID` | 10-character Team ID from the developer account's Membership page |

The signing and notarization steps have not run yet, because no certificate has been available; expect to debug them on the first run with real secrets.
