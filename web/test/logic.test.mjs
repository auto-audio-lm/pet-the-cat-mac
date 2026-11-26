import test from 'node:test';
import assert from 'node:assert/strict';
import { keyAction, keyUpAction, makeHapticGate, hit, zoneAt, fadeAlpha, isAudioResponse, brushLevel, parsePrefs, W } from '../src/logic.js';

const btn = { tagName: 'BUTTON' }, body = { tagName: 'BODY' };
test('plain keys', () => {
  assert.equal(keyAction({ key: ' ', target: body }), 'body');
  assert.equal(keyAction({ key: 'T', target: body }), 'tail');
  assert.equal(keyAction({ key: 'm', target: body }), 'mute');
});
test('modifier combos are ignored', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) for (const key of [' ', 't', 'm']) assert.equal(keyAction({ key, [mod]: true, target: body }), null);
});
test('mute ignores key repeat, hold keys do not need it', () => {
  assert.equal(keyAction({ key: 'm', repeat: true, target: body }), null);
  assert.equal(keyAction({ key: ' ', repeat: true, target: body }), 'body');
});
test('focused controls keep Space', () => {
  assert.equal(keyAction({ key: ' ', target: btn }), null);
  assert.equal(keyAction({ key: ' ', target: { tagName: 'DIV', getAttribute: () => 'switch' } }), null);
  assert.equal(keyAction({ key: ' ', target: { tagName: 'INPUT' } }), null);
});
test('T and M still work on a focused button; typing in a text field never triggers', () => {
  assert.equal(keyAction({ key: 't', target: btn }), 'tail');
  assert.equal(keyAction({ key: 'm', target: btn }), 'mute');
  for (const key of [' ', 't', 'm']) assert.equal(keyAction({ key, target: { tagName: 'INPUT' } }), null);
  assert.equal(keyAction({ key: 't', target: { tagName: 'DIV', isContentEditable: true } }), null);
});
test('Korean input source: physical T / M keys still map', () => {
  assert.equal(keyAction({ key: 'ㅅ', code: 'KeyT', target: body }), 'tail');
  assert.equal(keyAction({ key: 'ㅡ', code: 'KeyM', target: body }), 'mute');
  assert.equal(keyUpAction({ key: 'ㅅ', code: 'KeyT' }), 'tail');
  // A Latin layout where the KeyT position types another letter keeps its own meaning.
  assert.equal(keyAction({ key: 'y', code: 'KeyT', target: body }), null);
  assert.equal(keyAction({ key: ',', code: 'KeyM', target: body }), null); // AZERTY
  assert.equal(keyAction({ key: '?', code: 'KeyM', shiftKey: true, target: body }), null);
});
test('sound probe needs an audio response, not an HTML fallback', () => {
  const res = (ok, type) => ({ ok, headers: { get: () => type } });
  assert.equal(isAudioResponse(res(true, 'audio/mpeg')), true);
  assert.equal(isAudioResponse(res(true, 'text/html')), false);
  assert.equal(isAudioResponse(res(false, 'audio/mpeg')), false);
  assert.equal(isAudioResponse(res(true, null)), false);
});
test('stroke sound: brushing follows speed, silent off the cat and when still', () => {
  assert.equal(brushLevel(0, 'body'), 0);
  assert.equal(brushLevel(900, 'none'), 0);
  assert.ok(brushLevel(300, 'body') < brushLevel(900, 'body'));
  assert.ok(brushLevel(900, 'tail') < brushLevel(900, 'body'));
  assert.ok(brushLevel(5000, 'body') <= 0.045);
});
test('saved preferences: valid values kept, anything else falls back', () => {
  const d = { coat: 0, sound: true, dark: false };
  assert.deepEqual(parsePrefs(null, 10), d);
  assert.deepEqual(parsePrefs('not json', 10), d);
  assert.deepEqual(parsePrefs('[1,2]', 10), { coat: 0, sound: true, dark: false });
  assert.deepEqual(parsePrefs('{"coat":3,"sound":false,"dark":true}', 10), { coat: 3, sound: false, dark: true });
  assert.deepEqual(parsePrefs('{"coat":12,"sound":"no","dark":1}', 10), d);
  assert.deepEqual(parsePrefs('{"coat":-1}', 10), d);
  assert.deepEqual(parsePrefs('{"coat":2.5}', 10), d);
});
test('keyup mapping', () => { assert.equal(keyUpAction({ key: ' ' }), 'body'); assert.equal(keyUpAction({ key: 'T' }), 'tail'); assert.equal(keyUpAction({ key: 'x' }), null); });
test('haptic gate: tick 50ms, bump 25ms, bump not starved', () => {
  const g = makeHapticGate(50, 25);
  assert.equal(g('tick', 1000), true);
  assert.equal(g('tick', 1030), false);
  assert.equal(g('bump', 1030), true);   // 30ms after tick: allowed
  assert.equal(g('bump', 1060), false);  // bumps at most every 120ms
  assert.equal(g('tick', 1070), false);  // within 50ms of the bump
  assert.equal(g('tick', 1085), true);
  assert.equal(g('bump', 1100), false);  // 15ms after tick
  assert.equal(g('bump', 1200), true);
});
test('mask hit and zones', () => {
  const m = new Uint8ClampedArray(1200 * 800 * 4);
  const set = (x, y) => { m[(y * 1200 + x) * 4] = 255; };
  set(100, 100); set(900, 100);
  assert.equal(hit(m, 100, 100), true); assert.equal(hit(m, 101, 100), false); assert.equal(hit(null, 100, 100), false);
  assert.equal(hit(m, -1, 5), false); assert.equal(hit(m, W, 5), false);
  assert.equal(zoneAt(m, 100, 100), 'body'); assert.equal(zoneAt(m, 900, 100), 'tail'); assert.equal(zoneAt(m, 5, 5), 'none');
});
test('fade is frame-rate independent', () => {
  assert.ok(Math.abs(fadeAlpha(1000 / 60) - 0.045) < 1e-9);
  const two = 1 - (1 - fadeAlpha(1000 / 120)) ** 2; assert.ok(Math.abs(two - fadeAlpha(1000 / 60)) < 1e-9);
  assert.equal(fadeAlpha(0), 0);
});
