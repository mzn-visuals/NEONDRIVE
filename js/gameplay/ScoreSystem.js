(function () {
  class ScoreSystem {
    constructor() {
      this.reset();
    }

    reset() {
      this.score = 0;
      this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
      this.totalJudged = 0;
      this.weighted = 0;
    }

    registerHit(tileType, quality, comboMult, speedNorm) {
      const cfg = ND.Config.TILE_TYPES[tileType];
      const qualityFactor = quality === "PERFECT" ? 1.5 : quality === "GREAT" ? 1.2 : 1.0;
      const speedMult = 1 + speedNorm * 0.8;
      this.score += Math.round(cfg.value * qualityFactor * comboMult * speedMult);
      this.counts[quality]++;
      this.totalJudged++;
      this.weighted += quality === "PERFECT" ? 1 : quality === "GREAT" ? 0.75 : 0.45;
      return this.score;
    }

    registerMiss() {
      this.counts.MISS++;
      this.totalJudged++;
    }

    get accuracy() {
      if (!this.totalJudged) return 100;
      return (this.weighted / this.totalJudged) * 100;
    }

    summary() {
      return {
        score: this.score,
        maxCombo: this._maxCombo || 0,
        counts: { ...this.counts },
        accuracy: this.accuracy
      };
    }

    setMaxCombo(m) { this._maxCombo = m; }
  }

  ND.ScoreSystem = ScoreSystem;
})();
