// T3 (t_9b665a8b) — MÉTÉO : 5 états (clair/nuageux/pluie/neige/orage) avec
// effets MESURABLES sur la sim, cycle aléatoire DÉTERMINISTE (graine dans la
// partie — le PRNG semé de la sim, EV-10), zéro asset (le HUD reste canvas).
//
// Le module est LA source de vérité du cycle météo (pattern incidents.mjs) :
//   - tickWeather (tick.mjs, APRÈS le planificateur, AVANT les avions — la
//     météo du tick courant pilote les retards/capacité du tick courant) ;
//   - weatherOf / weatherView : lectures pures (UI — sans mutation) ;
//   - weatherEffect : LA règle unique d'effet (voir ci-dessous) ;
//   - forceWeather : forçage déterministe (tests + QA CDP, pattern
//     forceIncident) ;
//   - ensureWeather : migration additive (EV-10) — une sauvegarde PRÉ-T3
//     (sim.weather absent) est ADOPTÉE en « clear », sans crash, sans toucher
//     les autres champs ; un champ corrompu est réparé.
//
// Les EFFETS vivent chez les modules concernés (comme pour les incidents) :
//   - aircraft.mjs : la vitesse d'approche/descente est MULTIPLIÉE par
//     WEATHER_EFFECTS (speed < 1 = arrivée plus LENTE + occupation piste
//     PROLONGÉE = capacité réduite) + un retard FIXE (delay, s) ajouté UNE
//     FOIS par entrée en attente (holding) par temps dégradé ;
//   - incidents.mjs : l'incident MÉTÉO (4e incident, i.weather) — le tirage
//     de fenêtre est BIAISÉ par l'état météo (WEATHER_EFFECTS.incident) ;
//     pendant qu'il est ACTIF, les effets météo sont majorés à la ligne
//     « orage » (weatherEffect — la règle unique, mesurable).
// Déterminisme : 2 tirages par transition (état suivant + durée) sur le rng
// SEMÉ de la sim → la suite météo est reproductible à la reprise (EV-10),
// comme les vols et les incidents.

import { pushEvent } from '../core/sim-state.mjs';

export const WEATHER_STATES = Object.freeze(['clear', 'cloudy', 'rain', 'snow', 'storm']);

// Libellés FR (HUD/panneaux — le jeu est en français).
export const WEATHER_FR = Object.freeze({
  clear: 'clair', cloudy: 'nuageux', rain: 'pluie', snow: 'neige', storm: 'orage',
});

// Durée BORNÉE de chaque état (s sim) — durée réelle = base × (0,8 + 0,4×tirage)
// (± 20 % : pas d'état infini, pas de pic à durée nulle).
const DURATIONS = Object.freeze({ clear: 900, cloudy: 720, rain: 480, snow: 480, storm: 300 });

// Table de transition (chaîne de Markov) : bornes cumulées sur UN tirage
// unique (0..1) — déterministe. Chaque ligne est une distribution complète
// (les bornes montent vers 1 ; le 5e état = le reste) :
//   r < t[0] → clair | < t[1] → nuageux | < t[2] → pluie | < t[3] → neige | sinon orage
// Le temps dégénéré (pluie/neige/orage) retourne vers le clair/nuageux PLUS
// vite qu'il n'en part (la météo est un événement, pas un régime).
const NEXT = Object.freeze({
  clear:  [0.50, 0.80, 0.90, 0.95],
  cloudy: [0.40, 0.70, 0.90, 0.95],
  rain:   [0.15, 0.50, 0.80, 0.90],
  snow:   [0.10, 0.40, 0.60, 0.90],
  storm:  [0.20, 0.70, 0.90, 0.95],
});

// TABLE D'EFFETS (couche PARAMÈTRES — les chiffres, pas la logique ; R37) :
//   speed    : facteur de vitesse d'approche/descente (1 = inchangé ; < 1 =
//              plus lent → RETARD d'arrivées MESURABLE + occupation piste
//              prolongée → CAPACITÉ réduite, émergent, pas une 2e règle).
//   delay    : retard FIXE (s sim) ajouté UNE FOIS par entrée en attente
//              (holding) — 0 par temps clair (le clair = l'état existant).
//   incident : probabilité de l'incident MÉTÉO par fenêtre (incidents.mjs) —
//              0 par temps clair (jamais d'incident météo quand il fait beau).
export const WEATHER_EFFECTS = Object.freeze({
  clear:  { speed: 1.0, delay: 0, incident: 0.0 },
  cloudy: { speed: 1.0, delay: 10, incident: 0.1 },
  rain:   { speed: 0.7, delay: 30, incident: 0.3 },
  snow:   { speed: 0.5, delay: 60, incident: 0.5 },
  storm:  { speed: 0.3, delay: 90, incident: 0.7 },
});

// Migration additive (EV-10) + réparation défensive (pattern R31/R32/
// ensureCampaign) : sauvegarde PRÉ-T3 (champ absent) → « clear » neuf ;
// champ corrompu (état inconnu / durée hors bornes) → réparé. JAMAIS de
// crash, les autres champs de la sim sont INTACTS.
export function ensureWeather(sim) {
  const w = sim.weather;
  if (!w || typeof w !== 'object' || !WEATHER_STATES.includes(w.state)) {
    sim.weather = { state: 'clear', remaining: DURATIONS.clear, acc: 0 };
    return sim.weather;
  }
  if (!Number.isFinite(w.remaining) || w.remaining <= 0) w.remaining = DURATIONS[w.state];
  if (!Number.isFinite(w.acc) || w.acc < 0) w.acc = 0;
  return sim.weather;
}

// Lecture SANS mutation (pattern runwayClosedRO — l'UI ne fabrique PAS
// l'état) : l'état courant, « clear » si le champ est absent/corrompu.
export function weatherOf(sim) {
  const w = sim && sim.weather;
  return w && WEATHER_STATES.includes(w.state) ? w.state : 'clear';
}

// L'EFFET météo ACTIF — LA règle unique lue par aircraft.mjs (pas de 2e règle,
// pattern R05) : la ligne de l'état courant, MAJORÉE à la ligne « orage » (la
// pire) si l'incident MÉTÉO (i.weather, incidents.mjs) est ACTIF. Lecture
// directe du champ (guardé — la fin normale le referme ; ensureIncidents le
// crée au 1er tick) : jamais d'ensure ici (pas de mutation).
export function weatherEffect(sim) {
  const state = weatherOf(sim);
  const w = sim && sim.incidents && sim.incidents.weather;
  const active = !!(w && w.active && w.remaining > 0);
  return WEATHER_EFFECTS[active ? 'storm' : state];
}

// Lecture UI (panneau diagnostic / HUD) : l'état + sa FR + le temps restant +
// l'effet actif (majeuré si l'incident météo est en cours). incidentRemaining
// = le compte à rebours de l'INCIDENT (champ incidents.weather, lu avec garde
// — jamais d'ensure ici, pas de mutation) ; 0 quand l'incident n'est pas actif.
export function weatherView(sim) {
  const state = weatherOf(sim);
  const w = sim && sim.weather;
  const iw = sim && sim.incidents && sim.incidents.weather;
  const active = !!(iw && iw.active && iw.remaining > 0);
  const eff = WEATHER_EFFECTS[active ? 'storm' : state];
  return {
    state, fr: WEATHER_FR[state],
    remaining: w ? Math.max(0, Math.ceil(w.remaining || 0)) : 0,
    incident: active, incidentRemaining: active ? Math.ceil(iw.remaining) : 0,
    speed: eff.speed, delay: eff.delay,
  };
}

// Le battement météo (appelé par tick.mjs APRÈS le planificateur, AVANT les
// avions — la météo du tick courant pilote les retards/capacité du tick
// courant) : compte à rebours de l'état courant → transition DÉTERMINISTE
// (table + 2 tirages sur le rng semé). Sans rng (jamais en jeu — tick.mjs
// le fournit) : tirage à 0 → transition « clear » (déterministe, sans crash).
export function tickWeather(sim, dt, rng) {
  if (!rng) rng = () => 0;
  const w = ensureWeather(sim);
  w.acc += dt;
  w.remaining -= dt;
  if (w.remaining <= 0) {
    const from = w.state;
    w.state = nextState(w.state, rng);
    w.remaining = durationOf(w.state, rng);
    pushEvent(sim, { kind: 'weather-change', from, to: w.state });
  }
}

// Un tirage UNIQUE : bornes cumulées (table NEXT) — déterministe (pas de
// loterie par ligne : une seule valeur aléatoire par décision, comme les
// tirages incidents).
function nextState(cur, rng) {
  const r = rng();
  const t = NEXT[cur];
  return r < t[0] ? 'clear' : r < t[1] ? 'cloudy' : r < t[2] ? 'rain' : r < t[3] ? 'snow' : 'storm';
}

// Durée ± 20 % (UN tirage) : durée BORNÉE (pas d'état infini).
function durationOf(state, rng) {
  return DURATIONS[state] * (0.8 + 0.4 * rng());
}

// Forçage DÉTERMINISTE (tests + QA CDP, pattern forceIncident) : met l'état
// à la position voulue (durée MAX, AUCUN tirage — reproductible) + événement
// de transition. Sans événement si l'état ne change pas (pas de bruit).
export function forceWeather(sim, state) {
  if (!WEATHER_STATES.includes(state)) return { ok: false, why: `état météo inconnu : ${state}` };
  const w = ensureWeather(sim);
  const from = w.state;
  w.state = state;
  w.remaining = DURATIONS[state]; // durée max (pas de tirage — forçage pur)
  w.acc = 0;
  if (from !== state) pushEvent(sim, { kind: 'weather-change', from, to: state });
  return { ok: true };
}
