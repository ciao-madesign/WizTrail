// Se un file del precache del service worker non esiste, l'installazione del SW fallisce per tutti gli utenti.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');

function elenco(nome) {
  const m = src.match(new RegExp(`const ${nome} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${nome} non trovato in service-worker.js`);
  return [...m[1].replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

test('ogni percorso di CORE_CACHE e PAGE_CACHE esiste nel repo', () => {
  const mancanti = [...elenco('CORE_CACHE'), ...elenco('PAGE_CACHE')]
    .filter(p => p !== '/')
    .filter(p => !fs.existsSync(path.join(ROOT, p.replace(/^\//, ''))));
  assert.deepEqual(mancanti, []);
});

test('CACHE_VERSION ha il formato wiztrail-vYYYY-MM-DD<lettera>', () => {
  assert.match(src, /const CACHE_VERSION = "wiztrail-v\d{4}-\d{2}-\d{2}[a-z]";/);
});
