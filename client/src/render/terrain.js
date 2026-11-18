import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL, heightAt } from '@isle/shared';
import { waterNormalTexture } from './textures.js';
import { pbr } from './pbr.js';

// smoothstep: nội suy mượt từ 0 (x<=a) tới 1 (x>=b)
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// value noise 2D xác định (chỉ để tô màu, không ảnh hưởng gameplay)
const fract = (x) => x - Math.floor(x);
const hash2 = (x, z, s) => fract(Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453);
function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z, s) => vnoise(x, z, s) * 0.55 + vnoise(x * 2.3, z * 2.3, s + 5) * 0.3 + vnoise(x * 5.1, z * 5.1, s + 9) * 0.15;

// Bảng màu tự nhiên (đã giảm độ bão hoà so với bản cũ)
const C = (h) => new THREE.Color(h);
const SEABED = C(0x5f6650), WET_SAND = C(0x8f7f5f), SAND = C(0xc9b78e);
const GRASS = C(0x4a6a32), GRASS_LUSH = C(0x37582a), GRASS_DRY = C(0x8a8a55), DIRT = C(0x6a5638);
const ROCK = C(0x6f6b64), ROCK_DARK = C(0x4f4c48);

const SEG = 320; // ~3 m mỗi ô

/** Tạo địa hình và mặt nước (cây/đá nằm ở flora.js). Trả về { group, update(t) }. */
export function createTerrain(scene, { detail = true } = {}) {
  const group = new THREE.Group();

  // ---- Địa hình: lưới SEGxSEG ô, đỉnh y = heightAt(x, z) ----
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;

  // Màu theo độ cao, độ dốc và noise: đáy biển -> cát ướt -> cát -> cỏ (tươi/khô/đất) -> đá ở chỗ dốc/cao
  const colors = new Float32Array(pos.count * 3);
  const heights = new Float32Array(pos.count), grass = new Float32Array(pos.count); // cho thảm cỏ (grass.js)
  // Trọng số trộn ảnh mặt đất: (cỏ, đất lá rừng, cát khô, cát ướt/đáy biển) + đá; và màu nhuộm vĩ mô (vùng cỏ tươi/khô)
  const wts = new Float32Array(pos.count * 4), rockW = new Float32Array(pos.count), tint = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), g = new THREE.Color(), rk = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const slope = 1 - nrm.getY(i); // 0 = phẳng
    const n1 = fbm(x * 0.012, z * 0.012, 1), n2 = fbm(x * 0.05, z * 0.05, 2), n3 = vnoise(x * 0.3, z * 0.3, 3);
    // cỏ: mảng tươi/khô lớn, lốm đốm đất nhỏ
    g.copy(GRASS).lerp(GRASS_LUSH, ss(0.45, 0.7, n1)).lerp(GRASS_DRY, ss(0.55, 0.8, 1 - n1) * 0.6);
    g.lerp(DIRT, ss(0.62, 0.8, n2) * 0.55);
    rk.copy(ROCK).lerp(ROCK_DARK, n2);
    // cát -> cỏ (ranh giới gợn theo noise), cát ướt sát mép nước
    const beach = 2.2 + (n2 - 0.5) * 1.6;
    const sandT = 1 - ss(beach - 0.6, beach + 0.6, y);
    c.copy(g).lerp(SAND, sandT);
    c.lerp(WET_SAND, 1 - ss(WATER_LEVEL - 0.1, WATER_LEVEL + 0.5, y));
    // dưới nước: tối và ngả xanh rêu theo độ sâu
    c.lerp(SEABED, ss(WATER_LEVEL - 0.3, WATER_LEVEL - 4, y));
    // đá: chỗ dốc hoặc núi cao
    const rockT = Math.max(ss(0.28, 0.45, slope + (n2 - 0.5) * 0.12), ss(15, 21, y + (n1 - 0.5) * 4));
    c.lerp(rk, y > WATER_LEVEL ? rockT : rockT * 0.5);
    c.multiplyScalar(0.92 + n3 * 0.16);
    colors.set([c.r, c.g, c.b], i * 3);
    heights[i] = y;
    {
      const wet = 1 - ss(WATER_LEVEL - 0.2, WATER_LEVEL + 0.7, y);
      const forestT = Math.min(1, ss(0.55, 0.78, n2) * 0.9 + ss(0.5, 0.75, n1) * 0.35);
      const land = (1 - sandT) * (1 - wet);
      const rw = y > WATER_LEVEL ? rockT : rockT * 0.4;
      const rest = 1 - rw;
      wts.set([land * (1 - forestT) * rest, land * forestT * rest, sandT * (1 - wet) * rest, wet * rest], i * 4);
      rockW[i] = rw;
      // nhuộm: tươi (xanh hơn) / khô (vàng) theo mảng lớn; đá chỗ cao hơi sáng
      const lush = ss(0.45, 0.72, n1), dry = ss(0.55, 0.8, 1 - n1) * 0.6;
      const k = 0.92 + n3 * 0.16;
      tint.set([(0.86 + dry * 0.2 - lush * 0.06) * k, (1.0 + lush * 0.06) * k, (0.86 - dry * 0.1) * k], i * 3);
    }
    grass[i] = (1 - sandT) * (1 - rockT) * (1 - ss(0.62, 0.85, n2) * 0.6) * ss(WATER_LEVEL + 0.8, WATER_LEVEL + 1.6, y);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  geo.setAttribute('aW', new THREE.BufferAttribute(wts, 4));
  geo.setAttribute('aRock', new THREE.BufferAttribute(rockW, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));

  // ---- Vật liệu mặt đất: trộn 5 chất liệu ảnh chụp thật (PBR) theo trọng số từng đỉnh ----
  // Cỏ/đất/cát chiếu theo mặt phẳng XZ; đá chiếu 3 phía (triplanar) để vách dốc không bị kéo giãn.
  // Mỗi lớp lấy mẫu ở 2 tỉ lệ khác nhau rồi trộn => không lộ ô lặp. detail=false (máy yếu): bỏ bản đồ pháp tuyến.
  const L = { g: pbr('leafy_grass'), f: pbr('forest_leaves_02'), s: pbr('coast_sand_01'), w: pbr('damp_beach_sand'), r: pbr('mossy_rock') };
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const U = {
    tG: { value: L.g.map }, tF: { value: L.f.map }, tS: { value: L.s.map }, tW: { value: L.w.map }, tR: { value: L.r.map },
    nG: { value: L.g.normal }, nF: { value: L.f.normal }, nS: { value: L.s.normal }, nW: { value: L.w.normal }, nR: { value: L.r.normal },
  };
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = `attribute vec4 aW; attribute float aRock; attribute vec3 aTint;
      varying vec4 vW; varying float vRock; varying vec3 vTint; varying vec3 vWPos; varying vec3 vWN;
      ` + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
        vW = aW; vRock = aRock; vTint = aTint;`);
    sh.fragmentShader = `
      uniform sampler2D tG, tF, tS, tW, tR, nG, nF, nS, nW, nR;
      varying vec4 vW; varying float vRock; varying vec3 vTint; varying vec3 vWPos; varying vec3 vWN;
      float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }
      // lấy mẫu 2 tỉ lệ, trộn theo noise lớn => giấu ô lặp
      vec3 sampleC(sampler2D t, vec2 uv, float k){ return mix(texture2D(t, uv).rgb, texture2D(t, uv * 0.29 + 0.37).rgb, k); }
      vec2 sampleN(sampler2D t, vec2 uv, float k){ return mix(texture2D(t, uv).xy, texture2D(t, uv * 0.29 + 0.37).xy, k) * 2.0 - 1.0; }
      ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wp = vWPos.xz;
        float mixK = smoothstep(0.3, 0.7, tn(wp * 0.035));
        vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 cG = vW.x > 0.01 ? sampleC(tG, wp / 4.0, mixK) : vec3(0.0);
        vec3 cF = vW.y > 0.01 ? sampleC(tF, wp / 3.5, mixK) : vec3(0.0);
        vec3 cS = vW.z > 0.01 ? sampleC(tS, wp / 5.0, mixK) : vec3(0.0);
        vec3 cW = vW.w > 0.01 ? sampleC(tW, wp / 5.0, mixK) : vec3(0.0);
        vec3 cR = vec3(0.0);
        if (vRock > 0.01) cR = texture2D(tR, vWPos.zy / 7.0).rgb * bw.x + texture2D(tR, vWPos.xz / 7.0).rgb * bw.y + texture2D(tR, vWPos.xy / 7.0).rgb * bw.z;
        vec3 alb = cG * vW.x * vec3(0.92, 1.08, 0.82) + cF * vW.y + cS * vW.z * 1.15 + cW * vW.w + cR * vRock;
        alb *= vTint;
        // đáy biển: tối dần, ngả xanh rêu theo độ sâu
        float depth = clamp(-vWPos.y / 5.0, 0.0, 1.0), abyss = clamp(-vWPos.y / 40.0, 0.0, 1.0);
        alb = mix(alb, alb * vec3(0.45, 0.6, 0.55), depth);
        alb = mix(alb, vec3(0.012, 0.03, 0.04), abyss); // biển sâu: đáy chìm vào màu xanh thẫm
        diffuseColor.rgb = alb;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = dot(vW, vec4(0.95, 0.92, 0.9, 0.42)) + vRock * 0.82;`)
      .replace('#include <normal_fragment_maps>', `${detail ? `
        {
          vec2 wq = vWPos.xz;
          float mk = smoothstep(0.3, 0.7, tn(wq * 0.035));
          vec2 d = vec2(0.0);
          if (vW.x > 0.01) d += sampleN(nG, wq / 4.0, mk) * vW.x;
          if (vW.y > 0.01) d += sampleN(nF, wq / 3.5, mk) * vW.y;
          if (vW.z > 0.01) d += sampleN(nS, wq / 5.0, mk) * vW.z;
          if (vW.w > 0.01) d += sampleN(nW, wq / 5.0, mk) * vW.w;
          vec3 wn = vWN + vec3(d.x, 0.0, d.y) * 0.9; // u = +x, v = +z
          if (vRock > 0.01) {
            vec3 bw2 = pow(abs(vWN), vec3(4.0)); bw2 /= (bw2.x + bw2.y + bw2.z);
            vec2 rx = texture2D(nR, vWPos.zy / 7.0).xy * 2.0 - 1.0, ry = texture2D(nR, vWPos.xz / 7.0).xy * 2.0 - 1.0, rz = texture2D(nR, vWPos.xy / 7.0).xy * 2.0 - 1.0;
            wn += (vec3(0.0, rx.y, rx.x) * bw2.x + vec3(ry.x, 0.0, ry.y) * bw2.y + vec3(rz.x, rz.y, 0.0) * bw2.z) * vRock * 1.1;
          }
          // nhìn xa: bớt chi tiết (tránh lấp lánh)
          float far = smoothstep(60.0, 200.0, length(vWPos - cameraPosition));
          wn = normalize(mix(wn, vWN, far));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }` : ''}`);
  };
  groundMat.customProgramCacheKey = () => 'terrain-splat-' + (detail ? 'hi' : 'lo');
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- Mặt nước: phản chiếu bầu trời (IBL), gợn sóng động, trong ở chỗ nông ----
  const normals = waterNormalTexture();
  normals.repeat.set(380, 380); // ô sóng ~8 m
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0f3442, roughness: 0.06, metalness: 0.0,
    normalMap: normals, normalScale: new THREE.Vector2(0.13, 0.13),
    transparent: true, opacity: 0.78, depthWrite: false,
  });
  // Lớp sóng thứ hai (hướng khác, tần số khác) để không lộ hoạ tiết lặp
  const uTime = { value: 0 };
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', `
      vec3 n1 = texture2D(normalMap, vNormalMapUv + vec2(uTime * 0.011, uTime * 0.006)).xyz * 2.0 - 1.0;
      vec3 n2 = texture2D(normalMap, vNormalMapUv * 0.23 + vec2(-uTime * 0.004, uTime * 0.009)).xyz * 2.0 - 1.0;
      // xa thì gợn nhỏ lại (tránh vệt sọc do texture bị nén ở góc nhìn sát mặt nước)
      float wFar = 1.0 - smoothstep(30.0, 220.0, length(vViewPosition)) * 0.75;
      vec3 mapN = normalize(vec3((n1.xy + n2.xy) * normalScale * wFar, n1.z * n2.z));
      normal = normalize(tbn * mapN);`);
  };
  waterMat.customProgramCacheKey = () => 'water-2layer';
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  water.receiveShadow = true;
  group.add(water);

  scene.add(group);
  return { group, field: { seg: SEG, height: heights, color: colors, grass }, update(t) { uTime.value = t; } };
}
