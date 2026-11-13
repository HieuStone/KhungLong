import { describe, it, expect } from 'vitest';
import {
  mulberry32, maxWadeDepth, getWorld, stepBody, pushOutOfObstacles, separateBodies, findSpawn, bodyRadius, bodyMass,
  heightAt, PHYS, WATER_LEVEL, WORLD_HALF, TICK_DT,
} from './index.js';

const world = getWorld();

// Mô phỏng một thực thể đi theo hướng (dx, dz) trong `steps` tick; trả về quỹ đạo.
function walk(start, dx, dz, steps, speed = 8, r = 0.5) {
  const b = { x: start.x, z: start.z, vx: 0, vz: 0 };
  const path = [];
  for (let i = 0; i < steps; i++) {
    stepBody(b, r, dx, dz, speed, TICK_DT);
    path.push({ x: b.x, z: b.z });
  }
  return { b, path };
}

describe('thế giới dùng chung', () => {
  it('sinh xác định: hai lần gọi cho cùng dữ liệu', () => {
    const w2 = getWorld();
    expect(w2.plants.length).toBe(world.plants.length);
    expect(world.plants.length).toBeGreaterThan(3000);
    expect(world.rocks.length).toBeGreaterThan(600);
    expect(world.plants[0]).toEqual(w2.plants[0]);
  });

  it('đa dạng: đủ 6 loại cây và 5 loại đá, kích thước đá trải rộng', () => {
    expect(new Set(world.plants.map((p) => p.kind)).size).toBe(6);
    expect(new Set(world.rocks.map((r) => r.kind)).size).toBe(5);
    const ws = world.rocks.map((r) => r.w);
    expect(Math.max(...ws) / Math.min(...ws)).toBeGreaterThan(8);
    const scales = world.plants.filter((p) => p.kind === 'pine').map((p) => p.scale);
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.6);
  });

  it('cây/đá nằm trên cạn; vật cản chắn đường có bán kính hợp lý, bụi và sỏi thì không chắn', () => {
    for (const o of [...world.plants, ...world.rocks]) {
      expect(o.y).toBeGreaterThan(0.9);
      if (o.kind === 'bush' || o.kind === 'fern' || o.kind === 'pebbles') expect(o.r).toBe(0);
      else expect(o.r).toBeGreaterThan(0.2);
    }
  });
});

describe('va chạm cây/đá', () => {
  it('không bao giờ đi xuyên vào cây hay đá (nhiều hướng, nhiều vật cản)', () => {
    const r = 0.8;
    let checked = 0;
    const solidRocks = world.rocks.filter((r) => r.r > 0);
    for (const o of [...world.trees.slice(0, 40), ...solidRocks.slice(0, 40)]) {
      for (const ang of [0, 1.3, 2.6, 4]) {
        const start = { x: o.x + Math.cos(ang) * 7, z: o.z + Math.sin(ang) * 7 };
        // đi thẳng về phía tâm vật cản
        const { path } = walk(start, -Math.cos(ang), -Math.sin(ang), 120, 8, r);
        for (const p of path) {
          for (const q of world.nearby(p.x, p.z, r)) {
            const d = Math.hypot(p.x - q.x, p.z - q.z);
            // dung sai 2 cm: hai vật cản đè nhau thì không thể thoả mãn cả hai tuyệt đối
            expect(d).toBeGreaterThanOrEqual(r + q.r - 0.02);
          }
        }
        checked++;
      }
    }
    expect(checked).toBe(320);
  });

  it('trượt dọc theo vật cản thay vì dính lại', () => {
    // Đặt một thực thể sát bên vật cản, đẩy lệch tâm: thành phần vận tốc đâm vào vật cản bị triệt, còn thành phần tiếp tuyến được giữ
    const o = world.rocks.find((r) => r.r > 0);
    const r = 0.6;
    const x = o.x - (o.r + r) + 0.01, z = o.z; // đang chạm bên trái vật cản
    const res = pushOutOfObstacles(x, z, r);
    expect(res.hit).toBe(true);
    expect(res.nx).toBeLessThan(0); // pháp tuyến chỉ ra phía ngoài (bên trái)
    const dist = Math.hypot(res.x - o.x, res.z - o.z);
    expect(dist).toBeGreaterThanOrEqual(o.r + r - 1e-6);
  });
});

describe('quán tính và địa hình', () => {
  it('tăng tốc dần, không đạt tốc độ tối đa ngay tick đầu', () => {
    const s = findSpawn(mulberry32(7)); // chỗ đứng hợp lệ, xác định
    // thử vài hướng cho tới khi có hướng không bị chặn
    let done = false;
    for (let a = 0; a < 8 && !done; a++) {
      const dx = Math.cos(a * Math.PI / 4), dz = Math.sin(a * Math.PI / 4);
      const b = { x: s.x, z: s.z, vx: 0, vz: 0 };
      stepBody(b, 0.5, dx, dz, 10, TICK_DT);
      const v1 = Math.hypot(b.vx, b.vz);
      if (v1 === 0) continue;
      for (let i = 0; i < 40; i++) stepBody(b, 0.5, dx, dz, 10, TICK_DT);
      expect(v1).toBeLessThan(5); // chưa đạt tốc độ tối đa 10 ngay tick đầu
      expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(v1);
      done = true;
    }
    expect(done).toBe(true);
  });

  it('thả phím thì giảm tốc dần chứ không dừng đột ngột', () => {
    const s = findSpawn();
    const b = { x: s.x, z: s.z, vx: 6, vz: 0 };
    stepBody(b, 0.5, 0, 0, 10, TICK_DT);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(6);
  });

  it('nước quá sâu thì bị chặn, không vào được', () => {
    // tìm điểm bờ biển: đi từ giữa đảo ra biển theo +x
    let x = 0, z = 0;
    const s = findSpawn(); x = s.x; z = s.z;
    const { path } = walk({ x, z }, 1, 0, 2000, 14, 0.5);
    for (const p of path) {
      expect(WATER_LEVEL - heightAt(p.x, p.z)).toBeLessThanOrEqual(PHYS.maxWaterDepth + 0.3);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(WORLD_HALF);
    }
  });

  it('con nhỏ chỉ lội được nước nông, con lớn lội sâu hơn', () => {
    expect(maxWadeDepth('dryosaurus', 'hatchling')).toBeLessThan(1);
    expect(maxWadeDepth('tyrannosaurus', 'adult')).toBeGreaterThan(4);
    expect(maxWadeDepth('dryosaurus', 'hatchling')).toBeLessThan(maxWadeDepth('dryosaurus', 'adult'));
    // thực tế: đi từ giữa đảo ra biển, con nhỏ không bao giờ vào nước sâu hơn giới hạn của nó
    const limit = maxWadeDepth('dryosaurus', 'hatchling');
    const s = findSpawn(mulberry32(5));
    for (const a of [0, 1.5, 3, 4.5]) {
      const b = { x: s.x, z: s.z, vx: 0, vz: 0 };
      for (let k = 0; k < 1500; k++) {
        stepBody(b, 0.4, Math.cos(a), Math.sin(a), 12, TICK_DT, limit);
        expect(WATER_LEVEL - heightAt(b.x, b.z)).toBeLessThanOrEqual(limit + 0.3);
      }
    }
  });

  it('bản đồ có sườn dốc hơn ngưỡng leo (để các test dốc có ý nghĩa)', () => {
    let steep = 0;
    for (let x = -450; x <= 450; x += 6) for (let z = -450; z <= 450; z += 6) {
      const y = heightAt(x, z);
      if (y > 1.5 && Math.hypot(heightAt(x + 1, z) - y, heightAt(x, z + 1) - y) > PHYS.maxClimbSlope) steep++;
    }
    expect(steep).toBeGreaterThan(50);
  });

  it('mọi bước đi đều không vượt ngưỡng dốc (không leo vách), từ nhiều điểm và hướng', () => {
    const rng = mulberry32(99);
    let blockedSomewhere = 0;
    for (let i = 0; i < 60; i++) {
      const s = findSpawn(rng);
      const a = rng() * Math.PI * 2;
      const b = { x: s.x, z: s.z, vx: 0, vz: 0 };
      for (let k = 0; k < 400; k++) {
        const px = b.x, pz = b.z;
        const res = stepBody(b, 0.5, Math.cos(a), Math.sin(a), 12, TICK_DT);
        const d = Math.hypot(b.x - px, b.z - pz);
        if (d > 1e-3) {
          const slope = (heightAt(b.x, b.z) - heightAt(px, pz)) / d;
          // sau khi đẩy khỏi cây/đá vị trí có thể lệch chút; cho dung sai nhỏ
          expect(slope).toBeLessThanOrEqual(PHYS.maxClimbSlope + 0.15);
        }
        if (res.blocked) blockedSomewhere++;
      }
    }
    expect(blockedSomewhere).toBeGreaterThan(0); // có lúc bị chặn (vách/nước/vật cản), tức là cơ chế đang hoạt động
  });
});

describe('va chạm giữa các khủng long', () => {
  it('đẩy nhau ra, con nặng đẩy con nhẹ nhiều hơn', () => {
    const big = { x: 0, z: 0, r: bodyRadius('tyrannosaurus', 'adult'), mass: bodyMass('tyrannosaurus', 'adult') };
    const small = { x: 1, z: 0, r: bodyRadius('dryosaurus', 'adult'), mass: bodyMass('dryosaurus', 'adult') };
    expect(separateBodies(big, small)).toBe(true);
    // hết đè nhau
    expect(Math.hypot(big.x - small.x, big.z - small.z)).toBeGreaterThanOrEqual(big.r + small.r - 1e-6);
    // con nhỏ bị đẩy xa hơn con lớn
    expect(Math.abs(small.x - 1)).toBeGreaterThan(Math.abs(big.x - 0));
  });

  it('không va chạm khi ở xa nhau', () => {
    const a = { x: 0, z: 0, r: 1, mass: 10 }, b = { x: 10, z: 0, r: 1, mass: 10 };
    expect(separateBodies(a, b)).toBe(false);
  });
});

describe('hồi sinh', () => {
  it('findSpawn trả vị trí trên cạn, không đè cây/đá', () => {
    for (let i = 0; i < 30; i++) {
      const s = findSpawn();
      expect(heightAt(s.x, s.z)).toBeGreaterThan(1.5);
      expect(pushOutOfObstacles(s.x, s.z, 3).hit).toBe(false);
    }
  });
});
