// R11 (t_eef3e9c8) — SÉPARER achats facultatifs et coûts obligatoires.
// Les coûts OBLIGATOIRES (indemnité, carburant, opex) sont débités MÊME EN
// DÉFICIT (solde négatif) — jamais refusés silencieusement. L'ACHAT facultatif
// (construction) échoue proprement : aucun débit, aucun bâtiment partiel.
// Pas de double facture (la machine à phases ne re-facture pas un événement).
// Zéro DOM, déterministe (pattern tests/economy.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { tickPlanner, decideFlight } from '../src/flights/flights.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import {
  tickEconomy, tickPassengers, onGateDeparted, onFlightCancelled,
  periodStatement, DEBT,
} from '../src/economy/economy.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';

// PRNG déterministe (mulberry32) + socle + step : copiés de tests/economy.test.mjs.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}
// Un battement de jeu sans l'UI (avions + économie + passagers + auto-accept).
function step(sim, dt, random) {
  tickAircraft(sim, dt);
  tickEconomy(sim, dt);
  tickPassengers(sim, dt);
  for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true);
  tickPlanner(sim, dt, random);
}

test('R11 — annulation avec 100 $ : l’indemnité est RÉELLEMENT débitée (déficit)', () => {
  const sim = newSimState();
  sim.economy.money = 100; // sous l'indemnité (500 $) — la trésorerie est à court
  onFlightCancelled(sim);
  assert.equal(sim.economy.spent.compensation, 500, 'le compte indemnite est alimente (500 $)');
  assert.equal(sim.economy.money, -400, 'le solde devient NEGATIF (dette reelle), pas refuse');
});

test('R11 — départ sans liquidités : le carburant est compté (même sans recettes)', () => {
  const sim = newSimState();
  sim.economy.money = 0;       // zéro liquidité
  sim.passengers.satisfaction = 0; // aucune recette billets (garde BL-05) → pas d’entrée
  onGateDeparted(sim, { pax: 100 });
  assert.equal(sim.economy.spent.fuel, 50, 'le carburant est compte en depense (0,5 $/pax)');
  assert.equal(sim.economy.money, -50, 'le solde passe sous zero (dette reelle), pas refuse');
});

test('R11 — achat impossible (pas de fonds) : aucun debit ni bâtiment partiel', () => {
  const sim = newSimState();
  sim.economy.money = 1000; // < le coût d'une piste (2500 $)
  const b = buildBuilding(sim, 'runway', 750, 100);
  assert.equal(b, null, 'la construction est REFUSEE');
  assert.equal(sim.infra.runways.length, 0, 'aucun batiment pose (pas de batiment partiel)');
  assert.equal(sim.economy.money, 1000, 'AUCUN debit : le solde est intact');
  assert.equal(sim.economy.spent.construction, undefined, 'aucun compte construction alimente');
});

// La garantie « pas de double facture » est STRUCTURELLE : doDeparture/doBlocked
// passent l'avion en phase TERMINALE (departed/cancelled) juste après la charge,
// et le dispatch (aircraft.mjs, default: break) ne re-fature plus une phase
// terminale. On prouve l'effet mesurable : dans une partie jouée, le carburant
// total = 0,5 $ × la somme des pax des départs (un seul événement « flight-out »
// par vol) — SANS DOUBLE COMPTAGE (sinon spent.fuel serait ~2× plus gros).
test('R11 — double passage de phase : le carburant est facturé UNE fois par départ', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 12000;
  sim.passengers.satisfaction = 100;
  for (let i = 0; i < 24000; i++) step(sim, 0.1, rng(7)); // 2400 s de jeu
  const outs = sim.alerts.filter((a) => a.kind === 'flight-out');
  assert.ok(outs.length >= 1, 'au moins un vol s est deroule');
  const paxDeparted = outs.reduce((s, e) => s + e.pax, 0); // 1 événement par départ
  const expectedFuel = paxDeparted * 0.5; // 0,5 $/pax, UNE fois par départ
  assert.ok(Math.abs(sim.economy.spent.fuel - expectedFuel) < 1e-6,
    `spent.fuel (${sim.economy.spent.fuel}) = 0,5 × pax des departés (${paxDeparted}) ` +
    `sans double facture`);
});

test('R11 (D5) — taux d’interet PARAMÉTRÉ (DEBT) : une seule politique', () => {
  // Le taux ET la cap sont des PARAMÈTRES (DEBT) — plus de chiffres magiques.
  assert.equal(DEBT.ratePerSec, 0.01, 'taux par defaut = 1 %/s (BL-18)');
  assert.equal(DEBT.baseCap, 10000, 'cap par defaut = 10 000 (BL-18)');
  assert.equal(Object.isFrozen(DEBT), true, 'les parametres sont figes (pas de mutation)');
});

// Catégories claires + rapprochement : depuis un solde à ZÉRO, le solde final
// EST le résultat (recettes − dépenses, chaque compte séparé, rien en double).
test('R11 — catégories séparées, pas de double comptage (rapprochement solde = résultat)', () => {
  const sim = newSimState();
  sim.economy.money = 0; // point de départ contrôlé : zéro
  onFlightCancelled(sim);        // 500 $ indemnite (compte compensation)
  onGateDeparted(sim, { pax: 10 }); // 250 $ billets (pax) − 5 $ carburant (fuel)
  // Chaque compte est SÉPARÉ (pas de double comptage) :
  assert.equal(sim.economy.spent.compensation, 500, 'compte indemnite separe');
  assert.equal(sim.economy.spent.fuel, 5, 'compte carburant separe (10 pax × 0,5)');
  const st = periodStatement(sim);
  assert.equal(st.revenue, 250, 'recettes = billets (10 pax × 25)');
  assert.equal(st.net, 250 - 0 - 5 - 0 - 500, 'resultat = recettes − (fuel + compensation)');
  assert.equal(sim.economy.money, st.net, 'le solde (partant de 0) EGALE le resultat — rien en double');
});
