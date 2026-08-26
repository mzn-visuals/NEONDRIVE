(function () {
  let sharedEnvTex = null;

  function buildEnvTexture(renderer) {
    if (sharedEnvTex) return sharedEnvTex;
    const threeRenderer = renderer && renderer.three ? renderer.three : renderer;
    if (!threeRenderer || !threeRenderer.capabilities) return null;
    try {
      const pmrem = new THREE.PMREMGenerator(threeRenderer);
      const envScene = new THREE.Scene();
      const grad = new THREE.Mesh(
        new THREE.SphereGeometry(50, 16, 12),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
          fragmentShader: "varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.9,0.25,0.6), vec3(0.05,0.02,0.12), smoothstep(-0.1, 0.6, h)); c += vec3(0.2,0.5,0.9) * pow(max(1.0-abs(h-0.05)*6.0,0.0),2.0)*0.35; gl_FragColor = vec4(c,1.0); }"
        })
      );
      envScene.add(grad);
      const neon = (x, y, z, c) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: c }));
        m.position.set(x, y, z);
        envScene.add(m);
      };
      neon(-20, 4, -10, 0xff2fd6);
      neon(20, 6, -14, 0x29e6ff);
      neon(0, 10, 18, 0xff9d45);
      const rt = pmrem.fromScene(envScene, 0.04);
      pmrem.dispose();
      sharedEnvTex = rt.texture;
    } catch (e) {
      console.warn("[carmodel] env failed", e);
      sharedEnvTex = null;
    }
    return sharedEnvTex;
  }

  function wedge(width, hBack, hFront, len) {
    const geo = new THREE.BufferGeometry();
    const hw = width / 2;
    const v = new Float32Array([
      -hw, hBack, 0,  hw, hBack, 0,  -hw, hFront, -len,
      hw, hBack, 0,   hw, hFront, -len, -hw, hFront, -len,
      -hw, 0, 0,      -hw, hFront, -len, -hw, hBack, 0,
      hw, 0, 0,       hw, hBack, 0,    hw, hFront, -len,
      -hw, 0, 0,      hw, 0, 0,        -hw, hFront, -len,
      hw, 0, 0,       hw, hFront, -len, -hw, hFront, -len,
      -hw, 0, 0,      -hw, hBack, 0,   hw, 0, 0,
      -hw, hBack, 0,  hw, hBack, 0,    hw, 0, 0
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function buildBody(g, P, mats) {
    const { paint, paintDark, glass, carbon, trimMat } = mats;
    const L = P.len, W = P.width, H = P.bodyH;
    const half = L / 2;
    const frontZ = -half, rearZ = half;
    const shell = [];

    const lower = new THREE.Mesh(new THREE.BoxGeometry(W, H, L * 0.96), paint);
    lower.position.set(0, P.ride + H / 2, 0.02);
    g.add(lower);

    const noseLen = P.noseLen;
    const nose = new THREE.Mesh(wedge(W * 0.96, P.noseH, Math.max(0.16, P.noseH - P.noseDrop), noseLen), paint);
    nose.position.set(0, P.ride + 0.02, frontZ + L * 0.48);
    g.add(nose);

    const hoodZ0 = frontZ + L * 0.48 - noseLen;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.1, P.hoodLen), paint);
    hood.position.set(0, P.ride + P.hoodH, hoodZ0 - P.hoodLen / 2);
    g.add(hood);

    const cabinFront = P.cabinStart - P.cabinLen / 2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, P.cabinH, P.cabinLen), paint);
    cabin.position.set(0, P.ride + P.hoodH + P.cabinH / 2 - 0.04, P.cabinStart);
    g.add(cabin);
    shell.push(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.07, P.cabinLen * 0.72), paint);
    roof.position.set(0, P.ride + P.hoodH + P.cabinH - 0.02, P.cabinStart + (P.roofShift || 0));
    g.add(roof);
    shell.push(roof);

    const wsH = Math.max(0.2, P.cabinH * 0.9);
    const windshield = new THREE.Mesh(
      wedge(W * 0.74, wsH, 0.02, Math.max(0.4, cabinFront - (hoodZ0 - P.hoodLen)) * -1 + 0.001),
      glass
    );
    const wsLen = Math.max(0.45, (hoodZ0 - P.hoodLen) - cabinFront);
    windshield.geometry.dispose();
    windshield.geometry = wedge(W * 0.74, wsH, 0.02, wsLen);
    windshield.position.set(0, P.ride + P.hoodH - 0.02, cabinFront);
    g.add(windshield);
    shell.push(windshield);

    const cabinRear = P.cabinStart + P.cabinLen / 2;
    const rgLen = P.rearGlassLen;
    const rgH = P.cabinH * 0.85;
    const rearGlass = new THREE.Mesh(wedge(W * 0.72, rgH, 0.02, rgLen), glass);
    rearGlass.rotation.y = Math.PI;
    rearGlass.position.set(0, P.ride + P.hoodH - 0.02, cabinRear + rgLen);
    rearGlass.rotation.y = 0;
    rearGlass.geometry.dispose();
    rearGlass.geometry = wedge(W * 0.72, 0.02, rgH, rgLen);
    rearGlass.position.set(0, P.ride + P.hoodH - 0.02, cabinRear);
    g.add(rearGlass);
    shell.push(rearGlass);

    const deckZ0 = cabinRear + rgLen;
    const deckLen = Math.max(0.25, rearZ - 0.12 - deckZ0);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, Math.max(0.08, P.deckH - P.hoodH), deckLen), paint);
    deck.position.set(0, P.ride + (P.deckH + P.hoodH) / 2, deckZ0 + deckLen / 2);
    g.add(deck);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, P.tailH, 0.1), paintDark);
    tail.position.set(0, P.ride + P.tailH / 2, rearZ - 0.02);
    g.add(tail);

    for (const sx of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, L * 0.5), carbon);
      skirt.position.set(sx * (W / 2 - 0.02), P.ride + 0.06, 0);
      g.add(skirt);
    }

    const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.07, 0.42), carbon);
    splitter.position.set(0, P.ride + 0.02, frontZ + L * 0.48 + 0.05);
    g.add(splitter);

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.2, 0.34), carbon);
    diffuser.position.set(0, P.ride + 0.1, rearZ - 0.1);
    g.add(diffuser);

    if (P.fenders) {
      for (const sx of [-1, 1]) {
        for (const wz of [-P.len * 0.31, P.len * 0.33]) {
          const flare = new THREE.Mesh(new THREE.BoxGeometry(0.14, P.bodyH * 0.72, 1.5), paint);
          flare.position.set(sx * (W / 2 + 0.02), P.ride + H * 0.62, wz);
          g.add(flare);
        }
      }
    }

    if (P.intakes) {
      for (const sx of [-1, 1]) {
        const intake = new THREE.Mesh(new THREE.BoxGeometry(0.1, P.bodyH * 0.6, 0.7), carbon);
        intake.position.set(sx * (W / 2 - 0.04), P.ride + H * 0.72, P.len * 0.18);
        g.add(intake);
      }
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(W * 0.4, 0.09, 0.5), carbon);
      scoop.position.set(0, P.ride + P.hoodH + 0.05, cabinFront - 0.3);
      g.add(scoop);
    }

    let wingGroup = null;
    if (P.wing === "gt") {
      wingGroup = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.05, 0.34), carbon);
      blade.position.y = 0.3;
      blade.rotation.x = -0.16;
      wingGroup.add(blade);
      for (const sx of [-1, 1]) {
        const stanchion = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.16), carbon);
        stanchion.position.set(sx * W * 0.32, 0.15, 0.05);
        wingGroup.add(stanchion);
      }
      wingGroup.position.set(0, P.ride + P.deckH + 0.05, rearZ - 0.28);
      g.add(wingGroup);
    } else if (P.wing === "duck") {
      wingGroup = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.07, 0.3), carbon);
      wingGroup.position.set(0, P.ride + P.tailH + 0.1, rearZ - 0.16);
      wingGroup.rotation.x = -0.28;
      g.add(wingGroup);
    } else if (P.wing === "delta") {
      wingGroup = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(W * 1.0, 0.05, 0.44), carbon);
      blade.position.y = 0.42;
      blade.rotation.x = -0.2;
      wingGroup.add(blade);
      for (const sx of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.5), carbon);
        fin.position.set(sx * W * 0.44, 0.22, 0.02);
        wingGroup.add(fin);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.06, 0.06), trimMat);
      beam.position.y = 0.2;
      wingGroup.add(beam);
      wingGroup.position.set(0, P.ride + P.deckH + 0.02, rearZ - 0.3);
      g.add(wingGroup);
    } else if (P.wing === "visor") {
      wingGroup = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.06, 0.26), carbon);
      blade.position.y = 0.12;
      blade.rotation.x = -0.22;
      wingGroup.add(blade);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.03, 0.1), trimMat);
      lip.position.set(0, 0.09, -0.12);
      wingGroup.add(lip);
      wingGroup.position.set(0, P.ride + P.hoodH + P.cabinH + 0.02, cabinRear + 0.1);
      g.add(wingGroup);
    }

    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.09, 0.06), trimMat);
    tailBar.position.set(0, P.ride + P.tailH - 0.12, rearZ + 0.02);
    g.add(tailBar);

    return { cabinFront, cabinRear, roofTop: P.ride + P.hoodH + P.cabinH, shell };
  }

  function buildCarMesh(cfg, renderer) {
    const env = renderer ? buildEnvTexture(renderer) : null;
    const P = cfg.profile;
    const g = new THREE.Group();

    const paint = new THREE.MeshStandardMaterial({
      color: ND.srgb(cfg.body),
      metalness: 0.72,
      roughness: 0.3,
      envMap: env || undefined,
      envMapIntensity: 1.15
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0a0e1a, metalness: 0.9, roughness: 0.06,
      transparent: true, opacity: 0.62, envMap: env || undefined, envMapIntensity: 1.6
    });
    const trimMat = new THREE.MeshBasicMaterial({ color: cfg.trim });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd2dd, metalness: 1.0, roughness: 0.22, envMap: env || undefined });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0f, metalness: 0, roughness: 0.95 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.4, roughness: 0.55 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.05, roughness: 0.8 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x181020, metalness: 0.0, roughness: 0.9 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xf5faff });
    const brakeMat = new THREE.MeshBasicMaterial({ color: 0x660f1e });
    const reverseMat = new THREE.MeshBasicMaterial({ color: 0x333744 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0x8a8f9c, metalness: 0.95, roughness: 0.35, envMap: env || undefined });
    const caliperMat = new THREE.MeshStandardMaterial({ color: ND.srgb(cfg.trim), metalness: 0.4, roughness: 0.5 });

    const mats = { paint, paintDark: paint, glass, carbon, trimMat };
    const bodyInfo = buildBody(g, P, mats);
    const shell = bodyInfo.shell;

    const dash = new THREE.Mesh(new THREE.BoxGeometry(P.width * 0.7, 0.16, 0.4), plastic);
    dash.position.set(0, P.ride + P.hoodH + 0.12, P.profileDashZ != null ? P.profileDashZ : P.cabinStart - P.cabinLen / 2 + 0.28);
    dash.position.z = P.cabinStart - P.cabinLen / 2 + 0.3;
    g.add(dash);

    const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.04), trimMat);
    cluster.position.set(0.3, P.ride + P.hoodH + 0.24, P.cabinStart - P.cabinLen / 2 + 0.38);
    g.add(cluster);

    const seats = [];
    for (const sx of [-0.4, 0.4]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.14), leather);
      seat.position.set(sx, P.ride + P.hoodH + 0.16, P.cabinStart + 0.42);
      seat.rotation.x = 0.12;
      g.add(seat);
      seats.push(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.12), leather);
      back.position.set(sx, P.ride + P.hoodH + 0.36, P.cabinStart + 0.62);
      back.rotation.x = 0.16;
      g.add(back);
      seats.push(back);
    }

    const steeringWheel = new THREE.Group();
    const rimT = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 6, 20), plastic);
    steeringWheel.add(rimT);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.02), plastic);
      spoke.position.y = -0.065;
      const holder = new THREE.Group();
      holder.add(spoke);
      holder.rotation.z = (i / 3) * Math.PI * 2;
      steeringWheel.add(holder);
    }
    steeringWheel.position.set(0.3, P.ride + P.hoodH + 0.2, P.cabinStart - P.cabinLen / 2 + 0.52);
    steeringWheel.rotation.x = -0.42;
    g.add(steeringWheel);

    for (const sx of [-1, 1]) {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), plastic);
      stalk.position.set(sx * (P.width / 2 - 0.05), P.ride + P.hoodH + P.cabinH * 0.55, P.cabinStart - P.cabinLen / 2 - 0.05);
      g.add(stalk);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), paint);
      mirror.position.set(sx * (P.width / 2 + 0.05), P.ride + P.hoodH + P.cabinH * 0.62, P.cabinStart - P.cabinLen / 2 - 0.08);
      g.add(mirror);
      shell.push(stalk, mirror);
    }

    const headL = new THREE.Mesh(new THREE.BoxGeometry(P.width * 0.28, 0.1, 0.08), headMat);
    headL.position.set(-P.width * 0.29, P.ride + P.noseH - 0.06, -P.len / 2 + 0.06);
    g.add(headL);
    const headR = headL.clone();
    headR.position.x = P.width * 0.29;
    g.add(headR);
    const drlMat = new THREE.MeshBasicMaterial({ color: cfg.trim });
    const drlL = new THREE.Mesh(new THREE.BoxGeometry(P.width * 0.24, 0.04, 0.06), drlMat);
    drlL.position.set(-P.width * 0.29, P.ride + P.noseH + 0.06, -P.len / 2 + 0.07);
    g.add(drlL);
    const drlR = drlL.clone();
    drlR.position.x = P.width * 0.29;
    g.add(drlR);

    const tailL = new THREE.Mesh(new THREE.BoxGeometry(P.width * 0.3, 0.11, 0.07), brakeMat);
    tailL.position.set(-P.width * 0.26, P.ride + P.tailH - 0.16, P.len / 2 + 0.01);
    g.add(tailL);
    const tailR = tailL.clone();
    tailR.position.x = P.width * 0.26;
    g.add(tailR);
    const revL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.05), reverseMat);
    revL.position.set(0, P.ride + 0.24, P.len / 2 + 0.01);
    g.add(revL);

    const headlight = new THREE.SpotLight(0xcfe4ff, 0, 60, 0.62, 0.55, 1.4);
    headlight.position.set(0, P.ride + P.noseH, -P.len / 2);
    headlight.target.position.set(0, -0.4, -30);
    g.add(headlight);
    g.add(headlight.target);

    const exhausts = [];
    const exY = P.ride + 0.14;
    if (cfg.id === "eclipse") {
      for (const sx of [-0.42, 0.42]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 10), chrome);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(sx, exY, P.len / 2 + 0.06);
        g.add(pipe);
        exhausts.push(pipe);
      }
    } else {
      for (const sx of [-0.5, 0.5]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 10), chrome);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(sx, exY, P.len / 2 + 0.06);
        g.add(pipe);
        exhausts.push(pipe);
      }
    }

    const flame = new THREE.Group();
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6 + i * 0.25, 8), flameMat);
      f.rotation.x = -Math.PI / 2;
      f.position.set(i === 0 ? -0.5 : i === 1 ? 0.5 : 0, exY, P.len / 2 + 0.3 + i * 0.1);
      flame.add(f);
    }
    flame.visible = false;
    g.add(flame);

    const wheelR = P.wheelR;
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.36, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(wheelR * 0.6, wheelR * 0.6, 0.38, 12);
    rimGeo.rotateZ(Math.PI / 2);
    const discGeo = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, 0.05, 14);
    discGeo.rotateZ(Math.PI / 2);

    const wheels = [];
    const wb = P.len * 0.31;
    const wheelPos = [[-(P.width / 2 - 0.06), -wb + 0.05, true], [(P.width / 2 - 0.06), -wb + 0.05, true], [-(P.width / 2 - 0.1), P.len * 0.33, false], [(P.width / 2 - 0.1), P.len * 0.33, false]];
    for (const [wx, wz, steers] of wheelPos) {
      const holder = new THREE.Group();
      holder.position.set(wx, wheelR, wz);
      const tire = new THREE.Mesh(wheelGeo, rubber);
      const rim = new THREE.Mesh(rimGeo, chrome);
      const spin = new THREE.Group();
      spin.add(tire);
      spin.add(rim);
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, wheelR * 0.12, wheelR * 0.12), chrome);
        spoke.position.x = wx < 0 ? 0.16 : -0.16;
        const sh = new THREE.Group();
        sh.add(spoke);
        sh.rotation.x = (i / 5) * Math.PI;
        spin.add(sh);
      }
      holder.add(spin);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.x = wx < 0 ? 0.15 : -0.15;
      holder.add(disc);
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, wheelR * 0.5, wheelR * 0.3), caliperMat);
      caliper.position.set(wx < 0 ? 0.19 : -0.19, wheelR * 0.25, 0.08);
      holder.add(caliper);
      holder.userData = { spin, steers };
      g.add(holder);
      wheels.push(holder);
    }

    const underGlow = new THREE.PointLight(cfg.trim, 1.4, 9);
    underGlow.position.set(0, 0.3, 0);
    g.add(underGlow);

    const glowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(P.width + 1.3, P.len + 1),
      new THREE.MeshBasicMaterial({
        color: cfg.trim, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    glowPlane.rotation.x = -Math.PI / 2;
    glowPlane.position.y = 0.035;
    g.add(glowPlane);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(P.width + 0.7, P.len + 0.6),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);

    return {
      group: g,
      underGlow,
      wheels,
      steeringWheel,
      brakeMats: [brakeMat],
      reverseMats: [reverseMat],
      headlight,
      drlMats: [drlMat],
      flame,
      exhausts,
      paintMat: paint,
      seats,
      shell,
      cockpit: {
        x: 0.32,
        y: P.ride + P.hoodH + P.cabinH * 0.82,
        z: P.cabinStart - P.cabinLen / 2 + 0.82
      }
    };
  }

  ND.CarModel = { build: buildCarMesh };
  ND.buildCarMesh = cfg => buildCarMesh(cfg, null);
})();
