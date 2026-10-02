// BL-17 (AC26, R3) — QA CDP 5 MINUTES RÉELLES : la STABILITÉ du rendu long-temps
// se prouve dans le vrai navigateur (le rendu n'est testé QUE ici — la logique
// pure 48 h est prouvée par bl17-sim48h.mjs sous Node, sans DOM).
//
// Contrat (R3) :
//   - Session de 5 minutes en TEMPS RÉEL (wall clock), vitesse maximale du jeu (x4,
//     touche F réelle × 2) : la sim avance ~20 h de jeu pendant que le QA mesure.
//   - Lancement et pilotage par ENTRÉES RÉELLES (clavier CDP, comme mvp-gate) —
//     aucune méthode du jeu n'est appelée ; l'observation est en lecture seule
//     (window.__game.state) + captures + journaux (règle AC27/AC28 de la porte).
//   - Stabilité du rendu : le FPS (médiane des échantillons par seconde) reste
//     ≥ 30, AUCUNE exception de page, AUCUN console.error, le solde/les passagers
//     restent FINIS (pas de NaN), les captures d'état sont lisibles.
//   - A-9 : le temps SIMULÉ et le temps RÉEL sont toujours distincts — le rapport
//     porte le temps sim, le temps réel écoulé et le facteur entre les deux
//     (≈ 4× : la vitesse x4 du jeu, pas la même horloge).
//
// Usage : node qa/bl17-cdp.mjs   (code retour 0 = PASS, 1 = FAIL)
// Évidence : evidence/bl-17/cdp-5min/ (captures PNG + rapport.txt + rapport.json).
// 0 dépendance : Edge headless + WebSocket global de Node ≥ 22 (comme mvp-gate).
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EVID = join(import.meta.dirname, '..', 'evidence', 'bl-17', 'cdp-5min');
mkdirSync(EVID, { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// --- 1. serveur statique local (serve.mjs) + Edge headless --------------------
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
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('FAIL Edge introuvable'); process.exit(1); }

const port = freePort();
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const userDataDir = mkdtempSync(join(tmpdir(), 'at-bl17cdp-'));
let edgeProc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchEdge() {
  const dport = 9200 + Math.floor(Math.random() * 400);
  edgeProc = spawn(edge, [
    '--headless=new', `--remote-debugging-port=${dport}`,
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,800', 'about:blank',
  ], { stdio: 'ignore' });
  const wsUrl = await new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      httpGet(`http://127.0.0.1:${dport}/json/list`, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const targets = JSON.parse(body);
            const page = targets.find((t) => t.type === 'page') || targets[0];
            if (page) resolve(page.webSocketDebuggerUrl);
            else if (Date.now() - t0 > 20000) reject(new Error('aucun target CDP'));
            else setTimeout(poll, 250);
          } catch { if (Date.now() - t0 > 20000) reject(new Error('parse CDP list')); else setTimeout(poll, 250); }
        });
      }).on('error', () => { if (Date.now() - t0 > 20000) reject(new Error('CDP port fermé')); else setTimeout(poll, 250); });
    })();
  });
  return wsUrl;
}

// --- 2. session CDP (lecture seule + entrées réelles) --------------------------
let ws;
let cdpSeq = 0;
const cdpPending = new Map();
const pageExceptions = []; // Runtime.exceptionThrown (stabilité)
const consoleErrors = [];   // Console.messageAdded level error (stabilité)

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++cdpSeq;
    cdpPending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (cdpPending.has(id)) { cdpPending.delete(id); reject(new Error(`timeout CDP ${method}`)); } }, 20000);
  });
}

async function connectCdp(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && cdpPending.has(msg.id)) {
      const { resolve, reject } = cdpPending.get(msg.id);
      cdpPending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg); // réponse BRUTE
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageExceptions.push(d.exception?.description || d.text || 'exception inconnue');
    } else if (msg.method === 'Console.messageAdded' && msg.params.message.level === 'error') {
      consoleErrors.push(msg.params.message.text);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Console.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}

// ÉVALUATION LECTURE-SEULE : expression (pas de méthode du jeu).
async function evaluate(expr) {
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (res.result?.exceptionDetails) {
    throw new Error('exception page : ' + (res.result.exceptionDetails.exception?.description || JSON.stringify(res.result.exceptionDetails)));
  }
  return res.result?.result?.value;
}

// ENTRÉE RÉELLE clavier (AC27) : rawKeyDown + keyUp = exactement 1 keydown
// (le keyDown « text » doublerait la frappe — leçon mvp-gate, sonde _probe-keys).
async function key(k) {
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

const STATE_SNAPSHOT = `(() => {
  const s = window.__game.state;
  const sim = s.sim;
  return {
    screen: s.screen, paused: s.paused, speed: [1, 2, 4][s.speedIndex],
    time: sim ? Math.round(sim.time) : 0,
    money: sim ? sim.economy.money : null,
    carried: sim ? sim.passengers.totalCarried : 0,
    ac: sim ? sim.aircraft.length : 0,
    phases: sim ? sim.aircraft.map((a) => a.phase).join(',') : '',
  };
})()`;
const snap = () => evaluate(STATE_SNAPSHOT);

async function waitFor(predExpr, ms, label, stepMs = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(predExpr);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout attente : ${label}`);
    await sleep(stepMs);
  }
}

async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const p = join(EVID, name);
  writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  return { path: p, bytes: r.result.data.length * 0.75 };
}

// --- 3. session 5 minutes (R3) -------------------------------------------------
const DURATION_S = 300; // 5 minutes RÉELLES (wall clock)
const MIN_FPS = 30;     // le rendu tient 30 img/s minimum

async function run() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur statique local démarré (serve.mjs)', up === true, `port=${port}`);
  const wsUrl = await launchEdge();
  await connectCdp(wsUrl);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitFor(`window.__game && window.__game.state ? window.__game.state.screen : null`, 30000, 'chargement du menu');
  await sleep(500);

  // (1) NOUVELLE PARTIE — touche N réelle (menu → jeu, aéroport fourni A-2).
  await key('n');
  await waitFor(`window.__game.state.screen === 'game'`, 10000, 'entrée en jeu');
  const s0 = await snap();
  check('nouvelle partie (touche N réelle, aéroport fourni)', s0.screen === 'game' && s0.time <= 2,
    `screen=${s0.screen} t=${s0.time}s`);

  // (2) VITESSE MAXIMALE — touche F réelle × 2 (x1 → x2 → x4) + auto-accept (A) :
  //     la sim déploie les vols → 5 minutes de JEU VIVANT (pas un écran figé).
  await key('f'); await sleep(100); await key('f');
  await key('a'); await sleep(100);
  const s1 = await snap();
  check('vitesse maximale x4 (touche F réelle × 2) + auto-accept ON (A)',
    s1.speed === 4 && !s1.paused, `speed=x${s1.speed} paused=${s1.paused}`);

  // Compteur de frames LECTURE-SEULE : un rAF dédié incrémente un compteur global
  // (jamais d'écriture sur l'état du jeu) — le QA le lit et le rézère chaque
  // seconde : 300 échantillons FPS sur les 5 minutes.
  await evaluate(`(() => { window.__bl17fps = 0; (function l() { window.__bl17fps++; requestAnimationFrame(l); })(); return true; })()`);
  const realT0 = Date.now();
  const simT0 = s1.time;
  const fpsSamples = []; // FPS par seconde (300 sur la session)
  const minuteSamples = []; // snapshot d'état par minute (stabilité)
  await shot('00-start.png');

  for (let i = 1; i <= DURATION_S; i++) {
    const fps = await evaluate(`(() => { const c = window.__bl17fps || 0; window.__bl17fps = 0; return c; })()`);
    fpsSamples.push(Number(fps) || 0);
    if (i % 60 === 0) { // 1 échantillon d'état par minute (t=60..300 s)
      const m = await snap();
      minuteSamples.push({ min: i / 60, ...m });
      await shot(`0${i / 60}-min${i / 60}.png`);
    }
    await sleep(1000); // 1 s RÉELLE : la session est calée sur l'horloge réelle
  }
  await shot('06-end.png');
  const realElapsedMs = Date.now() - realT0;
  const sEnd = await snap();

  // FPS : médiane des 300 échantillons (un pic ne doit PAS sauver une chute).
  const sorted = [...fpsSamples].sort((a, b) => a - b);
  const fpsMedian = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  check('session 5 minutes réelles exécutée (300 s wall clock)', fpsSamples.length === DURATION_S,
    `échantillons=${fpsSamples.length} réel=${(realElapsedMs / 1000).toFixed(1)}s`);
  check(`AC26/R3 FPS : médiane ≥ ${MIN_FPS} img/s sur 5 min (stabilité du rendu)`,
    fpsMedian >= MIN_FPS, `médiane=${fpsMedian} min=${sorted[0]} max=${sorted[sorted.length - 1]}`);

  // A-9 : le temps SIMULÉ et le temps RÉEL sont toujours distincts — la vitesse
  // x4 du jeu fait avancer la sim de ~4× le temps réel (jamais la même horloge).
  const simDelta = sEnd.time - simT0;
  const timeFactor = Math.round((simDelta / (realElapsedMs / 1000)) * 100) / 100;
  check('A-9 horloges distinctes : temps sim ≠ temps réel (facteur ≈ 4×, jamais = 1)',
    simDelta > 0 && Math.abs(timeFactor - 4) < 1,
    `sim=${simDelta}s réel=${(realElapsedMs / 1000).toFixed(1)}s facteur=${timeFactor}×`);

  // Stabilité sur toute la durée : pas de NaN (solde/passagers), le jeu n'est
  // jamais resté en pause, le transport a progressé (jeu vivant, x4 → 20 h sim).
  const finite = minuteSamples.every((m) => Number.isFinite(m.money) && Number.isFinite(m.carried) && !m.paused);
  check('stabilité : money/passagers FINIS + jamais en pause + jeu vivant (5 min)',
    finite && sEnd.carried > 0,
    `carried=${sEnd.carried} money=${Math.round(sEnd.money)} t=${sEnd.time}s`);

  // Captures d'état (preuve visuelle) : 5 captures par minute + start/fin,
  // toutes non vides (un canvas mort = PNG minuscule).
  const pngs = ['00-start.png', '01-min1.png', '02-min2.png', '03-min3.png', '04-min4.png', '05-min5.png', '06-end.png'];
  const sizes = pngs.map((p) => join(EVID, p)).filter((p) => existsSync(p)).map((p) => statSync(p).size);
  const nonEmpty = sizes.length === pngs.length && sizes.every((s) => s > 1000);
  check("captures d'état lisibles (7 PNG : start, 5 min, fin)", nonEmpty,
    pngs.map((p, i) => `${p}=${sizes[i] ?? 'absent'}o`).join(' '));

  // Stabilité des journaux : AUCUNE exception de page, AUCUN console.error.
  check('zéro exception de page sur 5 min', pageExceptions.length === 0,
    `exceptions=${pageExceptions.length}`, pageExceptions.slice(0, 3));
  check('zéro console.error sur 5 min', consoleErrors.length === 0,
    `errors=${consoleErrors.length}`, consoleErrors.slice(0, 3));

  // Rapport + verdict (le code retour porte le verdict).
  const failed = results.filter((r) => !r.ok);
  const txt = [
    `# BL-17 — rapport CDP 5 minutes (node qa/bl17-cdp.mjs)`,
    `Date : ${new Date().toISOString()}`,
    `Résultat : ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length}/${results.length})`,
    ``,
    ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`),
    ``,
    `FPS : médiane=${fpsMedian} (min=${sorted[0]} max=${sorted[sorted.length - 1]}, ${fpsSamples.length} échantillons/s)`,
    ``,
    `États par minute (t réel, x4) :`,
    ...minuteSamples.map((m) =>
      `min=${m.min} t=${m.time}s money=${Math.round(m.money)} carried=${m.carried} ac=${m.ac} paused=${m.paused} phases=${m.phases || 'aucun'}`),
    ``,
    `A-9 horloges : temps sim=${simDelta}s / temps réel=${(realElapsedMs / 1000).toFixed(1)}s → facteur ${timeFactor}× (vitesse x4 du jeu, jamais la même horloge)`,
  ].join('\n');
  writeFileSync(join(EVID, 'rapport.txt'), txt);
  writeFileSync(join(EVID, 'rapport.json'), JSON.stringify({
    date: new Date().toISOString(), result: failed.length ? 'FAIL' : 'PASS',
    results, fps: { median: fpsMedian, min: sorted[0], max: sorted[sorted.length - 1], samples: fpsSamples },
    minutes: minuteSamples,
    a9: { simTimeSec: simDelta, realElapsedMs, timeFactor },
    exceptions: pageExceptions, consoleErrors,
  }, null, 2));
  console.log(`\n=== ${failed.length ? 'FAIL' : 'PASS'} — ${results.length - failed.length}/${results.length} (evidence: evidence/bl-17/cdp-5min) ===`);
  return failed.length === 0;
}

try {
  const ok = await run();
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(`ÉCHEC session : ${e.message}`);
  writeFileSync(join(EVID, 'rapport.txt'), `# BL-17 CDP — échec session\n${new Date().toISOString()}\n${e.stack}\n`);
  process.exitCode = 1;
} finally {
  try { if (edgeProc) edgeProc.kill('SIGKILL'); } catch { /* déjà mort */ }
  try { server.kill(); } catch { /* déjà mort */ }
}
