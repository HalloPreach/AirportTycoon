// T2-2 (t_6344db94) — VICTOIRE + STATS PERSISTANTES + SUCCÈS.
// La VICTOIRE est un but MESURABLE de l'état sim (règle R21 : pas de
// compteur « réputation ») : les 3 contrats de la saison réglés RÉUSSIS
// (countCampaignWin, appelé par le règlement unique des contrats) AVANT
// l'échéance de la saison (CAMPAIGN.deadline) ; l'échéance dépassée sans 3
// succès = ÉCHEC. Persistance via l'état sim (sérialisé par save.mjs — EV-10),
// jamais une variable module. Vérifications (zéro DOM, déterministe,
// rng semé — zéro navigateur) :
//   1. L'état NEUF n'a PAS le champ (lazy) ; ensureCampaign le crée
//      (status 'active', 0 succès, prime non payée) ; campaignView lit.
//   2. 3 contrats réussis → VICTOIRE : la prime (2 500 $) est créditée
//      ATOMIQUEMENT (status + flag + earn dans la même écriture) + l'événement
//      « campaign-won » ; idempotent (un 2e tick ne re-credite PAS).
//   3. ÉCHEC : l'échéance dépassée avec < 3 succès → « lost » + l'événement
//      « campaign-lost », pas de prime ; la victoire est prioritaire sur
//      l'échéance (3 succès même après la deadline = gagnée).
//   4. Faillite : une sim en faillite ne paie PAS la prime (R22) — la
//      victoire est retenue quand la faillite est levée (R35).
//   5. Sauvegarde PRÉ-T2-2 (champ absent) : la campagne est créée fraîche
//      (pas de crash, pas de faux état) ; stats : ADOPTION de la baseline
//      (une période déjà close n'est PAS re-comptée) ; succès : aucun faux
//      déblocage. Persistance : serialize → deserialize, la campagne
//      gagnée reste gagnée et la prime n'est PAS re-payée (EV-10).
//   6. STATS : une période close net ≥ 0 prolonge la SÉRIE sans déficit
//      (net < 0 la remet à 0, le record est gardé) ; une transition
//      d'incidents (actif → terminé) compte 1 incident SURVIVU ; le
//      bénéfice est la mesure live des comptes (pas un 2e compteur).
//   7. SUCCÈS : 8 succès à conditions MESURABLES ; un déblocage pousse UN
//      événement « achievement-unlocked » (jamais un second — le flag
//      verrouille, comme le `paid` des objectifs R22) ; les identifiants
//      sont STABLES (sérialisés) : la reprise reprend les débloqués.
//   8. LE TICK DÉCIDE : tick() (l'orchestrateur) alimente les 3 modules —
//      un contrat réussi réglé par le tick compte pour la saison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState, pushEvent } from '../src/core/sim-state.mjs';
import { tick } from '../src/core/tick.mjs';
import { closePeriod, lastPeriod } from '../src/economy/economy.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';
import { logFlightEnd } from '../src/sim/aircraft.mjs';
import {
  CAMPAIGN, CAMPAIGN_STATUSES, ensureCampaign, countCampaignWin,
  tickCampaign, campaignView,
} from '../src/progression/campaign.mjs';
import {
  activeIncidentCount, ensureStats, tickStats, profitOf, statsView,
} from '../src/progression/stats.mjs';
import {
  ACHIEVEMENTS, ensureAchievements, tickAchievements,
  achievementsView, unlockedCount,
} from '../src/progression/achievements.mjs';
import { ensureQuality } from '../src/progression/quality.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// ---- 1. État neuf : lazy, la campagne démarre « active », zéro faux état --
test('T2-2 : l’état neuf n’a pas le champ (lazy) ; ensureCampaign le crée', () => {
  const sim = newSimState();
  assert.equal(sim.campaign, undefined, 'le champ est ABSENT au départ (lazy)');
  const c = ensureCampaign(sim);
  assert.equal(c.status, 'active', 'la campagne démarre active');
  assert.equal(c.wins, 0, 'zéro succès au départ');
  assert.equal(c.rewardPaid, false, 'la prime n’est pas payée');
  const v = campaignView(sim);
  assert.equal(v.wins, 0);
  assert.equal(v.target, CAMPAIGN.target);
  assert.equal(v.status, 'active');
  assert.ok(v.left > 0, 'il reste du temps avant l’échéance');
});

// ---- 2. VICTOIRE : 3 succès → prime ATOMIQUE + événement, idempotent -----
test('T2-2 : 3 contrats réussis → victoire, prime payée UNE fois (idempotent)', () => {
  const sim = newSimState();
  const money = sim.economy.money;
  const campBefore = (sim.economy.revenue?.campaign) ?? 0;
  tickCampaign(sim); // 0 succès : rien
  assert.equal(sim.economy.money, money, 'aucune prime avant 3 succès');
  for (let i = 0; i < CAMPAIGN.target; i++) countCampaignWin(sim);
  tickCampaign(sim); // 3 succès AVANT l’échéance, hors faillite → VICTOIRE
  assert.equal(ensureCampaign(sim).status, 'won', 'la campagne est GAGNÉE');
  assert.equal(ensureCampaign(sim).rewardPaid, true, 'la prime est marquée payée');
  assert.equal(sim.economy.money, money + CAMPAIGN.reward, 'la prime est créditée au solde');
  assert.equal(sim.economy.revenue.campaign - campBefore, CAMPAIGN.reward,
    'la prime passe par le compte revenue dédié (comptabilisable)');
  assert.ok(sim.alerts.some((a) => a.kind === 'campaign-won'), 'l’événement « campaign-won » est poussé');
  tickCampaign(sim); tickCampaign(sim); // 2e/3e tick : JAMAIS de re-credit
  assert.equal(sim.economy.money, money + CAMPAIGN.reward, 'idempotent : pas de double prime');
  assert.equal(sim.alerts.filter((a) => a.kind === 'campaign-won').length, 1,
    'un seul événement de victoire');
});

// ---- 3. ÉCHEC : échéance dépassée sans 3 succès ; victoire prioritaire ---
test('T2-2 : échéance dépassée avec < 3 succès → échec (pas de prime)', () => {
  const sim = newSimState();
  sim.time = CAMPAIGN.deadline + 1; // l’échéance est dépassée
  countCampaignWin(sim); countCampaignWin(sim); // 2 succès seulement
  const money = sim.economy.money;
  tickCampaign(sim);
  assert.equal(ensureCampaign(sim).status, 'lost', 'la campagne est PERDUE');
  assert.equal(sim.economy.money, money, 'aucune prime à l’échec');
  assert.ok(sim.alerts.some((a) => a.kind === 'campaign-lost'), 'l’événement « campaign-lost » est poussé');
  tickCampaign(sim); // idempotent : plus rien
  assert.equal(sim.alerts.filter((a) => a.kind === 'campaign-lost').length, 1,
    'un seul événement d’échec');
  // LA VICTOIRE est prioritaire sur l’échéance : 3 succès = gagnée même après
  const sim2 = newSimState();
  sim2.time = CAMPAIGN.deadline + 10;
  for (let i = 0; i < CAMPAIGN.target; i++) countCampaignWin(sim2);
  tickCampaign(sim2);
  assert.equal(ensureCampaign(sim2).status, 'won', '3 succès avant réglage = gagnée (mesure, pas temps)');
  assert.equal(ensureCampaign(sim2).rewardPaid, true, 'la prime est payée malgré l’échéance dépassée');
});

// ---- 4. Faillite : la sim stoppée ne paie PAS la prime (R22) -------------
test('T2-2 : en faillite la prime n’est pas payée ; reprise (R35) → gagnée', () => {
  const sim = newSimState();
  sim.economy.bankrupt = true; // la sim est stoppée
  for (let i = 0; i < CAMPAIGN.target; i++) countCampaignWin(sim);
  tickCampaign(sim);
  assert.equal(ensureCampaign(sim).status, 'active', 'faillite : la victoire est RETENUE (pas de prime)');
  assert.equal(ensureCampaign(sim).rewardPaid, false, 'aucun paiement en faillite (R22)');
  sim.economy.bankrupt = false; // la faillite est levée (reprise R35)
  tickCampaign(sim);
  assert.equal(ensureCampaign(sim).status, 'won', 'la victoire se règle à la reprise');
  assert.equal(ensureCampaign(sim).rewardPaid, true, 'la prime est payée à la reprise');
});

// ---- 5. Sauvegarde PRÉ-T2-2 (champ absent) + persistance (EV-10) ---------
test('T2-2 : sauvegarde PRÉ-T2-2 → campagne FRAÎCHE ; la victoire persiste', () => {
  const sim = newSimState();
  delete sim.campaign; // sauvegarde d’une partie PRÉ-T2-2 (champ absent)
  countCampaignWin(sim); // pas de crash : le champ est créé
  assert.equal(ensureCampaign(sim).wins, 1, 'la campagne fraîche compte depuis zéro');
  // Persistance : une campagne GAGNÉE traverse serialize → deserialize
  for (let i = 0; i < CAMPAIGN.target; i++) countCampaignWin(sim);
  tickCampaign(sim);
  assert.equal(ensureCampaign(sim).status, 'won');
  const money = sim.economy.money;
  const state2 = deserialize(serialize({ screen: 'play', time: 1, terrain: 1, camera: null, sim })); // l'état entier voyage (EV-10)
  const sim2 = state2.sim; // deserialize renvoie l'ÉTAT (la sim = .sim)
  assert.equal(sim2.campaign.status, 'won', 'la victoire survit à la reprise');
  assert.equal(sim2.campaign.rewardPaid, true, 'le flag de prime survit (jamais de re-paiement)');
  tickCampaign(sim2);
  assert.equal(sim2.economy.money, money, 'le tick post-reprise ne re-paie PAS la prime');
});

// ---- 6. STATS : série sans déficit, incidents survivus, bénéfice live ----
test('T2-2 : stats — série sans déficit (record gardé) + période close', () => {
  const sim = newSimState();
  tickStats(sim); // création (lazy) — aucune période close encore
  const st = ensureStats(sim);
  assert.equal(st.periodsClosed, 0);
  assert.equal(st.nonDeficit.current, 0);
  // Une période net ≥ 0 close → la série passe à 1 (comptée : sim fraîche)
  sim.economy.revenue.pax = 5000; // recette depuis la base (période nette positive)
  sim._periodBase = { revenue: 0, opex: 0, fuel: 0, compensation: 0, construction: 0, debt: 0 };
  closePeriod(sim);
  tickStats(sim);
  assert.equal(ensureStats(sim).periodsClosed, 1, 'la 1re période close est COMPTÉE (sim fraîche)');
  assert.equal(ensureStats(sim).nonDeficit.current, 1, 'la série passe à 1 (net ≥ 0)');
  // Une période net < 0 close → la série revient à 0, le RECORD est gardé
  sim.economy.revenue.pax = 0;
  sim._periodBase = { revenue: 8000, opex: 0, fuel: 0, compensation: 0, construction: 0, debt: 0 }; // déficit
  sim.time += 1;
  closePeriod(sim);
  tickStats(sim);
  const st2 = ensureStats(sim);
  assert.equal(st2.nonDeficit.current, 0, 'la série est ROMPUE (net < 0)');
  assert.equal(st2.nonDeficit.best, 1, 'le record de série est gardé');
  assert.equal(st2.periodsClosed, 2, 'la 2e période close est comptée');
  assert.equal(lastPeriod(sim).net < 0, true, 'la période close est bien nette < 0 (la mesure)');
});

test('T2-2 : stats — ADOPTION de la baseline (sauvegarde PRÉ-T2-2)', () => {
  const sim = newSimState();
  // Une période est close AVANT le module (sauvegarde PRÉ-T2-2 rechargée)
  sim.economy.revenue.pax = 5000;
  sim._periodBase = { revenue: 0, opex: 0, fuel: 0, compensation: 0, construction: 0, debt: 0 };
  closePeriod(sim);
  tickStats(sim); // création + ADOPTION : la période déjà close n’est PAS comptée
  assert.equal(ensureStats(sim).periodsClosed, 0, 'la période pré-module n’est pas re-comptée');
  assert.equal(ensureStats(sim).lastPeriodAt, lastPeriod(sim).at, 'la baseline est adoptée (horodatage)');
  assert.equal(ensureStats(sim).nonDeficit.current, 0, 'la série se compte à partir de la SUIVANTE');
  // La période SUIVANTE est comptée
  sim.time += 1;
  sim.economy.revenue.pax = 5000;
  sim._periodBase = { revenue: 0, opex: 0, fuel: 0, compensation: 0, construction: 0, debt: 0 };
  closePeriod(sim);
  tickStats(sim);
  assert.equal(ensureStats(sim).periodsClosed, 1, 'la période SUIVANTE est comptée');
});

test('T2-2 : stats — incidents survivus (transition actif → terminé)', () => {
  const sim = newSimState();
  // La sim neuve n'a PAS de piste (le joueur la construit) — on en place une
  // minimale (la cible du forçage existe, comme après un placement réel)
  sim.infra.runways.push({ id: 1, x: 0, y: 0, w: 40, h: 8, len: 1200 });
  tickStats(sim); // baseline (zéro incident actif)
  assert.equal(activeIncidentCount(sim), 0);
  forceIncident(sim, 'runway:1'); // la piste 1 fermée (1 incident actif)
  const rwId = 1;
  assert.equal(activeIncidentCount(sim), 1, 'la mesure active (incidents.mjs) compte la piste fermée');
  tickStats(sim); // transition 0 → 1 : rien à compter (un incident ne S'ACHÈVE pas)
  assert.equal(ensureStats(sim).incidentsSurvived, 0, 'un incident DÉMARRÉ n’est pas « survécu »');
  sim.incidents.runways[rwId].remaining = 0; // l’incident s’achève (la piste rouvre)
  tickStats(sim); // transition 1 → 0 : un incident a se TERMINÉ = un survivu
  assert.equal(ensureStats(sim).incidentsSurvived, 1, 'l’incident terminé compte 1 survivu');
});

test('T2-2 : stats — le bénéfice est la mesure live des comptes', () => {
  const sim = newSimState();
  assert.equal(profitOf(sim), 0, 'zéro au départ');
  sim.economy.revenue.fee = 3000; // recettes cumulées
  sim.economy.spent.opex = 800; // dépenses cumulées
  sim.economy.loan = { principal: 5000, count: 2 }; // emprunts cumulés (R35)
  sim.economy.debt = 500; // intérêts cumulés (compte dédié, R12)
  assert.equal(profitOf(sim), 3000 + 5000 - 800 - 500,
    'recettes + emprunt − dépenses − intérêts (les comptes, pas un 2e compteur)');
  const v = statsView(sim);
  assert.equal(v.profit, 6700, 'le bénéfice est la même mesure (vues = lecture)');
  assert.equal(v.paxTotal, (sim.passengers?.totalCarried ?? 0), 'pax = le compteur EXISTANT');
});

// ---- 7. SUCCÈS : 8 conditions mesurables, 1 événement, jamais un second -
test('T2-2 : succès — 8 succès, identifiants stables, 1 événement par déblocage', () => {
  const sim = newSimState();
  assert.equal(ACHIEVEMENTS.length, 8, 'huit succès');
  assert.ok(ACHIEVEMENTS.every((c) => c.id && c.name && c.desc && typeof c.cond === 'function'),
    'chaque succès a un identifiant stable + une condition mesurable');
  assert.equal(unlockedCount(sim), 0, 'aucun succès au départ (pas de faux déblocage)');
  sim.passengers.totalCarried = 120; // 2 conditions pax remplies (100 ET 500 ? non : 120 ≥ 100 seul)
  tickAchievements(sim);
  assert.equal(unlockedCount(sim), 1, 'un seul succès débloqué (pax-100)');
  assert.ok(sim.alerts.some((a) => a.kind === 'achievement-unlocked' && a.id === 'pax-100'),
    'l’événement « achievement-unlocked » porte l’identifiant');
  tickAchievements(sim); tickAchievements(sim); // idempotent : JAMAIS un second
  assert.equal(sim.alerts.filter((a) => a.kind === 'achievement-unlocked').length, 1,
    'un seul événement de déblocage (le flag verrouille, pattern R22)');
  // Série sans déficit (streak-6) + incidents survivus (survivor-5) : la mesure
  const st = ensureStats(sim);
  st.nonDeficit.best = 6;
  st.incidentsSurvived = 5;
  ensureQuality(sim); sim.quality.q = 0.9; // palier QUALITÉ (mesure live)
  logFlightEnd(sim, { id: sim.nextAcId++, acType: 'medium', delayed: 0 }, false); // la mesure R17 (vol fini)
  // Les conditions RESTANTES (pax-500, balance-50k, profit-period) : la mesure
  sim.passengers.totalCarried = 1200; // 500 ET 100 (les deux pax)
  sim.economy.money = 60000; // le solde (balance-50k)
  sim.economy.revenue.fee = 5000; // une période close AVEC bénéfice (profit-period)
  sim._periodBase = { revenue: 0, opex: 0, fuel: 0, compensation: 0, construction: 0, debt: 0 };
  closePeriod(sim);
  tickAchievements(sim);
  const view = achievementsView(sim);
  for (const id of ['streak-6', 'survivor-5', 'quality-2']) {
    assert.ok(view.find((a) => a.id === id).unlocked, `${id} est débloqué (condition mesurée)`);
  }
  // La victoire de la campagne débloque le dernier (season-won)
  for (let i = 0; i < CAMPAIGN.target; i++) countCampaignWin(sim);
  tickCampaign(sim); // → won
  tickAchievements(sim);
  assert.ok(achievementsView(sim).find((a) => a.id === 'season-won').unlocked,
    '« season-won » suit la victoire de la campagne');
  assert.equal(unlockedCount(sim), 8, 'les 8 succès sont débloqués (la mesure est complète)');
});

test('T2-2 : succès — persistance (un débloqué reste débloqué, sans re-événement)', () => {
  const sim = newSimState();
  sim.passengers.totalCarried = 120;
  tickAchievements(sim);
  assert.equal(unlockedCount(sim), 1);
  const state2 = deserialize(serialize({ screen: 'play', time: 1, terrain: 1, camera: null, sim })); // l'état entier voyage (EV-10)
  const sim2 = state2.sim; // deserialize renvoie l'ÉTAT
  assert.equal(unlockedCount(sim2), 1, 'le succès débloqué survit à la reprise');
  assert.equal(sim2.alerts.length, sim.alerts.length, 'aucun événement ajouté par la reprise');
  tickAchievements(sim2); // le tick post-reprise ne RE-débloque PAS (flag persistant)
  assert.equal(sim2.alerts.filter((a) => a.kind === 'achievement-unlocked').length,
    sim.alerts.filter((a) => a.kind === 'achievement-unlocked').length,
    'pas de second événement de déblocage après la reprise');
});

// ---- 8. LE TICK DÉCIDE : l’orchestrateur alimente les 3 modules ----------
test('T2-2 : le tick (orchestrateur) alimente campagne/stats/succès', () => {
  const sim = newSimState();
  const state = { screen: 'game', sim, paused: false };
  // 3 ticks neufs : pas de crash, les champs sont créés (lazy) sans faux état
  tick(state, 1); tick(state, 1); tick(state, 1);
  assert.equal(ensureCampaign(sim).status, 'active');
  assert.equal(unlockedCount(sim), 0, 'aucun faux succès avant le fait');
  // Un contrat réussi réglé par LE TICK (le règlement unique) compte pour la
  // saison : le panneau est une LECTURE (campaignView), la sim est la source.
  for (let i = 0; i < CAMPAIGN.target; i++) countCampaignWin(sim); // le règlement
  tick(state, 1);
  assert.equal(ensureCampaign(sim).status, 'won', 'le tick règle la victoire (pas l’UI)');
  assert.equal(ensureCampaign(sim).rewardPaid, true, 'la prime est créditée par le tick');
  assert.ok(campaignView(sim).text.includes('gagnée'), 'le panneau lit la victoire (lecture)');
});

// ---- Rétrocompatibilité : un tick sur une sim PRÉ-T2-2 (champs absents) --
test('T2-2 : le tick ne crashe pas sur une sim PRÉ-T2-2 (champs absents)', () => {
  const sim = newSimState();
  delete sim.campaign; delete sim.stats; delete sim.achievements;
  const state = { screen: 'game', sim, paused: false };
  tick(state, 1); // champs créés paresseusement (pattern R31/R32)
  assert.equal(ensureCampaign(sim).status, 'active', 'la campagne fraîche (pas de faux état)');
  assert.equal(ensureStats(sim).nonDeficit.current, 0, 'les stats fraiches');
  assert.equal(unlockedCount(sim), 0, 'aucun faux succès');
});

// ---- Échec : la partie CONTINUE (la campagne est un but, pas un game-over)
test('T2-2 : après un échec la partie continue (aucun game-over)', () => {
  const sim = newSimState();
  sim.time = CAMPAIGN.deadline + 1;
  tickCampaign(sim); // zéro succès, échéance dépassée → lost
  assert.equal(ensureCampaign(sim).status, 'lost');
  tick(state2(sim), 1); // le tick ne lève PAS (la sim continue)
  assert.equal(ensureCampaign(sim).status, 'lost', 'l’état est stable (idempotent)');
  assert.ok(CAMPAIGN_STATUSES.includes(ensureCampaign(sim).status), 'état borné');
  function state2(s) { return { screen: 'game', sim: s, paused: false }; }
});
