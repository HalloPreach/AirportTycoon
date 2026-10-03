// Pathfinding taxiway : graphe des segments (taxiways + pistes) + A* avec occupation.
// Logique pure. Le graphe est reconstruit à chaque changement d'infra (build/demolish)
// par infra.buildGrid → on le cache ici sur sim._graph.
//
// Modèle : chaque segment (taxiway, piste) donne 2 nœuds (extrémités de sa tranche
// courte) ; deux nœuds sont reliés si les deux segments se TOUCHENT (taxiway
// construit, marge JOINT_MARGIN). Un avion roule le long du chemin nœud par nœud ;
// une arête « occupée » = un autre avion dessus.
import { AIRCRAFT } from '../data/catalog.mjs';

// Tolérance de jonction (px) : deux segments ne se lient que s'ils se TOUCHENT
// physiquement (taxiway/piste construits, pas de « proximité » dans l'espace).
// ponytail : marge fixe 20 px = le seuil de jonction d'angle ; pas de grille spatiale.
const JOINT_MARGIN = 20;

// (re)construit le graphe ; appelé par infra.buildGrid.
export function rebuildGraph(sim) {
  const segs = [...sim.infra.taxiways, ...sim.infra.runways];
  const nodes = [];
  const add = (seg) => {
    if (seg.type === 'runway') {
      // La piste se traverse verticalement (atterrissage/depart) : nœuds haut + bas du centre.
      const cx = seg.x + seg.w / 2;
      nodes.push({ x: cx, y: seg.y, seg: seg.id });
      nodes.push({ x: cx, y: seg.y + seg.h, seg: seg.id });
    } else if (seg.w >= seg.h) {
      // taxiway horizontal : bouts gauche/droite
      nodes.push({ x: seg.x, y: seg.y + seg.h / 2, seg: seg.id });
      nodes.push({ x: seg.x + seg.w, y: seg.y + seg.h / 2, seg: seg.id });
    } else {
      // taxiway vertical : bouts haut/bas
      nodes.push({ x: seg.x + seg.w / 2, y: seg.y, seg: seg.id });
      nodes.push({ x: seg.x + seg.w / 2, y: seg.y + seg.h, seg: seg.id });
    }
  };
  segs.forEach(add);
  const edges = new Map(); // nIdx → [{to, cost}]
  nodes.forEach((n, i) => edges.set(i, []));
  // 1) Intra-segment : on relie les 2 bouts d'UN segment (la longueur du segment).
  //    Sans ça, un avion ne pourrait jamais rouler d'un bout à l'autre d'un segment.
  const bySeg = new Map();
  nodes.forEach((n, i) => {
    if (!bySeg.has(n.seg)) bySeg.set(n.seg, []);
    bySeg.get(n.seg).push(i);
  });
  for (const idxs of bySeg.values()) {
    if (idxs.length !== 2) continue;
    const [a, b] = idxs;
    const cost = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    edges.get(a).push({ to: b, cost });
    edges.get(b).push({ to: a, cost });
  }
  // 2) Inter-segment : jonction UNIQUEMENT si les deux segments se TOUCHENT
  //    (rects qui s'overlapent ou se touchent à JOINT_MARGIN près) : un taxiway
  //    CONSTRUIT relie les segments, pas la « proximité » dans l'espace.
  //    Deux nœuds d'extrémités reliés entre eux ; le coupage d'un segment supprime
  //    ses 2 nœuds et ses arêtes → blocage réel, pas de chemin résiduel.
  const touch = (a, b) =>
    a.x - JOINT_MARGIN <= b.x + b.w && b.x - JOINT_MARGIN <= a.x + a.w &&
    a.y - JOINT_MARGIN <= b.y + b.h && b.y - JOINT_MARGIN <= a.y + a.h;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].seg === nodes[j].seg) continue;
      const si = segs.find((s) => s.id === nodes[i].seg);
      const sj = segs.find((s) => s.id === nodes[j].seg);
      if (!touch(si, sj)) continue;
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      edges.get(i).push({ to: j, cost: d });
      edges.get(j).push({ to: i, cost: d });
    }
  }
  // Nœuds portes : une porte se rattache au nœud du segment qu'elle JOIGNT
  // (le rect de la porte touche le rect du segment) — pas à « la cible la plus
  // proche » dans l'espace. Pas de segment touchant → porte HORS réseau (findPath
  // ne doit JAMAIS renvoyer un chemin vers elle : le joueur n'a pas construit de
  // taxiway, l'avion ne peut pas y rouler).
  const gateNode = new Map();
  for (const g of sim.infra.gates) {
    const touching = segs.filter((s) => touch(g, s));
    if (!touching.length) continue;
    let best = -1, bd = Infinity;
    nodes.forEach((n, i) => {
      if (!touching.some((s) => s.id === n.seg)) return; // nœud d'un segment qui touche la porte
      const gx = g.x + g.w / 2, gy = g.y + g.h / 2; // centre de la porte
      const d = Math.hypot(n.x - gx, n.y - gy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) gateNode.set(g.id, best);
  }
  sim._graph = { nodes, edges, gateNode };
  // R03 : le rebuild change les indices des nœuds — les chemins EN COURS
  // (ac.path) pointent dans l'ANCIEN graphe. On les recalcule tous depuis la
  // position ACTUELLE de chaque avion (nœud le plus proche), en gardant sa
  // destination (heading 'gate' → sa porte, sinon → la sortie de piste) :
  // jamais d'exception ni de téléportation. Pas de chemin possible → « blocked »
  // (retry borné + annulation A-5 à 10 min sim). Le segment où l'avion EST ne
  // compte PAS comme occupé pour LUI (il l'a réservé via ac.seg) : l'occupation
  // sert à ne pas ENTRER dans le segment d'UN AUTRE avion.
  const occupied = new Set();
  for (const a of sim.aircraft) if (a.seg != null) occupied.add(a.seg);
  // Segments qui EXISTENT encore dans le graphe neuf : un avion dont le segment
  // actuel vient d'être DÉMOLI (A7) est en dehors du réseau — on ne peut PAS le
  // re-ancrer (ce serait une téléportation sur un autre nœud) : on le bloque
  // sur place. Un avion dont le segment existe (scénarios R03 a/b/d) est
  // recollé au nœud le plus proche et son chemin recalculé.
  const liveSegs = new Set(nodes.map((n) => n.seg));
  for (const ac of sim.aircraft) {
    if (!ac.path) continue;
    // Phases au SOL (docking/gate/refuel/ops/pushback) : l'avion est amarré à la
    // porte (seg=null) — il n'UTILISE PAS de chemin (doRefuel/doPushback décident),
    // donc le re-ancrage ne le concerne PAS. R23 (t_c992b7d6) : avant la fix, un
    // avion EN PLEIN (phase refuel) gardait le chemin D'ARRIVÉE résiduel
    // (doTaxi ne le vide qu'à la mise en docking) → le rebuild le passait en
    // « blocked » SANS libérer sa lance → _refueling=true hors refuel (fuite
    // R08, G1). Les phases sol ne sont jamais re-ancrées.
    const GROUND = new Set(['docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback']);
    if (GROUND.has(ac.phase)) { ac.path = null; continue; } // chemin résiduel : inutile au sol
    // Segment actuel démolit → avion en dehors du réseau : blocage propre.
    if (ac.seg == null || !liveSegs.has(ac.seg)) {
      ac.path = null; ac.seg = null; ac.phase = 'blocked'; ac.timer = 0;
      continue;
    }
    const from = nearestNode(sim, ac.x, ac.y);
    const to = ac.heading === 'gate' ? gateNodeOf(sim, ac.gateId) : runwayExitNode(sim, ac.runwayId);
    const occ = new Set([...occupied].filter((s) => s !== ac.seg));
    const path = from == null || to == null ? null : findPath(sim, from, to, occ);
    // from === to (l'avion est DÉJÀ au nœud de destination) : chemin d'un nœud
    // → doTaxi aboutit immédiatement (docking/départ), ce n'est PAS un blocage.
    if (path == null || (path.length < 2 && from !== to)) {
      ac.path = null; ac.seg = null; ac.phase = 'blocked'; ac.timer = 0;
      continue;
    }
    ac.path = path; ac.pathPtr = 0;
    ac.seg = nodes[path[0]].seg;
    if (ac.seg != null) occupied.add(ac.seg);
  }
}

// Chemin entre deux nœuds, évitant les segments occupés (occupied = Set d'ids de segments).
// Retourne un tableau d'indices de nœuds, ou null si aucun chemin (critère « taxiway coupé »).
export function findPath(sim, fromNode, toNode, occupied) {
  const { nodes, edges } = sim._graph;
  if (fromNode == null || toNode == null) return null;
  // A* heuristique euclidienne. ponytail : pile de listes, pas de binaire ; le graphe est minuscule.
  const open = [{ i: fromNode, g: 0, f: h(sim, fromNode, toNode) }];
  const gScore = new Map([[fromNode, 0]]);
  const came = new Map();
  const closed = new Set();
  const segsOf = (idx) => nodes[idx].seg;
  while (open.length) {
    // extraction du meilleur f (graphe petit : scan linéaire, pas de tas binaire)
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur.i === toNode) {
      const path = [toNode];
      while (came.has(path[0])) path.unshift(came.get(path[0]));
      return path;
    }
    if (closed.has(cur.i)) continue;
    closed.add(cur.i);
    for (const e of edges.get(cur.i)) {
      // arête occupée : le segment d'arrivée est pris par un autre avion
      if (occupied.has(segsOf(e.to))) continue;
      const ng = cur.g + e.cost;
      if (ng < (gScore.get(e.to) ?? Infinity)) {
        gScore.set(e.to, ng);
        came.set(e.to, cur.i);
        open.push({ i: e.to, g: ng, f: ng + h(sim, e.to, toNode) });
      }
    }
  }
  return null;
}

function h(sim, a, b) {
  const n = sim._graph.nodes;
  return Math.hypot(n[a].x - n[b].x, n[a].y - n[b].y); // heuristique euclidienne admissible
}

// Nœud de porte (ou undefined si la porte est hors réseau : aucun segment ne la touche).
export function gateNodeOf(sim, gateId) {
  return sim._graph ? sim._graph.gateNode.get(gateId) : undefined;
}

// Nœud le plus proche d'une position monde (x, y) — R03 : sert de point de
// départ « recollé au réseau » quand un graphe est reconstruit pendant qu'un
// avion roule (sa position monde est la vérité, pas l'ancien chemin).
// ponytail : scan linéaire des nœuds (graphe minuscule, cf. A* ci-dessus).
export function nearestNode(sim, x, y) {
  if (!sim._graph || !sim._graph.nodes.length) return null;
  let best = -1, bd = Infinity;
  sim._graph.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) { bd = d; best = i; }
  });
  return best >= 0 ? best : null;
}

// Nœud de départ d'un taxi : l'extrémité de piste du côté de l'aviation (bas de la piste).
export function runwayExitNode(sim, runwayId) {
  const rw = sim.infra.runways.find((r) => r.id === runwayId);
  if (!rw || !sim._graph) return null;
  const { nodes } = sim._graph;
  // les 2 nœuds de cette piste : on prend celui du bas (y max) = sortie après atterrissage
  let best = -1, by = -Infinity;
  nodes.forEach((n, i) => {
    if (n.seg === runwayId && n.y > by) { by = n.y; best = i; }
  });
  return best >= 0 ? best : null;
}
