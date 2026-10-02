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
// BL-15 (AC6) : un vol ANNULLÉ (blocage persistant, A-5) coûte une indemnité
// passagers (compte spent.compensation, pas une recette négative — même
// discipline que le carburant, A-6) : l'incident a un coût financier lisible.
const COMP_FEE_PER_CANCEL = 500;
// D5 (R11, t_eef3e9c8) : taux d'intérêt PARAMÉTRÉ sur période — une SEULE
// politique (remplace le 1 %/s capé en dur de BL-18). Le taux ET la cap sont
// des paramètreS (pas de chiffres magiques dans le tick) : DEBT.ratePerSec =
// le taux (/s), DEBT.baseCap = la borne de l'assiette (BL-18 la fixait à
// −BANKRUPT_LIMIT). Même valeur par défaut → le comportement de référence ne
// bouge pas (fixtures R12/R35), mais la politique est réglable sans toucher la
// sim. La cap est le paramètre DU TAUX (pas un second mécanisme).
export const DEBT = Object.freeze({
  ratePerSec: 0.01,  // 1 %/s (BL-18) — paramètre D5
  baseCap: 10000,    // borne de l'assiette (BL-18 : −BANKRUPT_LIMIT) — paramètre D5
});

export function canAfford(sim, cost) { return sim.economy.money >= cost; }

// R11 (t_eef3e9c8) : une dépense dédiée EST payée MÊME EN DÉFICIT — le solde
// baisse (dette réelle), jamais refusée silencieusement. L'ancien garde
// « si fonds insuffisants → ne payer » faisait que le carburant / l'indemnité
// sautaient quand la trésorerie était déjà creusée : l'incident n'avait alors
// aucun coût (compte spent vierge) et le déficit réel restait invisible. La
// garde est levée : `charge` débitte TOUJOURS (le solde peut devenir négatif),
// le compte `spent[cat]` reste alimenté → le bilan lis la dépense, le solde
// montre la dette. (La faillite, elle, vient de checkBankruptcy sous tickEconomy.)
export function charge(sim, cost, cat) {
  sim.economy.money -= cost;
  sim.economy.spent[cat] = (sim.economy.spent[cat] ?? 0) + cost;
}

// Encaisse une recette (catégorie pour les stats).
// BL-05 (A13) : satisfaction 0 % = aéroport que plus personne ne sert → aucune
// recette ne croît tant qu'elle ne remonte (les vols se purgent, pas de revenus).
// BL-15 (AC6) : la satisfaction EST une variable économique — la recette est
// PROPORTIONNELLE à la satisfaction (100 % = plein, 50 % = moitié) : la qualité
// dégradée se paie en recettes, pas seulement en satisfaction « cosmétique ».
export function earn(sim, amount, cat) {
  const sat = sim.passengers?.satisfaction ?? 100;
  if (sat <= 0) return; // pas de croissance en insatisfaction totale
  const m = amount * sat / 100; // recette multipliée par la satisfaction
  sim.economy.money += m;
  sim.economy.revenue[cat] = (sim.economy.revenue[cat] ?? 0) + m;
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
// BL-12 (AC21) : départ SÉC (pas de station carburant, ac._dryDeparture) →
// billets MOITIÉS : l'absence du service a un coût ÉCONOMIQUE visible (et non
// bloquant — le vol part, l'événement « no-fuel » l'explique).
export function onGateDeparted(sim, ac) {
  earn(sim, ac.pax * (ac._dryDeparture ? 12.5 : 25), 'pax');
  charge(sim, ac.pax * FUEL_COST_PER_PAX, 'fuel');
}

// BL-15 (AC6) : indemnité vol annulé — l'incident a un coût financier VISIBLE
// (compte spent.compensation, jamais une recette négative). Appelé par le
// module avions à l'annulation d'un vol (blocage persistant, A-5) : l'effet
// « incident → finances » du critère AC6 est mesurable (charge, pas earn).
export function onFlightCancelled(sim) {
  charge(sim, COMP_FEE_PER_CANCEL, 'compensation');
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
  // BL-18 : l'assiette des intérêts est CAPÉE au seuil de faillite (BANKRUPT_LIMIT) —
  // l'ancien code (Math.abs(money) * 0.01 * dt, assiette non bornée) créait une
  // boule de neige : au-delà de −10 000 l'intérêt (1 %/s) dépassait n'importe quel
  // flux et le solde restait VERROUILLÉ au seuil (la sim gelait, la partie perdait
  // tout son sens après ~3 h). Capée, la dette reste lisible et la faillite reste
  // ATTEIGNABLE (le solde peut toujours franchir −10 000 : la pente opex le fait).
  if (sim.economy.money < 0) {
    // D5 (R11, t_eef3e9c8) : taux PARAMÉTRÉ (DEBT.ratePerSec) + cap = paramètre
    // DU taux (DEBT.baseCap) — une seule politique, remplace le 1 %/s capé en
    // dur de BL-18. Même valeurs par défaut (0,01 / 10 000) → le comportement de
    // référence ne bouge pas (fixtures R12/R35). Le champ historique `debt`
    // reste l'accumulateur d'intérêts ; sa réinterprétation (dépense dédiée,
    // rapprochement du solde) est le travail de la carte ENFANT R12.
    const base = Math.min(Math.abs(sim.economy.money), DEBT.baseCap);
    const interest = base * DEBT.ratePerSec * dt;
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
// recettes / exploitation / carburant / indemnités / investissements, avec
// les CAUSES du déficit quand le solde est négatif (AC23 : un bilan qui se
// lit, pas un chiffre). BL-15 : l'investissement = le compte CONSTRUCTION
// (bâtiments payés, démolition remboursée dans revenue) — séparé du carburant
// (dépense des départs) et des indemnités vols annulés (spent.compensation).
export function periodStatement(sim) {
  const e = sim.economy;
  const revenue = Object.values(e.revenue).reduce((a, b) => a + b, 0);
  const opex = e.spent.opex ?? 0;
  const fuel = e.spent.fuel ?? 0;
  const compensation = e.spent.compensation ?? 0;
  const invest = e.spent.construction ?? 0;
  const net = revenue - opex - fuel - invest - compensation;
  const causes = [];
  if (net < 0) {
    if (opex > 0) causes.push(`exploitation ${Math.round(opex)} $ (socle + services)`);
    if (fuel > 0) causes.push(`carburant ${Math.round(fuel)} $`);
    if (compensation > 0) causes.push(`indemnités vols annulés ${Math.round(compensation)} $`);
    if (invest > 0) causes.push(`investissements ${Math.round(invest)} $`);
    if (e.debt > 0) causes.push(`intérêts sur la dette ${Math.round(e.debt)} $`);
    if (!causes.length) causes.push('solde dû aux remboursements de démolition');
  }
  return { revenue, opex, fuel, compensation, invest, net, money: e.money, debt: e.debt, causes };
}

// tickPassengers : ré-export (le parcours passagers vit dans sim/passengers.mjs).
export { tickPassengers } from '../sim/passengers.mjs';
