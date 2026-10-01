// QA sans GUI : démarre le serveur local + Edge headless (CDP), charge la page,
// et vérifie l'acceptance M1 : 30 frames observées, temps qui avance, pause qui gèle,
// retour menu. 0 dépendance : WebSocket global de Node ≥22.
// Usage : node qa/cdp-boot.mjs   (code retour 0 = PASS, 1 = FAIL)
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// --- 1. serveur statique local ---------------------------------------------
function freePort() { return 8200 + Math.floor(Math.random() * 500); }
function httpProbe(url, tries = 40) {
  return new Promise((resolve) => {
    let n = 0;
    (function attempt() {
      httpGet(url, (res) => { resolve(res.statusCode === 200); res.resume(); })
        .on('error', () => { if (++n < tries) setTimeout(attempt, 100); else resolve(false); });
    })();
  });
}

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
import { existsSync } from 'node:fs';
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('FAIL Edge introuvable'); process.exit(1); }

let port = freePort();
let server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;
const userDataDir = mkdtempSync(join(tmpdir(), 'at-qa-'));
async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up);
  if (!up) return finish();

  // --- 2. Edge headless + CDP ------------------------------------------------
  const cdpPort = freePort();
  edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const targets = await new Promise((resolve) => {
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
  if (!targets) { check('CDP target', false, 'aucun target page après 12 s'); return finish(); }
  check('CDP target page trouvé', true, targets.webSocketDebuggerUrl.slice(0, 40));

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data); // RAW : {id, result:{...}}
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg); // on résout avec l'objet RAW (piège connu)
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cdp = (method, params = {}) => {
    const id = ++seq;
    const p = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    return p;
  };
  async function evaluate(expression, awaitPromise = false) {
    const msg = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (msg.result.exceptionDetails) {
      throw new Error('exception page : ' + (msg.result.exceptionDetails.exception?.description || JSON.stringify(msg.result.exceptionDetails)));
    }
    return msg.result.result.value; // RAW : result.result.value
  }

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await new Promise((r) => setTimeout(r, 1500)); // modules ES chargés

  // --- 3. acceptance M1 -------------------------------------------------------
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  const frames = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    return new Promise((resolve) => {
      let count = 0; const times = [];
      const tick = () => {
        times.push(g.state.time);
        if (++count >= 30) resolve({ count, first: times[0], last: times[times.length - 1], screen: g.state.screen });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  })()`, true);
  check('30 frames observées', frames?.count === 30, `count=${frames?.count}`);
  check('temps de jeu avance (x1)', (frames?.last || 0) > 0 && frames.last > frames.first, `t0=${frames?.first} t29=${frames?.last}`);

  const frozen = await evaluate(`(async () => {
    const g = window.__game;
    g.togglePause();
    const t0 = g.state.time;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { paused: g.state.paused, moved: Math.abs(g.state.time - t0) };
  })()`, true);
  check('pause gèle le temps', frozen?.paused === true && frozen.moved === 0, `moved=${frozen?.moved}`);

  // --- 4. boucle jouable : construire, simuler, encaisser, sauvegarder/recharger ---
  // (la partie est déjà en cours depuis la section 3 : screen='game', sim créée)
  const simReady = await evaluate(`(() => {
    const g = window.__game;
    return g.state.screen === 'game' && !!g.state.sim;
  })()`);
  check('sim présente après nouvelle partie (critère 1)', simReady === true);

  // Construit un aéroport minimal (mêmes coordonnées que les tests Node).
  const built = await evaluate(`(async () => {
    const g = window.__game;
    const { buildBuilding } = await import('./src/infra/infra.mjs');
    const sim = g.state.sim;
    const rw = buildBuilding(sim, 'runway', 750, 100);
    const tw = buildBuilding(sim, 'taxiway', 400, 1050);
    const te = buildBuilding(sim, 'terminal', 400, 900);
    return { rw: !!rw, tw: !!tw, te: !!te, money: Math.round(sim.economy.money) };
  })()`, true);
  check('construire un petit aéroport (critère 2)', built?.rw && built?.tw && built?.te,
    `solde=${built?.money}`);

  // Avance la sim (MÊME pipeline que la boucle de jeu) et vérifie qu'un vol
  // atterrit, roule à une porte, repart et rapporte de l'argent (critères 3,4,7,8).
  const simOut = await evaluate(`(async () => {
    const g = window.__game;
    g.state.paused = false;
    const { tick } = await import('./src/core/tick.mjs');
    for (let i = 0; i < 600; i++) tick(g.state, 1); // 600 s de jeu (x1)
    const s = g.state.sim;
    const phases = new Set();
    for (const a of s.aircraft) phases.add(a.phase);
    return {
      carried: s.passengers.totalCarried,
      paxRevenue: Math.round((s.economy.revenue.pax || 0) + (s.economy.revenue.landing || 0)),
      departed: (s.alerts || []).filter((a) => a.kind === 'flight-out').length,
      airborne: s.aircraft.length,
      bankrupt: s.economy.bankrupt,
      sample: [...phases].join(','),
    };
  })()`, true);
  check('vols complets : atterrissage → porte → départ (critères 3,4)',
    (simOut?.departed || 0) > 0,
    `départs=${simOut?.departed} recettes=${simOut?.paxRevenue} en cours=${simOut?.airborne} phases=${simOut?.sample}`);
  check('passagers transportés (critère 7)', (simOut?.carried || 0) > 0);
  check('recettes et dépenses effectives (critère 8)', (simOut?.paxRevenue || 0) > 0);
  check('pas de faillite sur aéroport rentable', simOut?.bankrupt === false);

  // Sauvegarde manuelle + rechargement (critères 10-13) via localStorage.
  const saveOut = await evaluate(`(async () => {
    const g = window.__game;
    const saved = g.save();
    const { loadFromStorage } = await import('./src/persistence/save.mjs');
    g.state.paused = false;
    const back = loadFromStorage();
    return { saved, runways: back?.sim?.infra?.runways?.length, money: Math.round(back?.sim?.economy?.money) };
  })()`, true);
  check('sauvegarde + rechargement cohérent (critères 10,12,13)',
    saveOut?.saved === true && saveOut?.runways === 1 && saveOut?.money !== undefined,
    `runways=${saveOut?.runways} money=${saveOut?.money}`);

  // Preuve visuelle : capture du jeu en cours (état DOM/canvas, pas les pixels
  // comme source de vérité — l'acceptation repose sur l'état de la sim).
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  const shotPath = join(import.meta.dirname, '..', 'evidence', 'jeu-en-cours.png');
  mkdirSync(join(import.meta.dirname, '..', 'evidence'), { recursive: true });
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
  check('capture d\u2019\u00e9tat sauvegard\u00e9e (preuve)', true, shotPath);

  // Recharger EN PLACE (bouton/touche L, critères 12-13) puis la sim continue :
  // l'état restauré est réinjecté dans le MÊME objet suivi par la boucle de jeu.
  const reloadOut = await evaluate(`(async () => {
    const g = window.__game;
    const ok = g.load();
    const { tick } = await import('./src/core/tick.mjs');
    const { advanceTime } = await import('./src/core/game-state.mjs');
    for (let i = 0; i < 120; i++) {
      const played = advanceTime(g.state, 1); // la paire boucle : horloge + sim
      tick(g.state, played);
    }
    return { ok, moved: g.state.time, screen: g.state.screen, simAlive: !!g.state.sim };
  })()`, true);
  check('recharger puis simulation continue (critères 12,13)',
    reloadOut?.ok === true && reloadOut.moved > 0 && reloadOut.simAlive,
    `temps=${Math.round(reloadOut?.moved ?? 0)}s screen=${reloadOut?.screen}`);

  const menu = await evaluate('(() => { const g = window.__game; g.quitToMenu(); return g.state.screen; })()');
  check('quitter revient au menu', menu === 'menu', `screen=${menu}`);

  check('aucune exception page', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  ws.close();
  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'CDP BOOT QA : PASS' : `CDP BOOT QA : FAIL (${failed.length})`);
  edgeProc?.kill();
  server?.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('QA crash:', e.message); server?.kill(); edgeProc?.kill(); process.exit(1); });
