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
import { tickIncidents } from '../sim/incidents.mjs';
import { tickEvents } from '../sim/events.mjs'; // T3 : couche d'événements dynamiques
import { tickQuality } from '../progression/quality.mjs'; // R26 : la qualité des offres converge vers la mesure (inertie)
import { tickObjectives } from '../progression/objectives.mjs';
import { tickContracts } from '../flights/contracts.mjs';
import { tickCampaign } from '../progression/campaign.mjs'; // T2-2 : la campagne (victoire)
import { tickStats } from '../progression/stats.mjs'; // T2-2 : les stats persistantes
import { tickAchievements } from '../progression/achievements.mjs'; // T2-2 : les succès
import { makeSimRng } from './rng.mjs';
import { tickClock } from '../sim/clock.mjs'; // T3 (t_76744b22) : l'horloge de jeu (jour/nuit + saisons)
import { tickWeather } from '../sim/weather.mjs'; // T3 (t_9b665a8b) : le cycle météo (délais + capacité)

export function tick(state, dt, rng) {
  if (state.screen !== 'game' || state.paused || !state.sim) return;
  const sim = state.sim;
  if (sim.economy.bankrupt) return; // la sim est stoppée une fois la faillite déclarée
  if (!rng) rng = makeSimRng(sim); // pas de Math.random à l'état : le générateur est SÉMÉ + sérialisé (EV-10)
  tickPlanner(sim, dt, rng); // horloge de la sim (sim.time) est pilotée PAR le planificateur
  tickClock(sim, dt); // T3 (t_76744b22) : l'HORLOGE DE JEU (jour/nuit + saisons) — APRÈS le planificateur (le temps du tick courant est déjà celui du planificateur), AVANT les avions (la phase du tick courant pilote la teinte du monde)
  tickWeather(sim, dt, rng); // T3 (t_9b665a8b) : la MÉTÉO (cycle déterministe) — AVANT les avions (le temps du tick courant pilote leurs retards/capacité)
  tickAircraft(sim, dt);
  tickQuality(sim, dt); // R26 : APRÈS les avions (leur fin de vol alimente la fenêtre de ponctualité)
  cleanGates(sim, dt); // t_2179387d : nettoyage (g.cleaning) + hangar (g.maintenance)
  tickEconomy(sim, dt);
  tickPassengers(sim, dt);
  tickIncidents(sim, dt, rng); // BL-14 : incidents opérationnels limités (après la passe)
  tickEvents(sim, dt, rng); // T3 : événements dynamiques (conférence/charter/pic) — injection via les modules existants
  tickObjectives(sim); // R22 : objectifs de progression — récompense payée UNE fois (condition mesurée)
  tickContracts(sim, dt); // R24 : contrats de compagnie — prime/pénalité réglées UNE fois (mesure de période)
  tickCampaign(sim); // T2-2 : la campagne (victoire) — APRÈS le règlement des contrats (les réussis comptent)
  tickStats(sim); // T2-2 : stats persistantes — APRÈS l'économie (la période close alimente la série)
  tickAchievements(sim); // T2-2 : succès — en dernier (ils lisent campagne, stats, palier qualité)
  tickUnlocks(sim);
}
