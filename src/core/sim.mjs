// Pont UI → simulation : la carte UI ne branche QUE ce module, elle n'importe
// jamais les règles de sim. Les modules de sim sont chargés paresseusement :
// s'ils ne sont pas encore là (autre milestone en cours), le jeu tourne quand
// même — la sim se branche d'elle-même dès qu'elle est prête.
// ponytail: import paresseux + cache du module + backoff 5 s ; pas de DI.

let cache = null;
let retryAt = 0;

// Charge le graphe de sim (tick + factory + infra). Échec silencieux, on réessaie.
export async function ensureSim() {
  if (cache) return cache;
  if (Date.now() < retryAt) return null; // pas prêt à réessayer (backoff)
  retryAt = Date.now() + 5000; // les modules peuvent encore être en cours d'écriture
  try {
    const [tickM, stateM, infraM] = await Promise.all([
      import('./tick.mjs'),
      import('./sim-state.mjs'),
      import('../infra/infra.mjs'),
    ]);
    cache = {
      tick: tickM.tick,
      newSimState: stateM.newSimState,
      buildBuilding: infraM.buildBuilding,
      demolishBuilding: infraM.demolishBuilding,
    };
  } catch {
    cache = null; // sim pas prête : on y retourne plus tard (pas de crash)
  }
  return cache;
}

// Tick par frame : si la sim n'est pas prête, rien ne se passe (le jeu tourne).
export async function simTick(state, dt) {
  const m = await ensureSim();
  if (m && m.tick) m.tick(state, dt);
}

// État de sim d'une nouvelle partie (null si la sim n'est pas encore prête).
export async function freshSimState() {
  const m = await ensureSim();
  return m && m.newSimState ? m.newSimState() : null;
}
