// Rendu canvas 2D : LIT l'état, ne calcule rien de jeu (règle UI fine).
// Sprites vectoriels simples — ponytail : à remplacer par de vrais assets une fois la boucle jouable.
import { queueTotals } from '../sim/passengers.mjs'; // R30 : files par terminal → somme (HUD)
export function makeRenderer(canvas, { overlays = [], onMenuCommands = null } = {}) {
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
  function drawTerrain(state, cam) {
    const { w, h } = state.terrain;
    const [x0, y0] = screenToCanvas(0, 0, cam);
    const [x1, y1] = screenToCanvas(w, h, cam);
    ctx.fillStyle = '#3d5a3a'; // herbe
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
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
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // Bâtiments posés (lecture seule de state.sim.infra). Couleurs par type.
  const BLD_COLOR = {
    runway: '#455a64', taxiway: '#78909c', terminal: '#1e88e5',
    fuel: '#fdd835', hangar: '#ef6c00', catering: '#9c27b0',
    cleaning: '#26c6da', baggage: '#7cb342',
  };
  function drawInfra(state, cam) {
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
      ctx.fillStyle = BLD_COLOR[kind] || '#90a4ae';
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
    }
    // Portes (gates) : petits carrés sur le bord des terminaux, colorés par taille,
    // rouge quand un avion est à quai (lecture seule de sim.infra.gates).
    if (sim.infra.gates && sim.infra.gates.length) {
      const GATE_COLOR = { S: '#4caf50', M: '#ff9800', L: '#2196f3' };
      for (const g of sim.infra.gates) {
        if (g.x === undefined) continue;
        const [x, y] = screenToCanvas(g.x, g.y, cam);
        ctx.fillStyle = g.acId ? '#e53935' : (GATE_COLOR[g.size] || '#9e9e9e');
        ctx.fillRect(x, y, g.w * cam.zoom, g.h * cam.zoom);
      }
    }
  }

  // Avions visibles et en mouvement (lecture seule de state.sim.aircraft).
  // La sim stocke l'orientation comme une chaîne ('gate'/'runway') et pas des
  // radians → on ne pivote qu'avec une vraie orientation numérique.
  function drawAircraft(state, cam) {
    const sim = state.sim;
    if (!sim || !sim.aircraft) return;
    for (const a of sim.aircraft) {
      if (a.x === undefined || a.y === undefined) continue; // pas encore positionné
      const [x, y] = screenToCanvas(a.x, a.y, cam);
      ctx.save();
      ctx.translate(x, y);
      if (typeof a.heading === 'number') ctx.rotate(a.heading);
      ctx.fillStyle = a.color || '#eceff1';
      // Silhouette simple : fuselage + ailes (échelle monde, 20 px de long).
      ctx.fillRect(-10 * cam.zoom, -2 * cam.zoom, 20 * cam.zoom, 4 * cam.zoom);
      ctx.fillRect(-2 * cam.zoom, -8 * cam.zoom, 4 * cam.zoom, 16 * cam.zoom);
      ctx.restore();
    }
  }

  // Écran de jeu : terrain + infra + avions sous la caméra.
  function drawGame(state, cam) {
    ctx.fillStyle = '#263238';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTerrain(state, cam);
    drawInfra(state, cam);
    drawAircraft(state, cam);
  }

  // Menu de départ : le jeu n'est pas encore commencé.
  // R20 : les commandes du menu sont DES BOUTONS (souris) — les touches N/R
  // restent en raccourci (le texte l'indique). Le bouton « Reprendre »
  // n'existe QUE s'il y a une sauvegarde (savePanel.canResume).
  // Le bloc DOM est créé UNE FOIS (render est appelé à chaque frame) et
  // seulement mis à jour de façon idempotente.
  let menuBox = null;
  let resumeBtn = null;
  function drawMenu() {
    ctx.fillStyle = '#1a237e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '48px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Airport Tycoon', canvas.width / 2, canvas.height / 2 - 40);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Nouvelle partie (N) — un aéroport fourni : piste + terminal 2 portes', canvas.width / 2, canvas.height / 2 + 20);
    ctx.fillText('Reprendre (R) — recharger la dernière sauvegarde · sauvegarde aussi automatique', canvas.width / 2, canvas.height / 2 + 44);
    // R38 : les TROIS scénarios rejouables (mêmes règles, config explicite +
    // objectif R22 annoncé) — des BOUTONS (souris) comme les commandes du menu
    // (R20). « Nouvelle partie » reste le MODE LIBRE (pas de champ scenario,
    // pas d'objectif annoncé).
    const scenarioBtnDefs = (onMenuCommands && onMenuCommands.scenarioModes)
      ? onMenuCommands.scenarioModes()
      : [];
    if (!menuBox) {
      menuBox = document.createElement('div');
      menuBox.className = 'menu-btns';
      menuBox.setAttribute('role', 'toolbar');
      menuBox.setAttribute('aria-label', 'Commandes du menu (nouvelle partie, reprise de la sauvegarde, scénarios)');
      const btnNew = document.createElement('button');
      btnNew.className = 'tool';
      btnNew.textContent = 'Nouvelle partie (N)';
      btnNew.addEventListener('click', () => onMenuCommands.newGame());
      resumeBtn = document.createElement('button');
      resumeBtn.className = 'tool';
      resumeBtn.textContent = 'Reprendre la sauvegarde (R)';
      resumeBtn.addEventListener('click', () => onMenuCommands.resume());
      menuBox.append(btnNew, resumeBtn);
      for (const s of scenarioBtnDefs) {
        const b = document.createElement('button');
        b.className = 'tool';
        b.textContent = s.label; // le nom du scénario (R38 : config explicite + objectif annoncé)
        b.addEventListener('click', () => onMenuCommands.scenario(s.id));
        menuBox.appendChild(b);
      }
      document.body.appendChild(menuBox);
    }
    resumeBtn.style.display = onMenuCommands.canResume() ? '' : 'none';
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
    if (state.paused) lines.push('PAUSE (P pour reprendre)');
    const w = 240;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(12, 12, w, 24 * lines.length + 16);
    ctx.fillStyle = '#fff';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((t, i) => ctx.fillText(t, 24, 24 + i * 24 + 12));
  }

  function render(state) {
    const cam = state.camera;
    if (state.screen === 'menu') {
      drawMenu();
    } else {
      if (menuBox) menuBox.style.display = 'none'; // R20 : les boutons du menu ne se superposent pas au jeu
      drawGame(state, cam);
      // Superpositions (fantôme de construction…) — la logique de pose reste dans la sim/UI.
      for (const overlay of overlays) overlay(ctx, cam, viewSize());
      drawHud(state);
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
