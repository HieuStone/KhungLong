// Thảm cỏ 3D quanh camera: hàng chục nghìn khóm cỏ vẽ trong 1 draw call (instancing).
// Vị trí khóm cố định theo ô lưới thế giới (đi lại không bị "trôi"), chiều cao đất và màu lấy từ texture
// do terrain.js dựng sẵn, nên mọi tính toán nằm trên GPU.
import * as THREE from 'three';
import { WORLD_SIZE } from '@isle/shared';

const SPACING = 0.45;  // m giữa các khóm
const DEFAULT_RADIUS = 34; // m, bán kính thảm cỏ quanh camera (máy yếu dùng nhỏ hơn)
const BLADES = 8;      // lá mỗi khóm (mảnh, nhiều lá như cỏ thật)
const SEGS = 3;        // đốt mỗi lá (để lá cong)

/** Hình một khóm: BLADES lá thuôn nhọn, xoay ngẫu nhiên, cao/nghiêng khác nhau. Toạ độ y trong [0,1]. */
function clumpGeometry() {
  const pos = [], tip = [], idx = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < BLADES; b++) {
    const ang = rnd() * Math.PI * 2, lean = 0.15 + rnd() * 0.35, h = 0.55 + rnd() * 0.45, w = 0.018 + rnd() * 0.012;
    const ox = (rnd() - 0.5) * 0.25, oz = (rnd() - 0.5) * 0.25;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const base = pos.length / 3;
    for (let s = 0; s <= SEGS; s++) {
      const t = s / SEGS, hw = w * (1 - t * 0.92);
      const bend = lean * t * t; // cong dần về phía ngọn
      for (const side of [-1, 1]) {
        pos.push(ox + ca * bend - sa * hw * side, t * h, oz + sa * bend + ca * hw * side);
        tip.push(t);
      }
    }
    for (let s = 0; s < SEGS; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/**
 * field: { seg, height: Float32Array, color: Float32Array (rgb), grass: Float32Array (0..1) } theo lưới (seg+1)^2
 * của địa hình. Trả về { mesh, update(time, cameraPos) }.
 */
export function createGrass(scene, field, { radius: RADIUS = DEFAULT_RADIUS } = {}) {
  const N = field.seg + 1;
  const toHalf = THREE.DataUtils.toHalfFloat;
  const hData = new Uint16Array(N * N * 4), cData = new Uint16Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    hData[i * 4] = toHalf(field.height[i]); hData[i * 4 + 1] = toHalf(field.grass[i]); hData[i * 4 + 3] = toHalf(1);
    cData[i * 4] = toHalf(field.color[i * 3]); cData[i * 4 + 1] = toHalf(field.color[i * 3 + 1]); cData[i * 4 + 2] = toHalf(field.color[i * 3 + 2]); cData[i * 4 + 3] = toHalf(1);
  }
  const mkTex = (d) => {
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2() },  // ô lưới tâm (đơn vị ô)
    uCam: { value: new THREE.Vector3() },
    uHeight: { value: mkTex(hData) },
    uColor: { value: mkTex(cData) },
  };

  // Mỗi instance = độ lệch ô (số nguyên) so với ô tâm, trong hình tròn bán kính RADIUS
  const R = Math.ceil(RADIUS / SPACING), offs = [];
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= R * R) offs.push(i, j);
  const geo = clumpGeometry();
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(offs), 2));
  geo.instanceCount = offs.length / 2;

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  const half = WORLD_SIZE / 2, texel = 1 / N;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `uniform float uTime; uniform vec2 uCenter; uniform vec3 uCam;
      uniform sampler2D uHeight; uniform sampler2D uColor;
      attribute vec2 aCell; attribute float aTip;
      varying vec3 vGrassCol; varying float vTip;
      float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 fieldUv(vec2 xz){ return (xz + ${half.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)} * ${(1 - texel).toFixed(6)} + ${(texel / 2).toFixed(6)}; }
      ` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);`)
      .replace('#include <begin_vertex>', `
        vec2 cell = uCenter + aCell;
        float r1 = gh(cell), r2 = gh(cell + 17.3), r3 = gh(cell + 41.9);
        vec2 wxz = (cell + vec2(r1, r2) - 0.5) * ${SPACING.toFixed(3)};
        vec4 hf = texture2D(uHeight, fieldUv(wxz));
        float dist = length(wxz - uCam.xz);
        // mật độ (không mọc trên cát/đá/dưới nước) và thu nhỏ dần ở mép thảm để hoà vào mặt đất
        float s = smoothstep(0.25, 0.6, hf.g) * (1.0 - smoothstep(${(RADIUS * 0.6).toFixed(1)}, ${RADIUS.toFixed(1)}, dist));
        // mọc thành từng đám (noise lớn) để lộ đất/lá khô xen giữa, như bãi cỏ tự nhiên
        float clumpK = smoothstep(0.28, 0.62, fract(sin(dot(floor(wxz * 0.12), vec2(12.9898, 78.233))) * 43758.5453) * 0.5
          + 0.5 * (0.5 + 0.5 * sin(wxz.x * 0.21 + sin(wxz.y * 0.17) * 2.0)));
        float hgt = (0.28 + r3 * 0.5) * s * mix(0.35, 1.0, clumpK);
        float ang = r1 * 6.2832; float ca = cos(ang), sa = sin(ang);
        vec3 p = vec3(position.x * ca - position.z * sa, position.y, position.x * sa + position.z * ca) * vec3(0.9 + r2 * 0.5, hgt, 0.9 + r2 * 0.5);
        // gió: lá lay theo sóng lan trên mặt đất, càng lên ngọn càng lay
        float w = sin(uTime * 1.7 + wxz.x * 0.21 + wxz.y * 0.13) * 0.6 + sin(uTime * 3.1 + wxz.x * 0.9) * 0.25;
        p.xz += vec2(0.8, 0.5) * w * aTip * aTip * hgt * 0.45;
        vec3 transformed = vec3(wxz.x, hf.r - 0.03, wxz.y) + p;
        // màu từng khóm: xanh / ngả vàng khô / sẫm, như cỏ thật không đều màu
        vGrassCol = texture2D(uColor, fieldUv(wxz)).rgb * (0.8 + r3 * 0.35);
        vGrassCol = mix(vGrassCol, vGrassCol * vec3(1.35, 1.1, 0.55), smoothstep(0.55, 1.0, r2) * 0.8);
        vTip = aTip;`);
    sh.fragmentShader = 'varying vec3 vGrassCol; varying float vTip;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
       // gốc tối (bị lá khác che), ngọn sáng và hơi vàng
       diffuseColor.rgb = vGrassCol * mix(0.4, 1.1, vTip) * mix(vec3(1.0), vec3(1.06, 1.04, 0.88), vTip * vTip);`);
  };
  mat.customProgramCacheKey = () => 'grass-field';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // vị trí thật tính trên GPU
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    mesh,
    update(t, cam) {
      uniforms.uTime.value = t;
      uniforms.uCam.value.copy(cam);
      uniforms.uCenter.value.set(Math.round(cam.x / SPACING), Math.round(cam.z / SPACING));
    },
  };
}
