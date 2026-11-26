# Pet the Cat (Mac wrapper for the web demo)

Small macOS app that opens https://cat-pet-haptic.pages.dev/ and forwards "tick" and "bump" signals from the page to the trackpad via `NSHapticFeedbackManager`.

## What is verified and what is not

- Verified: the Swift code compiles for arm64 and x86_64 on a GitHub macOS runner (see the Actions tab).
- Not verified: the app has never been launched on a real Mac by the author, and trackpad vibration has not been felt. macOS only plays trackpad haptics while a finger is on the trackpad, so a tap from the keyboard or a mouse gives no haptics.
- Sound is played by the web page in the app window (audio is not verified on a real Mac either).

## Use

- Needs macOS 12.3+ and internet access (the page is loaded from the web). If it cannot load, the window shows a retry link.
- The app is **not notarized** and only ad-hoc signed. After downloading, macOS blocks it the first time. Open System Settings > Privacy & Security and click "Open Anyway" ([Apple guide](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/mac)).
- Check the download against `PetTheCat-mac.zip.sha256` from the same release: `shasum -a 256 -c PetTheCat-mac.zip.sha256`.
- Only `cat-pet-haptic.pages.dev` can load inside the app; other links open in your default browser.
- Build yourself: `swiftc -O PetTheCat.swift -o PetTheCat` (needs Xcode Command Line Tools). `./PetTheCat --selftest` checks the URL rule and the haptic rate limit without opening a window.
- Sounds in the web demo: [Button Sounds](https://buttons.joshwcomeau.com/) by Josh W. Comeau (MIT).
