// Vols : le planificateur PLANIFIE des vols entrants (planning consultable),
// la sim les route. Logique pure, déterministe si rng est semé.
// BL-07 (AC3/NONMVP-8) : fin du générateur aléatoire invisible.
//   - Les vols sont créés AVANT leur arrivée dans sim.planning (compagnie,
//     appareil, passagers, heure prévue, état) : l'UI (BL-16) les consulte,
//     le joueur accepte/refuse via decideFlight.
//   - Un vol planifié à la fenêtre N arrive à la fenêtre N+1 (visible ~60 s
//     avant sa venue) ; à son heure prévue il devient avion réel (approach).
//   - Un vol refusé est retiré du planning (n'arrive jamais).
//   - L'attribution (compatible/disponible/accessible + alternatives) est
//     calculée pour que le joueur voie POURQUOI un vol part ou reste en attente.
// Horloge : le planificateur EST le propriétaire de sim.time (sim.time += dt) —
// la sim avance au temps de JEU, indépendamment de l'horloge UI (state.time).
import { AIRLINES, AIRCRAFT } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../pathfinding/path.mjs';
import { isSurge, runwayClosed } from '../sim/incidents.mjs';

const SPAWN_EVERY_S = 60;  // cadence d'une fenêtre (x4 raisonnable)
const MAX_PENDING = 4;     // au-delà, on n'en fait plus arriver (aérogare saturée)

// Le planificateur : horloge + planification (fin du générateur invisible)
// + déploiement + retards + purge.
// Ordre : horloge → fenêtre (planifier + déployer) → retards → purge.
export function tickPlanner(sim, dt, rng = Math.random) {
  sim.time = (sim.time ?? 0) + dt; // horloge de la sim (pilotée par le planificateur)
  sim._spawnAcc = (sim._spawnAcc ?? 0) + dt;
  if (sim._spawnAcc >= SPAWN_EVERY_S) {
    sim._spawnAcc = 0;
    windowClose(sim, rng); // une fenêtre : déployer le vol dû + planifier le suivant
  }
  for (const a of sim.aircraft) {
    if (a.phase !== 'approach' && a.phase !== 'holding') continue;
    const ac = AIRCRAFT[a.acType];
    // BL-14 : piste FERMÉE (incident) → les atterrissages patientent (retard
    // lisible dans le planning), la réouverture les relance.
    if (runwayClosed(sim)) {
      a.delayed += dt;
      markPlannedDelayed(sim, a.id);
      continue;
    }
    // pas de piste assez longue ni de porte de taille : retard (critère 6).
    if (!sim.infra.runways.some((r) => r.len >= ac.minRunway) ||
        !sim.infra.gates.some((g) => g.size === ac.gate)) {
      a.delayed += dt;
      markPlannedDelayed(sim, a.id);
    }
  }
  purge(sim);
}

// Fermeture d'une fenêtre : 1) déployer les vols dont l'heure est arrivée,
// 2) si la file (avions en attente + vols planifiés) est sous le plafond et
// qu'il y a au moins une piste, planifier le vol suivant (visible ~60 s avant).
// Le plafond (A-5) compte les bloqués : saturés, plus de planification ; les
// vols bloqués sont annulés après 10 min → la file se vide, on repart.
// BL-14 : en pic de demande (surge), la cadence est DOUBLÉE (2 vols par
// fenêtre) — le pic se mesure au nombre de vols planifiés.
function windowClose(sim, rng) {
  deployDue(sim);
  if (sim.infra.runways.length) {
    const n = isSurge(sim) ? 2 : 1; // pic de demande (BL-14) : cadence doublée
    for (let k = 0; k < n; k++) {
      const pending = pendingCount(sim) + sim.planning.filter((e) => e.status === 'planned' || e.status === 'accepted').length;
      if (pending >= MAX_PENDING) break;
      planOneFlight(sim, rng);
    }
  }
}

// Déploie les vols PRÉ-ACCEPTÉS dont l'heure prévue est atteinte.
// BL-16 (AC20) : seuls les vols « accepted » se déploient — un vol resté
// « planned » (jamais accepté) N'ARRIVE JAMAIS : le générateur invisible est
// fini, c'est le JOUEUR qui décide (boutons du panneau ou case auto-accept).
// Tolerance de 1 s : sim.time est une somme de dt flottants (dérive de ~1e-14),
// l'heure prévue (un multiple de 60 s) ne doit pas rester éternellement
// « pas encore à l'heure » à cause de l'arrondi binaire.
function deployDue(sim) {
  if (!sim.infra.runways.length) return; // rien à poser → pas de vols
  let deployed = 0;
  for (const e of sim.planning) {
    if (e.status !== 'accepted') continue; // planned = en attente de décision JOUEUR
    if (e.planned > sim.time + 1) continue; // pas encore son heure (tolérance 1 s)
    if (pendingCount(sim) + deployed >= MAX_PENDING) break; // plafond (A-5)
    sim.aircraft.push(makeAircraft(sim, e));
    pushEvent(sim, { kind: 'flight-in', volId: e.id, airline: airlineName(e.airline), acType: e.acType });
    deployed++;
  }
}

// Rétrocompat : un appel DIRECT de spawnArrivals (tests historiques, sans
// tickPlanner) planifie ET déploie un vol immédiatement. En jeu, c'est
// tickPlanner qui fait le travail (le planning reste consultable avant arrivée).
export function spawnArrivals(sim, dt, rng = Math.random) {
  sim._spawnAcc = (sim._spawnAcc ?? 0) + dt;
  if (sim._spawnAcc < SPAWN_EVERY_S) return;
  sim._spawnAcc = 0;
  if (!sim.infra.runways.length) return;
  if (pendingCount(sim) >= MAX_PENDING) return; // plafond (A-5) : on n'en fait plus
  // Planning vide (aucun vol à déployer) → on en planifie UN, d'arrivée immédiate,
  // pour qu'un spawn forcé en produise toujours un (comportement historique).
  const due = sim.planning.some((e) => ['planned', 'accepted'].includes(e.status) && e.planned <= (sim.time ?? 0));
  if (!due) {
    const e = planOneFlight(sim, rng); // planOneFlight pousse dans sim.planning
    e.planned = sim.time ?? 0; // immédiat (pas d'attente de fenêtre)
    e.status = 'accepted'; // spawn FORCÉ = pré-accepté (la décision joueur ne concerne que le flux planning/panneau)
  }
  deployDue(sim);
}

// Crée UNE entrée de planning (le prochain vol) : visible SPAWN_EVERY_S AVANT
// son arrivée. Déterministe si rng est semé ; l'heure prévue est une heure SIM
// (sim.time + SPAWN_EVERY_S), lisible dans le planning (AC3 « horaires prévus »).
// Retourne l'entrée créée (le planificateur la relocalise si besoin, ex. spawn
// forcé immédiat : e.planned = maintenant).
function planOneFlight(sim, rng) {
  const airline = pick(rng, AIRLINES);
  const acType = pick(rng, airline.types);
  const ac = AIRCRAFT[acType];
  const e = {
    id: sim.nextAcId++,
    airline: airline.id,
    color: airline.color,
    acType,
    pax: Math.max(0, Math.round(ac.seats * (0.4 + 0.5 * rng()))), // remplissage variable
    planned: (sim.time ?? 0) + SPAWN_EVERY_S, // heure prévue d'arrivée (visible à l'avance)
    status: 'planned',                         // planned → accepted (déploiement à l'heure prévue)
  };
  sim.planning.push(e);
  return e;
}

// Fait d'un vol planifié un avion réel (phase 'approach'). L'entrée de planning
// passe en « in-flight » : informative (le vol reste consultable tant qu'il est
// en cours, état/retard lisibles), jamais re-déployée (purge au départ).
function makeAircraft(sim, e) {
  const airline = airlineOf(e.airline);
  e.status = 'in-flight';
  return {
    id: e.id, airline: e.airline, color: airline.color, acType: e.acType, pax: e.pax,
    phase: 'approach',
    x: 200 + (e.id % 1200), // position d'approche déterminée par l'id (pas rng, AC18)
    y: -150,
    gateId: null, runwayId: null, delayed: 0, timer: 0,
    path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
}

// Retard (critère 6, AC3) : la CAUSE du retard est portée par l'entrée de
// planning du vol EN COURS (« in-flight » → « delayed » + why) → lisible dans
// le planning (état + cause), pas seulement sur l'avion.
function markPlannedDelayed(sim, volId) {
  const e = sim.planning.find((p) => p.id === volId);
  if (e && e.status === 'in-flight') { e.status = 'delayed'; e.why = 'pas de piste/porte compatible'; }
}

// Purge les vols annulés/partis : on retire LEUR entrée de planning (le planning
// reste consultable tant que le vol est en cours ; il disparaît quand il termine).
// Les entrées planned/accepted n'ont PAS (encore) d'avion — on ne les purge pas :
// ce n'est pas leur avion qui a disparu, c'est le vol qui n'est pas encore né.
function purge(sim) {
  sim.aircraft = sim.aircraft.filter((a) => a.phase !== 'cancelled' && a.phase !== 'departed');
  sim.planning = sim.planning.filter((e) =>
    e.status === 'planned' || e.status === 'accepted' || sim.aircraft.some((a) => a.id === e.id));
}

// N'avions en attente/route (approche/holding/landing/blocked) : le plafond A-5.
function pendingCount(sim) {
  return sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
}

// Décision du joueur (AC3, NONMVP-8) : ACCEPTER ou REFUSER un vol planifié.
// Refus : l'entrée est retirée du planning → le vol n'arrivera jamais.
// Acceptation : le vol reste planifié et se déploiera à son heure prévue.
// Côté sim (règle) ; l'UI (BL-16) l'appelle après clic. Retourne true si la
// décision a eu un effet, false si le vol n'est plus décisionnable (en cours,
// déjà refusé, ou déjà déployé).
export function decideFlight(sim, volId, accept) {
  const e = sim.planning.find((p) => p.id === volId);
  if (!e || e.status !== 'planned') return false; // planned = le seul état décisionnable
  if (accept) { e.status = 'accepted'; return true; }
  sim.planning = sim.planning.filter((p) => p.id !== volId); // refus : retiré
  return true;
}

// Attribution compatible/disponible/accessible + alternatives (BL-07, AC3) :
// pour un appareil, dit si le terrain le SERVE :
//   compatible   : une piste ASSEZ LONGUE + une porte DE LA BONNE TAILLE existent
//   disponible   : un slot d'arrivée n'est pas saturé (plafond MAX_PENDING)
//   accessible   : le réseau (taxiways) relie la sortie de piste à UNE porte
//   alternatives : les autres tailles d'avion que l'aéroport, lui, sait servir
//   cause        : motif lisible si non compatible/disponible/accessible
export function attributeFlight(sim, acType) {
  const ac = AIRCRAFT[acType];
  const hasRunway = sim.infra.runways.some((r) => r.len >= ac.minRunway);
  const hasGate = sim.infra.gates.some((g) => g.size === ac.gate);
  const compatible = hasRunway && hasGate;
  const available = pendingCount(sim) < MAX_PENDING;
  const accessible = compatible && hasAccessiblePath(sim, ac.gate);
  const alternatives = Object.keys(AIRCRAFT)
    .filter((k) => k !== acType && sim.infra.runways.some((r) => r.len >= AIRCRAFT[k].minRunway)
      && sim.infra.gates.some((g) => g.size === AIRCRAFT[k].gate));
  let cause = 'servi';
  if (!hasRunway) cause = `piste trop courte (voulue ≥ ${ac.minRunway})`;
  else if (!hasGate) cause = `pas de porte de taille ${ac.gate}`;
  else if (!accessible) cause = 'réseau coupé : le taxiway ne relie pas piste et porte';
  else if (!available) cause = 'aérogare saturée (plafond d’arrivées)';
  return { acType, compatible, available, accessible, alternatives, cause };
}

// Le réseau relie-t-il la sortie de piste à UNE porte de la bonne taille ?
// (findPath sur le graphe, occupation vide : la question est « est-ce joignable »)
function hasAccessiblePath(sim, gateSize) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  if (!sim._graph) return false;
  const occupied = new Set(); // « joignable » = sans conflit d'occupation
  for (const g of sim.infra.gates) {
    if (g.size !== gateSize) continue;
    const to = gateNodeOf(sim, g.id);
    if (to == null) continue; // porte hors réseau (aucun taxiway ne la touche)
    for (const r of sim.infra.runways) {
      const from = runwayExitNode(sim, r.id);
      if (from == null) continue;
      if (findPath(sim, from, to, occupied)) return true;
    }
  }
  return false;
}

function airlineOf(id) { return AIRLINES.find((x) => x.id === id) || AIRLINES[0]; }
function airlineName(id) { return airlineOf(id).name; }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
