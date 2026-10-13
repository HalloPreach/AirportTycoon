// T33 (t_88aee6d5) : CONTENU STATIQUE — le contenu NOUVEAU (3 bâtiments
// services, 2 compagnies, 3 améliorations, 3 règles R23) doit se charger
// COHÉREMENT (la TABLE est la source de vérité unique) et chaque famille de
// contenu doit avoir un effet MESURABLE. Les fichiers dédiés couvrent déjà
// les règles (r23-unlocks = déblocages, r31-upgrades = effets des niveaux,
// r15-units = OPEX dérivé, r10-save = validation) ; ce fichier est le check
// de COHÉRENCE TRANVERSALE du catalogue étendu :
//   (1) intégrité du catalogue (pas d'orphelin, pas de champ manquant) ;
//   (2) OPEX des nouveaux services (calibration R37 : bonne amélioration vs
//       PIÈGE documenté, lisible via opexPerMin/opexPerHour) ;
//   (3) offres de vol : les nouvelles compagnies sont DANS les pools d'offre
//       (par taille) et le générateur EXISTANT (planOneFlight, rng déterministe)
//       en pioche une (contenu additif — les règles n'ont pas changé) ;
//   (4) compatibilité sauvegarde : le nouveau contenu traverse
//       serialize/deserialize (R10 — niveaux ET bâtiments restitués).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDINGS, AIRLINES, AIRCRAFT, UPGRADES, UNLOCK_RULES, GROUND_SERVICE_TYPES,
  OPEX_PER_SEC, opexPerMin, opexPerHour,
} from '../src/data/catalog.mjs';
import { tickUnlocks } from '../src/infra/unlocks.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { buyUpgrade, upgradeLevel, gateOpsMult } from '../src/infra/upgrades.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { planOneFlight } from '../src/flights/flights.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';

// Socle minimal identique aux socles R31/R28 (piste + taxiway + terminal +
// station carburant) : le terminal porte 4 portes (S/M/M/L — TERMINAL_GATE_SIZES).
function buildSocle(sim) {
  rebuildGraph(sim);
  sim.economy.money = 100000;
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium', pax: 160, planned: 300, status: 'planned' });
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 350, 1050);
  sim.infra.gates[0].cleaning = 10;
  sim.infra.gates[0].maintenance = 10;
  sim.passengers.totalCarried = 400; // débloque dutyfree (seuil T33 : 400)
  tickUnlocks(sim);
  rebuildGraph(sim);
}

// (1) Intégrité du catalogue : chaque entrée est complète, chaque référence
// pointe vers une entrée existante (pas d'orphelin — une règle sans service,
// un service sans OPEX ou une compagnie sans taille casserait la sim en jeu).
test('T33 (1) : intégrité du catalogue étendu (pas d\'orphelin, pas de champ manquant)', () => {
  // BUILDINGS : chaque entrée est complète (nom, coût, emprise, revente).
  for (const [type, spec] of Object.entries(BUILDINGS)) {
    assert.ok(spec.name && spec.cost > 0 && spec.w > 0 && spec.h > 0, `${type} : entrée complète (nom/coût/emprise)`);
    assert.equal(typeof spec.sellRefund, 'number', `${type} : sellRefund défini`);
  }
  // Les 3 nouveaux services T33 existent et appartiennent à la famille sol.
  for (const t of ['security', 'dutyfree', 'lounge']) {
    assert.ok(BUILDINGS[t], `${t} : présent dans BUILDINGS`);
    assert.ok(GROUND_SERVICE_TYPES.includes(t), `${t} : présent dans GROUND_SERVICE_TYPES`);
  }
  // Chaque service sol est CONSTRUCTIBLE ou co-localisé : tout type de
  // GROUND_SERVICE_TYPES a une entrée BUILDINGS — sauf « maintenance », qui est
  // CO-LOCALISÉE au hangar (le hangar fournit nettoyage ET maintenance —
  // infra.mjs affecte les deux au même bâtiment, comme le socle d'origine).
  for (const t of GROUND_SERVICE_TYPES) {
    if (t === 'maintenance') continue; // co-localisée au hangar (service sans bâtiment dédié)
    assert.ok(BUILDINGS[t], `${t} : le service référencé existe dans BUILDINGS`);
  }
  // OPEX : chaque service sol a un débit (un service SANS OPEX serait gratuit).
  for (const t of GROUND_SERVICE_TYPES) {
    assert.ok(OPEX_PER_SEC[t] > 0, `${t} : OPEX défini (le service a un coût d'exploitation)`);
  }
  // Les 2 nouvelles compagnies T33 sont complètes et l'invariante du catalogue
  // tient : CHAQUE taille d'avion est opérée par au moins une compagnie
  // (planOneFlight EN DÉPEND — le vol pioche d'abord une taille servable,
  // puis une compagnie qui l'opère ; un trou ici bloquerait la génération).
  const ids = new Set(AIRLINES.map((a) => a.id));
  assert.equal(ids.size, AIRLINES.length, 'les ids compagnies sont uniques');
  assert.ok(ids.has('boreal') && ids.has('horizon'), 'les 2 nouvelles compagnies T33 sont là (additif)');
  for (const a of AIRLINES) {
    assert.ok(a.name && a.color, `${a.id} : compagnie complète (nom/couleur)`);
    assert.ok(a.types.length > 0, `${a.id} : opère au moins une taille`);
    for (const t of a.types) assert.ok(AIRCRAFT[t], `${a.id} : la taille opérée (${t}) existe au catalogue`);
  }
  for (const t of Object.keys(AIRCRAFT)) {
    assert.ok(AIRLINES.some((a) => a.types.includes(t)), `taille ${t} : opérée par au moins une compagnie (invariante)`);
  }
  // 3 nouvelles améliorations T33 : coût, plafond et EXACTEMENT UNE clé
  // d'effet (les chiffres vivent dans la table, jamais dans la logique).
  assert.equal(Object.keys(UPGRADES).length, 6, '6 choix d\'amélioration (3 existantes + 3 T33)');
  for (const [kind, spec] of Object.entries(UPGRADES)) {
    assert.ok(spec.name && spec.cost > 0 && spec.maxLevel >= 1, `${kind} : entrée complète (nom/coût/plafond)`);
    const effectKeys = ['capMultPerLevel', 'timeMultPerLevel', 'rateMultPerLevel', 'revenueMultPerLevel', 'recoverMultPerLevel']
      .filter((k) => spec[k] != null);
    assert.equal(effectKeys.length, 1, `${kind} : exactement une clé d'effet (${effectKeys.join('/')})`);
  }
  // 8 règles R23 (5 existantes + 3 T33) : chaque règle pointe un service
  // EXISTANT, avec un nom, un bénéfice et une justification. Le SEUIL
  // mesurable (queue / carried / wear) vit dans la table — « fuel » est la
  // règle de base SANS seuil (toujours disponible, le socle de départ).
  assert.equal(Object.keys(UNLOCK_RULES).length, 8, '8 règles de déverrouillage (5 existantes + 3 T33)');
  for (const [service, rule] of Object.entries(UNLOCK_RULES)) {
    assert.ok(BUILDINGS[service], `${service} : la règle pointe un service EXISTANT`);
    assert.ok(rule.name && rule.why && rule.benefit, `${service} : la règle a un nom, un bénéfice + une justification`);
    const hasThreshold = rule.queue != null || rule.carried != null || rule.wear != null;
    assert.ok(hasThreshold || service === 'fuel', `${service} : seuil mesurable présent (sauf la règle de base « fuel »)`);
  }
});

// (2) OPEX des nouveaux services : la calibration R37 est dans la TABLE —
//   security/dutyfree = BONNES améliorations (OPEX < gain, comme cleaning/
//   baggage recalibrés) ; lounge = famille CONFORT (PIÈGE documenté, comme
//   la restauration : 9 000 $/h). Les accès lisibles (opexPerMin/Hour) sont
//   dérivés de la table (r15-units en vérifie la cohérence pour tous types).
test('T33 (2) : OPEX des nouveaux services (calibration R37 — bon investissement vs PIÈGE)', () => {
  assert.equal(OPEX_PER_SEC.security, 1, 'security : 1 $/s (60 $/min — bonne amélioration)');
  assert.equal(OPEX_PER_SEC.dutyfree, 1, 'dutyfree : 1 $/s (60 $/min — bonne amélioration)');
  assert.equal(OPEX_PER_SEC.lounge, 2.5, 'lounge : 2,5 $/s (9 000 $/h — PIÈGE famille confort)');
  assert.ok(opexPerHour('lounge') > opexPerHour('security'), 'le salon coûte PLUS cher à exploiter que la salle sécurité (le PIÈGE est mesurable)');
  assert.ok(opexPerMin('dutyfree') < opexPerMin('fuel'), 'dutyfree < la station carburant (90 $/min — la meilleure amélioration R37)');
});

// (3) Offres de vol : le contenu est ADDITIF — les nouvelles compagnies sont
// dans les POOLS d'offre (par taille, le même filtre que planOneFlight :
// AIRLINES.filter(a => a.types.includes(acType))) et le générateur EXISTANT
// en pioche une avec un rng DÉTERMINISTE (aucune règle n'a changé — la
// servabilité reste contrainte par la taille, pas par la marque).
test('T33 (3) : les compagnies T33 sont dans les pools d\'offre et le générateur existant en pioche une', () => {
  const pool = (t) => AIRLINES.filter((a) => a.types.includes(t)); // MÊME filtre que planOneFlight
  assert.ok(pool('small').some((a) => a.id === 'boreal'), 'le pool « small » contient Boréal Régions');
  assert.ok(pool('medium').some((a) => a.id === 'boreal') && pool('medium').some((a) => a.id === 'horizon'),
    'le pool « medium » contient Boréal Régions ET Horizon Express (additif — les existantes restent)');
  assert.ok(pool('large').some((a) => a.id === 'horizon'), 'le pool « large » contient Horizon Express');
  assert.ok(pool('small').some((a) => a.id === 'solaire') && pool('medium').some((a) => a.id === 'atlantique'),
    'les compagnies EXISTANTES sont toujours dans leurs pools (aucune règle changée)');
  // Le générateur EXISTANT, socle minimal (qualité neuve 1,0 → palier « toutes
  // tailles » → les 3 tailles sont servables : [small, medium, large]) : avec
  // un rng constant 0,9, pick (arr[Math.floor(rng()*len)]) est DÉTERMINISTE —
  // le vol est « large » (index 2/3) et opéré par la NOUVELLE compagnie
  // Horizon Express (index 1 du pool [pacific, horizon] — preuve mesurable).
  const sim = newSimState(); buildSocle(sim);
  const rng = () => 0.9;
  const offer = planOneFlight(sim, rng);
  assert.ok(offer, 'une offre est générée (le socle est servable)');
  assert.equal(offer.acType, 'large', 'pick déterministe (0,9 sur 3 tailles) → vol « large »');
  assert.equal(offer.airline, 'horizon', 'pick déterministe (0,9 sur 2) → Horizon Express opère le vol (NOUVELLE compagnie)');
  assert.ok(AIRLINES.some((a) => a.id === offer.airline), 'l\'offre référence une compagnie du catalogue');
  assert.ok(offer.pax > 0 && offer.status === 'planned', 'l\'offre est valide (pax > 0, statut planned)');
});

// (4) Compatibilité sauvegarde : le contenu T33 (bâtiment + 3 niveaux
// d'amélioration) traverse serialize/deserialize (R10) — les niveaux sont
// RESTITUÉS (pas re-débités au chargement) et les effets restent VIFS après
// la reprise.
test('T33 (4) : compatibilité sauvegarde — le contenu T33 traverse serialize/deserialize', () => {
  const state = makeGameState();
  const sim = state.sim;
  buildSocle(sim);
  const [t] = sim.infra.terminals;
  buildBuilding(sim, 'dutyfree', 350, 950); // le bâtiment T33 est posé (dutyfree débloquée : carried 400)
  assert.equal(buyUpgrade(sim, t.id, 'boarding').ok, true, 'boarding achetée (T33)');
  assert.equal(buyUpgrade(sim, t.id, 'marketing').ok, true, 'marketing achetée (T33)');
  assert.equal(buyUpgrade(sim, t.id, 'comfort').ok, true, 'comfort achetée (T33)');
  const sim2 = deserialize(serialize(state)).sim;
  assert.ok(sim2.infra.services.some((s) => s.type === 'dutyfree'), 'le bâtiment T33 est restitué');
  assert.equal(upgradeLevel(sim2, t.id, 'boarding'), 1, 'le niveau boarding est restitué (pas re-débité au chargement)');
  assert.equal(upgradeLevel(sim2, t.id, 'marketing'), 1, 'le niveau marketing est restitué');
  assert.equal(upgradeLevel(sim2, t.id, 'comfort'), 1, 'le niveau comfort est restitué');
  assert.equal(gateOpsMult(sim2, t.id), 0.75, 'l\'effet T33 est VIF après la reprise (×0,75 au niveau 1)');
});
