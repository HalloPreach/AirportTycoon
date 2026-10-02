// Infrastructures : pistes, taxiways, terminaux/portes, services.
// Logique pure (testable Node) : elle mutera state.sim.infra.
// Grille d'occupation 10×10 px : un segment de 200 px = 20 cellules, ça suffit
// pour « est-ce que ça empiète sur autre chose ? » et « est-ce qu'un avion peut
// poser/rouler ici ». ponytail : grille carrée simple, pas d'arborescence spatiale.
import { BUILDINGS, UNLOCKS, TERMINAL_GATE_SIZES, HANGAR_CLEAN_PER_SEC } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { rebuildGraph } from '../pathfinding/path.mjs';

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

// Progression (critère 9) : les seuils de débloquement sont dans UNLOCKS (catalog).
// Types absents de UNLOCKS (piste, taxiway, terminal) = toujours constructibles.

// Vérifie les seuils à chaque tick ; émet une alerte lisible par service débloqué.
export function tickUnlocks(sim) {
  if (!sim._unlocked) sim._unlocked = {};
  for (const u of UNLOCKS) {
    if (u.service === 'base') continue; // le socle est toujours là
    if (!sim._unlocked[u.service] && sim.passengers.totalCarried >= u.at) {
      sim._unlocked[u.service] = true;
      pushEvent(sim, { kind: 'unlocked', service: u.service, name: u.name });
    }
  }
}

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
  // Service pas encore débloqué (seuil de passagers, critère 9) → refus lisible.
  const gate = UNLOCKS.find((u) => u.service === type);
  if (gate && sim.passengers.totalCarried < gate.at) {
    pushEvent(sim, { kind: 'locked', type, name: spec.name, need: gate.at });
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
  // exception au prochain tick. On remet à zéro AVANT le rebuild (il faut
  // l'ancien graphe pour repérer les nœuds du segment détruit) : au prochain
  // tick l'avion passe en « blocked » et retente un nouveau chemin (retry
  // équitable, annulation si blocage persistant) — plus d'exception.
  if (b.type === 'taxiway' || b.type === 'runway') {
    // (R3, A8) Après un rechargement, le graphe (cache dérivé) est null tant
    // que le 1er tick n'a pas fait le rebuild : on le reconstruit ici avant de
    // lire les nœuds — sinon `sim._graph.nodes` crashait (reading 'nodes').
    if (!sim._graph) rebuildGraph(sim);
    const onDead = (i) => sim._graph.nodes[i] && sim._graph.nodes[i].seg === id;
    for (const ac of sim.aircraft) {
      if (ac.path && ac.path.some(onDead)) { ac.path = null; ac.seg = null; }
    }
  }
  const refund = Math.round(b.cost * BUILDINGS[b.type].sellRefund);
  sim.economy.money += refund;
  sim.economy.revenue[b.type] = (sim.economy.revenue[b.type] ?? 0) + refund;
  sim.infra.runways = sim.infra.runways.filter((x) => x.id !== id);
  sim.infra.taxiways = sim.infra.taxiways.filter((x) => x.id !== id);
  sim.infra.terminals = sim.infra.terminals.filter((x) => x.id !== id);
  sim.infra.services = sim.infra.services.filter((x) => x.id !== id);
  buildGrid(sim);
  sim._graphDirty = true;
  pushEvent(sim, { kind: 'demolished', type: b.type, id, refund });
  return { ok: true, refund };
}

// Piste compatible pour un avion : la plus courte piste qui dépasse sa longueur min.
export function runwayFor(sim, minLen) {
  const rws = sim.infra.runways.filter((r) => r.len >= minLen);
  if (!rws.length) return null;
  rws.sort((a, b) => a.len - b.len);
  return rws[0];
}

// Porte compatible : une porte de la bonne taille, libre, dont le terminal est intact.
export function gateFor(sim, size, excludeAcId) {
  const free = sim.infra.gates.filter((g) => g.size === size && (!g.acId || g.acId === excludeAcId));
  if (!free.length) return null;
  // préférer une porte dont le nettoyage/maintenance est à jour
  free.sort((a, b) => (a.cleaning + a.maintenance) - (b.cleaning + b.maintenance));
  return free[0];
}

// BL-12 : le hangar (maintenance) NETTOIE les portes : c'est l'unique service qui
// ramène g.cleaning/g.maintenance vers 0 — sans lui les portes s'usent (délai
// ground croissant) et le hangar serait un bâtiment coûtant SANS servir (critère).
// Chaque hangar active HANGAR_CLEAN_PER_SEC de nettoyage/seconde sur TOUTES les
// portes (ponytail : pas de zone d'effet, le hangar sert tout l'aéroport).
export function cleanGates(sim, dt) {
  const hangars = sim.infra.services.filter((s) => s.type === 'hangar').length;
  if (!hangars) return;
  const clean = HANGAR_CLEAN_PER_SEC * hangars * dt;
  for (const g of sim.infra.gates) {
    g.cleaning = Math.max(0, g.cleaning - clean);
    g.maintenance = Math.max(0, g.maintenance - clean);
  }
}

// Est-ce qu'un bâtiment de type `need` existe (débloqué + construit) ?
export function hasService(sim, type) {
  return sim.infra.services.some((s) => s.type === type);
}
