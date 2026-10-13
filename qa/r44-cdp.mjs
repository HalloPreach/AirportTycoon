// R44 (t_ebbb202e) — SONDAGE BROWSEUR : SYNTHÈSE AUDIO + MUTE PERSISTANT,
// dans le navigateur RÉEL (le contrat Node est dans tests/audio.test.mjs —
// celui-ci vérifie le CÂBLAGE navigateur : le moteur exposé sur __game.audio,
// le contexte Web Audio créé au 1er play (pas de dry), le SFX déclenché par
// l'ALERTE de la sim (portée seq du toast/juice, main.mjs), la touche M
// (mute sur l'ÉTAT → synchronisé sur le moteur), la PERSISTANCE du mute via
// la sauvegarde (state.audio sérialisé — pas un second stockage), et que le
// VOLUME (R43) survive au mute).
// Pattern éprouvé (qa/r43-cdp.mjs) : Edge headless + CDP, 0 dépendance,
// Node >= 22 (WebSocket global), serveur statique serve.mjs.
// Usage : node qa/r44-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/r44-cdp-report.json
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const diag = { browser: null, spawnError: null, cdpTarget: null, started: false, page: null };
const pageExceptions = [];

const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
diag.browser = edge;

// --- 1. serveur statique local (pattern r43-cdp.mjs) --------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-r44-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern r43-cdp.mjs) ------------------------------
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
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. boot : le moteur est câblé (volume R43 appliqué, non muet, pas d'ambiance)
  const boot = await evaluate(`(() => {
    const g = window.__game;
    return {
      kind: typeof g.audio,
      api: ['play', 'setVolume', 'setMuted', 'stats'].every((m) => typeof g.audio[m] === 'function'),
      stats: g.audio.stats(),
    };
  })()`);
  check('moteur audio exposé (API play/setVolume/setMuted/stats)',
    boot.kind === 'object' && boot.api, JSON.stringify(boot.stats));
  check('boot : volume R43 (50) appliqué au moteur (0.5), non muet, ambiance OFF',
    boot.stats?.volume === 0.5 && boot.stats.muted === false && boot.stats.ambient === false,
    JSON.stringify(boot.stats));

  // --- B. nouvelle partie + vol forcé : l'ALERTE de la sim SONNE (portée seq)
  // Vol medium forcé (comme qa/cdp-boot.mjs) : il atterrit (flight-in → land)
  // puis repart (flight-out → takeoff). Le SFX part du frame handler (MÊME
  // porte seq que le toast et le juice) → on attend UNE frame après les ticks.
  const simOut = await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    g.state.paused = false;
    const { tick } = await import('./src/core/tick.mjs');
    const sim = g.state.sim;
    sim.aircraft.push({ // vol forcé : cycle complet sur l'aéroport fourni
      id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 80,
      phase: 'approach', x: 800, y: -150, gateId: null, runwayId: null,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
    for (let i = 0; i < 600; i++) tick(g.state, 1); // 600 s de jeu (x1)
    const a = g.audio.stats();
    return {
      departed: (g.state.sim.alerts || []).filter((x) => x.kind === 'flight-out').length,
      plays: a.plays, dry: a.dry, ctxState: a.ctxState, last: a.last,
    };
  })()`, true);
  await new Promise((r) => setTimeout(r, 400)); // les frames consomment les alertes (portée seq)
  const sfx = await evaluate(`(() => {
    const a = window.__game.audio.stats();
    return { plays: a.plays, dry: a.dry, ctxState: a.ctxState, last: a.last, names: a.plays > 0 ? 'ok' : 'none' };
  })()`);
  check('vol forcé : les alertes de la sim SONNENT (SFX par groupe, portée seq)',
    (simOut?.departed || 0) > 0 && (sfx?.plays || 0) > 0 && sfx?.dry === false,
    `départs=${simOut?.departed} plays=${sfx?.plays} dernier=${sfx?.last?.name} (le mapping exact kind→SFX est verrouillé Node : tests/audio.test.mjs)`);
  check('contexte Web Audio réel créé au 1er play (plus de dry, 0 exception)',
    sfx?.dry === false && (sfx?.ctxState === 'running' || sfx?.ctxState === 'suspended'),
    `ctxState=${sfx?.ctxState}`);

  // --- C. touche M : le mute vit sur l'ÉTAT (synchronisé sur le moteur) --------
  const muteOn = await evaluate(`(async () => {
    const g = window.__game;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await new Promise((r) => setTimeout(r, 100));
    return {
      stateMuted: g.state.audio.muted,
      engineMuted: g.audio.stats().muted,
      volumeKept: g.audio.getVolume(), // le volume (R43) n'est PAS touché
      toast: document.body.textContent.includes('Muet activé'),
    };
  })()`, true);
  check('touche M : mute activé (état + moteur), toast, volume intact (0.5)',
    muteOn?.stateMuted === true && muteOn.engineMuted === true && muteOn.volumeKept === 0.5 && muteOn.toast,
    JSON.stringify(muteOn));
  const muteOff = await evaluate(`(async () => {
    const g = window.__game;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await new Promise((r) => setTimeout(r, 100));
    return {
      stateMuted: g.state.audio.muted,
      engineMuted: g.audio.stats().muted,
      toast: document.body.textContent.includes('Son réactivé'),
    };
  })()`, true);
  check('touche M : dé-mute (état + moteur repassent au volume courant)',
    muteOff?.stateMuted === false && muteOff.engineMuted === false && muteOff.toast,
    JSON.stringify(muteOff));

  // --- D. PERSISTANCE : le mute survit à la sauvegarde/reprise (pas de 2e stockage)
  const persist = await evaluate(`(async () => {
    const g = window.__game;
    // On mute, on sauvegarde (slot unique), on relit la sauvegarde BRUTE.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await new Promise((r) => setTimeout(r, 100));
    const saved = g.save();
    const raw = JSON.parse(localStorage.getItem('airport-tycoon-save'));
    // Puis on recharge (bouton/touche L — onLoad : normalisation + synchro moteur).
    const ok = g.load();
    return {
      saved, ok,
      savedMuted: raw?.state?.audio?.muted,
      afterLoadState: g.state.audio.muted,
      afterLoadEngine: g.audio.stats().muted,
      volumeKept: g.audio.getVolume(),
    };
  })()`, true);
  check('PERSISTANCE : le mute est SÉRIALISÉ dans la sauvegarde (state.audio)',
    persist?.saved === true && persist.savedMuted === true,
    JSON.stringify({ savedMuted: persist?.savedMuted }));
  check('PERSISTANCE : après rechargement, état + moteur retrouvent le mute (volume intact)',
    persist?.ok === true && persist.afterLoadState === true && persist.afterLoadEngine === true
    && persist.volumeKept === 0.5,
    JSON.stringify({ state: persist?.afterLoadState, engine: persist?.afterLoadEngine }));

  // --- E. le MUTE ne casse pas le jeu (la sim continue après un rechargement)
  const alive = await evaluate(`(async () => {
    const g = window.__game;
    const { tick } = await import('./src/core/tick.mjs');
    const { advanceTime } = await import('./src/core/game-state.mjs');
    for (let i = 0; i < 120; i++) {
      const played = advanceTime(g.state, 1);
      tick(g.state, played);
    }
    return { simAlive: !!g.state.sim, time: g.state.time, screen: g.state.screen };
  })()`, true);
  check('jeu vivant après le cycle mute/rechargement (sim avance)',
    alive?.simAlive && alive?.time > 0,
    `temps=${Math.round(alive?.time ?? 0)}s screen=${alive?.screen}`);

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 'r44-cdp-report.json'),
      JSON.stringify({ ok, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} R44 CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR R44 CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
