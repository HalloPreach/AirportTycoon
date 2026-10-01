// Assemblage de l'état global du jeu : l'état de base (machine à états, horloge,
// caméra) + l'objet de simulation. UN seul point d'entrée pour démarrer une partie.
// (game-state.mjs reste pure machine-à-états M1 ; la sim y est ajoutée ICI, pas là.)
// A-2 (tranché) : aéroport de dÉPART FOURNI — une piste, un terminal minimal
// (2 portes M) et le taxiway qui les relie : le réseau est physiquement valide
// dès la première frame, sans aucune construction du joueur.
import { newGame } from './game-state.mjs';
import { newSimState } from './sim-state.mjs';
import { placeBuilding } from '../infra/infra.mjs';

// Plan de départ (A-2) : la géométrie prouvée du test « bien conçu » — les
// segments se TOUCHENT physiquement (règle BL-02) : la sortie de piste (800,1100)
// touche le taxiway (550..750, 1050..1090) et le taxiway touche le terminal
// (550..750, 900..1050) → findPath relie piste et portes dès le départ.
const START_LAYOUT = Object.freeze([
  { type: 'runway', x: 750, y: 100, w: 100, h: 1000 },
  { type: 'taxiway', x: 550, y: 1050, w: 200, h: 40 },
  { type: 'terminal', x: 550, y: 900, w: 200, h: 150 },
]);

export function makeGameState() {
  const state = newGame();
  state.sim = newSimState();
  for (const spec of START_LAYOUT) {
    // Aéroport fourni : placement gratuit (pas de débit, pas de test de fonds).
    // Terminal minimal = 2 portes M (l'offre ne génère que des vols medium au
    // départ : porte S → vol bloqué en permanence = aéroport qui ne sert à rien).
    placeBuilding(state.sim, {
      id: state.sim.infra.nextId++, type: spec.type,
      x: spec.x, y: spec.y, w: spec.w, h: spec.h, cost: 0,
    }, spec.type === 'terminal' ? ['M', 'M'] : undefined);
  }
  return state;
}
