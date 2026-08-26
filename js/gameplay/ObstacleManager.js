(function () {
  const C = ND.Config;
  const LANES = C.LANES_X;

  class ObstacleManager {
    constructor(scene) {
      this.scene = scene;
      this.obstacles = [];
      this.pool = { cone: [], barrier: [], wreck: [] };
      this.spawnTimer = 3;
      this.sparks = null;
      this._buildSparks();
    }

    _buildSparks() {
      const geo = new THREE.BufferGeometry();
      const N = 60;
      this.sparkPos = new Float32Array(N * 3);
      this.sparkVel = new Float32Array(N * 3);
      this.sparkLife = new Float32Array(N);
      geo.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
      this.sparkMat = new THREE.PointsMaterial({
        color: 0xffd166, size: 0.16, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.sparks = new THREE.Points(geo, this.sparkMat);
      this.sparks.frustumCulled = false;
      this.scene.add(this.sparks);
      this._sparkIdx = 0;
    }

    burst(worldPos, count = 14) {
      for (let i = 0; i < count; i++) {
        const idx = this._sparkIdx = (this._sparkIdx + 1) % 60;
        this.sparkPos[idx * 3] = worldPos.x;
        this.sparkPos[idx * 3 + 1] = worldPos.y + 0.4;
        this.sparkPos[idx * 3 + 2] = worldPos.z;
        this.sparkVel[idx * 3] = (Math.random() - 0.5) * 9;
        this.sparkVel[idx * 3 + 1] = Math.random() * 7 + 2;
        this.sparkVel[idx * 3 + 2] = (Math.random() - 0.5) * 9;
        this.sparkLife[idx] = 0.5 + Math.random() * 0.3;
      }
    }

    _laneSafeAt(plan, songTime, carS, s, laneIdx, speedMs) {
      if (!plan || !plan.length) return true;
      const tArr = songTime + Math.max(0, s - carS) / Math.max(speedMs, 8);
      let lo = 0, hi = plan.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (plan[mid].t < tArr - 1.2) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < plan.length && plan[i].t <= tArr + 1.2; i++) {
        const ev = plan[i];
        if (ev.tile === "BASS") return false;
        if (ev.lane === laneIdx) return false;
      }
      return true;
    }

    _acquire(type) {
      let g = this.pool[type].pop();
      if (!g) {
        g = new THREE.Group();
        if (type === "cone") {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.85, 8), new THREE.MeshLambertMaterial({ color: 0xff7a2a }));
          cone.position.y = 0.42;
          g.add(cone);
          const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.26, 0.16, 8), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
          stripe.position.y = 0.5;
          g.add(stripe);
        } else if (type === "barrier") {
          const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.35), new THREE.MeshLambertMaterial({ color: 0x2c2440 }));
          body.position.y = 0.45;
          g.add(body);
          const glow = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.4), new THREE.MeshBasicMaterial({ color: 0xffb02a }));
          glow.position.y = 0.86;
          g.add(glow);
        } else {
          const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 4.3), new THREE.MeshLambertMaterial({ color: 0x1a1424 }));
          body.position.y = 0.55;
          body.rotation.z = 0.09;
          g.add(body);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.6), new THREE.MeshLambertMaterial({ color: 0x1a1424 }));
          cab.position.set(0, 1.3, 0.3);
          g.add(cab);
        }
        this.scene.add(g);
      }
      g.visible = true;
      return g;
    }

    update(dt, car, curve, track, plan, songTime) {
      for (let i = 0; i < 60; i++) {
        if (this.sparkLife[i] <= 0) continue;
        this.sparkLife[i] -= dt;
        this.sparkVel[i * 3 + 1] -= 22 * dt;
        this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
        this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -999;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;

      if (!car || !curve) return;

      this.spawnTimer -= dt;
      this.revalidateTimer = (this.revalidateTimer || 0) - dt;
      if (this.revalidateTimer <= 0) {
        this.revalidateTimer = 0.5;
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
          const ob = this.obstacles[i];
          if (ob.hit) continue;
          const dist = ob.s - car.s;
          if (dist > 150) {
            let li = -2;
            for (let k = 0; k < 3; k++) if (C.LANES_X[k] === ob.lat) li = k - 1;
            if (!this._laneSafeAt(plan, songTime, car.s, ob.s, li, car.speedMs)) {
              ob.mesh.visible = false;
              this.pool[ob.type].push(ob.mesh);
              this.obstacles.splice(i, 1);
            }
          }
        }
      }
      if (this.spawnTimer <= 0 && car.s > 200 && this.obstacles.length < 5 && !car.airborne) {
        this.spawnTimer = 2.4 + Math.random() * 2.6;
        const s = car.s + 270;
        const rampFree = !track.getRampAt(s, -3.4) && !track.getRampAt(s, 0) && !track.getRampAt(s, 3.4);
        if (rampFree) {
          const order = [-1, 0, 1].sort(() => Math.random() - 0.5);
          for (const li of order) {
            if (!this._laneSafeAt(plan, songTime, car.s, s, li, car.speedMs)) continue;
            const roll = Math.random();
            const type = roll > 0.8 ? "wreck" : roll > 0.5 ? "barrier" : "cone";
            const mesh = this._acquire(type);
            const f = curve.frameAt(s);
            mesh.position.copy(f.pos).addScaledVector(f.right, C.LANES_X[li + 1]);
            mesh.position.y += C.LANES_X[li + 1] * Math.sin(f.bank) * 0.5;
            mesh.rotation.set(0, -f.h, 0);
            this.obstacles.push({ s, lat: C.LANES_X[li + 1], type, mesh, hit: false, nearMissed: false });
            break;
          }
        }
      }

      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const ob = this.obstacles[i];
        if (ob.s < car.s - 40) {
          ob.mesh.visible = false;
          this.pool[ob.type].push(ob.mesh);
          this.obstacles.splice(i, 1);
          continue;
        }
        if (ob.hit || car.airborne) continue;
        const dx = car.lat - ob.lat;
        const halfW = ob.type === "cone" ? 0.75 : ob.type === "barrier" ? 1.55 : 1.35;
        if (Math.abs(dx) < halfW && Math.abs(car.s - ob.s) < 2.2) {
          ob.hit = true;
          ob.mesh.visible = false;
          const wp = new THREE.Vector3();
          curve.worldPos(ob.s, ob.lat, wp);
          if (ob.type === "cone") {
            car.applyImpact(C.PHYSICS.coneSpeedLoss, -Math.sign(dx) * 1.4, "cone");
            this.burst(wp, 10);
          } else if (ob.type === "barrier") {
            car.applyImpact(C.PHYSICS.collisionSpeedLoss, -Math.sign(dx) * 3.4, "barrier");
            this.burst(wp, 20);
          } else {
            car.applyImpact(C.PHYSICS.collisionSpeedLoss * 1.3, -Math.sign(dx) * 4.2, "wreck");
            this.burst(wp, 26);
          }
        } else if (!ob.nearMissed && Math.abs(dx) < halfW + 1.5 && Math.abs(car.s - ob.s) < 1.2 && car.speedKmh > 90) {
          ob.nearMissed = true;
          ND.bus.emit("near-miss", Math.round(car.speedKmh * 0.8), ob.type);
          car.chargeNitro(6);
        }
      }
    }

    reset() {
      for (const ob of this.obstacles) {
        ob.mesh.visible = false;
        this.pool[ob.type].push(ob.mesh);
      }
      this.obstacles.length = 0;
      this.spawnTimer = 3;
    }
  }

  ND.ObstacleManager = ObstacleManager;
})();
