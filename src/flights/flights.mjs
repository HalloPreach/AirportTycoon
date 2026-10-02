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
import { runwayFor } from '../infra/infra.mjs'; // R05 : critère de compatibilité piste = UNE seule fonction (infra.mjs)
import { pushEvent } from '../core/sim-state.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../pathfinding/path.mjs';
import { isSurge, runwayClosed, fuelOut } from '../sim/incidents.mjs';
import { PAX_REVENUE, PAX_REVENUE_DRY, LANDING_FEE, GATE_FEE, FUEL_COST_PER_PAX } from '../economy/economy.mjs';

const SPAWN_EVERY_S = 60;  // cadence d'une fenêtre (x4 raisonnable)
export const MAX_PENDING = 4; // plafond UNIQUE d'arrivées (A-5) : au-delà, on n'en fait plus arriver
// Politique explicite (A-5, cohérent avec l'annulation bloquée à 10 min d'aircraft.mjs) :
// une OFFRE jamais décidée (état « planned ») expire 10 min sim après son heure prévue →
// refusé (événement lisible), sa place se libère, le planificateur repart. En attendant,
// elle reste décisionnable : l'acceptation tardive déploie dès la capacité libre (pas
// d'attente d'une fenêtre). Un vol « planned » ne se déploie JAMAIS seul (BL-16).
export const OFFER_DECISION_S = 600; // 10 min sim : délai de décision d'une offre

// Le planificateur : horloge + planification (fin du générateur invisible)
// + déploiement + retards + purge.
// R13 : la CRÉATION des offres (fenêtre, 1 par SPAWN_EVERY_S) est séparée de
// la VÉRIFICATION des vols acceptés arrivés à échéance (deployDue, À CHAQUE
// TICK) : un vol accepté en retard n'attend pas une fenêtre si la capacité
// est libre. Ordre par tick : horloge → fenêtre (créer les offres) → vols dus
// → offres expirées → retards → purge.
export function tickPlanner(sim, dt, rng = Math.random) {
  sim.time = (sim.time ?? 0) + dt; // horloge de la sim (pilotée par le planificateur)
  // Plusieurs fenêtres franchies sur le même pas (dt gros, ou jeu ralenti puis repris) :
  // on boucle SANS duplication (le déploiement passe par l'état « in-flight », idempotent)
  // et on PRÉSERVE le reste de l'accumulateur (pas = 90 s → 1 fenêtre + 30 s conservées).
  sim._spawnAcc = (sim._spawnAcc ?? 0) + dt;
  const windows = Math.floor(sim._spawnAcc / SPAWN_EVERY_S);
  if (windows > 0) {
    sim._spawnAcc -= windows * SPAWN_EVERY_S; // reste conservé
    for (let w = 0; w < windows; w++) windowClose(sim, rng); // création des offres
  }
  deployDue(sim);   // vols acceptés arrivés à échéance (chaque tick)
  expireOffers(sim); // offres jamais décidées → refusées (chaque tick)
  for (const a of sim.aircraft) {
    if (a.phase !== 'approach' && a.phase !== 'holding') continue;
    const ac = AIRCRAFT[a.acType];
    // R17 (D7, t_fc0d1920) : le planificateur NE CUMULE PLUS ac.delayed ici —
    // doHolding (aircraft.mjs) est le SEUL compteur du retard d'atterrissage.
    // Avant R17, les deux modules cumulaient le MÊME retard 2× (« un avion
    // arrêté ne cumule pas 2× le même retard dans plusieurs modules ») ;
    // la cause du retard reste LISIBLE (causeAt, aircraft.mjs) et l'état
    // « retardé » du planning est maintenu ci-dessous (marquage lisible).
    // BL-14 : piste FERMÉE (incident) → les atterrissages patientent (retard
    // lisible dans le planning), la réouverture les relance.
    if (runwayClosed(sim)) {
      markPlannedDelayed(sim, a.id, 'piste fermée — atterrissage en attente');
      continue;
    }
    // pas de piste assez longue ni de porte de taille : retard (critère 6).
    // R05 : le critère « piste compatible » est centralisé (infra.mjs).
    if (!runwayFor(sim, ac.minRunway) ||
        !sim.infra.gates.some((g) => g.size === ac.gate)) {
      markPlannedDelayed(sim, a.id, 'pas de piste/porte compatible');
    }
  }
  purge(sim);
}

// Fermeture d'une fenêtre : CRÉATION des offres uniquement (R13 — le
// déploiement des vols dus et l'expiration des offres se font chaque tick,
// voir tickPlanner). Si la file (avions en attente + offres planifiées/
// acceptées) est sous le plafond et qu'il y a au moins une piste, on planifie
// le vol suivant (visible ~60 s avant).
// Le plafond (A-5) compte la file ENTIÈRE (R13) : les avions DÉPLOYÉS sont
// déjà dans pendingCount — on ne les compte PAS une seconde fois via leurs
// entrées de planning (elles passent en « in-flight » au déploiement, donc
// plus jamais comptées dans le second terme : aucun double comptage).
// BL-14 : en pic de demande (surge), la cadence est DOUBLÉE (2 vols par
// fenêtre) — le pic se mesure au nombre de vols planifiés.
function windowClose(sim, rng) {
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
// R13 : PAS de double comptage — l'avion poussé à l'instant est DÉJÀ dans
// pendingCount (phase « approach ») : le plafond se vérifie sur pendingCount
// seul, qui inclut ce qui vient d'être déployé au cours de cette passe.
// Appelé à CHAQUE tick (pas seulement aux fenêtres) : un vol accepté dont
// l'heure est arrivée ne patiente PAS une minute s'il y a une place libre.
// Idempotent : une fois déployé, l'entrée passe en « in-flight » et n'est
// jamais re-déployée (pas de duplication au pas gros ou aux arrondis).
function deployDue(sim) {
  if (!sim.infra.runways.length) return; // rien à poser → pas de vols
  for (const e of sim.planning) {
    if (e.status !== 'accepted') continue; // planned = en attente de décision JOUEUR (ou expiration)
    if (e.planned > sim.time + 1) continue; // pas encore son heure (tolérance 1 s)
    if (pendingCount(sim) >= MAX_PENDING) break; // plafond (A-5) : compte les avions déjà poussés ici
    sim.aircraft.push(makeAircraft(sim, e));
    pushEvent(sim, { kind: 'flight-in', volId: e.id, airline: airlineName(e.airline), acType: e.acType });
  }
}

// R13 : politique EXPLICITE pour les offres jamais décidées (A-5, cohérente
// avec l'annulation des avions bloqués après 10 min d'aircraft.mjs).
// Une offre « planned » dont l'heure prévue est dépassée de plus de
// OFFER_DECISION_S (10 min sim) est REFUSÉE : retirée du planning + événement
// lisible — sa place (comptée dans le plafond A-5) se libère et le
// planificateur repart. Tant que l'offre est vivante, elle reste décisionnable
// (acceptation tardive → déploiement immédiat si capacité libre, voir deployDue).
function expireOffers(sim) {
  const expired = sim.planning.filter((e) => e.status === 'planned' && e.planned + OFFER_DECISION_S <= sim.time);
  if (!expired.length) return;
  const ids = new Set(expired.map((e) => e.id));
  sim.planning = sim.planning.filter((e) => !ids.has(e.id));
  for (const e of expired) pushEvent(sim, { kind: 'flight-offer-expired', volId: e.id, airline: airlineName(e.airline), why: 'offre jamais décidée (10 min)' });
}

// Rétrocompat : un appel DIRECT de spawnArrivals (tests historiques, sans
// tickPlanner) planifie ET déploie un vol immédiatement. En jeu, c'est
// tickPlanner qui fait le travail (le planning reste consultable avant arrivée).
export function spawnArrivals(sim, dt, rng = Math.random) {
  sim._spawnAcc = (sim._spawnAcc ?? 0) + dt;
  const windows = Math.floor(sim._spawnAcc / SPAWN_EVERY_S);
  if (windows < 1) return;
  sim._spawnAcc -= windows * SPAWN_EVERY_S; // R13 : reste conservé (comme tickPlanner)
  if (!sim.infra.runways.length) return;
  if (pendingCount(sim) >= MAX_PENDING) return; // plafond (A-5) : on n'en fait plus
  // Planning vide (aucun vol à déployer) → on en planifie UN, d'arrivée immédiate,
  // pour qu'un spawn forcé en produise toujours un (comportement historique).
  const due = sim.planning.some((e) => ['planned', 'accepted'].includes(e.status) && e.planned <= (sim.time ?? 0));
  if (!due) {
    const e = planOneFlight(sim, rng); // planOneFlight pousse dans sim.planning
    if (e) { // null = aucune infra servable (t_00ecae73) → pas de spawn forcé
      e.planned = sim.time ?? 0; // immédiat (pas d'attente de fenêtre)
      e.status = 'accepted'; // spawn FORCÉ = pré-accepté (la décision joueur ne concerne que le flux planning/panneau)
    }
  }
  deployDue(sim);
}

// Crée UNE entrée de planning (le prochain vol) : visible SPAWN_EVERY_S AVANT
// son arrivée. Déterministe si rng est semé ; l'heure prévue est une heure SIM
// (sim.time + SPAWN_EVERY_S), lisible dans le planning (AC3 « horaires prévus »).
// Retourne l'entrée créée (le planificateur la relocalise si besoin, ex. spawn
// forcé immédiat : e.planned = maintenant).
// t_00ecae73 : le planificateur ne planifie QUE des appareils SERVIBLES par
// l'infra existante (une piste assez longue ET une porte de la bonne taille).
// Avant : pick(rng, AIRLINES) tirait au hasard → l'aéroport de base (2 portes M
// seulement) planifiait des vols small (porte S) et large (porte L) qu'il ne
// pouvait PAS servir → bloqués 10 min → annulés → 319 k$ d'indemnités (6×
// l'opex total) → l'aéroport DÉFICITAIRE PAR CONSTRUCTION. C'était la cause
// racine qui forçait le capital artificiel (BL-18, 12 k → 345 k). La règle
// « servable » est la même que attributeFlight : piste ≥ minRunway + porte de
// la taille. Si l'infra ne sert AUCUN type → pas de vol planifié (on ne fait
// pas arriver un avion que l'aéroport ne pourrait jamais desservir).
function servableTypes(sim) {
  return Object.keys(AIRCRAFT).filter((k) => {
    const spec = AIRCRAFT[k];
    return !!runwayFor(sim, spec.minRunway) // R05 : critère compatibilité piste centralisé (infra.mjs)
      && sim.infra.gates.some((g) => g.size === spec.gate);
  });
}

function planOneFlight(sim, rng) {
  const servable = servableTypes(sim);
  if (!servable.length) return null; // aucune infra servable → pas de vol
  // Tirer d'abord un type SERVABLE, puis une compagnie qui l'opère : chaque
  // type du catalogue est opéré par au moins une compagnie.
  const acType = pick(rng, servable);
  const airline = pick(rng, AIRLINES.filter((a) => a.types.includes(acType)));
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
// le planning (état + cause), pas seulement sur l'avion. R17 (t_fc0d1920) :
// la cause est PASSEE en paramètre (chaque site donne sa propre cause —
// « piste fermée » ou « pas de piste/porte compatible »), le retard est
// accumulé PAR doHolding (aircraft.mjs, D7) — pas ici.
function markPlannedDelayed(sim, volId, why) {
  const e = sim.planning.find((p) => p.id === volId);
  if (e && e.status === 'in-flight') { e.status = 'delayed'; e.why = why || 'pas de piste/porte compatible'; }
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
  // R05 : « compatible » = UNE piste ASSEZ LONGUE + UNE porte DE LA BONNE TAILLE
  // (critère centralisé : infra.mjs) — le gain de la 2e piste est ici MESURABLE
  // (la compatibilité ne dépend plus de la 1re piste seulement).
  const hasRunway = !!runwayFor(sim, ac.minRunway);
  const hasGate = sim.infra.gates.some((g) => g.size === ac.gate);
  const compatible = hasRunway && hasGate;
  const available = pendingCount(sim) < MAX_PENDING;
  const accessible = compatible && hasAccessiblePath(sim, ac.gate);
  const alternatives = Object.keys(AIRCRAFT)
    .filter((k) => k !== acType && !!runwayFor(sim, AIRCRAFT[k].minRunway)
      && sim.infra.gates.some((g) => g.size === AIRCRAFT[k].gate));
  let cause = 'servi';
  if (!hasRunway) cause = `piste trop courte (voulue ≥ ${ac.minRunway})`;
  else if (!hasGate) cause = `pas de porte de taille ${ac.gate}`;
  else if (!accessible) cause = 'réseau coupé : le taxiway ne relie pas piste et porte';
  else if (!available) cause = 'aérogare saturée (plafond d’arrivées)';
  return { acType, compatible, available, accessible, alternatives, cause };
}

// R19 (t_f69dd9c9) — note de DÉCISION d'une offre du planning (offre « planned »)
// : les chiffres (taille/pax/revenu estimé) et les OBSTACLES/RISQUES, pour que
// le panneau planning soit un outil de décision, pas une liste muette.
// Règle de sim (exportée), l'UI (planning-panel.mjs) la rend seulement :
//   - compatibilité = le MÊME critère unique que attributeFlight (piste assez
//     longue + porte de la bonne taille, infra.mjs) — pas de 2e règle ;
//   - revenu estimé = hypothèse LISIBLE, jamais une promesse :
//     billets (pax × PAX_REVENUE, onGateDeparted, MOITIÉS sans station
//     carburant — ac._dryDeparture) + droits atterrissage/porte (onGateArrived)
//     carburant (FUEL_COST_PER_PAX, onGateDeparted) — les 4 montants viennent
//     de economy.mjs (source unique, pas de chiffres copiés ici) ;
//     le préfixe « estimé » + la satisfaction qui multiplie earn() (economy.mjs)
//     rappellent que c'est une estimation, pas un chiffre garanti ;
//   - risques : ce qui peut DETERIORER le vol une fois accepté (file d'arrivées
//     au plafond MAX_PENDING, station carburant en panne → billets moitiés).
//     « Risque » ≠ « obstacle » : l'obstacle rend l'offre impossible (la sim
//     l'explique via le cause d'attributeFlight) ; le risque ne bloque pas,
//     il a un coût (pas de promesse de rentabilité certaine — critère R19).
// C'est une FONCTION PURE de lecture (pas de mutation de sim) — l'UI peut
// l'appeler à chaque rendu sans effet de bord.
export function planNote(sim, e) {
  const ac = AIRCRAFT[e.acType] || {};
  if (!ac.name) {
    // Type d'avion inconnu (entrée corrompue) : obstacle explicite, pas de
    // crash — attributeFlight lirait un spec absent.
    return { compatible: false, obstacles: [`avion inconnu (${e.acType})`], risks: [], revenue: 0, spec: {} };
  }
  const attr = attributeFlight(sim, e.acType); // MÊME critère que la sim (R05)
  const obstacles = [];
  if (!attr.compatible) {
    // L'offre est IMPOSSIBLE : l'obstacle est EXPLIQUÉ (cause lisible) —
    // critère R19 « une offre impossible explique son obstacle ».
    obstacles.push(attr.cause);
  }
  // Risque 1 : saturation des arrivées (plafond A-5) — le vol sera en attente
  // (holding), retard. Le plafond est le MÊME MAX_PENDING que le déploiement.
  const pending = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
  const risks = [];
  if (pending >= MAX_PENDING) risks.push(`file d'arrivées saturée (${pending}/${MAX_PENDING}) : retard probable`);
  // Risque 2 : station carburant ABSENTE ou EN PANE → départ sec, billets
  // moitiés (la pénalité existe, elle est lisible AVANT la décision).
  const hasFuelStation = sim.infra.services.some((s) => s.type === 'fuel');
  if (!hasFuelStation) risks.push('pas de station carburant : départ sec (billets moitiés)');
  else if (fuelOut(sim)) risks.push('panne station carburant en cours : départ sec probable (billets moitiés)');
  // Revenu estimé (hypothèse, non garantie) — montants de economy.mjs.
  const revenue = (e.pax ?? 0) * (hasFuelStation ? PAX_REVENUE : PAX_REVENUE_DRY)
    + LANDING_FEE + GATE_FEE - (e.pax ?? 0) * FUEL_COST_PER_PAX;
  return {
    compatible: attr.compatible,
    obstacles,   // [] si servable ; sinon le motif (piste/porte/réseau)
    risks,       // [] si rien ; sinon les risques sans promesse de rentabilité
    revenue,     // estimé (hypothèse) — le préfixe « estimé » est à l'UI
    spec: ac,    // taille/charge (seats) pour l'affichage
  };
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
