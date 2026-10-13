// T3 (t_4c9baadc) — la COUCHE D'ÉVÉNEMENTS DYNAMIQUES (src/sim/events.mjs) :
// des événements (conférence / affrètement / pic touristique) injectent du
// travail dans la sim PAR LES MODULES EXISTANTS (planOneFlight pour les vols,
// l'état incidents pour le pic), avec une cadence bornée et reproductible
// (PRNG semé + compteurs sérialisés sur sim.events, EV-10) :
//   1. TABLE : 3 entrées (pas un système de paramétrage), cadence bornée
//      (EVENT_EVERY_S / EVENT_PROB), durée du pic = source unique (scenarios).
//   2. DÉCLENCHER : fenêtre bornée (compteur acc préservé aux grands pas dt,
//      la fenêtre est ni sautée ni dupliquée), un tirage par fenêtre ;
//      l'effet est injecté par les modules existants (marqueur `event` lisible
//      sur l'offre, alerte `event-start` annoncée).
//   3. INTERACTION AVEC LES INCIDENTS : si un pic est déjà en cours,
//      l'événement le RENFORÇE (remaining += durée, jamais un reset) —
//      mesurable, expliqué dans l'alerte.
//   4. REPRODUCTIBILITÉ + SAUVEGARDE : l'état vit sur sim.events (sérialisé
//      seul) — le round-trip survit, les sauvegardes PRÉ-T3 (champ absent)
//      sont re-attachées par ensureEvents (pas de crash au 1er tick), un
//      champ PRÉSENT mais de mauvais type est REJETÉ avec une erreur lisible
//      (pattern R41). La boucle de production (tick.mjs) déclenche les
//      événements sans casser la sim.
// Zéro DOM : SFX/juice sont lus dans leurs modules purs (audio.mjs, juice.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { forceIncident, isSurge } from '../src/sim/incidents.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { SATURATION_SURGE_S } from '../src/scenarios.mjs';
import { AIRCRAFT } from '../src/data/catalog.mjs';
import { sfxForAlert } from '../src/audio.mjs';
import { makeJuice, juiceForAlert } from '../src/ui/juice.mjs';
import { EVENTS, EVENT_EVERY_S, EVENT_PROB, ensureEvents, tickEvents } from '../src/sim/events.mjs';

// Socle « bien conçu » (géométrie prouvée) — mêmes coordonnées que
// tests/incidents.test.mjs : l'infrastructure est servable (piste + portes),
// planOneFlight peut donc réellement injecter des vols.
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}
// R23 : services DÉJÀ DÉBLOQUÉS (état mi-jeu) — le flag persistant sim._unlocked
// court-circuite les conditions mesurables (le test porte sur les ÉVÉNEMENTS,
// pas sur les déblocages).
function unlock(sim) {
  sim.economy.money = 100000;
  sim._unlocked = { fuel: true, cleaning: true, hangar: true, baggage: true, catering: true };
}

test('T3 (1) : la table expose 3 événements (des ENTRÉES, pas un paramétrage) + cadence bornée', () => {
  assert.deepEqual(Object.keys(EVENTS), ['conference', 'charter', 'tourism'],
    'les 3 événements de la table (une entrée par événement)');
  for (const id of Object.keys(EVENTS)) {
    assert.ok(EVENTS[id].name, `(${id}) le nom est lisible (l'UI l'affiche)`);
    assert.ok(EVENTS[id].why, `(${id}) la raison est lisible`);
  }
  assert.equal(EVENTS.conference.paxRatio, 1.0, 'conférence = vol PLEIN (fraction explicite des sièges)');
  assert.equal(EVENTS.charter.flights, 2, 'affrètement = UNE SÉRIE de 2 vols (pas un vol seul)');
  assert.equal(EVENTS.tourism.surgeS, SATURATION_SURGE_S,
    'la durée du pic = la valeur explicite de scenarios.mjs (source unique, jamais dupliquée)');
  assert.ok(EVENT_EVERY_S > 0 && EVENT_PROB > 0 && EVENT_PROB <= 1, 'la cadence est bornée (fenêtre + probabilité)');
});

test('T3 (2) : ensureEvents — migration idempotente (absent → défauts, corrompu → normalisé)', () => {
  const sim = newSimState();
  // Le champ ABSENT (sauvegarde pré-T3) : re-attaché aux valeurs par défaut.
  delete sim.events;
  const ev = ensureEvents(sim);
  assert.deepEqual(ev, { acc: 0, last: 0, seq: 0, fired: {} }, 'champ re-attaché (pas de crash au 1er tick)');
  // Les compteurs CORROMPUS sont normalisés (la fenêtre démarre à 0, le
  // tirage ne plante pas — même pattern que les migrations R41).
  sim.events = { acc: 'x', last: null, seq: -1, fired: { tourism: 'y', charter: -3 } };
  const ev2 = ensureEvents(sim);
  assert.deepEqual(ev2, { acc: 0, last: 0, seq: 0, fired: { tourism: 0, charter: 0 } }, 'compteurs normalisés (bornés)');
});

test('T3 (3) : la conférence injecte un vol PLEIN via planOneFlight (mécanisme EXISTANT)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  // rng constant 0.3 : le tirage réussit (0.3 < 0.5) et le choix = index 0
  // (floor(0.3×3) = 0 → conférence) — déterministe.
  tickEvents(sim, EVENT_EVERY_S, () => 0.3);
  assert.equal(sim.events.seq, 1, 'un événement déclenché (compteur persistant + lisible)');
  assert.equal(sim.events.fired.conference, 1, 'le compteur PAR événement est tenu (lecture)');
  const entries = sim.planning.filter((e) => e.event === 'conference');
  assert.equal(entries.length, 1, 'UNE offre injectée dans le planning (marqueur `event` lisible)');
  const e = entries[0];
  assert.equal(e.status, 'planned', "l'offre est dans l'état décisionnable EXISTANT (pas de 2e règle de vol)");
  assert.equal(e.pax, AIRCRAFT[e.acType].seats, 'vol PLEIN : 100 % des sièges (fraction explicite de la table)');
  assert.equal(e.planned, sim.time + 60, 'l\'heure prévue est explicite (+60 s, pas le spawn standard)');
  assert.ok(sim.alerts.some((a) => a.kind === 'event-start' && a.event === 'conference'),
    "l'événement est ANNONCÉ (alerte lisible, l'UI la consomme)");
  assert.equal(decideFlight(sim, e.id, true), true, 'l\'offre injectée est DÉCISIBLE (mécanisme existant du planificateur)');
  assert.equal(sim.planning.find((p) => p.id === e.id).status, 'accepted', 'l\'acceptation suit le chemin EXISTANT (déploiement à l\'heure prévue)');
});

test('T3 (4) : l\'affrètement injecte UNE SÉRIE de 2 offres (70 % des sièges, espacées)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  // rng constant 0.35 : le tirage réussit (0.35 < 0.5) et le choix = index 1
  // (floor(0.35×3) = 1 → charter).
  tickEvents(sim, EVENT_EVERY_S, () => 0.35);
  assert.equal(sim.events.fired.charter, 1, 'l\'affrètement est compté');
  const entries = sim.planning.filter((e) => e.event === 'charter');
  assert.equal(entries.length, 2, 'la SÉRIE est injectée (2 vols, pas 1)');
  const [a, b] = entries;
  assert.equal(a.pax, Math.round(AIRCRAFT[a.acType].seats * 0.7), 'la charge est explicite (70 % des sièges)');
  assert.equal(b.pax, Math.round(AIRCRAFT[b.acType].seats * 0.7), 'charge explicite (les 2 vols)');
  assert.equal(a.planned, sim.time + 60, 'la 1re offre est à +60 s');
  assert.equal(b.planned, sim.time + 60 + 90, 'la 2e offre est ESPACÉE (+150 s, pas 2 vols en même temps)');
  assert.ok(sim.alerts.some((x) => x.kind === 'event-start' && x.event === 'charter'), 'l\'événement est ANNONCÉ');
});

test('T3 (5) : le pic touristique injecte l\'incident de DEMANDE via incidents.mjs (durée explicite)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  // rng en SÉQUENCE [0.3, 0.9] : le tirage (1er appel) réussit, le choix
  // (2e appel) = index 2 (floor(0.9×3) = 2 → tourism).
  const seq = [0.3, 0.9]; let i = 0; const rng = () => seq[i++ % seq.length];
  tickEvents(sim, EVENT_EVERY_S, rng);
  assert.equal(sim.events.fired.tourism, 1, 'le pic est compté');
  assert.ok(isSurge(sim), 'le pic de demande est ACTIF (l\'incident EXISTANT — tickIncidents le fait avancer)');
  assert.equal(sim.incidents.surge.remaining, SATURATION_SURGE_S, 'la durée est EXPLICITE (scenarios.mjs — source unique)');
  assert.ok(sim.alerts.some((a) => a.kind === 'event-start' && a.event === 'tourism'), 'l\'événement est ANNONCÉ');
  assert.ok(sim.alerts.some((a) => a.kind === 'event-start' && a.why === EVENTS.tourism.why), 'la Raison est lisible (table)');
});

test('T3 (6) : interaction avec un incident — pic EN COURS : l\'événement RENFORÇE (pas un reset)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  forceIncident(sim, 'surge'); // l\'incident naturel (action EXISTANTE, tests R33)
  assert.ok(isSurge(sim), 'le pic est ACTIF (incident naturel)');
  sim.incidents.surge.remaining = 50; // il reste 50 s au pic en cours
  const seq = [0.3, 0.9]; let i = 0; const rng = () => seq[i++ % seq.length];
  tickEvents(sim, EVENT_EVERY_S, rng);
  assert.equal(sim.incidents.surge.remaining, 50 + SATURATION_SURGE_S,
    'renforcement : le pic se PROLONGE d\'autant (remaining += durée, l\'horloge en cours n\'est PAS réinitialisée)');
  const a = sim.alerts.find((x) => x.kind === 'event-start' && x.event === 'tourism');
  assert.ok(a.why.includes('renforce'), 'le renforcement est EXPLIQUÉ dans l\'alerte (lecture lisible)');
});

test('T3 (7) : cadence bornée — compteur acc PRESERVÉ aux grands pas (fenêtre ni sautée ni dupliquée)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  // rng constant 0.3 : chaque fenêtre tirée = conférence (déterministe).
  tickEvents(sim, 1000, () => 0.3); // 1000 s = 2 fenêtres COMPLÈTES (480×2 = 960) + 40 s restants
  assert.equal(sim.events.seq, 2, '2 événements (2 fenêtres complètes — un pas de 1000 s ne SAUTE PAS la 3e)');
  assert.equal(sim.events.acc, 1000 - 2 * EVENT_EVERY_S, 'le reste de la fenêtre est PRESERVÉ (40 s)');
  tickEvents(sim, 440, () => 0.3); // 40 + 440 = 480 : la 3e fenêtre se COMPLÈTE
  assert.equal(sim.events.seq, 3, 'la 3e événement se déclenche quand la fenêtre se complète');
  assert.equal(sim.events.acc, 0, 'la fenêtre repart à 0');
  // Un tirage RATÉ consomme sa fenêtre (comme les horloges incidents) : pas de
  // re-tirage, la fenêtre suivante est la suivante.
  const sim2 = newSimState(); buildSocle(sim2); unlock(sim2);
  tickEvents(sim2, EVENT_EVERY_S, () => 0.9); // tirage 0.9 >= 0.5 : la fenêtre est consommée, rien ne se passe
  assert.equal(sim2.events.seq, 0, 'le tirage raté ne déclenche rien (probabilité bornée)');
  assert.equal(sim2.events.acc, 0, 'la fenêtre ratée est consommée (pas de re-tirage en boucle)');
  tickEvents(sim2, EVENT_EVERY_S, () => 0.3); // la fenêtre SUIVANTE réussit
  assert.equal(sim2.events.seq, 1, 'la fenêtre suivante tire normalement (fenêtres indépendantes)');
});

test('T3 (8) : la boucle de PRODUCTION (tick.mjs) déclenche les événements sans casser la sim', () => {
  const state = makeGameState();
  const sim = state.sim;
  buildSocle(sim); unlock(sim);
  state.screen = 'game';
  // rng constant 0.3 : la fenêtre (480 s) réussit → conférence. La politique de
  // décision est DOCUMENTÉE (accepter les vols planifiés, comme la case
  // auto-accept du jeu) — la sim reste saine (pas de faillite).
  const rng = () => 0.3;
  for (let t = 0; t < 481; t++) {
    for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true);
    tick(state, 1, rng);
  }
  assert.equal(sim.events.seq, 1, 'la couche s\'est déclenchée DANS la boucle de production (1 fenêtre en 481 s)');
  assert.equal(sim.events.fired.conference, 1, 'c\'est bien la conférence (choix déterministe du rng constant)');
  assert.ok(sim.planning.some((e) => e.event === 'conference'), 'l\'offre injectée est dans le planning (lecture)');
  assert.ok(Number.isFinite(sim.economy.money), 'la sim reste saine (solde fini — invariants du harnais)');
  assert.ok(sim.economy.money > -10000, 'pas de faillite (la sim n\'est pas gelée)');
});

test('T3 (9) : sauvegarde — l\'état des événements SURVIT au round-trip (compteurs sérialisés, EV-10)', () => {
  const state = makeGameState();
  const sim = state.sim;
  buildSocle(sim); unlock(sim);
  state.screen = 'game';
  tickEvents(sim, EVENT_EVERY_S, () => 0.3); // 1 conférence (seq 1, acc 0)
  sim.events.acc = 123; // une fenêtre PARTIELLE (le joueur ferme en cours de fenêtre)
  const back = deserialize(serialize(state));
  assert.equal(back.sim.events.seq, 1, 'le compteur GLOBAL survit au load');
  assert.equal(back.sim.events.fired.conference, 1, 'le compteur PAR événement survit');
  assert.equal(back.sim.events.acc, 123, 'la fenêtre PARTIELLE survit (pas de re-tirage dupliqué)');
  assert.equal(back.sim.events.last, sim.events.last, 'le temps du dernier événement survit');
  // La couche REPREND après le load : la fenêtre partielle (123 s) se complète
  // après 480−123 s supplémentaires — le tirage continue (reproductible).
  tickEvents(back.sim, EVENT_EVERY_S - 123, () => 0.3);
  assert.equal(back.sim.events.seq, 2, 'le tirage CONTINUE après rechargement (la fenêtre complète se déclenche)');
  assert.equal(back.sim.events.acc, 0, 'la fenêtre a été consommée (pas de dupliqué)');
});

test('T3 (10) : sauvegarde PRÉ-T3 — champ sim.events ABSENT : migration silencieuse (ensureEvents)', () => {
  const state = makeGameState();
  const sim = state.sim;
  buildSocle(sim); unlock(sim);
  state.screen = 'game';
  tickEvents(sim, EVENT_EVERY_S, () => 0.3); // un état qui a vécu (seq 1)
  const raw = JSON.parse(serialize(state));
  delete raw.state.sim.events; // la sauvegarde PRÉ-T3 n\'a PAS le champ (comme upgrades/incidents pré-migration)
  const back = deserialize(JSON.stringify(raw));
  assert.deepEqual(back.sim.events, { acc: 0, last: 0, seq: 0, fired: {} },
    'le champ est RE-ATTACHÉ par défaut (la partie ancienne reprend, pas de crash au 1er tick)');
  tickEvents(back.sim, EVENT_EVERY_S, () => 0.3); // la couche FONCTIONNE après migration
  assert.equal(back.sim.events.seq, 1, 'le tirage fonctionne sur la partie migrée (pas d\'état fantôme)');
});

test('T3 (11) : sauvegarde corrompue — sim.events PRÉSENT mais de mauvais type : REJET lisible (pattern R41)', () => {
  const state = makeGameState();
  state.sim.events = 'corrompu'; // PRÉSENT mais non-objet : il serait ÉCRASÉ silencieusement sans le contrôle
  assert.throws(() => deserialize(serialize(state)), /sim\.events/,
    'l\'erreur nomme le champ fautif (lisible — l\'UI peut l\'annoncer, la sauvegarde est préservée)');
  state.sim.events = 42; // un nombre = même classe de défaut
  assert.throws(() => deserialize(serialize(state)), /sim\.events/, 'tous les types non-objets sont refusés');
});

test('T3 (12) : le câblage EXISTANT consomme l\'alerte event-start (SFX + juice — pas de 2e chemin de feedback)', () => {
  assert.equal(sfxForAlert('event-start'), 'event', 'le SFX est branché sur l\'alerte (audio.mjs — le même que les incidents)');
  // juiceForAlert est PUR (Node) : on le pilote avec une juice factice et une
  // sim minimale (lecture seule des champs de l\'alerte).
  const j = makeJuice({ rng: () => 0.5 });
  const effects = juiceForAlert(j, { passengers: { satisfaction: 100 } },
    { kind: 'event-start', event: 'conference', name: 'Conférence internationale' }, { x: 0, y: 0 });
  assert.ok(effects.includes('burst') && effects.includes('float'), 'l\'événement éclat + flotte (signal, PAS de shake : un événement n\'est pas une panne)');
});
