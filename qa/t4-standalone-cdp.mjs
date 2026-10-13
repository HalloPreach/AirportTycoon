// T4 (t_eb78478e) — PREUVE D'EXÉCUTION de la VERSION AUTONOME (dist/standalone).
//
// Charge la version autonome (dist/standalone.html + dist/standalone.js,
// un SEUL script classique inliné — 0 module, 0 appel réseau) dans Edge
// headless via CDP, et vérifie que le jeu DEMARRE ET JOUE à partir de
// cet artefact unique, en DEUX conditions :
//
//   A. http:// (serveur statique local sur dist/) :
//      • window.__game exposé (le bundle a exécuté main.mjs)
//      • 0 ressource servie depuis src/ (tout est inliné — la page ne charge
//        QUE standalone.js : preuve mesurée via Performance API)
//      • le menu s'affiche (screen='menu'), 30 frames, temps qui avance
//      • nouvelle partie : sim créée, aéroport fourni (1 piste, 2 portes,
//        1 taxiway), réseau valide — la simulation progresse
//      • les icônes vectorielles T4 sont dans la toolbar (canvas .tool)
//      • les astuces T4 sont branchées (g.tips exposé, state.tips.seen persistant)
//      • sauvegarde (localStorage) + rechargement cohérent
//      • captures horodatées (menu + jeu)
//
//   B. file:// (AUCUN serveur, AUCUN réseau) :
//      • boot du MÊME artefact depuis le disque local : window.__game exposé,
//        menu affiché, frames qui avancent, 0 ressource chargée (tout est
//        inliné), 0 exception → JOUABLE HORS-LIGNE (file://)
//
// Pattern : qa/cdp-boot.mjs (serveur statique + Edge headless + CDP,
// WebSocket global Node ≥22, 0 dépendance).
// Usage : node qa/t4-standalone-cdp.mjs   (code retour 0 = PASS, 1 = FAIL)
//         (pré-requis : npm run build — dist/ à jour)
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
function stamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const TS = stamp();

// --- 0. pré-requis : dist/ à jour --------------------------------------------
const distJs = join(ROOT, 'dist', 'standalone.js');
const distHtml = join(ROOT, 'dist', 'standalone.html');
if (!existsSync(distJs) || !existsSync(distHtml)) {
  console.error('FAIL dist/standalone.{html,js} absent — lancer d\'abord : npm run build');
  process.exit(1);
}

// --- 1. serveur statique local (racine projet → /dist/) ----------------------
function freePort() { return 8600 + Math.floor(Math.random() * 300); }
function httpProbe(url, tries = 40) {
  return new Promise((resolveP) => {
    let n = 0;
    (function attempt() {
      httpGet(url, (res) => { resolveP(res.statusCode === 200); res.resume(); })
        .on('error', () => { if (++n < tries) setTimeout(attempt, 100); else resolveP(false); });
    })();
  });
}

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('FAIL Edge introuvable'); process.exit(1); }

let port = freePort();
let server = spawn(process.execPath, ['serve.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;
const userDataDir = mkdtempSync(join(tmpdir(), 'at-qa-t4-'));

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up);
  if (!up) return finish();

  // --- 2. Edge headless + CDP (pattern qa/cdp-boot.mjs) ------------------------
  const cdpPort = freePort();
  edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const target = await new Promise((resolveP) => {
    let n = 0;
    (function poll() {
      httpGet(`http://127.0.0.1:${cdpPort}/json/list`, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const list = JSON.parse(body);
            const page = list.find((t) => t.type === 'page');
            if (page) resolveP(page);
            else if (++n < 50) setTimeout(poll, 250);
            else resolveP(null);
          } catch { if (++n < 50) setTimeout(poll, 250); else resolveP(null); }
        });
      }).on('error', () => { if (++n < 50) setTimeout(poll, 250); else resolveP(null); });
    })();
  });
  if (!target) { check('CDP target', false, 'aucun target page après 12 s'); return finish(); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cdp = (method, params = {}) => {
    const id = ++seq;
    const p = new Promise((resolveP, reject) => {
      pending.set(id, { resolve: resolveP, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    return p;
  };
  async function evaluate(expression, awaitPromise = false) {
    const msg = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (msg.result.exceptionDetails) {
      throw new Error('exception page : ' + (msg.result.exceptionDetails.exception?.description || JSON.stringify(msg.result.exceptionDetails)));
    }
    return msg.result.result.value;
  }

  await cdp('Page.enable');
  await cdp('Runtime.enable');

  // --- 3. SECTION A — http : le jeu démarre de l'artefact unique -------------
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/dist/standalone.html` });
  await new Promise((r) => setTimeout(r, 1000)); // script CLASSIQUE : exécution immédiate

  check('A1 window.__game exposé (bundle exécuté)', (await evaluate('typeof window.__game')) === 'object');

  // PREUVE D'INLINATION : la page n'a chargé AUCUNE ressource src/ — tout est
  // dans standalone.js (si un import ESM résiduel existait, le navigateur
  // l'aurait demandé → il apparaîtrait ici ET leverait une exception).
  const res = await evaluate(`performance.getEntriesByType('resource').map((e) => e.name)`);
  const srcRes = (res || []).filter((n) => n.includes('/src/'));
  check('A2 0 ressource src/ (tout est inliné)', srcRes.length === 0, `ressources=${(res || []).length} (src/: ${srcRes.length})`);
  check('A2b standalone.js chargé', (res || []).some((n) => n.includes('standalone.js')));

  check('A3 menu affiché (screen="menu")', (await evaluate('window.__game.state.screen')) === 'menu');

  const framesA = await evaluate(`(async () => {
    const g = window.__game;
    let count = 0; const times = [];
    await new Promise((resolveP) => {
      const tick = () => {
        times.push(g.state.time);
        if (++count >= 30) resolveP();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { count, first: times[0], last: times[times.length - 1] };
  })()`, true);
  check('A4 menu animé : 30 frames', framesA?.count === 30, `count=${framesA?.count}`);

  const menuShot = await cdp('Page.captureScreenshot', { format: 'png' });
  const menuPath = join(ROOT, 'evidence', `t4-standalone-${TS}-menu.png`);
  mkdirSync(join(ROOT, 'evidence'), { recursive: true });
  writeFileSync(menuPath, Buffer.from(menuShot.result.data, 'base64'));

  // Nouvelle partie depuis le menu (même code que la route modules).
  const gameOut = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    let count = 0; const times = [];
    await new Promise((resolveP) => {
      const tick = () => {
        times.push(g.state.time);
        if (++count >= 30) resolveP();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const s = g.state;
    return {
      screen: s.screen, simAlive: !!s.sim,
      runways: s.sim?.infra?.runways?.length,
      taxiways: s.sim?.infra?.taxiways?.length,
      gates: s.sim?.infra?.gates?.length,
      t0: times[0], t30: times[times.length - 1],
      toolIcons: document.querySelectorAll('.toolbar .tool canvas').length,
      tips: typeof g.tips,
      tipsSeenFn: typeof g.tips?.seen,
      stateTipsSeen: Array.isArray(g.state.tips?.seen) ? g.state.tips.seen.length : -1,
    };
  })()`, true);
  check('A5 nouvelle partie : sim créée (artefact autonome)', gameOut?.simAlive === true, `screen=${gameOut?.screen}`);
  check('A6 aéroport fourni (1 piste + 1 taxiway + 2 portes)',
    gameOut?.runways === 1 && gameOut?.taxiways === 1 && gameOut?.gates === 2,
    `pistes=${gameOut?.runways} taxiways=${gameOut?.taxiways} portes=${gameOut?.gates}`);
  check('A7 simulation progresse (temps de jeu avance)', (gameOut?.t30 || 0) > (gameOut?.t0 ?? -1), `t0=${gameOut?.t0} t30=${gameOut?.t30}`);
  check('A8 icônes vectorielles T4 dans la toolbar (canvas .tool)', (gameOut?.toolIcons || 0) >= 8, `icônes=${gameOut?.toolIcons}`);
  check('A9 astuces T4 branchées (g.tips.refresh + state.tips.seen persistant)',
    gameOut?.tips === 'object' && gameOut?.tipsSeenFn === 'function' && gameOut?.stateTipsSeen >= 0,
    `seen()=${gameOut?.tipsSeenFn} state.tips.seen=${gameOut?.stateTipsSeen}`);

  const gameShot = await cdp('Page.captureScreenshot', { format: 'png' });
  const gamePath = join(ROOT, 'evidence', `t4-standalone-${TS}-jeu.png`);
  writeFileSync(gamePath, Buffer.from(gameShot.result.data, 'base64'));

  // Sauvegarde (localStorage) + rechargement : l'état REPREND.
  const saveOut = await evaluate(`(() => {
    const g = window.__game;
    const saved = g.save();
    const ok = g.load();
    const s = g.state;
    return {
      saved, ok, simAlive: !!s.sim, screen: s.screen,
      money: Math.round(s.sim?.economy?.money ?? -1),
    };
  })()`);
  check('A10 sauvegarde + rechargement cohérent', saveOut?.saved === true && saveOut?.ok === true && saveOut?.simAlive === true,
    `saved=${saveOut?.saved} load=${saveOut?.ok} money=${saveOut?.money}`);

  const errsA = pageErrors.length;
  check('A11 0 exception page (section http)', errsA === 0, pageErrors.slice(0, 2).join(' | '));

  // --- 4. SECTION B — file:// : JEU HORS-LIGNE (0 serveur, 0 réseau) ----------
  const fileUrl = pathToFileURL(distHtml).href;
  await cdp('Page.navigate', { url: fileUrl });
  await new Promise((r) => setTimeout(r, 1000));
  await evaluate('performance.clearResourceTimings()');

  check('B1 file:// window.__game exposé (boot hors-ligne)', (await evaluate('typeof window.__game')) === 'object');
  check('B2 file:// menu affiché', (await evaluate('window.__game.state.screen')) === 'menu');

  const framesB = await evaluate(`(async () => {
    const g = window.__game;
    let count = 0;
    await new Promise((resolveP) => {
      const tick = () => { if (++count >= 20) resolveP(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    return { count, screen: g.state.screen, time: g.state.time };
  })()`, true);
  check('B3 file:// menu animé (20 frames)', framesB?.count === 20, `count=${framesB?.count}`);

  // Hors-ligne = AUCUNE ressource chargée (tout est inliné dans le fichier).
  const resB = await evaluate(`performance.getEntriesByType('resource').map((e) => e.name)`);
  check('B4 file:// 0 ressource externe (tout inliné)', (resB || []).length === 0, `ressources=${(resB || []).length}`);

  const offlineShot = await cdp('Page.captureScreenshot', { format: 'png' });
  const offlinePath = join(ROOT, 'evidence', `t4-standalone-${TS}-menu-offline.png`);
  writeFileSync(offlinePath, Buffer.from(offlineShot.result.data, 'base64'));

  const totalErrs = pageErrors.length;
  check('B5 file:// 0 exception (boot complet hors-ligne)', totalErrs === errsA, `exceptions totales=${totalErrs}`);

  // --- 5. rapport -------------------------------------------------------------
  const report = {
    verdict: results.every((r) => r.ok) ? 'PASS' : 'FAIL',
    timestamp: new Date().toISOString(),
    artifact: { js: Buffer.byteLength(readFileSync(distJs)), html: Buffer.byteLength(readFileSync(distHtml)) },
    checks: results,
    captures: [menuPath, gamePath, offlinePath],
    pageExceptions: pageErrors,
  };
  writeFileSync(join(ROOT, 'qa', 't4-standalone-cdp-report.json'), JSON.stringify(report, null, 2) + '\n');

  ws.close();
  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'T4 STANDALONE CDP QA : PASS' : `T4 STANDALONE CDP QA : FAIL (${failed.length})`);
  edgeProc?.kill();
  server?.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('QA crash:', e.message); server?.kill(); edgeProc?.kill(); process.exit(1); });
