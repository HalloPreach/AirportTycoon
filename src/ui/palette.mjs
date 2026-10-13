// R43 (t_62bd0be8) — Palettes de rendu : STANDARD + DALTONIENNE.
// Logique PURE (aucun DOM/canvas) → testable dans Node. Le renderer (UI fine)
// LIT la palette à chaque frame : les SHAPES/layout sont identiques, seules
// les CARTES DE COULEURS changent → le mode daltonien ne casse jamais le
// rendu (les symboles/textes existants — étiquettes des bâtiments, R/O sur
// les portes, FERMÉE/PANNE, hachures — restent la garantie de lisibilité).
//
// Palette daltonienne : Wong (2008), conçue pour la cécité aux couleurs
// (protanope/deuteranope) : bleus/oranges + contraste de LUMINANCE. Les
// paires rouge/vert problématiques du standard (vertes des portes S, rouge
// des portes occupées, vert/herbe, vert-jaune du baggage) sont remplacées.
export const PALETTES = Object.freeze({
  standard: Object.freeze({
    name: 'standard',
    terrain: '#3d5a3a',        // herbe
    gridLine: 'rgba(255,255,255,0.12)',
    terrainBorder: '#cfd8dc',
    buildings: Object.freeze({
      runway: '#455a64', taxiway: '#78909c', terminal: '#1e88e5',
      fuel: '#fdd835', hangar: '#ef6c00', catering: '#9c27b0',
      cleaning: '#26c6da', baggage: '#7cb342',
      // T33 (t_88aee6d5) : les 3 nouveaux — couleurs DISTINCTES des 8
      // existantes (l'étiquette + le numéro restent la garantie, R43).
      security: '#7c4dff', dutyfree: '#ff5252', lounge: '#ff8f00',
    }),
    gates: Object.freeze({ S: '#4caf50', M: '#ff9800', L: '#2196f3', occupied: '#e53935' }),
    alert: '#e53935',          // X piste fermée, lise d'alerte
    menuBg: '#1a237e',
  }),
  colorBlind: Object.freeze({
    name: 'colorBlind',
    // Fond neutre bleu-gris (pas de vert) : le quadrillage blanc reste visible.
    terrain: '#2e3d4f',
    gridLine: 'rgba(255,255,255,0.12)',
    terrainBorder: '#cfd8dc',
    // Wong : bleu / orange / jaunes + contrastes de luminance.
    buildings: Object.freeze({
      runway: '#37474f', taxiway: '#b0bec5', terminal: '#0072B2',
      fuel: '#F0E442', hangar: '#E69F00', catering: '#CC79A7',
      cleaning: '#56B4E9', baggage: '#009E73',
      // T33 (t_88aee6d5) : 3 nouveaux dans le spectre Wong étendu
      // (luminance + l'étiquette — jamais la couleur seule, principe R43).
      security: '#332288', dutyfree: '#999999', lounge: '#7F7F7F',
    }),
    // S (vert-bleu) / M (orange) / L (bleu) : les TROIS restent distincts en
    // luminance + taille, et les lettres S/M/L sont déjà peintes (zoom ≥ 0.7).
    gates: Object.freeze({ S: '#009E73', M: '#E69F00', L: '#0072B2', occupied: '#D55E00' }),
    // Rouge → vermillon (lu « orange » par un daltonien) : l'alerte ne repose
    // PAS sur la couleur seule (symbole X + texte FERMÉE/PANNE).
    alert: '#D55E00',
    menuBg: '#1a237e',
  }),
});

// `mode` : toute valeur truthy (options.colorBlind) → palette daltonienne ;
// sinon la palette standard (défaut). Jamais d'erreur : un mode inconnu est
// interprété comme standard (le rendu ne peut pas casser, critère R43).
export function getPalette(mode) {
  return mode ? PALETTES.colorBlind : PALETTES.standard;
}

// Toute couleur attendue par le renderer est soit un hex #rrggbb (ou #rgb),
// soit un rgba(...) lisible : les tests vérifient que les deux palettes sont
// COMPLÈTES et VALIDES (aucune clé manquante = pas de rendu cassé).
export function isColor(v) {
  if (typeof v !== 'string') return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(\s*,\s*[\d.]+)?\s*\)$/i.test(v);
}
