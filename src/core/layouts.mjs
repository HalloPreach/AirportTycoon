// T3 stretch (t_79820790) — MULTI-AEROPORTS : la table AIRPORTS — un aéroport
// nommé est un PARAMÈTRE de la nouvelle partie (additif : le layout « central »
// est IDENTIQUE bit-à-bit au START_LAYOUT legacy — le spawn par défaut reste
// invariant, vérifié dans tests/r49-airports.mjs).
//
// Les layouts sont posés par le placeBuilding EXISTANT (src/core/new-game.mjs)
// → aucune règle de construction nouvelle : le réseau fourni est PHYSIQUEMENT
// VALIDE — vérifié dans tests/r49-airports.mjs (composante connexe unique,
// chemins piste→porte, zéro chevauchement, terrain 1600×1200) sur la règle de
// contact du pathfinding (src/pathfinding/path.mjs : contact si distance ≤ 20).
//
// Cap Nord (le SECOND aéroport — objectif « a second airport ») : 2 pistes —
// une CAPABLE L (longueur 800 = AIRCRAFT.large.minRunway, catalog.mjs) + une
// M (longueur 500) — et un terminal 4 portes (L, M, M, L) : un PROFIL
// DIFFÉRENT de l'aéroport central, relié par un réseau de 3 taxiways
// (corridor vertical + liaisons pistes/terminal).
export const DEFAULT_AIRPORT = 'central';

export const AIRPORTS = Object.freeze({
  central: Object.freeze({
    name: 'Aéroport central',
    layout: [
      { type: 'runway', x: 750, y: 100, w: 100, h: 1000 },
      { type: 'taxiway', x: 550, y: 1050, w: 200, h: 40 },
      { type: 'terminal', x: 550, y: 900, w: 200, h: 150 },
    ],
    gateSizes: ['M', 'M'],
  }),
  'cap-nord': Object.freeze({
    name: 'Cap Nord — aéroport du nord',
    layout: [
      { type: 'runway', x: 540, y: 100, w: 100, h: 800 },  // R1 : capable L (800)
      { type: 'runway', x: 300, y: 100, w: 100, h: 500 },  // R2 : medium (500)
      { type: 'taxiway', x: 300, y: 600, w: 200, h: 40 },  // T2 : sous le bord bas de R2
      { type: 'taxiway', x: 300, y: 640, w: 40, h: 160 },  // corridor vertical (T2 → terminal/T1)
      { type: 'terminal', x: 340, y: 650, w: 200, h: 150 },// 4 portes (L, M, M, L)
      { type: 'taxiway', x: 340, y: 800, w: 200, h: 40 }, // T1 : portes + côté de R1
    ],
    gateSizes: ['L', 'M', 'M', 'L'],
  }),
});
