(function () {
  class MultiplayerManager {
    constructor(game) {
      this.game = game;
      this.net = null;
      this.inRun = false;
      this.session = null;
      this.ghosts = new Map();
      this.stateTimer = 0;
      this.teamComboUntil = 0;
      this.teamComboCount = 0;
      this.rhythmSeed = null;
      this.enabled = false;
    }

    async host(name, carIndex) {
      this.net = new ND.NetClient(ND.Config.MP.url);
      await this.net.connect();
      this.net.create(name, carIndex);
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("no response from server")), 5000);
        this.net.on("created", msg => {
          clearTimeout(to);
          this.enabled = true;
          this._bindRunHandlers();
          resolve(msg.code);
        });
        this.net.on("error", m => { clearTimeout(to); reject(new Error(m)); });
      });
    }

    async join(code, name, carIndex) {
      this.net = new ND.NetClient(ND.Config.MP.url);
      await this.net.connect();
      this.net.join(code, name, carIndex);
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("no response from server")), 5000);
        this.net.on("joined", msg => {
          clearTimeout(to);
          this.enabled = true;
          this._bindRunHandlers();
          resolve(msg.code);
        });
        this.net.on("error", m => { clearTimeout(to); reject(new Error(m)); });
      });
    }

    leave() {
      if (this.net) {
        this.net.disconnect();
        this.net = null;
      }
      this.enabled = false;
      this.inRun = false;
      this.session = null;
      this._clearGhosts();
    }

    _bindRunHandlers() {
      this.net.on("session", session => {
        this.session = session;
        ND.bus.emit("mp-session", session);
      });
      this.net.on("start", msg => {
        this.pendingStart = msg;
        ND.bus.emit("mp-start", msg);
      });
      this.net.on("state", st => this._updateGhost(st));
      this.net.on("event", ev => {
        if (ev.kind === "hit" && ev.id !== this.net.id) {
          ND.bus.emit("toast", "TEAMMATE " + ev.val);
        } else if (ev.kind === "stunt") {
          ND.bus.emit("toast", "TEAMMATE STUNT +" + ev.val);
        }
      });
      this.net.on("team-combo", count => {
        this.teamComboCount = count;
        this.teamComboUntil = performance.now() / 1000 + 3;
        ND.bus.emit("team-combo", count);
        this.game.car.chargeNitro(10 * count);
        ND.bus.emit("toast", "TEAM COMBO ×" + count);
      });
      this.net.on("disconnected", () => {
        ND.bus.emit("toast", "CO-OP DISCONNECTED");
        this._clearGhosts();
        this.inRun = false;
      });
    }

    beginRun(track) {
      if (!this.enabled || !this.net) return;
      this.inRun = true;
      this.rhythmSeed = this.session ? this.session.rhythmSeed : (this.game.plan ? 1 : 1);
      if (this.net.isHost && this.session) {
        const songStartAt = this.net.serverNow() + 3800;
        this.net.broadcastStart(songStartAt, { id: track.id, title: track.title });
        this._startCountdown(songStartAt, track);
      }
    }

    requestNextSong() {
      if (!this.net || !this.net.isHost) return;
      if (this.session && this.session.playlist && this.session.playlist.length) {
        const next = this.session.playlist.shift();
        this.session.current = next;
        this.net.broadcastSession(this.session);
        const track = ND.Track.normalize({ id: next.id, title: next.title, artist: next.artist || "", pic: next.pic || "" }, "youtube-music");
        this.game.providers.proxy.prewarm(track);
        this.game.nextPrepared = null;
        this.game.queue.push(track);
      }
    }

    _startCountdown(songStartAt, track) {
      const tick = () => {
        const remain = songStartAt - this.net.serverNow();
        if (remain <= 0) {
          ND.bus.emit("toast", "GO");
          return;
        }
        ND.bus.emit("toast", "SYNCING — " + Math.ceil(remain / 1000));
        setTimeout(tick, Math.min(1000, remain));
      };
      tick();
    }

    applyHostClock(songTime) {
      if (!this.net || !this.session || !this.session.songStartAt) return;
      if (!this.net.isHost) {
        const serverSongTime = (this.net.serverNow() - this.session.songStartAt) / 1000;
        if (Math.abs(serverSongTime - songTime) > 0.25 && serverSongTime > 0 && serverSongTime < this.game.music.duration()) {
          this.game.music.audioEl.currentTime = serverSongTime;
        }
      }
    }

    reportHit(quality) {
      if (this.net && this.inRun) this.net.sendEvent("hit", quality);
    }
    reportStunt(pts) {
      if (this.net && this.inRun) this.net.sendEvent("stunt", pts);
    }

    _updateGhost(st) {
      if (st.id === (this.net && this.net.id)) return;
      let ghost = this.ghosts.get(st.id);
      if (!ghost) {
        const cfg = ND.Config.CARS[0];
        const built = ND.CarModel.build(cfg, null);
        built.group.traverse(o => {
          if (o.material) {
            o.material = o.material.clone();
            o.material.transparent = true;
            o.material.opacity = 0.45;
            if (o.material.emissive) o.material.emissiveIntensity *= 0.4;
          }
        });
        this.game.scene.add(built.group);
        ghost = { model: built, s: st.s, lat: st.lat };
        this.ghosts.set(st.id, ghost);
      }
      ghost.target = { s: st.s, lat: st.lat, yaw: st.yaw, spd: st.spd, nitro: !!st.nitro };
      const player = (this.net.players || []).find(p => p.id === st.id);
      ghost.name = player ? player.name : "GHOST";
    }

    _clearGhosts() {
      for (const g of this.ghosts.values()) this.game.scene.remove(g.model.group);
      this.ghosts.clear();
    }

    update(dt, car) {
      if (!this.enabled || !this.inRun || !this.net) return;
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.stateTimer = 0.1;
        this.net.sendState(car);
      }

      const curve = this.game.curve;
      for (const ghost of this.ghosts.values()) {
        if (!ghost.target) continue;
        ghost.s += (ghost.target.s - ghost.s) * Math.min(1, dt * 8);
        ghost.lat += (ghost.target.lat - ghost.lat) * Math.min(1, dt * 8);
        const sm = curve.sampleAt(ghost.s);
        const rx = Math.cos(sm.h), rz = Math.sin(sm.h);
        ghost.model.group.position.set(
          sm.x + rx * ghost.lat,
          sm.y + ghost.lat * Math.sin(sm.bank) * 0.5,
          sm.z + rz * ghost.lat
        );
        ghost.model.group.rotation.set(0, -(sm.h + (ghost.target.yaw || 0)), 0);
        ghost.model.flame.visible = !!ghost.target.nitro;
      }
    }

    leaveRun() {
      this.onRunFinished();
      this.pendingStart = null;
      this.session = null;
    }

    onRunFinished() {
      this.inRun = false;
      this._clearGhosts();
    }
  }

  ND.MultiplayerManager = MultiplayerManager;
})();
