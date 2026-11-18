// Logic sinh tồn thuần: đói, khát, stamina, máu, chảy máu, lớn dần.
// Không dùng WebSocket, không đọc đồng hồ thật. Mọi hàm nhận dt (giây) từ bên ngoài.
import { SPECIES, STAGE_SCALE, GROWTH_STAGES } from '@isle/shared';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Tốc độ theo chặng lớn: tỉ lệ căn bậc hai kích thước (quy luật Froude: con vật nhỏ bước nhanh hơn nhưng
// tốc độ không giảm tuyến tính theo cỡ). Con non 1/4 cỡ -> 1/2 tốc độ; trước đây 0.5+0.5*scale (=0.625) làm chân guồng quá nhanh.
const speedFactor = (scale) => Math.sqrt(scale);

// Chặng lớn theo tiến độ growth (0..1): mốc 0 / 0.25 / 0.5 / 0.75
export function stageOf(growth) {
  if (growth >= 0.75) return 'adult';
  if (growth >= 0.5) return 'subadult';
  if (growth >= 0.25) return 'juvenile';
  return 'hatchling';
}

export function stageStats(speciesId, stage) {
  const sp = SPECIES[speciesId];
  const scale = STAGE_SCALE[stage];
  const f = speedFactor(scale);
  return {
    maxHp: sp.health * scale,
    speed: sp.speed * f,
    sprintSpeed: sp.sprintSpeed * f,
    scale,
  };
}

export function createVitals(speciesId, stage = 'hatchling') {
  const s = GROWTH_STAGES.includes(stage) ? stage : 'hatchling';
  // Bắt đầu đúng mốc của chặng: hatchling = 0, juvenile = 0.25, ...
  const growth = GROWTH_STAGES.indexOf(s) * 0.25;
  const maxHp = SPECIES[speciesId].health * STAGE_SCALE[s];
  return {
    hp: maxHp,
    maxHp,
    hunger: 1,
    thirst: 1,
    stamina: 1,
    maxStamina: 1, // stamina tính theo thang 0..1
    growth,
    bleed: 0,
    sleeping: false,
  };
}

// Khi growth đổi chặng, cập nhật maxHp và giữ nguyên tỉ lệ hp/maxHp
function syncStage(v, speciesId) {
  const newMax = SPECIES[speciesId].health * STAGE_SCALE[stageOf(v.growth)];
  if (newMax !== v.maxHp) {
    const ratio = v.maxHp > 0 ? v.hp / v.maxHp : 1;
    v.maxHp = newMax;
    v.hp = ratio * newMax;
  }
}

export function stepVitals(v, speciesId, dt, { moving = false, sprinting = false, inWater = false } = {}) {
  // inWater hiện chưa có công thức trong phiếu nên chưa dùng.
  const sp = SPECIES[speciesId];

  // Sprint chỉ hiệu lực khi còn stamina
  const sprintNow = sprinting && v.stamina > 0;

  // Đói/khát giảm theo thời gian; sprint làm đói nhanh gấp đôi
  v.hunger = clamp(v.hunger - sp.hungerRate * 0.01 * dt * (sprintNow ? 2 : 1), 0, 1);
  v.thirst = clamp(v.thirst - sp.thirstRate * 0.01 * dt, 0, 1);

  // Stamina: sprint tốn, không sprint thì hồi (nhanh hơn khi ngủ)
  if (sprintNow) {
    v.stamina = clamp(v.stamina - 0.15 * dt, 0, 1);
  } else {
    v.stamina = clamp(v.stamina + (v.sleeping ? 0.2 : 0.08) * dt, 0, 1);
  }

  // Máu: đói/khát về 0 thì mất máu; cả hai > 0.5 và không chảy máu thì hồi
  if (v.hunger === 0 || v.thirst === 0) {
    v.hp -= 0.01 * v.maxHp * dt;
  } else if (v.hunger > 0.5 && v.thirst > 0.5 && v.bleed <= 0) {
    v.hp += 0.005 * v.maxHp * dt;
  }

  // Chảy máu: bleed là phần trăm maxHp mất mỗi giây, tự giảm dần về 0
  if (v.bleed > 0) {
    v.hp -= (v.bleed / 100) * v.maxHp * dt;
    v.bleed = Math.max(0, v.bleed - 0.2 * dt);
  }

  v.hp = clamp(v.hp, 0, v.maxHp);

  // Lớn dần chậm, chỉ khi ăn uống đủ
  if (v.hunger > 0.3 && v.thirst > 0.3) {
    v.growth = clamp(v.growth + dt / 1200, 0, 1);
  }
  syncStage(v, speciesId);

  return {
    dead: v.hp <= 0,
    canSprint: v.stamina > 0,
    stage: stageOf(v.growth),
  };
}

export function eat(v, speciesId, amount) {
  v.hunger = clamp(v.hunger + amount, 0, 1);
  v.growth = clamp(v.growth + amount * 0.02, 0, 1);
  syncStage(v, speciesId);
  return v;
}

export function drink(v, amount) {
  v.thirst = clamp(v.thirst + amount, 0, 1);
  return v;
}

export function applyDamage(v, dmg, bleed = 0) {
  v.hp = Math.max(0, v.hp - dmg);
  v.bleed = clamp(v.bleed + bleed, 0, 5);
  return { dead: v.hp <= 0 };
}
