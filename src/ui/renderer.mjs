// Rendu canvas 2D : LIT l'état, ne calcule rien de jeu (règle UI fine).
// Sprites vectoriels simples — ponytail : à remplacer par de vrais assets une fois la boucle jouable.
import { queueTotals } from '../sim/passengers.mjs'; // R30 : files par terminal → somme (HUD)
import { getPalette } from './palette.mjs'; // R43 : palette standard / daltonienne
import { THEME } from './theme.mjs'; // T4 (t_eb78478e) : design tokens (écran-titre + HUD)
import { iconCanvas } from './icons.mjs'; // T4 : glyphes vectoriels (boutons du menu)
import { AIRLINES } from '../data/catalog.mjs'; // T5c : noms des compagnies (tags radar, lecture seule)
import { weatherView } from '../sim/weather.mjs'; // T3 (t_9b665a8b) : la MÉTÉO (lecture pure — le renderer reste en lecture seule, pas d'ensure)
import { clockView, phaseTint } from '../sim/clock.mjs'; // T3 (t_76744b22) : l'HORLOGE jour/nuit (la phase pilote la teinte du monde)
import { seasonTint, seasonView } from '../core/seasons.mjs'; // T3 (t_76744b22) : l'habillage de saison (teinte + affichage)
// R39 : piste fermée — LECTURE SEULE de l'état d'incident (règle dans la sim,
// incidents.mjs) : la piste est fermée tant que l'incident attaché a un
// remaining > 0. On ne PASSE PAS par runwayClosed() : elle appelle
// ensureIncidents() qui L'INITIALISE sim.incidents (mutation — le renderer est
// en lecture seule, il ne doit pas muter la sim). La lecture directe est le
// même état, sans effet de bord.
function runwayClosedRO(sim, runwayId) {
  const i = sim.incidents;
  if (!i || !i.runways) return false;
  const rec = i.runways[runwayId];
  return !!(rec && rec.remaining > 0);
}
// T3 MÉTÉO (t_9b665a8b) : la teinte du monde PAR ÉTAT (zéro asset, un
// rempli) : pluie = bleuté, neige = voile blanc, orage OU incident météo
// actif = nuage sombre. « clair »/« nuageux » : null (pas de bruit).
// Lecture SEULE (weatherView — pas d'ensure : le renderer ne mute jamais la sim).
function weatherTint(sim) {
  if (!sim) return null;
  // T5c (t_bd4726e7) : teinte MÉTÉO au phosphore (maquette variant-c :
  // pluie = voile phosphore, neige = voile clair, orage = phosphore dense) —
  // v1 était bleuté (incohérent avec le scope v2).
  const wv = weatherView(sim);
  if (wv.incident || wv.state === 'storm') return 'rgba(46,255,142,0.14)';
  if (wv.state === 'rain') return 'rgba(46,255,142,0.06)';
  if (wv.state === 'snow') return 'rgba(220,235,225,0.12)';
  return null;
}
// T3 (t_76744b22) : la teinte du monde par PHASE JOUR/NUIT (zéro asset, un
// rempli — même pattern que weatherTint) : nuit = bleuté profond,
// aube/crépuscule = voiles légers, « jour » = null (pas de bruit). Lecture
// SEULE (clockView + phaseTint — pas d'ensure : le renderer ne mute jamais la
// sim ; l'horloge absente/corrompue → jour 1 08:00 = phase « jour » = null).
function dayTint(sim) {
  if (!sim) return null;
  return phaseTint(clockView(sim).phase);
}
// T3 (t_76744b22) : l'habillage de SAISON (teinte du monde, zéro asset) :
// été = voile doré, automne = voile ocre, hiver = voile bleuté, printemps =
// null (pas de bruit — la référence). S'APPLIQUE PAR-DESSUS la teinte météo
// (les deux se composent, lecture seule seasonTint).
function seasonWorldTint(sim) {
  if (!sim) return null;
  return seasonTint(sim);
}
export function makeRenderer(canvas, { overlays = [], onMenuCommands = null, selectionOf = null, paletteOf = null, juice = null } = {}) {
  const ctx = canvas.getContext('2d');

  // T5c (t_bd4726e7) : SPRITES DE LUMIÈRE pré-rendus (canvas hors-écran,
  // dégradé radial phosphore/ambre) : un feu = 1 drawImage + 1 arc — les
  // createRadialGradient par feu et par frame sont INTERDITS par le budget
  // rAF (T4-PERF : 0 allocation/frame ; l'alloc unique est le sprite, en
  // cache par (couleur, rayon) — les feux de la maquette variant-c luisent
  // sans surcoût).
  const GLOW_DEFS = Object.freeze({
    amber: { core: 'rgba(255,176,0,0.9)', edge: 'rgba(255,176,0,0)' },
    phosphor: { core: 'rgba(46,255,142,0.85)', edge: 'rgba(46,255,142,0)' },
  });
  const glowCache = new Map();
  function glowSprite(name, r) {
    const key = name + '|' + r;
    let s = glowCache.get(key);
    if (!s) {
      const d = GLOW_DEFS[name] || GLOW_DEFS.phosphor;
      s = document.createElement('canvas');
      s.width = s.height = Math.max(2, r * 2);
      const g = s.getContext('2d');
      const gr = g.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, d.core);
      gr.addColorStop(1, d.edge);
      g.fillStyle = gr;
      g.fillRect(0, 0, r * 2, r * 2);
      glowCache.set(key, s);
    }
    return s;
  }
  // Feu de balisage (lueur + noyau) — 1 drawImage + 1 arc, zéro allocation.
  function drawLight(x, y, name) {
    ctx.drawImage(glowSprite(name, 5), x - 5, y - 5);
    ctx.fillStyle = name === 'amber' ? 'rgba(255,176,0,0.95)' : THEME.accent;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // T5c : PLUIE/NEIGE déterministes (maquette variant-c — 60 raisins de pluie,
  // 40 flocons) : positions par hash + DÉCRUEMENT par le temps de jeu (pas de
  // Math.random, pas d'allocation — le budget rAF est intact). Écran (pas
  // monde) : la pluie tombe pour le joueur, pas dans la sim.
  function drawPrecip(state) {
    const wv = weatherView(state.sim);
    if (wv.state !== 'rain' && wv.state !== 'snow') return;
    const W = canvas.width, H = canvas.height;
    const t = state.time; // secondes de simulation (lecture seule)
    ctx.save();
    ctx.lineWidth = 1.4;
    if (wv.state === 'rain') {
      ctx.strokeStyle = 'rgba(185,245,206,0.28)'; // maquette : rainStreak
      for (let i = 0; i < 60; i++) {
        const x = ((i * 137 + 61) % W + W) % W;
        const y = ((i * 271 + 33 + t * 90) % (H + 40) + H + 40) % (H + 40) - 20;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 3.5, y + 13);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(235,245,235,0.5)';
      for (let i = 0; i < 40; i++) {
        const x = ((i * 191 + 97) % W + W) % W;
        const y = ((i * 313 + 17 + t * 22) % (H + 20) + H + 20) % (H + 20) - 10;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.restore();
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const viewSize = () => ({ width: canvas.width, height: canvas.height });

  function screenToCanvas(sx, sy, cam) {
    return [
      (sx - (cam.x - viewSize().width / 2 / cam.zoom)) * cam.zoom,
      (sy - (cam.y - viewSize().height / 2 / cam.zoom)) * cam.zoom,
    ];
  }

  // Fond de terrain minimal : quadrillage + limites du terrain.
  // R43 : les couleurs viennent de la palette (standard/daltonienne) — les
  // shapes sont identiques, seul le rempli change (le rendu ne casse pas).
  function drawTerrain(state, cam, pal) {
    const { w, h } = state.terrain;
    const [x0, y0] = screenToCanvas(0, 0, cam);
    const [x1, y1] = screenToCanvas(w, h, cam);
    ctx.fillStyle = pal.terrain; // herbe (standard) / fond neutre (daltonien)
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = pal.gridLine;
    const step = 100 * cam.zoom; // quadrillage 100 px monde
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= w; gx += 100) {
      const [cx] = screenToCanvas(gx, 0, cam);
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += 100) {
      const [, cy] = screenToCanvas(0, gy, cam);
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
    }
    ctx.strokeStyle = pal.terrainBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // T5c (t_bd4726e7) : couleur de TEXTE selon la luminance du fond (les
  // bâtiments v2 sont en ÉCHELLE DE LUMINANCE verte — un terminal phosphore
  // vif exige un texte SOMBRE, une piste sombre un texte clair). Seule
  // amélioration de lisibilité : l'étiquette (garantie R39) reste la même.
  function textColorOn(fill) {
    const h = String(fill);
    if (h.startsWith('#') && h.length === 7) {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return L > 0.45 ? THEME.bg : THEME.text;
    }
    return THEME.text; // non hex (rgba…) → texte clair (pire cas v1)
  }
  // Bâtiments posés (lecture seule de state.sim.infra). Couleurs par type :
  // R43 — les cartes viennent de la palette (pal.buildings) ; les ÉTIQUETTES
  // (kind peintes au zoom près) sont inchangées : la lisibilité ne repose pas
  // sur la couleur (R39), le mode daltonien ne casse donc rien.
  // T5c (t_bd4726e7) : le détail de PISTE (maquette variant-c) — marquages de
  // seuil, désignateurs (09/27 Est-Ouest, 18/36 Nord-Sud — dérivés de la
  // GÉOMÉTRIE : une piste horizontale est 09/27), feux de bords ambre
  // (sprites en cache — T4-PERF) et point d'ATTENTE (le point de la ligne de
  // centre le plus proche du taxiway voisin — géométrie pure, lecture seule).
  // Zooms : feux ≥ 0.5, marquages ≥ 0.5, désignateurs ≥ 0.6, attente ≥ 0.7.
  function drawRunwayDetails(state, cam, b, x, y, w, h) {
    const z = cam.zoom;
    if (w < 16 && h < 16) return; // trop petit à l'écran : pas de détail
    const horiz = w >= h;
    // Repères de seuil (« piano » — maquette) : barres PERPENDICULAIRES à
    // l'axe de la piste, empilées sur TOUTE la largeur d'extrémité (pas une
    // cascade de coins) — le nombre suit la taille écran (borné ≤ 10).
    if (z >= 0.5) {
      ctx.fillStyle = 'rgba(61,255,165,0.6)';
      const span = horiz ? h : w; // tranche (px écran)
      const n = Math.min(10, Math.max(4, Math.floor(span / 16)));
      const step = span / (n + 1);
      for (let i = 1; i <= n; i++) {
        if (horiz) {
          ctx.fillRect(x + 5, y + i * step, 5, 7);          // bout gauche
          ctx.fillRect(x + w - 10, y + i * step, 5, 7);     // bout droit
        } else {
          ctx.fillRect(x + i * step, y + 5, 7, 5);          // bout haut
          ctx.fillRect(x + i * step, y + h - 10, 7, 5);     // bout bas
        }
      }
    }
    // Désignateurs (bold 12px, dim — convention ICAO par géométrie).
    if (z >= 0.6) {
      ctx.fillStyle = THEME.textDim;
      ctx.font = `bold 12px ${THEME.fontUi}`;
      if (horiz) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('09', x + 4, y + h + 6);
        ctx.textAlign = 'right';
        ctx.fillText('27', x + w - 4, y + h + 6);
      } else {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('18', x + w + 6, y + 4);
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText('36', x + w + 6, y + h - 4);
      }
    }
    // Feux de bords ambre (lueurs en cache — 1 drawImage/feu, T4-PERF).
    // Pas d'au moins 40 px écran (la densité visuelle est constante) et au
    // plus ~16 feux par arête (borné quel que soit le zoom).
    if (z >= 0.5) {
      const step = Math.max(40, horiz ? w / 16 : h / 16);
      if (horiz) {
        for (let lx = x; lx <= x + w + 0.5; lx += step) {
          drawLight(lx, y, 'amber');
          drawLight(lx, y + h, 'amber');
        }
      } else {
        for (let ly = y; ly <= y + h + 0.5; ly += step) {
          drawLight(x, ly, 'amber');
          drawLight(x + w, ly, 'amber');
        }
      }
    }
    // Point d'ATTENTE (circle pointillé + H) : la position de la ligne de
    // centre la plus proche du centre du taxiway voisin (géométrie déterminée
    // — la sim ne porte pas de « holding », le rendu déduit la logique).
    if (z >= 0.7 && state.sim.infra.taxiways && state.sim.infra.taxiways.length) {
      // Point d'entrée = la projection du centre du taxiway le plus proche
      // sur l'axe de la piste (borné aux 30 px intérieurs de chaque bout).
      let hx = x + (horiz ? w * 0.35 : w / 2), hy = y + (horiz ? h / 2 : h * 0.35);
      let bd = Infinity;
      for (const t of state.sim.infra.taxiways) {
        const [tx0, ty0] = screenToCanvas((t.x != null ? t.x : 0) + (t.w || 0) / 2, (t.y != null ? t.y : 0) + (t.h || 0) / 2, cam);
        let px, py;
        if (horiz) { px = Math.min(Math.max(tx0, x + 30), x + w - 30); py = y + h / 2; }
        else { px = x + w / 2; py = Math.min(Math.max(ty0, y + 30), y + h - 30); }
        const d = Math.hypot(px - tx0, py - ty0);
        if (d < bd) { bd = d; hx = px; hy = py; }
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(61,255,165,0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = THEME.textDim;
      ctx.font = `bold 12px ${THEME.fontUi}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('H', hx, hy + 0.5);
    }
  }

  function drawInfra(state, cam, pal) {
    const sim = state.sim;
    if (!sim || !sim.infra) return;
    const all = [
      ...sim.infra.runways, ...sim.infra.taxiways,
      ...sim.infra.terminals, ...sim.infra.services,
    ];
    for (const b of all) {
      const kind = b.type || b.kind; // la sim pose `type` ; les sauvegardes M1 `kind`
      const [x, y] = screenToCanvas(b.x, b.y, cam);
      const w = b.w * cam.zoom, h = b.h * cam.zoom;
      const fill = pal.buildings[kind] || THEME.textDim; // v2 : fond phosphore (v1 : gris)
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      // Bordure : PHOSPHORE (maquette : les pistes luisent) pour les pistes,
      // sombre (définition) pour les bâtiments sur fond sombre.
      if (kind === 'taxiway') {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        // T5c (t_bd4726e7) : LIGNE DE CENTRE de taxiway (pointillés phosphore
        // discrets — maquette : le guidage taxi se lit comme un radar).
        ctx.save();
        ctx.strokeStyle = 'rgba(61,255,165,0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8 * cam.zoom, 10 * cam.zoom]);
        ctx.beginPath();
        if (w >= h) { ctx.moveTo(x + 4, y + h / 2); ctx.lineTo(x + w - 4, y + h / 2); }
        else { ctx.moveTo(x + w / 2, y + 4); ctx.lineTo(x + w / 2, y + h - 4); }
        ctx.stroke();
        ctx.restore();
      } else if (kind === 'runway') {
        // T5c (t_bd4726e7) : bords phosphore sur les ARÊTES LONGUES
        // (maquette variant-c : les 2 lignes de bord luisent, pas les 4 côtés).
        ctx.strokeStyle = 'rgba(61,255,165,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (w >= h) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); }
        else { ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); }
        ctx.stroke();
        // Ligne de centre de PISTE (pointillés phosphore — maquette) : l'axe
        // de décollage/atterrissage se lit sur le scope.
        ctx.save();
        ctx.strokeStyle = 'rgba(61,255,165,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([12 * cam.zoom, 10 * cam.zoom]);
        ctx.beginPath();
        if (w >= h) { ctx.moveTo(x + 8, y + h / 2); ctx.lineTo(x + w - 8, y + h / 2); }
        else { ctx.moveTo(x + w / 2, y + 8); ctx.lineTo(x + w / 2, y + h - 8); }
        ctx.stroke();
        ctx.restore();
        drawRunwayDetails(state, cam, b, x, y, w, h);
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      }
      // T5c : feux de taxiway (phosphore, pas de 24 px écran — maquette) :
      // le guidage taxi se lit comme sur un radar. Borné (pas ≥ 24 px).
      // T5c (t_bd4726e7) : LUEURS en sprites cache (1 drawImage/feu — pas
      // de gradient par frame, T4-PERF).
      if (kind === 'taxiway') {
        const band = Math.min(w, h);
        if (band >= 8) {
          if (w >= h) {
            for (let sx = Math.ceil(w / 24); sx >= 0; sx--) {
              const lx = x + sx * 24;
              if (lx > x + w) break;
              drawLight(lx, y + h / 2, 'phosphor');
            }
          } else {
            for (let sy = Math.ceil(h / 24); sy >= 0; sy--) {
              const ly = y + sy * 24;
              if (ly > y + h) break;
              drawLight(x + w / 2, ly, 'phosphor');
            }
          }
        }
      }
      // T5c : fenêtres du TERMINAL (guirlandes ambre — maquette) : les
      // fenêtres s'allument quand le terminal est assez grand à l'écran.
      if (kind === 'terminal' && w >= 56 && h >= 40) {
        const cols = Math.min(4, Math.max(2, Math.round(w / 90)));
        const rows = Math.min(3, Math.max(2, Math.round(h / 50)));
        const cw = w / (cols + 1), ch = h / (rows + 1);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const wx = x + (c + 0.5) * cw + cw * 0.15;
            const wy = y + (r + 0.5) * ch + ch * 0.15;
            ctx.fillStyle = 'rgba(255,201,74,0.16)'; // halo ambre (le terminal luit)
            ctx.fillRect(wx - 4, wy - 4, cw * 0.7 + 8, ch * 0.7 + 8);
            ctx.fillStyle = THEME.gold;
            ctx.fillRect(wx, wy, cw * 0.7, ch * 0.7);
          }
        }
      }
      // T5c (t_bd4726e7) : dépôt CARBURANT = cuves (2-3 cercles phosphore,
      // maquette variant-c « fuel + tour ») — pas un simple carré : on voit
      // que ce sont des réserves (la sim reste inchangée, c'est du rendu).
      if (kind === 'fuel' && w >= 30 && h >= 22) {
        const tanks = w >= h ? (w >= 64 ? 3 : 2) : 2;
        const r = Math.min(w, h) * 0.22;
        ctx.strokeStyle = 'rgba(61,255,165,0.55)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < tanks; i++) {
          let cx, cy;
          if (w >= h) { cx = x + w * (i + 1) / (tanks + 1); cy = y + h / 2; }
          else { cx = x + w / 2; cy = y + h * (i + 1) / (tanks + 1); }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Étiquette lisible au zoom près (T5c : texte SOMBRE sur bâtiments
      // vifs, CLAIR sur bâtiments sombres — luminance, pas la couleur).
      // T5c : sur une piste VERTICALE, l'étiquette est décalée SOUS la rangée
      // de seuil du haut (y+12) pour ne plus la MASQUER (le mot « runway »
      // couvrait la 1re barre du piano) ; piste horizontale inchangée (y+3).
      if (cam.zoom >= 0.6) {
        ctx.fillStyle = textColorOn(fill);
        ctx.font = `11px ${THEME.fontUi}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const labY = kind === 'runway' && w < h ? y + 12 : y + 3;
        ctx.fillText(kind, x + 4, labY);
      }
      // R39 : les BLOCAGES sont lisibles autrement que par la couleur —
      // symbole + texte (X sur piste fermée, « PANNE » sur station HS), la
      // règle reste dans la sim (runwayClosed / svc.fuelOut, lecture seule).
      if (kind === 'runway' && runwayClosedRO(sim, b.id)) {
        ctx.strokeStyle = pal.alert; // X lisible en daltonien (symbole + FERMÉE, R39)
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.4, y + h * 0.4); ctx.lineTo(x + w * 0.6, y + h * 0.6);
        ctx.moveTo(x + w * 0.6, y + h * 0.4); ctx.lineTo(x + w * 0.4, y + h * 0.6);
        ctx.stroke();
        ctx.fillStyle = textColorOn(pal.buildings.runway || THEME.textDim);
        ctx.font = `bold 12px ${THEME.fontUi}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('FERMÉE', x + w / 2, y + 6);
      }
      if (kind === 'fuel' && b.fuelOut) {
        ctx.fillStyle = textColorOn(pal.buildings.fuel || THEME.textDim);
        ctx.font = `bold 11px ${THEME.fontUi}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('PANNE', x + w / 2, y + h / 2);
      }
    }
    // Portes (gates) : libres / réservées / occupées — TROIS états distincts,
    // lisibles SANS couleur (libre = plein, réservée = hachures + « R »,
    // occupée = plein + « O » ; la couleur aide, l'indicateur ne repose pas
    // sur elle — critère R39). L'état vient de la sim : g.acId (réservation,
    // aircraft.mjs A5) + la position réelle de l'avion (occupée = à quai).
    if (sim.infra.gates && sim.infra.gates.length) {
      // T5c (t_bd4726e7) : marquages d'APRON (périphérie pointillée
      // phosphore de la zone de stands — maquette variant-c) — sous les
      // portes (défini par l'union des rects, déterministe).
      if (cam.zoom >= 0.5) {
        let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
        for (const g of sim.infra.gates) {
          if (g.x === undefined) continue;
          const [gx0, gy0] = screenToCanvas(g.x, g.y, cam);
          ux0 = Math.min(ux0, gx0); uy0 = Math.min(uy0, gy0);
          ux1 = Math.max(ux1, gx0 + g.w * cam.zoom); uy1 = Math.max(uy1, gy0 + g.h * cam.zoom);
        }
        if (ux1 > ux0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(61,255,165,0.35)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(ux0 - 14, uy0 - 14, ux1 - ux0 + 28, uy1 - uy0 + 28);
          ctx.restore();
        }
      }
      // R43 : couleurs de portes de la palette (S/M/L distincts en luminance
      // ; les lettres ·/R/O déjà peintes garantissent la lecture sans couleur).
      const GATE_COLOR = pal.gates;
      const GROUND_PHASES = new Set(['docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback']); // pushback : porte encore occupée (g.acId libérée AU DÉPART de pushback, aircraft.mjs doPushback)
      const atGate = new Set(sim.aircraft
        .filter((a) => a.gateId != null && GROUND_PHASES.has(a.phase))
        .map((a) => a.gateId));
      let gateNo = 0;
      for (const g of sim.infra.gates) {
        if (g.x === undefined) continue;
        gateNo++;
        const [x, y] = screenToCanvas(g.x, g.y, cam);
        const w = g.w * cam.zoom, h = g.h * cam.zoom;
        const occ = atGate.has(g.id);
        const res = !occ && g.acId != null;
        // T5c (t_bd4726e7) : PASSERELLE (jet bridge) — liaison courte vers
        // le terminal (projection du centre de la porte sur le rect ; le
        // terminal est déjà peint, la passerelle est SOUS la porte — ordre :
        // apron, passerelle, porte). L'état reste lisible SANS la passerelle.
        if (cam.zoom >= 0.5 && sim.infra.terminals && sim.infra.terminals.length) {
          const term = sim.infra.terminals[0];
          const [tx0, ty0] = screenToCanvas(term.x, term.y, cam);
          const px = Math.min(Math.max(x + w / 2, tx0), tx0 + term.w * cam.zoom);
          const py = Math.min(Math.max(y + h / 2, ty0), ty0 + term.h * cam.zoom);
          if (Math.hypot(px - (x + w / 2), py - (y + h / 2)) > 4) {
            ctx.strokeStyle = 'rgba(61,255,165,0.4)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(x + w / 2, y + h / 2);
            ctx.stroke();
          }
        }
        if (res) {
          // réservée : hachures (motif noir et blanc — lisible en N&B)
          ctx.fillStyle = GATE_COLOR[g.size] || '#9e9e9e';
          ctx.fillRect(x, y, w, h);
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.lineWidth = 2;
          for (let sx = -h; sx < w; sx += 6) {
            ctx.beginPath(); ctx.moveTo(x + sx, y + h); ctx.lineTo(x + sx + h, y); ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.fillStyle = occ ? GATE_COLOR.occupied : (GATE_COLOR[g.size] || '#9e9e9e');
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = occ ? THEME.text : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = occ ? 1.5 : 1;
        ctx.strokeRect(x, y, w, h);
        if (cam.zoom >= 0.7) {
          // T5c : la lettre suit la LUMINANCE du fond (port v2 phosphore —
          // sombre sur port vif, claire sur port sombre ; jamais la couleur).
          const gfill = GATE_COLOR[g.size] || '#9e9e9e';
          ctx.fillStyle = textColorOn(occ ? GATE_COLOR.occupied : gfill);
          ctx.font = `bold 12px ${THEME.fontUi}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(occ ? 'O' : res ? 'R' : '·', x + w / 2, y + h / 2 + 1);
          // T5c (t_bd4726e7) : N° de STAND (G1–Gn, maquette variant-c) sous
          // la porte — le n° sert à la lecture (l'état = la lettre, R39).
          ctx.fillStyle = THEME.textDim;
          ctx.font = `12px ${THEME.fontUi}`;
          ctx.textBaseline = 'top';
          ctx.fillText('G' + gateNo, x + w / 2, y + h + 4);
        }
      }
    }
    // R39 : le BÂTIMENT SÉLECTIONNÉ (clic carte) est entouré — la sélection
    // est lisible autrement que par la couleur (trait pointillé blanc).
    if (selectionOf) {
      const sel = selectionOf();
      if (sel && sel.kind === 'bldg') {
        const b = [...sim.infra.runways, ...sim.infra.taxiways, ...sim.infra.terminals, ...sim.infra.services]
          .find((x) => x.id === sel.id);
        if (b) {
          const [x, y] = screenToCanvas(b.x, b.y, cam);
          ctx.save();
          ctx.strokeStyle = THEME.text; // T5c : sélection phosphore (v1 : blanc)
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(x - 2, y - 2, b.w * cam.zoom + 4, b.h * cam.zoom + 4);
          ctx.restore();
        }
      }
    }
  }

  // R39 (t_1c21c88e) : les AVIONS sont distingués par TAILLE (AIRCRAFT,
  // lecture seule — small < medium < large) et l'orientation suit le SENS DE
  // DÉPLACEMENT réel : le nœud suivant du chemin (pathfinding, lecture seule)
  // donne la direction ; sans chemin (stationné) → direction par phase. La
  // tête (cône) pointe devant : le sens est lisible SANS couleur (critère
  // R39 « indication accessible autrement que par la couleur seule »).
  // ponytail : le sens = direction vers le nœud SUIVANT (pas une vitesse
  // instantanée) ; le jeu a 3 tailles d'avion, pas de flotte mixte continue.
  const AC_SCALE = Object.freeze({ small: 0.7, medium: 1, large: 1.6 });
  function aircraftAngle(sim, a) {
    // Chemin actif : direction vers le nœud SUIVANT (le graphe, lecture seule).
    try {
      const graph = sim._graph;
      if (graph && Array.isArray(a.path) && a.path.length > 1) {
        const idx = Math.min((a.pathPtr || 0) + 1, a.path.length - 1);
        const n = graph.nodes[a.path[idx]];
        if (n && (n.x !== a.x || n.y !== a.y)) return Math.atan2(n.y - a.y, n.x - a.x);
      }
    } catch { /* graphe pas encore construit (avant le 1er tick) */ }
    // Stationné / téléport : direction par phase (descente → bas ; décollage → haut).
    if (a.phase === 'approach' || a.phase === 'holding' || a.phase === 'landing' || a.phase === 'exit') return Math.PI / 2;
    if (a.phase === 'pushback' || a.phase === 'departure') return -Math.PI / 2;
    // À la porte : vers la piste (sortie par le haut) ; sinon neutre.
    return -Math.PI / 2;
  }
  // T5c (t_bd4726e7) : TAGS RADAR — type → sigle (data/catalog.mjs) +
  // phase sim → code scope + PALIER/TENDANCE (affichages déterministes par
  // phase : la sim ne porte ni indicatif ni FL — le renderer reste en
  // LECTURE SEULE ; « GND · » par défaut au sol).
  const AC_TAG = { small: 'C208', medium: 'A320', large: 'B747' };
  const FL_TREND = {
    holding: 'FL300·', approach: 'FL150↓', landing: 'FL100↓',
    exit: 'FL060↑', departure: 'FL040↑',
  };
  function drawAircraft(state, cam) {
    const sim = state.sim;
    if (!sim || !sim.aircraft) return;
    for (const a of sim.aircraft) {
      if (a.x === undefined || a.y === undefined) continue; // pas encore positionné
      const [x, y] = screenToCanvas(a.x, a.y, cam);
      if (x < -50 || x > canvas.width + 50 || y < -50 || y > canvas.height + 50) continue;
      const k = (AC_SCALE[a.acType] || 1) * cam.zoom; // échelle TAILLE (small < medium < large)
      const ang = aircraftAngle(sim, a);
      // T5c (t_bd4726e7) : TRACÉ DE BLIP (maquette : l'avion en mouvement
      // laisse une traîne phosphore, comme un écho radar). Déterministe :
      // l'opposé du cap, longueur fixe par taille — zéro état, zéro alloc.
      // Les phases à la porte / ravitaillement / débard ne traînent pas.
      const TRAIL_PHASES = { approach: 1, holding: 1, landing: 1, exit: 1, departure: 1 };
      if (a.phase && TRAIL_PHASES[a.phase] && cam.zoom >= 0.6) {
        ctx.save();
        ctx.strokeStyle = 'rgba(61,255,165,0.35)';
        ctx.lineWidth = Math.max(1.5, 3 * k);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(ang) * 16 * k, y - Math.sin(ang) * 16 * k);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2); // le sprite est dessiné « nez vers le haut »
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-1.5 * k + 2, -11 * k + 2, 3 * k, 22 * k); // ombre (décalée)
      // T5c : lueur RADARE (le contact phosphore luit sur le scope, comme
      // la maquette variant-c) — posée APRÈS l'ombre, sur le corps seulement.
      ctx.shadowColor = 'rgba(61,255,165,0.5)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = a.color || THEME.textDim; // v2 : fallback phosphore (v1 : blanc)
      // T5c : SILHOUETTE VUE D'OISEAU reconnaissable (plus de « signe + » :
      // fuselage long FINS + ailes en FLECHE (trapèzes) + empennage en flèche
      // — la TÊTE (cône phosphore) pointe devant ; le grand porteur (B747) a
      // un double fuselage (maquette : « plus de carrés »).
      // Fuselage (trapèze fin, nez -12k → queue +10k) :
      ctx.beginPath();
      ctx.moveTo(0, -12 * k);
      ctx.lineTo(1.5 * k, -9 * k);
      ctx.lineTo(1.5 * k, 7 * k);
      ctx.lineTo(0.9 * k, 10 * k);
      ctx.lineTo(-0.9 * k, 10 * k);
      ctx.lineTo(-1.5 * k, 7 * k);
      ctx.lineTo(-1.5 * k, -9 * k);
      ctx.closePath();
      ctx.fill();
      // Ailes en flèche : corde de racine LARGE, corde d'extrémité courte et
      // BATTUE (l'extrémité est vers l'arrière) — le trait d'une vraie aile.
      ctx.beginPath();
      ctx.moveTo(-1.2 * k, -3 * k);
      ctx.lineTo(-9 * k, 2.5 * k);
      ctx.lineTo(-9 * k, 4 * k);
      ctx.lineTo(-1.2 * k, 0.5 * k);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(1.2 * k, -3 * k);
      ctx.lineTo(9 * k, 2.5 * k);
      ctx.lineTo(9 * k, 4 * k);
      ctx.lineTo(1.2 * k, 0.5 * k);
      ctx.closePath();
      ctx.fill();
      // Empennage : deux ailettes en flèche à l'arrière + dérive centrale.
      ctx.beginPath();
      ctx.moveTo(-0.9 * k, 7.5 * k);
      ctx.lineTo(-5 * k, 11 * k);
      ctx.lineTo(-5 * k, 12 * k);
      ctx.lineTo(-0.9 * k, 10 * k);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0.9 * k, 7.5 * k);
      ctx.lineTo(5 * k, 11 * k);
      ctx.lineTo(5 * k, 12 * k);
      ctx.lineTo(0.9 * k, 10 * k);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-0.8 * k, 8.5 * k, 1.6 * k, 3 * k); // dérive (fuselage fin)
      if (a.acType === 'large') {
        // Grand porteur : DOUBLE FUSELAGE (deux soutes parallèles le long du
        // fuselage — l'identifiant du B747, pas un simple corps large).
        ctx.fillRect(-1.1 * k, -11 * k, 0.8 * k, 20 * k);
        ctx.fillRect(0.3 * k, -11 * k, 0.8 * k, 20 * k);
      }
      // T5c : le cône de NEZ est PHOSPHORE (maquette : le contact se lit par
      // la taille + le cône, pas par la couleur compagnie — R39/R43).
      ctx.shadowBlur = 0;
      ctx.fillStyle = THEME.accent;
      ctx.beginPath();
      ctx.moveTo(0, -14 * k); ctx.lineTo(2.2 * k, -8 * k); ctx.lineTo(-2.2 * k, -8 * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // T5c (t_bd4726e7) : TAG RADAR au zoom proche — « CODE SIGLE FL/↑ »
      // (le contact se nomme comme sur un vrai scope : indicatif compagnie,
      // type, palier + tendance — la tendance est affichée, pas simulée).
      if (cam.zoom >= 0.9 && x > -80 && x < canvas.width + 80 && y > -40 && y < canvas.height + 40) {
        const airline = AIRLINES.find(l => l.id === a.airline);
        const code = airline ? airline.name.split(' ')[0].toUpperCase().slice(0, 4) : '----';
        const tag = `${code} ${AC_TAG[a.acType] || '--'} ${FL_TREND[a.phase] || 'GND·'}`;
        ctx.font = `12px ${THEME.fontUi}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        // Le tag reste DANS le canvas (jamais rogné au bord — liseré inclus) :
        // clamp haut (y-10 peut sortir de l'écran pour un contact haut) et
        // droit (la largeur du tag est mesurée, pas supposée).
        const tagW = ctx.measureText(tag).width;
        const tx = Math.min(x + 12, canvas.width - tagW - 6);
        const ty = Math.max(14, y - 10);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,8,7,0.8)'; // liseré (lisibilité)
        ctx.strokeText(tag, tx, ty);
        ctx.fillStyle = THEME.textDim;
        ctx.fillText(tag, tx, ty);
      }
      // R39 : l'avion SÉLECTIONNÉ (clic carte, panels.mjs) est entouré (trait
      // pointillé phosphore) — la sélection est lisible autrement que par couleur.
      if (selectionOf) {
        const sel = selectionOf();
        if (sel && sel.kind === 'ac' && sel.id === a.id) {
          ctx.save();
          ctx.strokeStyle = THEME.text;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.arc(x, y, 16 * (AC_SCALE[a.acType] || 1) * cam.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // Écran de jeu : terrain + infra + avions sous la caméra.
  // T5c (t_bd4726e7) : la carte EST un SCOPE radar (maquette variant-c) :
  // fond noir phosphore + trame pré-rendue (cibles, réticule, statique,
  // scanlines — 1 drawImage/frame, T4-PERF). Le cache (W,H) est PARTAGÉ
  // avec le menu (buildScopeOverlay — le bol peint par le menu reste sous
  // le monde : invisible, 0 surcoût).
  function drawGame(state, cam, pal) {
    ctx.fillStyle = THEME.bg; // noir phosphore (v1 : #263238 « asphalte nuit »)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTerrain(state, cam, pal);
    drawInfra(state, cam, pal);
    drawTower(state, cam);
    drawAircraft(state, cam);
    // T5c : la trame scope (cibles + réticule + statique + scanlines) PAR-
    // DESSUS le monde — l'écran EST le scope (l'effet CRT recouvre tout,
    // comme la maquette variant-c) ; SOUS le HUD (peint après, lisible).
    // Le cache (W,H) est PARTAGÉ avec le menu (buildScopeOverlay) et
    // recalcé au resize UNIQUEMENT (1 drawImage/frame, T4-PERF).
    const ck = canvas.width * 512 + canvas.height;
    if (ck !== menuCacheKey) {
      menuCacheKey = ck;
      menuScopeOv = buildScopeOverlay(canvas.width, canvas.height);
    }
    if (menuScopeOv) ctx.drawImage(menuScopeOv, 0, 0, canvas.width, canvas.height);
    // T5c (t_bd4726e7) : PRÉCIPITATIONS (pluie/grêle déterministes —
    // maquette variant-c) : écran, au-dessus de la trame, sous le HUD.
    drawPrecip(state);
  }

  // T5c (t_bd4726e7) : LA TOUR — silhouette dédiée (maquette variant-c) :
  // soubassement + fût + cabine vitrée + balise ambrée (lueur en cache —
  // T4-PERF). Position : l'ANCHE du layout « tower » (new-game.mjs) si la
  // grille est construite (b.x défini), sinon le coin haut-droit du terminal.
  // Zooms : silhouette ≥ 0.5, balise ambrée ≥ 0.4 (la tour est une tour).
  function drawTower(state, cam) {
    const sim = state.sim;
    if (!sim || !sim.infra) return;
    const t = sim.infra.tower;
    let tx, ty;
    if (t && t.x !== undefined) { [tx, ty] = screenToCanvas(t.x + (t.w || 0) / 2, t.y + (t.h || 0) / 2, cam); }
    else if (sim.infra.terminals && sim.infra.terminals.length) {
      const term = sim.infra.terminals[0];
      [tx, ty] = screenToCanvas(term.x + (term.w || 0) * 0.5, term.y, cam);
      ty -= 18;
    } else { return; }
    if (tx < -60 || tx > canvas.width + 60 || ty < -60 || ty > canvas.height + 60) return;
    // Silhouette (socle + fût + cabine vitrée) — phosphore, maquette.
    // T5c : silhouette LISIBLE (alpha relevés — 0.15 était quasi invisible sur
    // fond sombre) + légère montée d'échelle au zoom (bornée ≤ 1.3).
    if (cam.zoom >= 0.5) {
      const s = Math.min(1.3, Math.max(1, cam.zoom * 0.8));
      ctx.save();
      ctx.fillStyle = 'rgba(61,255,165,0.38)';
      ctx.fillRect(tx - 8 * s, ty + 4, 16 * s, 8 * s);          // socle
      ctx.fillRect(tx - 3 * s, ty - 10, 6 * s, 14 * s);         // fût
      ctx.fillStyle = 'rgba(61,255,165,0.6)';
      ctx.fillRect(tx - 6 * s, ty - 14 * s, 12 * s, 5 * s);     // cabine vitrée
      ctx.strokeStyle = 'rgba(61,255,165,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx - 6 * s, ty - 14 * s, 12 * s, 5 * s);
      ctx.restore();
    }
    // Balise ambrée (lueur en cache — le repère de la tour sur le scope).
    if (cam.zoom >= 0.4) drawLight(tx, ty - 16, 'amber');
  }

  // Menu de départ : T4 (t_eb78478e) — ÉCRAN-TITRE animé (zéro asset, budget
  // rAF ~150 ops). v1 : « l'aéroport la nuit » (ciel dégradé + lune + 90
  // étoiles déterministes + piste + terminal + avion). T5c (t_bd4726e7) :
  // REMPLACÉ par le SCOPE RADAR phosphore (maquette variant-c — bol,
  // cibles, balayage, blips ; statique en cache, see buildScopeOverlay).
  // Horloge d'animation LOCALE (menuT, comptée par frame — le menu n'a pas
  // de sim, donc pas de time de jeu à lire). Les commandes du menu restent
  // des BOUTONS DOM (R20 ; les touches N/R en raccourci) ; T4 : chaque
  // bouton reçoie une ICÔNE vectorielle (icons.mjs) — les 13 boutons-
  // scénarios un accent coloré PAR SCÉNARIO (distingusables sans lire le nom).
  // T5c (t_bd4726e7) : la trame CRT (maquette variant-c) — DETERMINISTE :
  // hash 32 bits (la même que la maquette) → la statique est reproductible
  // (captures stables, zéro Math.random — discipline T4-PERF).
  function h32(n) {
    let x = (n ^ 0x9E3779B9) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85EBCA6B) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  // T5c : le SCOPE statique (cibles concentriques + réticule + statique +
  // scanlines + croix de cadrage) est PRE-RENDU dans un canvas hors-écran
  // par (W,H) — 1 drawImage par frame (le budget rAF est intact, T4-PERF :
  // le scanlineage à la main = ~250 fillRect/frame, interdit).
  // Le bol (dégradé radial) est en cache SÉPARÉ (buildScopeBowl) : il est
  // OPAQUE → fond du MENU uniquement ; en JEU, la trame (ci-dessous, fond
  // TRANSPARENT) est par-dessus le monde — le bol opaque y masquerait les
  // bâtiments (le monde doit rester lisible sous la trame, maquette).
  function buildScopeOverlay(W, H) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d');
    const cx = W / 2, cy = H * 0.44, R = Math.min(W, H) * 0.44; // maquette variant-c
    // Cibles concentriques + réticule + graduations (maquette : 0.25…1).
    o.lineWidth = 1;
    o.strokeStyle = THEME.accentSoft;
    for (const f of [0.25, 0.5, 0.75]) { o.beginPath(); o.arc(cx, cy, R * f, 0, Math.PI * 2); o.stroke(); }
    o.strokeStyle = THEME.border; // la plus externe : un cran plus lisible
    o.beginPath(); o.arc(cx, cy, R, 0, Math.PI * 2); o.stroke();
    o.strokeStyle = THEME.accentSoft;
    o.beginPath(); o.moveTo(cx - R, cy); o.lineTo(cx + R, cy); o.moveTo(cx, cy - R); o.lineTo(cx, cy + R); o.stroke();
    for (let a = 0; a < 12; a++) {
      const th = a * Math.PI / 6;
      o.beginPath();
      o.moveTo(cx + Math.cos(th) * R, cy + Math.sin(th) * R);
      o.lineTo(cx + Math.cos(th) * (R - 10), cy + Math.sin(th) * (R - 10));
      o.stroke();
    }
    // Statique fine (400 pixels par hash — déterministe) + scanlines CRT.
    o.fillStyle = THEME.static;
    for (let i = 0; i < 400; i++) {
      o.fillRect(Math.floor(h32(i * 911) * W), Math.floor(h32(i * 547) * H), 1, 1);
    }
    o.fillStyle = THEME.scanline;
    for (let y = 0; y < H; y += 3) o.fillRect(0, y, W, 1);
    // Croix de cadrage (coins).
    o.strokeStyle = THEME.gridStrong; o.globalAlpha = 0.4; o.lineWidth = 1.5;
    for (const [sx, sy, dx, dy] of [[10, 10, 1, 1], [W - 10, 10, -1, 1], [10, H - 10, 1, -1], [W - 10, H - 10, -1, -1]]) {
      o.beginPath(); o.moveTo(sx + dx * 18, sy); o.lineTo(sx, sy); o.lineTo(sx, sy + dy * 18); o.stroke();
    }
    o.globalAlpha = 1;
    return off;
  }
  // T5c : le BOL du scope (dégradé radial phosphore — OPAQUE) : fond du MENU
  // uniquement (le menu EST le scope). Cache séparé (W,H) ; en jeu le fond
  // est le TERRAIN du monde (pal.terrain) — pas de bol (masquage, cf.
  // buildScopeOverlay). 1 drawImage/frame au menu (T4-PERF).
  function buildScopeBowl(W, H) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d');
    const cx = W / 2, cy = H * 0.44; // = buildScopeOverlay (le bol partage le centre)
    const bowl = o.createRadialGradient(cx, cy, 40, cx, cy, Math.max(W, H) * 0.72);
    bowl.addColorStop(0, THEME.skyBottom); bowl.addColorStop(1, THEME.skyTop);
    o.fillStyle = bowl; o.fillRect(0, 0, W, H);
    return off;
  }
  // T5c : le MENU est le SCOPE COMPLET (bol + balayage animé + blips) ; la
  // CARTE DU JEU ne porte que la TRAME (cibles + réticule + statique +
  // scanlines — le balayage resterait une distraction en jeu). La trame est
  // en cache TRANSPARENT partagé (1 drawImage/frame en jeu — T4-PERF) ; le
  // bol (opaque) est son propre cache, peint sous la trame au MENU
  // uniquement.
  let menuBox = null;
  let resumeBtn = null;
  let diffBtns = []; // T2-1 (t_d5da994c) : les boutons de difficulté (rangée du menu)
  let menuT = 0; // T4 : horloge d'animation du titre (frames)
  // T4 passe PERF : le dégradé du ciel + la table des 90 étoiles sont en
  // CACHE par (W,H) — recalculés UNIQUEMENT au redimensionnement (zéro
  // allocation par frame : le budget de frame rAF est intact, le menu est la
  // seule « anim » hors jeu).
  const SCENARIO_HUES = Object.freeze([199, 262, 330, 15, 45, 110, 160, 210, 250, 300, 60, 130, 350]);
  let menuCacheKey = 0;
  let menuScopeOv = null; // T5c : cache de la TRAME scope (transparence, v1 → v2)
  let scopeBowl = null; // T5c : cache du BOL (opaque, fond du menu)
  function drawMenu(pal) {
    menuT += 1;
    const W = canvas.width, H = canvas.height;
    // T5c (t_bd4726e7) : SCOPE RADAR phosphore (maquette variant-c) — la
    // partie STATIQUE (bol, cibles, réticule, statique, scanlines, croix de
    // cadrage) est en CACHE (W,H) : 1 drawImage/frame (budget rAF, T4-PERF).
    // Le cache v1 (dégradé + table d'étoiles) est remplacé par le canvas
    // hors-écran (même discipline : recalculé au resize UNIQUEMENT).
    const ck = W * 512 + H;
    if (ck !== menuCacheKey) {
      menuCacheKey = ck;
      menuScopeOv = buildScopeOverlay(W, H);
      scopeBowl = buildScopeBowl(W, H);
    }
    // Bol OPAQUE d'abord (le fond du scope), la trame par-dessus (cibles +
    // réticule + statique + scanlines), le balayage animé au-dessus.
    if (scopeBowl) ctx.drawImage(scopeBowl, 0, 0);
    ctx.drawImage(menuScopeOv, 0, 0);
    const cx = W / 2, cy = H * 0.44, R = Math.min(W, H) * 0.44; // = buildScopeOverlay
    // BALAYAGE animé (traîne de 0,42 rad en fondu phosphore) — la signature
    // du radar rétro ; le menu reste la seule « anim » hors jeu (T4).
    const sweep = menuT * 0.005; // tour complet ~ 21 s à 60 fps
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweep);
    const wedge = ctx.createLinearGradient(0, 0, R, 0);
    wedge.addColorStop(0, 'rgba(61,255,165,0.28)'); wedge.addColorStop(1, 'rgba(61,255,165,0)');
    ctx.fillStyle = wedge;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -0.42, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(61,255,165,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0); ctx.stroke();
    ctx.restore();
    // 3 BLIPS déterministes (maquette variant-c, positions fixes) — les codes
    // sont les COMPAGNIES DU CATALOGUE (AIRLINES, data/catalog.mjs) : le
    // scope affiche du trafic « réel » du jeu, pas des codes fictifs.
    const BLIPS = [
      { a: 0.9, r: 0.62, code: 'SOLA 1234' }, // Solaire Air
      { a: 2.4, r: 0.4, code: 'BORA 77' },   // Boréal Régions
      { a: 3.9, r: 0.83, code: 'PAC 241' },  // PacificCargo
    ];
    for (const b of BLIPS) {
      const bx = cx + Math.cos(b.a) * R * b.r, by = cy + Math.sin(b.a) * R * b.r;
      // Après-glow : le blip brille tant que le balayage l'a FRANCHI
      // récemment (delta petit → traîne de phosphore, maquette).
      let delta = (sweep - b.a) % (Math.PI * 2); if (delta < 0) delta += Math.PI * 2;
      const boost = Math.max(0, 1 - delta / 1.2); // 1 au passage → 0 à 1.2 rad
      const gr = 14 + 10 * boost;
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, gr);
      gl.addColorStop(0, `rgba(61,255,165,${0.35 + 0.4 * boost})`);
      gl.addColorStop(1, 'rgba(61,255,165,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = THEME.accent;
      ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = `11px ${THEME.fontUi}`;
      ctx.fillStyle = THEME.textDim;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(b.code, bx + 10, by - 8);
    }
    // Avion en transit (position figée, haut du scope) + lueur AMBRE
    // (maquette : le contact « chaud » du scope).
    const px = cx + R * 0.55, py = cy - R * 0.78;
    ctx.save();
    ctx.shadowColor = 'rgba(255,201,74,0.8)'; ctx.shadowBlur = 12;
    ctx.fillStyle = THEME.gold;
    ctx.beginPath();
    ctx.moveTo(px, py - 9); ctx.lineTo(px + 8, py + 7); ctx.lineTo(px, py + 3);
    ctx.lineTo(px - 8, py + 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = `11px ${THEME.fontUi}`;
    ctx.fillStyle = THEME.textDim;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('TRANSIT · FL320', px + 14, py + 4);
    // Titre phosphore LUISSANT (maquette : glow 18 px) + sous-titre + version.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${THEME.titleSize}px ${THEME.fontUi}`;
    ctx.save();
    ctx.fillStyle = 'rgba(4,20,12,0.7)';
    ctx.fillText('AIRPORT TYCOON', W / 2 + 3, H * 0.4 + 3);
    ctx.shadowColor = 'rgba(61,255,165,0.6)'; ctx.shadowBlur = 18;
    ctx.fillStyle = THEME.text;
    ctx.fillText('AIRPORT TYCOON', W / 2, H * 0.4);
    ctx.restore();
    ctx.font = `${THEME.subtitleSize}px ${THEME.fontUi}`;
    ctx.fillStyle = THEME.gold;
    ctx.fillText('// RADAR RÉTRO · SCAN EN COURS', W / 2, H * 0.4 + THEME.titleSize * 0.8);
    ctx.fillStyle = THEME.textDim;
    ctx.fillText('Direction de contrôle — du radar au départ.', W / 2, H * 0.4 + THEME.titleSize * 0.8 + 22);
    ctx.font = `11px ${THEME.fontUi}`;
    ctx.textAlign = 'right';
    ctx.fillText(`v${THEME.versionTag}`, W - 12, H - 12);
    // --- BOUTONS DOM (créés UNE FOIS, idempotent — pattern R20) -------------
    // R38 : les TROIS scénarios rejouables (mêmes règles, config explicite +
    // objectif R22 annoncé) — des BOUTONS (souris) comme les commandes du
    // menu. « Nouvelle partie » reste le MODE LIBRE (pas de champ scenario,
    // pas d'objectif annoncé). T4 : icônes vectorielles (icons.mjs) — les
    // boutons-scénarios reçoivent un accent par index (SCENARIO_HUES).
    const scenarioBtnDefs = (onMenuCommands && onMenuCommands.scenarioModes)
      ? onMenuCommands.scenarioModes()
      : [];
    if (!menuBox) {
      menuBox = document.createElement('div');
      menuBox.className = 'menu-btns';
      menuBox.setAttribute('role', 'toolbar');
      menuBox.setAttribute('aria-label', 'Commandes du menu (nouvelle partie, reprise de la sauvegarde, options, scénarios)');
      const btnNew = document.createElement('button');
      btnNew.className = 'tool';
      btnNew.textContent = 'Nouvelle partie (N)';
      btnNew.addEventListener('click', () => onMenuCommands.newGame());
      const icNew = iconCanvas('plane', 18, { color: THEME.text, accent: THEME.accent });
      if (icNew) btnNew.prepend(icNew);
      resumeBtn = document.createElement('button');
      resumeBtn.className = 'tool';
      resumeBtn.textContent = 'Reprendre la sauvegarde (R)';
      resumeBtn.addEventListener('click', () => onMenuCommands.resume());
      const icResume = iconCanvas('info', 18, { color: THEME.text, accent: THEME.gold });
      if (icResume) resumeBtn.prepend(icResume);
      const btnOpts = document.createElement('button');
      btnOpts.className = 'tool';
      btnOpts.textContent = 'Options (V)'; // V — clavier (O reste l'overlay réseau R18)
      btnOpts.addEventListener('click', () => onMenuCommands.openOptions());
      const icOpts = iconCanvas('gear', 18, { color: THEME.text, accent: THEME.accent });
      if (icOpts) btnOpts.prepend(icOpts);
      menuBox.append(btnNew, resumeBtn, btnOpts);
      scenarioBtnDefs.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'tool';
        b.textContent = s.label; // le nom du scénario (R38 : config explicite + objectif annoncé)
        b.addEventListener('click', () => onMenuCommands.scenario(s.id));
        const ic = iconCanvas('plane', 18, { color: THEME.text, accent: `hsl(${SCENARIO_HUES[i % SCENARIO_HUES.length]} 70% 62%)` });
        if (ic) b.prepend(ic);
        menuBox.appendChild(b);
      });
      // T2-1 (t_d5da994c) : SÉLECTION DE DIFFICULTÉ dans le menu — 3 boutons
      // (Facile / Normal / Difficile), MÊME style .menu-btns .tool que les
      // commandes du menu (pas de CSS duplicaté) ; la sélection est marquée
      // par aria-pressed (pattern R43) et mise à jour à chaque frame (repeint
      // idempotent, comme resumeBtn ci-dessous). Le clic émet
      // onMenuCommands.setDifficulty — le choix vit dans main.mjs (paramètre
      // du prochain startNewGame, SÉRIALISÉ via state.difficulty).
      const diffBtnDefs = (onMenuCommands && onMenuCommands.difficultyModes)
        ? onMenuCommands.difficultyModes()
        : [];
      const diffRow = document.createElement('div');
      diffRow.className = 'menu-diff';
      const diffLabel = document.createElement('span');
      diffLabel.className = 'menu-diff-label';
      diffLabel.textContent = 'Difficulté :';
      diffRow.appendChild(diffLabel);
      diffBtns = diffBtnDefs.map((d) => {
        const b = document.createElement('button');
        b.className = 'tool';
        b.textContent = d.label; // le nom du profil (core/difficulty.mjs)
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => onMenuCommands.setDifficulty(d.id));
        diffRow.appendChild(b);
        return b;
      });
      menuBox.appendChild(diffRow);
      document.body.appendChild(menuBox);
    }
    resumeBtn.style.display = onMenuCommands.canResume() ? '' : 'none';
    // T2-1 : la sélection de difficulté suit la commande (aria-pressed) —
    // idempotent : la valeur ne change que sur setDifficulty.
    const curDiff = (onMenuCommands.difficulty && onMenuCommands.difficulty()) || 'normal';
    diffBtns.forEach((b, i) => {
      const def = (onMenuCommands.difficultyModes || (() => []))()[i];
      if (def) b.setAttribute('aria-pressed', String(def.id === curDiff));
    });
  }

  // T5a (t_e4c3ffff) : la ZONE du dernier HUD peint (x, y, w, h + police) —
  // exposée aux tests CDP (renderer.hudRect()) : le HUD est peint SUR le
  // canvas #game, une mesure DOM ne le voit pas ; la QA vérifie l'absence de
  // chevauchement avec les panneaux par cette zone, pas par le canvas entier.
  let hudRectNow = null;

  // Bandeau HUD : temps, vitesse, pause + (si sim) fonds, passagers, satisfaction.
  function drawHud(state) {
    const lines = [
      `Temps : ${Math.floor(state.time / 60)}:${String(Math.floor(state.time % 60)).padStart(2, '0')}`,
      `Vitesse : x${[1, 2, 4][state.speedIndex]}`,
    ];
    const sim = state.sim;
    if (sim && sim.economy) {
      // La sim passe de `funds` (M1) à `money` — on lit les deux pour la rétrocompat.
      const m = sim.economy.money ?? sim.economy.funds;
      if (m !== undefined) lines.push(`Fonds : ${Math.round(m)} $`);
    }
    if (sim && sim.passengers) {
      lines.push(`Passagers : ${sim.passengers.totalCarried} · ${Math.round(sim.passengers.satisfaction)} %`);
      // BL-13 (AC22) : les files du parcours passagers sont VISIBLES (occupation
      // lisible par étape). R30 : les files sont PAR TERMINAL (sim.passengers.
      // queues[terminalId]) ; le HUD affiche la SOMME des terminaux (queueTotals,
      // agrégat de lecture — pas une règle).
      const q = queueTotals(sim);
      lines.push(`Files : check-in ${Math.round(q.checkin)} · sécurité ${Math.round(q.security)} · attente ${Math.round(q.board)}`);
    }
    if (sim) {
      // T3 MÉTÉO (t_9b665a8b) : l'état + l'effet MESURABLE en cours (lecture
      // pure weatherView — pas de mutation ; l'incident météo majore les
      // effets à la ligne « orage », weatherEffect, weather.mjs). « clear »
      // si le champ n'existe pas encore (nouvelle partie, 1er tick).
      const wv = weatherView(sim);
      lines.push(
        `Météo : ${wv.fr}${wv.incident ? ' — incident (effets orage)' : ''}` +
        (wv.speed < 1 ? ` · arrivée ${Math.round((1 - wv.speed) * 100)} % plus lente` : '') +
        (wv.delay > 0 && !wv.incident ? ` · +${wv.delay} s en attente` : '')
      );
      // T3 (t_76744b22) : l'HORLOGE DE JEU (jour + heure JEU + phase) + la
      // SAISON (dérivée du jour — saisons.mjs) : l'affichage du temps
      // (lecture pure clockView/seasonView — l'horloge absente → J1 08:00).
      const cv = clockView(sim);
      const sv = seasonView(sim);
      lines.push(`Horloge : J${cv.day} ${cv.label} (${cv.phaseFr}) · ${sv.fr}`);
    }
    if (state.paused) lines.push('PAUSE (P pour reprendre)');
    // T5a (t_e4c3ffff) : HUD LISIBLE + PLACEMENT EXPLICITE (0 chevauchement).
    // • Largeur du panneau = plus longue LIGNE mesurée (ctx.measureText) +
    //   marge 24 px, plafonnée à vw - 24 : les lignes longues (« Files : … »,
    //   « Météo : … ») DÉBORDAIENT le fixe 240 px — le texte dépassait la
    //   surface, illisible. La largeur suit le contenu.
    // • Écran étroit (≤560 px, même seuil que le @media d'index.html) : le
    //   bandeau planning est une STRIPE PLEINE LARGEUR en haut — le HUD
    //   canvas peint en haut à gauche était COUVERT (le bug mobile connu).
    //   Décision de layout T5a : le HUD DESCEND SOUS la stripe (y = 8 +
    //   .planning.offsetHeight + 8 — mesure DOM en lecture seule, la zone
    //   canvas dessous reste libre et jouable) ; police mobile ADAPTIVE
    //   (T5c : 13 → 12 → 11 px, seuil QA ≥ 11 px — le monospace phosphore
    //   est plus large que le system-ui v1). Desktop : haut à gauche
    //   (12, 12), 16 px.
    const vw = viewSize().width;
    const mobile = vw <= 560;
    // T5c : la police PHOSPHORE monospace (maquette variant-c) est plus
    // LARGE que le system-ui v1 : en mobile, la police DÉMARRE à 13 px
    // (cible T5a) et s'ADAPTE vers le bas (12 px — PLANCHER : exigence
    // Elsay T5c « police min 12 px ») tant que la ligne la plus longue ne
    // tient pas dans vw - 24. Desktop : 16 px (inchangé).
    let fs = mobile ? 13 : 16;
    ctx.font = fs + 'px ' + THEME.fontUi;
    const widest = () => { let w0 = 0; for (const t of lines) w0 = Math.max(w0, ctx.measureText(t).width); return w0; };
    let maxLine = widest();
    if (mobile) {
      const capW = Math.max(120, vw - 24);
      while (maxLine + 24 > capW && fs > 12) {
        fs -= 1;
        ctx.font = fs + 'px ' + THEME.fontUi;
        maxLine = widest();
      }
    }
    const lh = Math.round(fs * 1.5); // pas de ligne (24 px en desktop = avant)
    const w = Math.min(Math.ceil(maxLine) + 24, Math.max(120, vw - 24));
    const planEl = typeof document !== 'undefined' ? document.querySelector('.planning') : null;
    const planH = planEl && mobile ? planEl.offsetHeight : 0;
    const x = 12;
    const y = mobile ? 8 + planH + 8 : 12; // mobile : sous la stripe planning (top 8 + hauteur + 8)
    const h = lh * lines.length + 16;
    // T5c : la surface du HUD EST le SCOPE (noir phosphore quasi opaque —
    // le contraste texte/surface ≥ 4,5:1, tokens theme.mjs) + liseré
    // phosphore (le panneau « flotte » sur la carte, comme la maquette).
    ctx.fillStyle = 'rgba(5,8,7,0.9)'; // v2 : noir phosphore (v1 : « nuit » bleuté)
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.accentSoft;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = THEME.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((t, i) => ctx.fillText(t, x + 12, y + 8 + fs + i * lh));
    hudRectNow = { x, y, w, h, fontPx: fs, maxLinePx: Math.ceil(maxLine), lines: lines.length, mobile };
  }

  // T4 (t_eb78478e) : transition d'écran (MENU ↔ JEU) — fondu depuis le noir
  // sur ~0,35 s quand l'écran change (horloge par frame, ~21 frames à 60 fps).
  // Un seul état local au renderer (zéro règle de jeu, zéro DOM).
  let transScreen = null;
  let transT = 0;
  const TRANS_DUR = 0.35;

  function render(state) {
    const cam = state.camera;
    // R43 : la palette suit l'option daltonienne (état live, lue à chaque
    // frame) — getPalette est en lecture seule : unknown → standard (jamais
    // de rendu cassé).
    const pal = getPalette(paletteOf ? paletteOf() : false);
    if (state.screen !== transScreen) { transScreen = state.screen; transT = 0; }
    if (transT < TRANS_DUR) transT += 1 / 60;
    if (state.screen === 'menu') {
      drawMenu(pal);
    } else {
      if (menuBox) menuBox.style.display = 'none'; // R20 : les boutons du menu ne se superposent pas au jeu
      // Juice (t_5065be95) : le SHAKE (incident majeur) décale le monde entier
      // (particules + overlay compris) — le HUD, lui, reste stable (UI ≠ monde).
      ctx.save();
      const off = juice ? juice.shakeOffset() : { x: 0, y: 0 };
      ctx.translate(off.x, off.y);
      drawGame(state, cam, pal);
      // Superpositions (fantôme de construction…) — la logique de pose reste dans la sim/UI.
      for (const overlay of overlays) overlay(ctx, cam, viewSize());
      if (juice) juice.draw(ctx, cam, viewSize());
      // T3 MÉTÉO (t_9b665a8b) : teinte SUBLIME sur le monde (zéro asset —
      // un seul rempli) : pluie = bleuté, neige = voile blanc, orage/incident
      // = nuage sombre. « clair »/« nuageux » : rien (le nuageux est trop
      // léger pour exister — pas de bruit). Le HUD reste stable (après restore).
      const tint = weatherTint(state.sim);
      if (tint) { ctx.fillStyle = tint; ctx.fillRect(-16, -16, canvas.width + 32, canvas.height + 32); }
      // T3 (t_76744b22) : l'HORLOGE jour/nuit — la teinte du monde PAR PHASE
      // (nuit = bleuté profond, aube/crépuscule = voiles, jour = rien) +
      // l'habillage de SAISON (par-dessus la météo : été doré / automne
      // ocre / hiver bleuté, printemps = rien). Zéro asset, deux remplis.
      const dt_ = dayTint(state.sim);
      if (dt_) { ctx.fillStyle = dt_; ctx.fillRect(-16, -16, canvas.width + 32, canvas.height + 32); }
      const st = seasonWorldTint(state.sim);
      if (st) { ctx.fillStyle = st; ctx.fillRect(-16, -16, canvas.width + 32, canvas.height + 32); }
      ctx.restore();
      drawHud(state);
    }
    // T4 : fondu de transition (MENU ↔ JEU) — voile noir à alpha DÉCROISSANT
    // (1 → 0) après un changement d'écran ; les deux écrans en dessous sont
    // déjà peints (menu ou jeu) : un seul rempli, pas de couche DOM.
    if (transT < TRANS_DUR) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - transT / TRANS_DUR);
      ctx.fillStyle = THEME.skyTop;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    // Exposition pour les tests/CDP sans exposer les règles de jeu
    return {
      screen: state.screen,
      paused: state.paused,
      cam: { x: cam.x, y: cam.y, zoom: cam.zoom },
      viewSize: viewSize(),
    };
  }

  return { render, viewSize, resize, hudRect: () => hudRectNow }; // T5a (t_e4c3ffff) : zone du HUD (tests CDP)
}
