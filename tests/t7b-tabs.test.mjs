// T7b (t_d1005365) — OGL (onglets) : le contenu des menus est piloté par
// BOUTONS, un panneau à la fois. Prouvé ici SANS navigateur (stub DOM) :
// - la barre d'onglets porte 10 boutons (Vols + les 9 sections) avec
//   aria-pressed (pattern R43, boutons non checkbox) ;
// - cliquer un onglet n'affiche QUE son panneau (les autres porteurs de
//   l'attribution `hidden`) — jamais 0, jamais 2 ;
// - le pane « Vols » (le bandeau planning, main.mjs) est régitré sur desktop
//   → re-parenté dans la zone du panneau actif, onglet actif par défaut ;
// - mobile (pas de régistration) → le 1er pane interne (Inspection) est
//   actif par défaut, et un setTab('vols') retombe dessus (pas d'onglet
//   orphelin) ;
// - la transition desktop→mobile (unregisterPane) remet le bandeau au body
//   et bascule la zone sur un pane interne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { Camera } from '../src/ui/camera.mjs';
import { makePanels } from '../src/ui/panels.mjs';

// Stub DOM (mêmes garde-fous que tests/planning-panel.test.mjs) + les
// attributs `hidden`/`aria-pressed` lus via attrs (la logique T7b ne touche
// QUE setAttribute/removeAttribute/className — jamais classList au build).
function makeDom() {
  function makeNode(tag) {
    return {
      tag,
      className: '',
      textContent: '',
      children: [],
      handlers: {},
      attrs: {},
      style: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        toggle(c, force) {
          const on = force === undefined ? !this._s.has(c) : !!force;
          if (on) this._s.add(c); else this._s.delete(c);
          return on;
        },
        contains(c) { return this._s.has(c); },
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) {
        const i = this.children.indexOf(c);
        if (i !== -1) this.children.splice(i, 1); // DOM réel : appendChild déplace
        this.children.push(c);
      },
      append(...cs) { this.children.push(...cs); },
      replaceChildren() { this.children = []; },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      fire(ev, payload) { for (const fn of this.handlers[ev] || []) fn(payload || {}); },
    };
  }
  const canvas = makeNode('canvas');
  const body = makeNode('body');
  body.children.push(canvas); // le panneau s'attache au body ; le clic est sur #game
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    querySelector: (sel) => (sel === '#game' ? canvas : null),
    body,
  };
  return { body, canvas };
}

function freshPanels() {
  const state = { screen: 'game', sim: newSimState() };
  state.camera = { x: 50, y: 50, zoom: 1 };
  const { body, canvas } = makeDom();
  const camera = new Camera(state);
  const panels = makePanels({
    state, camera,
    viewSize: () => ({ width: 100, height: 100 }),
    buildTool: undefined,
  });
  return { panels, body, canvas };
}

// Un pane est VISIBLE s'il est dans la zone SANS l'attribution `hidden`.
function visiblePanes(panels) {
  return panels.zone.children.filter((el) => el.attrs.hidden === undefined);
}

const TAB_IDS = ['vols', 'inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts', 'alerts', 'net'];

test('T7b : la barre d\'onglets porte 10 boutons (Vols + 9 sections), tous aria-pressed', () => {
  const { panels } = freshPanels();
  const tabs = panels.tabs.children;
  assert.equal(tabs.length, 10, '10 onglets (Vols + les 9 sections)');
  for (const b of tabs) {
    assert.equal(b.tag, 'button', 'bouton (cible ≥44 px pilotée par CSS)');
    assert.ok(b.attrs['data-tab'] !== undefined, 'data-tab présent');
    assert.ok(b.attrs['aria-pressed'] === 'true' || b.attrs['aria-pressed'] === 'false', 'aria-pressed présent');
  }
  // 9 sections internes déjà dans la zone (le pane 'vols' arrive via main.mjs).
  assert.equal(panels.zone.children.length, 9, 'les 9 sections internes sont dans la zone');
});

test('T7b (desktop) : la régistration du pane « Vols » le met VISIBLE par défaut, seul', () => {
  const { panels } = freshPanels();
  const volsBox = { tag: 'div', children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
  panels.registerPane('vols', volsBox);
  assert.equal(panels.activeTab(), 'vols', 'l\'onglet actif par défaut = Vols (le plus utile)');
  assert.ok(panels.zone.children.includes(volsBox), 'le bandeau planning est RE-PARENTÉ dans la zone');
  const visible = visiblePanes(panels);
  assert.equal(visible.length, 1, 'exactement 1 panneau visible');
  assert.equal(visible[0], volsBox, 'le panneau visible = Vols');
  // Le bouton « Vols » est le seul enfoncé.
  const pressed = panels.tabs.children.filter((b) => b.attrs['aria-pressed'] === 'true');
  assert.equal(pressed.length, 1, 'un seul bouton actif');
  assert.equal(pressed[0].attrs['data-tab'], 'vols');
});

test('T7b : setTab(id) n\'affiche QUE le panneau demandé — 10/10 onglets vérifiés', () => {
  const { panels } = freshPanels();
  const volsBox = { tag: 'div', children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
  panels.registerPane('vols', volsBox);
  const expected = { vols: volsBox };
  // les 9 sections internes, dans l'ordre de TABS :
  const internal = panels.zone.children.filter((el) => el !== volsBox);
  TAB_IDS.slice(1).forEach((id, i) => { expected[id] = internal[i]; });
  for (const id of TAB_IDS) {
    panels.setTab(id);
    assert.equal(panels.activeTab(), id, `onglet ${id} actif`);
    const visible = visiblePanes(panels);
    assert.equal(visible.length, 1, `onglet ${id} : exactement 1 panneau visible`);
    assert.equal(visible[0], expected[id], `onglet ${id} : le panneau visible est le bon`);
    const pressed = panels.tabs.children.filter((b) => b.attrs['aria-pressed'] === 'true');
    assert.equal(pressed.length, 1, `onglet ${id} : un seul bouton actif`);
    assert.equal(pressed[0].attrs['data-tab'], id, `onglet ${id} : le bouton actif est le bon`);
  }
});

test('T7b : le CLIC sur un bouton d\'onglet bascule le panneau affiché (pas seulement la commande)', () => {
  const { panels } = freshPanels();
  const volsBox = { tag: 'div', children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
  panels.registerPane('vols', volsBox);
  const finBtn = panels.tabs.children.find((b) => b.attrs['data-tab'] === 'fin');
  finBtn.fire('click');
  assert.equal(panels.activeTab(), 'fin', 'le clic sur « Bilan » affiche le bilan, pas Vols');
  assert.equal(visiblePanes(panels).length, 1, 'et toujours un seul panneau');
});

test('T7b (mobile) : sans pane « Vols », le 1er pane interne est actif par défaut (pas d\'onglet orphelin)', () => {
  const { panels } = freshPanels();
  // Pas de registerPane('vols') — c'est le branchement mobile de main.mjs.
  assert.equal(panels.activeTab(), 'inspect', 'Inspection = 1er pane disponible');
  assert.equal(visiblePanes(panels).length, 1, 'exactement 1 panneau (Inspection)');
  // setTab('vols') sans pane → retombe sur le 1er pane disponible (le bouton
  // est masqué en CSS mobile, mais la commande programmatique doit exister).
  panels.setTab('vols');
  assert.equal(panels.activeTab(), 'inspect', 'vols absent → repli sur Inspection');
  assert.equal(visiblePanes(panels).length, 1, 'toujours exactement 1 panneau');
});

test('T7b : unregisterPane (« Vols ») remet le bandeau hors zone et bascule sur un pane interne', () => {
  const { panels } = freshPanels();
  const volsBox = { tag: 'div', children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
  panels.registerPane('vols', volsBox);
  panels.setTab('vols');
  assert.equal(panels.activeTab(), 'vols');
  // Transition desktop → mobile : main.mjs désenregistre + remet le bandeau au body.
  panels.unregisterPane('vols');
  assert.equal(panels.activeTab(), 'inspect', 'bascule sur le 1er pane interne');
  assert.equal(visiblePanes(panels).length, 1, 'exactement 1 panneau visible');
  assert.notEqual(visiblePanes(panels)[0], volsBox, 'le bandeau Vols n\'est plus affiché');
  assert.equal(volsBox.attrs.hidden !== undefined, true, 'le bandeau porte `hidden` (il restera masqué hors zone)');
});
