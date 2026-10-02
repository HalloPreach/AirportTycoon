// R05 (t_482d879d) — CRITÈRES CENTRALISÉS + ORDRE STABLE + SONDAGE DU GAIN 2E PISTE.
// Le choix d'atterrissage est CENTRALISÉ (infra.mjs : compatibilité + occupation
// + ordre stable) : aircraft.mjs (atterrissage) ET flights.mjs (planification)
// en redirent PAS la logique.
// SONDAGE (le cœur du critère) : aéroport à 2 PISTES (la 1re est OCCUPÉE) →
// la 2e piste LIBRE est choisie — PAS la 1re « compatible » par défaut
// (le défaut R05 : « 1re piste compatible toujours choisie », A4 : la 1re
// occupée → la 2e libre est prise). Le gain de la 2e piste est VÉRIFIÉ, pas
// supposé (ni re-calage du trafic : aucun re-calage n'est exigé).
// Zéro DOM, déterministe (pattern tests/r11-deficit.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, pickRunway, runwayFor, runwayBusy, gateFor } from '../src/infra/infra.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';

// Socle minimal : 1 piste de DÉPART (id 1, longueur 1000 — A-2) + taxi +
// terminal (2 portes M). La 2e piste (id supérieur) sera ajoutée par le test.
function buildBase(sim) {
  rebuildGraph(sim);
  const r1 = buildBuilding(sim, 'runway', 750, 100); // len 1000
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return r1;
}
// Une 2e piste COMPATIBLE (longueur 1000, id > 1) — à côté de la 1re.
function buildSecondRunway(sim) {
  const r2 = buildBuilding(sim, 'runway', 950, 100); // len 1000
  rebuildGraph(sim);
  return r2;
}
// Un avion en phase PISTE (landing) qui OCCUPE la piste rwId (A4 : exclusif).
function occupyRunway(sim, rwId) {
  const ac = {
    id: sim.nextAcId++, airline: 'test', color: '#fff', acType: 'medium', pax: 50,
    phase: 'landing', runwayId: rwId, x: 800, y: 300,
  };
  sim.aircraft.push(ac);
  return ac;
}

test('R05 — 2 pistes, 1re OCCUPÉE : la 2e piste LIBRE est choisie (sondage du gain, A4)', () => {
  const sim = newSimState();
  sim.economy.money = 100000;
  const r1 = buildBase(sim);
  const r2 = buildSecondRunway(sim);
  assert.ok(r1 && r2, 'les 2 pistes existent (compatible medium : minRunway 500)');
  assert.equal(runwayBusy(sim, r1.id, null), false, 'aucune occupation au départ');

  // Un avion OCCUPE la 1re piste (phase landing, A4 : atterrissage/départ exclusif).
  const blocker = occupyRunway(sim, r1.id);

  // SONDAGE : la MEILLEURE piste compatible ET LIBRE = la 2e (la 1re est prise).
  // AVANT R05, le choix (aircraft.mjs) ignorait l'occupation → la 1re occupée
  // était toujours choisie (défaut « 1re compatible toujours choisie »).
  const chosen = pickRunway(sim, 500);
  assert.equal(chosen.id, r2.id,
    'la 2e piste LIBRE est choisie — PAS la 1re (1re occupée = défaut R05)');
  assert.equal(runwayBusy(sim, r2.id, null), false, 'la 2e est bien LIBRE');

  // Le choix EXCLUANT le bloqueur reste identique (l'avion peut garder SA piste).
  assert.equal(pickRunway(sim, 500, blocker.id).id, r1.id,
    'exclu le bloqueur, la 1re (sa propre piste) redevient la meilleure');

  // Et le gain est MESURABLE EN JEU : un 2e avion (approach) est routé vers la
  // 2e piste — pas la 1re (sondage complet, pas seulement la fonction).
  const ac2 = {
    id: sim.nextAcId++, airline: 'test', color: '#fff', acType: 'medium', pax: 50,
    phase: 'approach', x: 800, y: -150, runwayId: null, gateId: null,
    path: null, pathPtr: 0, seg: null, heading: 'gate', delayed: 0, timer: 0,
  };
  sim.aircraft.push(ac2);
  tickAircraft(sim, 0.1);
  assert.equal(ac2.runwayId, r2.id,
    'EN JEU : le 2e avion est routé vers la 2e piste LIBRE (A4 : la 1re restait le défaut)');
});

test('R05 — 2 pistes LIBRES : l’ordre est STABLE (longueur, puis id)', () => {
  const sim = newSimState();
  sim.economy.money = 100000;
  const r1 = buildBase(sim);
  const r2 = buildSecondRunway(sim);
  // Les 2 pistes sont libres ET égales en longueur (1000) → le plus ANCIEN
  // (id 1) gagne — SANS dépendre de l'ordre d'insertion (ordre stable R05).
  assert.equal(pickRunway(sim, 500).id, r1.id, 'libres + égalité de longueur : l’id 1 (plus ancien)');
  // La 1re OCCUPÉE : la 2e (libre) gagne.
  occupyRunway(sim, r1.id);
  assert.equal(pickRunway(sim, 500).id, r2.id, 'la 1re occupée → la 2e libre');
});

test('R05 — TOUTES les pistes occupées : AUCUNE n’est choisie (null, pas la 1re)', () => {
  const sim = newSimState();
  sim.economy.money = 100000;
  const r1 = buildBase(sim);
  const r2 = buildSecondRunway(sim);
  occupyRunway(sim, r1.id);
  occupyRunway(sim, r2.id);
  assert.equal(pickRunway(sim, 500), null, 'toutes occupées : aucune (l’avion patiente, A4)');
});

test('R05 — 1 seule piste : la COMPATIBILITÉ reste le critère (pas l’occupation)', () => {
  const sim = newSimState();
  sim.economy.money = 100000;
  const r1 = buildBase(sim);
  // La piste (len 1000) EST compatible (medium : minRunway 500) → elle EST
  // choisie même SI elle est occupée (le choix d'atterrissage est pickRunway ;
  // runwayFor reste la COMPATIBILITÉ SEULE — le critère de retard du planificateur).
  occupyRunway(sim, r1.id);
  assert.ok(runwayFor(sim, 500), 'runwayFor = compatibilité (la piste suffit)');
  assert.equal(runwayFor(sim, 500).id, r1.id);
});

test('R05 — les CRITÈRES sont CENTRALISÉS : les 2 modules en redirent pas la logique', () => {
  // L'occupation d'une piste est une FONCTION DE LA PHASE (jamais de champ dédié)
  // — la règle EST UNIQUE : runwayBusy (infra.mjs).
  const sim = newSimState();
  sim.economy.money = 100000;
  buildBase(sim);
  const r1 = sim.infra.runways[0];
  const ac = occupyRunway(sim, r1.id);
  assert.equal(runwayBusy(sim, r1.id, null), true, 'piste en landing = occupée');
  assert.equal(runwayBusy(sim, r1.id, ac.id), false, 'le propriétaire ne compte pas');
  // La phase EST la donnée (l'occupation est DÉRIVÉE, pas stockée) :
  ac.phase = 'gate';
  assert.equal(runwayBusy(sim, r1.id, null), false, 'piste libérée quand l’avion est à la porte');
});

test('R05 — les PORTES : l’ordre est STABLE (usure, puis id)', () => {
  const sim = newSimState();
  sim.economy.money = 100000;
  buildBase(sim);
  const m = sim.infra.gates.filter((g) => g.size === 'M'); // 2 portes M (A-2)
  assert.equal(m.length, 2, 'l’aéroport de départ a 2 portes M');
  // Toutes libres, usure 0 → l'ordre STABLE = le plus ANCIEN (id), pas aléatoire.
  assert.equal(gateFor(sim, 'M').id, m[0].id, 'égalité d’usure : la porte la plus ancienne');
  // La porte « sale » (usure élevée) est évitée (critère historique, A7) :
  m[0].cleaning = 150;
  assert.equal(gateFor(sim, 'M').id, m[1].id, 'la porte propre est préférée');
  m[0].acId = 42; // réservée par un autre avion → exclue (A5)
  assert.equal(gateFor(sim, 'M', null).id, m[1].id, 'la porte réservée par un autre est sautée');
  assert.equal(gateFor(sim, 'M', 42).id, m[1].id, 'pour l’avion 42, sa porte reste disponible…');
  m[1].acId = 7;
  assert.equal(gateFor(sim, 'M', 42), m[0], '…sa propre porte (la seule libre pour lui)');
});

test('R05 — 1re porte compatible DÉCONNECTÉE : une autre porte CONNECTÉE est choisie (A1)', () => {
  const sim = newSimState();
  sim.economy.money = 100000;
  buildBase(sim);
  // Un terminal ISOLÉ (x 100..300, y 100..250) : AUCUN taxiway ne le touche →
  // ses 2 portes M sont HORS RÉSEAU (gateNode inexistant, findPath impossible).
  const t2 = buildBuilding(sim, 'terminal', 100, 100);
  const iso = sim.infra.gates.filter((g) => g.terminalId === t2.id && g.size === 'M');
  assert.equal(iso.length, 2, 'le terminal isolé a 2 portes M (compatibles, libres, neuves)');
  // TOUTES les portes M sont compatibles (size M) et libres : le choix doit
  // SAUTER les 2 déconnectées (l'avion serait « bloqué » — retard purement
  // artificiel, A1) et prendre la 1re CONNECTÉE (l'aéroport de départ, A-2).
  const chosen = gateFor(sim, 'M');
  assert.notEqual(chosen.terminalId, t2.id, 'la porte CONNECTÉE est choisie — pas l’isolée');
  assert.equal(chosen.terminalId, 3, 'la porte du terminal relié (A-2) gagne');
  // En égalité (usure 0, connectées), l'ordre STABLE = le plus ANCIEN (id).
  const conn = sim.infra.gates.filter((g) => g.terminalId === 3 && g.size === 'M');
  assert.equal(chosen.id, conn[0].id, 'la plus ancienne des portes connectées');
});
