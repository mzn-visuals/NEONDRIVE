(function () {
  const C = ND.Config;

  class DriftSystem {
    constructor(car) {
      this.car = car;
      this.active = false;
      this.time = 0;
      this.score = 0;
      this.totalScore = 0;
      this.bestChain = 0;
      ND.bus.on("car-drift-start", () => this._start());
      ND.bus.on("car-drift-end", () => this._end());
    }

    reset() {
      this.active = false;
      this.time = 0;
      this.score = 0;
      this.totalScore = 0;
      this.bestChain = 0;
    }

    _start() {
      this.active = true;
      this.time = 0;
      this.score = 0;
      ND.bus.emit("drift-start");
    }

    _end() {
      if (!this.active) return;
      this.active = false;
      const earned = Math.round(this.score);
      if (earned > 40) {
        this.totalScore += earned;
        this.bestChain = Math.max(this.bestChain, earned);
        this.car.chargeNitro(this.time * C.DRIFT.nitroPerSec);
        ND.bus.emit("drift-scored", earned, this.time);
      }
      this.score = 0;
      this.time = 0;
    }

    update(dt) {
      if (!this.active) return;
      this.time += dt;
      const speedFactor = 0.6 + this.car.speedNorm;
      this.score += C.DRIFT.scorePerSec * speedFactor * dt;
      ND.bus.emit("drift-tick", Math.round(this.score), this.time);
    }
  }

  class StuntSystem {
    constructor(car) {
      this.car = car;
      this.totalScore = 0;
      this.bestAir = 0;
      ND.bus.on("car-landed", (info) => this._land(info));
    }

    reset() {
      this.totalScore = 0;
      this.bestAir = 0;
    }

    _land(info) {
      const rot = Math.abs(info.rotation);
      let score = info.airTime * C.STUNTS.scorePerSecAir + rot * C.STUNTS.scorePerRotation;
      let label = "AIR " + info.airTime.toFixed(1) + "s";
      if (info.quality === "clean") {
        score += C.STUNTS.cleanLandingBonus;
        label = "CLEAN " + label;
        this.car.chargeNitro(14);
      } else {
        label = "SLOPPY " + label;
      }
      score = Math.round(score);
      if (score > 60) {
        this.totalScore += score;
        this.bestAir = Math.max(this.bestAir, info.airTime);
        ND.bus.emit("stunt-scored", score, label);
      }
    }
  }

  ND.DriftSystem = DriftSystem;
  ND.StuntSystem = StuntSystem;
})();
