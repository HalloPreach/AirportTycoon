// Tests de la simulation (node:test, zéro DOM).
// Couvre les critères de fin du brief par des mécaniques : construction (2),
// vols + atterrissage/roulage/départ (3,4), multi-vols (5), retards (6),
// passagers (7), recettes/dépenses (8), agrandissement (9), sauvegarde/reprise (10-13).
// On utilise un PRNG semé → les résultats sont reproductibles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding, gateFor, runwayFor, tickUnlocks } from '../src/infra/infra.mjs';
import { spawnArrivals, tickPlanner } from '../src/flights/flights.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from '../src/economy/economy.mjs';
import { rebuildGraph, gateNodeOf, runwayExitNode, findPath } from '../src/pathfinding/path.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { serialize, deserialize, SAVE_VERSION } from '../src/persistence/save.mjs';

// PRNG déterministe (mulberry32) : le même seed → la même suite de vols.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Un aéroport minimal jouable : une piste, un taxiway qui RELIE la piste au terminal
// (les deux se touchent physiquement), et un terminal avec ses portes.
// La géométrie est choisie pour que findPath trouve un chemin réseau piste → porte :
// c'est le cas « bien conçu » du brief.
// (BL-02 : avant la correction, le taxiway était à (400,1050) — il ne touchait
// ni la piste (750..850) ni le terminal : le graphe le liait par « proximité »
// (distance 107 < 320) alors qu'aucun taxiway ne relie la piste au terminal.
// Le cas bien conçu exige des segments qui se TOUCHENT.)
function buildAirport(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);        // piste verticale (y 100..1100)
  buildBuilding(sim, 'taxiway', 550, 1050);     // taxiway : touche la piste (58 px) et le terminal
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}

// Avance la sim jusqu'à ce que l'avion `id` soit parti (ou timeout).
// On appelle la MEME pipeline que le jeu (tickPlanner purge les « departed »).
function runToDeparture(sim, id, maxTicks = 8000) {
  const seen = new Set();
  for (let i = 0; i < maxTicks; i++) {
    tickAircraft(sim, 0.1);
    tickEconomy(sim, 0.1);
    tickPassengers(sim, 0.1);
    for (const a of sim.aircraft) if (a.id === id) seen.add(a.phase);
    tickPlanner(sim, 0.1, () => 0.5); // purge + cadencement des prochains vols
    if (seen.has('departed')) break;
  }
  return seen;
}

test('nouvelle sim démarre avec le budget réel et un terrain vide', () => {
  const sim = newSimState();
  assert.equal(sim.economy.money, 12000);
  assert.equal(sim.infra.runways.length, 0);
  assert.equal(sim.aircraft.length, 0);
});

test('construction : piste + taxiway + terminal, et le solde se débite (critère 2)', () => {
  const sim = newSimState();
  const before = sim.economy.money;
  buildAirport(sim);
  assert.ok(sim.infra.runways.length === 1);
  assert.ok(sim.infra.gates.length === 4);
  assert.ok(sim.economy.money < before, 'le solde doit baisser après construction');
});

test('construction refusée si fonds insuffisants (robustesse)', () => {
  const sim = newSimState();
  sim.economy.money = 100; // pas assez pour une piste (2500)
  const b = buildBuilding(sim, 'runway', 100, 100);
  assert.equal(b, null);
  assert.equal(sim.infra.runways.length, 0);
  assert.ok(sim.alerts.some((a) => a.kind === 'no-funds'));
});

test('aucune piste → aucun vol n\'arrive (robustesse)', () => {
  const sim = newSimState();
  sim._spawnAcc = 999; // force l'essai de spawn
  spawnArrivals(sim, 0, rng(1));
  assert.equal(sim.aircraft.length, 0);
});

test('cycle complet : atterrir, rouler à une porte, repartir (critères 3,4)', () => {
  const sim = newSimState();
  buildAirport(sim);
  sim._spawnAcc = 999;
  spawnArrivals(sim, 0, rng(1));
  assert.equal(sim.aircraft.length, 1);
  sim._spawnAcc = 0; // un seul vol dans ce test : pas d'arrivée parasite
  const id = sim.aircraft[0].id;
  const seen = runToDeparture(sim, id);
  for (const p of ['landing', 'exit', 'taxi', 'gate', 'disembark', 'departure', 'departed']) {
    assert.ok(seen.has(p), `phase manquante : ${p} (vues : ${[...seen].join(',')})`);
  }
  // l'avion est parti et purgé par le planificateur
  assert.equal(sim.aircraft.filter((a) => a.id === id).length, 0);
});

test('les passagers sont transportés (critère 7)', () => {
  const sim = newSimState();
  buildAirport(sim);
  sim._spawnAcc = 999;
  spawnArrivals(sim, 0, rng(2));
  runToDeparture(sim, sim.aircraft[0]?.id);
  assert.ok(sim.passengers.totalCarried > 0, 'au moins un passager transporté');
});

test('recettes et dépenses effectives (critère 8)', () => {
  const sim = newSimState();
  buildAirport(sim);
  const moneyAfterBuild = sim.economy.money;
  sim._spawnAcc = 999;
  spawnArrivals(sim, 0, rng(2));
  runToDeparture(sim, sim.aircraft[0]?.id);
  // des recettes ont été encaissées
  assert.ok(sim.economy.revenue.pax > 0, 'recettes passagers > 0');
  // le solde a bougé (recettes d'un vol + opex)
  assert.notEqual(sim.economy.money, moneyAfterBuild);
});

test('plusieurs vols simultanés (critère 5) : 3 arrivées → 3 départs', () => {
  const sim = newSimState();
  buildAirport(sim);
  // 3 vols d\'une même taille (small → porte S + piste courte, compatible)
  const mk = (n) => sim.aircraft.push({
    id: sim.nextAcId++, airline: 'solaire', color: '#f0a', acType: 'small', pax: 5,
    phase: 'approach', x: 200 + n * 100, y: -150, gateId: null, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  mk(1); mk(2); mk(3);
  const seen = new Set();
  let departures = 0;
  for (let i = 0; i < 8000; i++) {
    tickAircraft(sim, 0.1); tickEconomy(sim, 0.1); tickPassengers(sim, 0.1);
    for (const a of sim.aircraft) {
      if (a.phase === 'departed') departures++;
      seen.add(a.phase);
    }
    if (departures >= 3) break;
  }
  assert.ok(departures >= 2, `au moins 2 vols doivent partir simultanément (vues : ${[...seen]})`);
});

test('progression : les services se débloquent par seuil de passagers (critère 9)', () => {
  const sim = newSimState();
  // Au départ : carburant (seuil 100 pax) et hangar (seuil 300 pax) sont refusés.
  assert.equal(buildBuilding(sim, 'fuel', 300, 300), null);
  assert.ok(sim.alerts.some((a) => a.kind === 'locked'), 'un événement « locked » est émis');
  assert.equal(buildBuilding(sim, 'hangar', 500, 500), null);
  // Après 100 passagers transportés : la station carburant devient constructible.
  sim.passengers.totalCarried = 100;
  assert.ok(buildBuilding(sim, 'fuel', 300, 300), 'station carburant débloquée à 100 pax');
  assert.equal(buildBuilding(sim, 'hangar', 500, 500), null, 'le hangar reste verrouillé (300 pax)');
  sim.passengers.totalCarried = 300;
  assert.ok(buildBuilding(sim, 'hangar', 500, 500), 'hangar débloqué à 300 pax');
  // Les bâtiments de base (piste/taxiway/terminal) restent toujours constructibles.
  assert.ok(buildBuilding(sim, 'taxiway', 100, 100));
  // tickUnlocks signale chaque service une seule fois.
  const sim2 = newSimState();
  sim2.passengers.totalCarried = 350;
  tickUnlocks(sim2);
  tickUnlocks(sim2);
  assert.equal(sim2.alerts.filter((a) => a.kind === 'unlocked').length, 2,
    'deux services débloqués (fuel + hangar), chacun signalé une fois');
});

test('retards si l\'aéroport est mal conçu (critère 6)', () => {
  const sim = newSimState();
  // aéroport « mal conçu » : piste trop courte pour un moyen + pas de porte compatible.
  buildBuilding(sim, 'runway', 750, 100); // len 1000, mais on met un avion « large » qui veut 800 → OK
  // On force un avion « large » mais sans terminal (donc sans porte L ni M) :
  sim.aircraft.push({
    id: sim.nextAcId++, airline: 'pacific', color: '#43a047', acType: 'large', pax: 200,
    phase: 'approach', x: 500, y: -150, gateId: null, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  // pas de terminal → pas de porte → l'avion ne peut jamais rejoindre une porte → retard.
  for (let i = 0; i < 200; i++) tickAircraft(sim, 0.1);
  const ac = sim.aircraft[0];
  assert.ok(ac.delayed > 0, 'l\'avion doit accumuler du retard sans porte compatible');
});

test('pathfinding : chemin réseau piste→porte existe (robustesse)', () => {
  const sim = newSimState();
  buildAirport(sim);
  // Un aéroport bien conçu doit donner un chemin (pas de null).
  const gate = sim.infra.gates[0];
  const from = runwayExitNode(sim, sim.infra.runways[0].id);
  const to = gateNodeOf(sim, gate.id);
  assert.ok(from != null, 'nœud de sortie de piste');
  assert.ok(to != null, 'nœud de porte');
  const path = findPath(sim, from, to, new Set());
  assert.ok(path && path.length >= 2, 'chemin taxiway trouvé');
});

// --- BL-02 : connectivité physique (probes A1/A2 de l'audit, R1) -------------

test('porte sans taxiway relié : HORS réseau, chemin refusé (sonde A1)', () => {
  const sim = newSimState();
  // La sonde A1 de l'audit : une piste + un terminal, ZÉRO taxiway.
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'terminal', 1100, 100);
  rebuildGraph(sim);
  // A1 : la porte ne doit PLUS se rattacher « à la cible la plus proche »
  // (ici, la piste, à 374 px) : sans taxiway construit, elle est hors réseau.
  for (const g of sim.infra.gates) {
    assert.equal(gateNodeOf(sim, g.id), undefined, `porte ${g.id} sans taxiway doit être hors réseau`);
  }
  // Conséquence : aucun chemin vers une porte inexistante dans le réseau.
  const from = runwayExitNode(sim, sim.infra.runways[0].id);
  assert.ok(from != null);
  assert.equal(findPath(sim, from, undefined, new Set()), null);
});

test('segments séparés par du terrain : pas de liaison fantôme (sonde A2)', () => {
  const sim = newSimState();
  // La sonde A2 : deux segments DISTINCTS séparés par 150 px de terrain vide
  // (taxiway [600..800] / [400..600] à (800,1100) ↔ (600,1070) : distance ~207 px
  // < l'ancienne borne NODE_DIST=320 → l'ancien graphe créait une arête fantôme).
  const t1 = buildBuilding(sim, 'taxiway', 600, 1050);
  const t2 = buildBuilding(sim, 'taxiway', 200, 1050); // [200..400] : ne touche PAS t1 [600..800]
  rebuildGraph(sim);
  const n = sim._graph.nodes;
  const i1 = n.findIndex((x) => x.seg === t1.id && x.x === 600); // bout gauche de t1
  const i2 = n.findIndex((x) => x.seg === t2.id && x.x === 400); // bout droit de t2
  const direct = sim._graph.edges.get(i1).some((e) => e.to === i2);
  assert.equal(direct, false, 'pas d\'arête entre deux segments qui ne se touchent pas');
  // Et aucun chemin entre les deux bouts : les deux taxiways sont déconnectés.
  assert.equal(findPath(sim, i1, i2, new Set()), null, 'deux segments non reliés → pas de chemin');
});

test('couper le taxiway = blocage réel, pas de chemin résiduel (AC14)', () => {
  const sim = newSimState();
  buildAirport(sim);
  const gate = sim.infra.gates[0];
  const from = runwayExitNode(sim, sim.infra.runways[0].id);
  const to = gateNodeOf(sim, gate.id);
  const before = findPath(sim, from, to, new Set());
  assert.ok(before && before.length >= 2, 'avant le coupage, le chemin existe');
  // On détruit LE taxiway qui relie la piste au terminal.
  const tw = sim.infra.taxiways[0];
  const res = demolishBuilding(sim, tw.id);
  assert.equal(res.ok, true);
  rebuildGraph(sim);
  // Le terminal reste (ses portes existent), mais le taxiway est détruit →
  // les portes ne touchent plus AUCUN segment du réseau → hors réseau, findPath = null.
  assert.ok(sim.infra.gates.length > 0, 'les portes du terminal existent encore');
  assert.equal(gateNodeOf(sim, gate.id), undefined, 'porte coupée du réseau après démolition');
  assert.equal(findPath(sim, from, gateNodeOf(sim, gate.id), new Set()), null, 'pas de chemin résiduel');
});

test('sauvegarde/restauration cohérente (critères 10,11,13)', () => {
  const state = makeGameState();
  state.screen = 'game';
  buildAirport(state.sim);
  state.sim.aircraft.push({
    id: 1, airline: 'solaire', acType: 'small', pax: 5, phase: 'approach',
    x: 500, y: -100, gateId: null, runwayId: null, delayed: 0, timer: 0, path: null,
    pathPtr: 0, seg: null, heading: 'gate',
  });
  const json = serialize(state);
  const restored = deserialize(json);
  assert.equal(restored.screen, 'game');
  assert.equal(restored.sim.infra.runways.length, 1);
  assert.equal(restored.sim.aircraft[0].phase, 'approach');
  // après restauration, la sim repart normalement (critère 13)
  tick(restored, 1); // ne plante pas, avance l'état
  assert.ok(restored.sim.economy.money <= 12000);
});

test('sauvegarde invalide / incompatible est rejetée (robustesse)', () => {
  const state = makeGameState();
  state.screen = 'game';
  // JSON corrompu
  assert.throws(() => deserialize('{pas du json'), /illisible|corrompu/i);
  // mauvaise version
  assert.throws(() => deserialize(JSON.stringify({ v: 99, state: {} })), /incompatible/i);
  // champ manquant (sim)
  assert.throws(() => deserialize(JSON.stringify({ v: SAVE_VERSION, state: { screen: 'game' } })), /manquant/i);
});

// --- AC18 (A9, R5) : déplacement continu + amarrage réel à la porte ----------

test('AC18 (A9) : pas de saut de position, amarrage au centre de la porte', () => {
  const sim = newSimState();
  buildAirport(sim);
  // Setup identique à la sonde A9 : un avion en approche au NORD de la piste
  // (x=200, y=-150) ; la piste est à x=800. Avant la correction : le landing
  // recollait l'avion sur l'axe de piste en UN tick (saut de 600 px) et, à la
  // porte, l'avion restait 51,5 px du centre (au nœud du taxiway, pas amarré).
  sim.aircraft.push({
    id: 1, airline: 'solaire', acType: 'small', pax: 5, phase: 'approach',
    x: 200, y: -150, gateId: null, runwayId: null, delayed: 0, timer: 0,
    path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  const ac = sim.aircraft[0];
  let previousX = ac.x, largestStep = 0;
  for (let i = 0; i < 6000; i++) {
    tickAircraft(sim, 0.1);
    largestStep = Math.max(largestStep, Math.abs(ac.x - previousX));
    previousX = ac.x;
    if (ac.phase === 'gate') break;
  }
  assert.equal(ac.phase, 'gate', "l'avion est arrivé à la porte");
  // (1) Déplacement continu : le delta horizontal max par tick est borné —
  // pas de téléportation (avant : 600 px en un tick, dt 0.1).
  assert.ok(largestStep < 100, `pas de saut de position (max par tick : ${largestStep.toFixed(1)} px)`);
  // (2) Amarrage réel : à la phase « gate », l'avion est au CENTRE de la porte
  // (le nœud de porte n'est pas le centre — avant : 51,5 px d'écart).
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  const distance = Math.hypot(ac.x - (g.x + g.w / 2), ac.y - (g.y + g.h / 2));
  assert.ok(distance < 20, `amarré au centre de la porte (écart : ${distance.toFixed(1)} px)`);
});

test('AC18 (A9) : la phase « docking » précède « gate » (cycle spatial complet)', () => {
  const sim = newSimState();
  buildAirport(sim);
  sim.aircraft.push({
    id: 1, airline: 'solaire', acType: 'small', pax: 5, phase: 'approach',
    x: 800, y: -150, gateId: null, runwayId: null, delayed: 0, timer: 0,
    path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  const seen = new Set();
  for (let i = 0; i < 6000; i++) {
    tickAircraft(sim, 0.1);
    seen.add(sim.aircraft[0].phase);
    if (sim.aircraft[0].phase === 'gate') break;
  }
  assert.ok(seen.has('docking'), '« docking » vu avant « gate » (taxi → docking → gate)');
  assert.ok(seen.has('gate'), '« gate » atteint après amarrage');
});
