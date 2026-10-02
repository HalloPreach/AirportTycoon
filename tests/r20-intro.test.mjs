// R20 (t_55701859) — Introduction du PREMIER CYCLE (src/ui/intro.mjs) :
//   1. la progression vit sur `state.intro` (sérialisée) : nouvelle partie =
//      étape 1 ; sauvegarde ANCIENNE (champ absent) → on garde la session ;
//      l'étape est BORNEE (une valeur corrompue ne sort jamais de la liste) ;
//   2. désactivable : « Terminer » (done) ou « Passer » (skipped) — les deux
//      survivent au save/load (on ne re-suit pas l'intro après une reprise) ;
//   3. le tutoriel ne RECOMPENSE rien (pas de fonds, pas de bonus — un flag
//      d'UI, la sim est insensible) ;
//   4. la carte n'existe qu'EN JEU (menu → masquée), et la navigation a des
//      bornes (pas de dérive vers une étape inexistante).
// DOM factice (même patron que panels.test.mjs) : zéro navigateur.
// Le rendu navigateur (boutons visibles, premier cycle sans README) = sonde
// CDP de la carte G2 — ce fichier verrouille le CONTRAT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGameState } from '../src/core/new-game.mjs';
import { makeIntro } from '../src/ui/intro.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// --- DOM factice minimal (l'intro n'utilise que ce qui est listé ici) -----
function makeDom() {
  function makeNode(tag) {
    return {
      tag, className: '', textContent: '', style: {}, children: [], handlers: {},
      setAttribute() {},
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
// Les boutons de la carte sont DANS un sous-conteneur (« actions ») — la
// recherche se fait par TEXTE du bouton, quel que soit le niveau (le test ne
// s'accroche pas à la structure interne de la carte).
function findButton(node, label) {
  for (const c of node.children) {
    if (c.textContent === label) return c;
    if (c.children?.length) { const f = findButton(c, label); if (f) return f; }
  }
  return null;
}
function wireIntro(state) {
  const { body } = makeDom();
  const intro = makeIntro(state, body);
  const card = body.children.find((c) => c.className === 'intro');
  const btns = (label) => findButton(card, label);
  return { intro, card, btns };
}
// Une partie EN JEU (makeGameState = état complet : sim + aéroport fourni,
// screen initial = 'menu' → on le bascule en 'game' comme le fait main.mjs).
function game() {
  const s = makeGameState();
  s.screen = 'game';
  return s;
}

// --- 1. Nouvelle partie : l'intro démarre à l'étape 1, EN JEU -------------
test("R20 : nouvelle partie → l'intro existe (étape 1) et la carte s'affiche en jeu", () => {
  const state = game();
  assert.deepEqual(state.intro, { step: 0, done: false, skipped: false }, 'state.intro est initialisé');
  const { intro, card } = wireIntro(state);
  intro.refresh();
  assert.equal(card.style.display, '', 'la carte est visible en jeu');
});

test("R20 : au menu, la carte d'intro est masquée (le menu a ses boutons)", () => {
  const state = makeGameState(); // screen = 'menu'
  const { intro, card } = wireIntro(state);
  intro.refresh();
  assert.equal(card.style.display, 'none', "pas d'intro sur l'écran du menu");
});

// --- 2. Navigation bornée (souris) ----------------------------------------
test('R20 : Suivant/Précédent avancent et sont bornés aux deux bouts', () => {
  const state = game();
  const { intro, btns } = wireIntro(state);
  for (let i = 0; i < 4; i++) { btns('Suivant →').fire('click'); intro.refresh(); }
  assert.equal(state.intro.step, 4, 'on atteint la dernière étape (5/5)');
  btns('Suivant →').fire('click'); intro.refresh(); // au-delà de la borne
  assert.equal(state.intro.step, 4, 'Suivant borné à la dernière étape');
  btns('← Précédent').fire('click'); intro.refresh();
  assert.equal(state.intro.step, 3, 'Précédent revient en arrière');
  // Et « Précédent » borné à la première étape.
  for (let i = 0; i < 4; i++) { btns('← Précédent').fire('click'); intro.refresh(); }
  assert.equal(state.intro.step, 0, 'Précédent borné à la première étape');
});

// --- 3. Désactivation : done / skipped survivent au save/load -------------
test('R20 : « Terminer » / « Passer » masquent la carte et survivent au save/load', () => {
  const state = game();
  const { intro, card, btns } = wireIntro(state);
  btns('Passer l’intro').fire('click');
  intro.refresh();
  assert.equal(card.style.display, 'none', 'la carte disparaît');
  assert.equal(state.intro.skipped, true, 'l’état skipped est SUR LE STATE (sérialisé)');
  // Save/load : un joueur qui a PASSÉ l'intro ne la revoit PAS après reprise.
  const back = deserialize(serialize(state));
  assert.equal(back.intro.skipped, true, 'skipped survit à la sérialisation');
  const state2 = game();
  const w2 = wireIntro(state2);
  Object.assign(state2, back); // ce que fait save-panel.mjs au chargement
  w2.intro.refresh();
  assert.equal(w2.card.style.display, 'none', 'pas de re-suit après reprise (skipped)');
  // Idem pour « Terminer » (done) — le joueur qui a FINI ne re-suit pas.
  const state3 = game();
  const w3 = wireIntro(state3);
  for (let i = 0; i < 4; i++) { w3.btns('Suivant →').fire('click'); w3.intro.refresh(); }
  w3.btns('Terminer l’intro').fire('click');
  assert.equal(state3.intro.done, true, 'done est sur le state');
  const back3 = deserialize(serialize(state3));
  assert.equal(back3.intro.done, true, 'done survit à la sérialisation');
});

// --- 4. Sauvegarde ANCIENNE (sans champ intro) : on garde la session -------
test('R20 : une sauvegarde sans champ intro garde la progression courante (pas de reset)', () => {
  const state = game();
  const { intro, btns } = wireIntro(state);
  btns('Suivant →').fire('click'); // étape 2
  assert.equal(state.intro.step, 1);
  // Sauvegarde « ancienne » : le clone du state SANS le champ intro (version R20).
  const stripped = structuredClone(state);
  delete stripped.intro;
  const back = deserialize(serialize(stripped));
  assert.equal(back.intro, undefined, 'le clone restauré n’a pas le champ');
  const live = game();
  live.intro.step = 1; // la session courante était à l’étape 2
  const w = wireIntro(live);
  Object.assign(live, back); // loadNow() : Object.assign, le champ vit sur le state
  w.intro.refresh();
  assert.equal(live.intro.step, 1, 'le champ absent du clone ne supprime PAS la progression courante');
});

// --- 5. Valeur corrompue : l'étape est bornée, la peinture ne dérive pas ---
test('R20 : une étape corrompue (négative / hors liste / non entière) est bornée à 0..4', () => {
  const state = game();
  const { intro } = wireIntro(state);
  state.intro = { step: 999, done: false, skipped: false };
  intro.refresh(); // normalise à chaque frame (comme dans main.mjs)
  assert.equal(state.intro.step, 4, 'une étape au-delà est bornée à la dernière');
  state.intro = { step: -5, done: false, skipped: false };
  intro.refresh();
  assert.equal(state.intro.step, 0, 'une étape négative rebouche à la première');
  state.intro = { step: 12.7, done: false, skipped: false }; // valeur non entière (JSON corrompu)
  intro.refresh();
  assert.equal(state.intro.step, 4, 'une valeur non entière est bornée sans crash');
});

// --- 6. Le tutoriel ne RECOMPENSE rien ------------------------------------
test('R20 : terminer ou passer l’intro ne touche AUCUNE règle de la sim (pas de récompense)', () => {
  const s1 = game();
  const sim = s1.sim;
  const before = JSON.stringify({ money: sim.economy.money, pax: sim.passengers?.totalCarried, ac: sim.aircraft.length });
  const { intro, btns } = wireIntro(s1);
  for (let i = 0; i < 4; i++) { btns('Suivant →').fire('click'); intro.refresh(); }
  btns('Terminer l’intro').fire('click'); // le joueur a FINI l’intro
  const after = JSON.stringify({ money: sim.economy.money, pax: sim.passengers?.totalCarried, ac: sim.aircraft.length });
  assert.equal(after, before, 'aucun effet sur la sim : l’intro ne donne ni argent ni rien');
  // Idem pour « Passer » (skipped) : la sim est insensible aux deux.
  const s2 = game();
  const sim2 = s2.sim;
  const b2 = JSON.stringify({ money: sim2.economy.money, pax: sim2.passengers?.totalCarried, ac: sim2.aircraft.length });
  const w2 = wireIntro(s2);
  w2.btns('Passer l’intro').fire('click');
  const a2 = JSON.stringify({ money: sim2.economy.money, pax: sim2.passengers?.totalCarried, ac: sim2.aircraft.length });
  assert.equal(a2, b2, '« Passer » ne récompense pas non plus');
});

// --- 7. Le champ est SÉRIALISABLE avec l'état entier (invariant dur §1) ----
test('R20 : state.intro traverse un aller-retour serialize/deserialize (état métier sérialisable)', () => {
  const state = game();
  state.intro = { step: 2, done: false, skipped: false };
  const back = deserialize(serialize(state));
  assert.deepEqual(back.intro, { step: 2, done: false, skipped: false }, 'intro sérialisée en entier');
  // Progression REPRENUE : une reprise redonne l’étape courante (pas l’étape 1).
  const state2 = game();
  state2.intro = { step: 3, done: false, skipped: false };
  const back2 = deserialize(serialize(state2));
  assert.equal(back2.intro.step, 3, 'une reprise redonne l’étape 4/5 (progression reprise)');
});
