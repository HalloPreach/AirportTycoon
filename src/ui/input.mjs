// Entrée clavier / souris → commandes pures (évènements du bus).
// Aucune règle de jeu ici : on ne fait que traduire les gestes.
// viewSize = () => ({width, height}) : le canvas suit la fenêtre.
export function makeInputHandlers(canvas, bus, camera, viewSize) {
  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const KEY_PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  window.addEventListener('keydown', (e) => {
    if (e.key in KEY_PAN) { keys.add(e.key); e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P') bus.emit('pause');
    else if (e.key === 'q' || e.key === 'Q') bus.emit('quit');
    else if (e.key === 'Escape') bus.emit('pause');
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  // Panne par glisser (bouton gauche)
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camera.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Zoom à la molette, centré sur la souris
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = viewSize();
    camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15, v.width, v.height);
  }, { passive: false });

  // Panne au clavier, chaque frame (payload du bus 'frame' = dt en secondes)
  bus.on('frame', (dt) => {
    let ax = 0;
    let ay = 0;
    for (const k of keys) {
      const [x, y] = KEY_PAN[k];
      ax += x; ay += y;
    }
    if (ax !== 0 || ay !== 0) camera.pan(ax * camera.panSpeed * dt, ay * camera.panSpeed * dt);
  });

  return { keys };
}
