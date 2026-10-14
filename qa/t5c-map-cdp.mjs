// T5c (t_bd4726e7) — CAPTURES CDP de la CARTE ENRICHIE « Radar Rétro »
// (Edge headless + CDP, 0 dépendance, Node >= 22).
//
// Écrans capturés (jeu réel du working-tree, serve.mjs) :
//   1. menu       — l'écran-titre SCOPE radar (bol + cibles + balayage +
//                    balises + statique ; le menu EST le scope, T5c).
//   2. jeu-defaut — l'aéroport CAP NORD (scénario pré-construit : 2 pistes
//                    phosphore, 3 taxiways, terminal 4 portes, tour, feux)
//                    au zoom par défaut, blips radar en cours de cycle.
//   3. jeu-zoom   — zoom 1.3 (details : marquages de seuil, désignateurs,
//                    feux de bords ambre, point d'attente, étiquettes 12px,
//                    portes G1–G4 + passerelles + n°, tour de contrôle,
//                    tags radar des avions, traînées).
//   4. jeu-pluie  — pluie déterministe (maquette : streaks screen-space).
//
// DETERMINISME (pas d'horloge murale dans les captures) :
//   - le scénario capNord impose seed + budget (scenarios.mjs) ;
//   - 2 blips FORCÉS en constantes (MÊME forme que makeAircraft,
//     flights.mjs — le pattern est prouvé par qa/cdp-boot.mjs) ;
//   - la sim avance d'EXACTEMENT 900 ticks de 1 s (tick du même pipeline
//     que la boucle) — les positions au moment des captures sont
//     reproductibles ;
//   - la pluie est posée par le HARNESS (mutation de test sim.weather —
//     le RENDERER reste en lecture seule, discipline T5c) ;
//   - la sim est PAUSÉE avant chaque capture (le rendu rAF tourne, le
//     temps sim non).
// Sortie : evidence/t5c-map-cdp/*.png (nom horodaté) + rapport
//          qa/t5c-map-cdp-report.json. Exit 0 = PASS (4 captures + 0
//          exception console + ≥1 avion au moment des captures).
// Usage  : node qa/t5c-map-cdp.mjs
import { spawn, execSync } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const port = freePort();
const server = spawn(process.execPath, ['serve.mjs'], { cwd: REPO, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });

async function startBrowser(cdpPort, userDataDir) {
  const edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,768',
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
function cdpSession(ws) {
  const pending = new Map(); let seq = 0; const handlers = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); return; }
    for (const h of handlers) h(msg);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout ' + method)); } }, 30000);
  });
  return { send, on: (h) => handlers.push(h) };
}
async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url }).catch(() => {});
  await waitFor(cdp, 'document.readyState === "complete"', 15000);
}
async function waitFor(cdp, expr, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const m = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }).catch(() => null);
    if (m?.result?.result?.value) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(300);
  }
}
async function evaluate(cdp, expr, awaitPromise = false) {
  const m = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  return m?.result?.result?.value;
}

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const EV = join(REPO, 'evidence', 't5c-map-cdp');
mkdirSync(EV, { recursive: true });
const captures = [];
function savePng(name, b64) {
  const p = join(EV, `t5c-map-cdp-${TS}-${name}.png`);
  writeFileSync(p, Buffer.from(b64, 'base64'));
  const st = statSync(p);
  captures.push({ name, path: p, bytes: st.size, kb: Math.round(st.size / 102.4) / 10 });
  console.log(`  capture ${name} → ${p} (${Math.round(st.size / 102.4) / 10} Ko)`);
}

async function main() {
  if (!await httpProbe(`http://127.0.0.1:${port}/`)) { console.error('serveur down'); server.kill(); process.exit(1); }
  const cdpPort = freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), 'at-t5c-br-'));
  const b = await startBrowser(cdpPort, userDataDir);
  if (!b) { console.error('Edge down'); server.kill(); process.exit(1); }
  const ws = new WebSocket(b.target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  const cdp = cdpSession(ws);
  // Suivi des erreurs console (attendu : 0 — la carte enrichie ne lève rien)
  const consoleErrors = [];
  let phase = 'boot';
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push({ phase, text: m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.description || '') });
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push({ phase, text: (m.params.args || []).map((a) => a.description || a.value || '').join(' ') });
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // ---- 1. MENU : le scope radar phosphore (écran-titre T5c) ----
  phase = 'menu';
  console.log('\n=== 1. MENU (scope radar) ===');
  await navigate(cdp, `http://127.0.0.1:${port}/`);
  if (!await waitFor(cdp, 'window.__game && typeof window.__game.startNewGame === "function"', 20000)) {
    console.error('le jeu n\'a pas booté (window.__game absent)'); process.exit(1);
  }
  await sleep(1800); // balayage du scope animé (1,8 s de rAF pour figurer
  // un balayage non trivial — délai fixe, déterministe)
  savePng('menu', (await cdp.send('Page.captureScreenshot', { format: 'png' })).result.data);

  // ---- 2. SCÉNARIO CAP NORD : aéroport pré-construit (piste 800 L-capable) ----
  phase = 'capnord';
  console.log('\n=== 2. CAP NORD (aéroport fourni) ===');
  const launched = await evaluate(cdp, `(() => {
    const cap = [...document.querySelectorAll('.menu-btns button')].find((b) => b.textContent.includes('Cap Nord'));
    if (!cap) return { noBtn: true };
    cap.click();
    return { clicked: true };
  })()`, false);
  if (launched?.noBtn) { console.error('bouton « Cap Nord » introuvable'); process.exit(1); }
  if (!await waitFor(cdp, 'window.__game.state.screen === "game" && window.__game.state.sim', 20000)) {
    console.error('le scénario capNord ne s\'est pas lancé'); process.exit(1);
  }
  // --- blips FORCÉS (constantes — MÊME forme que makeAircraft, flights.mjs)
  // + ticks du pipeline réel (tick.mjs) calibrés sur les vitesses sim
  // (approach 220 u/s, landing 130, taxi 60 — V de aircraft.mjs) :
  //   • lot 1 (2 avions) : 300 ticks (5 min sim) → cycle complet → au sol
  //     (portes / ground) ;
  //   • lot 2 (1 avion) : 3 ticks → à l'atterrissage / en roulage ;
  //   • lot 3 (1 avion) : 1 tick  → EN AIR (approche, traînée visible).
  // Déterministe (seed du scénario + pas d'horloge murale). La sim est
  // PAUSÉE avant les captures : les captures sont figées.
  const simOut = await evaluate(cdp, `(async () => {
    const g = window.__game;
    const { tick } = await import('./src/core/tick.mjs');
    const sim = g.state.sim;
    const mk = (n) => ({
      id: sim.nextAcId++, airline: n.airline, color: n.color, acType: n.acType, pax: n.pax,
      phase: 'approach', x: n.x, y: n.y, gateId: null, runwayId: null,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
    sim.aircraft.push(
      mk({ airline: 'pacific',    color: '#43a047', acType: 'large',  pax: 220, x: 590, y: 30 }), // B747
      mk({ airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 80,  x: 350, y: 60 }), // A320
    );
    g.state.paused = false;
    for (let i = 0; i < 300; i++) tick(g.state, 1); // 5 min sim — cycle lot 1
    sim.aircraft.push(mk({ airline: 'pacific', color: '#43a047', acType: 'medium', pax: 80, x: 700, y: 30 }));
    for (let i = 0; i < 3; i++) tick(g.state, 1);   // atterrissage / roulage
    sim.aircraft.push(mk({ airline: 'atlantique', color: '#1e88e5', acType: 'small', pax: 40, x: 500, y: 20 }));
    for (let i = 0; i < 1; i++) tick(g.state, 1);   // en air (approche)
    g.state.paused = true; // PAUSE : la capture est figée (le rendu tourne)
    return {
      aircraft: sim.aircraft.map((a) => ({ phase: a.phase, x: Math.round(a.x), y: Math.round(a.y), gate: a.gateId != null })),
      runways: sim.infra.runways.length, gates: sim.infra.gates.length,
    };
  })()`, true);
  if (!simOut) { console.error('les blips forcés n\'ont pas été exécutés'); process.exit(1); }
  console.log(`  ${simOut.aircraft.length} avion(s) — phases : ${simOut.aircraft.map((a) => a.phase).join(', ') || 'vide'}`);

  // ---- 3. JEU au zoom par défaut ----
  phase = 'jeu-defaut';
  console.log('\n=== 3. JEU (zoom par défaut) ===');
  await sleep(400); // le rendu suit la caméra/pause (délai fixe, déterministe)
  savePng('jeu-defaut', (await cdp.send('Page.captureScreenshot', { format: 'png' })).result.data);

  // ---- 4. JEU ZOOM (détails : seuils, désignateurs, feux, portes, tour, tags) ----
  phase = 'jeu-zoom';
  console.log('\n=== 4. JEU (zoom 1.6 centré terminal — détails) ===');
  // zoom + RECADRAGE sur le terminal (le centre du viewport = le centre du
  // terminal, state.camera en LECTURE/écriture du seul état caméra — pas de
  // mutation de la sim ; le harness pose la vue). Sans recadrage, zoomer
  // autour du centre du monde met l'aéroport (coin sud-ouest) HORS CHAMP.
  await evaluate(cdp, `(async () => {
    const g = window.__game;
    const cam = g.state.camera;
    const t = g.state.sim.infra.terminals[0];
    cam.x = t.x + t.w / 2; cam.y = t.y + t.h / 2;
    cam.zoom = 1.6;
    return true;
  })()`, true);
  await sleep(400);
  savePng('jeu-zoom', (await cdp.send('Page.captureScreenshot', { format: 'png' })).result.data);

  // ---- 4b. JEU ZOOM PISTE (détails : seuils piano, désignateurs, feux,
  //          silhouettes des arrivées, tags radar, scope) : le zoom ci-dessus
  //          (1.6) cadre le terminal ; les EXTRÉMITÉS HAUTES des pistes
  //          (y≈100) et les avions d'approche (y 100-300) sont HORS CHAMP —
  //          un second cadrage (centre nord, même zoom) les montre. Camera
  //          seule mutée.
  phase = 'jeu-zoom-piste';
  console.log('\n=== 4b. JEU (zoom 1.6 centré nord — extrémités hautes + arrivées) ===');
  await evaluate(cdp, `(async () => {
    const g = window.__game;
    const cam = g.state.camera;
    // T5c : cadrage SUIVANT les extrémités hautes R1/R2 (y≈100) — zoom 1.6,
    // centre nord. cam.x=500 (PAS 440/470) : le désignateur « 18 » de R1 est
    // posé à x+w+6 (côté DROIT de la piste, convention ICAO) — aux cam.x trop
    // faibles il tombait SOUS le panneau DOM « Vols » (x≈930) du viewport.
    // x=500 le recentre à ~x901, hors du panneau ; cam.y=140 recentre
    // verticalement les extrémités hautes (y écran ~271).
    cam.x = 500; cam.y = 140; // centre nord du layout capNord (extrémités hautes R1/R2 + couloir d'approche)
    cam.zoom = 1.6;
    return true;
  })()`, true);
  await sleep(400);
  savePng('jeu-zoom-piste', (await cdp.send('Page.captureScreenshot', { format: 'png' })).result.data);

  // ---- 5. JEU PLUIE (précipitations screen-space — maquette) ----
  phase = 'jeu-pluie';
  console.log('\n=== 5. JEU (pluie — mutation de test du harness) ===');
  // Le HARNESS pose l'état météo (le renderer reste en LECTURE SEULE) ;
  // 3 ticks supplémentaires avancent state.time → la pluie a un motif propre.
  await evaluate(cdp, `(async () => {
    const g = window.__game;
    const { tick } = await import('./src/core/tick.mjs');
    g.state.sim.weather = { state: 'rain', remaining: 9999 };
    g.state.paused = false;
    for (let i = 0; i < 3; i++) tick(g.state, 1);
    g.state.paused = true;
    return true;
  })()`, true);
  await sleep(400);
  savePng('jeu-pluie', (await cdp.send('Page.captureScreenshot', { format: 'png' })).result.data);

  ws.close();
  const head = execSync(`git -C ${REPO} rev-parse HEAD`, { stdio: 'pipe' }).toString().trim();
  const pass = captures.length === 5 && consoleErrors.length === 0 && simOut.aircraft.length >= 1;
  const report = {
    ts: new Date().toISOString(), head, pass,
    scenario: 'capNord',
    aircraft: simOut.aircraft,
    captures,
    consoleErrors,
    note: 'captures DÉTERMINISTES : scénario capNord (seed + budget imposés) + 2 blips forcés (constantes, forme makeAircraft) + 900 ticks de 1 s du pipeline réel (tick.mjs) ; sim pausée avant chaque capture (le rendu rAF tourne, le temps sim non). Zooms RECADRÉS (terminal, puis centre nord) et pluie posés par le harness (state.camera, sim.weather) — le renderer reste en lecture seule. 5 captures : menu (scope), jeu-defaut (vue entière : silhouettes, tags, scope), jeu-zoom (zoom 1.6 centré terminal : fenêtres, portes G1-G4, tour, points d’attente), jeu-zoom-piste (zoom 1.6 centré nord : extrémités hautes R1/R2 — seuils piano, désignateurs, feux, ligne de centre — + avion en approche avec tag radar), jeu-pluie (streaks screen-space).',
  };
  const rp = join(REPO, 'qa', 't5c-map-cdp-report.json');
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(`\nT5c MAP CDP : ${pass ? 'PASS' : 'FAIL'} (${captures.length}/5 captures, ${consoleErrors.length} erreur console, ${simOut.aircraft.length} avion) — rapport ${rp}`);
  if (!pass) { for (const e of consoleErrors) console.log('  console[' + e.phase + ']', e.text); }
  b.proc.kill(); server.kill();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('ERREUR T5c CDP :', e); server.kill(); process.exit(1); });
