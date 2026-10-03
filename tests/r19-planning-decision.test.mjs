// R19 (t_f69dd9c9) — planNote : la note de DÉCISION d'une offre du planning.
// Zéro DOM (la règle sim, testable Node ; l'UI la rend seulement) :
//   1. offre IMPOSSIBLE → l'obstacle est EXPLICITE (pas un simple « non ») ;
//   2. offre RISQUÉE → le risque est INDUIT sans promesse de rentabilité
//      (file saturée, carburant manquant/panne → billets moitiés) ;
//   3. revenu ESTIMÉ (hypothèse, pas une garantie) : montants = MÊME source
//      que economy.mjs (PAX_REVENUE/LANDING_FEE/GATE_FEE/FUEL_COST_PER_PAX) ;
//   4. type inconnu → obstacle lisible, pas de crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { planNote, MAX_PENDING } from '../src/flights/flights.mjs';

// Socle des tests : piste 1000 + terminal (4 portes S/M/M/L, infra.mjs).
function base() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}
// Une station carburant construite (R23 : débloquée par UNE OFFRE DE VOL EN
// VUE — pas un seuil de pax, unlocks.mjs).
function addFuelStation(sim) {
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium',
    pax: 100, planned: 300, status: 'planned' }); // l'offre (condition fuel)
  const svc = buildBuilding(sim, 'fuel', 550, 1100);
  rebuildGraph(sim);
  assert.ok(svc, 'la station carburant est construite (offre en vue)');
}
// N avions en attente (phases d'arrivée) — file saturée.
function saturate(sim, n) {
  for (let i = 0; i < n; i++) {
    sim.aircraft.push({ id: sim.nextAcId++, airline: 'x', acType: 'medium', pax: 50,
      phase: i % 2 ? 'holding' : 'approach', x: 0, y: 0 });
  }
}
const E = (acType, pax = 100) => ({ id: 999, airline: 'atlantique', acType, pax, planned: 300, status: 'planned' });

test('R19 : offre servable → compatible, obstacle nul, revenu = hypothèse lisible', () => {
  const sim = base();
  addFuelStation(sim);
  const n = planNote(sim, E('medium')); // medium : piste 500 ✓ + porte M ✓
  assert.equal(n.compatible, true, 'une offre servable est compatible');
  assert.equal(n.obstacles.length, 0, 'pas d\'obstacle sur une offre servable');
  // Revenu = billets + droits atterrissage/porte − carburant (MONTANTS economy.mjs) :
  // 100 pax × 25 + 200 + 100 − 100 × 0.5 = 2450 (hypothèse, pas une promesse).
  assert.equal(n.revenue, 100 * 25 + 200 + 100 - 100 * 0.5, 'revenu estimé (hypothèse)');
  assert.equal(n.spec.seats, 160, 'la charge (seats) est lisible pour l\'affichage');
});

test('R19 : offre impossible → l\'obstacle est EXPLICITE', () => {
  // Aucune infra (aucune piste) : l'obstacle = la CAUSE (pas un simple « non »).
  const empty = newSimState();
  const n = planNote(empty, E('medium'));
  assert.equal(n.compatible, false, 'une offre non servable n\'est pas compatible');
  assert.ok(n.obstacles.length === 1 && /piste trop courte/.test(n.obstacles[0]),
    `l'obstacle est expliqué : « ${n.obstacles[0]} »`);
  // Piste OK mais AUCUNE porte : l'obstacle porte est EXPLICITE.
  const noGate = newSimState();
  buildBuilding(noGate, 'runway', 750, 100);
  const m = planNote(noGate, E('medium'));
  assert.equal(m.compatible, false, 'sans porte de taille M, l\'offre n\'est pas servable');
  assert.ok(m.obstacles.length === 1 && /porte/.test(m.obstacles[0]),
    `motif lisible : « ${m.obstacles[0]} »`);
});

test('R19 : offre risquée → le risque est INDUIT, sans promesse de rentabilité', () => {
  const sim = base();
  addFuelStation(sim);
  saturate(sim, MAX_PENDING); // file au plafond (A-5)
  const n = planNote(sim, E('medium'));
  assert.equal(n.compatible, true, 'le risque ne rend pas l\'offre incompatible');
  assert.ok(n.risks.some((r) => r.includes(String(MAX_PENDING))),
    `la file saturée est indiquée : ${n.risks.join(' | ')}`);
  assert.ok(!n.risks.some((r) => /rentabilit/.test(r)), 'pas de promesse de rentabilité');
  // Sans station (départ sec) → risque de billets moitiés + revenu réduit (hypothèse).
  const dry = base();
  const nd = planNote(dry, E('medium'));
  assert.ok(nd.risks.some((r) => r.includes('départ sec')),
    `pas de station : le départ sec est risqué AVANT la décision : ${nd.risks.join(' | ')}`);
  // Même pax : le revenu estimé du départ sec est plus bas que celui avec station
  // (billets moitiés) — l'hypothèse reflète le risque, sans promettre de perte.
  assert.ok(nd.revenue < n.revenue, 'revenu estimé départ sec < revenu estimé avitailé');
});

test('R19 : panne station (incident) → risque de départ sec', () => {
  const sim = base();
  addFuelStation(sim);
  sim.incidents.fuel.out = 300; // incident BL-14 : la station est en panne
  const n = planNote(sim, E('medium'));
  assert.ok(n.risks.some((r) => r.includes('panne')),
    `la panne en cours est un risque lisible : ${n.risks.join(' | ')}`);
});

test('R19 : type inconnu → obstacle lisible, pas de crash', () => {
  const sim = base();
  const n = planNote(sim, E('giant', 10));
  assert.equal(n.compatible, false, 'un type inconnu est incompatible (obstacle)');
  assert.ok(n.obstacles.length === 1, 'l\'obstacle est explicite');
  assert.ok(/inconnu/.test(n.obstacles[0]), `motif lisible : « ${n.obstacles[0]} »`);
  assert.equal(n.revenue, 0, 'pas de revenu calculé sur un avion inconnu');
});
