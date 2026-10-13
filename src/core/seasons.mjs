// T3 (t_76744b22) — SAISONS : 4 saisons (printemps/été/automne/hiver) avec
// habillage visuel (teinte du monde, zéro asset — pattern weatherTint) et
// PARAMÈTRES DE SPAWN (la cadence des offres du planificateur) — la couche
// s'ADDITIONNE sur la couche de paramètres de la difficulté (difficulty.mjs,
// spawnLayer) SANS MODIFIER LES RÈGLES EXISTANTES (pas de règle ajoutée au
// planificateur : un seul multiplicateur de cadence, lu par windowClose).
//
// La saison est DÉRIVÉE de l'horloge de jeu (clock.mjs) : UNE saison par
// JOUR-JEU (4 jours = 1 an-jeu) — pas de champ de saison stocké (rien à
// migrer, rien à corrompre : la dérivée se recalcule toujours). Jour 1 =
// PRINTEMPS = la saison RÉFÉRENTIELLE (facteurs ×1 : comportement de la
// première journée EXACTEMENT inchangé — les fixtures de départ sont
// préservées).
import { clockOf } from '../sim/clock.mjs';

// L'ordre des saisons SUIVANT LE JOUR : le jour 1 est le printemps
// (référentiel), l'été suit, l'automne, l'hiver — puis le cycle recommence.
export const SEASON_IDS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);

// Libellés FR (HUD/panneaux — le jeu est en français).
export const SEASON_FR = Object.freeze({
  spring: 'Printemps', summer: 'Été', autumn: 'Automne', winter: 'Hiver',
});

// TABLE DES SAISONS (couche PARAMÈTRES — les chiffres, pas la logique, R37) :
//   spawnFactor : multiplicateur de la cadence des OFFRES par fenêtre du
//                 planificateur (windowClose, flights.mjs) — < 1 = saison
//                 creuse (moins de vols proposés), > 1 = saison forte.
//                 Le printemps = 1,0 (référentiel : AUCUN changement de
//                 comportement la première journée).
//   dressing    : l'habillage visuel du monde (teinte — null = rien ; le
//                 renderer l'applique par-dessus la teinte météo, zéro asset).
//                 L'été chauffe (voile doré), l'hiver refroidit (voile bleu),
//                 l'automne teint les feuilles (voile ocre), le printemps est
//                 net (rien — pas de bruit).
export const SEASONS = Object.freeze({
  spring: Object.freeze({
    fr: SEASON_FR.spring,
    spawnFactor: 1.0,
    dressing: Object.freeze({ tint: null, note: 'référentiel (cadence ×1)' }),
  }),
  summer: Object.freeze({
    fr: SEASON_FR.summer,
    spawnFactor: 1.3,
    dressing: Object.freeze({ tint: 'rgba(255, 190, 80, 0.06)', note: 'pic touristique (cadence +30 %)' }),
  }),
  autumn: Object.freeze({
    fr: SEASON_FR.autumn,
    spawnFactor: 0.9,
    dressing: Object.freeze({ tint: 'rgba(210, 130, 50, 0.07)', note: 'cadence −10 %' }),
  }),
  winter: Object.freeze({
    fr: SEASON_FR.winter,
    spawnFactor: 0.7,
    dressing: Object.freeze({ tint: 'rgba(170, 200, 240, 0.12)', note: 'saison creuse (cadence −30 %)' }),
  }),
});

// Normalisation (pattern normalizeDifficulty / normalizeSeason) : une saison
// inconnue/corrompue → le printemps (référentiel ×1 — pas de facteur inventé,
// pas de crash).
export function normalizeSeason(id) {
  return SEASONS[id] ? id : 'spring';
}

// La saison COURANTE (lecture pure, gardée) : dérivée du JOUR de l'horloge
// (clockOf — l'état initial si le champ est absent/corrompu) : jour 1 =
// printemps, jour 2 = été, jour 3 = automne, jour 4 = hiver, jour 5 =
// printemps… (un an-jeu = 4 jours, l'été suit toujours le printemps).
export function seasonOf(sim) {
  const day = clockOf(sim).day;
  return SEASON_IDS[(day - 1) % SEASON_IDS.length];
}

// Lecture UI (HUD/panneau) : la saison courante + sa table complète (la FR,
// le facteur de spawn, l'habillage). Aucune mutation.
export function seasonView(sim) {
  const id = seasonOf(sim);
  const s = SEASONS[id];
  return { id, fr: s.fr, spawnFactor: s.spawnFactor, dressing: s.dressing };
}

// LES PARAMÈTRES DE SPAWN de la saison (la couche lue par spawnLayer,
// difficulty.mjs — le planificateur compose, les chiffres vivent ici) :
// le facteur de cadence + la saison (pour l'affichage « pic / creux »).
export function seasonParams(sim) {
  const id = seasonOf(sim);
  return Object.freeze({ season: id, spawnFactor: SEASONS[id].spawnFactor });
}

// La teinte du monde de la saison (l'habillage — la « sélection » du
// renderer, lecture PURE testable sous Node) : null au printemps (pas de
// bruit), un voile par saison (été doré / automne ocre / hiver bleuté).
export function seasonTint(sim) {
  const s = SEASONS[seasonOf(sim)];
  return s.dressing.tint;
}
