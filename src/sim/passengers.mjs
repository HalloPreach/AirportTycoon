// Passagers (agregés) : les passagers voyagent en GROUPES liés à un vol et à
// un terminal (AC22) — pas de passagers individuels, et surtout PAS un simple
// total transporté (AC40) : un passager suit un PARCOURS à travers le terminal :
//   débarquement → check-in (+bagages) → sécurité → attente → embarquement.
// Chaque étape a une CAPACITÉ (places en parallèle) et un DÉBIT (pax/s) : les
// files (sim.passengers.queue) sont l'état VISIBLE de ce parcours (occupation
// lisible, 0..1), et la SATURATION a un effet mesurable : la file grandit, la
// satisfaction baisse, l'embarquement se retarde (boardDelay), le dénouement
// (capacité libérée, plus d'arrivées) vide les files et la satisfaction
// REMONTE — un retard ancien ne condamne pas indéfiniment (AC22).
// Comptage : un passager est compté UNE SEULE fois, à l'embarquement
// (countCarried, appelé par le module avions à la fin du « board »). Les
// groupes vivent pendant le vol au sol puis disparaissent au départ :
// totalCarried (cumul transportés) est monotone et les files ne comptent
// QUE les passagers EN COURS → pas de double comptage (invariant testé).
// Bagages (AC22) : ponytail — le dépôt bagages est dans le check-in (débit
// checkin), pas une étape séparée ; add quand un service bagages devient
// constructible.
// Logique pure (testable Node) : mutue sim.passengers (sérialisable seul).
// L'état de la sim (sim-state.mjs) reste la source ; l'UI ne lit que cet objet.
import { pushEvent } from '../core/sim-state.mjs';

// Équilibrage (ponytail : constantes fixes, calées sur les tests saturation —
// pas de table par type d'avion ; le débit des files ne dépend pas du vol).
// Capacités ~ un gros vol au repos (A320 ≈ 144 pax) : file vide au repos,
// file SATUREE en saturation (plusieurs vols superposés).
const PAX = Object.freeze({
  checkinCapPerTerminal: 120, // check-in : confortable pour un A320 seul
  securityCapPerTerminal: 120, // sécurité : idem
  waitCapPerGate: 80,         // salle d'attente : 80 par porte
  checkinRate: 12,          // pax/s : guéridon check-in (+bagages)
  securityRate: 16,         // pax/s : filière sécurité
  boardRate: 10,           // pax/s : porte d'embarquement
  satLossPerWait10: 0.02,   // %/s : par 10 pax en file AU-DESSUS de la capacité
  satLossPerSat: 0.15,      // %/s : par étape SATURÉE (file pleine)
  recoverRate: 0.5,        // %/s : la satisfaction REMONTE quand les files sont vides
  comfortCatering: 0.2,    // services de confort (soutien de la satisfaction)
  comfortMaintenance: 0.1, // — mêmes taux que l'ancienne logique économie
});

// Démarre l'état passagers (les sauvegardes M1 n'ont pas ces champs — tolérées).
export function ensurePassengers(sim) {
  let p = sim.passengers;
  if (p && p.queue && p.groups) return p;
  p = p || { totalCarried: 0, satisfaction: 100 };
  p.queue = p.queue || { checkin: 0, security: 0, board: 0 };
  p.groups = p.groups || [];
  if (p.satisfaction === undefined) p.satisfaction = 100;
  return p;
}

// Le vol commence le déchargement (appelé par le module avions à l'entrée de la
// phase « disembark ») : le GROSSE du vol entre dans le check-in du terminal.
export function arrivePassengers(sim, ac) {
  const p = ensurePassengers(sim);
  if (!ac.pax || ac.pax <= 0) return;
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  p.groups.push({
    volId: ac.id, pax: ac.pax, terminalId: g ? g.terminalId : null,
  });
}

// Le vol embarque ses passagers (appelé par le module avions à la fin du
// « board ») : le groupe est TRANSPORTÉ — compté une fois, retiré du parcours.
export function countCarried(sim, ac) {
  const p = ensurePassengers(sim);
  p.totalCarried += ac.pax; // UNE SEULE fois, à l'embarquement (critère 7, AC40)
  p.groups = p.groups.filter((gr) => gr.volId !== ac.id);
}

// Délai d'embarquement (AC22 : l'attente INFLUE SUR LE VOL) : si la file
// d'embarquement dépasse sa capacité, le groupe attend sa part de l'excédent.
// Le débit est partagé entre TOUS les vols en train d'embarquer (portes de
// plusieurs terminaux) → retard plus fort quand plusieurs vols sont au sol.
// Retourne des secondes (0 au repos). L'avion applique ce délai à son étape.
export function boardDelay(sim, ac) {
  const p = ensurePassengers(sim);
  const cap = waitCap(sim);
  const over = Math.max(0, p.queue.board - cap);
  if (!over) return 0;
  const share = over * (ac.pax / Math.max(1, p.queue.board)); // sa part de l'excédent
  const drainers = Math.max(1, sim.aircraft.filter((a) => a.phase === 'board').length);
  return share / (PAX.boardRate * drainers);
}

// Capacités d'une étape (dépendent de l'INFRA construite — capacité terminal).
function checkinCap(sim) { return Math.max(1, sim.infra.terminals.length * PAX.checkinCapPerTerminal); }
function securityCap(sim) { return Math.max(1, sim.infra.terminals.length * PAX.securityCapPerTerminal); }
export function waitCap(sim) { return Math.max(1, sim.infra.gates.length * PAX.waitCapPerGate); }

// Occupation visible d'une étape (0..1, lisible par l'UI/HUD) : file / capacité.
export function queueOccupancy(sim, stage) {
  const p = ensurePassengers(sim);
  const cap = stage === 'checkin' ? checkinCap(sim) : stage === 'security' ? securityCap(sim) : waitCap(sim);
  return Math.min(1, p.queue[stage] / cap);
}

// Le battement passagers (appelé par tick.mjs) :
//   1) les groupes du vol débarqué entrent dans la file check-in (débarquement)
//   2) les files avancent au débit de leur étape (check-in → sécurité → attente)
//   3) satisfaction : pénalité sur file au-dessus de la capacité / étape
//      saturée, RÉCUPÉRATION quand les files sont vides (+ services confort).
// Les groupes (gr.volId) servent au COMPTAGE unique + à l'épuration des vols
// partis ; l'avancement physique des pax est porté par les FILES (q.*).
export function tickPassengers(sim, dt) {
  const p = ensurePassengers(sim);
  const q = p.queue;

  // Groupes orphelins (vol annulé/purgé en cours de parcours) : les passagers
  // ne partent PAS — ils sortent du parcours sans être comptés (pas de fausse
  // comptabilité) et ne cloguent jamais les files.
  p.groups = p.groups.filter((gr) => sim.aircraft.some((a) => a.id === gr.volId));

  // (1) Entrées : le débarquement d'un vol déverse ses pax dans le check-in.
  for (const gr of p.groups) {
    if (!gr.injected) { q.checkin += gr.pax; gr.injected = true; }
  }
  // (2) Avancement : chaque file avance au débit de son étape (débouché borné
  //     par la capacité de l'étape courante — ponytail : approximation simple,
  //     upgrade : files par vol / par porte).
  const caps = { checkin: checkinCap(sim), security: securityCap(sim), board: waitCap(sim) };
  const rates = { checkin: PAX.checkinRate, security: PAX.securityRate, board: PAX.boardRate };
  for (const [stage, to] of [['checkin', 'security'], ['security', 'board']]) {
    const pass = Math.min(q[stage], caps[stage], rates[stage] * dt);
    q[stage] -= pass; q[to] += pass;
  }
  // (2c) La salle d'attente se vide au débit d'embarquement — TOUJOURS (les pax
  //      attendent un avion : s'il arrive, ils montent ; s'il ne vient pas
  //      (vol annulé), ils repartent). Sans ça, un vol annulé cloggerait les
  //      files et la satisfaction ne remonterait jamais (AC22 : évolutive).
  q.board = Math.max(0, q.board - PAX.boardRate * dt);

  // (3) Satisfaction : évolutive (AC22) — pénalité liée aux files ACTUELLES,
  //     récupération quand les files sont vides. Un retard ancien (files vides)
  //     ne retient PLUS la satisfaction : elle remonte (recoverRate + confort).
  let loss = PAX.satLossPerSat *
    (['checkin', 'security', 'board'].filter((s) => q[s] >= caps[s]).length);
  for (const s of ['checkin', 'security', 'board']) {
    const over = Math.max(0, q[s] - caps[s]); // au-delà de la capacité
    loss += (over / 10) * PAX.satLossPerWait10;
  }
  if (loss > 0) p.satisfaction = Math.max(0, p.satisfaction - loss * dt);
  else {
    let gain = PAX.recoverRate;
    if (sim.infra.services.some((s) => s.type === 'catering')) gain += PAX.comfortCatering;
    if (sim.infra.services.some((s) => s.type === 'maintenance')) gain += PAX.comfortMaintenance;
    p.satisfaction = Math.min(100, p.satisfaction + gain * dt);
  }
}

// Résumé lisible pour l'UI/HUD (AC22 : les files sont « visibles ») :
// occupation 0..1 + file totale (pax en cours) par étape.
export function passengerSummary(sim) {
  const p = ensurePassengers(sim);
  const caps = { checkin: checkinCap(sim), security: securityCap(sim), board: waitCap(sim) };
  const occ = (s) => Math.min(1, p.queue[s] / caps[s]);
  return {
    totalCarried: p.totalCarried,
    satisfaction: p.satisfaction,
    inFlow: p.queue.checkin + p.queue.security + p.queue.board,
    queue: {
      checkin: { n: p.queue.checkin, cap: caps.checkin, occ: occ('checkin') },
      security: { n: p.queue.security, cap: caps.security, occ: occ('security') },
      board: { n: p.queue.board, cap: caps.board, occ: occ('board') },
    },
  };
}
