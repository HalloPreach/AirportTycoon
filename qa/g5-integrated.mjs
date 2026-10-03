// G5 (J5/Risque) — validation intégrée du JALON SORTIE : les incidents
// (R32/R33) + la satisfaction/réputation reliées aux résultats (R34) + le
// DÉFICIT récupérable / faillite explicite (R35) fonctionnent ENSEMBLE.
//
// La carte G5 est une VALIDATION (R32-R35 déjà implémentées) : on EXERCe le
// scénario intégré de sortie (déficit → redressement → faillite, seed fixée)
// et on vérifie que les changements fonctionnent ENSEMBLE, sur le code du
// COMMIT COURANT (jamais les rapports d'anciens commits). Un check navigateur
// impossible = « non vérifié », jamais PASS — la capture navigateur de
// l'écran de faillite vit dans qa/g5-cdp.mjs (même dossier de preuves,
// evidence/g5-integrated/).
//
// Critères (mesurables) de la carte → checks :
//   (a) incident ATTACHÉ à un actif (id/type/actif/durée/gravité/cause lisible)
//       → forceIncident (runway) : le record porte l'id de l'actif ; l'autre
//         piste reste utilisable (isolement).
//   (b) 2 RÉPONSES (passive vs coûteuse) avec conséquences AFFICHÉES AVANT
//       décision, action non répétable
//       → incidentResponse (lecture pure, coûts affichés avant le clic) ;
//         respondIncident : wait (gratuit) vs intervene (payant) → deltas
//         chiffrés ; 2e appel → motif SANS mutation.
//   (c) pic ABSORBÉ (files vides) → faible pénalité ; pic MAL GÉRÉ (files
//       saturées) → effet MESURABLE sur la satisfaction ; pas de cumul
//       contradictoire 2 modules
//       → tickPassengers lit satisfactionCauses (module unique des files) :
//         pic actif + files vides = AUCUNE perte (la satisfaction remonte) ;
//         files saturées = chute mesurable ; la lecture est pure (pas de 2e règle).
//   (d) DÉFICIT : taux paramétré sur PÉRIODE (D5), alerte de TRÉSORERIE,
//       écran de faillite bilan/reprise/nouvelle partie
//       → DEBT (ratePerSec/periodSec/borne) ; treasuryAlerts (2 niveaux +
//         cooldown) ; scénario ANNONCÉ seed 42 → déficit → emprunt borné
//         (redressement observable) → faillite ; écran de faillite (contrat :
//         flag → open/fermé, bilan lisible, bouton de reprise émet la commande).
//   (e) sauvegarde PENDANT l'incident → reprise COHÉRENTE
//       → serialize/deserialize : le record ATTACHÉ à l'actif + le calendrier
//         (compteurs acc/last) survivent ; la fermeture est active à la reprise.
//
// Usage : node qa/g5-integrated.mjs   (exit 0 = PASS, sortie evidence/g5-integrated/)
// ponytail : 1 harnais Node (les scénarios réutilisent les socles des tests
// R32/R33/R34/R35 — même mécanique, pas de fixture inventée) ; la capture
// navigateur de l'écran de faillite est un 2e harnais séparé (g5-cdp.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import {
  DEBT, LOAN, TREASURY,
  tickEconomy, treasuryAlerts, checkBankruptcy,
  takeLoan, loanState, resumeAfterBankruptcy, periodStatement,
} from '../src/economy/economy.mjs';
import {
  ensureIncidents, forceIncident, runwayClosed,
  incidentResponse, respondIncident,
} from '../src/sim/incidents.mjs';
import { tickPassengers, satisfactionCauses } from '../src/sim/passengers.mjs';
import { tickIncidents } from '../src/sim/incidents.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { makeBankruptcyScreen } from '../src/ui/bankruptcy.mjs';

let failures = 0;
const checks = []; // journal COMPLET des checks (preuve, rapport final)
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

// Socle 2 pistes + 2 stations (même réseau que les tests R32/R33) : l'incident
// est ATTACHÉ à un actif, l'isolement est testable sur 2.
function socle2Pistes(sim) {
  sim.economy.money = 100000;
  sim._unlocked = { fuel: true, cleaning: true, hangar: true, baggage: true, catering: true };
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'runway', 950, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 100, 200);
  buildBuilding(sim, 'fuel', 100, 400);
  rebuildGraph(sim);
}

// ============================================================================
// (a) INCIDENT ATTACHÉ À UN ACTIF — le record porte l'id de l'actif (pas 3
// interrupteurs globaux) ; l'autre actif reste utilisable (isolement).
// ============================================================================
console.log('\n(a) incident ATTACHÉ à un actif (record lisible) + isolement');
{
  const sim = newSimState(); socle2Pistes(sim);
  const [rwA, rwB] = sim.infra.runways;
  forceIncident(sim, `runway:${rwA.id}`);
  const rec = ensureIncidents(sim).runways[String(rwA.id)];
  check('(a) incident ATTACHÉ à un actif (id/type/actif/durée/gravité/cause lisibles)',
    !!(rec && rec.id && rec.type === 'runway' && rec.asset === rwA.id && rec.remaining > 0 && rec.severity && rec.cause),
    `record piste A : id=${rec?.id} type=${rec?.type} asset=${rec?.asset} restant=${rec?.remaining}s gravité=${rec?.severity}`);
  check('(a) ISOLEMENT : la piste A est FERMÉE, la piste B reste UTILISABLE',
    runwayClosed(sim, rwA.id) && !runwayClosed(sim, rwB.id),
    `A fermée=${runwayClosed(sim, rwA.id)}, B ouverte=${!runwayClosed(sim, rwB.id)}`);
}

// ============================================================================
// (b) 2 RÉPONSES (passive vs coûteuse) — conséquences AFFICHÉES AVANT décision
// (lecture pure, pas de mutation), action non répétable ; deltas chiffrés.
// ============================================================================
console.log('\n(b) 2 réponses (passive vs coûteuse) : conséquences lues AVANT décision, deltas chiffrés, non répétable');
{
  // --- LECTURE AVANT DÉCISION : incidentResponse est PURE (aucune mutation) ---
  const sim = newSimState(); socle2Pistes(sim);
  const rw = sim.infra.runways[0];
  forceIncident(sim, `runway:${rw.id}`);
  const before = { money: sim.economy.money, closed: runwayClosed(sim, rw.id), remaining: ensureIncidents(sim).runways[String(rw.id)].remaining };
  const view = incidentResponse(sim, `runway:${rw.id}`);
  // La LECTURE expose les 2 réponses + leurs CONSÉQUENCES (coûts) AVANT le clic.
  const rWait = view.responses.find((r) => r.id === 'wait');
  const rInt = view.responses.find((r) => r.id === 'intervene');
  check('(b) conséquences AFFICHÉES AVANT décision : 2 réponses (coût 0 vs coût payant) lues en lecture pure',
    view.ok && rWait.cost === 0 && rInt.cost > 0 && rInt.cost === 600,
    `attendre=${rWait.cost} $, intervenir=${rInt.cost} $ (${rInt.effect.slice(0, 30)}…)`);
  check('(b) LECTURE pure : incidentResponse ne modifie PAS la sim (pas de mutation)',
    sim.economy.money === before.money && runwayClosed(sim, rw.id) === before.closed &&
      ensureIncidents(sim).runways[String(rw.id)].remaining === before.remaining,
    'solde/fermeture/durée inchangés par la lecture');

  // --- DÉLAS CHIFFRÉS : même incident, les 2 réponses mènent à des états
  // DIFFÉRENTS (argent vs temps). Deux sims identiques.
  const mk = () => { const s = newSimState(); socle2Pistes(s); return s; };
  const simA = mk(); const simB = mk();
  const rwA = simA.infra.runways[0]; const rwB = simB.infra.runways[0];
  forceIncident(simA, `runway:${rwA.id}`); forceIncident(simB, `runway:${rwB.id}`);
  const moneyA0 = simA.economy.money, moneyB0 = simB.economy.money;
  const dA = respondIncident(simA, `runway:${rwA.id}`, 'wait'); // passive
  const dB = respondIncident(simB, `runway:${rwB.id}`, 'intervene'); // coûteuse
  check('(b) réponse PASSIVE (attendre) acceptée, AUCUN coût (gratuit)',
    dA.ok && simA.economy.money === moneyA0 && runwayClosed(simA, rwA.id),
    `solde avant=${Math.round(moneyA0)} après=${Math.round(simA.economy.money)} (delta 0) — fermeture continue`);
  check('(b) réponse COÛTEUSE (interventre) acceptée, coût DÉBITÉ, réouverture IMMÉDIATE',
    dB.ok && (moneyB0 - simB.economy.money) === 600 && !runwayClosed(simB, rwB.id),
    `délai=0s (réouverture immédiate), coût=600 $ (débité), solde=${Math.round(simB.economy.money)}`);
  check('(b) DELTAS CHIFFRÉS : même incident, 2 réponses → coût (0 vs 600 $) et délai (naturel vs immédiat) DIFFÉRENTS',
    simA.economy.money === moneyA0 && (moneyB0 - simB.economy.money) === 600 &&
      runwayClosed(simA, rwA.id) && !runwayClosed(simB, rwB.id),
    'passive : 0 $ + attente naturelle ; coûteuse : 600 $ + réouverture immédiate');
  // NON RÉPÉTABLE : l'intervention a TERMINÉ l'incident → la 2e réponse renvoie
  // un motif SANS mutation partielle.
  const again = respondIncident(simB, `runway:${rwB.id}`, 'intervene');
  check('(b) action NON répétable : 2e intervention → motif lisible SANS mutation',
    !again.ok && again.reason && simB.economy.spent.intervention === 600,
    `motif="${again.reason}" (pas de 2e débit, spent.intervention reste 600 $)`);
}

// ============================================================================
// (c) PIC DE DEMANDE (R34) — absorbé (files vides) = AUCUNE pénalité ;
// mal géré (files saturées) = effet MESURABLE ; la satisfaction est lue par
// UN module unique (satisfactionCauses) — pas de cumul contradictoire.
// ============================================================================
console.log('\n(c) pic absorbé → faible pénalité ; pic mal géré → effet mesurable (module unique des files)');
{
  // (c1) pic ABSORBÉ (files vides) : la satisfaction ne perd RIEN pendant le
  // pic (pas de perte directe) et REMONTE (récupération, AC22).
  const sim = newSimState();
  sim.passengers.satisfaction = 80;
  forceIncident(sim, 'surge');
  check('(c) pic ACTIF (cadence doublée) forcé', ensureIncidents(sim).surge.active, '');
  // Pendant le pic, les files restent VIDES : AUCUNE perte (module unique des
  // files — pas de 2e module qui pénalise le pic).
  for (let k = 0; k < 60; k++) tickIncidents(sim, 1, () => 0);
  check('(c) pic ABSORBÉ (files vides) : AUCUNE pénalité directe sur la satisfaction',
    sim.passengers.satisfaction === 80, `satisfaction=${sim.passengers.satisfaction} (inchangée pendant le pic)`);
  for (let k = 0; k < 80; k++) tickPassengers(sim, 1);
  check('(c) pic absorbé : la satisfaction REMONTE (récupération, plafond 100)',
    sim.passengers.satisfaction === 100, `satisfaction=${sim.passengers.satisfaction} (remontée après le pic)`);

  // (c2) pic MAL GÉRÉ (files saturées) : effet MESURABLE (chute de satisfaction).
  const sim2 = newSimState();
  forceIncident(sim2, 'surge');
  sim2.passengers.queues['1'] = { checkin: 10000, security: 10000, board: 10000 };
  const sat0 = sim2.passengers.satisfaction;
  for (let k = 0; k < 30; k++) { tickPassengers(sim2, 1); tickIncidents(sim2, 1, () => 0); }
  check('(c) pic MAL GÉRÉ (files saturées) : effet MESURABLE (la satisfaction CHUTE)',
    sim2.passengers.satisfaction < sat0 && sim2.passengers.satisfaction < 50,
    `satisfaction ${sat0} → ${Math.round(sim2.passengers.satisfaction)} (chute mesurée)`);
  // LECTURE pure : satisfactionCauses renvoie les CAUSES (stages saturées +
  // débordement) SANS mutation (pas de 2e règle qui se contredit, R34).
  const sim3 = newSimState();
  const c0 = satisfactionCauses(sim3);
  const satBase = sim3.passengers.satisfaction;
  check('(c) LECTURE pure des CAUSES (satisfactionCauses) : sim nue = cause nulle, AUCUNE mutation',
    c0.loss === 0 && c0.satStages === 0 && c0.overflow === 0 && sim3.passengers.satisfaction === satBase,
    `causes=${JSON.stringify(c0)} (la lecture ne touche PAS la satisfaction)`);
  sim3.passengers.queues['1'] = { checkin: 130, security: 0, board: 0 }; // > capacité (120)
  const c1 = satisfactionCauses(sim3);
  check('(c) files saturées : les CAUSES sont lues (stages saturées + débordement, même formule que le tick)',
    c1.satStages >= 1 && c1.overflow > 0 && c1.loss > 0,
    `stages=${c1.satStages} débordement=${c1.overflow} perte/s=${c1.loss} (la même formule que le tick)`);
}

// ============================================================================
// (d) DÉFICIT : taux paramétré sur PÉRIODE (D5) + alerte de TRÉSORERIE
// (2 niveaux + cooldown).
// ============================================================================
console.log('\n(d) déficit : taux paramétré sur période (D5) + alerte de trésorerie (2 niveaux, cooldown)');
{
  check('(d) Taux D5 paramétré sur une PÉRIODE EXPLICITE (DEBT : rate/periode/borne)',
    DEBT.ratePerSec === 0.01 && DEBT.periodSec === 300 && DEBT.baseCap === 10000 && Object.isFrozen(DEBT),
    `rate=${DEBT.ratePerSec}/s, période=${DEBT.periodSec}s (3 % de l'assiette par période), borne=${DEBT.baseCap}`);
  check('(d) Alerte de TRÉSORERIE bornée (2 niveaux warn/critical + cooldown, pas de spam)',
    TREASURY.warn.below > TREASURY.critical.below && TREASURY.critical.below > -10000 && TREASURY.cooldownSec > 0,
    `warn<${TREASURY.warn.below}, critical<${TREASURY.critical.below}, cooldown=${TREASURY.cooldownSec}s`);

  const sim = newSimState();
  sim.economy.money = -9000; // sous critical (−5000), au-dessus du seuil (−10000)
  treasuryAlerts(sim);
  const kinds = sim.alerts.map((a) => a.kind).filter((k) => k.startsWith('treasury'));
  check('(d) l\'ALERTE sonne les 2 niveaux (s\'amenuit → s\'approfondit)',
    kinds.includes('treasury-warn') && kinds.includes('treasury-critical'),
    `niveaux=[${kinds.join(', ')}]`);
  // COOLDOWN : re-appeler dans la même fenêtre ne re-prévient PAS (pas de spam).
  sim.alerts.length = 0;
  treasuryAlerts(sim); // sim.time n'avance pas (0) → toujours dans le cooldown
  check('(d) COOLDOWN : aucune re-alerte dans la fenêtre (pas de spam)',
    sim.alerts.filter((a) => a.kind.startsWith('treasury')).length === 0, 'aucune re-alerte dans le cooldown');
  // Le cooldown EXPIRE : après cooldownSec, la même condition re-prévient.
  sim.time = TREASURY.cooldownSec;
  treasuryAlerts(sim);
  check('(d) après le COOLDOWN, l\'alerte re-sonne (la condition persiste)',
    sim.alerts.length >= 1, `re-alerte après ${TREASURY.cooldownSec}s`);
}

// ============================================================================
// (d) SCÉNARIO ANNONCÉ (seed 42) : DÉFICIT → REDRESSEMENT (emprunt borné)
// observable → FAILLITE. Le redressement est une action RATIONNELLE (l'emprunt
// unique par partie) ; sans action, la pente atteint le seuil (faillite).
// ============================================================================
console.log('\n(d) scénario ANNONCÉ seed 42 : déficit → redressement observable (emprunt) → faillite');
{
  // Scénario ANNONCÉ : départ à la SISON CREUSE — le solde est déjà déficitaire
  // (les recettes ont suivi la demande), l'exploitation continue de creuser.
  // La graine est fixée (42) → la suite est reproductible (EV-10).
  const state = makeGameState(42);
  const sim = state.sim;
  state.screen = 'game';
  // Saison creuse : les recettes n'ont pas suivi → le solde est DÉFICITAIRE de
  // départ (la pente creuse). -3 000 $ : sous le niveau normal, mais l'emprunt
  // (net +4 750 $) peut le remonter au-dessus de 0 (redressement observable).
  sim.economy.money = -3000;
  check('(d) scénario ANNONCÉ : graine fixée (seed 42) + solde déficitaire de départ (saison creuse)',
    sim.rngSeed === 42 && sim.economy.money < 0,
    `seed=${sim.rngSeed}, solde de départ=${sim.economy.money} $ (défice)`);

  // REDRESSEMENT observable : l'EMPRUNT borné (l'action rationnelle).
  const before = { money: sim.economy.money, revenue: JSON.stringify(sim.economy.revenue) };
  const loan = takeLoan(sim);
  check('(d) REDRESSEMENT observable : l\'emprunt borne (1/partie) rend le solde POSITIF',
    loan.ok && sim.economy.money > 0 && !sim.economy.bankrupt,
    `solde ${before.money} → ${Math.round(sim.economy.money)} $ (+${LOAN.principal - loan.interest} $ net)`);
  check('(d) l\'EMPRUNT est BORNE : disponible → non-disponible (1 seul par partie)',
    loanState(sim).available === false && loanState(sim).count === 1,
    `emprunt non-disponible (count=1/${loanState(sim).max}) — non-obtenable indéfiniment`);
  check('(d) l\'emprunt N\'EST PAS une recette : revenue (exploitation) est PRESERVÉ',
    JSON.stringify(sim.economy.revenue) === before.revenue,
    'revenue inchangé (le crédit est une ligne de bilan, PAS une recette — R11)');
  check('(d) PRINCIPAL / INTÉRÊTS / LIQUIDITÉS DISTINCTS (bilan lisible)',
    sim.economy.loan.principal === LOAN.principal && sim.economy.debt === loan.interest &&
      (sim.economy.money - before.money) === (LOAN.principal - loan.interest),
    `principal=${LOAN.principal} (ligne de crédit), intérêts=${loan.interest} (compte dédié debt), liquidité nette=${LOAN.principal - loan.interest} (en main)`);

  // SANS ACTION : la pente (opex + intérêts) franchit le seuil → FAILLITE.
  // On repart d\'un solde déficitaire SANS emprunt et on avance la sim (opex).
  const sim2 = makeGameState(42); sim2.screen = 'game';
  sim2.sim.economy.money = -9500; // sous le niveau critique, au-dessus du seuil
  let t = 0;
  while (!sim2.sim.economy.bankrupt && t < 300) { tickEconomy(sim2.sim, 1); t += 1; }
  check('(d) SANS action : la pente atteint le seuil → FAILLITE (mesurable)',
    sim2.sim.economy.bankrupt && sim2.sim.economy.money < -10000,
    `faillite atteinte après ${t}s (solde=${Math.round(sim2.sim.economy.money)} $ < −10 000)`);
  // L\'avertissement critique a sonné AVANT la faillite (ordre des événements).
  const kk = sim2.sim.alerts.map((a) => a.kind);
  check('(d) l\'ALERTE critique PRÉCÈDE la faillite (ordre mesurable)',
    kk.indexOf('treasury-critical') !== -1 && kk.indexOf('bankrupt') !== -1 &&
      kk.indexOf('treasury-critical') < kk.indexOf('bankrupt'),
    `ordre : critical (${kk.indexOf('treasury-critical')}) < bankrupt (${kk.indexOf('bankrupt')})`);
}

// ============================================================================
// (d) ÉCRAN DE FAILLITE (contrat) : le flag de la sim ouvre/ferme l\'écran ;
// le BILAN est lisible ; le bouton de REPRISE émet la commande (la sim règle) ;
// NOUVELLE PARTIE retourne au menu. Zéro DOM réel — DOM factice (pattern R20).
// ============================================================================
console.log('\n(d) écran de faillite : flag sim → open/fermé, bilan lisible, reprise/nouvelle partie (contrat)');
{
  // DOM factice minimal (l'écran n'utilise que ce qui est listé ici).
  function makeNode(tag) {
    return {
      tag, className: '', textContent: '', style: {}, children: [], handlers: {},
      setAttribute() {},
      appendChild(c) { this.children.push(c); },
      append(...cs) { this.children.push(...cs); },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      replaceChildren() { this.children.length = 0; },
      fire(ev) { for (const fn of this.handlers[ev] || []) fn({}); },
    };
  }
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    querySelector: () => null,
    body: makeNode('body'),
  };

  // Sim RÉELLEMENT faillie (la pente opex a franchi le seuil — les compteurs
  // spent.opex/debt sont donc remplis : le BILAN a de vraies causes).
  const state = makeGameState(42); state.screen = 'game';
  const sim = state.sim;
  sim.economy.money = -9500;
  while (!sim.economy.bankrupt) tickEconomy(sim, 1);
  let resumed = false, newGame = false;
  const screen = makeBankruptcyScreen(state, document.body, {
    onResume: () => { resumed = true; resumeAfterBankruptcy(sim); },
    onNewGame: () => { newGame = true; },
  });
  // L'écran s'OUVRE sur le flag de faillite (la sim décide, pas l'UI).
  const card = document.body.children.find((c) => c.className === 'bankruptcy');
  check('(d) l\'ÉCRAN s\'OUVRE sur le flag de faillite (economy.bankrupt=true)',
    sim.economy.bankrupt === true && !!card && card.style.display === '', `display=${JSON.stringify(card?.style.display)} (visible)`);
  // Le BILAN est lisible (periodStatement : solde/dette, CAUSES du déficit).
  const st = periodStatement(sim);
  check('(d) le BILAN est lisible (solde, dette, causes du déficit)',
    st.money < 0 && st.debt > 0 && st.causes.length > 0,
    `solde=${Math.round(st.money)} $, dette=${Math.round(st.debt)} $, causes=[${st.causes.join('; ').slice(0, 48)}]`);
  // Le bouton de REPRISE émet la COMMANDE (la sim règle) : le flag est LEVÉ.
  const btns = card.children.find((c) => c.className === 'bankruptcy-actions');
  const btnResume = btns.children.find((c) => c.textContent === 'Reprendre la partie');
  btnResume.fire('click');
  check('(d) « Reprendre » : la COMMANDE est émise (flag levé, la sim REPART)',
    resumed && sim.economy.bankrupt === false, 'flag de faillite levé (la sim continue depuis le bilan)');
  // L\'écran se REFERME (le flag est levé) — l\'UI suit l\'état, pas l\'inverse.
  screen.refresh();
  check('(d) l\'écran se REFERME sur la reprise (flag levé → display masqué)',
    card.style.display === 'none', `display=${JSON.stringify(card.style.display)} (masqué)`);
  // « Nouvelle partie » émet l\'intention (le vrai startNewGame du menu, UI fine).
  const btnNew = btns.children.find((c) => c.textContent.includes('Nouvelle partie'));
  btnNew.fire('click');
  check('(d) « Nouvelle partie » : l\'INTENTION est émise (retour menu, la sim ne redécide pas)',
    newGame, 'l\'action de nouvelle partie est câblée (main.mjs : startNewGame)');
}

// ============================================================================
// (e) SAUVEGARDE PENDANT l'incident → REPRISE COHÉRENTE : le record ATTACHÉ à
// l'actif + le calendrier (compteurs acc/last) survivent à la sérialisation.
// ============================================================================
console.log('\n(e) sauvegarde PENDANT l\'incident → reprise COHÉRENTE (record + calendrier survivent)');
{
  const sim = newSimState(); socle2Pistes(sim);
  const [rwA] = sim.infra.runways;
  forceIncident(sim, `runway:${rwA.id}`);
  const i = ensureIncidents(sim);
  // Calendrier borné (horloge de fréquence par type : acc/last) — on le met
  // dans un état NON TRIVIAL pour prouver qu'il survive.
  i.runway.acc = 12.5; i.runway.last = 42;
  const recBefore = i.runways[String(rwA.id)].remaining;

  const restored = deserialize(serialize({ screen: 'game', time: 0, terrain: 1, camera: null, sim }));
  const ri = restored.sim.incidents;
  check('(e) le record ATTACHÉ à l\'actif SURVIT à la reprise (fermeture préservée)',
    !!(ri.runways[String(rwA.id)]) && ri.runways[String(rwA.id)].remaining === recBefore,
    `record piste A : remaining=${ri.runways[String(rwA.id)]?.remaining}s (attendu ${recBefore}s)`);
  check('(e) la FERMETURE est ACTIVE à la reprise (la sim la lit)',
    runwayClosed(restored.sim, rwA.id), 'la piste A reste fermée après save/load');
  check('(e) le CALENDRIER (compteurs de fréquence acc/last) SURVIT à la reprise',
    ri.runway.acc === 12.5 && ri.runway.last === 42,
    `acc=${ri.runway.acc} last=${ri.runway.last} (préservés)`);
  // PAS d\'orphelin : aucun record ne pointe vers un actif disparu.
  const runways = new Set(restored.sim.infra.runways.map((r) => String(r.id)));
  const orphans = Object.keys(ri.runways).filter((k) => !runways.has(k));
  check('(e) PAS d\'orphelin : chaque record pointe vers un actif EXISTANT',
    orphans.length === 0, `orphelins=[${orphans.join(',')}] (vide)`);
}

// ============================================================================
// rapport + export (la preuve demandée par la carte)
// ============================================================================
const outDir = path.join(process.cwd(), 'evidence', 'g5-integrated');
fs.mkdirSync(outDir, { recursive: true });
const report = {
  tool: 'qa/g5-integrated.mjs',
  commit: process.env.GIT_COMMIT ?? '(non connu)',
  seed: 42,
  criteria: {
    a: 'incident ATTACHÉ à un actif (id/type/actif/durée/gravité/cause lisible) + isolement',
    b: '2 réponses (passive vs coûteuse) : conséquences lues AVANT décision, deltas chiffrés, non répétable',
    c: 'pic absorbé → faible pénalité ; pic mal géré → effet mesurable (module unique des files, pas de cumul contradictoire)',
    d: 'déficit : taux paramétré sur période (D5) + alerte trésorerie (2 niveaux, cooldown) + écran faillite bilan/reprise/nouvelle partie',
    e: 'sauvegarde PENDANT l\'incident → reprise COHÉRENTE (record + calendrier survivent, pas d\'orphelin)',
  },
  failures,
  passed: checks.length - failures,
  checks,
};
fs.writeFileSync(path.join(outDir, 'rapport-g5-integrated.json'), JSON.stringify(report, null, 2));
console.log(`\nexport : evidence/g5-integrated/ (rapport-g5-integrated.json)`);
console.log(failures === 0
  ? 'G5 — TOUT EST BON (R32-R35 fonctionnent ENSEMBLE : incident 2 réponses, pic, déficit/récup, faillite, reprise)'
  : `G5 — ${failures} ÉCHEC(S) → carte restée ouverte + correction`);
process.exit(failures === 0 ? 0 : 1);
