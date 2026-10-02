// BL-17 (AC26a/b) — scénario simulé PPROLONGÉ : 48 h de sim en pas de 1 s, sous
// Node, pipeline de tick RÉEL (src/core/tick.mjs) + décisions JOUEUR passées par
// decideFlight (la SEULE porte de décision, comme l'UI le fait au clic / touche A)
// — AUCUN DOM, AUCUN navigateur ici : la stabilité long-temps se prouve sur la
// logique pure ; le rendu long-temps est couvert par bl17-cdp.mjs (QA CDP).
//
// Scénario (AC26b : la décision JOUEUR a un effet MESURABLE) :
//   0-24 h   : auto-accept ON — le jeu déploie tous les vols planifiés
//   24-36 h  : auto-accept OFF + refus de tout — l'aéroport n'encaisse plus de
//              NOUVEAU vol : le transport et les recettes stagnent (mesure)
//   36-48 h  : auto-accept ON + 1 incident forcé (fermeture piste 120 s,
//              forceIncident — module incidents, même API que les tests) :
//              perturbation → conséquence mesurée (holding/retards) →
//              récupération (réouverture relance les atterrissages)
//
// Invariants vérifiés CHAQUE tick (un état incohérent = échec immédiat, AC26a) :
//   positions d'avions finies, phases connues, passagers transportés monotones,
//   money/satisfaction/argent finis, planning cohérent.
// Déterminisme (EV-10) : PRNG semé (seed 42, état sur la sim) + 2e passe
// identique → l'état final est REPRODUCTIBLE (la preuve est dans le rapport).
//
// Usage : node qa/bl17-sim48h.mjs   (code retour 0 = PASS, 1 = FAIL)
// Évidence : evidence/bl-17/ (rapport.txt + rapport.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeGameState } from '../src/core/new-game.mjs';
import { setScreen } from '../src/core/game-state.mjs';
import { tick } from '../src/core/tick.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';

const EVID = join(import.meta.dirname, '..', 'evidence', 'bl-17');
mkdirSync(EVID, { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const H = 3600; // secondes sim par heure (pas de tick = 1 s)
const DUR_H = 48;
const SEED = 42; // PRNG semé de la sim : la suite des vols/incidents est reproductible

// Phases valides d'un avion (catalog.mjs + états de fin/blocage des modules).
const PHASES = new Set([
  'approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel',
  'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked',
  'cancelled', 'departed',
]);

function newSim() {
  const state = makeGameState();
  setScreen(state, 'game'); // garde du tick : la sim ne bat que sur l'écran de jeu
  state.sim.rngSeed = SEED; // déterminisme (EV-10) : même seed → même partie
  return state;
}

// Invariants d'État INCOHÉRENT (AC26a) : un seul = la stabilité est rompue.
function invariants(sim, t, prev) {
  const m = sim.economy.money;
  const sat = sim.passengers.satisfaction;
  const carried = sim.passengers.totalCarried;
  if (!Number.isFinite(m) || !Number.isFinite(sat) || !Number.isFinite(carried)) {
    throw new Error(`t=${t} : valeur non finie (money=${m} sat=${sat} carried=${carried})`);
  }
  if (carried < prev.carried) {
    throw new Error(`t=${t} : passagers transportés NON monotones (${prev.carried} → ${carried})`);
  }
  for (const a of sim.aircraft) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
      throw new Error(`t=${t} : avion #${a.id} hors position (x=${a.x} y=${a.y})`);
    }
    if (!PHASES.has(a.phase)) {
      throw new Error(`t=${t} : avion #${a.id} phase inconnue « ${a.phase} »`);
    }
  }
  for (const e of sim.planning) {
    if (!Number.isFinite(e.planned) || !(e.status in { planned: 1, accepted: 1, 'in-flight': 1, delayed: 1, cancelled: 1 })) {
      throw new Error(`t=${t} : entrée planning incohérente #${e.id} (${e.status})`);
    }
  }
  prev.carried = carried;
}

// UNE passe de 48 h (seed → l'état final est comparable entre passes).
function runOnce() {
  const state = newSim();
  const sim = state.sim;
  let autoAccept = true;
  let incidentForced = false;
  let incidentAt = null;   // t (s) du forçage : la conséquence est mesurée sur la fenêtre
  let windowMaxHolding = 0; // max holding PENDANT la fermeture (conséquence, AC26b)
  const prev = { carried: 0 };
  const hourly = [];
  const phaseCounts = {};
  const t0 = Date.now();

  for (let t = 0; t <= DUR_H * H; t++) { // BL-18 : `<=` → le tick h=48 est échantillonné
    // Politique JOUEUR par FENÊTRE (AC26b) : auto-accept ON 0-24 h, OFF 24-36 h
    // (refus de TOUT : plus aucun NOUVEAU vol), ON à nouveau 36-48 h. C'est la
    // seule porte de décision (comme la case auto-accept de l'UI).
    autoAccept = t < 24 * H || t >= 36 * H;
    for (const e of sim.planning) {
      if (e.status !== 'planned') continue;
      decideFlight(sim, e.id, autoAccept); // OFF = refus (le vol n'arrivera jamais)
    }
    // Incident forcé (AC26b) : dans la bande 36-38 h, au 1er tick où un avion
    // est en approche/attente (bande 40-48 h en secours) — sinon la fermeture
    // n'aurait AUCUNE conséquence lisible (personne en l'air = fermeture sans
    // effet). Conséquence mesurée : les atterrissages patientent en holding
    // (fermeture 120 s, module incidents).
    const wants = sim.aircraft.some((a) => a.phase === 'approach' || a.phase === 'holding');
    if (wants && !incidentForced && (t < 38 * H ? t >= 36 * H : t >= 40 * H)) {
      incidentForced = true;
      incidentAt = t;
      forceIncident(sim, 'runway'); // 1 incident mesuré : fermeture piste 120 s
    }
    tick(state, 1); // pipeline réel (planner → avions → économie → passagers → incidents)
    if (incidentForced && t >= incidentAt && t - incidentAt < 120) {
      windowMaxHolding = Math.max(windowMaxHolding,
        sim.aircraft.filter((a) => a.phase === 'holding').length);
    }
    invariants(sim, t, prev);
    for (const a of sim.aircraft) phaseCounts[a.phase] = (phaseCounts[a.phase] || 0) + 1;
    if (t % H === 0) {
      hourly.push({
        h: t / H,
        money: Math.round(sim.economy.money),
        carried: sim.passengers.totalCarried,
        sat: Math.round(sim.passengers.satisfaction * 10) / 10,
        ac: sim.aircraft.length,
        planning: sim.planning.length,
        holding: sim.aircraft.filter((a) => a.phase === 'holding').length,
        runwayClosed: sim.incidents.runway.closed > 0,
      });
    }
  }
  const elapsed = (Date.now() - t0) / 1000;
  // État final condensé (comparaison de reproductibilité : mêmes entrées → mêmes sorties).
  // BL-18 : `elapsed` (horloge RÉELLE Date.now) n'est PAS de l'état sim — il est
  // exclu de l'objet comparé, sinon les 2 passes ne seraient JAMAIS identiques (EV-10).
  const final = {
    carried: sim.passengers.totalCarried,
    money: Math.round(sim.economy.money * 100) / 100,
    revenue: Object.fromEntries(Object.entries(sim.economy.revenue).map(([k, v]) => [k, Math.round(v)])),
    aircraft: sim.aircraft.map((a) => `${a.id}:${a.phase}`).join(','),
    rngCounter: sim.rngCounter, // état du PRNG : même valeur = suite reproductible
    phaseCounts,
  };
  return { final, hourly, incidentAt, incidentForced, windowMaxHolding, elapsed };
}

// --- exécution : 2 passes identiques + verdict ---------------------------------
const r1 = runOnce();
const r2 = runOnce(); // 2e passe : le PRNG est semé (EV-10) → état final IDENTIQUE
const repro = JSON.stringify(r1.final) === JSON.stringify(r2.final);
check('AC26a 48 h stables : 172 800 ticks sans état incohérent (invariants par tick)', true);
check('AC26b vols générés et transportés (auto-accept ON, 0-24 h)', r1.final.carried > 0, `carried=${r1.final.carried}`);

// AC26b : l'effet de la décision JOUEUR est MESURABLE — le delta de transport
// de la fenêtre 24-36 h (refus de tout) est strictement plus faible que celui
// de 0-24 h (tout accepté) : les refusés n'arrivent jamais.
const at = (h) => r1.hourly.find((x) => x.h === h) || { carried: 0, money: 0 };
const d1 = at(24).carried; // 0 → 24 h : acceptés
const d2 = at(36).carried - at(24).carried; // 24 → 36 h : refusés (seuls les en-cours finissent)
check('AC26b décision joueur mesurable : refus de tout → transport nettement réduit',
  d2 < d1, `carried 0-24h=${d1} vs 24-36h=${d2}`);

// AC26b (incidents) : l'incident forcé (fermeture piste 120 s) a une
// CONSÉQUENCE MESURÉE (avions en holding pendant la fermeture) et une
// RÉCUPÉRATION (réouverture relance l'activité : le transport repart).
check('AC26b incident forcé : conséquence mesurée (holding pendant la fermeture piste)',
  r1.incidentForced && r1.windowMaxHolding > 0,
  r1.incidentForced ? `t=${r1.incidentAt}s maxHolding=${r1.windowMaxHolding}` : 'incident jamais forcé');
const after = at(48).carried - at(44).carried; // 44-48 h : après la réouverture
check('AC26b incident forcé : récupération (transport repart après réouverture)',
  after > 0, `carried 44-48h=${after}`);
check('EV-10 reproductibilité : 2 passes (seed 42) → état final identique', repro,
  `money=${r1.final.money} carried=${r1.final.carried} rngCounter=${r1.final.rngCounter}`);
check('performance : 2 × 172 800 ticks exécutés', true,
  `passe 1 = ${r1.elapsed}s, passe 2 = ${r2.elapsed}s`);

// Rapport + verdict (le code retour porte le verdict).
const failed = results.filter((r) => !r.ok);
const txt = [
  `# BL-17 — rapport sim 48 h (node qa/bl17-sim48h.mjs)`,
  `Date : ${new Date().toISOString()}`,
  `Seed PRNG : ${SEED} (EV-10)`,
  `Résultat : ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length}/${results.length})`,
  '',
  ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`),
  '',
  `État final (passe 1) : carried=${r1.final.carried} money=${r1.final.money} rngCounter=${r1.final.rngCounter}`,
  `Recettes par catégorie : ${JSON.stringify(r1.final.revenue)}`,
  `Phases observées (cumul ticks) : ${JSON.stringify(r1.final.phaseCounts)}`,
  '',
  `Série horaire (48 lignes) :`,
  ...r1.hourly.map((x) =>
    `h=${String(x.h).padStart(2)} money=${x.money} carried=${x.carried} sat=${x.sat} ac=${x.ac} planning=${x.planning} holding=${x.holding} runwayClosed=${x.runwayClosed}`),
].join('\n');
writeFileSync(join(EVID, 'rapport.txt'), txt);
writeFileSync(join(EVID, 'rapport.json'), JSON.stringify({
  date: new Date().toISOString(), seed: SEED,
  result: failed.length ? 'FAIL' : 'PASS', results,
  final: r1.final, reproducible: repro, hourly: r1.hourly,
}, null, 2));
console.log(`\n=== ${failed.length ? 'FAIL' : 'PASS'} — ${results.length - failed.length}/${results.length} (evidence: evidence/bl-17) ===`);
process.exitCode = failed.length ? 1 : 0;
