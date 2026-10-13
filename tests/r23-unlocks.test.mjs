// R23 (t_c992b7d6) — déblocages des services par CONDITIONS MESURABLES.
// Vérifications (zéro DOM, déterministe — zéro navigateur) :
//   1. État neuf : les 5 services sont verrouillés ; unlockView affiche pour
//      chacun le BÉNÉFICE + la condition restante (pas un simple seuil pax).
//   2. fuel : se débloque AVANT que le besoin se fasse sentir — une offre de
//      vol en vue (planning non vide) suffit (la période close net ≥ 0 est
//      vraie par défaut) ; l'événement « unlocked » porte le bénéfice ET la
//      note de ponctualité (la mesure du R17, pas un compteur de temps).
//   3. Pas de double notification : tickUnlocks tourne N fois → UN seul
//      événement par service (le flag sim._unlocked est persistant).
//   4. usure porte : g.cleaning ≥ 10 → « cleaning » (le nettoyage) ;
//      g.maintenance ≥ 10 → « hangar » (la maintenance) — chaque usure est
//      lue via SON champ sérialisé (pas d'état parallèle).
//   5. volumes : file check-in ≥ 90 OU 400 pax transportés → « baggage » ;
//      300 pax transportés → « catering ».
//   5bis (T33, t_88aee6d5) : file sécurité ≥ 96 OU 600 pax transportés →
//      « security » ; 400 pax → « dutyfree » ; 500 pax → « lounge ».
//   6. buildBuilding refuse un service verrouillé (événement « locked » avec
//      le bénéfice + la condition) et l'accepte une fois débloqué — la
//      décision est le MÊME code des deux côtés (unlockState).
//   7. Persistance : serialize → deserialize conserve sim._unlocked — la
//      reprise ne re-notifie pas les services déjà débloqués (EV-10).
//   8. Pas de dépendance circulaire : aucune condition ne fait référence à un
//      service non encore débloqué (on ne demande jamais de maintenir un
//      service pour le débloquer) — les conditions 2-5 ci-dessus s'évaluent
//      sur une sim SANS AUCUN service construit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { UNLOCK_RULES } from '../src/data/catalog.mjs';
import { buildBuilding, tickUnlocks } from '../src/infra/infra.mjs';
import { unlockState, unlockView } from '../src/infra/unlocks.mjs';
import { closePeriod } from '../src/economy/economy.mjs';
import { logFlightEnd } from '../src/sim/aircraft.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

const SERVICES = Object.freeze(Object.keys(UNLOCK_RULES)); // fuel, cleaning, hangar, baggage, catering

// Un état « neuf » : ni offre en vue, ni avion, ni usure, ni volumes → les 5
// services sont verrouillés.
function freshSim() {
  return newSimState();
}

// Une porte usée (les champs SÉRIALISÉS g.cleaning / g.maintenance, sim-state).
function wornGate(sim, cleaning = 0, maintenance = 0) {
  sim.infra.gates.push({ id: 1, size: 'M', terminalId: 1, cleaning, maintenance });
}

// Une offre de vol en vue (le planning non vide = l'activité va servir des vols).
function addOffer(sim) {
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium',
    pax: 100, planned: (sim.time ?? 0) + 60, status: 'planned' });
}

test('R23 : état neuf — les 5 services sont verrouillés, bénéfice + condition affichés', () => {
  const sim = freshSim();
  for (const s of SERVICES) {
    assert.equal(unlockState(sim, s).unlocked, false, `${s} verrouillé au départ`);
  }
  const view = unlockView(sim);
  assert.equal(view.length, 8, 'les 8 services verrouillés sont listés');
  for (const s of SERVICES) {
    const line = view.find((l) => l.startsWith(UNLOCK_RULES[s].name));
    assert.ok(line, `${UNLOCK_RULES[s].name} est affiché`);
    assert.ok(line.includes(UNLOCK_RULES[s].benefit), `${s} : le BÉNÉFICE est affiché`);
    assert.ok(line.includes(UNLOCK_RULES[s].why), `${s} : la CONDITION restante est affichée`);
  }
});

test('R23 : fuel se débloque AVANT le besoin (offre en vue) + note de ponctualité', () => {
  const sim = freshSim();
  tickUnlocks(sim); // rien : pas d'offre, pas d'avion
  assert.equal(unlockState(sim, 'fuel').unlocked, false, 'fuel verrouillé sans activité');
  addOffer(sim);
  logFlightEnd(sim, { id: sim.nextAcId++, acType: 'medium', delayed: 0 }, false); // vol ponctuel (mesure R17)
  tickUnlocks(sim);
  assert.equal(unlockState(sim, 'fuel').unlocked, true, 'fuel débloqué dès l’offre en vue');
  const evt = sim.alerts.find((a) => a.kind === 'unlocked' && a.service === 'fuel');
  assert.ok(evt, 'événement « unlocked » émis');
  assert.ok(evt.why.includes(UNLOCK_RULES.fuel.benefit), 'le BÉNÉFICE est dans l’événement');
  assert.ok(evt.detail?.includes('100 %'), `la ponctualité est mesurée (${evt.detail})`);
  // Un seul événement malgré 5 ticks supplémentaires (idempotent).
  for (let i = 0; i < 5; i++) tickUnlocks(sim);
  assert.equal(sim.alerts.filter((a) => a.kind === 'unlocked' && a.service === 'fuel').length, 1,
    'pas de double notification');
});

test('R23 : l’usure porte débloque CHAQUE service de sa propre usure', () => {
  const sim = freshSim();
  wornGate(sim, 10, 0); // usure « sale » seulement
  tickUnlocks(sim);
  assert.equal(unlockState(sim, 'cleaning').unlocked, true, 'g.cleaning ≥ 10 → nettoyage débloqué');
  assert.equal(unlockState(sim, 'hangar').unlocked, false, 'le hangar attend l’usure mécanique');
  wornGate(sim, 0, 10); // une 2e porte, usure mécanique seulement
  tickUnlocks(sim);
  assert.equal(unlockState(sim, 'hangar').unlocked, true, 'g.maintenance ≥ 10 → hangar débloqué');
});

test('R23 : les VOLUMES justifient le débit (baggage) et le confort (catering)', () => {
  const sim = freshSim();
  sim.passengers.totalCarried = 400; // les volumes cumulés (branche « carried »)
  tickUnlocks(sim);
  assert.equal(unlockState(sim, 'baggage').unlocked, true, '400 pax transportés → bagages');
  assert.equal(unlockState(sim, 'catering').unlocked, true, '400 ≥ 300 pax → restauration');

  const sim2 = freshSim();
  // R30 : la file check-in est PAR TERMINAL — queueTotals (la condition de
  // déblocage bagages) somme les queues[terminalId]. Un terminal SANS infra
  // (freshSim, pas de terminal construit) porte une file sur une key
  // synthétique ; queueTotals l'additionne sans requérir le terminal dans
  // infra.terminals (la règle est globale, les files sont per-terminal).
  sim2.passengers.queues['t1'] = { checkin: 90, security: 0, board: 0 }; // le goulou de base se voit (75 % de la capacité 120)
  tickUnlocks(sim2);
  assert.equal(unlockState(sim2, 'baggage').unlocked, true, 'file check-in ≥ 90 → bagages');

  const sim3 = freshSim();
  sim3.passengers.queues['t1'] = { checkin: 89, security: 0, board: 0 }; // sous le seuil → verrouillé
  sim3.passengers.totalCarried = 299; // sous les 300 pax → verrouillé
  tickUnlocks(sim3);
  assert.equal(unlockState(sim3, 'baggage').unlocked, false, 'sous les seuils : bagages verrouillé');
  assert.equal(unlockState(sim3, 'catering').unlocked, false, 'sous 300 pax : restauration verrouillée');
});

test('R23/T33 : les 3 NOUVEAUX services se débloquent par volumes (sécurité / boutiques / salon)', () => {
  const sim = freshSim();
  assert.equal(unlockState(sim, 'security').unlocked, false, 'sécurité verrouillée au départ');
  assert.equal(unlockState(sim, 'dutyfree').unlocked, false, 'boutiques verrouillées au départ');
  assert.equal(unlockState(sim, 'lounge').unlocked, false, 'salon verrouillé au départ');

  // La branche « carried » : les VOLUMES cumulés justifient chaque service.
  sim.passengers.totalCarried = 400; // → boutiques (400)
  assert.equal(unlockState(sim, 'dutyfree').unlocked, true, '400 pax transportés → boutiques');
  assert.equal(unlockState(sim, 'lounge').unlocked, false, 'le salon attend 500 pax');
  assert.equal(unlockState(sim, 'security').unlocked, false, 'la sécurité attend 600 pax (ou file)');
  sim.passengers.totalCarried = 500; // → salon (500)
  assert.equal(unlockState(sim, 'lounge').unlocked, true, '500 pax transportés → salon VIP');
  sim.passengers.totalCarried = 600; // → sécurité (600)
  assert.equal(unlockState(sim, 'security').unlocked, true, '600 pax transportés → sécurité');

  // OU la file sécurité ≥ 96 (queueTotals global, R30) sans volume :
  const sim2 = freshSim();
  sim2.passengers.queues['t1'] = { checkin: 0, security: 96, board: 0 };
  assert.equal(unlockState(sim2, 'security').unlocked, true, 'file sécurité 96 → sécurité débloquée');
  sim2.passengers.queues['t1'].security = 95;
  assert.equal(unlockState(sim2, 'security').unlocked, false, 'file sécurité 95 < 96 → verrouillée');
});

test('R23 : buildBuilding refuse (bénéfice + condition) puis accepte après déverrouillage', () => {
  const sim = freshSim();
  assert.equal(buildBuilding(sim, 'catering', 300, 300), null, 'refusé tant que verrouillé');
  const locked = sim.alerts.find((a) => a.kind === 'locked' && a.type === 'catering');
  assert.ok(locked, 'événement « locked » émis');
  assert.ok(locked.why.includes(UNLOCK_RULES.catering.why), 'le refus cite la CONDITION restante');
  assert.ok(locked.why.includes(UNLOCK_RULES.catering.benefit), 'le refus cite le BÉNÉFICE (pourquoi acheter)');
  sim.passengers.totalCarried = 300; // condition satisfaite
  assert.ok(buildBuilding(sim, 'catering', 300, 300), 'accepté une fois la condition vraie');
  assert.ok(sim.infra.services.some((s) => s.type === 'catering'), 'la salle est posée');
});

test('R23 : les 8 services débloqués en un tick — UN événement par service', () => {
  const sim = freshSim();
  addOffer(sim); // fuel (offre en vue)
  wornGate(sim, 10, 10); // cleaning + hangar
  sim.passengers.queues['t1'] = { checkin: 90, security: 0, board: 0 }; // baggage (R30 : file PAR TERMINAL)
  sim.passengers.totalCarried = 600; // T33 : les 8 volumes (baggage/catering/dutyfree/lounge/security)
  tickUnlocks(sim);
  for (const s of SERVICES) assert.equal(unlockState(sim, s).unlocked, true, `${s} débloqué`);
  tickUnlocks(sim); tickUnlocks(sim); // idempotent
  const evts = sim.alerts.filter((a) => a.kind === 'unlocked');
  assert.equal(evts.length, 8, 'huit événements, UN par service (pas de double toast)');
  assert.deepEqual(evts.map((e) => e.service).sort(), [...SERVICES].sort(), 'les 8 services signalés');
  // Pas de « locked » émis par tickUnlocks (ce n'est pas son rôle).
  assert.equal(sim.alerts.filter((a) => a.kind === 'locked').length, 0, 'tickUnlocks ne verrouille pas');
});

test('R23 : la reprise de sauvegarde ne re-notifie PAS (flag persistant, EV-10)', () => {
  const sim = freshSim();
  addOffer(sim); // fuel
  wornGate(sim, 10, 10); // cleaning + hangar
  sim.passengers.totalCarried = 600; // T33 : les 8 volumes
  tickUnlocks(sim); // 8 services débloqués
  const before = sim.alerts.filter((a) => a.kind === 'unlocked').length;
  assert.equal(before, 8, 'huit événements avant la sauvegarde');
  const state = { screen: 'game', time: 0, terrain: null, camera: null, sim };
  const sim2 = deserialize(serialize(state)).sim;
  for (const s of SERVICES) assert.equal(sim2._unlocked[s], true, `${s} persiste dans la sauvegarde`);
  tickUnlocks(sim2); // le tick post-reprise
  assert.equal(sim2.alerts.filter((a) => a.kind === 'unlocked').length, 8,
    'la reprise ne re-notifie pas (les 8 événements viennent de la sim d’origine)');
});

test('R23 : aucune condition ne fait référence à un service non débloqué (pas de cercle)', () => {
  // Les 8 conditions s’évaluent sur une sim SANS AUCUN service construit :
  // le joueur n’est jamais tenu de « maintenir un service verrouillé » pour
  // en débloquer un autre (critère de la carte R23).
  const sim = freshSim();
  assert.equal(sim.infra.services.length, 0, 'aucun service construit');
  addOffer(sim);
  wornGate(sim, 10, 10);
  sim.passengers.queues['t1'] = { checkin: 90, security: 0, board: 0 }; // R30 : file PAR TERMINAL
  sim.passengers.totalCarried = 600; // T33 : les 8 volumes
  for (const s of SERVICES) {
    assert.equal(unlockState(sim, s).unlocked, true, `${s} : condition atteignable sans autre service`);
  }
});
