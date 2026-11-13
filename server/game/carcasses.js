// Xác của mọi sinh vật chết (con mồi nhỏ và khủng long): thịt ăn được, thối rữa theo thời gian rồi biến mất, tha đi được.
import { SPECIES, STAGE_SCALE, NPC_KINDS } from '@isle/shared';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * cfg = CONFIG.carcass (xem server/game.config.js).
 * type: 'npc' (con mồi nhỏ, kind = gà/thỏ/chuột/chim) | 'dino' (khủng long, kind = id loài)
 */
export function createCarcasses(cfg, rng = Math.random) {
  const list = new Map();
  let nextId = 1;
  let onRemove = () => {};

  const sizeOf = (type, kind, stage) => (type === 'npc'
    ? NPC_KINDS[kind].bodyLength
    : SPECIES[kind].bodyLength * STAGE_SCALE[stage || 'adult']);

  /** Thêm một cái xác. Trả về đối tượng xác. */
  function add({ type, kind, stage = 'adult', x, y, z, yaw = 0, name = '', colors = null }) {
    const size = sizeOf(type, kind, stage);
    const meatMax = type === 'npc' ? NPC_KINDS[kind].nutrition : cfg.meatPerSquareMeter * size * size;
    // Xác to tồn tại lâu hơn xác nhỏ (có thể tắt bằng sizeLifetimeFactor = 0)
    const f = 1 + (clamp(size / 3, 0.4, 3) - 1) * cfg.sizeLifetimeFactor;
    const c = {
      id: nextId++, type, kind, stage, x, y, z, yaw, name, colors, size, mass: size * size,
      meat: meatMax, meatMax, age: 0, fresh: cfg.freshSeconds * f, rot: cfg.rotSeconds * f,
      carriedBy: null, mode: null,
    };
    list.set(c.id, c);
    return c;
  }

  /** Độ thối 0..1 (0 = còn tươi, 1 = thối hết mức, sắp biến mất). */
  const rot01 = (c) => clamp((c.age - c.fresh) / c.rot, 0, 1);

  /** Cho thời gian trôi: xác già đi, thối, và biến mất khi hết hạn hoặc hết thịt. */
  function step(dt) {
    for (const c of list.values()) {
      c.age += dt;
      if (c.age >= c.fresh + c.rot || c.meat <= 1e-6) { list.delete(c.id); onRemove(c); }
    }
  }

  /** Xác trong bán kính range quanh (x, z) (kể cả đang bị tha). */
  function near(x, z, range) {
    const out = [];
    for (const c of list.values()) if (Math.abs(c.x - x) <= range && Math.abs(c.z - z) <= range) out.push(c);
    return out;
  }

  /**
   * Cắn một miếng: lấy tối đa `want` thịt nhưng không quá `room` (chỗ còn trống trong bụng).
   * Trả về { taken: lượng thịt bị lấy khỏi xác, gain: dinh dưỡng thực nhận (giảm nếu thối), poisoned }.
   */
  function bite(c, want, room = 1) {
    const taken = Math.max(0, Math.min(want, c.meat, room));
    const r = rot01(c);
    c.meat -= taken;
    const gain = taken * (1 - cfg.rottenMeatNutritionLoss * r);
    const poisoned = taken > 0 && r > 0.25 && rng() < cfg.poisonChanceWhenRotten * r;
    return { taken, gain, poisoned };
  }

  /**
   * Có tha được xác này không? ownSize = chiều dài thân người tha (m).
   * Trả về { ok, mode: 'mouth' | 'drag', speedMult, reason }.
   */
  function grabPlan(c, ownSize) {
    if (!cfg.canDrag) return { ok: false, reason: 'Server không cho phép tha xác' };
    const ownMass = ownSize * ownSize;
    if (c.size <= cfg.carryInMouthMaxSizeRatio * ownSize) {
      return { ok: true, mode: 'mouth', speedMult: clamp(1 - 0.5 * (c.mass / ownMass), 0.8, 0.98) };
    }
    if (c.mass <= cfg.maxDragMassRatio * ownMass) {
      return { ok: true, mode: 'drag', speedMult: clamp(1 - c.mass / (ownMass * 1.8), 0.3, 0.85) };
    }
    return { ok: false, reason: 'Xác quá nặng để tha đi' };
  }

  /** Dữ liệu gửi cho client. */
  const view = (c) => ({
    id: c.id, type: c.type, kind: c.kind, stage: c.stage, x: c.x, y: c.y, z: c.z, yaw: c.yaw,
    rot: rot01(c), meat01: c.meat / c.meatMax, carried: c.carriedBy != null, mode: c.mode, colors: c.colors,
  });

  return {
    list, add, step, near, bite, grabPlan, view, rot01,
    get(id) { return list.get(id); },
    count: () => list.size,
    setOnRemove(fn) { onRemove = fn; },
  };
}
