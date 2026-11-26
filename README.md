# Pet the Cat (Mac wrapper for the web demo)

Small macOS app that opens https://cat-pet-haptic.pages.dev/ and forwards "tick" signals from the page to the trackpad via `NSHapticFeedbackManager`.

**Status: experimental.** Whether the trackpad actually vibrates has not been verified on a real Mac. macOS only plays trackpad haptics while a finger is on the trackpad.

- Needs macOS 12.3+ and internet access (the page is loaded from the web).
- The app is **not notarized** and only ad-hoc signed. After downloading, macOS will block it the first time. Open System Settings > Privacy & Security and click "Open Anyway" ([Apple guide](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/mac)).
- Only `cat-pet-haptic.pages.dev` can load inside the app; other links open in your default browser.
- Build yourself: `swiftc -O PetTheCat.swift -o PetTheCat` (needs Xcode Command Line Tools).
- Sounds in the web demo: [Button Sounds](https://buttons.joshwcomeau.com/) by Josh W. Comeau (MIT).
