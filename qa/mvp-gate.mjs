// BL-11 — PORTE MVP (MVP-10, AC27, AC28, EV-3, EV-5, EV-6) : QA CDP par entrées RÉELLES.
//
// Contrat (la porte du MVP) :
//   - TOUTES les actions passent par des événements d'entrée RÉELS (clavier + souris
//     via CDP Input.dispatch*) ou la navigation navigateur (Page.reload).
//     AUCUNE injection window.__game : aucune méthode du jeu n'est appelée par le QA.
//   - L'observation (AC28) se fait en LECTURE SEULE de l'état (window.__game.state,
//     DOM, canvas) + captures + journaux console/réseau. Lire ≠ injecter : le jeu est
//     piloté uniquement par ses entrées réelles.
//   - Scénario complet (EV-3) : construction → vols → conflits → finances →
//     sauvegarde/reprise (Reprendre → rejouer, la PORTE) → rejeu.
//   - Réseau (EV-5) : 0 requête EXTERNE — toutes les Network.events sont locales
//     (127.0.0.1) ; les erreurs console (EV-6) et exceptions de page sont collectées.
//   - R3/A7 (porte de la carte) : après rechargement + Reprendre, la démolition
//     d'un taxiway AVANT le 1er tick (sim._graph encore null) ne doit lever AUCUNE
//     exception — le null-guard rebuildGraph (commit d43b290) est validé ici comme PASS.
//
// Usage : node qa/mvp-gate.mjs   (code retour 0 = PASS, 1 = FAIL)
// Évidence : evidence/mvp-gate/ (captures PNG + rapport texte + rapport JSON).
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EVID = join(import.meta.dirname, '..', 'evidence', 'mvp-gate');
mkdirSync(EVID, { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// --- 1. serveur statique local (0 dépendance, serve.mjs) -----------------------
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

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGE_CANDIDATES.find(existsSync);
if (!edge) { console.error('FAIL Edge introuvable'); process.exit(1); }

const port = freePort();
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const userDataDir = mkdtempSync(join(tmpdir(), 'at-mvpgate-'));
let edgeProc = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 2. Edge headless + WebSocket CDP (Node ≥ 22 : WebSocket global) ----------
function freeDebugPort() { return 9200 + Math.floor(Math.random() * 400); }
async function launchEdge() {
  const dport = freeDebugPort();
  edgeProc = spawn(edge, [
    '--headless=new', `--remote-debugging-port=${dport}`,
    `--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const wsUrl = await new Promise((resolve, reject) => {
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
  return wsUrl;
}

// --- 3. session CDP (un id croissant ; lecture seule ou Input/Navigation) -----
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
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg); // réponse BRUTE
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
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });
}

// ÉVALUATION LECTURE-SEULE : expr doit être une expression (pas d'effet de jeu).
async function evaluate(expr) {
  const res = await cdp('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (res.error) throw new Error(`evaluate : ${res.error.message}`);
  if (res.result?.exceptionDetails) {
    throw new Error(`exception page : ${res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text}`);
  }
  return res.result?.result?.value;
}

// ENTRÉE RÉELLE clavier (AC27) : rawKeyDown → keyUp.
// ponytail: UNSEUL rawKeyDown (pas de keyDown « text » entre les deux) — sonde
// _probe-keys.mjs (run 226) : sous Edge headless, rawKeyDown + keyDown(text) +
// keyUp génère 6 événements keydown DOM pour UNE pression (Chromium paire les
// événements en retard dans la file d'input) → tout toggle du jeu (b, x, p)
// s'annule pair. rawKeyDown + keyUp = exactement 1 keydown = une vraie frappe.
// Les touches spéciales (flèches/Échap) gardent keyDown sans text (holdKey).
async function key(k) {
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

// Séquence de touches EN UNE RALE (aucun await entre les événements) : les 4
// événements CDP partent sur le WebSocket en un lot SYNCHRONE, donc tous sont
// en file d'attente AVANT la prochaine frame rAF. Requis pour R3/A7 : R
// (reprendre) + P (pause) doivent se superposer pour figer la fenêtre « avant 1er
// tick » (sim._graph null) — un await entre les deux laisserait un tick
// reconstruire le graphe et ruinerait le test. MÊME RÈGLE rawKeyDown/keyUp que
// key() : le keyDown « text » doublait chaque keydown (sonde _probe-keys.mjs)
// et annulait la pause par paire.
function keyBurst(keys) {
  const p = [];
  for (const k of keys) {
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
    p.push(cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }));
    p.push(cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }));
  }
  return Promise.all(p);
}

// Panne caméra : les flèches sont GARDÉES (pan continu à 600 px/s par frame) —
// on maintient la touche posée le temps voulu, puis on la relâche.
async function holdKey(k, ms) {
  const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(ms);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

// ENTRÉE RÉELLE souris (AC27) : move → press → release (clic gauche complet).
async function clickAt(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(80); // le fantôme (survol) doit se dessiner avant le clic
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// Conversion monde → écran (lecture seule de la caméra) : viser un bâtiment avec
// la souris réelle. Le fantôme de construction est CENTRÉ sous la souris.
// ponytail: wx/wy sont des NOMBRES du QA → interpelés en clair dans l'expression.
async function screenPosFor(wx, wy) {
  return evaluate(`(() => {
    const s = window.__game.state;
    const cam = s.camera;
    const c = document.getElementById('game');
    return {
      sx: (${wx} - (cam.x - c.width / 2 / cam.zoom)) * cam.zoom,
      sy: (${wy} - (cam.y - c.height / 2 / cam.zoom)) * cam.zoom,
      cw: c.width, ch: c.height,
    };
  })()`);
}

// Pan clavier RÉEL jusqu'à ce que le point monde (wx,wy) soit au CENTRE de la
// vue (tolérance tol px). Le mapping flèches↔direction du monde est CALIBRÉ par
// sonde (lecture seule de la caméra après une pression courte) — on ne suppose
// jamais la convention. Chaque pas est court (100 ms) puis RE-MESURÉ : la
// convergence est garantie par feedback, quelle que soit la frame-rate headless.
// ponytail: calibration refaite à chaque appel (200 ms) — pas de cache, le coût
// est négligeable face à la sûreté (une calibration stale après un zoom = bug).
async function panTo(wx, wy, tol = 120, maxIter = 120) {
  const c0 = await evaluate('window.__game.state.camera.x');
  await holdKey('ArrowLeft', 250);
  const c1 = await evaluate('window.__game.state.camera.x');
  const leftIncreasesX = c1 > c0; // ArrowLeft révèle la DROITE de la carte ?
  for (let i = 0; i < maxIter; i++) {
    const p = await screenPosFor(wx, wy);
    const dx = p.sx - p.cw / 2;
    const dy = p.sy - p.ch / 2;
    if (Math.abs(dx) < tol && Math.abs(dy) < tol) return p;
    if (Math.abs(dy) >= tol) {
      await holdKey(dy > 0 ? 'ArrowUp' : 'ArrowDown', 100); // viser le bas → tirer le bas
    } else {
      // dy déjà centré : régler X selon la calibration sondée
      await holdKey((dx > 0) === leftIncreasesX ? 'ArrowLeft' : 'ArrowRight', 100);
    }
  }
  return screenPosFor(wx, wy); // état final (le gardien du caller tranchera)
}

// LECTURE SEULE de l'état (AC28) — jamais d'écriture, jamais de méthode du jeu.
const STATE_SNAPSHOT = `(() => {
  const s = window.__game.state;
  const sim = s.sim;
  return {
    screen: s.screen, paused: s.paused, speed: [1, 2, 4][s.speedIndex],
    time: sim ? Math.round(sim.time) : 0,
    money: sim ? Math.round(sim.economy.money) : null,
    revenue: sim ? Object.fromEntries(Object.entries(sim.economy.revenue).map(([k, v]) => [k, Math.round(v)])) : {},
    carried: sim ? sim.passengers.totalCarried : 0,
    ac: sim ? sim.aircraft.length : 0,
    phases: sim ? sim.aircraft.map((a) => a.phase).join(',') : '',
    delayed: sim ? sim.aircraft.filter((a) => a.delayed > 0).length : 0,
    taxiways: sim ? sim.infra.taxiways.length : 0,
    graphNull: sim ? sim._graph === null : null,
    save: !!localStorage.getItem('airport-tycoon-save'),
  };
})()`;
const snap = () => evaluate(STATE_SNAPSHOT);

// Attente (polling lecture seule) d'un prédicat d'état — pas d'injection.
async function waitFor(predExpr, ms, label, stepMs = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(predExpr);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout attente : ${label}`);
    await sleep(stepMs);
  }
}

async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const p = join(EVID, name);
  writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  return p;
}

// --- 4. scénario complet (EV-3) — actions par entrées réelles -----------------
// Ponctuellement, l'état du jeu est lu en LECTURE SEULE (window.__game.state) :
// c'est l'observation (AC28), pas le pilotage. Aucune méthode du jeu n'est appelée.
async function run() {
  const up = await httpProbe(`http://127.0.0.1:${port}/`);
  check('serveur statique local démarré (serve.mjs)', up === true, `port=${port}`);
  const wsUrl = await launchEdge();
  await connectCdp(wsUrl);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitFor(`window.__game && window.__game.state ? window.__game.state.screen : null`, 30000, 'chargement du menu');
  await sleep(400); // 1re frame rendue (menu)
  await shot('00-menu.png');

  // (1) NOUVELLE PARTIE — touche N réelle au menu.
  await key('n');
  await waitFor(`window.__game.state.screen === 'game'`, 10000, 'entrée en jeu');
  check('EV-3.1 nouvelle partie (touche N réelle, menu → jeu)', true);

  // (2) CONSTRUCTION — B + 2 (taxiway), clic souris réel. Le taxiway est posé
  //     ISOLÉ (centre monde 1200,300 → rect [1100..1300]×[280..320]) : il ne fait
  //     PAS pont entre piste et terminal → la démolition de l'originel en (4) coupe
  //     le réseau (conflits). Pan clavier réel avant (4) pour le viser.
  await key('b');
  await key('2');
  const pos = await screenPosFor(1200, 300); // centre du taxiway isolé (200×40)
  check('EV-3.2a conversion écran (lecture seule caméra, dans le canvas)',
    pos.sx > 0 && pos.sx < pos.cw && pos.sy > 0 && pos.sy < pos.ch,
    JSON.stringify(pos));
  if (!(pos.sx > 0 && pos.sx < pos.cw && pos.sy > 0 && pos.sy < pos.ch)) {
    throw new Error(`cible hors canvas : ${JSON.stringify(pos)} — panne à corriger`);
  }
  const t0 = (await snap()).taxiways; // baseline AVANT le clic
  await clickAt(pos.sx, pos.sy);
  // ponytail: compte RELATIF (baseline peut bouger — WIP sibling BL-12 sur le tree
  // partagé) : le delta fait foi, pas le chiffre absolu. Le prédicat renvoie le
  // COMPTE (pas un booléen) : waitFor résout avec la valeur du prédicat, donc
  // built est un nombre et `built === t0 + 1` tient.
  const built = await waitFor(
    `(() => { const n = window.__game.state.sim.infra.taxiways.length; return n === ${t0 + 1} ? n : null; })()`,
    15000, 'pose du 2e taxiway');
  check('EV-3.2b construction réelle (B + 2 + clic souris)', built === t0 + 1, `taxiways ${t0} → ${built}`);

  // (3) VOLS — F × 3 (x1 → x2 → x4) : arrivées, cycles, passagers, recettes.
  // BL-16 (AC20) : un vol n'arrive QUE si le JEU l'accepte — la touche A (entrée
  // réelle, comme les autres) active l'auto-accept : le jeu décide pour le joueur,
  // la sim déploie les vols « accepted ». Sans décision, aucun vol n'existerait.
  await key('a'); await sleep(100);
  await key('f'); await sleep(100); await key('f'); await sleep(100); await key('f');
  await shot('02-vols.png');
  const s3 = await waitFor(
    `(() => { const s = window.__game.state; return s.sim.passengers.totalCarried > 0 && s.sim.economy.revenue.pax > 0; })()`,
    300000, 'passagers transportés + recettes (vols x4)');
  const s3d = await snap();
  check('EV-3.3 vols exécutés — passagers transportés (AC7)', s3d.carried > 0,
    `carried=${s3d.carried} t=${s3d.time}s phases=${s3d.phases || 'aucun'}`);
  check('EV-3.4 finances : recettes générées', s3d.revenue.pax > 0, JSON.stringify(s3d.revenue));

  // (4) CONFLITS — pan clavier RÉEL (les flèches panent la vue ; le point monde
  //     visé est ensuite converti en écran via la caméra — toujours dans le
  //     canvas), puis démolition RÉELLE (X + clic) du taxiway d'ORIGINE
  //     (550..750, 1050..1090) : le réseau piste↔portes est COUPÉ (le 2e taxiway
  //     est isolé, il ne fait pas pont) → les avions passent en « blocked » :
  //     conflit de ressource.
  const tBefore = (await snap()).taxiways; // base relative (WIP sibling BL-12)
  await panTo(650, 1070, 120, 120); // centre le taxiway d'origine dans la vue
  await key('x');
  const pos4 = await screenPosFor(650, 1070);
  if (!(pos4.sx > 0 && pos4.sx < pos4.cw && pos4.sy > 0 && pos4.sy < pos4.ch)) {
    throw new Error(`cible (4) hors canvas : ${JSON.stringify(pos4)} — panne à corriger`);
  }
  await clickAt(pos4.sx, pos4.sy);
  await key('Escape'); // annule l'outil démolition
  await shot('03-reseau-coupe.png');
  const s4 = await waitFor(
    `(() => { const s = window.__game.state;
      return s.sim.infra.taxiways.length === ${tBefore - 1} &&
        s.sim.aircraft.some((a) => ['blocked', 'holding'].includes(a.phase) || a.delayed > 0); })()`,
    300000, 'conflits (réseau coupé → blocked/holding/delayed)');
  const s4d = await snap();
  check('EV-3.5 conflits de ressources (démolition → blocked/holding)', s4 === true,
    `taxiways=${s4d.taxiways} (base ${tBefore}) phases=${s4d.phases || 'aucun'} delayed=${s4d.delayed}`);

  // (5) SAUVEGARDE RÉELLE — S (toast, présent en localStorage), puis Q au menu
  //     (autosave silencieuse), rechargement navigateur (Page.reload),
  //     R = Reprendre (LA PORTE du MVP).
  await key('s');
  await sleep(300);
  const s5 = await snap();
  check('EV-3.6 sauvegarde réelle (touche S, présent en localStorage)', s5.save === true, `argent=${s5.money}`);
  await key('q');
  await waitFor(`window.__game.state.screen === 'menu'`, 10000, 'retour au menu (Q)');
  await cdp('Page.reload');
  await waitFor(`window.__game && window.__game.state && window.__game.state.screen === 'menu'
    && !!localStorage.getItem('airport-tycoon-save')`, 30000, 'menu + sauvegarde après reload');

  // R3/A7 — LA PORTE : R (Reprendre) puis P (pause) BACK-TO-BACK, SANS sleep.
  // Les deux événements clavier CDP sont en file d'attente AVANT la prochaine
  // frame rAF : le jeu est donc EN PAUSE avant le 1er tick → sim._graph reste
  // null (le tick qui le reconstruit n'a pas tourné). La démolition qui suit
  // passe PAR le null-guard rebuildGraph (commit d43b290). La caméra (pannée en
  // (4)) est SÉRIALISÉE dans la sauvegarde → restaurée par R : le taxiway isolé
  // reste visible, on ne repenne pas.
  await key('r');
  await key('p'); // IMMÉDIAT : la course au 1er tick est gagnée (pausé avant tick)
  const resumed = await waitFor(`window.__game.state.screen === 'game' && window.__game.state.paused`, 15000, 'reprise (R) + pause (P)');
  check('EV-3.7 RELOAD + touche R : reprise de la sauvegarde (la PORTE)', resumed === true);
  await shot('04-reprise.png');
  const s6 = await snap();
  check('EV-3.8 reprise : l’état est restauré (passagers/argent conservés)',
    s6.carried > 0 && s6.taxiways === tBefore - 1,
    `carried=${s6.carried} taxiways=${s6.taxiways} (attendu ${tBefore - 1}) money=${s6.money} graph=${s6.graphNull ? 'null' : 'rebuilt'}`);

  // (6) R3/A7 — DÉMOLITION AVANT LE 1ER TICK (graphe null, figé par la pause) :
  //     après R, la caméra est RESTAURÉE au point de sauvegarde (≈650,1070, pan
  //     de (4)) → le taxiway isolé (1200,300) est HORS VUE. On le vise par pan
  //     clavier réel (la panne fonctionne en pause : la caméra est pilotée par la
  //     frame UI, pas par le tick sim). X + clic réel : demolishBuilding lit
  //     _graph === null → le null-guard rebuildGraph (d43b290) → AUCUNE exception.
  //     TOLÉRANCE SERRÉE (12 px) : le hit-test de démolition est le rectangle du
  //     taxiway (40 px de haut, ±20 px autour du centre) — la tol 120 px par
  //     défaut laissait le clic jusqu'à 120 px du centre → le clic tombait à
  //     côté (run BL-16 : sy=349 au lieu de 450, world y 199 hors de [280..320]
  //     → hit undefined, rien ne se démolit, timeout R3/A7). Avec tol 12 le
  //     point est à ±12 px du centre de VUE : le clic au centre est dedans.
  await panTo(1200, 300, 12, 120); // centre SERRÉ le taxiway isolé (fonctionne en pause)
  const pos6 = await screenPosFor(1200, 300); // le taxiway isolé posé en (2)
  check('R3/A6a le taxiway isolé est visible (pan réel en pause)',
    pos6.sx > 0 && pos6.sx < pos6.cw && pos6.sy > 0 && pos6.sy < pos6.ch,
    JSON.stringify(pos6));
  if (!(pos6.sx > 0 && pos6.sx < pos6.cw && pos6.sy > 0 && pos6.sy < pos6.ch)) {
    throw new Error(`cible (6) hors canvas : ${JSON.stringify(pos6)} — pan à corriger`);
  }
  await key('x');
  // FIX R3/A7 (diagnostic run 226) : clic SUR le taxiway (pos6 = position
  // monde→écran MESURÉE du taxiway, pas le centre canvas). panTo(1200,300,tol12)
  // ne converge PAS toujours en pause → le taxiway peut être à ~100px du centre
  // (rapport run 226 : pos6=(734,342) vs centre (640,450)) ; un clic au centre
  // canvas rate le hit-rect du taxiway (±100 x / ±20 y) → demolishBuilding
  // jamais appelé → taxiways reste 1 → timeout R3/A7. Cliquer sur pos6 (centre
  // MONDE du taxiway) est robuste à l'inexactitude du pan.
  await clickAt(pos6.sx, pos6.sy);
  await key('Escape');
  // Le handler de démolition est ASYNC (await import('../infra/infra.mjs') avant
  // demolishBuilding) : un snap immédiat peut lire l'état AVANT que la démolition
  // s'applique → faux FAIL (taxiways=1). On poll la disparition réelle du taxiway
  // isolé (compte === 0), comme la phase build. La preuve « graphe null au moment
  // de la démolition » est déjà capturée dans s6 (AVANT pan/démolition), elle n'est
  // pas affaiblie par le polling.
  await waitFor(
    `(() => { const n = window.__game.state.sim.infra.taxiways.length; return n === 0; })()`,
    10000, 'démolition du taxiway isolé (R3/A7)');
  const s7 = await snap();
  check('R3/A7 démolition réelle AVANT 1er tick (X + clic, graphe null)',
    s7.taxiways === 0, `taxiways=${s7.taxiways} (0 attendu : plus aucun) money=${s7.money} (remboursement)`);
  check('R3/A7 le graphe était null au moment de la démolition (null-guard exercé)',
    s6.graphNull === true, `graphNull avant=${s6.graphNull}`);
  const exc1 = pageExceptions.length;
  check('R3/A7 zéro exception page (null-guard rebuildGraph d43b290 PASS)', exc1 === 0,
    `exceptions=${exc1}`, pageExceptions.slice(0, 3));
  await shot('04b-demoli.png');

  // (7) REJEU — on reprend (P) et la partie continue (rejeu : pas de crash).
  await key('p');
  await sleep(1500);
  const s8 = await snap();
  check('EV-3.9 rejeu après reprise : la sim continue (pas de plantage)',
    !s8.paused && s8.time > 0, `t=${s8.time}s phases=${s8.phases || 'aucun'}`);
  await shot('05-fin.png');

  // (8) EV-5 / EV-6 — réseau 100 % local + 0 erreur console/exception.
  const allLocal = netRequests.length > 0
    && netRequests.every((u) => u.startsWith('http://127.0.0.1:') || u.startsWith('data:') || u.startsWith('blob:'));
  check('EV-5 réseau : toutes les requêtes sont LOCALES (aucune externe)', allLocal,
    `reqs=${netRequests.length}`);
  check('EV-6 zéro exception de page sur toute la session', pageExceptions.length === 0,
    `exceptions=${pageExceptions.length}`, pageExceptions.slice(0, 3));
  check('EV-6 zéro console.error sur toute la session', consoleErrors.length === 0,
    `errors=${consoleErrors.length}`, consoleErrors.slice(0, 3));

  // Rapport + verdict.
  const failed = results.filter((r) => !r.ok);
  const txt = [
    `# PORTE MVP — rapport QA (node qa/mvp-gate.mjs)`,
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

// --- 5. exécution + cleanup (le code retour porte le verdict) ----------------
try {
  const ok = await run();
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(`ÉCHEC session : ${e.message}`);
  writeFileSync(join(EVID, 'rapport.txt'),
    `# PORTE MVP — échec session\n${new Date().toISOString()}\n${e.stack}\n`);
  process.exitCode = 1;
} finally {
  try { if (edgeProc) edgeProc.kill('SIGKILL'); } catch { /* déjà mort */ }
  try { server.kill(); } catch { /* déjà mort */ }
}
