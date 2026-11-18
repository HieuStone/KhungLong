import * as THREE from 'three';
import { getWorld, heightAt, WATER_LEVEL } from '@isle/shared';
import { pbr } from './pbr.js';

// Cầu vòm thép nối hai đảo lớn nhất (kiểu cầu vòm có mặt cầu treo bên dưới):
//  - mặt cầu thép tấm chống trượt trên 2 dầm dọc chữ I + dầm ngang
//  - hai vòm thép lớn hai bên, dây treo thẳng đứng đỡ mặt cầu, giằng ngang + chéo giữa hai vòm ở trên cao
//  - lan can thép, cột đèn (sáng về đêm), trụ bê tông xuống đáy biển, mố cầu hai đầu
// Hình học mặt cầu/lan can lấy từ getWorld().bridge (cũng là dữ liệu va chạm của server) nên hình ảnh và vật lý khớp nhau.
// Mọi bộ phận là InstancedMesh của hộp/trụ đơn vị => chỉ vài lệnh vẽ.

/**
 * Vật liệu ảnh thật chiếu 3 phía theo toạ độ THẾ GIỚI (thanh dầm dài không bị kéo giãn ảnh như UV của hộp).
 * scale: số lần lặp ảnh mỗi mét.
 */
function triplanar(set, scale, { metalness = 0, roughness = 1, color = 0xffffff, key }) {
  const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tMap = { value: set.map };
    sh.uniforms.tRough = { value: set.rough };
    sh.vertexShader = 'varying vec3 vTWP; varying vec3 vTWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        mat4 mw = modelMatrix;
        #ifdef USE_INSTANCING
        mw = modelMatrix * instanceMatrix;
        #endif
        vTWP = (mw * vec4(transformed, 1.0)).xyz;
        vTWN = normalize(mat3(mw) * objectNormal);
      }`);
    sh.fragmentShader = 'uniform sampler2D tMap; uniform sampler2D tRough;\nvarying vec3 vTWP; varying vec3 vTWN;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec3 tbw = pow(abs(normalize(vTWN)), vec3(4.0)); tbw /= (tbw.x + tbw.y + tbw.z);
        vec3 tq = vTWP * ${scale.toFixed(3)};
        vec4 tcol = texture2D(tMap, tq.zy) * tbw.x + texture2D(tMap, tq.xz) * tbw.y + texture2D(tMap, tq.xy) * tbw.z;
        diffuseColor *= tcol;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * (texture2D(tRough, tq.zy).g * tbw.x + texture2D(tRough, tq.xz).g * tbw.y + texture2D(tRough, tq.xy).g * tbw.z);`);
  };
  m.customProgramCacheKey = () => 'bridge-tri-' + key;
  return m;
}

export function createBridge(scene) {
  const br = getWorld().bridge;
  if (!br) return { group: null, update() {}, dispose() {} };
  const group = new THREE.Group();

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const mats = [];
  const keep = (m) => { mats.push(m); return m; };
  const steel = keep(triplanar(pbr('rusty_painted_metal'), 0.45, { metalness: 0.55, roughness: 1, key: 'steel' }));
  const deckM = keep(triplanar(pbr('metal_plate'), 0.6, { metalness: 0.35, roughness: 1, color: 0xa4a6a8, key: 'deck' }));
  const concrete = keep(triplanar(pbr('concrete'), 0.25, { roughness: 1, color: 0xd8d4cc, key: 'concrete' }));
  const darkSteel = keep(new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.8, roughness: 0.45 }));
  const lampGlass = keep(new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffc880, emissiveIntensity: 0.2, roughness: 0.3 }));

  // Điểm trên trục cầu tại khoảng cách s (m): vị trí, độ cao mặt cầu, độ dốc
  const axisAt = (s) => {
    const t = Math.min(1, Math.max(0, s / br.len));
    const x = br.ax + br.dx * s, z = br.az + br.dz * s;
    const y = br.deckY(t);
    const e = 0.5;
    const dy = (br.deckY(Math.min(1, (s + e) / br.len)) - br.deckY(Math.max(0, (s - e) / br.len))) / (2 * e);
    return { x, y, z, dy };
  };
  const pointAt = (s, lat, up) => { const a = axisAt(s); return new THREE.Vector3(a.x + br.nx * lat, a.y + up, a.z + br.nz * lat); };

  const right = new THREE.Vector3(br.nx, 0, br.nz);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const T = new THREE.Vector3(), U = new THREE.Vector3(), Z = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

  // Hộp theo trục cầu: tại s, lệch ngang lat, lệch cao up; kích thước (w ngang, h cao, l dọc), nghiêng theo dốc mặt cầu
  function placeBox(mesh, i, s, lat, upOff, w, h, l) {
    const a = axisAt(s);
    T.set(br.dx, a.dy, br.dz).normalize();
    U.crossVectors(right, T).normalize();                // "lên" vuông góc mặt cầu (hướng lên trên)
    Z.crossVectors(right, U);                             // trục dọc, chọn sao cho hệ (right, U, Z) thuận tay phải
    m4.makeBasis(right, U, Z); q.setFromRotationMatrix(m4);
    p.set(a.x + br.nx * lat + U.x * upOff, a.y + U.y * upOff, a.z + br.nz * lat + U.z * upOff);
    sc.set(w, h, l); m4.compose(p, q, sc); mesh.setMatrixAt(i, m4);
  }
  // Thanh nối 2 điểm A -> B, tiết diện (tw x th); hộp hoặc trụ
  function beamBetween(mesh, i, A, B, tw, th) {
    T.subVectors(B, A); const L = T.length(); T.normalize();
    const side = Math.abs(T.y) > 0.95 ? right : Y;
    const X = new THREE.Vector3().crossVectors(side, T).normalize(), Zb = new THREE.Vector3().crossVectors(X, T); // hệ (X, T, Zb) thuận tay phải
    m4.makeBasis(X, T, Zb); q.setFromRotationMatrix(m4);
    p.addVectors(A, B).multiplyScalar(0.5); sc.set(tw, L, th); m4.compose(p, q, sc); mesh.setMatrixAt(i, m4);
  }
  const instanced = (geo, material, count) => {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
    mesh.count = count;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const W = br.halfW;
  const K = Math.max(1, W / 5); // tỉ lệ kết cấu (thanh thép, dầm, trụ) theo bề rộng cầu; lan can giữ tầm khủng long
  // ---- Mặt cầu thép tấm + mép bó vỉa ----
  const segL = 2.0, nSeg = Math.ceil(br.len / segL);
  const deck = instanced(boxGeo, deckM, nSeg);
  const curbs = instanced(boxGeo, steel, nSeg * 2);
  for (let i = 0; i < nSeg; i++) {
    const s = Math.min(br.len - segL / 2, i * segL + segL / 2);
    placeBox(deck, i, s, 0, -0.18 * K, W * 2, 0.36 * K, segL + 0.02);
    placeBox(curbs, i * 2, s, -(W - 0.12), 0.1, 0.24, 0.35, segL + 0.02);
    placeBox(curbs, i * 2 + 1, s, W - 0.12, 0.1, 0.24, 0.35, segL + 0.02);
  }

  // ---- Dầm dọc chữ I (bản bụng + 2 bản cánh) dưới hai mép + dầm ngang ----
  const gL = 3.0, nG = Math.ceil(br.len / gL);
  const gLats = [];
  const nGl = Math.max(2, Math.round((2 * W) / 10) + 1);
  for (let k = 0; k < nGl; k++) gLats.push(-(W - 0.6 * K) + (k / (nGl - 1)) * 2 * (W - 0.6 * K));
  const girders = instanced(boxGeo, steel, nG * 3 * gLats.length);
  let gi = 0;
  const d0 = 0.36 * K; // đáy mặt cầu
  for (let i = 0; i < nG; i++) {
    const s = Math.min(br.len - gL / 2, i * gL + gL / 2);
    for (const lat of gLats) {
      placeBox(girders, gi++, s, lat, -d0 - 0.55 * K, 0.12 * K, 1.1 * K, gL + 0.02); // bản bụng
      placeBox(girders, gi++, s, lat, -d0 - 0.05 * K, 0.55 * K, 0.1 * K, gL + 0.02); // bản cánh trên
      placeBox(girders, gi++, s, lat, -d0 - 1.05 * K, 0.55 * K, 0.1 * K, gL + 0.02); // bản cánh dưới
    }
  }
  const xStep = 4 * Math.sqrt(K), nX = Math.floor(br.len / xStep);
  const xbeams = instanced(boxGeo, steel, nX);
  for (let i = 0; i < nX; i++) placeBox(xbeams, i, i * xStep + xStep / 2, 0, -d0 - 0.45 * K, W * 2 - 1.1 * K, 0.7 * K, 0.28 * K);

  // ---- Hai vòm thép lớn + dây treo + giằng trên cao ----
  const RISE = Math.min(16 * K, Math.max(8, br.len * 0.17 * K), br.len * 0.6); // độ cao vòm so với mặt cầu
  const LAT = W + 0.45 * K;
  const archY = (s) => RISE * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, s / br.len))), 0.85);
  const NA = 56;
  const ribs = instanced(boxGeo, steel, NA * 2);
  let ai = 0;
  for (const side of [-1, 1]) for (let k = 0; k < NA; k++) {
    const s0 = (k / NA) * br.len, s1 = ((k + 1) / NA) * br.len;
    beamBetween(ribs, ai++, pointAt(s0, side * LAT, archY(s0)), pointAt(s1, side * LAT, archY(s1) + 0.001), 0.75 * K, 1.0 * K);
  }
  // dây treo thẳng đứng (thép tròn) từ vòm xuống mép mặt cầu
  const hangers = [];
  const hStep = 3.2 * Math.sqrt(K);
  for (let s = hStep; s < br.len - 3; s += hStep) if (archY(s) > 1.6 * K) hangers.push(s);
  const hang = instanced(cylGeo, darkSteel, hangers.length * 2);
  let hi = 0;
  for (const s of hangers) for (const side of [-1, 1]) {
    beamBetween(hang, hi++, pointAt(s, side * LAT, 0.2), pointAt(s, side * LAT, archY(s) - 0.5 * K), 0.07 * K, 0.07 * K);
  }
  // giằng ngang + chéo giữa hai vòm ở đoạn đủ cao (xe/khủng long lớn đi lọt bên dưới)
  const tops = [];
  const tStep = 4.8 * Math.sqrt(K);
  for (let s = tStep; s < br.len - 4; s += tStep) if (archY(s) > Math.max(9, RISE * 0.45)) tops.push(s);
  const brace = instanced(boxGeo, steel, tops.length * 2);
  let bi = 0;
  tops.forEach((s, k) => {
    const yA = archY(s);
    beamBetween(brace, bi++, pointAt(s, -LAT, yA), pointAt(s, LAT, yA), 0.4 * K, 0.4 * K);
    const s2 = tops[k + 1];
    if (s2 !== undefined) {
      const sd = k % 2 ? 1 : -1; // chéo đổi chiều mỗi ô -> hình chữ K/X
      beamBetween(brace, bi++, pointAt(s, sd * LAT, yA), pointAt(s2, -sd * LAT, archY(s2)), 0.28 * K, 0.28 * K);
    }
  });
  brace.count = bi;

  // ---- Lan can thép: cột + 2 thanh ngang ----
  const postStep = 2.0, nP = Math.floor(br.len / postStep) + 1;
  const posts = instanced(boxGeo, darkSteel, nP * 2);
  const railSeg = 2.0, nR = Math.ceil(br.len / railSeg);
  const rails = instanced(boxGeo, darkSteel, nR * 4);
  let pi = 0, ri = 0;
  for (let i = 0; i < nP; i++) for (const side of [-1, 1]) placeBox(posts, pi++, Math.min(br.len, i * postStep), side * (W - 0.25), 0.95, 0.14, 1.8, 0.14);
  for (let i = 0; i < nR; i++) {
    const s = Math.min(br.len - railSeg / 2, i * railSeg + railSeg / 2);
    for (const side of [-1, 1]) {
      placeBox(rails, ri++, s, side * (W - 0.25), 1.85, 0.18, 0.12, railSeg + 0.02);
      placeBox(rails, ri++, s, side * (W - 0.25), 1.0, 0.09, 0.09, railSeg + 0.02);
    }
  }

  // ---- Cột đèn (đèn sáng dần về đêm) ----
  const lampS = [];
  for (let s = 10; s < br.len - 6; s += 20) lampS.push(s);
  const poles = instanced(cylGeo, darkSteel, lampS.length * 2);
  const arms = instanced(boxGeo, darkSteel, lampS.length * 2);
  const lamps = instanced(boxGeo, lampGlass, lampS.length * 2);
  let li = 0;
  for (const s of lampS) for (const side of [-1, 1]) {
    const base = pointAt(s, side * (W - 0.6), 0), top = pointAt(s, side * (W - 0.6), 12);
    beamBetween(poles, li, base, top, 0.22, 0.22);
    const tip = pointAt(s, side * (W - 3.2), 11.6);
    beamBetween(arms, li, top, tip, 0.16, 0.16);
    p.copy(tip); p.y -= 0.25; q.setFromRotationMatrix(m4.makeBasis(right, Y, T.set(-br.dx, 0, -br.dz))); sc.set(1.0, 0.35, 1.6);
    m4.compose(p, q, sc); lamps.setMatrixAt(li, m4);
    li++;
  }

  // ---- Trụ bê tông xuống đáy biển (nơi có nước bên dưới) + mố cầu hai đầu ----
  const piers = [];
  const nSpan = Math.max(2, Math.round(br.len / 18));
  for (let k = 1; k < nSpan; k++) {
    const s = (k / nSpan) * br.len, a = axisAt(s);
    const bed = Math.min(heightAt(a.x, a.z), heightAt(a.x + br.nx * W, a.z + br.nz * W), heightAt(a.x - br.nx * W, a.z - br.nz * W)) - 1.0;
    if (heightAt(a.x, a.z) < WATER_LEVEL + 0.5) piers.push({ s, top: a.y - 0.36 * K - 1.15 * K, bed });
  }
  const pierMesh = instanced(boxGeo, concrete, piers.length * 2);
  piers.forEach((pr, i) => {
    const a = axisAt(pr.s);
    // thân trụ (thu hẹp về phía trên một chút nhờ đặt mũ trụ rộng hơn)
    p.set(a.x, (pr.top + pr.bed) / 2, a.z);
    q.setFromAxisAngle(Y, Math.atan2(br.dx, br.dz)); sc.set(W * 2 - 0.6 * K, pr.top - pr.bed, 2.2 * K);
    m4.compose(p, q, sc); pierMesh.setMatrixAt(i * 2, m4);
    // mũ trụ
    p.set(a.x, pr.top - 0.3 * K, a.z); sc.set(W * 2 + 1.4 * K, 0.6 * K, 2.8 * K);
    m4.compose(p, q, sc); pierMesh.setMatrixAt(i * 2 + 1, m4);
  });
  const abut = instanced(boxGeo, concrete, 2);
  [0, br.len].forEach((s, i) => {
    const a = axisAt(s), g = heightAt(a.x, a.z);
    p.set(a.x, (a.y - 0.2 + g - 3 * K) / 2, a.z);
    q.setFromAxisAngle(Y, Math.atan2(br.dx, br.dz)); sc.set(W * 2 + 2.0 * K, a.y - 0.2 - (g - 3 * K), 3.0 * K);
    m4.compose(p, q, sc); abut.setMatrixAt(i, m4);
  });

  for (const m of group.children) m.instanceMatrix.needsUpdate = true;
  scene.add(group);

  return {
    group,
    /** Đèn cầu sáng dần khi trời tối (sky.state.daylight: 0 đêm .. 1 ngày). */
    update(skyState) {
      const day = skyState ? skyState.daylight : 1;
      lampGlass.emissiveIntensity = 0.2 + (1 - day) * 5;
    },
    dispose() {
      scene.remove(group);
      boxGeo.dispose(); cylGeo.dispose(); mats.forEach((m) => m.dispose());
    },
  };
}
