// Texture procedural (vẽ bằng canvas lúc chạy, không cần file ảnh): da vảy cho sinh vật, sóng cho mặt nước.
import * as THREE from 'three';

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(size, draw, colorSpace = THREE.NoColorSpace) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  draw(img.data, size);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = colorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Vảy da (Voronoi lặp liền mạch): mỗi vảy gồ lên ở giữa, rãnh tối giữa các vảy, vảy to nhỏ không đều.
 * Trả về { bump, rough }: bản đồ độ gồ và bản đồ độ nhám (rãnh nhám hơn, mặt vảy hơi bóng).
 */
let skinCache = null;
export function skinTextures() {
  if (skinCache) return skinCache;
  const S = 256, G = 14; // 14x14 vảy trên một ô lặp
  const r = rng(7);
  const pts = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    pts.push([(i + 0.15 + r() * 0.7) / G, (j + 0.15 + r() * 0.7) / G, 0.75 + r() * 0.5]);
  }
  const field = new Float32Array(S * S * 2); // [độ cao, độ nhám]
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const ci = Math.floor(u * G), cj = Math.floor(v * G);
    let d1 = 9, d2 = 9, w = 1;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = (ci + di + G) % G, jj = (cj + dj + G) % G;
      const p = pts[jj * G + ii];
      // dịch điểm sang ô lân cận ngoài biên để vảy nối liền khi lặp
      const ox = (ci + di) - ii, oy = (cj + dj) - jj;
      const dx = (p[0] + ox / G) - u, dy = (p[1] + oy / G) - v;
      const d = Math.hypot(dx, dy) * G;
      if (d < d1) { d2 = d1; d1 = d; w = p[2]; } else if (d < d2) d2 = d;
    }
    const edge = Math.min(1, (d2 - d1) * 2.2);            // 0 ở rãnh, 1 ở trong vảy
    const dome = Math.max(0, 1 - d1 * 0.9) * w;            // gồ ở tâm vảy
    field[(y * S + x) * 2] = Math.pow(edge, 0.6) * (0.55 + 0.45 * dome);
    field[(y * S + x) * 2 + 1] = 1 - edge;
  }
  const bump = canvasTex(S, (d) => {
    for (let k = 0; k < S * S; k++) { const h = field[k * 2] * 255; d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = h; d[k * 4 + 3] = 255; }
  });
  // Ba kênh G = độ nhám (Three.js đọc roughness từ kênh G)
  const rough = canvasTex(S, (d) => {
    for (let k = 0; k < S * S; k++) { const g = (0.72 + field[k * 2 + 1] * 0.28) * 255; d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = g; d[k * 4 + 3] = 255; }
  });
  // Lặp vảy dày hơn trên các khối (UV của khối cầu chạy 0..1 quanh thân, nên chiều ngang dài gấp đôi)
  for (const t of [bump, rough]) t.repeat.set(6, 3);
  skinCache = { bump, rough };
  return skinCache;
}

/** Bản đồ pháp tuyến sóng nước lặp liền mạch: fbm value-noise trên lưới tuần hoàn (gợn ngẫu nhiên, không thành sọc). */
let waterCache = null;
export function waterNormalTexture() {
  if (waterCache) return waterCache;
  const S = 256;
  const r = rng(21);
  // lưới giá trị ngẫu nhiên tuần hoàn cho từng tần số
  const octave = (P) => {
    const g = new Float32Array(P * P).map(() => r());
    return (x, y) => {
      const fx = (x / S) * P, fy = (y / S) * P;
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % P + P) % P) * P + ((i % P + P) % P)];
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };
  const octs = [[octave(6), 1], [octave(12), 0.55], [octave(24), 0.3], [octave(48), 0.16]];
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const [f, a] of octs) v += f(x, y) * a;
    h[y * S + x] = v;
  }
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  waterCache = canvasTex(S, (d) => {
    const k = 4;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * k, ny = -(at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * S + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  });
  return waterCache;
}

/** Áp vảy da lên vật liệu sinh vật: bỏ flat shading (bề mặt mượt), thêm vảy và độ nhám không đều. */
export function skinify(mat, strength = 1) {
  const { bump, rough } = skinTextures();
  mat.flatShading = false;
  mat.bumpMap = bump;
  mat.bumpScale = 1.2 * strength;
  mat.roughnessMap = rough;
  return mat;
}
