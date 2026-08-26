(function () {
  class AudioFx {
    constructor(engine) {
      this.engine = engine;
      this.ready = false;
      this.enabled = true;
      this.volume = 0.55;
    }

    ensure() {
      if (this.ready || !this.engine.ctx) return;
      const ctx = this.engine.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);

      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 55;
      this.engineOsc2 = ctx.createOscillator();
      this.engineOsc2.type = "square";
      this.engineOsc2.frequency.value = 27;
      const engFilter = ctx.createBiquadFilter();
      engFilter.type = "lowpass";
      engFilter.frequency.value = 420;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(engFilter);
      this.engineOsc2.connect(engFilter);
      engFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.engineOsc2.start();

      const noiseLen = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;

      this.windSrc = ctx.createBufferSource();
      this.windSrc.buffer = this.noiseBuf;
      this.windSrc.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = "bandpass";
      this.windFilter.frequency.value = 700;
      this.windFilter.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.windSrc.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      this.windSrc.start();

      this.driftSrc = ctx.createBufferSource();
      this.driftSrc.buffer = this.noiseBuf;
      this.driftSrc.loop = true;
      this.driftFilter = ctx.createBiquadFilter();
      this.driftFilter.type = "bandpass";
      this.driftFilter.frequency.value = 2100;
      this.driftFilter.Q.value = 2.4;
      this.driftGain = ctx.createGain();
      this.driftGain.gain.value = 0;
      this.driftSrc.connect(this.driftFilter);
      this.driftFilter.connect(this.driftGain);
      this.driftGain.connect(this.master);
      this.driftSrc.start();

      this.ready = true;
    }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = v;
    }

    blip(freq, dur, type, vol) {
      if (!this.enabled || !this.engine.ctx) return;
      const ctx = this.engine.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(this.master || this.engine.masterGain);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    }

    thud(strength) {
      if (!this.enabled || !this.engine.ctx) return;
      const ctx = this.engine.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 240;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.5, strength), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      src.stop(ctx.currentTime + 0.3);
    }

    nitroWhoosh() {
      if (!this.enabled || !this.engine.ctx || !this.ready) return;
      const ctx = this.engine.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(400, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(3200, ctx.currentTime + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      src.stop(ctx.currentTime + 0.65);
    }

    update(dt, car, playing) {
      if (!this.ready) this.ensure();
      if (!this.ready || !car) return;
      const target = playing && this.enabled ? 1 : 0;

      const engFreq = 42 + car.rpm * 130 + car.gear * 6;
      this.engineOsc.frequency.value += (engFreq - this.engineOsc.frequency.value) * Math.min(1, dt * 8);
      this.engineOsc2.frequency.value = this.engineOsc.frequency.value / 2;
      const engVol = target * (0.028 + car.rpm * 0.05 + (car.nitroActive ? 0.03 : 0));
      this.engineGain.gain.value += (engVol - this.engineGain.gain.value) * Math.min(1, dt * 6);

      const windVol = target * Math.pow(car.speedNorm, 1.7) * 0.14;
      this.windGain.gain.value += (windVol - this.windGain.gain.value) * Math.min(1, dt * 4);
      this.windFilter.frequency.value = 500 + car.speedNorm * 1400;

      const driftVol = target * (car.drifting ? 0.12 : 0);
      this.driftGain.gain.value += (driftVol - this.driftGain.gain.value) * Math.min(1, dt * 10);
      this.driftFilter.frequency.value = 1600 + Math.abs(car.slipAngle) * 2400;
    }

    reset() {}
  }

  ND.AudioFx = AudioFx;
})();
