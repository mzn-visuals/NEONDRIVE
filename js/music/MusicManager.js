(function () {
  async function rangedDownload(url, onProgress) {
    const CHUNK = 1 << 20;
    let start = 0;
    let total = null;
    const chunks = [];
    for (let guard = 0; guard < 512; guard++) {
      const end = total != null ? Math.min(start + CHUNK, total) - 1 : start + CHUNK - 1;
      const res = await ND.fetchWithTimeout(url, { headers: { Range: `bytes=${start}-${end}` } }, 30000);
      if (!res.ok && res.status !== 206) throw new Error(`stream download failed (${res.status})`);
      const buf = await res.arrayBuffer();
      if (!buf.byteLength) throw new Error("stream download stalled");
      chunks.push(buf);
      start += buf.byteLength;
      if (total == null) {
        const cr = res.headers.get("Content-Range");
        if (cr) {
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) total = parseInt(m[1], 10);
        }
        if (res.status === 200) break;
      }
      onProgress && onProgress(total ? Math.min(1, start / total) : 0);
      if (total != null && start >= total) break;
    }
    const out = new Uint8Array(start);
    let off = 0;
    for (const c of chunks) {
      out.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    return out.buffer;
  }

  class MusicManager {
    constructor() {
      this.engine = new ND.AudioEngine();
      this.current = null;
      this.streamUrl = null;
      this.analysis = null;
      this.timeline = null;
      this._unlockBound = false;
      this._bindUnlock();
    }

    _bindUnlock() {
      if (this._unlockBound) return;
      this._unlockBound = true;
      const unlock = () => {
        if (this.engine.ctx && this.engine.ctx.state === "suspended") {
          this.engine.resume().catch(() => {});
        }
        if (this.current && this.audioEl.paused) {
          this.audioEl.play().catch(() => {});
        }
      };
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);
      window.addEventListener("touchstart", unlock);
    }

    get audioEl() { return this.engine.audioEl; }

    clock() {
      const el = this.audioEl;
      return Number.isFinite(el.currentTime) ? el.currentTime : 0;
    }

    duration() {
      const el = this.audioEl;
      return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (this.analysis?.duration || 0);
    }

    remaining() { return Math.max(0, this.duration() - this.clock()); }

    async prepare(track, provider, onStage, onProgress) {
      onStage && onStage("fetch", 0);
      const url = await provider.resolveAudioUrl(track);
      let arrayBuffer;
      if (provider.canFetchForAnalysis() && !url.startsWith("blob:") && !url.startsWith("data:")) {
        try {
          arrayBuffer = await rangedDownload(url, p => onStage && onStage("fetch", p));
        } catch (e) {
          console.warn("[fetch] ranged failed, falling back:", e.message);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`stream download failed (${res.status})`);
          arrayBuffer = await res.arrayBuffer();
        }
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`stream download failed (${res.status})`);
        arrayBuffer = await res.arrayBuffer();
        onStage && onStage("fetch", 1);
      }

      onStage && onStage("analyze", 0.02);
      const audioBuffer = await this.engine.decode(arrayBuffer);
      const analysis = await ND.AudioAnalyzer.analyze(audioBuffer, p => {
        onStage && onStage("analyze", p);
      });

      return { track, url, audioBuffer, analysis };
    }

    async play(prepared) {
      this.current = prepared.track;
      this.streamUrl = prepared.url;
      this.analysis = prepared.analysis;
      this.timeline = new ND.RhythmTimeline(prepared.analysis.events, prepared.analysis.energyCurve);

      const el = this.audioEl;
      el.src = prepared.url;
      el.load();
      await this.engine.resume();
      try {
        await el.play();
      } catch (e) {
        console.warn("play blocked:", e);
      }
      if (this.engine.ctx.state !== "running") {
        this.engine.ctx.onstatechange = () => {
          if (this.engine.ctx.state === "running" && this.current && el.paused) {
            el.play().catch(() => {});
          }
        };
      }
      prepared.audioBuffer = null;
      return prepared;
    }

    pause() { this.audioEl.pause(); }
    resumePlayback() { return this.audioEl.play().catch(() => {}); }

    stop() {
      const el = this.audioEl;
      el.pause();
      el.removeAttribute("src");
      el.load();
      this.current = null;
      this.analysis = null;
      this.timeline = null;
    }

    bands() { return this.engine.updateBands(); }
    energyAt(t) { return this.timeline ? this.timeline.energyAt(t) : 0; }
  }

  ND.MusicManager = MusicManager;
})();
