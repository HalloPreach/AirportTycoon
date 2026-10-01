// Assemblage de l'état global du jeu : l'état de base (machine à états, horloge,
// caméra) + l'objet de simulation. UN seul point d'entrée pour démarrer une partie.
// (game-state.mjs reste pure machine-à-états M1 ; la sim y est ajoutée ICI, pas là.)
import { newGame } from './game-state.mjs';
import { newSimState } from './sim-state.mjs';

export function makeGameState() {
  const state = newGame();
  state.sim = newSimState();
  return state;
}
