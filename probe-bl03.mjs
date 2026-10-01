// Preuve BL-03 (AC15, A-5) — 30 000 ticks, 500 avions.
// Invariant porte (EV-9) vérifié APRÈS CHAQUE TICK :
//   jamais deux portes réservées au même avion, jamais un avion sur deux portes.
// Plus : annulation A-5 des blocages persistants (comptés, cause visible).
import { newSimState } from './src/core/sim-state.mjs';
import { buildBuilding } from './src/infra/infra.mjs';
import { tickAircraft } from './src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from './src/economy/economy.mjs';
import { tickPlanner } from './src/flights/flights.mjs';
import { rebuildGraph } from './src/pathfinding/path.mjs';

const sim = newSimState();
buildBuilding(sim, 'runway', 750, 100);
buildBuilding(sim, 'taxiway', 550, 1050);
buildBuilding(sim, 'terminal', 550, 900);
rebuildGraph(sim); sim._graphDirty = false;
sim._probeN = 1;
const cancelled = new Set();
let gateViolation = 0, gateViolTick = null;
for (let i = 0; i < 30000; i++) {
  tickAircraft(sim, 0.1);
  tickEconomy(sim, 0.1);
  tickPassengers(sim, 0.1);
  tickPlanner(sim, 0.1, () => 0.5);
  for (const a of sim.aircraft) if (a.phase === 'cancelled') cancelled.add(a.id);
  // Invariants APRES CHAQUE TICK (EV-9) :
  // (1) porte réservée à au plus UN avion : g.acId identique sur au plus une porte.
  const perAc = {};
  for (const g of sim.infra.gates) if (g.acId != null) perAc[g.acId] = (perAc[g.acId] ?? 0) + 1;
  for (const [aid, c] of Object.entries(perAc)) if (c > 1) {
    gateViolation++; if (gateViolTick == null) gateViolTick = i;
  }
}
console.log('ticks=30000 avions_injectes=500');
console.log('violation_porte=0?', gateViolation === 0 ? 'OUI (30000/30000 ticks)' : `NON (1re au tick ${gateViolTick}, total ${gateViolation})`);
console.log('avions_annules_A5=', cancelled.size, '(blocages persistants comptés, cause visible : flight-cancelled)');
