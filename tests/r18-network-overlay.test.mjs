// R18 (t_814e1b40) — overlay réseau/capacités : rupture identifiable sur
// l'écran + diagnostic = MÊME graphe et MÊME règle que la sim. Vérifications
// (zéro DOM, déterministe — les tests s'appuient sur la LECTURE overlayState,
// pas sur le canvas) :
//   1. LECTURE : l'overlay lit le MÊME graphe de la sim (segments + occupation
//      ac.seg + incident fermeture piste) — pas une 2e règle.
//   2. COUPE : taxiway démolit → la porte devient ok=false (gateReachable,
//      la PRIMITIVE de la sim réutilisée telle quelle) ; la rupture est
//      identifiable, pas seulement dans les stats.
//   3. LECTURE SANS DOM : overlayState est une fonction pure de sim
//      (aucun document/canvas importé par le module — importable sous Node).
//   4. PREFERENCE : state.networkOverlay est absente d'une sim nouvelle
//      (overlay INACTIF par défaut) et survive à serialize/deserialize
//      (préférence d'affichage sérialisée, pas d'état dérivé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGameState } from '../src/core/new-game.mjs';
import { demolishBuilding, gateReachable } from '../src/infra/infra.mjs';
import { forceIncident } from '../src/sim/incidents.mjs'; // R32 : la fermeture piste est PAR PISTE
import { overlayState } from '../src/ui/overlay.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// Aéroport de dÉPART fourni (new-game.mjs) : piste + taxiway + terminal
// (2 portes M), réseau physiquement valide dès la 1re frame.
test('R18 : l’overlay lit le MÊME graphe de la sim (segments + occupation)', () => {
  const state = makeGameState(42);
  const sim = state.sim;
  const ov = overlayState(sim);
  // Le socle fourni : 1 piste + 1 taxiway = 2 segments du graphe.
  assert.equal(ov.segs.length, 2, '2 segments (piste + taxiway) lus dans le graphe');
  assert.ok(ov.segs.every((s) => !s.occupied), 'aucun avion → aucun segment occupé');
  assert.equal(ov.runways.length, 1, '1 piste lue');
  assert.equal(ov.runways[0].closed, false, 'pas d’incident fermeture');
  // Les 2 portes M du terminal de départ sont JOIGNABLES (réseau valide).
  assert.equal(ov.gates.length, 2, '2 portes du socle');
  assert.ok(ov.gates.every((g) => g.ok), 'les 2 portes du socle sont joignables');
  // MÊME règle que la sim : l’overlay est d’accord avec gateReachable.
  for (const g of sim.infra.gates) {
    assert.equal(ov.gates.find((x) => x.id === g.id).ok, gateReachable(sim, g),
      `porte ${g.id} : l’overlay (lecture) = la règle de la sim (gateReachable)`);
  }
  // Occupation : un avion sur le segment taxi → segment occupé (lecture ac.seg).
  const taxi = sim.infra.taxiways[0];
  const ac = { id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium',
    pax: 160, phase: 'taxi', x: 600, y: 1070, gateId: null, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: taxi.id, heading: 'gate' };
  sim.aircraft.push(ac);
  const ov2 = overlayState(sim);
  assert.ok(ov2.segs.find((s) => s.id === taxi.id).occupied, 'taxiway occupé (ac.seg)');
  // Piste fermée (incident) : lue par l’overlay (pas de 2e état d’incident).
  // R32 : la fermeture est PAR PISTE (attachée) — on force la fermeture de la
  // piste du socle, l'overlay lit l'état attaché via runwayClosed(sim, id).
  forceIncident(sim, 'runway');
  assert.equal(overlayState(sim).runways[0].closed, true, 'fermeture piste lue (incidents)');
});

test('R18 : taxiway coupé → rupture IDENTIFIABLE sur l’écran (gateReachable)', () => {
  const state = makeGameState(42);
  const sim = state.sim;
  // Démolition du SEUL taxiway du socle : le graphe est reconstruit (R03) et
  // les portes ne touchent plus aucun segment → HORS réseau.
  const r = demolishBuilding(sim, sim.infra.taxiways[0].id);
  assert.ok(r.ok, `le taxiway est démolit (${r.why || 'ok'})`);
  const ov = overlayState(sim);
  assert.equal(ov.segs.length, 1, 'un segment reste dans le graphe (la piste)');
  assert.ok(ov.gates.every((g) => !g.ok), 'les 2 portes sont COUPÉES (ok=false)');
  // La rupture est identifiable : l’overlay est d’accord avec la règle de la sim.
  for (const g of sim.infra.gates) {
    assert.equal(ov.gates.find((x) => x.id === g.id).ok, gateReachable(sim, g),
      `porte ${g.id} : l’overlay est d’accord avec gateReachable (coupé = false)`);
  }
  // Un avion ACTUELLEMENT bloqué sur la porte coupée : la rupture lisible
  // (phase 'blocked' — la même que doBlocked dans la sim).
  const g0 = sim.infra.gates[0];
  g0.acId = 999;
  sim.aircraft.push({ id: 999, airline: 'solaire', color: '#f0a', acType: 'small',
    pax: 9, phase: 'blocked', x: g0.x, y: g0.y, gateId: g0.id, runwayId: null,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate' });
  const ov2 = overlayState(sim);
  assert.ok(ov2.gates.find((x) => x.id === g0.id).blocked,
    'avion bloqué sur la porte coupée → flag blocked (rupture lisible)');
});

test('R18 : préférence d’affichage (state.networkOverlay) — inactive par défaut, sérialisée', () => {
  const state = makeGameState(42);
  // Absente d’une sim nouvelle : l’overlay est INACTIF par défaut (touche O).
  assert.equal(state.networkOverlay, undefined, 'absente d’un état neuf (overlay off)');
  // Préréférence d’affichage → sérialisée avec l’état (pas d’état dérivé).
  state.networkOverlay = true;
  const restored = deserialize(serialize(state));
  assert.equal(restored.networkOverlay, true, 'la préférence survit à la sauvegarde/reprise');
  // L’état de sim reste intact après lecture/écriture de la préférence.
  assert.ok(restored.sim && restored.sim.infra && restored.sim.infra.gates.length === 2,
    'la sim survit au cycle sauvegarde/reprise');
});
