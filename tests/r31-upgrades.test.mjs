// R31 (t_7a512737) : 3 CHOIX D'AMÉLIORATION DE CAPACITÉ CIBLÉE par terminal.
// Coût FIXE + résultat attendu (catalog.mjs UPGRADES) ; les NIVEAUX vivent dans
// l'état sim.upgrades (sérialisé — la reprise RESTITUE niveau ET coût payé, on ne
// re-débite JAMAIS au chargement). Mêmes socles que R29/R28 (sim seule, zéro DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, cleanGates, tickUnlocks } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { buyUpgrade, upgradeLevel, upgradeView } from '../src/infra/upgrades.mjs';
import { tickPassengers, passengerSummary } from '../src/sim/passengers.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy } from '../src/economy/economy.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// Socle : piste + taxiway + UN terminal (R29) + UNE station carburant (R28).
// Les équipes nettoyage/hangar se DÉBLOQUENT par l'usure porte (R23 : seuil 10)
// — on l'amorce comme R29 (g.cleaning/maintenance = 10 + tickUnlocks) pour que
// la construction d'équipe marche (sinon buildBuilding renvoie null : locked).
function buildSocle(sim) {
  rebuildGraph(sim);
  sim.economy.money = 100000;
  sim.planning.push({ id: sim.nextAcId++, airline: 'atlantique', acType: 'medium', pax: 160, planned: 300, status: 'planned' });
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 350, 1050);
  // R23 : UNE seule porte à usure ≥ 10 suffit pour DÉBLOQUER nettoyage/hangar
  // (`.some()` sur les portes) — on ne pollue PAS le reste (le goulot « usure »
  // des tests reste mesurable : 1 porte × (10+10) = 20 points, négligeable).
  sim.infra.gates[0].cleaning = 10; sim.infra.gates[0].maintenance = 10;
  sim.passengers.totalCarried = 400; // R23 : volumes (cohérent, débloque baggage/catering)
  tickUnlocks(sim); // les équipes nettoyage/hangar sont maintenant CONSTRUCTIBLES
  rebuildGraph(sim);
}
const M_GATES = (sim) => sim.infra.gates.filter((g) => g.size === 'M');

// (1) ACHAT : coût FIXE (pas de %), niveau incrémenté, événement lisible,
// compte construction (BL-15), refus lisibles (niveau max / pas d'argent).
test('R31 (1) : l\'achat débite le coût FIXE et incrémente le niveau (refus lisibles)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  const money0 = sim.economy.money;
  const spent0 = sim.economy.spent.construction;
  const r = buyUpgrade(sim, t.id, 'terminal');
  assert.equal(r.ok, true, `achat terminal : ok (${r.level})`);
  assert.equal(sim.economy.money, money0 - 1500, 'coût FIXE 1500 $ débité (pas un % de la trésorerie)');
  assert.equal(upgradeLevel(sim, t.id, 'terminal'), 1, 'niveau incrémenté (0 → 1)');
  assert.equal(sim.upgrades[String(t.id)].terminal, 1, 'le niveau est écrit dans sim.upgrades (sérialisable)');
  assert.equal(sim.economy.spent.construction - spent0, 1500, 'le coût est compté dans construction (BL-15)');
  assert.ok(sim.alerts.some((a) => a.kind === 'upgraded'), 'événement « upgraded » (UI)');
  // Niveau max : le 4e achat est REFUSÉ (le coût n'est PAS re-débité).
  buyUpgrade(sim, t.id, 'terminal'); buyUpgrade(sim, t.id, 'terminal');
  const m = sim.economy.money;
  assert.equal(buyUpgrade(sim, t.id, 'terminal').ok, false, 'niveau max atteint → refus (coût non re-débité)');
  assert.equal(sim.economy.money, m, 'le refus ne débite RIEN');
  // Pas d'argent : refus + événement (l'UI l'affiche).
  sim.economy.money = 0;
  const rf = buyUpgrade(sim, t.id, 'fueling');
  assert.equal(rf.ok, false, 'sans argent → refus');
  assert.ok(sim.alerts.some((a) => a.kind === 'no-funds'), 'événement « no-funds » (UI)');
});

// (2) COMPAT : le niveau 0 renvoie les multiplicateurs NEUTRES (×1) — les tests
// R28/R29 (plein 55 s + déplacement, budget équipe 1/s) restent INCHANGÉS.
test('R31 (2) : niveau 0 = multiplicateurs neutres (les règles R28/R29 sont inchangées)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  // PLEIN (R28) : medium 110 × 0,5 s = 55 s + déplacement (station proche) —
  // le facteur niveau 0 est ×1 (la valeur R28, inchangée).
  const [g1] = M_GATES(sim);
  const ac = { id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
    phase: 'refuel', x: 0, y: 0, gateId: g1.id, runwayId: sim.infra.runways[0].id,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate' };
  sim.aircraft.push(ac);
  tickAircraft(sim, 0.1); tickEconomy(sim, 0.1);
  assert.equal(ac._refueling, true, 'le plein est acquis (état R28 inchangé)');
  assert.ok(ac._refuelNeed > 55 && ac._refuelNeed < 60, `plein ≈ 55 s (taille) + déplacement (R28, niveau 0 = ×1) : ${ac._refuelNeed}`);
  // ÉQUIPES (R29) : budget 1 équipe × 1/s × 10 s = 10 unités (inchangé).
  buildBuilding(sim, 'cleaning', 350, 950);
  cleanGates(sim, 10);
  assert.equal(sim._teamActivity.cleaning[t.id].budget, 10, `budget équipe = 10 (R29, niveau 0 = ×1) : ${sim._teamActivity.cleaning[t.id].budget}`);
  // CAPACITÉ : 120 (le cap R30, niveau 0).
  assert.equal(passengerSummary(sim).queue.checkin.cap, 120, `capacité check-in = 120 (niveau 0) : ${passengerSummary(sim).queue.checkin.cap}`);
});

// (3) AMÉLIORATION « TERMINAL » : la capacité check-in/sécurité est ×1,6 —
// le GOULOT « files » est AMÉLIORÉ (la saturation disparaît, plus de pénalité
// satisfaction). Le goulot est nommé avant achat (le « mauvais achat » devient
// compréhensible).
test('R31 (3) : l\'amélioration terminal améliore SON goulot (les files pax sont tolérées)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  // Scénario : 150 pax en file check-in (niveau 0 : capacité 120 → SATTURÉ).
  sim.passengers.queues[String(t.id)] = { checkin: 150, security: 0, board: 0 };
  sim.passengers.satisfaction = 50;
  // Le goulot courant est nommé + le BON choix le pointe (mauvais achat compréhensible).
  const v0 = upgradeView(sim, t.id);
  assert.equal(v0.bottleneck, 'files', 'goulot nommé = les files (mesure la plus chargée)');
  assert.equal(v0.choices.find((c) => c.kind === 'terminal').useful, true, 'le choix « terminal » (capacité) SUIT le goulot');
  // Niveau 0 : la file de 150 pax SATURE le terminal → la satisfaction BAISSE.
  tickPassengers(sim, 1);
  const sat0 = sim.passengers.satisfaction;
  assert.ok(sat0 < 50, `niveau 0 : la file SATURÉE fait BAISSE la satisfaction (50 → ${sat0})`);
  // ACHAT : capacité 120 × 1,6 = 192.
  buyUpgrade(sim, t.id, 'terminal');
  assert.equal(passengerSummary(sim).queue.checkin.cap, 192, 'niveau 1 : capacité 192 (file tolérée plus longue)');
  const s1 = passengerSummary(sim).byTerminal[String(t.id)];
  assert.ok(s1.checkin.occ < 1, `niveau 1 : la même file est TOLÉRÉE (occ ${s1.checkin.occ} — plus de saturation)`);
  // Le GOULOT « files » est AMÉLIORÉ : la satisfaction ne baisse PLUS (elle remonte).
  tickPassengers(sim, 1);
  const sat1 = sim.passengers.satisfaction;
  assert.ok(sat1 > sat0, `le goulot est AMÉLIORÉ : la satisfaction remonte au niveau 1 (${sat0} → ${sat1})`);
});

// (4) AMÉLIORATION « AVITAILLEMENT » : le temps de plein est ×0,75 PAR NIVEAU
// (le goulot « plein » est amélioré). Le PLEIN EN COURS n'est PAS modifié de
// façon incohérente (l'acquisition est déjà faite — le facteur s'applique au
// PLEIN SUIVANT), et la SATURATION (nombre de lances) ne change PAS.
test('R31 (4) : l\'amélioration avitaillement améliore SON goulot (le plein SUIVANT est plus court)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  const [g1] = M_GATES(sim);
  const mkAc = () => {
    const ac = { id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
      phase: 'refuel', x: 0, y: 0, gateId: g1.id, runwayId: sim.infra.runways[0].id,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate' };
    sim.aircraft.push(ac);
    return ac;
  };
  // Plein NIVEAU 0 (l'avion a sa lance, l'acquisition est faite).
  const ac0 = mkAc();
  tickAircraft(sim, 0.1); tickEconomy(sim, 0.1);
  assert.equal(ac0._refueling, true, 'le plein niveau 0 est acquis');
  const t0 = ac0._refuelNeed; // ≈ 58,4 s (55 s taille + déplacement)
  assert.ok(t0 > 55 && t0 < 60, `plein niveau 0 ≈ 58,4 s (55 + déplacement) : ${t0}`);
  // ACHAT PLEIN EN COURS : la réservation ACTIVE est inchangée (pas de
  // modification incohérente — le facteur s'applique au PLEIN SUIVANT).
  buyUpgrade(sim, t.id, 'fueling');
  assert.equal(ac0._refuelNeed, t0, 'le plein EN COURS n\'est PAS modifié (réservation active, incohérence évitée)');
  // PLEIN SUIVANT : l'avion repart plein → l'acquisition FRAÎCHE est plus courte.
  ac0._refuelNeed = 0; tickAircraft(sim, 0.1); tickEconomy(sim, 0.1); // fin → phase disembark (lance libérée)
  ac0.phase = 'refuel'; ac0.timer = 0;
  tickAircraft(sim, 0.1); tickEconomy(sim, 0.1); // ré-acquisition au facteur niveau 1 (0,75)
  const t1 = ac0._refuelNeed; // ≈ 55 × 0,75 + déplacement ≈ 44,65 s
  assert.ok(Math.abs(t1 - (55 * 0.75 + (t0 - 55))) < 0.5, `plein niveau 1 = 55 × 0,75 + déplacement (≈ 44,65 s) : ${t1}`);
  assert.ok(t1 < t0, `le plein SUIVANT est PLUS COURT (goulot amélioré) : ${t1} < ${t0}`);
  // La SATURATION ne change PAS : une 2e station ajoutée = 2e lance
  // (l'amélioration sert le DÉBIT, pas le nombre de lances).
  buildBuilding(sim, 'fuel', 100, 1050); rebuildGraph(sim);
  const ac2 = mkAc();
  tickAircraft(sim, 0.1); tickEconomy(sim, 0.1);
  assert.equal(ac2._refueling, true, 'la 2e station sert une 2e lance (la saturation = le nombre de lances, inchangé)');
  assert.notEqual(ac2._lanceId, ac0._lanceId, 'les deux avions ont des lances DISTINCTES (parallélisme R28)');
});

// (5) AMÉLIORATION « ÉQUIPES » : le DÉBIT par équipe DOUBLE PAR NIVEAU (×2) —
// l'usure est retirée PLUS VITE (le goulot « usure » est amélioré), la PRIORITÉ
// R29 (la plus usée d'abord) est INCHANGÉE.
test('R31 (5) : l\'amélioration équipes améliore SON goulot (l\'usure part plus vite)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  buildBuilding(sim, 'cleaning', 350, 950);
  const g = M_GATES(sim); g[0].cleaning = 90; g[1].cleaning = 50;
  cleanGates(sim, 10);
  const drain0 = sim._teamActivity.cleaning[t.id].drain;
  assert.equal(drain0, 10, `niveau 0 : budget 1 équipe × 1/s × 10 s = 10 (R29) : ${drain0}`);
  // La PRIORITÉ est inchangée : la porte la PLUS USÉE (g0) est servie d'abord.
  assert.equal(sim._teamActivity.cleaning[t.id].servedGate, g[0].id, 'priorité R29 inchangée (la plus usée d\'abord)');
  // (ré-initialisation de l'activité pour une mesure propre du niveau 1)
  sim._teamActivity = {};
  buyUpgrade(sim, t.id, 'teams');
  cleanGates(sim, 10);
  const drain1 = sim._teamActivity.cleaning[t.id].drain;
  assert.equal(drain1, 20, `niveau 1 : débit ×2 → budget 20 (l'usure part PLUS VITE) : ${drain1}`);
  assert.equal(sim._teamActivity.cleaning[t.id].servedGate, g[0].id, 'la priorité (R29) reste inchangée au niveau 1');
});

// (6) SAUVEGARDE/REPRIE : le NIVEAU ET le COÛT DÉJÀ PAYÉ sont RESTITUÉS (on ne
// re-débite JAMAIS au chargement) ; une sauvegarde ANCIENNE (sans upgrades)
// est TOLÉRÉE (niveau 0) ; un niveau NON INTIER est REJETÉ (pas de NaN).
test('R31 (6) : la reprise restitue niveau + coût payé (pas de re-débitement ; sauvegarde ancienne tolérée)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  buyUpgrade(sim, t.id, 'terminal'); buyUpgrade(sim, t.id, 'terminal'); // niveau 2 (3000 $ payés)
  buyUpgrade(sim, t.id, 'fueling'); // niveau 1 (1200 $ payés)
  const money = sim.economy.money;
  const state = { screen: 'play', time: 0, terrain: 1, camera: null, sim };
  const r = deserialize(serialize(state));
  assert.equal(r.sim.upgrades[String(t.id)].terminal, 2, 'le NIVEAU terminal (2) est restitué');
  assert.equal(r.sim.upgrades[String(t.id)].fueling, 1, 'le NIVEAU fueling (1) est restitué');
  assert.equal(r.sim.economy.money, money, 'le COÛT déjà payé est conservé (pas de re-débitement au chargement)');
  // Sauvegarde ANCIENNE (champ `upgrades` absent) : tolérée, niveau 0 (pas de
  // propriété fantôme) — les multiplicateurs sont neutres (R31 (2)).
  state.sim.upgrades = undefined;
  const r2 = deserialize(serialize(state));
  assert.ok(r2.sim.upgrades && Object.keys(r2.sim.upgrades).length === 0, 'sauvegarde ancienne : upgrades = {} (niveau 0, tolérée)');
  assert.equal(upgradeLevel(r2.sim, t.id, 'terminal'), 0, 'niveau 0 (pas de propriété fantôme)');
  // Niveau NON INTIER (corruption) : la validation le REJETE (les
  // multiplicateurs feraient NaN dans la sim au 1er tick).
  state.sim.upgrades = { [String(t.id)]: { terminal: 'deux', fueling: 1, teams: 0 } };
  assert.throws(() => deserialize(serialize(state)), /non entier/, 'niveau non entier → sauvegarde REJETÉE (pas de NaN)');
});

// (7) VUE LISIBLE : le GOUTLE COURANT est nommé AVANT achat (le « mauvais
// achat » est COMPRÉHENSIBLE — le choix utile suit le goulot).
test('R31 (7) : le goulot est nommé avant achat (mauvais achat compréhensible)', () => {
  const sim = newSimState(); buildSocle(sim);
  const [t] = sim.infra.terminals;
  // Goulot « files » : des pax en attente (mesure la plus chargée).
  sim.passengers.queues[String(t.id)] = { checkin: 80, security: 20, board: 10 };
  const v = upgradeView(sim, t.id);
  assert.equal(v.bottleneck, 'files', 'goulot = les files (110 pax en file > usure 0 > plein 0)');
  assert.equal(v.bottleneckWhy.includes('passagers'), true, 'le motif est lisible (les passagers sont en file)');
  assert.equal(v.choices.find((c) => c.kind === 'terminal').useful, true, '« terminal » (capacité) est le choix utile');
  assert.equal(v.choices.find((c) => c.kind === 'fueling').useful, false, '« avitaillement » est INUTILE ici (le goulot n\'est pas le plein)');
  // Goulot « usure » : les portes s'usent, pas de pax en file.
  sim.passengers.queues[String(t.id)] = { checkin: 0, security: 0, board: 0 };
  M_GATES(sim).forEach((g) => { g.cleaning = 40; g.maintenance = 30; });
  const v2 = upgradeView(sim, t.id);
  assert.equal(v2.bottleneck, 'usure', 'goulot = l\'usure (140 points > files 0)');
  assert.equal(v2.choices.find((c) => c.kind === 'teams').useful, true, '« équipes » (débit de nettoyage) est le choix utile');
  assert.equal(v2.choices.find((c) => c.kind === 'terminal').useful, false, '« terminal » est INUTILE ici (le goulot n\'est pas les files)');
});
