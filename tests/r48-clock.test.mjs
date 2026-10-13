// Tests R48 (t_76744b22) : T3 — le SYSTÈME JOUR/NUIT + SAISONS.
// VALIDATION (exigée par la carte) :
//   1. l'HORLOGE (sim.clock) : le cycle jour/nuit avance l'état et est
//      DÉTERMINISTE (l'avance est ARITHMÉTIQUE — pas de tirage : même dt →
//      même heure, reproductible à la reprise, EV-10) ; au passage de jour
//      (rollover) UNE alerte lisible est émise (season-change) ;
//   2. les PHASES : aube 6-7 / jour 8-16 / crépuscule 17-19 / nuit 20-5 —
//      la teinte du monde est dérivée (lecture pure phaseTint) : « jour » →
//      null (pas de bruit), nuit/voiles sinon ;
//   3. les SAISONS : 1 par jour-jeu (4 jours = 1 an-jeu) — printemps (jour
//      1, RÉFÉRENTIEL ×1) / été / automne / hiver ; la couche de PARAMÈTRES
//      DE SPAWN (spawnLayer) module la cadence des offres de la FENÊTRE du
//      planificateur : le plancher est 1 offre (une fenêtre ne génère JAMAIS
//      0 offre — le comportement de référence est préservé, le printemps ×1
//      est identique à avant), l'été + pic = 3 offres, l'hiver + pic = 1 ;
//   4. la PERSISTANCE (EV-10) : le champ horloge (sim.clock) survit au
//      round-trip serialize/deserialize ; une sauvegarde PRÉ-T3-horloge
//      (champ absent) est adoptée en « jour 1, 08:00 » sans toucher les
//      autres champs (migration additive) ; un champ corrompu est réparé ;
//   5. les LECTURES sont pures : clockView / seasonOf / spawnLayer ne
//      fabriquent JAMAIS l'état (pas de mutation, pattern weatherOf).
// Zéro DOM, déterministe — même socle que les tests R46 (météo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState } from '../src/core/sim-state.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import {
  ensureClock, tickClock, forceClock, clockView, clockOf,
  phaseOfHour, phaseTint, PHASE_TINTS, DAY_S, DAY_START,
} from '../src/sim/clock.mjs';
import {
  seasonOf, seasonView, seasonParams, seasonTint,
  normalizeSeason, SEASONS, SEASON_IDS,
} from '../src/core/seasons.mjs';
import { spawnLayer } from '../src/core/difficulty.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';
import { windowClose } from '../src/flights/flights.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';
import { makeGameState } from '../src/core/new-game.mjs';

// Partie FRAÎCHE (l'horloge est INITIALISÉE par new-game.mjs : jour 1, 08:00).
function freshGame(seed = 42) {
  const state = makeGameState(seed);
  return state;
}

// Une sim nue (champ horloge ABSENT — la sauvegarde PRÉ-T3-horloge).
function bareSim() {
  const sim = newSimState();
  sim.rngSeed = 42;
  sim.rngCounter = 0;
  return sim;
}

test('R48 (1) : l\'état INITIAL — nouvelle partie : jour 1, 08:00, printemps (référentiel)', () => {
  const state = freshGame(42);
  const sim = state.sim;
  assert.ok(sim.clock, 'le champ horloge EXISTE dès la création (new-game)');
  assert.equal(sim.clock.day, 1, 'jour 1');
  assert.equal(sim.clock.t, DAY_START, `t initial = ${DAY_START} (08:00 — la partie commence le MATIN)`);
  const cv = clockView(sim);
  assert.equal(cv.day, 1, 'lecture du jour');
  assert.equal(cv.label, '08:00', 'heure JEU lisible (08:00)');
  assert.equal(cv.phase, 'day', 'phase « jour » à 08:00');
  assert.equal(cv.phaseFr, 'jour', 'libellé FR de la phase');
  assert.equal(cv.tint, null, 'phase « jour » → AUCUNE teinte (pas de bruit)');
  assert.equal(seasonOf(sim), 'spring', 'jour 1 = PRINTEMPS (référentiel)');
  assert.equal(seasonView(sim).fr, 'Printemps', 'libellé FR de la saison');
  assert.equal(spawnLayer(sim).spawnFactor, 1.0, 'printemps : facteur ×1 (comportement inchangé)');
  assert.equal(seasonTint(sim), null, 'printemps : AUCUN habillage (référence)');
});

test('R48 (2) : le cycle AVANCE — déterministe (arithmétique) + l\'alerte au passage de jour', () => {
  const sim = bareSim();
  ensureClock(sim);
  // 2000 s sim : 08:00 + 2000 s → t = 2800 → ROLLOVER (2800 ≥ 2400) → jour 2,
  // t = 400 (= 400/2400 × 24 h = 04:00 — la nuit, l'aritmétique du temps est continue).
  tickClock(sim, 2000);
  assert.equal(sim.clock.day, 2, 'passage de jour : le jour s\'incrémente');
  assert.equal(sim.clock.t, 400, 'l\'heure est continue (2800 − 2400 = 400 s)');
  const cv = clockView(sim);
  assert.equal(cv.label, '04:00', 'l\'heure JEU dérivée (t/2400×24 = 04:00) est lisible');
  assert.equal(cv.phase, 'night', '04:00 = NUIT');
  // L'ALERTE : UN événement lisible au passage de jour (pas de bruit : un par
  // jour — l'historique est borné par MAX_ALERTS).
  const seasonEvents = sim.alerts.filter((a) => a.kind === 'season-change');
  assert.equal(seasonEvents.length, 1, 'UNE alerte au passage de jour (pas de bruit)');
  assert.equal(seasonEvents[0].day, 2, 'l\'alerte indique le NOUVEAU jour');
  // DÉTERMINISTE : même séquence de dt → même horloge (pas de tirage, EV-10).
  const simB = bareSim();
  ensureClock(simB);
  tickClock(simB, 2000);
  assert.equal(simB.clock.day, sim.clock.day, 'mÊME dt → MÊME jour');
  assert.equal(simB.clock.t, sim.clock.t, 'mÊME dt → MÊME heure (reproductible à la reprise)');
  // Plusieurs passages de jour : l'aritmétique tient sur plusieurs rollovers.
  tickClock(sim, DAY_S + 100); // jour 3 : t = 400 + 2500 = 2900 → rollover → 500 (05:00)
  assert.equal(sim.clock.day, 3, '2e passage de jour');
  assert.equal(sim.clock.t, 500, 't continu (400 + 2500 − 2400 = 500 — le dt > un jour tient)');
});

test('R48 (3) : les PHASES — bornes de l\'heure + la teinte du monde dérivée', () => {
  // Bornes : aube 6-7 · jour 8-16 · crépuscule 17-19 · nuit 20-5.
  assert.equal(phaseOfHour(0), 'night', '00:00 = nuit');
  assert.equal(phaseOfHour(5), 'night', '05:00 = nuit (la dernière heure de nuit)');
  assert.equal(phaseOfHour(6), 'dawn', '06:00 = aube');
  assert.equal(phaseOfHour(7), 'dawn', '07:00 = aube');
  assert.equal(phaseOfHour(8), 'day', '08:00 = jour');
  assert.equal(phaseOfHour(16), 'day', '16:00 = jour (la dernière heure de jour)');
  assert.equal(phaseOfHour(17), 'dusk', '17:00 = crépuscule');
  assert.equal(phaseOfHour(19), 'dusk', '19:00 = crépuscule');
  assert.equal(phaseOfHour(20), 'night', '20:00 = nuit');
  assert.equal(phaseOfHour(23), 'night', '23:00 = nuit');
  // La teinte du MONDE est dérivée (lecture pure phaseTint — le renderer la
  // lit, le test la vérifie SANS le DOM) : « jour » = null (pas de bruit),
  // chaque autre phase = un voile (rgba — zéro asset).
  for (const [phase, tint] of Object.entries(PHASE_TINTS)) {
    assert.equal(phaseTint(phase), tint, `phase « ${phase} » → teinte EXACTE de la table`);
  }
  assert.equal(phaseTint('jour'), null, 'une phase inconnue → null (défensive, jamais de crash)');
  assert.equal(phaseTint('day'), null, '« jour » : AUCUNE teinte (le monde est déjà éclairé)');
  assert.equal(phaseTint('night'), 'rgba(10, 14, 44, 0.34)', 'nuit : le bleuté profond (le plus visible)');
  assert.ok(phaseTint('dusk').includes('255'), 'crépuscule : voile CHAUD (255 = rouge/orange)');
  assert.ok(phaseTint('dawn').includes('180'), 'aube : voile FROID (180 = mauve)');
  // La teinte est LISABLE depuis clockView (le renderer compose météo + nuit + saison).
  const sim = bareSim();
  ensureClock(sim);
  forceClock(sim, 1, 22); // 22:00 = nuit
  assert.equal(clockView(sim).tint, 'rgba(10, 14, 44, 0.34)', 'clockView expose la teinte de la phase');
  forceClock(sim, 1, 12); // 12:00 = jour
  assert.equal(clockView(sim).tint, null, 'midi : aucune teinte');
});

test('R48 (4) : les SAISONS — le cycle de 4 jours + la normalisation défensive', () => {
  const sim = bareSim();
  ensureClock(sim);
  // Le cycle : jour 1 printemps → 2 été → 3 automne → 4 hiver → 5 printemps…
  const expected = SEASON_IDS; // ['spring', 'summer', 'autumn', 'winter']
  for (let day = 1; day <= 5; day++) {
    forceClock(sim, day, 12);
    assert.equal(seasonOf(sim), expected[(day - 1) % 4], `jour ${day} → saison « ${expected[(day - 1) % 4]} »`);
  }
  assert.equal(seasonOf(sim), 'spring', 'jour 5 = printemps à NOUVEAU (1 an-jeu = 4 jours)');
  // Les PARAMÈTRES (la table — les chiffres, pas la logique) :
  assert.equal(SEASONS.summer.spawnFactor, 1.3, 'été : cadence +30 % (pic touristique)');
  assert.equal(SEASONS.autumn.spawnFactor, 0.9, 'automne : cadence −10 %');
  assert.equal(SEASONS.winter.spawnFactor, 0.7, 'hiver : cadence −30 % (saison creuse)');
  assert.equal(SEASONS.spring.spawnFactor, 1.0, 'printemps : ×1 (référentiel)');
  // Normalisation DÉFENSIVE : une saison inconnue/corrompue → printemps
  // (référentiel — pas de facteur inventé, pas de crash).
  assert.equal(normalizeSeason('été'), 'spring', 'libellé FR → non reconnu → printemps');
  assert.equal(normalizeSeason(undefined), 'spring', 'champ absent → printemps');
  assert.equal(normalizeSeason('winter'), 'winter', 'saison VALIDE → conservée');
  // La LECTURE UI : seasonView donne la FR + le facteur + l'habillage.
  forceClock(sim, 2, 12); // été
  const sv = seasonView(sim);
  assert.equal(sv.id, 'summer');
  assert.equal(sv.fr, 'Été');
  assert.equal(sv.spawnFactor, 1.3);
  assert.equal(sv.dressing.tint, 'rgba(255, 190, 80, 0.06)', 'été : habillage doré (zéro asset)');
  forceClock(sim, 4, 12); // hiver
  assert.equal(seasonTint(sim), 'rgba(170, 200, 240, 0.12)', 'hiver : habillage bleuté');
});

test('R48 (5) : la COUCHE DE SPAWN — le facteur de saison module la cadence de la fenêtre', () => {
  // Le PRINTEMPS (référentiel) ne change RIEN : la fenêtre produit le même
  // nombre d'offres qu'avant (base 1 = 1 offre, pic = 2 offres).
  {
    const state = freshGame(42);
    const sim = state.sim;
    forceClock(sim, 1, 12); // printemps
    assert.equal(spawnLayer(sim).season, 'spring', 'saison lisible dans la couche');
    const before = sim.planning.length;
    windowClose(sim, makeSimRng(sim));
    assert.equal(sim.planning.length - before, 1, 'printemps sans pic : 1 offre (inchangé — le ×1 est bit-à-bit l\'avant)');
  }
  // L'ÉTÉ + PIC : base 2 × 1,3 = 2,6 → 3 OFFRES (la cadence saisonnière est
  // MESURABLE : la fenêtre produit PLUS de vols qu\'au printemps).
  {
    const state = freshGame(42);
    const sim = state.sim;
    forceClock(sim, 2, 12); // été
    forceIncident(sim, 'surge'); // le pic (base 2)
    assert.equal(spawnLayer(sim).spawnFactor, 1.3, 'couche : facteur été (1,3)');
    const before = sim.planning.length;
    windowClose(sim, makeSimRng(sim));
    assert.equal(sim.planning.length - before, 3, 'été + pic : 3 offres (2 × 1,3 = 2,6 → arrondi 3 — cadence +30 %)');
    // Le PIC seul (sans saison) donnerait 2 : la SURCHARGE saisonnière est la
    // 3e offre (mesure relative, pas de loterie : le rng est semé).
  }
  // L'HIVER + PIC : base 2 × 0,7 = 1,4 → 1 OFFRE (la saison creuse réduit la
  // cadence — le PLANCHER est 1 : une fenêtre ne génère JAMAIS 0 offre, le
  // comportement de référence (au moins 1 vol par fenêtre) est préservé).
  {
    const state = freshGame(42);
    const sim = state.sim;
    forceClock(sim, 4, 12); // hiver
    forceIncident(sim, 'surge');
    assert.equal(spawnLayer(sim).spawnFactor, 0.7, 'couche : facteur hiver (0,7)');
    const before = sim.planning.length;
    windowClose(sim, makeSimRng(sim));
    assert.equal(sim.planning.length - before, 1, 'hiver + pic : 1 offre (2 × 0,7 = 1,4 → plancher 1 — jamais 0)');
  }
  // HIVER SANS PIC : base 1 × 0,7 = 0,7 → PLANCHER 1 (le comportement de
  // référence : 1 offre minimum par fenêtre — le facteur ne passe JAMAIS sous).
  {
    const state = freshGame(42);
    const sim = state.sim;
    forceClock(sim, 4, 12); // hiver
    const before = sim.planning.length;
    windowClose(sim, makeSimRng(sim));
    assert.equal(sim.planning.length - before, 1, 'hiver sans pic : le plancher 1 TIENT (jamais 0 offre)');
  }
});

test('R48 (6) : la PERSISTANCE — round-trip intact + migration PRÉ-T3-horloge (champ absent) + champ corrompu', () => {
  // Round-trip : le champ horloge (jour + t) survit à la sauvegarde.
  {
    const state = makeGameState(42);
    state.screen = 'game';
    state.sim = bareSim();
    ensureClock(state.sim);
    forceClock(state.sim, 3, 14); // jour 3, 14:00 (valeur non triviale)
    const out = deserialize(serialize(state));
    assert.equal(out.sim.clock.day, 3, 'le jour SURVIT au round-trip');
    assert.equal(out.sim.clock.t, (14 / 24) * DAY_S, 't (l\'heure) survit (reprise bornée)');
  }
  // Sauvegarde PRÉ-T3-horloge : le champ n'existe PAS → ensureClock l'adopte
  // en « jour 1, 08:00 » (la partie reprend le MATIN, printemps ×1), sans
  // toucher les autres champs (migration additive, EV-10).
  {
    const state = makeGameState(42);
    state.screen = 'game';
    state.sim = bareSim();
    ensureClock(state.sim);
    forceClock(state.sim, 4, 20);
    const json = JSON.parse(serialize(state));
    delete json.state.sim.clock; // la sauvegarde PRÉ-T3-horloge (champ absent)
    const out = deserialize(JSON.stringify(json));
    assert.equal(out.sim.clock.day, 1, 'migration : le jour initial (jour 1)');
    assert.equal(out.sim.clock.t, DAY_START, 'migration : t initial (08:00)');
    assert.equal(seasonOf(out.sim), 'spring', 'migration : printemps (référentiel ×1 — comportement inchangé)');
    assert.equal(out.sim.rngSeed, 42, 'les AUTRES champs sont INTACTS (migration additive)');
  }
  // Champ CORROMPU : jour non entier / t non fini → réparé (jamais de crash).
  {
    const sim = bareSim();
    sim.clock = { day: 'trois', t: Number.NaN };
    ensureClock(sim);
    assert.equal(sim.clock.day, 1, 'jour corrompu → réparé (jour 1)');
    assert.equal(sim.clock.t, DAY_START, 't corrompu → réparé (08:00)');
    sim.clock = { day: 2, t: 100000 }; // t HORS bornes (t > DAY_S)
    ensureClock(sim);
    assert.equal(sim.clock.day, 2, 'le jour EST conservé (il est entier)');
    assert.ok(sim.clock.t >= 0 && sim.clock.t < DAY_S, 't replié dans le jour (borné)');
  }
});

test('R48 (7) : les LECTURES sont pures — clockOf / clockView / seasonOf ne mutent jamais', () => {
  const sim = newSimState(); // pas de champ horloge
  assert.equal(clockOf(sim).day, 1, 'champ ABSENT → état initial (pas de crash)');
  assert.equal(sim.clock, undefined, 'clockOf ne CRÉE PAS le champ (lecture pure)');
  const cv = clockView(sim);
  assert.equal(cv.day, 1, 'clockView : jour initial (pas de mutation)');
  assert.equal(cv.label, '08:00', 'clockView : heure initiale lisible');
  assert.equal(cv.phase, 'day', 'clockView : phase initiale (jour)');
  assert.equal(seasonOf(sim), 'spring', 'seasonOf : printemps initial (pas de mutation)');
  assert.equal(spawnLayer(sim).spawnFactor, 1.0, 'spawnLayer : facteur initial ×1 (pas de mutation)');
  assert.equal(sim.clock, undefined, 'toujours pas de champ créé (pureté confirmée)');
  // forceClock, lui, MUTE (c\'est le forçage) — et borne les entrées.
  forceClock(sim, 2, 25); // heure 25 → bornée à 23
  assert.equal(sim.clock.day, 2, 'forceClock : le jour est adopté');
  assert.equal(sim.clock.t, (23 / 24) * DAY_S, 'forceClock : l\'heure est BORNÉE (23h max)');
  forceClock(sim, 0, -3); // jour 0 / heure −3 → bornés (jour 1, 00:00)
  assert.equal(sim.clock.day, 1, 'forceClock : le jour est BORNÉ (min 1)');
  assert.equal(sim.clock.t, 0, 'forceClock : l\'heure est BORNÉE (min 00:00)');
});
