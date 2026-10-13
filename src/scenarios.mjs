// R38 (t_8f8f4a63) — les TROIS scénarios rejouables : DÉMARRAGE GUIDÉ,
// DÉFI SATURATION, DÉFI REDRESSEMENT. Chacun :
//   • les MÊMES règles (tick, sim, économie — AUCUNE règle n'est modifiée :
//     le pic est l'action EXISTANTE forceIncident, l'emprunt la commande
//     EXISTANTE takeLoan du joueur, l'objectif annoncé est un objectif R22) ;
//   • une CONFIGURATION EXPLICITE (seed, solde, pic, emprunt) posée sur l'état
//     frais — elle vit sur `state.scenario` (sérialisée avec l'état entier → la
//     partie scénario est sauvegardable/rechargeable, la configuration REPREND
//     au chargement : les effets déjà appliqués sont sur la sim, le champ sert
//     de marqueur) ;
//   • un OBJECTIF ANNONCÉ (l'objectif R22 correspondant, affiché par le panneau
//     « Scénario » + toast au lancement).
// Le MODE LIBRE est conservé : « Nouvelle partie » = makeGameState() sans
// scenario (seed aléatoire, pas d'objectif annoncé, pas de champ `scenario`).
// R46 (t_7b04f863) : +3 scénarios (CRISE TOTALE, DÉFI DIFFICILE, DÉFI FACILE)
// — le même pattern : une ENTRÉE DE TABLE, pas de système de paramétrage.
// Deux champs de config ADDITIFS (absents des entrées R38 → comportement
// R38 intact) :
//   • `difficulty` : le profil T2-1 (core/difficulty.mjs) — PARAMÈTRE DE
//     SPAWN (capital de départ + facteurs de tick), jamais une règle : le
//     scénario porte sa difficulté, sérialisée sur state.difficulty comme le
//     mode libre (elle REPREND au chargement, le sélecteur du menu la lit) ;
//   • `runwayClosedSeconds` : fermeture de PISTE forçée dès le départ avec
//     une durée EXPLICITE du défi (forceIncident R32 = l'action EXISTANTE,
//     comme le pic ; la durée naturelle RUNWAY_CLOSE_S reste la règle sim).
import { makeGameState } from './core/new-game.mjs';
import { forceIncident } from './sim/incidents.mjs';
import { OBJECTIVES } from './progression/objectives.mjs';
import { START_FUNDS } from './core/sim-state.mjs';

// Le pic forcé du DÉFI SATURATION : durée EXPLICITE du défi (le pic NATUREL
// reste INCID.SURGE_S — on n'écrase rien, forceIncident est la même action ;
// seule la durée du DÉFI est un paramètre du scénario, pas de la sim).
export const SATURATION_SURGE_S = 600; // 10 min sim : le temps de décider
// Le DÉFI REDRESSEMENT : l'aéroport démarre EN DÉFICIT (solde EXPLICITE, pas
// un budget gonflé — START_FUNDS 12 000 reste le capital du mode libre) ;
// l'emprunt borné R35 (5 000 $, une fois) RESTE le levier DU JOUEUR
// (takeLoan, panneau Bilan) — le défi est « remonter dans le vert ».
export const REDRESSEMENT_FUNDS = -3000;
// R46 : le DÉFI CRISE TOTALE — pic de demande (fenêtre EXPLICITE 15 min sim)
// ET fermeture de la piste dès le départ (durée EXPLICITE 120 s, la même que
// la règle R32 RUNWAY_CLOSE_S : le scénario ne change que la DUREE du défi,
// jamais la règle). Les deux effets sont les actions EXISTANTES
// (forceIncident R32/R33) posées sur l'état frais — la réponse du joueur est
// l'intervention PAYANTE R33 (réouvrir la piste : 600 $) ou l'attente.
export const CRISIS_SURGE_S = 900; // 15 min sim : le temps d'absorber la crise
export const CRISIS_RUNWAY_CLOSE_S = 120; // = la durée R32 (la règle reste, on la force au départ)
// T3 stretch (t_79820790) — le SECOND AÉROPORT (scénario « Cap Nord »,
// layout src/core/layouts.mjs : 2 pistes L/M + terminal 4 portes) : le
// budget de départ FIXÉ par un replay 48 h passif MESURÉ (rejoué dans
// tests/r49-airports.mjs, seed 24, solde de départ 12 000 $) : le MINIMUM
// de solde sur 48 h est 11 357 $ — le solde reste POSITIF tout le long
// (pas de faillite, pas de chiffre inventé : mesuré sur la sim réelle).
export const CAP_NORD_FUNDS = 12000;

export const SCENARIOS = Object.freeze({
  guide: Object.freeze({
    name: 'Démarrage guidé',
    seed: 42, // rejouable : même seed + mêmes décisions = même partie (R09)
    funds: START_FUNDS, // budget normal (pas de gonflement)
    surgeSeconds: 0, // aucun pic forcé
    objective: 'o1-cycle', // R22 : premier cycle sans départ sec + période net ≥ 0 (1000 $)
  }),
  saturation: Object.freeze({
    name: 'Défi saturation',
    seed: 7,
    funds: START_FUNDS,
    surgeSeconds: SATURATION_SURGE_S, // pic de demande forcé dès le départ
    objective: 'o2-surge', // R22 : ponctualité restaurée pendant le pic (≥ 50 %, 1500 $)
  }),
  redressement: Object.freeze({
    name: 'Défi redressement',
    seed: 42,
    funds: REDRESSEMENT_FUNDS, // budget EXPLICITE du défi (déficit de départ)
    surgeSeconds: 0,
    objective: 'o1-cycle', // R22 : remettre l'aéroport dans le vert (cycle + période net ≥ 0, 1000 $)
  }),
  // R46 (t_7b04f863) : trois nouveaux scénarios — MÊMES règles (forceIncident
  // R32/R33, emprunt R35, difficultés T2-1, objectifs R22), configuration
  // EXPLICITE posée sur l'état frais, rejouables (seed imposée).
  crise: Object.freeze({
    name: 'Défi crise totale',
    seed: 13,
    funds: START_FUNDS, // budget normal (le défi est l'incident, pas le budget)
    surgeSeconds: CRISIS_SURGE_S, // pic de 15 min sim ACTIF dès le départ
    runwayClosedSeconds: CRISIS_RUNWAY_CLOSE_S, // ET la piste fermée 120 s dès le départ
    objective: 'o2-surge', // R22 : ponctualité restaurée pendant le pic (≥ 50 %, 1500 $)
  }),
  difficile: Object.freeze({
    name: 'Défi difficile',
    seed: 21,
    difficulty: 'hard', // T2-1 : capital maigre 6 000 $ + incidents ×0.6 + OPEX ×1.25
    objective: 'o1-cycle', // R22 : remettre dans le vert en conditions dures (1000 $)
  }),
  facile: Object.freeze({
    name: 'Défi facile',
    seed: 3,
    difficulty: 'easy', // T2-1 : capital confort 18 000 $ + incidents ×1.6 + OPEX ×0.85
    objective: 'o1-cycle', // R22 : premier cycle sans départ sec + période net ≥ 0 (1000 $)
  }),
  // T3 stretch (t_79820790) — le SECOND AÉROPORT (objectif « a second
  // airport ») : le layout Cap Nord (src/core/layouts.mjs — 2 pistes, une
  // CAPABLE L + une M, terminal 4 portes L/M/M/L) — MÊMES règles du jeu
  // (aucune n'est modifiée : l'aéroport est un PARAMÈTRE DE SPAWN, la sim
  // décide), profil DIFFÉRENT de tous les autres scénarios (2 pistes vs 1,
  // 4 portes vs 2) + budget FIXÉ par replay 48 h passif (pas de faillite).
  // ADDITIF : l'absence du champ `airport` sur les entrées R38/R46 = le
  // layout « central » (comportement R38/R46 intact — pas de ligne
  // modifiée pour les 6 scénarios existants).
  capNord: Object.freeze({
    name: 'Cap Nord — aéroport du nord',
    seed: 24, // rejouable (EV-10) : même seed + mêmes décisions = même partie
    funds: CAP_NORD_FUNDS, // budget EXPLICITE du second aéroport (mesuré, cf. tests/r49)
    airport: 'cap-nord', // NOUVEAU champ additif (absent → layout « central »)
    objective: 'o1-cycle', // R22 : premier cycle sans départ sec + période net ≥ 0 (1000 $)
  }),
});

// Démarre un scénario : état frais (seed imposée) + la configuration EXPLICITE
// appliquée SUR LA SIM (pic = forceIncident, solde = champ de l'économie,
// piste fermée = forceIncident R32 — aucune règle ajoutée au tick). Retourne
// le state complet ; le câblage (main.mjs) fait Object.assign(state, ret)
// comme pour une nouvelle partie.
// `state.scenario` = la configuration (marqueur sérialisé, la config REPREND
// au chargement). La difficulté du scénario (R46, absente des entrées R38 →
// 'normal' = comportement R38 intact) est le PARAMÈTRE DE SPAWN T2-1 : elle
// vit sur state.difficulty / sim.difficulty (sérialisées, reprises au load).
export function startScenario(mode) {
  const cfg = SCENARIOS[mode];
  if (!cfg) throw new Error(`scénario inconnu : ${mode} (les modes : ${Object.keys(SCENARIOS).join(', ')})`);
  const diffId = cfg.difficulty || 'normal'; // R46 : le profil T2-1 du défi (référentiel sinon)
  // T3 stretch (t_79820790) : l'aéroport du scénario (champ ADDITIF, absent
  // des entrées R38/R46 → « central » = comportement R38/R46 intact).
  const state = makeGameState(cfg.seed, diffId, cfg.airport);
  state.scenario = { id: mode, name: cfg.name, objective: cfg.objective, difficulty: diffId, airport: cfg.airport };
  // Budget EXPLICITE du défi (absent pour les défis de difficulté : le
  // CAPITAL DU PROFIL T2-1 posé par makeGameState EST la config du défi —
  // pas de chiffre dupliqué).
  if (cfg.funds !== undefined && cfg.funds !== state.sim.economy.money) state.sim.economy.money = cfg.funds;
  if (cfg.surgeSeconds > 0) {
    forceIncident(state.sim, 'surge'); // l'action EXISTANTE (tests R33) met le pic actif
    state.sim.incidents.surge.remaining = cfg.surgeSeconds; // durée EXPLICITE du défi
  }
  if (cfg.runwayClosedSeconds > 0) {
    const rw = state.sim.infra.runways[0]; // plan de départ A-2 : la piste fournie
    if (!rw) throw new Error(`scénario ${mode} : fermeture de piste impossible (aucune piste au départ)`);
    forceIncident(state.sim, `runway:${rw.id}`); // l'action EXISTANTE R32 (attachée à l'actif)
    state.sim.incidents.runways[rw.id].remaining = cfg.runwayClosedSeconds; // durée EXPLICITE du défi
  }
  return state;
}

// L'objectif ANNONCÉ du scénario en cours (le toast de lancement + le panneau
// « Scénario » le lisent). Lecture seule : la sim décide, l'UI n'affiche.
export function scenarioObjective(state) {
  const sc = state && state.scenario;
  const cfg = sc && SCENARIOS[sc.id];
  if (!sc || !cfg) return null; // mode libre : pas d'objectif annoncé
  const o = OBJECTIVES.find((x) => x.id === cfg.objective);
  return { id: cfg.objective, name: o ? o.name : cfg.objective,
           reward: o ? o.reward : 0, text: o ? o.desc : '' };
}

// Statut de l'objectif annoncé (lecture mesurée de l'état — la sim reste la
// source ; la QA rejoue ce critère avec des politiques documentées). La
// réussite = l'objectif R22 payé (compté par tickObjectives, la seule porte).
export function scenarioSuccess(state) {
  const sc = state && state.scenario;
  const o = scenarioObjective(state);
  if (!sc || !o) return null; // mode libre : pas d'objectif annoncé
  const paid = (state.sim?.objectives || []).some((s) => s.id === sc.objective && s.paid);
  return { done: paid, label: `${o.name} (récompense ${o.reward} $)` };
}
