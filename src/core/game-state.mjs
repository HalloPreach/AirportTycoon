// État de base du jeu : machine à états, horloge (pause, vitesse).
// Logique PURE : aucun import DOM ni API navigateur → testable dans Node.
// ponytail: seed unique et terrain vide ; la sim (aléatoire semé) arrive plus tard.
export const SCREENS = Object.freeze({ MENU: 'menu', GAME: 'game' });
export const SPEEDS = Object.freeze([1, 2, 4]);

// Machine à états minimale : chaque écran ne peut aller que vers une liste bornée.
const TRANSITIONS = Object.freeze({
  menu: ['game'],      // nouvelle partie
  game: ['menu'],      // quitter (revenir au menu)
});

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function newGame() {
  return {
    screen: SCREENS.MENU,
    paused: false,
    speedIndex: 0, // index dans SPEEDS
    time: 0,       // temps de jeu écoulé (secondes)
    terrain: { w: 1600, h: 1200 }, // terrain vide du M1
    camera: { x: 800, y: 600, zoom: 1 }, // coordonnées monde du centre écran
  };
}

export function setScreen(state, to) {
  if (!canTransition(state.screen, to)) {
    throw new Error(`transition interdite : ${state.screen} → ${to}`);
  }
  state.screen = to;
  state.paused = false;
}

export function togglePause(state) {
  if (state.screen !== SCREENS.GAME) return;
  state.paused = !state.paused;
}

export function cycleSpeed(state) {
  state.speedIndex = (state.speedIndex + 1) % SPEEDS.length;
}

export function speedFactor(state) {
  return SPEEDS[state.speedIndex];
}

// Horloge : dt = secondes réelles ; retourne les secondes de JEU écoulées.
// 0 si en pause ou hors de l'écran de jeu ; sinon dt × facteur de vitesse.
export function advanceTime(state, dt) {
  if (state.screen !== SCREENS.GAME || state.paused) return 0;
  const played = dt * speedFactor(state);
  state.time += played;
  return played;
}
