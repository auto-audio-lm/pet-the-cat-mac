// Pure helpers (no DOM access) so they can be unit tested with node:test.
export const W = 1200, H = 800, TAIL_X = 800;

// Elements that take typed text: no shortcut may fire there.
const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
export const isTextEntry = (t) => !!t && (TEXT_ENTRY.has(t.tagName) || !!t.isContentEditable);
// Elements that Space activates: Space must keep working there, but T and M still may fire
// (Chrome keeps focus on a clicked button, which would otherwise disable the shortcuts until the next click).
const ACTIVATABLE = new Set(['BUTTON', 'A', 'SUMMARY']);
export function isInteractiveTarget(t) {
  if (!t) return false;
  return isTextEntry(t) || ACTIVATABLE.has(t.tagName) || (t.getAttribute?.('role') === 'switch');
}

// Which shortcut a key is: matched on e.key, then on the physical key (e.code) so T and M also work while a
// non-Latin input source is active (with the Korean source e.key is 'ㅅ' / 'ㅡ'). Only for non-ASCII keys, so
// punctuation on other Latin layouts (AZERTY types ',' on the KeyM position) keeps its own meaning.
function shortcut(e) {
  const k = (e.key || '').toLowerCase();
  if (e.key === ' ' || (!e.key && e.code === 'Space')) return 'space';
  if (k === 't' || (/[^\x00-\x7f]/.test(k) && e.code === 'KeyT')) return 't';
  if (k === 'm' || (/[^\x00-\x7f]/.test(k) && e.code === 'KeyM')) return 'm';
  return null;
}

// Returns 'body' | 'tail' | 'mute' | null for a keydown event (or event-like object).
export function keyAction(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return null;
  if (isTextEntry(e.target)) return null;
  const s = shortcut(e);
  if (s === 'space') return isInteractiveTarget(e.target) ? null : 'body';
  if (s === 'm') return e.repeat ? null : 'mute';
  if (s === 't') return 'tail';
  return null;
}
export const keyUpAction = (e) => ({ space: 'body', t: 'tail' })[shortcut(e)] ?? null;

// Rate limiter: ticks at most every tickGap ms; bumps at most every bumpGap ms after any haptic and at most one per
// 120 ms (bumps are rarer and not starved by ticks).
export function makeHapticGate(tickGap = 50, bumpGap = 25) {
  let lastAny = -1e9, lastBump = -1e9;
  return (kind, now) => {
    if (kind === 'bump') {
      if (now - lastAny < bumpGap || now - lastBump < 120) return false;
      lastAny = lastBump = now; return true;
    }
    if (now - lastAny < tickGap) return false;
    lastAny = now; return true;
  };
}

export const hit = (mask, x, y) => !!mask && x >= 0 && y >= 0 && x < W && y < H && mask[(((y | 0) * W) + (x | 0)) * 4] > 128;
export const zoneAt = (mask, x, y) => (!hit(mask, x, y) ? 'none' : x > TAIL_X ? 'tail' : 'body');
// Per-frame alpha so the fur fade has the same speed at 60 and 120 Hz.
export const fadeAlpha = (dt, perFrame = 0.045) => 1 - Math.pow(1 - perFrame, Math.max(0, dt) / (1000 / 60));
// Stroke sound levels (pure so they can be unit tested).
// Brushing: a soft noise whose loudness follows stroke speed; quieter on the tail. Never a train of clicks:
// a click sample per few pixels of movement is what made strokes sound like a rattle ("드르르륵").
export const brushLevel = (speed, zone) => (zone === 'none' ? 0 : Math.min(0.045, Math.max(0, speed - 60) / 30000) * (zone === 'tail' ? 0.45 : 1));
// Minimum gap between tail thumps, in ms.
export const THUMP_GAP = 400;

// A sound probe passes only when it got an audio file: a static host (vite preview, Cloudflare Pages) answers a
// missing path with 200 and index.html, so `ok` alone is not enough.
export const isAudioResponse = (r) => !!r && r.ok && /^audio\//i.test(r.headers?.get?.('content-type') || '');

// Saved preferences (localStorage JSON). Anything missing, malformed or out of range falls back to the default.
export const PREFS_KEY = 'petTheCat.prefs';
export function parsePrefs(json, coatCount) {
  const d = { coat: 0, sound: true, dark: false };
  let p;
  try { p = JSON.parse(json); } catch { return d; }
  if (!p || typeof p !== 'object') return d;
  return {
    coat: Number.isInteger(p.coat) && p.coat >= 0 && p.coat < coatCount ? p.coat : d.coat,
    sound: typeof p.sound === 'boolean' ? p.sound : d.sound,
    dark: typeof p.dark === 'boolean' ? p.dark : d.dark,
  };
}
