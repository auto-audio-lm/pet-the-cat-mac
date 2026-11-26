// Prepares and checks everything the page needs from public/ before a build.
// Sounds are copied from the MIT-licensed `button-sounds` npm package; cat images are committed in public/cats.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOUNDS = ['uhk-soft', 'low-thumps', 'synth-on', 'synth-off', 'tonal-on', 'hi75-soft'];
const COATS = ['black', 'orange', 'calico', 'white', 'mackerel', 'tuxedo', 'brown', 'grey', 'siamese', 'cream'];

mkdirSync(join(root, 'public/sounds'), { recursive: true });
const pkg = join(root, 'node_modules/button-sounds');
for (const n of SOUNDS) {
  const src = join(pkg, 'assets', `${n}.mp3`), dst = join(root, 'public/sounds', `${n}.mp3`);
  if (existsSync(src)) copyFileSync(src, dst);
}
if (existsSync(join(pkg, 'LICENSE'))) copyFileSync(join(pkg, 'LICENSE'), join(root, 'public/sounds/LICENSE-button-sounds.txt'));

const required = [
  ...SOUNDS.map((n) => `public/sounds/${n}.mp3`),
  'public/cats/mask.png', 'public/cats/hand.webp',
  ...COATS.flatMap((c) => [`public/cats/${c}.webp`, `public/cats/t_${c}.webp`]),
];
const missing = required.filter((f) => !existsSync(join(root, f)) || statSync(join(root, f)).size < 1000);
if (missing.length) { console.error('Missing or empty assets:\n  ' + missing.join('\n  ')); process.exit(1); }
console.log(`assets ok (${required.length} files)`);
