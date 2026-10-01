// Caméra 2D : pan + zoom. La position est le CENTRE de la vue (coordonnées monde).
// Le clavier UI émet des commandes (drag, wheel, keys) ; cette classe les applique.
export class Camera {
  constructor(state) {
    this.state = state; // .camera = { x, y, zoom }
    // vitesse de pan en pixels écran / seconde (échelle zoom prise en compte)
    this.panSpeed = 600;
    this.minZoom = 0.25;
    this.maxZoom = 4;
  }

  // Panne en pixels écran ; convertit en monde via le zoom.
  pan(dxScreen, dyScreen) {
    const cam = this.state.camera;
    cam.x -= (dxScreen / cam.zoom);
    cam.y -= (dyScreen / cam.zoom);
  }

  // Zoom vers un point écran (sx, sy) : le point monde sous la souris ne bouge pas.
  zoomAt(sx, sy, factor, viewW, viewH) {
    const cam = this.state.camera;
    const beforeX = this.screenToWorldX(sx, viewW);
    const beforeY = this.screenToWorldY(sy, viewH);
    cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, cam.zoom * factor));
    cam.x += beforeX - this.screenToWorldX(sx, viewW);
    cam.y += beforeY - this.screenToWorldY(sy, viewH);
  }

  screenToWorldX(sx, viewW) {
    const cam = this.state.camera;
    return cam.x + (sx - viewW / 2) / cam.zoom;
  }
  screenToWorldY(sy, viewH) {
    const cam = this.state.camera;
    return cam.y + (sy - viewH / 2) / cam.zoom;
  }
}
