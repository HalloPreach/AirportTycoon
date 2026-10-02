// R17 (t_fc0d1920) — retards/goulots par cause, fenêtre bornée, dénominateur
// clair. Vérifications (zéro DOM, déterministe, rng semé) :
//   1. D7 : un avion EN ATTENTE cumule le retard UNE seule fois — doHolding
//      (aircraft.mjs) est le SEUL compteur ; le planificateur ne le duplique
//      plus (avant R17, les deux modules faisaient a.delayed += dt).
//   2. causeAt : la cause du retard est LUE de l'état (piste/porte/segment/
//      carburant/passagers) — le goulot qui retient le vol, pas un compteur.
//   3. Fenêtre bornée : sim.punctuality ne contient que les N fins de vol les
//      plus récentes (départs + annulations) — pas d'historique sans fin.
//   4. Dénominateur clair : la ponctualité COMPTÉ les annulations (départ
//      annulé = non ponctuel) ; null = aucun vol terminé (pas de faux chiffre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickAircraft, causeAt, DELAY_CAUSE_FR, punctualityStats, logFlightEnd, ensurePunctuality, nominalRotation, DELAY_WINDOW_S } from '../src/sim/aircraft.mjs';
import { tickPlanner } from '../src/flights/flights.mjs';
import { tickEconomy } from '../src/economy/economy.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { AIRCRAFT, NOMINAL_TURNOVER_S, REFUEL_TIME_S } from '../src/data/catalog.mjs';

// Socle « bien conçu » (géométrie prouvée, coord. incidents.test.mjs).
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}
function seedApproach(sim, acType = 'medium') {
  const ac = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType, pax: 160,
    phase: 'approach', x: 800, y: -150, gateId: null, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(ac);
  return ac;
}
// Avance la sim de n ticks (dt = 0.1 s) — ordre tick.mjs : planificateur
// (horloge sim.time) → avions → éco. (pas d'incidents aléatoires : rng fixé.)
function runSim(sim, n, dt = 0.1) {
  const rng = sim._testRng ?? (() => 0.5);
  for (let i = 0; i < n; i++) {
    tickPlanner(sim, dt, rng);
    tickAircraft(sim, dt);
    tickEconomy(sim, dt);
  }
}

test('R17/D7 : un avion en attente cumule le retard UNE fois (pas 2×)', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 100000;
  const ac = seedApproach(sim);
  // Fermeture piste FORCÉE → l'avion atterrit en holding (pas de piste libre).
  forceIncident(sim, 'runway');
  // 30 s de jeu : le retard DOIT égaliser 30 s (1×). Avant R17, le planificateur
  // + doHolding cumulaient 2× (60 s) — « un avion arrêté ne cumule pas 2× le
  // même retard dans plusieurs modules ».
  runSim(sim, 300); // 300 × 0.1 s = 30 s
  assert.ok(ac.phase === 'holding', `l'avion est en attente (phase ${ac.phase})`);
  assert.ok(Math.abs(ac.delayed - 30) < 0.5, `retard = 30 s (constaté ${ac.delayed} s) — cumulé UNE fois`);
  // La cause est LUE : le goulot est la PISTE (fermée → attente).
  assert.equal(causeAt(sim, ac), 'piste', 'cause lue = piste');
  assert.ok(DELAY_CAUSE_FR.piste, 'la cause est traduite en français (UI)');
});

test('R17 : la cause lue est le GOUTOU qui retient le vol (pas un compteur)', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 100000;
  // Piste libre mais OCCUPÉE (un atterrissage en cours) → attente, cause = piste.
  const busy = seedApproach(sim); busy.phase = 'landing'; busy.runwayId = sim.infra.runways[0].id;
  const ac = seedApproach(sim);
  runSim(sim, 50); // 5 s : le 2e avion attend la piste (le 1er atterrit)
  assert.ok(ac.delayed > 0, `l'avion est en retard (${ac.delayed} s)`);
  assert.equal(causeAt(sim, ac), 'piste', 'goulot = piste (occupée)');
  // Pas de retard → cause null (l'avion au décollage/normal n'a pas de goulot).
  const clean = seedApproach(sim, 'large'); clean.phase = 'departure'; clean.runwayId = null;
  clean.delayed = 0; clean._delayCause = null;
  assert.equal(causeAt(sim, clean), null, 'pas de retard actif → cause null');
});

test('R17 : la fenêtre de ponctualité est BORNÉE (pas de croissance sans fin)', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 100000;
  sim.time = 100000; // au-delà de la fenêtre (DELAY_WINDOW_S = 1800 s)
  // 200 fins de vol artificielles (départs) : la fenêtre ne garde que les 50
  // plus récentes (PUNCTUALITY_MAX) — borné à la racine, pas de croissance.
  for (let i = 0; i < 200; i++) {
    const ac = seedApproach(sim); ac.delayed = 0; ac._delayCause = null;
    logFlightEnd(sim, ac, false);
  }
  const st = punctualityStats(sim);
  assert.ok(st.total <= 50, `la fenêtre est bornée (${st.total} vols, ≤ 50)`);
  // Les 200 fins sont À L'HEURE (delayed = 0 ≤ rotation nominale) → ponctuel.
  assert.equal(st.rate, 1, '200 fins a lheure → 100 % (fenêtre bornée)');
  assert.equal(st.cancels, 0, 'aucune annulation');
});

test('R17 : le dénominateur est CLAIR — les annulations sont comptées', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 100000;
  sim.time = 100000;
  // 10 départs à l'heure + 2 annulations (vol annulé = NON ponctuel).
  for (let i = 0; i < 10; i++) {
    const ac = seedApproach(sim); ac.delayed = 0; ac._delayCause = null;
    logFlightEnd(sim, ac, false);
  }
  for (let i = 0; i < 2; i++) {
    const ac = seedApproach(sim); ac.delayed = 5; ac._delayCause = 'piste';
    logFlightEnd(sim, ac, true); // annulation (cause = piste)
  }
  const st = punctualityStats(sim);
  assert.equal(st.total, 12, 'dénominateur = 12 fins (10 départs + 2 annulations)');
  assert.equal(st.cancels, 2, 'les 2 annulations sont comptées');
  assert.equal(st.onTime, 10, 'numérateur = 10 départs a lheure');
  assert.ok(Math.abs(st.rate - 10 / 12) < 0.001, `ponctualité = 10/12 (constaté ${st.rate})`);
  assert.equal(st.causes.piste, 2, 'la cause « piste » est comptée (2 annulations)');
});

test('R17 : aucun vol terminé dans la fenêtre → null (pas de faux chiffre)', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 100000;
  sim.time = 0; // début de partie : aucun vol terminé
  const st = punctualityStats(sim);
  assert.equal(st.total, 0, 'aucun vol terminé');
  assert.equal(st.rate, null, 'null = pas encore de vol (UI dit « pas encore »)');
});

test('R17 : la rotation nominale est explicite (catalog.mjs)', () => {
  // rotation = NOMINAL_TURNOVER_S + refuel × REFUEL_TIME_S (liée à la taille).
  const rot = nominalRotation('medium');
  const expMed = NOMINAL_TURNOVER_S + (AIRCRAFT.medium.refuel || 0) * REFUEL_TIME_S;
  assert.ok(Math.abs(rot - expMed) < 0.01, `rotation medium = ${expMed} s (ops sol + avitaillement)`);
  assert.ok(rot > 0, `rotation nominale positive (${rot} s)`);
  // La rotation d'un avion PLUS GROS est plus longue (plus d'avitaillement).
  const rotL = nominalRotation('large');
  assert.ok(rotL >= rot, `large (${rotL} s) ≥ medium (${rot} s)`);
});

test('R17 : la fenêtre de ponctualité survit à une sauvegarde/restauration', () => {
  // État de jeu COMPLET (les champs REQUIRED screen/time/terrain/camera
  // viennent de newGame via makeGameState — pas juste newSimState).
  const state = makeGameState();
  const sim = state.sim;
  rebuildGraph(sim);
  sim.economy.money = 100000;
  sim.time = 100000;
  const ac = seedApproach(sim); ac.delayed = 3; ac._delayCause = 'piste';
  logFlightEnd(sim, ac, false); // 1 fin de vol (à l'heure)
  const before = punctualityStats(sim);
  // Sauvegarde → chargement : la fenêtre bornée est SÉRIALISABLE (objet plat),
  // le _delayCause (dérivé, VOLATIL) n'est pas persisté mais est relue au tick.
  const restored = deserialize(serialize(state));
  const after = punctualityStats(restored.sim);
  assert.equal(before.total, after.total, 'la fenêtre survit à la sauvegarde');
  assert.equal(before.onTime, after.onTime, 'le comptage survit à la sauvegarde');
  assert.equal(after.cancels, 0, 'pas dannulation');
});
