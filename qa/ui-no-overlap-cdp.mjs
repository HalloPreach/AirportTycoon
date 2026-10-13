// T51 (t_cccfbc97) — TEST DE RÉGRESSION « AUCUN CHEVAUCHEMENT » (Edge headless
// + CDP, 0 dépendance, Node >= 22). Contrôles, par VUEPORT (1920x1080,
// 1366x768, 390x844) et par ÉTAT (menu / partie neuve / partie rechargée) :
// l'intersection des boîtes de tous les éléments interactifs VISIBLES doit être
// VIDE (la hiérarchie z-index explicite + le layout par zones de index.html, et
// la bascule menu/jeu de main.mjs, interdisent le chevauchement interactif).
// Le canvas #game (zone de jeu) et .toasts (pointer-events:none, transitoires)
// sont exclus des paires — règle du brief : AUCUN élément interactif ne doit
// masquer la zone de jeu ni un autre élément interactif.
// Au menu, les 3 racines de panneaux de JEU (.planning / .panels / .toolbar)
// doivent être MASQUÉES (bascule display de main.mjs) — contrôlé explicitement.
// Sorties : rapport qa/ui-no-overlap-cdp-report.json + captures
// evidence/ui-overlap-after-<viewport>-<ecran>.png. Code de sortie : 0 = PASS
// (0 chevauchement résiduel), 1 = FAIL (chevauchement résiduel ou crash).
// Usage : node qa/ui-no-overlap-cdp.mjs
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t51-noov-'));
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

// --- Mesure : les couches DOM UI (mêmes sélecteurs que la reproduction) ---
const SELS = ['#game', '.toasts', '.planning', '.panels', '.intro', '.toolbar', '.bankruptcy', '.options', '.menu-btns'];
const GAME_PANEL_SELS = ['.planning', '.panels', '.toolbar'];
const MEASURE = `(() => {
  const out = [];
  for (const sel of ${JSON.stringify(SELS)}) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ sel, present: false }); continue; }
    const st = getComputedStyle(el);
    if (el.style.display === 'none' || st.display === 'none') { out.push({ sel, present: true, hidden: true }); continue; }
    const r = el.getBoundingClientRect();
    out.push({
      sel, present: true, hidden: false,
      pos: st.position, z: st.zIndex, pe: st.pointerEvents,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  out.push({ sel: '__screen', screen: (window.__game && window.__game.state && window.__game.state.screen) || 'unknown' });
  return out;
})()`;

function overlap(a, b) {
  if (!a || !b || a.hidden || b.hidden || !a.present || !b.present) return 0;
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  if (!up) { console.error('serveur down'); server.kill(); process.exit(1); }
  const b = await startBrowser();
  if (!b) { console.error('Edge down'); server.kill(); process.exit(1); }
  const ws = new WebSocket(b.target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });

  // Enveloppe CDP minimale : un id par requête, résolution par message.
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

  const views = [
    { name: '1920x1080', w: 1920, h: 1080, mobile: false },
    { name: '1366x768', w: 1366, h: 768, mobile: false },
    { name: '390x844', w: 390, h: 844, mobile: true },
  ];
  const evidenceDir = join(ROOT, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const report = {
    task: 't_cccfbc97', test: 'qa/ui-no-overlap-cdp.mjs', ts: new Date().toISOString(),
    rule: 'aucun élément interactif visible ne chevauche un autre (zones + z-index) ; #game (zone de jeu) et .toasts (pointer-events:none) exclus des paires ; au menu, les 3 racines de panneaux de jeu sont masquées',
    viewports: [], verdict: 'PASS', totalOverlaps: 0,
  };

  // Mesure d'un écran + capture. expectMenu : les panneaux de jeu doivent être
  // masqués (bascule T51) ; resumed : la reprise a été confirmée (loadNow).
  const capture = async (name, screen, expectMenu, resumed = true) => {
    const layers = (await evaluate(MEASURE)) || [];
    const screenVal = layers.find((l) => l.sel === '__screen');
    const screenName = screenVal ? screenVal.screen : 'unknown';
    const interactive = layers.filter((l) => l.present && !l.hidden && l.sel !== '__screen'
      && l.sel !== '#game' && l.sel !== '.toasts' && l.w > 0 && l.h > 0);
    const overlaps = [];
    for (let i = 0; i < interactive.length; i++) {
      for (let j = i + 1; j < interactive.length; j++) {
        const px = overlap(interactive[i], interactive[j]);
        if (px > 0) overlaps.push({ a: interactive[i].sel, b: interactive[j].sel, px: Math.round(px) });
      }
    }
    const entry = {
      screen, screenExpected: screen, screenActual: screenName,
      layers: layers.filter((l) => l.sel !== '__screen' && l.present),
      overlaps,
    };
    if (overlaps.length > 0) report.verdict = 'FAIL';
    if (expectMenu) {
      entry.menuPanelsHidden = GAME_PANEL_SELS.every((s) => {
        const l = layers.find((x) => x.sel === s);
        return l && l.hidden;
      });
      if (!entry.menuPanelsHidden) { entry.note = 'panneaux de jeu VISIBLES au menu (bascule T51 en défaut)'; report.verdict = 'FAIL'; }
    }
    if (screen !== 'menu' && screenName !== 'game') { entry.note = `écran « ${screenName} » au lieu de game`; report.verdict = 'FAIL'; }
    if (!resumed) { entry.note = (entry.note ? entry.note + ' ; ' : '') + 'reprise non confirmée'; report.verdict = 'FAIL'; }
    await screenshot(join(evidenceDir, `ui-overlap-after-${name}.png`));
    return entry;
  };

  for (const v of views) {
    await setViewport(v);
    const viewReport = { viewport: v.name, screens: [] };
    report.viewports.push(viewReport);

    // 1) MENU — page fraîche, jeu non démarré.
    await navigate(`http://127.0.0.1:${port}/`);
    await sleep(2000);
    viewReport.screens.push(await capture(`${v.name}-menu`, 'menu', true));

    // 2) PARTIE NEUVE.
    const started = await evaluate(`window.__game ? (window.__game.startNewGame(), true) : false`);
    if (!started) { report.failure = `${v.name} : window.__game absent (crash au boot)`; break; }
    await sleep(3000); // toasts de début de partie + intro
    viewReport.screens.push(await capture(`${v.name}-game`, 'game', false));

    // 3) PARTIE RECHARGÉE — sauvegarde → page fraîche → reprise.
    await evaluate(`window.__game.save(); true`);
    await sleep(500);
    await navigate(`http://127.0.0.1:${port}/`);
    await sleep(2000);
    const resumed = await evaluate(`window.__game && window.__game.canResume() ? (window.__game.load(), true) : false`);
    await sleep(1500);
    viewReport.screens.push(await capture(`${v.name}-game-reloaded`, 'game-reloaded', false, resumed));
    if (!resumed) { report.failure = `${v.name} : reprise impossible (canResume faux)`; break; }
  }

  ws.close();
  b.proc.kill();
  server.kill();

  report.totalOverlaps = report.viewports.reduce((n, v) => n + v.screens.reduce((m, s) => m + s.overlaps.length, 0), 0);
  if (report.verdict === 'PASS' && report.totalOverlaps > 0) report.verdict = 'FAIL';
  writeFileSync(join(ROOT, 'qa/ui-no-overlap-cdp-report.json'), JSON.stringify(report, null, 2));

  for (const v of report.viewports) {
    console.log(`\n=== ${v.viewport} ===`);
    for (const s of v.screens) {
      console.log(`  ${s.screen.padEnd(16)} écran=${s.screenActual} chevauchements=${s.overlaps.length}` + (s.note ? ` — ${s.note}` : ''));
      for (const p of s.overlaps) console.log(`    ${p.a} x ${p.b} — ${p.px} px²`);
    }
  }
  console.log(`\nVERDICT : ${report.verdict}${report.failure ? ` — ${report.failure}` : ''} (chevauchements résiduels : ${report.totalOverlaps})`);
  console.log('RAPPORT : qa/ui-no-overlap-cdp-report.json');
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR T51 no-overlap :', e); process.exit(1); });
