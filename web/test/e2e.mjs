// Browser integration test against a LOCAL build (vite preview). No public deployment needed.
// Needs Chrome/Chromium: set CHROME_PATH or install google-chrome. Run: npm run test:e2e
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!CHROME) { console.error('No Chrome found; set CHROME_PATH'); process.exit(2); }
const PORT = 4173, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await sleep(250); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const ok = (name, cond, info = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${info ? '  [' + info + ']' : ''}`); };

async function open({ q = '', bridge = true, block = () => false } = {}) {
  const p = await browser.newPage(); await p.setViewport({ width: 1200, height: 800 });
  await p.evaluateOnNewDocument((withBridge) => {
    window.__h = [];
    if (withBridge) window.webkit = { messageHandlers: { haptic: { postMessage: (m) => window.__h.push([performance.now(), m.kind]) } } };
  }, bridge);
  await p.setRequestInterception(true);
  p.on('request', (r) => (block(r.url()) ? r.respond({ status: 404, body: 'x' }) : r.continue()));
  await p.goto(`http://localhost:${PORT}/${q}`, { waitUntil: 'networkidle0' });
  return p;
}
const status = (p) => p.$eval('#status', (e) => e.textContent);
const haptics = (p) => p.evaluate(() => window.__h.slice());
const pressedCoats = (p) => p.$$eval('#swatches button', (bs) => bs.map((b) => b.getAttribute('aria-pressed')));

try {
  let p = await open({ bridge: false });
  ok('no bridge: status says there are no haptics', (await status(p)).startsWith('햅틱 없음'), await status(p));
  await p.mouse.click(600, 400); await p.mouse.move(540, 400); await p.mouse.move(660, 420, { steps: 20 });
  ok('no bridge: petting does not throw and sends nothing', (await haptics(p)).length === 0);
  await p.close();

  p = await open({ q: '?theme=dark' });
  ok('theme=dark: dark applied, hint kept (no hidden arming)', (await p.$eval('html', (e) => e.dataset.theme)) === 'dark' && !(await p.$eval('#hint', (e) => e.classList.contains('gone'))));
  await p.close();

  p = await open();
  const sound = () => p.$eval('#sound', (e) => e.getAttribute('aria-checked'));
  await p.keyboard.down('Meta'); await p.keyboard.press('m'); await p.keyboard.up('Meta');
  ok('Cmd+M ignored', (await sound()) === 'true');
  for (let i = 0; i < 3; i++) await p.keyboard.down('m'); await p.keyboard.up('m');
  ok('held M toggles once (key repeat ignored)', (await sound()) === 'false');
  await p.keyboard.press('m');
  await p.focus('#moon'); await p.keyboard.press('Space');
  ok('Space on a focused switch is not hijacked', (await p.$eval('#moon', (e) => e.getAttribute('aria-checked'))) === 'true');
  await p.close();

  p = await open();
  await p.mouse.click(10, 10); await sleep(300);
  await p.keyboard.down('t'); await sleep(2000);
  const hs = await haptics(p);
  ok('bridge stub receives haptics while T is held', hs.length >= 3, `n=${hs.length}`);
  ok('tail zone sends bump', hs.some((x) => x[1] === 'bump'));
  const gaps = hs.slice(1).map((v, i) => v[0] - hs[i][0]);
  ok('haptic gaps >= 24 ms', gaps.length > 0 && gaps.every((g) => g >= 24), `min=${gaps.length ? Math.min(...gaps).toFixed(0) : 'n/a'} ms`);
  await p.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(150); const n2 = (await haptics(p)).length; await sleep(900);
  ok('window blur resets held key (no more haptics)', (await haptics(p)).length === n2, `${n2} -> ${(await haptics(p)).length}`);
  await p.keyboard.up('t');
  await p.keyboard.down('Space'); await sleep(500);
  const n3 = (await haptics(p)).length;
  await p.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(150); const n4 = (await haptics(p)).length; await sleep(700);
  ok('tab hidden resets held key', (await haptics(p)).length === n4, `${n3} -> ${n4} -> ${(await haptics(p)).length}`);
  await p.close();

  let fail = true;
  p = await open({ block: (u) => fail && u.includes('/cats/calico.webp') });
  await p.click('#swatches button:nth-child(3)'); await sleep(500);
  let pr = await pressedCoats(p);
  ok('failed coat: previous coat stays selected + notice', pr[0] === 'true' && pr[2] === 'false' && (await status(p)).includes('삼색이'), await status(p));
  fail = false; await p.click('#swatches button:nth-child(3)'); await sleep(800);
  pr = await pressedCoats(p);
  ok('failed coat: retry succeeds and notice clears', pr[2] === 'true' && !(await status(p)).includes('삼색이'), await status(p));
  await p.close();

  fail = true;
  p = await open({ block: (u) => fail && u.includes('/cats/mask.png') });
  ok('mask failure shows notice', (await status(p)).includes('고양이 영역'), await status(p));
  await p.click('#swatches button:nth-child(2)'); await sleep(800);
  ok('mask notice survives a successful coat load', (await status(p)).includes('고양이 영역'), await status(p));
  fail = false; await sleep(3800);
  ok('mask recovers by itself', !(await status(p)).includes('고양이 영역'), await status(p));
  await p.mouse.click(600, 400); await p.mouse.move(540, 400); await p.mouse.move(660, 420, { steps: 20 });
  ok('petting works after mask recovery', (await haptics(p)).length > 0);
  await p.close();

  p = await open({ block: (u) => u.includes('/sounds/low-thumps.mp3') });
  ok('missing sound file shows notice', (await status(p)).includes('소리 파일'), await status(p));
  await p.close();
} catch (e) { failed++; console.log('ERROR', e.stack); }
await browser.close(); srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
