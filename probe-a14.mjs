// Sonde A14 (reproductible) : « 3 arrivées → 3 départs ».
// Reproduit la boucle EXACTE du test (tickAircraft/écon/passagers SANS tickPlanner
// → les avions « departed » persistent dans sim.aircraft) et compte par
// IDENTIFIANT distinct (Set), comme le veut BL-10. Avant la correction, le test
// incrémentait à chaque tick où un avion restait « departed » → compteur faussé
// (A14). Après : 3 identifiants distincts + jamais 2 avions sur une même porte.
// Usage : node probe-a14.mjs
import { newSimState } from './src/core/sim-state.mjs';
import { buildBuilding } from './src/infra/infra.mjs';
import { tickAircraft } from './src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from './src/economy/economy.mjs';
import { rebuildGraph } from './src/pathfinding/path.mjs';

function buildAirport(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}

const sim = newSimState();
buildAirport(sim);
const mk = (n) => sim.aircraft.push({
  id: sim.nextAcId++, airline: 'solaire', color: '#f0a', acType: 'small', pax: 5,
  phase: 'approach', x: 200 + n * 100, y: -150, gateId: null, runwayId: null,
  delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
});
mk(1); mk(2); mk(3);

const departed = new Set();      // A14 : IDENTIFIANTS distincts (pas un compteur par tick)
let maxGateOccupancy = 0;       // invariant post-tick : jamais 2 avions sur une porte
for (let i = 0; i < 8000; i++) {
  tickAircraft(sim, 0.1); tickEconomy(sim, 0.1); tickPassengers(sim, 0.1);
  for (const a of sim.aircraft) {
    if (a.phase === 'departed') departed.add(a.id);
    if (a.gateId && a.phase !== 'departed') {
      // occupation porte : on compte les avions ACTUellement amarrés
    }
  }
  const gates = {};
  for (const a of sim.aircraft) if (a.gateId && a.phase !== 'departed' && a.phase !== 'cancelled') gates[a.gateId] = (gates[a.gateId] ?? 0) + 1;
  for (const v of Object.values(gates)) maxGateOccupancy = Math.max(maxGateOccupancy, v);
  if (departed.size >= 3) break;
}

const ok = departed.size === 3 && maxGateOccupancy <= 1;
console.log(JSON.stringify({
  probe: 'A14',
  distinct_departed: departed.size,
  departed_ids: [...departed],
  max_gate_occupancy: maxGateOccupancy,
  aircraft_now: sim.aircraft.map((a) => a.phase),
  confirmed: !ok,
}, null, 2));
process.exitCode = ok ? 0 : 1;
