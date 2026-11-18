// Khủng long procedural: thân/cổ/đuôi/đầu/chân/tay là một lớp da liền mạch bám xương (loft.js),
// chi tiết nhỏ (mắt, răng, sừng, móng, mề đay, lông) là primitive gắn vào xương.
// Quy ước: mũi hướng -Z, chân đặt y=0, đơn vị mét, chiều dài mũi->đuôi = SPECIES[id].bodyLength.
import * as THREE from 'three';
import { SPECIES } from '@isle/shared';
import { recolor, bellyOf } from './colorize.js';
import { skinify } from './textures.js';
import { LoftBuilder, SkinMaterial } from './loft.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const { lerp, clamp } = THREE.MathUtils;
const PI = Math.PI;
// làm mượt theo hàm mũ, không phụ thuộc framerate
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Geometry dùng chung giữa mọi instance (không dispose)
const SPHERE = new THREE.SphereGeometry(1, 24, 16);
const CONE = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0); // đáy ở gốc, đỉnh +Y, cao 1

// Vật liệu cache theo loài, dùng chung (không dispose)
const matCache = new Map();
function getMats(id, col) {
  if (!matCache.has(id)) {
    // Da: bề mặt mượt + vảy (bump) + độ nhám không đều; răng/xương/mắt thì trơn
    const m = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const skin = (c, k = 1) => skinify(m(c, 1), k);
    matCache.set(id, {
      back: skin(col.back), belly: skin(col.belly, 0.6), accent: skin(col.accent),
      tooth: m(0xf3efe0, 0.45), bone: m(0xd9cfae, 0.7), dark: m(0x0e0e0e, 0.15),
      eye: m(0xc08a26, 0.08), mouth: m(0x3e1c1c, 0.55), // mắt hổ phách bóng ướt, khoang miệng
    });
  }
  return matCache.get(id);
}

// ---------- Thông số từng loài (mét, tỉ lệ thật; sẽ được co giãn đều về bodyLength) ----------
// skull/snout/jaw = [w,h,l, x,y,z] (nửa kích thước ellipsoid + tâm)
const SPEC = {
  tyrannosaurus: {
    col: { back: 0x4d5234, belly: 0x7a785c, accent: 0x2f3322 },
    tilt: 0.26, hipInset: 0.5,
    torso: { a: 2.0, h: 1.3, w: 0.95 },
    leg: { t: 1.7, s: 1.5, f: 1.0, r: 0.55, h: 0.5, k: -1.1, x: 0.85, z: 0.2, knee: 0.7 },
    neck: { n: 3, len: 0.55, r0: 0.8, r1: 0.55, ang: [0.6, 0.1, -0.4], pos: [0, 0.3, -1.55] },
    tail: { n: 7, len: 0.7, r0: 0.75, r1: 0.08, base: -0.3, curve: 0.03, wag: 0.07, pos: [0, 0.2, 1.55] },
    arm: { pos: [0.72, -0.7, -1.2], up: 0.4, fore: 0.35, r: 0.1, claws: 2, claw: 0.16, sh: 0.5, el: 0.6 },
    head: {
      skull: [0.52, 0.58, 0.75, 0, 0, -0.55], snout: [0.36, 0.36, 0.65, 0, -0.12, -1.25],
      jawP: [0, -0.45, -0.25], jaw: [0.34, 0.17, 0.85, 0, -0.12, -0.8],
      eye: [0.44, 0.2, -0.45, 0.09], pitch: 0,
      up: { n: 3, z0: -1.0, z1: -1.8, x: 0.26, y: -0.42, r: 0.07, len: 0.3 },
      lo: { n: 2, z0: -0.4, z1: -1.3, x: 0.2, y: 0.06, r: 0.06, len: 0.2 },
    },
    jaw: 0.6, atk: { neck: -0.45, body: 0.12, push: 0.6, comp: 0.7 },
  },
  utahraptor: {
    col: { back: 0x7a5634, belly: 0xa68c6c, accent: 0x2e2318 },
    tilt: 0.2, hipInset: 0.5,
    torso: { a: 0.85, h: 0.36, w: 0.24 },
    leg: { t: 0.55, s: 0.6, f: 0.5, r: 0.1, h: 0.55, k: -1.15, x: 0.2, z: 0.1, knee: 0.8 },
    neck: { n: 3, len: 0.24, r0: 0.17, r1: 0.1, ang: [0.7, 0.25, -0.5], pos: [0, 0.12, -0.7] },
    tail: { n: 7, len: 0.45, r0: 0.17, r1: 0.03, base: -0.22, curve: 0, wag: 0.03, pos: [0, 0.08, 0.7] },
    arm: { pos: [0.2, -0.14, -0.55], up: 0.28, fore: 0.3, r: 0.04, claws: 2, claw: 0.12, sh: 0.7, el: 0.5 },
    head: {
      skull: [0.13, 0.15, 0.24, 0, 0, -0.2], snout: [0.085, 0.09, 0.26, 0, -0.03, -0.42],
      jawP: [0, -0.1, -0.08], jaw: [0.07, 0.045, 0.32, 0, -0.03, -0.27],
      eye: [0.115, 0.05, -0.2, 0.035], pitch: 0,
      up: { n: 2, z0: -0.38, z1: -0.58, x: 0.06, y: -0.1, r: 0.016, len: 0.075 },
      lo: { n: 1, z0: -0.3, z1: -0.3, x: 0.04, y: 0.0, r: 0.014, len: 0.06 },
    },
    jaw: 0.5, atk: { neck: -0.3, body: 0.1, push: 0.25, comp: 0.6, arm: 0.8 },
  },
  triceratops: {
    col: { back: 0x8a4a26, belly: 0xa86e42, accent: 0xc89a48 },
    tilt: 0, hipInset: 0.75, quad: true, skinScale: 3.0, skinBump: 2.2, eye: 0x2e1c10, blot: 0, // mảng vảy to nổi khối; mắt nâu sẫm
    torso: { a: 2.9, h: 1.45, w: 1.28, hump: 0.2, humpAt: 0.35 }, // lưng gù cao ở hông, thấp dần về vai
    leg: { t: 0.8, s: 0.68, f: 0.4, r: 0.56, h: 0.12, k: -0.22, x: 0.82, zF: -1.7, zB: 1.7, knee: 0.35 },
    neck: { n: 2, len: 0.6, r0: 0.9, r1: 0.82, ang: [0.05, -0.32], pos: [0, -0.05, -2.4] },
    tail: { n: 6, len: 0.68, r0: 0.72, r1: 0.08, base: 0.26, curve: 0.04, wag: 0.05, pos: [0, 0.15, 2.4] },
    head: {
      skull: [0.7, 0.7, 0.9, 0, 0, -0.58], snout: [0.44, 0.44, 0.64, 0, -0.16, -1.42],
      beak: [0.2, 0.26, 0.36, 0, -0.3, -1.98],
      jawP: [0, -0.47, -0.28], jaw: [0.3, 0.16, 0.84, 0, -0.06, -0.78],
      eye: [0.62, 0.16, -0.36, 0.1], pitch: -0.18,
    },
    jaw: 0.3, atk: { neck: -0.8, body: 0.1, push: 0.6, comp: 0 },
  },
  dryosaurus: {
    col: { back: 0x8a7550, belly: 0xb2a07c, accent: 0x5e4a2e },
    tilt: 0.3, hipInset: 0.5,
    torso: { a: 0.5, h: 0.26, w: 0.19 },
    leg: { t: 0.42, s: 0.46, f: 0.32, r: 0.075, h: 0.5, k: -1.0, x: 0.15, z: 0.05, knee: 0.8 },
    neck: { n: 4, len: 0.17, r0: 0.11, r1: 0.055, ang: [0.9, 0.4, -0.3, -0.6], pos: [0, 0.08, -0.4] },
    tail: { n: 6, len: 0.28, r0: 0.14, r1: 0.025, base: -0.4, curve: 0.02, wag: 0.035, pos: [0, 0.06, 0.4] },
    arm: { pos: [0.14, -0.1, -0.32], up: 0.12, fore: 0.12, r: 0.025, claws: 0, claw: 0, sh: 0.7, el: 0.6 },
    head: {
      skull: [0.075, 0.085, 0.13, 0, 0, -0.1], snout: [0.05, 0.05, 0.12, 0, -0.015, -0.2],
      jawP: [0, -0.05, -0.04], jaw: [0.035, 0.025, 0.14, 0, -0.01, -0.12],
      eye: [0.068, 0.03, -0.1, 0.028], pitch: 0,
    },
    jaw: 0.25, atk: { neck: -0.2, body: 0.08, push: 0.1, comp: 0.5, kick: 1.0 },
  },
};

// ---------- Helper dựng mesh ----------
function ell(parent, mat, s, p) {
  const m = new THREE.Mesh(SPHERE, mat);
  m.scale.set(s[0], s[1], s[2]); m.position.set(p[0], p[1], p[2]);
  parent.add(m); return m;
}
// nón: bán kính đáy r, cao len; rot = [x,y,z] euler (đỉnh nón mặc định +Y)
function spike(parent, mat, r, len, p, rot) {
  const m = new THREE.Mesh(CONE, mat);
  m.scale.set(r, len, r); m.position.set(p[0], p[1], p[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m); return m;
}
// chuỗi đốt nối tiếp: pivot i đặt ở đầu đốt i-1 => xoay đốt gốc kéo theo cả chuỗi
function chain(parent, C, dirZ) {
  const segs = []; let p = parent;
  for (let i = 0; i < C.n; i++) {
    const piv = new THREE.Group();
    if (i === 0) piv.position.set(C.pos[0], C.pos[1], C.pos[2]); else piv.position.z = dirZ * C.len;
    p.add(piv); p = piv; segs.push(piv);
  }
  return segs;
}
// ---------- Đầu: hình dạng hộp sọ, răng ----------
// Độ "vuông" mặt cắt hộp sọ (0 = tròn, 1 = vuông bo góc) và độ nở phía sau hộp sọ (T-rex: sau đầu rất rộng, mõm hẹp)
const HEAD_SHAPE = {
  tyrannosaurus: { sqBack: 0.75, sqFront: 0.35, widen: 1.18 },
  utahraptor: { sqBack: 0.4, sqFront: 0.2, widen: 1.05 },
  triceratops: { sqBack: 0.3, sqFront: 0.2, widen: 1.0 },
  dryosaurus: { sqBack: 0.15, sqFront: 0.1, widen: 1.0 },
};
/** Đường miệng (độ cao mép trên hàm dưới) trong toạ độ của đầu. */
const mouthYOf = (H) => H.jawP[1] + H.jaw[4] + H.jaw[1] * 0.55;
/** Mặt cắt đầu tại z (toạ độ đầu): hợp của hộp sọ + mõm; t01: 0 = sau gáy, 1 = chóp mõm. */
function headProfile(id, H, z) {
  const sh = HEAD_SHAPE[id] || HEAD_SHAPE.dryosaurus;
  let w = 0, top = -Infinity, bot = Infinity;
  for (const e of [H.skull, H.snout]) {
    const q = 1 - ((z - e[5]) / e[2]) ** 2;
    if (q <= 0) continue;
    const f = Math.sqrt(q);
    w = Math.max(w, e[0] * f); top = Math.max(top, e[4] + e[1] * f); bot = Math.min(bot, e[4] - e[1] * f);
  }
  if (!w) { w = H.snout[0] * 0.15; top = H.snout[4] + w; bot = H.snout[4] - w; }
  const z0 = H.skull[5] + H.skull[2] * 0.8, z1 = H.snout[5] - H.snout[2] * 0.97;
  const t01 = clamp((z0 - z) / (z0 - z1), 0, 1);
  w *= lerp(sh.widen, 1, Math.min(1, t01 * 2.2)); // gáy nở rộng
  return { w, top, bot, t01, sq: lerp(sh.sqBack, sh.sqFront, t01) };
}

/**
 * Hàm răng: răng cong ngược về sau (như dao), to ở giữa hàm nhỏ dần hai đầu, kích thước không đều;
 * màu ngà, chân răng sẫm. Gộp thành 1 khối hình học (1 lệnh vẽ). dir = -1: răng hàm trên chĩa xuống.
 */
const TOOTH = new THREE.ConeGeometry(1, 1, 6, 4).translate(0, 0.5, 0); // đáy tại y=0, chóp y=1
function teethGeometry(list) {
  const parts = [];
  for (const { x, y, z, len, dir, side } of list) {
    const g = TOOTH.clone();
    const P = g.attributes.position, col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const t = P.getY(i);                                   // 0 chân -> 1 chóp
      const bx = P.getX(i) * len * 0.2, bz = P.getZ(i) * len * 0.34; // dẹt như lưỡi dao (dài theo trục trước-sau)
      P.setXYZ(i, x + bx - side * len * 0.04 * t, y + dir * t * len, z + bz + len * 0.32 * t * t); // cong về sau
      const k = 0.1 + 0.24 * Math.min(1, t * 1.4);              // chân răng sẫm (lợi, ố), chóp sáng hơn (giá trị tuyến tính)
      col.set([k * 0.95, k * 0.82, k * 0.6], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    parts.push(g);
  }
  const m = mergeGeometries(parts, false);
  m.computeVertexNormals();
  return m;
}
// Sừng/mỏ bằng keratin: màu theo đỉnh (chân sẫm -> chóp sáng), hơi bóng
const EYE_MATS = new Map();
const eyeMat = (c) => EYE_MATS.get(c) || EYE_MATS.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.06 })).get(c);
const KERATIN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, envMapIntensity: 0.25 });
/**
 * Sừng cong: nón dọc +Y dài len, bán kính đáy r, cong dần về -Z (phía trước) một lượng bend*len ở chóp.
 * base/tip: màu tuyến tính ở chân / chóp.
 */
function hornGeometry(len, r, bend, base, tip, flat = 1) {
  const g = new THREE.ConeGeometry(1, 1, 10, 6).translate(0, 0.5, 0);
  const P = g.attributes.position, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const t = P.getY(i);
    P.setXYZ(i, P.getX(i) * r, t * len, P.getZ(i) * r * flat - bend * len * t * t);
    const k = Math.pow(t, 0.8);
    col.set([base[0] + (tip[0] - base[0]) * k, base[1] + (tip[1] - base[1]) * k, base[2] + (tip[2] - base[2]) * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
/**
 * Mề đay Triceratops: tấm khiên cong mọc từ sau hộp sọ, ngả ra sau (nghiêng elev so với phương ngang),
 * mép hơi cong vào trong; màu vùng rìa ngả đỏ nâu (vùng phô diễn). Trả về { geo, rim: [{p, dir}] } cho gai viền.
 */
function frillGeometry(W, Lf, elev, cup) {
  const NT = 17, NR = 7, pos = [], col = [], idx = [], rim = [];
  const u = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));   // hướng ngả ra sau-lên
  const n = new THREE.Vector3(0, -Math.cos(elev), Math.sin(elev));  // pháp tuyến mặt khiên (ra sau)
  for (let i = 0; i <= NT; i++) {
    const th = (i / NT - 0.5) * 2.5;                                  // -1.25..1.25 rad quanh tâm gốc
    for (let j = 0; j <= NR; j++) {
      const rr = j / NR;
      const x = Math.sin(th) * W * Math.pow(rr, 0.85);
      const along = Math.cos(th) * Lf * rr + 0.05;
      const curl = -cup * rr * rr * (0.4 + Math.abs(Math.sin(th)));   // mép cong vào (về phía trước)
      const q = u.clone().multiplyScalar(along).addScaledVector(n, curl).add(new THREE.Vector3(x, 0, 0));
      pos.push(q.x, q.y, q.z);
      const rim01 = Math.max(0, (rr - 0.55) / 0.45);
      // màu tuyệt đối (vật liệu mề đay màu trắng): tâm nâu cam -> vành vàng -> mép đỏ
      const inner = Math.max(0, 1 - rr / 0.6), mid = Math.min(1, Math.max(0, (rr - 0.4) / 0.25)) * (1 - rim01 * 0.55);
      col.push(0.18 * inner + 0.36 * mid + 0.34 * rim01, 0.05 * inner + 0.18 * mid + 0.05 * rim01, 0.02 * inner + 0.035 * mid + 0.02 * rim01);
      if (j === NR) rim.push({ p: q.clone(), dir: q.clone().sub(n.clone().multiplyScalar(curl)).normalize(), th });
    }
  }
  for (let i = 0; i < NT; i++) for (let j = 0; j < NR; j++) {
    const a = i * (NR + 1) + j, b = a + NR + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 2 ? null : v)).filter((v) => v !== null), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, rim };
}

const TEETH_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, envMapIntensity: 0.5 });
const TONGUE_MAT = new THREE.MeshStandardMaterial({ color: 0x6e3634, roughness: 0.45, envMapIntensity: 0.4 });

function makeLeg(rig, L, x, y, z, side) {
  const hip = new THREE.Group(); hip.position.set(x, y, z); rig.add(hip);
  const knee = new THREE.Group(); knee.position.y = -L.t; hip.add(knee);
  const ankle = new THREE.Group(); ankle.position.y = -L.s; knee.add(ankle);
  return { hip, knee, ankle, side };
}

function makeArm(body, M, A, side) {
  const sh = new THREE.Group(); sh.position.set(side * A.pos[0], A.pos[1], A.pos[2]); body.add(sh);
  const el = new THREE.Group(); el.position.y = -A.up; sh.add(el);
  for (let c = 0; c < A.claws; c++) {
    spike(el, M.bone, A.r * 0.4, A.claw, [(c - (A.claws - 1) / 2) * A.r * 0.9, -A.fore, 0], [PI, 0, 0]);
  }
  return { sh, el, side };
}

// Lông vũ dẹt: nón dẹt chĩa ra sau (+Z), yaw = xoè ngang
function feather(parent, mat, len, w, p, yaw) {
  return spike(parent, mat, w, len, p, [PI / 2, 0, yaw]).scale.set(w, len, w * 0.25);
}


// ---------- Da liền mạch ----------
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Hoa văn từng loài: (vị trí dọc thân 0=chóp đuôi..1=mõm, sin góc quanh thân: +1 sống lưng, -1 bụng) -> điểm nhấn
const PATTERN = {
  tyrannosaurus: (s, sa) => 0.4 * sstep(0.55, 0.85, Math.sin(s * 48)) * sstep(0.15, 0.7, sa) * sstep(0.1, 0.3, s) * (1 - sstep(0.75, 0.85, s)),
  utahraptor: (s, sa) => 0.9 * sstep(0.35, 0.7, Math.sin(s * 62)) * sstep(-0.35, 0.15, sa) * sstep(0.12, 0.25, s) * (1 - sstep(0.62, 0.7, s)),
  triceratops: (s, sa) => 0.75 * sstep(0.86, 0.93, s) * sstep(0.45, -0.2, sa), // mặt, má, quanh mỏ vàng nhạt
  dryosaurus: (s, sa) => 0.55 * sstep(0.7, 0.92, sa) + 0.3 * sstep(0.6, 0.9, Math.sin(s * 70)) * sstep(0.2, 0.6, sa),
};

/** Dựng lớp da: một ống đuôi->thân->cổ->đầu, mỗi chân/tay một ống. Gọi ở tư thế gốc. */
function buildSkin(id, S, X, mat) {
  const { torsoG, neck, head, jaw, tail, legs, arms, Lg, H } = X;
  const T = S.torso, lb = new LoftBuilder();
  const spine = [];
  // đuôi (từ chóp vào gốc)
  const tn = tail.length, Tl = S.tail;
  spine.push({ bone: tail[tn - 1], p: [0, 0, Tl.len * 1.05], w: Tl.r1 * 0.35, h: Tl.r1 * 0.45 });
  for (let i = tn - 1; i >= 0; i--) {
    const r = lerp(Tl.r0, Tl.r1, i / tn);
    spine.push({ bone: tail[i], p: [0, 0, 0], w: r, h: r * 1.2 });
  }
  // thân: mặt cắt elip theo dáng thân, bụng xệ nhẹ
  // phía trước thu nhỏ dần về cổ, phía sau về đuôi (vai/hông không thành bậc)
  for (const k of [0.6, 0.35, 0.1, -0.15, -0.4, -0.62]) {
    const z = k * T.a, f = Math.sqrt(1 - k * k) * (k < 0 ? 1 - 0.3 * (-k) : 1 - 0.15 * k);
    const hb = T.hump ? T.hump * Math.exp(-(((k - T.humpAt) / 0.4) ** 2)) : 0; // gù: lưng nhô cao quanh hông
    spine.push({ bone: torsoG, p: [0, -0.06 * T.h * f + T.h * f * hb * 0.55, z], w: T.w * f * 1.04, h: T.h * f * 1.06 * (1 + hb * 0.5) });
  }
  // cổ
  for (let i = 0; i < neck.length; i++) {
    const r = lerp(S.neck.r0, S.neck.r1, i / neck.length);
    spine.push({ bone: neck[i], p: [0, 0, 0], w: r, h: r * 1.12 });
  }
  // đầu: hộp sọ sâu, vuông vức phía sau, thon về mõm; đáy phẳng ở đường miệng (hàm dưới là lớp da riêng bên dưới)
  const mouthY = mouthYOf(H);
  const jz0 = H.jawP[2] + H.jaw[5] + H.jaw[2] * 0.92, jz1 = H.jawP[2] + H.jaw[5] - H.jaw[2]; // hàm dưới theo z của đầu
  const z0 = H.skull[5] + H.skull[2] * 0.8, z1 = H.snout[5] - H.snout[2] * 0.97;
  const HT = [0, 0.09, 0.18, 0.27, 0.36, 0.45, 0.54, 0.63, 0.71, 0.79, 0.86, 0.92, 0.96, 1];
  const prof = HT.map((t) => {
    const z = lerp(z0, z1, t), pr = headProfile(id, H, z);
    const inJaw = z <= jz0 && z >= jz1 - 0.01;
    return { z, t, inJaw, w: pr.w, top: pr.top, bot: inJaw ? Math.max(mouthY, pr.bot) : pr.bot, sq: pr.sq };
  });
  for (let it = 0; it < 3; it++) { // làm mượt (giữ hai đầu)
    const top = prof.map((p) => p.top), w = prof.map((p) => p.w);
    for (let i = 1; i < prof.length - 1; i++) {
      prof[i].top = top[i - 1] * 0.25 + top[i] * 0.5 + top[i + 1] * 0.25;
      prof[i].w = w[i - 1] * 0.25 + w[i] * 0.5 + w[i + 1] * 0.25;
    }
  }
  for (const pr of prof) {
    const top = Math.max(pr.top, pr.bot + H.snout[1] * 0.3 * (1 - pr.t * 0.4));
    spine.push({ bone: head, p: [0, (top + pr.bot) / 2, pr.z], w: Math.max(pr.w, H.snout[0] * 0.14), h: Math.max((top - pr.bot) / 2, H.snout[1] * 0.14),
      sq: pr.sq, flatB: pr.inJaw ? 1 : 0.88, belly: 0.15 }); // đáy hàm trên nằm đúng đường miệng; bụng đầu không sáng màu
  }
  const pat = PATTERN[id] || PATTERN.triceratops;
  const spinePattern = (s01, sa) => [sstep(-0.15, -0.7, sa), pat(s01, sa), sstep(0.55, 1, sa)];
  // Hàng vảy gồ dọc sống lưng (T-rex, Triceratops): nhô ra theo nhịp đều dọc thân, nhỏ dần về chóp đuôi và đầu
  const RIDGE = { tyrannosaurus: 0.07, triceratops: 0.05 };
  const ridge = RIDGE[id] ? (s01) => RIDGE[id] * Math.pow(Math.max(0, Math.sin(s01 * 150)), 6) * sstep(0.04, 0.2, s01) * (1 - sstep(0.62, 0.72, s01)) : null;
  lb.add(spine, { sub: 7, pattern: spinePattern, ridge });
  const total = lb.pos.length ? spineLength(spine) : 1;
  const scaleLen = total * 0.011;
  // Hàm dưới: lớp da riêng bám xương hàm, mép trên phẳng khớp đường miệng, bụng hàm sáng màu
  {
    const [, jh, jl, , jy, jz] = H.jaw;
    const jawRings = [];
    for (const t of [0, 0.15, 0.32, 0.5, 0.66, 0.8, 0.9, 0.96, 1]) {
      const zl = lerp(jz + jl * 0.92, jz - jl * 0.99, t);         // toạ độ trong xương hàm (sau -> cằm)
      const f = Math.sqrt(Math.max(0, 1 - ((zl - jz) / jl) ** 2));
      const up = headProfile(id, H, zl + H.jawP[2]);
      const w = Math.max(up.w * 0.9 * (0.55 + 0.45 * Math.pow(f, 0.35)), H.jaw[0] * 0.2);
      const topY = jy + jh * 0.72, botY = jy - jh * (0.35 + 0.75 * Math.pow(f, 0.6));
      jawRings.push({ bone: jaw, p: [0, (topY + botY) / 2, zl], w, h: Math.max((topY - botY) / 2, jh * 0.2), sq: up.sq * 0.7, flatT: 1, flatB: 1 });
    }
    lb.add(jawRings, { sub: 3, smooth: 1, scaleLen, pattern: (s01, sa) => [sstep(0.25, -0.5, sa), 0, 0] });
  }
  // chân: hông -> đùi -> gối -> cẳng -> cổ chân -> bàn -> ngón (bàn/ngón màu điểm nhấn)
  const L = Lg, tr = L.r * 0.32, toeW = L.r * (S.quad ? 0.95 : 0.6);
  const Rt = Math.max(L.r, L.t * 0.27); // bán kính đùi: loài chân mảnh vẫn có bắp đùi khoẻ
  const fwd = new THREE.Vector3(0, 0, -1);
  for (const l of legs) {
    lb.add([
      // đùi: khối cơ lớn liền vào hông, thon nhanh về gối
      ...(S.quad ? [
        // 4 chân (kiểu voi): cột liền, thon rất từ từ; đầu trên cắm sâu, nở to trong thân => chân mọc liền từ thân
        { bone: l.hip, p: [-l.side * Rt * 0.45, Rt * 1.0, 0], w: Rt * 0.95, h: Rt * 1.35 },
        { bone: l.hip, p: [-l.side * Rt * 0.1, -L.t * 0.15, Rt * 0.05], w: Rt * 0.92, h: Rt * 1.18 },
        { bone: l.hip, p: [0, -L.t * 0.6, 0], w: Rt * 0.9, h: Rt * 1.0 },
        { bone: l.knee, p: [0, 0, 0], w: Rt * 0.82, h: Rt * 0.88 },
        { bone: l.knee, p: [0, -L.s * 0.45, 0], w: Rt * 0.74, h: Rt * 0.8 },
        { bone: l.knee, p: [0, -L.s * 0.85, 0], w: Rt * 0.68, h: Rt * 0.72 },
      ] : [
        // đầu trên nở rộng, nâng cao vào trong hông để đùi liền với thân; thon dần qua gối xuống cẳng
        { bone: l.hip, p: [-l.side * Rt * 0.3, Rt * 0.75, 0], w: Rt * 0.85, h: Rt * 1.25 },
        { bone: l.hip, p: [0, -L.t * 0.22, Rt * 0.08], w: Rt * 0.95, h: Rt * 1.5 },
        { bone: l.hip, p: [0, -L.t * 0.62, 0], w: Rt * 0.72, h: Rt * 0.92 },
        { bone: l.knee, p: [0, 0, 0], w: Math.max(L.r * 0.52, Rt * 0.5), h: Math.max(L.r * 0.62, Rt * 0.58) },
        { bone: l.knee, p: [0, -L.s * 0.3, L.r * 0.06], w: L.r * 0.46, h: L.r * 0.56 },
        { bone: l.knee, p: [0, -L.s * 0.75, 0], w: L.r * 0.34, h: L.r * 0.38 },
      ]),
      { bone: l.ankle, p: [0, 0, 0], w: S.quad ? Rt * 0.66 : L.r * 0.4, h: S.quad ? Rt * 0.7 : L.r * 0.42, acc: S.quad ? 0 : 0.3 },
      ...(S.quad ? [] : [{ bone: l.ankle, p: [0, -(L.f - tr) * 0.8, 0], w: L.r * 0.37, h: L.r * 0.38, acc: 0.8 }]),
      ...(S.quad ? [
        // chân cột kiểu voi: bàn chân tròn to, cao, ngón ngắn bè ra phía trước
        { bone: l.ankle, p: [0, -L.f + tr * 1.5, -L.f * 0.12], w: L.r * 0.62, h: tr * 1.6, acc: 0 },
        { bone: l.ankle, p: [0, -L.f + tr * 0.9, -L.f * 0.42], w: L.r * 0.55, h: tr * 0.9, acc: 0.15 },
      ] : [
        { bone: l.ankle, p: [0, -L.f + tr, -L.f * 0.25], w: toeW, h: tr, acc: 0.8 },
        { bone: l.ankle, p: [0, -L.f + tr * 0.9, -L.f * 0.62], w: toeW * 0.55, h: tr * 0.6, acc: 0.8 },
      ]),
    ], { sub: 3, up: fwd, scaleLen, smooth: 1 });
  }
  for (const a of arms) {
    const A = S.arm;
    lb.add([
      { bone: a.sh, p: [0, A.r * 0.4, 0], w: A.r * 1.25, h: A.r * 1.35 },
      { bone: a.sh, p: [0, -A.up * 0.5, 0], w: A.r, h: A.r * 1.1 },
      { bone: a.el, p: [0, 0, 0], w: A.r * 0.8, h: A.r * 0.85 },
      { bone: a.el, p: [0, -A.fore * 0.6, 0], w: A.r * 0.65, h: A.r * 0.7 },
      { bone: a.el, p: [0, -A.fore, 0], w: A.r * 0.42, h: A.r * 0.38 },
    ], { sub: 3, up: fwd, scaleLen, smooth: 1 });
  }
  mat.skinUniforms.uScale.value = 1 / total;
  return lb.build(X.rig, mat);
}
function spineLength(defs) {
  let d = 0;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 1; i < defs.length; i++) {
    defs[i].bone.localToWorld(v.set(...defs[i].p)); defs[i - 1].bone.localToWorld(w.set(...defs[i - 1].p));
    d += v.distanceTo(w);
  }
  return d;
}

export function createDino(speciesId, colors = null) {
  const id = SPEC[speciesId] ? speciesId : 'tyrannosaurus';
  const S = SPEC[id];
  const bodyLength = (SPECIES[id] || SPECIES.tyrannosaurus).bodyLength;
  const M = getMats(id, S.col);
  const own = []; // geometry riêng của instance, dispose khi huỷ

  const group = new THREE.Group();   // gốc tại chân
  const norm = new THREE.Group();    // co giãn về bodyLength + căn giữa theo Z
  const rig = new THREE.Group();     // xoay/dịch cho dead
  group.add(norm); norm.add(rig);

  const T = S.torso, Lg = S.leg;
  // Chiều cao hông: chân đứng thẳng (góc bàn = 0) nên chạm đất đúng y=0
  const legH = Lg.t * Math.cos(Lg.h) + Lg.s * Math.cos(Lg.h + Lg.k) + Lg.f;
  const hipY = legH;
  const bodyY0 = hipY + S.hipInset * T.h;
  Lg.a = -(Lg.h + Lg.k);
  if (S.quad) Lg.quadFoot = true;

  // Thân: body pivot ở tâm thân (nghiêng được), torsoG để thở
  const body = new THREE.Group(); body.position.y = bodyY0; rig.add(body);
  const torsoG = new THREE.Group(); body.add(torsoG);

  // Chân (không nghiêng theo thân để luôn thẳng đứng xuống đất)
  const legs = [];
  if (S.quad) {
    // Dáng đi 4 chân kiểu "lateral sequence" (như voi/tê giác): sau-trái, trước-trái, sau-phải, trước-phải
    [[-1, Lg.zF, 0.25, true], [1, Lg.zF, 0.75, true], [-1, Lg.zB, 0, false], [1, Lg.zB, 0.5, false]].forEach(([sd, z, off, front]) => {
      const l = makeLeg(rig, Lg, sd * Lg.x, hipY, z, sd); l.off = off; l.front = front; legs.push(l);
    });
  } else {
    [[-1, 0], [1, 0.5]].forEach(([sd, off]) => {
      const l = makeLeg(rig, Lg, sd * Lg.x, hipY, Lg.z, sd); l.off = off; legs.push(l);
    });
  }

  // Cổ + đầu
  const neck = chain(body, S.neck, -1);
  const H = S.head;
  const head = new THREE.Group(); head.position.z = -S.neck.len; neck[neck.length - 1].add(head);
  const jaw = new THREE.Group(); jaw.position.set(...H.jawP); head.add(jaw);
  if (H.beak) {
    // Mỏ quặp như mỏ vẹt (keratin sẫm): mỏ trên cong xuống phủ mỏ dưới
    const [bw, bh, bl, , by, bz] = H.beak;
    const up = hornGeometry(bl * 2.6, bw * 1.7, 0.18, [0.3, 0.2, 0.08], [0.42, 0.3, 0.12], 0.8);
    own.push(up);
    const ub = new THREE.Mesh(up, KERATIN_MAT); ub.position.set(0, by + bh * 0.55, bz + bl * 0.85); ub.rotation.x = -1.95; head.add(ub);
    const lowG = hornGeometry(bl * 1.6, bw * 1.3, 0.0, [0.28, 0.18, 0.07], [0.36, 0.25, 0.1], 0.7);
    own.push(lowG);
    const lb = new THREE.Mesh(lowG, KERATIN_MAT); lb.position.set(0, H.jaw[4] - H.jaw[1] * 0.2, H.jaw[5] - H.jaw[2] * 0.82); lb.rotation.x = -1.35; jaw.add(lb);
  }
  // (hàm dưới giờ là lớp da trong buildSkin)
  const [ex0, ey, ez, er] = H.eye;
  const ex = Math.max(ex0, headProfile(id, H, ez).w * 0.93); // mắt nằm trên mặt bên của đầu (hơi lõm dưới gờ mày)
  // Mắt: tròng hổ phách + con ngươi dọc (bò sát), nằm trong nhóm riêng để chớp mắt (co theo chiều dọc)
  const eyes = [-1, 1].map((sd) => {
    const g = new THREE.Group(); g.position.set(sd * ex, ey, ez); head.add(g);
    ell(g, S.eye ? eyeMat(S.eye) : M.eye, [er, er, er], [0, 0, 0]);
    ell(g, M.dark, [er * 0.28, er * 0.75, er * 0.28], [sd * er * 0.78, 0, -er * 0.12]);
    return g;
  });
  // Lỗ mũi ở đầu mõm, khoang miệng sẫm (thấy khi há)
  { const [sw, sh, sl, , sy, sz] = H.snout;
    for (const sd of [-1, 1]) ell(head, M.dark, [sw * 0.11, sh * 0.08, sl * 0.09], [sd * sw * 0.36, sy + sh * 0.6, sz - sl * 0.8]); }
  { const [jw, jh, jl, , jy, jz] = H.jaw;
    ell(head, M.mouth, [jw * 0.8, jh * 0.16, jl * 0.88], [0, mouthYOf(H) + jh * 0.1, H.jawP[2] + jz]); } // vòm miệng
  // Răng (loài ăn thịt): hàng trên mọc sát mép trong môi trên, hàng dưới lọt vào trong hàng trên khi ngậm
  if (H.up) {
    const myH = mouthYOf(H), sn = H.snout;
    const unit = sn[1] * 0.46;                               // răng dài nhất ~ nửa chiều cao mõm
    const zFront = sn[5] - sn[2] * 0.86, zBack = H.jawP[2] + H.jaw[5] + H.jaw[2] * 0.2;
    const nUp = id === 'tyrannosaurus' ? 11 : 13, nLo = nUp - 1;
    const rr = (k) => 0.82 + 0.3 * ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const upper = [], lower = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < nUp; i++) {
        const k = i / (nUp - 1), z = lerp(zFront, zBack, k);
        const len = unit * (0.45 + 0.55 * Math.sin(PI * Math.min(1, k * 0.9 + 0.12))) * rr(i + side * 7);
        // mọc phía trong mép: ngậm miệng thì môi (da hàm dưới) che gần hết, chỉ lộ khi há — như quan điểm cổ sinh vật học hiện nay
        upper.push({ x: side * headProfile(id, H, z).w * 0.74, y: myH + unit * 0.3, z, len, dir: -1, side });
      }
      for (let i = 0; i < nLo; i++) {
        const k = i / (nLo - 1), zh = lerp(zFront + sn[2] * 0.05, zBack, k);
        const len = unit * 0.85 * (0.45 + 0.55 * Math.sin(PI * Math.min(1, k * 0.9 + 0.12))) * rr(i * 3 + side);
        // toạ độ trong xương hàm
        lower.push({ x: side * headProfile(id, H, zh).w * 0.62, y: myH - H.jawP[1] - unit * 0.3, z: zh - H.jawP[2], len, dir: 1, side });
      }
    }
    const tu = teethGeometry(upper), tl = teethGeometry(lower);
    own.push(tu, tl);
    head.add(new THREE.Mesh(tu, TEETH_MAT)); jaw.add(new THREE.Mesh(tl, TEETH_MAT));
  }
  // Lưỡi trên sàn hàm
  { const [jw, jh, jl, , jy, jz] = H.jaw; ell(jaw, TONGUE_MAT, [jw * 0.42, jh * 0.14, jl * 0.6], [0, jy + jh * 0.12, jz + jl * 0.12]); }
  const headBase = -(S.tilt + S.neck.ang.reduce((a, b) => a + b, 0)) + H.pitch; // giữ đầu nằm ngang

  // Đặc điểm riêng từng loài
  if (id === 'tyrannosaurus') {
    // gờ mày sừng gồ phía trên-trước mắt + mấu sừng nhỏ (lacrimal) như hộp sọ T-rex thật
    for (const sd of [-1, 1]) {
      const pr = headProfile(id, H, -0.48);
      ell(head, M.back, [0.1, 0.045, 0.26], [sd * pr.w * 0.86, H.eye[1] + 0.1, -0.47]);
      spike(head, M.accent, 0.045, 0.08, [sd * pr.w * 0.8, H.eye[1] + 0.13, -0.6], [-1.1, 0, sd * 0.2]);
    }
  }
  let frillMat = null; // vật liệu riêng của mề đay (màu đỉnh: rìa ngả đỏ)
  if (id === 'triceratops') {
    // 2 sừng mày dài cong về trước + sừng mũi ngắn; keratin: chân sẫm -> chóp ngà
    const hornA = hornGeometry(1.65, 0.17, 0.26, [0.12, 0.07, 0.03], [0.8, 0.72, 0.5]);
    const hornN = hornGeometry(0.42, 0.12, 0.14, [0.12, 0.07, 0.03], [0.7, 0.62, 0.42]);
    own.push(hornA, hornN);
    for (const sd of [-1, 1]) {
      const h = new THREE.Mesh(hornA, KERATIN_MAT);
      h.position.set(sd * 0.33, 0.5, -0.56); h.rotation.set(-0.62, 0, -sd * 0.2); head.add(h);
      ell(head, M.back, [0.17, 0.1, 0.19], [sd * 0.33, 0.44, -0.52]); // gốc sừng có da bọc
    }
    const nh = new THREE.Mesh(hornN, KERATIN_MAT); nh.position.set(0, 0.22, -1.55); nh.rotation.x = -0.3; head.add(nh);
    // Mề đay: tấm khiên cong mọc từ sau hộp sọ, ngả ra sau phủ lên cổ; viền gai xương (epoccipital)
    const fr = frillGeometry(1.95, 1.95, 0.85, 0.3); // dựng chéo sau sừng, mép ôm nhẹ // khiên to dựng chéo phía sau đầu, mép phủ qua gáy
    own.push(fr.geo);
    frillMat = M.back.clone(); frillMat.vertexColors = true; frillMat.side = THREE.DoubleSide; frillMat.color.set(0xffffff);
    const frill = new THREE.Mesh(fr.geo, frillMat); frill.position.set(0, 0.34, 0.32); head.add(frill); // gốc sau sừng mày
    const epo = hornGeometry(0.24, 0.12, 0, [0.42, 0.1, 0.04], [0.6, 0.42, 0.14], 0.55); // núm viền: chân đỏ, đỉnh vàng
    own.push(epo);
    fr.rim.forEach((rp, i) => {
      if (i % 1) return;
      const e = new THREE.Mesh(epo, KERATIN_MAT);
      e.position.copy(rp.p).add(frill.position);
      e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rp.dir);
      head.add(e);
    });
  }

  // Đuôi
  const tail = chain(body, S.tail, 1);

  // Tay (loài 2 chân)
  const arms = [];
  if (S.arm) for (const sd of [-1, 1]) arms.push(makeArm(body, M, S.arm, sd));

  if (S.quad) {
    // móng guốc: 3 móng kem bè ra phía trước mỗi bàn chân (như chân voi/tê giác)
    const claw = hornGeometry(Lg.r * 0.42, Lg.r * 0.22, 0.25, [0.32, 0.24, 0.1], [0.62, 0.52, 0.28], 0.7);
    own.push(claw);
    for (const l of legs) for (const k of [-1, 0, 1]) {
      const c = new THREE.Mesh(claw, KERATIN_MAT);
      c.position.set(k * Lg.r * 0.36, -Lg.f + Lg.r * 0.12, -Lg.f * 0.5 - Lg.r * 0.18 * (1 - Math.abs(k) * 0.4));
      c.rotation.set(-1.75, k * 0.35, 0);
      l.ankle.add(c);
    }
  }
  if (id === 'utahraptor') {
    // móng liềm ở chân sau
    for (const l of legs) spike(l.ankle, M.dark, 0.035, 0.2, [0, -Lg.f * 0.8, -0.08], [-2.1, 0, 0]);
    // lông vũ ở cẳng tay (3/bên) và cuối đuôi (4)
    for (const a of arms) {
      [-0.25, 0, 0.25].forEach((yw, i) => feather(a.el, M.accent, 0.5, 0.05, [0, -0.05 - i * 0.09, 0.02], a.side * yw));
    }
    for (const i of [tail.length - 2, tail.length - 1]) {
      for (const sd of [-1, 1]) feather(tail[i], M.accent, 0.5, 0.09, [0, 0.02, S.tail.len * 0.3], sd * 0.6);
    }
  }

  // Dùng chung geometry/material nên dispose chỉ giải phóng geometry riêng
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---------- Trạng thái animation ----------
  const st = {
    t: 0, br: 0, cyc: 0, wag: 0, move: 0, run: 0, sleep: 0, dead: 0, atkT: 0, feed: 0, sip: 0,
    feedT: 0, turn: 0, lean: 0, dropLag: 0, dropLag2: 0, blinkT: 2 + Math.random() * 3, blink: 0, prevP: legs.map(() => 0), prevFeed: 0, prevAtk: 0,
  };
  const herb = (SPECIES[id] || {}).diet === 'herbivore';
  // Độ nặng: T-rex/Triceratops nặng nhiều tấn -> lún sâu mỗi bước, bước chậm và dài; con nhỏ nhanh nhẹn, nảy nhẹ
  const MASS = { tyrannosaurus: 1.35, triceratops: 1.2, utahraptor: 0.75, dryosaurus: 0.55 }[id] || 1;
  const _fw = new THREE.Vector3();
  const sleepLegY = Lg.r * 0.9;
  const events = []; // sự kiện trong khung vừa rồi (bước chân, nhai, nuốt...) để main.js phát âm thanh đúng lúc
  // Vị trí cổ chân lúc đứng nghỉ, so với hông (dùng cho IK)
  const yA0 = -(Lg.t * Math.cos(Lg.h) + Lg.s * Math.cos(Lg.h + Lg.k));
  const zA0 = -(Lg.t * Math.sin(Lg.h) + Lg.s * Math.sin(Lg.h + Lg.k));

  /**
   * IK 2 đốt (đùi + cẳng) trong mặt phẳng dọc: cổ chân cần tới (y, z) so với hông -> góc hông h và gối k.
   * Gối luôn gập về phía trước như chân khủng long (chân sau của chim).
   */
  function legIK(y, z) {
    const t = Lg.t, s2 = Lg.s;
    const d = clamp(Math.hypot(y, z), Math.abs(t - s2) + 1e-3, (t + s2) * 0.9995);
    const al = Math.atan2(-z, -y);
    const be = Math.acos(clamp((t * t + d * d - s2 * s2) / (2 * t * d), -1, 1));
    const ga = Math.acos(clamp((t * t + s2 * s2 - d * d) / (2 * t * s2), -1, 1));
    return { h: al + be, k: -(PI - ga) };
  }
  const ss = (a, b, x) => { const v = clamp((x - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); };
  const frac = (x) => x - Math.floor(x);

  /**
   * anim: trạng thái từ server; speed01: tốc độ 0..1 (dự phòng);
   * motion: { speed (m/s thực), turn (rad/s), accel (đơn vị speed01/s) } để chân bước khớp tốc độ thật, không trượt.
   */
  function update(dt, anim = 'idle', speed01 = 0, motion = null) {
    dt = clamp(dt || 0, 0, 0.1);
    events.length = 0;
    const sp = clamp(speed01 || 0, 0, 1);
    st.t += dt;
    const moving = anim === 'walk' || anim === 'run';
    st.move = damp(st.move, moving ? 1 : 0, 6, dt);
    st.run = damp(st.run, anim === 'run' ? 1 : 0, 4, dt);
    st.sleep = damp(st.sleep, anim === 'sleep' ? 1 : 0, 2.5, dt);
    st.dead = damp(st.dead, anim === 'dead' ? 1 : 0, 4, dt);
    // Ăn (cắn xác/gặm cây) và uống (vục đầu xuống nước): cúi cổ xuống sát đất
    st.feed = damp(st.feed, anim === 'eat' || anim === 'drink' ? 1 : 0, 3.5, dt);
    st.sip = damp(st.sip, anim === 'drink' ? 1 : 0, 4, dt);
    st.turn = damp(st.turn, motion?.turn || 0, 5, dt);
    st.lean = damp(st.lean, clamp((motion?.accel || 0) * 0.22, -0.1, 0.14), 4, dt);
    const { move, run, sleep, dead, feed, sip } = st;
    const live = 1 - dead;
    const idleW = (1 - move) * (1 - sleep) * live * (1 - feed);
    st.br += dt * lerp(1.8, 1.1, sleep);

    // ===== Dáng đi: bàn chân bám đất trong pha chống, nhấc lên trong pha đu; nhịp bước khớp tốc độ thật =====
    const worldScale = Math.max(1e-3, group.scale.x * norm.scale.x);
    const vLocal = motion && Number.isFinite(motion.speed) ? motion.speed / worldScale : sp * legH * 3;
    // Độ dài sải theo công thức Alexander (1976) — dùng để ước tính tốc độ khủng long từ dấu chân hoá thạch:
    //   sải (1 chu kỳ = 2 bước) / chiều cao hông ≈ 2.3 · Fr^0.3, với số Froude Fr = v² / (g · chiều cao hông)
    // => con to bước dài & chậm, con nhỏ bước ngắn & nhanh, đúng cho mọi tốc độ; chân không phải guồng.
    const legHw = legH * worldScale, vW = vLocal * worldScale;
    const Fr = (vW * vW) / (9.8 * Math.max(0.05, legHw));
    const stride = (legHw * clamp(2.3 * Math.pow(Fr, 0.3), 0.9, 3.4)) / worldScale;
    let fc = (vLocal / stride) * move;                           // chu kỳ/giây
    if (move > 0.3) fc = Math.max(fc, 0.3 * move / Math.sqrt(Math.max(0.3, legHw))); // bị chặn: vẫn bước tại chỗ chậm
    st.cyc += dt * fc;
    // Đi hay chạy theo Fr (động vật chuyển sang chạy quanh Fr ~ 0.5-1), không chỉ theo phím chạy
    const runG = motion && Number.isFinite(motion.speed) ? ss(0.4, 1.1, Fr) : run;
    st.runG = damp(st.runG || 0, runG, 4, dt);
    const gr = st.runG;
    const duty = lerp(0.65, 0.38, gr);                           // tỉ lệ thời gian chân chạm đất (chạy có pha bay)
    const stepLen = Math.min(stride * duty, (Lg.t + Lg.s) * 1.1) * move;
    const liftH = legH * lerp(0.12, 0.2, gr) * move;
    const cyc = st.cyc;
    // Lực dậm: ngay sau khi bàn chân chạm đất, thân lún xuống (gối khuỵu hấp thụ lực) rồi đẩy lên lại.
    // Cộng dồn qua các chân => mỗi bước một nhịp "thình" rõ ràng; con nặng lún sâu hơn.
    let drop = 0;
    for (const l of legs) {
      const ph = frac(cyc + l.off);
      if (ph < duty) { const u = ph / duty; drop += Math.sin(PI * Math.min(1, u / 0.45)) * (u < 0.45 ? 1 : 0); }
    }
    drop = Math.min(1, drop) * move * (1 - sleep);
    const bob = -drop * legH * lerp(0.03, 0.045, gr) * MASS * (S.quad ? 0.6 : 1)
      + Math.cos(4 * PI * (cyc - duty / 2)) * move * legH * 0.008 * (1 - sleep); // vồng nhẹ giữa bước
    // Đầu, cổ, đuôi phản ứng trễ (quán tính khối nặng): lọc trễ 2 tầng của lực dậm
    st.dropLag = damp(st.dropLag, drop, 9 / Math.sqrt(MASS), dt);
    st.dropLag2 = damp(st.dropLag2, st.dropLag, 7 / Math.sqrt(MASS), dt);
    // Dồn trọng tâm sang chân đang chống (lắc ngang) và hông xoay theo chân bước tới
    const sway = Math.cos(2 * PI * (cyc - duty / 2)) * move * (S.quad ? 0.02 : 0.07) * (1 - gr * 0.5) * Math.sqrt(MASS);
    const hipYaw = Math.sin(2 * PI * cyc) * move * (S.quad ? 0.025 : 0.06);

    // ===== Tấn công (chu kỳ 0.8s): lấy đà -> lao tới đớp -> giật/lắc xé -> thu về =====
    if (anim === 'attack' || (st.atkT > 0 && st.atkT % 0.8 < 0.7)) st.atkT += dt; else st.atkT = 0;
    const ua = st.atkT > 0 ? (st.atkT % 0.8) / 0.8 : 0;
    const windup = st.atkT > 0 ? ss(0, 0.22, ua) * (1 - ss(0.22, 0.32, ua)) : 0;
    const strike = st.atkT > 0 ? ss(0.2, 0.33, ua) * (1 - ss(0.6, 0.95, ua)) : 0;
    const shakeW = st.atkT > 0 && !herb ? ss(0.34, 0.4, ua) * (1 - ss(0.55, 0.62, ua)) : 0;
    const shake = Math.sin(st.atkT * 38) * shakeW;
    const jawAtk = st.atkT > 0 ? ss(0.04, 0.2, ua) * (1 - ss(0.3, 0.35, ua)) : 0; // há to khi lấy đà, sập hàm lúc đớp
    const toss = herb && st.atkT > 0 ? ss(0.32, 0.48, ua) * (1 - ss(0.6, 0.9, ua)) : 0; // ăn cỏ (sừng): hất đầu lên
    if (st.prevAtk < 0.33 && ua >= 0.33) events.push('snap');
    st.prevAtk = ua;
    const A = S.atk;

    // ===== Ăn / uống: chu kỳ động tác theo kiểu ăn =====
    if (feed > 0.4) st.feedT += dt; else st.feedT = 0;
    let fNeck = 0, fHead = 0, fJaw = 0, fYaw = 0, fJawSide = 0, crouch = 0;
    if (feed > 0.01) {
      if (sip > 0.5) {
        // Uống: vục mõm xuống nước -> ngậm -> ngửa đầu cho nước trôi xuống họng -> lại vục xuống
        const c = frac(st.feedT / 2.3);
        const lift = ss(0.45, 0.62, c) * (1 - ss(0.82, 0.98, c));
        fNeck = 1.35 - lift * 0.75 + Math.sin(st.t * 9) * 0.02 * (1 - lift);
        fHead = -0.15 + lift * 0.75;              // ngửa mõm lên khi nuốt
        fJaw = ss(0.15, 0.3, c) * (1 - ss(0.38, 0.45, c)) * 0.18 + lift * 0.04 * Math.max(0, Math.sin(st.t * 18));
        crouch = 0.2;
        if (st.prevFeed < 0.3 && c >= 0.3) events.push('slurp');
        if (st.prevFeed < 0.7 && c >= 0.7) events.push('gulp');
        st.prevFeed = c;
      } else if (!herb) {
        // Ăn thịt: cúi cắn -> giật ngược ra sau, lắc đầu xé thịt -> ngửa cổ nuốt
        const c = frac(st.feedT / 1.6);
        const bite = ss(0, 0.12, c) * (1 - ss(0.18, 0.24, c));
        const tug = ss(0.22, 0.34, c) * (1 - ss(0.55, 0.65, c));
        const swallow = ss(0.6, 0.72, c) * (1 - ss(0.9, 1, c));
        fNeck = 1.2 + bite * 0.12 - tug * 0.35 - swallow * 0.7;
        fHead = -tug * 0.25 + swallow * 0.55;
        fYaw = Math.sin(st.t * 22) * 0.22 * tug;
        fJaw = bite * 0.95 + swallow * 0.12 * Math.max(0, Math.sin(st.t * 16));
        crouch = 0.12;
        if (st.prevFeed < 0.2 && c >= 0.2) events.push('chew');
        if (st.prevFeed < 0.75 && c >= 0.75) events.push('gulp');
        st.prevFeed = c;
      } else {
        // Ăn cỏ: cúi gặm/ngắt -> ngẩng nhẹ nhai (hàm nghiến ngang) -> lại cúi
        const c = frac(st.feedT / 2.6);
        const crop = ss(0, 0.1, c) * (1 - ss(0.16, 0.24, c));
        const chewing = ss(0.22, 0.3, c) * (1 - ss(0.9, 1, c));
        fNeck = 1.2 + crop * 0.15 - chewing * 0.3;
        fHead = chewing * 0.12;
        fJaw = crop * 0.6 + chewing * (0.12 + 0.12 * Math.sin(st.t * 13));
        fJawSide = chewing * Math.sin(st.t * 6.5) * 0.06;
        crouch = 0.08;
        if (st.prevFeed < 0.17 && c >= 0.17) events.push('crunch');
        if (chewing > 0.5 && Math.sin(st.t * 13) > 0.97 && !st.chewed) { events.push('chew_soft'); st.chewed = true; }
        if (Math.sin(st.t * 13) < 0) st.chewed = false;
        st.prevFeed = c;
      }
    }

    // ===== Thân =====
    const bodyPitchGait = Math.sin(4 * PI * cyc + 0.8) * 0.012 * move;
    body.position.y = lerp(bodyY0, T.h * 1.0, sleep) + bob - windup * legH * 0.05;
    body.position.z = -strike * A.push + windup * A.push * 0.35;
    body.rotation.x = lerp(S.tilt, S.tilt * 0.3, sleep) - strike * A.body + windup * A.body * 0.5 + bodyPitchGait
      - feed * (0.22 + 0.12 * sip) - st.lean * live;
    body.rotation.x += drop * 0.035 * MASS;                        // gật nhẹ theo mỗi cú dậm
    body.rotation.y = hipYaw;
    body.rotation.z = sway;
    const b = Math.sin(st.br) * lerp(0.018, 0.03, sleep) * (1 - 0.5 * move) * live; // thở
    torsoG.scale.set(1 + b * 0.5, 1 + b, 1);

    // ===== Chân: IK tới vị trí bàn chân theo pha bước =====
    const legYik = hipY + bob - windup * legH * 0.05 - crouch * legH * feed;
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      const ph = frac(cyc + l.off);
      let xf, yf, toe;
      if (ph < duty) { // pha chống: bàn chân đứng yên trên đất, thân lướt qua
        const u = ph / duty;
        xf = stepLen * (0.5 - u); yf = 0; toe = ss(0.75, 1, u) * 0.35 * move; // cuối pha: nhón gót đẩy đi
      } else {         // pha đu: nhấc chân, gập gối, đưa ra trước
        const u = (ph - duty) / (1 - duty), sm = u * u * (3 - 2 * u);
        xf = stepLen * (-0.5 + sm); yf = Math.sin(PI * u) * liftH; toe = Math.sin(PI * u) * 0.7 * move;
      }
      if (move > 0.3 && st.prevP[i] > duty && ph < duty) {
        l.ankle.getWorldPosition(_fw);
        events.push({ kind: l.front ? 'step_front' : 'step', x: _fw.x, y: _fw.y, z: _fw.z, run: gr });
      }
      st.prevP[i] = ph;
      // quadruped: chân trước khuỵu thấp hơn khi ăn/uống
      const yHip = legYik + (S.quad ? crouch * legH * feed * (l.front ? 0.4 : 1) : 0); // 4 chân: chỉ chân trước khuỵu nhẹ, cổ dài lo phần còn lại
      const ik = legIK(Lg.f + yf - yHip, zA0 - xf);
      let hipT = ik.h - Lg.h + sleep * 1.0 + dead * 0.35;
      let kneeT = ik.k - Lg.k - sleep * 1.9 - dead * 0.8;
      if (i === 0 && A.kick) { hipT += strike * A.kick; kneeT -= strike * A.kick * 0.4; }
      const ankleT = -(hipT + kneeT) + toe + sleep * 1.5; // bàn chân song song mặt đất, nhón khi đẩy/nhấc
      l.hip.position.y = lerp(yHip, sleepLegY, sleep); // cùng độ cao hông đã dùng cho IK (không thì bàn chân lơ lửng/chui đất)
      l.hip.rotation.x = Lg.h + hipT;
      l.hip.rotation.z = S.quad ? 0 : l.side * 0.07 * move * (1 - sleep) * (1 - dead); // bàn chân đặt gần đường giữa thân
      l.knee.rotation.x = Lg.k + kneeT;
      l.ankle.rotation.x = Lg.a + ankleT;
    }

    // ===== Tay =====
    for (const a of arms) {
      const sw = Math.sin(2 * PI * cyc + (a.side > 0 ? 0 : PI)) * 0.12 * move + st.dropLag2 * 0.25;
      a.sh.rotation.x = S.arm.sh + sw + b * 2 + sleep * 0.3 + strike * (A.arm || 0) - windup * (A.arm || 0) * 0.5;
      a.el.rotation.x = S.arm.el + sw * 0.5 + strike * (A.arm || 0) * 0.4;
    }

    // ===== Cổ + đầu: đầu giữ ổn định khi chạy, quay trước khi quẹo, động tác cắn/ăn/uống =====
    const n = neck.length;
    const atkTot = A.neck * strike + windup * 0.35;
    const tot = atkTot - 0.9 * sleep - 0.4 * dead - bodyPitchGait * 2 + st.lean * live
      - (st.dropLag2 - drop * 0.5) * 0.12 * MASS * live
      + Math.sin(st.t * 0.37) * 0.05 * idleW - fNeck * feed;
    const lookTurn = clamp(st.turn * 0.3, -0.6, 0.6) * live * (1 - sleep);
    const yaw = Math.sin(st.t * 0.5) * 0.35 * idleW + 0.9 * sleep + lookTurn + shake * 0.22 + fYaw * feed;
    for (let i = 0; i < n; i++) {
      neck[i].rotation.x = S.neck.ang[i] + tot / n;
      neck[i].rotation.y = yaw / n;
    }
    head.rotation.x = headBase - atkTot * A.comp - 0.3 * sleep + fHead * feed + toss * 0.7;
    head.rotation.z = shake * 0.12;
    jaw.rotation.x = -S.jaw * (jawAtk + fJaw * feed) - Math.max(0, Math.sin(st.t * 0.6) - 0.85) * 0.25 * idleW - dead * 0.3;
    jaw.rotation.y = fJawSide * feed;

    // Chớp mắt (ngủ/chết thì nhắm)
    st.blinkT -= dt;
    if (st.blinkT <= 0) { st.blink = 0.16; st.blinkT = 2.5 + Math.random() * 4; }
    st.blink = Math.max(0, st.blink - dt);
    const lid = Math.max(st.blink > 0 ? Math.sin((st.blink / 0.16) * PI) : 0, sleep, dead * 0.8);
    for (const e of eyes) e.scale.y = 1 - lid * 0.88;

    // ===== Đuôi: lắc ngược pha với hông khi đi (giữ thăng bằng), văng theo quán tính khi quẹo =====
    const wagAmp = S.tail.wag * (0.45 + 0.3 * run) * live * (1 - move * 0.5);
    st.wag += dt * 1.3;
    for (let i = 0; i < tail.length; i++) {
      const k = (i + 1) / tail.length;
      tail[i].rotation.y = Math.sin(st.wag - i * 0.6) * wagAmp * (0.6 + 0.4 * k)
        + Math.sin(2 * PI * cyc + PI - i * 0.55) * 0.085 * move * k * Math.sqrt(MASS) // đối trọng với hông, trễ dần về chóp đuôi
        - clamp(st.turn * 0.12, -0.25, 0.25) * k * live                 // quẹo: đuôi văng ra ngoài
        + sleep * 0.1;
      tail[i].rotation.x = (i === 0 ? S.tail.base : S.tail.curve)
        + Math.sin(st.wag * 0.7 - i * 0.5) * 0.012 * live + st.dropLag2 * 0.05 * k * MASS
        + sleep * 0.12 + dead * 0.05 + windup * 0.04;
    }

    // Chết: nằm nghiêng 90° quanh Z; xoay quanh tâm thân (không quanh chân) rồi hạ xuống đất
    const th = dead * PI / 2;
    rig.rotation.z = th;
    rig.position.x = bodyY0 * Math.sin(th);
    rig.position.y = lerp(bodyY0, T.w * 1.05, dead) - bodyY0 * Math.cos(th);
  }

  // Lớp da liền mạch, dựng ở tư thế gốc (idle) rồi bám xương
  update(0, 'idle', 0);
  group.updateMatrixWorld(true);
  const skinMat = new SkinMaterial();
  const cs = colors ? { back: colors.body, belly: bellyOf(colors.body), accent: colors.accent } : S.col;
  skinMat.skinUniforms.uBack.value.set(cs.back);
  skinMat.skinUniforms.uBelly.value.set(cs.belly);
  skinMat.skinUniforms.uAccent.value.set(cs.accent);
  if (S.skinScale) skinMat.skinUniforms.uWScale.value = S.skinScale;
  if (S.skinBump) skinMat.skinUniforms.uWBump.value = S.skinBump;
  if (S.blot != null) skinMat.skinUniforms.uBlot.value = S.blot;
  const skin = buildSkin(id, S, { rig, torsoG, neck, head, jaw, tail, legs, arms, Lg, H }, skinMat);
  own.push(skin.geometry);

  // Co giãn đều để chiều dài mũi->đuôi đúng bodyLength, căn giữa theo Z (chân giữ nguyên y=0)
  skin.skeleton.update();
  const box = new THREE.Box3().setFromObject(group, true);
  const sc = bodyLength / (box.max.z - box.min.z);
  norm.scale.setScalar(sc);
  norm.position.z = -((box.max.z + box.min.z) / 2) * sc;

  // Màu riêng (nếu người chơi chọn): nhân bản vật liệu thân/bụng/điểm nhấn và đổi màu
  const freeColors = colors ? recolor(group, [
    { from: M.back, color: colors.body }, { from: M.belly, color: bellyOf(colors.body) }, { from: M.accent, color: colors.accent },
  ]) : null;
  if (colors && frillMat) frillMat.color.set(colors.body).lerp(new THREE.Color(0xffffff), 0.6); // mề đay ngả theo màu thân người chơi chọn
  function dispose() {
    for (const g of own) g.dispose(); own.length = 0; if (freeColors) freeColors();
    skinMat.dispose(); skin.skeleton.dispose(); frillMat?.dispose();
  }

  return { group, update, dispose, events };
}
