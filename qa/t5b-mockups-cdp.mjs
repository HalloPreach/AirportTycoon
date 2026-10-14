// T5b (t_52f07a47) — CAPTURES CDP AVANT/APRÈS des maquettes de
// direction visuelle (Edge headless + CDP, 0 dépendance, Node >= 22).
//
// Avant  : le jeu réel au HEAD (extrait propre via git archive dans
//          un tmp — écran-titre + jeu) ; Après : les 3 maquettes
//          (A/B/C) + la page d'accueil de la revue (full-page PNG).
// Sortie : evidence/t5b-mockups-cdp/*.png (nom horodaté) + rapport
//          qa/t5b-mockups-cdp-report.json. Exit 0 = PASS (captures
//          écrites + 0 exception console sur les maquettes).
// Usage  : node qa/t5b-mockups-cdp.mjs
import { execSync, spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
const EDGE_CANDIDATES = [
  process.env.QA_EDGE,
  process.env.QA_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) { console.error('Edge introuvable'); process.exit(1); }

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
function shot(cdp, c) {
  return cdp.send('Page.captureScreenshot', c).then((m) => m.result.data); // base64
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ------------------------------------------------------------------
// 1. Arbre PROPRE du HEAD (captures « avant » sans la WIP locale) +
//    deux serveurs statiques (arbre propre : avant / racine : après).
const cleanDir = mkdtempSync(join(tmpdir(), 'at-t5b-clean-'));
try {
  // Extraction propre en 2 temps (sans pipe, robuste sous Windows) :
  // git archive -o écrit le tar dans tmp, tar -x l'extrait.
  // Pas de `-C C:\...` : bsdtar échoue sur les chemins disque (-C « C: »
  // résolu comme URL) → on change de répertoire d'abord, noms relatifs.
  const tarPath = join(cleanDir, '_head.tar');
  execSync(`git -C ${REPO} archive -o ${tarPath} HEAD`, { stdio: 'pipe' });
  execSync(`cd /d ${cleanDir} && tar -xf _head.tar`, { stdio: 'pipe' });
} catch (e) {
  console.error('git archive HEAD a échoué (nettoyage impossible pour les captures avant) :', e.message);
  process.exit(1);
}
let p1 = freePort(); let p2 = freePort();
if (p1 === p2) p2 = p1 + 1;
const servers = [
  spawn(process.execPath, ['serve.mjs'], { cwd: cleanDir, env: { ...process.env, PORT: String(p1) }, stdio: ['ignore', 'pipe', 'pipe'] }),
  spawn(process.execPath, ['serve.mjs'], { cwd: REPO, env: { ...process.env, PORT: String(p2) }, stdio: ['ignore', 'pipe', 'pipe'] }),
];
async function startBrowser(cdpPort, userDataDir) {
  const edgeProc = spawn(edge, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1366,768',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (!target) { edgeProc.kill(); return null; }
  return { proc: edgeProc, target };
}
function cdpSession(ws) {
  const pending = new Map(); let seq = 0; const handlers = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg); pending.delete(msg.id); return; }
    for (const h of handlers) h(msg);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout ' + method)); } }, 30000);
  });
  return { send, on: (h) => handlers.push(h) };
}
async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url }).catch(() => {});
  await waitFor(cdp, 'document.readyState === "complete"', 15000);
}
async function waitFor(cdp, expr, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const m = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }).catch(() => null);
    if (m?.result?.result?.value) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(300);
  }
}

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const EV = join(REPO, 'evidence', 't5b-mockups-cdp');
mkdirSync(EV, { recursive: true });
const captures = [];
function savePng(name, b64) {
  const p = join(EV, `t5b-mockups-cdp-${TS}-${name}.png`);
  writeFileSync(p, Buffer.from(b64, 'base64'));
  const st = statSync(p);
  captures.push({ name, path: p, bytes: st.size, kb: Math.round(st.size / 102.4) / 10 });
  console.log(`  capture ${name} → ${p} (${Math.round(st.size / 102.4) / 10} Ko)`);
}

async function main() {
  if (!await httpProbe(`http://127.0.0.1:${p1}/`)) { console.error('serveur clean down'); process.exit(1); }
  if (!await httpProbe(`http://127.0.0.1:${p2}/mockups/index.html`)) { console.error('serveur racine down'); process.exit(1); }
  const cdpPort = freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), 'at-t5b-br-'));
  const b = await startBrowser(cdpPort, userDataDir);
  if (!b) { console.error('Edge down'); process.exit(1); }
  const ws = new WebSocket(b.target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  const cdp = cdpSession(ws);
  // Suivi des erreurs console (attendu : 0 sur les maquettes)
  const consoleErrors = [];
  let phase = 'boot';
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push({ phase, text: m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.description || '') });
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push({ phase, text: (m.params.args || []).map((a) => a.description || a.value || '').join(' ') });
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // ---- AVANT : jeu réel au HEAD (écran-titre puis partie jouée) ----
  phase = 'avant-titre';
  console.log('\n=== AVANT : jeu au HEAD ===');
  await navigate(cdp, `http://127.0.0.1:${p1}/`);
  if (!await waitFor(cdp, 'window.__game && typeof window.__game.startNewGame === "function"', 20000)) {
    console.error('le jeu n’a pas booté (window.__game absent)'); process.exit(1);
  }
  await sleep(1800); // animation de menu stabilisée (délai fixe, déterministe)
  savePng('before-title', await shot(cdp, { format: 'png' }));
  phase = 'avant-jeu';
  await cdp.send('Runtime.evaluate', { expression: 'window.__game.startNewGame()' });
  await sleep(3000); // toasts de début de partie (même délai que T51)
  savePng('before-game', await shot(cdp, { format: 'png' }));

  // ---- APRÈS : maquettes (full-page) + page d'accueil de la revue ----
  phase = 'apres-index';
  console.log('\n=== APRÈS : maquettes ===');
  await navigate(cdp, `http://127.0.0.1:${p2}/mockups/index.html`);
  if (!await waitFor(cdp, 'document.body && document.body.dataset.ready === "1"', 10000)) {
    console.error('index.html n’a pas signalé data-ready'); process.exit(1);
  }
  savePng('after-index', await shot(cdp, { format: 'png', captureBeyondViewport: true }));
  for (const v of ['a', 'b', 'c']) {
    phase = 'apres-' + v;
    await navigate(cdp, `http://127.0.0.1:${p2}/mockups/variant-${v}.html`);
    if (!await waitFor(cdp, 'document.body && document.body.dataset.ready === "1"', 10000)) {
      console.error(`variant-${v}.html n’a pas signalé data-ready`); process.exit(1);
    }
    await sleep(400); // rendu canvas synchronisé ; attente fixe
    savePng('after-' + v, await shot(cdp, { format: 'png', captureBeyondViewport: true }));
  }

  ws.close();
  const head = execSync(`git -C ${REPO} rev-parse HEAD`, { stdio: 'pipe' }).toString().trim();
  const pass = captures.length === 6 && consoleErrors.length === 0;
  const report = {
    ts: new Date().toISOString(), head, pass,
    captures,
    consoleErrors,
    specs: ['index', 'variant-a', 'variant-b', 'variant-c'],
    note: 'captures déterministes : avant = jeu HEAD (tmp propre via git archive), après = maquettes working-tree (full-page). 0 exception attendue.',
  };
  const rp = join(REPO, 'qa', 't5b-mockups-cdp-report.json');
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(`\nT5b CDP : ${pass ? 'PASS' : 'FAIL'} (${captures.length}/6 captures, ${consoleErrors.length} erreur console) — rapport ${rp}`);
  if (!pass) { for (const e of consoleErrors) console.log('  console[' + e.phase + ']', e.text); }
  b.proc.kill(); servers.forEach((s) => s.kill());
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('ERREUR T5b CDP :', e); servers.forEach((s) => s.kill()); process.exit(1); });
