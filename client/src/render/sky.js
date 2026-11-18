import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// ============================================================
// Bầu trời + chu kỳ ngày đêm.
// Giờ trong ngày tính từ đồng hồ máy (Date.now) nên mọi người chơi thấy cùng một giờ, không cần server.
// Debug: ?tod=0.5 (cố định giờ: 0 nửa đêm, 0.25 bình minh, 0.5 trưa, 0.75 hoàng hôn), ?daylen=60 (giây/ngày)
// ============================================================
const Q = new URLSearchParams(globalThis.location?.search || '');
const DAY_LEN = +(Q.get('daylen') || 24 * 60); // giây cho một ngày đêm (mặc định 24 phút)
const FIXED_TOD = Q.get('tod') != null ? +Q.get('tod') : null;
const MAX_ELEV = THREE.MathUtils.degToRad(56);
const ELEV_BIAS = THREE.MathUtils.degToRad(9); // ngày dài hơn đêm một chút
const BASE_AZ = THREE.MathUtils.degToRad(56);

const SHADOW_HALF = 55; // m, nửa cạnh vùng có bóng đổ quanh người chơi
const SHADOW_RES_DEFAULT = 2048;
const SKY_GAMMA = 2.1, SKY_GAIN = 0.95;
const NIGHT_FOG = new THREE.Color(0.012, 0.018, 0.034);
const DAY_FALLBACK_FOG = new THREE.Color(0.5, 0.6, 0.72);

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Giờ hiện tại trong ngày [0,1). */
export function timeOfDay() {
  if (FIXED_TOD != null) return ((FIXED_TOD % 1) + 1) % 1;
  return (Date.now() / 1000 / DAY_LEN + 0.3) % 1; // +0.3: lệch pha để mốc 0 của đồng hồ không rơi vào nửa đêm
}

/** Hướng mặt trời (vector đơn vị) và độ cao (rad) theo giờ. */
function sunState(tod, out) {
  const elev = MAX_ELEV * Math.sin(2 * Math.PI * (tod - 0.25)) + ELEV_BIAS;
  const az = BASE_AZ + (tod - 0.5) * Math.PI; // mọc phía đông, lặn phía tây
  out.setFromSphericalCoords(1, Math.PI / 2 - elev, az);
  return elev;
}

// Shader Sky gốc trả màu đã nén gamma rồi Three.js lại chuyển sRGB lần nữa -> trời bạc trắng. Kéo lại độ sâu màu.
function deepen(skyMesh, noSunDisc = false) {
  let fs = skyMesh.material.fragmentShader.replace(
    'gl_FragColor = vec4( retColor, 1.0 );',
    `gl_FragColor = vec4( pow( retColor, vec3( ${SKY_GAMMA.toFixed(2)} ) ) * ${SKY_GAIN.toFixed(2)}, 1.0 );`);
  // Bản dùng cho IBL bỏ đĩa mặt trời: nó sáng gấp hàng nghìn lần trời, làm mờ ra sẽ thành ánh sáng đều mọi phía
  if (noSunDisc) fs = fs.replace('* Fex ) * sundisk;', '* Fex ) * 0.0;');
  skyMesh.material.fragmentShader = fs;
  return skyMesh;
}

function setupSky(sky) {
  sky.scale.setScalar(1500); // camera.far = 2000: hộp trời phải nằm trong tầm vẽ
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;     // không khí nhiệt đới hơi đục (hơi nước) -> trời bớt "trong veo"
  u.rayleigh.value = 2.0;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.84;
  sky.frustumCulled = false;
  return sky;
}

/** Đọc màu chân trời (tuyến tính, HDR) để sương mù hoà khớp vào trời. */
function horizonColor(renderer, skyScene, rt, cam, buf) {
  try {
    const sum = new THREE.Color(0, 0, 0);
    const N = 6;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      cam.lookAt(Math.sin(a), 0.035, Math.cos(a));
      renderer.setRenderTarget(rt);
      renderer.render(skyScene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, 16, 16, buf);
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < buf.length; k += 4) { r += buf[k]; g += buf[k + 1]; b += buf[k + 2]; }
      const n = buf.length / 4;
      sum.r += r / n / N; sum.g += g / n / N; sum.b += b / n / N;
    }
    renderer.setRenderTarget(null);
    if (![sum.r, sum.g, sum.b].every(Number.isFinite)) return null;
    return sum;
  } catch {
    renderer.setRenderTarget(null);
    return null;
  }
}

/** Bầu sao: chấm nhỏ trên mặt cầu, hiện dần khi trời tối. */
function createStars() {
  const n = 2200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const y = rnd() * 1.05 - 0.05, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 1300, y * 1300, Math.sin(a) * r * 1300], i * 3);
    const b = 0.35 + rnd() ** 3 * 1.6, warm = rnd();
    col.set([b * (0.85 + warm * 0.2), b * 0.92, b * (1.1 - warm * 0.25)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = -1;
  return p;
}

/**
 * Bầu trời vật lý + chu kỳ ngày đêm: mặt trời/trăng di chuyển, bóng đổ mềm đi theo người chơi,
 * ánh sáng môi trường (IBL) và sương mù lấy từ chính bầu trời và cập nhật theo giờ.
 * Trả về { sun, state, update(focus, cameraPos, dt) }. state: { tod, daylight (0 đêm..1 ngày), dusk (0..1) }.
 */
export function createSky(scene, renderer, { shadowRes: SHADOW_RES = SHADOW_RES_DEFAULT } = {}) {
  const sky = setupSky(deepen(new Sky()));
  scene.add(sky);
  const stars = createStars();
  scene.add(stars);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdfe6f2, fog: false, transparent: true }));
  moon.frustumCulled = false;
  scene.add(moon);

  // Bản sao bầu trời (không đĩa mặt trời) để dựng IBL và đọc màu chân trời
  const skyScene = new THREE.Scene();
  const skyCopy = setupSky(deepen(new Sky(), true));
  skyScene.add(skyCopy);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.FloatType });
  const rtCam = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  const buf = new Float32Array(16 * 16 * 4);
  scene.fog = new THREE.Fog(DAY_FALLBACK_FOG.clone(), 70, 455); // gần đã hơi mờ (hơi nước), kín trước CULL_DIST = 460
  const fogTarget = DAY_FALLBACK_FOG.clone();
  let envRT = null;

  // Ánh nắng / ánh trăng: một DirectionalLight có bóng, đổi hướng/màu theo giờ
  const sun = new THREE.DirectionalLight(0xffeed6, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
  sc.near = 1; sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4430, 0.35);
  scene.add(hemi);

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
  const state = { tod: 0, daylight: 1, dusk: 0, elev: 0 };
  const C_NOON = new THREE.Color(0xfff1de), C_LOW = new THREE.Color(0xff9a52), C_MOON = new THREE.Color(0x9fb4e0);
  const HEMI_DAY = new THREE.Color(0xbfd6ff), HEMI_NIGHT = new THREE.Color(0x3a4c80);
  const GROUND_DAY = new THREE.Color(0x4a4430), GROUND_NIGHT = new THREE.Color(0x0e0f14);
  let lastEnvElev = 99, lastEnvT = -1e9;

  /** Dựng lại IBL + màu sương khi mặt trời đã đổi đáng kể (tốn vài ms, không làm mỗi khung). */
  function refreshEnv(force) {
    const now = performance.now();
    if (!force && Math.abs(state.elev - lastEnvElev) < 0.012 && now - lastEnvT < 20000) return;
    lastEnvElev = state.elev; lastEnvT = now;
    skyCopy.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(1000);
    const next = pmrem.fromScene(skyScene, 0, 1, 3000);
    scene.environment = next.texture;
    if (envRT) envRT.dispose();
    envRT = next;
    const h = horizonColor(renderer, skyScene, rt, rtCam, buf) || DAY_FALLBACK_FOG;
    // đêm: sương xanh đen thay vì đen kịt
    fogTarget.copy(h).lerp(NIGHT_FOG, 1 - ss(0, 0.6, state.daylight));
    if (force) scene.fog.color.copy(fogTarget);
  }

  function computeState() {
    state.tod = timeOfDay();
    state.elev = sunState(state.tod, sunDir);
    const deg = THREE.MathUtils.radToDeg(state.elev);
    state.daylight = ss(-7, 10, deg);
    state.dusk = ss(-8, 2, deg) * (1 - ss(4, 22, deg)); // bình minh / hoàng hôn
    // Trăng: phía đối diện, luôn khá cao trên trời đêm
    moonDir.copy(sunDir).negate();
    moonDir.y = Math.max(moonDir.y, 0.45); moonDir.normalize();
  }
  computeState();
  sky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  refreshEnv(true);

  const texel = (SHADOW_HALF * 2) / SHADOW_RES;
  const tmp = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  return {
    sun, state,
    /** Gọi mỗi khung: giờ, ánh sáng, vùng bóng đổ và hộp trời đi theo điểm nhìn. */
    update(focus, cameraPos, dt = 1 / 60) {
      computeState();
      const { daylight, elev } = state;
      sky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(1000);
      refreshEnv(false);
      scene.fog.color.lerp(fogTarget, 1 - Math.exp(-dt * 0.8));

      // Nguồn sáng chính: mặt trời khi trời sáng, trăng khi tối (đổi ở lúc cả hai gần như tắt)
      const deg = THREE.MathUtils.radToDeg(elev);
      const useSun = daylight > 0.1;
      lightDir.copy(useSun ? sunDir : moonDir);
      if (useSun) {
        sun.intensity = 2.9 * ss(-2.5, 14, deg) * (1 - 0.28 * ss(30, 65, deg)); // trưa: nắng gắt chiếu thẳng xuống, giảm để không cháy sáng
        sun.color.copy(C_LOW).lerp(C_NOON, ss(2, 30, deg));
      } else {
        sun.intensity = 0.75 * (1 - ss(0, 0.1, daylight));
        sun.color.copy(C_MOON);
      }
      hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, daylight);
      hemi.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, daylight);
      hemi.intensity = THREE.MathUtils.lerp(0.55, 0.35, daylight);
      scene.environmentIntensity = THREE.MathUtils.lerp(0.9, 0.45, daylight);
      stars.material.opacity = 1 - ss(0, 0.35, daylight);
      moon.material.opacity = 1 - ss(0.05, 0.5, daylight);

      if (cameraPos) {
        sky.position.copy(cameraPos);
        stars.position.copy(cameraPos);
        moon.position.copy(cameraPos).addScaledVector(moonDir, 1300);
      }
      if (!focus) return;
      // Bám lưới texel của shadow map (theo trục ánh sáng) để bóng không rung khi di chuyển
      tmp.copy(focus);
      right.set(-lightDir.z, 0, lightDir.x);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(lightDir, right).normalize();
      const fr = Math.round(tmp.dot(right) / texel) * texel - tmp.dot(right);
      const fu = Math.round(tmp.dot(up) / texel) * texel - tmp.dot(up);
      tmp.addScaledVector(right, fr).addScaledVector(up, fu);
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(lightDir, 300);
    },
  };
}
