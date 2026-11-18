// Hậu kỳ màu (chạy trên ảnh HDR trước tone mapping): độ tương phản, độ bão hoà, tông màu theo giờ,
// tối góc (vignette) và hạt phim nhẹ — bớt cảm giác "trong veo, sạch bong" của ảnh dựng thô.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 0.9 },
    uContrast: { value: 1.12 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uGrain, uTime; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // tương phản quanh mức xám giữa (log), giữ vùng sáng không bị cháy
      c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(uContrast));
      c *= uTint;
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.2, 0.75, dot(d, d) * 2.2);
      c += (hash(vUv * 1000.0 + fract(uTime) * 61.0) - 0.5) * uGrain * (sqrt(l) + 0.02);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const T_DAY = new THREE.Color(1.06, 1.0, 0.9), T_DUSK = new THREE.Color(1.12, 0.96, 0.84), T_NIGHT = new THREE.Color(0.8, 0.92, 1.22);

/** Tạo bộ hậu kỳ. Trả về { render(), setSize(w,h), update(skyState, t) }. */
export function createGrade(renderer, scene, camera, { samples = 4, grain = true } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass()); // tone mapping + sRGB
  const u = grade.uniforms;
  return {
    render() { composer.render(); },
    setSize(w, h) { composer.setSize(w, h); },
    /** Tông màu theo giờ: ngày trung tính hơi ấm, hoàng hôn cam, đêm xanh và nhạt màu (mắt người thấy kém màu khi tối). */
    update(sky, t) {
      const day = sky.daylight, dusk = sky.dusk;
      u.uTint.value.copy(T_NIGHT).lerp(T_DAY, ss(0, 0.6, day)).lerp(T_DUSK, dusk * 0.8);
      u.uSat.value = THREE.MathUtils.lerp(0.5, 0.95, ss(0, 0.6, day)) + dusk * 0.08;
      u.uVignette.value = THREE.MathUtils.lerp(0.5, 0.32, day);
      u.uGrain.value = grain ? THREE.MathUtils.lerp(0.035, 0.025, day) : 0;
      u.uTime.value = t;
      // Mắt thích nghi: đêm phơi sáng cao hơn để vẫn nhìn được dưới ánh trăng
      renderer.toneMappingExposure = THREE.MathUtils.lerp(2.2, 0.78, ss(0, 0.7, day));
    },
  };
}
