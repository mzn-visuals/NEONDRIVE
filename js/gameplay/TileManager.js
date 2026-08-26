(function () {
  const LANES = ND.Config.LANES_X;

  function makeGlowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  class TileManager {
    constructor(scene) {
      this.scene = scene;
      this.active = [];
      this.pool = [];
      this.glowTex = makeGlowTexture();
      this.palette = ND.PaletteSystem.DEFAULT;

      this.geos = {
        KICK: new THREE.BoxGeometry(2.9, 0.42, 4.6),
        BASS: new THREE.BoxGeometry(11.4, 0.2, 5.2),
        SNARE: new THREE.BoxGeometry(2.3, 0.3, 3.2),
        STANDARD: new THREE.BoxGeometry(2.5, 0.34, 3.8),
        PERC: new THREE.OctahedronGeometry(0.55),
        PERFECT: new THREE.OctahedronGeometry(0.95)
      };

      this.mats = {};
      for (const type of Object.keys(this.geos)) {
        this.mats[type] = new THREE.MeshBasicMaterial({ color: 0xffffff });
      }
      this.mats.MISS = new THREE.MeshBasicMaterial({ color: 0x2a2438 });
      this._applyPalette();
    }

    _applyPalette() {
      const p = this.palette;
      this.mats.KICK.color.copy(p.primary).multiplyScalar(1.5);
      this.mats.BASS.color.copy(p.secondary).multiplyScalar(1.15);
      this.mats.SNARE.color.copy(p.highlight);
      this.mats.STANDARD.color.copy(p.accent).multiplyScalar(1.4);
      this.mats.PERC.color.copy(p.secondary).multiplyScalar(1.7);
      this.mats.PERFECT.color.setRGB(1.4, 1.25, 0.85);
    }

    setPalette(palette) {
      this.palette = palette;
      this._applyPalette();
    }

    _acquire(type) {
      let tile = this.pool.pop();
      if (!tile) {
        const mesh = new THREE.Mesh(this.geos[type], this.mats[type]);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0.65,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        }));
        glow.scale.set(5, 5, 1);
        this.scene.add(mesh);
        this.scene.add(glow);
        tile = { mesh, glow, type, hitTime: 0, laneX: 0, state: "idle", judged: false, animT: 0 };
      } else {
        tile.mesh.geometry = this.geos[type];
        tile.mesh.material = this.mats[type];
        tile.type = type;
      }
      return tile;
    }

    spawn(planEvent, carS, curve) {
      const tile = this._acquire(planEvent.tile);
      tile.hitTime = planEvent.t;
      tile.laneX = planEvent.lane === null ? 0 : LANES[planEvent.lane + 1];
      tile.state = "approach";
      tile.judged = false;
      tile.animT = 0;
      tile.spin = planEvent.tile === "PERFECT" || planEvent.tile === "PERC";

      const isBass = planEvent.tile === "BASS";
      const lat = isBass ? 0 : tile.laneX;
      const sm = curve.sampleAt(carS + 60);
      tile.mesh.position.set(sm.x, sm.y + 0.35, sm.z);
      tile.mesh.visible = true;
      tile.glow.visible = true;

      const glowColor = this.mats[planEvent.tile].color;
      tile.glow.material.color.copy(glowColor);
      const gs = planEvent.tile === "PERFECT" ? 8 : planEvent.tile === "PERC" ? 3.2 : 5.5;
      tile.glow.scale.set(gs, gs, 1);
      tile.glow.material.opacity = 0.65;
      tile.mesh.scale.set(1, 1, 1);
      tile.mesh.position.y = 0.35;
      this.active.push(tile);
      return tile;
    }

    update(songTime, carS, speedMs, dt, curve) {
      const goodWindow = ND.Config.TIMING_WINDOWS.GOOD;

      for (let i = this.active.length - 1; i >= 0; i--) {
        const tile = this.active[i];
        const dtToHit = tile.hitTime - songTime;

        if (tile.state === "approach") {
          const tileS = carS + Math.max(-30, dtToHit * speedMs);
          const isBass = tile.type === "BASS";
          const lat = isBass ? 0 : tile.laneX;
          const sm = curve.sampleAt(tileS);
          const rx = Math.cos(sm.h), rz = Math.sin(sm.h);
          tile.mesh.position.set(
            sm.x + rx * lat,
            sm.y + lat * Math.sin(sm.bank) * 0.5 + 0.35,
            sm.z + rz * lat
          );
          tile.mesh.rotation.set(0, -sm.h, 0);
          if (tile.spin) {
            tile.mesh.rotateY(ND.loop.elapsed * 4);
            tile.mesh.rotateX(Math.PI / 4);
          }

          const approach = THREE.MathUtils.clamp(1 - dtToHit / 1.4, 0, 1);
          const pulse = 1 + approach * 0.22 + Math.sin(ND.loop.elapsed * 12 + tile.hitTime * 10) * 0.03;
          tile.mesh.scale.set(pulse, pulse, pulse);
          tile.glow.material.opacity = 0.45 + approach * 0.5;
          tile.glow.position.copy(tile.mesh.position);
        } else if (tile.state === "hit") {
          tile.animT += dt;
          const k = tile.animT / 0.28;
          if (k >= 1) {
            this._retire(i);
            continue;
          }
          const s = 1 + k * (tile.type === "PERFECT" ? 2.4 : 1.6);
          tile.mesh.scale.set(s, s, s);
          tile.mesh.position.y += speedMs * dt * 0.35;
          tile.glow.material.opacity = 0.9 * (1 - k);
          tile.glow.position.copy(tile.mesh.position);
          tile.mesh.visible = k < 0.85;
        } else if (tile.state === "miss") {
          tile.animT += dt;
          const k = tile.animT / 0.5;
          if (k >= 1) {
            this._retire(i);
            continue;
          }
          tile.mesh.position.y -= dt * 3;
          const s = Math.max(0.001, 1 - k);
          tile.mesh.scale.set(s, s, s);
          tile.glow.material.opacity = 0.15 * (1 - k);
          tile.glow.position.copy(tile.mesh.position);
        }

        if (tile.state === "approach" && !tile.judged && -dtToHit > goodWindow) {
          tile.state = "miss";
          tile.animT = 0;
          tile.judged = true;
          tile.mesh.material = this.mats.MISS;
          tile.glow.material.opacity = 0.15;
          ND.bus.emit("tile-missed", tile);
        }
      }

      if (this.active.length > 90) {
        console.warn("[tiles] overflow");
      }
    }

    _retire(i) {
      const tile = this.active[i];
      tile.mesh.visible = false;
      tile.glow.visible = false;
      tile.state = "idle";
      tile.mesh.scale.set(1, 1, 1);
      tile.glow.material.opacity = 0.65;
      this.active.splice(i, 1);
      this.pool.push(tile);
    }

    judgeHit(tile, quality) {
      if (tile.state !== "approach") return false;
      tile.state = "hit";
      tile.animT = 0;
      tile.judged = true;
      tile.glow.material.opacity = 0.95;
      return true;
    }

    reset() {
      for (let i = this.active.length - 1; i >= 0; i--) {
        this._retire(i);
      }
      this.active.length = 0;
    }

    get upcomingCount() {
      let n = 0;
      for (const t of this.active) if (t.state === "approach") n++;
      return n;
    }
  }

  ND.TileManager = TileManager;
})();
