// R24 (t_f712f1a5) — contrats courts de compagnie : prime/pénalité réglées
// UNE fois sur une mesure de PÉRIODE (vols, pax, ponctualité de SA taille).
// Vérifications (zéro DOM, déterministe, rng semé — zéro navigateur) :
//   1. État neuf : ni offre, ni contrat actif ; la première offre exige
//      CONTRACT_FIRST_PAX (300) pax transportés — la condition est affichée.
//   2. ≥ 300 pax → OFFRE du 1er modèle (faible volume) : accepter → contrat
//      ACTIF (période lancée), refuser → GRATUIT (aucun changement d'argent).
//   3. Le refus donne une TRÊVE : pas de nouvelle offre avant le cooldown ;
//      après le cooldown le MÊME modèle est re-proposé (un contrat non réglé
//      ne fait pas avancer la rotation).
//   4. Fin de période RÉUSSITE (vols + pax + ponctualité de SA taille) → la
//      PRIME est créditée ATOMIQUEMENT (flag settled + earn dans la même
//      écriture) ; le tick suivant ne la re-credite PAS (jamais double).
//   5. Fin de période MANQUÉE (vols < exigés) → la PÉNALITÉ est payée UNE
//      fois, même en DÉCICIT (charge sans garde-fou, D5) ; jamais de double.
//   6. Ponctualité < exigée (modèle qualité, appareil large) → pénalité : le
//      taux est la MESURE des fins de vol à l'heure (règle R17, rotation
//      nominale), pas un compteur de temps.
//   7. La taille compte : un vol d'une AUTRE taille n'est pas compté pour le
//      contrat (le 747 du modèle qualité n'est pas rempli par des Cessna).
//   8. Annulation d'un contrat actif : pénalité due immédiatement (D6 : le
//      jeu ne se « fait » pas payer une offre sans effort).
//   9. Persistance : serialize → deserialize conserve le contrat actif et ses
//      compteurs — la reprise règle le contrat UNE fois, jamais deux (EV-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import {
  CONTRACT_MODELS, CONTRACT_FIRST_PAX, CONTRACT_REJECT_COOLDOWN_S,
  ensureContracts, tickContracts, activeContract, decideContract, cancelContract, contractView,
} from '../src/flights/contracts.mjs';
import { logFlightEnd } from '../src/sim/aircraft.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

const LOW = CONTRACT_MODELS.find((m) => m.id === 'light');
const QUALITY = CONTRACT_MODELS.find((m) => m.id === 'quality');

// Une FIN DE VOL enregistrée comme fait makeAircraft (flights.mjs) : l'avion
// porte le contrat actif du moment (ac.contractId) + le pax embarqué.
// `delayed` = retard cumulé (0 = à l'heure, règle R17 : delayed ≤ rotation).
function flight(sim, acType, delayed, pax = 100) {
  sim.time = (sim.time ?? 0) + 1;
  sim.passengers.totalCarried += pax;
  const ac = { id: sim.nextAcId++, acType, delayed, pax };
  const a = activeContract(sim);
  if (a) ac.contractId = a.id; // l'opération enregistre son contrat
  logFlightEnd(sim, ac, false);
}
// Vols À L'HEURE du modèle (la taille du modèle — le contrat ne compte que sa
// propre taille d'avion, pas n'importe quel vol de la période).
const onTime = (sim, m) => flight(sim, m.acType, 0, 100);
// Un vol EN RETARD (600 s > rotation nominale — hors ponctualité R17).
const late = (sim, m) => flight(sim, m.acType, 600, 100);

function acceptFirstOffer(sim) {
  assert.ok(sim.contracts.offered, 'une offre est présente');
  assert.ok(decideContract(sim, sim.contracts.offered.id, true), 'accepté');
  assert.ok(activeContract(sim), 'le contrat est ACTIF');
}

test('R24 : état neuf — pas d’offre avant 300 pax, la condition est affichée', () => {
  const sim = newSimState();
  tickContracts(sim, 60);
  assert.equal(sim.contracts.offered, null, 'pas d’offre avant la condition');
  assert.equal(activeContract(sim), null, 'pas de contrat actif');
  const v = contractView(sim);
  assert.equal(v.offered, null, 'le panneau : pas d’offre');
  assert.equal(v.nextOfferAt, CONTRACT_FIRST_PAX, 'la condition (300 pax) est affichée');
  // La condition devient vraie → l’offre du 1er modèle apparaît au tick suivant.
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  assert.ok(sim.contracts.offered, 'l’offre apparaît (condition mesurée, pas un seuil de temps)');
  assert.equal(sim.contracts.offered.model, LOW.id, 'le 1er contrat = le modèle faible volume');
});

test('R24 : accepter lance la période ; refuser est gratuit (argent intact)', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim);
  assert.ok(activeContract(sim), 'contrat actif après acceptation');

  const sim2 = newSimState();
  sim2.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim2, 60);
  const before = sim2.economy.money;
  assert.ok(decideContract(sim2, sim2.contracts.offered.id, false), 'refus accepté');
  assert.equal(sim2.economy.money, before, 'refus gratuit : l’argent est intact');
  assert.equal(activeContract(sim2), null, 'pas de contrat actif après refus');
});

test('R24 : trêve post-refus — pas de re-proposition avant le cooldown', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  decideContract(sim, sim.contracts.offered.id, false); // refus
  sim.time += 600;
  tickContracts(sim, 60);
  assert.equal(sim.contracts.offered, null, 'refus : pas de re-proposition pendant la trêve');
  sim.time += CONTRACT_REJECT_COOLDOWN_S; // la trêve est dépassée
  tickContracts(sim, 60);
  assert.ok(sim.contracts.offered, 'après le cooldown : l’offre revient');
  assert.equal(sim.contracts.offered.model, LOW.id,
    'le MÊME modèle (non réglé → la rotation n’avance qu’avec un règlement)');
});

test('R24 : période réussie — la PRIME est créditée UNE fois, jamais double', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim);
  // Période remplie : les vols exigés (SA taille), le pax minimum, 100 % à l'heure.
  for (let i = 0; i < LOW.flights; i++) onTime(sim, LOW); // 300 pax ≥ minPax (15)
  sim.time += LOW.period; // la période se termine
  tickContracts(sim, 60);
  const rec = sim.contracts.history.find((h) => h.result === 'success');
  assert.ok(rec, 'le contrat est réglé RÉUSSI');
  assert.equal(rec.settled, true, 'flag settled posé (mesure de période, jamais re-réglable)');
  assert.equal(sim.economy.money, 12000 + LOW.bonus, `la prime ${LOW.bonus} $ est créditée`);
  assert.equal(activeContract(sim), null, 'plus de contrat actif');
  const again = sim.economy.money;
  tickContracts(sim, 60); tickContracts(sim, 60); // la période close ne se re-règle pas
  assert.equal(sim.economy.money, again, 'pas de double prime');
});

test('R24 : période manquée (vols < exigés) — PÉNALITÉ payée UNE fois, même en déficit', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim);
  for (let i = 0; i < LOW.flights - 2; i++) onTime(sim, LOW); // 1 vol < 3 exigés
  sim.time += LOW.period;
  tickContracts(sim, 60);
  const rec = sim.contracts.history.find((h) => h.result === 'failed');
  assert.ok(rec, 'le contrat est réglé MANQUÉ');
  assert.equal(rec.settled, true, 'flag settled (la pénalité est réglée, une seule écriture)');
  assert.equal(sim.economy.money, 12000 - LOW.penalty, `la pénalité ${LOW.penalty} $ est débitée`);
  assert.equal(activeContract(sim), null, 'plus de contrat actif');
  const again = sim.economy.money;
  tickContracts(sim, 60); tickContracts(sim, 60);
  assert.equal(sim.economy.money, again, 'pas de double pénalité');
});

test('R24 : ponctualité < exigée (modèle qualité) → pénalité (la mesure est le critère)', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  // Proposer directement le modèle qualité (rotation forcée par l’historique).
  ensureContracts(sim); // état créé (initialisation paresseuse) avant l'historique synthétique
  sim.contracts.history.push({ id: 'light', model: 'light', settled: true, result: 'success' });
  sim.contracts.history.push({ id: 'regular', model: 'regular', settled: true, result: 'success' });
  tickContracts(sim, 60);
  assert.equal(sim.contracts.offered.model, QUALITY.id, '3e contrat = qualité exigeante');
  acceptFirstOffer(sim);
  // 1 vol large à l’heure + 3 larges en retard = 25 % < les 75 % exigés.
  onTime(sim, QUALITY); late(sim, QUALITY); late(sim, QUALITY); late(sim, QUALITY);
  sim.time += QUALITY.period;
  tickContracts(sim, 60);
  const rec = sim.contracts.history.find((h) => h.model === QUALITY.id && h.result === 'failed');
  assert.ok(rec, 'manqué sur la ponctualité (mesure des fins de vol, pas un compteur de temps)');
  assert.equal(sim.economy.money, 12000 - QUALITY.penalty, 'pénalité qualité débitée');
  // Et le taux est AFFICHÉ (le panneau lit contractView).
  const v = contractView(sim);
  assert.equal(v.history[0].model, QUALITY.id, 'le plus récent est en tête de l’historique');
  assert.ok(v.history[0].rate <= QUALITY.punctuality, 'le taux mesuré est sous l’exigence');
});

test('R24 : un vol d’une AUTRE taille ne compte PAS pour le contrat (la taille est lue)', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim); // modèle light (appareil small)
  flight(sim, 'medium', 0, 100); // 1 vol medium en période light : NON compté
  assert.equal(sim.contracts.active.done, 0, 'un vol hors taille ne remplit pas le contrat');
  sim.time += LOW.period;
  tickContracts(sim, 60);
  assert.ok(sim.contracts.history.some((h) => h.result === 'failed'),
    'sans vol de la bonne taille, la période échoue (la mesure est le critère)');
});

test('R24 : D5 — la pénalité obligatoire est enregistrée MÊME EN DÉFICIT', () => {
  const sim = newSimState();
  sim.economy.money = -1000; // aéroport déjà en déficit
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim);
  sim.time += LOW.period; // période sans aucun vol → manquée
  tickContracts(sim, 60);
  assert.ok(sim.contracts.history.some((h) => h.result === 'failed'), 'contrat manqué');
  assert.equal(sim.economy.money, -1000 - LOW.penalty,
    'la pénalité est débitée en DÉFICIT (charge sans garde-fou — D5, la faillite reste atteignable)');
  assert.equal(sim.economy.spent['contract-penalty'], LOW.penalty,
    'la pénalité passe par un COMPTE DÉDIÉ (comptabilisable, D5)');
});

test('R24 : annuler un contrat actif — pénalité due immédiatement (D6)', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim);
  const before = sim.economy.money;
  assert.ok(cancelContract(sim, activeContract(sim).id), 'annulation acceptée');
  assert.equal(sim.economy.money, before - LOW.penalty, 'la pénalité est due immédiatement');
  assert.equal(activeContract(sim), null, 'le contrat est réglé (annulé)');
  assert.ok(sim.contracts.history.some((h) => h.result === 'cancelled'), 'l’annulation est dans l’historique');
});

test('R24 : la reprise de sauvegarde règle le contrat actif UNE fois (EV-10)', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = CONTRACT_FIRST_PAX;
  tickContracts(sim, 60);
  acceptFirstOffer(sim);
  onTime(sim, LOW); // une mesure partielle (vols + pax) doit survivre à la reprise
  const state = { screen: 'game', time: 0, terrain: null, camera: null, sim };
  const sim2 = deserialize(serialize(state)).sim;
  const act = activeContract(sim2);
  assert.ok(act, 'le contrat actif est sérialisé avec la sim');
  assert.equal(act.done, 1, 'le compteur de vols survit à la reprise');
  assert.equal(act.pax, 100, 'le compteur de pax survit à la reprise');
  for (let i = 0; i < LOW.flights - 1; i++) onTime(sim2, LOW); // compléter la période
  sim2.time += LOW.period;
  tickContracts(sim2, 60);
  const rec = sim2.contracts.history.find((h) => h.id === act.id);
  assert.ok(rec, 'le contrat est réglé UNE fois après la reprise');
  assert.equal(rec.result, 'success', 'la mesure partielle reprise a servi au règlement');
  const after = sim2.economy.money;
  tickContracts(sim2, 60); tickContracts(sim2, 60);
  assert.equal(sim2.economy.money, after, 'pas de double règlement après la reprise');
});
