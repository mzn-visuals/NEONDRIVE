(function () {
  class QueueManager {
    constructor(provider) {
      this.provider = provider;
      this.mode = ND.Config.MODES.SINGLE;
      this.upcoming = [];
      this.isRadio = false;
      this._radioFetch = null;
    }

    setMode(mode) { this.mode = mode; }

    startWith(track) {
      this.upcoming = [];
      this.isRadio = false;
      this._radioFetch = null;
      if (this.mode === ND.Config.MODES.RADIO || this.mode === ND.Config.MODES.INFINITE) {
        this._kickRadio(track);
      }
    }

    push(track) {
      if (this.isRadio) { this.upcoming = []; this.isRadio = false; }
      this.upcoming.push(track);
      if (this.upcoming.length === 1) this.provider.prewarm(track);
      ND.bus.emit("queue-changed", this.upcoming, false);
    }

    _kickRadio(seed) {
      this._radioFetch = this.provider.fetchRadioQueue(seed)
        .then(tracks => {
          if (this.upcoming.length) return;
          this.upcoming = tracks;
          this.isRadio = true;
          if (tracks.length) this.provider.prewarm(tracks[0]);
          ND.bus.emit("queue-changed", this.upcoming, true);
        })
        .catch(e => console.warn("[radio]", e))
        .finally(() => { this._radioFetch = null; });
    }

    async next() {
      if (!this.upcoming.length && this._radioFetch) {
        try { await this._radioFetch; } catch (_) {}
      }
      const next = this.upcoming.shift();
      ND.bus.emit("queue-changed", this.upcoming, this.isRadio);
      if (next) this.provider.prewarm(this.upcoming[0] || next);
      return next || null;
    }

    peek() { return this.upcoming[0] || null; }

    get hasFollowing() {
      return this.upcoming.length > 0 ||
        ((this.mode === ND.Config.MODES.RADIO || this.mode === ND.Config.MODES.INFINITE));
    }

    reset() {
      this.upcoming = [];
      this.isRadio = false;
      this._radioFetch = null;
      ND.bus.emit("queue-changed", [], false);
    }
  }

  ND.QueueManager = QueueManager;
})();
