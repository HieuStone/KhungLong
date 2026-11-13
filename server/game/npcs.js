// NPC con mồi: gà, thỏ, chuột, chim. Server điều khiển, client chỉ vẽ.
import {
  NPC_KINDS, NPC_IDS, WATER_LEVEL, TICK_DT, heightAt, groundAt, stepBody, findSpawn, mulberry32,
} from '@isle/shared';

const CORPSE_LIFETIME = 90;   // giây xác còn tồn tại trước khi biến mất
const RESPAWN_AFTER = 20;     // giây sau khi xác biến mất thì con mới xuất hiện ở chỗ khác
const HOME_RADIUS = 45;       // NPC lang thang quanh chỗ sinh ra
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createNpcs(seed = 1) {
  const rng = mulberry32(seed);
  const npcs = new Map();
  let nextId = 1;

  function spawnOne(kind, rngFn = rng) {
    const def = NPC_KINDS[kind];
    const { x, z } = findSpawn(rngFn);
    const id = nextId++;
    const n = {
      id, kind, x, z, y: groundAt(x, z), vx: 0, vz: 0, yaw: rngFn() * Math.PI * 2,
      hp: def.hp, alive: true, state: 'idle', timer: 1 + rngFn() * 4, dirX: 0, dirZ: 0,
      homeX: x, homeZ: z, alt: 0, deadT: 0, meat: def.nutrition, respawnT: 0, zig: 0,
    };
    npcs.set(id, n);
    return n;
  }

  const pendingRespawns = [];
  for (const kind of NPC_IDS) for (let i = 0; i < NPC_KINDS[kind].count; i++) spawnOne(kind);

  /** Người chơi gần nhất đáng sợ (đang đứng yên thì dễ lại gần hơn, chạy thì bị phát hiện từ xa). */
  function nearestThreat(n, def, players) {
    let best = null, bestD = Infinity;
    for (const p of players) {
      if (p.vitals.sleeping) continue;
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      const moving = Math.hypot(p.vx || 0, p.vz || 0) > 1;
      const range = def.fleeRange * (moving ? 1.25 : 0.7);
      if (d < range && d < bestD) { best = p; bestD = d; }
    }
    return best ? { p: best, d: bestD } : null;
  }

  function step(dt, players) {
    for (const n of npcs.values()) {
      const def = NPC_KINDS[n.kind];

      if (!n.alive) {
        n.deadT += dt;
        if (n.meat <= 0 || n.deadT > CORPSE_LIFETIME) { npcs.delete(n.id); pendingRespawns.push({ kind: n.kind, t: RESPAWN_AFTER }); }
        continue;
      }

      const threat = nearestThreat(n, def, players);
      let wantX = 0, wantZ = 0, speed = 0;

      if (threat) {
        // Chạy trốn: hướng ra xa người chơi, thỏ chạy ziczac
        const ax = n.x - threat.p.x, az = n.z - threat.p.z, len = Math.hypot(ax, az) || 1;
        n.zig += dt * 6;
        const jitter = n.kind === 'rabbit' ? Math.sin(n.zig) * 0.7 : Math.sin(n.zig * 0.5) * 0.25;
        const fx = ax / len, fz = az / len;
        wantX = fx * Math.cos(jitter) - fz * Math.sin(jitter);
        wantZ = fx * Math.sin(jitter) + fz * Math.cos(jitter);
        if (def.flies) { n.state = 'fly'; n.timer = 4 + rng() * 3; speed = def.fly * 0.9; }
        else { n.state = 'flee'; speed = def.run; }
      } else if (n.state === 'fly') {
        // Bay thêm một lúc rồi hạ cánh
        n.timer -= dt;
        speed = def.fly * 0.7; wantX = n.dirX; wantZ = n.dirZ;
        if (n.timer <= 0) { n.state = 'idle'; n.timer = 3 + rng() * 4; }
      } else {
        n.timer -= dt;
        if (n.timer <= 0) {
          if (n.state === 'walk' || n.state === 'flee') { n.state = 'idle'; n.timer = 2 + rng() * 5; }
          else {
            n.state = 'walk'; n.timer = 1.5 + rng() * 3.5;
            let a = rng() * Math.PI * 2;
            if (Math.hypot(n.x - n.homeX, n.z - n.homeZ) > HOME_RADIUS) a = Math.atan2(n.homeZ - n.z, n.homeX - n.x); // quay về tổ
            n.dirX = Math.cos(a); n.dirZ = Math.sin(a);
          }
        }
        if (n.state === 'walk') { wantX = n.dirX; wantZ = n.dirZ; speed = def.walk; }
        else if (n.state === 'flee') { wantX = n.dirX; wantZ = n.dirZ; speed = def.run; } // bị đánh: chạy khỏi kẻ tấn công
      }

      if (n.state === 'fly') {
        // Đang bay: không va chạm cây/đá, chỉ trôi theo hướng
        n.alt += (def.fly * 0.8 - n.alt) * Math.min(1, dt * 1.5);
        n.vx += (wantX * speed - n.vx) * Math.min(1, dt * 4);
        n.vz += (wantZ * speed - n.vz) * Math.min(1, dt * 4);
        n.x += n.vx * dt; n.z += n.vz * dt;
        n.dirX = wantX || n.dirX; n.dirZ = wantZ || n.dirZ;
      } else {
        n.alt += (0 - n.alt) * Math.min(1, dt * 3); // hạ độ cao
        const r = Math.max(0.1, def.bodyLength * 0.45);
        const mv = stepBody(n, r, wantX, wantZ, speed, dt, 0.3);
        if (mv.blocked && n.state === 'walk') { n.timer = 0; } // đụng vật cản thì đổi hướng
      }
      n.y = groundAt(n.x, n.z) + n.alt;
      if (Math.hypot(n.vx, n.vz) > 0.25) n.yaw += wrap(Math.atan2(-n.vx, -n.vz) - n.yaw) * Math.min(1, dt * 10);
    }

    // Hồi sinh con mới sau khi xác biến mất
    for (let i = pendingRespawns.length - 1; i >= 0; i--) {
      const r = pendingRespawns[i];
      if ((r.t -= dt) <= 0) { spawnOne(r.kind); pendingRespawns.splice(i, 1); }
    }
  }

  const speedOf = (n) => Math.hypot(n.vx, n.vz);

  /** Trạng thái gửi cho client (NpcState trong shared/npcs.js). */
  function view(n) {
    const def = NPC_KINDS[n.kind];
    const anim = !n.alive ? 'dead' : n.state === 'fly' ? 'fly' : speedOf(n) > def.walk * 1.6 ? 'run' : speedOf(n) > 0.25 ? 'walk' : 'idle';
    return { id: n.id, kind: n.kind, x: n.x, y: n.y, z: n.z, yaw: n.yaw, anim, hp01: n.hp / def.hp };
  }

  /** NPC (sống hay chết) trong bán kính range quanh (x, z). */
  function near(x, z, range) {
    const out = [];
    for (const n of npcs.values()) if (Math.abs(n.x - x) <= range && Math.abs(n.z - z) <= range) out.push(n);
    return out;
  }

  /** Gây sát thương; trả về { killed }. (fromX, fromZ) là chỗ kẻ tấn công, để con vật hoảng chạy khỏi đó. */
  function damage(n, dmg, fromX = n.x, fromZ = n.z) {
    if (!n.alive) return { killed: false };
    n.hp -= dmg;
    if (n.hp <= 0) {
      // Chết: bỏ khỏi danh sách NPC sống; người gọi tạo xác (server/game/carcasses.js) từ `corpse`. Con mới xuất hiện sau RESPAWN_AFTER giây.
      const corpse = { kind: n.kind, x: n.x, y: n.y - n.alt, z: n.z, yaw: n.yaw };
      npcs.delete(n.id);
      pendingRespawns.push({ kind: n.kind, t: RESPAWN_AFTER });
      return { killed: true, corpse };
    }
    const ax = n.x - fromX, az = n.z - fromZ, len = Math.hypot(ax, az) || 1;
    n.dirX = ax / len; n.dirZ = az / len;
    n.state = NPC_KINDS[n.kind].flies ? 'fly' : 'flee'; n.timer = 2.5; // bị đánh thì hoảng chạy/bay đi
    return { killed: false };
  }

  /** Tiếng gầm: mọi con mồi sống trong bán kính range hoảng sợ, chạy/bay ra xa nguồn tiếng. */
  function scare(x, z, range) {
    for (const n of npcs.values()) {
      if (!n.alive) continue;
      const ax = n.x - x, az = n.z - z, d = Math.hypot(ax, az);
      if (d > range) continue;
      n.dirX = ax / (d || 1); n.dirZ = az / (d || 1);
      n.state = NPC_KINDS[n.kind].flies ? 'fly' : 'flee';
      n.timer = 3 + rng() * 2;
    }
  }

  /** Ăn xác: lấy tối đa `amount` thịt, trả về lượng thực lấy được (0..amount). */
  function bite(n, amount) {
    if (n.alive) return 0;
    const got = Math.min(amount, n.meat);
    n.meat -= got;
    return got;
  }

  return { npcs, step, view, near, damage, bite, scare, count: () => npcs.size };
}
