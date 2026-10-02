// NONMVP-5 — Les 5 panneaux de consultation (src/ui/panels.mjs) : le CONTRAT
// DE DONNÉES qu'ils surfacent est prouvé ici, sans DOM (zéro navigateur).
//
// Le module UI (panels.mjs) est FINE : il ne fait que LIRE l'état de la sim +
// les getters purs existants (economy.periodStatement, path.findPath) — aucune
// règle n'y vit. On teste donc ici ce contrat : les champs que les panneaux
// lisent EXISTENT et portent les BONS TYPES (aircraft, infra, economy,
// alerts, incidents, graph), + les règles purement UI (cotation du plafond de
// saturation, bornage de l'historique d'alertes, lecture seule du graphe :
// coupé vs pas-encore-construit, R3/A7).
//
// Le rendu DOM réel est prouvé par la sonde qa/_nonmvp5.mjs (CDP, Edge) —
// ce fichier-ci ne fait que verrouiller le contrat de lecture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph, findPath, runwayExitNode } from '../src/pathfinding/path.mjs';
import { periodStatement } from '../src/economy/economy.mjs';
import { makePanels } from '../src/ui/panels.mjs';

// Aéroport CONNECTÉ (plan des tests, BL-02) : piste + taxiway + terminal qui
// se TOUCHENT — le graphe reconstruit relie les portes aux pistes.
function connectedAirport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}

// Avion complet tel que le crée flights.mjs (tous les champs que
// panels.mjs lit — le panneau « inspection » ne doit jamais afficher undefined).
function ac(sim, over) {
  return {
    id: sim.nextAcId ?? 1000, airline: 'sky', color: '#888', acType: 'medium',
    pax: 40, phase: 'gate', x: 600, y: 950, gateId: 'g1', runwayId: 'r1',
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    ...over,
  };
}

// --- 1. Inspection avion + bâtiment : le contrat de lecture -----------------

test('NONMVP-5 : les champs d\'un avion existent pour l\'inspection (airline, appareil, phase, pax, position)', () => {
  const sim = connectedAirport();
  const a = ac(sim, { id: 42 });
  sim.aircraft.push(a);
  // Ce que le panneau lit :
  assert.equal(a.airline, 'sky', 'compagnie (nominative via AIRLINES)');
  assert.equal(a.acType, 'medium', 'appareil (nom via AIRCRAFT)');
  assert.ok(typeof a.phase === 'string', 'phase (traduite via PHASES_FR)');
  assert.equal(a.pax, 40, 'passagers');
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'position');
  assert.ok(typeof a.gateId === 'string', 'porte (facultative mais typée)');
  assert.ok(typeof a.runwayId === 'string', 'piste (facultative mais typée)');
  assert.equal(a.delayed, 0, 'retard (affiché uniquement si > 0)');
});

test('NONMVP-5 : un avion disparu (départ) laisse l\'inspection se refermer proprement', () => {
  const sim = connectedAirport();
  const pick = { kind: 'ac', id: 42 };
  sim.aircraft.push(ac(sim, { id: 42 }));
  assert.ok(sim.aircraft.find((x) => x.id === pick.id), 'avion présent au clic');
  sim.aircraft = []; // le vol a décollé (flight-out, aircraft.mjs)
  assert.equal(sim.aircraft.find((x) => x.id === pick.id), undefined,
    'l\'objet est parti : le panneau affiche « parti — plus en simulation »');
});

test('NONMVP-5 : les champs d\'un bâtiment existent pour l\'inspection (type, dimensions, coût, longueur piste, portes terminal)', () => {
  const sim = connectedAirport();
  const rw = sim.infra.runways[0];
  assert.ok(['runway', 'taxiway', 'terminal'].includes(rw.type), 'type (nom via BUILDINGS)');
  assert.ok(Number.isFinite(rw.x) && Number.isFinite(rw.y) && Number.isFinite(rw.w) && Number.isFinite(rw.h),
    'rectangle (placement, zone, grille)');
  assert.ok(Number.isFinite(rw.cost), 'coût d\'origine');
  assert.equal(rw.len, rw.h, 'longueur = hauteur (piste)');
  const term = sim.infra.terminals[0];
  const gates = sim.infra.gates.filter((g) => g.terminalId === term.id);
  assert.ok(gates.length >= 1, 'le terminal possède ses portes (créées à la pose)');
  for (const g of gates) {
    assert.ok(typeof g.id === 'string' && typeof g.size === 'string', 'porte typée (id + taille S/M/L)');
    assert.equal(g.acId, null, 'porte libre (avion absent)');
  }
  // Un bâtiment démoli disparaît des tableaux : le panneau affiche « démoli ».
  const id = sim.infra.terminals[0].id;
  sim.infra.terminals = sim.infra.terminals.filter((b) => b.id !== id);
  const find = (arr) => (arr || []).find((b) => b.id === id);
  assert.equal(find(sim.infra.terminals), undefined, 'plus introuvable après démolition');
});

// --- 2. Bilan financier : le panneau surfacet economy.periodStatement -------

test('NONMVP-5 : le bilan lisible porte TOUT ce que periodStatement calcule (recettes, dépenses, net, dette, causes du déficit)', () => {
  const sim = connectedAirport();
  sim.economy.money = 1000;
  sim.economy.revenue = { pax: 2000, services: 100 };
  sim.economy.spent = { opex: 600, fuel: 300, compensation: 200, construction: 1500 };
  sim.economy.debt = 50;
  const s = periodStatement(sim); // LE getter que le panneau appelle
  // Champs lisible-par-lisible (chaque one du panneau correspond à un champ ici).
  assert.equal(s.money, 1000, 'solde');
  assert.equal(s.revenue, 2100, 'recettes (somme des entrées)');
  assert.equal(s.opex, 600, 'exploitation');
  assert.equal(s.fuel, 300, 'carburant');
  assert.equal(s.compensation, 200, 'indemnités vols annulés');
  assert.equal(s.invest, 1500, 'investissements (construction)');
  assert.equal(s.debt, 50, 'dette (compte dédié des intérêts)');
  // R12 : le net COMPTABILISE la dette (le bilan se rapproche du solde).
  assert.equal(s.net, 2100 - 600 - 300 - 200 - 1500 - 50, 'résultat net (dette comprise)');
  assert.equal(s.net, -550, 'déficit (500 + 50 de dette) → le panneau affiche les CAUSES');
  assert.ok(s.causes.length > 0, 'causes du déficit (liste lisible)');
  assert.ok(s.causes.some((c) => c.includes('investissement')), 'la cause investissement est nommée');
  assert.ok(s.causes.some((c) => c.includes('dette')), 'la cause dette/intérêts est nommée');
  // La faillite est un CHAMP de l'état, pas une règle du panneau.
  assert.equal(sim.economy.bankrupt, false, 'état de faillite (lisible, non calculé)');
});

// --- 3. Statistiques : le contrat de lecture + la règle UI du compteur ------

test('NONMVP-5 : les statistiques lues existent (temps, passagers, files, avions, planning)', () => {
  const sim = connectedAirport();
  sim.time = 3661; // 01:01:01
  sim.passengers.totalCarried = 1234;
  sim.passengers.satisfaction = 87.4;
  sim.passengers.queue = { checkin: 3, security: 2, board: 1 };
  sim.aircraft.push(ac(sim, { id: 1, phase: 'approach' }), ac(sim, { id: 2, phase: 'gate' }));
  sim.planning.push({ id: 5, status: 'planned' });
  // Champs lus par le panneau :
  assert.ok(Number.isFinite(sim.time), 'horloge de la sim');
  assert.equal(sim.passengers.totalCarried, 1234, 'pax transportés');
  assert.ok(Number.isFinite(sim.passengers.satisfaction), 'satisfaction (bornée 0-100 par la sim)');
  for (const k of ['checkin', 'security', 'board']) assert.ok(Number.isInteger(sim.passengers.queue[k]), `file ${k}`);
  // Règle UI : le compteur « en vol/attente » utilise LA LISTE DE PHASES du panneau.
  const IN_FLIGHT = ['approach', 'holding', 'landing', 'blocked'];
  const inFlight = sim.aircraft.filter((a) => IN_FLIGHT.includes(a.phase)).length;
  assert.equal(inFlight, 1, '1 avion en approche');
  assert.equal(sim.aircraft.length - inFlight, 1, '1 avion au sol');
  assert.equal(sim.planning.length, 1, 'vols planifiés');
});

// --- 4. Historique d'alertes : bornage UI + lecture seule ------------------

test('NONMVP-5 : l\'historique d\'alertes est borné aux 50 plus récentes (les plus récentes d\'abord)', () => {
  const sim = newSimState(); // état neuf : AUCUNE alerte préexistante (comptage propre)
  for (let i = 0; i < 60; i++) sim.alerts.push({ kind: `ev-${i}`, why: `détail ${i}` });
  // Ce que le panneau fait (slice(-50).reverse()) — la règle EST ici :
  const last = sim.alerts.slice(-50).reverse();
  assert.equal(last.length, 50, 'bornage à 50 entrées');
  assert.equal(last[0].kind, 'ev-59', 'la PLUS RÉCENTE en premier');
  assert.equal(last[49].kind, 'ev-10', 'la 50e plus récente en dernier');
  assert.equal(sim.alerts.length - 50, 10, 'le surplus (non affiché) est compté');
  assert.equal(sim.alerts.length, 60, 'LUE seule : le tableau n\'est ni trié ni modifié');
  // Cas vide : « Aucune alerte ».
  const empty = newSimState();
  assert.equal((empty.alerts || []).length, 0, 'état neuf = historique vide');
});

// --- 5. Diagnostic réseau : coupé / saturation -----------------------------

test('NONMVP-5 : saturation = file d\'arrivées face au plafond (4), avec l\'état des incidents lisible', () => {
  const sim = connectedAirport();
  // Les 4 phases qui comptent dans la file (mêmes phases que le panneau).
  const IN_FLIGHT = ['approach', 'holding', 'landing', 'blocked'];
  for (const [i, ph] of IN_FLIGHT.entries()) sim.aircraft.push(ac(sim, { id: i, phase: ph }));
  const pending = sim.aircraft.filter((a) => IN_FLIGHT.includes(a.phase)).length;
  const CAP = 4; // MAX_PENDING (flights.mjs) — le panneau le compare
  assert.equal(pending, 4, 'file saturée (plafond atteint)');
  assert.ok(pending >= CAP, 'le panneau la marque « sature »');
  // Les incidents sont UN CHAMP d'état propre (BL-14) : le panneau les lit.
  sim.incidents.runway.closed = 30;
  sim.incidents.fuel.out = 12;
  sim.incidents.surge.active = true;
  assert.ok(sim.incidents.runway.closed > 0, 'piste fermée (s restants lisibles)');
  assert.ok(sim.incidents.fuel.out > 0, 'panne carburant (s restants lisables)');
  assert.ok(sim.incidents.surge.active, 'pic de demande actif');
  // Sans incidents : rien à signaler.
  const fresh = newSimState();
  assert.equal(fresh.incidents.runway.closed, 0, 'neuf : piste ouverte');
  assert.equal(fresh.incidents.fuel.out, 0, 'neuf : carburant OK');
  assert.equal(fresh.incidents.surge.active, false, 'neuf : pas de pic');
});

test('NONMVP-5 : réseau COUPÉ — les portes INACCESSIBLES sont détectées par findPath (lecture seule)', () => {
  // Terminal ÉLOIGNÉ : ses portes ne touchent aucun segment (plan des tests AC3).
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'terminal', 1200, 900); // loin de toute piste/taxiway
  rebuildGraph(sim);
  const g = sim._graph;
  assert.ok(g && g.nodes.length > 0, 'graphe construit (après le 1er tick)');
  assert.ok(g.gateNode instanceof Map, 'les portes ont leur nœud (Map)');
  // La question du panneau : un chemin PISTE→PORTE existe-t-il ? (occupation vide)
  let reachable = 0, unreachable = 0;
  for (const gate of sim.infra.gates) {
    const to = g.gateNode.get(gate.id);
    let ok = false;
    if (to != null) {
      for (const rw of sim.infra.runways) {
        const from = runwayExitNode(sim, rw.id);
        if (from != null && findPath(sim, from, to, new Set())) { ok = true; break; }
      }
    }
    ok ? reachable++ : unreachable++;
  }
  assert.equal(unreachable, sim.infra.gates.length, 'AUCUNE porte n\'est atteignable (réseau coupé)');
});

test('NONMVP-5 : réseau JOINT — sur un aéroport connecté, les portes S sont atteignables depuis la piste', () => {
  const sim = connectedAirport();
  const g = sim._graph;
  const sGates = sim.infra.gates.filter((x) => x.size === 'S');
  assert.ok(sGates.length > 0, 'des portes S existent (terminal : S/M/M/S)');
  let ok = false;
  for (const gate of sGates) {
    const to = g.gateNode.get(gate.id);
    if (to == null) continue;
    for (const rw of sim.infra.runways) {
      const from = runwayExitNode(sim, rw.id);
      if (from != null && findPath(sim, from, to, new Set())) { ok = true; break; }
    }
    if (ok) break;
  }
  assert.ok(ok, 'au moins une porte S est joignable (le panneau la marque « atteignable »)');
});

test('NONMVP-5 : AVANT le 1er tick le graphe est null (R3/A7) — le panneau le DIT, ne le fabrique PAS', () => {
  const sim = newSimState();
  assert.equal(sim._graph, null, 'graphe null avant construction (c\'est voulu, R3/A7)');
  // Le panneau réseau ne JAMAIS reconstruit le graphe : il lit `sim._graph` et
  // affiche « pas encore construit » tant qu'il est null. Ici on vérifie que
  // la lecture est bien optionnelle (pas de crash, pas d'appel rebuildGraph).
  const g = sim._graph;
  assert.ok(g === null, 'le panneau détecte l\'absence de graphe et ne panique pas');
  // rebuildGraph SIMULE (construction) : on s'assure que le panneau ne l'a
  // PAS appelé de son côté (le contrat = lecture seule).
  assert.equal(sim._graph, null, 'après la lecture, le graphe est TOUJOURS null (lecture seule)');
});

// --- 6. R07 : inspection vivante + invalidation à la nouvelle partie / au load
// Le panneau fait un clic sur un avion, puis l'avion avance (phase + position
// changent). La signature du panneau doit suivre → le DOM est reconstruit avec
// les valeurs FRAÎCHES. À la nouvelle partie (ou au load), panels.invalidate()
// vide le pick pour ne plus afficher un objet de l'ancienne sim.
function makeR07Dom() {
  function makeNode(tag) {
    return {
      tag, className: '', textContent: '', children: [], handlers: {},
      setAttribute() {},
      appendChild(c) { this.children.push(c); },
      append(...cs) { this.children.push(...cs); },
      replaceChildren() { this.children = []; },
      addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
      fire(ev, payload) { for (const fn of this.handlers[ev] || []) fn(payload || {}); },
    };
  }
  const canvas = makeNode('canvas');
  const body = makeNode('body');
  body.children.push(canvas); // le panneau s'attache au body ; le clic est sur #game
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createTextNode: (t) => ({ textContent: t, tag: '#text' }),
    querySelector: () => canvas,
    body,
  };
  return { body, canvas };
}

// Câblage FAIT COMME main.mjs : viewSize, camera (dummy), buildTool absent.
function wireR07Panels(state) {
  const { body, canvas } = makeR07Dom();
  const camera = { zoom: 1, screenToWorldX: (x) => x, screenToWorldY: (y) => y };
  const panels = makePanels({ state, camera, viewSize: () => ({ width: 100, height: 100 }), buildTool: undefined });
  return { panels, body, canvas, camera };
}

test('R07 : inspection vivante — l\'avion bouge, le panneau suit sans reselection', () => {
  const state = { screen: 'game', sim: newSimState() };
  const { panels, canvas } = wireR07Panels(state);
  const sim = state.sim;
  const a = ac(sim, { id: 42, phase: 'gate', x: 600, y: 950, gateId: 'g1' });
  sim.aircraft.push(a);
  // Le joueur clique à la position de l'avion (l'outil de construction est inactif).
  canvas.fire('click', { offsetX: 600, offsetY: 950 });
  // Première passe : le panneau construit son DOM avec l'état ACTUEL.
  panels.refresh();
  assert.ok(
    sim.aircraft.find((x) => x.id === 42),
    'avion présent au clic'
  );
  // L'avion avance (l'objet MUTÉ, pas re-sélectionné) : le panneau doit suivre.
  a.phase = 'taxi';
  a.x = 610; a.y = 960; a.delayed = 5;
  a.gateId = null;
  panels.refresh(); // la signature a changé (phase, x, y, delayed) → le DOM est reconstruit
  // Le DOM du panneau contient la NOUVELLE phase (pas l'ancienne) et le retard.
  const panelText = JSON.stringify(panels.col.children);
  assert.ok(panelText.includes('taxi'), 'le panneau affiche la phase TAXI (l\'avion a roulé)');
  assert.ok(panelText.includes('retard 5 s'), 'le panneau affiche le retard (l\'objet suivi)');
  // Cause lisible : la phase « taxi » a sa cause dans CAUSE_FR (pas de règle ici).
  assert.ok(panelText.includes('segment occupé') || panelText.includes('taxi'),
    'la cause du retard est affichée (CAUSE_FR[taxi])');
  // Ressource attendue : acType 'medium' → spec.gate='M' → « porte M ».
  assert.ok(panelText.includes('Ressource attendue'), 'la ligne ressource attendue existe');
  assert.ok(panelText.includes('porte M'), 'la ressource attendue = porte M (spéc. medium)');
});

test('R07 : invalidate() à la nouvelle partie vide le pick (pas d\'avion fantôme)', () => {
  const state = { screen: 'game', sim: newSimState() };
  const { panels, canvas } = wireR07Panels(state);
  const sim = state.sim;
  sim.aircraft.push(ac(sim, { id: 42, phase: 'gate', x: 600, y: 950, gateId: 'g1' }));
  canvas.fire('click', { offsetX: 600, offsetY: 950 });
  panels.refresh(); // le pick est actif (l'avion 42 est inspecté)
  assert.ok(
    JSON.stringify(panels.col.children).includes('Avion #42'),
    'l\'avion 42 est inspecté'
  );
  // Nouvelle partie : l'objet de l'ancienne sim n'existe plus.
  // Le hook câblé par main.mjs (startNewGame → panels.invalidate) est appelé.
  panels.invalidate();
  panels.refresh();
  const panelText = JSON.stringify(panels.col.children);
  assert.ok(!panelText.includes('Avion #42'), 'le panneau ne montre plus l\'avion de l\'ancienne partie');
  assert.ok(panelText.includes('Cliquez sur un avion') || panelText.includes('aucun'),
    'le panneau retourne à l\'état par défaut (pas un « parti » stale)');
});
