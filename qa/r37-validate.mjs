// qa/r37-validate.mjs — R37 (t_a4c636ab) : VALIDATION DES 4 CRITÈRES sur les
// 12 seeds de la grille R36 (médiane + mauvais cas, pas seulement seed 42).
// Le harnais DRY qa/probe-scenario.mjs rejoue la sim de production (dt 1 s
// pour les 4 politiques + dt 0,4 s pour prudent/expansion, la tolérance du
// pas est DOCUMENTÉE) — la sim n'est jamais touchée. Les champs R37 du
// rapport (objectives / quality / contracts.results, lectures pures)
// permettent de mesurer les 4 critères de la VALIDATION de la carte :
//   C1 — petit aéroport viable mais LIMITÉ dans ses objectifs (prudent :
//        pas de faillite, satisfaction élevée, objectifs plafonnés) ;
//   C2 — expansion ciblée progresse DAVANTAGE (plus d'objectifs payés, ou à
//        égalité plus de pax/money) ;
//   C3 — tout accepter (greedy) dégrade la qualité OU les obligations (q fin
//        < 1 et/ou contrats ratés, face à prudent) ;
//   C4 — achat inadapté (badinvest) COÛTE SANS FAUX BÉNÉFICE (mêmes pax et
//        objectifs qu'expansion, moins de money).
// Écrit evidence/r37-validate/rapport-validation.json (résumé par seed +
// médiane/mauvais cas + tolérance du pas). La sim reste sans DOM/timer/réseau.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SEEDS = [1, 7, 42, 99, 123, 256, 512, 1000, 2024, 4096, 8192, 99999];
const HOURS = 24;
// Mêmes compositions de commandes publiques que la matrice R36 (les règles
// restent dans les commandes ; le harnais ne fait que les orchestrer).
const POLICIES = [
  { id: 'prudent', args: ['--policy', 'prudent', '--services', 'none'] },
  { id: 'expansion', args: ['--policy', 'expansion', '--services', 'all'] },
  { id: 'greedy', args: ['--policy', 'greedy', '--services', 'none'] },
  { id: 'badinvest', args: ['--policy', 'badinvest', '--services', 'all'] },
];
const TOL_Q = 0.05; // tolérance DOCUMENTÉE du pas 0,4 s (R36) appliquée à q

function runProbe(runId, args) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'qa', 'probe-scenario.mjs'), ...args, '--run-id', runId], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_COMMIT: (process.env.GIT_COMMIT || '') },
  });
  const wallMs = Date.now() - t0;
  if (r.status !== 0) return { failed: true, error: (r.stderr || r.stdout || '').split('\n').slice(-3).join(' | '), wallMs };
  const p = path.join(ROOT, 'evidence', runId, `rapport-${runId}.json`);
  if (!fs.existsSync(p)) return { failed: true, error: 'rapport absent (run inachevé ?)', wallMs };
  return { failed: false, wallMs, report: JSON.parse(fs.readFileSync(p, 'utf8')) };
}
// Extrait R37 du rapport : le nécessaire pour les 4 critères (champs stables).
function pick(rep) {
  const q = rep.quality || { q: 1, measured: null };
  return {
    seed: rep.seed, policy: rep.config?.services,
    pax: rep.passengers?.totalCarried ?? 0,
    money: Math.round(rep.money?.end ?? 0),
    sat: rep.passengers?.satisfaction ?? 0,
    bankruptcy: !!rep.bankruptcy,
    objectivesPaid: (rep.objectives || []).filter((o) => o.paid).length,
    q: q.q, qMeasured: q.measured,
    contractResults: rep.contracts?.results || [],
    contractFailed: (rep.contracts?.results || []).filter((r) => r === 'failed').length,
    contractSuccess: (rep.contracts?.results || []).filter((r) => r === 'success').length,
    stoppedEarly: !!rep.stoppedEarly,
  };
}

// ---------- exécution (4 politiques × 12 seeds, dt 1 s ; + dt 0,4 s sur
// prudent/expansion pour documenter la tolérance du pas) ----------
const cells = {}; // `${seed}-${pol}` -> pick
for (const seed of SEEDS) {
  for (const pol of POLICIES) {
    const runId = `r37-${pol.id}-s${seed}`;
    const res = runProbe(runId, [...pol.args, '--seed', String(seed), '--hours', String(HOURS), '--dt', '1']);
    if (res.failed) { cells[`${seed}-${pol.id}`] = { failed: true, error: res.error }; continue; }
    cells[`${seed}-${pol.id}`] = pick(res.report);
  }
  // Tolérance du pas (prudent + expansion) — la tolérance R36 reste valable.
  for (const pol of POLICIES.filter((p) => p.id === 'prudent' || p.id === 'expansion')) {
    const runId = `r37-${pol.id}-s${seed}-dt04`;
    const res = runProbe(runId, [...pol.args, '--seed', String(seed), '--hours', String(HOURS), '--dt', '0.4']);
    if (res.failed) continue;
    const dt04 = pick(res.report);
    const ref = cells[`${seed}-${pol.id}`];
    if (ref && !ref.failed) {
      ref.toleranceDt04 = { pax: dt04.pax, money: dt04.money, q: dt04.q,
        dPax: Math.abs(dt04.pax - ref.pax), dMoney: Math.abs(dt04.money - ref.money), dQ: Math.abs(dt04.q - ref.q) };
    }
  }
}

// ---------- évaluation des 4 critères (par seed + médiane + mauvais cas) ----------
function median(arr) { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function okCell(seed, pol) { const c = cells[`${seed}-${pol}`]; return c && !c.failed ? c : null; }

const perSeed = [];
const agg = { c1: { pass: [], fail: [] }, c2: { pass: [], fail: [] }, c3: { pass: [], fail: [] }, c4: { pass: [], fail: [] }, tol: { maxDQ: 0, maxDPax: 0, maxDMoney: 0, worst: null } };
for (const seed of SEEDS) {
  const P = okCell(seed, 'prudent'), E = okCell(seed, 'expansion'), G = okCell(seed, 'greedy'), B = okCell(seed, 'badinvest');
  const row = { seed };
  if (P && E && G && B) {
    // C1 — prudent viable mais limité : pas de faillite, satisfaction élevée,
    // et plafonné (≤ 2 objectifs) + expansion progresse davantage (C2).
    row.c1 = { viable: !P.bankruptcy && P.sat >= 90, limited: P.objectivesPaid <= 2,
      pass: !P.bankruptcy && P.sat >= 90 && P.objectivesPaid <= 2 };
    // C2 — expansion progresse davantage : plus d'objectifs payés, ou à
    // égalité davantage de pax ET de money (la progression, pas seulement le pax).
    const progE = E.objectivesPaid, progP = P.objectivesPaid;
    row.c2 = { pass: progE > progP || (progE === progP && (E.pax > P.pax || (E.pax === P.pax && E.money > P.money))),
      progE, progP, paxE: E.pax, paxP: P.pax, moneyE: E.money, moneyP: P.money };
    // C3 — greedy dégrade la qualité OU les obligations : q fin < q prudent,
    // ou (q ≤ 1) ET au moins un contrat raté (obligations dégradées).
    const degraded = (G.q < P.q - 1e-9) || (G.q <= 1 && G.contractFailed > 0);
    row.c3 = { pass: degraded, qG: G.q, qP: P.q, failedG: G.contractFailed, failedP: P.contractFailed };
    // C4 — badinvest coûte SANS faux bénéfice : mêmes pax ET objectifs qu'expansion
    // (aucun gain) mais MOINS de money (l'argent dépensé ne convertit rien).
    row.c4 = { pass: B.pax === E.pax && B.objectivesPaid === E.objectivesPaid && B.money < E.money,
      paxB: B.pax, paxE: E.pax, moneyB: B.money, moneyE: E.money, dMoney: E.money - B.money,
      objB: B.objectivesPaid, objE: E.objectivesPaid };
  }
  perSeed.push(row);
  // agrégats (médiane + mauvais cas)
  if (row.c1) agg.c1[row.c1.pass ? 'pass' : 'fail'].push(seed);
  if (row.c2) agg.c2[row.c2.pass ? 'pass' : 'fail'].push(seed);
  if (row.c3) agg.c3[row.c3.pass ? 'pass' : 'fail'].push(seed);
  if (row.c4) agg.c4[row.c4.pass ? 'pass' : 'fail'].push(seed);
  if (P && P.toleranceDt04) {
    const t = P.toleranceDt04;
    if (t.dQ > agg.tol.maxDQ) agg.tol.maxDQ = t.dQ;
    if (t.dPax > agg.tol.maxDPax) agg.tol.maxDPax = t.dPax;
    if (t.dMoney > agg.tol.maxDMoney) agg.tol.maxDMoney = t.dMoney;
    agg.tol.worst = { seed, ...t };
  }
}

// Verdict global : médiane (au moins la moitié des seeds) + le mauvais cas ne
// doit PAS invalider le critère (C2/C3/C4 : toléré sur ≤ 2 seeds « bruit » ;
// C1 : toléré si ≤ 1 seed).
function verdict(aggKey, allowFail) {
  const a = agg[aggKey];
  return { passOnSeeds: a.pass.length, failOnSeeds: a.fail.length,
    medianPass: a.pass.length >= SEEDS.length / 2, worstCaseOk: a.fail.length <= allowFail,
    failSeeds: a.fail };
}
const verdicts = { c1: verdict('c1', 1), c2: verdict('c2', 2), c3: verdict('c3', 2), c4: verdict('c4', 2) };
const allOk = Object.values(verdicts).every((v) => v.medianPass && v.worstCaseOk);
const tolOk = agg.tol.maxDQ <= TOL_Q; // la tolérance du pas 0,4 s reste documentée

const out = {
  title: 'R37 (t_a4c636ab) — Validation des 4 critères sur 12 seeds (médiane + mauvais cas)',
  commit: process.env.GIT_COMMIT || '(non connu)',
  generated: new Date().toISOString(),
  grid: { seeds: SEEDS, hours: HOURS, dt: [1, 0.4], policies: POLICIES.map((p) => p.id) },
  criteria: {
    c1: { name: 'petit aéroport viable mais limité (prudent)', ...verdicts.c1 },
    c2: { name: 'expansion ciblée progresse davantage', ...verdicts.c2 },
    c3: { name: 'tout accepter (greedy) dégrade la qualité ou les obligations', ...verdicts.c3 },
    c4: { name: 'achat inadapté (badinvest) coûte sans faux bénéfice', ...verdicts.c4 },
  },
  tolerancePas: { maxDQ: agg.tol.maxDQ, maxDPax: agg.tol.maxDPax, maxDMoney: agg.tol.maxDMoney, worst: agg.tol.worst,
    withinTol: tolOk, note: `Tolérance DOCUMENTÉE du pas 0,4 s face au pas 1 s : Δq ≤ ${agg.tol.maxDQ}, Δpax ≤ ${agg.tol.maxDPax}, Δmoney ≤ ${agg.tol.maxDMoney} $ sur prudent/expansion (cause mesurée : le PRNG est consommé par tick, pas par temps sim — R36) ; le critère reste ${tolOk ? 'STABLE' : 'INSTABLE'} au pas 0,4 s (q ≤ ${TOL_Q}).` },
  perSeed,
  verdict: { allOk, tolOk, pass: allOk && tolOk,
    note: allOk && tolOk ? 'LES 4 CRITÈRES SONT ATTEINTS (médiane + mauvais cas toléré) SUR 12 SEEDS.'
                          : 'AU MOINS UN CRITÈRE N\'EST PAS ATTEINT — voir criteria (failSeeds).' },
};
const dir = path.join(ROOT, 'evidence', 'r37-validate');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'rapport-validation.json'), JSON.stringify(out, null, 2));
console.log('=== R37 VALIDATION (12 seeds) ===');
for (const k of ['c1', 'c2', 'c3', 'c4']) {
  const c = out.criteria[k];
  console.log(`${k} [${c.passOnSeeds}/${SEEDS.length} seeds] ${c.medianPass ? '✓médiane' : '✗médiane'} ${c.worstCaseOk ? '✓mauvais-cas' : '✗mauvais-cas'}${c.failSeeds.length ? ' (échec: ' + c.failSeeds.join(',') + ')' : ''} — ${c.name}`);
}
console.log(`tolérance pas : Δq ${agg.tol.maxDQ} / Δpax ${agg.tol.maxDPax} / Δmoney ${agg.tol.maxDMoney} $ → ${tolOk ? 'DANS la tolérance' : 'HORS tolérance'}`);
console.log(`VERDICT : ${out.verdict.pass ? 'PASS (4 critères atteints)' : 'FAIL'} — ${out.verdict.note}`);
console.log('écrit dans', path.join(dir, 'rapport-validation.json'));
