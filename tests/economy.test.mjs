// Tests finances (BL-14, R8/A12/A-6 de l'audit) :
//  - le socle aéroportuaire coûte de l'exploitation : l'argent diminue MÊME SANS VOL ;
//  - le carburant est une DÉPENSE dédiée (compte spent.fuel), jamais une recette négative ;
//  - scénario DÉFICITAIRE (faillite) ET scénario RENTABLE, bilan lisible avec causes.
// Helpers / PRNG copiés depuis tests/sim.test.mjs (zéro DOM, déterministe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { tickPlanner, decideFlight } from '../src/flights/flights.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers, onGateDeparted, periodStatement } from '../src/economy/economy.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';

// PRNG déterministe (mulberry32) : le même seed → la même suite de vols.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Socle = le même plan que la sonde A12 de l'audit (piste + taxiway + terminal).
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}

// Un tick de jeu sans l'UI : avions + économie + passagers + planificateur.
// BL-16 (AC20) : le JEU décide — auto-accept (politique joueur) : les vols
// planifiés s'acceptent seuls, comme la case du panneau ; la sim ne déploie
// que les vols « accepted ».
function step(sim, dt, random) {
  tickAircraft(sim, dt);
  tickEconomy(sim, dt);
  tickPassengers(sim, dt);
  for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true);
  tickPlanner(sim, dt, random);
}

test('R8/A12 : le socle fait diminuer les fonds SANS vol (reproduction de la sonde A12)', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 10000; // point de départ contrôlé
  const before = sim.economy.money;
  tickEconomy(sim, 3600); // 1 heure de jeu, aucun vol
  assert.ok(sim.economy.money < before, 'les fonds doivent diminuer (socle = depense d exploitation)');
  assert.ok(sim.economy.spent.opex > 0, 'la depense est comptee dans spent.opex');
  assert.equal(Object.keys(sim.economy.revenue).length, 0, 'aucune recette sans vol');
});

test('A-6 : le carburant dun depart est une depense dediee, pas une recette negative', () => {
  const sim = newSimState();
  const before = sim.economy.money;
  onGateDeparted(sim, { pax: 100 });
  assert.equal(sim.economy.revenue.pax, 2500, 'les billets restent une recette positive');
  assert.equal(sim.economy.spent.fuel, 50, 'le carburant est compte dans spent.fuel (0,5 $/pax)');
  assert.equal(sim.economy.money, before + 2450, 'solde = billets − carburant');
  assert.equal(sim.economy.revenue['fuel-cost'], undefined, 'jamais de categorie « recette negative »');
});

test('A-6 (garde satisfaction 0 %) : les recettes sont bloquees mais le carburant est paye', () => {
  const sim = newSimState();
  sim.passengers.satisfaction = 0; // la garde BL-05 stoppe les RECETTES
  const before = sim.economy.money;
  onGateDeparted(sim, { pax: 100 });
  assert.equal(Object.keys(sim.economy.revenue).length, 0, 'aucune recette encaissee (garde)');
  assert.equal(sim.economy.spent.fuel, 50, 'le carburant est paye quand même (cest une depense)');
  assert.equal(sim.economy.money, before - 50, 'le solde baisse du carburant seul');
});

test('scénario DÉFICITAIRE : sans recette, le socle creuse le solde jusquà la faillite', () => {
  const sim = newSimState();
  buildSocle(sim);
  sim.economy.money = 12000; // point de départ contrôlé (faible) : le socle doit le creuser sous −10 000
  // tickEconomy seul (pas tickPlanner) : aucun vol n'existe, l exploitation seule domine.
  for (let i = 0; i < 64000; i++) tickEconomy(sim, 0.1); // 6400 s de jeu
  const st = periodStatement(sim);
  assert.ok(st.net < 0, 'bilan net negatif');
  assert.ok(sim.economy.money < -10000, 'le solde passe sous le seuil de faillite');
  assert.equal(sim.economy.bankrupt, true, 'faillite declaree');
  assert.ok(sim.alerts.some((a) => a.kind === 'bankrupt'), 'evenement faillite pour l UI');
  assert.ok(st.causes.length > 0, 'le bilan liste des CAUSES du deficit');
  assert.ok(st.causes.some((c) => c.includes('exploitation')), 'lexploitation du socle est nommee');
});

test('scénario RENTABLE : les vols paient l exploitation du socle (pas de faillite)', () => {
  const sim = newSimState();
  buildSocle(sim); // socle seul : ~3,2 $/s d exploitation
  sim.passengers.satisfaction = 100;
  let departures = 0;
  for (let i = 0; i < 12000; i++) { // 1200 s de jeu
    const had = sim.aircraft.some((a) => a.phase === 'departure');
    step(sim, 0.1, rng(7));
    if (had && !sim.aircraft.some((a) => a.phase === 'departure')) departures++;
  }
  const st = periodStatement(sim);
  assert.ok(departures >= 1, 'au moins un vol sest deroule');
  assert.ok(st.revenue > 0, 'recettes encaisseees (billets + droits datterrissage)');
  assert.ok(st.fuel > 0, 'le carburant des vols est compte en depense');
  assert.ok(st.revenue > st.opex + st.fuel, 'scenario rentable : les recettes paient l exploitation');
  assert.ok(sim.economy.money > 0, 'le solde reste positif');
  assert.equal(sim.economy.bankrupt, false, 'pas de faillite');
});
