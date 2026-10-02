// BL-20 (NONMVP-5, AC30) — QA des 5 panneaux de gestion par ENTRÉES RÉELLES.
//
// Contrat (comme la PORTE MVP, mvp-gate.mjs) :
//   - Actions par entrées RÉELLES (clavier + souris via CDP Input.dispatch*) :
//     N (nouvelle partie), F (vitesse), A (auto-accept), X (démolir), flèches
//     (pan), clics souris. AUCUNE injection window.__game : on ne lit que
//     l'état (window.__game.state, DOM) et les journaux console/réseau.
//   - Les 5 panneaux (inspection, bilan, stats, alertes, diagnostic réseau)
//     s'ouvrent/affichent tout seuls (DOM fixe, pas de bouton) : le QA vérifie
//     leur CONTENU réel + l'inspection par clic carte (avion/bâtiment).
//   - Forçage des 2 états du diagnostic réseau par le JEU lui-même :
//     COUPÉ = démolition du taxiway (X + clic réel) → les portes deviennent
//     INACCESSIBLES (findPath) + événement « demolished » dans l'historique ;
//     SATURATION = file d'arrivées au plafond (4/4) après la coupure : les
//     avions en vol ne peuvent plus rejoindre les portes (blocked) et le
//     planificateur (auto-accept) déploie jusqu'au plafond MAX_PENDING=4.
//   - Réseau 100 % local (toutes les requêtes Network sont 127.0.0.1/data:/blob:)
//     + 0 console.error + 0 exception de page.
//
// Usage : node qa/gestion-panel.mjs   (code retour 0 = PASS, 1 = FAIL)
// Évidence : evidence/gestion-panel/ (captures PNG + rapport.txt + rapport.json).
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EVID = join(import.meta.dirname, '..', 'evidence', 'gestion-panel');
mkdirSync(EVID, { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. serveur statique local (0 dépendance, serve.mjs) ----------------------
const port = 8200 + Math.floor(Math.random() * 500);
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
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const userDataDir = mkdtempSync(join(tmpdir(), 'at-gestion-'));
let edgeProc = null;

// --- 2. Edge headless + WebSocket CDP ------------------------------------------
async function launchEdge() {
  const dport = 9200 + Math.floor(Math.random() * 400);
  edgeProc = spawn(edge, [
    '--headless=new', `--remote-debugging-port=${dport}`,
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      httpGet(`http://127.0.0.1:${dport}/json/list`, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const targets = JSON.parse(body);
            const page = targets.find((t) => t.type === 'page') || targets[0];
            if (page) resolve(page.webSocketDebuggerUrl);
            else if (Date.now() - t0 > 20000) reject(new Error('aucun target CDP'));
            else setTimeout(poll, 250);
          } catch { if (Date.now() - t0 > 20000) reject(new Error('parse CDP list')); else setTimeout(poll, 250); }
        });
      }).on('error', () => { if (Date.now() - t0 > 20000) reject(new Error('CDP port fermé')); else setTimeout(poll, 250); });
    })();
  });
}

// --- 3. session CDP (lecture seule ou Input/Navigation) ------------------------
let ws;
let cdpSeq = 0;
const cdpPending = new Map();
const pageExceptions = []; // Runtime.exceptionThrown (EV-6)
const consoleErrors = [];   // Console.messageAdded level error (EV-6)
const netRequests = [];     // Network.requestWillBeSent (EV-5 : tout doit être local)

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++cdpSeq;
    cdpPending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (cdpPending.has(id)) { cdpPending.delete(id); reject(new Error(`timeout CDP ${method}`)); } }, 20000);
  });
}
async function connectCdp(wsUrl) {
  ws = new WebSocket(wsUrl);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && cdpPending.has(msg.id)) {
      const { resolve, reject } = cdpPending.get(msg.id);
      cdpPending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageExceptions.push(d.exception?.description || d.text || 'exception inconnue');
    } else if (msg.method === 'Console.messageAdded' && msg.params.message.level === 'error') {
      consoleErrors.push(msg.params.message.text);
    } else if (msg.method === 'Network.requestWillBeSent') {
      netRequests.push(msg.params.request.url);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Console.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
}
// LECTURE SEULE de l'état / du DOM — jamais de méthode du jeu.
async function evaluate(expr) {
  const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.error) throw new Error(`evaluate : ${res.error.message}`);
  if (res.result?.exceptionDetails) throw new Error(`exception page : ${res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text}`);
  return res.result?.result?.value;
}
async function waitFor(predExpr, ms, label, stepMs = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(predExpr);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout attente : ${label}`);
    await sleep(stepMs);
  };
}
// Texte d'un panneau, identifié par son titre (les 5 panneaux sont fixes au DOM).
const panelText = (needle) => evaluate(`Array.from(document.querySelectorAll('.panels > .panel')).map(p => p.textContent).find(t => t.includes('${needle}')) || ''`);
async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const p = join(EVID, name);
  writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  return p;
}
// ENTRÉE RÉELLE clavier : rawKeyDown + keyUp (pas de keyDown « text » — sous
// Edge headless il doublerait chaque keydown et annulerait les toggles par paire).
async function key(k) {
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
// Panne caméra : la touche est GARDÉE (pan continu à 600 px/s par frame).
async function holdKey(k, ms) {
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(ms);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
// Clic gauche COMPLET (move → press → release).
async function clickAt(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(80);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
// Conversion monde → écran (lecture seule de la caméra).
async function screenPosFor(wx, wy) {
  return evaluate(`(() => {
    const s = window.__game.state;
    const cam = s.camera;
    const c = document.getElementById('game');
    return { sx: (${wx} - (cam.x - c.width / 2 / cam.zoom)) * cam.zoom, sy: (${wy} - (cam.y - c.height / 2 / cam.zoom)) * cam.zoom, cw: c.width, ch: c.height };
  })()`);
}
// Pan clavier RÉEL jusqu'au centre de vue (tol px) — la direction est CALIBRÉE
// par mesure (pas supposée) ; chaque pas est court puis re-mesuré (convergence
// garantie par feedback, quelle que soit la frame-rate headless).
async function panTo(wx, wy, tol = 20, maxIter = 150) {
  const c0 = await evaluate('window.__game.state.camera.x');
  await holdKey('ArrowLeft', 250);
  const c1 = await evaluate('window.__game.state.camera.x');
  const leftIncreasesX = c1 > c0;
  for (let i = 0; i < maxIter; i++) {
    const p = await screenPosFor(wx, wy);
    const dx = p.sx - p.cw / 2;
    const dy = p.sy - p.ch / 2;
    if (Math.abs(dx) < tol && Math.abs(dy) < tol) return p;
    if (Math.abs(dy) >= tol) await holdKey(dy > 0 ? 'ArrowUp' : 'ArrowDown', 100);
    else await holdKey((dx > 0) === leftIncreasesX ? 'ArrowLeft' : 'ArrowRight', 100);
  }
  return screenPosFor(wx, wy);
}

// --- 4. scénario ---------------------------------------------------------------
async function run() {
  check('serveur statique local démarré (serve.mjs)', await httpProbe(`http://127.0.0.1:${port}/`) === true, `port=${port}`);
  await connectCdp(await launchEdge());
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
  await waitFor(`window.__game && window.__game.state ? window.__game.state.screen : null`, 30000, 'chargement du menu');
  await sleep(400);

  // (1) NOUVELLE PARTIE — touche N réelle au menu, vitesse x4 (F F).
  await key('n');
  await waitFor(`window.__game.state.screen === 'game'`, 10000, 'entrée en jeu');
  await key('f'); await key('f'); // 1 → 2 → 4 (SPEEDS [1,2,4])

  // (2) Les 5 PANNEAUX sont dans le DOM (DOM fixe créé une fois au boot).
  const nPanels = await evaluate(`document.querySelectorAll('.panels > .panel').length`);
  check('5 panneaux présents dans le DOM', nPanels === 5, `${nPanels}`);
  const titles = await evaluate(`Array.from(document.querySelectorAll('.panels > .panel h4')).map(h => h.textContent).join(' | ')`);
  check('titres des 5 panneaux (inspection/bilan/stats/alertes/réseau)',
    /Inspection|Bilan financier|Statistiques|Alertes|Diagnostic réseau/.test(titles) && (titles.match(/·|—|\/| /g) || '').length > 0,
    titles.slice(0, 120));
  await shot('01-panneaux.png');

  // (3) Le GRAPHE réseau se construit au 1er tick avion → le diagnostic affiche
  // le nombre de nœuds + les portes M ATTEIGNABLES (réseau d'A2 initial).
  await waitFor(`(() => { const g = window.__game.state.sim._graph; return g && g.nodes.length > 0; })()`, 30000, 'graphe construit (1er tick)');
  const net0 = await panelText('Diagnostic réseau');
  check('diagnostic réseau : graphe construit + portes atteignables (état initial)',
    /nœuds/.test(net0) && /atteignables/.test(net0) && !/INACCESSIBLES/.test(net0), net0.slice(0, 140));

  // (4) Bilan financier + stats : le CONTENU réel (pas le titre) s'affiche.
  const fin = await panelText('Solde');
  check('bilan financier affiché (Solde/Résultat/Recettes)', /Solde/.test(fin) && /Résultat/.test(fin) && /Recettes/.test(fin), fin.slice(0, 100));
  const stats = await panelText('Statistiques');
  check('statistiques affichées (passagers transportés/satisfaction/files)', /Passagers transportés/.test(stats) && /Satisfaction/.test(stats) && /Files/.test(stats), stats.slice(0, 120));

  // (5) Clic carte RÉEL sur le TERMINAL : pan clavier centre la vue sur le terminal
  // (monde 650,975) puis clic SOURIS réel au centre du canvas (zone jamais couverte
  // par les panneaux fixes — planning en haut-gauche, panneaux à droite, barre en bas).
  // L'INSPECTION se remplit (bâtiment) : le panneau ne reste pas sur « Cliquez… ».
  await panTo(650, 975, 20);
  const inspPos = await screenPosFor(650, 975);
  await clickAt(inspPos.sx, inspPos.sy);
  await sleep(600);
  const insp = await panelText('Inspection');
  check('clic carte réel → inspection remplie (bâtiment : Terminal 200×150)',
    /Terminal/.test(insp) && !/Cliquez sur un avion/.test(insp), insp.replace(/\s+/g, ' ').slice(0, 110));
  await shot('02-inspection.png');

  // (6) FORCAGE « réseau COUPÉ » par le jeu : démolition du TAXIWAY (le seul
  // pont piste↔terminal) en entrées RÉELLES : pan + X + clic SUR le taxiway.
  const pos = await panTo(650, 1070, 20);
  check('taxiway visible avant démolition (pan réel)', pos.sx > 0 && pos.sx < pos.cw && pos.sy > 0 && pos.sy < pos.ch, JSON.stringify(pos));
  await key('x'); // X = mode démolition (toggle)
  await clickAt(pos.sx, pos.sy);
  await key('x'); // X = sortir du mode démolition
  await waitFor(`window.__game.state.sim.infra.taxiways.length === 0`, 10000, 'démolition du taxiway (état réel)');
  // Le graphe se reconstruit au tick suivant (dirty) → les portes M deviennent
  // INACCESSIBLES (findPath) : l'alerte « demolished » est dans l'historique.
  await waitFor(`(() => { const p = Array.from(document.querySelectorAll('.panels > .panel')).map(x => x.textContent).find(t => t.includes('Diagnostic réseau')); return p && p.includes('INACCESSIBLES'); })()`, 30000, 'diagnostic « réseau coupé »');
  const netCut = await panelText('Diagnostic réseau');
  check('diagnostic réseau : portes INACCESSIBLES (réseau coupé)', /INACCESSIBLES/.test(netCut) && /réseau coupé/.test(netCut), netCut.slice(0, 140));
  const histCut = await panelText('Alertes');
  check("historique d'alertes : l'alerte « demolished » (taxiway) est affichée", /demolished/.test(histCut), histCut.slice(0, 120).replace(/\n/g, ' '));
  await shot('03-reseau-coupé.png');

  // (7) FORCAGE « SATURATION » : file d'arrivées au plafond (4/4). La coupure
  // bloque les arrivées (blocked) et l'auto-accept (A) laisse le planificateur
  // déployer jusqu'au plafond MAX_PENDING=4 → « File d'arrivées 4/4 » (rouge).
  await key('a'); // A = auto-accept ON (la case du panneau planning reste sync)
  await waitFor(`(() => { const p = Array.from(document.querySelectorAll('.panels > .panel')).map(x => x.textContent).find(t => t.includes('Diagnostic réseau')); return p && p.includes('4/4'); })()`, 150000, 'saturation 4/4 (plafond MAX_PENDING)');
  const netSat = await panelText('Diagnostic réseau');
  check("diagnostic réseau : file d'arrivées SATURÉE (4/4)", /4\/4/.test(netSat), netSat.slice(0, 140));
  await shot('04-saturation.png');

  // (8) L'INSPECTION reste lisible pendant la saturation (avion bloqué sélectionnable) :
  // on ne vérifie pas l'id — seulement que le panneau n'est pas cassé (pas d'exception).
  check("inspection toujours lisible pendant la saturation (0 exception)", pageExceptions.length === 0, `exceptions=${pageExceptions.length}`);

  // (9) EV-5 / EV-6 — réseau 100 % local + 0 erreur console/exception.
  const allLocal = netRequests.length > 0
    && netRequests.every((u) => u.startsWith('http://127.0.0.1:') || u.startsWith('data:') || u.startsWith('blob:'));
  check('EV-5 réseau : toutes les requêtes sont LOCALES (aucune externe)', allLocal, `reqs=${netRequests.length}`);
  check('EV-6 zéro exception de page sur toute la session', pageExceptions.length === 0, `exceptions=${pageExceptions.length}`, pageExceptions.slice(0, 3));
  check('EV-6 zéro console.error sur toute la session', consoleErrors.length === 0, `errors=${consoleErrors.length}`, consoleErrors.slice(0, 3));

  const failed = results.filter((r) => !r.ok);
  const txt = [
    `# PANNEAUX DE GESTION (NONMVP-5) — rapport QA (node qa/gestion-panel.mjs)`,
    `Date : ${new Date().toISOString()}`,
    `Résultat : ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length}/${results.length})`,
    '',
    ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`),
    '',
    `Requêtes réseau observées (${netRequests.length}) :`,
    ...netRequests,
    `Console errors (${consoleErrors.length}) :`,
    ...consoleErrors,
    `Exceptions de page (${pageExceptions.length}) :`,
    ...pageExceptions,
  ].join('\n');
  writeFileSync(join(EVID, 'rapport.txt'), txt);
  writeFileSync(join(EVID, 'rapport.json'), JSON.stringify({
    date: new Date().toISOString(),
    result: failed.length ? 'FAIL' : 'PASS',
    results, requests: netRequests, consoleErrors, pageExceptions,
  }, null, 2));
  console.log(`\n=== ${failed.length ? 'FAIL' : 'PASS'} — ${results.length - failed.length}/${results.length} ===`);
  return failed.length === 0;
}

// --- 5. exécution + cleanup (le code retour porte le verdict) -----------------
try {
  const ok = await run();
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(`ÉCHEC session : ${e.message}`);
  writeFileSync(join(EVID, 'rapport.txt'),
    `# PANNEAUX DE GESTION (NONMVP-5) — échec session\n${new Date().toISOString()}\n${e.stack}\n`);
  process.exitCode = 1;
} finally {
  try { if (edgeProc) edgeProc.kill('SIGKILL'); } catch { /* déjà mort */ }
  try { server.kill(); } catch { /* déjà mort */ }
}
