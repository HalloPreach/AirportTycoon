#!/usr/bin/env node
// T6 (t_87168414) — QA « mobile jouable » sur viewport 390×844 (classe iPhone,
// Edge headless + CDP, 0 dépendance, pattern T51 ui-no-overlap-cdp.mjs).
// Le module tactile (src/ui/touch.mjs) est piloté par Input.dispatchTouchEvent
// (événements touch réels du CDP — pas de synthèse DOM) :
//   1. PAN 1 doigt    → la caméra panne (delta attendu = geste / zoom)
//   2. PINCH 2 doigts → le zoom change (facteur ≈ rapport des distances)
//   3. TAP            → construction d'un bâtiment (MÊME chemin que le click
//      desktop : buildTool.clickAt) + sélection d'inspection (panels.clickAt)
//   4. toasts         → jamais au-dessus d'un élément interactif (surface
//      d'intersection mesurée, pas supposée) — état repli ET déplié
//   5. layout         → bande « map libre » ≥ 60 % de la hauteur + cibles
//      tactiles ≥ 44 px (toolbar, replis accordion)
// Preuves : screenshots evidence/t6-mobile/*.png + rapport
// qa/t6-mobile-cdp-report.json. Sortie : 0 = tout vert, 1 = échec.
// Usage : node qa/t6-mobile-cdp.mjs
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BROWSER_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = BROWSER_CANDIDATES.find((p) => existsSync(p));
if (!edge) { console.error('Edge introuvable — définissez QA_EDGE / QA_BROWSER'); process.exit(1); }
const M_W = 390, M_H = 844;
const EV = join(ROOT, 'evidence', 't6-mobile');

function freePort() { return 8900 + Math.floor(Math.random() * 400); }
function httpProbe(url, tries = 40) {
  return new Promise((resolve) => {
    let n = 0;
    (function attempt() {
      httpGet(url, (res) => { resolve(res.statusCode === 200); res.resume(); })
        .on('error', () => { if (++n < tries) setTimeout(attempt, 100); else resolve(false); });
    })();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t6-mobile-'));
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function startBrowser() {
  const proc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=390,844',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const target = await new Promise((resolve) => {
    let n = 0;
    (function poll() {
      httpGet(`http://127.0.0.1:${cdpPort}/json/list`, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find((t) => t.type === 'page');
            if (page) resolve(page);
            else if (++n < 50) setTimeout(poll, 250);
            else resolve(null);
          } catch { if (++n < 50) setTimeout(poll, 250); else resolve(null); }
        });
      }).on('error', () => { if (++n < 50) setTimeout(poll, 250); else resolve(null); });
    })();
  });
  if (!target) { proc.kill(); return null; }
  return { proc, target };
}

// --- Mesures DOM ---------------------------------------------------------------
// Les éléments interactifs VISIBLES (boutons/links/champs) — mêmes critères
// que la règle « toasts hors des éléments interactifs » du brief T6.
// « Visible » = portion réellement visible à l'écran : le rect de chaque
// élément est clipé par la fenêtre de chaque ancêtre défilant (overflow-y
// auto/scroll/hidden) — un champ défilé hors de sa bande 22vh ne compte
// PAS comme visible (le rect brut de layout dépasserait la bande).
const INTERACTIVE_JS = `(() => {
  const clipScroll = (el, r) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowY)) {
        const pr = p.getBoundingClientRect();
        const x = Math.max(r.x, pr.x), y = Math.max(r.y, pr.y);
        const w = Math.min(r.x + r.w, pr.x + pr.width) - x;
        const h = Math.min(r.y + r.h, pr.y + pr.height) - y;
        if (w <= 0 || h <= 0) return null; // totalement défilé hors de la fenêtre
        r = { x, y, w, h };
      }
    }
    return r;
  };
  return [...document.querySelectorAll('button, a, input, select, [role="button"], [tabindex]')]
    .filter((el) => {
      if (el.disabled) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      const r = clipScroll(el, el.getBoundingClientRect());
      return r !== null && r.w >= 2 && r.h >= 2;
    })
    .map((el) => {
      const r = clipScroll(el, el.getBoundingClientRect());
      return { sel: el.className ? '.' + String(el.className).split(' ').join('.') : el.tagName.toLowerCase(), x: r.x, y: r.y, w: r.w, h: r.h };
    });
})()`;
// Surface d'intersection d'un rect « toast » avec chaque élément interactif.
const overlapPx = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

// Touch CDP : x/y en px CSS du viewport (= px canvas : le jeu fait bitmap =
// window.innerWidth, sans scale DPR). id = doigt.
const point = ([x, y, id]) => ({ x, y, id, radiusX: 2, radiusY: 2 });
const tpts = (...pts) => pts.map(point);
async function gesture(send, start, moves, end) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tpts(...start) });
  for (const m of moves) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(m)] });
    await sleep(30);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: tpts(...end) });
}

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  if (!up) { console.error('serveur down'); server.kill(); process.exit(1); }
  const b = await startBrowser();
  if (!b) { console.error('Edge down'); server.kill(); process.exit(1); }
  const ws = new WebSocket(b.target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

  // Enveloppe CDP minimale (pattern T51) : un id par requête.
  const cdp = { seq: 0, pending: new Map() };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && cdp.pending.has(m.id)) { cdp.pending.get(m.id).resolve(m); cdp.pending.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const id = ++cdp.seq;
    const p = new Promise((resolve) => cdp.pending.set(id, { resolve }));
    ws.send(JSON.stringify({ id, method, params }));
    return p;
  };
  const evaluate = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    // Réponse CDP : res.result = { result: RemoteObject, exceptionDetails? }
    const rem = res && res.result ? res.result.result : null;
    if (rem && rem.type === 'undefined') return undefined;
    return rem ? rem.value : undefined;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  // Viewport mobile 390×844 (classe iPhone, DPR 2).
  await send('Emulation.setDeviceMetricsOverride', { width: M_W, height: M_H, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(3500); // boot

  mkdirSync(EV, { recursive: true });
  const report = {
    task: 't_87168414', test: 'qa/t6-mobile-cdp.mjs', ts: new Date().toISOString(),
    viewport: { w: M_W, h: M_H, dpr: 2 }, checks: {},
  };
  const shot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const p = join(EV, name);
    writeFileSync(p, Buffer.from(res.result.data, 'base64'));
    console.log(`    [shot] ${p}`);
  };

  // Prérequis : jeu démarré (boot auto en mode libre) + intro désactivée (R20)
  // — mesurés, non supposés.
  const hasGame = await evaluate('window.__game ? true : false');
  if (!hasGame) {
    report.fatal = 'window.__game absent (crash au boot)';
    console.error('    FATAL :', report.fatal);
    ws.close(); b.proc.kill(); server.kill();
    writeFileSync(join(ROOT, 'qa/t6-mobile-cdp-report.json'), JSON.stringify(report, null, 2));
    process.exit(1);
  }
  await evaluate('window.__game.state.intro = window.__game.state.intro || { step: 0, done: false, skipped: false }; window.__game.state.intro.skipped = true; window.__game.state.intro.done = true; "ok"');
  await sleep(400);
  report.innerWidth = await evaluate('window.innerWidth');
  report.screen = await evaluate('window.__game.state.screen');

  // ================================================================ 1. PAN
  // La caméra est state.camera = { x, y, zoom } (le Camera l'applique).
  const cam0 = await evaluate('({ x: __game.state.camera.x, y: __game.state.camera.y, z: __game.state.camera.zoom })');
  // Geste (150,500) → (250,540) : (+100, +40) écran → monde (−100/z, −40/z).
  await gesture(send, [[150, 500, 1]], [[200, 520, 1], [250, 540, 1]], [[250, 540, 1]]);
  await sleep(150);
  const cam1 = await evaluate('({ x: __game.state.camera.x, y: __game.state.camera.y, z: __game.state.camera.zoom })');
  const r10 = (n) => Math.round(n * 10) / 10;
  report.checks.pan = {
    pass: Math.abs((cam1.x - cam0.x) - (-100 / cam0.z)) < 5 && Math.abs((cam1.y - cam0.y) - (-40 / cam0.z)) < 5,
    before: cam0, after: cam1,
    delta: { x: r10(cam1.x - cam0.x), y: r10(cam1.y - cam0.y) },
    expected: { x: r10(-100 / cam0.z), y: r10(-40 / cam0.z) },
    note: 'pan 1 doigt : delta écran / zoom (camera.pan)',
  };

  // =============================================================== 2. PINCH
  const z0 = await evaluate('__game.state.camera.zoom');
  // Doigts (140,420)-(250,420) d=110 → (85,420)-(305,420) d=220 (facteur ≈ 2).
  await gesture(send, [[140, 420, 1], [250, 420, 2]], [[85, 420, 1], [305, 420, 2]], [[85, 420, 1], [305, 420, 2]]);
  await sleep(150);
  const z1 = await evaluate('__game.state.camera.zoom');
  report.checks.pinch = {
    pass: z1 > z0 * 1.2,
    before: z0, after: Math.round(z1 * 1000) / 1000,
    note: 'pinch 2 doigts : zoom × (d2/d1) centré au point milieu (camera.zoomAt)',
  };
  // Caméra remise au point de départ (tests suivants en conditions stables).
  await evaluate(`__game.state.camera.x = ${cam0.x}; __game.state.camera.y = ${cam0.y}; __game.state.camera.zoom = ${cam0.z}; "ok"`);
  await sleep(150);

  // ================================================================ 3. TAP
  // 3a. Construction : mode construction ON, tap → EXACTEMENT UN bâtiment de
  // plus (le tap passe par buildTool.clickAt — le MÊME chemin que le click
  // desktop). À ce stade le jeu est au MENU (boot libre, state.sim =
  // undefined) : on démarre EXPLICITEMENT une partie — sinon le premier tap
  // atterrirait sur le bouton « Nouvelle partie » du menu et le compteur
  // passerait -1 → 6 (aéroport initial) sans qu'aucun tap n'ait posé de
  // bâtiment (faux vert).
  // Pose DÉTERMINISTE : on centre la caméra sur la zone libre à GAUCHE
  // (x≈100, y≈500, zoom 1 — l'aéroport initial est à x≥550 : piste x750-850,
  // terminal x550-750/y900-1050, taxiway y1050-1090) et on choisit un
  // bâtiment PETIT (taxiway 200×40, socle toujours débloqué, 400 $). Le
  // fantôme centré sur le tap tombe en x[0,200]/y[480,520] = libre + dans le
  // terrain → la pose est garantie (vérifié par sonde : 3 → 4). Un tap
  // « Piste » (100×1000) serait centré hors terrain / sur l'existant → refus
  // → faux rouge.
  await evaluate('__game.startNewGame(); "ok"');
  for (let i = 0; i < 20 && !(await evaluate('__game.state.sim ? true : false')); i++) await sleep(200);
  // L'intro (R20) ré-apparaît après startNewGame (makeGameState reset
  // state.intro) et sa carte occupe le CENTRE de l'écran en mobile
  // (y≈391-507) — le lieu naturel d'un tap. Un joueur réel la passe (« Passer
  // l'intro ») : même action ici (état + DOM), sinon le tap center-screen
  // atterrit sur la carte et non sur le canvas.
  await evaluate('__game.state.intro.skipped = true; __game.state.intro.done = true; const el = document.querySelector(".intro"); if (el) el.style.display = "none"; "ok"');
  await sleep(250); // laisser la frame suivante traiter iOpen=false (pas de ré-affichage)
  await evaluate('__game.state.camera.x = 100; __game.state.camera.y = 500; __game.state.camera.zoom = 1; "ok"');
  await evaluate('__game.buildTool.cancel(); __game.buildTool.setKind("taxiway"); __game.buildTool.toggleBuild(); "on"');
  const countBuildings = () => evaluate('__game.state.sim ? (__game.state.sim.infra.runways.length + __game.state.sim.infra.services.length + __game.state.sim.infra.terminals.length + __game.state.sim.infra.taxiways.length) : -1');
  const c0 = await countBuildings();
  const tX = Math.round(M_W / 2), tY = Math.round(M_H / 2); // centre écran = monde (100,500)
  await gesture(send, [[tX, tY, 1]], [], [[tX, tY, 1]]);
  await sleep(400); // clickAt est async (import différé de la règle sim)
  const c1 = await countBuildings();
  report.checks.tapBuild = {
    pass: c1 === c0 + 1,
    tapAt: [tX, tY], before: c0, after: c1,
    note: 'tap en mode construction (taxiway, caméra sur zone libre) = pose d\'EXACTEMENT 1 bâtiment (buildTool.clickAt, même chemin que le click desktop)',
  };
  await evaluate('__game.buildTool.cancel(); "off"');

  // 3b. Sélection : tap sur un bâtiment EXISTANT → panels.selectionOf() (R39).
  // Le bâtiment est recentré (caméra) : il tombe au centre de l'écran. Si le
  // pick retombe sur un autre objet (avion au-dessus), on tente le suivant.
  const pickSel = await evaluate(`(() => {
    const inf = __game.state.sim.infra;
    const cands = [...(inf.runways || []), ...(inf.terminals || []), ...(inf.services || []), ...(inf.taxiways || [])].slice(0, 4);
    if (!cands.length) return null;
    const c = __game.state.camera, w = window.innerWidth, h = window.innerHeight;
    const out = cands.map((b) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      return { id: b.id, cx, cy };
    });
    return out;
  })()`);
  let sel = null, sSel = null;
  if (pickSel) {
    for (const cand of pickSel) {
      await evaluate(`__game.state.camera.x = ${cand.cx}; __game.state.camera.y = ${cand.cy}; "ok"`);
      await sleep(120); // laisser la frame suivante redessiner au centre
      sel = { sx: Math.round(M_W / 2), sy: Math.round(M_H / 2), id: cand.id };
      await gesture(send, [[sel.sx, sel.sy, 1]], [], [[sel.sx, sel.sy, 1]]);
      await sleep(250);
      sSel = await evaluate('__game.panels.selectionOf()');
      if (sSel && String(sSel.id) === String(sel.id)) break;
      await evaluate('typeof __game.panels.clearSelection === "function" ? __game.panels.clearSelection() : "noop"');
    }
  }
  report.checks.tapSelect = {
    pass: !!sSel && !!sel && String(sSel.id) === String(sel.id),
    tapped: sel, selection: sSel,
    note: 'tap sur un bâtiment = sélection d\'inspection (panels.clickAt, R39)',
  };
  if (!pickSel) report.checks.tapSelect.note = 'aucun bâtiment existant trouvé (runway/terminal)';

  // ============================================================ 4. TOASTS
  const toastOverlap = async (label) => {
    await evaluate(`__game.toasts.toast(${JSON.stringify(label)}, "info"); "ok"`);
    await sleep(300);
    const zone = await evaluate(`(() => {
      const t = document.querySelector('.toasts');
      const r = t ? t.getBoundingClientRect() : null;
      return { toast: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null, elements: ${INTERACTIVE_JS} };
    })()`);
    const overlaps = zone && zone.toast
      ? (zone.elements || []).filter((el) => overlapPx(zone.toast, el) > 0).map((el) => ({ sel: el.sel, px: Math.round(overlapPx(zone.toast, el)) }))
      : null;
    return { toastsRect: zone ? zone.toast : null, interactiveCount: zone ? (zone.elements || []).length : 0, overlaps };
  };
  const z1r = await toastOverlap('QA T6 — zone libre des toasts');
  report.checks.toasts = {
    pass: z1r.overlaps !== null && z1r.overlaps.length === 0,
    ...z1r,
    note: 'état replié : le toast affiché 300 ms, surface d\'intersection avec chaque élément interactif visible',
  };

  // =========================================================== 5. LAYOUT
  // 5a. Bande « map libre » (état replié par défaut) + cibles ≥ 44 px.
  const layout = await evaluate(`(() => {
    const els = ${INTERACTIVE_JS};
    const H = window.innerHeight;
    const freeAt = (y) => !els.some((e) => y > e.y && y < e.y + e.h);
    let best = 0, run = 0;
    for (let y = 0; y <= H; y += 2) { run = freeAt(y) ? run + 2 : 0; best = Math.max(best, run); }
    const size = (s) => [...document.querySelectorAll(s)]
      .filter((b) => { const cs = getComputedStyle(b); return cs.display !== 'none' && b.offsetParent !== null; })
      .map((b) => { const r = b.getBoundingClientRect(); return { s, w: Math.round(r.width), h: Math.round(r.height) }; });
    return {
      innerHeight: H, freeBandPx: best, freePct: Math.round(best / H * 1000) / 10,
      toolbar: size('.toolbar .tool'), folds: size('.fold'), intro: size('.intro .tool'),
      interactive: els.length,
    };
  })()`);
  const minT = (arr) => (arr && arr.length ? Math.min(...arr.map((t) => Math.min(t.w, t.h))) : null);
  const tbar = minT(layout && layout.toolbar), tf = minT(layout && layout.folds);
  const collapsed = await evaluate('[...document.querySelectorAll(".planning, .panels")].some((c) => !c.classList.contains("open"))');
  report.checks.layout = {
    pass: !!layout && layout.freePct >= 60 && tbar !== null && tbar >= 44 && tf !== null && tf >= 44,
    collapsedByDefault: collapsed,
    freeBandPx: layout ? layout.freeBandPx : null, freePct: layout ? layout.freePct : null,
    toolbarMinTarget: tbar, foldMinTarget: tf,
    note: 'état replié par défaut : bande map libre ≥ 60 % + cibles tactiles ≥ 44 px',
  };
  await shot('t6-collapsed.png');

  // 5b. État déplié (bouton .fold cliqué — cible 44 px, non supposé) :
  await evaluate('[...document.querySelectorAll(".planning .fold, .panels .fold")].forEach((b) => b.click()); "open"');
  await sleep(350);
  await shot('t6-expanded.png');
  const z2r = await toastOverlap('QA T6 — bande dépliée');
  const planOpen = await evaluate('document.body.classList.contains("plan-open")');
  report.checks.toastsExpanded = {
    pass: z2r.overlaps !== null && z2r.overlaps.length === 0,
    planOpen, ...z2r,
    note: 'bandes dépliées : le toast reste dans la zone libre (top: calc(22vh + 16px))',
  };

  const all = report.checks;
  const failed = Object.entries(all).filter(([, c]) => !c.pass).map(([k]) => k);
  report.summary = failed.length === 0
    ? `${Object.keys(all).length}/${Object.keys(all).length} checks OK`
    : `FAIL : ${failed.join(', ')}`;
  console.log(`    ${report.summary}`);
  for (const [k, c] of Object.entries(all)) console.log(`    ${c.pass ? 'OK  ' : 'FAIL'} ${k} — ${c.note}`);
  ws.close(); b.proc.kill(); server.kill();
  writeFileSync(join(ROOT, 'qa/t6-mobile-cdp-report.json'), JSON.stringify(report, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('QA T6 mobile :', e);
  server.kill();
  process.exit(1);
});
