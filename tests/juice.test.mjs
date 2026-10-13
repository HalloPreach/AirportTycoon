// Juice (t_5065be95) — feedback visuel léger du jeu canvas (src/ui/juice.mjs) :
//   - particules (burst construction/panne, landing atterrissage) : ajout,
//     plafonnement, durée de vie, déplacement ;
//   - nombres flottants (€ gagnés/perdus) : ajout, montée, disparition, plafond ;
//   - shake d'écran (incident majeur) : décalage borné, décroissant, s'arrête ;
//   - animations légères des panneaux : machine makeFx (entrées/sorties,
//     progression, classes CSS) ;
//   - câblage alerte → effet (juiceForAlert) : effets par événement, positions
//     et montants LUS sur la sim (lecture seule — vérifiée avant/après).
// Module PUR : tout est testable sans DOM ni canvas — draw() est vérifié avec
// un faux ctx (compteur d'appels), comme le reste de la suite (zéro navigateur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeJuice, makeFx, juiceForAlert } from '../src/ui/juice.mjs';
import { LANDING_FEE, GATE_FEE, PAX_REVENUE, PAX_REVENUE_DRY } from '../src/economy/economy.mjs';
import { newSimState } from '../src/core/sim-state.mjs';
import { forceIncident } from '../src/sim/incidents.mjs';
import { buildBuilding } from '../src/infra/infra.mjs';
import { rebuildGraph } from '../src/pathfinding/path.mjs';

// Socle (même pattern que tests/r32-incidents.test.mjs) : piste + taxiway +
// terminal + UNE station carburant, services débloqués.
function buildSocle(sim) {
  sim.economy.money = 1000000;
  sim._unlocked = { fuel: true, cleaning: true, hangar: true, baggage: true, catering: true };
  rebuildGraph(sim);
  buildBuilding(sim, 'runway', 750, 100);
  buildBuilding(sim, 'taxiway', 550, 1050);
  buildBuilding(sim, 'terminal', 550, 900);
  buildBuilding(sim, 'fuel', 100, 200);
  rebuildGraph(sim);
}

// RNG déterministe (LCG) — les tests sont reproductibles.
function lcg(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

// Faux ctx : enregistre les appels de rendu (particules = arc, nombres = fillText).
function fakeCtx() {
  const rec = { arcs: [], texts: [] };
  const ctx = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '',
    textAlign: '', textBaseline: '', lineWidth: 0,
    beginPath() {},
    arc(x, y) { rec.arcs.push([x, y]); },
    fill() {},
    strokeText() {},
    fillText(t, x, y) { rec.texts.push({ t, x, y }); },
  };
  return { ctx, rec };
}

const CAM = { x: 0, y: 0, zoom: 1 };
const VIEW = { width: 800, height: 600 };

// Sim factice minimale : juiceForAlert ne lit QUE ces champs (lecture seule).
function fakeSim() {
  return {
    aircraft: [{ id: 7, x: 100, y: 200, pax: 80, _dryDeparture: false }],
    passengers: { satisfaction: 100 },
    infra: {
      runways: [{ id: 'RW1', x: 100, y: 50, w: 40, h: 8 }],
      services: [{ id: 'FS1', x: 30, y: 40, w: 20, h: 20 }],
    },
  };
}

test('burst : particules ajoutées et plafonnées (les plus anciennes sortent)', () => {
  const j = makeJuice({ rng: lcg(1), maxParticles: 10 });
  j.burst(100, 200, { count: 5 });
  assert.equal(j.stats().particles, 5);
  j.burst(100, 200, { count: 5 });
  assert.equal(j.stats().particles, 10, 'plafond 10 — les 5 plus anciennes sont éjectées');
});

test('burst : les particules vivent, se déplacent puis disparaissent', () => {
  const j = makeJuice({ rng: lcg(2) });
  j.burst(50, 60, { count: 8, life: 1.0 });
  j.update(0.5);
  const mid = j.stats().particles;
  assert.ok(mid >= 1 && mid <= 8, 'à mi-course, une partie est encore vivante');
  j.update(2.0);
  assert.equal(j.stats().particles, 0, 'toutes expirées');
});

test('landing : petite nuage (12 particules) au point d\u2019atterrissage', () => {
  const j = makeJuice({ rng: lcg(3) });
  j.landing(50, 60);
  assert.equal(j.stats().particles, 12);
  j.update(2.0);
  assert.equal(j.stats().particles, 0, 'la nuage est courte');
});

test('float : nombre € ajouté, monte, disparaît, plafonné', () => {
  const j = makeJuice({ rng: lcg(4), maxFloats: 3 });
  j.float(10, 20, '+300 $', 'gain');
  j.float(10, 20, '−5000 $', 'loss');
  assert.equal(j.stats().floats, 2);
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  assert.equal(rec.texts.length, 2);
  const y0 = rec.texts[0].y; // monde→écran : 20 + 300
  assert.equal(y0, 320);
  j.update(0.5);
  rec.texts.length = 0;
  j.draw(ctx, CAM, VIEW);
  assert.ok(rec.texts[0].y < y0, 'le nombre s\u2019élève');
  // Plafond : 3 max
  j.float(0, 0, 'a'); j.float(0, 0, 'b'); j.float(0, 0, 'c');
  assert.equal(j.stats().floats, 3);
  j.update(2.0); // FLOAT_LIFE = 1.6 s
  assert.equal(j.stats().floats, 0, 'les nombres expirent');
});

test('shake : décalage borné à ±mag, décroissant, nul une fois terminé', () => {
  const j = makeJuice({ rng: lcg(7) });
  assert.deepEqual(j.shakeOffset(), { x: 0, y: 0 }, 'sans shake, aucun décalage');
  assert.ok(!j.stats().shake);
  j.shake(10, 0.6);
  assert.ok(j.stats().shake);
  const o1 = j.shakeOffset();
  assert.ok(Math.abs(o1.x) <= 10 && Math.abs(o1.y) <= 10, 'borné à ±mag au démarrage');
  j.update(0.3);
  const o2 = j.shakeOffset(); // à mi-durée : amplitude ≤ 5
  assert.ok(Math.abs(o2.x) <= 5 + 1e-9 && Math.abs(o2.y) <= 5 + 1e-9, 'décroissant');
  j.update(1.0);
  assert.deepEqual(j.shakeOffset(), { x: 0, y: 0 }, 'terminé → nul');
  assert.ok(!j.stats().shake);
});

test('draw : particules rendues au centre MONDE (caméra prise en compte)', () => {
  const j = makeJuice({ rng: lcg(8) });
  j.burst(120, 54, { count: 20 });
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  assert.equal(rec.arcs.length, 20);
  for (const [x, y] of rec.arcs) {
    assert.equal(x, 120 + 400, 'monde→écran : +view.width/2 (zoom 1)');
    assert.equal(y, 54 + 300);
  }
});

test('fx : entrées/sorties des panneaux (machine à états, testée)', () => {
  const fx = makeFx(0.2);
  assert.equal(fx.phase('intro'), 'idle');
  assert.equal(fx.cls('intro'), '', 'inactif → aucune classe CSS');
  fx.enter('intro');
  assert.equal(fx.phase('intro'), 'enter');
  assert.equal(fx.cls('intro'), 'fx-enter');
  assert.deepEqual(fx.active(), ['intro']);
  fx.tick(0.1);
  assert.equal(fx.progress('intro'), 0.5, 'progression à mi-course');
  fx.tick(0.1);
  assert.equal(fx.phase('intro'), 'done');
  assert.equal(fx.cls('intro'), '');
  assert.deepEqual(fx.active(), [], 'terminée → plus active');
  fx.exit('intro');
  assert.equal(fx.phase('intro'), 'exit');
  assert.equal(fx.cls('intro'), 'fx-exit');
  fx.tick(0.2);
  assert.equal(fx.phase('intro'), 'done');
  fx.clear('intro');
  assert.equal(fx.phase('intro'), 'idle');
  // Plusieurs panneaux en parallèle
  const fx2 = makeFx(0.2);
  fx2.enter('a');
  fx2.enter('b');
  assert.deepEqual(fx2.active(), ['a', 'b']);
  fx2.tick(0.3);
  assert.deepEqual(fx2.active(), []);
});

test('juice : la machine fx est exposée et avancée par update()', () => {
  const j = makeJuice();
  j.fx.enter('panel');
  j.update(0.3); // fxDur par défaut 0.2
  assert.equal(j.fx.phase('panel'), 'done');
  assert.deepEqual(j.stats().fx, [], 'plus d\u2019animation active');
});

test('juiceForAlert : atterrissage (flight-in) → nuage + € de l\u2019amarrage LUS sur la sim', () => {
  const sim = fakeSim();
  const before = JSON.stringify(sim);
  const j = makeJuice({ rng: lcg(11) });
  const effects = juiceForAlert(j, sim, { kind: 'flight-in', volId: 7 }, CAM);
  assert.deepEqual(effects, ['landing', 'float']);
  assert.equal(j.stats().particles, 12, 'la nuage d\u2019atterrissage');
  assert.equal(j.stats().floats, 1);
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  const fee = Math.round((LANDING_FEE + GATE_FEE) * 100 / 100); // satisfaction 100
  assert.equal(rec.texts[0].t, `+${fee} $`, 'montant lu sur la sim (tarif amarrage)');
  assert.equal(rec.texts[0].x, 100 + 400, 'au point de l\u2019avion (monde→écran)');
  assert.equal(JSON.stringify(sim), before, 'la sim n\u2019est PAS modifiée (lecture seule)');
});

test('juiceForAlert : départ (flight-out) → € passagers, tarif sec si départ sec', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(12) });
  const effects = juiceForAlert(j, sim, { kind: 'flight-out', volId: 7, pax: 80 }, CAM);
  assert.deepEqual(effects, ['float']);
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  assert.equal(rec.texts[0].t, `+${Math.round(80 * PAX_REVENUE * 100 / 100)} $`, 'tarif normal');
  // Départ sec (carburant) : tarif réduit
  sim.aircraft[0]._dryDeparture = true;
  const j2 = makeJuice({ rng: lcg(13) });
  juiceForAlert(j2, sim, { kind: 'flight-out', volId: 7, pax: 80 }, CAM);
  const r2 = fakeCtx();
  j2.draw(r2.ctx, CAM, VIEW);
  assert.equal(r2.rec.texts[0].t, `+${Math.round(80 * PAX_REVENUE_DRY * 100 / 100)} $`, 'tarif sec');
});

test('juiceForAlert : piste coupée → rafale au CENTRE de la piste + shake', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(14) });
  const effects = juiceForAlert(j, sim, { kind: 'runway-closed', runway: 'RW1' }, CAM);
  assert.deepEqual(effects, ['burst', 'shake']);
  assert.ok(j.stats().shake, 'incident majeur → shake d\u2019écran');
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  assert.equal(rec.arcs.length, 20);
  for (const [x, y] of rec.arcs) {
    assert.equal(x, 120 + 400, 'centre de la piste (100+40/2)');
    assert.equal(y, 54 + 300, 'centre de la piste (50+8/2)');
  }
});

test('juiceForAlert : station en panne → rafale au centre + shake', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(15) });
  const effects = juiceForAlert(j, sim, { kind: 'fuel-out', station: 'FS1' }, CAM);
  assert.deepEqual(effects, ['burst', 'shake']);
});

test('juiceForAlert : pic de demande / urgence trésorerie → shake seul', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(16) });
  assert.deepEqual(juiceForAlert(j, sim, { kind: 'surge-start' }, CAM), ['shake']);
  assert.ok(j.stats().shake);
  assert.deepEqual(juiceForAlert(j, sim, { kind: 'treasury-critical' }, CAM), ['shake']);
});

test('juiceForAlert : faillite → shake majeur (le plus fort)', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(17) });
  const effects = juiceForAlert(j, sim, { kind: 'bankrupt' }, CAM);
  assert.deepEqual(effects, ['shake']);
  assert.ok(j.stats().shake);
});

test('juiceForAlert : objectif payé → rafale dorée + € au centre de la vue (cam)', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(18) });
  const effects = juiceForAlert(j, sim, { kind: 'objective-paid', id: 'o1', name: 'X', reward: 2000 }, { x: 40, y: 50 });
  assert.deepEqual(effects, ['burst', 'float']);
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  assert.equal(rec.texts[0].t, '+2000 $');
  assert.equal(rec.texts[0].x, 40 + 400, 'ancré au centre de la vue');
});

test('juiceForAlert : emprunt obtenu → € au centre de la vue (sans particules)', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(19) });
  const effects = juiceForAlert(j, sim, { kind: 'loan-taken', principal: 5000, interest: 500 }, { x: 0, y: 0 });
  assert.deepEqual(effects, ['float']);
  assert.equal(j.stats().particles, 0);
  const { ctx, rec } = fakeCtx();
  j.draw(ctx, CAM, VIEW);
  assert.equal(rec.texts[0].t, '+5000 $');
});

test('juiceForAlert : événement inconnu → aucun effet', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(20) });
  assert.deepEqual(juiceForAlert(j, sim, { kind: 'inconnu' }, CAM), []);
  assert.equal(j.stats().particles, 0);
  assert.equal(j.stats().floats, 0);
  assert.ok(!j.stats().shake);
});

test('juiceForAlert : vol introuvable (déjà retiré de la sim) → aucun effet, pas de crash', () => {
  const sim = fakeSim();
  const j = makeJuice({ rng: lcg(21) });
  assert.deepEqual(juiceForAlert(j, sim, { kind: 'flight-in', volId: 999 }, CAM), []);
  assert.deepEqual(juiceForAlert(j, sim, { kind: 'flight-out', volId: 999 }, CAM), []);
});

// --- SIM RÉELLE (socle newSimState + forceIncident) : le câblage fonctionne sur
// l'événement réel poussé par la sim — et la sim n'est jamais modifiée. --------
test('sim réelle : forceIncident piste → l\u2019alerte runway-closed déclenche rafale + shake', () => {
  const sim = newSimState();
  buildSocle(sim);
  const rw = sim.infra.runways[0];
  forceIncident(sim, `runway:${rw.id}`);
  const ev = sim.alerts.filter((a) => a.kind === 'runway-closed').at(-1);
  assert.ok(ev, 'l\u2019événement est poussé sur la sim');
  const nAfter = sim.alerts.length;
  const j = makeJuice({ rng: lcg(22) });
  const effects = juiceForAlert(j, sim, ev, sim.camera || CAM);
  assert.ok(effects.includes('burst'), 'rafales au centre de la piste');
  assert.ok(effects.includes('shake'), 'shake d\u2019incident majeur');
  assert.equal(j.stats().particles, 20);
  assert.equal(sim.alerts.length, nAfter, 'juiceForAlert ne pousse PAS d\u2019événement (UI fine)');
});

test('sim réelle : forceIncident station → l\u2019alerte fuel-out déclenche rafale + shake', () => {
  const sim = newSimState();
  buildSocle(sim);
  const st = sim.infra.services.find((s) => s.type === 'fuel');
  assert.ok(st, 'le socle a une station carburant');
  forceIncident(sim, `fuel:${st.id}`);
  const ev = sim.alerts.filter((a) => a.kind === 'fuel-out').at(-1);
  assert.ok(ev, 'l\u2019événement est poussé sur la sim');
  const j = makeJuice({ rng: lcg(23) });
  const effects = juiceForAlert(j, sim, ev, sim.camera || CAM);
  assert.deepEqual(effects, ['burst', 'shake']);
  assert.ok(j.stats().shake);
});
