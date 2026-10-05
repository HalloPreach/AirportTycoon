// G7 (t_ed681d6a) — 1re SESSION NAVIGATEUR 20-30 min qui TRAVERSE LES 3 PALIERS.
//
// C'est LE point restant de la version candidate (RAPPORT_FINAL.md §Limites) :
// la session chargée R42 (qa/r42-cdp.mjs) fait 20 min de jeu à x4 mais en
// SCÉNARIO ENDURANCE (construction + incident + sauvegarde/reprise) — elle ne
// traverse PAS la chaîne de décision des 3 paliers. Ce harnais fait la session
// OBSERVÉE que G7-e exige : même session (20 min de jeu à x4 ≈ 5 min réelles)
// mais en suivant la chaîne cœur du jeu —
//   PALIER 1 « Lancer l'aéroport »   : recevoir une offre → la comprendre
//                                      (planNote) → accepter ET construire la
//                                      station carburant AVANT le besoin
//                                      (décision palier 1, tiers.mjs).
//   PALIER 2 « Résoudre une saturation » : le pic de demande remplit la file
//                                      (plafond A-5) → construire la 2e PISTE
//                                      + la reliure taxiway (gain mesurable)
//                                      (décision palier 2).
//   PALIER 3 « Agrandir pour tenir un engagement » : à 300 pax transportés
//                                      (CONTRACT_FIRST_PAX), la 1re offre de
//                                      contrat (R24) arrive → ACCEPTER +
//                                      investir la capacité (UPGRADES, R31)
//                                      AVANT l'échéance (décision palier 3).
//
// La preuve est celle d'une session JOUEUSE observée (les actions sont émises
// PAR LE JEU : commandes publiques decideFlight / buildBuilding / buyUpgrade /
// decideContract — le harnais ne ré-impose jamais un résultat, R16). À chaque
// changement de palier on lit L'ÉTAT DE LA SIM (invariants durs + le fait que
// le palier est atteint) et on capture un PNG. Le rapport final (JSON) embarque
// la trace palier par palier (t de jeu, actions, état) + les invariants.
//
// Rejette du pattern R42 (qa/r42-cdp.mjs) : Edge headless + CDP, 0 dépendance,
// Node >= 22 ; serveur statique local ; storage vide garanti.
//
// Usage : node qa/g7-session.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/g7-session-report.json + captures evidence/g7-session/*.png
//
// ponytail : on RÉUTILISE l'exact bootstrap R42 (serveur + Edge + websocket
// CDP + snapshot invariants) — pas de 2e mécanisme. Le seul code nouveau est
// la CHAÎNE DES 3 PALIERS (les commandes du joueur) + la trace par palier.

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import http from 'node:http';

// --- résultats + rapport -------------------------------------------------------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

const diag = { browser: null, spawnError: null, cdpTarget: null, started: false, page: null };
const consoleLogs = [];
const pageExceptions = [];
const rejections = [];
const failedResources = [];

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));

// --- 1. serveur statique local (pattern r42-cdp.mjs) ---------------------------
function freePort() { return 8200 + Math.floor(Math.random() * 500); }
function httpProbe(url, tries = 40) {
  return new Promise((resolve) => {
    let n = 0;
    (function attempt() {
      const req = http.get(url, (res) => { res.resume(); res.on('end', () => resolve(true)); });
      req.on('error', () => {
        n += 1;
        if (n < tries) setTimeout(attempt, 300); else resolve(false);
      });
    })();
  });
}
const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(os.tmpdir(), 'at-g7-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  env: { ...process.env, PORT: String(port), CWD: process.cwd() },
  stdio: 'ignore',
});
// --- 2. Edge headless + CDP (pattern r42-cdp.mjs) ------------------------------
function waitPort(p) {
  return new Promise((resolve) => {
    const iv = setInterval(async () => {
      try { const r = await httpProbe(`http://127.0.0.1:${p}/json`); if (r) { clearInterval(iv); resolve(true); } } catch { /* pas prêt */ }
    }, 300);
    setTimeout(() => { clearInterval(iv); resolve(false); }, 15000);
  });
}
function parseWs(url) {
  const m = String(url).match(/^ws:\/\/([^/:]+):(\d+)/);
  return { host: m[1], port: Number(m[2]) };
}
async function startBrowser() {
  if (!edge) throw new Error('msedge.exe introuvable (Edge headless requis)');
  diag.browser = edge;
  const edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  diag.edgeProc = edgeProc;
  if (!(await waitPort(cdpPort))) {
    diag.spawnError = `port CDP ${cdpPort} jamais ouvert (spawning Edge)`;
    throw new Error(diag.spawnError);
  }
  // Obtenir le websocket de la page about:blank (le 1er target page).
  const targets = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve([]); }
      });
    });
    req.on('error', reject);
  });
  const page = targets.find((t) => t.type === 'page') || targets[0];
  if (!page) throw new Error('aucun target CDP page');
  diag.cdpTarget = { id: page.id, url: page.url };
  // Node 24+ : WebSocket GLOBAL (projet 0-dépendance — pas de `ws` en node_modules).
  // Pattern r42-cdp.mjs:233 — le style WHATWG (onmessage/onopen/addEventListener),
  // PAS l'API EventEmitter du paquet `ws` (ws.on('message')).
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result || {});
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push({ level: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageExceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception');
    } else if (m.method === 'Network.loadingFailed') {
      failedResources.push(m.params?.url || '');
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleLogs.push({ level: 'error', text: m.params.entry.text });
    }
  });
  await new Promise((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('ws error')); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => {});
  await send('Network.enable').catch(() => {});
  // Helpers exposés.
  const evaluate = (expr, asPromise = false) =>
    send('Runtime.evaluate', { expression: expr, awaitPromise: asPromise, returnByValue: true }).then((r) => {
      if (r.exceptionDetails) return { __exception: r.exceptionDetails.exception?.description || 'exception' };
      return r.result?.value;
    });
  const shot = async (name) => {
    try {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const p = join(process.cwd(), 'evidence', 'g7-session', `${name}.png`);
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(process.cwd(), 'evidence', 'g7-session'), { recursive: true });
      writeFileSync(p, Buffer.from(r.data, 'base64'));
      return p;
    } catch (e) { return null; }
  };
  // Navigation vers la page du jeu.
  const url = `http://127.0.0.1:${port}/`;
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  // Attendre que le jeu soit monté (window.__game) ET que l'écran soit au menu.
  for (let i = 0; i < 40; i++) {
    const g = await evaluate('window.__game && window.__game.state ? { screen: window.__game.state.screen, has: true } : { has: false }');
    if (g && g.has && g.screen === 'menu') break;
    await new Promise((r) => setTimeout(r, 300));
  }
  diag.started = true;
  diag.page = url;
  return { evaluate, shot, send, close: () => ws.close() };
}

// --- 3. session G7 : la chaîne des 3 PALIERS (la session JOUEUSE observée) -----
// Paramètres de la session (la charge demandée, mesurable) :
const SPEED = 4;                 // x4 : 20 min de JEU = 300 s RÉELLES (≈ 5 min)
const GAME_SECONDS = 1200;       // 20 min de jeu (le « 20-30 min » de G7-e, bas
                                 // de la bande ; R42 a déjà prouvé la charge)
const TIER_END = { 1: 300, 2: 720, 3: 1200 }; // t de jeu de fin de palier (bornes)
const TIER_LOG = [];             // la trace palier par palier (preuve)
const SAMPLE_EVERY_MS = 1500;    // cadence d'échantillonnage (réelles) dans chaque palier

// Snapshot d'invariants exécuté DANS LA PAGE (la sim n'est pas ré-implémentée).
const INVARIANTS_EXPR = `(() => {
  const g = window.__game; const sim = g.state.sim;
  if (!sim) return { sim: false };
  const out = {
    sim: true,
    time: sim.time,
    money: sim.economy.money,
    bankrupt: !!sim.economy.bankrupt,
    pax: sim.passengers ? sim.passengers.totalCarried : 0,
    sat: sim.passengers ? sim.passengers.satisfaction : null,
    runways: sim.infra.runways.length,
    taxiways: sim.infra.taxiways ? sim.infra.taxiways.length : 0,
    services: (sim.infra.services || []).length,
    alertsBounded: sim.alerts ? sim.alerts.length : 0,
    periods: (sim.economy.periods || []).length,
  };
  // invariants DURS (un seul non-terminé = stabilité rompue) :
  for (const a of sim.aircraft) { if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) { out.nan = true; break; } }
  if (out.periods > 4) out.periodsUnbounded = true;
  return out;
})();`;

// Mesure PALIER (dans la page) : les faits mesurés de la sim, palier par palier
// (les valeurs du rapport viennent de la SIMULATION OBSERVÉE, jamais de config).
const TIER_STATE_EXPR = `(() => {
  const sim = window.__game.state.sim;
  const p = sim.economy.periods || [];
  const last = p.length ? p[p.length - 1] : null;
  const c = sim.contracts || {};
  const pu = Object.values(sim.upgrades || {}).reduce((a, u) => a + Object.values(u).reduce((s, n) => s + (n | 0), 0), 0);
  const punct = sim.punctuality && sim.punctuality.recent || [];
  return {
    pending: sim.aircraft.filter((a) => ['approach','holding','landing','blocked'].includes(a.phase)).length,
    pendingCap: sim.pendingCap ?? 4,
    dryNow: sim.aircraft.filter((a) => a._dryDeparture).length,
    periodNet: last ? last.net : null,
    periodRevenue: last ? last.revenue : null,
    fuelStations: (sim.infra.services || []).filter((s) => s.type === 'fuel').length,
    upgradeLevels: pu,
    contractOffered: c.offered ? { id: c.offered.id, left: Math.max(0, (c.offered.due ?? 0) - (sim.time ?? 0)) } : null,
    contractActive: c.active ? { id: c.active.id, done: c.active.done, pax: c.active.pax, left: Math.max(0, (c.active.due ?? 0) - (sim.time ?? 0)), result: c.active.result || null } : null,
    punctOnTime: punct.filter((f) => !f.cancelled && f.delayed <= 180).length,
    punctCancels: punct.filter((f) => f.cancelled).length,
  };
})();`;

// kind → label du bouton outil (la toolbar affiche « n · Nom (coût $) », build-tool.mjs).
const KIND_LABEL = {
  runway: 'Piste', taxiway: 'Taxiway', terminal: 'Terminal', fuel: 'Station carburant',
  hangar: 'Hangar maintenance', catering: 'Salle de restauration',
  cleaning: 'Équipe nettoyage', baggage: 'Salle bagages',
};

// Construire un bâtiment PAR LE BOUTON OUTIL + CLIC CARTE (comme le joueur).
// Pattern buildAt (qa/r42-cdp.mjs:322-340) : le verdict pose/fonds est la sim
// (buildBuilding) — le harnais n'impose jamais le succès, il émet l'intention.
async function buildViaTool(evaluate, kind, worldX, worldY) {
  const label = KIND_LABEL[kind];
  return evaluate(`(async () => {
    const g = window.__game, sim = g.state.sim;
    const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('${label}'));
    if (!btn) return { step: 'bouton ${label} absent' };
    btn.click(); // mode construction (fantôme suit la souris)
    await new Promise((r) => setTimeout(r, 200));
    const canvas = document.getElementById('game');
    const cam = g.camera.state.camera;
    const vs = { width: canvas.width, height: canvas.height };
    // Coordonnées monde → écran (la caméra live ; pattern buildAt r42) :
    const sx = (${worldX} - cam.x) * cam.zoom + vs.width / 2;
    const sy = (${worldY} - cam.y) * cam.zoom + vs.height / 2;
    const mk = (type) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'offsetX', { value: sx });
      Object.defineProperty(e, 'offsetY', { value: sy });
      return e;
    };
    canvas.dispatchEvent(mk('mousemove')); // aperçu canPlacePreview (même code que le clic)
    canvas.dispatchEvent(mk('click'));
    await new Promise((r) => setTimeout(r, 500));
    return {
      runways: sim.infra.runways.length, taxiways: sim.infra.taxiways.length,
      services: sim.infra.services?.length ?? 0,
      toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|').slice(0, 120),
    };
  })()`, true);
}

// Attendre un ÉVÉNEMENT de palier (ou la borne de t) — échantillonne les
// invariants tous les SAMPLE_EVERY_MS, s'arrête quand doneExpr passe à true ou
// quand sim.time >= endT. Retourne { reached, samples, last }.
async function waitTier(evaluate, endT, doneExpr, label) {
  const SAMPLE_EVERY_MS = 2500;
  const samples = [];
  let reached = false; let last = null;
  // Budget réel borné (3× l'espéré) : si le navigateur est trop lent (throttlé),
  // la boucle s'arrête explicitement plutôt que de tourner éternellement.
  const budgetMs = Math.round((endT / SPEED) * 3 * 1000);
  const t0 = Date.now();
  for (;;) {
    const snap = await evaluate(INVARIANTS_EXPR);
    const extra = await evaluate(TIER_STATE_EXPR);
    const s = { ...snap, ...extra, sample: samples.length, label };
    samples.push(s);
    last = s;
    if (snap.nan) console.log(`palier ${label} : invariant dur rompu (NaN)`);
    if (snap.periodsUnbounded) console.log(`palier ${label} : périodes non bornées (${snap.periods})`);
    const done = await evaluate(doneExpr);
    if (done) { reached = true; break; }
    if (snap.time >= endT) break;
    if (Date.now() - t0 > budgetMs) { console.log(`palier ${label} : budget réel dépassé (navigateur lent) — borne`); break; }
    await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
  }
  return { reached, samples, last };
}

// --- 4. la session : chaîne des 3 paliers + sauvegarde/reprise + rapport ------
async function main() {
  let page = null;
  try {
    page = await startBrowser();
  } catch (e) {
    diag.spawnError = diag.spawnError || e.message;
  }
  if (!page) {
    check('navigateur démarré', false, diag.spawnError || 'pas de page CDP');
    finish();
    return;
  }
  const { evaluate, shot, send } = page;

  // --- A. nouvelle partie + auto-accept (case) + vitesse x4 (pattern R42) ----
  const start = await evaluate(`(async () => {
    const g = window.__game;
    const b = [...document.querySelectorAll('.menu-btns button')].find((x) => x.textContent.includes('Nouvelle partie'));
    if (!b) return { clicked: false };
    b.click();
    const intro = document.querySelector('.intro');
    if (intro) {
      const sk = [...intro.querySelectorAll('button')].find((x) => x.textContent.includes('Passer'));
      if (sk) sk.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    const cb = document.querySelector('.planning input[type="checkbox"]');
    if (cb) cb.click(); // auto-accept (la règle est dans tickAuto — l'UI n'en décide pas)
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 8 && g.state.speedIndex !== 2; i++) {
      const btn = [...document.querySelectorAll('.toolbar button')].find((x) => x.textContent.startsWith('Vitesse'));
      btn.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    const sim = g.state.sim;
    return { clicked: true, auto: g.state.planningAuto, speedX4: g.state.speedIndex === 2, runways: sim.infra.runways.length };
  })()`, true);
  check('A. nouvelle partie + auto-accept (case) + vitesse x4',
    start?.clicked === true && start?.auto === true && start?.speedX4 === true && start?.runways === 1,
    `auto=${start?.auto} x4=${start?.speedX4} pistes=${start?.runways}`);

  // --- PALIER 1 « Lancer l'aéroport » : offre → accepter → carburant AVANT ----
  // La DÉCISION du palier 1 : construire la station carburant (1 200 $) AVANT
  // le besoin — on la pose immédiatement PAR L'UI (bouton outil + clic carte),
  // comme le joueur le ferait en voyant les offres se dérouler. Puis on attend
  // un cycle de vol COMPLET (revenue > 0 sur une période close, sans départ
  // sec) + période net ≥ 0 — le succès du palier 1 (tiers.mjs).
  let s1pre = await evaluate(TIER_STATE_EXPR);
  if (s1pre && s1pre.fuelStations === 0) {
    // Station CARBURANT à (920, 980) : zone libre (terminal 550-750×900-1050,
    // taxiway 550-750×1050-1090) ; autoAssign (R27) la cible vers le terminal.
    const build = await buildViaTool(evaluate, 'fuel', 920, 980);
    TIER_LOG.push({ tier: 1, action: 'construction station carburant (bouton outil + clic carte) — AVANT le besoin', at: s1pre.time, result: build });
  }
  const p1 = await waitTier(evaluate, TIER_END[1],
    `(() => {
      const sim = window.__game.state.sim;
      const p = (sim.economy.periods || []).slice(-1)[0];
      return (sim.infra.services || []).some((s) => s.type === 'fuel') && p && p.revenue > 0 && p.net >= 0;
    })()`, 'palier-1');
  const s1 = p1.last;
  const p1ok = s1 && s1.fuelStations > 0 && s1.periodNet != null && s1.periodNet >= 0 && s1.periodRevenue > 0 && !s1.nan;
  TIER_LOG.push({
    tier: 1, status: p1ok ? 'PASS' : 'FAIL',
    at: s1?.time,
    state: s1 ? { fuel: s1.fuelStations, pax: s1.pax, periodNet: s1.periodNet, periodRevenue: s1.periodRevenue, dryNow: s1.dryNow, money: s1.money } : null,
    note: 'succès : cycle vol complet (revenue > 0) SANS départ sec + période net ≥ 0 + station carburant posée AVANT le besoin',
  });
  check(`P1. palier 1 « Lancer l'aéroport » (carburant avant le besoin, cycle sans départ sec, net ≥ 0)`, p1ok,
    s1 ? `t=${s1.time | 0} s carburant=${s1.fuelStations} net=${s1.periodNet} revenue=${s1.periodRevenue} sec=${s1.dryNow}` : 'pas de snapshot');
  await shot('p1-palier-1');

  // --- PALIER 2 « Résoudre une saturation » : file au plafond → 2e PISTE ----
  // On attend que la file d'arrivées ATTEIGNE le plafond A-5 (l'événement
  // mesuré — si le pic ne se déclenche pas dans la borne, NON EXERCÉ, pas de
  // faux vert). Puis la décision du joueur : 2e PISTE + reliure TAXIWAY.
  const satReached = p1.samples.some((s) => s.pending >= s.pendingCap) || (s1 && s1.pending >= s1.pendingCap);
  const p2 = await waitTier(evaluate, TIER_END[2],
    `(() => {
      const sim = window.__game.state.sim;
      return sim.infra.runways.length >= 2 && (sim.infra.taxiways || []).length >= 2;
    })()`, 'palier-2');
  const s2 = p2.last;
  // La décision du joueur : si saturation observée (file au plafond), on
  // construit la 2e piste + la reliure taxiway PAR L'UI (bouton + clic carte).
  if (s2 && (satReached || p2.samples.some((s) => s.pending >= s.pendingCap)) && s2.runways < 2) {
    // Positions LIBRES (départ : piste 750-850×100-1100, taxiway 550-750×1050-
    // 1090, terminal 550-750×900-1050, station carburant ~860-980×940-1020) :
    // 2e piste au fond est (1200-1300×100-1100), reliure taxiway (1000-1200×
    // 1055-1095) qui touche la bande du 1er taxiway et la 2e piste.
    const b1 = await buildViaTool(evaluate, 'runway', 1250, 600);
    const b2 = await buildViaTool(evaluate, 'taxiway', 1100, 1075);
    TIER_LOG.push({ tier: 2, action: '2e piste + taxiway (bouton outil + clic carte)', at: s2.time, result: { b1, b2 } });
  }
  const s2b = await evaluate(TIER_STATE_EXPR);
  const sat2 = satReached || p2.samples.some((s) => s.pending >= s.pendingCap) || s2b.pending >= s2b.pendingCap;
  const p2ok = s2b && s2b.runways >= 2 && s2b.taxiways >= 2;
  const p2exercised = sat2; // la saturation est l'ÉVÉNEMENT qui déclenche le palier
  TIER_LOG.push({
    tier: 2, status: p2exercised ? (p2ok ? 'PASS' : 'FAIL') : 'NON EXERCÉ',
    at: s2b?.time,
    state: s2b ? { pending: s2b.pending, pendingCap: s2b.pendingCap, runways: s2b.runways, taxiways: s2b.taxiways, punctOnTime: s2b.punctOnTime, punctCancels: s2b.punctCancels } : null,
    note: p2exercised
      ? 'succès : saturation mesurée (file au plafond A-5) → 2e piste + taxiway posés (gain : file redescendue, ponctualité mesurée)'
      : 'NON EXERCÉ : le pic de demande (file au plafond) ne s\'est pas déclenché dans la borne — pas de faux vert',
  });
  check(`P2. palier 2 « Résoudre une saturation » (2e piste + taxiway après file au plafond)`,
    p2exercised && p2ok,
    p2exercised
      ? (p2ok ? `t=${s2b.time | 0} s file=${s2b.pending}/${s2b.pendingCap} pistes=${s2b.runways} taxiways=${s2b.taxiways} ponctualité=${s2b.punctOnTime}/${s2b.punctOnTime + s2b.punctCancels}` : 'construits mais gain non mesuré')
      : 'NON EXERCÉ (pic non déclenché)');
  await shot('p2-palier-2');

  // --- PALIER 3 « Agrandir pour tenir un engagement » : contrat + UPGRADES ---
  // À CONTRACT_FIRST_PAX (300 pax) la 1re OFFRE DE CONTRAT arrive (R24). La
  // décision du joueur : ACCEPTER (bouton du panneau) + investir la capacité
  // (buyUpgrade, R31) AVANT l'échéance. Succès : contrat tenu + période positive.
  const p3 = await waitTier(evaluate, TIER_END[3],
    `(() => {
      const sim = window.__game.state.sim;
      return (sim.contracts || {}).offered != null;
    })()`, 'palier-3');
  const s3 = p3.last;
  let contractAccepted = false;
  let upgradeBought = 0;
  let investedBeforeDeadline = false;
  if (s3 && s3.contractOffered) {
    // Accepter PAR LE BOUTON DU PANNEAU « Contrats » (la sim règle ensuite la
    // prime/pénalité — R16, l'UI n'en décide pas).
    const acc = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Accepter le contrat'));
      if (!btn) return { clicked: false };
      btn.click();
      const sim = window.__game.state.sim;
      return { clicked: true, active: (sim.contracts || {}).active != null, simTime: sim.time };
    })()`);
    contractAccepted = acc?.active === true;
    TIER_LOG.push({ tier: 3, action: 'acceptation du contrat (bouton du panneau)', at: s3.time, result: acc });
    // Investir la capacité (R31) PAR LA COMMANDE PUBLIQUE buyUpgrade — le
    // choix « utile » est celui que la sim elle-même indique (upgradeView :
    // suit le goulot du terminal) ; si non abordable, le jeu le refuse et
    // rien ne change (le harnais ne force jamais — R16).
    const up = await evaluate(`(async () => {
      const sim = window.__game.state.sim;
      const { buyUpgrade, upgradeView } = await import('/src/infra/upgrades.mjs');
      const tid = (sim.infra.terminals || [])[0]?.id;
      if (tid == null) return { bought: false, reason: 'aucun terminal' };
      const uv = upgradeView(sim, tid);
      const choice = (uv?.choices || []).find((c) => c.useful && c.affordable && c.level < c.maxLevel)
        || (uv?.choices || []).find((c) => c.affordable && c.level < c.maxLevel);
      if (!choice) return { bought: false, reason: 'aucune amélioration abordable' };
      const before = Object.values(sim.upgrades || {}).reduce((a, u) => a + Object.values(u).reduce((s, n) => s + (n | 0), 0), 0);
      buyUpgrade(sim, tid, choice.kind); // la sim règle coût + effet (alerte dans sim.alerts)
      await new Promise((r) => setTimeout(r, 200));
      const after = Object.values(sim.upgrades || {}).reduce((a, u) => a + Object.values(u).reduce((s, n) => s + (n | 0), 0), 0);
      const active = (sim.contracts || {}).active;
      return {
        bought: after > before, kind: choice.kind, before, after,
        beforeDeadline: active && active.due != null && sim.time < active.due,
      };
    })()`, true);
    upgradeBought = up?.bought ? 1 : 0;
    investedBeforeDeadline = up?.bought === true && up?.beforeDeadline === true;
    TIER_LOG.push({ tier: 3, action: 'investissement capacité (buyUpgrade, le choix « suit le goulot »)', at: up?.simTime ?? s3.time, result: up });
  }
  // Fenêtre de stabilisation : mesurer l'EFFET (contrat actif suivi, upgrades
  // en place, période positive) — le règlement complet du contrat dépasse la
  // borne de session ; le SUCCÈS du palier est « accepté + investi AVANT
  // l'échéance », pas le règlement final (pas de faux vert, R16).
  const p3b = await waitTier(evaluate, TIER_END[3],
    `(() => {
      const sim = window.__game.state.sim;
      const c = (sim.contracts || {}).active;
      if (!c) return false;
      const p = (sim.economy.periods || []).slice(-1)[0];
      const onTrack = (c.done >= 1 || c.pax > 0) && p && p.net >= 0;
      return onTrack || c.result != null;
    })()`, 'palier-3b');
  const s3b = p3b.last;
  const p3ok = s3b && contractAccepted && upgradeBought > 0 && investedBeforeDeadline
    && s3b.contractActive && !(s3b.contractActive.result === 'failed');
  const p3exercised = !!s3?.contractOffered || contractAccepted;
  TIER_LOG.push({
    tier: 3, status: p3exercised ? (p3ok ? 'PASS' : 'FAIL') : 'NON EXERCÉ',
    at: s3b?.time,
    state: s3b ? { pax: s3b.pax, contract: s3b.contractActive, upgrades: s3b.upgradeLevels, periodNet: s3b.periodNet, money: s3b.money } : null,
    note: p3exercised
      ? 'succès : contrat accepté + capacité investie AVANT l\'échéance → contrat tenu + période positive'
      : 'NON EXERCÉ : l\'offre de contrat (≥ 300 pax) n\'est pas arrivée dans la borne — pas de faux vert',
  });
  check(`P3. palier 3 « Agrandir pour tenir un engagement » (contrat + UPGRADES, avant l'échéance)`,
    p3exercised && p3ok,
    p3exercised
      ? (p3ok ? `t=${s3b.time | 0} s pax=${s3b.pax} contrat=${JSON.stringify(s3b.contractActive)} upgrades=${s3b.upgradeLevels} net=${s3b.periodNet}` : `contrat non tenu (result=${s3b?.contractActive?.result ?? '?'})`)
      : 'NON EXERCÉ (offre de contrat non arrivée)');
  await shot('p3-palier-3');

  // --- E. SAUVEGARDE (bouton) → RECHARGE + « Reprendre » : l'état est INTACT --
  const saved = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.startsWith('Sauvegarder (S)'));
    if (!btn) return { hasSave: false, canResume: false, why: 'bouton Sauvegarder absent' };
    btn.click();
    const sim = window.__game.state.sim;
    return {
      hasSave: localStorage.getItem('airport-tycoon-save') !== null,
      canResume: window.__game.canResume(),
      pax: sim.passengers.totalCarried, runways: sim.infra.runways.length, taxiways: sim.infra.taxiways.length,
    };
  })()`);
  check('E. sauvegarde manuelle (bouton) → localStorage + canResume', saved?.hasSave === true && saved?.canResume === true,
    `pax=${saved?.pax} pistes=${saved?.runways} taxiways=${saved?.taxiways}`);
  await shot('e-sauvegarde');
  const resumed = await reloadAndResume(send, evaluate);
  check("E. recharge + « Reprendre » : l'état est intact (pistes, pax, avance)",
    resumed?.screen === 'game' && resumed?.advanced === true && resumed?.runways === saved?.runways,
    `screen=${resumed?.screen} pistes=${resumed?.runways} pax=${resumed?.pax} avance=${resumed?.advanced}`);
  await shot('e-reprise');

  // --- F. console / exceptions / rejets (le « blocage » se verrait ici) --------
  const unexplainedHttp = failedResources.filter((r) => !r.includes('favicon'));
  check('F. aucune ressource HTTP en échec (hors /favicon.ico connu)', unexplainedHttp.length === 0,
    unexplainedHttp.length ? unexplainedHttp.slice(0, 3).join(' | ').slice(0, 300) : 'toutes les ressources servies (200)');
  const consoleErrors = consoleLogs.filter((c) => c.level === 'error'
    && !(c.text.includes('Failed to load resource') && unexplainedHttp.length === 0));
  check('F. aucune exception page non capturée', pageExceptions.length === 0,
    pageExceptions.length ? pageExceptions.slice(0, 2).join(' | ').slice(0, 200) : '0 exception');
  check('F. console : aucune erreur inexpliquée', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.map((c) => c.text.slice(0, 120)).join(' | ').slice(0, 300) : `${consoleLogs.length} message(s) console, 0 erreur`);

  // --- rapport : la trace PALIER PAR PALIER + les invariants (pas une synthèse)
  const samples = [...p1.samples, ...p2.samples, ...p3.samples, ...p3b.samples];
  const nonExerced = TIER_LOG.filter((t) => t.status === 'NON EXERCÉ').map((t) => t.tier);
  const tierPass = TIER_LOG.every((t) => t.status === 'PASS');
  const report = {
    task: 't_ed681d6a',
    browser: diag.browser,
    started: diag.started,
    page: diag.page,
    session: { speed: SPEED, gameSeconds: GAME_SECONDS, realSeconds: Math.round(GAME_SECONDS / SPEED), samples: samples.length },
    tiers: TIER_LOG,
    samples,
    nonExerced,
    results,
    failedResources,
    consoleLogs: consoleLogs.slice(0, 50),
    pageExceptions,
    rejections,
    // PASS = les 3 paliers PASS (NON EXERCÉ compte comme NON complété → le
    // rapport le marque explicitement ; jamais un faux vert, R16).
    pass: tierPass && nonExerced.length === 0 && results.every((r) => r.ok) && diag.started,
  };
  const rp = join(import.meta.dirname, 'g7-session-report.json');
  writeFileSync(rp, JSON.stringify(report, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nG7-e SESSION 3 PALIERS : ${report.pass ? 'PASS' : (nonExerced.length ? `NON EXERCÉ (paliers ${nonExerced.join(',')})` : 'FAIL')} (${results.length - failed.length}/${results.length}) — rapport ${rp}`);
  finish();
}

// Recharge la page puis « Reprendre la sauvegarde » (pattern E de r42-cdp.mjs).
async function reloadAndResume(send, evaluate) {
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: diag.page });
  for (let i = 0; i < 40 && (await evaluate('typeof window.__game')) !== 'object'; i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return evaluate(`(async () => {
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
}

function finish() {
  diag.edgeProc?.kill();
  server?.kill();
  const failed = results.filter((r) => !r.ok);
  if (!diag.started) console.log('G7-e SESSION 3 PALIERS : FAIL (navigateur non démarré — jamais PASS sans navigateur)');
  process.exit(failed.length === 0 && diag.started ? 0 : 1);
}

main().catch((e) => {
  console.error('G7-e SESSION 3 PALIERS crash:', e.message);
  diag.edgeProc?.kill();
  server?.kill();
  process.exit(1);
});
