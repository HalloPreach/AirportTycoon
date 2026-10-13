// R38 (t_8f8f4a63) — les TROIS scénarios rejouables : DÉMARRAGE GUIDÉ, DÉFI
// SATURATION, DÉFI REDRESSEMENT (src/scenarios.mjs) + R46 (t_7b04f863) : les
// trois NOUVEAUX scénarios CRISE TOTALE / DÉFI DIFFICILE / DÉFI FACILE
// (pic + piste fermée forçés dès le départ ; profils de difficulté T2-1).
// Chaque scénario rejoue la sim AVEC LE CŒUR DE PRODUCTION (tick.mjs + le
// PRNG de la sim, rng.mjs) :
//   • guide (seed 42)         : budget normal + l'objectif R22 o1-cycle ANNONCÉ
//                               ; la partie est REJOUABLE (même config → même
//                               partie, R09) ;
//   • saturation (seed 7)     : un pic est ACTIF dès le départ, avec la DURÉE
//                               EXPLICITE du défi (600 s, pas la durée naturelle
//                               90 s) + l'objectif R22 o2-surge ANNONCÉ ;
//   • redressement (seed 42)  : l'aéroport démarre EN DÉFICIT (-3000 $, au-
//                               dessus du seuil de faillite -10000 : la sim ne
//                               gèle PAS) ; l'emprunt borné (takeLoan, LA
//                               commande EXISTANTE R35 du joueur) est
//                               disponible pour remonter dans le vert.
// Les règles ne sont JAMAIS modifiées : le pic = forceIncident (action
// EXISTANTE, tests R33), l'emprunt = takeLoan (commande EXISTANTE, R35),
// l'objectif = un objectif R22 (la sim seule décide la réussite — le test ne
// la FORCE PAS, R16). La configuration vit sur `state.scenario` (sérialisée
// avec l'état entier → la partie scénario est sauvegardable/rechargeable, la
// config REPREND). Mode libre (makeGameState sans scenario) : AUCUN champ
// `scenario`, AUCUN objectif annoncé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { takeLoan } from '../src/economy/economy.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { isSurge, runwayClosed } from '../src/sim/incidents.mjs';
import { objectiveView } from '../src/progression/objectives.mjs';
import { DIFFICULTIES } from '../src/core/difficulty.mjs';
import { START_FUNDS } from '../src/core/sim-state.mjs';
import {
  SCENARIOS, startScenario, scenarioObjective, scenarioSuccess,
  SATURATION_SURGE_S, REDRESSEMENT_FUNDS, CRISIS_SURGE_S, CRISIS_RUNWAY_CLOSE_S,
} from '../src/scenarios.mjs';

// Rejoue N secondes de sim (cœur de production : tick + PRNG de la sim) avec
// une politique de décisions SIMPLE et DOCUMENTÉE (accept = accepter les vols
// planifiés, comme la case auto-accept du jeu). Lecture seule sur l'état final
// — aucune mutation du jeu, aucun objectif ne est forcé ici.
function play(state, sim, rng, seconds, policy = 'accept') {
  state.screen = 'game'; // tick.mjs : la sim n'avance que si state.screen === 'game'
  for (let t = 0; t < seconds; t++) {
    if (policy !== 'nodecision') {
      for (const e of sim.planning) if (e.status === 'planned') decideFlight(sim, e.id, true);
    }
    sim.alerts.length = 0;
    tick(state, 1, rng);
    if (sim.economy.bankrupt) break; // la sim est gelée (faillite déclarée)
  }
  return state;
}

test('R46 : le module expose les SIX scénarios (les 3 R38 + les 3 R46 — une entrée de table par défi, pas de paramétrage)', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['guide', 'saturation', 'redressement', 'crise', 'difficile', 'facile']);
  for (const [id, c] of Object.entries(SCENARIOS)) {
    assert.ok(Number.isInteger(c.seed), `(${id}) la seed est EXPLICITE et entière (rejouabilité R09)`);
    assert.ok(['o1-cycle', 'o2-surge'].includes(c.objective), `(${id}) l'objectif annoncé est un OBJECTIF R22 (pas un faux objectif)`);
    assert.ok(['easy', 'normal', 'hard'].includes(c.difficulty || 'normal'), `(${id}) la difficulté est un profil T2-1 connu (absente → normal, R38 intact)`);
  }
  assert.throws(() => startScenario('inconnu'), /scénario inconnu/, 'un mode inconnu est REFUSÉ (motif lisible, pas de crash)');
});

test('R38 guide : config EXPLICITE (seed 42, budget normal, aucun pic) + o1-cycle ANNONCÉ + partie REJOUABLE', () => {
  const s = startScenario('guide');
  assert.equal(s.sim.rngSeed, 42, 'seed IMPOSÉE (rejouable — R09)');
  assert.equal(s.sim.economy.money, START_FUNDS, 'budget NORMAL (pas de gonflement)');
  assert.ok(!isSurge(s.sim), 'aucun pic forcé en mode guide');
  assert.ok(s.scenario && s.scenario.id === 'guide', 'la config vit sur state.scenario (sérialisée)');
  const obj = scenarioObjective(s);
  assert.equal(obj.id, 'o1-cycle', 'l\'objectif R22 o1-cycle est ANNONCÉ (le panneau le lit)');
  assert.equal(obj.reward, 1000, 'la récompense lue du catalogue R22 (pas un chiffre inventé)');
  // REJOUABLE (R09) : DEUX parties fraîches MÊME config + MÊME politique
  // documentée (accept) → MÊME partie (money/pax/PRNG identiques). La
  // réussite n\'est PAS forcée : le test rejoue, la sim décide (l\'objectif
  // reste « payé » seulement si la sim le paie — ici, sans station carburant
  // construite, le cycle reste « sec » : la sim ne paie PAS o1-cycle).
  const a = startScenario('guide'); play(a, a.sim, makeSimRng(a.sim), 600);
  const b = startScenario('guide'); play(b, b.sim, makeSimRng(b.sim), 600);
  assert.equal(a.sim.economy.money, b.sim.economy.money, 'rejouable : money identique (même config → même partie)');
  assert.equal(a.sim.passengers.totalCarried, b.sim.passengers.totalCarried, 'rejouable : pax identiques');
  assert.equal(a.sim.rngCounter, b.sim.rngCounter, 'rejouable : l\'état du PRNG est identique (EV-10)');
  assert.ok(Number.isFinite(a.sim.economy.money), 'état cohérent après 10 min');
  // Le test ne FORCE PAS la réussite : le statut renvoyé est une LECTURE de
  // l'état sim (l'objectif n'est payé que si la sim l'a payé). sim.objectives
  // est paresseux (créé au 1er tickObjectives) → garde (comme scenarioSuccess).
  assert.equal(scenarioSuccess(a).done, (a.sim.objectives || []).some((o) => o.id === 'o1-cycle' && o.paid),
    'scenarioSuccess lit l\'état sim (pas un résultat forcé par le test)');
});

test('R38 saturation : pic ACTIF dès le départ avec la DURÉE EXPLICITE du défi + o2-surge ANNONCÉ', () => {
  const state = startScenario('saturation');
  const sim = state.sim;
  assert.equal(sim.rngSeed, 7, 'seed IMPOSÉE (rejouable)');
  assert.ok(isSurge(sim), 'le pic est ACTIF dès le départ (forceIncident, action EXISTANTE R33)');
  assert.equal(sim.incidents.surge.remaining, SATURATION_SURGE_S,
    'la durée du DÉFI est EXPLICITE (600 s, paramètre du scénario) — pas la durée naturelle (90 s)');
  const obj = scenarioObjective(state);
  assert.equal(obj.id, 'o2-surge', 'l\'objectif R22 o2-surge est ANNONCÉ');
  assert.equal(obj.reward, 1500, 'la récompense lue du catalogue R22 (pas un chiffre inventé)');
  // Rejoue 300 s (à l\'intérieur de la fenêtre du pic 600 s) : le pic reste
  // ACTIF et la sim avance sans état incohérent (invariants du harnais : money
  // et satisfaction finies).
  play(state, sim, makeSimRng(sim), 300);
  assert.ok(isSurge(sim), 'le pic est ENCORE ACTIF après 300 s (fenêtre 600 s du défi)');
  assert.ok(Number.isFinite(sim.economy.money) && Number.isFinite(sim.passengers.satisfaction), 'état cohérent après 300 s');
  // La vue R22 ne fabrique PAS de résultat (R16) : le statut est lisible
  // (à venir / atteinte / payée) et n\'est payé que si la sim l\'a payé.
  const st = objectiveView(sim, 'o2-surge');
  assert.ok(['à venir', 'atteinte', 'payée'].includes(st.state), `état R22 lisible (${st.state})`);
  assert.equal(scenarioSuccess(state).done, sim.objectives.some((o) => o.id === 'o2-surge' && o.paid),
    'scenarioSuccess lit l\'état sim (pas un résultat forcé par le test)');
});

test('R38 redressement : DÉFICIT de départ explicite (pas un budget gonflé) + emprunt R35 disponible', () => {
  const state = startScenario('redressement');
  const sim = state.sim;
  assert.equal(sim.rngSeed, 42, 'seed IMPOSÉE (rejouable)');
  assert.equal(sim.economy.money, REDRESSEMENT_FUNDS, 'budget EXPLICITE du défi : l\'aéroport démarre en DÉFICIT');
  assert.ok(REDRESSEMENT_FUNDS > -10000, 'le déficit de départ reste AU-DESSUS du seuil de faillite (-10000 $)');
  assert.equal(sim.economy.bankrupt, false, 'la sim NE GÈLE PAS au départ (pas de faillite)');
  // L'EMPRUNT (takeLoan, LA commande R35 du joueur — le levier DU JOUEUR) est
  // disponible : la liquidité nette remonte le solde dans le vert.
  const res = takeLoan(sim);
  assert.equal(res.ok, true, `takeLoan accepté (liquidité nette ${res.netLiquidity} $)`);
  assert.ok(sim.economy.money > 0, 'APRÈS l\'emprunt le solde est POSITIF (remonter dans le vert, le défi)');
  const obj = scenarioObjective(state);
  assert.equal(obj.id, 'o1-cycle', 'l\'objectif R22 est ANNONCÉ (remettre dans le vert)');
  assert.equal(scenarioSuccess(state).done, (sim.objectives || []).some((o) => o.id === 'o1-cycle' && o.paid),
    'o1-cycle n\'est payé que si la sim le paie (au départ : non) — pas forcé par le test');
});

test('R38 mode libre : AUCUN champ scenario, AUCUN objectif annoncé (le mode libre est CONSERVÉ)', () => {
  const state = makeGameState();
  assert.equal(state.scenario, undefined, 'mode libre = makeGameState() sans scenario (pas de champ)');
  assert.equal(scenarioObjective(state), null, 'pas d\'objectif annoncé en mode libre');
  assert.equal(scenarioSuccess(state), null, 'pas de statut d\'objectif en mode libre');
  assert.equal(state.sim.economy.money, START_FUNDS, 'le capital du mode libre reste START_FUNDS (pas de déficit)');
});

test('R38 sauvegarde : la configuration REPREND au chargement (marqueur sérialisé, effets sur la sim)', () => {
  for (const mode of ['guide', 'saturation', 'redressement']) {
    const state = startScenario(mode);
    play(state, state.sim, makeSimRng(state.sim), 120); // 2 min de jeu (des effets sur la sim : vols, économie)
    const back = deserialize(serialize(state));
    assert.equal(back.scenario?.id, mode, `(${mode}) state.scenario survive au load (marqueur) — la config REPREND`);
    if (mode === 'saturation') {
      assert.ok(isSurge(back.sim), '(saturation) le pic survive au load (l\'effet est SUR LA SIM)');
      assert.ok(back.sim.incidents.surge.remaining < SATURATION_SURGE_S,
        '(saturation) le compteur du pic a TICKÉ (reprise, pas redémarrage)');
    }
    if (mode === 'redressement') {
      assert.ok(back.sim.economy.money < START_FUNDS, '(redressement) le solde DÉFICITAIRE de la partie est restauré (pas réinitialisé)');
    }
    if (mode === 'guide') {
      assert.equal(back.sim.rngSeed, 42, '(guide) le seed est restauré (la partie REPREND reproductible, EV-10)');
    }
    assert.ok(Number.isFinite(back.sim.economy.money), `(${mode}) solde fini après load`);
  }
});

// ============================================================ R46 (t_7b04f863) : les 3 NOUVEAUX scénarios
// (CRISE TOTALE / DÉFI DIFFICILE / DÉFI FACILE) — mêmes règles (forceIncident
// R32/R33, emprunt R35, difficultés T2-1, objectifs R22), configuration
// EXPLICITE posée sur l'état frais, REJOUABLES (seed imposée, R09).

test('R46 crise : pic + piste fermée ACTIFS dès le départ (durées EXPLICITES) + o2-surge ANNONCÉ + REJOUABLE', () => {
  const s = startScenario('crise');
  const sim = s.sim;
  assert.equal(sim.rngSeed, 13, 'seed IMPOSÉE (rejouable)');
  assert.equal(sim.economy.money, START_FUNDS, 'budget NORMAL (le défi est l\'incident, pas le budget)');
  assert.ok(isSurge(sim), 'le pic est ACTIF dès le départ (forceIncident, action EXISTANTE R33)');
  assert.equal(sim.incidents.surge.remaining, CRISIS_SURGE_S, 'la fenêtre du pic est EXPLICITE du défi (900 s) — pas la durée naturelle (90 s)');
  const rw = sim.infra.runways[0]; // plan de départ A-2 : la piste fournie
  assert.ok(runwayClosed(sim, rw.id), 'la piste est FERMÉE dès le départ (forceIncident, action EXISTANTE R32)');
  assert.equal(sim.incidents.runways[rw.id].remaining, CRISIS_RUNWAY_CLOSE_S, 'la durée de la fermeture est EXPLICITE du défi (120 s)');
  assert.equal(scenarioObjective(s).id, 'o2-surge', 'l\'objectif R22 o2-surge est ANNONCÉ (ponctualité restaurée pendant le pic)');
  assert.equal(s.scenario.difficulty, 'normal', 'la difficulté est EXPLICITE dans le marqueur (référentiel — le défi est l\'incident, pas l\'économie)');
  // REJOUABLE (R09) : deux parties fraîches MÊME config + MÊME politique → MÊME partie.
  const a = startScenario('crise'); play(a, a.sim, makeSimRng(a.sim), 600);
  const b = startScenario('crise'); play(b, b.sim, makeSimRng(b.sim), 600);
  assert.equal(a.sim.economy.money, b.sim.economy.money, 'rejouable : money identique');
  assert.equal(a.sim.passengers.totalCarried, b.sim.passengers.totalCarried, 'rejouable : pax identiques');
  assert.equal(a.sim.rngCounter, b.sim.rngCounter, 'rejouable : PRNG identique (EV-10)');
  assert.equal(scenarioSuccess(a).done, (a.sim.objectives || []).some((o) => o.id === 'o2-surge' && o.paid), 'scenarioSuccess lit l\'état sim (pas un résultat forcé par le test)');
});

test('R46 difficile : profil T2-1 DIFFICILE (capital maigre + incidents ×0.6 + OPEX ×1.25) + o1-cycle ANNONCÉ + REJOUABLE', () => {
  const s = startScenario('difficile');
  const sim = s.sim;
  assert.equal(sim.rngSeed, 21, 'seed IMPOSÉE (rejouable)');
  assert.equal(sim.economy.money, DIFFICULTIES.hard.startFunds, 'capital du profil difficile (lu de la table T2-1, PAS dupliqué)');
  assert.equal(s.difficulty.id, 'hard', 'le choix de difficulté vit sur state.difficulty (sérialisé, pattern T2-1)');
  assert.equal(sim.difficulty.incidentScale, DIFFICULTIES.hard.incidentScale, 'fenêtres d\'incidents ×0.6 (incidents plus fréquents) — paramètre de spawn, pas une règle');
  assert.equal(sim.difficulty.opexFactor, DIFFICULTIES.hard.opexFactor, 'OPEX ×1.25 (exploitation alourdie) — paramètre de spawn, pas une règle');
  assert.ok(!isSurge(sim) && !runwayClosed(sim), 'aucun incident forcé (le défi est l\'économie difficile, pas un incident)');
  assert.equal(scenarioObjective(s).id, 'o1-cycle', 'l\'objectif R22 o1-cycle est ANNONCÉ (remettre dans le vert en conditions dures)');
  const a = startScenario('difficile'); play(a, a.sim, makeSimRng(a.sim), 600);
  const b = startScenario('difficile'); play(b, b.sim, makeSimRng(b.sim), 600);
  assert.equal(a.sim.economy.money, b.sim.economy.money, 'rejouable : money identique (même profil → même partie)');
  assert.equal(a.sim.rngCounter, b.sim.rngCounter, 'rejouable : PRNG identique (EV-10)');
  assert.equal(a.sim.difficulty.opexFactor, b.sim.difficulty.opexFactor, 'rejouable : les facteurs de difficulté sont identiques');
});

test('R46 facile : profil T2-1 FACILE (capital confort + incidents ×1.6 + OPEX ×0.85) + o1-cycle ANNONCÉ + REJOUABLE', () => {
  const s = startScenario('facile');
  const sim = s.sim;
  assert.equal(sim.rngSeed, 3, 'seed IMPOSÉE (rejouable)');
  assert.equal(sim.economy.money, DIFFICULTIES.easy.startFunds, 'capital du profil facile (lu de la table T2-1, PAS dupliqué)');
  assert.equal(s.difficulty.id, 'easy', 'le choix de difficulté vit sur state.difficulty (sérialisé, pattern T2-1)');
  assert.equal(sim.difficulty.incidentScale, DIFFICULTIES.easy.incidentScale, 'fenêtres d\'incidents ×1.6 (incidents moins fréquents) — paramètre de spawn, pas une règle');
  assert.equal(sim.difficulty.opexFactor, DIFFICULTIES.easy.opexFactor, 'OPEX ×0.85 (exploitation allégée) — paramètre de spawn, pas une règle');
  assert.equal(scenarioObjective(s).id, 'o1-cycle', 'l\'objectif R22 o1-cycle est ANNONCÉ (premier cycle sans départ sec + période net ≥ 0)');
  const a = startScenario('facile'); play(a, a.sim, makeSimRng(a.sim), 600);
  const b = startScenario('facile'); play(b, b.sim, makeSimRng(b.sim), 600);
  assert.equal(a.sim.economy.money, b.sim.economy.money, 'rejouable : money identique (même profil → même partie)');
  assert.equal(a.sim.rngCounter, b.sim.rngCounter, 'rejouable : PRNG identique (EV-10)');
});

test('R46 sauvegarde : la config des 3 nouveaux scénarios REPREND au chargement (difficulté sérialisée, incidents SUR LA SIM)', () => {
  for (const mode of ['crise', 'difficile', 'facile']) {
    const state = startScenario(mode);
    play(state, state.sim, makeSimRng(state.sim), 60); // 1 min de partie avant la sauvegarde (les compteurs des incidents du défi sont EN COURS : pic 900→840, piste 120→60)
    const back = deserialize(serialize(state));
    assert.equal(back.scenario?.id, mode, `(${mode}) le marqueur state.scenario survive au load (la config REPREND)`);
    assert.equal(back.difficulty?.id, state.difficulty.id, `(${mode}) la difficulté du scénario est restaurée (state.difficulty sérialisée, T2-1 — le sélecteur du menu la lit à la reprise)`);
    assert.equal(back.sim.economy.money, state.sim.economy.money, `(${mode}) le solde de la partie est restauré (reprise, pas réinitialisation au spawn)`);
    if (mode === 'crise') {
      assert.ok(isSurge(back.sim), '(crise) le pic survive au load (l\'effet vit SUR LA SIM, le marqueur ne redémarre rien)');
      assert.ok(runwayClosed(back.sim), '(crise) la fermeture de piste survive au load');
      assert.ok(back.sim.incidents.surge.remaining < CRISIS_SURGE_S, '(crise) le compteur du pic a TICKÉ (reprise, pas redémarrage)');
      assert.ok(back.sim.incidents.runways[back.sim.infra.runways[0].id].remaining < CRISIS_RUNWAY_CLOSE_S, '(crise) le compteur de la piste a TICKÉ');
    }
    assert.ok(Number.isFinite(back.sim.economy.money), `(${mode}) solde fini après load`);
  }
});
