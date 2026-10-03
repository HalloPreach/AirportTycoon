// G4 (J4) — PREUVE NAVIGATEUR du critère (e) : COMPARAISON DE 2 PLANS de capacité
// avec effet spatial EXPLICABLE.
//
// Le harnais Node (qa/g4-integrated.mjs) MESURE la règle en Node (capMult,
// saturation). Ce script est la 2e preuve demandée par la carte : il ouvre la
// vraie UI (serveur local + Edge headless, CDP) et capture, dans le panneau
// d'inspection du terminal, que l'effet d'un plan de capacité est LOCAL —
// l'upgrade du TERMINAL 2 améliore seulement t2 ; le terminal 1 reste
// inchangé. Les PNG + le DOM lisible sont la preuve de la LECTURE ; l'effet
// SPATIAL est attribué au bon terminal par l'UI elle-même (pas de pixel
// comme source de vérité — l'acceptation repose sur le texte du panneau +
// l'état de la sim).
//
// Placing : le terminal 1 est le terminal FOURNI (plan de départ A-2,
// (550,900) — comme le harnais Node) ; le terminal 2 est CONSTRUIT à
// (1050,900) (buildBuilding, même socle). La lecture passe par un VRAI clic
// canvas (le même listener d'inspection que le joueur) sur le centre de
// chaque terminal.
// Usage : node qa/g4-cdp.mjs   (exit 0 = PASS, preuves dans evidence/g4-integrated/)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'evidence', 'g4-integrated'); // MÊME dossier que le harnais Node
mkdirSync(output, { recursive: true });
const results = [], processes = [], pending = new Map(), pageErrors = [], logs = [];
const fixtures = [
  'Terminal 1 = terminal fourni du plan de départ (A-2) ; terminal 2 = buildBuilding (1050,900)',
  'Plan 1 : capacité de base (niveau 0 des 3 tracks partout)',
  'Plan 2 : terminal 2 amélioré (1 niveau du track terminal, capMult 1.6×) — effet LOCAL, t1 intact',
];
let socket, serial = 0, aborting = false;
const delay = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  const item = { name, ok: !!ok, detail };
  results.push(item);
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${name} ${detail ? JSON.stringify(detail) : ''}`);
}
async function freePort() {
  const s = createServer();
  await new Promise((yes, no) => { s.once('error', no); s.listen(0, '127.0.0.1', yes); });
  const port = s.address().port;
  await new Promise(r => s.close(r)); return port;
}
function start(exe, args, options = {}) {
  const p = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  processes.push(p);
  p.on('error', e => logs.push(e.message));
  for (const pipe of [p.stdout, p.stderr]) pipe.on('data', d => {
    logs.push(d.toString().slice(0, 2000)); if (logs.length > 30) logs.shift();
  });
  return p;
}
async function poll(fn, limit = 15000) {
  const until = Date.now() + limit;
  while (Date.now() < until && !aborting) {
    try { const v = await fn(); if (v) return v; } catch { /* nouvelle tentative */ }
    await delay(100);
  }
  throw Error('Attente bornée expirée');
}
async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw Error(`HTTP ${r.status}`); return r;
}
function call(method, params = {}) {
  return new Promise((yes, no) => {
    if (aborting || socket?.readyState !== 1) return no(Error('CDP indisponible'));
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); no(Error(`CDP timeout ${method}`)); }, 8000);
    pending.set(id, { yes, no, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function clickPoint({ x, y }) {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await delay(100);
}
async function click(expression) {
  const point = await evaluate(`(() => { const e=${expression}; if(!e)throw Error('Cible absente');
    e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();
    if(!r.width || !r.height)throw Error('Cible invisible'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await clickPoint(point); return point;
}
const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}))`;
// Centre ÉCRAN (page) d'un point MONDE (même formule que qa/g2-j2.mjs).
async function worldPoint(x, y) {
  return evaluate(`(() => { const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),s=__game.state;
    return {x:r.x+(${x}-s.camera.x)*s.camera.zoom*r.width/c.width+r.width/2,
      y:r.y+(${y}-s.camera.y)*s.camera.zoom*r.height/c.height+r.height/2}; })()`);
}
// Texte du panneau « Inspection » (la LECTURE dont dépend la preuve).
async function inspection() {
  return evaluate(`[...document.querySelectorAll('.panels section')].find(s=>s.querySelector('h4')?.textContent.includes('Inspection'))?.innerText || ''`);
}
async function screenshot(name) {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(output, name + '.png'), Buffer.from(r.data, 'base64'));
}
// Inspecter un terminal : VRAI clic canvas sur son centre (le listener
// d'inspection du joueur), puis attendre que le panneau affiche bien ce
// terminal (la boucle de jeu rafraîchit le DOM, le jeu reste EN PAUSE).
async function inspectTerminal(termId, worldX, worldY, label) {
  const point = await worldPoint(worldX, worldY);
  await clickPoint(point);
  await poll(async () => (await inspection()).includes(label), 5000);
}
async function main() {
  const port = await freePort(), cdpPort = await freePort();
  start(process.execPath, ['serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) } });
  await poll(() => get(`http://127.0.0.1:${port}/`));
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!edge) throw Error('Edge introuvable');
  const profile = mkdtempSync(join(tmpdir(), 'airport-g4-cdp-'));
  start(edge, ['--headless=new', '--no-first-run', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1600,1100', 'about:blank']);
  const target = await poll(async () => (await (await get(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(t => t.type === 'page'));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails);
    const p = pending.get(m.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id); m.error ? p.no(Error(m.error.message)) : p.yes(m.result);
  };
  await new Promise((yes, no) => { const t = setTimeout(() => no(Error('WebSocket timeout')), 5000);
    socket.onopen = () => { clearTimeout(t); yes(); }; socket.onerror = () => { clearTimeout(t); no(Error('WebSocket error')); }; });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await poll(() => evaluate(`!!window.__game && !!document.querySelector('.menu-btns button')`));
  await click(button('Nouvelle partie'));
  await poll(() => evaluate(`__game.state.screen==='game'`));
  await click(button('Passer')); // intro (skipped)
  await click(button('Pause')); // jeu gelé : le panneau est STABLE (lecture)

  // Modules de sim dans la page (la construction + l'upgrade passent par la
  // sim réelle — la même que le harnais Node).
  await evaluate(`(async()=>{window.qa = await Promise.all([
    import('/src/infra/infra.mjs'),import('/src/infra/upgrades.mjs')]);return true;})()`);

  // Socle 2 terminaux : le terminal 1 est le terminal FOURNI (A-2, (550,900) —
  // centre (650,975)) ; le terminal 2 est CONSTRUIT à (1050,900) (centre
  // (1150,975)) — même placement que le harnais Node.
  const built = await evaluate(`(() => { const sim=__game.state.sim;
    sim.economy.money=100000;
    const t1=sim.infra.terminals[0]; if(!t1)throw Error('terminal fourni absent');
    const t2=qa[0].buildBuilding(sim,'terminal',1050,900); if(!t2)throw Error('terminal 2 refusé');
    return {t1:t1.id,t1x:t1.x,t1y:t1.y,t2:t2.id,terminals:sim.infra.terminals.length}; })()`);
  check('2 terminaux (fourni + construit)', built?.terminals === 2, built);
  const t1 = { id: built.t1, cx: built.t1x + 100, cy: built.t1y + 75 }; // centre (bâtiment 200×150)
  const t2 = { id: built.t2, cx: 1150, cy: 975 };
  check('Terminal 2 construit (id explicite)', !!t2.id, `t2=#${t2.id}`);

  // === PLAN 1 : capacité de base (niveau 0 des 3 tracks partout) ===========
  await inspectTerminal(t1.id, t1.cx, t1.cy, `Terminal #${t1.id}`);
  const plan1T1 = await inspection();
  await screenshot('01-plan1-terminal1');
  await inspectTerminal(t2.id, t2.cx, t2.cy, `Terminal #${t2.id}`);
  const plan1T2 = await inspection();
  await screenshot('02-plan1-terminal2');
  const plan1Levels = await evaluate(`(() => { const sim=__game.state.sim;
    return {t1:qa[1].upgradeLevel(sim,${t1.id},'terminal'),t2:qa[1].upgradeLevel(sim,${t2.id},'terminal')}; })()`);
  check('Plan 1 : capacité de BASE (track terminal niveau 0 des deux terminaux)',
    plan1Levels?.t1 === 0 && plan1Levels?.t2 === 0, plan1Levels);
  check('Plan 1 : le panneau du terminal 2 montre le niveau 0 (lecture « niv. 1/3 »)',
    plan1T2.includes('niv. 1/3'), plan1T2.slice(0, 160));

  // === PLAN 2 : terminal 2 AMÉLIORÉ (effet spatial local) ==================
  // buyUpgrade : la COMMANDE UI du joueur (le panneau émet l'intention, la
  // sim règle coût/effet). L'upgrade n'agit QUE sur le terminal 2 — même
  // niveau (1) que le harnais Node (capMult 1.6×).
  // NB : la signature d'inspection d'un TERMINAL est statique (panels.mjs :
  // `bldg:<id>` — un terminal ne « bouge » pas) : le panneau se reconstruit
  // seulement quand l'OBJET SÉLECTIONNÉ change. Après un achat, la relecture
  // impose donc de RE-SELECTIONNER un autre bâtiment d'abord (ici t1) —
  // c'est aussi le bon ordre de capture : d'abord prouver que t1 est
  // INCHANGÉ (effet spatial), puis que t2 a la capacité améliorée.
  const upgraded = await evaluate(`(() => { const sim=__game.state.sim;
    const a=qa[1].buyUpgrade(sim,${t2.id},'terminal');
    return {a,t1:qa[1].upgradeLevel(sim,${t1.id},'terminal'),t2:qa[1].upgradeLevel(sim,${t2.id},'terminal'),
      capT1:qa[1].capMult(sim,${t1.id}),capT2:qa[1].capMult(sim,${t2.id})}; })()`);
  check('Plan 2 : l’upgrade terminal est ACHETÉ (t2 niveau 1, t1 niveau 0)',
    upgraded?.a?.ok && upgraded?.t2 === 1 && upgraded?.t1 === 0, upgraded);
  check('Plan 2 : la CAPACITÉ (capMult) est locale — t2 1.6×, t1 1.0×',
    Math.abs((upgraded?.capT2 ?? 0) - 1.6) < 1e-9 && upgraded?.capT1 === 1,
    { capT1: upgraded?.capT1, capT2: upgraded?.capT2 });
  // t1 d'abord : re-sélection (signature change bldg:4→bldg:3 → peinture
  // FRAÎCHE) → le terminal 1 est identique au plan 1 (effet local, pas global).
  await inspectTerminal(t1.id, t1.cx, t1.cy, `Terminal #${t1.id}`);
  const plan2T1 = await inspection();
  await screenshot('04-plan2-terminal1-inchange');
  // puis t2 (re-sélection → peinture fraîche AVEC l'upgrade).
  await inspectTerminal(t2.id, t2.cx, t2.cy, `Terminal #${t2.id}`);
  const plan2T2 = await inspection();
  await screenshot('03-plan2-terminal2-ameliore');

  // L’effet SPATIAL est EXPLICABLE : la LECTURE (le panneau) attribue
  // l’amélioration au terminal 2 et SEULEMENT à lui — le terminal 1 affiche
  // exactement le même texte dans les deux plans.
  check('Effet SPATIAL : la LECTURE du terminal 1 est IDENTIQUE entre les plans',
    plan1T1.length > 0 && plan1T1 === plan2T1, `longueur=${plan1T1.length}`);
  check('Effet SPATIAL : le panneau du terminal 2 CHANGÉ (track terminal niv. 2/3)',
    plan2T2.includes('niv. 2/3') && plan2T2 !== plan1T2,
    plan1T2 !== plan2T2 ? 'textes différents (effet attribué à t2)' : 'textes identiques');
  check('Lecture lisible du GOUTLE + des 3 CHOIX (explicable, non opaque)',
    plan2T2.includes('Goulot') && plan2T2.includes('Effet attendu') && plan2T2.includes('Améliorer'),
    plan2T2.slice(0, 160));

  check('Aucune exception JavaScript navigateur', pageErrors.length === 0,
    pageErrors.length ? pageErrors.map(p => p?.description || p).slice(0, 3) : []);
}
async function finish() {
  aborting = true;
  for (const p of pending.values()) { clearTimeout(p.timer); p.no(Error('Fin QA')); } pending.clear();
  socket?.close();
  for (const p of processes.reverse()) if (p.pid && p.exitCode === null) {
    if (process.platform === 'win32') await new Promise(r => {
      const killer = spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', r); killer.once('exit', r); setTimeout(r, 5000).unref();
    }); else p.kill();
  }
  const report = {
    at: new Date().toISOString(),
    passed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    fixtures,
    screenshots: ['01-plan1-terminal1.png', '02-plan1-terminal2.png',
      '03-plan2-terminal2-ameliore.png', '04-plan2-terminal1-inchange.png']
      .map(n => join(output, n)),
    limitations: [
      'Capture navigateur de la LECTURE de la comparaison de plans (effet spatial attribué au bon terminal par le panneau) ; la règle est MESURée par qa/g4-integrated.mjs (capMult, saturation).',
      'QA automatisée de critères ciblés ; ne prouve pas toute la jouabilité ni un cycle complet de vol.',
    ],
    results, logs,
  };
  writeFileSync(join(output, 'rapport-g4-cdp.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(output, 'rapport-g4-cdp.txt'),
    results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}\n${JSON.stringify(r.detail ?? '')}\n`).join('\n'));
  console.log(`Rapport : ${output} — ${report.passed} PASS / ${report.failed} FAIL`);
  process.exitCode = report.failed ? 1 : 0;
}
const watchdog = setTimeout(() => { check('Durée totale bornée (120 s)', false); finish().finally(() => process.exit(1)); }, 120000);
try { await main(); } catch (e) { check('Exécution QA', false, e.stack); }
finally { clearTimeout(watchdog); if (!aborting) await finish(); }
