// tick(state, dt, rng) : le battement unique de la simulation.
// Appelé par la boucle de jeu à chaque frame (l'UI n'appelle JAMAIS les modules de
// règle directement — règle « UI fine »).
// Ne fait AUCUNE règle elle-même : délègue aux modules de sim (ordonnancement).
// Ordre : planificateur (arrivées + retards) → avions (cycle) → économie → passagers.
// Déterministe si rng est un PRNG semé (les tests) ; EN JEU : rng est le PRNG semé
// de la sim (makeSimRng) — son état (seed + compteur) vit sur la sim, il est
// CONSERVÉ dans la sauvegarde (EV-10) : la reprise après fermeture est reproductible.
import { tickPlanner } from '../flights/flights.mjs';
import { tickAircraft } from '../sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from '../economy/economy.mjs';
import { tickUnlocks, cleanGates } from '../infra/infra.mjs';
import { makeSimRng } from './rng.mjs';

export function tick(state, dt, rng) {
  if (state.screen !== 'game' || state.paused || !state.sim) return;
  const sim = state.sim;
  if (sim.economy.bankrupt) return; // la sim est stoppée une fois la faillite déclarée
  if (!rng) rng = makeSimRng(sim); // pas de Math.random à l'état : le générateur est SÉMÉ + sérialisé (EV-10)
  tickPlanner(sim, dt, rng); // horloge de la sim (sim.time) est pilotée PAR le planificateur
  tickAircraft(sim, dt);
  cleanGates(sim, dt); // BL-12 : le hangar nettoie les portes (usure du refuel)
  tickEconomy(sim, dt);
  tickPassengers(sim, dt);
  tickUnlocks(sim);
}
