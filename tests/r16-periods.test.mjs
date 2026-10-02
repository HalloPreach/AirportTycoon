// R16 (t_007f2297) — périodes financières stables + prévision simple.
// Le bilan distingue CUMULS (toute la partie, periodStatement) et PÉRIODE
// RÉCENTE (les 5 dernières minutes de jeu, 300 s). La clôture est un compteur
// accumulateur (pattern _spawnAcc, flights.mjs) : 0 s de jeu (pause) ne clôt
// rien ; un gros tick ne duplique pas. Les composants de la période
// reconstituent le net (identité R12 : dette comptée une fois) et le net
// rapproche le solde (comptabilité, pas un chiffre à côté). Sans historique,
// la prévision est INDETERMINÉE (null) — jamais un faux chiffre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { earn, charge, onFlightCancelled, tickEconomy,
  closePeriod, forecast, lastPeriod, PERIOD_S } from '../src/economy/economy.mjs';

test('R16 — l\'état neuf porte les périodes (vides) + l\'accumulateur de clôture', () => {
  const sim = newSimState();
  assert.deepEqual(sim.economy.periods, [], 'état neuf : aucune période close');
  assert.equal(sim.economy._periodAcc, 0, 'accumulateur à 0 (pattern _spawnAcc)');
  assert.equal(sim.economy._periodBase.revenue, 0, 'base zéro : la 1re période mesure depuis t=0');
});

test('R16 — 0 s de jeu (pause) ne clôt rien ; un gros tick ne duplique pas', () => {
  const sim = newSimState();
  tickEconomy(sim, 0); // pause : 0 seconde de jeu
  assert.equal(sim.economy.periods.length, 0, 'un tick à 0 s ne clôt pas de période');
  assert.equal(sim.economy._periodAcc, 0, 'l\'accumulateur ne reçoit pas le 0');
  tickEconomy(sim, 1200); // gros tick : 4 périodes de 300 s (pas 5, pas 1 — compteur, pas horloge)
  assert.equal(sim.economy.periods.length, 4, '4 × 300 s = 4 clôtures, pas de duplication');
  assert.equal(sim.economy._periodAcc, 0, 'l\'accumulateur se remet à 0 après les clôtures');
  tickEconomy(sim, PERIOD_S - 1); // pas encore 300 s écoulées depuis la dernière clôture
  assert.equal(sim.economy.periods.length, 4, 'pas de 5e période avant 300 s de jeu');
  tickEconomy(sim, 1); // la 300e seconde de la fenêtre : elle clôt…
  assert.equal(sim.economy.periods.length, 4, '…et l\'historique BORNE garde les 4 dernières (R14)');
});

test('R16 — les composants de la période reconstituent le net (identité R12)', () => {
  const sim = newSimState();
  sim.economy.money = 500; // solde suffisant pour payer le taxiway (400 $) AVANT le déficit
  buildBuilding(sim, 'taxiway', 600, 1100);   // investissement de la période
  earn(sim, 5000, 'pax');                     // recettes de la période
  charge(sim, 6000, 'fuel');                  // carburant de la période
  charge(sim, 300, 'compensation');           // une indemnité de la période
  tickEconomy(sim, 1);                        // solde creusé : l'intérêt alimente la dette
  const p = closePeriod(sim);                 // clôture MANUELLE : la même fonction que le compteur
  assert.equal(p.revenue, 5000, 'recettes de la période (delta depuis la base)');
  assert.equal(p.fuel, 6000, 'carburant de la période');
  assert.equal(p.compensation, 300, 'indemnités de la période');
  assert.equal(p.invest, 400, 'investissement de la période (le compte construction)');
  assert.ok(p.debt > 0, 'la dette (intérêts) de la période est comptée…');
  // LA reconstitution : recettes − dépenses − dette (comptée UNE fois) = le net.
  assert.equal(p.net, p.revenue - p.opex - p.fuel - p.compensation - p.invest - p.debt,
    'net = ses composants (dette comprise, sans double comptage)');
  assert.ok(p.net < 0, 'la période est déficitaire (dépenses > recettes)');
});

test('R16 — le net de la période rapproche le solde (comptabilité, pas un chiffre à côté)', () => {
  const sim = newSimState();
  sim.economy.money = 0; // pas d\'infrastructure : aucun opex — la période est nette
  earn(sim, 400, 'pax');               // une seule recette…
  onFlightCancelled(sim);              // …et 4 indemnités : la période est DÉFICITAIRE
  onFlightCancelled(sim);
  onFlightCancelled(sim);
  onFlightCancelled(sim);
  tickEconomy(sim, 10);                // 10 s de jeu : l\'intérêt creuse le solde (dette)
  const p = closePeriod(sim);
  // Le solde (partant de 0) = le net de la période : l\'identité trésorerie EV-9
  // appliquée à LA période (money == net, comme R12 pour le cumulé).
  assert.ok(Math.abs(sim.economy.money - p.net) < 1e-9,
    `solde (${sim.economy.money}) == net de la période (${p.net})`);
  assert.ok(p.net < 0, 'déficit : le net est négatif');
});

test('R16 — sans historique, la prévision est INDETERMINEE (null), jamais un faux chiffre', () => {
  const sim = newSimState();
  assert.equal(forecast(sim), null, 'état neuf : pas d\'historique → prévision indéterminée');
  assert.equal(lastPeriod(sim), null, 'état neuf : pas de période récente');
  // La partie a avancé mais la 1re période n\'est PAS encore close : toujours null.
  tickEconomy(sim, 299);
  assert.equal(sim.economy.periods.length, 0, '299 s < 300 s : pas encore de clôture');
  assert.equal(forecast(sim), null, 'sans période close : toujours indéterminée (pas de faux chiffre)');
});

test('R16 — la prévision est une TENDANCE (taux de la dernière période, horizon 1 h)', () => {
  const sim = newSimState();
  earn(sim, 600, 'pax');
  closePeriod(sim);                    // période 1 : excédent (recettes, pas de dépenses)
  tickEconomy(sim, 300);               // période 2 close par le compteur : neutre (0)
  charge(sim, 1000, 'fuel');           // période 3 : un plein carburant + une petite recette…
  earn(sim, 100, 'gate');
  tickEconomy(sim, 300);               // …et sa clôture : DÉFICITAIRE
  assert.equal(sim.economy.periods.length, 3, '3 périodes closes (borné à 4)');
  const p3 = sim.economy.periods[2];
  assert.ok(p3.net < sim.economy.periods[1].net, 'la 3e période est plus déficitaire (dépenses > recettes)');
  const f = forecast(sim);
  assert.ok(f, 'historique : la prévision existe');
  // LA tendance : le taux est le net de la DERNIÈRE période divisé par sa durée
  // (seconde de jeu — l\'échelle R15) ; horizon 1 h de jeu, projeté = solde + tendance.
  const durS = p3.minutes * 60;
  assert.ok(Math.abs(f.rate - p3.net / durS) < 1e-9, 'taux = net de la dernière période / sa durée');
  assert.ok(Math.abs(f.perHour - f.rate * 3600) < 1e-9, '$/h = taux × 3600 (même échelle)');
  assert.equal(f.horizon, 3600, 'horizon : 1 h de jeu');
  assert.ok(Math.abs(f.projected - (sim.economy.money + f.rate * 3600)) < 1e-9,
    'solde projeté = solde + tendance × horizon (une projection, pas une garantie)');
});

test('R16 — la sauvegarde ANCIENNE (sans les champs R16) dégrade proprement au 1er close', () => {
  const sim = newSimState();
  delete sim.economy.periods; delete sim.economy._periodAcc; delete sim.economy._periodBase;
  sim.economy.spent.opex = 42; // un cumulé ANTERIEUR à la reprise (non ré-attribuable)
  tickEconomy(sim, 1); // les champs absents sont recréés par le tick (pas de crash)
  assert.equal(lastPeriod(sim), null, 'pas encore de période close : prévision indéterminée');
  assert.equal(forecast(sim), null, 'pas encore d\'historique close : jamais un faux chiffre');
  const p = closePeriod(sim); // le 1er close post-reprise : base absente → mesure depuis la reprise
  assert.equal(p.opex, 0, 'le cumulé antérieur (42) n\'est PAS attribué à la période : zéro depuis la reprise');
  assert.ok(forecast(sim) !== null, 'après le 1er close : la prévision est étayée par l\'historique close');
});
