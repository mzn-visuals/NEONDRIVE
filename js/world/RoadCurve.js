(function () {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothNoise1D(seed) {
    const rng = mulberry32(seed);
    const grad = new Float32Array(4096);
    for (let i = 0; i < grad.length; i++) grad[i] = rng() * 2 - 1;
    return function (x) {
      const i = Math.floor(x);
      const f = x - i;
      const u = f * f * (3 - 2 * f);
      const a = grad[((i % grad.length) + grad.length) % grad.length];
      const b = grad[(((i + 1) % grad.length) + grad.length) % grad.length];
      return a + (b - a) * u;
    };
  }

  class RoadCurve {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.step = ND.Config.ROAD.sampleStep;
      this.kappaNoise = smoothNoise1D(this.seed ^ 0x9e3779b9);
      this.kappaSlow = smoothNoise1D(this.seed ^ 0x85ebca6b);
      this.elevPhase1 = mulberry32(this.seed ^ 0xc2b2ae35)() * Math.PI * 2;
      this.elevPhase2 = mulberry32(this.seed ^ 0x27d4eb2f)() * Math.PI * 2;
      this.samples = [];
      this._head = { x: 0, z: 0, h: 0 };
      this._lastS = -1;
      this.update(0, 800);
    }

    _curvatureAt(s) {
      const R = ND.Config.ROAD;
      const fast = this.kappaNoise(s / 260) * 0.55 + this.kappaSlow(s / 900) * 0.45;
      let k = fast * R.maxCurvature * 1.6;
      if (s < 140) k *= Math.max(0, (s - 30) / 110);
      return THREE.MathUtils.clamp(k, -R.maxCurvature, R.maxCurvature);
    }

    _elevationAt(s) {
      const R = ND.Config.ROAD;
      const l1 = R.elevWavelengthMin * 1.55;
      const l2 = R.elevWavelengthMin * 0.62;
      const e = Math.sin(s / l1 + this.elevPhase1) * R.elevAmp +
                Math.sin(s / l2 + this.elevPhase2) * R.elevAmp * 0.35;
      return s < 120 ? e * Math.max(0, s / 120) : e;
    }

    _ensure(toS) {
      if (!this.samples.length) {
        this.samples.push({ s: 0, x: 0, z: 0, h: 0, y: this._elevationAt(0), bank: 0, k: 0 });
      }
      const step = this.step;
      let guard = 0;
      while (this.samples[this.samples.length - 1].s < toS && guard++ < 200000) {
        const prev = this.samples[this.samples.length - 1];
        const k = this._curvatureAt(prev.s + step);
        const h = prev.h + k * step;
        const x = prev.x + Math.sin(h) * step;
        const z = prev.z - Math.cos(h) * step;
        const y = this._elevationAt(prev.s + step);
        const bank = THREE.MathUtils.clamp(-k * ND.Config.ROAD.bankFactor, -ND.Config.ROAD.maxBank, ND.Config.ROAD.maxBank);
        this.samples.push({ s: prev.s + step, x, z, h, y, bank, k });
      }
    }

    _trim(behindS) {
      let drop = 0;
      while (drop < this.samples.length - 2 && this.samples[drop + 1].s < behindS) drop++;
      if (drop > 0) this.samples.splice(0, drop);
    }

    update(carS, horizon) {
      this._ensure(Math.max(carS + 900, horizon || 0));
      this._trim(carS - 200);
    }

    sampleAt(s) {
      const arr = this.samples;
      if (!arr.length) return { s: 0, x: 0, z: 0, h: 0, y: 0, bank: 0, k: 0 };
      if (s <= arr[0].s) return arr[0];
      if (s >= arr[arr.length - 1].s) {
        this._ensure(s + this.step * 4);
        return this.sampleAt(s);
      }
      let lo = 0, hi = arr.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].s <= s) lo = mid; else hi = mid;
      }
      const a = arr[lo], b = arr[hi];
      const f = (s - a.s) / Math.max(1e-6, b.s - a.s);
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return {
        s,
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        h: a.h + dh * f,
        y: a.y + (b.y - a.y) * f,
        bank: a.bank + (b.bank - a.bank) * f,
        k: a.k + (b.k - a.k) * f
      };
    }

    worldPos(s, lateral, out) {
      const sm = this.sampleAt(s);
      const rx = Math.cos(sm.h), rz = Math.sin(sm.h);
      out = out || new THREE.Vector3();
      out.set(sm.x + rx * lateral, sm.y, sm.z + rz * lateral);
      return out;
    }

    frameAt(s) {
      const sm = this.sampleAt(s);
      const dirx = Math.sin(sm.h), dirz = -Math.cos(sm.h);
      const rx = Math.cos(sm.h), rz = Math.sin(sm.h);
      return {
        pos: new THREE.Vector3(sm.x, sm.y, sm.z),
        dir: new THREE.Vector3(dirx, 0, dirz),
        right: new THREE.Vector3(rx, 0, rz),
        h: sm.h,
        bank: sm.bank,
        y: sm.y,
        k: sm.k
      };
    }

    elevationAt(s) { return this._elevationAt(s); }
    bumpAt(s) {
      return (this.kappaNoise(s / 7.3) + this.kappaNoise(s / 2.9) * 0.5) * 0.5;
    }
  }

  ND.RoadCurve = RoadCurve;
  ND.mulberry32 = mulberry32;
})();
