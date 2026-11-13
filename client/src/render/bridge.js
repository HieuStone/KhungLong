import * as THREE from 'three';
import { getWorld, heightAt, WATER_LEVEL } from '@isle/shared';

// Cầu gỗ vòm nối hai đảo lớn nhất. Dữ liệu hình học lấy từ getWorld().bridge (cũng là dữ liệu server
// dùng cho va chạm/độ cao mặt cầu), nên hình ảnh và vật lý luôn khớp nhau.
// Mọi bộ phận là InstancedMesh của hộp/trụ đơn vị => chỉ vài draw call.

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export function createBridge(scene) {
  const br = getWorld().bridge;
  if (!br) return { group: null, dispose() {} };
  const group = new THREE.Group();

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const mats = [];
  const mat = (color) => { const m = new THREE.MeshLambertMaterial({ color, flatShading: true }); mats.push(m); return m; };

  // Điểm trên trục cầu tại khoảng cách s (m): vị trí, độ cao mặt cầu, tiếp tuyến
  const axisAt = (s) => {
    const t = Math.min(1, Math.max(0, s / br.len));
    const x = br.ax + br.dx * s, z = br.az + br.dz * s;
    const y = br.deckY(t);
    const e = 0.5;
    const dy = (br.deckY(Math.min(1, (s + e) / br.len)) - br.deckY(Math.max(0, (s - e) / br.len))) / (2 * e);
    return { x, y, z, dy };
  };

  const right = new THREE.Vector3(br.nx, 0, br.nz);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const T = new THREE.Vector3(), U = new THREE.Vector3();

  // Đặt một hộp tại điểm trục cầu s, lệch ngang `lat` và lệch cao `up`, kích thước (w ngang, h cao, l dọc)
  function placeBox(mesh, i, s, lat, upOff, w, h, l, tilt = true) {
    const a = axisAt(s);
    T.set(br.dx, tilt ? a.dy : 0, br.dz).normalize();
    U.crossVectors(T, right).normalize();
    m4.makeBasis(right, U, T);
    q.setFromRotationMatrix(m4);
    p.set(a.x + br.nx * lat + U.x * upOff, a.y + U.y * upOff, a.z + br.nz * lat + U.z * upOff);
    sc.set(w, h, l);
    m4.compose(p, q, sc);
    mesh.setMatrixAt(i, m4);
  }

  const instanced = (geo, material, count) => {
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };

  // ---- Ván mặt cầu ----
  const plankLen = 0.5, plankPitch = 0.56;
  const nPlanks = Math.floor(br.len / plankPitch);
  const planks = instanced(boxGeo, mat(0xffffff), nPlanks);
  const col = new THREE.Color();
  for (let i = 0; i < nPlanks; i++) {
    const s = i * plankPitch + plankLen / 2;
    placeBox(planks, i, s, 0, -0.07, br.halfW * 2, 0.14, plankLen);
    const v = hash(i);
    col.setHSL(0.08 + v * 0.02, 0.35 + hash(i + 9) * 0.1, 0.30 + v * 0.1); // nâu gỗ, mỗi ván hơi khác màu
    planks.setColorAt(i, col);
  }
  planks.instanceColor.needsUpdate = true;

  // ---- Dầm dọc dưới mặt cầu (3 thanh) ----
  const segL = 3.2;
  const nSeg = Math.ceil(br.len / segL);
  const beams = instanced(boxGeo, mat(0x4a3826), nSeg * 3);
  let bi = 0;
  for (let i = 0; i < nSeg; i++) {
    const s = Math.min(br.len, i * segL + segL / 2);
    for (const lat of [-(br.halfW - 0.4), 0, br.halfW - 0.4]) placeBox(beams, bi++, s, lat, -0.32, 0.32, 0.3, segL + 0.05);
  }

  // ---- Lan can: cột thưa + thanh ngang liên tục ----
  const visPosts = br.posts.filter((_, i) => i % 6 < 2); // mỗi cặp (2 bên) cứ 3 cặp vẽ 1 cặp
  const posts = instanced(boxGeo, mat(0x5a432c), visPosts.length);
  visPosts.forEach((pt, i) => {
    p.set(pt.x, pt.y + 0.52, pt.z);
    q.identity(); sc.set(0.2, 1.1, 0.2);
    m4.compose(p, q, sc);
    posts.setMatrixAt(i, m4);
  });
  const railSeg = 1.1;
  const nRail = Math.ceil(br.len / railSeg);
  const rails = instanced(boxGeo, mat(0x6b4f33), nRail * 4);
  let ri = 0;
  for (let i = 0; i < nRail; i++) {
    const s = Math.min(br.len, i * railSeg + railSeg / 2);
    for (const lat of [-(br.halfW - 0.25), br.halfW - 0.25]) {
      placeBox(rails, ri++, s, lat, 1.05, 0.14, 0.12, railSeg + 0.03); // thanh trên
      placeBox(rails, ri++, s, lat, 0.55, 0.1, 0.1, railSeg + 0.03);   // thanh giữa
    }
  }

  // ---- Trụ chống xuống đáy biển (chỉ nơi có nước bên dưới) ----
  const pylons = [];
  for (let s = 6; s < br.len - 4; s += 8) {
    const a = axisAt(s);
    for (const lat of [-(br.halfW - 0.7), br.halfW - 0.7]) {
      const x = a.x + br.nx * lat, z = a.z + br.nz * lat;
      const bed = heightAt(x, z) - 0.6;
      if (a.y - 0.3 - bed > 1.2 && heightAt(x, z) < WATER_LEVEL + 0.5) pylons.push({ x, z, top: a.y - 0.3, bed });
    }
  }
  const pylonMesh = instanced(cylGeo, mat(0x3f3022), pylons.length);
  pylons.forEach((py, i) => {
    p.set(py.x, (py.top + py.bed) / 2, py.z);
    q.identity(); sc.set(0.3, py.top - py.bed, 0.3);
    m4.compose(p, q, sc);
    pylonMesh.setMatrixAt(i, m4);
  });
  // Giằng ngang nối từng cặp trụ
  const braces = instanced(boxGeo, mat(0x3f3022), Math.floor(pylons.length / 2));
  for (let i = 0; i + 1 < pylons.length; i += 2) {
    const a = pylons[i], b = pylons[i + 1];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, y = a.top - 0.35;
    p.set(mx, y, mz);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(b.z - a.z), b.x - a.x));
    sc.set(Math.hypot(b.x - a.x, b.z - a.z), 0.22, 0.22);
    m4.compose(p, q, sc);
    braces.setMatrixAt(i / 2, m4);
  }

  for (const m of group.children) m.instanceMatrix.needsUpdate = true;
  scene.add(group);

  return {
    group,
    dispose() {
      scene.remove(group);
      boxGeo.dispose(); cylGeo.dispose(); mats.forEach((m) => m.dispose());
    },
  };
}
