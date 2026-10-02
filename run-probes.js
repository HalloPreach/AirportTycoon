// BL-00 : exécute les sondes de l'audit sur le commit courant et persiste,
// pour chaque preuve A* de l'audit, un JSON horodaté dans evidence/audit-<commit>/.
// ponytail: probes.mjs sort déjà un JSON { results: [...] } — on le découpe, on n'écrit pas un 2e harnais.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'C:/Users/Lucas/Documents/AirportTycoon';
const audit = 'C:/Users/Lucas/Documents/Codex/2026-09-14/je-veux-changer-mon-mod-le/audit-airport';

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
const outDir = join(root, 'evidence', `audit-${sha.slice(0, 7)}`);
mkdirSync(outDir, { recursive: true });
const stamp = j => ({ commitGit: sha, runAt: new Date().toISOString(), ...j });

// 1. probes.mjs : une seule sortie JSON, A1..A13 dans results[].
//    Si une sonde interne lève (A7), la boucle de la sonde la capture (probeError) ;
//    le processus peut alors sortir 1 : la sortie JSON reste valide.
let stdout;
try {
  stdout = execFileSync('node', [join(audit, 'probes.mjs'), root], { cwd: audit, encoding: 'utf8' });
} catch (e) {
  stdout = e.stdout ?? '';
}
const main = JSON.parse(stdout.slice(stdout.indexOf('{')));
for (const r of main.results) {
  const n = r.name.match(/^A(\d+)/)?.[1];
  if (!n) throw new Error(`sonde sans numéro A* : ${r.name}`);
  writeFileSync(join(outDir, `A${n}.json`), JSON.stringify(stamp(r), null, 2) + '\n', 'utf8');
  console.log(`ok A${n}.json (confirmed=${r.confirmed ?? false}, probeError=${r.probeError ?? '-'})`);
}

// 2. probe-test-multivols.mjs : A14.
let out14;
try {
  out14 = execFileSync('node', [join(audit, 'probe-test-multivols.mjs')], { cwd: audit, encoding: 'utf8' });
} catch (e) {
  out14 = e.stdout ?? '';
}
const a14 = JSON.parse(out14.slice(out14.indexOf('{')));
writeFileSync(join(outDir, 'A14.json'), JSON.stringify(stamp(a14), null, 2) + '\n', 'utf8');
console.log(`ok A14.json (confirmed=${a14.confirmed})`);

// 3. Relevé global : combien de risques sur 8 sont confirmés par ces preuves.
//    R1=A1/A2, R2=A3/A4/A5, R3=A6/A7, R4=A8/A13, R5=A9, R6=A10/A11, R7=A12, R8=A14.
const byId = Object.fromEntries(main.results.map(r => [r.name.match(/^A(\d+)/)[1], r]));
const risks = {
  R1: [1, 2], R2: [3, 4, 5], R3: [6, 7], R4: [8, 13],
  R5: [9], R6: [10, 11], R7: [12], R8: [14],
};
const summary = {
  name: 'résumé BL-00 — reproduction des risques R1..R8',
  commitGit: sha, runAt: new Date().toISOString(),
  risks: Object.fromEntries(Object.entries(risks).map(([k, ids]) => {
    const files = ids.map(i => {
      const r = byId[i] ?? (k === 'R8' ? a14 : null);
      return { A: i, confirmed: r?.confirmed === true, probeError: r?.probeError ?? null };
    });
    return [k, { confirmed: files.every(f => f.confirmed), evidences: files }];
  })),
};
writeFileSync(join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
const unconfirmed = Object.entries(summary.risks).filter(([, v]) => !v.confirmed).map(([k]) => k);
console.log(`SUMMARY : ${Object.keys(risks).length - unconfirmed.length}/8 risques confirmés${unconfirmed.length ? ' ; non confirmés : ' + unconfirmed : ''}`);
