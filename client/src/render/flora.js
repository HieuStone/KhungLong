import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getWorld } from '@isle/shared';

// ============================================================
// Tiện ích: noise xác định (KHÔNG Math.random) và dựng hình
// ============================================================
const fract = (x) => x - Math.floor(x);
const hash3 = (x, y, z, s = 0) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// value noise 3D trong [0,1]
function vnoise(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c, s);
  const l = (p, q, t) => p + (q - p) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
const fbm = (x, y, z, s) => vnoise(x, y, z, s) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3, s + 3) * 0.1;

// PRNG nhỏ có seed (dựng hình ổn định giữa các lần chạy)
function rngOf(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const col = (hex) => new THREE.Color(hex);
const _c = new THREE.Color();
const mix = (a, b, t) => _c.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

/** Bộ gom các phần hình học: mỗi phần được tô vertex color rồi gộp thành 1 geometry. */
class Builder {
  constructor() { this.parts = []; }
  // geo đã đặt đúng vị trí; fn(x,y,z,nx,ny,nz) -> Color
  add(geo, fn) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.computeVertexNormals(); // pháp tuyến phẳng theo mặt (low-poly)
    const p = g.attributes.position, n = g.attributes.normal;
    const cs = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const c = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
      cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cs, 3));
    this.parts.push(g);
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    return g;
  }
}

/** Ống thon dọc theo đường gấp khúc pts với bán kính radii; có nắp ở ngọn. */
function tube(pts, radii, radial = 6) {
  const pos = [], idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const ref = Math.abs(t.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(ref, t).normalize();
    const v = new THREE.Vector3().crossVectors(t, u);
    for (let k = 0; k < radial; k++) {
      const an = (k / radial) * Math.PI * 2;
      pos.push(
        pts[i].x + (u.x * Math.cos(an) + v.x * Math.sin(an)) * radii[i],
        pts[i].y + (u.y * Math.cos(an) + v.y * Math.sin(an)) * radii[i],
        pts[i].z + (u.z * Math.cos(an) + v.z * Math.sin(an)) * radii[i]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b = i * radial + (k + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  // nắp ngọn
  const top = pts[n - 1];
  const ci = pos.length / 3; pos.push(top.x, top.y, top.z);
  for (let k = 0; k < radial; k++) idx.push((n - 1) * radial + k, ci, (n - 1) * radial + (k + 1) % radial);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Lá dài uốn cong (dải dẹt có gờ giữa). Xuất phát tại origin, hướng phương vị az, góc ngẩng elev (rad),
 * rủ xuống thêm `droop` rad dọc theo chiều dài. widthFn(t) -> nửa bề rộng.
 */
function leaf(origin, len, az, elev, droop, widthFn, segs = 6) {
  const pos = [], idx = [];
  const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
  const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
  const p = origin.clone();
  const step = len / segs;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = widthFn(t);
    const mid = p.clone().add(new THREE.Vector3(0, w * 0.35, 0)); // gờ giữa nhô lên
    const l = p.clone().addScaledVector(side, w), r = p.clone().addScaledVector(side, -w);
    pos.push(l.x, l.y, l.z, mid.x, mid.y, mid.z, r.x, r.y, r.z);
    const pitch = elev - droop * t * t; // càng về ngọn càng rủ
    p.addScaledVector(dir, Math.cos(pitch) * step);
    p.y += Math.sin(pitch) * step;
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3, b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Khối cầu low-poly xô lệch bằng noise xác định. */
function blob(cx, cy, cz, rx, ry, rz, seed, detail = 1, jitter = 0.28) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (vnoise(x * 1.7 + seed, y * 1.7, z * 1.7, seed) - 0.5) * 2 * jitter;
    p.setXYZ(i, cx + x * rx * k, cy + y * ry * k, cz + z * rz * k);
  }
  return g;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ============================================================
// CÂY: mỗi loại dựng sẵn theo mét ở scale = 1 (chiều cao khớp PLANT_DEF.h trong shared/world.js)
// ============================================================
const BARK = col(0x6b4a2f), BARK_D = col(0x4a3220), GREY = col(0x8a8074), GREY_D = col(0x5d554b);

function buildPine() {
  const b = new Builder();
  // Thân thon, hơi cong
  const pts = [], rad = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(V(Math.sin(t * 2.2) * 0.12, t * 9.8, Math.sin(t * 1.7) * 0.1)); rad.push(0.5 * (1 - t) + 0.05); }
  b.add(tube(pts, rad, 6), (x, y) => mix(BARK_D, BARK, y / 6));
  // 7 tầng nón nhỏ dần, lệch/ xô nhẹ để không đối xứng hoàn hảo
  const r = rngOf(11);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const y0 = 1.7 + t * 6.7, rr = 2.35 * (1 - t * 0.82) + 0.12, hh = 2.5 - t * 0.9;
    const ox = (r() - 0.5) * 0.35, oz = (r() - 0.5) * 0.35;
    const g = new THREE.ConeGeometry(rr, hh, 9, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const f = 1 + (vnoise(x * 1.3 + i * 5, y * 1.3, z * 1.3, 4) - 0.5) * 0.45;
      const edge = Math.hypot(x, z) > 0.01 ? 1 : 0;
      p.setXYZ(k, ox + x * f, y0 + hh / 2 + y - (edge && y < -hh * 0.4 ? 0.25 * rr * 0.3 : 0), oz + z * f);
    }
    const tone = 0.85 + r() * 0.3;
    b.add(g, (x, y) => {
      const ty = (y - y0) / hh;
      mix(col(0x0d3a1b), col(0x2c7a3a), ty * 0.9).multiplyScalar(tone);
      return _c;
    });
  }
  return b.build();
}

function buildBroadleaf() {
  const b = new Builder();
  // Thân chính + 3 nhánh lớn toả lên tán
  const trunk = [V(0, 0, 0), V(0.1, 1.5, 0.05), V(0, 3.0, -0.05), V(-0.05, 3.9, 0)];
  b.add(tube(trunk, [0.78, 0.55, 0.42, 0.34], 7), (x, y) => mix(BARK_D, BARK, y / 4));
  const br = [[1.6, 5.2, 0.4], [-1.3, 5.0, 0.9], [0.2, 5.6, -1.5]];
  for (const [bx, by, bz] of br) {
    b.add(tube([V(0, 3.4, 0), V(bx * 0.45, 4.3, bz * 0.45), V(bx, by, bz)], [0.3, 0.22, 0.12], 5), () => BARK);
  }
  // Tán: 7 khối cầu chồng, hai tông xanh
  const r = rngOf(23);
  const centers = [[0, 6.0, 0, 2.1], [1.7, 5.3, 0.5, 1.6], [-1.5, 5.2, 0.9, 1.55], [0.3, 5.5, -1.6, 1.6], [0.9, 7.0, 0.7, 1.3], [-0.9, 6.9, -0.4, 1.35], [0.2, 4.6, 1.5, 1.2]];
  centers.forEach(([cx, cy, cz, s], i) => {
    const light = i % 2 === 0;
    const A = light ? col(0x3f9a3a) : col(0x2b7a35), B = light ? col(0x7ac14a) : col(0x4fa143);
    const bg = blob(cx, cy, cz, s * (1 + r() * 0.15), s * 0.82, s * (1 + r() * 0.15), i * 3 + 1, 1, 0.22);
    b.add(bg, (x, y, z, nx, ny) => mix(A, B, ny * 0.5 + 0.35 + (y - cy) * 0.12));
  });
  return b.build();
}

function buildPalm() {
  const b = new Builder();
  // Thân cong nhẹ, vằn đốt (xen kẽ sáng tối theo từng đoạn)
  const pts = [], rad = [];
  const N = 14;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(V(Math.pow(t, 1.8) * 1.1, t * 6.2, Math.sin(t * 2) * 0.12)); rad.push(0.34 - t * 0.15); }
  b.add(tube(pts, rad, 6), (x, y) => (Math.floor(y * 3.2) % 2 === 0 ? _c.copy(col(0x8c6a45)) : _c.copy(col(0x6c4f32))));
  const top = pts[N];
  // 11 lá dài rủ cong xuống
  const r = rngOf(31);
  for (let i = 0; i < 12; i++) {
    const az = (i / 12) * Math.PI * 2 + (r() - 0.5) * 0.3;
    const len = 3.0 + r() * 0.7, elev = 0.5 + r() * 0.35, droop = 1.7 + r() * 0.6;
    const g = leaf(top, len, az, elev, droop, (t) => 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.06)) + 0.04, 7);
    const tone = 0.85 + r() * 0.3;
    b.add(g, (x, y, z) => {
      const d = Math.hypot(x - top.x, z - top.z) / 3.4;
      mix(col(0x2f7a2a), col(0x7ec44a), d * 0.9).multiplyScalar(tone);
      return _c;
    });
  }
  // chùm quả
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    b.add(blob(top.x + Math.cos(a) * 0.28, top.y - 0.35, top.z + Math.sin(a) * 0.28, 0.22, 0.24, 0.22, i + 40, 1, 0.1), () => col(0x5a3a1c));
  }
  return b.build();
}

function buildDead() {
  const b = new Builder();
  const r = rngOf(47);
  // Thân xám nâu, vặn nhẹ
  const pts = [], rad = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(V(Math.sin(t * 3) * 0.2, t * 4.4, Math.cos(t * 2.4) * 0.15)); rad.push(0.45 * (1 - t) + 0.07); }
  const bark = (x, y) => mix(GREY_D, GREY, 0.3 + vnoise(x * 3, y * 2, 0, 3) * 0.7);
  b.add(tube(pts, rad, 6), bark);
  // Cành chia nhánh đệ quy (độ sâu 3)
  const branch = (start, dir, len, radius, depth) => {
    const end = start.clone().addScaledVector(dir, len);
    end.y += len * 0.15;
    const mid = start.clone().lerp(end, 0.5).add(V((r() - 0.5) * 0.2, 0, (r() - 0.5) * 0.2));
    b.add(tube([start, mid, end], [radius, radius * 0.7, Math.max(0.015, radius * 0.35)], 5), bark);
    if (depth <= 0) return;
    const n = depth === 3 ? 2 : 2 + (r() < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, up = 0.35 + r() * 0.5;
      const d = V(Math.cos(a) * (1 - up * 0.6) + dir.x * 0.6, up, Math.sin(a) * (1 - up * 0.6) + dir.z * 0.6).normalize();
      branch(end, d, len * (0.6 + r() * 0.2), radius * 0.55, depth - 1);
    }
  };
  const starts = [[1.9, 0.3], [2.6, 2.2], [3.2, 4.0], [3.7, 5.2], [4.1, 1.0]];
  for (const [y, a] of starts) {
    const t = y / 4.4;
    const o = V(Math.sin(t * 3) * 0.2, y, Math.cos(t * 2.4) * 0.15);
    const d = V(Math.cos(a), 0.55, Math.sin(a)).normalize();
    branch(o, d, 1.5 - t * 0.4, 0.17 - t * 0.05, 2);
  }
  // Ngọn trơ trụi
  branch(pts[6], V(0.1, 1, 0.05).normalize(), 1.1, 0.07, 1);
  return b.build();
}

function buildFern() {
  const b = new Builder();
  // Thân củ thấp (kiểu tuế)
  b.add(tube([V(0, 0, 0), V(0.02, 0.18, 0), V(0, 0.4, 0.02)], [0.26, 0.24, 0.17], 7), (x, y) => mix(col(0x4a3822), col(0x7a6040), y / 0.4));
  const r = rngOf(59);
  const mk = (n, len, elev, droop, w, y0) => {
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + r() * 0.4;
      const l = len * (0.85 + r() * 0.3);
      const tone = 0.85 + r() * 0.3;
      // bề rộng răng cưa mô phỏng lá chét
      const wf = (t) => w * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) * (0.65 + 0.35 * (Math.round(t * 14) % 2)) + 0.012;
      b.add(leaf(V(0, y0, 0), l, az, elev + (r() - 0.5) * 0.2, droop, wf, 14), (x, y, z) => {
        const d = Math.hypot(x, z) / len;
        mix(col(0x1f7a2c), col(0x7fd048), d * 0.8).multiplyScalar(tone);
        return _c;
      });
    }
  };
  mk(9, 1.75, 0.45, 1.3, 0.12, 0.3);
  mk(6, 1.25, 1.0, 1.0, 0.1, 0.4);
  return b.build();
}

function buildBush() {
  const b = new Builder();
  const r = rngOf(71);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const d = i === 0 ? 0 : 0.35 + r() * 0.25;
    const s = 0.38 + r() * 0.22;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 0.38 + r() * 0.3;
    b.add(blob(cx, cy, cz, s * 1.15, s * 0.85, s * 1.15, i * 5 + 2, 1, 0.22), (x, y, z, nx, ny) => {
      // lốm đốm xanh / vàng lá theo noise
      const yel = sstep(0.5, 0.7, vnoise(x * 3.5, y * 3.5, z * 3.5, 9));
      mix(col(0x2f7d31), col(0x6dbb45), ny * 0.5 + 0.4);
      _c.lerp(col(0xb5b84a), yel * 0.55);
      return _c;
    });
  }
  return b.build();
}

const PLANT_BUILDERS = { pine: buildPine, broadleaf: buildBroadleaf, palm: buildPalm, dead: buildDead, fern: buildFern, bush: buildBush };
// Chiều cao dựng sẵn (khớp shared/world.js) và biên độ gió từng loại
const PLANT_WIND = { pine: [10, 0.05], broadleaf: [8, 0.06], palm: [7, 0.1], dead: [5.5, 0.012], fern: [1.6, 0.16], bush: [1.2, 0.1] };

// ============================================================
// ĐÁ: geometry đơn vị (bán kính ngang 1, cao 1, đáy y=0)
// ============================================================
const ROCK_PALETTE = {
  boulder: [col(0x7b7b7c), col(0x76706a), col(0x8a8780), col(0x686a6e)],
  rock: [col(0x85827d), col(0x6f6c68), col(0x948a78), col(0x77757a)],
  slab: [col(0xa8a08c), col(0x8d8a84), col(0xb3a98f), col(0x7f7b73)],
  spire: [col(0x6c6a6c), col(0x7d6e62), col(0x5f6064), col(0x8a7a6a)],
  pebbles: [col(0xa89e88), col(0x8e8a84), col(0xb8ad94), col(0x827e78)],
};
const MOSS = col(0x6f9a45);

function rockColorFn(kind, seed) {
  const base = ROCK_PALETTE[kind][seed];
  const mossy = kind !== 'spire' && seed % 2 === 0; // một số biến thể có rêu
  return (x, y, z, nx, ny) => {
    const m = fbm(x * 2.2, y * 2.2, z * 2.2, seed + 5);
    _c.copy(base).multiplyScalar((0.62 + 0.45 * Math.min(1, y)) * (0.88 + 0.24 * m)); // đáy tối hơn + lốm đốm
    if (mossy && kind !== 'pebbles') {
      const k = sstep(0.55, 0.85, ny) * sstep(0.35, 0.6, fbm(x * 3, y * 3, z * 3, seed + 11));
      _c.lerp(MOSS, k * 0.75);
    }
    return _c;
  };
}

// Đưa y từ [-1,1] của khối cầu về [0,1] và làm phẳng đáy để đá "ngồi" trên đất
function seat(p, i, x, y, z, sy) {
  p.setXYZ(i, x, Math.max(0, (y * 0.5 + 0.5) * sy), z);
}

function rockGeo(kind, seed) {
  const s = seed * 17 + 3;
  let g;
  if (kind === 'boulder') {
    g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.82 + fbm(x * 1.4 + s, y * 1.4, z * 1.4, s) * 0.5 + (vnoise(x * 5, y * 5, z * 5, s) - 0.5) * 0.1;
      seat(p, i, x * k, y * k, z * k * (0.9 + seed * 0.04), 1.0);
    }
  } else if (kind === 'rock') {
    g = new THREE.IcosahedronGeometry(1, 1); // ít mặt => góc cạnh
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.7 + vnoise(x * 1.6 + s, y * 1.6, z * 1.6, s) * 0.6;
      seat(p, i, x * k * (1 + (seed % 2) * 0.15), y * k, z * k, 1.0);
    }
  } else if (kind === 'slab') {
    g = new THREE.BoxGeometry(2, 1, 2, 7, 2, 7);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const e = sstep(0.6, 1, edge);
      const nz = (vnoise(x * 2.5 + s, 0, z * 2.5, s) - 0.5);
      // mép lởm chởm: kéo xz vào/ ra theo noise, bo góc nhẹ
      const len = Math.hypot(x, z);
      const roundK = 1 - 0.18 * sstep(1, 1.4, len);
      x *= (1 + nz * 0.4 * e) * roundK; z *= (1 + nz * 0.4 * e) * roundK;
      y = (y + 0.5) * (0.75 + 0.25 * (1 - e)) + (vnoise(x * 3, 0, z * 3, s + 2) - 0.5) * 0.15 * (y > 0 ? 1 : 0);
      p.setXYZ(i, x, Math.max(0, y), z);
    }
  } else if (kind === 'spire') {
    g = new THREE.CylinderGeometry(0.04 + seed * 0.02, 1, 1, 5 + (seed % 2), 6, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i) + 0.5, z = p.getZ(i); // y 0..1
      const k = 1 + (vnoise(x * 2 + s, y * 3, z * 2, s) - 0.5) * 0.35 * (1 - y * 0.6);
      const taper = 1 - 0.25 * Math.sin(y * 3.1);
      const tw = y * (0.5 + seed * 0.2); // xoắn nhẹ
      const cx = x * k * taper, cz = z * k * taper;
      x = cx * Math.cos(tw) - cz * Math.sin(tw); z = cx * Math.sin(tw) + cz * Math.cos(tw);
      p.setXYZ(i, x + (0.28 + seed * 0.08) * y * y, y, z); // đỉnh hơi nghiêng
    }
  } else { // pebbles: cụm 3-6 viên sỏi gộp trong 1 geometry
    const r = rngOf(s + 100);
    const n = 3 + seed + (seed === 3 ? 0 : 0); // 3..6
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.8, d = i === 0 ? 0.1 : 0.45 + r() * 0.45;
      const sz = 0.3 + r() * 0.25;
      const ig = new THREE.IcosahedronGeometry(1, 1);
      const p = ig.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const f = 0.8 + vnoise(x * 2 + i, y * 2, z * 2, s) * 0.4;
        p.setXYZ(k, Math.cos(a) * d + x * sz * f, Math.max(0, (y * 0.5 + 0.5) * sz * 1.5 * f), Math.sin(a) * d + z * sz * f);
      }
      parts.push(ig);
    }
    const b = new Builder();
    const fn = rockColorFn(kind, seed);
    parts.forEach((pg, i) => b.add(pg, (x, y, z, nx, ny, nz) => { fn(x, y, z, nx, ny, nz); return _c.multiplyScalar(0.9 + 0.2 * hash3(i, seed, 1)); }));
    return b.build();
  }
  const b = new Builder();
  b.add(g, rockColorFn(kind, seed));
  return b.build();
}

// ============================================================
// Dựng InstancedMesh cho dữ liệu cây/đá bất kỳ (preview dùng dữ liệu giả, game dùng getWorld())
// ============================================================
const CULL_DIST = 460; // m, phải lớn hơn khoảng cách sương kín (sky.js)
const CHUNK = 120; // m. Chia cây/đá thành ô không gian để GPU bỏ qua ô ngoài tầm nhìn (trước đây vẽ cả đảo mỗi khung)
function chunks(list) {
  const m = new Map();
  for (const it of list) {
    const k = Math.floor(it.x / CHUNK) + ',' + Math.floor(it.z / CHUNK);
    (m.get(k) || m.set(k, []).get(k)).push(it);
  }
  return [...m.values()];
}

export function createFloraFrom(scene, plants, rocks) {
  const group = new THREE.Group();
  const uTime = { value: 0 };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // ---- Cây ----
  for (const kind of Object.keys(PLANT_BUILDERS)) {
    const list = plants.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const geo = PLANT_BUILDERS[kind]();
    const [H, amp] = PLANT_WIND[kind];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // Gió: đung đưa đỉnh theo độ cao (càng cao càng lay), pha lệch theo vị trí từng cây
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 ip = vec2(0.0);
        #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xz;
        #endif
        float hh = max(position.y, 0.0) / ${H.toFixed(2)};
        float k = hh * hh * ${amp.toFixed(3)} * ${H.toFixed(2)};
        float ph = uTime * 1.5 + ip.x * 0.35 + ip.y * 0.27;
        transformed.x += sin(ph + position.y * 0.3) * k;
        transformed.z += cos(ph * 0.8 + 1.3) * k * 0.7;
        transformed.y += sin(ph * 2.3 + length(position.xz) * 2.0) * k * 0.15;`);
    };
    mat.customProgramCacheKey = () => 'flora-wind-' + kind;
    for (const cl of chunks(list)) {
    const mesh = new THREE.InstancedMesh(geo, mat, cl.length);
    cl.forEach((p, i) => {
      const h1 = hash3(p.x, p.z, 1), h2 = hash3(p.x, p.z, 2), h3 = hash3(p.x, p.z, 3);
      dummy.position.set(p.x, p.y - 0.05, p.z);
      dummy.rotation.set(0, p.rot, 0);
      // co giãn ngang hơi khác dọc (±10%), xác định theo vị trí
      dummy.scale.set(p.scale * (0.9 + h1 * 0.2), p.scale * (0.92 + h2 * 0.16), p.scale * (0.9 + h1 * 0.2));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // sắc độ: ±10% sáng, ngả vàng/ xanh
      const br = 0.9 + h3 * 0.2, yl = h2;
      mesh.setColorAt(i, color.setRGB(br * (0.96 + yl * 0.14), br * (1.0 + (1 - yl) * 0.04), br * (0.9 + (1 - yl) * 0.1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 6; // chừa chỗ cho cây cao + gió lay
    group.add(mesh);
    }
  }

  // ---- Đá: mỗi (loại, biến thể seed) một InstancedMesh ----
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const rockCache = {};
  const buckets = new Map();
  for (const rk of rocks) {
    const key = rk.kind + ':' + rk.seed;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(rk);
  }
  for (const [key, list] of buckets) {
    const [kind, seedS] = key.split(':');
    const seed = +seedS;
    const geo = rockCache[key] || (rockCache[key] = rockGeo(kind, seed));
    for (const cl of chunks(list)) {
    const mesh = new THREE.InstancedMesh(geo, rockMat, cl.length);
    cl.forEach((rk, i) => {
      const h1 = hash3(rk.x, rk.z, 5), h2 = hash3(rk.x, rk.z, 6);
      dummy.position.set(rk.x, rk.y - 0.12 * rk.hgt, rk.z); // chìm nhẹ xuống đất
      dummy.rotation.set(rk.rotX, rk.rotY, 0);
      dummy.scale.set(rk.w, rk.hgt, rk.w);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const br = 0.88 + h1 * 0.24;
      mesh.setColorAt(i, color.setRGB(br * (0.97 + h2 * 0.06), br, br * (1.03 - h2 * 0.06)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 3;
    group.add(mesh);
    }
  }

  scene.add(group);
  return {
    group,
    drawCalls: group.children.length,
    update(t, cam) {
      uTime.value = t;
      if (!cam) return;
      for (const m of group.children) { // ẩn ô ở xa hơn tầm sương (không ai nhìn thấy)
        const b = m.boundingSphere, dx = b.center.x - cam.x, dz = b.center.z - cam.z;
        m.visible = dx * dx + dz * dz < (CULL_DIST + b.radius) ** 2;
      }
    },
  };
}

/** Cây + đá của thế giới thật (getWorld). Trả về { update(timeSeconds) }. */
export function createFlora(scene) {
  const { plants, rocks } = getWorld();
  return createFloraFrom(scene, plants, rocks);
}
