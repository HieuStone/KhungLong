import { describe, it, expect } from 'vitest';
import { NPC_KINDS, NPC_IDS, heightAt, WATER_LEVEL, overlapDepth, TICK_DT, steerHeading, yawOfDirection, turnRate } from '@isle/shared';
import { createNpcs } from './npcs.js';

const fakePlayer = (x, z, sleeping = false) => ({ x, z, vx: 0, vz: 0, vitals: { sleeping } });
const run = (mgr, seconds, players) => { for (let i = 0; i < seconds / TICK_DT; i++) mgr.step(TICK_DT, players); };

describe('NPC', () => {
  it('sinh đủ số lượng từng loài, trên cạn', () => {
    const m = createNpcs(5);
    for (const k of NPC_IDS) expect([...m.npcs.values()].filter((n) => n.kind === k).length).toBe(NPC_KINDS[k].count);
    for (const n of m.npcs.values()) expect(heightAt(n.x, n.z)).toBeGreaterThan(WATER_LEVEL);
  });

  it('lang thang chậm khi không có người chơi, không đi vào nước sâu hoặc vật cản', () => {
    const m = createNpcs(5);
    run(m, 30, []);
    for (const n of m.npcs.values()) {
      expect(WATER_LEVEL - heightAt(n.x, n.z)).toBeLessThan(0.5);
      const spd = Math.hypot(n.vx, n.vz);
      expect(spd).toBeLessThanOrEqual(NPC_KINDS[n.kind].walk * 1.2 + 0.5);
      if (n.state !== 'fly') expect(overlapDepth(n.x, n.z, NPC_KINDS[n.kind].bodyLength * 0.45)).toBeLessThan(0.05);
    }
  });

  it('thấy người chơi lại gần thì chạy ra xa (thỏ/gà/chuột) hoặc bay lên (chim)', () => {
    const m = createNpcs(5);
    const rabbit = [...m.npcs.values()].find((n) => n.kind === 'rabbit');
    const bird = [...m.npcs.values()].find((n) => n.kind === 'bird');
    // đặt hai con khác nhau cạnh người chơi
    const player = fakePlayer(rabbit.x - 6, rabbit.z);
    const d0 = Math.hypot(rabbit.x - player.x, rabbit.z - player.z);
    run(m, 3, [player]);
    expect(Math.hypot(rabbit.x - player.x, rabbit.z - player.z)).toBeGreaterThan(d0 + 3);

    const p2 = fakePlayer(bird.x - 5, bird.z);
    run(m, 2, [p2]);
    expect(bird.state).toBe('fly');
    expect(bird.alt).toBeGreaterThan(2);
  });

  it('người chơi đang ngủ thì không làm con mồi sợ', () => {
    const m = createNpcs(5);
    const chicken = [...m.npcs.values()].find((n) => n.kind === 'chicken');
    const sleeper = fakePlayer(chicken.x - 4, chicken.z, true);
    run(m, 1, [sleeper]);
    expect(chicken.state).not.toBe('flee');
  });

  it('bị giết thì rời danh sách NPC, trả thông tin để tạo xác, và con mới xuất hiện sau một lúc', () => {
    const m = createNpcs(5);
    const mouse = [...m.npcs.values()].find((n) => n.kind === 'mouse');
    const total = m.count();
    const res = m.damage(mouse, 100);
    expect(res.killed).toBe(true);
    expect(res.corpse.kind).toBe('mouse');
    expect(Number.isFinite(res.corpse.x) && Number.isFinite(res.corpse.z)).toBe(true);
    expect(m.npcs.has(mouse.id)).toBe(false);
    expect(m.count()).toBe(total - 1);
    run(m, 25, []);
    expect(m.count()).toBe(total); // đã hồi sinh con mới
  });

  it('con sống thì không ăn được; bị đánh nhưng chưa chết thì hoảng chạy', () => {
    const m = createNpcs(5);
    const rabbit = [...m.npcs.values()].find((n) => n.kind === 'rabbit');
    expect(m.bite(rabbit, 0.1)).toBe(0);
    expect(m.damage(rabbit, 1, rabbit.x - 2, rabbit.z).killed).toBe(false);
    expect(rabbit.state).toBe('flee');
    expect(rabbit.dirX).toBeGreaterThan(0.9); // chạy ra xa kẻ tấn công (ở bên trái)
  });
});

describe('quay thân (chuyển động thực tế)', () => {
  it('con to quay chậm hơn con nhỏ; chạy nhanh quay chậm hơn đi bộ', () => {
    expect(turnRate('tyrannosaurus', 'adult')).toBeLessThan(turnRate('dryosaurus', 'adult'));
    expect(turnRate('tyrannosaurus', 'adult')).toBeLessThan(turnRate('tyrannosaurus', 'hatchling'));
    expect(turnRate('utahraptor', 'adult', true)).toBeLessThan(turnRate('utahraptor', 'adult', false));
  });

  it('quay dần đúng hướng ngắn nhất, không quay quá tốc độ cho phép', () => {
    let h = 0;
    const target = yawOfDirection(1, 0); // đi sang +X
    const max = 0.3;
    const s1 = steerHeading(h, target, max);
    expect(Math.abs(s1.heading - h)).toBeLessThanOrEqual(max + 1e-9);
    expect(Math.abs(s1.diff)).toBeLessThan(Math.abs(target));
    // quay đủ lâu thì tới đích
    let cur = s1;
    for (let i = 0; i < 30; i++) cur = steerHeading(cur.heading, target, max);
    expect(Math.abs(cur.diff)).toBeLessThan(1e-9);
  });

  it('chọn đường quay ngắn nhất qua ±π', () => {
    const s = steerHeading(3.0, -3.0, 0.1); // 3.0 và -3.0 chỉ cách nhau ~0.28 rad qua phía π
    expect(s.heading > 3.0 || s.heading < -3.0 + 0.001).toBe(true);
    expect(Math.abs(s.diff)).toBeLessThan(0.2);
  });

  it('quy ước yaw: 0 hướng về -Z', () => {
    expect(yawOfDirection(0, -1)).toBeCloseTo(0);
    expect(yawOfDirection(1, 0)).toBeCloseTo(-Math.PI / 2);
  });
});
