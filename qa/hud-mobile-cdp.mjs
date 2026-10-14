// T5a (t_e4c3ffff) — HUD : ARCHITECTURE + LISIBILITÉ (Edge headless + CDP,
// 0 dépendance, Node >= 22). Vérifie par VUEPORT (1366×768 desktop de
// référence + 390×844 mobile portrait = le bug connu : le bandeau planning
// pleine largeur COUVRANT le HUD canvas) et en PARTIE NEUVE :
//   1. ZÉRO CHEVAUCHEMENT de la ZONE du HUD canvas (__game.hudRect() — le
//      HUD est peint SUR #game, invisible aux mesures DOM) avec chaque
//      panneau interactif visible (.planning / .panels / .toolbar / .intro)
//      + zéro chevauchement entre ces panneaux eux-mêmes (régression T51).
//      Le fix : en ≤560px le HUD est peint SOUS la stripe planning
//      (y = 8 + .planning.offsetHeight + 8 — src/ui/renderer.mjs drawHud).
//   2. POLICE DU HUD (hudRect().fontPx) ≥ 11 px (13 px souhaités) —
//      16 px en desktop, 14 px en mobile.
//   3. POLICES DOM des éléments interactifs visibles (boutons planning,
//      filtres, toolbar, consultation, toasts, intro) ≥ 11 px
//      (getComputedStyle — les hausses T5a : 10→12 px filtres, 11→12/13 px…).
//   4. TEXTE DU HUD non débordant : hudRect().maxLinePx + 24 ≤ w
//      (la largeur suit la plus longue ligne mesurée — pas le fixe 240 px
//      qui faisait DÉBORDER « Files : … » hors du panneau).
//   5. CONTRASTE WCAG (calcul Node sur les couleurs réelles du CSS) : texte
//      principal/secondaire vs les fonds de panneaux (α lu dans index.html,
//      pire cas = le monde le plus clair connu, terrainBorder de
//      src/ui/palette.mjs) ≥ 4.5:1 (AA) ; texte du HUD #e8eef7 vs sa surface.
// Sorties : rapport qa/hud-mobile-cdp-report.json + captures
// evidence/t5a-hud-<viewport>.png. Code de sortie : 0 = PASS, 1 = FAIL.
// Usage : node qa/hud-mobile-cdp.mjs
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPalette } from '../src/ui/palette.mjs'; // R43 : le monde le plus clair connu (terrainBorder)

const ROOT = join(import.meta.dirname, '..');
const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) { console.error('Edge introuvable'); process.exit(1); }

function freePort() { return 8700 + Math.floor(Math.random() * 500); }
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

// --- Math WCAG (contraste) — calcul hors navigateur (couleurs lues du CSS) ---
const srgb2lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (r, g, b) => 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b);
const contrast = (l1, l2) => { const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
const blendOver = (bg, fg, a) => bg.map((c, i) => Math.round(c * (1 - a) + fg[i] * a));
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// L'alpha d'un fond `background: rgba(r,g,b,A)` de la règle d'un sélecteur.
function cssRgbaAlpha(css, rule, prop = 'background') {
  const m = css.match(new RegExp(rule.replace('.', '\\.') + '\\s*\\{[^}]*' + prop + ':\\s*rgba\\(\\d+,\\s*\\d+,\\s*\\d+,\\s*([\\d.]+)\\)'));
  return m ? Number(m[1]) : null;
}

const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t5a-hud-'));
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function startBrowser() {
  const edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1920,1080',
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
  if (!target) { edgeProc.kill(); return null; }
  return { proc: edgeProc, target };
}

// --- Mesure (mêmes sélecteurs que la reproduction T51) + zone HUD canvas ---
const PANEL_SELS = ['.planning', '.panels', '.toolbar', '.intro', '.toasts', '.menu-btns'];
const MEASURE = `(() => {
  const out = { layers: [], hud: null };
  for (const sel of ${JSON.stringify(PANEL_SELS)}) {
    const el = document.querySelector(sel);
    if (!el) { out.layers.push({ sel, present: false }); continue; }
    const st = getComputedStyle(el);
    if (el.style.display === 'none' || st.display === 'none') { out.layers.push({ sel, present: true, hidden: true }); continue; }
    const r = el.getBoundingClientRect();
    out.layers.push({
      sel, present: true, hidden: false, pe: st.pointerEvents,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  out.hud = (window.__game && typeof window.__game.hudRect === 'function') ? window.__game.hudRect() : 'ABSENT';
  out.screen = (window.__game && window.__game.state && window.__game.state.screen) || 'unknown';
  // Polices des éléments interactifs VISIBLES (contrôle lisibilité DOM).
  out.fonts = [...document.querySelectorAll(
    '.planning-row button, .planning-filter, .planning h4, .planning-sec, .toolbar .tool, .panel h4, .pline, .aline, .toast, .intro h4, .intro p, .intro-actions button'
  )].filter((el) => el.offsetParent !== null).map((el) => {
    const fs = parseFloat(getComputedStyle(el).fontSize); // "13px" → 13 (Number("13px") = NaN → null en JSON)
    return { sel: el.className && el.className.baseVal !== undefined ? el.tagName : (el.className || el.tagName), px: fs };
  });
  return out;
})()`;

function overlapPx(a, b) {
  if (!a || !b || a.hidden || b.hidden || a.w <= 0 || b.w <= 0) return 0;
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 <= x0 || y1 <= y0 ? 0 : (x1 - x0) * (y1 - y0);
}

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  if (!up) { console.error('serveur down'); server.kill(); process.exit(1); }
  const b = await startBrowser();
  if (!b) { console.error('Edge down'); server.kill(); process.exit(1); }
  const ws = new WebSocket(b.target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

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
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res && res.result && res.result.result ? res.result.result.value : undefined;
  };
  const screenshot = async (path) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(res.result.data, 'base64'));
  };
  const setViewport = async ({ w, h, mobile }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  };
  const navigate = (url) => send('Page.navigate', { url });

  const evidenceDir = join(ROOT, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const report = {
    task: 't_e4c3ffff', test: 'qa/hud-mobile-cdp.mjs', ts: new Date().toISOString(),
    rule: 'T5a : zone HUD canvas sans chevauchement (panneaux + toolbar + intro) ; police HUD ≥11px (13 souhaités) ; polices DOM interactives ≥11px ; texte HUD non débordant (largeur = contenu) ; contraste WCAG AA ≥4.5:1 pire cas (fonds α lues du CSS sur le monde le plus clair, terrainBorder)',
    viewports: [], verdict: 'PASS', problems: [],
  };

  // --- 5) CONTRASTE (calcul Node — couleurs lues du CSS, sync avec le code) ---
  const css = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const aPanel = cssRgbaAlpha(css, '.planning', 'background');
  const aPanel2 = cssRgbaAlpha(css, '.panel', 'background');
  const aToolbar = cssRgbaAlpha(css, '.toolbar', 'background');
  const alphas = [aPanel, aPanel2, aToolbar].filter((a) => a !== null);
  if (alphas.length < 3) {
    report.problems.push(`alpha de fond non lues dans index.html (planning=${aPanel} panel=${aPanel2} toolbar=${aToolbar})`);
    report.verdict = 'FAIL';
  } else {
    // Pire cas : le monde le plus clair connu (bordure de terrain, palette
    // standard R43) — le plus lumineux derrière un panneau ; le plus sombre
    // (nuit, #0a1220) ne fait qu'augmenter le contraste.
    const bright = hex2rgb(getPalette(false).terrainBorder); // #cfd8dc
    const worstBg = alphas.map((a) => blendOver(bright, [0, 0, 0], a));
    const worstLum = worstBg.map((c) => lum(c[0], c[1], c[2]));
    const texts = { '#fff': hex2rgb('#ffffff'), '#b0bec5': hex2rgb('#b0bec5'), '#90a4ae': hex2rgb('#90a4ae') };
    for (const [name, rgb] of Object.entries(texts)) {
      const tl = lum(rgb[0], rgb[1], rgb[2]);
      for (const wbg of worstLum) {
        const c = contrast(tl, wbg);
        if (c < 4.5) {
          report.problems.push(`contraste ${name} sur fond panneau (pire cas ${bright} α${alphas[0]} : ${wbg.join(',')}) = ${c.toFixed(2)}:1 < 4.5:1 (AA)`);
          report.verdict = 'FAIL';
        }
      }
    }
    // Le HUD canvas : surface rgba(10,18,32,0.82) (renderer.mjs, T4) + texte #e8eef7.
    const hudBg = blendOver(bright, [10, 18, 32], 0.82);
    const hudC = contrast(lum(...hex2rgb('#e8eef7')), lum(hudBg[0], hudBg[1], hudBg[2]));
    report.contrastHud = { ratio: Number(hudC.toFixed(2)), over: hudBg };
    if (hudC < 4.5) { report.problems.push(`contraste HUD ${hudC.toFixed(2)}:1 < 4.5:1`); report.verdict = 'FAIL'; }
    report.contrastPanel = {
      alphas, overWorld: bright,
      ratios: Object.fromEntries(Object.entries(texts).map(([n, rgb]) => [n, Number(contrast(lum(rgb[0], rgb[1], rgb[2]), Math.max(...worstLum)).toFixed(2))])),
    };
  }

  // --- Vueports : 1366×768 (desktop de référence) + 390×844 (le bug mobile) ---
  const views = [
    { name: '1366x768', w: 1366, h: 768, mobile: false },
    { name: '390x844', w: 390, h: 844, mobile: true },
  ];

  for (const v of views) {
    await setViewport(v);
    const viewReport = { viewport: v.name, checks: {} };
    report.viewports.push(viewReport);

    await navigate(`http://127.0.0.1:${port}/`);
    await sleep(2000);
    const started = await evaluate(`window.__game ? (window.__game.startNewGame(), true) : false`);
    if (!started) { report.problems.push(`${v.name} : window.__game absent (crash au boot)`); report.verdict = 'FAIL'; break; }
    await sleep(3000); // toasts de début de partie + intro + HUD peints

    const m = await evaluate(MEASURE);
    if (!m || !m.hud || m.hud === 'ABSENT') {
      report.problems.push(`${v.name} : __game.hudRect() absent (le HUD n'a pas été exposé/peint)`);
      report.verdict = 'FAIL';
      continue;
    }
    const hud = m.hud;
    const visible = m.layers.filter((l) => l.present && !l.hidden && l.sel !== '.toasts'); // toasts : transitoires, pointer-events:none (exclus des paires, règle T51)
    const interactive = visible.filter((l) => l.w > 0 && l.h > 0);

    // 1) Zéro chevauchement : zone HUD × chaque panneau interactif + panneaux entre eux.
    const hudOverlaps = [];
    for (const l of interactive) {
      const px = overlapPx({ ...hud, hidden: false, present: true }, l);
      if (px > 0) hudOverlaps.push({ a: '#game[HUD]', b: l.sel, px });
    }
    const panelOverlaps = [];
    for (let i = 0; i < interactive.length; i++) for (let j = i + 1; j < interactive.length; j++) {
      const px = overlapPx(interactive[i], interactive[j]);
      if (px > 0) panelOverlaps.push({ a: interactive[i].sel, b: interactive[j].sel, px });
    }
    viewReport.checks.hudVsPanels = { hud, panels: interactive.map((l) => l.sel), hudOverlaps, panelOverlaps };
    if (hudOverlaps.length > 0) {
      report.problems.push(`${v.name} : la zone HUD chevauche ${hudOverlaps.map((o) => `${o.b} (${o.px} px²)`).join(', ')}`);
      report.verdict = 'FAIL';
    }
    if (panelOverlaps.length > 0) {
      report.problems.push(`${v.name} : chevauchement panneaux ${panelOverlaps.map((o) => `${o.a}×${o.b}`).join(', ')}`);
      report.verdict = 'FAIL';
    }
    // Mobile : le HUD est SOUS la stripe planning (le contrôle anti-bug, explicite).
    if (v.mobile) {
      const plan = m.layers.find((l) => l.sel === '.planning');
      if (!plan || plan.hidden) {
        report.problems.push(`${v.name} : stripe planning absente/masquée — le layout mobile T5a n'est pas en place`);
        report.verdict = 'FAIL';
      } else if (hud.y < plan.y + plan.h + 6) {
        report.problems.push(`${v.name} : le HUD (y=${hud.y}) n'est pas sous la stripe planning (fin ${plan.y + plan.h}) — le bug n'est pas corrigé`);
        report.verdict = 'FAIL';
      }
    }

    // 2) Police du HUD (13 px souhaités ; 11 px minimum).
    viewReport.checks.hudFont = hud.fontPx;
    if (hud.fontPx < 11) { report.problems.push(`${v.name} : police HUD ${hud.fontPx}px < 11px`); report.verdict = 'FAIL'; }

    // 3) Polices DOM interactives ≥ 11 px (13 px souhaités).
    const small = m.fonts.filter((f) => f.px < 11);
    viewReport.checks.domFonts = m.fonts;
    if (small.length > 0) {
      report.problems.push(`${v.name} : éléments < 11px : ${small.map((f) => `${f.sel} ${f.px}px`).join('; ')}`);
      report.verdict = 'FAIL';
    }

    // 4) Texte du HUD non débordant (largeur du panneau = plus longue ligne + 24).
    const fits = hud.maxLinePx + 24 <= hud.w;
    viewReport.checks.textFits = { maxLinePx: hud.maxLinePx, panelW: hud.w, fits };
    if (!fits) {
      report.problems.push(`${v.name} : le texte du HUD déborde son panneau (ligne ${hud.maxLinePx}px + 24 > ${hud.w}px)`);
      report.verdict = 'FAIL';
    }

    await screenshot(join(evidenceDir, `t5a-hud-${v.name}.png`));
  }

  ws.close();
  b.proc.kill();
  server.kill();

  writeFileSync(join(ROOT, 'qa/hud-mobile-cdp-report.json'), JSON.stringify(report, null, 2));

  for (const v of report.viewports) {
    const c = v.checks;
    console.log(`\n=== ${v.viewport} ===`);
    if (c.hudVsPanels) {
      console.log(`  HUD zone : (${c.hudVsPanels.hud.x},${c.hudVsPanels.hud.y}) ${c.hudVsPanels.hud.w}×${c.hudVsPanels.hud.h} — police ${c.hudFont}px, lignes ${c.hudVsPanels.hud.lines}, mobile=${c.hudVsPanels.hud.mobile}`);
      console.log(`  chevauchements HUD×panneaux : ${c.hudVsPanels.hudOverlaps.length} — panneaux×panneaux : ${c.hudVsPanels.panelOverlaps.length}`);
    }
    if (c.domFonts) console.log(`  polices DOM <11px : ${c.domFonts.filter((f) => f.px < 11).length} / ${c.domFonts.length} éléments`);
    if (c.textFits) console.log(`  texte HUD dans son panneau : ${c.textFits.fits ? 'OK' : 'DÉBORDE'} (ligne ${c.textFits.maxLinePx}px, panneau ${c.textFits.panelW}px)`);
  }
  if (report.contrastPanel) console.log(`\nContraste pire cas (fond panneau sur ${report.contrastPanel.overWorld.join(',')} α${report.contrastPanel.alphas.join('/')}) : ${JSON.stringify(report.contrastPanel.ratios)} ; HUD ${report.contrastHud.ratio}:1`);
  for (const p of report.problems) console.log(`  PROBLÈME : ${p}`);
  console.log(`\nVERDICT : ${report.verdict} (problèmes : ${report.problems.length})`);
  console.log('RAPPORT : qa/hud-mobile-cdp-report.json');
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR T5a HUD :', e); process.exit(1); });
