// Outil de construction UI : barre d'outils (B, touches 1-9), fantôme au survol
// (vert = posable, rouge = refus), clic = placer, X = démolir (clic sur un bâtiment).
// La décision de pose/vraie démolition est la sim (infra.mjs) : l'UI ne fait que
// le DOM, la souris et un aperçu « est-ce que ça tient ? » (grille + fonds).
// Le fantôme est dessiné par le renderer via drawGhost(ctx, cam, view).
import { BUILDINGS } from '../data/catalog.mjs';
import { unlockState } from '../infra/unlocks.mjs';
import { iconCanvas } from './icons.mjs'; // T4 (t_eb78478e) : icônes vectorielles des 11 types
import { THEME } from './theme.mjs'; // T4 : design tokens (couleurs des icônes)

// T33 (t_88aee6d5) : dérivé du CATALOGUE (BUILDINGS) — la liste grandit avec
// les bâtiments. Les 8 d'origine gardent leurs touches 1-8 ; les nouveaux
// prennent 9+ (9 = dernière touche simple ; 10/11 se choisissent à la
// barre d'outils, la liste clavier est bornée aux touches simples).
const KINDS = Object.keys(BUILDINGS);

export function makeBuildTool({ canvas, state, camera, viewSize, toast, onPlaced, onDemolished, controls = [] }) {
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
    t7Poke(); // T7 (t_0f131a58) : tout changement d'état de l'outil (B / 1-9 / X)
    // ramène la toolbar à l'affichage si elle était estompée.
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

  // T7 (t_0f131a58) — DESKTOP : AUTO-HIDE de la toolbar (« vrai jeu ») — la
  // bande du BAS GAUCHE est la seule zone UI massives au bas de la map (jusqu'à
  // 104 px) : au repos (outil construction INACTIF + souris hors de la bande
  // du bas depuis 1600 ms) elle s'estompe (opacity 0.12, pointer-events:none)
  // → la zone centrale ET le bas de la carte restent dégagés ; dès le
  // prochain survol de la bande du bas (140 px, la souris « traverse » la
  // toolbar estompée — pointer-events:none) ou l'activation de l'outil
  // (B / 1-9 / X, via sync()), elle re-apparaît IMMÉDIATEMENT : on ne perd
  // jamais les outils en pleine pose. Choix : estompage (et non décalage de la
  // map) — un origin décalé casserait les conventions caméra/HUD/T51 ; l'UI
  // reste au même endroit, juste « fantôme » au repos. MOBILE : inactif —
  // la toolbar y est la rangée d'outils permanente (cibles ≥44 px, pas de
  // notion de souris-idle). NODE : pas de window → bloc inactif (tests verts).
  const mqDeskT7 = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia('(min-width: 561px)') : null;
  let t7IdleTimer = 0;
  function t7IdleOn() {
    if (!mqDeskT7 || !mqDeskT7.matches || tool.isActive()) return;
    bar.classList.add('idle');
  }
  function t7Poke() {
    bar.classList.remove('idle');
    clearTimeout(t7IdleTimer);
    t7IdleTimer = 0;
    if (!mqDeskT7 || !mqDeskT7.matches || tool.isActive()) return;
    t7IdleTimer = setTimeout(t7IdleOn, 1600); // 1600 ms de grâce, puis estompage
  }
  if (mqDeskT7) {
    // La souris dans les 140 px du bas de l'écran (la bande toolbar + marge)
    // ramène la toolbar immédiatement — l'événement arrive sur la fenêtre
    // même quand la toolbar est .idle (pointer-events:none) → ça marche dans
    // les deux sens.
    window.addEventListener('mousemove', (e) => {
      if (typeof e.clientY === 'number' && e.clientY > window.innerHeight - 140) t7Poke();
    });
    mqDeskT7.addEventListener('change', (ev) => {
      if (ev.matches) t7Poke(); // desktop : estompage (re)possible
      else bar.classList.remove('idle'); // mobile : jamais estompée
    });
    if (mqDeskT7.matches) t7Poke(); // boot desktop : carte dégagée au démarrage
  }

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

  // T6 (t_87168414) : clickAt(sx, sy) — la logique de pose/démolition avec
  // des coordonnées EXPLICITES. Le click desktop délègue (e.offsetX/offsetY),
  // le tap tactil (touch.mjs) appelle le MÊME chemin : une seule logique,
  // zéro duplication. L'async vient du chargement différé de la règle (sim).
  tool.clickAt = async (sx, sy) => {
    if (!state.sim) { toast('Simulation non prête', 'err'); return; }
    if (tool.demolishMode) {
      // Bâtiment sous le point → démolir (verdict de la sim, lisible en toast).
      const wx = camera.screenToWorldX(sx, viewSize().width);
      const wy = camera.screenToWorldY(sy, viewSize().height);
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
    computeGhost(sx, sy);
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
  };
  canvas.addEventListener('click', (e) => tool.clickAt(e.offsetX, e.offsetY));

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
    // T5c (t_bd4726e7) : couleurs v2 Radar Rétro — phosphore si posable
    // (= THEME.ok, alpha 0,45), rouge CRT sinon (= THEME.err).
    ctx.fillStyle = g.ok ? 'rgba(61,255,165,0.45)' : 'rgba(255,90,78,0.45)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = g.ok ? THEME.ok : THEME.err;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, w, h);
    if (!g.ok && g.why) {
      ctx.fillStyle = THEME.text;
      ctx.font = `12px ${THEME.fontUi}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(g.why, x0, y0 - 4);
    }
  };

  return tool;
}
