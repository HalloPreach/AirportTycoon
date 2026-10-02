// Cycle avion (simulation pure, déterministe si rng/positions fixés).
// Ordre d'un vol entrant complet :
//   approach → holding (si attente) → landing → exit → taxi → docking → gate →
//   disembark → ground → board → pushback → taxi → holding → departure
//
// R04 (t_3de644b3) : cycle de réservation EXPLICITE — quand chaque ressource
// est acquise, conservée, libérée (jamais de référence périmée ni de double
// réservation) :
//   PISTE : acquise = passage en landing/exit/departure sur runwayId (l'usage
//     exclusif est DÉRIVÉ des phases — runwayBusy, jamais de champ dédié) ;
//     conservée tant que l'avion en est ; libérée = changement de phase.
//   SEGMENT : acquis = au 1er pas de chemin (doExit/doPushback : ac.seg +
//     occupied.add) ; conservé = doTaxi (à chaque avancement) ; libéré =
//     amarrage (doDocking), départ (doTaxi→departure), annulation (doBlocked),
//     chemin impossible (doExit/demolition R03 : ac.seg = null).
//   PORTE : acquise = à l'attribution (doExit : g.acId = ac.id, AVANT le taxi)
//     ; conservée = jusqu'au pushback (jamais de double réservation : une
//     porte réservée par un autre avion est sautée — A5) ; libérée = pushback,
//     annulation (si g.acId === ac.id), chemin impossible (doExit rend la
//     porte) ou suppression autorisée (démolition du terminal, refusée tant
//     qu'une porte est occupée — A6).
// Chaque avion est UN objet avec sa position monde (x,y) — visible, se déplace
// le long du réseau, jamais de téléportation (règle du brief). AC18 (A9) :
// landing converge vers l'axe de la piste sans saut, et « docking » amène
// physiquement l'avion au CENTRE de la porte (le nœud de porte n'est pas le
// centre).
// Les ressources partagées (piste, segment, porte) provoquent conflits/retards.
import { AIRCRAFT, REFUEL_TIME_S, GATE_WEAR_PER_SEC, GATE_MAINT_PER_SEC, GATE_WEAR_DELAY_S, NOMINAL_TURNOVER_S } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../pathfinding/path.mjs';
import { gateFor, pickRunway, runwayBusy, runwayFor } from '../infra/infra.mjs';
import { onGateArrived, onGateDeparted, onFlightCancelled } from '../economy/economy.mjs';
import { arrivePassengers, countCarried, boardDelay, groupComplete } from './passengers.mjs';
import { runwayClosed, fuelOut } from './incidents.mjs';

const V = { approach: 220, landing: 130, taxi: 60, pushback: 30, departure: 150 };
const GATE_OPS_S = 60;   // débarquement+sol+embarquement : durée d'occupation porte
const HOLDING_RETRY_S = 5; // réessayer de se placer toutes les 5 s si bloqué
const BLOCKED_CANCEL_S = 600; // 10 min sim : blocage persistant → annulation (décision A-5)
// R04 : attente en holding bornée (A-4) — la piste peut rester FERMÉE (incident
// BL-14) ou AUCUNE piste/porte compatible : un vol qui ne peut PAS atterrir
// ne tourne pas au tour indéfiniment (annulation bornée, comme le blocage
// taxi A-5, mais la CAUSE est différente et visible : « piste fermée » ou
// « pas de piste/porte compatible » — le diagnostic, pas juste un vol annulé).
const HOLDING_CANCEL_S = 600; // 10 min sim : attente d'atterrissage bornée (R04, A-4)
// BL-12 : stations carburant — UNE station = UNE LANCE (2e lance à partir de la
// 2e station : la saturation devient mesurable, critère de fin).
const FUEL_LANCES_PER_STATION = 1;
// R17 (t_fc0d1920) : fenêtre bornée de ponctualité — la statistique ne porte
// QUE sur les N fins de vol les plus récentes (départs + annulations) : pas
// d'historique sans fin (esprit R14 : borné à la racine, pas de 2e journal),
// et la fenêtre glissante (DELAY_WINDOW_S) reste lisible sans recompte.
const PUNCTUALITY_MAX = 50;
export const DELAY_WINDOW_S = 1800; // 30 min de jeu : la fenêtre glissante

// R17 : fenêtre bornée des fins de vol (sérialisable, bornée à la racine).
// Chaque entrée = la FIN d'un vol (départ ou annulation) avec son retard
// cumulé (ac.delayed, source unique de vérité — D7) et le dernier goulot
// rencontré (ac._delayCause) : c'est la statistique sur fenêtre bornée.
export function ensurePunctuality(sim) {
  sim.punctuality = sim.punctuality || { recent: [] };
  if (sim.punctuality.recent.length > PUNCTUALITY_MAX) {
    sim.punctuality.recent.splice(0, sim.punctuality.recent.length - PUNCTUALITY_MAX);
  }
  return sim.punctuality;
}
// R17 : log de la FIN d'un vol (départ, doDeparture / annulation, doBlocked /
// doHolding) — début/fin des phases utiles : le « début » est le déploiement
// (sim.time du vol) et la FIN se log ici avec le retard cumulé + le goulot.
export function logFlightEnd(sim, ac, cancelled) {
  const p = ensurePunctuality(sim);
  p.recent.push({
    at: sim.time || 0, id: ac.id, acType: ac.acType,
    delayed: ac.delayed || 0, cause: ac._delayCause || null, cancelled: !!cancelled,
  });
}
// Durée de rotation NOMINALE d'une taille d'avion (catalog.mjs, explicite) :
// opérations au sol (NOMINAL_TURNOVER_S) + avitaillement lié à la taille
// (spec.refuel × REFUEL_TIME_S) — l'horaire de départ prévu d'un vol suivant
// est espacé de cette durée. Un vol est PUNCTUEL si son retard cumulé (les
// attentes de goulots) ne dépasse pas cette rotation nominale.
export function nominalRotation(acType) {
  const spec = AIRCRAFT[acType] || {};
  return NOMINAL_TURNOVER_S + (spec.refuel || 0) * REFUEL_TIME_S;
}
// R17 : ponctualité à dénominateur CLAIR incluant les annulations —
//   dénominateur = les fins de vol de la fenêtre (départs + annulations),
//   numérateur = les départs à l'heure (retard ≤ rotation nominale).
// Une annulation (blocage/attente bornée) compte « non ponctuel » : c'est la
// conséquence mesurée d'un retard qu'on n'a pas absorbé. null = aucun vol
// terminé dans la fenêtre (pas de faux chiffre — R16).
export function punctualityStats(sim) {
  const p = ensurePunctuality(sim);
  const from = (sim.time || 0) - DELAY_WINDOW_S;
  const list = p.recent.filter((f) => f.at >= from);
  let onTime = 0, cancels = 0; const causes = {};
  for (const f of list) {
    if (f.cancelled) {
      cancels++;
      if (f.cause) causes[f.cause] = (causes[f.cause] || 0) + 1; // l'annulation EST le retard extrême : son goulot compte
      continue;
    }
    if (f.delayed <= nominalRotation(f.acType)) onTime++;
    else if (f.cause) causes[f.cause] = (causes[f.cause] || 0) + 1;
  }
  return { total: list.length, onTime, cancels,
          rate: list.length ? onTime / list.length : null, causes };
}
// Cause lisible d'un retard (R17, D7) : LECTURE pure de l'état — aucune
// mutation, aucun compteur parallèle (le retard est ac.delayed, la cause est
// ac._delayCause posée PAR le module qui retarde, jamais recalculée ici).
// La version LUE (par phase) est `causeAt` (ci-dessous) ; DELAY_CAUSE_FR la
// traduit en français pour l'UI.
export const DELAY_CAUSE_FR = Object.freeze({
  piste: 'piste (fermée/occupée)', porte: 'porte (réservée/usure)',
  segment: 'segment (taxi occupé)', carburant: 'carburant (lance/panne)',
  passagers: 'passagers (file saturée)',
});

// R17 (t_fc0d1920, D7 tranchée) : la CAUSE DU RETARD vit en TÊTE de la sim —
// les retards sont LECTURES d'état dérivé (aucun compteur dédié, aucune
// duplication avec ac.delayed, la source unique de vérité du retard). Les
// 5 goulots : piste (piste fermée/occupée — holding), porte (amarrage/ops au
// sol, y compris files passagers), segment (taxi bloqué), carburant (lance
// prise / panne station), passagers (file d'embarquement saturée). La cause
// « courante » est mémorisée (ac._delayCause, champ VOLATIL : jamais
// sérialisé — dérivée de l'état des sim au prochain tick) pour que le
// dernier goulot rencontré soit lisible dans le panneau (ui/panels.mjs) et
// les tests, sans recalc de règles côté UI.
//   noteCause(ac, cause)  : « le retard courant vient de X » (le prochain
//                            tick de retard le confirmera ou le remplacera) ;
//   causeAt(sim, ac)      : la cause LUE de la phase courante (règle pure,
//                            pas de mutation) — ce que le panneau affiche.
// « Un avion arrêté ne cumule pas 2× le même retard dans plusieurs modules »
// (D7) : chaque vol compte UN ac.delayed (seconde de jeu), et sa cause est
// lue — jamais additionnée ni dupliquée par module.
const CAUSES = Object.freeze({
  piste: 'piste', porte: 'porte', segment: 'segment', carburant: 'carburant', passagers: 'passagers',
});
function noteCause(ac, cause) { ac._delayCause = CAUSES[cause]; }
export function causeAt(sim, ac) {
  if (ac.phase === 'holding') {
    // doHolding (source de vérité) : attente de la PISTE — fermée (incident)
    // ou occupée (congestion, R05) : les deux sont le goulot « piste ».
    return 'piste';
  }
  if (ac.phase === 'blocked') {
    // doBlocked (source de vérité) : le chemin est coupé/occupé.
    // heading = 'gate' (arrivée) : on retente doExit — PORTE + chemin ;
    // heading = 'runway' (départ) : on retente doPushback — SEGMENT vers la
    // piste (le goulot reste le segment, la piste en visée n'est pas occupée
    // ici : le pushback part même piste occupée, seul le chemin compte).
    return ac.heading === 'gate' ? 'porte' : 'segment';
  }
  if (ac.phase === 'refuel') {
    // doRefuel (source de vérité) : attente = LANCE prise (saturation) ou
    // PANNÉ (incident) — les deux sont le goulot « carburant ».
    return 'carburant';
  }
  if (ac.phase === 'taxi' && ac.heading === 'runway' && ac.path
      && ac.pathPtr + 1 >= ac.path.length) {
    // doTaxi (source de vérité) : arrivé au bout du chemin, la piste est
    // occupée (A4) — on attend le décollage : le goulot est la PISTE.
    return 'piste';
  }
  if (ac._delayCause) return ac._delayCause; // dernier goulot mémorisé
  return null; // pas de retard actif (phase nominale ou retard inconnu)
}
// Le battement avions : avance chaque avion selon sa phase.
// Réservations exclusives (BL-03, AC15) : une occupation par segment est construite
// AVANT le tour des avions (snapshot) pour que deux avions n'entrent jamais dans le
// même segment libre au même tick (A3), puis les réservations se mettent à jour au
// déplacement de chaque avion.
export function tickAircraft(sim, dt) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  const occupied = new Set();
  for (const a of sim.aircraft) if (a.seg != null) occupied.add(a.seg);

  for (const ac of sim.aircraft) {
    const spec = AIRCRAFT[ac.acType];
    switch (ac.phase) {
      case 'approach':  doApproach(sim, ac, dt, spec); break;
      case 'holding':   doHolding(sim, ac, dt, spec, occupied); break;
      case 'landing':   doLanding(sim, ac, dt, spec); break;
      case 'exit':      doExit(sim, ac, dt, spec, occupied); break;
      case 'taxi':      doTaxi(sim, ac, dt, occupied); break;
      case 'docking':   doDocking(sim, ac, dt); break;
      case 'gate':      doGate(sim, ac, dt); break;
      case 'refuel':    doRefuel(sim, ac, dt, spec); break;
      case 'disembark': doOps(sim, ac, dt); break;
      case 'ground':    doOps(sim, ac, dt); break;
      case 'board':     doOps(sim, ac, dt); break;
      case 'pushback':  doPushback(sim, ac, dt, spec, occupied); break;
      case 'departure': doDeparture(sim, ac, dt); break;
      case 'blocked':   doBlocked(sim, ac, dt, spec, occupied); break;
      default: break; // departed / cancelled : purgés par le planificateur
    }
  }
}

// APPROACH : l'avion descend vers la piste (appro). S'il n'y a pas encore de piste
// compatible, la (seule) piste compatible est FERMÉE (incident), ou si toutes
// les pistes compatibles sont occupées, il passe en holding (attente) — jamais
// de deux avions sur la même piste en même temps (conflit de ressource).
function doApproach(sim, ac, dt, spec) {
  // R05 : le CHOIX d'atterrissage est CENTRALISÉ (infra.mjs : compatibilité +
  // occupation + ordre stable) — la MEILLEURE piste compatible ET LIBRE : la 1re
  // n'est plus CHOISIE par défaut (sondée : 2e libre choisie si 1re prise).
  const rw = pickRunway(sim, spec.minRunway, ac.id);
  // BL-14 : piste FERMÉE (incident) → aucun atterrissage (le départ, lui,
  // continue) : l'avion patiente en holding, son retard s'accumule (la
  // conséquence est MESURABLE, la récupération = réouverture).
  // Aucune piste compatible / toutes occupées → HOLDING (A4), doHolding prend
  // le relais (le compteur d'attente bornée R04 ne tourne QUE sur blocage).
  if (!rw || runwayClosed(sim)) { ac.phase = 'holding'; ac.timer = 0; return; }
  ac.runwayId = rw.id;
  const topY = rw.y; // haut de la piste (arrivée de l'approche)
  const speed = V.approach * dt;
  if (ac.y < topY) {
    ac.y = Math.min(topY, ac.y + speed);
  } else {
    ac.phase = 'landing'; // arrivé au haut de la piste : atterrissage
    ac.timer = 0;
  }
}

// HOLDING : l'avion tourne au-dessus de la piste en attendant qu'elle se libère.
// Les retards s'accumulent (critère 6). Aucune téléportation : il continue de
// descendre s'il est en approche, sinon il fait le tour (oscille doucement).
function doHolding(sim, ac, dt, spec, occupied) {
  // R05 : le choix d'atterrissage est CENTRALISÉ (infra.mjs) : la MEILLEURE
  // piste compatible ET LIBRE (null si toutes occupées → attente, A4).
  const rw = pickRunway(sim, spec.minRunway, ac.id);
  ac.delayed += dt;
  noteCause(ac, 'piste'); // R17 : le goulot est la PISTE (fermée ou occupée)
  // R04 (A-4) : BLOCAGE PERMANENT en holding = piste FERMÉE (incident) ou
  // AUCUNE piste compatible. Il est DIAGNOSTIQUÉ (la cause est nommée dans
  // l'événement d'annulation) et FINI par une règle bornée (HOLDING_CANCEL_S,
  // comme A-5) : pas de tournées au tour indéfiniment. La CONGESTION normale
  // (toutes les pistes compatibles OCCUPÉES) N'EST PAS un blocage : le compteur
  // reste à zéro — une attente brève ne provoque jamais d'annulation abusive.
  // (runwayFor = compatibilité SEULE, sans occupation : on distingue « aucune
  // compatible » (blocage permanent → annulation bornée) de « toutes
  // occupées » (congestion, R05 — le compteur reste à zéro).)
  const holdWhy = !runwayFor(sim, spec.minRunway) ? 'pas de piste assez longue'
    : (runwayClosed(sim) ? 'piste fermée' : null);
  if (holdWhy) {
    ac._holdBlocked = (ac._holdBlocked ?? 0) + dt;
    if (ac._holdBlocked >= HOLDING_CANCEL_S) {
      ac.phase = 'cancelled';
      onFlightCancelled(sim);
      logFlightEnd(sim, ac, true); // R17 : annulation = fin de vol dans la fenêtre (comptée)
      pushEvent(sim, { kind: 'flight-cancelled', volId: ac.id, airline: ac.airline, why: `attente bornée — ${holdWhy}` });
      return;
    }
  } else {
    ac._holdBlocked = 0;
  }
  if (!rw) return; // toutes occupées (congestion) : on patiente sans annulation
  const topY = rw.y;
  if (ac.y < topY) {
    ac.y = Math.min(topY, ac.y + V.approach * dt); // toujours en descente
  } else {
    ac.x += Math.sin(ac.timer * 0.4) * 20 * dt; // survol / attente
  }
  ac._holdAcc = (ac._holdAcc ?? 0) + dt;
  if (ac._holdAcc >= HOLDING_RETRY_S) {
    ac._holdAcc = 0;
    // La piste est exclusive (A4) : on n'y entre que si personne d'autre
    // n'y atterrit, n'en sort, ou n'en décolle. Piste fermée (incident) :
    // on patiente aussi (la réouverture relance la tentative).
    if (!runwayBusy(sim, rw.id, ac.id) && !runwayClosed(sim) && ac.y >= topY) {
      ac.runwayId = rw.id;
      ac.phase = 'landing';
      ac.timer = 0;
    }
  }
}

// LANDING : roule le long de la piste vers le bas (décollage au bout opposé).
// AC18 (A9) : PLUS de saut horizontal — l'axe de la piste est CONVERGÉ latéralement
// à la vitesse taxi (borné par tick), la descente continue à V.landing : la trajectoire
// est continue (max ~14 px/tick à dt 0.1), pas d'accrochage sur l'axe au milieu de
// l'approche.
function doLanding(sim, ac, dt, spec) {
  const rw = sim.infra.runways.find((r) => r.id === ac.runwayId);
  if (!rw) { ac.phase = 'holding'; return; }
  const bottomY = rw.y + rw.h;
  const axis = rw.x + rw.w / 2; // axe de la piste
  if (ac.x !== axis) {
    const d = axis - ac.x;
    const lat = V.taxi * dt; // roulage latéral borné (pas de téléportation)
    ac.x += d > 0 ? Math.min(d, lat) : Math.max(d, -lat);
  }
  ac.y = Math.min(bottomY, ac.y + V.landing * dt);
  if (ac.y >= bottomY - 1) {
    // fin de piste → sortie de piste (exit) : on cherche le chemin taxi vers une porte
    ac.phase = 'exit';
    ac.timer = 0;
  }
}

// EXIT : on quitte la piste, on part vers une porte compatible. On calcule le chemin.
// A5 : la porte est RÉSERVÉE à l'attribution (g.acId = ac.id) — deux avions ne
// reçoivent jamais la même porte avant leur arrivée ; la porte reste réservée
// jusqu'au pushback (libération sûre).
function doExit(sim, ac, dt, spec, occupied) {
  // R04 (A5) : porte réservée AVANT le taxi (gateFor : bonne taille + libre —
  // une porte réservée par UN AUTRE avion est sautée). Si le chemin s'avère
  // impossible, on rend la porte ICI (libération sûre) — jamais de référence
  // périmée : g.acId n'existe que si le vol est toujours attaché à cette porte.
  const gate = gateFor(sim, spec.gate, ac.id);
  if (!gate) { ac.phase = 'blocked'; ac.timer = 0; return; }
  gate.acId = ac.id; // A5 : porte réservée à cet avion jusqu'au pushback
  ac.gateId = gate.id;
  const fromNode = runwayExitNode(sim, ac.runwayId);
  const toNode = gateNodeOf(sim, gate.id);
  const path = findPath(sim, fromNode, toNode, occupied);
  if (!path || path.length < 2) {
    // Pas de chemin → libération SÛRE : on rend la porte (g.acId) et on oublie
    // le gateId (pas de référence périmée — le prochain retry reprendra à neuf).
    gate.acId = null;
    ac.gateId = null;
    ac.phase = 'blocked'; ac.timer = 0; return;
  }
  ac.path = path;
  ac.pathPtr = 0;
  ac.seg = sim._graph.nodes[ac.path[0]].seg;
  // A3 : le segment d'arrivée du prochain pas est réservé immédiatement — un
  // autre avion ne peut plus entrer dedans au même tick (réservation exclusive).
  if (ac.seg != null) occupied.add(ac.seg);
  ac.heading = 'gate';
  ac.phase = 'taxi';
}

// TAXI : suit le chemin ; s'arrête si le segment d'arrivée est occupé (conflit de ressource).
function doTaxi(sim, ac, dt, occupied) {
  if (!ac.path) { ac.phase = 'blocked'; return; }
  const nodes = sim._graph.nodes;
  const nextIdx = ac.pathPtr + 1;
  if (nextIdx >= ac.path.length) {
    // arrivé au nœud cible (le dernier du chemin)
    if (ac.heading === 'gate') {
      // AC18 (A9) : le nœud de porte n'est PAS le centre de la porte (nœud du
      // taxiway, ~51 px du centre) : phase DOCKING = amarrage physique au centre
      // de la porte, position réelle conservée (pas de téléportation).
      ac.phase = 'docking'; ac.seg = null; ac.timer = 0;
      const g = sim.infra.gates.find((g) => g.id === ac.gateId);
      if (g) g.acId = ac.id;
      onGateArrived(sim, ac);
    } else if (runwayBusy(sim, ac.runwayId, ac.id)) {
      // D1 (audit) : la piste est exclusive (A4) — un atterrissage/sortie en
      // cours y est → on ATTEND au bout du chemin (retard mesurable), pas de
      // décollage concurrent. (Le départ n'est PAS bloqué par une piste FERMÉE
      // : la fermeture n'interdit que l'atterrissage, voir doApproach.)
      ac.delayed += dt;
      noteCause(ac, 'piste'); // R17 : l'attente est la PISTE (occupée, A4)
    } else {
      ac.phase = 'departure'; ac.seg = null; // prêt à décoller depuis le bas de la piste
    }
    return;
  }
  const nextNode = nodes[ac.path[nextIdx]];
  const nextSeg = nextNode.seg;
  // conflit : le segment d'arrivée est pris par un autre avion → on s'arrête (attente)
  if (occupied.has(nextSeg) && nextSeg !== ac.seg) {
    ac.delayed += dt;
    noteCause(ac, 'segment'); // R17 : le goulot est le SEGMENT (taxi, A3)
    return;
  }
  // on avance vers le nœud suivant
  const dx = nextNode.x - ac.x;
  const dy = nextNode.y - ac.y;
  const dist = Math.hypot(dx, dy);
  const step = V.taxi * dt;
  if (dist <= step) {
    ac.x = nextNode.x;
    ac.y = nextNode.y;
    ac.pathPtr = nextIdx;
    ac.seg = nodes[ac.path[ac.pathPtr]].seg; // le segment qu'on occupe maintenant
  } else {
    ac.x += (dx / dist) * step;
    ac.y += (dy / dist) * step;
    ac.seg = nextSeg; // on entre sur le segment d'arrivée
  }
  // A3 : la réservation du segment d'arrivée se met à jour ICI, au déplacement.
  // Un autre avion ne peut plus entrer dans ce segment au même tick (exclusive).
  if (ac.seg != null) occupied.add(ac.seg);
}

// DOCKING (AC18, A9) : amarrage physique — l'avion roule lentement du nœud de
// taxiway jusqu'au CENTRE de la porte (le nœud de porte n'est pas le centre :
// c'est le nœud du segment qu'elle joint, ~51 px plus loin). Position réelle,
// borné par tick, aucune téléportation.
function doDocking(sim, ac, dt) {
  const g = sim.infra.gates.find((g) => g.id === ac.gateId);
  if (!g) { ac.phase = 'gate'; return; } // porte disparue : on reste amarré sur place
  const gx = g.x + g.w / 2, gy = g.y + g.h / 2;
  const dx = gx - ac.x, dy = gy - ac.y;
  const dist = Math.hypot(dx, dy);
  const step = V.taxi * dt;
  if (dist <= step) { ac.x = gx; ac.y = gy; ac.phase = 'gate'; }
  else { ac.x += (dx / dist) * step; ac.y += (dy / dist) * step; }
}

// GATE : l'avion est amarré à la porte (au CENTRE, vu doDocking). Opérations au sol :
// carburant (BL-12) → débarquement → sol → embarquement. Chaque étape dure GATE_OPS_S/3.
// On compte les passagers transportés à l'embarquement (critère 7).
function doGate(sim, ac, dt) {
  // R05 : arrivePassengers est IDEMPOTENT par vol — un avion qui RE-ENTRE en gate
  // (pushback échoué → doBlocked → doExit, R04) a DÉJÀ injecté ses pax au 1er
  // passage : sans ce garde, le 2e passage ré-injecte (injectedTotal gonfle, un
  // groupe « base » orphelin reste à jamais, AC40 casse). Le 2e passage n'ajoute
  // donc plus de pax au parcours (elles sont déjà dans la file).
  if (!ac._paxInjected) {
    arrivePassengers(sim, ac);
    ac._paxInjected = true;
  }
  ac.phase = 'refuel';
  ac.timer = 0;
}

// REFUEL (BL-12, AC21) : remise à niveau du carburant AVANT le déchargement.
// Si une station existe, l'avion prend UNE LANCE (une station = une lance, 2e
// lance à partir de la 2e station — l'occupation partagée = saturation mesurable)
// et le plein dure spec.refuel * REFUEL_TIME_S (lié à la taille : le 747 prend
// plus longtemps que le Cessna). SANS station : pas d'attente — départ SÉC,
// expliqué par l'événement « no-fuel » : les billets ne sont que moitiés
// (économiquement pénalisé, non bloquant — critère « non bloquants »).
// L'usure porte (BL-12) s'accumule pendant toute la présence porte : une porte
// sale rallonge les opérations au sol (délai ground, HANGAR la remet à zéro).
function doRefuel(sim, ac, dt, spec) {
  ac.timer += dt;
  // BL-12 + t_2179387d : usure de la porte pendant que l'avion est amarré.
  // DEUX usures distinctes : g.cleaning (« sale ») + g.maintenance (« mécanique »
  // pendant le plein). Chacune est nettoyée par un service DIFFÉRENT (nettoyage
  // vs hangar) → deux services distincts qui coûtent et qui servent.
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  if (g) {
    g.cleaning = Math.min(100, g.cleaning + GATE_WEAR_PER_SEC * dt);
    g.maintenance = Math.min(100, g.maintenance + GATE_MAINT_PER_SEC * dt);
  }
  const lances = fuelLances(sim);
  if (!lances || fuelOut(sim)) {
    // Pas de station OU panne station (incident BL-14) OU station DÉMOLIE
    // (disparition du service) → départ SÉC (non bloquant, expliqué) :
    // billets moitié. R08 (D2) : la lance est LIBÉRÉE IMMÉDIATEMENT si le
    // plein était en cours (avant la fix, ac._refueling restait true → lance
    // comptée occupée artificiellement par le comptage busy). La panne est
    // temporaire — quand le service revient, les pleins reprennent.
    releaseLance(ac);
    ac._dryDeparture = true;
    if (!ac._noFuelNotified) {
      ac._noFuelNotified = true;
      pushEvent(sim, { kind: 'no-fuel', airline: ac.airline, pax: ac.pax });
    }
    ac.phase = 'disembark'; ac.timer = 0;
    return;
  }
  acquireLance(sim, ac, spec, lances);
  if (!ac._refueling) noteCause(ac, 'carburant'); // R17 : lance(s) prise(s) — attente (saturation)
  if (ac._refueling) {
    ac._refuelNeed -= dt;
    if (ac._refuelNeed <= 0) {
      releaseLance(ac); // fin normale : libère sa lance
      ac.phase = 'disembark'; ac.timer = 0;
    }
  }
}

// R08 (t_dab62cfc) : l'acquisition/libération d'une LANCE est CENTRALISÉE —
// UNE fonction d'acquisition (une lance par station ; si toutes sont prises,
// l'avion attend — saturation mesurable, pas de débordement) et UNE de
// libération. TOUTES les sorties du plein passent par releaseLance : fin
// normale, panne station (D2 : libération IMMÉDIATE), disparition du service
// (station démolie → !lances → même branch panne) ; l'annulation ne concerne
// pas le refuel (un avion refuel n'est jamais annulé — la purge retire les
// vols cancelled de sim.aircraft et leur lance ne compte plus). Le comptage
// d'occupation ne compte QUE les pleins réellement actifs (a._refueling).
function acquireLance(sim, ac, spec, lances) {
  if (ac._refueling) return; // déjà en plein : pas de 2e lance
  const busy = sim.aircraft.filter((a) => a._refueling).length;
  if (busy < lances) {
    ac._refueling = true;
    ac._refuelNeed = spec.refuel * REFUEL_TIME_S; // durée liée à la taille
  }
}

// Libération CENTRALE : le propriétaire (ac._refueling) ET le temps restant
// (ac._refuelNeed) sont nettoyés ensemble — aucun chemin de sortie n'en oublie
// un (le branch panne avant R08 n'en nettoyait aucun).
function releaseLance(ac) {
  ac._refueling = false;
  ac._refuelNeed = 0;
}

// BL-12 : lances disponibles = stations carburant construites (une lance par
// station). La saturation est MESURABLE : 2 vols au sol, 1 lance → le 2e
// attend (retard, critère de fin).
function fuelLances(sim) {
  return sim.infra.services.filter((s) => s.type === 'fuel').length * FUEL_LANCES_PER_STATION;
}

// OPÉRATIONS AU SOL : débarquement → sol → embarquement → pushback.
// Le comptage des passagers (UNE fois, critère 7) se fait à la fin de
// l'étape « board », à travers le module passagers (countCarried).
function doOps(sim, ac, dt) {
  ac.timer += dt;
  const step = GATE_OPS_S / 3;
  if (ac.timer < step) return; // l'étape en cours dure GATE_OPS_S/3
  if (ac.phase === 'disembark') {
    ac.phase = 'ground';
    ac.timer = 0;
    return;
  }
  if (ac.phase === 'ground') {
    // BL-12 + t_2179387d : la porte usée (g.cleaning « sale » + g.maintenance
    // « mécanique ») RALLONGE l'étape sol. CHAQUE usure est nettoyée par un
    // service DISTINCT : le nettoyage (g.cleaning) et le hangar (g.maintenance).
    // Le retard est proportionnel à l'usure totale (0..200) : GATE_WEAR_DELAY_S
    // par point — deux services qui coûtent ET qui servent (critère de fin).
    const g = sim.infra.gates.find((x) => x.id === ac.gateId);
    const wearDelay = (g ? g.cleaning + g.maintenance : 0) * GATE_WEAR_DELAY_S;
    const delay = boardDelay(sim, ac) + wearDelay; // saturation files + porte sale
    ac.phase = 'board';
    ac.timer = -delay; // l'étape embarquement démarre retardée (timer négatif)
    return;
  }
  if (ac.phase === 'board') {
    // Le retard (timer négatif) doit s'écouler avant le comptage.
    if (ac.timer < step) {
      // R17 : la PARTIE au-delà du nominal (timer < 0) est l'attente files
      // passagers / usure porte (portée par boardDelay + wearDelay, doOps
      // ground→board) — le goulot est « passagers » (file saturée) ou
      // « porte » (usure). La partie nominale (0..step) n'est pas un retard.
      if (ac.timer < 0) noteCause(ac, boardDelay(sim, ac) > 0 ? 'passagers' : 'porte');
      return;
    }
    // D2 : on ne compte/embarque QUE si le groupe du vol est COMPLET (tous ses
    // pax ont franchi check-in + sécurité → en attente). Sinon le vol reste au
    // sol (l'embarquement ne démarre pas avant la fin du parcours passager).
    // groupComplete ne bloque PAS si le groupe n'existe plus (avion injecté à
    // la main, groupe déjà purgé/compté) : parcours considéré terminé.
    if (!groupComplete(sim, ac)) { noteCause(ac, 'passagers'); return; }
    if (!ac.counted) {
      countCarried(sim, ac); // les passagers montent : comptés UNE fois
      ac.counted = true;     // le re-tick « board » ne recompte jamais (AC40)
    }
  }
  ac.phase = 'pushback';
  ac.timer = 0;
}

// PUSHBACK : on sort de la porte (chemin inverse : porte → nœud de piste).
function doPushback(sim, ac, dt, spec, occupied) {
  // libère la porte
  const g = sim.infra.gates.find((g) => g.id === ac.gateId);
  if (g) g.acId = null;
  const fromNode = gateNodeOf(sim, ac.gateId);
  const toNode = runwayExitNode(sim, ac.runwayId);
  const path = findPath(sim, fromNode, toNode, occupied);
  if (!path || path.length < 2) {
    ac.phase = 'blocked'; ac.timer = 0;
    return;
  }
  ac.path = path;
  ac.pathPtr = 0;
  ac.seg = sim._graph.nodes[ac.path[0]].seg;
  if (ac.seg != null) occupied.add(ac.seg); // A3 : réservation exclusive du segment
  ac.heading = 'runway';
  ac.phase = 'taxi';
}

// DÉPART : roulage vers le haut de la piste (départ au bout opposé), puis sortie de la carte.
function doDeparture(sim, ac, dt) {
  const rw = sim.infra.runways.find((r) => r.id === ac.runwayId);
  if (!rw) { ac.phase = 'holding'; return; }
  ac.x = rw.x + rw.w / 2;
  ac.y -= V.departure * dt;
  if (ac.y < rw.y - 120) {
    onGateDeparted(sim, ac); // recettes passagers au décollage
    logFlightEnd(sim, ac, false); // R17 : fin du vol (départ) dans la fenêtre de ponctualité
    ac.phase = 'departed';
    ac.seg = null;
    pushEvent(sim, { kind: 'flight-out', volId: ac.id, airline: ac.airline, pax: ac.pax });
  }
}

// BLOQUÉ : aucun chemin (taxiway coupé / porte indisponible). On retente régulièrement.
// A-5 : un blocage PERSISTANT est compté (ac._blockedAcc) et annulé après
// BLOCKED_CANCEL_S (10 min sim) : pas de croissance infinie des vols bloqués.
// La cause est visible (événement « flight-cancelled », toast dans l'UI).
function doBlocked(sim, ac, dt, spec, occupied) {
  ac.delayed += dt;
  noteCause(ac, ac.heading === 'gate' ? 'porte' : 'segment');
  ac.timer += dt;
  ac._blockedAcc = (ac._blockedAcc ?? 0) + dt;
  if (ac._blockedAcc >= BLOCKED_CANCEL_S) {
    // Blocage persistant → annulation (décision A-5 : comptés + annulés).
    const g = sim.infra.gates.find((g) => g.id === ac.gateId);
    if (g && g.acId === ac.id) g.acId = null; // libération sûre de la porte réservée
    ac.seg = null;
    ac.phase = 'cancelled';
    onFlightCancelled(sim); // BL-15 (AC6) : l'incident a un coût (indemnité)
    logFlightEnd(sim, ac, true); // R17 : annulation = fin de vol dans la fenêtre (comptée)
    pushEvent(sim, { kind: 'flight-cancelled', volId: ac.id, airline: ac.airline, why: 'blocage persistant' });
    return;
  }
  if (ac.timer < HOLDING_RETRY_S) return;
  ac.timer = 0;
  // réessayer selon le contexte : heading = 'gate' (on voulait aller à une porte)
  if (ac.heading === 'gate') {
    doExit(sim, ac, dt, spec, occupied);
  } else {
    // on partait de la porte : on retente pushback
    doPushback(sim, ac, dt, spec, occupied);
  }
  if (ac.phase !== 'blocked') ac._blockedAcc = 0; // rétabli → le compteur repart à zéro
}
