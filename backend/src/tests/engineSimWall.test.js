import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The bots in src/sim stand in for riders' phones and customers' apps. They may only use the
// engine's public commands, never its internals or the database (decision A3).

const SIM_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sim');

const ALLOWED_RELATIVE_IMPORTS = [
  /^\.\/[\w.-]+\.js$/,             // other bot files
  /^\.\.\/engine\/index\.js$/,     // the engine's public commands
  /^\.\.\/config\/constants\.js$/, // shared constants and live config
  /^\.\.\/utils\/[\w.-]+\.js$/,    // pure helpers (geometry, maths)
];

function importSpecifiers(source) {
  const specifiers = [];
  const importPattern = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = importPattern.exec(source))) specifiers.push(match[1] ?? match[2]);
  return specifiers;
}

test('every bot file imports only the engine public API, constants, utils or packages', () => {
  const botFiles = readdirSync(SIM_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(botFiles.length > 0, 'expected bot files in src/sim');

  for (const file of botFiles) {
    for (const specifier of importSpecifiers(readFileSync(join(SIM_DIR, file), 'utf8'))) {
      const isPackage = !specifier.startsWith('.');
      const isAllowed = isPackage || ALLOWED_RELATIVE_IMPORTS.some((rule) => rule.test(specifier));
      assert.ok(isAllowed, `src/sim/${file} imports "${specifier}", which crosses the engine wall`);
    }
  }
});

test('the wall check catches a bot reaching into engine internals', () => {
  const offending = importSpecifiers("import { riderState } from '../engine/state.js';");
  assert.deepEqual(offending, ['../engine/state.js']);
  assert.ok(!ALLOWED_RELATIVE_IMPORTS.some((rule) => rule.test(offending[0])));
});
