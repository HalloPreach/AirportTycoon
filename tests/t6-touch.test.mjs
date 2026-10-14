// T6 (t_87168414) — Tests unitaires du module tactile (src/ui/touch.mjs).
// DOM simulé (aucun navigateur) : on vérifie la MACHINE À ÉTATS de la
// gesture — tap / pan / pinch — et le contrat « UN seul chemin de click » :
// le tap est routé vers le callback onTap(sx, sy) (les consommateurs le
// câblent sur buildTool.clickAt / panels.clickAt, le MÊME chemin que le
// click desktop). Seuils = TOUCH_CFG (frozen, mesurables).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTouchHandlers, TOUCH_CFG } from '../src/ui/touch.mjs';

// --- Faux DOM ----------------------------------------------------------------
function makeFakeCanvas() {
  const listeners = {}; // type → [handlers]
  const canvas = {
    width: 1000, height: 800, // device pixels (scale 1 : bitmap = viewport)
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    addEventListener(type, fn, _opts) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
  };
  canvas.listeners = listeners; // exposé pour les assertions d'hygiène
  canvas.fire = (type, ev) => {
    ev.preventDefault = ev.preventDefault || (() => { ev._defaultPrevented = true; });
    for (const fn of listeners[type] || []) fn(ev);
  };
  return canvas;
}
function makeFakeCamera() {
  const c = { panCalls: [], zoomCalls: [], pan() { /* pas besoin de sim */ }, };
  c.pan = (dx, dy) => c.panCalls.push([dx, dy]);
  c.zoomAt = (sx, sy, factor, vw, vh) => c.zoomCalls.push({ sx, sy, factor, vw, vh });
  return c;
}
const touch = (clientX, clientY, id = 0) => ({ clientX, clientY, identifier: id });
// Événts synthétiques : touches (liste courante), timeStamp, preventDefault.
const evt = (type, touches, t, extra = {}) => ({
  type, timeStamp: t,
  touches: touches.map((p) => ({ clientX: p[0], clientY: p[1], identifier: p.length ? p[2] : 0 })),
  ...extra,
});

// --- Contrat des seuils (frozen) ----------------------------------------------
test('TOUCH_CFG : seuils du contrat tactile (frozen, mesurables)', () => {
  assert.equal(TOUCH_CFG.tapMaxMs, 250);
  assert.equal(TOUCH_CFG.tapMaxMovePx, 10);
  assert.equal(TOUCH_CFG.panSlopPx, 8);
  assert.equal(TOUCH_CFG.minPinchDist, 24);
  assert.deepEqual(Object.keys(TOUCH_CFG).sort(), ['minPinchDist', 'panSlopPx', 'tapMaxMovePx', 'tapMaxMs']);
  assert.ok(Object.isFrozen(TOUCH_CFG), 'le contrat doit être frozen');
});

// --- TAP : routé vers onTap avec les coordonnées canvas ------------------------
test('tap (rapide, < 10 px de dérive) → ONCE sur onTap, coordonnées canvas', () => {
  const canvas = makeFakeCanvas();
  const cam = makeFakeCamera();
  const taps = [];
  makeTouchHandlers(canvas, cam, () => ({ width: 390, height: 844 }), {
    onTap: (sx, sy) => taps.push([sx, sy]),
  });
  canvas.fire('touchstart', evt('touchstart', [[100, 200]], 1000));
  canvas.fire('touchmove', evt('touchmove', [[101, 201]], 1050)); // dérive 1.4 px
  canvas.fire('touchend', evt('touchend', [], 1100)); // 100 ms, pas de doigt restant
  assert.equal(taps.length, 1, 'un tap = un seul appel onTap');
  assert.deepEqual(taps[0], [100, 200], 'coordonnées CANVAS (début de la gesture)');
  assert.equal(cam.panCalls.length, 0, 'pas de pan pour un tap');
  assert.equal(cam.zoomCalls.length, 0, 'pas de zoom pour un tap');
});

test('tap trop long (> 250 ms) → AUCUN onTap', () => {
  const canvas = makeFakeCanvas();
  const taps = [];
  makeTouchHandlers(canvas, makeFakeCamera(), () => ({ width: 390, height: 844 }), {
    onTap: (sx, sy) => taps.push([sx, sy]),
  });
  canvas.fire('touchstart', evt('touchstart', [[100, 200]], 1000));
  canvas.fire('touchend', evt('touchend', [], 1400)); // 400 ms
  assert.equal(taps.length, 0);
});

test('tap trop dérivé (≥ 10 px) → AUCUN onTap (le doigt a bougé)', () => {
  const canvas = makeFakeCanvas();
  const taps = [];
  makeTouchHandlers(canvas, makeFakeCamera(), () => ({ width: 390, height: 844 }), {
    onTap: (sx, sy) => taps.push([sx, sy]),
  });
  canvas.fire('touchstart', evt('touchstart', [[100, 200]], 1000));
  canvas.fire('touchmove', evt('touchmove', [[112, 200]], 1050)); // 12 px > 10
  canvas.fire('touchend', evt('touchend', [], 1100));
  assert.equal(taps.length, 0);
});

// --- PAN : au-delà du slop (8 px) → camera.pan, pas de tap --------------------
test('pan 1 doigt : camera.pan appelé avec les deltas, tap exclu', () => {
  const canvas = makeFakeCanvas();
  const cam = makeFakeCamera();
  const taps = [];
  makeTouchHandlers(canvas, cam, () => ({ width: 390, height: 844 }), {
    onTap: (sx, sy) => taps.push([sx, sy]),
  });
  canvas.fire('touchstart', evt('touchstart', [[100, 200]], 1000));
  canvas.fire('touchmove', evt('touchmove', [[110, 205]], 1030)); // 11.2 px > slop 8
  canvas.fire('touchmove', evt('touchmove', [[130, 210]], 1060));
  canvas.fire('touchend', evt('touchend', [], 1100));
  assert.equal(taps.length, 0, 'une gesture pan = AUCUN tap');
  assert.equal(cam.panCalls.length, 2, 'pan incrémental (2 pas, pas le total)');
  assert.deepEqual(cam.panCalls[0], [10, 5]);
  assert.deepEqual(cam.panCalls[1], [20, 5]);
});

test('pan sous le slop (≤ 8 px) : camera.pan NON appelé (garde le statut tap)', () => {
  const canvas = makeFakeCanvas();
  const cam = makeFakeCamera();
  makeTouchHandlers(canvas, cam, () => ({ width: 390, height: 844 }), {});
  canvas.fire('touchstart', evt('touchstart', [[100, 200]], 1000));
  canvas.fire('touchmove', evt('touchmove', [[107, 200]], 1030)); // 7 px < 8
  assert.equal(cam.panCalls.length, 0);
  canvas.fire('touchend', evt('touchend', [], 1100));
});

// --- PINCH : 2 doigts → camera.zoomAt (facteur = rapport des distances) ------
test('pinch : zoomAt appelé au point milieu, facteur = d2 / d1', () => {
  const canvas = makeFakeCanvas();
  const cam = makeFakeCamera();
  makeTouchHandlers(canvas, cam, () => ({ width: 390, height: 844 }), {});
  canvas.fire('touchstart', evt('touchstart', [[100, 200], [200, 200]], 1000)); // d = 100
  canvas.fire('touchmove', evt('touchmove', [[80, 200], [220, 200]], 1050)); // d = 140
  assert.equal(cam.zoomCalls.length, 1);
  const z = cam.zoomCalls[0];
  assert.equal(z.sx, 150); // point milieu
  assert.equal(z.sy, 200);
  assert.ok(Math.abs(z.factor - 1.4) < 1e-9, `facteur 140/100 (obtenu ${z.factor})`);
  assert.deepEqual([z.vw, z.vh], [390, 844], 'viewSize transmis (zoom centré correctement)');
});

test('pinch sous minPinchDist (24 px) : pas de zoom (garde-boue bruit)', () => {
  const canvas = makeFakeCanvas();
  const cam = makeFakeCamera();
  makeTouchHandlers(canvas, cam, () => ({ width: 390, height: 844 }), {});
  canvas.fire('touchstart', evt('touchstart', [[100, 200], [120, 200]], 1000)); // d = 20 < 24
  canvas.fire('touchmove', evt('touchmove', [[100, 200], [122, 200]], 1050)); // d = 22 < 24
  assert.equal(cam.zoomCalls.length, 0);
});

test('pinch puis 1 doigt restant : le pan reprend, et le TAP est exclu', () => {
  const canvas = makeFakeCanvas();
  const cam = makeFakeCamera();
  const taps = [];
  makeTouchHandlers(canvas, cam, () => ({ width: 390, height: 844 }), {
    onTap: (sx, sy) => taps.push([sx, sy]),
  });
  canvas.fire('touchstart', evt('touchstart', [[100, 200], [200, 200]], 1000));
  canvas.fire('touchmove', evt('touchmove', [[80, 200], [220, 200]], 1050)); // zoom
  // Le doigt droit se lève (touchend, 1 doigt courant restant) : le module
  // n'agit pas encore — le ré-ancrage se fait sur le PREMIER touchmove du
  // doigt restant (mode pan, dernier point = ancre), puis panne normalement.
  canvas.fire('touchend', { ...evt('touchend', [], 1100), touches: [{ clientX: 80, clientY: 200, identifier: 0 }] });
  assert.equal(cam.panCalls.length, 0, 'pas de pan avant le touchmove du doigt restant');
  canvas.fire('touchmove', evt('touchmove', [[95, 210]], 1150)); // ré-ancrage (pas de pan)
  assert.equal(cam.panCalls.length, 0, 'le 1er move ré-ancre (mode pan), il n\'est pas un delta');
  canvas.fire('touchmove', evt('touchmove', [[110, 220]], 1180)); // delta (15, 10)
  assert.equal(cam.panCalls.length, 1, 'le doigt restant reprend le pan');
  assert.deepEqual(cam.panCalls[0], [15, 10]);
  canvas.fire('touchend', evt('touchend', [], 1200));
  assert.equal(taps.length, 0, 'une gesture qui a pinché = JAMAIS un tap');
});

// --- Hygiène : preventDefault + pas de listener « click » ----------------------
test('hygiène : preventDefault sur start/move/end, AUCUN listener click', () => {
  const canvas = makeFakeCanvas();
  makeTouchHandlers(canvas, makeFakeCamera(), () => ({ width: 390, height: 844 }), {});
  let prevented = 0;
  const evPrevent = (touches, t) => ({
    type: 'x', timeStamp: t,
    touches: touches.map((p) => ({ clientX: p[0], clientY: p[1] })),
    preventDefault: () => { prevented++; },
  });
  canvas.fire('touchstart', evPrevent([[100, 200]], 1000));
  canvas.fire('touchmove', evPrevent([[105, 202]], 1020));
  canvas.fire('touchend', evPrevent([], 1040));
  assert.equal(prevented, 3, 'les 3 preventDefault (suppression du click synthétique)');
  // Le module ne doit écouter QUE le touch (le click reste du côté desktop).
  const types = Object.keys(canvas.listeners);
  assert.ok(types.every((t) => t.startsWith('touch')), `listeners attendus touch-only (obtenus : ${types.join(', ')})`);
});
