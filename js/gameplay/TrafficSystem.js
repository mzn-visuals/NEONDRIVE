(function () {
  class TrafficSystem {
    constructor(scene, curve) {
      this.scene = scene;
      this.curve = curve;
      this.cars = [];
      this.pool = [];
      this.spawnTimer = 0;
      this.enabled = true;
      this.laneCooldown = new Map();
    }

    _acquire() {
      let t = this.pool.pop();
      if (!t) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(1.9, 0.55, 4.2),
          new THREE.MeshStandardMaterial({ color: 0x1a1630, metalness: 0.6, roughness: 0.5 })
        );
        body.position.y = 0.62;
        g.add(body);
        const cabin = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.42, 1.8),
          new THREE.MeshStandardMaterial({ color: 0x0a0c16, metalness: 0.8, roughness: 0.15 })
        );
        cabin.position.set(0, 1.05, 0.2);
        g.add(cabin);
        const tail = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 0.1, 0.06),
          new THREE.MeshBasicMaterial({ color: 0xff2038 })
        );
        tail.position.set(0, 0.75, 2.12);
        g.add(tail);
        this.scene.add(g);
        t = { group: g, s: 0, lat: 0, speed: 0, laneIdx: 0 };
      }
      t.group.visible = true;
      return t;
    }

    _laneSafeAt(plan, songTime, carS, carSpeedMs, t, laneIdx) {
      if (!plan || !plan.length) return true;
      const closing = Math.max(4, carSpeedMs - t.speed);
      const passDt = (t.s - carS) / closing;
      if (passDt < -0.5) return true;
      const tArr = songTime + Math.max(0, passDt);
      let lo = 0, hi = plan.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (plan[mid].t < tArr - 0.8) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < plan.length && plan[i].t <= tArr + 0.8; i++) {
        const ev = plan[i];
        if (ev.tile === "BASS") return false;
        if (ev.lane === laneIdx) return false;
      }
      return true;
    }

    update(dt, car, curve, plan, songTime) {
      if (!this.enabled || !car || !curve) return;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && car.s > 250 && this.cars.length < 5) {
        this.spawnTimer = 3.5 + Math.random() * 5;
        const t = this._acquire();
        t.s = car.s + 240 + Math.random() * 280;
        const lanes = [-1, 1].sort(() => Math.random() - 0.5);
        let placed = false;
        for (const li of lanes) {
          if (this._laneSafeAt(plan, songTime, car.s, car.speedMs, t, li)) {
            t.laneIdx = li;
            placed = true;
            break;
          }
        }
        if (!placed) {
          t.group.visible = false;
          this.pool.push(t);
          return;
        }
        t.lat = [-1.7, 1.7][t.laneIdx + 1];
        t.speed = 17 + Math.random() * 11;
        this.cars.push(t);
      }

      for (let i = this.cars.length - 1; i >= 0; i--) {
        const t = this.cars[i];
        t.s += t.speed * dt;
        if (t.s < car.s - 40 || t.s > car.s + 620) {
          t.group.visible = false;
          this.pool.push(t);
          this.cars.splice(i, 1);
          continue;
        }

        const cdKey = t;
        const cd = (this.laneCooldown.get(cdKey) || 0) - dt;
        if (cd <= 0) {
          const closing = Math.max(4, car.speedMs - t.speed);
          const passDt = (t.s - car.s) / closing;
          if (passDt > 0 && passDt < 1.3 && !this._laneSafeAt(plan, songTime, car.s, car.speedMs, t, t.laneIdx)) {
            const alt = t.laneIdx === -1 ? 1 : -1;
            if (this._laneSafeAt(plan, songTime, car.s, car.speedMs, t, alt)) {
              t.laneIdx = alt;
              this.laneCooldown.set(cdKey, 1.6);
            }
          } else {
            this.laneCooldown.set(cdKey, 0.4);
          }
        }
        const targetLat = [-1.7, 1.7][t.laneIdx + 1];
        t.lat += (targetLat - t.lat) * Math.min(1, dt * 1.8);

        const f = this.curve.frameAt(t.s);
        t.group.position.copy(f.pos).addScaledVector(f.right, t.lat);
        t.group.rotation.set(0, -f.h, 0);

        if (!car.airborne) {
          const dx = car.lat - t.lat;
          const ds = t.s - car.s;
          if (Math.abs(dx) < 1.7 && Math.abs(ds) < 3.6) {
            car.applyImpact(ND.Config.PHYSICS.trafficSpeedLoss, -Math.sign(dx || 1) * 3.0, "traffic");
            ND.bus.emit("toast", "TRAFFIC HIT");
            t.speed += 2;
            t.lat += Math.sign(dx || 1) * 1.2;
          } else if (Math.abs(dx) < 3.1 && ds > 0 && ds < 2.2 && car.speedMs - t.speed > 12) {
            if (!t.nearMissed) {
              t.nearMissed = true;
              ND.bus.emit("near-miss", Math.round(car.speedKmh * 0.9), "traffic");
              car.chargeNitro(8);
            }
          }
        }
      }
    }

    reset() {
      for (const t of this.cars) {
        t.group.visible = false;
        this.pool.push(t);
      }
      this.cars.length = 0;
      this.spawnTimer = 0;
      this.laneCooldown.clear();
    }
  }

  ND.TrafficSystem = TrafficSystem;
})();
