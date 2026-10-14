#!/usr/bin/env node
// T6 (t_87168414) — preuve « TOUTES les entrées » : l'entrée SITE
// (docs/game.html + docs/standalone.js, ré-émise avec la build T6) doit
// être JOUABLE en mobile au même titre que index.html / dist/standalone.html.
// Viewport 390×844 (classe iPhone), Edge headless + CDP, 0 dépendance
// (même pattern que qa/t6-mobile-cdp.mjs — le rapport de celui-ci couvre
// l'entrée racine ; ce script couvre l'entrée docs).
//   1. boot : window.__game présent (bundle syncé fonctionne)
//   2. démarrer la partie (startNewGame + intro passée) — les bandes
//      .planning/.panels sont display:none sur l'écran MENU ; le check
//      d'accordion se fait donc sur l'écran JEU.
//   3. gestes réservés + accordion : canvas#game a touch-action:none
//      (calculé) ; bouton .fold visible + ≥44px ; planning/consultation
//      REPLIÉS par défaut (pas de classe .open)
//   4. chemin tactile partagé : tap (taxiway, zone libre) = pose
//      d'EXACTEMENT 1 bâtiment (buildTool.clickAt, même chemin que le
//      click desktop) — la logique n'est pas dupliquée par l'entrée, et
//      l'import différé de la règle sim est résolu par le bundle IIFE
//      (réécriture __dyn de tools/build-standalone.mjs).
// Preuves : evidence/t6-mobile/docs-entry-*.png + qa/t6-docs-entry-report.json
// Sortie : 0 = tout vert, 1 = échec.
// Usage : node qa/t6-docs-entry.mjs
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
const ENTRY = '/docs/game.html';

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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t6-docs-'));
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

// Touch CDP : x/y en px CSS du viewport (jeu fait bitmap = innerWidth).
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
  await send('Emulation.setDeviceMetricsOverride', { width: M_W, height: M_H, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}${ENTRY}` });
  await sleep(3500); // boot

  mkdirSync(EV, { recursive: true });
  const report = {
    task: 't_87168414', test: 'qa/t6-docs-entry.mjs', entry: ENTRY,
    ts: new Date().toISOString(), viewport: { w: M_W, h: M_H, dpr: 2 }, checks: {},
  };
  const shot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const p = join(EV, name);
    writeFileSync(p, Buffer.from(res.result.data, 'base64'));
    console.log(`    [shot] ${p}`);
  };

  const hasGame = await evaluate('window.__game ? true : false');
  if (!hasGame) {
    report.fatal = 'window.__game absent sur l’entrée docs (crash au boot)';
    console.error('    FATAL :', report.fatal);
    ws.close(); b.proc.kill(); server.kill();
    writeFileSync(join(ROOT, 'qa/t6-docs-entry-report.json'), JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // 1. Gestes réservés : touch-action:none CALCULÉ sur le canvas.
  const touchAction = await evaluate('getComputedStyle(document.querySelector("canvas#game")).touchAction');
  report.checks.touchAction = { pass: touchAction === 'none', value: touchAction };

  // 2. Démarrage (écran jeu) : startNewGame + intro passée. Les bandes
  //    .planning/.panels sont display:none sur l'écran MENU — le check
  //    d'accordion doit se faire APRES, sur l'écran jeu.
  await evaluate('__game.startNewGame(); "ok"');
  for (let i = 0; i < 20 && !(await evaluate('__game.state.sim ? true : false')); i++) await sleep(200);
  await evaluate('__game.state.intro.skipped = true; __game.state.intro.done = true; const el = document.querySelector(".intro"); if (el) el.style.display = "none"; "ok"');
  await sleep(250);

  // 3. Accordion : .fold visible + ≥44px ; bandes repliées par défaut.
  const fold = await evaluate(`(() => {
    const f = document.querySelector('.planning .fold');
    if (!f) return { present: false };
    const r = f.getBoundingClientRect();
    const visible = f.offsetParent !== null && r.width >= 40 && r.height >= 40;
    return { present: true, visible, w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  const folded = await evaluate(`({ planning: document.querySelector('.planning') ? !document.querySelector('.planning').classList.contains('open') : false, panels: document.querySelector('.panels') ? !document.querySelector('.panels').classList.contains('open') : false })`);
  report.checks.accordion = {
    pass: fold.present && fold.visible && fold.h >= 44 && folded.planning && folded.panels,
    fold, defaultState: 'repliées (pas de .open)',
  };

  // 4. Chemin tactile partagé : tap construction (mêmes étapes que
  //    t6-mobile-cdp — zone libre x≈100/y≈500, taxiway). Preuve que le
  //    bundle docs (IIFE, __dyn) résout l'import différé de la règle sim.
  await evaluate('__game.state.camera.x = 100; __game.state.camera.y = 500; __game.state.camera.zoom = 1; "ok"');
  await evaluate('__game.buildTool.cancel(); __game.buildTool.setKind("taxiway"); __game.buildTool.toggleBuild(); "on"');
  const countBuildings = () => evaluate('__game.state.sim ? (__game.state.sim.infra.runways.length + __game.state.sim.infra.services.length + __game.state.sim.infra.terminals.length + __game.state.sim.infra.taxiways.length) : -1');
  const c0 = await countBuildings();
  const tX = Math.round(M_W / 2), tY = Math.round(M_H / 2);
  await gesture(send, [[tX, tY, 1]], [], [[tX, tY, 1]]);
  await sleep(400); // clickAt est async (import différé de la règle sim)
  const c1 = await countBuildings();
  report.checks.tapBuild = {
    pass: c1 === c0 + 1,
    tapAt: [tX, tY], before: c0, after: c1,
    note: 'tap (chemin buildTool.clickAt partagé) pose EXACTEMENT 1 bâtiment sur l’entrée docs',
  };
  await evaluate('__game.buildTool.cancel(); "off"');

  await shot('docs-entry-mobile.png');
  const fails = Object.entries(report.checks).filter(([, c]) => !c.pass).map(([k]) => k);
  for (const [name, c] of Object.entries(report.checks)) {
    console.log(`    ${c.pass ? 'OK  ' : 'FAIL'} ${name}`);
  }
  writeFileSync(join(ROOT, 'qa/t6-docs-entry-report.json'), JSON.stringify(report, null, 2));
  ws.close(); b.proc.kill(); server.kill();
  if (fails.length) {
    console.error(`    ${fails.length} échec(s) : ${fails.join(', ')}`);
    process.exit(1);
  }
  console.log(`    ${Object.keys(report.checks).length}/${Object.keys(report.checks).length} checks OK (entrée ${ENTRY})`);
}

main().catch((err) => {
  console.error('ERREUR :', err);
  server.kill();
  process.exit(1);
});
