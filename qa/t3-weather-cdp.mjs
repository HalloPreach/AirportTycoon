// T3 MÉTÉO (t_9b665a8b) — SONDAGE BROWSEUR : LE SYSTÈME MÉTÉO dans le
// navigateur RÉEL (le contrat Node est dans tests/r46-weather.test.mjs —
// celui-ci vérifie le CÂBLAGE navigateur : la météo VIT sur la sim en jeu,
// le cycle forcé est DÉTERMINISTE (forçage + tirage contrôlé — le verdict est
// lu dans la page, pas imposé), l'incident MÉTÉO s'affiche dans le panneau
// diagnostic avec ses DEUX réponses, le clic BOUTON (réponse intervention,
// la règle est dans respondIncident) débite le coût et ramène les effets à
// l'état courant, et l'état météo + l'incident SURVIVENT à la sauvegarde +
// au rechargement (« Reprendre ») dans le jeu réel).
// Pattern éprouvé (qa/t3-events-cdp.mjs, qa/t22-cdp.mjs) : Edge headless +
// CDP, 0 dépendance, Node >= 22 (WebSocket global), serveur statique
// serve.mjs. Le module du JEU est importé en page (/src/sim/weather.mjs,
// /src/sim/incidents.mjs — URL résolue par la boucle, instance du module
// cache : le même code de règle que la sim).
// Usage : node qa/t3-weather-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/t3-weather-cdp-report.json + captures evidence/t3-weather-cdp-*.png (horodatées)
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

// --- 1. serveur statique local (pattern t3-events-cdp.mjs) ---------------------
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

const port = freePort();
const cdpPort = freePort();
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t3wx-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern t3-events-cdp.mjs) -------------------------
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
    writeFileSync(join(dir, `t3-weather-cdp-${ts}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. NOUVELLE PARTIE : la MÉTÉO est VIVE sur la sim --------------------------
  const fresh = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    await new Promise((r) => setTimeout(r, 800)); // quelques ticks (la boucle tourne, tickWeather a vécu)
    const sim = g.state.sim;
    const w = sim.weather;
    return {
      screen: g.state.screen,
      weather: w ? { state: w.state, remaining: w.remaining, acc: w.acc } : null,
      alerts: sim.alerts ? sim.alerts.length : null,
    };
  })()`, true);
  check('Nouvelle partie : sim.weather est VIF sur la sim (état « clear » né, compteurs bornés)',
    fresh.screen === 'game' && !!fresh.weather
    && typeof fresh.weather.state === 'string' && fresh.weather.remaining > 0
    && Number.isFinite(fresh.weather.acc) && fresh.weather.acc >= 0,
    JSON.stringify(fresh.weather));
  await shot('fresh-weather');

  // --- B. CYCLE forcé DÉTERMINISTE : orage → (tick 320 s, tirage 0) → clair ----
  const cycle = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const wmod = await import('/src/sim/weather.mjs');
    wmod.forceWeather(sim, 'storm');
    const alerte = sim.alerts.some((a) => a.kind === 'weather-change' && a.to === 'storm');
    wmod.tickWeather(sim, 320, () => 0); // durée orage 300 s dépassée : transition, tirage 0 → « clear » (bornes)
    return {
      state: sim.weather.state,
      remaining: sim.weather.remaining,
      alerte,
      view: wmod.weatherView(sim),
    };
  })()`, true);
  check('Cycle : forceWeather(orage) est ADOPTE (état + alerte weather-change lisible dans sim.alerts)',
    cycle.alerte === true, JSON.stringify(cycle));
  check('Cycle : la transition est DÉTERMINISTE (320 s, tirage 0 → « clear », durée bornée 720–1080 s)',
    cycle.state === 'clear' && cycle.remaining >= 720 && cycle.remaining <= 1080,
    JSON.stringify({ state: cycle.state, remaining: cycle.remaining }));
  check('Cycle : weatherView est LISIBLE (état + FR + effet — lues par le HUD/panneau)',
    cycle.view.state === 'clear' && cycle.view.fr === 'clair' && cycle.view.speed === 1 && cycle.view.incident === false,
    JSON.stringify(cycle.view));
  await shot('cycle-clear');

  // --- C. EFFETS MESURÉS : pluie = vitesse 0,7 + retard 30 s (la règle unique) --
  const effects = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const wmod = await import('/src/sim/weather.mjs');
    wmod.forceWeather(sim, 'rain');
    return wmod.weatherEffect(sim); // LA règle lue par aircraft.mjs
  })()`, true);
  check('Effets : la pluie ralentit l\'approche (speed 0,7) + retard d\'attente 30 s (règle unique de weatherEffect)',
    effects.speed === 0.7 && effects.delay === 30, JSON.stringify(effects));

  // --- D. INCIDENT MÉTÉO : le panneau diagnostic affiche l'incident + 2 réponses -
  // La réponse passe par le BOUTON du panneau (la règle est dans respondIncident,
  // pattern éprouvé r42-cdp.mjs). L'état reste « pluie » : l'intervention doit
  // ramener les effets à la LIGNE PLUIE (pas au clair — l'état courant).
  const incident = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const imod = await import('/src/sim/incidents.mjs');
    const wmod = await import('/src/sim/weather.mjs');
    imod.forceIncident(sim, 'weather');
    await new Promise((r) => setTimeout(r, 400)); // le panneau se reconstruit (signature changée)
    const spentBefore = sim.economy.spent.intervention ?? 0; // compteur EXACT (la boucle tourne en arrière-plan : le solde brut est pollué par les recettes du tick)
    // Ligne « Météo » du panneau diagnostic + les DEUX boutons de réponse.
    const plines = [...document.querySelectorAll('.pline')];
    const wxRow = plines.find((p) => p.querySelector('span')?.textContent === 'Météo');
    const rows = [];
    if (wxRow) {
      let sib = wxRow.nextElementSibling;
      while (sib && sib.classList.contains('pline') && sib.querySelector('button.resp')) {
        const b = sib.querySelector('button.resp');
        rows.push(b.textContent);
        sib = sib.nextElementSibling;
      }
    }
    const btn = [...document.querySelectorAll('button.resp')]
      .find((b) => b.textContent.includes('Intervention d\\'urgence') && b.textContent.includes('750 $'));
    if (btn) btn.click(); // l'intention émise PAR LA UI (la règle est dans respondIncident)
    await new Promise((r) => setTimeout(r, 200));
    const spentAfter = sim.economy.spent.intervention ?? 0;
    return {
      interventionCost: spentAfter - spentBefore,
      active: sim.incidents.weather.active,
      remaining: sim.incidents.weather.remaining,
      row: wxRow ? wxRow.textContent : null,
      rows,
      effectNow: wmod.weatherEffect(sim), // après intervention : la LIGNE PLUIE (état courant)
      view: wmod.weatherView(sim),
    };
  })()`, true);
  check('Incident : l\'état ACTIF est lisible (i.weather, durée WEATHER_OUT_S) et la ligne « Météo » du panneau est affichée',
    incident.row && incident.row.includes('incident météo'), JSON.stringify({ row: incident.row }));
  check('Incident : le panneau offre les DEUX réponses (attendre 0 $ / intervention 750 $ — arbitrage réel)',
    incident.rows.length === 2 && incident.rows.some((t) => t.includes('Attendre'))
    && incident.rows.some((t) => t.includes('750 $')), JSON.stringify(incident.rows));
  check('Incident : le CLIC BOUTON (intervention) débite 750 $ (compteur exact) et REFERME l\'incident',
    incident.interventionCost === 750 && incident.active === false && incident.remaining === 0,
    JSON.stringify({ interventionCost: incident.interventionCost, active: incident.active, remaining: incident.remaining }));
  check('Incident : les effets reviennent à l\'état courant (PLUIE — speed 0,7, pas le « clair »)',
    incident.effectNow.speed === 0.7 && incident.effectNow.delay === 30 && incident.view.incident === false,
    JSON.stringify({ effectNow: incident.effectNow, incident: incident.view.incident }));
  await shot('incident-weather');

  // --- E. PERSISTANCE : l'état météo + l'incident SONT SÉRIALISÉS -----------------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    g.save();
    const raw = localStorage.getItem('airport-tycoon-save');
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch { /* pas un JSON */ } }
    const sim = parsed?.state?.sim;
    return {
      savedWeather: sim?.weather ? { state: sim.weather.state, remaining: sim.weather.remaining } : null,
      savedIncident: sim?.incidents?.weather ? { active: sim.incidents.weather.active } : null,
    };
  })()`);
  check('Persistence : sim.weather (état + compteurs) est SÉRIALISÉ dans la sauvegarde',
    !!saved.savedWeather && typeof saved.savedWeather.state === 'string' && saved.savedWeather.remaining > 0,
    JSON.stringify(saved.savedWeather));
  check('Persistence : l\'incident météo (i.weather) est SÉRIALISÉ (fin d\'incident : active = false)',
    !!saved.savedIncident && saved.savedIncident.active === false,
    JSON.stringify(saved.savedIncident));

  // --- F. RECHARGEMENT : « Reprendre » RESTAURE la météo (état reproductible) ----
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  const resumed = await evaluate(`(async () => {
    const g = window.__game;
    const resume = [...document.querySelectorAll('.menu-btns button')]
      .find((b) => b.textContent.includes('Reprendre'));
    if (!resume || resume.style.display === 'none') return { noResumeBtn: true };
    resume.click();
    await new Promise((r) => setTimeout(r, 600));
    const sim = g.state.sim;
    const wmod = await import('/src/sim/weather.mjs');
    return {
      screen: g.state.screen,
      weather: { state: sim.weather.state, remaining: sim.weather.remaining },
      effect: wmod.weatherEffect(sim),
      incidentActive: sim.incidents.weather.active,
    };
  })()`, true);
  check('Rechargement : la météo REPREND (état + durée restaurés — la suite reste reproductible, EV-10)',
    resumed.screen === 'game' && typeof resumed.weather.state === 'string' && resumed.weather.remaining > 0,
    JSON.stringify(resumed.weather));
  check('Rechargement : l\'état météo courant pilote l\'effet ACTIF (pas d\'effet fantôme de l\'incident terminé)',
    resumed.incidentActive === false && typeof resumed.effect.speed === 'number' && resumed.effect.speed > 0,
    JSON.stringify(resumed.effect));
  await shot('resume-weather');

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 't3-weather-cdp-report.json'),
      JSON.stringify({ ok, ts, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} T3 MÉTÉO CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR T3 MÉTÉO CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
