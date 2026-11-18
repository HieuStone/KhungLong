import { WebSocketServer } from 'ws';
import {
  SERVER_PORT, TICK_RATE, TICK_DT, WORLD_SEED, MAX_PLAYERS, WATER_LEVEL, STAGE_SCALE,
  SPECIES, C2S, S2C, encode, decode, heightAt, groundAt,
  stepBody, separateBodies, bodyRadius, bodyMass, maxWadeDepth, findSpawn,
  turnRate, steerHeading, yawOfDirection, getWorld, FLIGHT, stepFlyer,
} from '@isle/shared';
import { createVitals, stepVitals, eat, drink, stageStats, applyDamage } from './game/survival.js';
import { createNpcs } from './game/npcs.js';
import { createCarcasses } from './game/carcasses.js';
import { createBots } from './game/bots.js';
import { createQuestState, questEvent, questView } from './game/quests.js';
import { CONFIG } from './game.config.js';

const NEAR_WATER = 2.5;     // độ cao <= WATER_LEVEL + NEAR_WATER thì coi là ở bờ nước, uống được
const AOI = 120;            // chỉ gửi con mồi NPC / xác trong bán kính này quanh người chơi (con nhỏ ở xa hơn không nhìn thấy)
const PLAYER_AOI = 300;     // chỉ gửi khủng long trong bán kính này (xa hơn đã chìm trong sương mù)
// Làm tròn số trước khi gửi: JSON của số thực đầy đủ (vd -177.17950097554797) tốn gấp 3-4 lần cần thiết
const r2 = (v) => Math.round(v * 100) / 100;   // cm
const r3 = (v) => Math.round(v * 1000) / 1000; // góc
const ATTACK_ARC = 0.5;     // cos(60 độ): đòn đánh trúng trong nón 120 độ phía trước
const ATTACK_ANIM = 0.45;   // giây hiển thị animation tấn công

// Nén permessage-deflate: snapshot JSON lặp lại nhiều nên nén được ~3-5 lần. Mức nén thấp cho nhẹ CPU.
const wss = new WebSocketServer({
  port: SERVER_PORT,
  perMessageDeflate: { zlibDeflateOptions: { level: 3, memLevel: 8 }, threshold: 512, concurrencyLimit: 16 },
});
const players = new Map(); // id -> player
const npcs = createNpcs(WORLD_SEED, CONFIG.prey?.counts);
const carcasses = createCarcasses(CONFIG.carcass);
let nextId = 1;
let tick = 0;

// Sự kiện một lần trong tick (tiếng gầm, cắn, chết...) gửi cho người chơi ở gần để client phát âm thanh.
const events = [];
const emit = (kind, x, z, extra = {}) => { events.push({ kind, x, z, ...extra }); stats[kind] = (stats[kind] || 0) + 1; };
// Thống kê toàn bản đồ (in ra console mỗi 10 giây khi chạy với ISLE_DEBUG=1) để chỉnh server/game.config.js
const stats = {};

// Màu khủng long do người chơi chọn: chỉ nhận mã #rrggbb hợp lệ (chống dữ liệu bậy), còn lại bỏ qua (dùng màu mặc định)
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function cleanColors(c) {
  return c && HEX_COLOR.test(c.body) && HEX_COLOR.test(c.accent) ? { body: c.body.toLowerCase(), accent: c.accent.toLowerCase() } : null;
}

// Xuất hiện với đói/khát ~70% để thấy ngay mức tăng khi ăn/uống
function newVitals(species) { const v = createVitals(species); v.hunger = 0.7; v.thirst = 0.7; return v; }

const clamp = (v) => Math.max(-1, Math.min(1, +v || 0));
const facing = (heading) => ({ x: -Math.sin(heading), z: -Math.cos(heading) });

const notify = (p, msg) => {
  const now = Date.now();
  if (now - (p.lastNotice || 0) < 1500 || p.ws.readyState !== 1) return;
  p.lastNotice = now;
  p.ws.send(encode({ t: S2C.NOTICE, msg }));
};

/** Sự kiện nhiệm vụ (chỉ người chơi thật): nhiệm vụ nào vừa xong thì thưởng độ lớn + hồi máu và báo cho người chơi. */
function quest(p, type, data) {
  if (!p || p.isBot || !p.quests) return;
  for (const q of questEvent(p.quests, type, data)) {
    const v = p.vitals, rw = q.def.reward || {};
    v.growth = Math.min(1, v.growth + (rw.growth || 0));
    v.hp = Math.min(v.maxHp, v.hp + (rw.heal || 0) * v.maxHp);
    if (p.ws.readyState === 1) p.ws.send(encode({ t: S2C.NOTICE, msg: `✔ Hoàn thành nhiệm vụ: ${q.def.title} (+${Math.round((rw.growth || 0) * 100)}% lớn)`, quest: q.def.id }));
  }
}

const FULL = 0.98; // đói/khát từ mức này trở lên coi như đầy, không ăn/uống thêm được
const dirTo = (p, x, z) => { const d = Math.hypot(x - p.x, z - p.z) || 1; return yawOfDirection((x - p.x) / d, (z - p.z) / d); };
const sizeOf = (p) => SPECIES[p.species].bodyLength * STAGE_SCALE[p.stage];
function startFeeding(p, kind, cooldown) { p.actKind = kind; p.actT = 0.5; p.actCd = cooldown; }

/** Xác (con mồi hoặc khủng long đã chết) gần nhất trong tầm miệng, hoặc null. */
function carcassInReach(p, extra = 0) {
  const reach = sizeOf(p) * 0.5 + 1.8 + bodyRadius(p.species, p.stage) + extra;
  let best = null, bd = Infinity;
  for (const c of carcasses.near(p.x, p.z, reach + 4)) {
    const d = Math.hypot(c.x - p.x, c.z - p.z) - c.size * 0.3; // xác to thì chạm được từ xa hơn một chút
    if (d < reach && d < bd) { best = c; bd = d; }
  }
  return best;
}

/** Thả xác đang tha xuống đất. */
function dropCarcass(p) {
  const c = p.carrying != null ? carcasses.get(p.carrying) : null;
  if (c) { c.carriedBy = null; c.mode = null; c.y = groundAt(c.x, c.z); }
  p.carrying = null; p.carryMult = 1;
}

/** G: ngậm (xác nhỏ) hoặc kéo (xác lớn, nặng vừa sức) xác gần nhất; bấm lại để thả. */
function doGrab(p) {
  if (p.carrying != null) { dropCarcass(p); notify(p, 'Đã thả xác'); return; }
  if (p.vitals.sleeping) return;
  const c = carcassInReach(p, 1.0);
  if (!c || c.carriedBy != null) { notify(p, 'Không có xác nào ở gần để tha'); return; }
  const plan = carcasses.grabPlan(c, sizeOf(p));
  if (!plan.ok) { notify(p, plan.reason); return; }
  if (plan.mode === 'drag' && p.flying) { notify(p, 'Phải hạ cánh mới kéo được xác nặng'); return; }
  c.carriedBy = p.id; c.mode = plan.mode; p.carrying = c.id; p.carryMult = plan.speedMult;
  notify(p, plan.mode === 'mouth' ? 'Đang ngậm xác (bấm G để thả)' : 'Đang kéo xác (bấm G để thả, đi sẽ chậm hơn)');
}

/** Đặt xác đang tha theo vị trí người tha: xác nhỏ ở miệng, xác lớn bị kéo phía sau. */
function updateCarried(p) {
  const c = carcasses.get(p.carrying);
  if (!c) { p.carrying = null; p.carryMult = 1; return; }
  const f = facing(p.heading), s = sizeOf(p);
  if (c.mode === 'mouth') { c.x = p.x + f.x * s * 0.5; c.z = p.z + f.z * s * 0.5; c.y = p.y + s * 0.18; }
  else { const back = s * 0.45 + c.size * 0.35; c.x = p.x - f.x * back; c.z = p.z - f.z * back; c.y = groundAt(c.x, c.z); }
  c.yaw = p.heading;
}

/** Miệng chạm nước ở phía trước (lấy vài điểm dọc hướng mặt) hoặc chân đang trong nước? */
function waterInReach(p) {
  if (heightAt(p.x, p.z) <= WATER_LEVEL) return true;
  const f = facing(p.heading), r = bodyRadius(p.species, p.stage), reach = sizeOf(p) * 0.55 + 1.3;
  for (let d = r + 0.2; d <= reach; d += 0.5) if (heightAt(p.x + f.x * d, p.z + f.z * d) <= WATER_LEVEL) return true;
  return false;
}

/**
 * Cắn xác nếu có xác trong tầm. Trả true nếu đã xử lý (đã cắn, hoặc xác ở gần nhưng đang chờ/đã no),
 * false nếu không có xác để người gọi làm việc khác.
 */
function biteCarcass(p) {
  if (p.flying) return false;
  const n = carcassInReach(p);
  if (!n) return false;
  if (p.actCd > 0) return true;
  if (p.vitals.hunger >= FULL) { notify(p, 'Bạn đã no, không ăn thêm được'); return true; }
  p.heading = dirTo(p, n.x, n.z); // quay mặt về phía xác
  const b = carcasses.bite(n, 0.06, 1 - p.vitals.hunger);
  eat(p.vitals, p.species, b.gain);
  quest(p, 'eat_meat', { type: n.type });
  if (b.poisoned) { p.poisonT = CONFIG.carcass.poisonSeconds; notify(p, 'Thịt đã thối rữa! Bạn bị ngộ độc'); }
  else if (carcasses.rot01(n) > 0.4) notify(p, 'Thịt bắt đầu thối, ăn không còn bổ như trước');
  startFeeding(p, 'eat', 0.4);
  return true;
}

/**
 * Đòn tấn công (chuột trái / F). Có mục tiêu sống phía trước (NPC hoặc người chơi khác) thì cắn nó;
 * không có mục tiêu mà đang đứng cạnh xác (loài ăn thịt) thì cắn xác = ăn.
 */
function doAttack(p, kind) {
  const sp = SPECIES[p.species];
  const atk = sp.attacks[kind] || Object.values(sp.attacks)[0];
  const v = p.vitals;
  if (v.sleeping || p.attackCd > 0) return;

  const scale = STAGE_SCALE[p.stage];
  const reach = atk.range * (0.5 + 0.5 * scale) + bodyRadius(p.species, p.stage);
  const dmg = atk.damage * scale * (p.isBot ? CONFIG.predation.attackDamageMultiplier : 1);
  const f = facing(p.heading);

  let best = null, bestD = Infinity;
  const consider = (target, tx, tz, trad, isNpc) => {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d - trad > reach) return;
    if (d > 0.01 && (dx * f.x + dz * f.z) / d < ATTACK_ARC) return;
    if (d < bestD) { best = { target, isNpc }; bestD = d; }
  };
  // Chỉ đánh được mục tiêu cùng tầm cao (vd chim đang bay cao thì khủng long đất không với tới; loài bay phải bổ xuống thấp)
  for (const n of npcs.near(p.x, p.z, reach + 2)) if (n.alive && Math.abs(n.y - p.y) < 3.5) consider(n, n.x, n.z, 0.25, true);
  for (const o of players.values()) if (o !== p && Math.abs(o.y - p.y) < 3.5) consider(o, o.x, o.z, bodyRadius(o.species, o.stage), false);

  if (!best && sp.diet === 'carnivore' && biteCarcass(p)) return; // không có gì để đánh: ăn xác

  if (v.stamina < atk.staminaCost / 100) return;
  if (p.carrying != null && carcasses.get(p.carrying)?.mode === 'drag') dropCarcass(p); // đánh nhau thì buông xác đang kéo
  p.attackCd = atk.cooldown;
  p.attackT = ATTACK_ANIM;
  v.stamina = Math.max(0, v.stamina - atk.staminaCost / 100);
  if (!best) { emit('miss', p.x + f.x * 1.5, p.z + f.z * 1.5, { size: sizeOf(p) }); return; } // cắn vào không khí
  if (best.isNpc) {
    const n = best.target, res = npcs.damage(n, dmg, p.x, p.z);
    emit('bite', n.x, n.z, { size: sizeOf(p), victim: n.kind });
    emit(res.killed ? 'npc_die' : 'npc_hurt', n.x, n.z, { victim: n.kind });
    if (res.killed) quest(p, 'kill_prey', { kind: n.kind });
    if (res.killed) carcasses.add({ type: 'npc', kind: res.corpse.kind, x: res.corpse.x, y: groundAt(res.corpse.x, res.corpse.z), z: res.corpse.z, yaw: res.corpse.yaw });
  } else {
    const o = best.target;
    applyDamage(o.vitals, dmg, atk.bleed); o.lastHitBy = p.name; o.lastAttackerId = p.id; o.lastHitAge = o.age;
    quest(p, 'hit_dino', { diet: SPECIES[o.species].diet, species: o.species });
    emit('bite', o.x, o.z, { size: sizeOf(p), victim: 'dino' });
    emit('player_hurt', o.x, o.z, { species: o.species });
  }
}

/**
 * E (giữ để tiếp tục): mỗi lần là một ngụm / một miếng, có hồi chiêu ngắn.
 *  - Nước ở phía trước (hoặc đang lội nước) -> uống (anim 'drink')
 *  - Loài ăn thịt gần xác -> cắn xác (anim 'eat')
 *  - Loài ăn cỏ gần dương xỉ/bụi -> gặm (anim 'eat')
 *  - Không có gì / đã no / đã uống đủ -> thông báo cho người chơi.
 */
function doInteract(p) {
  if (p.vitals.sleeping || p.actCd > 0) return;
  if (p.flying) { notify(p, 'Hạ cánh xuống đất để ăn hoặc uống'); return; }
  const sp = SPECIES[p.species];
  const v = p.vitals;

  // Có cả nước lẫn đồ ăn trong tầm: ưu tiên cái đang thiếu hơn. Trước đây luôn ưu tiên nước, nên đứng cạnh xác/bụi cây
  // ở mép nước mà đã uống đủ thì chỉ nhận thông báo "đã uống đủ" và không bao giờ ăn được (NPC chết đói ngay bên bờ).
  const water = waterInReach(p);
  const carn = sp.diet === 'carnivore';
  const f = facing(p.heading), r = bodyRadius(p.species, p.stage);
  const plant = carn ? null : getWorld().nearEdible(p.x + f.x * (r + 0.5), p.z + f.z * (r + 0.5), sizeOf(p) * 0.5 + 2.8);
  const food = carn ? !!carcassInReach(p) : !!plant;
  const hungry = v.hunger < FULL;
  if (water && v.thirst < FULL && !(food && hungry && v.hunger < v.thirst)) {
    drink(v, 0.06);
    quest(p, 'drink');
    startFeeding(p, 'drink', 0.35);
    return;
  }
  if (carn) {
    if (biteCarcass(p)) return;
    notify(p, water ? 'Bạn đã uống đủ nước' : 'Không có xác nào ở gần (hạ một con mồi rồi đứng sát xác) và không có nước phía trước');
    return;
  }
  if (!plant) { notify(p, water ? 'Bạn đã uống đủ nước' : 'Không có dương xỉ hay bụi cây để gặm ở gần và không có nước phía trước'); return; }
  if (v.hunger >= FULL) { notify(p, 'Bạn đã no, không ăn thêm được'); return; }
  p.heading = dirTo(p, plant.x, plant.z);
  eat(v, p.species, 0.03);
  quest(p, 'eat_plant');
  startFeeding(p, 'eat', 0.4);
}

/** Gầm: doạ con mồi quanh đó chạy/bay đi, người chơi gần nghe tiếng (hồi chiêu 3 giây). */
function doRoar(p) {
  if (p.vitals.sleeping || p.roarCd > 0) return;
  p.roarCd = 3;
  const size = sizeOf(p);
  npcs.scare(p.x, p.z, 30 + size * 5);
  emit('roar', p.x, p.z, { species: p.species, size, y: p.y });
  if (!p.isBot) {
    let audience = 0;
    for (const o of players.values()) if (o !== p && Math.hypot(o.x - p.x, o.z - p.z) < 50) audience++;
    quest(p, 'roar', { audience });
  }
}

// Khủng long NPC (AI) dùng đúng các hành động của người chơi ở trên
const bots = createBots({
  config: CONFIG, players, npcs, carcasses, allocId: () => nextId++,
  act: { attack: (p) => doAttack(p), interact: doInteract, roar: doRoar, waterInReach },
});
carcasses.setOnRemove((c) => { if (c.carriedBy != null) { const o = players.get(c.carriedBy); if (o) { o.carrying = null; o.carryMult = 1; } } });

wss.on('connection', (ws) => {
  const id = nextId++;
  ws.on('message', (raw) => {
    const m = decode(raw.toString());
    if (!m) return;
    const p = players.get(id);
    if (m.t === C2S.JOIN && !p) {
      let humans = 0; for (const o of players.values()) if (!o.isBot) humans++; // NPC không chiếm chỗ của người chơi
      if (humans >= MAX_PLAYERS) return ws.send(encode({ t: S2C.ERROR, msg: 'server full' }));
      const sp = SPECIES[m.species];
      if (!sp) return ws.send(encode({ t: S2C.ERROR, msg: 'unknown species' }));
      const { x, z } = findSpawn(); // trên cạn, không dốc, không đè cây/đá
      players.set(id, {
        id, ws, name: String(m.name || 'dino').slice(0, 16), species: m.species, stage: 'hatchling', colors: cleanColors(m.colors),
        x, z, vx: 0, vz: 0, y: groundAt(x, z), heading: 0, yaw: 0, vitals: newVitals(m.species),
        input: { mx: 0, mz: 0, yaw: 0, sprint: false, up: 0 }, ack: 0, anim: 'idle', canSprint: true,
        attackCd: 0, attackT: 0, lastHitBy: null, actT: 0, actCd: 0, actKind: null, lastNotice: 0,
        flying: false, fy: 0, vy: 0, flyLock: false, roarCd: 0,
        age: 0, carrying: null, carryMult: 1, poisonT: 0, lastAttackerId: null, lastHitAge: -99,
        quests: createQuestState(m.species), threatened: false,
      });
      ws.send(encode({ t: S2C.WELCOME, id, seed: WORLD_SEED, tickRate: TICK_RATE }));
    } else if (m.t === C2S.INPUT && p) {
      p.input = { mx: clamp(m.mx), mz: clamp(m.mz), yaw: +m.yaw || 0, sprint: !!m.sprint, up: clamp(m.up) };
      p.ack = m.seq | 0;
    } else if (m.t === C2S.INTERACT && p) doInteract(p);
    else if (m.t === C2S.ATTACK && p) doAttack(p, m.kind);
    else if (m.t === C2S.SLEEP && p) p.vitals.sleeping = !!m.on;
    else if (m.t === C2S.ROAR && p) doRoar(p);
    else if (m.t === C2S.GRAB && p) doGrab(p);
  });
  ws.on('close', () => players.delete(id));
});

const tickStat = { max: 0, sum: 0, n: 0, slow: 0 }; // đo thời gian mỗi tick (xem khi ISLE_DEBUG=1)
// ISLE_SPEED=n (chỉ dùng khi kiểm thử): chạy n tick mỗi nhịp để tua nhanh thời gian
const SPEED = Math.max(1, Math.floor(+process.env.ISLE_SPEED || 1));
// Vòng lặp tick tự bù trễ: setInterval(50ms) trên Windows bị làm tròn theo bước đồng hồ ~15.6ms thành ~62ms
// (chỉ ~16 tick/giây, game chạy chậm và giật nhịp). Ở đây hẹn giờ theo mốc tuyệt đối và chạy bù tick bị trễ.
const TICK_MS = 1000 / TICK_RATE;
let nextTickAt = performance.now();
function tickLoop() {
  let n = 0;
  while (performance.now() >= nextTickAt && n < 5) { // tối đa 5 tick bù mỗi lần (tránh dồn khi server bị treo lâu)
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < SPEED; i++) gameTick();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    tickStat.sum += ms; tickStat.n++; if (ms > tickStat.max) tickStat.max = ms; if (ms > TICK_MS) tickStat.slow++;
    nextTickAt += TICK_MS; n++;
  }
  if (performance.now() - nextTickAt > TICK_MS * 5) nextTickAt = performance.now(); // trễ quá nhiều: bỏ qua, không cố đuổi
  setTimeout(tickLoop, Math.max(0, nextTickAt - performance.now() - 1));
}
tickLoop();

function gameTick() {
  tick++;
  bots.step(TICK_DT); // khủng long NPC suy nghĩ và đặt input
  for (const p of [...players.values()]) {
    const v = p.vitals;
    p.age += TICK_DT;
    const px0 = p.x, pz0 = p.z;
    const { mx, mz, yaw } = p.input;
    p.attackCd = Math.max(0, p.attackCd - TICK_DT);
    p.attackT = Math.max(0, p.attackT - TICK_DT);
    p.actT = Math.max(0, p.actT - TICK_DT);
    p.actCd = Math.max(0, p.actCd - TICK_DT);
    const feeding = p.actT > 0; // đang cúi ăn/uống thì đứng yên
    const wantsMove = !!(mx || mz) && !v.sleeping && !feeding;
    const sprinting = wantsMove && p.input.sprint && p.canSprint;
    const st = stageStats(p.species, p.stage);
    // Hệ số tốc độ: NPC theo cấu hình; đang tha xác thì chậm lại tuỳ độ nặng
    const spdMul = (p.isBot ? CONFIG.predation.speedMultiplier : 1) * (p.carrying != null ? p.carryMult : 1);
    const maxSpeed = (sprinting ? st.sprintSpeed : st.speed) * spdMul;

    // --- Hướng đi muốn tới (theo camera) -> thân quay dần, đi theo hướng mặt ---
    // Chỉ bấm lùi (S) thì không quay, đi lùi chậm; còn lại thân quay có tốc độ giới hạn và phải
    // "hướng mặt về phía muốn đi" mới chạy nhanh được (quẹo gấp thì chậm lại như thật).
    let dirX = 0, dirZ = 0, speed = 0;
    if (wantsMove) {
      const len = Math.hypot(mx, mz) || 1;
      const wx = (mx * Math.cos(yaw) + mz * Math.sin(yaw)) / len;
      const wz = (-mx * Math.sin(yaw) + mz * Math.cos(yaw)) / len;
      if (mz > 0 && mx === 0) {                       // lùi
        const f = facing(p.heading);
        dirX = -f.x; dirZ = -f.z; speed = st.speed * 0.3 * spdMul;
      } else {
        const s = steerHeading(p.heading, yawOfDirection(wx, wz), turnRate(p.species, p.stage, sprinting) * TICK_DT);
        p.heading = s.heading;
        const f = facing(p.heading);
        dirX = f.x; dirZ = f.z;
        speed = maxSpeed * (0.2 + 0.8 * Math.max(0, Math.cos(s.diff))); // lệch hướng nhiều thì chậm
      }
    }
    const r = bodyRadius(p.species, p.stage);
    const fl = SPECIES[p.species].flight;
    const up = fl ? p.input.up : 0;
    p.roarCd = Math.max(0, p.roarCd - TICK_DT);

    // Cất cánh: loài bay đang đứng dưới đất, giữ Space, còn đủ thể lực
    if (fl && !p.flying && up > 0 && !v.sleeping && !feeding && v.stamina >= 0.2 && !p.flyLock) {
      if (p.carrying != null && carcasses.get(p.carrying)?.mode === 'drag') dropCarcass(p); // không cất cánh khi đang kéo xác nặng
      p.flying = true; p.fy = groundAt(p.x, p.z) + 0.4; p.vy = fl.climb * 0.6;
      emit('takeoff', p.x, p.z, { size: SPECIES[p.species].bodyLength * STAGE_SCALE[p.stage], species: p.species });
    }
    if (v.stamina > 0.2) p.flyLock = false;

    let moving, sprintingNow = sprinting, flapping = false;
    if (p.flying) {
      // --- Bay: hướng lượn có tốc độ quay giới hạn, vật lý độ cao riêng ---
      const sc = 0.6 + 0.4 * STAGE_SCALE[p.stage];
      const exhausted = v.stamina <= 0.001;
      if (exhausted) p.flyLock = true;
      const input = !!(mx || mz);
      const f0 = facing(p.heading);
      let fdx = f0.x, fdz = f0.z, fspd = fl.speed * sc * FLIGHT.glideFrac;
      sprintingNow = input && p.input.sprint && !p.flyLock;
      if (input) {
        const len = Math.hypot(mx, mz) || 1;
        const wx = (mx * Math.cos(yaw) + mz * Math.sin(yaw)) / len;
        const wz = (-mx * Math.sin(yaw) + mz * Math.cos(yaw)) / len;
        if (mz > 0 && mx === 0) fspd = fl.speed * sc * FLIGHT.brakeFrac; // phanh
        else {
          const s = steerHeading(p.heading, yawOfDirection(wx, wz), fl.turn * TICK_DT);
          p.heading = s.heading;
          const f = facing(p.heading);
          fdx = f.x; fdz = f.z;
          fspd = (sprintingNow ? fl.sprintSpeed : fl.speed) * sc * (0.4 + 0.6 * Math.max(0, Math.cos(s.diff)));
          flapping = true;
        }
      }
      const vyT = p.flyLock ? -FLIGHT.exhaustedSink : up > 0 ? fl.climb * sc : up < 0 ? -fl.descend : -FLIGHT.glideSink;
      if (up > 0 && !p.flyLock) flapping = true;
      p.vy += (vyT - p.vy) * (1 - Math.exp(-3.5 * TICK_DT));
      p.fy = Math.min(WATER_LEVEL + fl.maxAlt, p.fy + p.vy * TICK_DT);
      stepFlyer(p, r, fdx, fdz, fspd * spdMul, TICK_DT, p.fy);
      const g = groundAt(p.x, p.z);
      const landable = WATER_LEVEL - g <= maxWadeDepth(p.species, p.stage);
      if (!landable) {
        // Trên nước sâu không hạ cánh được: lướt sát mặt nước
        p.fy = Math.max(p.fy, WATER_LEVEL + FLIGHT.waterSkim);
        if (p.vy < 0 && p.fy <= WATER_LEVEL + FLIGHT.waterSkim) p.vy = 0;
      } else if (p.fy <= g + 0.05) {
        p.flying = false; p.fy = g; p.vy = 0; p.vx *= 0.3; p.vz *= 0.3; // hạ cánh
        emit('land', p.x, p.z, { size: SPECIES[p.species].bodyLength * STAGE_SCALE[p.stage] });
      }
      p.yaw = p.heading;
      p.y = p.flying ? p.fy : g;
      moving = true;
    } else {
      // --- Trên mặt đất: quán tính, dốc, nước, va chạm cây/đá (shared/physics.js) ---
      const mv = stepBody(p, r, dirX, dirZ, speed, TICK_DT, maxWadeDepth(p.species, p.stage));
      moving = mv.moving;
      p.yaw = p.heading;
      p.y = groundAt(p.x, p.z);
    }
    const inWater = !p.flying && p.y <= WATER_LEVEL;
    const res = stepVitals(v, p.species, TICK_DT, { moving: wantsMove, sprinting: p.flying ? false : sprinting, inWater });
    if (p.isBot) bots.postVitals(p, TICK_DT);
    if (p.poisonT > 0) { p.poisonT -= TICK_DT; v.hp -= CONFIG.carcass.poisonDamagePerSecond * v.maxHp * TICK_DT; } // ngộ độc thịt thối
    if (p.carrying != null) updateCarried(p);
    if (p.flying) {
      // Thể lực khi bay: triệt tiêu hồi phục tự nhiên, trừ thêm theo kiểu bay (lướt rất rẻ, vỗ cánh/lao nhanh tốn)
      const drain = 0.08 + (sprintingNow ? 0.06 : flapping ? 0.025 : 0.01);
      v.stamina = Math.max(0, v.stamina - drain * TICK_DT);
    }
    p.stage = res.stage;
    p.canSprint = res.canSprint;
    p.anim = v.sleeping ? 'sleep' : p.attackT > 0 ? 'attack' : feeding ? p.actKind
      : p.flying ? (flapping ? 'fly' : 'glide') : moving ? (sprinting ? 'run' : 'walk') : 'idle';
    if (!p.isBot && p.quests) {
      const dist = Math.hypot(p.x - px0, p.z - pz0);
      if (dist > 0.001) quest(p, 'move', { dist, sprint: sprintingNow, fly: p.flying });
      if (p.flying) quest(p, 'altitude', { alt: p.fy - groundAt(p.x, p.z) });
      quest(p, 'survive', { sec: TICK_DT });
      // Thoát hiểm: bị thú ăn thịt to hơn áp sát (< 15 m) rồi bỏ xa được (> 50 m)
      if ((tick & 3) === 0) {
        let nearest = Infinity;
        for (const o of players.values()) {
          if (o === p || SPECIES[o.species].diet !== 'carnivore' || sizeOf(o) <= sizeOf(p)) continue;
          nearest = Math.min(nearest, Math.hypot(o.x - p.x, o.z - p.z));
        }
        if (nearest < 15) p.threatened = true;
        else if (p.threatened && nearest > 50) { p.threatened = false; quest(p, 'escape'); }
      }
    }
    if (res.dead || v.hp <= 0) {
      // Kẻ hạ gục (đánh trúng trong 20 giây gần nhất) được tính nhiệm vụ "hạ khủng long"
      if (p.lastAttackerId != null && p.age - (p.lastHitAge ?? -99) < 20) quest(players.get(p.lastAttackerId), 'kill_dino', { species: p.species });
      let cause = v.hunger === 0 || v.thirst === 0 ? 'starvation' : p.poisonT > 0 ? 'poison' : 'wounds';
      if (p.lastHitBy) cause = 'killed';
      if (p.ws.readyState === 1) p.ws.send(encode({ t: S2C.DEAD, cause, by: p.lastHitBy }));
      dropCarcass(p);
      // Để lại xác (kể cả xác người chơi): ăn được, tha được, thối rữa rồi biến mất
      carcasses.add({ type: 'dino', kind: p.species, stage: p.stage, x: p.x, y: groundAt(p.x, p.z), z: p.z, yaw: p.heading, name: p.name, colors: p.colors || null });
      emit('player_die', p.x, p.z, { species: p.species, size: sizeOf(p) });
      if (process.env.ISLE_DEBUG) {
        const depth = WATER_LEVEL - heightAt(p.x, p.z);
        console.log('[death]', JSON.stringify({ who: p.name, stage: p.stage, cause, by: p.lastHitBy, water: depth > 0 ? +depth.toFixed(2) : 0, ai: p.ai?.state, hunger: +v.hunger.toFixed(2), thirst: +v.thirst.toFixed(2) }));
      }
      players.delete(p.id);
      if (p.isBot) bots.onDeath(p);
    }
  }

  // Khủng long đè lên nhau thì đẩy ra; con nặng đẩy con nhẹ
  const all = [...players.values()];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (Math.abs(a.x - b.x) > 20 || Math.abs(a.z - b.z) > 20) continue; // cắt nhanh các cặp ở xa
      if (Math.abs(a.y - b.y) > 4) continue; // khác tầng cao (đang bay) thì không đụng nhau
      const A = { x: a.x, z: a.z, r: bodyRadius(a.species, a.stage), mass: bodyMass(a.species, a.stage) };
      const B = { x: b.x, z: b.z, r: bodyRadius(b.species, b.stage), mass: bodyMass(b.species, b.stage) };
      if (separateBodies(A, B)) { a.x = A.x; a.z = A.z; b.x = B.x; b.z = B.z; if (!a.flying) a.y = groundAt(a.x, a.z); if (!b.flying) b.y = groundAt(b.x, b.z); }
    }
  }

  npcs.step(TICK_DT, all);
  carcasses.step(TICK_DT);

  // Phần động của mỗi khủng long (dùng chung cho mọi người nhận). Phần tĩnh (tên, loài, màu) chỉ gửi khi người nhận
  // mới thấy con đó lần đầu (client chỉ cần chúng lúc tạo mô hình) -> snapshot nhỏ đi nhiều.
  const dyn = new Map();
  for (const p of all) {
    const d = { id: p.id, stage: p.stage, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r3(p.yaw), hp01: r2(p.vitals.hp / p.vitals.maxHp), anim: p.anim };
    if (p.flying) { d.fly = true; d.alt = r2(p.fy - groundAt(p.x, p.z)); } // mặc định (không gửi): fly=false, alt=0
    dyn.set(p.id, d);
  }
  const fullOf = (p) => ({ ...dyn.get(p.id), name: p.name, species: p.species, colors: p.colors || null });
  for (const p of all) {
    if (p.isBot) continue; // NPC không có kết nối để gửi
    // Chỉ khủng long trong tầm nhìn (luôn gồm chính mình)
    const known = p.known || (p.known = new Set());
    const sent = new Set();
    const list = [];
    for (const o of all) {
      if (o !== p) {
        const dx = o.x - p.x, dz = o.z - p.z;
        if (dx * dx + dz * dz > PLAYER_AOI * PLAYER_AOI) continue;
      }
      list.push(known.has(o.id) ? dyn.get(o.id) : fullOf(o));
      sent.add(o.id);
    }
    p.known = sent; // ra khỏi tầm rồi quay lại thì gửi lại phần tĩnh
    const v = p.vitals;
    const you = {
      hp: v.hp, maxHp: v.maxHp, hunger: v.hunger, thirst: v.thirst, stamina: v.stamina,
      growth01: v.growth, bleeding: v.bleed > 0, flying: p.flying, alt: p.flying ? p.fy - groundAt(p.x, p.z) : 0, carrying: p.carrying != null, poisoned: p.poisonT > 0,
    };
    if (p.quests && (p.quests.dirty || (tick % 40) === 0)) { you.q = questView(p.quests); p.quests.dirty = false; } // tiến độ nhiệm vụ (khi đổi, và 2 s/lần)
    const visible = npcs.near(p.x, p.z, AOI).map(npcs.view);
    const ev = events.filter((e) => Math.abs(e.x - p.x) < 140 && Math.abs(e.z - p.z) < 140);
    if (p.ws.readyState === 1) p.ws.send(encode({ t: S2C.SNAPSHOT, tick, ack: p.ack, players: list, npcs: visible, carcasses: carcasses.near(p.x, p.z, AOI).map(carcasses.view), ev, you }));
  }
  events.length = 0;
}

if (process.env.ISLE_DEBUG) {
  setInterval(() => {
    const bs = [...players.values()].filter((p) => p.isBot);
    const st = {};
    for (const b of bs) st[b.ai.state] = (st[b.ai.state] || 0) + 1;
    console.log('[tick ms]', JSON.stringify({ avg: +(tickStat.sum / Math.max(1, tickStat.n)).toFixed(2), max: +tickStat.max.toFixed(1), overBudget: tickStat.slow, budget: 1000 / TICK_RATE }));
    tickStat.sum = tickStat.n = tickStat.max = tickStat.slow = 0;
    console.log('[debug]', JSON.stringify({ npcDinos: bs.length, aiStates: st, carcasses: carcasses.count(), events: stats, botSpawned: bots.stats.spawned, botDied: bots.stats.died }));
  }, 10000);
}

console.log(`[server] ws://localhost:${SERVER_PORT} tick=${TICK_RATE}Hz npcs=${npcs.count()} npcDinos=${bots.count()}`);
