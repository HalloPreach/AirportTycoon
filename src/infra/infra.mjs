// Infrastructures : pistes, taxiways, terminaux/portes, services.
// Logique pure (testable Node) : elle mutera state.sim.infra.
// Grille d'occupation 10×10 px : un segment de 200 px = 20 cellules, ça suffit
// pour « est-ce que ça empiète sur autre chose ? » et « est-ce qu'un avion peut
// poser/rouler ici ». ponytail : grille carrée simple, pas d'arborescence spatiale.
import { BUILDINGS, UNLOCKS } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';

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
  sim.economy.spent[type] = (sim.economy.spent[type] ?? 0) + spec.cost;
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
export function placeBuilding(sim, b, gateSizes = ['S', 'M', 'M', 'S']) {
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
  // Un terminal a des portes : refusé si une porte est occupée.
  if (b.type === 'terminal') {
    const g = sim.infra.gates.find((g) => g.terminalId === id);
    if (g && g.acId) return { ok: false, why: 'porte occupée' };
    sim.infra.gates = sim.infra.gates.filter((g) => g.terminalId !== id);
    // les avions en attente d'une porte de ce terminal retournent en holding
    for (const ac of sim.aircraft) if (ac.gateId && ac.gateId.startsWith(`${id}-`)) ac.gateId = null;
  }
  if (b.type === 'runway' && sim.aircraft.some((a) => a.runwayId === id)) {
    return { ok: false, why: 'piste en service' };
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

// Est-ce qu'un bâtiment de type `need` existe (débloqué + construit) ?
export function hasService(sim, type) {
  return sim.infra.services.some((s) => s.type === type);
}
