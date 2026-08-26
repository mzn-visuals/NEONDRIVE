(function () {
  const BANDS = [
    { id: "sub",     from: 20,    to: 150 },
    { id: "bass",    from: 150,   to: 400 },
    { id: "lowmid",  from: 400,   to: 2000 },
    { id: "mid",     from: 2000,  to: 6000 },
    { id: "treble",  from: 6000,  to: 16000 }
  ];

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.masterGain = null;
      this.sourceNode = null;
      this.freqData = null;
      this.audioEl = new Audio();
      this.audioEl.crossOrigin = "anonymous";
      this.audioEl.preload = "auto";
      this.bands = BANDS;
      this._bandEnergies = { sub: 0, bass: 0, lowmid: 0, mid: 0, treble: 0, overall: 0 };
      this.volume = 0.8;

      const el = this.audioEl;
      el.addEventListener("play", () => ND.bus.emit("music-play"));
      el.addEventListener("pause", () => ND.bus.emit("music-pause"));
      el.addEventListener("ended", () => ND.bus.emit("music-ended"));
      el.addEventListener("error", e => {
        if (el.src) ND.bus.emit("music-error", el.error);
      });
    }

    ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.sourceNode = this.ctx.createMediaElementSource(this.audioEl);
      this.sourceNode.connect(this.analyser);
    }

    async resume() {
      this.ensure();
      if (this.ctx.state === "suspended") await this.ctx.resume();
    }

    setVolume(v) {
      this.volume = v;
      if (this.masterGain) this.masterGain.gain.value = v;
    }

    decode(arrayBuffer) {
      this.ensure();
      return this.ctx.decodeAudioData(arrayBuffer);
    }

    sampleRate() { this.ensure(); return this.ctx.sampleRate; }

    updateBands() {
      if (!this.analyser) return this._bandEnergies;
      this.analyser.getByteFrequencyData(this.freqData);
      const nyquist = this.ctx.sampleRate / 2;
      const binHz = nyquist / this.freqData.length;
      let overallSum = 0;
      for (const band of this.bands) {
        const lo = Math.max(1, Math.floor(band.from / binHz));
        const hi = Math.min(this.freqData.length - 1, Math.ceil(band.to / binHz));
        let sum = 0;
        for (let i = lo; i <= hi; i++) sum += this.freqData[i];
        const avg = sum / Math.max(1, hi - lo + 1) / 255;
        this._bandEnergies[band.id] += (avg - this._bandEnergies[band.id]) * 0.5;
        overallSum += avg;
      }
      this._bandEnergies.overall = overallSum / this.bands.length;
      return this._bandEnergies;
    }
  }

  ND.AudioEngine = AudioEngine;
})();
