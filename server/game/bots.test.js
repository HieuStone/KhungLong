import { describe, it, expect } from 'vitest';
import { SPECIES, STAGE_SCALE, TICK_DT, mulberry32, groundAt, getWorld, islandAt, heightAt } from '@isle/shared';
import { deepMerge } from '../game.config.js';
import { BASELINE as DEFAULT_CONFIG } from './test-baseline.config.js'; // cấu hình gốc cố định (không phụ thuộc số bạn tự chỉnh)
import { createNpcs } from './npcs.js';
import { createCarcasses } from './carcasses.js';
import { createVitals } from './survival.js';
import { createBots, targetWeight, chooseTarget, findThreat, growthCap, sizeOf, route, fleeThreshold, fleePoint } from './bots.js';

const cfgWith = (over) => deepMerge(DEFAULT_CONFIG, over);

// Một sinh vật giả (người chơi hoặc NPC) để thử các hàm quyết định
let uid = 1;
function creature(species, stage, x, z, extra = {}) {
  const v = createVitals(species, stage);
  return {
    id: uid++, species, stage, x, z, y: 0, vitals: v, isBot: false, age: 999, flying: false,
    ai: { rolls: new Map() }, lastAttackerId: null, lastHitAge: -99, ...extra,
  };
}
const rng1 = () => 0; // luôn "trúng" xúc xắc

describe('cấu hình', () => {
  it('growthCap theo mức tiến hoá tối đa', () => {
    expect(growthCap('adult')).toBe(1);
    expect(growthCap('subadult')).toBeLessThan(0.75);
    expect(growthCap('juvenile')).toBeLessThan(0.5);
    expect(growthCap('hatchling')).toBeLessThan(0.25);
  });

  it('deepMerge ghi đè đúng chỗ, giữ phần còn lại', () => {
    const c = cfgWith({ predation: { huntPlayers: 0.9 } });
    expect(c.predation.huntPlayers).toBe(0.9);
    expect(c.predation.huntDinos).toBe(DEFAULT_CONFIG.predation.huntDinos);
    expect(c.npcDinos.counts.tyrannosaurus).toBe(DEFAULT_CONFIG.npcDinos.counts.tyrannosaurus);
  });
});

describe('mức độ săn bắt', () => {
  const trex = () => creature('tyrannosaurus', 'adult', 0, 0, { isBot: true });

  it('huntPlayers = 0: không bao giờ săn người chơi; = 1 thì có', () => {
    const player = creature('dryosaurus', 'adult', 10, 0);
    expect(targetWeight(trex(), player, cfgWith({ predation: { huntPlayers: 0 } }))).toBe(0);
    expect(targetWeight(trex(), player, cfgWith({ predation: { huntPlayers: 1 } }))).toBe(1);
  });

  it('huntDinos điều khiển việc săn khủng long NPC khác', () => {
    const other = creature('dryosaurus', 'adult', 10, 0, { isBot: true });
    expect(targetWeight(trex(), other, cfgWith({ predation: { huntDinos: 0.3 } }))).toBe(0.3);
  });

  it('chỉ săn mục tiêu trong khoảng kích thước cho phép', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1, minTargetSizeRatio: 0.2, maxTargetSizeRatio: 1.2 } });
    const tiny = creature('dryosaurus', 'hatchling', 5, 0);  // 0.75 m so với 12 m: quá nhỏ
    const huge = creature('tyrannosaurus', 'adult', 5, 0);   // cùng cỡ nhưng cùng loài
    expect(targetWeight(trex(), tiny, cfg)).toBe(0);
    expect(targetWeight(trex(), huge, cfg)).toBe(0); // cùng loài, chưa bật cannibalism
    expect(targetWeight(trex(), huge, cfgWith({ predation: { huntPlayers: 1, cannibalism: true } }))).toBe(1);
    // Utahraptor (5 m) không dám săn T-rex trưởng thành (12 m = 2.4x)
    const rap = creature('utahraptor', 'adult', 0, 0, { isBot: true });
    expect(targetWeight(rap, creature('tyrannosaurus', 'adult', 5, 0), cfg)).toBe(0);
  });

  it('người chơi mới được bảo hộ một thời gian', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1, newPlayerProtectionSeconds: 30 } });
    const fresh = creature('dryosaurus', 'adult', 5, 0, { age: 5 });
    expect(targetWeight(trex(), fresh, cfg)).toBe(0);
    fresh.age = 31;
    expect(targetWeight(trex(), fresh, cfg)).toBe(1);
  });
});

describe('chọn mục tiêu', () => {
  const hungry = (extra = {}) => { const b = creature('tyrannosaurus', 'adult', 0, 0, { isBot: true, ...extra }); b.vitals.hunger = 0.3; return b; };
  const ctxOf = (creatures, npcs = []) => ({ creatures, npcs });

  it('đang đói và có người chơi trong tầm: chọn người chơi (khi huntPlayers = 1)', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1, huntPrey: 0 } });
    const b = hungry(); const p = creature('dryosaurus', 'adult', 20, 0);
    const t = chooseTarget(b, ctxOf([b, p]), cfg, 0, rng1);
    expect(t.kind).toBe('creature'); expect(t.ref).toBe(p);
  });

  it('huntPlayers = 0 và huntPrey = 0: không chọn ai', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 0, huntDinos: 0, huntPrey: 0 } });
    const b = hungry(); const p = creature('dryosaurus', 'adult', 20, 0);
    expect(chooseTarget(b, ctxOf([b, p]), cfg, 0, rng1)).toBeNull();
  });

  it('no bụng thì không chủ động săn (huntBelowHunger)', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1, huntBelowHunger: 0.65 } });
    const b = hungry(); b.vitals.hunger = 0.9;
    expect(chooseTarget(b, ctxOf([b, creature('dryosaurus', 'adult', 20, 0)]), cfg, 0, rng1)).toBeNull();
  });

  it('mục tiêu ngoài tầm aggroRange thì bỏ qua', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1, aggroRange: 30 } });
    const b = hungry();
    expect(chooseTarget(b, ctxOf([b, creature('dryosaurus', 'adult', 80, 0)]), cfg, 0, rng1)).toBeNull();
  });

  it('bị khiêu khích: luôn phản công kẻ vừa đánh mình, kể cả khi no và huntPlayers = 0', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 0, provokedAlwaysFights: true } });
    const b = hungry(); b.vitals.hunger = 1;
    const attacker = creature('dryosaurus', 'adult', 15, 0);
    b.lastAttackerId = attacker.id; b.age = 100; b.lastHitAge = 95;
    const t = chooseTarget(b, ctxOf([b, attacker]), cfg, 0, rng1);
    expect(t && t.ref).toBe(attacker);
    // quá 15 giây thì thôi
    b.lastHitAge = 50;
    expect(chooseTarget(b, ctxOf([b, attacker]), cfg, 0, rng1)).toBeNull();
  });

  it('xúc xắc: mức 0.5 và rng cao thì bỏ qua mục tiêu đó, rồi giữ kết quả trong aggroRollSeconds', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 0.5, huntPrey: 0, aggroRollSeconds: 20 } });
    const b = hungry(); const p = creature('dryosaurus', 'adult', 20, 0);
    expect(chooseTarget(b, ctxOf([b, p]), cfg, 0, () => 0.9)).toBeNull();         // tung ra "không săn"
    expect(chooseTarget(b, ctxOf([b, p]), cfg, 5, () => 0)).toBeNull();           // vẫn nhớ kết quả cũ
    expect(chooseTarget(b, ctxOf([b, p]), cfg, 25, () => 0)).not.toBeNull();      // hết hạn: tung lại, lần này "săn"
  });

  it('con mồi nhỏ: chọn khi huntPrey > 0', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 0, huntDinos: 0, huntPrey: 1 } });
    const b = hungry();
    const chick = { id: 9001, kind: 'chicken', x: 15, z: 0, y: 0, alive: true };
    const t = chooseTarget(b, ctxOf([b], [chick]), cfg, 0, rng1);
    expect(t && t.kind).toBe('npc');
  });

  it('loài ăn cỏ không săn ai', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1 } });
    const herb = creature('triceratops', 'adult', 0, 0, { isBot: true }); herb.vitals.hunger = 0.1;
    expect(chooseTarget(herb, ctxOf([herb, creature('dryosaurus', 'adult', 10, 0)]), cfg, 0, rng1)).toBeNull();
  });
});

describe('sợ hãi', () => {
  it('con nhỏ/ăn cỏ thấy thú săn mồi lớn hơn trong tầm thì coi là nguy hiểm', () => {
    const cfg = cfgWith({ predation: { fearRange: 45 } });
    const herb = creature('dryosaurus', 'adult', 0, 0, { isBot: true });
    const trex = creature('tyrannosaurus', 'adult', 30, 0, { isBot: true });
    expect(findThreat(herb, [herb, trex], cfg)).toBe(trex);
    trex.x = 100;
    expect(findThreat(herb, [herb, trex], cfg)).toBeNull();
  });
  it('con ăn cỏ không sợ con ăn cỏ khác, không sợ thú nhỏ hơn mình', () => {
    const cfg = cfgWith({});
    const herb = creature('triceratops', 'adult', 0, 0, { isBot: true });
    expect(findThreat(herb, [herb, creature('dryosaurus', 'adult', 10, 0)], cfg)).toBeNull();
    expect(findThreat(herb, [herb, creature('utahraptor', 'adult', 10, 0)], cfg)).toBeNull(); // 5 m < 9 m
  });
});

describe('quản lý đàn khủng long NPC', () => {
  function setup(over = {}, humans = []) {
    const config = cfgWith(over);
    const players = new Map(humans.map((h) => [h.id, h]));
    const npcs = createNpcs(3);
    const carcasses = createCarcasses(config.carcass);
    let id = 1000;
    const act = { attack() {}, interact() {}, roar() {}, waterInReach: () => false };
    const bots = createBots({ config, players, npcs, carcasses, act, allocId: () => id++, seed: 11 });
    return { bots, players, config };
  }
  const botsOf = (players) => [...players.values()].filter((p) => p.isBot);

  it('sinh đúng số lượng từng loài theo cấu hình', () => {
    const { players, config } = setup({ npcDinos: { counts: { tyrannosaurus: 1, utahraptor: 2, triceratops: 0, dryosaurus: 3, pteranodon: 1 } } });
    const list = botsOf(players);
    expect(list.length).toBe(7);
    for (const sp of Object.keys(config.npcDinos.counts)) expect(list.filter((b) => b.species === sp).length).toBe(config.npcDinos.counts[sp]);
  });

  it('enabled = false: không có khủng long NPC nào', () => {
    expect(botsOf(setup({ npcDinos: { enabled: false } }).players).length).toBe(0);
  });

  it('mức tiến hoá tối đa (maxStage) được tôn trọng ngay khi sinh ra và trong lúc lớn', () => {
    const { players, bots } = setup({ npcDinos: { maxStage: 'juvenile', spawnStage: { min: 'hatchling', max: 'adult' } } });
    for (const b of botsOf(players)) expect(['hatchling', 'juvenile']).toContain(b.stage);
    // ép lớn thật nhanh: vẫn bị chặn
    const b = botsOf(players)[0];
    b.vitals.hunger = 1; b.vitals.thirst = 1;
    for (let i = 0; i < 2000; i++) { b.vitals.growth += 0.01; bots.postVitals(b, TICK_DT); }
    expect(b.vitals.growth).toBeLessThan(0.5);
    expect(['hatchling', 'juvenile']).toContain(b.stage);
  });

  it('spawnStage min/max điều khiển giai đoạn khi xuất hiện', () => {
    const { players } = setup({ npcDinos: { spawnStage: { min: 'adult', max: 'adult' }, maxStage: 'adult' } });
    for (const b of botsOf(players)) expect(b.stage).toBe('adult');
  });

  it('growthSpeedMultiplier làm NPC lớn nhanh hơn/chậm hơn', () => {
    const fast = setup({ npcDinos: { growthSpeedMultiplier: 3 } });
    const none = setup({ npcDinos: { growthSpeedMultiplier: 0 } });
    const bf = botsOf(fast.players)[0], bn = botsOf(none.players)[0];
    for (const b of [bf, bn]) { b.vitals.growth = 0.1; b.vitals.hunger = 1; b.vitals.thirst = 1; }
    // Mô phỏng như trong tick thật: sinh tồn cộng tăng trưởng tự nhiên (1/1200 mỗi giây) rồi postVitals áp hệ số
    for (let i = 0; i < 300; i++) {
      bf.vitals.growth += 1 / 1200; fast.bots.postVitals(bf, 1);
      bn.vitals.growth += 1 / 1200; none.bots.postVitals(bn, 1);
    }
    expect(bf.vitals.growth).toBeGreaterThan(0.8);       // x3: 0.1 + 300*3/1200 = 0.85
    expect(bn.vitals.growth).toBeCloseTo(0.1, 2);        // x0: không lớn thêm
  });

  it('NPC mới không xuất hiện gần người chơi hơn minSpawnDistanceFromPlayers', () => {
    const human = { id: 1, isBot: false, x: 0, z: 0, y: 0, vitals: createVitals('dryosaurus', 'adult'), species: 'dryosaurus', stage: 'adult' };
    const { players } = setup({ npcDinos: { minSpawnDistanceFromPlayers: 150 } }, [human]);
    for (const b of botsOf(players)) expect(Math.hypot(b.x - human.x, b.z - human.z)).toBeGreaterThanOrEqual(150 - 1e-6);
  });

  it('con chết được thay thế sau respawnDelay giây', () => {
    const { players, bots } = setup({ npcDinos: { counts: { tyrannosaurus: 0, utahraptor: 0, triceratops: 2, dryosaurus: 0, pteranodon: 0 }, respawnDelay: 30 } });
    const [a] = botsOf(players);
    players.delete(a.id);
    bots.onDeath(a);
    expect(botsOf(players).length).toBe(1);
    bots.step(20); expect(botsOf(players).length).toBe(1);
    bots.step(11); expect(botsOf(players).length).toBe(2);
    expect(bots.stats.died).toBe(1);
  });

  it('NPC thật sự ra quyết định: input được đặt và con ăn cỏ chọn trạng thái hợp lý khi đói/khát', () => {
    const { players, bots } = setup({ npcDinos: { counts: { tyrannosaurus: 0, utahraptor: 0, triceratops: 1, dryosaurus: 0, pteranodon: 0 } } });
    const b = botsOf(players)[0];
    b.vitals.thirst = 0.1;
    for (let i = 0; i < 20; i++) bots.step(TICK_DT * 5);
    expect(b.ai.state).toBe('drink');
    b.vitals.thirst = 1; b.vitals.hunger = 0.2;
    for (let i = 0; i < 20; i++) bots.step(TICK_DT * 5);
    expect(b.ai.state).toBe('eat');
  });
});

describe('tìm đường: đảo và cầu', () => {
  const br = getWorld().bridge;
  const onIsle = (id) => { // một điểm đất liền thuộc đảo id
    for (let x = -440; x <= 440; x += 10) for (let z = -440; z <= 440; z += 10) {
      if (islandAt(x, z) !== id || heightAt(x, z) <= 2) continue;
      if (Math.hypot(x - br.ax, z - br.az) < 40 || Math.hypot(x - br.bx, z - br.bz) < 40) continue; // xa đầu cầu (không bị coi là đang trên cầu)
      return { x, z };
    }
    return null;
  };
  const walker = (x, z) => creature('utahraptor', 'adult', x, z, { isBot: true });

  it('islandAt: nước là -1, hai đảo lớn khác nhau, cùng đảo thì cùng mã', () => {
    expect(islandAt(0, 0)).toBe(-1); // giữa biển
    expect(br.islandA).not.toBe(br.islandB);
    expect(islandAt(br.ax, br.az)).toBe(br.islandA);
    expect(islandAt(br.bx, br.bz)).toBe(br.islandB);
  });

  it('cùng đảo: đi thẳng tới mục tiêu', () => {
    const p = onIsle(br.islandA);
    const q = { x: br.ax, z: br.az };
    expect(route(walker(p.x, p.z), q.x, q.z)).toEqual(q);
  });

  it('khác đảo có cầu nối: đi tới đầu cầu của đảo mình, và khi đang trên cầu thì đi tiếp tới đầu bên kia', () => {
    const a = onIsle(br.islandA), b = onIsle(br.islandB);
    const wp = route(walker(a.x, a.z), b.x, b.z);
    expect(wp).toEqual({ x: br.ax, z: br.az });            // đầu cầu trên đảo A
    const wp2 = route(walker(b.x, b.z), a.x, a.z);
    expect(wp2).toEqual({ x: br.bx, z: br.bz });           // từ đảo B đi về đầu cầu B
    // đang đứng giữa cầu, mục tiêu ở đảo B: đi tới đầu B
    const midX = br.ax + br.dx * br.len / 2, midZ = br.az + br.dz * br.len / 2;
    expect(route(walker(midX, midZ), b.x, b.z)).toEqual({ x: br.bx, z: br.bz });
    // tới sát đầu B rồi thì đi thẳng tới mục tiêu
    expect(route(walker(br.bx - br.dx * 2, br.bz - br.dz * 2), b.x, b.z)).toEqual({ x: b.x, z: b.z });
  });

  it('đảo nhỏ không có cầu: không tới được bằng đường bộ; loài bay thì luôn tới được', () => {
    let other = null;
    for (let x = -440; x <= 440 && !other; x += 10) for (let z = -440; z <= 440 && !other; z += 10) {
      const id = islandAt(x, z);
      if (id >= 0 && id !== br.islandA && id !== br.islandB && heightAt(x, z) > 2) other = { x, z };
    }
    if (!other) return; // bản đồ không có đảo thứ ba
    const a = onIsle(br.islandA);
    expect(route(walker(a.x, a.z), other.x, other.z)).toBeNull();
    const flyer = creature('pteranodon', 'adult', a.x, a.z, { isBot: true });
    expect(route(flyer, other.x, other.z)).toEqual(other);
  });

  it('chooseTarget bỏ qua mục tiêu ở đảo không tới được', () => {
    const cfg = cfgWith({ predation: { huntPlayers: 1, huntPrey: 0, aggroRange: 600 } });
    const b = creature('tyrannosaurus', 'adult', 0, 0, { isBot: true }); b.vitals.hunger = 0.2;
    const p = creature('dryosaurus', 'adult', 50, 0);
    expect(chooseTarget(b, { creatures: [b, p], npcs: [], reachable: () => false }, cfg, 0, () => 0)).toBeNull();
    expect(chooseTarget(b, { creatures: [b, p], npcs: [], reachable: () => true }, cfg, 0, () => 0)).not.toBeNull();
  });
});

describe('đánh nhau tới cùng trên cạn', () => {
  it('ngang cỡ thì đánh tới gần chết, gặp con to hơn hẳn thì chạy sớm', () => {
    const a = creature('utahraptor', 'adult', 0, 0), b = creature('utahraptor', 'adult', 5, 0);
    const rex = creature('tyrannosaurus', 'adult', 5, 0);
    expect(fleeThreshold(a, b)).toBeLessThan(0.1);
    expect(fleeThreshold(a, rex)).toBeGreaterThanOrEqual(0.3);
  });
  it('chạy trốn ưu tiên đất liền, không lao xuống nước', () => {
    // tìm một điểm trên cạn sát bờ: phía "xa kẻ thù" trực tiếp là nước
    let spot = null;
    for (let x = -480; x < 480 && !spot; x += 7) for (let z = -480; z < 480 && !spot; z += 7) {
      if (heightAt(x, z) < 2 || heightAt(x, z) > 6) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (heightAt(x + Math.cos(a) * 25, z + Math.sin(a) * 25) < -1 && heightAt(x - Math.cos(a) * 25, z - Math.sin(a) * 25) > 1) { spot = { x, z, a }; break; }
      }
    }
    expect(spot).not.toBeNull();
    const bot = creature('dryosaurus', 'adult', spot.x, spot.z);
    const enemy = { x: spot.x - Math.cos(spot.a) * 6, z: spot.z - Math.sin(spot.a) * 6 }; // kẻ thù đứng phía đất liền
    const p = fleePoint(bot, enemy);
    expect(heightAt(p.x, p.z)).toBeGreaterThan(0);                              // điểm đến trên cạn
    expect(Math.hypot(p.x - enemy.x, p.z - enemy.z)).toBeGreaterThan(6);         // vẫn rời xa kẻ thù
  });
});
