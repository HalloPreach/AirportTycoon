// R38 (t_8f8f4a63) — validation des TROIS SCÉNARIOS REJOUABLES (src/scenarios.mjs)
// + R46 (t_7b04f863) : les 3 NOUVEAUX scénarios (crise / difficile / facile)
// — le harnais rejoue TOUS les modes de la table SCENARIOS (généralisé R46).
//
// Rejoue CHAQUE scénario AVEC LE CŒUR DE PRODUCTION (tick.mjs + le PRNG de la
// sim, rng.mjs) — le même harnais que qa/probe-scenario.mjs (DRY : même
// pattern setup → rejouer → rapport JSON dans evidence/<runId>/). La sim est
// JAMAIS modifiée : le harnais compose des commandes publiques (decideFlight,
// takeLoan) et lit l'état — la réussite des objectifs est décidée PAR LA SIM
// (tickObjectives, R22), jamais forcée par le test (R16 : pas de faux chiffre).
//
// Pour chaque mode (guide / saturation / redressement), le rapport embarque :
//   • la CONFIGURATION EXPLICITE (seed, solde, pic, emprunt — les règles ne
//     sont pas modifiées : pic = forceIncident, emprunt = takeLoan) ;
//   • la REJOUABILITÉ : deux parties fraîches MÊME config → snapshots
//     BYTE-IDENTIQUES (sha256) ;
//   • l'OBJECTIF ANNONCÉ (id/nom/récompense lu du catalogue R22) + son statut
//     FINAL lu de la sim (« payé » seulement si la sim l'a payé) ;
//   • pour saturation : le pic ACTIF dès le départ avec la durée EXPLICITE du
//     défi (600 s) ;
//   • pour redressement : le DÉFICIT de départ (-3000 $) + l'emprunt R35
//     (takeLoan) qui remonte le solde dans le vert ;
//   • les invariants par tick (money/satisfaction finies, pax monotones,
//     positions finies, phases connues — un seul = ABORT, esprit bl17).
//
// USAGE : node qa/r38-scenarios.mjs   (rapports : evidence/r38-<mode>/rapport-*.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { takeLoan, loanState } from '../src/economy/economy.mjs';
import { SCENARIOS, scenarioObjective, scenarioSuccess, SATURATION_SURGE_S, REDRESSEMENT_FUNDS, CRISIS_SURGE_S, CRISIS_RUNWAY_CLOSE_S } from '../src/scenarios.mjs';
import { startScenario } from '../src/scenarios.mjs';
import { DIFFICULTIES } from '../src/core/difficulty.mjs';
import { START_FUNDS } from '../src/core/sim-state.mjs';

// Capital de départ EFFECTIF d'un scénario (config EXPLICITE, lu de la table
// — pas de chiffre dupliqué) : `funds` explicite du défi, sinon le capital du
// profil T2-1 (difficulté), sinon START_FUNDS (référentiel normal, R38).
function scenarioStartFunds(mode) {
  const cfg = SCENARIOS[mode];
  if (cfg.funds !== undefined) return cfg.funds;
  if (cfg.difficulty) return DIFFICULTIES[cfg.difficulty].startFunds;
  return START_FUNDS;
}

const DT = 1; // pas 1 s (pas naturel des matrices R36)
const HOURS = 1; // 1 h de rejoue par scénario (la matière de validation R38)
const PHASES = new Set(['approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked', 'cancelled', 'departed']);

// Politique JOUEUR documentée (comme la case auto-accept du jeu) : accepter
// les vols planifiés avant chaque tick (decideFlight = la seule porte de
// décision du jeu). Pour redressement : l'emprunt R35 est pris UNE fois,
// dès le départ (le levier DU JOUEUR, commande existante).
function replay(mode, hours, extra = {}) {
  const state = startScenario(mode);
  state.screen = 'game'; // tick.mjs : la sim n'avance que si state.screen === 'game'
  const sim = state.sim;
  const rng = makeSimRng(sim);
  const TOTAL = Math.ceil((hours * 3600) / DT);
  if (mode === 'redressement' && extra.loan) {
    const ls = loanState(sim);
    const res = takeLoan(sim); // l'emprunt borné R35 (commande EXISTANTE du joueur)
    state.loanState = { availableBefore: ls.available, taken: res.ok, moneyAfter: sim.economy.money, principal: res.principal ?? null, interest: res.interest ?? null };
  }
  let step = 0;
  const prev = { carried: 0 };
  while (step < TOTAL) {
    for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true); // politique documentée
    sim.alerts.length = 0;
    tick(state, DT, rng);
    // Invariants par tick (un seul = ABORT — la stabilité est rompue).
    if (!Number.isFinite(sim.economy.money) || !Number.isFinite(sim.passengers.satisfaction)) throw new Error(`t=${sim.time} : money/satisfaction non finies (NaN ?)`);
    if (sim.passengers.totalCarried < prev.carried) throw new Error(`t=${sim.time} : pax NON monotones`);
    prev.carried = sim.passengers.totalCarried;
    for (const a of sim.aircraft) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) throw new Error(`t=${sim.time} : avion #${a.id} position non finie`);
      if (!PHASES.has(a.phase)) throw new Error(`t=${sim.time} : avion #${a.phase} phase inconnue`);
    }
    step++;
    if (sim.economy.bankrupt) break; // la sim est gelée (faillite)
  }
  return state;
}

// Snapshot normalisé (les champs VOLATILS sont recalculés — comparables) + sa
// empreinte sha256 (la preuve de rejouabilité, comme les paires R36).
function snapshot(state) {
  state.sim._graph = null;
  state.sim._graphDirty = true;
  const json = JSON.stringify(state);
  return { json, sha256: crypto.createHash('sha256').update(json).digest('hex') };
}

function validate(mode) {
  const obj = scenarioObjective(startScenario(mode));
  // REJOUABILITÉ : deux parties fraîches MÊME config + MÊME politique → MÊME
  // partie (snapshots byte-identiques ; le PRNG de la sim est sur la sim, EV-10).
  const runA = replay(mode, HOURS, { loan: mode === 'redressement' });
  const runB = replay(mode, HOURS, { loan: mode === 'redressement' });
  const snapA = snapshot(runA), snapB = snapshot(runB);
  const deterministic = snapA.sha256 === snapB.sha256;
  const sim = runA.sim;
  const succ = scenarioSuccess(runA);
  const report = {
    tool: 'qa/r38-scenarios.mjs',
    commit: process.env.GIT_COMMIT ?? '(non connu)',
    mode,
    config: { // les CONFIGURATIONS EXPLICITES (les règles ne sont pas modifiées)
      seed: sim.rngSeed,
      funds: scenarioStartFunds(mode),
      difficulty: SCENARIOS[mode].difficulty ?? 'normal', // R46 : le profil T2-1 du défi (absent → normal, R38)
      surge: mode === 'saturation' ? { active: true, seconds: SATURATION_SURGE_S, note: 'durée EXPLICITE du défi — la durée naturelle (90 s) n\'est pas écrasée' }
        : mode === 'crise' ? { active: true, seconds: CRISIS_SURGE_S, note: 'durée EXPLICITE du défi — la durée naturelle (90 s) n\'est pas écrasée' }
        : null,
      runwayClosed: mode === 'crise' ? { activeAtStart: true, seconds: CRISIS_RUNWAY_CLOSE_S, note: 'fermeture de la piste forçée dès le départ (forceIncident R32) — durée EXPLICITE du défi (= la durée R32) ; la réponse du joueur est l\'intervention payante R33 (600 $) ou l\'attente' } : null,
      loan: runA.loanState ?? null,
      objective: obj,
      dt: DT, hours: HOURS,
      policy: mode === 'redressement' ? 'acceptation des vols + emprunt R35 une fois au départ (takeLoan, le levier DU JOUEUR)' : 'acceptation des vols (comme la case auto-accept du jeu)',
    },
    saturation: mode === 'saturation'
      ? { activeAtStart: true, durationS: SATURATION_SURGE_S, note: 'le pic est ACTIF dès le départ avec la fenêtre EXPLICITE du défi (600 s) — après 1 h de rejoue, un pic actif en fin de run serait un pic NATUREL (pas celui du défi)' }
      : null,
    redressement: mode === 'redressement'
      ? { deficitAtStart: REDRESSEMENT_FUNDS, bankruptAtStart: false, loan: runA.loanState ?? null, backInGreen: sim.economy.money > 0 }
      : null,
    crise: mode === 'crise'
      ? { surgeAtStart: true, surgeWindowS: CRISIS_SURGE_S, runwayClosedAtStart: true, runwayDurationS: CRISIS_RUNWAY_CLOSE_S, objective: 'o2-surge — la ponctualité (≥ 50 %) doit tenir PENDANT le pic, avec la piste fermée 120 s au départ (la sim décide, R16)' }
      : null,
    objective: {
      announced: obj,
      successReadFromSim: succ, // « payé » seulement si la sim l\'a payé (R16 : pas forcé)
      note: 'la réussite est décidée PAR LA SIM (tickObjectives, R22) — le harnais ne la force pas',
    },
    money: { start: scenarioStartFunds(mode), end: sim.economy.money, bankrupt: sim.economy.bankrupt },
    passengers: { totalCarried: sim.passengers.totalCarried, satisfaction: Math.round(sim.passengers.satisfaction * 100) / 100 },
    invariants: 'OK (money/satisfaction finies, pax monotones, positions finies, phases connues — un seul = ABORT)',
    determinism: {
      snapshotsByteIdentical: deterministic,
      sha256RunA: snapA.sha256,
      sha256RunB: snapB.sha256,
      note: 'R09 : même config + même politique = MÊME partie (EV-10 : le PRNG est sur la sim)',
    },
  };
  const outDir = path.join(process.cwd(), 'evidence', `r38-${mode}`);
  fs.mkdirSync(outDir, { recursive: true });
  const repPath = path.join(outDir, `rapport-r38-${mode}.json`);
  fs.writeFileSync(repPath, JSON.stringify(report, null, 2));
  const statePath = path.join(outDir, `state-r38-${mode}.json`);
  fs.writeFileSync(statePath, snapA.json);
  return { report, repPath, statePath };
}

const results = [];
for (const mode of Object.keys(SCENARIOS)) { // R46 : TOUS les scénarios de la table (les 3 R38 + les 3 R46)
  const { report, repPath } = validate(mode);
  results.push(mode);
  console.log(`=== SCÉNARIO ${mode} (${report.config.difficulty}) ===`);
  console.log(`  config : seed ${report.config.seed} | solde ${report.config.funds} $ | difficulté ${report.config.difficulty} | pic ${report.config.surge ? `ACTIF (${report.config.surge.seconds} s, durée explicite du défi)` : 'aucun'}${report.config.runwayClosed ? ` | piste FERMÉE (${report.config.runwayClosed.seconds} s, durée explicite du défi)` : ''} | objectif ${report.config.objective.id} (${report.config.objective.name})`);
  console.log(`  rejouable : snapshots byte-identiques = ${report.determinism.snapshotsByteIdentical} (sha256 ${report.determinism.sha256RunA.slice(0, 12)}…)`);
  if (report.redressement) {
    const r = report.redressement;
    const l = r.loan;
    console.log(`  redressement : déficit de départ ${r.deficitAtStart} $ | emprunt R35 pris=${l && l.taken ? 'oui' : 'non'}${l && l.taken ? ` (principal ${l.principal} $, intérêts ${l.interest} $, solde après ${l.moneyAfter} $)` : ''} | remonte dans le vert = ${r.backInGreen ? 'OUI' : 'non'}`);
  }
  if (report.saturation) console.log(`  saturation : pic ACTIF dès le départ (fenêtre du défi ${report.saturation.durationS} s) — après ${HOURS} h, la fenêtre du défi est écoulée (un pic actif en fin de run serait un pic naturel)`);
  if (report.crise) console.log(`  crise : pic ACTIF (${report.crise.surgeWindowS} s) + piste FERMÉE (${report.crise.runwayDurationS} s) dès le départ — après ${HOURS} h, les fenêtres du défi sont écoulées (un incident actif en fin de run serait NATUREL)`);
  console.log(`  objectif : ${report.objective.successReadFromSim.done ? 'PAYÉ PAR LA SIM' : 'non payé (la sim décide — le harnais ne force pas)'} | money ${report.money.start} → ${report.money.end} $ | pax ${report.passengers.totalCarried}`);
  console.log(`  rapport : ${repPath}`);
}
console.log(`\n=== R46 VALIDATION : les ${results.length} scénarios rejoués (${results.join(', ')}) — rejouables, même règles, config explicite ===`);
