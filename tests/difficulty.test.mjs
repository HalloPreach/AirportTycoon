// T2-1 (t_d5da994c) — DIFFICULTÉ : facile / normal / difficile — une COUCHE DE
// PARAMÈTRES AU SPAWN, jamais une couche de règles (mécanismes des incidents,
// OPEX/seconde et invariants intacts). Ce qui se teste ici :
//   • les profils (easy/normal/hard) et le référentiel normal (inchangé) ;
//   • l'application au SPAWN (makeGameState : capital + facteurs du tick) ;
//   • l'effet MESURABLE en sim : fréquence d'incidents (fenêtres × échelle)
//     et pression économique (OPEX × facteur), avec la même sim ;
//   • la PERSISTANCE : le choix sérialise dans le state (survit au save/load),
//     et une sauvegarde PRÉ-T2-1 (champs absents) migre au référentiel normal
//     sans crash (ensureDifficulty, pattern ensureLoan R35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES, DIFFICULTY_IDS, normalizeDifficulty, incidentWindows, ensureDifficulty,
} from '../src/core/difficulty.mjs';
import { START_FUNDS } from '../src/core/sim-state.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { newSimState } from '../src/core/sim-state.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';
import { tickIncidents, INCID } from '../src/sim/incidents.mjs';
import { tickEconomy } from '../src/economy/economy.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// rng FORCÉ : toujours < 0.5 → le tirage de fenêtre DÉCLENCHE systématiquement
// l'incident (mesurer le moment du déclenchement = mesurer la FENÊTRE, pas la
// chance — la difficulté n'échelle que la fenêtre, jamais le tirage).
const alwaysZero = () => 0;

// Aéroport identique pour la comparaison d'OPEX (géométrie « bien conçue »
// des tests, BL-02 : piste + taxiway + terminal, réseau connecté).
function bareAirport() {
  const sim = newSimState();
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  rebuildGraph(sim);
  return sim;
}

// ---------------------------------------------------------------------------
// 1) Les PROFILS : trois difficultés, un référentiel intact.
// ---------------------------------------------------------------------------
test('T2-1 : les trois profils existent, normal = référentiel (inchangé)', () => {
  assert.deepEqual([...DIFFICULTY_IDS], ['easy', 'normal', 'hard'], 'les 3 difficultés');
  const { easy, normal, hard } = DIFFICULTIES;
  // normal = le RÉFÉRENTIEL : capital de base + fenêtres ×1 + OPEX ×1 —
  // le comportement de référence du jeu ne bouge pas.
  assert.equal(normal.startFunds, START_FUNDS, 'capital normal = START_FUNDS');
  assert.equal(normal.incidentScale, 1, 'fenêtres normal = table INCID (×1)');
  assert.equal(normal.opexFactor, 1, 'OPEX normal ×1');
  // L'ordre est COHÉRENT : facile = confort (plus de capital, incidents moins
  // fréquents, exploitation allégée) ; difficile = le contraire.
  assert.ok(easy.startFunds > normal.startFunds && normal.startFunds > hard.startFunds,
    'capital : facile > normal > difficile');
  assert.ok(easy.incidentScale > 1 && hard.incidentScale < 1,
    'fenêtres : facile ×>1 (moins fréquents), difficile ×<1 (plus fréquents)');
  assert.ok(easy.opexFactor < 1 && hard.opexFactor > 1,
    'pression éco : facile ×<1 (allégée), difficile ×>1 (alourdie)');
});

test('T2-1 : normalisation — toute valeur inconnue/corrompue retombe au référentiel normal', () => {
  assert.equal(normalizeDifficulty('easy'), 'easy');
  assert.equal(normalizeDifficulty('hard'), 'hard');
  for (const bad of ['impossible', 'EASY', '', null, undefined, 3]) {
    assert.equal(normalizeDifficulty(bad), 'normal', `« ${String(bad)} » → normal (pas de crash)`);
  }
});

test('T2-1 : les fenêtres par difficulté (lecture pure) — normal = la table INCID inchangée', () => {
  assert.deepEqual(incidentWindows('normal'), {
    runwayEvery: INCID.RUNWAY_EVERY_S, fuelEvery: INCID.FUEL_EVERY_S, surgeEvery: INCID.SURGE_EVERY_S,
  }, 'normal : les fenêtres RÉFÉRENTIELLES (la table INCID, intacte)');
  assert.equal(incidentWindows('hard').surgeEvery, INCID.SURGE_EVERY_S * 0.6, 'hard : fenêtre pic ×0.6');
  assert.equal(incidentWindows('easy').runwayEvery, INCID.RUNWAY_EVERY_S * 1.6, 'easy : fenêtre piste ×1.6');
  assert.deepEqual(incidentWindows('inconnu'), incidentWindows('normal'), 'inconnu → normal');
});

// ---------------------------------------------------------------------------
// 2) L'application AU SPAWN (makeGameState) : le choix se SÉRIALISE et pose
//    les paramètres de la sim.
// ---------------------------------------------------------------------------
for (const id of DIFFICULTY_IDS) {
  test(`T2-1 : makeGameState(seed, « ${id} ») — capital + facteurs du tick + choix sérialisé`, () => {
    const st = makeGameState(7, id);
    const p = DIFFICULTIES[id];
    // Le CHOIX vit sur state.difficulty (sérialisé avec l'état entier → il
    // survit à la sauvegarde/rechargement).
    assert.deepEqual(st.difficulty, {
      id, name: p.name, startFunds: p.startFunds,
      incidentScale: p.incidentScale, opexFactor: p.opexFactor,
    }, 'state.difficulty = le profil complet (sérialisé)');
    assert.equal(st.sim.economy.money, p.startFunds, 'solde de départ du profil');
    // Les FACTEURS du tick vivent sur sim.difficulty (le tick ne reçoit que la
    // sim) : incidents.mjs et economy.mjs les lisent avec repli ×1.
    assert.deepEqual(st.sim.difficulty, {
      incidentScale: p.incidentScale, opexFactor: p.opexFactor,
    }, 'sim.difficulty = les facteurs du tick');
  });
}

test('T2-1 : makeGameState sans argument = le référentiel normal (retraites compatibles)', () => {
  const st = makeGameState(7);
  assert.equal(st.difficulty.id, 'normal');
  assert.equal(st.sim.economy.money, START_FUNDS, 'le capital de base, inchangé');
});

test('T2-1 : difficulté corrompue au spawn → référentiel normal (jamais de crash)', () => {
  const st = makeGameState(7, 'impossible');
  assert.equal(st.difficulty.id, 'normal', 'repli au référentiel (pattern options)');
  assert.equal(st.sim.economy.money, START_FUNDS);
  assert.deepEqual(st.sim.difficulty, { incidentScale: 1, opexFactor: 1 });
});

// ---------------------------------------------------------------------------
// 3) L'effet MESURABLE : la FRÉQUENCE d'incidents suit l'échelle de la
//    difficulté (fenêtre × incidentScale, le tirage et le mécanisme intacts).
// ---------------------------------------------------------------------------
function firstSurgeAt(difficultyId) {
  // Pic de demande (fenêtre 240 s) : avec le tirage FORCÉ, il DÉCLENCHE à la
  // première fenêtre atteinte — le moment du déclenchement = la fenêtre elle-même.
  const sim = makeGameState(7, difficultyId).sim;
  let t = 0;
  while (!sim.incidents.surge.active && t < 2000) {
    tickIncidents(sim, 1, alwaysZero);
    t += 1;
  }
  return t; // (secondes sim) — 2000 = plafond de sécurité
}

test('T2-1 : la FRÉQUENCE d\'incidents suit la difficulté (fenêtres × échelle)', () => {
  const atHard = firstSurgeAt('hard');
  const atNormal = firstSurgeAt('normal');
  const atEasy = firstSurgeAt('easy');
  assert.equal(atHard, INCID.SURGE_EVERY_S * 0.6,
    `hard : le pic déclenche à ${atHard} s (fenêtre 240 × 0.6 — plus fréquent)`);
  assert.equal(atNormal, INCID.SURGE_EVERY_S, `normal : déclenchement RÉFÉRENTIEL à ${atNormal} s (inchangé)`);
  assert.equal(atEasy, INCID.SURGE_EVERY_S * 1.6,
    `easy : le pic déclenche à ${atEasy} s (fenêtre 240 × 1.6 — moins fréquent)`);
  assert.ok(atHard < atNormal && atNormal < atEasy, 'ordre : hard < normal < easy (fréquence décroissante)');
});

// ---------------------------------------------------------------------------
// 4) L'effet MESURABLE : la PRESSION ÉCONOMIQUE suit la difficulté (OPEX ×
//    facteur, même aéroport, même dt — le canal spent.opex est intact,
//    l'identité trésorerie EV-9 tient).
// ---------------------------------------------------------------------------
function opexFor(opexFactor) {
  const sim = bareAirport();
  sim.difficulty = { incidentScale: 1, opexFactor }; // le facteur SEUL (mesure isolée)
  sim.economy.spent.opex = 0;
  tickEconomy(sim, 10);
  return sim.economy.spent.opex;
}

test('T2-1 : la PRESSION ÉCONOMIQUE suit la difficulté (OPEX × facteur, même sim)', () => {
  const ref = opexFor(DIFFICULTIES.normal.opexFactor);
  assert.ok(ref > 0, 'OPEX de référence > 0 (aéroport fourni)');
  for (const id of DIFFICULTY_IDS) {
    const charged = opexFor(DIFFICULTIES[id].opexFactor);
    assert.equal(charged, ref * DIFFICULTIES[id].opexFactor,
      `${id} : OPEX chargé = référence × ${DIFFICULTIES[id].opexFactor}`);
  }
  // L'identité EV-9 tient : le débit passe par spent.opex (compté), pas par une
  // recette négative — money = START + recettes(0) − dépenses(spent) − dette(0).
  const sim = bareAirport();
  sim.difficulty = { incidentScale: 1, opexFactor: 1.25 };
  sim.economy.spent.opex = 0;
  const start = sim.economy.money;
  tickEconomy(sim, 10);
  assert.equal(sim.economy.money, start - sim.economy.spent.opex,
    'solde = capital − OPEX chargé (EV-9 : même canal spent.opex)');
});

// ---------------------------------------------------------------------------
// 5) La PERSISTANCE : le choix sérialise (il survit au save/load) ; une
//    sauvegarde PRÉ-T2-1 (champs absents) migre au référentiel normal.
// ---------------------------------------------------------------------------
test('T2-1 : le choix de difficulté SURVIT à la sauvegarde/rechargement', () => {
  const st = makeGameState(7, 'hard');
  const back = deserialize(serialize(st));
  assert.deepEqual(back.difficulty, st.difficulty, 'state.difficulty restauré');
  assert.deepEqual(back.sim.difficulty, st.sim.difficulty, 'les facteurs du tick restaurés');
  assert.equal(back.sim.economy.money, DIFFICULTIES.hard.startFunds, 'le capital restauré');
});

test('T2-1 : sauvegarde PRÉ-T2-1 (champs absents) — migration au référentiel normal, sans crash', () => {
  const st = makeGameState(7); // normal (référentiel)
  delete st.difficulty;   // le champ du state n\'existait pas avant T2-1
  delete st.sim.difficulty; // le champ de la sim non plus
  const json = serialize(st);
  assert.ok(!json.includes('"difficulty"'), 'le JSON pré-T2-1 ne porte aucun champ difficulty');
  const back = deserialize(json); // ensureDifficulty (save.mjs) doit remplacer
  assert.deepEqual(back.difficulty, { id: 'normal', ...DIFFICULTIES.normal },
    'migration : le profil normal (id + profil complet)');
  assert.deepEqual(back.sim.difficulty, { incidentScale: 1, opexFactor: 1 },
    'migration : les facteurs du tick au référentiel (le comportement ne change pas)');
});

test('T2-1 : ensureDifficulty — champ présent mais CORROMPU, normalisé proprement (idempotente)', () => {
  const st = makeGameState(7, 'easy');
  st.difficulty = { id: 'inconnu' }; // corrompu
  ensureDifficulty(st, st.sim);
  assert.equal(st.difficulty.id, 'normal', 'corrompu → référentiel normal');
  assert.deepEqual(st.sim.difficulty, { incidentScale: 1, opexFactor: 1 }, 'facteurs remis au référentiel');
  // Idempotente : un état PROPRE n\'est pas touché (la référence du champ tient).
  const st2 = makeGameState(7, 'hard');
  const d = st2.difficulty;
  const s = st2.sim.difficulty;
  ensureDifficulty(st2, st2.sim);
  assert.equal(st2.difficulty, d, 'state.difficulty inchangé (référence)');
  assert.equal(st2.sim.difficulty, s, 'sim.difficulty inchangée (référence)');
});
