// Tests finances BL-15 (NONMVP-4, AC6/AC9/AC23/AC26f) : l'économie a de la
// PROFONDEUR — la qualité ET les incidents se paient dans la TRÉSORERIE :
//   (1) SCÉNARIO DÉFICITAIRE exécuté : sous-équipé (pas de station carburant
//       → départs SÉCS, billets moitiés BL-12) + surdimensionné (hangars +
//       restauration : opex sans contrepartie) → le solde baisse, la faillite
//       est atteinte (intérêts), le bilan nomme les CAUSES (AC23).
//   (2) MÊME AÉROPORT AVEC UNE STATION (AC9 : l'amélioration utile) + mÊME
//       TRAFIC, mÊME DURÉE → les billets sont au PLEIN tarif et les recettes
//       paient tout : RENTABLE. L'effet de la décision est MESURABLE (A/B).
//   (3) satisfaction → finances (AC6) : à vol identique, satisfaction 50 %
//       encaisse MOITIÉ des billets ; 0 % : aucune recette (garde BL-05) mais
//       le carburant continue d'être payé (dépense, pas recette).
//   (4) incident → finances (AC6) : blocage persistant → vol ANNULÉ (A-5) →
//       indemnité passagers (compte spent.compensation, jamais une recette
//       négative), nommée en cause du déficit.
//   (5) bilan par PÉRIODE (AC23) : chaque compte est exposé (recettes /
//       exploitation / carburant / indemnités / investissements), le net se lit.
// Zéro DOM, déterministe : les vols sont semés DIRECTEMENT en phase « refuel »
// (on saute approach/landing/taxi/docking et leur pathfinding) : la phase
// refuel EST le point où la station carburant agit (lance, saturation, départ
// sec) — on isole la TRÉSORERIE du reste du cycle avion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickAircraft } from '../src/sim/aircraft.mjs';
import { tickEconomy, tickPassengers } from '../src/economy/economy.mjs';
import { onGateDeparted, periodStatement } from '../src/economy/economy.mjs';

// Socle : piste + taxiway + terminal 4 portes (le même plan que BL-12/BL-14).
function buildSocle(sim) {
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
}

// Aéroport SURDIMENSIONNÉ (AC6 : un aéroport surdimensionné peut PERDRE) :
// un hangar + une salle de restauration — leur opex est payée, leur utilité
// marginale (files vides, usure lente).
function overBuild(sim) {
  buildBuilding(sim, 'hangar', 100, 200);
  buildBuilding(sim, 'catering', 400, 200);
}

// Débloque les services (seuil passagers) et met assez de trésorerie.
function unlock(sim) {
  sim.passengers.totalCarried = 300;
  sim.economy.money = 100000;
}

// 16 vols medium semés DIRECTEMENT en phase « refuel » sur les 2 portes M
// (16 = 8 par porte : saturation sérielle mesurée, mais le TRAFIC est assez
// dense pour que la perte de PLEIN TARIFF (départ sec) PÈSE PLUS que l'opex
// évitée — c'est ce qui rend le scénario SANS station DÉFICITAIRE, A/B AC9).
const N_FLIGHTS = 16;
function seedFlights(sim) {
  const M = sim.infra.gates.filter((g) => g.size === 'M');
  const rw = sim.infra.runways[0];
  for (let i = 0; i < N_FLIGHTS; i++) {
    sim.aircraft.push({
      id: sim.nextAcId++, airline: 'atlantique', color: '#1e88e5', acType: 'medium', pax: 160,
      phase: 'refuel', x: 0, y: 0, gateId: M[i % 2].id, runwayId: rw.id,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
  }
}

// Avance la sim un temps FIXE (A/B comparable) : avion + éco + passagers.
// 1 heure de jeu sim (fenêtre A/B : les 16 vols sont terminés bien avant
// (~950 s) ; le reste est de l'exploitation pure — elle tranche les
// scénarios, comme en jeu). Calcul SANS station : net = 32 000 − 27 720
// (opex 7,7 $/s × 3600) − 1 280 (carburant) − 8 400 (investissements)
// = −5 400 $ → DÉFICITAIRE. AVEC station : net = 64 000 − 42 120 − 1 280
// − 9 600 = +11 000 $ → RENTABLE.
const DT = 0.1;
const TICKS = 36000; // 3600 s de jeu (une heure simulée)
function runSim(sim) {
  for (let i = 0; i < TICKS; i++) {
    tickAircraft(sim, DT);
    tickEconomy(sim, DT);
    tickPassengers(sim, DT);
  }
}

// 1) SCÉNARIO DÉFICITAIRE exécuté : sous-équipé (PAS de station carburant →
//    départs secs, billets moitiés) + surdimensionné (opex des services) →
//    le solde BAISSE, puis la faillite est atteinte (intérêts) et le bilan
//    nomme les CAUSES du déficit (AC23).
test('AC6/AC23 : scénario DÉFICITAIRE exécuté (sous-équipé + surdimensionné)', () => {
  const sim = newSimState();
  buildSocle(sim);
  unlock(sim);
  overBuild(sim); // surdimensionné
  // Sous-équipé : NE PAS construire de station carburant.
  seedFlights(sim);
  runSim(sim);
  assert.equal(sim.aircraft.every((a) => a.phase === 'departed'), true, 'les 16 vols se sont déroulés');
  assert.ok(sim.aircraft.every((a) => a._dryDeparture), 'débuts secs : la qualité s est vue dans les billets');
  assert.ok(sim.economy.revenue.pax < N_FLIGHTS * 160 * 25, 'billets < plein tarif (départs secs)');
  assert.ok(sim.economy.spent.fuel > 0, 'carburant payé (dépense dédiée)');
  const st = periodStatement(sim);
  assert.ok(st.net < 0, 'le scénario est DÉFICITAIRE (net négatif : les recettes ne paient pas tout)');
  // La faillite EST atteignable : l exploitation creuse le déficit, les
  // intérêts sur la dette s aggravent (tickEconomy seul, plus de recettes).
  while (!sim.economy.bankrupt && sim.economy.money > -100000) tickEconomy(sim, 1);
  assert.equal(sim.economy.bankrupt, true, 'faillite déclarée (seuil −10 000 $)');
  assert.ok(sim.alerts.some((a) => a.kind === 'bankrupt'), 'événement faillite pour l UI');
  assert.ok(st.causes.length > 0, 'le bilan LISE les causes du déficit');
  assert.ok(st.causes.some((c) => c.includes('exploitation')), 'l exploitation est nommée');
  assert.ok(st.causes.some((c) => c.includes('carburant')), 'le carburant est nommé');
});

// 2) MÊME AÉROPORT + MÊME TRAFIC + MÊME DURÉE, AVEC LA STATION CARBURANT
//    (AC9 : l'amélioration CONSTRUCTIBLE utile) → RENTABLE : les billets sont
//    au plein tarif et les recettes paient l exploitation ET l investissement.
test('AC6/AC9 : MÊME aéroport AVEC station = RENTABLE (A/B mesurable)', () => {
  const sim = newSimState();
  buildSocle(sim);
  unlock(sim);
  overBuild(sim);
  buildBuilding(sim, 'fuel', 450, 300); // LA station (l amélioration)
  seedFlights(sim);
  const before = sim.economy.money;
  runSim(sim);
  assert.equal(sim.aircraft.every((a) => a.phase === 'departed'), true, 'les 16 vols se sont déroulés');
  assert.ok(sim.aircraft.every((a) => !a._dryDeparture), 'plus aucun départ sec (station opérationnelle)');
  assert.equal(sim.economy.revenue.pax, N_FLIGHTS * 160 * 25, 'billets au PLEIN tarif');
  const st = periodStatement(sim);
  assert.ok(st.revenue > st.opex + st.fuel + st.invest, 'les recettes paient exploitation + carburant + investissements');
  assert.ok(st.net > 0, 'scénario RENTABLE exécuté');
  assert.ok(sim.economy.money > before, 'le solde a MONTE');
  assert.equal(sim.economy.bankrupt, false, 'pas de faillite');
});

// 3) satisfaction → finances (AC6) : à vol identique, la recette est
//    PROPORTIONNELLE à la satisfaction (100 % plein tarif, 50 % moitié),
//    et la faillite reste évitable : 0 % bloque les recettes (garde BL-05)
//    mais le carburant continue d'être payé (dépense, jamais recette négative).
test('AC6 : la satisfaction est une variable ÉCONOMIQUE', () => {
  const make = () => {
    const sim = newSimState();
    buildSocle(sim);
    sim.aircraft.push({
      id: sim.nextAcId++, airline: 'atlantique', acType: 'medium', pax: 160,
      phase: 'disembark', x: 0, y: 0, gateId: sim.infra.gates[0].id, runwayId: sim.infra.runways[0].id,
      delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate',
    });
    return sim;
  };
  const dep = (s) => { onGateDeparted(s, s.aircraft[0]); return s; };
  const a = make(), b = make();
  b.passengers.satisfaction = 50; // qualité dégradée (files, BL-13)
  const r100 = dep(a).economy, r50 = dep(b).economy;
  assert.equal(r100.revenue.pax, 160 * 25, 'satisfaction 100 % : plein tarif');
  assert.equal(r50.revenue.pax, 160 * 25 * 0.5, 'satisfaction 50 % : moitié des billets');
  assert.ok(r50.money < r100.money, 'le solde est BASSE (qualité dégradée)');
  // Et la faillite reste GUERRABLE : satisfaction 0 % bloque les recettes
  // (garde BL-05) mais le carburant continue d être payé (dépense, pas recette).
  const c = make();
  c.passengers.satisfaction = 0;
  const before = c.economy.money;
  onGateDeparted(c, c.aircraft[0]);
  assert.equal(c.economy.revenue.pax, undefined, 'satisfaction 0 % : aucune recette');
  assert.equal(c.economy.spent.fuel, 160 * 0.5, 'le carburant est payé quand même');
  assert.equal(c.economy.money, before - 80, 'le solde baisse du carburant seul');
});

// 4) incident → finances (AC6) : blocage persistant → vol ANNULÉ (A-5) →
//    indemnité passagers (compte spent.compensation, JAMAIS une recette
//    négative), exposée dans le bilan et nommée en cause du déficit.
test('AC6 : un incident (blocage persistant) coûte une INDEMNITÉ', () => {
  const sim = newSimState();
  buildSocle(sim);
  const rw = sim.infra.runways[0];
  // Avion en « exit » sans chemin possible : on COUPE le taxiway vers sa porte.
  sim.infra.taxiways = [];
  rebuildGraph(sim); sim._graphDirty = false;
  const ac = { id: sim.nextAcId++, airline: 'solaire', color: '#f0a', acType: 'small', pax: 5,
    phase: 'exit', x: 800, y: 1100, gateId: null, runwayId: rw.id,
    delayed: 0, timer: 0, path: null, pathPtr: 0, seg: null, heading: 'gate' };
  sim.aircraft.push(ac);
  tickAircraft(sim, 0.1); // → blocked
  for (let i = 0; i < 7000; i++) tickAircraft(sim, 0.1); // 700 s ≥ 600 s (A-5)
  assert.equal(ac.phase, 'cancelled', 'blocage persistant → vol annulé (A-5)');
  assert.ok(sim.alerts.some((e) => e.kind === 'flight-cancelled' && e.volId === ac.id), 'cause visible (alerte)');
  assert.ok(sim.economy.spent.compensation >= 500, "l indemnité est payée (compte dédié)");
  assert.equal(sim.economy.revenue['compensation'], undefined, 'jamais une « recette négative »');
  // Le bilan NOMME la cause : on creuse le déficit (exploitation seule) pour
  // que le bilan soit déficitaire et que les causes se lisent.
  for (let i = 0; i < 400; i++) tickEconomy(sim, 1);
  const st = periodStatement(sim);
  assert.ok(st.net < 0, 'bilan déficitaire (exploitation + indemnité)');
  assert.ok(st.compensation >= 500, 'le bilan EXPOSE le compte indemnités');
  assert.ok(st.causes.some((c) => c.includes('indemnités')), 'les indemnités sont nommées en cause');
});

// 5) bilan par PÉRIODE (AC23) : chaque compte est EXPOSÉ et SÉPARÉ —
//    construction ≠ exploitation ≠ carburant ≠ indemnités — et le net se lit.
test('AC23 : bilan par période — comptes séparés + net lisible', () => {
  const sim = newSimState();
  buildSocle(sim);
  unlock(sim); // la station carburant exige le seuil de 100 pax (progression)
  buildBuilding(sim, 'fuel', 100, 200); // un INVESTISSEMENT (construction)
  const st = periodStatement(sim);
  assert.equal(st.invest, 2500 + 400 + 3000 + 1200, 'les constructions sont comptées en INVESTISSEMENTS');
  assert.equal(st.opex, 0, 'exploitation nulle (aucun tick économique)');
  assert.equal(st.fuel, 0, 'carburant nul (aucun vol)');
  assert.equal(st.compensation, 0, 'indemnités nulles (aucun incident)');
  assert.equal(st.net, -(st.invest), 'net lisible : ici = −investissements');
  assert.ok(st.causes.some((c) => c.includes('investissements')), 'la cause est nommée');
});
