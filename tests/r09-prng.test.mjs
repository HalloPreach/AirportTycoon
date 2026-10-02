// R09 — Corriger le PRNG et préserver la reprise.
// Le défaut (constat G0/R02) : le seed N'ENTRAIT PAS dans la suite mulberry32
// (le générateur ne consommait que rngCounter) → seed 42 et 99 jouaient la
// MÊME partie. Corrigé (rng.mjs) : le seed est mélangé (t0 = seed + CONST) →
// même seed + mêmes commandes → même suite ; seeds différents → suites
// différentes ; reprise au milieu d'une suite → mêmes prochains tirages.
// Migration (D3) : les anciennes sauvegardes (sans seed effectif) → seed 0 :
// la suite redevient EXACTEMENT la suite pré-R09 (l'ancrage). Les FIXTURES de
// migration sont conservées (tests/fixtures/) — corriger l'algorithme change la
// suite historique, on ne la réécrira jamais silencieusement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSimRng } from '../src/core/rng.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { serialize, deserialize, SAVE_VERSION } from '../src/persistence/save.mjs';

// La suite PRÉ-R09, référence : exactement l'ancien algorithme (counter + CONST
// seul, le seed ignoré) — la migration doit y ramener bit-à-bit (seed 0).
function preR09Rng() {
  let c = 0;
  return function () {
    c = (c + 1) | 0;
    let t = (c + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- VALIDATION 1 : même seed et mêmes commandes → même suite ---------------
test('R09 : même seed (nouvel algorithme) → même suite de tirages', () => {
  const a = makeSimRng({ rngSeed: 42, rngCounter: 0 });
  const b = makeSimRng({ rngSeed: 42, rngCounter: 0 });
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB, 'même seed + mêmes appels → mêmes tirages');
  assert.ok(seqA.every((v) => v >= 0 && v < 1), 'les tirages restent dans [0,1)');
});

// --- VALIDATION 2 : seeds différents → suites différentes ----------------------
test('R09 : seeds différents (42 vs 99) → suites DIFFÉRENTES (le défaut G0/R02)', () => {
  const a = makeSimRng({ rngSeed: 42, rngCounter: 0 });
  const b = makeSimRng({ rngSeed: 99, rngCounter: 0 });
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.notDeepEqual(seqA, seqB, 'le seed EST mélangé : 42 ≠ 99 (avant R09 : identique)');
  assert.notDeepEqual(seqA.slice(0, 10), seqB.slice(0, 10), 'les premiers tirages sont déjà divergents');
});

// --- VALIDATION 3 : reprise au milieu d'une suite → mêmes prochains tirages ---
test('R09 : reprise au milieu de la suite → mêmes prochains tirages que sans interruption', () => {
  // Sans interruption : 20 tirages, l'état (seed, compteur) est sur la sim.
  const full = makeSimRng({ rngSeed: 7, rngCounter: 0 });
  for (let i = 0; i < 20; i++) full();
  const after = Array.from({ length: 20 }, () => full());
  // Reprise : on recharge l'ÉTAT SÉRIALISÉ (seed + compteur) → même générateur.
  const restored = { rngSeed: 7, rngCounter: 20 };
  const back = makeSimRng(restored);
  const afterBack = Array.from({ length: 20 }, () => back());
  assert.deepEqual(after, afterBack, 'reprise au milieu → la suite continue où elle s\'était arrêtée');
});

// --- D3 : le seed d'une nouvelle partie est généré À LA FRONTIÈRE DE CRÉATION -
test('R09 (D3) : nouvelle partie → seed aléatoire à la frontière, bornée 32 bits, imposable', () => {
  const a = makeGameState();
  const b = makeGameState();
  assert.ok(Number.isInteger(a.sim.rngSeed), 'le seed est un entier (sérialisable JSON)');
  assert.ok(a.sim.rngSeed >= -2147483648 && a.sim.rngSeed <= 2147483647, 'le seed est borné 32 bits');
  // La seed est ALEATOIRE : deux parties consécutives n'ont PAS la même suite.
  // (La probabilité d'un collision est ~ 1/2^31 — négligeable, ponytail.)
  const s1 = makeSimRng(a.sim); const s2 = makeSimRng(b.sim);
  assert.notDeepEqual(
    [s1(), s1(), s1()], [s2(), s2(), s2()],
    'deux nouvelles parties → deux suites différentes (seed aléatoire à la frontière)',
  );
  // Seed IMPOSÉE (scénarios) : la partie est reproductible EXACTEMENT.
  const fixed = makeGameState(42);
  assert.equal(fixed.sim.rngSeed, 42, 'makeGameState(42) impose la seed du scénario');
  const fixed2 = makeGameState(42);
  assert.deepEqual(
    Array.from({ length: 10 }, () => makeSimRng(fixed.sim)()),
    Array.from({ length: 10 }, () => makeSimRng(fixed2.sim)()),
    'même seed imposée + mêmes appels → mêmes tirages (reproductible)',
  );
});

// --- ÉV-10 : l'état PRNG (seed + compteur) traverse la sauvegarde ------------
test('R09 : état PRNG sérialisé + restauré → la suite continue sans interruption', () => {
  const state = makeGameState(1234);
  state.sim.rngCounter = 5;
  const back = deserialize(serialize(state));
  assert.equal(back.sim.rngSeed, 1234, 'la seed est préservée dans la sauvegarde');
  assert.equal(back.sim.rngCounter, 5, 'le compteur est préservé dans la sauvegarde');
  // La suite RESTAURÉE = la suite qui aurait suivi sans fermeture (validation 3).
  const r1 = makeSimRng(back.sim);
  const r2 = makeSimRng({ rngSeed: 1234, rngCounter: 5 });
  assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()], 'reprise via la sauvegarde → même suite');
});

// --- MIGRATION (D3) : les anciennes sauvegardes sans seed → seed 0 ------------
// Fixture conservée : un état « pré-R09 » tel que le jeu le produisait (champ
// rngSeed ABSENT — il n'existait pas) : le compteur vit, la seed non.
// La migration DOIT y ramener la suite pré-R09 bit-à-bit (l'ancrage).
test('R09 (migration) : sauvegarde pré-R09 (sans seed) → migration seed 0, suite pré-R09', () => {
  const fixPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pre-r09-save.json');
  const fix = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
  assert.equal(fix.state.sim.rngSeed, undefined, 'la fixture est BIEN pré-R09 : pas de champ rngSeed');
  const back = deserialize(JSON.stringify(fix));
  assert.equal(back.sim.rngSeed, 0, 'migration (D3) : seed absente → seed 0');
  assert.equal(back.sim.rngCounter, 3, 'le compteur est restauré');
  // L'ancrage : la suite MIGRÉE = la suite PRÉ-R09 bit-à-bit (seed 0).
  const migrated = makeSimRng(back.sim);
  const preR09 = preR09Rng();
  for (let i = 0; i < 3; i++) preR09(); // on reprend à compteur 3 (la fixture)
  const seqM = Array.from({ length: 20 }, () => migrated());
  const seqP = Array.from({ length: 20 }, () => preR09());
  assert.deepEqual(seqM, seqP, 'la suite migrée (seed 0) est bit-à-bit la suite pré-R09');
});

// --- MIGRATION (D3) : un champ PRÉSENT mais de mauvais type → REFUSÉ ----------
// (La fixture 2 : rngSeed = null — présent mais non entier : une sauvegarde
// corrompue, jamais acceptée silencieusement. Le refus lisible, pas le crash.)
test('R09 (migration) : rngSeed présent mais non entier (null) → sauvegarde REFUSÉE', () => {
  const fixPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'corrupt-rng-save.json');
  const fix = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
  assert.equal(fix.state.sim.rngSeed, null, 'la fixture est BIEN corrompue : rngSeed = null');
  assert.throws(
    () => deserialize(JSON.stringify(fix)),
    /seed du générateur/i,
    'le défaut est Nommé dans le message (le champ, pas un crash)',
  );
});
