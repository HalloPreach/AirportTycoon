#!/usr/bin/env node
// T7 (t_0f131a58) — QA « zéro superposition / zéro bleed / cibles ≥44 px / zéro
// troncature » sur l'état DÉPLIÉ, deux viewport (1920×1080 desktop +
// 390×844 mobile), Edge headless + CDP, 0 dépendance (pattern T6 t6-mobile-cdp.mjs
// + T51 ui-no-overlap-cdp.mjs).
//
// Checks (état déplié — mobile : exclusivité PLANNING/CONSULTATION, une bande
// dépliée à la fois ; desktop : les deux bandes dépliées par défaut) :
//   M1. exclusive   : déplier PLANNING replie CONSULTATION et réciproque
//                     (jamais les deux bandes dépliées à la fois, ≤560px)
//   M2. mapHeight   : bande libre de carte (aucun élément interactif, pleine
//                     largeur) ≥ 45 % de la hauteur d'écran dans le pire cas
//   M3. touchTargets: cibles tactiles ≥ 44×44 px (toolbar, replis, boutons
//                     planning/consultation)
//   M4. wrap        : zéro troncature — les lignes longues (planning-row,
//                     pline, aline) n'ont aucune overflow horizontale (elles
//                     wrap dans les bandes scrollables)
//   M5. tbScroll    : la toolbar mobile défile horizontalement SANS scrollbar
//                     visible (rangée unique 48 px, pas de 2e rangée)
//   M6. noBleed     : ZÉRO BLEED — le canvas du jeu est peint BLANC (carte
//                     « bright ») et, sur la capture, les surfaces
//                     (planning/consultation/toasts/toolbar) montrent leur
//                     propre fond var(--at-surface) (α ≥ 0.97 mesuré, médiane
//                     RGB ≈ surface — plus aucun pixel du canvas ne transperce)
//   M7. noOverlap   : 0 chevauchement panneau-panneau (éléments interactifs
//                     visibles — convention T51 : .toasts exclue)
//   D1. autoHide    : la toolbar desktop s'estompe au repos (1600 ms d'inertie
//                     → opacity 0.12 + pointer-events:none) et re-apparaît au
//                     SURVOL de la zone basse (140 px) ou dès l'activation de
//                     l'outil (B/1-9/X → sync()) — « on ne perd jamais les
//                     outils en pleine pose » ; au repos la colonne centrale
//                     de la carte est dégagée (0 élément interactif)
//
// Preuves : screenshots evidence/t7-hud/*.png + rapport
// qa/t7-no-bleed-cdp-report.json. Sortie : 0 = tout vert, 1 = échec.
// Usage : node qa/t7-no-bleed-cdp.mjs
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const EV = join(ROOT, 'evidence', 't7-hud');

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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t7-no-bleed-'));
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOk = false;
try { serverOk = await httpProbe(`http://127.0.0.1:${port}/`); } finally { /* ci-dessous */ }
if (!serverOk) { console.error('ERREUR : serveur local non démarré'); server.kill(); process.exit(1); }

// --- CDP (pattern t6 / ui-no-overlap : WS natif Node) --------------------------
async function startBrowser() {
  const proc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
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
            else if (++n < 50) setTimeout(poll, 250); else resolve(null);
          } catch { if (++n < 50) setTimeout(poll, 250); else resolve(null); }
        });
      }).on('error', () => { if (++n < 50) setTimeout(poll, 250); else resolve(null); });
    })();
  });
  if (!target) { proc.kill(); return null; }
  return { proc, target };
}

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout CDP ${method}`)); } }, 15000);
  });
}
async function cdpOpen(targetUrl) {
  const { proc, target } = await startBrowser();
  const u = new URL(target.webSocketDebuggerUrl);
  ws = new WebSocket(u.href);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error('WS open error ' + (e.message || '?')));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    }
  };
  await send('Page.enable');
  const nav = send('Page.navigate', { url: targetUrl });
  await nav;
  return proc;
}
const evaluate = (expr) => send('Runtime.evaluate', { expression: `(() => ${expr})()`, awaitPromise: true, returnByValue: true })
  .then((r) => {
    if (r.exceptionDetails) throw new Error('JS [' + String(expr).slice(0, 90).replace(/\n/g, '⏎') + '…]: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  });
async function shot(path) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
}

// --- Mesures in-page ------------------------------------------------------------
// Boot de jeu déterministe (pattern t6) : skip intro + nouvelle partie.
const JS_BOOT = `{
  if (window.__game) {
    if (window.__game.state.intro && window.__game.state.intro.skipped !== true) {
      window.__game.state.intro.skipped = true; window.__game.state.intro.done = true;
      const el = document.querySelector('.intro'); if (el) el.remove();
    }
    if (window.__game.state.screen !== 'game') window.__game.startNewGame();
  }
  return { screen: (window.__game && window.__game.state && window.__game.state.screen) || 'unknown' };
}`;

// État des bandes + surfaces (rects CSS, α des fonds, fond de référence).
const JS_STATE = `{
  const q = (s) => document.querySelector(s);
  const pl = q('.planning'), pn = q('.panels'), tb = q('.toolbar'), st = q('.toasts');
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const alpha = (el) => {
    if (!el) return null;
    const m = getComputedStyle(el).backgroundColor.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    return p.length > 3 ? p[3] : 1;
  };
  const cs = tb ? getComputedStyle(tb) : null;
  // α des surfaces qui PORTENT réellement le fond : les boîtes internes
  // (.planning, .panel, .toast, .toolbar) — les wrappers .panels/.toasts
  // sont transparents (positionnement seulement).
  const panelIn = pn ? pn.querySelector('.panel') : null;
  const toastIn = st ? st.querySelector('.toast') : null;
  return {
    planning: { open: !!(pl && pl.classList.contains('open')), rect: rect(pl), alpha: alpha(pl) },
    panels: { open: !!(pn && pn.classList.contains('open')), rect: rect(pn), alpha: alpha(panelIn) },
    toolbar: {
      rect: rect(tb), alpha: alpha(tb), idle: !!(tb && tb.classList.contains('idle')),
      opacity: cs ? cs.opacity : null, pe: cs ? cs.pointerEvents : null,
      overflowX: cs ? cs.overflowX : null, scrollW: tb ? tb.scrollWidth : null,
      clientW: tb ? tb.clientWidth : null, h: tb ? tb.getBoundingClientRect().height : null,
    },
    toasts: { rect: rect(st), alpha: alpha(toastIn), n: st ? st.children.length : 0 },
    surface: getComputedStyle(document.documentElement).getPropertyValue('--at-surface').trim(),
    dpr: window.devicePixelRatio,
    innerW: window.innerWidth, innerH: window.innerHeight,
  };
}`;

// Exclusivité mobile (commande repli/dépli programmée, hooks onFoldChange).
const JS_EXCL = (cmd) => `(() => {
  const g = window.__game;
  ${cmd}
  const open = (s) => { const el = document.querySelector(s); return !!(el && el.classList.contains('open')); };
  return { planning: open('.planning'), panels: open('.panels') };
})()`;

// Bande libre de carte : plus grand gap vertical CONSECUTIF (pleine largeur)
// sans aucun élément interactif visible — les .toasts (pointer-events:none) ne
// bloquent pas la map : exclues (convention T51). Chaque élément est CLIPÉ
// à ses ancêtres défilants (un bouton sous le repli d'une bande scrolable
// compte dans sa bande, PAS dans la map).
const JS_MAPHEIGHT = `{
  const clipScroll = (el, r) => {
    r = { x: r.x, y: r.y, w: r.w !== undefined ? r.w : r.width, h: r.h !== undefined ? r.h : r.height };
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowY)) {
        const pr = p.getBoundingClientRect();
        const x = Math.max(r.x, pr.x), y = Math.max(r.y, pr.y);
        const w = Math.min(r.x + r.w, pr.x + pr.width) - x;
        const h = Math.min(r.y + r.h, pr.y + pr.height) - y;
        if (w <= 0 || h <= 0) return null;
        r = { x, y, w, h };
      }
    }
    return r;
  };
  const els = [...document.querySelectorAll('button, a, input, select, [role="button"], [tabindex]')]
    .filter((el) => {
      if (el.closest('.toasts')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      return el.getBoundingClientRect().width >= 2 && el.getBoundingClientRect().height >= 2;
    })
    .map((el) => {
      const r = clipScroll(el, {
        x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
        w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height,
      });
      return r ? [r.y, r.y + r.h] : null;
    })
    .filter((p) => p && p[1] > 0 && p[0] < innerHeight)
    .sort((a, b) => a[0] - b[0]);
  const H = innerHeight;
  let prev = 0, best = 0, bestTop = 0;
  for (const [t, b] of els) {
    if (t - prev > best) { best = t - prev; bestTop = prev; }
    prev = Math.max(prev, b);
  }
  if (H - prev > best) { best = H - prev; bestTop = prev; }
  return { H, freePx: Math.round(best), freePct: Math.round((1000 * best) / H) / 10, fromY: Math.round(bestTop) };
}`;

// Cibles tactiles (mobile) : boutons/filtres/replis — min 44×44.
const JS_TOUCH = `{
  const sels = ['.toolbar .tool', '.fold', '.planning button', '.planning-filter', '.planning-auto', '.panel button', '.panel select'];
  const out = [];
  let min = Infinity;
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const w = Math.round(r.width), h = Math.round(r.height);
      min = Math.min(min, w, h);
      out.push({ sel, w, h, ok: w >= 44 && h >= 44 });
    }
  }
  return { min: Number.isFinite(min) ? min : null, n: out.length, fails: out.filter((o) => !o.ok) };
}`;

// Zéro troncature : aucune ligne textuelle sans overflow horizontal (elles
// WRAPPENT — les bandes dépliées défilent verticalement).
const JS_WRAP = `{
  const out = [];
  for (const el of document.querySelectorAll('.planning-row span, .pline > span, .aline')) {
    const cs = getComputedStyle(el);
    out.push({
      sel: el.className || el.tagName,
      whiteSpace: cs.whiteSpace,
      ellipsis: cs.textOverflow === 'ellipsis',
      fits: el.scrollWidth <= el.clientWidth + 1,
      hasTitle: el.title !== '',
    });
  }
  return out;
}`;

// La toolbar mobile : rangée unique défilante, sans scrollbar visible.
const JS_TB = `{
  const tb = document.querySelector('.toolbar'); if (!tb) return null;
  const cs = getComputedStyle(tb);
  return {
    h: Math.round(tb.getBoundingClientRect().height),
    overflowX: cs.overflowX, overflowY: cs.overflowY,
    scrollW: tb.scrollWidth, clientW: tb.clientWidth,
  };
}`;

// GELER la boucle rAF : le spy remplace le rAF global — le tick PENDING
// (enregistré nativement avant le spy) fire UNE dernière fois, puis le
// tick suivant s'enregistre dans le spy et ne s'exécute plus. Après ~80 ms
// la boucle est figée : le canvas ne sera JAMAIS redessiné.
const JS_FREEZE = `{
  window.__t7Raf = window.requestAnimationFrame;
  window.__t7Tick = null;
  window.requestAnimationFrame = (cb) => { window.__t7Tick = cb; return 999; };
  return { spy: true };
}`;
// Peindre le canvas du jeu BLANC (carte « bright ») — APRES le gel : rien
// ne peut plus redessiner le canvas (la boucle est figée dans le spy).
const JS_PAINT = `{
  const cv = document.getElementById('game');
  if (!cv) return { painted: false, why: 'no canvas' };
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  return { painted: true, w: cv.width, h: cv.height };
}`;
// Reprendre la boucle : restaurer le rAF natif et RE-DEMARRER le tick capturé
// (le prochain tick du jeu s'est ré-enregistré dans le spy pendant le gel).
const JS_RESUME = `{
  if (window.__t7Raf) {
    const tick = window.__t7Tick;
    window.requestAnimationFrame = window.__t7Raf;
    delete window.__t7Raf; delete window.__t7Tick;
    if (tick) window.requestAnimationFrame(tick);
  }
  return true;
}`;

// Échantillonnage de la capture (médiane RGB d'une grille sur un rect CSS,
// en tenant compte du DPR : la capture fait w*dpr × h*dpr px). Async : CDP
// l'attend via awaitPromise.
const JS_SAMPLE = `(async (data, probes) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + data; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const med = (arr, i) => { const v = arr.map((o) => o[i]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const out = [];
  for (const p of probes) {
    const pts = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const x = Math.round((p.x + (p.w * (i + 0.5)) / 5) * p.dpr);
      const y = Math.round((p.y + (p.h * (j + 0.5)) / 4) * p.dpr);
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
      const d = cx.getImageData(x, y, 1, 1).data;
      pts.push([d[0], d[1], d[2]]);
    }
    out.push({ name: p.name, rgb: pts.length ? [med(pts, 0), med(pts, 1), med(pts, 2)] : null, n: pts.length });
  }
  return out;
})`;

// Interactifs visibles (convention t6 : clipping par les ancêtres défilants).
const INTERACTIVE_JS = `(() => {
  const clipScroll = (el, r) => {
    r = { x: r.x, y: r.y, w: r.w !== undefined ? r.w : r.width, h: r.h !== undefined ? r.h : r.height };
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowY)) {
        const pr = p.getBoundingClientRect();
        const x = Math.max(r.x, pr.x), y = Math.max(r.y, pr.y);
        const w = Math.min(r.x + r.w, pr.x + pr.width) - x;
        const h = Math.min(r.y + r.h, pr.y + pr.height) - y;
        if (w <= 0 || h <= 0) return null;
        r = { x, y, w, h };
      }
    }
    return r;
  };
  return [...document.querySelectorAll('button, a, input, select, [role="button"], [tabindex]')]
    .filter((el) => {
      if (el.id === 'game' || el.closest('.toasts')) return false; // convention T51
      if (el.disabled) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      const r = clipScroll(el, el.getBoundingClientRect());
      return r !== null && r.w >= 2 && r.h >= 2;
    })
    .map((el) => {
      const r = clipScroll(el, {
        x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
        w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height,
      });
      const sel = el.className ? '.' + String(el.className).split(' ').join('.') : el.tagName.toLowerCase();
      return { sel, x: r.x, y: r.y, w: r.w, h: r.h };
    });
})()`;
function overlapPx(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (w > 0 && h > 0) ? Math.round(w * h) : 0;
}

// Probes « intérieur de surface » (rect CSS inseté) pour l'échantillonnage
// no-bleed : l'intérieur de chaque surface ne doit montrer QUE son propre fond
// (var(--at-surface)) — jamais les pixels blancs du canvas peint derrière.
function bleedProbes(st, dpr) {
  const probes = [];
  const inner = (name, r, inset = 10, minH = 40) => {
    if (!r || r.w < 60 || r.h - 2 * inset < Math.min(minH, 24) || r.h - 2 * inset < 24) return;
    probes.push({ name, x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset, dpr });
  };
  if (st.planning.open) inner('planning', st.planning.rect);
  if (st.panels.open) inner('panels', st.panels.rect);
  if (st.toasts.rect && st.toasts.n > 0) inner('toasts', st.toasts.rect, 6, 24);
  inner('toolbar', st.toolbar.rect, 8, 24);
  // Témoin de la carte « bright » : CENTRE de l'écran (jamais couvert par
  // une bande, ni mobile ni desktop — bandes en haut/bas/bas-gauche).
  probes.push({ name: 'map-white', x: Math.round(st.innerW * 0.5 - 10), y: Math.round(st.innerH * 0.45 - 10), w: 20, h: 20, dpr });
  return probes;
}
function hexToRgb(hex) {
  const m = (hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [v >> 16 & 255, v >> 8 & 255, v & 255];
}
// Distance max par canal entre deux couleurs.
const rgbDist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

async function captureSampled(st) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const fz = await evaluate(JS_FREEZE);
    if (!fz || !fz.spy) return null;
    await sleep(80); // le tick pending fire, le suivant s'enregistre dans le spy → gelé
    const paint = await evaluate(JS_PAINT); // blanc — rien ne peut plus redessiner
    if (!paint || !paint.painted) { await evaluate(JS_RESUME); return null; }
    const shotRes = await send('Page.captureScreenshot', { format: 'png' });
    const b64 = shotRes.data;
    const probes = bleedProbes(st, st.dpr);
    const samples = await evaluate(`${JS_SAMPLE}('${b64}', ${JSON.stringify(probes)})`);
    await evaluate(JS_RESUME); // reprendre la boucle — jamais laisser la page gelée
    if (!samples) continue;
    const white = samples.find((s) => s.name === 'map-white');
    if (white && white.rgb && white.rgb.every((c) => c >= 235)) return { samples, b64 };
  }
  return null;
}

// --- Exécution par viewport ------------------------------------------------------
const VIEWPORTS = [
  { name: 'mobile', w: 390, h: 844, dpr: 2, mobile: true },
  { name: 'desktop', w: 1920, h: 1080, dpr: 1, mobile: false },
];
const report = {
  task: 't_0f131a58', test: 'qa/t7-no-bleed-cdp.mjs', ts: new Date().toISOString(),
  rule: 'état déplié, 2 viewport : 0 chevauchement panneau-panneau, 0 bleed (surfaces α≥0.97 sur canvas peint blanc), carte ≥ 45 % libre (mobile), cibles ≥ 44 px, 0 troncature, auto-hide toolbar desktop (survol + activation outil)',
  viewports: [], verdict: 'PASS',
};

function addCheck(v, name, pass, data, note) {
  v.checks.push({ name, pass: !!pass, ...(note ? { note } : {}), ...data });
}

async function runViewport(v) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.mobile,
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(2500);
  const boot = await evaluate(JS_BOOT);
  await sleep(800);
  const view = { name: v.name, size: `${v.w}×${v.h}`, checks: [], boot: boot.screen };

  if (v.mobile) {
    // M1 — exclusivité PLANNING/CONSULTATION (une bande dépliée à la fois).
    const s0 = await evaluate(JS_EXCL('void 0'));
    await evaluate(JS_EXCL('window.__game.planningPanel.setFold(true);'));
    const s1 = await evaluate(JS_EXCL('void 0'));
    await evaluate(JS_EXCL('window.__game.panels.setFold(true);'));
    const s2 = await evaluate(JS_EXCL('void 0'));
    addCheck(view, 'exclusive',
      s1.planning && !s1.panels && s2.panels && !s2.planning,
      { states: { s0, s1: { ...s1, via: 'planning.setFold(true)' }, s2: { ...s2, via: 'panels.setFold(true)' } } },
      'déplier l\'une replie l\'autre (hooks onFoldChange) — jamais les deux');
    await evaluate(JS_EXCL('window.__game.planningPanel.setFold(false); window.__game.panels.setFold(false);'));

    // M2 — bande libre de carte (pire cas = CONSULTATION dépliée 30vh + toolbar).
    await evaluate(JS_EXCL('window.__game.panels.setFold(true);'));
    const mh2 = await evaluate(JS_MAPHEIGHT);
    await evaluate(JS_EXCL('window.__game.planningPanel.setFold(true);'));
    const mh1 = await evaluate(JS_MAPHEIGHT);
    const mh = Math.min(mh1.freePct, mh2.freePct);
    addCheck(view, 'mapHeight', mh >= 45,
      { pctPlanning: mh1.freePct, pctConsultation: mh2.freePct, worst: mh, H: mh2.H },
      'pire cas ≥ 45 % de hauteur d\'écran');

    // M3/M4/M5/M7 — état déplié (consultation, le pire cas géométrique).
    await evaluate(JS_EXCL('window.__game.panels.setFold(true);'));
    await evaluate(`window.__game.toasts.toast('QA T7 — no bleed', 'info')`);
    await sleep(250);
    const touch = await evaluate(JS_TOUCH);
    addCheck(view, 'touchTargets', touch.min >= 44 && touch.fails.length === 0,
      { min: touch.min, n: touch.n, fails: touch.fails }, 'cibles tactiles ≥ 44×44 px');
    const wrap = await evaluate(JS_WRAP);
    const wrapBad = wrap.filter((w) => !w.fits);
    addCheck(view, 'wrap', wrapBad.length === 0,
      { n: wrap.length, bad: wrapBad }, 'zéro troncature : les lignes longues wrap (bandes scrollables)');
    const tb = await evaluate(JS_TB);
    const tbCss = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const noScrollbar = /scrollbar-width:\s*none/.test(tbCss) && /\.toolbar::-webkit-scrollbar\s*\{\s*display:\s*none/.test(tbCss);
    addCheck(view, 'tbScroll',
      tb && tb.h <= 50 && tb.overflowX === 'auto' && noScrollbar,
      { h: tb && tb.h, overflowX: tb && tb.overflowX, scrollW: tb && tb.scrollW, clientW: tb && tb.clientW, noScrollbar },
      'toolbar mobile : rangée unique 48 px, scroll horizontal SANS scrollbar');
    const st1 = await evaluate(JS_STATE);
    const sampled = await captureSampled(st1);
    const ref = hexToRgb(st1.surface);
    const surfaceSamples = sampled ? sampled.samples.filter((s) => s.name !== 'map-white' && s.rgb) : [];
    const bleedBad = !sampled || !ref ? [{ name: '?', rgb: null, n: 0 }]
      : surfaceSamples.filter((s) => rgbDist(s.rgb, ref) > 30);
    const alphas = [st1.planning.alpha, st1.panels.alpha, st1.toasts.alpha, st1.toolbar.alpha];
    addCheck(view, 'noBleed', sampled && ref && bleedBad.length === 0 && alphas.every((a) => a === null || a >= 0.97),
      { surface: st1.surface, ref, alphas, samples: surfaceSamples.map((s) => ({ name: s.name, rgb: s.rgb })), bad: bleedBad },
      'canvas peint BLANC : les surfaces montrent leur propre fond (α ≥ 0.97, médiane ≈ surface) — 0 pixel du canvas ne transperce');
    if (sampled) writeFileSync(join(EV, 't7-mobile-no-bleed.png'), Buffer.from(sampled.b64, 'base64'));
    const inter = await evaluate(INTERACTIVE_JS);
    const overlaps = [];
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
      const px = overlapPx(inter[i], inter[j]);
      if (px > 0) overlaps.push({ a: inter[i].sel, b: inter[j].sel, px });
    }
    addCheck(view, 'noOverlap', overlaps.length === 0, { n: inter.length, overlaps }, '0 chevauchement panneau-panneau');
    await evaluate(JS_EXCL('window.__game.planningPanel.setFold(false); window.__game.panels.setFold(false);'));
  } else {
    // D1 — desktop : les deux bandes dépliées par défaut.
    const st = await evaluate(JS_STATE);
    const inter = await evaluate(INTERACTIVE_JS);
    const overlaps = [];
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
      const px = overlapPx(inter[i], inter[j]);
      if (px > 0) overlaps.push({ a: inter[i].sel, b: inter[j].sel, px });
    }
    // Desktop : les bandes sont TOUJOURS visibles (pas de fold CSS desktop) —
    // le critère est donc uniquement le 0 chevauchement des interactifs.
    addCheck(view, 'noOverlap', overlaps.length === 0,
      { planningOpen: st.planning.open, panelsOpen: st.panels.open, n: inter.length, overlaps },
      'état déplié desktop : 0 chevauchement');
    // Zéro troncature desktop : les lignes troncées (ellipsis) exposent le
    // texte complet en tooltip ; les autres WRAPPENT.
    await evaluate(`window.__game.toasts.toast('QA T7 — desktop', 'info')`);
    await sleep(200);
    const wrap = await evaluate(JS_WRAP);
    const truncNoTip = wrap.filter((w) => !w.fits && w.ellipsis && !w.hasTitle);
    const wrapBad = wrap.filter((w) => !w.fits && !w.ellipsis);
    addCheck(view, 'noTruncation', truncNoTip.length === 0 && wrapBad.length === 0,
      { n: wrap.length, truncNoTip, wrapBad }, 'zéro troncature : wrap, ou ellipsis + tooltip (texte complet au survol)');
    // noBleed desktop : la toolbar DOIT être visible (non-idle) → poke avant.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(v.w / 2), y: v.h - 30 });
    await sleep(120);
    const st2 = await evaluate(JS_STATE);
    const sampled = await captureSampled(st2);
    const ref = hexToRgb(st2.surface);
    const surfaceSamples = sampled ? sampled.samples.filter((s) => s.name !== 'map-white' && s.rgb) : [];
    const bleedBad = !sampled || !ref ? [{ name: '?', rgb: null, n: 0 }]
      : surfaceSamples.filter((s) => rgbDist(s.rgb, ref) > 30);
    const alphas = [st2.planning.alpha, st2.panels.alpha, st2.toasts.alpha, st2.toolbar.alpha];
    addCheck(view, 'noBleed', sampled && ref && bleedBad.length === 0 && alphas.every((a) => a === null || a >= 0.97),
      { surface: st2.surface, ref, alphas, samples: surfaceSamples.map((s) => ({ name: s.name, rgb: s.rgb })), bad: bleedBad, toolbarIdle: st2.toolbar.idle },
      'canvas peint BLANC : surfaces opaques (α ≥ 0.97) — 0 bleed');
    if (sampled) writeFileSync(join(EV, 't7-desktop-no-bleed.png'), Buffer.from(sampled.b64, 'base64'));
    // D2 — AUTO-HIDE de la toolbar (desktop) : repos → estompage, survol bas →
    // retour, outil actif → toujours visible, retour au repos → estompage.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(v.w / 2), y: 300 });
    await sleep(2400); // > 1600 ms d'inertie (sans mouvement de souris)
    const r0 = await evaluate(`(() => { const t = document.querySelector('.toolbar'); const c = getComputedStyle(t); return { idle: t.classList.contains('idle'), opacity: c.opacity, pe: c.pointerEvents }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(v.w / 2), y: v.h - 30 }); // zone basse 140 px
    await sleep(150);
    const r1 = await evaluate(`(() => { const t = document.querySelector('.toolbar'); const c = getComputedStyle(t); return { idle: t.classList.contains('idle'), opacity: c.opacity }; })()`);
    await evaluate(`{ window.__game.buildTool.setKind('taxiway'); window.__game.buildTool.toggleBuild(); }`);
    await sleep(2000); // PAS de mouvement de souris : l'outil actif doit suffire
    const r2 = await evaluate(`(() => { const t = document.querySelector('.toolbar'); const c = getComputedStyle(t); return { idle: t.classList.contains('idle'), opacity: c.opacity, active: window.__game.buildTool.isActive() }; })()`);
    await evaluate(`{ window.__game.buildTool.cancel(); }`);
    await sleep(2000);
    const r3 = await evaluate(`(() => { const t = document.querySelector('.toolbar'); return { idle: t.classList.contains('idle') }; })()`);
    addCheck(view, 'autoHide', r0.idle && !r1.idle && !r2.idle && r2.active && r3.idle,
      { r0, r1, r2, r3 },
      'repos 1600 ms → estompage (opacity 0.12, pointer-events:none) ; survol zone basse OU outil actif → retour immédiat ; zone centrale de la carte dégagée au repos');
    // D3 — colonne centrale dégagée au repos (toolbar estompée + pointer-events:none).
    const center = await evaluate(`(() => {
      const x0 = innerWidth * 0.4, x1 = innerWidth * 0.6;
      return [...document.querySelectorAll('button, a, input, select, [role="button"], [tabindex]')]
        .filter((el) => {
          if (el.id === 'game' || el.closest('.toasts')) return false;
          const cs = getComputedStyle(el);
          // au repos, la toolbar est pointer-events:none (estompée) : pas
          // un élément interactif — c'est précisément le point de la règle.
          if (cs.pointerEvents === 'none') return false;
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 2 && r.height >= 2 && r.right > x0 && r.left < x1;
        }).map((el) => el.className || el.tagName);
    })()`);
    addCheck(view, 'mapCenterFree', center.length === 0, { blockers: center },
      'repos (toolbar estompée) : colonne centrale 40-60 % de la carte sans aucun élément interactif');
  }

  await shot(join(EV, `t7-${v.name}-expanded.png`));
  view.ok = view.checks.every((c) => c.pass);
  report.viewports.push(view);
}

// --- Main -----------------------------------------------------------------------
mkdirSync(EV, { recursive: true });
try {
  await cdpOpen('about:blank');
  for (const v of VIEWPORTS) await runViewport(v);
} catch (e) {
  report.verdict = 'FAIL';
  report.failure = String(e && e.message || e);
  console.error('ERREUR T7 no-bleed :', report.failure);
} finally {
  try { ws && ws.close(); } catch { /* déjà fermé */ }
  server.kill();
}
const bad = report.viewports.reduce((n, v) => n + v.checks.filter((c) => !c.pass).length, 0);
if (bad > 0) report.verdict = 'FAIL';
report.summary = { viewports: report.viewports.length, checks: report.viewports.reduce((n, v) => n + v.checks.length, 0), failed: bad };
writeFileSync(join(ROOT, 'qa/t7-no-bleed-cdp-report.json'), JSON.stringify(report, null, 2));
for (const v of report.viewports) {
  console.log(`\n== ${v.name} ${v.size} (boot=${v.boot}) ==`);
  for (const c of v.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}` + (c.note ? ` — ${c.note}` : ''));
}
console.log(`\nVERDICT : ${report.verdict}${report.failure ? ` — ${report.failure}` : ''} (checks en échec : ${bad})`);
console.log('RAPPORT : qa/t7-no-bleed-cdp-report.json');
process.exit(report.verdict === 'PASS' ? 0 : 1);
