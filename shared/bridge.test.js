import { describe, it, expect } from 'vitest';
import {
  getWorld, groundAt, heightAt, stepBody, bodyRadius, maxWadeDepth, WATER_LEVEL, TICK_DT, PHYS,
} from './index.js';

const world = getWorld();
const br = world.bridge;

describe('cầu nối hai đảo', () => {
  it('có cầu, dài hợp lý, hai đầu nằm trên đất liền còn giữa cầu là nước', () => {
    expect(br).toBeTruthy();
    expect(br.len).toBeGreaterThan(60);
    expect(br.len).toBeLessThan(160);
    expect(heightAt(br.ax, br.az)).toBeGreaterThan(1);
    expect(heightAt(br.bx, br.bz)).toBeGreaterThan(1);
    const mx = br.ax + br.dx * br.len / 2, mz = br.az + br.dz * br.len / 2;
    expect(heightAt(mx, mz)).toBeLessThan(WATER_LEVEL); // giữa cầu là eo biển
  });

  it('mặt cầu cao hơn mặt nước ở giữa và hoà liền vào bờ ở hai đầu', () => {
    const mid = groundAt(br.ax + br.dx * br.len / 2, br.az + br.dz * br.len / 2);
    expect(mid - WATER_LEVEL).toBeGreaterThan(1.5);
    // gần hai đầu: độ cao mặt đứng không nhảy vọt (liên tục)
    for (const t of [0.02, 0.98]) {
      const x = br.ax + br.dx * br.len * t, z = br.az + br.dz * br.len * t;
      expect(Math.abs(groundAt(x, z) - heightAt(x, z))).toBeLessThan(1.2);
    }
    // ngoài bề rộng cầu thì là địa hình/nước
    const x = br.ax + br.dx * br.len / 2 + br.nx * (br.halfW + 2), z = br.az + br.dz * br.len / 2 + br.nz * (br.halfW + 2);
    expect(groundAt(x, z)).toBeCloseTo(heightAt(x, z), 6);
  });

  it('độ dốc dọc mặt cầu leo được', () => {
    let prev = null, maxSlope = 0;
    for (let s = 0; s <= br.len; s += 1) {
      const y = groundAt(br.ax + br.dx * s, br.az + br.dz * s);
      if (prev !== null) maxSlope = Math.max(maxSlope, Math.abs(y - prev));
      prev = y;
    }
    expect(maxSlope).toBeLessThan(PHYS.maxClimbSlope * 0.7); // mỗi mét dọc cầu độ cao đổi < 0.31 m
  });

  it('lối cầu không có cây hay đá chắn', () => {
    const margin = 5;
    for (const o of [...world.plants, ...world.rocks]) {
      const s = (o.x - br.ax) * br.dx + (o.z - br.az) * br.dz;
      const lat = (o.x - br.ax) * br.nx + (o.z - br.az) * br.nz;
      const inside = s > -margin && s < br.len + margin && Math.abs(lat) < br.halfW + margin;
      expect(inside).toBe(false);
    }
  });

  it('cột lan can hai bên cầu là vật cản', () => {
    expect(br.posts.length).toBeGreaterThan(60);
    const mid = br.posts[Math.floor(br.posts.length / 2)];
    expect(world.nearby(mid.x, mid.z, 0.5)).toContain(mid);
  });
});

describe('đi qua cầu', () => {
  for (const [species, stage] of [['dryosaurus', 'adult'], ['utahraptor', 'adult'], ['triceratops', 'adult'], ['tyrannosaurus', 'adult']]) {
    it(`${species} (${stage}) đi từ đảo này sang đảo kia, không rơi xuống nước và không bị mắc kẹt`, () => {
      const r = bodyRadius(species, stage);
      const limit = maxWadeDepth(species, stage);
      const body = { x: br.ax - br.dx * 4, z: br.az - br.dz * 4, vx: 0, vz: 0 };
      let reached = false, maxDepth = -Infinity;
      for (let k = 0; k < 20 * 60 && !reached; k++) { // tối đa 60 giây
        stepBody(body, r, br.dx, br.dz, 9, TICK_DT, limit);
        maxDepth = Math.max(maxDepth, WATER_LEVEL - groundAt(body.x, body.z));
        const s = (body.x - br.ax) * br.dx + (body.z - br.az) * br.dz;
        if (s > br.len + 4) reached = true;
      }
      expect(reached).toBe(true);
      expect(maxDepth).toBeLessThan(0.6); // trên cầu/đất liền, không lội nước
    });
  }

  it('lan can giữ khủng long không đi lệch ra mép cầu', () => {
    const r = bodyRadius('utahraptor', 'adult');
    // đứng giữa cầu rồi đi thẳng ngang ra mép
    const t = 0.5;
    const body = { x: br.ax + br.dx * br.len * t, z: br.az + br.dz * br.len * t, vx: 0, vz: 0 };
    for (let k = 0; k < 20 * 10; k++) stepBody(body, r, br.nx, br.nz, 9, TICK_DT, 0.5);
    const lat = (body.x - br.ax) * br.nx + (body.z - br.az) * br.nz;
    expect(Math.abs(lat)).toBeLessThanOrEqual(br.halfW - 0.2);
    // và ngược lại phía bên kia
    const body2 = { x: br.ax + br.dx * br.len * t, z: br.az + br.dz * br.len * t, vx: 0, vz: 0 };
    for (let k = 0; k < 20 * 10; k++) stepBody(body2, r, -br.nx, -br.nz, 9, TICK_DT, 0.5);
    const lat2 = (body2.x - br.ax) * br.nx + (body2.z - br.az) * br.nz;
    expect(Math.abs(lat2)).toBeLessThanOrEqual(br.halfW - 0.2);
  });
});
