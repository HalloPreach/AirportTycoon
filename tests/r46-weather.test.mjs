// Tests R46 (t_9b665a8b) : T3 — le SYSTÈME MÉTÉO complet.
// VALIDATION (exigée par la carte) :
//   1. le CYCLE météo avance l'état et est DÉTERMINISTE sous PRNG semé
//      (même graine → même suite — la météo est de l'ÉTAT de la sim, EV-10) ;
//   2. les EFFETS : la table WEATHER_EFFECTS est LA règle unique lue par
//      aircraft.mjs — « clair » NEUTRE (vitesse 1, délai 0), pluie/neige/
//      orage ralentissent l'approche (speed < 1, dégradé monotone) + retard
//      FIXE à l'entrée en holding (delay > 0) ;
//   3. l'INCIDENT MÉTÉO : le tirage de fenêtre est BIAISÉ par l'état (p = 0
//      en clair → jamais ; p = 0,7 en orage → souvent) ; deux réponses
//      (attendre gratuit / intervention 750 $ immédiate, NON répétable) ;
//      l'intervention ramène les effets à l'état météo courant (récupération
//      mesurée) ;
//   4. la PERSISTANCE (EV-10) : le champ météo survit au round-trip
//      serialize/deserialize ; une sauvegarde PRÉ-T3 (champ absent) est
//      adoptée en « clear » neuf sans toucher les autres champs ; un champ
//      corrompu est réparé ;
//   5. les STATS : l'incident météo ACTIF compte dans activeIncidentCount
//      (incident « survécu » = la série sans déficit suit) ;
//   6. les LECTURES sont pures : weatherOf / weatherView / weatherEffect ne
//      fabriquent JAMAIS l'état (pas de mutation, pattern runwayClosedRO).
// Zéro DOM, déterministe — même socle que les tests R32/R33.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import {
  ensureWeather, tickWeather, forceWeather, weatherOf, weatherView,
  weatherEffect, WEATHER_EFFECTS,
} from '../src/sim/weather.mjs';
import {
  ensureIncidents, forceIncident, tickIncidents, incidentResponse,
  respondIncident, INCID,
} from '../src/sim/incidents.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { makeGameState } from '../src/core/new-game.mjs';
import { activeIncidentCount } from '../src/progression/stats.mjs';

// Sim FRAÎCHE + générateur SEMÉ (l'EV-10 : la météo est de l'état de la sim).
function freshSim(seed = 42) {
  const sim = newSimState();
  sim.rngSeed = seed;
  sim.rngCounter = 0;
  ensureWeather(sim);
  forceWeather(sim, 'clear');
  return sim;
}

test('R46 (1) : cycle DÉTERMINISTE — même graine → même suite (EV-10)', () => {
  const run = (seed) => {
    const sim = freshSim(seed);
    const seq = [];
    for (let i = 0; i < 60; i++) { // 60 min sim : plusieurs transitions
      tickWeather(sim, 60, makeSimRng(sim));
      seq.push(sim.weather.state);
    }
    return seq;
  };
  const seqA = run(42);
  const seqB = run(42);
  assert.deepEqual(seqB, seqA, 'mÊME graine → suite météo IDENTIQUE (reproductible à la reprise)');
  const transitions = seqA.filter((s, i) => i > 0 && s !== seqA[i - 1]).length;
  assert.ok(transitions >= 1, `le cycle AVANCE (≥ 1 transition sur 60 min) — trouvé ${transitions}`);
  // La suite est dans la graine : une autre graine ne donne pas la même suite.
  const seqC = run(99);
  assert.notDeepEqual(seqC, seqA, 'une AUTRE graine → une suite DIFFÉRENTE (pas de loterie partagée)');
});

test('R46 (2) : les EFFETS — la table WEATHER_EFFECTS est la règle UNIQUE lue par aircraft.mjs', () => {
  const sim = freshSim();
  assert.equal(weatherOf(sim), 'clear');
  assert.deepEqual(weatherEffect(sim), WEATHER_EFFECTS.clear, '« clair » : NEUTRE (vitesse 1, délai 0 — le comportement existant)');
  assert.equal(WEATHER_EFFECTS.clear.delay, 0, '« clair » : aucun retard d\'attente');
  for (const [st, eff] of Object.entries(WEATHER_EFFECTS)) {
    forceWeather(sim, st);
    assert.equal(weatherOf(sim), st, `forceWeather(${st}) : état adopté`);
    assert.deepEqual(weatherEffect(sim), eff, `état « ${st} » → ligne d'effets EXACTE de la table`);
  }
  // Dégradé monotone : plus l'état est lourd, plus l'approche est LENTE
  // (capacité réduite émergente : occupation piste prolongée).
  assert.ok(
    WEATHER_EFFECTS.rain.speed < 1
    && WEATHER_EFFECTS.snow.speed < WEATHER_EFFECTS.rain.speed
    && WEATHER_EFFECTS.storm.speed < WEATHER_EFFECTS.snow.speed,
    'le dégradé de vitesse est MONOTONE (pluie < nuageux, neige < pluie, orage < neige)',
  );
  assert.ok(
    WEATHER_EFFECTS.rain.delay > 0 && WEATHER_EFFECTS.snow.delay > WEATHER_EFFECTS.rain.delay
    && WEATHER_EFFECTS.storm.delay > WEATHER_EFFECTS.snow.delay,
    'le retard d\'attente est MONOTONE (orage > neige > pluie)');
  // L'incident MÉTÉO majore les effets à la ligne « orage », MÊME par temps clair.
  forceWeather(sim, 'clear');
  ensureIncidents(sim);
  forceIncident(sim, 'weather');
  assert.deepEqual(weatherEffect(sim), WEATHER_EFFECTS.storm, 'incident ACTIF → effets majorés à la ligne « orage »');
  // La fin NATURELLE referme l'incident → les effets reviennent à l'état courant.
  tickIncidents(sim, INCID.WEATHER_OUT_S + 1, () => 1);
  assert.deepEqual(weatherEffect(sim), WEATHER_EFFECTS.clear, 'fin de l\'incident → effets revenus au « clair » (récupération mesurée)');
});

test('R46 (3) : l\'incident MÉTÉO — tirage BIAISÉ par l\'état météo', () => {
  // « clair » : p = 0 → l'incident ne se déclenche JAMAIS (même tirage favorable).
  {
    const sim = freshSim();
    forceWeather(sim, 'clear');
    const i = ensureIncidents(sim);
    i.weather.acc = INCID.WEATHER_EVERY_S; // à la fenêtre : tirage ce tick
    tickIncidents(sim, 1, () => 0); // le tirage le PLUS favorable
    assert.ok(!i.weather.active, '« clair » : p = 0 → JAMAIS d\'incident météo (même au tirage 0)');
  }
  // « orage » : p = 0,7 → le tirage 0,5 déclenche l'incident.
  {
    const sim = freshSim();
    forceWeather(sim, 'storm');
    const i = ensureIncidents(sim);
    i.weather.acc = INCID.WEATHER_EVERY_S;
    tickIncidents(sim, 1, () => 0.5);
    assert.ok(i.weather.active, '« orage » : p = 0,7 > 0,5 → l\'incident météo se déclenche');
    assert.equal(i.weather.remaining, INCID.WEATHER_OUT_S, 'durée bornée (WEATHER_OUT_S)');
    assert.equal(i.weather.last, 0, 'l\'horodatage suit l\'horloge de la sim');
  }
  // « neige » : p = 0,5 → le tirage 0,5 ne déclenche PAS (0,5 < 0,5 = faux).
  {
    const sim = freshSim();
    forceWeather(sim, 'snow');
    const i = ensureIncidents(sim);
    i.weather.acc = INCID.WEATHER_EVERY_S;
    tickIncidents(sim, 1, () => 0.5);
    assert.ok(!i.weather.active, '« neige » : p = 0,5 → le tirage 0,5 ne déclenche PAS (bornes strictes)');
  }
});

test('R46 (4) : les RÉPONSES — attendre (gratuit) / intervention 750 $ (immédiate, NON répétable)', () => {
  // Attendre : le coût est zéro, l'incident CONTINUE (fin naturelle).
  {
    const sim = freshSim();
    sim.economy.money = 100000;
    forceWeather(sim, 'clear');
    forceIncident(sim, 'weather');
    const view = incidentResponse(sim, 'weather');
    assert.ok(view.ok, 'la lecture des réponses est possible (incident actif)');
    assert.equal(view.responses.length, 2, 'DEUX réponses (arbitrage réel)');
    assert.equal(view.responses[0].id, 'wait');
    assert.equal(view.responses[0].cost, 0, 'attendre est GRATUIT');
    assert.equal(view.responses[1].id, 'intervene');
    assert.equal(view.responses[1].cost, INCID.INTERVENE_WEATHER_COST, 'intervention : coût de la table (750 $)');
    const money = sim.economy.money;
    assert.ok(respondIncident(sim, 'weather', 'wait').ok, 'la réponse passive est ACCEPTÉE');
    assert.equal(sim.economy.money, money, 'passive : AUCUN coût');
    assert.ok(ensureIncidents(sim).weather.active, 'passive : l\'incident CONTINUE (fin naturelle)');
  }
  // Intervention : effets ramenés IMMÉDIATEMENT à l'état courant, coût débité,
  // action NON répétable (l'incident est terminé → motif, aucune mutation).
  {
    const sim = freshSim();
    sim.economy.money = 100000;
    forceWeather(sim, 'clear');
    forceIncident(sim, 'weather');
    assert.deepEqual(weatherEffect(sim), WEATHER_EFFECTS.storm, 'avant : effets majorés (ligne orage)');
    assert.ok(respondIncident(sim, 'weather', 'intervene').ok, "l'intervention est ACCEPTÉE");
    assert.equal(sim.economy.money, 100000 - INCID.INTERVENE_WEATHER_COST, "coût de l'intervention débité");
    assert.deepEqual(weatherEffect(sim), WEATHER_EFFECTS.clear, "après : effets revenus à l'état courant (clair)");
    assert.equal(weatherView(sim).incidentRemaining, 0, "le compte à rebours de l'incident repart à zéro");
    const again = respondIncident(sim, 'weather', 'intervene');
    assert.ok(!again.ok, 'NON répétable : incident terminé → MOTIF');
    assert.match(again.reason, /météo/i, 'le motif est LISIBLE');
  }
  // Le compte à rebours de l'INCIDENT (distinct de la durée d'état) est borné
  // par WEATHER_OUT_S et strictement positif tant que l'incident est actif.
  {
    const sim = freshSim();
    forceIncident(sim, 'weather');
    const v = weatherView(sim);
    assert.ok(v.incident, "l'incident est lisible dans weatherView");
    assert.ok(v.incidentRemaining > 0 && v.incidentRemaining <= INCID.WEATHER_OUT_S,
      `incidentRemaining borné par WEATHER_OUT_S (${v.incidentRemaining})`);
  }
});

test('R46 (5) : la PERSISTANCE — round-trip intact + migration PRÉ-T3 (champ absent)', () => {
  // Round-trip : le champ météo (état + compteurs) survit à la sauvegarde.
  {
    const state = makeGameState();
    state.screen = 'game';
    state.sim = freshSim(42);
    forceWeather(state.sim, 'storm');
    state.sim.weather.remaining = 123; // valeur non triviale (preuve de survie)
    const out = deserialize(serialize(state));
    assert.equal(out.sim.weather.state, 'storm', 'l\'état météo survit au round-trip');
    assert.equal(out.sim.weather.remaining, 123, 'les compteurs météo survivent (reprise bornée)');
  }
  // Sauvegarde PRÉ-T3 : le champ météo n'existe PAS → ensureWeather l'adopte en
  // « clear » neuf, sans crash, SANS toucher les autres champs (migration
  // additive, EV-10 — comme upgrades/incidents).
  {
    const state = makeGameState();
    state.screen = 'game';
    state.sim = freshSim(42);
    forceWeather(state.sim, 'rain');
    const json = JSON.parse(serialize(state));
    delete json.state.sim.weather; // la sauvegarde PRÉ-T3 (champ absent)
    const out = deserialize(JSON.stringify(json));
    assert.equal(out.sim.weather.state, 'clear', 'migration PRÉ-T3 : « clear » neuf (comportement inchangé à la reprise)');
    assert.equal(out.sim.weather.remaining, 900, 'durée MAX du « clair » (reprise saine)');
    assert.equal(out.sim.economy.money, state.sim.economy.money, 'les AUTRES champs sont INTACTS (migration additive)');
    assert.equal(out.sim.rngSeed, state.sim.rngSeed, 'le générateur semé survit (EV-10)');
  }
  // Champ CORROMPU : état inconnu / durée hors bornes → réparé (jamais de crash).
  {
    const sim = freshSim();
    sim.weather = { state: 'tornade', remaining: -5, acc: Number.NaN };
    ensureWeather(sim);
    assert.equal(sim.weather.state, 'clear', 'champ corrompu → réparé en « clear »');
    assert.equal(sim.weather.remaining, 900, 'la durée est bornée (pas de valeur négative)');
    sim.weather = { state: 'rain' }; // durée ABSENTE
    ensureWeather(sim);
    assert.equal(sim.weather.remaining, 480, 'durée absente → bornée à la durée MAX de l\'état');
    assert.equal(sim.weather.acc, 0, 'compteur absent → 0');
  }
});

test('R46 (6) : les STATS — l\'incident météo ACTIF compte dans activeIncidentCount', () => {
  const sim = freshSim();
  assert.equal(activeIncidentCount(sim), 0, 'aucun incident → 0');
  forceIncident(sim, 'weather');
  assert.equal(activeIncidentCount(sim), 1, 'l\'incident météo ACTIF est compté (1)');
  tickIncidents(sim, INCID.WEATHER_OUT_S + 1, () => 1);
  assert.equal(activeIncidentCount(sim), 0, 'incident terminé → plus compté (survécu)');
});

test('R46 (7) : les LECTURES sont pures — weatherOf / weatherView / weatherEffect ne mutent jamais', () => {
  const sim = newSimState(); // pas de champ météo
  assert.equal(weatherOf(sim), 'clear', 'champ ABSENT → « clear » (pas de crash)');
  assert.equal(sim.weather, undefined, 'weatherOf ne CRÉE PAS le champ (lecture pure)');
  assert.equal(weatherView(sim).fr, 'clair', 'weatherView : libellé FR (pas de mutation)');
  assert.deepEqual(weatherEffect(sim), WEATHER_EFFECTS.clear, 'weatherEffect : ligne neutre (pas de mutation)');
  assert.equal(sim.weather, undefined, 'toujours pas de champ créé (pureté confirmée)');
});
