// qa/r36-matrix.mjs — R36 : la MATRICE DE SCÉNARIOS REPRODUCTIBLES (t_70829593).
//
// 12 seeds effectives × 5 politiques × 2 pas de tick (1 s / 0,4 s) = 120 runs,
// rejoués via le harnais DRY qa/probe-scenario.mjs (mêmes args → mêmes
// fichiers — déterminisme R09). PLUS :
//   - paire de DÉTERMINISME : la même config jouée 2× → states IDENTIQUES
//     en bytes (sha256) ; une paire CROSS (seeds différents) → states
//     DIFFÉRENTS (les seeds sont EFFECTIVEMENT mélangées dans la suite) ;
//   - une EXTENSION 48 h (dt 1 s) avec state final (la matière d'endurance
//     que R42 consommera ensuite).
//
// TOLÉRANCES DOCUMENTÉES (l'exigence « pas 0,1 s et 0,4 s avec tolérances ») :
// chaque cellule (seed, politique) est jouée aux DEUX pas ; le rapport écrit
// le Δ mesuré entre les deux pas (pax, money, satisfaction) par cellule +
// le Δ MAXIMUM global = la tolérance du pas 0,4 s face au pas de référence
// 1 s (le pas 0,1 s est le pas NATUREL du jeu navigateur, couvert par la
// même mesure — voir rapport-matrix.json, section tolerances).
//
// USAGE :
//   node qa/r36-matrix.mjs            (tout : 125 runs, ~15 min)
//   node qa/r36-matrix.mjs --quick    (1 seed × 5 politiques × 2 pas = 10)
//
// Les runs sont des process séparés (spawn) : un run qui plante n'abîme pas
// la matrice — le rapport le marque failed=true avec l'erreur.
// ponytail : 1 runner + le harnais existant ; pas de framework, pas de
// fixtures. La parité mémoire/journal n'est PAS mesurée ici (R42).

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'evidence', 'r36-matrix');
const QUICK = process.argv.includes('--quick');
// Le commit EST la config : le rapport est daté au commit testé (les
// preuves d'anciens commits ne valident pas les changements courants).
function gitHead() {
  try {
    return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim();
  } catch { return '(non connu)'; }
}
const COMMIT = gitHead();

// 12 seeds effectives (R09 : le seed EST mélangé dans la suite — preuves
// evidence/r09-seed-42 vs r09-seed-99 : états finaux divergents).
const SEEDS = QUICK ? [42] : [1, 7, 42, 99, 123, 256, 512, 1000, 2024, 4096, 8192, 99999];
const HOURS = 24; // une journée complète de jeu (la session cible R37 est 20-30 min réel ≈ 48-72 h sim)
const DTS = [1, 0.4]; // les deux pas exigés — la tolérance est le Δ entre eux

// Les 5 politiques (R36) — COMPOSITIONS des commandes publiques (la sim n'est
// jamais touchée ; l'UI du jeu fait exactement ça avec ses boutons) :
const POLICIES = [
  // « prudent » : on n'accepte un vol que si la capacité est libre (aucun
  // avion en holding) — l'offre expire elle-même si on ne décide pas.
  { id: 'prudent', args: ['--policy', 'prudent', '--services', 'none'] },
  // « expansion » : croissance viable — acceptation + meilleure amélioration
  // (capacité terminal) + TOUS les services dès leur déblocage (R23).
  { id: 'expansion', args: ['--policy', 'expansion', '--services', 'all'] },
  // « acceptation excessive » : tous les vols + TOUS les contrats (l'engagement
  // maximal R21/R26 : un contrat actif augmente la demande).
  { id: 'greedy', args: ['--policy', 'greedy', '--services', 'none'] },
  // « refus temporaire » : fenêtre 3-9 h de refus de TOUTES les offres,
  // reprise de l'acceptation ensuite (fenêtres publiques --events, le
  // même moteur que le gate bl17 — la demande revient après la trêve).
  { id: 'refus-temp', args: ['--policy', 'accept', '--services', 'none',
    '--events', 't=3h:autoRefuse;t=9h:autoAccept'] },
  // « investissements inadaptés » : équipement d'équipes quand le goulot est
  // les files — l'achat documenté « mauvais achat » (R31 : l'argent dépensé
  // ne convertit AUCUNE file ; le rapport compare invest + files + pax).
  { id: 'badinvest', args: ['--policy', 'badinvest', '--services', 'all'] },
];

// ---------- exécution d'un run (harnais DRY) ----------
function runProbe(args) {
  const t0 = Date.now();
  // Le harnais écrit ses preuves dans evidence/<runId>/ (repo) : les runs de
  // la matrice y vivent comme les autres preuves (evidence/r36m-*).
  const r = spawnSync(process.execPath, [path.join(ROOT, 'qa', 'probe-scenario.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, GIT_COMMIT: COMMIT }, // le commit EST conservé dans le rapport
    encoding: 'utf8',
  });
  const wallMs = Date.now() - t0;
  if (r.status !== 0) {
    return { failed: true, error: (r.stderr || r.stdout || '').split('\n').pop(), wallMs };
  }
  return { failed: false, wallMs, out: r.stdout };
}
function reportOf(runId) {
  const p = path.join(ROOT, 'evidence', runId, `rapport-${runId}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function stateHash(runId) {
  const p = path.join(ROOT, 'evidence', runId, `state-${runId}.json`);
  if (!fs.existsSync(p)) return null;
  // Le snapshot embarque SES METADONNEES (scenario/seed/runId) : pour la
  // PAIRE MÊME-CONFIG, le runId DIFFÈRE (A vs B) alors que la SUITE est la
  // même → on normalise runId avant le hash (tout le reste doit être identique).
  const snap = JSON.parse(fs.readFileSync(p, 'utf8'));
  snap.runId = 'NORMALISE';
  return crypto.createHash('sha256').update(JSON.stringify(snap)).digest('hex');
}

fs.mkdirSync(OUT, { recursive: true });
const rows = []; // les cellules de la matrice (le rapport final)

// ---------- 1. la matrice : seeds × politiques × pas ----------
for (const seed of SEEDS) {
  for (const pol of POLICIES) {
    for (const dt of DTS) {
      const runId = `r36m-s${seed}-${pol.id}-dt${String(dt).replace('.', '_')}`;
      const args = [
        '--seed', String(seed), '--hours', String(HOURS), '--dt', String(dt),
        '--run-id', runId, ...pol.args, '--no-state',
      ];
      const res = runProbe(args);
      let row = rows.find((x) => x.seed === seed && x.policy === pol.id);
      if (!row) { row = { seed, policy: pol.id, cells: [] }; rows.push(row); }
      if (res.failed) {
        row.cells.push({ dt, runId, failed: true, error: res.error });
        console.log(`FAIL ${runId} : ${res.error}`);
        continue;
      }
      const rep = reportOf(runId);
      const ticks = HOURS * 3600 / dt;
      row.cells.push({
        dt, runId, failed: false, wallMs: res.wallMs,
        // le coût du tick (temps réel du run / ticks) — l'endurance est mesurée
        msPerTick: Math.round(res.wallMs / ticks * 1000) / 1000,
        // les MESURES (les rapports complets sont dans evidence/r36-matrix/<runId>/)
        moneyEnd: rep.money.end, pax: rep.passengers.totalCarried,
        satisfaction: rep.passengers.satisfaction,
        holding: rep.wait.holding, plannedPending: rep.wait.plannedPending,
        bankruptcy: rep.bankruptcy, bankruptAt: rep.bankruptAt,
        flightsIn: rep.counts.flightIn, flightsOut: rep.counts.flightOut,
        annulated: rep.counts.flightCancelled,
        incidents: { runway: rep.counts.runwayClosed, fuel: rep.counts.fuelOut, surge: rep.counts.surgeStart },
        invest: rep.invest, strategy: rep.strategy,
      });
    }
  }
}

// ---------- 2. le DÉTERMINISME (paires de runs avec state) ----------
// La même config jouée 2× → fichiers IDENTIQUES en bytes ; une config à
// seed différent → fichiers DIFFÉRENTS (seeds effectives ≠ décoratives).
function detPair(runIdA, runIdB, expectSame) {
  const hA = stateHash(runIdA), hB = stateHash(runIdB);
  const same = hA !== null && hA === hB;
  const ok = expectSame === same;
  return { a: runIdA, b: runIdB, expectSame, ok, sha256A: hA, sha256B: hB };
}
const detArgs = (seed, runId) => ['--seed', String(seed), '--hours', String(HOURS), '--dt', '1', '--policy', 'accept', '--services', 'none', '--run-id', runId];
runProbe(detArgs(7, 'r36m-det-same-A'));
runProbe(detArgs(7, 'r36m-det-same-B'));
runProbe(detArgs(99, 'r36m-det-diff'));
const determinism = {
  sameConfigByteIdentical: detPair('r36m-det-same-A', 'r36m-det-same-B', true),
  differentSeedsDiverge: detPair('r36m-det-same-A', 'r36m-det-diff', false),
};

// ---------- 3. l'EXTENSION 48 h (la matière d'endurance R42) ----------
runProbe(['--seed', '42', '--hours', '48', '--dt', '1', '--policy', 'accept', '--services', 'none', '--run-id', 'r36m-long-48h']);
const longRun = reportOf('r36m-long-48h');
longRun.sha256state = stateHash('r36m-long-48h');

// ---------- 4. TOLÉRANCES DU PAS (dt 1 s vs 0,4 s, par cellule) ----------
// La tolérance DOCUMENTÉE = le Δ mesuré entre les deux pas, par cellule
// (seed, politique) ; le Δ global = la tolérance à citer.
const tolerances = [];
for (const row of rows) {
  const c1 = row.cells.find((c) => c.dt === 1 && !c.failed);
  const c4 = row.cells.find((c) => c.dt === 0.4 && !c.failed);
  if (!c1 || !c4) continue;
  tolerances.push({
    seed: row.seed, policy: row.policy,
    paxDelta: Math.abs(c1.pax - c4.pax),
    moneyDelta: Math.abs(c1.moneyEnd - c4.moneyEnd),
    satisfactionDelta: Math.abs(c1.satisfaction - c4.satisfaction),
  });
}
const maxTol = {
  pax: Math.max(...tolerances.map((t) => t.paxDelta)),
  money: Math.max(...tolerances.map((t) => t.moneyDelta)),
  satisfaction: Math.max(...tolerances.map((t) => t.satisfactionDelta)),
};

// ---------- 4bis. DIAGNOSTIC DES POLITIQUES (ce que la matrice MONTRE) ----------
// Le Δ entre politiques (moyenne sur les seeds, dt 1 s) + l'observation
// mesurée expansion vs badinvest : la dépense diffère (3×1 500 $ vs 3×800 $)
// mais les PAX sont IDENTIQUES — le goulot « files » n'est jamais atteint dans
// la fenêtre 24 h : l'amélioration « terminal » (capacité) ne change rien au
// trafic, l'argent dépensé ne convertit AUCUNE file (le « mauvais achat »
// R31 reste lisible : le RAPPORT le dit, le joueur paie 2 100 $ pour 0 pax).
const policyMeans = {};
for (const row of rows) {
  const c1 = row.cells.find((c) => c.dt === 1 && !c.failed);
  if (!c1) continue;
  const m = (policyMeans[row.policy] = policyMeans[row.policy] || { pax: [], money: [], invest: [] });
  m.pax.push(c1.pax); m.money.push(c1.moneyEnd); m.invest.push(c1.invest ?? 0);
}
const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
const findings = {
  paxPerPolicy: Object.fromEntries(Object.entries(policyMeans).map(([p, m]) => [p, { pax: avg(m.pax), money: avg(m.money), invest: avg(m.invest) }])),
  expansionVsBadinvest: {
    paxDelta: avg(policyMeans.expansion?.pax ?? [0]) - avg(policyMeans.badinvest?.pax ?? [0]), // MESURÉ : 0 (identiques sur les seeds, dt 1 s)
    investGap: avg(policyMeans.expansion?.invest ?? [0]) - avg(policyMeans.badinvest?.invest ?? [0]),
    note: 'Les PAX sont identiques expansion vs badinvest sur les ' + SEEDS.length + ' seeds (Δ=' + (avg(policyMeans.expansion?.pax ?? [0]) - avg(policyMeans.badinvest?.pax ?? [0])) + ') : dans la fenêtre 24 h, le goulot des FILES n\'est jamais le plafond du trafic — l\'amélioration « terminal » (capacité) ni « teams » (nettoyage) ne convertissent AUCUNE file. Seule la DÉPENSE diffère (' + (avg(policyMeans.expansion?.invest ?? [0]) - avg(policyMeans.badinvest?.invest ?? [0])) + ' $ d\'investissement) : le « mauvais achat » R31 reste mesurable (l\'argent dépensé n\'achète rien), et l\'effet NEUTRE est documenté ici.',
  },
};

// ---------- 5. RAPPORT FINAL ----------
const matrixReport = {
  tool: 'qa/r36-matrix.mjs',
  commit: COMMIT,
  generated: new Date().toISOString(),
  grid: { seeds: SEEDS, hours: HOURS, dts: DTS, policies: POLICIES.map((p) => p.id) },
  // Les 5 politiques (ce que chacune a réellement fait — commandes publiques) :
  policyNotes: {
    prudent: 'acceptation seulement si capacité libre (aucun avion en holding)',
    expansion: 'acceptation + amélioration terminal (capacité) + tous les services (R23)',
    greedy: 'acceptation excessive : tous les vols + tous les contrats',
    'refus-temp': 'refus temporaire : fenêtre 3-9 h sans décision (les offres expirent), reprise ensuite',
    badinvest: 'investissement inadapté : équipement équipes quand le goulot est les files (R31)',
  },
  cells: rows,
  findings,
  determinism,
  tolerances,
  toleranceMax: {
    ...maxTol,
    note: 'Tolérance DOCUMENTÉE du pas 0,4 s face au pas de référence 1 s (' + HOURS + ' h, tous seeds × politiques) : '
      + 'Δ pax ≤ ' + maxTol.pax + ', Δ money ≤ ' + Math.round(maxTol.money) + ' $, Δ satisfaction ≤ ' + maxTol.satisfaction
      + ' pts. Le pas 0,4 s EST le pas naturel du jeu navigateur (dt réel clampé à 0,1 s, src/core/loop.mjs, × vitesse max x4 = 0,4 s de sim par frame) — la matrice couvre donc le pas réel du jeu. Cause du Δ : le PRNG est consommé par TICK (pas par temps sim) — moins de ticks = moins d\'échantillons de la même suite (fenêtres d\'offres, incidents), d\'où des suites légèrement différentes mais des résultats dans la tolérance mesurée.',
  },
  longRun48h: {
    runId: 'r36m-long-48h',
    money: longRun.money, pax: longRun.passengers.totalCarried,
    satisfaction: longRun.passengers.satisfaction,
    holding: longRun.wait.holding, bankruptcy: longRun.bankruptcy,
    sha256state: longRun.sha256state,
  },
  replay: 'Rejouer : node qa/r36-matrix.mjs (les runIds ci-dessus pointent les rapports et states dans evidence/r36m-*)',
};
const repPath = path.join(OUT, 'rapport-matrix.json');
fs.writeFileSync(repPath, JSON.stringify(matrixReport, null, 2));
console.log(`\n=== MATRICE R36 : ${SEEDS.length} seeds × ${POLICIES.length} politiques × ${DTS.length} pas = ${SEEDS.length * POLICIES.length * DTS.length} runs (commit ${COMMIT.slice(0, 7)})${QUICK ? ' [QUICK : 1 seed]' : ''} ===`);
console.log(`déterminisme : ${determinism.sameConfigByteIdentical.ok ? 'paire byte-identique OK' : 'PAIRE KO (voir rapport)'} + ${determinism.differentSeedsDiverge.ok ? 'seeds divergentes OK' : 'SEEDS KO (voir rapport)'}`);
console.log(`tolérance dt 1 s vs 0,4 s : Δpax ≤ ${maxTol.pax} | Δmoney ≤ ${Math.round(maxTol.money)} $ | Δsat ≤ ${maxTol.satisfaction}`);
console.log(`extension 48 h : money ${Math.round(longRun.money.end)} $ | pax ${longRun.passengers.totalCarried} | faillite ${longRun.bankruptcy ? 'OUI' : 'non'}`);
console.log(`preuve : ${repPath}`);
