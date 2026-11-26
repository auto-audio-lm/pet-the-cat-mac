# Pet the Cat (Mac wrapper for the web demo)

Small macOS app that opens https://cat-pet-haptic.pages.dev/ and makes the trackpad feel like stroking fur while the pointer moves over the cat.

## Haptics

- The page reports which part of the cat the pointer is over (`zone`); the app turns native pointer movement into a fur texture: one short, weak pulse per ~8 pt travelled, spacing jittered by ±35 %, at least 18 ms apart, nothing while the hand is nearly still (< 40 pt/s). The tail is a little firmer (except with Soft fur), and a fast stroke (> 900 pt/s) makes each pulse one step firmer.
- The weak pulses come from the trackpad actuator in Apple's private `MultitouchSupport` framework, loaded at runtime (the approach used by the open-source [HapticKey](https://github.com/niw/HapticKey) and [WhichSpace](https://github.com/gechr/WhichSpace)). Apple's public API (`NSHapticFeedbackManager`) has only three fixed-strength patterns. If the private framework is missing or no trackpad can be opened, the app falls back to the public API at the classic 18 pt spacing, since those clicks cannot be made weaker.
- **Haptics** menu: Off, Soft fur, Fur (default), Firm fur, and System clicks (classic) for the old public-API behaviour. The choice is remembered.
  - *Preview Texture* plays the current texture for 1.2 s as if stroking at a moderate speed (keep a finger on the trackpad).
  - *Compare Strengths 1–6* plays the actuator's six pulse strengths 0.6 s apart, to help choose or tune a style.
- Keyboard petting (Space / T) and buttons still send single pulses from the page. A page from before the `zone` message also works: its ticks play as weak pulses.

## What is verified and what is not

- Verified: the Swift code compiles for arm64 and x86_64 (locally and on a GitHub macOS runner). `--smoke-test` opens the app, loads the live page and checks the haptic bridge; it passes on a Mac.
- Felt on a real Mac by the user: the trackpad responds to the older click-style haptics. The fur texture has not been felt yet. macOS only plays trackpad haptics while a finger is on the trackpad.
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

`build/Pet the Cat.app/Contents/MacOS/PetTheCat --selftest` checks the URL rule, the haptic rate limits and the texture spacing without opening a window; `build.sh` runs it on every build. `--smoke-test` opens the window, loads the live page, prints what it found and quits.

The app icon is `assets/AppIcon.svg`; after editing it, regenerate `assets/AppIcon.icns` with `(cd web && npm ci) && node assets/make-icon.mjs`.

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
