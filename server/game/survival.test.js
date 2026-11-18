import { describe, it, expect } from 'vitest';
import { SPECIES, STAGE_SCALE } from '@isle/shared';
import {
  createVitals, stepVitals, eat, drink, applyDamage, stageOf, stageStats,
} from './survival.js';

const ID = 'tyrannosaurus';
const sp = SPECIES[ID];

describe('createVitals', () => {
  it('khởi tạo đầy đủ và maxHp theo chặng', () => {
    const v = createVitals(ID, 'hatchling');
    expect(v.maxHp).toBeCloseTo(sp.health * STAGE_SCALE.hatchling);
    expect(v.hp).toBe(v.maxHp);
    expect(v.hunger).toBe(1);
    expect(v.thirst).toBe(1);
    expect(v.stamina).toBe(1);
    expect(v.growth).toBe(0);
    expect(v.bleed).toBe(0);
    expect(v.sleeping).toBe(false);
  });
});

describe('đói / khát / stamina', () => {
  it('đói và khát giảm đúng theo thời gian', () => {
    const v = createVitals(ID, 'adult');
    stepVitals(v, ID, 10, { moving: false, sprinting: false, inWater: false });
    expect(v.hunger).toBeCloseTo(1 - sp.hungerRate * 0.01 * 10);
    expect(v.thirst).toBeCloseTo(1 - sp.thirstRate * 0.01 * 10);
  });

  it('sprint tốn stamina và hết thì canSprint=false', () => {
    const v = createVitals(ID, 'adult');
    let r = stepVitals(v, ID, 1, { sprinting: true });
    expect(v.stamina).toBeCloseTo(1 - 0.15);
    expect(r.canSprint).toBe(true);
    // sprint đến khi cạn stamina
    for (let i = 0; i < 20; i++) r = stepVitals(v, ID, 1, { sprinting: true });
    expect(v.stamina).toBe(0);
    expect(r.canSprint).toBe(false);
  });

  it('không sprint thì stamina hồi, ngủ hồi nhanh hơn', () => {
    const a = createVitals(ID, 'adult');
    a.stamina = 0.5;
    stepVitals(a, ID, 1, {});
    expect(a.stamina).toBeCloseTo(0.58);
    const b = createVitals(ID, 'adult');
    b.stamina = 0.5;
    b.sleeping = true;
    stepVitals(b, ID, 1, {});
    expect(b.stamina).toBeCloseTo(0.7);
  });

  it('sprint làm đói nhanh gấp đôi', () => {
    const v = createVitals(ID, 'adult');
    stepVitals(v, ID, 10, { sprinting: true });
    expect(v.hunger).toBeCloseTo(1 - sp.hungerRate * 0.01 * 10 * 2);
  });
});

describe('máu và sinh tồn', () => {
  it('hunger=0 làm hp giảm đến chết', () => {
    const v = createVitals(ID, 'adult');
    v.hunger = 0;
    let r = { dead: false };
    for (let i = 0; i < 200 && !r.dead; i++) r = stepVitals(v, ID, 1, {});
    expect(r.dead).toBe(true);
    expect(v.hp).toBe(0);
  });

  it('eat và drink kẹp ở 1', () => {
    const v = createVitals(ID, 'adult');
    v.hunger = 0.5;
    v.thirst = 0.5;
    eat(v, ID, 5);
    drink(v, 5);
    expect(v.hunger).toBe(1);
    expect(v.thirst).toBe(1);
  });

  it('eat cộng growth thêm amount*0.02', () => {
    const v = createVitals(ID, 'hatchling');
    v.hunger = 0.2;
    eat(v, ID, 0.5);
    expect(v.growth).toBeCloseTo(0.01);
  });

  it('chảy máu giảm dần về 0 và trừ hp', () => {
    const v = createVitals(ID, 'adult');
    applyDamage(v, 0, 2);
    expect(v.bleed).toBe(2);
    const hp0 = v.hp;
    stepVitals(v, ID, 1, {});
    expect(v.hp).toBeLessThan(hp0);
    expect(v.bleed).toBeCloseTo(2 - 0.2);
    // đủ lâu thì bleed về 0 và dừng
    for (let i = 0; i < 20; i++) stepVitals(v, ID, 1, {});
    expect(v.bleed).toBe(0);
  });

  it('applyDamage kẹp hp >= 0 và bleed trong 0..5', () => {
    const v = createVitals(ID, 'adult');
    applyDamage(v, 1e9, 10);
    expect(v.hp).toBe(0);
    expect(v.bleed).toBe(5);
    expect(applyDamage(createVitals(ID), 1).dead).toBe(false);
  });
});

describe('lớn dần', () => {
  it('stageOf theo mốc 0/0.25/0.5/0.75', () => {
    expect(stageOf(0)).toBe('hatchling');
    expect(stageOf(0.25)).toBe('juvenile');
    expect(stageOf(0.5)).toBe('subadult');
    expect(stageOf(0.75)).toBe('adult');
  });

  it('lên chặng mới thì maxHp tăng và tỉ lệ hp giữ nguyên', () => {
    const v = createVitals(ID, 'hatchling');
    v.growth = 0.2499;
    // 0.4 > 0.3 để growth vẫn tăng, nhưng <= 0.5 để không hồi máu (tránh lệch tỉ lệ)
    v.hunger = 0.4;
    v.thirst = 0.4;
    v.hp = v.maxHp * 0.4;
    const ratio = v.hp / v.maxHp;
    const r = stepVitals(v, ID, 1, {});
    expect(r.stage).toBe('juvenile');
    expect(v.maxHp).toBeCloseTo(sp.health * STAGE_SCALE.juvenile);
    expect(v.hp / v.maxHp).toBeCloseTo(ratio, 5);
  });

  it('growth tăng 1/1200 mỗi giây khi ăn uống đủ, không tăng khi đói', () => {
    const w = createVitals(ID, 'adult');
    w.growth = 0;
    stepVitals(w, ID, 1, {});
    expect(w.growth).toBeCloseTo(1 / 1200);
    const z = createVitals(ID, 'adult');
    z.growth = 0;
    z.hunger = 0.2;
    stepVitals(z, ID, 1, {});
    expect(z.growth).toBe(0);
  });
});

describe('stageStats', () => {
  it('nhân theo STAGE_SCALE và speed theo căn bậc hai scale', () => {
    const s = stageStats(ID, 'juvenile');
    const f = Math.sqrt(STAGE_SCALE.juvenile);
    expect(s.scale).toBe(STAGE_SCALE.juvenile);
    expect(s.maxHp).toBeCloseTo(sp.health * STAGE_SCALE.juvenile);
    expect(s.speed).toBeCloseTo(sp.speed * f);
    expect(s.sprintSpeed).toBeCloseTo(sp.sprintSpeed * f);
  });
});
