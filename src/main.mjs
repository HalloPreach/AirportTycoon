// Point d'entrée du jeu (navigateur). Câble : état, bus, caméra, entrées, rendu, boucle,
// UI fine (toasts, outil construction, panneau sauvegarde). Aucune règle de jeu ici —
// juste du câblage (règle : l'UI est fine, elle lit l'état et émet des commandes).
import { newGame, setScreen, togglePause, cycleSpeed, SCREENS, SPEEDS } from './core/game-state.mjs';
import { EventBus } from './core/events.mjs';
import { Camera } from './ui/camera.mjs';
import { makeInputHandlers } from './ui/input.mjs';
import { makeTouchHandlers } from './ui/touch.mjs'; // T6 (t_87168414) : tactile (pan/pinch/tap)
import { makeRenderer } from './ui/renderer.mjs';
import { makeOptionsPage, loadOptions, saveOptionsToStorage, normalizeOptions } from './ui/options.mjs'; // R43 : options persistantes
import { startLoop } from './core/loop.mjs';
import { makeToasts } from './ui/toast.mjs';
import { makeBuildTool } from './ui/build-tool.mjs';
import { makeSavePanel } from './ui/save-panel.mjs';
import { makePlanningPanel } from './ui/planning-panel.mjs';
import { makePanels } from './ui/panels.mjs';
import { makeIntro } from './ui/intro.mjs';
import { makeTips } from './ui/tips.mjs'; // T4 (t_eb78478e) : les 5 astuces d'onboarding (une fois, persistées)
import { makeBankruptcyScreen, resumeCommand } from './ui/bankruptcy.mjs'; // R35 : écran de faillite (bilan + décisions)
import { makeJuice, juiceForAlert } from './ui/juice.mjs'; // Juice (t_5065be95) : feedback visuel léger (UI, lecture seule)
import { makeAudioEngine, sfxForAlert, normalizeAudioState } from './audio.mjs'; // R44 (t_ebbb202e) : synthèse audio (0 asset) + SFX par alerte
import { drawNetworkOverlay } from './ui/overlay.mjs';
import { clearSave } from './persistence/save.mjs';
import { BUILDINGS } from './data/catalog.mjs'; // T33 (t_88aee6d5) : la liste clavier des bâtiments suit le catalogue
import { makeGameState } from './core/new-game.mjs';
import { DIFFICULTIES, DIFFICULTY_IDS, normalizeDifficulty } from './core/difficulty.mjs'; // T2-1 : la difficulté
import { SCENARIOS, startScenario, scenarioObjective } from './scenarios.mjs'; // R38 : les 3 scénarios rejouables

export function boot(canvas) {
  const state = newGame();

  // R43 : options PERSISTANTES (volume / mode daltonien / vitesse) — une clé
  // localStorage DEDICACE (separée de la sauvegarde de jeu) : elles survivent
  // à une nouvelle partie et à une suppression de save. `state.options` est le
  // miroir VIVANT que le renderer lit (palette) et que la page options édite ;
  // main.mjs est le SEUL PONT : persistance (options.mjs) + synchro du
  // state.speedIndex (les vitesses EXISTANTES SPEEDS, jamais réinventées).
  const options = normalizeOptions(loadOptions());
  state.options = options;
  state.speedIndex = options.speedIndex; // la vitesse enregistrée s'applique au démarrage
  // R44 (t_ebbb202e) : le moteur de SYNTHESE audio (Web Audio, 0 asset) — la
  // ponytail R43 est morte : le VOLUME (option R43, 0-100) pilote setVolume
  // en LIVE et le MUTE persiste via la SAUVEGARDE (state.audio = { muted },
  // sérialisé avec l'état entier par save.mjs). Sans AudioContext (Node, CI)
  // le moteur est en mode « dry » : play() journalise, jamais d'erreur.
  const audio = makeAudioEngine();
  audio.setVolume(options.volume / 100);
  // Commande UNIQUE de synchro : le mute suit l'ÉTAT (nouvelle partie,
  // scénario, load) — un seul point de vérité (state.audio).
  function syncAudioMute() { audio.setMuted(!!(state.audio && state.audio.muted)); }
  syncAudioMute();
  const bus = new EventBus();
  const camera = new Camera(state);

  // T51 (t_cccfbc97) : les PANNEAUX DE JEU (barre de construction, panneaux de
  // consultation, planning) ne flottent PAS au-dessus du MENU. Au menu, leur
  // racine DOM est masquée (display:none) ; au retour en jeu, elle réapparaît.
  // Bascule UNIQUEMENT au CHANGEMENT d'écran (pas à chaque frame) : la valeur
  // ne change que sur une transition. Les racines sont exposées par les
  // modules (bar / col / box) ; `.menu-btns`, `.intro` et `.toasts` restent
  // affichés au menu (boutons du menu + carte intro + toasts).
  const gamePanelRoots = [];
  let gamePanelsHidden = null;
  function syncGamePanelsVisibility() {
    const hidden = state.screen === 'menu';
    if (hidden === gamePanelsHidden) return;
    gamePanelsHidden = hidden;
    for (const p of gamePanelRoots) {
      if (p) p.style.display = hidden ? 'none' : '';
    }
  }
  const toasts = makeToasts(document.body);
  // R43 : page OPTIONS (volume / daltonien / vitesse) — UI fine : elle édite
  // l'objet options VIVANT (state.options, le miroir lu par le renderer) et,
  // à la validation, émet onApply : main.mjs persiste (clé dédiée) +
  // synchronise la VITESSE LIVE (state.speedIndex, les SPEEDS existantes) +
  // toast. « Retour au menu » referme la page — closure comme l'écran de
  // faillite : le clic n'arrive qu'après l'initialisation complète.
  const optionsPage = makeOptionsPage(state, options, {
    onApply: (o) => {
      // R44 (t_ebbb202e) : retour sonore du clic (chaque bouton de la page
      // options passe par onApply) + le volume PERSISTÉ (R43) pilote le moteur.
      audio.play('uiClick');
      audio.setVolume(o.volume / 100);
      state.speedIndex = o.speedIndex; // vitesse appliquée LIVE (x1/x2/x4 existantes)
      if (!saveOptionsToStorage(o)) {
        toasts.toast('Options appliquées mais non enregistrées (stockage indisponible)', 'warn');
        return;
      }
      toasts.toast('Options enregistrées', 'ok');
    },
    onBack: () => optionsPage.close(),
  });
  // R20 : boutons SOURIS des commandes du jeu (les raccourcis clavier P/F/S/L
  // restent — la souris est la voie première, les touches complètent). Les
  // actions référencent `savePanel` (déclaré plus bas dans boot) par closure :
  // le clic n'arrive qu'après l'initialisation complète — aucun problème de
  // portée. Le clic émet la MÊME commande que la touche (UI fine : pas de règle).
  const controls = [
    { label: 'Pause (P)', key: 'P',
      action: () => togglePause(state),
      labelOf: (s) => (s.paused ? 'Reprendre (P)' : 'Pause (P)'),
      activeOf: (s) => s.paused },
    { label: 'Vitesse (F)', key: 'F',
      action: () => cycleSpeed(state),
      labelOf: (s) => `Vitesse x${SPEEDS[s.speedIndex]} (F)` },
    { label: 'Sauvegarder (S)', key: 'S',
      action: () => savePanel.saveNow() },
    { label: 'Charger la sauvegarde (L)', key: 'L',
      action: () => savePanel.loadNow() },
  ];
  // Juice (t_5065be95) : feedback visuel léger — particules, nombres €, shake,
  // animations de panneaux. Module UI pur : lecture seule sur la sim (zéro règle),
  // avancé à chaque frame (bus 'frame'), rendu par le renderer.
  const juice = makeJuice();
  const buildTool = makeBuildTool({
    canvas, state,
    camera,
    viewSize: () => ({ width: canvas.width, height: canvas.height }),
    toast: toasts.toast,
    // Juice : éclats + € perdus au point de pose (la sim a déjà débité le coût —
    // on l'APRÈS-CHOC, jamais avant).
    onPlaced: (b) => {
      juice.burst(b.x + b.w / 2, b.y + b.h / 2);
      if (b.cost > 0) juice.float(b.x + b.w / 2, b.y + b.h / 2, `−${b.cost} $`, 'loss');
    },
    // Juice : démolition — la position est lue AVANT la suppression (objet `hit`),
    // le remboursement est lu SUR LE VERDICT de la sim (r.refund, jamais recalculé).
    onDemolished: (hit, r) => {
      juice.burst(hit.x + hit.w / 2, hit.y + hit.h / 2);
      if (r.refund > 0) juice.float(hit.x + hit.w / 2, hit.y + hit.h / 2, `+${r.refund} $`, 'gain');
    },
    controls,
  });
  // R20 : commandes du MENU en boutons souris (N nouvelle partie / R reprise)
  // — les touches restent en raccourci (le texte du menu les note).
  // T2-1 (t_d5da994c) : la DIFFICULTÉ du menu — PARAMÈTRE DU PROCHAIN SPAWN
  // (jamais une règle) : le choix vit ici (sélecteur du menu principal),
  // part à la création de la partie via makeGameState(undefined, menuDifficulty)
  // et SÉRIALISE sur state.difficulty (il survit à la sauvegarde/rechargement,
  // core/difficulty.mjs). Un load (onLoad ci-dessous) le synchronise sur la
  // partie chargée ; une valeur corrompue retombe au référentiel normal.
  let menuDifficulty = 'normal';
  function resumeFromSave() { if (state.screen === SCREENS.MENU && savePanel.loadNow()) state.screen = SCREENS.GAME; }
  const menuCommands = {
    newGame: startNewGame,
    resume: resumeFromSave,
    canResume: () => savePanel.canResume(),
    // R38 : les TROIS scénarios rejouables (boutons du menu) — le mode LIBRE
    // (« Nouvelle partie ») est conservé : il reste makeGameState() sans
    // scenario (pas de champ, pas d'objectif annoncé).
    scenario: (mode) => startScenarioGame(mode),
    scenarioModes: () => Object.entries(SCENARIOS).map(([id, c]) => ({ id, label: c.name })),
    // R43 : la page options (volume / daltonien / vitesse) s'ouvre aussi en
    // BOUTON dans le menu (clavier : V — la touche O est déjà l'overlay
    // réseau R18, non modifiée).
    openOptions: () => optionsPage.open(),
    // T2-1 (t_d5da994c) : la SÉLECTION DE DIFFICULTÉ du menu (boutons Facile /
    // Normal / Difficile, renderer.mjs) — les profils viennent de
    // core/difficulty.mjs ; le choix (menuDifficulty) est le paramètre du
    // prochain startNewGame et se normalise (inconnu/corrompu → normal).
    difficultyModes: () => DIFFICULTY_IDS.map((id) => ({ id, label: DIFFICULTIES[id].name })),
    difficulty: () => menuDifficulty,
    setDifficulty: (id) => { menuDifficulty = normalizeDifficulty(id); },
  };
  const renderer = makeRenderer(canvas, {
    overlays: [
      buildTool.drawGhost,
      // R18 : overlay réseau/capacités (touche O, préférence d'affichage
      // `state.networkOverlay`, inactive par défaut) : LECTURE SEULE — le
      // même graphe et la même règle que la sim (voir ui/overlay.mjs).
      (ctx, cam, vs) => { if (state.networkOverlay && state.sim) drawNetworkOverlay(ctx, cam, vs, state.sim); },
    ],
    onMenuCommands: menuCommands,
    // R39 (t_1c21c88e) : l'entouré de SÉLECTION suit le clic carte (panels.mjs)
    // — le closure lit `panels` au moment du rendu (déclaré plus bas, initialisé
    // avant la 1re frame) ; la règle reste dans panels (pick), le renderer lit.
    selectionOf: () => (panels && panels.selectionOf ? panels.selectionOf() : null),
    // R43 : la palette suit l'option daltonienne (miroir live state.options,
    // lu à chaque frame) — le renderer ne décide rien, il LIT la palette.
    paletteOf: () => (state.options ? state.options.colorBlind : false),
    // Juice (t_5065be95) : shake (translate monde) + rendu particules/nombres €.
    juice,
  });
  makeInputHandlers(canvas, bus, camera, renderer.viewSize);
  // Panneaux de consultation (NONMVP-5) : inspection / bilan / stats / alertes
  // / diagnostic réseau — UI fine, lecture seule (aucune règle, aucune mutation).
  const panels = makePanels({
    state, camera,
    viewSize: () => ({ width: canvas.width, height: canvas.height }),
    buildTool,
  });

  // T6 (t_87168414) : ENTRÉE TACTILE — pan 1 doigt, pinch zoom 2 doigts,
  // tap = click. Le TAP est routé vers LE MÊME chemin que le click desktop
  // (buildTool.clickAt + panels.clickAt — une seule logique par module,
  // zéro duplication). Desktop : aucun événement touch ne se produit, le
  // comportement souris/clavier est intact.
  makeTouchHandlers(canvas, camera, () => ({ width: canvas.width, height: canvas.height }), {
    onTap: (sx, sy) => {
      buildTool.clickAt(sx, sy); // pose / démolition (l'outil gère sa priorité)
      panels.clickAt(sx, sy);    // sélection d'inspection (R39)
    },
  });

  // R20 : introduction du PREMIER CYCLE (carte courte, désactivable — « Passer
  // l'intro » / « Terminer ») : accepter un vol → observer sa porte → finances
  // → goulot → investir. UI fine (aucune règle) ; la progression est sur
  // `state.intro` (sérialisée → elle reprend après sauvegarde).
  const intro = makeIntro(state);

  // T4 (t_eb78478e) : les 5 ASTUCES d'onboarding (non intrusives — un toast
  // doré 9 s, une seule fois chacune : la persistance est sur `state.tips.seen`,
  // sérialisée avec la sauvegarde → jamais de rediffusion). LECTURE SEULE de
  // la sim ; le DOM passe par le toast EXISTANT (options.mjs, R28/BL-01).
  const tips = makeTips(state, {
    toast: (text, o) => toasts.toast(text, o && o.kind, o),
  });

  // R35 : l'ÉCRAN de faillite (bilan + décisions : reprendre / nouvelle
  // partie) — UI fine : l'UI émet l'intention, la sim règle (resumeAfter-
  // Bankruptcy) ; l'écran s'ouvre/ferme sur le flag de la sim (frame).
  // « Nouvelle partie » = le vrai startNewGame du menu (défini plus bas —
  // le clic n'arrive qu'après l'initialisation, closure, comme le panel).
  const bankruptcyScreen = makeBankruptcyScreen(state, document.body, {
    onResume: () => { if (state.sim) resumeCommand(state.sim); },
    onNewGame: () => startNewGame(),
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
    // T2-1 (t_d5da994c) : la DIFFICULTÉ choisie au menu est le PARAMÈTRE DU
    // SPAWN (jamais une règle) : makeGameState l'applique (capital + facteurs
    // du tick) et la SÉRIALISE sur state.difficulty.
    const fresh = makeGameState(undefined, menuDifficulty);
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
    clearSave(); // une nouvelle partie efface l'ancienne sauvegarde (« Reprendre » = la partie en cours)
    state.speedIndex = options.speedIndex; // R43 : la vitesse ENREGISTRÉE s'applique (la préférence persiste entre les parties)
    setScreen(state, SCREENS.GAME);
    syncAudioMute(); // R44 (t_ebbb202e) : le mute suit l'état FRAIS (nouvelle partie)
    // T2-1 : le toast annonce la DIFFICULTÉ et son capital de départ (lecture
    // de l'état — l'UI n'affiche, la sim règle).
    const diff = DIFFICULTIES[menuDifficulty];
    toasts.toast(`Nouvelle partie — ${diff.name} : capital ${fresh.sim.economy.money} $ (aéroport fourni, étends-le (B))`, 'ok');
  }

  // R38 : DÉMARRER UN SCÉNARIO (guide / saturation / redressement) — l'état
  // frais est celui du SCÉNARIO (startScenario : seed imposée + config EXPLICITE
  // sur la sim + le marqueur state.scenario). MÊME câblage qu'une nouvelle
  // partie : Object.assign sur l'état suivi par la boucle, invalidation de
  // l'inspection, reset du miroir DOM, effacement de la sauvegarde. L'objectif
  // R22 annoncé est affiché en TOAST au lancement (l'UI n'affiche, la sim règle).
  // « Nouvelle partie » (mode libre) reste makeGameState() sans scenario.
  function startScenarioGame(mode) {
    const fresh = startScenario(mode);
    Object.assign(state, fresh); // mêmes références (state.sim = fresh.sim)
    panels.invalidate();
    planningPanel.setAuto(false);
    clearSave(); // une partie scénario efface l'ancienne sauvegarde
    state.speedIndex = options.speedIndex; // R43 : idem nouvelle partie — la vitesse enregistrée s'applique
    setScreen(state, SCREENS.GAME);
    syncAudioMute(); // R44 (t_ebbb202e) : le mute suit l'état FRAIS (scénario)
    // L'OBJECTIF ANNONCÉ (le R22 du scénario) en toast — lecture de l'état.
    const o = scenarioObjective(state);
    toasts.toast(
      o
        ? `Scénario ${fresh.scenario.name} — objectif : ${o.name} (${o.reward} $). ${o.text}`
        : `Scénario ${fresh.scenario.name}`,
      'ok',
    );
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

  // T7 (t_0f131a58) — EXCLUSIVITÉ MOBILE (≤560px) : les bandes PLANNING et
  // CONSULTATION ne sont JAMAIS dépliées EN MÊME TEMPS — déplier l'une replie
  // l'autre (via les hooks onFoldChange des deux modules : un seul point de
  // branchement, les modules ne se connaissent pas). La carte garde ≥45 % de
  // la hauteur d'écran même dépliée (calcul QA t7 : 54,9 % au pire cas —
  // consultation dépliée 30vh + planning replié 44px + toolbar 48px).
  // DESKTOP : aucun appelant (les bandes sont toujours dépliées, .fold masqué
  // par CSS) — le branchement est inerte, le comportement desktop est intact.
  // Sous Node (tests) : pas de matchMedia → mqT7 null, hooks non branchés.
  const mqT7 = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia('(max-width: 560px)') : null;
  if (mqT7) {
    planningPanel.onFoldChange = (open) => {
      if (open && mqT7.matches) panels.setFold(false);
    };
    panels.onFoldChange = (open) => {
      if (open && mqT7.matches) planningPanel.setFold(false);
    };
  }

  // T7b (t_d1005365) — OGL DESKTOP : le bandeau « Vols » (planning) est
  // RÉGISTRÉ comme pane de la colonne de consultation (panels.registerPane)
  // — la barre d'onglets de la colonne pilote le contenu, un panneau à la
  // fois (l'onglet actif par défaut = Vols, le plus utile). Le bandeau est
  // re-parenté dans la zone du panneau (zone.appendChild) : sur desktop il
  // n'est plus un élément fixed en haut à droite, il vit dans la colonne
  // (CSS `.panels .planning { position: static }`).
  // MOBILE (≤560px) : le bandeau reste SA PROPRE bande du haut (bandes
  // exclusives T7 — le hook ci-dessus est conservé) → le pane 'vols' est
  // désenregistré (le bouton d'onglet « Vols » est masqué par CSS dans la
  // bande consultation, index.html) et le bandeau retourne au body.
  // Sous Node (tests) : pas de matchMedia → aucun branchement (inerte).
  const mqT7b = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia('(min-width: 561px)') : null;
  if (mqT7b) {
    function syncVolsPane() {
      if (mqT7b.matches) panels.registerPane('vols', planningPanel.box);
      else {
        panels.unregisterPane('vols');
        document.body.appendChild(planningPanel.box); // le bandeau redevient sa bande du haut
      }
    }
    syncVolsPane();
    mqT7b.addEventListener('change', syncVolsPane); // resize traversant le seuil 560px
  }

  // T51 (t_cccfbc97) : les 3 racines de panneaux de JEU entrent dans la
  // synchronisation menu/jeu (barre de construction / panneaux de consultation /
  // planning) — masquées au menu, réaffichées au retour en jeu.
  // (APRÈS la construction des 3 modules : leurs racines DOM existent.)
  gamePanelRoots.push(buildTool.box, panels.col, planningPanel.box);

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
    onLoad: () => {
      panels.invalidate();
      // R43 : le load peut porter un champ options (sauvegarde post-R43) — on
      // RE-ATTACHE le miroir VIVANT (l'objet `options` du boot) : source unique
      // de vérité des options (clé dédiée, pas du champ de la sauvegarde).
      // La page options et le renderer (palette) restent donc synchrones.
      state.options = options;
      // R44 (t_ebbb202e) : le mute SUIVANT l'état chargé (persisté dans la
      // sauvegarde) ; une sauvegarde PRÉ-R44 n'a pas le champ → normalisation
      // défensive (non muet, jamais de crash — même pattern que R35/ensureLoan).
      state.audio = normalizeAudioState(state.audio);
      syncAudioMute();
      // T2-1 (t_d5da994c) : la partie CHARGÉE porte SA difficulté
      // (state.difficulty, migrée par ensureDifficulty dans save.mjs si absente
      // — une sauvegarde PRÉ-T2-1 retombe au référentiel normal, sans crash) :
      // le SÉLECTEUR DU MENU la suit (la prochaine « Nouvelle partie »
      // repart de cette difficulté — le choix du joueur n'est pas perdu au
      // chargement). Normalisation défensive (pattern options : repli normal).
      if (state.difficulty && state.difficulty.id) {
        menuDifficulty = normalizeDifficulty(state.difficulty.id);
      }
    },
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
    'unlocked': (e) => `${e.name} débloqué(e) (construction possible)${e.detail ? ` — ${e.detail}` : ''}`,
    'locked': (e) => `${e.name} : ${e.why || e.need || 'non débloqué'}`,
    'bankrupt': () => 'FAILLITE — les caisses sont vides',
    // R35 : les alertes de TRÉSORERIE (deux niveaux, cooldown — economy.mjs) :
    // l'avertissement AVANT la faillite (ignorer → la pente atteint le seuil).
    'treasury-warn': (e) => `Trésorerie : le solde s'amenuit (${e.money} $, sous ${e.below} $) — l'emprunt est dans le bilan financier`,
    'treasury-critical': (e) => `URGENCE TRÉSORERIE : le déficit s'approfondit (${e.money} $, sous ${e.below} $) — empruntez ou la faillite arrive`,
    'loan-taken': (e) => `Emprunt obtenu : +${e.principal} $ de liquidités, ${e.interest} $ d'intérêts (compte dette)`,
    'bankruptcy-resumed': () => 'Reprise : la simulation continue depuis le bilan',
    // R39 (t_1c21c88e) : les RETOURS d'action (intervention / récupération /
    // objectif) sont TOASTS lisibles — l'UI affiche, la sim règle (règle
    // inchangée). L'ACHAT déjà toasté par build-tool (succès ET motif d'échec)
    // n'est PAS re-toasté ici (pas de doublon) : l'événement 'built' reste dans
    // l'historique d'alertes, pas dans le flux de toasts.
    'runway-reopen': (e) => `Piste de nouveau ouverte${e.why ? ` — ${e.why}` : ''}`,
    'fuel-back': (e) => `Station carburant de nouveau en service${e.why ? ` — ${e.why}` : ''}`,
    'planning-relief': (e) => `Allègement du planning : ${e.count} vol(s) refusé(s) — ${e.why || 'revenu perdu'}`,
    'objective-paid': (e) => `OBJECTIF RÉUSSI : ${e.name} — récompense +${e.reward} $`,
    // T2-2 (t_6344db94) : la campagne (victoire) + les succès (la sim émet,
    // l'UI affiche — même règle qu'objective-paid R22).
    'campaign-won': (e) => `SAISON REMPORTÉE — ${e.wins}/${e.target} contrats réussis : prime +${e.reward} $`,
    // T3 (t_4c9baadc) : la couche d'événements dynamiques — l'événement
    // (nom + raison) ; sa conséquence est lisible dans l'outil concerné
    // (offre du planning, cadence du planificateur), l'UI ne règle rien.
    'event-start': (e) => `Événement — ${e.name || e.event || ''}${e.why ? ` : ${e.why}` : ''}`,
    'campaign-lost': (e) => `Saison échouée — ${e.wins}/${e.target} contrats avant l'échéance (le jeu continue)`,
    'achievement-unlocked': (e) => `SUCCÈS DÉBLOQUÉ : ${e.name} — ${e.desc}`,
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
    // R39 (t_1c21c88e) : les ALERTES SE REPÉTENT (arrivées/départs en rafale à
    // x4, pics de demande) — on GROUPE les événements IDENTIQUES d'une même
    // fournée (même kind) en UN toast « (×n) » : moins de spam, même contenu.
    // L'historique (panneau) garde les événements bruts — c'est le flux de
    // toasts qui est résumé, pas la règle.
    // R39 (t_1c21c88e) : on consomme par SEQ (sim._alertSeq / sim._alertTotal,
    // définis sur la sim dans sim-state.mjs), PAS par index de tableau — la
    // fenêtre glissante (max 500) décale les indices, mais le seq ne change
    // jamais : les toasts ne s'arrêtent JAMAIS après 500 événements (bug
    // index : le curseur index fige à la longueur plafonnée et plus aucun
    // événement n'était lu). Le curseur vit SUR LA SIM (pas sur `state`) : il
    // voyage avec elle (new game = sim fraîche à 0, load = restauré de la
    // sauvegarde) → zéro désynchro avec le compteur, sans reset manuel.
    if (sim._alertSeq == null) sim._alertSeq = 0;
    let pendingKind = null;
    let pendingText = null;
    let pendingKindClass = 'info';
    let pendingCount = 0;
    const flush = () => {
      if (pendingCount) {
        toasts.toast(pendingCount > 1 ? `${pendingText} (×${pendingCount})` : pendingText, pendingKindClass);
        // R44 (t_ebbb202e) : la contrepartie AUDIO du toast groupé — MÊME porte
        // (un son par GROUPE de frame, « ×n ») : une rafale (vols en rafale à
        // x4, pic de demande) ne CASCADERA pas 10 sons (pas de murail sonore).
        // Le mapping est PUR (kind → SFX) : un kind inconnu sonne le SILENCE.
        const sfx = sfxForAlert(pendingKind);
        if (sfx) audio.play(sfx);
      }
      pendingKind = null; pendingText = null; pendingCount = 0;
    };
    for (const a of sim.alerts) {
      // seq null = événement d'une sauvegarde PRÉ-R39 (sans seq) → considéré déjà consommé
      // (sinon les 500 événements restaurés seraient re-toastés à chaque frame).
      if (!a || !a.kind || a.seq == null || a.seq <= sim._alertSeq) continue;
      sim._alertSeq = a.seq; // curseur : le dernier seq CONNU (pas seulement lu-en-fine)
      // Juice (t_5065be95) : feedback visuel par événement NOUVEAU (même porte
      // seq que le toast) — particules/€ lu sur la sim, shake incident majeur.
      // Lecture seule : la sim n'est jamais modifiée ici.
      juiceForAlert(juice, sim, a, camera);
      const text = (ALERT_MSG[a.kind] || ((e) => a.why || a.kind))(a);
      const cls = a.kind === 'bankrupt' || a.kind === 'treasury-critical' || a.kind === 'campaign-lost'
        ? 'err' : a.kind === 'treasury-warn' || a.kind === 'loan-taken'
        ? 'warn' : a.kind.startsWith('ac-') || a.kind === 'flight-cancelled' ? 'err' : 'info';
      if (a.kind === pendingKind) { pendingCount++; continue; } // identique → on compte
      flush();
      pendingKind = a.kind;
      pendingText = text;
      pendingKindClass = cls;
      pendingCount = 1;
    }
    flush();
  });

  // Planificateur : la case « auto-accept » (politique joueur, BL-16) s'applique
  // avant le tick — les vols acceptés ici sont DÉPLOIÉS par la sim au prochain
  // passage de son horaire (la sim ne décide jamais elle-même).
  bus.on('frame', (dt) => {
    syncGamePanelsVisibility(); // T51 : bascule menu/jeu (garde : no-op sauf transition)
    juice.update(dt); // Juice (t_5065be95) : particules/nombres/shake avancent au temps réel
    if (state.planningAuto) planningPanel.tickAuto();
    planningPanel.refresh(); // reconstruction des lignes seulement si le planning a changé
    panels.refresh(); // idem (signature) : DOM stable tant que l'état ne change pas
    // R20 : l'intro (carte du premier cycle) + les boutons de commandes
    // (vitesse/pause reflètent l'état courant) suivent à chaque frame.
    intro.refresh();
    tips.refresh(); // T4 : les astuces vérifient leurs conditions (toast une fois, jamais de rediffusion)
    bankruptcyScreen.refresh(); // R35 : l'écran suit le flag de la sim (open/fermé + peinture)
    optionsPage.refresh(); // R43 : la page options suit l'état (valeurs des boutons)
    buildTool.refreshControls();
  });

  // Juice (t_5065be95) : animations légères des panneaux (ENTRÉES re-affichées) —
  // l'écran de faillite et la carte d'intro sont masqués puis REAFFICHÉS : une
  // animation CSS seule ne se rejoue pas, donc la machine juice.fx (testée dans
  // tests/juice.test.mjs) suit la transition et relance la classe .fx-enter.
  // Les SORTIES animées : les toasts (transition CSS .toast--out, index.html).
  // S'exécute APRÈS le handler ci-dessus (ordre des bus.on) : le display est déjà
  // l'état de cette frame.
  const fx = juice.fx;
  const bankEl = document.querySelector('.bankruptcy');
  const introEl = document.querySelector('.intro');
  let bankOpen = false;
  let introOpen = false;
  function fxEnter(el, name) {
    if (!el) return;
    el.classList.remove('fx-enter');
    void el.offsetWidth; // reflow forcé : la keyframe fx-in se rejoue
    el.classList.add('fx-enter');
    fx.enter(name);
  }
  bus.on('frame', () => {
    const bOpen = state.screen === 'game' && !!state.sim && !!state.sim.economy.bankrupt;
    if (bOpen && !bankOpen) fxEnter(bankEl, 'bankruptcy');
    bankOpen = bOpen;
    if (bankOpen === false && fx.phase('bankruptcy') !== 'idle') fx.clear('bankruptcy');
    const iOpen = state.screen === 'game' && !!state.intro && !state.intro.done && !state.intro.skipped;
    if (iOpen && !introOpen) fxEnter(introEl, 'intro');
    introOpen = iOpen;
    if (introOpen === false && fx.phase('intro') !== 'idle') fx.clear('intro');
  });

  // Clavier global : les touches de déplacement restent dans input.mjs ;
  // ici les commandes UI (construire, sauvegarder, vitesse).
  // T33 (t_88aee6d5) : la liste est la MÊME que le build-tool (catalogue
  // BUILDINGS) — les 8 d'origine gardent leurs touches 1-8, les nouveaux
  // prennent 9+ (borné aux touches simples ; le reste passe par la barre).
  const KINDS = Object.keys(BUILDINGS);
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'n') { if (state.screen === SCREENS.MENU) startNewGame(); }
    else if (k === 'r') { resumeFromSave(); }
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
    else if (k === 'v') {
      // R43 : la page OPTIONS (volume / daltonien / vitesse) — clavier V
      // (O est déjà l'overlay réseau R18 ; le menu a aussi un BOUTON).
      optionsPage.open();
    }
    else if (k === 'm') {
      // R44 (t_ebbb202e) : le MUTE (M) — il VIT sur l'état (sérialisé avec la
      // sauvegarde : il survit au rechargement) ; le VOLUME (R43) n'est jamais
      // perdu : le dé-mute restitue la préférence d'origine.
      const on = !!(state.audio && state.audio.muted);
      state.audio = { muted: !on };
      syncAudioMute();
      toasts.toast(on ? 'Son réactivé (M)' : 'Muet activé (M)', 'info');
    }
    // T33 : 9 = dernière touche simple (la liste du catalogue dépasse 9 —
    // les bâtiments 10/11 se choisissent à la barre d'outils).
    else if (k >= '1' && k <= '9' && Number(k) <= KINDS.length) buildTool.setKind(KINDS[Number(k) - 1]);
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
    hudRect: () => renderer.hudRect(), // T5a (t_e4c3ffff) : la zone du HUD canvas (x, y, w, h, fontPx)
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
    planningPanel, // T7 (t_0f131a58) : repli/dépli programmatique du planning (QA CDP + exclusivité mobile)
    intro, // R20 : l'introduction (tests CDP : étape courante, done/skipped)
    tips, // T4 (t_eb78478e) : les astuces d'onboarding (tests CDP : seen, refresh)
    bankruptcyScreen, // R35 : l'écran de faillite (tests CDP : ouvert sur bankrupt, boutons)
    options, // R43 : les options persistantes (volume / daltonien / vitesse)
    optionsPage, // R43 : la page options (tests CDP : open/close/apply + localStorage)
    juice, // Juice (t_5065be95) : les effets canvas (stats() : particules, nombres, shake, fx)
    audio, // R44 (t_ebbb202e) : le moteur audio (play/setVolume/setMuted + stats : dry/muted/ambient)
    // T2-1 (t_d5da994c) : la DIFFICULTÉ du menu (tests CDP : lecture du choix,
    // changement, puis startNewGame → state.difficulty / sim.economy.money).
    difficulty: () => menuDifficulty,
    setDifficulty: (id) => { menuDifficulty = normalizeDifficulty(id); },
  };
}

// Démarrage réel seulement dans le navigateur : sous Node, l'import reste sans effet (testable).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot(document.getElementById('game'));
}
