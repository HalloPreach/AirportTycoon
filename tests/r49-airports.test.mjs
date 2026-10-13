// T3 stretch (t_79820790) — MULTI-AÉROPORTS : le SECOND aéroport « Cap Nord »
// (objectif stretch « a second airport ») — tests du catalogue AIRPORTS
// (src/core/layouts.mjs), du spawn paramétré (src/core/new-game.mjs), du
// scénario capNord (src/scenarios.mjs) et du replay 48 h DÉTERMINISTE
// (pattern tests/scenarios.test.mjs + qa/bl17-sim48h.mjs, EV-10).
//
//   • le layout « central » est bit-à-bit IDENTIQUE au START_LAYOUT legacy :
//     le spawn par défaut (et tous les scénarios R38/R46) reste INVARIANT —
//     le multi-aéroports est ADDITIF (aucune règle modifiée) ;
//   • Cap Nord : un profil DIFFÉRENT — 2 pistes (une CAPABLE L : longueur 800
//     = AIRCRAFT.large.minRunway ; une M : 500), un terminal 4 portes
//     (L, M, M, L) — relié par un réseau de 3 taxiways ; le réseau est
//     PHYSIQUEMENT VALIDE : composante connexe unique, chemins piste→porte
//     pour TOUS les couples, zéro chevauchement, terrain 1600×1200 ;
//   • le scénario capNord : configuration EXPLICITE (seed 24, budget mesuré
//     CAP_NORD_FUNDS), marqueur state.scenario (champ `airport` additif),
//     round-trip sérialisation/rechargement, et 48 h de replay déterministe
//     : invariants par tick + reproductibilité (2 passes) + PAS DE FAILLITE
//     (le minimum de solde reste positif — mesuré : 11 357 $ avec 12 000 $).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AIRPORTS, DEFAULT_AIRPORT } from '../src/core/layouts.mjs';
import { makeGameState, START_LAYOUT } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { startScenario, CAP_NORD_FUNDS } from '../src/scenarios.mjs';
import { rebuildGraph, findPath, gateNodeOf, runwayExitNode } from '../src/pathfinding/path.mjs';
import { runwayFor } from '../src/infra/infra.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { AIRCRAFT } from '../src/data/catalog.mjs';

// Harnais 48 h (pattern bl17-sim48h.mjs) : invariants par tick sur un état
// INCOHÉRENT (une valeur non finie / pax non monotones / phase inconnue /
// planning incohérent → l'échec est immédiat), + suivi du MINIMUM de solde
// (la preuve « pas de faillite » du budget du scénario).
const H = 3600;
const PHASES = new Set([
  'approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel',
  'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked',
  'cancelled', 'departed',
]);

function invariants(sim, t, prev) {
  const m = sim.economy.money;
  const sat = sim.passengers.satisfaction;
  const carried = sim.passengers.totalCarried;
  if (!Number.isFinite(m) || !Number.isFinite(sat) || !Number.isFinite(carried)) {
    throw new Error(`t=${t} : valeur non finie (money=${m} sat=${sat} carried=${carried})`);
  }
  if (carried < prev.carried) {
    throw new Error(`t=${t} : passagers transportés NON monotones (${prev.carried} → ${carried})`);
  }
  for (const a of sim.aircraft) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
      throw new Error(`t=${t} : avion #${a.id} hors position (x=${a.x} y=${a.y})`);
    }
    if (!PHASES.has(a.phase)) {
      throw new Error(`t=${t} : avion #${a.id} phase inconnue « ${a.phase} »`);
    }
  }
  for (const e of sim.planning) {
    if (!Number.isFinite(e.planned) || !(e.status in { planned: 1, accepted: 1, 'in-flight': 1, delayed: 1, cancelled: 1 })) {
      throw new Error(`t=${t} : entrée planning incohérente #${e.id} (${e.status})`);
    }
  }
  prev.carried = carried;
}

// UNE passe 48 h (auto-accept ON = joueur passif — la sim décide tout) :
// retourne l'état final condensé + le minimum de solde observé.
function replay48h() {
  const state = startScenario('capNord');
  const sim = state.sim;
  state.screen = 'game'; // tick.mjs : la sim n'avance que sur l'écran de jeu
  const rng = makeSimRng(sim);
  const prev = { carried: 0 };
  let minMoney = sim.economy.money;
  for (let t = 0; t <= 48 * H; t++) {
    for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true);
    sim.alerts.length = 0;
    tick(state, 1, rng);
    if (sim.economy.money < minMoney) minMoney = sim.economy.money;
    invariants(sim, t, prev);
  }
  return {
    minMoney: Math.round(minMoney),
    final: {
      carried: sim.passengers.totalCarried,
      money: Math.round(sim.economy.money * 100) / 100,
      rngCounter: sim.rngCounter,
      revenue: Object.fromEntries(Object.entries(sim.economy.revenue).map(([k, v]) => [k, Math.round(v)])),
    },
  };
}

// --- le catalogue AIRPORTS (src/core/layouts.mjs) -----------------------------

test('R49 T3 : le layout « central » est bit-à-bit IDENTIQUE au START_LAYOUT legacy (spawn par défaut invariant)', () => {
  assert.equal(DEFAULT_AIRPORT, 'central', 'l’aéroport PAR DÉFAUT reste le central (additif)');
  assert.deepEqual(AIRPORTS.central.layout, START_LAYOUT, 'la table porte le MEME plan de départ A-2');
  assert.deepEqual(AIRPORTS.central.gateSizes, ['M', 'M'], 'les 2 portes M du terminal minimal (comme avant)');
  const sim = makeGameState(42).sim; // spawn par défaut (2e arg absent → « normal », 3e absent → central)
  assert.equal(sim.infra.runways.length, 1, 'une seule piste au spawn par défaut (inchangé)');
  assert.equal(sim.infra.runways[0].len, 1000, 'la longueur 1000 du plan A-2');
  assert.equal(sim.infra.gates.length, 2, '2 portes au spawn par défaut');
  assert.deepEqual(sim.infra.gates.map((g) => g.size), ['M', 'M'], 'les tailles M, M (inchangé)');
});

test('R49 T3 : Cap Nord — le profil DIFFÉRENT (2 pistes dont une CAPABLE L + terminal 4 portes, terrain 1600×1200)', () => {
  const a = AIRPORTS['cap-nord'];
  assert.ok(a, 'l’aéroport « cap-nord » est dans le catalogue');
  assert.equal(a.layout.length, 6, '6 segments fournis');
  const runways = a.layout.filter((s) => s.type === 'runway');
  assert.equal(runways.length, 2, 'DEUX pistes (le central n’en a qu’une)');
  const lens = runways.map((r) => r.h).sort((x, y) => x - y);
  assert.deepEqual(lens, [500, 800], 'une piste M (500) + une longue (800)');
  assert.equal(AIRCRAFT.medium.minRunway, 500, 'la piste M sert le profil medium du catalogue (critère lu, pas inventé)');
  assert.equal(AIRCRAFT.large.minRunway, 800, 'la piste longue sert le profil large du catalogue (L-capable)');
  assert.equal(a.layout.filter((s) => s.type === 'taxiway').length, 3, 'un réseau de 3 taxiways');
  assert.equal(a.layout.filter((s) => s.type === 'terminal').length, 1, 'un terminal');
  assert.deepEqual(a.gateSizes, ['L', 'M', 'M', 'L'], '4 portes (le central n’en a que 2)');
  for (const s of a.layout) {
    assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= 1600 && s.y + s.h <= 1200,
      `« ${s.type} » @(${s.x},${s.y}) ${s.w}×${s.h} : dans le terrain 1600×1200`);
  }
});

// --- le spawn paramétré (src/core/new-game.mjs) --------------------------------

test('R49 T3 : le spawn Cap Nord pose le profil (2 pistes, 4 portes) + le réseau est PHYSIQUEMENT VALIDE', () => {
  const state = makeGameState(24, 'normal', 'cap-nord');
  const sim = state.sim;
  assert.equal(sim.infra.runways.length, 2, 'DEUX pistes au spawn');
  assert.deepEqual(sim.infra.runways.map((r) => r.len).sort((x, y) => x - y), [500, 800], 'les longueurs M (500) + L (800)');
  assert.equal(sim.infra.taxiways.length, 3, '3 taxiways');
  assert.equal(sim.infra.gates.length, 4, '4 PORTES (le central : 2)');
  assert.deepEqual(sim.infra.gates.map((g) => g.size), ['L', 'M', 'M', 'L'], 'les tailles du catalogue de l\'aéroport');
  // La piste longue EST servable par les gros (critère UNIQUE de la sim, R05) :
  assert.ok(runwayFor(sim, AIRCRAFT.large.minRunway), 'runwayFor (800) trouve la piste L-capable (règle R05, infra.mjs)');
  assert.equal(runwayFor(sim, AIRCRAFT.medium.minRunway).id, runwayFor(sim, 500).id, 'la piste M est servable');
  // Réseau physique (pattern r05/r42) : graph reconstruit, pour CHAQUE couple
  // (piste, porte) il EXISTE un chemin — le réseau est une seule composante.
  rebuildGraph(sim);
  const exits = sim.infra.runways.map((r) => ({ id: r.id, node: runwayExitNode(sim, r.id) }));
  assert.ok(exits.every((e) => e.node != null), 'toutes les pistes ont une SORTIE (nœud du graphe)');
  for (const g of sim.infra.gates) {
    const gn = gateNodeOf(sim, g.id);
    assert.ok(gn != null, `la porte #${g.id} a un nœud dans le graphe`);
    for (const e of exits) {
      assert.ok(findPath(sim, e.node, gn, new Set()) != null,
        `chemin PISTE→PORTE (piste #${e.id} → porte #${g.id}) : le réseau est connecté`);
    }
  }
  // Zéro chevauchement physique (les segments fournis se TOUCHENT — règle
  // BL-02 — mais ne se CHEVAUCHENT PAS : un empilement = des cases grid
  // marquées deux fois, un rendu et un placement joueur incohérents).
  const segs = [...sim.infra.runways, ...sim.infra.taxiways, ...sim.infra.terminals];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      const ix = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
      const iy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      assert.ok(!(ix > 0.01 && iy > 0.01),
        `« ${A.type} » @(${A.x},${A.y}) ne chevauche pas « ${B.type} » @(${B.x},${B.y})`);
    }
  }
});

test('R49 T3 : un aéroport INCONNU retombe sur « central » (tolérant, additif — pas de crash)', () => {
  const sim = makeGameState(42, 'easy', 'inconnu').sim;
  assert.equal(sim.infra.runways.length, 1, 'le spawn inconnu retombe sur le layout central (référentiel)');
  assert.deepEqual(sim.infra.gates.map((g) => g.size), ['M', 'M'], 'les portes du central (inchangé)');
});

// --- le scénario capNord (src/scenarios.mjs) -----------------------------------

test('R49 T3 : le scénario capNord — config EXPLICITE (seed 24, budget mesuré) + marqueur additif + profil DIFFÉRENT', () => {
  const state = startScenario('capNord');
  const sim = state.sim;
  assert.equal(sim.rngSeed, 24, 'la seed du scénario est IMPOSÉE (rejouable, EV-10)');
  assert.equal(sim.economy.money, CAP_NORD_FUNDS, 'le budget EXPLICITE du second aéroport (mesuré, cf. replay 48 h)');
  assert.equal(sim.infra.runways.length, 2, 'DEUX pistes (le profil DIFFÉRENT — les 6 scénarios R38/R46 : une)');
  assert.equal(sim.infra.gates.length, 4, '4 PORTES (les autres scénarios : 2)');
  assert.deepEqual(state.scenario, {
    id: 'capNord', name: 'Cap Nord — aéroport du nord', objective: 'o1-cycle',
    difficulty: 'normal', airport: 'cap-nord',
  }, 'le marqueur state.scenario porte l’aéroport (champ ADDITIF — sérialisé)');
  // Les 6 scénarios R38/R46 restent INTACTS : pas de champ `airport`
  // (absent → le layout central, comportement R38/R46 inchangé).
  for (const id of ['guide', 'saturation', 'redressement', 'crise', 'difficile', 'facile']) {
    const s = startScenario(id);
    assert.equal(s.scenario.airport, undefined, `(${id}) le champ airport est ABSENT (layout central, R38/R46 intact)`);
    assert.equal(s.sim.infra.runways.length, 1, `(${id}) une seule piste (inchangé)`);
  }
});

test('R49 T3 : le round-trip sauvegarde/rechargement du scénario capNord (le profil REPREND)', () => {
  const state = startScenario('capNord');
  const raw = serialize(state);
  const back = deserialize(raw);
  assert.equal(back.sim.infra.runways.length, 2, 'les 2 pistes REPRENNENT au chargement');
  assert.equal(back.sim.infra.gates.length, 4, 'les 4 portes REPRENNENT');
  assert.deepEqual(back.sim.infra.gates.map((g) => g.size), ['L', 'M', 'M', 'L'], 'les tailles des portes (inchangées)');
  assert.equal(back.scenario.airport, 'cap-nord', 'le marqueur de l’aéroport REPREND (sérialisé avec l’état)');
  assert.equal(back.sim.rngSeed, 24, 'la seed REPREND (EV-10 : la partie rejouable)');
  assert.equal(back.sim.economy.money, CAP_NORD_FUNDS, 'le budget REPREND');
});

// --- le replay 48 h DÉTERMINISTE (pattern r38/bl17, EV-10) ---------------------

test('R49 T3 : 48 h passives du Cap Nord — invariants par tick + reproductibilité + PAS DE FAILLITE', () => {
  const r1 = replay48h();
  const r2 = replay48h(); // 2e passe : PRNG semé (seed 24) → état final IDENTIQUE
  // EV-10 (reproductibilité) : MÊME seed + MÊME politique → MÊME partie.
  assert.equal(JSON.stringify(r1.final), JSON.stringify(r2.final),
    'DEUX passes 48 h → état final IDENTIQUE (EV-10, comme le pattern r38)');
  // PAS DE FAILLITE : le minimum de solde observé sur les 48 h reste POSITIF
  // (le budget CAP_NORD_FUNDS est SUFFISANT — mesuré, pas inventé).
  assert.ok(r1.minMoney > 0, `le MINIMUM de solde sur 48 h reste positif (${r1.minMoney} $) — pas de faillite`);
  assert.ok(r1.final.carried > 0, `l'aéroport transporte des passagers (carried=${r1.final.carried})`);
  assert.ok(!r1.final.money || Number.isFinite(r1.final.money), 'le solde final est fini');
  // L'aéroport est VIVANT : des recettes réelles (pas une sim morte).
  assert.ok(Object.values(r1.final.revenue).some((v) => v > 0),
    `des recettes sont ENCAISSÉES (${JSON.stringify(r1.final.revenue)})`);
});
