(function () {
  class PostProcessing {
    constructor(renderer, scene, camera) {
      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.composer = null;
      this.speedLinesPass = null;
      this.bloomPass = null;
      this.colorGradePass = null;
      this.motionBlurPass = null;
      
      this.speed = 0;
      this.targetSpeed = 0;
      this.speedLinesIntensity = 0;
      this.bloomIntensity = 1.5;
      this.motionBlurStrength = 0;
      
      this.init();
    }
    
    init() {
      // Create render targets for post-processing
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat
      });
      
      this.tempTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat
      });
      
      // Initialize passes
      this.initSpeedLines();
      this.initBloom();
      this.initColorGrading();
      this.initMotionBlur();
    }
    
    initSpeedLines() {
      // Speed lines shader - proper anime/Initial D style:
      // Dark radial streaks radiating FROM the edges TOWARD the car (screen center).
      // A clear hole in the middle keeps the subject visible.
      // Lines only exist in the vignette ring near the screen edges.
      const speedLinesVertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      
      const speedLinesFragmentShader = `
        uniform float time;
        uniform float intensity;
        uniform float speed;
        uniform vec2 resolution;
        varying vec2 vUv;
        
        // Deterministic hash — stable per-line, only flickers on integer step
        float hash(float n) {
          return fract(sin(n * 127.1 + 311.7) * 43758.5453);
        }
        
        void main() {
          // Aspect-correct UV so the clear center hole is a circle, not an ellipse
          float aspect = resolution.x / resolution.y;
          vec2 uv = vUv - 0.5;
          uv.x *= aspect;
          
          float dist  = length(uv);                    // 0 at center, grows outward
          float angle = atan(uv.y, uv.x);              // -PI..PI around center
          
          // ── Vignette ring ─────────────────────────────────────────────────────
          // Lines only live in the outer ring: innerRadius..1.0 (normalised to max corner dist)
          float maxDist    = length(vec2(aspect * 0.5, 0.5)); // corner distance
          float normDist   = dist / maxDist;                  // 0..1
          float innerEdge  = 0.35;   // clear hole radius (car stays visible)
          float outerEdge  = 0.72;   // lines fade in fully by here
          
          // Fade: 0 inside hole, ramps up in the band, full at outer edge
          float ringMask = smoothstep(innerEdge, outerEdge, normDist);
          // Also fade slightly near the very corners so it doesn't look like a box
          float cornerFade = 1.0 - smoothstep(0.88, 1.0, normDist);
          ringMask *= cornerFade;
          
          // ── Radial line pattern ───────────────────────────────────────────────
          float NUM_LINES = 60.0;
          // Quantise angle into sectors; add a slow time drift for animation
          float sector    = (angle / 6.28318) * NUM_LINES;   // 0..NUM_LINES
          float sectorI   = floor(sector);                    // which line
          float sectorF   = fract(sector);                    // position within sector
          
          // Per-line randomness: width and opacity flicker (slow step, no strobing)
          float timeStepped = floor(time * 8.0);              // flicker ~8fps
          float lineWidth   = 0.08 + 0.22 * hash(sectorI * 3.7 + timeStepped * 0.1);
          float lineOpacity = 0.5  + 0.5  * hash(sectorI * 1.3 + timeStepped * 0.17);
          
          // Sharp-edged line within its sector (smoothstep gives the tapered edge look)
          float halfW = lineWidth * 0.5;
          float line  = smoothstep(halfW, halfW * 0.3, abs(sectorF - 0.5));
          
          // ── Length variation ─────────────────────────────────────────────────
          // Each line has a random inner cutoff so they don't all start at the same radius
          float lineStart = innerEdge + 0.05 * hash(sectorI * 2.1);
          float lineMask  = smoothstep(lineStart, lineStart + 0.06, normDist);
          
          // ── Compose ──────────────────────────────────────────────────────────
          float alpha = line * lineOpacity * ringMask * lineMask * intensity;
          
          // Dark lines (manga style): near-black, slight blue tint for the night racing feel
          vec3 lineColor = vec3(0.02, 0.02, 0.06);
          
          gl_FragColor = vec4(lineColor, alpha);
        }
      `;
      
      this.speedLinesMaterial = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          intensity: { value: 0 },
          speed: { value: 0 },
          resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: speedLinesVertexShader,
        fragmentShader: speedLinesFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false
      });
      
      this.speedLinesMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        this.speedLinesMaterial
      );
      this.speedLinesCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    initBloom() {
      // Simple bloom effect
      const bloomVertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      
      const bloomFragmentShader = `
        uniform sampler2D tDiffuse;
        uniform float intensity;
        varying vec2 vUv;
        
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          
          // Simple glow
          vec2 offset = vec2(1.0 / 512.0);
          vec4 glow = vec4(0.0);
          glow += texture2D(tDiffuse, vUv + offset) * 0.25;
          glow += texture2D(tDiffuse, vUv - offset) * 0.25;
          glow += texture2D(tDiffuse, vUv + vec2(offset.x, -offset.y)) * 0.25;
          glow += texture2D(tDiffuse, vUv + vec2(-offset.x, offset.y)) * 0.25;
          
          glow = max(glow - color, 0.0) * intensity;
          
          gl_FragColor = color + glow;
        }
      `;
      
      this.bloomMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          intensity: { value: this.bloomIntensity }
        },
        vertexShader: bloomVertexShader,
        fragmentShader: bloomFragmentShader
      });
      
      this.bloomMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        this.bloomMaterial
      );
      this.bloomCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    initColorGrading() {
      // Anime-style color grading
      const colorGradeVertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      
      const colorGradeFragmentShader = `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          
          // Increase contrast
          color.rgb = (color.rgb - 0.5) * 1.15 + 0.5;
          
          // Slight blue tint for night racing feel
          color.rgb = mix(color.rgb, color.rgb * vec3(0.95, 0.97, 1.05), 0.1);
          
          // Boost highlights
          float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          if (lum > 0.7) {
            color.rgb *= 1.1;
          }
          
          // Saturate slightly
          float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          color.rgb = mix(vec3(gray), color.rgb, 1.1);
          
          gl_FragColor = color;
        }
      `;
      
      this.colorGradeMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null }
        },
        vertexShader: colorGradeVertexShader,
        fragmentShader: colorGradeFragmentShader
      });
      
      this.colorGradeMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        this.colorGradeMaterial
      );
      this.colorGradeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    initMotionBlur() {
      // Motion blur based on speed
      const motionBlurVertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      
      const motionBlurFragmentShader = `
        uniform sampler2D tDiffuse;
        uniform float strength;
        uniform vec2 direction;
        varying vec2 vUv;
        
        void main() {
          vec4 color = vec4(0.0);
          float total = 0.0;
          
          int samples = 8;
          for (int i = 0; i < samples; i++) {
            float offset = float(i) / float(samples - 1) - 0.5;
            vec2 uv = vUv + direction * offset * strength;
            color += texture2D(tDiffuse, uv);
            total += 1.0;
          }
          
          gl_FragColor = color / total;
        }
      `;
      
      this.motionBlurMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          strength: { value: 0 },
          direction: { value: new THREE.Vector2(0, -1) }
        },
        vertexShader: motionBlurVertexShader,
        fragmentShader: motionBlurFragmentShader
      });
      
      this.motionBlurMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        this.motionBlurMaterial
      );
      this.motionBlurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    setSpeed(speed) {
      this.targetSpeed = speed;
    }
    
    update(dt, time) {
      // Smooth speed transition
      this.speed += (this.targetSpeed - this.speed) * 5.0 * dt;
      
      // Calculate speed lines intensity based on speed
      const targetIntensity = Math.min(this.speed / 100.0, 1.0);
      this.speedLinesIntensity += (targetIntensity - this.speedLinesIntensity) * 3.0 * dt;
      
      // Update speed lines
      if (this.speedLinesMaterial) {
        this.speedLinesMaterial.uniforms.time.value = time;
        this.speedLinesMaterial.uniforms.intensity.value = this.speedLinesIntensity;
        this.speedLinesMaterial.uniforms.speed.value = this.speed;
      }
      
      // Update motion blur
      const targetMotionBlur = Math.min(this.speed / 150.0, 0.03);
      this.motionBlurStrength += (targetMotionBlur - this.motionBlurStrength) * 2.0 * dt;
      if (this.motionBlurMaterial) {
        this.motionBlurMaterial.uniforms.strength.value = this.motionBlurStrength;
      }
    }
    
    render(scene, camera) {
      const renderer = this.renderer.three;
      
      try {
        // --- Pass 1: Render scene to renderTarget ---
        renderer.setRenderTarget(this.renderTarget);
        renderer.clear();
        renderer.render(scene, camera);
        
        // --- Pass 2: Bloom (renderTarget → tempTarget) ---
        if (this.bloomMaterial) {
          this.bloomMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
          renderer.setRenderTarget(this.tempTarget);
          renderer.clear();
          renderer.render(this.bloomMesh, this.bloomCamera);
        }
        
        // --- Pass 3: Motion blur (tempTarget → renderTarget) ---
        if (this.motionBlurStrength > 0.001 && this.motionBlurMaterial) {
          this.motionBlurMaterial.uniforms.tDiffuse.value = this.tempTarget.texture;
          renderer.setRenderTarget(this.renderTarget);
          renderer.clear();
          renderer.render(this.motionBlurMesh, this.motionBlurCamera);
          // Color grade reads from renderTarget below (already set)
        } else {
          // No motion blur — copy tempTarget back into renderTarget so color grade reads it
          if (this.bloomMaterial) {
            // Swap: color grade should read tempTarget
            this._colorGradeSource = this.tempTarget.texture;
          } else {
            this._colorGradeSource = this.renderTarget.texture;
          }
        }
        
        // --- Pass 4: Color grade → screen ---
        renderer.setRenderTarget(null);
        renderer.clear();
        
        if (this.colorGradeMaterial) {
          // If motion blur ran, it wrote to renderTarget; otherwise use tempTarget (bloom output)
          const source = (this.motionBlurStrength > 0.001 && this.motionBlurMaterial)
            ? this.renderTarget.texture
            : (this._colorGradeSource || this.renderTarget.texture);
          this.colorGradeMaterial.uniforms.tDiffuse.value = source;
          this.colorGradeMesh.visible = true;
          renderer.render(this.colorGradeMesh, this.colorGradeCamera);
        }
        
        // --- Pass 5: Speed lines overlay (additive, no clear) ---
        if (this.speedLinesIntensity > 0.01 && this.speedLinesMesh) {
          renderer.autoClear = false; // FIX: don't wipe the color grade output
          this.speedLinesMesh.visible = true;
          renderer.render(this.speedLinesMesh, this.speedLinesCamera);
          renderer.autoClear = true;
        }
      } catch (e) {
        console.error("Post-processing error:", e);
        // Fallback to direct rendering
        renderer.autoClear = true;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    }
    
    resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      this.renderTarget.setSize(width, height);
      this.tempTarget.setSize(width, height);
      
      if (this.speedLinesMaterial) {
        this.speedLinesMaterial.uniforms.resolution.value.set(width, height);
      }
    }
  }
  
  ND.PostProcessing = PostProcessing;
})();
