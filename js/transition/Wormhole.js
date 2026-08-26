(function () {
  class Wormhole {
    constructor(scene) {
      this.scene = scene;
      this.phase = "idle";
      this.nextPalette = null;
      this.tube = null;

      this.uniforms = {
        uTime: { value: 0 },
        uColorA: { value: ND.srgb("#ff2fd6") },
        uColorB: { value: ND.srgb("#29e6ff") },
        uIntensity: { value: 0 },
        uStretch: { value: 0 }
      };
      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
          uniform float uTime, uIntensity, uStretch;
          uniform vec3 uColorA, uColorB;
          varying vec2 vUv;
          float hash(float n){ return fract(sin(n) * 43758.5453); }
          void main(){
            float ang = vUv.x;
            float lon = vUv.y * 60.0 - uTime * (6.0 + uStretch * 30.0);
            float cell = floor(ang * 26.0);
            float sb = hash(cell);
            float f = fract(lon * (0.5 + sb * 0.7) + sb * 9.0);
            float streak = smoothstep(0.3, 1.0, f);
            float seg = floor(lon * 0.45 + sb * 11.0);
            float mask = step(0.3, hash(seg + cell * 13.7));
            vec3 col = mix(uColorA, uColorB, sb);
            vec3 outCol = col * (streak * mask * 2.6 + 0.10) + col * 0.05;
            gl_FragColor = vec4(outCol, min(uIntensity, 1.0));
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
    }

    _buildTube(curve, s0, len) {
      if (this.tube) {
        this.scene.remove(this.tube);
        this.tube.geometry.dispose();
        this.tube = null;
      }
      const around = 22, along = 90;
      const radius = 9.5;
      const pos = new Float32Array((along + 1) * (around + 1) * 3);
      const uv = new Float32Array((along + 1) * (around + 1) * 2);
      const idx = [];
      const p = new THREE.Vector3();
      for (let i = 0; i <= along; i++) {
        const s = s0 + (i / along) * len;
        const f = curve.frameAt(s);
        const up = new THREE.Vector3(0, 1, 0);
        const right = f.right;
        const upV = new THREE.Vector3().crossVectors(right, f.dir).normalize().negate();
        for (let j = 0; j <= around; j++) {
          const a = (j / around) * Math.PI * 2;
          p.copy(f.pos)
            .addScaledVector(right, Math.cos(a) * radius)
            .addScaledVector(upV, Math.sin(a) * radius);
          p.y += 2.5;
          const k = (i * (around + 1) + j);
          pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
          uv[k * 2] = j / around;
          uv[k * 2 + 1] = i / along;
        }
      }
      for (let i = 0; i < along; i++) {
        for (let j = 0; j < around; j++) {
          const a = i * (around + 1) + j;
          const b = a + 1, c = a + (around + 1), d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      this.tube = new THREE.Mesh(geo, this.material);
      this.tube.frustumCulled = false;
      this.scene.add(this.tube);
    }

    begin(palette) {
      this.phase = "active";
      this.nextPalette = palette;
      this.uniforms.uColorA.value.copy(palette.primary);
      this.uniforms.uColorB.value.copy(palette.secondary);
    }

    activate(curve, carS) {
      if (this.phase !== "active") return;
      this._buildTube(curve, carS + 8, 620);
    }

    recolor(palette) {
      this.uniforms.uColorA.value.copy(palette.primary);
      this.uniforms.uColorB.value.copy(palette.secondary);
    }

    rebuild(curve, carS) {
      if (this.phase !== "active") return;
      this._buildTube(curve, carS + 6, 620);
      if (this.nextPalette) this.recolor(this.nextPalette);
    }

    startFade(duration) {
      this.fadeT = duration;
      this.fadeDur = duration;
    }

    updateFade(dt) {
      if (this.fadeT === undefined || this.fadeT <= 0) return;
      this.fadeT -= dt;
      const k = Math.max(0, this.fadeT / this.fadeDur);
      this.uniforms.uIntensity.value = 0.35 + k * 0.9;
      this.uniforms.uStretch.value = k * 0.7;
      this.uniforms.uTime.value += dt;
    }

    setStage(stageT, warnT, tunnelT, enterT) {
      if (this.phase !== "active") return;
      const k1 = THREE.MathUtils.clamp((tunnelT - stageT) / Math.max(0.001, tunnelT - enterT), 0, 1);
      const k2 = THREE.MathUtils.clamp((enterT - stageT) / Math.max(0.001, enterT + 1.2), 0, 1);
      this.uniforms.uIntensity.value = k1 * 1.25;
      this.uniforms.uStretch.value = k2;
      this.uniforms.uTime.value += 0.016;
    }

    end() {
      this.phase = "idle";
      if (this.tube) {
        this.scene.remove(this.tube);
        this.tube.geometry.dispose();
        this.tube = null;
      }
      this.uniforms.uIntensity.value = 0;
      this.uniforms.uStretch.value = 0;
    }

    update(dt) {
      if (this.phase !== "active") return;
      this.uniforms.uTime.value += dt;
    }
  }

  ND.Wormhole = Wormhole;
})();
