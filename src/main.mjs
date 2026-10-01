// Point d'entrée du jeu (navigateur). Câble : état, bus, caméra, entrées, rendu, boucle.
// Aucune règle de jeu ici — juste du câblage UI (règle : l'UI est fine).
import { newGame, setScreen, togglePause, cycleSpeed, SCREENS } from './core/game-state.mjs';
import { EventBus } from './core/events.mjs';
import { Camera } from './ui/camera.mjs';
import { makeInputHandlers } from './ui/input.mjs';
import { makeRenderer } from './ui/renderer.mjs';
import { startLoop } from './core/loop.mjs';

export function boot(canvas) {
  const state = newGame();
  const bus = new EventBus();
  const renderer = makeRenderer(canvas);
  const camera = new Camera(state);
  makeInputHandlers(canvas, bus, camera, renderer.viewSize);

  // Commandes de bas niveau : l'UI émet, l'état tranche.
  bus.on('pause', () => togglePause(state));
  bus.on('quit', () => { if (state.screen === SCREENS.GAME) setScreen(state, SCREENS.MENU); });

  // N = nouvelle partie (au menu) ; F = vitesse x1/x2/x4 (en jeu).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') {
      if (state.screen === SCREENS.MENU) {
        Object.assign(state, newGame()); // même objet : caméra et boucle gardent leurs références
        setScreen(state, SCREENS.GAME);
      }
    } else if (e.key === 'f' || e.key === 'F') {
      if (state.screen === SCREENS.GAME) cycleSpeed(state);
    }
  });

  startLoop({ state, bus, renderer });

  // Surface de commande fine, exposée aux tests/CDP (pas de règle de jeu, juste les commandes UI)
  window.__game = {
    state,
    camera,
    startNewGame: () => { Object.assign(state, newGame()); setScreen(state, SCREENS.GAME); },
    togglePause: () => togglePause(state),
    cycleSpeed: () => cycleSpeed(state),
    quitToMenu: () => { if (state.screen === SCREENS.GAME) setScreen(state, SCREENS.MENU); },
  };
}

// Démarrage réel seulement dans le navigateur : sous Node, l'import reste sans effet (testable).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot(document.getElementById('game'));
}
