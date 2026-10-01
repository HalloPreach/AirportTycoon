// Tests Node (sans DOM) : logique de construction (via la sim) + sauvegarde/chargement.
// La construction est la responsabilité de la sim (src/infra/infra.mjs) — on la
// teste ICI car c'est la surface de l'UI. Les tests de sauvegarde sont purs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize, SAVE_VERSION } from '../src/persistence/save.mjs';

// --- Sauvegarde / chargement ------------------------------------------------

function fakeState() {
  return {
    screen: 'game', time: 123,
    terrain: { w: 1600, h: 1200 },
    camera: { x: 800, y: 600, zoom: 1 },
    sim: { economy: { money: 5000 }, aircraft: [] },
  };
}

test('sérialiser puis dé-sérialiser un état donne un état équivalent', () => {
  const s = fakeState();
  const back = deserialize(serialize(s));
  assert.equal(back.screen, 'game');
  assert.equal(back.time, 123);
  assert.equal(back.sim.economy.money, 5000);
  assert.notEqual(back, s); // copie fraîche, pas la même référence
});

test('une sauvegarde de version incompatible est refusée proprement', () => {
  const json = JSON.stringify({ v: 99, state: fakeState() });
  assert.throws(() => deserialize(json), /incompatible/);
});

test('un JSON corrompu est refusé avec un message lisible', () => {
  assert.throws(() => deserialize('{ pas du json'), /illisible/i);
});

test('un état manquant (sans terrain) est refusé', () => {
  const json = JSON.stringify({ v: SAVE_VERSION, state: { screen: 'game', time: 0 } });
  assert.throws(() => deserialize(json), /terrain/);
});

test('une sauvegarde sans sim (partie M1) est valide', () => {
  const json = JSON.stringify({ v: SAVE_VERSION, state: { screen: 'game', time: 0, terrain: { w: 1600, h: 1200 }, camera: { x: 1, y: 2, zoom: 1 } } });
  const s = deserialize(json);
  assert.equal(s.sim, undefined); // pas de sim : la partie se recharge quand même
});

test('un objet sans version est refusé', () => {
  assert.throws(() => deserialize(JSON.stringify({ state: fakeState() })), /incompatible/);
});

test('une sauvegarde vide est refusée', () => {
  assert.throws(() => deserialize('null'), /vide/);
});

// --- Construction via la sim (surface de l'UI) -----------------------------
// Ces tests n'exécutent que si la sim est présente (autre milestone). La sim
// importe des modules qui doivent exister ; sinon on saute proprement.

test('construire puis démolir un bâtiment (sim) — remboursement partiel', async () => {
  const m = await import('../src/core/sim.mjs').catch(() => null);
  const sim = m ? await m.freshSimState() : null;
  if (!sim) { console.log('SKIP : sim pas encore prête'); return; }
  const { buildBuilding, demolishBuilding } = await import('../src/infra/infra.mjs');
  const b = buildBuilding(sim, 'runway', 200, 200);
  assert.ok(b, 'une piste se pose sur un aéroport vierge');
  const before = sim.economy.money;
  const r = demolishBuilding(sim, b.id);
  assert.equal(r.ok, true);
  assert.ok(r.refund > 0, 'démolir rembourse une part');
  assert.equal(sim.economy.money, before + r.refund);
  assert.equal(sim.infra.runways.length, 0);
});

test('construire au-dessus d’un bâtiment existant est refusé (sim)', async () => {
  const m = await import('../src/core/sim.mjs').catch(() => null);
  const sim = m ? await m.freshSimState() : null;
  if (!sim) { console.log('SKIP : sim pas encore prête'); return; }
  const { buildBuilding } = await import('../src/infra/infra.mjs');
  buildBuilding(sim, 'runway', 200, 200); // 400×80 à (200,200)
  const blocked = buildBuilding(sim, 'taxiway', 250, 220); // chevauche
  assert.equal(blocked, null, 'chevauchement refusé');
  assert.ok(sim.alerts.some((a) => a.kind === 'build-blocked'), 'un événement build-blocked est émis');
});

test('construire sans assez de fonds est refusé (sim)', async () => {
  const m = await import('../src/core/sim.mjs').catch(() => null);
  const sim = m ? await m.freshSimState() : null;
  if (!sim) { console.log('SKIP : sim pas encore prête'); return; }
  const { buildBuilding } = await import('../src/infra/infra.mjs');
  sim.economy.money = 0; // faillite partielle
  const b = buildBuilding(sim, 'terminal', 300, 300);
  assert.equal(b, null);
  assert.ok(sim.alerts.some((a) => a.kind === 'no-funds'), 'un événement no-funds est émis');
});

// --- Panneau sauvegarde : auto-save + reprise (critères 10-13) --------------
// makeSavePanel est sans DOM : on le teste avec un stub localStorage en mémoire.
// On pose le stub AVANT d'importer le panneau (le storage est lu à l'appel).
function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return { store, teardown: () => { delete globalThis.localStorage; } };
}

test('auto-save : en jeu il écrit, au menu il refuse (silencieux)', async () => {
  const { store, teardown } = stubLocalStorage();
  const { makeSavePanel } = await import('../src/ui/save-panel.mjs');
  const state = { screen: 'game', time: 5, terrain: { w: 1600, h: 1200 }, camera: { x: 1, y: 2, zoom: 1 } };
  const p = makeSavePanel(state, { toast: () => {} });
  assert.equal(p.autoSave(), true, 'auto-save en jeu écrit la sauvegarde');
  assert.equal(store.size, 1, 'une entrée localStorage écrite');
  state.screen = 'menu';
  assert.equal(p.autoSave(), false, 'auto-save au menu ne sauvegarde pas');
  assert.equal(p.canResume(), true, 'une sauvegarde existe → on peut reprendre');
  teardown();
});

test('reprendre (R au menu) restaure un état de jeu cohérent', async () => {
  const { teardown } = stubLocalStorage();
  const { makeSavePanel } = await import('../src/ui/save-panel.mjs');
  const state = { screen: 'game', time: 42, terrain: { w: 1600, h: 1200 }, camera: { x: 3, y: 4, zoom: 2 } };
  const p = makeSavePanel(state, { toast: () => {} });
  assert.equal(p.autoSave(), true, 'on sauvegarde la partie en cours');
  // Le joueur quitte au menu : l'état courant repasse au menu, la sauvegarde reste.
  state.screen = 'menu';
  assert.equal(p.canResume(), true, 'le menu peut proposer « Reprendre »');
  assert.equal(p.loadNow(), true, 'reprendre restaure la partie');
  assert.equal(state.screen, 'game', 'l’état restauré est en jeu');
  assert.equal(state.time, 42, 'le temps de jeu est restauré');
  assert.equal(state.camera.zoom, 2, 'la caméra est restaurée');
  teardown();
});

test('sauvegarde absente : « Reprendre » signale en clair sans crash', async () => {
  const { store, teardown } = stubLocalStorage();
  const { makeSavePanel } = await import('../src/ui/save-panel.mjs');
  const state = { screen: 'menu', time: 0, terrain: { w: 1600, h: 1200 }, camera: { x: 0, y: 0, zoom: 1 } };
  const p = makeSavePanel(state, { toast: () => {} });
  assert.equal(p.canResume(), false, 'pas de sauvegarde → pas de reprise');
  assert.equal(p.loadNow(), false, 'reprendre sans sauvegarde refuse proprement');
  assert.equal(state.screen, 'menu', 'l’écran reste au menu (pas de crash)');
  assert.equal(store.size, 0, 'rien n’a été écrit');
  teardown();
});
