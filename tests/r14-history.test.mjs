// R14 : journal d'alertes BORNE + erreur de tick lisible (pas de crash,
// pas de spam). node:test, zéro DOM (comme les autres tests).
//   1. pushEvent borne sim.alerts à MAX_ALERTS (les plus récentes gagnent) —
//      sinon la partie de 48 h gonflerait le journal ET la sauvegarde.
//   2. La boucle route un tick qui lève sur le bus ('sim-error') : l'erreur
//      est interceptée (pas d'unhandledrejection) et la boucle continue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSimState, pushEvent } from '../src/core/sim-state.mjs';
import { EventBus } from '../src/core/events.mjs';

// --- 1. Borne du journal d'alertes (pushEvent) --------------------------------
test('R14 : sim.alerts est borné à 500 (les plus récentes restent)', () => {
  const sim = newSimState();
  for (let i = 0; i < 520; i++) pushEvent(sim, { kind: 't', i });
  assert.equal(sim.alerts.length, 500, 'le journal ne dépasse jamais 500');
  assert.equal(sim.alerts[0].i, 20, 'les 20 plus anciennes sont sorties');
  assert.equal(sim.alerts[499].i, 519, 'la plus récente reste en bout');
});

// --- 2. Tick qui lève → 'sim-error' sur le bus, boucle continue ---------------
// Le stub global __simTick est consommé par src/core/sim.mjs (test injectable,
// le module n'importe PAS la règle) : on force un tick qui lève et on vérifie
// que startLoop route l'erreur sur le bus au lieu de la planter.
test('R14 : un tick qui lève est routé sur le bus (sim-error), pas unhandledrejection', async () => {
  const { startLoop } = await import('../src/core/loop.mjs');

  globalThis.__simTick = async () => { throw new Error('tick simulé corrompu'); };
  let frameCb = null;
  globalThis.requestAnimationFrame = (cb) => { frameCb = cb; return 1; };

  const bus = new EventBus();
  const seen = { 'sim-error': [], frame: 0 };
  bus.on('sim-error', (e) => seen['sim-error'].push(e));
  bus.on('frame', () => { seen.frame++; });

  const state = { screen: 'game', paused: false, speedIndex: 0, time: 0 };
  startLoop({ state, bus, renderer: { render() {} } });
  assert.ok(frameCb, 'la boucle est démarrée (requestAnimationFrame consommé)');

  frameCb(16); // une frame avec un tick qui lève
  await new Promise((r) => setTimeout(r)); // laisse la promesse du tick se rejeter

  assert.equal(seen['sim-error'].length, 1, "l'erreur est INTERCEPTÉE (pas perdue)");
  assert.equal(seen['sim-error'][0].message, 'tick simulé corrompu');
  assert.equal(seen.frame, 1, 'la boucle continue (frame émise malgré l\'erreur)');

  // Un 2e tick qui lève → l'erreur est toujours routée (pas de crash cumulé).
  frameCb(32);
  await new Promise((r) => setTimeout(r));
  assert.equal(seen['sim-error'].length, 2);

  delete globalThis.__simTick;
  delete globalThis.requestAnimationFrame;
});
