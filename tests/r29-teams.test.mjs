// R29 (t_9842f7a3) : DEBIT LIMITE + PRIORITE EXPLICITE des equipes.
// Nettoyage / maintenance ont un debit LIMITE et une REGLE DE PRIORITE
// explicite (la porte la plus usee d'abord, egalite la plus ancienne).
//   VALIDATION (carte R29) :
//     1. deux portes usees avec UNE equipe : ressources PARTAGEES (le budget
//        d'intervention est unique), PAS de reduction globale gratuite ;
//     2. la DEUXIEME equipe AMELIORE LE DELAI (double le debit) ;
//     3. AUCUNE porte n'est affamee indefiniment sous la politique par defaut.
// Zéro DOM, déterministe, sim seule (pas de tickPlanner). Même socle que R27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding, cleanGates, tickUnlocks } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';

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
const gatesOf = (sim, termId) => sim.infra.gates.filter((g) => g.terminalId === termId);
const sumWear = (gates, field) => gates.reduce((s, g) => s + (g[field] ?? 0), 0);

// (1) UNE equipe, DEUX portes usees : le budget d'intervention est PARTAGÉ.
// Avant R29 chaque equipe nettoyait TOUTES les portes à plein débit (reduction
// globale gratuite) : la somme d'usure baissait de `nbPortes × budget`. R29 :
// la somme ne baisse QUE du budget (une seule porte sert à la fois, la plus
// usee d'abord).
test('R29 (1) : 2 portes usees + 1 equipe = budget PARTAGÉ (pas de reduction globale)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  const [t] = sim.infra.terminals;
  buildBuilding(sim, 'cleaning', 350, 950); // 1 equipe, affectee a t
  const g = gatesOf(sim, t.id);
  g[0].cleaning = 90; g[1].cleaning = 50; // la plus usee = g0 (priorite)
  const before = sumWear(g, 'cleaning');
  cleanGates(sim, 10); // budget = 1 equipe × 1/s × 10 s = 10 unites
  const after = sumWear(g, 'cleaning');
  assert.equal(after, before - 10, `reduction = EXACTEMENT le budget (10), pas 2×10 (reduction globale) : ${before} → ${after}`);
  // Priorite : la porte la PLUS USEE (g0) est servie d'abord.
  assert.ok(g[0].cleaning < 90, `la porte la plus usee (g0) est nettoyée d'abord (90 → ${g[0].cleaning})`);
  assert.equal(g[1].cleaning, 50, `la 2e porte (g1) n'est PAS encore touchée (budget epuisé sur g0, stable 50)`);
  // Activite mesurée (l'UI la lit) : porte servie = g0, usure retiree = 10.
  const act = sim._teamActivity.cleaning[t.id];
  assert.equal(act.servedGate, g[0].id, `l'activite indique la porte servie (${act.servedGate})`);
  assert.equal(act.drain, 10, `l'usure retiree est mesurée (${act.drain})`);
  assert.equal(act.teams, 1, `l'activite compte l'equipe (1)`);
});

// (2) LA 2e equipe AMELIORE LE DELAI : avec 2 equipes le meme scenario se
// termine en MOINS de temps (le debit double).
test('R29 (2) : la 2e equipe AMELIORE LE DELAI (debit double) dans le scenario charge', () => {
  const make = (nTeams) => {
    const sim = newSimState(); buildSocle(sim); unlock(sim);
    const [t] = sim.infra.terminals;
    buildBuilding(sim, 'cleaning', 350, 950);
    if (nTeams > 1) buildBuilding(sim, 'cleaning', 300, 400); // 2e equipe sur le meme terminal
    const g = gatesOf(sim, t.id);
    g[0].cleaning = 60; g[1].cleaning = 60; // 2 portes chargees
    return { sim, t, g };
  };
  // Temps (s) pour que les 2 portes soient PROPREES (usure sale = 0).
  const timeToClean = (nTeams) => {
    const { sim, t, g } = make(nTeams);
    let s = 0;
    for (let i = 0; i < 5000 && sumWear(g, 'cleaning') > 0; i++) { cleanGates(sim, 1); s += 1; }
    return s;
  };
  const t1 = timeToClean(1), t2 = timeToClean(2);
  assert.ok(t2 < t1, `2 equipes : le delai est PLUS COURT (${t2}s < ${t1}s)`);
  assert.ok(t1 > t2 > 0, 'le scenario charge est resolu (les 2 equipes nettoient en moins de temps)');
});

// (3) AUCUNE porte n'est AFFAMEE INDEFINIMENT : avec une equipe et 3 portes
// usees, la porte la plus usee est servie d'abord ET toutes finissent propres
// (le budget se deplace de porte en porte, pas de porte abandonnee).
test('R29 (3) : aucune porte n est affamée indéfiniment (politique par defaut)', () => {
  const sim = newSimState(); buildSocle(sim); unlock(sim);
  const [t] = sim.infra.terminals;
  buildBuilding(sim, 'cleaning', 350, 950);
  const g = gatesOf(sim, t.id);
  g[0].cleaning = 90; g[1].cleaning = 30; g[2].cleaning = 30;
  // 200 s (200 ticks de 1 s) : budget total = 200 unites ≥ 90+30+30 = 150.
  for (let i = 0; i < 200; i++) cleanGates(sim, 1);
  assert.equal(sumWear(g, 'cleaning'), 0, `toutes les portes sont PROPREES (somme usure = 0, aucune affamée)`);
});
