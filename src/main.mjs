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
import { makePlanningPanel } from './ui/planning-panel.mjs';
import { makePanels } from './ui/panels.mjs';
import { drawNetworkOverlay } from './ui/overlay.mjs';
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
  const renderer = makeRenderer(canvas, {
    overlays: [
      buildTool.drawGhost,
      // R18 : overlay réseau/capacités (touche O, préférence d'affichage
      // `state.networkOverlay`, inactive par défaut) : LECTURE SEULE — le
      // même graphe et la même règle que la sim (voir ui/overlay.mjs).
      (ctx, cam, vs) => { if (state.networkOverlay && state.sim) drawNetworkOverlay(ctx, cam, vs, state.sim); },
    ],
  });
  makeInputHandlers(canvas, bus, camera, renderer.viewSize);
  // Panneaux de consultation (NONMVP-5) : inspection / bilan / stats / alertes
  // / diagnostic réseau — UI fine, lecture seule (aucune règle, aucune mutation).
  const panels = makePanels({
    state, camera,
    viewSize: () => ({ width: canvas.width, height: canvas.height }),
    buildTool,
  });

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
    // R07 : la sélection d'inspection (pick) pointe vers les objets de l'ANCIENNE
    // sim — elle doit disparaître à la nouvelle partie (sinon le panneau « inspection »
    // montre un avion fantôme de la partie précédente).
    panels.invalidate();
    // R06 (D1) : makeGameState() réinitialise planningAuto à false (champ du
    // state, sérialisé) → l'Object.assign ci-dessus PORTE le reset (source
    // unique dans la factory). On ne fait que resynchroniser le miroir DOM
    // (la case auto-accept suit l'état) — pas un second reset parallèle.
    planningPanel.setAuto(false);
    state._alertSeen = 0;
    clearSave(); // une nouvelle partie efface l'ancienne sauvegarde (« Reprendre » = la partie en cours)
    setScreen(state, SCREENS.GAME);
    toasts.toast('Nouvelle partie — aéroport fourni, étends-le (B)', 'ok');
  }

  // R06 (D1) : la préférence auto-accept a UNE seule source de vérité
  // (state.planningAuto) et UNE seule commande (setPlanningAuto). La touche A
  // ET la case du panneau passent toutes deux par cette commande → plus de
  // flag local (panel.auto) qui se désynchroniserait de l'état.
  function setPlanningAuto(on) {
    state.planningAuto = !!on;
    planningPanel.setAuto(!!on); // le miroir DOM (la case) suit l'état
    toasts.toast(on ? 'Auto-accept ON' : 'Auto-accept OFF', 'info');
  }
  // Panneau planning (BL-16, AC20) : liste consultable des vols + accepter/refuser
  // + case auto-accept (politique JOUEUR — la décision sim reste decideFlight).
  // (créé AVANT savePanel : le load synchronise la case sur state.planningAuto).
  // La case émet onAutoChange = setPlanningAuto : la MÊME commande que la touche A.
  const planningPanel = makePlanningPanel({ state, toast: toasts.toast, onAutoChange: setPlanningAuto });
  state.planningAuto = false; // préférence par défaut : source sérialisée sur le state

  // Panneau sauvegarde (S sauvegarder, L charger).
  const savePanel = makeSavePanel(state, {
    toast: toasts.toast,
    // Après un load : la préférence auto-accept est sur le state restauré —
    // la case du panneau doit suivre (sinon le DOM et la logique se désynchronisent).
    syncPlanningPanel: () => planningPanel.setAuto(!!state.planningAuto),
    // R07 : la sélection d'inspection (pick) pointe vers un OBJET DE L'ANCIENNE
    // SIM (disparu après le load) — panels.invalidate() le vide pour qu'elle
    // n'affiche plus un avion fantôme (sinon le DOM du panneau restait « parti
    // — plus en simulation » de la partie précédente).
    onLoad: () => panels.invalidate(),
  });

  // Alertes de la sim → toasts lisibles (on consomme les NOUVELLES seulement).
  // Les événements de la sim ont la forme { kind, why?, ... } (voir sim-state).
  const ALERT_MSG = {
    'flight-in': (e) => `Arrivée ${e.airline || ''} (${e.acType || ''})`,
    'flight-out': (e) => `Départ ${e.airline || ''}`,
    'flight-cancelled': (e) => `Vol annulé — ${e.why || 'attente trop longue'}`,
    'ac-blocked': (e) => `Avion bloqué — ${e.why || 'taxiway'}`,
    // BL-14 : incidents opérationnels (perturbation → conséquence → récupération).
    'runway-closed': (e) => `Incident — ${e.why || 'fermeture piste'}`,
    'fuel-out': (e) => `Incident — ${e.why || 'panne station carburant'}`,
    'surge-start': (e) => `Pic de demande — ${e.why || 'plus de vols planifiés'}`,
    'unlocked': (e) => `${e.name} débloqué(e) (construction possible)`,
    'locked': (e) => `${e.name} : ${e.need} passagers transportés requis`,
    'bankrupt': () => 'FAILLITE — les caisses sont vides',
  };
  // R14 : un tick qui lève (bug de règle, état corrompu) arrive ici via
  // 'sim-error' (voir loop.mjs) — erreur lisible en toast, le jeu ne crashe pas.
  // Throttle : le tick peut rejeter à CHAQUE frame (erreur persistante) ; on
  // n'affiche la MÊME erreur qu'une fois par fenêtre, et on la laisse
  // ré-apparaître au bout de 30 s si elle persiste (pas un spam à chaque frame).
  let lastSimErrorText = null;
  let lastSimErrorAt = 0;
  bus.on('sim-error', (e) => {
    const text = `Erreur de simulation : ${e?.message || 'inconnue'}`;
    const now = Date.now();
    if (text === lastSimErrorText && now - lastSimErrorAt < 30000) return;
    lastSimErrorText = text;
    lastSimErrorAt = now;
    toasts.toast(text, 'err');
  });

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

  // Planificateur : la case « auto-accept » (politique joueur, BL-16) s'applique
  // avant le tick — les vols acceptés ici sont DÉPLOIÉS par la sim au prochain
  // passage de son horaire (la sim ne décide jamais elle-même).
  bus.on('frame', () => {
    if (state.planningAuto) planningPanel.tickAuto();
    planningPanel.refresh(); // reconstruction des lignes seulement si le planning a changé
    panels.refresh(); // idem (signature) : DOM stable tant que l'état ne change pas
  });

  // Clavier global : les touches de déplacement restent dans input.mjs ;
  // ici les commandes UI (construire, sauvegarder, vitesse).
  const KINDS = ['runway', 'taxiway', 'terminal', 'fuel', 'hangar', 'catering', 'cleaning', 'baggage'];
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'n') { if (state.screen === SCREENS.MENU) startNewGame(); }
    else if (k === 'r') { if (state.screen === SCREENS.MENU && savePanel.loadNow()) state.screen = SCREENS.GAME; }
    else if (k === 'f') { if (state.screen === SCREENS.GAME) cycleSpeed(state); }
    else if (k === 's') savePanel.saveNow();
    else if (k === 'l') savePanel.loadNow();
    else if (k === 'b') buildTool.toggleBuild();
    else if (k === 'x') buildTool.toggleDemolish();
    else if (k === 'a') setPlanningAuto(!state.planningAuto);
    else if (k === 'o') {
      // R18 : overlay réseau/capacités (O) — préférence d'affichage sur l'état
      // (sérialisée : on rechargé, l'overlay reste tel qu'on l'avait laissé).
      state.networkOverlay = !state.networkOverlay;
      toasts.toast(state.networkOverlay
        ? 'Overlay réseau ON (O pour couper) — segments occupés + portes coupées'
        : 'Overlay réseau OFF', 'info');
    }
    else if (k >= '1' && k <= '8') buildTool.setKind(KINDS[Number(k) - 1]);
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
    panels,
  };
}

// Démarrage réel seulement dans le navigateur : sous Node, l'import reste sans effet (testable).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot(document.getElementById('game'));
}
