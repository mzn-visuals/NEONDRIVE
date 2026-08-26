(function () {
  class EventBus {
    constructor() { this._l = new Map(); }
    on(evt, fn) {
      if (!this._l.has(evt)) this._l.set(evt, new Set());
      this._l.get(evt).add(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) { const s = this._l.get(evt); if (s) s.delete(fn); }
    once(evt, fn) {
      const off = this.on(evt, (...a) => { off(); fn(...a); });
      return off;
    }
    emit(evt, ...args) {
      const s = this._l.get(evt);
      if (s) for (const fn of [...s]) fn(...args);
      const all = this._l.get("*");
      if (all) for (const fn of [...all]) fn(evt, ...args);
    }
  }
  ND.bus = new EventBus();
})();
