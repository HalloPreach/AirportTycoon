// Sonde BL-04 (A8, R3) : deserialize → avion en taxi (path non nulle) →
// démolition d'un taxiway occupé → exception « reading 'nodes' » attendue
// AVANT correction.
import { serialize, deserialize } from './src/persistence/save.mjs';
import { newSimState, START_FUNDS } from './src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding } from './src/infra/infra.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from './src/pathfinding/path.mjs';

const sim = newSimState();
buildBuilding(sim, 'runway', 750, 100);
buildBuilding(sim, 'taxiway', 550, 1050);
buildBuilding(sim, 'terminal', 550, 900);
rebuildGraph(sim); sim._graphDirty = false;

// Un avion EN TAXI sur le taxiway (comme au chargement d'une partie sauvegardée).
const rw = sim.infra.runways[0];
const g = sim.infra.gates[0];
const path = findPath(sim, runwayExitNode(sim, rw.id), gateNodeOf(sim, g.id), new Set());
const node = sim._graph.nodes[path[0]];
sim.aircraft = [{ id: 1, airline: 'solaire', acType: 'small', pax: 5, phase: 'taxi',
  x: node.x, y: node.y, gateId: g.id, runwayId: rw.id,
  path: [...path], pathPtr: 0, seg: node.seg, heading: 'gate',
  delayed: 0, timer: 0 }];

// Simule la sauvegarde + rechargement (deserialize remet _graph = null, dirty=true).
const state = { screen: 'game', time: 1, terrain: { w: 1600, h: 1200 },
  camera: { x: 0, y: 0, zoom: 1 }, sim };
const back = deserialize(serialize(state));
console.log('_graph après deserialize :', back.sim._graph,
  '| avion path :', JSON.stringify(back.sim.aircraft[0].path));

try {
  const r = demolishBuilding(back.sim, back.sim.infra.taxiways[0].id);
  console.log('OK — pas de crash. résultat :', JSON.stringify(r));
} catch (e) {
  console.log('CRASH :', e.message);
}
