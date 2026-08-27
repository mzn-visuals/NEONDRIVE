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
      // Speed lines shader - manga-style radial lines
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
        
        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }
        
        void main() {
          vec2 uv = vUv;
          vec2 center = vec2(0.5);
          vec2 dir = uv - center;
          float dist = length(dir);
          float angle = atan(dir.y, dir.x);
          
          // Create radial speed lines
          float lines = 0.0;
          float numLines = 40.0;
          
          for (float i = 0.0; i < numLines; i++) {
            float lineAngle = (i / numLines) * 6.28318 + time * 0.5;
            float angleDiff = abs(angle - lineAngle);
            if (angleDiff > 3.14159) angleDiff = 6.28318 - angleDiff;
            
            float line = smoothstep(0.02, 0.0, angleDiff) * smoothstep(0.5, 0.3, dist);
            float flicker = random(vec2(i, time * 10.0)) * 0.5 + 0.5;
            lines += line * flicker;
          }
          
          // Add motion streaks
          float streak = smoothstep(0.0, 0.3, dist) * smoothstep(0.5, 0.3, dist);
          streak *= sin(dist * 20.0 - time * 5.0) * 0.5 + 0.5;
          
          vec3 color = vec3(lines * intensity * 0.8);
          color += vec3(streak * intensity * 0.3);
          
          gl_FragColor = vec4(color, lines * intensity * 0.6 + streak * intensity * 0.2);
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
        // Render scene to target
        renderer.setRenderTarget(this.renderTarget);
        renderer.clear();
        renderer.render(scene, camera);
        
        // Apply color grading directly to screen
        renderer.setRenderTarget(null);
        renderer.clear();
        
        if (this.colorGradeMaterial) {
          this.colorGradeMaterial.uniforms.tDiffuse.value = this.renderTarget.texture;
          this.colorGradeMesh.visible = true;
          renderer.render(this.colorGradeMesh, this.colorGradeCamera);
        }
        
        // Render speed lines overlay
        if (this.speedLinesIntensity > 0.01 && this.speedLinesMesh) {
          this.speedLinesMesh.visible = true;
          renderer.render(this.speedLinesMesh, this.speedLinesCamera);
        }
      } catch (e) {
        console.error("Post-processing error:", e);
        // Fallback to direct rendering
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
