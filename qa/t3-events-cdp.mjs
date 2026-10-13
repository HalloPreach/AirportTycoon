// T3 (t_4c9baadc) — SONDAGE BROWSEUR : LA COUCHE D'ÉVÉNEMENTS DYNAMIQUES
// (src/sim/events.mjs), dans le navigateur RÉEL (le contrat Node est dans
// tests/events.test.mjs — celui-ci vérifie le CÂBLAGE navigateur : la couche
// vit sur la sim en jeu, un événement déclenché injecte son travail PAR LES
// MODULES EXISTANTS (offre du planning marquée ⚡ / pic de demande), le
// feedback EXISTANT s'exécute (toast « Événement — … », juice burst+float),
// et l'état des événements (compteurs sérialisés) SURVIT à la sauvegarde +
// au rechargement (« Reprendre ») dans le jeu réel).
// Forçage DÉTERMINISTE : la couche est appelée en page avec un rng contrôlé
// (même code de règle que la boucle, même module importé par le jeu —
// /src/sim/events.mjs, instance du module cache) : conférence = tirage 0.3
// (choix index 0), pic = suite [0.3, 0.9] (choix index 2). Le verdict n'est
// PAS forcé : l'état final lu dans la page est celui que le code produit.
// Pattern éprouvé (qa/t22-cdp.mjs, qa/r43-cdp.mjs) : Edge headless + CDP,
// 0 dépendance, Node >= 22 (WebSocket global), serveur statique serve.mjs.
// Usage : node qa/t3-events-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/t3-events-cdp-report.json + captures evidence/t3-events-cdp-*.png (horodatées)
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

// --- 1. serveur statique local (pattern t22-cdp.mjs) --------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t3ev-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern t22-cdp.mjs) ------------------------------
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
    writeFileSync(join(dir, `t3-events-cdp-${ts}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. NOUVELLE PARTIE : la couche est VIVE sur la sim (compteurs par défaut)
  const fresh = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    await new Promise((r) => setTimeout(r, 800)); // quelques ticks (la boucle tourne)
    const sim = g.state.sim;
    return {
      screen: g.state.screen,
      events: JSON.parse(JSON.stringify(sim.events)),
      eventsIsObject: typeof sim.events === 'object',
    };
  })()`, true);
  check('Nouvelle partie : sim.events est VIF sur la sim (compteurs acc/last/seq/fired)',
    fresh.screen === 'game' && fresh.eventsIsObject
    && Number.isFinite(fresh.events.acc) && fresh.events.acc >= 0 && fresh.events.last === 0
    && fresh.events.seq === 0 && typeof fresh.events.fired === 'object',
    JSON.stringify(fresh.events));

  // --- B. CONFÉRENCE (forçage déterministe) : un vol PLEIN est INJECTÉ --------
  // (le module du JEU est importé — /src/sim/events.mjs = l'URL résolue par la
  //  boucle, instance du module cache — le rng contrôlé rend le tirage lisible)
  const conf = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const mod = await import('/src/sim/events.mjs');
    const before = g.juice.stats();
    mod.tickEvents(sim, mod.EVENT_EVERY_S, () => 0.3); // fenêtre complète : tirage 0.3 (< 0.5) → choix index 0 = conférence
    await new Promise((r) => setTimeout(r, 250)); // la boucle consomme l'alerte (toast + juice + SFX) ; le burst (≈0.5–1.3 s) + le float (1.6 s) sont nés
    const entry = sim.planning.find((e) => e.event === 'conference');
    const ac = (await import('/src/data/catalog.mjs')).AIRCRAFT[entry ? entry.acType : ''];
    const after = g.juice.stats();
    return {
      seq: sim.events.seq,
      fired: JSON.parse(JSON.stringify(sim.events.fired)),
      entry: entry ? { acType: entry.acType, pax: entry.pax, status: entry.status, planned: entry.planned, seats: ac.seats } : null,
      alert: sim.alerts.some((a) => a.kind === 'event-start' && a.event === 'conference'),
      toast: document.body.textContent.includes('Événement — Conférence internationale'),
      panelTag: document.body.textContent.includes('⚡ Conférence internationale'),
      juiceBefore: before, juiceAfter: after,
    };
  })()`, true);
  check('CONFÉRENCE : l’événement est DÉCLENCHÉ (sérialisé sur sim.events, compteur tenu)',
    conf.seq === 1 && conf.fired.conference === 1, JSON.stringify({ seq: conf.seq, fired: conf.fired }));
  check('CONFÉRENCE : le vol PLEIN est INJECTÉ via planOneFlight (offre du planning, 100 % des sièges)',
    !!conf.entry && conf.entry.pax === conf.entry.seats && conf.entry.status === 'planned',
    JSON.stringify(conf.entry));
  check('CONFÉRENCE : l’alerte est CONSOMMÉE par le câblage EXISTANT (toast « Événement — … » + marqueur ⚡ du planning)',
    conf.alert === true && (conf.toast === true || conf.panelTag === true),
    JSON.stringify({ alert: conf.alert, toast: conf.toast, panelTag: conf.panelTag }));
  check('CONFÉRENCE : le JUICE s’est exécuté (burst/float de l’alerte — les stats montent)',
    JSON.stringify(conf.juiceBefore) !== JSON.stringify(conf.juiceAfter),
    `avant=${JSON.stringify(conf.juiceBefore)} après=${JSON.stringify(conf.juiceAfter)}`);
  await shot('conference-planning');

  // --- C. PIC TOURISTIQUE (forçage déterministe) : l'incident de DEMANDE ------
  const tour = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const mod = await import('/src/sim/events.mjs');
    const seq = [0.3, 0.9]; let i = 0;
    mod.tickEvents(sim, mod.EVENT_EVERY_S, () => seq[i++ % 2]); // tirage 0.3 (< 0.5), choix floor(0.9×3)=2 → pic
    await new Promise((r) => setTimeout(r, 600));
    return {
      fired: JSON.parse(JSON.stringify(sim.events.fired)),
      surgeActive: sim.incidents.surge.active,
      surgeRemaining: sim.incidents.surge.remaining,
      toast: document.body.textContent.includes('Événement — Pic touristique'),
      sat: sim.passengers.satisfaction,
    };
  })()`, true);
  check('PIC : l’incident de DEMANDE est INJECTÉ via incidents.mjs (état i.surge ACTIF, durée explicite)',
    tour.fired.tourism === 1 && tour.surgeActive === true && tour.surgeRemaining > 0,
    JSON.stringify(tour));
  check('PIC : le feedback EXISTANT a tourné (toast « Événement — Pic touristique » lisible)',
    tour.toast === true, JSON.stringify({ toast: tour.toast }));
  await shot('tourism-surge');

  // --- D. PERSISTANCE : les compteurs des événements SONT SÉRIALISÉS ---------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    g.save();
    const raw = localStorage.getItem('airport-tycoon-save');
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch { /* pas un JSON */ } }
    const sim = parsed?.state?.sim;
    return {
      savedEvents: sim?.events ? JSON.parse(JSON.stringify(sim.events)) : null,
      savedSurge: sim?.incidents?.surge?.active ?? null,
    };
  })()`);
  check('PERSISTANCE : sim.events (seq + fired conférence/pic) est SÉRIALISÉ dans la sauvegarde',
    saved.savedEvents?.seq === 2 && saved.savedEvents?.fired?.conference === 1
    && saved.savedEvents?.fired?.tourism === 1,
    JSON.stringify(saved.savedEvents));

  // --- E. RECHARGEMENT : « Reprendre » RESTAURE la couche (état reproductible)
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
    return {
      screen: g.state.screen,
      seq: sim.events.seq,
      fired: JSON.parse(JSON.stringify(sim.events.fired)),
      surgeActive: sim.incidents.surge.active,
      last: sim.events.last,
    };
  })()`, true);
  check('RECHARGEMENT : la couche REPREND (seq/fired/compteur du dernier événement restaurés)',
    resumed.screen === 'game' && resumed.seq === 2
    && resumed.fired?.conference === 1 && resumed.fired?.tourism === 1
    && typeof resumed.last === 'number',
    JSON.stringify(resumed));
  check('RECHARGEMENT : le pic (incident de l’événement) SURVIT à la reprise',
    resumed.surgeActive === true, JSON.stringify({ surgeActive: resumed.surgeActive }));
  await shot('resume-events');

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 't3-events-cdp-report.json'),
      JSON.stringify({ ok, ts, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} T3 CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR T3 CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
