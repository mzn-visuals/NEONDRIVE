(function () {
  const SKY_VERT = `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const SKY_FRAG = `
    uniform vec3 uTop, uMid, uHorizon, uSunColor;
    uniform vec3 uSunDirection;
    uniform float uSunSize, uStripes, uStars, uFlash, uTime;
    varying vec3 vDir;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      float h = clamp(vDir.y, -0.12, 1.0);
      float t1 = smoothstep(-0.02, 0.24, h);
      float t2 = smoothstep(0.16, 0.75, h);
      vec3 col = mix(uHorizon, uMid, t1);
      col = mix(col, uTop, t2);

      if (vDir.y < 0.02 && vDir.y > -0.2) {
        col += uHorizon * 0.22 * (1.0 - abs(vDir.y) * 6.0);
      }

      float sunAmt = dot(normalize(vDir), normalize(uSunDirection));
      float disc = smoothstep(1.0 - uSunSize * 0.014, 1.0 - uSunSize * 0.014 + 0.0016, sunAmt);
      float glow = pow(max(sunAmt, 0.0), 40.0) * 0.5 + pow(max(sunAmt, 0.0), 8.0) * 0.18;

      if (disc > 0.0) {
        vec3 sunDirLocal = normalize(vDir);
        float stripeCut = 1.0;
        if (uStripes > 0.01 && sunDirLocal.y < uSunDirection.y + uSunSize * 0.004) {
          float bandCoord = (sunDirLocal.y + 1.4) * 90.0;
          float band = fract(bandCoord);
          float cut = step(band, uStripes * 0.62);
          float widen = smoothstep(uSunDirection.y + uSunSize * 0.004, uSunDirection.y - 0.05, sunDirLocal.y);
          stripeCut = 1.0 - cut * widen;
        }
        disc *= stripeCut;
      }

      col += uSunColor * (glow * (1.0 - disc * 0.35));
      col = mix(col, uSunColor * 1.35, disc);

      if (uStars > 0.01) {
        vec2 sp = floor(vDir.xz / max(abs(vDir.y), 0.06) * 42.0);
        float star = hash(sp);
        float twinkle = 0.65 + 0.35 * sin(uTime * 1.7 + star * 62.0);
        float starMask = step(0.9955 - uStars * 0.002, hash(sp + 7.31));
        float upMask = smoothstep(0.08, 0.3, vDir.y);
        col += vec3(0.85, 0.9, 1.0) * starMask * twinkle * uStars * upMask * 0.85;
      }

      col += vec3(0.9, 0.95, 1.0) * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  class Sky {
    constructor(scene) {
      this.uniforms = {
        uTop: { value: ND.srgb("#241046") },
        uMid: { value: ND.srgb("#a13d9b") },
        uHorizon: { value: ND.srgb("#ff7448") },
        uSunColor: { value: ND.srgb("#ffcf8f") },
        uSunDirection: { value: new THREE.Vector3(0, 0.115, -1).normalize() },
        uSunSize: { value: 0.34 },
        uStripes: { value: 0.55 },
        uStars: { value: 0.15 },
        uFlash: { value: 0 },
        uTime: { value: 0 }
      };
      this.mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1000, 32, 20),
        new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          side: THREE.BackSide,
          depthWrite: false,
          fog: false
        })
      );
      scene.add(this.mesh);
    }

    apply(preset, palette) {
      const u = this.uniforms;
      u.uTop.value.copy(ND.srgb(preset.skyTop));
      u.uMid.value.copy(ND.srgb(preset.skyMid));
      u.uHorizon.value.copy(ND.srgb(preset.horizon));
      const sunOrMoon = preset.moonMode ? preset.moonColor : preset.sunColor;
      u.uSunColor.value.copy(ND.srgb(sunOrMoon));
      u.uSunSize.value = preset.sunSize;
      u.uStripes.value = preset.stripes || 0;
      u.uStars.value = preset.stars || 0;

      const az = 0;
      u.uSunDirection.value.set(
        Math.sin(az) * Math.cos(preset.sunElevation),
        Math.sin(preset.sunElevation),
        -Math.cos(az) * Math.cos(preset.sunElevation)
      ).normalize();
    }

    update(dt) {
      this.uniforms.uTime.value += dt;
    }

    pulse() {}
    flash(v) { this.uniforms.uFlash.value = v; }
  }

  ND.Sky = Sky;
})();
