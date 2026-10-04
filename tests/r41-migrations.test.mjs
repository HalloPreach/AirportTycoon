// R41 (t_2194baa9) — VÉRIFIER les MIGRATIONS entre fonctionnalités : une
// sauvegarde de l'ancienne version (champ ABSENT) doit se charger, migrer
// (ensure* au chargement) et survivre au 1er tick ; un champ PRÉSENT mais de
// MAUVAIS type est REJETÉ proprement (erreur lisible, pas un crash du 1er
// tick ni un état écrasé en silence).
//
// 4 MIGRATIONS couvertes :
//   R30 passagers  — ensurePassengers (src/sim/passengers.mjs : file PAR
//                    TERMINAL, compteurs injectedTotal/securityDone)
//   R35 emprunt    — ensureLoan      (src/economy/economy.mjs : loan borné)
//   R32 incidents  — ensureIncidents (src/sim/incidents.mjs : incidents
//                    attachés à un ACTIF + horloges de fréquence)
//   BL-14 incidents — sim.incidents ENTIÈREMENT absente (pré-BL-14 : la sim
//                    n'avait pas encore d'horloge d'incident) → le plus vieux
//                    cas : l'objet complet est reconstruit au chargement.
//
// RACINE TRAVILLÉE (R41) : ensureIncidents construisait l'état manquant sur
// un LOCAL jeté (pas re-attaché sur sim.incidents) → une sauvegarde
// pré-R32 se chargeait « sans crash » mais tout le sous-système incidents
// tournait sur des locaux éphémères : invisible d'un appel à l'autre, rien
// ne persistait, les incidents ne « marchaient » pas en silence. Le re-attach
// (pattern ensurePassengers/ensureUpgrades) est la correction, vérifiée ici
// par la VISIBILITÉ inter-appels (force → tick → lecture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGameState } from '../src/core/new-game.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { ensurePassengers } from '../src/sim/passengers.mjs';
import { ensureLoan, loanState } from '../src/economy/economy.mjs';
import { ensureIncidents, forceIncident, runwayClosed, tickIncidents } from '../src/sim/incidents.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';

// Un état moderne, sérialisé puis ALTÉRÉ en JSON BRUT (comme une sauvegarde
// d'une version plus vieille du jeu), puis dé-sérialisé. `game()` reconstruit
// un état neuf à chaque fois (pas d'aliasing).
function game() {
  const state = makeGameState(42);
  state.screen = 'game';
  return state;
}
function oldSave(mutate) {
  const raw = JSON.parse(serialize(game()));
  mutate(raw.state);
  return deserialize(JSON.stringify(raw));
}
function expectReject(mutate) {
  assert.throws(
    () => oldSave(mutate),
    (e) => e instanceof Error && /Sauvegarde invalide/.test(e.message),
    'rejet lisible (jamais de crash du 1er tick)',
  );
}

// Un 1er tick complet sur la sim migrée : la migration ne doit PAS laisser la
// sim planter (le crash du 1er tick est le symptôme qu'on protège ici).
function firstTick(loaded) {
  tick(loaded, 0.1, makeSimRng(loaded.sim));
}

// --- R30 — PASSAGERS : les sauvegardes pré-R30 n'ont PAS de `passengers` ----
test('R41 (R30) : la sauvegarde pré-R30 (passagers absents) migre + 1er tick', () => {
  const loaded = oldSave((s) => { delete s.sim.passengers; });
  ensurePassengers(loaded.sim); // la migration (ensure* au chargement)
  const p = loaded.sim.passengers;
  assert.ok(p, 'le champ absent est TOLÉRÉ (la migration le crée)');
  assert.equal(p.satisfaction, 100, 'satisfaction migre à 100 (défaut)');
  assert.equal(p.totalCarried, 0, 'totalCarried migre à 0 (jamais de ré-écriture des totaux)');
  assert.ok(p.queues && typeof p.queues === 'object', 'files PAR TERMINAL migrent (objet vide)');
  assert.ok(p.injectedTotal && p.securityDone, 'compteurs de flux par terminal migrent');
  firstTick(loaded); // pas de crash du 1er tick sur la sim migrée
});

// --- R35 — EMPRUNT : les sauvegardes pré-R35 n'ont PAS de `economy.loan` ----
test('R41 (R35) : la sauvegarde pré-R35 (emprunt absent) migre + borne intacte', () => {
  const loaded = oldSave((s) => { delete s.sim.economy.loan; });
  ensureLoan(loaded.sim);
  assert.ok(loaded.sim.economy.loan, 'le champ absent est TOLÉRÉ (la migration le crée)');
  assert.equal(loaded.sim.economy.loan.principal, 0, 'le principal migre à 0 (jamais de ré-débit au chargement)');
  assert.equal(loanState(loaded.sim).available, true, 'l\'emprunt est encore dispo après migration (borne intacte)');
  firstTick(loaded);
});

// --- R32 — INCIDENTS : les sauvegardes pré-R32 n'ont PAS de `sim.incidents` --
test('R41 (R32) : la sauvegarde pré-R32 (incidents absents) migre + état VISIBLE inter-appels', () => {
  const loaded = oldSave((s) => { delete s.sim.incidents; });
  ensureIncidents(loaded.sim); // la migration (ensure* au chargement)
  const sim = loaded.sim;
  // RACINE R41 : l'état migre SUR sim.incidents (pas sur un local jeté) —
  // un incident FORCÉ est VISIBLE d'un appel à l'autre (pas perdu).
  assert.ok(sim.incidents && typeof sim.incidents === 'object', 'sim.incidents est re-attachée (R41)');
  forceIncident(sim, 'runway'); // ferme LA piste (R32 : attachée à un ACTIF)
  const rw = sim.infra.runways[0];
  assert.equal(runwayClosed(sim, rw.id), true, 'l\'incident forcé est VISIBLE à l\'appel SUIVANT (pas perdu)');
  tickIncidents(sim, 0.1, makeSimRng(sim)); // 1 tick incidents : pas de crash
  assert.equal(runwayClosed(sim, rw.id), true, 'l\'incident SURVIT au tick (état persiste sur la sim)');
});

// --- BL-14 — l'horloge d'incident ENTIEREMENT absente (le cas le plus vieux)
// La sim pré-BL-14 n'avait PAS de `sim.incidents` du tout : l'objet complet
// (runway/fuel/surge + les sous-objets attachés R32) est reconstruit.
test('R41 (BL-14) : la sauvegarde pré-BL-14 (horloge d\'incident absente) reconstruit l\'état complet', () => {
  const loaded = oldSave((s) => { delete s.sim.incidents; });
  ensureIncidents(loaded.sim);
  const i = loaded.sim.incidents;
  assert.ok(i.runway && i.fuel && i.surge, 'les 3 horloges GLOBALES (runway/fuel/surge) sont reconstruites');
  assert.ok(i.runways && i.fuels, 'les sous-objets attachés (R32) sont reconstruits (vides)');
  firstTick(loaded); // le 1er tick complet avance sans crash
});

// --- REJET — un champ PRÉSENT mais de MAUVAIS type est refusé proprement ----
// (la politique D4 : absent = toléré/migré ; présent mais corrompu = rejet lisible,
// jamais un crash du 1er tick ni un état écrasé en silence.)
test('R41 (rejet) : sim.incidents présent mais illisible → rejet lisible', () => {
  expectReject((s) => { s.sim.incidents = 'corrompu'; });
});
test('R41 (rejet) : sim.passengers présent mais illisible → rejet lisible', () => {
  expectReject((s) => { s.sim.passengers = 'corrompu'; });
});
test('R41 (rejet) : economy.loan présent mais illisible → rejet lisible', () => {
  expectReject((s) => { s.sim.economy.loan = 'corrompu'; });
});
