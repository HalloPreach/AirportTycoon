// Tests passagers (BL-13, AC7/AC22/AC40, artefact NONMVP-2 « tests files ») :
//  - parcours agrégé : les groupes passent check-in → sécurité → attente →
//    embarquement, files visibles (sim.passengers.queue) ;
//  - SATURATION : plusieurs vols au sol en même temps → files pleines,
//    satisfaction mesurable qui BAISSE (effet mesurable, AC22) ;
//  - DÉNOUEMENT : les vols partent (purge) → les files se vident → la
//    satisfaction REMONTE : un retard ancien ne condamne pas indéfiniment ;
//  - PAS DE DOUBLE COMPTAGE (AC40) : un vol est compté UNE fois (576 pax pour
//    4 × 144, pas 1152) ; un vol parti en cours de parcours est épurgé sans
//    fausse comptabilité (les pax orphelins sortent, les files reviennent à 0).
// Zéro DOM, déterministe : même moteur de vol que les tests sim (ticks directs,
// pas de PRNG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { placeBuilding } from '../src/infra/infra.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickPassengers } from '../src/sim/passengers.mjs';

// Socle : 2 pistes (parcours exclusifs → les vols se superposent) + 2 terminaux
// (capacité files doublée) + 1 taxiway qui touche TOUT : les 2 sorties de piste
// (y1090) et les 2 terminaux (bord bas y1040) sont reliés → le réseau est
// physiquement valide.
function buildSocle(sim) {
  sim._graphDirty = true;
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'runway',  x: 750, y: 100,  w: 100, h: 1000 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'runway',  x: 900, y: 100,  w: 100, h: 1000 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'taxiway', x: 700, y: 1050, w: 400, h: 40 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'terminal', x: 550, y: 900,  w: 200, h: 150 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'terminal', x: 1050, y: 900, w: 200, h: 150 });
}

// 4 vols medium (144 pax chacun) déjà AU SOL, en phase « gate » : au 1er tick,
// doGate crée LEUR GROUPE passagers (check-in) et ils démarrent le débarquement
// — le cas extrême de la saturation, tout le monde à la porte en même temps.
// 4 (pas 5) : 4 portes M au total (2 terminaux × 2 M) → chacun a sa porte.
function fourAtGate(sim) {
  const mGates = sim.infra.gates.filter((g) => g.size === 'M');
  for (let i = 0; i < 4; i++) {
    sim.aircraft.push({
      id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 144,
      phase: 'gate', x: 600, y: 1065, gateId: mGates[i] ? mGates[i].id : null,
      runwayId: sim.infra.runways[0].id,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
  }
}

test('AC22 (saturation) : 4 vols au sol → files pleines, satisfaction mesure la baisse', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  let minSat = sim.passengers.satisfaction;
  let maxFlow = 0;
  for (let i = 0; i < 120; i++) { // 120 s de jeu
    tickAircraft(sim, 1);
    tickPassengers(sim, 1);
    const q = sim.passengers.queue;
    maxFlow = Math.max(maxFlow, q.checkin + q.security + q.board);
    minSat = Math.min(minSat, sim.passengers.satisfaction);
  }
  assert.ok(maxFlow > 200, 'les files sont pleines en saturation (pic de pax en file)');
  assert.ok(minSat < 99, `satisfaction mesure LA BAISSE en saturation (min ${minSat.toFixed(2)})`);
});

test('AC22/AC40 (dénouement) : les vols partent → files à 0, satisfaction REMONTE', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  let minSat = sim.passengers.satisfaction;
  for (let i = 0; i < 120; i++) {
    tickAircraft(sim, 1);
    tickPassengers(sim, 1);
    minSat = Math.min(minSat, sim.passengers.satisfaction);
  }
  assert.ok(minSat < 99, 'la satisfaction a d\u2019abord chut\u00e9 en saturation');
  // Dénouement : tous les vols sont partis/annulés (purge) → les passagers
  // orphelins sortent du parcours, les files se vident, la satisfaction remonte.
  sim.aircraft = [];
  for (let i = 0; i < 400; i++) tickPassengers(sim, 1); // 400 s de jeu
  const q = sim.passengers.queue;
  assert.ok(q.checkin < 1 && q.security < 1 && q.board < 1, 'les files sont revenues \u00e0 vide');
  assert.equal(sim.passengers.groups.length, 0, 'les groupes sont tous \u00e9pur\u00e9s');
  assert.ok(sim.passengers.satisfaction > minSat, `satisfaction REMONTE apr\u00e8s d\u00e9nouement (${sim.passengers.satisfaction.toFixed(2)} > min ${minSat.toFixed(2)})`);
  assert.ok(sim.passengers.satisfaction > 90, 'la satisfaction est r\u00e9cup\u00e9r\u00e9e');
});

test('AC40 (pas de double comptage) : 4 × 144 pax → totalCarried = 576 EXACTEMENT', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  for (let i = 0; i < 300; i++) {
    tickAircraft(sim, 1);
    tickPassengers(sim, 1);
  }
  assert.equal(sim.passengers.totalCarried, 576, '4 × 144 pax comptés UNE fois (pas 1152)');
  assert.equal(sim.passengers.groups.length, 0, 'plus aucun groupe en cours');
});

test('orphelins : des vols partis en cours de parcours sont épurgés, files à 0, satisfaction remonte', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  // 20 s de jeu : les files se remplissent (débarquement + check-in).
  for (let i = 0; i < 20; i++) { tickAircraft(sim, 1); tickPassengers(sim, 1); }
  assert.ok(sim.passengers.groups.length > 0, 'des groupes sont en cours');
  // Les 4 vols sont annulés/purgés (vol annulé en cours de parcours).
  sim.aircraft = [];
  for (let i = 0; i < 400; i++) tickPassengers(sim, 1);
  const q = sim.passengers.queue;
  assert.ok(q.checkin < 1 && q.security < 1 && q.board < 1, 'les pax orphelins sont sortis du parcours');
  assert.equal(sim.passengers.totalCarried, 0, 'aucun pax compté pour des vols partis sans embarquer');
  assert.equal(sim.passengers.groups.length, 0, 'groupes épurgés');
  assert.ok(sim.passengers.satisfaction > 90, 'la satisfaction remonte après dénouement');
});

test('repos : aucune file, satisfaction stable à 100 (pas de perte fantôme)', () => {
  const sim = newSimState();
  buildSocle(sim);
  for (let i = 0; i < 500; i++) tickPassengers(sim, 1); // 500 s de jeu, aucun vol
  const q = sim.passengers.queue;
  assert.equal(q.checkin, 0);
  assert.equal(q.security, 0);
  assert.equal(q.board, 0);
  assert.equal(sim.passengers.satisfaction, 100, 'satisfaction stable au repos');
  assert.equal(sim.passengers.totalCarried, 0, 'aucun pax compté sans vol');
});
