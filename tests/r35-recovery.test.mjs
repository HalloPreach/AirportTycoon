// R35 (t_dabe90d7) — DÉFICIT récupérable + faillite EXPLICITE.
//   1. l'emprunt borné (LOAN) : un seul par partie, liquidité N'EST PAS une
//      recette (jamais dans revenue, R11) ; principal / intérêts / liquidités
//      DISTINCTS (principal = ligne de crédit du bilan, intérêts = compte
//      dédié `debt`, liquidités = solde) ; non-obtenable indéfiniment.
//   2. l'ALERTE de TRÉSORERIE : deux niveaux (s'amenuit / s'approfondit) avec
//      cooldown (pas de spam) ; ignorer les avertissements mène à la faillite.
//   3. le redressement : un déficit modéré se RÉCUPÈRE par une action
//      raisonnable (l'emprunt) ; sans action, la pente atteint le seuil.
//   4. l'écran de faillite : bilan + reprise (resumeAfterBankruptcy) +
//      nouvelle partie (UI) ; sauvegarde / retour menu cohérents (le champ
//      `loan` migre, la reprise restaure principal + bornes).
// Zéro DOM, déterministe (pattern r11/r12) ; l'écran est testé par son contrat
// (flag de sim → open/fermé, bouton de reprise émet la commande, UI fine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import {
  DEBT, LOAN, TREASURY,
  tickEconomy, periodStatement,
  loanState, takeLoan, ensureLoan,
  treasuryAlerts, checkBankruptcy, resumeAfterBankruptcy,
  earn,
} from '../src/economy/economy.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// --- 0. PARAMÈTRES : le taux et la borne sont paramétrés (une seule politique)
test('R35 — le taux s\'applique sur une PÉRIODE EXPLICITE paramétrée (DEBT)', () => {
  assert.equal(DEBT.ratePerSec, 0.01, 'taux par défaut = 1 %/s (R11/D5)');
  assert.equal(DEBT.baseCap, 10000, 'cap par défaut = 10 000 (R11/D5)');
  assert.equal(DEBT.periodSec, 300, 'période explicite = 300 s (5 min, R16)');
  assert.ok(Object.isFrozen(DEBT), 'les paramètres de taux sont figés');
});

test('R35 — l\'emprunt et l\'alerte sont BORNAUX (paramètres, pas de dur)', () => {
  assert.equal(LOAN.maxLoans, 1, 'UN seul emprunt par partie (pas indéfini)');
  assert.ok(LOAN.principal > 0 && LOAN.rate > 0, 'principal + taux d\'intérêts > 0');
  assert.ok(TREASURY.warn.below > TREASURY.critical.below, 'deux niveaux (warn puis critical)');
  assert.ok(TREASURY.critical.below > -10000, 'le niveau critique précède le seuil de faillite');
  assert.ok(TREASURY.cooldownSec > 0, 'un cooldown borne la re-prévention (pas de spam)');
});

// --- 1. L'EMPRUNT : borné, non-recette, distinction principal/intérêts -----
test('R35 — l\'emprunt est BORNE : un seul par partie, le 2e est refusé', () => {
  const sim = newSimState();
  const r1 = takeLoan(sim);
  assert.equal(r1.ok, true, 'le 1er emprunt est obtenu');
  assert.equal(sim.economy.loan.count, 1, 'le compteur d\'emprunts = 1');
  assert.equal(loanState(sim).available, false, 'l\'emprunt n\'est plus disponible (borne)');
  const r2 = takeLoan(sim);
  assert.equal(r2.ok, false, 'le 2e emprunt est REFUSÉ (non-obtenable indéfiniment)');
  assert.ok(r2.reason && r2.reason.includes('max'), 'le refus a un motif lisible');
  assert.equal(sim.economy.loan.count, 1, 'le refus ne change PAS le compteur (pas de mutation)');
});

test('R35 — l\'emprunt n\'est PAS une recette d\'exploitation (jamais dans revenue)', () => {
  const sim = newSimState();
  sim.passengers.satisfaction = 100;
  earn(sim, 250, 'pax'); // une recette RÉELLE de référence
  const revBefore = sim.economy.revenue.pax;
  takeLoan(sim);
  assert.equal(sim.economy.revenue.pax, revBefore, 'l\'emprunt N\'ALIMENTE PAS revenue');
  const st = periodStatement(sim);
  // Le solde porte l'emprunt (liquidité) ET la recette séparément — mais
  // revenue ne compte que la recette, jamais le crédit de l'emprunt.
  assert.equal(st.revenue, 250, 'revenue = la seule recette réelle (pas l\'emprunt)');
  assert.equal(st.loan, LOAN.principal, 'le principal est une LIGNE de crédit du bilan');
});

test('R35 — PRINCIPAL / INTÉRÊTS / LIQUIDITÉS sont DISTINCTS', () => {
  const sim = newSimState();
  sim.economy.money = 0; // l'identité EV-9/R12 est mesurée sur un solde à 0 (la référence)
  const before = sim.economy.money;
  const r = takeLoan(sim);
  assert.equal(r.principal, LOAN.principal, 'le principal obtenu (paramètre)');
  assert.equal(r.interest, Math.round(LOAN.principal * LOAN.rate), 'les intérêts = taux × principal');
  // LIQUIDITÉS = ce qui reste EN MAIN (le solde augmente de la liquidité nette).
  const netLiquidity = sim.economy.money - before;
  assert.equal(netLiquidity, LOAN.principal - r.interest, 'la liquidité nette en main = principal − intérêts');
  // PRINCIPAL DÛ (la dette envers la banque) est SÉPARÉ des intérêts facturés
  // (compte dédié `debt`, l'identité EV-9 / R12 : la dette y est comptée 1×).
  assert.equal(sim.economy.loan.principal, LOAN.principal, 'le principal dû (l\'encours)');
  assert.equal(sim.economy.debt, r.interest, 'les intérêts vont au compte dédié `debt`');
  const st = periodStatement(sim);
  // Le bilan RAPPORCHE le solde : la ligne de crédit (principal) compense la
  // dette (intérêts) — money == net à l'équilibre (R12 étendu à l'emprunt).
  assert.ok(Math.abs(sim.economy.money - st.net) < 1e-9, 'le bilan se rapproche du solde (EV-9/R12)');
});

// --- 2. L'ALERTE DE TRÉSORERIE : deux niveaux + cooldown --------------------
test('R35 — l\'alerte de TRÉSORERIE sonne les 2 niveaux (puis un cooldown, pas de spam)', () => {
  const sim = newSimState();
  sim.economy.money = -9000; // sous critical (−5 000), au-dessus du seuil (−10 000)
  treasuryAlerts(sim);
  const kinds = sim.alerts.map((a) => a.kind).filter((k) => k.startsWith('treasury'));
  assert.ok(kinds.includes('treasury-warn'), 'le niveau « s\'amenuit » a sonné');
  assert.ok(kinds.includes('treasury-critical'), 'le niveau « s\'approfondit » a sonné');
  // COOLDOWN : re-appeler dans la même fenêtre ne re-prévient PAS (pas de spam).
  sim.alerts.length = 0;
  treasuryAlerts(sim); // sim.time n'avance pas (0) → toujours dans le cooldown
  const again = sim.alerts.map((a) => a.kind).filter((k) => k.startsWith('treasury'));
  assert.equal(again.length, 0, 'aucune re-alerte dans le cooldown (pas de spam)');
  // Le cooldown EXPIRE : après cooldownSec, la même condition re-prévient.
  sim.time = TREASURY.cooldownSec;
  treasuryAlerts(sim);
  assert.ok(sim.alerts.length >= 1, 'après le cooldown, l\'alerte re-sonne (la condition persiste)');
});

// --- 3. IGNORER LES AVERTISSEMENTS → FAILLITE (mesurable) ------------------
test('R35 — ignorer les avertissements conduit à la FAILLITE', () => {
  const sim = newSimState();
  sim.economy.money = -9500; // sous le niveau critique (−5 000), au-dessus du seuil (−10 000)
  // La pente (opex + intérêts sur l'assiette capée) est RÉELLE : on avance la
  // sim TICK PAR TICK sans aucune action — c'est l'ignorer (ne pas emprunter).
  let t = 0;
  while (!sim.economy.bankrupt && t < 300) { tickEconomy(sim, 1); t += 1; }
  assert.ok(t < 300, 'la faillite est ATTEIGNE (la pente franchit le seuil, bornée)');
  assert.equal(sim.economy.bankrupt, true, 'sans action, la faillite est atteinte (mesurable)');
  // L'avertissement critique a sonné AVANT la faillite (l'ordre des événements)
  const kinds = sim.alerts.map((a) => a.kind);
  const iCrit = kinds.indexOf('treasury-critical');
  const iBk = kinds.indexOf('bankrupt');
  assert.ok(iCrit !== -1, 'le niveau critique « s\'approfondit » a sonné (avertissement)');
  assert.ok(iBk !== -1, 'l\'événement « bankrupt » est poussé');
  assert.ok(iCrit < iBk, 'l\'avertissement PRÉCÈDE la faillite (ordre mesurable)');
  assert.ok(sim.economy.money < -10000, 'le solde est au-dessous du seuil de faillite');
});

// --- 4. LE REDRESSEMENT : un déficit modéré se RÉCUPÈRE --------------------
test('R35 — un déficit modéré se RÉCUPÈRE par une action raisonnable (l\'emprunt)', () => {
  const sim = newSimState();
  sim.economy.money = -800; // déficit modéré (au-dessus du seuil, sous la trésorerie)
  treasuryAlerts(sim); // l'avertissement « s'amenuit » sonne (−800 < 4000)
  assert.ok(sim.alerts.some((a) => a.kind === 'treasury-warn'), 'l\'alerte de trésorerie a sonné');
  takeLoan(sim); // l'action raisonnable : l'emprunt borné
  assert.ok(sim.economy.money > 0, 'le solde est RENDU POSITIF (le déficit est récupéré)');
  assert.equal(sim.economy.bankrupt, false, 'la faillite n\'est PAS atteinte (action à temps)');
});

// --- 5. L'ÉCRAN DE FAILLITE : reprise + nouvelle partie (contrat) ----------
test('R35 — l\'écran de faillite : reprise (la sim reprend) ; non failli = refus lisible', () => {
  const sim = newSimState();
  const no = resumeAfterBankruptcy(sim);
  assert.equal(no.ok, false, 'sans faillite, la reprise est refusée avec un motif');
  assert.ok(no.reason, 'le motif est lisible');
  checkBankruptcy(sim); // n'atteint pas le seuil (solde sain) → pas en faillite
  sim.economy.bankrupt = true; // simule la faillite (le seuil est franchi ailleurs)
  const r = resumeAfterBankruptcy(sim);
  assert.equal(r.ok, true, 'en faillite, la reprise est possible');
  assert.equal(sim.economy.bankrupt, false, 'le flag de faillite est LEVÉ (la sim repart)');
  assert.ok(sim.alerts.some((a) => a.kind === 'bankruptcy-resumed'), 'l\'événement de reprise est poussé');
});

// --- 6. COMPATIBILITÉ : la sauvegarde migre l'emprunt + survit à la reprise
test('R35 — la sauvegarde restaure l\'emprunt (principal + bornes) et tolère l\'absente', () => {
  // (a) une sauvegarde AVEC l'emprunt : la reprise le restaure (pas de reset).
  const state = makeGameState(42);
  state.screen = 'game';
  takeLoan(state.sim);
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(state))));
  assert.equal(loaded.sim.economy.loan.principal, LOAN.principal, 'le principal dû est restauré');
  assert.equal(loaded.sim.economy.loan.count, 1, 'la borne (nombre d\'emprunts) est restaurée');
  assert.equal(loanState(loaded.sim).available, false, 'la borne est RESTAURÉE (pas de 2e emprunt après reprise)');
  // (b) une sauvegarde ANCIENNE sans le champ `loan` : la migration le met en place.
  const raw = JSON.parse(serialize(state));
  delete raw.state.sim.economy.loan; // la sauvegarde pré-R35 n'a pas le champ
  const old = deserialize(JSON.stringify(raw));
  assert.ok(old.sim.economy.loan, 'le champ absent est TOLÉRÉ (la migration le crée)');
  assert.equal(old.sim.economy.loan.principal, 0, 'le principal migre à 0 (jamais de ré-débit au chargement)');
  assert.equal(old.sim.economy.loan.count, 0, 'le compteur migre à 0');
  ensureLoan(old.sim); // l'ensure est idempotent (déjà normalisé au chargement)
  assert.equal(loanState(old.sim).available, true, 'l\'emprunt est encore dispo après migration (borne intacte)');
});
