// qa/probe-scenario.mjs — outillage DRY des scénarios de vérification (t_bc124f75).
//
// Rejoue la sim AVEC LE CŒUR DE LA PRODUCTION (src/core/tick.mjs, rng semé sur
// la sim, EV-10) et produit, pour une CONFIGURATION donnée (seed × durée × pas
// × politique × services) :
//   - un RAPPORT structuré : résumé lisible (console) + JSON
//     evidence/<runId>/rapport-<runId>.json ;
//   - un STATE de fin sérialisé : evidence/<runId>/state-<runId>.json
//     (le cache dérivé sim._graph est recalculé avant sérialisation — R09).
//
// Configuration (toutes CONSERVÉES dans le rapport, « les configurations
// employées ») :
//   --seed N         : seed du PRNG de la sim (rng.mjs, EV-10). AVANT R09,
//                      le champ rngSeed n'était PAS mélangé dans la suite (le
//                      générateur ne consommait que rngCounter) → deux seeds
//                      DONNAIENT LA MÊME PARTIE. CORRIGÉ PAR R09 : le seed est
//                      mélangé dans mulberry32 (t0 = seed + constante) → les
//                      seeds différents DONNENT DES PARTIES DIFFÉRENTES (le
//                      proof R09 : probe-seed-42 ≠ probe-seed-99, état final
//                      divergent ; les preuves sont dans evidence/r09-seed-42
//                      et evidence/r09-seed-99). Seed 0 = la suite d'ORIGINE (migration).
//   --hours H        : durée (heures sim). --dt P : pas de tick (s, défaut 1).
//   --policy P       : POLITIQUE DU JOUEUR sur les vols planifiés, avant chaque
//                      tick (comme la case auto-accept du jeu) :
//                      accept    (défaut) : tout est accepté (acceptation générale)
//                      refuse                   : tout est refusé (aucun nouveau vol)
//                      nodecision               : AUCUNE décision (file « planned »
//                                                 stagnée — vols qui n'arrivent jamais)
//                      prudent  (R36)  : acceptation seulement si capacité libre
//                                         (aucun avion en holding)
//                      expansion (R36) : acceptation + amélioration « terminal »
//                                         (capacité, R31) + s'associe à
//                                         --services all (croissance viable)
//                      greedy    (R36) : ACCEPTATION EXCESSIVE — tous les vols
//                                         + tous les contrats (R21/R26)
//                      badinvest (R36) : investissement INADAPTÉ — équipement
//                                         d'équipes (R31 : mauvais achat)
//   --no-state       : pas de snapshot de state (la matrice R36 n'a besoin que
//                      du RAPPORT — le state final ne sert qu'aux paires
//                      de determinisme du runner).
//   --services S     : CONSTRUCTION des services, chacun dès que la sim le
//                      permet (R23 : unlockState, conditions mesurables) :
//                      none (défaut) | fuel (carburant seul) | all (TOUTS :
//                      fuel, catering, cleaning, baggage, hangar)
//   --scenario bl17  : LE SCÉNARIO DU GATE (qa/bl17-sim48h.mjs) : fenêtres de
//                      politique 0-24 h accept / 24-36 h refus de tout /
//                      36-48 h accept + fermeture piste FORCÉE (forceIncident,
//                      120 s) au 1er avion en approche après 36 h (secours
//                      40 h). --policy est ignoré dans ce cas (le gate définit
//                      sa propre politique).
//   --events "t=<n><s|m|h>:<action>[;...]" : actions ad-hoc (forceRunway,
//                      forceFuel, forceSurge, autoAccept, autoRefuse,
//                      forceRunwayOnApproach — même moteur que bl17).
//
// Invariants par tick (esprit du gate bl17, un seul = ABORT) : money/sat
// finies, pax monotones, positions finies, phases connues, planning cohérent.
//
// USAGE :
//   node qa/probe-scenario.mjs --hours 48                       (accept, 48 h)
//   node qa/probe-scenario.mjs --hours 6 --policy nodecision
//   node qa/probe-scenario.mjs --hours 6 --services fuel        (carburant seul)
//   node qa/probe-scenario.mjs --hours 6 --services all         (tous services)
//   node qa/probe-scenario.mjs --hours 48 --scenario bl17
//   node qa/probe-scenario.mjs --hours 24 --policy greedy --no-state (matrice R36)
//
// ponytail : 1 harness + le PRNG DE LA SIM (pas de 2e générateur) ; pas de
// framework, pas de fixtures. Le temps RÉEL (Date.now) ne va JAMAIS dans le
// rapport JSON (comparable entre passes) — console uniquement.
//
// Les scénarios ne TOUCHENT PAS src/ : pilotage par l'extérieur (décisions
// decideFlight = la seule porte de décision du jeu, forceIncident = l'API du
// module incidents, buildBuilding = la commande de construction du joueur).

import fs from 'node:fs';
import path from 'node:path';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { decideContract } from '../src/flights/contracts.mjs'; // R36 : l'engagement maximal (greedy)
import { buyUpgrade, upgradeView } from '../src/infra/upgrades.mjs'; // R36 : l'investissement (bon/mauvais goulot, R31)
import { forceIncident } from '../src/sim/incidents.mjs';
import { buildBuilding, hasService } from '../src/infra/infra.mjs';
import { passengerSummary } from '../src/sim/passengers.mjs';
import { opexPerHour } from '../src/data/catalog.mjs';
import { unlockState } from '../src/infra/unlocks.mjs';
import { START_FUNDS } from '../src/core/sim-state.mjs';
import { periodStatement } from '../src/economy/economy.mjs';
// R37 (t_a4c636ab) : le rapport embarque la PROGRESSION + la QUALITÉ + les
// RÉSULTATS de contrats (lectures pures de fin de run — la sim n'est jamais
// touchée, la détermination n'est pas affectée) : la VALIDATION R37 (deux
// stratégies viables + compromis : expansion progresse davantage, greedy
// dégrade la qualité/les obligations, le mauvais achat coûte) se lit dans le
// rapport du harnais, pas dans une sonde parallèle.
import { objectiveView } from '../src/progression/objectives.mjs';
import { qualityView } from '../src/progression/quality.mjs';
import { contractView } from '../src/flights/contracts.mjs';

// ---------- args (parse minimal, pas de dépendance) ----------
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const SEED = Number(arg('--seed') ?? 0);
const HOURS = Number(arg('--hours') ?? 6);
const DT = Number(arg('--dt') ?? 1); // pas de tick (s sim) — « paramétrable par pas »
const POLICY = (arg('--policy') ?? 'accept');
const SERVICES = (arg('--services') ?? 'none');
const SCENARIO = (arg('--scenario') ?? 'custom');
const EVENTS = arg('--events') ?? '';
const RUN_ID = (arg('--run-id') ?? `probe-${SCENARIO}-${String(HOURS)}h`);
if (!Number.isInteger(SEED) || SEED < 0) { console.error(`--seed : entier >= 0 attendu (got ${arg('--seed')})`); process.exit(2); }
if (!Number.isFinite(HOURS) || HOURS <= 0) { console.error(`--hours : nombre > 0 attendu (got ${arg('--hours')})`); process.exit(2); }
if (!Number.isFinite(DT) || DT <= 0) { console.error(`--dt : nombre > 0 attendu (got ${arg('--dt')})`); process.exit(2); }
// R36 : politiques de la MATRICE (compositions des commandes publiques —
// decideFlight / buyUpgrade / decideContract — la sim n'est jamais touchée) :
//   prudent   : acceptation PRUDENTE — on n'accepte un vol que si la capacité
//               est libre (aucun avion en holding) ; sinon l'offre attend.
//   expansion : acceptation + MEILLEURE amélioration quand le goulot est les
//               FILES (buyUpgrade 'terminal', la bonne cible — R31) ; s'associe
//               à --services all (la stratégie de croissance viable).
//   greedy    : ACCEPTATION EXCESSIVE — tous les vols + TOUS les contrats
//               (decideContract accept) : l'engagement maximal (R21/R26).
//   badinvest : investissement INADAPTE — l'achat documenté « mauvais achat »
//               (R31 : buyUpgrade 'teams' (équipe nettoyage ×2) quand le
//               goulot affiché est les FILES = zéro effet sur la mesure qui
//               compte : les files ne se vident PAS) ; essai toutes les
//               15 min, plafond + refus restant dans la commande publique.
const POLICIES = ['accept', 'refuse', 'nodecision', 'prudent', 'expansion', 'greedy', 'badinvest'];
if (!POLICIES.includes(POLICY)) { console.error(`--policy : ${POLICIES.join('|')} attendu (got ${POLICY})`); process.exit(2); }
if (!['none', 'fuel', 'all'].includes(SERVICES)) { console.error(`--services : none|fuel|all attendu (got ${SERVICES})`); process.exit(2); }
const NO_STATE = args.includes('--no-state'); // R36 matrice : le RAPPORT suffit (le state final ne sert qu'aux paires de determinisme)

// ---------- services : placement FIXE (coin haut-gauche, hors du plan de
// départ A-2 qui occupe x>=550) — construction CHARGÉE (buildBuilding débite
// le solde, comme le ferait le joueur). Chaque service est construit dès que
// SON condition est remplie (R23 : unlockState, conditions mesurables —
// plus de seuil pax) : la progression du jeu.
const SERVICE_SPOTS = Object.freeze({
  fuel: { x: 0, y: 0 }, catering: { x: 120, y: 0 }, cleaning: { x: 220, y: 0 },
  baggage: { x: 320, y: 0 }, hangar: { x: 0, y: 100 },
});
const wantedServices = SERVICES === 'fuel' ? ['fuel']
  : SERVICES === 'all' ? Object.keys(SERVICE_SPOTS) : [];

// ---------- setup : l'aéroport de départ DE PRODUCTION + la config ----------
function setup() {
  const state = makeGameState();
  state.screen = 'game';
  const sim = state.sim;
  sim.rngSeed = SEED;          // champ de la sim (EV-10) : le seed EST mélangé dans la suite (R09)
  sim.rngCounter = 0;         // compteur de départ 0 (nouvelle partie) — la suite = f(seed, compteur)
  const evs = [];
  if (SCENARIO === 'bl17') { // le GATE, mot pour mot (fenêtres + forçage)
    evs.push({ at: 24 * 3600, action: 'autoRefuse' });
    evs.push({ at: 36 * 3600, action: 'autoAccept' });
    evs.push({ at: 36 * 3600, action: 'forceRunwayOnApproach', delay: 4 * 3600 }); // secours 40 h
  }
  if (EVENTS) {
    for (const chunk of EVENTS.split(';').filter((c) => c.trim())) {
      const m = chunk.trim().match(/^t=(\d+(?:\.\d+)?)([smh]?)[:=](\w+)$/i);
      if (!m) throw new Error(`événement illisible « ${chunk} » — format t=<n><s|m|h|>:<action>`);
      const mult = m[2].toLowerCase() === 'h' ? 3600 : m[2].toLowerCase() === 'm' ? 60 : 1;
      evs.push({ at: Number(m[1]) * mult, action: m[3] });
    }
  }
  evs.sort((a, b) => a.at - b.at);
  return { state, sim, policy: POLICY, events: evs, evIdx: 0, forced: [] };
}

// Forçage conditionnel (logique du gate bl17) : une fermeture SANS personne en
// l'air n'a aucune conséquence lisible → forçage seulement au 1er avion en
// approche/holding ; l'événement reste EN ATTENTE (re-testé chaque tick) jusqu'
// à cette condition, sinon forçage inconditionnel à at + delay (secours 40 h).
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
      if (!runwayForcedNow(r.sim, ev)) return; // pas encore : re-test au tick suivant
      forceIncident(r.sim, 'runway');
    }
    else throw new Error(`action inconnue « ${ev.action} » (autoAccept|autoRefuse|forceRunway|forceFuel|forceSurge|forceRunwayOnApproach)`);
    if (ev.action.startsWith('force')) r.forced.push({ at: r.sim.time, action: ev.action }); // le MOMENT (conséquence mesurée)
    r.evIdx++;
  }
}

// Construction des services voulus : dès que la sim LEUR PERMET (R23 :
// unlockState = la MÊME règle que tickUnlocks, conditions mesurables —
// plus de seuil de pax fixe) ; placement fixe ; buildBuilding ré-essaie
// (fonds/position), la charge passe par l'éco.
function buildWantedServices(sim) {
  for (const type of wantedServices) {
    if (hasService(sim, type)) continue;
    if (!unlockState(sim, type).unlocked) continue; // pas encore débloqué (règle sim)
    const spot = SERVICE_SPOTS[type];
    buildBuilding(sim, type, spot.x, spot.y); // charge + grille + alertes (built / locked / no-funds)
  }
}

// ---------- rejouer la sim (cœur de production : tick.mjs) ----------
const T0 = Date.now();
const r = setup();
const { state, sim } = r;
const rng = makeSimRng(sim); // le PRNG DE LA SIM (rng.mjs) : état sur la sim (EV-10)
const TOTAL = Math.ceil((HOURS * 3600) / DT);
const counts = { built: 0, flightIn: 0, flightOut: 0, flightCancelled: 0, unlocked: 0, bankrupt: 0, runwayClosed: 0, fuelOut: 0, surgeStart: 0, noFuel: 0, contractStarted: 0, upgraded: 0 };
const minMoney = { t: 0, money: sim.economy.money };
const prev = { carried: 0 }; // invariants par tick (un état incohérent = ABORT)
const PHASES = new Set(['approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked', 'cancelled', 'departed']);
// R36 : état local des stratégies (investissements périodiques) — aucune
// règle de sim, seulement le CADRANT des essais (toutes les règles — coût,
// niveau max, fonds, goulot — restent dans les commandes publiques).
let lastInvest = -1; // le dernier marquage de 15 min franchi (t sim)
let upgradesBought = 0, upgradesRefused = 0, contractsAccepted = 0, contractsRefused = 0;
const tryInvest = (kind) => { // l'essai : la commande décide (refus lisible, pas de mutation)
  const term = sim.infra.terminals[0];
  if (!term) return;
  const res = buyUpgrade(sim, term.id, kind);
  if (res.ok) upgradesBought++; else upgradesRefused++;
};
let step = 0;
while (step < TOTAL) {
  applyDueEvents(r);
  // Politique JOUEUR sur la file de planning (porte unique : decideFlight),
  // avant le tick — comme la case auto-accept du jeu (main.mjs).
  if (r.policy !== 'nodecision') {
    // R36 : 'prudent' = on n'accepte que si la capacité est LIBRE (aucun
    // avion en holding) — l'offre expire elle-même si on ne décide pas (10
    // min, OFFER_DECISION_S) ; les autres politiques acceptent toutes.
    const holding = sim.aircraft.some((a) => a.phase === 'holding');
    const acceptNow = POLICY !== 'prudent' || !holding;
    for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, acceptNow);
  }
  // R36 : stratégies d'engagement (compositions des commandes publiques —
  // l'UI du jeu fait exactement ça avec ses boutons ; les règles restent ici).
  if (POLICY === 'greedy' && sim.contracts) {
    // ACCEPTATION EXCESSIVE : chaque offre de contrat est acceptée (R21/R26 :
    // un contrat actif augmente la demande — l'engagement maximal).
    if (sim.contracts.offered) {
      if (decideContract(sim, sim.contracts.offered.id, true)) contractsAccepted++;
      else contractsRefused++; // refusé par la sim (offre déjà consommée / contrat actif)
    }
  }
  // R36 : essais d'investissement périodiques (toutes les 15 min sim ; le
  // plafonnement maxLevel + le refus restent dans la COMMANDE publique).
  // Le GOUTLE vient de la MÊME règle que l'UI (upgradeView, R31) :
  //   expansion   : acheter la CAPACITÉ ('terminal' +60 % check-in/sécurité)
  //                 — la bonne cible quand les files saturent.
  //   badinvest   : acheter l'ÉQUIPEMENT D'ÉQUIPE ('teams' ×2 nettoyage)
  //                 quand le goulot est les FILES — l'investissement INADAPTÉ
  //                 documenté (R31 : l'argent dépensé ne dévide AUCUNE file).
  // On n'essaie QUE quand l'UI le verrait : un goulot existe sur ce terminal.
  if (POLICY === 'expansion' || POLICY === 'badinvest') {
    const mark = Math.floor(sim.time / 900); // le créneau de 15 min courant
    if (mark > lastInvest) {
      lastInvest = mark;
      const view = upgradeView(sim, sim.infra.terminals[0]?.id);
      if (view) tryInvest(POLICY === 'expansion' ? 'terminal' : 'teams');
    }
  }
  buildWantedServices(sim); // services voulus, dès leur seuil (progression du jeu)
  sim.alerts.length = 0;
  tick(state, DT, rng);
  // Invariants (8/8) : NaN, pax monotones, positions finies, phases connues,
  // planning cohérent — un seul = la stabilité est rompue.
  if (!Number.isFinite(sim.economy.money) || !Number.isFinite(sim.passengers.satisfaction)) {
    throw new Error(`t=${sim.time} : money/satisfaction non finie (NaN ?)`);
  }
  if (sim.passengers.totalCarried < prev.carried) throw new Error(`t=${sim.time} : pax NON monotones`);
  prev.carried = sim.passengers.totalCarried;
  for (const a of sim.aircraft) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) throw new Error(`t=${sim.time} : avion #${a.id} position non finie`);
    if (!PHASES.has(a.phase)) throw new Error(`t=${sim.time} : avion #${a.id} phase inconnue « ${a.phase} »`);
  }
  for (const e of sim.planning) {
    if (!Number.isFinite(e.planned) || !(e.status in { planned: 1, accepted: 1, 'in-flight': 1, delayed: 1, cancelled: 1 })) {
      throw new Error(`t=${sim.time} : planning incohérent #${e.id} (${e.status})`);
    }
  }
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
    else if (k === 'contract-started') counts.contractStarted++;
    else if (k === 'upgraded') counts.upgraded++;
  }
  const m = sim.economy.money;
  if (m < minMoney.money) { minMoney.money = m; minMoney.t = sim.time; }
  step++;
  if (sim.economy.bankrupt) break; // la sim est gelée (faillite déclarée)
}
const elapsedMs = Date.now() - T0;
const simEnd = sim.time;

// ---------- RAPPORT structuré (JSON + résumé) ----------
const st = periodStatement(sim);
const queueEnd = passengerSummary(sim); // attente fin de run (files par étape)
const opex = st.opex;
const report = {
  tool: 'qa/probe-scenario.mjs',
  commit: process.env.GIT_COMMIT ?? '(non connu)',
  runId: RUN_ID,
  seed: SEED,
  scenario: SCENARIO,
  config: { // les configurations employées (toutes, comme exigé)
    policy: SCENARIO === 'bl17' ? 'fenêtres du gate : accept 0-24 h / refus 24-36 h / accept 36-48 h'
      : POLICY === 'prudent' ? 'prudent (acceptation seulement si capacité libre : aucun avion en holding)'
      : POLICY === 'expansion' ? 'expansion (acceptation + amélioration "terminal" quand le goulot est les files ; s associe a --services all)'
      : POLICY === 'greedy' ? 'greedy (acceptation EXCESSIVE : tous les vols + tous les contrats actifs)'
      : POLICY === 'badinvest' ? 'badinvest (investissement INADAPTE : equipment equipes quand le goulot est les files - argent non converti)'
      : POLICY,
    services: SERVICES,
    events: r.events.map((e) => ({ at: e.at, action: e.action })),
    dt: DT,
    hours: HOURS,
  },
  strategy: { // R36 : les COMPTAGES DES COMMANDES JOUEUR (ce que la politique a réellement fait)
    upgradesBought, upgradesRefused, contractsAccepted, contractsRefused,
  },
  forced: r.forced, // incidents forcés EFFECTIVEMENT (t réel du forçage, s)
  simTimeEnd: simEnd,
  stoppedEarly: sim.economy.bankrupt,
  money: { start: START_FUNDS, end: sim.economy.money, min: minMoney.money, atMin: minMoney.t, debt: sim.economy.debt },
  revenue: st.revenue,
  opex,
  opexPerHour: opex / (simEnd / 3600),
  fuel: st.fuel,
  compensation: st.compensation,
  invest: st.invest,
  net: st.net,
  bankruptcy: sim.economy.bankrupt,
  bankruptAt: minMoney.money < -10000 ? Math.round(minMoney.t) : null,
  passengers: { totalCarried: queueEnd.totalCarried, satisfaction: Math.round(sim.passengers.satisfaction * 100) / 100 },
  // ATTENTE fin de run (critère « attente ») : files passagers par étape +
  // avions en holding + vols planifiés en attente de décision.
  wait: {
    queues: queueEnd.queue, // {checkin/security/board: {n, cap, occ}}
    holding: sim.aircraft.filter((a) => a.phase === 'holding').length,
    plannedPending: sim.planning.filter((e) => e.status === 'planned').length,
  },
  counts,
  // R37 : la PROGRESSION + la QUALITÉ + les CONTRATS (lectures pures, bornées
  // — l'historique des contrats est lui-même borné à HISTORY_MAX, R14).
  objectives: [ 'o1-cycle', 'o2-surge' ].map((id) => {
    const v = objectiveView(sim, id);
    return { id, state: v.state, paid: sim.objectives?.find((o) => o.id === id)?.paid === true };
  }),
  quality: qualityView(sim),
  contracts: {
    accepted: (contractView(sim).history || []).filter(Boolean).filter((h) => h.result).length,
    results: (contractView(sim).history || []).filter(Boolean).map((h) => h.result).filter(Boolean),
    active: contractView(sim).active ? { model: contractView(sim).active.model, result: null } : null,
  },
  unlocked: sim._unlocked ? Object.keys(sim._unlocked) : [],
  infra: {
    runways: sim.infra.runways.length,
    taxiways: sim.infra.taxiways.length,
    terminals: sim.infra.terminals.length,
    gates: sim.infra.gates.length,
    services: sim.infra.services.map((s) => s.type),
  },
  servicesOpexPerHour: sim.infra.services.reduce((a, s) => a + opexPerHour(s.type), 0),
  determinism: {
    note: 'R09 (livré) : rejouer cette configuration (mêmes args, même commit) donne des fichiers IDENTIQUES en bytes. Les seeds différents DONNENT DES PARTIES DIFFÉRENTES (le seed est mélangé dans mulberry32 — preuve : evidence/r09-seed-42 vs r09-seed-99). Rejouer une config d’AVANT R09 avec seed 0 reste bit-à-bit la suite d’origine (migration).',
    rngSeed: sim.rngSeed,
    rngCounterEnd: sim.rngCounter,
    rngCounterStart: 0,
  },
};
const fs2 = (n) => Number(n).toFixed(2);
console.log('=== RAPPORT SCÉNARIO', SCENARIO, '| run', RUN_ID, '===');
console.log(`seed ${SEED} | ${HOURS} h (sim ${Math.round(simEnd / 60)} min, pas ${DT}s) | arrêt ${report.stoppedEarly ? 'PREMATURE (faillite)' : 'naturel'}`);
console.log(`policy ${report.config.policy} | services ${SERVICES}${r.forced.length ? ' | forcés ' + r.forced.map((f) => `${f.action}@${Math.round(f.at)}s`).join(', ') : ''}`);
console.log(`money : ${START_FUNDS} → ${fs2(report.money.end)} $ (min ${fs2(report.money.min)} $ à t=${Math.round(minMoney.t / 60)} min, dette ${fs2(report.money.debt)} $)`);
console.log(`revenue ${fs2(report.revenue)} | opex ${fs2(report.opex)} (${fs2(report.opexPerHour)} $/h, dont services ${fs2(report.servicesOpexPerHour)} $/h) | fuel ${fs2(report.fuel)} | indemnite ${fs2(report.compensation)} | invest ${fs2(report.invest)} | net ${fs2(report.net)}`);
console.log(`pax : ${report.passengers.totalCarried} transportes (sat ${report.passengers.satisfaction}%) | vols : in ${counts.flightIn} / out ${counts.flightOut} / annules ${counts.flightCancelled} | incidents : runway ${counts.runwayClosed} / fuel ${counts.fuelOut} / surge ${counts.surgeStart} | faillite ${report.bankruptcy ? 'OUI' : 'non'}`);
console.log(`attente fin : checkin ${report.wait.queues.checkin.n}/${report.wait.queues.checkin.cap} | securite ${report.wait.queues.security.n}/${report.wait.queues.security.cap} | embarquement ${report.wait.queues.board.n}/${report.wait.queues.board.cap} | holding ${report.wait.holding} | pending ${report.wait.plannedPending}`);
console.log(`infra : ${report.infra.runways} pistes / ${report.infra.taxiways} taxiways / ${report.infra.terminals} terminaux / ${report.infra.gates} portes ; services : ${report.infra.services.join(', ') || '(aucun)'} ; debloques : ${report.unlocked.join(', ') || '(aucun)'}`);
if (POLICY === 'greedy' || POLICY === 'expansion' || POLICY === 'badinvest') {
  console.log(`stratégie : achats ${upgradesBought} / refusés ${upgradesRefused}${POLICY === 'greedy' ? ` | contrats acceptés ${contractsAccepted} / refusés ${contractsRefused}` : ''}`);
}

// ---------- snapshot du state de FIN (déterminisme R09) ----------
// On recalcule les champs VOLATILS (pas sérialisés, reconstruits par la sim)
// au lieu de les effacer : le snapshot reste comparable ET rejouable.
sim._graph = null;
sim._graphDirty = true;
const snapshot = { scenario: SCENARIO, seed: SEED, runId: RUN_ID, config: report.config, state };

// ---------- preuve sur disque ----------
const outDir = path.join(process.cwd(), 'evidence', RUN_ID);
fs.mkdirSync(outDir, { recursive: true });
const repPath = path.join(outDir, `rapport-${RUN_ID}.json`);
fs.writeFileSync(repPath, JSON.stringify(report, null, 2));
let snapPath = null;
if (!NO_STATE) {
  snapPath = path.join(outDir, `state-${RUN_ID}.json`);
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
}
console.log(`preuve : ${repPath}`);
if (snapPath) console.log(`preuve : ${snapPath}`);
console.log(`temps : ${Math.round(elapsedMs / 1000)} s (${step} ticks)`);
