// Point d'entrée du jeu (navigateur). Câble : état, bus, caméra, entrées, rendu, boucle,
// UI fine (toasts, outil construction, panneau sauvegarde). Aucune règle de jeu ici —
// juste du câblage (règle : l'UI est fine, elle lit l'état et émet des commandes).
import { newGame, setScreen, togglePause, cycleSpeed, SCREENS } from './core/game-state.mjs';
import { EventBus } from './core/events.mjs';
import { Camera } from './ui/camera.mjs';
import { makeInputHandlers } from './ui/input.mjs';
import { makeRenderer } from './ui/renderer.mjs';
import { startLoop } from './core/loop.mjs';
import { makeToasts } from './ui/toast.mjs';
import { makeBuildTool } from './ui/build-tool.mjs';
import { makeSavePanel } from './ui/save-panel.mjs';
import { clearSave } from './persistence/save.mjs';
import { makeGameState } from './core/new-game.mjs';

export function boot(canvas) {
  const state = newGame();
  const bus = new EventBus();
  const camera = new Camera(state);
  const toasts = makeToasts(document.body);
  const buildTool = makeBuildTool({
    canvas, state,
    camera,
    viewSize: () => ({ width: canvas.width, height: canvas.height }),
    toast: toasts.toast,
  });
  const renderer = makeRenderer(canvas, { overlays: [buildTool.drawGhost] });
  makeInputHandlers(canvas, bus, camera, renderer.viewSize);

  // Commandes de bas niveau : l'UI émet, l'état tranche.
  bus.on('pause', () => togglePause(state));
  // Quitter le jeu (Q / Échap au menu) : sauvegarde AUTOMATIQUE silencieuse avant
  // le menu, pour que « Recharger » (critères 12-13) retrouve l'état joué.
  bus.on('quit', () => { savePanel.autoSave(); if (state.screen === SCREENS.GAME) setScreen(state, SCREENS.MENU); });

  // Nouvelle partie (A-2) : état frais + aéroport de départ fourni (piste + terminal
  // 2 portes + taxiway, réseau physiquement valide). makeGameState est synchrone :
  // Object.assign remplace tout l'état sur l'objet suivi par la boucle de jeu.
  function startNewGame() {
    const fresh = makeGameState();
    Object.assign(state, fresh); // mêmes références (state.sim = fresh.sim)
    state._alertSeen = 0;
    clearSave(); // une nouvelle partie efface l'ancienne sauvegarde (« Reprendre » = la partie en cours)
    setScreen(state, SCREENS.GAME);
    toasts.toast('Nouvelle partie — aéroport fourni, étends-le (B)', 'ok');
  }

  // Panneau sauvegarde (S sauvegarder, L charger).
  const savePanel = makeSavePanel(state, { toast: toasts.toast });

  // Alertes de la sim → toasts lisibles (on consomme les NOUVELLES seulement).
  // Les événements de la sim ont la forme { kind, why?, ... } (voir sim-state).
  const ALERT_MSG = {
    'flight-in': (e) => `Arrivée ${e.airline || ''} (${e.acType || ''})`,
    'flight-out': (e) => `Départ ${e.airline || ''}`,
    'flight-cancelled': (e) => `Vol annulé — ${e.why || 'attente trop longue'}`,
    'ac-blocked': (e) => `Avion bloqué — ${e.why || 'taxiway'}`,
    'unlocked': (e) => `${e.name} débloqué(e) (construction possible)`,
    'locked': (e) => `${e.name} : ${e.need} passagers transportés requis`,
    'bankrupt': () => 'FAILLITE — les caisses sont vides',
  };
  bus.on('frame', () => {
    const sim = state.sim;
    if (!sim || !sim.alerts) return;
    if (state._alertSeen === undefined) state._alertSeen = 0;
    for (let i = state._alertSeen; i < sim.alerts.length; i++) {
      const a = sim.alerts[i];
      if (!a || !a.kind) continue;
      const text = (ALERT_MSG[a.kind] || ((e) => a.why || a.kind))(a);
      toasts.toast(text, a.kind === 'bankrupt' ? 'err' : a.kind.startsWith('ac-') || a.kind === 'flight-cancelled' ? 'err' : 'info');
    }
    state._alertSeen = sim.alerts.length;
  });

  // Clavier global : les touches de déplacement restent dans input.mjs ;
  // ici les commandes UI (construire, sauvegarder, vitesse).
  const KINDS = ['runway', 'taxiway', 'terminal', 'fuel', 'hangar'];
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'n') { if (state.screen === SCREENS.MENU) startNewGame(); }
    else if (k === 'r') { if (state.screen === SCREENS.MENU && savePanel.loadNow()) state.screen = SCREENS.GAME; }
    else if (k === 'f') { if (state.screen === SCREENS.GAME) cycleSpeed(state); }
    else if (k === 's') savePanel.saveNow();
    else if (k === 'l') savePanel.loadNow();
    else if (k === 'b') buildTool.toggleBuild();
    else if (k === 'x') buildTool.toggleDemolish();
    else if (k >= '1' && k <= '5') buildTool.setKind(KINDS[Number(k) - 1]);
  });

  // Sauvegarde AUTOMATIQUE raisonnable (brief) : en quittant la page et toutes
  // les 2 min en jeu. Silencieuse (pas de toast) ; le slot unique = la partie
  // en cours. ponytail : intervalle fixe 120 s ; on n'écrira pas un debounce
  // intelligent tant que la taille de la sauvegarde reste négligeable.
  setInterval(() => savePanel.autoSave(), 120000);
  window.addEventListener('beforeunload', () => savePanel.autoSave());

  // Échap : annule l'outil actif SANS mettre en pause ; sinon = pause (rôle M1).
  // input.mjs ne gère plus Échap (récupéré ici pour que l'outil ait la priorité).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (buildTool.isActive()) buildTool.cancel();
    else bus.emit('pause');
  });

  startLoop({ state, bus, renderer });

  // Surface de commande fine, exposée aux tests/CDP (pas de règle de jeu, juste les commandes UI)
  window.__game = {
    state,
    camera,
    startNewGame,
    togglePause: () => togglePause(state),
    cycleSpeed: () => cycleSpeed(state),
    quitToMenu: () => { if (state.screen === SCREENS.GAME) setScreen(state, SCREENS.MENU); },
    save: () => savePanel.saveNow(),
    load: () => savePanel.loadNow(),
    autoSave: () => savePanel.autoSave(),
    canResume: () => savePanel.canResume(),
    buildTool,
    toasts,
  };
}

// Démarrage réel seulement dans le navigateur : sous Node, l'import reste sans effet (testable).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot(document.getElementById('game'));
}
