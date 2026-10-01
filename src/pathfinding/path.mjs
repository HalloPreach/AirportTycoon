// Pathfinding taxiway : graphe des segments (taxiways + pistes) + A* avec occupation.
// Logique pure. Le graphe est reconstruit à chaque changement d'infra (build/demolish)
// par infra.buildGrid → on le cache ici sur sim._graph.
//
// Modèle : chaque segment (taxiway, piste) donne 2 nœuds (extrémités de sa tranche
// courte) ; deux nœuds sont reliés si les deux segments sont proches. Un avion roule
// le long du chemin nœud par nœud ; une arête « occupée » = un autre avion dessus.
import { AIRCRAFT } from '../data/catalog.mjs';

const NODE_DIST = 320; // deux nœuds de segments différents se relient à moins de ça

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
  // 2) Inter-segment : deux nœuds de segments DIFFÉRENTS proches = jonction.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].seg === nodes[j].seg) continue;
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < NODE_DIST) {
        edges.get(i).push({ to: j, cost: d });
        edges.get(j).push({ to: i, cost: d });
      }
    }
  }
  // Nœuds portes : une porte se rattache au nœud de segment le plus proche.
  // On relie le CENTRE de la porte (pas le coin), sinon l'avion ne « touche » jamais la porte.
  const gateNode = new Map();
  for (const g of sim.infra.gates) {
    const gx = g.x + g.w / 2, gy = g.y + g.h / 2;
    let best = -1, bd = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - gx, n.y - gy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) gateNode.set(g.id, best);
  }
  sim._graph = { nodes, edges, gateNode };
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

// Le plus proche nœud de porte (ou null si la porte n'est pas reliée au réseau).
export function gateNodeOf(sim, gateId) {
  return sim._graph ? sim._graph.gateNode.get(gateId) : undefined;
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
