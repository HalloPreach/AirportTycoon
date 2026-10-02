// R12 (t_25614b63) — le bilan se RAPPORCHE au solde.
// Cause racine : `debt` est un COMPTE DÉDIÉ (l'intérêt), pas un principal
// d'emprunt. L'intérêt est chargé UNE fois du solde (tickEconomy : money -= i)
// et cumulé dans economy.debt (le ledger) ; l'identité trésorerie EV-9
// (money = START + recettes − dépenses − debt) tient car le −debt y est déjà
// compté. LA GAP : periodStatement.net OMETTAIT la dette → le bilan ne se
// rapprochait pas du solde (money partant de 0 ≠ net, exactement le
// symptôme). Fix : net COMPTABILISE la dette (ligne dédiée du bilan) →
// partant de 0, money == net à chaque instant. Zéro DOM, déterministe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding } from '../src/infra/infra.mjs';
import { earn, charge, onFlightCancelled, tickEconomy, periodStatement } from '../src/economy/economy.mjs';

// Une PÉRIODE DÉFICITAIRE avec TOUTES les catégories (récette, carburant,
// construction, démolition, annulation, intérêts) — pour prouver le
// rapprochement complet du solde. Tout passe par l'accounting réel (jamais
// d'écriture directe sur money → l'identité EV-9 reste intègre).
function fullDeficitPeriod(sim) {
  // (1) RECETTES : billets (pax). (2) CARBURANT : dépense dédiée du départ.
  earn(sim, 1000, 'pax');
  charge(sim, 50, 'fuel');
  // (3) CONSTRUCTION (investissement) puis (4) DÉMOLITION (remboursement 50 %).
  const tw = buildBuilding(sim, 'taxiway', 550, 1050);
  assert.ok(tw, 'le taxiway est construit (compte construction)');
  const dem = demolishBuilding(sim, tw.id);
  assert.ok(dem.ok, 'le taxiway est démolí (remboursement 50 %)');
  // (5) ANNULATION : deux vols annulés (compte compensation) → solde DÉFICITAIRE.
  onFlightCancelled(sim);
  onFlightCancelled(sim);
  // (6) INTÉRÊTS : le solde négatif fait s'aggraver la dette (compte dédié).
  tickEconomy(sim, 1); // base 250 $ × 1 %/s × 1 s = 2,5 $ d'intérêt
}

// LA VALIDATION R12 : un scénario avec des recettes, une construction, une
// démolition, du carburant, une annulation ET des intérêts sur la dette →
// le solde se RAPPROCHE du net du bilan (money == net, partant de 0).
test('R12 — partant de 0, le solde EGALE le net du bilan (toutes catégories, dette comprise)', () => {
  const sim = newSimState();
  sim.economy.money = 0; // point de départ contrôlé : zéro
  fullDeficitPeriod(sim);
  const st = periodStatement(sim);
  // Chaque compte du bilan est alimenté — le bilan porte TOUTE la période.
  assert.ok(st.revenue > 0, 'recettes (billets + remboursement démolition)');
  assert.equal(st.invest, 400, 'construction comptée en investissement');
  assert.equal(st.compensation, 1000, 'deux annulations comptées (compte compensation)');
  assert.equal(st.fuel, 50, 'carburant compté (dépense dédiée)');
  assert.ok(st.debt > 0, 'la dette (intérêts) a cumulé dans le compte dédié');
  // LE rapprochement (R12) : partant de 0, le solde == le net du bilan,
  // dette COMPRISE — le solde ne dérive plus de l'intérêt (EV-9).
  assert.ok(Math.abs(sim.economy.money - st.net) < 1e-9,
    `rapprochement : money (${sim.economy.money}) == net (${st.net})`);
  assert.ok(st.net < 0, 'la période est DÉFICITAIRE (net négatif)');
});

test('R12 — l’identité EV-9 tient APRÈS la période (money = START + rec − dep − debt)', () => {
  const sim = newSimState();
  sim.economy.money = 0;
  fullDeficitPeriod(sim);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const expected = 0 + sum(sim.economy.revenue) - sum(sim.economy.spent) - sim.economy.debt;
  assert.ok(Math.abs(sim.economy.money - expected) < 1e-9,
    `EV-9 : money (${sim.economy.money}) == START + rec − dep − dette (${expected})`);
});

test('R12 — la dette (intérêts) est une LIGNE du bilan, pas un principal d’emprunt', () => {
  const sim = newSimState();
  sim.economy.money = 0;
  fullDeficitPeriod(sim);
  const st = periodStatement(sim);
  // La dette est un COMPTE DÉDIÉ (le ledger) : exposée telle quelle dans le bilan.
  assert.equal(st.debt, sim.economy.debt, 'la dette du bilan = le compte dédié (economy.debt)');
  // Elle est COMPABILISE dans le net (le bilan se rapproche du solde) ET nommée
  // en cause du déficit — pas un « principal d'emprunt » inventé.
  assert.ok(st.causes.some((c) => c.includes('dette')),
    'la cause « intérêts sur la dette » est nommée dans le bilan');
  // Pas de double débit : le net (dette comprise) RAPPROCHE le solde — si on
  // retranchait la dette UNE SECONDE FOIS, money ≠ net (le bug R12).
  assert.ok(Math.abs(sim.economy.money - st.net) < 1e-9,
    'money == net : la dette n est comptée qu une fois (pas de double débit)');
});
