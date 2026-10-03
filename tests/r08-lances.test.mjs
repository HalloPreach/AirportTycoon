// Tests R08 (t_dab62cfc) : la LANCE carburant est LIBÉRÉE sur TOUTE sortie du
// plein — panne station (D2 : libération IMMÉDIATE, dry departure), disparition
// du service (station démolie), fin normale. Le comptage d'occupation ne compte
// QUE les pleins RÉELLEMENT ACTIFS (a._refueling) : plus de lance fantôme après
// une panne (le bogue : ac._refueling restait true, l'avion passé en départ
// sec continuait de compter une lance occupée → un 2e avion attendait pour
// rien). Décision D2 tranchée : panne pendant plein → dry departure +
// libération immédiate.
// Mêmes socles/seuils que services.test.mjs (avions semés DIRECTEMENT en
// « refuel » pour isoler la lance sans pathfinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy } from '../src/economy/economy.mjs';
import { forceIncident, fuelOut } from '../src/sim/incidents.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// Socle « bien conçu » + 1 station = 1 LANCE (la saturation est mesurable).
function buildSocle(sim) {
  rebuildGraph(sim);
  // R23 : la station carburant se débloque par UNE OFFRE DE VOL EN VUE
  // (plus de seuil de pax — unlocks.mjs).
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium',
    pax: 160, planned: 300, status: 'planned' });
  sim.economy.money = 100000;
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 100, 200); // UNE station = UNE lance
  rebuildGraph(sim);
}
const M_GATES = (sim) => sim.infra.gates.filter((g) => g.size === 'M');

// Avion medium semé DIRECTEMENT en « refuel » (plein = 110 × 0,5 s = 55 s).
function seedRefueling(sim, gateId) {
  const ac = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
    phase: 'refuel', x: 0, y: 0, gateId, runwayId: 'r1',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(ac);
  return ac;
}
const tick = (sim) => { tickAircraft(sim, 0.1); tickEconomy(sim, 0.1); };

test('R08 (1) : station libre / un avion → le plein démarre, l occupation compte 1', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'l avion a la lance (1 station = 1 lance, libre)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 1, 'l occupation compte 1 plein ACTIF');
});

test('R08 (2) : panne PENDANT le plein (D2) → dry departure + lance libérée IMMÉDIATEMENT', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'le plein est en cours (la lance est occupée)');
  forceIncident(sim, 'fuel'); // la station tombe EN PANNE pendant le plein
  assert.ok(fuelOut(sim), 'la panne est bien active');
  tick(sim); // le branch panne (doRefuel) passe l avion en dry departure
  assert.equal(a1.phase, 'disembark', 'la panne met le plein en DÉPART SEC (non bloquant)');
  assert.equal(a1._dryDeparture, true, 'marqué « départ sec » (conséquence lisible)');
  assert.equal(a1._refueling, false, 'D2 : la lance est LIBÉRÉE (plus comptée occupée)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 0, 'l occupation compte QUE les pleins actifs (0 ici)');
});

test('R08 (3) : 1 lance / DEUX avions → le 2e attend, puis a la lance dès qu elle est libérée', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [g1, g2] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  const a2 = seedRefueling(sim, g2.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'le 1er prend la lance (ordre d insertion, déterministe)');
  assert.equal(a2._refueling, undefined, 'le 2e ATTEND (1 seule lance) — pas de débordement');
  // Le plein du 1er (55 s) est terminé → libération normale, la lance est libre.
  for (let i = 0; i < 600; i++) tick(sim); // 60 s
  assert.equal(a1.phase, 'disembark', 'le plein du 1er est terminé (lance libérée)');
  assert.equal(a1._refueling, false, 'fin normale : plus compté occupé');
  assert.equal(a2._refueling, true, 'le 2e a la lance DÈS qu elle est RÉELLEMENT disponible');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 1, 'encore 1 plein actif (celui du 2e)');
});

test('R08 (4) : RETOUR du service → le plein reprend (pas de lance fantôme entre les pleins)', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [g1, g2] = M_GATES(sim);
  // Phase 1 : a1 en plein, a2 attend (1 lance) — état SATURÉ.
  const a1 = seedRefueling(sim, g1.id);
  const a2 = seedRefueling(sim, g2.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'a1 a la lance (1 station = 1 lance)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 1, 'occupation = 1 (plein actif)');
  forceIncident(sim, 'fuel');
  tick(sim); // D2 : la panne met les pleins en dry departure (a1 libère sa lance)
  assert.equal(a1._refueling, false, 'D2 : a1 a LIBÉRÉ sa lance sur la panne (pas de lance fantôme)');
  assert.equal(a1._dryDeparture, true, 'a1 en dry departure (conséquence lisible, non bloquante)');
  assert.equal(a2._refueling, false, 'a2 aussi en dry departure (releaseLance normalise son état)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 0, 'AUCUNE lance fantôme après la panne');
  // Récupération : la panne finit → le service est de retour (knob déterministe
  // : l horloge d incident avance dans tickIncidents, que ce test ne pilote pas).
  sim.incidents.fuel.out = 0;
  assert.ok(!fuelOut(sim), 'le service est revenu (panne terminée)');
  const a3 = seedRefueling(sim, g1.id); // NOUVEL avion
  for (let i = 0; i < 10; i++) tick(sim);
  assert.equal(a3._refueling, true, 'le NOUVEL avion a la lance (le service sert à nouveau)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 1, 'occupation = 1 (le plein de a3) — pas de fantôme');
});

test('R08 (5) : DÉMOLITION de la station (disparition du service) → lance libérée, dry departure, autorisée', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'le plein est en cours (la lance est occupée)');
  const fuelId = sim.infra.services.find((s) => s.type === 'fuel').id;
  const r = demolishBuilding(sim, fuelId); // disparition du service
  assert.equal(r.ok, true, 'la démolition est AUTORISÉE (la démo ne dépend pas des lances)');
  tick(sim); // doRefuel : plus de lance (fuelLances = 0) → branch panne/disparition
  assert.equal(a1._dryDeparture, true, 'disparition du service : le plein est en dry departure (non bloquant)');
  assert.equal(a1._refueling, false, 'la lance est LIBÉRÉE (le propriétaire est nettoyé)');
  assert.equal(a1._refuelNeed, 0, 'le temps restant est nettoyé (pas de plein fantôme au chargement)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 0, 'l occupation compte QUE les pleins actifs (0)');
});

test('R08 (6) : SAUVEGARDE pendant le plein → le plein (propriétaire + temps restant) survit au chargement', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  a1.runwayId = sim.infra.runways[0].id; // piste EXISTANTE (le schéma valide les références)
  tick(sim);
  const needBefore = a1._refuelNeed;
  assert.ok(needBefore > 0, 'le plein est en cours (temps restant > 0)');
  // serialize est PUR (A11) : l état vivant est intact après sérialisation.
  const restored = deserialize(serialize({ screen: 'play', time: 0, terrain: 1, camera: null, sim }));
  const ac = restored.sim.aircraft.find((a) => a.id === a1.id);
  assert.equal(ac._refueling, true, 'le plein ACTIF est sauvegardé (propriétaire)');
  assert.equal(ac._refuelNeed, needBefore, 'le TEMPS RESTANT est sauvegardé (le plein reprend où il était)');
  assert.equal(a1._refuelNeed, needBefore, 'A11 : serialize est pur (l état vivant est intact)');
  // On REPREND la partie : le plein continue (pas de lance fantôme, pas de reset).
  tick(restored.sim);
  const ac2 = restored.sim.aircraft.find((a) => a.id === a1.id);
  assert.equal(ac2._refueling, true, 'à la reprise le plein est toujours actif');
  assert.ok(ac2._refuelNeed < needBefore, 'le temps restant DÉCROIT (le plein continue, pas de reset)');
});
