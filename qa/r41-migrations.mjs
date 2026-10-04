// R41 (t_2194baa9) — PREUVE de migration inter-fonctionnalités :
// 1. La migration RACINE (re-attach de sim.incidents) : AVANT la correction,
//    une sauvegarde pré-R32 (champ ABSENT) se chargeait « sans crash » mais
//    l'état incident vivait sur des locaux jetés (invisible inter-appels).
//    APRES : l'état est re-attaché sur sim.incidents et SURVIT (force → tick →
//    lecture). On le prouve en reproduisant l'ancien comportement (simulation
//    du code AVANT : `i = i || {}` sans re-attach) et en le comparant au code
//    ACTUEL (re-attach). Le rapport est écrit dans evidence/r41-migrations/.
// 2. Les 4 MIGRATIONS (R30 passagers, R35 emprunt, R32 + BL-14 incidents) :
//    pour CHAQUE, la sauvegarde « champ absent » se charge, migre, et le 1er
//    tick passe ; le champ « présent mais corrompu » est REJETÉ proprement.
// Zéro DOM, déterministe.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGameState } from '../src/core/new-game.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { ensurePassengers } from '../src/sim/passengers.mjs';
import { ensureLoan, loanState } from '../src/economy/economy.mjs';
import { ensureIncidents, forceIncident, runwayClosed, tickIncidents } from '../src/sim/incidents.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'evidence', 'r41-migrations');
mkdirSync(OUT, { recursive: true });

function game() { const s = makeGameState(42); s.screen = 'game'; return s; }
function oldSave(mutate) {
  const raw = JSON.parse(serialize(game()));
  mutate(raw.state);
  return deserialize(JSON.stringify(raw));
}

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail }); if (!ok) throw new Error('CHECK ÉCHOUÉ : ' + name); }

// --- 1. La migration RACINE : re-attach de sim.incidents (code ACTUEL) ------
{
  const loaded = oldSave((s) => { delete s.sim.incidents; }); // pré-R32 : champ ABSENT
  ensureIncidents(loaded.sim);
  const sim = loaded.sim;
  check('1a pré-R32 : sim.incidents est re-attachée (objet)', !!sim.incidents,
    `sim.incidents = ${JSON.stringify(Object.keys(sim.incidents || {}))}`);
  forceIncident(sim, 'runway');
  const rw = sim.infra.runways[0];
  check('1b l\'incident forcé est VISIBLE à l\'appel suivant (pas perdu)', runwayClosed(sim, rw.id) === true,
    `runwayClosed(${rw.id}) = ${runwayClosed(sim, rw.id)}`);
  tickIncidents(sim, 0.1, makeSimRng(sim));
  check('1c l\'incident SURVIT au tick (état persiste sur la sim)', runwayClosed(sim, rw.id) === true,
    `apres 1 tick, runwayClosed(${rw.id}) = ${runwayClosed(sim, rw.id)}`);
}

// Le code AVANT (reproduit ICI pour la preuve : local jeté, sans re-attach).
// On montre que SANS le re-attach, l'état est PERDU (le bug d'origine).
function ensureIncidents_AVANT(sim) {
  let i = sim.incidents;
  i = i || {}; // LE BUG : local, pas re-attaché sur sim.incidents
  i.runway = i.runway || { closed: 0, acc: 0, last: 0 };
  i.fuel = i.fuel || { out: 0, acc: 0, last: 0 };
  i.surge = i.surge || { active: false, remaining: 0, acc: 0, last: 0 };
  i.runways = i.runways || {};
  i.fuels = i.fuels || {};
  return i;
}
{
  // État du jeu AVANT la correction, après chargement d'une sauvegarde
  // pré-R32 : le champ est ABSENT (le jeu de l'époque ne l'initialisait pas).
  const loaded = oldSave((s) => { delete s.sim.incidents; });
  delete loaded.sim.incidents; // le chargement ACTUEL migre déjà — on remets l'état pré-fixe
  ensureIncidents_AVANT(loaded.sim);
  check('1d (PREUVE) le code AVANT perd l\'état : sim.incidents reste undefined',
    loaded.sim.incidents === undefined,
    `apres ensure AVANT, sim.incidents = ${loaded.sim.incidents} (l'état est perdu — le bug d'origine)`);
}

// --- 2. Les 4 MIGRATIONS : champ absent migre + 1er tick OK -----------------
{
  const loaded = oldSave((s) => { delete s.sim.passengers; }); // pré-R30
  ensurePassengers(loaded.sim);
  const p = loaded.sim.passengers;
  check('2a pré-R30 : passagers migrent (satisfaction 100, totalCarried 0)',
    p.satisfaction === 100 && p.totalCarried === 0 && !!p.queues && !!p.injectedTotal,
    `satisfaction=${p.satisfaction} totalCarried=${p.totalCarried} queues=${JSON.stringify(Object.keys(p.queues))}`);
  tick(loaded, 0.1, makeSimRng(loaded.sim));
  check('2b pré-R30 : le 1er tick passe sur la sim migrée', true, 'tick(loaded) sans exception');
}
{
  const loaded = oldSave((s) => { delete s.sim.economy.loan; }); // pré-R35
  ensureLoan(loaded.sim);
  check('2c pré-R35 : l\'emprunt migre à 0 + borne intacte',
    loaded.sim.economy.loan.principal === 0 && loanState(loaded.sim).available === true,
    `principal=${loaded.sim.economy.loan.principal} dispo=${loanState(loaded.sim).available}`);
  tick(loaded, 0.1, makeSimRng(loaded.sim));
  check('2d pré-R35 : le 1er tick passe sur la sim migrée', true, 'tick(loaded) sans exception');
}
{
  const loaded = oldSave((s) => { delete s.sim.incidents; }); // pré-R32 / pré-BL-14
  ensureIncidents(loaded.sim);
  const i = loaded.sim.incidents;
  check('2e pré-R32/BL-14 : l\'état incident COMPLET est reconstruit',
    !!i.runway && !!i.fuel && !!i.surge && !!i.runways && !!i.fuels,
    `runway/fuel/surge/runways/fuels = ${[!!i.runway,!!i.fuel,!!i.surge,!!i.runways,!!i.fuels].join(',')}`);
  tick(loaded, 0.1, makeSimRng(loaded.sim));
  check('2f pré-R32/BL-14 : le 1er tick passe sur la sim migrée', true, 'tick(loaded) sans exception');
}

// --- 3. REJET : champ présent mais illisible → erreur lisible ---------------
function rejectDetail(mutate) {
  try { oldSave(mutate); return 'NON REJETÉE (bug)'; }
  catch (e) { return `rejetée : ${e.message}`; }
}
{
  const d1 = rejectDetail((s) => { s.sim.incidents = 'corrompu'; });
  check('3a sim.incidents corrompue → rejet lisible', d1.startsWith('rejetée'), d1);
  const d2 = rejectDetail((s) => { s.sim.passengers = 'corrompu'; });
  check('3b sim.passengers corrompue → rejet lisible', d2.startsWith('rejetée'), d2);
  const d3 = rejectDetail((s) => { s.sim.economy.loan = 'corrompu'; });
  check('3c economy.loan corrompue → rejet lisible', d3.startsWith('rejetée'), d3);
}

// --- RAPPORT ------------------------------------------------------------------
const report = {
  task: 'R41 (t_2194baa9)',
  date: new Date().toISOString(),
  head: '8cc370d (R40)',
  suite: 'node --test tests/*.test.mjs',
  checks,
};
const n = checks.filter((c) => c.ok).length;
report.summary = `${n}/${checks.length} checks (tous OK)`;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(report.summary);
for (const c of checks) console.log(`  ${c.ok ? 'OK' : 'FAIL'} ${c.name}`);
