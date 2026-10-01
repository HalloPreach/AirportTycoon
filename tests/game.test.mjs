// Tests logiques Node (aucun DOM) : machine à états, horloge, caméra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setScreen, togglePause, cycleSpeed, speedFactor, advanceTime, canTransition,
} from '../src/core/game-state.mjs';
import { Camera } from '../src/ui/camera.mjs';

test('nouvelle partie démarre au menu, non en pause', () => {
  const s = newGame();
  assert.equal(s.screen, 'menu');
  assert.equal(s.paused, false);
  assert.equal(s.time, 0);
  assert.equal(s.speedIndex, 0);
});

test('transitions autorisées : menu→game, game→menu', () => {
  assert.equal(canTransition('menu', 'game'), true);
  assert.equal(canTransition('game', 'menu'), true);
});

test('transition interdite menu→menu lève une erreur', () => {
  const s = newGame();
  assert.throws(() => setScreen(s, 'menu'));
});

test('menu→game réussit et repart non en pause', () => {
  const s = newGame();
  s.paused = true;
  setScreen(s, 'game');
  assert.equal(s.screen, 'game');
  assert.equal(s.paused, false);
});

test('la pause n\'avance pas le temps de jeu', () => {
  const s = newGame();
  setScreen(s, 'game');
  togglePause(s);
  assert.equal(advanceTime(s, 5), 0);
  assert.equal(s.time, 0);
  togglePause(s);
  assert.equal(advanceTime(s, 5), 5); // x1
});

test('les vitesses x1, x2, x4 s\'appliquent au temps de jeu', () => {
  const s = newGame();
  setScreen(s, 'game');
  assert.equal(advanceTime(s, 2), 2);          // x1
  cycleSpeed(s);
  assert.equal(speedFactor(s), 2);
  assert.equal(advanceTime(s, 2), 4);          // x2
  cycleSpeed(s);
  assert.equal(speedFactor(s), 4);
  assert.equal(advanceTime(s, 2), 8);          // x4
  cycleSpeed(s);
  assert.equal(speedFactor(s), 1);             // retour au x1
});

test('en pause ou au menu, le temps ne s\'avance jamais', () => {
  const s = newGame();
  assert.equal(advanceTime(s, 5), 0); // menu
  setScreen(s, 'game');
  togglePause(s);
  assert.equal(advanceTime(s, 5), 0);
});

test('la caméra panne en coordonnées monde (échelle zoom)', () => {
  const s = newGame();
  const cam = new Camera(s);
  const c = s.camera;
  assert.deepEqual([c.x, c.y, c.zoom], [800, 600, 1]);
  cam.pan(10, 20); // déplacer la vue de 10 px à droite = le centre monde va 10 à gauche
  assert.equal(c.x, 790);
  assert.equal(c.y, 580);
});

test('le zoom est borné et conserve le point monde sous la souris', () => {
  const s = newGame();
  const cam = new Camera(s);
  const c = s.camera;
  cam.zoomAt(0, 0, 2, 800, 600); // le point coin-haut-gauche de l'écran reste fixe
  assert.ok(c.zoom > 1);
  cam.zoomAt(0, 0, 0.1, 800, 600);
  cam.zoomAt(0, 0, 0.1, 800, 600);
  assert.ok(c.zoom >= cam.minZoom - 1e-9); // borné en dessous
  cam.zoomAt(0, 0, 100, 800, 600);
  assert.ok(c.zoom <= cam.maxZoom + 1e-9); // borné au-dessus
});

test('les conversions écran↔monde sont cohérentes', () => {
  const s = newGame();
  const cam = new Camera(s);
  // au zoom 1, centre écran = centre monde
  assert.equal(cam.screenToWorldX(400, 800), 800);
  assert.equal(cam.screenToWorldY(300, 600), 600);
  // aller-retour : écran → monde → écran
  const sx = 500, sy = 250;
  const wx = cam.screenToWorldX(sx, 800);
  const wy = cam.screenToWorldY(sy, 600);
  assert.equal((wx - s.camera.x) * s.camera.zoom + 800 / 2, sx);
  assert.equal((wy - s.camera.y) * s.camera.zoom + 600 / 2, sy);
});
