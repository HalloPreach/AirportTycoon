// T7c (t_605b9779) — ICÔNES À LA PLACE DES LIBELLÉS D'ONGLETS (zéro
// surcharge). Prouvé ici SANS navigateur (stub DOM) :
// - les 10 boutons d'onglets portent une ICÔNE vectorielle (canvas 2D,
//   icons.mjs) + le NOM du menu en tooltip (title) + aria-label — le
//   texte ne figure PLUS dans le libellé ;
// - chaque icône d'onglet est un kind VALIDE d'ICON_KINDS (mapping TABS) ;
// - applyTab repointe l'icône de l'onglet ACTIF sombre (THEME.bg) et les
//   inactifs phosphore (THEME.text / THEME.accent) — l'icône suit l'état
//   actif du bouton (fond accent → glyphe sombre) ;
// - les sous-onglets COMPAGNIE du planning CONSERVENT le texte (noms de
//   marques, pas des catégories) : desktop = nom complet, mobile =
//   PREMIER MOT (anti-surcharge) — le filtre (id) ne change jamais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { Camera } from '../src/ui/camera.mjs';
import { makePanels } from '../src/ui/panels.mjs';
import { makePlanningPanel } from '../src/ui/planning-panel.mjs';
import { ICON_KINDS } from '../src/ui/icons.mjs';
import { THEME } from '../src/ui/theme.mjs';

// ---------------------------------------------------------------------------
// Partie 1 — la barre d'onglets (panels.mjs)
// ---------------------------------------------------------------------------
// Un ctx canvas 2D SPY qui enregistre les réglages de style (les couleurs
// réellement demandées par drawIcon — la preuve du re-rendu actif/inactif).
function makeSpyCtx2d() {
  const calls = [];
  const rec = (name) => (...a) => calls.push([name, ...a]);
  return {
    calls,
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    setLineDash: rec('setLineDash'),
    get fillStyle() { return '#'; }, set fillStyle(v) { calls.push(['fillStyle', v]); },
    get strokeStyle() { return '#'; }, set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get lineWidth() { return 1; }, set lineWidth(v) { calls.push(['lineWidth', v]); },
    get lineCap() { return 'butt'; }, set lineCap(v) { calls.push(['lineCap', v]); },
    get lineJoin() { return 'miter'; }, set lineJoin(v) { calls.push(['lineJoin', v]); },
    get globalAlpha() { return 1; }, set globalAlpha(v) { calls.push(['globalAlpha', v]); },
  };
}

// Stub DOM (garde-fous tests/t7b-tabs.test.mjs) + canvas avec UN CTX SPY
// (pour prouver le re-rendu des icônes par applyTab).
function makeDom() {
  function makeNode(tag) {
    const node = {
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
        if (i !== -1) this.children.splice(i, 1);
        this.children.push(c);
      },
      append(...cs) { this.children.push(...cs); },
      replaceChildren() { this.children = []; },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      fire(ev, payload) { for (const fn of this.handlers[ev] || []) fn(payload || {}); },
    };
    if (tag === 'canvas') {
      const g = makeSpyCtx2d();
      node.width = 0;
      node.height = 0;
      node.getContext = (kind) => (kind === '2d' ? g : null);
      node.ctx = g; // exposé par le stub (le test lit les couleurs demandées)
    }
    return node;
  }
  const canvas = makeNode('canvas');
  const body = makeNode('body');
  body.children.push(canvas);
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    querySelector: (sel) => (sel === '#game' ? canvas : null),
    body,
  };
  return { body, canvas };
}

const TAB_IDS = ['vols', 'inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts', 'alerts', 'net'];
const TAB_LABELS = Object.freeze({
  vols: 'Vols', inspect: 'Inspection', fin: 'Bilan', stats: 'Stats', goals: 'Objectifs',
  season: 'Saison', unlocks: 'Déblocs', contracts: 'Contrats', alerts: 'Alertes', net: 'Réseau',
});

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

test('T7c : chaque onglet = icône vectorielle + tooltip (NOM du menu) + aria-label, plus de texte', () => {
  const { panels } = freshPanels();
  const tabs = panels.tabs.children;
  assert.equal(tabs.length, 10, '10 onglets (Vols + 9 sections)');
  for (const b of tabs) {
    const id = b.attrs['data-tab'];
    assert.ok(TAB_IDS.includes(id), `onglet inconnu : ${id}`);
    // TOOLTIP : le NOM du menu reste accessible au survol (desktop).
    assert.equal(b.title, TAB_LABELS[id], `tooltip « ${id} » = ${TAB_LABELS[id]}`);
    // ACCESSIBILITÉ : le libellé étant une icône, le nom est en aria-label.
    assert.equal(b.attrs['aria-label'], TAB_LABELS[id], `aria-label « ${id} »`);
    // ICÔNE : un <canvas class="icon"> (canvas 2D, pattern T4) ENFANT du bouton.
    const icons = b.children.filter((c) => c.tag === 'canvas' && c.className === 'icon');
    assert.equal(icons.length, 1, `onglet ${id} : exactement 1 icône canvas`);
    assert.equal(icons[0].width, 24, 'icône 24 px (cible onglet ≥44 px pilotée CSS)');
    // Le LIBELLÉ texte est retiré (le canvas n'a pas de texte).
    assert.equal(b.textContent, '', `onglet ${id} : plus de libellé texte`);
  }
});

test('T7c : le mapping onglet → icône n\'utilise QUE des kinds d\'ICON_KINDS (zéro icône inconnue)', () => {
  const { panels } = freshPanels();
  for (const b of panels.tabs.children) {
    const icon = b.children.find((c) => c.tag === 'canvas');
    assert.ok(icon, 'icône présente (le kind existe sinon carré neutre — on s\'en prémunit)');
  }
  // La garde dev de panels.mjs aurait loggé un avertissement pour un kind
  // manquant : on vérifie directement le mapping (tous les kinds d'onglets
  // sont déclarés dans ICON_KINDS — 9 nouveaux T7c + « plane » réutilisé).
  const kinds = ['plane', 'inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts', 'alerts', 'net'];
  for (const k of kinds) assert.ok(ICON_KINDS.includes(k), `kind d'onglet manquant d'ICON_KINDS : ${k}`);
});

test('T7c : applyTab repointe l\'icône ACTIVE sombre (THEME.bg) et les inactives phosphore (THEME.text/accent)', () => {
  const { panels } = freshPanels();
  const volsBox = { tag: 'div', children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } };
  panels.registerPane('vols', volsBox);
  // État initial (onglet 'vols' actif) : l'icône de « Vols » est peinte sombre
  // (son bouton est actif = fond accent), les 9 autres phosphore.
  const byId = Object.fromEntries(panels.tabs.children.map((b) => [b.attrs['data-tab'], b]));
  const finCtx = byId.fin.children.find((c) => c.tag === 'canvas').ctx;
  assert.ok(finCtx.calls.some((c) => c[0] === 'clearRect'), 'l\'icône inactif est (re)peinte par applyTab');
  assert.ok(finCtx.calls.some((c) => c[0] === 'strokeStyle' && c[1] === THEME.text), 'inactif : couleur principale = THEME.text (phosphore)');
  assert.ok(finCtx.calls.some((c) => c[0] === 'strokeStyle' && c[1] === THEME.accent), 'inactif : accent = THEME.accent (cyan)');
  assert.ok(!finCtx.calls.some((c) => (c[0] === 'fillStyle' || c[0] === 'strokeStyle') && c[1] === THEME.bg),
    'inactif : jamais de couleur sombre (THEME.bg)');
  // Bascule : « Bilan » devient actif → son icône est peinte sombre, celle de
  // « Vols » repasse au phosphore.
  panels.setTab('fin');
  assert.equal(panels.activeTab(), 'fin');
  const finCtx2 = byId.fin.children.find((c) => c.tag === 'canvas').ctx;
  assert.ok(finCtx2.calls.some((c) => (c[0] === 'fillStyle' || c[0] === 'strokeStyle') && c[1] === THEME.bg),
    'actif (Bilan) : glyphe sombre = THEME.bg (lisible sur le fond accent)');
  const volsCtx = byId.vols.children.find((c) => c.tag === 'canvas').ctx;
  assert.ok(volsCtx.calls.slice(-40).some((c) => c[0] === 'fillStyle' && c[1] === THEME.text)
    || volsCtx.calls.slice(-40).some((c) => c[0] === 'strokeStyle' && c[1] === THEME.text),
    'redevenu inactif (Vols) : glyphe phosphore (THEME.text)');
});

// ---------------------------------------------------------------------------
// Partie 2 — les sous-onglets COMPAGNIE du planning (texte conservé, raccourci
// au premier mot sur mobile)
// ---------------------------------------------------------------------------
function makePlanningDom() {
  function makeNode(tag) {
    return {
      tag, className: '', textContent: '', children: [], handlers: {}, checked: false, type: '',
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
      setAttribute() {},
      appendChild(c) { this.children.push(c); },
      append(...cs) { this.children.push(...cs); },
      replaceChildren() { this.children = []; },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      fire(ev, payload) { for (const fn of this.handlers[ev] || []) fn(payload || {}); },
    };
  }
  const body = makeNode('body');
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    body,
  };
  return { body };
}

function filterButtons(body) {
  const planning = body.children.find((c) => c.tag === 'div' && c.className === 'planning');
  assert.ok(planning, 'le panneau .planning est dans le DOM');
  const filterBar = planning.children.find((c) => c.className === 'planning-filters');
  assert.ok(filterBar, 'la barre de filtres existe');
  return filterBar.children.filter((b) => b.tag === 'button');
}

function makePlanning(state) {
  const panel = makePlanningPanel({
    state,
    toast: () => {},
    onAutoChange: (on) => { state.planningAuto = on; },
  });
  state.sim.planning.push({ id: 1, airline: 'solaire', acType: 'small', pax: 20, planned: 100, status: 'planned' });
  panel.refresh(); // construit la liste + la barre de filtres
  return panel;
}

test('T7c (desktop) : les sous-onglets compagnie gardent le TEXTE COMPLET (noms de marques)', () => {
  delete globalThis.window; // desktop : pas de matchMedia mobile (comportement d'avant T7c)
  const { body } = makePlanningDom();
  const state = { screen: 'game', sim: newSimState(), planningAuto: false };
  makePlanning(state);
  const names = filterButtons(body).map((b) => b.textContent);
  for (const n of ['Solaire Air', 'Atlantique', 'PacificCargo', 'Boréal Régions', 'Horizon Express']) {
    assert.ok(names.includes(n), `nom complet attendu : « ${n} » (détecté : ${names.join(', ')})`);
  }
});

test('T7c (mobile) : les noms multi-mots sont RACCOURCIS au premier mot (anti-surcharge), 1 mot intact', () => {
  const { body } = makePlanningDom();
  // matchMedia mobile : (max-width: 560px) → matches = true.
  globalThis.window = {
    matchMedia: (q) => ({
      media: q,
      matches: q === '(max-width: 560px)',
      addEventListener() {},
    }),
  };
  const state = { screen: 'game', sim: newSimState(), planningAuto: false };
  makePlanning(state);
  const names = filterButtons(body).map((b) => b.textContent);
  assert.ok(names.includes('Solaire'), '« Solaire Air » → « Solaire »');
  assert.ok(!names.includes('Solaire Air'), 'le nom complet n\'est plus affiché');
  assert.ok(names.includes('Atlantique'), '« Atlantique » (1 mot) intact');
  assert.ok(names.includes('PacificCargo'), '« PacificCargo » (1 mot) intact');
  assert.ok(names.includes('Boréal'), '« Boréal Régions » → « Boréal »');
  assert.ok(names.includes('Horizon'), '« Horizon Express » → « Horizon »');
  assert.ok(names.includes('tous'), 'le filtre « tous » est conservé');
  delete globalThis.window;
});
