// Regenerates assets/AppIcon.icns from assets/AppIcon.svg. Only needed after editing the SVG; the .icns is committed.
// Renders every iconset size with headless Chrome (puppeteer-core from web/node_modules), then runs iconutil.
// Usage (macOS, from the repo root):  (cd web && npm ci) && node assets/make-icon.mjs
// Set CHROME_PATH if Chrome is not at its default location.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'web', 'package.json'));
const puppeteer = require('puppeteer-core');

const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) { console.error(`Chrome not found at ${chrome}; set CHROME_PATH`); process.exit(2); }

const svg = readFileSync(join(here, 'AppIcon.svg'), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'appicon-'));
const iconset = join(work, 'AppIcon.iconset');
mkdirSync(iconset);

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
try {
  const page = await browser.newPage();
  for (const base of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = base * scale;
      await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${px}px;height:${px}px" `)}</body></html>`);
      const name = `icon_${base}x${base}${scale === 2 ? '@2x' : ''}.png`;
      await page.screenshot({ path: join(iconset, name), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
    }
  }
} finally {
  await browser.close();
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(here, 'AppIcon.icns')], { stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });
console.log('wrote assets/AppIcon.icns');
