// T4 (t_eb78478e) — CONSIGNES D'ICÔNES VECTORIELLES (zéro asset) : les glyphes
// des 11 types de construction + avion + info, dessinés sur N'IMPORTE QUEL
// contexte canvas 2D (boutons de la barre de construction, boutons-scénarios
// du menu). Module PUR, testable Node (un faux ctx enregistre les appels —
// tests/t4-icons.test.mjs). `iconCanvas()` est le SEUL point de contact DOM
// (fabrique un <canvas> ; jamais appelé sous Node — la factory est
// navigateur-only, comme le reste de la UI).
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
export function iconCanvas(kind, size, { color, accent } = {}) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.className = 'icon';
  c.setAttribute('aria-hidden', 'true');
  drawIcon(c.getContext('2d'), kind, size, { color, accent });
  return c;
}
