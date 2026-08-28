(function () {
  class PostProcessing {
    constructor(renderer, scene, camera) {
      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.composer = null;
      // speedLines moved to AnimeEffects
      this.bloomPass = null;
      this.colorGradePass = null;
      this.motionBlurPass = null;
      
      this.speed = 0;
      this.targetSpeed = 0;
      this.bloomIntensity = 0.6;
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
      // Speed lines moved to AnimeEffects.js (in-world 3D geometry)
      this.initBloom();
      this.initColorGrading();
      this.initMotionBlur();
    }
    
    initBloom    initBloom() {
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
        uniform vec2 resolution;
        varying vec2 vUv;
        
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          
          // Resolution-relative offset (hardcoded 1/512 blew out at low render target sizes)
          vec2 offset = vec2(1.5) / resolution;
          vec4 glow = vec4(0.0);
          glow += texture2D(tDiffuse, vUv + offset) * 0.25;
          glow += texture2D(tDiffuse, vUv - offset) * 0.25;
          glow += texture2D(tDiffuse, vUv + vec2(offset.x, -offset.y)) * 0.25;
          glow += texture2D(tDiffuse, vUv + vec2(-offset.x, offset.y)) * 0.25;
          
          // Threshold: only bloom genuinely bright pixels, not flat road/ground
          float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          glow = max(glow - color, 0.0) * intensity;
          glow *= smoothstep(0.62, 0.85, lum);
          
          gl_FragColor = color + glow;
        }
      `;
      
      this.bloomMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          intensity: { value: this.bloomIntensity },
          resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
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
      // Update motion blur
      const targetMotionBlur = this.speed > 120 ? Math.min((this.speed - 120) / 200.0, 0.018) : 0;
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
      
      if (this.bloomMaterial) {
        this.bloomMaterial.uniforms.resolution.value.set(width, height);
      }
    }
  }
  
  ND.PostProcessing = PostProcessing;
})();
