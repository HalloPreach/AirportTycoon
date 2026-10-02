// R06 (D1) — le flux DOM réel de l'auto-accept, vérifié à la BORDURE DOM
// (zéro navigateur : un stub DOM minimal). Ce que ça prouve :
//   1. La CASE « auto-accept » n'écrit plus un flag local : son handler
//      ÉMET la commande onAutoChange (la même que la touche A dans main.mjs).
//   2. Câblée à setPlanningAuto (comme main.mjs), onAutoChange écrit
//      state.planningAuto (source unique) et le miroir DOM (la case) suit.
//   3. tickAuto() lit state.planningAuto et accepte les vols « planned »
//      via decideFlight (la porte de décision sim).
// Le flux navigateur complet (CDP) est hors-sujet ici : un check navigateur
// impossible = « non vérifié », jamais PASS (invariants). Le flux DOM au
// niveau de la bordure (case → commande → état → tickAuto → decideFlight)
// est ce qui est vérifiable sans navigateur, et c'est exactement ce qui
// était cassé (la case écrivait un flag local lu par personne).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlanningPanel } from '../src/ui/planning-panel.mjs';
import { newSimState } from '../src/core/sim-state.mjs';
import { decideFlight } from '../src/flights/flights.mjs';

// Stub DOM minimal : les nœuds gardent les enfants + les handlers d'événements.
// Les méthodes DOM touchées par planning-panel.mjs : createElement, createTextNode,
// body.appendChild, setAttribute, appendChild, append, addEventListener, replaceChildren.
function makeDom() {
  function makeNode(tag) {
    const node = {
      tag, className: '', textContent: '', children: [], handlers: {}, checked: false, type: '',
      setAttribute() {},
      appendChild(c) { this.children.push(c); },
      append(...cs) { this.children.push(...cs); },
      replaceChildren() { this.children = []; },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      // Le stub expose le handler pour que le test SIMULE un clic/case.
      fire(ev, payload) { for (const fn of this.handlers[ev] || []) fn(payload || {}); },
    };
    return node;
  }
  const body = makeNode('body');
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    body,
  };
  return { body };
}

// Trouve la case auto-accept (input de type checkbox dans le panneau .planning).
function findAutoCheckbox(body) {
  const planning = body.children.find((c) => c.tag === 'div' && c.className === 'planning');
  assert.ok(planning, 'le panneau .planning est dans le DOM');
  const label = planning.children.find((c) => c.className === 'planning-auto');
  assert.ok(label, 'le label auto-accept existe');
  const cb = label.children.find((c) => c && c.tag === 'input' && c.type === 'checkbox');
  assert.ok(cb, 'la case checkbox existe');
  return cb;
}

// Câblage FAIT COMME main.mjs : la case émet onAutoChange = setPlanningAuto.
function wireStatePanel(state) {
  const toasts = [];
  function setPlanningAuto(on) {
    state.planningAuto = !!on;
    panel.setAuto(!!on); // le miroir DOM (la case) suit l'état
    toasts.push(on ? 'Auto-accept ON' : 'Auto-accept OFF');
  }
  const panel = makePlanningPanel({ state, toast: toasts.push, onAutoChange: setPlanningAuto });
  return { panel, setPlanningAuto, toasts };
}

test('R06 (D1) : la case auto-accept ÉMET la commande (plus de flag local)', () => {
  const { body } = makeDom();
  const state = { screen: 'game', sim: newSimState(), planningAuto: false };
  const { panel, setPlanningAuto } = wireStatePanel(state);
  const cb = findAutoCheckbox(body);
  // La case est un Miroir de l'état : non cochée quand state.planningAuto=false.
  assert.equal(cb.checked, false, 'miroir = non coché (état false)');
  // Simuler le joueur qui coche la case : le handler doit appeler onAutoChange
  // (= setPlanningAuto) avec true → state.planningAuto passe à true (source unique).
  cb.checked = true;
  cb.fire('change');
  assert.equal(state.planningAuto, true, 'la case a écrit l\'état (commande), pas un flag local');
  assert.equal(cb.checked, true, 'le miroir DOM reste coché (suit l\'état)');
  // Et la MÊME commande que la touche A : setPlanningAuto fait la même chose.
  cb.checked = false;
  cb.fire('change'); // case → off
  assert.equal(state.planningAuto, false, 'la case dé-coche aussi (commande)');
  setPlanningAuto(true); // touche A (même commande)
  assert.equal(state.planningAuto, true, 'touche A et case passent par la même commande');
});

test('R06 (D1) : tickAuto lit state.planningAuto et accepte via decideFlight', () => {
  const { body } = makeDom();
  const sim = newSimState();
  // Deux vols planifiés (état réel de la sim, comme le fait le planificateur).
  sim.planning.push({ id: 1, airline: 'atlantique', acType: 'medium', pax: 50, planned: 100, status: 'planned' });
  sim.planning.push({ id: 2, airline: 'atlantique', acType: 'small', pax: 30, planned: 120, status: 'planned' });
  const state = { screen: 'game', sim, planningAuto: false };
  const { panel } = wireStatePanel(state);
  const cb = findAutoCheckbox(body);
  // OFF : tickAuto ne fait RIEN (les vols restent « planned »).
  panel.tickAuto();
  assert.equal(sim.planning.every((e) => e.status === 'planned'), true, 'OFF : aucun vol accepté');
  // Le joueur coche la case → l\'état passe à true → tickAuto accepte TOUS les planned.
  cb.checked = true;
  cb.fire('change');
  panel.tickAuto();
  assert.ok(sim.planning.every((e) => e.status === 'accepted'),
    `ON : tous les vols planifiés sont acceptés (${sim.planning.map((e) => e.status).join(',')})`);
  // decideFlight est resté la SEULE porte : les vols « accepted » ne sont plus
  // « planned » (l\'état sim est bien muté par decideFlight, pas par un autre chemin).
  assert.equal(sim.planning.filter((e) => e.status === 'accepted').length, 2, '2 vols acceptés via decideFlight');
});

test('R06 (D1) : nouvelle partie réinitialise la case (miroir suit l\'état false)', () => {
  const { body } = makeDom();
  const state = { screen: 'game', sim: newSimState(), planningAuto: true }; // préférence ON (ancienne partie)
  const { panel } = wireStatePanel(state);
  const cb = findAutoCheckbox(body);
  assert.equal(cb.checked, true, 'miroir coché (état ON, partie 1)');
  // « Nouvelle partie » : state.planningAuto forcé à false (comme startNewGame)
  // + le miroir re-synchronisé (planningPanel.setAuto(false)).
  state.planningAuto = false;
  panel.setAuto(false);
  assert.equal(cb.checked, false, 'nouvelle partie : la case suit l\'état (forcé à false)');
  // La case OFF n\'accepte plus rien : tickAuto lit l\'état (false).
  state.sim.planning.push({ id: 9, airline: 'x', acType: 'medium', pax: 10, planned: 0, status: 'planned' });
  panel.tickAuto();
  assert.equal(state.sim.planning[0].status, 'planned', 'après nouvelle partie, auto-accept inactif (état false)');
});
