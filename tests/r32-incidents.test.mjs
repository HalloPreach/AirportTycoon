// Tests R32 (t_9f267552) : les incidents sont ATTACHÉS à un ACTIF (pas 3
// interrupteurs globaux). Un incident porte {id, type, asset, remaining,
// severity, cause} — une fermeture vise UNE piste, une panne UNE station.
// VALIDATION (exigée) :
//   1. fermer UNE piste sur deux laisse l'autre UTILISABLE ;
//   2. panne d'UNE station laisse les autres ACTIVES ;
//   3. supprimer l'actif TRAITE son incident (pas de référence orpheline) ;
//   4. l'ÉTAT (records) et le CALENDRIER (fréquence bornée) survivent à la
//      reprise (sérialisation).
// Zéro DOM, déterministe — même socle géométrique que les tests incidents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import {
  ensureIncidents, forceIncident, runwayClosed, fuelOutStation, fuelOut,
} from '../src/sim/incidents.mjs';

// Socle bien conçu (piste + taxiway + terminal) + services débloqués + UNE
// station carburant (la 2e sera ajoutée par addSecondFuel).
function buildSocle(sim) {
  sim.economy.money = 1000000;
  sim._unlocked = { fuel: true, cleaning: true, hangar: true, baggage: true, catering: true };
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 100, 200); // la 1re station carburant
  rebuildGraph(sim);
}
// Une DEUXIÈME piste (non chevauchante) : la fermeture est testable sur 2.
function addSecondRunway(sim) {
  const rw = buildBuilding(sim, 'runway', 950, 100);
  rebuildGraph(sim);
  assert.ok(rw, 'la 2e piste est posée');
  return rw;
}
// Une DEUXIÈME station carburant (non chevauchante) : la panne est testable sur 2.
function addSecondFuel(sim) {
  const s = buildBuilding(sim, 'fuel', 100, 400);
  rebuildGraph(sim);
  assert.ok(s, 'la 2e station carburant est posée');
  return s;
}

test('R32 (1) : fermer UNE piste sur deux laisse l\'AUTRE utilisable (isolement) + record lisible', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [rwA] = sim.infra.runways;
  const rwB = addSecondRunway(sim);
  const i = ensureIncidents(sim);

  // Forçage EXPLICITE sur la piste A (attaché à son id, pas global).
  forceIncident(sim, `runway:${rwA.id}`);
  // Record lisible : {id, type, asset, durée, gravité, cause}.
  const rec = i.runways[String(rwA.id)];
  assert.ok(rec, 'un record d\'incident est CRÉÉ pour la piste A');
  assert.equal(rec.type, 'runway', 'type = runway');
  assert.equal(rec.asset, rwA.id, 'asset = l\'id de la piste A');
  assert.ok(rec.id, 'l\'incident a un identifiant');
  assert.ok(rec.remaining > 0, 'la durée (compte à rebours) est positive');
  assert.ok(rec.severity, 'la gravité est lisible');
  assert.ok(rec.cause, 'la cause est lisible');

  // ISOLEMENT : A fermée, B restée OUVERTe (utilisale).
  assert.ok(runwayClosed(sim, rwA.id), 'la piste A est FERMÉE');
  assert.ok(!runwayClosed(sim, rwB.id), 'la piste B est OUVERTe (la fermeture ne la touche pas)');
});

test('R32 (2) : panne d\'UNE station laisse les AUTRES actives (isolement) + record lisible', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [stA] = sim.infra.services.filter((s) => s.type === 'fuel');
  const stB = addSecondFuel(sim);
  const i = ensureIncidents(sim);

  forceIncident(sim, `fuel:${stA.id}`);
  const rec = i.fuels[String(stA.id)];
  assert.ok(rec, 'un record d\'incident est CRÉÉ pour la station A');
  assert.equal(rec.type, 'fuel', 'type = fuel');
  assert.equal(rec.asset, stA.id, 'asset = l\'id de la station A');
  assert.ok(rec.id && rec.remaining > 0 && rec.severity && rec.cause, 'record complet (id/durée/gravité/cause)');

  // ISOLEMENT : A en panne, B reste ACTIVE (le plein chez B continue).
  assert.ok(fuelOutStation(sim, stA.id), 'la station A est EN PANNE');
  assert.ok(!fuelOutStation(sim, stB.id), 'la station B reste ACTIVE (la panne ne la touche pas)');
  assert.ok(fuelOut(sim), 'globalement une station est HS (lue par le planificateur)');
});

test('R32 (3) : SUPPRIMER l\'actif TRAITE son incident (pas de référence orpheline)', () => {
  const sim = newSimState();
  buildSocle(sim);
  const i = ensureIncidents(sim);

  // Piste : ferme A, démolis A → le record disparaît (l'actif n'existe plus).
  const [rwA] = sim.infra.runways;
  forceIncident(sim, `runway:${rwA.id}`);
  assert.ok(i.runways[String(rwA.id)], 'le record piste A existe avant la démo');
  demolishBuilding(sim, rwA.id);
  ensureIncidents(sim); // purge des orphelins (appelée par demolishBuilding)
  assert.ok(!i.runways[String(rwA.id)], 'le record de la piste démolie est PURGÉ (pas d\'orphelin)');

  // Station : même garantie du côté carburant.
  const [stA] = sim.infra.services.filter((s) => s.type === 'fuel');
  forceIncident(sim, `fuel:${stA.id}`);
  assert.ok(i.fuels[String(stA.id)], 'le record station A existe avant la démo');
  demolishBuilding(sim, stA.id);
  ensureIncidents(sim);
  assert.ok(!i.fuels[String(stA.id)], 'le record de la station démolie est PURGÉ (pas d\'orphelin)');

  // Garde-fou : AUCUN record ne pointe vers un actif disparu.
  const runways = new Set(sim.infra.runways.map((r) => String(r.id)));
  const fuels = new Set(sim.infra.services.filter((s) => s.type === 'fuel').map((s) => String(s.id)));
  for (const k of Object.keys(i.runways)) assert.ok(runways.has(k), `pas d'orphelin piste (${k})`);
  for (const k of Object.keys(i.fuels)) assert.ok(fuels.has(k), `pas d'orphelin station (${k})`);
});

test('R32 (4) : l\'ÉTAT (records) et le CALENDRIER (fréquence) survivent à la reprise', () => {
  const sim = newSimState();
  buildSocle(sim);
  const [rwA] = sim.infra.runways;
  const [stA] = sim.infra.services.filter((s) => s.type === 'fuel');
  forceIncident(sim, `runway:${rwA.id}`);
  forceIncident(sim, `fuel:${stA.id}`);
  const i = ensureIncidents(sim);
  // Calendrier borné (horloge de fréquence par type : acc/last).
  i.runway.acc = 12.5; i.runway.last = 42;
  i.fuel.acc = 7.25; i.fuel.last = 99;
  const recBefore = { remaining: i.runways[String(rwA.id)].remaining };

  const restored = deserialize(serialize({ screen: 'play', time: 0, terrain: 1, camera: null, sim }));
  const ri = restored.sim.incidents;
  // Records survivent (l'état attaché à l'actif).
  assert.ok(ri.runways[String(rwA.id)], 'le record piste A survit à la reprise');
  assert.equal(ri.runways[String(rwA.id)].remaining, recBefore.remaining, 'la durée restante est préservée');
  assert.ok(ri.fuels[String(stA.id)], 'le record station A survit à la reprise');
  // Calendrier (fréquence) survit.
  assert.equal(ri.runway.acc, 12.5, 'le compteur de fréquence piste est préservé');
  assert.equal(ri.runway.last, 42, 'le dernier incident piste est préservé');
  assert.equal(ri.fuel.acc, 7.25, 'le compteur de fréquence station est préservé');
  // Pas d'orphelin à la reprise (l'actif existe toujours ici).
  assert.ok(runwayClosed(restored.sim, rwA.id), 'la fermeture A est active à la reprise (lue par la sim)');
});
