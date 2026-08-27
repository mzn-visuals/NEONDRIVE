(function () {
  const MODE_DEFS = {
    chase:   { dist: 6.5, height: 2.2, fov: 0,   stiff: 4.5, pitch: -0.15 },
    close:   { dist: 4.5, height: 1.5, fov: 2,   stiff: 5.5, pitch: -0.12 },
    far:     { dist: 12,  height: 4.2, fov: -3,  stiff: 3.8, pitch: -0.18 },
    hood:    { fov: 4, pitch: -0.08 },
    cockpit: { fov: 2, pitch: -0.05 }
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
      this.rearView = false;
      ND.bus.emit("toast", "CAMERA · " + this.mode.toUpperCase());
      return this.mode;
    }
    addShake(amount) {
      this.shake = Math.min(this.shake + amount * this.shakeLevel, 1.2);
    }
    kickFov(amount) { this.dropKick = Math.min(this.dropKick + amount, 12); }
    setWormBlend(target) { this._wormTarget = target ? 1 : 0; }
    toggleRearView() {
      this.rearView = !this.rearView;
      this._init = false;
      ND.bus.emit("toast", this.rearView ? "REAR VIEW" : "CAMERA · " + this.mode.toUpperCase());
    }

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
      const isRear = this.rearView;

      const shakeAmp = this.shake * 0.35;
      const sx = (Math.random() - 0.5) * shakeAmp;
      const sy = (Math.random() - 0.5) * shakeAmp * 0.6;

      this.wormBlend += (this._wormTarget - this.wormBlend) * Math.min(1, dt * 2.2);
      const wb = this.wormBlend;

      if (this.mode === "chase" || this.mode === "close" || this.mode === "far") {
        const camDist = isRear ? -def.dist * 0.6 : def.dist;
        const back = curve.frameAt(car.s - camDist);
        const brx = Math.cos(back.h), brz = Math.sin(back.h);
        const desiredX = back.pos.x + brx * car.lat + sx * (1 - wb);
        const desiredZ = back.pos.z + brz * car.lat;
        const desiredY = back.pos.y + car.lat * Math.sin(back.bank) * 0.5 + def.height + sy * (1 - wb * 0.8) - this.landDip * 1.1;

        if (!this._init) {
          this._pos.set(desiredX, desiredY, desiredZ);
          this._init = true;
        }
        const stiff = def.stiff + car.speedNorm * 1.5;
        this._pos.x = damp(this._pos.x, desiredX, stiff, dt);
        this._pos.y = damp(this._pos.y, desiredY, 6, dt);
        this._pos.z = damp(this._pos.z, desiredZ, stiff, dt);
        cam.position.copy(this._pos);

        const lookDist = isRear ? -30 : 8;
        const lookX = carPos.x + fwdX * lookDist + sx * 0.3 * (1 - wb);
        const lookY = carPos.y + (isRear ? 0.8 : 1.2);
        const lookZ = carPos.z + fwdZ * lookDist;
        this._lookCur.x = damp(this._lookCur.x, lookX, 12, dt);
        this._lookCur.y = damp(this._lookCur.y, lookY, 9, dt);
        this._lookCur.z = damp(this._lookCur.z, lookZ, 12, dt);
        cam.lookAt(this._lookCur);

        const bank = (1 - wb) * THREE.MathUtils.clamp(-car.latVel * 0.006 - sm.bank * 0.18, -0.04, 0.04);
        cam.rotation.z += bank;
      } else if (this.mode === "hood") {
        const hoodOffset = isRear ? -0.8 : 1.3;
        const lookDist = isRear ? -35 : 45;
        cam.position.set(
          carPos.x + fwdX * hoodOffset + sx * 0.2,
          carPos.y + 1.15 + sy * 0.3 - this.brakeDip(car) * 0.06,
          carPos.z + fwdZ * hoodOffset
        );
        this._look.set(
          carPos.x + fwdX * lookDist,
          carPos.y + 0.9 + curve.elevationAt(car.s + lookDist) - sm.y,
          carPos.z + fwdZ * lookDist
        );
        cam.lookAt(this._look);
        cam.rotation.z += -car.steerAngle * 0.35 + sm.bank * 0.55;
      } else if (this.mode === "cockpit") {
        const eye = (car.mesh && car.mesh.cockpit) || { x: 0.32, y: carPos.y + 1.32, z: car.s };
        const lx = Math.cos(carYaw), lz = Math.sin(carYaw);
        const eyeZ = isRear ? -eye.z : -eye.z;
        const lookDist = isRear ? -35 : 42;
        cam.position.set(
          carPos.x + lx * eye.x + fwdX * eyeZ + sx * 0.1,
          carPos.y + eye.y + sy * 0.15 - this.brakeDip(car) * 0.04 + car.suspHeave * 0.4,
          carPos.z + lz * eye.x + fwdZ * eyeZ
        );
        this._look.set(
          cam.position.x + fwdX * lookDist,
          cam.position.y - 0.5 + curve.elevationAt(car.s + lookDist) - sm.y,
          cam.position.z + fwdZ * lookDist
        );
        cam.lookAt(this._look);
        cam.rotation.z += sm.bank * 0.65 - car.steerAngle * 0.1;
      }

      const speedFov = 60 + car.speedNorm * 22 * this.fovScale;
      const nitroFov = car.nitroActive ? 8 * this.fovScale : 0;
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
