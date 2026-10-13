// T3 stretch (t_79820790) — MULTI-AÉROPORTS : le SECOND aéroport « Cap Nord »
// DANS LE JEU RÉEL (navigateur) — le scénario capNord (scenarios.mjs, layout
// src/core/layouts.mjs : 2 pistes L/M + terminal 4 portes) est
//  • VISIBLE dans l'UI (le bouton du scénario EST DANS LE MENU — l'UI est
//    dérivée du catalogue SCENARIOS, comme T33/T41),
//  • MESURABLE (le profil DIFFÉRENT est sur la sim : 2 pistes dont une
//    L-capable, 4 portes L/M/M/L, budget mesuré CAP_NORD_FUNDS, marqueur
//    state.scenario additif),
//  • et il SURVIT à la sauvegarde + « Reprendre » (le profil REPREND).
// Pattern éprouvé qa/t3-events-cdp.mjs : Edge headless + CDP, 0 dépendance,
// Node >= 22. La sim est réelle : le module importé dans la page EST la même
// instance que la boucle du jeu (cache module — pas de re-implémentation).
//
// Usage : node qa/r49-airports-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/r49-airports-cdp-report.json + captures
// evidence/r49-airports-cdp-*.png (horodatées).
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const diag = { browser: null, spawnError: null, cdpTarget: null, started: false, page: null };
const pageExceptions = [];
const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{6})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3-$4');

const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
diag.browser = edge;

// --- 1. serveur statique local (pattern t3-events-cdp.mjs) -------------------
function freePort() { return 8900 + Math.floor(Math.random() * 500); }
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-r49-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern t3-events-cdp.mjs) ------------------------
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

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up, `http://127.0.0.1:${port}`);
  if (!up) return finish();
  if (!edge) {
    check('navigateur Edge introuvable', false,
      `aucun candidat existant : ${EDGE_CANDIDATES.join(' | ')}`);
    return finish();
  }
  const target = await startBrowser();
  if (!target) {
    check('navigateur démarré', false,
      `Edge headless n'expose aucune cible CDP (exécutable=${edge}) stderr=${(diag.spawnError || '').slice(0, 300)}`);
    return finish();
  }
  check('navigateur démarré (cible CDP page)', true, `${edge}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageExceptions.push(((d.exception?.description || d.text || '') + '').slice(0, 300));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cdp = (method, params = {}) => {
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, { resolve });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  async function evaluate(expression, awaitPromise = false) {
    const msg = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (msg.result.exceptionDetails) {
      throw new Error('exception page : ' + (msg.result.exceptionDetails.exception?.description || JSON.stringify(msg.result.exceptionDetails)));
    }
    return msg.result.result.value;
  }
  async function shot(name) {
    const s = await cdp('Page.captureScreenshot', { format: 'png' });
    const dir = join(import.meta.dirname, '..', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `r49-airports-cdp-${ts}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  // Attente ROBUSTE du boot (le module graph + le headless fraîchement démarré
  // peuvent dépasser 1,5 s — on SONDE jusqu'à 10 s, pas un sleep à l'aveugle).
  let booted = false;
  for (let i = 0; i < 20 && !booted; i++) {
    await new Promise((r) => setTimeout(r, 500));
    booted = (await evaluate('typeof window.__game')) === 'object';
  }
  check('window.__game exposé (boot complet)', booted);

  // --- A. MENU : le bouton du scénario Cap Nord est VISIBLE ------------------
  // (l'UI est dérivée du catalogue SCENARIOS — pas de ligne de code ajoutée
  //  pour le bouton ; le libellé EST le nom du scénario, lu du module)
  const menu = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.menu-btns button')];
    const cap = btns.find((b) => b.textContent.includes('Cap Nord'));
    return { labels: btns.map((b) => b.textContent.trim()), hasCap: !!cap, total: btns.length };
  })()`);
  check('MENU : le bouton « Cap Nord — aéroport du nord » est VISIBLE (déduit du catalogue SCENARIOS)',
    menu.hasCap === true, `libellés : ${menu.labels.join(' | ')}`);
  await shot('menu-capnord');

  // --- B. LANCEMENT : le profil DIFFÉRENT est sur la sim ---------------------
  // (le clic EST le geste du joueur — le câblage EXISTANT startScenarioGame,
  //  pas un forçage : seed imposée, budget mesuré, marqueur additif)
  const started = await evaluate(`(async () => {
    const g = window.__game;
    const cap = [...document.querySelectorAll('.menu-btns button')].find((b) => b.textContent.includes('Cap Nord'));
    if (!cap) return { noBtn: true };
    cap.click();
    // Lecture IMMÉDIATE (synchrone, avant le prochain tick) : le budget du
    // scénario EST celui imposé par startScenario (CAP_NORD_FUNDS).
    const moneyAtStart = g.state.sim.economy.money;
    await new Promise((r) => setTimeout(r, 500)); // quelques ticks (la boucle tourne)
    const sim = g.state.sim;
    // Les modules du JEU (MÊME instance que la boucle — cache module) :
    // le critère L-capable EST lu du catalogue (pas un chiffre inventé).
    const cat = await import('/src/data/catalog.mjs');
    const infra = await import('/src/infra/infra.mjs');
    const largeMin = cat.AIRCRAFT.large.minRunway; // 800 (le critère L du catalogue)
    const mediumMin = cat.AIRCRAFT.medium.minRunway; // 500 (le critère M)
    return {
      screen: g.state.screen,
      scenario: JSON.parse(JSON.stringify(g.state.scenario)),
      moneyAtStart,
      runways: sim.infra.runways.map((r) => r.len).sort((a, b) => a - b),
      taxiways: sim.infra.taxiways.length,
      gates: sim.infra.gates.map((gr) => gr.size),
      rngSeed: sim.rngSeed,
      largeServed: !!infra.runwayFor(sim, largeMin), // la piste L-capable EST servable
      mediumServed: !!infra.runwayFor(sim, mediumMin),
      largeMin, mediumMin,
      toast: document.body.textContent.includes('Cap Nord'),
    };
  })()`, true);
  check('LANCEMENT : le scénario capNord est sur la sim (marqueur additif state.scenario)',
    started.scenario?.id === 'capNord' && started.scenario?.airport === 'cap-nord' && started.screen === 'game',
    JSON.stringify(started.scenario));
  check('LANCEMENT : le profil DIFFÉRENT (2 pistes 500/800 + 3 taxiways + 4 portes L/M/M/L)',
    JSON.stringify(started.runways) === '[500,800]' && started.taxiways === 3
    && JSON.stringify(started.gates) === JSON.stringify(['L', 'M', 'M', 'L']),
    `runways=${JSON.stringify(started.runways)} gates=${JSON.stringify(started.gates)}`);
  check('LANCEMENT : la piste L-capable (800, critère lu du catalogue) EST servable par la sim (runwayFor)',
    started.largeServed === true && started.mediumServed === true,
    `largeMin=${started.largeMin} mediumMin=${started.mediumMin}`);
  check('LANCEMENT : budget EXPLICITE (CAP_NORD_FUNDS, mesuré par le replay 48 h) + seed imposée',
    started.moneyAtStart === 12000 && started.rngSeed === 24,
    `money=${started.moneyAtStart} seed=${started.rngSeed}`);
  check('LANCEMENT : l’objectif R22 du scénario est ANNONCÉ en toast (le câblage EXISTANT)',
    started.toast === true, 'toast « Scénario Cap Nord — objectif : … »');
  await shot('game-capnord');

  // --- C. VIVANT : le trafic TOURNE sur le second aéroport --------------------
  // (les deux gestes sont ceux du JOUEUR RÉEL : la VITESSE x4 par le bouton du
  //  panneau options (le câblage EXISTANT, main.mjs :74) + la CASE auto-accept
  //  du panneau planning. La sim DÉCIDE les vols (fenêtres de 60 s sim =
  //  SPAWN_EVERY_S), le test n'en force aucun — il SONDE jusqu'à la preuve.)
  const alive = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    // Vitesse x4 (le bouton RÉEL du panneau — la commande setSpeed existe
    // depuis x1 : la première occurrence est visible au panneau options).
    const speedBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Vitesse x4');
    let speedToggled = false;
    if (speedBtn) { speedBtn.click(); speedToggled = g.state.speedIndex === 2; } // SPEEDS[2] = x4
    // La CASE auto-accept du panneau (le miroir DOM de state.planningAuto).
    const cb = document.querySelector('.planning-auto input');
    let autoOn = false;
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); autoOn = !!g.state.planningAuto; }
    // Le planificateur crée une offre par FENÊTRE de 60 s sim (x4 → 15 s réelles) :
    // on sonde jusqu'à la première offre, sans sleep à l'aveugle (max ~60 s).
    let t0 = Date.now();
    while (Date.now() - t0 < 60000 && sim.planning.length === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 5000)); // le temps de la décision auto + déploiement
    const statuses = {};
    for (const e of sim.planning) statuses[e.status] = (statuses[e.status] || 0) + 1;
    return {
      speedToggled, autoOn, statuses,
      aircraft: sim.aircraft.length,
      carried: sim.passengers.totalCarried,
      simTime: Math.round(sim.time),
      money: Math.round(sim.economy.money),
      finite: [sim.economy.money, sim.passengers.satisfaction, sim.passengers.totalCarried].every(Number.isFinite),
      toastAuto: document.body.textContent.includes('Auto-accept ON'),
    };
  })()`, true);
  const handled = (alive.statuses?.accepted || 0) + (alive.statuses?.['in-flight'] || 0) + (alive.statuses?.departed || 0);
  check('VIVANT : le planificateur CRÉE des offres sur le second aéroport (fenêtres 60 s sim, x4 réel)',
    Object.keys(alive.statuses || {}).length > 0, `statuts : ${JSON.stringify(alive.statuses)} (t=${alive.simTime} s sim)`);
  check('VIVANT : les offres sont TRAITÉES (auto-accept réelle par la case du panneau, aucun forçage)',
    handled > 0,
    `auto-accept=${alive.autoOn} toast=${alive.toastAuto} géré=${handled} aircraft=${alive.aircraft} carried=${alive.carried}`);
  check('VIVANT : la vitesse x4 EST appliquée LIVE (le geste du joueur est réversible)',
    alive.speedToggled === true, 'bouton « Vitesse x4 » du panneau options');
  check('VIVANT : l’état sim reste COHÉRENT (valeurs finies, passagers comptés)',
    alive.finite === true && alive.aircraft >= 0,
    `aircraft=${alive.aircraft} carried=${alive.carried} money=${alive.money}`);

  // --- D. PERSISTANCE : la sauvegarde + « Reprendre » RESTAURENT le profil ---
  const saved = await evaluate(`(() => {
    const g = window.__game;
    g.save();
    const raw = localStorage.getItem('airport-tycoon-save');
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch { /* pas un JSON */ } }
    const sim = parsed?.state?.sim;
    return {
      savedAirport: parsed?.state?.scenario?.airport ?? null,
      savedRunways: sim?.infra?.runways?.length ?? null,
      savedGates: sim?.infra?.gates?.length ?? null,
      savedMoney: sim?.economy?.money ?? null,
    };
  })()`);
  check('PERSISTANCE : le profil Cap Nord est SÉRIALISÉ (marqueur + 2 pistes + 4 portes)',
    saved.savedAirport === 'cap-nord' && saved.savedRunways === 2 && saved.savedGates === 4,
    JSON.stringify(saved));

  await cdp('Page.navigate', { url });
  let booted2 = false;
  for (let i = 0; i < 20 && !booted2; i++) {
    await new Promise((r) => setTimeout(r, 500));
    booted2 = (await evaluate('typeof window.__game')) === 'object';
  }
  if (!booted2) return finish();
  const resumed = await evaluate(`(async () => {
    const g = window.__game;
    const resume = [...document.querySelectorAll('.menu-btns button')].find((b) => b.textContent.includes('Reprendre'));
    if (!resume || resume.style.display === 'none') return { noResumeBtn: true };
    resume.click();
    await new Promise((r) => setTimeout(r, 600));
    const sim = g.state.sim;
    return {
      screen: g.state.screen,
      airport: g.state.scenario?.airport ?? null,
      runways: sim.infra.runways.length,
      gates: sim.infra.gates.length,
      seed: sim.rngSeed,
      money: Math.round(sim.economy.money),
    };
  })()`, true);
  check('RECHARGEMENT : « Reprendre » RESTAURE le profil (2 pistes, 4 portes, marqueur, seed)',
    resumed.screen === 'game' && resumed.airport === 'cap-nord'
    && resumed.runways === 2 && resumed.gates === 4 && resumed.seed === 24,
    JSON.stringify(resumed));
  await shot('resume-capnord');

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 'r49-airports-cdp-report.json'),
      JSON.stringify({ ok, ts, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} R49 CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR R49 CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
