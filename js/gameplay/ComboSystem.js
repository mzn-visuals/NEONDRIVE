(function () {
  class ComboSystem {
    constructor() {
      this.reset();
    }

    reset() {
      this.count = 0;
      this.max = 0;
      this.mult = 1.0;
    }

    get multiplier() { return this.mult; }

    onHit() {
      this.count++;
      if (this.count > this.max) this.max = this.count;
      let m = 1;
      for (const tier of ND.Config.COMBO_TIERS) {
        if (this.count >= tier.hits) { m = tier.mult; break; }
      }
      if (m !== this.mult) {
        this.mult = m;
        ND.bus.emit("combo-tier", m, this.count);
      }
      ND.bus.emit("combo-changed", this.count, this.mult);
    }

    onMiss() {
      if (this.count > 0) {
        this.count = 0;
        this.mult = 1.0;
        ND.bus.emit("combo-broken");
        ND.bus.emit("combo-changed", 0, 1);
      }
    }
  }

  ND.ComboSystem = ComboSystem;
})();
