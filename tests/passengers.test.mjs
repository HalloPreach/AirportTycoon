// Tests passagers (BL-13, AC7/AC22/AC40, artefact NONMVP-2 « tests files ») :
//  - parcours agrégé : les groupes passent check-in → sécurité → attente →
//    embarquement, files PAR TERMINAL (sim.passengers.queues[terminalId], R30) ;
//  - SATURATION : plusieurs vols au sol en même temps → files pleines,
//    satisfaction mesurable qui BAISSE (effet mesurable, AC22) ;
//  - DÉNOUEMENT : les vols partent (purge) → les files se vident → la
//    satisfaction REMONTE : un retard ancien ne condamne pas indéfiniment ;
//  - PAS DE DOUBLE COMPTAGE (AC40) : un vol est compté UNE fois (576 pax pour
//    4 × 144, pas 1152) ; un vol parti en cours de parcours est épurgé sans
//    fausse comptabilité (les pax orphelins sortent, les files reviennent à 0).
// Zéro DOM, déterministe : même moteur de vol que les tests sim (ticks directs,
// pas de PRNG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { placeBuilding, buildBuilding } from '../src/infra/infra.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickPassengers, queueTotals, removePassengers, groupComplete, arrivePassengers, countCarried, ensurePassengers, boardDelay } from '../src/sim/passengers.mjs';

// Socle : 2 pistes (parcours exclusifs → les vols se superposent) + 2 terminaux
// (capacité files doublée) + 1 taxiway qui touche TOUT : les 2 sorties de piste
// (y1090) et les 2 terminaux (bord bas y1040) sont reliés → le réseau est
// physiquement valide.
function buildSocle(sim) {
  sim._graphDirty = true;
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'runway',  x: 750, y: 100,  w: 100, h: 1000 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'runway',  x: 900, y: 100,  w: 100, h: 1000 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'taxiway', x: 700, y: 1050, w: 400, h: 40 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'terminal', x: 550, y: 900,  w: 200, h: 150 });
  placeBuilding(sim, { id: sim.infra.nextId++, type: 'terminal', x: 1050, y: 900, w: 200, h: 150 });
}

// 4 vols medium (144 pax chacun) déjà AU SOL, en phase « gate » : au 1er tick,
// doGate crée LEUR GROUPE passagers (check-in) et ils démarrent le débarquement
// — le cas extrême de la saturation, tout le monde à la porte en même temps.
// 4 (pas 5) : 4 portes M au total (2 terminaux × 2 M) → chacun a sa porte.
function fourAtGate(sim) {
  const mGates = sim.infra.gates.filter((g) => g.size === 'M');
  for (let i = 0; i < 4; i++) {
    sim.aircraft.push({
      id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 144,
      phase: 'gate', x: 600, y: 1065, gateId: mGates[i] ? mGates[i].id : null,
      runwayId: sim.infra.runways[0].id,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
  }
}
// R30 : les files sont PAR TERMINAL (sim.passengers.queues[terminalId]) —
// l'agrégat global (pour les assertions) est la SOMME des terminaux
// (queueTotals, exporté par src/sim/passengers.mjs).

test('AC22 (saturation) : 4 vols au sol → files pleines, satisfaction mesure la baisse', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  let minSat = sim.passengers.satisfaction;
  let maxFlow = 0;
  for (let i = 0; i < 120; i++) { // 120 s de jeu
    tickAircraft(sim, 1);
    tickPassengers(sim, 1);
    const q = queueTotals(sim);
    maxFlow = Math.max(maxFlow, q.checkin + q.security + q.board);
    minSat = Math.min(minSat, sim.passengers.satisfaction);
  }
  assert.ok(maxFlow > 200, 'les files sont pleines en saturation (pic de pax en file)');
  assert.ok(minSat < 99, `satisfaction mesure LA BAISSE en saturation (min ${minSat.toFixed(2)})`);
});

test('AC22/AC40 (dénouement) : les vols partent → files à 0, satisfaction REMONTE', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  let minSat = sim.passengers.satisfaction;
  for (let i = 0; i < 120; i++) {
    tickAircraft(sim, 1);
    tickPassengers(sim, 1);
    minSat = Math.min(minSat, sim.passengers.satisfaction);
  }
  assert.ok(minSat < 99, 'la satisfaction a d\u2019abord chut\u00e9 en saturation');
  // Dénouement : tous les vols sont partis/annulés (purge) → les passagers
  // orphelins sortent du parcours, les files se vident, la satisfaction remonte.
  sim.aircraft = [];
  for (let i = 0; i < 400; i++) tickPassengers(sim, 1); // 400 s de jeu
  const q = queueTotals(sim);
  assert.ok(q.checkin < 1 && q.security < 1 && q.board < 1, 'les files sont revenues \u00e0 vide');
  assert.equal(sim.passengers.groups.length, 0, 'les groupes sont tous \u00e9pur\u00e9s');
  assert.ok(sim.passengers.satisfaction > minSat, `satisfaction REMONTE apr\u00e8s d\u00e9nouement (${sim.passengers.satisfaction.toFixed(2)} > min ${minSat.toFixed(2)})`);
  assert.ok(sim.passengers.satisfaction > 90, 'la satisfaction est r\u00e9cup\u00e9r\u00e9e');
});

test('AC40 (pas de double comptage) : 4 × 144 pax → totalCarried = 576 EXACTEMENT', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  for (let i = 0; i < 300; i++) {
    tickAircraft(sim, 1);
    tickPassengers(sim, 1);
  }
  assert.equal(sim.passengers.totalCarried, 576, '4 × 144 pax comptés UNE fois (pas 1152)');
  assert.equal(sim.passengers.groups.length, 0, 'plus aucun groupe en cours');
});

test('D2 (embarquement) : un groupe n\'est JAMAIS compté avant la fin du parcours', () => {
  // Scénario de l'audit D2 (reproduction exacte) : 4 GROS vols de 350 pax,
  // chacun à une porte L d'un terminal, lancés au début de leur traitement au
  // sol. SANS la correction, les 4 vols passaient en pushback (et comptaient
  // leurs 1400 pax) alors que ~676 pax restaient au check-in. AVEC la
  // correction, tout groupe COMPTÉ est COMPLET (toutes ses pax ont franchi
  // sécurité→attente) : le comptage attend la fin du parcours, jamais avant.
  const state = makeGameState();
  const sim = state.sim;
  const base = (id, data = {}) => ({ id, airline: 'atlantique', acType: 'medium', pax: 160,
    phase: 'approach', x: 800, y: -150, gateId: null, runwayId: null, delayed: 0,
    timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate', ...data });
  const positions = [[100, 100], [100, 350], [100, 600], [1100, 100]];
  const gates = positions.map(([x, y]) => {
    const t = buildBuilding(sim, 'terminal', x, y);
    return sim.infra.gates.find((g) => g.terminalId === t.id && g.size === 'L');
  });
  sim.aircraft = gates.map((g, i) => {
    g.acId = i + 1;
    return base(i + 1, { acType: 'large', pax: 350, phase: 'gate',
      gateId: g.id, runwayId: sim.infra.runways[0].id,
      x: g.x + g.w / 2, y: g.y + g.h / 2 });
  });
  const FULL = 4 * 350;
  // Invariant D2 tick par tick : un groupe DISPARU (compté ce tick) devait être
  // COMPLET juste AVANT le tick qui le compte.
  let counted = 0;
  for (let i = 0; i < 4000; i++) {
    const before = sim.passengers.totalCarried;
    const prevGroups = sim.passengers.groups.map((g) => ({ ...g }));
    tickAircraft(sim, 0.1);
    tickPassengers(sim, 0.1);
    if (sim.passengers.totalCarried > before) {
      const now = new Set(sim.passengers.groups.map((g) => g.volId));
      for (const g of prevGroups) {
        if (!now.has(g.volId)) {
          // groupe retiré = compté ce tick : ses pax avaient toutes dû finir AVANT.
          // R30 : securityDone est PAR TERMINAL — on lit le compteur DU TERMINAL
          // du groupe (g.terminalId), pas un compteur global.
          const secDone = sim.passengers.securityDone[g.terminalId] || 0;
          assert.ok(secDone >= (g.base || 0) + g.pax - 1e-9,
            `D2 (tick ${i + 1}) : vol ${g.volId} compté avant la fin du parcours (securityDone[${g.terminalId}] ${secDone.toFixed(1)} < ${(g.base || 0) + g.pax})`);
          counted++;
        }
      }
    }
    if (sim.passengers.totalCarried >= FULL && sim.passengers.groups.length === 0) break;
  }
  assert.equal(sim.passengers.totalCarried, FULL, '1400 pax comptés (une fois chacun)');
  assert.ok(counted > 0, 'des groupes ont bien été comptés (le test est vivant)');
  // Les files ne sont PAS une fausse preuve : au moment où tout est compté,
  // les pax en files sont ceux qui n'avaient pas encore fini (0 ici : tous partis).
  const q = queueTotals(sim);
  assert.ok(q.checkin < 1 && q.security < 1, 'aucune pax orpheline bloquée en files au comptage final');
});

test('orphelins : des vols partis en cours de parcours sont épurgés, files à 0, satisfaction remonte', () => {
  const sim = newSimState();
  buildSocle(sim);
  fourAtGate(sim);
  // 20 s de jeu : les files se remplissent (débarquement + check-in).
  for (let i = 0; i < 20; i++) { tickAircraft(sim, 1); tickPassengers(sim, 1); }
  assert.ok(sim.passengers.groups.length > 0, 'des groupes sont en cours');
  // Les 4 vols sont annulés/purgés (vol annulé en cours de parcours).
  sim.aircraft = [];
  for (let i = 0; i < 400; i++) tickPassengers(sim, 1);
  const q = queueTotals(sim);
  assert.ok(q.checkin < 1 && q.security < 1 && q.board < 1, 'les pax orphelins sont sortis du parcours');
  assert.equal(sim.passengers.totalCarried, 0, 'aucun pax compté pour des vols partis sans embarquer');
  assert.equal(sim.passengers.groups.length, 0, 'groupes épurgés');
  assert.ok(sim.passengers.satisfaction > 90, 'la satisfaction remonte après dénouement');
});

test('repos : aucune file, satisfaction stable à 100 (pas de perte fantôme)', () => {
  const sim = newSimState();
  buildSocle(sim);
  for (let i = 0; i < 500; i++) tickPassengers(sim, 1); // 500 s de jeu, aucun vol
  const q = queueTotals(sim);
  assert.equal(q.checkin, 0);
  assert.equal(q.security, 0);
  assert.equal(q.board, 0);
  assert.equal(sim.passengers.satisfaction, 100, 'satisfaction stable au repos');
  assert.equal(sim.passengers.totalCarried, 0, 'aucun pax compté sans vol');
});

// R30 : les files sont PAR TERMINAL — un terminal saturé ne traite JAMAIS les
// pax d'un autre (critère R30 : A saturé / B vide → les pax de B suivent leur
// parcours normalement, AUCUN débordement global).
test('R30 (isolement par terminal) : un terminal saturé ne bloque pas l\u2019autre terminal', () => {
  const sim = newSimState();
  buildSocle(sim);
  const t1 = sim.infra.terminals[0].id;
  const t2 = sim.infra.terminals[1].id;
  // Un gros bouchon SANS pax en cours dans B : on remplit uniquement la file
  // check-in DU TERMINAL 1 au-del\u00e0 de sa capacit\u00e9 (120) → saturation.
  const p = ensurePassengers(sim);
  p.queues[t1] = { checkin: 120, security: 0, board: 0 }; // file pleine (capacit\u00e9 120)
  // Le vol B est au sol dans le terminal 2 : ses pax entrent en check-in DE
  // t2 (injection arrivePassengers) et doivent traverser la sécurité DE t2.
  const mGates = sim.infra.gates.filter((g) => g.size === 'M');
  const gateB = mGates.find((g) => g.terminalId === t2);
  sim.aircraft.push({
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 20,
    phase: 'gate', x: 600, y: 1065, gateId: gateB.id, runwayId: sim.infra.runways[0].id,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  arrivePassengers(sim, sim.aircraft[0]); // ses 20 pax entrent en check-in DE t2
  sim.aircraft[0]._paxInjected = true; // empêche doGate de RE-injecter au 1er tick (double comptage)
  // 60 s de jeu : t1 reste satur\u00e9 (file pleine → aucun d\u00e9bit au-del\u00e0 de la
  // capacit\u00e9), mais t2 vide ses 20 pax normalement (parcours AUCUNEMENT
  // affect\u00e9 par la saturation de t1).
  for (let i = 0; i < 60; i++) { tickAircraft(sim, 1); tickPassengers(sim, 1); }
  const q2 = p.queues[t2];
  assert.ok(q2.checkin < 1 && q2.security < 1 && q2.board < 1,
    `les pax de t2 ont travers\u00e9 leur terminal (t2 vide : ${JSON.stringify(q2)})`);
  assert.equal(groupComplete(sim, sim.aircraft[0]), true,
    'le groupe de t2 est COMPLET (parcours termin\u00e9) malgré la saturation de t1');
  assert.equal(boardDelay(sim, sim.aircraft[0]), 0,
    'aucun retard embarquement sur t2 (file d\u2019attente de t2 sous sa capacit\u00e9)');
});

// R30 : annulation d\u2019un vol → retrait EXPLICITE de ses pax EN COURS
// (jamais compt\u00e9s, AC40) SANS bloquer les groupes SUIVANTS DU MÊME terminal.
test('R30 (annulation non bloquante) : un vol annul\u00e9 ne bloque pas les pax suivants', () => {
  const sim = newSimState();
  buildSocle(sim);
  const mGates = sim.infra.gates.filter((g) => g.size === 'M');
  // Terminal 1 : 2 vols au sol en s\u00e9quence → pax en s\u00e9quence dans le flux check-in.
  const gateA = mGates.find((g) => g.terminalId === sim.infra.terminals[0].id);
  sim.aircraft.push({
    id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 40,
    phase: 'gate', x: 600, y: 1065, gateId: gateA.id, runwayId: sim.infra.runways[0].id,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
  });
  const cancelled = sim.aircraft[sim.aircraft.length - 1];
  arrivePassengers(sim, cancelled); // ses 40 pax entrent en check-in (base 0)
  cancelled._paxInjected = true; // doGate ne ré-injecte pas (double comptage)
  // 2 vols SUIVANTS (injectés APRÈS, base 40) : leurs pax sont derrière dans le flux.
  for (let i = 0; i < 2; i++) {
    sim.aircraft.push({
      id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 20,
      phase: 'gate', x: 600, y: 1065, gateId: gateA.id, runwayId: sim.infra.runways[0].id,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
    arrivePassengers(sim, sim.aircraft[sim.aircraft.length - 1]);
    sim.aircraft[sim.aircraft.length - 1]._paxInjected = true; // doGate ne ré-injecte pas
  }
  // Le vol annulé est retiré : ses pax EN COURS sortent DU TERMINAL (jamais comptés),
  // sans bloquer les 2 vols suivants (leurs bases sont réadées, leurs pax finissent).
  // On reproduit le parcours réel d'annulation (aircraft.mjs doBlocked) : retrait
  // EXPLICITE + phase 'cancelled' + purge par le planificateur (sim.aircraft).
  removePassengers(sim, cancelled);
  cancelled.phase = 'cancelled';
  sim.aircraft = sim.aircraft.filter((a) => a.id !== cancelled.id); // planificateur purge
  assert.ok(!sim.passengers.groups.some((g) => g.volId === cancelled.id),
    'le groupe du vol annul\u00e9 est retir\u00e9 (retrait explicite)');
  assert.equal(sim.passengers.totalCarried, 0, 'aucun pax compt\u00e9 pour le vol annul\u00e9 (AC40)');
  // Les pax en cours du vol annul\u00e9 sont sortis de la file check-in DU TERMINAL.
  const q1 = sim.passengers.queues[sim.infra.terminals[0].id];
  // 40 (annul\u00e9) + 20 + 20 = 80 inject\u00e9s ; le retrait retire 40 (pax en cours) → 40.
  assert.equal(q1.checkin, 40, 'les 40 pax du vol annul\u00e9 sont retir\u00e9s de la file check-in');
  // 60 s de jeu : les 2 vols suivants finissent leur parcours (non bloqu\u00e9s) et
  // comptent chacun UNE fois (AC40).
  const after = sim.aircraft.slice(1);
  for (let i = 0; i < 120; i++) {
    tickAircraft(sim, 1); tickPassengers(sim, 1);
    if (sim.passengers.totalCarried >= 40 && sim.passengers.groups.length === 0) break;
  }
  assert.equal(sim.passengers.totalCarried, 40, 'les 2 vols suivants sont compt\u00e9s (2 × 20 pax, une fois chacun)');
});
