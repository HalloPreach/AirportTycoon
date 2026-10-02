// BL-07 (AC20, AC3) — planning pilotable + attribution.
//   AC20 : le planning est CONSULTABLE (compagnie, appareil, passagers,
//          horaires prévus, état, cause de retard) + décision acceptation/
//          refus du JOUEUR (fin du générateur aléatoire invisible) : un vol
//          planifié n'arrive QUE si le joueur l'accepte (refusé = jamais né).
//   AC3  : attribution compatible/disponible/accessible, avec alternatives
//          et CAUSE lisible quand un vol n'est pas réalisable.
// Zéro DOM, PRNG mulberry32 des tests (déterminisme seed documenté).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickPlanner, attributeFlight, decideFlight } from '../src/flights/flights.mjs';

// PRNG déterministe (mulberry32) : le même seed → la même suite de vols planifiés.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Aéroport CONNECTÉ (plan des tests, BL-02) : piste + taxiway + terminal qui se TOUCHENT.
function connectedAirport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}

// Lance le planificateur jusqu'au 1er cycle de planning (fenêtre de 60 s) et
// renvoie la PREMIÈRE entrée planifiée : le vol est planifié (visible) AVANT
// d'être accepté/déployé — c'est le point d'entrée du JEU (AC20).
function firstPlanned(sim, random) {
  for (let i = 0; i < 610; i++) tickPlanner(sim, 0.1, random); // 61 s : la fenêtre 0→60 a planifié
  assert.ok(sim.planning.length >= 1, 'au moins un vol planifié visible');
  return sim.planning[0];
}

test('AC20 : le planning est consultable (compagnie, appareil, pax, horaire prévu, état, cause)', () => {
  const sim = connectedAirport();
  const e = firstPlanned(sim, rng(42));
  // Champs consultables (AC20) : l'UI (BL-16) se branche SUR CES DONNÉES.
  assert.ok(e.airline.length > 0, 'compagnie nominative');
  assert.ok(e.acType.length > 0, 'appareil (taille)');
  assert.ok(Number.isInteger(e.pax) && e.pax > 0, 'passagers prévisionnels');
  assert.ok(Number.isFinite(e.planned) && e.planned > 0, 'horaire PRÉVU (horloge de la sim)');
  assert.ok(['planned', 'accepted', 'in-flight', 'delayed'].includes(e.status), 'état lisible');
  assert.equal(typeof e.why, 'undefined', 'pas encore de cause de retard (vol frais)');
});

test('AC20 : un vol REFUSÉ par le joueur n\'arrive JAMAIS (fin du générateur aléatoire invisible)', () => {
  const sim = connectedAirport();
  const e = firstPlanned(sim, rng(7));
  const refusedId = e.id;
  assert.equal(decideFlight(sim, refusedId, false), true, 'refus accepté');
  assert.ok(!sim.planning.some((x) => x.id === refusedId), 'le vol refusé a quitté le planning');
  // On passe largement l'heure de départ prévue : le vol refusé N'EXISTE PAS.
  for (let i = 0; i < 900; i++) tickPlanner(sim, 0.1, rng(7)); // + 90 s (au-delà de prévu)
  assert.ok(!sim.aircraft.some((a) => a.id === refusedId), 'aucun avion né du vol refusé');
  // Les AUTRES vols planifiés au même cycle restent vivants (le refus est CIBLÉ).
  assert.ok(sim.planning.length >= 1, 'les autres vols du cycle sont intacts');
});

test('AC20 : un vol ACCEPTÉ arrive à son heure (planning → vol réel)', () => {
  const sim = connectedAirport();
  // Le 2e vol planifié (né à la fenêtre 120 s, départ prévu ~180 s) est encore FUTURE.
  for (let i = 0; i < 2500 && sim.planning.length < 2; i++) tickPlanner(sim, 0.1, rng(42));
  const e = sim.planning[sim.planning.length - 1];
  assert.equal(decideFlight(sim, e.id, true), true, 'acceptation');
  assert.equal(e.status, 'accepted', 'état = accepted');
  // Juste AVANT son heure : pas d'avion. À son heure (fenêtre) : l'avion EXISTE.
  for (let i = 0; sim.time < e.planned - 5; i++) tickPlanner(sim, 0.1, rng(42));
  assert.ok(!sim.aircraft.some((a) => a.id === e.id), 'pas né avant son heure');
  for (let i = 0; sim.time < e.planned + 1; i++) tickPlanner(sim, 0.1, rng(42)); // fenêtre ≥ prévue → déploiement
  const ac = sim.aircraft.find((a) => a.id === e.id);
  assert.ok(ac, 'l\'avion EXISTE à son heure (départ programmé)');
  assert.equal(ac.acType, e.acType, 'c\'est BIEN ce vol (appareil identique)');
  assert.equal(e.status, 'in-flight', 'le planning suit le vol en vol');
});

// BL-16 (AC20) : un vol JAMAIS ACCEPTÉ n'arrive jamais — même largement après
// son horaire prévu, il reste dans le planning « planned » et ne produit AUCUN
// avion. La décision est celle du JOUEUR (boutons du panneau / auto-accept) ;
// le planificateur ne déploie que les vols « accepted ».
test('AC20 (BL-16) : un vol JAMAIS accepté n\'arrive jamais (planned ≠ auto-déploiement)', () => {
  const sim = connectedAirport();
  const e = firstPlanned(sim, rng(7));
  // Jamais de décision : on passe LARGEMENT l'heure prévue du vol.
  for (let i = 0; i < 900; i++) tickPlanner(sim, 0.1, rng(7)); // + 90 s
  assert.ok(!sim.aircraft.some((a) => a.id === e.id), 'aucun avion né du vol non décidé');
  // Le vol reste CONSULTABLE (état « planned »), en attente de la décision joueur.
  assert.ok(sim.planning.some((x) => x.id === e.id && x.status === 'planned'),
    'le vol reste en liste, en attente de décision (pas purgé, pas déployé)');
  // La décision JOUEUR change tout : l'acceptation déploie immédiatement
  // (heure prévue déjà dépassée → avion né à la fenêtre suivante).
  assert.equal(decideFlight(sim, e.id, true), true, 'acceptation tardive possible');
  for (let i = 0; i < 610; i++) tickPlanner(sim, 0.1, rng(7));
  assert.ok(sim.aircraft.some((a) => a.id === e.id), 'l\'avion EXISTE après acceptation');
});

test('AC20 : décision sur un vol inconnu → refus propre, pas de crash', () => {
  const sim = connectedAirport();
  assert.equal(decideFlight(sim, 999999, true), false, 'inexistant → aucun effet');
  assert.equal(decideFlight(sim, 999999, false), false, 'inexistant → aucun effet');
});

// --- AC3 : attribution compatible / disponible / accessible (causes + alternatives)

test('AC3 : vol compatible et accessible (aéroport connecté) — sans cause de blocage', () => {
  const sim = connectedAirport();
  const r = attributeFlight(sim, 'medium');
  assert.equal(r.compatible, true, 'piste + porte M existent');
  assert.equal(r.available, true, 'disponible (plafond A-5)');
  assert.equal(r.accessible, true, 'accessible (chemin piste→porte)');
  assert.equal(r.cause, 'servi', 'pas de cause quand tout est ok');
});

test('AC3 : piste trop COURTE pour un gros avion → incompatible + CAUSE + alternatives', () => {
  const sim = connectedAirport();
  sim.infra.runways[0].len = 300; // piste raccourcie (L : minRunway 800)
  const r = attributeFlight(sim, 'large');
  assert.equal(r.compatible, false, 'gros avion inréalisable sur piste courte');
  assert.ok(r.cause.includes('piste'), 'la CAUSE nomme la piste');
  assert.ok(Array.isArray(r.alternatives) && r.alternatives.length > 0, 'alternatives proposées');
  assert.ok(r.alternatives.includes('small'), 'une alternative compatible (S) est proposée');
});

test('AC3 : porte HORS réseau (taxiway manquant) → inaccessible + CAUSE', () => {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100); // socle standard : piste 1000 m
  buildBuilding(sim, 'terminal', 1200, 900); // terminal ÉLOIGNÉ : ses portes ne touchent aucun segment
  rebuildGraph(sim);
  const r = attributeFlight(sim, 'small');
  assert.equal(r.compatible, true, 'piste et porte existent (compatible)');
  assert.equal(r.accessible, false, 'pas de chemin piste→porte : inréalisable');
  assert.ok(r.cause.includes('réseau'), 'la CAUSE nomme le réseau coupé');
});

test('AC3 : plafond d\'arrivées atteint (A-5) → indisponible + CAUSE', () => {
  const sim = connectedAirport();
  // 4 avions bloqués = MAX_PENDING → plus d'arrivées (le plafond A-5).
  sim.aircraft = [0, 1, 2, 3].map((i) => ({
    id: i, airline: 'x', color: '#fff', acType: 'small', pax: 10,
    phase: 'blocked', x: 800, y: 1100, gateId: null, runwayId: sim.infra.runways[0].id,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  }));
  const r = attributeFlight(sim, 'small');
  assert.equal(r.available, false, 'plafond atteint → indisponible');
  assert.ok(r.cause.includes('plafond'), 'la CAUSE nomme le plafond');
});
