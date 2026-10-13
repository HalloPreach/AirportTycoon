// ROOT (t_a1b30f59) — PREUVE DE LIVRAISON RACINE : les 2 CAPTURES horodatées du
// T1+T2 LIVRÉ (état empilé des 6 commits) + vérif 0 exception page.
// 1 capture = MENU PRINCIPAL (titre + boutons : Nouvelle partie / Reprendre /
//   Options / Scénarios / difficulté) ; 2e capture = JEU (HUD + panneau lecture
//   seule « Saison, stats & succès » T2-2, actif dès la nouvelle partie).
// Pattern éprouvé (qa/cdp-boot.mjs) : Edge headless + CDP, 0 dépendance,
// Node >= 22 (WebSocket global), serveur statique serve.mjs.
// Usage : node qa/root-delivery.mjs  (code retour 0 = PASS, 1 = FAIL)
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

function freePort() { return 8300 + Math.floor(Math.random() * 400); }
function httpProbe(url, tries = 40) {
  return new Promise((resolve) => {
    let n = 0;
    (function attempt() {
      httpGet(url, (res) => { resolve(res.statusCode === 200); res.resume(); })
        .on('error', () => { if (++n < tries) setTimeout(attempt, 100); else resolve(false); });
    })();
  });
}
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('FAIL Edge introuvable'); process.exit(1); }
function pad(n) { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
const TS = stamp();
const evidenceDir = join(import.meta.dirname, '..', 'evidence');

let port = freePort();
let server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let edgeProc = null;
const userDataDir = mkdtempSync(join(tmpdir(), 'at-root-'));

async function main() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur local répond', up);
  if (!up) return finish();

  const cdpPort = freePort();
  edgeProc = spawn(edge, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`, '--window-size=1280,800', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const targets = await new Promise((resolve) => {
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
            else if (++n < 50) setTimeout(poll, 250); else resolve(null);
          } catch { if (++n < 50) setTimeout(poll, 250); else resolve(null); }
        });
      }).on('error', () => { if (++n < 50) setTimeout(poll, 250); else resolve(null); });
    })();
  });
  if (!targets) { check('CDP target', false, 'aucun target page après 12 s'); return finish(); }
  check('CDP target page trouvé', true);

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const cdp = (method, params = {}) => {
    const id = ++seq;
    const p = new Promise((resolve) => { pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params })); });
    return p;
  };
  async function evaluate(expression, awaitPromise = false) {
    const msg = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (msg.result.exceptionDetails) throw new Error('exception page : ' + (msg.result.exceptionDetails.exception?.description || JSON.stringify(msg.result.exceptionDetails)));
    return msg.result.result.value;
  }
  async function shot(file) {
    const s = await cdp('Page.captureScreenshot', { format: 'png' });
    mkdirSync(evidenceDir, { recursive: true });
    const p = join(evidenceDir, file);
    writeFileSync(p, Buffer.from(s.result.data, 'base64'));
    return p;
  }

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await new Promise((r) => setTimeout(r, 1500));

  check('window.__game exposé', (await evaluate('typeof window.__game')) === 'object');

  // --- CAPTURE 1 : MENU PRINCIPAL (T1-3 : titre + commandes) ---------------
  const menuScreen = await evaluate('(() => window.__game.state.screen)()');
  check("écran au chargement = 'menu' (menu principal affiché)", menuScreen === 'menu', `screen=${menuScreen}`);
  const menuBody = await evaluate('(() => document.body.textContent)()');
  const menuHasTitle = /Nouvelle partie/.test(menuBody) && /Reprendre/.test(menuBody);
  check('menu : commandes Nouvelle partie / Reprendre + Options / Scénarios / difficulté',
    menuHasTitle, 'boutons menu présents');
  const menuShot = await shot(`root-${TS}-menu.png`);
  check('CAPTURE 1 : menu principal sauvegardée (preuve racine)', true, menuShot);

  // --- CAPTURE 2 : JEU (HUD + panneau T2-2 « Saison, stats & succès ») -----
  await evaluate(`(async () => {
    const g = window.__game;
    g.startNewGame();
    for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); }
    return g.state.screen;
  })()`, true);
  const gameBody = await evaluate('(() => document.body.textContent)()');
  const panelVisible = gameBody.includes('Saison, stats & succès');
  check('jeu : panneau lecture seule « Saison, stats & succès » (T2-2) visible',
    panelVisible, 'section campagne/stats/succès rendue');
  const gameShot = await shot(`root-${TS}-jeu-panneau.png`);
  check('CAPTURE 2 : jeu + panneau T2-2 sauvegardé (preuve racine)', true, gameShot);

  check('aucune exception page', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  ws.close();
  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'ROOT DELIVERY QA : PASS' : `ROOT DELIVERY QA : FAIL (${failed.length})`);
  edgeProc?.kill();
  server?.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('QA crash:', e.message); server?.kill(); edgeProc?.kill(); process.exit(1); });
