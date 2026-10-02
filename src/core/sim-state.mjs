// État de la simulation : factory de l'objet `sim` (sérialisable tout seul).
// L'état global du jeu (game-state.mjs) ajoute un champ `.sim` ; l'UI ne branche
// que cet objet, elle n'importe jamais les règles (règle « UI fine »).
// Règle d'or : tout ce qui décide d'une règle passe dans les modules de sim ;
// tick() les orchestre. Déterministe si un PRNG semé est passé.
// BL-18 : budget de départ SOLVALE. L'aéroport de départ (piste+taxiway+terminal
// fournis, A-2) est DÉFICITAIRE sur 48 h en politique passive : l'exploitation
// socle (OPEX_PER_SEC, ~550 k$/48 h) + les indemnités vols annulés (321 k$) +
// le carburant dépassent les recettes (~535 k$). Avec 12 k$, le solde franchit
// −10 000 en ~3 h → faillite + gel de la sim (et le bug d'intérêts non capés
// verrouillait le solde au seuil). 345 k$ = le capital de départ qui rend le
// cycle 48 h SOLVALE (money > −10 000 en h=48, politique passive ET bl17 —
// fenêtre de refus + incident forcé, le scénario le plus dur) sans toucher
// l'équilibrage (OPEX_PER_SEC intact, critère A12 « socle coûte même sans vol »
// préservé). Mesures (seed 42, intérêts capés) : passive min +57 809, bl17
// min +18 351 — les deux au-dessus du seuil.
// t_00ecae73 : LE CAPITAL RESTE LE VRAI (12 000), pas gonflé. Le déficit 48 h
// venait d'une cause racine LOGIQUE : le planificateur planifiait des vols que
// l'aéroport ne pouvait pas servir (portes S/L inexistantes à la base) → 638
// annulations → 319 k$ d'indemnités (6× l'opex). Corrigée (planOneFlight ne
// planifie que les types SERVABLES — une piste assez longue + une porte de la
// taille), l'aéroport de base est de nouveau solvable avec 12 000 : l'opex
// (~550 k$/48 h) est couvert par les recettes (vol médium servable). On ne
// gonfle PAS le capital pour faire passer le scénario — on corrige l'équilibrage
// à la racine.
export const START_FUNDS = 12000; // capital légitime (pas gonflé, t_00ecae73)

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
    // Passagers agrégés (BL-13, AC22/AC40) : total transporté (compté UNE fois
    // à l'embarquement), satisfaction évolutive, groupes en cours + files par
    // étape (check-in/sécurité/embarquement) — voir src/sim/passengers.mjs.
    passengers: { totalCarried: 0, satisfaction: 100,
                  queue: { checkin: 0, security: 0, board: 0 }, groups: [] },
    economy: { money: START_FUNDS, revenue: {}, spent: {}, debt: 0, bankrupt: false },
    alerts: [],      // événements lisibles pour l'UI (toasts/alertes)
    // Incidents opérationnels (BL-14, A-7) : 3 incidents limités (piste fermée,
    // panne carburant, pic de demande) — état propre, sérialisable seul, tirés
    // par le rng semé (reproductible à la reprise). Voir src/sim/incidents.mjs.
    incidents: { runway: { closed: 0, acc: 0, last: 0 },
                fuel: { out: 0, acc: 0, last: 0 },
                surge: { active: false, remaining: 0, acc: 0, last: 0 } },
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
