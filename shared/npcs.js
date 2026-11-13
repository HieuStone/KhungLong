// Con mồi NPC (do server điều khiển). Client chỉ vẽ theo snapshot.
// Đơn vị mét, giây. nutrition = lượng đói hồi (0..1) khi ăn hết xác (cho loài ăn thịt).
export const NPC_KINDS = {
  // Tốc độ chạy cố ý chậm hơn khủng long con (sprint ~7.5-12.5 m/s) để săn được
  chicken: { name: 'Gà',   hp: 12, bodyLength: 0.5,  walk: 1.0, run: 3.6,  fleeRange: 14, nutrition: 0.28, count: 24, flies: false },
  rabbit:  { name: 'Thỏ',  hp: 8,  bodyLength: 0.45, walk: 1.2, run: 5.0,  fleeRange: 18, nutrition: 0.22, count: 30, flies: false },
  mouse:   { name: 'Chuột', hp: 3, bodyLength: 0.14, walk: 0.7, run: 2.8,  fleeRange: 9,  nutrition: 0.06, count: 40, flies: false },
  bird:    { name: 'Chim', hp: 4,  bodyLength: 0.3,  walk: 1.0, run: 2.5,  fleeRange: 14, nutrition: 0.1,  count: 30, flies: true, fly: 7 },
};
export const NPC_IDS = Object.keys(NPC_KINDS);

/**
 * NpcState (trong snapshot.npcs, chỉ gửi NPC gần người chơi):
 *   { id, kind, x, y, z, yaw, anim, hp01 }
 *   anim: 'idle' | 'walk' | 'run' | 'fly' | 'dead'   (y đã gồm độ cao khi bay)
 */
