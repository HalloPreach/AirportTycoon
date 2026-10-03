// Passagers (agrégés) : les passagers voyagent en GROUPES liés à un vol et à
// un terminal (AC22) — pas de passagers individuels, et surtout PAS un simple
// total transporté (AC40) : un passager suit un PARCOURS à travers SON
// terminal :
//   débarquement → check-in (+bagages) → sécurité → attente → embarquement.
// R30 (t_1623523e) : les files, les CAPACITÉS et les FLUX sont PAR TERMINAL —
// sim.passengers.queues[terminalId] = {checkin, security, board}. Un terminal
// ne traite JAMAIS les passagers d'un autre : A saturé/B vide → les pax de B
// suivent leur parcours normalement (AUCUN débordement global, plus de
// capacité « nTerminal × »). Le comptage unique reste intact (countCarried,
// UNE fois à l'embarquement, AC40). Le retrait des passagers d'un vol ANNULE
// est EXPLICITE (removePassengers, appelé par le module avions) : les pax en
// cours du vol annulé sortent du terminal sans être comptés, sans clogger les
// files ni bloquer les groupes suivants.
// Chaque étape a une CAPACITÉ (places en parallèle) et un DÉBIT (pax/s) : les
// files sont l'état VISIBLE de ce parcours (occupation lisible, 0..1), et la
// SATURATION a un effet mesurable : la file grandit, la satisfaction baisse,
// l'embarquement se retarde (boardDelay), le dénouement (capacité libérée,
// plus d'arrivées) vide les files et la satisfaction REMONTE — un retard
// ancien ne condamne pas indéfiniment (AC22).
// Bagages (AC22) : service dédié — les salles bagages AFFECTÉES au terminal
// (R27 : s.target = terminalId) BOOSTENT le débit check-in DE CE TERMINAL :
// sans elles le check-in du terminal tourne au débit de base PAX.checkinRate
// (12 pax/s), avec N salles + N*baggageBoostPer. Un service affecté à A ne
// renforce JAMAIS B (critère R27/R30).
// Comptage D2 par terminal : `p.injectedTotal[t]` (pax cumulés injectés au
// check-in DE t) donne à chaque groupe son offset d'injection `base` ; le
// compteur MONOTONE `p.securityDone[t]` compte les pax qui ont franchi la
// sécurité DE t. Le groupe EST complet ⇔ securityDone[t] >= base + pax (tous
// les pax qui l'ont rejoint ont traversé). Per-terminal : un vol annulé dans
// t A ne retarde JAMAIS les pax de t B.
// Logique pure (testable Node) : mute sim.passengers (sérialisable seul).
// L'état de la sim (sim-state.mjs) reste la source ; l'UI ne lit que cet objet.
import { pushEvent } from '../core/sim-state.mjs';
import { countTypeServing } from '../infra/assignments.mjs';
import { capMult } from '../infra/upgrades.mjs'; // R31 : capacité check-in/sécurité par terminal (amélioration)

// Équilibrage (ponytail : constantes fixes, calées sur les tests saturation —
// pas de table par type d'avion ; le débit des files ne dépend pas du vol).
// Capacités ~ un gros vol au repos (A320 ≈ 144 pax) : file vide au repos,
// file SATUREE en saturation (plusieurs vols superposés AU MÊME terminal).
const PAX = Object.freeze({
  checkinCapPerTerminal: 120, // check-in d'UN terminal : confortable pour un A320 seul
  securityCapPerTerminal: 120, // sécurité d'UN terminal : idem
  waitCapPerGate: 80,         // salle d'attente : 80 par porte DU terminal
  checkinRate: 12,          // pax/s : guéridon check-in (débit de BASE, sans service bagages)
  baggageBoostPer: 8,       // pax/s ADDITIONNEL par salle bagages AFFECTÉE au terminal (AC22/R27)
  securityRate: 16,         // pax/s : filière sécurité
  boardRate: 10,           // pax/s : porte d'embarquement
  satLossPerWait10: 0.02,   // %/s : par 10 pax en file AU-DESSUS de la capacité (PAR TERMINAL)
  satLossPerSat: 0.15,      // %/s : par étape SATURÉE (file pleine, PAR TERMINAL)
  recoverRate: 0.5,        // %/s : la satisfaction REMONTE quand les files sont vides
  comfortCatering: 0.2,    // services de confort (soutien de la satisfaction)
  comfortMaintenance: 0.1, // — mêmes taux que l'ancienne logique économie
});

// Démarre l'état passagers (les sauvegardes M1 n'ont pas ces champs — tolérées).
// R30 : `queues` (par terminal) remplace l'ancienne file GLOBALE `queue` ; un
// terminal ABSENT de `queues` = pas encore de pax injectés (file vide). Les
// compteurs de flux (injectedTotal / securityDone) sont PAR TERMINAL.
export function ensurePassengers(sim) {
  let p = sim.passengers;
  if (!p) p = sim.passengers = {};
  p.totalCarried = p.totalCarried || 0;
  if (p.satisfaction === undefined) p.satisfaction = 100;
  p.queues = p.queues || {};
  p.groups = p.groups || [];
  p.injectedTotal = p.injectedTotal || {};
  p.securityDone = p.securityDone || {};
  return p;
}

// Le vol commence le déchargement (appelé par le module avions à l'entrée de la
// phase « disembark ») : le GROSSE du vol entre dans le check-in DE SON
// terminal. D2 (R30, per-terminal) : on enregistre `base` = position
// d'injection de ses pax dans le flux de SON terminal (pax injectés AVANT
// celui-ci, dans le MÊME terminal) : c'est ce qui permet de savoir, plus
// tard, quand TOUTES ses pax ont fini le parcours (groupComplete).
export function arrivePassengers(sim, ac) {
  const p = ensurePassengers(sim);
  if (!ac.pax || ac.pax <= 0) return;
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  const tid = g ? g.terminalId : null;
  if (!tid) {
    // Terminal inconnu (avion injecté à la main, porte démolie en vol) : le
    // groupe est créé mais SANS injection de pax — il complète d'office
    // (groupComplete, groupe sans pax). Aucun pax n'est créé ni perdu.
    p.groups.push({ volId: ac.id, pax: ac.pax, terminalId: null, base: 0 });
    return;
  }
  const q = p.queues[tid] || (p.queues[tid] = { checkin: 0, security: 0, board: 0 });
  const base = p.injectedTotal[tid] || 0;
  p.injectedTotal[tid] = base + ac.pax;
  p.groups.push({
    volId: ac.id, pax: ac.pax, terminalId: tid,
    base, // D2 (R30) : offset d'injection DANS LE TERMINAL (pax injectés avant ce vol, ici)
  });
  q.checkin += ac.pax; // le débarquement déverse le groupe dans le check-in DU TERMINAL
}

// Le vol embarque ses passagers : le groupe est TRANSPORTÉ — compté UNE fois,
// retiré du parcours. D2 : appelé UNIQUEMENT quand le groupe du vol est COMPLET
// (tous ses pax ont franchi check-in + sécurité DE SON TERMINAL → en attente,
// voir groupComplete) : on ne compte JAMAIS « embarqué » avant la fin du
// parcours passager.
export function countCarried(sim, ac) {
  const p = ensurePassengers(sim);
  p.totalCarried += ac.pax; // UNE SEULE fois, à l'embarquement (critère 7, AC40)
  p.groups = p.groups.filter((gr) => gr.volId !== ac.id);
}

// R30 : RETRAIT EXPLICITE des passagers d'un vol ANNULE (défini par la spec —
// plus de purge silencieuse) : le groupe du vol est retiré et SES pax EN COURS
// sortent des files DE SON TERMINAL (jamais comptés : pas de fausse
// comptabilité), sans clogger les files ni bloquer les groupes suivants.
// Appelé par le module avions à la FIN de l'embarquement non abouti (annulation
// — l'étape « cancelled », flights.mjs / aircraft.mjs). Les pax déjà en attente
// (board) sont conservés : le terminal les dévide (le vol annulé les a
// déposé — ils attendent, repartent au débit d'attente — AC22, règle
// EXISTANTE pour un avion qui ne vient plus).
// Invariants respectés : aucun pax créé ni perdu silencieusement (le retrait
// est EXPLICITE et testé), aucun double comptage (le pax annulé est retiré du
// groupe AVANT tout countCarried), les groupes SUIVANTS ne sont pas bloqués
// (leurs bases ne comptent plus les pax du vol annulé — voir la
// reconversion des bases ci-dessous).
export function removePassengers(sim, ac) {
  const p = ensurePassengers(sim);
  const g = p.groups.find((gr) => gr.volId === ac.id);
  if (!g) return; // groupe déjà retiré (compté, annulé plus tôt) : idempotent
  p.groups = p.groups.filter((gr) => gr.volId !== ac.id);
  if (!g.terminalId || !g.pax) return;
  const t = g.terminalId;
  const q = p.queues[t];
  if (!q) return; // aucun pax injectés (groupe sans terminal / pax) : rien à retirer
  // Combien de pax du groupe ont déjà FRANCHI la sécurité (sont en attente,
  // board) : c'est `securityDone` (compteur monotone DU TERMINAL) moins le
  // nombre de pax injectés AVANT lui (base) qui ont franchi la sécurité. Le
  // groupe occupe le segment [base, base+pax) du flux ; les pax « passés » =
  // min(securityDone, base + pax) - base, borné à [0, pax].
  const secDone = p.securityDone[t] || 0;
  const passed = Math.max(0, Math.min(g.pax, Math.max(0, secDone - (g.base || 0))));
  // Les pax EN COURS (check-in + sécurité, PAS encore en attente) = pax -
  // passed : ils sortent du parcours (retrait explicite). Les pax en attente
  // (board) restent — le terminal les dévide.
  const inFlow = g.pax - passed;
  if (inFlow > 0) {
    // On retire `inFlow` pax des files check-in + sécurité DU TERMINAL. Les
    // files sont des POOLS (agrégées, indistinguables) : on retire du check-in
    // d'abord (le plus en amont), puis de la sécurité. Total retiré = inFlow
    // (jamais plus que le contenu, jamais un pax négatif).
    const fromCheckin = Math.min(q.checkin, inFlow);
    q.checkin -= fromCheckin;
    q.security = Math.max(0, q.security - (inFlow - fromCheckin));
  }
  // RECONVERSION des bases : les groupes SUIVANTS (injectés APRÈS celui-ci,
  // base >= g.base) avaient un offset qui comptait les pax du vol annulé. On
  // décale leurs bases de `inFlow` (les pax retirés du flux) — sinon leur
  // groupComplete (securityDone >= base + pax) ne se réaliserait PLUS
  // (securityDone ne compte plus les pax retirés) → les groupes suivants
  // seraient BLOQUÉS (critère R30 : annulation ne bloque pas les groupes
  // suivants). Les pax en attente (passed) restent dans le flux (securityDone
  // les compte, les files board les tiennent) → les bases des groupes
  // suivants ne comptent QUE les pax RETIRÉS.
  if (inFlow > 0) {
    for (const gr of p.groups) {
      if (gr.terminalId === t && gr.volId !== ac.id && (gr.base || 0) >= g.base) {
        gr.base = Math.max(0, (gr.base || 0) - inFlow);
      }
    }
  }
}

// Le groupe du vol est-il COMPLET : toutes ses pax ont-elles atteint l'attente
// DE SON TERMINAL ? (comptage D2, R30 per-terminal — on ne compte « embarqué »
// qu'une fois le parcours terminé.) Principe : le compteur MONOTONE
// `p.securityDone[t]` compte les pax qui ont franchi la sécurité DU TERMINAL t
// (cumul des débits security→board, incrémenté par tickPassengers). Chaque
// groupe enregistre `base` = le nombre de pax qui l'ont PRÉCÉDÉ dans le
// check-in DE SON TERMINAL (ordre d'injection, per-terminal). Le groupe EST
// complet ⇔ `securityDone[t] >= base + pax` : tous les pax qui l'ont rejoint
// (les siens, injectés après lui, et les siens, dans le MÊME terminal) ont
// donc traversé la sécurité. Monotone et sans état par groupe → pas de
// deadlock, pas de double crédit, tolère les pax orphelins (vol annulé) qui
// ont traversé la sécurité sans groupe.
// Garde : si le groupe n'existe plus (avion injecté à la main, groupe déjà
// purgé/compté/retrait) on ne bloque PAS — on considère le parcours terminé.
export function groupComplete(sim, ac) {
  const p = ensurePassengers(sim);
  const g = p.groups.find((gr) => gr.volId === ac.id);
  if (!g) return true; // aucun groupe pour ce vol : non bloquant
  if (!g.pax) return true; // groupe sans pax (vol annulé / terminal inconnu)
  if (!g.terminalId) return true; // pas de terminal : non bloquant
  const base = g.base || 0;
  const secDone = p.securityDone[g.terminalId] || 0;
  // Les pax du groupe occupent le segment [base, base+pax) du flux d'injection
  // DE SON TERMINAL. Tous les pax injectés AVANT lui (base) l'ont suivi dans
  // la sécurité ; il est complet quand le flux a dépassé la fin de son
  // segment : base + pax.
  // ponytail: epsilon 1e-9 — securityDone est une SOMME de valeurs
  // flottantes (pass = min(q, cap, rate*dt), des fractions), jamais exactement
  // un entier : 15 pax s'arrête à 14.999999999999996 et bloquerait
  // l'embarquement pour un epsilon. 1e-9 négligeable face à des pax entiers ;
  // upgrade si les pax deviennent fractionnaires (files par vol).
  return secDone >= base + g.pax - 1e-9;
}

// Délai d'embarquement (AC22 : l'attente INFLUE SUR LE VOL) : si la file
// d'embarquement DU TERMINAL du vol dépasse SA capacité, le groupe attend sa
// part de l'excédent. Le débit est partagé entre TOUS les vols en train
// d'embarquer À CE TERMINAL (portes du même terminal) → retard plus fort
// quand plusieurs vols sont au sol AU MÊME terminal (R30 : plus de débordement
// global — les files d'un autre terminal n'influent PAS).
// Retourne des secondes (0 au repos). L'avion applique ce délai à son étape.
export function boardDelay(sim, ac) {
  const p = ensurePassengers(sim);
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  const tid = g ? g.terminalId : null;
  if (!tid) return 0; // pas de terminal : pas de file, pas de délai
  const q = p.queues[tid];
  if (!q) return 0; // terminal sans pax : file vide
  const cap = waitCapFor(sim, tid);
  const over = Math.max(0, q.board - cap);
  if (!over) return 0;
  const share = over * (ac.pax / Math.max(1, q.board)); // sa part de l'excédent
  const drainers = Math.max(1, sim.aircraft.filter((a) => {
    if (a.phase !== 'board') return false;
    const gg = sim.infra.gates.find((x) => x.id === a.gateId);
    return gg && gg.terminalId === tid; // R30 : SEULEMENT les vols au même terminal
  }).length);
  return share / (PAX.boardRate * drainers);
}

// Capacités d'une étape D'UN TERMINAL (R30 : per-terminal — dépendent de
// l'INFRA construite : le terminal et SES portes). Un terminal ne traite JAMAIS
// les pax d'un autre : la capacité est CELLE DU TERMINAL, jamais « × nombre de
// terminaux ».
// R31 : les CAPACITÉS de base (PAX.*PerTerminal) sont MULTIPLIÉES par le
// facteur d'amélioration « terminal » (capMult, upgrades.mjs) — le niveau 0
// renvoie 1 (l'état existant, les tests saturation inchangés).
function checkinCap(sim, tid) { return Math.round(PAX.checkinCapPerTerminal * capMult(sim, tid)); }
function securityCap(sim, tid) { return Math.round(PAX.securityCapPerTerminal * capMult(sim, tid)); }
export function waitCapFor(sim, tid) {
  // R30 : les clés de `queues`/`securityDone` sont des CHAÎNES (clé d'objet),
  // mais `g.terminalId` est un NOMBRE — on compare en String() pour que la
  // capacité marche quel que soit le type du tid passé (tick Object.keys =
  // chaîne, UI = nombre).
  const gates = sim.infra.gates.filter((g) => String(g.terminalId) === String(tid));
  return Math.max(1, gates.length * PAX.waitCapPerGate);
}
// (Compat : le cap GLOBAL d'attente — somme sur TOUS les terminaux. Gardé pour
// l'UI globale (passengerSummary) ; les règles (boardDelay) sont per-terminal.)
function waitCap(sim) {
  const tids = new Set(sim.infra.terminals.map((t) => t.id));
  let gates = 0;
  for (const g of sim.infra.gates) if (tids.has(g.terminalId)) gates++;
  return Math.max(1, gates * PAX.waitCapPerGate);
}

// Occupation visible d'une étape D'UN TERMINAL (0..1, lisible par l'UI/HUD) :
// file / capacité. R30 : `tid` = terminal (la file ET la capacité sont celles
// DU TERMINAL — un terminal saturé n'affecte jamais l'occupation d'un autre).
export function queueOccupancy(sim, tid, stage) {
  const p = ensurePassengers(sim);
  const q = p.queues[tid] || { checkin: 0, security: 0, board: 0 };
  const cap = stage === 'checkin' ? checkinCap(sim, tid)
    : stage === 'security' ? securityCap(sim, tid)
    : waitCapFor(sim, tid);
  return Math.min(1, q[stage] / cap);
}

// Le battement passagers (appelé par tick.mjs) — R30 : PAR TERMINAL.
//   1) les groupes du vol débarqué entrent dans la file check-in DE LEUR TERMINAL
//   2) les files DE CHAQUE TERMINAL avancent au débit de leur étape (débit
//      BAGAGES affecté au terminal, R27 — pas de service global)
//   3) satisfaction : pénalité sur les files SATURÉES (PAR TERMINAL),
//      RÉCUPÉRATION quand les files sont vides (+ services confort).
// Les groupes (gr.volId) servent au COMPTAGE unique + au retrait EXPLICITE des
// vols annulés (removePassengers) ; l'avancement physique des pax est porté
// par les FILES (q.* par terminal).
export function tickPassengers(sim, dt) {
  const p = ensurePassengers(sim);

  // Groupes orphelins (vol parti/annulé, plus dans sim.aircraft) : le GROUPE
  // est épurgé ; ses pax (encore en files) CONTINUENT leur parcours et se
  // vident (pas de perte : ils finissent le check-in/sécurité/attente, AC22).
  // (Le retrait EXPLICITE d'un vol ANNULE est removePassengers, appelé par le
  // module avions — ici on ne fait que la purge du groupe dont le vol est
  // disparu sans passer par l'annulation explicite.)
  p.groups = p.groups.filter((gr) => sim.aircraft.some((a) => a.id === gr.volId));

  // (1) Entrées : le débarquement d'un vol déverse ses pax dans le check-in DE
  // SON TERMINAL — déjà fait par arrivePassengers (injection au débarquement).
  // (R30 : arrivePassengers fait l'injection ; tick ne double JAMAIS.)

  // (2) Avancement : CHAQUE TERMINAL avance SES files au débit de son étape —
  // UN TERMINAL ne traite JAMAIS les pax d'un autre (R30). Le débit check-in
  // est celui DU TERMINAL (service bagages AFFECTÉ au terminal, R27).
  const tids = Object.keys(p.queues);
  for (const tid of tids) {
    const q = p.queues[tid];
    const caps = { checkin: checkinCap(sim, tid), security: securityCap(sim, tid), board: waitCapFor(sim, tid) };
    // R27/R30 : le service BAGAGES affecté à CE terminal (s.target === tid)
    // booste le débit check-in DE CE terminal. Un service affecté à A ne
    // renforce JAMAIS B (critère R27/R30 — plus de service global).
    const baggageCount = countTypeServing(sim, 'baggage', tid);
    const checkinRate = PAX.checkinRate + baggageCount * PAX.baggageBoostPer;
    const rates = { checkin: checkinRate, security: PAX.securityRate, board: PAX.boardRate };
    for (const [stage, to] of [['checkin', 'security'], ['security', 'board']]) {
      const pass = Math.min(q[stage], caps[stage], rates[stage] * dt);
      q[stage] -= pass; q[to] += pass;
      if (to === 'board') p.securityDone[tid] = (p.securityDone[tid] || 0) + pass; // D2 (R30) : compteur monotone sécurité→attente PAR TERMINAL
    }
    // (2c) La salle d'attente DU TERMINAL se vide au débit d'embarquement —
    // TOUJOURS (les pax attendent un avion : s'il arrive, ils montent ; s'il
    // ne vient pas (vol annulé), ils repartent). Sans ça, un vol annulé
    // cloggerait les files DU TERMINAL et la satisfaction ne remonterait
    // jamais (AC22 : évolutive).
    q.board = Math.max(0, q.board - PAX.boardRate * dt);
    // Nettoyage : un terminal dont les files sont toutes vides (pas de pax en
    // cours) peut perdre sa key (pas d'état fantôme) — optionnel (sérialisable).
  }

  // (3) Satisfaction : évolutive (AC22) — pénalité liée aux files ACTUELLES
  // (PAR TERMINAL), récupération quand les files sont vides. Un retard ancien
  // (files vides) ne retient PLUS la satisfaction : elle remonte (recoverRate +
  // confort). R30 : la saturation d'UN terminal pénalise la satisfaction
  // GLOBALE (l'aéroport) — la satisfaction reste un indicateur global de
  // l'aéroport, mais la PENALITÉ est calculée sur les files DE CHAQUE
  // TERMINAL (un terminal vide n'est jamais pénalisé par un autre saturé).
  // R34 : satisfaction/réputation reliées aux RÉSULTATS OBSERVÉS — la perte
  // directe de pic (incidents.mjs) est SUPPRIMÉE : un pic qui sature les
  // files se paie ICI (et seulement ici) ; un pic absorbé (files vides) ne
  // se compense plus artificiellement avec la récupération constante.
  const { loss } = satisfactionCauses(sim);
  if (loss > 0) p.satisfaction = Math.max(0, p.satisfaction - loss * dt);
  else {
    let gain = PAX.recoverRate;
    if (sim.infra.services.some((s) => s.type === 'catering')) gain += PAX.comfortCatering;
    if (sim.infra.services.some((s) => s.type === 'maintenance')) gain += PAX.comfortMaintenance;
    p.satisfaction = Math.min(100, p.satisfaction + gain * dt);
  }
}

// R34 (t_48232e68) : explication des CAUSES de la satisfaction — LECTURE pure
// (pattern incidentResponse) : le panneau affiche ce qui PÈSE (files
// saturées + débordement au-delà de la capacité, PAR TERMINAL) ou ce qui
// REMONTE (files vides → récupération + confort). MÊME calcul que le tick —
// UNE règle (jamais deux modules qui se contredisent, R34) : le tick LIT
// cette fonction, il ne recopie pas la formule.
export function satisfactionCauses(sim) {
  const p = ensurePassengers(sim); // init paresseuse (sauvegarde M1 / sim nue)
  let loss = 0, satStages = 0, overflow = 0;
  for (const tid of Object.keys(p.queues)) {
    const q = p.queues[tid];
    const caps = { checkin: checkinCap(sim, tid), security: securityCap(sim, tid), board: waitCapFor(sim, tid) };
    loss += PAX.satLossPerSat *
      (['checkin', 'security', 'board'].filter((s) => q[s] >= caps[s]).length);
    satStages += ['checkin', 'security', 'board'].filter((s) => q[s] >= caps[s]).length;
    for (const s of ['checkin', 'security', 'board']) {
      const over = Math.max(0, q[s] - caps[s]); // au-delà de la capacité (DU TERMINAL)
      loss += (over / 10) * PAX.satLossPerWait10;
      overflow += over;
    }
  }
  return { loss, satStages, overflow };
}

// Totaux DISPLAY (HUD/panneau) : les pax en cours SOMMÉS sur TOUS les
// terminaux (agrégat de lecture, PAS une règle — aucune règle de sim ne lit
// ces totaux ; les files RÉELLES sont sim.passengers.queues[terminalId]).
// R30 : l'ancien compteur GLOBAL `queue` (qui laissait un terminal traiter les
// pax d'un autre) est supprimé — ici on ne fait qu'ADDITIONNER les files par
// terminal pour l'affichage (un total de pax en attente est un fait mesurable,
// pas une règle de traitement).
export function queueTotals(sim) {
  const p = ensurePassengers(sim);
  let checkin = 0, security = 0, board = 0;
  for (const q of Object.values(p.queues || {})) {
    checkin += q.checkin; security += q.security; board += q.board;
  }
  return { checkin, security, board };
}

// Résumé lisible pour l'UI/HUD (AC22 : les files sont « visibles ») :
// occupation 0..1 + file totale (pax en cours) PAR TERMINAL. R30 : `byTerminal`
// (files/capacité/occupation de CHAQUE terminal) + les totaux globaux (sum)
// pour l'HUD. L'UI ne lit que cet objet.
export function passengerSummary(sim) {
  const p = ensurePassengers(sim);
  const tids = Object.keys(p.queues);
  const byTerminal = {};
  let inFlow = 0, inCheckin = 0, inSecurity = 0, inBoard = 0;
  for (const tid of tids) {
    const q = p.queues[tid];
    const caps = { checkin: checkinCap(sim, tid), security: securityCap(sim, tid), board: waitCapFor(sim, tid) };
    const occ = (s) => Math.min(1, q[s] / caps[s]);
    byTerminal[tid] = {
      checkin: { n: q.checkin, cap: caps.checkin, occ: occ('checkin') },
      security: { n: q.security, cap: caps.security, occ: occ('security') },
      board: { n: q.board, cap: caps.board, occ: occ('board') },
    };
    inFlow += q.checkin + q.security + q.board;
    inCheckin += q.checkin; inSecurity += q.security; inBoard += q.board;
  }
  return {
    totalCarried: p.totalCarried,
    satisfaction: p.satisfaction,
    inFlow,
    byTerminal,
    // Compat globale (HUD) : les files GLOBALES (somme des terminaux) — l'UI
    // globale peut les afficher sans connaître les terminaux.
    // R31 : les caps GLOBALES somment les caps PAR TERMINAL (améliorations
    // incluses — capMult, upgrades.mjs) ; l'affichage reste cohérent.
    queue: {
      checkin: { n: inCheckin, cap: sim.infra.terminals.reduce((s, t) => s + Math.round(PAX.checkinCapPerTerminal * capMult(sim, t.id)), 0), occ: 0 },
      security: { n: inSecurity, cap: sim.infra.terminals.reduce((s, t) => s + Math.round(PAX.securityCapPerTerminal * capMult(sim, t.id)), 0), occ: 0 },
      board: { n: inBoard, cap: waitCap(sim), occ: 0 },
    },
  };
}
