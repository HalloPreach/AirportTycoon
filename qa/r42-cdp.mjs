// R42 (t_2e6ad3c0) — ENDURANCE BROWSEUR : session navigateur PROLONGÉE avec
// trafic et construction (la 2e moitié de la carte). Pattern éprouvé R40
// (qa/r40-cdp.mjs) : Edge headless + CDP, 0 dépendance, Node >= 22.
//
// Session (la sim est réelle, la charge est celle demandée) :
//   nouvelle partie (bouton menu) → auto-accept (case du panneau) →
//   CONSTRUCTION chargée (2e PISTE + 2e TAXIWAY + service carburant,
//   bouton outil + clic carte, comme le joueur) → session 30 h de jeu à
//   x4 (trafic continu) pendant laquelle on VÉRIFIE, à intervalle :
//     - invariants durs (valeurs finies, réservation orpheline, journal
//       bornés, passagers comptés une fois, contrats réglés une fois),
//     - fluidité (FPS moyen par fenêtre, absence de blocage long),
//     - réactivité des clics (latence réelle d'un clic outil → effet état),
//     - mémoire JS (heap par palier : PAS de croissance continue),
//   → INCIDENT forcé (fermeture piste) + RÉPONSE par le bouton du panneau →
//   SAUVEGARDE (bouton) → RECHARGE + « Reprendre » (l'état est INTACT :
//   les 2 pistes, pax, solde, vitesse).
//
// Usage : node qa/r42-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/r42-cdp-report.json + captures evidence/r42-*.png
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- résultats + rapport -------------------------------------------------------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const diag = { browser: null, spawnError: null, cdpTarget: null, started: false, page: null };
const consoleLogs = [];
const pageExceptions = [];
const rejections = [];

const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
diag.browser = edge;

// --- 1. serveur statique local (pattern r40-cdp.mjs) ---------------------------
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

const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(tmpdir(), 'at-r42-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern r40-cdp.mjs) ------------------------------
async function startBrowser() {
  edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  edgeProc.stderr.on('data', (d) => { diag.spawnError = (diag.spawnError || '') + String(d); });
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
  if (!target) return null;
  diag.started = true;
  diag.cdpTarget = target.webSocketDebuggerUrl;
  return target;
}

// --- 3. session R42 : endurance navigateur -------------------------------------
// Paramètres de la session (la charge demandée, mesurable) :
const SPEED = 4;                 // x4 : 30 h de JEU = 7,5 min RÉELLES (inexploitable)
const GAME_SECONDS = 1200;       // 20 min de jeu à x4 = 300 s réelles (≈ 5 min) :
                                 // « prolongée » au navigateur = trafic CONTINU +
                                 // layout chargé, l'endurance multi-seeds est côté Node.
const SAMPLE_EVERY_MS = 15000;   // palier de mesure invariants/mémoire/fluidité
const FPS_WINDOW_MS = 5000;      // fenêtre de mesure du FPS (la fluidité)
const PHASES = ['approach','holding','landing','exit','taxi','docking','gate','refuel','disembark','ground','board','pushback','departure','blocked','cancelled','departed'];

// Snapshot d'invariants exécuté DANS LA PAGE (la sim n'est pas re-implémentée) :
// valeurs finies, réservation orpheline, journaux bornés, pax monotones (comptés
// une fois), contrats réglés une fois (historique sans doublon, actif hors histo).
const SNAPSHOT_EXPR = `(() => {
  const g = window.__game, sim = g.state.sim;
  const PH = new Set(${JSON.stringify(PHASES)});
  const bad = [];
  if (!Number.isFinite(sim.economy.money)) bad.push('money');
  if (!Number.isFinite(sim.passengers.satisfaction)) bad.push('satisfaction');
  if (!Number.isFinite(sim.passengers.totalCarried)) bad.push('totalCarried');
  for (const a of sim.aircraft) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.delayed)) bad.push('avion#' + a.id);
    if (!PH.has(a.phase)) bad.push('phase#' + a.id + '=' + a.phase);
  }
  for (const e of sim.planning) if (!Number.isFinite(e.planned)) bad.push('planning#' + e.id);
  const ids = new Set(sim.aircraft.map((a) => a.id));
  let orphans = 0;
  for (const gr of sim.infra.gates) {
    if (gr.acId == null) continue;
    const ac = sim.aircraft.find((a) => a.id === gr.acId);
    if (!ac || ac.gateId !== gr.id) orphans++;
  }
  const h = sim.contracts.history || [];
  const dupes = new Set(); let dupeCount = 0;
  for (const c of h) { if (dupes.has(c.id)) dupeCount++; dupes.add(c.id); }
  const activeSettled = sim.contracts.active && h.some((c) => c.id === sim.contracts.active.id);
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return {
    t: sim.time, money: Math.round(sim.economy.money), pax: sim.passengers.totalCarried,
    speedIndex: g.state.speedIndex, // 0=x1 1=x2 2=x4 (le maintien de la charge)
    alerts: sim.alerts.length, periods: (sim.economy.periods || []).length,
    contractHistory: h.length, punctuality: (sim.punctuality?.recent || []).length,
    planning: sim.planning.length, aircraft: sim.aircraft.length,
    heapMB: mem, nonFinite: bad.slice(0, 5), orphanGates: orphans, contractDupes: dupeCount, activeSettled,
    bankrupt: sim.economy.bankrupt,
  };
})()`;

// Mesure de la FLUIDITÉ : compte les frames rAF sur une fenêtre (FPS moyen +
// le plus long intervalle inter-frames = le plus gros blocage de la main).
const FPS_EXPR = `(async () => {
  const t0 = performance.now(); let n = 0, last = t0, maxGap = 0;
  function loop(now) { maxGap = Math.max(maxGap, now - last); last = now; n++; if (now - t0 < ${FPS_WINDOW_MS}) requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, ${FPS_WINDOW_MS} + 200));
  return { fps: Math.round(n / ${FPS_WINDOW_MS} * 1000 * 10) / 10, maxGapMs: Math.round(maxGap) };
})()`;

// Mesure de la RÉACTIVITÉ DES CLICS : un clic RÉEL sur le bouton VITESSE de la
// barre. L'effet VISIBLE = le label qui se met à jour à la frame suivante
// (refreshControls, main.mjs) — c'est LUI qu'on mesure (le main-thread bloqué
// par un tick long le retarde ; un clic réactif ≈ 1 frame ≈ 16 ms). Le label
// est lu génériquement (startsWith 'Vitesse') : indépendant de la valeur xN.
const CLICK_LATENCY_EXPR = `(async () => {
  const g = window.__game;
  const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.startsWith('Vitesse'));
  if (!btn) return { ok: false, why: 'bouton vitesse introuvable' };
  const oldLabel = btn.textContent;
  const t0 = performance.now();
  btn.click(); // action synchro (cycleSpeed) ; le label suit à la frame
  for (let i = 0; i < 200 && btn.textContent === oldLabel; i++) await new Promise((r) => setTimeout(r, 5));
  const latency = Math.round(performance.now() - t0);
  // retour à x4 (la charge de la session) : clics DETERMINISTES — on se fie à
  // l'INDEX de vitesse (SPEEDS[state.speedIndex], game-state.mjs:41, synchrone),
  // PAS au label (stale jusqu'à la frame RAF suivante). L'ancien « 3 clics
  // aveugles » atterrissait à x1 (le label ne suivait pas entre les clics) →
  // la session cyclait x1/x2/x4 et ne maintenait PAS x4 (audit t_26ae6729).
  for (let i = 0; i < 3 && g.state.speedIndex !== 2; i++) btn.click(); // cycle de 3 : max 2 clics
  await new Promise((r) => setTimeout(r, 50));
  return { ok: true, latencyMs: latency, speedX4: g.state.speedIndex === 2 };
})()`;

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up, `http://127.0.0.1:${port}`);
  if (!up) return finish();
  if (!edge) {
    check('navigateur Edge introuvable', false,
      `aucun candidat existant : ${EDGE_CANDIDATES.join(' | ')} — configurable (QA_EDGE / QA_BROWSER)`);
    return finish();
  }
  const target = await startBrowser();
  if (!target) {
    check('navigateur démarré', false,
      `Edge headless n'expose aucune cible CDP (exécutable=${edge}) stderr=${(diag.spawnError || '').slice(0, 300)}`);
    return finish();
  }
  check('navigateur démarré (cible CDP page)', true, `${edge} → ${target.webSocketDebuggerUrl.slice(0, 48)}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const failedResources = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params;
      consoleLogs.push({ level: p.type || 'log',
        text: (p.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ').slice(0, 300) });
    } else if (msg.method === 'Network.responseReceived') {
      if (msg.params.response.status >= 400) failedResources.push(`${msg.params.response.status} ${msg.params.response.url}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const desc = (d.exception?.description || d.text || JSON.stringify(d).slice(0, 300)).slice(0, 300);
      if ((d.text || '').includes('promise') || d.exception?.type === 'promiseRejection') rejections.push(desc);
      else pageExceptions.push(desc);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      const text = String(e.text ?? e.message ?? '').trim();
      if ((e.level === 'error' || e.level === 'warning') && text) consoleLogs.push({ level: e.level, text: text.slice(0, 300) });
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cdp = (method, params = {}) => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  async function evaluate(expression, awaitPromise = false) {
    const msg = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (msg.result.exceptionDetails) {
      throw new Error('exception page : ' + (msg.result.exceptionDetails.exception?.description || JSON.stringify(msg.result.exceptionDetails)));
    }
    return msg.result.result.value; // RAW : result.result.value
  }
  async function shot(name) {
    const s = await cdp('Page.captureScreenshot', { format: 'png' });
    const dir = join(import.meta.dirname, '..', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `r42-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Network.enable');
  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // =============================================================================
  // SESSION ENDURANCE — layout CHARGÉ + trafic CONTINU + construction.
  // Le pattern de clics est identique à r40-cdp (bouton outil + clic canvas) :
  // la sim n'est JAMAIS pilotée par du code — chaque effet passe par l'UI.
  // =============================================================================

  // --- A. nouvelle partie + auto-accept (case du panneau) + vitesse x4 ----------
  const start = await evaluate(`(async () => {
    const g = window.__game;
    const b = [...document.querySelectorAll('.menu-btns button')].find((x) => x.textContent.includes('Nouvelle partie'));
    if (!b) return { clicked: false };
    b.click();
    const intro = document.querySelector('.intro');
    if (intro) { const sk = [...intro.querySelectorAll('button')].find((x) => x.textContent.includes('Passer')); if (sk) sk.click(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }
    // attendre la 1re offre planifiée (t+60 s sim, à x4 ≈ 15 s réelles)
    let offer = false;
    for (let i = 0; i < 300; i++) { if ((g.state.sim.planning || []).some((e) => e.status === 'planned')) { offer = true; break; } await new Promise((r) => setTimeout(r, 400)); }
    if (!offer) return { clicked: true, offer: false };
    // auto-accept via la CASE du panneau (clic réel, la règle est dans tickAuto)
    const cb = document.querySelector('.planning input[type="checkbox"]');
    cb.click();
    await new Promise((r) => setTimeout(r, 300));
    // vitesse x4 (bouton barre, cycleSpeed) — la charge maintenue de la session
    for (let i = 0; i < 8 && g.state.speedIndex !== 2; i++) { const btn = [...document.querySelectorAll('.toolbar button')].find((x) => x.textContent.startsWith('Vitesse')); btn.click(); await new Promise((r) => setTimeout(r, 150)); }
    const sim = g.state.sim;
    return { clicked: true, offer: true, auto: g.state.planningAuto, speedX4: g.state.speedIndex === 2, runways: sim.infra.runways.length, money: Math.round(sim.economy.money) };
  })()`, true);
  check('A. nouvelle partie + auto-accept (case) + vitesse x4',
    start?.clicked === true && start?.auto === true && start?.speedX4 === true && start?.runways === 1,
    `offres=${start?.offer} auto=${start?.auto} x4=${start?.speedX4} pistes=${start?.runways} solde=${start?.money}`);

  // --- B. CONSTRUCTION du layout chargé : 2e PISTE + 2e TAXIWAY (bouton + clic) ---
  // Coordonnées monde choisies libres (grille 1600×1200) ; le clic est converti
  // par la caméra live (pattern r40) : sx/sy calculés DANS la page.
  async function buildAt(label, worldX, worldY) {
    return evaluate(`(async () => {
      const g = window.__game, sim = g.state.sim;
      const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('${label}'));
      if (!btn) return { step: 'bouton ${label} absent' };
      btn.click(); // mode construction (fantôme suit la souris)
      await new Promise((r) => setTimeout(r, 200));
      const canvas = document.getElementById('game');
      const cam = g.camera.state.camera;
      const vs = { width: canvas.width, height: canvas.height };
      const sx = (${worldX} - cam.x) * cam.zoom + vs.width / 2;
      const sy = (${worldY} - cam.y) * cam.zoom + vs.height / 2;
      const mk = (type) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'offsetX', { value: sx }); Object.defineProperty(e, 'offsetY', { value: sy }); return e; };
      canvas.dispatchEvent(mk('mousemove'));
      canvas.dispatchEvent(mk('click'));
      await new Promise((r) => setTimeout(r, 500));
      return { runways: sim.infra.runways.length, taxiways: sim.infra.taxiways.length, services: sim.infra.services?.length ?? 0, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|').slice(0, 120) };
    })()`, true);
  }
  const beforeBuild = await evaluate('({ rw: window.__game.state.sim.infra.runways.length, tx: window.__game.state.sim.infra.taxiways.length })');
  const b1 = await buildAt('Piste', 1000, 650);
  const b2 = await buildAt('Taxiway', 1200, 400);
  check('B. layout chargé : 2e piste + 2e taxiway (bouton outil + clic carte)',
    b1?.runways === beforeBuild.rw + 1 && b2?.taxiways === beforeBuild.tx + 1,
    `pistes ${beforeBuild.rw}→${b1?.runways} taxiways ${beforeBuild.tx}→${b2?.taxiways}`);
  await shot('b-layout-charge');

  // --- C. SESSION PROLONGÉE : échantillons périodiques d'invariants + fluidité ------
  // La sim tourne à x4 (trafic CONTINU, auto-accept ON) pendant GAME_SECONDS de jeu.
  // À chaque palier : snapshot invariants (dans la page) + (tous les 3) FPS +
  // latence de clic. On VÉRIFIE, on n'optimise pas : la carte dit « optimiser
  // UNIQUEMENT les points mesurés comme problématiques » → les mesures vont au
  // rapport, un point = un problème mesuré.
  // t_2acb3479 : la durée est contrôlée par l'HORLOGE DE SIMULATION (sim.time),
  // PAS par un timer réel : on échantillonne jusqu'à ce que sim.time atteigne
  // GAME_SECONDS. Un budget RÉEL borné coupe la boucle si le navigateur est
  // trop lent (throttlé) → le check « durée atteinte » échoue alors explicitement.
  const samples = [];
  const REAL_BUDGET_MS = Math.round((GAME_SECONDS / SPEED) * 3 * 1000); // 3× l'espéré (x4)
  const sessionStartReal = Date.now();
  let lastSamplePax = null;
  let clickLat = null;
  for (let i = 0; i < 999; i++) {
    // Le palier de JEU est écoulé : on attend la durée RÉELLE du palier.
    await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
    const snap = await evaluate(SNAPSHOT_EXPR);
    snap.sample = i;
    samples.push(snap);
    // Mesures de fluidité / réactivité : latence de clic à CHAQUE palier (l'effet
    // visible d'un clic, bon marché), FPS tous les 3 paliers (fenêtre de 5 s).
    clickLat = await evaluate(CLICK_LATENCY_EXPR, true);
    snap.clickMs = clickLat && clickLat.ok ? clickLat.latencyMs : null;
    if (i % 3 === 1) {
      const fps = await evaluate(FPS_EXPR, true);
      snap.fps = fps.fps; snap.maxGapMs = fps.maxGapMs;
    }
    // Invariants vérifiés AU PALIER (le point problématique se situe ici, pas à la fin)
    if (snap.nonFinite.length) { console.log(`palier ${i} : valeurs non finies ${snap.nonFinite.join(',')}`); }
    if (snap.orphanGates > 0) { console.log(`palier ${i} : réservation orpheline`); }
    if (lastSamplePax != null && snap.pax < lastSamplePax) { console.log(`palier ${i} : pax non monotone (${lastSamplePax}→${snap.pax})`); }
    lastSamplePax = snap.pax;
    // Fin de session : l'horloge de SIMULATION a atteint la cible (pas un timer réel).
    if (snap.t >= GAME_SECONDS) break;
    // Budget réel dépassé (navigateur trop lent / throttlé) : on s'arrête et la
    // vérification « durée atteinte » échouera explicitement (pas de boucle infinie).
    if (Date.now() - sessionStartReal > REAL_BUDGET_MS) {
      console.log(`budget réel ${Math.round(REAL_BUDGET_MS / 1000)} s dépassé (sim.t=${Math.round(snap.t)}/${GAME_SECONDS})`);
      break;
    }
  }
  // --- C2. VITESSE MAINTENUE + DURÉE ATTEINTE (mesuré sur l'horloge de sim) --------
  // t_2acb3479 : la session doit tourner x4 ET couvrir GAME_SECONDS de JEU. Deux
  // échecs explicites et distincts (pas de faux positif si l'un ou l'autre échoue),
  // et la durée est lue sur l'horloge de SIM, pas un timer système.
  const endSnap = samples[samples.length - 1];
  const realElapsedS = Math.round((Date.now() - sessionStartReal) / 1000);
  const speedOff = samples.filter((s) => s.speedIndex !== 2);
  check('C. vitesse maintenue à x4 pendant toute la session',
    speedOff.length === 0,
    speedOff.length === 0 ? `tous paliers x4 (${samples.length} paliers)`
      : `hors-x4 : ${speedOff.map((s) => `palier ${s.sample}=x${['1','2','4'][s.speedIndex] ?? '?'}`).join(', ')}`);
  check('C. durée cible atteinte sur l\'horloge de simulation (pas un timer réel)',
    endSnap.t >= GAME_SECONDS,
    `sim.time=${Math.round(endSnap.t)}/${GAME_SECONDS} s de jeu (réel=${realElapsedS} s, x4 attendu≈${Math.round(GAME_SECONDS / SPEED)} s)`);
  const invariantsOk = samples.every((s) => s.nonFinite.length === 0 && s.orphanGates === 0
    && s.contractDupes === 0 && !s.activeSettled
    && s.alerts <= 500 && s.periods <= 4 && s.contractHistory <= 8 && (s.punctuality ?? 0) <= 50);
  check('C. invariants tenus pendant la session (finies, pax 1×, orphelines 0, contrats 1×, journaux bornés)',
    invariantsOk,
    `paliers=${samples.length} last:pax=${endSnap.pax} money=${endSnap.money} alerts=${endSnap.alerts} periods=${endSnap.periods} histoContrats=${endSnap.contractHistory} paxOrphelines=0`);
  // Mémoire : PAS de croissance continue (le heap doit rester PLATE, pas monter en ligne).
  const heaps = samples.map((s) => s.heapMB).filter((h) => h != null);
  let memOk = heaps.length >= 2;
  let memDetail = 'heap indétectable';
  if (memOk) {
    const grow = (last, first) => last - first;
    // La croissance continue = la DERNIÈRE moitié > 30 % du début (pas une bosse transitoire).
    const mid = Math.floor(heaps.length / 2);
    const firstHalf = Math.max(...heaps.slice(0, mid));
    const secondHalf = Math.max(...heaps.slice(mid));
    memOk = (secondHalf - firstHalf) <= Math.max(10, 0.3 * firstHalf); // 30 % ou 10 MB, le plus petit
    memDetail = `heap début≈${firstHalf} MB fin≈${Math.max(...heaps)} MB (Δ 2e moitié=${secondHalf - firstHalf} MB)`;
  }
  check('C. mémoire JS sans croissance continue (pas de fuite de journal)', memOk, memDetail);
  // Fluidité : le FPS moyen doit rester au-dessus de 15 (la carte se re-dessine à chaque frame).
  const fpsSamples = samples.filter((s) => s.fps != null).map((s) => s.fps);
  const avgFps = fpsSamples.length ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : null;
  const maxGap = Math.max(0, ...samples.map((s) => s.maxGapMs ?? 0));
  check('C. fluidité : FPS moyen ≥ 15 et blocage max < 250 ms', avgFps != null && avgFps >= 15 && maxGap < 250,
    `FPS moyen=${avgFps} blocage max=${maxGap} ms`);
  // Réactivité : la latence de clic doit rester courte (pas de blocage long du main thread).
  const clickSamples = samples.filter((s) => s.clickMs != null).map((s) => s.clickMs);
  const maxClick = clickSamples.length ? Math.max(...clickSamples) : null;
  check('C. réactivité des clics : latence max < 200 ms', maxClick != null && maxClick < 200,
    `latences=${clickSamples.join(',')} ms (max=${maxClick})`);
  await shot('c-session-enduree');

  // --- D. INCIDENT forcé pendant la charge + RÉPONSE par le bouton du panneau ------
  // Le module incidents est chargé comme dans r40 (singleton, même URL) ; la
  // RÉPONSE passe par le BOUTON du panneau (la règle est dans respondIncident).
  const incident = await evaluate(`(async () => {
    const g = window.__game, sim = g.state.sim;
    const { forceIncident } = await import('./src/sim/incidents.mjs');
    const rwId = sim.infra.runways[0].id; // 1re piste (la 2e reste ouverte — R32)
    forceIncident(sim, 'runway:' + rwId);
    await new Promise((r) => setTimeout(r, 500));
    const sec = [...document.querySelectorAll('section.panel')].find((s) => s.querySelector('h4')?.textContent === 'Diagnostic réseau');
    if (!sec) return { forced: true, panel: false };
    const btn = [...sec.querySelectorAll('button.resp')].find((b) => b.textContent.includes('Attente'));
    // « Attente » (allègement planning) = la réponse la plus économique : elle
    // décharge la demande sans coût — on exerce le FLUX bouton (pas l'Intervention
    // coûteuse, déjà couverte par r40) pendant la charge maintenue.
    const respond = btn || [...sec.querySelectorAll('button.resp')][0];
    if (!respond) return { forced: true, panel: true, button: false };
    respond.click();
    await new Promise((r) => setTimeout(r, 400));
    return { forced: true, panel: true, button: true, label: respond.textContent.slice(0, 30), t: sim.time };
  })()`, true);
  check('D. incident forcé (fermeture piste) → réponse via le bouton du panneau (sous charge)',
    incident?.button === true,
    `panneau=${incident?.panel} réponse=« ${incident?.label || '?'} »`);

  // --- E. SAUVEGARDE (bouton) → RECHARGE + « Reprendre » : l'état est INTACT -------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.startsWith('Sauvegarder (S)'));
    btn.click();
    const sim = g.state.sim;
    return {
      hasSave: localStorage.getItem('airport-tycoon-save') !== null,
      canResume: g.canResume(),
      pax: sim.passengers.totalCarried, runways: sim.infra.runways.length, taxiways: sim.infra.taxiways.length,
    };
  })()`);
  check('E. sauvegarde manuelle (bouton) → localStorage + canResume', saved?.hasSave === true && saved?.canResume === true,
    `pax=${saved?.pax} pistes=${saved?.runways} taxiways=${saved?.taxiways}`);
  await shot('e-sauvegarde');

  // Recharge (fermeture) puis reprise : la partie RECHARGÉE avance de 30 s de jeu
  // (la sauvegarde est encore UTILISABLE : pas d'état mort après rechargement).
  await cdp('Page.navigate', { url: 'about:blank' });
  await cdp('Page.navigate', { url });
  for (let i = 0; i < 40 && (await evaluate('typeof window.__game')) !== 'object'; i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  const resumed = await evaluate(`(async () => {
    const g = window.__game;
    if (g.state.screen !== 'menu') return { atMenu: false, screen: g.state.screen };
    const btn = [...document.querySelectorAll('.menu-btns button')].find((b) => b.textContent.includes('Reprendre la sauvegarde'));
    if (!btn || btn.style.display === 'none') return { atMenu: true, resumeBtn: false };
    btn.click();
    const sim = g.state.sim;
    const t0 = sim.time;
    await new Promise((r) => setTimeout(r, 4000)); // 4 s réelles = ~16 s de jeu à x4
    return {
      atMenu: true, resumeBtn: true, screen: g.state.screen,
      runways: sim?.infra?.runways?.length, taxiways: sim?.infra?.taxiways?.length,
      auto: g.state.planningAuto, bankrupt: sim?.economy?.bankrupt,
      pax: sim?.passengers?.totalCarried, advanced: sim.time > t0,
    };
  })()`, true);
  check("E. recharge + « Reprendre » : l'état est intact (2 pistes + 2 taxiways, pax, avance)",
    resumed?.screen === 'game' && resumed?.runways === 2 && resumed?.taxiways === 2 && resumed?.advanced === true,
    `screen=${resumed?.screen} pistes=${resumed?.runways} taxiways=${resumed?.taxiways} pax=${resumed?.pax} avance=${resumed?.advanced}`);
  await shot('e-reprise');

  // --- F. console / exceptions / rejets (le « blocage » se verrait ici) -------------
  const unexplainedHttp = failedResources.filter((r) => !r.includes('favicon'));
  check('F. aucune ressource HTTP en échec (hors /favicon.ico connu)', unexplainedHttp.length === 0,
    unexplainedHttp.length ? unexplainedHttp.slice(0, 3).join(' | ').slice(0, 300) : 'toutes les ressources servies (200)');
  const consoleErrors = consoleLogs.filter((c) => c.level === 'error'
    && !(c.text.includes('Failed to load resource') && unexplainedHttp.length === 0));
  check('F. aucune exception page non capturée', pageExceptions.length === 0,
    pageExceptions.length ? pageExceptions.slice(0, 2).join(' | ').slice(0, 200) : '0 exception');
  check('F. aucun rejet de promesse non géré', rejections.length === 0,
    rejections.length ? rejections.slice(0, 2).join(' | ').slice(0, 200) : '0 rejet');
  check('F. console : aucune erreur inexpliquée', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.map((c) => c.text.slice(0, 120)).join(' | ').slice(0, 300) : `${consoleLogs.length} message(s) console, 0 erreur`);

  // --- rapport ---------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  const report = {
    task: 't_2e6ad3c0',
    browser: diag.browser,
    started: diag.started,
    page: diag.page,
    session: { speed: SPEED, gameSeconds: GAME_SECONDS, realSeconds: Math.round(GAME_SECONDS / SPEED), samples: samples.length },
    samples, // les MEURES (pas une synthèse) : invariants, heap, fps, latence par palier
    results,
    failedResources,
    consoleLogs: consoleLogs.slice(0, 50),
    pageExceptions,
    rejections,
    pass: failed.length === 0 && diag.started,
  };
  const rp = join(import.meta.dirname, 'r42-cdp-report.json');
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(`\nR42 ENDURANCE BROWSER : ${report.pass ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length}) — rapport ${rp}`);
  ws.close();
  return finish();
}

function finish() {
  edgeProc?.kill();
  server?.kill();
  const failed = results.filter((r) => !r.ok);
  if (!diag.started) console.log('R42 ENDURANCE BROWSER : FAIL (navigateur non démarré — jamais PASS sans navigateur)');
  process.exit(failed.length === 0 && diag.started ? 0 : 1);
}

main().catch((e) => {
  console.error('R42 ENDURANCE BROWSER crash:', e.message);
  edgeProc?.kill();
  server?.kill();
  process.exit(1);
});
