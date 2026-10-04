// R40 (t_ffa69316) — QA navigateur intégrée : exerce les FLUX COMPLETS dans Edge
// headless (CDP, pattern éprouvé de qa/cdp-boot.mjs — 0 dépendance, Node ≥ 22).
//
// Flux : stockage vide → nouvelle partie (bouton menu) → 1re offre + auto-accept
// (CASE du panneau) → construction (2e piste, bouton outil + clic carte) → contrat
// (offre + ACCEPTATION via le panneau) → incident (forçage fermeture piste +
// INTERVENTION via le bouton du panneau) → pause/vitesse (boutons barre) →
// sauvegarde (bouton) → fermeture/reprise (recharge + bouton « Reprendre ») →
// faillite (écran + « Nouvelle partie ») → retour menu.
//
// Lancement ADAPTÉ + diagnostic explicite :
//   - chemin navigateur CONFIGURABLE : QA_EDGE / QA_BROWSER (sinon les 2 chemins usuels),
//   - si le navigateur ne démarre PAS → QA en échec EXPLICITE (jamais PASS),
//   - captures : console (console.*), exceptions non capturées, rejets de promesses.
//
// Usage : node qa/r40-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/r40-report.json + captures evidence/r40-*.png
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- résultats + rapport ------------------------------------------------------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const diag = {
  browser: null,       // chemin de l'exécutable (null = introuvable)
  spawnError: null,    // stderr du navigateur (si échec)
  cdpTarget: null,     // url websocket de la cible (si trouvée)
  started: false,      // le navigateur a VRAIMENT démarré ?
  page: null,          // url chargée
};
const consoleLogs = [];   // { level, text }
const pageExceptions = []; // exceptions non capturées (Runtime.exceptionThrown)
const rejections = [];     // rejets de promesses non gérés

// Chemin navigateur CONFIGURABLE (R40) : variable d'environnement d'abord,
// sinon les chemins usuels Windows. `null` = introuvable → QA en échec explicite.
const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
diag.browser = edge;

// --- 1. serveur statique local (pattern cdp-boot.mjs) --------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-r40-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up, `http://127.0.0.1:${port}`);
  if (!up) return finish();

  if (!edge) {
    check('navigateur Edge introuvable', false,
      `aucun candidat existant : ${EDGE_CANDIDATES.join(' | ')} — configurable (QA_EDGE / QA_BROWSER)`);
    return finish();
  }

  // --- 2. Edge headless + CDP (configurable + diagnostic explicite) -------------
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
  if (!target) {
    check('navigateur démarré', false,
      `Edge headless n'expose aucune cible CDP (exécutable=${edge}) stderr=${(diag.spawnError || '').slice(0, 300)}`);
    return finish();
  }
  diag.started = true;
  diag.cdpTarget = target.webSocketDebuggerUrl;
  check('navigateur démarré (cible CDP page)', true,
    `${edge} → ${target.webSocketDebuggerUrl.slice(0, 48)}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const failedResources = []; // HTTP >= 400 (URLs) — le 404 de /favicon.ico est connu et bénin (aucun favicon dans le projet).
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg); // RAW : {id, result:{...}} (piège connu cdp-boot)
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params;
      consoleLogs.push({ level: p.type || 'log',
        text: (p.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ').slice(0, 300) });
    } else if (msg.method === 'Network.responseReceived') {
      if (msg.params.response.status >= 400) failedResources.push(`${msg.params.response.status} ${msg.params.response.url}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const desc = (d.exception?.description || d.text || JSON.stringify(d).slice(0, 300)).slice(0, 300);
      // rejet de promesse non géré : « Uncaught (in promise) » (texte) ou type dédié.
      if ((d.text || '').includes('promise') || d.exception?.type === 'promiseRejection') rejections.push(desc);
      else pageExceptions.push(desc);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      const text = String(e.text ?? e.message ?? '').trim(); // Log.Entry : le texte est dans `text`
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
    const p = join(dir, `r40-${name}.png`);
    writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  }

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Network.enable');
  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500)); // modules ES chargés
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // ==============================================================================
  // SCÉNARIO R40 — chaque section = UN FLUX, vérifié sur l'UI réelle + l'état.
  // ==============================================================================

  // --- A. stockage vide au lancement ---------------------------------------------
  const empty = await evaluate(`(() => {
    const g = window.__game;
    return {
      len: localStorage.length,
      saved: localStorage.getItem('airport-tycoon-save'),
      screen: g.state.screen,
      resumeVisible: [...document.querySelectorAll('.menu-btns button')].some((b) => b.textContent.includes('Reprendre') && b.style.display !== 'none'),
    };
  })()`);
  check('A. stockage vide : aucune sauvegarde, menu affiché, « Reprendre » masqué',
    empty?.len === 0 && empty?.saved === null && empty?.screen === 'menu' && empty?.resumeVisible === false,
    `localStorage.length=${empty?.len} screen=${empty?.screen}`);
  await shot('a-stockage-vide');

  // --- B. nouvelle partie (BOUTON du menu) ---------------------------------------
  const newGame = await evaluate(`(() => {
    const g = window.__game;
    const b = [...document.querySelectorAll('.menu-btns button')].find((x) => x.textContent.includes('Nouvelle partie'));
    if (!b) return { clicked: false };
    b.click();
    const sim = g.state.sim;
    return {
      clicked: true, screen: g.state.screen,
      runways: sim?.infra?.runways?.length, taxiways: sim?.infra?.taxiways?.length,
      gates: sim?.infra?.gates?.length, money: Math.round(sim?.economy?.money ?? 0),
    };
  })()`);
  check('B. nouvelle partie : bouton menu → jeu, aéroport fourni (A-2)',
    newGame?.clicked === true && newGame?.screen === 'game' &&
    newGame?.runways === 1 && newGame?.taxiways === 1 && newGame?.gates === 2,
    `screen=${newGame?.screen} pistes=${newGame?.runways} taxiways=${newGame?.taxiways} portes=${newGame?.gates} solde=${newGame?.money}`);

  // Intro (R20) : la carte s'affiche à la PROCHAINE frame (intro.refresh() au bus 'frame') —
  // on attend un frame (rAF) avant de la vérifier, puis on la désactive par son vrai bouton.
  const intro = await evaluate(`(async () => {
    const card = document.querySelector('.intro');
    if (!card) return { shown: false, skipped: false, missing: true };
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // 1 frame : intro.refresh()
    const shown = card.style.display !== 'none';
    const skip = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Passer l\u2019intro'));
    if (!shown || !skip) return { shown, skipped: shown, missing: !skip };
    skip.click();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return { shown, skipped: card.style.display === 'none' };
  })()`, true);
  check('B. intro affichée puis désactivée (« Passer l’intro »)', intro?.shown === true && intro?.skipped === true,
    `affichée=${intro?.shown} passée=${intro?.skipped}`);

  // --- C. 1re offre + AUTO-ACCEPT via la CASE du panneau --------------------------
  // La 1re fenêtre (t+60 s sim) crée une offre « planned ». À vitesse x4 : ~15 s réelles.
  const firstOffer = await evaluate(`(async () => {
    const g = window.__game;
    g.state.paused = false;
    for (let i = 0; i < 240; i++) { // 96 s réelles max
      if ((g.state.sim.planning || []).some((e) => e.status === 'planned')) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })()`, true);
  check('C. première offre planifiée apparaît', firstOffer === true);

  // Auto-accept : la CASE du panneau (miroir DOM de state.planningAuto) — clic réel.
  const auto = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const cb = document.querySelector('.planning input[type="checkbox"]');
    if (!cb) return { found: false };
    cb.click(); // change → setPlanningAuto (même commande que la touche A)
    await new Promise((r) => setTimeout(r, 300)); // tickAuto tourne dans la boucle de frame
    for (let i = 0; i < 200; i++) {
      if (sim.planning.some((e) => e.status === 'accepted' || e.status === 'in-flight')) {
        return { found: true, auto: g.state.planningAuto, accepted: true };
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { found: true, auto: g.state.planningAuto, accepted: false };
  })()`, true);
  check('C. auto-accept via la case (planningAuto ON → vol accepté)',
    auto?.found === true && auto?.auto === true && auto?.accepted === true,
    `case=${auto?.found} planningAuto=${auto?.auto} vol accepté/déployé=${auto?.accepted}`);

  // --- D. construction : 2e PISTE (bouton outil + clic CANVAS) --------------------
  // Bouton « 1 · Piste (2500 $) » de la barre, puis clic canvas : le monde (1000,650)
  // pose la piste en x950..1050, y150..1150 (zone libre ; grille 1600×1200 bornée).
  const build = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const before = sim.infra.runways.length;
    const money = sim.economy.money;
    const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Piste (2500 $)'));
    if (!btn) return { step: 'bouton Piste absent' };
    btn.click(); // mode construction (fantôme suit la souris)
    await new Promise((r) => setTimeout(r, 200));
    const canvas = document.getElementById('game');
    const cam = g.camera.state.camera; // { x, y, zoom } — caméra x800, y600, zoom 1
    const vs = { width: canvas.width, height: canvas.height };
    const sx = (1000 - cam.x) * cam.zoom + vs.width / 2;
    const sy = (650 - cam.y) * cam.zoom + vs.height / 2;
    const mk = (type) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'offsetX', { value: sx }); Object.defineProperty(e, 'offsetY', { value: sy }); return e; };
    canvas.dispatchEvent(mk('mousemove')); // fantôme (computeGhost)
    canvas.dispatchEvent(mk('click'));     // pose (buildBuilding — import async)
    await new Promise((r) => setTimeout(r, 600));
    const after = sim.infra.runways.length;
    const toast = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ').slice(0, 160);
    return { before, after, paid: money - sim.economy.money, toast };
  })()`, true);
  check('D. 2e piste construite (bouton outil + clic carte, 2500 $ débités)',
    build?.after === build?.before + 1 && build?.paid >= 2495 && build?.paid <= 2510,
    `pistes ${build?.before}→${build?.after} débit=${build?.paid} $ (2500 ± opex x4) toast=« ${build?.toast || ''} »`);
  await shot('d-deux-pistes');

  // --- E. contrat : offre (300 pax) puis ACCEPTATION via le panneau ---------------
  // NOTE (accélération QA) : la condition du 1er contrat (300 pax TRANSPORTÉS)
  // demande des dizaines de cycles de vol ; on pousse le COMPTEUR (état sérialisé —
  // la sim continue de l'incrémenter naturellement). Le FLUX UI reste réel :
  // offre générée par la sim + décision par le BOUTON du panneau.
  const contract = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    if ((sim.passengers?.totalCarried ?? 0) < 300) sim.passengers.totalCarried = 300;
    await new Promise((r) => setTimeout(r, 600)); // tickContracts (chaque tick) propose l'offre
    const c = sim.contracts;
    if (!c.offered) return { offered: false };
    const sec = [...document.querySelectorAll('section.panel')].find((s) => s.querySelector('h4')?.textContent === 'Contrats de compagnie');
    const btn = sec ? [...sec.querySelectorAll('button')].find((b) => b.textContent.includes('Accepter le contrat')) : null;
    if (!btn) return { offered: true, button: false };
    btn.click(); // decideContract(sim, id, true) — la règle est dans contracts.mjs
    await new Promise((r) => setTimeout(r, 300));
    return { offered: true, button: true, active: !!c.active && !c.active.settled, model: c.active?.model };
  })()`, true);
  check('E. contrat : offre (300 pax) puis ACCEPTATION via le panneau',
    contract?.offered === true && contract?.button === true && contract?.active === true,
    `offre=${contract?.offered} bouton=${contract?.button} contrat actif (${contract?.model || '?'})`);

  // --- F. incident : forçage fermeture piste + INTERVENTION (bouton du panneau) ----
  const incident = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const { forceIncident } = await import('./src/sim/incidents.mjs'); // module singleton (même URL)
    const rwId = sim.infra.runways[0].id; // 1re piste (la 2e reste ouverte — R32)
    forceIncident(sim, 'runway:' + rwId);
    await new Promise((r) => setTimeout(r, 400)); // le panneau Diagnostic réseau se redessine (frame)
    const sec = [...document.querySelectorAll('section.panel')].find((s) => s.querySelector('h4')?.textContent === 'Diagnostic réseau');
    if (!sec) return { forced: true, panel: false };
    const line = [...sec.querySelectorAll('.pline')].map((d) => d.textContent).find((t) => t.includes('FERMÉE'));
    const btn = [...sec.querySelectorAll('button.resp')].find((b) => b.textContent.includes('Intervention'));
    if (!btn) return { forced: true, panel: true, closed: !!line, button: false };
    const money = sim.economy.money;
    btn.click(); // respondIncident(sim, 'runway:'+rwId, 'intervene') — règle dans incidents.mjs
    await new Promise((r) => setTimeout(r, 300));
    const reopened = !Object.values(sim.incidents?.runways || {}).some((r) => r && r.remaining > 0 && Number(r.asset) === rwId);
    return { forced: true, panel: true, closed: !!line, button: true, line: line ? line.slice(0, 60) : null, cost: money - sim.economy.money, reopened };
  })()`, true);
  check('F. incident : fermeture piste forcée → INTERVENTION via le bouton du panneau',
    incident?.button === true && incident?.reopened === true && incident?.cost >= 595 && incident?.cost <= 610,
    `ligne=« ${incident?.line || ''} » coût=${incident?.cost} $ (600 ± opex) réouverte=${incident?.reopened}`);
  await shot('f-incident');

  // --- G. pause + vitesse (BOUTONS de la barre de commandes) ----------------------
  const pauseSpeed = await evaluate(`(async () => {
    const g = window.__game;
    const byMarker = (s) => [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.startsWith(s));
    byMarker('Pause (P)').click();
    await new Promise((r) => setTimeout(r, 300));
    const t0 = g.state.time;
    await new Promise((r) => setTimeout(r, 600));
    const frozen = g.state.time === t0;
    byMarker('Reprendre (P)').click(); // le label a suivi l'état (pause → reprendre)
    await new Promise((r) => setTimeout(r, 400));
    byMarker('Vitesse x1 (F)').click(); // x1 → x2 (cycleSpeed)
    await new Promise((r) => setTimeout(r, 300));
    return {
      frozen,
      resumed: !g.state.paused,
      speedX2: byMarker('Vitesse x2 (F)') != null, // le label a suivi la vitesse
      advanced: g.state.time > t0,
    };
  })()`, true);
  check('G. pause gèle le temps, reprise + vitesse x1→x2 via les boutons',
    pauseSpeed?.frozen === true && pauseSpeed?.resumed === true && pauseSpeed?.speedX2 === true,
    `gèle=${pauseSpeed?.frozen} reprise=${pauseSpeed?.resumed} label x2=${pauseSpeed?.speedX2}`);

  // --- H. sauvegarde (BOUTON « Sauvegarder (S) ») ---------------------------------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.startsWith('Sauvegarder (S)'));
    btn.click(); // savePanel.saveNow()
    return { hasSave: localStorage.getItem('airport-tycoon-save') !== null, canResume: g.canResume() };
  })()`);
  check('H. sauvegarde manuelle : bouton → localStorage', saved?.hasSave === true && saved?.canResume === true,
    `localStorage=${saved?.hasSave} canResume=${saved?.canResume}`);
  await shot('h-sauvegarde');

  // --- I. fermeture + reprise : recharge (fermeture du jeu) puis « Reprendre » ------
  await cdp('Page.navigate', { url: 'about:blank' });
  await cdp('Page.navigate', { url }); // réouverture : MÊME user-data-dir (localStorage intact)
  for (let i = 0; i < 40 && (await evaluate('typeof window.__game')) !== 'object'; i++) {
    await new Promise((r) => setTimeout(r, 250)); // jusqu'à 10 s pour le boot complet
  }
  const resumed = await evaluate(`(() => {
    const g = window.__game;
    if (g.state.screen !== 'menu') return { atMenu: false, screen: g.state.screen };
    const btn = [...document.querySelectorAll('.menu-btns button')].find((b) => b.textContent.includes('Reprendre la sauvegarde'));
    if (!btn || btn.style.display === 'none') return { atMenu: true, resumeBtn: false };
    btn.click(); // resumeFromSave → savePanel.loadNow()
    const sim = g.state.sim;
    return {
      atMenu: true, resumeBtn: true, screen: g.state.screen,
      runways: sim?.infra?.runways?.length, auto: g.state.planningAuto,
      bankrupt: sim?.economy?.bankrupt, pax: sim?.passengers?.totalCarried,
    };
  })()`);
  check('I. fermeture puis reprise : bouton « Reprendre la sauvegarde » restaure l’état',
    resumed?.screen === 'game' && resumed?.runways === 2 && resumed?.auto === true && resumed?.bankrupt === false,
    `screen=${resumed?.screen} pistes=${resumed?.runways} auto=${resumed?.auto} pax=${resumed?.pax}`);
  await shot('i-reprise');

  // --- J. faillite (solde < -10000) + retour menu ----------------------------------
  const bankrupt = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    sim.economy.money = -20000; // sous BANKRUPT_LIMIT (-10000) → checkBankruptcy au prochain tick
    await new Promise((r) => setTimeout(r, 600)); // tickEconomy (frame) déclare la faillite
    const card = document.querySelector('.bankruptcy');
    const open = card && card.style.display !== 'none';
    const btn = open ? [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Nouvelle partie')) : null;
    if (open && btn) btn.click(); // « Nouvelle partie (retour au menu) » = le VRAI startNewGame
    await new Promise((r) => setTimeout(r, 600));
    const sim2 = g.state.sim; // la NOUVELLE partie (réinitialisée par startNewGame)
    g.quitToMenu(); // retour menu (quitToMenu — commande UI, autosave silencieuse)
    return {
      bankruptFlag: sim.economy.bankrupt, screen: g.state.screen,
      freshRunways: sim2?.infra?.runways?.length, freshBankrupt: sim2?.economy?.bankrupt ?? null,
      menu: g.state.screen === 'menu',
    };
  })()`, true);
  check('J. faillite : écran ouvert (solde < -10000) → « Nouvelle partie » → retour MENU',
    bankrupt?.bankruptFlag === true && bankrupt?.freshRunways === 1 && bankrupt?.menu === true,
    `flag=${bankrupt?.bankruptFlag} nouvelle partie (pistes=${bankrupt?.freshRunways}) → menu=${bankrupt?.menu}`);
  await shot('j-retour-menu');

  // --- K. captures : console / exceptions / rejets de promesses --------------------
  // Le navigateur demande /favicon.ico de son propre chef ; le projet n'en sert pas
  // (serve.mjs) → 404 connu et bénin : on le retire, tout autre HTTP >= 400 est un échec.
  const unexplainedHttp = failedResources.filter((r) => !r.includes('favicon'));
  check('K. aucune ressource HTTP en échec (hors /favicon.ico connu)', unexplainedHttp.length === 0,
    unexplainedHttp.length ? unexplainedHttp.slice(0, 3).join(' | ').slice(0, 300) : 'toutes les ressources servies (200)');
  const consoleErrors = consoleLogs.filter((c) => c.level === 'error'
    && !(c.text.includes('Failed to load resource') && unexplainedHttp.length === 0));
  check('K. aucune exception page non capturée', pageExceptions.length === 0,
    pageExceptions.length ? pageExceptions.slice(0, 2).join(' | ').slice(0, 200) : '0 exception');
  check('K. aucun rejet de promesse non géré', rejections.length === 0,
    rejections.length ? rejections.slice(0, 2).join(' | ').slice(0, 200) : '0 rejet');
  check('K. console : aucune erreur inexpliquée', consoleErrors.length === 0,
    consoleErrors.length
      ? consoleErrors.map((c) => c.text.slice(0, 120)).join(' | ').slice(0, 300)
      : `${consoleLogs.length} message(s) console, 0 erreur`);

  // --- rapport ---------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  const report = {
    task: 't_ffa69316',
    browser: diag.browser,
    started: diag.started,
    page: diag.page,
    results,
    failedResources, // HTTP >= 400 observés (le 404 /favicon.ico est connu et bénin)
    consoleLogs: consoleLogs.slice(0, 50),
    pageExceptions,
    rejections,
    pass: failed.length === 0 && diag.started,
  };
  const rp = join(import.meta.dirname, 'r40-report.json');
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(`\nR40 QA : ${report.pass ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length}) — rapport ${rp}`);
  ws.close();
  return finish();
}

function finish() {
  edgeProc?.kill();
  server?.kill();
  const failed = results.filter((r) => !r.ok);
  if (!diag.started) console.log('R40 QA : FAIL (navigateur non démarré — jamais PASS sans navigateur)');
  process.exit(failed.length === 0 && diag.started ? 0 : 1);
}

main().catch((e) => {
  console.error('R40 QA crash:', e.message);
  edgeProc?.kill();
  server?.kill();
  process.exit(1);
});
