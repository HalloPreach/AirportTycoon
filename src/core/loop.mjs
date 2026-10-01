// Boucle de jeu : requestAnimationFrame, dt clampé, horloge + rendu.
// S'exécute uniquement dans le navigateur (rAF) ; les tests Node n'importent jamais ce module.
import { advanceTime } from './game-state.mjs';

export function startLoop({ state, bus, renderer }) {
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // clamp : pas de spirale de la mort après une coupure d'onglet
    last = now;
    advanceTime(state, dt); // avance l'horloge si le jeu est actif et non en pause
    bus.emit('frame', dt);  // l'UI (caméra clavier) consomme le dt, elle ne décide pas
    renderer.render(state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
