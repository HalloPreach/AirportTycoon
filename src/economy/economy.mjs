// Économie : revenus (vols + passagers), coûts (construction + exploitation),
// déficit/faillite, satisfaction passagers. Logique pure, mutue sim.economy + sim.passengers.
// Recettes : atterrissage/porte au SOL, billets au DÉCOLLAGE.
import { pushEvent } from '../core/sim-state.mjs';

const OPEX_PER_SEC = { fuel: 4, hangar: 2, maintenance: 1.5, catering: 2.5 };
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

// Départ : recettes passagers (billets) − carburant.
export function onGateDeparted(sim, ac) {
  earn(sim, ac.pax * 25, 'pax');
  earn(sim, -ac.pax * FUEL_COST_PER_PAX, 'fuel-cost'); // le carburant est une dépense
}

// Exploitation continue : chaque service ACTIF coûte (seulement s'il est construit).
// Non protégée par canAfford : c'est une dépense fixe qui PEUT creuser le déficit
// (critère 8) ; la faillite vient ensuite si le solde reste trop négatif.
export function tickEconomy(sim, dt) {
  let opex = 0;
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

// Satisfaction : les services de confort la soutiennent, les retards la dégradent.
// Mutue sim.passengers.satisfaction (0..100).
export function tickPassengers(sim, dt) {
  const p = sim.passengers;
  // Les services de confort font remonter la satisfaction (max 100).
  const comfort = (sim.infra.services.some((s) => s.type === 'catering') ? 0.2 : 0)
                + (sim.infra.services.some((s) => s.type === 'maintenance') ? 0.1 : 0);
  if (comfort) p.satisfaction = Math.min(100, p.satisfaction + comfort * dt);
  // Retards ACTUELS (en holding / bloqués) → insatisfaction.
  // BL-05 (A13) : on ne compte PAS `a.delayed > 0` — ce compteur cumulé n'est
  // jamais remis à zéro, donc UN retard ancien condamnerait la satisfaction à
  // 0 % définitivement (le spec exige une satisfaction évolutive).
  const delayed = sim.aircraft.filter((a) => a.phase === 'holding' || a.phase === 'blocked').length;
  if (delayed) p.satisfaction = Math.max(0, p.satisfaction - 0.2 * delayed * dt);
}
