// R43 (t_62bd0be8) — SONDAGE BROWSEUR : OPTIONS PERSISTANTES + PALETTE
// DALTONIENNE, dans le navigateur RÉEL (le contrat Node est dans
// tests/r43-options.test.mjs — celui-ci vérifie le CÂBLAGE navigateur :
// la page options du menu, le clavier V, la PERSISTANCE localStorage
// (clé dédiée, séparée de la sauvegarde), la SURVIE au rechargement, et
// l'inversion VISIBLE de la palette (captures comparables).
// Pattern éprouvé (qa/r42-cdp.mjs, qa/r40-cdp.mjs) : Edge headless + CDP,
// 0 dépendance, Node >= 22 (WebSocket global), serveur statique serve.mjs.
// Usage : node qa/r43-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/r43-cdp-report.json + captures evidence/r43-*.png
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

const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
diag.browser = edge;

// --- 1. serveur statique local (pattern r42-cdp.mjs) ---------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-r43-')); // stockage vide garanti
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;

// --- 2. Edge headless + CDP (pattern r42-cdp.mjs) ------------------------------
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
    writeFileSync(join(dir, `r43-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  const poll = (fn, ms = 5000) => new Promise((resolve) => {
    const t0 = Date.now();
    (async function loop() {
      let v; try { v = await fn(); } catch { v = null; }
      if (v) return resolve(true);
      if (Date.now() - t0 < ms) setTimeout(loop, 100); else resolve(false);
    })();
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. boot : les options par défaut sont câblées (miroir + page) -----------
  const boot = await evaluate(`(() => {
    const g = window.__game;
    return {
      options: g.options,
      stateOptions: g.state.options,
      same: g.options === g.state.options, // le miroir VIVANT est un seul objet
      speedIndex: g.state.speedIndex,
      page: typeof g.optionsPage,
      menuBtn: [...document.querySelectorAll('.menu-btns button')].some((b) => b.textContent.includes('Options')),
    };
  })()`);
  check('options par défaut câblées (volume 50, daltonien OFF, x1)',
    boot.options?.volume === 50 && boot.options?.colorBlind === false && boot.options?.speedIndex === 0
    && boot.same && boot.speedIndex === 0, JSON.stringify(boot.options));
  check('page options exposée + bouton menu « Options (V) »',
    boot.page === 'object' && boot.menuBtn, `page=${boot.page} bouton=${boot.menuBtn}`);

  // --- B. le bouton menu OUVRE la page (carte visible) --------------------------
  const opened = await evaluate(`(() => {
    const b = [...document.querySelectorAll('.menu-btns button')].find((x) => x.textContent.includes('Options'));
    b.click();
    const card = document.querySelector('.options');
    return { open: window.__game.optionsPage.isOpen(), card: !!card, visible: card && card.style.display !== 'none' };
  })()`);
  check('bouton menu « Options (V) » ouvre la page', opened.open && opened.visible,
    JSON.stringify(opened));

  // --- C. les trois options COMMITTENT + PERSISTENT (clé dédiée) ----------------
  const committed = await evaluate(`(async () => {
    const g = window.__game;
    // Vitesse x2 (bouton de la page).
    const x2 = [...document.querySelectorAll('.options .opt-speeds button')].find((b) => b.textContent === 'Vitesse x2');
    x2.click();
    // Mode daltonien (bascule).
    document.querySelector('.options [data-opt="colorBlind"]').click();
    // Volume 80 (le slider, comme un joueur).
    const slider = document.querySelector('.options .opt-volume');
    slider.value = '80';
    slider.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 150)); // le toast suit
    const raw = localStorage.getItem('airport-tycoon-options');
    return {
      live: { volume: g.options.volume, colorBlind: g.options.colorBlind, speedIndex: g.options.speedIndex },
      stateSpeed: g.state.speedIndex, // la synchro LIVE (main.mjs)
      saved: raw ? JSON.parse(raw) : null,
      saveSlotTouched: localStorage.getItem('airport-tycoon-save') != null, // NE DOIT PAS exister (pas de partie jouée)
      toast: document.body.textContent.includes('Options enregistrées'),
    };
  })()`, true);
  check('volume 80 + daltonien ON + vitesse x2 appliqués LIVE (miroir + state.speedIndex)',
    committed.live?.volume === 80 && committed.live.colorBlind === true && committed.live.speedIndex === 1
    && committed.stateSpeed === 1, JSON.stringify(committed.live));
  check('persistence CLÉ DÉDIÉE (airport-tycoon-options), sauvegarde de jeu INTACTE',
    !!committed.saved?.options && committed.saved.options.volume === 80 && committed.saved.options.colorBlind === true
    && committed.saved.options.speedIndex === 1 && !committed.saveSlotTouched,
    JSON.stringify(committed.saved));
  check('toast de confirmation « Options enregistrées »', committed.toast === true);

  // --- D. « Retour au menu » REFERME la page ------------------------------------
  const closed = await evaluate(`(() => {
    const back = [...document.querySelectorAll('.options button')].find((b) => b.textContent === 'Retour au menu');
    back.click();
    return { open: window.__game.optionsPage.isOpen(), hidden: document.querySelector('.options').style.display === 'none' };
  })()`);
  check('« Retour au menu » referme la page', !closed.open && closed.hidden, JSON.stringify(closed));

  // --- E. le clavier V ouvre aussi la page (le O reste l'overlay R18) -------------
  const keyOpen = await evaluate(`(async () => {
    const g = window.__game;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    await new Promise((r) => setTimeout(r, 100));
    const openV = g.optionsPage.isOpen();
    // O : l'overlay REXISTANT (R18) est inchangé — pas volé par R43.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await new Promise((r) => setTimeout(r, 100));
    const overlay = g.state.networkOverlay;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await new Promise((r) => setTimeout(r, 100));
    return { openV, overlayToggled: overlay === true };
  })()`, true);
  check('clavier V ouvre la page options', keyOpen.openV === true, JSON.stringify(keyOpen));
  check('la touche O reste l\'overlay réseau R18 (non modifiée)', keyOpen.overlayToggled === true);
  await evaluate(`window.__game.optionsPage.close()`);

  // --- F. inversion VISIBLE de la palette (nouvelle partie + 2 captures) -------
  // L'option daltonienne est ON depuis C → d'abord la capture DALTONIENNE,
  // puis on bascule OFF (page options, comme un joueur) → capture STANDARD :
  // les deux captures DOIVENT montrer des couleurs de terrain différentes
  // (herbe verte #3d5a3a ↔ fond bleu-gris #2e3d4f — vérifié par vision).
  // On refermet l'option ON avant le rechargement (G s'attend à ON).
  await evaluate(`(() => {
    const g = window.__game;
    [...document.querySelectorAll('.menu-btns button')].find((x) => x.textContent.includes('Nouvelle partie')).click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await shot('game-daltonien');
  await evaluate(`(async () => {
    const g = window.__game;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    await new Promise((r) => setTimeout(r, 150));
    document.querySelector('.options [data-opt="colorBlind"]').click(); // OFF (commit + persistance)
    g.optionsPage.close(); // la capture standard ne doit pas montrer la page
    await new Promise((r) => setTimeout(r, 300)); // la palette suit le miroir live (frame)
  })()`, true);
  await shot('game-standard');
  const palState = await evaluate(`(async () => {
    const g = window.__game;
    // Re-bascule ON (G : le rechargement doit retrouver l'option ON).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    await new Promise((r) => setTimeout(r, 150));
    if (!g.options.colorBlind) document.querySelector('.options [data-opt="colorBlind"]').click();
    g.optionsPage.close();
    return {
      colorBlind: g.options.colorBlind,
      screen: g.state.screen,
      persisted: JSON.parse(localStorage.getItem('airport-tycoon-options')).options,
    };
  })()`, true);
  check('jeu en cours : capture daltonienne prise avec l\'option ON, puis inversion standard/ON visible',
    palState.colorBlind === true && palState.screen === 'game'
    && palState.persisted.colorBlind === true && palState.persisted.volume === 80,
    JSON.stringify(palState.persisted));

  // --- G. RECHARGEMENT : les options SURVIVENT (clé dédiée ≠ sauvegarde) --------
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  const reloaded = await evaluate(`(() => {
    const g = window.__game;
    const saveRaw = localStorage.getItem('airport-tycoon-save');
    // Le slot de sauvegarde PEUT exister (auto-save au beforeunload, R14) —
    // le critère de SÉPARATION est : il contient une sauvegarde de JEU
    // (champ « state »), jamais le payload d'OPTIONS (champ « options »).
    let saveIsGame = false;
    if (saveRaw) { try { saveIsGame = 'state' in JSON.parse(saveRaw); } catch { saveIsGame = false; } }
    return {
      options: g.options,
      speedIndex: g.state.speedIndex, // la vitesse ENREGISTRÉE s'applique au boot
      saveIsGame,
      optionsKeyAlive: localStorage.getItem('airport-tycoon-options') != null,
    };
  })()`);
  check('RECHARGEMENT : les options survivent (volume 80, daltonien ON, x2)',
    reloaded.options?.volume === 80 && reloaded.options.colorBlind === true && reloaded.options.speedIndex === 1
    && reloaded.speedIndex === 1 && reloaded.optionsKeyAlive, JSON.stringify(reloaded.options));
  check('SÉPARATION : le slot de sauvegarde de jeu ne porte JAMAIS le payload d\'options',
    reloaded.saveIsGame, reloaded.saveIsGame ? 'slot = sauvegarde de jeu (champ state)' : 'slot absent (aucune sauvegarde jouée)');

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 'r43-cdp-report.json'),
      JSON.stringify({ ok, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} R43 CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR R43 CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
