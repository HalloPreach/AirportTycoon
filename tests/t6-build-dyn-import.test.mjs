// T6 (t_87168414) : REGRESSION BUILD — les imports dynamiques relatifs
// (5 sites : sim.mjs ×3, build-tool.mjs ×2) doivent être réécrits en
// __dyn('<id>') par tools/build-standalone.mjs. Un typo dans RE_DYNAMIC
// (référence arrière `\2` au lieu de `\1`) rendait le regex NON-MATCHANT :
// les 5 sites restaient BRUTS dans le bundle et, sur l'entrée docs
// (docs/game.html + docs/standalone.js, IIFE), `import('../infra/infra.mjs')`
// résolvait en URL relative → 404 → fallback `.catch` → toast
// « Simulation non prête » (la pose de bâtiment échouait silencieusement).
// Preuve d'exécution de la CORRECTE entrée : qa/t6-docs-entry.mjs (tap
// pose EXACTEMENT 1 bâtiment sur l'entrée docs).
// node:test, zéro DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TOOL = join(ROOT, 'tools', 'build-standalone.mjs');
const DIST_JS = join(ROOT, 'dist', 'standalone.js');
const DOCS_JS = join(ROOT, 'docs', 'standalone.js');

// --- 1. La source de l'outil porte le bon RE_DYNAMIC (référence `\1`) -------
// (le `\1` vise le GROUPE 1 = le guillemet ouvrant ; un `\2` viserait le
// contenu et le regex ne matcherait plus jamais.)
test('T6 build : RE_DYNAMIC référence le guillemet (\\1), pas le contenu (\\2)', () => {
  const src = readFileSync(TOOL, 'utf8');
  const m = src.match(/const RE_DYNAMIC = (\/[^\n]*?)\n/);
  assert.ok(m, 'RE_DYNAMIC est déclaré dans tools/build-standalone.mjs');
  assert.ok(m[1].includes('\\1'), 'la référence arrière cible le guillemet (\\1)');
  assert.ok(!m[1].includes('\\2'), 'aucune référence au contenu (\\2) — bug corrigé');
});

// --- 2. L'artefact : AUCUN import dynamique relatif RESIDUEL dans le bundle -
// (le build s'auto-vérifie sur ce point — check (b2) post-build ; le test
// l'attache aussi au bundle COMMITTE, pour qu'une régression de build non
// réémise ne passe pas inaperçue.)
test('T6 build : 0 import dynamique relatif résiduel dans dist/standalone.js', () => {
  if (!existsSync(DIST_JS)) {
    throw new Error('dist/standalone.js absent — lancer `npm run build` (l’artefact est commité)');
  }
  const bundle = readFileSync(DIST_JS, 'utf8');
  const raw = [...bundle.matchAll(/\bimport\s*\(\s*(['"])\.\.?\/[^'"]+\1/g)];
  assert.equal(raw.length, 0, `imports dynamiques relatifs résiduels (404 à l'exécution) : ${raw.slice(0, 3).map((m) => m[0]).join(' | ')}`);
});

// --- 3. Les 5 sites sont bien réécrits __dyn( (registre du bundle) ---------
test('T6 build : les 5 sites d’import dynamiques sont des appels __dyn( ', () => {
  if (!existsSync(DIST_JS)) {
    throw new Error('dist/standalone.js absent — lancer `npm run build` (l’artefact est commité)');
  }
  const bundle = readFileSync(DIST_JS, 'utf8');
  const calls = [...bundle.matchAll(/__dyn\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 5, `≥ 5 appels __dyn attendus (5 sites source), vu : ${calls.length}`);
  const count = (id) => calls.filter((c) => c === id).length;
  assert.equal(count('m_src_core_tick'), 1, 'sim.mjs → tick.mjs');
  assert.equal(count('m_src_core_sim-state'), 1, 'sim.mjs → sim-state.mjs');
  assert.equal(count('m_src_infra_infra'), 3, 'sim.mjs → infra.mjs + build-tool.mjs ×2');
});

// --- 4. Le MIRROR docs est à JOUR du bundle dist (invariant de livraison) --
// (docs/standalone.js est la copie du bundle servie par docs/game.html ;
// la divergence était la cause racine du faux vert initial.)
test('T6 docs : docs/standalone.js est IDENTIQUE à dist/standalone.js', () => {
  if (!existsSync(DIST_JS) || !existsSync(DOCS_JS)) {
    throw new Error('dist/ ou docs/standalone.js absent — `npm run build` puis resynchronisation du bundle docs');
  }
  const a = readFileSync(DIST_JS);
  const b = readFileSync(DOCS_JS);
  assert.equal(b.length, a.length, 'même taille de bundle (docs = mirror de dist)');
  assert.ok(a.equals(b), 'docs/standalone.js === dist/standalone.js (byte-à-byte)');
});
