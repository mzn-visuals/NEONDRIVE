(function () {
  const C = ND.Config;

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  class Game {
    constructor(canvas, settings) {
      this.state = ND.gameState;
      this.renderer = new ND.Renderer(canvas, { quality: settings.quality });
      this.scene = new THREE.Scene();
      this.cameraSys = new ND.CameraSystem(settings);
      this.camera = this.cameraSys.camera;

      this.music = new ND.MusicManager();

      const endpoints = [];
      if (settings.proxyUrl) endpoints.push(settings.proxyUrl);
      endpoints.push(...C.PROXY_ENDPOINTS_DEFAULT);
      this.providers = {
        proxy: new ND.ProxyProvider(endpoints),
        local: new ND.LocalProvider()
      };
      this.queue = new ND.QueueManager(this.providers.proxy);

      this.world = new ND.WorldManager(this.scene, this.renderer);
      this.curve = this.world.curve;
      this.car = new ND.PlayerCar(this.scene, C.CARS[settings.carIndex] || C.CARS[0], this.renderer);
      this.tiles = new ND.TileManager(this.scene);
      this.lyrics = new ND.LyricsManager(this.scene, this.cameraSys);
      this.wormhole = new ND.Wormhole(this.scene);
      this.drift = new ND.DriftSystem(this.car);
      this.stunts = new ND.StuntSystem(this.car);
      this.obstacles = new ND.ObstacleManager(this.scene);
      this.traffic = new ND.TrafficSystem(this.scene, this.curve);
      this.audioFx = new ND.AudioFx(this.music.engine);

      // Initialize post-processing
      this.renderer.initPostProcessing(this.scene, this.camera);
      
      // Initialize anime effects
      this.animeEffects = new ND.AnimeEffects(this.scene);

      this.combo = new ND.ComboSystem();
      this.score = new ND.ScoreSystem();
      
      // Listen for combo events for dramatic effects
      ND.bus.on("combo-tier", (mult, count) => {
        // Dramatic camera shake on combo tier increase
        this.cameraSys.addImpactShake();
        // Emit sparks at combo milestones
        if (count >= 25 || count >= 50 || count >= 100) {
          for (let i = 0; i < 10; i++) {
            setTimeout(() => {
              const pos = this.car.mesh.group.position.clone();
              pos.y += 0.5;
              const dir = new THREE.Vector3(Math.random()-0.5, Math.random(), Math.random()-0.5);
              this.animeEffects.emitSpark(pos, dir, 1.5);
            }, i * 50);
          }
        }
      });

      this.input = { steer: 0, left: false, right: false, throttle: false, brake: false, drift: false, nitro: false };
      this.padInput = { steer: 0, throttle: 0, brake: 0, drift: false, nitro: false };
      this.plan = null;
      this.planIdx = 0;
      this.beatIdx = 0;
      this.currentPrepared = null;
      this.nextPrepared = null;
      this.transitionArmed = false;
      this.swapped = false;
      this.lastTrack = null;
      this.showroomActive = false;
      this.showroomAngle = 0;
      this.mp = new ND.MultiplayerManager(this);

      this._buildShowroom();
      this._bindEvents();
      this._bindInput();

      ND.bus.on("settings-quality", q => {
        this.renderer.setQuality(q);
        this.world.track.chunkCount = C.QUALITY[q].chunkCount;
      });
      ND.bus.on("settings-volume", v => this.music.engine.setVolume(v));
      ND.bus.on("settings-lyrics", v => this.lyrics.setEnabled(v));
      ND.bus.on("settings-proxy", url => {
        const eps = [];
        if (url) eps.push(url);
        eps.push(...C.PROXY_ENDPOINTS_DEFAULT);
        this.providers.proxy.endpoints = eps;
        this.providers.proxy.base = null;
      });
      ND.bus.on("settings-shake", v => { this.cameraSys.shakeLevel = v; });
      ND.bus.on("settings-fov", v => { this.cameraSys.fovScale = v; });
      ND.bus.on("settings-camera", v => { this.cameraSys.setMode(v); });

      this.music.engine.setVolume(settings.volume);
      this.lyrics.setEnabled(settings.lyrics);
      this.cameraSys.shakeLevel = settings.shake != null ? settings.shake : 1;
      this.cameraSys.fovScale = settings.fovScale != null ? settings.fovScale : 1;

      ND.bus.on("car-impact", (kind, dv) => {
        this.cameraSys.addShake(0.3 + dv * 0.02);
        this.audioFx.thud(0.2 + dv * 0.01);
        ND.bus.emit("judgement", "IMPACT");
      });
      ND.bus.on("car-landed", (info) => {
        this.cameraSys.addShake(info.quality === "clean" ? 0.18 : 0.4);
        this.cameraSys.landDip = 0.5;
        this.audioFx.thud(0.25);
      });
      ND.bus.on("car-airborne", () => {
        this.audioFx.nitroWhoosh();
      });
      ND.bus.on("near-miss", (bonus) => {
        ND.bus.emit("toast", "NEAR MISS +" + bonus);
        this.audioFx.blip(1200, 0.08, "sine", 0.05);
      });
      ND.bus.on("drift-scored", (pts) => {
        ND.bus.emit("toast", "DRIFT +" + pts);
        this.cameraSys.addShake(0.06);
      });
      ND.bus.on("stunt-scored", (pts, label) => {
        ND.bus.emit("toast", label + " +" + pts);
        if (this.mp) this.mp.reportStunt(pts);
      });

      ND.loop.add((dt) => this.update(dt));
      this.enterAttract();
    }

    _buildShowroom() {
      const sr = new THREE.Scene();
      sr.background = ND.srgb("#07020f");
      sr.fog = new THREE.Fog(0x07020f, 18, 60);
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(30, 40),
        new THREE.MeshStandardMaterial({ color: 0x0d0620, metalness: 0.4, roughness: 0.6 })
      );
      floor.rotation.x = -Math.PI / 2;
      sr.add(floor);
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(4.4, 4.8, 0.3, 48),
        new THREE.MeshStandardMaterial({ color: 0x1a0f33, metalness: 0.5, roughness: 0.4 })
      );
      disc.position.y = 0.15;
      sr.add(disc);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(4.7, 0.09, 8, 60),
        new THREE.MeshBasicMaterial({ color: 0xff2fd6 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.32;
      sr.add(ring);
      sr.add(new THREE.HemisphereLight(0x8899ff, 0x110a22, 1.35));
      const spot = new THREE.SpotLight(0xffffff, 3.0, 60, 0.85, 0.45);
      spot.position.set(2, 14, 6);
      spot.target.position.set(0, 0, 0);
      sr.add(spot);
      const spot2 = new THREE.SpotLight(0xff2fd6, 2.2, 50, 0.9, 0.5);
      spot2.position.set(-11, 9, -7);
      spot2.target.position.set(0, 0, 0);
      sr.add(spot2);
      const spot3 = new THREE.SpotLight(0x29e6ff, 1.8, 50, 0.9, 0.5);
      spot3.position.set(11, 8, -6);
      spot3.target.position.set(0, 0, 0);
      sr.add(spot3);
      const fill = new THREE.DirectionalLight(0xffffff, 0.7);
      fill.position.set(6, 4, 10);
      sr.add(fill);
      this.showroomScene = sr;
      this.showroomCar = null;
      this.showroomCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
      this.showroomCamera.position.set(4.4, 3.1, 11);
      this.showroomCamera.lookAt(4.4, 0.9, 0);
      ND.bus.on("renderer-resize", () => {
        this.showroomCamera.aspect = window.innerWidth / window.innerHeight;
        this.showroomCamera.updateProjectionMatrix();
      });
    }

    _bindEvents() {
      ND.bus.on("tile-missed", () => this._onMiss());
      ND.bus.on("music-ended", () => this._onSongEnded());
      ND.bus.on("music-error", (err) => {
        console.warn("[audio]", err);
        ND.bus.emit("toast", "STREAM FAILED — TRY ANOTHER SONG");
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.state.is(ND.State.PLAYING)) this.pause();
      });
    }

    _bindInput() {
      const isTyping = () => {
        const el = document.activeElement;
        return !!(el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable));
      };
      const down = e => {
        if (e.repeat || isTyping()) return;
        switch (e.code) {
          case "ArrowLeft": case "KeyA": this.input.left = true; break;
          case "ArrowRight": case "KeyD": this.input.right = true; break;
          case "ArrowUp": case "KeyW": this.input.throttle = true; break;
          case "ArrowDown": case "KeyS": this.input.brake = true; break;
          case "Space": this.input.drift = true; e.preventDefault(); break;
          case "ShiftLeft": case "ShiftRight": this.input.nitro = true; break;
          case "KeyC":
            if (this.state.is(ND.State.PLAYING) || this.state.is(ND.State.TRANSITION)) this.cameraSys.cycleMode();
            break;
          case "KeyR":
            if (this.state.is(ND.State.PLAYING) || this.state.is(ND.State.TRANSITION)) this.cameraSys.toggleRearView();
            break;
          case "KeyH": this.car.headlightsOn = !this.car.headlightsOn; break;
          case "Escape":
            if (this.state.is(ND.State.PLAYING)) this.pause();
            else if (this.state.is(ND.State.PAUSED)) this.resume();
            break;
        }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
      };
      const up = e => {
        if (isTyping()) return;
        switch (e.code) {
          case "ArrowLeft": case "KeyA": this.input.left = false; break;
          case "ArrowRight": case "KeyD": this.input.right = false; break;
          case "ArrowUp": case "KeyW": this.input.throttle = false; break;
          case "ArrowDown": case "KeyS": this.input.brake = false; break;
          case "Space": this.input.drift = false; break;
          case "ShiftLeft": case "ShiftRight": this.input.nitro = false; break;
        }
      };
      window.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
    }

    _pollGamepad() {
      this.padInput.steer = 0;
      this.padInput.throttle = 0;
      this.padInput.brake = 0;
      this.padInput.drift = false;
      this.padInput.nitro = false;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;
        const ax = pad.axes[0] || 0;
        this.padInput.steer = Math.abs(ax) > 0.14 ? ax : 0;
        if (pad.buttons[7]) this.padInput.throttle = pad.buttons[7].value;
        if (pad.buttons[6]) this.padInput.brake = pad.buttons[6].value;
        this.padInput.nitro = !!(pad.buttons[0] && pad.buttons[0].pressed);
        this.padInput.drift = !!(pad.buttons[1] && pad.buttons[1].pressed);
        if (pad.buttons[2] && pad.buttons[2].pressed && !this._padCamHeld) {
          this._padCamHeld = true;
          if (this.state.is(ND.State.PLAYING) || this.state.is(ND.State.TRANSITION)) this.cameraSys.cycleMode();
        } else if (!pad.buttons[2] || !pad.buttons[2].pressed) this._padCamHeld = false;

        if (this._rumble && pad.vibrationActuator) {
          pad.vibrationActuator.playEffect("dual-rumble", {
            duration: this._rumble.dur,
            strongMagnitude: this._rumble.strong,
            weakMagnitude: this._rumble.weak
          }).catch(() => {});
          this._rumble = null;
        }
        break;
      }
    }

    rumble(strong, weak, dur) {
      this._rumble = { strong, weak, dur };
    }

    _effectiveInput() {
      const steer = THREE.MathUtils.clamp(
        (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0) + this.input.steer + this.padInput.steer, -1, 1);
      return {
        steer,
        throttle: (this.input.throttle ? 1 : 0) || this.padInput.throttle,
        brake: (this.input.brake ? 1 : 0) || this.padInput.brake,
        drift: this.input.drift || this.padInput.drift,
        nitro: this.input.nitro || this.padInput.nitro
      };
    }

    selectCar(index) {
      const cfg = C.CARS[index];
      this.car.rebuild(this.scene, cfg);
      this._refreshShowroomCar(cfg);
    }

    setMode(mode) { this.queue.setMode(mode); }

    enterAttract() {
      if (!this.attractBuilt) {
        const s = this.uiSettings();
        this.world.build({
          levelId: s.levelId || "desert",
          timeId: s.timeId || "sunset",
          weatherId: s.weatherId || "clear",
          palette: this.currentPalette || ND.PaletteSystem.DEFAULT,
          seed: hashSeed(`${s.levelId || "desert"}:${s.timeId || "sunset"}:${s.weatherId || "clear"}`)
        });
        this.curve = this.world.curve;
        this.traffic.curve = this.curve;
        this.attractBuilt = true;
      }
      this.state.set(ND.State.MENU);
    }

    previewWorld() {
      this.world.build({
        levelId: this.uiSettings().levelId,
        timeId: this.uiSettings().timeId,
        weatherId: this.uiSettings().weatherId,
        palette: this.currentPalette || ND.PaletteSystem.DEFAULT,
        seed: hashSeed(`${this.uiSettings().levelId}:${this.uiSettings().timeId}:${this.uiSettings().weatherId}`)
      });
      this.curve = this.world.curve;
      this.traffic.curve = this.curve;
      this.attractBuilt = true;
    }

    uiSettings() { return this.ui ? this.ui.settings : {}; }

    showroomMode(on) {
      this.showroomActive = on;
      if (on) this._refreshShowroomCar(C.CARS[this.uiSettings().carIndex || 0]);
    }

    _refreshShowroomCar(cfg) {
      if (!cfg) return;
      if (this.showroomCar) this.showroomScene.remove(this.showroomCar.group);
      this.showroomCar = ND.CarModel.build(cfg, this.renderer);
      this.showroomCar.group.position.y = 0.3;
      this.showroomScene.add(this.showroomCar.group);
    }

    async startRun(track, mpSession) {
      if (!track) return;
      this.lastTrack = track;
      this.state.set(ND.State.LOADING);
      this.ui.hideAll();
      this.ui.showLoading();
      this.ui.setLoadingSong(track);
      this.tiles.reset();
      this.combo.reset();
      this.score.reset();
      this.drift.reset();
      this.stunts.reset();
      this.obstacles.reset();
      this.traffic.reset();
      this.nextPrepared = null;
      this._preparing = null;
      this.transitionArmed = false;
      this.swapped = false;
      this.wormhole.end();
      this._tunnelBuilt = false;
      this._spuriousEnds = 0;

      try {
        const provider = track.source === "local" ? this.providers.local : this.providers.proxy;
        const prepared = await this.music.prepare(track, provider,
          (step, p) => this.ui.setLoadStep(step === "analyze" ? "analyze" : "fetch", p));

        this.ui.setLoadStep("colors", 0.5);
        const palette = await ND.PaletteSystem.extract(track, u => this.providers.proxy.localProxyUrl(u));

        this.car.reset();
        this.combo.reset();
        this.score.reset();
        this.currentPrepared = prepared;
        this.currentPalette = palette;

        this.ui.setLoadStep("world", 0.3);
        this._applyWorldFor(prepared, palette);

        this.ui.setLoadStep("road", 0.6);
        const planSeed = mpSession ? mpSession.rhythmSeed : hashSeed("rhythm:" + prepared.track.id + ":" + prepared.analysis.duration.toFixed(2));
        this.plan = ND.RhythmDirector.buildPlan(prepared.analysis, this.uiSettings().difficulty || "normal", planSeed);
        this.planIdx = 0;
        this.beatIdx = 0;

        this.queue.reset();
        if (!mpSession) {
          this.queue.setMode(this.uiSettings().mode || "single");
          this.queue.startWith(track);
        }

        this.lyrics.loadForTrack(track, prepared.analysis.duration);

        if (mpSession && this.mp) {
          this.mp.session = mpSession;
          this.mp.inRun = true;
          if (this.mp.net && this.mp.net.isHost) {
            const songStartAt = this.mp.net.serverNow() + 3800;
            this.mp.net.broadcastStart(songStartAt, { id: track.id, title: track.title });
            this.mp._startCountdown(songStartAt, track);
          } else {
            const deadline = Date.now() + 30000;
            while (!this.mp.pendingStart && Date.now() < deadline) {
              await new Promise(r => setTimeout(r, 300));
            }
            if (this.mp.pendingStart) {
              const wait = this.mp.pendingStart.songStartAt - this.mp.net.serverNow();
              if (wait > 0) await new Promise(r => setTimeout(r, wait));
            }
          }
        }

        this.ui.setLoadDone();
        this.ui.setNowPlaying(track);
        await new Promise(r => setTimeout(r, 350));
        this.ui.hideAll();
        this.ui.showHud();
        await this.music.play(prepared);
        this.state.set(ND.State.PLAYING);
      } catch (e) {
        console.error("[startRun]", e);
        this.state.set(ND.State.MENU);
        this.ui.show("music");
        ND.bus.emit("toast", "LOADING FAILED — " + (e.message || "UNKNOWN ERROR").slice(0, 42));
      }
    }

    _applyWorldFor(prepared, palette) {
      const s = this.uiSettings();
      const seed = hashSeed(`${prepared.track.id}:${s.levelId}:${s.weatherId}:${s.timeId}`);
      this.world.build({
        levelId: s.levelId, timeId: s.timeId, weatherId: s.weatherId,
        palette, seed, keepCurve: this.swapped
      });
      this.curve = this.world.curve;
      this.traffic.curve = this.curve;
      this.tiles.setPalette(palette);
      this.lyrics.setPalette(palette);
      this.car.setPalette(palette);
    }

    pause() {
      if (!this.state.is(ND.State.PLAYING)) return;
      this.music.pause();
      this.state.set(ND.State.PAUSED);
      this.ui.showPause(true);
    }

    resume() {
      if (!this.state.is(ND.State.PAUSED)) return;
      this.ui.showPause(false);
      this.music.resumePlayback();
      this.state.set(ND.State.PLAYING);
    }

    restart() {
      this.ui.showPause(false);
      if (this.lastTrack) this.startRun(this.lastTrack);
    }

    driveAgain() {
      if (this.lastTrack) this.startRun(this.lastTrack);
    }

    quitToMenu() {
      try {
        this.music.stop();
        this.tiles.reset();
        this.wormhole.end();
        this.queue.reset();
        this.plan = null;
        this.obstacles.reset();
        this.traffic.reset();
        this.cameraSys.setWormBlend(false);
        this._tunnelBuilt = false;
        this.transitionArmed = false;
        this.swapped = false;
        this.score.setMaxCombo(this.combo.max);
        if (this.mp) this.mp.leaveRun();
      } catch (e) {
        console.error("[quit]", e);
      }
      this.ui.showPause(false);
      this.enterAttract();
      this.ui.show("main");
    }

    async _armTransition() {
      this.transitionArmed = true;
      if (this.mp && this.mp.inRun) {
        this.wormhole.begin(this.currentPalette || ND.PaletteSystem.DEFAULT);
        this.mp.requestNextSong();
        return;
      }
      let nextTrack = null;
      if (this.queue.hasFollowing) {
        nextTrack = await this.queue.next();
      }
      if (this.state.is(ND.State.RESULTS) || this.state.is(ND.State.MENU)) {
        this.transitionArmed = false;
        return;
      }
      if (!nextTrack) {
        const blended = {};
        ND.PaletteSystem.lerp(this.currentPalette || ND.PaletteSystem.DEFAULT, ND.PaletteSystem.DEFAULT, 0.5, blended);
        blended.cssPrimary = (this.currentPalette || ND.PaletteSystem.DEFAULT).cssPrimary;
        blended.cssSecondary = ND.PaletteSystem.DEFAULT.cssSecondary;
        this.wormhole.begin(blended);
        return;
      }
      this.wormhole.begin(this.currentPalette || ND.PaletteSystem.DEFAULT);
      const provider = nextTrack.source === "local" ? this.providers.local : this.providers.proxy;
      this._preparing = (async () => {
        const prepared = await this.music.prepare(nextTrack, provider);
        const palette = await ND.PaletteSystem.extract(nextTrack, u => this.providers.proxy.localProxyUrl(u));
        prepared.audioBuffer = null;
        return { ...prepared, palette };
      })()
        .then(np => {
          if (this.state.is(ND.State.RESULTS) || this.state.is(ND.State.MENU)) return;
          this.nextPrepared = np;
          this.wormhole.recolor(np.palette);
          this.lyrics.loadForTrack(nextTrack, np.analysis.duration);
        })
        .catch(e => {
          console.warn("[next-prep]", e);
          if (!this.nextPrepared) this.wormhole.begin(ND.PaletteSystem.DEFAULT);
        })
        .finally(() => { this._preparing = null; });
    }

    _swapWorld() {
      if (this.swapped) return;
      this.swapped = true;
      this.tiles.reset();
      const np = this.nextPrepared;
      if (np) {
        this.currentPrepared = np;
        this.currentPalette = np.palette;
        this._applyWorldFor(np, np.palette);
        this.plan = ND.RhythmDirector.buildPlan(np.analysis, this.uiSettings().difficulty || "normal",
          hashSeed("rhythm:" + np.track.id + ":" + np.analysis.duration.toFixed(2)));
        this.ui.setNowPlaying(np.track);
      } else {
        this.currentPalette = ND.PaletteSystem.lerp(
          this.currentPalette || ND.PaletteSystem.DEFAULT,
          ND.PaletteSystem.DEFAULT, 1
        );
        this._applyWorldFor({ track: { id: "random-" + Date.now() } }, this.currentPalette);
      }
      this.planIdx = 0;
      this.beatIdx = 0;
      this.obstacles.reset();
      this.ui.flashOverlay(0.85, 900);
    }

    async _onSongEnded() {
      if (this.state.is(ND.State.LOADING) || this.state.is(ND.State.RESULTS)) return;
      if (this.music.clock() < this.music.duration() - 1.5 && !this._spuriousEnds) {
        this._spuriousEnds = 1;
        console.warn("[music] spurious ended — resuming");
        setTimeout(() => { this._spuriousEnds = 0; }, 3000);
        this.music.resumePlayback();
        return;
      }
      this._spuriousEnds = 0;
      if (!this.nextPrepared && this._preparing && this.transitionArmed) {
        const timeout = new Promise(res => setTimeout(res, 25000));
        await Promise.race([this._preparing.catch(() => null), timeout]);
      }
      const np = this.nextPrepared;
      if (np && this.transitionArmed) {
        if (!this.swapped) this._swapWorld();
        await this.music.play(np);
        this.ui.setNowPlaying(np.track);
        this.state.set(ND.State.TRANSITION);
      } else {
        this._finishRun();
      }
    }

    _finishRun() {
      this.score.setMaxCombo(this.combo.max);
      this.score.driftScore = this.drift.totalScore + this.stunts.totalScore;
      this.music.stop();
      this.tiles.reset();
      this.wormhole.end();
      if (this.mp) this.mp.onRunFinished();
      this.state.set(ND.State.RESULTS);
      this.ui.showResults(this.score.summary(), this.lastTrack);
      this.ui.hideHud();
    }

    _onHit(hit) {
      const typeCfg = C.TILE_TYPES[hit.tile.type];
      this.tiles.judgeHit(hit.tile, hit.quality);
      this.combo.onHit();
      const newScore = this.score.registerHit(hit.tile.type, hit.quality, this.combo.multiplier, this.car.speedNorm);
      this.car.applyHitGain(typeCfg.speedGain, this.combo.multiplier);
      this.car.chargeNitro(hit.quality === "PERFECT" ? 7 : hit.quality === "GREAT" ? 3.5 : 1.6);
      ND.bus.emit("judgement", hit.quality);
      ND.bus.emit("score-changed", newScore);
      this.rumble(0.35, 0.2, 60);

      if (hit.quality === "PERFECT") {
        this.audioFx.blip(1320, 0.09, "triangle", 0.05);
        this.audioFx.blip(1980, 0.07, "sine", 0.04);
        this.cameraSys.addShake(0.16);
        this.world.track.setPulse(Math.min(1.6, this.world.pulse + 0.5));
      } else if (hit.quality === "GREAT") {
        this.audioFx.blip(880, 0.06, "square", 0.028);
        this.cameraSys.addShake(0.08);
      } else {
        this.audioFx.blip(660, 0.05, "square", 0.02);
      }
      if (this.mp) this.mp.reportHit(hit.quality);
    }

    _onMiss() {
      this.combo.onMiss();
      this.score.registerMiss();
      this.car.applyMissPenalty();
      ND.bus.emit("judgement", "MISS");
      this.audioFx.blip(110, 0.16, "sawtooth", 0.05);
      this.world.sky.flash(0.05);
    }

    update(dt) {
      this._pollGamepad();

      if (this.showroomActive && this.showroomCar) {
        this.showroomAngle += dt * 0.55;
        this.showroomCar.group.rotation.y = this.showroomAngle;
        this.renderer.render(this.showroomScene, this.showroomCamera);
        return;
      }

      if (this.state.is(ND.State.MENU) || this.state.is(ND.State.RESULTS) || this.state.is(ND.State.LOADING)) {
        this.car.updateAttract(dt, this.curve);
        const bands = this.music.current ? this.music.bands() : null;
        const energy = bands ? bands.overall : 0.25 + Math.sin(ND.loop.elapsed * 0.8) * 0.08;
        this.world.update(dt, this.car.s, energy, this.car.speedNorm, this.car.mesh.group.position);
        this.cameraSys.update(dt, this.car, this.curve, "chase");
        this.skyFollow();
        
        // Update anime effects
        if (this.animeEffects) {
          const carDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.car.mesh.group.quaternion);
          this.animeEffects.update(dt, this.car.mesh.group.position, carDir, this.car.speedMs, false);
        }
        
        this.renderer.setSpeed(this.car.speedMs);
        this.renderer.render(this.scene, this.camera, dt, ND.loop.elapsed);
        return;
      }

      if (!this.state.is(ND.State.PLAYING) && !this.state.is(ND.State.TRANSITION)) {
        this.renderer.render(this.scene, this.camera, dt, ND.loop.elapsed);
        return;
      }

      const songTime = this.music.clock();
      const duration = this.music.duration();
      const remaining = Math.max(0, duration - songTime);
      const bands = this.music.bands();
      const energy = Math.max(bands.overall * 1.15, this.music.energyAt(songTime));
      const effInput = this._effectiveInput();

      const prevVel = this.car.velForward;
      if (this.mp && this.mp.inRun) {
        this.mp.applyHostClock(songTime);
      }
      this.car.update(dt, effInput, this.curve, this.world.track);
      this.car._lastAccel = (this.car.velForward - prevVel) / Math.max(dt, 1e-4);

      if (this.plan) {
        while (this.planIdx < this.plan.length && this.plan[this.planIdx].t < songTime - ND.Config.TIMING_WINDOWS.GOOD) {
          this.planIdx++;
        }
        const lookahead = THREE.MathUtils.clamp(this.car.speedMs * C.LOOKAHEAD_MAX_S, 60, C.MAX_SPAWN_DIST);
        const lookaheadS = lookahead / this.car.speedMs;
        while (this.planIdx < this.plan.length && this.plan[this.planIdx].t - songTime <= lookaheadS) {
          if (this.tiles.active.length < 64) {
            this.tiles.spawn(this.plan[this.planIdx], this.car.s, this.curve);
          }
          this.planIdx++;
        }
        while (this.beatIdx < this.plan.length && this.plan[this.beatIdx].t <= songTime) {
          const ev = this.plan[this.beatIdx];
          if (songTime - ev.t < 0.15) {
            this.world.reactBeat(ev.tile === "BASS" ? "bass" : ev.tile === "KICK" ? "kick" : ev.tile === "PERFECT" ? "kick" : "snare", ev.strength);
            this.car.reactBeat(ev.strength);
            ND.bus.emit("beat-pulse", ev.strength);
            this.rumble(ev.strength * 0.25, ev.strength * 0.15, 40);
          }
          this.beatIdx++;
        }
      }

      const hit = ND.HitDetector.evaluate(this.car.lat, songTime, this.tiles.active);
      if (hit) this._onHit(hit);

      this.drift.update(dt);
      this.obstacles.update(dt, this.car, this.curve, this.world.track, this.plan, songTime);
      this.traffic.update(dt, this.car, this.curve, this.plan, songTime);
      this.audioFx.update(dt, this.car, true);

      if (this.car.nitroActive && !this._nitroWasActive) {
        this.audioFx.nitroWhoosh();
      }
      this._nitroWasActive = this.car.nitroActive;

      const sectionsHot = this.music.analysis && this.music.analysis.sections.some(s =>
        songTime >= s.t && songTime < s.t + 4 && !s._fired);
      if (sectionsHot) {
        for (const s of this.music.analysis.sections) {
          if (songTime >= s.t && songTime < s.t + 4 && !s._fired) {
            s._fired = true;
            this.world.dropEvent();
            this.cameraSys.kickFov(9);
            this.world.track.forceRamp(this.car.s);
          }
        }
      }

      this.world.update(dt, this.car.s, energy, this.car.speedNorm, this.car.mesh.group.position);
      this.tiles.update(songTime, this.car.s, this.car.speedMs, dt, this.curve);
      this.lyrics.update(songTime, dt, this.car, this.curve);
      this.wormhole.update(dt);

      if (this.mp) this.mp.update(dt, this.car);

      if (!this.transitionArmed && remaining <= Math.max(C.WORMHOLE.ARM_AT, C.WORMHOLE.WARN_AT)) {
        this._armTransition();
      }

      if (this.wormhole.phase === "active") {
        if (this.swapped) {
          this.wormhole.updateFade(dt);
        } else {
          if (!this._tunnelBuilt && remaining <= C.WORMHOLE.TUNNEL_AT) {
            this._tunnelBuilt = true;
            this.wormhole.activate(this.curve, this.car.s);
          }
          if (this._tunnelBuilt) {
            this.wormhole.setStage(remaining, C.WORMHOLE.WARN_AT, C.WORMHOLE.TUNNEL_AT, C.WORMHOLE.ENTER_AT);
          }
        }
      }
      const wormCam = this.wormhole.phase === "active" &&
        (remaining <= C.WORMHOLE.ENTER_AT + 1.5 || this.state.is(ND.State.TRANSITION));
      this.cameraSys.setWormBlend(wormCam);
      if (!this._enterFx && remaining <= C.WORMHOLE.ENTER_AT) {
        this._enterFx = true;
        this.cameraSys.kickFov(12);
        this.cameraSys.addShake(0.5);
        this.ui.flashOverlay(0.28, 500);
        this.rumble(0.8, 0.6, 500);
      }
      if (remaining <= C.WORMHOLE.SWAP_AT && !this.swapped) {
        this._swapWorld();
      }

      if (this.state.is(ND.State.TRANSITION) && this.music.clock() > C.WORMHOLE.SETTLE_AT) {
        this.state.set(ND.State.PLAYING);
        this.transitionArmed = false;
        this.swapped = false;
        this._enterFx = false;
        this._tunnelBuilt = false;
        this.cameraSys.setWormBlend(false);
        this.wormhole.end();
      }

      this.cameraSys.update(dt, this.car, this.curve, "chase");
      this.skyFollow();
      
      // Update anime effects
      if (this.animeEffects) {
        const carDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.car.mesh.group.quaternion);
        const isDrifting = this.drift && this.drift.isDrifting;
        this.animeEffects.update(dt, this.car.mesh.group.position, carDir, this.car.speedMs, isDrifting);
        
        // Add drift shake
        if (isDrifting) {
          this.cameraSys.addDriftShake(Math.abs(this.car.latVel) / 50);
        }
      }
      
      this.renderer.setSpeed(this.car.speedMs);
      this.renderer.render(this.scene, this.camera, dt, ND.loop.elapsed);
    }

    skyFollow() {
      this.world.sky.mesh.position.copy(this.camera.position);
    }
  }

  ND.Game = Game;
})();
