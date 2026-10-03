// Tests R34 (t_48232e68) : satisfaction/réputation reliées aux RÉSULTATS
// observés — la perte DIRECTE de pic (0,5 %/s dans incidents.mjs) est
// SUPPRIMÉE : la pénalité du pic, S'IL Y EN A UNE, vient UNIQUEMENT des
// files (passengers.mjs, module unique de vérité). VALIDATION (carte) :
//   1. pic ABSORBÉ (files vides) → AUCUNE pénalité (la satisfaction remonte,
//      pas de compensation artificielle perte/récupération) ;
//   2. pic MAL GÉRÉ (files saturées) → effet MESURABLE (la satisfaction chute) ;
//   3. explication des CAUSES (satisfactionCauses : lecture pure, même
//      formule que le tick — pas de second module qui se contredit).
// Zéro DOM, déterministe — même socle que les tests R32/R33.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { forceIncident, tickIncidents } from '../src/sim/incidents.mjs';
import { tickPassengers, satisfactionCauses } from '../src/sim/passengers.mjs';

// Un pic ACTIF (cadence doublée) + avancement des files d'un terminal.
// rng à 0 = aucun TIRAGE d'incident parasite (seul le pic forcé vit).
function withSurge(sim) {
  forceIncident(sim, 'surge');
  assert.ok(sim.incidents.surge.active, 'le pic est ACTIF (forcé)');
}

test('R34 (1) : pic ABSORBÉ (files vides) → AUCUNE pénalité directe, la satisfaction REMONTE', () => {
  const sim = newSimState();
  sim.passengers.satisfaction = 80;
  withSurge(sim);
  // PENDANT le pic (cadence doublée), les files restent VIDES : l'ancienne
  // perte directe (0,5 %/s) se « compensait » avec la récupération — le pic
  // absorbé se payait quand même. Désormais : rien n'est déduit par le pic.
  for (let k = 0; k < 60; k++) tickIncidents(sim, 1, () => 0);
  assert.equal(sim.passengers.satisfaction, 80,
    'pic actif + files vides : AUCUNE perte (le pic ne se paie que par les files)');
  // ... et la satisfaction REMONTE (récupération progressive, AC22) :
  for (let k = 0; k < 60; k++) tickPassengers(sim, 1);
  assert.equal(sim.passengers.satisfaction, 100,
    'files vides : récupération jusqu au plafond (80 + 0,5 %/s x 60 s >= 100)');
});

test('R34 (2) : pic MAL GÉRÉ (files saturées) → effet MESURABLE', () => {
  const sim = newSimState();
  withSurge(sim);
  // Un terminal saturé (capacités niveau 0 : check-in 120 / sécurité 120) —
  // les files d'un pic non absorbé (cadence doublée, pas de capacité) :
  sim.passengers.queues['1'] = { checkin: 10000, security: 10000, board: 10000 };
  const sc = satisfactionCauses(sim);
  assert.ok(sc.loss > 0, 'la cause lisible est non nulle (files saturées)');
  assert.ok(sc.satStages >= 1, 'le nombre d\'étapes saturées est LISIBLE');
  for (let k = 0; k < 30; k++) { tickPassengers(sim, 1); tickIncidents(sim, 1, () => 0); }
  assert.ok(sim.passengers.satisfaction < 50,
    'files saturées pendant le pic : la satisfaction CHUTE (effet mesurable)');
});

test('R34 (3) : les CAUSES sont lues par une LECTURE pure (une seule règle, pas de cumul contradictoire)', () => {
  const sim = newSimState();
  // Sim nue (aucune file) : cause nulle, AUCUNE mutation à la lecture.
  const sc0 = satisfactionCauses(sim);
  assert.deepEqual(sc0, { loss: 0, satStages: 0, overflow: 0 }, 'sim nue : aucune cause');
  assert.equal(sim.passengers.satisfaction, 100, 'la lecture ne touche PAS la satisfaction');
  // File vide sur terminal : cause nulle (même clé de file, pas de pax).
  sim.passengers.queues['1'] = { checkin: 0, security: 0, board: 0 };
  assert.equal(satisfactionCauses(sim).loss, 0, 'file vide : aucune perte');
  // File SATURÉE : cause strictement positive (la même formule que le tick —
  // le tick LA LIT : plus de second module qui se contredit, R34).
  sim.passengers.queues['1'].checkin = 120; // = capacité check-in niveau 0
  const sc1 = satisfactionCauses(sim);
  assert.ok(sc1.loss > 0 && sc1.satStages === 1, 'file saturée : cause lisible');
  assert.ok(sc1.overflow === 0, 'à la capacité exacte : aucun débordement');
  sim.passengers.queues['1'].checkin = 130; // 10 pax au-dessus
  assert.ok(satisfactionCauses(sim).overflow === 10, 'le débordement est mesurable');
});
