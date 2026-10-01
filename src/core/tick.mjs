// tick(state, dt, rng) : le battement unique de la simulation.
// Appelé par la boucle de jeu à chaque frame (l'UI n'appelle JAMAIS les modules de
// règle directement — règle « UI fine »).
// Ne fait AUCUNE règle elle-même : délègue aux modules de sim (ordonnancement).
// Ordre : planificateur (arrivées + retards) → avions (cycle) → économie → passagers.
// Déterministe si rng est un PRNG semé (les tests) ; sinon le jeu utilise Math.random.
import { tickPlanner } from '../flights/flights.mjs';
import { tickAircraft } from '../sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from '../economy/economy.mjs';
import { tickUnlocks } from '../infra/infra.mjs';

export function tick(state, dt, rng = Math.random) {
  if (state.screen !== 'game' || state.paused || !state.sim) return;
  const sim = state.sim;
  if (sim.economy.bankrupt) return; // la sim est stoppée une fois la faillite déclarée
  tickPlanner(sim, dt, rng);
  tickAircraft(sim, dt);
  tickEconomy(sim, dt);
  tickPassengers(sim, dt);
  tickUnlocks(sim);
}
