// R25 (t_974e6b1e) — présentation riche du contrat (délai/vols/capacités/
// revenus/pire pénalité) + progression et risque APRÈS DÉPART et SAUVEGARDE
// EXACTE. Vérifications (zéro DOM, déterministe — le panneau lit, la sim décide) :
//   1. contractCapable : le verdict de capacité réutilise le critère du
//      PLANIFICATEUR (runwayFor : piste ≥ minRunway + porte de la taille) —
//      les 3 modèles sont servables sur l'infra complète (piste 1000 +
//      portes S/M/M/L), NON servables quand la piste est trop courte ou la
//      porte absente (motif lisible, l'offre reste possible : investissement,
//      pas blocage).
//   2. Les capacités affichées (nom + sièges) viennent du CATALOGUE (AIRCRAFT)
//      — jamais dupliquées.
//   3. contractOnTrack : LA règle unique de réussite (vols + pax +
//      ponctualité de la taille) — lue par le règlement (tickContracts) ET le
//      panneau (view.active.onTrack) : jamais deux prédictions divergentes ;
//      le règlement à l'échéance produit le résultat qu'onTrack prédit.
//   4. L'offre du panneau expose l'appareil (acType) + la description riche
//      (délai, vols, pax, ponctualité, prime, pénalité plafonnée).
//   5. Sauvegarde EXACTE : R25 n'ajoute AUCUN champ à l'état sim — le
//      serialize/deserialize R24 reste exact (contrat actif + compteurs
//      conservés, reprise ne ré-règle jamais).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { AIRCRAFT } from '../src/data/catalog.mjs';
import {
  CONTRACT_MODELS, ensureContracts, decideContract, tickContracts, contractView,
  contractCapable, contractOnTrack, activeContract,
} from '../src/flights/contracts.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

const LOW = CONTRACT_MODELS.find((m) => m.id === 'light');
const QUALITY = CONTRACT_MODELS.find((m) => m.id === 'quality');

// Infra comme l'aéroport de départ (A-2) : 2 pistes de 1000 + portes S/M/M/L.
function fullInfra(sim) {
  sim.infra.runways.push({ id: 'rw1', len: 1000 }, { id: 'rw2', len: 1000 });
  for (const size of ['S', 'M', 'M', 'L']) sim.infra.gates.push({ id: 'g' + size + sim.infra.gates.length, size });
}
function offerAndAccept(sim, modelId) {
  sim.passengers.totalCarried = 300; // condition du 1er contrat (mesurable)
  tickContracts(sim, 1);
  const v = contractView(sim);
  assert.ok(v.offered, 'offre présente');
  decideContract(sim, v.offered.id, true);
  assert.equal(activeContract(sim)?.model, modelId, `contrat ${modelId} actif`);
}

test('capacités : les 3 modèles servables sur l\'infra complète (piste 1000 + S/M/M/L)', () => {
  const sim = newSimState();
  fullInfra(sim);
  for (const m of CONTRACT_MODELS) {
    const cap = contractCapable(sim, { acType: m.acType });
    assert.equal(cap.capable, true, `${m.id} servable`);
    assert.equal(cap.name, AIRCRAFT[m.acType].name, 'nom du catalogue (pas dupliqué)');
    assert.equal(cap.seats, AIRCRAFT[m.acType].seats, 'sièges du catalogue');
    assert.equal(cap.why, '', 'pas de motif quand servable');
  }
});

test('capacités : piste trop courte → non servable, motif lisible (l\'offre reste possible)', () => {
  const sim = newSimState();
  sim.infra.runways.push({ id: 'rw', len: 400 }); // sert small (300) + medium ? non (500)
  sim.infra.gates.push({ id: 'gS', size: 'S' });
  assert.equal(contractCapable(sim, { acType: 'small' }).capable, true); // piste 400 ≥ 300
  const reg = contractCapable(sim, { acType: 'medium' });
  assert.equal(reg.capable, false);
  assert.match(reg.why, /piste trop courte/);
});

test('capacités : porte absente → non servable (le contrat 747 sans porte L)', () => {
  const sim = newSimState();
  sim.infra.runways.push({ id: 'rw', len: 1000 });
  sim.infra.gates.push({ id: 'gM', size: 'M' }); // pas de porte L
  const cap = contractCapable(sim, { acType: QUALITY.acType });
  assert.equal(cap.capable, false);
  assert.match(cap.why, /pas de porte de la taille/);
});

test('onTrack : LA règle unique (vols + pax + ponctualité) — le règlement suit', () => {
  const sim = newSimState();
  fullInfra(sim);
  offerAndAccept(sim, 'light');
  const a = activeContract(sim);
  // Sous les exigences : vols + pax atteints mais ponctualité < 50 % → non.
  a.done = 3; a.pax = 15; a.ends = 4; a.onTime = 2; // ponctualité 50 % = limite
  assert.equal(contractOnTrack(a, LOW), true, 'limite ponctualité atteinte → à l\'heure');
  a.onTime = 1; // 25 % < 50 %
  assert.equal(contractOnTrack(a, LOW), false);
  // Le panneau lit LE MÊME verdict (jamais ré-imposé) :
  assert.equal(contractView(sim).active.onTrack, false);
  // Le règlement à l'échéance suit la même règle (jamais deux prédictions) :
  a.due = sim.time ?? 0; // échéance IMMÉDIATE (tickContracts ne déplace pas l'horloge)
  tickContracts(sim, 1);
  assert.equal(a.result, 'failed', 'échec = ce qu\'onTrack prédisait');
});

test("l'offre du panneau expose l'appareil + la description riche (délai/vols/pax/revenus)", () => {
  const sim = newSimState();
  fullInfra(sim);
  sim.passengers.totalCarried = 300;
  tickContracts(sim, 1);
  const v = contractView(sim);
  assert.ok(v.offered, 'offre présente');
  assert.equal(v.offered.acType, LOW.acType, 'appareil de l\'offre (affichage capacités)');
  assert.match(v.offered.desc, /vols/, 'description riche : vols exigés');
  assert.match(v.offered.desc, /pax/, 'description riche : pax minimum');
  assert.match(v.offered.desc, /pénalité/, 'pire pénalité affichée');
  assert.ok(v.offered.left > 0 && v.offered.left <= 600, 'délai de décision (mesuré)');
});

test('sauvegarde EXACTE : R25 n\'ajoute aucun champ — le contrat survit au round-trip', () => {
  const sim = newSimState();
  fullInfra(sim);
  offerAndAccept(sim, 'light');
  const a = activeContract(sim);
  a.done = 1; a.pax = 10; a.ends = 1; a.onTime = 1;
  // L'état contrats n'a que les champs R24 (rien de nouveau ajouté par R25) :
  const stateKeys = new Set(Object.keys(sim.contracts));
  for (const k of stateKeys) {
    assert.ok(['nextId', 'offered', 'active', 'history', 'cooldownUntil'].includes(k),
      `champ inconnu « ${k} » dans l'état contrats (la sauvegarde ne devrait pas changer de forme)`);
  }
  const state = { screen: 'game', time: 0, terrain: null, camera: null, sim };
  const sim2 = deserialize(serialize(state)).sim;
  const a2 = sim2.contracts.active;
  assert.equal(a2.id, a.id, 'le contrat actif est conservé');
  assert.deepEqual([a2.done, a2.pax, a2.ends, a2.onTime], [a.done, a.pax, a.ends, a.onTime],
    'les compteurs sont conservés (la reprise mesure la suite, jamais re-réglable)');
  assert.equal(a2.settled, false, 'le règlement n\'a pas eu lieu avant la reprise');
});
