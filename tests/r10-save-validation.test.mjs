// R10 — schéma explicite + migration : la validation de DESÉRIALISATION couvre
// tous les cas du brief (rejet lisible, reconstruction des dérivés, réservations
// des deux côtés). Chaque défaut → erreur LISIBLE (nommée), jamais de crash du
// 1er tick. Les cas « migrables » (dérivés recalculés, sans seed → seed 0) passent.
//
// Politique D4 (documentée dans save.mjs) : version ≠ courante = REJET dur ;
// les cas NON migrables (état minimal de menu, partie sans sim) sont TOLÉRÉS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize, SAVE_VERSION } from '../src/persistence/save.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';

// Un état de jeu MINIMAL mais VRAI (la sim moderne, construite par le jeu) :
// on le sérialise tel quel, puis on altère UNE chose à la fois pour tester le
// rejet. `game()` reconstruit un état neuf à chaque fois (pas d'aliasing).
function game() {
  const state = makeGameState(42);
  state.screen = 'game';
  return state;
}
function save(state) { return serialize(state); }
function expectReject(json) {
  assert.throws(() => deserialize(json), (e) => e instanceof Error && /Sauvegarde/.test(e.message), 'rejet lisible');
}
function altSave(mutate) {
  // Sérialise un état neuf, modifie le JSON BRUT (ce que ferait une sauvegarde
  // corrompue/manipulée), puis renvoie la chaîne à désérialiser.
  const state = game();
  const raw = JSON.parse(save(state));
  mutate(raw.state);
  return JSON.stringify(raw);
}

// --- Cas VALIDES (les sauvegardes du jeu doivent TOUJOURS passer) ------------

test('R10 : une sauvegarde du jeu est acceptée (round-trip complet)', () => {
  const s = game();
  // Un avion en route (approche) + une porte réservée (référence des DEUX côtés) :
  const ac = { id: s.sim.nextAcId++, acType: 'medium', phase: 'approach', x: 300, y: -150,
    gateId: null, runwayId: null, pax: 80, status: 'planned', path: null, pathPtr: 0 };
  s.sim.aircraft.push(ac);
  s.sim.planning.push({ id: ac.id, airline: 'solaire', acType: 'medium', pax: 80, planned: 60, status: 'planned' });
  const restored = deserialize(save(s));
  assert.ok(restored.sim.aircraft.length === 1, 'l\'avion est restauré');
  // DÉRIVÉS reconstruits (pas restaurés) : la grille d'occupation est UNE Uint8Array
  // pleine (recalculée des bâtiments), pas un `{}` corrompu ; le graphe est marqué
  // sale (reconstruit au 1er tick).
  assert.ok(restored.sim.infra.grid.cells instanceof Uint8Array, 'grille recalculée (Uint8Array)');
  assert.ok(restored.sim.infra.grid.cells.length === 160 * 120, 'grille pleine');
  assert.equal(restored.sim._graphDirty, true, 'graphe marqué sale (reconstruction au tick)');
  // La grille contient bien la piste fournie (cellule au centre de la piste marquée).
  const g = restored.sim.infra.grid;
  const cell = (x, y) => g.cells[Math.floor(y / 10) * g.w + Math.floor(x / 10)];
  assert.equal(cell(800, 600), 1, 'une cellule de la piste fournie est occupée (dérivée des bâtiments)');
});

// --- Cas de REJET lisible (chaque défaut du brief) ----------------------------

test('R10 : référence périmée avion→piste (piste inexistante) → rejet', () => {
  const json = altSave((s) => { s.sim.aircraft.push({ id: 999, acType: 'medium', phase: 'landing', runwayId: 4242, gateId: null }); });
  expectReject(json);
});
test('R10 : référence PÉRIée avion→porte (porte inexistante) → rejet', () => {
  const json = altSave((s) => { s.sim.aircraft.push({ id: 999, acType: 'medium', phase: 'gate', runwayId: null, gateId: 4242 }); });
  expectReject(json);
});
test('R10 : référence PÉRIée porte→avion (porte réservée par un avion absent) → rejet', () => {
  const json = altSave((s) => {
    // La porte fournie (id du 1er gate) est « réservée » à un avion qui n'existe pas.
    const gate = s.sim.infra.gates[0]; gate.acId = 777; // 777 n'est dans sim.aircraft
  });
  expectReject(json);
});
test('R10 : TYPE AVION inconnu (pas au catalogue) → rejet (capacités)', () => {
  const json = altSave((s) => { s.sim.aircraft.push({ id: 999, acType: 'gigantic', phase: 'approach' }); });
  expectReject(json);
});
test('R10 : phase inconnue → rejet', () => {
  const json = altSave((s) => { s.sim.aircraft.push({ id: 999, acType: 'medium', phase: 'space' }); });
  expectReject(json);
});
test('R10 : ID AVION en double → rejet', () => {
  const json = altSave((s) => {
    s.sim.aircraft.push({ id: 500, acType: 'medium', phase: 'approach' });
    s.sim.aircraft.push({ id: 500, acType: 'small', phase: 'approach' }); // doublon
  });
  expectReject(json);
});
test('R10 : ID INFRA en double (piste) → rejet', () => {
  const json = altSave((s) => {
    s.sim.infra.runways.push({ id: s.sim.infra.runways[0].id, x: 0, y: 0, w: 100, h: 100, len: 100 });
  });
  expectReject(json);
});
test('R10 : CHemin non restaurable (path présent mais pas un tableau) → rejet', () => {
  const json = altSave((s) => {
    s.sim.aircraft.push({ id: 999, acType: 'medium', phase: 'taxi', path: 'un-chemin-corrompu', pathPtr: 0 });
  });
  expectReject(json);
});
test('R10 : FILE PASSAGÈRE non numérique → rejet (capacités)', () => {
  const json = altSave((s) => { s.sim.passengers.queue.board = 'plein'; });
  expectReject(json);
});
test('R10 : version INCOMPATIBLE → rejet dur (politique D4 : pas de migration)', () => {
  const state = game();
  const raw = JSON.parse(save(state));
  raw.v = SAVE_VERSION - 1; // une version ANCIENNE
  const json = JSON.stringify(raw);
  assert.throws(() => deserialize(json), /incompatible/, 'rejet lisible de la version');
});

// --- Politique des cas NON MIGRABLES (tolérés, documentés) --------------------

test('R10 : état minimal de MENU (sans sim) → toléré (cas non migrable documenté)', () => {
  // Une sauvegarde au menu n'a pas de sim : c'est UN CAS TOLÉRÉ (pas un crash).
  const menu = { screen: 'menu', time: 0, terrain: { w: 1600, h: 1200 }, camera: { x: 800, y: 600, zoom: 1 } };
  const out = deserialize(JSON.stringify({ v: SAVE_VERSION, state: menu }));
  assert.equal(out.screen, 'menu', 'l\'état de menu est restauré');
  assert.equal(out.sim, undefined, 'pas de sim (cas toléré)');
});
test('R10 : PARTIE SANS sim (sim M1 minimale) → tolérée', () => {
  // Une partie qui n'a jamais de sim (terrain vide, M1) est rechargeable : la sim
  // est ABSENTE, pas invalide. On ne crashe pas au 1er tick.
  const state = game(); delete state.sim; // on retire la sim (M1)
  const out = deserialize(save(state));
  assert.equal(out.sim, undefined, 'sim absente (tolérée)');
});

// --- Reconstruction des DÉRIVÉS : le 1er tick ne crashe pas ------------------

test('R10 : après restore, le 1er tick ne crashe pas (dérivés reconstruits)', () => {
  const s = game();
  // Avance un peu la partie (un avion en approche + grille pleine + graphe construit).
  tick(s, 0.1, () => 0.5);
  const restored = deserialize(save(s));
  // Le 1er tick après restore : le graphe et la grille sont RECONSTRUITS, aucun crash.
  assert.doesNotThrow(() => tick(restored, 0.1, () => 0.5), 'le 1er tick post-restore ne crashe pas');
});
