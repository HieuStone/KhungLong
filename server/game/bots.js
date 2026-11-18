// Khủng long NPC: "người chơi" do AI điều khiển. Dùng đúng vật lý/thể lực/tấn công/ăn uống/bay của người chơi
// (server/index.js), chỉ khác là `input` do hàm think() tạo ra thay vì từ bàn phím. Mọi tham số chỉnh ở server/game.config.js.
import {
  SPECIES, SPECIES_IDS, STAGE_SCALE, GROWTH_STAGES, WATER_LEVEL, heightAt, groundAt, findSpawn, bodyRadius,
  mulberry32, getWorld, islandAt, maxWadeDepth,
} from '@isle/shared';
import { createVitals } from './survival.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sizeOf = (c) => SPECIES[c.species].bodyLength * STAGE_SCALE[c.stage];
const isCarnivore = (c) => SPECIES[c.species].diet === 'carnivore';
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const stageIndex = (s) => Math.max(0, GROWTH_STAGES.indexOf(s));
/** Độ sâu nước tối đa con này tới được an toàn (loài bay: chỉ đáp được ở nước nông). */
const safeDepth = (c) => maxWadeDepth(c.species, c.stage) * 0.8;
const depthAt = (x, z) => WATER_LEVEL - heightAt(x, z);

/**
 * Máu (tỉ lệ) dưới mức này thì bỏ chạy khỏi kẻ đang đánh mình. Đối thủ to hơn hẳn thì chạy sớm;
 * ngang cỡ hoặc nhỏ hơn thì đánh tới cùng (trước đây chạy ở 30% rồi trốn xuống nước, hồi máu, nên trên cạn hầu như không ai chết).
 */
export function fleeThreshold(bot, attacker) {
  const ratio = sizeOf(attacker) / sizeOf(bot);
  return ratio > 1.5 ? 0.35 : ratio > 1.15 ? 0.2 : 0.08;
}

/**
 * Hướng chạy trốn: tránh xa kẻ thù nhưng ưu tiên đất liền (không lao xuống nước, nơi bị chậm lại và bị hạ).
 * Trả về điểm đích cách ~25 m.
 */
export function fleePoint(bot, from) {
  const away = Math.atan2(bot.z - from.z, bot.x - from.x);
  let best = null, bestScore = -Infinity;
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
    const a = away + off, x = bot.x + Math.cos(a) * 25, z = bot.z + Math.sin(a) * 25;
    const mid = depthAt(bot.x + Math.cos(a) * 12, bot.z + Math.sin(a) * 12);
    const wet = Math.max(0, depthAt(x, z)) + Math.max(0, mid);
    const score = -Math.abs(off) * 2 - wet * 6 + Math.hypot(x - from.x, z - from.z) * 0.1;
    if (score > bestScore) { bestScore = score; best = { x, z }; }
  }
  return best;
}

/** growth tối đa theo mức tiến hoá tối đa (maxStage). 'adult' = không giới hạn. */
export function growthCap(maxStage) {
  const i = stageIndex(maxStage);
  return i >= GROWTH_STAGES.length - 1 ? 1 : (i + 1) * 0.25 - 1e-4;
}

// ------------------------- Tìm đường (đảo và cầu) -------------------------

/**
 * Điểm cần đi tới tiếp theo để đến (tx, tz), hoặc null nếu không tới được bằng đường bộ.
 * Khủng long đi bộ không qua được nước: nếu mục tiêu ở đảo khác thì chỉ tới được khi hai đảo có cầu nối,
 * khi đó đi tới đầu cầu gần rồi băng qua cầu. Loài bay thì bay thẳng.
 */
export function route(bot, tx, tz) {
  if (SPECIES[bot.species].flight) return { x: tx, z: tz };
  const br = getWorld().bridge;
  const near = (x, z, p) => Math.hypot(x - p.x, z - p.z);
  if (br) {
    const s = (bot.x - br.ax) * br.dx + (bot.z - br.az) * br.dz;
    const lat = (bot.x - br.ax) * br.nx + (bot.z - br.az) * br.nz;
    if (s >= -2 && s <= br.len + 2 && Math.abs(lat) <= br.halfW + 1) { // đang trên cầu: đi tiếp về đầu cầu phía mục tiêu
      const A = { x: br.ax, z: br.az }, B = { x: br.bx, z: br.bz };
      const goal = near(tx, tz, A) < near(tx, tz, B) ? A : B;
      return near(bot.x, bot.z, goal) > 4 ? goal : { x: tx, z: tz };
    }
  }
  const ia = islandAt(bot.x, bot.z), it = islandAt(tx, tz);
  if (ia < 0 || it < 0 || ia === it) return { x: tx, z: tz };
  if (!br) return null;
  const connected = (ia === br.islandA && it === br.islandB) || (ia === br.islandB && it === br.islandA);
  if (!connected) return null;
  const A = { x: br.ax, z: br.az }, B = { x: br.bx, z: br.bz };
  return ia === br.islandA ? A : B; // đầu cầu nằm trên đảo của mình (A thuộc islandA, B thuộc islandB)
}

// ------------------------- Quyết định (hàm thuần, test được) -------------------------

/**
 * Mức sẵn sàng (0..1) của `bot` săn `other` theo cấu hình; 0 = không bao giờ săn.
 * Xét kích thước, cùng loài, người chơi mới được bảo hộ, loại mục tiêu (người chơi / khủng long NPC).
 */
export function targetWeight(bot, other, cfg) {
  const P = cfg.predation;
  if (other === bot || other.vitals.hp <= 0) return 0;
  const ratio = sizeOf(other) / sizeOf(bot);
  if (ratio < P.minTargetSizeRatio || ratio > P.maxTargetSizeRatio) return 0;
  if (other.species === bot.species && !P.cannibalism) return 0;
  if (!other.isBot && (other.age ?? 1e9) < P.newPlayerProtectionSeconds) return 0; // người chơi mới còn được bảo hộ
  return other.isBot ? P.huntDinos : P.huntPlayers;
}

/** Thú săn mồi lớn hơn đáng sợ gần nhất đối với `bot` (hoặc null). */
export function findThreat(bot, creatures, cfg) {
  const P = cfg.predation;
  const mySize = sizeOf(bot);
  let best = null, bd = P.fearRange;
  for (const c of creatures) {
    if (c === bot || c.vitals.hp <= 0 || !isCarnivore(c)) continue;
    if (c.species === bot.species && !P.cannibalism) continue;
    if (sizeOf(c) < mySize * 1.1) continue; // chỉ sợ con to hơn mình
    const d = dist2d(bot, c);
    // thú săn mồi chỉ đáng sợ nếu nó sẵn sàng săn mình (người chơi: theo huntPlayers; NPC: theo huntDinos)
    const willing = bot.isBot ? (c.isBot ? P.huntDinos : 1) : 1;
    if (willing <= 0) continue;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Chọn mục tiêu săn cho khủng long ăn thịt. Trả về { kind: 'creature'|'npc', ref } hoặc null.
 * `rolls` là bộ nhớ "xúc xắc" của bot (Map) để mỗi mục tiêu chỉ tung lại sau aggroRollSeconds.
 */
export function chooseTarget(bot, ctx, cfg, time, rng) {
  const P = cfg.predation;
  if (!isCarnivore(bot)) return null;
  const rolls = bot.ai.rolls;
  const roll = (key, p) => {
    const r = rolls.get(key);
    if (r && r.until > time) return r.ok;
    const ok = rng() < p;
    rolls.set(key, { ok, until: time + P.aggroRollSeconds });
    return ok;
  };

  // 1) Bị khiêu khích: luôn phản công kẻ vừa đánh mình (nếu còn gần)
  if (P.provokedAlwaysFights && bot.lastAttackerId != null && bot.age - (bot.lastHitAge ?? -99) < 15) {
    const a = ctx.creatures.find((c) => c.id === bot.lastAttackerId && c.vitals.hp > 0);
    if (a && dist2d(a, bot) < P.loseInterestRange) return { kind: 'creature', ref: a };
  }

  // 2) Chưa đói thì không chủ động săn
  if (bot.vitals.hunger >= P.huntBelowHunger) return null;

  let best = null, bd = P.aggroRange;
  for (const c of ctx.creatures) {
    const w = targetWeight(bot, c, cfg);
    if (w <= 0) continue;
    if (!bot.flying && !SPECIES[bot.species].flight && c.flying && c.y - groundAt(c.x, c.z) > 4) continue; // với không tới
    if (ctx.reachable && !ctx.reachable(bot, c.x, c.z)) continue; // ở đảo khác không có cầu
    const d = dist2d(bot, c);
    if (d < bd && roll(`c${c.id}`, w)) { bd = d; best = { kind: 'creature', ref: c }; }
  }
  // Con mồi nhỏ: một lần tung xúc xắc cho cả nhóm
  if (P.huntPrey > 0 && roll('prey', P.huntPrey)) {
    for (const n of ctx.npcs) {
      if (!n.alive) continue;
      if (ctx.reachable && !ctx.reachable(bot, n.x, n.z)) continue;
      const d = Math.hypot(n.x - bot.x, n.z - bot.z);
      if (d < bd * 0.85 || (!best && d < bd)) { bd = d; best = { kind: 'npc', ref: n }; }
    }
  }
  return best;
}

// ------------------------- Quản lý đàn khủng long NPC -------------------------

export function createBots({ config, players, npcs, carcasses, act, allocId, seed = 4242 }) {
  const cfg = config;
  const rng = mulberry32(seed);
  const world = getWorld();
  let time = 0;
  const pending = []; // { species, t }: các con sẽ xuất hiện lại
  const stats = { spawned: 0, died: 0 };

  const humans = () => [...players.values()].filter((p) => !p.isBot);
  const creaturesList = () => [...players.values()];

  function randomStage() {
    const lo = stageIndex(cfg.npcDinos.spawnStage.min), hi = Math.max(lo, stageIndex(cfg.npcDinos.spawnStage.max));
    const cap = stageIndex(cfg.npcDinos.maxStage);
    return GROWTH_STAGES[Math.min(cap, lo + Math.floor(rng() * (hi - lo + 1)))];
  }

  function pickSpawn() {
    const h = humans();
    let pos = findSpawn(rng);
    for (let i = 0; i < 25; i++) {
      pos = findSpawn(rng);
      if (h.every((p) => Math.hypot(p.x - pos.x, p.z - pos.z) >= cfg.npcDinos.minSpawnDistanceFromPlayers)) break;
    }
    return pos;
  }

  function spawn(species) {
    const stage = randomStage();
    const { x, z } = pickSpawn();
    const v = createVitals(species, stage);
    v.growth = Math.min(growthCap(cfg.npcDinos.maxStage), v.growth + rng() * 0.2); // ngẫu nhiên trong giai đoạn
    v.hunger = 0.4 + rng() * 0.4; v.thirst = 0.5 + rng() * 0.4;
    const id = allocId();
    const bot = {
      id, isBot: true, ws: { readyState: 0, send() {} },
      name: SPECIES[species].name + cfg.npcDinos.nameSuffix, species, stage, age: 0,
      x, z, vx: 0, vz: 0, y: groundAt(x, z), heading: rng() * Math.PI * 2, yaw: 0, vitals: v,
      input: { mx: 0, mz: 0, yaw: 0, sprint: false, up: 0 }, ack: 0, anim: 'idle', canSprint: true,
      attackCd: 0, attackT: 0, lastHitBy: null, actT: 0, actCd: 0, actKind: null, lastNotice: 0,
      flying: false, fy: 0, vy: 0, flyLock: false, roarCd: 0, carrying: null,
      lastAttackerId: null, lastHitAge: -99,
      ai: {
        state: 'wander', thinkT: rng() * cfg.ai.thinkInterval, target: null, stateT: 0, dirX: 0, dirZ: 0,
        homeX: x, homeZ: z, rolls: new Map(), water: null, waterT: 0, fleeFrom: null, lastPos: { x, z }, stuckT: 0, huntT: 0, idleT: 0,
      },
    };
    bot.stage = stageOfGrowth(v.growth);
    players.set(id, bot);
    stats.spawned++;
    return bot;
  }
  const stageOfGrowth = (g) => (g >= 0.75 ? 'adult' : g >= 0.5 ? 'subadult' : g >= 0.25 ? 'juvenile' : 'hatchling');

  function populate() {
    if (!cfg.npcDinos.enabled) return;
    for (const sp of SPECIES_IDS) for (let i = 0; i < (cfg.npcDinos.counts[sp] || 0); i++) spawn(sp);
  }

  function onDeath(bot) {
    stats.died++;
    pending.push({ species: bot.species, t: cfg.npcDinos.respawnDelay });
  }

  /** Sau mỗi tick sinh tồn: áp dụng hệ số tốc độ lớn và giới hạn mức tiến hoá tối đa của NPC. */
  function postVitals(bot, dt) {
    const v = bot.vitals;
    const mult = cfg.npcDinos.growthSpeedMultiplier;
    if (mult !== 1 && v.hunger > 0.3 && v.thirst > 0.3) v.growth += (dt / 1200) * (mult - 1);
    v.growth = clamp(v.growth, 0, growthCap(cfg.npcDinos.maxStage));
    bot.stage = stageOfGrowth(v.growth);
  }

  // ---- Điều khiển di chuyển: đặt input theo hướng thế giới (yaw = 0 nên (mx, mz) chính là hướng đi) ----
  function steer(bot, tx, tz, sprint) {
    const dx = tx - bot.x, dz = tz - bot.z, d = Math.hypot(dx, dz) || 1;
    bot.input.mx = dx / d; bot.input.mz = dz / d; bot.input.yaw = 0;
    bot.input.sprint = !!sprint && bot.vitals.stamina > 0.25;
    return d;
  }
  function stop(bot) { bot.input.mx = 0; bot.input.mz = 0; bot.input.sprint = false; }

  /** Loài bay: giữ độ cao khi di chuyển xa, hạ cánh khi tới gần chỗ cần ăn/uống/đánh. */
  function flyControl(bot, dist, { land = false, cruise = 20 } = {}) {
    if (!SPECIES[bot.species].flight) { bot.input.up = 0; return; }
    const lowStamina = bot.vitals.stamina < 0.2;
    if (land || lowStamina || dist < 10) { bot.input.up = -1; return; }
    if (dist > 28 || bot.flying) {
      const alt = bot.flying ? bot.fy - groundAt(bot.x, bot.z) : 0;
      bot.input.up = alt < cruise ? 1 : 0;
    } else bot.input.up = 0;
  }

  function findWater(bot) {
    let best = null, bd = Infinity;
    for (let r = 8; r <= 160; r += 12) for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, x = bot.x + Math.cos(a) * r, z = bot.z + Math.sin(a) * r;
      // nước nông sát bờ: đi/đáp tới được (trước đây chọn cả chỗ nước sâu, kẹt lại rồi chết đói giữa biển)
      const d = depthAt(x, z);
      if (d > 0.1 && d < safeDepth(bot) && r < bd) { bd = r; best = { x, z }; }
    }
    return best;
  }

  const hasCarcassNear = (bot, range) => {
    let best = null, bd = range;
    for (const c of carcasses.near(bot.x, bot.z, range)) {
      const r = carcasses.rot01(c);
      if (r > 0.7 && bot.vitals.hunger > 0.2) continue; // chỉ ăn thịt thối khi sắp chết đói
      if (depthAt(c.x, c.z) > safeDepth(bot)) continue; // xác chìm ở nước sâu: không tới được
      if (!reachable(bot, c.x, c.z)) continue;
      const d = Math.hypot(c.x - bot.x, c.z - bot.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  const reachable = (bot, x, z) => route(bot, x, z) !== null;

  function startHunt(bot, tgt) {
    const ai = bot.ai;
    ai.state = 'hunt'; ai.target = tgt; ai.huntT = 0;
    if (rng() < cfg.ai.roarBeforeHunt) act.roar(bot);
    // Săn theo đàn: đồng loại gần đó cũng lao vào cùng mục tiêu
    if (cfg.predation.packHunting && bot.species === 'utahraptor') {
      for (const o of players.values()) {
        if (o.isBot && o !== bot && o.species === bot.species && o.ai.state !== 'hunt' && dist2d(o, bot) < cfg.predation.packRange && o.vitals.hp > 0) {
          o.ai.state = 'hunt'; o.ai.target = tgt; o.ai.huntT = 0;
        }
      }
    }
  }

  function resolveTarget(tgt) {
    if (!tgt) return null;
    if (tgt.kind === 'creature') { const c = players.get(tgt.ref.id); return c && c.vitals.hp > 0 ? { x: c.x, z: c.z, y: c.y, rad: bodyRadius(c.species, c.stage), obj: c } : null; }
    const n = npcs.npcs.get(tgt.ref.id);
    return n && n.alive ? { x: n.x, z: n.z, y: n.y, rad: 0.25, obj: n } : null;
  }

  function think(bot, dt) {
    const ai = bot.ai, v = bot.vitals, P = cfg.predation;
    ai.thinkT -= dt;
    if (ai.thinkT > 0) return;
    ai.thinkT = cfg.ai.thinkInterval;
    ai.stateT += cfg.ai.thinkInterval;
    const carn = isCarnivore(bot), flyer = !!SPECIES[bot.species].flight;
    const all = creaturesList();
    const stepDt = cfg.ai.thinkInterval;

    // Phát hiện kẹt: đi mà gần như không nhúc nhích -> đổi hướng
    if (ai.state !== 'idle' && (bot.input.mx || bot.input.mz) && !bot.actT) {
      ai.stuckT += stepDt;
      if (ai.stuckT >= 2) {
        if (dist2d(bot, ai.lastPos) < 0.6 && !bot.flying) { ai.state = 'wander'; ai.stateT = 0; ai.target = null; const a = rng() * Math.PI * 2; ai.dirX = Math.cos(a); ai.dirZ = Math.sin(a); ai.avoidUntil = time + 3; }
        ai.lastPos = { x: bot.x, z: bot.z }; ai.stuckT = 0;
      }
    }

    // ---- 1. Nguy hiểm: ăn cỏ / con nhỏ thì chạy hoặc chống trả ----
    const threat = (!carn || sizeOf(bot) < 6) ? findThreat(bot, all, cfg) : null;
    if (threat && (!carn ? P.herbivoresFleeFromPredators : true)) {
      const d = dist2d(bot, threat);
      const cornered = d < 7 && P.herbivoresFightBack;
      if (cornered && !flyer) { ai.state = 'hunt'; ai.target = { kind: 'creature', ref: threat }; ai.huntT = 0; }
      else if (ai.state !== 'flee' || !ai.fleeFrom) { ai.state = 'flee'; ai.fleeFrom = threat; ai.stateT = 0; }
      else ai.fleeFrom = threat;
    } else if (ai.state === 'flee') { ai.state = 'wander'; ai.fleeFrom = null; ai.stateT = 0; }

    // ---- 2. Phản công kẻ vừa đánh mình (cả loài ăn cỏ) ----
    if (ai.state !== 'flee' && P.provokedAlwaysFights && bot.lastAttackerId != null && bot.age - bot.lastHitAge < 15 && P.herbivoresFightBack) {
      const a = all.find((c) => c.id === bot.lastAttackerId && c.vitals.hp > 0);
      const fleeAt = a ? fleeThreshold(bot, a) : 0;
      if (a && v.hp > v.maxHp * fleeAt && dist2d(a, bot) < P.loseInterestRange) { if (ai.state !== 'hunt') { ai.state = 'hunt'; ai.target = { kind: 'creature', ref: a }; ai.huntT = 0; } }
      else if (a && v.hp <= v.maxHp * fleeAt) { ai.state = 'flee'; ai.fleeFrom = a; }
    }

    // ---- 3. Nhu cầu: khát / đói ----
    if (ai.state !== 'flee' && ai.state !== 'hunt') {
      if (ai.state === 'drink' && v.thirst >= 0.95) ai.state = 'wander';
      if (ai.state === 'eat' && v.hunger >= 0.95) ai.state = 'wander';
      if (v.thirst < (v.thirst < 0.25 ? 0.4 : 0.5) && ai.state !== 'drink') { ai.state = 'drink'; ai.stateT = 0; ai.water = null; }
      else if (ai.state !== 'drink') {
        if (carn) {
          // Có xác gần thì ăn xác trước (đỡ tốn sức săn); không có thì tìm mục tiêu để săn
          const c = v.hunger < 0.7 ? hasCarcassNear(bot, 160) : null;
          if (c && ai.state !== 'hunt') { ai.state = 'eat'; ai.target = { kind: 'carcass', id: c.id }; }
          else if (!c && ai.state !== 'hunt' && ai.state !== 'eat') {
            const tgt = chooseTarget(bot, { creatures: all, npcs: [...npcs.npcs.values()], reachable }, cfg, time, rng);
            if (tgt) startHunt(bot, tgt);
          }
        } else if (v.hunger < 0.6 && ai.state !== 'eat') { ai.state = 'eat'; ai.stateT = 0; ai.target = null; }
      }
    }

    // ---- 4. Thực thi trạng thái ----
    stop(bot);
    bot.input.up = flyer && bot.flying ? bot.input.up : 0;
    switch (ai.state) {
      case 'flee': {
        const f = ai.fleeFrom;
        if (!f || f.vitals.hp <= 0 || dist2d(bot, f) > P.fearRange * 1.6) { ai.state = 'wander'; break; }
        const away = flyer ? { x: bot.x + (bot.x - f.x), z: bot.z + (bot.z - f.z) } : fleePoint(bot, f);
        steer(bot, away.x, away.z, true);
        flyControl(bot, 50, { cruise: 18 });
        break;
      }
      case 'hunt': {
        ai.huntT += stepDt;
        const t = resolveTarget(ai.target);
        // con mồi đã trọng thương thì đuổi lâu hơn (kết liễu thay vì để nó trốn đi hồi máu)
        const wounded = t?.obj?.vitals ? t.obj.vitals.hp / t.obj.vitals.maxHp < 0.35 : false;
        if (!t || ai.huntT > P.huntGiveUpSeconds * (wounded ? 1.6 : 1) || dist2d(bot, t) > P.loseInterestRange) { ai.state = 'wander'; ai.target = null; break; }
        const wp = route(bot, t.x, t.z);
        if (!wp) { ai.state = 'wander'; ai.target = null; break; } // mục tiêu ở đảo không có cầu nối
        steer(bot, wp.x, wp.z, true);
        const d = dist2d(bot, t);
        const atk = Object.values(SPECIES[bot.species].attacks)[0];
        const reach = atk.range * (0.5 + 0.5 * STAGE_SCALE[bot.stage]) + bodyRadius(bot.species, bot.stage) + t.rad;
        flyControl(bot, d, { land: false, cruise: 14 });
        if (flyer && d < 16) bot.input.up = -1; // bổ xuống
        if (d < reach * 1.05) act.attack(bot);
        break;
      }
      case 'drink': {
        ai.waterT -= stepDt;
        if (!ai.water || ai.waterT <= 0) { ai.water = findWater(bot); ai.waterT = 8; }
        if (!ai.water) { ai.state = 'wander'; break; }
        const d = steer(bot, ai.water.x, ai.water.z, v.thirst < 0.25);
        flyControl(bot, d, { land: d < 14 });
        if (!bot.flying && act.waterInReach(bot)) act.interact(bot);
        break;
      }
      case 'eat': {
        if (carn) {
          const c = ai.target && ai.target.kind === 'carcass' ? carcasses.get(ai.target.id) : null;
          if (!c) { ai.state = 'wander'; ai.target = null; break; }
          const wp = route(bot, c.x, c.z);
          if (!wp) { ai.state = 'wander'; ai.target = null; break; }
          steer(bot, wp.x, wp.z, false);
          const d = dist2d(bot, c);
          flyControl(bot, d, { land: d < 14 });
          const contact = sizeOf(bot) * 0.5 + 1.8 + bodyRadius(bot.species, bot.stage);
          if (d < contact * 0.9) { stop(bot); act.interact(bot); }
        } else {
          const plant = world.nearEdible(bot.x, bot.z, 120);
          if (!plant) { ai.state = 'wander'; break; }
          const wp = route(bot, plant.x, plant.z);
          if (!wp) { ai.state = 'wander'; break; }
          steer(bot, wp.x, wp.z, false);
          const d = dist2d(bot, plant);
          flyControl(bot, d, { land: d < 14 });
          if (d < sizeOf(bot) * 0.5 + 2.2) { stop(bot); act.interact(bot); }
        }
        break;
      }
      default: { // wander / idle
        if (ai.state === 'idle') {
          ai.idleT -= stepDt;
          if (ai.idleT <= 0) { ai.state = 'wander'; ai.stateT = 0; }
        } else {
          if (ai.stateT === stepDt || ai.stateT > 6 || (ai.dirX === 0 && ai.dirZ === 0)) {
            ai.stateT = stepDt;
            let a = rng() * Math.PI * 2;
            if (Math.hypot(bot.x - ai.homeX, bot.z - ai.homeZ) > cfg.ai.roamRadius) a = Math.atan2(ai.homeZ - bot.z, ai.homeX - bot.x);
            ai.dirX = Math.cos(a); ai.dirZ = Math.sin(a);
            if (rng() < 0.3) { ai.state = 'idle'; ai.idleT = 2 + rng() * 4; break; }
          }
          steer(bot, bot.x + ai.dirX * 20, bot.z + ai.dirZ * 20, false);
          flyControl(bot, 40, { cruise: 16 });
          if (flyer && !bot.flying && v.stamina < 0.6) bot.input.up = 0; // nghỉ cho lại sức rồi mới cất cánh
        }
      }
    }
    if (ai.state === 'idle') { stop(bot); flyControl(bot, 0, { land: true }); }
  }

  /** Gọi mỗi tick (TICK_DT). Hồi sinh các con đã chết và để từng con suy nghĩ. */
  function step(dt) {
    time += dt;
    for (let i = pending.length - 1; i >= 0; i--) {
      if ((pending[i].t -= dt) <= 0) { if (cfg.npcDinos.enabled) spawn(pending[i].species); pending.splice(i, 1); }
    }
    for (const p of players.values()) if (p.isBot) think(p, dt);
  }

  populate();
  return {
    step, onDeath, postVitals, spawn, stats,
    count: () => [...players.values()].filter((p) => p.isBot).length,
    pendingCount: () => pending.length,
  };
}
