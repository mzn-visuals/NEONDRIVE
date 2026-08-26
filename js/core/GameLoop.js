(function () {
  class GameLoop {
    constructor() {
      this.subs = new Set();
      this.running = false;
      this._last = 0;
      this._raf = 0;
      this.elapsed = 0;
      this._tick = this._tick.bind(this);
    }
    add(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    start() {
      if (this.running) return;
      this.running = true;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._tick);
    }
    stop() {
      this.running = false;
      cancelAnimationFrame(this._raf);
    }
    _tick(now) {
      if (!this.running) return;
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > 0.05) dt = 0.05;
      if (dt < 0) dt = 0;
      this.elapsed += dt;
      for (const fn of [...this.subs]) {
        try {
          fn(dt, this.elapsed);
        } catch (e) {
          if (!this._warned) {
            this._warned = true;
            console.error("[loop] subscriber error:", e && (e.stack || e.message || String(e)));
          }
        }
      }
      this._raf = requestAnimationFrame(this._tick);
    }
  }

  ND.loop = new GameLoop();
})();
