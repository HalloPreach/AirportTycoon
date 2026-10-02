// BL-03 (AC5/AC15, R2 : A3/A4/A5 + décision A-5) : invariants de réservation
// exclusives. Le brief (AC5) : « test identifiants distincts, invariants après
// chaque tick ». Ces tests reprennent les scénarios des sondes A3/A4/A5 de
// l'audit (mêmes setups) et vérifient les invariants, plus l'annulation des
// blocages persistants (décision A-5 : comptés + annulés à 10 min sim, cause
// visible). node:test, zéro DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding } from '../src/infra/infra.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from '../src/economy/economy.mjs';
import { tickPlanner } from '../src/flights/flights.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../src/pathfinding/path.mjs';
import { START_FUNDS } from '../src/core/sim-state.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// Même helper que les sondes de l'audit (probes.mjs) : un avion de test.
function ac(id, overrides = {}) {
  return { id, airline: 'solaire', acType: 'small', pax: 5, phase: 'approach',
    x: 200, y: -150, gateId: null, runwayId: null, delayed: 0, timer: 0,
    path: null, pathPtr: 0, seg: null, heading: 'gate', ...overrides };
}

// Aéroport minimal JOUABLE (géométrie CONNECTÉE, comme buildAirport de
// sim.test.mjs) : le taxiway (550,1050) TOUCHE la piste (x=750) ET le terminal
// (y=1050) → findPath relie piste et porte (règle BL-02 : liaison physique).
function airport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim); sim._graphDirty = false;
  return sim;
}

// A3 (AC15) : deux avions entrent dans un même segment libre au même tick.
// Setup identique à la sonde A3 : graphe factice, deux avions en taxi l'un
// vers l'autre sur le même segment intermédiaire (30).
test('A3 : deux avions ne partagent jamais un même segment au même tick', () => {
  const sim = newSimState();
  sim._graphDirty = false;
  sim._graph = { nodes: [{ x: 0, y: 0, seg: 10 }, { x: 30, y: 0, seg: 30 },
    { x: 60, y: 0, seg: 20 }], edges: new Map(), gateNode: new Map() };
  sim.aircraft = [ac(1, { phase: 'taxi', x: 0, y: 0, seg: 10, path: [0, 1] }),
    ac(2, { phase: 'taxi', x: 60, y: 0, seg: 20, path: [2, 1] })];
  // Invariant APRÈS CHAQUE TICK (EV-9) : jamais deux avions sur le même segment.
  tickAircraft(sim, 0.1);
  const segs = sim.aircraft.map((a) => a.seg).filter((s) => s != null);
  assert.equal(new Set(segs).size, segs.length, "jamais deux avions sur le même segment");
  // L'avion 1 a réservé le segment 30 (il y est) ; l'avion 2 est bloqué dessus
  // (attente, pas d'entrée) : c'est ça la correction A3.
  const a1 = sim.aircraft[0], a2 = sim.aircraft[1];
  assert.equal(a1.seg, 30, "l'avion 1 a réservé le segment 30");
  assert.equal(a2.seg, 20, "l'avion 2 est resté sur son segment (il n'entre PAS dans le 30)");
  assert.ok(a2.delayed > 0, "l'avion 2 est en attente (retard, pas de collision)");
});

// A4 (AC15) : atterrissage/décollage exclusifs sur une même piste.
// Setup identique à la sonde A4 : un avion en departure + un en approche sur la
// même piste.
test('A4 : landing et departure ne partagent pas la même piste', () => {
  const sim = airport();
  const rw = sim.infra.runways[0];
  sim.aircraft = [ac(1, { phase: 'departure', runwayId: rw.id, x: 800, y: 800 }),
    ac(2, { x: 800, y: 100 })];
  // Invariant APRÈS CHAQUE TICK (EV-9) : jamais deux avions landing/exit/departure
  // sur la même piste.
  for (let i = 0; i < 30; i++) {
    tickAircraft(sim, 0.1);
    const onRw = sim.aircraft.filter((a) => a.runwayId === rw.id
      && ['landing', 'exit', 'departure'].includes(a.phase));
    assert.ok(onRw.length <= 1,
      "jamais deux avions en usage exclusif sur la même piste (A4)");
  }
  const a1 = sim.aircraft[0], a2 = sim.aircraft[1];
  assert.equal(a1.phase, 'departure', "l'avion 1 décolle en premier");
  assert.notEqual(a2.phase, 'landing',
    "l'avion 2 n'atterrit PAS pendant le décollage (A4 : il attend en holding)");
});

// A5 (AC15) : deux avions ne reçoivent jamais la même porte avant leur arrivée.
// Setup identique à la sonde A5 : 1 seule porte, deux avions en exit.
test('A5 : une porte est réservée à UN seul avion avant son arrivée', () => {
  const sim = airport();
  const rw = sim.infra.runways[0];
  sim.infra.gates = [sim.infra.gates[0]]; // 1 porte unique
  rebuildGraph(sim); sim._graphDirty = false;
  sim.aircraft = [ac(1, { phase: 'exit', runwayId: rw.id, x: 800, y: 1100 }),
    ac(2, { phase: 'exit', runwayId: rw.id, x: 800, y: 1100 })];
  // Un tick : l'un des deux obtient la porte, l'autre est bloqué (pas de double
  // réservation — la porte reste réservée g.acId → l'avion 2 ne la voit pas).
  tickAircraft(sim, 0.1);
  const withGate = sim.aircraft.filter((a) => a.gateId != null);
  assert.equal(withGate.length, 1, "un seul avion a une porte (A5)");
  const reserved = sim.infra.gates[0];
  assert.equal(reserved.acId, withGate[0].id, "la porte est réservée à cet avion");
  // L'autre est bloqué (pas de seconde porte de disponible).
  const other = sim.aircraft.find((a) => a.gateId == null);
  assert.equal(other.phase, 'blocked', "le 2e avion est bloqué (attente équitable)");
});

// A-5 (décision) : blocage persistant → compté + annulé à 10 min sim, cause
// visible (événement « flight-cancelled »). Pas de croissance infinie des vols
// bloqués.
test('A-5 : un blocage persistant est annulé après 10 min sim (cause visible)', () => {
  const sim = airport();
  const rw = sim.infra.runways[0];
  // Avion en exit sans chemin possible : le taxiway vers sa porte n'existe pas.
  sim.infra.taxiways = []; // couper le taxiway → porte hors réseau
  rebuildGraph(sim); sim._graphDirty = false;
  sim.aircraft = [ac(1, { phase: 'exit', runwayId: rw.id, x: 800, y: 1100 })];
  tickAircraft(sim, 0.1); // → blocked
  assert.equal(sim.aircraft[0].phase, 'blocked', "l'avion est bloqué (pas de chemin)");
  // On avance la sim jusqu'à 10 min (600 s) de blocage : l'avion doit être annulé.
  for (let i = 0; i < 7000; i++) tickAircraft(sim, 0.1);
  const a = sim.aircraft[0];
  assert.equal(a.phase, 'cancelled', "blocage persistant → annulation (A-5)");
  // La cause est visible : un événement flight-cancelled a été émis.
  const cancelled = sim.alerts.find((e) => e.kind === 'flight-cancelled' && e.volId === 1);
  assert.ok(cancelled, "cause visible (alerte flight-cancelled)");
  assert.ok(String(cancelled.why || '').includes('blocage'), 'la cause nomme le blocage');
  // Pas de croissance infinie : l'avion n'est plus « bloqué » (il est purgé).
  assert.equal(sim.aircraft.filter((x) => x.phase === 'blocked').length, 0);
});

// AC15 global : sur un aéroport bien conçu, l'invariant « deux avions ne
// prennent pas la même ressource au même tick » tient sur tout un cycle
// multi-vols (invariants après chaque tick, EV-9).
test('AC15 : invariants de réservation tenus sur un cycle multi-vols', () => {
  const sim = airport();
  // 3 vols forçés (même technique que sim.test.mjs « plusieurs vols simultanés »).
  for (let n = 1; n <= 3; n++) sim.aircraft.push(ac(n, { x: 200 + n * 100, y: -150 }));
  // Les ids 1..3 sont déjà pris : le planificateur (spawnArrivals) doit partir de 4,
  // sinon ses vols recollisent ces ids et l'invariant « porte = 1 avion » (groupé
  // par g.acId) compte deux avions DISTINCTS comme un seul (faux positif, pas une
  // double réservation réelle — voir dbg.mjs, tick 690 avant la correction).
  sim.nextAcId = 4;
  const departed = new Set();
  let lastCarried = 0;            // EV-9 : comptage passagers (monotone, jamais décroissant)
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  for (let i = 0; i < 20000; i++) {
    tickAircraft(sim, 0.1);
    // On compte les départs AVANT le planificateur : sa purge retire les vols
    // « departed » de sim.aircraft, donc l'inspection doit se faire ici.
    for (const a of sim.aircraft) if (a.phase === 'departed') departed.add(a.id);
    tickEconomy(sim, 0.1);
    tickPassengers(sim, 0.1);
    tickPlanner(sim, 0.1, () => 0.5);
    // Invariants APRÈS CHAQUE TICK (EV-9) :
    // (1) jamais deux avions sur la même porte avant l'arrivée (g.acId unique).
    const gateOwners = {};
    for (const g of sim.infra.gates) if (g.acId != null) gateOwners[g.acId] = (gateOwners[g.acId] ?? 0) + 1;
    for (const c of Object.values(gateOwners)) assert.equal(c, 1, 'une porte = un seul avion');
    // (2) comptes passagers : le comptage total transporté ne décroît JAMAIS
    //     (un passager compté ne disparaît pas d'un tick à l'autre).
    assert.ok(sim.passengers.totalCarried >= lastCarried,
      `comptage passagers décroît (${lastCarried} → ${sim.passengers.totalCarried})`);
    lastCarried = sim.passengers.totalCarried;
    // (3) trésorerie (EV-9) : money = budget initial + recettes − dépenses − dette.
    //     Chaque mutation de money (charge/earn/opex/dette/construction/remboursement)
    //     a son pendant exact en revenue/spent/debt ; l'identité tient à chaque tick.
    //     Tolérance 1e-6 : l'horloge est une somme de dt flottants (dérive ~1e-14).
    const money = sim.economy.money;
    const expected = START_FUNDS + sum(sim.economy.revenue) - sum(sim.economy.spent) - sim.economy.debt;
    assert.ok(Math.abs(money - expected) < 1e-6,
      `trésorerie incohérente (tick ${i}) : money=${money} attendu=${expected}`);
    // (4) position : un avion en vol a des coordonnées FINIES (jamais NaN/Infinity).
    for (const a of sim.aircraft) if (a.phase !== 'departed') {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y),
        `position non finie (${a.phase}) avion ${a.id}`);
    }
    if (departed.size >= 3) break;
  }
  assert.ok(departed.size >= 1, 'au moins un vol complet sans double réservation');
  assert.ok(departed.size >= 3, 'les 3 vols forçés sont tous partis');
});

// R3 (A6) : démolition d'un terminal multi-portes dont UNE porte est occupée.
// Setup identique à la sonde A6 (probes.mjs) : porte 2 réservée (acId=1),
// avion au sol dessus → la démolition doit être REFUSÉE (porte occupée).
test('R3-A6 : terminal à porte occupée ne se démolit pas', () => {
  const sim = airport();
  const gate = sim.infra.gates[1];
  gate.acId = 1;
  sim.aircraft = [ac(1, { phase: 'ground', gateId: gate.id })];
  const nbGates = sim.infra.gates.length;
  const result = demolishBuilding(sim, sim.infra.terminals[0].id);
  assert.equal(result.ok, false, 'refusé (porte occupée)');
  assert.ok(String(result.why).includes('porte occupée'), 'motif lisible');
  assert.equal(sim.infra.terminals.length, 1, 'le terminal est intact');
  assert.equal(sim.infra.gates.length, nbGates, 'les portes du terminal sont intactes');
  assert.equal(sim.aircraft[0].gateId, gate.id, "l'avion garde sa porte (pas de référence périmée)");
});

// R3 (A7) : démolir un taxiway occupé invalide le chemin SANS exception.
// Setup identique à la sonde A7 (probes.mjs) : avion en taxi sur le chemin,
// démolition du taxiway, puis tick → l'avion passe en « blocked » et retente
// (plus d'exception « Cannot read properties of undefined (reading 'seg') »).
test('R3-A7 : démolir un taxiway occupé ne lève pas d\'exception', () => {
  const sim = airport();
  const rw = sim.infra.runways[0];
  const tw = sim.infra.taxiways[0];
  const g = sim.infra.gates[0];
  const path = findPath(sim, gateNodeOf(sim, g.id), runwayExitNode(sim, rw.id), new Set());
  assert.ok(path && path.length >= 2, 'chemin avant démolition');
  // Dans la géométrie connective, path = [nœud taxiway, nœud de sortie de
  // piste] (arête directe inter-segments) : l'avion roule AU DÉPART du
  // taxiway (path[0], seg = l'ID du taxiway) — c'est LE segment qui va être
  // détruit (l'équivalent de la sonde A7, où path[1] était le nœud taxiway).
  const node = sim._graph.nodes[path[0]];
  sim.aircraft = [ac(1, { phase: 'taxi', gateId: g.id, runwayId: rw.id,
    path, pathPtr: 0, x: node.x, y: node.y, seg: node.seg, heading: 'gate' })];
  assert.equal(node.seg, tw.id, "l'avion est bien SUR le taxiway à détruire");
  const result = demolishBuilding(sim, tw.id);
  assert.equal(result.ok, true, 'la démolition passe (le taxiway n\'est pas protégé)');
  assert.equal(sim.aircraft[0].path, null, "le chemin de l'avion est remis à zéro");
  let error = null;
  try { tickAircraft(sim, 0.1); } catch (e) { error = e.message; }
  assert.equal(error, null, "pas d'exception au tick suivant la démolition");
  assert.equal(sim.aircraft[0].phase, 'blocked', "l'avion est bloqué (chemin invalide → attente, réessai)");
});

// R3 (A8) — BL-04 : le même scénario APRÈS une sauvegarde/rechargement.
// deserialize() remet `sim._graph = null` (cache dérivé, reconstruit au 1er
// tick) — la garde A7 lisait `sim._graph.nodes` et crashait alors :
// « Cannot read properties of null (reading 'nodes') ». La démolition d'un
// taxiway occupé après rechargement doit rester SANS exception : les chemins
// périmés (indices dans l'ANCIEN graphe, jamais persistés) sont remis à zéro,
// l'avion passe en « blocked » et retente après le rebuild au 1er tick.
test('R3-A8 : démolir un taxiway occupé après rechargement ne lève pas d\'exception', () => {
  const sim = airport();
  const rw = sim.infra.runways[0];
  const tw = sim.infra.taxiways[0];
  const g = sim.infra.gates[0];
  const path = findPath(sim, gateNodeOf(sim, g.id), runwayExitNode(sim, rw.id), new Set());
  const node = sim._graph.nodes[path[0]];
  sim.aircraft = [ac(1, { phase: 'taxi', gateId: g.id, runwayId: rw.id,
    path, pathPtr: 0, x: node.x, y: node.y, seg: node.seg, heading: 'gate' })];
  // Cycle save/load : le graphe (cache dérivé) est remis à null, dirty = true.
  const back = deserialize(serialize({ screen: 'game', time: 1, terrain: { w: 1600, h: 1200 },
    camera: { x: 0, y: 0, zoom: 1 }, sim }));
  assert.equal(back.sim._graph, null, "après rechargement, le graphe est null (rebuild différé)");
  assert.deepEqual(back.sim.aircraft[0].path, path, "le chemin (indices) est persisté tel quel");
  // (GREEN) la démolition doit passer SANS exception — avant la correction :
  // « Cannot read properties of null (reading 'nodes') ».
  let error = null;
  let result = null;
  try { result = demolishBuilding(back.sim, tw.id); } catch (e) { error = e.message; }
  assert.equal(error, null, "pas d'exception à la démolition après rechargement");
  assert.equal(result.ok, true, 'la démolition passe');
  assert.equal(back.sim.aircraft[0].path, null, "le chemin périmé est remis à zéro");
  assert.equal(back.sim.aircraft[0].seg, null, "le segment occupé est remis à zéro");
  // Au tick suivant (rebuild du graphe) : pas de crash, avion en attente.
  error = null;
  try { tickAircraft(back.sim, 0.1); } catch (e) { error = e.message; }
  assert.equal(error, null, "pas d'exception au tick suivant la démolition");
  assert.equal(back.sim.aircraft[0].phase, 'blocked', "l'avion est bloqué (attente, réessai)");
});
