// Assemblage de l'état global du jeu : l'état de base (machine à états, horloge,
// caméra) + l'objet de simulation. UN seul point d'entrée pour démarrer une partie.
// (game-state.mjs reste pure machine-à-états M1 ; la sim y est ajoutée ICI, pas là.)
// A-2 (tranché) : aéroport de dÉPART FOURNI — une piste, un terminal minimal
// (2 portes M) et le taxiway qui les relie : le réseau est physiquement valide
// dès la première frame, sans aucune construction du joueur.
import { newGame } from './game-state.mjs';
import { newSimState } from './sim-state.mjs';
import { placeBuilding } from '../infra/infra.mjs';
import { DIFFICULTIES, normalizeDifficulty } from './difficulty.mjs';
import { ensureClock } from '../sim/clock.mjs'; // T3 (t_76744b22) : l'horloge de jeu (jour/nuit + saisons)
import { AIRPORTS, DEFAULT_AIRPORT } from './layouts.mjs'; // T3 stretch (t_79820790) : multi-aéroports

// Plan de départ (A-2) : le layout de l'aéroport « central » de la table
// AIRPORTS (T3 stretch, t_79820790 — additif : bit-à-bit IDENTIQUE au
// START_LAYOUT legacy, le spawn par défaut reste invariant). Les segments se
// TOUCHENT physiquement (règle BL-02) : la sortie de piste (800,1100) touche
// le taxiway (550..750, 1050..1090) et le taxiway touche le terminal
// (550..750, 900..1050) → findPath relie piste et portes dès le départ.
export const START_LAYOUT = AIRPORTS[DEFAULT_AIRPORT].layout;

export function makeGameState(seed = undefined, difficultyId = 'normal', airportId = DEFAULT_AIRPORT) {
  const state = newGame();
  state.sim = newSimState();
  // T2-1 (t_d5da994c) : la DIFFICULTÉ est une couche de paramètres AU SPAWN
  // (jamais de règle modifiée) : le profil choisi (easy/normal/hard,
  // DIFFICULTIES) pose le solde de départ (sim.economy.money) et les facteurs
  // du tick (sim.difficulty : incidentScale/opexFactor, lus par
  // incidents.mjs / economy.mjs avec repli référentiel). Le CHOIX vit sur
  // `state.difficulty` — sérialisé avec l'état entier (save.mjs) → il survit à
  // la sauvegarde/rechargement (comme state.intro / audio / scenario).
  // `difficultyId` corrompue/inconnue → normal (référentiel, pattern options).
  const diffId = normalizeDifficulty(difficultyId);
  const diff = DIFFICULTIES[diffId];
  state.difficulty = {
    id: diffId, name: diff.name, startFunds: diff.startFunds,
    incidentScale: diff.incidentScale, opexFactor: diff.opexFactor,
  };
  if (diff.startFunds !== state.sim.economy.money) {
    state.sim.economy.money = diff.startFunds; // solde de départ du profil
  }
  state.sim.difficulty = {
    incidentScale: diff.incidentScale, opexFactor: diff.opexFactor,
  };
  // T3 (t_76744b22) : l'HORLOGE DE JEU (sim.clock) — une nouvelle partie
  // démarre au JOUR 1, 08:00 (printemps, phase « jour » — l'état de
  // référence : le facteur de spawn ×1, la teinte du monde absente). La
  // SAISON est dérivée du jour (seasons.mjs) : la partie commence au
  // printemps, l'été suit au 2e jour-jeu (4 jours = 1 an-jeu).
  ensureClock(state.sim);
  // R09 (D3, tranché) : le seed de la partie est généré à la FRONTIÈRE DE
  // CRÉATION : entier 32 bits ALEATOIRE (31 bits + signe — Math.random × 2^31,
  // borné aux entiers 32 bits → sérialise proprement en JSON) pour qu'aucune
  // nouvelle partie ne soit jamais la même qu'une autre.
  // SEED IMPOSÉE (scénarios/proofs, D3) : makeGameState(42) → la partie est
  // reproductible EXACTEMENT (même seed + mêmes commandes → même suite).
  // Les outillages (tests, qa/probe-scenario.mjs) imposent le seed après coup
  // (sim.rngSeed = N) : effet IDENTIQUE (le champ vit sur la sim, il est
  // sérialisé — EV-10), pas de second mécanisme.
  // ponytail : Math.random pour l'UNIQUE seed (la suite de la sim reste 100 %
  // déterministe — le seed EST sa graine) ; crypto si on veut des parties
  // non-prévisibles adversariales (jamais besoin pour un jeu solo).
  if (seed === undefined) {
    state.sim.rngSeed = (Math.random() * 0x7FFFFFFF) | 0;
  } else if (Number.isInteger(seed)) {
    state.sim.rngSeed = seed; // seed imposée (scénarios) — l'outil borne déjà aux entiers
  }
  // R06 (D1) : préférence auto-accept = FAUX à la nouvelle partie. C'est le
  // champ du STATE (sérialisé en entier dans la sauvegarde), réinitialisé ici
  // pour que « nouvelle partie » reparte d'une préférence propre (et pas de
  // l'ancienne partie). main.mjs le pousse vers le miroir DOM (la case).
  state.planningAuto = false;
  // R20 : progression de l'introduction du premier cycle (UI, sérialisée avec
  // l'état entier → elle REPREND après sauvegarde ; « nouvelle partie » =
  // étape 1, non désactivée). Les deux états désactivants (done/skipped)
  // survivent au save/load : l'intro ne se re-suit pas après une reprise.
  state.intro = { step: 0, done: false, skipped: false };
  // Aéroport choisi (T3 stretch t_79820790) : le layout de l'aéroport est posé
  // par le placeBuilding EXISTANT (pas de règle de construction nouvelle) —
  // `airportId` inconnue/absente → « central » (spawn par défaut inchangé,
  // additif). Les tailles de portes par aéroport (Cap Nord : L, M, M, L —
  // profil DIFFÉRENT de l'aéroport central, 2 portes M).
  const airport = AIRPORTS[airportId] || AIRPORTS[DEFAULT_AIRPORT];
  for (const spec of airport.layout) {
    // Aéroport fourni : placement gratuit (pas de débit, pas de test de fonds).
    // Terminal minimal = 2 portes M (l'offre ne génère que des vols medium au
    // départ : porte S → vol bloqué en permanence = aéroport qui ne sert à rien).
    placeBuilding(state.sim, {
      id: state.sim.infra.nextId++, type: spec.type,
      x: spec.x, y: spec.y, w: spec.w, h: spec.h, cost: 0,
    }, spec.type === 'terminal' ? (airport.gateSizes || ['M', 'M']) : undefined);
  }
  return state;
}
