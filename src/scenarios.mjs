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
// ponytail : 3 configs en dur (le brief dit trois scénarios) ; un 4e scénario
// s'ajoute en 1 entrée de table — pas de système de paramétrage.
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
});

// Démarre un scénario : état frais (seed imposée) + la configuration EXPLICITE
// appliquée SUR LA SIM (pic = forceIncident, solde = champ de l'économie —
// aucune règle ajoutée au tick). Retourne le state complet ; le câblage
// (main.mjs) fait Object.assign(state, ret) comme pour une nouvelle partie.
// `state.scenario` = la configuration (marqueur sérialisé, la config REPREND
// au chargement).
export function startScenario(mode) {
  const cfg = SCENARIOS[mode];
  if (!cfg) throw new Error(`scénario inconnu : ${mode} (les modes : ${Object.keys(SCENARIOS).join(', ')})`);
  const state = makeGameState(cfg.seed);
  state.scenario = { id: mode, name: cfg.name, objective: cfg.objective };
  if (cfg.funds !== START_FUNDS) state.sim.economy.money = cfg.funds; // budget explicite du défi
  if (cfg.surgeSeconds > 0) {
    forceIncident(state.sim, 'surge'); // l'action EXISTANTE (tests R33) met le pic actif
    state.sim.incidents.surge.remaining = cfg.surgeSeconds; // durée EXPLICITE du défi
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
