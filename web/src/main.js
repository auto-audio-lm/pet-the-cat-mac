import { press, setPath, load } from 'button-sounds';
import { W, H, hit as hitMask, zoneAt as zoneAtMask, keyAction, keyUpAction, makeHapticGate, fadeAlpha, isAudioResponse,
  brushLevel, THUMP_GAP } from './logic.js';

setPath('/sounds/');
const SOUNDS = ['uhk-soft', 'low-thumps', 'synth-on', 'synth-off', 'tonal-on', 'hi75-soft'];
SOUNDS.forEach(load);
// button-sounds swallows load errors, so probe the files ourselves and tell the user when sound is missing.
Promise.all(SOUNDS.map((n) => fetch(`/sounds/${n}.mp3`, { method: 'HEAD' }).then(isAudioResponse)))
  .then((r) => { if (r.some((v) => !v)) setNotice('sound', '일부 소리 파일을 못 불러와서 소리가 나지 않을 수 있어요.'); })
  .catch(() => setNotice('sound', '소리 파일을 확인하지 못했어요. 소리가 나지 않을 수 있어요.'));

const $ = (id) => document.getElementById(id);
const canvas = $('c'), ctx = canvas.getContext('2d');

const COATS = [
  { id: 'black', name: '검은 고양이' }, { id: 'orange', name: '치즈' }, { id: 'calico', name: '삼색이' },
  { id: 'white', name: '흰 고양이' }, { id: 'mackerel', name: '고등어' }, { id: 'tuxedo', name: '턱시도' },
  { id: 'brown', name: '카오스' }, { id: 'grey', name: '회색' }, { id: 'siamese', name: '샴' }, { id: 'cream', name: '크림 장모' },
];

/* ---------- assets ---------- */
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load failed: ' + src)); i.src = src; });
const pixels = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
const notices = {};
const setNotice = (key, m) => { if (m) notices[key] = m; else delete notices[key]; updateStatus(); };
const coatCache = {}; // id -> Promise<{img, px}>; a failed promise is dropped so the next call retries
function getCoat(id) {
  if (!coatCache[id]) {
    coatCache[id] = loadImg(`/cats/${id}.webp`).then((img) => ({ img, px: pixels(img) })).catch((e) => { delete coatCache[id]; throw e; });
  }
  return coatCache[id];
}
let mask = null, handImg = null, maskLoading = null;
function ensureMask() {
  if (mask) return Promise.resolve(mask);
  return (maskLoading ||= loadImg('/cats/mask.png').then((img) => { mask = pixels(img); setNotice('mask'); return mask; })
    .catch(() => { maskLoading = null; setNotice('mask', '고양이 영역 이미지를 못 불러왔어요. 다시 시도 중이에요.'); setTimeout(ensureMask, 3000); return null; }));
}
ensureMask();
// The sleeve in hand.webp ends in a straight image edge. Fade it out along the arm direction so no rectangle shows.
function fadeSleeve(img) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const k = c.width / 729; // gradient tuned on the 729x794 source
  const grad = g.createLinearGradient(481 * k, 481 * k, 601 * k, 601 * k);
  grad.addColorStop(0, '#fff'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  return c;
}
const loadHand = () => loadImg('/cats/hand.webp').then((i) => (handImg = fadeSleeve(i))).catch(() => setTimeout(loadHand, 5000));
loadHand();
const hit = (x, y) => hitMask(mask, x, y);

/* ---------- state ---------- */
const state = {
  coat: 0, cur: null, dark: false, sound: true, armed: false,
  px: -999, py: -999, inside: false, lastX: 0, lastY: 0, lastT: 0, speed: 0,
  accum: 0, zone: 'none', pressure: 0, kbd: null, down: false,
};
const ruffle = document.createElement('canvas'); ruffle.width = W; ruffle.height = H;
const rg = ruffle.getContext('2d');
let wantCoat = 0;
async function setCoat(i) {
  wantCoat = i;
  try {
    const c = await getCoat(COATS[i].id);
    if (wantCoat !== i) return; // a newer choice superseded this one
    state.coat = i; state.cur = c; sync(); setNotice('coat');
  } catch {
    if (wantCoat === i) { wantCoat = state.coat; setNotice('coat', `${COATS[i].name} 이미지를 못 불러왔어요. 다시 눌러 보세요.`); }
  }
}
setCoat(0);

/* ---------- audio ---------- */
let actx = null, noiseGain, noiseFilter;
// No purr: a synthesized low hum sounded like a drone, not a cat (removed at the user's request).
// Looping noise buffer. Pink-ish (white noise through a one-pole lowpass) so the brushing sounds soft, not hissy.
function noiseSource(seconds, smooth) {
  const buf = actx.createBuffer(1, actx.sampleRate * seconds, actx.sampleRate), d = buf.getChannelData(0);
  let y = 0;
  for (let i = 0; i < d.length; i++) { y += (Math.random() * 2 - 1 - y) * smooth; d[i] = y; }
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] /= peak || 1;
  const src = actx.createBufferSource(); src.buffer = buf; src.loop = true; return src;
}
function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  actx = new AC();
  // Brushing fur: soft band of noise; loudness and brightness follow stroke speed.
  noiseFilter = actx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1500; noiseFilter.Q.value = 0.5;
  const brushLp = actx.createBiquadFilter(); brushLp.type = 'lowpass'; brushLp.frequency.value = 4500;
  noiseGain = actx.createGain(); noiseGain.gain.value = 0;
  const brush = noiseSource(2, 0.35);
  brush.connect(noiseFilter).connect(brushLp).connect(noiseGain).connect(actx.destination);
  brush.start();
  if (actx.state === 'suspended') actx.resume();
}
// Every sample playback goes through here, so the browser test can count them.
let samplesPlayed = 0;
function playSample(name, opts) { samplesPlayed++; press(name, opts); }

/* ---------- haptics: only through the native Mac wrapper bridge ---------- */
const bridge = () => window.webkit?.messageHandlers?.haptic;
// A Mac app that makes the fur texture natively announces it; the page then only reports which part of the cat the
// pointer is over, and pointer strokes send no per-step pulses (keyboard petting and buttons still do).
const nativeTexture = () => !!window.petTheCatNative?.texture && !!bridge();
let sentZone = null; // unknown until the first report, so a fresh page's first 'none' is sent too
function reportZone(zone) {
  if (!nativeTexture() || zone === sentZone) return;
  sentZone = zone;
  try { bridge().postMessage({ kind: 'zone', zone }); } catch { /* ignore */ }
}
const gate = makeHapticGate(50, 25);
function haptic(kind) {
  const b = bridge(); if (!b || document.hidden || !document.hasFocus()) return;
  if (!gate(kind, performance.now())) return; // rate limit: see makeHapticGate
  try { b.postMessage({ kind }); } catch { /* ignore */ }
}

// One stroke step. Haptics fire per step; sound does not (strokes are heard through the brushing noise), except a
// soft thump on the tail at most every THUMP_GAP ms.
let lastThump = -1e9;
function tick(intensity, zone, fromPointer = false) {
  if (!(fromPointer && nativeTexture())) haptic(zone === 'tail' ? 'bump' : 'tick');
  if (zone !== 'tail' || !state.sound || !state.armed) return;
  const now = performance.now(); if (now - lastThump < THUMP_GAP) return; lastThump = now;
  playSample('low-thumps', { volume: Math.min(0.35, 0.08 + intensity * 0.2), playbackRate: 0.9 + Math.random() * 0.15 });
}
// First touch on the cat: one soft pat.
function pat() { if (state.sound && state.armed) playSample('uhk-soft', { volume: 0.18, playbackRate: 0.8 + Math.random() * 0.1 }); }

/* ---------- petting ---------- */
const zoneAt = (x, y) => zoneAtMask(mask, x, y);

function sprinkle(x, y, a) {
  const cur = state.cur; if (!cur) return;
  rg.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const sx = x + (Math.random() - 0.5) * 90, sy = y + (Math.random() - 0.5) * 90;
    if (!hit(sx, sy)) continue;
    const k = ((sy | 0) * W + (sx | 0)) * 4, r = cur.px[k], g = cur.px[k + 1], b = cur.px[k + 2];
    const light = Math.random() < 0.55, f = light ? 1.35 : 0.65, add = light ? 28 : 0;
    rg.strokeStyle = `rgba(${Math.min(255, r * f + add)},${Math.min(255, g * f + add)},${Math.min(255, b * f + add)},.7)`;
    rg.lineWidth = 1 + Math.random() * 1.6;
    const len = 10 + Math.random() * 16, aa = a + (Math.random() - 0.5) * 0.6;
    rg.beginPath(); rg.moveTo(sx, sy); rg.lineTo(sx + Math.cos(aa) * len, sy + Math.sin(aa) * len); rg.stroke();
  }
}

function petMove(x, y, dt, pressure, fromPointer = false) {
  const dx = x - state.lastX, dy = y - state.lastY, dist = Math.hypot(dx, dy);
  const v = dist / Math.max(dt, 1) * 1000;
  const frames = Math.max(dt, 1) / (1000 / 60); // per-60Hz-frame rates below, so 120 Hz input feels the same
  state.speed += (Math.min(v, 1800) - state.speed) * (1 - Math.pow(0.65, frames));
  const z = zoneAt(x, y); state.zone = z;
  if (fromPointer) reportZone(z);
  if (z !== 'none') {
    const inten = Math.min(1, state.speed / 900 + pressure * 0.5);
    state.accum += dist;
    const step = 38 - Math.min(14, pressure * 10);
    let n = 0;
    while (state.accum > step && n++ < 2) { state.accum -= step; tick(Math.max(0.15, inten), z, fromPointer); }
    if (state.accum > step) state.accum = 0;
    if (dist > 1) sprinkle(x, y, Math.atan2(dy, dx));
    if (actx && noiseGain && state.sound) {
      noiseGain.gain.setTargetAtTime(brushLevel(state.speed, z), actx.currentTime, 0.06);
      noiseFilter.frequency.setTargetAtTime(1100 + Math.min(state.speed, 1800) * 0.8, actx.currentTime, 0.08);
    }
  }
  state.lastX = x; state.lastY = y;
}

const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
function arm() { if (state.armed) return; state.armed = true; ensureAudio(); $('hint').classList.add('gone'); }

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toCanvas(e), now = performance.now();
  if (!state.inside) { state.lastX = x; state.lastY = y; state.lastT = now; }
  state.inside = true; state.px = x; state.py = y;
  petMove(x, y, now - state.lastT, e.pointerType === 'mouse' ? state.pressure : (e.pressure || 0), true); state.lastT = now;
});
canvas.addEventListener('pointerleave', () => { state.inside = false; state.speed = 0; stopNoise(); reportZone('none'); });
canvas.addEventListener('pointerdown', (e) => {
  arm(); state.down = true; canvas.setPointerCapture?.(e.pointerId);
  const [x, y] = toCanvas(e); state.px = x; state.py = y; state.inside = true; state.lastX = x; state.lastY = y; state.lastT = performance.now();
  if (hit(x, y)) { tick(0.5, zoneAt(x, y), true); pat(); }
});
const release = () => { state.down = false; state.pressure = 0; };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
canvas.addEventListener('webkitmouseforcewillbegin', (e) => e.preventDefault());
canvas.addEventListener('webkitmouseforcechanged', (e) => { state.pressure = Math.max(0, Math.min(2, (e.webkitForce || 1) - 1)); if (!pressureSeen) { pressureSeen = true; updateStatus(); } });
let pressureSeen = false;
function stopNoise() { if (actx && noiseGain) noiseGain.gain.setTargetAtTime(0, actx.currentTime, 0.08); }

// Clear every held-input state (focus loss, tab hidden, pointer lost).
function resetInput() {
  state.down = false; state.pressure = 0; state.kbd = null;
  state.inside = false; state.speed = 0; state.accum = 0; stopNoise(); reportZone('none');
}
window.addEventListener('blur', resetInput);
// Read-only view for the browser test, so it can check held-input state directly.
window.__petState = () => ({ kbd: state.kbd, inside: state.inside, samples: samplesPlayed });
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
canvas.addEventListener('lostpointercapture', release);

// keyboard: space = back, T = tail, M = mute. Modifier combos, key repeat and focused controls are ignored.
window.addEventListener('keydown', (e) => {
  const a = keyAction(e); if (!a) return;
  if (a === 'mute') { toggleSound(); return; }
  e.preventDefault(); arm();
  state.kbd = a;
});
window.addEventListener('keyup', (e) => {
  const a = keyUpAction(e);
  if (a && a === state.kbd) { state.kbd = null; state.inside = false; state.speed = 0; state.accum = 0; stopNoise(); }
});
let phase = 0;
function kbdStep(dt) {
  if (!state.kbd) return;
  phase += dt * 0.0045;
  const x = state.kbd === 'body' ? 600 + Math.sin(phase) * 180 : 940 + Math.sin(phase) * 50;
  const y = state.kbd === 'body' ? 400 + Math.sin(phase * 1.7) * 30 : 450 + Math.sin(phase) * 40;
  if (!state.inside) { state.lastX = x; state.lastY = y; }
  state.px = x; state.py = y; state.inside = true;
  petMove(x, y, dt, 0);
}

/* ---------- UI ---------- */
const sw = $('swatches');
COATS.forEach((c, i) => {
  const b = document.createElement('button'); b.className = 'sw'; b.setAttribute('aria-label', c.name); b.title = c.name;
  b.style.backgroundImage = `url(/cats/t_${c.id}.webp)`;
  b.onclick = () => { arm(); setCoat(i); sync(); if (state.sound) playSample('tonal-on', { volume: 0.2 }); haptic('bump'); };
  sw.appendChild(b);
});
function sync() { [...sw.children].forEach((b, i) => b.setAttribute('aria-pressed', i === state.coat)); }
sync();
function toggleSound() {
  state.sound = !state.sound; arm();
  $('sound').setAttribute('aria-checked', state.sound); $('sound').textContent = state.sound ? '🔊' : '🔇';
  playSample(state.sound ? 'synth-on' : 'synth-off', { volume: 0.25 });
}
$('sound').onclick = toggleSound;
function setDark(v) {
  state.dark = v; $('moon').setAttribute('aria-checked', v); $('moon').textContent = v ? '☀' : '☾';
  document.documentElement.dataset.theme = v ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = v ? '#101722' : '#fbf5ec';
}
$('moon').onclick = () => { arm(); setDark(!state.dark); if (state.sound) playSample('synth-on', { volume: 0.2 }); };
$('full').onclick = () => { arm(); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
function updateStatus() {
  const bits = [bridge()
    ? '햅틱: Mac 앱 연결됨 (신호 전송 중, 실제 트랙패드 진동은 미검증)'
    : '햅틱 없음: 이 화면은 소리와 애니메이션만 나옵니다. 트랙패드 햅틱은 별도 Mac 앱 안에서만 시도됩니다.'];
  if (pressureSeen) bits.push('압력 입력 감지됨(Safari Force Touch)');
  bits.push(...Object.values(notices));
  $('status').textContent = bits.join(' · ');
}
updateStatus();
if (new URLSearchParams(location.search).get('theme') === 'dark') setDark(true); // no sound, no gesture needed

/* ---------- loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(64, now - last); last = now;
  kbdStep(dt);
  state.speed *= Math.pow(0.9, dt / 16);
  const petting = state.inside && state.zone !== 'none' && state.speed > 40;
  if (actx && noiseGain) {
    if (!petting) noiseGain.gain.setTargetAtTime(0, actx.currentTime, 0.08);
  }
  // draw
  if (state.cur) ctx.drawImage(state.cur.img, 0, 0, W, H); else { ctx.fillStyle = '#d9c3a0'; ctx.fillRect(0, 0, W, H); }
  ctx.drawImage(ruffle, 0, 0);
  rg.globalCompositeOperation = 'destination-out'; rg.fillStyle = `rgba(0,0,0,${fadeAlpha(dt)})`; rg.fillRect(0, 0, W, H); rg.globalCompositeOperation = 'source-over';
  if (state.dark) {
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#4a5a8c'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createRadialGradient(150, 60, 10, 150, 60, 800); g.addColorStop(0, 'rgba(120,150,255,.28)'); g.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
  }
  if (state.inside && handImg) {
    const s = 0.62 * (1 - state.pressure * 0.03), ang = Math.max(-0.12, Math.min(0.12, (state.px - state.lastX) / 200));
    ctx.save(); ctx.translate(state.px, state.py); ctx.rotate(ang); ctx.scale(s, s);
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetX = 10; ctx.shadowOffsetY = 18;
    ctx.drawImage(handImg, -140, -40); ctx.restore();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
