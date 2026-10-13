// T4 (t_eb78478e) — DESIGN TOKENS (art direction) : source UNIQUE des couleurs
// et tailles partagées entre le CANVAS (renderer, icons) et le DOM (index.html).
// Module PUR, testable Node (aucun DOM). Les variables CSS `--at-*` du :root
// d'index.html MIRENT ce module bloc par bloc — le test tests/t4-theme.test.mjs
// vérifie la cohérence des deux sources (un token changé ici DOIT être changé
// dans le :root, sinon la suite rouge).
//
// Direction artistique : « tour de contrôle la nuit » — fond bleu nuit profond,
// panneaux bleus ardoise, accent cyan (balise de tour), textes clairs. Le
// daltonien (R43) reste géré par la palette de rendu (palette.mjs) : les tokens
// ici concernent l'UI (menu, HUD, toasts, panneaux), pas les couleurs du monde.
export const THEME = Object.freeze({
  // --- Surfaces ---------------------------------------------------------------
  bg: '#0a1220',            // nuit profonde (fond du menu / page)
  surface: '#111a2b',       // panneaux (barre d'outils, consultation, planning)
  surfaceAlt: '#182439',    // panneaux relevés (modale options)
  border: '#2a3b55',        // bordures
  // --- Textes -----------------------------------------------------------------
  text: '#e8eef7',          // texte principal
  textDim: '#93a4bd',       // texte secondaire / captions
  // --- Accents (balise de tour) -----------------------------------------------
  accent: '#4fc3f7',        // cyan — focus, liens, surlignage
  accentSoft: 'rgba(79,195,247,0.16)', // fonds de surbrillance (accent léger)
  ok: '#4caf7a',            // gains / succès
  warn: '#ffb74d',          // avertissements
  err: '#ef5350',           // erreurs / pertes
  gold: '#ffd54f',          // récompenses / objectif payé
  // --- Ciel du menu (écran-titre) ---------------------------------------------
  skyTop: '#050914',
  skyBottom: '#16263f',
  moon: '#d7e3f4',
  ground: '#0d1524',
  runway: '#222c3d',
  runwayLine: '#e8eef7',
  // --- Typographie --------------------------------------------------------------
  fontUi: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  titleSize: 46,            // écran-titre (px canvas)
  subtitleSize: 15,
  hudFontSize: 15,
  versionTag: 'T4',
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
