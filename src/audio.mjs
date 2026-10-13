// R44 (t_ebbb202e) — Audio SYNTHÉTISÉ, zéro asset externe (Web Audio uniquement).
// Le projet décide « règles ailleurs, UI fine ici » — l'audio suit le même
// découpage :
//   - SYNTH : les RECETTES de synthèse sont des données PURES (oscillateurs +
//     enveloppes de gain) — testables dans Node, sans AudioContext ;
//   - sfxForAlert(kind) : le mapping ALERTE → SFX est une fonction PURE (testée
//     sans navigateur). Câblée dans main.mjs sur la MÊME ligne que le toast et
//     le juice (même porte seq) : un événement = 1 toast + 1 effet visuel +
//     1 son, jamais plus ;
//   - makeAudioEngine() : la SEULE partie qui touche la Web Audio API. En
//     mode DRY (pas d'AudioContext — Node, CI) play() journalise sans erreur :
//     le module reste testable partout (stats() : dry, last, plays, ...).
// MUTE : persistant via SAUVEGARDE — le flag vit sur l'ÉTAT (state.audio =
// { muted }), sérialisé avec l'état entier par save.mjs ; le gain maître est
// `muted ? 0 : volume` (masterGainOf, pure).
// VOLUME : l'option R43 (0-100, clé dédiée aux options) pilote setVolume(v/100)
// — la valeur persiste, le moteur l'applique LIVE (main.mjs : onApply + boot).
// AMBIENT : boucle discrète optionnelle (bourdon 55 Hz + bruit filtré), OFF
// par défaut — setAmbient(true) l'active (jamais d'asset, même principe).
// ponytail : une voix par oscillateur + UN buffer de bruit blanc partagé ; les
// durées restent courtes (≤ 1 s) et les gains modestes — la synthèse doit
// rester lisible et testable, jamais d'asset (c'est le critère de la carte).

// ---- 1. RECETTES : données pures (aucune API navigateur dans ces objets) ---
// Voix : { type: 'sine'|'square'|'sawtooth'|'triangle'|'noise',
//          f0 (Hz) [, f1 (Hz, balayé en fin de voix)],
//          dur (s), gain (0..1), attack? (s), release? (s), delay? (s),
//          filter? { type: 'lowpass'|'highpass'|'bandpass', freq (Hz), q? } }
// Pour type 'noise', f0 est ignoré : la voix est un buffer de bruit blanc
// partagé, éventuellement filtré par `filter`.
export const SYNTH = Object.freeze({
  // Clic UI : tick court et discret (boutons du menu / page options).
  uiClick: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'triangle', f0: 1400, f1: 800, dur: 0.07, gain: 0.15 }),
    ]),
  }),
  // Construction : choc sourd (bruit filtré) + pop + carillon.
  build: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'noise', f0: 120, dur: 0.2, gain: 0.5, attack: 0.005, release: 0.12, filter: Object.freeze({ type: 'lowpass', freq: 400 }) }),
      Object.freeze({ type: 'square', f0: 200, f1: 320, dur: 0.12, gain: 0.22 }),
      Object.freeze({ type: 'triangle', f0: 660, dur: 0.16, gain: 0.18, delay: 0.1 }),
    ]),
  }),
  // Décollage : grondement monté (sawtooth 80→240 Hz) + souffle filtré.
  takeoff: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'sawtooth', f0: 80, f1: 240, dur: 0.9, gain: 0.28, attack: 0.15, release: 0.4 }),
      Object.freeze({ type: 'noise', f0: 500, dur: 1.0, gain: 0.2, attack: 0.25, release: 0.5, filter: Object.freeze({ type: 'bandpass', freq: 600, q: 0.7 }) }),
    ]),
  }),
  // Atterrissage : choc + boum grave + sifflement d'essuie (freinage).
  land: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'noise', f0: 80, dur: 0.25, gain: 0.55, attack: 0.005, release: 0.15, filter: Object.freeze({ type: 'lowpass', freq: 300 }) }),
      Object.freeze({ type: 'sine', f0: 70, f1: 45, dur: 0.3, gain: 0.35 }),
      Object.freeze({ type: 'noise', f0: 1200, dur: 0.35, gain: 0.1, delay: 0.18, release: 0.2, filter: Object.freeze({ type: 'highpass', freq: 2000 }) }),
    ]),
  }),
  // Gain d'argent : arpège monté (objectif réussi, emprunt obtenu, contrat réussi).
  cashGain: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'sine', f0: 660, dur: 0.09, gain: 0.2 }),
      Object.freeze({ type: 'sine', f0: 880, dur: 0.09, gain: 0.2, delay: 0.09 }),
      Object.freeze({ type: 'sine', f0: 1320, dur: 0.14, gain: 0.22, delay: 0.18 }),
    ]),
  }),
  // Perte d'argent : deux notes descendantes (trésorerie en sifflet, revenu perdu).
  cashLoss: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'sine', f0: 520, dur: 0.12, gain: 0.2 }),
      Object.freeze({ type: 'sine', f0: 330, dur: 0.18, gain: 0.22, delay: 0.12 }),
    ]),
  }),
  // Incident / événement notable : deux notes carrées (piste fermée, pic, faillite).
  event: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'square', f0: 700, dur: 0.12, gain: 0.16 }),
      Object.freeze({ type: 'square', f0: 520, dur: 0.16, gain: 0.16, delay: 0.14 }),
    ]),
  }),
  // Refus (pas de fonds / construction bloquée) : buzz bref.
  deny: Object.freeze({
    voices: Object.freeze([
      Object.freeze({ type: 'square', f0: 160, dur: 0.15, gain: 0.18 }),
    ]),
  }),
});

// Nom des SFX (lecture pour tests/CDP — la liste est close : pas de nom
// inventé à l'appel, sfxForAlert n'émet que ceux-ci).
export const SFX_NAMES = Object.freeze(Object.keys(SYNTH));

// ---- 2. Mapping ALERTE → SFX : fonction PURE (testée sans navigateur) ------
// Les kinds couverts sont ceux émis par la sim (grep pushEvent) + le feedback
// construction (built/demolished/upgraded passent ICI, pas dans build-tool :
// la sim émet l'alerte, main.mjs joue le son — un seul déclencheur, même
// porte seq que le toast et le juice). Les kinds SILENCIEUX (info sans
// conséquence sonore) retournent null.
const ALERT_SFX = Object.freeze({
  // construction / infra
  'built': 'build',
  'demolished': 'build',
  'upgraded': 'build',
  'no-funds': 'deny',
  'build-blocked': 'deny',
  'locked': 'deny',
  // vols
  'flight-in': 'land',
  'flight-out': 'takeoff',
  'flight-cancelled': 'cashLoss',
  'no-fuel': 'cashLoss',
  'ac-blocked': 'event',
  // argent
  'objective-paid': 'cashGain',
  'loan-taken': 'cashGain',
  'contract-success': 'cashGain',
  'treasury-warn': 'cashLoss',
  'treasury-critical': 'cashLoss',
  'planning-relief': 'cashLoss',
  'contract-failed': 'cashLoss',
  'contract-cancelled': 'cashLoss',
  // incidents opérationnels (BL-14)
  'runway-closed': 'event',
  'fuel-out': 'event',
  'surge-start': 'event',
  'surge-end': 'event',
  'runway-reopen': 'event',
  'fuel-back': 'event',
  'bankrupt': 'event',
  'unlocked': 'event',
  // T2-2 (t_6344db94) : la campagne (victoire) + les succès
  'campaign-won': 'cashGain',
  'campaign-lost': 'cashLoss',
  'achievement-unlocked': 'cashGain',
  // silencieux : 'flight-offer-expired', 'contract-offered',
  // 'contract-started', 'contract-refused', 'contract-expired',
  // 'bankruptcy-resumed', 'ac-blocked' non → ci-dessus, tout le reste = null.
});

export function sfxForAlert(kind) {
  return Object.prototype.hasOwnProperty.call(ALERT_SFX, kind) ? ALERT_SFX[kind] : null;
}

// ---- 3. Helpers PUFS (bornes + gains) --------------------------------------
// Gain maître = volume × (mute ? 0 : 1) : le mute coupe TOUT (le volume
// persiste — on ne « perd » jamais la préférence R43).
export function masterGainOf(volume, muted) {
  return muted ? 0 : clamp01(volume);
}

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// État audio sur le STATE du jeu (sérialisé avec la sauvegarde entière) :
// { muted: boolean } — normalisation défensive (une sauvegarde corrompue ne
// doit jamais planter le son, même pattern que normalizeOptions R43).
export function normalizeAudioState(a) {
  return { muted: !!(a && a.muted) };
}

// Validation des recettes (PURE) : retourne une LISTE d'erreurs (vide = OK).
// Les tests verrouillent la complétude : aucune recette ne peut être ajoutée
// corrompue (fréquence nulle, durée négative, gain hors 0..1, type inconnu).
const VOICE_TYPES = new Set(['sine', 'square', 'sawtooth', 'triangle', 'noise']);
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);

export function validateVoice(v) {
  const errs = [];
  if (!VOICE_TYPES.has(v.type)) errs.push(`type inconnu : ${v.type}`);
  if (!(v.f0 > 0) || !Number.isFinite(v.f0)) errs.push(`f0 invalide : ${v.f0}`);
  if (v.f1 != null && (!(v.f1 > 0) || !Number.isFinite(v.f1))) errs.push(`f1 invalide : ${v.f1}`);
  if (!(v.dur > 0) || !Number.isFinite(v.dur)) errs.push(`dur invalide : ${v.dur}`);
  if (v.dur > 2) errs.push(`dur trop longue : ${v.dur} (≤ 2 s)`);
  if (!(v.gain > 0) || v.gain > 1 || !Number.isFinite(v.gain)) errs.push(`gain hors (0..1] : ${v.gain}`);
  if (v.attack != null && (v.attack < 0 || v.attack >= v.dur)) errs.push(`attack hors [0..dur) : ${v.attack}`);
  if (v.release != null && (v.release < 0 || v.release > v.dur)) errs.push(`release hors [0..dur] : ${v.release}`);
  if (v.delay != null && v.delay < 0) errs.push(`delay négatif : ${v.delay}`);
  if (v.filter) {
    if (!FILTER_TYPES.has(v.filter.type)) errs.push(`filter.type inconnu : ${v.filter.type}`);
    if (!(v.filter.freq > 0) || !Number.isFinite(v.filter.freq)) errs.push(`filter.freq invalide : ${v.filter.freq}`);
    if (v.filter.q != null && v.filter.q <= 0) errs.push(`filter.q invalide : ${v.filter.q}`);
  }
  return errs;
}

export function validateSynth() {
  const errs = [];
  for (const [name, recipe] of Object.entries(SYNTH)) {
    if (!Array.isArray(recipe.voices) || recipe.voices.length === 0) {
      errs.push(`${name} : aucune voix`);
      continue;
    }
    for (const [i, v] of recipe.voices.entries()) errs.push(...validateVoice(v).map((e) => `${name}[${i}] : ${e}`));
  }
  return errs;
}

// ---- 4. MOTEUR : la seule partie qui touche la Web Audio API ---------------
// `Ctx` est injectable (tests : un faux AudioContext ; navigateur : absent →
// globalThis.AudioContext). SANS contexte (Node/CI) = mode DRY : play()
// journalise et retourne false, jamais d'exception.
export function makeAudioEngine({ Ctx = null, now = () => Date.now() } = {}) {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let volume = 0.5; // défaut = l'option R43 par défaut (50)
  let muted = false; // défaut = normalizeAudioState(undefined)
  let ambientOn = false;
  let ambientNodes = null;
  const playLog = [];

  function ensure() {
    if (ctx) return true;
    const Ctor = Ctx || globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return false; // mode dry (Node)
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = masterGainOf(volume, muted);
      master.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }

  // Buffer de bruit blanc PARTAGÉ (ponytail : un seul buffer, 1 s, Math.random
  // — le bruit est de l'audio, la détermination ne le concerne pas).
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function scheduleVoice(v, t0) {
    const start = t0 + (v.delay || 0);
    const end = start + v.dur;
    const attack = v.attack != null ? v.attack : 0.005;
    const release = v.release != null ? v.release : 0.05;
    const peak = start + attack;
    const relStart = Math.max(peak, end - release);
    let src;
    if (v.type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
    } else {
      src = ctx.createOscillator();
      src.type = v.type;
      src.frequency.setValueAtTime(v.f0, start);
      if (v.f1 != null) src.frequency.linearRampToValueAtTime(v.f1, end);
    }
    let node = src;
    if (v.filter) {
      const f = ctx.createBiquadFilter();
      f.type = v.filter.type;
      f.frequency.value = v.filter.freq;
      if (v.filter.q) f.Q.value = v.filter.q;
      src.connect(f);
      node = f;
    }
    const g = ctx.createGain(); // enveloppe : montée → plateau → descente
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(v.gain, peak);
    g.gain.setValueAtTime(v.gain, relStart);
    g.gain.linearRampToValueAtTime(0.0001, end);
    node.connect(g);
    g.connect(master);
    src.start(start);
    src.stop(end + 0.05);
  }

  function play(name) {
    const recipe = SYNTH[name];
    if (!recipe) {
      playLog.push({ name, at: now(), dry: ctx == null, skipped: 'inconnu' });
      return false;
    }
    if (!ensure()) {
      playLog.push({ name, at: now(), dry: true, skipped: 'dry' });
      return false;
    }
    if (ctx.state === 'suspended') {
      // Politique d'autoplay (navigateur) : le contexte peut naître « suspendu »
      // avant un geste utilisateur — on le réveille (promesse abandonnée : si
      // le geste n'a pas eu lieu, la première écoute réelle reprend).
      try { ctx.resume && ctx.resume().catch(() => {}); } catch { /* dry-safe */ }
    }
    const t0 = ctx.currentTime;
    for (const v of recipe.voices) scheduleVoice(v, t0);
    playLog.push({ name, at: now() });
    return true;
  }

  function setVolume(v) {
    volume = clamp01(v);
    if (master) master.gain.value = masterGainOf(volume, muted);
  }

  function setMuted(b) {
    muted = !!b;
    if (master) master.gain.value = masterGainOf(volume, muted);
  }

  // Ambiance discrète (bourdon + bruit filtré) : OFF par défaut.
  function setAmbient(on) {
    ambientOn = !!on;
    if (!ensure()) return; // dry : on retient seulement l'intention
    if (ambientOn && !ambientNodes) {
      const g = ctx.createGain(); // le gain d'ambiance est FIXE (indépendant du mute :
      g.gain.value = 0.05;        // le gain maître, en aval, reste la source unique du coupé)
      g.connect(master);
      const o1 = ctx.createOscillator();
      o1.type = 'sine'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = 55.4; // battement lent (vibré doux)
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer();
      n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 220;
      const ng = ctx.createGain(); ng.gain.value = 0.5;
      o1.connect(g); o2.connect(g);
      n.connect(f); f.connect(ng); ng.connect(g);
      o1.start(); o2.start(); n.start();
      ambientNodes = { g, o1, o2, n, f, ng };
    } else if (!ambientOn && ambientNodes) {
      try { ambientNodes.o1.stop(); ambientNodes.o2.stop(); ambientNodes.n.stop(); } catch { /* déjà stoppé */ }
      ambientNodes.g.disconnect();
      ambientNodes = null;
    }
  }

  function stats() {
    return {
      dry: ctx == null,
      ctxState: ctx ? ctx.state : null,
      muted,
      volume,
      ambient: ambientOn,
      plays: playLog.length,
      last: playLog.length ? playLog[playLog.length - 1] : null,
    };
  }

  // État initial (main.mjs le pousse depuis l'option R43 + la sauvegarde).
  setVolume(0.5);
  setMuted(false);

  return {
    play,
    setVolume,
    setMuted,
    setAmbient,
    isMuted: () => muted,
    getVolume: () => volume,
    stats,
  };
}
