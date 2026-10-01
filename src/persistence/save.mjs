// Sauvegarde / chargement : sérialisation + validation de schéma + stockage navigateur.
// Les fonctions de LOGIQUE (serialize/deserialize) sont PURES (aucun DOM, aucune
// localStorage) → testables dans Node. Les wrappers de stockage (saveToStorage /
// loadFromStorage / clearSave) touchent localStorage et ne s'exécutent QUE dans le
// navigateur (le guard `typeof localStorage` les rend sans effet sous Node).
//
// Règle : on sérialise l'objet `state` entier (l'état global contient déjà la sim,
// conçue pour être sérialisable toute seule). La version de schéma permet de
// REJETER proprement une sauvegarde invalide ou trop ancienne (règle robuste).
// ponytail: version de schéma entière (un chiffre). Si un futur champ casse le
// format, on bump SAVE_VERSION et on rejette l'ancienne au lieu de crasher.

export const SAVE_KEY = 'airport-tycoon-save';
export const SAVE_VERSION = 1;

// Ce qu'un état valide doit contenir (champs minimum). On valide ce qu'on RECHARGE.
// `sim` n'est pas requis : une partie M1 (terrain vide, pas de sim) est rechargeable.
const REQUIRED = ['screen', 'time', 'terrain', 'camera'];

// Prépare l'état à la sérialisation : retire ce qui n'est PAS sérialisable.
// sim._graph est un graphe pathfinding construit en mémoire (Maps/Sets) → on le
// jette avant JSON.stringify ; la sim le reconstruit au prochain tick (_graphDirty).
function sanitize(state) {
  if (state.sim) {
    state.sim._graph = null;
    state.sim._graphDirty = true;
  }
  return state;
}

// Sérialise un état de jeu en chaîne JSON (stockable).
export function serialize(state) {
  return JSON.stringify({ v: SAVE_VERSION, state: sanitize(state) });
}

// Dé-sérialise + valide le schéma. Lève une erreur LISIBLE si invalide.
// Retourne un état FRAÎCHEMENT cloné (pas la référence interne).
export function deserialize(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Sauvegarde illisible (JSON corrompu)');
  }
  if (!raw || typeof raw !== 'object') throw new Error('Sauvegarde vide');
  if (raw.v !== SAVE_VERSION) {
    throw new Error(`Sauvegarde incompatible (v${raw.v ?? '?'} ≠ v${SAVE_VERSION})`);
  }
  const s = raw.state;
  if (!s || typeof s !== 'object') throw new Error('Sauvegarde sans état de jeu');
  for (const k of REQUIRED) {
    if (!(k in s)) throw new Error(`Champ manquant dans la sauvegarde : ${k}`);
  }
  const out = JSON.parse(JSON.stringify(s));
  // Le graphe pathfinding est reconstruit par la sim ; on ne le restaure pas.
  if (out.sim) { out.sim._graph = null; out.sim._graphDirty = true; }
  return out;
}

// --- Stockage navigateur (localStorage) — sans effet sous Node. --------------

// Y a-t-il une sauvegarde ? (pour proposer « Reprendre » au menu)
export function hasSave() {
  return typeof localStorage !== 'undefined' && localStorage.getItem(SAVE_KEY) !== null;
}

// Enregistre l'état ; retourne true si succès (l'UI fait le toast).
export function saveToStorage(state) {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false; // stockage plein / indisponible : on signale, on ne plante pas
  }
}

// Charge + valide depuis le stockage. Retourne l'état restauré, ou null si absente.
// Lève une erreur LISIBLE si la sauvegarde existe mais est invalide.
export function loadFromStorage() {
  if (typeof localStorage === 'undefined') return null;
  const json = localStorage.getItem(SAVE_KEY);
  if (json === null) return null;
  return deserialize(json);
}

// Efface la sauvegarde (après un chargement raté ou une nouvelle partie).
export function clearSave() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
}
