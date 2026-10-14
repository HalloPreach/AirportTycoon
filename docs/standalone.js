/* Airport Tycoon — VERSION AUTONOME (T4, t_eb78478e) */
/* Généré le 2026-10-13T22:25:16.130Z par tools/build-standalone.mjs — NE PAS ÉDITER À LA MAIN. */
/* 50 modules ESM inlinés (ordre topologique, cycles traités par substitution live), 0 dépendance, 0 appel réseau : jouable hors-ligne (file:// ou serveur statique). */
(() => {
'use strict';
const __reg = { 'm_src_main': {}, 'm_src_core_game-state': {}, 'm_src_core_events': {}, 'm_src_ui_camera': {}, 'm_src_ui_input': {}, 'm_src_ui_renderer': {}, 'm_src_ui_options': {}, 'm_src_core_loop': {}, 'm_src_ui_toast': {}, 'm_src_ui_build-tool': {}, 'm_src_ui_save-panel': {}, 'm_src_ui_planning-panel': {}, 'm_src_ui_panels': {}, 'm_src_ui_intro': {}, 'm_src_ui_tips': {}, 'm_src_ui_bankruptcy': {}, 'm_src_ui_juice': {}, 'm_src_audio': {}, 'm_src_ui_overlay': {}, 'm_src_persistence_save': {}, 'm_src_data_catalog': {}, 'm_src_core_new-game': {}, 'm_src_core_difficulty': {}, 'm_src_scenarios': {}, 'm_src_sim_passengers': {}, 'm_src_ui_palette': {}, 'm_src_ui_theme': {}, 'm_src_ui_icons': {}, 'm_src_sim_weather': {}, 'm_src_sim_clock': {}, 'm_src_core_seasons': {}, 'm_src_core_sim': {}, 'm_src_infra_unlocks': {}, 'm_src_flights_flights': {}, 'm_src_sim_events': {}, 'm_src_economy_economy': {}, 'm_src_pathfinding_path': {}, 'm_src_sim_aircraft': {}, 'm_src_progression_objectives': {}, 'm_src_flights_contracts': {}, 'm_src_progression_quality': {}, 'm_src_infra_assignments': {}, 'm_src_progression_campaign': {}, 'm_src_progression_stats': {}, 'm_src_progression_achievements': {}, 'm_src_sim_incidents': {}, 'm_src_infra_upgrades': {}, 'm_src_infra_infra': {}, 'm_src_core_sim-state': {}, 'm_src_core_layouts': {} };
function __ns(id) { return __reg[id]; }
function __dyn(id) { return Promise.resolve(__reg[id]); }

/* --- module src/core/game-state.mjs --- */
(function (__exports) {
// État de base du jeu : machine à états, horloge (pause, vitesse).
// Logique PURE : aucun import DOM ni API navigateur → testable dans Node.
// ponytail: seed unique et terrain vide ; la sim (aléatoire semé) arrive plus tard.
const SCREENS = Object.freeze({ MENU: 'menu', GAME: 'game' });
const SPEEDS = Object.freeze([1, 2, 4]);

// Machine à états minimale : chaque écran ne peut aller que vers une liste bornée.
const TRANSITIONS = Object.freeze({
  menu: ['game'],      // nouvelle partie
  game: ['menu'],      // quitter (revenir au menu)
});

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function newGame() {
  return {
    screen: SCREENS.MENU,
    paused: false,
    speedIndex: 0, // index dans SPEEDS
    time: 0,       // temps de jeu écoulé (secondes)
    terrain: { w: 1600, h: 1200 }, // terrain vide du M1
    camera: { x: 800, y: 600, zoom: 1 }, // coordonnées monde du centre écran
    // R44 (t_ebbb202e) : le MUTE vit sur l'ÉTAT (sérialisé avec la sauvegarde
    // entière par save.mjs → il persiste au rechargement). Une nouvelle
    // partie repart NON muet — même pattern que state.intro / planningAuto.
    audio: { muted: false },
  };
}

function setScreen(state, to) {
  if (!canTransition(state.screen, to)) {
    throw new Error(`transition interdite : ${state.screen} → ${to}`);
  }
  state.screen = to;
  state.paused = false;
}

function togglePause(state) {
  if (state.screen !== SCREENS.GAME) return;
  state.paused = !state.paused;
}

function cycleSpeed(state) {
  state.speedIndex = (state.speedIndex + 1) % SPEEDS.length;
}

function speedFactor(state) {
  return SPEEDS[state.speedIndex];
}

// Horloge : dt = secondes réelles ; retourne les secondes de JEU écoulées.
// 0 si en pause ou hors de l'écran de jeu ; sinon dt × facteur de vitesse.
function advanceTime(state, dt) {
  if (state.screen !== SCREENS.GAME || state.paused) return 0;
  const played = dt * speedFactor(state);
  state.time += played;
  return played;
}

__exports.SCREENS = SCREENS;
__exports.SPEEDS = SPEEDS;
__exports.canTransition = canTransition;
__exports.newGame = newGame;
__exports.setScreen = setScreen;
__exports.togglePause = togglePause;
__exports.cycleSpeed = cycleSpeed;
__exports.speedFactor = speedFactor;
__exports.advanceTime = advanceTime;
})(__reg['m_src_core_game-state']);

/* --- module src/core/events.mjs --- */
(function (__exports) {
// Petits événements pour que l'UI réagisse sans poller l'état à chaque frame.
// ponytail: Map de listes, pas de priorité ni de débounce ; élargir si besoin.
class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.listeners.get(type);
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    for (const fn of (this.listeners.get(type) || []).slice()) fn(payload);
  }
}

__exports.EventBus = EventBus;
})(__reg['m_src_core_events']);

/* --- module src/ui/camera.mjs --- */
(function (__exports) {
// Caméra 2D : pan + zoom. La position est le CENTRE de la vue (coordonnées monde).
// Le clavier UI émet des commandes (drag, wheel, keys) ; cette classe les applique.
class Camera {
  constructor(state) {
    this.state = state; // .camera = { x, y, zoom }
    // vitesse de pan en pixels écran / seconde (échelle zoom prise en compte)
    this.panSpeed = 600;
    this.minZoom = 0.25;
    this.maxZoom = 4;
  }

  // Panne en pixels écran ; convertit en monde via le zoom.
  pan(dxScreen, dyScreen) {
    const cam = this.state.camera;
    cam.x -= (dxScreen / cam.zoom);
    cam.y -= (dyScreen / cam.zoom);
  }

  // Zoom vers un point écran (sx, sy) : le point monde sous la souris ne bouge pas.
  zoomAt(sx, sy, factor, viewW, viewH) {
    const cam = this.state.camera;
    const beforeX = this.screenToWorldX(sx, viewW);
    const beforeY = this.screenToWorldY(sy, viewH);
    cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, cam.zoom * factor));
    cam.x += beforeX - this.screenToWorldX(sx, viewW);
    cam.y += beforeY - this.screenToWorldY(sy, viewH);
  }

  screenToWorldX(sx, viewW) {
    const cam = this.state.camera;
    return cam.x + (sx - viewW / 2) / cam.zoom;
  }
  screenToWorldY(sy, viewH) {
    const cam = this.state.camera;
    return cam.y + (sy - viewH / 2) / cam.zoom;
  }
}

__exports.Camera = Camera;
})(__reg['m_src_ui_camera']);

/* --- module src/ui/input.mjs --- */
(function (__exports) {
// Entrée clavier / souris → commandes pures (évènements du bus).
// Aucune règle de jeu ici : on ne fait que traduire les gestes.
// viewSize = () => ({width, height}) : le canvas suit la fenêtre.
function makeInputHandlers(canvas, bus, camera, viewSize) {
  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const KEY_PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  window.addEventListener('keydown', (e) => {
    if (e.key in KEY_PAN) { keys.add(e.key); e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P') bus.emit('pause');
    else if (e.key === 'q' || e.key === 'Q') bus.emit('quit');
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  // Panne par glisser (bouton gauche)
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camera.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Zoom à la molette, centré sur la souris
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = viewSize();
    camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15, v.width, v.height);
  }, { passive: false });

  // Panne au clavier, chaque frame (payload du bus 'frame' = dt en secondes)
  bus.on('frame', (dt) => {
    let ax = 0;
    let ay = 0;
    for (const k of keys) {
      const [x, y] = KEY_PAN[k];
      ax += x; ay += y;
    }
    if (ax !== 0 || ay !== 0) camera.pan(ax * camera.panSpeed * dt, ay * camera.panSpeed * dt);
  });

  return { keys };
}

__exports.makeInputHandlers = makeInputHandlers;
})(__reg['m_src_ui_input']);

/* --- module src/core/sim-state.mjs --- */
(function (__exports) {
// État de la simulation : factory de l'objet `sim` (sérialisable tout seul).
// L'état global du jeu (game-state.mjs) ajoute un champ `.sim` ; l'UI ne branche
// que cet objet, elle n'importe jamais les règles (règle « UI fine »).
// Règle d'or : tout ce qui décide d'une règle passe dans les modules de sim ;
// tick() les orchestre. Déterministe si un PRNG semé est passé.
// BL-18 : budget de départ SOLVALE. L'aéroport de départ (piste+taxiway+terminal
// fournis, A-2) est DÉFICITAIRE sur 48 h en politique passive : l'exploitation
// socle (OPEX_PER_SEC, ~550 k$/48 h) + les indemnités vols annulés (321 k$) +
// le carburant dépassent les recettes (~535 k$). Avec 12 k$, le solde franchit
// −10 000 en ~3 h → faillite + gel de la sim (et le bug d'intérêts non capés
// verrouillait le solde au seuil). 345 k$ = le capital de départ qui rend le
// cycle 48 h SOLVALE (money > −10 000 en h=48, politique passive ET bl17 —
// fenêtre de refus + incident forcé, le scénario le plus dur) sans toucher
// l'équilibrage (OPEX_PER_SEC intact, critère A12 « socle coûte même sans vol »
// préservé). Mesures (seed 42, intérêts capés) : passive min +57 809, bl17
// min +18 351 — les deux au-dessus du seuil.
// t_00ecae73 : LE CAPITAL RESTE LE VRAI (12 000), pas gonflé. Le déficit 48 h
// venait d'une cause racine LOGIQUE : le planificateur planifiait des vols que
// l'aéroport ne pouvait pas servir (portes S/L inexistantes à la base) → 638
// annulations → 319 k$ d'indemnités (6× l'opex). Corrigée (planOneFlight ne
// planifie que les types SERVABLES — une piste assez longue + une porte de la
// taille), l'aéroport de base est de nouveau solvable avec 12 000 : l'opex
// (~550 k$/48 h) est couvert par les recettes (vol médium servable). On ne
// gonfle PAS le capital pour faire passer le scénario — on corrige l'équilibrage
// à la racine.
const START_FUNDS = 12000; // capital légitime (pas gonflé, t_00ecae73)

function newSimState() {
  return {
    infra: {
      nextId: 1,
      runways: [],   // {id, x, y, w, h, len}
      taxiways: [],  // {id, x, y, w, h}
      terminals: [], // {id, x, y, w, h, gates:[ids]}
      gates: [],     // {id, size, terminalId, x, y, w, h, acId, cleaning, maintenance}
      services: [],  // {id, type, x, y, w, h, target: terminalId|null, auto: bool} — R27 : `target` = terminal desservi (null = inactif), `auto` = affectation de la sim (réaffectable), pas du joueur
      // R28 : type fuel — `fuelOut` (bool, ABSENT/false = saine, true = panne
      // locale de CETTE station : ses lances sont hors service, la voisine
      // continue). Champ sérialisé naturellement (absent au JSON si jamais pas
      // mis — la validation de schéma ne le requiert pas : pas de propriété
      // fantôme à la reprise).
      grid: { w: 160, h: 120, cells: new Uint8Array(160 * 120) },
    },
    aircraft: [],    // un vol en cours de cycle (voir sim/aircraft.mjs)
    planning: [],    // vols planifiés (pas encore arrivés) : {id, airline, acType, pax, planned, status}
    nextAcId: 1,
    // Passagers agrégés (BL-13, AC22/AC40) : total transporté (compté UNE fois
    // à l'embarquement), satisfaction évolutive, groupes en cours + files PAR
    // TERMINAL (R30 : queues[terminalId] = {checkin,security,board}) + compteurs
    // de flux par terminal (injectedTotal/securityDone) — voir
    // src/sim/passengers.mjs. R30 : l'ancienne file GLOBALE `queue` (qui
    // permettait à un terminal de traiter les pax d'un autre sans règle) est
    // SUPPRIMÉE — les files, capacités et flux sont PAR TERMINAL ; les pax d'un
    // vol annulé sont retirés EXPLICITEMENT (removePassengers).
    passengers: { totalCarried: 0, satisfaction: 100,
                  queues: {}, groups: [], injectedTotal: {}, securityDone: {} },
    // R31 : améliorations de capacité PAR TERMINAL — sim.upgrades[terminalId]
    // = { terminal: n, fueling: n, teams: n } (clés chaînes, comme queues).
    // Le NIVEAU est la source (sérialisé : la reprise restitue niveau + coût
    // déjà payé — on ne re-débite JAMAIS au chargement). Absent d'une
    // sauvegarde ancienne = niveau 0 (toléré, upgrades.mjs ensureUpgrades).
    upgrades: {},
    economy: { money: START_FUNDS, revenue: {}, spent: {}, debt: 0, bankrupt: false,
      // R35 (t_dabe90d7) : l'emprunt borné (LOAN, economy.mjs) — le PRINCIPAL
      // dû (distinct des intérêts : ceux-ci vont au compte dédié `debt`, EV-9)
      // + le nombre d'emprunts obtenus (la borne maxLoans est paramétrée).
      loan: { principal: 0, count: 0 },
      // R16 : périodes financières (5 min de jeu) — les 4 dernières closes
      // (borné, comme R14) + l'accumulateur de clôture (_periodAcc, pattern
      // _spawnAcc) + la base des comptes cumulés au dernier close (la 1re
      // période mesure donc bien depuis t=0). Absent d'une sauvegarde
      // ancienne → le 1er close mesure depuis la reprise (dégradation lisible).
      periods: [], _periodAcc: 0, _periodBase: { revenue: 0, opex: 0, fuel: 0,
        compensation: 0, construction: 0, debt: 0 } },
    alerts: [],      // événements lisibles pour l'UI (toasts/alertes)
    _alertTotal: 0,  // R39 : compteur de seq des événements (pushEvent) — le
    _alertSeq: 0,    // CURSEUR consommateur (main.mjs) vit ICI, sur la sim :
                      // il voyage avec la sim (new game = sim fraîche à 0,
                      // load = restauré depuis la sauvegarde) → jamais de
                      // désynchro avec _alertTotal, et la fenêtre glissante
                      // (splice ci-dessous) ne le brouille PAS (contrairement
                      // à un index de tableau).
    // Incidents opérationnels (BL-14, A-7) : 3 incidents limités (piste fermée,
    // panne carburant, pic de demande) — état propre, sérialisable seul, tirés
    // par le rng semé (reproductible à la reprise). Voir src/sim/incidents.mjs.
    incidents: { runway: { closed: 0, acc: 0, last: 0 },
                fuel: { out: 0, acc: 0, last: 0 },
                surge: { active: false, remaining: 0, acc: 0, last: 0 } },
    // T3 (t_4c9baadc) : couche d'événements dynamiques (sim/events.mjs) —
    // compteurs de tirage (fenêtre bornée, rng semé) SÉRIALISÉS : la reprise
    // est reproductible (comme incidents/rng, EV-10). Sauvegarde pré-T3 :
    // champ absent, toléré (ensureEvents au chargement, save.mjs).
    events: { acc: 0, last: 0, seq: 0, fired: {} },
    time: 0,         // horloge de la sim (pilotée par le planificateur : sim.time += dt)
    _spawnAcc: 0,
    _graph: null,     // graphe pathfinding (reconstruit, pas sérialisé)
    _graphDirty: true,
    rngSeed: 0,       // état du PRNG (EV-10) : seed + compteur CONSERVÉS dans la
    rngCounter: 0,    // sauvegarde → la reprise après fermeture est reproductible
  };
}

// R14 : le journal est BORNE (MAX_ALERTS) — la partie de 48 h génère des
// milliers d'alertes, qui gonfleraient sim.alerts ET la sauvegarde (serialize
// écrit l'état entier à chaque auto-save) sans limite. On garde les 500 plus
// récentes : l'historique du panneau affiche déjà « les 50 plus récentes +
// compteur des plus anciennes » (ui/panels.mjs), et les toasts n'affichent que
// les 4 dernières — au-delà de MAX_ALERTS, le détail ancien n'a plus de
// destinataire. (Le consommateur main.mjs pointe par INDICE et consomme à
// chaque frame : les événements jamais lus restent dans la fenêtre des 500.)
const MAX_ALERTS = 500;

// Événement lisible pour l'UI (toast/alerte). L'UI lit sim.alerts, elle ne pollue pas l'état.
// R39 : chaque événement porte un seq MONOTONE (sim._alertTotal, sérialisé avec
// la sim → survit à la sauvegarde/rechargement). Le consommateur (main.mjs)
// pointe par seq, PAS par index de tableau : la fenêtre glissante (splice ci-
// dessous) décale les indices, mais le seq ne change jamais — et il reste
// cohérent après un load, car le compteur voyage DANS la sim. Sans seq, la
// fenêtre max 500 fige le curseur index et plus aucun toast n'est lu après
// 500 événements (le bug que cette seq corrige).
function pushEvent(sim, e) {
  sim._alertTotal = (sim._alertTotal || 0) + 1;
  e.seq = sim._alertTotal;
  sim.alerts.push(e);
  if (sim.alerts.length > MAX_ALERTS) sim.alerts.splice(0, sim.alerts.length - MAX_ALERTS);
}

__exports.START_FUNDS = START_FUNDS;
__exports.newSimState = newSimState;
__exports.pushEvent = pushEvent;
})(__reg['m_src_core_sim-state']);

/* --- module src/data/catalog.mjs --- */
(function (__exports) {
// Données de contenu : coûts, avions, compagnies, déblocages.
// Un seul fichier de chiffres : c'est l'équilibrage, pas de la logique.
// ponytail : tableaux simples pas une base ; le jeu a 5 bâtiments et 3 tailles d'avion.

const BUILDINGS = Object.freeze({
  runway:   { name: 'Piste',   cost: 2500, w: 100, h: 1000, sellRefund: 0.5 },
  taxiway:  { name: 'Taxiway', cost: 400,  w: 200, h: 40,  sellRefund: 0.5 },
  terminal: { name: 'Terminal', cost: 3000, w: 200, h: 150, sellRefund: 0.5 },
  fuel:     { name: 'Station carburant', cost: 1200, w: 120, h: 80, sellRefund: 0.5 },
  hangar:   { name: 'Hangar maintenance', cost: 1500, w: 160, h: 120, sellRefund: 0.5 },
  catering: { name: 'Salle de restauration', cost: 1000, w: 100, h: 80, sellRefund: 0.5 },
  cleaning: { name: 'Équipe nettoyage', cost: 900, w: 100, h: 80, sellRefund: 0.5 },
  baggage:  { name: 'Salle bagages', cost: 900, w: 100, h: 80, sellRefund: 0.5 },
  // T33 (t_88aee6d5) : 3 NOUVEAUX services au sol — la barre d'outils et le
  // clavier lisent CE TABLEAU (build-tool.mjs / main.mjs) : du contenu
  // ADDITIF ici ne demande AUCUNE ligne de code ailleurs (les 8 d'origine
  // gardent leurs touches 1-8 ; les nouveaux prennent 9+).
  // R27 : l'effet est AFFECTÉ au terminal (s.target) — une salle posée pour A
  // ne sert JAMAIS B (comme la salle bagages).
  security: { name: 'Salle de sécurité', cost: 1200, w: 100, h: 80, sellRefund: 0.5 },
  dutyfree: { name: 'Boutique libre-service', cost: 1000, w: 100, h: 80, sellRefund: 0.5 },
  lounge:   { name: 'Salon VIP', cost: 800, w: 80, h: 60, sellRefund: 0.5 },
});

// Exploitation (A12 : l'argent diminue MÊME sans vol) + services construits.
// R15 : l'unité interne unique est la SECONDE DE JEU — OPEX_PER_SEC donne le
// débit en $ par seconde de JEU (source de vérité, pas de 2e unité). Un tick
// avance de `dt` secondes de jeu et débite OPEX_PER_SEC[type] * dt ; à vitesse
// x4 la sim consomme 4× de s de jeu par seconde réelle, donc 4× de débit.
// Le socle (piste + taxiway + terminal) fait 3,2 $/s ≈ 11 520 $/h
// (≈ 276 k$/jour, ≈ 553 k$/48 h — cf. la note « ~550 k$/48 h » de sim-state).
// R27 : les services AU SOL — ceux qui se PLACENT sur le terrain et dont
// l'effet est AFFECTÉ à un terminal (mesures assignments.mjs) : le carburant
// sert les pleins des portes de son terminal, le nettoyage/hangar remette à
// zéro l'usure des portes de son terminal, bagages/cafétéria/maintenance
// servent les passagers qui ARRIVENT à son terminal.
const GROUND_SERVICE_TYPES = Object.freeze(['fuel', 'hangar', 'cleaning', 'baggage', 'catering', 'maintenance', 'security', 'dutyfree', 'lounge']);

// R37 (t_a4c636ab) : l'OPEX des SERVICES AU SOL est recalibré.
// Avant (R36) les 5 services coûtaient ~12,5 $/s (45 000 $/h) : construire
// TOUS les services (la stratégie « expansion ») coûtait PLUS que son gain
// (billets plein tarif + capacité) → l'expansion PERDAIT face au prudent
// (120 531 pax vs 147 388, money 864 k$ vs 1 023 k$ sur 24 h). Les services
// devaient être un INVESTISSEMENT rentable (le joueur choisit d'investir),
// pas une perte garantie.
// Deux familles, deux prix :
//  - BONNES améliorations (carburant/nettoyage/bagages) : OPEX baissé — leur
//    gain (billets plein tarif + usure « sale » nulle + capacité check-in)
//    dépasse désormais leur coût → l'expansion est rentable.
//  - PIÈGE « surdimensionné » (hangar/catering au-delà du besoin) : OPEX
//    INCHANGÉ (hangar 2 + catering 2,5 = 4,5 $/s) — quand les files sont
//    vides, leur utilité est marginale mais le coût reste → un aéroport
//    SURDIMENSIONNÉ reste DÉFICITAIRE (finance-bl15 : hangar+café sans
//    station carburant, déficit mesurable). L'achat inadapté COÛTE.
// La piste/le taxiway/le terminal (le SOCLE, non-choix) restent intacts.
const OPEX_PER_SEC = Object.freeze({
  runway: 1.2,     // piste : 72 $/min, 4 320 $/h (socle, inchangé)
  taxiway: 0.2,    // 12 $/min, 720 $/h (socle, inchangé)
  terminal: 1.8,   // 108 $/min, 6 480 $/h (socle, inchangé)
  fuel: 1.5,       // R37 : 90 $/min, 5 400 $/h (était 14 400) — le plein est la
                   //       meilleure amélioration (billets plein tarif), OPEX < gain
  hangar: 2,       // PIÈGE : inchangé (7 200 $/h) — surdimensionné = déficit
  maintenance: 1.5,// PIÈGE : inchangé
  catering: 2.5,   // PIÈGE : inchangé (9 000 $/h) — surdimensionné = déficit
  cleaning: 1,     // R37 : 60 $/min, 3 600 $/h (était 7 200) — usure « sale »
  baggage: 1,      // R37 : 60 $/min, 3 600 $/h (était 7 200) — capacité check-in
  // T33 (t_88aee6d5) : les 3 nouveaux services — famille R37 :
  //   security/dutyfree = BONNES améliorations (OPEX < gain, comme R37 a
  //   recalibré cleaning/baggage) ; lounge = famille CONFORT (comme la
  //   restauration : un PIÈGE documenté — si l'aéroport est bien tenu
  //   (satisfaction 100), sa valeur marginale est nulle : son OPEX reste
  //   supérieur à son gain, le joueur doit le COMPRENDRE, pas le subir).
  security: 1,     // 60 $/min, 3 600 $/h — +4 pax/s au contrôle sécurité
  dutyfree: 1,     // 60 $/min, 3 600 $/h — 8 $/pax/boutique : rentable dès
                   //       ~450 pax/h (0,125 pax/s) — un vol medium toutes les ~3,3 min
  lounge: 2.5,     // PIÈGE (famille confort, calibrée comme la restauration : 9 000 $/h)
});
// R15 : unités LISIBLES dérivées d'OPEX_PER_SEC (pas d'état parallèle) — le
// « coût affiché par minute » d'un bâtiment = opexPerMin(type) = le débit
// effectivement constaté sur 60 s de jeu (la sim débite opexPerMin sur 60 s).
// Les sondes (qa/probe-scenario.mjs) importent ces accès pour comparer
// affiché vs débit constaté. perMin = /s × 60, perH = /s × 3600.
const opexPerMin = (type) => (OPEX_PER_SEC[type] ?? 0) * 60;
const opexPerHour = (type) => (OPEX_PER_SEC[type] ?? 0) * 3600;

// Catégories d'avions : ce qui contraint l'infra (piste assez longue, porte de la bonne taille).
const AIRCRAFT = Object.freeze({
  small:  { name: 'Cessna 208',   seats: 9,  minRunway: 300, gate: 'S', approach: 280, taxi: 50, revenuePerPax: 45,  refuel: 40 },
  medium: { name: 'Airbus A320',  seats: 160, minRunway: 500, gate: 'M', approach: 320, taxi: 40, revenuePerPax: 90,  refuel: 110 },
  large:  { name: 'Boeing 747',   seats: 350, minRunway: 800, gate: 'L', approach: 360, taxi: 30, revenuePerPax: 150, refuel: 320 },
});

// BL-05 (A8, décision) : les portes L EXISTENT — chaque terminal en construit
// une (ci-dessous). Les gros avions (L, minRunway 800) servent les terminaux
// sur les pistes fournies (1000, A-2) : aucun vol L bloqué indéfiniment.
// On ne limite pas le catalogue des vols L : la compatibilité reste réalisable.
const TERMINAL_GATE_SIZES = Object.freeze(['S', 'M', 'M', 'L']);

// Compagnies : une couleur + la taille d'avion qu'elles opèrent (les contraintes viennent de la catégorie).
// T33 (t_88aee6d5) : 2 NOUVELLES compagnies — l'offre de vol pioche la
// compagnie PARMELLES (flights.mjs, déterministe par seed) : du contenu
// ADDITIF, AUCUNE règle ne change (les types opérés restent ceux du vol —
// la servabilité est contrainte par la taille, pas par le nom de la marque).
// Sauvegarde : un ID inconnu (ancienne sauvegarde sans ces lignes) retombe
// sur AIRLINES[0] (airlineOf) — aucune migration nécessaire.
const AIRLINES = Object.freeze([
  { id: 'solaire', name: 'Solaire Air', color: '#f0a', types: ['small'] },
  { id: 'atlantique', name: 'Atlantique', color: '#1e88e5', types: ['medium'] },
  { id: 'pacific', name: 'PacificCargo', color: '#43a047', types: ['large'] },
  { id: 'boreal', name: 'Boréal Régions', color: '#ff7043', types: ['small', 'medium'] },
  { id: 'horizon', name: 'Horizon Express', color: '#7e57c2', types: ['medium', 'large'] },
]);

// R23 : les déblocages des services ne sont PLUS de simples seuils de pax.
// Les CONDITIONS mesurables vivent dans src/infra/unlocks.mjs (le module de
// règle, appelé par tickUnlocks) — ce fichier ne porte que les CHIFFRES et
// les TEXTES de chaque règle (équilibrage, pas de logique) :
//   fuel      : une offre de vol en vue (le carburant se débloque AVANT que
//               l'activité ne rende le plein nécessaire — tiers 1) ;
//   cleaning  : usure « sale » d'une porte ≥ wear (10 : l'usure a commencé à
//               compter, GATE_WEAR_PER_SEC = 0,5/s → ~20 s amarré) ;
//   hangar    : usure mécanique d'une porte ≥ wear (idem, GATE_MAINT_PER_SEC) ;
//   baggage   : file check-in ≥ queue (90 = 75 % de la capacité 120 : le
//               goulou de base se voit) OU carried pax transportés (400 :
//               les volumes justifient le débit) ;
//   catering  : carried pax transportés (300 : le confort de salle est
//               justifié par les volumes — tiers 2).
// T33 (t_88aee6d5) : 3 nouvelles règles (mêmes motifs « file visible /
// volumes justifiés » — aucune référence à un service verrouillé, pas de
// dépendance circulaire) :
//   security  : file sécurité ≥ queue (96 = 80 % de la capacité 120 : le
//               goulot sécurité se voit) OU carried pax transportés (600) ;
//   dutyfree  : carried pax transportés (400 : le commerce est justifié par
//               les volumes — tiers 2) ;
//   lounge    : carried pax transportés (500 : le confort haut de gamme est
//               justifié par les volumes — tiers 2).
// Aucune condition ne fait référence à un service verrouillé (pas de
// dépendance circulaire : on ne demande pas de maintenir un service pour le
// débloquer).
const UNLOCK_RULES = Object.freeze({
  fuel: { name: 'Station carburant',
    benefit: 'pleins de carburant au décollage (pas de départ sec : billets moitiés)',
    why: 'une offre de vol en vue — l’activité va servir des vols' },
  cleaning: { name: 'Équipe nettoyage', wear: 10,
    benefit: 'remet l’usure « sale » des portes à zéro (embarquements rapides)',
    why: 'usure d’une porte ≥ 10 (la porte s’est usée pendant les vols)' },
  hangar: { name: 'Hangar maintenance', wear: 10,
    benefit: 'remet l’usure mécanique des portes à zéro (pleins rapides)',
    why: 'usure mécanique d’une porte ≥ 10 (les pleins usent la porte)' },
  baggage: { name: 'Salle bagages', queue: 90, carried: 400,
    benefit: '+8 pax/s au check-in par salle (le goulou dépôt bagages s’ouvre)',
    why: 'file check-in ≥ 90 pax (75 % de la capacité) ou 400 pax transportés' },
  catering: { name: 'Salle de restauration', carried: 300,
    benefit: 'confort de salle : la satisfaction remonte plus vite',
    why: '300 pax transportés (les volumes justifient le confort)' },
  // T33 (t_88aee6d5) : les 3 nouvelles règles (les CHIFFRES sont ici, la
  // condition mesurable dans src/infra/unlocks.mjs — CONDS).
  security: { name: 'Salle de sécurité', queue: 96, carried: 600,
    benefit: '+4 pax/s au contrôle sécurité de la salle AFFECTÉE (le goulot sécurité s’ouvre)',
    why: 'file sécurité ≥ 96 pax (80 % de la capacité) ou 600 pax transportés' },
  dutyfree: { name: 'Boutique libre-service', carried: 400,
    benefit: '8 $ de recette boutique par pax débarqué, par boutique AFFECTÉE (compte dédié)',
    why: '400 pax transportés (les volumes justifient le commerce)' },
  lounge: { name: 'Salon VIP', carried: 500,
    benefit: 'confort : la satisfaction remonte plus vite (+0,3 %/s)',
    why: '500 pax transportés (les volumes justifient le confort haut de gamme)' },
});

// R31 (t_7a512737) : 3 CHOIX D'AMÉLIORATION DE CAPACITÉ CIBLÉE, par terminal —
// coût FIXE par niveau (pas de %), résultat ATTENDU affiché AVANT achat (le
// joueur voit ce qu'il achète) :
//   terminal : +60 % de capacité check-in/sécurité DU terminal (files plus
//              longues → occupation/satisfaction au-delà de la capacité) ;
//   fueling  : −25 % de temps de plein PAR NIVEAU (le goulot avitaillement,
//              la SATURATION des lances ne change pas — c'est le débit) ;
//   teams    : ×2 du débit de nettoyage/remise à zéro par équipe DU terminal
//              (l'usure s'accumule moins vite RELATIVEMENT : moins de délai).
// T33 (t_88aee6d5) : 3 NOUVEAUX CHOIX (mêmes principes R31 : coût fixe,
// effet ATTENDU affiché, niveau vécu dans sim.upgrades) :
//   boarding : −25 % du temps des 3 OPS AU SOL de ce terminal par niveau
//              (démêlage/sol/embarquement — la porte se libère plus vite) ;
//   marketing: +10 % de recette billets (pleines ET sèches) par niveau de
//              CE terminal (le choix REVENUE — utile quand du pax passe) ;
//   comfort  : ×1,5 de la récupération de satisfaction PAR NIVEAU — GLOBAL
//              comme la famille confort (meilleur terminal équipé : les
//              aménagements servent tout l'aéroport).
// Le « mauvais achat » reste COMPRÉHENSIBLE : l'UI montre le goulot courant
// du terminal (src/infra/upgrades.mjs, bottleneckView) — acheter « terminal »
// quand le goulot est le PLEIN est inutile, et l'écran l'explique.
// Les niveaux vivent dans l'ÉTAT (sim.upgrades, sérialisé — la reprise
// restitue niveau ET le coût déjà payé : le niveau est la source, on ne
// re-débite JAMAIS au chargement).
const UPGRADES = Object.freeze({
  terminal: { name: 'Terminal efficace', cost: 1500, maxLevel: 3, capMultPerLevel: 0.6,
    effect: '+60 % de capacité check-in/sécurité de ce terminal (file tolérée plus longue)' },
  fueling:  { name: 'Avitaillement rapide', cost: 1200, maxLevel: 3, timeMultPerLevel: 0.25,
    effect: '−25 % du temps de plein de ce terminal par niveau (la saturation des lances ne change pas)' },
  teams:    { name: 'Équipement d\'équipe', cost: 2000, maxLevel: 3, rateMultPerLevel: 1,
    effect: '×2 du débit nettoyage/remise à zéro par équipe de ce terminal par niveau' },
  // T33 (t_88aee6d5) : 3 nouveaux choix — même contrat R31 (coût FIXE par
  // niveau, niveau vécu dans sim.upgrades, multiplieurs purs — aucun coût
  // récurrent, AUCUN état supplémentaire : le niveau est la source).
  boarding: { name: 'Embarquement rapide', cost: 1800, maxLevel: 3, timeMultPerLevel: 0.25,
    effect: '−25 % du temps des 3 opérations au sol de ce terminal par niveau (démêlage, sol, embarquement)' },
  marketing: { name: 'Campagne marketing', cost: 2000, maxLevel: 3, revenueMultPerLevel: 0.1,
    effect: '+10 % de recette billets par niveau de ce terminal (billets pleins et secs)' },
  comfort: { name: 'Confort passagers', cost: 1600, maxLevel: 3, recoverMultPerLevel: 0.5,
    effect: '×1,5 de la récupération de satisfaction (files vides) par niveau — global, comme la famille confort' },
});

// Décomposition du cycle avion (ordre d'exécution, l'état est la donnée).
// AC18 (A9) : « docking » = amarrage physique du nœud de porte au centre de la
// porte (taxi → docking → gate).
// BL-12 : « refuel » entre gate et disembark (remise à niveau, si station).
const PHASES = Object.freeze([
  'approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure',
]);

// BL-12 : temps de remplissage d'un avion de cette taille = spec.refuel * REFUEL_TIME_S
// (le catalogue donne le niveau de carburant : 40/110/320) — un gros plein (747)
// prend plus qu'un petit (Cessna).
const REFUEL_TIME_S = 0.5;
// R28 (t_bd681587) : le SERVICE de la lance inclut un temps de DÉPLACEMENT
// simple (la station se rend au poste) fondé sur la DISTANCE porte→station,
// SANS agents véhicules individuels (la sim reste sans entités mobiles — le
// déplacement est un simple retard proportionnel à la distance). La station
// éloignée sert plus lentement que la station proche : c'est la MESURE du
// « gain d'ajouter une station » (une 2e station plus proche réduit le temps
// de service). 20 s par 1 000 px (le plein medium de base = 55 s ; la marge
// des boucles de test — 60 s (r08) / 70 s (services) — reste saine pour une
// distance porte→station réaliste ~500 px = +10 s).
const REFUEL_TRAVEL_S_PER_1000 = 20;
// R17 (t_fc0d1920, D7 tranchée) : durée de ROTATION nominale — le temps que
// prend le cycle au sol d'un avion AMARRÉ (gate → décollage : avitaillement
// si station, débarquement, sol, embarquement, poussée) SANS aucune attente :
// l'avion qui a posé à l'heure prévue ne devrait rouvrir le slot que
// NOMINAL_TURNOVER_S plus tard. C'est la base de la ponctualité (R17) :
// un vol est PUNCTUEL si son retard cumulé (ac.delayed, unique source de
// vérité — D7) ne dépasse pas cette rotation nominale. Constante (le cycle
// au sol a une durée fixe par construction, catalog.mjs:37 GATE_OPS_S) ;
// le RETARD des vols est mesuré dans les sim (aircraft.mjs / flights.mjs).
const NOMINAL_TURNOVER_S = 150; // 2 min 30 s : 60 s d'ops au sol + marge
// BL-12 : usure d'une porte occupée (par seconde de jeu) ; le hangar remet à zéro.
const GATE_WEAR_PER_SEC = 0.5;
// t_2179387d : DEUX usures distinctes, deux services distincts.
//  - g.cleaning  (usure « sale ») croît, l'équipe NETTOYAGE la remet à 0.
//  - g.maintenance (usure « mécanique ») croît pendant le plein, le HANGAR la remet à 0.
// Les deux retardent l'embarquement (GATE_WEAR_DELAY_S par point) → deux services
// qui coûtent ET qui servent (critère de fin, non deux bâtiments décoratifs).
const GATE_MAINT_PER_SEC = 0.3;
// BL-12 : délai d'opérations au sol (phase ground) par point d'usure de la porte
// (une porte sale → embarquement retardé ; le hangar nettoie).
const GATE_WEAR_DELAY_S = 0.1;
// BL-12 : vitesse de nettoyage des portes par le hangar (maintenance) — par seconde.
const HANGAR_CLEAN_PER_SEC = 1;
// t_2179387d : vitesse de nettoyage de l'usure « sale » (g.cleaning) par
// bâtiment « cleaning » — par seconde. Distinct du hangar (g.maintenance).
const CLEANING_RATE_PER_SEC = 1;

__exports.BUILDINGS = BUILDINGS;
__exports.GROUND_SERVICE_TYPES = GROUND_SERVICE_TYPES;
__exports.OPEX_PER_SEC = OPEX_PER_SEC;
__exports.opexPerMin = opexPerMin;
__exports.opexPerHour = opexPerHour;
__exports.AIRCRAFT = AIRCRAFT;
__exports.TERMINAL_GATE_SIZES = TERMINAL_GATE_SIZES;
__exports.AIRLINES = AIRLINES;
__exports.UNLOCK_RULES = UNLOCK_RULES;
__exports.UPGRADES = UPGRADES;
__exports.PHASES = PHASES;
__exports.REFUEL_TIME_S = REFUEL_TIME_S;
__exports.REFUEL_TRAVEL_S_PER_1000 = REFUEL_TRAVEL_S_PER_1000;
__exports.NOMINAL_TURNOVER_S = NOMINAL_TURNOVER_S;
__exports.GATE_WEAR_PER_SEC = GATE_WEAR_PER_SEC;
__exports.GATE_MAINT_PER_SEC = GATE_MAINT_PER_SEC;
__exports.GATE_WEAR_DELAY_S = GATE_WEAR_DELAY_S;
__exports.HANGAR_CLEAN_PER_SEC = HANGAR_CLEAN_PER_SEC;
__exports.CLEANING_RATE_PER_SEC = CLEANING_RATE_PER_SEC;
})(__reg['m_src_data_catalog']);

/* --- module src/ui/palette.mjs --- */
(function (__exports) {
// R43 (t_62bd0be8) — Palettes de rendu : STANDARD + DALTONIENNE.
// Logique PURE (aucun DOM/canvas) → testable dans Node. Le renderer (UI fine)
// LIT la palette à chaque frame : les SHAPES/layout sont identiques, seules
// les CARTES DE COULEURS changent → le mode daltonien ne casse jamais le
// rendu (les symboles/textes existants — étiquettes des bâtiments, R/O sur
// les portes, FERMÉE/PANNE, hachures — restent la garantie de lisibilité).
//
// Palette daltonienne : Wong (2008), conçue pour la cécité aux couleurs
// (protanope/deuteranope) : bleus/oranges + contraste de LUMINANCE. Les
// paires rouge/vert problématiques du standard (vertes des portes S, rouge
// des portes occupées, vert/herbe, vert-jaune du baggage) sont remplacées.
const PALETTES = Object.freeze({
  standard: Object.freeze({
    name: 'standard',
    terrain: '#3d5a3a',        // herbe
    gridLine: 'rgba(255,255,255,0.12)',
    terrainBorder: '#cfd8dc',
    buildings: Object.freeze({
      runway: '#455a64', taxiway: '#78909c', terminal: '#1e88e5',
      fuel: '#fdd835', hangar: '#ef6c00', catering: '#9c27b0',
      cleaning: '#26c6da', baggage: '#7cb342',
      // T33 (t_88aee6d5) : les 3 nouveaux — couleurs DISTINCTES des 8
      // existantes (l'étiquette + le numéro restent la garantie, R43).
      security: '#7c4dff', dutyfree: '#ff5252', lounge: '#ff8f00',
    }),
    gates: Object.freeze({ S: '#4caf50', M: '#ff9800', L: '#2196f3', occupied: '#e53935' }),
    alert: '#e53935',          // X piste fermée, lise d'alerte
    menuBg: '#1a237e',
  }),
  colorBlind: Object.freeze({
    name: 'colorBlind',
    // Fond neutre bleu-gris (pas de vert) : le quadrillage blanc reste visible.
    terrain: '#2e3d4f',
    gridLine: 'rgba(255,255,255,0.12)',
    terrainBorder: '#cfd8dc',
    // Wong : bleu / orange / jaunes + contrastes de luminance.
    buildings: Object.freeze({
      runway: '#37474f', taxiway: '#b0bec5', terminal: '#0072B2',
      fuel: '#F0E442', hangar: '#E69F00', catering: '#CC79A7',
      cleaning: '#56B4E9', baggage: '#009E73',
      // T33 (t_88aee6d5) : 3 nouveaux dans le spectre Wong étendu
      // (luminance + l'étiquette — jamais la couleur seule, principe R43).
      security: '#332288', dutyfree: '#999999', lounge: '#7F7F7F',
    }),
    // S (vert-bleu) / M (orange) / L (bleu) : les TROIS restent distincts en
    // luminance + taille, et les lettres S/M/L sont déjà peintes (zoom ≥ 0.7).
    gates: Object.freeze({ S: '#009E73', M: '#E69F00', L: '#0072B2', occupied: '#D55E00' }),
    // Rouge → vermillon (lu « orange » par un daltonien) : l'alerte ne repose
    // PAS sur la couleur seule (symbole X + texte FERMÉE/PANNE).
    alert: '#D55E00',
    menuBg: '#1a237e',
  }),
});

// `mode` : toute valeur truthy (options.colorBlind) → palette daltonienne ;
// sinon la palette standard (défaut). Jamais d'erreur : un mode inconnu est
// interprété comme standard (le rendu ne peut pas casser, critère R43).
function getPalette(mode) {
  return mode ? PALETTES.colorBlind : PALETTES.standard;
}

// Toute couleur attendue par le renderer est soit un hex #rrggbb (ou #rgb),
// soit un rgba(...) lisible : les tests vérifient que les deux palettes sont
// COMPLÈTES et VALIDES (aucune clé manquante = pas de rendu cassé).
function isColor(v) {
  if (typeof v !== 'string') return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(\s*,\s*[\d.]+)?\s*\)$/i.test(v);
}

__exports.PALETTES = PALETTES;
__exports.getPalette = getPalette;
__exports.isColor = isColor;
})(__reg['m_src_ui_palette']);

/* --- module src/ui/theme.mjs --- */
(function (__exports) {
// T4 (t_eb78478e) — DESIGN TOKENS (art direction) : source UNIQUE des couleurs
// et tailles partagées entre le CANVAS (renderer, icons) et le DOM (index.html).
// Module PUR, testable Node (aucun DOM). Les variables CSS `--at-*` du :root
// d'index.html MIRENT ce module bloc par bloc — le test tests/t4-theme.test.mjs
// vérifie la cohérence des deux sources (un token changé ici DOIT être changé
// dans le :root, sinon la suite rouge).
//
// Direction artistique : « tour de contrôle la nuit » — fond bleu nuit profond,
// panneaux bleus ardoise, accent cyan (balise de tour), textes clairs. Le
// daltonien (R43) reste géré par la palette de rendu (palette.mjs) : les tokens
// ici concernent l'UI (menu, HUD, toasts, panneaux), pas les couleurs du monde.
const THEME = Object.freeze({
  // --- Surfaces ---------------------------------------------------------------
  bg: '#0a1220',            // nuit profonde (fond du menu / page)
  surface: '#111a2b',       // panneaux (barre d'outils, consultation, planning)
  surfaceAlt: '#182439',    // panneaux relevés (modale options)
  border: '#2a3b55',        // bordures
  // --- Textes -----------------------------------------------------------------
  text: '#e8eef7',          // texte principal
  textDim: '#93a4bd',       // texte secondaire / captions
  // --- Accents (balise de tour) -----------------------------------------------
  accent: '#4fc3f7',        // cyan — focus, liens, surlignage
  accentSoft: 'rgba(79,195,247,0.16)', // fonds de surbrillance (accent léger)
  ok: '#4caf7a',            // gains / succès
  warn: '#ffb74d',          // avertissements
  err: '#ef5350',           // erreurs / pertes
  gold: '#ffd54f',          // récompenses / objectif payé
  // --- Ciel du menu (écran-titre) ---------------------------------------------
  skyTop: '#050914',
  skyBottom: '#16263f',
  moon: '#d7e3f4',
  ground: '#0d1524',
  runway: '#222c3d',
  runwayLine: '#e8eef7',
  // --- Typographie --------------------------------------------------------------
  fontUi: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  titleSize: 46,            // écran-titre (px canvas)
  subtitleSize: 15,
  hudFontSize: 15,
  versionTag: 'T4',
});

// Tokens MIRRORÉS en variables CSS `--at-<clé>` dans le :root d'index.html —
// la liste EXPLICITE (seules les valeurs hex/rgba sont miroirées ; les tailles
// et la police ne le sont pas). Le test de cohérence parcourt cette liste.
const CSS_MIRRORED_KEYS = Object.freeze([
  'bg', 'surface', 'surfaceAlt', 'border', 'text', 'textDim',
  'accent', 'accentSoft', 'ok', 'warn', 'err', 'gold',
]);

// Couleur d'un token par clé (les clés miroirées + les clés canvas).
function themeColor(key) {
  const v = THEME[key];
  return typeof v === 'string' && (v[0] === '#' || v[0] === 'r') ? v : null;
}

__exports.THEME = THEME;
__exports.CSS_MIRRORED_KEYS = CSS_MIRRORED_KEYS;
__exports.themeColor = themeColor;
})(__reg['m_src_ui_theme']);

/* --- module src/core/sim.mjs --- */
(function (__exports) {
// Pont UI → simulation : la carte UI ne branche QUE ce module, elle n'importe
// jamais les règles de sim. Les modules de sim sont chargés paresseusement :
// s'ils ne sont pas encore là (autre milestone en cours), le jeu tourne quand
// même — la sim se branche d'elle-même dès qu'elle est prête.
// ponytail: import paresseux + cache du module + backoff 5 s ; pas de DI.

let cache = null;
let retryAt = 0;

// Charge le graphe de sim (tick + factory + infra). Échec silencieux, on réessaie.
async function ensureSim() {
  if (cache) return cache;
  if (Date.now() < retryAt) return null; // pas prêt à réessayer (backoff)
  retryAt = Date.now() + 5000; // les modules peuvent encore être en cours d'écriture
  try {
    const [tickM, stateM, infraM] = await Promise.all([
      import('./tick.mjs'),
      import('./sim-state.mjs'),
      import('../infra/infra.mjs'),
    ]);
    cache = {
      tick: tickM.tick,
      newSimState: stateM.newSimState,
      buildBuilding: infraM.buildBuilding,
      demolishBuilding: infraM.demolishBuilding,
    };
  } catch {
    cache = null; // sim pas prête : on y retourne plus tard (pas de crash)
  }
  return cache;
}

// Tick par frame : si la sim n'est pas prête, rien ne se passe (le jeu tourne).
async function simTick(state, dt) {
  const m = await ensureSim();
  if (m && m.tick) m.tick(state, dt);
}

// Stub injectable (tests r14) : si un test pose `globalThis.__simTick`, la
// boucle l'utilise au lieu du tick réel — permet d'essayer un tick qui lève
// sans builder de faux modules. En jeu, l'absence du stub = zéro surcoût.
const tickFn = (state, dt) => (globalThis.__simTick || simTick)(state, dt);

// État de sim d'une nouvelle partie (null si la sim n'est pas encore prête).
async function freshSimState() {
  const m = await ensureSim();
  return m && m.newSimState ? m.newSimState() : null;
}

__exports.ensureSim = ensureSim;
__exports.simTick = simTick;
__exports.tickFn = tickFn;
__exports.freshSimState = freshSimState;
})(__reg['m_src_core_sim']);

/* --- module src/ui/toast.mjs --- */
(function (__exports) {
// Toasts : petits messages lisibles en bas à droite (feedback utilisateur).
// Pur DOM, zéro règle de jeu : afficher, auto-disparaître.
// ponytail: max 4 toasts empilés, 4 s ; c'est un feedback, pas un journal.
function makeToasts(root) {
  const box = document.createElement('div');
  box.className = 'toasts';
  box.setAttribute('role', 'status'); // annoncé aux lecteurs d'écran
  root.appendChild(box);

  let timer = 0;
  function toast(msg, kind = 'info') {
    while (box.children.length >= 4) box.firstChild.remove(); // on garde les 4 derniers
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.textContent = msg;
    box.appendChild(el);
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const t of [...box.children]) t.classList.add('toast--out');
      setTimeout(() => box.replaceChildren(), 200);
    }, 4000);
  }
  return { toast, box };
}

__exports.makeToasts = makeToasts;
})(__reg['m_src_ui_toast']);

/* --- module src/core/layouts.mjs --- */
(function (__exports) {
// T3 stretch (t_79820790) — MULTI-AEROPORTS : la table AIRPORTS — un aéroport
// nommé est un PARAMÈTRE de la nouvelle partie (additif : le layout « central »
// est IDENTIQUE bit-à-bit au START_LAYOUT legacy — le spawn par défaut reste
// invariant, vérifié dans tests/r49-airports.mjs).
//
// Les layouts sont posés par le placeBuilding EXISTANT (src/core/new-game.mjs)
// → aucune règle de construction nouvelle : le réseau fourni est PHYSIQUEMENT
// VALIDE — vérifié dans tests/r49-airports.mjs (composante connexe unique,
// chemins piste→porte, zéro chevauchement, terrain 1600×1200) sur la règle de
// contact du pathfinding (src/pathfinding/path.mjs : contact si distance ≤ 20).
//
// Cap Nord (le SECOND aéroport — objectif « a second airport ») : 2 pistes —
// une CAPABLE L (longueur 800 = AIRCRAFT.large.minRunway, catalog.mjs) + une
// M (longueur 500) — et un terminal 4 portes (L, M, M, L) : un PROFIL
// DIFFÉRENT de l'aéroport central, relié par un réseau de 3 taxiways
// (corridor vertical + liaisons pistes/terminal).
const DEFAULT_AIRPORT = 'central';

const AIRPORTS = Object.freeze({
  central: Object.freeze({
    name: 'Aéroport central',
    layout: [
      { type: 'runway', x: 750, y: 100, w: 100, h: 1000 },
      { type: 'taxiway', x: 550, y: 1050, w: 200, h: 40 },
      { type: 'terminal', x: 550, y: 900, w: 200, h: 150 },
    ],
    gateSizes: ['M', 'M'],
  }),
  'cap-nord': Object.freeze({
    name: 'Cap Nord — aéroport du nord',
    layout: [
      { type: 'runway', x: 540, y: 100, w: 100, h: 800 },  // R1 : capable L (800)
      { type: 'runway', x: 300, y: 100, w: 100, h: 500 },  // R2 : medium (500)
      { type: 'taxiway', x: 300, y: 600, w: 200, h: 40 },  // T2 : sous le bord bas de R2
      { type: 'taxiway', x: 300, y: 640, w: 40, h: 160 },  // corridor vertical (T2 → terminal/T1)
      { type: 'terminal', x: 340, y: 650, w: 200, h: 150 },// 4 portes (L, M, M, L)
      { type: 'taxiway', x: 340, y: 800, w: 200, h: 40 }, // T1 : portes + côté de R1
    ],
    gateSizes: ['L', 'M', 'M', 'L'],
  }),
});

__exports.DEFAULT_AIRPORT = DEFAULT_AIRPORT;
__exports.AIRPORTS = AIRPORTS;
})(__reg['m_src_core_layouts']);

/* --- module src/ui/intro.mjs --- */
(function (__exports) {
// R20 — Introduction courte et désactivable du PREMIER CYCLE de jeu :
// accepter un vol → observer sa porte → consulter les finances →
// comprendre un goulot → investir si utile.
// UI fine : elle ne fait que pointer vers les panneaux EXISTANTS (aucune
// règle de jeu, aucun objet de la sim). La progression vit sur `state.intro`
// (sérialisée avec l'état entier → la progression REPREND après sauvegarde).
// Désactivable : « Passer l'intro » (skipped) ou « Terminer » (done) — les deux
// états sont sur le state, donc ils survivent à la sauvegarde : un joueur qui
// a fini l'intro ne la revoit pas en rechargeant.
// ponytail : 5 étapes en dur (le brief demande une intro courte), pas de
// système de tutoriel paramétrable ; une étape ne « récompense » rien (pas de
// récompense, pas de condition de succès — le panneau guide, la sim décide).
const STEPS = Object.freeze([
  {
    title: '1/5 · Recevoir un vol',
    text: 'À droite, le panneau « Vols » liste les offres à décider. Cliquez sur Accepter : le vol arrivera à son horaire, atterrira et amarrera à une porte du terminal.',
  },
  {
    title: '2/5 · Observer sa porte',
    text: 'Quand l’avion arrive, cliquez dessus sur la carte : le panneau Inspection (en bas à droite) montre sa phase, sa porte, et la cause de tout retard.',
  },
  {
    title: '3/5 · Consulter les finances',
    text: 'Le panneau Bilan financier affiche le solde, le résultat de la période et les causes du déficit (exploitation, carburant, indemnités, dette).',
  },
  {
    title: '4/5 · Comprendre un goulot',
    text: 'Vol annulé ou retardé ? La cause est lisible : Diagnostic réseau (porte coupée), file d’arrivées saturée, station carburant en panne — et une offre impossible dans « Vols » explique son obstacle.',
  },
  {
    title: '5/5 · Investir si utile',
    text: 'Barre en bas à gauche : choisissez un bâtiment (B ou 1-8), cliquez sur la carte pour le poser (coût débité). Piste plus longue → vols plus gros ; porte → plus de vols au sol ; station carburant → pas de départs secs.',
  },
]);

function makeIntro(state, parent = document.body) {
  const intro = {};

  // Normalisation : une sauvegarde ANCIENNE (sans champ intro) ou une nouvelle
  // partie (makeGameState sans intro) repartent sur l'étape 1, non désactivée.
  // L'étape est bornée (0..4) : une sauvegarde corrompue ne fait jamais
  // sortir la peinture de la liste des étapes.
  function norm() {
    state.intro = state.intro ?? { step: 0, done: false, skipped: false };
    state.intro.step = Math.max(0, Math.min(STEPS.length - 1, state.intro.step | 0));
    return state.intro;
  }

  // Carte DOM (créée une fois, en bas à gauche sous la barre de commandes) —
  // <button> réels (souris + clavier), comme le reste de l'UI. Le parent est
  // injectable (test Node : conteneur factice ; produit : document.body).
  const card = document.createElement('div');
  card.className = 'intro';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Introduction — premier cycle de jeu');
  const title = document.createElement('h4');
  const text = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'intro-actions';
  const prev = document.createElement('button');
  prev.className = 'tool';
  prev.textContent = '← Précédent';
  const next = document.createElement('button');
  next.className = 'tool';
  next.textContent = 'Suivant →';
  const done = document.createElement('button');
  done.className = 'tool';
  done.textContent = 'Terminer l’intro';
  const skip = document.createElement('button');
  skip.className = 'tool tool--danger';
  skip.textContent = 'Passer l’intro';
  actions.append(prev, next, done);
  card.append(title, text, actions, skip);
  parent.appendChild(card);

  function paint(i) {
    const s = STEPS[i];
    title.textContent = s.title;
    text.textContent = s.text;
    prev.style.display = i > 0 ? '' : 'none';
    next.style.display = i < STEPS.length - 1 ? '' : 'none';
    done.style.display = i === STEPS.length - 1 ? '' : 'none';
  }
  prev.addEventListener('click', () => { const n = norm(); n.step = Math.max(0, n.step - 1); paint(n.step); });
  next.addEventListener('click', () => { const n = norm(); n.step = Math.min(STEPS.length - 1, n.step + 1); paint(n.step); });
  done.addEventListener('click', () => { const n = norm(); n.done = true; card.style.display = 'none'; });
  skip.addEventListener('click', () => { const n = norm(); n.skipped = true; card.style.display = 'none'; });

  // Appelé à chaque frame (bus 'frame') : normalise le champ (reprise /
  // nouvelle partie) et montre la carte uniquement EN JEU, tant que l'intro
  // n'est ni terminée ni passée. Peinture idempotente (textContent stable).
  intro.refresh = () => {
    const n = norm();
    const open = state.screen === 'game' && !n.done && !n.skipped;
    card.style.display = open ? '' : 'none';
    if (open) paint(n.step);
  };
  intro.refresh();

  return intro;
}

__exports.makeIntro = makeIntro;
})(__reg['m_src_ui_intro']);

/* --- module src/audio.mjs --- */
(function (__exports) {
// R44 (t_ebbb202e) — Audio SYNTHÉTISÉ, zéro asset externe (Web Audio uniquement).
// Le projet décide « règles ailleurs, UI fine ici » — l'audio suit le même
// découpage :
//   - SYNTH : les RECETTES de synthèse sont des données PURES (oscillateurs +
//     enveloppes de gain) — testables dans Node, sans AudioContext ;
//   - sfxForAlert(kind) : le mapping ALERTE → SFX est une fonction PURE (testée
//     sans navigateur). Câblée dans main.mjs sur la MÊME ligne que le toast et
//     le juice (même porte seq) : un événement = 1 toast + 1 effet visuel +
//     1 son, jamais plus ;
//   - makeAudioEngine() : la SEULE partie qui touche la Web Audio API. En
//     mode DRY (pas d'AudioContext — Node, CI) play() journalise sans erreur :
//     le module reste testable partout (stats() : dry, last, plays, ...).
// MUTE : persistant via SAUVEGARDE — le flag vit sur l'ÉTAT (state.audio =
// { muted }), sérialisé avec l'état entier par save.mjs ; le gain maître est
// `muted ? 0 : volume` (masterGainOf, pure).
// VOLUME : l'option R43 (0-100, clé dédiée aux options) pilote setVolume(v/100)
// — la valeur persiste, le moteur l'applique LIVE (main.mjs : onApply + boot).
// AMBIENT : boucle discrète optionnelle (bourdon 55 Hz + bruit filtré), OFF
// par défaut — setAmbient(true) l'active (jamais d'asset, même principe).
// ponytail : une voix par oscillateur + UN buffer de bruit blanc partagé ; les
// durées restent courtes (≤ 1 s) et les gains modestes — la synthèse doit
// rester lisible et testable, jamais d'asset (c'est le critère de la carte).

// ---- 1. RECETTES : données pures (aucune API navigateur dans ces objets) ---
// Voix : { type: 'sine'|'square'|'sawtooth'|'triangle'|'noise',
//          f0 (Hz) [, f1 (Hz, balayé en fin de voix)],
//          dur (s), gain (0..1), attack? (s), release? (s), delay? (s),
//          filter? { type: 'lowpass'|'highpass'|'bandpass', freq (Hz), q? } }
// Pour type 'noise', f0 est ignoré : la voix est un buffer de bruit blanc
// partagé, éventuellement filtré par `filter`.
const SYNTH = Object.freeze({
  // Clic UI : tick court et discret (boutons du menu / page options).
  uiClick: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'triangle', f0: 1400, f1: 800, dur: 0.07, gain: 0.15 }),
    ]),
  }),
  // Construction : choc sourd (bruit filtré) + pop + carillon.
  build: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'noise', f0: 120, dur: 0.2, gain: 0.5, attack: 0.005, release: 0.12, filter: Object.freeze({ type: 'lowpass', freq: 400 }) }),
      Object.freeze({ type: 'square', f0: 200, f1: 320, dur: 0.12, gain: 0.22 }),
      Object.freeze({ type: 'triangle', f0: 660, dur: 0.16, gain: 0.18, delay: 0.1 }),
    ]),
  }),
  // Décollage : grondement monté (sawtooth 80→240 Hz) + souffle filtré.
  takeoff: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'sawtooth', f0: 80, f1: 240, dur: 0.9, gain: 0.28, attack: 0.15, release: 0.4 }),
      Object.freeze({ type: 'noise', f0: 500, dur: 1.0, gain: 0.2, attack: 0.25, release: 0.5, filter: Object.freeze({ type: 'bandpass', freq: 600, q: 0.7 }) }),
    ]),
  }),
  // Atterrissage : choc + boum grave + sifflement d'essuie (freinage).
  land: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'noise', f0: 80, dur: 0.25, gain: 0.55, attack: 0.005, release: 0.15, filter: Object.freeze({ type: 'lowpass', freq: 300 }) }),
      Object.freeze({ type: 'sine', f0: 70, f1: 45, dur: 0.3, gain: 0.35 }),
      Object.freeze({ type: 'noise', f0: 1200, dur: 0.35, gain: 0.1, delay: 0.18, release: 0.2, filter: Object.freeze({ type: 'highpass', freq: 2000 }) }),
    ]),
  }),
  // Gain d'argent : arpège monté (objectif réussi, emprunt obtenu, contrat réussi).
  cashGain: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'sine', f0: 660, dur: 0.09, gain: 0.2 }),
      Object.freeze({ type: 'sine', f0: 880, dur: 0.09, gain: 0.2, delay: 0.09 }),
      Object.freeze({ type: 'sine', f0: 1320, dur: 0.14, gain: 0.22, delay: 0.18 }),
    ]),
  }),
  // Perte d'argent : deux notes descendantes (trésorerie en sifflet, revenu perdu).
  cashLoss: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'sine', f0: 520, dur: 0.12, gain: 0.2 }),
      Object.freeze({ type: 'sine', f0: 330, dur: 0.18, gain: 0.22, delay: 0.12 }),
    ]),
  }),
  // Incident / événement notable : deux notes carrées (piste fermée, pic, faillite).
  event: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'square', f0: 700, dur: 0.12, gain: 0.16 }),
      Object.freeze({ type: 'square', f0: 520, dur: 0.16, gain: 0.16, delay: 0.14 }),
    ]),
  }),
  // Refus (pas de fonds / construction bloquée) : buzz bref.
  deny: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'square', f0: 160, dur: 0.15, gain: 0.18 }),
    ]),
  }),
});

// Nom des SFX (lecture pour tests/CDP — la liste est close : pas de nom
// inventé à l'appel, sfxForAlert n'émet que ceux-ci).
const SFX_NAMES = Object.freeze(Object.keys(SYNTH));

// ---- 2. Mapping ALERTE → SFX : fonction PURE (testée sans navigateur) ------
// Les kinds couverts sont ceux émis par la sim (grep pushEvent) + le feedback
// construction (built/demolished/upgraded passent ICI, pas dans build-tool :
// la sim émet l'alerte, main.mjs joue le son — un seul déclencheur, même
// porte seq que le toast et le juice). Les kinds SILENCIEUX (info sans
// conséquence sonore) retournent null.
const ALERT_SFX = Object.freeze({
  // construction / infra
  'built': 'build',
  'demolished': 'build',
  'upgraded': 'build',
  'no-funds': 'deny',
  'build-blocked': 'deny',
  'locked': 'deny',
  // vols
  'flight-in': 'land',
  'flight-out': 'takeoff',
  'flight-cancelled': 'cashLoss',
  'no-fuel': 'cashLoss',
  'ac-blocked': 'event',
  // argent
  'objective-paid': 'cashGain',
  'loan-taken': 'cashGain',
  'contract-success': 'cashGain',
  'treasury-warn': 'cashLoss',
  'treasury-critical': 'cashLoss',
  'planning-relief': 'cashLoss',
  'contract-failed': 'cashLoss',
  'contract-cancelled': 'cashLoss',
  // incidents opérationnels (BL-14)
  'runway-closed': 'event',
  'fuel-out': 'event',
  'surge-start': 'event',
  'surge-end': 'event',
  'runway-reopen': 'event',
  'fuel-back': 'event',
  'bankrupt': 'event',
  'unlocked': 'event',
  // T2-2 (t_6344db94) : la campagne (victoire) + les succès
  'campaign-won': 'cashGain',
  'campaign-lost': 'cashLoss',
  'achievement-unlocked': 'cashGain',
  // T3 (t_4c9baadc) : la couche d'événements dynamiques — l'alerte
  // « event-start » sonne le SFX NOTABLE (le même que les incidents)
  'event-start': 'event',
  // silencieux : 'flight-offer-expired', 'contract-offered',
  // 'contract-started', 'contract-refused', 'contract-expired',
  // 'bankruptcy-resumed', 'ac-blocked' non → ci-dessus, tout le reste = null.
});

function sfxForAlert(kind) {
  return Object.prototype.hasOwnProperty.call(ALERT_SFX, kind) ? ALERT_SFX[kind] : null;
}

// ---- 3. Helpers PUFS (bornes + gains) --------------------------------------
// Gain maître = volume × (mute ? 0 : 1) : le mute coupe TOUT (le volume
// persiste — on ne « perd » jamais la préférence R43).
function masterGainOf(volume, muted) {
  return muted ? 0 : clamp01(volume);
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// État audio sur le STATE du jeu (sérialisé avec la sauvegarde entière) :
// { muted: boolean } — normalisation défensive (une sauvegarde corrompue ne
// doit jamais planter le son, même pattern que normalizeOptions R43).
function normalizeAudioState(a) {
  return { muted: !!(a && a.muted) };
}

// Validation des recettes (PURE) : retourne une LISTE d'erreurs (vide = OK).
// Les tests verrouillent la complétude : aucune recette ne peut être ajoutée
// corrompue (fréquence nulle, durée négative, gain hors 0..1, type inconnu).
const VOICE_TYPES = new Set(['sine', 'square', 'sawtooth', 'triangle', 'noise']);
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);

function validateVoice(v) {
  const errs = [];
  if (!VOICE_TYPES.has(v.type)) errs.push(`type inconnu : ${v.type}`);
  if (!(v.f0 > 0) || !Number.isFinite(v.f0)) errs.push(`f0 invalide : ${v.f0}`);
  if (v.f1 != null && (!(v.f1 > 0) || !Number.isFinite(v.f1))) errs.push(`f1 invalide : ${v.f1}`);
  if (!(v.dur > 0) || !Number.isFinite(v.dur)) errs.push(`dur invalide : ${v.dur}`);
  if (v.dur > 2) errs.push(`dur trop longue : ${v.dur} (≤ 2 s)`);
  if (!(v.gain > 0) || v.gain > 1 || !Number.isFinite(v.gain)) errs.push(`gain hors (0..1] : ${v.gain}`);
  if (v.attack != null && (v.attack < 0 || v.attack >= v.dur)) errs.push(`attack hors [0..dur) : ${v.attack}`);
  if (v.release != null && (v.release < 0 || v.release > v.dur)) errs.push(`release hors [0..dur] : ${v.release}`);
  if (v.delay != null && v.delay < 0) errs.push(`delay négatif : ${v.delay}`);
  if (v.filter) {
    if (!FILTER_TYPES.has(v.filter.type)) errs.push(`filter.type inconnu : ${v.filter.type}`);
    if (!(v.filter.freq > 0) || !Number.isFinite(v.filter.freq)) errs.push(`filter.freq invalide : ${v.filter.freq}`);
    if (v.filter.q != null && v.filter.q <= 0) errs.push(`filter.q invalide : ${v.filter.q}`);
  }
  return errs;
}

function validateSynth() {
  const errs = [];
  for (const [name, recipe] of Object.entries(SYNTH)) {
    if (!Array.isArray(recipe.voices) || recipe.voices.length === 0) {
      errs.push(`${name} : aucune voix`);
      continue;
    }
    for (const [i, v] of recipe.voices.entries()) errs.push(...validateVoice(v).map((e) => `${name}[${i}] : ${e}`));
  }
  return errs;
}

// ---- 4. MOTEUR : la seule partie qui touche la Web Audio API ---------------
// `Ctx` est injectable (tests : un faux AudioContext ; navigateur : absent →
// globalThis.AudioContext). SANS contexte (Node/CI) = mode DRY : play()
// journalise et retourne false, jamais d'exception.
function makeAudioEngine({ Ctx = null, now = () => Date.now() } = {}) {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let volume = 0.5; // défaut = l'option R43 par défaut (50)
  let muted = false; // défaut = normalizeAudioState(undefined)
  let ambientOn = false;
  let ambientNodes = null;
  const playLog = [];

  function ensure() {
    if (ctx) return true;
    const Ctor = Ctx || globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return false; // mode dry (Node)
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = masterGainOf(volume, muted);
      master.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }

  // Buffer de bruit blanc PARTAGÉ (ponytail : un seul buffer, 1 s, Math.random
  // — le bruit est de l'audio, la détermination ne le concerne pas).
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function scheduleVoice(v, t0) {
    const start = t0 + (v.delay || 0);
    const end = start + v.dur;
    const attack = v.attack != null ? v.attack : 0.005;
    const release = v.release != null ? v.release : 0.05;
    const peak = start + attack;
    const relStart = Math.max(peak, end - release);
    let src;
    if (v.type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
    } else {
      src = ctx.createOscillator();
      src.type = v.type;
      src.frequency.setValueAtTime(v.f0, start);
      if (v.f1 != null) src.frequency.linearRampToValueAtTime(v.f1, end);
    }
    let node = src;
    if (v.filter) {
      const f = ctx.createBiquadFilter();
      f.type = v.filter.type;
      f.frequency.value = v.filter.freq;
      if (v.filter.q) f.Q.value = v.filter.q;
      src.connect(f);
      node = f;
    }
    const g = ctx.createGain(); // enveloppe : montée → plateau → descente
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(v.gain, peak);
    g.gain.setValueAtTime(v.gain, relStart);
    g.gain.linearRampToValueAtTime(0.0001, end);
    node.connect(g);
    g.connect(master);
    src.start(start);
    src.stop(end + 0.05);
  }

  function play(name) {
    const recipe = SYNTH[name];
    if (!recipe) {
      playLog.push({ name, at: now(), dry: ctx == null, skipped: 'inconnu' });
      return false;
    }
    if (!ensure()) {
      playLog.push({ name, at: now(), dry: true, skipped: 'dry' });
      return false;
    }
    if (ctx.state === 'suspended') {
      // Politique d'autoplay (navigateur) : le contexte peut naître « suspendu »
      // avant un geste utilisateur — on le réveille (promesse abandonnée : si
      // le geste n'a pas eu lieu, la première écoute réelle reprend).
      try { ctx.resume && ctx.resume().catch(() => {}); } catch { /* dry-safe */ }
    }
    const t0 = ctx.currentTime;
    for (const v of recipe.voices) scheduleVoice(v, t0);
    playLog.push({ name, at: now() });
    return true;
  }

  function setVolume(v) {
    volume = clamp01(v);
    if (master) master.gain.value = masterGainOf(volume, muted);
  }

  function setMuted(b) {
    muted = !!b;
    if (master) master.gain.value = masterGainOf(volume, muted);
  }

  // Ambiance discrète (bourdon + bruit filtré) : OFF par défaut.
  function setAmbient(on) {
    ambientOn = !!on;
    if (!ensure()) return; // dry : on retient seulement l'intention
    if (ambientOn && !ambientNodes) {
      const g = ctx.createGain(); // le gain d'ambiance est FIXE (indépendant du mute :
      g.gain.value = 0.05;        // le gain maître, en aval, reste la source unique du coupé)
      g.connect(master);
      const o1 = ctx.createOscillator();
      o1.type = 'sine'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = 55.4; // battement lent (vibré doux)
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer();
      n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 220;
      const ng = ctx.createGain(); ng.gain.value = 0.5;
      o1.connect(g); o2.connect(g);
      n.connect(f); f.connect(ng); ng.connect(g);
      o1.start(); o2.start(); n.start();
      ambientNodes = { g, o1, o2, n, f, ng };
    } else if (!ambientOn && ambientNodes) {
      try { ambientNodes.o1.stop(); ambientNodes.o2.stop(); ambientNodes.n.stop(); } catch { /* déjà stoppé */ }
      ambientNodes.g.disconnect();
      ambientNodes = null;
    }
  }

  function stats() {
    return {
      dry: ctx == null,
      ctxState: ctx ? ctx.state : null,
      muted,
      volume,
      ambient: ambientOn,
      plays: playLog.length,
      last: playLog.length ? playLog[playLog.length - 1] : null,
    };
  }

  // État initial (main.mjs le pousse depuis l'option R43 + la sauvegarde).
  setVolume(0.5);
  setMuted(false);

  return {
    play,
    setVolume,
    setMuted,
    setAmbient,
    isMuted: () => muted,
    getVolume: () => volume,
    stats,
  };
}

__exports.SYNTH = SYNTH;
__exports.SFX_NAMES = SFX_NAMES;
__exports.sfxForAlert = sfxForAlert;
__exports.masterGainOf = masterGainOf;
__exports.clamp01 = clamp01;
__exports.normalizeAudioState = normalizeAudioState;
__exports.validateVoice = validateVoice;
__exports.validateSynth = validateSynth;
__exports.makeAudioEngine = makeAudioEngine;
})(__reg['m_src_audio']);

/* --- module src/ui/options.mjs --- */
(function (__exports) {
// R43 (t_62bd0be8) — Options PERSISTANTES : volume 0-100, mode daltonien,
// vitesse x1/x2/x4. Logique PURE (aucun DOM/localStorage) → testable dans
// Node ; les wrappers de stockage sont gardés par `typeof localStorage`
// (sans effet sous Node), MÊME PATRON que src/persistence/save.mjs.
//
// Stockage : une clé DÉDIÉE (OPTIONS_KEY), SÉPARÉE de la sauvegarde de jeu
// → les options survivent à une NOUVELLE PARTIE et à une suppression de la
// sauvegarde (c'est le but d'une page Options). `state.options` est le
// miroir VIVANT que le renderer lit (palette daltonienne) ; main.mjs en est
// le seul pont : il persiste ici et synchronise `state.speedIndex` (les
// vitesses EXISTANTES — SPEEDS de game-state.mjs, jamais réinventées).
//
// Politique corrompue : une options illisible/incompatible retombe aux
// DÉFAUTS (une préférence ne doit JAMAIS bloquer le jeu) — à la différence
// de la sauvegarde de jeu qui est préservée en copie diagnostic (A10).
const { SPEEDS } = __ns('m_src_core_game-state');

const OPTIONS_KEY = 'airport-tycoon-options';
const OPTIONS_VERSION = 1;
const DEFAULT_OPTIONS = Object.freeze({ volume: 50, colorBlind: false, speedIndex: 0 });

// Normalisation PURE : aucune valeur corrompue ne sort des bornes.
//  - volume : entier 0-100 (arrondi ; hors borne/absent → défaut 50) ;
//  - colorBlind : booléen (tout non-booléen est coercé proprement) ;
//  - speedIndex : entier 0..SPEEDS.length-1 (les vitesses EXISTANTES x1/x2/x4 ;
//    hors borne/absent → défaut 0). Les bornes sont calculées depuis SPEEDS :
//    si de nouvelles vitesses sont ajoutées, la page et la validation suivent.
function normalizeOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const volume = Number.isFinite(o.volume)
    ? Math.round(Math.min(100, Math.max(0, o.volume)))
    : DEFAULT_OPTIONS.volume;
  const colorBlind = !!o.colorBlind;
  const si = Number.isInteger(o.speedIndex) ? o.speedIndex : DEFAULT_OPTIONS.speedIndex;
  const speedIndex = Math.min(SPEEDS.length - 1, Math.max(0, si));
  return { volume, colorBlind, speedIndex };
}

// Sérialise (fonction PURE, A11) : normalise avant écriture → on ne persiste
// jamais une valeur hors bornes.
function serializeOptions(options) {
  return JSON.stringify({ v: OPTIONS_VERSION, options: normalizeOptions(options) });
}

// Dé-sérialise + VALIDE : lève une erreur LISIBLE si corrompu/incompatible.
function deserializeOptions(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Options illisibles (JSON corrompu)');
  }
  if (!raw || typeof raw !== 'object') throw new Error('Options vides');
  if (raw.v !== OPTIONS_VERSION) {
    throw new Error(`Options incompatibles (v${raw.v ?? '?'} ≠ v${OPTIONS_VERSION})`);
  }
  return normalizeOptions(raw.options);
}

// --- Stockage navigateur (localStorage) — sans effet sous Node. -------------
// `st` est injectable : les tests Node passent un objet factice avec la
// sémantique localStorage (getItem/setItem/removeItem).
function storage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

// Enregistre ; true si succès (l'UI fait le toast), false sinon.
function saveOptionsToStorage(options, st = storage()) {
  if (!st) return false;
  try {
    st.setItem(OPTIONS_KEY, serializeOptions(options));
    return true;
  } catch {
    return false; // stockage plein/indisponible : on signale, on ne plante pas
  }
}

// Charge + normalise. ABSENTE → DÉFAUTS (copie, jamais la constante gelée) ;
// CORROMPUE/INCOMPATIBLE → DÉFAUTS (une préférence ne bloque jamais le jeu).
function loadOptions(st = storage()) {
  if (!st) return { ...DEFAULT_OPTIONS };
  let json = null;
  try {
    json = st.getItem(OPTIONS_KEY);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
  if (json == null) return { ...DEFAULT_OPTIONS };
  try {
    return deserializeOptions(json);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

// Efface (retour aux défauts à la prochaine lecture).
function clearOptions(st = storage()) {
  if (!st) return;
  try {
    st.removeItem(OPTIONS_KEY);
  } catch { /* indisponible : sans effet */ }
}

// --- Page Options (DOM) — navigateur seul (tests Node : DOM factice, -------
// --- même patron que intro.mjs/bankruptcy.mjs : les boutons pointent vers
// --- l'ON APPLY/BACK injectés, la page ne décide rien d'autre).
// La page édite l'objet `opts` PASSÉ (le miroir vivant de main.mjs) et émet
// onApply(options) après chaque COMMIT (slider volume, toggle daltonien,
// bouton vitesse). `refresh()` est appelé à chaque frame (bus 'frame') :
// affichage borné + repaint idempotent (signature, pattern panels.mjs).
function makeOptionsPage(state, opts, { onApply, onBack, parent = document.body }) {
  const card = document.createElement('div');
  card.className = 'options';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Options — volume, mode daltonien, vitesse');

  const title = document.createElement('h4');
  title.textContent = 'Options';

  // Volume 0-100 : slider + affichage numérique (la valeur est lisible sans
  // regarder la position du curseur — critère R39 étendu aux options).
  const volRow = document.createElement('div');
  volRow.className = 'opt-row';
  const volLabel = document.createElement('label');
  volLabel.className = 'opt-label';
  const volName = document.createElement('span');
  volName.className = 'opt-name';
  volName.textContent = 'Volume';
  const volValue = document.createElement('span');
  volValue.className = 'opt-value';
  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.step = '1';
  volSlider.className = 'opt-volume';
  volLabel.append(volName, volValue, volSlider);
  volRow.append(volLabel);

  // Mode daltonien : un bouton bascule (pas de case à cocher : le label
  // affiche l'état, lisible au clavier comme à la souris).
  const cbBtn = document.createElement('button');
  cbBtn.className = 'tool';
  cbBtn.dataset.opt = 'colorBlind';

  // Vitesse : UN BOUTON par vitesse EXISTANTE (SPEEDS : x1/x2/x4) — la
  // sélection est marquée par aria-pressed (CSS .options [aria-pressed]).
  const speedRow = document.createElement('div');
  speedRow.className = 'opt-speeds';
  const speedBtns = SPEEDS.map((f, i) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.speedIndex = String(i);
    b.textContent = `Vitesse x${f}`;
    speedRow.appendChild(b);
    return b;
  });

  const back = document.createElement('button');
  back.className = 'tool';
  back.textContent = 'Retour au menu';

  card.append(title, volRow, cbBtn, speedRow, back);
  parent.appendChild(card);
  card.style.display = 'none';

  let open = false;
  let sig = '';

  // Commit : normalise l'objet vivant (bornes) puis émet onApply (main.mjs :
  // persistance + synchro state.speedIndex + toast). La page ne persiste
  // RIEN elle-même (UI fine : le stockage appartient au pont main.mjs).
  function commit() {
    const next = normalizeOptions(opts);
    Object.assign(opts, next);
    onApply?.(opts);
    refresh(); // repaint immédiat (la valeur normalisée est lisible)
  }

  volSlider.addEventListener('input', () => {
    opts.volume = Number(volSlider.value); // le slider ne peut pas sortir de 0-100
    commit();
  });
  // Repli sur 'change' (certains navigateurs n'émettent que 'change').
  volSlider.addEventListener('change', () => {
    opts.volume = Number(volSlider.value);
    commit();
  });
  cbBtn.addEventListener('click', () => {
    opts.colorBlind = !opts.colorBlind;
    commit();
  });
  for (const b of speedBtns) {
    b.addEventListener('click', () => {
      opts.speedIndex = Number(b.dataset.speedIndex);
      commit();
    });
  }
  back.addEventListener('click', () => {
    onBack?.(); // main.mjs : optionsPage.close() (revenir au menu)
  });

  // Peinture bornée : tout est dérivé de l'objet options (le renderer est en
  // lecture seule sur ce miroir, lui, via paletteOf).
  function paint() {
    volSlider.value = String(opts.volume);
    volValue.textContent = `${opts.volume} / 100`;
    cbBtn.textContent = `Mode daltonien : ${opts.colorBlind ? 'ON' : 'OFF'}`;
    speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === opts.speedIndex)));
  }
  // Déclaration (pas méthode du page) : hoistée → callable depuis commit()
  // (qui la repaint à chaque COMMIT), et la page l'expose telle quelle.
  function refresh() {
    card.style.display = open ? '' : 'none';
    const s = `${opts.volume}|${opts.colorBlind}|${opts.speedIndex}`;
    if (s !== sig) { sig = s; paint(); }
  }

  const page = {
    // Appelé à chaque frame (main.mjs, bus 'frame') : l'affichage suit l'objet
    // options SANS repaint intempestif (signature — même pattern que panels).
    refresh,
    open: () => { open = true; refresh(); },
    close: () => { open = false; refresh(); },
    toggle: () => { (open ? page.close : page.open)(); },
    isOpen: () => open,
  };
  page.refresh(); // état initial (masqué)
  return page;
}

__exports.OPTIONS_KEY = OPTIONS_KEY;
__exports.OPTIONS_VERSION = OPTIONS_VERSION;
__exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
__exports.normalizeOptions = normalizeOptions;
__exports.serializeOptions = serializeOptions;
__exports.deserializeOptions = deserializeOptions;
__exports.saveOptionsToStorage = saveOptionsToStorage;
__exports.loadOptions = loadOptions;
__exports.clearOptions = clearOptions;
__exports.makeOptionsPage = makeOptionsPage;
})(__reg['m_src_ui_options']);

/* --- module src/sim/weather.mjs --- */
(function (__exports) {
// T3 (t_9b665a8b) — MÉTÉO : 5 états (clair/nuageux/pluie/neige/orage) avec
// effets MESURABLES sur la sim, cycle aléatoire DÉTERMINISTE (graine dans la
// partie — le PRNG semé de la sim, EV-10), zéro asset (le HUD reste canvas).
//
// Le module est LA source de vérité du cycle météo (pattern incidents.mjs) :
//   - tickWeather (tick.mjs, APRÈS le planificateur, AVANT les avions — la
//     météo du tick courant pilote les retards/capacité du tick courant) ;
//   - weatherOf / weatherView : lectures pures (UI — sans mutation) ;
//   - weatherEffect : LA règle unique d'effet (voir ci-dessous) ;
//   - forceWeather : forçage déterministe (tests + QA CDP, pattern
//     forceIncident) ;
//   - ensureWeather : migration additive (EV-10) — une sauvegarde PRÉ-T3
//     (sim.weather absent) est ADOPTÉE en « clear », sans crash, sans toucher
//     les autres champs ; un champ corrompu est réparé.
//
// Les EFFETS vivent chez les modules concernés (comme pour les incidents) :
//   - aircraft.mjs : la vitesse d'approche/descente est MULTIPLIÉE par
//     WEATHER_EFFECTS (speed < 1 = arrivée plus LENTE + occupation piste
//     PROLONGÉE = capacité réduite) + un retard FIXE (delay, s) ajouté UNE
//     FOIS par entrée en attente (holding) par temps dégradé ;
//   - incidents.mjs : l'incident MÉTÉO (4e incident, i.weather) — le tirage
//     de fenêtre est BIAISÉ par l'état météo (WEATHER_EFFECTS.incident) ;
//     pendant qu'il est ACTIF, les effets météo sont majorés à la ligne
//     « orage » (weatherEffect — la règle unique, mesurable).
// Déterminisme : 2 tirages par transition (état suivant + durée) sur le rng
// SEMÉ de la sim → la suite météo est reproductible à la reprise (EV-10),
// comme les vols et les incidents.

const { pushEvent } = __ns('m_src_core_sim-state');

const WEATHER_STATES = Object.freeze(['clear', 'cloudy', 'rain', 'snow', 'storm']);

// Libellés FR (HUD/panneaux — le jeu est en français).
const WEATHER_FR = Object.freeze({
  clear: 'clair', cloudy: 'nuageux', rain: 'pluie', snow: 'neige', storm: 'orage',
});

// Durée BORNÉE de chaque état (s sim) — durée réelle = base × (0,8 + 0,4×tirage)
// (± 20 % : pas d'état infini, pas de pic à durée nulle).
const DURATIONS = Object.freeze({ clear: 900, cloudy: 720, rain: 480, snow: 480, storm: 300 });

// Table de transition (chaîne de Markov) : bornes cumulées sur UN tirage
// unique (0..1) — déterministe. Chaque ligne est une distribution complète
// (les bornes montent vers 1 ; le 5e état = le reste) :
//   r < t[0] → clair | < t[1] → nuageux | < t[2] → pluie | < t[3] → neige | sinon orage
// Le temps dégénéré (pluie/neige/orage) retourne vers le clair/nuageux PLUS
// vite qu'il n'en part (la météo est un événement, pas un régime).
const NEXT = Object.freeze({
  clear:  [0.50, 0.80, 0.90, 0.95],
  cloudy: [0.40, 0.70, 0.90, 0.95],
  rain:   [0.15, 0.50, 0.80, 0.90],
  snow:   [0.10, 0.40, 0.60, 0.90],
  storm:  [0.20, 0.70, 0.90, 0.95],
});

// TABLE D'EFFETS (couche PARAMÈTRES — les chiffres, pas la logique ; R37) :
//   speed    : facteur de vitesse d'approche/descente (1 = inchangé ; < 1 =
//              plus lent → RETARD d'arrivées MESURABLE + occupation piste
//              prolongée → CAPACITÉ réduite, émergent, pas une 2e règle).
//   delay    : retard FIXE (s sim) ajouté UNE FOIS par entrée en attente
//              (holding) — 0 par temps clair (le clair = l'état existant).
//   incident : probabilité de l'incident MÉTÉO par fenêtre (incidents.mjs) —
//              0 par temps clair (jamais d'incident météo quand il fait beau).
const WEATHER_EFFECTS = Object.freeze({
  clear:  { speed: 1.0, delay: 0, incident: 0.0 },
  cloudy: { speed: 1.0, delay: 10, incident: 0.1 },
  rain:   { speed: 0.7, delay: 30, incident: 0.3 },
  snow:   { speed: 0.5, delay: 60, incident: 0.5 },
  storm:  { speed: 0.3, delay: 90, incident: 0.7 },
});

// Migration additive (EV-10) + réparation défensive (pattern R31/R32/
// ensureCampaign) : sauvegarde PRÉ-T3 (champ absent) → « clear » neuf ;
// champ corrompu (état inconnu / durée hors bornes) → réparé. JAMAIS de
// crash, les autres champs de la sim sont INTACTS.
function ensureWeather(sim) {
  const w = sim.weather;
  if (!w || typeof w !== 'object' || !WEATHER_STATES.includes(w.state)) {
    sim.weather = { state: 'clear', remaining: DURATIONS.clear, acc: 0 };
    return sim.weather;
  }
  if (!Number.isFinite(w.remaining) || w.remaining <= 0) w.remaining = DURATIONS[w.state];
  if (!Number.isFinite(w.acc) || w.acc < 0) w.acc = 0;
  return sim.weather;
}

// Lecture SANS mutation (pattern runwayClosedRO — l'UI ne fabrique PAS
// l'état) : l'état courant, « clear » si le champ est absent/corrompu.
function weatherOf(sim) {
  const w = sim && sim.weather;
  return w && WEATHER_STATES.includes(w.state) ? w.state : 'clear';
}

// L'EFFET météo ACTIF — LA règle unique lue par aircraft.mjs (pas de 2e règle,
// pattern R05) : la ligne de l'état courant, MAJORÉE à la ligne « orage » (la
// pire) si l'incident MÉTÉO (i.weather, incidents.mjs) est ACTIF. Lecture
// directe du champ (guardé — la fin normale le referme ; ensureIncidents le
// crée au 1er tick) : jamais d'ensure ici (pas de mutation).
function weatherEffect(sim) {
  const state = weatherOf(sim);
  const w = sim && sim.incidents && sim.incidents.weather;
  const active = !!(w && w.active && w.remaining > 0);
  return WEATHER_EFFECTS[active ? 'storm' : state];
}

// Lecture UI (panneau diagnostic / HUD) : l'état + sa FR + le temps restant +
// l'effet actif (majeuré si l'incident météo est en cours). incidentRemaining
// = le compte à rebours de l'INCIDENT (champ incidents.weather, lu avec garde
// — jamais d'ensure ici, pas de mutation) ; 0 quand l'incident n'est pas actif.
function weatherView(sim) {
  const state = weatherOf(sim);
  const w = sim && sim.weather;
  const iw = sim && sim.incidents && sim.incidents.weather;
  const active = !!(iw && iw.active && iw.remaining > 0);
  const eff = WEATHER_EFFECTS[active ? 'storm' : state];
  return {
    state, fr: WEATHER_FR[state],
    remaining: w ? Math.max(0, Math.ceil(w.remaining || 0)) : 0,
    incident: active, incidentRemaining: active ? Math.ceil(iw.remaining) : 0,
    speed: eff.speed, delay: eff.delay,
  };
}

// Le battement météo (appelé par tick.mjs APRÈS le planificateur, AVANT les
// avions — la météo du tick courant pilote les retards/capacité du tick
// courant) : compte à rebours de l'état courant → transition DÉTERMINISTE
// (table + 2 tirages sur le rng semé). Sans rng (jamais en jeu — tick.mjs
// le fournit) : tirage à 0 → transition « clear » (déterministe, sans crash).
function tickWeather(sim, dt, rng) {
  if (!rng) rng = () => 0;
  const w = ensureWeather(sim);
  w.acc += dt;
  w.remaining -= dt;
  if (w.remaining <= 0) {
    const from = w.state;
    w.state = nextState(w.state, rng);
    w.remaining = durationOf(w.state, rng);
    pushEvent(sim, { kind: 'weather-change', from, to: w.state });
  }
}

// Un tirage UNIQUE : bornes cumulées (table NEXT) — déterministe (pas de
// loterie par ligne : une seule valeur aléatoire par décision, comme les
// tirages incidents).
function nextState(cur, rng) {
  const r = rng();
  const t = NEXT[cur];
  return r < t[0] ? 'clear' : r < t[1] ? 'cloudy' : r < t[2] ? 'rain' : r < t[3] ? 'snow' : 'storm';
}

// Durée ± 20 % (UN tirage) : durée BORNÉE (pas d'état infini).
function durationOf(state, rng) {
  return DURATIONS[state] * (0.8 + 0.4 * rng());
}

// Forçage DÉTERMINISTE (tests + QA CDP, pattern forceIncident) : met l'état
// à la position voulue (durée MAX, AUCUN tirage — reproductible) + événement
// de transition. Sans événement si l'état ne change pas (pas de bruit).
function forceWeather(sim, state) {
  if (!WEATHER_STATES.includes(state)) return { ok: false, why: `état météo inconnu : ${state}` };
  const w = ensureWeather(sim);
  const from = w.state;
  w.state = state;
  w.remaining = DURATIONS[state]; // durée max (pas de tirage — forçage pur)
  w.acc = 0;
  if (from !== state) pushEvent(sim, { kind: 'weather-change', from, to: state });
  return { ok: true };
}

__exports.WEATHER_STATES = WEATHER_STATES;
__exports.WEATHER_FR = WEATHER_FR;
__exports.WEATHER_EFFECTS = WEATHER_EFFECTS;
__exports.ensureWeather = ensureWeather;
__exports.weatherOf = weatherOf;
__exports.weatherEffect = weatherEffect;
__exports.weatherView = weatherView;
__exports.tickWeather = tickWeather;
__exports.forceWeather = forceWeather;
})(__reg['m_src_sim_weather']);

/* --- module src/sim/clock.mjs --- */
(function (__exports) {
// T3 (t_76744b22) — HORLOGE JOUR/NUIT : le cycle de la partie (heure du jour +
// saisons) — un seul champ SÉRIALISÉ sur la sim (sim.clock : { day, t }), le
// reste est dérivé (lecture pure). Zéro asset : l'habillage du monde passe par
// UNE teinte (pattern weatherTint) et l'heure est affichée en ligne HUD/panneau.
//
// Le module est LA source de vérité de l'horloge (pattern weather.mjs) :
//   - tickClock (tick.mjs, APRÈS le planificateur) : l'avance du temps ;
//   - clockView / phaseTint : lectures pures (UI — sans mutation) ;
//   - forceClock : forçage déterministe (tests + QA CDP, pattern forceWeather) ;
//   - ensureClock : migration additive (EV-10) — une sauvegarde PRÉ-T3-horloge
//     (sim.clock absent) est ADOPTÉE à l'état initial (jour 1, 08:00), un
//     champ corrompu est réparé — sans crash, sans toucher les autres champs.
//
// ÉCHELLE : 1 jour-JEU = DAY_S secondes de simulation (2400 s sim = 24 h-jeu,
// soit 1 h-jeu = 100 s sim) : le cycle jour/nuit est VISIBLE en ~10 min de
// jeu à x4, et la campagne (deadline 10800 s sim) dure ~4,5 jours-jeu.
// Le champ `t` est stocké EN SECONDES SIM (la même unité que sim.time) —
// l'heure JEU est dérivée (t / DAY_S × 24) : pas de seconde horloge à
// synchroniser, la dérive flottante (somme de dt, ~1e-14) est tolérée comme
// pour sim.time.
//
// SAISONS : la saison est DÉRIVÉE du jour (1 saison par jour-jeu, 4 jours =
// 1 an-jeu) — voir src/core/seasons.mjs (la table de PARAMÈTRES DE SPAWN est
// lue par le planificateur via la couche spawnLayer, difficulty.mjs). Le
// passage de jour (donc de saison) émet UNE alerte lisible (season-change).
const { pushEvent } = __ns('m_src_core_sim-state');

// 1 jour-JEU en secondes de simulation (24 h-jeu = DAY_S s sim → 1 h-jeu = 100 s sim).
const DAY_S = 2400;
// Le jour 1 démarre à 08:00 (8/24 × DAY_S) — la partie commence le matin.
const DAY_START = (8 / 24) * DAY_S;

// Phases du jour (bornes EN HEURE JEU — les heures, pas les minutes) :
//   aube 6-7 · jour 8-16 · crépuscule 17-19 · nuit 20 → 5.
const PHASES = Object.freeze(['night', 'dawn', 'day', 'dusk']);
const PHASE_FR = Object.freeze({
  night: 'nuit', dawn: 'aube', day: 'jour', dusk: 'crépuscule',
});

// Teinte du monde PAR PHASE (le renderer l'applique — zéro asset, un rempli,
// pattern weatherTint) : « jour » → null (pas de bruit, le monde est déjà
// bien éclairé) ; nuit = bleuté profond, aube/crépuscule = voiles légers.
const PHASE_TINTS = Object.freeze({
  day: null,
  dawn: 'rgba(130, 100, 180, 0.10)',
  dusk: 'rgba(255, 150, 60, 0.10)',
  night: 'rgba(10, 14, 44, 0.34)',
});

// État INITIAL de l'horloge (jour 1, 08:00) — l'état de référence (référentiel
// = la partie commence le matin, en phase « jour »).
function freshClock() {
  return { day: 1, t: DAY_START };
}

// Migration additive (EV-10) + réparation défensive (pattern ensureWeather) :
// sauvegarde PRÉ-horloge (champ absent) → état initial ; champ corrompu (jour
// non entier, t non fini) → réparé. JAMAIS de crash, les autres champs de la
// sim sont INTACTS. Retourne l'horloge (la référence mutée).
function ensureClock(sim) {
  const c = sim && sim.clock;
  if (!c || typeof c !== 'object' || !Number.isInteger(c.day) || c.day < 1 || !Number.isFinite(c.t)) {
    sim.clock = freshClock();
    return sim.clock;
  }
  if (c.t < 0) c.t += DAY_S; // t hors bornes (négatif) → repli dans le jour courant
  c.t = c.t % DAY_S;
  return sim.clock;
}

// Lecture SANS mutation (pattern weatherOf — l'UI ne fabrique PAS l'état) :
// l'horloge courante, l'état initial si le champ est absent/corrompu.
function clockOf(sim) {
  const c = sim && sim.clock;
  if (!c || typeof c !== 'object' || !Number.isInteger(c.day) || c.day < 1 || !Number.isFinite(c.t)) {
    return { day: 1, t: DAY_START };
  }
  return c;
}

// La phase du jour pour une HEURE JEU (0..23) — la règle unique de découpage.
function phaseOfHour(hour) {
  if (hour >= 6 && hour <= 7) return 'dawn';
  if (hour >= 8 && hour <= 16) return 'day';
  if (hour >= 17 && hour <= 19) return 'dusk';
  return 'night'; // 20..23 et 0..5
}

// LA teinte du monde pour une phase (la « sélection » du renderer — lecture
// PURE, testable sous Node : null par temps de jour = pas de rempli).
function phaseTint(phase) {
  return PHASE_TINTS[phase] ?? null;
}

// Lecture UI (HUD/panneau) : le jour, l'heure JEU (HH:MM), la phase + sa FR,
// et la teinte à appliquer (null = pas de teinte). Aucune mutation.
function clockView(sim) {
  const c = clockOf(sim);
  const hours = (c.t / DAY_S) * 24; // heures JEU depuis 00:00 (0..24, flottant)
  const hour = Math.floor(hours) % 24;
  const minute = Math.floor((hours - Math.floor(hours)) * 60) % 60;
  const phase = phaseOfHour(hour);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    day: c.day, hour, minute,
    label: `${pad(hour)}:${pad(minute)}`,
    phase, phaseFr: PHASE_FR[phase],
    tint: phaseTint(phase),
  };
}

// Le battement de l'horloge (appelé par tick.mjs APRÈS le planificateur — le
// temps du tick courant est piloté PAR le planificateur, sim.time) : avance
// de dt (s sim) ; au ROLLOVER (t ≥ DAY_S) le jour s'incrémente ET la saison
// passe (elle est dérivée du jour — seasons.mjs) : UNE alerte lisible
// (season-change) est émise (jamais de bruit : un seul événement par jour).
function tickClock(sim, dt) {
  const c = ensureClock(sim);
  c.t += dt;
  while (c.t >= DAY_S) {
    c.t -= DAY_S;
    c.day += 1;
    if (Array.isArray(sim.alerts)) pushEvent(sim, { kind: 'season-change', day: c.day });
  }
}

// Forçage DÉTERMINISTE (tests + QA CDP, pattern forceWeather) : met l'horloge
// à la position voulue (jour + heure JEU — AUCUN tirage, reproductible). Hors
// bornes → borné (jour ≥ 1, heure 0..23). Ne pousse PAS d'événement (le
// forçage n'est pas un passage de jour naturel — pas de bruit).
function forceClock(sim, day, hour) {
  const c = ensureClock(sim);
  c.day = Math.max(1, Math.trunc(day) || 1);
  c.t = (Math.max(0, Math.min(23, Math.trunc(hour))) / 24) * DAY_S;
  return c;
}

__exports.DAY_S = DAY_S;
__exports.DAY_START = DAY_START;
__exports.PHASES = PHASES;
__exports.PHASE_FR = PHASE_FR;
__exports.PHASE_TINTS = PHASE_TINTS;
__exports.freshClock = freshClock;
__exports.ensureClock = ensureClock;
__exports.clockOf = clockOf;
__exports.phaseOfHour = phaseOfHour;
__exports.phaseTint = phaseTint;
__exports.clockView = clockView;
__exports.tickClock = tickClock;
__exports.forceClock = forceClock;
})(__reg['m_src_sim_clock']);

/* --- module src/infra/assignments.mjs --- */
(function (__exports) {
// R27 — AFFECTATION des services aux terminaux : UN module de mesure.
//
// Avant R27, l'existence d'un bâtiment dans UN coin du terrain renforçait
// l'aéroport ENTIER : cleanGates nettoyait toutes les portes, les lances
// comptaient toutes les stations, la salle bagages boostait le check-in
// global. C'est le « bonus implicite dû uniquement à l'existence d'un
// bâtiment dans un coin du terrain » que l'exigence R27 interdit.
//
// La règle : chaque service AU SOL a une AFFECTATION — le terminal qu'il
// dessert (`svc.target`), sérialisée avec l'état. Affectation automatique
// DÉTERMINISTE : le terminal le PLUS PRÊCH (distance point→rectangle entre
// le centre du service et le rectangle du terminal) ; en égalité, le plus
// ANCIEN (id le plus petit). Le joueur change l'affectation (setAssignment)
// : les capacités mesurées de chaque terminal suivent la décision.
// Terminal supprimé : les services qui le servaient sont RÉAFFECTÉS à la
// règle du placement (ou restent inactifs s'il ne reste aucun terminal) —
// motif lisible, jamais d'orphelin en silence.
//
// Migration (exigence : « migrer les anciens services avec une affectation
// expliquée ») : les sauvegardes pré-R27 n'ont pas de champ `target` —
// ensureAssignments les assigne par la règle du placement (déterministe) et
// le nombre de services touchés est retourné (l'UI annonce la migration).
// Appel : deserialize (reprise) ET après build/demolish de terminal.
//
// Les MESURES (ci-dessous) sont l'unique source d'effet : la sim et l'UI
// appellent servicesServingGate / countTypeServing, jamais de re-dérivation.
const { GROUND_SERVICE_TYPES } = __ns('m_src_data_catalog');

// Le type d'un service n'a de SENS qu'ici : un type CONNU (catalogue) sert ;
// un type inconnu (corruption, future carte) n'a JAMAIS d'effet — pas de
// bonus gratuit dû à un bâtiment que la sim ne comprend pas.
function serviceTypeKnown(type) {
  return GROUND_SERVICE_TYPES.includes(type);
}

// Le terminal le plus proche de b (distance point→rectangle : 0 si b touche
// ou entre dans le terminal). En égalité : le plus ANCIEN (id ascendant).
// null si aucun terminal (le service part INACTIF — il ne sert personne).
function nearestTerminal(sim, b) {
  const ts = sim.infra.terminals;
  if (!ts.length) return null;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  let best = null, bestD = Infinity;
  for (const t of ts) {
    const dx = Math.max(Math.abs(bx - (t.x + t.w / 2)) - t.w / 2, 0);
    const dy = Math.max(Math.abs(by - (t.y + t.h / 2)) - t.h / 2, 0);
    const d = Math.hypot(dx, dy);
    if (d < bestD || (d === bestD && t.id < best.id)) { bestD = d; best = t; }
  }
  return best;
}

// La règle du placement : affectation déterministe + `auto = true` (appliquée
// PAR LA SIM, pas le joueur → ensureAssignments peut la réaffecter si le
// target devient inactif/périmé) + migrated (l'UI annonce l'affectation).
function assignTarget(sim, svc) {
  const t = nearestTerminal(sim, svc);
  svc.target = t ? t.id : null; // null = inactif (aucun terminal à servir)
  svc.auto = true;
  svc.migrated = true;
  return svc.target;
}

// Placement NOUVEAU (buildBuilding) : la règle s'applique au moment où le
// service est POSÉ. Pas d'annonce (migrated=false) : c'est la règle du
// placement, pas une migration. S'il n'y a pas de terminal, le service part
// INACTIF (target null, auto=true) : ensureAssignments le réaffectera dès
// qu'un terminal existera.
function autoAssign(sim, svc) {
  const t = assignTarget(sim, svc);
  svc.migrated = false;
  return t;
}

// Migration + réaffectation : chaque service AU SOL dont l'affectation est
// ABSENTE (sauvegarde pré-R27) ou PÉRIMÉE (auto + target pointant vers un
// terminal supprimé, ou target null alors qu'un terminal existe) reçoit la
// règle du placement (déterministe). Le choix EXPLICITE du joueur
// (auto=false, même target null = « inactif volontaire ») n'est JAMAIS
// écrasé. Idempotent. Retourne le nombre de services touchés (l'UI n'annonce
// QUE s'il y en a — migration lisible, pas de spam à chaque tick).
function ensureAssignments(sim) {
  if (!sim?.infra?.services?.length) return 0;
  let n = 0;
  for (const svc of sim.infra.services) {
    if (!serviceTypeKnown(svc.type)) continue; // type inconnu : pas de règle
    const known = sim.infra.terminals.some((t) => t.id === svc.target);
    if (svc.target === undefined) { assignTarget(sim, svc); n++; }
    else if (svc.auto && !known) { assignTarget(sim, svc); n++; }
  }
  return n;
}

// Commande du JOUEUR : ré-affecter `serviceId` au terminal `target`
// (null = inactif volontaire : le service reste construit, il sert AUCUN
// terminal — et l'affectation volontaire n'est JAMAIS écrasée, auto=false).
// Retourne true si l'affectation a CHANGÉ (l'UI peut l'annoncer) : la sim
// n'applique aucun effet — la mesure lit le champ (la capacité de chaque
// terminal suit la décision, c'est tout). Garde d'entrée : service inconnu
// ou terminal inexistant → false.
function setAssignment(sim, serviceId, target) {
  const svc = sim.infra.services.find((s) => s.id === serviceId);
  if (!svc || !serviceTypeKnown(svc.type)) return false;
  if (target != null && !sim.infra.terminals.some((t) => t.id === target)) return false;
  if (svc.target === target) return false;
  svc.target = target;
  svc.auto = false; // choix joueur : ensureAssignments ne le retouche plus
  svc.migrated = false;
  return true;
}

// MESURES par terminal (capacités lues, pas re-dérivées) — la sim les
// consomme, l'UI les affiche :
//   - servicesServingGate(sim, type, gate) : les services du type affectés
//     au terminal de la porte (nettoyage/hangar/carburant — la sim) ;
//   - countTypeServing(sim, type, terminalId) : le comptage brut (l'UI).
// Un service affecté à A ne renforce JAMAIS B (critère R27) — la mesure EST
// la règle.
function servicesServingGate(sim, type, gate) {
  const tid = gate.terminalId;
  // R30 : les `svc.target` et les clés `queues` peuvent être chaîne OU nombre
  // (clé d'objet = chaîne, champ d'infra = nombre) — on compare en String()
  // pour que la mesure marche quel que soit le type (pas de bonus silencieux).
  return sim.infra.services.filter((s) => s.type === type
    && serviceTypeKnown(s.type) && String(s.target) === String(tid));
}
function countTypeServing(sim, type, terminalId) {
  // R30 : `terminalId` peut être une CHAÎNE (Object.keys des queues /
  // securityDone) ou un NOMBRE (champ d'infra) — String() des deux côtés.
  return sim.infra.services.filter((s) => s.type === type
    && String(s.target) === String(terminalId)).length;
}

// La VUE pour l'UI (affectation + capacités par terminal). L'UI est FINE :
// elle lit, elle n'écrase pas — la commande est setAssignment (règle dans la
// sim, UI fine).
function assignmentView(sim) {
  const services = sim.infra.services
    .filter((s) => serviceTypeKnown(s.type))
    .map((s) => ({
      id: s.id, type: s.type, target: s.target ?? null,
      label: s.target == null ? 'inactif'
        : `terminal ${sim.infra.terminals.find((t) => t.id === s.target)?.id ?? '?'}`,
    }));
  const counts = {};
  for (const t of sim.infra.terminals) {
    counts[t.id] = {};
    for (const type of GROUND_SERVICE_TYPES) counts[t.id][type] = countTypeServing(sim, type, t.id);
  }
  return { services, counts };
}

__exports.serviceTypeKnown = serviceTypeKnown;
__exports.nearestTerminal = nearestTerminal;
__exports.autoAssign = autoAssign;
__exports.ensureAssignments = ensureAssignments;
__exports.setAssignment = setAssignment;
__exports.servicesServingGate = servicesServingGate;
__exports.countTypeServing = countTypeServing;
__exports.assignmentView = assignmentView;
})(__reg['m_src_infra_assignments']);

/* --- module src/pathfinding/path.mjs --- */
(function (__exports) {
// Pathfinding taxiway : graphe des segments (taxiways + pistes) + A* avec occupation.
// Logique pure. Le graphe est reconstruit à chaque changement d'infra (build/demolish)
// par infra.buildGrid → on le cache ici sur sim._graph.
//
// Modèle : chaque segment (taxiway, piste) donne 2 nœuds (extrémités de sa tranche
// courte) ; deux nœuds sont reliés si les deux segments se TOUCHENT (taxiway
// construit, marge JOINT_MARGIN). Un avion roule le long du chemin nœud par nœud ;
// une arête « occupée » = un autre avion dessus.
const { AIRCRAFT } = __ns('m_src_data_catalog');

// Tolérance de jonction (px) : deux segments ne se lient que s'ils se TOUCHENT
// physiquement (taxiway/piste construits, pas de « proximité » dans l'espace).
// ponytail : marge fixe 20 px = le seuil de jonction d'angle ; pas de grille spatiale.
const JOINT_MARGIN = 20;

// (re)construit le graphe ; appelé par infra.buildGrid.
function rebuildGraph(sim) {
  const segs = [...sim.infra.taxiways, ...sim.infra.runways];
  const nodes = [];
  const add = (seg) => {
    if (seg.type === 'runway') {
      // La piste se traverse verticalement (atterrissage/depart) : nœuds haut + bas du centre.
      const cx = seg.x + seg.w / 2;
      nodes.push({ x: cx, y: seg.y, seg: seg.id });
      nodes.push({ x: cx, y: seg.y + seg.h, seg: seg.id });
    } else if (seg.w >= seg.h) {
      // taxiway horizontal : bouts gauche/droite
      nodes.push({ x: seg.x, y: seg.y + seg.h / 2, seg: seg.id });
      nodes.push({ x: seg.x + seg.w, y: seg.y + seg.h / 2, seg: seg.id });
    } else {
      // taxiway vertical : bouts haut/bas
      nodes.push({ x: seg.x + seg.w / 2, y: seg.y, seg: seg.id });
      nodes.push({ x: seg.x + seg.w / 2, y: seg.y + seg.h, seg: seg.id });
    }
  };
  segs.forEach(add);
  const edges = new Map(); // nIdx → [{to, cost}]
  nodes.forEach((n, i) => edges.set(i, []));
  // 1) Intra-segment : on relie les 2 bouts d'UN segment (la longueur du segment).
  //    Sans ça, un avion ne pourrait jamais rouler d'un bout à l'autre d'un segment.
  const bySeg = new Map();
  nodes.forEach((n, i) => {
    if (!bySeg.has(n.seg)) bySeg.set(n.seg, []);
    bySeg.get(n.seg).push(i);
  });
  for (const idxs of bySeg.values()) {
    if (idxs.length !== 2) continue;
    const [a, b] = idxs;
    const cost = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    edges.get(a).push({ to: b, cost });
    edges.get(b).push({ to: a, cost });
  }
  // 2) Inter-segment : jonction UNIQUEMENT si les deux segments se TOUCHENT
  //    (rects qui s'overlapent ou se touchent à JOINT_MARGIN près) : un taxiway
  //    CONSTRUIT relie les segments, pas la « proximité » dans l'espace.
  //    Deux nœuds d'extrémités reliés entre eux ; le coupage d'un segment supprime
  //    ses 2 nœuds et ses arêtes → blocage réel, pas de chemin résiduel.
  const touch = (a, b) =>
    a.x - JOINT_MARGIN <= b.x + b.w && b.x - JOINT_MARGIN <= a.x + a.w &&
    a.y - JOINT_MARGIN <= b.y + b.h && b.y - JOINT_MARGIN <= a.y + a.h;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].seg === nodes[j].seg) continue;
      const si = segs.find((s) => s.id === nodes[i].seg);
      const sj = segs.find((s) => s.id === nodes[j].seg);
      if (!touch(si, sj)) continue;
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      edges.get(i).push({ to: j, cost: d });
      edges.get(j).push({ to: i, cost: d });
    }
  }
  // Nœuds portes : une porte se rattache au nœud du segment qu'elle JOIGNT
  // (le rect de la porte touche le rect du segment) — pas à « la cible la plus
  // proche » dans l'espace. Pas de segment touchant → porte HORS réseau (findPath
  // ne doit JAMAIS renvoyer un chemin vers elle : le joueur n'a pas construit de
  // taxiway, l'avion ne peut pas y rouler).
  const gateNode = new Map();
  for (const g of sim.infra.gates) {
    const touching = segs.filter((s) => touch(g, s));
    if (!touching.length) continue;
    let best = -1, bd = Infinity;
    nodes.forEach((n, i) => {
      if (!touching.some((s) => s.id === n.seg)) return; // nœud d'un segment qui touche la porte
      const gx = g.x + g.w / 2, gy = g.y + g.h / 2; // centre de la porte
      const d = Math.hypot(n.x - gx, n.y - gy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) gateNode.set(g.id, best);
  }
  sim._graph = { nodes, edges, gateNode };
  // R03 : le rebuild change les indices des nœuds — les chemins EN COURS
  // (ac.path) pointent dans l'ANCIEN graphe. On les recalcule tous depuis la
  // position ACTUELLE de chaque avion (nœud le plus proche), en gardant sa
  // destination (heading 'gate' → sa porte, sinon → la sortie de piste) :
  // jamais d'exception ni de téléportation. Pas de chemin possible → « blocked »
  // (retry borné + annulation A-5 à 10 min sim). Le segment où l'avion EST ne
  // compte PAS comme occupé pour LUI (il l'a réservé via ac.seg) : l'occupation
  // sert à ne pas ENTRER dans le segment d'UN AUTRE avion.
  const occupied = new Set();
  for (const a of sim.aircraft) if (a.seg != null) occupied.add(a.seg);
  // Segments qui EXISTENT encore dans le graphe neuf : un avion dont le segment
  // actuel vient d'être DÉMOLI (A7) est en dehors du réseau — on ne peut PAS le
  // re-ancrer (ce serait une téléportation sur un autre nœud) : on le bloque
  // sur place. Un avion dont le segment existe (scénarios R03 a/b/d) est
  // recollé au nœud le plus proche et son chemin recalculé.
  const liveSegs = new Set(nodes.map((n) => n.seg));
  for (const ac of sim.aircraft) {
    if (!ac.path) continue;
    // Phases au SOL (docking/gate/refuel/ops/pushback) : l'avion est amarré à la
    // porte (seg=null) — il n'UTILISE PAS de chemin (doRefuel/doPushback décident),
    // donc le re-ancrage ne le concerne PAS. R23 (t_c992b7d6) : avant la fix, un
    // avion EN PLEIN (phase refuel) gardait le chemin D'ARRIVÉE résiduel
    // (doTaxi ne le vide qu'à la mise en docking) → le rebuild le passait en
    // « blocked » SANS libérer sa lance → _refueling=true hors refuel (fuite
    // R08, G1). Les phases sol ne sont jamais re-ancrées.
    const GROUND = new Set(['docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback']);
    if (GROUND.has(ac.phase)) { ac.path = null; continue; } // chemin résiduel : inutile au sol
    // Segment actuel démolit → avion en dehors du réseau : blocage propre.
    if (ac.seg == null || !liveSegs.has(ac.seg)) {
      ac.path = null; ac.seg = null; ac.phase = 'blocked'; ac.timer = 0;
      continue;
    }
    const from = nearestNode(sim, ac.x, ac.y);
    const to = ac.heading === 'gate' ? gateNodeOf(sim, ac.gateId) : runwayExitNode(sim, ac.runwayId);
    const occ = new Set([...occupied].filter((s) => s !== ac.seg));
    const path = from == null || to == null ? null : findPath(sim, from, to, occ);
    // from === to (l'avion est DÉJÀ au nœud de destination) : chemin d'un nœud
    // → doTaxi aboutit immédiatement (docking/départ), ce n'est PAS un blocage.
    if (path == null || (path.length < 2 && from !== to)) {
      ac.path = null; ac.seg = null; ac.phase = 'blocked'; ac.timer = 0;
      continue;
    }
    ac.path = path; ac.pathPtr = 0;
    ac.seg = nodes[path[0]].seg;
    if (ac.seg != null) occupied.add(ac.seg);
  }
}

// Chemin entre deux nœuds, évitant les segments occupés (occupied = Set d'ids de segments).
// Retourne un tableau d'indices de nœuds, ou null si aucun chemin (critère « taxiway coupé »).
function findPath(sim, fromNode, toNode, occupied) {
  const { nodes, edges } = sim._graph;
  if (fromNode == null || toNode == null) return null;
  // A* heuristique euclidienne. ponytail : pile de listes, pas de binaire ; le graphe est minuscule.
  const open = [{ i: fromNode, g: 0, f: h(sim, fromNode, toNode) }];
  const gScore = new Map([[fromNode, 0]]);
  const came = new Map();
  const closed = new Set();
  const segsOf = (idx) => nodes[idx].seg;
  while (open.length) {
    // extraction du meilleur f (graphe petit : scan linéaire, pas de tas binaire)
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur.i === toNode) {
      const path = [toNode];
      while (came.has(path[0])) path.unshift(came.get(path[0]));
      return path;
    }
    if (closed.has(cur.i)) continue;
    closed.add(cur.i);
    for (const e of edges.get(cur.i)) {
      // arête occupée : le segment d'arrivée est pris par un autre avion
      if (occupied.has(segsOf(e.to))) continue;
      const ng = cur.g + e.cost;
      if (ng < (gScore.get(e.to) ?? Infinity)) {
        gScore.set(e.to, ng);
        came.set(e.to, cur.i);
        open.push({ i: e.to, g: ng, f: ng + h(sim, e.to, toNode) });
      }
    }
  }
  return null;
}

function h(sim, a, b) {
  const n = sim._graph.nodes;
  return Math.hypot(n[a].x - n[b].x, n[a].y - n[b].y); // heuristique euclidienne admissible
}

// Nœud de porte (ou undefined si la porte est hors réseau : aucun segment ne la touche).
function gateNodeOf(sim, gateId) {
  return sim._graph ? sim._graph.gateNode.get(gateId) : undefined;
}

// Nœud le plus proche d'une position monde (x, y) — R03 : sert de point de
// départ « recollé au réseau » quand un graphe est reconstruit pendant qu'un
// avion roule (sa position monde est la vérité, pas l'ancien chemin).
// ponytail : scan linéaire des nœuds (graphe minuscule, cf. A* ci-dessus).
function nearestNode(sim, x, y) {
  if (!sim._graph || !sim._graph.nodes.length) return null;
  let best = -1, bd = Infinity;
  sim._graph.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) { bd = d; best = i; }
  });
  return best >= 0 ? best : null;
}

// Nœud de départ d'un taxi : l'extrémité de piste du côté de l'aviation (bas de la piste).
function runwayExitNode(sim, runwayId) {
  const rw = sim.infra.runways.find((r) => r.id === runwayId);
  if (!rw || !sim._graph) return null;
  const { nodes } = sim._graph;
  // les 2 nœuds de cette piste : on prend celui du bas (y max) = sortie après atterrissage
  let best = -1, by = -Infinity;
  nodes.forEach((n, i) => {
    if (n.seg === runwayId && n.y > by) { by = n.y; best = i; }
  });
  return best >= 0 ? best : null;
}

__exports.rebuildGraph = rebuildGraph;
__exports.findPath = findPath;
__exports.gateNodeOf = gateNodeOf;
__exports.nearestNode = nearestNode;
__exports.runwayExitNode = runwayExitNode;
})(__reg['m_src_pathfinding_path']);

/* --- module src/ui/icons.mjs --- */
(function (__exports) {
// T4 (t_eb78478e) — CONSIGNES D'ICÔNES VECTORIELLES (zéro asset) : les glyphes
// des 11 types de construction + avion + info, dessinés sur N'IMPORTE QUEL
// contexte canvas 2D (boutons de la barre de construction, boutons-scénarios
// du menu). Module PUR, testable Node (un faux ctx enregistre les appels —
// tests/t4-icons.test.mjs). `iconCanvas()` est le SEUL point de contact DOM
// (fabrique un <canvas> ; jamais appelé sous Node — la factory est
// navigateur-only, comme le reste de la UI).
//
// Règle de dessin : chaque glyphe occupe la boîte [0,size]² avec ~12 % de
// marge ; 2 couleurs max (couleur principale + accent) — lisibilité au petit
// format (18-24 px), pas de détail superflu.
const { THEME } = __ns('m_src_ui_theme');

// Les 11 types de construction (catalog.mjs) + glyphes génériques.
const ICON_KINDS = Object.freeze([
  'runway', 'taxiway', 'terminal', 'gate', 'fueling', 'security',
  'catering', 'boarding', 'hotel', 'parking', 'cafe',
  'plane', 'info', 'gear',
]);

const PAD = 0.12; // marge relative (partie de la boîte laissée vide)

// Dessine le glyphe `kind` dans la boîte [0,size]². `color` (trait/remplissage
// principal) et `accent` (détail) : défauts = theme (texte / cyan). Un kind
// inconnu dessine un carré neutre (jamais d'exception — UI fine, zéro crash).
function drawIcon(ctx, kind, size, { color = THEME.text, accent = THEME.accent } = {}) {
  const s = size;
  const m = s * PAD; // marge
  const box = s - 2 * m; // côté de la zone utile
  ctx.save();
  ctx.translate(m, m);
  try {
    switch (kind) {
      case 'runway': { // bande horizontale + ligne de centre en pointillés
        ctx.fillStyle = color;
        ctx.fillRect(0, box * 0.3, box, box * 0.4);
        ctx.fillStyle = accent;
        const n = 5;
        for (let i = 0; i < n; i++) ctx.fillRect(box * (i + 0.35) / (n + 0.5), box * 0.46, box * 0.18, box * 0.08);
        break;
      }
      case 'taxiway': { // chemin en L (deux bandes parallèles simplifiées)
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(box * 0.15, box * 0.85);
        ctx.lineTo(box * 0.5, box * 0.85);
        ctx.quadraticCurveTo(box * 0.85, box * 0.85, box * 0.85, box * 0.5);
        ctx.lineTo(box * 0.85, box * 0.15);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(box * 0.15, box * 0.85, Math.max(1, box * 0.09), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'terminal': { // bâtiment : toit à deux pentes + porte
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, box * 0.45);
        ctx.lineTo(box * 0.5, box * 0.12);
        ctx.lineTo(box, box * 0.45);
        ctx.lineTo(box, box);
        ctx.lineTo(0, box);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.fillRect(box * 0.42, box * 0.62, box * 0.16, box * 0.38); // porte
        break;
      }
      case 'gate': { // poste d'attache : tarmac + silhouette avion
        ctx.fillStyle = color;
        ctx.fillRect(0, box * 0.68, box, box * 0.2); // tarmac
        planeBody(ctx, box * 0.5, box * 0.42, box * 0.52, accent);
        break;
      }
      case 'fueling': { // éclair dans un rond (station)
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.5, box * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(box * 0.56, box * 0.24);
        ctx.lineTo(box * 0.36, box * 0.54);
        ctx.lineTo(box * 0.5, box * 0.54);
        ctx.lineTo(box * 0.44, box * 0.76);
        ctx.lineTo(box * 0.64, box * 0.46);
        ctx.lineTo(box * 0.5, box * 0.46);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'security': { // bouclier + coche
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(box * 0.5, box * 0.1);
        ctx.lineTo(box * 0.88, box * 0.24);
        ctx.lineTo(box * 0.88, box * 0.52);
        ctx.quadraticCurveTo(box * 0.88, box * 0.8, box * 0.5, box * 0.92);
        ctx.quadraticCurveTo(box * 0.12, box * 0.8, box * 0.12, box * 0.52);
        ctx.lineTo(box * 0.12, box * 0.24);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, box * 0.09);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(box * 0.34, box * 0.5);
        ctx.lineTo(box * 0.46, box * 0.62);
        ctx.lineTo(box * 0.68, box * 0.38);
        ctx.stroke();
        break;
      }
      case 'catering': { // assiette + vapeur
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(box * 0.5, box * 0.66, box * 0.4, box * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(box * (0.5 + i * 0.18), box * 0.34, box * 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'boarding': { // porte + flèche d'accès
        ctx.fillStyle = color;
        ctx.fillRect(box * 0.5, 0, box * 0.5, box);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(0, box * 0.5);
        ctx.lineTo(box * 0.42, box * 0.5);
        ctx.lineTo(box * 0.3, box * 0.36);
        ctx.moveTo(box * 0.42, box * 0.5);
        ctx.lineTo(box * 0.3, box * 0.64);
        ctx.lineWidth = Math.max(1, box * 0.12);
        ctx.strokeStyle = accent;
        ctx.lineCap = 'round';
        ctx.stroke();
        break;
      }
      case 'hotel': { // bâtiment + 3 fenêtres éclairées
        ctx.fillStyle = color;
        ctx.fillRect(box * 0.16, box * 0.14, box * 0.68, box * 0.86);
        ctx.fillStyle = accent;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
          ctx.fillRect(box * (0.28 + c * 0.32), box * (0.28 + r * 0.32), box * 0.18, box * 0.18);
        }
        break;
      }
      case 'parking': { // P dans un carré
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.strokeRect(0, 0, box, box);
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, box * 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(box * 0.34, box * 0.82);
        ctx.lineTo(box * 0.34, box * 0.18);
        ctx.lineTo(box * 0.62, box * 0.18);
        ctx.quadraticCurveTo(box * 0.8, box * 0.3, box * 0.62, box * 0.48);
        ctx.lineTo(box * 0.34, box * 0.48);
        ctx.stroke();
        break;
      }
      case 'cafe': { // tasse + vapeur
        ctx.fillStyle = color;
        ctx.fillRect(box * 0.18, box * 0.42, box * 0.5, box * 0.42);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.beginPath();
        ctx.arc(box * 0.68, box * 0.6, box * 0.16, -Math.PI * 0.5, Math.PI * 0.5);
        ctx.stroke();
        ctx.fillStyle = accent;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(box * (0.34 + i * 0.22), box * 0.26, box * 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'plane': { // silhouette vue de dessus
        planeBody(ctx, box * 0.5, box * 0.5, box, color);
        break;
      }
      case 'info': { // rond + i
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.5, box * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.32, box * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(box * 0.44, box * 0.44, box * 0.12, box * 0.32);
        break;
      }
      case 'gear': { // engrenage (options) : cercle + 8 dents
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.12);
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.5, box * 0.26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        for (let i = 0; i < 8; i++) {
          ctx.save();
          ctx.translate(box * 0.5, box * 0.5);
          ctx.rotate((i * Math.PI) / 4);
          ctx.fillRect(box * 0.32, -box * 0.07, box * 0.16, box * 0.14);
          ctx.restore();
        }
        break;
      }
      default: { // inconnu : carré neutre (jamais d'exception)
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, box, box);
        break;
      }
    }
  } finally {
    ctx.restore();
  }
}

// Silhouette d'avion (vue de dessus) centrée en (cx, cy), envergure ~w :
// fuselage allongé + ailes en delta + queue. Réutilisée (gate/plane).
function planeBody(ctx, cx, cy, w, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  // fuselage
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.09, w * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  // ailes
  ctx.beginPath();
  ctx.moveTo(0, -w * 0.08);
  ctx.lineTo(-w * 0.34, w * 0.14);
  ctx.lineTo(0, w * 0.2);
  ctx.lineTo(w * 0.34, w * 0.14);
  ctx.closePath();
  ctx.fill();
  // queue
  ctx.beginPath();
  ctx.moveTo(0, w * 0.22);
  ctx.lineTo(-w * 0.13, w * 0.34);
  ctx.lineTo(w * 0.13, w * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Fabrique un <canvas> contenant le glyphe (boutons de la barre de
// construction, boutons-scénarios du menu). Navigateur-only : sous Node la
// factory de UI n'est jamais exécutée (guard explicite, zéro crash).
function iconCanvas(kind, size, { color, accent } = {}) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.className = 'icon';
  c.setAttribute('aria-hidden', 'true');
  drawIcon(c.getContext('2d'), kind, size, { color, accent });
  return c;
}

__exports.ICON_KINDS = ICON_KINDS;
__exports.drawIcon = drawIcon;
__exports.iconCanvas = iconCanvas;
})(__reg['m_src_ui_icons']);

/* --- module src/core/loop.mjs --- */
(function (__exports) {
// Boucle de jeu : requestAnimationFrame, dt clampé, horloge + rendu.
// S'exécute uniquement dans le navigateur (rAF) ; les tests Node n'importent jamais ce module.
const { advanceTime } = __ns('m_src_core_game-state');
const { tickFn } = __ns('m_src_core_sim');

function startLoop({ state, bus, renderer }) {
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // clamp : pas de spirale de la mort après une coupure d'onglet
    last = now;
    const played = advanceTime(state, dt); // horloge (pause → 0, x1/x2/x4 appliqué)
    // R14 : simTick est asynchrone — un tick qui lève (état corrompu, bug de
    // règle) doit REJETER la promesse, pas la planter en unhandledrejection :
    // on route l'erreur sur le bus ('sim-error'), l'UI l'annonce en toast
    // lisible et la boucle (horloge + rendu) continue — le jeu ne crashe pas.
    tickFn(state, played).catch((e) => bus.emit('sim-error', e));  // la sim avance au TEMPS DE JEU (sinon x4 = sim à vitesse x1)
    bus.emit('frame', dt);  // l'UI (caméra clavier) consomme le dt, elle ne décide pas
    renderer.render(state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

__exports.startLoop = startLoop;
})(__reg['m_src_core_loop']);

/* --- module src/ui/tips.mjs --- */
(function (__exports) {
// T4 (t_eb78478e) — ONBOARDING : 5 astuces NON-INTRUSIVES, affichées UNE
// seule fois chacune (persistance : state.tips.seen, sérialisé avec la
// sauvegarde → jamais de rediffusion après rechargement). LECTURE SEULE de la
// sim (les conditions n'apportent aucune règle — c'est de l'info joueur), le
// DOM est touché par le callback `toast` fourni par main.mjs (le module est
// pur et testable Node ; le toast existant R28/BL-01 est réutilisé tel quel).
//
// Astuce = une ligne courte (titre + texte), 9 s, coin bas-droite (zone des
// toasts — T51 : la zone est dédiée, aucun chevauchement avec le jeu).
const { weatherView } = __ns('m_src_sim_weather');

// Table EXPLICITE des astuces (id stable, texte lisible — pas de magie).
const TIPS = Object.freeze([
  {
    id: 'first-service',
    title: 'Première station',
    text: 'Vos stations (carburant, embarquement…) rapportent des frais par avion — suivez le flux dans le bilan financier (bouton Bilan).',
    // La baseline fournie n'a AUCUNE station → la 1re construite = le signal.
    when: (sim) => !!(sim.infra && sim.infra.services && sim.infra.services.length >= 1),
  },
  {
    id: 'first-flight',
    title: 'Premier vol',
    text: 'Un vol s’est posé : les offres de la planification s’acceptent en automatique (touche A). Le panneau Planning (haut-droite) affiche les vols à venir.',
    when: (sim) => !!(sim.economy && sim.economy.flightsLanded >= 1),
  },
  {
    id: 'treasury',
    title: 'Trésorerie',
    text: 'Fonds sous 4 000 $ : empruntez dans le Bilan financier (net 7 840 $ après intérêts). Solde négatif 60 s = faillite.',
    when: (sim, state) =>
      (state.lastAlert && state.lastAlert.kind === 'treasury-warn') ||
      (sim.economy && sim.economy.money < 4000),
  },
  {
    id: 'weather',
    title: 'Météo',
    text: 'La météo ralentit les arrivées (pluie) et les orages ferment une piste — l’état courant est affiché en haut à gauche (HUD).',
    // Le « clear » de départ ne compte pas : l'astuce part à la 1re météo
    // VRAIMENT différente (pluie/neige/orage, incident ou non).
    when: (sim) => weatherView(sim).state !== 'clear',
  },
  {
    id: 'objective',
    title: 'Objectif payé',
    text: 'Récompense encaissée : c’est elle qui finance l’extension. De nouveaux objectifs sont annoncés dans le menu (scénarios).',
    when: (sim) => !!(sim.events && Number(sim.events.seq || 0) >= 1),
  },
]);

// Normalisation défensive (pattern intro.mjs) : champ absent/corrompu →
// l'ASTUCES non vues = toutes, jamais de crash sur une sauvegarde étrange.
function ensureTips(state) {
  const t = state && state.tips;
  const known = new Set(TIPS.map((x) => x.id));
  const seen = t && Array.isArray(t.seen) ? t.seen : [];
  state.tips = { seen: seen.filter((id) => known.has(id)) };
  return state.tips;
}

// Machine des astuces : refresh() est appelé à chaque frame (pattern intro) —
// au plus 5 toasts dans la vie du module, puis plus rien (seen est persisté).
function makeTips(state, { toast } = {}) {
  const fired = new Set();
  return {
    refresh() {
      if (!state || !state.sim) return; // le menu n'a pas de sim
      ensureTips(state);
      for (const tip of TIPS) {
        if (state.tips.seen.includes(tip.id) || fired.has(tip.id)) continue;
        let ok = false;
        try { ok = tip.when(state.sim, state); } catch { ok = false; } // UI fine
        if (ok) {
          state.tips.seen.push(tip.id);
          fired.add(tip.id);
          if (toast) toast(`${tip.title} — ${tip.text}`, { kind: 'tip', title: tip.title, durationMs: 9000 });
        }
      }
    },
    // Lecture (tests/CDP) : les astuces déjà vues.
    seen: () => (state.tips ? [...state.tips.seen] : []),
  };
}

__exports.TIPS = TIPS;
__exports.ensureTips = ensureTips;
__exports.makeTips = makeTips;
})(__reg['m_src_ui_tips']);

/* --- module src/core/seasons.mjs --- */
(function (__exports) {
// T3 (t_76744b22) — SAISONS : 4 saisons (printemps/été/automne/hiver) avec
// habillage visuel (teinte du monde, zéro asset — pattern weatherTint) et
// PARAMÈTRES DE SPAWN (la cadence des offres du planificateur) — la couche
// s'ADDITIONNE sur la couche de paramètres de la difficulté (difficulty.mjs,
// spawnLayer) SANS MODIFIER LES RÈGLES EXISTANTES (pas de règle ajoutée au
// planificateur : un seul multiplicateur de cadence, lu par windowClose).
//
// La saison est DÉRIVÉE de l'horloge de jeu (clock.mjs) : UNE saison par
// JOUR-JEU (4 jours = 1 an-jeu) — pas de champ de saison stocké (rien à
// migrer, rien à corrompre : la dérivée se recalcule toujours). Jour 1 =
// PRINTEMPS = la saison RÉFÉRENTIELLE (facteurs ×1 : comportement de la
// première journée EXACTEMENT inchangé — les fixtures de départ sont
// préservées).
const { clockOf } = __ns('m_src_sim_clock');

// L'ordre des saisons SUIVANT LE JOUR : le jour 1 est le printemps
// (référentiel), l'été suit, l'automne, l'hiver — puis le cycle recommence.
const SEASON_IDS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);

// Libellés FR (HUD/panneaux — le jeu est en français).
const SEASON_FR = Object.freeze({
  spring: 'Printemps', summer: 'Été', autumn: 'Automne', winter: 'Hiver',
});

// TABLE DES SAISONS (couche PARAMÈTRES — les chiffres, pas la logique, R37) :
//   spawnFactor : multiplicateur de la cadence des OFFRES par fenêtre du
//                 planificateur (windowClose, flights.mjs) — < 1 = saison
//                 creuse (moins de vols proposés), > 1 = saison forte.
//                 Le printemps = 1,0 (référentiel : AUCUN changement de
//                 comportement la première journée).
//   dressing    : l'habillage visuel du monde (teinte — null = rien ; le
//                 renderer l'applique par-dessus la teinte météo, zéro asset).
//                 L'été chauffe (voile doré), l'hiver refroidit (voile bleu),
//                 l'automne teint les feuilles (voile ocre), le printemps est
//                 net (rien — pas de bruit).
const SEASONS = Object.freeze({
  spring: Object.freeze({
    fr: SEASON_FR.spring,
    spawnFactor: 1.0,
    dressing: Object.freeze({ tint: null, note: 'référentiel (cadence ×1)' }),
  }),
  summer: Object.freeze({
    fr: SEASON_FR.summer,
    spawnFactor: 1.3,
    dressing: Object.freeze({ tint: 'rgba(255, 190, 80, 0.06)', note: 'pic touristique (cadence +30 %)' }),
  }),
  autumn: Object.freeze({
    fr: SEASON_FR.autumn,
    spawnFactor: 0.9,
    dressing: Object.freeze({ tint: 'rgba(210, 130, 50, 0.07)', note: 'cadence −10 %' }),
  }),
  winter: Object.freeze({
    fr: SEASON_FR.winter,
    spawnFactor: 0.7,
    dressing: Object.freeze({ tint: 'rgba(170, 200, 240, 0.12)', note: 'saison creuse (cadence −30 %)' }),
  }),
});

// Normalisation (pattern normalizeDifficulty / normalizeSeason) : une saison
// inconnue/corrompue → le printemps (référentiel ×1 — pas de facteur inventé,
// pas de crash).
function normalizeSeason(id) {
  return SEASONS[id] ? id : 'spring';
}

// La saison COURANTE (lecture pure, gardée) : dérivée du JOUR de l'horloge
// (clockOf — l'état initial si le champ est absent/corrompu) : jour 1 =
// printemps, jour 2 = été, jour 3 = automne, jour 4 = hiver, jour 5 =
// printemps… (un an-jeu = 4 jours, l'été suit toujours le printemps).
function seasonOf(sim) {
  const day = clockOf(sim).day;
  return SEASON_IDS[(day - 1) % SEASON_IDS.length];
}

// Lecture UI (HUD/panneau) : la saison courante + sa table complète (la FR,
// le facteur de spawn, l'habillage). Aucune mutation.
function seasonView(sim) {
  const id = seasonOf(sim);
  const s = SEASONS[id];
  return { id, fr: s.fr, spawnFactor: s.spawnFactor, dressing: s.dressing };
}

// LES PARAMÈTRES DE SPAWN de la saison (la couche lue par spawnLayer,
// difficulty.mjs — le planificateur compose, les chiffres vivent ici) :
// le facteur de cadence + la saison (pour l'affichage « pic / creux »).
function seasonParams(sim) {
  const id = seasonOf(sim);
  return Object.freeze({ season: id, spawnFactor: SEASONS[id].spawnFactor });
}

// La teinte du monde de la saison (l'habillage — la « sélection » du
// renderer, lecture PURE testable sous Node) : null au printemps (pas de
// bruit), un voile par saison (été doré / automne ocre / hiver bleuté).
function seasonTint(sim) {
  const s = SEASONS[seasonOf(sim)];
  return s.dressing.tint;
}

__exports.SEASON_IDS = SEASON_IDS;
__exports.SEASON_FR = SEASON_FR;
__exports.SEASONS = SEASONS;
__exports.normalizeSeason = normalizeSeason;
__exports.seasonOf = seasonOf;
__exports.seasonView = seasonView;
__exports.seasonParams = seasonParams;
__exports.seasonTint = seasonTint;
})(__reg['m_src_core_seasons']);

/* --- module src/infra/upgrades.mjs --- */
(function (__exports) {
// R31 (t_7a512737) : 3 CHOIX D'AMÉLIORATION DE CAPACITÉ CIBLÉE par terminal —
// le module de RÈGLE UNIQUE : les MULTIPLICATEURS (capacités, temps de plein,
// débit équipes) vivent ICI, jamais ailleurs (un seul endroit, comme
// countTypeServing pour les services). Les CHIFFRES (coûts, % par niveau,
// max) sont dans catalog.mjs UPGRADES (équilibrage, pas de logique).
// T33 (t_88aee6d5) : 3 NOUVEAUX CHOIX (boarding / marketing / comfort) —
// mêmes principes : le niveau est la source (sim.upgrades, sérialisé), les
// multiplieurs purs vivent ICI, les chiffres dans UPGRADES (catalog.mjs).
//
// L'ÉTAT : sim.upgrades[terminalId] = { terminal: n, fueling: n, teams: n }
// (clés CHAÎNES — comme sim.passengers.queues, R30). Le niveau est la source
// (sérialisé : la reprise RESTITUE niveau ET coût déjà payé — on ne
// re-débite JAMAIS au chargement). Absent = niveau 0 (sauvegarde ancienne).
//
// Le « MAUVAIS ACHAT » reste compréhensible : bottleneckView (lecture seule,
// l'UI l'affiche AVANT achat) montre le goulot courant du terminal —
// les files (check-in/sécurité/attente par pax), l'usure porte, le plein.
// Acheter la capacité du BON goulot améliore sa mesure ; la mauvaise ne
// sert rien, et l'écran le dit.
const { UPGRADES } = __ns('m_src_data_catalog');
const { pushEvent } = __ns('m_src_core_sim-state');
const { countTypeServing } = __ns('m_src_infra_assignments');

// État des améliorations (tolère les sauvegardes anciennes — absent = 0).
// Crée l'entrée DU TERMINAL si absente (l'achat écrit sim.upgrades[tid][kind]).
function ensureUpgrades(sim) {
  sim.upgrades = sim.upgrades || {};
  return sim.upgrades;
}

// Le NIVEAU courant d'un type d'amélioration d'un terminal (absent = 0).
function upgradeLevel(sim, terminalId, kind) {
  const t = ensureUpgrades(sim)[String(terminalId)];
  return (t && t[kind]) || 0;
}

// --- MULTIPLICATEURS — les UNIQES lecteurs du niveau. La sim ne lit JAMAIS
// sim.upgrades directement : elle passe par ces 6 fonctions (un seul point
// d'effet, testable ; la même règle côté sim et… c'est tout).

// (1) Terminal : le multiplicateur de CAPACITÉ check-in/sécurité du terminal
// (1 + capMultPerLevel × niveau). Le cap courant = base × ce facteur
// (passengers.mjs checkinCap/securityCap).
function capMult(sim, terminalId) {
  const spec = UPGRADES.terminal;
  return 1 + spec.capMultPerLevel * upgradeLevel(sim, terminalId, 'terminal');
}

// (2) Avitaillement : le facteur TEMPS de PLEIN du terminal (0.75^niveau).
// Le PLEIN s'accélère ; la SATURATION (nombre de lances) ne change PAS —
// c'est le débit du goulot, pas la file.
function refuelTimeMult(sim, terminalId) {
  const spec = UPGRADES.fueling;
  return Math.pow(1 - spec.timeMultPerLevel, upgradeLevel(sim, terminalId, 'fueling'));
}

// (3) Équipes : le facteur DÉBIT de nettoyage/remise à zéro par équipe du
// terminal (2^niveau). L'usure s'accumule à un rythme constant ; le débit
// double par niveau → moins de délai (R29 : le débit est limité, la
// priorité est explicite — le facteur agit sur le DÉBIT, pas sur la règle).
function teamRateMult(sim, terminalId) {
  const spec = UPGRADES.teams;
  return Math.pow(1 + spec.rateMultPerLevel, upgradeLevel(sim, terminalId, 'teams'));
}

// T33 (t_88aee6d5) : 3 nouveaux multiplicateurs (mêmes principes R31 :
// multiplicateur PUR lu à chaque tick, niveau 0 = ×1 — comportement
// EXISTANT inchangé).
// (4) Boarding : le facteur TEMPS des 3 étapes d'opérations AU SOL du
// terminal (0.75^niveau) — appliqué à l'étape (GATE_OPS_S/3 × ce facteur,
// aircraft.mjs doOps) : la porte se libère plus vite (le goulot « plein »
// inclut l'occupation porte, l'amélioration est lisible dans la mesure).
function gateOpsMult(sim, terminalId) {
  const spec = UPGRADES.boarding;
  return Math.pow(1 - spec.timeMultPerLevel, upgradeLevel(sim, terminalId, 'boarding'));
}

// (5) Marketing : le facteur REVENUE de CE terminal (1 + 0,1 × niveau) —
// la recette BILLET (pleine ou sèche) est gagnée au décollage pour le
// terminal de la porte de départ (economy.mjs onGateDeparted). Le choix
// « revenu » (contrairement aux 4 précédents, il n'accélère RIEN — il
// augmente l'argent par pax ; utile quand du pax passe, y compris sec).
function marketingMult(sim, terminalId) {
  const spec = UPGRADES.marketing;
  return 1 + spec.revenueMultPerLevel * upgradeLevel(sim, terminalId, 'marketing');
}

// (6) Confort : le facteur GLOBAL de récupération de satisfaction
// (1 + 0,5 × niveau). Comme la FAMILLE CONFORT des bâtiments (catering/
// lounge — un bâtiment pose, l'effet sert tout l'aéroport), le niveau pris
// en compte est celui du MEILLEUR terminal équipé : les aménagements du
// terminal le plus soigné servent les files de tous les terminaux (pas
// per-terminal : une file au terminal B n'est pas servie par le confort du
// terminal A — c'est la famille confort, documentée dans le catalogue).
function comfortRecoverMult(sim) {
  let best = 0;
  for (const tid of Object.keys(ensureUpgrades(sim))) {
    best = Math.max(best, upgradeLevel(sim, tid, 'comfort'));
  }
  return 1 + UPGRADES.comfort.recoverMultPerLevel * best;
}

// --- ACHAT — commande métier (l'UI envoie l'intention, la règle décide).
// Coût FIXE (UPGRADES[kind].cost par niveau) ; refus lisible (niveau max,
// pas d'argent, terminal inconnu). L'effet est IMMÉDIAT (les multiplicateurs
// sont lus à chaque tick — pas d'état parallèle).
function buyUpgrade(sim, terminalId, kind) {
  const spec = UPGRADES[kind];
  if (!spec) return { ok: false, why: 'amélioration inconnue' };
  const term = sim.infra.terminals.find((t) => String(t.id) === String(terminalId));
  if (!term) return { ok: false, why: 'terminal inconnu' };
  const lvl = upgradeLevel(sim, term.id, kind);
  if (lvl >= spec.maxLevel) return { ok: false, why: `niveau maximal atteint (${spec.maxLevel})` };
  if (sim.economy.money < spec.cost) {
    pushEvent(sim, { kind: 'no-funds', cost: spec.cost, type: kind });
    return { ok: false, why: `pas assez d'argent (${spec.cost} $)` };
  }
  sim.economy.money -= spec.cost;
  sim.economy.spent.construction = (sim.economy.spent.construction ?? 0) + spec.cost; // BL-15 : compte dédié
  const up = ensureUpgrades(sim);
  (up[String(term.id)] = up[String(term.id)] || {})[kind] = lvl + 1;
  pushEvent(sim, { kind: 'upgraded', type: kind, terminalId: term.id, level: lvl + 1, cost: spec.cost, name: spec.name });
  return { ok: true, level: lvl + 1, cost: spec.cost };
}

// --- VUE LISIBLE (lecture seule) — l'UI affiche les 6 choix + le GOUTLE
// COURANT du terminal AVANT achat. « Mauvais achat compréhensible » :
// le goulot nommé est le motif (acheter la mauvaise amélioration ne sert
// rien — les 3 T33 suivent CHACUNE leur mesure, voir le mapping « useful »).
function upgradeView(sim, terminalId) {
  const term = sim.infra.terminals.find((t) => String(t.id) === String(terminalId));
  if (!term) return null;
  const q = sim.passengers?.queues?.[String(term.id)] || { checkin: 0, security: 0, board: 0 };
  // Goulot du terminal (mesures COURANTES — pas de projection) :
  //   files : les pax EN FILE (le terminal dévide au débit courant) ;
  //   usure  : la somme d'usure des portes (l'équipe la remet à zéro) ;
  //   plein  : le temps de plein courant (lances du terminal + facteur).
  const gates = sim.infra.gates.filter((g) => String(g.terminalId) === String(term.id));
  const wear = gates.reduce((s, g) => s + (g.cleaning ?? 0) + (g.maintenance ?? 0), 0);
  const fuelTeams = countTypeServing(sim, 'fuel', term.id);
  const cleanTeams = countTypeServing(sim, 'cleaning', term.id);
  const hangarTeams = countTypeServing(sim, 'hangar', term.id);
  // Le GOUTLE = la mesure la plus chargée : files (pax), usure (points),
  // plein (s). Les pax en file = le goulot « terminal » ; l'usure = « équipes » ;
  // le plein (aucune lance libre) = « avitaillement ».
  const inQueue = q.checkin + q.security + q.board;
  const bottleneck =
    inQueue >= wear && inQueue >= 0 ? (inQueue > 0 ? 'files' : (wear > 0 ? 'usure' : 'plein'))
    : (wear > 0 ? 'usure' : 'plein');
  // ponytail: heuristique simple (la plus chargée des 3 mesures) — le GOUTLE
  // est une indication lisible, pas une prédiction ; upgrade si la validation
  // du J4 montre que le joueur se trompe souvent de choix.
  const choices = Object.entries(UPGRADES).map(([kind, spec]) => {
    const lvl = upgradeLevel(sim, term.id, kind);
    return {
      kind, name: spec.name, cost: spec.cost, level: lvl, maxLevel: spec.maxLevel,
      effect: spec.effect, affordable: sim.economy.money >= spec.cost,
      // T33 (t_88aee6d5) : les 3 nouveaux choix ont CHACUN leur mesure
      // lisible (le « mauvais achat compréhensible » R31 s'étend sans
      // casser les 3 existants) :
      //   boarding  : la porte est OCCUPÉE (temps d'ops au sol) — même
      //               situation que l'avitaillement (goulot « plein », ou
      //               rien ne presse) : l'avion amarré se libère plus vite ;
      //   marketing : le choix REVENUE — utile dès que du pax passe (des
      //               pax en file = du trafic qui va gagner des billets),
      //               y compris sec (l'amélioration sert les 2 recettes) ;
      //   comfort   : le confort sert la SATISFACTION — utile quand elle
      //                n'est pas maximale (famille confort, global).
      useful: kind === 'terminal' && bottleneck === 'files'
        || kind === 'teams' && bottleneck === 'usure'
        || kind === 'fueling' && (bottleneck === 'plein' || inQueue === 0)
        || kind === 'boarding' && (bottleneck === 'plein' || inQueue === 0)
        || kind === 'marketing' && (inQueue > 0 || wear > 0)
        || kind === 'comfort' && (sim.passengers?.satisfaction ?? 100) < 100,
    };
  });
  return {
    terminalId: term.id,
    inQueue, wear,
    fuelTeams, cleanTeams, hangarTeams,
    // Le GOUTLE COURANT + le motif (l'UI l'affiche à côté du choix) :
    // « files » → le terminal est en attente de pax ; « usure » → les portes
    // s'usent ; « plein » → l'avitaillement est le goulot (ou rien ne presse).
    bottleneck,
    bottleneckWhy: {
      files: 'les passagers sont EN FILE (check-in/sécurité/attente) — la capacité du terminal est le goulot',
      usure: 'l\'usure des portes s\'accumule — les équipes de nettoyage/remise à zéro sont le goulot',
      plein: 'l\'avitaillement est le goulot (ou les files sont vides) — le temps de plein est le goulot',
    }[bottleneck],
    choices,
  };
}

__exports.ensureUpgrades = ensureUpgrades;
__exports.upgradeLevel = upgradeLevel;
__exports.capMult = capMult;
__exports.refuelTimeMult = refuelTimeMult;
__exports.teamRateMult = teamRateMult;
__exports.gateOpsMult = gateOpsMult;
__exports.marketingMult = marketingMult;
__exports.comfortRecoverMult = comfortRecoverMult;
__exports.buyUpgrade = buyUpgrade;
__exports.upgradeView = upgradeView;
})(__reg['m_src_infra_upgrades']);

/* --- module src/sim/passengers.mjs --- */
(function (__exports) {
// Passagers (agrégés) : les passagers voyagent en GROUPES liés à un vol et à
// un terminal (AC22) — pas de passagers individuels, et surtout PAS un simple
// total transporté (AC40) : un passager suit un PARCOURS à travers SON
// terminal :
//   débarquement → check-in (+bagages) → sécurité → attente → embarquement.
// R30 (t_1623523e) : les files, les CAPACITÉS et les FLUX sont PAR TERMINAL —
// sim.passengers.queues[terminalId] = {checkin, security, board}. Un terminal
// ne traite JAMAIS les passagers d'un autre : A saturé/B vide → les pax de B
// suivent leur parcours normalement (AUCUN débordement global, plus de
// capacité « nTerminal × »). Le comptage unique reste intact (countCarried,
// UNE fois à l'embarquement, AC40). Le retrait des passagers d'un vol ANNULE
// est EXPLICITE (removePassengers, appelé par le module avions) : les pax en
// cours du vol annulé sortent du terminal sans être comptés, sans clogger les
// files ni bloquer les groupes suivants.
// Chaque étape a une CAPACITÉ (places en parallèle) et un DÉBIT (pax/s) : les
// files sont l'état VISIBLE de ce parcours (occupation lisible, 0..1), et la
// SATURATION a un effet mesurable : la file grandit, la satisfaction baisse,
// l'embarquement se retarde (boardDelay), le dénouement (capacité libérée,
// plus d'arrivées) vide les files et la satisfaction REMONTE — un retard
// ancien ne condamne pas indéfiniment (AC22).
// Bagages (AC22) : service dédié — les salles bagages AFFECTÉES au terminal
// (R27 : s.target = terminalId) BOOSTENT le débit check-in DE CE TERMINAL :
// sans elles le check-in du terminal tourne au débit de base PAX.checkinRate
// (12 pax/s), avec N salles + N*baggageBoostPer. Un service affecté à A ne
// renforce JAMAIS B (critère R27/R30).
// Comptage D2 par terminal : `p.injectedTotal[t]` (pax cumulés injectés au
// check-in DE t) donne à chaque groupe son offset d'injection `base` ; le
// compteur MONOTONE `p.securityDone[t]` compte les pax qui ont franchi la
// sécurité DE t. Le groupe EST complet ⇔ securityDone[t] >= base + pax (tous
// les pax qui l'ont rejoint ont traversé). Per-terminal : un vol annulé dans
// t A ne retarde JAMAIS les pax de t B.
// Logique pure (testable Node) : mute sim.passengers (sérialisable seul).
// L'état de la sim (sim-state.mjs) reste la source ; l'UI ne lit que cet objet.
const { pushEvent } = __ns('m_src_core_sim-state');
const { countTypeServing } = __ns('m_src_infra_assignments');
const { capMult, comfortRecoverMult } = __ns('m_src_infra_upgrades');

// Équilibrage (ponytail : constantes fixes, calées sur les tests saturation —
// pas de table par type d'avion ; le débit des files ne dépend pas du vol).
// Capacités ~ un gros vol au repos (A320 ≈ 144 pax) : file vide au repos,
// file SATUREE en saturation (plusieurs vols superposés AU MÊME terminal).
const PAX = Object.freeze({
  checkinCapPerTerminal: 120, // check-in d'UN terminal : confortable pour un A320 seul
  securityCapPerTerminal: 120, // sécurité d'UN terminal : idem
  waitCapPerGate: 80,         // salle d'attente : 80 par porte DU terminal
  checkinRate: 12,          // pax/s : guéridon check-in (débit de BASE, sans service bagages)
  baggageBoostPer: 8,       // pax/s ADDITIONNEL par salle bagages AFFECTÉE au terminal (AC22/R27)
  securityRate: 16,         // pax/s : filière sécurité
  securityBoostPer: 4,      // T33 (t_88aee6d5) : pax/s ADDITIONNEL par salle sécurité AFFECTÉE au terminal (même pattern R27 que les bagages)
  boardRate: 10,           // pax/s : porte d'embarquement
  satLossPerWait10: 0.02,   // %/s : par 10 pax en file AU-DESSUS de la capacité (PAR TERMINAL)
  satLossPerSat: 0.15,      // %/s : par étape SATURÉE (file pleine, PAR TERMINAL)
  recoverRate: 0.5,        // %/s : la satisfaction REMONTE quand les files sont vides
  comfortCatering: 0.2,    // services de confort (soutien de la satisfaction)
  comfortMaintenance: 0.1, // — mêmes taux que l'ancienne logique économie
  comfortLounge: 0.3,      // T33 (t_88aee6d5) : salon VIP : confort (famille confort — soutien de la satisfaction, effet global comme la restauration)
});

// Démarre l'état passagers (les sauvegardes M1 n'ont pas ces champs — tolérées).
// R30 : `queues` (par terminal) remplace l'ancienne file GLOBALE `queue` ; un
// terminal ABSENT de `queues` = pas encore de pax injectés (file vide). Les
// compteurs de flux (injectedTotal / securityDone) sont PAR TERMINAL.
function ensurePassengers(sim) {
  let p = sim.passengers;
  if (!p) p = sim.passengers = {};
  p.totalCarried = p.totalCarried || 0;
  if (p.satisfaction === undefined) p.satisfaction = 100;
  p.queues = p.queues || {};
  p.groups = p.groups || [];
  p.injectedTotal = p.injectedTotal || {};
  p.securityDone = p.securityDone || {};
  return p;
}

// Le vol commence le déchargement (appelé par le module avions à l'entrée de la
// phase « disembark ») : le GROSSE du vol entre dans le check-in DE SON
// terminal. D2 (R30, per-terminal) : on enregistre `base` = position
// d'injection de ses pax dans le flux de SON terminal (pax injectés AVANT
// celui-ci, dans le MÊME terminal) : c'est ce qui permet de savoir, plus
// tard, quand TOUTES ses pax ont fini le parcours (groupComplete).
function arrivePassengers(sim, ac) {
  const p = ensurePassengers(sim);
  if (!ac.pax || ac.pax <= 0) return;
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  const tid = g ? g.terminalId : null;
  if (!tid) {
    // Terminal inconnu (avion injecté à la main, porte démolie en vol) : le
    // groupe est créé mais SANS injection de pax — il complète d'office
    // (groupComplete, groupe sans pax). Aucun pax n'est créé ni perdu.
    p.groups.push({ volId: ac.id, pax: ac.pax, terminalId: null, base: 0 });
    return;
  }
  const q = p.queues[tid] || (p.queues[tid] = { checkin: 0, security: 0, board: 0 });
  const base = p.injectedTotal[tid] || 0;
  p.injectedTotal[tid] = base + ac.pax;
  p.groups.push({
    volId: ac.id, pax: ac.pax, terminalId: tid,
    base, // D2 (R30) : offset d'injection DANS LE TERMINAL (pax injectés avant ce vol, ici)
  });
  q.checkin += ac.pax; // le débarquement déverse le groupe dans le check-in DU TERMINAL
}

// Le vol embarque ses passagers : le groupe est TRANSPORTÉ — compté UNE fois,
// retiré du parcours. D2 : appelé UNIQUEMENT quand le groupe du vol est COMPLET
// (tous ses pax ont franchi check-in + sécurité DE SON TERMINAL → en attente,
// voir groupComplete) : on ne compte JAMAIS « embarqué » avant la fin du
// parcours passager.
function countCarried(sim, ac) {
  const p = ensurePassengers(sim);
  p.totalCarried += ac.pax; // UNE SEULE fois, à l'embarquement (critère 7, AC40)
  p.groups = p.groups.filter((gr) => gr.volId !== ac.id);
}

// R30 : RETRAIT EXPLICITE des passagers d'un vol ANNULE (défini par la spec —
// plus de purge silencieuse) : le groupe du vol est retiré et SES pax EN COURS
// sortent des files DE SON TERMINAL (jamais comptés : pas de fausse
// comptabilité), sans clogger les files ni bloquer les groupes suivants.
// Appelé par le module avions à la FIN de l'embarquement non abouti (annulation
// — l'étape « cancelled », flights.mjs / aircraft.mjs). Les pax déjà en attente
// (board) sont conservés : le terminal les dévide (le vol annulé les a
// déposé — ils attendent, repartent au débit d'attente — AC22, règle
// EXISTANTE pour un avion qui ne vient plus).
// Invariants respectés : aucun pax créé ni perdu silencieusement (le retrait
// est EXPLICITE et testé), aucun double comptage (le pax annulé est retiré du
// groupe AVANT tout countCarried), les groupes SUIVANTS ne sont pas bloqués
// (leurs bases ne comptent plus les pax du vol annulé — voir la
// reconversion des bases ci-dessous).
function removePassengers(sim, ac) {
  const p = ensurePassengers(sim);
  const g = p.groups.find((gr) => gr.volId === ac.id);
  if (!g) return; // groupe déjà retiré (compté, annulé plus tôt) : idempotent
  p.groups = p.groups.filter((gr) => gr.volId !== ac.id);
  if (!g.terminalId || !g.pax) return;
  const t = g.terminalId;
  const q = p.queues[t];
  if (!q) return; // aucun pax injectés (groupe sans terminal / pax) : rien à retirer
  // Combien de pax du groupe ont déjà FRANCHI la sécurité (sont en attente,
  // board) : c'est `securityDone` (compteur monotone DU TERMINAL) moins le
  // nombre de pax injectés AVANT lui (base) qui ont franchi la sécurité. Le
  // groupe occupe le segment [base, base+pax) du flux ; les pax « passés » =
  // min(securityDone, base + pax) - base, borné à [0, pax].
  const secDone = p.securityDone[t] || 0;
  const passed = Math.max(0, Math.min(g.pax, Math.max(0, secDone - (g.base || 0))));
  // Les pax EN COURS (check-in + sécurité, PAS encore en attente) = pax -
  // passed : ils sortent du parcours (retrait explicite). Les pax en attente
  // (board) restent — le terminal les dévide.
  const inFlow = g.pax - passed;
  if (inFlow > 0) {
    // On retire `inFlow` pax des files check-in + sécurité DU TERMINAL. Les
    // files sont des POOLS (agrégées, indistinguables) : on retire du check-in
    // d'abord (le plus en amont), puis de la sécurité. Total retiré = inFlow
    // (jamais plus que le contenu, jamais un pax négatif).
    const fromCheckin = Math.min(q.checkin, inFlow);
    q.checkin -= fromCheckin;
    q.security = Math.max(0, q.security - (inFlow - fromCheckin));
  }
  // RECONVERSION des bases : les groupes SUIVANTS (injectés APRÈS celui-ci,
  // base >= g.base) avaient un offset qui comptait les pax du vol annulé. On
  // décale leurs bases de `inFlow` (les pax retirés du flux) — sinon leur
  // groupComplete (securityDone >= base + pax) ne se réaliserait PLUS
  // (securityDone ne compte plus les pax retirés) → les groupes suivants
  // seraient BLOQUÉS (critère R30 : annulation ne bloque pas les groupes
  // suivants). Les pax en attente (passed) restent dans le flux (securityDone
  // les compte, les files board les tiennent) → les bases des groupes
  // suivants ne comptent QUE les pax RETIRÉS.
  if (inFlow > 0) {
    for (const gr of p.groups) {
      if (gr.terminalId === t && gr.volId !== ac.id && (gr.base || 0) >= g.base) {
        gr.base = Math.max(0, (gr.base || 0) - inFlow);
      }
    }
  }
}

// Le groupe du vol est-il COMPLET : toutes ses pax ont-elles atteint l'attente
// DE SON TERMINAL ? (comptage D2, R30 per-terminal — on ne compte « embarqué »
// qu'une fois le parcours terminé.) Principe : le compteur MONOTONE
// `p.securityDone[t]` compte les pax qui ont franchi la sécurité DU TERMINAL t
// (cumul des débits security→board, incrémenté par tickPassengers). Chaque
// groupe enregistre `base` = le nombre de pax qui l'ont PRÉCÉDÉ dans le
// check-in DE SON TERMINAL (ordre d'injection, per-terminal). Le groupe EST
// complet ⇔ `securityDone[t] >= base + pax` : tous les pax qui l'ont rejoint
// (les siens, injectés après lui, et les siens, dans le MÊME terminal) ont
// donc traversé la sécurité. Monotone et sans état par groupe → pas de
// deadlock, pas de double crédit, tolère les pax orphelins (vol annulé) qui
// ont traversé la sécurité sans groupe.
// Garde : si le groupe n'existe plus (avion injecté à la main, groupe déjà
// purgé/compté/retrait) on ne bloque PAS — on considère le parcours terminé.
function groupComplete(sim, ac) {
  const p = ensurePassengers(sim);
  const g = p.groups.find((gr) => gr.volId === ac.id);
  if (!g) return true; // aucun groupe pour ce vol : non bloquant
  if (!g.pax) return true; // groupe sans pax (vol annulé / terminal inconnu)
  if (!g.terminalId) return true; // pas de terminal : non bloquant
  const base = g.base || 0;
  const secDone = p.securityDone[g.terminalId] || 0;
  // Les pax du groupe occupent le segment [base, base+pax) du flux d'injection
  // DE SON TERMINAL. Tous les pax injectés AVANT lui (base) l'ont suivi dans
  // la sécurité ; il est complet quand le flux a dépassé la fin de son
  // segment : base + pax.
  // ponytail: epsilon 1e-9 — securityDone est une SOMME de valeurs
  // flottantes (pass = min(q, cap, rate*dt), des fractions), jamais exactement
  // un entier : 15 pax s'arrête à 14.999999999999996 et bloquerait
  // l'embarquement pour un epsilon. 1e-9 négligeable face à des pax entiers ;
  // upgrade si les pax deviennent fractionnaires (files par vol).
  return secDone >= base + g.pax - 1e-9;
}

// Délai d'embarquement (AC22 : l'attente INFLUE SUR LE VOL) : si la file
// d'embarquement DU TERMINAL du vol dépasse SA capacité, le groupe attend sa
// part de l'excédent. Le débit est partagé entre TOUS les vols en train
// d'embarquer À CE TERMINAL (portes du même terminal) → retard plus fort
// quand plusieurs vols sont au sol AU MÊME terminal (R30 : plus de débordement
// global — les files d'un autre terminal n'influent PAS).
// Retourne des secondes (0 au repos). L'avion applique ce délai à son étape.
function boardDelay(sim, ac) {
  const p = ensurePassengers(sim);
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  const tid = g ? g.terminalId : null;
  if (!tid) return 0; // pas de terminal : pas de file, pas de délai
  const q = p.queues[tid];
  if (!q) return 0; // terminal sans pax : file vide
  const cap = waitCapFor(sim, tid);
  const over = Math.max(0, q.board - cap);
  if (!over) return 0;
  const share = over * (ac.pax / Math.max(1, q.board)); // sa part de l'excédent
  const drainers = Math.max(1, sim.aircraft.filter((a) => {
    if (a.phase !== 'board') return false;
    const gg = sim.infra.gates.find((x) => x.id === a.gateId);
    return gg && gg.terminalId === tid; // R30 : SEULEMENT les vols au même terminal
  }).length);
  return share / (PAX.boardRate * drainers);
}

// Capacités d'une étape D'UN TERMINAL (R30 : per-terminal — dépendent de
// l'INFRA construite : le terminal et SES portes). Un terminal ne traite JAMAIS
// les pax d'un autre : la capacité est CELLE DU TERMINAL, jamais « × nombre de
// terminaux ».
// R31 : les CAPACITÉS de base (PAX.*PerTerminal) sont MULTIPLIÉES par le
// facteur d'amélioration « terminal » (capMult, upgrades.mjs) — le niveau 0
// renvoie 1 (l'état existant, les tests saturation inchangés).
function checkinCap(sim, tid) { return Math.round(PAX.checkinCapPerTerminal * capMult(sim, tid)); }
function securityCap(sim, tid) { return Math.round(PAX.securityCapPerTerminal * capMult(sim, tid)); }
function waitCapFor(sim, tid) {
  // R30 : les clés de `queues`/`securityDone` sont des CHAÎNES (clé d'objet),
  // mais `g.terminalId` est un NOMBRE — on compare en String() pour que la
  // capacité marche quel que soit le type du tid passé (tick Object.keys =
  // chaîne, UI = nombre).
  const gates = sim.infra.gates.filter((g) => String(g.terminalId) === String(tid));
  return Math.max(1, gates.length * PAX.waitCapPerGate);
}
// (Compat : le cap GLOBAL d'attente — somme sur TOUS les terminaux. Gardé pour
// l'UI globale (passengerSummary) ; les règles (boardDelay) sont per-terminal.)
function waitCap(sim) {
  const tids = new Set(sim.infra.terminals.map((t) => t.id));
  let gates = 0;
  for (const g of sim.infra.gates) if (tids.has(g.terminalId)) gates++;
  return Math.max(1, gates * PAX.waitCapPerGate);
}

// Occupation visible d'une étape D'UN TERMINAL (0..1, lisible par l'UI/HUD) :
// file / capacité. R30 : `tid` = terminal (la file ET la capacité sont celles
// DU TERMINAL — un terminal saturé n'affecte jamais l'occupation d'un autre).
function queueOccupancy(sim, tid, stage) {
  const p = ensurePassengers(sim);
  const q = p.queues[tid] || { checkin: 0, security: 0, board: 0 };
  const cap = stage === 'checkin' ? checkinCap(sim, tid)
    : stage === 'security' ? securityCap(sim, tid)
    : waitCapFor(sim, tid);
  return Math.min(1, q[stage] / cap);
}

// Le battement passagers (appelé par tick.mjs) — R30 : PAR TERMINAL.
//   1) les groupes du vol débarqué entrent dans la file check-in DE LEUR TERMINAL
//   2) les files DE CHAQUE TERMINAL avancent au débit de leur étape (débit
//      BAGAGES affecté au terminal, R27 — pas de service global)
//   3) satisfaction : pénalité sur les files SATURÉES (PAR TERMINAL),
//      RÉCUPÉRATION quand les files sont vides (+ services confort).
// Les groupes (gr.volId) servent au COMPTAGE unique + au retrait EXPLICITE des
// vols annulés (removePassengers) ; l'avancement physique des pax est porté
// par les FILES (q.* par terminal).
function tickPassengers(sim, dt) {
  const p = ensurePassengers(sim);

  // Groupes orphelins (vol parti/annulé, plus dans sim.aircraft) : le GROUPE
  // est épurgé ; ses pax (encore en files) CONTINUENT leur parcours et se
  // vident (pas de perte : ils finissent le check-in/sécurité/attente, AC22).
  // (Le retrait EXPLICITE d'un vol ANNULE est removePassengers, appelé par le
  // module avions — ici on ne fait que la purge du groupe dont le vol est
  // disparu sans passer par l'annulation explicite.)
  p.groups = p.groups.filter((gr) => sim.aircraft.some((a) => a.id === gr.volId));

  // (1) Entrées : le débarquement d'un vol déverse ses pax dans le check-in DE
  // SON TERMINAL — déjà fait par arrivePassengers (injection au débarquement).
  // (R30 : arrivePassengers fait l'injection ; tick ne double JAMAIS.)

  // (2) Avancement : CHAQUE TERMINAL avance SES files au débit de son étape —
  // UN TERMINAL ne traite JAMAIS les pax d'un autre (R30). Le débit check-in
  // est celui DU TERMINAL (service bagages AFFECTÉ au terminal, R27).
  const tids = Object.keys(p.queues);
  for (const tid of tids) {
    const q = p.queues[tid];
    const caps = { checkin: checkinCap(sim, tid), security: securityCap(sim, tid), board: waitCapFor(sim, tid) };
    // R27/R30 : le service BAGAGES affecté à CE terminal (s.target === tid)
    // booste le débit check-in DE CE terminal. Un service affecté à A ne
    // renforce JAMAIS B (critère R27/R30 — plus de service global).
    const baggageCount = countTypeServing(sim, 'baggage', tid);
    const checkinRate = PAX.checkinRate + baggageCount * PAX.baggageBoostPer;
    // T33 (t_88aee6d5) : même pattern R27 que les bagages — les salles de
    // sécurité AFFECTÉES à CE terminal boostent le débit sécurité DE CE
    // terminal. Un service affecté à A ne renforce JAMAIS B.
    const securityCount = countTypeServing(sim, 'security', tid);
    const rates = {
      checkin: checkinRate,
      security: PAX.securityRate + securityCount * PAX.securityBoostPer,
      board: PAX.boardRate,
    };
    for (const [stage, to] of [['checkin', 'security'], ['security', 'board']]) {
      const pass = Math.min(q[stage], caps[stage], rates[stage] * dt);
      q[stage] -= pass; q[to] += pass;
      if (to === 'board') p.securityDone[tid] = (p.securityDone[tid] || 0) + pass; // D2 (R30) : compteur monotone sécurité→attente PAR TERMINAL
    }
    // (2c) La salle d'attente DU TERMINAL se vide au débit d'embarquement —
    // TOUJOURS (les pax attendent un avion : s'il arrive, ils montent ; s'il
    // ne vient pas (vol annulé), ils repartent). Sans ça, un vol annulé
    // cloggerait les files DU TERMINAL et la satisfaction ne remonterait
    // jamais (AC22 : évolutive).
    q.board = Math.max(0, q.board - PAX.boardRate * dt);
    // Nettoyage : un terminal dont les files sont toutes vides (pas de pax en
    // cours) peut perdre sa key (pas d'état fantôme) — optionnel (sérialisable).
  }

  // (3) Satisfaction : évolutive (AC22) — pénalité liée aux files ACTUELLES
  // (PAR TERMINAL), récupération quand les files sont vides. Un retard ancien
  // (files vides) ne retient PLUS la satisfaction : elle remonte (recoverRate +
  // confort). R30 : la saturation d'UN terminal pénalise la satisfaction
  // GLOBALE (l'aéroport) — la satisfaction reste un indicateur global de
  // l'aéroport, mais la PENALITÉ est calculée sur les files DE CHAQUE
  // TERMINAL (un terminal vide n'est jamais pénalisé par un autre saturé).
  // R34 : satisfaction/réputation reliées aux RÉSULTATS OBSERVÉS — la perte
  // directe de pic (incidents.mjs) est SUPPRIMÉE : un pic qui sature les
  // files se paie ICI (et seulement ici) ; un pic absorbé (files vides) ne
  // se compense plus artificiellement avec la récupération constante.
  const { loss } = satisfactionCauses(sim);
  if (loss > 0) p.satisfaction = Math.max(0, p.satisfaction - loss * dt);
  else {
    let gain = PAX.recoverRate;
    if (sim.infra.services.some((s) => s.type === 'catering')) gain += PAX.comfortCatering;
    if (sim.infra.services.some((s) => s.type === 'maintenance')) gain += PAX.comfortMaintenance;
    // T33 (t_88aee6d5) : le salon VIP (famille confort, même que la
    // restauration — un bâtiment POSÉ, l'effet GLOBAL sert toute la
    // satisfaction de l'aéroport, pas un terminal).
    if (sim.infra.services.some((s) => s.type === 'lounge')) gain += PAX.comfortLounge;
    // T33 : l'amélioration « confort » (upgrades.mjs comfortRecoverMult — le
    // MEILLEUR terminal équipé, effet global comme la famille confort)
    // MULTIPLIE la récupération — niveau 0 = ×1 (comportement EXISTANT).
    p.satisfaction = Math.min(100, p.satisfaction + gain * comfortRecoverMult(sim) * dt);
  }
}

// R34 (t_48232e68) : explication des CAUSES de la satisfaction — LECTURE pure
// (pattern incidentResponse) : le panneau affiche ce qui PÈSE (files
// saturées + débordement au-delà de la capacité, PAR TERMINAL) ou ce qui
// REMONTE (files vides → récupération + confort). MÊME calcul que le tick —
// UNE règle (jamais deux modules qui se contredisent, R34) : le tick LIT
// cette fonction, il ne recopie pas la formule.
function satisfactionCauses(sim) {
  const p = ensurePassengers(sim); // init paresseuse (sauvegarde M1 / sim nue)
  let loss = 0, satStages = 0, overflow = 0;
  for (const tid of Object.keys(p.queues)) {
    const q = p.queues[tid];
    const caps = { checkin: checkinCap(sim, tid), security: securityCap(sim, tid), board: waitCapFor(sim, tid) };
    loss += PAX.satLossPerSat *
      (['checkin', 'security', 'board'].filter((s) => q[s] >= caps[s]).length);
    satStages += ['checkin', 'security', 'board'].filter((s) => q[s] >= caps[s]).length;
    for (const s of ['checkin', 'security', 'board']) {
      const over = Math.max(0, q[s] - caps[s]); // au-delà de la capacité (DU TERMINAL)
      loss += (over / 10) * PAX.satLossPerWait10;
      overflow += over;
    }
  }
  return { loss, satStages, overflow };
}

// Totaux DISPLAY (HUD/panneau) : les pax en cours SOMMÉS sur TOUS les
// terminaux (agrégat de lecture, PAS une règle — aucune règle de sim ne lit
// ces totaux ; les files RÉELLES sont sim.passengers.queues[terminalId]).
// R30 : l'ancien compteur GLOBAL `queue` (qui laissait un terminal traiter les
// pax d'un autre) est supprimé — ici on ne fait qu'ADDITIONNER les files par
// terminal pour l'affichage (un total de pax en attente est un fait mesurable,
// pas une règle de traitement).
function queueTotals(sim) {
  const p = ensurePassengers(sim);
  let checkin = 0, security = 0, board = 0;
  for (const q of Object.values(p.queues || {})) {
    checkin += q.checkin; security += q.security; board += q.board;
  }
  return { checkin, security, board };
}

// Résumé lisible pour l'UI/HUD (AC22 : les files sont « visibles ») :
// occupation 0..1 + file totale (pax en cours) PAR TERMINAL. R30 : `byTerminal`
// (files/capacité/occupation de CHAQUE terminal) + les totaux globaux (sum)
// pour l'HUD. L'UI ne lit que cet objet.
function passengerSummary(sim) {
  const p = ensurePassengers(sim);
  const tids = Object.keys(p.queues);
  const byTerminal = {};
  let inFlow = 0, inCheckin = 0, inSecurity = 0, inBoard = 0;
  for (const tid of tids) {
    const q = p.queues[tid];
    const caps = { checkin: checkinCap(sim, tid), security: securityCap(sim, tid), board: waitCapFor(sim, tid) };
    const occ = (s) => Math.min(1, q[s] / caps[s]);
    byTerminal[tid] = {
      checkin: { n: q.checkin, cap: caps.checkin, occ: occ('checkin') },
      security: { n: q.security, cap: caps.security, occ: occ('security') },
      board: { n: q.board, cap: caps.board, occ: occ('board') },
    };
    inFlow += q.checkin + q.security + q.board;
    inCheckin += q.checkin; inSecurity += q.security; inBoard += q.board;
  }
  return {
    totalCarried: p.totalCarried,
    satisfaction: p.satisfaction,
    inFlow,
    byTerminal,
    // Compat globale (HUD) : les files GLOBALES (somme des terminaux) — l'UI
    // globale peut les afficher sans connaître les terminaux.
    // R31 : les caps GLOBALES somment les caps PAR TERMINAL (améliorations
    // incluses — capMult, upgrades.mjs) ; l'affichage reste cohérent.
    queue: {
      checkin: { n: inCheckin, cap: sim.infra.terminals.reduce((s, t) => s + Math.round(PAX.checkinCapPerTerminal * capMult(sim, t.id)), 0), occ: 0 },
      security: { n: inSecurity, cap: sim.infra.terminals.reduce((s, t) => s + Math.round(PAX.securityCapPerTerminal * capMult(sim, t.id)), 0), occ: 0 },
      board: { n: inBoard, cap: waitCap(sim), occ: 0 },
    },
  };
}

__exports.ensurePassengers = ensurePassengers;
__exports.arrivePassengers = arrivePassengers;
__exports.countCarried = countCarried;
__exports.removePassengers = removePassengers;
__exports.groupComplete = groupComplete;
__exports.boardDelay = boardDelay;
__exports.waitCapFor = waitCapFor;
__exports.queueOccupancy = queueOccupancy;
__exports.tickPassengers = tickPassengers;
__exports.satisfactionCauses = satisfactionCauses;
__exports.queueTotals = queueTotals;
__exports.passengerSummary = passengerSummary;
})(__reg['m_src_sim_passengers']);

/* --- module src/ui/renderer.mjs --- */
(function (__exports) {
// Rendu canvas 2D : LIT l'état, ne calcule rien de jeu (règle UI fine).
// Sprites vectoriels simples — ponytail : à remplacer par de vrais assets une fois la boucle jouable.
const { queueTotals } = __ns('m_src_sim_passengers');
const { getPalette } = __ns('m_src_ui_palette');
const { THEME } = __ns('m_src_ui_theme');
const { drawIcon, iconCanvas } = __ns('m_src_ui_icons');
const { weatherView } = __ns('m_src_sim_weather');
const { clockView, phaseTint } = __ns('m_src_sim_clock');
const { seasonTint, seasonView } = __ns('m_src_core_seasons');
// R39 : piste fermée — LECTURE SEULE de l'état d'incident (règle dans la sim,
// incidents.mjs) : la piste est fermée tant que l'incident attaché a un
// remaining > 0. On ne PASSE PAS par runwayClosed() : elle appelle
// ensureIncidents() qui L'INITIALISE sim.incidents (mutation — le renderer est
// en lecture seule, il ne doit pas muter la sim). La lecture directe est le
// même état, sans effet de bord.
function runwayClosedRO(sim, runwayId) {
  const i = sim.incidents;
  if (!i || !i.runways) return false;
  const rec = i.runways[runwayId];
  return !!(rec && rec.remaining > 0);
}
// T3 MÉTÉO (t_9b665a8b) : la teinte du monde PAR ÉTAT (zéro asset, un
// rempli) : pluie = bleuté, neige = voile blanc, orage OU incident météo
// actif = nuage sombre. « clair »/« nuageux » : null (pas de bruit).
// Lecture SEULE (weatherView — pas d'ensure : le renderer ne mute jamais la sim).
function weatherTint(sim) {
  if (!sim) return null;
  const wv = weatherView(sim);
  if (wv.incident || wv.state === 'storm') return 'rgba(30, 40, 70, 0.16)';
  if (wv.state === 'rain') return 'rgba(70, 90, 140, 0.10)';
  if (wv.state === 'snow') return 'rgba(220, 230, 245, 0.14)';
  return null;
}
// T3 (t_76744b22) : la teinte du monde par PHASE JOUR/NUIT (zéro asset, un
// rempli — même pattern que weatherTint) : nuit = bleuté profond,
// aube/crépuscule = voiles légers, « jour » = null (pas de bruit). Lecture
// SEULE (clockView + phaseTint — pas d'ensure : le renderer ne mute jamais la
// sim ; l'horloge absente/corrompue → jour 1 08:00 = phase « jour » = null).
function dayTint(sim) {
  if (!sim) return null;
  return phaseTint(clockView(sim).phase);
}
// T3 (t_76744b22) : l'habillage de SAISON (teinte du monde, zéro asset) :
// été = voile doré, automne = voile ocre, hiver = voile bleuté, printemps =
// null (pas de bruit — la référence). S'APPLIQUE PAR-DESSUS la teinte météo
// (les deux se composent, lecture seule seasonTint).
function seasonWorldTint(sim) {
  if (!sim) return null;
  return seasonTint(sim);
}
function makeRenderer(canvas, { overlays = [], onMenuCommands = null, selectionOf = null, paletteOf = null, juice = null } = {}) {
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const viewSize = () => ({ width: canvas.width, height: canvas.height });

  function screenToCanvas(sx, sy, cam) {
    return [
      (sx - (cam.x - viewSize().width / 2 / cam.zoom)) * cam.zoom,
      (sy - (cam.y - viewSize().height / 2 / cam.zoom)) * cam.zoom,
    ];
  }

  // Fond de terrain minimal : quadrillage + limites du terrain.
  // R43 : les couleurs viennent de la palette (standard/daltonienne) — les
  // shapes sont identiques, seul le rempli change (le rendu ne casse pas).
  function drawTerrain(state, cam, pal) {
    const { w, h } = state.terrain;
    const [x0, y0] = screenToCanvas(0, 0, cam);
    const [x1, y1] = screenToCanvas(w, h, cam);
    ctx.fillStyle = pal.terrain; // herbe (standard) / fond neutre (daltonien)
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = pal.gridLine;
    const step = 100 * cam.zoom; // quadrillage 100 px monde
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= w; gx += 100) {
      const [cx] = screenToCanvas(gx, 0, cam);
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += 100) {
      const [, cy] = screenToCanvas(0, gy, cam);
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
    }
    ctx.strokeStyle = pal.terrainBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // Bâtiments posés (lecture seule de state.sim.infra). Couleurs par type :
  // R43 — les cartes viennent de la palette (pal.buildings) ; les ÉTIQUETTES
  // (kind peintes au zoom près) sont inchangées : la lisibilité ne repose pas
  // sur la couleur (R39), le mode daltonien ne casse donc rien.
  function drawInfra(state, cam, pal) {
    const sim = state.sim;
    if (!sim || !sim.infra) return;
    const all = [
      ...sim.infra.runways, ...sim.infra.taxiways,
      ...sim.infra.terminals, ...sim.infra.services,
    ];
    for (const b of all) {
      const kind = b.type || b.kind; // la sim pose `type` ; les sauvegardes M1 `kind`
      const [x, y] = screenToCanvas(b.x, b.y, cam);
      const w = b.w * cam.zoom, h = b.h * cam.zoom;
      ctx.fillStyle = pal.buildings[kind] || '#90a4ae';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      // Étiquette lisible au zoom près.
      if (cam.zoom >= 0.6) {
        ctx.fillStyle = '#fff';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(kind, x + 4, y + 3);
      }
      // R39 : les BLOCAGES sont lisibles autrement que par la couleur —
      // symbole + texte (X sur piste fermée, « PANNE » sur station HS), la
      // règle reste dans la sim (runwayClosed / svc.fuelOut, lecture seule).
      if (kind === 'runway' && runwayClosedRO(sim, b.id)) {
        ctx.strokeStyle = pal.alert; // X lisible en daltonien (symbole + FERMÉE, R39)
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.4, y + h * 0.4); ctx.lineTo(x + w * 0.6, y + h * 0.6);
        ctx.moveTo(x + w * 0.6, y + h * 0.4); ctx.lineTo(x + w * 0.4, y + h * 0.6);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('FERMÉE', x + w / 2, y + 6);
      }
      if (kind === 'fuel' && b.fuelOut) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('PANNE', x + w / 2, y + h / 2);
      }
    }
    // Portes (gates) : libres / réservées / occupées — TROIS états distincts,
    // lisibles SANS couleur (libre = plein, réservée = hachures + « R »,
    // occupée = plein + « O » ; la couleur aide, l'indicateur ne repose pas
    // sur elle — critère R39). L'état vient de la sim : g.acId (réservation,
    // aircraft.mjs A5) + la position réelle de l'avion (occupée = à quai).
    if (sim.infra.gates && sim.infra.gates.length) {
      // R43 : couleurs de portes de la palette (S/M/L distincts en luminance
      // ; les lettres ·/R/O déjà peintes garantissent la lecture sans couleur).
      const GATE_COLOR = pal.gates;
      const GROUND_PHASES = new Set(['docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback']); // pushback : porte encore occupée (g.acId libérée AU DÉPART de pushback, aircraft.mjs doPushback)
      const atGate = new Set(sim.aircraft
        .filter((a) => a.gateId != null && GROUND_PHASES.has(a.phase))
        .map((a) => a.gateId));
      for (const g of sim.infra.gates) {
        if (g.x === undefined) continue;
        const [x, y] = screenToCanvas(g.x, g.y, cam);
        const w = g.w * cam.zoom, h = g.h * cam.zoom;
        const occ = atGate.has(g.id);
        const res = !occ && g.acId != null;
        if (res) {
          // réservée : hachures (motif noir et blanc — lisible en N&B)
          ctx.fillStyle = GATE_COLOR[g.size] || '#9e9e9e';
          ctx.fillRect(x, y, w, h);
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.lineWidth = 2;
          for (let sx = -h; sx < w; sx += 6) {
            ctx.beginPath(); ctx.moveTo(x + sx, y + h); ctx.lineTo(x + sx + h, y); ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.fillStyle = occ ? GATE_COLOR.occupied : (GATE_COLOR[g.size] || '#9e9e9e');
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = occ ? '#fff' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = occ ? 1.5 : 1;
        ctx.strokeRect(x, y, w, h);
        if (cam.zoom >= 0.7) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px system-ui';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(occ ? 'O' : res ? 'R' : '·', x + w / 2, y + h / 2 + 1);
        }
      }
    }
    // R39 : le BÂTIMENT SÉLECTIONNÉ (clic carte) est entouré — la sélection
    // est lisible autrement que par la couleur (trait pointillé blanc).
    if (selectionOf) {
      const sel = selectionOf();
      if (sel && sel.kind === 'bldg') {
        const b = [...sim.infra.runways, ...sim.infra.taxiways, ...sim.infra.terminals, ...sim.infra.services]
          .find((x) => x.id === sel.id);
        if (b) {
          const [x, y] = screenToCanvas(b.x, b.y, cam);
          ctx.save();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(x - 2, y - 2, b.w * cam.zoom + 4, b.h * cam.zoom + 4);
          ctx.restore();
        }
      }
    }
  }

  // R39 (t_1c21c88e) : les AVIONS sont distingués par TAILLE (AIRCRAFT,
  // lecture seule — small < medium < large) et l'orientation suit le SENS DE
  // DÉPLACEMENT réel : le nœud suivant du chemin (pathfinding, lecture seule)
  // donne la direction ; sans chemin (stationné) → direction par phase. La
  // tête (cône) pointe devant : le sens est lisible SANS couleur (critère
  // R39 « indication accessible autrement que par la couleur seule »).
  // ponytail : le sens = direction vers le nœud SUIVANT (pas une vitesse
  // instantanée) ; le jeu a 3 tailles d'avion, pas de flotte mixte continue.
  const AC_SCALE = Object.freeze({ small: 0.7, medium: 1, large: 1.6 });
  function aircraftAngle(sim, a) {
    // Chemin actif : direction vers le nœud SUIVANT (le graphe, lecture seule).
    try {
      const graph = sim._graph;
      if (graph && Array.isArray(a.path) && a.path.length > 1) {
        const idx = Math.min((a.pathPtr || 0) + 1, a.path.length - 1);
        const n = graph.nodes[a.path[idx]];
        if (n && (n.x !== a.x || n.y !== a.y)) return Math.atan2(n.y - a.y, n.x - a.x);
      }
    } catch { /* graphe pas encore construit (avant le 1er tick) */ }
    // Stationné / téléport : direction par phase (descente → bas ; décollage → haut).
    if (a.phase === 'approach' || a.phase === 'holding' || a.phase === 'landing' || a.phase === 'exit') return Math.PI / 2;
    if (a.phase === 'pushback' || a.phase === 'departure') return -Math.PI / 2;
    // À la porte : vers la piste (sortie par le haut) ; sinon neutre.
    return -Math.PI / 2;
  }
  function drawAircraft(state, cam) {
    const sim = state.sim;
    if (!sim || !sim.aircraft) return;
    for (const a of sim.aircraft) {
      if (a.x === undefined || a.y === undefined) continue; // pas encore positionné
      const [x, y] = screenToCanvas(a.x, a.y, cam);
      const k = (AC_SCALE[a.acType] || 1) * cam.zoom; // échelle TAILLE (small < medium < large)
      const ang = aircraftAngle(sim, a);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2); // le sprite est dessiné « nez vers le haut »
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-2 * k - 1 + 2, -10 * k + 2, 4 * k, 20 * k); // ombre
      ctx.fillStyle = a.color || '#eceff1';
      // Fuselage (long) + ailes (larges) — la TÊTE (cône) pointe devant.
      ctx.fillRect(-2 * k, -10 * k, 4 * k, 20 * k);
      ctx.fillRect(-8 * k, -4 * k, 16 * k, 3 * k);
      // Tête (nez) : un cône en plus (le sens est lisible sans couleur).
      ctx.beginPath();
      ctx.moveTo(0, -13 * k); ctx.lineTo(3 * k, -8 * k); ctx.lineTo(-3 * k, -8 * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // R39 : l'avion SÉLECTIONNÉ (clic carte, panels.mjs) est entouré (trait
      // pointillé blanc) — la sélection est lisible autrement que par couleur.
      if (selectionOf) {
        const sel = selectionOf();
        if (sel && sel.kind === 'ac' && sel.id === a.id) {
          ctx.save();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.arc(x, y, 16 * (AC_SCALE[a.acType] || 1) * cam.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // Écran de jeu : terrain + infra + avions sous la caméra.
  function drawGame(state, cam, pal) {
    ctx.fillStyle = '#263238';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTerrain(state, cam, pal);
    drawInfra(state, cam, pal);
    drawAircraft(state, cam);
  }

  // Menu de départ : T4 (t_eb78478e) — ÉCRAN-TITRE animé « l'aéroport la
  // nuit » (zéro asset, ~150 ops canvas) : ciel dégradé + lune + 90 étoiles
  // scintillantes (positions DÉTERMINISTES — pas de tirage) + piste en
  // perspective + terminal aux fenêtres allumées + avion en transit + titre.
  // Horloge d'animation LOCALE (menuT, comptée par frame — le menu n'a pas
  // de sim, donc pas de time de jeu à lire). Les commandes du menu restent
  // des BOUTONS DOM (R20 ; les touches N/R en raccourci) ; T4 : chaque
  // bouton reçoie une ICÔNE vectorielle (icons.mjs) — les 13 boutons-
  // scénarios un accent coloré PAR SCÉNARIO (distingusables sans lire le nom).
  let menuBox = null;
  let resumeBtn = null;
  let diffBtns = []; // T2-1 (t_d5da994c) : les boutons de difficulté (rangée du menu)
  let menuT = 0; // T4 : horloge d'animation du titre (frames)
  // T4 passe PERF : le dégradé du ciel + la table des 90 étoiles sont en
  // CACHE par (W,H) — recalculés UNIQUEMENT au redimensionnement (zéro
  // allocation par frame : le budget de frame rAF est intact, le menu est la
  // seule « anim » hors jeu).
  const SCENARIO_HUES = Object.freeze([199, 262, 330, 15, 45, 110, 160, 210, 250, 300, 60, 130, 350]);
  let menuCacheKey = 0;
  let menuSkyGrad = null;
  let menuStarPos = [];
  function drawMenu(pal) {
    menuT += 1;
    const W = canvas.width, H = canvas.height;
    // Cache par (W,H) — un resize change la clé et recalcule tout.
    const ck = W * 512 + H;
    if (ck !== menuCacheKey) {
      menuCacheKey = ck;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, THEME.skyTop); g.addColorStop(1, THEME.skyBottom);
      menuSkyGrad = g;
      menuStarPos = Array.from({ length: 90 }, (_, i) => ({
        x: (i * 733 + 57) % Math.max(1, W),
        y: (i * 389 + 131) % Math.max(1, Math.floor(H * 0.5)),
      }));
    }
    // Ciel : dégradé nuit (tokens, EN CACHE) + lune (halo + disque).
    ctx.fillStyle = menuSkyGrad;
    ctx.fillRect(0, 0, W, H);
    const mx = W * 0.78, my = H * 0.18, mr = Math.min(W, H) * 0.035;
    ctx.save();
    ctx.fillStyle = THEME.moon;
    ctx.globalAlpha = 0.15;
    ctx.beginPath(); ctx.arc(mx, my, mr * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Étoiles : table en CACHE (positions déterministes) + scintillement.
    for (let i = 0; i < menuStarPos.length; i++) {
      ctx.globalAlpha = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(menuT * 0.02 + i * 1.7));
      ctx.fillStyle = THEME.moon;
      ctx.fillRect(menuStarPos[i].x, menuStarPos[i].y, 2, 2);
    }
    ctx.globalAlpha = 1;
    // Sol + piste en perspective (trapèze) + ligne de centre en pointillés.
    const gy = H * 0.62;
    ctx.fillStyle = THEME.ground;
    ctx.fillRect(0, gy, W, H - gy);
    const cx = W * 0.5, rwY0 = gy + 12, rwY1 = H - 26;
    const rwW0 = W * 0.04, rwW1 = W * 0.22;
    ctx.fillStyle = THEME.runway;
    ctx.beginPath();
    ctx.moveTo(cx - rwW0 / 2, rwY0); ctx.lineTo(cx + rwW0 / 2, rwY0);
    ctx.lineTo(cx + rwW1 / 2, rwY1); ctx.lineTo(cx - rwW1 / 2, rwY1);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = THEME.runwayLine;
    for (let i = 0; i < 7; i++) {
      const f = i / 6; // 0 (fond) → 1 (avant) : la perspective s'élargit
      const y = rwY0 + (rwY1 - rwY0) * f;
      const half = ((rwW0 + (rwW1 - rwW0) * f) / 2) * 0.06;
      const len = 4 + 10 * f;
      ctx.fillRect(cx - half, y - len / 2, Math.max(2, half * 2), len);
    }
    // Terminal : silhouette à gauche + 3 fenêtres allumées (doré).
    const tw = W * 0.16, tx = W * 0.1, tyTop = gy - Math.min(46, H * 0.07);
    ctx.fillStyle = THEME.surface;
    ctx.fillRect(tx, tyTop, tw, gy - tyTop);
    ctx.fillStyle = THEME.gold;
    for (let c = 0; c < 3; c++) {
      ctx.fillRect(tx + tw * (0.15 + c * 0.3), tyTop + (gy - tyTop) * 0.55, tw * 0.14, (gy - tyTop) * 0.22);
    }
    // Avion en transit (boucle ~80 frames) + feu rouge clignotant.
    const tt = (menuT % 80) / 80;
    const px = cx + (tt - 0.5) * rwW1 * 3.2;
    const py = rwY1 - 16 - Math.sin(tt * Math.PI) * 14;
    const acs = Math.max(26, H * 0.045);
    ctx.save();
    ctx.translate(px - acs / 2, py - acs / 2);
    drawIcon(ctx, 'plane', acs, { color: THEME.text, accent: THEME.accent });
    ctx.restore();
    ctx.globalAlpha = (menuT % 30) < 15 ? 1 : 0.3;
    ctx.fillStyle = THEME.err;
    ctx.beginPath(); ctx.arc(px - acs * 0.3, py, 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Titre + sous-titre (ombre portée — lisible sur tout fond) + version.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${THEME.titleSize}px ${THEME.fontUi}`;
    ctx.fillStyle = 'rgba(5,9,20,0.6)';
    ctx.fillText('AIRPORT TYCOON', W / 2 + 3, H * 0.4 + 3);
    ctx.fillStyle = THEME.text;
    ctx.fillText('AIRPORT TYCOON', W / 2, H * 0.4);
    ctx.font = `${THEME.subtitleSize}px ${THEME.fontUi}`;
    ctx.fillStyle = THEME.textDim;
    ctx.fillText('Un aéroport la nuit : du bitume au départ.', W / 2, H * 0.4 + THEME.titleSize * 0.8);
    ctx.font = `11px ${THEME.fontUi}`;
    ctx.textAlign = 'right';
    ctx.fillText(`v${THEME.versionTag}`, W - 12, H - 12);
    // --- BOUTONS DOM (créés UNE FOIS, idempotent — pattern R20) -------------
    // R38 : les TROIS scénarios rejouables (mêmes règles, config explicite +
    // objectif R22 annoncé) — des BOUTONS (souris) comme les commandes du
    // menu. « Nouvelle partie » reste le MODE LIBRE (pas de champ scenario,
    // pas d'objectif annoncé). T4 : icônes vectorielles (icons.mjs) — les
    // boutons-scénarios reçoivent un accent par index (SCENARIO_HUES).
    const scenarioBtnDefs = (onMenuCommands && onMenuCommands.scenarioModes)
      ? onMenuCommands.scenarioModes()
      : [];
    if (!menuBox) {
      menuBox = document.createElement('div');
      menuBox.className = 'menu-btns';
      menuBox.setAttribute('role', 'toolbar');
      menuBox.setAttribute('aria-label', 'Commandes du menu (nouvelle partie, reprise de la sauvegarde, options, scénarios)');
      const btnNew = document.createElement('button');
      btnNew.className = 'tool';
      btnNew.textContent = 'Nouvelle partie (N)';
      btnNew.addEventListener('click', () => onMenuCommands.newGame());
      const icNew = iconCanvas('plane', 18, { color: THEME.text, accent: THEME.accent });
      if (icNew) btnNew.prepend(icNew);
      resumeBtn = document.createElement('button');
      resumeBtn.className = 'tool';
      resumeBtn.textContent = 'Reprendre la sauvegarde (R)';
      resumeBtn.addEventListener('click', () => onMenuCommands.resume());
      const icResume = iconCanvas('info', 18, { color: THEME.text, accent: THEME.gold });
      if (icResume) resumeBtn.prepend(icResume);
      const btnOpts = document.createElement('button');
      btnOpts.className = 'tool';
      btnOpts.textContent = 'Options (V)'; // V — clavier (O reste l'overlay réseau R18)
      btnOpts.addEventListener('click', () => onMenuCommands.openOptions());
      const icOpts = iconCanvas('gear', 18, { color: THEME.text, accent: THEME.accent });
      if (icOpts) btnOpts.prepend(icOpts);
      menuBox.append(btnNew, resumeBtn, btnOpts);
      scenarioBtnDefs.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'tool';
        b.textContent = s.label; // le nom du scénario (R38 : config explicite + objectif annoncé)
        b.addEventListener('click', () => onMenuCommands.scenario(s.id));
        const ic = iconCanvas('plane', 18, { color: THEME.text, accent: `hsl(${SCENARIO_HUES[i % SCENARIO_HUES.length]} 70% 62%)` });
        if (ic) b.prepend(ic);
        menuBox.appendChild(b);
      });
      // T2-1 (t_d5da994c) : SÉLECTION DE DIFFICULTÉ dans le menu — 3 boutons
      // (Facile / Normal / Difficile), MÊME style .menu-btns .tool que les
      // commandes du menu (pas de CSS duplicaté) ; la sélection est marquée
      // par aria-pressed (pattern R43) et mise à jour à chaque frame (repeint
      // idempotent, comme resumeBtn ci-dessous). Le clic émet
      // onMenuCommands.setDifficulty — le choix vit dans main.mjs (paramètre
      // du prochain startNewGame, SÉRIALISÉ via state.difficulty).
      const diffBtnDefs = (onMenuCommands && onMenuCommands.difficultyModes)
        ? onMenuCommands.difficultyModes()
        : [];
      const diffRow = document.createElement('div');
      diffRow.className = 'menu-diff';
      const diffLabel = document.createElement('span');
      diffLabel.className = 'menu-diff-label';
      diffLabel.textContent = 'Difficulté :';
      diffRow.appendChild(diffLabel);
      diffBtns = diffBtnDefs.map((d) => {
        const b = document.createElement('button');
        b.className = 'tool';
        b.textContent = d.label; // le nom du profil (core/difficulty.mjs)
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => onMenuCommands.setDifficulty(d.id));
        diffRow.appendChild(b);
        return b;
      });
      menuBox.appendChild(diffRow);
      document.body.appendChild(menuBox);
    }
    resumeBtn.style.display = onMenuCommands.canResume() ? '' : 'none';
    // T2-1 : la sélection de difficulté suit la commande (aria-pressed) —
    // idempotent : la valeur ne change que sur setDifficulty.
    const curDiff = (onMenuCommands.difficulty && onMenuCommands.difficulty()) || 'normal';
    diffBtns.forEach((b, i) => {
      const def = (onMenuCommands.difficultyModes || (() => []))()[i];
      if (def) b.setAttribute('aria-pressed', String(def.id === curDiff));
    });
  }

  // Bandeau HUD : temps, vitesse, pause + (si sim) fonds, passagers, satisfaction.
  function drawHud(state) {
    const lines = [
      `Temps : ${Math.floor(state.time / 60)}:${String(Math.floor(state.time % 60)).padStart(2, '0')}`,
      `Vitesse : x${[1, 2, 4][state.speedIndex]}`,
    ];
    const sim = state.sim;
    if (sim && sim.economy) {
      // La sim passe de `funds` (M1) à `money` — on lit les deux pour la rétrocompat.
      const m = sim.economy.money ?? sim.economy.funds;
      if (m !== undefined) lines.push(`Fonds : ${Math.round(m)} $`);
    }
    if (sim && sim.passengers) {
      lines.push(`Passagers : ${sim.passengers.totalCarried} · ${Math.round(sim.passengers.satisfaction)} %`);
      // BL-13 (AC22) : les files du parcours passagers sont VISIBLES (occupation
      // lisible par étape). R30 : les files sont PAR TERMINAL (sim.passengers.
      // queues[terminalId]) ; le HUD affiche la SOMME des terminaux (queueTotals,
      // agrégat de lecture — pas une règle).
      const q = queueTotals(sim);
      lines.push(`Files : check-in ${Math.round(q.checkin)} · sécurité ${Math.round(q.security)} · attente ${Math.round(q.board)}`);
    }
    if (sim) {
      // T3 MÉTÉO (t_9b665a8b) : l'état + l'effet MESURABLE en cours (lecture
      // pure weatherView — pas de mutation ; l'incident météo majore les
      // effets à la ligne « orage », weatherEffect, weather.mjs). « clear »
      // si le champ n'existe pas encore (nouvelle partie, 1er tick).
      const wv = weatherView(sim);
      lines.push(
        `Météo : ${wv.fr}${wv.incident ? ' — incident (effets orage)' : ''}` +
        (wv.speed < 1 ? ` · arrivée ${Math.round((1 - wv.speed) * 100)} % plus lente` : '') +
        (wv.delay > 0 && !wv.incident ? ` · +${wv.delay} s en attente` : '')
      );
      // T3 (t_76744b22) : l'HORLOGE DE JEU (jour + heure JEU + phase) + la
      // SAISON (dérivée du jour — saisons.mjs) : l'affichage du temps
      // (lecture pure clockView/seasonView — l'horloge absente → J1 08:00).
      const cv = clockView(sim);
      const sv = seasonView(sim);
      lines.push(`Horloge : J${cv.day} ${cv.label} (${cv.phaseFr}) · ${sv.fr}`);
    }
    if (state.paused) lines.push('PAUSE (P pour reprendre)');
    const w = 240;
    ctx.fillStyle = 'rgba(10,18,32,0.82)'; // T4 : surface « nuit » (tokens)
    ctx.fillRect(12, 12, w, 24 * lines.length + 16);
    ctx.fillStyle = THEME.text;
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((t, i) => ctx.fillText(t, 24, 24 + i * 24 + 12));
  }

  // T4 (t_eb78478e) : transition d'écran (MENU ↔ JEU) — fondu depuis le noir
  // sur ~0,35 s quand l'écran change (horloge par frame, ~21 frames à 60 fps).
  // Un seul état local au renderer (zéro règle de jeu, zéro DOM).
  let transScreen = null;
  let transT = 0;
  const TRANS_DUR = 0.35;

  function render(state) {
    const cam = state.camera;
    // R43 : la palette suit l'option daltonienne (état live, lue à chaque
    // frame) — getPalette est en lecture seule : unknown → standard (jamais
    // de rendu cassé).
    const pal = getPalette(paletteOf ? paletteOf() : false);
    if (state.screen !== transScreen) { transScreen = state.screen; transT = 0; }
    if (transT < TRANS_DUR) transT += 1 / 60;
    if (state.screen === 'menu') {
      drawMenu(pal);
    } else {
      if (menuBox) menuBox.style.display = 'none'; // R20 : les boutons du menu ne se superposent pas au jeu
      // Juice (t_5065be95) : le SHAKE (incident majeur) décale le monde entier
      // (particules + overlay compris) — le HUD, lui, reste stable (UI ≠ monde).
      ctx.save();
      const off = juice ? juice.shakeOffset() : { x: 0, y: 0 };
      ctx.translate(off.x, off.y);
      drawGame(state, cam, pal);
      // Superpositions (fantôme de construction…) — la logique de pose reste dans la sim/UI.
      for (const overlay of overlays) overlay(ctx, cam, viewSize());
      if (juice) juice.draw(ctx, cam, viewSize());
      // T3 MÉTÉO (t_9b665a8b) : teinte SUBLIME sur le monde (zéro asset —
      // un seul rempli) : pluie = bleuté, neige = voile blanc, orage/incident
      // = nuage sombre. « clair »/« nuageux » : rien (le nuageux est trop
      // léger pour exister — pas de bruit). Le HUD reste stable (après restore).
      const tint = weatherTint(state.sim);
      if (tint) { ctx.fillStyle = tint; ctx.fillRect(-16, -16, canvas.width + 32, canvas.height + 32); }
      // T3 (t_76744b22) : l'HORLOGE jour/nuit — la teinte du monde PAR PHASE
      // (nuit = bleuté profond, aube/crépuscule = voiles, jour = rien) +
      // l'habillage de SAISON (par-dessus la météo : été doré / automne
      // ocre / hiver bleuté, printemps = rien). Zéro asset, deux remplis.
      const dt_ = dayTint(state.sim);
      if (dt_) { ctx.fillStyle = dt_; ctx.fillRect(-16, -16, canvas.width + 32, canvas.height + 32); }
      const st = seasonWorldTint(state.sim);
      if (st) { ctx.fillStyle = st; ctx.fillRect(-16, -16, canvas.width + 32, canvas.height + 32); }
      ctx.restore();
      drawHud(state);
    }
    // T4 : fondu de transition (MENU ↔ JEU) — voile noir à alpha DÉCROISSANT
    // (1 → 0) après un changement d'écran ; les deux écrans en dessous sont
    // déjà peints (menu ou jeu) : un seul rempli, pas de couche DOM.
    if (transT < TRANS_DUR) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - transT / TRANS_DUR);
      ctx.fillStyle = THEME.skyTop;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    // Exposition pour les tests/CDP sans exposer les règles de jeu
    return {
      screen: state.screen,
      paused: state.paused,
      cam: { x: cam.x, y: cam.y, zoom: cam.zoom },
      viewSize: viewSize(),
    };
  }

  return { render, viewSize, resize };
}

__exports.makeRenderer = makeRenderer;
})(__reg['m_src_ui_renderer']);

/* --- module src/economy/economy.mjs --- */
(function (__exports) {
// Économie : revenus (vols + passagers), coûts (construction + exploitation),
// déficit/faillite. Logique pure, mutue sim.economy.
// La satisfaction + le parcours passagers ont déménagé dans src/sim/passengers.mjs
// (BL-13, AC22/AC40) : `tickPassengers` est ré-exporté ici pour compatibilité
// (tick.mjs et les tests l'importaient d'ici).
// Recettes : atterrissage/porte au SOL, billets au DÉCOLLAGE.
const { pushEvent } = __ns('m_src_core_sim-state');
const { OPEX_PER_SEC } = __ns('m_src_data_catalog');
const { countTypeServing } = __ns('m_src_infra_assignments');
const { marketingMult } = __ns('m_src_infra_upgrades');

const FUEL_COST_PER_PAX = 0.5;   // carburant : coûté au départ (critère carburant)
// R19 : les montants UNITAIRES du cycle avion (billets, droits, carburant) sont
// exportés : planNote (flights.mjs) les réutilise pour le « revenu estimé »
// (hypothèse lisible de l'offre planning) — UNE seule source, pas de chiffres
// copiés dans l'UI. PAX_REVENUE : billets pleins ; sans station carburant le
// départ est SEC (ac._dryDeparture) → billets MOITIÉS (PAX_REVENUE_DRY).
const PAX_REVENUE = 25;
const PAX_REVENUE_DRY = 12.5;  // billets moitiés (départ sec, BL-12)
const DUTYFREE_PER_PAX = 8;    // T33 (t_88aee6d5) : recette boutique libre-service PAR pax débarqué (par boutique AFFECTÉE au terminal)
const LANDING_FEE = 200;       // droits d'atterrissage (onGateArrived)
const GATE_FEE = 100;          // redevance porte (onGateArrived)
const BANKRUPT_LIMIT = -10000;   // solde sous ce seuil = faillite
// BL-15 (AC6) : un vol ANNULLÉ (blocage persistant, A-5) coûte une indemnité
// passagers (compte spent.compensation, pas une recette négative — même
// discipline que le carburant, A-6) : l'incident a un coût financier lisible.
const COMP_FEE_PER_CANCEL = 500;
// D5 (R11, t_eef3e9c8) : taux d'intérêt PARAMÉTRÉ sur période — une SEULE
// politique (remplace le 1 %/s capé en dur de BL-18). Le taux ET la cap sont
// des paramètreS (pas de chiffres magiques dans le tick) : DEBT.ratePerSec =
// le taux (/s), DEBT.baseCap = la borne de l'assiette (BL-18 la fixait à
// −BANKRUPT_LIMIT). Même valeur par défaut → le comportement de référence ne
// bouge pas (fixtures R12/R35), mais la politique est réglable sans toucher la
// sim. La cap est le paramètre DU TAUX (pas un second mécanisme).
const DEBT = Object.freeze({
  ratePerSec: 0.01,  // 1 %/s (BL-18) — paramètre D5
  baseCap: 10000,    // borne de l'assiette (BL-18 : −BANKRUPT_LIMIT) — paramètre D5
  // R35 (t_dabe90d7) : le taux s'applique sur une PÉRIODE EXPLICITE — 5 min,
  // la période financière (R16) : l'intérêt d'une période = ratePerSec ×
  // periodSec × assiette (1 %/s × 300 s = 3 % de l'assiette par période),
  // bornée par la cap (D5 : une seule politique — le paramètre de période,
  // pas un 2e mécanisme).
  periodSec: 300,
});

// R35 (t_dabe90d7) : le redressement BORNÉ — un emprunt UNIQUE par partie.
// L'emprunt n'est PAS une recette d'exploitation (jamais dans revenue) et ne
// peut pas être obtenu indéfiniment (maxLoans) : c'est une liquidité qui
// s'ajoute au solde, avec ses intérêts facturés UNE fois à la conclusion
// (compte `debt`, comme le taux D5 : le bilan reste à l'équilibre, R12).
const LOAN = Object.freeze({
  principal: 5000, // la liquidité obtenue
  rate: 0.05,      // 5 % d'intérêts (facturés une fois, à la conclusion)
  maxLoans: 1,     // BORNE : un seul emprunt par partie (pas indéfini)
});

// R35 (t_dabe90d7) : l'ALERTE de TRÉSORERIE — deux niveaux (la trésorerie
// s'amenuise, puis le déficit s'approfondit) avec un COOLDOWN (pas de spam :
// on ne re-prévient un niveau que s'il n'a pas été atteint depuis cooldownSec).
// Ignorer les avertissements mène à la faillite (BANKRUPT_LIMIT, mesurable).
const TREASURY = Object.freeze({
  warn: { below: 4000, kind: 'treasury-warn' },        // sous 4 000 $ : « s'amenuit »
  critical: { below: -5000, kind: 'treasury-critical' }, // sous −5 000 $ : « dette s'approfondit »
  cooldownSec: 300, // 5 min : on ne re-prévient pas plus souvent un niveau
});

function canAfford(sim, cost) { return sim.economy.money >= cost; }

// R11 (t_eef3e9c8) : une dépense dédiée EST payée MÊME EN DÉFICIT — le solde
// baisse (dette réelle), jamais refusée silencieusement. L'ancien garde
// « si fonds insuffisants → ne payer » faisait que le carburant / l'indemnité
// sautaient quand la trésorerie était déjà creusée : l'incident n'avait alors
// aucun coût (compte spent vierge) et le déficit réel restait invisible. La
// garde est levée : `charge` débitte TOUJOURS (le solde peut devenir négatif),
// le compte `spent[cat]` reste alimenté → le bilan lis la dépense, le solde
// montre la dette. (La faillite, elle, vient de checkBankruptcy sous tickEconomy.)
function charge(sim, cost, cat) {
  sim.economy.money -= cost;
  sim.economy.spent[cat] = (sim.economy.spent[cat] ?? 0) + cost;
}

// Encaisse une recette (catégorie pour les stats).
// BL-05 (A13) : satisfaction 0 % = aéroport que plus personne ne sert → aucune
// recette ne croît tant qu'elle ne remonte (les vols se purgent, pas de revenus).
// BL-15 (AC6) : la satisfaction EST une variable économique — la recette est
// PROPORTIONNELLE à la satisfaction (100 % = plein, 50 % = moitié) : la qualité
// dégradée se paie en recettes, pas seulement en satisfaction « cosmétique ».
function earn(sim, amount, cat) {
  const sat = sim.passengers?.satisfaction ?? 100;
  if (sat <= 0) return; // pas de croissance en insatisfaction totale
  const m = amount * sat / 100; // recette multipliée par la satisfaction
  sim.economy.money += m;
  sim.economy.revenue[cat] = (sim.economy.revenue[cat] ?? 0) + m;
}

// Atterri au sol : droits d'atterrissage + redevance porte (constantes R19).
function onGateArrived(sim, ac) {
  earn(sim, LANDING_FEE, 'landing');
  earn(sim, GATE_FEE, 'gate');
  // T33 (t_88aee6d5) : les boutiques libre-service AFFECTÉES au terminal de
  // la porte d'arrivée (R27 : s.target — comme tout service au sol) rendent
  // DUTYFREE_PER_PAX PAR pax débarqué PAR boutique (compte dédié « dutyfree »
  // — même discipline que le carburant : earn, jamais de recette négative).
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  if (g) {
    const shops = countTypeServing(sim, 'dutyfree', g.terminalId);
    if (shops > 0) earn(sim, ac.pax * shops * DUTYFREE_PER_PAX, 'dutyfree');
  }
}

// Départ : recettes passagers (billets), puis carburant en DÉPENSE dédiée.
// BL-14 (A-6) : le carburant passe par `charge` (compte spent.fuel) — jamais une
// « recette négative » : l'ancien earn(-x, 'fuel-cost') contaminait revenue
// (bilan « recettes » faux) et, sous la garde satisfaction 0 %, la dépense
// carburant sautait silencieusement (elle passait aussi par earn).
// BL-12 (AC21) : départ SÉC (pas de station carburant, ac._dryDeparture) →
// billets MOITIÉS : l'absence du service a un coût ÉCONOMIQUE visible (et non
// bloquant — le vol part, l'événement « no-fuel » l'explique).
function onGateDeparted(sim, ac) {
  // T33 (t_88aee6d5) : l'amélioration « marketing » (marketingMult — niveau
  // du terminal de DÉPART, upgrades.mjs) augmente la recette billets
  // (pleine ou sèche) — niveau 0 = ×1 (comportement EXISTANT).
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  const m = g ? marketingMult(sim, g.terminalId) : 1;
  earn(sim, ac.pax * (ac._dryDeparture ? 12.5 : 25) * m, 'pax');
  charge(sim, ac.pax * FUEL_COST_PER_PAX, 'fuel');
}

// BL-15 (AC6) : indemnité vol annulé — l'incident a un coût financier VISIBLE
// (compte spent.compensation, jamais une recette négative). Appelé par le
// module avions à l'annulation d'un vol (blocage persistant, A-5) : l'effet
// « incident → finances » du critère AC6 est mesurable (charge, pas earn).
function onFlightCancelled(sim) {
  charge(sim, COMP_FEE_PER_CANCEL, 'compensation');
}

// Exploitation continue (BL-14, R8/A12) : le socle aéroportuaire (piste, taxiway,
// terminal) coûte MÊME SANS VOL, et chaque service ACTIF (construit) coûte aussi.
// Non protégée par canAfford : c'est une dépense fixe qui PEUT creuser le déficit
// (critère 8) ; la faillite vient ensuite si le solde reste trop négatif.
function tickEconomy(sim, dt) {
  let opex = 0;
  for (const r of sim.infra.runways) opex += (OPEX_PER_SEC.runway ?? 0) * dt;
  for (const t of sim.infra.taxiways) opex += (OPEX_PER_SEC.taxiway ?? 0) * dt;
  for (const t of sim.infra.terminals) opex += (OPEX_PER_SEC.terminal ?? 0) * dt;
  for (const s of sim.infra.services) opex += (OPEX_PER_SEC[s.type] ?? 0) * dt;
  if (opex) {
    // T2-1 (t_d5da994c) : la DIFFICULTÉ (paramètre de spawn, sim.difficulty —
    // core/difficulty.mjs) multiplie l'OPEX : la RÈGLE est inchangée
    // (OPEX_PER_SEC du catalogue, débit dans le MÊME canal spent.opex →
    // l'identité trésorerie EV-9 tient), seul le paramètre du spawn change.
    // Sauvegarde PRÉ-T2-1 (champ absent) → ×1 : le référentiel ne bouge pas.
    const f = (sim.difficulty && sim.difficulty.opexFactor) || 1;
    opex *= f;
    sim.economy.money -= opex;
    sim.economy.spent.opex = (sim.economy.spent.opex ?? 0) + opex;
  }
  // Déficit : si le solde est négatif, la dette s'aggrave (intérêts), puis faillite.
  // BL-18 : l'assiette des intérêts est CAPÉE au seuil de faillite (BANKRUPT_LIMIT) —
  // l'ancien code (Math.abs(money) * 0.01 * dt, assiette non bornée) créait une
  // boule de neige : au-delà de −10 000 l'intérêt (1 %/s) dépassait n'importe quel
  // flux et le solde restait VERROUILLÉ au seuil (la sim gelait, la partie perdait
  // tout son sens après ~3 h). Capée, la dette reste lisible et la faillite reste
  // ATTEIGNABLE (le solde peut toujours franchir −10 000 : la pente opex le fait).
  if (sim.economy.money < 0) {
    // D5 (R11, t_eef3e9c8) : taux PARAMÉTRÉ (DEBT.ratePerSec) + cap = paramètre
    // DU taux (DEBT.baseCap) — une seule politique, remplace le 1 %/s capé en
    // dur de BL-18. Même valeurs par défaut (0,01 / 10 000) → le comportement de
    // référence ne bouge pas (fixtures R12/R35).
    // R12 (t_25614b63) : `debt` est le COMPTE DÉDIÉ des intérêts (pas un
    // principal d'emprunt, ne PAS le réinterpréter comme tel) : il CUMULE
    // l'intérêt chargé, et le solde est chargé d'intérêts UNE fois (money -= i).
    // L'identité trésorerie EV-9 (money = START + recettes − dépenses − debt)
    // tient car la dette y est déjà comptée ; periodStatement la met dans net
    // pour que le bilan se RAPPORCHE au solde.
    const base = Math.min(Math.abs(sim.economy.money), DEBT.baseCap);
    const interest = base * DEBT.ratePerSec * dt;
    sim.economy.debt += interest;
    sim.economy.money -= interest;
  }
  // R16 : clôture des périodes financières (5 min de jeu) — compteur
  // accumulateur : `dt` = 0 (pause) ne clôt rien, un gros tick non plus.
  if (dt > 0) {
    sim.economy._periodAcc = (sim.economy._periodAcc ?? 0) + dt;
    while (sim.economy._periodAcc >= PERIOD_S) {
      closePeriod(sim);
      sim.economy._periodAcc -= PERIOD_S;
    }
  }
  // R35 (t_dabe90d7) : l'ALERTE de TRÉSORERIE (deux niveaux, cooldown) —
  // AVANT checkBankruptcy : le niveau critique prévient encore le tick où la
  // faillite est atteinte (l'avertissement précède la faillite, mesurable).
  treasuryAlerts(sim);
  checkBankruptcy(sim);
}

// R35 (t_dabe90d7) : ALERTE de TRÉSORERIE — deux niveaux (TREASURY : la
// trésorerie s'amenuise, puis le déficit s'approfondit) avec COOLDOWN (pas de
// spam : on ne re-prévient un niveau que s'il n'a pas été atteint depuis
// cooldownSec — le compteur vit sur la sim → la reprise est cohérente).
// C'est l'avertissement AVANT la faillite : l'ignorer (ne pas emprunter)
// laisse la pente (opex + intérêts) atteindre BANKRUPT_LIMIT (mesurable, test).
// L'UI lit sim.alerts (toasts) — la sim décide, l'UI affiche (UI fine).
function treasuryAlerts(sim) {
  const e = sim.economy;
  if (e.bankrupt) return; // la sim est stoppée : plus d'alertes (l'écran de faillite les remplace)
  const now = sim.time ?? 0;
  const last = e._treasuryAlerts || (e._treasuryAlerts = {}); // sauvegarde ancienne : absent → 1re alerte
  for (const lvl of [TREASURY.warn, TREASURY.critical]) {
    const due = last[lvl.kind] == null || now - last[lvl.kind] >= TREASURY.cooldownSec;
    if (e.money < lvl.below && due) {
      pushEvent(sim, { kind: lvl.kind, money: Math.round(e.money), below: lvl.below });
      last[lvl.kind] = now;
    }
  }
}

// R35 (t_dabe90d7) : EMPRUNT — le redressement BORNÉ (LOAN : un seul par
// partie, liquidité + intérêts facturés UNE fois à la conclusion). PATRON R33
// (réponse opérationnelle) : LECTURE pure (loanState : conséquences AVANT la
// décision) + COMMANDE (takeLoan : validation AVANT toute écriture — refus
// = motif lisible, SANS mutation partielle). L'emprunt n'est PAS une recette
// d'exploitation (jamais dans revenue, R11) : c'est une liquidité ; ses
// intérêts vont au compte dédié `debt` (l'identité EV-9 tient, R12 : le
// principal est une ligne de crédit du bilan, comptée UNE fois).
function ensureLoan(sim) {
  const e = sim.economy;
  if (!e) return; // simulation sans module économie (sauvegarde très ancienne) — rien à migrer
  if (!isLoanObj(e.loan)) e.loan = { principal: 0, count: 0 }; // sauvegarde ancienne / absente
}
const isLoanObj = (l) => l && typeof l === 'object'
  && (l.principal == null || typeof l.principal === 'number')
  && (l.count == null || typeof l.count === 'number');

// LECTURE pure (pattern R33) : l'emprunt est-il encore possible, à quel coût —
// le panneau affiche les conséquences AVANT le clic.
function loanState(sim) {
  ensureLoan(sim);
  const l = sim.economy.loan;
  const interest = Math.round(LOAN.principal * LOAN.rate);
  const taken = l.count >= LOAN.maxLoans;
  return {
    available: !taken,
    count: l.count, max: LOAN.maxLoans,
    principal: LOAN.principal, interest,
    netLiquidity: LOAN.principal - interest, // ce qui reste EN MAIN après les intérêts
    reason: taken ? `emprunt déjà obtenu (${LOAN.maxLoans} max par partie)` : null,
  };
}

// COMMANDE : validation AVANT toute écriture (refus = motif, pas de mutation
// partielle) ; l'écriture est UN BLOC (la sim est l'unique écrivain).
function takeLoan(sim) {
  ensureLoan(sim);
  const e = sim.economy;
  if (e.bankrupt) return { ok: false, reason: 'faillite : la sim est stoppée (reprendre ou nouvelle partie)' };
  const ls = loanState(sim);
  if (!ls.available) return { ok: false, reason: ls.reason };
  e.loan.count += 1;
  e.loan.principal += LOAN.principal; // le principal DÛ (le distingue des intérêts/liquidités)
  e.money += LOAN.principal - ls.interest; // la liquidité nette (PAS revenue — R11)
  e.debt += ls.interest;                    // les intérêts, compte dédié (EV-9 : comptés une fois)
  pushEvent(sim, { kind: 'loan-taken', principal: LOAN.principal, interest: ls.interest });
  return { ok: true, principal: LOAN.principal, interest: ls.interest };
}

// R35 (t_dabe90d7) : REPRISE après faillite — la sim était stoppée (le tick
// rentrait par l'entrée : sim.economy.bankrupt). Le joueur choisit de
// REPRISE (la sim continue depuis le bilan) : le flag est levé, un événement
// lisible est poussé. La NOUVELLE PARTIE est du côté UI (menu, main.mjs) —
// la sim ne décide pas de la renaissance du jeu.
function resumeAfterBankruptcy(sim) {
  const e = sim.economy;
  if (!e.bankrupt) return { ok: false, reason: 'pas en faillite (rien à reprendre)' };
  e.bankrupt = false;
  pushEvent(sim, { kind: 'bankruptcy-resumed' });
  return { ok: true };
}

// Faillite : solde trop négatif → on arrête la sim (le jeu reste jouable pour réagir).
function checkBankruptcy(sim) {
  if (sim.economy.money < BANKRUPT_LIMIT && !sim.economy.bankrupt) {
    sim.economy.bankrupt = true;
    pushEvent(sim, { kind: 'bankrupt' });
  }
}

// Bilan par PÉRIODE (les compteurs sont cumulés depuis le début de la partie) :
// recettes / exploitation / carburant / indemnités / investissements, avec
// les CAUSES du déficit quand le solde est négatif (AC23 : un bilan qui se
// lit, pas un chiffre). BL-15 : l'investissement = le compte CONSTRUCTION
// (bâtiments payés, démolition remboursée dans revenue) — séparé du carburant
// (dépense des départs) et des indemnités vols annulés (spent.compensation).
function periodStatement(sim) {
  const e = sim.economy;
  ensureLoan(sim); // l'état de l'emprunt est normalisé (sauvegarde ancienne)
  const revenue = Object.values(e.revenue).reduce((a, b) => a + b, 0);
  const opex = e.spent.opex ?? 0;
  const fuel = e.spent.fuel ?? 0;
  const compensation = e.spent.compensation ?? 0;
  const invest = e.spent.construction ?? 0;
  const interest = e.debt; // R12 : compte dédié des intérêts (ledger de l'identité EV-9)
  // R35 (t_dabe90d7) : l'EMPRUNT (redressement borné) — la distinction
  // PRINCIPAL / INTÉRÊTS / LIQUIDITÉS exigée par la carte : le principal est
  // une ligne de CRÉDIT du bilan (l'argent obtenu, pas une recette — R11) ;
  // les intérêts sont dans le compte dédié `debt` (ci-dessus, EV-9 : la dette
  // est comptée UNE fois, R12) ; la liquidité = ce qui reste EN MAIN (solde).
  const loan = e.loan ? e.loan.principal : 0;
  // R12 (t_25614b63) : le net COMPTABILISE la dette (compte dédié) — le bilan se
  // RAPPORCHE au solde : money (partant de 0) == net. L'intérêt est chargé UNE
  // fois du solde (tickEconomy) et cumulé ici ; le −debt de l'identité EV-9
  // couvre cette ligne. R35 : le principal emprunté est la ligne de crédit qui
  // compense les intérêts facturés (le bilan reste à l'équilibre du solde).
  const net = revenue + loan - opex - fuel - invest - compensation - interest;
  const causes = [];
  if (net < 0) {
    if (opex > 0) causes.push(`exploitation ${Math.round(opex)} $ (socle + services)`);
    if (fuel > 0) causes.push(`carburant ${Math.round(fuel)} $`);
    if (compensation > 0) causes.push(`indemnités vols annulés ${Math.round(compensation)} $`);
    if (invest > 0) causes.push(`investissements ${Math.round(invest)} $`);
    if (interest > 0) causes.push(`intérêts sur la dette ${Math.round(interest)} $`);
    if (!causes.length) causes.push('solde dû aux remboursements de démolition');
  }
  return { revenue, opex, fuel, compensation, invest, net, money: e.money, debt: interest, loan, causes };
}

// R16 (t_007f2297) : périodes financières stables + prévision simple.
// PÉRIODE = 5 min de jeu (stable et mesurable, échelle R15). La clôture est un
// COMPTEUR accumulateur (pattern _spawnAcc, flights.mjs) : un gros tick ne
// duplique pas, 0 s de jeu (pause → tick à 0) ne clôt rien. Chaque PÉRIODE =
// delta des comptes CUMULÉS depuis la clôture précédente (les composants
// reconstituent le net — l'identité R12, dette comptée une fois) ; on garde
// les 4 dernières (borné, comme R14) : prévision + lisible.
const PERIOD_S = 300;
const MAX_PERIODS = 4;
const sumObj = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0);
const baseSnapshot = (e) => ({ revenue: sumObj(e.revenue), opex: e.spent.opex ?? 0,
  fuel: e.spent.fuel ?? 0, compensation: e.spent.compensation ?? 0,
  construction: e.spent.construction ?? 0, debt: e.debt || 0 });

// Clôt la période en cours : delta des comptes depuis la base, net par
// l'identité R12 (recettes − dépenses − dette, comptée une fois).
function closePeriod(sim) {
  const e = sim.economy;
  if (!Array.isArray(e.periods)) e.periods = []; // sauvegarde ancienne sans le champ
  const b = e._periodBase || baseSnapshot(e);
  const p = {
    at: sim.time ?? 0, // fin de période (s de jeu, lisible)
    minutes: PERIOD_S / 60,
    revenue: sumObj(e.revenue) - b.revenue,
    opex: (e.spent.opex ?? 0) - b.opex,
    fuel: (e.spent.fuel ?? 0) - b.fuel,
    compensation: (e.spent.compensation ?? 0) - b.compensation,
    invest: (e.spent.construction ?? 0) - b.construction,
    debt: (e.debt || 0) - b.debt,
  };
  p.net = p.revenue - p.opex - p.fuel - p.compensation - p.invest - p.debt;
  e.periods.push(p);
  if (e.periods.length > MAX_PERIODS) e.periods.shift(); // borné (R14)
  e._periodBase = baseSnapshot(e);
  return p;
}

// Prévision simple (R16/G2) : TENDANCE LINÉAIRE depuis la DERNIÈRE période
// close (net $/s de jeu, même échelle qu'OPEX_PER_SEC). SANS historique →
// null : la prévision est INDETERMINÉE, jamais un faux chiffre. L'étiquette
// « projection, pas une garantie » est rendue par l'UI (panneau financier).
function lastPeriod(sim) {
  const p = sim.economy.periods; // peut être absent (sauvegarde ancienne, pas encore close)
  return Array.isArray(p) && p.length ? p[p.length - 1] : null;
}

function forecast(sim) {
  const e = sim.economy;
  const p = lastPeriod(sim);
  if (!p) return null;
  const rate = p.net / (p.minutes * 60);
  return { rate, perHour: rate * 3600, horizon: 3600, projected: e.money + rate * 3600 };
}

// tickPassengers : ré-export (le parcours passagers vit dans sim/passengers.mjs).
Object.defineProperty(__exports, 'tickPassengers', { get() { return __ns('m_src_sim_passengers').tickPassengers; }, enumerable: true });

__exports.FUEL_COST_PER_PAX = FUEL_COST_PER_PAX;
__exports.PAX_REVENUE = PAX_REVENUE;
__exports.PAX_REVENUE_DRY = PAX_REVENUE_DRY;
__exports.DUTYFREE_PER_PAX = DUTYFREE_PER_PAX;
__exports.LANDING_FEE = LANDING_FEE;
__exports.GATE_FEE = GATE_FEE;
__exports.DEBT = DEBT;
__exports.LOAN = LOAN;
__exports.TREASURY = TREASURY;
__exports.canAfford = canAfford;
__exports.charge = charge;
__exports.earn = earn;
__exports.onGateArrived = onGateArrived;
__exports.onGateDeparted = onGateDeparted;
__exports.onFlightCancelled = onFlightCancelled;
__exports.tickEconomy = tickEconomy;
__exports.treasuryAlerts = treasuryAlerts;
__exports.ensureLoan = ensureLoan;
__exports.loanState = loanState;
__exports.takeLoan = takeLoan;
__exports.resumeAfterBankruptcy = resumeAfterBankruptcy;
__exports.checkBankruptcy = checkBankruptcy;
__exports.periodStatement = periodStatement;
__exports.PERIOD_S = PERIOD_S;
__exports.closePeriod = closePeriod;
__exports.lastPeriod = lastPeriod;
__exports.forecast = forecast;
})(__reg['m_src_economy_economy']);

/* --- module src/sim/incidents.mjs --- */
(function (__exports) {
// Incidents opérationnels limités (BL-14, NONMVP-3, AC20/A-7) : 3 incidents,
// PAS une collection de pannes (A-7) :
//   runway  : fermeture d'UNE PISTE — les atterrissages sur CETTE piste
//             patientent (retard mesurable), les départs continuent ; l'AUTRE
//             piste reste utilisable (R32 : la fermeture est ATTACHÉE à la
//             piste, pas globale) ; réouverture = reprise (récupération).
//   fuel    : panne d'UNE STATION carburant — les lances de CETTE station
//             tombent en panne : départ SÉC si elle seule sert la porte
//             (billets moitiés, événement no-fuel, NON bloquant) ; une AUTRE
//             station continue de servir (R32 : la panne est ATTACHÉE à la
//             station, la voisine reste ACTIVE) ; service revenu → plein normal.
//   surge   : pic DEMANDE — le planificateur double sa cadence (plus de vols
//             planifiés) ; la satisfaction ne perd RIEN directement : la
//             pénalité du pic, S'IL Y EN A UNE, vient des files (R34 : le pic
//             qui sature se paie dans le module unique des files, pas dans un
//             second module — pas de perte directe qui se « compense »
//             artificiellement avec la récupération constante) ; fin du pic →
//             la cadence revient.
//   weather : incident MÉTÉO (T3, t_9b665a8b) — BIAISÉ par l'état météo
//             (weather.mjs, LA table WEATHER_EFFECTS.incident) : le temps
//             clair ne tire JAMAIS (p = 0), l'orage tire souvent (p = 0,7) ;
//             pendant qu'il est ACTIF, les effets météo sont majorés à la
//             ligne « orage » (weatherEffect — la règle unique lue par
//             aircraft.mjs : retards d'arrivées + capacité piste réduite).
// R32 : un incident = UN OBJET { id, type, asset, remaining, severity, cause }
// ATTACHÉ à un ACTIF (une piste, une station) — l'actif est l'id de l'actif ;
// « la fréquence dépend de l'usure ou d'une table bornée » : la table bornée
// (fenêtres) reste le cœur, l'usure de la porte (R29) BIAISE le tirage (plus
// usé → plus de risque, borné) — l'exposition DÉBUT DE PARTIE reste bornée
// (aucun incident forcé, le 1er tirage n'arrive qu'après 240 s de sim).
// Chaque incident suit le cycle exigé : perturb → réaction (comportement de la
// sim) → conséquence mesurée → récupération (état renversé, mesurable).
// Déterminisme : tiré par le rng SEMÉ de la sim (makeSimRng) → la suite des
// incidents est reproductible à la reprise (EV-10), comme les vols.
// ponytail : les incidents par actif vivent dans sim.incidents.runways/fuels
// (id d'actif → enregistrement) + un compteur d'horloge global ; un incident
// d'actif SUPPRIMÉ est PURGÉ à chaque tick (ensureIncidents) + au chargement
// (pas de référence orpheline). Upgrade : table de gravité par type si le jeu
// veut des incidents plus variés.
const { pushEvent } = __ns('m_src_core_sim-state');
const { charge } = __ns('m_src_economy_economy');
const { weatherOf, WEATHER_EFFECTS, WEATHER_FR } = __ns('m_src_sim_weather');

// T2-1 (t_d5da994c) : la table est EXPORTÉE — la couche de difficulté
// (core/difficulty.mjs) ÉCHELONNE ces fenêtres par profil (× incidentScale) ;
// les tests la comparent au référentiel. Valeurs inchangées (référentiel).
const INCID = Object.freeze({
  RUNWAY_EVERY_S: 900,   // tirage « fermeture piste » toutes les ~15 min sim
  RUNWAY_CLOSE_S: 120,   // durée de la fermeture (les atterrissages patientent)
  FUEL_EVERY_S: 720,     // tirage « panne station » toutes les ~12 min sim
  FUEL_OUT_S: 90,        // durée de la panne (départ sec pendant la panne)
  SURGE_EVERY_S: 240,    // tirage « pic de demande » toutes les ~4 min sim
  SURGE_S: 90,           // durée du pic (la cadence est DOUBLÉE pendant le pic)
  // R32 : l'usure BIAISE la fréquence — plus un terminal est usé (portes
  // cleaning+maintenance, R29), plus un incident d'actif s'y déclenche vite
  // (le 1er tirage reste borné : il n'arrive QU'APRÈS la 1re fenêtre).
  WEAR_BIAS: 0.5,        // p = P0 × (1 + usure/100 × WEAR_BIAS) (borne ≤ P0×3)
  // R33 : l'intervention PAYANTE termine l'incident IMMÉDIATEMENT (vs la
  // réponse passive « attendre », gratuite mais les effets continuent jusqu'à
  // la fin naturelle). Montants bornés : ~1 indemnité de vol annulé (500 $),
  // pas un goulot financier (START_FUNDS 12 000 inchangé).
  INTERVENE_RUNWAY_COST: 600, // réouverture immédiate d'une piste fermée
  INTERVENE_FUEL_COST: 450,   // remise en service immédiate d'une station
  // T3 (t_9b665a8b) : l'incident MÉTÉO — fenêtre de tirage BORNÉE (× scale) ;
  // le tirage lui-même est BIAISÉ par l'état météo (WEATHER_EFFECTS.incident,
  // weather.mjs — LA table : 0 par temps clair, 0,7 par orage).
  WEATHER_EVERY_S: 480,      // tirage « incident météo » toutes les ~8 min sim
  WEATHER_OUT_S: 240,       // durée de l'incident météo (effets majorés)
  INTERVENE_WEATHER_COST: 750, // T3 : intervention MÉTÉO (effets ramenés immédiatement à l'état météo)
});

// État des incidents sur la sim (sérialisable seul — sans état dérivé) :
// les compteurs de tirage vivent ici ; la sérialisation est donc directe.
// R32 : + les incidents ATTACHÉS à un actif :
//   i.runways = { [pisteId]: { id, type, asset, remaining, severity, cause } }
//   i.fuels   = { [stationId]: { id, type, asset, remaining, severity, cause } }
// La purge des actifs SUPPRIMÉS (démo, terminal détruit) se fait ICI
// (appelée à chaque tick + au chargement) → PAS de référence orpheline.
function ensureIncidents(sim) {
  let i = sim.incidents;
  if (!i || typeof i !== 'object') i = sim.incidents = {}; // R41 : re-attach (sauvegarde pré-R32 : champ ABSENT ; sans ça l'état est construit sur un local jeté, jamais persisté sur sim.incidents)
  i.runway = i.runway || { closed: 0, acc: 0, last: 0 }; // horloge globale (survies)
  i.fuel = i.fuel || { out: 0, acc: 0, last: 0 };
  i.surge = i.surge || { active: false, remaining: 0, acc: 0, last: 0 };
  i.weather = i.weather || { active: false, remaining: 0, acc: 0, last: 0 }; // T3 : incident MÉTÉO (biaisé par l'état météo)
  i.runways = i.runways || {}; // R32 : fermeture PISTE par id de piste
  i.fuels = i.fuels || {};     // R32 : panne STATION par id de station
  purgeOrphanIncidents(sim, i);
  return i;
}

// R32 : un incident attaché à un actif SUPPRIMÉ (démo, terminal détruit) est
// PURGÉ : son actif n'existe plus → la référence serait orpheline (la sim
// regarderait une piste/panne qui n'est plus là). La purge est idempotente
// (testée) et sans effet si l'actif existe.
function purgeOrphanIncidents(sim, i) {
  const infra = sim.infra;
  if (!infra) return;
  // ponytail : les clés d'objet JS sont des CHAÎNES (i.runways["12"]) alors que
  // les ids de bâtiments sont des NOMBRES — on normalise en chaînes des DEUX
  // côtés, sinon l'orpin check delete le record qu'on vient de créer.
  const runwayIds = new Set((infra.runways || []).map((r) => String(r.id)));
  const fuelIds = new Set((infra.services || []).filter((s) => s.type === 'fuel').map((s) => String(s.id)));
  if (i.runways) for (const k of Object.keys(i.runways)) if (!runwayIds.has(k)) delete i.runways[k];
  if (i.fuels) for (const k of Object.keys(i.fuels)) if (!fuelIds.has(k)) delete i.fuels[k];
  // L'actif disparu avec sa panne : le flag local `fuelOut` ne survit plus
  // (la station n'existe plus — le champ n'a plus de porteur).
  if (infra.services) for (const s of infra.services) if (s.type === 'fuel' && !fuelIds.has(String(s.id))) s.fuelOut = undefined;
}

// R32 : choisir l'ACTIF qui porte l'incident. La fréquence est une table
// bornée (fenêtres ci-dessus) ; le CIBLE est déterministe : la piste/la
// station du terminal le PLUS USÉ (portes cleaning+maintenance, R29) — plus
// usé → l'incident y frappe (l'exposition débUT de partie reste bornée : le
// 1er tirage n'arrive qu'APRÈS la 1re fenêtre, pas avant). Égalité → id le
// plus petit (déterminisme). Sans infra → le 1er actif.
function wearOfTerminal(sim, tid) {
  let w = 0;
  for (const g of sim.infra.gates || []) if (g.terminalId === tid) w += (g.cleaning || 0) + (g.maintenance || 0);
  return w;
}
function pickRunwayTarget(sim) {
  const rws = sim.infra.runways || [];
  if (!rws.length) return null;
  // ponytail : une piste n'a pas d'usure propre — on la relie au terminal le
  // plus usé (proximité d'exposition) ; borne simple, pas de modèle d'usure piste.
  let best = rws[0], bw = -1;
  for (const r of rws) {
    const tid = r.terminalId ?? sim.infra.terminals[0]?.id;
    const w = tid ? wearOfTerminal(sim, tid) : 0;
    if (w > bw || (w === bw && r.id < best.id)) { best = r; bw = w; }
  }
  return best.id;
}
function pickFuelTarget(sim) {
  const sts = (sim.infra.services || []).filter((s) => s.type === 'fuel' && !s.fuelOut);
  if (!sts.length) return null;
  let best = sts[0], bw = -1;
  for (const s of sts) {
    const w = s.target != null ? wearOfTerminal(sim, s.target) : 0;
    if (w > bw || (w === bw && s.id < best.id)) { best = s; bw = w; }
  }
  return best.id;
}
// R32 : l'incident = UN OBJET attaché à son ACTIF { id, type, asset, remaining,
// severity, cause } — lisible (la cause est le motif) + borné (remaining).
function startRunwayIncident(sim, i, rwId, cause, rng) {
  const rec = { id: `inc-rw-${i._seq = (i._seq || 0) + 1}`, type: 'runway', asset: rwId,
    remaining: INCID.RUNWAY_CLOSE_S, severity: 'major', cause };
  i.runways[rwId] = rec;
  i.runway.last = sim.time ?? 0; // calendrier (fréquence bornée, pas de pile)
  pushEvent(sim, { kind: 'runway-closed', runway: rwId, why: cause });
}
function startFuelIncident(sim, i, stId, cause) {
  const rec = { id: `inc-fuel-${i._seq = (i._seq || 0) + 1}`, type: 'fuel', asset: stId,
    remaining: INCID.FUEL_OUT_S, severity: 'major', cause };
  i.fuels[stId] = rec;
  i.fuel.last = sim.time ?? 0;
  const svc = (sim.infra.services || []).find((s) => s.id === stId);
  if (svc) svc.fuelOut = true; // R28 : le flag local marque la station HS (les lances tombent)
  pushEvent(sim, { kind: 'fuel-out', station: stId, why: cause });
}

// Le battement incidents (appelé par tick.mjs, APRÈS le planificateur).
// Chaque incident : compteurs cumulés → tirage (rng semé) → cible ACTIF → fin.
// L'EFFET vit chez les modules concernés (aircraft.mjs regarde la fermeture
// PISTE par id, doRefuel la panne STATION par id, tickPlanner surge.active).
function tickIncidents(sim, dt, rng) {
  if (!rng) rng = () => 0; // déterministe : sans rng semé, aucun tirage (pas d'incident)
  const i = ensureIncidents(sim);
  // T2-1 (t_d5da994c) : la DIFFICULTÉ (paramètre de spawn, sim.difficulty —
  // core/difficulty.mjs) ÉCHELONNE les FENÊTRES de tirage : le mécanisme est
  // inchangé (même cadence par fenêtre, même tirage rng semé, mêmes cibles,
  // mêmes effets) — seule la fenêtre change (× incidentScale). Sauvegarde
  // PRÉ-T2-1 (sim.difficulty absente) → ×1 : le référentiel normal, intact.
  const scale = (sim.difficulty && sim.difficulty.incidentScale) || 1;

  // 1) FERMETURE PISTE (R32 : ATTACHÉE à UNE piste) : le compte à rebours de
  //    CHAQUE piste ferme finit → réouverture (récupération, mesurée).
  for (const rwId of Object.keys(i.runways)) {
    const rec = i.runways[rwId];
    rec.remaining = Math.max(0, rec.remaining - dt);
    if (rec.remaining === 0) {
      delete i.runways[rwId];
      pushEvent(sim, { kind: 'runway-reopen', runway: rwId, why: 'piste de nouveau ouverte' });
    }
  }
  if (Object.keys(i.runways).length === 0) {
    i.runway.acc += dt; // cadence : UN tirage par fenêtre (pas une loterie par tick)
    if (i.runway.acc >= INCID.RUNWAY_EVERY_S * scale) {
      i.runway.acc = 0;
      if (rng() < 0.5) {
        const rwId = pickRunwayTarget(sim);
        if (rwId != null) startRunwayIncident(sim, i, rwId, 'fermeture piste (contrôle) — atterrissages en attente', rng);
      }
    }
  }

  // 2) PANNE STATION CARBURANT (R32 : ATTACHÉE à UNE station ; la voisine reste
  //    ACTIVE) : le compte à rebours de CHAQUE station HS finit → service reviu.
  for (const stId of Object.keys(i.fuels)) {
    const rec = i.fuels[stId];
    rec.remaining = Math.max(0, rec.remaining - dt);
    if (rec.remaining === 0) {
      // stId est une CHAÎNE (clé d'objet) ; l'id de service est un NOMBRE —
      // comparaison normalisée (sinon la station « revenue » garde fuelOut=true).
      const svc = (sim.infra.services || []).find((s) => String(s.id) === stId);
      if (svc) svc.fuelOut = false; // la station repart (les lances sont de nouveau servies)
      delete i.fuels[stId];
      pushEvent(sim, { kind: 'fuel-back', station: stId, why: 'station carburant de nouveau en service' });
    }
  }
  if (Object.keys(i.fuels).length === 0) {
    i.fuel.acc += dt;
    if (i.fuel.acc >= INCID.FUEL_EVERY_S * scale) {
      i.fuel.acc = 0;
      if (rng() < 0.5) {
        const stId = pickFuelTarget(sim);
        if (stId != null) startFuelIncident(sim, i, stId, 'panne station carburant — départs secs');
      }
    }
  }

  // 3) PIC DE DEMANDE : l'effet est lu par le planificateur (cadence doublée).
  //    R34 : la satisfaction ne perd RIEN directement pendant le pic — la
  //    pénalité du pic, S'IL Y EN A UNE, vient UNIQUEMENT des files
  //    (sim/passengers.mjs, module unique de vérité : saturation → perte,
  //    files vides → récupération). L'ancienne perte directe (0,5 %/s) se
  //    « compensait » artificiellement avec la récupération constante quand
  //    les files restaient vides (pic absorbé) : le pic payé même bien géré.
  if (i.surge.active) {
    i.surge.remaining -= dt;
    if (i.surge.remaining <= 0) {
      i.surge.active = false;
      pushEvent(sim, { kind: 'surge-end', why: 'pic de demande terminé — cadence normale' });
    }
  } else {
    i.surge.acc += dt;
    if (i.surge.acc >= INCID.SURGE_EVERY_S * scale) {
      i.surge.acc = 0;
      if (rng() < 0.5) {
        i.surge.active = true;
        i.surge.remaining = INCID.SURGE_S;
        i.surge.last = sim.time ?? 0;
        pushEvent(sim, { kind: 'surge-start', why: 'pic de demande — plus de vols planifiés' });
      }
    }
  }

  // 4) INCIDENT MÉTÉO (T3) : le tirage de fenêtre est BIAISÉ par l'ÉTAT MÉTÉO
  //    (WEATHER_EFFECTS.incident, weather.mjs — LA table) : le temps clair ne
  //    tire JAMAIS (p = 0 — pas d'incident météo quand il fait beau), l'orage
  //    tire souvent (p = 0,7). Pendant qu'il est ACTIF, les effets météo sont
  //    majorés à la ligne « orage » (weatherEffect — la règle unique lue par
  //    aircraft.mjs : retards d'arrivées + capacité piste réduite) ; fin →
  //    les effets reviennent à l'état météo courant (récupération mesurée).
  if (i.weather.active) {
    i.weather.remaining = Math.max(0, i.weather.remaining - dt);
    if (i.weather.remaining === 0) {
      i.weather.active = false;
      pushEvent(sim, { kind: 'weather-incident-end', why: 'incident météo terminé — effets revenus à l’état météo courant' });
    }
  } else {
    i.weather.acc += dt;
    if (i.weather.acc >= INCID.WEATHER_EVERY_S * scale) {
      i.weather.acc = 0;
      const st = weatherOf(sim);
      const p = WEATHER_EFFECTS[st].incident;
      if (p > 0 && rng() < p) {
        i.weather.active = true;
        i.weather.remaining = INCID.WEATHER_OUT_S;
        i.weather.last = sim.time ?? 0;
        pushEvent(sim, { kind: 'weather-incident-start', state: st, why: `incident météo (${WEATHER_FR[st]}) — retards d’arrivées + capacité piste réduite` });
      }
    }
  }
}

// Le planificateur regarde le pic : cadence doublée (une fenêtre = 2 vols).
function isSurge(sim) {
  return ensureIncidents(sim).surge.active;
}

// R28/R32 : les pannes de CARBURANT sont PAR STATION — l'incident est ATTACHÉ
// à la station (`i.fuels[stationId]` + le flag local `svc.fuelOut`). Une panne
// d'UNE station la met HS (ses lances tombent) ; les AUTRES stations restent
// actives. La fermeture de PISTE est de même ATTACHÉE à la piste
// (`i.runways[runwayId]`) : l'AUTRE piste reste utilisable.
//  - fuelOut(sim) : au moins UNE station carburant est-elle en panne ? (lecture
//    globale, utilisée par le planificateur/le HUD) — le comportement local
//    (doRefuel) regarde `fuelOutStation(sim, lanceId)` via svc.fuelOut.
//  - fuelOutStation(sim, stationId) : UNE station précise est-elle en panne ?
//  - runwayClosed(sim, runwayId?) : CETTE piste est-elle fermée ? (sans id :
//    au moins UNE piste fermée — lecture globale).
// L'incident par station se force via forceIncident(sim, 'fuel:<stationId>');
// la fermeture de piste via forceIncident(sim, 'runway:<runwayId>') ou 'runway'
// (la 1re piste). L'état et le calendrier (compteurs acc/last) survivent à la
// reprise (sérialisable), la purge des orphelins se fait au chargement.
// ponytail : la panne locale est un FLAG + enregistrement (pas de modèle
// d'usure de la station elle-même) ; la fréquence est biaisée par l'usure du
// terminal le plus usé (pickRunwayTarget/pickFuelTarget), bornée.
function fuelOutStation(sim, stationId) {
  const svc = sim.infra.services.find((s) => s.id === stationId);
  return !!(svc && svc.fuelOut);
}

// Lecture GLOBALE : au moins UNE station carburant est-elle en panne ?
// (planificateur = risque « départ sec » ; HUD = affichage). Le plein local
// regarde la STATION précise via svc.fuelOut (R28) — une panne d'UNE station
// ne rend pas les AUTRES stations inactives.
function fuelOut(sim) {
  const i = ensureIncidents(sim);
  return Object.values(i.fuels).some((f) => f && f.remaining > 0);
}

// T3 : l'incident MÉTÉO est-il ACTIF ? (l'état est lu par weatherEffect,
// weather.mjs — la règle unique ; le panneau diagnostic affiche l'incident +
// ses réponses). Lecture seule (pas d'ensure : le champ est créé au 1er
// tickIncidents/forceIncident — guardé, jamais de crash).
function weatherIncidentActive(sim) {
  const i = sim && sim.incidents;
  const w = i && i.weather;
  return !!(w && w.active && w.remaining > 0);
}

// La piste regarde la fermeture (doApproach/doHolding, aircraft.mjs) : aucun
// atterrissage sur CETTE piste tant qu'elle est fermée (l'AUTRE reste utilisable,
// R32). Sans id : au moins UNE piste fermée (lecture globale planificateur/HUD).
function runwayClosed(sim, runwayId) {
  const i = ensureIncidents(sim);
  if (runwayId == null) return Object.values(i.runways).some((r) => r && r.remaining > 0);
  const rec = i.runways[runwayId];
  return !!(rec && rec.remaining > 0);
}

// Forçage DETERMINISTE d'un incident (tests + débogage UI) : met l'état à la
// position voulue + événement (le compteur de fin démarre, la fin est normale).
// R32 : l'incident est ATTACHÉ à un ACTIF — 'runway'/'runway:<id>' ferme UNE
// piste (l'autre reste utilisable), 'fuel'/'fuel:<id>' met UNE station en
// panne (la voisine reste active). Sans id : la cible est DÉRIVÉE de l'usure
// (pickRunwayTarget/pickFuelTarget — le 1er actif le plus exposé), déterministe.
function forceIncident(sim, which) {
  const i = ensureIncidents(sim);
  if (which === 'runway' || (typeof which === 'string' && which.startsWith('runway:'))) {
    const rwId = which === 'runway' ? pickRunwayTarget(sim) : Number(which.slice(7));
    if (rwId == null || !(sim.infra.runways || []).some((r) => r.id === rwId)) {
      throw new Error(`piste inconnue : ${which}`);
    }
    startRunwayIncident(sim, i, rwId, 'fermeture piste (forçage) — atterrissages en attente');
  } else if (which === 'fuel' || (typeof which === 'string' && which.startsWith('fuel:'))) {
    const stId = which === 'fuel' ? pickFuelTarget(sim) : Number(which.slice(5));
    if (stId == null || !(sim.infra.services || []).some((s) => s.id === stId && s.type === 'fuel')) {
      throw new Error(`station inconnue : ${which}`);
    }
    startFuelIncident(sim, i, stId, `panne STATION ${stId} (forçage) — ses lances sont hors service`);
  } else if (which === 'surge') {
    i.surge.active = true;
    i.surge.remaining = INCID.SURGE_S;
    i.surge.last = sim.time ?? 0;
    pushEvent(sim, { kind: 'surge-start', why: 'pic de demande (forçage) — plus de vols planifiés' });
  } else if (which === 'weather') { // T3 : incident MÉTÉO (forçage déterministe)
    i.weather.active = true;
    i.weather.remaining = INCID.WEATHER_OUT_S;
    i.weather.last = sim.time ?? 0;
    pushEvent(sim, { kind: 'weather-incident-start', state: weatherOf(sim), why: 'incident météo (forçage) — retards d’arrivées + capacité piste réduite' });
  } else {
    throw new Error(`incident inconnu : ${which}`);
  }
}

// R33 (t_11a4e241) : DEUX réponses opérationnelles par incident —
//   passive   : gratuite, aucun effet jusqu'à la fin NATURELLE de l'incident
//               (le joueur attend, les effets continuent — c'est le choix).
//   coûteuse  : débite un coût (intervention) OU consomme une ressource
//               (allègement du planning : les vols planifiés sont refusés,
//               leur revenu est perdu) — l'effet est IMMÉDIAT.
// Les CONSÉQUENCES sont lues AVANT décision (incidentResponse, lecture pure
// — l'UI les affiche dans le panneau diagnostic, pas de mutation). L'action
// NE PEUT PAS ÊTRE RÉPÉTÉE pour cumuler artificiellement les effets : une
// intervention FINIT le record (2e appel → motif, aucune mutation) ; un
// allègement refuse TOUS les vols planifiés (2e appel → plus rien à
// refuser). Aucune 3e option : les deux réponses offrent déjà un vrai
// arbitrage (argent vs temps, revenu vs files) — une 3e serait un faux choix.
// which : 'runway:<pisteId>' | 'fuel:<stationId>' | 'surge' | 'weather'
// (sans id : l'actif unique en incident est dérivé ; plusieurs actifs touchés
// → id explicite).

function resolveIncident(sim, which) {
  const i = ensureIncidents(sim);
  const m = typeof which === 'string' && which.includes(':');
  const type = m ? which.slice(0, which.indexOf(':')) : which;
  const assetKey = m ? which.slice(which.indexOf(':') + 1) : null;
  if (type === 'runway') {
    const actives = Object.keys(i.runways).filter((k) => i.runways[k] && i.runways[k].remaining > 0);
    const key = assetKey ?? (actives.length === 1 ? actives[0] : null);
    if (!key || !i.runways[key] || i.runways[key].remaining <= 0)
      return { ok: false, reason: actives.length > 1 ? 'plusieurs pistes fermées — préciser la cible (runway:<id>)' : 'aucune piste en fermeture' };
    return { ok: true, type, key };
  }
  if (type === 'fuel') {
    const actives = Object.keys(i.fuels).filter((k) => i.fuels[k] && i.fuels[k].remaining > 0);
    const key = assetKey ?? (actives.length === 1 ? actives[0] : null);
    if (!key || !i.fuels[key] || i.fuels[key].remaining <= 0)
      return { ok: false, reason: actives.length > 1 ? 'plusieurs stations en panne — préciser la cible (fuel:<id>)' : 'aucune station en panne' };
    return { ok: true, type, key };
  }
  if (type === 'surge') {
    if (!i.surge.active || i.surge.remaining <= 0) return { ok: false, reason: 'aucun pic de demande' };
    return { ok: true, type: 'surge' };
  }
  if (type === 'weather') { // T3 : l'incident MÉTÉO (unique — pas d'actif)
    if (!i.weather.active || i.weather.remaining <= 0) return { ok: false, reason: 'aucun incident météo' };
    return { ok: true, type: 'weather' };
  }
  return { ok: false, reason: `incident inconnu : ${which}` };
}

// LECTURE (UI) : les deux réponses + leurs CONSÉQUENCES, avant décision.
// Aucune mutation — le panneau peut l'appeler à chaque rendu.
function incidentResponse(sim, which) {
  const t = resolveIncident(sim, which);
  if (!t.ok) return { ok: false, reason: t.reason };
  const i = ensureIncidents(sim);
  if (t.type === 'runway') {
    const rec = i.runways[t.key];
    return {
      ok: true, type: 'runway', asset: Number(t.key), remaining: Math.ceil(rec.remaining),
      responses: [
        { id: 'wait', name: 'Attendre (gratuit)', cost: 0,
          effect: `les atterrissages patientent ${Math.ceil(rec.remaining)} s jusqu'à la réouverture naturelle` },
        { id: 'intervene', name: "Intervention d'urgence", cost: INCID.INTERVENE_RUNWAY_COST,
          effect: `réouverture IMMÉDIATE de la piste — plus d'attente (coût ${INCID.INTERVENE_RUNWAY_COST} $)` },
      ],
    };
  }
  if (t.type === 'fuel') {
    const rec = i.fuels[t.key];
    return {
      ok: true, type: 'fuel', asset: Number(t.key), remaining: Math.ceil(rec.remaining),
      responses: [
        { id: 'wait', name: 'Attendre (gratuit)', cost: 0,
          effect: `départs secs (billets moitiés) pendant ${Math.ceil(rec.remaining)} s jusqu'au retour du service` },
        { id: 'intervene', name: "Intervention d'urgence", cost: INCID.INTERVENE_FUEL_COST,
          effect: `station de nouveau ACTIVE immédiatement — pleins normaux (coût ${INCID.INTERVENE_FUEL_COST} $)` },
      ],
    };
  }
  if (t.type === 'weather') { // T3 : l'incident MÉTÉO (les effets sont majorés à la ligne « orage » tant qu'il est ACTIF)
    return {
      ok: true, type: 'weather', remaining: Math.ceil(i.weather.remaining),
      responses: [
        { id: 'wait', name: 'Attendre (gratuit)', cost: 0,
          effect: `effets majorés (orage) pendant ${Math.ceil(i.weather.remaining)} s jusqu'à la fin naturelle — retards + capacité réduite` },
        { id: 'intervene', name: "Intervention d'urgence", cost: INCID.INTERVENE_WEATHER_COST,
          effect: `effets ramenés IMMÉDIATEMENT à l’état météo courant (coût ${INCID.INTERVENE_WEATHER_COST} $)` },
      ],
    };
  }
  const n = (sim.planning || []).filter((e) => e.status === 'planned').length;
  return {
    ok: true, type: 'surge', remaining: Math.ceil(i.surge.remaining),
    responses: [
      { id: 'absorb', name: 'Absorber le pic (gratuit)', cost: 0,
        effect: `le pic continue ${Math.ceil(i.surge.remaining)} s — la cadence reste doublée ; s'il sature les files, la satisfaction baisse (sinon rien)` },
      { id: 'relief', name: 'Allègement du planning', cost: 0,
        effect: `refuser les ${n} vol(s) planifié(s) (leur revenu est perdu) — les files d'arrivée se vident` },
    ],
  };
}

// COMMANDE (la sim règle, l'UI émet l'intention) : appliquer la réponse.
// Motif lisible si l'action est impossible — PAS de mutation partielle
// (la résolution ET la vérification précèdent TOUTE écriture).
function respondIncident(sim, which, response) {
  const t = resolveIncident(sim, which);
  if (!t.ok) return { ok: false, reason: t.reason };
  const i = ensureIncidents(sim);
  if (t.type === 'runway') {
    if (response === 'wait') return { ok: true, effect: 'attente — réouverture naturelle (aucun coût)' };
    if (response !== 'intervene') return { ok: false, reason: `réponse inconnue : ${response}` };
    charge(sim, INCID.INTERVENE_RUNWAY_COST, 'intervention');
    delete i.runways[t.key]; // la fin NORMALE (tickIncidents) ne se rejoue pas — l'incident EST terminé
    pushEvent(sim, { kind: 'runway-reopen', runway: Number(t.key), why: `intervention — réouverture immédiate (payante, ${INCID.INTERVENE_RUNWAY_COST} $)` });
    return { ok: true, effect: `piste ${t.key} réouverte immédiatement (coût ${INCID.INTERVENE_RUNWAY_COST} $)` };
  }
  if (t.type === 'fuel') {
    if (response === 'wait') return { ok: true, effect: 'attente — retour du service (aucun coût)' };
    if (response !== 'intervene') return { ok: false, reason: `réponse inconnue : ${response}` };
    charge(sim, INCID.INTERVENE_FUEL_COST, 'intervention');
    const svc = (sim.infra.services || []).find((s) => String(s.id) === t.key && s.type === 'fuel');
    if (svc) svc.fuelOut = false; // la station repart (la fin normale le ferait au compte à rebours)
    delete i.fuels[t.key];
    pushEvent(sim, { kind: 'fuel-back', station: t.key, why: `intervention — station de nouveau en service (payante, ${INCID.INTERVENE_FUEL_COST} $)` });
    return { ok: true, effect: `station ${t.key} de nouveau active (coût ${INCID.INTERVENE_FUEL_COST} $)` };
  }
  if (t.type === 'weather') { // T3 : l'intervention termine l'incident (les effets reviennent à l'état météo courant)
    if (response === 'wait') return { ok: true, effect: 'attente — fin naturelle de l’incident météo (aucun coût)' };
    if (response !== 'intervene') return { ok: false, reason: `réponse inconnue : ${response}` };
    charge(sim, INCID.INTERVENE_WEATHER_COST, 'intervention');
    i.weather.active = false;
    i.weather.remaining = 0; // la fin NORMALE (tickIncidents) ne se rejoue pas — l'incident EST terminé
    pushEvent(sim, { kind: 'weather-incident-end', why: `intervention — effets ramenés immédiatement à l’état météo courant (payant, ${INCID.INTERVENE_WEATHER_COST} $)` });
    return { ok: true, effect: 'incident météo terminé — effets revenus à l’état météo courant (coût 750 $)' };
  }
  // surge : allègement du planning = refuser TOUS les vols planifiés (la
  // ressource consommée est leur revenu — l'action ne se répète PAS : après,
  // il ne reste plus de vol « planned » à refuser).
  if (response === 'absorb') return { ok: true, effect: 'pic absorbé (aucune action)' };
  if (response !== 'relief') return { ok: false, reason: `réponse inconnue : ${response}` };
  const refused = (sim.planning || []).filter((e) => e.status === 'planned');
  if (!refused.length) return { ok: false, reason: 'plus de vol à refuser — le planning est déjà allégé (action non répétable)' };
  sim.planning = sim.planning.filter((e) => e.status !== 'planned');
  pushEvent(sim, { kind: 'planning-relief', count: refused.length, why: `allègement du planning — ${refused.length} vol(s) planifié(s) refusé(s) (revenu perdu)` });
  return { ok: true, effect: `${refused.length} vol(s) planifié(s) refusé(s) — files d'arrivée allégées` };
}

__exports.INCID = INCID;
__exports.ensureIncidents = ensureIncidents;
__exports.tickIncidents = tickIncidents;
__exports.isSurge = isSurge;
__exports.fuelOutStation = fuelOutStation;
__exports.fuelOut = fuelOut;
__exports.weatherIncidentActive = weatherIncidentActive;
__exports.runwayClosed = runwayClosed;
__exports.forceIncident = forceIncident;
__exports.incidentResponse = incidentResponse;
__exports.respondIncident = respondIncident;
})(__reg['m_src_sim_incidents']);

/* --- module src/progression/campaign.mjs --- */
(function (__exports) {
// T2-2 (t_6344db94) — CAMPAGNE DE VICTOIRE : un but global DÉCLARÉ et
// MESURABLE dans l'état sim (règle R21 : pas de compteur « réputation » —
// la victoire est une DÉCISION du joueur, lue dans l'état, jamais un
// compteur abstrait). Cohérente avec OBJECTIFS R22 (récompense payée UNE
// fois, événement pushEvent, affichage panneau), quality.mjs et tiers.mjs
// (palier 3 QUALITÉ : tenir un contrat qualité avant l'échéance) :
//   VICTOIRE = les 3 contrats de la saison réglés RÉUSSIS (le cycle complet
//   light → regular → qualité — la ROTATION des modèles R24/R25) AVANT
//   l'échéance de la saison (CAMPAIGN.deadline, secondes de sim).
//   ÉCHEC    = l'échéance dépassée avec moins de 3 succès.
// Le champ vit sur la SIM (sim.campaign — sérialisé avec l'état entier par
// save.mjs, pattern intro.mjs : il REPREND après sauvegarde/rechargement).
// Un contrat RÉUSSI incrémente `wins` (countCampaignWin, appelé par le
// règlement unique des contrats — contracts.mjs, jamais ailleurs).
// LA RÈGLE est décidée par tickCampaign (la sim), pas par l'UI : le panneau
// est une LECTURE (campaignView). La récompense passe par earn (compte
// revenue dédié — comptabilisable) ; faillite → aucun paiement (R22 : une
// sim en faillite ne paie aucun objectif).
const { earn } = __ns('m_src_economy_economy');
const { pushEvent } = __ns('m_src_core_sim-state');

const CAMPAIGN = Object.freeze({
  id: 'season',
  name: 'La saison du tycoon',
  // 3 contrats réussis = le cycle complet des paliers (tiers.mjs : light →
  // regular → QUALITÉ — le palier 3 est LA victoire, la mesure est la même
  // que la règle R24/R25 du contrat : vols + pax + ponctualité avant fin de
  // période, réglés UNE fois sur mesure de PÉRIODE).
  target: 3,
  // L'échéance de SAISON : 3 h de sim (10 800 s). Les 3 périodes de contrats
  // à fond (1800 + 2400 + 3000 s) laissent ~1 h de marge pour 1-2 échecs —
  // la victoire est ATTEIGNABLE en jeu normal, et ÉCHOUABLE (échéance).
  deadline: 10800,
  // La PRIME de saison : payée UNE fois à la victoire (compte revenue dédié).
  reward: 2500,
});

// États possibles (bornés — le panneau et les tests lisent cette enum).
const CAMPAIGN_STATUSES = Object.freeze(['active', 'won', 'lost']);

function fresh() {
  return {
    status: 'active',
    wins: 0,            // contrats RÉUSSIS (countCampaignWin, règlement unique)
    rewardPaid: false,  // la prime est payée UNE fois (jamais double, R22)
    endedAt: null,      // horodatage de fin (sim.time) — gagné ou perdu
  };
}

// Initialisation paresseuse + RÉPARATION défensive (pattern R31/R32 : un
// champ présent mais au mauvais format est reconstruit — jamais de crash).
// Sauvegarde PRÉ-T2-2 : le champ est ABSENT → campagne FRAÎCHE (la saison
// démarre à la première exécution du tick).
function ensureCampaign(sim) {
  const c = sim.campaign;
  const ok = c && typeof c === 'object'
    && CAMPAIGN_STATUSES.includes(c.status)
    && Number.isInteger(c.wins) && c.wins >= 0
    && (c.rewardPaid === true || c.rewardPaid === false)
    && (c.endedAt === null || Number.isFinite(c.endedAt));
  if (!ok) sim.campaign = fresh();
  return sim.campaign;
}

// UN contrat réglé RÉUSSI (appelé par settle, le règlement unique des
// contrats — jamais un autre appelant) : la victoire compte les SUCCÈS de
// contrat, pas un compteur de temps. Un contrat manqué/annulé ne compte
// PAS (la mesure est le critère, R24).
function countCampaignWin(sim) {
  const c = ensureCampaign(sim);
  if (c.status !== 'active') return; // saison terminée : plus de décompte
  c.wins += 1;
}

// LA RÈGLE de la campagne (tick, après tickContracts — le règlement des
// contrats vient d'avoir lieu) :
//   VICTOIRE : les `target` contrats réussis AVANT l'échéance, hors faillite
//   (R22 : faillite → aucun objectif payé) → la prime est créditée
//   ATOMIQUEMENT (status + flag + earn dans la même écriture) + l'événement
//   « campaign-won » (toast/juice/sfx). Idempotent : `rewardPaid` verrouille
//   la prime — des ticks suivants ne re-creditent PAS.
//   ÉCHEC : l'échéance dépassée avec moins de succès → status « lost » +
//   l'événement « campaign-lost ». La partie CONTINUE (la campagne est un
//   but, pas un game-over — comme les objectifs R22).
function tickCampaign(sim) {
  const c = ensureCampaign(sim);
  if (c.status !== 'active') return;
  if (c.wins >= CAMPAIGN.target && !sim.economy.bankrupt) {
    if (!c.rewardPaid) {
      c.status = 'won';
      c.rewardPaid = true;
      c.endedAt = sim.time;
      earn(sim, CAMPAIGN.reward, 'campaign'); // la prime (compte revenue dédié)
      pushEvent(sim, { kind: 'campaign-won', name: CAMPAIGN.name, wins: c.wins,
                       target: CAMPAIGN.target, deadline: CAMPAIGN.deadline,
                       reward: CAMPAIGN.reward });
    }
    return;
  }
  if (sim.time >= CAMPAIGN.deadline && c.wins < CAMPAIGN.target) {
    c.status = 'lost';
    c.endedAt = sim.time;
    pushEvent(sim, { kind: 'campaign-lost', name: CAMPAIGN.name, wins: c.wins,
                     target: CAMPAIGN.target, deadline: CAMPAIGN.deadline });
  }
}

// LECTURE seule (panneau) : l'état de la saison + la mesure live (succès /
// objectif, temps restant, la prime) — le panneau ne décide rien.
function campaignView(sim) {
  const c = ensureCampaign(sim);
  const left = Math.max(0, CAMPAIGN.deadline - (sim.time ?? 0));
  return {
    status: c.status,
    wins: c.wins,
    target: CAMPAIGN.target,
    deadline: CAMPAIGN.deadline,
    left: c.status === 'active' ? left : 0,
    reward: CAMPAIGN.reward,
    rewardPaid: c.rewardPaid,
    name: CAMPAIGN.name,
    endedAt: c.endedAt,
    // Texte lisible (affiché par le panneau).
    text: c.status === 'won'
      ? `gagnée — ${c.wins} contrats réussis, prime ${CAMPAIGN.reward} $`
      : c.status === 'lost'
        ? `échouée — ${c.wins}/${CAMPAIGN.target} contrats avant l'échéance`
        : `${c.wins}/${CAMPAIGN.target} contrats réussis — ${left} s avant l'échéance`,
  };
}

__exports.CAMPAIGN = CAMPAIGN;
__exports.CAMPAIGN_STATUSES = CAMPAIGN_STATUSES;
__exports.ensureCampaign = ensureCampaign;
__exports.countCampaignWin = countCampaignWin;
__exports.tickCampaign = tickCampaign;
__exports.campaignView = campaignView;
})(__reg['m_src_progression_campaign']);

/* --- module src/progression/stats.mjs --- */
(function (__exports) {
// T2-2 (t_6344db94) — STATS PERSISTANTES de la partie : pax totaux,
// bénéfice, plus longue série de périodes sans déficit, incidents survivus.
// Le champ vit sur la SIM (sim.stats — sérialisé avec l'état entier par
// save.mjs, pattern intro.mjs : il REPREND après sauvegarde/rechargement ;
// une sauvegarde PRÉ-T2-2 n'a pas le champ → il est créé paresseusement,
// sans crash, sans fausse reprise de compteurs).
// RÈGLE DE L'ÉQUIPE : JAMAIS DE SECOND COMPTEUR PARALLÈLE — les mesures
// « live » LISENT les compteurs existants (pax = sim.passengers.totalCarried,
// bénéfice = les comptes cumulés de l'économie), seuls les faits NOUVEAUX
// (une période close, un incident terminé) sont enregistrés ici, UNE fois,
// sur leur SEUL déclencheur (le tick — jamais par l'UI).
//   - Série sans déficit : une période CLOSE nette ≥ 0 prolonge la série,
//     une période nette < 0 la remet à 0 (lastPeriod / periodStatement sont
//     LA mesure, economy.mjs).
//   - Incidents survivus : une transition N → M < N d'incidents ACTIFS
//     (piste fermée / station en panne / pic — incidents.mjs) = N−M
//     incidents TERMINÉS = N−M incidents SURVIVUS (le jeu a continué).
const { lastPeriod } = __ns('m_src_economy_economy');

// Nombre d'incidents ACTIFS (lecture seule, incidents.mjs est la source) :
// chaque piste FERMÉE (remaining > 0) + chaque station EN PANNE (remaining >
// 0) + le pic (surge) actif + l'incident MÉTÉO (T3). Un incident « survécu »
// = un actif qui a REPRIS (remaining → 0) ou le pic/l'incident météo qui est
// passé — le JEU a continué.
function activeIncidentCount(sim) {
  const i = sim.incidents || {};
  let n = 0;
  for (const r of Object.values(i.runways || {})) if (r && r.remaining > 0) n += 1;
  for (const f of Object.values(i.fuels || {})) if (f && f.remaining > 0) n += 1;
  if (i.surge?.active) n += 1;
  if (i.weather?.active && i.weather.remaining > 0) n += 1; // T3 : l'incident MÉTÉO
  return n;
}

function fresh() {
  return {
    nonDeficit: { current: 0, best: 0 }, // périodes CONSECUTIVES net ≥ 0
    incidentsSurvived: 0,   // incidents qui se sont TERMINÉS (le jeu a tenu)
    periodsClosed: 0,       // périodes closes depuis le début de la partie
    lastPeriodAt: null,     // horodatage de la dernière période close (détect.)
    prevIncidents: null,    // précédent nombre d'actifs (détect. des transitions)
  };
}

// Initialisation paresseuse + RÉPARATION défensive (pattern R31/R32 : un
// champ présent mais au mauvais format est reconstruit — jamais de crash ;
// les compteurs de stats se PERDENT proprement, comme les incidents purgeés).
// À la CRÉATION, ADOPTION de la baseline : une période DÉJÀ close (sauvegarde
// PRÉ-T2-2 rechargée) est NOTÉE comme « déjà vue » — la série se compte à
// partir de la PROCHAINE période close, pas un fait réinventé ; sur une sim
// FRAÎCHE (aucune période close), rien n'est à adopter (le 1er close compte).
function ensureStats(sim) {
  const s = sim.stats;
  const ok = s && typeof s === 'object'
    && s.nonDeficit && typeof s.nonDeficit === 'object'
    && Number.isInteger(s.nonDeficit.current) && s.nonDeficit.current >= 0
    && Number.isInteger(s.nonDeficit.best) && s.nonDeficit.best >= 0
    && (Number.isInteger(s.incidentsSurvived) && s.incidentsSurvived >= 0)
    && (s.lastPeriodAt === null || Number.isFinite(s.lastPeriodAt))
    && (s.prevIncidents === null || Number.isInteger(s.prevIncidents));
  if (!ok) {
    const f = fresh();
    const lp = lastPeriod(sim);
    if (lp && Number.isFinite(lp.at)) f.lastPeriodAt = lp.at; // adoption
    f.prevIncidents = activeIncidentCount(sim); // baseline des transitions
    sim.stats = f;
    return sim.stats;
  }
  if (!Number.isInteger(s.periodsClosed) || s.periodsClosed < 0) s.periodsClosed = 0;
  return s;
}

// UNE période close (appelée par le tick sur sa SEULE détection) : la série
// sans déficit se prolonge (net ≥ 0) ou se rompt (net < 0) — LA mesure est
// le net de la période (periodStatement), jamais un compteur de temps.
function notePeriodClose(sim, p) {
  const st = ensureStats(sim);
  st.nonDeficit.current = (p.net ?? 0) >= 0 ? st.nonDeficit.current + 1 : 0;
  st.nonDeficit.best = Math.max(st.nonDeficit.best, st.nonDeficit.current);
}

// LE tick stats (après tickEconomy — la période close vient d'avoir lieu) :
//   1. DÉTECTION d'une période close : l'horodatage `at` de la DERNIÈRE
//      période a changé (l'array est borné MAX_PERIODS : la détection par
//      longueur serait Fausse au-delà — l'horodatage est la mesure unique).
//      L'adoption de la baseline (sauvegarde PRÉ-T2-2) est faite à la
//      CRÉATION (ensureStats), jamais ici : une fois le champ posé, toute
//      nouvelle période close EST comptée.
//   2. TRANSITIONS d'incidents : N actifs → M < N = N−M incidents survivus
//      (comptés UNE fois sur la transition — jamais par l'UI).
function tickStats(sim) {
  const st = ensureStats(sim);
  const lp = lastPeriod(sim);
  if (lp && Number.isFinite(lp.at) && lp.at !== st.lastPeriodAt) {
    notePeriodClose(sim, lp);
    st.periodsClosed += 1;
    st.lastPeriodAt = lp.at;
  }
  const n = activeIncidentCount(sim);
  if (st.prevIncidents === null) {
    st.prevIncidents = n; // baseline (1er tick d'un champ créé « vide »)
  } else if (n < st.prevIncidents) {
    st.incidentsSurvived += st.prevIncidents - n;
    st.prevIncidents = n;
  } else {
    st.prevIncidents = n;
  }
}

// BÉNÉFICE CUMULÉ de la partie (mesure live des comptes — pas un 2e
// compteur) : la SOMME des mêmes comptes que periodStatement.net, sur
// TOUS les compteurs cumulés depuis le début (recettes + principal
// emprunté − dépenses − intérêts du compte dédié `debt`, R12/R35) :
// l'identité trésorerie EV-9 tient (money = START + recettes − dépenses
// − dette), la faillite N'ÉTEINT PAS les compteurs (R35) → le bénéfice
// est CUMULÉ sur toute la partie.
function profitOf(sim) {
  const e = sim.economy || {};
  const rev = Object.values(e.revenue || {}).reduce((a, b) => a + (b || 0), 0);
  const spent = Object.values(e.spent || {}).reduce((a, b) => a + (b || 0), 0);
  const loan = e.loan && Number.isFinite(e.loan.principal) ? e.loan.principal : 0; // R35
  return rev + loan - spent - (e.debt || 0); // intérêts = le compte dédié (R12)
}

// LECTURE seule (panneau) : les stats persistantes + les mesures live
// (pax = le compteur EXISTANT totalCarried, bénéfice = profitOf) — le
// panneau ne recalcule rien, il affiche (la sim est la source).
function statsView(sim) {
  const st = ensureStats(sim);
  return {
    paxTotal: sim.passengers?.totalCarried ?? 0, // compteur EXISTANT (lecture)
    profit: Math.round(profitOf(sim)),
    nonDeficit: { current: st.nonDeficit.current, best: st.nonDeficit.best },
    incidentsSurvived: st.incidentsSurvived,
    periodsClosed: st.periodsClosed,
  };
}

__exports.activeIncidentCount = activeIncidentCount;
__exports.ensureStats = ensureStats;
__exports.tickStats = tickStats;
__exports.profitOf = profitOf;
__exports.statsView = statsView;
})(__reg['m_src_progression_stats']);

/* --- module src/ui/bankruptcy.mjs --- */
(function (__exports) {
// R35 (t_dabe90d7) — ÉCRAN de FAILLITE EXPLICITE : la sim est stoppée
// (economy.bankrupt, le tick rentre par l'entrée). L'écran affiche le BILAN
// (economy.periodStatement — lecture, zéro règle) et les 3 issues :
//   REPRENDRE : la sim continue depuis le bilan (resumeAfterBankruptcy lève
//     le flag — la sim décide, l'UI émet l'intention, UI FINE) ;
//   NOUVELLE PARTIE : retour menu (le wiring existe, main.mjs startNewGame) ;
//   (la sauvegarde de l'état est déjà automatique — l'UI ne la redécide pas).
// Pattern intro.mjs (R20) : DOM factice en test Node, les boutons réels
// (souris + clavier) pointent vers les COMMANDES de sim / le menu.
const { periodStatement, loanState, resumeAfterBankruptcy } = __ns('m_src_economy_economy');

const money = (n) => `${Math.round(n)} $`;

// Zone de contenu reconstruite seulement quand la signature change (pattern
// panels.mjs : les éléments ne disparaissent pas sous la souris).
function makeBankruptcyScreen(state, parent = document.body, actions = {}) {
  const card = document.createElement('div');
  card.className = 'bankruptcy';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Faillite — bilan et décisions');
  const title = document.createElement('h4');
  title.textContent = 'FAILLITE — les caisses sont vides';
  const body = document.createElement('div');
  body.className = 'bankruptcy-statement';
  const btns = document.createElement('div');
  btns.className = 'bankruptcy-actions';
  const btnResume = document.createElement('button');
  btnResume.className = 'tool';
  btnResume.textContent = 'Reprendre la partie';
  const btnNew = document.createElement('button');
  btnNew.className = 'tool';
  btnNew.textContent = 'Nouvelle partie (retour au menu)';
  btns.append(btnResume, btnNew);
  card.append(title, body, btns);
  parent.appendChild(card);
  card.style.display = 'none';

  // Les ACTIONS sont injectables (test Node : on vérifie que la commande de sim
  // est émise ; produit : main.mjs branche le vrai startNewGame du menu).
  const onResume = actions.onResume || (() => {
    if (state.sim) resumeCommand(state.sim);
  });
  const onNewGame = actions.onNewGame || (() => { /* main.mjs : startNewGame */ });

  let sig = '';
  function paint() {
    const sim = state.sim;
    body.replaceChildren();
    if (!sim) return;
    const s = periodStatement(sim);
    const row = (label, value, cls = '') => {
      const d = document.createElement('div');
      d.className = 'kv' + (cls ? ` kv--${cls}` : '');
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('span');
      v.textContent = value;
      d.append(k, v);
      body.appendChild(d);
    };
    row('Solde', money(s.money), s.money < 0 ? 'bad' : '');
    row('Résultat (bilan)', money(s.net), s.net < 0 ? 'bad' : '');
    row('Recettes', money(s.revenue));
    row('Dépenses (explo + carburant + indemnités + investissements)',
      money(s.opex + s.fuel + s.compensation + s.invest), 'bad');
    if (s.debt > 0) row('Dette (intérêts)', money(s.debt), 'bad');
    const ls = loanState(sim);
    row('Emprunt disponible', ls.available
      ? `${money(ls.netLiquidity)} après intérêts (${money(ls.principal)} − ${money(ls.interest)})`
      : `obtenu (${ls.count}/${ls.max}) — borne atteinte`, ls.available ? '' : 'warn');
    if (s.causes.length) row('Causes du déficit', s.causes.join(' ; '), 'warn');
    const note = document.createElement('p');
    note.textContent = 'Reprendre : la simulation continue depuis ce bilan (le solde négatif continue de s\'aggraver sans redressement). Nouvelle partie : tout repart (le solde, la dette, l\'emprunt).';
    body.appendChild(note);
  }

  // Appelé à chaque frame (bus 'frame') : l'écran s'ouvre UNIQUEMENT quand la
  // sim est en faillite (le flag est l'état de la sim — l'UI ne le décide pas),
  // et se referme sur « Reprendre » (flag levé) ou « Nouvelle partie » (menu).
  const screen = {
    refresh: () => {
      const open = state.screen === 'game' && state.sim && state.sim.economy.bankrupt;
      card.style.display = open ? '' : 'none';
      if (open) {
        const sim = state.sim;
        const s = periodStatement(sim);
        const l = loanState(sim);
        const ns = JSON.stringify([s.net, s.money, s.debt, s.loan, s.causes, l.available]);
        if (ns !== sig) { sig = ns; paint(); }
      } else {
        sig = '';
      }
    },
  };
  btnResume.addEventListener('click', onResume);
  btnNew.addEventListener('click', onNewGame);
  screen.refresh();
  return screen;
}

// La COMMANDE de reprise (exposée pour le wiring de main.mjs : l'UI émet
// l'intention, la sim règle — UI FINE).
__exports.resumeCommand = resumeAfterBankruptcy;

__exports.makeBankruptcyScreen = makeBankruptcyScreen;
})(__reg['m_src_ui_bankruptcy']);

/* --- module src/ui/juice.mjs --- */
(function (__exports) {
// Juice (t_5065be95) — feedback visuel léger du jeu canvas.
// UI fine : zéro règle de sim (LECTURE SEULE), module pur testable Node —
// le canvas n'est touché que dans draw(), le DOM jamais (le CSS fait les
// animations, ce module fait les DÉCLENCHEMENTS).
//   - particules : construction (éclats), panne (rafales), objectif payé ;
//   - nombres flottants : € gagnés (atterrissage / départ / objectif / emprunt)
//     et perdus (construction, démolition) — montants LUS sur la sim ;
//   - shake d'écran : incident majeur (piste coupée, station en panne, faillite)
//     ; appliqué par le renderer en translate du monde (le HUD reste stable) ;
//   - animations légères des panneaux (entrées/sorties) : machine à états makeFx
//     (testée) ; le code appelant applique les classes CSS .fx-enter/.fx-exit.
// Les particules/valeurs vivent en COORDONNÉES MONDE (suivent la caméra) ;
// le shake est en pixels écran.

const { LANDING_FEE, GATE_FEE, PAX_REVENUE, PAX_REVENUE_DRY } = __ns('m_src_economy_economy');

const COLORS = Object.freeze({ gain: '#66bb6a', loss: '#ef5350', info: '#e0e0e0' });
const BURST_COLORS = Object.freeze(['#ff7043', '#ffa726', '#ffee58', '#8d6e63']); // éclats construction
const DANGER_COLORS = Object.freeze(['#ef5350', '#ff7043', '#b0bec5']); // panne / fermeture
const GOLD = Object.freeze(['#ffd54f', '#ffe082', '#fff59d']); // objectif payé
const PUFF = Object.freeze(['#cfd8dc', '#eceff1', '#b0bec5']); // atterrissage

const FLOAT_LIFE = 1.6; // s — durée de vie d'un nombre flottant
const FLOAT_RISE = 26; // px monde / s — il s'élève en s'estompant

// --- Machine à états des animations de panneaux (pure, testable) -----------
// enter(name)/exit(name) démarrent une animation ; tick(dt) la fait progresser
// ; phase()/progress() donnent son état ; cls() renvoie la classe CSS à
// appliquer (vide = rien). Le DOM applique, les tests vérifient le déclenchement.
function makeFx(dur = 0.2) {
  const anims = new Map(); // name → { phase: 'enter'|'exit'|'done', t, dur }
  const phaseOf = (name) => (anims.get(name) ? anims.get(name).phase : 'idle');
  return {
    enter: (name) => anims.set(name, { phase: 'enter', t: 0, dur }),
    exit: (name) => anims.set(name, { phase: 'exit', t: 0, dur }),
    tick: (dt) => {
      for (const a of anims.values()) {
        a.t = Math.min(a.dur, a.t + dt);
        if (a.t >= a.dur) a.phase = 'done';
      }
    },
    phase: phaseOf,
    progress: (name) => { const a = anims.get(name); return a ? a.t / a.dur : 0; },
    cls: (name) => { const p = phaseOf(name); return p === 'enter' ? 'fx-enter' : p === 'exit' ? 'fx-exit' : ''; },
    active: () => [...anims.keys()].filter((n) => ['enter', 'exit'].includes(anims.get(n).phase)),
    clear: (name) => anims.delete(name),
  };
}

// --- Système d'effets : particules + nombres + shake (coordonnées monde) ---
function makeJuice(opts = {}) {
  const maxParticles = opts.maxParticles ?? 300;
  const maxFloats = opts.maxFloats ?? 40;
  const rng = opts.rng ?? Math.random;
  const fx = makeFx(opts.fxDur ?? 0.2);
  const particles = [];
  const floats = [];
  let shake = null; // { mag, dur, t }

  function cap(arr, max, item) { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); }

  // Éclats radiaux (construction, panne, objectif) — n particules, couleurs,
  // vitesse d'éclatement (px/s), durée de vie (s, tirée aléatoirement ±50 %).
  function burst(x, y, { count = 16, colors = BURST_COLORS, spread = 90, life = 0.9 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const sp = (0.3 + 0.7 * rng()) * spread;
      const maxLife = life * (0.5 + 0.5 * rng());
      cap(particles, maxParticles, {
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: maxLife,
        maxLife,
        size: 1.5 + 2.5 * rng(),
        color: colors[(rng() * colors.length) | 0],
      });
    }
  }

  // Nombre flottant (€) — kind : 'gain' | 'loss' | 'info' (couleur).
  function float(x, y, text, kind = 'info') {
    cap(floats, maxFloats, { x, y, text, kind, life: FLOAT_LIFE, maxLife: FLOAT_LIFE });
  }

  // Feedback d'atterrissage : petite nuage au point de contact (pas de « splash »).
  function landing(x, y) { burst(x, y, { count: 12, colors: PUFF, spread: 40, life: 0.6 }); }

  // Shake d'écran (incident majeur) : re-déclenche (mag px, dur s).
  function shakeNow(mag = 10, dur = 0.6) { shake = { mag, dur, t: 0 }; }

  // Avance tout (dt temps RÉEL en s — le juice est cosmétique, il avance même
  // en pause). Appelé à chaque frame par main.mjs (bus 'frame').
  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 1.2 * dt); // frottement léger
      p.vy *= Math.max(0, 1 - 1.2 * dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.y -= FLOAT_RISE * dt;
      f.life -= dt;
      if (f.life <= 0) floats.splice(i, 1);
    }
    if (shake) shake.t = Math.min(shake.dur, shake.t + dt);
    fx.tick(dt);
  }

  // Décalage écran (px) du shake — borné à ±mag, décroissant, 0 si inactif.
  // Le renderer le traduit en ctx.translate AUTOUR du monde (pas du HUD).
  function shakeOffset() {
    if (!shake || shake.t >= shake.dur) return { x: 0, y: 0 };
    const f = 1 - shake.t / shake.dur;
    return { x: (rng() * 2 - 1) * shake.mag * f, y: (rng() * 2 - 1) * shake.mag * f };
  }

  // Rendu — appelé par le renderer (espace monde→écran ; cam {x,y,zoom}, view {width,height}).
  function draw(ctx, cam, view) {
    const toSx = (wx) => (wx - cam.x) * cam.zoom + view.width / 2;
    const toSy = (wy) => (wy - cam.y) * cam.zoom + view.height / 2;
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(toSx(p.x), toSy(p.y), p.size * cam.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.maxLife));
      const sx = toSx(f.x);
      const sy = toSy(f.y);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; // contour lisible sur n'importe quel fond
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = COLORS[f.kind] || COLORS.info;
      ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  // Lecture pour les tests / CDP (pas de règle, juste l'état du juice).
  function stats() {
    return {
      particles: particles.length,
      floats: floats.length,
      shake: !!(shake && shake.t < shake.dur),
      fx: fx.active(),
    };
  }

  return {
    burst,
    float,
    landing,
    shake: shakeNow,
    update,
    shakeOffset,
    draw,
    stats,
    fx, // la machine d'animations des panneaux (déclenchée par l'appelant)
  };
}

// Câblage alerte → effet (PURE : testé sans DOM). Positions et montants lus en
// LECTURE SEULE sur la sim ; `cam` (centre de la vue en monde) = ancre pour les
// événements sans position. « built » / « demolished » ne sont PAS ici : le
// feedback construction/démolition est câblé dans build-tool (onPlaced + branche
// démolition, qui portent les positions exactes) — un seul déclencheur par effet.
function juiceForAlert(juice, sim, alert, cam = { x: 0, y: 0 }) {
  const effects = [];
  const push = (...names) => effects.push(...names);
  const sat = sim.passengers && sim.passengers.satisfaction != null ? sim.passengers.satisfaction : 100;
  const ac = alert.volId != null ? sim.aircraft.find((a) => a.id === alert.volId) : null;
  switch (alert.kind) {
    case 'flight-in': { // atterrissage : nuage + € de l'amarrage (lis sur la sim)
      if (!ac) break;
      juice.landing(ac.x, ac.y);
      push('landing');
      const fee = Math.round((LANDING_FEE + GATE_FEE) * sat / 100);
      if (fee > 0) { juice.float(ac.x, ac.y - 24, `+${fee} $`, 'gain'); push('float'); }
      break;
    }
    case 'flight-out': { // départ : € passagers (tarif sec si départ sec, lisible via _dryDeparture)
      if (!ac) break;
      const pax = alert.pax != null ? alert.pax : ac.pax;
      const rate = ac._dryDeparture ? PAX_REVENUE_DRY : PAX_REVENUE;
      const rev = Math.round(pax * rate * sat / 100);
      if (rev > 0) { juice.float(ac.x, ac.y - 24, `+${rev} $`, 'gain'); push('float'); }
      break;
    }
    case 'runway-closed': {
      const rw = sim.infra.runways.find((r) => r.id === alert.runway);
      if (rw) { juice.burst(rw.x + rw.w / 2, rw.y + rw.h / 2, { colors: DANGER_COLORS, count: 20 }); juice.shake(); push('burst', 'shake'); }
      break;
    }
    case 'fuel-out': {
      const st = sim.infra.services.find((s) => s.id === alert.station);
      if (st) { juice.burst(st.x + st.w / 2, st.y + st.h / 2, { colors: DANGER_COLORS, count: 16 }); juice.shake(); push('burst', 'shake'); }
      break;
    }
    case 'surge-start':
    case 'treasury-critical':
      juice.shake(6, 0.4);
      push('shake');
      break;
    case 'bankrupt':
      juice.shake(16, 1.0);
      push('shake');
      break;
    case 'objective-paid':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 24 });
      juice.float(cam.x, cam.y, `+${alert.reward} $`, 'gain');
      push('burst', 'float');
      break;
    case 'loan-taken':
      juice.float(cam.x, cam.y, `+${alert.principal} $`, 'gain');
      push('float');
      break;
    // T2-2 (t_6344db94) : la campagne (victoire) + les succès (le centre de
    // l'écran — pas de position dans l'événement, comme « objective-paid »).
    case 'campaign-won':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 48 });
      juice.float(cam.x, cam.y, `+${alert.reward} $ — Saison remportée`, 'gain');
      push('burst', 'float');
      break;
    case 'campaign-lost':
      juice.burst(cam.x, cam.y, { colors: DANGER_COLORS, count: 30 });
      juice.shake(8, 0.5);
      push('burst', 'shake');
      break;
    case 'achievement-unlocked':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 24 });
      juice.float(cam.x, cam.y, `Succès : ${alert.name}`, 'gain');
      push('burst', 'float');
      break;
    // T3 (t_4c9baadc) : un événement dynamique se déclenche (signal central —
    // éclat doré, PAS de shake : un événement n'est pas une PANNE, les
    // incidents majeurs gardent le shake ; le pic touristique n'ajoute rien
    // au shake du « surge-start » s'il coïncide avec un pic en cours).
    case 'event-start':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 24 });
      juice.float(cam.x, cam.y, `Événement : ${alert.name || alert.event || ''}`, 'gain');
      push('burst', 'float');
      break;
  }
  return effects;
}

__exports.makeFx = makeFx;
__exports.makeJuice = makeJuice;
__exports.juiceForAlert = juiceForAlert;
})(__reg['m_src_ui_juice']);

/* --- module src/core/difficulty.mjs --- */
(function (__exports) {
// T2-1 (t_d5da994c) — DIFFICULTÉ : facile / normal / difficile — une COUCHE DE
// PARAMÈTRES AU SPAWN, jamais une couche de règles : les règles de la sim
// (mécanismes des incidents, OPEX/seconde, invariants de conservation EV-9)
// SONT INTACTES ; seuls les paramÈTRES DE DÉPART changent, appliqués à la
// création de la partie (makeGameState) :
//   • solde de départ        : sim.economy.money (le capital initial) ;
//   • fréquence d'incidents  : les FENÊTRES de tirage (incidents.mjs) × incidentScale
//     (la cadence, les cibles, les effets et les tirages rng sont inchangés) ;
//   • pression économique    : l'OPEX de la sim (tickEconomy) × opexFactor
//     (le OPEX_PER_SEC du catalogue est intact — le facteur est un paramètre
//      du spawn, pas une nouvelle règle de coût).
// « normal » = le RÉFÉRENTIEL (capital START_FUNDS, fenêtres ×1, OPEX ×1) :
// le comportement de référence du jeu ne bouge PAS (fixtures/tests intacts).
// Le choix VIT sur `state.difficulty` (sérialisé avec l'état entier par
// save.mjs — il survit à la sauvegarde/rechargement, comme state.intro/audio)
// et les deux facteurs du tick VIVENT sur `sim.difficulty` (le tick ne reçoit
// QUE la sim — même discipline que sim.incidents / sim.upgrades) : au chargement,
// ensureDifficulty (migration, pattern ensureLoan) replace les valeurs par
// défaut d'une sauvegarde PRÉ-T2-1 (absentes → référentiel normal, sans crash).
const { START_FUNDS } = __ns('m_src_core_sim-state');
const { INCID } = __ns('m_src_sim_incidents');
const { seasonParams } = __ns('m_src_core_seasons');

const DIFFICULTY_IDS = Object.freeze(['easy', 'normal', 'hard']);

const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    name: 'Facile',
    startFunds: START_FUNDS + 6000, // capital confort (+6 k$)
    incidentScale: 1.6, // fenêtres ×1.6 (incidents 60 % moins fréquents)
    opexFactor: 0.85,   // OPEX ×0.85 (exploitation allégée)
  }),
  normal: Object.freeze({
    name: 'Normal',
    startFunds: START_FUNDS, // le capital RÉFÉRENTIEL (inchangé)
    incidentScale: 1,        // fenêtres ×1 (la table INCID, référentiel)
    opexFactor: 1,          // OPEX ×1 (référentiel)
  }),
  hard: Object.freeze({
    name: 'Difficile',
    startFunds: 6000,            // capital maigre (la moitié du référentiel)
    incidentScale: 0.6,         // fenêtres ×0.6 (incidents plus fréquents)
    opexFactor: 1.25,           // OPEX ×1.25 (exploitation alourdie)
  }),
});

// Normalisation PURES (pattern options.mjs) : toute valeur inconnue/corrompue
// retombe au RÉFÉRENTIEL normal (une difficulté ne doit JAMAIS bloquer ni
// casser la sim — même politique que les options : repli aux défauts).
function normalizeDifficulty(raw) {
  return DIFFICULTIES[raw] ? raw : 'normal';
}

// Les fenêtres de tirage D'UNE DIFFICULTÉ (lecture pure — le tick lit cette
// même table : UNE source, pas de chiffres dupliqués). normal = la table INCID
// inchangée (référentiel) ; easy/hard = les mêmes fenêtres × l'échelle du profil.
function incidentWindows(id) {
  const p = DIFFICULTIES[normalizeDifficulty(id)];
  return Object.freeze({
    runwayEvery: INCID.RUNWAY_EVERY_S * p.incidentScale,
    fuelEvery: INCID.FUEL_EVERY_S * p.incidentScale,
    surgeEvery: INCID.SURGE_EVERY_S * p.incidentScale,
  });
}

// Migration au CHARGEMENT (pattern R27/R31/R32/R35 — ensureLoan dans save.mjs) :
// une sauvegarde PRÉ-T2-1 a `state.difficulty` ABSENT (tolérée : on replace le
// profil normal sur l'état) et `sim.difficulty` ABSENTE (on materialise le
// référentiel pour que la source soit lisible). SÉMANTIQUE : `state.difficulty`
// (le choix) est la SOURCE DE VÉRITÉ ; `sim.difficulty` (les facteurs du tick)
// DOIT y être CONSISTANT — si les deux DIVERGENT (corruption), le champ de la
// sim est resynchronisé sur le profil de l'état. Idempotente : un état PROPRE
// (les deux champs cohérents) n'est PAS TOUCHÉ (les références tiennent, pas de
// re-remplacement). Un champ ABSENT ou CORROMPU est normalisé au référentiel
// normal (le comportement d'une partie ancienne ne change PAS — comme ensureLoan).
function ensureDifficulty(state, sim) {
  const raw = (state && state.difficulty) ? state.difficulty : null;
  const id = normalizeDifficulty(raw && raw.id);
  const p = DIFFICULTIES[id];
  // state.difficulty : le choix (le profil COMPLET, sérialisé). On le remplace
  // seulement s'il est absent/corrompu/incohérent — pas un état propre.
  const stateOk = !!(raw && raw.id === id && raw.name === p.name
    && raw.startFunds === p.startFunds
    && raw.incidentScale === p.incidentScale
    && raw.opexFactor === p.opexFactor);
  if (!stateOk) {
    state.difficulty = {
      id, name: p.name, startFunds: p.startFunds,
      incidentScale: p.incidentScale, opexFactor: p.opexFactor,
    };
  }
  // sim.difficulty : les facteurs du tick (l'UI fine lit l'état, la sim lit ça).
  // Consistant = IDENTIQUE au profil de l'état ; sinon on resynchronise.
  if (sim) {
    const d = sim.difficulty;
    const simOk = !!(d && typeof d === 'object'
      && d.incidentScale === p.incidentScale
      && d.opexFactor === p.opexFactor);
    if (!simOk) {
      sim.difficulty = { incidentScale: p.incidentScale, opexFactor: p.opexFactor };
    }
  }
  return state;
}

// T3 (t_76744b22) : la COUCHE DE PARAMÈTRES DE SPAWN (s'ADDITONNE sur la
// couche difficulté, SANS MODIFIER LES RÈGLES) : la SAISON (dérivée de
// l'horloge de jeu, seasons.mjs) module la CADENCE des offres du
// planificateur (un multiplicateur lu par windowClose, flights.mjs) — même
// principe que l'incidentScale/opexFactor (des chiffres, pas une règle).
// RÉFÉRENTIEL : le printemps (jour 1, la saison de départ) est ×1 — le
// comportement d'une partie au printemps est EXACTEMENT celui d'avant
// (pas de facteur caché la première journée). Lecture pure (guardée :
// horloge absente/corrompue → printemps, comportement inchangé).
function spawnLayer(sim) {
  const p = seasonParams(sim); // { season, spawnFactor } (la table est SÉRIELLE)
  return Object.freeze({
    season: p.season,          // la saison courante (affichage « pic / creux »)
    spawnFactor: p.spawnFactor, // × sur la cadence des offres (1 = inchangé)
  });
}

__exports.DIFFICULTY_IDS = DIFFICULTY_IDS;
__exports.DIFFICULTIES = DIFFICULTIES;
__exports.normalizeDifficulty = normalizeDifficulty;
__exports.incidentWindows = incidentWindows;
__exports.ensureDifficulty = ensureDifficulty;
__exports.spawnLayer = spawnLayer;
})(__reg['m_src_core_difficulty']);

/* --- module src/flights/contracts.mjs --- */
(function (__exports) {
// R24 (t_f712f1a5) — contrats courts de compagnie : 3 modèles (faible volume,
// volume régulier, qualité exigeante). Un contrat définit période, quantité
// (vols + pax minimum), appareil, exigences (ponctualité), prime et pénalité
// plafonnée. Cycle : proposé → accepté → actif → réussi/échoué/annulé.
// L'état vit sur `sim.contracts` (sérialisé avec la sim → un règlement réglé
// reste réglé APRÈS sauvegarde + reprise ; idempotent, comme les objectifs R22).
// Compat (spec R24) : les recettes normales de vol restent leur mécanisme de
// base — le contrat ajoute SEULEMENT la prime (earn 'contract') ou la pénalité
// (charge 'contract-penalty', compte dédié : comptée MÊME EN DÉFICIT — D5).
// Aucun billet n'est payé deux fois (les pax payent PAX_REVENUE comme d'habitude).
// Les offres facultatives refusées ne coûtent rien (pas de pénalité, l'offre
// disparaît — le joueur peut rester sur une petite activité, tiers R21).
const { earn, charge } = __ns('m_src_economy_economy');
const { AIRCRAFT } = __ns('m_src_data_catalog');
// import rétrograde de src/infra/infra.mjs substitué en accès live ((__ns('m_src_infra_infra').runwayFor))
// import rétrograde de src/sim/aircraft.mjs substitué en accès live ((__ns('m_src_sim_aircraft').nominalRotation))
const { pushEvent } = __ns('m_src_core_sim-state');
const { countCampaignWin } = __ns('m_src_progression_campaign');

// Les 3 modèles (les chiffres d'équilibrage vivent ICI, comme tiers.mjs) :
// période (s de sim), quantité (vols + pax minimum cumulés sur la période),
// appareil (une taille = une compagnie, catalog.mjs), exigence de ponctualité
// (taux minimum des fins de vol « à l'heure » du contrat ; null = aucune),
// prime payée UNE fois au succès, pénalité plafonnée payée UNE fois à l'échec.
const CONTRACT_MODELS = Object.freeze([
  { id: 'light', name: 'Faible volume', airline: 'solaire', acType: 'small',
    period: 1800, flights: 3, minPax: 15, punctuality: 0.5,
    bonus: 800, penalty: 400,
    desc: '3 vols Cessna (petit) en 30 min — ≥ 15 pax et 50 % à l’heure. Prime 800 $ · pénalité 400 $.' },
  { id: 'regular', name: 'Volume régulier', airline: 'atlantique', acType: 'medium',
    period: 2400, flights: 4, minPax: 200, punctuality: 0.5,
    bonus: 1800, penalty: 800,
    desc: '4 vols A320 en 40 min — ≥ 200 pax et 50 % à l’heure. Prime 1 800 $ · pénalité 800 $.' },
  { id: 'quality', name: 'Qualité exigeante', airline: 'pacific', acType: 'large',
    period: 3000, flights: 3, minPax: 60, punctuality: 0.75,
    bonus: 3500, penalty: 1500,
    desc: '3 vols 747 (grand) en 50 min — ≥ 60 pax et 75 % à l’heure. Prime 3 500 $ · pénalité 1 500 $. Exige une piste ≥ 800 et des portes L.' },
]);
Object.freeze(CONTRACT_MODELS); // les modèles sont figés (le réglage passe par un nouveau module)

// Un premier contrat est PROPOSÉ quand l'aéroport tourne (≥ 300 pax
// transportés — condition MESURABLE, affichée à l'avance) ; ensuite chaque
// contrat réglé propose le suivant (cycle light → regular → quality → light…).
// Refus = gratuit (l'offre expire après OFFER_VALID_S sans décision, comme les
// offres de vol). L'aéroport ne force JAMAIS un engagement (tiers R21).
const CONTRACT_FIRST_PAX = 300;   // condition du 1er contrat
const CONTRACT_OFFER_VALID_S = 600; // délai de décision d'une offre (10 min sim)
const CONTRACT_REJECT_COOLDOWN_S = 900; // trêve après un refus (15 min sim) — pas de ping
const HISTORY_MAX = 8; // borné (R14) : les contrats finis restent consultables, pas sans fin

// État : initialisation paresseuse (pattern sim.punctuality / sim.objectives) —
// une sauvegarde ancienne ou une nouvelle partie n'ont pas le champ, le 1er
// tick le crée. `settled` absent (très ancienne) → false.
function ensureContracts(sim) {
  if (!sim.contracts || typeof sim.contracts !== 'object') {
    sim.contracts = { nextId: 1, offered: null, active: null, history: [] };
  }
  const c = sim.contracts;
  if (!Array.isArray(c.history)) c.history = [];
  if (c.active) c.active.settled = c.active.settled === true; // flag idempotent
  if (c.active) c.active.result = c.active.result || null;
  return c;
}

// Le contrat ACTIF (null sinon) — les opérations qui enregistrent leur contrat
// lisent leur taille ici (makeAircraft, flights.mjs).
function activeContract(sim) {
  const c = ensureContracts(sim).active;
  return c && !c.settled ? c : null;
}

// Modèle de contrat par clé (catalogue, pas de chiffres dupliqués).
function contractModel(sim, id) {
  return CONTRACT_MODELS.find((m) => m.id === (id?.model ?? id));
}

// Mesure de la période : le contrat est-il RÉUSSI à l'heure courante ? LA
// même règle que le règlement (tickContracts) — jamais deux prédictions
// divergentes (R25 : le panneau lit le verdict ici, il ne ré-impose rien).
function contractOnTrack(c, m) {
  return c.done >= m.flights && c.pax >= m.minPax
    && (m.punctuality == null || (c.ends > 0 && c.onTime / c.ends >= m.punctuality));
}

// LECTURE pour le panneau (UI fine, pattern objectiveView) : l'état + la mesure
// live (x/y vols, pax, ponctualité, temps restant) + le prochain contrat offert.
function contractView(sim) {
  const c = ensureContracts(sim);
  const view = (o) => {
    const m = CONTRACT_MODELS.find((x) => x.id === o.model);
    if (!m) return null;
    const rate = o.ends ? o.onTime / o.ends : null; // null = aucun vol fini (pas de faux chiffre, R16)
    return {
      id: o.id, model: m.id, name: m.name, airline: m.airline, acType: m.acType,
      done: o.done, flights: m.flights, pax: o.pax, minPax: m.minPax,
      onTime: o.onTime, ends: o.ends, rate, punctuality: m.punctuality,
      bonus: m.bonus, penalty: m.penalty, result: o.result,
      due: o.due, left: o.due != null ? Math.max(0, o.due - (sim.time ?? 0)) : null,
      desc: m.desc,
    };
  };
  const active = c.active ? view(c.active) : null;
  if (active) active.onTrack = contractOnTrack(c.active, CONTRACT_MODELS.find((x) => x.id === c.active.model));
  return {
    active,
    offered: c.offered ? { id: c.offered.id, model: c.offered.model,
      name: CONTRACT_MODELS.find((x) => x.id === c.offered.model).name,
      acType: CONTRACT_MODELS.find((x) => x.id === c.offered.model).acType,
      desc: CONTRACT_MODELS.find((x) => x.id === c.offered.model).desc,
      left: Math.max(0, c.offered.until - (sim.time ?? 0)) } : null,
    nextOfferAt: (c.offered || c.active || (c.cooldownUntil ?? 0) > (sim.time ?? 0)) ? null
                : CONTRACT_FIRST_PAX, // condition (pax) du prochain contrat ; null sinon
    history: c.history.slice().reverse().map(view), // les plus récents d'abord (borné)
  };
}

// R25 (t_974e6b1e) : présentation RICHE des capacités — le PANNEAU affiche
// « quel appareil / combien de sièges / et l'infra le sert-elle ? » SANS
// décider : les chiffres viennent du catalogue (AIRCRAFT) et le verdict de
// capacité réutilise le critère de COMPATIBILITÉ du planificateur (runwayFor,
// infra.mjs : piste ≥ minRunway + porte de la taille — la même règle que
// flights.servableTypes, jamais une 2e règle de sim). Le panneau ne ré-impose
// rien : il lit, la sim décide (tickContracts) ; aucun état nouveau n'est
// créé (la sauvegarde reste EXACTE : R24 persistait déjà tout l'état contrats,
// R25 n'ajoute aucun champ).
function contractCapable(sim, m) {
  const spec = AIRCRAFT[m.acType] || {};
  const runway = (__ns('m_src_infra_infra').runwayFor)(sim, spec.minRunway || 0);
  const gate = (sim.infra.gates || []).some((g) => g.size === spec.gate);
  const capable = !!runway && gate; // servable par l'infra (critère planificateur)
  // Motif lisible quand pas servable (l'offre reste possible : le joueur peut
  // investir pour servir le contrat — la décision, pas un blocage).
  const why = capable ? '' : (runway ? 'pas de porte de la taille'
    : `piste trop courte (≥ ${spec.minRunway} px)` + (gate ? '' : ' et pas de porte de la taille'));
  return { type: m.acType, name: spec.name || m.acType, seats: spec.seats || 0, capable, why };
}

// Décision du joueur (commande sim ; l'UI n'envoie que l'intention) :
// accepter → le contrat devient ACTIF (période lancée) ; refuser → GRATUIT
// (pas de pénalité, l'offre disparaît — tiers R21 « rien est toujours un choix »).
// Retourne true si la décision a eu un effet (l'offre existait), false sinon.
function decideContract(sim, id, accept) {
  const c = ensureContracts(sim);
  const o = c.offered && c.offered.id === id ? c.offered : null;
  if (!o || c.active) return false; // une offre seulement, jamais au-dessus d'un contrat actif
  if (!accept) {
    c.offered = null;
    // Le refus donne une TRÊVE (pas de ping toutes les 600 s) : le prochain
    // contrat n'est proposé qu'après le cooldown — « rester sur la petite
    // activité » est un choix réel (tiers R21), pas une impasse de refus.
    c.cooldownUntil = (sim.time ?? 0) + CONTRACT_REJECT_COOLDOWN_S;
    pushEvent(sim, { kind: 'contract-refused', model: o.model });
    return true;
  }
  const m = CONTRACT_MODELS.find((x) => x.id === o.model);
  c.offered = null;
  c.active = { id: o.id, model: o.model, started: sim.time ?? 0, due: (sim.time ?? 0) + m.period,
               done: 0, pax: 0, onTime: 0, ends: 0, settled: false, result: null };
  pushEvent(sim, { kind: 'contract-started', id: o.id, model: o.model, period: m.period });
  return true;
}

// Annulation ACTIVE du contrat (avant l'échéance, à la main du joueur) : la
// pénalité plafonnée est due UNE SEULE FOIS (le règlement est idempotent — le
// flag `settled` est posé dans la MÊME écriture que la charge, pattern R22).
// Aucune spirale : rien n'est verrouillé, le prochain contrat est proposé.
function cancelContract(sim, id) {
  const c = ensureContracts(sim);
  const a = c.active && c.active.id === id ? c.active : null;
  if (!a || a.settled) return false;
  const m = CONTRACT_MODELS.find((x) => x.id === a.model);
  settle(sim, a, 'cancelled', m.penalty); // pénalité : charge (compte dédié, même en déficit — D5)
  pushEvent(sim, { kind: 'contract-cancelled', id: a.id, model: m.id, penalty: m.penalty });
  return true;
}

// Tick (appelé par tick.mjs) : expiration d'offre non décidée (gratuit) +
// règlement à l'échéance du contrat actif (réussite → prime, insuffisance
// (volume ou ponctualité) → pénalité ; UNE SEULE FOIS, identifiant persistant).
function tickContracts(sim, dt) {
  if (sim.economy?.bankrupt) return; // la sim est stoppée (comme tickObjectives)
  const c = ensureContracts(sim);
  // Offre expirée (jamais décidée) : retirée, GRATICIEMENT — pas de pénalité,
  // le prochain contrat sera proposé selon la condition (pax ou contrat précédent réglé).
  if (c.offered && c.offered.until <= (sim.time ?? 0)) {
    pushEvent(sim, { kind: 'contract-expired', model: c.offered.model });
    c.offered = null;
  }
  // Échéance : le contrat est réglé d'après la mesure sur la période.
  if (c.active && !c.active.settled && c.active.due <= (sim.time ?? 0)) {
    const m = CONTRACT_MODELS.find((x) => x.id === c.active.model);
    const ok = contractOnTrack(c.active, m); // LA règle unique (lu aussi par le panneau)
    settle(sim, c.active, ok ? 'success' : 'failed', ok ? null : m.penalty);
  }
  // Prochain contrat : un contrat réglé (ou refusé/expiré, plus de place) ouvre
  // le suivant dès que la condition du 1er est remplie (l'activité est réelle)
  // et la trêve post-refus (cooldownUntil) est dépassée.
  if (!c.offered && !c.active && (sim.passengers?.totalCarried ?? 0) >= CONTRACT_FIRST_PAX
      && (c.cooldownUntil ?? 0) <= (sim.time ?? 0)) {
    const model = CONTRACT_MODELS[c.history.length % CONTRACT_MODELS.length];
    c.offered = { id: 'c' + (c.nextId++), model: model.id,
                  at: sim.time ?? 0, until: (sim.time ?? 0) + CONTRACT_OFFER_VALID_S };
    pushEvent(sim, { kind: 'contract-offered', id: c.offered.id, model: model.id });
  }
}

// Le règlement : prime (earn) ou pénalité (charge) posés DANS LA MÊME ÉCRITURE
// que les flags `settled`/`result` — jamais deux fois (l'état est sérialisé,
// l'id persiste après la reprise). La pénalité passe par `charge` : un compte
// dédié (spent.contract-penalty), compté MÊME EN DÉFICIT (D5) — le solde peut
// devenir négatif, la faillite reste atteignable (checkBankruptcy).
function settle(sim, c, result, penalty) {
  if (c.settled) return; // idempotent : déjà réglé (reprise, double tick)
  c.settled = true;
  c.result = result;
  const m = CONTRACT_MODELS.find((x) => x.id === c.model);
  if (result === 'success') {
    earn(sim, m.bonus, 'contract'); // prime (compte revenue.contract)
    countCampaignWin(sim); // T2-2 : un contrat RÉUSSI compte pour la saison
  } else if (penalty != null) charge(sim, penalty, 'contract-penalty');
  const s = ensureContracts(sim);
  s.active = null;
  s.history.push({ ...c });
  if (s.history.length > HISTORY_MAX) s.history.splice(0, s.history.length - HISTORY_MAX); // borné
  pushEvent(sim, { kind: result === 'success' ? 'contract-success' : 'contract-failed',
                  id: c.id, model: m.id, done: c.done, pax: c.pax,
                  reward: result === 'success' ? m.bonus : penalty });
}

// Fin de vol (départ OU annulation) : si l'avion ENREGISTRE le contrat actif
// (ac.contractId, posé au déploiement — flights.mjs), sa fin compte pour la
// période du contrat (vols, pax, ponctualité — la même règle « à l'heure » que
// R17 : retard cumulé ≤ rotation nominale ; une annulation compte NON ponctuel,
// comme la statistique R17). Appelé par logFlightEnd (aircraft.mjs) — le point
// de passage UNIQUE des fins de vol : jamais deux compteurs parallèles.
function countContractFlight(sim, ac, cancelled) {
  const c = ensureContracts(sim);
  const a = c.active;
  if (!a || a.settled || ac.contractId !== a.id) return;
  // Le contrat ne compte QUE sa taille d'avion (modèle = une compagnie + un
  // appareil) : un contrat « qualité / 747 » n'est pas rempli par des Cessna.
  // Le joueur doit SÉRIEUSER le bon appareil (la décision est le jeu).
  const m = CONTRACT_MODELS.find((x) => x.id === a.model);
  if (m && ac.acType !== m.acType) return;
  a.ends++;
  a.pax += ac.pax ?? 0;
  if (ac.phase === 'cancelled' || cancelled) return; // annulé : vol non ponctuel (pas d'heure)
  a.done++;
  if ((ac.delayed ?? 0) <= (__ns('m_src_sim_aircraft').nominalRotation)(ac.acType)) a.onTime++;
}

__exports.CONTRACT_MODELS = CONTRACT_MODELS;
__exports.CONTRACT_FIRST_PAX = CONTRACT_FIRST_PAX;
__exports.CONTRACT_OFFER_VALID_S = CONTRACT_OFFER_VALID_S;
__exports.CONTRACT_REJECT_COOLDOWN_S = CONTRACT_REJECT_COOLDOWN_S;
__exports.ensureContracts = ensureContracts;
__exports.activeContract = activeContract;
__exports.contractModel = contractModel;
__exports.contractOnTrack = contractOnTrack;
__exports.contractView = contractView;
__exports.contractCapable = contractCapable;
__exports.decideContract = decideContract;
__exports.cancelContract = cancelContract;
__exports.tickContracts = tickContracts;
__exports.countContractFlight = countContractFlight;
})(__reg['m_src_flights_contracts']);

/* --- module src/infra/infra.mjs --- */
(function (__exports) {
// Infrastructures : pistes, taxiways, terminaux/portes, services.
// Logique pure (testable Node) : elle mutera state.sim.infra.
// Grille d'occupation 10×10 px : un segment de 200 px = 20 cellules, ça suffit
// pour « est-ce que ça empiète sur autre chose ? » et « est-ce qu'un avion peut
// poser/rouler ici ». ponytail : grille carrée simple, pas d'arborescence spatiale.
const { BUILDINGS, TERMINAL_GATE_SIZES, HANGAR_CLEAN_PER_SEC, CLEANING_RATE_PER_SEC, GROUND_SERVICE_TYPES } = __ns('m_src_data_catalog');
const { pushEvent } = __ns('m_src_core_sim-state');
const { autoAssign, ensureAssignments, countTypeServing } = __ns('m_src_infra_assignments');
const { teamRateMult } = __ns('m_src_infra_upgrades');
const { rebuildGraph, findPath, gateNodeOf, runwayExitNode } = __ns('m_src_pathfinding_path');
const { ensureIncidents, runwayClosed } = __ns('m_src_sim_incidents');

const CELL = 10;

// Recalcule la grille d'occupation à partir des bâtiments (appelé après build/demolish).
function buildGrid(sim) {
  const g = sim.infra.grid;
  g.w = 160; g.h = 120; // 1600×1200 / 10
  g.cells = new Uint8Array(g.w * g.h);
  const mark = (b) => {
    const x0 = Math.floor(b.x / CELL), y0 = Math.floor(b.y / CELL);
    const x1 = Math.floor((b.x + b.w - 1) / CELL), y1 = Math.floor((b.y + b.h - 1) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) g.cells[cy * g.w + cx] = 1;
    }
  };
  for (const r of sim.infra.runways) mark(r);
  for (const t of sim.infra.taxiways) mark(t);
  for (const t of sim.infra.terminals) mark(t);
  for (const s of sim.infra.services) mark(s);
}

// R23 (t_c992b7d6) : la DÉCISION de déverrouillage a quitté ce module — elle
// vit dans src/infra/unlocks.mjs (conditions mesurables, appelées par
// tickUnlocks) ; ce module ne FAIT QUE POSER : les conditions sont lues par
// unlockState (MÊME code du côté sim et du côté build-tool : jamais deux
// règles divergentes).
// import rétrograde de src/infra/unlocks.mjs substitué en accès live ((__ns('m_src_infra_unlocks').unlockState))

// Vérifie les conditions à chaque tick ; émet une alerte lisible par service
// débloqué (le module de règle : src/infra/unlocks.mjs).
Object.defineProperty(__exports, 'tickUnlocks', { get() { return __ns('m_src_infra_unlocks').tickUnlocks; }, enumerable: true });

// Est-ce que le rect [x,y,w,h] tient dans le terrain et n'empiète sur personne ?
function fits(sim, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > 1600 || y + h > 1200) return false;
  const g = sim.infra.grid;
  const x0 = Math.floor(x / CELL), y0 = Math.floor(y / CELL);
  const x1 = Math.floor((x + w - 1) / CELL), y1 = Math.floor((y + h - 1) / CELL);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) continue; // marge hors grille = OK
    if (g.cells[cy * g.w + cx]) return false;
  }
  return true;
}

// Place un bâtiment. Retourne le bâtiment posé, ou null si impossible (motif dans evt).
function buildBuilding(sim, type, x, y) {
  const spec = BUILDINGS[type];
  if (!spec) return null;
  // Service pas encore débloqué (condition mesurable, R23) → refus lisible.
  const st = (__ns('m_src_infra_unlocks').unlockState)(sim, type);
  if (!st.unlocked) {
    pushEvent(sim, { kind: 'locked', type, name: spec.name, why: st.why });
    return null;
  }
  if (sim.economy.money < spec.cost) {
    pushEvent(sim, { kind: 'no-funds', cost: spec.cost });
    return null;
  }
  if (!fits(sim, x, y, spec.w, spec.h)) {
    pushEvent(sim, { kind: 'build-blocked', type, x, y });
    return null;
  }
  const b = placeBuilding(sim, { id: sim.infra.nextId++, type, x, y, w: spec.w, h: spec.h, cost: spec.cost });
  // R27 (t_6424937a) : un service posé est IMMÉDIATEMENT affecté au terminal
  // le plus proche (règle déterministe du placement, autoAssign) — son effet
  // se mesurera UNIQUEMENT sur ce terminal (pas de bonus implicite global).
  if (b && GROUND_SERVICE_TYPES.includes(type)) autoAssign(sim, b);
  // R27 : un terminal NOUVEAU réactive les services dormants (posés avant
  // tout terminal, target null + auto) — ils passent inactifs → affectés
  // (motif lisible), jamais d'orphelin.
  if (b && type === 'terminal') ensureAssignments(sim);
  sim.economy.money -= spec.cost;
  // BL-15 : les CONSTRUCTIONS partent d'un compte dédié (spent.construction) —
  // le compte « fuel » est réservé à la DÉPENSE carburant des départs (A-6) :
  // un bilan qui mêle construction et carburant ne se lit plus (AC23).
  sim.economy.spent.construction = (sim.economy.spent.construction ?? 0) + spec.cost;
  pushEvent(sim, { kind: 'built', type, id: b.id });
  return b;
}

// Portes d'un terminal : petites plateformes alignées sur le bord bas, une par
// colonne. Le joueur relie chaque porte au réseau par un taxiway (sinon
// findPath renvoie null → avion « bloqué »).
function makeGates(id, b, sizes) {
  return sizes.map((size, i) => ({
    id: `${id}-g${i}`, size, terminalId: id,
    x: b.x + 25 + i * 45, y: b.y + b.h - 10, w: 40, h: 10,
    cleaning: 0, maintenance: 0,
    acId: null,
  }));
}

// Pose un bâtiment (placement + grille + graph dirty). L'argent reste à
// l'appelant : buildBuilding débite, l'aéroport de départ (new-game.mjs, A-2)
// est gratuit (fourni par le jeu).
// BL-05 (A8) : les terminaux créent leurs 4 portes sur le bord bas —
// S/M/M/L : la porte L est CONSTRUCTIBLE, les gros avions ont donc une infra
// réalisable (piste L de la grille 1000). On ne limite pas les vols L.
function placeBuilding(sim, b, gateSizes = TERMINAL_GATE_SIZES) {
  if (b.type === 'runway') { b.len = b.h; sim.infra.runways.push(b); }
  else if (b.type === 'taxiway') sim.infra.taxiways.push(b);
  else if (b.type === 'terminal') {
    // Terminal = portes alignées sur son bord bas (par défaut S/M/M/S).
    const gates = makeGates(b.id, b, gateSizes);
    b.gates = gates.map((g) => g.id);
    sim.infra.terminals.push(b);
    sim.infra.gates.push(...gates);
  }
  else sim.infra.services.push(b);
  buildGrid(sim);
  sim._graphDirty = true; // l'infra a changé → le graphe pathfinding doit être recalculé
  return b;
}

// Détruit un bâtiment. Refusé si occupé (un avion y est attaché) ou si un service
// en dépend — le brief exige un comportement lisible + testé.
function demolishBuilding(sim, id) {
  const find = (arr) => arr.find((b) => b.id === id);
  const b = find(sim.infra.runways) || find(sim.infra.taxiways) || find(sim.infra.terminals) || find(sim.infra.services);
  if (!b) return { ok: false, why: 'inconnu' };
  // Un terminal a des portes : refusé si UNE de ses portes est occupée
  // (R3, A6 : le test regardait la première porte seulement — un terminal
  // multi-portes avec la 2e occupée passait le test et était détruit).
  if (b.type === 'terminal') {
    if (sim.infra.gates.some((g) => g.terminalId === id && g.acId)) {
      return { ok: false, why: 'porte occupée' };
    }
    sim.infra.gates = sim.infra.gates.filter((g) => g.terminalId !== id);
    // les avions en attente d'une porte de ce terminal retournent en holding
    for (const ac of sim.aircraft) if (ac.gateId && ac.gateId.startsWith(`${id}-`)) ac.gateId = null;
  }
  if (b.type === 'runway' && sim.aircraft.some((a) => a.runwayId === id)) {
    return { ok: false, why: 'piste en service' };
  }
  // (R3, A7) Un avion dont le chemin PASSE PAR (ou EST SUR) le segment détruit
  // aurait un chemin périmé (indices dans l'ancien graphe, nœuds supprimés) →
  // exception au prochain tick. On remet son chemin à zéro (voir plus bas : le
  // rebuild éager le recalcule, ou le bloque proprement).
  const refund = Math.round(b.cost * BUILDINGS[b.type].sellRefund);
  sim.economy.money += refund;
  sim.economy.revenue[b.type] = (sim.economy.revenue[b.type] ?? 0) + refund;
  sim.infra.runways = sim.infra.runways.filter((x) => x.id !== id);
  sim.infra.taxiways = sim.infra.taxiways.filter((x) => x.id !== id);
  sim.infra.terminals = sim.infra.terminals.filter((x) => x.id !== id);
  // R27 (t_6424937a) : terminal supprimé → les services auto qui le servaient
  // sont RÉAFFECTÉS au terminal le plus proche RESTANT (ou inactifs s'il n'en
  // reste aucun) — motif lisible, jamais d'orphelin en silence.
  ensureAssignments(sim);
  sim.infra.services = sim.infra.services.filter((x) => x.id !== id);
  buildGrid(sim);
  // R03 (t_9dab76f4) : une démolition qui touche le graphe (segment/terminal)
  // DÉCALE les indices des nœuds — les chemins en cours pointent dans l'ANCIEN
  // graphe. On reconstruit le graphe MAINTENANT (éager, pas en différé) : le
  // recalcul (ou le blocage propre) des chemins se fait dans rebuildGraph
  // (path.mjs) → plus de chemin périmé persisté ni d'exception au prochain tick.
  if (b.type === 'taxiway' || b.type === 'runway' || b.type === 'terminal') {
    rebuildGraph(sim);
    sim._graphDirty = false;
  }
  // R32 : un incident ATTACHÉ à l'actif détruit (fermeture de piste, panne de
  // station) est PURGÉ — pas de référence orpheline (l'enregistrement
  // référencait un actif qui n'existe plus). Idempotent, sans effet sinon.
  ensureIncidents(sim);
  pushEvent(sim, { kind: 'demolished', type: b.type, id, refund });
  return { ok: true, refund };
}

// R05 (t_482d879d) : les CRITÈRES de piste/port sont CENTRALISÉS ici — la
// compatibilité (piste assez longue, porte de la bonne taille), l'occupation
// (piste/porte libre), l'ordre STABLE en égalités et le choix sont UN seul
// endroit : aircraft.mjs (atterrissage) ET flights.mjs (planification) en
// redirent la logique. Avant R05, « 1re piste compatible toujours choisie » :
// runwayFor (aircraft.mjs) ignorait l'occupation — la 2e piste libre n'était
// jamais choisie.
//
// Ordre STABLE et DÉTERMINISTE : tri sur (longueur, id). Les ids sont des
// nombres croissants (infra.nextId) → en égalité de longueur le plus ancien
// gagne, SANS dépendre de l'ordre d'insertion du tableau (Array.prototype.sort
// n'est pas stable en Node < 12 ; ici le comparateur total le rend certain).
// ponytail : l'ordre « libres en tête, puis (longueur, id) » COUVRE l'ordre
// stable en égalités demandé (l'id est le tiebreak total) — la sonde de test
// (tests/r05-runway.test.mjs) vérifie le GAIN de la 2e piste : quand la 1re
// est occupée, la 2e libre est bien choisie (et non la 1re, comme avant R05).

// Piste occupée par un AUTRE avion (AC15, A4) : atterrissage/décollage/sortie
// exclusifs sur une même piste. Deux demandes au même tick ne partagent pas la
// piste. Le cas est DÉRIVÉ des phases — aucun champ dédié (l'occupation est la
// phase). R05 : UNIQUE règle d'occupation (aircraft + les sélecteurs ci-dessous
// la partagent — la centralisation que R05 exige, au lieu d'en redire la
// logique partout).
function runwayBusy(sim, runwayId, excludeAcId) {
  return sim.aircraft.some((a) => a.id !== excludeAcId && a.runwayId === runwayId
    && ['landing', 'exit', 'departure'].includes(a.phase));
}

// Piste LIBRE pour un avion : aucune AUTRE avion ne l'occupe (A4 : exclusif).
function runwayFree(sim, rw, excludeAcId) {
  return !runwayBusy(sim, rw.id, excludeAcId);
}

// Toutes les pistes COMPATIBLES (longueur ≥ minRunway), ordonnées DETERMINISTEMENT :
// 1) libres en tête — une piste LIBRE avant une piste occupée (la règle R05
//    : la 2e piste libre est choisie si la 1re est occupée) ;
// 2) longueur croissante (la plus courte qui suffit — critère historique) ;
// 3) id croissant (égalité de longueur : le plus ancien, déterministe).
// R32 : une piste FERMÉE (incident attaché) est exclue du choix — fermer UNE
// piste sur deux laisse l'AUTRE utilisable (pickRunway/runwayFor retombent
// dessus) ; la fermeture est lue par actif (runwayClosed(sim, r.id)), pas
// globalement.
function runwayCandidates(sim, minRunway, excludeAcId = null) {
  const ok = sim.infra.runways.filter((r) => r.len >= minRunway && !runwayClosed(sim, r.id));
  return ok.sort((a, b) =>
    (runwayFree(sim, b, excludeAcId) - runwayFree(sim, a, excludeAcId))
    || (a.len - b.len)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Le CHOIX d'atterrissage (R05) : la MEILLEURE piste compatible ET LIBRE, ou
// null si toutes sont occupées. Le « d'abord la piste libre » est VÉRIFIÉ par
// la sonde de test (tests/r05-runway.test.mjs), pas par un re-calage du trafic.
function pickRunway(sim, minRunway, excludeAcId = null) {
  const cands = runwayCandidates(sim, minRunway, excludeAcId);
  return cands.length && runwayFree(sim, cands[0], excludeAcId) ? cands[0] : null;
}

// Piste compatible pour un avion : la plus courte piste qui dépasse sa longueur
// min (critère de COMPATIBILITÉ seul, SANS regard à l'occupation — le choix
// d'atterrissage est pickRunway ci-dessus).
function runwayFor(sim, minLen) {
  return runwayCandidates(sim, minLen)[0] || null;
}

// Porte JOIGNABLE au réseau : son nœud de porte EXISTE (un segment la touche)
// ET au moins UNE sortie de piste est atteignable — le MÊME critère que
// flights.hasAccessiblePath (primitives pathfinding réutilisées, pas de 2e règle).
// R18 : exporté — l'overlay réseau (ui/overlay.mjs) le réutilise tel quel :
// le diagnostic écran = le MÊME graphe et la MÊME règle que la sim.
function gateReachable(sim, gate) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  if (!sim._graph) return false;
  const to = gateNodeOf(sim, gate.id);
  if (to == null) return false; // porte hors réseau (aucun taxiway ne la touche)
  const occupied = new Set(); // « joignable » = sans conflit d'occupation
  for (const r of sim.infra.runways) {
    const from = runwayExitNode(sim, r.id);
    if (from == null) continue;
    if (findPath(sim, from, to, occupied)) return true;
  }
  return false;
}
// ponytail : gateReachable fait un findPath par piste par porte candidate (graphe
// minuscule) — OK tant que le joueur ne construit pas ~100 terminaux ; si ça
// ralentit, un cache de l'ensemble « portes joignables » par (re)buildGraph.

// Porte compatible : une porte de la bonne taille, libre, dont le terminal est intact.
// ORDRE STABLE ET DÉTERMINISTE :
// 1) une porte JOIGNABLE au réseau (taxiway) AVANT une porte déconnectée —
//    la validation R05 : « 1re porte compatible déconnectée, autre porte libre
//    connectée : choisir l'autre » (l'avion bloqué sans réseau = retard purement
//    artificiel, A1) ;
// 2) usure (cleaning+maintenance) croissante — la porte la plus propre ;
// 3) id croissant (terminalId puis index) — en égalité, le plus ANCIEN.
// La porte LIBRE (acId null ou réservée par l'avion exclu) est un pré-filtre :
// une porte réservée par UN AUTRE avion est sautée (A5).
function gateFor(sim, size, excludeAcId) {
  const free = sim.infra.gates.filter((g) => g.size === size && (!g.acId || g.acId === excludeAcId));
  if (!free.length) return null;
  free.sort((a, b) =>
    (Number(gateReachable(sim, b)) - Number(gateReachable(sim, a)))
    || ((a.cleaning + a.maintenance) - (b.cleaning + b.maintenance))
    || (a.terminalId - b.terminalId || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return free[0];
}

// R29 (t_9842f7a3) : DEBIT LIMITE + PRIORITE EXPLICITE des equipes.
// Une equipe a un debit FIXE : son budget d'intervention est PARTAGE entre
// les portes de son terminal (n equipes × taux, par tick). On ne donne PLUS
// le debit complet a chaque porte — le nettoyage existait en presence d'un
// batiment et nettoyait TOUTES les portes en meme temps (reduction globale
// gratuite, interdite par R29 : « deux portes usees avec une equipe :
// ressources partages, pas de reduction globale gratuite »).
// Regle de priorite (deterministe) : la porte LA PLUS USEE (sale + mecanique
// cumulees) d'abord, egalite → la plus ANCIENNE (id le plus petit). Le budget
// se deplace de porte en porte ; chaque porte est bornée à 0 (pas de
// dépassement) et la 2e equipe DOUBLE le debit (le delai s'amoindrit —
// « 2e equipe ameliore le delai »). L'activite mesuree (portes desservies,
// usure retiree, porte la plus usee servie) est ecrie sur sim._teamActivity
// (serialisable, l'UI la lit — « afficher usure, activite et effet attendu »).
function cleanGates(sim, dt) {
  for (const [type, field, rate] of [['cleaning', 'cleaning', CLEANING_RATE_PER_SEC],
                                     ['hangar', 'maintenance', HANGAR_CLEAN_PER_SEC]]) {
    for (const t of sim.infra.terminals) {
      const teams = countTypeServing(sim, type, t.id);
      // R31 : le debit par equipe est MULTIPLIÉ par l'amelioration « equipes »
      // DU TERMINAL (teamRateMult, upgrades.mjs) — le niveau 0 renvoie 1
      // (l'etat existant, les tests R29 inchanges).
      const rateT = rate * teamRateMult(sim, t.id);
      sim._teamActivity = sim._teamActivity || {};
      const act = (sim._teamActivity[type] = sim._teamActivity[type] || {});
      act[t.id] = { teams, gates: 0, drain: 0, servedGate: null, budget: teams * rateT * dt };
      if (!teams) continue; // aucune equipe : aucune usure ne diminue
      const worn = sim.infra.gates.filter((g) => g.terminalId === t.id && g[field] > 0);
      // Priorite : la plus usee d'abord, egalite → la plus ancienne (deterministe).
      worn.sort((a, b) => (b.cleaning + b.maintenance) - (a.cleaning + a.maintenance)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let budget = teams * rateT * dt;
      for (const g of worn) {
        if (budget <= 0) break;
        const before = g[field];
        g[field] = Math.max(0, before - budget); // bornee a 0 (pas de dépassement)
        budget = Math.max(0, budget - before);   // budget reel consomme par la porte
        act[t.id].drain += before - g[field];
        act[t.id].gates++;
        act[t.id].servedGate = g.id; // la porte la plus usee servie (UI : effet)
      }
    }
  }
}

// Est-ce qu'un bâtiment de type `need` existe (débloqué + construit) ?
function hasService(sim, type) {
  return sim.infra.services.some((s) => s.type === type);
}

__exports.buildGrid = buildGrid;
__exports.buildBuilding = buildBuilding;
__exports.placeBuilding = placeBuilding;
__exports.demolishBuilding = demolishBuilding;
__exports.runwayBusy = runwayBusy;
__exports.runwayCandidates = runwayCandidates;
__exports.pickRunway = pickRunway;
__exports.runwayFor = runwayFor;
__exports.gateReachable = gateReachable;
__exports.gateFor = gateFor;
__exports.cleanGates = cleanGates;
__exports.hasService = hasService;
})(__reg['m_src_infra_infra']);

/* --- module src/infra/unlocks.mjs --- */
(function (__exports) {
// R23 (t_c992b7d6) : les déblocages se DECIDENT ici — UN seul module de règle.
// Les anciens seuils 100–300 pax (catalog.mjs UNLOCKS) sont remplacés par des
// CONDITIONS MESURABLES dans l'état sim : le service se découvre quand le
// BESOIN existe (tiers.mjs) — jamais « pour maintenir un service verrouillé »
// (pas de dépendance circulaire : aucune condition ne fait référence à un
// service non encore débloqué).
//
//   fuel      : le carburant se débloque AVANT que le besoin se fasse sentir —
//              une offre de vol est en vue ET une période close net ≥ 0
//              (l'activité est en train de justifier le carburant, pas après).
//   cleaning  : l'usure « sale » a commencé à compter : une porte a dépassé
//              le seuil 10 (GATE_WEAR_PER_SEC, 20 s amarré : le besoin existe).
//   hangar    : l'usure mécanique a commencé à compter (g.maintenance ≥ 10).
//   baggage   : les VOLUMES justifient le débit : file check-in ≥ 90 pax
//              (75 % de la capacité 120 : le goulou de base se voit), ou
//              400 pax transportés (les volumes cumulés).
//   catering  : le confort de salle : 300 pax transportés (les volumes
//              justifient la dépense de confort ; tiers 2).
//   security  : T33 (t_88aee6d5) : la file sécurité se VOIT (≥ 96 pax =
//              80 % de la capacité) ou 600 pax transportés (filet volumes) ;
//   dutyfree  : T33 : 400 pax transportés (le commerce est justifié par les
//              volumes — tiers 2, comme catering) ;
//   lounge    : T33 : 500 pax transportés (le confort haut de gamme est
//              justifié par les volumes — tiers 2).
//
// Déclenchement : tickUnlocks (core/tick.mjs, UNE fois par tick) — le service
// se débloque au premier tick où la condition est vraie ; le build-tool et la
// sim consultent unlockState (MÊME code des deux côtés : jamais deux règles).
// L'événement « unlocked » est émis UNE fois (flag sim._unlocked, sérialisable
// → la reprise ne re-notifie pas). « locked » = condition NON remplie ;
// l'UI affiche condition + bénéfice À L'AVANCE (unlockView, tiers.mjs).
//
// Les CHIFFRES vivent dans UNLOCK_RULES (catalog.mjs) — équilibrage, pas de
// logique. L'usure porte se lit via les champs g.cleaning / g.maintenance
// (sim-state.mjs, sérialisés) ; la capacité check-in est 120 par terminal
// (passengers.mjs PAX.checkinCapPerTerminal).
const { UNLOCK_RULES } = __ns('m_src_data_catalog');
const { lastPeriod } = __ns('m_src_economy_economy');
// import rétrograde de src/sim/aircraft.mjs substitué en accès live ((__ns('m_src_sim_aircraft').punctualityStats))
const { pushEvent } = __ns('m_src_core_sim-state');
const { queueTotals } = __ns('m_src_sim_passengers');

// Capacité check-in de base (par terminal, sans service bagages).
const CHECKIN_CAP = 120;

// La condition MESURABLE de chaque service. Renvoie true ⇔ le besoin existe.
const CONDS = Object.freeze({
  fuel(sim) {
    const e = sim.economy;
    const period = (lastPeriod(sim) || { net: 0 }).net >= 0;
    const offering = sim.planning.some((p) => p.status === 'planned')
      || sim.aircraft.length > 0;
    return period && offering;
  },
  cleaning(sim) {
    return sim.infra.gates.some((g) => (g.cleaning ?? 0) >= UNLOCK_RULES.cleaning.wear);
  },
  hangar(sim) {
    return sim.infra.gates.some((g) => (g.maintenance ?? 0) >= UNLOCK_RULES.hangar.wear);
  },
  // ponytail: seuil check-in FIXE (120, 1 terminal) — le test du 2e terminal
  // ajusterait checkinCap(sim) ; upgrade si on multiplie les terminaux dans la
  // validation du tiers 2. La branche totalCarried est le filet : un aéroport
  // sans file ne se bloque jamais.
  baggage(sim) {
    const p = sim.passengers;
    // R30 : la file check-in GLOBALE = somme des files PAR TERMINAL (queueTotals,
    // agrégat de lecture — la règle de déblocage est globale, les files sont
    // per-terminal). Seuil 90 pax = 75 % de la capacité check-in (120 × nb
    // terminaux) : le goulou se voit avant le déblocage bagages.
    const over = Math.max(0, queueTotals(sim).checkin - CHECKIN_CAP * sim.infra.terminals.length);
    return over >= UNLOCK_RULES.baggage.queue
      || p.totalCarried >= UNLOCK_RULES.baggage.carried;
  },
  catering(sim) {
    return sim.passengers.totalCarried >= UNLOCK_RULES.catering.carried;
  },
  // T33 (t_88aee6d5) : 3 nouvelles règles — même motif « le besoin se voit /
  // les volumes justifient » (aucune ne référence un service verrouillé :
  // les files et le compteur totalCarried préexistent à tout service).
  security(sim) {
    // R30 : la file sécurité GLOBALE = somme des files PAR TERMINAL
    // (queueTotals, même agrégat de lecture que baggage). Seuil 96 = 80 % de
    // la capacité base (120 par terminal — PAX.securityCapPerTerminal) : le
    // goulot sécurité se voit avant le déblocage. La branche 600 pax est le
    // filet volumes (comme baggage) : un aéroport sans file ne se bloque
    // jamais.
    return queueTotals(sim).security >= UNLOCK_RULES.security.queue
      || sim.passengers.totalCarried >= UNLOCK_RULES.security.carried;
  },
  dutyfree(sim) {
    // Volumes : 400 pax transportés — le commerce au sol est justifié par
    // l'activité (tiers 2, même motif que catering).
    return sim.passengers.totalCarried >= UNLOCK_RULES.dutyfree.carried;
  },
  lounge(sim) {
    // Volumes : 500 pax transportés — le confort haut de gamme est justifié
    // par l'activité (tiers 2 ; le seuil est au-dessus de catering : un salon
    // VIP est le confort LE PLUS cher du catalogue).
    return sim.passengers.totalCarried >= UNLOCK_RULES.lounge.carried;
  },
});

// État lisible d'un service : { unlocked, why? } — le « why » est le BÉNÉFICE
// + la condition restante (l'UI l'affiche à l'avance ; UNLOCK_RULES porte les
// textes — équilibrage, pas de logique).
function unlockState(sim, service) {
  const rule = UNLOCK_RULES[service];
  if (!rule) return { unlocked: true }; // pas de règle (base, piste, terminal) : toujours
  if (sim._unlocked?.[service]) return { unlocked: true }; // déjà déclenché (flag persistant)
  if (CONDS[service](sim)) return { unlocked: true };
  return { unlocked: false, why: `${rule.benefit} — ${rule.why}` };
}

// Bascule le service au premier tick où la condition est vraie (UNIQUE appelant :
// tickUnlocks, core/tick.mjs). Événement « unlocked » UNE fois (flag persistant)
// : le BÉNÉFICE (pourquoi acheter) + la note de ponctualité (la MESURE, pas un
// compteur de temps).
function tickUnlocks(sim) {
  for (const service of Object.keys(UNLOCK_RULES)) {
    if (sim._unlocked?.[service]) continue;
    if (!CONDS[service](sim)) continue;
    sim._unlocked = sim._unlocked || {};
    sim._unlocked[service] = true;
    const rule = UNLOCK_RULES[service];
    const stat = (__ns('m_src_sim_aircraft').punctualityStats)(sim); // null = aucun vol terminé (pas de faux chiffre)
    pushEvent(sim, {
      kind: 'unlocked', service, name: rule.name,
      why: rule.benefit,
      detail: stat?.rate != null ? `ponctualité : ${Math.round(stat.rate * 100)} %` : undefined,
    });
  }
}

// Vue lisible pour l'UI (bénéfice + condition restante) — lecture SEULE, pas
// de règle. Les verrouillés : « Nom : BÉNÉFICE — condition » ; les débloqués
// : un point résumé.
function unlockView(sim) {
  const lines = [];
  const done = [];
  for (const [service, rule] of Object.entries(UNLOCK_RULES)) {
    const st = unlockState(sim, service);
    if (st.unlocked) { done.push(rule.name); continue; }
    lines.push(`${rule.name} : ${st.why}`);
  }
  if (done.length) lines.unshift(`débloqué(s) : ${done.join(', ')}`);
  if (!lines.length) lines.push('tous les services sont débloqués');
  return lines;
}

__exports.unlockState = unlockState;
__exports.tickUnlocks = tickUnlocks;
__exports.unlockView = unlockView;
})(__reg['m_src_infra_unlocks']);

/* --- module src/sim/aircraft.mjs --- */
(function (__exports) {
// Cycle avion (simulation pure, déterministe si rng/positions fixés).
// Ordre d'un vol entrant complet :
//   approach → holding (si attente) → landing → exit → taxi → docking → gate →
//   disembark → ground → board → pushback → taxi → holding → departure
//
// R04 (t_3de644b3) : cycle de réservation EXPLICITE — quand chaque ressource
// est acquise, conservée, libérée (jamais de référence périmée ni de double
// réservation) :
//   PISTE : acquise = passage en landing/exit/departure sur runwayId (l'usage
//     exclusif est DÉRIVÉ des phases — runwayBusy, jamais de champ dédié) ;
//     conservée tant que l'avion en est ; libérée = changement de phase.
//   SEGMENT : acquis = au 1er pas de chemin (doExit/doPushback : ac.seg +
//     occupied.add) ; conservé = doTaxi (à chaque avancement) ; libéré =
//     amarrage (doDocking), départ (doTaxi→departure), annulation (doBlocked),
//     chemin impossible (doExit/demolition R03 : ac.seg = null).
//   PORTE : acquise = à l'attribution (doExit : g.acId = ac.id, AVANT le taxi)
//     ; conservée = jusqu'au pushback (jamais de double réservation : une
//     porte réservée par un autre avion est sautée — A5) ; libérée = pushback,
//     annulation (si g.acId === ac.id), chemin impossible (doExit rend la
//     porte) ou suppression autorisée (démolition du terminal, refusée tant
//     qu'une porte est occupée — A6).
// Chaque avion est UN objet avec sa position monde (x,y) — visible, se déplace
// le long du réseau, jamais de téléportation (règle du brief). AC18 (A9) :
// landing converge vers l'axe de la piste sans saut, et « docking » amène
// physiquement l'avion au CENTRE de la porte (le nœud de porte n'est pas le
// centre).
// Les ressources partagées (piste, segment, porte) provoquent conflits/retards.
const { AIRCRAFT, REFUEL_TIME_S, REFUEL_TRAVEL_S_PER_1000, GATE_WEAR_PER_SEC, GATE_MAINT_PER_SEC, GATE_WEAR_DELAY_S, NOMINAL_TURNOVER_S } = __ns('m_src_data_catalog');
const { pushEvent } = __ns('m_src_core_sim-state');
const { rebuildGraph, findPath, gateNodeOf, runwayExitNode } = __ns('m_src_pathfinding_path');
const { gateFor, pickRunway, runwayBusy, runwayFor } = __ns('m_src_infra_infra');
const { servicesServingGate } = __ns('m_src_infra_assignments');
const { onGateArrived, onGateDeparted, onFlightCancelled } = __ns('m_src_economy_economy');
const { countContractFlight } = __ns('m_src_flights_contracts');
const { arrivePassengers, countCarried, boardDelay, groupComplete, removePassengers } = __ns('m_src_sim_passengers');
const { refuelTimeMult, gateOpsMult } = __ns('m_src_infra_upgrades');
const { runwayClosed } = __ns('m_src_sim_incidents');
const { weatherEffect } = __ns('m_src_sim_weather');

const V = { approach: 220, landing: 130, taxi: 60, pushback: 30, departure: 150 };
const GATE_OPS_S = 60;   // débarquement+sol+embarquement : durée d'occupation porte
const HOLDING_RETRY_S = 5; // réessayer de se placer toutes les 5 s si bloqué
const BLOCKED_CANCEL_S = 600; // 10 min sim : blocage persistant → annulation (décision A-5)
// R04 : attente en holding bornée (A-4) — la piste peut rester FERMÉE (incident
// BL-14) ou AUCUNE piste/porte compatible : un vol qui ne peut PAS atterrir
// ne tourne pas au tour indéfiniment (annulation bornée, comme le blocage
// taxi A-5, mais la CAUSE est différente et visible : « piste fermée » ou
// « pas de piste/porte compatible » — le diagnostic, pas juste un vol annulé).
const HOLDING_CANCEL_S = 600; // 10 min sim : attente d'atterrissage bornée (R04, A-4)
// BL-12 : stations carburant — UNE station = UNE LANCE (2e lance à partir de la
// 2e station : la saturation devient mesurable, critère de fin).
// R28 (t_bd681587) : la lance = LA STATION (id EXPLICITE, ac._lanceId) — la
// saturation est comptée par occupation (qui tient quelle station), pas par
// un comptage anonyme « busy < lances ».
// R17 (t_fc0d1920) : fenêtre bornée de ponctualité — la statistique ne porte
// QUE sur les N fins de vol les plus récentes (départs + annulations) : pas
// d'historique sans fin (esprit R14 : borné à la racine, pas de 2e journal),
// et la fenêtre glissante (DELAY_WINDOW_S) reste lisible sans recompte.
const PUNCTUALITY_MAX = 50;
const DELAY_WINDOW_S = 1800; // 30 min de jeu : la fenêtre glissante

// R17 : fenêtre bornée des fins de vol (sérialisable, bornée à la racine).
// Chaque entrée = la FIN d'un vol (départ ou annulation) avec son retard
// cumulé (ac.delayed, source unique de vérité — D7) et le dernier goulot
// rencontré (ac._delayCause) : c'est la statistique sur fenêtre bornée.
function ensurePunctuality(sim) {
  sim.punctuality = sim.punctuality || { recent: [] };
  if (sim.punctuality.recent.length > PUNCTUALITY_MAX) {
    sim.punctuality.recent.splice(0, sim.punctuality.recent.length - PUNCTUALITY_MAX);
  }
  return sim.punctuality;
}
// R17 : log de la FIN d'un vol (départ, doDeparture / annulation, doBlocked /
// doHolding) — début/fin des phases utiles : le « début » est le déploiement
// (sim.time du vol) et la FIN se log ici avec le retard cumulé + le goulot.
function logFlightEnd(sim, ac, cancelled) {
  const p = ensurePunctuality(sim);
  p.recent.push({
    at: sim.time || 0, id: ac.id, acType: ac.acType,
    delayed: ac.delayed || 0, cause: ac._delayCause || null, cancelled: !!cancelled,
  });
  countContractFlight(sim, ac, cancelled); // R24 : fin de vol comptée pour le contrat actif (mesure de période)
}
// Durée de rotation NOMINALE d'une taille d'avion (catalog.mjs, explicite) :
// opérations au sol (NOMINAL_TURNOVER_S) + avitaillement lié à la taille
// (spec.refuel × REFUEL_TIME_S) — l'horaire de départ prévu d'un vol suivant
// est espacé de cette durée. Un vol est PUNCTUEL si son retard cumulé (les
// attentes de goulots) ne dépasse pas cette rotation nominale.
function nominalRotation(acType) {
  const spec = AIRCRAFT[acType] || {};
  return NOMINAL_TURNOVER_S + (spec.refuel || 0) * REFUEL_TIME_S;
}
// R17 : ponctualité à dénominateur CLAIR incluant les annulations —
//   dénominateur = les fins de vol de la fenêtre (départs + annulations),
//   numérateur = les départs à l'heure (retard ≤ rotation nominale).
// Une annulation (blocage/attente bornée) compte « non ponctuel » : c'est la
// conséquence mesurée d'un retard qu'on n'a pas absorbé. null = aucun vol
// terminé dans la fenêtre (pas de faux chiffre — R16).
function punctualityStats(sim) {
  const p = ensurePunctuality(sim);
  const from = (sim.time || 0) - DELAY_WINDOW_S;
  const list = p.recent.filter((f) => f.at >= from);
  let onTime = 0, cancels = 0; const causes = {};
  for (const f of list) {
    if (f.cancelled) {
      cancels++;
      if (f.cause) causes[f.cause] = (causes[f.cause] || 0) + 1; // l'annulation EST le retard extrême : son goulot compte
      continue;
    }
    if (f.delayed <= nominalRotation(f.acType)) onTime++;
    else if (f.cause) causes[f.cause] = (causes[f.cause] || 0) + 1;
  }
  return { total: list.length, onTime, cancels,
          rate: list.length ? onTime / list.length : null, causes };
}
// Cause lisible d'un retard (R17, D7) : LECTURE pure de l'état — aucune
// mutation, aucun compteur parallèle (le retard est ac.delayed, la cause est
// ac._delayCause posée PAR le module qui retarde, jamais recalculée ici).
// La version LUE (par phase) est `causeAt` (ci-dessous) ; DELAY_CAUSE_FR la
// traduit en français pour l'UI.
const DELAY_CAUSE_FR = Object.freeze({
  piste: 'piste (fermée/occupée)', porte: 'porte (réservée/usure)',
  segment: 'segment (taxi occupé)', carburant: 'carburant (lance/panne)',
  passagers: 'passagers (file saturée)',
  meteo: 'météo (temps dégradé)', // T3 : retard FIXE d'entrée en holding par temps dégradé
});

// R17 (t_fc0d1920, D7 tranchée) : la CAUSE DU RETARD vit en TÊTE de la sim —
// les retards sont LECTURES d'état dérivé (aucun compteur dédié, aucune
// duplication avec ac.delayed, la source unique de vérité du retard). Les
// 5 goulots : piste (piste fermée/occupée — holding), porte (amarrage/ops au
// sol, y compris files passagers), segment (taxi bloqué), carburant (lance
// prise / panne station), passagers (file d'embarquement saturée). La cause
// « courante » est mémorisée (ac._delayCause, champ VOLATIL : jamais
// sérialisé — dérivée de l'état des sim au prochain tick) pour que le
// dernier goulot rencontré soit lisible dans le panneau (ui/panels.mjs) et
// les tests, sans recalc de règles côté UI.
//   noteCause(ac, cause)  : « le retard courant vient de X » (le prochain
//                            tick de retard le confirmera ou le remplacera) ;
//   causeAt(sim, ac)      : la cause LUE de la phase courante (règle pure,
//                            pas de mutation) — ce que le panneau affiche.
// « Un avion arrêté ne cumule pas 2× le même retard dans plusieurs modules »
// (D7) : chaque vol compte UN ac.delayed (seconde de jeu), et sa cause est
// lue — jamais additionnée ni dupliquée par module.
const CAUSES = Object.freeze({
  piste: 'piste', porte: 'porte', segment: 'segment', carburant: 'carburant', passagers: 'passagers',
  meteo: 'meteo', // T3
});
function noteCause(ac, cause) { ac._delayCause = CAUSES[cause]; }
function causeAt(sim, ac) {
  if (ac.phase === 'holding') {
    // doHolding (source de vérité) : attente de la PISTE — fermée (incident)
    // ou occupée (congestion, R05) : les deux sont le goulot « piste ».
    return 'piste';
  }
  if (ac.phase === 'blocked') {
    // doBlocked (source de vérité) : le chemin est coupé/occupé.
    // heading = 'gate' (arrivée) : on retente doExit — PORTE + chemin ;
    // heading = 'runway' (départ) : on retente doPushback — SEGMENT vers la
    // piste (le goulot reste le segment, la piste en visée n'est pas occupée
    // ici : le pushback part même piste occupée, seul le chemin compte).
    return ac.heading === 'gate' ? 'porte' : 'segment';
  }
  if (ac.phase === 'refuel') {
    // doRefuel (source de vérité) : attente = LANCE prise (saturation) ou
    // PANNÉ (incident) — les deux sont le goulot « carburant ».
    return 'carburant';
  }
  if (ac.phase === 'taxi' && ac.heading === 'runway' && ac.path
      && ac.pathPtr + 1 >= ac.path.length) {
    // doTaxi (source de vérité) : arrivé au bout du chemin, la piste est
    // occupée (A4) — on attend le décollage : le goulot est la PISTE.
    return 'piste';
  }
  if (ac._delayCause) return ac._delayCause; // dernier goulot mémorisé
  return null; // pas de retard actif (phase nominale ou retard inconnu)
}
// Le battement avions : avance chaque avion selon sa phase.
// Réservations exclusives (BL-03, AC15) : une occupation par segment est construite
// AVANT le tour des avions (snapshot) pour que deux avions n'entrent jamais dans le
// même segment libre au même tick (A3), puis les réservations se mettent à jour au
// déplacement de chaque avion.
function tickAircraft(sim, dt) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  const occupied = new Set();
  for (const a of sim.aircraft) if (a.seg != null) occupied.add(a.seg);

  for (const ac of sim.aircraft) {
    const spec = AIRCRAFT[ac.acType];
    switch (ac.phase) {
      case 'approach':  doApproach(sim, ac, dt, spec); break;
      case 'holding':   doHolding(sim, ac, dt, spec, occupied); break;
      case 'landing':   doLanding(sim, ac, dt, spec); break;
      case 'exit':      doExit(sim, ac, dt, spec, occupied); break;
      case 'taxi':      doTaxi(sim, ac, dt, occupied); break;
      case 'docking':   doDocking(sim, ac, dt); break;
      case 'gate':      doGate(sim, ac, dt); break;
      case 'refuel':    doRefuel(sim, ac, dt, spec); break;
      case 'disembark': doOps(sim, ac, dt); break;
      case 'ground':    doOps(sim, ac, dt); break;
      case 'board':     doOps(sim, ac, dt); break;
      case 'pushback':  doPushback(sim, ac, dt, spec, occupied); break;
      case 'departure': doDeparture(sim, ac, dt); break;
      case 'blocked':   doBlocked(sim, ac, dt, spec, occupied); break;
      default: break; // departed / cancelled : purgés par le planificateur
    }
  }
}

// APPROACH : l'avion descend vers la piste (appro). S'il n'y a pas encore de piste
// compatible, la (seule) piste compatible est FERMÉE (incident), ou si toutes
// les pistes compatibles sont occupées, il passe en holding (attente) — jamais
// de deux avions sur la même piste en même temps (conflit de ressource).
function doApproach(sim, ac, dt, spec) {
  // R05 : le CHOIX d'atterrissage est CENTRALISÉ (infra.mjs : compatibilité +
  // occupation + ordre stable) — la MEILLEURE piste compatible ET LIBRE : la 1re
  // n'est plus CHOISIE par défaut (sondée : 2e libre choisie si 1re prise).
  const rw = pickRunway(sim, spec.minRunway, ac.id);
  // T3 MÉTÉO : l'effet météo ACTIF (weatherEffect, weather.mjs — LA règle
  // unique : état courant, majoré à la ligne « orage » si l'incident météo est
  // actif) : vitesse d'approche RÉDUITE (arrivée plus lente) + retard FIXE
  // ajouté UNE FOIS à l'entrée en holding (pas de cumul — le retard d'attente
  // propre reste le += dt de doHolding).
  const wx = weatherEffect(sim);
  // BL-14 : piste FERMÉE (incident) → aucun atterrissage (le départ, lui,
  // continue) : l'avion patiente en holding, son retard s'accumule (la
  // conséquence est MESURABLE, la récupération = réouverture).
  // Aucune piste compatible / toutes occupées → HOLDING (A4), doHolding prend
  // le relais (le compteur d'attente bornée R04 ne tourne QUE sur blocage).
  if (!rw || (rw && runwayClosed(sim, rw.id))) {
    ac.phase = 'holding'; ac.timer = 0;
    if (wx.delay > 0) { ac.delayed += wx.delay; noteCause(ac, 'meteo'); } // T3 : le temps dégradé rajoute UN retard fixe à l'entrée en attente (cause « météo »)
    return;
  }
  ac.runwayId = rw.id;
  const topY = rw.y; // haut de la piste (arrivée de l'approche)
  const speed = V.approach * wx.speed * dt; // T3 : la vitesse d'approche est multipliée par le facteur météo (1 par temps clair — comportement inchangé)
  if (ac.y < topY) {
    ac.y = Math.min(topY, ac.y + speed);
  } else {
    ac.phase = 'landing'; // arrivé au haut de la piste : atterrissage
    ac.timer = 0;
  }
}

// HOLDING : l'avion tourne au-dessus de la piste en attendant qu'elle se libère.
// Les retards s'accumulent (critère 6). Aucune téléportation : il continue de
// descendre s'il est en approche, sinon il fait le tour (oscille doucement).
function doHolding(sim, ac, dt, spec, occupied) {
  // R05 : le choix d'atterrissage est CENTRALISÉ (infra.mjs) : la MEILLEURE
  // piste compatible ET LIBRE (null si toutes occupées → attente, A4).
  const rw = pickRunway(sim, spec.minRunway, ac.id);
  ac.delayed += dt;
  noteCause(ac, 'piste'); // R17 : le goulot est la PISTE (fermée ou occupée)
  // R04 (A-4) : BLOCAGE PERMANENT en holding = piste FERMÉE (incident) ou
  // AUCUNE piste compatible. Il est DIAGNOSTIQUÉ (la cause est nommée dans
  // l'événement d'annulation) et FINI par une règle bornée (HOLDING_CANCEL_S,
  // comme A-5) : pas de tournées au tour indéfiniment. La CONGESTION normale
  // (toutes les pistes compatibles OCCUPÉES) N'EST PAS un blocage : le compteur
  // reste à zéro — une attente brève ne provoque jamais d'annulation abusive.
  // (runwayFor = compatibilité SEULE, sans occupation : on distingue « aucune
  // compatible » (blocage permanent → annulation bornée) de « toutes
  // occupées » (congestion, R05 — le compteur reste à zéro).)
  // R32 : runwayFor exclut les pistes FERMÉES — « compatible mais toutes
  // fermées » est un blocage (cause « piste fermée »), distinct de « aucune
  // piste assez longue ».
  const anyCompatible = sim.infra.runways.some((r) => r.len >= spec.minRunway);
  const holdWhy = !runwayFor(sim, spec.minRunway)
    ? (anyCompatible ? 'piste fermée' : 'pas de piste assez longue')
    : null;
  if (holdWhy) {
    ac._holdBlocked = (ac._holdBlocked ?? 0) + dt;
    if (ac._holdBlocked >= HOLDING_CANCEL_S) {
      ac.phase = 'cancelled';
      removePassengers(sim, ac); // R30 : retrait EXPLICITE (no-op si le groupe n'existe pas encore — vol en holding, non débarqué)
      onFlightCancelled(sim);
      logFlightEnd(sim, ac, true); // R17 : annulation = fin de vol dans la fenêtre (comptée)
      pushEvent(sim, { kind: 'flight-cancelled', volId: ac.id, airline: ac.airline, why: `attente bornée — ${holdWhy}` });
      return;
    }
  } else {
    ac._holdBlocked = 0;
  }
  if (!rw) return; // toutes occupées (congestion) : on patiente sans annulation
  const topY = rw.y;
  if (ac.y < topY) {
    ac.y = Math.min(topY, ac.y + V.approach * weatherEffect(sim).speed * dt); // T3 : la descente continue à la vitesse météo (toujours en descente)
  } else {
    ac.x += Math.sin(ac.timer * 0.4) * 20 * dt; // survol / attente
  }
  ac._holdAcc = (ac._holdAcc ?? 0) + dt;
  if (ac._holdAcc >= HOLDING_RETRY_S) {
    ac._holdAcc = 0;
    // La piste est exclusive (A4) : on n'y entre que si personne d'autre
    // n'y atterrit, n'en sort, ou n'en décolle. Piste fermée (incident) :
    // on patiente aussi (la réouverture relance la tentative). R32 : la
    // fermeture est lue sur CETTE piste (rw.id) — l'AUTRE piste peut être
    // fermée sans bloquer l'atterrissage ici (rw est déjà choisie ouverte).
    if (!runwayBusy(sim, rw.id, ac.id) && !runwayClosed(sim, rw.id) && ac.y >= topY) {
      ac.runwayId = rw.id;
      ac.phase = 'landing';
      ac.timer = 0;
    }
  }
}

// LANDING : roule le long de la piste vers le bas (décollage au bout opposé).
// AC18 (A9) : PLUS de saut horizontal — l'axe de la piste est CONVERGÉ latéralement
// à la vitesse taxi (borné par tick), la descente continue à V.landing : la trajectoire
// est continue (max ~14 px/tick à dt 0.1), pas d'accrochage sur l'axe au milieu de
// l'approche.
function doLanding(sim, ac, dt, spec) {
  const rw = sim.infra.runways.find((r) => r.id === ac.runwayId);
  if (!rw) {
    // Piste disparue en vol (démolition R3) : retour en holding. Le retard
    // FIXE météo n'est PAS rajouté ici : il est posé UNE FOIS à l'entrée en
    // attente (doApproach) — pas de double-comptage à la re-entrée.
    ac.phase = 'holding'; ac.timer = 0;
    return;
  }
  const bottomY = rw.y + rw.h;
  const axis = rw.x + rw.w / 2; // axe de la piste
  if (ac.x !== axis) {
    const d = axis - ac.x;
    const lat = V.taxi * dt; // roulage latéral borné (pas de téléportation)
    ac.x += d > 0 ? Math.min(d, lat) : Math.max(d, -lat);
  }
  // T3 MÉTÉO : la descente est MULTIPLIÉE par le facteur météo (weatherEffect —
  // LA règle unique) : l'occupation piste est PROLONGÉE par temps dégradé →
  // la CAPACITÉ d'atterrissages est réduite (émergent, mesurée — pas de 2e
  // règle). Par temps clair le facteur est 1 : comportement inchangé.
  ac.y = Math.min(bottomY, ac.y + V.landing * weatherEffect(sim).speed * dt);
  if (ac.y >= bottomY - 1) {
    // fin de piste → sortie de piste (exit) : on cherche le chemin taxi vers une porte
    ac.phase = 'exit';
    ac.timer = 0;
  }
}

// EXIT : on quitte la piste, on part vers une porte compatible. On calcule le chemin.
// A5 : la porte est RÉSERVÉE à l'attribution (g.acId = ac.id) — deux avions ne
// reçoivent jamais la même porte avant leur arrivée ; la porte reste réservée
// jusqu'au pushback (libération sûre).
function doExit(sim, ac, dt, spec, occupied) {
  // R04 (A5) : porte réservée AVANT le taxi (gateFor : bonne taille + libre —
  // une porte réservée par UN AUTRE avion est sautée). Si le chemin s'avère
  // impossible, on rend la porte ICI (libération sûre) — jamais de référence
  // périmée : g.acId n'existe que si le vol est toujours attaché à cette porte.
  const gate = gateFor(sim, spec.gate, ac.id);
  if (!gate) { ac.phase = 'blocked'; ac.timer = 0; return; }
  gate.acId = ac.id; // A5 : porte réservée à cet avion jusqu'au pushback
  ac.gateId = gate.id;
  const fromNode = runwayExitNode(sim, ac.runwayId);
  const toNode = gateNodeOf(sim, gate.id);
  const path = findPath(sim, fromNode, toNode, occupied);
  if (!path || path.length < 2) {
    // Pas de chemin → libération SÛRE : on rend la porte (g.acId) et on oublie
    // le gateId (pas de référence périmée — le prochain retry reprendra à neuf).
    gate.acId = null;
    ac.gateId = null;
    ac.phase = 'blocked'; ac.timer = 0; return;
  }
  ac.path = path;
  ac.pathPtr = 0;
  ac.seg = sim._graph.nodes[ac.path[0]].seg;
  // A3 : le segment d'arrivée du prochain pas est réservé immédiatement — un
  // autre avion ne peut plus entrer dedans au même tick (réservation exclusive).
  if (ac.seg != null) occupied.add(ac.seg);
  ac.heading = 'gate';
  ac.phase = 'taxi';
}

// TAXI : suit le chemin ; s'arrête si le segment d'arrivée est occupé (conflit de ressource).
function doTaxi(sim, ac, dt, occupied) {
  if (!ac.path) { ac.phase = 'blocked'; return; }
  const nodes = sim._graph.nodes;
  const nextIdx = ac.pathPtr + 1;
  if (nextIdx >= ac.path.length) {
    // arrivé au nœud cible (le dernier du chemin)
    if (ac.heading === 'gate') {
      // AC18 (A9) : le nœud de porte n'est PAS le centre de la porte (nœud du
      // taxiway, ~51 px du centre) : phase DOCKING = amarrage physique au centre
      // de la porte, position réelle conservée (pas de téléportation).
      ac.phase = 'docking'; ac.seg = null; ac.timer = 0;
      const g = sim.infra.gates.find((g) => g.id === ac.gateId);
      if (g) g.acId = ac.id;
      onGateArrived(sim, ac);
    } else if (runwayBusy(sim, ac.runwayId, ac.id)) {
      // D1 (audit) : la piste est exclusive (A4) — un atterrissage/sortie en
      // cours y est → on ATTEND au bout du chemin (retard mesurable), pas de
      // décollage concurrent. (Le départ n'est PAS bloqué par une piste FERMÉE
      // : la fermeture n'interdit que l'atterrissage, voir doApproach.)
      ac.delayed += dt;
      noteCause(ac, 'piste'); // R17 : l'attente est la PISTE (occupée, A4)
    } else {
      ac.phase = 'departure'; ac.seg = null; // prêt à décoller depuis le bas de la piste
    }
    return;
  }
  const nextNode = nodes[ac.path[nextIdx]];
  const nextSeg = nextNode.seg;
  // conflit : le segment d'arrivée est pris par un autre avion → on s'arrête (attente)
  if (occupied.has(nextSeg) && nextSeg !== ac.seg) {
    ac.delayed += dt;
    noteCause(ac, 'segment'); // R17 : le goulot est le SEGMENT (taxi, A3)
    return;
  }
  // on avance vers le nœud suivant
  const dx = nextNode.x - ac.x;
  const dy = nextNode.y - ac.y;
  const dist = Math.hypot(dx, dy);
  const step = V.taxi * dt;
  if (dist <= step) {
    ac.x = nextNode.x;
    ac.y = nextNode.y;
    ac.pathPtr = nextIdx;
    ac.seg = nodes[ac.path[ac.pathPtr]].seg; // le segment qu'on occupe maintenant
  } else {
    ac.x += (dx / dist) * step;
    ac.y += (dy / dist) * step;
    ac.seg = nextSeg; // on entre sur le segment d'arrivée
  }
  // A3 : la réservation du segment d'arrivée se met à jour ICI, au déplacement.
  // Un autre avion ne peut plus entrer dans ce segment au même tick (exclusive).
  if (ac.seg != null) occupied.add(ac.seg);
}

// DOCKING (AC18, A9) : amarrage physique — l'avion roule lentement du nœud de
// taxiway jusqu'au CENTRE de la porte (le nœud de porte n'est pas le centre :
// c'est le nœud du segment qu'elle joint, ~51 px plus loin). Position réelle,
// borné par tick, aucune téléportation.
function doDocking(sim, ac, dt) {
  const g = sim.infra.gates.find((g) => g.id === ac.gateId);
  if (!g) { ac.phase = 'gate'; return; } // porte disparue : on reste amarré sur place
  const gx = g.x + g.w / 2, gy = g.y + g.h / 2;
  const dx = gx - ac.x, dy = gy - ac.y;
  const dist = Math.hypot(dx, dy);
  const step = V.taxi * dt;
  if (dist <= step) { ac.x = gx; ac.y = gy; ac.phase = 'gate'; }
  else { ac.x += (dx / dist) * step; ac.y += (dy / dist) * step; }
}

// GATE : l'avion est amarré à la porte (au CENTRE, vu doDocking). Opérations au sol :
// carburant (BL-12) → débarquement → sol → embarquement. Chaque étape dure
// GATE_OPS_S/3 — T33 (t_88aee6d5) × gateOpsMult du terminal de la porte
// (amélioration « boarding », 0.75^niveau ; niveau 0 = ×1, durée inchangée).
// On compte les passagers transportés à l'embarquement (critère 7).
function doGate(sim, ac, dt) {
  // R05 : arrivePassengers est IDEMPOTENT par vol — un avion qui RE-ENTRE en gate
  // (pushback échoué → doBlocked → doExit, R04) a DÉJÀ injecté ses pax au 1er
  // passage : sans ce garde, le 2e passage ré-injecte (injectedTotal gonfle, un
  // groupe « base » orphelin reste à jamais, AC40 casse). Le 2e passage n'ajoute
  // donc plus de pax au parcours (elles sont déjà dans la file).
  if (!ac._paxInjected) {
    arrivePassengers(sim, ac);
    ac._paxInjected = true;
  }
  ac.phase = 'refuel';
  ac.timer = 0;
}

// REFUEL (BL-12, AC21) : remise à niveau du carburant AVANT le déchargement.
// Si une station existe, l'avion prend UNE LANCE (une station = une lance, 2e
// lance à partir de la 2e station — l'occupation partagée = saturation mesurable)
// et le plein dure spec.refuel * REFUEL_TIME_S (lié à la taille : le 747 prend
// plus longtemps que le Cessna). SANS station : pas d'attente — départ SÉC,
// expliqué par l'événement « no-fuel » : les billets ne sont que moitiés
// (économiquement pénalisé, non bloquant — critère « non bloquants »).
// L'usure porte (BL-12) s'accumule pendant toute la présence porte : une porte
// sale rallonge les opérations au sol (délai ground, HANGAR la remet à zéro).
function doRefuel(sim, ac, dt, spec) {
  ac.timer += dt;
  // BL-12 + t_2179387d : usure de la porte pendant que l'avion est amarré.
  // DEUX usures distinctes : g.cleaning (« sale ») + g.maintenance (« mécanique »
  // pendant le plein). Chacune est nettoyée par un service DIFFÉRENT (nettoyage
  // vs hangar) → deux services distincts qui coûtent et qui servent.
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  if (g) {
    g.cleaning = Math.min(100, g.cleaning + GATE_WEAR_PER_SEC * dt);
    g.maintenance = Math.min(100, g.maintenance + GATE_MAINT_PER_SEC * dt);
  }
  const lances = fuelLancesForGate(sim, ac);
  // R28 (t_bd681587) : la panne est LOCALE — chaque station a son propre état
  // (svc.fuelOut, incidents.mjs forceIncident 'fuel:<id>'). Le propriétaire de
  // la lance est EXPLICITE (ac._lanceId = id de station, pas un comptage
  // anonyme) : si la station ne sert PLUS cette porte (démolie, réaffectée au
  // joueur — R27) ou est EN PANNE locale, la lance est LIBÉRÉE (pas de
  // propriétaire fantôme) et l'avion re-sélectionne au prochain tick (ou
  // part sec s'il ne reste aucune station opérable).
  if (ac._refueling && ac._lanceId != null) {
    const svc = lances.find((s) => s.id === ac._lanceId);
    if (!svc || svc.fuelOut) releaseLance(ac);
  }
  // Sans station du tout → départ sec (billets moitiés, non bloquant).
  // R32 : la panne est PAR STATION (svc.fuelOut) — si d'autres stations servent
  // encore la porte, le plein continue (les lances tombées sont juste
  // exclues d'acquireLance). « Toutes en panne » est géré ci-dessous
  // (lances.some(s => !s.fuelOut)).
  if (!lances.length) {
    releaseLance(ac);
    ac._dryDeparture = true;
    if (!ac._noFuelNotified) {
      ac._noFuelNotified = true;
      pushEvent(sim, { kind: 'no-fuel', airline: ac.airline, pax: ac.pax });
    }
    ac.phase = 'disembark'; ac.timer = 0;
    return;
  }
  acquireLance(sim, ac, spec, lances);
  if (!ac._refueling) {
    noteCause(ac, 'carburant'); // R17 : lance(s) prise(s) — attente (saturation)
    // R28 : AUCUNE lance opérable (toutes en panne LOCALE) → départ sec
    // (non bloquant, expliqué) — idem à la panne globale. Si c'est de la
    // SATURATION (lances occupées par d'autres pleins), l'avion attend (R08 :
    // la saturation est mesurable, pas un départ sec). releaseLance normalise
    // l'état (pas de lance fantôme) — même pour un avion qui n'en tenait pas.
    if (!lances.some((s) => !s.fuelOut)) {
      releaseLance(ac);
      ac._dryDeparture = true;
      if (!ac._noFuelNotified) {
        ac._noFuelNotified = true;
        pushEvent(sim, { kind: 'no-fuel', airline: ac.airline, pax: ac.pax });
      }
      ac.phase = 'disembark'; ac.timer = 0;
    }
    return;
  }
  if (ac._refueling) {
    ac._refuelNeed -= dt;
    if (ac._refuelNeed <= 0) {
      releaseLance(ac); // fin normale : libère sa lance
      ac.phase = 'disembark'; ac.timer = 0;
    }
  }
}

// R08 (t_dab62cfc) : l'acquisition/libération d'une LANCE est CENTRALISÉE —
// UNE fonction d'acquisition (une lance par station ; si toutes sont prises,
// l'avion attend — saturation mesurable, pas de débordement) et UNE de
// libération. TOUTES les sorties du plein passent par releaseLance : fin
// normale, panne station (D2 : libération IMMÉDIATE), disparition du service
// (station démolie → !lances → même branch panne) ; l'annulation ne concerne
// pas le refuel (un avion refuel n'est jamais annulé — la purge retire les
// vols cancelled de sim.aircraft et leur lance ne compte plus). Le comptage
// d'occupation ne compte QUE les pleins réellement actifs (a._refueling).
// R28 (t_bd681587) : le propriétaire est EXPLICITE — ac._lanceId (l'id de la
// station qui sert l'avion), PAS un comptage anonyme « busy < lances » :
// (a) la panne locale (svc.fuelOut) ne touche QUE la station concernée ;
// (b) après une reprise, une lance « fantôme » (ac._lanceId pointant vers une
// station supprimée) est nettoyée (releaseLance, pas de propriété orpheline) ;
// (c) la distance porte→station EST la priorité : la station LA PLUS PRÈCHE de
// la porte (au sens de la distance point→rectangle, R27) est servie en premier
// — pas un ordre arbitraire (pas de « liste des stations » triée par id).
function acquireLance(sim, ac, spec, lances) {
  if (ac._refueling) return; // déjà en plein : pas de 2e lance
  // R28 : la priorité d'acquisition est la DISTANCE — la station la plus
  // proche de la porte (distance point→rectangle entre les centres, la même
  // règle que nearestTerminal, R27 ; en égalité, l'id le plus petit = le plus
  // ancien) est servie EN PREMIER, pas un ordre arbitraire. Les stations en
  // panne LOCALE (svc.fuelOut, R28) sont exclues ; la saturation (R08) est
  // comptée par occupation EXPLICITE (ac._lanceId, pas un comptage anonyme).
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  if (!g) return; // porte absente : pas de lance (le départ sec est géré en amont)
  const gx = g.x + g.w / 2, gy = g.y + g.h / 2;
  const busy = new Set(sim.aircraft.filter((a) => a._refueling && a._lanceId != null).map((a) => a._lanceId));
  let best = null, bestD = Infinity;
  for (const s of lances) {
    if (s.fuelOut || busy.has(s.id)) continue;
    const dx = Math.max(Math.abs(gx - (s.x + s.w / 2)) - s.w / 2, 0);
    const dy = Math.max(Math.abs(gy - (s.y + s.h / 2)) - s.h / 2, 0);
    const d = Math.hypot(dx, dy);
    if (d < bestD || (d === bestD && s.id < best)) { bestD = d; best = s; }
  }
  if (!best) return; // toutes occupées (saturation) ou en panne : on attend
  ac._refueling = true;
  // R28 (t_bd681587) : le SERVICE de la lance = le temps de PLEIN (lié à la
  // taille, spec.refuel × REFUEL_TIME_S) + un temps de DÉPLACEMENT simple fondé
  // sur la DISTANCE porte→station (bestD, la même distance point→rectangle que
  // la priorité d'acquisition ; SANS agents véhicules : la sim reste sans
  // entités mobiles, le déplacement est un simple retard proportionnel à la
  // distance — la station éloignée sert plus lentement que la station proche).
  // R31 : le temps de PLEIN est MULTIPLIÉ par le facteur d'avitaillement DU
  // TERMINAL (refuelTimeMult, upgrades.mjs) — le niveau 0 renvoie 1 (l'état
  // existant, les tests R28 inchangés). Le déplacement (station éloignée) ne
  // change PAS : l'amélioration sert le DÉBIT, pas le placement.
  ac._refuelNeed = spec.refuel * REFUEL_TIME_S * refuelTimeMult(sim, g.terminalId) + bestD * (REFUEL_TRAVEL_S_PER_1000 / 1000);
  ac._lanceId = best.id; // R28 : le propriétaire est EXPLICITE (id de station)
}

// Libération CENTRALE : le propriétaire (ac._refueling, ac._lanceId) ET le temps
// restant (ac._refuelNeed) sont nettoyés ENSEMBLE — aucun chemin de sortie
// n'en oublie un (le branch panne avant R08 n'en nettoyait aucun ; R28 ajoute
// _lanceId au même geste : PAS de propriété orpheline).
function releaseLance(ac) {
  ac._refueling = false;
  ac._refuelNeed = 0;
  ac._lanceId = null; // R28 : la lance est LIBÉRÉE (l'avion n'a plus de station)
}

// BL-12 : lances disponibles = stations carburant (une lance par station).
// R27 (t_6424937a) : les lances sont MESURÉES PAR TERMINAL (assignments.mjs)
// — les stations servent SEULEMENT les portes de leur terminal affecté : une
// station posée loin de tout ne sert plus « implicitement » tout l'aéroport.
// Le terminal du vol = celui de sa porte (ac.gateId). Porte absente (vol
// annulé en cours de plein) → terminal inconnu → 0 lance (départ sec).
// R28 (t_bd681587) : la liste renvoyée est des STATIONS (objets, pas des
// nombres) — l'acquisition (acquireLance) a besoin de l'ID ET de la GÉOMÉTRIE
// (distance point→rectangle, priorité « plus proche ») ; la saturation
// (R08) est comptée par occupation EXPLICITE (ac._lanceId, pas un comptage
// anonyme).
function fuelLancesForGate(sim, ac) {
  const g = sim.infra.gates.find((x) => x.id === ac.gateId);
  if (!g) return [];
  return servicesServingGate(sim, 'fuel', g); // R27 : stations du terminal de la porte
}

// OPÉRATIONS AU SOL : débarquement → sol → embarquement → pushback.
// Le comptage des passagers (UNE fois, critère 7) se fait à la fin de
// l'étape « board », à travers le module passagers (countCarried).
function doOps(sim, ac, dt) {
  ac.timer += dt;
  // T33 (t_88aee6d5) : l'amélioration « boarding » du terminal de la porte
  // (gateOpsMult, upgrades.mjs — 0.75^niveau, niveau 0 = ×1) RACCOURCIT les
  // 3 étapes au sol : la porte se libère plus vite. La ponctualité (R17) est
  // mesurée contre le nominal INCHANGÉ : le vol amarré est plus PUNCTUEL,
  // c'est le bénéfice affiché du choix.
  const g0 = sim.infra.gates.find((x) => x.id === ac.gateId);
  const step = GATE_OPS_S / 3 * (g0 ? gateOpsMult(sim, g0.terminalId) : 1);
  if (ac.timer < step) return; // l'étape en cours dure GATE_OPS_S/3 (× boarding)
  if (ac.phase === 'disembark') {
    ac.phase = 'ground';
    ac.timer = 0;
    return;
  }
  if (ac.phase === 'ground') {
    // BL-12 + t_2179387d : la porte usée (g.cleaning « sale » + g.maintenance
    // « mécanique ») RALLONGE l'étape sol. CHAQUE usure est nettoyée par un
    // service DISTINCT : le nettoyage (g.cleaning) et le hangar (g.maintenance).
    // Le retard est proportionnel à l'usure totale (0..200) : GATE_WEAR_DELAY_S
    // par point — deux services qui coûtent ET qui servent (critère de fin).
    const g = sim.infra.gates.find((x) => x.id === ac.gateId);
    const wearDelay = (g ? g.cleaning + g.maintenance : 0) * GATE_WEAR_DELAY_S;
    const delay = boardDelay(sim, ac) + wearDelay; // saturation files + porte sale
    ac.phase = 'board';
    ac.timer = -delay; // l'étape embarquement démarre retardée (timer négatif)
    return;
  }
  if (ac.phase === 'board') {
    // Le retard (timer négatif) doit s'écouler avant le comptage.
    if (ac.timer < step) {
      // R17 : la PARTIE au-delà du nominal (timer < 0) est l'attente files
      // passagers / usure porte (portée par boardDelay + wearDelay, doOps
      // ground→board) — le goulot est « passagers » (file saturée) ou
      // « porte » (usure). La partie nominale (0..step) n'est pas un retard.
      if (ac.timer < 0) noteCause(ac, boardDelay(sim, ac) > 0 ? 'passagers' : 'porte');
      return;
    }
    // D2 : on ne compte/embarque QUE si le groupe du vol est COMPLET (tous ses
    // pax ont franchi check-in + sécurité → en attente). Sinon le vol reste au
    // sol (l'embarquement ne démarre pas avant la fin du parcours passager).
    // groupComplete ne bloque PAS si le groupe n'existe plus (avion injecté à
    // la main, groupe déjà purgé/compté) : parcours considéré terminé.
    if (!groupComplete(sim, ac)) { noteCause(ac, 'passagers'); return; }
    if (!ac.counted) {
      countCarried(sim, ac); // les passagers montent : comptés UNE fois
      ac.counted = true;     // le re-tick « board » ne recompte jamais (AC40)
    }
  }
  ac.phase = 'pushback';
  ac.timer = 0;
}

// PUSHBACK : on sort de la porte (chemin inverse : porte → nœud de piste).
function doPushback(sim, ac, dt, spec, occupied) {
  // libère la porte
  const g = sim.infra.gates.find((g) => g.id === ac.gateId);
  if (g) g.acId = null;
  const fromNode = gateNodeOf(sim, ac.gateId);
  const toNode = runwayExitNode(sim, ac.runwayId);
  const path = findPath(sim, fromNode, toNode, occupied);
  if (!path || path.length < 2) {
    ac.phase = 'blocked'; ac.timer = 0;
    return;
  }
  ac.path = path;
  ac.pathPtr = 0;
  ac.seg = sim._graph.nodes[ac.path[0]].seg;
  if (ac.seg != null) occupied.add(ac.seg); // A3 : réservation exclusive du segment
  ac.heading = 'runway';
  ac.phase = 'taxi';
}

// DÉPART : roulage vers le haut de la piste (départ au bout opposé), puis sortie de la carte.
function doDeparture(sim, ac, dt) {
  const rw = sim.infra.runways.find((r) => r.id === ac.runwayId);
  if (!rw) { ac.phase = 'holding'; return; }
  ac.x = rw.x + rw.w / 2;
  ac.y -= V.departure * dt;
  if (ac.y < rw.y - 120) {
    onGateDeparted(sim, ac); // recettes passagers au décollage
    if (!ac._dryDeparture) sim._cleanCycle = true; // R22 : cycle complet AVEC PLEIN (objet O1)
    logFlightEnd(sim, ac, false); // R17 : fin du vol (départ) dans la fenêtre de ponctualité
    ac.phase = 'departed';
    ac.seg = null;
    pushEvent(sim, { kind: 'flight-out', volId: ac.id, airline: ac.airline, pax: ac.pax });
  }
}

// BLOQUÉ : aucun chemin (taxiway coupé / porte indisponible). On retente régulièrement.
// A-5 : un blocage PERSISTANT est compté (ac._blockedAcc) et annulé après
// BLOCKED_CANCEL_S (10 min sim) : pas de croissance infinie des vols bloqués.
// La cause est visible (événement « flight-cancelled », toast dans l'UI).
function doBlocked(sim, ac, dt, spec, occupied) {
  ac.delayed += dt;
  noteCause(ac, ac.heading === 'gate' ? 'porte' : 'segment');
  ac.timer += dt;
  ac._blockedAcc = (ac._blockedAcc ?? 0) + dt;
  if (ac._blockedAcc >= BLOCKED_CANCEL_S) {
    // Blocage persistant → annulation (décision A-5 : comptés + annulés).
    const g = sim.infra.gates.find((g) => g.id === ac.gateId);
    if (g && g.acId === ac.id) g.acId = null; // libération sûre de la porte réservée
    ac.seg = null;
    ac.phase = 'cancelled';
    removePassengers(sim, ac); // R30 : retrait EXPLICITE des pax EN COURS du vol annulé (ne bloque PAS les groupes suivants)
    onFlightCancelled(sim); // BL-15 (AC6) : l'incident a un coût (indemnité)
    logFlightEnd(sim, ac, true); // R17 : annulation = fin de vol dans la fenêtre (comptée)
    pushEvent(sim, { kind: 'flight-cancelled', volId: ac.id, airline: ac.airline, why: 'blocage persistant' });
    return;
  }
  if (ac.timer < HOLDING_RETRY_S) return;
  ac.timer = 0;
  // réessayer selon le contexte : heading = 'gate' (on voulait aller à une porte)
  if (ac.heading === 'gate') {
    doExit(sim, ac, dt, spec, occupied);
  } else {
    // on partait de la porte : on retente pushback
    doPushback(sim, ac, dt, spec, occupied);
  }
  if (ac.phase !== 'blocked') ac._blockedAcc = 0; // rétabli → le compteur repart à zéro
}

__exports.DELAY_WINDOW_S = DELAY_WINDOW_S;
__exports.ensurePunctuality = ensurePunctuality;
__exports.logFlightEnd = logFlightEnd;
__exports.nominalRotation = nominalRotation;
__exports.punctualityStats = punctualityStats;
__exports.DELAY_CAUSE_FR = DELAY_CAUSE_FR;
__exports.causeAt = causeAt;
__exports.tickAircraft = tickAircraft;
})(__reg['m_src_sim_aircraft']);

/* --- module src/ui/build-tool.mjs --- */
(function (__exports) {
// Outil de construction UI : barre d'outils (B, touches 1-9), fantôme au survol
// (vert = posable, rouge = refus), clic = placer, X = démolir (clic sur un bâtiment).
// La décision de pose/vraie démolition est la sim (infra.mjs) : l'UI ne fait que
// le DOM, la souris et un aperçu « est-ce que ça tient ? » (grille + fonds).
// Le fantôme est dessiné par le renderer via drawGhost(ctx, cam, view).
const { BUILDINGS } = __ns('m_src_data_catalog');
const { unlockState } = __ns('m_src_infra_unlocks');
const { iconCanvas } = __ns('m_src_ui_icons');
const { THEME } = __ns('m_src_ui_theme');

// T33 (t_88aee6d5) : dérivé du CATALOGUE (BUILDINGS) — la liste grandit avec
// les bâtiments. Les 8 d'origine gardent leurs touches 1-8 ; les nouveaux
// prennent 9+ (9 = dernière touche simple ; 10/11 se choisissent à la
// barre d'outils, la liste clavier est bornée aux touches simples).
const KINDS = Object.keys(BUILDINGS);

function makeBuildTool({ canvas, state, camera, viewSize, toast, onPlaced, onDemolished, controls = [] }) {
  const tool = { mode: false, kind: 'runway', demolishMode: false, ghost: null };

  // Barre d'outils (DOM, en bas à gauche) — accessible : boutons <button> réels.
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', `Outils de construction (B activer, 1-${KINDS.length} choisir, X démolir)`);
  const buttons = {};
  for (let n = 0; n < KINDS.length; n++) {
    const k = KINDS[n];
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.textContent = `${n + 1} · ${BUILDINGS[k].name} (${BUILDINGS[k].cost} $)`;
    // T4 : icône vectorielle du type (20 px) AVANT l'étiquette — le type est
    // reconnaissable sans lire le libellé (le coût reste dans le texte).
    const ic = iconCanvas(k, 20, { color: THEME.text, accent: THEME.accent });
    if (ic) btn.prepend(ic);
    btn.addEventListener('click', () => {
      tool.mode = true; tool.demolishMode = false; tool.kind = k; sync();
    });
    bar.appendChild(btn);
    buttons[k] = btn;
  }
  const demolishBtn = document.createElement('button');
  demolishBtn.className = 'tool tool--danger';
  demolishBtn.textContent = 'X · Démolir';
  demolishBtn.addEventListener('click', () => {
    tool.demolishMode = !tool.demolishMode; tool.mode = false; sync();
  });
  bar.appendChild(demolishBtn);
  // R20 : boutons SOURIS des commandes du jeu (pause, vitesse, sauvegarde,
  // reprise) — les MÊMES commandes que les raccourcis clavier (les touches
  // complètent, elles ne sont pas seules porteuses). L'UI ne tranche rien :
  // le clic appelle la commande (main.mjs), le label note le raccourci.
  for (const c of controls) {
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.textContent = c.label;
    if (c.key) btn.title = `Raccourci : ${c.key}`;
    btn.addEventListener('click', c.action);
    bar.appendChild(btn);
    c._btn = btn; // l'état actif (pause) est resynchronisé par refreshControls
  }
  const hint = document.createElement('span');
  hint.className = 'toolbar-hint';
  hint.textContent = `B : construire · 1-${KINDS.length} : bâtiment · X : démolir · A : auto-accept vols · Échap : annuler`;
  bar.appendChild(hint);
  document.body.appendChild(bar);

  function sync() {
    for (const k of KINDS) {
      buttons[k].classList.toggle('tool--active', tool.mode && !tool.demolishMode && tool.kind === k);
    }
    demolishBtn.classList.toggle('tool--active', tool.demolishMode);
  }

  // Commandes publiques (clavier global dans main.mjs).
  tool.toggleBuild = () => {
    tool.demolishMode = false;
    tool.mode = !tool.mode;
    if (!tool.mode) tool.ghost = null;
    sync();
  };
  tool.toggleDemolish = () => {
    tool.mode = false;
    tool.demolishMode = !tool.demolishMode;
    if (!tool.demolishMode) tool.ghost = null;
    sync();
  };
  tool.cancel = () => { tool.mode = false; tool.demolishMode = false; tool.ghost = null; sync(); };
  // T33 (t_88aee6d5) : la SÉLECTION clavier (1-9) doit être VISIBLE —
  // sync() met à jour la classe active (avant : seule la barre la mettait à
  // jour, la touche choisissait « en sourdine » — le choix était actif dans
  // le fantôme mais le bouton ne s'allumait jamais).
  tool.setKind = (k) => { tool.kind = k; sync(); };
  tool.isActive = () => !!(tool.mode || tool.demolishMode);
  // T51 (t_cccfbc97) : la RACINE DOM de la barre est EXPOSÉE (main.mjs la
  // masque au menu — les panneaux de jeu ne flottent pas au-dessus du menu).
  tool.box = bar;

  // Aperçu de pose (lecture seule) : tient dans le terrain ? chevauche-t-il une
  // case occupée (grille de la sim) ? fonds suffisants ? — le VRAI verdict est la sim.
  // ponytail: la grille existe car la sim a posé de l'infra ; avant, on n'a que le
  // test rectangle-à-rectangle (pas de grille) → l'aperçu peut être optimiste.
  function cellFree(x, y, w, h) {
    const g = state.sim?.infra?.grid;
    if (!g || !g.cells) return null; // grille absente : pas de verdict
    const x0 = Math.max(0, Math.floor(x / 10)), y0 = Math.max(0, Math.floor(y / 10));
    const x1 = Math.min(g.w - 1, Math.floor((x + w - 1) / 10));
    const y1 = Math.min(g.h - 1, Math.floor((y + h - 1) / 10));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (g.cells[cy * g.w + cx]) return false;
      }
    }
    return true;
  }
  function canPlacePreview(kind, x, y) {
    const def = BUILDINGS[kind];
    const sim = state.sim;
    if (!sim) return { ok: false, why: 'Simulation non prête' };
    const t = state.terrain;
    if (x < 0 || y < 0 || x + def.w > t.w || y + def.h > t.h) {
      return { ok: false, why: 'Hors du terrain' };
    }
    const money = sim.economy && (sim.economy.money ?? sim.economy.funds);
    if (money !== undefined && money < def.cost) {
      return { ok: false, why: `Fonds insuffisants (${def.cost} $)` };
    }
    // Service pas encore débloqué (condition mesurable, R23) : le fantôme
    // l'indique À L'AVANCE — le BÉNÉFICE (pourquoi acheter) + la condition
    // restante (quand ça se débloquera), pas un simple seuil de pax.
    const st = unlockState(sim, kind);
    if (!st.unlocked) {
      return { ok: false, why: st.why };
    }
    const free = cellFree(x, y, def.w, def.h);
    if (free === false) return { ok: false, why: 'Zone déjà occupée' };
    return { ok: true };
  }

  // Fantôme : rectangle centré sous la souris, couleur selon l'aperçu.
  function computeGhost(sx, sy) {
    const def = BUILDINGS[tool.kind];
    const wx = camera.screenToWorldX(sx, viewSize().width) - def.w / 2;
    const wy = camera.screenToWorldY(sy, viewSize().height) - def.h / 2;
    const check = canPlacePreview(tool.kind, wx, wy);
    tool.ghost = { x: wx, y: wy, w: def.w, h: def.h, ok: check.ok, why: check.why };
  }

  canvas.addEventListener('mousemove', (e) => {
    if (tool.mode && !tool.demolishMode) computeGhost(e.offsetX, e.offsetY);
    else tool.ghost = null;
  });

  canvas.addEventListener('click', async (e) => {
    if (!state.sim) { toast('Simulation non prête', 'err'); return; }
    if (tool.demolishMode) {
      // Bâtiment sous la souris → démolir (verdict de la sim, lisible en toast).
      const wx = camera.screenToWorldX(e.offsetX, viewSize().width);
      const wy = camera.screenToWorldY(e.offsetY, viewSize().height);
      const sim = state.sim;
      const hit = [...sim.infra.runways, ...sim.infra.taxiways, ...sim.infra.terminals, ...sim.infra.services]
        .find((b) => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h);
      if (!hit) return;
      const { demolishBuilding } = await import('../infra/infra.mjs').catch(() => ({ demolishBuilding: null }));
      if (!demolishBuilding) { toast('Simulation non prête', 'err'); return; }
      const r = demolishBuilding(sim, hit.id);
      if (r.ok && onDemolished) onDemolished(hit, r); // Juice (t_5065be95) : avant la suppression, l'objet porte sa position
      toast(r.ok ? `${BUILDINGS[hit.type] ? BUILDINGS[hit.type].name : hit.type} démoli (+${r.refund} $)` : r.why, r.ok ? 'ok' : 'err');
      return;
    }
    if (!tool.mode) return;
    computeGhost(e.offsetX, e.offsetY);
    const g = tool.ghost;
    if (!g.ok) { toast(g.why, 'err'); return; }
    const { buildBuilding } = await import('../infra/infra.mjs').catch(() => ({ buildBuilding: null }));
    if (!buildBuilding) { toast('Simulation non prête', 'err'); return; }
    const b = buildBuilding(state.sim, tool.kind, g.x, g.y);
    if (b) {
      toast(`${BUILDINGS[tool.kind].name} construit (−${BUILDINGS[tool.kind].cost} $)`, 'ok');
      if (onPlaced) onPlaced(b);
    } else {
      // La sim a refusé (grille / fonds) : son événement « build-blocked / no-funds »
      // est déjà passé dans sim.alerts → le HUD l'affiche. On n'ajoute pas un 2e toast.
    }
    tool.ghost = null;
  });

  // R20 : les boutons de commandes reflètent l'état courant (vitesse, pause).
  // `refreshControls` est appelé à chaque frame par main.mjs — le label du
  // bouton vitesse suit state.speedIndex, la classe active suit state.paused.
  tool.refreshControls = () => {
    for (const c of controls) {
      if (c.labelOf) c._btn.textContent = c.labelOf(state);
      if (c.activeOf) c._btn.classList.toggle('tool--active', c.activeOf(state));
    }
  };

  // Rendu du fantôme (appelé par le renderer : drawGhost(ctx, cam, view)).
  tool.drawGhost = (ctx, cam, view) => {
    const g = tool.ghost;
    if (!g) return;
    const x0 = (g.x - (cam.x - view.width / 2 / cam.zoom)) * cam.zoom;
    const y0 = (g.y - (cam.y - view.height / 2 / cam.zoom)) * cam.zoom;
    const w = g.w * cam.zoom;
    const h = g.h * cam.zoom;
    ctx.fillStyle = g.ok ? 'rgba(76,175,80,0.45)' : 'rgba(244,67,54,0.45)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = g.ok ? '#43a047' : '#e53935';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, w, h);
    if (!g.ok && g.why) {
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(g.why, x0, y0 - 4);
    }
  };

  return tool;
}

__exports.makeBuildTool = makeBuildTool;
})(__reg['m_src_ui_build-tool']);

/* --- module src/core/new-game.mjs --- */
(function (__exports) {
// Assemblage de l'état global du jeu : l'état de base (machine à états, horloge,
// caméra) + l'objet de simulation. UN seul point d'entrée pour démarrer une partie.
// (game-state.mjs reste pure machine-à-états M1 ; la sim y est ajoutée ICI, pas là.)
// A-2 (tranché) : aéroport de dÉPART FOURNI — une piste, un terminal minimal
// (2 portes M) et le taxiway qui les relie : le réseau est physiquement valide
// dès la première frame, sans aucune construction du joueur.
const { newGame } = __ns('m_src_core_game-state');
const { newSimState } = __ns('m_src_core_sim-state');
const { placeBuilding } = __ns('m_src_infra_infra');
const { DIFFICULTIES, normalizeDifficulty } = __ns('m_src_core_difficulty');
const { ensureClock } = __ns('m_src_sim_clock');
const { AIRPORTS, DEFAULT_AIRPORT } = __ns('m_src_core_layouts');

// Plan de départ (A-2) : le layout de l'aéroport « central » de la table
// AIRPORTS (T3 stretch, t_79820790 — additif : bit-à-bit IDENTIQUE au
// START_LAYOUT legacy, le spawn par défaut reste invariant). Les segments se
// TOUCHENT physiquement (règle BL-02) : la sortie de piste (800,1100) touche
// le taxiway (550..750, 1050..1090) et le taxiway touche le terminal
// (550..750, 900..1050) → findPath relie piste et portes dès le départ.
const START_LAYOUT = AIRPORTS[DEFAULT_AIRPORT].layout;

function makeGameState(seed = undefined, difficultyId = 'normal', airportId = DEFAULT_AIRPORT) {
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

__exports.START_LAYOUT = START_LAYOUT;
__exports.makeGameState = makeGameState;
})(__reg['m_src_core_new-game']);

/* --- module src/progression/objectives.mjs --- */
(function (__exports) {
// R22 (t_00318fe0) — les 2 objectifs de progression (tiers.mjs R21) + la
// récompense payée UNE fois. L'état vit sur `sim.objectives` (sérialisé avec
// la sim → une récompense payée reste payée APRÈS sauvegarde + reprise ;
// l'identifiant est PERSISTANT). La récompense est payée ATOMIQUEMENT dans
// `tickObjectives` : le flag `paid` et le crédit cash (`earn`) sont posés dans
// la MÊME écriture — pas d'état intermédiaire, pas de double paiement.
//
// Règle R21 respectée : chaque objectif est une CONDITION MESURABLE dans
// l'état sim (jamais « atteindre X passagers ») :
//   O1 : un cycle de vol complet SANS départ sec (l'avion pose
//        `sim._cleanCycle = true` au décollage propre, aircraft.mjs) ET une
//        période close net ≥ 0 (flag `sim._nonNegPeriod`, posé ici tant que
//        la période est dans la fenêtre des 4 dernières — R14 borne à la
//        racine, pas de journal sans fin).
//   O2 : PENDANT un pic de demande (surge, BL-14), la ponctualité est
//        restaurée : le taux « à l'heure » de la fenêtre bornée R17 (30 min)
//        est ≥ 50 %. Sans vol fini dans la fenêtre, rate = null → pas atteint
//        (pas de faux chiffre, R16).
// Compteur temporaire documenté : le panneau n'affiche que l'état (atteint /
// payé) + la ponctualité live — aucun compteur « secondes attendues » n'est
// ajouté (les durées sont des cibles d'équilibrage R37, pas des critères).
const { earn, lastPeriod } = __ns('m_src_economy_economy');
const { punctualityStats } = __ns('m_src_sim_aircraft');
const { isSurge } = __ns('m_src_sim_incidents');
const { pushEvent } = __ns('m_src_core_sim-state');

// Récompenses (le jeu sait payer en cash ; montants de l'équilibre R22).
const OBJECTIVES = Object.freeze([
  { id: 'o1-cycle', name: 'Premier cycle avec plein', reward: 1000,
    desc: 'Un vol complet sans départ sec (carburant plein au décollage) et une période close net ≥ 0.' },
  { id: 'o2-surge', name: 'Pic de demande absorbé', reward: 1500,
    desc: 'Pendant un pic de demande, la ponctualité est restaurée (≥ 50 % des fins de vol récentes à l’heure).' },
]);

// État de progression : initialisation paresseuse (pattern sim.punctuality) —
// une sauvegarde ancienne ou une nouvelle partie n'ont pas le champ, le 1er
// tick le crée. `paid` absent (sauvegarde très ancienne) → false.
function ensureObjectives(sim) {
  if (!Array.isArray(sim.objectives)) {
    sim.objectives = OBJECTIVES.map((o) => ({ id: o.id, paid: false }));
  }
  for (const o of sim.objectives) if (o.paid === undefined) o.paid = false;
  return sim.objectives;
}

// Condition O1 : cycle propre (flag posé par aircraft.mjs au décollage SANS
// _dryDeparture) ET au moins une période close net ≥ 0. Le flag
// `_nonNegPeriod` est posé ICI tant que la période concernée est dans la
// fenêtre des 4 dernières (bornée, R14) — il persiste ensuite : l'état « une
// période net ≥ 0 existe » est booléen, pas un historique.
function condO1(sim) {
  // « AU MOINS UNE » période close net ≥ 0 : on scanne la fenêtre bornée des
  // périodes (4 dernières, R14) tant qu'elle est là, puis le flag `_nonNegPeriod`
  // (posé ICI, jamais effacé) garde l'état après rotation de la fenêtre — pas
  // d'historique sans fin.
  const periods = sim.economy.periods;
  if (Array.isArray(periods) && periods.some((p) => p.net >= 0)) sim._nonNegPeriod = true;
  return sim._cleanCycle === true && sim._nonNegPeriod === true;
}

// Condition O2 : pendant le pic, la ponctualité (fenêtre bornée R17) est
// restaurée — taux « à l'heure » (départs à retard ≤ rotation nominale,
// annulations comptées) ≥ 50 %. rate = null : aucun vol fini dans la fenêtre
// → condition non remplie (jamais un faux chiffre).
function condO2(sim) {
  const rate = punctualityStats(sim).rate;
  return isSurge(sim) && rate !== null && rate >= 0.5;
}

const CONDS = Object.freeze({ 'o1-cycle': condO1, 'o2-surge': condO2 });

// Évaluation + paiement (appelée par tick, après tickEconomy/tickIncidents).
// Un objectif non payé dont la condition est remplie est payé ATOMICEMENT :
// `paid = true` + crédit dans la même écriture → la récompense ne se paie
// jamais deux fois (l'id persiste dans la sauvegarde, EV-10).
function tickObjectives(sim) {
  if (sim.economy?.bankrupt) return; // la sim est stoppée
  for (const st of ensureObjectives(sim)) {
    if (st.paid) continue;
    const def = OBJECTIVES.find((o) => o.id === st.id);
    const cond = CONDS[st.id];
    if (!def || !cond || !cond(sim)) continue;
    st.paid = true;
    earn(sim, def.reward, 'reward'); // crédite le montant (compte revenue.reward)
    pushEvent(sim, { kind: 'objective-paid', id: def.id, name: def.name, reward: def.reward });
  }
}

// Lecture pour le panneau (UI fine : le panneau n'appelle jamais tickObjectives).
// `state` : 'payée' | 'atteinte' (condition vraie, paiement au prochain tick)
// | 'à venir'. `detail` : la mesure live (le compteur temporaire documenté).
function objectiveView(sim, id) {
  const o = OBJECTIVES.find((x) => x.id === id);
  if (!o) return null;
  const st = ensureObjectives(sim).find((x) => x.id === id);
  const paid = st ? st.paid : false;
  if (paid) return { ...o, state: 'payée', detail: `récompense ${o.reward} $ payée` };
  if (id === 'o1-cycle') {
    const p = lastPeriod(sim);
    const parts = [];
    parts.push(sim._cleanCycle ? 'cycle avec plein : oui' : 'cycle avec plein : non');
    const net = sim._nonNegPeriod || (p && p.net >= 0);
    parts.push(net ? 'période net ≥ 0 : oui' : 'période net ≥ 0 : non');
    return { ...o, state: 'à venir', detail: parts.join(' ; ') };
  }
  if (id === 'o2-surge') {
    const s = punctualityStats(sim);
    if (!isSurge(sim)) return { ...o, state: 'à venir', detail: 'en attente d’un pic de demande' };
    const d = s.total ? `ponctualité pendant le pic : ${Math.round(s.rate * 100)} % (${s.onTime}/${s.total})`
                     : 'pic en cours, aucun vol fini dans la fenêtre';
    return { ...o, state: s.rate !== null && s.rate >= 0.5 ? 'atteinte' : 'à venir', detail: d };
  }
  return { ...o, state: 'à venir', detail: '' };
}

__exports.OBJECTIVES = OBJECTIVES;
__exports.ensureObjectives = ensureObjectives;
__exports.tickObjectives = tickObjectives;
__exports.objectiveView = objectiveView;
})(__reg['m_src_progression_objectives']);

/* --- module src/progression/quality.mjs --- */
(function (__exports) {
// R26 (t_62ffa6bc) — relier les offres à la progression et à la qualité.
// La « réputation » de l'aéroport vis-à-vis des offres = le taux de
// PUNCTUALITÉ mesuré (fenêtre bornée R17, aircraft.mjs) — on réutilise la
// statistique existante, PAS un compteur parallèle.
// Bornes + inertie (spec R26) :
//   - la valeur effective est bornée [Q_FLOOR, 1] : la réputation FAIBLE garde
//     une voie de reprise (le planificateur offre TOUJOURS au moins les
//     petits avions — aucune spirale punitive sans issue) ;
//   - la valeur ne bouge que par PAS BORNÉ par seconde de jeu (inertie :
//     pas de changement brutal, la montée est plus lente que la descente —
//     la qualité se gagne, elle se perd vite) ;
//   - le palier (mix de tailles que le planificateur est autorisé à proposer)
//     est une fonction PURE de la valeur : jamais de 2e règle de sim.
// L'état vit sur `sim.quality` (sérialisé avec la sim → la reprise est
// reproductible, EV-10), comme sim.punctuality / sim.contracts.
const { punctualityStats, ensurePunctuality } = __ns('m_src_sim_aircraft');

const Q_FLOOR = 0.3;    // borne basse : la réputation ne tombe jamais sous
const Q_DROP_PER_S = 0.002;   // la descente est bornée (0.3 en ~2.5 min sim si tout s'effondre)
const Q_RISE_PER_S = 0.0005;  // la montée est bornée ET plus lente (40 min sim pour regagner 0.4)

// Paliers du mix d'offres (l'index dans le catalogue = la taille :
// small → medium → large, catalog.mjs) :
//   0 : petits seulement (la voie de reprise — les Cessna se posent à l'heure)
//   1 : petits + moyens (l'activité modeste de départ)
//   2 : toutes tailles (la progression — les 747 réapparaissent dans les offres)
const Q_TIERS = Object.freeze([
  { name: 'petits', sizes: ['small'] },
  { name: 'petits + moyens', sizes: ['small', 'medium'] },
  { name: 'toutes tailles', sizes: ['small', 'medium', 'large'] },
]);

// Initialisation paresseuse (pattern sim.punctuality / sim.contracts) :
// une sauvegarde ancienne n'a pas le champ → le 1er tick le crée.
// Départ à 1.0 : la qualité se PRouve par les fins de vol, elle ne se
// présume pas — mais le mix de départ reste modeste (le palier 2 n'ouvre
// les offres large que si la mesure le justifie, le filtre « servable »
// de l'infra fait le reste).
function ensureQuality(sim) {
  sim.quality = sim.quality || { q: 1 };
  if (typeof sim.quality.q !== 'number' || !isFinite(sim.quality.q)) sim.quality.q = 1;
  sim.quality.q = Math.min(1, Math.max(Q_FLOOR, sim.quality.q)); // borné (EV-10 : état corrompu réparé)
  return sim.quality;
}

// Le palier LU : fonction pure de la valeur effective — le planificateur
// et le panneau lisent LA même règle (jamais deux règles divergentes).
function qualityTier(sim) {
  const q = ensureQuality(sim).q;
  return q < 0.4 ? 0 : q < 0.7 ? 1 : 2;
}

// Le battement qualité (appelé par tick.mjs APRÈS les avions : c'est le tour
// des avions qui alimente la fenêtre de ponctualité, logFlightEnd).
// La valeur effective CONVERGE vers la mesure bornée (inertie) :
//   - cible = le taux mesuré (fenêtre R17) ; aucune mesure → 1 (départ neuf,
//     pas de faux chiffre — la valeur reste ce qu'elle est déjà bornée) ;
//   - pas borné : descente ≤ Q_DROP_PER_S × dt, montée ≤ Q_RISE_PER_S × dt ;
//   - borne basse Q_FLOOR : la descente s'arrête là (la voie de reprise existe).
function tickQuality(sim, dt) {
  const st = ensureQuality(sim);
  ensurePunctuality(sim);
  const rate = punctualityStats(sim).rate; // null = aucune fin de vol dans la fenêtre
  const target = rate == null ? 1 : rate;
  const delta = target - st.q;
  if (delta < 0) st.q = Math.max(Q_FLOOR, st.q - Math.min(-delta, Q_DROP_PER_S * dt));
  else if (delta > 0) st.q = Math.min(1, st.q + Math.min(delta, Q_RISE_PER_S * dt));
}

// LECTURE pour le panneau (UI fine, pattern contractView/objectiveView) :
// la valeur effective, le palier (mix offert) et la mesure sous-jacente
// (taux R17 sur la fenêtre bornée — null = pas encore de fins de vol).
function qualityView(sim) {
  const st = ensureQuality(sim);
  const tier = qualityTier(sim);
  const stats = punctualityStats(sim);
  return {
    q: st.q,
    tier,
    tierName: Q_TIERS[tier].name,
    sizes: Q_TIERS[tier].sizes.slice(),
    measured: stats.rate,          // taux R17 (null si fenêtre vide)
    measuredTotal: stats.total,    // fins de vol comptées (borné, R17)
  };
}

__exports.Q_FLOOR = Q_FLOOR;
__exports.Q_DROP_PER_S = Q_DROP_PER_S;
__exports.Q_RISE_PER_S = Q_RISE_PER_S;
__exports.Q_TIERS = Q_TIERS;
__exports.ensureQuality = ensureQuality;
__exports.qualityTier = qualityTier;
__exports.tickQuality = tickQuality;
__exports.qualityView = qualityView;
})(__reg['m_src_progression_quality']);

/* --- module src/ui/overlay.mjs --- */
(function (__exports) {
// Overlay réseau / capacités (R18) : un écran de diagnostic LECTURE SEULE —
// le MÊME graphe pathfinding ET les MÊMES règles que la simulation :
//   - segments : le MÊME graphe de la sim (sim._graph, reconstruit par
//     rebuildGraph — la même fonction, pas de 2e règle de jonction) ;
//   - porte COUPÉE : gateReachable (infra.mjs, PRIMITIVE RÉUTILISÉE telle
//     quelle — le diagnostic écran = la règle que le planificateur applique)
//     + un avion ACTUELLEMENT bloqué dessus (phase 'blocked') → la rupture
//     se lit directement sur l'écran, pas seulement dans les stats ;
//   - occupation : les segments pris par des avions (ac.seg) + les pistes
//     fermées (incidents.runway.closed) et occupées (phases landing/exit/
//     departure — la MÊME dérivée que runwayBusy dans la sim).
// L'UI ne décide rien : elle ne fait que peindre (règle « UI fine »).
// Toggle touche O (main.mjs), inactif par défaut ; `state.networkOverlay`
// est une PREFERENCE d'affichage : absente d'une sauvegarde ancienne →
// l'overlay reste inactif à la reprise (pas d'état dérivé).
const { rebuildGraph } = __ns('m_src_pathfinding_path');
const { gateReachable } = __ns('m_src_infra_infra');
const { runwayClosed } = __ns('m_src_sim_incidents');

// Lecture pure de l'état de sim → structure platte pour le rendu.
// Exportée telle quelle : les tests s'appuient sur cette LECTURE (zéro
// DOM) — pas sur le canvas.
//   segs   : une entrée par segment du graphe (taxiway/piste) + occupation
//   gates  : portes { ok : joignable, ac : avion amarré, blocked : avion bloqué }
//   runways: pistes { closed : incident fermeture, busy : avion dessus }
function overlayState(sim) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  const g = sim._graph;
  const segs = [];
  if (g) {
    // Position d'affichage d'un segment = la 1re de ses nœuds du graphe.
    const bySeg = new Map();
    g.nodes.forEach((n) => { if (!bySeg.has(n.seg)) bySeg.set(n.seg, { x: n.x, y: n.y }); });
    const occ = new Set();
    for (const a of sim.aircraft) if (a.seg != null) occ.add(a.seg);
    for (const b of [...sim.infra.taxiways, ...sim.infra.runways]) {
      const o = bySeg.get(b.id);
      if (!o) continue; // segment démolit : plus de nœud dans le graphe
      segs.push({ id: b.id, type: b.type, x: o.x, y: o.y, occupied: occ.has(b.id) });
    }
  }
  const runways = sim.infra.runways.map((r) => ({
    id: r.id,
    // R32 : la fermeture est ATTACHÉE à la piste — lue par actif (runwayClosed),
    // pas un champ global : fermer UNE piste n'affecte PAS l'autre.
    closed: runwayClosed(sim, r.id),
    // La même dérivée que runwayBusy (aircraft.mjs) : usage exclusif par les
    // phases, pas d'état parallèle.
    busy: sim.aircraft.some((a) => a.runwayId === r.id && ['landing', 'exit', 'departure'].includes(a.phase)),
  }));
  const acById = new Map(sim.aircraft.map((a) => [a.id, a]));
  const gates = sim.infra.gates.map((gt) => ({
    id: gt.id,
    size: gt.size,
    ok: gateReachable(sim, gt), // la règle de la sim, telle quelle
    ac: gt.acId ? acById.get(gt.acId) : null,
    // Un avion ACTUELLEMENT bloqué sur cette porte (taxi coupé) : la rupture
    // lisible sur l'écran (phase 'blocked' — la même que doBlocked dans la sim).
    blocked: sim.aircraft.some((a) => a.phase === 'blocked' && a.gateId === gt.id),
  }));
  return { segs, gates, runways };
}

// Le dessinateur canvas — la MÊME signature que les overlays du renderer
// (ctx, cam, viewSize) : le renderer l'appelle chaque frame en jeu.
function drawNetworkOverlay(ctx, cam, viewSize, sim) {
  const ov = overlayState(sim);
  if (!ov.segs.length) return;
  const z = cam.zoom;
  const p = (x, y) => [
    (x - (cam.x - viewSize.width / 2 / z)) * z,
    (y - (cam.y - viewSize.height / 2 / z)) * z,
  ];
  // Segments : coques (grises) / rouges s'ils sont OCCUPÉS (un avion dessus).
  ctx.lineCap = 'round';
  for (const s of ov.segs) {
    const [x, y] = p(s.x, s.y);
    ctx.beginPath();
    ctx.arc(x, y, (s.occupied ? 5 : 3.5) * Math.min(2, z), 0, Math.PI * 2);
    ctx.fillStyle = s.occupied ? 'rgba(255,82,82,0.85)' : 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Portes : pastille colorée par l'état RÉSEAU de la porte —
  //   verte  = joignable (gateReachable : la règle de la sim) ;
  //   rouge  = COUPÉE (taxiway absent/coupé) OU avion bloqué dessus.
  for (const gt of ov.gates) {
    if (!gt.ac || gt.ac.x == null) continue; // porte sans avion : la sim la peint déjà
    const [x, y] = p(gt.ac.x, gt.ac.y);
    ctx.beginPath();
    ctx.arc(x, y, 10 * Math.min(2, z), 0, Math.PI * 2);
    ctx.strokeStyle = gt.blocked || !gt.ok ? '#ff5252' : '#69f0ae';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

__exports.overlayState = overlayState;
__exports.drawNetworkOverlay = drawNetworkOverlay;
})(__reg['m_src_ui_overlay']);

/* --- module src/scenarios.mjs --- */
(function (__exports) {
// R38 (t_8f8f4a63) — les TROIS scénarios rejouables : DÉMARRAGE GUIDÉ,
// DÉFI SATURATION, DÉFI REDRESSEMENT. Chacun :
//   • les MÊMES règles (tick, sim, économie — AUCUNE règle n'est modifiée :
//     le pic est l'action EXISTANTE forceIncident, l'emprunt la commande
//     EXISTANTE takeLoan du joueur, l'objectif annoncé est un objectif R22) ;
//   • une CONFIGURATION EXPLICITE (seed, solde, pic, emprunt) posée sur l'état
//     frais — elle vit sur `state.scenario` (sérialisée avec l'état entier → la
//     partie scénario est sauvegardable/rechargeable, la configuration REPREND
//     au chargement : les effets déjà appliqués sont sur la sim, le champ sert
//     de marqueur) ;
//   • un OBJECTIF ANNONCÉ (l'objectif R22 correspondant, affiché par le panneau
//     « Scénario » + toast au lancement).
// Le MODE LIBRE est conservé : « Nouvelle partie » = makeGameState() sans
// scenario (seed aléatoire, pas d'objectif annoncé, pas de champ `scenario`).
// R46 (t_7b04f863) : +3 scénarios (CRISE TOTALE, DÉFI DIFFICILE, DÉFI FACILE)
// — le même pattern : une ENTRÉE DE TABLE, pas de système de paramétrage.
// Deux champs de config ADDITIFS (absents des entrées R38 → comportement
// R38 intact) :
//   • `difficulty` : le profil T2-1 (core/difficulty.mjs) — PARAMÈTRE DE
//     SPAWN (capital de départ + facteurs de tick), jamais une règle : le
//     scénario porte sa difficulté, sérialisée sur state.difficulty comme le
//     mode libre (elle REPREND au chargement, le sélecteur du menu la lit) ;
//   • `runwayClosedSeconds` : fermeture de PISTE forçée dès le départ avec
//     une durée EXPLICITE du défi (forceIncident R32 = l'action EXISTANTE,
//     comme le pic ; la durée naturelle RUNWAY_CLOSE_S reste la règle sim).
const { makeGameState } = __ns('m_src_core_new-game');
const { forceIncident } = __ns('m_src_sim_incidents');
const { OBJECTIVES } = __ns('m_src_progression_objectives');
const { START_FUNDS } = __ns('m_src_core_sim-state');

// Le pic forcé du DÉFI SATURATION : durée EXPLICITE du défi (le pic NATUREL
// reste INCID.SURGE_S — on n'écrase rien, forceIncident est la même action ;
// seule la durée du DÉFI est un paramètre du scénario, pas de la sim).
const SATURATION_SURGE_S = 600; // 10 min sim : le temps de décider
// Le DÉFI REDRESSEMENT : l'aéroport démarre EN DÉFICIT (solde EXPLICITE, pas
// un budget gonflé — START_FUNDS 12 000 reste le capital du mode libre) ;
// l'emprunt borné R35 (5 000 $, une fois) RESTE le levier DU JOUEUR
// (takeLoan, panneau Bilan) — le défi est « remonter dans le vert ».
const REDRESSEMENT_FUNDS = -3000;
// R46 : le DÉFI CRISE TOTALE — pic de demande (fenêtre EXPLICITE 15 min sim)
// ET fermeture de la piste dès le départ (durée EXPLICITE 120 s, la même que
// la règle R32 RUNWAY_CLOSE_S : le scénario ne change que la DUREE du défi,
// jamais la règle). Les deux effets sont les actions EXISTANTES
// (forceIncident R32/R33) posées sur l'état frais — la réponse du joueur est
// l'intervention PAYANTE R33 (réouvrir la piste : 600 $) ou l'attente.
const CRISIS_SURGE_S = 900; // 15 min sim : le temps d'absorber la crise
const CRISIS_RUNWAY_CLOSE_S = 120; // = la durée R32 (la règle reste, on la force au départ)
// T3 stretch (t_79820790) — le SECOND AÉROPORT (scénario « Cap Nord »,
// layout src/core/layouts.mjs : 2 pistes L/M + terminal 4 portes) : le
// budget de départ FIXÉ par un replay 48 h passif MESURÉ (rejoué dans
// tests/r49-airports.mjs, seed 24, solde de départ 12 000 $) : le MINIMUM
// de solde sur 48 h est 11 357 $ — le solde reste POSITIF tout le long
// (pas de faillite, pas de chiffre inventé : mesuré sur la sim réelle).
const CAP_NORD_FUNDS = 12000;

const SCENARIOS = Object.freeze({
  guide: Object.freeze({
    name: 'Démarrage guidé',
    seed: 42, // rejouable : même seed + mêmes décisions = même partie (R09)
    funds: START_FUNDS, // budget normal (pas de gonflement)
    surgeSeconds: 0, // aucun pic forcé
    objective: 'o1-cycle', // R22 : premier cycle sans départ sec + période net ≥ 0 (1000 $)
  }),
  saturation: Object.freeze({
    name: 'Défi saturation',
    seed: 7,
    funds: START_FUNDS,
    surgeSeconds: SATURATION_SURGE_S, // pic de demande forcé dès le départ
    objective: 'o2-surge', // R22 : ponctualité restaurée pendant le pic (≥ 50 %, 1500 $)
  }),
  redressement: Object.freeze({
    name: 'Défi redressement',
    seed: 42,
    funds: REDRESSEMENT_FUNDS, // budget EXPLICITE du défi (déficit de départ)
    surgeSeconds: 0,
    objective: 'o1-cycle', // R22 : remettre l'aéroport dans le vert (cycle + période net ≥ 0, 1000 $)
  }),
  // R46 (t_7b04f863) : trois nouveaux scénarios — MÊMES règles (forceIncident
  // R32/R33, emprunt R35, difficultés T2-1, objectifs R22), configuration
  // EXPLICITE posée sur l'état frais, rejouables (seed imposée).
  crise: Object.freeze({
    name: 'Défi crise totale',
    seed: 13,
    funds: START_FUNDS, // budget normal (le défi est l'incident, pas le budget)
    surgeSeconds: CRISIS_SURGE_S, // pic de 15 min sim ACTIF dès le départ
    runwayClosedSeconds: CRISIS_RUNWAY_CLOSE_S, // ET la piste fermée 120 s dès le départ
    objective: 'o2-surge', // R22 : ponctualité restaurée pendant le pic (≥ 50 %, 1500 $)
  }),
  difficile: Object.freeze({
    name: 'Défi difficile',
    seed: 21,
    difficulty: 'hard', // T2-1 : capital maigre 6 000 $ + incidents ×0.6 + OPEX ×1.25
    objective: 'o1-cycle', // R22 : remettre dans le vert en conditions dures (1000 $)
  }),
  facile: Object.freeze({
    name: 'Défi facile',
    seed: 3,
    difficulty: 'easy', // T2-1 : capital confort 18 000 $ + incidents ×1.6 + OPEX ×0.85
    objective: 'o1-cycle', // R22 : premier cycle sans départ sec + période net ≥ 0 (1000 $)
  }),
  // T3 stretch (t_79820790) — le SECOND AÉROPORT (objectif « a second
  // airport ») : le layout Cap Nord (src/core/layouts.mjs — 2 pistes, une
  // CAPABLE L + une M, terminal 4 portes L/M/M/L) — MÊMES règles du jeu
  // (aucune n'est modifiée : l'aéroport est un PARAMÈTRE DE SPAWN, la sim
  // décide), profil DIFFÉRENT de tous les autres scénarios (2 pistes vs 1,
  // 4 portes vs 2) + budget FIXÉ par replay 48 h passif (pas de faillite).
  // ADDITIF : l'absence du champ `airport` sur les entrées R38/R46 = le
  // layout « central » (comportement R38/R46 intact — pas de ligne
  // modifiée pour les 6 scénarios existants).
  capNord: Object.freeze({
    name: 'Cap Nord — aéroport du nord',
    seed: 24, // rejouable (EV-10) : même seed + mêmes décisions = même partie
    funds: CAP_NORD_FUNDS, // budget EXPLICITE du second aéroport (mesuré, cf. tests/r49)
    airport: 'cap-nord', // NOUVEAU champ additif (absent → layout « central »)
    objective: 'o1-cycle', // R22 : premier cycle sans départ sec + période net ≥ 0 (1000 $)
  }),
});

// Démarre un scénario : état frais (seed imposée) + la configuration EXPLICITE
// appliquée SUR LA SIM (pic = forceIncident, solde = champ de l'économie,
// piste fermée = forceIncident R32 — aucune règle ajoutée au tick). Retourne
// le state complet ; le câblage (main.mjs) fait Object.assign(state, ret)
// comme pour une nouvelle partie.
// `state.scenario` = la configuration (marqueur sérialisé, la config REPREND
// au chargement). La difficulté du scénario (R46, absente des entrées R38 →
// 'normal' = comportement R38 intact) est le PARAMÈTRE DE SPAWN T2-1 : elle
// vit sur state.difficulty / sim.difficulty (sérialisées, reprises au load).
function startScenario(mode) {
  const cfg = SCENARIOS[mode];
  if (!cfg) throw new Error(`scénario inconnu : ${mode} (les modes : ${Object.keys(SCENARIOS).join(', ')})`);
  const diffId = cfg.difficulty || 'normal'; // R46 : le profil T2-1 du défi (référentiel sinon)
  // T3 stretch (t_79820790) : l'aéroport du scénario (champ ADDITIF, absent
  // des entrées R38/R46 → « central » = comportement R38/R46 intact).
  const state = makeGameState(cfg.seed, diffId, cfg.airport);
  state.scenario = { id: mode, name: cfg.name, objective: cfg.objective, difficulty: diffId, airport: cfg.airport };
  // Budget EXPLICITE du défi (absent pour les défis de difficulté : le
  // CAPITAL DU PROFIL T2-1 posé par makeGameState EST la config du défi —
  // pas de chiffre dupliqué).
  if (cfg.funds !== undefined && cfg.funds !== state.sim.economy.money) state.sim.economy.money = cfg.funds;
  if (cfg.surgeSeconds > 0) {
    forceIncident(state.sim, 'surge'); // l'action EXISTANTE (tests R33) met le pic actif
    state.sim.incidents.surge.remaining = cfg.surgeSeconds; // durée EXPLICITE du défi
  }
  if (cfg.runwayClosedSeconds > 0) {
    const rw = state.sim.infra.runways[0]; // plan de départ A-2 : la piste fournie
    if (!rw) throw new Error(`scénario ${mode} : fermeture de piste impossible (aucune piste au départ)`);
    forceIncident(state.sim, `runway:${rw.id}`); // l'action EXISTANTE R32 (attachée à l'actif)
    state.sim.incidents.runways[rw.id].remaining = cfg.runwayClosedSeconds; // durée EXPLICITE du défi
  }
  return state;
}

// L'objectif ANNONCÉ du scénario en cours (le toast de lancement + le panneau
// « Scénario » le lisent). Lecture seule : la sim décide, l'UI n'affiche.
function scenarioObjective(state) {
  const sc = state && state.scenario;
  const cfg = sc && SCENARIOS[sc.id];
  if (!sc || !cfg) return null; // mode libre : pas d'objectif annoncé
  const o = OBJECTIVES.find((x) => x.id === cfg.objective);
  return { id: cfg.objective, name: o ? o.name : cfg.objective,
           reward: o ? o.reward : 0, text: o ? o.desc : '' };
}

// Statut de l'objectif annoncé (lecture mesurée de l'état — la sim reste la
// source ; la QA rejoue ce critère avec des politiques documentées). La
// réussite = l'objectif R22 payé (compté par tickObjectives, la seule porte).
function scenarioSuccess(state) {
  const sc = state && state.scenario;
  const o = scenarioObjective(state);
  if (!sc || !o) return null; // mode libre : pas d'objectif annoncé
  const paid = (state.sim?.objectives || []).some((s) => s.id === sc.objective && s.paid);
  return { done: paid, label: `${o.name} (récompense ${o.reward} $)` };
}

__exports.SATURATION_SURGE_S = SATURATION_SURGE_S;
__exports.REDRESSEMENT_FUNDS = REDRESSEMENT_FUNDS;
__exports.CRISIS_SURGE_S = CRISIS_SURGE_S;
__exports.CRISIS_RUNWAY_CLOSE_S = CRISIS_RUNWAY_CLOSE_S;
__exports.CAP_NORD_FUNDS = CAP_NORD_FUNDS;
__exports.SCENARIOS = SCENARIOS;
__exports.startScenario = startScenario;
__exports.scenarioObjective = scenarioObjective;
__exports.scenarioSuccess = scenarioSuccess;
})(__reg['m_src_scenarios']);

/* --- module src/flights/flights.mjs --- */
(function (__exports) {
// Vols : le planificateur PLANIFIE des vols entrants (planning consultable),
// la sim les route. Logique pure, déterministe si rng est semé.
// BL-07 (AC3/NONMVP-8) : fin du générateur aléatoire invisible.
//   - Les vols sont créés AVANT leur arrivée dans sim.planning (compagnie,
//     appareil, passagers, heure prévue, état) : l'UI (BL-16) les consulte,
//     le joueur accepte/refuse via decideFlight.
//   - Un vol planifié à la fenêtre N arrive à la fenêtre N+1 (visible ~60 s
//     avant sa venue) ; à son heure prévue il devient avion réel (approach).
//   - Un vol refusé est retiré du planning (n'arrive jamais).
//   - L'attribution (compatible/disponible/accessible + alternatives) est
//     calculée pour que le joueur voie POURQUOI un vol part ou reste en attente.
// Horloge : le planificateur EST le propriétaire de sim.time (sim.time += dt) —
// la sim avance au temps de JEU, indépendamment de l'horloge UI (state.time).
const { AIRLINES, AIRCRAFT } = __ns('m_src_data_catalog');
const { runwayFor } = __ns('m_src_infra_infra');
const { pushEvent } = __ns('m_src_core_sim-state');
const { rebuildGraph, findPath, gateNodeOf, runwayExitNode } = __ns('m_src_pathfinding_path');
const { isSurge, runwayClosed, fuelOut } = __ns('m_src_sim_incidents');
const { activeContract } = __ns('m_src_flights_contracts');
const { spawnLayer } = __ns('m_src_core_difficulty');
const { qualityTier, Q_TIERS } = __ns('m_src_progression_quality');
const { PAX_REVENUE, PAX_REVENUE_DRY, LANDING_FEE, GATE_FEE, FUEL_COST_PER_PAX } = __ns('m_src_economy_economy');

const SPAWN_EVERY_S = 60;  // cadence d'une fenêtre (x4 raisonnable)
const MAX_PENDING = 4; // plafond UNIQUE d'arrivées (A-5) : au-delà, on n'en fait plus arriver
// R26 (t_62ffa6bc) : le plafond n'est plus un nombre caché — c'est un PARAMÈTRE
// de la sim (sim.pendingCap, sérialisé), borné [MAX_PENDING, PENDING_CAP_MAX].
// Scénarios de croissance : le joueur (ou un futur module d'investissement)
// l'ajuste pour absorber la demande qu'il ouvre (portes/pistes en plus) —
// l'agrandissement ne se heurte JAMAIS à un plafond dur invisible.
const PENDING_CAP_MAX = 8; // borne haute bornée (pas de croissance illimitée — spec R26)
// Lecture du plafond effectif (une seule source : sim.pendingCap, borné) :
// le planificateur l'applique, le panneau le lit, les tests le forcent.
function pendingCap(sim) {
  const cap = sim.pendingCap ?? MAX_PENDING; // absent (sauvegarde ancienne) → 4 (comportement A-5)
  return Math.min(PENDING_CAP_MAX, Math.max(MAX_PENDING, Math.floor(cap) || MAX_PENDING));
}
// Politique explicite (A-5, cohérent avec l'annulation bloquée à 10 min d'aircraft.mjs) :
// une OFFRE jamais décidée (état « planned ») expire 10 min sim après son heure prévue →
// refusé (événement lisible), sa place se libère, le planificateur repart. En attendant,
// elle reste décisionnable : l'acceptation tardive déploie dès la capacité libre (pas
// d'attente d'une fenêtre). Un vol « planned » ne se déploie JAMAIS seul (BL-16).
const OFFER_DECISION_S = 600; // 10 min sim : délai de décision d'une offre

// Le planificateur : horloge + planification (fin du générateur invisible)
// + déploiement + retards + purge.
// R13 : la CRÉATION des offres (fenêtre, 1 par SPAWN_EVERY_S) est séparée de
// la VÉRIFICATION des vols acceptés arrivés à échéance (deployDue, À CHAQUE
// TICK) : un vol accepté en retard n'attend pas une fenêtre si la capacité
// est libre. Ordre par tick : horloge → fenêtre (créer les offres) → vols dus
// → offres expirées → retards → purge.
function tickPlanner(sim, dt, rng = Math.random) {
  sim.time = (sim.time ?? 0) + dt; // horloge de la sim (pilotée par le planificateur)
  // Plusieurs fenêtres franchies sur le même pas (dt gros, ou jeu ralenti puis repris) :
  // on boucle SANS duplication (le déploiement passe par l'état « in-flight », idempotent)
  // et on PRÉSERVE le reste de l'accumulateur (pas = 90 s → 1 fenêtre + 30 s conservées).
  sim._spawnAcc = (sim._spawnAcc ?? 0) + dt;
  const windows = Math.floor(sim._spawnAcc / SPAWN_EVERY_S);
  if (windows > 0) {
    sim._spawnAcc -= windows * SPAWN_EVERY_S; // reste conservé
    for (let w = 0; w < windows; w++) windowClose(sim, rng); // création des offres
  }
  deployDue(sim);   // vols acceptés arrivés à échéance (chaque tick)
  expireOffers(sim); // offres jamais décidées → refusées (chaque tick)
  for (const a of sim.aircraft) {
    if (a.phase !== 'approach' && a.phase !== 'holding') continue;
    const ac = AIRCRAFT[a.acType];
    // R17 (D7, t_fc0d1920) : le planificateur NE CUMULE PLUS ac.delayed ici —
    // doHolding (aircraft.mjs) est le SEUL compteur du retard d'atterrissage.
    // Avant R17, les deux modules cumulaient le MÊME retard 2× (« un avion
    // arrêté ne cumule pas 2× le même retard dans plusieurs modules ») ;
    // la cause du retard reste LISIBLE (causeAt, aircraft.mjs) et l'état
    // « retardé » du planning est maintenu ci-dessous (marquage lisible).
    // R32 : la fermeture piste est PAR PISTE — un atterrissage n'est retardé
    // que si AUCUNE piste compatible n'est OUVERTE (l'autre piste, ouverte,
    // reste utilisable : la fermeture ne retarde pas tout le trafic). on
    // distingue « piste fermée » (compatible mais toutes fermées) de « pas de
    // piste compatible » (le critère 6, ci-dessous).
    const compatible = (sim.infra.runways || []).filter((r) => r.len >= ac.minRunway);
    if (compatible.length && compatible.every((r) => runwayClosed(sim, r.id))) {
      markPlannedDelayed(sim, a.id, 'piste fermée — atterrissage en attente');
      continue;
    }
    // pas de piste assez longue ni de porte de taille : retard (critère 6).
    // R05 : le critère « piste compatible » est centralisé (infra.mjs).
    if (!runwayFor(sim, ac.minRunway) ||
        !sim.infra.gates.some((g) => g.size === ac.gate)) {
      markPlannedDelayed(sim, a.id, 'pas de piste/porte compatible');
    }
  }
  purge(sim);
}

// Fermeture d'une fenêtre : CRÉATION des offres uniquement (R13 — le
// déploiement des vols dus et l'expiration des offres se font chaque tick,
// voir tickPlanner). Si la file (avions en attente + offres planifiées/
// acceptées) est sous le plafond et qu'il y a au moins une piste, on planifie
// le vol suivant (visible ~60 s avant).
// Le plafond (A-5) compte la file ENTIÈRE (R13) : les avions DÉPLOYÉS sont
// déjà dans pendingCount — on ne les compte PAS une seconde fois via leurs
// entrées de planning (elles passent en « in-flight » au déploiement, donc
// plus jamais comptées dans le second terme : aucun double comptage).
// BL-14 : en pic de demande (surge), la cadence est DOUBLÉE (2 vols par
// fenêtre) — le pic se mesure au nombre de vols planifiés.
// T3 (t_76744b22) : la fenêtre est exposée (export) pour que la couche de
// SAISONS (spawnLayer) soit TESTABLE en isolation (le comptage des offres est
// la mesure de la cadence) — même pattern que les forceIncident/forceWeather.
function windowClose(sim, rng) {
  if (sim.infra.runways.length) {
    // R26 : le contrat ACTIF ouvre une augmentation ANNONCÉE de demande
    // (+1 offre par fenêtre, comme le pic BL-14) — l'engagement augmente
    // RÉELLEMENT les vols proposés ; la capacité pour les traiter est le
    // paramètre pendingCap (plafond borné) + l'infra (portes/pistes).
    // T3 (t_76744b22) : la COUCHE DE SAISONS (spawnLayer, difficulty.mjs —
    // les PARAMÈTRES DE SPAWN s'additionnent sans modifier la règle) : le
    // facteur de cadence de la saison courante MULTIPLIE le nombre d'offres
    // de la fenêtre (arrondi entier, plancher 1 : une fenêtre ne génère
    // JAMAIS 0 offre — le comportement de référence est préservé, le
    // printemps ×1 est bit-à-bit identique à avant).
    const base = (isSurge(sim) ? 2 : 1) + (activeContract(sim) ? 1 : 0);
    const n = Math.max(1, Math.round(base * spawnLayer(sim).spawnFactor));
    const cap = pendingCap(sim); // R26 : le plafond est un PARAMÈTRE de la sim (borné)
    for (let k = 0; k < n; k++) {
      const pending = pendingCount(sim) + sim.planning.filter((e) => e.status === 'planned' || e.status === 'accepted').length;
      if (pending >= cap) break;
      planOneFlight(sim, rng);
    }
  }
}

// Déploie les vols PRÉ-ACCEPTÉS dont l'heure prévue est atteinte.
// BL-16 (AC20) : seuls les vols « accepted » se déploient — un vol resté
// « planned » (jamais accepté) N'ARRIVE JAMAIS : le générateur invisible est
// fini, c'est le JOUEUR qui décide (boutons du panneau ou case auto-accept).
// Tolerance de 1 s : sim.time est une somme de dt flottants (dérive de ~1e-14),
// l'heure prévue (un multiple de 60 s) ne doit pas rester éternellement
// « pas encore à l'heure » à cause de l'arrondi binaire.
// R13 : PAS de double comptage — l'avion poussé à l'instant est DÉJÀ dans
// pendingCount (phase « approach ») : le plafond se vérifie sur pendingCount
// seul, qui inclut ce qui vient d'être déployé au cours de cette passe.
// Appelé à CHAQUE tick (pas seulement aux fenêtres) : un vol accepté dont
// l'heure est arrivée ne patiente PAS une minute s'il y a une place libre.
// Idempotent : une fois déployé, l'entrée passe en « in-flight » et n'est
// jamais re-déployée (pas de duplication au pas gros ou aux arrondis).
function deployDue(sim) {
  if (!sim.infra.runways.length) return; // rien à poser → pas de vols
  for (const e of sim.planning) {
    if (e.status !== 'accepted') continue; // planned = en attente de décision JOUEUR (ou expiration)
    if (e.planned > sim.time + 1) continue; // pas encore son heure (tolérance 1 s)
    if (pendingCount(sim) >= pendingCap(sim)) break; // plafond (A-5/R26) : compte les avions déjà poussés ici
    sim.aircraft.push(makeAircraft(sim, e));
    pushEvent(sim, { kind: 'flight-in', volId: e.id, airline: airlineName(e.airline), acType: e.acType });
  }
}

// R13 : politique EXPLICITE pour les offres jamais décidées (A-5, cohérente
// avec l'annulation des avions bloqués après 10 min d'aircraft.mjs).
// Une offre « planned » dont l'heure prévue est dépassée de plus de
// OFFER_DECISION_S (10 min sim) est REFUSÉE : retirée du planning + événement
// lisible — sa place (comptée dans le plafond A-5) se libère et le
// planificateur repart. Tant que l'offre est vivante, elle reste décisionnable
// (acceptation tardive → déploiement immédiat si capacité libre, voir deployDue).
function expireOffers(sim) {
  const expired = sim.planning.filter((e) => e.status === 'planned' && e.planned + OFFER_DECISION_S <= sim.time);
  if (!expired.length) return;
  const ids = new Set(expired.map((e) => e.id));
  sim.planning = sim.planning.filter((e) => !ids.has(e.id));
  for (const e of expired) pushEvent(sim, { kind: 'flight-offer-expired', volId: e.id, airline: airlineName(e.airline), why: 'offre jamais décidée (10 min)' });
}

// Rétrocompat : un appel DIRECT de spawnArrivals (tests historiques, sans
// tickPlanner) planifie ET déploie un vol immédiatement. En jeu, c'est
// tickPlanner qui fait le travail (le planning reste consultable avant arrivée).
function spawnArrivals(sim, dt, rng = Math.random) {
  sim._spawnAcc = (sim._spawnAcc ?? 0) + dt;
  const windows = Math.floor(sim._spawnAcc / SPAWN_EVERY_S);
  if (windows < 1) return;
  sim._spawnAcc -= windows * SPAWN_EVERY_S; // R13 : reste conservé (comme tickPlanner)
  if (!sim.infra.runways.length) return;
  if (pendingCount(sim) >= pendingCap(sim)) return; // plafond (A-5/R26) : on n'en fait plus
  // Planning vide (aucun vol à déployer) → on en planifie UN, d'arrivée immédiate,
  // pour qu'un spawn forcé en produise toujours un (comportement historique).
  const due = sim.planning.some((e) => ['planned', 'accepted'].includes(e.status) && e.planned <= (sim.time ?? 0));
  if (!due) {
    const e = planOneFlight(sim, rng); // planOneFlight pousse dans sim.planning
    if (e) { // null = aucune infra servable (t_00ecae73) → pas de spawn forcé
      e.planned = sim.time ?? 0; // immédiat (pas d'attente de fenêtre)
      e.status = 'accepted'; // spawn FORCÉ = pré-accepté (la décision joueur ne concerne que le flux planning/panneau)
    }
  }
  deployDue(sim);
}

// Crée UNE entrée de planning (le prochain vol) : visible SPAWN_EVERY_S AVANT
// son arrivée. Déterministe si rng est semé ; l'heure prévue est une heure SIM
// (sim.time + SPAWN_EVERY_S), lisible dans le planning (AC3 « horaires prévus »).
// Retourne l'entrée créée (le planificateur la relocalise si besoin, ex. spawn
// forcé immédiat : e.planned = maintenant).
// t_00ecae73 : le planificateur ne planifie QUE des appareils SERVIBLES par
// l'infra existante (une piste assez longue ET une porte de la bonne taille).
// Avant : pick(rng, AIRLINES) tirait au hasard → l'aéroport de base (2 portes M
// seulement) planifiait des vols small (porte S) et large (porte L) qu'il ne
// pouvait PAS servir → bloqués 10 min → annulés → 319 k$ d'indemnités (6×
// l'opex total) → l'aéroport DÉFICITAIRE PAR CONSTRUCTION. C'était la cause
// racine qui forçait le capital artificiel (BL-18, 12 k → 345 k). La règle
// « servable » est la même que attributeFlight : piste ≥ minRunway + porte de
// la taille. Si l'infra ne sert AUCUN type → pas de vol planifié (on ne fait
// pas arriver un avion que l'aéroport ne pourrait jamais desservir).
// R26 : le palier qualité filtre les TAILLES que le planificateur est
// autorisé à proposer (Q_TIERS, quality.mjs) — la réputation mesurée
// module l'offre (bornes + inertie dans le module, jamais 2 règles).
// Le filtre « servable » (infra) s'applique EN PLUS : les 2 filtres se
// combinent, jamais l'un ne contredit l'autre.
// G3 (t_26f71267) : « servable » exige aussi la JOIGNABILITÉ de la porte —
// hasAccessiblePath, LA même règle que attributeFlight.accessible (jamais 2
// règles divergentes : le planificateur et le panneau lisent la MÊME règle de
// servabilité). Avant : le filtre ne regardait que l'EXISTENCE d'une porte
// (g.size === spec.gate) → un petit avion était proposé alors que sa porte S
// était COUPÉE du réseau (ex. 2e terminal mal placé) → atterrit, bloqué,
// annulé (indemnité 500 $, revenu 0) → hémorragie d'indemnités → faillite.
// La porte existe mais l'avion ne peut PAS y rouler : on ne planifie qu'un
// vol que l'aéroport peut effectivement desservir.
// ponytail : hasAccessiblePath subsume le test d'EXISTENCE de porte (elle ne
// renvoie true que si une porte de la taille est atteignable) → on ne le garde
// pas ; runwayFor reste car la LONGUEUR de piste n'est pas subsumée (une sortie
// de piste quelconque suffit à hasAccessiblePath, pas une piste assez longue).
function servableTypes(sim) {
  const tierSizes = Q_TIERS[qualityTier(sim)].sizes;
  return Object.keys(AIRCRAFT).filter((k) => {
    if (!tierSizes.includes(k)) return false; // R26 : taille au-dessus du palier → pas proposée
    const spec = AIRCRAFT[k];
    return !!runwayFor(sim, spec.minRunway) // R05 : piste ASSEZ LONGUE (critère centralisé infra.mjs)
      && hasAccessiblePath(sim, spec.gate); // G3 : porte JOIGNABLE (même règle que attributeFlight)
  });
}

// T3 (t_4c9baadc) : opts ADDITIF (reproductible — sans opts le comportement
// est inchangé) : la couche d'événements dynamiques (sim/events.mjs) injecte
// des vols à caractéristiques EXPLICITES (paxRatio = fraction des sièges,
// planned = heure prévue imposée, event = marqueur lisible). MÊME entrée,
// MÊME mécanisme de décision (planning) — pas de 2e règle de vol.
function planOneFlight(sim, rng, opts = {}) {
  const servable = servableTypes(sim);
  if (!servable.length) return null; // aucune infra servable → pas de vol
  // Tirer d'abord un type SERVABLE, puis une compagnie qui l'opère : chaque
  // type du catalogue est opéré par au moins une compagnie.
  const acType = pick(rng, servable);
  const airline = pick(rng, AIRLINES.filter((a) => a.types.includes(acType)));
  const ac = AIRCRAFT[acType];
  const e = {
    id: sim.nextAcId++,
    airline: airline.id,
    color: airline.color,
    acType,
    pax: opts.paxRatio != null
      ? Math.max(0, Math.round(ac.seats * opts.paxRatio)) // T3 : remplissage explicite (événement)
      : Math.max(0, Math.round(ac.seats * (0.4 + 0.5 * rng()))), // remplissage variable
    planned: opts.planned != null ? opts.planned : (sim.time ?? 0) + SPAWN_EVERY_S, // T3 : heure imposée (événement)
    status: 'planned',                         // planned → accepted (déploiement à l'heure prévue)
  };
  if (opts.event) e.event = opts.event; // T3 : marqueur d'événement (lecture lisible)
  sim.planning.push(e);
  return e;
}

// Fait d'un vol planifié un avion réel (phase 'approach'). L'entrée de planning
// passe en « in-flight » : informative (le vol reste consultable tant qu'il est
// en cours, état/retard lisibles), jamais re-déployée (purge au départ).
function makeAircraft(sim, e) {
  const airline = airlineOf(e.airline);
  e.status = 'in-flight';
  const ac = {
    id: e.id, airline: e.airline, color: airline.color, acType: e.acType, pax: e.pax,
    phase: 'approach',
    x: 200 + (e.id % 1200), // position d'approche déterminée par l'id (pas rng, AC18)
    y: -150,
    gateId: null, runwayId: null, delayed: 0, timer: 0,
    path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  // R24 : l'opération enregistre son contrat — si le contrat ACTIF existe, le
  // vol compte pour la période du contrat (logFlightEnd → countContractFlight).
  // Les vols hors contrat (aucun contrat actif) n'ont pas le champ.
  const contract = activeContract(sim);
  if (contract) { ac.contractId = contract.id; ac.contractModel = contract.model; }
  return ac;
}

// Retard (critère 6, AC3) : la CAUSE du retard est portée par l'entrée de
// planning du vol EN COURS (« in-flight » → « delayed » + why) → lisible dans
// le planning (état + cause), pas seulement sur l'avion. R17 (t_fc0d1920) :
// la cause est PASSEE en paramètre (chaque site donne sa propre cause —
// « piste fermée » ou « pas de piste/porte compatible »), le retard est
// accumulé PAR doHolding (aircraft.mjs, D7) — pas ici.
function markPlannedDelayed(sim, volId, why) {
  const e = sim.planning.find((p) => p.id === volId);
  if (e && e.status === 'in-flight') { e.status = 'delayed'; e.why = why || 'pas de piste/porte compatible'; }
}

// Purge les vols annulés/partis : on retire LEUR entrée de planning (le planning
// reste consultable tant que le vol est en cours ; il disparaît quand il termine).
// Les entrées planned/accepted n'ont PAS (encore) d'avion — on ne les purge pas :
// ce n'est pas leur avion qui a disparu, c'est le vol qui n'est pas encore né.
// R23 (fuite porte) : les avions purgés peuvent laisser une porte RÉSERVÉE à eux
// (g.acId) — la libération sûre se fait au pushback, mais un vol qui PART ou
// s'annule sans pushback réussi (bloque → annulation A-5, ou pathfind raté)
// laisse le pointage. On balaye AVANT le filtre : jamais de référence périmée
// (la validation de sauvegarde R10 lèverait, et un avion bloqué sur « la porte
// d'un mort » resterait bloqué à jamais).
function purge(sim) {
  const dying = new Set(sim.aircraft.filter((a) => a.phase === 'cancelled' || a.phase === 'departed').map((a) => a.id));
  if (dying.size) {
    for (const g of sim.infra.gates) if (g.acId != null && dying.has(g.acId)) g.acId = null;
  }
  sim.aircraft = sim.aircraft.filter((a) => a.phase !== 'cancelled' && a.phase !== 'departed');
  sim.planning = sim.planning.filter((e) =>
    e.status === 'planned' || e.status === 'accepted' || sim.aircraft.some((a) => a.id === e.id));
}

// N'avions en attente/route (approche/holding/landing/blocked) : le plafond A-5.
function pendingCount(sim) {
  return sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
}

// Décision du joueur (AC3, NONMVP-8) : ACCEPTER ou REFUSER un vol planifié.
// Refus : l'entrée est retirée du planning → le vol n'arrivera jamais.
// Acceptation : le vol reste planifié et se déploiera à son heure prévue.
// Côté sim (règle) ; l'UI (BL-16) l'appelle après clic. Retourne true si la
// décision a eu un effet, false si le vol n'est plus décisionnable (en cours,
// déjà refusé, ou déjà déployé).
function decideFlight(sim, volId, accept) {
  const e = sim.planning.find((p) => p.id === volId);
  if (!e || e.status !== 'planned') return false; // planned = le seul état décisionnable
  if (accept) { e.status = 'accepted'; return true; }
  sim.planning = sim.planning.filter((p) => p.id !== volId); // refus : retiré
  return true;
}

// Attribution compatible/disponible/accessible + alternatives (BL-07, AC3) :
// pour un appareil, dit si le terrain le SERVE :
//   compatible   : une piste ASSEZ LONGUE + une porte DE LA BONNE TAILLE existent
//   disponible   : un slot d'arrivée n'est pas saturé (plafond MAX_PENDING)
//   accessible   : le réseau (taxiways) relie la sortie de piste à UNE porte
//   alternatives : les autres tailles d'avion que l'aéroport, lui, sait servir
//   cause        : motif lisible si non compatible/disponible/accessible
function attributeFlight(sim, acType) {
  const ac = AIRCRAFT[acType];
  // R05 : « compatible » = UNE piste ASSEZ LONGUE + UNE porte DE LA BONNE TAILLE
  // (critère centralisé : infra.mjs) — le gain de la 2e piste est ici MESURABLE
  // (la compatibilité ne dépend plus de la 1re piste seulement).
  const hasRunway = !!runwayFor(sim, ac.minRunway);
  const hasGate = sim.infra.gates.some((g) => g.size === ac.gate);
  const compatible = hasRunway && hasGate;
  const available = pendingCount(sim) < pendingCap(sim);
  const accessible = compatible && hasAccessiblePath(sim, ac.gate);
  const alternatives = Object.keys(AIRCRAFT)
    .filter((k) => k !== acType && !!runwayFor(sim, AIRCRAFT[k].minRunway)
      && sim.infra.gates.some((g) => g.size === AIRCRAFT[k].gate));
  let cause = 'servi';
  if (!hasRunway) cause = `piste trop courte (voulue ≥ ${ac.minRunway})`;
  else if (!hasGate) cause = `pas de porte de taille ${ac.gate}`;
  else if (!accessible) cause = 'réseau coupé : le taxiway ne relie pas piste et porte';
  else if (!available) cause = 'aérogare saturée (plafond d’arrivées)';
  return { acType, compatible, available, accessible, alternatives, cause };
}

// R19 (t_f69dd9c9) — note de DÉCISION d'une offre du planning (offre « planned »)
// : les chiffres (taille/pax/revenu estimé) et les OBSTACLES/RISQUES, pour que
// le panneau planning soit un outil de décision, pas une liste muette.
// Règle de sim (exportée), l'UI (planning-panel.mjs) la rend seulement :
//   - compatibilité = le MÊME critère unique que attributeFlight (piste assez
//     longue + porte de la bonne taille, infra.mjs) — pas de 2e règle ;
//   - revenu estimé = hypothèse LISIBLE, jamais une promesse :
//     billets (pax × PAX_REVENUE, onGateDeparted, MOITIÉS sans station
//     carburant — ac._dryDeparture) + droits atterrissage/porte (onGateArrived)
//     carburant (FUEL_COST_PER_PAX, onGateDeparted) — les 4 montants viennent
//     de economy.mjs (source unique, pas de chiffres copiés ici) ;
//     le préfixe « estimé » + la satisfaction qui multiplie earn() (economy.mjs)
//     rappellent que c'est une estimation, pas un chiffre garanti ;
//   - risques : ce qui peut DETERIORER le vol une fois accepté (file d'arrivées
//     au plafond MAX_PENDING, station carburant en panne → billets moitiés).
//     « Risque » ≠ « obstacle » : l'obstacle rend l'offre impossible (la sim
//     l'explique via le cause d'attributeFlight) ; le risque ne bloque pas,
//     il a un coût (pas de promesse de rentabilité certaine — critère R19).
// C'est une FONCTION PURE de lecture (pas de mutation de sim) — l'UI peut
// l'appeler à chaque rendu sans effet de bord.
function planNote(sim, e) {
  const ac = AIRCRAFT[e.acType] || {};
  if (!ac.name) {
    // Type d'avion inconnu (entrée corrompue) : obstacle explicite, pas de
    // crash — attributeFlight lirait un spec absent.
    return { compatible: false, obstacles: [`avion inconnu (${e.acType})`], risks: [], revenue: 0, spec: {} };
  }
  const attr = attributeFlight(sim, e.acType); // MÊME critère que la sim (R05)
  const obstacles = [];
  if (!attr.compatible) {
    // L'offre est IMPOSSIBLE : l'obstacle est EXPLIQUÉ (cause lisible) —
    // critère R19 « une offre impossible explique son obstacle ».
    obstacles.push(attr.cause);
  }
  // Risque 1 : saturation des arrivées (plafond A-5, paramètre R26) — le vol
  // sera en attente (holding), retard. Le plafond est le MÊME pendingCap
  // (paramètre de la sim) que le déploiement — jamais un nombre en dur ici.
  const pending = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
  const cap = pendingCap(sim);
  const risks = [];
  if (pending >= cap) risks.push(`file d'arrivées saturée (${pending}/${cap}) : retard probable`);
  // Risque 2 : station carburant ABSENTE ou EN PANE → départ sec, billets
  // moitiés (la pénalité existe, elle est lisible AVANT la décision).
  const hasFuelStation = sim.infra.services.some((s) => s.type === 'fuel');
  if (!hasFuelStation) risks.push('pas de station carburant : départ sec (billets moitiés)');
  else if (fuelOut(sim)) risks.push('panne station carburant en cours : départ sec probable (billets moitiés)');
  // Revenu estimé (hypothèse, non garantie) — montants de economy.mjs.
  const revenue = (e.pax ?? 0) * (hasFuelStation ? PAX_REVENUE : PAX_REVENUE_DRY)
    + LANDING_FEE + GATE_FEE - (e.pax ?? 0) * FUEL_COST_PER_PAX;
  return {
    compatible: attr.compatible,
    obstacles,   // [] si servable ; sinon le motif (piste/porte/réseau)
    risks,       // [] si rien ; sinon les risques sans promesse de rentabilité
    revenue,     // estimé (hypothèse) — le préfixe « estimé » est à l'UI
    spec: ac,    // taille/charge (seats) pour l'affichage
  };
}

// Le réseau relie-t-il la sortie de piste à UNE porte de la bonne taille ?
// (findPath sur le graphe, occupation vide : la question est « est-ce joignable »)
function hasAccessiblePath(sim, gateSize) {
  if (sim._graphDirty) { rebuildGraph(sim); sim._graphDirty = false; }
  if (!sim._graph) return false;
  const occupied = new Set(); // « joignable » = sans conflit d'occupation
  for (const g of sim.infra.gates) {
    if (g.size !== gateSize) continue;
    const to = gateNodeOf(sim, g.id);
    if (to == null) continue; // porte hors réseau (aucun taxiway ne la touche)
    for (const r of sim.infra.runways) {
      const from = runwayExitNode(sim, r.id);
      if (from == null) continue;
      if (findPath(sim, from, to, occupied)) return true;
    }
  }
  return false;
}

function airlineOf(id) { return AIRLINES.find((x) => x.id === id) || AIRLINES[0]; }
function airlineName(id) { return airlineOf(id).name; }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

__exports.MAX_PENDING = MAX_PENDING;
__exports.PENDING_CAP_MAX = PENDING_CAP_MAX;
__exports.pendingCap = pendingCap;
__exports.OFFER_DECISION_S = OFFER_DECISION_S;
__exports.tickPlanner = tickPlanner;
__exports.windowClose = windowClose;
__exports.spawnArrivals = spawnArrivals;
__exports.planOneFlight = planOneFlight;
__exports.decideFlight = decideFlight;
__exports.attributeFlight = attributeFlight;
__exports.planNote = planNote;
})(__reg['m_src_flights_flights']);

/* --- module src/progression/achievements.mjs --- */
(function (__exports) {
// T2-2 (t_6344db94) — SUCCÈS (achievements) DÉBLOCABLES : 8 succés à
// conditions MESURABLES dans l'état sim (règle R21 : chaque condition lit
// un fait de la sim — jamais un compteur abstrait ni un timer). Le champ
// vit sur la SIM (sim.achievements — sérialisé avec l'état entier par
// save.mjs, pattern intro.mjs : un succès DÉBLOQUÉ reste débloqué après
// sauvegarde/rechargement). Un déblocage pousse UN événement
// « achievement-unlocked » (toast/juice/sfx) — et JAMAIS UN SECONDF (le
// flag `unlocked` verrouille, comme le `paid` des objectifs R22).
// LA RÈGLE est décidée par tickAchievements (la sim, tick par tick), pas
// par l'UI : le panneau est une LECTURE (achievementsView).
const { qualityTier } = __ns('m_src_progression_quality');
const { punctualityStats } = __ns('m_src_sim_aircraft');
const { pushEvent } = __ns('m_src_core_sim-state');

// Les 8 SUCCÈS : chaque condition est une LECTURE de la sim (pas de
// mutation) — la sim est la source, le succès est la conséquence affichée.
// Les identifiants sont STABLES (sérialisés sur sim.achievements.unlocked) :
// une sauvegarde d'une partie en cours reprend les succès déjà débloqués.
const ACHIEVEMENTS = Object.freeze([
  {
    id: 'pax-100', name: 'Premiers pas',
    desc: 'Transporter 100 passagers',
    cond: (sim) => (sim.passengers?.totalCarried ?? 0) >= 100, // compteur EXISTANT
  },
  {
    id: 'pax-500', name: 'Affluence',
    desc: 'Transporter 500 passagers',
    cond: (sim) => (sim.passengers?.totalCarried ?? 0) >= 500,
  },
  {
    // UNE période close avec net > 0 (la mesure est le net de la période —
    // periodStatement, economy.mjs) : le BÉNÉFICE est un fait du bilan.
    id: 'profit-period', name: 'Premier bénéfice',
    desc: 'Clôturer une période avec un bénéfice',
    cond: (sim) => sim._nonNegPeriod || (sim.economy?.periods || []).some((p) => (p?.net ?? 0) > 0),
  },
  {
    id: 'balance-50k', name: 'Réserve',
    desc: 'Atteindre un solde de 50 000 $',
    cond: (sim) => (sim.economy?.money ?? 0) >= 50000,
  },
  {
    // 6 périodes CONSECUTIVES sans déficit (la série persiste dans
    // sim.stats — stats.mjs, alimentée par la seule close de période) :
    // la CONSTANCE, pas un compteur de temps.
    id: 'streak-6', name: 'Constance',
    desc: 'Enchaîner 6 périodes sans déficit',
    cond: (sim) => (sim.stats?.nonDeficit?.best ?? 0) >= 6,
  },
  {
    // 5 incidents TERMINÉS pendant que le jeu continuait (stats.mjs — la
    // transition d'actifs → survivus, incidents.mjs est la source) :
    // la RÉSILIENCE face aux aléas (R32 : la fréquence des incidents est
    // l'aléa du jeu).
    id: 'survivor-5', name: 'Résilience',
    desc: 'Survivre à 5 incidents',
    cond: (sim) => (sim.stats?.incidentsSurvived ?? 0) >= 5,
  },
  {
    // Le palier QUALITÉ est OFFERT (R21 : les 3 tailles sont offertes — la
    // mesure est le palier quality, jamais un compteur de pax) : l'EXCELLENCE.
    // Le palier ne compte que MESURÉ (une fin de vol dans la fenêtre R17 —
    // punctualityStats) : une sim neuve démarre q = 1 (« départ neuf ») —
    // sans mesure réelle, le palier est un état de départ, pas un fait.
    id: 'quality-2', name: 'Excellence',
    desc: 'Offrir les 3 tailles (palier qualité, mesuré)',
    cond: (sim) => qualityTier(sim) >= 2 && punctualityStats(sim).total > 0,
  },
  {
    // La VICTOIRE de la campagne (campaign.mjs) : le but global du jeu.
    id: 'season-won', name: 'Saison remportée',
    desc: 'Remporter la saison (3 contrats réussis)',
    cond: (sim) => sim.campaign?.status === 'won',
  },
]);

function fresh() {
  // id → horodatage du déblocage (sim.time). Le format est borné : un champ
  // présent mais au mauvais format est reconstruit (pattern R31/R32) —
  // jamais de crash, les succès se PERDENT proprement (compteurs perdus).
  return { unlocked: {} };
}

// Initialisation paresseuse + RÉPARATION défensive (pattern R31/R32).
// Sauvegarde PRÉ-T2-2 : le champ est ABSENT → aucun succès débloqué (une
// partie ancienne reprend exactement comme avant, pas de faux déblocage).
function ensureAchievements(sim) {
  const a = sim.achievements;
  const ok = a && typeof a === 'object'
    && a.unlocked && typeof a.unlocked === 'object'
    && Object.values(a.unlocked).every((v) => v === true || Number.isFinite(v));
  if (!ok) sim.achievements = fresh();
  return sim.achievements;
}

// LE tick succès (la sim, après les autres ticks — il lit campagne, stats,
// palier qualité : les FAITS de ce tick sont déjà posés) : pour chaque
// succès NON débloqué dont la condition est VRAIE → déblocage ATOMIQUE
// (flag + événement dans la même écriture) ; l'événement « achievement-
// unlocked » porte le nom + la description (le toast) — et JAMAIS UN
// SECONDF (le flag verrouille, idempotent comme le `paid` des objectifs).
function tickAchievements(sim) {
  const a = ensureAchievements(sim);
  for (const c of ACHIEVEMENTS) {
    if (a.unlocked[c.id] !== undefined) continue; // déjà débloqué (jamais re)
    if (!c.cond(sim)) continue; // condition non remplie : jamais de faux
    a.unlocked[c.id] = sim.time; // l'horodatage du déblocage (sérialisé)
    pushEvent(sim, { kind: 'achievement-unlocked', id: c.id, name: c.name, desc: c.desc });
  }
}

// LECTURE seule (panneau) : la liste des succès + leur état (débloqué à
// quel temps / à venir) — le panneau ne décide rien (la sim a déjà décidé).
function achievementsView(sim) {
  const a = ensureAchievements(sim);
  return ACHIEVEMENTS.map((c) => ({
    id: c.id, name: c.name, desc: c.desc,
    unlocked: a.unlocked[c.id] !== undefined,
    at: a.unlocked[c.id],
  }));
}

// Nombre de succès DÉBLOQUÉS (lecture — le panneau affiche « n/8 »).
function unlockedCount(sim) {
  return Object.keys(ensureAchievements(sim).unlocked).length;
}

__exports.ACHIEVEMENTS = ACHIEVEMENTS;
__exports.ensureAchievements = ensureAchievements;
__exports.tickAchievements = tickAchievements;
__exports.achievementsView = achievementsView;
__exports.unlockedCount = unlockedCount;
})(__reg['m_src_progression_achievements']);

/* --- module src/sim/events.mjs --- */
(function (__exports) {
// T3 (t_4c9baadc) : COUCHE D'ÉVÉNEMENTS DYNAMIQUES — des événements injectent
// du travail dans la sim PAR LES MODULES EXISTANTS, avec une cadence bornée
// et reproductible (PRNG semé + compteurs sérialisés sur sim.events, EV-10).
//
// Design : EVENTS est une TABLE de 3 événements (des ENTRÉES, pas un système
// de paramétrage — même discipline que la table INCID des incidents) :
//   - conference : une délégation arrive — un vol PLEIN (100 % des sièges) est
//     injecté dans le planning (planOneFlight, flights.mjs) : le mécanisme de
//     décision EXISTANT (accepter/refuser, déploiement à l'heure prévue).
//   - charter    : un affrètement — UNE SÉRIE de 2 vols (70 % des sièges)
//     injectés dans le planning (même mécanisme).
//   - tourism    : un pic touristique — l'incident de DEMANDE (surge) est
//     injecté via incidents.mjs (l'état i.surge que tickIncidents fait
//     avancer, la cadence du planificateur DOUBLÉE pendant le pic), avec la
//     durée explicite de scenarios.mjs (source unique — jamais de nombre
//     dupliqué). INTERACTION AVEC UN INCIDENT : si un pic est déjà en cours
//     (incident naturel OU pic antérieur), l'événement le RENFORÇE
//     (remaining += durée, pas un reset) — le pic se prolonge, mesurable.
//
// Tirage : une fenêtre toutes les EVENT_EVERY_S (compteur acc PRESERVÉ aux
// grands pas dt — même pattern que les horloges incidents/planner) avec une
// probabilité EVENT_PROB par fenêtre : déterministe à la relecture (rng semé
// + acc/last/seq/fired sur sim.events) → reproductible après rechargement.
//
// Feedback : l'événement émet UNE alerte `event-start` (pushEvent, kind
// lisible + seq) → le câblage EXISTANT la consomme : toast (ALERT_MSG,
// main.mjs) + SFX (sfxForAlert, audio.mjs) + juice (juiceForAlert,
// ui/juice.mjs). La fin du pic touristique est l'événement EXISTANT
// `surge-end` des incidents (pas de double compte à rebours).
//
// Sauvegarde : l'état vit sur sim.events (sérialisé seul, comme
// sim.incidents) — les sauvegardes PRÉ-T3 n'ont pas le champ (toléré :
// ensureEvents le re-attache, save.mjs).
const { pushEvent } = __ns('m_src_core_sim-state');
const { ensureIncidents } = __ns('m_src_sim_incidents');
const { SATURATION_SURGE_S } = __ns('m_src_scenarios');
const { planOneFlight } = __ns('m_src_flights_flights');

// Cadence bornée du tirage (table exportée — lisible, jamais de nombre
// réinventé ailleurs) : une fenêtre de 8 min sim, 1 tirage par fenêtre.
const EVENT_EVERY_S = 480;
const EVENT_PROB = 0.5; // probabilité de tirage par fenêtre (comme INCID)

// La TABLE des événements (entrées lues par le tirage + l'UI : name/why).
// Les effets sont injectés via les modules existants — cette table ne porte
// QUE les caractéristiques de l'offrande (jamais de règle de sim).
const EVENTS = Object.freeze({
  conference: Object.freeze({
    name: 'Conférence internationale',
    why: 'une délégation arrive en avion : un vol PLEIN à décider',
    flights: 1, paxRatio: 1.0, leadS: 60,
  }),
  charter: Object.freeze({
    name: 'Affrètement charter',
    why: 'une compagnie affrète la flotte : deux offres à décider',
    flights: 2, paxRatio: 0.7, leadS: 60, gapS: 90,
  }),
  tourism: Object.freeze({
    name: 'Pic touristique',
    why: 'la demande explose : le planificateur double la cadence',
    surgeS: SATURATION_SURGE_S, // durée explicite (scenarios.mjs, source unique)
  }),
});

// État de la couche sur la sim (sérialisable SEUL — sans état dérivé) :
//   acc   : accumulateur de la fenêtre de tirage (survit aux grands pas dt)
//   last  : sim.time du dernier événement déclenché
//   seq   : nombre d'événements déclenchés (lecture, persiste)
//   fired : compteurs PAR événement { conference: n, charter: n, tourism: n }
// Migration idempotente (pattern ensureIncidents) : une sauvegarde pré-T3
// (champ absent) est re-attachée ; les valeurs corrompues sont normalisées —
// le champ EXISTANT mais de mauvais type est REFUSÉ en amont (validateSim,
// save.mjs), jamais écrasé silencieusement ici.
function ensureEvents(sim) {
  let ev = sim.events;
  if (!ev || typeof ev !== 'object') ev = sim.events = {};
  ev.acc = Number.isFinite(ev.acc) ? ev.acc : 0;
  ev.last = Number.isFinite(ev.last) ? ev.last : 0;
  ev.seq = Number.isInteger(ev.seq) && ev.seq >= 0 ? ev.seq : 0;
  ev.fired = ev.fired && typeof ev.fired === 'object' ? ev.fired : (ev.fired = {});
  for (const k of Object.keys(ev.fired)) {
    if (!Number.isInteger(ev.fired[k]) || ev.fired[k] < 0) ev.fired[k] = 0;
  }
  return ev;
}

// Le battement de la couche : un tirage par fenêtre COMPLÉTÉE (le compteur acc
// est PRESERVÉ aux grands pas dt — comme les horloges incidents/planner, la
// fenêtre n'est ni sautée ni dupliquée). Déterministe : rng semé + compteurs
// sur sim.events (reproductible à la relecture).
function tickEvents(sim, dt, rng) {
  const ev = ensureEvents(sim);
  ev.acc += dt;
  const windows = Math.floor(ev.acc / EVENT_EVERY_S);
  if (!windows) return;
  ev.acc -= windows * EVENT_EVERY_S;
  for (let w = 0; w < windows; w++) {
    if (rng() >= EVENT_PROB) continue; // le tirage rate la fenêtre (la fenêtre est consommée)
    const id = Object.keys(EVENTS)[Math.floor(rng() * Object.keys(EVENTS).length)];
    if (!id) continue;
    if (fireEvent(sim, id, rng)) {
      ev.seq += 1;
      ev.last = sim.time ?? 0;
      ev.fired[id] = (ev.fired[id] || 0) + 1;
    }
  }
}

// Déclenche UN événement : l'effet est injecté PAR LES MODULES EXISTANTS
// (planOneFlight pour les vols, l'état incidents pour le pic) — ce module ne
// réinvente aucune règle de sim. Retourne true si l'événement a eu un effet
// (sinon il n'est pas compté : rien ne s'est passé).
function fireEvent(sim, id, rng) {
  const cfg = EVENTS[id];
  if (!cfg) return false;
  if (cfg.surgeS != null) {
    // Pic touristique : l'incident de DEMANDE via l'état des incidents
    // (tickIncidents le fait avancer et le termine — événement « surge-end »
    // EXISTANT à la fin, pas de double compte à rebours ici).
    const i = ensureIncidents(sim);
    if (i.surge.active && i.surge.remaining > 0) {
      // Interaction avec un incident EN COURS : renforcement (le pic se
      // prolonge d'autant), jamais un reset de l'horloge en cours.
      i.surge.remaining += cfg.surgeS;
      pushEvent(sim, { kind: 'event-start', event: id, name: cfg.name, why: `renforce le pic en cours (+${cfg.surgeS} s)` });
    } else {
      i.surge.active = true;
      i.surge.remaining = cfg.surgeS;
      i.surge.acc = 0;
      i.surge.last = sim.time ?? 0;
      pushEvent(sim, { kind: 'event-start', event: id, name: cfg.name, why: cfg.why });
    }
    return true;
  }
  // Conférence / charter : les vols sont injectés dans le planning via
  // planOneFlight (le mécanisme EXISTANT : offre « planned » à décider,
  // déploiement à l'heure prévue, purge au départ) — la charge est explicite
  // (fraction des sièges) et l'entrée porte le marqueur `event` (lecture
  // lisible dans le panneau planning).
  let injected = 0;
  for (let f = 0; f < cfg.flights; f++) {
    const planned = (sim.time ?? 0) + cfg.leadS + (cfg.gapS ? f * cfg.gapS : 0);
    const e = planOneFlight(sim, rng, { paxRatio: cfg.paxRatio, planned, event: id });
    if (e) injected++;
  }
  if (!injected) return false; // aucune infra servable : l'événement n'a pas d'effet
  pushEvent(sim, { kind: 'event-start', event: id, name: cfg.name, why: cfg.why });
  return true;
}

__exports.EVENT_EVERY_S = EVENT_EVERY_S;
__exports.EVENT_PROB = EVENT_PROB;
__exports.EVENTS = EVENTS;
__exports.ensureEvents = ensureEvents;
__exports.tickEvents = tickEvents;
})(__reg['m_src_sim_events']);

/* --- module src/ui/panels.mjs --- */
(function (__exports) {
// Panneaux NONMVP-5 : les 5 panneaux manquants — inspection avion + bâtiment
// (clic sur la carte), bilan financier détaillé, statistiques, historique
// d'alertes, diagnostic réseau (coupé / saturation). UI FINE : on ne lit que
// l'état + les getters purs EXISTANTS (economy.periodStatement, path.findPath)
// — aucune règle n'est ajoutée, aucune mutation de la sim (le panneau réseau ne
// reconstruit JAMAIS le graphe : avant le 1er tick il est null et c'est voulu,
// R3/A7 — on le dit, on ne le fabrique pas). Pattern de planning-panel : DOM
// fixe créé une fois, la zone de contenu se reconstruit seulement quand la
// signature change (les éléments ne disparaissent pas sous la souris, les
// clics ne partent pas).
const { periodStatement, lastPeriod, forecast, loanState, takeLoan } = __ns('m_src_economy_economy');
const { findPath, runwayExitNode } = __ns('m_src_pathfinding_path');
const { AIRCRAFT, AIRLINES, BUILDINGS, opexPerMin, opexPerHour, GROUND_SERVICE_TYPES } = __ns('m_src_data_catalog');
// R17 (t_fc0d1920) : la cause du retard est LUE (causeAt, aircraft.mjs) — le
// panneau ne recalcule rien, il traduit (DELAY_CAUSE_FR) ; la ponctualité
// (fenêtre bornée, dénominateur clair) vient de punctualityStats (id.).
const { causeAt, DELAY_CAUSE_FR, DELAY_WINDOW_S, punctualityStats } = __ns('m_src_sim_aircraft');
// R22 (t_00318fe0) : les objectifs de progression + récompense payée UNE fois —
// le panneau est une LECTURE (objectiveView) : il ne décide rien, il affiche
// l'état (à venir / atteinte / payée) et la mesure live du critère.
const { OBJECTIVES, objectiveView } = __ns('m_src_progression_objectives');
// R24 (t_f712f1a5) : les contrats de compagnie — LECTURE (contractView) + les
// COMMANDES de décision (decideContract/cancelContract) : la sim règle la
// prime/pénalité (tickContracts), le panneau ne décide que par ces portes.
const { contractView, decideContract, cancelContract, contractCapable } = __ns('m_src_flights_contracts');
const { pendingCap } = __ns('m_src_flights_flights');
const { qualityView } = __ns('m_src_progression_quality');
const { unlockView } = __ns('m_src_infra_unlocks');
// R27 (t_6424937a) : l'affectation des services aux terminaux — LECTURE
// (assignmentView : affectation + capacités par terminal, la sim est la
// source) + COMMANDE (setAssignment : le joueur change l'affectation, la règle
// est dans la sim, le panneau émet l'intention).
const { assignmentView, setAssignment } = __ns('m_src_infra_assignments');
const { weatherView } = __ns('m_src_sim_weather');
const { clockView } = __ns('m_src_sim_clock');
const { seasonOf, seasonView } = __ns('m_src_core_seasons');
// T2-2 (t_6344db94) : la SAISON (victoire) + stats persistantes + succès —
// LECTURE seule (campaignView / statsView / achievementsView / unlockedCount) :
// la sim décide (tickCampaign / tickStats / tickAchievements), le panneau
// affiche (même pattern que les objectifs R22).
const { campaignView } = __ns('m_src_progression_campaign');
const { statsView } = __ns('m_src_progression_stats');
const { achievementsView, unlockedCount } = __ns('m_src_progression_achievements');
// R33 (t_11a4e241) : DEUX réponses opérationnelles par incident — LECTURE
// (incidentResponse : les 2 réponses + conséquences AVANT décision) + COMMANDE
// (respondIncident : la sim règle le coût/l'effet, l'UI émet l'intention).
// UI FINE, même pattern que setAssignment/buyUpgrade (panneau ne décide pas).
const { incidentResponse, respondIncident } = __ns('m_src_sim_incidents');
// R30 (t_1623523e) : les files passagers sont PAR TERMINAL (sim.passengers.queues)
// — le panneau l'affiche via queueTotals (somme des terminaux, lecture seule).
const { queueTotals, satisfactionCauses } = __ns('m_src_sim_passengers');
// R31 (t_7a512737) : améliorations de capacité CIBLÉE par terminal — LECTURE
// (upgradeView : les 6 choix du catalogue + goulot courant du terminal) + COMMANDE
// (buyUpgrade : la sim règle le coût/l'effet, le panneau émet l'intention —
// UI fine, même pattern que setAssignment).
const { upgradeView, buyUpgrade } = __ns('m_src_infra_upgrades');

const PHASES_FR = Object.freeze({
  approach: 'approche', holding: 'attente', landing: 'atterrissage', exit: 'sortie de piste',
  taxi: 'taxi', docking: 'amarrage', gate: 'au sol', refuel: 'carburant',
  disembark: 'désbarquement', ground: 'au sol', board: 'embarquement',
  pushback: 'poussée', departure: 'décollage', blocked: 'bloqué',
  departed: 'parti', cancelled: 'annulé',
});
// R07 : la CAUSE lisible d'un retard, lue de la phase (pas de règle de sim ici —
// le panneau ne recalcule rien, il traduit). holding = la piste qu'il visait
// est occupée (conflit de ressource, A4) ; blocked = aucun chemin (taxiway coupé
// ou porte indisponible, A-5) ; les autres phases n'ont pas de retard actif.
const CAUSE_FR = Object.freeze({
  approach: 'descente vers la piste',
  holding: 'piste occupée ou fermée — attente (conflit de ressource)',
  landing: 'roulage sur la piste',
  exit: 'sortie de piste vers une porte',
  taxi: 'taxi (segment occupé en avant)',
  docking: 'amarrage à la porte',
  gate: 'au sol (pas de retard actif)',
  refuel: 'avitaillement',
  disembark: 'désbarquement',
  ground: 'au sol (pas de retard actif)',
  board: 'embarquement',
  pushback: 'poussée (piste ou segment occupé)',
  departure: 'décollage',
  blocked: 'bloqué — taxiway coupé ou porte indisponible (retry, annulation A-5 à 10 min)',
  departed: 'parti',
  cancelled: 'annulé',
});
// R26 : le plafond d'arrivées est un PARAMÈTRE de la sim (pendingCap,
// flights.mjs — borné [MAX_PENDING, PENDING_CAP_MAX]) : le panneau le LIT,
// la constante dupliquée est supprimée (le panneau ne peut plus diverger).

function fmtClock(t) {
  const s = Math.max(0, Math.floor(t || 0));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function money(v) { return `${Math.round(v || 0).toLocaleString('fr-FR')} $`; }
function line(parent, label, value, kind) {
  const d = document.createElement('div');
  d.className = 'pline' + (kind ? ` pline--${kind}` : '');
  const l = document.createElement('span');
  l.textContent = label;
  d.append(l, document.createTextNode(value));
  parent.appendChild(d);
}
// R33 : les DEUX réponses d'un incident + leurs CONSÉQUENCES (lues AVANT
// décision par incidentResponse, lecture pure) + un bouton par réponse
// (l'action émet l'intention — respondIncident règle le coût/l'effet, pas l'UI).
// Après l'action, le record est terminé → la signature du panneau change → la
// zone est reconstruite au prochain frame (plus de boutons = l'action n'est
// JAMAIS répétable en UI) ; l'événement (pushEvent côté sim) se lit dans
// l'historique d'alertes.
function addResponses(body, sim, which) {
  const view = incidentResponse(sim, which);
  if (!view.ok) return; // motif lisible (incident terminé / cible ambiguë)
  for (const r of view.responses) {
    const row = document.createElement('div');
    row.className = 'pline';
    const b = document.createElement('button');
    b.className = 'resp';
    b.textContent = r.cost ? `${r.name} — ${r.cost} $` : r.name;
    b.addEventListener('click', () => {
      // Intention vers la sim — la règle (coût, effet, non-répétition) est
      // dans respondIncident (la UI ne tranche rien, pattern buyUpgrade).
      respondIncident(sim, which, r.id);
    });
    const t = document.createElement('span');
    t.textContent = ` — ${r.effect}`; // la CONSÉQUENCE est affichée AVANT la décision
    row.append(b, t);
    body.appendChild(row);
  }
}

// Section : titre + zone. refresh(sigOf, paint) reconstruit la zone UNIQUEMENT
// si la signature a changé (sinon DOM stable, comme planning-panel).
function makeSection(parent, cls, title) {
  const box = document.createElement('section');
  box.className = cls;
  const h = document.createElement('h4');
  h.textContent = title;
  const body = document.createElement('div');
  box.append(h, body);
  parent.appendChild(box);
  let sig = null;
  return {
    refresh: (sigOf, paint) => {
      const s = sigOf();
      if (s === sig) return;
      sig = s;
      paint(body);
    },
  };
}

function makePanels({ state, camera, viewSize, buildTool }) {
  const col = document.createElement('div');
  col.className = 'panels';
  col.setAttribute('role', 'complementary');
  col.setAttribute('aria-label', 'Panneaux de consultation (inspection, finances, stats, alertes, réseau)');
  document.body.appendChild(col);

  // --- 1. Inspection avion + bâtiment (clic sur la carte) -------------------
  const inspect = makeSection(col, 'panel', 'Inspection — clic sur la carte');
  let pick = null; // { kind: 'ac' | 'bldg', id } — rendu live (l'objet peut partir)
  function refreshInspect() {
    inspect.refresh(
      // R07 : la signature EST l'état de l'objet suivi (phase, pax, position
      // arrondie, porte, piste, retard). Chaque tick, si quelque chose bouge la
      // signature change → le DOM du panneau est reconstruit avec les valeurs
      // fraîches. Objet disparu → signature 'none' (rendu « parti/démoli »).
      () => {
        if (!pick || !state.sim) return 'none';
        const sim = state.sim;
        if (pick.kind === 'ac') {
          const ac = sim.aircraft.find((a) => a.id === pick.id);
          if (!ac) return 'none';
          return [ac.phase, ac.pax, Math.round(ac.x), Math.round(ac.y), ac.gateId, ac.runwayId, Math.round(ac.delayed), causeAt(sim, ac)].join('|');
        }
        const find = (arr) => (arr || []).find((b) => b.id === pick.id);
        const b = find(sim.infra.runways) || find(sim.infra.taxiways)
          || find(sim.infra.terminals) || find(sim.infra.services);
        if (!b) return 'none';
        // R27 : la signature d'un SERVICE inclut l'affectation (target + auto)
        // — le panneau se reconstruit quand le joueur la change (pas de vieux
        // affichage). Les autres bâtiments sont statiques (une seule valeur).
        if (GROUND_SERVICE_TYPES.includes(b.type)) return `bldg:${pick.id}:${b.target ?? 'n'}:${b.auto ? 'a' : 'j'}`;
        return `bldg:${pick.id}`; // les bâtiments ne bougent pas : une seule valeur
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!pick || !sim) {
          line(body, '', 'Cliquez sur un avion ou un bâtiment.');
          return;
        }
        if (pick.kind === 'ac') {
          const ac = sim.aircraft.find((a) => a.id === pick.id);
          if (!ac) { line(body, `Avion #${pick.id}`, 'parti — plus en simulation'); return; }
          const spec = AIRCRAFT[ac.acType] || {};
          const airline = (AIRLINES.find((x) => x.id === ac.airline) || { name: ac.airline }).name;
          // R17 : la CAUSE DU RETARD est LUE (causeAt) — quand l'avion est en
          // retard, on affiche le GOUTOU qui le retient (piste/porte/segment/
          // carburant/passagers) ; sinon la phase courante (R07).
          const delayed = ac.delayed > 0;
          const cause = delayed ? (DELAY_CAUSE_FR[causeAt(sim, ac)] || `goulot ${causeAt(sim, ac) || '?'}`)
                               : (CAUSE_FR[ac.phase] || ac.phase);
          line(body, `Avion #${ac.id}`, `${airline} · ${spec.name || ac.acType}`);
          line(body, 'Phase', `${PHASES_FR[ac.phase] || ac.phase}${delayed ? ` (retard ${Math.round(ac.delayed)} s)` : ''}`);
          if (delayed) line(body, 'Cause du retard', cause, 'warn');
          else line(body, 'État', cause);
          line(body, 'Passagers', `${ac.pax} pax`);
          if (ac.gateId) line(body, 'Porte', ac.gateId);
          if (ac.runwayId) line(body, 'Piste', ac.runwayId);
          line(body, 'Ressource attendue', spec.gate ? `porte ${spec.gate}` : (ac.runwayId ? `piste ${ac.runwayId}` : '—'));
          line(body, 'Position', `${Math.round(ac.x)}, ${Math.round(ac.y)}`);
        } else {
          const find = (arr) => (arr || []).find((b) => b.id === pick.id);
          const b = find(sim.infra.runways) || find(sim.infra.taxiways)
            || find(sim.infra.terminals) || find(sim.infra.services);
          if (!b) { line(body, `Bâtiment #${pick.id}`, 'démoli — plus en simulation'); return; }
          const def = BUILDINGS[b.type] || { name: b.type, sellRefund: 0 };
          line(body, `${def.name} #${b.id}`, `${b.w}×${b.h} px`);
          line(body, 'Coût d’origine', money(b.cost));
          line(body, 'Remboursement démolition', money((b.cost || 0) * def.sellRefund));
          // R15 : l'exploitation est nommée en $/min ET $/h — le /min affiché
          // EST le débit constaté sur 60 s de jeu (la sim débite opexPerMin sur
          // 60 s de jeu ; les chiffres viennent d'OPEX_PER_SEC via les accès).
          const pm = opexPerMin(b.type), ph = opexPerHour(b.type);
          if (pm > 0) line(body, 'Exploitation', `${money(pm)} /min · ${money(ph)} /h`);
          // R27 (t_6424937a) : service au sol — AFFECTATION visible (terminal
          // desservi + capacité = portes du terminal, coût d'exploitation au
          //-dessus) + COMMANDE du joueur pour la CHANGER (setAssignment : la
          // règle est dans la sim, le panneau émet l'intention — UI fine).
          if (GROUND_SERVICE_TYPES.includes(b.type)) {
            const term = sim.infra.terminals.find((t) => t.id === b.target);
            const nGates = (tid) => (sim.infra.gates || []).filter((g) => g.terminalId === tid).length;
            const gates = term ? nGates(term.id) : 0;
            line(body, 'Affectation', b.target == null
              ? (b.auto ? 'inactif (aucun terminal à servir)' : 'inactif (choix joueur)')
              : `terminal ${term.id} — auto${b.auto ? '' : ', modifié'}`,
                b.target == null ? 'warn' : '');
            line(body, 'Desservi', term ? `les ${gates} porte(s) du terminal ${term.id}` : "aucun terminal — le service n'a pas d'effet");
            line(body, 'Capacité', `soutient ${gates} porte(s)${b.type === 'fuel' ? ` · ${gates} lance(s) de plein` : ''}`);
            // R29 (t_9842f7a3) : usure + activité + effet attendu de l'équipe —
            // LECTURE seule de sim._teamActivity (la sim l'écrit à chaque tick,
            // cleanGates). Débit limité : le budget d'intervention est PARTAGÉ
            // (pas de réduction globale), priorité = la porte la plus usée d'abord.
            if ((b.type === 'cleaning' || b.type === 'hangar') && term) {
              const act = sim._teamActivity?.[b.type]?.[term.id];
              const teams = act ? act.teams : 0;
              const field = b.type === 'hangar' ? 'maintenance' : 'cleaning';
              const served = act?.servedGate ? sim.infra.gates.find((g) => g.id === act.servedGate) : null;
              const wearLabel = served ? ` · usure courante ${Math.round(served[field] ?? 0)}` : '';
              line(body, 'Équipes', `${teams} — débit limité, priorité : la porte la plus usée d'abord${wearLabel}`);
              line(body, 'Activité', act && act.servedGate
                ? `porte ${act.servedGate} · ${act.drain.toFixed(1)} usure retirée / ${act.budget.toFixed(1)} budget`
                : (teams ? 'toutes propres (aucune usure en cours)' : 'aucune équipe — usure en stagnation'),
                teams ? '' : 'warn');
            }
            // Changer l'affectation : UNE commande (setAssignment) — la mesure
            // (servicesServingGate) suit la décision au prochain tick, jamais
            // le contraire.
            const sel = document.createElement('select');
            const opts = [{ v: null, l: 'Inactif' }, ...sim.infra.terminals.map((t) => ({ v: t.id, l: `Terminal ${t.id} (${nGates(t.id)} portes)` }))];
            for (const o of opts) {
              const op = document.createElement('option');
              op.value = o.v == null ? '' : String(o.v);
              op.textContent = o.l;
              if (String(b.target ?? '') === (o.v == null ? '' : String(o.v))) op.selected = true;
              sel.appendChild(op);
            }
            sel.setAttribute('aria-label', `Changer l'affectation du service #${b.id}`);
            sel.addEventListener('change', () => {
              if (!state.sim) return;
              setAssignment(state.sim, b.id, sel.value === '' ? null : Number(sel.value));
            });
            body.appendChild(sel);
          }
          if (b.type === 'runway') line(body, 'Longueur', `${b.len} px`);
          if (b.type === 'terminal') {
            const gates = (sim.infra.gates || []).filter((g) => g.terminalId === b.id);
            line(body, 'Portes', gates.map((g) => `${g.id} (${g.size}${g.acId ? ` · avion #${g.acId}` : ''})`).join(' · ') || 'aucune');
            // R31 (t_7a512737) : 3 CHOIX D'AMÉLIORATION CIBLÉE du terminal —
            // coût FIXE + résultat ATTENDU (UPGRADES, catalog.mjs) + le GOUTLE
            // COURANT du terminal (upgradeView, lecture seule) : le « mauvais
            // achat » est COMPRÉHENSIBLE (le choix utile suit le goulot, le
            // panneau le dit). COMMANDE : buyUpgrade (la sim règle coût/effet).
            const uv = upgradeView(sim, b.id);
            if (uv) {
              line(body, 'Goulot', uv.bottleneckWhy, uv.bottleneck === 'files' ? 'warn' : '');
              for (const c of uv.choices) {
                if (c.level >= c.maxLevel) {
                  line(body, `Amélioration ${c.name}`, `niveau ${c.maxLevel} (maximal)`);
                  continue;
                }
                const btn = document.createElement('button');
                btn.textContent = `Améliorer ${c.name} — niv. ${c.level + 1}/${c.maxLevel} · ${money(c.cost)}${c.useful ? ' · suit le goulot' : ''}`;
                btn.disabled = !c.affordable;
                btn.setAttribute('aria-label', `Améliorer ${c.name} du terminal ${b.id} pour ${c.cost} $`);
                btn.addEventListener('click', () => {
                  if (!state.sim) return;
                  buyUpgrade(state.sim, b.id, c.kind); // l'événement passe dans sim.alerts (HUD)
                });
                body.appendChild(btn);
                line(body, 'Effet attendu', c.effect, c.useful ? '' : 'warn');
              }
            }
          }
        }
      },
    );
  }

  // Clic sur la carte : avion (rayon ~30 px écran) puis bâtiment (rect).
  // L'outil de construction/démolition garde la priorité s'il est actif (son
  // propre click listener gère la pose/démolition).
  const canvas = document.querySelector('#game');
  canvas.addEventListener('click', (e) => {
    if (buildTool && buildTool.isActive()) return; // le clic est géré par l'outil
    if (state.screen !== 'game' || !state.sim) return;
    const v = viewSize();
    const wx = camera.screenToWorldX(e.offsetX, v.width);
    const wy = camera.screenToWorldY(e.offsetY, v.height);
    const sim = state.sim;
    const r = 30 / state.camera.zoom; // rayon d'inspection en unités MONDE (le zoom compte)
    const ac = sim.aircraft.find((a) => Math.abs(a.x - wx) <= r && Math.abs(a.y - wy) <= r);
    if (ac) { pick = { kind: 'ac', id: ac.id }; return; }
    const b = [...sim.infra.runways, ...sim.infra.taxiways, ...sim.infra.terminals, ...sim.infra.services]
      .find((x) => wx >= x.x && wx <= x.x + x.w && wy >= x.y && wy <= x.y + x.h);
    pick = b ? { kind: 'bldg', id: b.id } : null;
  });

  // --- 2. Bilan financier détaillé (surfacer economy.periodStatement) -------
  const fin = makeSection(col, 'panel', 'Bilan financier');
  function refreshFin() {
    fin.refresh(
      () => {
        const sim = state.sim;
        // R35 : la signature porte LE BILAN + l'EMPRUNT (le bouton « Emprunter »
        // doit passer « obtenu » au clic — la lecture loanState fait partie de
        // la signature, pas seulement la lecture du bilan).
        return sim ? JSON.stringify([periodStatement(sim), loanState(sim)]) : 'none';
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const s = periodStatement(sim); // LE bilan existant (economy.mjs) — rien à recalculer
        line(body, 'Solde', money(s.money), s.money < 0 ? 'bad' : 'good');
        line(body, 'Résultat', money(s.net), s.net < 0 ? 'bad' : 'good');
        line(body, 'Recettes', money(s.revenue));
        line(body, 'Exploitation', `−${money(s.opex)}`);
        line(body, 'Carburant', `−${money(s.fuel)}`);
        line(body, 'Indemnités vols annulés', `−${money(s.compensation)}`);
        line(body, 'Investissements', `−${money(s.invest)}`);
        if (s.debt > 0) line(body, 'Dette (intérêts)', money(s.debt));
        // R35 : l'EMPRUNT borné (redressement) — LECTURE (loanState : les
        // conséquences sont affichées AVANT le clic, pattern R33) + COMMANDE
        // (takeLoan : la sim règle la liquidité, l'UI émet l'intention). Le
        // principal est une ligne de crédit du bilan (s.loan, distincte des
        // intérêts en « Dette ») — jamais une recette (R11).
        if (s.loan > 0) line(body, 'Emprunt obtenu (principal dû)', money(s.loan));
        const ls = loanState(sim);
        const btn = document.createElement('button');
        btn.className = 'tool';
        btn.textContent = ls.available
          ? `Emprunter ${money(ls.principal)} (intérêts ${money(ls.interest)}, net ${money(ls.netLiquidity)} — 1 seul par partie)`
          : `Emprunt obtenu (${ls.count}/${ls.max}) — borne atteinte`;
        btn.disabled = !ls.available || sim.economy.bankrupt;
        btn.addEventListener('click', () => { if (state.sim) takeLoan(state.sim); });
        body.appendChild(btn);
        // R16 : période récente + prévision (cumuls ci-dessus = toute la partie,
        // la période = les 5 dernières minutes de jeu ; les deux sont distincts).
        const lp = lastPeriod(sim);
        if (lp) {
          line(body, `Période ${Math.round(lp.minutes)} min (net)`, money(lp.net), lp.net < 0 ? 'bad' : 'good');
          const f = forecast(sim);
          if (f) {
            line(body, 'Prévision +1 h (projection, pas une garantie)',
              `solde projeté ${money(f.projected)} à ${money(f.perHour)} $/h`, 'warn');
          }
        }
        if (s.money < 0) line(body, 'Causes du déficit', s.causes.join(' ; '), 'warn');
        if (sim.economy.bankrupt) line(body, 'État', 'FAILLITE', 'bad');
      },
    );
  }

  // --- 3. Statistiques -------------------------------------------------------
  const stats = makeSection(col, 'panel', 'Statistiques');
  function refreshStats() {
    stats.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const p = sim.passengers;
        // t_2179387d : le nombre de bâtiments par service au sol est VISIBLE
        // (ressources/capacités lisibles, critère 85) — la sim reste la source.
        const svcCount = (type) => sim.infra.services.filter((s) => s.type === type).length;
        // R17 : la ponctualité (fenêtre bornée) fait partie de la signature —
        // sinon le panneau ne se met pas à jour quand un vol se termine.
        const pu = punctualityStats(sim);
        const qt = queueTotals(sim); // R30 : files par terminal → somme (affichage)
        return [
          Math.floor(sim.time || 0), Math.round(p.satisfaction), p.totalCarried,
          qt.checkin, qt.security, qt.board,
          sim.aircraft.length, sim.planning.length,
          svcCount('fuel'), svcCount('hangar'), svcCount('cleaning'), svcCount('baggage'),
          // R34 : la CAUSE de la satisfaction fait partie de la signature — le
          // panneau se met à jour quand les files saturent / se vident.
          ...(() => { const c = satisfactionCauses(sim); return [c.loss > 0, c.satStages, Math.round(c.overflow)]; })(),
          pu.rate == null ? 'no' : `${pu.total}|${pu.onTime}|${pu.cancels}`,
          // T3 (t_76744b22) : l'HORLOGE de jeu + la SAISON font partie de la
          // signature — le panneau se reconstruit au passage de jour/saison.
          `${clockView(sim).day}|${seasonOf(sim)}`,
        ].join('|');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const p = sim.passengers;
        const qt = queueTotals(sim); // R30 : files par terminal → somme (affichage)
        line(body, 'Temps de jeu', fmtClock(sim.time));
        // T3 (t_76744b22) : l'HORLOGE DE JEU (jour + heure JEU + phase) + la
        // SAISON (dérivée du jour — saisons.mjs) : l'affichage du temps
        // (lecture pure — l'horloge absente/corrompue → J1 08:00, printemps).
        const cv = clockView(sim);
        const sv = seasonView(sim);
        line(body, 'Horloge', `Jour ${cv.day} · ${cv.label} (${cv.phaseFr}) — ${sv.fr}`);
        line(body, 'Passagers transportés', `${p.totalCarried}`);
        // R34 : satisfaction + CAUSES (lecture satisfactionCauses — module
        // unique, pas de second module qui se contredit) : ce qui pèse
        // (files saturées / débordement) ou ce qui remonte (files vides).
        const sc = satisfactionCauses(sim);
        const satCause = sc.loss > 0
          ? `pèse : ${sc.satStages} file(s) saturée(s)${sc.overflow ? ` + débordement ${Math.round(sc.overflow)} pax` : ''} (${Math.round(sc.loss * 10) / 10} %/s)`
          : 'files vides : remonte progressivement (+confort si services)';
        line(body, 'Satisfaction', `${Math.round(p.satisfaction)} % — ${satCause}`, sc.loss > 0 ? 'warn' : 'good');
        line(body, 'Files', `check-in ${qt.checkin} · sécurité ${qt.security} · embarquement ${qt.board}`);
        const inFlight = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
        line(body, 'Avions', `${sim.aircraft.length} (${inFlight} en vol/attente · ${sim.aircraft.length - inFlight} au sol)`);
        line(body, 'Vols planifiés', `${sim.planning.length}`);
        const svcCount = (type) => sim.infra.services.filter((s) => s.type === type).length;
        line(body, 'Services au sol',
          `carburant ${svcCount('fuel')} · hangar ${svcCount('hangar')} · nettoyage ${svcCount('cleaning')} · bagages ${svcCount('baggage')}`);
        // R17 : ponctualité sur fenêtre bornée (DELAY_WINDOW_S), dénominateur
        // CLAIR = les fins de vol récentes (départs + annulations), numérateur
        // = départs à l'heure (retard ≤ rotation nominale). null = aucun vol
        // terminé dans la fenêtre → « pas encore de vol terminé » (pas de
        // faux chiffre, R16).
        const pu = punctualityStats(sim);
        if (pu.rate == null) {
          line(body, 'Ponctualité', `— aucun vol terminé sur les ${DELAY_WINDOW_S / 60} dernières min`, 'warn');
        } else {
          const pct = Math.round(pu.rate * 100);
          const causes = Object.entries(pu.causes).map(([c, n]) => `${DELAY_CAUSE_FR[c] || c} ${n}`).join(' · ');
          line(body, `Ponctualité (${DELAY_WINDOW_S / 60} min, ${pu.total} vols, ${pu.cancels} annulés)`,
            `${pct} % à l'heure${causes ? ` — goulots : ${causes}` : ''}`,
            pct < 70 ? 'bad' : 'good');
        }
      },
    );
  }

  // --- 3b. R22 : objectifs de progression (récompense payée une fois) ------
  // UI fine : LECTURE seule (objectiveView) — le paiement est fait par la sim
  // (tickObjectives), pas par le panneau.
  const goals = makeSection(col, 'panel', 'Objectifs');
  function refreshGoals() {
    goals.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        return OBJECTIVES.map((o) => {
          const v = objectiveView(sim, o.id);
          return [o.id, v.state, v.detail].join('|');
        }).join('§');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        for (const o of OBJECTIVES) {
          const v = objectiveView(sim, o.id);
          line(body, `${o.name} (${o.reward} $)`, `${v.state} — ${v.detail}`,
               v.state === 'payée' ? 'good' : v.state === 'atteinte' ? 'warn' : '');
        }
      },
    );
  }

  // --- 3b. T2-2 (t_6344db94) : la SAISON (victoire) + STATS + SUCCÈS ------
  // UI fine : LECTURE seule (campaignView / statsView / achievementsView) —
  // la sim décide (tickCampaign/tickStats/tickAchievements), le panneau
  // affiche (même pattern que les objectifs R22).
  const campaign = makeSection(col, 'panel', 'Saison, stats & succès');
  function refreshCampaign() {
    campaign.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const c = campaignView(sim);
        const s = statsView(sim);
        return [c.status, c.wins, c.left, c.rewardPaid,
                s.paxTotal, s.profit, s.nonDeficit.current, s.nonDeficit.best,
                s.incidentsSurvived, s.periodsClosed, unlockedCount(sim)].join('§');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const c = campaignView(sim);
        line(body, 'La saison', c.text,
             c.status === 'won' ? 'good' : c.status === 'lost' ? 'bad' : 'warn');
        const s = statsView(sim);
        line(body, 'Passagers transportés', String(s.paxTotal));
        line(body, 'Bénéfice (cumulé)', money(s.profit),
             s.profit > 0 ? 'good' : s.profit < 0 ? 'bad' : '');
        line(body, 'Série sans déficit',
             `${s.nonDeficit.current} consécutive(s) — record ${s.nonDeficit.best}`,
             s.nonDeficit.current >= 3 ? 'good' : '');
        line(body, 'Incidents survivus', String(s.incidentsSurvived));
        line(body, 'Périodes closes', String(s.periodsClosed));
        const ach = achievementsView(sim);
        const n = unlockedCount(sim);
        line(body, 'Succès', `${n}/${ach.length} débloqué(s)`, n === ach.length ? 'good' : '');
        for (const a of ach) {
          line(body, a.name,
               a.unlocked ? (a.at != null ? `débloqué à ${fmtClock(a.at)}` : 'débloqué') : a.desc,
               a.unlocked ? 'good' : '');
        }
      },
    );
  }

  // --- 3c. R23 : déblocages des services (conditions mesurables) ------------
  // UI fine : LECTURE seule (unlockView) — les conditions sont décidées par
  // tickUnlocks (unlocks.mjs), le panneau affiche le BÉNÉFICE + la condition
  // restante pour chaque service verrouillé (à l'avance, pas de seuil pax).
  const unlocks = makeSection(col, 'panel', 'Déblocages services');
  function refreshUnlocks() {
    unlocks.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        return unlockView(sim).join('§');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        for (const l of unlockView(sim)) {
          const isDone = l.startsWith('débloqué(s)') || l.startsWith('tous');
          line(body, l.split(' : ')[0] || 'Déblocages', l.split(' : ').slice(1).join(' : '), isDone ? 'good' : '');
        }
      },
    );
  }
  // --- 3d. R24 : contrats de compagnie (prime/pénalité réglées une fois) ---
  // UI fine : LECTURE seule (contractView) — le règlement est fait par la sim
  // (tickContracts), le panneau affiche l'état (proposé/actif/finis) + la
  // mesure live (vols, pax, ponctualité, temps restant) + les décisions
  // accepter/refuser/annuler (les COMMANDES contracts, pas de règle ici).
  const contracts = makeSection(col, 'panel', 'Contrats de compagnie');
  function refreshContracts() {
    contracts.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const v = contractView(sim);
        return [
          v.active ? `${v.active.id}:${v.active.done}:${v.active.pax}:${v.active.onTime}:${v.active.ends}:${v.active.left | 0}` : 'none',
          v.offered ? v.offered.id : 'none', v.offered ? v.offered.left | 0 : '',
          v.nextOfferAt, (v.history || []).map((h) => `${h.id}:${h.result}`).join(','),
        ].join('|');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const v = contractView(sim);
        if (v.offered) {
          const cap = contractCapable(sim, { acType: v.offered.acType });
          line(body, `Contrat proposé — ${v.offered.name}`,
            `décision ${v.offered.left} s (refus gratuit)`);
          line(body, '', `${v.offered.desc}`);
          line(body, 'Appareil', `${cap.name} (${cap.seats} sièges) — ` +
            (cap.capable ? 'servable par l’infra actuelle' : `non servable : ${cap.why}`));
          const ok = document.createElement('button');
          ok.textContent = 'Accepter le contrat';
          ok.addEventListener('click', () => { decideContract(sim, v.offered.id, true); refreshContracts(); });
          const no = document.createElement('button');
          no.textContent = 'Refuser (gratuit)';
          no.addEventListener('click', () => { decideContract(sim, v.offered.id, false); refreshContracts(); });
          body.append(ok, no);
        }
        if (v.active) {
          const a = v.active;
          const cap = contractCapable(sim, { acType: a.acType });
          const pct = a.rate == null ? '—' : `${Math.round(a.rate * 100)} %`;
          // Risque aprÈs DÉPART (R25) : ce qu'il reste à faire + le pire cas
          // (pénalité plafonnée, payée une fois — le contrat ne peut JAMAIS
          // coûter plus que ça ; la prime si la mesure passe au vert).
          // Le verdict onTrack vient du module (contractOnTrack — LA règle
          // unique du règlement, lue ici, jamais ré-imposée par le panneau).
          const risk = a.onTrack ? 'sur la bonne voie'
            : (cap.capable ? `reste ${Math.max(0, a.flights - a.done)} vol(s)${a.pax < a.minPax ? ` et ${a.minPax - a.pax} pax` : ''}`
                           : `infra non servable (${cap.why})`);
          line(body, `Contrat actif — ${a.name}`,
            `${a.done}/${a.flights} vols · ${a.pax}/${a.minPax} pax · ponctualité ${pct} (exigée ${Math.round((a.punctuality ?? 0) * 100)} %) · ${a.left | 0} s restantes`);
          line(body, '', `${cap.name} (${cap.seats} sièges) — ${risk}`);
          line(body, '', `Prime ${a.bonus} $ si réussi · pire pénalité ${a.penalty} $ (payée une fois)`);
          const cancel = document.createElement('button');
          cancel.textContent = 'Annuler le contrat (pénalité due)';
          cancel.addEventListener('click', () => { cancelContract(sim, a.id); refreshContracts(); });
          body.appendChild(cancel);
        }
        if (!v.offered && !v.active) {
          if (v.nextOfferAt != null) line(body, 'Prochain contrat', `proposé à ${v.nextOfferAt} pax transportés (${sim.passengers?.totalCarried ?? 0} actuels)`);
          else if (!(v.history || []).length) line(body, '', 'Aucun contrat (l’activité s’annonce — ≥ 300 pax transportés pour la première offre).');
        }
        for (const h of (v.history || []).slice(0, 4)) {
          line(body, `Fini — ${h.name}`,
            `${h.result === 'success' ? 'réussi' : h.result === 'cancelled' ? 'annulé (pénalité)' : 'manqué (pénalité)'} : ${h.done}/${h.flights} vols · ${h.pax} pax`);
        }
      },
    );
  }
  // --- 4. Historique d'alertes (sim.alerts, les plus récentes d'abord) ------
  const hist = makeSection(col, 'panel', 'Alertes (historique)');
  function refreshHist() {
    hist.refresh(
      () => {
        const sim = state.sim;
        return sim ? `${(sim.alerts || []).length}` : 'none'; // signature = longueur seule
      },
      (body) => {
        body.replaceChildren();
        const all = state.sim ? state.sim.alerts || [] : [];
        // ponytail: on n'affiche que les 50 plus récentes (l'historique complet
        // vit dans sim.alerts ; un bornage en sim si ça devient un besoin).
        const last = all.slice(-50).reverse();
        if (!last.length) { line(body, '', 'Aucune alerte.'); return; }
        for (const a of last) {
          const d = document.createElement('div');
          d.className = 'aline';
          d.textContent = a.why ? `${a.kind} — ${a.why}` : a.kind;
          body.appendChild(d);
        }
        if (all.length > 50) line(body, '', `… ${all.length - 50} plus anciennes (non affichées)`);
      },
    );
  }

  // --- 5. Diagnostic réseau : coupé / saturation ----------------------------
  const net = makeSection(col, 'panel', 'Diagnostic réseau');
  function refreshNet() {
    net.refresh(
      () => {
        const sim = state.sim;
        if (!sim) return 'none';
        const i = sim.incidents || {};
        // R32 : les incidents sont PAR ACTIF — la fermeture piste et la panne
        // station sont attachées (i.runways / i.fuels) ; le pic (i.surge) reste
        // global (une demande, pas un actif). On compte les actifs touchés.
        const pending = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
        const q = qualityView(sim); // R26 : palier qualité (mix d'offres) + mesure sous-jacente
        const nClosedRw = Object.values(i.runways || {}).filter((r) => r && r.remaining > 0).length;
        const nOutSt = Object.values(i.fuels || {}).filter((f) => f && f.remaining > 0).length;
        const nPlanned = (sim.planning || []).filter((e) => e.status === 'planned').length; // R33 : la conséquence « allègement » (nombre de vols à refuser) suit la décision
        const wv = weatherView(sim); // T3 MÉTÉO : la ligne « Météo » + l'incident suivent la signature (le panneau se reconstruit à la transition)
        return [
          sim._graph ? sim._graph.nodes.length : null, sim._graphDirty ? 1 : 0,
          sim.infra.runways.length, sim.infra.gates.length,
          pending, pendingCap(sim), nClosedRw, nOutSt, i.surge?.active ? 1 : 0,
          q.tier, q.q.toFixed(2), nPlanned,
          wv.state, wv.incident ? 1 : 0, // T3 : la MÉTÉO (état + incident actif)
        ].join('|');
      },
      (body) => {
        body.replaceChildren();
        const sim = state.sim;
        if (!sim) return;
        const i = sim.incidents || {};
        // SATURATION : file d'arrivées face au plafond (PARAMÈTRE de la sim,
        // R26 : pendingCap — le panneau le lit, la sim le borne [4, 8]).
        const pending = sim.aircraft.filter((a) => ['approach', 'holding', 'landing', 'blocked'].includes(a.phase)).length;
        const cap = pendingCap(sim);
        line(body, 'File d’arrivées', `${pending}/${cap}`, pending >= cap ? 'bad' : '');
        // R26 : la qualité module les offres (palier = le mix de tailles
        // proposé par le planificateur, mesure = la ponctualité R17).
        const q = qualityView(sim);
        line(body, 'Qualité des offres',
          `${q.tierName} (valeur ${Math.round(q.q * 100)} %) — mesure ${q.measured == null ? '—' : Math.round(q.measured * 100) + ' %'}`,
          q.tier === 2 ? 'good' : '');
        // R32 : les incidents sont PAR ACTIF (attachés) — on liste ceux en
        // cours (l'actif est lisible : laquelle piste / quelle station).
        // R33 : pour chaque incident, les DEUX réponses (passive vs coûteuse/
        // allègement) + leurs CONSÉQUENCES (incidentResponse, lecture pure)
        // sont affichées AVANT décision ; le bouton émet l'intention
        // (respondIncident règle — la sim, pas l'UI).
        for (const r of Object.values(i.runways || {})) {
          if (r && r.remaining > 0) {
            const rw = (sim.infra.runways || []).find((x) => x.id === r.asset);
            line(body, `Piste ${r.asset}`, `FERMÉE (${Math.ceil(r.remaining)} s restants)${rw ? ` — ${rw.id}` : ''}`, 'bad');
            addResponses(body, sim, `runway:${r.asset}`);
          }
        }
        for (const f of Object.values(i.fuels || {})) {
          if (f && f.remaining > 0) {
            line(body, `Station ${f.asset}`, `panne carburant (${Math.ceil(f.remaining)} s)`, 'bad');
            addResponses(body, sim, `fuel:${f.asset}`);
          }
        }
        if (i.surge?.active) {
          line(body, 'Demande', `pic actif (cadence doublée, ${Math.ceil(i.surge.remaining)} s restants)`, 'warn');
          addResponses(body, sim, 'surge');
        }
        // T3 MÉTÉO (t_9b665a8b) : l'état météo + l'incident MÉTÉO (les
        // réponses — attendre / intervention payante — sont le même pattern
        // que piste/station/pic : incidentResponse lit, respondIncident règle).
        const wv = weatherView(sim);
        if (wv.incident) {
          line(body, 'Météo', `${wv.fr} — incident météo (effets orage, ${wv.incidentRemaining} s restants)`, 'bad');
          addResponses(body, sim, 'weather');
        } else if (wv.state !== 'clear') {
          line(body, 'Météo',
            wv.fr + (wv.speed < 1 ? ` — arrivée ${Math.round((1 - wv.speed) * 100)} % plus lente` : '') + (wv.delay > 0 ? ` · +${wv.delay} s en attente` : ''),
            'warn');
        }
        // COUPÉ : lecture SEULE du graphe — JAMAIS de rebuildGraph ici (avant le
        // 1er tick le graphe est null et c'est voulu : on l'affiche, on ne le
        // fabrique pas, R3/A7).
        const g = sim._graph;
        if (!g) { line(body, 'Graphe', 'pas encore construit (avant le 1er tick)', 'warn'); return; }
        line(body, 'Graphe', `${g.nodes.length} nœuds`);
        // Par taille de porte : un chemin PISTE→PORTE existe-t-il ? (findPath,
        // occupation vide = la question « est-ce joignable », pas « qui est dessus »).
        for (const size of ['S', 'M', 'L']) {
          const gates = (sim.infra.gates || []).filter((x) => x.size === size);
          if (!gates.length) continue;
          let ok = false;
          for (const x of gates) {
            const to = g.gateNode.get(x.id);
            if (to == null) continue; // porte HORS réseau : aucun segment ne la touche
            for (const rw of sim.infra.runways) {
              const from = runwayExitNode(sim, rw.id);
              if (from != null && findPath(sim, from, to, new Set())) { ok = true; break; }
            }
            if (ok) break;
          }
          line(body, `Portes ${size}`, ok ? 'atteignables depuis la piste' : 'INACCESSIBLES (réseau coupé)', ok ? '' : 'bad');
        }
      },
    );
  }

  return {
    // Appel à chaque frame (bus 'frame') : chaque panneau ne reconstruit son DOM
    // que si sa signature a changé — coût négligeable sinon (pattern planning).
    refresh: () => { refreshInspect(); refreshFin(); refreshStats(); refreshGoals(); refreshCampaign(); refreshUnlocks(); refreshContracts(); refreshHist(); refreshNet(); },
    // R07 : une sauvegarde rechargée ou une nouvelle partie change tout l'état —
    // la sélection inspecte un OBJET QUI N'EXISTE PLUS. invalidate() vide le pick
    // ; la prochaine refreshInspect rend l'état par défaut (pas un « parti »
    // stale). Câblé par save-panel (onLoad) et startNewGame dans main.mjs.
    invalidate: () => { pick = null; },
    // R39 (t_1c21c88e) : la sélection d'inspection est EXPOSÉE au renderer
    // (l'entouré blanc pointillé suit l'objet) — lecture seule de `pick`.
    selectionOf: () => pick,
    col,
  };
}

__exports.makePanels = makePanels;
})(__reg['m_src_ui_panels']);

/* --- module src/persistence/save.mjs --- */
(function (__exports) {
// Sauvegarde / chargement : sérialisation + validation de schéma + stockage navigateur.
// Les fonctions de LOGIQUE (serialize/deserialize) sont PURES (aucun DOM, aucune
// localStorage) → testables dans Node. Les wrappers de stockage (saveToStorage /
// loadFromStorage / clearSave) touchent localStorage et ne s'exécutent QUE dans le
// navigateur (le guard `typeof localStorage` les rend sans effet sous Node).
//
// Règle : on sérialise l'objet `state` entier (l'état global contient déjà la sim,
// conçue pour être sérialisable toute seule). La version de schéma permet de
// REJETER proprement une sauvegarde invalide ou trop ancienne (règle robuste).
//
// BL-08 (R6) :
//   A11 : serialize() est une FONCTION PURE — elle ne modifie JAMAIS l'état d'origine.
//         Le cache dérivé `sim._graph` (Maps/Sets en mémoire) est retiré de la COPIE
//         de sortie via un replacer, sans toucher à l'objet vivant.
//   A10 : deserialize() VALIDLE le schéma au chargement (types, identifiants,
//         références, capacités). Une sauvegarde invalide (ex : runways = null) est
//         REJETÉE proprement (erreur lisible) — le 1er tick ne crashe plus.
//   EV-10: l'état du générateur aléatoire (seed + compteur) est conservé dans la
//         sauvegarde pour reproductibilité (déterminisme).
//
// R10 (schéma explicite + migration) — la validation couvre :
//   - version stricte : v ≠ courante → rejet lisible (pas de migration : le jeu est
//     local/offline, une sauvegarde trop ancienne est REFUSÉE, jamais migrée —
//     politique D4 : rejet dur + cas non migrables documentés ici et dans la doc).
//   - identifiants : UN id par avion et par liste d'infra (pas de doublon qui
//     casserait les lookups gateNodeOf/runwayExitNode et les réservations).
//   - capacités : le type d'avion (acType) doit être UN CATÉLOGUE CONNU — la
//     vitesse de l'avion EST dérivée de ce type (AIRCRAFT[acType].approach/taxi),
//     un type inconnu ferait crasher le 1er tick (spec.minRunway undefined).
//   - références des DEUX côtés : avion → piste/porte EXISTANTE (déjà, A10) ET
//     porte → avion EXISTANT (g.acId : une porte « réservée » à un avion disparu
//     serait bloquée à JAMAIS — on la rejette proprement).
//   - chemins non restaurables : le chemin (ac.path, indices de nœuds du graphe)
//     EST reconstruit par la sim au 1er tick (rebuildGraph, R03) — on ne le
//     restaure PAS, on le marque dérivé. On valide seulement que, S'il est présent,
//     c'est bien un TABLEAU (une path corrompue en nombre/objet ferait crashe le
//     rebuild) ; la reconstruction elle-même gère « pas de chemin » → blocage lisible.
//   - dérivés NON restaurés comme source : `sim._graph` ET `sim.infra.grid` (grille
//     d'occupation) sont des CACHES DÉRIvés recalculés à partir des bâtiments —
//     ils sont RETIRÉS de la copie de sortie (replacer) puis RECONSTRUITS au
//     chargement (pas d'écriture dupliquée : la source reste l'infra, pas la cache).
//   - files passagers : si `passengers` est présent, queue/groups/satisfaction sont
//     des types CONSISTANTS (le tick passagers les avance — un type corrompu
//     rendrait les files NaN).
// ponytail: version de schéma entière (un chiffre). Si un futur champ casse le
// format, on bump SAVE_VERSION et on rejette l'ancienne au lieu de crasher.
const { AIRCRAFT, UPGRADES } = __ns('m_src_data_catalog');
const { buildGrid } = __ns('m_src_infra_infra');
const { ensureAssignments } = __ns('m_src_infra_assignments');
const { ensureUpgrades } = __ns('m_src_infra_upgrades');
const { ensureIncidents } = __ns('m_src_sim_incidents');
const { ensureLoan } = __ns('m_src_economy_economy');
const { ensureDifficulty } = __ns('m_src_core_difficulty');
const { ensureEvents } = __ns('m_src_sim_events');
const { ensureWeather } = __ns('m_src_sim_weather');
const { ensureClock } = __ns('m_src_sim_clock');

const SAVE_KEY = 'airport-tycoon-save';
const SAVE_VERSION = 1;
// Copie diagnostic : une sauvegarde invalide est PRÉSERVÉE ici (jamais supprimée),
// pour qu'un opérateur puisse l'inspecter sans bloquer le jeu (A10, brief).
const DIAG_KEY = 'airport-tycoon-save-diag';

// Ce qu'un état valide doit contenir (champs minimum). On valide ce qu'on RECHARGE.
// `sim` n'est pas requis : une partie M1 (terrain vide, pas de sim) est rechargeable.
const REQUIRED = ['screen', 'time', 'terrain', 'camera'];

// --- Validation du schéma (A10) ---------------------------------------------
// Vérifie types / identifiants / références / capacités. Lève une erreur LISIBLE
// (qui nomme le défaut) au PREMIER problème. Une sauvegarde produite par ce jeu
// est toujours cohérente : ces contrôles ne rejettent que les sauvegardes
// corrompues ou falsifiées, jamais une sauvegarde valide.
function isArr(v) { return Array.isArray(v); }
function isObj(v) { return v && typeof v === 'object'; }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function validateSim(sim) {
  if (!isObj(sim)) throw new Error('Sauvegarde invalide : sim absente ou illisible');
  // Politique : un champ ABSENT (sim M1, sim minimale) est toléré ; un champ PRÉSENT
  // mais de mauvais type (ex : runways = null, A10) est REFUSÉ. On valide donc
  // ce qui EST là, sans exiger la structure complète d'une partie moderne.
  const infra = sim.infra;
  if (isObj(infra)) {
    // Types : un tableau d'infra PRÉSENT doit être un vrai tableau (jamais null — A10).
    for (const k of ['runways', 'taxiways', 'terminals', 'gates', 'services']) {
      if (k in infra && !isArr(infra[k])) {
        throw new Error(`Sauvegarde invalide : sim.infra.${k} non listable`);
      }
    }
  }
  // Types : les listes de jeu PRÉSENTES doivent être des tableaux / objets.
  if ('aircraft' in sim && !isArr(sim.aircraft)) throw new Error('Sauvegarde invalide : sim.aircraft non listable');
  if (isObj(sim.economy) && !isFiniteNum(sim.economy.money)) {
    throw new Error('Sauvegarde invalide : solde de trésorerie non numérique');
  }
  // R35 (t_dabe90d7) : l'emprunt borné (economy.loan) — PRÉSENT doit être un
  // objet {principal, count} numériques (la lecture loanState / le bilan les
  // lit — un type corrompu ferait NaN dans la sim au 1er tick). Absent =
  // sauvegarde ancienne, tolérée (ensureLoan au chargement, pattern R31).
  if (isObj(sim.economy) && 'loan' in sim.economy && !isObj(sim.economy.loan)) {
    throw new Error('Sauvegarde invalide : emprunt (economy.loan) illisible');
  }
  if (isObj(sim.economy) && isObj(sim.economy.loan)) {
    for (const k of ['principal', 'count']) {
      if (k in sim.economy.loan && !isFiniteNum(sim.economy.loan[k])) {
        throw new Error(`Sauvegarde invalide : emprunt (${k}) non numérique`);
      }
    }
  }
  // R35 : le compteur d'alertes de trésorerie (cooldown) SI présent est un objet
  // (des horodatages) — un type corrompu ferait la re-prévention spammer.
  if (isObj(sim.economy) && isObj(sim.economy._treasuryAlerts)) {
    for (const v of Object.values(sim.economy._treasuryAlerts)) {
      if (!isFiniteNum(v)) throw new Error('Sauvegarde invalide : alerte de trésorerie non numérique');
    }
  }
  // EV-10 : l'état du PRNG, SI présent, doit être des entiers 32 bits (seed + compteur).
  if (sim.rngSeed !== undefined && !Number.isInteger(sim.rngSeed)) {
    throw new Error('Sauvegarde invalide : seed du générateur non entier');
  }
  if (sim.rngCounter !== undefined && !Number.isInteger(sim.rngCounter)) {
    throw new Error('Sauvegarde invalide : compteur du générateur non entier');
  }
  // Identifiants + références : chaque bâtiment/avion PRÉSENT a un id UNIQUE ; un
  // avion qui pointe vers une piste/porte doit viser un id EXISTANT (pas une
  // référence périmée) ; R10 : la porte qui pointe vers un avion doit aussi viser
  // un avion EXISTANT (référence des DEUX côtés) et le type d'avion doit être connu
  // (capacité : la vitesse est dérivée du type).
  // BL-12 : « refuel » (remise à niveau carburant) rejoint la liste des phases.
  const PHASES = new Set(['approach', 'holding', 'landing', 'exit', 'taxi', 'docking',
    'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked',
    'departed', 'cancelled']);
  const lists = [];
  if (isObj(infra)) for (const k of ['runways', 'taxiways', 'terminals', 'gates', 'services']) {
    if (isArr(infra[k])) lists.push(infra[k]);
  }
  for (const list of lists) for (const b of list) {
    if (!isObj(b) || b.id == null) throw new Error('Sauvegarde invalide : bâtiment sans identifiant');
  }
  // R10 (identifiants) : UN id par liste d'infra — un doublon casserait les lookups
  // (gateNodeOf / runwayExitNode) et les réservations. On détecte par liste.
  for (const list of lists) {
    const seen = new Set();
    for (const b of list) {
      if (seen.has(b.id)) throw new Error(`Sauvegarde invalide : identifiant infra en double (${b.id})`);
      seen.add(b.id);
    }
  }
  const runwayIds = new Set((isArr(infra && infra.runways) ? infra.runways : []).map((r) => r.id));
  const gateIds = new Set((isArr(infra && infra.gates) ? infra.gates : []).map((g) => g.id));
  const acIds = new Set();
  if (isArr(sim.aircraft)) for (const ac of sim.aircraft) {
    if (!isObj(ac) || ac.id == null) throw new Error('Sauvegarde invalide : avion sans identifiant');
    // R10 (identifiants) : un avion par id — un doublon double-compterait la
    // réservation de porte / le segment (les deux avions visaient le même id).
    if (acIds.has(ac.id)) throw new Error(`Sauvegarde invalide : avion ${ac.id} en double`);
    acIds.add(ac.id);
    // R10 (capacités) : le TYPE d'avion doit être au CATALOGUE — la vitesse et les
    // contraintes (piste/porte) en sont dérivées ; un type inconnu ferait crasher
    // le 1er tick (AIRCRAFT[acType] undefined → spec.minRunway undefined).
    if (ac.acType !== undefined && !AIRCRAFT[ac.acType]) {
      throw new Error(`Sauvegarde invalide : type avion inconnu « ${ac.acType} » (avion ${ac.id})`);
    }
    if (!PHASES.has(ac.phase)) throw new Error(`Sauvegarde invalide : phase inconnue « ${ac.phase} »`);
    // R10 (chemin non restaurable) : le chemin est un CACHÉ DÉRIVÉ du graphe
    // (indices de nœuds) — il est RECONSTRUIT au 1er tick (rebuildGraph, R03).
    // On ne le restaure PAS ; on valide seulement que, s'il est PRÉSENT (ni null
    // ni undefined — « pas de chemin en cours » est légitime, ex. phase approche),
    // c'est bien un TABLEAU (une path corrompue en chaîne/nombre ferait crasher le
    // rebuild). La reconstruction gère « pas de chemin » → blocage lisible.
    if (ac.path != null && !isArr(ac.path)) {
      throw new Error(`Sauvegarde invalide : chemin non restaurable (avion ${ac.id})`);
    }
    if (ac.runwayId != null && !runwayIds.has(ac.runwayId)) {
      throw new Error(`Sauvegarde invalide : avion ${ac.id} → piste inexistante ${ac.runwayId}`);
    }
    if (ac.gateId != null && !gateIds.has(ac.gateId)) {
      throw new Error(`Sauvegarde invalide : avion ${ac.id} → porte inexistante ${ac.gateId}`);
    }
  }
  // R41 : les incidents attachés aux actifs (sim.incidents, R32) — PRÉSENT doit
  // être un objet (les sous-objets i.runways/i.fuels + horloges y vivent) : un
  // type corrompu (null/chaîne) passerait la validation puis serait ÉCRASÉ par
  // ensureIncidents au chargement (l'état incident perdu sans erreur lisible).
  // ABSENT = sauvegarde pré-R32, tolérée (ensureIncidents le re-attache).
  if ('incidents' in sim && sim.incidents != null && typeof sim.incidents !== 'object') {
    throw new Error('Sauvegarde invalide : incidents (sim.incidents) illisibles');
  }
  // R41 : même classe de défaut pour les passagers (R30) : un champ PRÉSENT
  // mais non-objet (chaîne, nombre) ferait crasher le 1er tick (ensurePassengers
  // écrit les totaux sur la valeur). null = sauvegarde ancienne, tolérée.
  if ('passengers' in sim && sim.passengers != null && typeof sim.passengers !== 'object') {
    throw new Error('Sauvegarde invalide : passagers (sim.passengers) illisibles');
  }
  // T3 (t_4c9baadc) : la couche d'événements dynamiques (sim.events) — PRÉSENT
  // doit être un objet (les compteurs acc/last/seq/fired y vivent) : un type
  // corrompu (chaîne/nombre) passerait la validation puis serait ÉCRASÉ par
  // ensureEvents au chargement (l'état perdu sans erreur lisible — pattern R41).
  // ABSENT = sauvegarde pré-T3, tolérée (ensureEvents le re-attache).
  if ('events' in sim && sim.events != null && typeof sim.events !== 'object') {
    throw new Error('Sauvegarde invalide : événements dynamiques (sim.events) illisibles');
  }
  // R10 (références des DEUX côtés) : une porte RÉSERVÉE (g.acId) doit viser un
  // avion EXISTANT. Sans ça, une porte « occupée » par un avion disparu resterait
  // verrouillée à JAMAIS (demolish refuse « porte occupée ») → on la rejette.
  if (isObj(infra) && isArr(infra.gates)) for (const g of infra.gates) {
    if (g.acId != null && !acIds.has(g.acId)) {
      throw new Error(`Sauvegarde invalide : porte ${g.id} réservée par un avion inexistant (${g.acId})`);
    }
  }
  // R10 (files passagers) : si `passengers` est PRÉSENT, les structures sont des
  // types CONSISTANTS — le tick les avance (q[stage] -= …) : un champ non
  // numérique rendrait les files NaN et la satisfaction non bornée.
  // R30 : les files sont PAR TERMINAL (queues[terminalId] = {checkin,security,
  // board}) + compteurs de flux par terminal (injectedTotal/securityDone) ; les
  // groupes (gr.volId) servent au comptage unique. L'ancienne file GLOBALE
  // `queue` (pré-R30) est tolérée (sauvegarde ancienne) mais plus lue.
  if (isObj(sim.passengers)) {
    const pq = sim.passengers.queues;
    if (isObj(pq)) for (const [tid, q] of Object.entries(pq)) {
      if (isObj(q)) for (const s of ['checkin', 'security', 'board']) {
        if (s in q && !isFiniteNum(q[s])) {
          throw new Error(`Sauvegarde invalide : file passagers « ${s} » (terminal ${tid}) non numérique`);
        }
      }
    }
    // Compteurs de flux par terminal (R30) : objets terminalId → nombre.
    for (const k of ['injectedTotal', 'securityDone']) {
      if (k in sim.passengers && isObj(sim.passengers[k])) {
        for (const v of Object.values(sim.passengers[k])) {
          if (v !== undefined && !isFiniteNum(v)) {
            throw new Error(`Sauvegarde invalide : compteur passagers « ${k} » non numérique`);
          }
        }
      }
    }
    if ('groups' in sim.passengers && !isArr(sim.passengers.groups)) {
      throw new Error('Sauvegarde invalide : groupes de passagers non listable');
    }
  }
  // R31 (t_7a512737) : améliorations de capacité PAR TERMINAL —
  // sim.upgrades[terminalId] = { terminal, fueling, teams, … } (niveaux
  // entiers) — T33 (t_88aee6d5) : la liste suit le CATALOGUE (UPGRADES,
  // 6 choix — plus de clé en dur : un choix nouveau est validé automatiquement).
  // ABSENTE = sauvegarde ancienne (tolérée, ensureUpgrades au chargement) ;
  // PRÉSENTE mais de mauvais type (objet non lisible, niveau non numérique)
  // → REJETÉE (les multiplicateurs feraient NaN dans la sim au 1er tick).
  if (isObj(sim.upgrades)) {
    for (const [tid, t] of Object.entries(sim.upgrades)) {
      if (!isObj(t)) throw new Error(`Sauvegarde invalide : améliorations du terminal ${tid} illisibles`);
      for (const k of Object.keys(UPGRADES)) {
        if (k in t && !Number.isInteger(t[k])) {
          throw new Error(`Sauvegarde invalide : niveau d'amélioration « ${k} » (terminal ${tid}) non entier`);
        }
      }
    }
  }
}

// Sérialise un état de jeu en chaîne JSON (stockable). FONCTION PURE (A11) :
// le replacer retire les caches DÉRIvés de la COPIE de sortie SANS toucher à
// l'objet vivant — la partie en cours reste intacte. Deux caches dérivées sont
// recalculées à partir des bâtiments (la SOURCE) au chargement, donc on ne les
// persiste PAS :
//   - `sim._graph` (grapphe pathfinding, Maps/Sets) → reconstruit (R03).
//   - `sim.infra.grid` (grille d'occupation, Uint8Array) → `buildGrid` la
//     recalcule. Non persistée : un Uint8Array sérialise en 19200 clés
//     numériques (gigantesque) et au retour JSON devient `{}` → `fits()`
//     lirait chaque cellule comme VIDE (on construirait par-dessus tout).
function serialize(state) {
  return JSON.stringify(
    { v: SAVE_VERSION, state },
    (key, value) => (key === '_graph' || key === 'grid' ? undefined : value),
  );
}

// Dé-sérialise + VALIDE le schéma (A10). Lève une erreur LISIBLE si invalide.
// Retourne un état FRAÎCHEMENT cloné (pas la référence interne).
function deserialize(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Sauvegarde illisible (JSON corrompu)');
  }
  if (!isObj(raw)) throw new Error('Sauvegarde vide');
  if (raw.v !== SAVE_VERSION) {
    throw new Error(`Sauvegarde incompatible (v${raw.v ?? '?'} ≠ v${SAVE_VERSION})`);
  }
  const s = raw.state;
  if (!isObj(s)) throw new Error('Sauvegarde sans état de jeu');
  for (const k of REQUIRED) {
    if (!(k in s)) throw new Error(`Champ manquant dans la sauvegarde : ${k}`);
  }
  // A10 : validation des structures de sim (types / identifiants / références / capacités).
  if ('sim' in s) validateSim(s.sim);
  const out = JSON.parse(JSON.stringify(s));
  // Le graphe pathfinding est un cache dérivé : il est RECONSTRUIT par la sim au
  // 1er tick, on ne le restaure pas (marqué sale pour forcer la reconstruction).
  if (out.sim) {
    out.sim._graph = null; out.sim._graphDirty = true;
    // R09 (migration, D3) : les anciennes sauvegardes n'avaient PAS de seed
    // effectif — le générateur ne consommait que rngCounter (le champ rngSeed
    // n'existait pas, ou valait 0 = la suite d'origine). Absent/illisible →
    // migration seed 0 + compteur 0 : la suite redevient EXACTEMENT la suite
    // pré-R09 (bit-à-bit, l'ancrage des fixtures de migration evidence/seed-*)
    // ET la partie reste reproductible à la reprise.
    if (!Number.isInteger(out.sim.rngSeed)) out.sim.rngSeed = 0;
    if (!Number.isInteger(out.sim.rngCounter)) out.sim.rngCounter = 0;
    // R10 (valeurs dérivées) : la GRILLE D'OCCUPATION (`infra.grid`) est un
    // cache dérivé des BÂTIMENTS (la source) — elle est recalculée ici depuis
    // l'infra, pas restaurée (pas d'écriture dupliquée). `buildGrid` remplit
    // w/h/cells depuis les 5 listes ; on garantit leur présence (absente → []).
    if (isObj(out.sim.infra)) {
      const infra = out.sim.infra;
      for (const k of ['runways', 'taxiways', 'terminals', 'gates', 'services']) {
        if (!Array.isArray(infra[k])) infra[k] = [];
      }
      if (!isObj(infra.grid)) infra.grid = {}; // buildGrid remplit w/h/cells
      buildGrid(out.sim);
    }
    // R27 (t_6424937a) : migration des AFFECTATIONS de services — les
    // sauvegardes pré-R27 n'ont pas de champ `target` : ensureAssignments
    // applique la règle du placement (terminal le plus proche, DETERMINISTE)
    // aux services sans affectation, et réaffecte ceux devenus orphelins
    // (terminal supprimé entre-temps). Le retour (nombre de services touchés)
    // est lisible : l'UI peut annoncer la migration.
    ensureAssignments(out.sim);
    // R31 (t_7a512737) : migration des AMÉLIORATIONS de capacité — les
    // sauvegardes pré-R31 n'ont pas de champ `upgrades` : ensureUpgrades
    // crée l'objet vide (niveaux 0 par défaut — on ne RE-débite jamais au
    // chargement, le niveau est la source du coût déjà payé).
    ensureUpgrades(out.sim);
    // R32 (t_9f267552) : migration des INCIDENTS attachés aux actifs — les
    // sauvegardes pré-R32 ont les 3 commutateurs GLOBAUX (runway/fuel/surge)
    // et pas les objets i.runways/i.fuels (fermeture PISTE / panne STATION
    // attachées). ensureIncidents crée les sous-objets manquants ET PURGE les
    // enregistrements dont l'actif a été supprimé (pas de référence orpheline)
    // — l'état et le calendrier (compteurs acc/last) survivent à la reprise.
    ensureIncidents(out.sim);
    // R35 (t_dabe90d7) : l'emprunt borné (economy.loan) — les sauvegardes
    // pré-R35 ont le champ ABSENT (comme upgrades/incidents : toléré, la
    // factory le met par défaut ; on ne réinvente pas la migration ici).
    ensureLoan(out.sim);
    // T2-1 (t_d5da994c) : la DIFFICULTÉ — les sauvegardes PRÉ-T2-1 ont
    // state.difficulty ET sim.difficulty ABSENTS : ensureDifficulty replace
    // le profil normal (référentiel ×1) — une partie ancienne reprend
    // EXACTEMENT comme avant (comportement inchangé), pas de crash.
    ensureDifficulty(out, out.sim);
    // T3 (t_4c9baadc) : la COUCHE D'ÉVÉNEMENTS DYNAMIQUES (sim.events) — les
    // sauvegardes PRÉ-T3 n'ont PAS le champ (toléré, comme upgrades/incidents :
    // la factory le met par défaut ; ensureEvents le re-attache + normalise
    // les compteurs corrompus — pas de crash au 1er tick, pas de crash au
    // tirage : la fenêtre démarre à 0, l'état de relecture est le même).
    ensureEvents(out.sim);
    // T3 MÉTÉO (t_9b665a8b) : le CHAMP MÉTÉO (sim.weather) — les sauvegardes
    // PRÉ-T3 l'ont ABSENT (toléré, comme upgrades/incidents) : ensureWeather
    // l'adopte en « clear » neuf (comportement inchangé à la reprise) et
    // répare un champ corrompu (état inconnu / durée hors bornes) — sans
    // toucher les autres champs (migration ADDITIVE, EV-10).
    ensureWeather(out.sim);
    // T3 HORLOGE (t_76744b22) : le CHAMP HORLOGE (sim.clock) — les
    // sauvegardes PRÉ-T3-horloge l'ont ABSENT (toléré, comme weather) :
    // ensureClock l'adopte à l'état initial (jour 1, 08:00 — la partie
    // reprend le MATIN, comportement de référence : saison printemps ×1) et
    // répare un champ corrompu (jour non entier / t non fini) — sans
    // toucher les autres champs (migration ADDITIVE, EV-10).
    ensureClock(out.sim);
  }
  return out;
}

// --- Stockage navigateur (localStorage) — sans effet sous Node. --------------

// Y a-t-il une sauvegarde ? (pour proposer « Reprendre » au menu)
function hasSave() {
  return typeof localStorage !== 'undefined' && localStorage.getItem(SAVE_KEY) !== null;
}

// Enregistre l'état ; retourne true si succès (l'UI fait le toast).
function saveToStorage(state) {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false; // stockage plein / indisponible : on signale, on ne plante pas
  }
}

// Charge + valide depuis le stockage. Retourne l'état restauré, ou null si absente.
// Lève une erreur LISIBLE si la sauvegarde existe mais est invalide.
// A10 : une sauvegarde invalide n'est JAMAIS supprimée — elle est PRÉSERVÉE
// (copie diagnostic, DIAG_KEY) pour qu'un opérateur puisse l'inspecter, puis
// l'erreur (lisible) est relancée pour que l'UI l'annonce (toast, sans crash).
function loadFromStorage() {
  if (typeof localStorage === 'undefined') return null;
  const json = localStorage.getItem(SAVE_KEY);
  if (json === null) return null;
  try {
    return deserialize(json);
  } catch (e) {
    preserveDiag(json); // copie diagnostic (l'original reste EN PLACE, rien n'est perdu)
    throw e;
  }
}

// Efface la sauvegarde (après un chargement raté ou une nouvelle partie).
function clearSave() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
}

// Préserve une COPIE DIAGNOSTIC d'une sauvegarde invalide (A10, brief).
// On ne supprime JAMAIS la sauvegarde d'origine : elle est dupliquée ici pour
// qu'un opérateur puisse l'inspecter, puis l'UI peut choisir de continuer.
function preserveDiag(json) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(DIAG_KEY, String(json));
    return true;
  } catch {
    return false; // stockage plein : on n'écrase pas le diagnostic, on ne plante pas
  }
}

__exports.SAVE_KEY = SAVE_KEY;
__exports.SAVE_VERSION = SAVE_VERSION;
__exports.DIAG_KEY = DIAG_KEY;
__exports.serialize = serialize;
__exports.deserialize = deserialize;
__exports.hasSave = hasSave;
__exports.saveToStorage = saveToStorage;
__exports.loadFromStorage = loadFromStorage;
__exports.clearSave = clearSave;
__exports.preserveDiag = preserveDiag;
})(__reg['m_src_persistence_save']);

/* --- module src/ui/planning-panel.mjs --- */
(function (__exports) {
// Panneau planning (BL-16, AC20 + R19) : liste consultable des vols,
// SÉPARÉE en « à décider » (offres planned) et « en cours » (opérations),
// + boutons accepter/refuser (+ par filtre) + case « auto-accept ».
// UI fine : la DÉCISION vit dans la sim (decideFlight, src/flights/flights.mjs)
// et la NOTE DE DÉCISION (obstacle/risque/revenu estimé) aussi (planNote) —
// ici uniquement DOM + clics. La liste est SÉRIEUSE : elle n'est reconstruite
// que quand la signature change (id:status) — sinon les boutons
// disparaîtraient sous la souris à chaque frame et les clics ne partiraient pas.
// R06 (D1) : la préférence auto-accept a UNE seule source de vérité,
// state.planningAuto (sérialisée). La case n'est qu'un miroir DOM de
// state.planningAuto : elle ÉMET la même commande que la touche A
// (onAutoChange, câblée par main.mjs) et se resynchronise via setAuto.
const { decideFlight, planNote } = __ns('m_src_flights_flights');
const { AIRCRAFT, AIRLINES } = __ns('m_src_data_catalog');
const { EVENTS } = __ns('m_src_sim_events');

const STATUS = Object.freeze({
  planned: 'prévu', accepted: 'accepté', 'in-flight': 'en vol',
  delayed: 'retardé', cancelled: 'annulé',
});

function makePlanningPanel({ state, toast, onAutoChange }) {
  const panel = {};

  // DOM fixe (créé UNE fois) : titres de section, ligne de filtres, zones de
  // lignes. Seules les zones de lignes changent — et seulement quand la
  // signature du planning change (R19 : sections « à décider » / « en cours »).
  const box = document.createElement('div');
  box.className = 'planning';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Planning des vols (accepter / refuser)');
  const title = document.createElement('h4');
  title.textContent = 'Vols';
  const decTitle = document.createElement('h5');
  decTitle.className = 'planning-sec';
  decTitle.textContent = 'À décider';
  const decRows = document.createElement('div');
  decRows.className = 'planning-rows';
  const opsTitle = document.createElement('h5');
  opsTitle.className = 'planning-sec';
  opsTitle.textContent = 'En cours';
  const opsRows = document.createElement('div');
  opsRows.className = 'planning-rows';
  // Filtre (R19 : accepter/refuser TOUTS les éléments d'un filtre utile) —
  // état LOCAL DE L'UI (il ne décide rien : la décision reste decideFlight,
  // la porte unique) : le filtre ne fait que choisir la cible du lot.
  const filterBar = document.createElement('div');
  filterBar.className = 'planning-filters';
  const autoLabel = document.createElement('label');
  autoLabel.className = 'planning-auto';
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = !!state.planningAuto; // miroir de l'état (source unique), pas un state
  autoCb.addEventListener('change', () => {
    // La case n'écrit PAS un flag local : elle émet l'intention vers l'état,
    // par la MÊME commande que la touche A (D1 — plus de source parallèle).
    onAutoChange?.(autoCb.checked);
  });
  autoLabel.append(autoCb, document.createTextNode(' auto-accepter les vols prévus'));
  box.append(title, decTitle, decRows, filterBar, opsTitle, opsRows, autoLabel);
  document.body.appendChild(box);

  // Synchronise le miroir DOM de la case sur l'état (touche A / rechargement /
  // nouvelle partie) sans re-déclencher d'événement (on change .checked, pas
  // .click()). C'est un miroir : la source reste state.planningAuto (D1).
  panel.setAuto = (on) => { autoCb.checked = !!on; };

  // T51 (t_cccfbc97) : la RACINE DOM du panneau est EXPOSÉE (main.mjs la
  // masque au menu — le panneau de jeu ne flotte pas au-dessus du menu).
  panel.box = box;

  function airlineName(id) { return (AIRLINES.find((x) => x.id === id) || { name: id }).name; }
  // Horloge de la sim en heures:minutes:secondes (le planning est « consultable
  // avec les horaires prévus » — un timestamp lisible, pas un nombre brut).
  function fmtClock(t) {
    const s = Math.max(0, Math.floor(t));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // Note de DÉCISION d'une offre (planNote, flights.mjs — la règle sim) :
  // obstacle (offre impossible → motif lisible), risque (sans promesse de
  // rentabilité), revenu ESTIMÉ (hypothèse, préfixe explicite).
  function renderNote(sim, e, row) {
    const n = planNote(sim, e);
    const ac = n.spec;
    const bits = [];
    if (ac && ac.seats) bits.push(`charge ${e.pax}/${ac.seats}`);
    bits.push(`≈ ${Math.round(n.revenue)} $ (estimé)`);
    for (const r of n.risks) bits.push(`⚠ ${r}`);
    for (const o of n.obstacles) bits.push(`⛔ ${o}`);
    if (!bits.length) return;
    const note = document.createElement('span');
    note.className = 'planning-note';
    note.textContent = ' · ' + bits.join(' · ');
    row.appendChild(note);
  }

  // Une ligne du planning (les deux sections partagent le même rendu).
  // Les boutons « Accepter/Refuser » n'existent QUE sur les offres « planned »
  // (le SEUL état décisionnable — règle sim, decideFlight) : une décision ne
  // peut donc jamais s'appliquer à un vol déjà déployé (critère R19, la garde
  // vit dans decideFlight, pas ici).
  function renderRow(sim, e, host) {
    const row = document.createElement('div');
    row.className = 'planning-row';
    const ac = AIRCRAFT[e.acType];
    const info = document.createElement('span');
    // T3 (t_4c9baadc) : l'offre injectée par un événement dynamique porte le
    // marqueur `event` — le NOM de l'événement est affiché (table EVENTS,
    // lecture seule) : le joueur sait d'où vient l'offre à décider.
    const evName = e.event ? (EVENTS[e.event] ? EVENTS[e.event].name : e.event) : null;
    info.textContent = `${airlineName(e.airline)} · ${ac ? ac.name : e.acType} · ${e.pax} pax · ${fmtClock(e.planned)} · ${STATUS[e.status] || e.status}` +
      (e.why ? ` (${e.why})` : '') + (evName ? ` · ⚡ ${evName}` : '');
    row.appendChild(info);
    if (e.status === 'planned') {
      renderNote(sim, e, row); // R19 : obstacle/risque/revenu estimé AVANT la décision
      const ok = document.createElement('button');
      ok.textContent = 'Accepter';
      ok.addEventListener('click', () => {
        if (decideFlight(sim, e.id, true)) toast(`Vol #${e.id} accepté`, 'ok');
        panel.refresh();
      });
      const no = document.createElement('button');
      no.textContent = 'Refuser';
      no.addEventListener('click', () => {
        if (decideFlight(sim, e.id, false)) toast(`Vol #${e.id} refusé — n'arrivera pas`, 'ok');
        panel.refresh();
      });
      row.append(ok, no);
    }
    host.appendChild(row);
  }

  // Filtre utile (R19) : « tous / par compagnie / par taille » — les boutons de
  // masse ciblent les offres « planned » du filtre et passent par decideFlight
  // (la porte unique : pas de contournement des validations métier).
  // Le filtre est un état local d'affichage (closure) : il ne décide rien.
  let filter = 'tous';
  function matchFilter(e) {
    if (filter === 'tous') return true;
    if (filter.startsWith('comp:')) return e.airline === filter.slice(5);
    return e.acType === filter.slice(5); // 'taille:...'
  }
  function addFilterButtons() {
    filterBar.replaceChildren();
    const labels = [{ id: 'tous', name: 'tous' }];
    for (const a of AIRLINES) labels.push({ id: `comp:${a.id}`, name: a.name });
    for (const k of Object.keys(AIRCRAFT)) labels.push({ id: `taille:${k}`, name: k });
    for (const f of labels) {
      const b = document.createElement('button');
      b.textContent = f.name;
      b.className = 'planning-filter' + (f.id === filter ? ' on' : '');
      b.addEventListener('click', () => { filter = f.id; addFilterButtons(); });
      filterBar.appendChild(b);
    }
    const accAll = document.createElement('button');
    accAll.textContent = '✓ filtrés';
    accAll.addEventListener('click', () => bulkDecide(true));
    const refAll = document.createElement('button');
    refAll.textContent = '✗ filtrés';
    refAll.addEventListener('click', () => bulkDecide(false));
    filterBar.append(accAll, refAll);
  }
  function bulkDecide(accept) {
    const sim = state.sim;
    if (!sim) return;
    let n = 0;
    for (const e of sim.planning) {
      if (e.status !== 'planned' || !matchFilter(e)) continue;
      if (decideFlight(sim, e.id, accept)) n++; // porte unique : refait la garde « planned »
    }
    toast(`${n} vol(s) ${accept ? 'accepté' : 'refusé'} (${filter})`, 'ok');
    panel.refresh();
  }

  // Rendu (appelé à chaque frame par le bus, coût négligeable) : on reconstruit
  // les lignes UNIQUEMENT si la signature du planning a changé.
  let sig = null;
  panel.refresh = () => {
    const sim = state.sim;
    if (state.screen !== 'game' || !sim) {
      if (sig !== 'menu') {
        sig = 'menu';
        decRows.replaceChildren();
        opsRows.replaceChildren();
      }
      return;
    }
    const list = sim.planning; // consultable : tous les états (la purge retire les finis)
    const s = list.map((e) => `${e.id}:${e.status}`).join('|');
    if (s === sig) return; // liste inchangée → DOM stable (clics/hover/focus intacts)
    sig = s;
    const planned = list.filter((e) => e.status === 'planned');
    const running = list.filter((e) => e.status !== 'planned');
    title.textContent = `Vols (${list.length})`;
    decTitle.textContent = `À décider (${planned.length})`;
    opsTitle.textContent = `En cours (${running.length})`;
    decRows.replaceChildren();
    opsRows.replaceChildren();
    for (const e of planned) renderRow(sim, e, decRows);
    for (const e of running) renderRow(sim, e, opsRows);
    if (!planned.length) {
      const p = document.createElement('p');
      p.className = 'planning-empty';
      p.textContent = 'Aucune offre à décider (un vol ~toutes les 60 s de sim)';
      decRows.appendChild(p);
    }
    addFilterButtons(); // barre reconstruite avec la liste (boutons stables, 1/frame max)
  };

  // « Auto-accept » : politique JOUEUR (l'UI accepte pour lui), pas une règle de
  // sim : decideFlight reste la SEULE porte de décision, la sim ne déploie
  // jamais un vol qu'elle a elle-même accepté. La préférence survit à la
  // sauvegarde (elle est sur le state — le format entier est sérialisé).
  // D1 : la case lit state.planningAuto (source unique) — pas un flag local.
  // main.mjs ne l'appelle QUE si state.planningAuto est vrai (double garde).
  panel.tickAuto = () => {
    if (!state.planningAuto) return;
    const sim = state.sim;
    if (state.screen !== 'game' || !sim) return;
    for (const e of sim.planning) {
      if (e.status === 'planned') decideFlight(sim, e.id, true);
    }
  };

  return panel;
}

__exports.makePlanningPanel = makePlanningPanel;
})(__reg['m_src_ui_planning-panel']);

/* --- module src/ui/save-panel.mjs --- */
(function (__exports) {
// Panneau Sauvegarde : charge/enregistre la sauvegarde via localStorage et
// affiche le résultat en toast (succès ou échec lisible).
// Règle : la LOGIQUE (sérialiser, valider) est dans src/persistence/save.mjs ;
// ici on ne fait que relier la UI à ces fonctions et rendre les erreurs lisibles.
// A10 : une sauvegarde invalide n'est JAMAIS supprimée ici — la copie diagnostic
// est préservée par loadFromStorage (DIAG_KEY) et l'original reste en place.
const { saveToStorage, loadFromStorage, hasSave } = __ns('m_src_persistence_save');

function makeSavePanel(state, { toast, syncPlanningPanel, onLoad }) {
  // Enregistre l'état courant (manuel, touche S). Uniquement en jeu : sauvegarder
  // au menu écraserait la partie avec un état de menu inutilisable.
  function saveNow() {
    if (state.screen !== 'game') { toast('Sauvegarde disponible en jeu (S)', 'info'); return false; }
    const ok = saveToStorage(state);
    toast(ok ? 'Sauvegarde effectuée' : 'Impossible de sauvegarder (espace disque)', ok ? 'ok' : 'err');
    return ok;
  }

  // Sauvegarde SILENCIEUSE (automatique : fermeture de page, quitter, périodique).
  // Même écriture que saveNow mais sans toast : l'automatique ne doit pas polluer.
  function autoSave() {
    if (state.screen !== 'game') return false;
    return saveToStorage(state);
  }

  // Y a-t-il une sauvegarde à proposer au menu (« Reprendre ») ?
  function canResume() { return hasSave(); }

  // Restaure la sauvegarde ; si elle est absente ou invalide, signale en clair.
  // A10 : sur invalide, la sauvegarde est PRÉSERVÉE (copie diagnostic, voir
  // loadFromStorage) — on ne la supprime JAMAIS ; l'incompatibilité est annoncée
  // (toast) sans crash et sans perte de la sauvegarde d'origine.
  function loadNow() {
    let restored;
    try {
      restored = loadFromStorage();
    } catch (e) {
      toast(e.message || 'Sauvegarde illisible', 'err'); // annoncée ; la copie diag est en place
      return false;
    }
    if (!restored) {
      toast('Aucune sauvegarde trouvée', 'info');
      return false;
    }
    // On remplace le contenu de `state` EN PLACE (la caméra et la boucle gardent
    // leurs références). `sim` est assigné SÉPARÉMENT : Object.assign ne
    // supprime jamais un champ absent du clone (une partie sans sim ne doit pas
    // laisser l'ancienne sim en place, et l'inverse non plus).
    Object.assign(state, restored);
    state.sim = restored.sim || null;
    state.paused = false;
    state._alertSeen = 0; // les alertes restaurées sont déjà connues du joueur
    // R06 (D2) : la préférence auto-accept (state.planningAuto) est sérialisée
    // AVEC le state entier (serialize) et restaurée ici par Object.assign → le
    // DOM du panneau suit via le hook (la UI fine n'a pas l'objet du panneau,
    // elle en émet la commande syncPlanningPanel, câblée par main.mjs).
    // (avant R06, la préférence était un flag local du panneau : le load la
    // perdait. Maintenant elle est sur le state = sérialisée = rechargée.)
    // R20 : l'intro (state.intro) suit le MÊME chemin que planningAuto —
    // Object.assign la restaure ; une sauvegarde ANCIENNE sans ce champ garde
    // la valeur de la session courante (le champ vit sur le state, il n'est
    // jamais re-supprimé — même pattern que state.sim juste au-dessus).
    syncPlanningPanel?.(); // la case auto-accept (BL-16 / R06) suit le state restauré
    onLoad?.(); // R07 : la sélection d'inspection (pick) pointe vers l'ANCIENNE sim
                 // (objet disparu) — elle est invalidée par le hook câblé dans main.mjs
                 // (panels.invalidate), pour ne pas afficher un avion fantôme.
    toast('Jeu restauré', 'ok');
    return true;
  }

  return { saveNow, loadNow, autoSave, canResume };
}

__exports.makeSavePanel = makeSavePanel;
})(__reg['m_src_ui_save-panel']);

/* --- module src/main.mjs --- */
(function (__exports) {
// Point d'entrée du jeu (navigateur). Câble : état, bus, caméra, entrées, rendu, boucle,
// UI fine (toasts, outil construction, panneau sauvegarde). Aucune règle de jeu ici —
// juste du câblage (règle : l'UI est fine, elle lit l'état et émet des commandes).
const { newGame, setScreen, togglePause, cycleSpeed, SCREENS, SPEEDS } = __ns('m_src_core_game-state');
const { EventBus } = __ns('m_src_core_events');
const { Camera } = __ns('m_src_ui_camera');
const { makeInputHandlers } = __ns('m_src_ui_input');
const { makeRenderer } = __ns('m_src_ui_renderer');
const { makeOptionsPage, loadOptions, saveOptionsToStorage, normalizeOptions } = __ns('m_src_ui_options');
const { startLoop } = __ns('m_src_core_loop');
const { makeToasts } = __ns('m_src_ui_toast');
const { makeBuildTool } = __ns('m_src_ui_build-tool');
const { makeSavePanel } = __ns('m_src_ui_save-panel');
const { makePlanningPanel } = __ns('m_src_ui_planning-panel');
const { makePanels } = __ns('m_src_ui_panels');
const { makeIntro } = __ns('m_src_ui_intro');
const { makeTips } = __ns('m_src_ui_tips');
const { makeBankruptcyScreen, resumeCommand } = __ns('m_src_ui_bankruptcy');
const { makeJuice, juiceForAlert } = __ns('m_src_ui_juice');
const { makeAudioEngine, sfxForAlert, normalizeAudioState } = __ns('m_src_audio');
const { drawNetworkOverlay } = __ns('m_src_ui_overlay');
const { clearSave } = __ns('m_src_persistence_save');
const { BUILDINGS } = __ns('m_src_data_catalog');
const { makeGameState } = __ns('m_src_core_new-game');
const { DIFFICULTIES, DIFFICULTY_IDS, normalizeDifficulty } = __ns('m_src_core_difficulty');
const { SCENARIOS, startScenario, scenarioObjective } = __ns('m_src_scenarios');

function boot(canvas) {
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

__exports.boot = boot;
})(__reg['m_src_main']);

/* --- fin du graphe (entrée : src/main.mjs) --- */
})();