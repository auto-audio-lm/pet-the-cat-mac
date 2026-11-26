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
No haptics from the web page itself. It only posts `{kind: "tick" | "bump"}` to `window.webkit.messageHandlers.haptic`, which exists only inside the Mac app. The e2e test checks the page against a stub of that bridge; it says nothing about real trackpad output.
