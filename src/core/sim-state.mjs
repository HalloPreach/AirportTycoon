// État de la simulation : factory de l'objet `sim` (sérialisable tout seul).
// L'état global du jeu (game-state.mjs) ajoute un champ `.sim` ; l'UI ne branche
// que cet objet, elle n'importe jamais les règles (règle « UI fine »).
// Règle d'or : tout ce qui décide d'une règle passe dans les modules de sim ;
// tick() les orchestre. Déterministe si un PRNG semé est passé.
export const START_FUNDS = 12000; // budget réel : assez pour un petit aéroport, pas pour tout

export function newSimState() {
  return {
    infra: {
      nextId: 1,
      runways: [],   // {id, x, y, w, h, len}
      taxiways: [],  // {id, x, y, w, h}
      terminals: [], // {id, x, y, w, h, gates:[ids]}
      gates: [],     // {id, size, terminalId, x, y, w, h, acId, cleaning, maintenance}
      services: [],  // {id, type, x, y, w, h}
      grid: { w: 160, h: 120, cells: new Uint8Array(160 * 120) },
    },
    aircraft: [],    // un vol en cours de cycle (voir sim/aircraft.mjs)
    planning: [],    // vols planifiés (pas encore arrivés) : {id, airline, acType, pax, planned, status}
    nextAcId: 1,
    passengers: { totalCarried: 0, satisfaction: 100 },
    economy: { money: START_FUNDS, revenue: {}, spent: {}, debt: 0, bankrupt: false },
    alerts: [],      // événements lisibles pour l'UI (toasts/alertes)
    time: 0,         // horloge de la sim (pilotée par le planificateur : sim.time += dt)
    _spawnAcc: 0,
    _graph: null,     // graphe pathfinding (reconstruit, pas sérialisé)
    _graphDirty: true,
    rngSeed: 0,       // état du PRNG (EV-10) : seed + compteur CONSERVÉS dans la
    rngCounter: 0,    // sauvegarde → la reprise après fermeture est reproductible
  };
}

// Événement lisible pour l'UI (toast/alerte). L'UI lit sim.alerts, elle ne pollue pas l'état.
export function pushEvent(sim, e) { sim.alerts.push(e); }
