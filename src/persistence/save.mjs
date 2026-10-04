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
//
// R10 (schéma explicite + migration) — la validation couvre :
//   - version stricte : v ≠ courante → rejet lisible (pas de migration : le jeu est
//     local/offline, une sauvegarde trop ancienne est REFUSÉE, jamais migrée —
//     politique D4 : rejet dur + cas non migrables documentés ici et dans la doc).
//   - identifiants : UN id par avion et par liste d'infra (pas de doublon qui
//     casserait les lookups gateNodeOf/runwayExitNode et les réservations).
//   - capacités : le type d'avion (acType) doit être UN CATÉLOGUE CONNU — la
//     vitesse de l'avion EST dérivée de ce type (AIRCRAFT[acType].approach/taxi),
//     un type inconnu ferait crasher le 1er tick (spec.minRunway undefined).
//   - références des DEUX côtés : avion → piste/porte EXISTANTE (déjà, A10) ET
//     porte → avion EXISTANT (g.acId : une porte « réservée » à un avion disparu
//     serait bloquée à JAMAIS — on la rejette proprement).
//   - chemins non restaurables : le chemin (ac.path, indices de nœuds du graphe)
//     EST reconstruit par la sim au 1er tick (rebuildGraph, R03) — on ne le
//     restaure PAS, on le marque dérivé. On valide seulement que, S'il est présent,
//     c'est bien un TABLEAU (une path corrompue en nombre/objet ferait crashe le
//     rebuild) ; la reconstruction elle-même gère « pas de chemin » → blocage lisible.
//   - dérivés NON restaurés comme source : `sim._graph` ET `sim.infra.grid` (grille
//     d'occupation) sont des CACHES DÉRIvés recalculés à partir des bâtiments —
//     ils sont RETIRÉS de la copie de sortie (replacer) puis RECONSTRUITS au
//     chargement (pas d'écriture dupliquée : la source reste l'infra, pas la cache).
//   - files passagers : si `passengers` est présent, queue/groups/satisfaction sont
//     des types CONSISTANTS (le tick passagers les avance — un type corrompu
//     rendrait les files NaN).
// ponytail: version de schéma entière (un chiffre). Si un futur champ casse le
// format, on bump SAVE_VERSION et on rejette l'ancienne au lieu de crasher.
import { AIRCRAFT } from '../data/catalog.mjs';
import { buildGrid } from '../infra/infra.mjs';
import { ensureAssignments } from '../infra/assignments.mjs'; // R27 : migration des affectations
import { ensureUpgrades } from '../infra/upgrades.mjs'; // R31 : migration des améliorations (niveau 0 absent)
import { ensureIncidents } from '../sim/incidents.mjs'; // R32 : migration + purge des incidents attachés
import { ensureLoan } from '../economy/economy.mjs'; // R35 : migration de l'emprunt borné (champ absent)

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
  // R35 (t_dabe90d7) : l'emprunt borné (economy.loan) — PRÉSENT doit être un
  // objet {principal, count} numériques (la lecture loanState / le bilan les
  // lit — un type corrompu ferait NaN dans la sim au 1er tick). Absent =
  // sauvegarde ancienne, tolérée (ensureLoan au chargement, pattern R31).
  if (isObj(sim.economy) && 'loan' in sim.economy && !isObj(sim.economy.loan)) {
    throw new Error('Sauvegarde invalide : emprunt (economy.loan) illisible');
  }
  if (isObj(sim.economy) && isObj(sim.economy.loan)) {
    for (const k of ['principal', 'count']) {
      if (k in sim.economy.loan && !isFiniteNum(sim.economy.loan[k])) {
        throw new Error(`Sauvegarde invalide : emprunt (${k}) non numérique`);
      }
    }
  }
  // R35 : le compteur d'alertes de trésorerie (cooldown) SI présent est un objet
  // (des horodatages) — un type corrompu ferait la re-prévention spammer.
  if (isObj(sim.economy) && isObj(sim.economy._treasuryAlerts)) {
    for (const v of Object.values(sim.economy._treasuryAlerts)) {
      if (!isFiniteNum(v)) throw new Error('Sauvegarde invalide : alerte de trésorerie non numérique');
    }
  }
  // EV-10 : l'état du PRNG, SI présent, doit être des entiers 32 bits (seed + compteur).
  if (sim.rngSeed !== undefined && !Number.isInteger(sim.rngSeed)) {
    throw new Error('Sauvegarde invalide : seed du générateur non entier');
  }
  if (sim.rngCounter !== undefined && !Number.isInteger(sim.rngCounter)) {
    throw new Error('Sauvegarde invalide : compteur du générateur non entier');
  }
  // Identifiants + références : chaque bâtiment/avion PRÉSENT a un id UNIQUE ; un
  // avion qui pointe vers une piste/porte doit viser un id EXISTANT (pas une
  // référence périmée) ; R10 : la porte qui pointe vers un avion doit aussi viser
  // un avion EXISTANT (référence des DEUX côtés) et le type d'avion doit être connu
  // (capacité : la vitesse est dérivée du type).
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
  // R10 (identifiants) : UN id par liste d'infra — un doublon casserait les lookups
  // (gateNodeOf / runwayExitNode) et les réservations. On détecte par liste.
  for (const list of lists) {
    const seen = new Set();
    for (const b of list) {
      if (seen.has(b.id)) throw new Error(`Sauvegarde invalide : identifiant infra en double (${b.id})`);
      seen.add(b.id);
    }
  }
  const runwayIds = new Set((isArr(infra && infra.runways) ? infra.runways : []).map((r) => r.id));
  const gateIds = new Set((isArr(infra && infra.gates) ? infra.gates : []).map((g) => g.id));
  const acIds = new Set();
  if (isArr(sim.aircraft)) for (const ac of sim.aircraft) {
    if (!isObj(ac) || ac.id == null) throw new Error('Sauvegarde invalide : avion sans identifiant');
    // R10 (identifiants) : un avion par id — un doublon double-compterait la
    // réservation de porte / le segment (les deux avions visaient le même id).
    if (acIds.has(ac.id)) throw new Error(`Sauvegarde invalide : avion ${ac.id} en double`);
    acIds.add(ac.id);
    // R10 (capacités) : le TYPE d'avion doit être au CATALOGUE — la vitesse et les
    // contraintes (piste/porte) en sont dérivées ; un type inconnu ferait crasher
    // le 1er tick (AIRCRAFT[acType] undefined → spec.minRunway undefined).
    if (ac.acType !== undefined && !AIRCRAFT[ac.acType]) {
      throw new Error(`Sauvegarde invalide : type avion inconnu « ${ac.acType} » (avion ${ac.id})`);
    }
    if (!PHASES.has(ac.phase)) throw new Error(`Sauvegarde invalide : phase inconnue « ${ac.phase} »`);
    // R10 (chemin non restaurable) : le chemin est un CACHÉ DÉRIVÉ du graphe
    // (indices de nœuds) — il est RECONSTRUIT au 1er tick (rebuildGraph, R03).
    // On ne le restaure PAS ; on valide seulement que, s'il est PRÉSENT (ni null
    // ni undefined — « pas de chemin en cours » est légitime, ex. phase approche),
    // c'est bien un TABLEAU (une path corrompue en chaîne/nombre ferait crasher le
    // rebuild). La reconstruction gère « pas de chemin » → blocage lisible.
    if (ac.path != null && !isArr(ac.path)) {
      throw new Error(`Sauvegarde invalide : chemin non restaurable (avion ${ac.id})`);
    }
    if (ac.runwayId != null && !runwayIds.has(ac.runwayId)) {
      throw new Error(`Sauvegarde invalide : avion ${ac.id} → piste inexistante ${ac.runwayId}`);
    }
    if (ac.gateId != null && !gateIds.has(ac.gateId)) {
      throw new Error(`Sauvegarde invalide : avion ${ac.id} → porte inexistante ${ac.gateId}`);
    }
  }
  // R41 : les incidents attachés aux actifs (sim.incidents, R32) — PRÉSENT doit
  // être un objet (les sous-objets i.runways/i.fuels + horloges y vivent) : un
  // type corrompu (null/chaîne) passerait la validation puis serait ÉCRASÉ par
  // ensureIncidents au chargement (l'état incident perdu sans erreur lisible).
  // ABSENT = sauvegarde pré-R32, tolérée (ensureIncidents le re-attache).
  if ('incidents' in sim && sim.incidents != null && typeof sim.incidents !== 'object') {
    throw new Error('Sauvegarde invalide : incidents (sim.incidents) illisibles');
  }
  // R41 : même classe de défaut pour les passagers (R30) : un champ PRÉSENT
  // mais non-objet (chaîne, nombre) ferait crasher le 1er tick (ensurePassengers
  // écrit les totaux sur la valeur). null = sauvegarde ancienne, tolérée.
  if ('passengers' in sim && sim.passengers != null && typeof sim.passengers !== 'object') {
    throw new Error('Sauvegarde invalide : passagers (sim.passengers) illisibles');
  }
  // R10 (références des DEUX côtés) : une porte RÉSERVÉE (g.acId) doit viser un
  // avion EXISTANT. Sans ça, une porte « occupée » par un avion disparu resterait
  // verrouillée à JAMAIS (demolish refuse « porte occupée ») → on la rejette.
  if (isObj(infra) && isArr(infra.gates)) for (const g of infra.gates) {
    if (g.acId != null && !acIds.has(g.acId)) {
      throw new Error(`Sauvegarde invalide : porte ${g.id} réservée par un avion inexistant (${g.acId})`);
    }
  }
  // R10 (files passagers) : si `passengers` est PRÉSENT, les structures sont des
  // types CONSISTANTS — le tick les avance (q[stage] -= …) : un champ non
  // numérique rendrait les files NaN et la satisfaction non bornée.
  // R30 : les files sont PAR TERMINAL (queues[terminalId] = {checkin,security,
  // board}) + compteurs de flux par terminal (injectedTotal/securityDone) ; les
  // groupes (gr.volId) servent au comptage unique. L'ancienne file GLOBALE
  // `queue` (pré-R30) est tolérée (sauvegarde ancienne) mais plus lue.
  if (isObj(sim.passengers)) {
    const pq = sim.passengers.queues;
    if (isObj(pq)) for (const [tid, q] of Object.entries(pq)) {
      if (isObj(q)) for (const s of ['checkin', 'security', 'board']) {
        if (s in q && !isFiniteNum(q[s])) {
          throw new Error(`Sauvegarde invalide : file passagers « ${s} » (terminal ${tid}) non numérique`);
        }
      }
    }
    // Compteurs de flux par terminal (R30) : objets terminalId → nombre.
    for (const k of ['injectedTotal', 'securityDone']) {
      if (k in sim.passengers && isObj(sim.passengers[k])) {
        for (const v of Object.values(sim.passengers[k])) {
          if (v !== undefined && !isFiniteNum(v)) {
            throw new Error(`Sauvegarde invalide : compteur passagers « ${k} » non numérique`);
          }
        }
      }
    }
    if ('groups' in sim.passengers && !isArr(sim.passengers.groups)) {
      throw new Error('Sauvegarde invalide : groupes de passagers non listable');
    }
  }
  // R31 (t_7a512737) : améliorations de capacité PAR TERMINAL —
  // sim.upgrades[terminalId] = { terminal, fueling, teams } (niveaux entiers).
  // ABSENTE = sauvegarde ancienne (tolérée, ensureUpgrades au chargement) ;
  // PRÉSENTE mais de mauvais type (objet non lisible, niveau non numérique)
  // → REJETÉE (les multiplicateurs feraient NaN dans la sim au 1er tick).
  if (isObj(sim.upgrades)) {
    for (const [tid, t] of Object.entries(sim.upgrades)) {
      if (!isObj(t)) throw new Error(`Sauvegarde invalide : améliorations du terminal ${tid} illisibles`);
      for (const k of ['terminal', 'fueling', 'teams']) {
        if (k in t && !Number.isInteger(t[k])) {
          throw new Error(`Sauvegarde invalide : niveau d'amélioration « ${k} » (terminal ${tid}) non entier`);
        }
      }
    }
  }
}

// Sérialise un état de jeu en chaîne JSON (stockable). FONCTION PURE (A11) :
// le replacer retire les caches DÉRIvés de la COPIE de sortie SANS toucher à
// l'objet vivant — la partie en cours reste intacte. Deux caches dérivées sont
// recalculées à partir des bâtiments (la SOURCE) au chargement, donc on ne les
// persiste PAS :
//   - `sim._graph` (grapphe pathfinding, Maps/Sets) → reconstruit (R03).
//   - `sim.infra.grid` (grille d'occupation, Uint8Array) → `buildGrid` la
//     recalcule. Non persistée : un Uint8Array sérialise en 19200 clés
//     numériques (gigantesque) et au retour JSON devient `{}` → `fits()`
//     lirait chaque cellule comme VIDE (on construirait par-dessus tout).
export function serialize(state) {
  return JSON.stringify(
    { v: SAVE_VERSION, state },
    (key, value) => (key === '_graph' || key === 'grid' ? undefined : value),
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
  if (out.sim) {
    out.sim._graph = null; out.sim._graphDirty = true;
    // R09 (migration, D3) : les anciennes sauvegardes n'avaient PAS de seed
    // effectif — le générateur ne consommait que rngCounter (le champ rngSeed
    // n'existait pas, ou valait 0 = la suite d'origine). Absent/illisible →
    // migration seed 0 + compteur 0 : la suite redevient EXACTEMENT la suite
    // pré-R09 (bit-à-bit, l'ancrage des fixtures de migration evidence/seed-*)
    // ET la partie reste reproductible à la reprise.
    if (!Number.isInteger(out.sim.rngSeed)) out.sim.rngSeed = 0;
    if (!Number.isInteger(out.sim.rngCounter)) out.sim.rngCounter = 0;
    // R10 (valeurs dérivées) : la GRILLE D'OCCUPATION (`infra.grid`) est un
    // cache dérivé des BÂTIMENTS (la source) — elle est recalculée ici depuis
    // l'infra, pas restaurée (pas d'écriture dupliquée). `buildGrid` remplit
    // w/h/cells depuis les 5 listes ; on garantit leur présence (absente → []).
    if (isObj(out.sim.infra)) {
      const infra = out.sim.infra;
      for (const k of ['runways', 'taxiways', 'terminals', 'gates', 'services']) {
        if (!Array.isArray(infra[k])) infra[k] = [];
      }
      if (!isObj(infra.grid)) infra.grid = {}; // buildGrid remplit w/h/cells
      buildGrid(out.sim);
    }
    // R27 (t_6424937a) : migration des AFFECTATIONS de services — les
    // sauvegardes pré-R27 n'ont pas de champ `target` : ensureAssignments
    // applique la règle du placement (terminal le plus proche, DETERMINISTE)
    // aux services sans affectation, et réaffecte ceux devenus orphelins
    // (terminal supprimé entre-temps). Le retour (nombre de services touchés)
    // est lisible : l'UI peut annoncer la migration.
    ensureAssignments(out.sim);
    // R31 (t_7a512737) : migration des AMÉLIORATIONS de capacité — les
    // sauvegardes pré-R31 n'ont pas de champ `upgrades` : ensureUpgrades
    // crée l'objet vide (niveaux 0 par défaut — on ne RE-débite jamais au
    // chargement, le niveau est la source du coût déjà payé).
    ensureUpgrades(out.sim);
    // R32 (t_9f267552) : migration des INCIDENTS attachés aux actifs — les
    // sauvegardes pré-R32 ont les 3 commutateurs GLOBAUX (runway/fuel/surge)
    // et pas les objets i.runways/i.fuels (fermeture PISTE / panne STATION
    // attachées). ensureIncidents crée les sous-objets manquants ET PURGE les
    // enregistrements dont l'actif a été supprimé (pas de référence orpheline)
    // — l'état et le calendrier (compteurs acc/last) survivent à la reprise.
    ensureIncidents(out.sim);
    // R35 (t_dabe90d7) : l'emprunt borné (economy.loan) — les sauvegardes
    // pré-R35 ont le champ ABSENT (comme upgrades/incidents : toléré, la
    // factory le met par défaut ; on ne réinvente pas la migration ici).
    ensureLoan(out.sim);
  }
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
