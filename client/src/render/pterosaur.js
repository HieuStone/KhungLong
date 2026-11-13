// Thằn lằn cánh Pteranodon procedural (low-poly, cách điệu) dựng từ primitive Three.js.
// Quy ước: mũi hướng -Z, chân đặt y=0, đơn vị mét, chiều dài mũi->đuôi (không tính mào) = SPECIES[id].bodyLength.
// Cánh = xương (cánh tay -> cẳng tay -> ngón bay) + màng da là BufferGeometry cập nhật mỗi frame từ vị trí các khớp.
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
// xương: trục +X dài 1, gốc dày bán kính 1, đầu mảnh dần
const BONE = new THREE.CylinderGeometry(0.3, 1, 1, 6, 1).rotateZ(-PI / 2).translate(0.5, 0, 0);

// Vật liệu dùng chung (không dispose)
let MATS = null;
function getMats() {
  if (!MATS) {
    const m = (c, r = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: r, ...extra });
    MATS = {
      back: m(0x6f8796), belly: m(0xc9d4d0), crest: m(0xe0612a), beak: m(0xe8d28a, 0.6),
      bone: m(0x6b4a32, 0.7), dark: m(0x101010, 0.3),
      // màng cánh: mặt lưng (FrontSide) sẫm, mặt bụng (BackSide) sáng cam nhạt
      dorsal: m(0xa68c72, 0.95, { side: THREE.FrontSide }),
      ventral: m(0xe8b98a, 0.95, { side: THREE.BackSide }),
    };
  }
  return MATS;
}

// ---------- Kích thước (mét, sẽ co đều về bodyLength) ----------
const W = { arm: 0.72, fore: 0.9, fing: 1.6 };            // chiều dài các đoạn cánh
const LEG = { t: 0.45, s: 0.45, f: 0.16, hipY: -0.22 };   // đùi, cẳng, bàn; độ thấp của hông so với tâm thân
const NECK = { n: 4, len: 0.28 };
const NECK_ANG = {
  idle: [0.85, 0.55, -0.45, -0.85],   // S-cong: vươn lên rồi cúi đầu
  fly: [0.04, 0.04, 0, 0],            // duỗi thẳng
  eat: [-0.1, -0.5, -0.45, -0.3],
  sleep: [0.2, -0.5, -0.7, -0.5],
  dead: [0.05, -0.1, -0.1, -0.1],
  atk: [0.1, 0.1, 0, 0],
};

// ---------- Helper dựng mesh ----------
function ell(parent, mat, s, p) {
  const m = new THREE.Mesh(SPHERE, mat);
  m.scale.set(s[0], s[1], s[2]); m.position.set(p[0], p[1], p[2]);
  parent.add(m); return m;
}
// nón: đỉnh chĩa theo rot (mặc định +Y); s = [rộng x, dài, cao z]
function cone(parent, mat, s, p, rot) {
  const m = new THREE.Mesh(CONE, mat);
  m.scale.set(s[0], s[1], s[2]); m.position.set(p[0], p[1], p[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m); return m;
}
// xương theo hướng s*X
function bone(parent, mat, len, r, s) {
  const m = new THREE.Mesh(BONE, mat);
  m.scale.set(len, r, r); if (s < 0) m.rotation.y = PI;
  parent.add(m); return m;
}
// trụ thuôn dọc -Y từ gốc (chi)
function limb(parent, mat, own, len, rTop, rBot) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 6, 1).translate(0, -len / 2, 0);
  own.push(g); const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
// trụ thuôn dọc ±Z từ gốc (đốt cổ/đuôi)
function segMesh(parent, mat, own, len, rBase, rEnd, dirZ) {
  const g = new THREE.CylinderGeometry(rEnd, rBase, len * 1.08, 7, 1).translate(0, len * 0.5, 0);
  g.rotateX(dirZ > 0 ? PI / 2 : -PI / 2);
  own.push(g); const m = new THREE.Mesh(g, mat); parent.add(m); return m;
}
// chuỗi đốt nối tiếp: pivot i đặt ở đầu đốt i-1
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

function makeLeg(body, M, own, x) {
  const hip = new THREE.Group(); hip.position.set(x, LEG.hipY, 0.22); body.add(hip);
  ell(hip, M.back, [0.1, LEG.t * 0.55, 0.1], [0, -LEG.t * 0.45, 0]); // đùi
  const knee = new THREE.Group(); knee.position.y = -LEG.t; hip.add(knee);
  limb(knee, M.back, own, LEG.s, 0.05, 0.035); // cẳng
  const ankle = new THREE.Group(); ankle.position.y = -LEG.s; knee.add(ankle);
  limb(ankle, M.bone, own, LEG.f - 0.03, 0.035, 0.03);
  ell(ankle, M.bone, [0.07, 0.03, 0.15], [0, -LEG.f + 0.03, -0.07]); // bàn chân (đáy chạm y=-f)
  return { hip, knee, ankle, side: Math.sign(x) };
}

export function createPterosaur(speciesId = 'pteranodon', colors = null) {
  const bodyLength = (SPECIES[speciesId] || SPECIES.pteranodon).bodyLength;
  const M = getMats();
  const own = []; // geometry riêng của instance

  const group = new THREE.Group();   // gốc tại chân
  const norm = new THREE.Group();    // co giãn về bodyLength
  const rig = new THREE.Group();
  group.add(norm); norm.add(rig);

  const body = new THREE.Group(); rig.add(body);
  const torsoG = new THREE.Group(); body.add(torsoG);
  ell(torsoG, M.back, [0.3, 0.3, 0.62], [0, 0, 0.08]);
  ell(torsoG, M.belly, [0.26, 0.24, 0.58], [0, -0.1, 0.08]);
  ell(torsoG, M.back, [0.2, 0.2, 0.3], [0, 0.08, -0.38]); // gù vai (cơ bay)

  // Chân
  const legs = [-1, 1].map((sd) => makeLeg(body, M, own, sd * 0.17));

  // Cổ + đầu
  const neck = chain(body, M.back, own, { n: NECK.n, len: NECK.len, r0: 0.16, r1: 0.085, pos: [0, 0.13, -0.5] }, -1);
  const head = new THREE.Group(); head.position.z = -NECK.len; neck[neck.length - 1].add(head);
  ell(head, M.back, [0.12, 0.125, 0.26], [0, 0, -0.1]);                     // hộp sọ
  cone(head, M.beak, [0.085, 1.05, 0.05], [0, -0.01, -0.25], [-PI / 2, 0, 0]); // mỏ trên dài không răng
  const jaw = new THREE.Group(); jaw.position.set(0, -0.06, -0.18); head.add(jaw);
  cone(jaw, M.beak, [0.06, 0.92, 0.035], [0, 0, 0], [-PI / 2, 0, 0]);       // mỏ dưới
  const pouch = ell(jaw, M.belly, [0.06, 0.07, 0.2], [0, -0.03, 0.12]);      // túi họng nhỏ
  for (const sd of [-1, 1]) {
    ell(head, M.dark, [0.032, 0.032, 0.032], [sd * 0.105, 0.035, -0.2]);     // mắt
    ell(head, M.crest, [0.04, 0.025, 0.07], [sd * 0.1, 0.085, -0.2]);        // gờ mày cam
  }
  const crest = new THREE.Group(); crest.position.set(0, 0.07, 0.0); head.add(crest); // mào xương hướng ra sau
  cone(crest, M.crest, [0.028, 0.7, 0.1], [0, 0, 0], [PI / 2 - 0.5, 0, 0]);
  const noseTip = new THREE.Object3D(); noseTip.position.set(0, 0, -1.3); head.add(noseTip);

  // Đuôi ngắn
  const tail = chain(body, M.back, own, { n: 2, len: 0.22, r0: 0.12, r1: 0.03, pos: [0, 0, 0.62] }, 1);
  const tailTip = new THREE.Object3D(); tailTip.position.z = 0.22; tail[tail.length - 1].add(tailTip);

  // Cánh
  const H_PT = (s) => [s * 0.27, -0.03, 0.5]; // điểm bám màng ở hông
  const wings = [-1, 1].map((s) => {
    const mkJ = (parent, x) => {
      const g = new THREE.Group(); g.position.x = x; g.rotation.order = 'YZX'; parent.add(g); return g;
    };
    const sh = new THREE.Group(); sh.position.set(s * 0.26, 0.14, -0.3); sh.rotation.order = 'YZX'; body.add(sh);
    bone(sh, M.bone, W.arm, 0.075, s);
    ell(sh, M.back, [0.15, 0.13, 0.2], [s * 0.05, 0, 0]); // cơ vai
    const el = mkJ(sh, s * W.arm); bone(el, M.bone, W.fore, 0.055, s);
    const wr = mkJ(el, s * W.fore); bone(wr, M.bone, W.fing, 0.042, s);
    ell(wr, M.bone, [0.07, 0.07, 0.07], [0, 0, 0]);       // khớp cổ tay
    cone(wr, M.bone, [0.025, 0.14, 0.025], [0, 0, -0.04], [-PI / 2, 0, 0]); // móng tay
    const tip = new THREE.Object3D(); tip.position.x = s * W.fing; wr.add(tip);
    // Màng da: S,E,W,T,H,P (P = điểm giữa mép sau, lõm vào). Mặt trên = FrontSide (dorsal), mặt dưới = BackSide (ventral)
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(6 * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    const tri = [0, 4, 1, 1, 4, 2, 2, 4, 5, 2, 5, 3]; // S,H,E | E,H,W | W,H,P | W,P,T (hướng lên cho cánh phải)
    if (s < 0) for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
    g.setIndex(tri);
    own.push(g);
    for (const mat of [M.dorsal, M.ventral]) {
      const mm = new THREE.Mesh(g, mat); mm.frustumCulled = false; body.add(mm);
    }
    return { s, sh, el, wr, tip, pos };
  });

  // Dùng chung geometry/material nên dispose chỉ giải phóng geometry riêng
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---------- Cập nhật màng cánh theo vị trí khớp (không gian của body) ----------
  const _v = new THREE.Vector3(), _inv = new THREE.Matrix4();
  const _T = new THREE.Vector3(), _H = new THREE.Vector3(), _W = new THREE.Vector3(), _P = new THREE.Vector3();
  function updateMembranes() {
    body.updateMatrixWorld(true);
    _inv.copy(body.matrixWorld).invert();
    for (const w of wings) {
      const set = (i, v) => w.pos.setXYZ(i, v.x, v.y - 0.01, v.z);
      const get = (o, out) => out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_inv);
      set(0, get(w.sh, _v));
      set(1, get(w.el, _v));
      get(w.wr, _W); set(2, _W);
      get(w.tip, _T); set(3, _T);
      _H.set(...H_PT(w.s)); set(4, _H);
      // điểm giữa mép sau, kéo về phía cổ tay => mép sau lõm (giống màng thật)
      _P.lerpVectors(_T, _H, 0.5).lerp(_W, 0.16); set(5, _P);
      w.pos.needsUpdate = true;
    }
  }

  // ---------- Trạng thái animation ----------
  const st = {
    t: 0, fl: 0, flap: 0, open: 0, move: 0, run: 0, sleep: 0, dead: 0, feed: 0, sip: 0,
    phase: 0, fp: 0, br: 0, atkT: 0,
  };
  const init = { ...st };
  const LEG_REST = { h: 0.5, k: -1.0 };
  const footDrop = (h, k, a) => LEG.t * Math.cos(h) + LEG.s * Math.cos(h + k) + LEG.f * Math.cos(h + k + a);

  function update(dt, anim = 'idle', speed01 = 0) {
    dt = clamp(dt || 0, 0, 0.1);
    const sp = clamp(+speed01 || 0, 0, 1);
    st.t += dt;
    const isFly = anim === 'fly', isGlide = anim === 'glide';
    const moving = anim === 'walk' || anim === 'run';
    const winged = isFly || isGlide || anim === 'dead';
    st.fl = damp(st.fl, isFly || isGlide ? 1 : 0, 3, dt);       // tư thế trên không (chân co, cổ duỗi)
    st.flap = damp(st.flap, isFly ? 1 : 0, 4, dt);               // mức đập cánh
    const openT = winged ? 1 : anim === 'run' ? 0.22 : 0;
    st.open = damp(st.open, openT, openT > st.open ? 4 : 2.2, dt); // cánh xoè / khép dần
    st.move = damp(st.move, moving ? 1 : 0, 6, dt);
    st.run = damp(st.run, anim === 'run' ? 1 : 0, 5, dt);
    st.sleep = damp(st.sleep, anim === 'sleep' ? 1 : 0, 2.5, dt);
    st.dead = damp(st.dead, anim === 'dead' ? 1 : 0, 4, dt);
    st.feed = damp(st.feed, anim === 'eat' || anim === 'drink' ? 1 : 0, 5, dt);
    st.sip = damp(st.sip, anim === 'drink' ? 1 : 0, 5, dt);
    const { fl, flap, open, move, run, sleep, dead, feed, sip } = st;
    const live = 1 - dead;
    const idleW = (1 - move) * (1 - sleep) * live * (1 - feed) * (1 - fl);

    st.phase += dt * lerp(4.2, 7, run) * (0.6 + 0.5 * sp);
    st.fp += dt * 2 * PI * lerp(1.5, 3, sp);   // nhịp đập cánh 1.5-3 Hz
    st.br += dt * lerp(1.8, 1.1, sleep);
    const ph = st.phase;

    // Tấn công: 0.4s đớp (cổ giật tới, mỏ há rồi khép), nghỉ 0.4s rồi lặp nếu còn giữ anim; chạy nốt chu kỳ khi thoát
    if (anim === 'attack' || (st.atkT > 0 && st.atkT % 0.8 < 0.4)) st.atkT += dt; else st.atkT = 0;
    const u = (st.atkT % 0.8) / 0.4;
    const lunge = u < 1 ? Math.sin(PI * u) : 0;
    const jawA = u < 1 ? (u < 0.5 ? Math.sin((u / 0.5) * PI / 2) : Math.max(0, 1 - (u - 0.5) / 0.2)) : 0;

    // ----- Chân -----
    const amp = lerp(0.32, 0.5, run) * (0.55 + 0.45 * sp) * move;
    let drop = 0;
    const legT = legs.map((l) => {
      const off = l.side > 0 ? 0 : PI;
      const sn = Math.sin(ph + off), cs = Math.cos(ph + off);
      let h = LEG_REST.h + sn * amp;
      let k = LEG_REST.k - Math.max(0, cs) * move * 0.8;
      h = lerp(h, -1.3, fl); k = lerp(k, -0.35, fl);                 // bay: co gọn ra sau
      h = lerp(h, 0.85, feed * 0.8); k = lerp(k, -1.6, feed * 0.8);  // ăn/uống: hạ thấp người
      h = lerp(h, 1.45, sleep); k = lerp(k, -2.8, sleep);            // ngủ: ngồi xuống
      h = lerp(h, 1.25, dead); k = lerp(k, -2.3, dead);
      const a = -(h + k) * (1 - fl * 0.6);                           // bàn luôn song song mặt đất (trừ khi bay)
      drop = Math.max(drop, footDrop(h, k, a));
      return { h, k, a };
    });
    legs.forEach((l, i) => {
      l.hip.rotation.set(legT[i].h, 0, -l.side * dead * 0.5);
      l.knee.rotation.x = legT[i].k;
      l.ankle.rotation.x = legT[i].a;
    });

    // ----- Thân -----
    const bob = Math.cos(2 * ph) * move * (0.025 + 0.025 * run);
    const flapBob = -Math.cos(st.fp) * 0.1 * flap;                    // xuống cánh thì thân nhô lên
    body.position.set(0, lerp(drop - LEG.hipY + bob, 0.33, dead) + flapBob, -lunge * 0.35);
    body.rotation.x = lerp(0.04, -0.1, fl) - run * 0.16 - move * 0.04 - lunge * 0.15
      - feed * (0.3 + 0.1 * sip) + sleep * 0.15 + Math.sin(2 * ph + 0.8) * 0.02 * move
      + Math.sin(st.fp - 0.4) * 0.04 * flap;
    body.rotation.z = Math.sin(ph) * 0.06 * move + Math.sin(st.t * 1.1) * 0.015 * (isGlide ? 1 : 0);
    rig.rotation.z = dead * 0.1;
    const b = Math.sin(st.br) * lerp(0.02, 0.03, sleep) * (1 - 0.5 * move) * live; // thở
    torsoG.scale.set(1 + b * 0.5, 1 + b, 1);

    // ----- Cánh -----
    // Gập: cánh tay hướng ra sau, cẳng tay gập về trước, ngón bay gập ngược ra sau (zigzag sát hông)
    // Xoè: duỗi ngang, hơi xuôi ra sau; lướt thì vồng lên (dihedral)
    const shYaw = lerp(1.3, 0.2, open), shZ = lerp(-0.2, 0.1, open) - 0.27 * dead;
    const elYaw = lerp(-2.75, 0.12, open), elZ = lerp(0.5, 0.0, open);
    const wrYaw = lerp(2.85, 0.3, open), wrZ = lerp(0.45, 0.04, open) + 0.04 * dead;
    const sF = Math.sin(st.fp), cF = Math.cos(st.fp);
    const rest = open * (1 - flap) * (isGlide ? 1 : 0);
    const flutter = Math.sin(st.t * 9) * 0.012 * rest;                 // lướt: rung rất nhẹ
    const upW = Math.max(0, cF);                                      // nhịp lên
    for (const w of wings) {
      const s = w.s;
      const fz = flap * 0.5 * sF + flutter;                           // vai: biên độ lớn
      const ez = flap * 0.2 * Math.sin(st.fp - 0.9);                  // khuỷu trễ pha
      const wz = flap * 0.35 * Math.sin(st.fp - 1.6) - flap * 0.35 * upW; // cổ tay trễ pha, gập xuống ở nhịp lên
      w.sh.rotation.set(0, -s * shYaw, s * (shZ + fz));
      w.el.rotation.set(0, -s * (elYaw + flap * 0.18 * upW), s * (elZ + ez));
      w.wr.rotation.set(0, -s * (wrYaw + flap * 0.12 * upW), s * (wrZ + wz));
    }

    // ----- Cổ + đầu -----
    // Cổ: nội suy giữa các tư thế; đớp thì duỗi thẳng giật tới
    const feedBeat = Math.max(0, Math.sin(st.t * 14));
    const sipBeat = Math.sin(st.t * 3);
    const yawLook = Math.sin(st.t * 0.5) * 0.5 * idleW + 3.2 * sleep + 0.3 * dead;
    let sumA = 0;
    for (let i = 0; i < neck.length; i++) {
      let a = NECK_ANG.idle[i];
      a = lerp(a, NECK_ANG.fly[i], fl);
      a = lerp(a, NECK_ANG.eat[i], feed);
      a = lerp(a, NECK_ANG.sleep[i], sleep);
      a = lerp(a, NECK_ANG.dead[i], dead);
      a = lerp(a, NECK_ANG.atk[i], lunge * 0.9);
      a += Math.sin(st.t * 0.37 + i) * 0.03 * idleW;
      a -= feed * (1 - sip) * feedBeat * 0.16 + feed * sip * sipBeat * 0.05; // mổ nhanh / nhấp ngụm
      a += Math.sin(st.fp - 0.3 - i * 0.25) * 0.02 * flap;
      neck[i].rotation.set(a, yawLook / neck.length, 0);
      sumA += a;
    }
    // Đầu giữ nằm ngang rồi chúi thêm theo trạng thái
    const pitch = lerp(-0.1, 0, fl) - feed * (0.95 + 0.15 * sip) - 0.3 * sleep - 0.2 * lunge;
    head.rotation.set(-sumA + pitch, 0, sleep * 0.4);
    // Mỏ dưới: đớp há rộng, ăn há/khép nhanh, uống hé nhẹ
    const jawOpen = jawA * 0.6 + feed * ((1 - sip) * feedBeat * 0.5 + sip * 0.1) + 0.03 + 0.03 * Math.sin(st.t * 2) * idleW + dead * 0.25;
    jaw.rotation.x = -jawOpen;
    const gulp = 1 + Math.max(0, Math.sin(st.t * 2.3)) * 0.12 * idleW + b * 2;
    pouch.scale.set(0.06 * gulp, 0.07 * gulp, 0.2);
    crest.rotation.x = Math.sin(st.t * 1.7) * 0.05 * (1 - dead) * (1 + fl) + 0.02 * feedBeat * feed;

    // ----- Đuôi: ổn định khi bay, vẫy nhẹ khi đi -----
    for (let i = 0; i < tail.length; i++) {
      tail[i].rotation.y = Math.sin(st.t * 1.3 + ph * 0.5 * move - i * 0.6) * (0.05 + 0.1 * move) * (1 - 0.7 * fl) * live;
      tail[i].rotation.x = -0.05 + sleep * 0.15 + Math.sin(st.t * 0.8) * 0.02;
    }

    // Chết: nằm sấp, đã hạ thân ở trên; rig lệch nhẹ cho cảm giác ngã nghiêng
    updateMembranes();
  }

  // Co giãn đều để chiều dài mũi->đuôi (không tính mào) đúng bodyLength. Đo ở tư thế lướt (cổ duỗi thẳng).
  Object.assign(st, { fl: 1, open: 1 });
  update(0, 'glide', 0);
  group.updateMatrixWorld(true);
  const pn = new THREE.Vector3().setFromMatrixPosition(noseTip.matrixWorld);
  const pt = new THREE.Vector3().setFromMatrixPosition(tailTip.matrixWorld);
  const sc = bodyLength / Math.abs(pt.z - pn.z);
  norm.scale.setScalar(sc);
  Object.assign(st, init);
  update(0, 'idle', 0);
  // căn giữa theo Z: tâm đoạn mũi->đuôi tại z=0
  norm.position.z = -((pn.z + pt.z) / 2) * sc;

  // Màu riêng (nếu người chơi chọn): thân, bụng và mào
  const freeColors = colors ? recolor(group, [
    { from: M.back, color: colors.body }, { from: M.belly, color: bellyOf(colors.body) }, { from: M.crest, color: colors.accent },
  ]) : null;
  function dispose() { for (const g of own) g.dispose(); own.length = 0; if (freeColors) freeColors(); }

  return { group, update, dispose };
}
