// Rendu canvas 2D : LIT l'état, ne calcule rien de jeu (règle UI fine).
// Sprites vectoriels simples — ponytail : à remplacer par de vrais assets une fois la boucle jouable.
import { queueTotals } from '../sim/passengers.mjs'; // R30 : files par terminal → somme (HUD)
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
export function makeRenderer(canvas, { overlays = [], onMenuCommands = null, selectionOf = null } = {}) {
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
      // R39 : les BLOCAGES sont lisibles autrement que par la couleur —
      // symbole + texte (X sur piste fermée, « PANNE » sur station HS), la
      // règle reste dans la sim (runwayClosed / svc.fuelOut, lecture seule).
      if (kind === 'runway' && runwayClosedRO(sim, b.id)) {
        ctx.strokeStyle = '#e53935';
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
      const GATE_COLOR = { S: '#4caf50', M: '#ff9800', L: '#2196f3' };
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
          ctx.fillStyle = occ ? '#e53935' : (GATE_COLOR[g.size] || '#9e9e9e');
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
