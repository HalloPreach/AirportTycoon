// R15 (t_5d77c1d6) — unité de temps & unités lisible, vérification.
// L'unité interne unique est la SECONDE DE JEU. Le « coût affiché par minute »
// d'un bâtiment (opexPerMin) DOIT égaliser le débit constaté sur 60 s de jeu ;
// la pause ne débite rien ; x4 accélère temps et sim de façon cohérente.
// Aucun DOM : horloge pure (game-state.mjs) + tickEconomy (economy.mjs) + accès
// catalog (opexPerMin/opexPerHour). Ces accès = la source de vérité que la UI
// affiche (src/ui/panels.mjs) — mêmes chiffres que la règle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEX_PER_SEC, opexPerMin, opexPerHour } from '../src/data/catalog.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { tickEconomy } from '../src/economy/economy.mjs';
import { newGame, setScreen, togglePause, advanceTime } from '../src/core/game-state.mjs';
import { newSimState } from '../src/core/sim-state.mjs';

const close = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

test('R15 : les accès lisible sont dérivés de OPEX_PER_SEC (pas d\'état parallèle)', () => {
  for (const t of Object.keys(OPEX_PER_SEC)) {
    assert.ok(close(opexPerMin(t), OPEX_PER_SEC[t] * 60), `${t} : $/min = $/s × 60`);
    assert.ok(close(opexPerHour(t), OPEX_PER_SEC[t] * 3600), `${t} : $/h = $/s × 3600`);
    // cohérence min↔h : l'heure est la minute × 60 (pas de 2e échelle).
    assert.ok(close(opexPerHour(t), opexPerMin(t) * 60), `${t} : $/h = $/min × 60`);
  }
});

test('R15 : le coût affiché d\'un bâtiment par minute = le débit constaté sur 60 s', () => {
  const sim = newSimState();
  const runway = buildBuilding(sim, 'runway', 0, 0);
  assert.ok(runway, 'une piste se pose (fonds de départ suffisants)');
  // 60 s de jeu, aucun vol : le débit d'exploitation EST opexPerMin('runway').
  const opexBefore = sim.economy.spent.opex ?? 0;
  tickEconomy(sim, 60);
  const drained = (sim.economy.spent.opex ?? 0) - opexBefore;
  assert.ok(close(drained, opexPerMin('runway')), `débit 60 s (${drained}) = affiché $/min (${opexPerMin('runway')})`);
  assert.ok(close(drained, OPEX_PER_SEC.runway * 60), 'le débit 60 s = OPEX_PER_SEC.runway × 60 (source de vérité)');
});

test('R15 : la pause ne débite rien (pas de temps de jeu, pas d\'exploitation)', () => {
  const state = newGame();
  setScreen(state, 'game');
  const sim = newSimState();
  buildBuilding(sim, 'runway', 0, 0);
  togglePause(state); // en pause
  assert.equal(advanceTime(state, 1.0), 0, 'en pause : 0 seconde de jeu consommée');
  const opexBefore = sim.economy.spent.opex ?? 0;
  tickEconomy(sim, advanceTime(state, 1.0)); // tick appelé avec 0 s de jeu
  assert.equal(sim.economy.spent.opex ?? 0, opexBefore, 'aucune exploitation débitée en pause');
});

test('R15 : x4 accélère temps et simulation de façon cohérente (4× le débit)', () => {
  const state1 = newGame(); setScreen(state1, 'game'); state1.speedIndex = 0; // x1
  const state4 = newGame(); setScreen(state4, 'game'); state4.speedIndex = 2; // x4 (SPEEDS = [1,2,4])
  const played1 = advanceTime(state1, 1.0); // 1 s réelle à vitesse x1
  const played4 = advanceTime(state4, 1.0); // 1 s réelle à vitesse x4
  assert.equal(played1, 1.0, 'x1 : 1 s réelle = 1 s de jeu');
  assert.equal(played4, 4.0, 'x4 : 1 s réelle = 4 s de jeu');
  // La sim avance d'autant de temps de jeu que l'horloge : le débit d'opex est
  // proportionnel au temps de jeu consommé → x4 débite 4× en même temps réel.
  const sim = newSimState();
  buildBuilding(sim, 'runway', 0, 0);
  const a = sim.economy.spent.opex ?? 0; tickEconomy(sim, played1); const d1 = (sim.economy.spent.opex ?? 0) - a;
  const b = sim.economy.spent.opex ?? 0; tickEconomy(sim, played4); const d4 = (sim.economy.spent.opex ?? 0) - b;
  assert.ok(close(d4, d1 * 4), 'x4 débite 4× l\'exploitation de x1 (temps ET simulation cohérents)');
});
