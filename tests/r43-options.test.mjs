// R43 (t_62bd0be8) — Options PERSISTANTES (src/ui/options.mjs) + PALETTES
// (src/ui/palette.mjs). Contrat à verrouiller :
//   1. les options vivent sur une clé localStorage DÉDIÉE (OPTIONS_KEY),
//      SÉPARÉE de la sauvegarde de jeu (SAVE_KEY) : elles survivent à une
//      nouvelle partie et à une suppression de la sauvegarde ;
//   2. une options CORROMPUE/INCOMPATIBLE retombe aux DÉFAUTS — une
//      préférence ne doit JAMAIS bloquer le jeu (contrairement à la
//      sauvegarde de jeu, préservée en copie diagnostic, A10) ;
//   3. les vitesses réutilisent SPEEDS existantes (x1/x2/x4) — jamais
//      réinventées ; la validation est bornée (volume 0-100, index valide) ;
//   4. la palette daltonienne est COMPLÈTE (mêmes clés que le standard :
//      aucune clé manquante = pas de rendu cassé) et remplace les paires
//      rouge/vert problématiques — les SHAPES restent à la charge du
//      renderer (symboles/textes), la palette ne change que les couleurs.
// Logique PURE (zéro DOM) — même patron que r20-intro.test.mjs (DOM factice
// uniquement pour la page options).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPTIONS_KEY, OPTIONS_VERSION, DEFAULT_OPTIONS,
  normalizeOptions, serializeOptions, deserializeOptions,
  saveOptionsToStorage, loadOptions, clearOptions, makeOptionsPage,
} from '../src/ui/options.mjs';
import { PALETTES, getPalette, isColor } from '../src/ui/palette.mjs';
import { SPEEDS } from '../src/core/game-state.mjs';
import { SAVE_KEY } from '../src/persistence/save.mjs';

// --- Stub localStorage (sans DOM, même patron que build-save.test.mjs) ----
function stubLocalStorage() {
  const store = new Map();
  const st = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return { st, store };
}

// --- DOM factice (même patron que r20-intro.test.mjs) : la page options ----
// n'utilise que createElement/appendChild/setAttribute/addEventListener.
function makeDom() {
  function makeNode(tag) {
    return {
      tag, className: '', textContent: '', value: '', style: {},
      children: [], handlers: {}, attrs: {}, dataset: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); },
      append(...cs) { this.children.push(...cs); },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      fire(ev) { for (const fn of this.handlers[ev] || []) fn({}); },
    };
  }
  const body = makeNode('body');
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    querySelector: () => null,
    body,
  };
  return { body };
}
// Recherche par TEXTE (quel que soit le niveau de nesting), comme r20-intro.
function findByText(node, label) {
  for (const c of node.children) {
    if (c.textContent === label) return c;
    if (c.children?.length) { const f = findByText(c, label); if (f) return f; }
  }
  return null;
}

// --- 1. PALETTES : complètes, valides, daltonienne distincte --------------
test('les deux palettes sont COMPLÈTES (aucune clé manquante = pas de rendu cassé)', () => {
  const KEYS = ['terrain', 'gridLine', 'terrainBorder', 'buildings', 'gates', 'alert', 'menuBg'];
  const BLD = ['runway', 'taxiway', 'terminal', 'fuel', 'hangar', 'catering', 'cleaning', 'baggage'];
  const GATES = ['S', 'M', 'L', 'occupied'];
  for (const p of [PALETTES.standard, PALETTES.colorBlind]) {
    for (const k of KEYS) assert.ok(k in p, `clé manquante : ${k}`);
    for (const k of ['terrain', 'terrainBorder', 'alert', 'menuBg']) {
      assert.ok(isColor(p[k]), `${k} = ${p[k]} n'est pas une couleur lisible`);
    }
    assert.ok(isColor(p.gridLine), `gridLine = ${p.gridLine} n'est pas une couleur lisible`);
    for (const b of BLD) assert.ok(isColor(p.buildings[b]), `buildings.${b} = ${p.buildings[b]}`);
    for (const g of GATES) assert.ok(isColor(p.gates[g]), `gates.${g} = ${p.gates[g]}`);
  }
  // Même TAILLE de cartes : le renderer lit les mêmes clés dans les deux modes.
  assert.deepEqual(Object.keys(PALETTES.standard.buildings), Object.keys(PALETTES.colorBlind.buildings));
  assert.deepEqual(Object.keys(PALETTES.standard.gates), Object.keys(PALETTES.colorBlind.gates));
});

test('getPalette : mode falsy → standard (jamais d\'erreur, jamais null)', () => {
  assert.equal(getPalette(false), PALETTES.standard);
  assert.equal(getPalette(undefined), PALETTES.standard); // mode absent → standard
  assert.equal(getPalette(null), PALETTES.standard);
  assert.equal(getPalette(true), PALETTES.colorBlind);
});

test('la palette daltonienne remplace les paires rouge/vert (Wong)', () => {
  const S = PALETTES.standard, C = PALETTES.colorBlind;
  // Les couleurs PROBLÉMATIQUES du standard (vertes/rouges) ne sont plus
  // utilisées telles quelles en daltonien — les symboles/textes restent la
  // garantie de lisibilité, seule la carte de couleurs change.
  assert.notEqual(C.gates.S, S.gates.S, 'portes S : le vert standard doit disparaître');
  assert.notEqual(C.gates.occupied, S.gates.occupied, 'portes occupées : le rouge standard doit disparaître');
  assert.notEqual(C.alert, S.alert, 'l\'alerte rouge devient du vermillon (lu « orange »)');
  assert.notEqual(C.terrain, S.terrain, 'le fond vert (herbe) devient un fond neutre');
  // Les 4 états de portes restent DISTINCTS (S/M/L/occupée) en daltonien.
  const gateVals = [C.gates.S, C.gates.M, C.gates.L, C.gates.occupied];
  assert.equal(new Set(gateVals).size, 4, 'les 4 couleurs de portes doivent rester distinctes');
});

// --- 2. Options : normalisation PURE (bornes + defaults) -------------------
test('normalizeOptions(undefined) → les DÉFAUTS (volume 50, daltonien OFF, x1)', () => {
  assert.deepEqual(normalizeOptions(undefined), DEFAULT_OPTIONS);
  assert.deepEqual(normalizeOptions(null), DEFAULT_OPTIONS);
  assert.deepEqual(normalizeOptions('corrompu'), DEFAULT_OPTIONS);
});

test('normalizeOptions : des valeurs valides passent telles quelles', () => {
  assert.deepEqual(normalizeOptions({ volume: 75, colorBlind: true, speedIndex: 1 }),
    { volume: 75, colorBlind: true, speedIndex: 1 });
});

test('normalizeOptions : aucune valeur corrompue ne sort des bornes', () => {
  // Volume : entier 0-100 (arrondi ; hors borne → clamp ; non-numérique → défaut).
  assert.equal(normalizeOptions({ volume: -10 }).volume, 0, 'volume négatif → 0');
  assert.equal(normalizeOptions({ volume: 150 }).volume, 100, 'volume > 100 → 100');
  assert.equal(normalizeOptions({ volume: 3.7 }).volume, 4, 'volume non entier → arrondi');
  assert.equal(normalizeOptions({ volume: 'abc' }).volume, DEFAULT_OPTIONS.volume);
  assert.equal(normalizeOptions({ volume: NaN }).volume, DEFAULT_OPTIONS.volume);
  // Vitesse : entier dans [0..SPEEDS.length-1] — les vitesses EXISTANTES.
  assert.equal(normalizeOptions({ speedIndex: SPEEDS.length + 5 }).speedIndex, SPEEDS.length - 1);
  assert.equal(normalizeOptions({ speedIndex: -1 }).speedIndex, 0);
  assert.equal(normalizeOptions({ speedIndex: 2.5 }).speedIndex, DEFAULT_OPTIONS.speedIndex, 'non-entier → défaut');
  assert.equal(normalizeOptions({ speedIndex: '1' }).speedIndex, DEFAULT_OPTIONS.speedIndex, 'string → défaut');
  // colorBlind : tout non-booléen est coercé proprement (jamais d\'erreur).
  assert.equal(normalizeOptions({ colorBlind: 'yes' }).colorBlind, true);
  assert.equal(normalizeOptions({ colorBlind: 0 }).colorBlind, false);
});

test('serialize/deserializeOptions : aller-retour + erreurs LISIBLES', () => {
  const o = { volume: 30, colorBlind: true, speedIndex: 2 };
  assert.deepEqual(deserializeOptions(serializeOptions(o)), o, 'aller-retour stable');
  // Corrompu → message lisible (pas de crash silencieux).
  assert.throws(() => deserializeOptions('{ pas du json'), /illisible/i);
  assert.throws(() => deserializeOptions('null'), /vides/i);
  // Version incompatible → refusé lisiblement.
  const bad = JSON.stringify({ v: OPTIONS_VERSION + 1, options: { volume: 50 } });
  assert.throws(() => deserializeOptions(bad), /incompatible/i);
});

// --- 3. Stockage : clé DÉDIÉE, séparée de la sauvegarde --------------------
test('loadOptions SANS localStorage (Node) → défauts, sans erreur', () => {
  assert.equal(typeof localStorage, 'undefined'); // précondition Node
  assert.deepEqual(loadOptions(), { ...DEFAULT_OPTIONS });
});

test('save → load : les options survivent, sur la clé DÉDIÉE', () => {
  const { st, store } = stubLocalStorage();
  const o = { volume: 80, colorBlind: true, speedIndex: 2 };
  assert.equal(saveOptionsToStorage(o, st), true, 'enregistrement réussi');
  assert.ok(store.has(OPTIONS_KEY), 'écrit sur OPTIONS_KEY');
  assert.equal(store.has(SAVE_KEY), false, 'la sauvegarde de jeu n\'est JAMAIS touchée');
  assert.equal(OPTIONS_KEY, 'airport-tycoon-options');
  assert.notEqual(OPTIONS_KEY, SAVE_KEY, 'clé dédiée ≠ clé de sauvegarde (critère R43)');
  assert.deepEqual(loadOptions(st), o, 'aller-retoint complet');
});

test('des options CORROMPUES/INCOMPATIBLES retombent aux défauts (ne bloquent jamais le jeu)', () => {
  const { st, store } = stubLocalStorage();
  store.set(OPTIONS_KEY, '{ pas du json');
  assert.deepEqual(loadOptions(st), { ...DEFAULT_OPTIONS }, 'JSON corrompu → défauts');
  store.set(OPTIONS_KEY, JSON.stringify({ v: 99, options: {} }));
  assert.deepEqual(loadOptions(st), { ...DEFAULT_OPTIONS }, 'version incompatible → défauts');
  clearOptions(st);
  assert.equal(store.has(OPTIONS_KEY), false, 'clearOptions efface la clé');
  assert.deepEqual(loadOptions(st), { ...DEFAULT_OPTIONS }, 'après effacement → défauts');
});

test('saveOptionsToStorage signale l\'échec (storage indisponible) sans planter', () => {
  const failing = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem() {} };
  assert.equal(saveOptionsToStorage({ volume: 50 }, failing), false);
  assert.equal(saveOptionsToStorage({ volume: 50 }, null), false, 'aucun storage (Node) → false');
});

// --- 4. La PAGE options (DOM factice) : UI fine, ne décide rien -------------
test('makeOptionsPage : ouverte/masquée, 1 bouton par VITESSE EXISTANTE', () => {
  const { body } = makeDom();
  const opts = { ...DEFAULT_OPTIONS };
  const page = makeOptionsPage({}, opts, { onApply() {}, onBack() {}, parent: body });
  const card = body.children[0];
  assert.equal(card.className, 'options');
  assert.equal(card.style.display, 'none', 'masquée par défaut');
  page.open();
  assert.equal(card.style.display, '', 'visible après open()');
  assert.equal(page.isOpen(), true);
  page.close();
  assert.equal(card.style.display, 'none', 'masquée après close()');
  // Un bouton par vitesse (SPEEDS : x1/x2/x4) — jamais de vitesse inventée.
  const speedBtns = [...card.children[3].children];
  assert.equal(speedBtns.length, SPEEDS.length);
  speedBtns.forEach((b, i) => assert.equal(b.textContent, `Vitesse x${SPEEDS[i]}`));
});

test('makeOptionsPage : chaque action COMMITTE l\'objet vivant et émet onApply', () => {
  const { body } = makeDom();
  const opts = { ...DEFAULT_OPTIONS };
  const applied = [];
  const page = makeOptionsPage({}, opts, {
    onApply: (o) => applied.push({ ...o }),
    onBack() {},
    parent: body,
  });
  const card = body.children[0];
  // Vitesse : le clic sur « Vitesse x4 » met à jour l\'objet vivant + onApply.
  const btnX4 = card.children[3].children[SPEEDS.length - 1];
  btnX4.fire('click');
  assert.equal(opts.speedIndex, SPEEDS.length - 1, 'l\'objet vivant est mis à jour');
  assert.equal(applied.at(-1).speedIndex, SPEEDS.length - 1, 'onApply porte la valeur');
  assert.equal(btnX4.getAttribute('aria-pressed'), 'true', 'le bouton sélectionné est marqué');
  // Mode daltonien : la bascule est un TOGGLE (le label affiche l\'état).
  const cbBtn = card.children[2];
  assert.equal(cbBtn.textContent, 'Mode daltonien : OFF', 'état initial OFF');
  cbBtn.fire('click');
  assert.equal(opts.colorBlind, true, 'toggle ON');
  assert.equal(cbBtn.textContent, 'Mode daltonien : ON', 'le label suit l\'état');
  // Volume : le slider COMMITTE (l\'input ne peut pas sortir de 0-100).
  const volSlider = card.children[1].children[0].children[2];
  assert.equal(volSlider.min, '0');
  assert.equal(volSlider.max, '100');
  volSlider.value = '33';
  volSlider.fire('input');
  assert.equal(opts.volume, 33, 'le volume suit le slider');
  assert.equal(applied.at(-1).volume, 33);
  // « Retour au menu » émet onBack (main.mjs : close).
  let backFired = false;
  const page2 = makeOptionsPage({}, { ...DEFAULT_OPTIONS }, {
    onApply() {}, onBack: () => { backFired = true; }, parent: body,
  });
  findByText(body.children[1], 'Retour au menu').fire('click');
  assert.equal(backFired, true, 'onBack émis au clic');
  assert.equal(page.isOpen(), false); // l\'état initial de la page est fermé
});
