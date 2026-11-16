// Guard: il piano Vercel Hobby consente max 12 function. Ogni .js sotto api/ ne conta una.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function elencaJs(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...elencaJs(p));
    else if (/\.(js|mjs|cjs|ts)$/.test(nome)) out.push(p);
  }
  return out;
}

const files = elencaJs(join(ROOT, 'api'));

test('api/ contiene al massimo 10 file (limite Vercel Hobby 12, margine 2)', () => {
  assert.ok(files.length <= 10, `Trovati ${files.length} file in api/: ${files.join(', ')}`);
});

test('api/lib non deve esistere (le librerie stanno in server/)', () => {
  assert.equal(files.some(f => /[\\/]api[\\/]lib[\\/]/.test(f)), false);
});

test('ogni file in api/ esporta un handler di default e si importa senza errori', async () => {
  for (const f of files) {
    const m = await import(pathToFileURL(f).href);
    assert.equal(typeof m.default, 'function', `${f} deve esportare default function`);
  }
});
