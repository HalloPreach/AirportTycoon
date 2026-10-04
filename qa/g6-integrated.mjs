// G6 (J6 Équilibrage) — validation intégrée du JALON SORTIE : la MATRICE
// de scénarios reproductibles (R36) + les STRATÉGIES VIABLES + RYTHME
// observé (R37) + les 3 DÉFIS REJOUABLES (R38) fonctionnent ENSEMBLE.
//
// La carte G6 est une VALIDATION (R36/R37/R38 déjà implémentées) : on EXERCe
// le scénario intégré de sortie du jalon — on REJoue la matrice + les
// stratégies + les scénarios sur le code du COMMIT COURANT (jamais les
// rapports d'anciens commits, invariante §1) et on VÉRIFIE que les 3 pièces
// fonctionnent ENSEMBLE (cross-checks), pas seulement que chaque harnais
// passe seul. Un check navigateur impossible = « non vérifié », jamais PASS
// (ici : pas de navigateur — les 3 sous-harnais sont Node ; la QA navigateur
// des flux complets vit dans R40, un autre jalon).
//
// Design DRY : G6 est un ORCHESTRATEUR — il relance les 3 sous-harnais
// existants (r36-matrix / r37-validate / r38-scenarios) et ASSERT leurs
// rapports + CROSS-CHECK la cohérence entre eux. Pas de fixture inventée,
// pas de 2e mécanique : la rejoue EST la preuve.
//
// Critères (mesurables) de la carte → checks :
//   (a) MATRICE REPRODUCTIBLE (R36) : 12 seeds × 5 politiques × 2 pas =
//       120 runs rejoués sur le commit courant + DETERMINISME (paire
//       byte-identique + seeds divergentes) + TOLERANCE DOCUMENTEE du pas
//       0,4 s + EXTENSION 48 h (aucune faillite).
//   (b) 4 CRITERES R37 (equilibre des strategies) atteints SUR 12 SEEDS
//       (mediane + mauvais cas, pas seulement la plus favorable) :
//         c1 prudent viable mais limite / c2 expansion ciblee progresse
//         davantage / c3 greedy degrade la qualite ou les obligations /
//         c4 le mauvais achat (R31) coute sans faux benefice.
//   (c) LES 3 SCENARIOS R38 REJOUABLES : determinisme (snapshots
//       byte-identiques), invariants, bornes financieres + l'objectifs
//       coherents (le pic est absorbe en saturation ; le redressement
//       remonte dans le vert ; le guide reste rejouable).
//   (d) COHERENCE R37 ↔ R36 : la tolerance du pas 0,4 s du layer strategique
//       R37 RESTE DANS la tolerance documentee du layer matrice R36 — les 2
//       couches sont coherentes (elles partagent le meme PRNG sur tick).
//
// Usage :
//   node qa/g6-integrated.mjs          (full : R36 12 seeds + R37 12 seeds,
//                                        la porte J6 canonique)
//   node qa/g6-integrated.mjs --quick  (R36 1 seed + R37 12 seeds : smoke test
//                                        du wiring, PAS la mediane 12 seeds —
//                                        la validation canonique du jalon
//                                        exige le run full)
//   (exit 0 = PASS, rapport dans evidence/g6-integrated/)
// ponytail : l'orchestration relance les 3 sous-harnais existants (1 spawn
// chacun) + une couche d'assertion sur leurs rapports ; la rejoue EST la
// preuve — pas de fixture inventee, pas de 2e mecanique. Le mode --quick est
// un raccourci dev (1 seed R36) ; la porte J6 canonique est le run full
// (12 seeds R36 + 12 seeds R37).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCENARIOS } from '../src/scenarios.mjs';

const ROOT = process.cwd();
const FULL = !process.argv.includes('--quick');
const SEEDS_FULL = 12;
// Objectifs declarés par chaque scenario R38 (ids stables, src/scenarios.mjs) —
// le harnais CROSS-CHECK que le rapport porte BIENTOT l'objectif attendu.
// `SCENARIOS[mode].objective` est une CHAINE (l'id R22), pas un objet.
const R38 = {
  guide:        { runId: 'r38-guide',        objectiveId: SCENARIOS.guide.objective },
  saturation:   { runId: 'r38-saturation',   objectiveId: SCENARIOS.saturation.objective },
  redressement: { runId: 'r38-redressement', objectiveId: SCENARIOS.redressement.objective },
};
const R38_REPORT = {
  guide:        'evidence/r38-guide/rapport-r38-guide.json',
  saturation:   'evidence/r38-saturation/rapport-r38-saturation.json',
  redressement: 'evidence/r38-redressement/rapport-r38-redressement.json',
};

let failures = 0;
const checks = []; // journal COMPLET des checks (preuve, rapport final)
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};
// Le sous-harnais est lance EN ENFANT (son propre process = ses rapports ne
// polluent pas la boucle G6 ; exit code + rapports = la preuve).
function runSub(script, args = []) {
  console.log(`  [sub] node qa/${script} ${args.join(' ')}`);
  const r = spawnSync('node', [`qa/${script}`, ...args], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout ?? '').trim().split('\n').slice(-6).join('\n');
  return { ok: r.status === 0, out };
}
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// ============================================================================
// (a) MATRICE REPRODUCTIBLE (R36) — rejouee sur le commit courant
// ============================================================================
console.log(`\n=== G6 — (a) MATRICE REPRODUCTIBLE (R36)${FULL ? '' : ' [QUICK: 1 seed, wiring]'} ===`);
const r36 = runSub('r36-matrix.mjs', FULL ? [] : ['--quick']);
check('(a) le harnais R36 REJOUe la matrice sans echec', r36.ok, r36.out.split('\n').slice(-3).join(' | '));
if (r36.ok) {
  const m = readJson('evidence/r36-matrix/rapport-matrix.json');
  const nSeeds = m.grid?.seeds?.length ?? 0;
  check('(a) la grille porte 12 seeds (la mediane R37 exige la grille COMPLETE)',
    nSeeds === SEEDS_FULL, `${nSeeds} seeds${FULL ? '' : ' (QUICK: 1 seed — wiring, PAS la mediane canonique)'}`);
  check('(a) le DETERMINISME est revalide (paire byte-identique + seeds divergentes)',
    m.determinism?.sameConfigByteIdentical?.ok === true && m.determinism?.differentSeedsDiverge?.ok === true,
    `paire=${m.determinism?.sameConfigByteIdentical?.ok} divergentes=${m.determinism?.differentSeedsDiverge?.ok}`);
  check('(a) la TOLERANCE du pas 0,4 s est revalidee',
    (m.toleranceMax?.satisfaction ?? 0) <= 0,
    `Δpax=${m.toleranceMax?.pax} Δmoney=${Math.round(m.toleranceMax?.money ?? 0)} $ Δsat=${m.toleranceMax?.satisfaction}`);
  // L'extension 48 h se juge sur l'ABSENCE de faillite + la CROISSANCE
  // (money.fin > money.debut) — le minimum intermediaire (min) est
  // informatif, PAS une borne : le run plonge brievement sous le capital de
  // depart puis remonte (min=11574 $ < 12000 $) sans jamais faire faillite.
  check('(a) l\'EXTENSION 48 h est rejouable sans faillite (croissance)',
    m.longRun48h?.bankruptcy === false && (m.longRun48h?.money?.end ?? 0) > (m.longRun48h?.money?.start ?? 0),
    `money ${m.longRun48h?.money?.start} → ${Math.round(m.longRun48h?.money?.end ?? 0)} $ (min ${Math.round(m.longRun48h?.money?.min ?? 0)}, faillite=${m.longRun48h?.bankruptcy}) pax ${m.longRun48h?.pax}`);
}

// ============================================================================
// (b) 4 CRITERES R37 (equilibre des strategies) sur 12 seeds
// ============================================================================
console.log('\n=== G6 — (b) 4 CRITERES R37 (equilibre des strategies) sur 12 seeds ===');
const r37 = runSub('r37-validate.mjs');
check('(b) le harnais R37 REJOUe la validation des 4 criteres sans echec', r37.ok, r37.out.split('\n').slice(-3).join(' | '));
if (r37.ok) {
  const v = readJson('evidence/r37-validate/rapport-validation.json');
  const crit = v.criteria ?? {};
  const seedsFull = (v.grid?.seeds?.length ?? 0) === SEEDS_FULL;
  for (const c of ['c1', 'c2', 'c3', 'c4']) {
    check(`(b) ${c} — ${crit[c]?.name ?? c} (mediane + mauvais cas)`,
      crit[c]?.medianPass === true && crit[c]?.worstCaseOk === true,
      `passOn=${crit[c]?.passOnSeeds}/${crit[c]?.failOnSeeds === 0 ? SEEDS_FULL : '?'} ${seedsFull ? '(12 seeds)' : '(grille partielle — voir mode)'}`);
  }
  check('(b) la TOLERANCE du pas 0,4 s du layer strategique est revalidee',
    v.tolerancePas?.withinTol === true,
    `Δq=${v.tolerancePas?.maxDQ} Δpax=${v.tolerancePas?.maxDPax} Δmoney=${v.tolerancePas?.maxDMoney} $`);
  // (d) COHERENCE R37 ↔ R36 : la tolerance strategique RESTE DANS la
  // tolerance documentee du layer matrice (les 2 couches partagent le meme
  // PRNG sur tick — un ecart indiquerait une divergence de mecanique).
  const mTol = r36.ok ? readJson('evidence/r36-matrix/rapport-matrix.json').toleranceMax : null;
  check('(d) COHERENCE R37 ↔ R36 : tolerance strategique DANS la tolerance matrice',
    mTol && (v.tolerancePas?.maxDPax ?? Infinity) <= (mTol.pax ?? Infinity)
      && (v.tolerancePas?.maxDMoney ?? Infinity) <= (mTol.money ?? Infinity)
      && (v.tolerancePas?.maxDQ ?? Infinity) <= (mTol.satisfaction ?? Infinity),
    `R37 Δpax=${v.tolerancePas?.maxDPax} ≤ R36 ${mTol?.pax} ; R37 Δmoney=${v.tolerancePas?.maxDMoney} $ ≤ R36 ${Math.round(mTol?.money ?? 0)} $`);
}

// ============================================================================
// (c) LES 3 SCENARIOS R38 REJOUABLES
// ============================================================================
console.log('\n=== G6 — (c) LES 3 SCENARIOS R38 REJOUABLES (guide / saturation / redressement) ===');
const r38 = runSub('r38-scenarios.mjs');
check('(c) le harnais R38 REJOUe les 3 scenarios sans echec', r38.ok, r38.out.split('\n').slice(-3).join(' | '));
if (r38.ok) {
  for (const [mode, meta] of Object.entries(R38)) {
    const rep = readJson(R38_REPORT[mode]);
    check(`(c) ${mode} : REJOUABLE (snapshots byte-identiques)`,
      rep.determinism?.snapshotsByteIdentical === true,
      `sha256 ${String(rep.determinism?.sha256RunA ?? '').slice(0, 12)}…`);
    check(`(c) ${mode} : les INVARIANTS tiennent sur la rejoue`,
      String(rep.invariants ?? '').startsWith('OK'));
    check(`(c) ${mode} : l\'objectif porte BIENTOT l\'id attendu (${meta.objectiveId})`,
      rep.objective?.announced?.id === meta.objectiveId,
      `announced=${rep.objective?.announced?.id}`);
  }
  const sat = readJson(R38_REPORT.saturation);
  check('(c) saturation : le PIC est absorbe (objectif decide PAR LA SIM)',
    sat.objective?.successReadFromSim?.done === true,
    sat.objective?.successReadFromSim?.label ?? '');
  check('(c) saturation : borne financiere + pas de faillite',
    sat.money?.bankrupt === false && Number.isFinite(sat.money?.end),
    `money ${sat.money?.start} → ${Math.round(sat.money?.end ?? 0)} $`);
  const red = readJson(R38_REPORT.redressement);
  check('(c) redressement : deficit de depart → emprunt → remonte dans le vert',
    red.redressement?.deficitAtStart < 0
      && red.redressement?.loan?.taken === true
      && red.redressement?.backInGreen === true
      && red.redressement?.bankruptAtStart === false,
    `deficit=${red.redressement?.deficitAtStart} $ emprunt ${red.redressement?.loan?.principal} $ → remonte=${red.redressement?.backInGreen}`);
  check('(c) redressement : borne financiere',
    red.money?.start === SCENARIOS.redressement.funds && red.money?.bankrupt === false && Number.isFinite(red.money?.end),
    `money ${red.money?.start} → ${Math.round(red.money?.end ?? 0)} $`);
  const guide = readJson(R38_REPORT.guide);
  check('(c) guide : rejouable + pax finis (le harnais ne force PAS l\'objectif)',
    guide.passengers?.totalCarried != null && Number.isFinite(guide.money?.end),
    `pax=${guide.passengers?.totalCarried} done=${guide.objective?.successReadFromSim?.done}`);
}

// ============================================================================
// rapport + export (la preuve demandee par la carte)
// ============================================================================
const outDir = path.join(ROOT, 'evidence', 'g6-integrated');
fs.mkdirSync(outDir, { recursive: true });
const report = {
  tool: 'qa/g6-integrated.mjs',
  mode: FULL ? 'full' : 'quick',
  fullGate: FULL, // la porte J6 canonique = full (12 seeds R36 + 12 seeds R37)
  commit: process.env.GIT_COMMIT ?? '(non connu)',
  criteria: {
    a: 'MATRICE REPRODUCTIBLE (R36) : 12 seeds × 5 politiques × 2 pas rejouees + determinisme + tolerance pas 0,4 s + extension 48 h',
    b: '4 CRITERES R37 (equilibre des strategies) atteints SUR 12 seeds (mediane + mauvais cas)',
    c: 'LES 3 SCENARIOS R38 REJOUABLES (guide / saturation / redressement) : determinisme + invariants + bornes + objectifs coherents',
    d: 'COHERENCE R37 ↔ R36 : la tolerance du pas 0,4 s du layer strategique RESTE DANS la tolerance documentee du layer matrice',
  },
  evidence: {
    r36: 'evidence/r36-matrix/rapport-matrix.json',
    r37: 'evidence/r37-validate/rapport-validation.json',
    r38: Object.values(R38_REPORT),
  },
  failures,
  passed: checks.length - failures,
  checks,
};
fs.writeFileSync(path.join(outDir, 'rapport-g6-integrated.json'), JSON.stringify(report, null, 2));
console.log(`\nexport : evidence/g6-integrated/ (rapport-g6-integrated.json)`);
console.log(failures === 0
  ? 'G6 — TOUT EST BON (R36+R37+R38 fonctionnent ENSEMBLE : matrice reproductible + strategies equilibrees + 3 defis rejouables)'
  : `G6 — ${failures} ÉCHEC(S) → le jalon reste ouvert (une piece ne tient pas sur le commit courant)`);
process.exit(failures === 0 ? 0 : 1);
