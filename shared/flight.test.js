import { describe, it, expect } from 'vitest';
import {
  getWorld, stepFlyer, pushOutOfTallObstacles, obstacleTop, FLIGHT, SPECIES, SPECIES_IDS, TICK_DT, WORLD_HALF,
} from './index.js';

const world = getWorld();
// một cây thông cao, thân chắn đường
const tree = world.plants.find((p) => p.kind === 'pine' && p.h > 12 && p.r > 0.5);

describe('loài bay', () => {
  it('Pteranodon có cấu hình bay hợp lý và có trong danh sách loài', () => {
    expect(SPECIES_IDS).toContain('pteranodon');
    const fl = SPECIES.pteranodon.flight;
    expect(fl.speed).toBeGreaterThan(SPECIES.pteranodon.sprintSpeed * 2); // bay nhanh hơn chạy nhiều
    expect(fl.maxAlt).toBeGreaterThan(30);
    expect(SPECIES.tyrannosaurus.flight).toBeUndefined();
  });
});

describe('va chạm khi bay', () => {
  it('bay thấp: thân cây chắn đường (không xuyên qua)', () => {
    const fy = tree.y + 2; // dưới ngọn cây
    const r = 0.8;
    const body = { x: tree.x - 8, z: tree.z, vx: 0, vz: 0 };
    let minGap = Infinity;
    for (let k = 0; k < 200; k++) {
      stepFlyer(body, r, 1, 0, 20, TICK_DT, fy);
      minGap = Math.min(minGap, Math.hypot(body.x - tree.x, body.z - tree.z) - r - tree.r);
    }
    expect(minGap).toBeGreaterThanOrEqual(-0.02);
  });

  it('bay cao hơn ngọn cây: bay thẳng qua, không bị chắn', () => {
    const fy = obstacleTop(tree) + FLIGHT.clearance + 1;
    const r = 0.8;
    const body = { x: tree.x - 8, z: tree.z, vx: 0, vz: 0 };
    let crossed = false;
    for (let k = 0; k < 200; k++) {
      stepFlyer(body, r, 1, 0, 20, TICK_DT, fy);
      if (body.x > tree.x + 3) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('pushOutOfTallObstacles bỏ qua vật cản thấp hơn độ cao đang bay', () => {
    const low = pushOutOfTallObstacles(tree.x, tree.z, 0.5, obstacleTop(tree) + 5);
    expect(low.hit).toBe(false);
    const hit = pushOutOfTallObstacles(tree.x + 0.1, tree.z, 0.5, tree.y + 1);
    expect(hit.hit).toBe(true);
  });

  it('không bay ra ngoài bản đồ', () => {
    const body = { x: WORLD_HALF - 5, z: 0, vx: 0, vz: 0 };
    for (let k = 0; k < 400; k++) stepFlyer(body, 0.8, 1, 0, 30, TICK_DT, 80);
    expect(Math.abs(body.x)).toBeLessThanOrEqual(WORLD_HALF + 1e-9);
  });

  it('quán tính khi bay: không đạt tốc độ tối đa ngay lập tức, đổi hướng mượt', () => {
    const body = { x: 0, z: 0, vx: 0, vz: 0 };
    stepFlyer(body, 0.8, 1, 0, 20, TICK_DT, 80);
    expect(Math.hypot(body.vx, body.vz)).toBeLessThan(5);
    for (let k = 0; k < 60; k++) stepFlyer(body, 0.8, 1, 0, 20, TICK_DT, 80);
    expect(body.vx).toBeGreaterThan(15);
    // đổi hướng sang +z: vx giảm dần chứ không về 0 ngay
    stepFlyer(body, 0.8, 0, 1, 20, TICK_DT, 80);
    expect(body.vx).toBeGreaterThan(10);
  });
});
