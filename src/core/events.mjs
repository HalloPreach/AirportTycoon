// Petits événements pour que l'UI réagisse sans poller l'état à chaque frame.
// ponytail: Map de listes, pas de priorité ni de débounce ; élargir si besoin.
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.listeners.get(type);
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    for (const fn of (this.listeners.get(type) || []).slice()) fn(payload);
  }
}
