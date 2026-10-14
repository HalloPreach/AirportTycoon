// R43 (t_62bd0be8) — Palettes de rendu : STANDARD + DALTONIENNE.
// T5c (t_bd4726e7) — v2 « RADAR RÉTRO » : la carte de jeu est un SCOPE —
// fond quasi noir phosphore, trame verte, bâtiments en échelle de luminance
// verte (terminal = phosphore vif #3DFFA5) + accents CRT (ambre, rouge,
// cyan). L'échelle de LUMINANCE reste le premier critère de distinction
// (paires les plus proches : sécurité/terminal 1.10, nettoyage/carburant
// 1.12 — dans la même classe que les paires de la palette Wong d'origine,
// qui a ses propres paires ~1.02 : l'étiquette + le numéro du bâtiment
// restent la garantie, principe R43). Le mode DALTONIEN (Wong 2008)
// conserve ses couleurs de BÂTIMENTS prouvées (R43) ; seul le fond est
// basculé en radar (bleu-noir profond + trame bleutée, jamais de vert).
// Logique PURE (aucun DOM/canvas) → testable dans Node. Le renderer (UI
// fine) LIT la palette à chaque frame : les SHAPES/layout sont identiques,
// seules les CARTES DE COULEURS changent → le mode daltonien ne casse
// jamais le rendu (les symboles/textes existants — étiquettes des
// bâtiments, R/O sur les portes, FERMÉE/PANNE, hachures — restent la
// garantie de lisibilité).
//
// Le vert phosphore #3DFFA5 est PARTAGÉ entre l'UI (theme.mjs — accent,
// ok) et le monde (bâtiment terminal) : c'est le LANGAGE DU DESIGN v2
// (l'UI et le scope partagent le même phosphore) ; le test t4-theme
// applique la règle d'anti-chevauchement à la famille STRUCTURE
// (fonds/bordures/textes des panneaux), pas à la famille accent.
export const PALETTES = Object.freeze({
  standard: Object.freeze({
    name: 'standard',
    // --- Trame radar (v2) : fond phosphore + grille verte --------------------
    terrain: '#071510',          // sol noir-phosphore (v1 herbe #3d5a3a)
    gridLine: 'rgba(61,255,165,0.14)', // trame phosphore (v1 blanc 0.12)
    terrainBorder: '#1C5233',    // bordure de carte (v1 #cfd8dc clair)
    buildings: Object.freeze({
      // Échelle de luminance verte (foncé → vif) + accents CRT. Les paires
      // proches en luminance restent séparées en TONALITÉ (l'accent ambre
      // du sécurité ne ressemble jamais au vert, même pour un daltonien,
      // car la distinction s'appuie aussi sur le symbole + l'étiquette R43).
      // ORDRE des clés = contrat verrouillé par tests/r43-options.test.mjs
      // (identique aux deux palettes — ne pas réordonner).
      runway: '#0F2E1D',         // la plus sombre (fond du tarmac)
      taxiway: '#256B40',
      terminal: '#3DFFA5',       // phosphore vif (bâtiment principal)
      fuel: '#E65100',           // orange foncé CRT (carburant = critique)
      hangar: '#1D4A2E',
      catering: '#43B581',
      cleaning: '#2E8B57',
      baggage: '#8FD6AE',        // vert pâle
      // T33 (t_88aee6d5) : 3 nouveaux — accents CRT + phosphore (v2).
      security: '#FFD24A',       // ambre CRT (sécurité = critique)
      dutyfree: '#FF5A4E',       // rouge CRT
      lounge: '#4FC3F7',         // cyan CRT
    }),
    gates: Object.freeze({ S: '#43B581', M: '#FFD24A', L: '#4FC3F7', occupied: '#FF5A4E' }),
    alert: '#FF5A4E',            // X piste fermée, lise d'alerte (rouge CRT)
    menuBg: '#050807',
  }),
  colorBlind: Object.freeze({
    name: 'colorBlind',
    // Fond radar bleu-noir (pas de vert) : la trame bleutée reste visible.
    terrain: '#0a1420',
    gridLine: 'rgba(176,190,197,0.14)',
    terrainBorder: '#546e7a',
    // Wong : bleu / orange / jaunes + contrastes de luminance. COULLEURS
    // PRÉSERVÉES (R43, testées) — seuls le fond et la trame changent (T5c).
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
    menuBg: '#050807',
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
