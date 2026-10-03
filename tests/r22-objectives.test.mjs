// R22 (t_00318fe0) — objectifs de progression + récompense payée UNE fois.
// Vérifications (zéro DOM, déterministe, rng semé — zéro navigateur) :
//   1. L'état neuf porte les 2 objectifs (o1-cycle, o2-surge), non payés.
//   2. O1 : un cycle SANS départ sec (sim._cleanCycle) ET une période close
//      net ≥ 0 → la récompense (1 000 $) est payée ATOMIQUEMENT (le crédit
//      cash et le flag `paid` sont posés dans la même écriture).
//   3. Pas de double paiement : la condition reste vraie et des ticks
//      supplémentaires ne re-creditent PAS (l'id persiste, `paid` = true).
//   4. Persistance : après serialize → deserialize, la récompense payée
//      reste payée (l'identifiant persistant survit à la reprise — EV-10) et
//      le tick post-reprise ne la re-paie pas.
//   5. O2 : PENDANT un pic (surge forcé), la ponctualité ≥ 50 % des fins de
//      vol de la fenêtre bornée → récompense 1 500 $ ; hors pic → non atteint.
//   6. Faillite : une sim en faillite ne paie aucun objectif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { OBJECTIVES, ensureObjectives, tickObjectives, objectiveView } from '../src/progression/objectives.mjs';
import { closePeriod, lastPeriod } from '../src/economy/economy.mjs';
import { forceIncident, isSurge } from '../src/sim/incidents.mjs';
import { logFlightEnd } from '../src/sim/aircraft.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// État neuf : les 2 objectifs existent, non payés.
test('R22 : l’état neuf porte les 2 objectifs, non payés', () => {
  const sim = newSimState();
  const objs = ensureObjectives(sim);
  assert.equal(objs.length, 2, 'deux objectifs');
  assert.deepEqual(objs.map((o) => o.id), OBJECTIVES.map((o) => o.id), 'identifiants stables (persistance)');
  for (const o of objs) assert.equal(o.paid, false, `${o.id} non payé au départ`);
});

// Un état « cycle propre » posé PAR l'avion (le test simule le décollage
// sans _dryDeparture — le même champ que doDeparture lit).
function markCleanCycle(sim) { sim._cleanCycle = true; }

// Une période close net ≥ 0 (recettes > dépenses sur la période).
function closePosPeriod(sim) {
  sim.economy.revenue.pax = 5000; // recette depuis la base
  sim._periodBase = { revenue: 0, opex: 0, fuel: 0, compensation: 0, construction: 0, debt: 0 };
  closePeriod(sim);
  assert.ok(lastPeriod(sim).net >= 0, 'la période close est nette ≥ 0');
}

// Une fin de vol à l'heure (dans la fenêtre R17) — retarde 0 = ponctuel.
function logOnTimeFlight(sim, acType = 'medium') {
  sim.time = (sim.time ?? 0) + 1;
  logFlightEnd(sim, { id: sim.nextAcId++, acType, delayed: 0 }, false);
}

test('R22 : O1 — cycle avec plein + période net ≥ 0 → récompense payée UNE fois', () => {
  const sim = newSimState();
  const before = sim.economy.money;
  tickObjectives(sim); // rien : ni cycle, ni période
  assert.equal(sim.economy.money, before, 'aucun paiement avant la condition');
  markCleanCycle(sim);
  tickObjectives(sim); // cycle oui, période non → toujours rien
  assert.equal(sim.economy.money, before, 'pas de récompense sans période nette');
  closePosPeriod(sim);
  tickObjectives(sim); // les deux → PAIEMENT
  assert.equal(sim.economy.money, before + 1000, 'O1 : 1 000 $ crédités');
  assert.equal(sim.objectives.find((o) => o.id === 'o1-cycle').paid, true, 'flag paid posé');
  assert.equal(sim.economy.revenue.reward, 1000, 'la récompense passe par earn (compte revenue)');
  // Pas de double paiement : la condition reste vraie (les flags persistent).
  const after = sim.economy.money;
  for (let i = 0; i < 5; i++) tickObjectives(sim);
  assert.equal(sim.economy.money, after, '5 ticks suivants : plus de crédit (idempotent)');
  assert.equal(sim.alerts.filter((a) => a.kind === 'objective-paid').length, 1, 'un seul événement de paiement');
});

// Un wrapper d'état minimal valide (les champs REQUIRED de save.mjs) pour la
// boucle serialize → deserialize.
function makeState(sim) {
  return { screen: 'game', time: 0, terrain: null, camera: null, sim };
}

test('R22 : la récompense payée reste payée APRÈS sauvegarde + reprise (id persistant)', () => {
  const sim = newSimState();
  markCleanCycle(sim);
  closePosPeriod(sim);
  tickObjectives(sim); // O1 payée (1 000 $)
  const moneyBefore = sim.economy.money;
  const round = deserialize(serialize(makeState(sim))).sim;
  assert.equal(round.objectives.find((o) => o.id === 'o1-cycle').paid, true, 'le flag `paid` est sérialisé avec la sim');
  // La condition reste vraie dans la sim rechargée (les flags y sont aussi) :
  // le tick post-reprise ne doit PAS re-payer.
  tickObjectives(round);
  assert.equal(round.economy.money, moneyBefore, 'pas de re-paiement après la reprise');
});

test('R22 : O2 — pic de demande + ponctualité ≥ 50 % → récompense payée', () => {
  const sim = newSimState();
  const before = sim.economy.money;
  // Hors pic : condition non remplie (jamais un faux chiffre).
  logOnTimeFlight(sim);
  tickObjectives(sim);
  assert.equal(sim.economy.money, before, 'hors pic : pas de récompense O2');
  assert.equal(objectiveView(sim, 'o2-surge').state, 'à venir', 'le panneau dit « en attente d’un pic »');
  // Pic forcé + ponctualité restaurée : 2 vols à l'heure sur 2 (100 %).
  forceIncident(sim, 'surge');
  assert.ok(isSurge(sim), 'le pic est actif');
  logOnTimeFlight(sim); logOnTimeFlight(sim);
  tickObjectives(sim);
  assert.equal(sim.economy.money, before + 1500, 'O2 : 1 500 $ crédités');
  assert.equal(sim.objectives.find((o) => o.id === 'o2-surge').paid, true, 'flag paid posé');
  const after = sim.economy.money;
  tickObjectives(sim); // le pic peut durer, la condition peut rester vraie
  assert.equal(sim.economy.money, after, 'pas de double paiement O2');
});

test('R22 : ponctualité < 50 % pendant le pic → O2 non atteint (la mesure est le critère)', () => {
  const sim = newSimState();
  const before = sim.economy.money;
  forceIncident(sim, 'surge');
  // 1 vol à l'heure + 3 vols en retard : 25 % < 50 %.
  logOnTimeFlight(sim);
  for (let i = 0; i < 3; i++) logFlightEnd(sim, { id: sim.nextAcId++, acType: 'medium', delayed: 999 }, false);
  tickObjectives(sim);
  assert.equal(sim.economy.money, before, 'ponctualité insuffisante : pas de récompense');
  const v = objectiveView(sim, 'o2-surge');
  assert.equal(v.state, 'à venir', 'le panneau reste « à venir »');
  assert.match(v.detail, /25 %/, 'la mesure live est affichée (25 %)');
});

test('R22 : une sim en faillite ne paie aucun objectif', () => {
  const sim = newSimState();
  sim.economy.bankrupt = true;
  markCleanCycle(sim);
  closePosPeriod(sim);
  forceIncident(sim, 'surge');
  logOnTimeFlight(sim); logOnTimeFlight(sim);
  tickObjectives(sim);
  assert.equal(sim.economy.revenue.reward, undefined, 'faillite : aucun crédit');
  assert.equal(sim.economy.money, 12000, 'faillite : le solde est intact (pas de NaN)');
  assert.ok(ensureObjectives(sim).every((o) => o.paid === false), 'faillite : aucun flag paid');
});
