#!/usr/bin/env node
// Génère les propositions d'icônes pixel art via PixelLab v2 (create-image-pixflux).
// Usage: node scripts/generate-branding.mjs <bot|support> [count]
// Clé lue depuis apps/bot/.env (PIXELLAB_API_KEY) - jamais commitée.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const key = process.argv[2];
const kind = process.argv[3] ?? 'bot';
const count = Number(process.argv[4] ?? 10);

if (!key) {
  console.error('Usage: node scripts/generate-branding.mjs <PIXELLAB_API_KEY> <bot|support> [count]');
  process.exit(1);
}

const BG = '#111114';

const BOT_CONCEPTS = [
  ['Round robot head with big cyan glowing eyes', '#3987e5'],
  ['Square robot face with teal visor and small antenna', '#199e70'],
  ['Robot head with purple glowing eyes and side bolts', '#9085e9'],
  ['Cute round robot with golden antenna light', '#c98500'],
  ['Robot head merged with a chat speech bubble shape, blue visor', '#3987e5'],
  ['Hexagonal robot core with orange glowing center eye', '#d95926'],
  ['Floating orb bot with pink glow and small fins', '#d55181'],
  ['Robot head with cat ears and teal eyes', '#199e70'],
  ['Robot head with a gear cog on top, gold gear', '#c98500'],
  ['Minimal robot silhouette in white lines, glowing white eyes', '#f2f2f5'],
];

const SUPPORT_CONCEPTS = [
  ['Shield with a wrench emblem', '#199e70'],
  ['Shield with a blue speech bubble emblem', '#3987e5'],
  ['Shield with a bold checkmark', '#199e70'],
  ['Lifebuoy ring with rope details', '#d95926'],
  ['Support headset with microphone', '#9085e9'],
  ['Shield with a lightning bolt', '#c98500'],
  ['Heart inside a shield', '#d55181'],
  ['Grid of four small shields', '#3987e5'],
  ['Speech bubble wearing a tiny shield', '#72c99b'],
  ['Star badge on a shield', '#f2f2f5'],
];

const concepts = kind === 'bot' ? BOT_CONCEPTS : SUPPORT_CONCEPTS;
const outDir = join('docs', 'branding', 'proposals');
mkdirSync(dirname(join(outDir, 'x')), { recursive: true });

let ok = 0;
for (let i = 0; i < Math.min(count, concepts.length); i++) {
  const [description, color] = concepts[i];
  const num = String(i + 1).padStart(2, '0');
  const file = join(outDir, `${kind}-${num}.png`);
  try {
    const res = await fetch('https://api.pixellab.ai/v2/create-image-pixflux', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        description: `pixel art icon, ${description}, accent color ${color}, dark background ${BG}, bold black outline, crisp readable pixel art`,
        image_size: { width: 128, height: 128 },
        no_background: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const b64 = data?.image?.base64?.replace(/^data:image\/png;base64,/, '');
    if (!res.ok || !b64) {
      console.log(`FAIL ${file} status=${res.status} ${JSON.stringify(data).slice(0, 120)}`);
      continue;
    }
    writeFileSync(file, Buffer.from(b64, 'base64'));
    ok++;
    console.log(`OK  ${file} (${color})`);
  } catch (error) {
    console.log(`ERR ${file}: ${error.message}`);
  }
}
console.log(`Done: ${ok}/${Math.min(count, concepts.length)} generated.`);
