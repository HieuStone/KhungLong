// Chất liệu ảnh chụp thật (PBR, CC0 từ Poly Haven — xem client/public/textures/README.md) và ảnh "cành lá"
// ghép từ lá thật lúc chạy (tán cây dựng từ các tấm cành lá cắt viền theo alpha, như game thật).
import * as THREE from 'three';

const BASE = (import.meta.env?.BASE_URL || '/') + 'textures/';
const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = Math.max(1, Math.min(16, n || 8)); }

function tex(file, srgb) {
  const key = file + (srgb ? ':s' : '');
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(BASE + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  cache.set(key, t);
  return t;
}

/** Một ảnh đơn (vd ảnh nếp nhăn da). */
export function plainTex(file, srgb = false) { return tex(file, srgb); }

/** Bộ ảnh một chất liệu: { map (màu), normal (pháp tuyến OpenGL), rough (độ nhám) }. */
export function pbr(name) {
  return { map: tex(`${name}_diff.jpg`, true), normal: tex(`${name}_nor.jpg`, false), rough: tex(`${name}_rough.jpg`, false) };
}

function loadImage(file) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = BASE + file; });
}

// Khung từng chiếc lá trong ảnh island_tree_02_leaves (toạ độ trên ảnh 1024px): x, y, w, h (cuống lá ở dưới)
const LEAF_RECTS = [
  [15, 20, 140, 395], [168, 20, 180, 385], [368, 30, 130, 345], [528, 48, 140, 325], [708, 18, 130, 405],
  [14, 640, 175, 360], [218, 588, 148, 430], [428, 612, 150, 400],
];

let leafSheet = null; // canvas RGBA: ảnh màu lá + alpha cắt viền
async function leafSheetCanvas() {
  if (leafSheet) return leafSheet;
  const [diff, alpha] = await Promise.all([loadImage('leaves_diff.jpg'), loadImage('leaves_alpha.jpg')]);
  const W = diff.width, H = diff.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(diff, 0, 0);
  const a = document.createElement('canvas'); a.width = W; a.height = H;
  const ax = a.getContext('2d'); ax.drawImage(alpha, 0, 0, W, H);
  const img = x.getImageData(0, 0, W, H), am = ax.getImageData(0, 0, W, H).data;
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = am[i];
  x.putImageData(img, 0, 0);
  leafSheet = c;
  return c;
}

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvasTexture(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, ctx: c.getContext('2d'), t };
}

/**
 * Ảnh cành lá rộng (cây gỗ, bụi): một nhánh nhỏ với ~24 lá thật xoè ra hai bên.
 * Trục cành chạy dọc ảnh từ dưới (v=0, gốc) lên trên (ngọn). Nạp bất đồng bộ: trả texture ngay, vẽ khi ảnh lá về.
 */
export function broadLeafCluster() {
  if (cache.has('cluster:broad')) return cache.get('cluster:broad');
  const S = 512, { c, ctx, t } = canvasTexture(S);
  cache.set('cluster:broad', t);
  leafSheetCanvas().then((sheet) => {
    const r = rng(17);
    ctx.clearRect(0, 0, S, S);
    // cành
    ctx.strokeStyle = '#4a3a24'; ctx.lineCap = 'round';
    ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(S * 0.5, S); ctx.quadraticCurveTo(S * 0.47, S * 0.5, S * 0.52, S * 0.08); ctx.stroke();
    const N = 26;
    for (let i = 0; i < N; i++) {
      const t01 = 0.12 + (i / N) * 0.85;
      const bx = S * (0.5 - 0.03 * Math.sin(t01 * 3)), by = S * (1 - t01 * 0.92);
      const side = i % 2 ? 1 : -1;
      const ang = side * (0.55 + r() * 0.75) - (t01 > 0.9 ? side * 0.4 : 0); // xoè ra hai bên, ngọn chụm lại
      const [lx, ly, lw, lh] = LEAF_RECTS[Math.floor(r() * LEAF_RECTS.length)];
      const scale = (S * (0.26 + r() * 0.12)) / lh;
      ctx.save();
      ctx.translate(bx, by); ctx.rotate(ang);
      // cuống lá ở đáy khung => vẽ lá từ gốc đi lên
      const shade = 0.78 + r() * 0.3;
      ctx.filter = `brightness(${shade.toFixed(2)})`;
      ctx.drawImage(sheet, lx, ly, lw, lh, -lw * scale / 2, -lh * scale, lw * scale, lh * scale);
      ctx.restore();
    }
    ctx.filter = 'none';
    t.needsUpdate = true;
  }).catch(() => {});
  return t;
}

/** Ảnh cành lá kim (cây thông), vẽ hoàn toàn bằng code: cành chính + cành con + hàng nghìn lá kim. */
export function needleCluster() {
  if (cache.has('cluster:needle')) return cache.get('cluster:needle');
  const S = 512, { ctx, t } = canvasTexture(S);
  const r = rng(29);
  ctx.lineCap = 'round';
  const twig = (x0, y0, x1, y1, w) => { ctx.strokeStyle = '#3d2c1c'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  const needles = (x0, y0, x1, y1, len, n) => {
    for (let i = 0; i < n; i++) {
      const k = i / n, x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
      const dir = Math.atan2(y1 - y0, x1 - x0);
      for (const sd of [-1, 1]) {
        const a = dir + sd * (0.55 + r() * 0.5), l = len * (0.7 + r() * 0.5) * (1 - k * 0.35);
        const g = 70 + r() * 50, gr = 30 + r() * 25;
        ctx.strokeStyle = `rgb(${gr | 0},${g | 0},${(gr * 0.7) | 0})`;
        ctx.lineWidth = 1.6 + r() * 0.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    }
  };
  // cành chính dọc ảnh (gốc ở dưới), các cành con xoè hai bên
  twig(S * 0.5, S, S * 0.5, S * 0.04, 6);
  needles(S * 0.5, S * 0.95, S * 0.5, S * 0.04, S * 0.075, 90);
  for (let i = 0; i < 9; i++) {
    const y = S * (0.88 - i * 0.09), side = i % 2 ? 1 : -1, len = S * (0.34 - i * 0.025);
    const x1 = S * 0.5 + side * len * 0.85, y1 = y - len * 0.45;
    twig(S * 0.5, y, x1, y1, 3);
    needles(S * 0.5, y, x1, y1, S * 0.05, 45);
  }
  t.needsUpdate = true;
  cache.set('cluster:needle', t);
  return t;
}

/**
 * Ảnh lá kép dài (lá cọ / dương xỉ): gân giữa chạy dọc ảnh (v), lá chét mảnh xoè hai bên theo u.
 * fern=true: lá chét ngắn, dày, có răng (dương xỉ).
 */
export function frondTexture(fern = false) {
  const key = fern ? 'frond:fern' : 'frond:palm';
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const r = rng(fern ? 41 : 37);
  ctx.lineCap = 'round';
  const N = fern ? 46 : 64;
  for (let i = 0; i < N; i++) {
    const k = i / N, y = H * (1 - 0.04 - k * 0.94);
    const len = (W * 0.48) * Math.sin(Math.PI * Math.min(1, k * 1.05 + 0.05)) * (fern ? 0.9 : 1) * (0.85 + r() * 0.2);
    for (const sd of [-1, 1]) {
      const a = sd * (fern ? 1.25 : 1.05) + (r() - 0.5) * 0.12, droop = fern ? 0.1 : 0.35;
      // xanh trầm tự nhiên (lá thật ít bão hoà), lá chét già ngả vàng nâu
      const g = (fern ? 72 : 82) + r() * 34, rr = 44 + r() * 26 + (r() < 0.15 ? 30 : 0);
      ctx.strokeStyle = `rgb(${rr | 0},${g | 0},${(rr * 0.6) | 0})`;
      ctx.lineWidth = fern ? 9 : 6 + r() * 2;
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      const ex = W / 2 + Math.sin(a) * len, ey = y - Math.cos(a) * len * 0.35 + len * droop;
      ctx.quadraticCurveTo(W / 2 + Math.sin(a) * len * 0.5, y - len * 0.15, ex, ey);
      ctx.stroke();
      if (fern) { // răng cưa
        ctx.lineWidth = 4;
        for (let j = 1; j < 4; j++) { const q = j / 4; const px = W / 2 + Math.sin(a) * len * q, py = y - len * 0.1 * q + len * droop * q * q; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + sd * 6, py + 7); ctx.stroke(); }
      }
    }
  }
  // gân giữa
  ctx.strokeStyle = fern ? '#3f5a24' : '#6b6a3a'; ctx.lineWidth = fern ? 6 : 9;
  ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.lineTo(W / 2, H * 0.02); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
