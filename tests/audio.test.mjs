// R44 (t_ebbb202e) — Audio SYNTHÉTISÉ (src/audio.mjs) : le contrat à verrouiller :
//   1. les RECETTES de synthèse (SYNTH) sont des données PURES : 8 SFX
//      (uiClick, build, takeoff, land, cashGain, cashLoss, event, deny),
//      validées par validateSynth (aucune fréquence nulle, aucun gain hors
//      (0..1], aucune durée > 2 s, types connus) — zéro asset externe ;
//   2. sfxForAlert(kind) est une fonction PURE (kind → nom de SFX ou null —
//      les kinds inconnus/silencieux ne jouent RIEN) ; le mapping couvre les
//      kinds émis par la sim (construction, vols, argent, incidents BL-14) ;
//   3. masterGainOf : le mute coupe le gain maître (volume persiste) ;
//   4. makeAudioEngine : en mode DRY (Node, pas d'AudioContext) play()
//      JOURNALISE et retourne false — jamais d'exception ; avec un contexte
//      (FAUX, injecté) le moteur planifie les voix (oscillateurs + bruit) et
//      le gain maître suit setVolume/setMuted ; l'ambiance reste OFF par défaut.
// Logique PURE (zéro DOM, zéro navigateur) — même patron que juice.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTH, SFX_NAMES, sfxForAlert, masterGainOf, clamp01,
  normalizeAudioState, validateSynth, makeAudioEngine,
} from '../src/audio.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs'; // R44 : le cycle sauvegarde/reprise
import { makeGameState } from '../src/core/new-game.mjs';

// --- 1. RECETTES : complètes, valides, PURES (zéro asset) -------------------
const EXPECTED = ['uiClick', 'build', 'takeoff', 'land', 'cashGain', 'cashLoss', 'event', 'deny'];

test('SYNTH : les 8 SFX attendus existent, les voix sont valides (validateSynth vide)', () => {
  for (const n of EXPECTED) assert.ok(SYNTH[n], `SFX manquant : ${n}`);
  assert.deepEqual([...SFX_NAMES].sort(), [...EXPECTED].sort(), 'liste close (pas de nom inventé)');
  assert.deepEqual(validateSynth(), [], 'aucune recette corrompue (fréquence/durée/gain/types)');
});

test('SYNTH : les recettes sont des DONNÉES pures (sérialisables, pas de code)', () => {
  // Critère de la carte : zéro asset externe — les recettes ne contiennent
  // que des nombres/chaînes (un test de charge d'asset échouerait ici).
  const json = JSON.parse(JSON.stringify(SYNTH));
  assert.deepEqual(json, SYNTH, 'les recettes sont 100 % données (JSON-stable)');
  for (const r of Object.values(SYNTH)) {
    assert.ok(Array.isArray(r.voices) && r.voices.length > 0);
    for (const v of r.voices) {
      assert.equal(typeof v.f0, 'number');
      assert.equal(typeof v.dur, 'number');
      assert.equal(typeof v.gain, 'number');
      assert.equal(typeof v.type, 'string');
    }
  }
});

test('chaque recette porte au moins une voix ET la durée totale est bornée', () => {
  for (const [name, r] of Object.entries(SYNTH)) {
    const total = r.voices.reduce((m, v) => Math.max(m, (v.delay || 0) + v.dur), 0);
    assert.ok(total <= 1.2, `${name} : la plus longue voix tient en ≤ 1,2 s (court, lisible)`);
  }
});

// --- 2. sfxForAlert : mapping PUR (kind → SFX ou null) ----------------------
test('sfxForAlert : les kinds de la sim sont couverts (construction/vols/argent/incidents)', () => {
  assert.equal(sfxForAlert('built'), 'build');
  assert.equal(sfxForAlert('demolished'), 'build');
  assert.equal(sfxForAlert('upgraded'), 'build');
  assert.equal(sfxForAlert('no-funds'), 'deny');
  assert.equal(sfxForAlert('build-blocked'), 'deny');
  assert.equal(sfxForAlert('flight-in'), 'land');
  assert.equal(sfxForAlert('flight-out'), 'takeoff');
  assert.equal(sfxForAlert('flight-cancelled'), 'cashLoss');
  assert.equal(sfxForAlert('no-fuel'), 'cashLoss');
  assert.equal(sfxForAlert('objective-paid'), 'cashGain');
  assert.equal(sfxForAlert('loan-taken'), 'cashGain');
  assert.equal(sfxForAlert('contract-success'), 'cashGain');
  assert.equal(sfxForAlert('treasury-warn'), 'cashLoss');
  assert.equal(sfxForAlert('treasury-critical'), 'cashLoss');
  assert.equal(sfxForAlert('planning-relief'), 'cashLoss');
  assert.equal(sfxForAlert('runway-closed'), 'event');
  assert.equal(sfxForAlert('fuel-out'), 'event');
  assert.equal(sfxForAlert('surge-start'), 'event');
  assert.equal(sfxForAlert('bankrupt'), 'event');
});

test('sfxForAlert : les kinds SILENCIEUX/inconnus ne jouent RIEN (null)', () => {
  assert.equal(sfxForAlert('flight-offer-expired'), null);
  assert.equal(sfxForAlert('contract-offered'), null);
  assert.equal(sfxForAlert('contract-started'), null);
  assert.equal(sfxForAlert('contract-expired'), null);
  assert.equal(sfxForAlert('bankruptcy-resumed'), null);
  assert.equal(sfxForAlert('quelque-chose-dinventé'), null, 'kind inconnu → silence (jamais d’erreur)');
  assert.equal(sfxForAlert(null), null);
  assert.equal(sfxForAlert(undefined), null);
  // Et chaque SFX émis par le mapping EXISTE dans SYNTH (pas de nom orphelin).
  for (const k of Object.keys(SYNTH)) { /* boucle vide : la liste close est testée plus haut */ }
  for (const name of [...SFX_NAMES]) assert.ok(SYNTH[name], `${name} orphelin`);
});

// --- 3. Helpers pures : gain maître, bornes, normalisation -----------------
test('masterGainOf : le MUTE coupe le gain, le volume persiste', () => {
  assert.equal(masterGainOf(0.5, false), 0.5);
  assert.equal(masterGainOf(1, false), 1);
  assert.equal(masterGainOf(0.7, true), 0, 'muet → 0 (jamais de son)');
  assert.equal(masterGainOf(0, false), 0, 'volume 0 = muet aussi');
  assert.equal(masterGainOf(150, false), 1, 'volume borné (1)');
  assert.equal(masterGainOf(NaN, false), 0, 'NaN → 0 (jamais NaN sur le gain)');
});

test('clamp01 : bornes 0..1 (non-numérique → 0)', () => {
  assert.equal(clamp01(0.3), 0.3);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01('abc'), 0);
  assert.equal(clamp01(null), 0);
});

test('normalizeAudioState : { muted } défensif (corrompu → non muet)', () => {
  assert.deepEqual(normalizeAudioState(undefined), { muted: false });
  assert.deepEqual(normalizeAudioState(null), { muted: false });
  assert.deepEqual(normalizeAudioState({ muted: true }), { muted: true });
  assert.deepEqual(normalizeAudioState({ muted: 'oui' }), { muted: true }, 'coercion booléen');
  assert.deepEqual(normalizeAudioState('corrompu'), { muted: false });
});

// --- 4. MOTEUR : mode DRY (Node) — jamais d'exception ----------------------
test('mode DRY (Node, pas de contexte) : play journalise, retourne false', () => {
  const a = makeAudioEngine();
  assert.equal(a.stats().dry, true, 'Node → dry (pas d’AudioContext)');
  assert.equal(a.play('build'), false, 'dry : pas de planification');
  assert.equal(a.stats().last.name, 'build', 'mais JOURNALISÉ (tests/CDP)');
  assert.equal(a.stats().last.dry, true);
  assert.equal(a.play('inventé'), false);
  assert.equal(a.stats().last.skipped, 'inconnu');
  // Le reste de l'API reste sans erreur en dry.
  a.setVolume(0.2);
  a.setMuted(true);
  a.setAmbient(true); // l'intention est retenue, pas d'exception
  assert.equal(a.stats().ambient, true);
  assert.equal(a.stats().muted, true);
});

// --- 5. MOTEUR : avec un contexte (FAUX, injecté) ---------------------------
// Faux AudioContext : enregistre ce que le moteur planifie (oscillateurs,
// gains, bruit, filters, start/stop) — même patron de faux ctx que juice.test.
// `rec.gains` liste TOUS les GainNode dans l'ordre de création : le 1er est
// le gain MAÎTRE (créé dans ensure(), avant les enveloppes de voix).
function makeFakeCtx() {
  const rec = {
    osc: 0, bufferSrc: 0, filters: 0, buffers: 0,
    gains: [], starts: [], stops: [], connected: 0,
  };
  function param() {
    const p = { value: 0 };
    p.setValueAtTime = () => {};
    p.linearRampToValueAtTime = () => {};
    return p;
  }
  function node(kind) {
    const n = {
      kind,
      type: '', loop: false, buffer: null,
      connect(t) { rec.connected++; return t; },
      disconnect() {},
      start(t) { rec.starts.push({ kind, t }); },
      stop(t) { rec.stops.push({ kind, t }); },
    };
    if (kind === 'gain') n.gain = param();
    if (kind === 'osc') n.frequency = param();
    if (kind === 'filter') { n.frequency = param(); n.Q = param(); }
    return n;
  }
  const ctx = {
    rec,
    currentTime: 100,
    state: 'running',
    sampleRate: 8000,
    destination: { sink: true },
    resume() { this.state = 'running'; return Promise.resolve(); },
    createOscillator() { rec.osc++; return node('osc'); },
    createBufferSource() { rec.bufferSrc++; return node('noise'); },
    createGain() { const g = node('gain'); rec.gains.push(g); return g; },
    createBiquadFilter() { rec.filters++; return node('filter'); },
    createBuffer(_ch, len) { rec.buffers++; return { getChannelData: () => new Float32Array(len) }; },
  };
  return ctx;
}

// Le moteur fait `new Ctx()` : une fonction CONSTRUCTIBLE qui renvoie le faux
// ctx (un renvoi objet l'emporte sur `this` — le faux ctx est celui utilisé).
function ctxFactory(fctx) {
  function CtxFake() { return fctx; }
  return CtxFake;
}

test('play : planifie EXACTEMENT les voix de la recette (build = 1 bruit + 2 osc + filtre)', () => {
  const fctx = makeFakeCtx();
  const a = makeAudioEngine({ Ctx: ctxFactory(fctx) });
  assert.equal(a.play('build'), true, 'le contexte INJECTÉ est planifié (pas dry)');
  assert.equal(a.stats().dry, false, 'contexte dispo → plus de dry (créé au 1er play)');
  assert.equal(fctx.rec.osc, 2, 'build porte 2 oscillateurs (pop + carillon)');
  assert.equal(fctx.rec.bufferSrc, 1, 'build porte 1 source de bruit (choc)');
  assert.equal(fctx.rec.filters, 1, 'le choc est filtré (lowpass)');
  assert.equal(fctx.rec.starts.length, 3, 'toutes les voix sont lancées');
  assert.equal(fctx.rec.stops.length, 3, '... et arrêtées (durée bornée)');
  assert.equal(a.stats().last.name, 'build');
});

test('setMuted/setVolume : le gain MAÎTRE suit (source unique du son coupé)', () => {
  const fctx = makeFakeCtx();
  const a = makeAudioEngine({ Ctx: ctxFactory(fctx) });
  a.play('uiClick'); // crée le contexte (gain maître = 1er gain créé)
  const master = fctx.rec.gains[0];
  assert.ok(master, 'le gain maître existe');
  assert.equal(master.gain.value, 0.5, 'volume par défaut 50 → 0,5 (option R43)');
  a.setMuted(true);
  assert.equal(master.gain.value, 0, 'muet → gain maître 0 (le volume n’est PAS touché)');
  a.setVolume(0.25);
  assert.equal(master.gain.value, 0, 'muet reste coupé même en changeant le volume');
  a.setMuted(false);
  assert.equal(master.gain.value, 0.25, 'le dé-mute RESTITUE le volume courant');
  assert.equal(a.getVolume(), 0.25, 'le volume avait survécu au mute (préférence intacte)');
});

test('play inconnu : retourne false et ne planifie RIEN', () => {
  const fctx = makeFakeCtx();
  const a = makeAudioEngine({ Ctx: ctxFactory(fctx) });
  assert.equal(a.play('inexistant'), false);
  assert.equal(fctx.rec.starts.length, 0, 'aucune voix planifiée');
  assert.equal(a.stats().last.skipped, 'inconnu');
});

test('ambiance : OFF par défaut, activable (3 sources), désactivable', () => {
  const fctx = makeFakeCtx();
  const a = makeAudioEngine({ Ctx: ctxFactory(fctx) });
  assert.equal(a.stats().ambient, false, 'OFF par défaut (la carte l’exige)');
  a.setAmbient(true);
  assert.equal(a.stats().ambient, true);
  assert.equal(fctx.rec.starts.length, 3, '2 oscillateurs (bourdon + battement) + bruit en boucle');
  a.setAmbient(false);
  assert.equal(a.stats().ambient, false);
  assert.equal(fctx.rec.stops.length, 3, 'les 3 sources sont stoppées');
});

test('suspended → play réveille le contexte (politique autoplay navigateur)', () => {
  const fctx = makeFakeCtx();
  fctx.state = 'suspended';
  let resumed = 0;
  const origResume = fctx.resume;
  fctx.resume = () => { resumed++; return origResume.call(fctx); };
  const a = makeAudioEngine({ Ctx: ctxFactory(fctx) });
  a.play('event');
  assert.equal(resumed, 1, 'resume() appelé (promesse abandonnée, jamais d’erreur)');
  assert.equal(fctx.state, 'running');
});

// --- 6. PERSISTENCE : state.audio survit à la sauvegarde/reprise ----------------
// Critère de la carte : « mute persistant via save » — le mute vit sur l'ÉTAT
// (sérialisé entier par save.mjs), pas dans un second stockage. Même patron
// d'aller-retour que tests/r18-network-overlay (préférence boolean sur state).

test('persistance : state.audio survit au cycle sauvegarde/reprise (le mute ne se perd pas)', () => {
  const state = makeGameState(42);
  assert.deepEqual(state.audio, { muted: false }, 'état neuf : non muet (défaut)');
  state.audio = { muted: true };
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored.audio, { muted: true }, 'le mute persiste à la reprise');
  assert.ok(restored.sim && restored.sim.infra && restored.sim.infra.gates.length === 2,
    'la sim survit au cycle');
});

test('persistance : sauvegarde PRÉ-R44 (sans champ audio) → normalisation défensive', () => {
  // Sauvegarde ancienne : le champ n'existe pas (deserialize l'accepte —
  // REQUIRED = screen/time/terrain/camera). normalizeAudioState (appelé au
  // load dans main.mjs) → non muet, jamais de crash.
  const state = makeGameState(42);
  delete state.audio;
  const restored = deserialize(serialize(state));
  assert.equal(restored.audio, undefined, 'sauvegarde ancienne : champ absent (accepté)');
  assert.deepEqual(normalizeAudioState(restored.audio), { muted: false }, 'absent → non muet');
});
