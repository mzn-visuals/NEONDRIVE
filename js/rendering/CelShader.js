(function () {
  class CelShaderMaterial extends THREE.ShaderMaterial {
    constructor(params = {}) {
      const vertexShader = `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec2 vUv;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          vUv = uv;
          gl_Position = projectionMatrix * mvPosition;
        }
      `;
      
      const fragmentShader = `
        uniform vec3 diffuse;
        uniform vec3 specular;
        uniform float shininess;
        uniform vec3 emissive;
        uniform vec3 lightColor;
        uniform vec3 lightPosition;
        uniform float ambientIntensity;
        uniform int colorSteps;
        
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec2 vUv;
        
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          vec3 lightDir = normalize(lightPosition - vViewPosition);
          
          // Ambient
          vec3 ambient = ambientIntensity * lightColor;
          
          // Diffuse with cel-shading (stepped)
          float diff = max(dot(normal, lightDir), 0.0);
          float stepSize = 1.0 / float(colorSteps);
          float steppedDiff = floor(diff / stepSize) * stepSize;
          vec3 diffuseColor = steppedDiff * diffuse * lightColor;
          
          // Specular with cel-shading
          vec3 halfDir = normalize(lightDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), shininess);
          float steppedSpec = step(0.5, spec);
          vec3 specularColor = steppedSpec * specular * lightColor;
          
          // Rim lighting for anime outline effect
          float rim = 1.0 - max(dot(viewDir, normal), 0.0);
          rim = smoothstep(0.6, 1.0, rim);
          vec3 rimColor = rim * lightColor * 0.5;
          
          // Combine
          vec3 color = ambient + diffuseColor + specularColor + emissive + rimColor;
          
          gl_FragColor = vec4(color, 1.0);
        }
      `;
      
      super({
        uniforms: {
          diffuse: { value: new THREE.Color(params.diffuse || 0xffffff) },
          specular: { value: new THREE.Color(params.specular || 0xffffff) },
          shininess: { value: params.shininess || 30.0 },
          emissive: { value: new THREE.Color(params.emissive || 0x000000) },
          lightColor: { value: new THREE.Color(params.lightColor || 0xffffff) },
          lightPosition: { value: new THREE.Vector3(params.lightPosition || [5, 5, 5]) },
          ambientIntensity: { value: params.ambientIntensity || 0.3 },
          colorSteps: { value: params.colorSteps || 4 }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
      });
    }
  }
  
  ND.CelShaderMaterial = CelShaderMaterial;
})();
