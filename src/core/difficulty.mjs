// T2-1 (t_d5da994c) — DIFFICULTÉ : facile / normal / difficile — une COUCHE DE
// PARAMÈTRES AU SPAWN, jamais une couche de règles : les règles de la sim
// (mécanismes des incidents, OPEX/seconde, invariants de conservation EV-9)
// SONT INTACTES ; seuls les paramÈTRES DE DÉPART changent, appliqués à la
// création de la partie (makeGameState) :
//   • solde de départ        : sim.economy.money (le capital initial) ;
//   • fréquence d'incidents  : les FENÊTRES de tirage (incidents.mjs) × incidentScale
//     (la cadence, les cibles, les effets et les tirages rng sont inchangés) ;
//   • pression économique    : l'OPEX de la sim (tickEconomy) × opexFactor
//     (le OPEX_PER_SEC du catalogue est intact — le facteur est un paramètre
//      du spawn, pas une nouvelle règle de coût).
// « normal » = le RÉFÉRENTIEL (capital START_FUNDS, fenêtres ×1, OPEX ×1) :
// le comportement de référence du jeu ne bouge PAS (fixtures/tests intacts).
// Le choix VIT sur `state.difficulty` (sérialisé avec l'état entier par
// save.mjs — il survit à la sauvegarde/rechargement, comme state.intro/audio)
// et les deux facteurs du tick VIVENT sur `sim.difficulty` (le tick ne reçoit
// QUE la sim — même discipline que sim.incidents / sim.upgrades) : au chargement,
// ensureDifficulty (migration, pattern ensureLoan) replace les valeurs par
// défaut d'une sauvegarde PRÉ-T2-1 (absentes → référentiel normal, sans crash).
import { START_FUNDS } from './sim-state.mjs';
import { INCID } from '../sim/incidents.mjs';
import { seasonParams } from './seasons.mjs'; // T3 (t_76744b22) : la couche de saisons (paramètres de spawn)

export const DIFFICULTY_IDS = Object.freeze(['easy', 'normal', 'hard']);

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    name: 'Facile',
    startFunds: START_FUNDS + 6000, // capital confort (+6 k$)
    incidentScale: 1.6, // fenêtres ×1.6 (incidents 60 % moins fréquents)
    opexFactor: 0.85,   // OPEX ×0.85 (exploitation allégée)
  }),
  normal: Object.freeze({
    name: 'Normal',
    startFunds: START_FUNDS, // le capital RÉFÉRENTIEL (inchangé)
    incidentScale: 1,        // fenêtres ×1 (la table INCID, référentiel)
    opexFactor: 1,          // OPEX ×1 (référentiel)
  }),
  hard: Object.freeze({
    name: 'Difficile',
    startFunds: 6000,            // capital maigre (la moitié du référentiel)
    incidentScale: 0.6,         // fenêtres ×0.6 (incidents plus fréquents)
    opexFactor: 1.25,           // OPEX ×1.25 (exploitation alourdie)
  }),
});

// Normalisation PURES (pattern options.mjs) : toute valeur inconnue/corrompue
// retombe au RÉFÉRENTIEL normal (une difficulté ne doit JAMAIS bloquer ni
// casser la sim — même politique que les options : repli aux défauts).
export function normalizeDifficulty(raw) {
  return DIFFICULTIES[raw] ? raw : 'normal';
}

// Les fenêtres de tirage D'UNE DIFFICULTÉ (lecture pure — le tick lit cette
// même table : UNE source, pas de chiffres dupliqués). normal = la table INCID
// inchangée (référentiel) ; easy/hard = les mêmes fenêtres × l'échelle du profil.
export function incidentWindows(id) {
  const p = DIFFICULTIES[normalizeDifficulty(id)];
  return Object.freeze({
    runwayEvery: INCID.RUNWAY_EVERY_S * p.incidentScale,
    fuelEvery: INCID.FUEL_EVERY_S * p.incidentScale,
    surgeEvery: INCID.SURGE_EVERY_S * p.incidentScale,
  });
}

// Migration au CHARGEMENT (pattern R27/R31/R32/R35 — ensureLoan dans save.mjs) :
// une sauvegarde PRÉ-T2-1 a `state.difficulty` ABSENT (tolérée : on replace le
// profil normal sur l'état) et `sim.difficulty` ABSENTE (on materialise le
// référentiel pour que la source soit lisible). SÉMANTIQUE : `state.difficulty`
// (le choix) est la SOURCE DE VÉRITÉ ; `sim.difficulty` (les facteurs du tick)
// DOIT y être CONSISTANT — si les deux DIVERGENT (corruption), le champ de la
// sim est resynchronisé sur le profil de l'état. Idempotente : un état PROPRE
// (les deux champs cohérents) n'est PAS TOUCHÉ (les références tiennent, pas de
// re-remplacement). Un champ ABSENT ou CORROMPU est normalisé au référentiel
// normal (le comportement d'une partie ancienne ne change PAS — comme ensureLoan).
export function ensureDifficulty(state, sim) {
  const raw = (state && state.difficulty) ? state.difficulty : null;
  const id = normalizeDifficulty(raw && raw.id);
  const p = DIFFICULTIES[id];
  // state.difficulty : le choix (le profil COMPLET, sérialisé). On le remplace
  // seulement s'il est absent/corrompu/incohérent — pas un état propre.
  const stateOk = !!(raw && raw.id === id && raw.name === p.name
    && raw.startFunds === p.startFunds
    && raw.incidentScale === p.incidentScale
    && raw.opexFactor === p.opexFactor);
  if (!stateOk) {
    state.difficulty = {
      id, name: p.name, startFunds: p.startFunds,
      incidentScale: p.incidentScale, opexFactor: p.opexFactor,
    };
  }
  // sim.difficulty : les facteurs du tick (l'UI fine lit l'état, la sim lit ça).
  // Consistant = IDENTIQUE au profil de l'état ; sinon on resynchronise.
  if (sim) {
    const d = sim.difficulty;
    const simOk = !!(d && typeof d === 'object'
      && d.incidentScale === p.incidentScale
      && d.opexFactor === p.opexFactor);
    if (!simOk) {
      sim.difficulty = { incidentScale: p.incidentScale, opexFactor: p.opexFactor };
    }
  }
  return state;
}

// T3 (t_76744b22) : la COUCHE DE PARAMÈTRES DE SPAWN (s'ADDITONNE sur la
// couche difficulté, SANS MODIFIER LES RÈGLES) : la SAISON (dérivée de
// l'horloge de jeu, seasons.mjs) module la CADENCE des offres du
// planificateur (un multiplicateur lu par windowClose, flights.mjs) — même
// principe que l'incidentScale/opexFactor (des chiffres, pas une règle).
// RÉFÉRENTIEL : le printemps (jour 1, la saison de départ) est ×1 — le
// comportement d'une partie au printemps est EXACTEMENT celui d'avant
// (pas de facteur caché la première journée). Lecture pure (guardée :
// horloge absente/corrompue → printemps, comportement inchangé).
export function spawnLayer(sim) {
  const p = seasonParams(sim); // { season, spawnFactor } (la table est SÉRIELLE)
  return Object.freeze({
    season: p.season,          // la saison courante (affichage « pic / creux »)
    spawnFactor: p.spawnFactor, // × sur la cadence des offres (1 = inchangé)
  });
}
