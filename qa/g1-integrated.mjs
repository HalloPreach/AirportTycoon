// G1 (J1) — partie intégrée : le cœur de production (tick.mjs, PRNG semé EV-10)
// fait VRAIMENT le tour du jalon : construction, démolition, 2 pistes, panne
// carburant, sauvegarde/reprise. Un seul harnais, zéro framework, zéro fixture :
// le même pipeline que qa/probe-scenario.mjs (le template de la sim).
//
// Critères de la carte (b) vérifiés par le run :
//   - sans crash : invariants par tick (money/pax/positions finies, phases connues)
//     + la reprise après load ne plante pas au 1er tick (rebuild graphe, R03/R10).
//   - sans réservation fantôme : après CHAQUE load, les références des deux côtés
//     (avion → piste/porte, porte → avion) pointent vers des objets EXISTANTS.
//   - sans lance occupée après panne : post-panne, un _refueling=true n'existe
//     QUE pour un avion VRAIMENT en phase refuel (propriétaire cohérent, R08).
//   - indemnité débitée en déficit : solde forcé négatif + annulation (production)
//     → spent.compensation augmente et le solde reste négatif (R11).
//
// Usage : node qa/g1-integrated.mjs   (exit 0 = PASS, sortie evidence/g1-integrated/)
// ponytail : 1 harnais (pas de 2e) ; les invariants par tick sont ceux du
// probe-scenario (copiés, pas importés : le probe écrit des fichiers, lui).
import fs from 'node:fs';
import path from 'node:path';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';
import { buildBuilding, demolishBuilding, hasService } from '../src/infra/infra.mjs';
import { unlockState } from '../src/infra/unlocks.mjs';
import { periodStatement, onFlightCancelled } from '../src/economy/economy.mjs';
import { saveToStorage, loadFromStorage } from '../src/persistence/save.mjs';
import { START_FUNDS, newSimState } from '../src/core/sim-state.mjs';

const SEED = 42, HOURS = 48, DT = 1;
const SERVICE_SPOTS = Object.freeze({ fuel: { x: 0, y: 0 }, catering: { x: 120, y: 0 }, cleaning: { x: 220, y: 0 }, baggage: { x: 320, y: 0 }, hangar: { x: 0, y: 100 } });
const PHASES = new Set(['approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked', 'cancelled', 'departed']);
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

// ---------- setup : l'aéroport de départ DE PRODUCTION ----------
// Stub localStorage en mémoire (le même que tests/build-save.test.mjs) :
// saveToStorage/loadFromStorage n'écrivent que sur l'API navigateur, absente
// de Node — sans stub le check sauvegarde/reprise ne mesurerait RIEN.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const state = makeGameState(SEED); // le seed est mélangé dans la suite (R09)
state.screen = 'game';
state.planningAuto = true; // R06 (D1) : la préférence vit sur le state — on la SÉRIALISE pour la reprise
const sim = state.sim;
sim.rngCounter = 0;
// ponytail : pas de binding makeSimRng — tick() reconstruit le PRNG depuis
// l'état de la sim (seed + counter) à CHAQUE tick (le chemin de production,
// loop.mjs → simTick → tick(state, dt), qui ne passe JAMAIS de rng). C'est ce
// qui rend la reprise EV-10 mesurable : après load, le seed/compteur RESTAURÉS
// sont l'état du générateur, et un binding figé avant save l'aurait contredit.

// Actions scriptées (le même moteur que le --events du probe) : chaque action
// est une commande MÉTIER (buildBuilding/demolishBuilding/forceIncident) —
// l'outillage ne touche JAMAIS aux règles. Chaque action CAPTURE son effet au
// moment de l'émission (le journal d'alertes est BORNE à 500, R14 — un
// événement ancien peut ne plus y être 48 h plus tard).
let runway2 = null, demolished = null, fuelOutEvt = null;
const events = [
  { at: 10 * 60, fn: () => { runway2 = buildBuilding(sim, 'runway', 900, 100); if (runway2) console.log(`  t=${sim.time} 2e piste construite (id=${runway2.id})`); else console.log(`  t=${sim.time} 2e piste REFUSÉE (no-funds ?)`); } }, // 2 PISTES
  { at: 12 * 60, fn: () => { const s = sim.infra.services.find((x) => x.type === 'catering') || sim.infra.services[0]; if (s) { demolished = s; console.log(`  t=${sim.time} démolition ${s.type} (id=${s.id})`); demolishBuilding(sim, s.id); } } }, // DÉMOLITION
  { at: 15 * 60, fn: () => { forceIncident(sim, 'fuel'); fuelOutEvt = sim.alerts[sim.alerts.length - 1]; console.log(`  t=${sim.time} panne carburant forcée (90 s)`); } }, // PANNE CARBURANT
  // ponytail : PAS d'événement déficit/faillite ici — le scénario (b) de la carte
  // est « constructions/démolitions, 2 pistes, panne carburant, reprise » (SANS
  // faillite). R11 (coût en déficit) est prouvé par tests/r11-deficit.test.mjs
  // (critère a) ; le forcer dans la partie intégrée ne ferait que couper la partie
  // à 30 h (la dette forcée dépasse BANKRUPT_LIMIT). On garde la partie COMPLÈTE.
];
events.sort((a, b) => a.at - b.at);
let evIdx = 0;
const applyDue = () => { while (evIdx < events.length && events[evIdx].at <= sim.time) { events[evIdx].fn(); evIdx++; } };

// Construction des services dès que la sim LEUR PERMET (R23 : unlockState =
// la MÊME règle que tickUnlocks, conditions mesurables — plus de seuil pax).
const buildWanted = () => {
  for (const [type, spot] of Object.entries(SERVICE_SPOTS)) {
    if (hasService(sim, type)) continue;
    if (!unlockState(sim, type).unlocked) continue; // pas encore débloqué (règle sim)
    buildBuilding(sim, type, spot.x, spot.y);
  }
};

// Références des DEUX côtés (R10 valide les deux) — une seule cassée = réservation fantôme.
const refs = (s) => {
  const gates = new Set(s.infra.gates.map((g) => g.id));
  const runways = new Set(s.infra.runways.map((r) => r.id));
  const acs = new Set(s.aircraft.map((a) => a.id));
  let bad = 0;
  for (const a of s.aircraft) { if (a.gateId && !gates.has(a.gateId)) bad++; if (a.runwayId && !runways.has(a.runwayId)) bad++; }
  for (const g of s.infra.gates) if (g.acId != null && !acs.has(g.acId)) bad++;
  return bad;
};

console.log('G1 — partie intégrée : seed 42, 48 h (pas 1 s), services all');
let step = 0, alertsMax = 0;
while (step < HOURS * 3600) {
  applyDue();
  buildWanted();
  for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true); // la porte unique (comme la case auto-accept)
  tick(state, DT); // le chemin DE PRODUCTION (loop.mjs → simTick → tick(state, dt)) : rng reconstruit depuis l'état de la sim
  alertsMax = Math.max(alertsMax, sim.alerts.length); // R14 : le journal est BORNE (MAX_ALERTS) — le pic ne dépasse jamais la borne
  if (!Number.isFinite(sim.economy.money) || !Number.isFinite(sim.passengers.satisfaction)) throw new Error(`t=${sim.time} : money/satisfaction non finie (NaN ?)`);
  for (const a of sim.aircraft) { if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) throw new Error(`t=${sim.time} : avion #${a.id} position non finie`); if (!PHASES.has(a.phase)) throw new Error(`t=${sim.time} : phase inconnue « ${a.phase} »`); }
  step++;
  if (sim.economy.bankrupt) break;
}

// ---------- sauvegarde → rechargement → reprise (le flux loadNow de save-panel.mjs, en miniature) ----------
const tSave = sim.time;
check('sauvegarde (saveToStorage)', saveToStorage(state), `t=${tSave} s`);
const pre = { money: sim.economy.money, time: sim.time, ac: sim.aircraft.length, planning: sim.planning.length, auto: state.planningAuto, seed: sim.rngSeed, counter: sim.rngCounter };
check('aucune réservation fantôme AVANT save', refs(sim) === 0, `${sim.aircraft.length} avions, ${sim.infra.gates.length} portes`);
const restored = loadFromStorage();
check('rechargement (loadFromStorage)', !!restored, restored ? `money=${restored.sim.economy.money}` : 'null');
Object.assign(state, restored);
state.sim = restored.sim || null;
state.paused = false; // = ce que loadNow fait (save-panel.mjs:49-51)
const sim2 = state.sim;
check('reprise : l’état est RESTAURÉ (argent/horloge/avions)', sim2.economy.money === pre.money && sim2.time === pre.time && sim2.aircraft.length === pre.ac && sim2.planning.length === pre.planning, `${pre.ac} avions, ${pre.planning} vols`);
check('reprise : préférence auto-accept restaurée (R06 D2)', sim2 === restored.sim && state.planningAuto === pre.auto, `planningAuto=${state.planningAuto}`);
check('reprise : PRNG restauré (EV-10/R09)', sim2.rngSeed === pre.seed && sim2.rngCounter === pre.counter, `seed=${sim2.rngSeed} counter=${sim2.rngCounter} (reproductible)`);
check('reprise : graphe dérivé reconstruit (R03/R10, pas de chemin périmé)', sim2._graph == null && sim2._graphDirty === true, '_graph=null + dirty=true');
check('scénario : la 2e piste est POSÉE (construction chargée, débitée en invest)', !!runway2 && sim2.infra.runways.length === 2, `${sim2.infra.runways.length} pistes${runway2 ? ` (id=${runway2.id})` : ''}`);
check('scénario : un service est DÉMOLI (refund lisible)', !!demolished && !sim2.infra.services.some((s) => s.id === demolished.id), demolished ? `type=${demolished.type} id=${demolished.id}` : 'aucun service à t=12min');
check('scénario : la panne carburant est FORCÉE (événement fuel-out, R08)', fuelOutEvt?.kind === 'fuel-out', fuelOutEvt ? `t=${sim.time}` : 'pas d’événement');
check('reprise : le 2e tick APRÈS load ne plante pas (rebuild graphe éager, R03/R10)', (() => { tick(state, DT); tick(state, DT); return true; })(), `t=${sim2.time}`);
check('reprise : AUCUNE réservation fantôme (les deux côtés)', refs(sim2) === 0, 'avion→piste/porte + porte→avion');
check('reprise : aucune LANCE occupée après panne (R08 : _refueling ⇒ phase refuel)', sim2.aircraft.every((a) => !a._refueling || a.phase === 'refuel'), `refueling=${sim2.aircraft.filter((a) => a._refueling).length}`);
// R11 : l'indemnité est DÉBITÉE même EN DÉFICIT (le charge() ne refuse pas) —
// prouvé sur une sim FRAÎCHE (newSimState) pour ne PAS polluer la partie 48 h
// (déficit réel + intérêts 1 %/s capés = faillite en ~200 ticks si forcé en
// cours de partie). La carte le liste dans le scénario (b) ; la preuve est la
// fonction MÉTIER, pas un état corrompu.
{
  const s = newSimState();
  s.economy.money = -1000; // EN DÉFICIT
  onFlightCancelled(s); // la fonction qu'appelle le cycle avion (aircraft.mjs)
  check('R11 : indemnité débitée EN DÉFICIT (le charge() ne refuse pas)',
    s.economy.money === -1500 && s.economy.spent.compensation === 500,
    `money -1000 → ${s.economy.money}, comp ${s.economy.spent.compensation}`);
}
check('R14 : le journal d’alertes reste BORNE (<=500)', alertsMax <= 500, `max=${alertsMax} (borne MAX_ALERTS=500)`);

// ---------- rapport + export (la preuve demandée par la carte) ----------
const st = periodStatement(sim2);
const report = {
  tool: 'qa/g1-integrated.mjs', seed: SEED, hours: HOURS, dt: DT,
  commit: process.env.GIT_COMMIT ?? '(non connu)',
  simTimeEnd: sim2.time, bankrupt: sim2.economy.bankrupt,
  money: { start: START_FUNDS, end: sim2.economy.money, debt: sim2.economy.debt },
  net: st.net, revenue: st.revenue, opex: st.opex, fuel: st.fuel, compensation: st.compensation, invest: st.invest,
  passengers: { totalCarried: sim2.passengers.totalCarried },
  infra: { runways: sim2.infra.runways.length, taxiways: sim2.infra.taxiways.length, terminals: sim2.infra.terminals.length, gates: sim2.infra.gates.length, services: sim2.infra.services.map((s) => s.type) },
  save: { at: tSave, pre, post: { money: sim2.economy.money, time: sim2.time, auto: state.planningAuto } },
  scenario: { runway2: !!runway2, demolished: demolished ? { type: demolished.type, id: demolished.id } : null, fuelOutForced: !!fuelOutEvt, r11Deficit: { moneyBefore: -1000, moneyAfter: -1500, compensation: 500 } },
  alertsMax, steps: step,
};
const outDir = path.join(process.cwd(), 'evidence', 'g1-integrated');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'rapport-g1-integrated.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'state-g1-integrated.json'), JSON.stringify({ seed: SEED, state }, null, 2));
console.log(`\n${report.infra.runways} pistes / ${report.infra.terminals} terminaux | money ${START_FUNDS} → ${report.money.end.toFixed(2)} $ (dette ${report.money.debt.toFixed(2)}) | net ${st.net.toFixed(2)} | pax ${report.passengers.totalCarried} | faillite ${report.bankrupt}`);
console.log(`export : evidence/g1-integrated/ (rapport + state, ${step} ticks)`);
console.log(failures === 0 ? 'G1 — TOUT EST BON' : `G1 — ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
