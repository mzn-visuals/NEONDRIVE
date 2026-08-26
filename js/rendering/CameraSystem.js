(function () {
  const MODE_DEFS = {
    chase:   { dist: 7.2, height: 2.5, fov: 0,   stiff: 5.5 },
    close:   { dist: 5.2, height: 1.85, fov: 3, stiff: 6.5 },
    far:     { dist: 10.5, height: 3.7, fov: -4, stiff: 4.4 },
    hood:    { fov: 5 },
    cockpit: { fov: 3 },
    front:   { fov: 0 },
    rear:    { fov: 7 }
  };

  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }

  class CameraSystem {
    constructor(settings) {
      this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 1700);
      this.mode = settings.camera || "chase";
      this.fovScale = settings.fovScale != null ? settings.fovScale : 1;
      this.shakeLevel = settings.shake != null ? settings.shake : 1;
      this.shake = 0;
      this.dropKick = 0;
      this.landDip = 0;
      this._pos = new THREE.Vector3(0, 3, 8);
      this._look = new THREE.Vector3();
      this._lookCur = new THREE.Vector3(0, 1, -10);
      this._velDir = new THREE.Vector3(0, 0, -1);
      this._prevCarPos = new THREE.Vector3();
      this._init = false;
      this.wormBlend = 0;
      this._wormTarget = 0;
      ND.bus.on("renderer-resize", () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
      });
    }

    setMode(m) {
      if (MODE_DEFS[m]) {
        this.mode = m;
        this._init = false;
      }
    }
    cycleMode() {
      const keys = Object.keys(MODE_DEFS);
      const i = keys.indexOf(this.mode);
      this.mode = keys[(i + 1) % keys.length];
      this._init = false;
      ND.bus.emit("toast", "CAMERA · " + this.mode.toUpperCase());
      return this.mode;
    }
    addShake(amount) {
      this.shake = Math.min(this.shake + amount * this.shakeLevel, 1.2);
    }
    kickFov(amount) { this.dropKick = Math.min(this.dropKick + amount, 12); }
    setWormBlend(target) { this._wormTarget = target ? 1 : 0; }

    update(dt, car, curve, ctx) {
      const cam = this.camera;
      if (ctx === "showroom") return;

      this.shake *= Math.pow(0.002, dt);
      this.dropKick *= Math.pow(0.02, dt);
      this.landDip *= Math.pow(0.01, dt);

      const carPos = car.mesh.group.position;

      let vx = carPos.x - this._prevCarPos.x;
      let vz = carPos.z - this._prevCarPos.z;
      const vLen = Math.hypot(vx, vz);
      if (vLen > 0.001) {
        this._velDir.set(vx / vLen, 0, vz / vLen);
      } else {
        const sm = curve.sampleAt(car.s);
        this._velDir.set(Math.sin(sm.h), 0, -Math.cos(sm.h));
      }
      this._prevCarPos.copy(carPos);

      const def = MODE_DEFS[this.mode] || MODE_DEFS.chase;
      const sm = curve.sampleAt(car.s);
      const carYaw = sm.h + car.yawRel;
      const rX = Math.cos(carYaw), rZ = Math.sin(carYaw);
      const fwdX = Math.sin(carYaw), fwdZ = -Math.cos(carYaw);

      const shakeAmp = this.shake * 0.35;
      const sx = (Math.random() - 0.5) * shakeAmp;
      const sy = (Math.random() - 0.5) * shakeAmp * 0.6;

      this.wormBlend += (this._wormTarget - this.wormBlend) * Math.min(1, dt * 2.2);
      const wb = this.wormBlend;

      if (this.mode === "chase" || this.mode === "close" || this.mode === "far") {
        const back = curve.frameAt(car.s - def.dist);
        const brx = Math.cos(back.h), brz = Math.sin(back.h);
        const desiredX = back.pos.x + brx * car.lat + sx * (1 - wb);
        const desiredZ = back.pos.z + brz * car.lat;
        const desiredY = back.pos.y + car.lat * Math.sin(back.bank) * 0.5 + def.height + sy * (1 - wb * 0.8) - this.landDip * 1.1;

        if (!this._init) {
          this._pos.set(desiredX, desiredY, desiredZ);
          this._init = true;
        }
        const stiff = def.stiff + car.speedNorm * 1.2;
        this._pos.x = damp(this._pos.x, desiredX, stiff, dt);
        this._pos.y = damp(this._pos.y, desiredY, 7, dt);
        this._pos.z = damp(this._pos.z, desiredZ, stiff, dt);
        cam.position.copy(this._pos);

        const lookX = carPos.x + fwdX * 5 + sx * 0.3 * (1 - wb);
        const lookY = carPos.y + 1.0;
        const lookZ = carPos.z + fwdZ * 5;
        this._lookCur.x = damp(this._lookCur.x, lookX, 10, dt);
        this._lookCur.y = damp(this._lookCur.y, lookY, 8, dt);
        this._lookCur.z = damp(this._lookCur.z, lookZ, 10, dt);
        cam.lookAt(this._lookCur);

        const bank = (1 - wb) * THREE.MathUtils.clamp(-car.latVel * 0.005 - sm.bank * 0.15, -0.035, 0.035);
        cam.rotation.z += bank;
      } else if (this.mode === "hood") {
        cam.position.set(
          carPos.x + fwdX * 1.15 + sx * 0.25,
          carPos.y + 1.02 + sy * 0.35 - this.brakeDip(car) * 0.05,
          carPos.z + fwdZ * 1.15
        );
        this._look.set(
          carPos.x + fwdX * 42,
          carPos.y + 0.85 + curve.elevationAt(car.s + 42) - sm.y,
          carPos.z + fwdZ * 42
        );
        cam.lookAt(this._look);
        cam.rotation.z += -car.steerAngle * 0.3 + sm.bank * 0.5;
      } else if (this.mode === "cockpit") {
        const eye = (car.mesh && car.mesh.cockpit) || { x: 0.32, y: carPos.y + 1.32, z: car.s };
        const lx = Math.cos(carYaw), lz = Math.sin(carYaw);
        cam.position.set(
          carPos.x + lx * eye.x + fwdX * (-eye.z) + sx * 0.12,
          carPos.y + eye.y + sy * 0.18 - this.brakeDip(car) * 0.035 + car.suspHeave * 0.35,
          carPos.z + lz * eye.x + fwdZ * (-eye.z)
        );
        this._look.set(
          cam.position.x + fwdX * 40,
          cam.position.y - 0.55 + curve.elevationAt(car.s + 40) - sm.y,
          cam.position.z + fwdZ * 40
        );
        cam.lookAt(this._look);
        cam.rotation.z += sm.bank * 0.6 - car.steerAngle * 0.08;
      } else if (this.mode === "front") {
        cam.position.set(carPos.x + fwdX * 7, carPos.y + 1.55, carPos.z + fwdZ * 7);
        this._lookCur.copy(carPos);
        this._lookCur.y += 0.6;
        cam.lookAt(this._lookCur);
      } else if (this.mode === "rear") {
        cam.position.set(carPos.x - fwdX * 0.3, carPos.y + 1.5, carPos.z - fwdZ * 0.3);
        this._look.set(carPos.x - fwdX * 30, carPos.y + 0.9, carPos.z - fwdZ * 30);
        cam.lookAt(this._look);
      }

      const speedFov = 62 + car.speedNorm * 17 * this.fovScale;
      const nitroFov = car.nitroActive ? 6 * this.fovScale : 0;
      const targetFov = def.fov + speedFov + nitroFov + this.dropKick;
      if (Math.abs(cam.fov - targetFov) > 0.01) {
        cam.fov = damp(cam.fov, targetFov, 3.4, dt);
        cam.updateProjectionMatrix();
      }
    }

    brakeDip(car) {
      return car && car.braking ? 1 : 0;
    }
  }

  ND.CameraSystem = CameraSystem;
})();
