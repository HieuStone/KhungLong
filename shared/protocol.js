// Hợp đồng mạng client <-> server. Mọi message là JSON: { t: <type>, ...payload }.
// KHÔNG đổi tên/field khi chưa được Claude duyệt (ghi vào REVIEW.md).

export const C2S = {
  JOIN: 'join',       // { name: string, species: SPECIES_IDS[i], colors?: { body: '#rrggbb', accent: '#rrggbb' } } (colors: màu khủng long người chơi chọn)
  INPUT: 'input',     // { seq: int, mx: -1..1 (trái/phải), mz: -1..1 (trước/sau), yaw: rad, sprint: bool, up: -1..1 (loài bay: +1 bay lên/cất cánh, -1 hạ xuống) }
  ATTACK: 'attack',   // { kind: tên đòn trong species.attacks }
  INTERACT: 'interact', // { } ăn/uống: client gửi lặp lại khi giữ phím E; server mỗi lần uống/cắn một ngụm (có hồi chiêu) và chạy anim 'drink'/'eat'
  SLEEP: 'sleep',     // { on: bool }
  GRAB: 'grab',       // { } ngậm/kéo xác gần nhất để tha đi; bấm lại để thả
  ROAR: 'roar',       // { } gầm: doạ con mồi chạy, người chơi gần nghe thấy (hồi chiêu vài giây)
};

export const S2C = {
  WELCOME: 'welcome', // { id, seed, tickRate }
  SNAPSHOT: 'snap',   // { tick, ack: lastProcessedSeq (của riêng client), players: PlayerState[], npcs: NpcState[] (chỉ NPC gần, xem shared/npcs.js), you: SelfState }
  DEAD: 'dead',       // { cause: 'starvation'|'wounds'|'killed', by?: tên kẻ giết }
  ERROR: 'error',     // { msg }
  EVENT: 'event',     // { kind, x, z, ... } sự kiện một lần để client phát âm thanh/hiệu ứng (xem server/index.js emit)
  NOTICE: 'notice',   // { msg } thông báo ngắn hiển thị trên màn hình (vd "Không có nước phía trước")
};

/** PlayerState (gửi cho mọi người): { id, name, species, stage, x, y, z, yaw, hp01, anim, fly, alt, colors (null = màu mặc định) }
 *  y là độ cao tuyệt đối (gồm cả độ cao khi bay); alt = y - mặt đất; fly = đang bay
 *  anim: 'idle'|'walk'|'run'|'attack'|'eat'|'drink'|'fly'|'glide'|'sleep'|'dead'
 *  SelfState (chỉ gửi cho chính mình): { hp, maxHp, hunger, thirst, stamina, growth01, bleeding, flying, alt, carrying, poisoned } — các giá trị 0..1 trừ hp/maxHp/alt
 *  CarcassState (snapshot.carcasses, chỉ xác gần): { id, type: 'npc'|'dino', kind (loại con vật hoặc id loài), stage, x, y, z, yaw, rot (độ thối 0..1), meat01 (còn bao nhiêu thịt), carried, mode: 'mouth'|'drag'|null, colors (màu của khủng long đã chết, hoặc null) }
 *  EventState (snapshot.ev, chỉ sự kiện gần người nhận): { kind: 'roar'|'bite'|'miss'|'npc_hurt'|'npc_die'|'land'|'takeoff'|'player_hurt'|'player_die', x, z, y?, species?, victim? (loại con vật), size? } */

export const encode = (msg) => JSON.stringify(msg);
export const decode = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
