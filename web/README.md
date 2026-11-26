# Web app (source)

Vite + vanilla JS. Deployed at https://cat-pet-haptic.pages.dev/ (Cloudflare Pages).

## Build and test
```
npm ci
npm run build      # prebuild copies the 6 sounds from the MIT `button-sounds` package into public/sounds
                   # and fails if any required file in public/ is missing or empty
npm test           # unit tests (node:test)
npm run test:e2e   # builds, serves locally (vite preview) and drives headless Chrome (needs Chrome, or CHROME_PATH)
```

## Assets
- `public/cats/`: AI-generated cat images, mask and hand (committed).
- `public/sounds/`: not committed; copied from `button-sounds` (MIT) by `npm run assets`.

## Haptics
No haptics from the web page itself. Messages go to `window.webkit.messageHandlers.haptic`, which exists only inside the Mac app:
- `{kind: "zone", zone: "body" | "tail" | "none"}` when the app announces `window.petTheCatNative.texture`. The app then makes the fur texture from native pointer movement, and pointer strokes send no per-step pulses.
- `{kind: "tick" | "bump"}` for keyboard petting and buttons, and for every stroke step when the app does not announce the native texture (older app versions).

The e2e test checks the page against a stub of that bridge; it says nothing about real trackpad output.

## Sound
Strokes are a soft brushing noise that follows stroke speed. Click samples play only on first touch and as a tail thump (at most every 400 ms). There is no synthesized purr: a low hum sounded like a drone, not a cat.
