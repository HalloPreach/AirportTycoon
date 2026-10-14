// Juice (t_5065be95) — feedback visuel léger du jeu canvas.
// UI fine : zéro règle de sim (LECTURE SEULE), module pur testable Node —
// le canvas n'est touché que dans draw(), le DOM jamais (le CSS fait les
// animations, ce module fait les DÉCLENCHEMENTS).
//   - particules : construction (éclats), panne (rafales), objectif payé ;
//   - nombres flottants : € gagnés (atterrissage / départ / objectif / emprunt)
//     et perdus (construction, démolition) — montants LUS sur la sim ;
//   - shake d'écran : incident majeur (piste coupée, station en panne, faillite)
//     ; appliqué par le renderer en translate du monde (le HUD reste stable) ;
//   - animations légères des panneaux (entrées/sorties) : machine à états makeFx
//     (testée) ; le code appelant applique les classes CSS .fx-enter/.fx-exit.
// Les particules/valeurs vivent en COORDONNÉES MONDE (suivent la caméra) ;
// le shake est en pixels écran.

import { LANDING_FEE, GATE_FEE, PAX_REVENUE, PAX_REVENUE_DRY } from '../economy/economy.mjs';
import { THEME } from './theme.mjs'; // T5c : police phosphore monospace (les nombres flottants lisent comme des contacts radars)

// T5c (t_bd4726e7) : couleurs v2 « RADAR RÉTRO » (tokens theme.mjs — même
// phosphore + accents CRT : les nombres/particules lisent comme des
// contacts radars, pas du Material gris/vert).
const COLORS = Object.freeze({ gain: '#3DFFA5', loss: '#FF5A4E', info: '#B9F5CE' });
const BURST_COLORS = Object.freeze(['#3DFFA5', '#FFC94A', '#FFD24A', '#8FD6AE']); // éclats construction
const DANGER_COLORS = Object.freeze(['#FF5A4E', '#FFC94A', '#FFD24A']); // panne / fermeture
const GOLD = Object.freeze(['#FFC94A', '#FFD24A', '#FFE082']); // objectif payé
const PUFF = Object.freeze(['#8FD6AE', '#B9F5CE', '#3DFFA5']); // atterrissage

const FLOAT_LIFE = 1.6; // s — durée de vie d'un nombre flottant
const FLOAT_RISE = 26; // px monde / s — il s'élève en s'estompant

// --- Machine à états des animations de panneaux (pure, testable) -----------
// enter(name)/exit(name) démarrent une animation ; tick(dt) la fait progresser
// ; phase()/progress() donnent son état ; cls() renvoie la classe CSS à
// appliquer (vide = rien). Le DOM applique, les tests vérifient le déclenchement.
export function makeFx(dur = 0.2) {
  const anims = new Map(); // name → { phase: 'enter'|'exit'|'done', t, dur }
  const phaseOf = (name) => (anims.get(name) ? anims.get(name).phase : 'idle');
  return {
    enter: (name) => anims.set(name, { phase: 'enter', t: 0, dur }),
    exit: (name) => anims.set(name, { phase: 'exit', t: 0, dur }),
    tick: (dt) => {
      for (const a of anims.values()) {
        a.t = Math.min(a.dur, a.t + dt);
        if (a.t >= a.dur) a.phase = 'done';
      }
    },
    phase: phaseOf,
    progress: (name) => { const a = anims.get(name); return a ? a.t / a.dur : 0; },
    cls: (name) => { const p = phaseOf(name); return p === 'enter' ? 'fx-enter' : p === 'exit' ? 'fx-exit' : ''; },
    active: () => [...anims.keys()].filter((n) => ['enter', 'exit'].includes(anims.get(n).phase)),
    clear: (name) => anims.delete(name),
  };
}

// --- Système d'effets : particules + nombres + shake (coordonnées monde) ---
export function makeJuice(opts = {}) {
  const maxParticles = opts.maxParticles ?? 300;
  const maxFloats = opts.maxFloats ?? 40;
  const rng = opts.rng ?? Math.random;
  const fx = makeFx(opts.fxDur ?? 0.2);
  const particles = [];
  const floats = [];
  let shake = null; // { mag, dur, t }

  function cap(arr, max, item) { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); }

  // Éclats radiaux (construction, panne, objectif) — n particules, couleurs,
  // vitesse d'éclatement (px/s), durée de vie (s, tirée aléatoirement ±50 %).
  function burst(x, y, { count = 16, colors = BURST_COLORS, spread = 90, life = 0.9 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const sp = (0.3 + 0.7 * rng()) * spread;
      const maxLife = life * (0.5 + 0.5 * rng());
      cap(particles, maxParticles, {
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: maxLife,
        maxLife,
        size: 1.5 + 2.5 * rng(),
        color: colors[(rng() * colors.length) | 0],
      });
    }
  }

  // Nombre flottant (€) — kind : 'gain' | 'loss' | 'info' (couleur).
  function float(x, y, text, kind = 'info') {
    cap(floats, maxFloats, { x, y, text, kind, life: FLOAT_LIFE, maxLife: FLOAT_LIFE });
  }

  // Feedback d'atterrissage : petite nuage au point de contact (pas de « splash »).
  function landing(x, y) { burst(x, y, { count: 12, colors: PUFF, spread: 40, life: 0.6 }); }

  // Shake d'écran (incident majeur) : re-déclenche (mag px, dur s).
  function shakeNow(mag = 10, dur = 0.6) { shake = { mag, dur, t: 0 }; }

  // Avance tout (dt temps RÉEL en s — le juice est cosmétique, il avance même
  // en pause). Appelé à chaque frame par main.mjs (bus 'frame').
  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 1.2 * dt); // frottement léger
      p.vy *= Math.max(0, 1 - 1.2 * dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.y -= FLOAT_RISE * dt;
      f.life -= dt;
      if (f.life <= 0) floats.splice(i, 1);
    }
    if (shake) shake.t = Math.min(shake.dur, shake.t + dt);
    fx.tick(dt);
  }

  // Décalage écran (px) du shake — borné à ±mag, décroissant, 0 si inactif.
  // Le renderer le traduit en ctx.translate AUTOUR du monde (pas du HUD).
  function shakeOffset() {
    if (!shake || shake.t >= shake.dur) return { x: 0, y: 0 };
    const f = 1 - shake.t / shake.dur;
    return { x: (rng() * 2 - 1) * shake.mag * f, y: (rng() * 2 - 1) * shake.mag * f };
  }

  // Rendu — appelé par le renderer (espace monde→écran ; cam {x,y,zoom}, view {width,height}).
  function draw(ctx, cam, view) {
    const toSx = (wx) => (wx - cam.x) * cam.zoom + view.width / 2;
    const toSy = (wy) => (wy - cam.y) * cam.zoom + view.height / 2;
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(toSx(p.x), toSy(p.y), p.size * cam.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = `13px ${THEME.fontUi}, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.maxLife));
      const sx = toSx(f.x);
      const sy = toSy(f.y);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; // contour lisible sur n'importe quel fond
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = COLORS[f.kind] || COLORS.info;
      ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  // Lecture pour les tests / CDP (pas de règle, juste l'état du juice).
  function stats() {
    return {
      particles: particles.length,
      floats: floats.length,
      shake: !!(shake && shake.t < shake.dur),
      fx: fx.active(),
    };
  }

  return {
    burst,
    float,
    landing,
    shake: shakeNow,
    update,
    shakeOffset,
    draw,
    stats,
    fx, // la machine d'animations des panneaux (déclenchée par l'appelant)
  };
}

// Câblage alerte → effet (PURE : testé sans DOM). Positions et montants lus en
// LECTURE SEULE sur la sim ; `cam` (centre de la vue en monde) = ancre pour les
// événements sans position. « built » / « demolished » ne sont PAS ici : le
// feedback construction/démolition est câblé dans build-tool (onPlaced + branche
// démolition, qui portent les positions exactes) — un seul déclencheur par effet.
export function juiceForAlert(juice, sim, alert, cam = { x: 0, y: 0 }) {
  const effects = [];
  const push = (...names) => effects.push(...names);
  const sat = sim.passengers && sim.passengers.satisfaction != null ? sim.passengers.satisfaction : 100;
  const ac = alert.volId != null ? sim.aircraft.find((a) => a.id === alert.volId) : null;
  switch (alert.kind) {
    case 'flight-in': { // atterrissage : nuage + € de l'amarrage (lis sur la sim)
      if (!ac) break;
      juice.landing(ac.x, ac.y);
      push('landing');
      const fee = Math.round((LANDING_FEE + GATE_FEE) * sat / 100);
      if (fee > 0) { juice.float(ac.x, ac.y - 24, `+${fee} $`, 'gain'); push('float'); }
      break;
    }
    case 'flight-out': { // départ : € passagers (tarif sec si départ sec, lisible via _dryDeparture)
      if (!ac) break;
      const pax = alert.pax != null ? alert.pax : ac.pax;
      const rate = ac._dryDeparture ? PAX_REVENUE_DRY : PAX_REVENUE;
      const rev = Math.round(pax * rate * sat / 100);
      if (rev > 0) { juice.float(ac.x, ac.y - 24, `+${rev} $`, 'gain'); push('float'); }
      break;
    }
    case 'runway-closed': {
      const rw = sim.infra.runways.find((r) => r.id === alert.runway);
      if (rw) { juice.burst(rw.x + rw.w / 2, rw.y + rw.h / 2, { colors: DANGER_COLORS, count: 20 }); juice.shake(); push('burst', 'shake'); }
      break;
    }
    case 'fuel-out': {
      const st = sim.infra.services.find((s) => s.id === alert.station);
      if (st) { juice.burst(st.x + st.w / 2, st.y + st.h / 2, { colors: DANGER_COLORS, count: 16 }); juice.shake(); push('burst', 'shake'); }
      break;
    }
    case 'surge-start':
    case 'treasury-critical':
      juice.shake(6, 0.4);
      push('shake');
      break;
    case 'bankrupt':
      juice.shake(16, 1.0);
      push('shake');
      break;
    case 'objective-paid':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 24 });
      juice.float(cam.x, cam.y, `+${alert.reward} $`, 'gain');
      push('burst', 'float');
      break;
    case 'loan-taken':
      juice.float(cam.x, cam.y, `+${alert.principal} $`, 'gain');
      push('float');
      break;
    // T2-2 (t_6344db94) : la campagne (victoire) + les succès (le centre de
    // l'écran — pas de position dans l'événement, comme « objective-paid »).
    case 'campaign-won':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 48 });
      juice.float(cam.x, cam.y, `+${alert.reward} $ — Saison remportée`, 'gain');
      push('burst', 'float');
      break;
    case 'campaign-lost':
      juice.burst(cam.x, cam.y, { colors: DANGER_COLORS, count: 30 });
      juice.shake(8, 0.5);
      push('burst', 'shake');
      break;
    case 'achievement-unlocked':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 24 });
      juice.float(cam.x, cam.y, `Succès : ${alert.name}`, 'gain');
      push('burst', 'float');
      break;
    // T3 (t_4c9baadc) : un événement dynamique se déclenche (signal central —
    // éclat doré, PAS de shake : un événement n'est pas une PANNE, les
    // incidents majeurs gardent le shake ; le pic touristique n'ajoute rien
    // au shake du « surge-start » s'il coïncide avec un pic en cours).
    case 'event-start':
      juice.burst(cam.x, cam.y, { colors: GOLD, count: 24 });
      juice.float(cam.x, cam.y, `Événement : ${alert.name || alert.event || ''}`, 'gain');
      push('burst', 'float');
      break;
  }
  return effects;
}
