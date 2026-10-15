#!/usr/bin/env node
// T7b (t_d1005365) — BATTERIE CDP « MENUS PAR ONGLETS, ZÉRO SCROLL » (Edge
// headless + CDP, 0 dépendance, comme qa/t7-no-bleed-cdp.mjs) :
// - 1920×1080 (desktop) : la barre d'onglets est PRÉSENTE (10 boutons ≥44×44),
//   EXACTEMENT 1 PANNEAU VISIBLE À LA FOIS (10/10 onglets parcourus via
//   window.__game.panels.setTab), la colonne .panels N'EST PLUS SCROLLABLE
//   (scrollHeight ≤ clientHeight + 1), 0 chevauchement, 0 bleed.
// - 390×844 (mobile) : la bande CONSULTATION porte la barre (9 boutons —
//   « Vols » masqué, sa bande est celle du haut), cibles ≥44 px, EXACTEMENT
//   1 PANNEAU VISIBLE (9/9 onglets + la bande PLANNING), l'exclusivité T7
//   est conservée (jamais les 2 bandes dépliées), bande non scrollable à
//   l'état par défaut (le débordement d'un panneau défile DANS la zone),
//   0 chevauchement, 0 bleed.
// PNG dans evidence/t7-hud-tabs/ ; rapport qa/t7-tabs-cdp-report.json.
// Usage : node qa/t7-tabs-cdp.mjs  → exit 0 si tout passe, 1 sinon.
'use strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8791;
const URL = `http://127.0.0.1:${PORT}/index.html`;

// --- CDP minimaliste (WebSocket client, sans bibliothèque) ------------------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const cdp = new Cdp(ws);
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && cdp.pending.has(m.id)) { const f = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? f.reject(new Error(m.error.message)) : f.resolve(m.result); }
        else if (m.method && cdp.handlers.has(m.method)) cdp.handlers.get(m.method)(m.params);
      };
      ws.onopen = () => resolve(cdp);
      ws.onerror = (e) => reject(new Error('WS open error ' + (e.message || '?')));
    });
  }
  send(method, params = {}) {
    this.id += 1; const id = this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) { this.handlers.set(method, fn); }
}

async function httpJson(url) { const r = await fetch(url); return r.json(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- JS exécutées dans la page (sans C$ pour rester lues dans l'outil) -----
// Barre d'onglets : boutons présents + cibles ≥44×44 + bouton actif (1 seul).
const JS_TABS = () => {
  const tabs = [...document.querySelectorAll('.tabs .tab')];
  const vis = tabs.filter((b) => b.offsetWidth > 0);
  return {
    total: tabs.length,
    visible: vis.map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.getAttribute('data-tab'), w: Math.round(r.width), h: Math.round(r.height),
        ok: r.width >= 44 && r.height >= 44,
        pressed: b.getAttribute('aria-pressed') === 'true' };
    }),
  };
};
// État d'onglet : EXACTEMENT 1 panneau visible dans la zone + le bon.
const JS_TAB_STATE = () => {
  const g = window.__game; if (!g || !g.panels) return null;
  const zone = g.panels.zone;
  const vis = [...zone.children].filter((el) => !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none');
  const sections = [...zone.querySelectorAll('.panel')];
  return {
    activeTab: g.panels.activeTab(),
    visibleCount: vis.length,
    visibleIsPlanning: vis.length === 1 && vis[0].classList.contains('planning'),
    visibleSectionIdx: vis.length === 1 ? sections.indexOf(vis[0]) : -1,
    planningInZone: !!zone.querySelector('.planning'),
  };
};
// Colonne non scrollable (invariant T7b) : scrollHeight ≤ clientHeight + 1.
const JS_COL_SCROLL = () => {
  const c = document.querySelector('.panels');
  return { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight,
    fits: c.scrollHeight <= c.clientHeight + 1,
    zoneScrolls: c.querySelector('.panelzone').scrollHeight > c.querySelector('.panelzone').clientHeight + 1 };
};
// Bandes mobiles : états déplié/replié + exclusivité T7 + bande non scrollable.
const JS_BANDS = () => {
  const c = document.querySelector('.panels');
  const p = document.querySelector('.planning');
  return {
    consultOpen: c.classList.contains('open'),
    planningOpen: p.classList.contains('open'),
    consultFits: c.scrollHeight <= c.clientHeight + 1,
    consultHeight: c.getBoundingClientRect().height,
    planningHeight: p.getBoundingClientRect().height,
  };
};
// 0 chevauchement (même règle que t7 : éléments interactifs cliquables,
// clips aux ascendants scrollables, .toasts exclues — pointer-events:none).
const INTERACTIVE_JS = `(() => {
  const sel = {
    toolbar: '.toolbar .tool',
    planning: '.planning button:not(.fold)',
    panels: '.panel button, .panel select',
    tabs: '.tabs .tab',
    fold: '.fold',
    intro: '.intro .btn',
  };
  function clip(el, r) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      const ov = cs.overflowY + cs.overflowX;
      if (ov.includes('hidden') || ov.includes('clip')) { const pr = p.getBoundingClientRect(); r.left = Math.max(r.left, pr.left); r.right = Math.min(r.right, pr.right); r.top = Math.max(r.top, pr.top); r.bottom = Math.min(r.bottom, pr.bottom); }
      p = p.parentElement;
    }
    return r;
  }
  const rects = [];
  for (const [name, s] of Object.entries(sel)) {
    for (const el of [...document.querySelectorAll(s)]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('.toasts')) continue; // convention T51 : non interactifs
      if (cs.pointerEvents === 'none' && name !== 'toasts') { if (cs.opacity < 0.2) continue; }
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      r = clip(el, { left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      if (r.right <= r.left || r.bottom <= r.top) continue;
      rects.push({ name, x1: Math.round(r.left), y1: Math.round(r.top), x2: Math.round(r.right), y2: Math.round(r.bottom),
        txt: (el.textContent || '').trim().slice(0, 14) });
    }
  }
  let overlaps = 0; const pairs = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
    const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (ox > 0 && oy > 0) { overlaps++; if (pairs.length < 8) pairs.push(a.name + '«' + a.txt + '» × ' + b.name + '«' + b.txt + '» (' + ox + '×' + oy + ')'); }
  }
  return { count: rects.length, overlaps, pairs };
})()`;
// 0 bleed : le canvas est peint BLANC ; les surfaces HUD doivent rester OPAQUES
// (le blanc ne transperce PAS) ; le canvas (carte) est blanc par construction.
const JS_FREEZE = () => { window.__rafOrig = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; };
const JS_PAINT = () => { const c = document.querySelector('#game'); const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); };
const JS_RESUME = () => { if (window.__rafOrig) { window.requestAnimationFrame = window.__rafOrig; delete window.__rafOrig; } };
const JS_SAMPLE = (points) => {
  const c = document.querySelector('#game');
  const g = c.getContext('2d');
  const out = [];
  for (const p of points) {
    const d = g.getImageData(p.x, p.y, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    out.push({ ...p, color: hex, alpha: d[3] / 255,
      opaque: d[3] >= 245.95,
      isWhite: hex === '#FFFFFF' });
  }
  return out;
};

// --- Orchestration -----------------------------------------------------------
function startServer() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p.replace(/^\/+/, ''));
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(f);
      const type = ext === '.html' ? 'text/html' : ext === '.js' || ext === '.mjs' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => { srv.listen(PORT, '127.0.0.1', () => resolve(srv)); });
}

async function launch(width, height, cdpPort) {
  const bin = fs.mkdtempSync(path.join(tmpdir(), 'at-t7-tabs-')); // profil éphémère (pattern t6)
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
    `--window-size=${width},${height}`, `--user-data-dir=${bin}`,
    `--remote-debugging-port=${cdpPort}`,
    'about:blank',
  ], { stdio: 'ignore' });
  let list = [];
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { list = await httpJson(`http://127.0.0.1:${cdpPort}/json/list`); } catch { continue; }
    if (list.some((t) => t.type === 'page')) break;
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('aucun onglet CDP — Edge headless non démarré'); }
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(3500); // boot : canvas + panneaux + boucle
  // Boot du JEU (état DEPLOYÉ, pas le menu) : pattern t7-no-bleed (le
  // « intro » vit sur state.intro — g.intro.skip() n'existe PAS sur __game).
  await cdp.send('Runtime.evaluate', { expression: `(() => {
    if (window.__game) {
      if (window.__game.state.intro && window.__game.state.intro.skipped !== true) {
        window.__game.state.intro.skipped = true; window.__game.state.intro.done = true;
        const el = document.querySelector('.intro'); if (el) el.remove();
      }
      if (window.__game.state.screen !== 'game') window.__game.startNewGame();
    }
    return { screen: (window.__game && window.__game.state && window.__game.state.screen) || 'unknown' };
  })()`, awaitPromise: true });
  await sleep(2000); // stabilisation (signature de panneaux, rAF)
  return { cdp, proc };
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const dir = path.join(ROOT, 'evidence', 't7-hud-tabs');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  return f;
}

async function runViewport(vp) {
  const { cdp, proc } = await launch(vp.width, vp.height, vp.cdpPort);
  const out = { viewport: vp, checks: [], fail: [] };
  const ok = (id, okMsg, data) => { out.checks.push({ id, ok: true, msg: okMsg, ...(data || {}) }); };
  const bad = (id, msg, data) => { out.checks.push({ id, ok: false, msg, ...(data || {}) }); out.fail.push(id); };
  const ev = (expr) => cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);

  const g = await ev('window.__game ? { hasPanels: !!window.__game.panels } : null');
  if (!g || !g.hasPanels) { bad('T3', 'window.__game.panels absent'); return { out, proc, cdp }; }

  if (vp.mobile) {
    // Mobile : la bande CONSULTATION est repliée PAR DÉFAUT (T6) — la lire
    // dépliée pour que T1/T2 voient la barre d'onglets (T3 et T5 replient
    // l'état par défaut à leur tour, T6 mesure donc toujours l'état par défaut).
    await ev('window.__game.panels.setFold(true)');
    const justAfter = await ev(`(() => { const c = document.querySelector('.panels'); return { colClass: c ? c.className : null, tabOw: document.querySelector('.tabs .tab[data-tab="inspect"]') ? document.querySelector('.tabs .tab[data-tab="inspect"]').offsetWidth : null }; })()`);
    await sleep(400);
    global.__diagJustAfter = justAfter;
  }

  // --- T1 : boutons d'onglets présents + ≥44×44 ----------------------------
  const tabs = await ev(`(${JS_TABS.toString()})()`);
  if (vp.desktop) {
    if (tabs.total === 10 && tabs.visible.length === 10 && tabs.visible.every((b) => b.ok))
      ok('T1-tab-buttons', `10 onglets desktop visibles, tous ≥44×44 (min ${Math.min(...tabs.visible.map((b) => Math.min(b.w, b.h)))} px)`);
    else bad('T1-tab-buttons', `desktop : ${tabs.visible.length}/10 onglets visibles ou cibles <44 px`, tabs);
  } else {
    // 9 onglets visibles (Vols masqué — bande du haut) + 1 total=10.
    const vis9 = tabs.visible.length === 9 && tabs.visible.every((b) => b.ok);
    const volsHidden = tabs.total === 10 && !tabs.visible.some((b) => b.id === 'vols');
    if (vis9 && volsHidden) ok('T1-tab-buttons', `9 onglets mobiles visibles (Vols masqué), tous ≥44×44 (min ${Math.min(...tabs.visible.map((b) => Math.min(b.w, b.h)))} px)`);
    else {
      // Diagnostic (état au moment de la mesure) : classe de bande + offsets.
      const diag = await ev(`(() => { const col = document.querySelector('.panels'); const tb = document.querySelector('.tabs'); return { colClass: col ? col.className : null, colRect: col ? JSON.stringify(col.getBoundingClientRect()) : null, tabsW: tb ? tb.offsetWidth : null, perTab: [...document.querySelectorAll('.tabs .tab')].map((b) => b.getAttribute('data-tab') + ':' + b.offsetWidth + ':' + getComputedStyle(b).display) }; })()`);
      bad('T1-tab-buttons', `mobile : onglets visibles=${tabs.visible.length}/9, vols masqué=${volsHidden}`, { ...tabs, diag, justAfterFold: global.__diagJustAfter });
    }
  }
  // Un seul bouton actif (aria-pressed) sur l'onglet par défaut.
  const pressed = tabs.visible.filter((b) => b.pressed).length;
  if (pressed === 1) ok('T2-single-active', 'exactement 1 bouton d\'onglet actif (aria-pressed)');
  else bad('T2-single-active', `boutons actifs = ${pressed} (attendu : 1)`, tabs.visible);

  // --- T3 : EXACTEMENT 1 panneau visible à la fois (tous les onglets) ------
  const tabIds = vp.desktop
    ? ['vols', 'inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts', 'alerts', 'net']
    : ['inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts', 'alerts', 'net'];

  let worst = null;
  for (const id of tabIds) {
    await ev(`window.__game.panels.setTab('${id}')`);
    await sleep(250);
    const st = await ev(`(${JS_TAB_STATE.toString()})()`);
    let expectedPlanning = id === 'vols';
    let expectedIdx = -1;
    if (!expectedPlanning) {
      const all = ['vols', 'inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts', 'alerts', 'net'];
      expectedIdx = all.indexOf(id) - 1; // index dans les 9 sections (vols = le 10e)
    }
    const good = st.visibleCount === 1 &&
      (expectedPlanning ? st.visibleIsPlanning : (st.visibleSectionIdx === expectedIdx && !st.visibleIsPlanning)) &&
      st.activeTab === id;
    if (!good) bad(`T3-one-panel[${id}]`, `onglet ${id} : visible=${st.visibleCount}, isPlanning=${st.visibleIsPlanning}, idx=${st.visibleSectionIdx}, actif=${st.activeTab}`, st);
    if (vp.desktop) {
      const sc = await ev(`(${JS_COL_SCROLL.toString()})()`);
      if (!sc.fits) bad(`T3-col-scroll[${id}]`, `colonne scrollable sur l'onglet ${id} (scroll ${sc.scrollHeight} > client ${sc.clientHeight})`, sc);
      worst = worst ? Math.max(worst, sc.scrollHeight - sc.clientHeight) : sc.scrollHeight - sc.clientHeight;
    }
  }
  const failT3 = out.fail.filter((f) => f.startsWith('T3-'));
  if (!failT3.length) ok('T3-one-panel', `${tabIds.length}/${tabIds.length} onglets : exactement 1 panneau visible à la fois${vp.desktop ? ` + colonne non scrollable (max Δ scroll/client = ${worst}px)` : ' + bande consultation non scrollable (le débordement défile dans la zone)'}`);
  if (vp.mobile) {
    const b = await ev(`(${JS_BANDS.toString()})()`);
    if (b.consultFits) ok('T4-band-fit', `bande consultation non scrollable (scroll ≤ client, h=${Math.round(b.consultHeight)}px)`);
    else bad('T4-band-fit', `bande consultation scrollable (h=${Math.round(b.consultHeight)}px)`, b);
    // EXCLUSIVITÉ T7 : ouvrir la bande PLANNING replie CONSULTATION (1 bande).
    await ev('window.__game.planningPanel.setFold(true)');
    await sleep(400);
    const ex = await ev(`(${JS_BANDS.toString()})()`);
    if (ex.planningOpen && !ex.consultOpen) ok('T5-exclusive', 'exclusivité conservée : bande planning dépliée ⟹ bande consultation repliée (1 bande à la fois)');
    else bad('T5-exclusive', `états bandes : planning=${ex.planningOpen}, consultation=${ex.consultOpen}`, ex);
    // La bande planning = le panneau Vols (1 seul panneau affiché).
    await ev('window.__game.planningPanel.setFold(false); window.__game.panels.setFold(false)');
    await sleep(300);
  }

  // --- T6 : 0 chevauchement (état par défaut) --------------------------------
  const ov = await ev(INTERACTIVE_JS);
  if (ov.overlaps === 0) ok('T6-no-overlap', `0 chevauchement (${ov.count} éléments interactifs cliquables)`);
  else bad('T6-no-overlap', `${ov.overlaps} chevauchements`, ov.pairs);

  // --- T7 : 0 bleed (canvas peint blanc, surfaces opaques α≥0.97) -----------
  // Ordre PROUvé (pattern t7-no-bleed) : geler rAF → attendre que le tick
  // PENDING (programmé nativement avant le gel) se fire DERNIÈRE fois →
  // PEINDRE APRÈS : rien ne peut plus redessiner le canvas.
  await ev(`(${JS_FREEZE.toString()})()`);
  await sleep(80);
  await ev(`(${JS_PAINT.toString()})()`);
  await sleep(50);
  let points;
  if (vp.desktop) {
    const tb = await ev(`(() => { const r = document.querySelector('.toolbar').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const col = await ev(`(() => { const r = document.querySelector('.panels').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    points = [
      { id: 'colonne', x: col.x, y: col.y, expect: 'surface' },
      { id: 'toolbar', x: tb.x, y: tb.y, expect: 'surface' },
      { id: 'carte-libre', x: 760, y: 540, expect: 'white' },
    ];
  } else {
    const tb = await ev(`(() => { const r = document.querySelector('.toolbar').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    points = [
      { id: 'bande-planning', x: 30, y: 30, expect: 'surface' },
      { id: 'bande-consultation', x: 30, y: 746, expect: 'surface' },
      { id: 'toolbar', x: tb.x, y: tb.y, expect: 'surface' },
      { id: 'carte-libre', x: 195, y: 422, expect: 'white' },
    ];
  }
  const samp = await ev(`(${JS_SAMPLE.toString()})(${JSON.stringify(points)})`);
  await ev(`(${JS_RESUME.toString()})()`);
  let bleed = 0;
  for (const s of samp) {
    if (s.expect === 'white' && !s.isWhite) { bleed++; bad('T7-no-bleed', `sonde ${s.id} : la carte n'est pas blanche (bleed)`, s); }
    if (s.expect === 'surface' && !s.opaque) { bleed++; bad('T7-no-bleed', `sonde ${s.id} : surface transperce (α=${s.alpha.toFixed(2)} < 0.97)`, s); }
  }
  if (!bleed) ok('T7-no-bleed', `0 bleed (${samp.length} sondes : surfaces opaques α=${Math.min(...samp.filter((s) => s.expect === 'surface').map((s) => s.alpha)).toFixed(2)}, carte blanche exacte)`);

  // --- Preuves PNG ------------------------------------------------------------
  const shots = [];
  if (vp.desktop) {
    await ev('window.__game.panels.setTab("vols")'); await sleep(300);
    shots.push(await shot(cdp, 'desktop-vols.png'));
    await ev('window.__game.panels.setTab("fin")'); await sleep(300);
    shots.push(await shot(cdp, 'desktop-fin.png'));
  } else {
    await ev('window.__game.panels.setFold(false); window.__game.planningPanel.setFold(false)'); await sleep(300);
    await ev('window.__game.panels.setFold(true)'); await sleep(300);
    shots.push(await shot(cdp, 'mobile-consultation.png'));
    await ev('window.__game.panels.setFold(false); window.__game.planningPanel.setFold(true)'); await sleep(300);
    shots.push(await shot(cdp, 'mobile-planning.png'));
  }
  out.evidence = shots;
  return { out, proc, cdp };
}

(async () => {
  const srv = await startServer();
  const results = [];
  let code = 0;
  for (const vp of [
    { name: 'desktop 1920×1080', width: 1920, height: 1080, desktop: true, cdpPort: 9222 },
    { name: 'mobile 390×844', width: 390, height: 844, mobile: true, cdpPort: 9223 },
  ]) {
    console.log(`\n=== T7b (onglets, zéro scroll) — ${vp.name} ===`);
    const { out, proc, cdp } = await runViewport(vp);
    for (const c of out.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.id} : ${c.msg}`);
    results.push(out);
    cdp.ws.close();
    try { proc.kill(); } catch { }
    await sleep(1200);
    if (out.fail.length) code = 1;
  }
  const report = { task: 't_d3df6f0d', battery: 't7-tabs-cdp', ts: new Date().toISOString(), results };
  fs.writeFileSync(path.join(ROOT, 'qa', 't7-tabs-cdp-report.json'), JSON.stringify(report, null, 2));
  srv.close();
  const nFail = results.reduce((n, r) => n + r.fail.length, 0);
  console.log(`\nT7b : ${nFail === 0 ? 'PASS' : 'FAIL'} — ${results.map((r) => `${r.viewport.name} : ${r.fail.length ? r.fail.join(', ') : 'tout OK'}`).join(' | ')}`);
  process.exit(code);
})().catch((e) => { console.error('ERREUR batterie :', e); process.exit(1); });
