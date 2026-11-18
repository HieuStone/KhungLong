// Con mồi NPC procedural (gà, thỏ, chuột, chim) dựng từ primitive Three.js, cùng phong cách dino.js.
// Quy ước: mũi hướng -Z, chân đặt y=0, đơn vị mét, chiều dài mũi->đuôi ~ NPC_KINDS[kind].bodyLength.
// Mỗi con dựng theo "đơn vị thiết kế" (dài ~1) rồi co giãn đều bằng nhóm `root` bên trong group.
import * as THREE from 'three';
import { NPC_KINDS } from '@isle/shared';

const { lerp, clamp } = THREE.MathUtils;
const PI = Math.PI;
const sin = Math.sin, cos = Math.cos, abs = Math.abs;
// làm mượt theo hàm mũ, không phụ thuộc framerate
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// Geometry dùng chung giữa mọi instance (không dispose)
const SPHERE = new THREE.SphereGeometry(1, 9, 7);
const CONE = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);        // đáy ở gốc, đỉnh +Y, cao 1
const CYL = new THREE.CylinderGeometry(1, 0.8, 1, 6, 1).translate(0, -0.5, 0); // trụ treo xuống -Y từ gốc
const CYLZ = new THREE.CylinderGeometry(1, 0.7, 1, 5, 1).rotateX(PI / 2).translate(0, 0, 0.5); // trụ nằm +Z từ gốc

// Vật liệu cache theo loài, dùng chung (không dispose)
const matCache = new Map();
const COLORS = {
  chicken: { body: 0xefe6d2, wing: 0xc1935f, tail: 0x6b4a30, red: 0xd2292b, beak: 0xf2b630, leg: 0xe2a92a },
  rabbit:  { body: 0xb9a48c, belly: 0xf1ebe0, ear: 0xe8b5b0, nose: 0xe58f98, leg: 0xa8927a },
  mouse:   { body: 0x8b8379, pink: 0xe6a5a8, leg: 0xc99f9c, tail: 0xd9a9a4 },
  bird:    { body: 0x2f86d6, wing: 0x1f5fa8, belly: 0xf6ecce, beak: 0xf19a1c, leg: 0xc77b1a },
  lizard:  { body: 0x6b7438, belly: 0xc4b98a, stripe: 0x3c4220, leg: 0x5d6531 },
  turtle:  { shell: 0x4f4128, rim: 0x7a6640, scute: 0x3a2f1c, skin: 0x7b8456, belly: 0xb9a676 },
  boar:    { body: 0x4b3b2d, mane: 0x2a2019, snout: 0x7d5f52, tusk: 0xe6dcc4, hoof: 0x1d1712 },
};
function getMats(kind) {
  if (!matCache.has(kind)) {
    const out = {};
    for (const [k, c] of Object.entries(COLORS[kind])) out[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 });
    out.dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.15 }); // mắt bóng
    matCache.set(kind, out);
  }
  return matCache.get(kind);
}

// ---------- Helper dựng mesh ----------
function ell(parent, mat, s, p) {
  const m = new THREE.Mesh(SPHERE, mat);
  m.scale.set(s[0], s[1], s[2]); m.position.set(p[0], p[1], p[2]);
  parent.add(m); return m;
}
// nón: bán kính đáy r, cao len; rot = euler [x,y,z] (đỉnh mặc định +Y; xoay x=-PI/2 => chĩa -Z)
function cone(parent, mat, r, len, p, rot) {
  const m = new THREE.Mesh(CONE, mat);
  m.scale.set(r, len, r); m.position.set(p[0], p[1], p[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m); return m;
}
const limb = (parent, mat, r, len, p = [0, 0, 0]) => {
  const m = new THREE.Mesh(CYL, mat); m.scale.set(r, len, r); m.position.set(p[0], p[1], p[2]); parent.add(m); return m;
};
const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

// ---------- Từng loài: trả { body, len, deadY, flip, tick(S) } ----------
// S = { t, ph (pha bước chân), fl (pha vỗ cánh), sp, w: {idle,walk,run,fly,dead} }

function buildChicken(M) {
  const B = new THREE.Group();
  ell(B, M.body, [0.24, 0.22, 0.3], [0, 0.4, 0.04]); // thân
  const head = pivot(B, 0, 0.5, -0.22);
  ell(head, M.body, [0.1, 0.14, 0.1], [0, 0.1, -0.02]); // cổ
  ell(head, M.body, [0.085, 0.085, 0.09], [0, 0.2, -0.07]);
  cone(head, M.beak, 0.04, 0.1, [0, 0.2, -0.14], [-PI / 2, 0, 0]);
  ell(head, M.red, [0.02, 0.05, 0.07], [0, 0.28, -0.07]); // mào
  ell(head, M.red, [0.022, 0.045, 0.022], [0, 0.13, -0.15]); // yếm
  for (const s of [-1, 1]) ell(head, M.dark, [0.015, 0.015, 0.015], [s * 0.072, 0.22, -0.1]);
  const wings = [-1, 1].map((s) => {
    const p = pivot(B, s * 0.23, 0.5, 0.04); p.userData.s = s;
    ell(p, M.wing, [0.04, 0.15, 0.22], [s * 0.025, -0.1, 0.02]); return p;
  });
  const tails = [-1, 0, 1].map((s) => {
    const p = pivot(B, s * 0.05, 0.5, 0.3); p.userData.s = s;
    cone(p, M.tail, 0.05, 0.28, [0, 0, 0], [0.85, 0, -s * 0.35]); return p;
  });
  const legs = [-1, 1].map((s) => {
    const h = pivot(B, s * 0.09, 0.24, 0.04); h.userData.s = s;
    ell(h, M.body, [0.07, 0.1, 0.09], [0, -0.02, 0]);
    limb(h, M.leg, 0.018, 0.23);
    ell(h, M.leg, [0.04, 0.012, 0.07], [0, -0.228, -0.04]); return h;
  });
  return {
    body: B, len: 0.96, deadY: 0.27, flip: PI / 2,
    tick({ t, ph, w, sp }) {
      const gait = w.walk + w.run;
      const amp = w.walk * 0.55 + w.run * 1.0;
      for (const l of legs) l.rotation.x = sin(ph + (l.userData.s > 0 ? PI : 0)) * amp + w.dead * 1.1;
      for (const l of legs) l.scale.y = 1 - w.dead * 0.45;
      // mổ đất khi idle: gật đầu xuống theo nhịp; đi: đầu đẩy tới-lui theo bước
      const peck = Math.max(0, sin(t * 3.2)) ** 3 * (0.5 + 0.5 * sin(t * 0.7));
      head.rotation.x = -peck * 1.1 * w.idle + sin(ph * 2) * 0.1 * gait - w.run * 0.25 + w.dead * 0.5;
      head.position.z = -0.22 + sin(ph) * 0.035 * gait - peck * 0.05 * w.idle;
      head.position.y = 0.5 - peck * 0.17 * w.idle;
      B.position.y = abs(sin(ph)) * (0.012 * w.walk + 0.035 * w.run) + w.dead * 0.27;
      B.rotation.x = -0.12 * w.run;
      B.rotation.z = w.dead * (PI / 2);
      // cánh gấp; chạy thì vỗ hờ
      for (const p of wings) {
        const s = p.userData.s;
        p.rotation.z = s * (0.1 + w.run * (0.55 + 0.45 * sin(t * 32)));
      }
      for (const p of tails) p.rotation.y = p.userData.s * 0.08 + sin(t * 2.5) * 0.03 * w.idle + sin(ph) * 0.05 * gait;
    },
  };
}

function buildRabbit(M) {
  const B = new THREE.Group();
  ell(B, M.body, [0.19, 0.2, 0.3], [0, 0.28, 0.04]);
  ell(B, M.belly, [0.15, 0.1, 0.24], [0, 0.2, 0]);
  ell(B, M.belly, [0.075, 0.075, 0.075], [0, 0.31, 0.37]); // đuôi bông
  const head = pivot(B, 0, 0.38, -0.22);
  ell(head, M.body, [0.11, 0.11, 0.14], [0, 0.04, -0.1]);
  const nose = ell(head, M.nose, [0.025, 0.02, 0.02], [0, 0.04, -0.235]);
  for (const s of [-1, 1]) ell(head, M.dark, [0.022, 0.022, 0.022], [s * 0.085, 0.08, -0.12]);
  const ears = [-1, 1].map((s) => {
    const p = pivot(head, s * 0.05, 0.12, -0.05); p.userData.s = s;
    ell(p, M.body, [0.035, 0.18, 0.016], [0, 0.17, 0]);
    ell(p, M.ear, [0.02, 0.13, 0.01], [0, 0.17, -0.012]); return p;
  });
  const hind = [-1, 1].map((s) => {
    const p = pivot(B, s * 0.15, 0.26, 0.17); p.userData.s = s;
    ell(p, M.body, [0.1, 0.16, 0.17], [0, -0.02, 0]);
    ell(p, M.leg, [0.045, 0.03, 0.14], [0, -0.23, -0.06]); return p;
  });
  const front = [-1, 1].map((s) => {
    const p = pivot(B, s * 0.07, 0.2, -0.18); p.userData.s = s;
    limb(p, M.leg, 0.03, 0.2); return p;
  });
  return {
    body: B, len: 0.92, deadY: 0.22, flip: PI / 2,
    tick({ t, ph, w }) {
      const hp = ph * 0.6, h = abs(sin(hp)), gait = w.walk + w.run;
      // chạy = nhảy: thân vòng cung lên xuống, chân sau đạp, tai ép ra sau
      B.position.y = h * 0.24 * w.run + h * 0.02 * w.walk + w.dead * 0.22;
      B.rotation.x = cos(hp) * (sin(hp) >= 0 ? 1 : -1) * 0.38 * w.run + 0.0 * w.walk;
      B.rotation.z = w.dead * (PI / 2);
      for (const p of hind) {
        const walkX = sin(ph + (p.userData.s > 0 ? PI : 0)) * 0.45 * w.walk;
        p.rotation.x = lerp(0.5, -0.9, h) * w.run + walkX + w.dead * 0.9;
      }
      for (const p of front) {
        const walkX = sin(ph + (p.userData.s > 0 ? 0 : PI)) * 0.45 * w.walk;
        p.rotation.x = lerp(-0.6, 0.8, h) * w.run + walkX + w.dead * 0.8;
      }
      // idle: mũi giật, tai vểnh và xoay
      const tw = sin(t * 22) * 0.5 + 0.5;
      nose.scale.set(0.025 * (1 + tw * 0.4 * w.idle), 0.02 * (1 + tw * 0.4 * w.idle), 0.02);
      head.rotation.x = sin(t * 11) * 0.03 * w.idle + w.run * 0.12 * sin(hp) - w.run * 0.1 + w.dead * 0.3;
      for (const e of ears) {
        const s = e.userData.s;
        const up = 0.1 + sin(t * 0.9 + s) * 0.08 * w.idle;
        e.rotation.x = lerp(up, 1.25, w.run) + w.walk * 0.15 + w.dead * 0.8;
        e.rotation.z = s * (0.18 + sin(t * 1.3 + s * 2) * 0.25 * w.idle) * (1 - w.run * 0.8);
      }
    },
  };
}

function buildMouse(M) {
  const B = new THREE.Group();
  ell(B, M.body, [0.1, 0.1, 0.2], [0, 0.11, 0.04]);
  const head = pivot(B, 0, 0.11, -0.15);
  ell(head, M.body, [0.065, 0.065, 0.1], [0, 0, -0.07]);
  cone(head, M.body, 0.045, 0.1, [0, -0.005, -0.13], [-PI / 2, 0, 0]);
  ell(head, M.pink, [0.02, 0.018, 0.018], [0, -0.005, -0.235]);
  for (const s of [-1, 1]) {
    ell(head, M.dark, [0.015, 0.015, 0.015], [s * 0.05, 0.025, -0.1]);
    const ear = ell(head, M.pink, [0.05, 0.05, 0.012], [s * 0.052, 0.06, -0.03]); ear.rotation.y = s * 0.55;
    for (const a of [-0.2, 0.2]) { // ria mép
      const wh = limb(head, M.leg, 0.004, 0.11, [s * 0.03, -0.01, -0.17]);
      wh.rotation.set(0, a + (s > 0 ? -0.35 : 0.35), s * (PI / 2));
    }
  }
  const legs = [];
  for (const s of [-1, 1]) for (const z of [-0.06, 0.12]) {
    const p = pivot(B, s * 0.07, 0.07, z); p.userData.k = (s > 0 ? 1 : 0) + (z > 0 ? 1 : 0);
    limb(p, M.leg, 0.022, 0.07); legs.push(p);
  }
  // đuôi dài mảnh: chuỗi 4 đốt, mỗi pivot đặt ở đầu đốt trước
  const tail = []; let par = pivot(B, 0, 0.09, 0.23);
  for (let i = 0; i < 4; i++) {
    if (i > 0) par = pivot(par, 0, 0, 0.09);
    const m = new THREE.Mesh(CYLZ, M.tail);
    m.scale.set(lerp(0.017, 0.007, i / 3), lerp(0.017, 0.007, i / 3), 0.095); par.add(m); tail.push(par);
  }
  return {
    body: B, len: 0.97, deadY: 0.22, flip: PI,
    tick({ t, ph, w }) {
      const gait = w.walk + w.run;
      for (const l of legs) l.rotation.x = sin(ph * 1.3 + l.userData.k * PI * 0.5) * (0.6 * w.walk + 0.9 * w.run) + w.dead * 1.0;
      for (const l of legs) l.scale.y = 1 - w.dead * 0.4;
      B.position.y = abs(sin(ph * 1.3)) * 0.015 * gait + w.dead * 0.22;
      B.position.x = sin(t * 38) * 0.004 * w.idle; // rung nhẹ khi ngửi
      B.rotation.z = w.dead * PI;
      B.rotation.x = -0.06 * w.run;
      head.rotation.x = sin(t * 14) * 0.08 * w.idle + sin(t * 2.2) * 0.12 * w.idle;
      head.rotation.y = sin(t * 1.4) * 0.25 * w.idle;
      tail[0].rotation.x = 0.25 * (1 - w.run * 0.7) - w.run * 0.15;
      tail.forEach((p, i) => { p.rotation.y = sin(ph * 1.3 - i * 0.8) * (0.15 * w.walk + 0.4 * w.run) + sin(t * 2 - i * 0.7) * 0.3 * w.idle; });
    },
  };
}

function buildBird(M) {
  const B = new THREE.Group();
  ell(B, M.body, [0.13, 0.13, 0.25], [0, 0.3, 0.02]);
  ell(B, M.belly, [0.11, 0.08, 0.2], [0, 0.24, -0.03]);
  const head = pivot(B, 0, 0.38, -0.2);
  ell(head, M.body, [0.095, 0.095, 0.1], [0, 0.05, -0.06]);
  cone(head, M.beak, 0.032, 0.1, [0, 0.04, -0.15], [-PI / 2, 0, 0]);
  for (const s of [-1, 1]) ell(head, M.dark, [0.018, 0.018, 0.018], [s * 0.078, 0.08, -0.08]);
  const wings = [-1, 1].map((s) => {
    const p = pivot(B, s * 0.1, 0.34, -0.04); p.userData.s = s;
    ell(p, M.wing, [0.17, 0.022, 0.1], [s * 0.17, 0, 0.04]); return p;
  });
  const tails = [-1, 0, 1].map((s) => {
    const p = pivot(B, 0, 0.3, 0.24); p.userData.s = s;
    p.rotation.y = s * 0.28;
    ell(p, M.wing, [0.04, 0.012, 0.14], [0, 0, 0.13]); return p;
  });
  const legs = [-1, 1].map((s) => {
    const h = pivot(B, s * 0.05, 0.2, 0); h.userData.s = s;
    limb(h, M.leg, 0.012, 0.2);
    ell(h, M.leg, [0.025, 0.01, 0.04], [0, -0.2, -0.02]); return h;
  });
  return {
    body: B, len: 0.96, deadY: 0.14, flip: PI / 2,
    tick({ t, ph, fl, w }) {
      const gait = w.walk + w.run, fly = w.fly;
      // nhún nhảy trên 2 chân; idle thỉnh thoảng nhảy nhẹ
      const hop = Math.max(0, sin(t * 2.3)) ** 10 * 0.04 * w.idle;
      B.position.y = abs(sin(ph * 0.9)) * (0.04 * w.walk + 0.07 * w.run) + hop + w.dead * 0.14;
      B.rotation.x = -0.06 * gait - 0.28 * fly + (1 - w.dead) * 0.0;
      B.rotation.z = w.dead * (PI / 2);
      for (const l of legs) {
        l.rotation.x = sin(ph * 0.9 + (l.userData.s > 0 ? 0.6 : 0)) * 0.35 * gait + (-1.4) * fly + w.dead * 0.9;
        l.scale.y = 1 - 0.5 * fly - 0.4 * w.dead;
      }
      // nghiêng đầu khi idle
      head.rotation.z = (Math.floor(t * 0.5) % 2 ? 1 : -1) * 0.38 * w.idle * (0.5 + 0.5 * sin(t * 2.2));
      head.rotation.y = sin(t * 1.7) * 0.5 * w.idle;
      head.rotation.x = sin(ph * 0.9 * 2) * 0.1 * gait + 0.25 * fly;
      // cánh: gấp (rủ xuống, ngắn) / xoè khi bay (vỗ lên xuống biên độ lớn) / xoè phẳng khi chết
      const spread = Math.max(fly, w.dead);
      for (const p of wings) {
        const s = p.userData.s;
        const flap = sin(fl) * 1.0 + 0.1;
        const th = lerp(-1.25, 0, spread);
        p.rotation.z = s * (th + flap * fly + w.dead * 0.15);
        p.rotation.y = s * (1 - spread) * 0.35;
        p.scale.x = lerp(0.55, 1, spread);
      }
      for (const p of tails) p.rotation.y = p.userData.s * (0.18 + 0.2 * fly) + sin(t * 3) * 0.04 * w.idle;
    },
  };
}

// Thằn lằn: bò sát chân xoè ngang, thân uốn lượn chữ S khi chạy, đuôi dài; idle thỉnh thoảng nhún "hít đất"
function buildLizard(M) {
  const B = new THREE.Group();
  const trunk = pivot(B, 0, 0.07, 0);
  ell(trunk, M.body, [0.085, 0.055, 0.21], [0, 0, 0]);
  ell(trunk, M.belly, [0.07, 0.03, 0.18], [0, -0.03, 0]);
  for (const z of [-0.12, -0.04, 0.04, 0.12]) ell(trunk, M.stripe, [0.06, 0.012, 0.025], [0, 0.05, z]); // vằn lưng
  const head = pivot(trunk, 0, 0.01, -0.2);
  ell(head, M.body, [0.055, 0.035, 0.09], [0, 0, -0.06]);
  ell(head, M.belly, [0.045, 0.02, 0.07], [0, -0.02, -0.06]);
  for (const s of [-1, 1]) ell(head, M.dark, [0.014, 0.014, 0.014], [s * 0.042, 0.015, -0.06]);
  const tail = []; let par = pivot(trunk, 0, 0, 0.19);
  for (let i = 0; i < 6; i++) {
    if (i > 0) par = pivot(par, 0, 0, 0.09);
    const m = new THREE.Mesh(CYLZ, i % 2 ? M.stripe : M.body);
    const rr = lerp(0.045, 0.008, i / 5);
    m.scale.set(rr, rr * 0.8, 0.095); par.add(m); tail.push(par);
  }
  const legs = [];
  for (const s of [-1, 1]) for (const z of [-0.12, 0.12]) {
    const hp = pivot(trunk, s * 0.07, -0.01, z); hp.userData = { s, k: (s > 0) === (z > 0) ? 0 : 1 };
    const up = limb(hp, M.leg, 0.018, 0.08); up.rotation.z = s * 1.2;            // đùi xoè ngang
    ell(hp, M.leg, [0.03, 0.01, 0.035], [s * 0.075, -0.055, -0.01]);             // bàn chân
    legs.push(hp);
  }
  return {
    body: B, len: 1.12, deadY: 0.1, flip: PI,
    tick({ t, ph, w }) {
      const gait = w.walk + w.run;
      const und = sin(ph * 1.4) * (0.18 * w.walk + 0.32 * w.run);               // uốn lượn thân
      trunk.rotation.y = und;
      head.rotation.y = -und * 1.2 + sin(t * 1.3) * 0.3 * w.idle;
      for (let i = 0; i < tail.length; i++) tail[i].rotation.y = sin(ph * 1.4 - i * 0.7) * (0.25 * gait) + sin(t * 1.1 - i * 0.5) * 0.08 * w.idle;
      for (const l of legs) l.rotation.y = sin(ph * 1.4 + l.userData.k * PI) * (0.5 * w.walk + 0.8 * w.run) * l.userData.s;
      const push = Math.max(0, sin(t * 2.6)) ** 6 * w.idle;                       // hít đất
      trunk.position.y = 0.07 + push * 0.03;
      head.rotation.x = -push * 0.3 - w.run * 0.1;
      B.position.y = w.dead * 0.1;
      B.rotation.z = w.dead * PI;
    },
  };
}

// Rùa: mai gồ có vảy, bò chậm; anim 'run' (server gửi khi rùa trốn) = rụt đầu và chân vào mai
function buildTurtle(M) {
  const B = new THREE.Group();
  const shell = pivot(B, 0, 0.12, 0);
  ell(shell, M.shell, [0.25, 0.13, 0.31], [0, 0.03, 0]);
  ell(shell, M.rim, [0.27, 0.035, 0.32], [0, -0.02, 0]);
  ell(shell, M.belly, [0.23, 0.04, 0.28], [0, -0.05, 0]);
  for (const [x, z] of [[0, -0.14], [0, 0], [0, 0.14], [-0.13, -0.07], [0.13, -0.07], [-0.13, 0.08], [0.13, 0.08]]) {
    const sc = ell(shell, M.scute, [0.075, 0.03, 0.07], [x, 0.13 - Math.abs(x) * 0.45 - Math.abs(z) * 0.2, z]); // vảy mai
    sc.rotation.z = -x * 2.2; sc.rotation.x = z * 1.6;
  }
  const head = pivot(shell, 0, -0.01, -0.3);
  ell(head, M.skin, [0.045, 0.045, 0.08], [0, 0, -0.03]);                          // cổ
  ell(head, M.skin, [0.055, 0.05, 0.075], [0, 0.015, -0.1]);
  for (const s of [-1, 1]) ell(head, M.dark, [0.012, 0.012, 0.012], [s * 0.045, 0.03, -0.13]);
  const legs = [];
  for (const s of [-1, 1]) for (const z of [-0.2, 0.19]) {
    const p = pivot(shell, s * 0.2, -0.05, z); p.userData = { s, k: (s > 0) === (z > 0) ? 0 : 1 };
    ell(p, M.skin, [0.055, 0.065, 0.06], [s * 0.02, -0.04, 0]); legs.push(p);
  }
  cone(shell, M.skin, 0.025, 0.07, [0, -0.02, 0.31], [PI / 2, 0, 0]);             // đuôi
  return {
    body: B, len: 0.82, deadY: 0.2, flip: PI,
    tick({ t, ph, w }) {
      const hide = w.run;
      head.position.z = lerp(-0.3, -0.2, hide);
      head.scale.setScalar(1 - hide * 0.35);
      head.rotation.x = sin(t * 0.8) * 0.1 * w.idle + sin(ph * 0.8) * 0.06 * w.walk;
      head.rotation.y = sin(t * 0.5) * 0.35 * w.idle;
      for (const l of legs) {
        l.rotation.x = sin(ph * 0.8 + l.userData.k * PI) * 0.45 * w.walk;
        l.scale.setScalar(1 - hide * 0.55);
      }
      shell.position.y = 0.12 - hide * 0.05 + abs(sin(ph * 0.8)) * 0.01 * w.walk;
      shell.rotation.z = sin(ph * 0.8) * 0.03 * w.walk;
      B.position.y = w.dead * 0.2;
      B.rotation.z = w.dead * PI; // lật ngửa
    },
  };
}

// Lợn rừng: thân chắc, vai cao, bờm gáy sẫm, nanh cong; idle cúi ủi đất, chạy phi nước đại
function buildBoar(M) {
  const B = new THREE.Group();
  const trunk = pivot(B, 0, 0.43, 0);
  ell(trunk, M.body, [0.2, 0.23, 0.44], [0, 0, 0.02]);
  ell(trunk, M.body, [0.21, 0.25, 0.22], [0, 0.03, -0.18]);                       // vai cao
  ell(trunk, M.mane, [0.07, 0.09, 0.32], [0, 0.2, -0.1]);                          // bờm gáy
  const head = pivot(trunk, 0, 0.02, -0.38);
  ell(head, M.body, [0.14, 0.15, 0.19], [0, 0, -0.06]);
  ell(head, M.body, [0.08, 0.075, 0.13], [0, -0.06, -0.24]);                       // mõm
  ell(head, M.snout, [0.065, 0.055, 0.02], [0, -0.06, -0.37]);                     // đĩa mũi
  for (const s of [-1, 1]) {
    cone(head, M.tusk, 0.014, 0.08, [s * 0.065, -0.1, -0.29], [-0.5, 0, s * 0.5]); // nanh
    ell(head, M.dark, [0.018, 0.018, 0.018], [s * 0.1, 0.05, -0.14]);
    cone(head, M.mane, 0.045, 0.09, [s * 0.08, 0.14, 0.02], [-0.3, 0, -s * 0.35]); // tai
  }
  const legs = [];
  for (const s of [-1, 1]) for (const z of [-0.26, 0.28]) {
    const p = pivot(trunk, s * 0.12, -0.14, z); p.userData = { s, k: (s > 0) === (z > 0) ? 0 : 1, front: z < 0 };
    limb(p, M.body, 0.055, 0.17);
    const low = pivot(p, 0, -0.17, 0);
    limb(low, M.mane, 0.035, 0.12);
    ell(low, M.hoof, [0.038, 0.025, 0.045], [0, -0.13, -0.01]);
    p.userData.low = low; legs.push(p);
  }
  const tail = pivot(trunk, 0, 0.12, 0.45);
  limb(tail, M.mane, 0.012, 0.14).rotation.x = 0.2;
  return {
    body: B, len: 1.24, deadY: 0.24, flip: PI / 2,
    tick({ t, ph, w }) {
      const gait = w.walk + w.run;
      for (const l of legs) {
        // đi: chéo cặp; chạy: phi nước đại (hai chân trước gần cùng pha, hai chân sau lệch nửa nhịp)
        const phase = w.run > 0.5 ? (l.userData.front ? 0 : PI * 0.9) + (l.userData.s > 0 ? 0.3 : 0) : l.userData.k * PI;
        l.rotation.x = sin(ph + phase) * (0.45 * w.walk + 0.8 * w.run) + w.dead * 0.6;
        l.userData.low.rotation.x = Math.max(0, -cos(ph + phase)) * (0.5 * gait) - w.dead * 0.3;
      }
      trunk.position.y = 0.43 + abs(sin(ph)) * (0.01 * w.walk + 0.05 * w.run);
      trunk.rotation.x = sin(ph) * 0.07 * w.run;
      const root = Math.max(0, sin(t * 0.9)) ** 2 * w.idle;                         // ủi đất
      head.rotation.x = root * 0.75 + sin(t * 9) * 0.06 * root + sin(ph * 2) * 0.05 * gait - w.run * 0.1;
      tail.rotation.z = sin(t * 7) * 0.4 * (w.idle + w.walk);
      B.position.y = w.dead * 0.24;
      B.rotation.z = w.dead * (PI / 2);
    },
  };
}

const BUILDERS = { chicken: buildChicken, rabbit: buildRabbit, mouse: buildMouse, bird: buildBird, lizard: buildLizard, turtle: buildTurtle, boar: buildBoar };
const ANIMS = ['idle', 'walk', 'run', 'fly', 'dead'];

export function createAnimal(kind) {
  const build = BUILDERS[kind];
  if (!build) throw new Error('Loài NPC không hợp lệ: ' + kind);
  const M = getMats(kind);
  const group = new THREE.Group();
  const root = new THREE.Group(); // co giãn về bodyLength
  group.add(root);
  const spec = build(M);
  root.scale.setScalar(NPC_KINDS[kind].bodyLength / spec.len);
  root.add(spec.body);
  group.userData.kind = kind;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const w = { idle: 1, walk: 0, run: 0, fly: 0, dead: 0 };
  let t = Math.random() * 100, ph = 0, fl = 0, fq = 5;

  function update(dt, anim, speed01) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const sp = clamp(Number.isFinite(speed01) ? speed01 : 0, 0, 1);
    if (!ANIMS.includes(anim)) anim = 'idle';
    for (const a of ANIMS) w[a] = damp(w[a], a === anim ? 1 : 0, 9, dt);
    // tần số bước phụ thuộc loại chuyển động và speed01
    const fTarget = anim === 'run' ? 10 + sp * 8 : anim === 'walk' ? 5 + sp * 6 : 5;
    fq = damp(fq, fTarget, 6, dt);
    t += dt; ph += fq * dt;
    fl += (18 + 8 * sp) * dt;
    spec.tick({ t, ph, fl, sp, w });
  }
  return { group, update, dispose() { /* geometry/vật liệu dùng chung, không có gì riêng để giải phóng */ } };
}
