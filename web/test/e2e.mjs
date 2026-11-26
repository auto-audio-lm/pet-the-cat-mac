// Browser integration test against a LOCAL build (vite preview). No public deployment needed.
// Needs Chrome/Chromium: set CHROME_PATH or install google-chrome. Run: npm run test:e2e
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!CHROME) { console.error('No Chrome found; set CHROME_PATH'); process.exit(2); }
const PORT = 4173, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await sleep(250); }
if (!up) { console.error(`vite preview did not answer on port ${PORT}`); srv.kill(); process.exit(2); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const pageErrors = [];
// Any uncaught exception in any page fails the run, even if no assertion happens to notice it.
browser.on('targetcreated', async (t) => { const pg = await t.page().catch(() => null); pg?.on('pageerror', (e) => pageErrors.push(String(e))); });
const ok = (name, cond, info = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${info ? '  [' + info + ']' : ''}`); };

async function open({ q = '', bridge = true, native = false, keepPrefs = false, block = () => false } = {}) {
  const p = await browser.newPage(); await p.setViewport({ width: 1200, height: 800 });
  // Pages share one browser profile; start each from default preferences unless a test checks persistence.
  if (!keepPrefs) await p.evaluateOnNewDocument(() => { try { localStorage.removeItem('petTheCat.prefs'); } catch {} });
  await p.evaluateOnNewDocument((withBridge, withNative) => {
    window.__h = []; window.__zones = []; window.__osc = 0; window.__started = 0;
    if (window.AudioBufferSourceNode) { const st = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { if (this.loop) window.__started++; return st.apply(this, a); }; }
    // Count oscillators: the page must not synthesize a hum (the removed purr drone).
    for (const AC of [window.AudioContext, window.webkitAudioContext]) {
      if (AC) { const orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function (...a) { window.__osc++; return orig.apply(this, a); }; }
    }
    if (withBridge) window.webkit = { messageHandlers: { haptic: { postMessage: (m) => (m.kind === 'zone' ? window.__zones.push(m.zone) : window.__h.push([performance.now(), m.kind])) } } };
    if (withNative) window.petTheCatNative = Object.freeze({ texture: 1 });
  }, bridge, native);
  await p.setRequestInterception(true);
  // block(url) returns false to pass the request through, true for a 404, or a response object.
  p.on('request', (r) => { const b = block(r.url()); return b ? r.respond(b === true ? { status: 404, body: 'x' } : b) : r.continue(); });
  await p.goto(`http://localhost:${PORT}/${q}`, { waitUntil: 'networkidle0' });
  return p;
}
const status = (p) => p.$eval('#status', (e) => e.textContent);
const sound2 = (p) => p.$eval('#sound', (e) => e.getAttribute('aria-checked'));
const haptics = (p) => p.evaluate(() => window.__h.slice());
const pressedCoats = (p) => p.$$eval('#swatches button', (bs) => bs.map((b) => b.getAttribute('aria-pressed')));
// Poll on a timer, not requestAnimationFrame: rAF stops in a page that is not in front.
const waitStatus = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 100 }).then(() => true, () => false);

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
  ok('Space held: keyboard petting is active', (await p.evaluate(() => window.__petState().kbd)) === 'body' && n3 > 0, `n=${n3}`);
  await p.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // Show the tab again while Space is still held: if the reset did not happen, haptics would resume.
  await p.evaluate(() => Object.defineProperty(document, 'hidden', { value: false, configurable: true }));
  const n4 = (await haptics(p)).length; await sleep(700);
  ok('tab hidden resets held key', (await p.evaluate(() => window.__petState().kbd)) === null && (await haptics(p)).length === n4,
    `${n3} -> ${n4} -> ${(await haptics(p)).length}`);
  await p.keyboard.up('Space');
  await p.close();

  // Sound on, a long stroke across the body: one soft pat on touch, no train of click samples (the old rattle).
  p = await open();
  const samples = () => p.evaluate(() => window.__petState().samples);
  await p.mouse.move(420, 380); await p.mouse.down();
  const s0 = await samples();
  let peakBrush = 0;
  for (let i = 0; i < 4; i++) {
    await p.mouse.move(780, 420, { steps: 30 }); await p.mouse.move(420, 380, { steps: 30 });
    peakBrush = Math.max(peakBrush, await p.evaluate(() => window.__petState().brush));
  }
  ok('brushing gets louder while stroking', peakBrush > 0.001, `peak gain ${peakBrush.toFixed(4)}`);
  const strokeSamples = (await samples()) - s0; // before the M presses below, which play their own on/off samples
  // M mid-stroke silences the brushing at once, not when the stroke ends.
  await p.mouse.move(780, 420, { steps: 15 }); await p.keyboard.press('m'); await sleep(400);
  ok('M mid-stroke silences brushing', (await p.evaluate(() => window.__petState().brush)) < 0.002, `gain ${(await p.evaluate(() => window.__petState().brush)).toFixed(4)}`);
  await p.keyboard.press('m');
  await p.mouse.up();
  const strokeHaptics = (await haptics(p)).length;
  ok('brushing noise source (looping) is playing', (await p.evaluate(() => window.__started)) === 1, `started ${await p.evaluate(() => window.__started)}`);
  ok('no synthesized hum while petting (no oscillators)', (await p.evaluate(() => window.__osc)) === 0, `oscillators ${await p.evaluate(() => window.__osc)}`);
  ok('long stroke plays at most the touch pat, no click train', strokeSamples <= 1 && strokeHaptics > 5,
    `samples +${strokeSamples}, haptics ${strokeHaptics}`);
  await p.mouse.click(10, 10);
  const t0 = await samples(); await p.keyboard.down('t'); await sleep(2000); await p.keyboard.up('t');
  const thumps = (await samples()) - t0;
  ok('tail strokes thump, at most every 400 ms', thumps >= 1 && thumps <= 6, `+${thumps} in 2 s`);
  await p.close();

  p = await open();
  await p.click('#sound'); const before = await sound2(p); await p.keyboard.press('m');
  ok('M still toggles sound after clicking a button', (await sound2(p)) !== before);
  await p.close();

  let fail = true;
  p = await open({ block: (u) => fail && u.includes('/cats/calico.webp') });
  await p.click('#swatches button:nth-child(3)');
  await waitStatus(p, () => document.getElementById('status').textContent.includes('삼색이'));
  let pr = await pressedCoats(p);
  ok('failed coat: previous coat stays selected + notice', pr[0] === 'true' && pr[2] === 'false' && (await status(p)).includes('삼색이'), await status(p));
  fail = false; await p.click('#swatches button:nth-child(3)');
  await waitStatus(p, () => document.querySelector('#swatches button:nth-child(3)').getAttribute('aria-pressed') === 'true');
  pr = await pressedCoats(p);
  ok('failed coat: retry succeeds and notice clears', pr[2] === 'true' && !(await status(p)).includes('삼색이'), await status(p));
  await p.close();

  fail = true;
  p = await open({ block: (u) => fail && u.includes('/cats/mask.png') });
  ok('mask failure shows notice', (await status(p)).includes('고양이 영역'), await status(p));
  await p.click('#swatches button:nth-child(2)'); await sleep(800);
  ok('mask notice survives a successful coat load', (await status(p)).includes('고양이 영역'), await status(p));
  fail = false;
  ok('mask recovers by itself', await waitStatus(p, () => !document.getElementById('status').textContent.includes('고양이 영역'), 8000), await status(p));
  await p.mouse.click(600, 400); await p.mouse.move(540, 400); await p.mouse.move(660, 420, { steps: 20 });
  ok('petting works after mask recovery', (await haptics(p)).length > 0);
  await p.close();

  p = await open({ block: (u) => u.includes('/sounds/low-thumps.mp3') });
  ok('missing sound file shows notice', (await status(p)).includes('소리 파일'), await status(p));
  await p.close();

  // Mac app with the native fur texture: pointer strokes report zones only, keyboard petting still sends pulses.
  p = await open({ native: true });
  await p.mouse.move(100, 100); await p.mouse.move(600, 400, { steps: 10 }); await p.mouse.move(720, 420, { steps: 20 });
  const zones = await p.evaluate(() => window.__zones.slice());
  ok('native texture: zone reported, no per-step pointer pulses', zones.includes('body') && (await haptics(p)).length === 0,
    `zones ${zones.join(',')}, pulses ${(await haptics(p)).length}`);
  await p.mouse.move(5, 5, { steps: 5 });
  ok('native texture: status points to the Haptics menu', (await status(p)).includes('Haptics'), await status(p));
  ok('native texture: leaving the cat reports none', (await p.evaluate(() => window.__zones.at(-1))) === 'none');
  await p.keyboard.down('Space'); await sleep(600); await p.keyboard.up('Space');
  ok('native texture: keyboard petting still sends pulses', (await haptics(p)).length > 0);
  await p.close();

  // Idle: no input for a while -> no redraws; any movement -> drawing resumes.
  p = await open();
  const drawsNow = () => p.evaluate(() => window.__petState().draws);
  // Wait until drawing has been still for 500 ms (up to 10 s), instead of betting on fixed sleeps.
  const settle = async () => { let a = await drawsNow(); for (let i = 0; i < 40; i++) { await sleep(250); const b = await drawsNow(); if (b === a && i > 1) return b; a = b; } return a; };
  const d1 = await settle(); await sleep(1000); const d2 = await drawsNow();
  ok('idle page stops redrawing', d2 === d1, `${d1} -> ${d2} in 1 s`);
  await p.mouse.move(600, 400); await p.mouse.move(640, 410, { steps: 5 }); await sleep(300);
  ok('pointer movement resumes drawing', (await drawsNow()) > d2, `${d2} -> ${await drawsNow()}`);
  const d3 = await settle(); await sleep(300);
  ok('idle again after movement stops', (await drawsNow()) === d3);
  await p.$eval('#moon', (b) => b.click()); await sleep(300);  // no pointer movement, so only setDark can wake drawing
  ok('theme change redraws', (await drawsNow()) > d3, `${d3} -> ${await drawsNow()}`);
  await p.close();

  // Accessibility: named canvas, announced status, visible focus on a selected swatch, documented shortcuts.
  p = await open();
  const a11y = await p.evaluate(() => ({
    canvas: document.getElementById('c').getAttribute('aria-label') || '',
    live: document.getElementById('status').getAttribute('aria-live'),
    help: document.querySelector('.help').textContent,
  }));
  ok('a11y: canvas has a name, status is a live region, help lists M', a11y.canvas.length > 10 && a11y.live === 'polite' && a11y.help.includes('M('), JSON.stringify(a11y));
  await p.keyboard.press('Tab'); // first focusable: the theme switch
  let guard = 0;
  while (guard++ < 20 && !(await p.evaluate(() => document.activeElement?.getAttribute('aria-pressed') === 'true'))) await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  ok('a11y: keyboard focus on the selected swatch shows a ring', ring && ring !== 'none', ring);
  await p.close();

  // Preferences: coat, sound and theme survive a new visit; ?theme=dark is not saved.
  p = await open();
  await p.click('#swatches button:nth-child(4)');
  await waitStatus(p, () => document.querySelector('#swatches button:nth-child(4)').getAttribute('aria-pressed') === 'true');
  await p.click('#sound'); await p.click('#moon');
  await p.close();
  p = await open({ keepPrefs: true });
  await waitStatus(p, () => document.querySelector('#swatches button:nth-child(4)').getAttribute('aria-pressed') === 'true');
  const kept = await p.evaluate(() => ({ coat: [...document.querySelectorAll('#swatches button')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'),
    sound: document.getElementById('sound').getAttribute('aria-checked'), theme: document.documentElement.dataset.theme }));
  ok('prefs: with sound saved off, the hint says how to turn it on', (await p.$eval('#hint', (e) => e.textContent)).includes('M 키'));
  ok('prefs: coat, sound and theme are remembered', kept.coat === 3 && kept.sound === 'false' && kept.theme === 'dark', JSON.stringify(kept));
  await p.click('#moon'); await p.close();                       // back to light, saved
  p = await open({ keepPrefs: true, q: '?theme=dark' }); await p.close();
  p = await open({ keepPrefs: true });
  ok('prefs: ?theme=dark is not saved', (await p.evaluate(() => document.documentElement.dataset.theme)) !== 'dark');
  await p.close();

  // Two pages open: a theme change in one and a coat change in the other both survive.
  const pa = await open(), pb = await open({ keepPrefs: true });
  await pa.bringToFront(); await pa.click('#moon');                          // page A: dark
  await pb.bringToFront(); await pb.click('#swatches button:nth-child(5)');  // page B: coat 5, after A saved dark
  await waitStatus(pb, () => document.querySelector('#swatches button:nth-child(5)').getAttribute('aria-pressed') === 'true');
  const merged = await pb.evaluate(() => JSON.parse(localStorage.getItem('petTheCat.prefs')));
  ok('prefs: two pages do not undo each other', merged.dark === true && merged.coat === 4, JSON.stringify(merged));
  await pa.evaluate(() => localStorage.removeItem('petTheCat.prefs'));
  await pa.close(); await pb.close();

  // Picking coat 0 is remembered even while the saved coat 3 is still loading.
  p = await browser.newPage(); await p.setViewport({ width: 1200, height: 800 });
  await p.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('petTheCat.prefs', JSON.stringify({ coat: 3 })); sessionStorage.setItem('seeded', '1'); } } catch {} });
  await p.setRequestInterception(true);
  p.on('request', (r) => (r.url().includes('/cats/white.webp') ? setTimeout(() => r.continue(), 1500) : r.continue()));
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  ok('saved coat shows as selected while it loads', (await pressedCoats(p))[3] === 'true', JSON.stringify(await pressedCoats(p)));
  await p.click('#swatches button:nth-child(1)');
  await waitStatus(p, () => window.__petState().hasCoat); await sleep(1800);
  ok('picking coat 0 during the saved coat load is remembered', (await p.evaluate(() => JSON.parse(localStorage.getItem('petTheCat.prefs')).coat)) === 0
    && (await pressedCoats(p))[0] === 'true', JSON.stringify(await p.evaluate(() => localStorage.getItem('petTheCat.prefs'))));
  await p.evaluate(() => localStorage.removeItem('petTheCat.prefs'));
  await p.close();

  // A saved coat whose image fails at startup falls back to the first coat instead of a blank cat.
  p = await browser.newPage(); await p.setViewport({ width: 1200, height: 800 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('petTheCat.prefs', JSON.stringify({ coat: 2 })); } catch {} });
  await p.setRequestInterception(true);
  p.on('request', (r) => (r.url().includes('/cats/calico.webp') ? r.respond({ status: 404, body: 'x' }) : r.continue()));
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await waitStatus(p, () => document.querySelector('#swatches button:nth-child(1)').getAttribute('aria-pressed') === 'true');
  await waitStatus(p, () => window.__petState().hasCoat);
  await sleep(300);
  ok('a fallback after a failed load does not overwrite the saved coat', (await p.evaluate(() => JSON.parse(localStorage.getItem('petTheCat.prefs')).coat)) === 2,
    await p.evaluate(() => localStorage.getItem('petTheCat.prefs')));
  ok('saved coat failing at startup falls back to the first coat', (await p.evaluate(() => window.__petState().hasCoat)) && (await pressedCoats(p))[0] === 'true' && (await status(p)).includes('삼색이'), await status(p));
  await p.evaluate(() => localStorage.removeItem('petTheCat.prefs'));
  await p.close();

  // Static hosts answer a missing file with 200 + index.html; that must count as missing too.
  p = await open({ block: (u) => u.includes('/sounds/low-thumps.mp3') && { status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' } });
  ok('sound replaced by an HTML fallback shows notice', (await status(p)).includes('소리 파일'), await status(p));
  await p.close();
  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) { failed++; console.log('ERROR', e.stack); }
await browser.close(); srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
