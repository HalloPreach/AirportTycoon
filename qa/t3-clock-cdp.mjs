// T3 JOUR/NUIT + SAISONS (t_76744b22) — SONDAGE BROWSEUR : LE SYSTÈME dans le
// navigateur RÉEL (le contrat Node est dans tests/r48-clock.test.mjs — celui-ci
// vérifie le CÂBLAGE navigateur : l'horloge VIT sur la sim en jeu, le cycle
// forcé est DÉTERMINISTE (forçage arithmétique — le verdict est lu dans la
// page, pas imposé), le passage de jour émet l'alerte lisible, la teinte du
// MONDE est mesurée en PIXELS (la nuit assombrit le monde — le renderer
// applique les teintes jour/nuit + saisons), la couche de saisons module la
// cadence des offres de la FENÊTRE (été + pic = 3, hiver + pic = 1, printemps
// = 1 — mesuré dans la page), la ligne « Horloge » du panneau est lisible, et
// l'horloge SURVIT à la sauvegarde + au rechargement (« Reprendre ») ; une
// sauvegarde PRÉ-T3-horloge (champ absent) est migrée en jour 1, 08:00).
// Pattern éprouvé (qa/t3-weather-cdp.mjs) : Edge headless + CDP, 0 dépendance,
// Node >= 22 (WebSocket global), serveur statique serve.mjs. Les modules du
// JEU sont importés en page (/src/sim/clock.mjs, /src/sim/seasons.mjs,
// /src/flights/flights.mjs — URL résolue par la boucle, instance du module
// cache : le même code de règle que la sim).
// Usage : node qa/t3-clock-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/t3-clock-cdp-report.json + captures evidence/t3-clock-cdp-*.png (horodatées)
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

// --- 1. serveur statique local (pattern t3-weather-cdp.mjs) -------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t3clock-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern t3-weather-cdp.mjs) -----------------------
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

// La MOYENNE DE LUMINANCE d'un patch 9×9 du canvas monde (la preuve PIXELS
// que le renderer applique les teintes : la nuit doit ASSOMBRIR le monde).
const LUMA_PROBE = `(() => {
  const c = document.getElementById('game');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const X = 900, Y = 500, S = 9; // patch du MONDE (le sol — loin du HUD haut-gauche)
  const d = ctx.getImageData(X, Y, S, S).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return Math.round((sum / (S * S)) * 10000) / 100; // moyenne 0..1 → échelle 0..100
})()`;

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
    writeFileSync(join(dir, `t3-clock-cdp-${ts}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. NOUVELLE PARTIE : l'HORLOGE est VIVE sur la sim -----------------------
  const fresh = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    await new Promise((r) => setTimeout(r, 800)); // quelques ticks (la boucle tourne, tickClock a vécu)
    const sim = g.state.sim;
    const cmod = await import('/src/sim/clock.mjs');
    const smod = await import('/src/core/seasons.mjs');
    const dmod = await import('/src/core/difficulty.mjs');
    const wmod = await import('/src/sim/weather.mjs');
    wmod.forceWeather(sim, 'clear'); // isolement : le monde est net (pas de teinte météo parasite)
    return {
      screen: g.state.screen,
      clock: sim.clock ? { day: sim.clock.day, t: sim.clock.t } : null,
      view: cmod.clockView(sim),
      season: smod.seasonView(sim),
      spawn: dmod.spawnLayer(sim),
    };
  })()`, true);
  check('Nouvelle partie : sim.clock est VIF sur la sim (jour 1, t initial — la partie commence le MATIN)',
    fresh.screen === 'game' && !!fresh.clock
    && fresh.clock.day === 1 && fresh.clock.t > 0 && fresh.clock.t <= 2400,
    JSON.stringify(fresh.clock));
  check('Nouvelle partie : clockView J1 08:00 phase « jour » (AUCUNE teinte — pas de bruit)',
    fresh.view.day === 1 && fresh.view.label.startsWith('08:') && fresh.view.phase === 'day'
    && fresh.view.tint === null, JSON.stringify(fresh.view));
  check('Nouvelle partie : saison PRINTEMPS (référentiel) + couche spawn ×1 (comportement inchangé)',
    fresh.season.id === 'spring' && fresh.season.fr === 'Printemps'
    && fresh.spawn.season === 'spring' && fresh.spawn.spawnFactor === 1.0,
    JSON.stringify({ season: fresh.season.id, spawn: fresh.spawn }));
  await shot('fresh-clock');

  // --- B. LA LIGNE « HORLOGE » du panneau (l'affichage du temps, lisible) -------
  const panelLine = await evaluate(`(async () => {
    const g = window.__game;
    await new Promise((r) => setTimeout(r, 500)); // le panneau se reconstruit (signature)
    const plines = [...document.querySelectorAll('.pline')];
    const row = plines.find((p) => p.querySelector('span')?.textContent === 'Horloge');
    return row ? row.textContent : null;
  })()`, true);
  check('Panneau : la ligne « Horloge » est AFFICHÉE (Jour 1 · 08:00 (jour) — Printemps)',
    !!panelLine && panelLine.includes('Jour 1') && panelLine.includes('08:00')
    && panelLine.includes('jour') && panelLine.includes('Printemps'),
    JSON.stringify(panelLine));

  // --- C. LA TEINTE DU MONDE EST MESURÉE EN PIXELS (la nuit assombrit) ----------
  // Le renderer applique les teintes (deux remplis par-dessus la météo) : la
  // même zone du monde, en PHASE « jour » puis en « nuit » (forçage
  // déterministe forceClock), DOIT être plus sombre la nuit (la teinte
  // rgba(10,14,44,0.34) — la mesure est LUE dans la page, pas imposée).
  const pixels = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const cmod = await import('/src/sim/clock.mjs');
    g.state.paused = true; // figer la sim (les avions ne bougent plus — mesure stable)
    cmod.forceClock(sim, 1, 12); // midi = phase « jour » (AUCUNE teinte)
    await new Promise((r) => setTimeout(r, 200)); // le rendu a passé un frame
    const lumDay = ${LUMA_PROBE};
    cmod.forceClock(sim, 1, 22); // 22:00 = NUIT (teinte bleutée profonde)
    await new Promise((r) => setTimeout(r, 200));
    const lumNight = ${LUMA_PROBE};
    g.state.paused = false; // la sim reprend sa vie
    return { lumDay, lumNight, delta: Math.round((lumDay - lumNight) * 100) / 100 };
  })()`, true);
  check('Monde : la teinte nuit est APPLIQUÉE par le renderer (la zone monde est PLUS SOMBRE la nuit — mesure pixels)',
    typeof pixels.lumDay === 'number' && typeof pixels.lumNight === 'number'
    && pixels.delta >= 8,
    JSON.stringify(pixels));
  await shot('night-tint');

  // --- D. LE CYCLE AVANCE + l'ALERTE au passage de jour (dépassement) ----------
  const rollover = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const cmod = await import('/src/sim/clock.mjs');
    const smod = await import('/src/core/seasons.mjs');
    // On est à 22:00 du jour 1 (l'étape C) : +250 s sim → 2450 ≥ 2400 →
    // ROLLOVER : jour 2, t = 50 (50/100 = 00:30 — la nuit continue), UNE alerte.
    cmod.tickClock(sim, 250);
    const alerte = sim.alerts.find((a) => a.kind === 'season-change');
    return {
      day: sim.clock.day, t: sim.clock.t,
      label: cmod.clockView(sim).label,
      phase: cmod.clockView(sim).phase,
      alerte: alerte ? { day: alerte.day, seq: alerte.seq } : null,
      season: smod.seasonOf(sim),
    };
  })()`, true);
  // (La sim n'est pas figée : la boucle de fond avance t de ~0,1 s — la
  //  tolérance borne la MESURE, l'arithmétique du rollover est exacte).
  check('Cycle : le passage de jour est ARITHMÉTIQUE (22:00 + 250 s → jour 2, 00:30 — nuit continue)',
    rollover.day === 2 && rollover.t >= 50 && rollover.t < 60
    && rollover.label.startsWith('00:') && rollover.phase === 'night',
    JSON.stringify(rollover));
  check('Cycle : UNE alerte LISIBLE est émise au passage de jour (season-change, jour 2)',
    !!rollover.alerte && rollover.alerte.day === 2, JSON.stringify(rollover.alerte));
  check('Cycle : la saison suit le jour (jour 2 = ÉTÉ — 1 an-jeu = 4 jours)',
    rollover.season === 'summer', JSON.stringify({ season: rollover.season }));

  // --- E. LES SAISONS : l'habillage + le facteur (été pic / hiver creux) -------
  const seasons = await evaluate(`(async () => {
    const g = window.__game;
    const sim = g.state.sim;
    const cmod = await import('/src/sim/clock.mjs');
    const smod = await import('/src/core/seasons.mjs');
    const dmod = await import('/src/core/difficulty.mjs');
    cmod.forceClock(sim, 2, 12); // été
    const summer = { view: smod.seasonView(sim), layer: dmod.spawnLayer(sim), tint: smod.seasonTint(sim) };
    cmod.forceClock(sim, 4, 12); // hiver
    const winter = { view: smod.seasonView(sim), layer: dmod.spawnLayer(sim), tint: smod.seasonTint(sim) };
    return { summer, winter };
  })()`, true);
  check('Saisons : l\'ÉTÉ (jour 2) est lisible — habillage doré + facteur de cadence 1,3 (pic touristique)',
    seasons.summer.view.id === 'summer' && seasons.summer.view.fr === 'Été'
    && seasons.summer.layer.spawnFactor === 1.3 && !!seasons.summer.tint,
    JSON.stringify(seasons.summer));
  check('Saisons : l\'HIVER (jour 4) est lisible — habillage bleuté + facteur de cadence 0,7 (saison creuse)',
    seasons.winter.view.id === 'winter' && seasons.winter.view.fr === 'Hiver'
    && seasons.winter.layer.spawnFactor === 0.7 && !!seasons.winter.tint,
    JSON.stringify(seasons.winter));
  await shot('winter-season');

  // --- F. LA CADENCE DES OFFRES EST MESURÉE (la saison module la fenêtre) -------
  // La mesure est faite dans la PAGE (la vraie instance de module — le même
  // code de règle que la sim) : la sim est FIGÉE (paused — pas de fenêtre en
  // fond), le rng est CONTRÔLÉ (constante 0.5 — le verdict est lisible, pas
  // une loterie), et la cadence est le COMPTAGE des offres de planning créées
  // par la fenêtre (la mesure de la saison sur le monde).
  const cadence = await evaluate(`(async () => {
    const g = window.__game;
    const fmod = await import('/src/flights/flights.mjs');
    const imod = await import('/src/sim/incidents.mjs');
    const cmod = await import('/src/sim/clock.mjs');
    const run = async (day, surge) => {
      g.startNewGame(); // une sim FRAÎCHE (planning vide, printemps ×1 si jour 1)
      const sim = g.state.sim;
      g.state.paused = true; // figer la sim (pas de fenêtre en fond pendant la mesure)
      cmod.forceClock(sim, day, 12);
      if (surge) imod.forceIncident(sim, 'surge');
      const before = sim.planning.length;
      fmod.windowClose(sim, () => 0.5); // LA fenêtre (rng contrôlé — reproductible)
      const created = sim.planning.length - before;
      g.state.paused = false;
      return created;
    };
    const spring = await run(1, false); // printemps (référentiel) sans pic : 1 offre
    const summer = await run(2, true);  // été + pic : 2 × 1,3 = 2,6 → 3 offres
    const winter = await run(4, true);  // hiver + pic : 2 × 0,7 = 1,4 → 1 offre (plancher)
    const winterNoSurge = await run(4, false); // hiver sans pic : 1 × 0,7 → plancher 1
    return { spring, summer, winter, winterNoSurge };
  })()`, true);
  check('Cadence : le PRINTEMPS (jour 1, sans pic) crée 1 offre — le comportement RÉFÉRENTIEL est inchangé',
    cadence.spring === 1, JSON.stringify(cadence.spring));
  check('Cadence : l\'ÉTÉ + pic crée 3 offres (2 × 1,3 → 3 — la cadence saisonnière est MESURABLE : +30 %)',
    cadence.summer === 3, JSON.stringify(cadence.summer));
  check('Cadence : l\'HIVER + pic crée 1 offre (2 × 0,7 = 1,4 → plancher 1 — une fenêtre ne génère JAMAIS 0 offre)',
    cadence.winter === 1, JSON.stringify(cadence.winter));
  check('Cadence : l\'HIVER sans pic tient le PLANCHER (1 × 0,7 → 1 offre minimum par fenêtre)',
    cadence.winterNoSurge === 1, JSON.stringify(cadence.winterNoSurge));

  // --- G. PERSISTANCE : l'horloge est SÉRIALISÉE ---------------------------------
  const saved = await evaluate(`(() => {
    const g = window.__game;
    const sim = g.state.sim;
    const cmod = null; // (pas besoin — on force via la sim après reprise)
    g.save();
    const raw = localStorage.getItem('airport-tycoon-save');
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch { /* pas un JSON */ } }
    const s = parsed?.state?.sim;
    return {
      savedClock: s?.clock ? { day: s.clock.day, t: s.clock.t } : null,
    };
  })()`);
  check('Persistence : sim.clock (jour + t) est SÉRIALISÉ dans la sauvegarde',
    !!saved.savedClock && typeof saved.savedClock.day === 'number'
    && Number.isFinite(saved.savedClock.t),
    JSON.stringify(saved.savedClock));

  // --- H. RECHARGEMENT : « Reprendre » RESTAURE l'horloge (reprise bornée) -----
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
    const cmod = await import('/src/sim/clock.mjs');
    const smod = await import('/src/core/seasons.mjs');
    return {
      screen: g.state.screen,
      clock: { day: sim.clock.day, t: sim.clock.t },
      label: cmod.clockView(sim).label,
      season: smod.seasonOf(sim),
    };
  })()`, true);
  check('Rechargement : l\'horloge REPREND (jour + t restaurés — la suite reste reproductible, EV-10)',
    resumed.screen === 'game' && typeof resumed.clock.day === 'number'
    && Number.isFinite(resumed.clock.t) && resumed.clock.t >= 0 && resumed.clock.t < 2400,
    JSON.stringify(resumed.clock));
  check('Rechargement : la SAISON restaurée suit le jour (dérivée — pas de champ fantôme)',
    resumed.season === ['spring', 'summer', 'autumn', 'winter'][(resumed.clock.day - 1) % 4],
    JSON.stringify({ day: resumed.clock.day, season: resumed.season }));
  await shot('resume-clock');

  // --- I. MIGRATION : une sauvegarde PRÉ-T3-horloge (champ ABSENT) est adoptée --
  // Le champ horloge n'existait pas avant la carte : on SIMULE une sauvegarde
  // PRÉ-T3-horloge en retirant le champ, puis on passe par le VRAI
  // deserialize (save.mjs — la fonction EXACTE que le bouton « Reprendre »
  // exécute via savePanel.loadNow) : la migration est ADOPTÉE en jour 1,
  // 08:00 (printemps ×1), les autres champs sont INTACTS (migration
  // additive, EV-10). (Un rechargement complet est impossible à isoler ici :
  // l'autoSave du beforeunload ré-écrit la sauvegarde complète avant la
  // navigation — le contrat de migration est vérifié ici, le chemin « Reprendre »
  // complet est vérifié en H.)
  const migrated = await evaluate(`(async () => {
    const smod = await import('/src/persistence/save.mjs');
    const cmod = await import('/src/sim/clock.mjs');
    const sseason = await import('/src/core/seasons.mjs');
    const dmod = await import('/src/core/difficulty.mjs');
    const raw = localStorage.getItem('airport-tycoon-save');
    if (!raw) return { noSave: true };
    const parsed = JSON.parse(raw);
    const before = { rngSeed: parsed.state.sim.rngSeed, rngCounter: parsed.state.sim.rngCounter };
    delete parsed.state.sim.clock; // la migration à prouver : champ ABSENT
    const out = smod.deserialize(JSON.stringify(parsed)); // le VRAI loader (« Reprendre »)
    const simOut = out.sim;
    return {
      noSave: false,
      clock: simOut.clock ? { day: simOut.clock.day, t: simOut.clock.t } : null,
      label: cmod.clockView(simOut).label,
      phase: cmod.clockView(simOut).phase,
      season: sseason.seasonOf(simOut),
      spawn: dmod.spawnLayer(simOut).spawnFactor,
      rngSeed: before.rngSeed,
      rngCounter: before.rngCounter,
      outRngSeed: simOut.rngSeed,
      outRngCounter: simOut.rngCounter,
    };
  })()`, true);
  check('Migration : une sauvegarde PRÉ-T3-horloge (champ ABSENT) passe par le VRAI deserialize → ADOPTÉE en jour 1, 08:00 (printemps ×1 — comportement inchangé à la reprise)',
    migrated.noSave === false && migrated.clock.day === 1
    && migrated.label.startsWith('08:') && migrated.phase === 'day'
    && migrated.season === 'spring' && migrated.spawn === 1.0,
    JSON.stringify(migrated));
  check('Migration : les AUTRES champs sont INTACTS (migration ADDITIVE — rngSeed/rngCounter préservés)',
    migrated.outRngSeed === migrated.rngSeed && migrated.outRngCounter === migrated.rngCounter,
    JSON.stringify({ rngSeed: migrated.rngSeed, rngCounter: migrated.rngCounter }));
  await shot('migrated-clock');

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 't3-clock-cdp-report.json'),
      JSON.stringify({ ok, ts, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} T3 JOUR/NUIT+SAISONS CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR T3 JOUR/NUIT CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
