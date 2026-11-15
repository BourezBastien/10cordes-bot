#!/usr/bin/env node
// Postbuild : duplique le config compilé en .js pour le ConfigLoader
// (il cherche .spraxium/dist/spraxium.config.js ; tsdown émet .mjs).
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps', 'bot', '.spraxium', 'dist', 'spraxium.config.mjs');
const target = join(root, 'apps', 'bot', '.spraxium', 'dist', 'spraxium.config.js');

if (existsSync(source)) {
  copyFileSync(source, target);
  console.log(`copied ${source} -> ${target}`);
}
else {
  console.log(`no compiled config found at ${source} (skipped)`);
}
