// Pure helpers (no DOM access) so they can be unit tested with node:test.
export const W = 1200, H = 800, TAIL_X = 800;

const INTERACTIVE = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'SUMMARY']);
export function isInteractiveTarget(t) {
  if (!t) return false;
  return INTERACTIVE.has(t.tagName) || !!t.isContentEditable || (t.getAttribute?.('role') === 'switch');
}

// Returns 'body' | 'tail' | 'mute' | null for a keydown event (or event-like object).
export function keyAction(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return null;
  if (isInteractiveTarget(e.target)) return null;
  const k = (e.key || '').toLowerCase();
  if (k === 'm') return e.repeat ? null : 'mute';
  if (e.key === ' ') return 'body';
  if (k === 't') return 'tail';
  return null;
}
export const keyUpAction = (e) => (e.key === ' ' ? 'body' : (e.key || '').toLowerCase() === 't' ? 'tail' : null);

// Rate limiter: ticks at most every tickGap ms, bumps at most every bumpGap ms (bumps are rarer and not starved by ticks).
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
