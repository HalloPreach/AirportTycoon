// QA G2/J2 reproductible, sans dépendance npm. Usage : node qa/g2-j2.mjs
// Profil Edge jetable ; fixtures explicites, jamais une sauvegarde utilisateur.
// Les clics passent par CDP Input. Les fixtures isolent les états UI difficiles
// à attendre ; elles ne constituent pas une preuve d'un cycle de vol complet.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'evidence', 'g2-j2');
mkdirSync(output, { recursive: true });
const results = [], processes = [], pending = new Map(), pageErrors = [], logs = [];
const fixtures = ['Offres medium/large déterministes dans une partie jetable',
  'Avion sélectionné : phases et disparition contrôlées pour vérifier le rafraîchissement',
  'Copies du simulateur pour les mesures de cadence et de coûts',
  'États de congestion isolés pour comparer les causes affichées et les compteurs'];
let socket, serial = 0, aborting = false;
const delay = ms => new Promise(r => setTimeout(r, ms));
function check(name, ok, detail) {
  const item = { name, ok: !!ok, detail };
  results.push(item); console.log(`${item.ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`);
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
    try { const v = await fn(); if (v) return v; } catch {}
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
async function worldPoint(x, y) {
  return evaluate(`(() => { const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),s=__game.state;
    return {x:r.x+(${x}-s.camera.x)*s.camera.zoom*r.width/c.width+r.width/2,
      y:r.y+(${y}-s.camera.y)*s.camera.zoom*r.height/c.height+r.height/2}; })()`);
}
async function inspection() {
  return evaluate(`[...document.querySelectorAll('.panels section')].find(s=>s.querySelector('h4')?.textContent.includes('Inspection'))?.innerText || ''`);
}
async function screenshot(name) {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(output, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function main() {
  const port = await freePort(), cdpPort = await freePort();
  start(process.execPath, ['serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) } });
  await poll(() => get(`http://127.0.0.1:${port}/`));
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!edge) throw Error('Edge introuvable');
  const profile = mkdtempSync(join(tmpdir(), 'airport-g2-j2-'));
  start(edge, ['--headless=new', '--no-first-run', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1600,1100', 'about:blank']);
  const target = await poll(async () => (await (await get(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(t=>t.type==='page'));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails);
    const p = pending.get(m.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id); m.error ? p.no(Error(m.error.message)) : p.yes(m.result);
  };
  await new Promise((yes, no) => { const t=setTimeout(()=>no(Error('WebSocket timeout')),5000);
    socket.onopen=()=>{clearTimeout(t);yes();}; socket.onerror=()=>{clearTimeout(t);no(Error('WebSocket error'));}; });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await poll(() => evaluate(`!!window.__game && !!document.querySelector('.menu-btns button')`));
  await click(button('Nouvelle partie'));
  await poll(() => evaluate(`__game.state.screen==='game'`));
  await click(button('Passer'));
  await click(button('Pause'));
  const controls = await evaluate(`({paused:__game.state.paused,buttons:[...document.querySelectorAll('.toolbar button')].map(b=>b.textContent)})`);
  check('Commandes accessibles à la souris et pause active', controls.paused &&
    ['Vitesse','Sauvegarder','Charger','Démolir','Piste','Terminal'].every(t=>controls.buttons.some(b=>b.includes(t))), controls);
  await screenshot('00-commandes');
  await evaluate(`(async()=>{window.qa = await Promise.all([
    import('/src/core/new-game.mjs'),import('/src/core/tick.mjs'),import('/src/core/game-state.mjs'),
    import('/src/data/catalog.mjs'),import('/src/sim/aircraft.mjs'),import('/src/flights/flights.mjs')]);return true;})()`);
  const before = await evaluate(`({money:__game.state.sim.economy.money,time:__game.state.sim.time})`);
  await delay(250);
  const after = await evaluate(`({money:__game.state.sim.economy.money,time:__game.state.sim.time})`);
  check('Pause : aucun débit ni temps simulé', JSON.stringify(before) === JSON.stringify(after), { before, after });
  await click(button('Vitesse')); await click(button('Vitesse'));
  check('Bouton vitesse x4', await evaluate(`__game.state.speedIndex===2 && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Vitesse x4'))`));
  const cadence = await evaluate(`(() => {
    const run=i=>{const s=qa[0].makeGameState(42);s.screen='game';s.speedIndex=i;
      const cost=s.sim.economy.spent.opex||0;const dt=qa[2].advanceTime(s,1);qa[1].tick(s,dt);
      return {seconds:dt,spent:(s.sim.economy.spent.opex||0)-cost};};
    return {x1:run(0),x4:run(2)}; })()`);
  check('Cadence/coûts x4 cohérents (copies de simulation)', cadence.x4.seconds === 4 * cadence.x1.seconds &&
    Math.abs(cadence.x4.spent - 4 * cadence.x1.spent) < 1e-7, cadence);
  // Piste sélectionnée à la souris ; mesure pure du débit de son exploitation.
  await clickPoint(await worldPoint(800, 600));
  const rate = await evaluate(`(() => {const s=qa[0].makeGameState(42);s.screen='game';
    s.sim.infra.taxiways=[];s.sim.infra.terminals=[];s.sim.infra.services=[];s.sim.infra.gates=[];
    const old=s.sim.economy.spent.opex||0;qa[1].tick(s,60);
    return {observed:s.sim.economy.spent.opex-old,shown:qa[3].opexPerMin('runway')};})()`);
  const costText = await inspection();
  check('Coût piste affiché par minute = débit réel sur 60 secondes', Math.abs(rate.observed-rate.shown)<1e-7 &&
    costText.includes(`${rate.shown} $ /min`), { rate, costText });
  await screenshot('01-finances-controles');
  // Construction par un vrai clic, capital inchangé hors coût normal.
  const construction = await evaluate(`({money:__game.state.sim.economy.money,count:__game.state.sim.infra.taxiways.length})`);
  await click(button('Taxiway')); await clickPoint(await worldPoint(1100, 850));
  const built = await evaluate(`({money:__game.state.sim.economy.money,count:__game.state.sim.infra.taxiways.length})`);
  check('Construction souris : infrastructure ajoutée et coût débité', built.count===construction.count+1 &&
    construction.money-built.money===400, { construction, built });
  await evaluate(`__game.buildTool.cancel()`);
  // Offres déterministes : l'UI doit montrer l'obstacle du grand appareil.
  await evaluate(`(() => {const sim=__game.state.sim;sim.planning=[];
    for(const [acType,pax] of [['medium',73],['large',301]]) {
      const a=qa[3].AIRLINES.find(a=>a.types.includes(acType));
      sim.planning.push({id:sim.nextAcId++,airline:a.id,color:a.color,acType,pax,planned:sim.time,status:'planned'});
    } })()`);
  await delay(150);
  const note = await evaluate(`[...document.querySelectorAll('.planning-row')].find(r=>r.innerText.includes('301 pax'))?.innerText || ''`);
  check('Planning : obstacle explicite pour une offre impossible', /porte|piste/i.test(note) && note.includes('⛔'), note);
  await screenshot('02-planning-obstacle');
  await click(`[...document.querySelectorAll('.planning-row')].find(r=>r.innerText.includes('73 pax'))?.querySelector('button')`);
  const decision = await evaluate(`__game.state.sim.planning.find(e=>e.pax===73).status`);
  const duplicate = await evaluate(`qa[5].decideFlight(__game.state.sim,__game.state.sim.planning.find(e=>e.pax===73).id,true)`);
  check('Décision souris enregistrée une fois ; répétition sans effet', decision==='accepted' && duplicate===false, { decision, duplicate });
  // Déploiement par la règle native, puis fixture d'inspection visible.
  await evaluate(`(() => {const sim=__game.state.sim;qa[5].tickPlanner(sim,1,()=>0.5);
    const a=sim.aircraft.find(a=>a.pax===73);if(!a)throw Error('Avion non déployé');
    a.x=1100;a.y=650;a.phase='holding';a.delayed=60;a.timer=0;
    a.runwayId=sim.infra.runways[0].id;sim.incidents.runway.closed=60;window.qaAircraft=a;})();`);
  await evaluate(`__game.buildTool.cancel()`);
  const acPoint = await worldPoint(1100, 650);
  check('Fixture avion visible et ciblable', await evaluate(`document.elementFromPoint(${acPoint.x},${acPoint.y})?.tagName==='CANVAS'`),
    await evaluate(`({point:${JSON.stringify(acPoint)},hit:document.elementFromPoint(${acPoint.x},${acPoint.y})?.outerHTML.slice(0,180),active:__game.buildTool.isActive(),camera:__game.state.camera})`));
  await clickPoint(acPoint);
  const holding = await inspection();
  check('Inspection : cause de congestion lisible', holding.includes('attente') && holding.includes('piste'), holding);
  const congestion = await evaluate(`(() => {const s=structuredClone(__game.state);s.paused=false;
    const a=s.sim.aircraft.find(a=>a.pax===73),before=a.delayed;qa[1].tick(s,1);
    return {before,after:a.delayed,cause:qa[4].causeAt(s.sim,a)};})()`);
  check('Attente piste : retard compté une seule fois par seconde', congestion.after-congestion.before===1 &&
    congestion.cause==='piste', congestion);
  await evaluate(`qaAircraft.phase='landing';qaAircraft.x+=5;qaAircraft.delayed=0;`); await delay(150);
  const landing = await inspection();
  check('Inspection live : phase actualisée sans reselection', landing.includes('atterrissage') && !landing.includes('Phase : attente'), landing);
  const causeChecks = await evaluate(`(() => {const sim=__game.state.sim;const states=[
    ['piste',{phase:'holding'}],['porte',{phase:'blocked',heading:'gate'}],
    ['segment',{phase:'blocked',heading:'runway'}],['carburant',{phase:'refuel'}],
    ['passagers',{phase:'board',_delayCause:'passagers'}]];
    return states.map(([want,fields])=>{const a={...qaAircraft,...fields};
      return {want,got:qa[4].causeAt(sim,a),text:qa[4].DELAY_CAUSE_FR[want]};});})()`);
  for(const c of causeChecks) {
    await evaluate(`Object.assign(qaAircraft,${JSON.stringify(c.want==='piste'?{phase:'holding'}:
      c.want==='porte'?{phase:'blocked',heading:'gate'}:c.want==='segment'?{phase:'blocked',heading:'runway'}:
      c.want==='carburant'?{phase:'refuel'}:{phase:'board',_delayCause:'passagers'})},{delayed:60});`);
    await delay(100); const text=await inspection();
    check(`Goulot ${c.want} : modèle et inspection concordent`, c.got===c.want && text.includes(c.text), text);
  }
  await screenshot('03-inspection-goulot');
  await evaluate(`__game.state.sim.aircraft=__game.state.sim.aircraft.filter(a=>a.id!==qaAircraft.id)`); await delay(150);
  const departed = await inspection();
  check('Inspection : objet parti signalé sans reselection', departed.includes('parti') && departed.includes('plus en simulation'), departed);
  await screenshot('04-inspection-depart');
  check('Aucune exception JavaScript navigateur', pageErrors.length===0, pageErrors);
}
async function finish() {
  aborting = true;
  for (const p of pending.values()) { clearTimeout(p.timer); p.no(Error('Fin QA')); } pending.clear();
  socket?.close();
  for (const p of processes.reverse()) if (p.pid && p.exitCode===null) {
    if (process.platform==='win32') await new Promise(r => {
      const killer=spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',r);killer.once('exit',r);setTimeout(r,5000).unref();
    }); else p.kill();
  }
  const report = { at:new Date().toISOString(),passed:results.filter(r=>r.ok).length,
    failed:results.filter(r=>!r.ok).length,fixtures,limitations:[
      'QA automatisée de critères ciblés ; ne prouve pas toute la jouabilité ni un cycle complet de vol.',
      'Le jugement de compréhension du joueur reste à confirmer par le reviewer G2.'],results,logs };
  writeFileSync(join(output,'rapport.json'),JSON.stringify(report,null,2));
  writeFileSync(join(output,'rapport.txt'),results.map(r=>`${r.ok?'PASS':'FAIL'} ${r.name}\n${JSON.stringify(r.detail??'')}\n`).join('\n'));
  console.log(`Rapport : ${output} — ${report.passed} PASS / ${report.failed} FAIL`);
  process.exitCode=report.failed?1:0;
}
const watchdog=setTimeout(()=>{check('Durée totale bornée (90 s)',false);finish().finally(()=>process.exit(1));},90000);
try { await main(); } catch(e) { check('Exécution QA',false,e.stack); }
finally { clearTimeout(watchdog); if(!aborting) await finish(); }
