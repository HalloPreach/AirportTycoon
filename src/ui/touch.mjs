// Entrée tactile mobile (T6, t_87168414) : PAN 1 doigt, PINCH ZOOM 2 doigts,
// TAP = click. Le TAP est routé vers `onTap(sx, sy)` — le MÊME chemin qu'un
// click desktop : les consommateurs (build-tool, panneaux) exposent
// `clickAt(sx, sy)`, le click souris et le tap tactil passent TOUS les deux
// par là. Zéro logique dupliquée, le desktop est intact (aucun événement
// touch ne se produit sur une souris).
//
// Couche UI fine : elle ne décide rien (pas de règle de jeu) — elle applique
// la caméra (camera.pan / camera.zoomAt) et émet UN seul callback (onTap).
//
// Les listeners sont NON PASSIFS (passive: false) pour pouvoir
// preventDefault :
//  - sur touchstart  → supprime l'émulation souris (pas de mousedown fantôme)
//  - sur touchend    → supprime le click SYNTHÉTIQUE post-touch : sans ça le
//    tap serait exécuté DEUX fois (le notre + celui du navigateur).

// Seuils (mesurables, couverts par tests/t6-touch.test.mjs) :
export const TOUCH_CFG = Object.freeze({
  tapMaxMs: 250,     // tap : la gesture dure ≤ 250 ms
  tapMaxMovePx: 10,  // ...et la dérive totale reste < 10 px
  panSlopPx: 8,      // le pan ne démarre qu'au-delà de 8 px (en-dessous = tap)
  minPinchDist: 24,  // pinch : distance minimale entre doigts (garde-boue)
});

export function makeTouchHandlers(canvas, camera, viewSize, { onTap = null } = {}) {
  // Machine à états de la gesture : 'pan' (1 doigt) / 'pinch' (2 doigts) /
  // null (repos). Une seule gesture à la fois (le canvas est le seul
  // récepteur tactile du jeu).
  let mode = null;
  let lastX = 0, lastY = 0;   // dernière position (pas du pan)
  let lastDist = 0;          // dernière distance inter-doigts (pinch)
  let startX = 0, startY = 0; // départ de la gesture (tap)
  let startT = 0;            // horodatage du départ (tap : ≤ tapMaxMs)
  let maxMove = 0;           // dérive max depuis le départ (tap : < tapMaxMovePx)
  let usedPinch = false;     // un pinch est passé → le tap est mort

  // Coordonnées CANVAS (même espace que e.offsetX : le bitmap = la fenêtre,
  // la scale protège si le CSS scale le canvas dans le futur).
  function local(cx, cy) {
    const r = canvas.getBoundingClientRect();
    const sx = r.width > 0 ? canvas.width / r.width : 1;
    const sy = r.height > 0 ? canvas.height / r.height : 1;
    return [(cx - r.left) * sx, (cy - r.top) * sy];
  }
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      mode = 'pan';
      const [x, y] = local(e.touches[0].clientX, e.touches[0].clientY);
      lastX = startX = x;
      lastY = startY = y;
      startT = e.timeStamp;
      maxMove = 0;
      usedPinch = false;
    } else {
      // 2 doigts (ou +) : pinch (le zoom), le tap est définitivement exclu.
      mode = 'pinch';
      usedPinch = true;
      lastDist = Math.max(dist(e.touches[0], e.touches[1]), 1);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (mode === 'pan' && e.touches.length === 1) {
      const [x, y] = local(e.touches[0].clientX, e.touches[0].clientY);
      maxMove = Math.max(maxMove, Math.hypot(x - startX, y - startY));
      if (maxMove < TOUCH_CFG.panSlopPx) return; // en-deçà : toujours un tap
      camera.pan(x - lastX, y - lastY);
      lastX = x;
      lastY = y;
    } else if (mode === 'pinch' && e.touches.length >= 2) {
      const d = dist(e.touches[0], e.touches[1]);
      if (d < TOUCH_CFG.minPinchDist) return; // bruit : on n'zoom pas dessus
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const [cx, cy] = local(mx, my);
      // Zoom centré sur le point milieu, facteur = rapport des distances
      // (incrémental → le pinch est fluide). camera.zoomAt borne [0.25, 4].
      camera.zoomAt(cx, cy, d / lastDist, viewSize().width, viewSize().height);
      lastDist = d;
    } else if (mode === 'pinch' && e.touches.length === 1) {
      // Un doigt s'est levé : le restant reprend le PAN (ré-ancré sur sa
      // position courante) — la gesture continue sans à-coup. Le tap reste
      // exclu (usedPinch).
      mode = 'pan';
      const [x, y] = local(e.touches[0].clientX, e.touches[0].clientY);
      lastX = x;
      lastY = y;
    }
  }, { passive: false });

  function end(e) {
    // preventDefault sur touchend : le click synthétique post-touch est
    // supprimé (le tap est le NOTRE seul — pas de double exécution).
    e.preventDefault();
    if (e.touches.length === 0) {
      // TAP ? Une seule gesture, brève, dérive minime, jamais de pinch.
      const isTap = mode === 'pan' && !usedPinch
        && (e.timeStamp - startT) <= TOUCH_CFG.tapMaxMs
        && maxMove < TOUCH_CFG.tapMaxMovePx;
      if (isTap && onTap) onTap(lastX, lastY);
      mode = null;
    }
  }
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', () => { mode = null; }, { passive: false });

  return { config: TOUCH_CFG };
}
