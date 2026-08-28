(function () {
  class AnimeEffects {
    constructor(scene) {
      this.scene = scene;
      this.sparks = [];
      this.airStreams = [];
      this.maxSparks = 200;
      this.maxAirStreams = 50;
      
      this.initSparks();
      this.initAirStreams();
    }
    
    initSparks() {
      // Spark particles for tire contact and collisions
      const sparkGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(this.maxSparks * 3);
      const velocities = new Float32Array(this.maxSparks * 3);
      const lifetimes = new Float32Array(this.maxSparks);
      const sizes = new Float32Array(this.maxSparks);
      
      sparkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      sparkGeometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
      sparkGeometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
      sparkGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
      
      const sparkMaterial = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 }
        },
        vertexShader: `
          attribute float lifetime;
          attribute float size;
          varying float vLifetime;
          
          void main() {
            vLifetime = lifetime;
            vec3 pos = position;
            gl_PointSize = size * (1.0 - lifetime) * 20.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying float vLifetime;
          
          void main() {
            float alpha = 1.0 - vLifetime;
            vec3 color = mix(vec3(1.0, 0.8, 0.3), vec3(1.0, 0.4, 0.1), vLifetime);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      
      this.sparkSystem = new THREE.Points(sparkGeometry, sparkMaterial);
      this.sparkSystem.visible = false;
      this.scene.add(this.sparkSystem);
      
      // Initialize spark data
      for (let i = 0; i < this.maxSparks; i++) {
        lifetimes[i] = 1.0; // Dead
        sizes[i] = 0.0;
      }
    }
    
    initAirStreams() {
      // ── In-world speed lines (Initial D / anime style) ─────────────────────
      // White streaks that spawn alongside the car and fly backward past it,
      // giving the impression of high-speed rushing through the environment.
      // Lines are arranged in lateral rows at road level on both sides.
      const MAX = this.maxAirStreams;
      const positions  = new Float32Array(MAX * 6); // 2 verts per line segment
      const alphas     = new Float32Array(MAX);      // per-line alpha
      const lifetimes  = new Float32Array(MAX);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('alpha',    new THREE.BufferAttribute(alphas, 1));
      geo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

      const mat = new THREE.ShaderMaterial({
        vertexShader: `
          attribute float lifetime;
          attribute float alpha;
          varying float vAlpha;
          varying float vLifetime;
          void main() {
            vAlpha    = alpha;
            vLifetime = lifetime;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          varying float vLifetime;
          void main() {
            // Fade in fast, linger, then fade out at end of life
            float fade = smoothstep(0.0, 0.12, vLifetime) * smoothstep(1.0, 0.7, vLifetime);
            gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * fade);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
      });

      this.airStreamSystem = new THREE.LineSegments(geo, mat);
      this.airStreamSystem.visible = false;
      this.airStreamSystem.frustumCulled = false; // always render — it's right beside the camera
      this.scene.add(this.airStreamSystem);

      // Runtime state stored separately (geometry arrays are write-only from GPU side)
      this._streams = [];
      for (let i = 0; i < MAX; i++) {
        lifetimes[i] = 0;
        alphas[i]    = 0;
        this._streams.push({
          alive:    false,
          life:     0,  // 0..1
          // world-space start and end of the streak
          x0: 0, y0: 0, z0: 0,
          x1: 0, y1: 0, z1: 0,
          // velocity (world-space, moves the whole line each frame)
          vx: 0, vz: 0,
          alpha: 0,
        });
      }
    }
    
    emitSpark(position, direction, intensity = 1.0) {
      const positions = this.sparkSystem.geometry.attributes.position.array;
      const velocities = this.sparkSystem.geometry.attributes.velocity.array;
      const lifetimes = this.sparkSystem.geometry.attributes.lifetime.array;
      const sizes = this.sparkSystem.geometry.attributes.size.array;
      
      // Find dead spark
      for (let i = 0; i < this.maxSparks; i++) {
        if (lifetimes[i] >= 1.0) {
          lifetimes[i] = 0.0;
          positions[i * 3] = position.x;
          positions[i * 3 + 1] = position.y;
          positions[i * 3 + 2] = position.z;
          
          // Random spread
          const spread = 0.3;
          velocities[i * 3] = direction.x + (Math.random() - 0.5) * spread;
          velocities[i * 3 + 1] = direction.y + Math.random() * spread * 0.5;
          velocities[i * 3 + 2] = direction.z + (Math.random() - 0.5) * spread;
          
          sizes[i] = 0.5 + Math.random() * 0.5;
          this.sparkSystem.visible = true;
          break;
        }
      }
    }
    
    emitAirStream(carPosition, carDirection, speed) {
      if (speed < 40) return;

      // Perpendicular to car direction (left/right of road)
      const perpX =  carDirection.z;
      const perpZ = -carDirection.x;

      // Spawn lines on both sides in 2 lateral slots each
      const SLOTS = [
        { side: -1, lateral: 1.6 + Math.random() * 1.2 },
        { side:  1, lateral: 1.6 + Math.random() * 1.2 },
      ];

      for (const slot of SLOTS) {
        // Find a dead slot
        for (let i = 0; i < this.maxAirStreams; i++) {
          const s = this._streams[i];
          if (s.alive) continue;

          // Streak length scales with speed (faster = longer lines, more dramatic)
          const len = 2.5 + speed * 0.045;

          // Lateral offset from car centre
          const lx = perpX * slot.lateral * slot.side;
          const lz = perpZ * slot.lateral * slot.side;

          // Slight vertical scatter (low to ground)
          const hy = 0.1 + Math.random() * 0.35;

          // Spawn just ahead of the car so it flies backward through frame
          const aheadBias = 1.5;
          const sx = carPosition.x + carDirection.x * aheadBias + lx;
          const sz = carPosition.z + carDirection.z * aheadBias + lz;
          const ex = sx - carDirection.x * len;
          const ez = sz - carDirection.z * len;

          s.alive = true;
          s.life  = 0;
          s.x0 = sx; s.y0 = carPosition.y + hy; s.z0 = sz;
          s.x1 = ex; s.y1 = carPosition.y + hy; s.z1 = ez;

          // Move backward at roughly car speed so the streak flies past
          s.vx = -carDirection.x * (speed * 0.9 + 5);
          s.vz = -carDirection.z * (speed * 0.9 + 5);

          // Alpha scales with speed (subtle at 40, strong at 150+)
          s.alpha = Math.min((speed - 40) / 120, 1.0) * (0.55 + Math.random() * 0.45);

          this.airStreamSystem.visible = true;
          break;
        }
      }
    }
    
    update(dt, carPosition, carDirection, carSpeed, isDrifting) {
      const time = performance.now() / 1000;
      
      // Update sparks
      if (this.sparkSystem.visible) {
        const positions = this.sparkSystem.geometry.attributes.position.array;
        const velocities = this.sparkSystem.geometry.attributes.velocity.array;
        const lifetimes = this.sparkSystem.geometry.attributes.lifetime.array;
        
        let activeCount = 0;
        for (let i = 0; i < this.maxSparks; i++) {
          if (lifetimes[i] < 1.0) {
            lifetimes[i] += dt * 3.0;
            positions[i * 3] += velocities[i * 3] * dt;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
            
            // Gravity
            velocities[i * 3 + 1] -= 9.8 * dt;
            
            activeCount++;
          }
        }
        
        this.sparkSystem.geometry.attributes.position.needsUpdate = true;
        this.sparkSystem.geometry.attributes.lifetime.needsUpdate = true;
        this.sparkSystem.visible = activeCount > 0;
      }
      
      // Update in-world speed-line streaks
      {
        const posArr  = this.airStreamSystem.geometry.attributes.position.array;
        const alpArr  = this.airStreamSystem.geometry.attributes.alpha.array;
        const lifArr  = this.airStreamSystem.geometry.attributes.lifetime.array;

        let activeCount = 0;
        for (let i = 0; i < this.maxAirStreams; i++) {
          const s = this._streams[i];
          if (!s.alive) {
            // Park off-screen so the LineSegments draw call skips it visually
            posArr[i * 6] = posArr[i * 6 + 3] = 0;
            posArr[i * 6 + 1] = posArr[i * 6 + 4] = -9999;
            posArr[i * 6 + 2] = posArr[i * 6 + 5] = 0;
            lifArr[i] = 0;
            alpArr[i] = 0;
            continue;
          }

          // Advance life (each streak lives ~0.18s at 60fps)
          s.life += dt * 5.5;
          if (s.life >= 1.0) {
            s.alive = false;
            continue;
          }

          // Translate both endpoints by velocity
          s.x0 += s.vx * dt;
          s.z0 += s.vz * dt;
          s.x1 += s.vx * dt;
          s.z1 += s.vz * dt;

          // Write to geometry buffer
          posArr[i * 6]     = s.x0; posArr[i * 6 + 1] = s.y0; posArr[i * 6 + 2] = s.z0;
          posArr[i * 6 + 3] = s.x1; posArr[i * 6 + 4] = s.y1; posArr[i * 6 + 5] = s.z1;
          lifArr[i] = s.life;
          alpArr[i] = s.alpha;
          activeCount++;
        }

        this.airStreamSystem.geometry.attributes.position.needsUpdate = true;
        this.airStreamSystem.geometry.attributes.lifetime.needsUpdate = true;
        this.airStreamSystem.geometry.attributes.alpha.needsUpdate = true;
        this.airStreamSystem.visible = activeCount > 0;
      }
      
      // Emit sparks when drifting or at high speed
      if (isDrifting && Math.random() < 0.3) {
        const side = Math.random() > 0.5 ? 1 : -1;
        const offset = new THREE.Vector3(carDirection.z, 0, -carDirection.x).multiplyScalar(side * 0.8);
        const sparkPos = carPosition.clone().add(offset);
        const sparkDir = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 2,
          (Math.random() - 0.5) * 2
        );
        this.emitSpark(sparkPos, sparkDir, 1.0);
      }
      
      // Emit speed-line streaks — rate scales with speed
      if (carSpeed >= 40) {
        // At 40kmh: ~1 pair/frame at 10fps, at 150kmh: ~4 pairs/frame at 60fps
        const emitCount = Math.ceil(Math.min(carSpeed / 50, 4));
        for (let _e = 0; _e < emitCount; _e++) {
          this.emitAirStream(carPosition, carDirection, carSpeed);
        }
      }
      
      // Update shader time
      if (this.sparkSystem.material.uniforms) {
        this.sparkSystem.material.uniforms.time.value = time;
      }
      if (this.airStreamSystem.material.uniforms) {
        this.airStreamSystem.material.uniforms.time.value = time;
      }
    }
  }
  
  ND.AnimeEffects = AnimeEffects;
})();
