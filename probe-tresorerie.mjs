// Vérifie l'invariant TRÉSORERIE (EV-9) sur un cycle multi-vols identique à
// invariants.test.mjs : à CHAQUE tick, money = START_FUNDS + Σrevenue − Σspent − debt.
// Sert à valider avant de l'intégrer au test. Si l'identité casse quelque part,
// on verra le tick exact. Usage : node probe-tresorerie.mjs
import { newSimState } from './src/core/sim-state.mjs';
import { buildBuilding } from './src/infra/infra.mjs';
import { tickAircraft } from './src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from './src/economy/economy.mjs';
import { tickPlanner } from './src/flights/flights.mjs';
import { rebuildGraph } from './src/pathfinding/path.mjs';
import { START_FUNDS } from './src/core/sim-state.mjs';

function ac(id, o = {}) {
  return { id, airline: 'solaire', acType: 'small', pax: 5, phase: 'approach',
    x: 200, y: -150, gateId: null, runwayId: null, delayed: 0, timer: 0,
    path: null, pathPtr: 0, seg: null, heading: 'gate', ...o };
}
function airport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim); sim._graphDirty = false;
  return sim;
}
function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }

const sim = airport();
for (let n = 1; n <= 3; n++) sim.aircraft.push(ac(n, { x: 200 + n * 100, y: -150 }));
sim.nextAcId = 4;
let minDiff = Infinity, maxDiff = -Infinity, badTick = null;
for (let i = 0; i < 20000; i++) {
  tickAircraft(sim, 0.1);
  for (const a of sim.aircraft) if (a.phase === 'departed') {} // purge via planner
  tickEconomy(sim, 0.1);
  tickPassengers(sim, 0.1);
  tickPlanner(sim, 0.1, () => 0.5);
  // identité trésorerie après tick :
  const left = sim.economy.money;
  const right = START_FUNDS + sum(sim.economy.revenue) - sum(sim.economy.spent) - sim.economy.debt;
  const diff = Math.abs(left - right);
  if (diff > 1e-6) { if (badTick == null) badTick = i; }
  if (diff < minDiff) minDiff = diff;
  if (diff > maxDiff) maxDiff = diff;
}
console.log(JSON.stringify({
  probe: 'tresorerie',
  identity: 'money == START_FUNDS + sum(revenue) - sum(spent) - debt',
  max_abs_diff_over_20000_ticks: maxDiff,
  first_bad_tick: badTick,
  money_end: sim.economy.money,
  revenue: sum(sim.economy.revenue),
  spent: sum(sim.economy.spent),
  debt: sim.economy.debt,
  confirmed_ok: maxDiff < 1e-6,
}, null, 2));
process.exitCode = maxDiff < 1e-6 ? 0 : 1;
