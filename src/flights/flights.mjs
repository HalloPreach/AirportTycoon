// Vols : le planificateur fait ARRIVER des vols (approches), la sim les route.
// Logique pure, déterministe si rng est semé. Un vol = {id, airline, acType, pax, phase, ...}.
// Le générateur est semé : un même rng produit la même suite de vols (déterminisme test).
import { AIRLINES, AIRCRAFT } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { rebuildGraph } from '../pathfinding/path.mjs';

const SPAWN_EVERY_S = 60;  // un vol entrant toutes les 60 s de jeu (à x4 ça reste raisonnable)
const MAX_PENDING = 4;     // au-delà, on n'en fait plus arriver (aérogare saturée → conséquence)

// Fait arriver un vol entrant (approche), cadencé par sim._spawnAcc.
export function spawnArrivals(sim, dt, rng = Math.random) {
  sim._spawnAcc += dt;
  if (sim._spawnAcc < SPAWN_EVERY_S) return;
  sim._spawnAcc = 0;
  if (!sim.infra.runways.length) return; // rien à poser → pas de vols (critère « aucune piste »)
  // A-5 (A13) : le plafond compte AUSSI les avions `blocked` — sans ça, les
  // annulations A-5 (600 s) laissent le plafond vide et les arrivées repartent
  // sans fin : 10 avions bloqués en permanence, satisfaction 0 %, jamais d'arrêt.
  const pending = sim.aircraft.filter((a) => a.phase === 'approach' || a.phase === 'holding' || a.phase === 'landing' || a.phase === 'blocked').length;
  if (pending >= MAX_PENDING) return;
  const airline = pick(rng, AIRLINES);
  const acType = pick(rng, airline.types);
  const ac = AIRCRAFT[acType];
  const vol = {
    id: sim.nextAcId++,
    airline: airline.id,
    color: airline.color,
    acType,
    pax: Math.max(0, Math.round(ac.seats * (0.4 + 0.5 * rng()))), // remplissage variable
    phase: 'approach',
    x: 200 + rng() * 1200, // approche au nord de la piste
    y: -150,
    gateId: null,
    runwayId: null,
    delayed: 0,
    timer: 0,
    path: null,
    pathPtr: 0,
    seg: null,
    heading: 'gate',
  };
  sim.aircraft.push(vol);
  pushEvent(sim, { kind: 'flight-in', volId: vol.id, airline: airline.name, acType });
}

// Le planificateur : retards/annulations quand l'infra ne suit pas, puis purge.
export function tickPlanner(sim, dt, rng = Math.random) {
  spawnArrivals(sim, dt, rng);
  for (const a of sim.aircraft) {
    if (a.phase !== 'approach' && a.phase !== 'holding') continue;
    const ac = AIRCRAFT[a.acType];
    // pas de piste assez longue ni de porte de taille : retard (critère 6), pas annulation immédiate.
    if (!sim.infra.runways.some((r) => r.len >= ac.minRunway) ||
        !sim.infra.gates.some((g) => g.size === ac.gate)) {
      a.delayed += dt;
    }
  }
  purge(sim);
}

// Purge les vols annulés/partis (l'alerte est déjà dans sim.alerts).
function purge(sim) {
  sim.aircraft = sim.aircraft.filter((a) => a.phase !== 'cancelled' && a.phase !== 'departed');
}

// Réinjecte un graphe pathfinding après un changement d'infra (construction/démolition).
export function onInfraChanged(sim) { rebuildGraph(sim); }

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
