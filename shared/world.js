import { WORLD_SEED, WORLD_HALF } from './constants.js';
import { heightAt, noise2 } from './terrain.js';

// PRNG xác định (mulberry32): cùng seed -> cùng dãy số ở client và server.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * HỢP ĐỒNG DỮ LIỆU THẾ GIỚI (client vẽ, server va chạm — cùng một nguồn).
 *
 * plants[i] = { kind, x, y, z, rot, scale, r, h }
 *   kind: 'pine' (thông) | 'broadleaf' (cây lá rộng) | 'palm' (cọ) | 'dead' (cây chết) | 'fern' (dương xỉ/ cycad) | 'bush' (bụi)
 *   rot: góc xoay quanh trục Y (rad); scale: hệ số kích thước (đã nằm trong khoảng riêng của từng loại)
 *   r: bán kính va chạm (m) của THÂN; 0 nghĩa là không chắn đường (bụi, dương xỉ)
 *   h: chiều cao thực (m) sau khi nhân scale, dùng cho camera/che khuất
 *
 * rocks[i] = { kind, x, y, z, w, hgt, rotX, rotY, seed, r }
 *   kind: 'boulder' (tảng tròn lớn) | 'rock' (đá vừa) | 'slab' (phiến dẹt) | 'spire' (mũi nhọn cao) | 'pebbles' (cụm sỏi nhỏ)
 *   w: bán kính ngang (m); hgt: chiều cao (m); rotX/rotY: nghiêng và xoay (rad)
 *   seed: số nguyên 0..3 chọn biến thể hình dạng; r: bán kính va chạm (0 = không chắn)
 */
export const PLANT_KINDS = ['pine', 'broadleaf', 'palm', 'dead', 'fern', 'bush'];
export const ROCK_KINDS = ['boulder', 'rock', 'slab', 'spire', 'pebbles'];

const MIN_LAND = 1.5; // chỉ đặt cây/đá trên cạn
const MAX_OBSTACLE_R = 5; // bán kính va chạm lớn nhất (cho tìm kiếm không gian)

function slopeAt(x, z) {
  const y = heightAt(x, z);
  return Math.hypot(heightAt(x + 1, z) - y, heightAt(x, z + 1) - y);
}

function pick(rng, table) { // table: [[kind, weight], ...]
  let total = 0; for (const [, w] of table) total += w;
  let t = rng() * total;
  for (const [k, w] of table) { if ((t -= w) <= 0) return k; }
  return table[table.length - 1][0];
}

// ---------------- Cầu nối hai đảo lớn nhất ----------------
export const BRIDGE_HALF_WIDTH = 25.0; // nửa bề rộng mặt cầu (m) — đại lộ cầu thép rộng 50 m
const BRIDGE_ARCH = 5.0;               // độ vồng mặt cầu ở giữa (m)
// Cột chắn lan can đặt dày (0.7 m, r = 0.28) để thành một hàng rào liền: con nhỏ nhất cũng không lách qua được.
// Phần hình ảnh chỉ vẽ cột thưa hơn (cứ 3 vật cản vẽ 1 cột) cùng thanh ngang liên tục.
export const POST_SPACING = 0.7;

/**
 * Tìm hai đảo lớn nhất và nối chỗ gần nhau nhất bằng một cây cầu vòm.
 * bridge = { ax, az, bx, bz, len, dx, dz, hA, hB, halfW, deckY(t), posts[] }
 *   (ax,az) và (bx,bz) là hai đầu cầu nằm trên đất liền; t = 0..1 dọc cầu; posts là cột lan can (vật cản r>0).
 */
// Lưới nhãn đảo (ô 5 m) tạo trong computeBridge, dùng cho islandAt()
let islandGrid = null;

function computeBridge() {
  const STEP = 5, N = 180, OFF = -450, LAND = 1.0;
  const land = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) land[i * N + j] = heightAt(OFF + i * STEP, OFF + j * STEP) > LAND ? 1 : 0;
  const comp = new Int32Array(N * N).fill(-1);
  const sizes = [];
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let s = 0; s < N * N; s++) {
    if (!land[s] || comp[s] >= 0) continue;
    const id = sizes.length; let n = 0; const stack = [s]; comp[s] = id;
    while (stack.length) {
      const c = stack.pop(); n++;
      const i = (c / N) | 0, j = c % N;
      for (const [di, dj] of NB) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const k = a * N + b;
        if (land[k] && comp[k] < 0) { comp[k] = id; stack.push(k); }
      }
    }
    sizes.push(n);
  }
  islandGrid = { comp, N, OFF, STEP };
  const top = sizes.map((n, id) => ({ n, id })).sort((p, q) => q.n - p.n).slice(0, 2);
  if (top.length < 2) return null;

  const boundary = (id) => {
    const out = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (comp[i * N + j] !== id) continue;
      let edge = false;
      for (const [di, dj] of NB) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N || comp[a * N + b] !== id) edge = true;
      }
      if (edge) out.push({ x: OFF + i * STEP, z: OFF + j * STEP });
    }
    return out;
  };
  const b1 = boundary(top[0].id), b2 = boundary(top[1].id);
  let best = Infinity, A = null, B = null;
  for (const p of b1) for (const q of b2) {
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best) { best = d; A = p; B = q; }
  }
  const ux = (B.x - A.x) / best, uz = (B.z - A.z) / best;

  // Kéo hai đầu vào sâu trong đất liền thêm vài mét để cầu gắn chắc vào bờ
  const inland = (p, dx, dz) => {
    let t = 0;
    for (let s = 2; s <= 10; s += 2) { if (heightAt(p.x + dx * s, p.z + dz * s) > 1.2) t = s; else break; }
    return { x: p.x + dx * t, z: p.z + dz * t };
  };
  const a = inland(A, -ux, -uz), b = inland(B, ux, uz);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  const hA = heightAt(a.x, a.z), hB = heightAt(b.x, b.z);
  const deckY = (t) => hA + (hB - hA) * t + BRIDGE_ARCH * Math.sin(Math.PI * t);

  const posts = [];
  const nPosts = Math.floor(len / POST_SPACING);
  const nx = -dz, nz = dx; // pháp tuyến ngang của cầu
  for (let i = 0; i <= nPosts; i++) {
    const t = Math.min(1, (i * POST_SPACING) / len);
    for (const side of [-1, 1]) {
      const off = side * (BRIDGE_HALF_WIDTH - 0.25);
      posts.push({
        kind: 'post', x: a.x + dx * t * len + nx * off, z: a.z + dz * t * len + nz * off,
        y: deckY(t), r: 0.28, h: 1.15,
      });
    }
  }
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, len, dx, dz, nx, nz, hA, hB, halfW: BRIDGE_HALF_WIDTH, deckY, posts, islandA: top[0].id, islandB: top[1].id };
}

/** (x, z) nằm trong hành lang cầu (cộng lề margin)? Dùng để dọn cây/đá khỏi lối cầu. */
function inBridgeCorridor(br, x, z, margin) {
  if (!br) return false;
  const s = (x - br.ax) * br.dx + (z - br.az) * br.dz;
  const lat = (x - br.ax) * br.nx + (z - br.az) * br.nz;
  return s >= -margin && s <= br.len + margin && Math.abs(lat) <= br.halfW + margin;
}

const PLANT_DEF = {
  //            thân chắn (r/scale), cao (h/scale), khoảng scale
  pine:      { r: 0.55, h: 10, min: 0.7, max: 1.9 },
  broadleaf: { r: 0.8,  h: 8,  min: 0.8, max: 1.7 },
  palm:      { r: 0.35, h: 7,  min: 0.8, max: 1.5 },
  dead:      { r: 0.45, h: 5.5, min: 0.7, max: 1.4 },
  fern:      { r: 0,    h: 1.6, min: 0.6, max: 1.6 },
  bush:      { r: 0,    h: 1.2, min: 0.6, max: 1.5 },
};

function genPlants(seed, bridge) {
  const rng = mulberry32(seed);
  const out = [];
  const lim = WORLD_HALF * 0.92;
  const TARGET = 4200; // tổng số cây + bụi
  for (let tries = 0; out.length < TARGET && tries < TARGET * 40; tries++) {
    const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
    const y = heightAt(x, z);
    if (y <= MIN_LAND) continue;
    if (slopeAt(x, z) > 0.62) continue;
    if (inBridgeCorridor(bridge, x, z, 6)) continue; // chừa lối vào cầu
    // Vùng rừng (cụm lớn) và độ ẩm: tạo mảng rừng dày xen đồng trống
    const forest = noise2(x * 0.018, z * 0.018, seed + 13);
    const moist = noise2(x * 0.012, z * 0.012, seed + 29);
    if (rng() > 0.12 + 0.88 * forest * forest * 1.6) continue;
    let kind;
    if (y < 4) kind = pick(rng, [['palm', 4], ['fern', 3], ['bush', 3], ['broadleaf', 1]]);
    else if (y < 14) {
      kind = moist > 0.5
        ? pick(rng, [['broadleaf', 5], ['fern', 3], ['bush', 2], ['pine', 1], ['palm', 0.4]])
        : pick(rng, [['pine', 4], ['broadleaf', 3], ['bush', 2], ['dead', 1], ['fern', 1]]);
    } else kind = pick(rng, [['pine', 6], ['dead', 2.5], ['bush', 1.5]]);
    const def = PLANT_DEF[kind];
    const scale = def.min + rng() * rng() * (def.max - def.min) * 1.0 + rng() * (def.max - def.min) * 0.4;
    const s = Math.min(def.max, scale);
    out.push({ kind, x, y, z, rot: rng() * Math.PI * 2, scale: s, r: def.r * s, h: def.h * s });
  }
  return out;
}

function genRocks(seed, bridge) {
  const rng = mulberry32(seed + 1);
  const out = [];
  const lim = WORLD_HALF * 0.92;
  const TARGET = 900;
  for (let tries = 0; out.length < TARGET && tries < TARGET * 60; tries++) {
    const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
    const y = heightAt(x, z);
    if (y <= MIN_LAND - 0.5) continue;
    const slope = slopeAt(x, z);
    if (slope > 1.1) continue;
    if (inBridgeCorridor(bridge, x, z, 8)) continue; // chừa lối vào cầu
    const high = y > 14, steep = slope > 0.4;
    const kind = pick(rng, [
      ['boulder', high || steep ? 5 : 2], ['rock', 5], ['slab', 2.5],
      ['spire', high ? 3 : 0.3], ['pebbles', y < 4 ? 6 : 3],
    ]);
    let w, hgt;
    switch (kind) {
      case 'boulder': w = 1.6 + rng() * rng() * 3.4; hgt = w * (0.7 + rng() * 0.5); break;
      case 'rock':    w = 0.6 + rng() * 1.0;          hgt = w * (0.6 + rng() * 0.6); break;
      case 'slab':    w = 1.4 + rng() * 2.6;          hgt = 0.35 + rng() * 0.7;      break;
      case 'spire':   w = 0.8 + rng() * 1.2;          hgt = 3 + rng() * 5;           break;
      default:        w = 0.3 + rng() * 0.5;          hgt = w * 0.5;                 break; // pebbles
    }
    const r = kind === 'pebbles' ? 0 : Math.min(MAX_OBSTACLE_R, w * (kind === 'spire' ? 0.7 : 0.85));
    out.push({
      kind, x, y, z, w, hgt, rotX: (rng() - 0.5) * 0.35, rotY: rng() * Math.PI * 2,
      seed: Math.floor(rng() * 4), r,
    });
  }
  return out;
}

let cache = null;

/** Sinh thế giới một lần (xác định theo seed) kèm lưới băm để tra vật cản gần. */
export function getWorld(seed = WORLD_SEED) {
  if (cache && cache.seed === seed) return cache;

  const bridge = computeBridge();
  const plants = genPlants(seed, bridge);
  const rocks = genRocks(seed, bridge);

  // Lưới băm không gian: chỉ vật cản có r > 0 mới cần cho va chạm (cột lan can cầu cũng là vật cản)
  const CELL = 16;
  const grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (const o of [...plants, ...rocks, ...(bridge ? bridge.posts : [])]) {
    if (!(o.r > 0)) continue;
    const k = key(Math.floor(o.x / CELL), Math.floor(o.z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
  }

  /** Các vật cản CHẮN ĐƯỜNG (r > 0) có thể chạm vòng tròn (x, z, r). */
  function nearby(x, z, r) {
    const out = [];
    const reach = r + MAX_OBSTACLE_R;
    const c0x = Math.floor((x - reach) / CELL), c1x = Math.floor((x + reach) / CELL);
    const c0z = Math.floor((z - reach) / CELL), c1z = Math.floor((z + reach) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const cell = grid.get(key(cx, cz));
        if (cell) out.push(...cell);
      }
    }
    return out;
  }

  // Cây có thể gặm (dương xỉ, bụi) cho loài ăn cỏ
  const edGrid = new Map();
  for (const p of plants) {
    if (p.kind !== 'fern' && p.kind !== 'bush') continue;
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    if (!edGrid.has(k)) edGrid.set(k, []);
    edGrid.get(k).push(p);
  }
  /** Cây gặm được gần nhất trong bán kính range quanh (x, z), hoặc null. */
  function nearEdible(x, z, range) {
    let best = null, bd = range;
    for (let cx = Math.floor((x - range) / CELL); cx <= Math.floor((x + range) / CELL); cx++) {
      for (let cz = Math.floor((z - range) / CELL); cz <= Math.floor((z + range) / CELL); cz++) {
        const cell = edGrid.get(key(cx, cz));
        if (!cell) continue;
        for (const p of cell) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
      }
    }
    return best;
  }

  // `trees` giữ lại để tương thích mã cũ: chỉ các cây có thân chắn đường
  cache = { seed, plants, rocks, trees: plants.filter((p) => p.r > 0), bridge, nearby, nearEdible };
  return cache;
}

/** Mã đảo tại (x, z): số >= 0 nếu là đất liền (cùng số = cùng một đảo, đi bộ tới nhau được), -1 nếu là nước/ngoài bản đồ. */
export function islandAt(x, z) {
  getWorld();
  if (!islandGrid) return -1;
  const { comp, N, OFF, STEP } = islandGrid;
  const i = Math.round((x - OFF) / STEP), j = Math.round((z - OFF) / STEP);
  if (i < 0 || j < 0 || i >= N || j >= N) return -1;
  return comp[i * N + j];
}

/**
 * Độ cao mặt đứng tại (x, z): địa hình, hoặc mặt cầu nếu đang ở trên cầu (và cao hơn địa hình).
 * MỌI chỗ cần "y của chân" (vật lý, vị trí gửi client, camera) phải dùng hàm này thay cho heightAt.
 */
export function groundAt(x, z) {
  const h = heightAt(x, z);
  const br = getWorld().bridge;
  if (!br) return h;
  const s = (x - br.ax) * br.dx + (z - br.az) * br.dz;
  if (s < 0 || s > br.len) return h;
  const lat = (x - br.ax) * br.nx + (z - br.az) * br.nz;
  if (Math.abs(lat) > br.halfW) return h;
  return Math.max(h, br.deckY(s / br.len)); // hai đầu cầu hoà vào bờ nếu bờ cao hơn mặt cầu
}
