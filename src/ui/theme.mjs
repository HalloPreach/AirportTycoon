// T5c (t_bd4726e7) — DESIGN TOKENS v2 : design system « RADAR RÉTRO »
// (maquette retenue : mockups/variant-c.html — écran radar phosphore CRT :
// vert phosphore sur fond quasi noir, anneaux de portée, réticule, balayage,
// blips à traînée, statique fine, lignes de balayage). Source UNIQUE des
// couleurs et tailles partagées entre le CANVAS (renderer, icons) et le DOM
// (index.html). Module PUR, testable Node (aucun DOM). Les variables CSS
// `--at-*` du :root d'index.html MIRENT ce module bloc par bloc — le test
// tests/t4-theme.test.mjs vérifie la cohérence des deux sources (un token
// changé ici DOIT être changé dans le :root, sinon la suite rouge).
//
// Le daltonien (R43) reste géré par la palette de rendu (palette.mjs) :
// les tokens ici concernent l'UI (menu, HUD, toasts, panneaux) et la
// trame phosphore du rendu, pas les couleurs du MONDE (un token ne doit
// jamais égaliser une couleur de palette.mjs).
//
// Contraste (mesuré, T5c) : texte principal #B9F5CE ≥ 4.5:1 sur les fonds
// de panneaux (pire cas = surface alpha 0.82 sur le monde le plus clair) ;
// la surface du HUD (rgba(5,8,7,0.9) sur le monde le plus clair) reste
// ≥ 10:1. Le texte secondaire #8FD6AE est éclairé par rapport à la
// maquette (#5E9478 ≈ 3.9:1 sur le pire fond de panneau) pour tenir le
// seuil AA 4.5:1 ; #5E9478 reste l'accent décoratif (borders, inactifs —
// non soumis au contraste texte).
export const THEME = Object.freeze({
  version: 'v2-radar-retro', // T5c : v1 « tour de contrôle la nuit » → v2
  // --- Surfaces phosphore ------------------------------------------------------
  bg: '#050807',             // noir phosphore (fond du menu / page / canvas)
  surface: '#0B120E',        // panneaux (barre d'outils, consultation, planning)
  surfaceAlt: '#0F1A12',    // panneaux relevés (modale options)
  border: '#1C5233',        // bordures (trame radar forte)
  // --- Textes ------------------------------------------------------------------
  text: '#B9F5CE',          // texte principal (phosphore doux — lisibilité)
  textDim: '#8FD6AE',       // texte secondaire / captions (AA ≥ 4.5:1 mesuré)
  // --- Accents (phosphore principal) ------------------------------------------
  accent: '#3DFFA5',        // phosphore — focus, liens, surlignage, balayage
  accentSoft: 'rgba(61,255,165,0.12)', // fonds de surbrillance (phosphore léger)
  ok: '#3DFFA5',            // gains / succès
  warn: '#FFD24A',          // avertissements (ambre CRT)
  err: '#FF5A4E',           // erreurs / pertes (rouge CRT)
  gold: '#FFC94A',          // récompenses / objectif payé
  // --- Écran-titre (scope radar — la « carte » du menu, variant-c) -------------
  skyTop: '#030504',
  skyBottom: '#0A1510',
  moon: '#3DFFA5',          // blips / contacts du scope
  ground: '#050807',
  runway: '#0E2418',        // trame du scope (anneaux de portée)
  runwayLine: '#3DFFA5',    // réticule / croix
  // --- Trames CRT (canvas, non miroirées en CSS) -------------------------------
  phosphor: '#3DFFA5',      // = accent (alias canvas explicite)
  grid: '#11331F',          // grille / trame fine (carte)
  gridStrong: '#1C5233',    // = border (anneaux, réticule)
  scanline: 'rgba(61,255,165,0.05)', // lignes de balayage CRT (phosphore, maquette)
  static: 'rgba(140,255,190,0.06)',   // statique fine (menu + carte)
  glow: '0 0 8px rgba(61,255,165,0.55)', // halo phosphore (texte titres)
  radius: '3px',            // rayon CRT (petit)
  // --- Typographie (maquette : monospace unique — 0 police chargée, 0 asset) ---
  fontUi: "'Courier New', 'IBM Plex Mono', monospace",
  titleSize: 46,            // écran-titre (px canvas)
  subtitleSize: 14,
  hudFontSize: 16,
  versionTag: 'T5c',
});

// Tokens MIRRORÉS en variables CSS `--at-<clé>` dans le :root d'index.html —
// la liste EXPLICITE (seules les valeurs hex/rgba sont miroirées ; les tailles
// et la police ne le sont pas). Le test de cohérence parcourt cette liste.
export const CSS_MIRRORED_KEYS = Object.freeze([
  'bg', 'surface', 'surfaceAlt', 'border', 'text', 'textDim',
  'accent', 'accentSoft', 'ok', 'warn', 'err', 'gold',
]);

// Couleur d'un token par clé (les clés miroirées + les clés canvas).
export function themeColor(key) {
  const v = THEME[key];
  return typeof v === 'string' && (v[0] === '#' || v[0] === 'r') ? v : null;
}
