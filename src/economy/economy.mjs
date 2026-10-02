// Économie : revenus (vols + passagers), coûts (construction + exploitation),
// déficit/faillite. Logique pure, mutue sim.economy.
// La satisfaction + le parcours passagers ont déménagé dans src/sim/passengers.mjs
// (BL-13, AC22/AC40) : `tickPassengers` est ré-exporté ici pour compatibilité
// (tick.mjs et les tests l'importaient d'ici).
// Recettes : atterrissage/porte au SOL, billets au DÉCOLLAGE.
import { pushEvent } from '../core/sim-state.mjs';
import { OPEX_PER_SEC } from '../data/catalog.mjs';

const FUEL_COST_PER_PAX = 0.5;   // carburant : coûté au départ (critère carburant)
const BANKRUPT_LIMIT = -10000;   // solde sous ce seuil = faillite

export function canAfford(sim, cost) { return sim.economy.money >= cost; }

// Débite le solde ; retourne false si fonds insuffisants (le coût n'est pas payé).
export function charge(sim, cost, cat) {
  if (sim.economy.money < cost) return false;
  sim.economy.money -= cost;
  sim.economy.spent[cat] = (sim.economy.spent[cat] ?? 0) + cost;
  return true;
}

// Encaisse une recette (catégorie pour les stats).
// BL-05 (A13) : satisfaction 0 % = aéroport que plus personne ne sert → aucune
// recette ne croît tant qu'elle ne remonte (les vols se purgent, pas de revenus).
export function earn(sim, amount, cat) {
  if (sim.passengers.satisfaction <= 0) return; // pas de croissance en insatisfaction totale
  sim.economy.money += amount;
  sim.economy.revenue[cat] = (sim.economy.revenue[cat] ?? 0) + amount;
}

// Atterri au sol : droits d'atterrissage + redevance porte.
export function onGateArrived(sim, ac) {
  earn(sim, 200, 'landing');
  earn(sim, 100, 'gate');
}

// Départ : recettes passagers (billets), puis carburant en DÉPENSE dédiée.
// BL-14 (A-6) : le carburant passe par `charge` (compte spent.fuel) — jamais une
// « recette négative » : l'ancien earn(-x, 'fuel-cost') contaminait revenue
// (bilan « recettes » faux) et, sous la garde satisfaction 0 %, la dépense
// carburant sautait silencieusement (elle passait aussi par earn).
export function onGateDeparted(sim, ac) {
  earn(sim, ac.pax * 25, 'pax');
  charge(sim, ac.pax * FUEL_COST_PER_PAX, 'fuel');
}

// Exploitation continue (BL-14, R8/A12) : le socle aéroportuaire (piste, taxiway,
// terminal) coûte MÊME SANS VOL, et chaque service ACTIF (construit) coûte aussi.
// Non protégée par canAfford : c'est une dépense fixe qui PEUT creuser le déficit
// (critère 8) ; la faillite vient ensuite si le solde reste trop négatif.
export function tickEconomy(sim, dt) {
  let opex = 0;
  for (const r of sim.infra.runways) opex += (OPEX_PER_SEC.runway ?? 0) * dt;
  for (const t of sim.infra.taxiways) opex += (OPEX_PER_SEC.taxiway ?? 0) * dt;
  for (const t of sim.infra.terminals) opex += (OPEX_PER_SEC.terminal ?? 0) * dt;
  for (const s of sim.infra.services) opex += (OPEX_PER_SEC[s.type] ?? 0) * dt;
  if (opex) {
    sim.economy.money -= opex;
    sim.economy.spent.opex = (sim.economy.spent.opex ?? 0) + opex;
  }
  // Déficit : si le solde est négatif, la dette s'aggrave (intérêts), puis faillite.
  if (sim.economy.money < 0) {
    const interest = Math.abs(sim.economy.money) * 0.01 * dt;
    sim.economy.debt += interest;
    sim.economy.money -= interest;
  }
  checkBankruptcy(sim);
}

// Faillite : solde trop négatif → on arrête la sim (le jeu reste jouable pour réagir).
export function checkBankruptcy(sim) {
  if (sim.economy.money < BANKRUPT_LIMIT && !sim.economy.bankrupt) {
    sim.economy.bankrupt = true;
    pushEvent(sim, { kind: 'bankrupt' });
  }
}

// Bilan par PÉRIODE (les compteurs sont cumulés depuis le début de la partie) :
// recettes / exploitation / carburant / investissements, avec les CAUSES du
// déficit quand le solde est négatif (AC23 : un bilan qui se lit, pas un chiffre).
export function periodStatement(sim) {
  const e = sim.economy;
  const revenue = Object.values(e.revenue).reduce((a, b) => a + b, 0);
  const opex = e.spent.opex ?? 0;
  const fuel = e.spent.fuel ?? 0;
  // Investissements = tout ce qui a été payé en BÂTIMENTS (clés de spent autres
  // qu'opex/fuel — construction, remboursement de démolition compris).
  const invest = Object.entries(e.spent).reduce(
    (a, [k, v]) => (k === 'opex' || k === 'fuel' ? a : a + v), 0);
  const net = revenue - opex - fuel - invest;
  const causes = [];
  if (net < 0) {
    if (opex > 0) causes.push(`exploitation ${Math.round(opex)} $ (socle + services)`);
    if (fuel > 0) causes.push(`carburant ${Math.round(fuel)} $`);
    if (invest > 0) causes.push(`investissements ${Math.round(invest)} $`);
    if (e.debt > 0) causes.push(`intérêts sur la dette ${Math.round(e.debt)} $`);
    if (!causes.length) causes.push('solde dû aux remboursements de démolition');
  }
  return { revenue, opex, fuel, invest, net, money: e.money, debt: e.debt, causes };
}

// tickPassengers : ré-export (le parcours passagers vit dans sim/passengers.mjs).
export { tickPassengers } from '../sim/passengers.mjs';
