// R27 (t_6424937a) : AFFECTATION des services aux terminaux.
// Les services au sol (carburant / hangar / nettoyage) ne renforcent PLUS
// l'aéroport entier : l'effet est mesuré UNIQUEMENT sur le terminal
// AFFECTÉ (svc.target). La sim et l'UI lisent la mesure (servicesServingGate /
// countTypeServing / assignmentView), jamais de re-dérivation globale.
//
//   VALIDATION (carte R27) :
//     1. service affecté à A ne renforce pas B (2 terminaux, service sur A
//        seulement → B non nettoyé / non alimenté) ;
//     2. déplacer l'affectation change les capacités (setAssignment A→B :
//        B devient servable, A ne l'est plus) ;
//     3. terminal supprimé → service réaffecté (motif lisible, auto) ou
//        inactif (plus aucun terminal) ;
//     4. migration : une sauvegarde SANS `target` (pré-R27) reçoit une
//        affectation DÉTERMINISTE + annoncée (ensureAssignments > 0).
// Zéro DOM, déterministe, sim seule (pas de tickPlanner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, placeBuilding, cleanGates, demolishBuilding, tickUnlocks } from '../src/infra/infra.mjs';
import { setAssignment, servicesServingGate, countTypeServing, assignmentView, ensureAssignments } from '../src/infra/assignments.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { GROUND_SERVICE_TYPES, OPEX_PER_SEC } from '../src/data/catalog.mjs';

// Socle : piste + taxiway + UN terminal (4 portes S/M/M/L) + déblocages.
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}
function unlock(sim) {
  sim.economy.money = 100000;
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium', pax: 100, planned: 60, status: 'planned' });
  for (const g of sim.infra.gates) { g.cleaning = 10; g.maintenance = 10; }
  sim.passengers.totalCarried = 400;
  tickUnlocks(sim);
}
// Deux terminaux ÉLOIGNÉS (le 2e loin du 1er → l'affectation au plus proche
// est mesurable, pas un artefact de position).
function twoTerminals(sim) {
  buildBuilding(sim, 'terminal', 300, 250); // terminal B (id 2)
  rebuildGraph(sim);
  return [sim.infra.terminals[0], sim.infra.terminals[1]];
}
const gatesOf = (sim, termId) => sim.infra.gates.filter((g) => g.terminalId === termId);

// (1) AFFECTÉ À A NE RENFORCE PAS B — nettoyage : usure « sale » de B stable,
// celle de A diminue (le service est affecté au terminal le plus proche A).
test('R27 (1) : un service affecté à A ne renforce pas B (nettoyage par terminal)', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A, B] = twoTerminals(sim);
  // Le service nettoyage est posé PRÈS de A (350,950, sous A) → affecté à A.
  const svc = buildBuilding(sim, 'cleaning', 350, 950);
  assert.ok(svc, 'le service nettoyage est construit');
  assert.equal(svc.target, A.id, `affectation automatique = terminal le plus proche (${A.id})`);
  const aGates = gatesOf(sim, A.id), bGates = gatesOf(sim, B.id);
  for (const g of [...aGates, ...bGates]) g.cleaning = 80; // tous sales
  cleanGates(sim, 10); // 10 s avec le service (débit 1/s)
  assert.ok(aGates.every((g) => g.cleaning < 71), `les portes de A sont nettoyées (80 → ${aGates[0].cleaning.toFixed(1)})`);
  assert.ok(bGates.every((g) => g.cleaning === 80),
    `les portes de B restent sales (80) — le service n'est PAS global`);
});

// (2) DÉPLACER l'affectation CHANGE les capacités : le service passe de A à B.
test('R27 (2) : déplacer l affectation change les capacités (setAssignment A → B)', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A, B] = twoTerminals(sim);
  const svc = buildBuilding(sim, 'cleaning', 350, 950); // affecté à A
  assert.equal(svc.target, A.id, 'avant : affecté à A');
  assert.ok(setAssignment(sim, svc.id, B.id), 'la commande change l affectation (true)');
  assert.equal(svc.target, B.id, 'après : affecté à B');
  assert.equal(svc.auto, false, 'choix joueur : auto=false (ensureAssignments ne l écrase plus)');
  const aGates = gatesOf(sim, A.id), bGates = gatesOf(sim, B.id);
  for (const g of [...aGates, ...bGates]) g.cleaning = 80;
  cleanGates(sim, 10);
  assert.ok(aGates.every((g) => g.cleaning === 80), `les portes de A ne sont PLUS nettoyées (stable ${aGates[0].cleaning})`);
  assert.ok(bGates.every((g) => g.cleaning < 71), `les portes de B sont maintenant nettoyées (80 → ${bGates[0].cleaning.toFixed(1)})`);
});

// (2bis) CARBURANT : les LANCES sont comptées PAR TERMINAL — une station
// affectée à A n'alimente PAS les portes de B (critère : pas de bonus
// implicite dû à l'existence d'un bâtiment dans un coin du terrain).
test('R27 (2bis) : une station carburant affectée à A n alimente pas les portes de B', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A, B] = twoTerminals(sim);
  const st = buildBuilding(sim, 'fuel', 350, 950); // affecté à A
  assert.equal(st.target, A.id, 'station affectée au terminal le plus proche (A)');
  assert.equal(countTypeServing(sim, 'fuel', A.id), 1, `1 lance pour A`);
  assert.equal(countTypeServing(sim, 'fuel', B.id), 0, `0 lance pour B — B ne bénéficie PAS de la station d A`);
  // Les portes de A ont des lances, celles de B n en ont pas (mesure directe).
  const aGate = gatesOf(sim, A.id)[0], bGate = gatesOf(sim, B.id)[0];
  assert.equal(servicesServingGate(sim, 'fuel', aGate).length, 1, 'porte de A : 1 station servable');
  assert.equal(servicesServingGate(sim, 'fuel', bGate).length, 0, 'porte de B : 0 station servable');
});

// (3) TERMINAL SUPPRIMÉ → service RÉAFFECTÉ (motif lisible) ou INACTIF.
test('R27 (3a) : terminal supprimé → le service auto est RÉAFFECTÉ au terminal restant', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A, B] = twoTerminals(sim);
  const svc = buildBuilding(sim, 'cleaning', 350, 950); // affecté à A
  assert.equal(svc.target, A.id, 'avant : affecté à A (auto)');
  // Suppression de A : les portes de A partent, le service (auto) doit être
  // réaffecté au terminal le plus proche RESTANT (B) — motif lisible.
  const r = demolishBuilding(sim, A.id);
  assert.ok(r?.ok !== false, 'la démolition de A est acceptée (aucun avion attaché)');
  assert.equal(sim.infra.terminals.length, 1, 'un seul terminal reste');
  assert.equal(svc.target, B.id, `service auto RÉAFFECTÉ à B (plus d A)`);
  assert.equal(svc.auto, true, 'la réaffectation est automatique (la règle, pas le joueur)');
});
test('R27 (3b) : plus AUCUN terminal → le service part INACTIF (target null)', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim); // UNIQUE terminal (A) — pas de twoTerminals
  const [A] = sim.infra.terminals;
  const svc = buildBuilding(sim, 'cleaning', 350, 950);
  assert.equal(svc.target, A.id, 'avant : affecté à A');
  demolishBuilding(sim, A.id);
  assert.equal(sim.infra.terminals.length, 0, 'aucun terminal ne reste');
  assert.equal(svc.target, null, 'plus de terminal → target null (inactif, motif lisible)');
  // La vue UI dit « inactif » — pas de bonus fantôme.
  const v = assignmentView(sim);
  assert.ok(v.services.some((s) => s.id === svc.id && s.label === 'inactif'), 'la vue annonce « inactif »');
});
test('R27 (3c) : le choix EXPLICITE du joueur (inactif volontaire) n est JAMAIS écrasé', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A] = twoTerminals(sim);
  const svc = buildBuilding(sim, 'cleaning', 350, 950); // auto → A
  setAssignment(sim, svc.id, null); // le joueur met INACTIF volontaire
  assert.equal(svc.auto, false, 'choix joueur : auto=false');
  // ensureAssignments (migration / réaffectation) ne doit PAS réactiver un
  // inactif volontaire (le joueur a décidé) — même si un terminal existe.
  ensureAssignments(sim);
  assert.equal(svc.target, null, 'le choix volontaire n est PAS écrasé (target reste null)');
});

// (4) MIGRATION : une sauvegarde PRÉ-R27 (services SANS `target`) reçoit une
// affectation DÉTERMINISTE + annoncée (le nombre de services touchés > 0).
test('R27 (4) : migration des anciens services (sans target) — déterministe + annoncée', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A] = twoTerminals(sim);
  // Simule un service « pré-R27 » : posé SANS affectation (pas d autoAssign).
  // On le pose via placeBuilding (pas buildBuilding) pour contourner la règle.
  const legacy = placeBuilding(sim, { id: sim.infra.nextId++, type: 'cleaning', x: 350, y: 950, w: 80, h: 40, cost: 0 });
  assert.equal(legacy.target, undefined, 'service pré-R27 : aucun champ target');
  const n = ensureAssignments(sim);
  assert.ok(n >= 1, `migration annoncée : ${n} service(s) touché(s)`);
  assert.equal(legacy.target, A.id, 'affectation DÉTERMINISTE (terminal le plus proche = A)');
  assert.equal(legacy.auto, true, 'la migration applique la règle (auto) — réaffectable');
  // Idempotent : un 2e appel ne touche plus rien (déjà affecté + connu).
  assert.equal(ensureAssignments(sim), 0, 'migration idempotente (2e appel = 0)');
});

// (5) LES TYPES AU SOL CONNUS sont les SEULS à avoir un effet : un type
// inconnu (corruption / future carte) n a JAMAIS d'effet (pas de bonus
// gratuit dû à un bâtiment que la sim ne comprend pas).
test('R27 (5) : un type de service inconnu n a AUCUN effet (pas de bonus gratuit)', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A] = twoTerminals(sim);
  // Service de type inconnu affecté à A : il ne doit servir AUCUNE porte.
  const ghost = { id: sim.infra.nextId++, type: 'teleport', x: 0, y: 0, w: 1, h: 1, target: A.id, auto: true };
  sim.infra.services.push(ghost);
  assert.equal(servicesServingGate(sim, 'teleport', gatesOf(sim, A.id)[0]).length, 0,
    'type inconnu : 0 service servable (jamais de bonus gratuit)');
  // Le nettoyage réel (type connu) reste mesurable : 1 cleaning sur A.
  buildBuilding(sim, 'cleaning', 350, 950);
  assert.equal(servicesServingGate(sim, 'cleaning', gatesOf(sim, A.id)[0]).length, 1,
    'le type connu (cleaning) est bien mesuré');
  assert.ok(GROUND_SERVICE_TYPES.includes('cleaning'), 'cleaning est un type connu (catalogue)');
  assert.ok(!GROUND_SERVICE_TYPES.includes('teleport'), 'teleport n est pas un type connu');
});

// (6) VUE UI : l affectation + les capacités par terminal sont LUES (pas
// re-dérivées) — le panneau affiche ce que la sim sait (R27 : montrer clients
// desservis, capacité et coût).
test('R27 (6) : la vue UI lit l affectation + les capacités par terminal', () => {
  const sim = newSimState();
  buildSocle(sim); unlock(sim);
  const [A, B] = twoTerminals(sim);
  const cA = buildBuilding(sim, 'cleaning', 350, 950); // A
  const fB = buildBuilding(sim, 'fuel', 100, 300); // B (proche de B, terrain libre)
  assert.ok(fB, 'la station fuel est construite (emplacement libre)');
  assert.equal(fB.target, B.id, 'fuel affecté au plus proche (B)');
  const v = assignmentView(sim);
  assert.equal(v.services.length, 2, 'la vue liste les 2 services au sol');
  assert.equal(v.counts[A.id].cleaning, 1, `capacité A : 1 nettoyage`);
  assert.equal(v.counts[A.id].fuel, 0, `capacité A : 0 carburant`);
  assert.equal(v.counts[B.id].fuel, 1, `capacité B : 1 carburant`);
  assert.equal(v.counts[B.id].cleaning, 0, `capacité B : 0 nettoyage`);
  // Le coût d'exploitation est LISIBLE (catalogue) — le panneau le lit.
  assert.ok(OPEX_PER_SEC['cleaning'] > 0, 'le coût du nettoyage est positif (affichable)');
});
