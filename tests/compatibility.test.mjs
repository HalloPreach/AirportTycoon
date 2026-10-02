// BL-05 — compatibilité réalisable (AC17, R4 : A8, A13) + plafond A-5 + garde satisfaction.
// Scénario seed 42 (la preuve exigée par la carte) : sur un aéroport CONNECTÉ
// (plan corrigé BL-02), plus d'avions bloqués indéfiniment, satisfaction ≠ 0 %,
// et les gros avions (L) sont servis (porte L constructible, A8).
// On réutilise le PRNG mulberry32 des tests (déterminisme reproductible).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { spawnArrivals, decideFlight } from '../src/flights/flights.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { earn } from '../src/economy/economy.mjs';

// PRNG déterministe (mulberry32) — identique aux autres tests.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Aéroport CONNECTE : la géométrie « bien conçue » du plan des tests (BL-02).
// Les segments se TOUCHENT physiquement → findPath relie piste ↔ portes.
function connectedAirport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}

// A8 (corrigé) : une porte L est CONSTRUCTIBLE — chaque terminal en porte une.
// Sans ça, les gros avions (L) n'ont aucune infra réalisable (A8 d'origine).
test('A8 corrigé : un terminal construit une porte L', () => {
  const sim = connectedAirport();
  const sizes = sim.infra.gates.map((g) => g.size);
  assert.ok(sizes.includes('L'), 'au moins une porte L (avant : seulement S/M)');
  // et les petits/medium restent servis (on n'a pas retiré les autres tailles).
  assert.ok(sizes.includes('S') && sizes.includes('M'), 'portes S et M toujours présentes');
});

// A-5 (A13) : le plafond d'arrivées compte les avions `blocked`.
// Sans ça, les annulations A-5 laissent le plafond vide et les arrivées repartent
// sans fin → 10 avions bloqués en permanence (le symptôme A13 d'origine).
test('A-5 : le plafond d’arrivées compte les avions bloqués', () => {
  const sim = connectedAirport();
  // 4 avions bloqués (le MAX_PENDING) → plus d'arrivées malgré des portes libres.
  sim.aircraft = [0, 1, 2, 3].map((i) => ({
    id: i, airline: 'x', color: '#fff', acType: 'medium', pax: 10,
    phase: 'blocked', x: 800, y: 1100, gateId: null, runwayId: sim.infra.runways[0].id,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  }));
  sim._spawnAcc = 999; // force l'essai de spawn
  spawnArrivals(sim, 0.1, rng(1));
  assert.equal(sim.aircraft.length, 4, 'aucune nouvelle arrivée (plafond bloqué)');
});

// AC17 / seed 42 : aéroport connecté — plus de blocages, satisfaction ≠ 0 %,
// cycle complet tournant (passagers transportés, vol L inclus).
test('AC17 / seed 42 : aéroport connecté — blocages finis, satisfaction ≠ 0 %', async () => {
  const state = makeGameState();
  state.screen = 'game';
  state.sim = connectedAirport();
  const random = rng(42);
  // 60 min simulées : les vols L arrivent et sont servis, la satisfaction
  // se stabilise loin de 0 (A13 d'origine : 0 % avec 10 avions bloqués).
  // BL-16 (AC20) : le JEU décide — auto-accept chaque tick (case du panneau),
  // la sim ne déploie que les vols « accepted ».
  for (let i = 0; i < 36000; i++) {
    for (const e of state.sim.planning) if (e.status === 'planned') decideFlight(state.sim, e.id, true);
    tick(state, 0.1, random);
  }
  const sim = state.sim;
  const blocked = sim.aircraft.filter((a) => a.phase === 'blocked').length;
  assert.equal(blocked, 0, `aucun avion bloqué en fin (seed 42) — trouvé ${blocked}`);
  assert.ok(sim.passengers.satisfaction > 0,
    `satisfaction non nulle : ${sim.passengers.satisfaction.toFixed(0)} %`);
  assert.ok(sim.passengers.totalCarried > 0, 'des passagers transportés (cycle complet)');
});

// Garde satisfaction (A13) : satisfaction 0 % → les recettes ne croissent PAS.
test('satisfaction 0 % stoppe la croissance des recettes', () => {
  const sim = connectedAirport();
  sim.passengers.satisfaction = 0;
  const before = sim.economy.money;
  earn(sim, 5000, 'pax');
  assert.equal(sim.economy.money, before, 'aucune recette encaissée (garde)');
  // Et la normalité revient dès que la satisfaction remonte.
  sim.passengers.satisfaction = 100;
  earn(sim, 5000, 'pax');
  assert.equal(sim.economy.money, before + 5000, 'recettes de nouveau encaissées');
});
