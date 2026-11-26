# Changelog

## 0.2.0 (unreleased)

### Mac app
- **Haptics**
  - Fur-texture haptics: while the pointer is over the cat, the app turns native pointer movement into weak trackpad pulses. There is one pulse per ~8 pt, the spacing is jittered, and there are no pulses while the hand is resting. Pulses come from the trackpad actuator in the private `MultitouchSupport` framework; without it the app falls back to the public API.
  - A fast stroke makes the texture one step firmer.
  - The **Haptics** menu offers Off, Soft fur, Fur, Firm fur and System clicks (classic). It also has Preview Texture and Compare Strengths 1–6.
- **App**
  - App icon.
  - About, Hide, Show All and Enter Full Screen menu items. The window remembers its size and position.
  - Reloads after a web-process crash, at most 3 times in 30 s, then shows an error page.
  - An error page instead of a blank window when the page redirects off its own host.
- **Testing**: `--smoke-test` launches the app, loads the page, checks the haptic bridge and quits. `./build.sh` runs `--selftest`, and on the x86_64 slice too when the Mac can run it (Rosetta or Intel).
- **Signing and CI**
  - CI can sign with a Developer ID certificate and notarize, once the signing secrets are set. Until then releases stay ad-hoc signed, and Gatekeeper blocks a downloaded copy.
  - Releases include a SHA-256 checksum.
  - A release tag must match the app version; this is checked before the build.

### Web page (needs a Cloudflare Pages deploy, see `docs/deploy-web.md`)
- **Sound**
  - Stroking no longer rattles. Strokes make a soft brushing sound that follows speed. A click sample plays only on first touch, and the tail thump plays at most every 400 ms.
  - The synthesized purr hum is gone.
- **Haptics**: with the new app, the page reports which part of the cat is under the pointer, and the app makes the texture. Older app versions keep receiving a pulse per stroke step.
- **Keyboard shortcuts**
  - T and M work after clicking a button, and with the Korean input source.
  - Punctuation on other keyboard layouts no longer toggles sound.
- **Loading**
  - Failed image loads are retried.
  - A notice appears when sound files are missing, including when the host answers a missing file with its HTML page.

## 0.1.0
- First build: a WKWebView window for https://cat-pet-haptic.pages.dev/ that plays `NSHapticFeedbackManager` clicks for the page's `tick` / `bump` messages.
