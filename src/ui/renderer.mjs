// Rendu canvas 2D : LIT l'état, ne calcule rien de jeu (règle UI fine).
// Sprites vectoriels simples — ponytail : à remplacer par de vrais assets une fois la boucle jouable.
import { queueTotals } from '../sim/passengers.mjs'; // R30 : files par terminal → somme (HUD)
import { getPalette } from './palette.mjs'; // R43 : palette standard / daltonienne
import { THEME } from './theme.mjs'; // T4 (t_eb78478e) : design tokens (écran-titre + HUD)
import { drawIcon, iconCanvas } from './icons.mjs'; // T4 : glyphes vectoriels (écran-titre : avion, boutons ; menu animé)
import { weatherView } from '../sim/weather.mjs'; // T3 (t_9b665a8b) : la MÉTÉO (lecture pure — le renderer reste en lecture seule, pas d'ensure)
import { clockView, phaseTint } from '../sim/clock.mjs'; // T3 (t_76744b22) : l'HORLOGE jour/nuit (la phase pilote la teinte du monde)
import { seasonTint, seasonView } from '../core/seasons.mjs'; // T3 (t_76744b22) : l'habillage de saison (teinte + affichage)
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
export function makeRenderer(canvas, { overlays = [], onMenuCommands = null, selectionOf = null, paletteOf = null, juice = null } = {}) {
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
