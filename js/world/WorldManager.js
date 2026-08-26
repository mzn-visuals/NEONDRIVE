(function () {
  class WorldManager {
    constructor(scene, renderer) {
      this.scene = scene;
      this.renderer = renderer;
      this.palette = ND.PaletteSystem.DEFAULT;

      this.fog = new THREE.FogExp2(0x571e52, 0.0044);
      scene.fog = this.fog;
      this.baseFogDensity = 0.0044;

      this.hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.75);
      scene.add(this.hemi);
      this.dirLight = new THREE.DirectionalLight(0xffb37a, 0.9);
      this.dirLight.position.set(0, 40, -120);
      scene.add(this.dirLight);

      this.sky = new ND.Sky(scene);
      this.weather = new ND.Weather(scene, renderer);
      this.weather.skyRef = this.sky;
      this.curve = new ND.RoadCurve(1337);
      this.track = new ND.TrackGenerator(scene, "medium", this.curve);

      this.energySmooth = 0;
      this.pulse = 0;
      this.timeId = "sunset";
      this.levelCfg = ND.Config.LEVELS[0];

      this.water = null;
    }

    _makeWater() {
      const geo = new THREE.PlaneGeometry(640, 1500);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uDeep: { value: ND.srgb("#0a1030") },
          uGlow: { value: ND.srgb("#29e6ff") },
          uScroll: { value: 0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
          uniform float uTime, uScroll;
          uniform vec3 uDeep, uGlow;
          varying vec2 vUv;
          void main(){
            float y = vUv.y * 1500.0 - uScroll;
            float lines = sin(y * 0.09 + sin(uTime*0.8 + vUv.x*6.0)*1.4);
            float mask = smoothstep(0.55, 1.0, lines);
            float distFade = smoothstep(1.0, 0.25, vUv.y);
            vec3 col = mix(uDeep, uGlow * 0.85, mask * 0.5 * distFade);
            col += uGlow * 0.12 * distFade;
            gl_FragColor = vec4(col, 1.0);
          }
        `
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      return { mesh, mat };
    }

    build(opts) {
      const levelId = opts.levelId || "desert";
      const timeId = opts.timeId || "sunset";
      const weatherId = opts.weatherId || "clear";
      const palette = opts.palette || this.palette;
      const seed = opts.seed != null ? opts.seed : 1337;
      const keepCurve = !!opts.keepCurve && this.curve;

      if (!keepCurve) {
        this.curve = new ND.RoadCurve(seed);
        this.track.curve = this.curve;
      }
      this.levelCfg = ND.Config.LEVELS.find(l => l.id === levelId) || ND.Config.LEVELS[0];
      this.timeId = timeId;
      this.palette = palette;
      this.seed = seed;

      this.track.setLevel(this.levelCfg, weatherId, palette, seed);

      const preset = ND.TimeOfDay.get(timeId);
      this.sky.apply(preset, palette);
      this.weather.apply(weatherId, palette);
      this.track.setWetness(this.weather.wetness);

      this.fog.color.copy(ND.srgb(preset.fogColor));
      if (weatherId === "fog") {
        this.fog.color.lerp(ND.srgb("#9aa3c0"), 0.55);
      } else if (weatherId === "neon-mist") {
        this.fog.color.copy(palette.atmosphere).lerp(palette.primary, 0.25).multiplyScalar(1.8);
      } else if (weatherId === "dust") {
        this.fog.color.lerp(ND.srgb("#8a5c2e"), 0.62);
      }
      this.baseFogDensity = preset.fogDensity * (this.weather.fogDensityScale || 1);

      this.hemi.color.copy(ND.srgb(preset.hemiSky));
      this.hemi.groundColor.copy(ND.srgb(preset.hemiGround));
      this.hemi.intensity = preset.hemiIntensity;
      this.dirLight.color.copy(ND.srgb(preset.dirColor));
      this.dirLight.intensity = preset.dirIntensity;
      const el = preset.dirElevation;
      this.dirLight.position.set(Math.sin(el * 3) * 60, Math.max(14, Math.sin(el) * 90), -Math.cos(el) * 110);

      if (this.levelCfg.props === "coastal") {
        if (!this.water) this.water = this._makeWater();
        this.water.mesh.visible = true;
        this.water.mat.uniforms.uGlow.value.copy(palette.secondary);
        this.water.mat.uniforms.uDeep.value.copy(palette.dark).multiplyScalar(2.2);
      } else if (this.water) {
        this.water.mesh.visible = false;
      }
    }

    setPaletteImmediate(palette) {
      this.palette = palette;
      this.track.setPalette(palette);
      if (this.water && this.water.mesh.visible) {
        this.water.mat.uniforms.uGlow.value.copy(palette.secondary);
      }
    }

    reactBeat(type, strength) {
      const amount = strength * (type === "kick" ? 0.9 : type === "bass" ? 1.15 : type === "snare" ? 0.55 : 0.25);
      this.pulse = Math.min(this.pulse + amount, 1.6);
    }

    dropEvent() {
      this.pulse = 1.6;
      this.sky.flash(0.32);
    }

    update(dt, carS, energy, speedNorm, carPos) {
      this.energySmooth += (energy - this.energySmooth) * Math.min(1, dt * 3);
      this.pulse *= Math.pow(0.06, dt);

      this.sky.update(dt);
      this.track.update(carS);
      this.track.setPulse(this.pulse);
      this.track.setEnergy(this.energySmooth);
      this.weather.update(dt, this.energySmooth, carPos);
      this.track.setWetness(this.weather.wetness);

      this.fog.density = this.baseFogDensity * (1 + this.energySmooth * 0.12);

      this.hemi.intensity = ND.TimeOfDay.get(this.timeId).hemiIntensity *
        (1 + this.pulse * 0.18);

      if (this.water && this.water.mesh.visible) {
        const f = this.curve.frameAt(carS + 260);
        this.water.mesh.position.set(f.pos.x + f.right.x * -340, f.pos.y - 1.4, f.pos.z + f.right.z * -340);
        this.water.mesh.rotation.z = -f.h;
        this.water.mat.uniforms.uTime.value += dt;
      }

      return this.energySmooth;
    }

    get drawDistance() {
      return ND.Config.QUALITY[this.renderer.quality].drawDistance;
    }
  }

  ND.WorldManager = WorldManager;
})();
