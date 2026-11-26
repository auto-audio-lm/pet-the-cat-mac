# Web app (source)

Vite + vanilla JS. Deployed at https://cat-pet-haptic.pages.dev/ (Cloudflare Pages).

- `npm ci && npm test && npx vite build`
- The cat images, mask and sound files live in `public/` and are **not** in this repo (AI-generated images deployed separately; sounds come from the `button-sounds` package, MIT). The build works without them, but the page shows an asset error notice.
- No haptics from the web page itself. It only posts `{kind: "tick" | "bump"}` to `window.webkit.messageHandlers.haptic`, which exists only inside the Mac app.
