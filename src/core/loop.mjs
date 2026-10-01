// Boucle de jeu : requestAnimationFrame, dt clampé, horloge + rendu.
// S'exécute uniquement dans le navigateur (rAF) ; les tests Node n'importent jamais ce module.
import { advanceTime } from './game-state.mjs';
import { simTick } from './sim.mjs';

export function startLoop({ state, bus, renderer }) {
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // clamp : pas de spirale de la mort après une coupure d'onglet
    last = now;
    const played = advanceTime(state, dt); // horloge (pause → 0, x1/x2/x4 appliqué)
    simTick(state, played);  // la sim avance au TEMPS DE JEU (sinon x4 = sim à vitesse x1)
    bus.emit('frame', dt);  // l'UI (caméra clavier) consomme le dt, elle ne décide pas
    renderer.render(state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
