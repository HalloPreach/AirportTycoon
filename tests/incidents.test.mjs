// Tests BL-14 (NONMVP-3, AC20/A-7) : 3 incidents limités — pas une collection
// de pannes. Chaque incident suit le cycle exigé : PERSISTENCE (événement UI) →
// CONSÉQUENCE MESURABLE → RÉCUPÉRATION (état renversé, mesurable).
//   1. Piste fermée (120 s sim) : les atterrissages patientent en holding
//      (retard lisible), la réouverture relance l'atterrissage.
//   2. Panne station carburant (90 s sim) : les pleins deviennent DÉPARTS
//      SECS (billets moitiés, événement no-fuel, NON bloquant) ; service
//      revenu → le plein se fait VRAIMENT à nouveau.
//   3. Pic de demande (90 s sim) : le planificateur double sa cadence (2 vols
//      planifiés par fenêtre au lieu de 1) — mesuré par le NOMBRE de vols
//      planifiés ; fin du pic → cadence normale.
// Zéro DOM, déterministe (rng semé). On sème les avions DIRECTEMENT dans leur
// phase (comme services.test.mjs) pour isoler chaque incident sans pathfinding,
// et on pilote tickPlanner pour avancer sim.time (pas besoin de jouer 2 h).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickPlanner } from '../src/flights/flights.mjs';
import { tickEconomy, onGateDeparted } from '../src/economy/economy.mjs';
import { tickIncidents, forceIncident, runwayClosed, fuelOut, isSurge } from '../src/sim/incidents.mjs';

// Socle « bien conçu » (géométrie prouvée) — mêmes coordonnées que services.
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}
// R23 : services DÉJÀ DÉBLOQUÉS (état mi-jeu) — le flag persistant sim._unlocked
// court-circuite les conditions mesurables (unlocks.mjs). On n'atteste PAS les
// conditions (planning/usure/pax) : ce test porte sur les INCIDENTS, pas sur les
// déblocages. Le flag ne pollue ni le planning ni l'horloge ni le compteur d'ids
// (le test « pic de demande » compte les vols via nextAcId).
function unlock(sim) {
  sim.economy.money = 100000;
  sim._unlocked = { fuel: true, cleaning: true, hangar: true, baggage: true, catering: true };
}

// Sème un avion medium DIRECTEMENT en « approach » (on saute l'apparition).
function seedApproach(sim) {
  const ac = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
    phase: 'approach', x: 800, y: -150, gateId: null, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(ac);
  return ac;
}
// Sème un avion medium DIRECTEMENT en « refuel » à une porte M.
function seedRefueling(sim) {
  const gate = sim.infra.gates.find((g) => g.size === 'M');
  const ac = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
    phase: 'refuel', x: 0, y: 0, gateId: gate.id, runwayId: 'r1',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(ac);
  return ac;
}

// Avance la sim de n ticks (dt = 0.1 s) — l'ordre tick.mjs : planificateur
// (horloge sim.time) → avions → éco → incidents.
function runSim(sim, n, dt = 0.1) {
  const rng = sim._testRng ?? (() => 0.5);
  for (let i = 0; i < n; i++) {
    tickPlanner(sim, dt, rng);
    tickAircraft(sim, dt);
    tickEconomy(sim, dt);
    tickIncidents(sim, dt, rng);
  }
}

test('BL-14/AC20 (1) : piste fermée → les atterrissages patientent, la réouverture relance', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const ac = seedApproach(sim);
  forceIncident(sim, 'runway');
  assert.ok(runwayClosed(sim), 'l incident est déclenché (piste fermée)');
  assert.ok(sim.alerts.some((a) => a.kind === 'runway-closed'), "l'incident est ANNONCÉ (événement UI)");

  // CONSÉQUENCE MESURABLE : pendant la fermeture, l'avion ne peut pas se poser
  // (même piste libre) : il patiente en holding, son retard s'accumule.
  runSim(sim, 50); // t = 5 s (la fermeture dure 120 s)
  assert.ok(['holding'].includes(ac.phase), `pendant la fermeture l'avion patiente en holding (phase=${ac.phase})`);
  assert.ok(ac.delayed > 0, `le retard s'accumule (delayed=${ac.delayed.toFixed(1)} s) — conséquence mesurée`);

  // RÉCUPÉRATION : la piste réouvre (120 s sim = 1200 ticks) et l'atterrissage
  // reprend. On avance AU-DELÀ de la fin de l'incident (marge : l'horloge
  // flottante ne doit pas laisser un résidu infime de fermeture), puis on
  // laisse le vol atterrir et avancer son cycle.
  runSim(sim, 1220); // t = 122 s (la fermeture de 120 s est terminée)
  assert.ok(!runwayClosed(sim), "l'incident est terminé (piste réouverte)");
  assert.ok(sim.alerts.some((a) => a.kind === 'runway-reopen'), "la réouverture est ANNONCÉE (événement de récupération)");
  runSim(sim, 400); // temps d'atterrissage + sortie + taxi
  const phases = ['landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board'];
  assert.ok(phases.includes(ac.phase), `récupération : l'atterrissage a repris (phase=${ac.phase})`);
});

test('BL-14/AC20 (2) : panne station carburant → départs secs, le service revient → pleins reprennent', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  buildBuilding(sim, 'fuel', 100, 200); // la station existe (la panne la met HORS SERVICE)
  const ac = seedRefueling(sim);
  forceIncident(sim, 'fuel');
  assert.ok(fuelOut(sim), 'l incident est déclenché (station en panne)');
  assert.ok(sim.alerts.some((a) => a.kind === 'fuel-out'), "l'incident est ANNONCÉ (événement UI)");

  // CONSÉQUENCE MESURABLE : avec la station HS, le plein traverse la phase
  // « refuel » immédiatement en DÉPART SÉC (billets moitiés, événement no-fuel,
  // NON bloquant).
  runSim(sim, 5);
  assert.equal(ac.phase, 'disembark', 'la panne passe les pleins en départ sec (NON bloquant)');
  assert.ok(ac._dryDeparture, 'marqué « départ sec » (conséquence lisible)');
  assert.ok(sim.alerts.some((a) => a.kind === 'no-fuel'), "l'attente est EXPLIQUÉE (événement no-fuel)");
  const revenueBefore = sim.economy.revenue.pax ?? 0;
  onGateDeparted(sim, { pax: 100, _dryDeparture: true }); // départ sec = billets moitiés
  assert.equal((sim.economy.revenue.pax ?? 0) - revenueBefore, 1250, 'coût économique visible (100 pax × 12,5 $ au lieu de 25)');

  // RÉCUPÉRATION : fin de la panne (90 s sim = 900 ticks) → les pleins
  // reprennent. On sème un NOUVEAU avion en refuel : cette fois le service est
  // rétabli, le plein se fait VRAIMENT (pas de départ sec).
  runSim(sim, 950); // t = 95 s (la panne de 90 s est terminée, marge flottante)
  assert.ok(!fuelOut(sim), "l'incident est terminé (service rétabli)");
  assert.ok(sim.alerts.some((a) => a.kind === 'fuel-back'), "le retour du service est ANNONCÉ (événement de récupération)");
  const ac2 = seedRefueling(sim);
  runSim(sim, 100);
  assert.ok(ac2._refueling === true, 'récupération : le plein reprend (le service sert à nouveau)');
  assert.ok(!ac2._dryDeparture, 'le 2e avion NE part PAS sec (la panne est finie)');
});

test('BL-14/AC20 (3) : pic de demande → cadence DOUBLÉE (2 vols par fenêtre), puis normale', () => {
  // Le pic se mesure au NOMBRE de vols planifiés par fenêtre (critère NONMVP-3).
  // On mesure UNE fenêtre (t≈60 s) : sans avion et sans auto-accept, la file
  // reste sous le plafond d'arrivées (MAX_PENDING) → le pic n'est pas masqué
  // par la saturation (l'effet est isolé : cadence 2 vs 1).
  const simA = newSimState(); const simB = newSimState();
  buildSocle(simA); unlock(simA); buildSocle(simB); unlock(simB);
  const rng = () => 0.3; // tirage CONSTANT : mêmes choix partout (déterminisme par scénario)
  simA._testRng = rng; simB._testRng = rng;

  // Scénario A (pic) : forcé dès t=0 (il dure 90 s : t=0→90).
  forceIncident(simA, 'surge');
  assert.ok(isSurge(simA), 'l incident est déclenché (pic de demande)');
  assert.ok(simA.alerts.some((a) => a.kind === 'surge-start'), "l'incident est ANNONCÉ (événement UI)");
  runSim(simA, 610, 0.1); // t ≈ 61 s : UNE fenêtre (t=60) se ferme, pendant le pic
  assert.equal(simA.nextAcId - 1, 2, `Pendant le pic : 2 vols planifiés par fenêtre (cadence DOUBLÉE — mesurée)`);

  // RÉCUPÉRATION : le pic est terminé (fin t=90 s) → la fenêtre suivante
  // (t≈120 s) redevient normale (1 vol), pas 2.
  runSim(simA, 610, 0.1); // t ≈ 122 s (2e fenêtre, le pic est fini)
  assert.ok(!isSurge(simA), 'récupération : le pic est terminé');
  assert.ok(simA.alerts.some((a) => a.kind === 'surge-end'), "la fin du pic est ANNONCÉE (récupération)");
  assert.equal(simA.nextAcId - 1, 3, 'La fenêtre post-pic est NORMALE (1 vol, pas 2) — la cadence revient');

  // Scénario B (normal) : la même fenêtre (t=60) sans incident → 1 vol.
  runSim(simB, 610, 0.1); // t ≈ 61 s
  assert.equal(simB.nextAcId - 1, 1, 'Sans pic : 1 vol planifié par fenêtre (cadence normale) — la référence');
});
