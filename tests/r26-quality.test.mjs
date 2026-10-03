// R26 (t_62ffa6bc) — relier les offres à la progression et à la qualité.
// Vérifications (sim réelle, déterministe, zéro DOM — le panneau lit, la sim décide) :
//   1. le plafond d'arrivées est un PARAMÈTRE de la sim (sim.pendingCap,
//      borné [MAX_PENDING, PENDING_CAP_MAX]) : absent → 4 (comportement A-5
//      intact), hors bornes → ramené dans l'intervalle.
//   2. la capacité supplémentaire permet de TRAITER la demande : file saturée
//      au plafond → plus d'offres ; le paramètre monté (capacité) → les
//      offres repartent (l'agrandissement ne se heurte pas à un plafond caché).
//   3. le contrat ACTIF augmente RÉELLEMENT les vols proposés (1 offre/fenêtre
//      supplémentaire, comme le pic BL-14) — même rng, même durée : le
//      contrat fait passer le nombre d'offres proposées.
//   4. réputation faible : la valeur est bornée (Q_FLOOR) et le palier 0
//      offre TOUJOURS les petits (voie de reprise) — pas de spirale punitive ;
//      la valeur converge vers la mesure par pas bornés (inertie).
//   5. plusieurs seeds varient les offres SANS changer la règle (mix borné
//      par le palier, ids uniques, pas de doublons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickPlanner, MAX_PENDING, PENDING_CAP_MAX, pendingCap, planOneFlight } from '../src/flights/flights.mjs';
import { ensureQuality, qualityTier, qualityView, tickQuality, Q_FLOOR, Q_TIERS } from '../src/progression/quality.mjs';
import { ensureContracts, decideContract, tickContracts, activeContract } from '../src/flights/contracts.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// Aéroport CONNECTÉ (même plan que tests/r13-deployment.test.mjs) : les vols
// planifiés sont SERVABLES (les phases attendues restent « approach »).
function connectedAirport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}
// PRNG semé (le même que les tests R13) : les offres sont reproductibles.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (seed >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ticks = (sim, s, r) => { for (let i = 0; i < Math.ceil(s / 0.1); i++) tickPlanner(sim, 0.1, r); };
const offers = (sim) => sim.planning.filter((e) => e.status === 'planned' || e.status === 'accepted').length;
// Contrat ACTIF : ≥ 300 pax transportés (condition mesurée R24) → l'offre du
// 1er contrat est posée, acceptée → le contrat est ACTIF (état sérialisé).
function withActiveContract(sim) {
  sim.passengers.totalCarried = 300;
  tickContracts(sim, 1);
  const v = sim.contracts.offered;
  assert.ok(v, 'l’offre de contrat est posée (≥ 300 pax)');
  assert.equal(decideContract(sim, v.id, true), true, 'acceptation du contrat');
  assert.ok(activeContract(sim), 'le contrat est ACTIF (état sérialisé)');
}

// --- 1. Le plafond est un PARAMÈTRE de la sim (borné, absent → 4) ----------------
test('R26 : pendingCap — absent → 4 (A-5 intact), borné [MAX_PENDING, PENDING_CAP_MAX]', () => {
  const sim = newSimState();
  assert.equal(pendingCap(sim), MAX_PENDING, 'absent → 4 (sauvegarde ancienne : comportement A-5)');
  sim.pendingCap = 7;
  assert.equal(pendingCap(sim), 7, 'paramètre lisible (le joueur l’ajuste)');
  sim.pendingCap = 999;
  assert.equal(pendingCap(sim), PENDING_CAP_MAX, 'borne HAUTE bornée (pas de croissance illimitée)');
  sim.pendingCap = 1;
  assert.equal(pendingCap(sim), MAX_PENDING, 'borne basse = le plafond A-5 (le 4 reste le plancher)');
});

// --- 2. Une capacité supplémentaire permet de TRAITER la demande -----------------
test('R26 : file saturée au plafond → plus d’offres ; capacité montée (cap 8) → les offres repartent', () => {
  const sim = connectedAirport();
  // File saturée : 4 avions en approche (le plafond MAX_PENDING par défaut).
  sim.aircraft = Array.from({ length: MAX_PENDING }, (_, i) => ({
    id: i, airline: 'x', color: '#fff', acType: 'small', pax: 10,
    phase: 'approach', x: 800, y: 1100, gateId: null, runwayId: 'r',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  }));
  assert.equal(offers(sim), 0, 'file vide au départ');
  tickPlanner(sim, 61, rng(1)); // 1 fenêtre : la file est pleine → AUCUNE offre
  assert.equal(offers(sim), 0, 'file au plafond → le planificateur n’offre plus (A-5)');
  // La capacité supplémentaire (paramètre) libère la file → les offres repartent.
  sim.pendingCap = 8;
  assert.equal(pendingCap(sim), 8, 'le paramètre monte (borné : 8 max)');
  tickPlanner(sim, 61, rng(2)); // fenêtre suivante : places libres → offre posée
  assert.ok(offers(sim) > 0, 'capacité montée : les offres repartent (l’agrandissement passe)');
});

// --- 3. Le contrat ACTIF augmente RÉELLEMENT les vols proposés -------------------
// Validation R26 : l'engagement ouvre une demande ANNONCÉE (+1 offre par
// fenêtre, comme le pic BL-14). SANS capacité (plafond 4), le goulot bloque
// l'excédent — la demande s'exprime en RETARDS, pas en plus de vols ; AVEC la
// capacité (paramètre monté, borné), les vols proposés augmentent RÉELLEMENT.
test('R26 : contrat actif — sans capacité le goulot bloque ; capacité montée, les vols proposés augmentent', () => {
  const plain = connectedAirport();
  ticks(plain, 300, rng(42)); // 5 fenêtres (300 s) sans contrat
  const noCap = connectedAirport();
  withActiveContract(noCap);
  ticks(noCap, 300, rng(42)); // contrat actif, plafond 4 (goulot)
  assert.equal(offers(noCap), offers(plain),
    'sans capacité : le plafond A-5 bloque l’excédent (la demande s’exprime en retards, pas en plus de vols)');
  // La capacité supplémentaire (paramètre borné) permet de TRAITER la demande :
  const withCap = connectedAirport();
  withActiveContract(withCap);
  withCap.pendingCap = PENDING_CAP_MAX; // l’investissement suit l’engagement (8, la borne haute)
  ticks(withCap, 300, rng(42));
  assert.ok(offers(withCap) > offers(plain),
    `capacité montée + contrat actif : les vols proposés augmentent RÉELLEMENT (${offers(plain)} → ${offers(withCap)})`);
  // Déterminisme : le mix varie SANS changer la règle — 2 runs même seed,
  // MÊME suite d'offres (ids, compagnies, tailles identiques).
  const a = connectedAirport(); withActiveContract(a); ticks(a, 300, rng(42));
  const b = connectedAirport(); withActiveContract(b); ticks(b, 300, rng(42));
  const seq = (s) => s.planning.map((e) => `${e.id}:${e.airline}:${e.acType}`);
  assert.deepEqual(seq(a), seq(b), 'même seed → même suite d’offres (la règle est stable)');
});

// --- 4. Réputation faible : borne + inertie, une voie de reprise ------------------
test('R26 : réputation faible — valeur bornée (Q_FLOOR) et le palier 0 garde les petits (voie de reprise)', () => {
  const sim = connectedAirport();
  // Effondrement de la ponctualité : 50 fins de vol en retard dans la fenêtre
  // R17 (mesure = 0 %) — la valeur CONVERGE vers la mesure par pas bornés
  // (inertie), elle ne s'effondre pas en un tick.
  sim.punctuality = { recent: Array.from({ length: 50 }, (_, i) => ({
    at: -30 * i, id: 1000 + i, acType: 'medium', delayed: 1e6, cause: 'piste', cancelled: false,
  })) };
  ensureQuality(sim).q = 0.5;
  tickQuality(sim, 1); // 1 s : pas borné ≤ Q_DROP_PER_S (pas un saut à la mesure)
  assert.ok(ensureQuality(sim).q >= 0.5 - 0.0021, 'descente par PAS BORNÉ (inertie)');
  // La borne basse tient : même un effort de descente de 1000 s ne passe pas Q_FLOOR.
  sim.quality.q = Q_FLOOR + 0.001;
  tickQuality(sim, 1000);
  assert.equal(sim.quality.q, Q_FLOOR, 'la borne basse tient (pas de spirale sans issue)');
  // Palier 0 (valeur < 0.4) : le mix d'offres est borné AUX PETITS — la voie
  // de reprise existe (les Cessna restent proposés, l'infra les sert).
  sim.quality.q = Q_FLOOR; // 0.3 < 0.4 → palier 0
  assert.equal(qualityTier(sim), 0, 'palier 0 (qualité faible)');
  assert.deepEqual(qualityView(sim).sizes, Q_TIERS[0].sizes, 'le mix garde les petits (voie de reprise)');
  // Les petits SE PROPOSENT (le filtre infra les sert, le palier 0 les autorise) :
  const planned = planOneFlight(sim, rng(7));
  assert.ok(planned && planned.acType === 'small', 'palier 0 : les offres sont des petits (reprise possible)');
});

// --- 5. Le palier qualité borne le mix d'offres (progression) ---------------------
test('R26 : palier 2 (qualité prouvée) → toutes les tailles proposées ; palier 1 → pas de large', () => {
  const sim = connectedAirport();
  sim.quality = { q: 0.9 }; // qualité prouvée → palier 2
  assert.equal(qualityTier(sim), 2, 'palier 2');
  const large = (() => { for (let i = 0; i < 50; i++) { const e = planOneFlight(sim, rng(9 + i)); if (e.acType === 'large') return e; } return null; })();
  assert.ok(large, 'palier 2 : les 747 réapparaissent dans les offres (progression)');
  sim.quality = { q: 0.5 }; // palier 1 : moyens possibles, large NON
  assert.equal(qualityTier(sim), 1, 'palier 1');
  let sawLarge = false, sawMedium = false;
  for (let i = 0; i < 200; i++) {
    const e = planOneFlight(sim, rng(100 + i));
    if (e.acType === 'large') sawLarge = true;
    if (e.acType === 'medium') sawMedium = true;
  }
  assert.ok(!sawLarge, 'palier 1 : jamais de large proposé (la qualité n’a pas prouvé)');
  assert.ok(sawMedium, 'palier 1 : les moyens sont proposés (activité modeste)');
  // L'UI lit LA MÊME règle (le panneau QualityView, jamais une 2e règle) :
  assert.equal(qualityView(sim).tier, 1, 'la vue qualité lit le palier (UI fine)');
});

// --- 6. Le champ qualité est SÉRIALISÉ (EV-10) : la reprise garde la valeur --------
test('R26 : sim.quality sérialisé — la reprise reprend la valeur (bornée) et le palier suit', () => {
  const sim = connectedAirport();
  sim.quality = { q: 0.35 };
  assert.equal(qualityTier(sim), 0, 'avant reprise : palier 0');
  const state = { screen: 'game', time: 0, terrain: null, camera: null, sim };
  const sim2 = deserialize(serialize(state)).sim;
  assert.ok(sim2.quality, 'le champ qualité survit au round-trip (EV-10)');
  assert.ok(Math.abs(sim2.quality.q - 0.35) < 1e-9, 'la valeur effective est conservée (pas re-départ 1.0)');
  assert.equal(qualityTier(sim2), 0, 'le palier suit la valeur rechargée (la reprise ne ré-accorde pas la qualité)');
});
