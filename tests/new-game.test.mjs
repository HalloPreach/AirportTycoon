// BL-01 (A-2, AC1) : nouvelle partie avec aéroport fourni.
// Scénario d'acceptance : makeGameState DOIT fournir un réseau physiquement
// valide (1 piste + 1 terminal minimal 2 portes + 1 taxiway connecté) et
// permettre un vol complet (arrivée → départ) SANS AUCUNE construction.
// Moteur de vol identique au test « bien conçu » de sim.test.mjs : la
// différence est seulement qu'ici on ne construit rien (aéroport fourni).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGameState } from '../src/core/new-game.mjs';
import { tickPlanner } from '../src/flights/flights.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from '../src/economy/economy.mjs';
import { START_FUNDS } from '../src/core/sim-state.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../src/pathfinding/path.mjs';

test('nouvelle partie (A-2) : aéroport fourni, gratuit, réseau physiquement valide', () => {
  const state = makeGameState();
  state.screen = 'game';
  const sim = state.sim;
  assert.equal(sim.infra.runways.length, 1, 'une piste est fournie');
  assert.equal(sim.infra.terminals.length, 1, 'un terminal minimal est fourni');
  assert.equal(sim.infra.gates.length, 2, 'terminal minimal = 2 portes');
  assert.ok(sim.infra.gates.every((g) => g.size === 'M'), 'les 2 portes sont M (vols medium)');
  assert.equal(sim.infra.taxiways.length, 1, 'un taxiway est fourni');
  assert.equal(sim.economy.money, START_FUNDS, 'l\u2019aéroport fourni ne coûte rien');
  // Réseau valide : sortie de piste → taxiway → porte (chemin trouvé sans null).
  rebuildGraph(sim);
  const from = runwayExitNode(sim, sim.infra.runways[0].id);
  const to = gateNodeOf(sim, sim.infra.gates[0].id);
  assert.ok(from != null, 'nœud de sortie de piste');
  assert.ok(to != null, 'nœud de porte');
  const path = findPath(sim, from, to, new Set());
  assert.ok(path && path.length >= 2, 'chemin piste → porte existe dès le départ');
});

test('nouvelle partie (AC1) : 1 vol complet (arrivée → départ) SANS construction préalable', () => {
  const state = makeGameState();
  state.screen = 'game';
  const sim = state.sim;
  // Un seul vol medium forcé (compatibles aux 2 portes M fournies), comme le
  // test « plusieurs vols simultanés » de sim.test.mjs.
  const v = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 80,
    phase: 'approach', x: 800, y: -150, gateId: null, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(v);
  // Même pipeline de vol que le test « bien conçu » de sim.test.mjs (runToDeparture) :
  // la différence est seulement qu'aucun building n'a été construit ici.
  const seen = new Set();
  for (let i = 0; i < 8000; i++) {
    tickAircraft(sim, 0.1);
    tickEconomy(sim, 0.1);
    tickPassengers(sim, 0.1);
    for (const a of sim.aircraft) if (a.id === v.id) seen.add(a.phase);
    tickPlanner(sim, 0.1, () => 0.5); // purge des « departed » + cadencement (vol forcé : aucun spawn)
    if (seen.has('departed')) break;
  }
  for (const p of ['landing', 'exit', 'taxi', 'gate', 'disembark', 'departure', 'departed']) {
    assert.ok(seen.has(p), `phase manquante : ${p} (vues : ${[...seen].join(',')})`);
  }
  // Le tickPlanner a purgé le vol parti au tick suivant.
  tickPlanner(sim, 0.1, () => 0.5);
  assert.equal(sim.aircraft.filter((a) => a.id === v.id).length, 0, 'le vol est purgé après son départ');
  assert.ok(sim.passengers.totalCarried > 0, 'des passagers sont transportés (cycle arrivée → départ)');
});
