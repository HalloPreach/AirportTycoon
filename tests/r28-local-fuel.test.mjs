// Tests R28 (t_bd681587) : le CARBURANT est une ressource LOCALE —
//  - chaque station a ses LANCES (id EXPLICITE : ac._lanceId = id de la
//    station qui sert l'avion, pas un comptage anonyme « busy < lances ») ;
//  - la PANNE est locale : la panne de A laisse B servie — l'avion CHANGE à
//    la station voisine (B continue de servir, A est seule hors service) ;
//  - la DISTANCE porte→station est la priorité d'acquisition : la station la
//    PLUS PRÈCHE de la porte est servie en premier (règle du placement R27,
//    distance point→rectangle ; en égalité, l'id le plus petit) ;
//  - après une REPRIE : le propriétaire est vérifié (station démolie) →
//    nettoyage explicite (releaseLance), PAS de propriétaire fantôme ;
//  - le champ `fuelOut` (panne locale par station) est SÉRIALISABLE :
//    présent = panne conservée, absent = station saine (pas de fantôme).
// Mêmes socles/seuils que r08-lances.test.mjs (avions semés DIRECTEMENT en
// « refuel » pour isoler la lance sans pathfinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, demolishBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy } from '../src/economy/economy.mjs';
import { forceIncident, fuelOutStation } from '../src/sim/incidents.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// Socle « bien conçu » + DEUX stations carburant affectées au MÊME terminal
// (R28 : deux services locaux qui servent les MÊMES portes). La LOINTAINE est
// posée EN PREMIER (id le plus petit) et la PROCHE EN DEUXIÈME (id plus grand)
// — si c'est la PROCHE qui est servie, c'est la DISTANCE qui décide, PAS
// l'ordre des ids.
//  Terminal (550,900) 200×150 → x550..750, y900..1050 ; porte M1 (i=1) au
//  centre gx=640, gy=1045. Stations 120×80, posées à l'OUEST (aucune
//  collision avec la piste x750..850 ni le taxiway x550..750) :
//   - LOINTAINE (100,1050) : centre (160,1090), distance point→rectangle ≈ 463
//   - PROCHE (350,1050) : centre (410,1090), distance point→rectangle ≈ 223
function buildSocle2(sim) {
  rebuildGraph(sim);
  // R23 : la station carburant se débloque par UNE OFFRE DE VOL EN VUE.
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium',
    pax: 160, planned: 300, status: 'planned' });
  sim.economy.money = 100000;
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 100, 1050); // LOINTAINE : posée 1re (id le plus petit)
  buildBuilding(sim, 'fuel', 350, 1050); // PROCHE : posée 2e (id plus grand)
  rebuildGraph(sim);
  return {
    far: sim.infra.services.find((s) => s.type === 'fuel' && s.x === 100),
    near: sim.infra.services.find((s) => s.type === 'fuel' && s.x === 350),
  };
}
const M_GATES = (sim) => sim.infra.gates.filter((g) => g.size === 'M');

// Avion medium semé DIRECTEMENT en « refuel » (plein = 110 × 0,5 s = 55 s).
function seedRefueling(sim, gateId) {
  const ac = {
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
    phase: 'refuel', x: 0, y: 0, gateId, runwayId: 'r1',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  };
  sim.aircraft.push(ac);
  return ac;
}
const tick = (sim) => { tickAircraft(sim, 0.1); tickEconomy(sim, 0.1); };

test('R28 (1) : DEUX stations → la priorité d\'acquisition est la DISTANCE (la plus proche d\'abord, PAS l\'ordre des ids)', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  assert.ok(far && near, 'les deux stations sont posées (même terminal)');
  assert.ok(far.id < near.id, 'la LOINTAINE a le plus petit id (ordres inversés : distance ≠ id)');
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'l\'avion a une lance (2 stations libres)');
  // La station PROCHE est servie EN PREMIER — alors qu'elle a le PLUS GRAND
  // id : c'est la DISTANCE qui décide (R28), pas un ordre arbitraire.
  assert.equal(a1._lanceId, near.id, 'la station LA PLUS PRÈCHE est servie en premier (distance, R28)');
  assert.ok(a1._refuelNeed > 0, 'le plein est en cours (durée mesurée, 55 s pour un medium)');
});

test('R28 (2) : PANNE LOCALE de la PROCHE pendant le plein → l\'avion CHANGE à la LOINTAINE (la voisine continue)', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  tick(sim);
  assert.equal(a1._lanceId, near.id, 'a1 a la station PROCHE (la plus proche)');
  // La station PROCHE tombe EN PANNE LOCALE (la LOINTAINE continue de servir).
  forceIncident(sim, `fuel:${near.id}`);
  assert.ok(fuelOutStation(sim, near.id), 'la station PROCHE est en panne locale');
  assert.ok(!fuelOutStation(sim, far.id), 'la station LOINTAINE est SAINNE (panne locale, pas globale)');
  // L'avion a LIBÉRÉ la station PROCHE (propriétaire fantôme nettoyé) et
  // CHANGE à la station LOINTAINE au prochain tick.
  tick(sim);
  assert.equal(a1._lanceId, far.id, 'l\'avion CHANGE à la station LOINTAINE (la voisine continue de servir)');
  assert.equal(a1._refueling, true, 'le plein est ACTIF à la LOINTAINE');
});

test('R28 (3) : PANNE LOCALE de TOUTES les stations → départ sec (non bloquant, expliqué)', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  tick(sim);
  assert.equal(a1._refueling, true, 'le plein est en cours');
  // Les DEUX stations tombent en panne LOCALE (aucune n\'est opérable).
  forceIncident(sim, `fuel:${near.id}`);
  forceIncident(sim, `fuel:${far.id}`);
  tick(sim);
  assert.equal(a1._dryDeparture, true, 'aucune station opérable : DÉPART SEC (conséquence lisible, non bloquante)');
  assert.equal(a1._refueling, false, 'le plein est LIBÉRÉ (pas de lance fantôme)');
  assert.equal(sim.aircraft.filter((a) => a._refueling).length, 0, 'l\'occupation compte QUE les pleins actifs (0)');
});

test('R28 (4) : SAUVEGARDE pendant le plein + DÉMOLITION de la station SERVI à la reprise → la lance fantôme est nettoyée (re-sélection, pas de fantôme)', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  a1.runwayId = sim.infra.runways[0].id; // piste EXISTANTE (le schéma valide les références)
  tick(sim);
  assert.equal(a1._lanceId, near.id, 'a1 a la station PROCHE (la plus proche)');
  // SAUVEGARDE pendant le plein : l'avion est branché à la station PROCHE.
  // À la REPRISE, on DÉMOLIT la station SERVI (la PROCHE) : l'avion ne doit
  // PAS garder un propriétaire fantôme — il re-sélectionne la LOINTAINE.
  const restored = deserialize(serialize({ screen: 'play', time: 0, terrain: 1, camera: null, sim }));
  const ac = restored.sim.aircraft.find((a) => a.id === a1.id);
  assert.equal(ac._lanceId, near.id, 'la lance est SAUVÉgardée (propriétaire explicite)');
  assert.equal(ac._refueling, true, 'le plein est ACTIF avant la démolition');
  demolishBuilding(restored.sim, near.id);
  tick(restored.sim); // doRefuel : la station PROCHE n'existe plus → nettoyage + re-sélection
  const ac2 = restored.sim.aircraft.find((a) => a.id === a1.id);
  assert.equal(ac2._lanceId, far.id, 'la lance fantôme est nettoyée → re-sélection de la LOINTAINE (qui reste)');
  assert.equal(ac2._refueling, true, 'le plein a REPRIS à la station LOINTAINE');
});

test('R28 (5) : DÉMOLITION de TOUTES les stations après la reprise → le propriétaire est nettoyé (pas de fantôme)', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  a1.runwayId = sim.infra.runways[0].id;
  tick(sim);
  assert.equal(a1._lanceId, near.id, 'a1 a la station PROCHE');
  // SAUVEGARDE pendant le plein, puis démolition des DEUX stations :
  // à la reprise, l'avion n'a plus AUCUNE station → nettoyage EXPLICITE.
  const restored = deserialize(serialize({ screen: 'play', time: 0, terrain: 1, camera: null, sim }));
  const ac = restored.sim.aircraft.find((a) => a.id === a1.id);
  assert.equal(ac._lanceId, near.id, 'la lance est SAUVÉgardée');
  demolishBuilding(restored.sim, near.id);
  demolishBuilding(restored.sim, far.id);
  tick(restored.sim); // doRefuel : plus aucune station → releaseLance
  const ac2 = restored.sim.aircraft.find((a) => a.id === a1.id);
  assert.equal(ac2._lanceId, null, 'la lance est LIBÉRÉE (pas de propriétaire fantôme)');
  assert.equal(ac2._refueling, false, 'le plein est LIBÉRÉ (pas de lance fantôme)');
  assert.equal(ac2._refuelNeed, 0, 'le temps restant est nettoyé (pas de plein fantôme)');
});

test('R28 (6) : le champ `fuelOut` (panne locale) est SÉRIALISABLE — présent = panne conservée, absent = station saine', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  const [g1] = M_GATES(sim);
  const a1 = seedRefueling(sim, g1.id);
  a1.runwayId = sim.infra.runways[0].id;
  tick(sim);
  assert.equal(a1._lanceId, near.id, 'le plein est en cours (la station PROCHE est saine)');
  // (a) La station PROCHE tombe EN PANNE LOCALE (champ `fuelOut` = true,
  // sérialisé naturellement au JSON).
  forceIncident(sim, `fuel:${near.id}`);
  assert.ok(fuelOutStation(sim, near.id), 'la station PROCHE est en panne locale (champ présent)');
  const state = { screen: 'play', time: 0, terrain: 1, camera: null, sim };
  const r1 = deserialize(serialize(state));
  assert.equal(r1.sim.infra.services.find((s) => s.id === near.id).fuelOut, true,
    'le champ PRÉSENT est conservé (la panne locale survit à la reprise)');
  // (b) PANNE absente (sauvegarde « pré-R28 ») : la validation PASSES (le
  // champ n\'est PAS requis) et la station est considérée SAINNE (pas de
  // propriété fantôme).
  sim.infra.services.find((s) => s.id === near.id).fuelOut = undefined;
  assert.ok(!fuelOutStation(sim, near.id), 'champ ABSENT = station saine (pas de fantôme)');
  const r2 = deserialize(serialize(state));
  assert.ok(!fuelOutStation(r2.sim, near.id), 'à la reprise, l absence du champ = station saine (validation tolérante)');
});

// R28 (TRAVAIL) : le SERVICE de la lance inclut un temps de DÉPLACEMENT simple
// fondé sur la DISTANCE porte→station (catalog REFUEL_TRAVEL_S_PER_1000), SANS
// agents véhicules (la sim reste sans entités mobiles — le déplacement est un
// retard proportionnel à la distance, la station éloignée sert plus lentement).
test('R28 (7) : le temps de SERVICE est fondé sur la DISTANCE porte→station (pas d agents véhicules)', () => {
  const sim = newSimState();
  const { far, near } = buildSocle2(sim);
  const [g1] = M_GATES(sim);
  const aNear = seedRefueling(sim, g1.id);
  aNear.runwayId = sim.infra.runways[0].id;
  tick(sim);
  assert.equal(aNear._lanceId, near.id, 'le plein se fait à la station PROCHE (la plus proche)');
  const base = aNear._refuelNeed; // R28 : 55 s (taille) + ~5 s (déplacement de la PROCHE)
  assert.ok(base > 55, `le service inclut le DÉPLACEMENT (distance) — ${base} s > 55 s de base (taille)`);
  // On force le plein à la station LOINTAINE (panne locale de la PROCHE) :
  // l'avion change de station et son temps de service AUGMENTE (distance plus grande).
  forceIncident(sim, `fuel:${near.id}`);
  tick(sim);
  assert.equal(aNear._lanceId, far.id, 'la station PROCHE est en panne → le plein CHANGE à la LOINTAINE');
  assert.ok(aNear._refuelNeed > base, 'le plein de la station LOINTAINE est PLUS LONG (déplacement plus grand)');
});

// R28 (VALIDATION) : AJOUTER une station apporte un GAIN dans un scénario
// RÉELLEMENT LIMITÉ PAR LE CARBURANT. Le scénario : DEUX avions à la MÊME
// porte, UN seul terminus de lance. Avec UNE station (éloignée), les deux
// pleins sont SÉQUENTIELS (un avion = une lance) ; avec DEUX stations (une
// proche + une éloignée), les deux pleins sont EN PARALLÈLE (chaque avion a
// sa lance) → le temps TOTAL est plus court. C'est le « gain » mesuré.
test('R28 (8) : AJOUTER une station apporte un GAIN dans un scénario limité par le carburant (parallélisation)', () => {
  const runAll = (build) => {
    const sim = newSimState();
    build(sim);
    const [g1] = M_GATES(sim);
    const a1 = seedRefueling(sim, g1.id);
    const a2 = seedRefueling(sim, g1.id); // deux avions MÊME porte (limité par les lances)
    a1.runwayId = sim.infra.runways[0].id;
    a2.runwayId = sim.infra.runways[0].id;
    let t = 0;
    while (t < 1500 && (a1.phase === 'refuel' || a2.phase === 'refuel')) { tick(sim); t++; } // 150 s
    return t * 0.1; // temps total (s) pour que les DEUX pleins soient finis
  };
  // Scénario A : UNE seule station (éloignée) — les deux pleins sont SÉQUENTIELS.
  const buildOne = (sim) => { rebuildGraph(sim); sim.economy.money = 100000;
    sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium', pax: 160, planned: 300, status: 'planned' });
    buildBuilding(sim, 'runway', 750, 100); buildBuilding(sim, 'taxiway', 550, 1050); buildBuilding(sim, 'terminal', 550, 900);
    buildBuilding(sim, 'fuel', 100, 1050); // UNE seule station (éloignée)
    rebuildGraph(sim); };
  // Scénario B : DEUX stations (une proche AJOUTÉE + une éloignée) — les deux pleins en PARALLÈLE.
  const buildTwo = (sim) => { buildOne(sim); buildBuilding(sim, 'fuel', 350, 1050); rebuildGraph(sim); }; // + station PROCHE
  const tA = runAll(buildOne);
  const tB = runAll(buildTwo);
  assert.ok(tB < tA, `AJOUTER une station apporte un GAIN : temps total ${tB} s (2 stations) < ${tA} s (1 station) — parallélisation des pleins`);
});
