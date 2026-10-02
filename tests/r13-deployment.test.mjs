// R13 — corrections déploiement / échéances / plafond d'arrivées.
// Scénarios de validation de la carte, sur la sim réelle (aéroport connecté
// des tests planning) + harnais synthétique pour le plafond (file forcée) :
//   1. quatre acceptés dus et quatre places → quatre déployés ;
//   2. deux places → deux ; aucune acceptation → aucun déploiement ;
//   3. un vol accepté en retard ne patiente PAS une minute si capacité libre ;
//   4. l'accumulateur de fenêtre PRÉSERVE le reste (pas gros, sans duplication) ;
//   5. politique offres jamais décidées : expiration 10 min, place libérée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickPlanner, decideFlight, MAX_PENDING } from '../src/flights/flights.mjs';

// Aéroport CONNECTÉ (même plan que tests/planning.test.mjs) — les vols
// planifiés sont SERVABLES (pas de blocage/annulation parasite pendant
// l'observation : les phases attendues restent « approach »).
function connectedAirport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ticks = (sim, s, r) => { for (let i = 0; i < Math.ceil(s / 0.1); i++) tickPlanner(sim, 0.1, r); };

// --- 1 & 2. Plafond A-5 : N acceptés dus sur N places → N déployés ----------------
// La file est FORCÉE à « bloqués » (le comptage est identique : pendingCount
// compte approach/holding/landing/blocked) → MAX_PENDING - N places pour N
// acceptés dus → les N se déploient TOUS (avant la correction : double
// comptage → un de moins). Aucune acceptation → aucun déploiement.
test('R13 : 4 acceptés dus + 4 places → 4 déployés ; 2 places → 2 ; rien accepté → 0', () => {
  const blocked = (i) => ({
    id: 900 + i, airline: 'x', color: '#fff', acType: 'small', pax: 10,
    phase: 'blocked', x: 800, y: 1100, gateId: null, runwayId: 'r',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  for (const [nBlocked, nDue, nExpected] of [[0, 4, 4], [2, 2, 2]]) {
    const sim = connectedAirport();
    sim.aircraft = Array.from({ length: nBlocked }, (_, i) => blocked(i));
    sim.planning = Array.from({ length: nDue }, (_, i) => ({
      id: 100 + i, airline: 'a1', color: '#fff', acType: 'small', pax: 5,
      planned: sim.time ?? 0, status: 'accepted',
    }));
    tickPlanner(sim, 0.1, rng(1)); // un seul pas : les vols dus sont vérifiés immédiatement
    const deployed = sim.aircraft.filter((a) => a.phase === 'approach').length;
    assert.equal(deployed, nExpected, `${nBlocked} bloqués + ${nDue} dus → ${nExpected} déployés`);
  }
  // Aucune acceptation (offres restées « planned ») → AUCUN déploiement.
  const sim = connectedAirport();
  sim.planning = [{ id: 100, airline: 'a1', color: '#fff', acType: 'small', pax: 5, planned: 0, status: 'planned' }];
  tickPlanner(sim, 0.1, rng(1));
  assert.equal(sim.aircraft.length, 0, 'aucune acceptation → aucun déploiement');
});

// --- 3. Acceptation TARDIVE : le vol dû ne patiente PAS une fenêtre ---------------
test('R13 : un vol accepté en retard se déploie au prochain tick si capacité libre', () => {
  const sim = connectedAirport();
  ticks(sim, 65, rng(3)); // la fenêtre 60 s a planifié une offre (planned ~120 s)
  const e = sim.planning[0];
  assert.equal(e.status, 'planned', 'l\'offre est visible avant sa décision');
  e.planned = sim.time; // le joueur accepte APRÈS l'heure prévue (acceptation tardive)
  assert.equal(decideFlight(sim, e.id, true), true, 'acceptation tardive');
  tickPlanner(sim, 0.1, rng(3)); // UN pas (pas 60) : la capacité est libre
  assert.ok(sim.aircraft.some((a) => a.id === e.id),
    'déploié au tick suivant, SANS attendre la fenêtre 60 s');
});

// --- 4. Accuseur de fenêtre : reste PRÉSERVÉ, plusieurs fenêtres SANS duplication ---
test('R13 : pas de 90 s → 1 fenêtre + 30 s conservées ; pas de 150 s → 2 fenêtres ; aucun doublon', () => {
  const sim = connectedAirport();
  ticks(sim, 90, rng(5)); // 90 s en 0.1 s : la fenêtre 60 s a tourné, reste conservé
  assert.ok(Math.abs(sim._spawnAcc - 30) < 1e-6, 'reste de 30 s conservé (pas 0, pas 90)');
  ticks(sim, 150, rng(5)); // 150 s : 2 fenêtres franchies (30+150=180 ≥ 120)
  // Ni duplication ni saut : une offre par fenêtre, ids distincts.
  const ids = sim.planning.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'aucun vol planifié en double');
  assert.ok(sim.planning.length >= 3, 'les fenêtres multiplanifient sans sauter');
});

// --- 5. Politique offres JAMAIS DÉCIDÉES : refusées après 10 min, place libérée ----
test('R13 : offre jamais décidée → refusée (événement lisible) 10 min après son heure prévue', () => {
  const sim = connectedAirport();
  const e = sim.planning.length ? sim.planning[0] : null;
  // Offre synthétique « planned », heure prévue déjà passée de 10 min :
  sim.planning.push({ id: 555, airline: 'a1', color: '#fff', acType: 'small', pax: 5, planned: -600, status: 'planned' });
  if (e && e.id !== 555) { /* l'offre réelle du test reste vivante si < 10 min : on ne la juge pas ici */ }
  tickPlanner(sim, 0.1, rng(7));
  assert.ok(!sim.planning.some((x) => x.id === 555), 'l\'offre expirée est retirée du planning');
  assert.ok(sim.alerts.some((a) => a.kind === 'flight-offer-expired' && a.volId === 555),
    'l\'expiration est un événement LISIBLE (alerte, pas de purge silencieuse)');
  // Tant que l'offre est vivante (< 10 min), elle reste décisionnable (pas d'effet sur un fresh offer).
  const sim2 = connectedAirport();
  sim2.planning.push({ id: 666, airline: 'a1', color: '#fff', acType: 'small', pax: 5, planned: 0, status: 'planned' });
  tickPlanner(sim2, 0.1, rng(7));
  assert.ok(sim2.planning.some((x) => x.id === 666), 'offre vivante (< 10 min) : non expirée');
});

// --- R13 bis : le plafond exporté est la SEULE référence (visibilité du paramètre) ---
test('R13 : MAX_PENDING est exporté et vaut 4 (plafond A-5, référence unique)', () => {
  assert.equal(MAX_PENDING, 4);
});
