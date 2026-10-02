// BL-08 — Persistance validée (R6 : A10, A11, EV-10) + reprise sans perte (AC10-13).
// A10 : une sauvegarde de version correcte mais INVALIDE (sim.infra.runways =
//       null) était ACCEPTÉE, puis le 1er tick crashe ("reading 'length'").
//       → maintenant REFUSÉE proprement au chargement (erreur lisible, sans crash).
// A11  : serialize() MODIFIAIT la partie active (purgeait _graph, marquait sale).
//        → maintenant PURE : l'état d'origine est intact.
// EV-10: l'état du générateur aléatoire (seed + compteur) est conservé dans la
//        sauvegarde (déterminisme reproductible à la reprise).
// AC10-13 : reprise SANS PERTE de vols / réservations / files / finances en
//           phases actives (taxi, service occupé).
// La sauvegarde invalide est PRÉSERVÉE (copie diagnostic) — jamais supprimée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serialize, deserialize, SAVE_VERSION, DIAG_KEY,
} from '../src/persistence/save.mjs';
import { makeSavePanel } from '../src/ui/save-panel.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';

// Stub localStorage (sans DOM) : posé AVANT chaque appel au panneau.
function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return { store, teardown: () => { delete globalThis.localStorage; } };
}

// Un état de sim MINIMAL mais « vivant » : la forme que la validation doit tolérer.
function liveSim(over = {}) {
  return Object.assign({
    infra: {
      runways: [{ id: 1, x: 750, y: 100, w: 100, h: 1000, len: 1000 }],
      taxiways: [{ id: 2, x: 550, y: 1050, w: 200, h: 40 }],
      terminals: [],
      gates: [{ id: 3, size: 'M', terminalId: 9, x: 600, y: 950, w: 40, h: 40, acId: 7, cleaning: 0, maintenance: 0 }],
      services: [],
      grid: { w: 160, h: 120, cells: new Uint8Array(160 * 120) },
    },
    aircraft: [{ id: 7, airline: 'x', acType: 'medium', pax: 100, phase: 'taxi', x: 800, y: 1100, gateId: 3, runwayId: 1, path: [0, 1], pathPtr: 0, seg: 1, delayed: 0, timer: 0 }],
    planning: [],
    nextAcId: 8,
    passengers: { totalCarried: 1234, satisfaction: 80 },
    economy: { money: 5000, revenue: {}, spent: {}, debt: 0, bankrupt: false },
    alerts: [], time: 321, _spawnAcc: 0, _planCursor: 0,
    _graph: null, _graphDirty: true,
  }, over);
}

function liveState(over = {}) {
  return Object.assign({
    screen: 'game', time: 321, paused: false, speedIndex: 0,
    terrain: { w: 1600, h: 1200 }, camera: { x: 9, y: 9, zoom: 2 },
  }, over, { sim: liveSim() });
}

// --- A10 : une sauvegarde INVALIDE (runways = null) est REFUSÉE proprement ---
// Avant correction : acceptée, puis le 1er tick crashe "reading 'length'".
test('A10 : sim.infra.runways = null est refusée au chargement (message lisible)', () => {
  const bad = liveState();
  bad.sim.infra.runways = null;
  const json = JSON.stringify({ v: SAVE_VERSION, state: bad });
  assert.throws(() => deserialize(json), /runways/, 'le défaut est Nommé dans le message');
});

// A10 (bis) : un tableau d'infra PRÉSENT mais de mauvais type (null) → refusé.
// (Un champ ABSENT est toléré : une sim minimale/M1 sans infra se recharge. Le défaut
// A10 d'origine est exactement un champ présent mais non listable : runways = null.)
test('A10 : un tableau d’infra présent mais non listable (null) est refusé au chargement', () => {
  const bad = liveState();
  bad.sim.infra.taxiways = null; // présent mais de mauvais type (A10)
  assert.throws(() => deserialize(JSON.stringify({ v: SAVE_VERSION, state: bad })), /taxiways|non listable/);
});

// A10 (ter) : identifiants/références cassés (avion vers un RUNWAY inexistant)
// → refusés proprement (validation des références).
test('A10 : une référence périmée (avion vers un runway inexistant) est refusée', () => {
  const bad = liveState();
  bad.sim.aircraft[0].runwayId = 999; // aucune piste 999
  assert.throws(() => deserialize(JSON.stringify({ v: SAVE_VERSION, state: bad })), /runway|inexistant|référence/i);
});

// Capacité : le solde de trésorerie doit être un NOMBRE (pas un string corrompu).
test('capacité/finances : un solde non numérique est refusé', () => {
  const bad = liveState();
  bad.sim.economy.money = 'beaucoup';
  assert.throws(() => deserialize(JSON.stringify({ v: SAVE_VERSION, state: bad })), /money|numérique/i);
});

// --- A11 : serialize() est PURE (ne modifie plus la partie en cours) ---------
test('A11 : serialize() ne modifie PAS la partie en cours (fonction pure)', () => {
  const sim = liveSim();
  sim._graph = { nodes: [{ x: 0, y: 0, seg: 1 }], edges: new Map(), gateNode: new Map() };
  sim._graphDirty = false;
  const state = liveState();
  state.sim = sim;
  const before = JSON.stringify(state.sim.infra.runways.map((r) => r.id));

  serialize(state); // appel qui, AVANT la correction, purgeait _graph + marquait sale

  assert.deepEqual(state.sim.infra.runways.map((r) => r.id), JSON.parse(before), 'l’infra d’origine est intacte');
  assert.ok(state.sim._graph, 'A11 : le graphe pathfinding n’est PAS purgé par serialize');
  assert.equal(state.sim._graphDirty, false, 'A11 : la partie n’est PAS marquée sale par serialize');
});

// --- EV-10 : l’état du générateur aléatoire est conservé dans la sauvegarde --
test('EV-10 : état du PRNG (seed + compteur) est sérialisé, restauré ET reproductible', () => {
  const state = liveState();
  state.sim.rngSeed = 4242;
  state.sim.rngCounter = 3;

  // 1) L’état du générateur traverse la sauvegarde (sérialisé + restauré).
  const back = deserialize(serialize(state));
  assert.equal(back.sim.rngSeed, 4242, 'le seed est préservé dans la sauvegarde');
  assert.equal(back.sim.rngCounter, 3, 'l’état du générateur est préservé');

  // 2) Reprise exacte : deux générateurs à l’état (seed 4242, compteur 3)
  //    produisent la MÊME suite — la partie continue où elle s’était arrêtée.
  const a = makeSimRng({ rngSeed: 4242, rngCounter: 3 });
  const b = makeSimRng({ rngSeed: 4242, rngCounter: 3 });
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB, 'même état de générateur → même suite (déterminisme)');
  assert.ok(seqA.every((v) => v >= 0 && v < 1), 'la suite est bien dans [0,1)');

  // 3) Le générateur EN JEU avance l’état sur la sim → il est ensuite sérialisé.
  const live = liveState();
  live.sim.rngSeed = 1234;
  const rng = makeSimRng(live.sim);
  rng(); rng();
  assert.equal(live.sim.rngCounter, 2, 'l’appel au rng fait avancer le compteur (état observable)');
});

// --- AC10-13 : reprise SANS PERTE (vols, réservations, files, finances) -----
test('AC10-13 : reprise sans perte — vol en taxi, porte réservée, finances, passagers', () => {
  const back = deserialize(serialize(liveState()));
  assert.equal(back.sim.aircraft.length, 1, 'le vol en taxi est préservé');
  assert.equal(back.sim.aircraft[0].phase, 'taxi', 'la phase active est préservée');
  assert.equal(back.sim.infra.gates[0].acId, 7, 'la réservation de porte est préservée');
  assert.equal(back.sim.economy.money, 5000, 'les finances sont préservées');
  assert.equal(back.sim.passengers.totalCarried, 1234, 'les passagers sont préservés');
  assert.equal(back.time, 321, 'l’horloge est préservée');
  // Le cache dérivé n’est PAS copié : il est RECONSTRUIT par la sim au 1er tick.
  assert.equal(back.sim._graph, null, 'le cache dérivé est remis à null (reconstruction)');
  assert.equal(back.sim._graphDirty, true, '… marqué sale pour reconstruction');
});

// AC11-12 : après reprise, la sim AVANCE (un tick ne crashe pas — A10 corrigé).
test('AC11-12 : reprise d’un état en taxi puis tick — pas de crash (cache reconstruit)', () => {
  const back = deserialize(serialize(liveState()));
  assert.doesNotThrow(() => tick(back, 0.1), 'le tick après reprise reconstruit le graphe (A10 corrigé)');
  assert.ok(back.sim._graph && back.sim._graph.nodes.length > 0, 'le graphe pathfinding est reconstruit au tick');
});

// --- A10/A11 via le panneau : invalide REFUSÉ + PRÉSERVÉ (copie diagnostic) --
test('A10/A11 : sauvegarde invalide refusée SANS crash + copie diagnostic PRÉSERVÉE', () => {
  const { store, teardown } = stubLocalStorage();
  const toasts = [];
  const state = { screen: 'menu', time: 0, terrain: { w: 1600, h: 1200 }, camera: { x: 0, y: 0, zoom: 1 } };
  const p = makeSavePanel(state, { toast: (m, k) => toasts.push([m, k]) });

  // Une sauvegarde INVALIDE (runways = null) dans le storage.
  const badState = liveState();
  badState.sim.infra.runways = null;
  store.set('airport-tycoon-save', JSON.stringify({ v: SAVE_VERSION, state: badState }));

  const ok = p.loadNow();
  assert.equal(ok, false, 'la reprise échoue proprement (pas de crash)');
  assert.equal(state.screen, 'menu', 'l’état courant n’est PAS écrasé');
  assert.ok(toasts.some(([m, k]) => k === 'err'), 'l’incompatibilité est ANNONCÉE (toast lisible)');
  assert.ok(store.has(DIAG_KEY), 'une copie diagnostic de la sauvegarde invalide est PRÉSERVÉE');
  assert.equal(store.has('airport-tycoon-save'), true, 'l’original n’est PAS supprimé (diagnostic)');
  teardown();
});

// --- Reprise RÉELLE via le panneau : un état vivant (taxi) + reload + tick ---
test('AC12-13 : sauvegarde en phase active → rechargement → reprise sans perte (panneau)', () => {
  const { store, teardown } = stubLocalStorage();
  const toasts = [];
  const live = liveState();
  const p1 = makeSavePanel(live, { toast: (m, k) => toasts.push([m, k]) });
  assert.equal(p1.autoSave(), true, 'la sauvegarde en phase active (taxi) est écrite');

  // Fermeture de la page (AC11) : le rechargement part d'un état FRAIS au menu.
  const fresh = { screen: 'menu', time: 0, terrain: { w: 1600, h: 1200 }, camera: { x: 0, y: 0, zoom: 1 } };
  const p2 = makeSavePanel(fresh, { toast: (m, k) => toasts.push([m, k]) });
  assert.equal(p2.loadNow(), true, 'le rechargement restaure la partie');
  assert.equal(fresh.sim.aircraft[0].phase, 'taxi', 'le vol en taxi est repris sans perte');
  assert.equal(fresh.sim.infra.gates[0].acId, 7, 'la réservation de porte est reprise');
  assert.equal(fresh.sim.economy.money, 5000, 'les finances sont reprises');
  assert.doesNotThrow(() => tick(fresh, 0.1), 'le tick après rechargement ne crashe pas');
  assert.equal(store.has('airport-tycoon-save'), true, 'la sauvegarde valide n’est PAS détruite au chargement réussi');
  teardown();
});
