// Économie : revenus (vols + passagers), coûts (construction + exploitation),
// déficit/faillite. Logique pure, mutue sim.economy.
// La satisfaction + le parcours passagers ont déménagé dans src/sim/passengers.mjs
// (BL-13, AC22/AC40) : `tickPassengers` est ré-exporté ici pour compatibilité
// (tick.mjs et les tests l'importaient d'ici).
// Recettes : atterrissage/porte au SOL, billets au DÉCOLLAGE.
import { pushEvent } from '../core/sim-state.mjs';
import { OPEX_PER_SEC } from '../data/catalog.mjs';

export const FUEL_COST_PER_PAX = 0.5;   // carburant : coûté au départ (critère carburant)
// R19 : les montants UNITAIRES du cycle avion (billets, droits, carburant) sont
// exportés : planNote (flights.mjs) les réutilise pour le « revenu estimé »
// (hypothèse lisible de l'offre planning) — UNE seule source, pas de chiffres
// copiés dans l'UI. PAX_REVENUE : billets pleins ; sans station carburant le
// départ est SEC (ac._dryDeparture) → billets MOITIÉS (PAX_REVENUE_DRY).
export const PAX_REVENUE = 25;
export const PAX_REVENUE_DRY = 12.5;  // billets moitiés (départ sec, BL-12)
export const LANDING_FEE = 200;       // droits d'atterrissage (onGateArrived)
export const GATE_FEE = 100;          // redevance porte (onGateArrived)
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
  // R35 (t_dabe90d7) : le taux s'applique sur une PÉRIODE EXPLICITE — 5 min,
  // la période financière (R16) : l'intérêt d'une période = ratePerSec ×
  // periodSec × assiette (1 %/s × 300 s = 3 % de l'assiette par période),
  // bornée par la cap (D5 : une seule politique — le paramètre de période,
  // pas un 2e mécanisme).
  periodSec: 300,
});

// R35 (t_dabe90d7) : le redressement BORNÉ — un emprunt UNIQUE par partie.
// L'emprunt n'est PAS une recette d'exploitation (jamais dans revenue) et ne
// peut pas être obtenu indéfiniment (maxLoans) : c'est une liquidité qui
// s'ajoute au solde, avec ses intérêts facturés UNE fois à la conclusion
// (compte `debt`, comme le taux D5 : le bilan reste à l'équilibre, R12).
export const LOAN = Object.freeze({
  principal: 5000, // la liquidité obtenue
  rate: 0.05,      // 5 % d'intérêts (facturés une fois, à la conclusion)
  maxLoans: 1,     // BORNE : un seul emprunt par partie (pas indéfini)
});

// R35 (t_dabe90d7) : l'ALERTE de TRÉSORERIE — deux niveaux (la trésorerie
// s'amenuise, puis le déficit s'approfondit) avec un COOLDOWN (pas de spam :
// on ne re-prévient un niveau que s'il n'a pas été atteint depuis cooldownSec).
// Ignorer les avertissements mène à la faillite (BANKRUPT_LIMIT, mesurable).
export const TREASURY = Object.freeze({
  warn: { below: 4000, kind: 'treasury-warn' },        // sous 4 000 $ : « s'amenuit »
  critical: { below: -5000, kind: 'treasury-critical' }, // sous −5 000 $ : « dette s'approfondit »
  cooldownSec: 300, // 5 min : on ne re-prévient pas plus souvent un niveau
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

// Atterri au sol : droits d'atterrissage + redevance porte (constantes R19).
export function onGateArrived(sim, ac) {
  earn(sim, LANDING_FEE, 'landing');
  earn(sim, GATE_FEE, 'gate');
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
    // référence ne bouge pas (fixtures R12/R35).
    // R12 (t_25614b63) : `debt` est le COMPTE DÉDIÉ des intérêts (pas un
    // principal d'emprunt, ne PAS le réinterpréter comme tel) : il CUMULE
    // l'intérêt chargé, et le solde est chargé d'intérêts UNE fois (money -= i).
    // L'identité trésorerie EV-9 (money = START + recettes − dépenses − debt)
    // tient car la dette y est déjà comptée ; periodStatement la met dans net
    // pour que le bilan se RAPPORCHE au solde.
    const base = Math.min(Math.abs(sim.economy.money), DEBT.baseCap);
    const interest = base * DEBT.ratePerSec * dt;
    sim.economy.debt += interest;
    sim.economy.money -= interest;
  }
  // R16 : clôture des périodes financières (5 min de jeu) — compteur
  // accumulateur : `dt` = 0 (pause) ne clôt rien, un gros tick non plus.
  if (dt > 0) {
    sim.economy._periodAcc = (sim.economy._periodAcc ?? 0) + dt;
    while (sim.economy._periodAcc >= PERIOD_S) {
      closePeriod(sim);
      sim.economy._periodAcc -= PERIOD_S;
    }
  }
  // R35 (t_dabe90d7) : l'ALERTE de TRÉSORERIE (deux niveaux, cooldown) —
  // AVANT checkBankruptcy : le niveau critique prévient encore le tick où la
  // faillite est atteinte (l'avertissement précède la faillite, mesurable).
  treasuryAlerts(sim);
  checkBankruptcy(sim);
}

// R35 (t_dabe90d7) : ALERTE de TRÉSORERIE — deux niveaux (TREASURY : la
// trésorerie s'amenuise, puis le déficit s'approfondit) avec COOLDOWN (pas de
// spam : on ne re-prévient un niveau que s'il n'a pas été atteint depuis
// cooldownSec — le compteur vit sur la sim → la reprise est cohérente).
// C'est l'avertissement AVANT la faillite : l'ignorer (ne pas emprunter)
// laisse la pente (opex + intérêts) atteindre BANKRUPT_LIMIT (mesurable, test).
// L'UI lit sim.alerts (toasts) — la sim décide, l'UI affiche (UI fine).
export function treasuryAlerts(sim) {
  const e = sim.economy;
  if (e.bankrupt) return; // la sim est stoppée : plus d'alertes (l'écran de faillite les remplace)
  const now = sim.time ?? 0;
  const last = e._treasuryAlerts || (e._treasuryAlerts = {}); // sauvegarde ancienne : absent → 1re alerte
  for (const lvl of [TREASURY.warn, TREASURY.critical]) {
    const due = last[lvl.kind] == null || now - last[lvl.kind] >= TREASURY.cooldownSec;
    if (e.money < lvl.below && due) {
      pushEvent(sim, { kind: lvl.kind, money: Math.round(e.money), below: lvl.below });
      last[lvl.kind] = now;
    }
  }
}

// R35 (t_dabe90d7) : EMPRUNT — le redressement BORNÉ (LOAN : un seul par
// partie, liquidité + intérêts facturés UNE fois à la conclusion). PATRON R33
// (réponse opérationnelle) : LECTURE pure (loanState : conséquences AVANT la
// décision) + COMMANDE (takeLoan : validation AVANT toute écriture — refus
// = motif lisible, SANS mutation partielle). L'emprunt n'est PAS une recette
// d'exploitation (jamais dans revenue, R11) : c'est une liquidité ; ses
// intérêts vont au compte dédié `debt` (l'identité EV-9 tient, R12 : le
// principal est une ligne de crédit du bilan, comptée UNE fois).
export function ensureLoan(sim) {
  const e = sim.economy;
  if (!e) return; // simulation sans module économie (sauvegarde très ancienne) — rien à migrer
  if (!isLoanObj(e.loan)) e.loan = { principal: 0, count: 0 }; // sauvegarde ancienne / absente
}
const isLoanObj = (l) => l && typeof l === 'object'
  && (l.principal == null || typeof l.principal === 'number')
  && (l.count == null || typeof l.count === 'number');

// LECTURE pure (pattern R33) : l'emprunt est-il encore possible, à quel coût —
// le panneau affiche les conséquences AVANT le clic.
export function loanState(sim) {
  ensureLoan(sim);
  const l = sim.economy.loan;
  const interest = Math.round(LOAN.principal * LOAN.rate);
  const taken = l.count >= LOAN.maxLoans;
  return {
    available: !taken,
    count: l.count, max: LOAN.maxLoans,
    principal: LOAN.principal, interest,
    netLiquidity: LOAN.principal - interest, // ce qui reste EN MAIN après les intérêts
    reason: taken ? `emprunt déjà obtenu (${LOAN.maxLoans} max par partie)` : null,
  };
}

// COMMANDE : validation AVANT toute écriture (refus = motif, pas de mutation
// partielle) ; l'écriture est UN BLOC (la sim est l'unique écrivain).
export function takeLoan(sim) {
  ensureLoan(sim);
  const e = sim.economy;
  if (e.bankrupt) return { ok: false, reason: 'faillite : la sim est stoppée (reprendre ou nouvelle partie)' };
  const ls = loanState(sim);
  if (!ls.available) return { ok: false, reason: ls.reason };
  e.loan.count += 1;
  e.loan.principal += LOAN.principal; // le principal DÛ (le distingue des intérêts/liquidités)
  e.money += LOAN.principal - ls.interest; // la liquidité nette (PAS revenue — R11)
  e.debt += ls.interest;                    // les intérêts, compte dédié (EV-9 : comptés une fois)
  pushEvent(sim, { kind: 'loan-taken', principal: LOAN.principal, interest: ls.interest });
  return { ok: true, principal: LOAN.principal, interest: ls.interest };
}

// R35 (t_dabe90d7) : REPRISE après faillite — la sim était stoppée (le tick
// rentrait par l'entrée : sim.economy.bankrupt). Le joueur choisit de
// REPRISE (la sim continue depuis le bilan) : le flag est levé, un événement
// lisible est poussé. La NOUVELLE PARTIE est du côté UI (menu, main.mjs) —
// la sim ne décide pas de la renaissance du jeu.
export function resumeAfterBankruptcy(sim) {
  const e = sim.economy;
  if (!e.bankrupt) return { ok: false, reason: 'pas en faillite (rien à reprendre)' };
  e.bankrupt = false;
  pushEvent(sim, { kind: 'bankruptcy-resumed' });
  return { ok: true };
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
  ensureLoan(sim); // l'état de l'emprunt est normalisé (sauvegarde ancienne)
  const revenue = Object.values(e.revenue).reduce((a, b) => a + b, 0);
  const opex = e.spent.opex ?? 0;
  const fuel = e.spent.fuel ?? 0;
  const compensation = e.spent.compensation ?? 0;
  const invest = e.spent.construction ?? 0;
  const interest = e.debt; // R12 : compte dédié des intérêts (ledger de l'identité EV-9)
  // R35 (t_dabe90d7) : l'EMPRUNT (redressement borné) — la distinction
  // PRINCIPAL / INTÉRÊTS / LIQUIDITÉS exigée par la carte : le principal est
  // une ligne de CRÉDIT du bilan (l'argent obtenu, pas une recette — R11) ;
  // les intérêts sont dans le compte dédié `debt` (ci-dessus, EV-9 : la dette
  // est comptée UNE fois, R12) ; la liquidité = ce qui reste EN MAIN (solde).
  const loan = e.loan ? e.loan.principal : 0;
  // R12 (t_25614b63) : le net COMPTABILISE la dette (compte dédié) — le bilan se
  // RAPPORCHE au solde : money (partant de 0) == net. L'intérêt est chargé UNE
  // fois du solde (tickEconomy) et cumulé ici ; le −debt de l'identité EV-9
  // couvre cette ligne. R35 : le principal emprunté est la ligne de crédit qui
  // compense les intérêts facturés (le bilan reste à l'équilibre du solde).
  const net = revenue + loan - opex - fuel - invest - compensation - interest;
  const causes = [];
  if (net < 0) {
    if (opex > 0) causes.push(`exploitation ${Math.round(opex)} $ (socle + services)`);
    if (fuel > 0) causes.push(`carburant ${Math.round(fuel)} $`);
    if (compensation > 0) causes.push(`indemnités vols annulés ${Math.round(compensation)} $`);
    if (invest > 0) causes.push(`investissements ${Math.round(invest)} $`);
    if (interest > 0) causes.push(`intérêts sur la dette ${Math.round(interest)} $`);
    if (!causes.length) causes.push('solde dû aux remboursements de démolition');
  }
  return { revenue, opex, fuel, compensation, invest, net, money: e.money, debt: interest, loan, causes };
}

// R16 (t_007f2297) : périodes financières stables + prévision simple.
// PÉRIODE = 5 min de jeu (stable et mesurable, échelle R15). La clôture est un
// COMPTEUR accumulateur (pattern _spawnAcc, flights.mjs) : un gros tick ne
// duplique pas, 0 s de jeu (pause → tick à 0) ne clôt rien. Chaque PÉRIODE =
// delta des comptes CUMULÉS depuis la clôture précédente (les composants
// reconstituent le net — l'identité R12, dette comptée une fois) ; on garde
// les 4 dernières (borné, comme R14) : prévision + lisible.
export const PERIOD_S = 300;
const MAX_PERIODS = 4;
const sumObj = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0);
const baseSnapshot = (e) => ({ revenue: sumObj(e.revenue), opex: e.spent.opex ?? 0,
  fuel: e.spent.fuel ?? 0, compensation: e.spent.compensation ?? 0,
  construction: e.spent.construction ?? 0, debt: e.debt || 0 });

// Clôt la période en cours : delta des comptes depuis la base, net par
// l'identité R12 (recettes − dépenses − dette, comptée une fois).
export function closePeriod(sim) {
  const e = sim.economy;
  if (!Array.isArray(e.periods)) e.periods = []; // sauvegarde ancienne sans le champ
  const b = e._periodBase || baseSnapshot(e);
  const p = {
    at: sim.time ?? 0, // fin de période (s de jeu, lisible)
    minutes: PERIOD_S / 60,
    revenue: sumObj(e.revenue) - b.revenue,
    opex: (e.spent.opex ?? 0) - b.opex,
    fuel: (e.spent.fuel ?? 0) - b.fuel,
    compensation: (e.spent.compensation ?? 0) - b.compensation,
    invest: (e.spent.construction ?? 0) - b.construction,
    debt: (e.debt || 0) - b.debt,
  };
  p.net = p.revenue - p.opex - p.fuel - p.compensation - p.invest - p.debt;
  e.periods.push(p);
  if (e.periods.length > MAX_PERIODS) e.periods.shift(); // borné (R14)
  e._periodBase = baseSnapshot(e);
  return p;
}

// Prévision simple (R16/G2) : TENDANCE LINÉAIRE depuis la DERNIÈRE période
// close (net $/s de jeu, même échelle qu'OPEX_PER_SEC). SANS historique →
// null : la prévision est INDETERMINÉE, jamais un faux chiffre. L'étiquette
// « projection, pas une garantie » est rendue par l'UI (panneau financier).
export function lastPeriod(sim) {
  const p = sim.economy.periods; // peut être absent (sauvegarde ancienne, pas encore close)
  return Array.isArray(p) && p.length ? p[p.length - 1] : null;
}

export function forecast(sim) {
  const e = sim.economy;
  const p = lastPeriod(sim);
  if (!p) return null;
  const rate = p.net / (p.minutes * 60);
  return { rate, perHour: rate * 3600, horizon: 3600, projected: e.money + rate * 3600 };
}

// tickPassengers : ré-export (le parcours passagers vit dans sim/passengers.mjs).
export { tickPassengers } from '../sim/passengers.mjs';
