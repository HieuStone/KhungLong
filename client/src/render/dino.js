// Khủng long procedural (low-poly, cách điệu) dựng từ primitive Three.js.
// Quy ước: mũi hướng -Z, chân đặt y=0, đơn vị mét, chiều dài mũi->đuôi = SPECIES[id].bodyLength.
import * as THREE from 'three';
import { SPECIES } from '@isle/shared';
import { recolor, bellyOf } from './colorize.js';

const { lerp, clamp } = THREE.MathUtils;
const PI = Math.PI;
// làm mượt theo hàm mũ, không phụ thuộc framerate
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Geometry dùng chung giữa mọi instance (không dispose)
const SPHERE = new THREE.SphereGeometry(1, 10, 8);
const CONE = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0); // đáy ở gốc, đỉnh +Y, cao 1

// Vật liệu cache theo loài, dùng chung (không dispose)
const matCache = new Map();
function getMats(id, col) {
  if (!matCache.has(id)) {
    const m = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: r });
    matCache.set(id, {
      back: m(col.back), belly: m(col.belly), accent: m(col.accent),
      tooth: m(0xf3efe0, 0.6), bone: m(0xd9cfae, 0.7), dark: m(0x0e0e0e, 0.3),
    });
  }
  return matCache.get(id);
}

// ---------- Thông số từng loài (mét, tỉ lệ thật; sẽ được co giãn đều về bodyLength) ----------
// skull/snout/jaw = [w,h,l, x,y,z] (nửa kích thước ellipsoid + tâm)
const SPEC = {
  tyrannosaurus: {
    col: { back: 0x5b6b3a, belly: 0x9aa26a, accent: 0x3c4727 },
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
    col: { back: 0xc2662b, belly: 0xe9cf9f, accent: 0x3a2615 },
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
    col: { back: 0x6c7d88, belly: 0xaeb9bd, accent: 0x8b5a48 },
    tilt: 0, hipInset: 0.75, quad: true,
    torso: { a: 2.9, h: 1.35, w: 1.2 },
    leg: { t: 1.0, s: 0.9, f: 0.45, r: 0.46, h: 0.12, k: -0.2, x: 0.8, zF: -1.7, zB: 1.7, knee: 0.35 },
    neck: { n: 2, len: 0.6, r0: 0.85, r1: 0.75, ang: [0.12, -0.3], pos: [0, 0.05, -2.4] },
    tail: { n: 5, len: 0.55, r0: 0.6, r1: 0.1, base: 0.1, curve: 0.04, wag: 0.05, pos: [0, 0.1, 2.4] },
    head: {
      skull: [0.5, 0.5, 0.65, 0, 0, -0.45], snout: [0.3, 0.3, 0.45, 0, -0.1, -1.05],
      beak: [0.13, 0.17, 0.24, 0, -0.2, -1.45],
      jawP: [0, -0.33, -0.2], jaw: [0.2, 0.11, 0.6, 0, -0.04, -0.55],
      eye: [0.44, 0.1, -0.25, 0.08], pitch: -0.12,
    },
    jaw: 0.3, atk: { neck: -0.8, body: 0.1, push: 0.6, comp: 0 },
  },
  dryosaurus: {
    col: { back: 0xb99a5e, belly: 0xe6d6a8, accent: 0x8a6c38 },
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
// trụ thuôn dọc theo -Y từ gốc (chi)
function limb(parent, mat, own, len, rTop, rBot) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 6, 1).translate(0, -len / 2, 0);
  own.push(g); const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
// trụ thuôn dọc ±Z từ gốc (đốt cổ/đuôi); đáy bán kính rBase ở gốc, đầu rEnd ở xa
function segMesh(parent, mat, own, len, rBase, rEnd, dirZ) {
  const g = new THREE.CylinderGeometry(rEnd, rBase, len * 1.08, 7, 1).translate(0, len * 0.5, 0);
  g.rotateX(dirZ > 0 ? PI / 2 : -PI / 2); // +Y -> +Z hoặc -Z
  own.push(g); const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
// chuỗi đốt nối tiếp: pivot i đặt ở đầu đốt i-1 => xoay đốt gốc kéo theo cả chuỗi
function chain(parent, mat, own, C, dirZ) {
  const segs = []; let p = parent;
  for (let i = 0; i < C.n; i++) {
    const piv = new THREE.Group();
    if (i === 0) piv.position.set(C.pos[0], C.pos[1], C.pos[2]); else piv.position.z = dirZ * C.len;
    segMesh(piv, mat, own, C.len, lerp(C.r0, C.r1, i / C.n), lerp(C.r0, C.r1, (i + 1) / C.n), dirZ);
    p.add(piv); p = piv; segs.push(piv);
  }
  return segs;
}
function teethRow(parent, M, T, up) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < T.n; i++) {
      const z = T.n > 1 ? lerp(T.z0, T.z1, i / (T.n - 1)) : T.z0;
      // hàm trên: răng chúc xuống (xoay PI quanh X); hàm dưới: chĩa lên
      spike(parent, M.tooth, T.r, T.len, [side * T.x, T.y, z], up ? [PI, 0, 0] : null);
    }
  }
}

function makeLeg(rig, M, own, L, x, y, z, side) {
  const hip = new THREE.Group(); hip.position.set(x, y, z); rig.add(hip);
  ell(hip, M.back, [L.r, L.t * 0.6, L.r * 1.15], [0, -L.t * 0.48, 0]); // đùi
  const knee = new THREE.Group(); knee.position.y = -L.t; hip.add(knee);
  limb(knee, M.back, own, L.s, L.r * 0.55, L.r * 0.4); // cẳng
  const ankle = new THREE.Group(); ankle.position.y = -L.s; knee.add(ankle);
  const tr = L.r * 0.32;
  limb(ankle, M.accent, own, L.f - tr, L.r * 0.4, L.r * 0.36); // bàn
  ell(ankle, M.accent, [L.r * (L.quadFoot ? 0.95 : 0.6), tr, L.f * 0.4], [0, -L.f + tr, -L.f * 0.3]); // ngón (đáy chạm y=-f)
  return { hip, knee, ankle, side };
}

function makeArm(body, M, own, A, side) {
  const sh = new THREE.Group(); sh.position.set(side * A.pos[0], A.pos[1], A.pos[2]); body.add(sh);
  limb(sh, M.back, own, A.up, A.r, A.r * 0.8);
  const el = new THREE.Group(); el.position.y = -A.up; sh.add(el);
  limb(el, M.back, own, A.fore, A.r * 0.8, A.r * 0.6);
  for (let c = 0; c < A.claws; c++) {
    spike(el, M.bone, A.r * 0.4, A.claw, [(c - (A.claws - 1) / 2) * A.r * 0.9, -A.fore, 0], [PI, 0, 0]);
  }
  return { sh, el, side };
}

// Lông vũ dẹt: nón dẹt chĩa ra sau (+Z), yaw = xoè ngang
function feather(parent, mat, len, w, p, yaw) {
  return spike(parent, mat, w, len, p, [PI / 2, 0, yaw]).scale.set(w, len, w * 0.25);
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
  ell(torsoG, M.back, [T.w, T.h, T.a], [0, 0, 0]);
  ell(torsoG, M.belly, [T.w * 0.9, T.h * 0.8, T.a * 0.96], [0, -T.h * 0.3, 0]); // bụng sáng hơn

  // Chân (không nghiêng theo thân để luôn thẳng đứng xuống đất)
  const legs = [];
  if (S.quad) {
    [[-1, Lg.zF, 0], [1, Lg.zF, PI], [-1, Lg.zB, PI], [1, Lg.zB, 0]].forEach(([sd, z, off]) => {
      const l = makeLeg(rig, M, own, Lg, sd * Lg.x, hipY, z, sd); l.off = off; legs.push(l);
    });
  } else {
    [[-1, 0], [1, PI]].forEach(([sd, off]) => {
      const l = makeLeg(rig, M, own, Lg, sd * Lg.x, hipY, Lg.z, sd); l.off = off; legs.push(l);
    });
  }

  // Cổ + đầu
  const neck = chain(body, M.back, own, S.neck, -1);
  const H = S.head;
  const head = new THREE.Group(); head.position.z = -S.neck.len; neck[neck.length - 1].add(head);
  ell(head, M.back, H.skull.slice(0, 3), H.skull.slice(3));
  ell(head, M.back, H.snout.slice(0, 3), H.snout.slice(3));
  if (H.beak) ell(head, M.bone, H.beak.slice(0, 3), H.beak.slice(3));
  const jaw = new THREE.Group(); jaw.position.set(...H.jawP); head.add(jaw);
  ell(jaw, M.belly, H.jaw.slice(0, 3), H.jaw.slice(3));
  const [ex, ey, ez, er] = H.eye;
  for (const sd of [-1, 1]) ell(head, M.dark, [er, er, er], [sd * ex, ey, ez]);
  if (H.up) { teethRow(head, M, H.up, true); teethRow(jaw, M, H.lo, false); }
  const headBase = -(S.tilt + S.neck.ang.reduce((a, b) => a + b, 0)) + H.pitch; // giữ đầu nằm ngang

  // Đặc điểm riêng từng loài
  if (id === 'tyrannosaurus') {
    for (const sd of [-1, 1]) ell(head, M.accent, [0.12, 0.07, 0.22], [sd * 0.38, 0.36, -0.5]); // gờ mày
  }
  if (id === 'triceratops') {
    // 2 sừng dài trên mắt + 1 sừng ngắn ở mũi
    for (const sd of [-1, 1]) spike(head, M.bone, 0.1, 1.05, [sd * 0.32, 0.34, -0.4], [-1.22, 0, -sd * 0.15]);
    spike(head, M.bone, 0.09, 0.4, [0, 0.17, -1.15], [-0.6, 0, 0]);
    // mề đay: đĩa lớn + viền + gai, nghiêng ra sau
    const frill = new THREE.Group(); frill.position.set(0, 0.4, 0.25); frill.rotation.x = 0.3; head.add(frill);
    ell(frill, M.back, [1.25, 1.15, 0.09], [0, 0, 0]);
    ell(frill, M.accent, [1.4, 1.28, 0.06], [0, 0, 0.07]);
    for (let i = 0; i < 5; i++) {
      const al = lerp(-1.0, 1.0, i / 4);
      spike(frill, M.bone, 0.1, 0.3, [Math.sin(al) * 1.38, Math.cos(al) * 1.25, 0.05], [0, 0, -al]);
    }
  }
  if (id === 'utahraptor') {
    // sọc tối trên thân
    for (const z of [-0.45, -0.05, 0.35]) {
      const f = Math.sqrt(1 - (z / T.a) ** 2);
      ell(torsoG, M.accent, [T.w * f * 1.07, T.h * f * 1.07, 0.06], [0, 0, z]);
    }
  }

  // Đuôi
  const tail = chain(body, M.back, own, S.tail, 1);

  // Tay (loài 2 chân)
  const arms = [];
  if (S.arm) for (const sd of [-1, 1]) arms.push(makeArm(body, M, own, S.arm, sd));

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
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---------- Trạng thái animation ----------
  const st = { t: 0, br: 0, phase: 0, wag: 0, move: 0, run: 0, sleep: 0, dead: 0, atkT: 0, feed: 0, sip: 0 };
  const legScale = Math.sqrt(1.5 / legH); // chân dài => nhịp chậm hơn
  const sleepLegY = Lg.r * 0.9;

  function update(dt, anim = 'idle', speed01 = 0) {
    dt = clamp(dt || 0, 0, 0.1);
    const sp = clamp(speed01 || 0, 0, 1);
    st.t += dt;
    const moving = anim === 'walk' || anim === 'run';
    st.move = damp(st.move, moving ? 1 : 0, 6, dt);
    st.run = damp(st.run, anim === 'run' ? 1 : 0, 5, dt);
    st.sleep = damp(st.sleep, anim === 'sleep' ? 1 : 0, 2.5, dt);
    st.dead = damp(st.dead, anim === 'dead' ? 1 : 0, 4, dt);
    // Ăn (cắn xác/gặm cây) và uống (vục đầu xuống nước): cúi cổ xuống sát đất
    st.feed = damp(st.feed, anim === 'eat' || anim === 'drink' ? 1 : 0, 5, dt);
    st.sip = damp(st.sip, anim === 'drink' ? 1 : 0, 5, dt);
    const { move, run, sleep, dead, feed, sip } = st;
    const live = 1 - dead;
    const idleW = (1 - move) * (1 - sleep) * live * (1 - feed);

    const freq = lerp(5, 8.5, run) * (0.6 + 0.5 * sp) * legScale;
    st.phase += dt * freq;
    st.wag += dt * (1.3 + move * freq * 0.45);
    st.br += dt * lerp(1.8, 1.1, sleep);

    // Tấn công: 0.4s lao tới + há/ngậm hàm, nghỉ 0.4s rồi lặp nếu còn giữ anim; chạy nốt chu kỳ khi thoát
    if (anim === 'attack' || (st.atkT > 0 && st.atkT % 0.8 < 0.4)) st.atkT += dt; else st.atkT = 0;
    const u = (st.atkT % 0.8) / 0.4;
    const lunge = u < 1 ? Math.sin(PI * u) : 0;
    const jawA = u < 1 ? (u < 0.5 ? Math.sin((u / 0.5) * PI / 2) : Math.max(0, 1 - (u - 0.5) / 0.2)) : 0;
    const A = S.atk;

    const ph = st.phase;
    const amp = lerp(0.32, 0.55, run) * (0.55 + 0.45 * sp) * move;
    const bob = Math.cos(2 * ph) * move * legH * (0.012 + 0.012 * run) * (1 - sleep);

    // Thân: nhấp nhô, nghiêng, hạ sát đất khi ngủ
    const pitchOsc = Math.sin(2 * ph + 0.8) * 0.015 * move;
    body.position.y = lerp(bodyY0, T.h * 1.0, sleep) + bob;
    body.position.z = -lunge * A.push;
    body.rotation.x = lerp(S.tilt, S.tilt * 0.3, sleep) - lunge * A.body + pitchOsc - feed * (0.28 + 0.12 * sip);
    body.rotation.y = Math.sin(ph) * 0.04 * move;
    body.rotation.z = Math.sin(ph) * 0.03 * move;
    const b = Math.sin(st.br) * lerp(0.018, 0.03, sleep) * (1 - 0.5 * move) * live; // thở
    torsoG.scale.set(1 + b * 0.5, 1 + b, 1);

    // Chân: sin lệch pha; gối gập khi nhấc chân; bàn bù góc để luôn song song mặt đất
    const legY = lerp(hipY, sleepLegY, sleep) + bob;
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      const sn = Math.sin(ph + l.off), cs = Math.cos(ph + l.off);
      const hipD = sn * amp;
      const lift = Math.max(0, cs) * move;
      let kneeD = -lift * Lg.knee * (0.6 + 0.4 * run) - Math.max(0, -hipD) * 0.25;
      let hipT = hipD + sleep * 1.0 + dead * 0.35;
      let kneeT = kneeD - sleep * 1.9 - dead * 0.8;
      if (i === 0 && A.kick) { hipT += lunge * A.kick; kneeT -= lunge * A.kick * 0.4; }
      const ankleT = -(hipT + kneeT) + sleep * 1.5; // ngủ: bàn duỗi ngang về trước
      l.hip.position.y = legY;
      l.hip.rotation.x = Lg.h + hipT;
      l.knee.rotation.x = Lg.k + kneeT;
      l.ankle.rotation.x = Lg.a + ankleT;
    }

    // Tay
    for (const a of arms) {
      const sw = Math.sin(ph + (a.side > 0 ? 0 : PI)) * 0.12 * move;
      a.sh.rotation.x = S.arm.sh + sw + b * 2 + sleep * 0.3 + lunge * (A.arm || 0);
      a.el.rotation.x = S.arm.el + sw * 0.5 + lunge * (A.arm || 0) * 0.4;
    }

    // Cổ: lao tới khi cắn, gục khi ngủ/chết, quay chậm khi idle; đầu giữ ngang
    const n = neck.length;
    const atkTot = A.neck * lunge;
    // Ăn: giật đầu cắn nhịp nhanh; uống: vục xuống sâu hơn rồi nhấp nhẹ từng ngụm
    const feedRate = lerp(7, 3, sip);
    const feedDown = feed * (1.15 + 0.5 * sip) + Math.sin(st.t * feedRate) * lerp(0.2, 0.1, sip) * feed;
    const tot = atkTot - 0.9 * sleep - 0.4 * dead - pitchOsc * 2 + Math.sin(st.t * 0.37) * 0.05 * idleW - feedDown;
    const yaw = Math.sin(st.t * 0.5) * 0.35 * idleW + 0.9 * sleep;
    for (let i = 0; i < n; i++) {
      neck[i].rotation.x = S.neck.ang[i] + tot / n;
      neck[i].rotation.y = yaw / n;
    }
    head.rotation.x = headBase - atkTot * A.comp - 0.3 * sleep;
    // Hàm: ăn thì há/ngậm mạnh theo nhịp cắn; uống thì hé nhẹ
    const jawFeed = feed * ((1 - sip) * Math.max(0, Math.sin(st.t * 7 + 1.3)) * 0.95 + sip * 0.12);
    jaw.rotation.x = -S.jaw * (jawA + jawFeed) - (0.05 + 0.04 * Math.sin(st.t * 2)) * idleW - dead * 0.3;

    // Đuôi: sóng sin dọc các đốt, đốt càng xa càng trễ pha
    const wagAmp = S.tail.wag * (0.45 + 0.8 * move + 0.3 * run) * live;
    for (let i = 0; i < tail.length; i++) {
      tail[i].rotation.y = Math.sin(st.wag - i * 0.6) * wagAmp * (0.6 + 0.4 * i / tail.length) + sleep * 0.1;
      tail[i].rotation.x = (i === 0 ? S.tail.base : S.tail.curve)
        + Math.sin(st.wag * 0.7 - i * 0.5) * 0.012 * live + sleep * 0.12 + dead * 0.05;
    }

    // Chết: nằm nghiêng 90° quanh Z; xoay quanh tâm thân (không quanh chân) rồi hạ xuống đất
    const th = dead * PI / 2;
    rig.rotation.z = th;
    rig.position.x = bodyY0 * Math.sin(th);
    rig.position.y = lerp(bodyY0, T.w * 1.05, dead) - bodyY0 * Math.cos(th);
  }

  // Co giãn đều để chiều dài mũi->đuôi đúng bodyLength, căn giữa theo Z (chân giữ nguyên y=0)
  update(0, 'idle', 0);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group, true);
  const sc = bodyLength / (box.max.z - box.min.z);
  norm.scale.setScalar(sc);
  norm.position.z = -((box.max.z + box.min.z) / 2) * sc;

  // Màu riêng (nếu người chơi chọn): nhân bản vật liệu thân/bụng/điểm nhấn và đổi màu
  const freeColors = colors ? recolor(group, [
    { from: M.back, color: colors.body }, { from: M.belly, color: bellyOf(colors.body) }, { from: M.accent, color: colors.accent },
  ]) : null;
  function dispose() { for (const g of own) g.dispose(); own.length = 0; if (freeColors) freeColors(); }

  return { group, update, dispose };
}
