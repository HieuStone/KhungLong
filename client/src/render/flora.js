import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getWorld } from '@isle/shared';
import { pbr, broadLeafCluster, needleCluster, frondTexture } from './pbr.js';

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
    // Pháp tuyến mượt: gộp đỉnh trùng, tính pháp tuyến trung bình rồi mới tách mặt (tô màu từng đỉnh vẫn giữ)
    let g = geo.clone();
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
    g = g.toNonIndexed();
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
  const pos = [], idx = [], uv = [];
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
    uv.push(0, t, 0.5, t, 1, t);
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
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Bộ gom "tấm lá" (card): mỗi tấm là 1 hình chữ nhật dán ảnh cành lá có kênh trong suốt.
 * Pháp tuyến đặt theo hướng ra ngoài tán (không theo mặt tấm) => cả tán sáng tối mềm như một khối lá thật.
 */
class CardBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; this.extra = []; }
  // base: gốc cành; dir: hướng cành (gốc->ngọn); side: hướng bề ngang; len, wid: kích thước; n: pháp tuyến; c: màu nhuộm
  card(base, dir, side, len, wid, n, c) {
    const i0 = this.pos.length / 3;
    const pts = [
      base.clone().addScaledVector(side, -wid / 2), base.clone().addScaledVector(side, wid / 2),
      base.clone().addScaledVector(side, -wid / 2).addScaledVector(dir, len), base.clone().addScaledVector(side, wid / 2).addScaledVector(dir, len),
    ];
    const uvs = [[0, 0], [1, 0], [0, 1], [1, 1]];
    pts.forEach((q, k) => { this.pos.push(q.x, q.y, q.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(...uvs[k]); this.col.push(c.r, c.g, c.b); });
    this.idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
  }
  // thêm hình học có sẵn (vd lá cọ có UV); pháp tuyến tính lại, màu đồng nhất
  geo(g, c, upBias = 0.5) {
    g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, i0 = this.pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      const nn = new THREE.Vector3(N.getX(i), Math.abs(N.getY(i)) + upBias, N.getZ(i)).normalize();
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i)); this.nrm.push(nn.x, nn.y, nn.z);
      this.uv.push(UV.getX(i), UV.getY(i)); this.col.push(c.r, c.g, c.b);
    }
    for (const k of g.index.array) this.idx.push(i0 + k);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Rải tấm cành lá lên một khối tán hình elip (tâm c, bán kính s), pháp tuyến hướng từ tâm tán toàn cây. */
function scatterCards(cb, r, c, s, n, crownCenter, tone, sizeK = 1.25) {
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u) * Math.cbrt(r()) * 0.8;
    const p = V(c.x + Math.cos(a) * rr * s, c.y + u * s * 0.65, c.z + Math.sin(a) * rr * s);
    const out = p.clone().sub(crownCenter).normalize();
    const dir = out.clone().add(V((r() - 0.5) * 0.9, 0.35 + r() * 0.4, (r() - 0.5) * 0.9)).normalize();
    let side = new THREE.Vector3().crossVectors(dir, V(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
    if (side.lengthSq() < 1e-4) side = V(1, 0, 0);
    side.normalize();
    const len = s * sizeK * (0.75 + r() * 0.4);
    const base = p.clone().addScaledVector(dir, -len * 0.45);
    const nrm = out.clone().add(V(0, 0.45, 0)).normalize();
    const k = tone * (0.82 + r() * 0.3);
    cb.card(base, dir, side, len, len, nrm, _c.setRGB(k * (0.95 + r() * 0.1), k, k * (0.9 + r() * 0.1)).clone());
  }
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
// Màu ở đây là màu NHUỘM nhân với ảnh vỏ cây thật (gần trắng = giữ nguyên màu ảnh)
const BARK = col(0xf2ece4), BARK_D = col(0xb8aea2), GREY = col(0xd8d6d2), GREY_D = col(0xa6a39f);

function buildPine() {
  const b = new Builder();
  // Thân thon, hơi cong
  const pts = [], rad = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(V(Math.sin(t * 2.2) * 0.12, t * 9.8, Math.sin(t * 1.7) * 0.1)); rad.push(0.5 * (1 - t) + 0.05); }
  b.add(tube(pts, rad, 6), (x, y) => mix(BARK_D, BARK, y / 6));
  // Cành lá kim: 8 tầng, mỗi tầng 9-11 cành toả ra và rủ xuống; mỗi cành = 2 tấm bắt chéo cho có độ dày
  const cb = new CardBuilder(), r = rngOf(11);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const y0 = 1.9 + t * 7.3, rr = 2.5 * (1 - t * 0.85) + 0.25;
    const K = Math.round(10 - t * 3);
    for (let k = 0; k < K; k++) {
      const az = (k / K) * Math.PI * 2 + r() * 0.5 + i * 0.7;
      const dir = V(Math.cos(az), -0.18 - t * 0.12 - r() * 0.15, Math.sin(az)).normalize();
      const side = V(-Math.sin(az), 0.12, Math.cos(az)).normalize();
      const up = new THREE.Vector3().crossVectors(side, dir).normalize();
      const len = rr * (0.95 + r() * 0.3), base = V(Math.sin(y0 / 9.8 * 2.2) * 0.12, y0 + r() * 0.3, Math.sin(y0 / 9.8 * 1.7) * 0.1);
      const nrm = V(Math.cos(az), 0.7, Math.sin(az)).normalize(), tone = 0.85 + r() * 0.25;
      cb.card(base, dir, side, len, len * 0.8, nrm, _c.setRGB(tone, tone, tone).clone());
      cb.card(base, dir, up, len, len * 0.5, nrm, _c.setRGB(tone * 0.9, tone * 0.9, tone * 0.9).clone());
    }
  }
  // ngọn
  for (let k = 0; k < 3; k++) { const az = k * 2.1; cb.card(V(0, 9.0, 0), V(Math.cos(az) * 0.15, 1, Math.sin(az) * 0.15).normalize(), V(-Math.sin(az), 0, Math.cos(az)), 1.4, 0.9, V(0, 1, 0), _c.setRGB(1, 1, 1).clone()); }
  return { wood: b.build(), leaves: cb.build(), leafTex: 'needle', bark: 'pine_bark' };
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
  // Tán: các tấm cành lá thật rải trong 7 khối tán
  const r = rngOf(23), cb = new CardBuilder(), crown = V(0.2, 5.9, 0.1);
  const centers = [[0, 6.0, 0, 2.1], [1.7, 5.3, 0.5, 1.6], [-1.5, 5.2, 0.9, 1.55], [0.3, 5.5, -1.6, 1.6], [0.9, 7.0, 0.7, 1.3], [-0.9, 6.9, -0.4, 1.35], [0.2, 4.6, 1.5, 1.2]];
  centers.forEach(([cx, cy, cz, s], i) => scatterCards(cb, r, V(cx, cy, cz), s, 13, crown, i % 2 ? 0.9 : 1.05));
  return { wood: b.build(), leaves: cb.build(), leafTex: 'broad', bark: 'bark_brown_02' };
}

function buildPalm() {
  const b = new Builder();
  // Thân cong nhẹ, vằn đốt (xen kẽ sáng tối theo từng đoạn)
  const pts = [], rad = [];
  const N = 14;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(V(Math.pow(t, 1.8) * 1.1, t * 6.2, Math.sin(t * 2) * 0.12)); rad.push(0.34 - t * 0.15); }
  b.add(tube(pts, rad, 6), (x, y) => (Math.floor(y * 3.2) % 2 === 0 ? _c.setRGB(0.36, 0.32, 0.28) : _c.setRGB(0.27, 0.24, 0.21)));
  const top = pts[N];
  const cb = new CardBuilder();
  // 11 lá dài rủ cong xuống
  const r = rngOf(31);
  for (let i = 0; i < 12; i++) {
    const az = (i / 12) * Math.PI * 2 + (r() - 0.5) * 0.3;
    const len = 3.0 + r() * 0.7, elev = 0.5 + r() * 0.35, droop = 1.7 + r() * 0.6;
    const g = leaf(top, len, az, elev, droop, (t) => 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.06)) + 0.05, 9);
    const tone = 0.85 + r() * 0.3;
    cb.geo(g, _c.setRGB(tone, tone, tone * 0.95).clone());
  }
  // chùm quả
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    b.add(blob(top.x + Math.cos(a) * 0.28, top.y - 0.35, top.z + Math.sin(a) * 0.28, 0.22, 0.24, 0.22, i + 40, 1, 0.1), () => _c.setRGB(0.55, 0.45, 0.35));
  }
  return { wood: b.build(), leaves: cb.build(), leafTex: 'palm', bark: 'palm_tree_bark' };
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
  return { wood: b.build(), leaves: null, bark: 'bark_brown_02' };
}

function buildFern() {
  const b = new Builder();
  // Thân củ thấp (kiểu tuế)
  b.add(tube([V(0, 0, 0), V(0.02, 0.18, 0), V(0, 0.4, 0.02)], [0.26, 0.24, 0.17], 7), (x, y) => mix(col(0x8a7a66), col(0xd8c8b0), y / 0.4));
  const r = rngOf(59), cb = new CardBuilder();
  const mk = (n, len, elev, droop, w, y0) => {
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + r() * 0.4;
      const l = len * (0.85 + r() * 0.3);
      const tone = 0.85 + r() * 0.3;
      // bề rộng răng cưa mô phỏng lá chét
      const wf = (t) => w * 1.9 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) + 0.02;
      cb.geo(leaf(V(0, y0, 0), l, az, elev + (r() - 0.5) * 0.2, droop, wf, 10), _c.setRGB(tone, tone, tone * 0.95).clone());
    }
  };
  mk(9, 1.75, 0.45, 1.3, 0.12, 0.3);
  mk(6, 1.25, 1.0, 1.0, 0.1, 0.4);
  return { wood: b.build(), leaves: cb.build(), leafTex: 'fern', bark: 'bark_brown_02' };
}

function buildBush() {
  const b = new Builder();
  b.add(tube([V(0, 0, 0), V(0, 0.25, 0)], [0.08, 0.06], 5), () => _c.setRGB(0.8, 0.75, 0.7)); // gốc nhỏ
  const r = rngOf(71), cb = new CardBuilder(), crown = V(0, 0.5, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r();
    const d = i === 0 ? 0 : 0.35 + r() * 0.25, s = 0.42 + r() * 0.22;
    scatterCards(cb, r, V(Math.cos(a) * d, 0.42 + r() * 0.3, Math.sin(a) * d), s, 7, crown, 0.95, 1.5);
  }
  return { wood: b.build(), leaves: cb.build(), leafTex: 'broad', bark: 'bark_brown_02' };
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
const CHUNK = 160; // m. Chia cây/đá thành ô không gian để GPU bỏ qua ô ngoài tầm nhìn (trước đây vẽ cả đảo mỗi khung)
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

  // ---- Cây: mỗi loại 2 lớp instancing — gỗ (ảnh vỏ cây thật chiếu 3 phía) và lá (tấm cành lá cắt viền alpha) ----
  const leafTexOf = { broad: () => broadLeafCluster(), needle: () => needleCluster(), palm: () => frondTexture(false), fern: () => frondTexture(true) };
  for (const kind of Object.keys(PLANT_BUILDERS)) {
    const list = plants.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const parts = PLANT_BUILDERS[kind]();
    const [H, amp] = PLANT_WIND[kind];
    // Gió: đung đưa đỉnh theo độ cao (càng cao càng lay), pha lệch theo vị trí từng cây; lá rung thêm
    const wind = (flutter) => (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'uniform float uTime;\nvarying vec3 vOP; varying vec3 vON;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vOP = position; vON = normal;
        vec2 ip = vec2(0.0);
        #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xz;
        #endif
        float hh = max(position.y, 0.0) / ${H.toFixed(2)};
        float k = hh * hh * ${amp.toFixed(3)} * ${H.toFixed(2)};
        float ph = uTime * 1.5 + ip.x * 0.35 + ip.y * 0.27;
        transformed.x += sin(ph + position.y * 0.3) * k;
        transformed.z += cos(ph * 0.8 + 1.3) * k * 0.7;
        transformed.y += sin(ph * 2.3 + length(position.xz) * 2.0) * k * 0.15;
        ${flutter ? 'transformed += normal * sin(uTime * 7.0 + dot(position, vec3(3.1, 2.3, 2.7))) * 0.035 * hh;' : ''}`);
    };
    // Gỗ: ảnh vỏ cây chiếu 3 phía theo toạ độ của cây (vỏ dính theo thân khi lay)
    const bark = pbr(parts.bark);
    const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    woodMat.onBeforeCompile = (sh) => {
      wind(false)(sh);
      sh.uniforms.tBark = { value: bark.map };
      sh.fragmentShader = 'uniform sampler2D tBark;\nvarying vec3 vOP; varying vec3 vON;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bw = pow(abs(normalize(vON)), vec3(3.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 bk = texture2D(tBark, vOP.zy * vec2(1.4, 0.7)).rgb * bw.x + texture2D(tBark, vOP.xz * 1.4).rgb * bw.y + texture2D(tBark, vOP.xy * vec2(1.4, 0.7)).rgb * bw.z;
        diffuseColor.rgb *= bk * 1.25;`);
    };
    woodMat.customProgramCacheKey = () => 'flora-wood-' + kind;
    const woodDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    woodDepth.onBeforeCompile = wind(false);
    woodDepth.customProgramCacheKey = () => 'flora-wood-depth-' + kind;
    // Lá: ảnh cành lá có alpha; ánh sáng xuyên lá nhẹ (lá mỏng hơi sáng khi ngược nắng)
    let leafMat = null, leafDepth = null;
    if (parts.leaves) {
      const lt = leafTexOf[parts.leafTex]();
      leafMat = new THREE.MeshStandardMaterial({ map: lt, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 });
      leafMat.onBeforeCompile = (sh) => {
        wind(true)(sh);
        sh.vertexShader = 'varying float vViewZ;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vViewZ = -mvPosition.z;');
        sh.fragmentShader = 'varying vec3 vOP; varying vec3 vON; varying float vViewZ;\n' + sh.fragmentShader
          // lá sát camera mờ dần (rải điểm), để camera không bị bụi/tán lá che kín tầm nhìn
          .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
            float nearFade = smoothstep(0.6, 2.2, vViewZ);
            if (nearFade < 1.0 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > nearFade) discard;`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * 0.06;`);
      };
      leafMat.customProgramCacheKey = () => 'flora-leaf-' + kind;
      leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: lt, alphaTest: 0.45 });
      leafDepth.onBeforeCompile = wind(true);
      leafDepth.customProgramCacheKey = () => 'flora-leaf-depth-' + kind;
    }
    for (const cl of chunks(list)) {
      const layers = [[parts.wood, woodMat, woodDepth]];
      if (leafMat) layers.push([parts.leaves, leafMat, leafDepth]);
      for (const [geo, mat, depthMat] of layers) {
        const mesh = new THREE.InstancedMesh(geo, mat, cl.length);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = depthMat;
        cl.forEach((p, i) => {
          const h1 = hash3(p.x, p.z, 1), h2 = hash3(p.x, p.z, 2), h3 = hash3(p.x, p.z, 3);
          dummy.position.set(p.x, p.y - 0.05, p.z);
          dummy.rotation.set(0, p.rot, 0);
          dummy.scale.set(p.scale * (0.9 + h1 * 0.2), p.scale * (0.92 + h2 * 0.16), p.scale * (0.9 + h1 * 0.2));
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          // sắc độ từng cây: ±10% sáng, ngả vàng/xanh (lá); gỗ chỉ đổi độ sáng
          const br = 0.9 + h3 * 0.2, yl = h2;
          if (mat === leafMat) mesh.setColorAt(i, color.setRGB(br * (0.92 + yl * 0.16), br, br * (0.88 + (1 - yl) * 0.1)));
          else mesh.setColorAt(i, color.setRGB(br, br, br));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 6; // chừa chỗ cho cây cao + gió lay
        group.add(mesh);
      }
    }
  }

  // ---- Đá: mỗi (loại, biến thể seed) một InstancedMesh ----
  // Đá: ảnh đá địa y thật chiếu 3 phía theo toạ độ của hòn đá, nhân màu đỉnh (rêu phía trên, sắc từng loại đá)
  const rockTex = pbr('lichen_rock');
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  rockMat.onBeforeCompile = (sh) => {
    sh.uniforms.tRock = { value: rockTex.map };
    sh.vertexShader = 'varying vec3 vOP; varying vec3 vON;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOP = position; vON = normal;');
    sh.fragmentShader = 'uniform sampler2D tRock;\nvarying vec3 vOP; varying vec3 vON;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 fn = normalize(cross(dFdx(vOP), dFdy(vOP))); // pháp tuyến mặt (không phụ thuộc dữ liệu đỉnh)
      vec3 bw = pow(abs(fn), vec3(3.0)); bw /= (bw.x + bw.y + bw.z + 1e-4);
      vec3 rk = texture2D(tRock, vOP.zy * 0.9).rgb * bw.x + texture2D(tRock, vOP.xz * 0.9).rgb * bw.y + texture2D(tRock, vOP.xy * 0.9).rgb * bw.z;
      diffuseColor.rgb *= rk * 19.0; // ảnh đá rất sẫm (~5% tuyến tính): chuẩn hoá về trung bình ~1, chỉ lấy chi tiết`);
  };
  rockMat.customProgramCacheKey = () => 'rock-triplanar';
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
    mesh.castShadow = true; mesh.receiveShadow = true;
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
