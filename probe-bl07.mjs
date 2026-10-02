import { newSimState } from './src/core/sim-state.mjs';
import { buildBuilding } from './src/infra/infra.mjs';
import { tickAircraft } from './src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers, periodStatement } from './src/economy/economy.mjs';
import { tickPlanner } from './src/flights/flights.mjs';
import { rebuildGraph } from './src/pathfinding/path.mjs';
function rng(seed){return function(){seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const sim = newSimState();
rebuildGraph(sim);
buildBuilding(sim,'runway',750,100);buildBuilding(sim,'taxiway',550,1050);buildBuilding(sim,'terminal',550,900);rebuildGraph(sim);
sim.passengers.satisfaction=100;
const random = rng(7);
let departures=0;
for(let i=0;i<12000;i++){
  const had=sim.aircraft.some(a=>a.phase==='departure');
  tickAircraft(sim,0.1);tickEconomy(sim,0.1);tickPassengers(sim,0.1);tickPlanner(sim,0.1,random);
  if(had && !sim.aircraft.some(a=>a.phase==='departure'))departures++;
  if((i*0.1)%120<0.1)console.log(`t=${(i*0.1).toFixed(0)}s ac=${sim.aircraft.map(a=>a.phase).join('/')} planning=${sim.planning.length} carried=${sim.passengers.totalCarried} dep=${departures} sat=${sim.passengers.satisfaction}`);
}
const st=periodStatement(sim);
console.log(`END dep=${departures} carried=${sim.passengers.totalCarried} revenue=${st.revenue} opex=${st.opex} fuel=${st.fuel} money=${sim.economy.money.toFixed(0)} bankrupt=${sim.economy.bankrupt}`);
