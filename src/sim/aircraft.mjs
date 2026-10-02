// Cycle avion (simulation pure, déterministe si rng/positions fixés).
// Ordre d'un vol entrant complet :
//   approach → holding (si attente) → landing → exit → taxi → docking → gate →
//   disembark → ground → board → pushback → taxi → holding → departure
// Chaque avion est UN objet avec sa position monde (x,y) — visible, se déplace
// le long du réseau, jamais de téléportation (règle du brief). AC18 (A9) :
// landing converge vers l'axe de la piste sans saut, et « docking » amène
// physiquement l'avion au CENTRE de la porte (le nœud de porte n'est pas le
// centre).
// Les ressources partagées (piste, segment, porte) provoquent conflits/retards.
import { AIRCRAFT, REFUEL_TIME_S, GATE_WEAR_PER_SEC, HANGAR_CLEAN_PER_SEC, GATE_WEAR_DELAY_S } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../pathfinding/path.mjs';
import { onGateArrived, onGateDeparted } from '../economy/economy.mjs';
import { arrivePassengers, countCarried, boardDelay } from './passengers.mjs';

const V = { approach: 220, landing: 130, taxi: 60, pushback: 30, departure: 150 };
const GATE_OPS_S = 60;   // débarquement+sol+embarquement : durée d'occupation porte
const HOLDING_RETRY_S = 5; // réessayer de se placer toutes les 5 s si bloqué
const BLOCKED_CANCEL_S = 600; // 10 min sim : blocage persistant → annulation (décision A-5)
// BL-12 : stations carburant — UNE station = UNE LANCE (2e lance à partir de la
// 2e station : la saturation devient mesurable, critère de fin).
const FUEL_LANCES_PER_STATION = 1;

// Piste occupée par un AUTRE avion (AC15, A4) : atterrissage/décollage/sortie
// exclusifs sur une même piste. Deux demandes au même tick ne partagent pas la piste.
function runwayBusy(sim, runwayId, excludeAcId) {
  return sim.aircraft.some((a) => a.id !== excludeAcId && a.runwayId === runwayId
    && ['landing', 'exit', 'departure'].includes(a.phase));
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
// compatible OU si la piste est occupée, il passe en holding (attente) — jamais de
// deux avions sur la même piste en même temps (conflit de ressource).
function doApproach(sim, ac, dt, spec) {
  const rw = runwayFor(sim, spec.minRunway);
  if (!rw) { ac.phase = 'holding'; ac.timer = 0; return; }
  // Piste occupée par un autre avion → attente (A4 : landing/départ exclusifs).
  if (runwayBusy(sim, rw.id, ac.id)) { ac.runwayId = rw.id; ac.phase = 'holding'; ac.timer = 0; return; }
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
  const rw = runwayFor(sim, spec.minRunway);
  ac.delayed += dt;
  if (!rw) return; // pas de piste : le planificateur gère retard/annulation
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
    // n'y atterrit, n'en sort, ou n'en décolle.
    if (!runwayBusy(sim, rw.id, ac.id) && ac.y >= topY) {
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
  // Réservation atomique : on cherche une porte libre ET on la réserve ICI, au
  // même tick (g.acId = ac.id). Une porte réservée par UN AUTRE avion est sautée.
  // Un avion qui a déjà sa porte (retry depuis blocked) peut la RÉUTILISER :
  // g.acId === ac.id compte comme libre pour lui (pas de double réservation).
  const gate = sim.infra.gates.find((g) => g.size === spec.gate && (!g.acId || g.acId === ac.id));
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
  arrivePassengers(sim, ac); // le vol commence le déchargement (passagers agrégés)
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
  // BL-12 : usure de la porte pendant que l'avion est amarré (le hangar nettoie).
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  if (g) g.cleaning = Math.min(100, g.cleaning + GATE_WEAR_PER_SEC * dt);
  const lances = fuelLances(sim);
  if (!lances) {
    // Pas de station → départ SÉC (non bloquant, expliqué) : billets moitié.
    ac._dryDeparture = true;
    if (!ac._noFuelNotified) {
      ac._noFuelNotified = true;
      pushEvent(sim, { kind: 'no-fuel', airline: ac.airline, pax: ac.pax });
    }
    ac.phase = 'disembark'; ac.timer = 0;
    return;
  }
  if (!ac._refueling) {
    // Une lance par station : si toutes sont prises, l'avion ATTEND ici
    // (saturation mesurable → retard au sol, pas de débordement des lances).
    const busy = sim.aircraft.filter((a) => a._refueling).length;
    if (busy < lances) {
      ac._refueling = true;
      ac._refuelNeed = spec.refuel * REFUEL_TIME_S; // durée liée à la taille
    }
  }
  if (ac._refueling) {
    ac._refuelNeed -= dt;
    if (ac._refuelNeed <= 0) {
      ac._refueling = false; // libère sa lance
      ac.phase = 'disembark'; ac.timer = 0;
    }
  }
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
    // BL-12 : la porte usée (g.cleaning, accumulé pendant le plein/refuel et le
    // séjour sol) RALLONGE l'étape sol → le hangar (maintenance) est le SEUL
    // service qui la nettoie (infra.mjs tickUnlocks → cleanGates) : un bâtiment
    // qui coûte ET qui sert (critère de fin). Le retard est proportionnel à
    // l'usure (0..100) : GATE_WEAR_DELAY_S par point d'usure.
    const g = sim.infra.gates.find((x) => x.id === ac.gateId);
    const wearDelay = (g ? g.cleaning : 0) * GATE_WEAR_DELAY_S;
    const delay = boardDelay(sim, ac) + wearDelay; // saturation files + porte sale
    ac.phase = 'board';
    ac.timer = -delay; // l'étape embarquement démarre retardée (timer négatif)
    return;
  }
  if (ac.phase === 'board') {
    // Le retard (timer négatif) doit s'écouler avant le comptage.
    if (ac.timer < step) return;
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
  ac.timer += dt;
  ac._blockedAcc = (ac._blockedAcc ?? 0) + dt;
  if (ac._blockedAcc >= BLOCKED_CANCEL_S) {
    // Blocage persistant → annulation (décision A-5 : comptés + annulés).
    const g = sim.infra.gates.find((g) => g.id === ac.gateId);
    if (g && g.acId === ac.id) g.acId = null; // libération sûre de la porte réservée
    ac.seg = null;
    ac.phase = 'cancelled';
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

// --- Aides de sélection de ressources (compatibilité/disponibilité). -----------

// Piste compatible : la plus courte piste qui dépasse la longueur min requise.
function runwayFor(sim, minLen) {
  const rws = sim.infra.runways.filter((r) => r.len >= minLen);
  if (!rws.length) return null;
  rws.sort((a, b) => a.len - b.len);
  return rws[0];
}
