(function () {
  class Renderer {
    constructor(canvas, settings) {
      this.canvas = canvas;
      this.three = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance"
      });
      this.three.outputEncoding = THREE.sRGBEncoding;
      this.three.toneMapping = THREE.ACESFilmicToneMapping;
      this.three.toneMappingExposure = 1.15;
      this.setQuality(settings.quality);
      window.addEventListener("resize", () => this.resize());
      
      // Post-processing
      this.postProcessing = null;
      this.scene = null;
      this.camera = null;
    }

    setQuality(quality) {
      this.quality = quality;
      const q = ND.Config.QUALITY[quality] || ND.Config.QUALITY.medium;
      const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
      this.three.setPixelRatio(pr);
      this.drawDistance = q.drawDistance;
      this.particleScale = q.particles;
      this.resize();
    }

    resize() {
      this.three.setSize(window.innerWidth, window.innerHeight);
      if (this.postProcessing) {
        this.postProcessing.resize();
      }
      ND.bus.emit("renderer-resize");
    }

    initPostProcessing(scene, camera) {
      this.scene = scene;
      this.camera = camera;
      this.postProcessing = new ND.PostProcessing(this, scene, camera);
    }

    render(scene, camera, dt, time) {
      if (this.postProcessing) {
        this.postProcessing.update(dt, time);
        this.postProcessing.render(scene, camera);
      } else {
        this.three.render(scene, camera);
      }
    }
    
    setSpeed(speed) {
      if (this.postProcessing) {
        this.postProcessing.setSpeed(speed);
      }
    }
  }

  ND.srgb = function (hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
  };

  ND.lerpColorInto = function (target, hexA, hexB, t) {
    target.copy(hexA).lerp(hexB, t);
    return target;
  };

  ND.Renderer = Renderer;
})();
