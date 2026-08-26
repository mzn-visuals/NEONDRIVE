(function () {
  const WIN = 1024;
  const HOP = 512;

  const DETECTOR_BANDS = [
    { id: "low",  from: 20,   to: 160 },
    { id: "mid",  from: 300,  to: 2200 },
    { id: "high", from: 4200, to: 15000 }
  ];

  function makeFFT(n) {
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 1; b < n; b <<= 1) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    const cosT = new Float32Array(n / 2), sinT = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cosT[i] = Math.cos(-2 * Math.PI * i / n);
      sinT[i] = Math.sin(-2 * Math.PI * i / n);
    }
    return function (re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const wr = cosT[k], wi = sinT[k];
            const xr = re[j + half], xi = im[j + half];
            const tr = xr * wr - xi * wi;
            const ti = xr * wi + xi * wr;
            re[j + half] = re[j] - tr; im[j + half] = im[j] - ti;
            re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  const Analyzer = {};

  Analyzer.analyze = async function (audioBuffer, onProgress) {
    const sr = audioBuffer.sampleRate;
    const chCount = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;

    const mono = new Float32Array(length);
    for (let c = 0; c < chCount; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / chCount;
    }

    const hann = new Float32Array(WIN);
    for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);

    const fft = makeFFT(WIN);
    const re = new Float32Array(WIN), im = new Float32Array(WIN);
    const binHz = sr / WIN;
    const bins = Math.floor(WIN / 2);

    const bandRanges = DETECTOR_BANDS.map(b => ({
      id: b.id,
      lo: Math.max(1, Math.floor(b.from / binHz)),
      hi: Math.min(bins - 1, Math.ceil(b.to / binHz))
    }));

    const frameCount = Math.max(1, Math.floor((length - WIN) / HOP));
    const flux = { low: new Float32Array(frameCount), mid: new Float32Array(frameCount), high: new Float32Array(frameCount) };
    const rms = new Float32Array(frameCount);
    const prevMag = { low: new Float32Array(bins), mid: new Float32Array(bins), high: new Float32Array(bins) };

    const yieldEvery = 700;

    for (let f = 0; f < frameCount; f++) {
      const off = f * HOP;
      let eSum = 0;
      for (let i = 0; i < WIN; i++) {
        const s = mono[off + i] || 0;
        re[i] = s * hann[i];
        im[i] = 0;
        eSum += s * s;
      }
      rms[f] = Math.sqrt(eSum / WIN);

      fft(re, im);

      for (const br of bandRanges) {
        const arr = flux[br.id];
        let acc = 0;
        for (let b = br.lo; b <= br.hi; b++) {
          const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
          const d = mag - prevMag[br.id][b];
          if (d > 0) acc += d;
          prevMag[br.id][b] = mag;
        }
        arr[f] = acc;
      }

      if ((f & (yieldEvery - 1)) === 0) {
        if (onProgress) onProgress((f / frameCount) * 0.7);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (onProgress) onProgress(0.75);
    await new Promise(r => setTimeout(r, 0));

    const fps = sr / HOP;
    const events = [];
    const lastOnset = { low: -9, mid: -9, high: -9 };
    const minGap = { low: 0.115, mid: 0.085, high: 0.055 };
    const sens = { low: 1.55, mid: 1.65, high: 1.35 };
    const wHalf = Math.round(0.38 * fps);

    for (const br of bandRanges) {
      const arr = flux[br.id];
      const n = arr.length;

      const prefix = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + arr[i];

      for (let i = 2; i < n - 2; i++) {
        const v = arr[i];
        if (v <= 0) continue;
        const lo = Math.max(0, i - wHalf), hi = Math.min(n, i + wHalf);
        const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
        const thr = mean * sens[br.id] + 1e-4;
        if (v < thr) continue;
        if (!(v >= arr[i - 1] && v >= arr[i + 1] && v >= arr[i - 2] && v >= arr[i + 2])) continue;
        const t = i / fps;
        if (t - lastOnset[br.id] < minGap[br.id]) continue;
        lastOnset[br.id] = t;
        const ratio = v / Math.max(mean, 1e-9);
        events.push({ t, band: br.id, flux: v, ratio });
      }
    }

    events.sort((a, b) => a.t - b.t);

    const classified = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      let lowF = ev.band === "low" ? ev.ratio : 0;
      let midF = ev.band === "mid" ? ev.ratio : 0;
      let highF = ev.band === "high" ? ev.ratio : 0;
      for (let j = i + 1; j < events.length && events[j].t - ev.t < 0.03; j++) {
        if (events[j].band === "low") lowF = Math.max(lowF, events[j].ratio);
        else if (events[j].band === "mid") midF = Math.max(midF, events[j].ratio);
        else highF = Math.max(highF, events[j].ratio);
      }

      let type, strength;
      if (lowF >= midF * 1.25 && lowF >= highF * 1.25) {
        type = lowF > 4.2 ? "kick" : "kick";
        strength = Math.min(1, lowF / 6);
      } else if (highF > midF * 1.6 && highF > 1.8) {
        type = "hat";
        strength = Math.min(1, highF / 5);
      } else {
        type = "snare";
        strength = Math.min(1, Math.max(midF, highF) / 5);
      }
      classified.push({ t: ev.t, type, strength: Math.max(0.15, strength) });
    }

    for (let i = 1; i < classified.length;) {
      if (classified[i].t - classified[i - 1].t < 0.03 &&
          classified[i].type !== "hat" && classified[i - 1].type !== "hat") {
        if (classified[i].strength > classified[i - 1].strength) classified.splice(i - 1, 1);
        else classified.splice(i, 1);
      } else i++;
    }

    const secCount = Math.max(1, Math.ceil(audioBuffer.duration));
    const energyCurve = new Float32Array(secCount);
    const cnt = new Float32Array(secCount);
    for (let f = 0; f < frameCount; f++) {
      const s = Math.min(secCount - 1, Math.floor(f / fps));
      energyCurve[s] += rms[f];
      cnt[s] += 1;
    }
    for (let s = 0; s < secCount; s++) energyCurve[s] = cnt[s] ? energyCurve[s] / cnt[s] : 0;
    const smoothed = new Float32Array(secCount);
    for (let s = 0; s < secCount; s++) {
      let acc = 0, c = 0;
      for (let k = Math.max(0, s - 2); k <= Math.min(secCount - 1, s + 2); k++) { acc += energyCurve[k]; c++; }
      smoothed[s] = acc / c;
    }
    const sortedE = Float32Array.from(smoothed).sort();
    const p95 = sortedE[Math.floor(sortedE.length * 0.95)] || 1e-6;
    for (let s = 0; s < secCount; s++) smoothed[s] = Math.min(1, smoothed[s] / p95);

    const bpm = estimateBpm(flux.low, fps);

    const sections = [];
    let runStart = -1;
    for (let s = 0; s < secCount; s++) {
      const hot = smoothed[s] > 0.72;
      if (hot && runStart < 0) runStart = s;
      else if (!hot && runStart >= 0) {
        if (s - runStart >= 4) sections.push({ t: runStart, label: "drop" });
        runStart = -1;
      }
    }
    if (runStart >= 0 && secCount - runStart >= 4) sections.push({ t: runStart, label: "drop" });

    if (onProgress) onProgress(1);

    return {
      events: classified,
      bpm,
      duration: audioBuffer.duration,
      energyCurve: smoothed,
      sections
    };
  };

  function estimateBpm(lowFlux, fps) {
    const n = lowFlux.length;
    if (n < fps * 10) return 120;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += lowFlux[i];
    mean /= n;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.max(0, lowFlux[i] - mean);

    const minLag = Math.floor(fps * 60 / 200);
    const maxLag = Math.floor(fps * 60 / 60);
    let bestLag = 0, bestVal = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0;
      for (let i = 0; i + lag < n; i += 2) acc += env[i] * env[i + lag];
      const norm = acc / (n - lag);
      if (norm > bestVal) { bestVal = norm; bestLag = lag; }
    }
    if (!bestLag) return 120;
    let bpm = 60 * fps / bestLag;
    while (bpm < 85) bpm *= 2;
    while (bpm > 170) bpm /= 2;
    return Math.round(bpm);
  }

  ND.AudioAnalyzer = Analyzer;
})();
