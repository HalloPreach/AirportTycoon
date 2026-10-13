// T3 (t_76744b22) — HORLOGE JOUR/NUIT : le cycle de la partie (heure du jour +
// saisons) — un seul champ SÉRIALISÉ sur la sim (sim.clock : { day, t }), le
// reste est dérivé (lecture pure). Zéro asset : l'habillage du monde passe par
// UNE teinte (pattern weatherTint) et l'heure est affichée en ligne HUD/panneau.
//
// Le module est LA source de vérité de l'horloge (pattern weather.mjs) :
//   - tickClock (tick.mjs, APRÈS le planificateur) : l'avance du temps ;
//   - clockView / phaseTint : lectures pures (UI — sans mutation) ;
//   - forceClock : forçage déterministe (tests + QA CDP, pattern forceWeather) ;
//   - ensureClock : migration additive (EV-10) — une sauvegarde PRÉ-T3-horloge
//     (sim.clock absent) est ADOPTÉE à l'état initial (jour 1, 08:00), un
//     champ corrompu est réparé — sans crash, sans toucher les autres champs.
//
// ÉCHELLE : 1 jour-JEU = DAY_S secondes de simulation (2400 s sim = 24 h-jeu,
// soit 1 h-jeu = 100 s sim) : le cycle jour/nuit est VISIBLE en ~10 min de
// jeu à x4, et la campagne (deadline 10800 s sim) dure ~4,5 jours-jeu.
// Le champ `t` est stocké EN SECONDES SIM (la même unité que sim.time) —
// l'heure JEU est dérivée (t / DAY_S × 24) : pas de seconde horloge à
// synchroniser, la dérive flottante (somme de dt, ~1e-14) est tolérée comme
// pour sim.time.
//
// SAISONS : la saison est DÉRIVÉE du jour (1 saison par jour-jeu, 4 jours =
// 1 an-jeu) — voir src/core/seasons.mjs (la table de PARAMÈTRES DE SPAWN est
// lue par le planificateur via la couche spawnLayer, difficulty.mjs). Le
// passage de jour (donc de saison) émet UNE alerte lisible (season-change).
import { pushEvent } from '../core/sim-state.mjs';

// 1 jour-JEU en secondes de simulation (24 h-jeu = DAY_S s sim → 1 h-jeu = 100 s sim).
export const DAY_S = 2400;
// Le jour 1 démarre à 08:00 (8/24 × DAY_S) — la partie commence le matin.
export const DAY_START = (8 / 24) * DAY_S;

// Phases du jour (bornes EN HEURE JEU — les heures, pas les minutes) :
//   aube 6-7 · jour 8-16 · crépuscule 17-19 · nuit 20 → 5.
export const PHASES = Object.freeze(['night', 'dawn', 'day', 'dusk']);
export const PHASE_FR = Object.freeze({
  night: 'nuit', dawn: 'aube', day: 'jour', dusk: 'crépuscule',
});

// Teinte du monde PAR PHASE (le renderer l'applique — zéro asset, un rempli,
// pattern weatherTint) : « jour » → null (pas de bruit, le monde est déjà
// bien éclairé) ; nuit = bleuté profond, aube/crépuscule = voiles légers.
export const PHASE_TINTS = Object.freeze({
  day: null,
  dawn: 'rgba(130, 100, 180, 0.10)',
  dusk: 'rgba(255, 150, 60, 0.10)',
  night: 'rgba(10, 14, 44, 0.34)',
});

// État INITIAL de l'horloge (jour 1, 08:00) — l'état de référence (référentiel
// = la partie commence le matin, en phase « jour »).
export function freshClock() {
  return { day: 1, t: DAY_START };
}

// Migration additive (EV-10) + réparation défensive (pattern ensureWeather) :
// sauvegarde PRÉ-horloge (champ absent) → état initial ; champ corrompu (jour
// non entier, t non fini) → réparé. JAMAIS de crash, les autres champs de la
// sim sont INTACTS. Retourne l'horloge (la référence mutée).
export function ensureClock(sim) {
  const c = sim && sim.clock;
  if (!c || typeof c !== 'object' || !Number.isInteger(c.day) || c.day < 1 || !Number.isFinite(c.t)) {
    sim.clock = freshClock();
    return sim.clock;
  }
  if (c.t < 0) c.t += DAY_S; // t hors bornes (négatif) → repli dans le jour courant
  c.t = c.t % DAY_S;
  return sim.clock;
}

// Lecture SANS mutation (pattern weatherOf — l'UI ne fabrique PAS l'état) :
// l'horloge courante, l'état initial si le champ est absent/corrompu.
export function clockOf(sim) {
  const c = sim && sim.clock;
  if (!c || typeof c !== 'object' || !Number.isInteger(c.day) || c.day < 1 || !Number.isFinite(c.t)) {
    return { day: 1, t: DAY_START };
  }
  return c;
}

// La phase du jour pour une HEURE JEU (0..23) — la règle unique de découpage.
export function phaseOfHour(hour) {
  if (hour >= 6 && hour <= 7) return 'dawn';
  if (hour >= 8 && hour <= 16) return 'day';
  if (hour >= 17 && hour <= 19) return 'dusk';
  return 'night'; // 20..23 et 0..5
}

// LA teinte du monde pour une phase (la « sélection » du renderer — lecture
// PURE, testable sous Node : null par temps de jour = pas de rempli).
export function phaseTint(phase) {
  return PHASE_TINTS[phase] ?? null;
}

// Lecture UI (HUD/panneau) : le jour, l'heure JEU (HH:MM), la phase + sa FR,
// et la teinte à appliquer (null = pas de teinte). Aucune mutation.
export function clockView(sim) {
  const c = clockOf(sim);
  const hours = (c.t / DAY_S) * 24; // heures JEU depuis 00:00 (0..24, flottant)
  const hour = Math.floor(hours) % 24;
  const minute = Math.floor((hours - Math.floor(hours)) * 60) % 60;
  const phase = phaseOfHour(hour);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    day: c.day, hour, minute,
    label: `${pad(hour)}:${pad(minute)}`,
    phase, phaseFr: PHASE_FR[phase],
    tint: phaseTint(phase),
  };
}

// Le battement de l'horloge (appelé par tick.mjs APRÈS le planificateur — le
// temps du tick courant est piloté PAR le planificateur, sim.time) : avance
// de dt (s sim) ; au ROLLOVER (t ≥ DAY_S) le jour s'incrémente ET la saison
// passe (elle est dérivée du jour — seasons.mjs) : UNE alerte lisible
// (season-change) est émise (jamais de bruit : un seul événement par jour).
export function tickClock(sim, dt) {
  const c = ensureClock(sim);
  c.t += dt;
  while (c.t >= DAY_S) {
    c.t -= DAY_S;
    c.day += 1;
    if (Array.isArray(sim.alerts)) pushEvent(sim, { kind: 'season-change', day: c.day });
  }
}

// Forçage DÉTERMINISTE (tests + QA CDP, pattern forceWeather) : met l'horloge
// à la position voulue (jour + heure JEU — AUCUN tirage, reproductible). Hors
// bornes → borné (jour ≥ 1, heure 0..23). Ne pousse PAS d'événement (le
// forçage n'est pas un passage de jour naturel — pas de bruit).
export function forceClock(sim, day, hour) {
  const c = ensureClock(sim);
  c.day = Math.max(1, Math.trunc(day) || 1);
  c.t = (Math.max(0, Math.min(23, Math.trunc(hour))) / 24) * DAY_S;
  return c;
}
