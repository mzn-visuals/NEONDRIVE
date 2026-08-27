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
      // White air streams behind cars (Initial D style)
      const streamGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(this.maxAirStreams * 6); // 2 points per line
      const velocities = new Float32Array(this.maxAirStreams * 3);
      const lifetimes = new Float32Array(this.maxAirStreams);
      const widths = new Float32Array(this.maxAirStreams);
      
      streamGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      streamGeometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
      streamGeometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
      streamGeometry.setAttribute('width', new THREE.BufferAttribute(widths, 1));
      
      const streamMaterial = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 }
        },
        vertexShader: `
          attribute float lifetime;
          attribute float width;
          varying float vLifetime;
          varying float vWidth;
          
          void main() {
            vLifetime = lifetime;
            vWidth = width;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying float vLifetime;
          varying float vWidth;
          
          void main() {
            float alpha = (1.0 - vLifetime) * 0.6;
            vec3 color = vec3(0.95, 0.97, 1.0);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      
      this.airStreamSystem = new THREE.LineSegments(streamGeometry, streamMaterial);
      this.airStreamSystem.visible = false;
      this.scene.add(this.airStreamSystem);
      
      // Initialize air stream data
      for (let i = 0; i < this.maxAirStreams; i++) {
        lifetimes[i] = 1.0; // Dead
        widths[i] = 0.0;
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
      if (speed < 30) return; // Only at high speeds
      
      const positions = this.airStreamSystem.geometry.attributes.position.array;
      const velocities = this.airStreamSystem.geometry.attributes.velocity.array;
      const lifetimes = this.airStreamSystem.geometry.attributes.lifetime.array;
      const widths = this.airStreamSystem.geometry.attributes.width.array;
      
      // Find dead stream
      for (let i = 0; i < this.maxAirStreams; i++) {
        if (lifetimes[i] >= 1.0) {
          lifetimes[i] = 0.0;
          
          // Start point (behind car)
          const offset = -2.0;
          positions[i * 6] = carPosition.x + carDirection.x * offset;
          positions[i * 6 + 1] = carPosition.y + 0.3;
          positions[i * 6 + 2] = carPosition.z + carDirection.z * offset;
          
          // End point (further behind)
          const length = 3.0 + speed * 0.02;
          positions[i * 6 + 3] = carPosition.x + carDirection.x * (offset - length);
          positions[i * 6 + 4] = carPosition.y + 0.3;
          positions[i * 6 + 5] = carPosition.z + carDirection.z * (offset - length);
          
          // Velocity (move backward)
          velocities[i * 3] = -carDirection.x * speed * 0.5;
          velocities[i * 3 + 1] = 0;
          velocities[i * 3 + 2] = -carDirection.z * speed * 0.5;
          
          widths[i] = 0.1 + speed * 0.001;
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
      
      // Update air streams
      if (this.airStreamSystem.visible) {
        const positions = this.airStreamSystem.geometry.attributes.position.array;
        const velocities = this.airStreamSystem.geometry.attributes.velocity.array;
        const lifetimes = this.airStreamSystem.geometry.attributes.lifetime.array;
        
        let activeCount = 0;
        for (let i = 0; i < this.maxAirStreams; i++) {
          if (lifetimes[i] < 1.0) {
            lifetimes[i] += dt * 1.5;
            
            // Move both points
            positions[i * 6] += velocities[i * 3] * dt;
            positions[i * 6 + 1] += velocities[i * 3 + 1] * dt;
            positions[i * 6 + 2] += velocities[i * 3 + 2] * dt;
            positions[i * 6 + 3] += velocities[i * 3] * dt;
            positions[i * 6 + 4] += velocities[i * 3 + 1] * dt;
            positions[i * 6 + 5] += velocities[i * 3 + 2] * dt;
            
            activeCount++;
          }
        }
        
        this.airStreamSystem.geometry.attributes.position.needsUpdate = true;
        this.airStreamSystem.geometry.attributes.lifetime.needsUpdate = true;
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
      
      // Emit air streams at high speed
      if (Math.random() < 0.1) {
        this.emitAirStream(carPosition, carDirection, carSpeed);
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
