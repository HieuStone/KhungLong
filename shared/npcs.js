// Con mồi NPC (do server điều khiển). Client chỉ vẽ theo snapshot.
// Đơn vị mét, giây. nutrition = lượng đói hồi (0..1) khi ăn hết xác (cho loài ăn thịt).
export const NPC_KINDS = {
  // Tốc độ chạy cố ý chậm hơn khủng long con chạy nước rút (~3.5-5 m/s) để săn được
  chicken: { name: 'Gà',   hp: 12, bodyLength: 0.5,  walk: 0.8, run: 2.6,  fleeRange: 14, nutrition: 0.28, count: 24, flies: false },
  rabbit:  { name: 'Thỏ',  hp: 8,  bodyLength: 0.45, walk: 1.0, run: 3.6,  fleeRange: 18, nutrition: 0.22, count: 30, flies: false },
  mouse:   { name: 'Chuột', hp: 3, bodyLength: 0.14, walk: 0.6, run: 2.0,  fleeRange: 9,  nutrition: 0.06, count: 40, flies: false },
  bird:    { name: 'Chim', hp: 4,  bodyLength: 0.3,  walk: 0.8, run: 1.8,  fleeRange: 14, nutrition: 0.1,  count: 30, flies: true, fly: 7 },
  // Thằn lằn: nhỏ, nhanh, chạy ziczac
  lizard:  { name: 'Thằn lằn', hp: 6, bodyLength: 0.55, walk: 0.8, run: 3.0, fleeRange: 10, nutrition: 0.12, count: 30, flies: false, zigzag: 0.6 },
  // Rùa: rất chậm, rất lì; bị doạ thì rụt đầu nằm im (hides) thay vì chạy
  turtle:  { name: 'Rùa',  hp: 30, bodyLength: 0.55, walk: 0.35, run: 0.6, fleeRange: 7,  nutrition: 0.3,  count: 16, flies: false, hides: true },
  // Lợn rừng: con mồi cỡ vừa, nhiều thịt (cho khủng long lớn), chạy khá nhanh
  boar:    { name: 'Lợn rừng', hp: 45, bodyLength: 1.3, walk: 1.1, run: 4.2, fleeRange: 24, nutrition: 0.6, count: 16, flies: false },
};
export const NPC_IDS = Object.keys(NPC_KINDS);

/**
 * NpcState (trong snapshot.npcs, chỉ gửi NPC gần người chơi):
 *   { id, kind, x, y, z, yaw, anim, hp01 }
 *   anim: 'idle' | 'walk' | 'run' | 'fly' | 'dead'   (y đã gồm độ cao khi bay)
 */
