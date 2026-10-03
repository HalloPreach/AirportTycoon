// Tests BL-12 (AC21 + critères « construction = coût ET service », « attente
// issue gérée et expliquée ») : le service CARBURANT est le SEUL qui remplit le
// réservoir, et sa SATURATION est mesurable (une station = une LANCE).
//   - 2 stations (2 lances) vs 1 station (1 lance) pour le même avion : le
//     temps d'attente pour DÉMARRER le plein diffère (≈0 s vs ≈55 s) → retard
//     mesurable, non bloquant (l'avion attend, il ne bloque pas).
//   - 0 station → départ SÉC : pas d'attente (phase refuel traversée
//     immédiatement), événement « no-fuel » (attente EXPLIQUÉE), et billets
//     moitiés (coût économique visible).
// Zéro DOM, déterministe : on sème l'avion DIRECTEMENT en phase « refuel »
// (on saute approach/landing/taxi/docking et leur pathfinding) pour isoler
// le service carburant. Les files passagers restent vides → boardDelay = 0,
// donc le seul facteur d'attente est le nombre de LANCES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, cleanGates, tickUnlocks } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers, onGateDeparted } from '../src/economy/economy.mjs';

// Même plan « bien conçu » (piste + taxiway + terminal 4 portes S/M/M/L).
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}

// Débloque tous les services (R23 : conditions MESURABLES, unlocks.mjs —
// plus de seuil de pax) et met assez d'argent :
//   fuel      : une offre de vol en vue (planning non vide) ;
//   cleaning  : usure « sale » d'une porte ≥ 10 (g.cleaning) ;
//   hangar    : usure mécanique d'une porte ≥ 10 (g.maintenance) ;
//   baggage   : 400 pax transportés (les volumes justifient le débit) ;
//   catering  : 300 pax transportés (les volumes justifient le confort).
function unlock(sim) {
  sim.economy.money = 100000;
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium',
    pax: 100, planned: 60, status: 'planned' }); // fuel (offre en vue)
  for (const g of sim.infra.gates) { g.cleaning = 10; g.maintenance = 10; } // cleaning + hangar
  sim.passengers.totalCarried = 400; // baggage (carried) + catering (≥ 300)
  tickUnlocks(sim);
}

// Sème UN avion « medium » (réf 110) DIRECTEMENT en phase « refuel » à une
// porte M : on isole la logique de la lance carburant sans pathfinding.
function seedRefueling(sim, gateId) {
  const ac = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
    phase: 'refuel', x: 0, y: 0, gateId, runwayId: 'r1',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(ac);
  return ac;
}

// Les deux portes M d'un terminal (l'indice 1 et 2 de S/M/M/L).
const M_GATES = (sim) => sim.infra.gates.filter((g) => g.size === 'M');

// Avance la sim (avion + éco) et renvoie, pour CHAQUE avion, l'INSTANT (en s)
// où il a DÉMARRÉ son plein (premier tick où ac._refueling === true).
// On compte en TICKS × dt (pas sim.time : la sim seule n'avance pas
// sim.time — c'est tickPlanner qui le fait, et on l'appelle PAS ici).
// Avec 1 lance, le 2e ne démarre QUE quand le 1er a fini (≈ 55 s) → retard
// mesurable ; avec 2 lances, les deux démarrent au même tick (≈0 s).
function runRefuel(sim, maxTicks = 2000) {
  const dt = 0.1;
  const start = [null, null]; // instant (s) de démarrage du plein par avion
  for (let i = 0; i < maxTicks; i++) {
    tickAircraft(sim, dt);
    tickEconomy(sim, dt);
    sim.aircraft.forEach((ac, k) => {
      if (ac._refueling && start[k] === null) start[k] = i * dt; // 1er plein
    });
    if (sim.aircraft.every((ac) => ac.phase !== 'refuel')) break;
  }
  return start;
}

test('BL-12/AC21 (1) : 2 stations = 2 lances → le 2e plein démarre IMMÉDIATEMENT (≈0 s d attente)', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  buildBuilding(sim, 'fuel', 100, 200);
  buildBuilding(sim, 'fuel', 100, 350); // 2e station = 2e lance
  const [g1, g2] = M_GATES(sim);
  seedRefueling(sim, g1.id); seedRefueling(sim, g2.id);
  const start = runRefuel(sim);
  // Les 2 lances libres : les deux pleins démarrent au 1er tick (pas de file).
  assert.ok(start[0] !== null && start[1] !== null, 'les deux avions ont démarré leur plein');
  assert.ok(start[1] < 5, `le 2e plein démarre sans attendre (t=${(start[1] ?? 0).toFixed(2)} s) — 2 lances`);
});

test('BL-12/AC21 (2) : 1 station = 1 lance → le 2e avion ATTEND le 1er (retard mesurable)', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  buildBuilding(sim, 'fuel', 100, 200); // UNE seule station = UNE seule lance
  const [g1, g2] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id); // premier dans l'ordre → prend la lance
  seedRefueling(sim, g2.id);
  const start = runRefuel(sim);
  // Le 1er prend la lance aussitôt ; le 2e ne peut démarrer que QUAND le 1er
  // a fini (durée plein medium = 110 * 0.5 = 55 s) → attente ≈ 55 s.
  assert.ok(start[0] < 5, 'le 1er avion démarre immédiatement');
  assert.ok(start[1] > 50, `le 2e attend ≈55 s la lance libérée (t=${(start[1] ?? 0).toFixed(2)} s) — RETARD MESURABLE`);
  assert.equal(a1._refuelNeed <= 0, true, 'le plein du 1er est terminé (lance libérée pour le 2e)');
});

test('BL-12/AC21 (3) : 0 station → départ SÉC, événement « no-fuel » ET billets moitiés', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim); // NE PAS construire de station carburant
  const [g1, g2] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  const a2 = seedRefueling(sim, g2.id);
  runRefuel(sim);
  // Pas de lance → pas d'attente : les deux quittent « refuel » en 1 tick.
  assert.equal(a1.phase, 'disembark', 'sans station l avion passe AU DEBARQUEMENT (pas d attente)');
  assert.equal(a2.phase, 'disembark', 'id. pour le 2e avion');
  assert.ok(a1._dryDeparture && a2._dryDeparture, 'les deux sont marqués « départ sec »');
  assert.ok(sim.alerts.some((a) => a.kind === 'no-fuel'), "l'attente issue est EXPLIQUÉE (événement no-fuel)");
  // Coût économique : les billets sont moitiés (25 → 12.5 $/pax) au décollage.
  const dry = { pax: 100, _dryDeparture: true };
  onGateDeparted(sim, dry);
  assert.equal(sim.economy.revenue.pax, 1250, 'billets moitiés au départ sec (100 pax × 12.5 $)');
});

// ---- t_2179387d : 4 services au sol OPÉRATIONNELS DISTINCTS (audit gap #1) ---
// Avant : le nettoyage n'était qu'un effet du hangar (cleanGates remis tout à 0)
// et le bagage était assimilé au check-in. Désormais :
//   - NETTOYAGE (bâtiment « cleaning ») nettoie l'usure « sale » (g.cleaning) ;
//   - HANGAR (maintenance) nettoie l'usure « mécanique » (g.maintenance) ;
//   - BAGAGES (bâtiment « baggage ») booste le débit check-in (dépôt bagages).
// Chacun coûte (opex), sert (effet mesurable) et son absence cause un retard
// mesurable (critère de fin : un bâtiment qui coûte ET qui sert).

// (a) NETTOYAGE : l'usure « sale » (g.cleaning) NE DIMINUE PAS sans service,
// et DIMINUE avec le service « cleaning » (un bâtiment = une équipe, débit 1/s).
test('t_2179387d (a) : l usure sale ne baisse que si le service « cleaning » est construit', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [g1] = M_GATES(sim);
  g1.cleaning = 80; // porte sale
  cleanGates(sim, 10); // 10 s SANS service nettoyage
  assert.equal(g1.cleaning, 80, `sans service l usure sale ne diminue pas (stable à ${g1.cleaning})`);
  // Avec UN bâtiment nettoyage (débit 1/s) : l usure sale BAISSE en 10 s.
  buildBuilding(sim, 'cleaning', 100, 200);
  cleanGates(sim, 10);
  assert.ok(g1.cleaning < 71, `avec le service l usure sale diminue (80 → ${g1.cleaning.toFixed(1)})`);
});

// (b) MAINTENANCE DISTINCTE : le hangar baisse g.maintenance SANS toucher g.cleaning ;
// le nettoyage baisse g.cleaning SANS toucher g.maintenance (deux services distincts).
test('t_2179387d (b) : hangar et nettoyage touchent DES usures DIFFÉRENTES (2 services distincts)', () => {
  // HANGAR seul : baisse g.maintenance, NE TOUCHE PAS g.cleaning.
  const sim1 = newSimState(); buildSocle(sim1); unlock(sim1);
  const [g1] = M_GATES(sim1);
  g1.cleaning = 80; g1.maintenance = 80;
  buildBuilding(sim1, 'hangar', 100, 200);
  cleanGates(sim1, 10);
  assert.ok(g1.maintenance < 71, `le hangar diminue l usure mécanique (80 → ${g1.maintenance.toFixed(1)})`);
  assert.ok(g1.cleaning >= 80, `le hangar NE nettoie PAS l usure sale (stable ${g1.cleaning.toFixed(1)})`);
  // NETTOYAGE seul : baisse g.cleaning, NE TOUCHE PAS g.maintenance.
  const sim2 = newSimState(); buildSocle(sim2); unlock(sim2);
  const [g2] = M_GATES(sim2);
  g2.cleaning = 80; g2.maintenance = 80;
  buildBuilding(sim2, 'cleaning', 100, 200);
  cleanGates(sim2, 10);
  assert.ok(g2.cleaning < 71, `le nettoyage diminue l usure sale (80 → ${g2.cleaning.toFixed(1)})`);
  assert.ok(g2.maintenance >= 80, `le nettoyage NE TITCHE PAS la usure mécanique (stable ${g2.maintenance.toFixed(1)})`);
});

// (c) BAGAGES : sans service le check-in tourne au débit de base (lent), avec
// le service bagages le débit est BOOSTÉ (la file se vide plus vite).
test('t_2179387d (c) : avec le service bagages la file check-in se vide PLUS VITE', () => {
  // 5 s (10 ticks × 0.5 s), file de 200 pax. Débit de base 12 pax/s ;
  // avec UNE salle bagages : 12 + 8 = 20 pax/s → plus de pax traités.
  // R30 : la file check-in est PAR TERMINAL (queues[terminalId]) ; buildSocle
  // pose UN terminal — on lit/seed sa file check-in directement.
  const runCheckin = (sim) => {
    for (let i = 0; i < 10; i++) tickPassengers(sim, 0.5);
    const tid = sim.infra.terminals[0].id;
    return sim.passengers.queues[tid].checkin;
  };
  const sim1 = newSimState(); buildSocle(sim1); unlock(sim1);
  sim1.passengers.queues[sim1.infra.terminals[0].id] = { checkin: 200, security: 0, board: 0 };
  const baseLeft = runCheckin(sim1);
  const sim2 = newSimState(); buildSocle(sim2); unlock(sim2);
  buildBuilding(sim2, 'baggage', 100, 200);
  sim2.passengers.queues[sim2.infra.terminals[0].id] = { checkin: 200, security: 0, board: 0 };
  const boostedLeft = runCheckin(sim2);
  assert.ok(boostedLeft < baseLeft,
    `avec bagages moins de pax en attente check-in (${boostedLeft} < ${baseLeft}) — service opérationnel`);
});
