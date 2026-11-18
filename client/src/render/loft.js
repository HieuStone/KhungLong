// Dựng "da" liền mạch cho sinh vật: một ống mượt chạy qua các khớp (đuôi -> thân -> cổ -> đầu, chân, tay),
// bám xương (SkinnedMesh) nên co duỗi theo animation mà không lộ chỗ nối giữa các khối như kiểu ghép primitive.
// Xương chính là các pivot Object3D sẵn có của mô hình (Skeleton chỉ cần matrixWorld của chúng).
import * as THREE from 'three';
import { skinTextures } from './textures.js';
import { plainTex } from './pbr.js';

const RS = 18; // số đỉnh quanh mỗi vòng cắt ngang

/**
 * Vật liệu da: màu lưng/bụng/điểm nhấn trộn theo thuộc tính từng đỉnh (aPat), thêm loang lổ theo noise
 * gắn với tư thế gốc (hoa văn dính vào da, không trôi khi cử động), vảy nổi (bump) và độ nhám không đều.
 */
export class SkinMaterial extends THREE.MeshStandardMaterial {
  constructor(params) {
    super(params);
    this.skinUniforms = {
      uBack: { value: new THREE.Color(0x777777) },
      uBelly: { value: new THREE.Color(0xaaaaaa) },
      uAccent: { value: new THREE.Color(0x333333) },
      uScale: { value: 1 },
      uWScale: { value: 6 }, // mật độ nếp/mảng vảy (nhỏ = mảng to)
      uWBump: { value: 1 },  // độ nổi khối của mảng vảy
      uBlot: { value: 0.35 }, // mức loang màu điểm nhấn trên thân
      tWrinkle: { value: plainTex('skin_wrinkle.jpg') }, // ảnh đất nứt khô = nếp nhăn/vảy sừng như da voi, cá sấu
    };
    const { bump, rough } = skinTextures();
    this.bumpMap = bump; this.bumpScale = 1.4; this.roughnessMap = rough; this.roughness = 1;
    // Da bò sát gần như không bóng: phản chiếu bầu trời ít (nếu không cả con bị bạc, ám xanh như nhựa)
    this.envMapIntensity = 0.3;
  }
  onBeforeCompile(sh) {
    Object.assign(sh.uniforms, this.skinUniforms);
    sh.vertexShader = 'attribute vec3 aPat;\nvarying vec3 vPat;\nvarying vec3 vRest;\nvarying vec3 vRestN;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vPat = aPat; vRest = position; vRestN = normal;');
    sh.fragmentShader = `uniform vec3 uBack; uniform vec3 uBelly; uniform vec3 uAccent; uniform float uScale; uniform float uWScale; uniform float uWBump; uniform float uBlot; uniform sampler2D tWrinkle;
      varying vec3 vPat; varying vec3 vRest; varying vec3 vRestN;
      float sh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float sn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(sh3(i), sh3(i+vec3(1,0,0)), f.x), mix(sh3(i+vec3(0,1,0)), sh3(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(sh3(i+vec3(0,0,1)), sh3(i+vec3(1,0,1)), f.x), mix(sh3(i+vec3(0,1,1)), sh3(i+vec3(1,1,1)), f.x), f.y), f.z); }
      ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 q = vRest * uScale;
        float blot = sn3(q * 9.0) * 0.6 + sn3(q * 23.0) * 0.4;           // mảng loang lớn
        float fleck = sn3(q * 70.0);                                       // đốm nhỏ
        vec3 skinC = mix(uBack, uBelly, vPat.x);
        skinC = mix(skinC, uAccent, clamp(vPat.y + smoothstep(0.62, 0.8, blot) * uBlot * (1.0 - vPat.x), 0.0, 1.0));
        skinC *= mix(1.0, 0.78, vPat.z);                                   // sống lưng sẫm hơn
        skinC *= (0.84 + blot * 0.24 + (fleck - 0.5) * 0.1) * 0.82;
        // Nếp nhăn/vảy sừng từ ảnh thật, chiếu 3 phía theo tư thế gốc (nếp dính theo da khi cử động)
        vec3 wb = pow(abs(normalize(vRestN)), vec3(4.0)); wb /= (wb.x + wb.y + wb.z);
        vec3 wq = q * uWScale;
        float wrH = texture2D(tWrinkle, wq.zy).r * wb.x + texture2D(tWrinkle, wq.xz).r * wb.y + texture2D(tWrinkle, wq.xy).r * wb.z;
        float crease = 1.0 - smoothstep(0.45, 0.68, wrH);                  // kẽ nứt
        skinC *= mix(1.06, 0.42, crease) * mix(1.0, 0.85 + 0.3 * smoothstep(0.55, 0.8, wrH), min(1.0, uWBump - 1.0)); // mảng vảy to: tâm mảng sáng hơn mép                                  // bụi bẩn/bóng tối đọng trong kẽ
        diffuseColor.rgb *= skinC;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = max(roughnessFactor, 0.86) + crease * 0.1;`)
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_BUMPMAP
          vec2 dHd = vec2(dFdx(wrH), dFdy(wrH)) * 3.2 * uWBump;
          normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd() + dHd, faceDirection);
        #endif`);
  }
  customProgramCacheKey() { return 'creature-skin-v6'; }
  copy(src) {
    super.copy(src);
    if (src.skinUniforms) for (const k of Object.keys(src.skinUniforms)) {
      const v = src.skinUniforms[k].value;
      if (v.isColor) this.skinUniforms[k].value.copy(v); else this.skinUniforms[k].value = v;
    }
    return this;
  }
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
// Catmull-Rom 1 chiều: độ dày thay đổi mượt qua các vòng định nghĩa (không bị bậc/gợn)
function cr(vals, k, t) {
  const p0 = vals[Math.max(0, k - 1)], p1 = vals[k], p2 = vals[Math.min(vals.length - 1, k + 1)], p3 = vals[Math.min(vals.length - 1, k + 2)];
  const t2 = t * t, t3 = t2 * t;
  const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return Math.max(v, Math.min(p1, p2) * 0.7); // không cho lõm quá mức giữa hai vòng
}

/**
 * Bộ dựng: mỗi lần add() là một ống. Định nghĩa vòng: { bone, p:[x,y,z] (toạ độ trong bone), w (nửa rộng),
 * h (nửa cao), belly?, acc?, dorsal? }. Gọi khi mô hình đang ở tư thế gốc và matrixWorld đã cập nhật.
 */
export class LoftBuilder {
  constructor() {
    this.bones = []; this.boneIdx = new Map();
    this.pos = []; this.uv = []; this.si = []; this.sw = []; this.pat = []; this.idx = [];
    this.seams = []; // cặp đỉnh trùng vị trí ở đường nối (để làm mượt pháp tuyến)
  }
  _bone(b) {
    if (!this.boneIdx.has(b)) { this.boneIdx.set(b, this.bones.length); this.bones.push(b); }
    return this.boneIdx.get(b);
  }
  /**
   * defs: danh sách vòng; opt: { sub (số vòng chèn giữa 2 định nghĩa), up: hướng "lưng" ban đầu (Vector3),
   * scaleLen (độ dài vảy, dùng cho UV), pattern(s01, sinA, ring) -> [belly, accent, dorsal] }
   */
  add(defs, opt = {}) {
    const sub = opt.sub || 4;
    const W = defs.map((d) => d.w), Hh = defs.map((d) => d.h);
    const pts = defs.map((d) => d.bone.localToWorld(_v.set(d.p[0], d.p[1], d.p[2])).clone());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    // Lấy mẫu: mỗi đoạn giữa 2 định nghĩa chia `sub` phần; tham số đường cong theo chỉ số điểm
    const rings = [];
    const nSeg = defs.length - 1;
    for (let k = 0; k < nSeg; k++) {
      for (let j = 0; j < sub || (k === nSeg - 1 && j === sub); j++) {
        const t = j / sub, a = defs[k], b = defs[k + 1];
        const lerp = (x, y) => x + (y - x) * t;
        rings.push({
          u: (k + t) / nSeg, w: cr(W, k, t), h: cr(Hh, k, t),
          belly: lerp(a.belly ?? 1, b.belly ?? 1), acc: lerp(a.acc || 0, b.acc || 0),
          sq: lerp(a.sq || 0, b.sq || 0), flatB: lerp(a.flatB ?? 0.88, b.flatB ?? 0.88), flatT: lerp(a.flatT ?? 1, b.flatT ?? 1),
          bones: [[this._bone(a.bone), 1 - t], [this._bone(b.bone), t]],
        });
      }
    }
    // Đường cong CatmullRom tham số hoá theo điểm: getPoint(u) với u đều theo chỉ số điểm (không theo độ dài)
    let P = rings.map((r) => curve.getPoint(r.u));
    // Làm mượt đường tâm (giữ hai đầu): chỗ gập gấp (vai, gốc đuôi) mà vòng cắt lớn sẽ gấp nếp thành gờ cứng
    for (let it = 0; it < (opt.smooth ?? 4); it++) {
      P = P.map((p, i) => (i === 0 || i === P.length - 1) ? p : p.clone().multiplyScalar(0.5).addScaledVector(P[i - 1], 0.25).addScaledVector(P[i + 1], 0.25));
    }
    const TW = 2; // tiếp tuyến lấy trên cửa sổ rộng để vòng cắt xoay từ từ
    const T = P.map((p, i) => _v.subVectors(P[Math.min(i + TW, P.length - 1)], P[Math.max(i - TW, 0)]).normalize().clone());
    // Khung vận chuyển song song: pháp tuyến không xoắn dọc ống
    let N = (opt.up || new THREE.Vector3(0, 1, 0)).clone();
    N.addScaledVector(T[0], -N.dot(T[0])).normalize();
    const frames = [];
    for (let i = 0; i < P.length; i++) {
      if (i > 0) { _q.setFromUnitVectors(T[i - 1], T[i]); N.applyQuaternion(_q); N.addScaledVector(T[i], -N.dot(T[i])).normalize(); }
      frames.push({ N: N.clone(), B: new THREE.Vector3().crossVectors(T[i], N).normalize() });
    }
    // Độ dài cung (cho UV vảy)
    const arc = [0];
    for (let i = 1; i < P.length; i++) arc.push(arc[i - 1] + P[i].distanceTo(P[i - 1]));
    const total = arc[arc.length - 1] || 1;
    const scaleLen = opt.scaleLen || total * 0.02;
    // Số cột vảy quanh vòng: cố định cho cả ống (tránh méo), theo chu vi trung bình
    const avgR = rings.reduce((s, r) => s + (r.w + r.h) / 2, 0) / rings.length;
    const vCols = Math.max(1, Math.round((2 * Math.PI * avgR) / scaleLen / 3)); // texture lặp 3 lần theo v

    const base = this.pos.length / 3;
    const pattern = opt.pattern || (() => [0, 0, 0]);
    const ridgeAt = opt.ridge || (() => 0);
    for (let i = 0; i < P.length; i++) {
      const r = rings[i], { N: n, B: bb } = frames[i];
      const s01 = arc[i] / total;
      for (let j = 0; j <= RS; j++) {
        const a = (j / RS) * Math.PI * 2;
        // siêu elip: sq=0 elip tròn, sq=1 gần chữ nhật bo góc (vd hộp sọ T-rex sâu, vuông vức)
        const se = 2 / (2 + 3 * r.sq);
        const sa0 = Math.sin(a), ca0 = Math.cos(a);
        const sa = Math.sign(sa0) * Math.pow(Math.abs(sa0), se), ca = Math.sign(ca0) * Math.pow(Math.abs(ca0), se);
        // gờ gai trên sống lưng (opt.ridge): nhô ra quanh góc 90°, độ cao theo vị trí dọc thân (tạo hàng vảy gồ)
        const da = a - Math.PI / 2, dr = ridgeAt(s01) * Math.exp(-(da * da) / 0.05);
        const hh = r.h * (sa < 0 ? r.flatB : r.flatT) * (1 + dr); // bụng hơi phẳng (đầu: vòm miệng phẳng)
        const ww = r.w * (1 + dr);
        const x = P[i].x + bb.x * ww * ca + n.x * hh * sa;
        const y = P[i].y + bb.y * ww * ca + n.y * hh * sa;
        const z = P[i].z + bb.z * ww * ca + n.z * hh * sa;
        this.pos.push(x, y, z);
        this.uv.push(arc[i] / (scaleLen * 6), (j / RS) * vCols);
        const [b0, w0] = r.bones[0], [b1, w1] = r.bones[1];
        this.si.push(b0, b1, 0, 0); this.sw.push(w0, w1, 0, 0);
        const p = pattern(s01, sa, r);
        this.pat.push(p[0] * r.belly, Math.min(1, p[1] + r.acc), p[2]);
      }
      this.seams.push([base + i * (RS + 1), base + i * (RS + 1) + RS]);
    }
    // Mặt: chọn chiều quấn sao cho pháp tuyến hướng ra ngoài
    const quad = [];
    for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < RS; j++) {
      const a = base + i * (RS + 1) + j, b = a + RS + 1;
      quad.push([a, b, a + 1], [a + 1, b, b + 1]);
    }
    const out = this._outward(quad[0], P[0]);
    for (const [a, b, c] of quad) out ? this.idx.push(a, b, c) : this.idx.push(a, c, b);
    // Bịt hai đầu bằng một đỉnh chóp
    for (const end of [0, P.length - 1]) {
      const tip = P[end].clone().addScaledVector(T[end], (end ? 1 : -1) * Math.min(rings[end].w, rings[end].h) * 0.6);
      const ci = this.pos.length / 3;
      this.pos.push(tip.x, tip.y, tip.z); this.uv.push(arc[end] / (scaleLen * 6), 0);
      const [b0, w0] = rings[end].bones[0], [b1, w1] = rings[end].bones[1];
      this.si.push(b0, b1, 0, 0); this.sw.push(w0, w1, 0, 0);
      const pe = pattern(end ? 1 : 0, 0, rings[end]); this.pat.push(0, Math.min(1, pe[1] + rings[end].acc), pe[2]);
      const rb = base + end * (RS + 1);
      // chiều quấn: pháp tuyến nắp phải cùng hướng với (chóp - tâm vòng), tức là hướng ra ngoài ống
      const outDir = tip.clone().sub(P[end]);
      const tri0 = [rb, rb + 1, ci];
      const flip = this._triNormal(tri0).dot(outDir) < 0;
      for (let j = 0; j < RS; j++) {
        const tri = [rb + j, rb + j + 1, ci];
        if (flip) tri.reverse();
        this.idx.push(...tri);
      }
    }
  }
  _triNormal([a, b, c]) {
    const p = (i) => new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    const A = p(a);
    return new THREE.Vector3().crossVectors(p(b).sub(A), p(c).sub(A));
  }
  _outward([a, b, c], center) {
    const p = (i) => new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    const A = p(a), nrm = new THREE.Vector3().crossVectors(p(b).sub(A), p(c).sub(A));
    return nrm.dot(A.clone().sub(center)) > 0;
  }
  /** Tạo SkinnedMesh (vật liệu da riêng cho từng con), gắn vào parent. */
  build(parent, material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(this.pat, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // Pháp tuyến mượt qua đường nối của UV
    const nr = g.attributes.normal;
    for (const [a, b] of this.seams) {
      _v.set(nr.getX(a) + nr.getX(b), nr.getY(a) + nr.getY(b), nr.getZ(a) + nr.getZ(b)).normalize();
      nr.setXYZ(a, _v.x, _v.y, _v.z); nr.setXYZ(b, _v.x, _v.y, _v.z);
    }
    const mesh = new THREE.SkinnedMesh(g, material);
    parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    // Vẫn bỏ qua khi nằm ngoài khung nhìn (trước đây tắt hẳn => con sau lưng camera cũng bị vẽ). Hình dạng đổi theo xương
    // (cúi, nằm chết...) nên dùng mặt cầu bao ở tư thế gốc nới rộng 1.6 lần, tính một lần.
    mesh.skeleton.update();
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius *= 1.6;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
}
