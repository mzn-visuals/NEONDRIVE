(function () {
  const CHUNK_LEN = 120;

  const ROAD_VERT = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const ROAD_FRAG = `
    uniform vec3 uAsphalt, uEdgeA, uEdgeB, uLaneColor;
    uniform float uPulse, uWetness, uEnergy;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

    void main() {
      float xw = (vUv.x - 0.5) * 13.2;
      float yw = vUv.y;

      float noise = hash(floor(vec2(vUv.x * 90.0, yw * 6.5))) * 0.028;
      vec3 col = uAsphalt + noise;

      float laneDist = min(abs(abs(xw) - 3.4), abs(xw));
      float isCenterLine = step(abs(xw), 0.09);
      float isLaneLine = (step(laneDist, 0.06) - isCenterLine);

      float dashMask = step(0.5, fract(yw * 0.22));
      vec3 laneCol = uLaneColor * (1.1 + uPulse * 1.4 + uEnergy * 0.5);
      col += laneCol * isCenterLine * 0.85;
      col += laneCol * isLaneLine * dashMask * 0.7;

      float edgeDist = abs(xw);
      float edgeStrip = smoothstep(5.55, 5.78, edgeDist) * (1.0 - smoothstep(6.28, 6.55, edgeDist));
      vec3 edgeCol = mix(uEdgeA, uEdgeB, smoothstep(0.0, 1.0, sin(yw * 0.08) * 0.5 + 0.5));
      col += edgeCol * edgeStrip * (1.35 + uPulse * 2.2 + uEnergy * 0.7);

      float shoulderGlow = smoothstep(5.1, 5.55, edgeDist) * (1.0 - smoothstep(5.55, 6.0, edgeDist));
      col += edgeCol * shoulderGlow * 0.22;

      if (uWetness > 0.01) {
        float streak = hash(vec2(floor(xw * 3.0), floor(yw * 0.5)));
        col += edgeCol * uWetness * streak * 0.16 * (0.4 + uPulse);
        col += laneCol * uWetness * 0.12;
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const TERRAIN_VERT = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const TERRAIN_FRAG = `
    uniform vec3 uBase, uGridA;
    uniform float uFogDensity, uOpacity, uCamS;
    varying vec2 vUv;

    void main() {
      float s = vUv.y;
      float u = vUv.x;
      vec2 g = vec2(u * 84.0, s);
      vec2 grid = abs(fract(g / 14.0 - 0.5) - 0.5) / fwidth(g / 14.0);
      float line = min(grid.x, grid.y);
      float lineMask = 1.0 - min(line, 1.0);
      float distFade = exp(-max(u - 0.06, 0.0) * 5.2);
      float sFade = exp(-max(s - uCamS, 0.0) * uFogDensity * 1.15);
      vec3 col = uBase + uGridA * lineMask * 0.55 * distFade;
      float alpha = uOpacity * (0.4 + lineMask * 0.6) * sFade;
      gl_FragColor = vec4(col, alpha);
    }
  `;

  class TrackGenerator {
    constructor(scene, qualityKey, curve) {
      this.scene = scene;
      this.curve = curve;
      this.chunkCount = ND.Config.QUALITY[qualityKey].chunkCount;
      this.chunkLen = CHUNK_LEN;
      this.chunks = [];
      this.nextChunkIndex = 0;
      this.levelCfg = null;
      this.palette = null;
      this.seed = 1;
      this.ramps = [];
      this.sections = 21;

      this.roadUniforms = {
        uAsphalt: { value: ND.srgb("#0b0714") },
        uEdgeA: { value: ND.srgb("#ff2fd6") },
        uEdgeB: { value: ND.srgb("#29e6ff") },
        uLaneColor: { value: ND.srgb("#ffe9f9") },
        uPulse: { value: 0 },
        uWetness: { value: 0 },
        uEnergy: { value: 0 }
      };
      this.roadMat = new THREE.ShaderMaterial({
        uniforms: this.roadUniforms,
        vertexShader: ROAD_VERT,
        fragmentShader: ROAD_FRAG
      });

      this.terrainUniforms = {
        uBase: { value: ND.srgb("#0d0620") },
        uGridA: { value: ND.srgb("#ff2fd6") },
        uFogDensity: { value: 0.0044 },
        uOpacity: { value: 0.9 },
        uCamS: { value: 0 }
      };
      this.terrainMat = new THREE.ShaderMaterial({
        uniforms: this.terrainUniforms,
        vertexShader: TERRAIN_VERT,
        fragmentShader: TERRAIN_FRAG,
        transparent: true,
        side: THREE.DoubleSide,
        extensions: { derivatives: true }
      });

      this._sharedGeos();
      this.propMats = {};
      this.rampMat = new THREE.MeshBasicMaterial({
        color: 0x29e6ff, transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      this.rampEdgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.coneMat = new THREE.MeshLambertMaterial({ color: 0xff7a2a });
      this.coneStripeMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
      this.barrierMat = new THREE.MeshLambertMaterial({ color: 0x2c2440 });
      this.barrierGlowMat = new THREE.MeshBasicMaterial({ color: 0xffb02a });
      this.wreckMat = new THREE.MeshLambertMaterial({ color: 0x1a1424 });
    }

    _sharedGeos() {
      this.geos = {
        mesa: new THREE.CylinderGeometry(6, 10, 26, 6),
        rock: new THREE.DodecahedronGeometry(1),
        cactus: new THREE.CylinderGeometry(0.22, 0.28, 3.2, 6),
        pyramid: new THREE.ConeGeometry(16, 18, 4),
        building: new THREE.BoxGeometry(1, 1, 1),
        pine: new THREE.ConeGeometry(2.4, 7, 7),
        peak: new THREE.ConeGeometry(26, 60, 5),
        cap: new THREE.ConeGeometry(9, 16, 5),
        cliff: new THREE.BoxGeometry(1, 1, 1),
        monolith: new THREE.BoxGeometry(1, 1, 1),
        crater: new THREE.TorusGeometry(1, 0.08, 6, 24),
        trunk: new THREE.CylinderGeometry(0.14, 0.2, 4.4, 5),
        frond: new THREE.ConeGeometry(1.7, 1.1, 5),
        pole: new THREE.CylinderGeometry(0.09, 0.12, 7, 6),
        lampHead: new THREE.BoxGeometry(1.4, 0.18, 0.5),
        post: new THREE.BoxGeometry(0.16, 0.75, 0.16)
      };
    }

    setPalette(palette) {
      this.palette = palette;
      this.roadUniforms.uEdgeA.value.copy(palette.primary);
      this.roadUniforms.uEdgeB.value.copy(palette.secondary);
      this.roadUniforms.uLaneColor.value.copy(palette.highlight);
      this.terrainUniforms.uGridA.value.copy(palette.primary);
      this.rampMat.color.copy(palette.secondary).multiplyScalar(1.35);
      this.rampEdgeMat.color.copy(palette.highlight);
      this._refreshPropMaterials();
    }

    _mat(name, opts) {
      if (!this.propMats[name]) this.propMats[name] = new THREE.MeshLambertMaterial(opts || {});
      return this.propMats[name];
    }

    _emissiveMat(name, colorHex) {
      if (!this.propMats[name]) this.propMats[name] = new THREE.MeshBasicMaterial({ color: colorHex });
      return this.propMats[name];
    }

    _refreshPropMaterials() {
      const p = this.palette;
      if (!p) return;
      const m = this.propMats;
      if (m.neonTrim) m.neonTrim.color.copy(p.primary);
      if (m.archGlow) m.archGlow.color.copy(p.accent);
      if (m.lampGlow) m.lampGlow.color.copy(p.secondary);
      if (m.monolithGlow) m.monolithGlow.color.copy(p.secondary);
      if (m.railGlow) m.railGlow.color.copy(p.primary);
      this._buildWindowTexture();
    }

    _buildWindowTexture() {
      if (!this.windowTex) {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 128;
        this.windowCanvas = c;
        this.windowTex = new THREE.CanvasTexture(c);
        this.windowTex.magFilter = THREE.NearestFilter;
      }
      const ctx = this.windowCanvas.getContext("2d");
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 64, 128);
      const rng = ND.mulberry32(1234);
      for (let y = 4; y < 124; y += 8) {
        for (let x = 4; x < 60; x += 8) {
          if (rng() < 0.42) {
            ctx.fillStyle = rng() < 0.5 ? "#ffffff" : "#aaccff";
            ctx.fillRect(x, y, 4, 5);
          }
        }
      }
      this.windowTex.needsUpdate = true;
      if (!this.propMats.buildingWin) {
        this.propMats.buildingWin = new THREE.MeshLambertMaterial({
          color: 0x0a0a14,
          emissive: 0xffffff,
          emissiveMap: this.windowTex,
          emissiveIntensity: 0.9
        });
      }
    }

    setLevel(levelCfg, weatherId, palette, seed) {
      this.levelCfg = levelCfg;
      this.palette = palette;
      this.seed = seed >>> 0;
      this.weatherId = weatherId;
      this.setPalette(palette);
      this._buildWindowTexture();
      this.ramps.length = 0;

      this.curve.update(0, this.chunkCount * CHUNK_LEN + 400);

      for (const chunk of this.chunks) this.scene.remove(chunk.group);
      this.chunks.length = 0;
      this.nextChunkIndex = 0;

      for (let i = 0; i < this.chunkCount; i++) {
        this.chunks.push(this._makeChunk());
      }
      let startS = -80;
      for (const chunk of this.chunks) {
        this._populate(chunk, startS);
        startS += CHUNK_LEN;
      }
    }

    _makeChunk() {
      const group = new THREE.Group();
      const secCount = this.sections;

      const makeGeo = () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(secCount * 2 * 3), 3));
        g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(secCount * 2 * 2), 2));
        const idx = [];
        for (let i = 0; i < secCount - 1; i++) {
          const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
          idx.push(a, b, c, b, d, c);
        }
        g.setIndex(idx);
        return g;
      };

      const road = new THREE.Mesh(makeGeo(), this.roadMat);
      group.add(road);
      const terrL = new THREE.Mesh(makeGeo(), this.terrainMat);
      group.add(terrL);
      const terrR = new THREE.Mesh(makeGeo(), this.terrainMat);
      group.add(terrR);

      this.scene.add(group);
      return { group, road, terrL, terrR, props: [], startS: 0 };
    }

    _writeRoad(geo, startS, len) {
      const pos = geo.attributes.position.array;
      const uv = geo.attributes.uv.array;
      const secCount = this.sections;
      const step = len / (secCount - 1);
      const halfW = 6.6;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < secCount; i++) {
        const s = startS + i * step;
        const f = this.curve.frameAt(s);
        for (let j = 0; j < 2; j++) {
          const lat = j === 0 ? -halfW : halfW;
          tmp.copy(f.pos).addScaledVector(f.right, lat);
          tmp.y += (j === 0 ? -1 : 1) * halfW * Math.sin(f.bank) * 0.5 + 0.01;
          const k = (i * 2 + j) * 3;
          pos[k] = tmp.x; pos[k + 1] = tmp.y; pos[k + 2] = tmp.z;
          uv[(i * 2 + j) * 2] = j;
          uv[(i * 2 + j) * 2 + 1] = s;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.uv.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
    }

    _writeTerrain(geo, startS, len, side) {
      const pos = geo.attributes.position.array;
      const uv = geo.attributes.uv.array;
      const secCount = this.sections;
      const step = len / (secCount - 1);
      const inner = 6.6, outer = 80;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < secCount; i++) {
        const s = startS + i * step;
        const f = this.curve.frameAt(s);
        for (let j = 0; j < 2; j++) {
          const lat = side * (j === 0 ? inner : outer);
          const drop = j === 0 ? 0.06 : (outer - inner) * 0.085 + 0.6;
          tmp.copy(f.pos).addScaledVector(f.right, lat);
          tmp.y += lat * Math.sin(f.bank) * 0.5 - drop;
          const k = (i * 2 + j) * 3;
          pos[k] = tmp.x; pos[k + 1] = tmp.y; pos[k + 2] = tmp.z;
          uv[(i * 2 + j) * 2] = j;
          uv[(i * 2 + j) * 2 + 1] = s;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.uv.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
    }

    _populate(chunk, startS) {
      for (const p of chunk.props) p.visible = false;
      chunk.startS = startS;

      this._writeRoad(chunk.road.geometry, startS, CHUNK_LEN);
      this._writeTerrain(chunk.terrL.geometry, startS, CHUNK_LEN, -1);
      this._writeTerrain(chunk.terrR.geometry, startS, CHUNK_LEN, 1);

      const idx = this.nextChunkIndex++;
      const rng = ND.mulberry32(this.seed ^ Math.imul(idx + 7, 2654435761));
      const cfg = this.levelCfg;
      const len = CHUNK_LEN;

      this._guardrailPosts(chunk, startS, len);
      if (cfg.props === "city" || cfg.props === "boulevard" || rng() < 0.5) {
        this._streetLights(chunk, rng, startS, len);
      }

      switch (cfg.props) {
        case "desert": this._propsDesert(chunk, rng, startS, len); break;
        case "city": this._propsCity(chunk, rng, startS, len); break;
        case "coastal": this._propsCoastal(chunk, rng, startS, len); break;
        case "mountain": this._propsMountain(chunk, rng, startS, len); break;
        case "lunar": this._propsLunar(chunk, rng, startS, len); break;
        case "boulevard": this._propsBoulevard(chunk, rng, startS, len); break;
      }

      this._maybeRamp(chunk, rng, startS, len);
    }

    _addProp(chunk, key, maker, s, lat, scale, yawOffset) {
      let p = null;
      for (const pp of chunk.props) {
        if (pp._key === key && !pp.visible) { p = pp; break; }
      }
      if (!p) { p = maker(); p._key = key; chunk.group.add(p); chunk.props.push(p); }
      const f = this.curve.frameAt(s);
      p.position.copy(f.pos).addScaledVector(f.right, lat);
      p.position.y += lat * Math.sin(f.bank) * 0.5 - Math.abs(lat) * 0.045 - 0.15;
      p.rotation.set(0, -f.h + (yawOffset || 0), 0);
      if (scale) p.scale.set(scale[0], scale[1], scale[2]);
      p.visible = true;
      return p;
    }

    _guardrailPosts(chunk, startS, len) {
      const maker = () => {
        const g = new THREE.Group();
        const post = new THREE.Mesh(this.geos.post, this._mat("post", { color: 0x241c38 }));
        post.position.y = 0.35;
        g.add(post);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), this._emissiveMat("railGlow", 0xff2fd6));
        glow.position.y = 0.62;
        g.add(glow);
        return g;
      };
      for (let s = startS + 6; s < startS + len; s += 24) {
        this._addProp(chunk, "railpost", maker, s, -6.8);
        this._addProp(chunk, "railpost", maker, s, 6.8);
      }
    }

    _streetLights(chunk, rng, startS, len) {
      let side = rng() < 0.5 ? -1 : 1;
      const maker = () => {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(this.geos.pole, this._mat("lampPole", { color: 0x1c1430 }));
        pole.position.y = 3.5;
        g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.14), this._mat("lampPole", { color: 0x1c1430 }));
        arm.position.set(1.0, 6.9, 0);
        g.add(arm);
        const head = new THREE.Mesh(this.geos.lampHead, this._emissiveMat("lampGlow", 0x29e6ff));
        head.position.set(2.0, 6.8, 0);
        g.add(head);
        return g;
      };
      for (let s = startS + 10; s < startS + len; s += 42) {
        const p = this._addProp(chunk, "lamppost", maker, s, side * 7.5);
        p.rotation.y += side > 0 ? Math.PI : 0;
        side = -side;
      }
    }

    _side(rng) { return rng() < 0.5 ? -1 : 1; }

    _propsDesert(chunk, rng, startS, len) {
      for (let i = 0; i < 3; i++) {
        this._addProp(chunk, "mesa", () => {
          const m = new THREE.Mesh(this.geos.mesa, this._mat("mesa", { color: 0x1c1030 }));
          m.position.y = 12;
          return m;
        }, startS + rng() * len, this._side(rng) * (48 + rng() * 70), [1 + rng(), 0.8 + rng() * 0.9, 1 + rng()], rng() * 6);
      }
      for (let i = 0; i < 5; i++) {
        const s = 0.6 + rng() * 2.4;
        const rock = this._addProp(chunk, "rock", () => new THREE.Mesh(this.geos.rock, this._mat("rock", { color: 0x241238 })),
          startS + rng() * len, this._side(rng) * (10 + rng() * 34), [s, s * 0.8, s], rng() * 6);
        rock.position.y += s * 0.35;
      }
      for (let i = 0; i < 6; i++) {
        this._addProp(chunk, "cactus", () => {
          const g = new THREE.Group();
          const t = new THREE.Mesh(this.geos.cactus, this._mat("cactus", { color: 0x14483c }));
          t.position.y = 1.6;
          g.add(t);
          const arm = new THREE.Mesh(this.geos.cactus, this._mat("cactus", { color: 0x14483c }));
          arm.scale.set(0.7, 0.55, 0.7);
          arm.position.set(0.5, 2.1, 0);
          arm.rotation.z = 0.5;
          g.add(arm);
          return g;
        }, startS + rng() * len, this._side(rng) * (9.5 + rng() * 26), null, rng() * 6);
      }
      if (rng() < 0.3) {
        this._addProp(chunk, "pyramid", () => {
          const m = new THREE.Mesh(this.geos.pyramid, this._mat("pyramid", { color: 0x2a1444 }));
          m.position.y = 8;
          return m;
        }, startS + rng() * len, this._side(rng) * (95 + rng() * 80), null, rng() * 6);
      }
    }

    _makeBuilding(rng) {
      const win = this.propMats.buildingWin || new THREE.MeshLambertMaterial({ color: 0x0a0a14 });
      const h = 12 + Math.pow(rng(), 1.6) * 55;
      const w = 6 + rng() * 6;
      const d = 5 + rng() * 3;
      const b = new THREE.Group();
      const tower = new THREE.Mesh(this.geos.building, win);
      tower.scale.set(w, h, d);
      tower.position.y = h / 2;
      b.add(tower);
      const trimMat = this._emissiveMat("neonTrim", 0xff2fd6);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), trimMat);
      top.scale.set(w * 1.04, 1, d * 1.04);
      top.position.y = h + 0.15;
      b.add(top);
      return b;
    }

    _propsCity(chunk, rng, startS, len) {
      for (let i = 0; i < 11; i++) {
        this._addProp(chunk, "building", () => this._makeBuilding(rng),
          startS + rng() * len, this._side(rng) * (15.5 + rng() * 40), null, rng() * 0.4);
      }
    }

    _propsCoastal(chunk, rng, startS, len) {
      for (let i = 0; i < 4; i++) {
        const cliff = this._addProp(chunk, "cliff", () => new THREE.Mesh(this.geos.cliff, this._mat("cliff", { color: 0x1b1436 })),
          startS + rng() * len, 30 + rng() * 34, [10 + rng() * 20, 14 + rng() * 26, 18 + rng() * 30]);
        cliff.position.y += cliff.scale.y / 2 - 3;
      }
      for (let i = 0; i < 5; i++) {
        this._addProp(chunk, "palm", () => {
          const g = new THREE.Group();
          const tr = new THREE.Mesh(this.geos.trunk, this._mat("palm", { color: 0x2e1c3f }));
          tr.position.y = 2.2;
          tr.rotation.z = 0.16;
          g.add(tr);
          const fm = this._mat("frond", { color: 0x0e4d40 });
          for (let k = 0; k < 5; k++) {
            const f = new THREE.Mesh(this.geos.frond, fm);
            f.position.set(Math.sin(k * 1.26) * 0.8, 4.4, Math.cos(k * 1.26) * 0.8);
            f.rotation.set(Math.cos(k * 1.26) * 1.1, 0, Math.sin(k * 1.26) * 1.1);
            g.add(f);
          }
          return g;
        }, startS + rng() * len, -(9.5 + rng() * 16), null, rng() * 6);
      }
    }

    _propsMountain(chunk, rng, startS, len) {
      for (let i = 0; i < 5; i++) {
        this._addProp(chunk, "peak", () => {
          const g = new THREE.Group();
          const body = new THREE.Mesh(this.geos.peak, this._mat("peak", { color: 0x181033 }));
          body.position.y = 28;
          g.add(body);
          const cap = new THREE.Mesh(this.geos.cap, this._mat("snow", { color: 0xcfd8ff }));
          cap.position.y = 52;
          g.add(cap);
          return g;
        }, startS + rng() * len, this._side(rng) * (38 + rng() * 110), [0.8 + rng() * 1.6, 0.7 + rng() * 1.3, 0.8 + rng() * 1.6], rng() * 6);
      }
      for (let i = 0; i < 6; i++) {
        const s = 0.6 + rng() * 1.4;
        const pine = this._addProp(chunk, "pine", () => new THREE.Mesh(this.geos.pine, this._mat("pine", { color: 0x0d3328 })),
          startS + rng() * len, this._side(rng) * (10 + rng() * 20), [s, s * (0.8 + rng()), s], rng() * 6);
        pine.position.y += 3.0 * pine.scale.y;
      }
    }

    _propsLunar(chunk, rng, startS, len) {
      for (let i = 0; i < 5; i++) {
        const s = 2 + rng() * 7;
        const crater = this._addProp(chunk, "crater", () => {
          const m = new THREE.Mesh(this.geos.crater, this._mat("crater", { color: 0x2a3050 }));
          m.rotation.x = -Math.PI / 2;
          return m;
        }, startS + rng() * len, this._side(rng) * (12 + rng() * 60), [s, s, 1]);
        crater.position.y += 0.05;
      }
      for (let i = 0; i < 6; i++) {
        const s = 0.5 + rng() * 2.2;
        const rk = this._addProp(chunk, "moonrock", () => new THREE.Mesh(this.geos.rock, this._mat("moonrock", { color: 0x39405e })),
          startS + rng() * len, this._side(rng) * (11 + rng() * 50), [s, s * 0.6, s], rng() * 6);
        rk.position.y += s * 0.22;
      }
      if (rng() < 0.5) {
        const mono = this._addProp(chunk, "monolith", () => {
          const m = new THREE.Mesh(this.geos.monolith, this._emissiveMat("monolithGlow", 0x88aaff));
          return m;
        }, startS + rng() * len, this._side(rng) * (16 + rng() * 30), [1.2, 9 + rng() * 8, 0.7], rng() * 6);
        mono.position.y += mono.scale.y / 2;
      }
    }

    _propsBoulevard(chunk, rng, startS, len) {
      for (let i = 0; i < 12; i++) {
        this._addProp(chunk, "building", () => this._makeBuilding(rng),
          startS + rng() * len, this._side(rng) * (13.5 + rng() * 20), null, 0);
      }
      for (let i = 0; i < 2; i++) {
        const bb = this._addProp(chunk, "billboard", () => {
          const g = new THREE.Group();
          if (!this.billboardTex) this._makeBillboards();
          const mat = new THREE.MeshBasicMaterial({ map: this.billboardTex[i % this.billboardTex.length] });
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.6), mat);
          panel.position.y = 7;
          g.add(panel);
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.4, 0.4), this._mat("pole", { color: 0x141024 }));
          pole.position.y = 2.7;
          g.add(pole);
          return g;
        }, startS + rng() * len, this._side(rng) * 11.6);
        bb.rotation.y += Math.PI * 0.62;
      }
      if (rng() < 0.65) {
        this._addProp(chunk, "arch", () => {
          const g = new THREE.Group();
          const pm = this._mat("arch", { color: 0x160b2c });
          const gm = this._emissiveMat("archGlow", 0xffe14d);
          for (const sx of [-1, 1]) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9.5, 0.8), pm);
            p.position.set(sx * 8.2, 4.75, 0);
            g.add(p);
            const glow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 9.5, 0.9), gm);
            glow.position.set(sx * 7.7, 4.75, 0);
            g.add(glow);
          }
          const beam = new THREE.Mesh(new THREE.BoxGeometry(17.2, 1.1, 0.9), pm);
          beam.position.y = 10;
          g.add(beam);
          const beamGlow = new THREE.Mesh(new THREE.BoxGeometry(17.2, 0.18, 1.0), gm);
          beamGlow.position.y = 9.4;
          g.add(beamGlow);
          return g;
        }, startS + len * (0.3 + rng() * 0.4), 0);
      }
    }

    _makeBillboards() {
      const texts = [
        ["NEON//DRIVE", "#ff2fd6"],
        ["\u266A \u266B \u266C", "#29e6ff"],
        ["DRIVE", "#ffd166"],
        [">> >> >>", "#7dffb0"]
      ];
      this.billboardTex = texts.map(([txt, color]) => {
        const c = document.createElement("canvas");
        c.width = 256; c.height = 128;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0a0518";
        ctx.fillRect(0, 0, 256, 128);
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, 240, 112);
        ctx.fillStyle = color;
        ctx.font = "900 40px Orbitron, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.fillText(txt, 128, 68);
        return new THREE.CanvasTexture(c);
      });
    }

    _maybeRamp(chunk, rng, startS, len) {
      const s0 = startS + 30 + rng() * (len - 60);
      const f = this.curve.frameAt(s0);
      if (Math.abs(f.k) > 1 / 700 || s0 < 350) return;
      if (rng() > 0.34) return;

      const maker = () => {
        const g = new THREE.Group();
        const geo = new THREE.BufferGeometry();
        const w = 4.6, l = 9, h = 1.15;
        const verts = new Float32Array([
          -w/2, 0, 0,  w/2, 0, 0,  -w/2, h, -l,
          w/2, 0, 0,   w/2, h, -l, -w/2, h, -l,
          -w/2, 0, -l, -w/2, h, -l, -w/2, 0, 0,
          w/2, 0, -l,  w/2, 0, 0,   w/2, h, -l,
          -w/2, 0, 0,  w/2, 0, 0,   -w/2, 0, -l,
          w/2, 0, 0,   w/2, 0, -l,  -w/2, 0, -l
        ]);
        geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geo.computeVertexNormals();
        const ramp = new THREE.Mesh(geo, this.rampMat);
        g.add(ramp);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.4), this.rampEdgeMat);
        lip.position.set(0, h, -l);
        g.add(lip);
        return g;
      };

      const lat = [-3.4, 0, 3.4][Math.floor(rng() * 3)];
      const p = this._addProp(chunk, "ramp", maker, s0, lat);
      this.ramps.push({ s: s0, lat, halfW: 2.6, len: 9, h: 1.15, chunk, mesh: p });
    }


    update(carS) {
      this.curve.update(carS, carS + this.chunkCount * CHUNK_LEN + 400);
      for (const chunk of this.chunks) {
        if (chunk.startS + CHUNK_LEN < carS - 70) {
          let maxEnd = -Infinity;
          for (const c of this.chunks) maxEnd = Math.max(maxEnd, c.startS + CHUNK_LEN);
          this._populate(chunk, maxEnd);
        }
      }
      this.ramps = this.ramps.filter(r => {
        if (r.s > carS - 80) return true;
        if (!r.chunk && r.mesh) this.scene.remove(r.mesh);
        return false;
      });
      this.terrainUniforms.uCamS.value = carS;
    }

    getRampAt(carS, lat) {
      for (const r of this.ramps) {
        if (carS >= r.s - 0.5 && carS <= r.s + r.len && Math.abs(lat - r.lat) < (r.halfW || 2.6)) {
          return r;
        }
      }
      return null;
    }


    setPulse(v) { this.roadUniforms.uPulse.value = v; }
    setEnergy(v) { this.roadUniforms.uEnergy.value = v; }
    setWetness(v) { this.roadUniforms.uWetness.value = v; }

    forceRamp(carS) {
      for (const r of this.ramps) if (r.s > carS && r.s < carS + 200) return;
      const s0 = carS + 130;
      const f = this.curve.frameAt(s0);
      const p = this._addProp({ props: [], group: this.scene }, "forceramp", () => {
        const g = new THREE.Group();
        const geo = new THREE.BufferGeometry();
        const w = 11, l = 9, h = 1.05;
        const verts = new Float32Array([
          -w/2, 0, 0,  w/2, 0, 0,  -w/2, h, -l,
          w/2, 0, 0,   w/2, h, -l, -w/2, h, -l,
          -w/2, 0, -l, -w/2, h, -l, -w/2, 0, 0,
          w/2, 0, -l,  w/2, 0, 0,   w/2, h, -l,
          -w/2, 0, 0,  w/2, 0, 0,   -w/2, 0, -l,
          w/2, 0, 0,   w/2, 0, -l,  -w/2, 0, -l
        ]);
        geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geo.computeVertexNormals();
        g.add(new THREE.Mesh(geo, this.rampMat));
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.4), this.rampEdgeMat);
        lip.position.set(0, h, -l);
        g.add(lip);
        return g;
      }, s0, 0);
      this.scene.add(p);
      this.ramps.push({ s: s0, lat: 0, halfW: 5.8, len: 9, h: 1.05, chunk: null, mesh: p });
    }
  }

  ND.TrackGenerator = TrackGenerator;
})();
