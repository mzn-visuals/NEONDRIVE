(function () {
  class Weather {
    constructor(scene, renderer) {
      this.scene = scene;
      this.renderer = renderer;
      this.id = "clear";
      this.fogDensityScale = 1;
      this.lightningTimer = 0;
      this.flashValue = 0;
      this.wetness = 0;
      this.skyRef = null;
      this._buildParticles();
    }

    _buildParticles() {
      const maxRain = 2600;
      this.rainPos = new Float32Array(maxRain * 2 * 3);
      this.rainData = new Float32Array(maxRain * 4);
      for (let i = 0; i < maxRain; i++) {
        this.rainData[i * 4] = (Math.random() - 0.5) * 80;
        this.rainData[i * 4 + 1] = Math.random() * 36;
        this.rainData[i * 4 + 2] = -Math.random() * 120 + 10;
        this.rainData[i * 4 + 3] = 0.7 + Math.random() * 0.7;
      }
      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
      this.rainMat = new THREE.LineBasicMaterial({
        color: 0x9fc8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.rainLines = new THREE.LineSegments(rainGeo, this.rainMat);
      this.rainLines.frustumCulled = false;
      this.scene.add(this.rainLines);

      const maxMist = 900;
      this.mistPos = new Float32Array(maxMist * 3);
      this.mistData = new Float32Array(maxMist * 4);
      for (let i = 0; i < maxMist; i++) {
        this.mistData[i * 4] = (Math.random() - 0.5) * 90;
        this.mistData[i * 4 + 1] = Math.random() * 14 + 0.5;
        this.mistData[i * 4 + 2] = -Math.random() * 120 + 10;
        this.mistData[i * 4 + 3] = 0.4 + Math.random() * 0.8;
      }
      const mistGeo = new THREE.BufferGeometry();
      mistGeo.setAttribute("position", new THREE.BufferAttribute(this.mistPos, 3));
      this.mistMat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.65, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
      });
      this.mistPoints = new THREE.Points(mistGeo, this.mistMat);
      this.mistPoints.frustumCulled = false;
      this.scene.add(this.mistPoints);

      this.mode = "none";
      this.activeCount = 0;
    }

    apply(weatherId, palette) {
      this.id = weatherId;
      const p = this.renderer.particleScale || 1;
      const map = {
        "clear":       { rain: 0,    mist: 0,   fog: 1.0, wet: 0,   speed: 1 },
        "fog":         { rain: 0,    mist: 160, fog: 6.0, wet: 0.1, speed: 0.4 },
        "rain":        { rain: 800,  mist: 0,   fog: 1.6, wet: .7,  speed: 1.6 },
        "heavy-rain":  { rain: 1600, mist: 0,   fog: 2.2, wet: 1,   speed: 2.1 },
        "storm":       { rain: 2000, mist: 0,   fog: 2.6, wet: 1,   speed: 2.4 },
        "dust":        { rain: 0,    mist: 420, fog: 5.0, wet: 0,   speed: 0.35 },
        "neon-mist":   { rain: 0,    mist: 380, fog: 4.6, wet: .25, speed: 0.25 }
      };
      const cfg = map[weatherId] || map.clear;
      this.cfg = cfg;
      this.fogDensityScale = cfg.fog;
      this.wetness = cfg.wet;

      if (cfg.rain > 0) {
        this.mode = "rain";
        this.activeCount = Math.min(Math.floor(cfg.rain * p), this.rainData.length / 4);
        this.rainLines.visible = true;
        this.mistPoints.visible = false;
        this.mistMat.opacity = 0;
        this.rainMat.opacity = weatherId === "storm" ? 0.5 : weatherId === "heavy-rain" ? 0.42 : 0.32;
        this.rainMat.color.set(0x9fc8ff);
      } else if (cfg.mist > 0) {
        this.mode = "mist";
        this.activeCount = Math.min(Math.floor(cfg.mist * p), this.mistData.length / 4);
        this.rainLines.visible = false;
        this.mistPoints.visible = true;
        this.rainMat.opacity = 0;
        this.mistMat.size = weatherId === "dust" ? 0.8 : 0.6;
        if (weatherId === "dust") this.mistMat.color.copy(ND.srgb("#c89a5e"));
        else if (weatherId === "neon-mist") this.mistMat.color.copy(palette ? palette.primary : ND.srgb("#ff2fd6"));
        else this.mistMat.color.set(0xffffff);
        this.mistMat.opacity = weatherId === "dust" ? 0.28 : weatherId === "neon-mist" ? 0.3 : 0.16;
      } else {
        this.mode = "none";
        this.activeCount = 0;
        this.rainLines.visible = false;
        this.mistPoints.visible = false;
      }
    }

    update(dt, energy, carPos) {
      if (carPos) {
        this.rainLines.position.set(carPos.x, 0, carPos.z);
        this.mistPoints.position.set(carPos.x, 0, carPos.z);
      }
      if (this.mode === "none" || !this.activeCount) return;

      if (this.mode === "rain") {
        const pos = this.rainPos;
        const n = this.activeCount;
        const fall = this.cfg.speed * 34;
        for (let i = 0; i < n; i++) {
          let y = this.rainData[i * 4 + 1] - fall * this.rainData[i * 4 + 3] * dt;
          if (y < -0.5) {
            y = 30 + Math.random() * 10;
            this.rainData[i * 4] = (Math.random() - 0.5) * 80;
            this.rainData[i * 4 + 2] = -Math.random() * 120 + 10;
          }
          this.rainData[i * 4 + 1] = y;
          const x = this.rainData[i * 4], z = this.rainData[i * 4 + 2];
          const slant = this.cfg.speed * 0.06;
          const len = 0.55 + this.rainData[i * 4 + 3] * 0.75;
          pos[i * 6] = x; pos[i * 6 + 1] = y + len; pos[i * 6 + 2] = z - len * slant;
          pos[i * 6 + 3] = x; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z;
        }
        this.rainLines.geometry.attributes.position.needsUpdate = true;
      } else {
        const pos = this.mistPos;
        const n = this.activeCount;
        const drift = this.cfg.speed * 3.2;
        for (let i = 0; i < n; i++) {
          let y = this.mistData[i * 4 + 1] - drift * this.mistData[i * 4 + 3] * dt * 0.35;
          let x = this.mistData[i * 4] + Math.sin(ND.loop.elapsed * 0.6 + i) * drift * dt;
          if (y < 0.2) {
            y = 10 + Math.random() * 6;
            this.mistData[i * 4] = (Math.random() - 0.5) * 90;
            this.mistData[i * 4 + 2] = -Math.random() * 120 + 10;
          }
          this.mistData[i * 4 + 1] = y;
          this.mistData[i * 4] = x;
          pos[i * 3] = x;
          pos[i * 3 + 1] = y;
          pos[i * 3 + 2] = this.mistData[i * 4 + 2];
        }
        this.mistPoints.geometry.attributes.position.needsUpdate = true;
      }

      if (this.id === "storm") {
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0 && Math.random() < dt * 0.22) {
          this.lightningTimer = 2 + Math.random() * 5;
          this.flashValue = 0.85;
          ND.bus.emit("lightning");
        }
      }
      if (this.flashValue > 0) {
        this.flashValue = Math.max(0, this.flashValue - dt * 2.6);
        if (this.skyRef) this.skyRef.flash(this.flashValue * 0.55);
      }
    }
  }

  ND.Weather = Weather;
})();
