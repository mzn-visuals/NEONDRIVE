(function () {
  const C = ND.Config;

  class PlayerCar {
    constructor(scene, cfg, renderer) {
      this.scene = scene;
      this.renderer = renderer;
      this.s = 0;
      this.lat = 0;
      this.yawRel = 0;
      this.velForward = C.SPEED.startKmh / 3.6;
      this.latVel = 0;
      this.airborne = false;
      this.vy = 0;
      this.airTime = 0;
      this.rollAngle = 0;
      this.rollVel = 0;
      this.drifting = false;
      this.slipAngle = 0;
      this.nitroMeter = 100;
      this.nitroActive = false;
      this.braking = false;
      this.offroad = false;
      this.suspPitch = 0;
      this.suspRoll = 0;
      this.suspHeave = 0;
      this.wheelSpin = 0;
      this.steerAngle = 0;
      this.gear = 1;
      this.rpm = 0.2;
      this.beatBob = 0;
      this.rebuild(scene, cfg);
    }

    rebuild(scene, cfg) {
      if (this.mesh) scene.remove(this.mesh.group);
      this.cfg = cfg;
      this.mesh = ND.CarModel.build(cfg, this.renderer);
      this.underGlow = this.mesh.underGlow;
      this.maxSpeed = cfg.maxSpeed;
      this.cockpitOn = false;
      this.buildVersion = 5;
      scene.add(this.mesh.group);
    }

    setCockpit(on) {
      if (this.cockpitOn === on) return;
      this.cockpitOn = on;
      if (this.mesh.seats) for (const s of this.mesh.seats) s.visible = !on;
      if (this.mesh.shell) for (const s of this.mesh.shell) s.visible = !on;
    }

    get speedKmh() { return Math.max(0, this.velForward) * 3.6; }
    get speedMs() { return Math.max(0, this.velForward); }
    get speedNorm() { return THREE.MathUtils.clamp(this.speedKmh / this.maxSpeed, 0, 1); }
    get x() { return this.lat; }

    reset() {
      this.s = 0;
      this.lat = 0;
      this.yawRel = 0;
      this.velForward = C.SPEED.startKmh / 3.6;
      this.latVel = 0;
      this.airborne = false;
      this.vy = 0;
      this.airTime = 0;
      this.rollAngle = 0;
      this.rollVel = 0;
      this.drifting = false;
      this.slipAngle = 0;
      this.locked = false;
      this._driftBtnHeld = false;
      this._gripRecoverT = 0;
      this.nitroMeter = this.cfg.nitroCapacity;
      this.nitroActive = false;
      this.suspPitch = 0;
      this.suspRoll = 0;
      this.suspHeave = 0;
      this.gear = 1;
      this.rpm = 0.2;
      if (this.mesh) this.mesh.group.position.set(0, 0, 0);
    }

    applyHitGain(kmh, comboMult) {
      this.velForward += kmh * Math.min(comboMult, 3) * 0.42;
      this.clampSpeed();
    }

    applyMissPenalty() {
      this.velForward -= C.SPEED.missPenalty * 0.55;
      this.velForward = Math.max(this.velForward, C.SPEED.minKmh / 3.6);
    }

    clampSpeed() {
      const max = this.maxSpeed / 3.6 + (this.nitroActive ? C.PHYSICS.nitroMaxBonus / 3.6 : 0);
      this.velForward = THREE.MathUtils.clamp(this.velForward, C.SPEED.minKmh / 3.6, max);
    }

    applyImpact(dv, latPush, kind) {
      this.velForward = Math.max(C.SPEED.minKmh / 3.6, this.velForward - dv);
      this.latVel += latPush;
      this.suspHeave += 0.14;
      this.suspRoll += (Math.random() - 0.5) * 0.2;
      ND.bus.emit("car-impact", kind || "obstacle", dv);
    }

    chargeNitro(amount) {
      this.nitroMeter = Math.min(this.cfg.nitroCapacity, this.nitroMeter + amount);
    }

    reactBeat(strength) {
      this.beatBob += strength * 0.05;
    }

    updateAttract(dt, curve) {
      const t = ND.loop.elapsed;
      this.velForward = 95 / 3.6;
      this.lat = Math.sin(t * 0.32) * 2.6;
      this.latVel = Math.cos(t * 0.32) * 2.6 * 0.32;
      this.s += this.velForward * dt;
      this._place(curve, dt, 0, false);
    }

    update(dt, input, curve, track) {
      const P = C.PHYSICS;
      const steerInput = THREE.MathUtils.clamp(input.steer || 0, -1, 1);
      const throttle = THREE.MathUtils.clamp(input.throttle || 0, 0, 1);
      const brake = THREE.MathUtils.clamp(input.brake || 0, 0, 1);

      this.nitroActive = input.nitro && this.nitroMeter > 1 && !this.airborne;
      if (this.nitroActive) {
        this.nitroMeter = Math.max(0, this.nitroMeter - P.nitroDrainPerSec * dt);
      } else {
        this.chargeNitro(this.cfg.nitroRecharge * 2.2 * dt);
      }
      this.mesh.flame.visible = this.nitroActive;
      if (this.nitroActive) {
        this.mesh.flame.scale.setScalar(0.8 + Math.random() * 0.5);
      }

      const maxSteer = 0.7 / (1 + this.speedMs * 0.018);
      const targetSteer = steerInput * maxSteer;
      this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, dt * (4 + this.cfg.steeringResponse * 9));

      const wetLoss = (this.wetness || 0) * P.wetGripLoss;
      let grip = 0.55 + this.cfg.grip * 0.45 - wetLoss;

      const driftBtn = input.drift;
      const speedOk = this.speedKmh > C.DRIFT.minSpeedKmh && !this.airborne;

      if (driftBtn && speedOk && !this.airborne) {
        this.locked = true;
        if (!this._driftBtnHeld && Math.abs(steerInput) > 0.1) {
          this.yawRel = THREE.MathUtils.clamp(this.yawRel + Math.sign(steerInput) * 0.14, -0.9, 0.9);
        }
      } else if (this.locked) {
        this.locked = false;
        this._gripRecoverT = 0.7;
      }
      this._driftBtnHeld = driftBtn;

      this.slipAngle = Math.atan2(this.latVel, Math.max(this.speedMs, 4));
      const visualDrift = Math.abs(this.yawRel - this.slipAngle);

      if (this.locked) grip *= 0.22;
      if (this._gripRecoverT > 0) {
        this._gripRecoverT -= dt;
        grip *= THREE.MathUtils.clamp(1 - (this._gripRecoverT / 0.7) * 0.6, 0.35, 1);
      }

      const wantDrift = (this.locked || visualDrift > 0.09) && speedOk;


      if (!this.airborne) {
        const accelPower = (7.5 + this.cfg.accel * 12) * (1 - this.speedNorm * 0.72);
        let force = throttle * accelPower;
        if (this.nitroActive) force += P.nitroAccelBonus * 0.28;
        if (brake > 0) {
          force -= brake * (16 + this.cfg.braking * 22);
          if (this.velForward < 0.6) this.velForward = Math.max(0, this.velForward - brake * 6 * dt * 10);
        }
        const drag = 0.0016 * this.velForward * this.velForward + 0.35;
        force -= drag;
        if (this.offroad) force -= P.offRoadDrag;
        if (driftBtn && !this.airborne) {
          force *= 0.2;
          force -= this.velForward * 0.28;
        }
        if (visualDrift > 0.12 && !this.airborne) force -= this.velForward * 0.08;

        const elevA = curve.elevationAt(this.s + 6) - curve.elevationAt(this.s);
        const pitch = Math.atan2(elevA, 6);
        force -= Math.sin(pitch) * P.gravity * 0.55;

        this.velForward += force * dt;
        this.clampSpeed();

        const speedFactor = Math.min(this.speedMs / 12, 2.2);
        const yawGain = (0.85 + this.cfg.handling * 0.75) * (wantDrift ? P.slipGainDrift : 1);
        const yawRate = this.steerAngle * speedFactor * (wantDrift ? 0.75 : 0.6) * yawGain;
        this.yawRel += yawRate * dt;
        if (wantDrift) {
          this.yawRel *= Math.pow(0.5, dt);
          this.yawRel = THREE.MathUtils.clamp(this.yawRel, -0.8, 0.8);
        } else {
          const settle = THREE.MathUtils.clamp(this.slipAngle * 0.5, -0.16, 0.16);
          this.yawRel += (settle - this.yawRel) * Math.min(1, dt * 5);
          this.yawRel = THREE.MathUtils.clamp(this.yawRel, -0.3, 0.3);
        }

        const steerPush = this.steerAngle * this.speedMs * (1.8 + this.cfg.handling * 1.2) * (wantDrift ? 0.3 : 1);
        this.latVel += steerPush * dt;
        const gripRate = 2.6 + grip * 4.2;
        this.latVel -= this.latVel * Math.min(1, gripRate * dt);
        this.latVel = THREE.MathUtils.clamp(this.latVel, -26, 26);

        const f = curve.frameAt(this.s);
        this.latVel += -f.bank * this.speedMs * 0.22 * dt;

        this.slipAngle = Math.atan2(this.latVel, Math.max(this.speedMs, 4));
        const nowDrifting = visualDrift > C.DRIFT.entrySlip && this.speedKmh > C.DRIFT.minSpeedKmh;
        if (nowDrifting !== this.drifting) {
          if (nowDrifting) ND.bus.emit("car-drift-start");
          else ND.bus.emit("car-drift-end", Math.abs(this.slipAngle));
          this.drifting = nowDrifting;
        }

        this.s += this.velForward * Math.cos(this.yawRel) * dt;
        this.lat += this.latVel * dt;

        const limit = C.ROAD_HALF_WIDTH - 0.85;
        this.offroad = Math.abs(this.lat) > limit;
        if (this.offroad) {
          this.lat = THREE.MathUtils.clamp(this.lat, -limit - 0.8, limit + 0.8);
          this.suspHeave += Math.abs(this.latVel) * dt * 2 + Math.random() * dt * 2;
          if (Math.abs(this.lat) > limit + 0.7) {
            this.latVel -= (this.lat - Math.sign(this.lat) * (limit + 0.7)) * 14 * dt;
          }
        } else if (Math.abs(this.lat) > limit - 0.25) {
          const over = Math.abs(this.lat) - (limit - 0.25);
          this.latVel -= Math.sign(this.lat) * over * 26 * dt;
        }

        const ramp = track ? track.getRampAt(this.s, this.lat) : null;
        if (ramp) {
          const t = (this.s - ramp.s) / ramp.len;
          if (t > 0.4 && t <= 1.2 && this.vy <= 0.01 && !this.airborne) {
            const launch = Math.atan2(ramp.h, ramp.len);
            this.vy = this.velForward * Math.tan(launch) * 0.9;
            this.airborne = true;
            this.airTime = 0;
            this.rollAngle = 0;
            this.rollVel = 0;
            ND.bus.emit("car-airborne", this.velForward);
          }
        }
        this.braking = brake > 0.1;
      } else {
        this.airTime += dt;
        this.vy -= P.gravity * dt;
        this.s += this.velForward * dt;
        this.lat += this.latVel * dt * 0.6;
        this.yawRel *= Math.pow(0.5, dt);
        if (input.drift) {
          this.rollVel += steerInput !== 0 ? steerInput * 5.4 * dt : 3.6 * dt;
        }
        this.rollVel *= Math.pow(0.9, dt);
        this.rollAngle += this.rollVel;
        this.braking = false;
        if (this.vy < 0) {
          const roadY = curve.sampleAt(this.s).y;
          const worldY = this._worldY(curve);
          if (worldY <= roadY + 0.01) {
            const rotation = Math.abs(this.rollAngle) % (Math.PI * 2);
            const rollErr = Math.min(rotation, Math.PI * 2 - rotation);
            const quality = rollErr < C.STUNTS.cleanRollTol && Math.abs(this.lat) < C.ROAD_HALF_WIDTH ? "clean" : "sloppy";
            ND.bus.emit("car-landed", { quality, airTime: this.airTime, rotation: this.rollAngle, vy: this.vy });
            this.airborne = false;
            this.vy = 0;
            this.rollAngle = 0;
            this.rollVel = 0;
            this.latVel *= 0.4;
            this.suspHeave = 0.22;
            if (quality === "sloppy") {
              this.velForward = Math.max(C.SPEED.minKmh / 3.6, this.velForward - C.STUNTS.sloppySpeedLoss / 3.6);
            }
          }
        }
      }

      const rpmTarget = this.airborne ? 0.85 :
        THREE.MathUtils.clamp(0.18 + (this.speedNorm * 0.82) + (this.nitroActive ? 0.14 : 0) + throttle * 0.06, 0, 1.05);
      this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * 5);
      const gears = 6;
      const g = Math.min(gears, 1 + Math.floor(this.speedNorm * gears * 0.999));
      this.gear = this.airborne ? this.gear : g;

      this.wheelSpin += (this.velForward / 0.44) * dt;
      this._place(curve, dt, steerInput, this.airborne);
      this._updateVisualState(dt, input);
    }

    _worldY(curve) {
      const sm = curve.sampleAt(this.s);
      return sm.y + this.lat * Math.sin(sm.bank) * 0.5 + this.airY;
    }

    _place(curve, dt, steerInput, airborne) {
      const sm = curve.sampleAt(this.s);
      const rx = Math.cos(sm.h), rz = Math.sin(sm.h);
      const roadY = sm.y + this.lat * Math.sin(sm.bank) * 0.5;

      if (airborne) {
        this.airY = (this.airY || 0) + this.vy * dt;
      } else {
        this.airY = 0;
      }

      const bump = airborne ? 0 : curve.bumpAt(this.s) * C.PHYSICS.bumpAmp * Math.min(1, this.speedMs / 20);
      const g = this.mesh.group;
      g.position.set(sm.x + rx * this.lat, roadY + this.airY + bump + this.suspHeave * 0.5 + this.beatBob, sm.z + rz * this.lat);

      const heading = sm.h + this.yawRel;
      g.rotation.set(0, -heading, 0);
      g.rotation.y = -heading;

      const bodyRoll = THREE.MathUtils.clamp(-this.latVel * 0.02 - this.steerAngle * 0.16, -0.22, 0.22);
      const targetRoll = bodyRoll + sm.bank * 0.85;
      const targetPitch = THREE.MathUtils.clamp((this.braking ? 0.05 : 0) - (this.nitroActive ? 0.045 : 0) - (this.airborne ? -this.vy * 0.012 : 0), -0.14, 0.14);

      this.suspRoll += (targetRoll - this.suspRoll) * Math.min(1, dt * 6);
      this.suspPitch += (targetPitch - this.suspPitch) * Math.min(1, dt * 6);
      this.suspHeave *= Math.pow(0.008, dt);

      if (airborne) {
        g.rotation.z = this.rollAngle;
        g.rotation.x = THREE.MathUtils.clamp(-this.vy * 0.02, -0.3, 0.3);
      } else {
        g.rotation.z = this.suspRoll;
        g.rotation.x = this.suspPitch;
      }

      for (const w of this.mesh.wheels) {
        w.userData.spin.rotation.x = this.wheelSpin;
        if (w.userData.steers) w.rotation.y = this.steerAngle * 0.55;
      }
      this.mesh.steeringWheel.rotation.z = -this.steerAngle * 4.2;

      const bm = this.mesh.brakeMats[0];
      bm.color.setHex(this.braking ? 0xff2a3c : 0x660f1e);
      const rv = this.mesh.reverseMats[0];
      rv.color.setHex(this.braking && this.velForward < 0.5 ? 0xe8ecff : 0x333744);
      this.mesh.headlight.intensity = this.headlightsOn ? 2.4 : 0;

      this.beatBob *= Math.pow(0.001, dt);
    }

    _updateVisualState(dt, input) {
      this.headlightsOn = input.headlights !== undefined ? input.headlights : this.headlightsOn;
    }

    setPalette(palette) {
      this.underGlow.color.copy(palette.primary);
      this.underGlow.intensity = 1.4;
    }
  }

  ND.PlayerCar = PlayerCar;
})();
