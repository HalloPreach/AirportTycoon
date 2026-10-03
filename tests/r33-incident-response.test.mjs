// Tests R33 (t_11a4e241) : DEUX réponses opérationnelles par incident —
// une réponse PASSIVE (gratuite, on attend la fin naturelle) et une
// intervention COÛTEUSE / un allègement du planning (effet immédiat).
// VALIDATION (exigée par la carte) :
//   1. MÊME incident, deux réponses → durées/coûts/vols traités DIFFÉRENTS ;
//   2. une réponse devenue impossible renvoie un MOTIF SANS mutation partielle ;
//   3. l'action n'est PAS répétable (pas de cumul artificiel des effets) ;
//   4. les CONSÉQUENCES sont lues AVANT décision (incidentResponse, lecture
//      pure — aucune mutation).
// Zéro DOM, déterministe — même socle que les tests R32.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import {
  ensureIncidents, forceIncident, runwayClosed, tickIncidents,
  incidentResponse, respondIncident,
} from '../src/sim/incidents.mjs';

// Socle minimal (piste + taxiway + terminal + 1 station carburant), même
// forme que les tests R32 (l'incident est ATTACHÉ à un actif).
function buildSocle(sim) {
  sim.economy.money = 1000000;
  sim._unlocked = { fuel: true, cleaning: true, hangar: true, baggage: true, catering: true };
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 100, 200);
  rebuildGraph(sim);
}
// Avance la sim sans TIRAGE (rng à 0) : uniquement la fin naturelle.
function advance(sim, s) { for (let k = 0; k < s; k++) tickIncidents(sim, 1, () => 0); }

test('R33 (1) : MÊME incident, deux réponses → DURÉES et COÛTS différents (piste)', () => {
  // Réponse passive : la piste reste fermée jusqu'à la fin NATURELLE, zéro coût.
  const simA = newSimState(); buildSocle(simA);
  const rw = simA.infra.runways[0];
  forceIncident(simA, `runway:${rw.id}`);
  assert.ok(runwayClosed(simA, rw.id), 'piste fermée (incident actif)');
  const rec = ensureIncidents(simA).runways[String(rw.id)];
  const restants = rec.remaining;
  const moneyBefore = simA.economy.money;
  const r = respondIncident(simA, `runway:${rw.id}`, 'wait');
  assert.ok(r.ok, 'la réponse passive est ACCEPTÉE');
  assert.equal(simA.economy.money, moneyBefore, 'passive : AUCUN coût');
  assert.ok(runwayClosed(simA, rw.id), 'passive : la fermeture CONTINUE (fin naturelle)');
  advance(simA, restants + 1);
  assert.ok(!runwayClosed(simA, rw.id), 'passive : réouverture NATURELLE à la fin du délai');
  assert.equal(simA.economy.spent.intervention ?? 0, 0, 'aucune dépense intervention');

  // Réponse coûteuse : réouverture IMMÉDIATE, coût débité — durée et coût diffèrent.
  const simB = newSimState(); buildSocle(simB);
  const rwB = simB.infra.runways[0];
  forceIncident(simB, `runway:${rwB.id}`);
  const before = simB.economy.money;
  const rb = respondIncident(simB, `runway:${rwB.id}`, 'intervene');
  assert.ok(rb.ok, 'l\'intervention est ACCEPTÉE');
  assert.ok(!runwayClosed(simB, rwB.id), 'coûteuse : réouverture IMMÉDIATE (pas l\'attente)');
  assert.ok(before - simB.economy.money > 0, 'coûteuse : le solde est DÉBITÉ (pas 0 $)');
  assert.ok(simB.economy.spent.intervention > 0, 'la dépense est COMPTÉE (compte intervention)');
  // Les deux réponses ne traitent pas la même chose : A attend, B paie.
  assert.notEqual(simA.economy.money, simB.economy.money, 'coûts différents (0 $ vs payant)');
});

test('R33 (2) : MÊME incident, deux réponses → VOLs traités différents (panne station)', () => {
  // Passive : la station reste HS (départs secs) jusqu'au retour du service.
  const simA = newSimState(); buildSocle(simA);
  const st = simA.infra.services.find((s) => s.type === 'fuel');
  forceIncident(simA, `fuel:${st.id}`);
  assert.ok(st.fuelOut, 'la station est en panne');
  assert.ok(respondIncident(simA, `fuel:${st.id}`, 'wait').ok, 'réponse passive acceptée');
  assert.ok(st.fuelOut, 'passive : la panne CONTINUE (les lances restent HS)');
  advance(simA, 999); // fin naturelle de la panne (90 s)
  assert.ok(!st.fuelOut, 'passive : le service REVIENT à la fin naturelle');

  // Coûteuse : station ACTIVE immédiatement (les pleins sont normaux tout de suite).
  const simB = newSimState(); buildSocle(simB);
  const stB = simB.infra.services.find((s) => s.type === 'fuel');
  forceIncident(simB, `fuel:${stB.id}`);
  assert.ok(respondIncident(simB, `fuel:${stB.id}`, 'intervene').ok, 'intervention acceptée');
  assert.ok(!stB.fuelOut, 'coûteuse : la station est ACTIVE IMMÉDIATEMENT (pas d\'attente)');
  assert.ok(simB.economy.spent.intervention > 0, 'le coût de l\'intervention est payé');
});

test('R33 (3) : pic de demande — absorbation (passive) vs allègement du planning (vols traités)', () => {
  // Vols planifiés (la ressource que l'allègement CONSOLE).
  function withPlanned(sim) {
    sim.planning = [
      { id: 101, status: 'planned', planned: (sim.time ?? 0) + 60, airline: 'A', acType: 'S' },
      { id: 102, status: 'planned', planned: (sim.time ?? 0) + 120, airline: 'A', acType: 'M' },
      { id: 103, status: 'accepted', planned: (sim.time ?? 0) + 30, airline: 'A', acType: 'S' },
    ];
  }
  // Passive : le pic CONTINUE, les vols planifiés restent traitables.
  const simA = newSimState(); buildSocle(simA); withPlanned(simA);
  forceIncident(simA, 'surge');
  assert.ok(respondIncident(simA, 'surge', 'absorb').ok, 'absorption acceptée');
  assert.ok(simA.planning.length === 3, 'passive : les 3 vols du planning sont INTACTS');
  assert.ok(simA.incidents.surge.active, 'passive : le pic CONTINUE (effet mesurable)');

  // Allègement : les vols PLANIFIÉS sont refusés (le revenu est perdu),
  // les vols ACCEPTÉS (déjà engagés) restent — les files se vident.
  const simB = newSimState(); buildSocle(simB); withPlanned(simB);
  forceIncident(simB, 'surge');
  const rb = respondIncident(simB, 'surge', 'relief');
  assert.ok(rb.ok, 'l\'allègement est ACCEPTÉ');
  assert.equal(simB.planning.length, 1, 'seul le vol ACCEPTÉ reste (les planned sont refusés)');
  assert.equal(simB.planning[0].id, 103, 'le vol accepté n\'est PAS touché');
  assert.ok(simB.alerts.some((a) => a.kind === 'planning-relief'), 'l\'événement allègement est LISIBLE');
});

test('R33 (4) : les CONSÉQUENCES sont lues AVANT décision (lecture pure, sans mutation)', () => {
  const sim = newSimState(); buildSocle(sim);
  const rw = sim.infra.runways[0];
  forceIncident(sim, `runway:${rw.id}`);
  const v1 = incidentResponse(sim, `runway:${rw.id}`);
  assert.ok(v1.ok, 'la lecture est disponible pendant l\'incident');
  assert.equal(v1.responses.length, 2, 'DEUX réponses offertes (pas plus — vrai arbitrage)');
  const [w, iv] = v1.responses;
  assert.equal(w.id, 'wait');
  assert.equal(iv.id, 'intervene');
  assert.equal(w.cost, 0, 'la réponse passive est GRATUITE');
  assert.ok(iv.cost > 0, 'l\'intervention est COÛTEUSE');
  assert.ok(w.effect.includes('s'), 'la conséquence de l\'attente est LISIBLE (délée)');
  assert.ok(/IMM/i.test(iv.effect), 'la conséquence de l\'intervention est LISIBLE (immédiat)');
  // LECTURE pure : deux appels identiques, AUCUNE mutation de la sim.
  const money = sim.economy.money;
  const rec = sim.incidents.runways[String(rw.id)];
  const rem = rec.remaining;
  const v2 = incidentResponse(sim, `runway:${rw.id}`);
  assert.equal(sim.economy.money, money, 'aucun coût à la lecture');
  assert.equal(sim.incidents.runways[String(rw.id)].remaining, rem, 'aucun compte à rebours à la lecture');
  assert.deepEqual(v2.responses.map((x) => x.id), v1.responses.map((x) => x.id), 'lecture STABLE');
});

test('R33 (5) : réponse IMPOSSIBLE → motif lisible, SANS mutation partielle', () => {
  const sim = newSimState(); buildSocle(sim);
  const baseMoney = sim.economy.money; // le socle coûte (construction) — base mesurée après
  const rw = sim.infra.runways[0];
  // Cible inconnue : motif, aucun effet.
  let r = respondIncident(sim, 'runway:999', 'intervene');
  assert.ok(!r.ok && r.reason, 'cible inconnue → MOTIF lisible');
  // Incident inexistant : motif, solde intact.
  r = respondIncident(sim, `runway:${rw.id}`, 'intervene');
  assert.ok(!r.ok && r.reason, 'aucun incident → motif (rien à faire)');
  assert.equal(sim.economy.money, baseMoney, 'aucun débit sans incident');
  // Réponse inconnue sur incident ACTIF : motif, le record est INTACT.
  forceIncident(sim, `runway:${rw.id}`);
  const before = sim.economy.money;
  r = respondIncident(sim, `runway:${rw.id}`, 'bogus');
  assert.ok(!r.ok, 'réponse inconnue → refus');
  assert.equal(sim.economy.money, before, 'AUCUNE mutation partielle (pas de débit)');
  assert.ok(sim.incidents.runways[String(rw.id)], 'le record d\'incident est INTACT');
  assert.ok(runwayClosed(sim, rw.id), 'la fermeture est INTACTE (pas d\'effet à moitié)');
});

test('R33 (6) : l\'action n\'est PAS répétable (pas de cumul artificiel des effets)', () => {
  const sim = newSimState(); buildSocle(sim);
  const rw = sim.infra.runways[0];
  forceIncident(sim, `runway:${rw.id}`);
  assert.ok(respondIncident(sim, `runway:${rw.id}`, 'intervene').ok, '1re intervention : acceptée');
  assert.ok(!runwayClosed(sim, rw.id), 'la piste est réouverte');
  const spentAfterFirst = sim.economy.spent.intervention;
  const again = respondIncident(sim, `runway:${rw.id}`, 'intervene');
  assert.ok(!again.ok && again.reason, '2e intervention sur incident FINI → MOTIF');
  assert.equal(sim.economy.spent.intervention, spentAfterFirst, 'pas de second débit');
  // Allègement du pic : 2e appel → plus rien à refuser (motif, pas de mutation).
  forceIncident(sim, 'surge');
  sim.planning = [{ id: 201, status: 'planned', planned: 60, airline: 'A', acType: 'S' }];
  assert.ok(respondIncident(sim, 'surge', 'relief').ok, '1er allègement : accepté');
  const empty = respondIncident(sim, 'surge', 'relief');
  assert.ok(!empty.ok && /allég/i.test(empty.reason), '2e allègement → MOTIF (rien à refuser)');
});
