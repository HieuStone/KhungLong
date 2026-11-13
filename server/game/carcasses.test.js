import { describe, it, expect } from 'vitest';
import { createCarcasses } from './carcasses.js';
import { BASELINE as DEFAULT_CONFIG } from './test-baseline.config.js'; // cấu hình gốc cố định (không phụ thuộc số bạn tự chỉnh)

const cfg = DEFAULT_CONFIG.carcass;
const make = (over = {}, rng) => createCarcasses({ ...cfg, ...over }, rng);
const dino = (m, species = 'tyrannosaurus', stage = 'adult') => m.add({ type: 'dino', kind: species, stage, x: 0, y: 0, z: 0 });

describe('xác: lượng thịt và thời gian tồn tại', () => {
  it('khủng long to có nhiều thịt hơn con nhỏ; con mồi nhỏ dùng dinh dưỡng riêng', () => {
    const m = make();
    const trex = dino(m, 'tyrannosaurus', 'adult');
    const rex0 = dino(m, 'tyrannosaurus', 'hatchling');
    const chicken = m.add({ type: 'npc', kind: 'chicken', x: 0, y: 0, z: 0 });
    expect(trex.meatMax).toBeCloseTo(cfg.meatPerSquareMeter * 144, 5);
    expect(trex.meatMax).toBeGreaterThan(rex0.meatMax * 10);
    expect(chicken.meatMax).toBeCloseTo(0.28, 5);
  });

  it('xác to tồn tại lâu hơn xác nhỏ (có thể tắt bằng sizeLifetimeFactor = 0)', () => {
    const m = make();
    const trex = dino(m), chicken = m.add({ type: 'npc', kind: 'chicken', x: 0, y: 0, z: 0 });
    expect(trex.fresh + trex.rot).toBeGreaterThan((chicken.fresh + chicken.rot) * 3);
    const m2 = make({ sizeLifetimeFactor: 0 });
    const a = dino(m2), b = m2.add({ type: 'npc', kind: 'chicken', x: 0, y: 0, z: 0 });
    expect(a.fresh).toBeCloseTo(b.fresh, 6);
  });

  it('còn tươi thì độ thối = 0, rồi thối dần tới 1, rồi biến mất và báo cho người đang tha', () => {
    const m = make({ freshSeconds: 10, rotSeconds: 20, sizeLifetimeFactor: 0 });
    let removed = null;
    m.setOnRemove((c) => { removed = c; });
    const c = dino(m);
    m.step(9.9);
    expect(m.rot01(c)).toBe(0);
    m.step(10); // age 19.9: nửa thối
    expect(m.rot01(c)).toBeCloseTo(0.495, 2);
    expect(m.count()).toBe(1);
    m.step(10.2); // quá hạn
    expect(m.count()).toBe(0);
    expect(removed.id).toBe(c.id);
  });

  it('hết thịt thì biến mất ngay', () => {
    const m = make();
    const c = m.add({ type: 'npc', kind: 'mouse', x: 0, y: 0, z: 0 });
    m.bite(c, 10, 10);
    m.step(0.05);
    expect(m.count()).toBe(0);
  });
});

describe('xác: cắn, dinh dưỡng và ngộ độc', () => {
  it('mỗi miếng cắn lấy thịt khỏi xác, không quá chỗ trống trong bụng', () => {
    const m = make();
    const c = dino(m);
    const before = c.meat;
    const b = m.bite(c, 0.06, 1);
    expect(b.taken).toBeCloseTo(0.06);
    expect(c.meat).toBeCloseTo(before - 0.06);
    const small = m.bite(c, 0.06, 0.01); // gần no
    expect(small.taken).toBeCloseTo(0.01);
    expect(m.bite(c, 0.06, 0).taken).toBe(0);
  });

  it('thịt tươi: đủ dinh dưỡng, không ngộ độc; thịt thối: dinh dưỡng giảm và có thể ngộ độc', () => {
    const m = make({ freshSeconds: 10, rotSeconds: 10, sizeLifetimeFactor: 0 }, () => 0); // rng = 0: luôn trúng xác suất
    const fresh = dino(m);
    const bf = m.bite(fresh, 0.06, 1);
    expect(bf.gain).toBeCloseTo(0.06);
    expect(bf.poisoned).toBe(false);

    const rotten = dino(m);
    rotten.age = rotten.fresh + rotten.rot * 0.99; // gần thối hết
    const br = m.bite(rotten, 0.06, 1);
    expect(br.gain).toBeLessThan(0.06 * 0.5);
    expect(br.poisoned).toBe(true);
  });

  it('thịt hơi thối (độ thối < 25%) chưa gây ngộ độc', () => {
    const m = make({ freshSeconds: 10, rotSeconds: 100, sizeLifetimeFactor: 0 }, () => 0);
    const c = dino(m);
    c.age = c.fresh + 10; // độ thối 10%
    expect(m.bite(c, 0.06, 1).poisoned).toBe(false);
  });
});

describe('xác: tha đi', () => {
  it('xác nhỏ thì ngậm, xác vừa thì kéo (chậm hơn), xác quá nặng thì không tha được', () => {
    const m = make();
    const chicken = m.add({ type: 'npc', kind: 'chicken', x: 0, y: 0, z: 0 });
    const plan1 = m.grabPlan(chicken, 5); // người tha dài 5 m
    expect(plan1.ok).toBe(true); expect(plan1.mode).toBe('mouth'); expect(plan1.speedMult).toBeGreaterThan(0.8);

    const medium = dino(m, 'utahraptor', 'adult'); // 5 m
    const plan2 = m.grabPlan(medium, 5);
    expect(plan2.ok).toBe(true); expect(plan2.mode).toBe('drag');
    expect(plan2.speedMult).toBeLessThan(plan1.speedMult);

    const huge = dino(m, 'tyrannosaurus', 'adult'); // 12 m
    const plan3 = m.grabPlan(huge, 5);
    expect(plan3.ok).toBe(false);
    expect(plan3.reason).toMatch(/nặng/);
    expect(m.grabPlan(huge, 12).ok).toBe(true); // con to bằng thì kéo được
  });

  it('tắt canDrag thì không ai tha được', () => {
    const m = make({ canDrag: false });
    expect(m.grabPlan(m.add({ type: 'npc', kind: 'mouse', x: 0, y: 0, z: 0 }), 12).ok).toBe(false);
  });

  it('view chứa thông tin cho client (độ thối, lượng thịt còn, đang bị tha)', () => {
    const m = make();
    const c = dino(m);
    c.carriedBy = 7; c.mode = 'drag';
    const v = m.view(c);
    expect(v).toMatchObject({ type: 'dino', kind: 'tyrannosaurus', rot: 0, meat01: 1, carried: true, mode: 'drag' });
  });
});
