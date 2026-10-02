// qa/probe-scenario.mjs — outillage DRY des scénarios de vérification (t_bc124f75).
//
// Rejoue la sim AVEC LE CŒUR DE LA PRODUCTION (src/core/tick.mjs, rng semé sur
// la sim, EV-10) pour un scénario donné, et produit :
//   - un RAPPORT structuré (console : résumé + JSON dans evidence/) ;
//   - un FICHIER de preuve : `evidence/<runId>/rapport-<runId>.json` + snapshot
//     JSON du STATE de fin (déterminisme R09 : rejouer le même run → fichiers
//     IDENTIQUES en bytes — l'état PRNG est sur la sim, le snapshot ne contient
//     qu'un état pur).
//
// Usage :
//   node qa/probe-scenario.mjs --seed 42 --hours 48 --scenario passive
//   node qa/probe-scenario.mjs --hours 48 --scenario bl17   (le scénario du
//       GATE, identique à qa/bl17-sim48h.mjs : auto-accept 0-24 h, refus de
//       tout 24-36 h, auto-accept 36-48 h + fermeture piste forcée au 1er
//       avion en approche après 36 h)
//   node qa/probe-scenario.mjs --scenario custom --events "t=30m:forceFuel;t=1h:forceRunway"
//
// Les scénarios ne TOUCHENT PAS src/ : ils pilotent la sim par l'extérieur
// (pré-acceptation = la case autoAccept du jeu, forceIncident du module
// incidents — les deux existent déjà en production).
//
// ponytail : 1 harness + le PRNG de la sim (src/core/rng.mjs) ; pas de
// framework, pas de fixtures. Actions d'événements : autoAccept, autoRefuse,
// forceRunway, forceFuel, forceSurge, forceRunwayOnApproach (forçage
// CONDITIONNEL : au 1er tick ≥ t où un avion est en approche/holding, sinon
// forcé à t+2 h — la logique du gate bl17).

import fs from 'node:fs';
import path from 'node:path';
import { tick } from '../src/core/tick.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';
import { OPEX_PER_SEC } from '../src/data/catalog.mjs';
import { periodStatement } from '../src/economy/economy.mjs';
import { passengerSummary } from '../src/sim/passengers.mjs';

// ---------- args ----------
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) { console.error(`--${name} prend une valeur`); process.exit(2); }
  return v;
}
const SEED = Number(arg('seed', '42'));
const HOURS = Number(arg('hours', '48'));
const SCENARIO = arg('scenario', 'passive'); // passive | bl17 | custom
const EVENTS = arg('events', '');
const RUN_ID = arg('run-id', '') || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
if (!Number.isInteger(SEED) || SEED < 0) { console.error(`--seed : entier ≥ 0 attendu (got ${SEED})`); process.exit(2); }
if (!Number.isFinite(HOURS) || HOURS <= 0) { console.error(`--hours : nombre > 0 attendu (got ${HOURS})`); process.exit(2); }

// ---------- scénario : ce que le probe fait AUTOUR du tick de production ----------
// passive : rien — la politique du jeu (autoAccept) décide des vols planifiés
//           (tout est accepté, comme la case auto-accept du panneau).
// bl17    : le scénario du GATE, mot pour mot qa/bl17-sim48h.mjs :
//              0-24 h   auto-accept ON (tous les vols acceptés)
//              24-36 h  auto-accept OFF + refus de TOUT (le transport stagne)
//              36-48 h  auto-accept ON + fermeture piste forcée (120 s,
//                       forceIncident — au 1er avion en approche, bande 36-38 h,
//                       secours 40 h : sinon la fermeture n'aurait pas d'effet).
// custom  : --events "t=<n><u>:<action>[;...]" ; u ∈ s|m|h|''(=s) ;
//           action ∈ autoAccept | autoRefuse | forceRunway | forceFuel | forceSurge
//           | forceRunwayOnApproach (forçage conditionnel, logique du gate).
//           Les actions s'appliquent AU DEBUT du tick où sim.time ≥ t (ordre
//           stable : les événements sont triés par t, puis par ordre déclaré).
function setup() {
  const state = makeGameState();
  state.screen = 'game';
  const sim = state.sim;
  sim.rngSeed = SEED;          // champ de la sim (EV-10) — la suite ne dépend QUE du compteur,
  sim.rngCounter = 0;         // le seed n'est qu'un garde-fou d'intégrité (rng.mjs).
  const pol = 'accept';
  const evs = [];
  if (SCENARIO === 'bl17') {
    evs.push({ at: 24 * 3600, action: 'autoRefuse' });
    evs.push({ at: 36 * 3600, action: 'autoAccept' });
    evs.push({ at: 36 * 3600, action: 'forceRunwayOnApproach', delay: 4 * 3600 }); // secours 40 h (gate)
  }
  if (SCENARIO === 'custom' && EVENTS) {
    for (const chunk of EVENTS.split(';').filter((c) => c.trim())) {
      const m = chunk.trim().match(/^t=(\d+(?:\.\d+)?)([smh]?)[:=](\w+)$/i);
      if (!m) throw new Error(`événement illisible « ${chunk} » — format t=<n><s|m|h|>:<action>`);
      const mult = m[2].toLowerCase() === 'h' ? 3600 : m[2].toLowerCase() === 'm' ? 60 : 1;
      evs.push({ at: Number(m[1]) * mult, action: m[3] });
    }
  }
  evs.sort((a, b) => a.at - b.at);
  return { state, sim, policy: pol, events: evs, evIdx: 0, forced: [] };
}

// Forçage conditionnel (logique du gate bl17) : une fermeture SANS personne en
// l'air n'a aucune conséquence lisible → on force seulement au 1er avion en
// approche/holding ; l'événement reste EN ATTENTE (re-testé à chaque tick)
// jusqu'à cette condition, forçage inconditionnel à at + delay (secours 40 h).
function runwayForcedNow(sim, ev) {
  const inApproach = sim.aircraft.some((a) => a.phase === 'approach' || a.phase === 'holding');
  return inApproach || sim.time >= ev.at + (ev.delay ?? 0);
}

function applyDueEvents(r) {
  for (;;) {
    if (r.evIdx >= r.events.length) return;
    const ev = r.events[r.evIdx];
    if (ev.at > r.sim.time) return;
    if (ev.action === 'autoAccept') r.policy = 'accept';
    else if (ev.action === 'autoRefuse') r.policy = 'refuse';
    else if (ev.action === 'forceRunway') forceIncident(r.sim, 'runway');
    else if (ev.action === 'forceFuel') forceIncident(r.sim, 'fuel');
    else if (ev.action === 'forceSurge') forceIncident(r.sim, 'surge');
    else if (ev.action === 'forceRunwayOnApproach') {
      if (!runwayForcedNow(r.sim, ev)) return; // pas encore : on re-teste au tick suivant
      forceIncident(r.sim, 'runway');
    }
    else throw new Error(`action inconnue « ${ev.action} » (autoAccept|autoRefuse|forceRunway|forceFuel|forceSurge|forceRunwayOnApproach)`);
    if (ev.action.startsWith('force')) r.forced.push({ at: r.sim.time, action: ev.action }); // le MOMENT du forçage (conséquence mesurée)
    r.evIdx++;
  }
}

// ---------- rejouer la sim ----------
const T0 = Date.now();
const r = setup();
const { state, sim } = r;
const rng = makeSimRng(sim); // le PRNG DE LA SIM (rng.mjs) : son état (seed+compteur)
const DT = 1;                  // avance 1 s/sim-second (comme le bl17 de production)
const TOTAL = Math.round(HOURS * 3600);
let step = 0;
const counts = { built: 0, flightIn: 0, flightOut: 0, flightCancelled: 0, unlocked: 0, bankrupt: 0, runwayClosed: 0, fuelOut: 0, surgeStart: 0, noFuel: 0 };
const minMoney = { t: 0, money: sim.economy.money };
while (step < TOTAL) {
  applyDueEvents(r);
  // Politique autoAccept du jeu : la décision se prend AVANT le tick (main.mjs) —
  // on décide chaque vol encore « planned » de la file, comme le ferait la case.
  const st = r.policy;
  for (const e of sim.planning) {
    if (e.status === 'planned') decideFlight(sim, e.id, st === 'accept');
  }
  sim.alerts.length = 0;
  tick(state, DT, rng);
  for (const ev of sim.alerts) {
    const k = ev.kind;
    if (k === 'built') counts.built++;
    else if (k === 'flight-in') counts.flightIn++;
    else if (k === 'flight-out') counts.flightOut++;
    else if (k === 'flight-cancelled') counts.flightCancelled++;
    else if (k === 'unlocked') counts.unlocked++;
    else if (k === 'bankrupt') counts.bankrupt++;
    else if (k === 'runway-closed') counts.runwayClosed++;
    else if (k === 'fuel-out') counts.fuelOut++;
    else if (k === 'surge-start') counts.surgeStart++;
    else if (k === 'no-fuel') counts.noFuel++;
  }
  if (sim.economy.money < minMoney.money) { minMoney.t = sim.time; minMoney.money = sim.economy.money; }
  step += DT;
  if (sim.economy.bankrupt) break; // faillite : la sim est gelée (cœur de production)
}

// ---------- rapport ----------
const simEnd = sim.time;
const st = periodStatement(sim);
const pax = passengerSummary(sim);
const opex = st.opex; // compte spent.opex (déjà la somme socle+services)
const report = {
  runId: RUN_ID,
  seed: SEED,
  scenario: SCENARIO,
  policy: SCENARIO === 'bl17'
    ? 'fenêtres du gate : ON 0-24 h / refus de tout 24-36 h / ON 36-48 h'
    : 'auto-accept (tout est accepté, case auto-accept du jeu)',
  events: r.events.map((e) => ({ at: e.at, action: e.action })),
  forced: r.forced, // incidents forcés EFFECTIVEMENT (t réel du forçage, secondes)
  hours: HOURS,
  simTimeEnd: simEnd,
  stoppedEarly: sim.economy.bankrupt,
  money: { start: 12000, end: sim.economy.money, min: minMoney.money, atMin: minMoney.t, debt: sim.economy.debt },
  revenue: st.revenue,
  opex,
  opexPerHour: opex / (simEnd / 3600),
  fuel: st.fuel,
  compensation: st.compensation,
  invest: st.invest,
  net: st.net,
  bankruptcy: sim.economy.bankrupt,
  bankruptAt: minMoney.money < -10000 ? Math.round(minMoney.t) : null,
  passengers: { totalCarried: pax.totalCarried, satisfaction: Math.round(pax.satisfaction * 100) / 100 },
  counts,
  infra: {
    runways: sim.infra.runways.length,
    taxiways: sim.infra.taxiways.length,
    terminals: sim.infra.terminals.length,
    gates: sim.infra.gates.length,
    services: sim.infra.services.map((s) => s.type),
  },
  servicesOpexPerHour: sim.infra.services.reduce((a, s) => a + (OPEX_PER_SEC[s.type] ?? 0) * 3600, 0),
  determinism: {
    note: 'R09 : rejouer ce run (mêmes args) doit donner des fichiers IDENTIQUES en bytes.',
    rngSeed: sim.rngSeed,
    rngCounterEnd: sim.rngCounter,
    rngCounterStart: 0,
  },
};
const fs2 = (n) => Number(n).toFixed(2);
console.log('=== RAPPORT SCÉNARIO', SCENARIO, '| run', RUN_ID, '===');
console.log(`seed ${SEED} | ${HOURS} h (sim ${Math.round(simEnd / 60)} min) | arrêt ${report.stoppedEarly ? 'PREMATURE (faillite)' : 'naturel'}`);
console.log(`money : 12000 → ${fs2(report.money.end)} $ (min ${fs2(report.money.min)} $ à t=${Math.round(minMoney.t / 60)} min, dette ${fs2(report.money.debt)} $)`);
console.log(`revenue ${fs2(report.revenue)} | opex ${fs2(report.opex)} (${fs2(report.opexPerHour)} $/h, dont services ${fs2(report.servicesOpexPerHour)} $/h) | fuel ${fs2(report.fuel)} | indemnite ${fs2(report.compensation)} | invest ${fs2(report.invest)} | net ${fs2(report.net)}`);
console.log(`pax : ${report.passengers.totalCarried} transportes (sat ${report.passengers.satisfaction}%) | vols : in ${counts.flightIn} / out ${counts.flightOut} / annules ${counts.flightCancelled} | incidents : runway ${counts.runwayClosed} / fuel ${counts.fuelOut} / surge ${counts.surgeStart} / no-fuel ${counts.noFuel} | faillite ${report.bankruptcy ? 'OUI' : 'non'}`);
console.log(`infra : ${report.infra.runways} pistes / ${report.infra.taxiways} taxiways / ${report.infra.terminals} terminaux / ${report.infra.gates} portes ; services : ${report.infra.services.join(', ') || '(aucun)'}`);

// ---------- snapshot du state de FIN (déterminisme R09) ----------
// On recalcule les champs VOLATILS (pas sérialisés, reconstruits par la sim) au
// lieu de les effacer : le snapshot reste comparable ET rejouable (un snapshot
// qui perd son graphe re-déduit le graphe — même résultat).
sim._graph = null;
sim._graphDirty = true;
const snapshot = { scenario: SCENARIO, seed: SEED, runId: RUN_ID, state };

// ---------- preuve sur disque ----------
const outDir = path.join(process.cwd(), 'evidence', RUN_ID);
fs.mkdirSync(outDir, { recursive: true });
const repPath = path.join(outDir, `rapport-${RUN_ID}.json`);
const snapPath = path.join(outDir, `state-${RUN_ID}.json`);
fs.writeFileSync(repPath, JSON.stringify(report, null, 2));
fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
console.log(`preuve : ${repPath}`);
console.log(`preuve : ${snapPath}`);
console.log(`temps : ${Math.round((Date.now() - T0) / 1000)} s (${step} ticks)`);
