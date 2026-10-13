// T2-1 (t_d5da994c) — SONDAGE BROWSEUR : DIFFICULTÉ (facile / normal / difficile)
// dans le navigateur RÉEL (le contrat Node est dans tests/difficulty.test.mjs —
// celui-ci vérifie le CÂBLAGE navigateur : la rangée de sélection du menu
// principal, le PARAMÈTRE DE SPAWN appliqué à « Nouvelle partie » (capital +
// facteurs du tick), et la PERSISTANCE : le choix sérialisé dans l'état
// SURVIT au rechargement et le SÉLECTEUR DU MENU suit la partie chargée).
// Pattern éprouvé (qa/r43-cdp.mjs, qa/r44-cdp.mjs) : Edge headless + CDP,
// 0 dépendance, Node >= 22 (WebSocket global), serveur statique serve.mjs.
// Usage : node qa/t21-cdp.mjs   (retour 0 = PASS, 1 = FAIL)
// Rapport : qa/t21-cdp-report.json + captures evidence/t21-*.png
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

// --- 1. serveur statique local (pattern r43-cdp.mjs) ---------------------------
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
const userDataDir = mkdtempSync(join(tmpdir(), 'at-t21-')); // stockage vide garanti
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
  async function shot(name) {
    const s = await cdp('Page.captureScreenshot', { format: 'png' });
    const dir = join(import.meta.dirname, '..', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `t21-${name}.png`), Buffer.from(s.result.data, 'base64'));
  }
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const url = `http://127.0.0.1:${port}/`;
  diag.page = url;
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1500));
  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- A. le menu AFFICHE la rangée difficulté (3 boutons, sélection normal) ---
  const menu = await evaluate(`(() => {
    const g = window.__game;
    const btns = [...document.querySelectorAll('.menu-diff button')];
    return {
      labels: btns.map((b) => b.textContent),
      pressed: btns.map((b) => b.getAttribute('aria-pressed')),
      difficulty: g.difficulty(),
      label: !!document.querySelector('.menu-diff .menu-diff-label'),
    };
  })()`);
  check('menu : rangée difficulté (Facile / Normal / Difficile) affichée',
    menu.labels.join('|') === 'Facile|Normal|Difficile' && menu.label, JSON.stringify(menu.labels));
  check('menu : la sélection par défaut est « Normal » (aria-pressed + commande)',
    menu.pressed.join() === 'false,true,false' && menu.difficulty === 'normal',
    `pressed=[${menu.pressed}] difficulty=${menu.difficulty}`);
  await shot('menu-difficulte');

  // --- B. le clic BOUTON CHANGE la sélection (commande + aria-pressed suit) ----
  const clicked = await evaluate(`(async () => {
    const g = window.__game;
    const hard = [...document.querySelectorAll('.menu-diff button')].find((b) => b.textContent === 'Difficile');
    hard.click();
    await new Promise((r) => setTimeout(r, 300)); // aria-pressed est mis à jour à la frame suivante
    const btns = [...document.querySelectorAll('.menu-diff button')];
    return {
      difficulty: g.difficulty(),
      pressed: btns.map((b) => b.getAttribute('aria-pressed')),
    };
  })()`, true);
  check('menu : le clic « Difficile » change la sélection (commande + aria-pressed)',
    clicked.difficulty === 'hard' && clicked.pressed.join() === 'false,false,true',
    `difficulty=${clicked.difficulty} pressed=[${clicked.pressed}]`);

  // --- C. « Nouvelle partie » APPLIQUE le PARAMÈTRE DU SPAWN -------------------
  const started = await evaluate(`(() => {
    const g = window.__game;
    g.startNewGame();
    const s = g.state;
    return {
      screen: s.screen,
      difficulty: s.difficulty,
      money: s.sim.economy.money,
      simDifficulty: s.sim.difficulty,
      toast: document.body.textContent.includes('Difficile'),
    };
  })()`);
  check('« Nouvelle partie » : le profil hard SÉRIALISE (state.difficulty complet)',
    started.screen === 'game' && started.difficulty?.id === 'hard'
    && started.difficulty.name === 'Difficile' && started.difficulty.startFunds === 6000
    && started.difficulty.incidentScale === 0.6 && started.difficulty.opexFactor === 1.25,
    JSON.stringify(started.difficulty));
  check('« Nouvelle partie » : capital 6000 $ + facteurs du tick sur la sim',
    started.money === 6000 && started.simDifficulty?.incidentScale === 0.6
    && started.simDifficulty.opexFactor === 1.25,
    `money=${started.money} sim=${JSON.stringify(started.simDifficulty)}`);
  check('toast d\'annonce de la difficulté (lisible sans jouer)', started.toast === true);
  await new Promise((r) => setTimeout(r, 3000)); // laisser la sim tourner (le temps s'écoule)
  await shot('game-difficile');

  // --- D. RECHARGEMENT : le choix SURVIT (sérialisé) + le menu LE SUIVIT ------
  await cdp('Page.navigate', { url }); // avant le quit : auto-save (beforeunload, R14)
  await new Promise((r) => setTimeout(r, 1500));
  const reloaded = await evaluate(`(() => {
    const g = window.__game;
    const raw = localStorage.getItem('airport-tycoon-save');
    let savedDifficulty = null;
    if (raw) { try { savedDifficulty = JSON.parse(raw).state?.difficulty?.id; } catch { /* pas un JSON */ } }
    return { screen: g.state.screen, savedDifficulty, menuDifficulty: g.difficulty() };
  })()`);
  check('RECHARGEMENT : le choix de difficulté SÉRIALISÉ dans la sauvegarde (slot)',
    reloaded.savedDifficulty === 'hard', `slot=${reloaded.savedDifficulty}`);
  const resumed = await evaluate(`(async () => {
    const g = window.__game;
    const resume = [...document.querySelectorAll('.menu-btns button')]
      .find((b) => b.textContent.includes('Reprendre'));
    if (!resume || resume.style.display === 'none') return { noResumeBtn: true };
    resume.click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      screen: g.state.screen,
      difficulty: g.state.difficulty?.id,
      menuDifficulty: g.difficulty(), // le SÉLECTEUR DU MENU suit la partie chargée
      simDifficulty: g.state.sim.difficulty,
    };
  })()`, true);
  check('« Reprendre » : la partie RECHARGÉE garde sa difficulté hard (state + sim)',
    resumed.screen === 'game' && resumed.difficulty === 'hard'
    && resumed.simDifficulty?.incidentScale === 0.6 && resumed.simDifficulty.opexFactor === 1.25,
    JSON.stringify(resumed));
  check('le SÉLECTEUR DU MENU suit la partie chargée (hard — le choix n\'est pas perdu)',
    resumed.menuDifficulty === 'hard', `menuDifficulty=${resumed.menuDifficulty}`);

  // --- E. l'autre profil (easy) passe aussi par le MÊME câblage ---------------
  const easy = await evaluate(`(() => {
    const g = window.__game;
    g.setDifficulty('easy');
    g.startNewGame();
    return {
      difficulty: g.state.difficulty?.id,
      money: g.state.sim.economy.money,
      simDifficulty: g.state.sim.difficulty,
      menuDifficulty: g.difficulty(),
    };
  })()`);
  check('« Facile » (même câblage) : capital 18000 $ + fenêtres ×1.6 + OPEX ×0.85',
    easy.difficulty === 'easy' && easy.money === 18000
    && easy.simDifficulty?.incidentScale === 1.6 && easy.simDifficulty.opexFactor === 0.85
    && easy.menuDifficulty === 'easy',
    JSON.stringify(easy));

  check('aucune exception de page', pageExceptions.length === 0,
    pageExceptions.slice(0, 2).join(' | ').slice(0, 200));
  return finish();

  function finish() {
    const ok = results.every((r) => r.ok) && pageExceptions.length === 0;
    writeFileSync(join(import.meta.dirname, 't21-cdp-report.json'),
      JSON.stringify({ ok, results, diag, pageExceptions }, null, 2));
    server.kill();
    if (edgeProc) edgeProc.kill();
    console.log(`\n${ok ? 'PASS' : 'FAIL'} T2-1 CDP — ${results.filter((r) => r.ok).length}/${results.length} checks`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('ERREUR T2-1 CDP :', e);
  server.kill();
  if (edgeProc) edgeProc.kill();
  process.exit(1);
});
