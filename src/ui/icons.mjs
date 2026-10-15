// T4 (t_eb78478e) — CONSIGNES D'ICÔNES VECTORIELLES (zéro asset) : les glyphes
// des 11 types de construction + avion + info, dessinés sur N'IMPORTE QUEL
// contexte canvas 2D (boutons de la barre de construction, boutons-scénarios
// du menu). Module PUR, testable Node (un faux ctx enregistre les appels —
// tests/t4-theme.test.mjs). `iconCanvas()` est le SEUL point de contact DOM
// (fabrique un <canvas> ; jamais appelé sous Node — la factory est
// navigateur-only, comme le reste de la UI).
// T7c (t_605b9779) : + 9 glyphes d'onglets de menu (inspect, fin, stats,
// goals, season, unlocks, contracts, alerts, net — « plane » existe déjà et
// sert à l'onglet Vols) → 23 glyphes au total.
//
// Règle de dessin : chaque glyphe occupe la boîte [0,size]² avec ~12 % de
// marge ; 2 couleurs max (couleur principale + accent) — lisibilité au petit
// format (18-24 px), pas de détail superflu.
import { THEME } from './theme.mjs';

// Les 11 types de construction (catalog.mjs) + glyphes génériques.
export const ICON_KINDS = Object.freeze([
  'runway', 'taxiway', 'terminal', 'gate', 'fueling', 'security',
  'catering', 'boarding', 'hotel', 'parking', 'cafe',
  'plane', 'info', 'gear',
  // T7c (t_605b9779) : les 9 glyphes d'onglets de menu (« plane » est
  // réutilisé par l'onglet Vols — pas dupliqué ici).
  'inspect', 'fin', 'stats', 'goals', 'season', 'unlocks', 'contracts',
  'alerts', 'net',
]);

const PAD = 0.12; // marge relative (partie de la boîte laissée vide)

// Dessine le glyphe `kind` dans la boîte [0,size]². `color` (trait/remplissage
// principal) et `accent` (détail) : défauts = theme (texte / cyan). Un kind
// inconnu dessine un carré neutre (jamais d'exception — UI fine, zéro crash).
export function drawIcon(ctx, kind, size, { color = THEME.text, accent = THEME.accent } = {}) {
  const s = size;
  const m = s * PAD; // marge
  const box = s - 2 * m; // côté de la zone utile
  ctx.save();
  ctx.translate(m, m);
  try {
    switch (kind) {
      case 'runway': { // bande horizontale + ligne de centre en pointillés
        ctx.fillStyle = color;
        ctx.fillRect(0, box * 0.3, box, box * 0.4);
        ctx.fillStyle = accent;
        const n = 5;
        for (let i = 0; i < n; i++) ctx.fillRect(box * (i + 0.35) / (n + 0.5), box * 0.46, box * 0.18, box * 0.08);
        break;
      }
      case 'taxiway': { // chemin en L (deux bandes parallèles simplifiées)
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(box * 0.15, box * 0.85);
        ctx.lineTo(box * 0.5, box * 0.85);
        ctx.quadraticCurveTo(box * 0.85, box * 0.85, box * 0.85, box * 0.5);
        ctx.lineTo(box * 0.85, box * 0.15);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(box * 0.15, box * 0.85, Math.max(1, box * 0.09), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'terminal': { // bâtiment : toit à deux pentes + porte
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, box * 0.45);
        ctx.lineTo(box * 0.5, box * 0.12);
        ctx.lineTo(box, box * 0.45);
        ctx.lineTo(box, box);
        ctx.lineTo(0, box);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.fillRect(box * 0.42, box * 0.62, box * 0.16, box * 0.38); // porte
        break;
      }
      case 'gate': { // poste d'attache : tarmac + silhouette avion
        ctx.fillStyle = color;
        ctx.fillRect(0, box * 0.68, box, box * 0.2); // tarmac
        planeBody(ctx, box * 0.5, box * 0.42, box * 0.52, accent);
        break;
      }
      case 'fueling': { // éclair dans un rond (station)
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.5, box * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(box * 0.56, box * 0.24);
        ctx.lineTo(box * 0.36, box * 0.54);
        ctx.lineTo(box * 0.5, box * 0.54);
        ctx.lineTo(box * 0.44, box * 0.76);
        ctx.lineTo(box * 0.64, box * 0.46);
        ctx.lineTo(box * 0.5, box * 0.46);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'security': { // bouclier + coche
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(box * 0.5, box * 0.1);
        ctx.lineTo(box * 0.88, box * 0.24);
        ctx.lineTo(box * 0.88, box * 0.52);
        ctx.quadraticCurveTo(box * 0.88, box * 0.8, box * 0.5, box * 0.92);
        ctx.quadraticCurveTo(box * 0.12, box * 0.8, box * 0.12, box * 0.52);
        ctx.lineTo(box * 0.12, box * 0.24);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, box * 0.09);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(box * 0.34, box * 0.5);
        ctx.lineTo(box * 0.46, box * 0.62);
        ctx.lineTo(box * 0.68, box * 0.38);
        ctx.stroke();
        break;
      }
      case 'catering': { // assiette + vapeur
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(box * 0.5, box * 0.66, box * 0.4, box * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(box * (0.5 + i * 0.18), box * 0.34, box * 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'boarding': { // porte + flèche d'accès
        ctx.fillStyle = color;
        ctx.fillRect(box * 0.5, 0, box * 0.5, box);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(0, box * 0.5);
        ctx.lineTo(box * 0.42, box * 0.5);
        ctx.lineTo(box * 0.3, box * 0.36);
        ctx.moveTo(box * 0.42, box * 0.5);
        ctx.lineTo(box * 0.3, box * 0.64);
        ctx.lineWidth = Math.max(1, box * 0.12);
        ctx.strokeStyle = accent;
        ctx.lineCap = 'round';
        ctx.stroke();
        break;
      }
      case 'hotel': { // bâtiment + 3 fenêtres éclairées
        ctx.fillStyle = color;
        ctx.fillRect(box * 0.16, box * 0.14, box * 0.68, box * 0.86);
        ctx.fillStyle = accent;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
          ctx.fillRect(box * (0.28 + c * 0.32), box * (0.28 + r * 0.32), box * 0.18, box * 0.18);
        }
        break;
      }
      case 'parking': { // P dans un carré
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.strokeRect(0, 0, box, box);
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, box * 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(box * 0.34, box * 0.82);
        ctx.lineTo(box * 0.34, box * 0.18);
        ctx.lineTo(box * 0.62, box * 0.18);
        ctx.quadraticCurveTo(box * 0.8, box * 0.3, box * 0.62, box * 0.48);
        ctx.lineTo(box * 0.34, box * 0.48);
        ctx.stroke();
        break;
      }
      case 'cafe': { // tasse + vapeur
        ctx.fillStyle = color;
        ctx.fillRect(box * 0.18, box * 0.42, box * 0.5, box * 0.42);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.beginPath();
        ctx.arc(box * 0.68, box * 0.6, box * 0.16, -Math.PI * 0.5, Math.PI * 0.5);
        ctx.stroke();
        ctx.fillStyle = accent;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(box * (0.34 + i * 0.22), box * 0.26, box * 0.06, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'plane': { // silhouette vue de dessus
        planeBody(ctx, box * 0.5, box * 0.5, box, color);
        break;
      }
      case 'info': { // rond + i
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.1);
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.5, box * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.32, box * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(box * 0.44, box * 0.44, box * 0.12, box * 0.32);
        break;
      }
      case 'gear': { // engrenage (options) : cercle + 8 dents
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, box * 0.12);
        ctx.beginPath();
        ctx.arc(box * 0.5, box * 0.5, box * 0.26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        for (let i = 0; i < 8; i++) {
          ctx.save();
          ctx.translate(box * 0.5, box * 0.5);
          ctx.rotate((i * Math.PI) / 4);
          ctx.fillRect(box * 0.32, -box * 0.07, box * 0.16, box * 0.14);
          ctx.restore();
        }
        break;
      }
      // T7c (t_605b9779) : les 9 glyphes des ONGLETS DE MENU (2 couleurs max,
      // même style de trait — lisibles à 24 px ; l'onglet Vols réutilise 'plane').
      case 'inspect': { // loupe : cercle + poignée (l'inspection)
        const c = size * 0.40, r = size * 0.26;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.12;
        ctx.beginPath();
        ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = size * 0.14;
        ctx.beginPath();
        ctx.moveTo(c + r * 0.72, c + r * 0.72);
        ctx.lineTo(size * 0.82, size * 0.82);
        ctx.stroke();
        break;
      }
      case 'fin': { // pièce « $ » : le bilan financier
        const cx = size * 0.5, cy = size * 0.5, r = size * 0.34;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = size * 0.1;
        ctx.beginPath();
        ctx.moveTo(cx, size * 0.34);
        ctx.lineTo(cx, size * 0.66);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(size * 0.40, size * 0.42);
        ctx.lineTo(size * 0.60, size * 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(size * 0.40, size * 0.58);
        ctx.lineTo(size * 0.60, size * 0.58);
        ctx.stroke();
        break;
      }
      case 'stats': { // histogramme : 3 barres croissantes + ligne de base
        const base = size * 0.78, bw = size * 0.16;
        for (const [x, top] of [[size * 0.22, size * 0.48], [size * 0.42, size * 0.32], [size * 0.62, size * 0.18]]) {
          ctx.fillStyle = color;
          ctx.fillRect(x, top, bw, base - top);
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = size * 0.08;
        ctx.beginPath();
        ctx.moveTo(size * 0.16, base);
        ctx.lineTo(size * 0.84, base);
        ctx.stroke();
        break;
      }
      case 'goals': { // cible : 2 anneaux concentriques + point central
        const cx = size * 0.5, cy = size * 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.1;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = size * 0.09;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.06, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'season': { // soleil : disque central + 8 rayons (les saisons)
        const cx = size * 0.5, cy = size * 0.5;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI / 4) * i;
          ctx.moveTo(cx + Math.cos(a) * size * 0.26, cy + Math.sin(a) * size * 0.26);
          ctx.lineTo(cx + Math.cos(a) * size * 0.40, cy + Math.sin(a) * size * 0.40);
        }
        ctx.stroke();
        break;
      }
      case 'unlocks': { // cadenas : anse (demi-arc) + corps + trousseau
        const cx = size * 0.5;
        ctx.strokeStyle = accent;
        ctx.lineWidth = size * 0.12;
        ctx.beginPath();
        ctx.arc(cx, size * 0.42, size * 0.18, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(size * 0.30, size * 0.42, size * 0.40, size * 0.34);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, size * 0.56, size * 0.05, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'contracts': { // document : page + 3 lignes (les contrats)
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.09;
        ctx.strokeRect(size * 0.28, size * 0.16, size * 0.44, size * 0.66);
        ctx.strokeStyle = accent;
        ctx.lineWidth = size * 0.08;
        for (const [y, w] of [[size * 0.36, size * 0.28], [size * 0.52, size * 0.28], [size * 0.68, size * 0.16]]) {
          ctx.beginPath();
          ctx.moveTo(size * 0.38, y);
          ctx.lineTo(size * 0.38 + w, y);
          ctx.stroke();
        }
        break;
      }
      case 'alerts': { // cloche : dôme + jupe trapézoïdale + languette
        const cx = size * 0.5, cy = size * 0.46, r = size * 0.26;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 0);
        ctx.lineTo(cx + r * 0.75, cy + r * 0.62);
        ctx.lineTo(cx - r * 0.75, cy + r * 0.62);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.62 + size * 0.07, size * 0.05, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'net': { // globe : cercle + méridien (ellipse) + 2 parallèles
        const cx = size * 0.5, cy = size * 0.5, r = size * 0.34;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.09;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = size * 0.07;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = accent;
        const dy = r * 0.55, hw = Math.sqrt(r * r - dy * dy);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx - hw, cy + s * dy);
          ctx.lineTo(cx + hw, cy + s * dy);
          ctx.stroke();
        }
        break;
      }
      default: { // inconnu : carré neutre (jamais d'exception)
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, box, box);
        break;
      }
    }
  } finally {
    ctx.restore();
  }
}

// Silhouette d'avion (vue de dessus) centrée en (cx, cy), envergure ~w :
// fuselage allongé + ailes en delta + queue. Réutilisée (gate/plane).
function planeBody(ctx, cx, cy, w, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  // fuselage
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.09, w * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  // ailes
  ctx.beginPath();
  ctx.moveTo(0, -w * 0.08);
  ctx.lineTo(-w * 0.34, w * 0.14);
  ctx.lineTo(0, w * 0.2);
  ctx.lineTo(w * 0.34, w * 0.14);
  ctx.closePath();
  ctx.fill();
  // queue
  ctx.beginPath();
  ctx.moveTo(0, w * 0.22);
  ctx.lineTo(-w * 0.13, w * 0.34);
  ctx.lineTo(w * 0.13, w * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Fabrique un <canvas> contenant le glyphe (boutons de la barre de
// construction, boutons-scénarios du menu). Navigateur-only : sous Node la
// factory de UI n'est jamais exécutée (guard explicite, zéro crash).
// T7c (t_605b9779) : avec un STUB DOM dont le canvas n'a pas de context
// (tests DOM sans canvas réel) on retourne le canvas sans le peindre —
// jamais d'exception (contrat T4 : UI fine, 0 crash).
export function iconCanvas(kind, size, { color, accent } = {}) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.className = 'icon';
  c.setAttribute('aria-hidden', 'true');
  const g = typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (g) drawIcon(g, kind, size, { color, accent });
  return c;
}
