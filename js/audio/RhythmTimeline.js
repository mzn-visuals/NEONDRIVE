(function () {
  class RhythmTimeline {
    constructor(events, energyCurve) {
      this.events = (events || []).slice().sort((a, b) => a.t - b.t);
      this.energyCurve = energyCurve || new Float32Array(1);
    }

    get length() { return this.events.length; }

    slice(from, to) {
      const out = [];
      for (const ev of this.events) {
        if (ev.t >= from && ev.t < to) out.push(ev);
        else if (ev.t >= to) break;
      }
      return out;
    }

    indexAfter(t) {
      let lo = 0, hi = this.events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.events[mid].t < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    energyAt(t) {
      const curve = this.energyCurve;
      const i = Math.max(0, Math.min(curve.length - 1, Math.floor(t)));
      const j = Math.min(curve.length - 1, i + 1);
      const f = t - i;
      return curve[i] * (1 - f) + curve[j] * f;
    }
  }

  ND.RhythmTimeline = RhythmTimeline;
})();
