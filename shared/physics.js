import { WATER_LEVEL, WORLD_HALF, STAGE_SCALE } from './constants.js';
import { SPECIES } from './species.js';
import { heightAt } from './terrain.js';
import { getWorld, groundAt } from './world.js';

// Thông số vật lý (mét, giây). Đặt ở đây để client dự đoán và server dùng y hệt.
export const PHYS = {
  accel: 7,           // hệ số quán tính: tốc độ tiến về tốc độ mong muốn theo 1 - exp(-accel*dt)
  maxClimbSlope: 0.45, // dốc tối đa leo được (độ cao/độ dài ngang, ~24 độ); dốc hơn là sườn núi, chặn.
                       // Đo trên bản đồ hiện tại: p95 = 0.41, p99 = 0.52, max = 0.72 => chặn khoảng 4% đất liền.
  slopeSlowdown: 0.6, // leo dốc giảm tốc tối đa 60%
  wadeDepth: 0.5,     // nước sâu hơn mức này bắt đầu cản chân
  maxWaterDepth: 4,   // khủng long không bơi: nước sâu hơn mức này là chặn
  wadeSlowdown: 0.55, // lội nước sâu giảm tốc tối đa 55%
};

/** Bán kính thân (vòng tròn va chạm trên mặt phẳng XZ) theo loài và giai đoạn lớn. */
export function bodyRadius(speciesId, stage) {
  const sp = SPECIES[speciesId];
  return Math.max(0.35, sp.bodyLength * 0.12 * STAGE_SCALE[stage]);
}

/** Độ sâu nước tối đa đi bộ được: con càng lớn càng lội sâu (không biết bơi). VD Dryosaurus con ~0.8 m, T-rex trưởng thành ~4.7 m. */
export function maxWadeDepth(speciesId, stage) {
  const sp = SPECIES[speciesId];
  return 0.5 + 0.35 * sp.bodyLength * STAGE_SCALE[stage];
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Tốc độ quay tối đa (rad/s): con càng to quay càng chậm (T-rex trưởng thành ~1.3 rad/s, Dryosaurus con ~4.8 rad/s). */
export function turnRate(speciesId, stage, sprinting = false) {
  const sp = SPECIES[speciesId];
  const size = sp.bodyLength * STAGE_SCALE[stage];
  return (4.2 / (0.7 + size * 0.22)) * (sprinting ? 0.65 : 1);
}

/**
 * Quay thân từ `heading` về `targetYaw` với tối đa `maxTurn` rad.
 * Trả về { heading, diff }: heading mới và góc lệch còn lại (-π..π) để tính tốc độ.
 * Quy ước yaw: 0 hướng về -Z; vector hướng mặt = (-sin yaw, -cos yaw).
 */
export function steerHeading(heading, targetYaw, maxTurn) {
  const diff = wrapPi(targetYaw - heading);
  const step = Math.max(-maxTurn, Math.min(maxTurn, diff));
  return { heading: wrapPi(heading + step), diff: wrapPi(diff - step) };
}

/** Yaw tương ứng với hướng đi (dx, dz) theo quy ước trên. */
export const yawOfDirection = (dx, dz) => Math.atan2(-dx, -dz);

/** Khối lượng tương đối: con to đẩy con nhỏ. */
export function bodyMass(speciesId, stage) {
  const sp = SPECIES[speciesId];
  const s = sp.bodyLength * STAGE_SCALE[stage];
  return s * s;
}

/** Độ dốc mặt đất (độ cao/độ dài ngang) giữa hai điểm. */
function slopeBetween(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (d < 1e-6) return 0;
  return (groundAt(x1, z1) - groundAt(x0, z0)) / d;
}

/** Độ lấn sâu lớn nhất (m) của vòng tròn (x, z, r) vào các vật cản; 0 nếu không đè lên vật nào. */
export function overlapDepth(x, z, r) {
  let worst = 0;
  for (const o of getWorld().nearby(x, z, r)) {
    const pen = r + o.r - Math.hypot(x - o.x, z - o.z);
    if (pen > worst) worst = pen;
  }
  return worst;
}

/** Đẩy vòng tròn (x, z, r) ra khỏi cây/đá. Trả về {x, z, hit, nx, nz} (n = pháp tuyến va chạm cuối). */
export function pushOutOfObstacles(x, z, r) {
  const world = getWorld();
  let hit = false, nx = 0, nz = 0;
  for (let iter = 0; iter < 8; iter++) { // lặp nhiều lần để xử lý cụm vật cản đè nhau (đá lớn sát nhau)
    let moved = false;
    for (const o of world.nearby(x, z, r)) {
      const dx = x - o.x, dz = z - o.z;
      const min = r + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const nxx = dx / d, nzz = dz / d;
      x = o.x + nxx * min; z = o.z + nzz * min;
      hit = true; nx = nxx; nz = nzz; moved = true;
    }
    if (!moved) break;
  }
  return { x, z, hit, nx, nz };
}

/**
 * Di chuyển một thực thể một bước, có đầy đủ vật lý:
 *  - quán tính (tăng/giảm tốc mượt),
 *  - leo dốc chậm hơn, vách quá dốc thì bị chặn (trượt dọc theo vách),
 *  - lội nước sâu chậm hơn, nước quá sâu thì bị chặn,
 *  - va chạm cây/đá: trượt dọc theo vật cản chứ không dính lại.
 * body: { x, z, vx, vz }  (sửa tại chỗ).  want: { dx, dz } hướng mong muốn đã chuẩn hoá, speed: m/s tối đa.
 * Trả về { moving, blocked }.
 */
export function stepBody(body, r, wantX, wantZ, speed, dt, maxDepth = PHYS.maxWaterDepth) {
  // 1) Tốc độ mong muốn sau khi tính ảnh hưởng địa hình tại chỗ đứng
  const y0 = groundAt(body.x, body.z);
  const depth = WATER_LEVEL - y0;
  let mult = 1;
  if (depth > PHYS.wadeDepth) {
    mult *= 1 - PHYS.wadeSlowdown * Math.min(1, (depth - PHYS.wadeDepth) / Math.max(0.1, maxDepth - PHYS.wadeDepth));
  }
  if (wantX || wantZ) {
    const ahead = slopeBetween(body.x, body.z, body.x + wantX * 2, body.z + wantZ * 2);
    if (ahead > 0) mult *= 1 - PHYS.slopeSlowdown * Math.min(1, ahead / PHYS.maxClimbSlope);
  }
  const tx = wantX * speed * mult, tz = wantZ * speed * mult;

  // 2) Quán tính: tốc độ tiến dần về mục tiêu (phanh nhanh hơn khi thả phím)
  const k = 1 - Math.exp(-(wantX || wantZ ? PHYS.accel : PHYS.accel * 1.5) * dt);
  body.vx += (tx - body.vx) * k;
  body.vz += (tz - body.vz) * k;

  // 3) Dịch chuyển, kiểm tra từng trục để trượt dọc vách/nước sâu thay vì dừng hẳn
  const tryMove = (nx, nz) => {
    if (Math.abs(nx) > WORLD_HALF || Math.abs(nz) > WORLD_HALF) return false;
    if (WATER_LEVEL - groundAt(nx, nz) > maxDepth) return false;
    if (slopeBetween(body.x, body.z, nx, nz) > PHYS.maxClimbSlope) return false;
    return true;
  };
  let nx = body.x + body.vx * dt, nz = body.z + body.vz * dt;
  let blocked = false;
  if (!tryMove(nx, nz)) {
    blocked = true;
    if (tryMove(body.x + body.vx * dt, body.z)) { nz = body.z; body.vz = 0; }
    else if (tryMove(body.x, body.z + body.vz * dt)) { nx = body.x; body.vx = 0; }
    else { nx = body.x; nz = body.z; body.vx = 0; body.vz = 0; }
  }

  // 4) Va chạm cây/đá: đẩy ra và triệt tiêu thành phần vận tốc đâm vào vật cản (=> trượt dọc)
  const res = pushOutOfObstacles(nx, nz, r);
  if (res.hit) {
    const into = body.vx * res.nx + body.vz * res.nz;
    if (into < 0) { body.vx -= into * res.nx; body.vz -= into * res.nz; }
    blocked = true;
    // Khe giữa hai vật cản hẹp hơn thân: không đẩy ra hết được => không cho chui vào, giữ nguyên chỗ cũ
    // (trừ khi chỗ cũ cũng đang kẹt, để không bị mắc kẹt vĩnh viễn)
    if (overlapDepth(res.x, res.z, r) > 0.01 && overlapDepth(body.x, body.z, r) <= 0.01) {
      body.vx = 0; body.vz = 0;
      return { moving: false, blocked: true };
    }
  }
  body.x = res.x; body.z = res.z;
  return { moving: Math.hypot(body.vx, body.vz) > 0.1, blocked };
}


// ---------------- Bay ----------------
export const FLIGHT = {
  accel: 1.7,        // quán tính ngang khi bay (nhỏ hơn đi bộ: bay lượn, đổi hướng mượt)
  glideFrac: 0.4,    // không bấm gì: lướt với 40% tốc độ bay
  brakeFrac: 0.15,   // bấm lùi: phanh còn 15%
  glideSink: 1.8,    // m/s chìm dần khi lướt (không vỗ cánh)
  exhaustedSink: 5,  // m/s rơi khi hết thể lực
  waterSkim: 1.2,    // trên nước sâu không hạ cánh được: giữ cách mặt nước tối thiểu (m)
  clearance: 0.6,    // chừa khoảng trống trên đỉnh cây/đá khi bay sát
};

/** Đỉnh (độ cao tuyệt đối, m) của một vật cản (cây, đá, cột lan can). */
export const obstacleTop = (o) => o.y + (o.h || o.hgt || 2);

/** Đẩy vòng tròn (x, z, r) ra khỏi các vật cản CAO HƠN độ cao tuyệt đối `fy` (bay trên đỉnh thì không bị chắn). */
export function pushOutOfTallObstacles(x, z, r, fy) {
  const world = getWorld();
  let hit = false, nx = 0, nz = 0;
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const o of world.nearby(x, z, r)) {
      if (fy > obstacleTop(o) + FLIGHT.clearance) continue; // đang bay cao hơn vật cản
      const dx = x - o.x, dz = z - o.z, min = r + o.r, d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-4;
      x = o.x + (dx / d) * min; z = o.z + (dz / d) * min;
      hit = true; nx = dx / d; nz = dz / d; moved = true;
    }
    if (!moved) break;
  }
  return { x, z, hit, nx, nz };
}

/**
 * Một bước bay ngang: quán tính, giới hạn bản đồ, va chạm với vật cản cao hơn độ cao hiện tại.
 * body: { x, z, vx, vz } (sửa tại chỗ); (wantX, wantZ) hướng đã chuẩn hoá; speed m/s; fy độ cao tuyệt đối.
 */
export function stepFlyer(body, r, wantX, wantZ, speed, dt, fy) {
  const k = 1 - Math.exp(-FLIGHT.accel * dt);
  body.vx += (wantX * speed - body.vx) * k;
  body.vz += (wantZ * speed - body.vz) * k;
  let nx = body.x + body.vx * dt, nz = body.z + body.vz * dt;
  if (Math.abs(nx) > WORLD_HALF) { nx = Math.sign(nx) * WORLD_HALF; body.vx = 0; }
  if (Math.abs(nz) > WORLD_HALF) { nz = Math.sign(nz) * WORLD_HALF; body.vz = 0; }
  const res = pushOutOfTallObstacles(nx, nz, r, fy);
  if (res.hit) {
    const into = body.vx * res.nx + body.vz * res.nz;
    if (into < 0) { body.vx -= into * res.nx; body.vz -= into * res.nz; }
  }
  body.x = res.x; body.z = res.z;
  return { blocked: res.hit };
}

/**
 * Hai thực thể đè nhau thì đẩy ra, con nặng đẩy con nhẹ (tỉ lệ nghịch khối lượng).
 * a, b: { x, z, r, mass }. Trả true nếu có va chạm. Sửa x, z tại chỗ.
 */
export function separateBodies(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const min = a.r + b.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1e-4;
  const nx = dx / d || 1, nz = dz / d || 0;
  const overlap = min - d;
  const total = a.mass + b.mass;
  const wa = b.mass / total, wb = a.mass / total; // con nhẹ (mass nhỏ) bị đẩy nhiều hơn
  a.x -= nx * overlap * wa; a.z -= nz * overlap * wa;
  b.x += nx * overlap * wb; b.z += nz * overlap * wb;
  return true;
}

/** Tìm chỗ đứng hợp lệ để hồi sinh: trên cạn, không dốc, không đè cây/đá. */
export function findSpawn(rng = Math.random) {
  for (let i = 0; i < 500; i++) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.6, z = (rng() * 2 - 1) * WORLD_HALF * 0.6;
    const y = heightAt(x, z);
    if (y < 2 || y > 14) continue;
    if (Math.abs(slopeBetween(x, z, x + 3, z)) > 0.4 || Math.abs(slopeBetween(x, z, x, z + 3)) > 0.4) continue;
    if (pushOutOfObstacles(x, z, 3).hit) continue;
    return { x, z };
  }
  return { x: 0, z: 0 };
}
