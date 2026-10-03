// Infrastructures : pistes, taxiways, terminaux/portes, services.
// Logique pure (testable Node) : elle mutera state.sim.infra.
// Grille d'occupation 10×10 px : un segment de 200 px = 20 cellules, ça suffit
// pour « est-ce que ça empiète sur autre chose ? » et « est-ce qu'un avion peut
// poser/rouler ici ». ponytail : grille carrée simple, pas d'arborescence spatiale.
import { BUILDINGS, TERMINAL_GATE_SIZES, HANGAR_CLEAN_PER_SEC, CLEANING_RATE_PER_SEC, GROUND_SERVICE_TYPES } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { autoAssign, ensureAssignments, servicesServingGate } from './assignments.mjs'; // R27 : affectation des services aux terminaux
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../pathfinding/path.mjs';

const CELL = 10;

// Recalcule la grille d'occupation à partir des bâtiments (appelé après build/demolish).
export function buildGrid(sim) {
  const g = sim.infra.grid;
  g.w = 160; g.h = 120; // 1600×1200 / 10
  g.cells = new Uint8Array(g.w * g.h);
  const mark = (b) => {
    const x0 = Math.floor(b.x / CELL), y0 = Math.floor(b.y / CELL);
    const x1 = Math.floor((b.x + b.w - 1) / CELL), y1 = Math.floor((b.y + b.h - 1) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) g.cells[cy * g.w + cx] = 1;
    }
  };
  for (const r of sim.infra.runways) mark(r);
  for (const t of sim.infra.taxiways) mark(t);
  for (const t of sim.infra.terminals) mark(t);
  for (const s of sim.infra.services) mark(s);
}

// R23 (t_c992b7d6) : la DÉCISION de déverrouillage a quitté ce module — elle
// vit dans src/infra/unlocks.mjs (conditions mesurables, appelées par
// tickUnlocks) ; ce module ne FAIT QUE POSER : les conditions sont lues par
// unlockState (MÊME code du côté sim et du côté build-tool : jamais deux
// règles divergentes).
import { unlockState } from './unlocks.mjs';

// Vérifie les conditions à chaque tick ; émet une alerte lisible par service
// débloqué (le module de règle : src/infra/unlocks.mjs).
export { tickUnlocks } from './unlocks.mjs';

// Est-ce que le rect [x,y,w,h] tient dans le terrain et n'empiète sur personne ?
function fits(sim, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > 1600 || y + h > 1200) return false;
  const g = sim.infra.grid;
  const x0 = Math.floor(x / CELL), y0 = Math.floor(y / CELL);
  const x1 = Math.floor((x + w - 1) / CELL), y1 = Math.floor((y + h - 1) / CELL);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) continue; // marge hors grille = OK
    if (g.cells[cy * g.w + cx]) return false;
  }
  return true;
}

// Place un bâtiment. Retourne le bâtiment posé, ou null si impossible (motif dans evt).
export function buildBuilding(sim, type, x, y) {
  const spec = BUILDINGS[type];
  if (!spec) return null;
  // Service pas encore débloqué (condition mesurable, R23) → refus lisible.
  const st = unlockState(sim, type);
  if (!st.unlocked) {
    pushEvent(sim, { kind: 'locked', type, name: spec.name, why: st.why });
    return null;
  }
  if (sim.economy.money < spec.cost) {
    pushEvent(sim, { kind: 'no-funds', cost: spec.cost });
    return null;
  }
  if (!fits(sim, x, y, spec.w, spec.h)) {
    pushEvent(sim, { kind: 'build-blocked', type, x, y });
    return null;
  }
  const b = placeBuilding(sim, { id: sim.infra.nextId++, type, x, y, w: spec.w, h: spec.h, cost: spec.cost });
  // R27 (t_6424937a) : un service posé est IMMÉDIATEMENT affecté au terminal
  // le plus proche (règle déterministe du placement, autoAssign) — son effet
  // se mesurera UNIQUEMENT sur ce terminal (pas de bonus implicite global).
  if (b && GROUND_SERVICE_TYPES.includes(type)) autoAssign(sim, b);
  // R27 : un terminal NOUVEAU réactive les services dormants (posés avant
  // tout terminal, target null + auto) — ils passent inactifs → affectés
  // (motif lisible), jamais d'orphelin.
  if (b && type === 'terminal') ensureAssignments(sim);
  sim.economy.money -= spec.cost;
  // BL-15 : les CONSTRUCTIONS partent d'un compte dédié (spent.construction) —
  // le compte « fuel » est réservé à la DÉPENSE carburant des départs (A-6) :
  // un bilan qui mêle construction et carburant ne se lit plus (AC23).
  sim.economy.spent.construction = (sim.economy.spent.construction ?? 0) + spec.cost;
  pushEvent(sim, { kind: 'built', type, id: b.id });
  return b;
}

// Portes d'un terminal : petites plateformes alignées sur le bord bas, une par
// colonne. Le joueur relie chaque porte au réseau par un taxiway (sinon
// findPath renvoie null → avion « bloqué »).
function makeGates(id, b, sizes) {
  return sizes.map((size, i) => ({
    id: `${id}-g${i}`, size, terminalId: id,
    x: b.x + 25 + i * 45, y: b.y + b.h - 10, w: 40, h: 10,
    cleaning: 0, maintenance: 0,
    acId: null,
  }));
}

// Pose un bâtiment (placement + grille + graph dirty). L'argent reste à
// l'appelant : buildBuilding débite, l'aéroport de départ (new-game.mjs, A-2)
// est gratuit (fourni par le jeu).
// BL-05 (A8) : les terminaux créent leurs 4 portes sur le bord bas —
// S/M/M/L : la porte L est CONSTRUCTIBLE, les gros avions ont donc une infra
// réalisable (piste L de la grille 1000). On ne limite pas les vols L.
export function placeBuilding(sim, b, gateSizes = TERMINAL_GATE_SIZES) {
  if (b.type === 'runway') { b.len = b.h; sim.infra.runways.push(b); }
  else if (b.type === 'taxiway') sim.infra.taxiways.push(b);
  else if (b.type === 'terminal') {
    // Terminal = portes alignées sur son bord bas (par défaut S/M/M/S).
    const gates = makeGates(b.id, b, gateSizes);
    b.gates = gates.map((g) => g.id);
    sim.infra.terminals.push(b);
    sim.infra.gates.push(...gates);
  }
  else sim.infra.services.push(b);
  buildGrid(sim);
  sim._graphDirty = true; // l'infra a changé → le graphe pathfinding doit être recalculé
  return b;
}

// Détruit un bâtiment. Refusé si occupé (un avion y est attaché) ou si un service
// en dépend — le brief exige un comportement lisible + testé.
export function demolishBuilding(sim, id) {
  const find = (arr) => arr.find((b) => b.id === id);
  const b = find(sim.infra.runways) || find(sim.infra.taxiways) || find(sim.infra.terminals) || find(sim.infra.services);
  if (!b) return { ok: false, why: 'inconnu' };
  // Un terminal a des portes : refusé si UNE de ses portes est occupée
  // (R3, A6 : le test regardait la première porte seulement — un terminal
  // multi-portes avec la 2e occupée passait le test et était détruit).
  if (b.type === 'terminal') {
    if (sim.infra.gates.some((g) => g.terminalId === id && g.acId)) {
      return { ok: false, why: 'porte occupée' };
    }
    sim.infra.gates = sim.infra.gates.filter((g) => g.terminalId !== id);
    // les avions en attente d'une porte de ce terminal retournent en holding
    for (const ac of sim.aircraft) if (ac.gateId && ac.gateId.startsWith(`${id}-`)) ac.gateId = null;
  }
  if (b.type === 'runway' && sim.aircraft.some((a) => a.runwayId === id)) {
    return { ok: false, why: 'piste en service' };
  }
  // (R3, A7) Un avion dont le chemin PASSE PAR (ou EST SUR) le segment détruit
  // aurait un chemin périmé (indices dans l'ancien graphe, nœuds supprimés) →
  // exception au prochain tick. On remet son chemin à zéro (voir plus bas : le
  // rebuild éager le recalcule, ou le bloque proprement).
  const refund = Math.round(b.cost * BUILDINGS[b.type].sellRefund);
  sim.economy.money += refund;
  sim.economy.revenue[b.type] = (sim.economy.revenue[b.type] ?? 0) + refund;
  sim.infra.runways = sim.infra.runways.filter((x) => x.id !== id);
  sim.infra.taxiways = sim.infra.taxiways.filter((x) => x.id !== id);
  sim.infra.terminals = sim.infra.terminals.filter((x) => x.id !== id);
  // R27 (t_6424937a) : terminal supprimé → les services auto qui le servaient
  // sont RÉAFFECTÉS au terminal le plus proche RESTANT (ou inactifs s'il n'en
  // reste aucun) — motif lisible, jamais d'orphelin en silence.
  ensureAssignments(sim);
  sim.infra.services = sim.infra.services.filter((x) => x.id !== id);
  buildGrid(sim);
  // R03 (t_9dab76f4) : une démolition qui touche le graphe (segment/terminal)
  // DÉCALE les indices des nœuds — les chemins en cours pointent dans l'ANCIEN
  // graphe. On reconstruit le graphe MAINTENANT (éager, pas en différé) : le
  // recalcul (ou le blocage propre) des chemins se fait dans rebuildGraph
  // (path.mjs) → plus de chemin périmé persisté ni d'exception au prochain tick.
  if (b.type === 'taxiway' || b.type === 'runway' || b.type === 'terminal') {
    rebuildGraph(sim);
    sim._graphDirty = false;
  }
  pushEvent(sim, { kind: 'demolished', type: b.type, id, refund });
  return { ok: true, refund };
}

// R05 (t_482d879d) : les CRITÈRES de piste/port sont CENTRALISÉS ici — la
// compatibilité (piste assez longue, porte de la bonne taille), l'occupation
// (piste/porte libre), l'ordre STABLE en égalités et le choix sont UN seul
// endroit : aircraft.mjs (atterrissage) ET flights.mjs (planification) en
// redirent la logique. Avant R05, « 1re piste compatible toujours choisie » :
// runwayFor (aircraft.mjs) ignorait l'occupation — la 2e piste libre n'était
// jamais choisie.
//
// Ordre STABLE et DÉTERMINISTE : tri sur (longueur, id). Les ids sont des
// nombres croissants (infra.nextId) → en égalité de longueur le plus ancien
// gagne, SANS dépendre de l'ordre d'insertion du tableau (Array.prototype.sort
// n'est pas stable en Node < 12 ; ici le comparateur total le rend certain).
// ponytail : l'ordre « libres en tête, puis (longueur, id) » COUVRE l'ordre
// stable en égalités demandé (l'id est le tiebreak total) — la sonde de test
// (tests/r05-runway.test.mjs) vérifie le GAIN de la 2e piste : quand la 1re
// est occupée, la 2e libre est bien choisie (et non la 1re, comme avant R05).

// Piste occupée par un AUTRE avion (AC15, A4) : atterrissage/décollage/sortie
// exclusifs sur une même piste. Deux demandes au même tick ne partagent pas la
// piste. Le cas est DÉRIVÉ des phases — aucun champ dédié (l'occupation est la
// phase). R05 : UNIQUE règle d'occupation (aircraft + les sélecteurs ci-dessous
// la partagent — la centralisation que R05 exige, au lieu d'en redire la
// logique partout).
export function runwayBusy(sim, runwayId, excludeAcId) {
  return sim.aircraft.some((a) => a.id !== excludeAcId && a.runwayId === runwayId
    && ['landing', 'exit', 'departure'].includes(a.phase));
}

// Piste LIBRE pour un avion : aucune AUTRE avion ne l'occupe (A4 : exclusif).
function runwayFree(sim, rw, excludeAcId) {
  return !runwayBusy(sim, rw.id, excludeAcId);
}

// Toutes les pistes COMPATIBLES (longueur ≥ minRunway), ordonnées DETERMINISTEMENT :
// 1) libres en tête — une piste LIBRE avant une piste occupée (la règle R05
//    : la 2e piste libre est choisie si la 1re est occupée) ;
// 2) longueur croissante (la plus courte qui suffit — critère historique) ;
// 3) id croissant (égalité de longueur : le plus ancien, déterministe).
export function runwayCandidates(sim, minRunway, excludeAcId = null) {
  const ok = sim.infra.runways.filter((r) => r.len >= minRunway);
  return ok.sort((a, b) =>
    (runwayFree(sim, b, excludeAcId) - runwayFree(sim, a, excludeAcId))
    || (a.len - b.len)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Le CHOIX d'atterrissage (R05) : la MEILLEURE piste compatible ET LIBRE, ou
// null si toutes sont occupées. Le « d'abord la piste libre » est VÉRIFIÉ par
// la sonde de test (tests/r05-runway.test.mjs), pas par un re-calage du trafic.
export function pickRunway(sim, minRunway, excludeAcId = null) {
  const cands = runwayCandidates(sim, minRunway, excludeAcId);
  return cands.length && runwayFree(sim, cands[0], excludeAcId) ? cands[0] : null;
}

// Piste compatible pour un avion : la plus courte piste qui dépasse sa longueur
// min (critère de COMPATIBILITÉ seul, SANS regard à l'occupation — le choix
// d'atterrissage est pickRunway ci-dessus).
export function runwayFor(sim, minLen) {
  return runwayCandidates(sim, minLen)[0] || null;
}

// Porte JOIGNABLE au réseau : son nœud de porte EXISTE (un segment la touche)
// ET au moins UNE sortie de piste est atteignable — le MÊME critère que
// flights.hasAccessiblePath (primitives pathfinding réutilisées, pas de 2e règle).
// R18 : exporté — l'overlay réseau (ui/overlay.mjs) le réutilise tel quel :
// le diagnostic écran = le MÊME graphe et la MÊME règle que la sim.
export function gateReachable(sim, gate) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  if (!sim._graph) return false;
  const to = gateNodeOf(sim, gate.id);
  if (to == null) return false; // porte hors réseau (aucun taxiway ne la touche)
  const occupied = new Set(); // « joignable » = sans conflit d'occupation
  for (const r of sim.infra.runways) {
    const from = runwayExitNode(sim, r.id);
    if (from == null) continue;
    if (findPath(sim, from, to, occupied)) return true;
  }
  return false;
}
// ponytail : gateReachable fait un findPath par piste par porte candidate (graphe
// minuscule) — OK tant que le joueur ne construit pas ~100 terminaux ; si ça
// ralentit, un cache de l'ensemble « portes joignables » par (re)buildGraph.

// Porte compatible : une porte de la bonne taille, libre, dont le terminal est intact.
// ORDRE STABLE ET DÉTERMINISTE :
// 1) une porte JOIGNABLE au réseau (taxiway) AVANT une porte déconnectée —
//    la validation R05 : « 1re porte compatible déconnectée, autre porte libre
//    connectée : choisir l'autre » (l'avion bloqué sans réseau = retard purement
//    artificiel, A1) ;
// 2) usure (cleaning+maintenance) croissante — la porte la plus propre ;
// 3) id croissant (terminalId puis index) — en égalité, le plus ANCIEN.
// La porte LIBRE (acId null ou réservée par l'avion exclu) est un pré-filtre :
// une porte réservée par UN AUTRE avion est sautée (A5).
export function gateFor(sim, size, excludeAcId) {
  const free = sim.infra.gates.filter((g) => g.size === size && (!g.acId || g.acId === excludeAcId));
  if (!free.length) return null;
  free.sort((a, b) =>
    (Number(gateReachable(sim, b)) - Number(gateReachable(sim, a)))
    || ((a.cleaning + a.maintenance) - (b.cleaning + b.maintenance))
    || (a.terminalId - b.terminalId || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return free[0];
}

// t_2179387d : DEUX usures de porte, DEUX services qui les nettoient (critère 85) —
//   - g.cleaning (« sale ») : nettoyée par l'ÉQUIPE NETTOYAGE (bâtiment « cleaning ») ;
//   - g.maintenance (« mécanique ») : nettoyée par le HANGAR (bâtiment « hangar »).
// R27 (t_6424937a) : l'effet est MESURÉ par terminal (assignments.mjs) — un service
// affecté au terminal A ne nettoie que les portes de A (débit = taux × nb services
// DU TERMINAL × dt) ; chaque bâtiment coûte (opex) ET sert (effet mesurable).
export function cleanGates(sim, dt) {
  // R27 (t_6424937a) : nettoyage HANGAR + CLEANING par terminal — les services
  // servent UNIQUEMENT les portes de leur terminal (servicesServingGate).
  for (const g of sim.infra.gates) {
    const cleanings = servicesServingGate(sim, 'cleaning', g).length;
    const hangars = servicesServingGate(sim, 'hangar', g).length;
    if (cleanings) g.cleaning = Math.max(0, g.cleaning - CLEANING_RATE_PER_SEC * cleanings * dt);
    if (hangars) g.maintenance = Math.max(0, g.maintenance - HANGAR_CLEAN_PER_SEC * hangars * dt);
  }
}

// Est-ce qu'un bâtiment de type `need` existe (débloqué + construit) ?
export function hasService(sim, type) {
  return sim.infra.services.some((s) => s.type === type);
}
