(function () {
  const $ = id => document.getElementById(id);

  class UI {
    constructor(game) {
      this.game = game;
      this.screens = {
        main: $("screenMain"),
        music: $("screenMusic"),
        coop: $("screenCoop"),
        cars: $("screenCars"),
        worlds: $("screenWorlds"),
        settings: $("screenSettings"),
        loading: $("screenLoading"),
        pause: $("screenPause"),
        results: $("screenResults")
      };
      this.hud = $("hud");
      this.toastEl = $("toast");
      this._toastT = 0;
      this._judgeCount = 0;
      this.settings = this._loadSettings();

      this._buildWorldCards();
      this._buildTimeChips();
      this._buildWeatherChips();
      this._bindNav();
      this._bindMusicScreen();
      this._bindOsk();
      this._bindPadNav();
      this._bindCoopScreen();
      this._bindCarScreen();
      this._bindPause();
      this._bindResults();
      this._applySettingsToDom();
      this._bindHudEvents();

      ND.bus.on("state", (s) => {
        if (s !== ND.State.PLAYING && s !== ND.State.TRANSITION) {
          this.hideHud();
        }
      });

      ND.bus.on("combo-changed", (count, mult) => {
        $("comboNum").textContent = count;
        $("comboMult").textContent = "×" + mult.toFixed(1);
        $("hudCombo").classList.toggle("live", count >= 5);
      });
      ND.bus.on("combo-tier", () => {
        const el = $("hudCombo");
        el.classList.remove("combo-shake");
        void el.offsetWidth;
        el.classList.add("combo-shake");
      });
      ND.bus.on("judgement", (q, points) => this._judge(q));
      ND.bus.on("score-changed", s => { $("hudScore").textContent = String(s); });
      ND.bus.on("queue-changed", (queue, isRadio) => this._renderQueue(queue, isRadio));
      ND.bus.on("toast", msg => this.toast(msg));

      ND.loop.add((dt) => this._frame(dt));
    }

    _loadSettings() {
      let s = {};
      try { s = JSON.parse(localStorage.getItem(ND.Config.STORE_KEYS.settings) || "{}"); } catch (_) {}
      return {
        volume: s.volume != null ? s.volume : 0.8,
        quality: s.quality || "medium",
        difficulty: s.difficulty || "normal",
        lyrics: s.lyrics !== false,
        proxyUrl: s.proxyUrl || "",
        carIndex: s.carIndex || 0,
        levelId: s.levelId || "desert",
        timeId: s.timeId || "sunset",
        weatherId: s.weatherId || "clear",
        mode: s.mode || "single",
        camera: s.camera || "chase",
        shake: s.shake != null ? s.shake : 1,
        fovScale: s.fovScale != null ? s.fovScale : 1,
        speedo: s.speedo || "digital"
      };
    }

    saveSettings() {
      try {
        localStorage.setItem(ND.Config.STORE_KEYS.settings, JSON.stringify(this.settings));
      } catch (_) {}
    }

    _applySettingsToDom() {
      $("volSlider").value = Math.round(this.settings.volume * 100);
      $("qualitySel").value = this.settings.quality;
      $("difficultySel").value = this.settings.difficulty;
      $("lyricsToggle").checked = this.settings.lyrics;
      $("proxyInput").value = this.settings.proxyUrl;
      $("cameraSel").value = this.settings.camera;
      $("shakeSel").value = String(this.settings.shake);
      $("fovSlider").value = Math.round(this.settings.fovScale * 100);

      $("cameraSel").addEventListener("change", e => {
        this.settings.camera = e.target.value;
        ND.bus.emit("settings-camera", this.settings.camera);
        this.saveSettings();
      });
      $("shakeSel").addEventListener("change", e => {
        this.settings.shake = +e.target.value;
        ND.bus.emit("settings-shake", this.settings.shake);
        this.saveSettings();
      });
      $("fovSlider").addEventListener("input", e => {
        this.settings.fovScale = (+e.target.value) / 100;
        ND.bus.emit("settings-fov", this.settings.fovScale);
        this.saveSettings();
      });
      $("volSlider").addEventListener("input", e => {
        this.settings.volume = (+e.target.value) / 100;
        ND.bus.emit("settings-volume", this.settings.volume);
        this.saveSettings();
      });
      $("qualitySel").addEventListener("change", e => {
        this.settings.quality = e.target.value;
        ND.bus.emit("settings-quality", this.settings.quality);
        this.saveSettings();
      });
      $("difficultySel").addEventListener("change", e => {
        this.settings.difficulty = e.target.value;
        this.saveSettings();
      });
      $("lyricsToggle").addEventListener("change", e => {
        this.settings.lyrics = e.target.checked;
        ND.bus.emit("settings-lyrics", this.settings.lyrics);
        this.saveSettings();
      });
      let proxyDebounce = 0;
      $("proxyInput").addEventListener("input", e => {
        clearTimeout(proxyDebounce);
        proxyDebounce = setTimeout(() => {
          this.settings.proxyUrl = e.target.value.trim();
          this.saveSettings();
          ND.bus.emit("settings-proxy", this.settings.proxyUrl);
        }, 600);
      });
    }

    _bindNav() {
      document.querySelectorAll("[data-nav]").forEach(btn => {
        btn.addEventListener("click", () => this.show(btn.dataset.nav));
      });
    }

    show(name) {
      for (const [key, el] of Object.entries(this.screens)) {
        el.classList.toggle("hidden", key !== name);
      }
      if (name === "main") this.game.enterAttract();
      if (name === "cars") this.game.showroomMode(true);
      else this.game.showroomMode(false);
      if (name === "music") {
        setTimeout(() => $("searchInput").focus(), 60);
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const hasPad = [...pads].some(p => p);
        if (hasPad) $("osk").classList.remove("hidden");
      }
    }

    hideAll() {
      for (const el of Object.values(this.screens)) el.classList.add("hidden");
    }

    hideHud() { this.hud.classList.add("hidden"); }
    showHud() { this.hud.classList.remove("hidden"); }

    toast(msg, ms = 2600) {
      this.toastEl.textContent = msg;
      this.toastEl.classList.remove("hidden");
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.toastEl.classList.add("hidden"), ms);
    }

    setProxyStatus(text, cls) {
      const el = $("proxyStatus");
      el.textContent = text;
      el.className = "menu-hint" + (cls ? " " + cls : "");
    }

    _buildWorldCards() {
      const grid = $("worldGrid");
      grid.innerHTML = "";
      for (const lvl of ND.Config.LEVELS) {
        const card = document.createElement("div");
        card.className = "world-card" + (lvl.id === this.settings.levelId ? " sel" : "");
        card.style.setProperty("--wc1", lvl.wc1);
        card.style.setProperty("--wc2", lvl.wc2);
        card.innerHTML = `<h4></h4><p></p>`;
        card.querySelector("h4").textContent = lvl.name;
        card.querySelector("p").textContent = lvl.desc;
        card.addEventListener("click", () => {
          this.settings.levelId = lvl.id;
          grid.querySelectorAll(".world-card").forEach(c => c.classList.remove("sel"));
          card.classList.add("sel");
          this.saveSettings();
          this.game.previewWorld();
        });
        grid.appendChild(card);
      }
    }

    _buildTimeChips() {
      const wrap = $("timeChips");
      wrap.innerHTML = "";
      for (const t of ND.Config.TIMEOFDAY) {
        const chip = document.createElement("button");
        chip.className = "chip" + (t === this.settings.timeId ? " sel" : "");
        chip.textContent = t.toUpperCase().replace("-", " ");
        chip.addEventListener("click", () => {
          this.settings.timeId = t;
          wrap.querySelectorAll(".chip").forEach(c => c.classList.remove("sel"));
          chip.classList.add("sel");
          this.saveSettings();
          this.game.previewWorld();
        });
        wrap.appendChild(chip);
      }
    }

    _buildWeatherChips() {
      const wrap = $("weatherChips");
      wrap.innerHTML = "";
      for (const w of ND.Config.WEATHER) {
        const chip = document.createElement("button");
        chip.className = "chip" + (w === this.settings.weatherId ? " sel" : "");
        chip.textContent = w.toUpperCase().replace("-", " ");
        chip.addEventListener("click", () => {
          this.settings.weatherId = w;
          wrap.querySelectorAll(".chip").forEach(c => c.classList.remove("sel"));
          chip.classList.add("sel");
          this.saveSettings();
          this.game.previewWorld();
        });
        wrap.appendChild(chip);
      }
    }

    _bindMusicScreen() {
      const input = $("searchInput");
      const doSearch = async () => {
        const q = input.value.trim();
        if (!q) return;
        const status = $("searchStatus");
        status.className = "status-line";
        const proxy = this.game.providers.proxy;
        if (proxy.extractVideoId(q)) {
          status.textContent = "RESOLVING LINK…";
          try {
            const linkTrack = await proxy.lookupLink(q);
            status.textContent = "";
            this._renderResults([linkTrack], true);
            return;
          } catch (e) {
            status.className = "status-line error";
            status.textContent = "COULD NOT RESOLVE THAT LINK — " + e.message.toUpperCase();
            return;
          }
        }
        status.textContent = "SEARCHING…";
        try {
          const tracks = await proxy.search(q);
          status.textContent = `${tracks.length} RESULTS — HOVER TO PRELOAD · CLICK TO SELECT`;
          this._renderResults(tracks);
        } catch (e) {
          status.className = "status-line error";
          status.textContent = "MUSIC SERVICE UNAVAILABLE — CHECK YOUR CONNECTION / PROXY. LOCAL FILES STILL WORK.";
        }
      };
      $("searchBtn").addEventListener("click", doSearch);
      input.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

      $("localFileBtn").addEventListener("click", () => $("localFileInput").click());
      $("localFileInput").addEventListener("change", e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const track = this.game.providers.local.makeTrack(f);
        this.pickTrack(track, null);
        $("searchStatus").textContent = `LOCAL FILE LOADED — ${track.title}`;
      });

      document.querySelectorAll("#modeChips .chip").forEach(chip => {
        if (chip.dataset.mode === this.settings.mode) {
          document.querySelectorAll("#modeChips .chip").forEach(c => c.classList.remove("sel"));
          chip.classList.add("sel");
        }
        chip.addEventListener("click", () => {
          document.querySelectorAll("#modeChips .chip").forEach(c => c.classList.remove("sel"));
          chip.classList.add("sel");
          this.settings.mode = chip.dataset.mode;
          this.saveSettings();
          this.game.setMode(this.settings.mode);
        });
      });

      $("driveBtn").addEventListener("click", () => {
        if (!this.pickedTrack) return;
        let session = null;
        const mp = this.game.mp;
        if (mp && mp.enabled && mp.net && mp.net.isHost) {
          session = {
            track: { id: this.pickedTrack.id, title: this.pickedTrack.title, artist: this.pickedTrack.artist, pic: this.pickedTrack.thumbnail },
            levelId: this.settings.levelId,
            timeId: this.settings.timeId,
            weatherId: this.settings.weatherId,
            difficulty: this.settings.difficulty,
            rhythmSeed: (Math.random() * 0xffffffff) >>> 0
          };
          mp.session = session;
          mp.net.broadcastSession(session);
        }
        this.game.startRun(this.pickedTrack, session);
      });
    }

    _renderResults(tracks, single) {
      const wrap = $("searchResults");
      wrap.innerHTML = "";
      $("queuePreview").classList.toggle("hidden", !single);
      for (const track of tracks) {
        const el = document.createElement("div");
        el.className = "sResult";
        const thumb = document.createElement("img");
        thumb.className = "sThumb";
        if (track.thumbnail) {
          thumb.src = track.thumbnail;
          thumb.onerror = () => { thumb.removeAttribute("src"); thumb.classList.add("sThumb-placeholder"); thumb.textContent = "♪"; };
        }
        const meta = document.createElement("div");
        meta.innerHTML = `<div class="sTitle"></div><div class="sArtist"></div>`;
        meta.querySelector(".sTitle").textContent = track.title;
        meta.querySelector(".sArtist").textContent = track.artist;
        const dur = document.createElement("div");
        dur.className = "sDur";
        dur.textContent = ND.formatDuration(track.duration);
        el.append(thumb, meta, dur);
        let prewarmed = false;
        el.addEventListener("mouseenter", () => {
          if (prewarmed || !track.id || track.source === "local") return;
          prewarmed = true;
          this.game.providers.proxy.prewarm(track);
        });
        el.addEventListener("click", () => {
          this.pickTrack(track, el);
        });
        wrap.appendChild(el);
      }
    }

    pickTrack(track, el) {
      this.pickedTrack = track;
      document.querySelectorAll(".sResult.active").forEach(r => r.classList.remove("active"));
      if (el) el.classList.add("active");
      $("pickedTrack").classList.remove("hidden");
      $("driveBtn").classList.remove("hidden");
      $("pickedTitle").textContent = track.title;
      $("pickedArtist").textContent = track.artist || (track.source === "local" ? "Local file" : "");
      const img = $("pickedThumb");
      if (track.thumbnail) { img.src = track.thumbnail; img.style.display = ""; }
      else img.style.display = "none";
      this.game.setMode(this.settings.mode);
    }

    _renderQueue(queue, isRadio) {
      const preview = $("queuePreview");
      if (!this.pickedTrack || !queue.length) {
        preview.classList.add("hidden");
        return;
      }
      preview.classList.remove("hidden");
      const list = $("queueList");
      list.innerHTML = "";
      const label = preview.querySelector(".qp-label");
      label.textContent = isRadio ? "UP NEXT · RADIO MIX" : "UP NEXT · QUEUE";
      for (const t of queue.slice(0, 6)) {
        const row = document.createElement("div");
        row.className = "qItem";
        row.innerHTML = "<span></span><span></span>";
        row.children[0].textContent = `${t.title} — ${t.artist}`;
        row.children[1].textContent = ND.formatDuration(t.duration);
        list.appendChild(row);
      }
    }

    _bindHudEvents() {
      ND.bus.on("drift-tick", (pts) => {
        const el = $("hudDrift");
        el.classList.remove("hidden");
        $("driftPts").textContent = pts;
      });
      ND.bus.on("drift-scored", () => {
        setTimeout(() => $("hudDrift").classList.add("hidden"), 900);
      });
      ND.bus.on("drift-start", () => {
        $("driftPts").textContent = "0";
      });
    }

    _bindCoopScreen() {
      $("coopHostBtn").addEventListener("click", async () => {
        const username = $("coopUsernameInput").value.trim().toUpperCase() || "DRIVER";
        $("coopStatus").textContent = "CONNECTING…";
        try {
          const code = await this.game.mp.host(username, this.settings.carIndex || 0);
          this._enterCoopRoom(code, true);
        } catch (e) {
          $("coopStatus").textContent = "CO-OP SERVER UNREACHABLE — start it with: node multiplayer/server.js";
        }
      });
      $("coopJoinBtn").addEventListener("click", async () => {
        const username = $("coopJoinUsernameInput").value.trim().toUpperCase() || "DRIVER";
        const code = $("coopCodeInput").value.trim().toUpperCase();
        if (code.length !== 4) { $("coopStatus").textContent = "ENTER A 4-LETTER ROOM CODE"; return; }
        $("coopStatus").textContent = "CONNECTING…";
        try {
          await this.game.mp.join(code, username, this.settings.carIndex || 0);
          this._enterCoopRoom(code, false);
        } catch (e) {
          $("coopStatus").textContent = "JOIN FAILED — " + e.message.toUpperCase();
        }
      });
      $("coopLeaveBtn").addEventListener("click", () => {
        this.game.mp.leave();
        $("coopRoom").classList.add("hidden");
        $("coopActions").classList.remove("hidden");
        $("coopStatus").textContent = "Left the room.";
      });

      ND.bus.on("mp-session", session => {
        if (!this.game.mp.net || !this.game.mp.net.isHost) {
          this.settings.levelId = session.levelId;
          this.settings.timeId = session.timeId;
          this.settings.weatherId = session.weatherId;
          this.settings.difficulty = session.difficulty;
          this.saveSettings();
          const track = ND.Track.normalize({
            id: session.track.id, title: session.track.title,
            artist: session.track.artist || "", pic: session.track.pic || ""
          }, "youtube-music");
          this.pickTrack(track, null);
          ND.bus.emit("toast", "HOST STARTED — " + session.track.title.toUpperCase());
          this.game.startRun(track, session);
        }
      });
    }

    _enterCoopRoom(code, isHost) {
      $("coopStatus").textContent = "";
      $("coopActions").classList.add("hidden");
      $("coopRoom").classList.remove("hidden");
      $("coopCode").textContent = code;
      $("coopNote").textContent = isHost
        ? "Share this code. Pick a song on the MUSIC screen and press START ENGINE — everyone rides together."
        : "Waiting for the host to start a song…";
      const render = players => {
        const wrap = $("coopPlayers");
        wrap.innerHTML = "";
        for (const p of players) {
          const row = document.createElement("div");
          row.className = "coop-player" + (p.id === this.game.mp.net.id ? " host" : "");
          row.innerHTML = "<span></span><span></span>";
          row.children[0].textContent = p.name;
          row.children[1].textContent = (ND.Config.CARS[p.carIndex] || ND.Config.CARS[0]).name;
          wrap.appendChild(row);
        }
      };
      render(this.game.mp.net.players);
      this.game.mp.net.on("lobby", render);
    }

    _drawSpeedo(kmh, maxSpeed, nitro) {
      const cv = $("speedoAnalog");
      const ctx = cv.getContext("2d");
      const w = 170, cx = 85, cy = 92, r = 66;
      ctx.clearRect(0, 0, w, 170);
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();
      const maxTick = Math.ceil(maxSpeed / 50) * 50;
      for (let v = 0; v <= maxTick; v += 50) {
        const a = Math.PI * 0.75 + (v / maxTick) * Math.PI * 1.5;
        const inner = v % 100 === 0 ? r - 12 : r - 7;
        ctx.strokeStyle = v >= maxSpeed ? "#ff5d3d" : "rgba(255,255,255,.6)";
        ctx.lineWidth = v % 100 === 0 ? 2.5 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
        if (v % 100 === 0) {
          ctx.fillStyle = "rgba(255,255,255,.55)";
          ctx.font = "10px Orbitron, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(String(v), cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22) + 3);
        }
      }
      const frac = THREE.MathUtils.clamp(kmh / maxTick, 0, 1);
      const a = Math.PI * 0.75 + frac * Math.PI * 1.5;
      ctx.strokeStyle = nitro ? "#b3ffff" : "#ff2fd6";
      ctx.lineWidth = 3.4;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.font = "700 15px Orbitron, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(Math.round(kmh)), cx, cy + 26);
    }

    _drawSpeedo(car) {
      const cv = $("speedoAnalog");
      const ctx = cv.getContext("2d");
      const S = 300, cx = 150, cy = 150;
      ctx.clearRect(0, 0, S, S);

      const maxTick = Math.ceil(car.maxSpeed / 60) * 60;
      const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
      const kmh = Math.max(0, car.speedKmh);
      const frac = THREE.MathUtils.clamp(kmh / maxTick, 0, 1);

      ctx.beginPath();
      ctx.arc(cx, cy, 118, a0, a0 + sweep);
      ctx.strokeStyle = "rgba(255,255,255,.13)";
      ctx.lineWidth = 3;
      ctx.stroke();

      const redlineStart = 0.86;
      ctx.beginPath();
      ctx.arc(cx, cy, 118, a0 + sweep * redlineStart, a0 + sweep);
      ctx.strokeStyle = "rgba(255,93,61,.5)";
      ctx.lineWidth = 3;
      ctx.stroke();

      const nitroFrac = car.nitroMeter / (car.cfg.nitroCapacity || 100);
      ctx.beginPath();
      ctx.arc(cx, cy, 128, a0, a0 + sweep * nitroFrac);
      ctx.strokeStyle = nitroFrac > 0.98 ? "#b3ffff" : "#29e6ff";
      ctx.lineWidth = 5;
      ctx.shadowColor = "#29e6ff";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      for (let v = 0; v <= maxTick; v += 20) {
        const a = a0 + (v / maxTick) * sweep;
        const major = v % 60 === 0;
        const inner = major ? 103 : 110;
        ctx.strokeStyle = v / maxTick >= redlineStart ? "rgba(255,93,61,.8)" : "rgba(255,255,255,.55)";
        ctx.lineWidth = major ? 2.4 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * 116, cy + Math.sin(a) * 116);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = "rgba(255,255,255,.5)";
          ctx.font = "600 11px Orbitron, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(v), cx + Math.cos(a) * 88, cy + Math.sin(a) * 88);
        }
      }

      const na = a0 + frac * sweep;
      ctx.strokeStyle = frac > redlineStart ? "#ff5d3d" : "#ffffff";
      ctx.lineWidth = 3.4;
      ctx.shadowColor = frac > redlineStart ? "#ff5d3d" : "#29e6ff";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(na) * 14, cy - Math.sin(na) * 14);
      ctx.lineTo(cx + Math.cos(na) * 96, cy + Math.sin(na) * 96);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = "900 44px Orbitron, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String(Math.round(kmh)), cx, cy + 62);
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.font = "600 10px Orbitron, sans-serif";
      ctx.fillText("KM/H", cx, cy + 78);

      ctx.fillStyle = car.nitroActive ? "#b3ffff" : "#7d6fa8";
      ctx.font = "900 20px Orbitron, sans-serif";
      ctx.fillText(String(car.gear), cx, cy - 34);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.font = "600 8px Orbitron, sans-serif";
      ctx.fillText("GEAR", cx, cy - 18);

      if (car.nitroActive) {
        ctx.fillStyle = "#29e6ff";
        ctx.font = "700 11px Orbitron, sans-serif";
        ctx.fillText("NOS", cx, cy - 52);
      }
    }

    _bindOsk() {
      const rows = {
        abc1: "ABCDEFGHIJKLM".split(""),
        abc2: "NOPQRSTUVWXYZ".split(""),
        num: "0123456789".split("")
      };
      document.querySelectorAll("#osk .osk-row").forEach(row => {
        const keys = rows[row.dataset.row] || [];
        for (const k of keys) {
          const b = document.createElement("button");
          b.className = "osk-key";
          b.textContent = k;
          b.dataset.k = k;
          row.appendChild(b);
        }
      });

      const input = $("searchInput");
      $("oskToggle").addEventListener("click", () => {
        $("osk").classList.toggle("hidden");
        if (!$("osk").classList.contains("hidden")) {
          $("osk").querySelector(".osk-key").focus();
        }
      });

      $("osk").addEventListener("click", e => {
        const key = e.target.closest(".osk-key");
        if (!key) return;
        const k = key.dataset.k;
        if (k === "BACK") input.value = input.value.slice(0, -1);
        else if (k === "CLEAR") input.value = "";
        else if (k === "SEARCH") $("searchBtn").click();
        else input.value += k;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    _bindPadNav() {
      this._padPrev = {};
      this._padFocusIdx = -1;
      ND.loop.add(() => this._pollPadNav());
    }

    _pollPadNav() {
      const st = ND.gameState;
      if (st.is(ND.State.PLAYING) || st.is(ND.State.TRANSITION) || st.is(ND.State.LOADING)) {
        this._padPrev = {};
        return;
      }
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      for (const p of pads) if (p) { pad = p; break; }
      if (!pad) { this._padPrev = {}; return; }

      const btn = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const axY = pad.axes[1] || 0;
      const axX = pad.axes[0] || 0;
      const up = btn(12) || axY < -0.55;
      const down = btn(13) || axY > 0.55;
      const left = btn(14) || axX < -0.55;
      const right = btn(15) || axX > 0.55;
      const a = btn(0);
      const b = btn(1);

      const screen = document.querySelector(".screen:not(.hidden)");
      if (!screen) return;
      const focusables = [...screen.querySelectorAll("button")].filter(el =>
        el.offsetParent !== null && !el.classList.contains("hidden"));
      if (!focusables.length) return;

      const edge = (name, cur) => {
        const was = this._padPrev[name];
        this._padPrev[name] = cur;
        return cur && !was;
      };

      if (edge("up", up) || edge("left", left)) this._movePadFocus(focusables, -1);
      if (edge("down", down) || edge("right", right)) this._movePadFocus(focusables, 1);
      if (edge("a", a)) {
        const el = document.activeElement;
        if (el && screen.contains(el) && el.tagName === "BUTTON") el.click();
      }
      if (edge("b", b)) {
        const back = screen.querySelector(".back-btn");
        if (back) back.click();
      }
    }

    _movePadFocus(list, dir) {
      const cur = document.activeElement;
      let idx = list.indexOf(cur);
      idx = idx === -1 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
      const el = list[idx];
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    }

    _bindCarScreen() {
      const render = () => {
        const car = ND.Config.CARS[this.settings.carIndex];
        $("carName").textContent = car.name;
        $("statSpeedVal").textContent = car.maxSpeed;
        $("statSpeed").style.width = ((car.maxSpeed - 240) / 130 * 100).toFixed(0) + "%";
        $("statAccel").style.width = (car.accel * 100).toFixed(0) + "%";
        $("statHandling").style.width = (car.handling * 100).toFixed(0) + "%";
        $("carDesc").textContent = car.desc;
      };
      $("carPrev").addEventListener("click", () => {
        this.settings.carIndex = (this.settings.carIndex - 1 + ND.Config.CARS.length) % ND.Config.CARS.length;
        render();
        this.game.selectCar(this.settings.carIndex);
        this.saveSettings();
      });
      $("carNext").addEventListener("click", () => {
        this.settings.carIndex = (this.settings.carIndex + 1) % ND.Config.CARS.length;
        render();
        this.game.selectCar(this.settings.carIndex);
        this.saveSettings();
      });
      render();
    }

    _bindPause() {
      $("resumeBtn").addEventListener("click", () => this.game.resume());
      $("restartBtn").addEventListener("click", () => this.game.restart());
      $("quitBtn").addEventListener("click", () => this.game.quitToMenu());
    }

    _bindResults() {
      $("againBtn").addEventListener("click", () => this.game.driveAgain());
      $("resMenuBtn").addEventListener("click", () => this.game.quitToMenu());
    }

    showLoading() {
      this.hideAll();
      this.screens.loading.classList.remove("hidden");
      this.setLoadStep("fetch", 0);
    }

    setNowPlaying(track) {
      $("hudTitle").textContent = track.title || "—";
      $("hudArtist").textContent = track.artist || "—";
      const img = $("hudThumb");
      if (track.thumbnail) { img.src = track.thumbnail; img.style.display = ""; }
      else img.style.display = "none";
      $("hudScore").textContent = "0";
      $("comboNum").textContent = "0";
      $("comboMult").textContent = "×1.0";
      $("hudCombo").classList.remove("live");
    }

    setLoadStep(step, progress) {
      const order = ["fetch", "analyze", "colors", "world", "road"];
      const steps = $("loadSteps").querySelectorAll("li");
      const idx = order.indexOf(step);
      steps.forEach((li, i) => {
        li.classList.toggle("done", i < idx);
        li.classList.toggle("active", i === idx);
      });
      const overall = (idx + Math.min(1, progress || 0)) / order.length;
      $("loadFill").style.width = (overall * 100).toFixed(1) + "%";
    }

    setLoadingSong(track) {
      $("loadSongTitle").textContent =
        `${track.title} — ${track.artist}`.toUpperCase().slice(0, 52) || "LOADING TRACK";
    }

    setLoadDone() {
      $("loadFill").style.width = "100%";
      $("loadSteps").querySelectorAll("li").forEach(li => {
        li.classList.remove("active");
        li.classList.add("done");
      });
    }

    showResults(summary, track) {
      this.hideAll();
      this.screens.results.classList.remove("hidden");
      $("resScore").textContent = summary.score.toLocaleString();
      $("resMaxCombo").textContent = summary.maxCombo;
      $("resAcc").textContent = summary.accuracy.toFixed(1) + "%";
      $("cntPerfect").textContent = summary.counts.PERFECT;
      $("cntGreat").textContent = summary.counts.GREAT;
      $("cntGood").textContent = summary.counts.GOOD;
      $("cntMiss").textContent = summary.counts.MISS;
      $("resSong").textContent = track ? `${track.title} — ${track.artist}` : "";
    }

    showPause(show) {
      this.screens.pause.classList.toggle("hidden", !show);
    }

    flashOverlay(opacity, fadeMs) {
      const el = $("flashOverlay");
      el.style.transition = "opacity 60ms linear";
      el.style.opacity = opacity;
      setTimeout(() => {
        el.style.transition = `opacity ${fadeMs}ms ease-out`;
        el.style.opacity = 0;
      }, 90);
    }

    updateProgress(fraction, remainingSec) {
      $("progressFill").style.width = (fraction * 100).toFixed(2) + "%";
      const mark = $("wormMark");
      mark.style.display = remainingSec <= ND.Config.WORMHOLE.WARN_AT ? "block" : "none";
      mark.style.left = `calc(${Math.max(0, (fraction * 100) - 3)}% )`;
    }

    _judge(q) {
      const layer = $("judgeLayer");
      const div = document.createElement("div");
      div.className = "judge " + q;
      div.textContent = q;
      layer.appendChild(div);
      setTimeout(() => div.remove(), 720);
    }

    _frame() {
      if (this.game.state.is(ND.State.PLAYING) || this.game.state.is(ND.State.TRANSITION)) {
        this._drawSpeedo(this.game.car);
        const dur = this.game.music.duration();
        if (dur > 0) {
          this.updateProgress(this.game.music.clock() / dur, this.game.music.remaining());
        }
      }
    }
  }

  ND.UI = UI;
})();
