// Outil de construction UI : barre d'outils (B, touches 1-8), fantôme au survol
// (vert = posable, rouge = refus), clic = placer, X = démolir (clic sur un bâtiment).
// La décision de pose/vraie démolition est la sim (infra.mjs) : l'UI ne fait que
// le DOM, la souris et un aperçu « est-ce que ça tient ? » (grille + fonds).
// Le fantôme est dessiné par le renderer via drawGhost(ctx, cam, view).
import { BUILDINGS, UNLOCKS } from '../data/catalog.mjs';

const KINDS = ['runway', 'taxiway', 'terminal', 'fuel', 'hangar', 'catering', 'cleaning', 'baggage'];

export function makeBuildTool({ canvas, state, camera, viewSize, toast, onPlaced, controls = [] }) {
  const tool = { mode: false, kind: 'runway', demolishMode: false, ghost: null };

  // Barre d'outils (DOM, en bas à gauche) — accessible : boutons <button> réels.
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Outils de construction (B activer, 1-8 choisir, X démolir)');
  const buttons = {};
  for (let n = 0; n < KINDS.length; n++) {
    const k = KINDS[n];
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.textContent = `${n + 1} · ${BUILDINGS[k].name} (${BUILDINGS[k].cost} $)`;
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
  hint.textContent = 'B : construire · 1-8 : bâtiment · X : démolir · A : auto-accept vols · Échap : annuler';
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
  tool.setKind = (k) => { tool.kind = k; };
  tool.isActive = () => !!(tool.mode || tool.demolishMode);

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
    // Service pas encore débloqué (seuil de passagers) : le fantôme l'indique.
    const gate = UNLOCKS.find((u) => u.service === kind);
    if (gate && sim.passengers.totalCarried < gate.at) {
      return { ok: false, why: `Se débloque à ${gate.at} pax transportés` };
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
