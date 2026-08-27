(function () {
  const SAFE = { minX: -0.68, maxX: 0.68, minY: 0.4, maxY: 0.9 };

  class LyricsManager {
    constructor(scene, cameraSystem) {
      this.scene = scene;
      this.cam = cameraSystem.camera;
      this.enabled = true;
      this.lines = [];
      this.index = -1;
      this.currentEnd = 0;
      this.palette = ND.PaletteSystem.DEFAULT;
      this.pulseScale = 1;

      this.planes = [];
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      mesh.frustumCulled = true;
      scene.add(mesh);
      this.planes.push({ mesh, mat, bornAt: 0, baseY: 0, phase: Math.random() * 6, _lastPulse: 1 });

      ND.bus.on("beat-pulse", s => { this.pulseScale = Math.min(1.18, this.pulseScale + s * 0.09); });

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          if (this._activeText) this._showLine(this._activeText, true);
        });
      }
    }

    loadForTrack(track, durationSec) {
      this.clear();
      if (!this.enabled || !track || track.source === "local" && !track.artist && !track.title) return Promise.resolve(false);
      return ND.LyricsProvider.fetchSynced(track.artist, track.title, durationSec)
        .then(res => {
          this.lines = res.parsed;
          console.info(`[lyrics] ${this.lines.length} lines via ${res.source}`);
          return true;
        })
        .catch(e => {
          console.info("[lyrics]", e.message);
          this.lines = [];
          return false;
        });
    }

    clear() {
      this.lines = [];
      this.index = -1;
      for (const p of this.planes) {
        p.mat.opacity = 0;
        p.mesh.visible = false;
      }
    }

    setEnabled(v) {
      this.enabled = v;
      if (!v) this.clear();
    }

    _drawCanvas(text) {
      const c = document.createElement("canvas");
      c.width = 2048; c.height = 384;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const cssMain = this.palette.cssPrimary || "#ff2fd6";
      text = text.toUpperCase();
      let fontSize = text.length > 34 ? 96 : text.length > 20 ? 128 : 156;
      ctx.font = `900 ${fontSize}px 'Bebas Neue', sans-serif`;

      let lines = [text];
      if (ctx.measureText(text).width > c.width * 0.92) {
        const words = text.split(" ");
        lines = ["", ""];
        let li = 0;
        for (const w of words) {
          const test = lines[li] ? lines[li] + " " + w : w;
          ctx.font = `900 ${fontSize}px 'Bebas Neue', sans-serif`;
          if (ctx.measureText(test).width > c.width * 0.88 && lines[li]) {
            li++;
            if (li > 1) break;
            lines[li] = w;
          } else lines[li] = test;
        }
        fontSize = Math.max(72, Math.floor(fontSize * 0.78));
      }

      ctx.font = `900 ${fontSize}px 'Bebas Neue', sans-serif`;
      const lh = fontSize * 1.14;
      const startY = c.height / 2 - ((lines.length - 1) * lh) / 2;

      for (let li = 0; li < Math.min(2, lines.length); li++) {
        const y = startY + li * lh;
        ctx.shadowColor = cssMain;
        ctx.shadowBlur = 46;
        ctx.fillStyle = cssMain;
        ctx.fillText(lines[li], c.width / 2, y);
        ctx.shadowBlur = 22;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(lines[li], c.width / 2, y);
        ctx.shadowBlur = 0;
      }
      return c;
    }

    _textureFor(text) {
      if (!this._texCache) this._texCache = new Map();
      const key = text + "|" + this.palette.cssPrimary;
      if (this._texCache.has(key)) return this._texCache.get(key);
      const tex = new THREE.CanvasTexture(this._drawCanvas(text));
      tex.encoding = THREE.sRGBEncoding;
      if (this._texCache.size > 24) {
        const firstKey = this._texCache.keys().next().value;
        this._texCache.get(firstKey).dispose();
        this._texCache.delete(firstKey);
      }
      this._texCache.set(key, tex);
      return tex;
    }

    _placeMesh(p, songTime) {
      const cam = this.cam;
      const v = new THREE.Vector3();
      const combos = [];
      for (const D of [80, 105, 135, 170]) {
        for (const ndcY of [0.62, 0.52, 0.72]) {
          for (const ndcX of [0, -0.3, 0.3]) {
            combos.push([D, ndcX, ndcY]);
          }
        }
      }
      for (const [D, ndcX, ndcY] of combos) {
        v.set(ndcX, ndcY, 0.5).unproject(cam);
        const dir = v.sub(cam.position).normalize();
        const pos = cam.position.clone().addScaledVector(dir, D);
        if (pos.z > -35 || pos.y < 7.5) continue;
        p.mesh.position.copy(pos);
        p.baseY = pos.y;
        p.mesh.lookAt(cam.position.x, pos.y * 0.6, cam.position.z);
        const check = pos.clone().project(cam);
        if (check.x < SAFE.minX || check.x > SAFE.maxX || check.y < SAFE.minY || check.y > SAFE.maxY) continue;
        const aspect = p.mesh.material.map.image.width / p.mesh.material.map.image.height;
        const height = THREE.MathUtils.clamp(D * 0.075, 3, 14);
        const width = Math.min(height * aspect, D * 0.34);
        p.mesh.scale.set(width, width / aspect, 1);
        return true;
      }
      return false;
    }

    _showLine(text) {
      this._activeText = text;
      const p = this.planes[0];
      p.mat.map = this._textureFor(text);
      p.mat.needsUpdate = true;
      p.bornAt = performance.now();
      if (!this._placeMesh(p)) {
        p.mesh.visible = false;
        p.mat.opacity = 0;
        return;
      }
      p.mesh.visible = true;
      p.mat.opacity = 0;
    }

    update(songTime, dt, car, curve) {
      this.pulseScale += (1 - this.pulseScale) * Math.min(1, dt * 5);

      while (this.index + 1 < this.lines.length && this.lines[this.index + 1].time <= songTime) {
        this.index++;
        this._showLine(this.lines[this.index].text.slice(0, 64));
      }

      const p = this.planes[0];
      if (!this.lines.length || this.index < 0) {
        if (p.mat.opacity > 0) {
          p.mat.opacity = Math.max(0, p.mat.opacity - dt * 1.6);
          if (p.mat.opacity === 0) p.mesh.visible = false;
        }
        return;
      }

      if (!p.mesh.visible || !car || !curve) return;
      const nextT = this.index + 1 < this.lines.length ? this.lines[this.index + 1].time : this.lines[this.index].time + 6;
      const age = (performance.now() - p.bornAt) / 1000;
      const remaining = nextT - songTime;
      const fadeIn = Math.min(1, age / 0.3);
      const fadeOut = THREE.MathUtils.clamp(remaining / 0.3, 0, 1);
      p.mat.opacity = Math.min(fadeIn, Math.max(0.05, fadeOut)) * 0.96;

      const anchor = car.s + 95;
      const sm = curve.sampleAt(anchor);
      const bob = Math.sin(ND.loop.elapsed * 0.9 + p.phase) * 0.35;
      p.mesh.position.set(sm.x, sm.y + 40 + bob, sm.z);
      p.mesh.lookAt(this.cam.position.x, p.mesh.position.y, this.cam.position.z);

      const pulseK = this.pulseScale;
      const aspect = p.mat.map.image ? p.mat.map.image.width / p.mat.map.image.height : 4;
      const h = 25;
      const w = Math.min(h * aspect, 60);
      p.mesh.scale.set(w * pulseK, h * pulseK, 1);

      if (remaining < -0.4) {
        p.mesh.visible = false;
        p.mat.opacity = 0;
      }
    }

    setPalette(palette) {
      this.palette = palette;
    }
  }

  ND.LyricsManager = LyricsManager;
})();
