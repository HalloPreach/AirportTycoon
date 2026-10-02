// Sauvegarde / chargement : sérialisation + validation de schéma + stockage navigateur.
// Les fonctions de LOGIQUE (serialize/deserialize) sont PURES (aucun DOM, aucune
// localStorage) → testables dans Node. Les wrappers de stockage (saveToStorage /
// loadFromStorage / clearSave) touchent localStorage et ne s'exécutent QUE dans le
// navigateur (le guard `typeof localStorage` les rend sans effet sous Node).
//
// Règle : on sérialise l'objet `state` entier (l'état global contient déjà la sim,
// conçue pour être sérialisable toute seule). La version de schéma permet de
// REJETER proprement une sauvegarde invalide ou trop ancienne (règle robuste).
//
// BL-08 (R6) :
//   A11 : serialize() est une FONCTION PURE — elle ne modifie JAMAIS l'état d'origine.
//         Le cache dérivé `sim._graph` (Maps/Sets en mémoire) est retiré de la COPIE
//         de sortie via un replacer, sans toucher à l'objet vivant.
//   A10 : deserialize() VALIDLE le schéma au chargement (types, identifiants,
//         références, capacités). Une sauvegarde invalide (ex : runways = null) est
//         REJETÉE proprement (erreur lisible) — le 1er tick ne crashe plus.
//   EV-10: l'état du générateur aléatoire (seed + compteur) est conservé dans la
//         sauvegarde pour reproductibilité (déterminisme).
// ponytail: version de schéma entière (un chiffre). Si un futur champ casse le
// format, on bump SAVE_VERSION et on rejette l'ancienne au lieu de crasher.

export const SAVE_KEY = 'airport-tycoon-save';
export const SAVE_VERSION = 1;
// Copie diagnostic : une sauvegarde invalide est PRÉSERVÉE ici (jamais supprimée),
// pour qu'un opérateur puisse l'inspecter sans bloquer le jeu (A10, brief).
export const DIAG_KEY = 'airport-tycoon-save-diag';

// Ce qu'un état valide doit contenir (champs minimum). On valide ce qu'on RECHARGE.
// `sim` n'est pas requis : une partie M1 (terrain vide, pas de sim) est rechargeable.
const REQUIRED = ['screen', 'time', 'terrain', 'camera'];

// --- Validation du schéma (A10) ---------------------------------------------
// Vérifie types / identifiants / références / capacités. Lève une erreur LISIBLE
// (qui nomme le défaut) au PREMIER problème. Une sauvegarde produite par ce jeu
// est toujours cohérente : ces contrôles ne rejettent que les sauvegardes
// corrompues ou falsifiées, jamais une sauvegarde valide.
function isArr(v) { return Array.isArray(v); }
function isObj(v) { return v && typeof v === 'object'; }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function validateSim(sim) {
  if (!isObj(sim)) throw new Error('Sauvegarde invalide : sim absente ou illisible');
  // Politique : un champ ABSENT (sim M1, sim minimale) est toléré ; un champ PRÉSENT
  // mais de mauvais type (ex : runways = null, A10) est REFUSÉ. On valide donc
  // ce qui EST là, sans exiger la structure complète d'une partie moderne.
  const infra = sim.infra;
  if (isObj(infra)) {
    // Types : un tableau d'infra PRÉSENT doit être un vrai tableau (jamais null — A10).
    for (const k of ['runways', 'taxiways', 'terminals', 'gates', 'services']) {
      if (k in infra && !isArr(infra[k])) {
        throw new Error(`Sauvegarde invalide : sim.infra.${k} non listable`);
      }
    }
  }
  // Types : les listes de jeu PRÉSENTES doivent être des tableaux / objets.
  if ('aircraft' in sim && !isArr(sim.aircraft)) throw new Error('Sauvegarde invalide : sim.aircraft non listable');
  if (isObj(sim.economy) && !isFiniteNum(sim.economy.money)) {
    throw new Error('Sauvegarde invalide : solde de trésorerie non numérique');
  }
  // EV-10 : l'état du PRNG, SI présent, doit être des entiers 32 bits (seed + compteur).
  if (sim.rngSeed !== undefined && !Number.isInteger(sim.rngSeed)) {
    throw new Error('Sauvegarde invalide : seed du générateur non entier');
  }
  if (sim.rngCounter !== undefined && !Number.isInteger(sim.rngCounter)) {
    throw new Error('Sauvegarde invalide : compteur du générateur non entier');
  }
  // Identifiants + références : chaque bâtiment/avion PRÉSENT a un id ; un avion qui
  // pointe vers une piste/porte doit viser un id EXISTANT (pas une référence périmée).
  // BL-12 : « refuel » (remise à niveau carburant) rejoint la liste des phases.
  const PHASES = new Set(['approach', 'holding', 'landing', 'exit', 'taxi', 'docking',
    'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked',
    'departed', 'cancelled']);
  const lists = [];
  if (isObj(infra)) for (const k of ['runways', 'taxiways', 'terminals', 'gates', 'services']) {
    if (isArr(infra[k])) lists.push(infra[k]);
  }
  for (const list of lists) for (const b of list) {
    if (!isObj(b) || b.id == null) throw new Error('Sauvegarde invalide : bâtiment sans identifiant');
  }
  const runwayIds = new Set((isArr(infra && infra.runways) ? infra.runways : []).map((r) => r.id));
  const gateIds = new Set((isArr(infra && infra.gates) ? infra.gates : []).map((g) => g.id));
  if (isArr(sim.aircraft)) for (const ac of sim.aircraft) {
    if (!isObj(ac) || ac.id == null) throw new Error('Sauvegarde invalide : avion sans identifiant');
    if (!PHASES.has(ac.phase)) throw new Error(`Sauvegarde invalide : phase inconnue « ${ac.phase} »`);
    if (ac.runwayId != null && !runwayIds.has(ac.runwayId)) {
      throw new Error(`Sauvegarde invalide : avion ${ac.id} → piste inexistante ${ac.runwayId}`);
    }
    if (ac.gateId != null && !gateIds.has(ac.gateId)) {
      throw new Error(`Sauvegarde invalide : avion ${ac.id} → porte inexistante ${ac.gateId}`);
    }
  }
}

// Sérialise un état de jeu en chaîne JSON (stockable). FONCTION PURE (A11) :
// le replacer retire `sim._graph` (cache dérivé Maps/Sets) de la COPIE de sortie
// SANS toucher à l'objet vivant — la partie en cours reste intacte. La sim
// reconstruit le graphe au prochain tick (via `_graphDirty`).
export function serialize(state) {
  return JSON.stringify(
    { v: SAVE_VERSION, state },
    (key, value) => (key === '_graph' ? undefined : value),
  );
}

// Dé-sérialise + VALIDE le schéma (A10). Lève une erreur LISIBLE si invalide.
// Retourne un état FRAÎCHEMENT cloné (pas la référence interne).
export function deserialize(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Sauvegarde illisible (JSON corrompu)');
  }
  if (!isObj(raw)) throw new Error('Sauvegarde vide');
  if (raw.v !== SAVE_VERSION) {
    throw new Error(`Sauvegarde incompatible (v${raw.v ?? '?'} ≠ v${SAVE_VERSION})`);
  }
  const s = raw.state;
  if (!isObj(s)) throw new Error('Sauvegarde sans état de jeu');
  for (const k of REQUIRED) {
    if (!(k in s)) throw new Error(`Champ manquant dans la sauvegarde : ${k}`);
  }
  // A10 : validation des structures de sim (types / identifiants / références / capacités).
  if ('sim' in s) validateSim(s.sim);
  const out = JSON.parse(JSON.stringify(s));
  // Le graphe pathfinding est un cache dérivé : il est RECONSTRUIT par la sim au
  // 1er tick, on ne le restaure pas (marqué sale pour forcer la reconstruction).
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
// A10 : une sauvegarde invalide n'est JAMAIS supprimée — elle est PRÉSERVÉE
// (copie diagnostic, DIAG_KEY) pour qu'un opérateur puisse l'inspecter, puis
// l'erreur (lisible) est relancée pour que l'UI l'annonce (toast, sans crash).
export function loadFromStorage() {
  if (typeof localStorage === 'undefined') return null;
  const json = localStorage.getItem(SAVE_KEY);
  if (json === null) return null;
  try {
    return deserialize(json);
  } catch (e) {
    preserveDiag(json); // copie diagnostic (l'original reste EN PLACE, rien n'est perdu)
    throw e;
  }
}

// Efface la sauvegarde (après un chargement raté ou une nouvelle partie).
export function clearSave() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
}

// Préserve une COPIE DIAGNOSTIC d'une sauvegarde invalide (A10, brief).
// On ne supprime JAMAIS la sauvegarde d'origine : elle est dupliquée ici pour
// qu'un opérateur puisse l'inspecter, puis l'UI peut choisir de continuer.
export function preserveDiag(json) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(DIAG_KEY, String(json));
    return true;
  } catch {
    return false; // stockage plein : on n'écrase pas le diagnostic, on ne plante pas
  }
}
