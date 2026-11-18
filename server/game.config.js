// =====================================================================================
//  CẤU HÌNH GAME (chỉ phía server). Sửa số ở đây rồi KHỞI ĐỘNG LẠI server để áp dụng.
//
//  Cách chỉnh nhanh:
//   - Muốn khủng long NPC hiền lành:  predation.huntPlayers = 0  và  predation.huntDinos = 0
//   - Muốn nhiều khủng long hơn:      npcDinos.counts.*  tăng lên
//   - Muốn NPC không bao giờ trưởng thành: npcDinos.maxStage = 'juvenile'
//   - Tắt hẳn khủng long NPC:         npcDinos.enabled = false
//
//  Có thể ghi đè tạm thời bằng biến môi trường ISLE_CONFIG (JSON, gộp sâu vào cấu hình này), ví dụ:
//    ISLE_CONFIG='{"predation":{"huntPlayers":1}}' node server/index.js
// =====================================================================================

const DEFAULTS = {
  // ---------------------------------------------------------------------------------
  //  KHỦNG LONG NPC: sống, kiếm ăn, uống nước, đánh nhau và có thể ăn thịt lẫn nhau / người chơi
  // ---------------------------------------------------------------------------------
  npcDinos: {
    enabled: true,

    // Số lượng mỗi loài luôn được duy trì trên bản đồ (chết thì sau `respawnDelay` giây có con mới).
    // Loài: tyrannosaurus, utahraptor, triceratops, dryosaurus, pteranodon. Đặt 0 để không có loài đó.
    counts: { tyrannosaurus: 6, utahraptor: 12, triceratops: 15, dryosaurus: 20, pteranodon: 20 },

    // Giai đoạn lớn khi xuất hiện: chọn ngẫu nhiên trong khoảng này.
    // Các mức theo thứ tự: 'hatchling' (con non) < 'juvenile' < 'subadult' < 'adult' (trưởng thành)
    spawnStage: { min: 'hatchling', max: 'adult' },

    // MỨC TIẾN HOÁ TỐI ĐA mà khủng long NPC có thể đạt (chúng không lớn hơn mức này dù ăn đủ).
    // 'adult' = không giới hạn. Đặt 'subadult' để NPC không bao giờ to bằng người chơi trưởng thành.
    maxStage: 'adult',

    // Tốc độ lớn của NPC so với người chơi (1 = như nhau, 2 = lớn nhanh gấp đôi, 0 = không lớn thêm).
    growthSpeedMultiplier: 0.8,

    respawnDelay: 60,                  // giây chờ trước khi một con NPC đã chết được thay thế
    minSpawnDistanceFromPlayers: 80,   // mét: NPC mới không xuất hiện gần người chơi hơn mức này
    nameSuffix: ' (NPC)',              // hậu tố tên hiển thị trong thông báo "bị ... giết"
  },

  // ---------------------------------------------------------------------------------
  //  MỨC ĐỘ SĂN BẮT & CHIẾN ĐẤU của khủng long NPC
  // ---------------------------------------------------------------------------------
  predation: {
    // Mức sẵn sàng săn từng loại mục tiêu, từ 0 (không bao giờ) đến 1 (luôn luôn khi đủ điều kiện).
    huntPlayers: 0,   // săn NGƯỜI CHƠI
    huntDinos: 0.6,     // săn khủng long NPC khác
    huntPrey: 1.0,      // săn con mồi nhỏ (gà, thỏ, chuột, chim)

    cannibalism: true, // true: NPC được phép săn cùng loài với mình

    // Chỉ săn mục tiêu có kích thước nằm trong khoảng [min, max] x kích thước của mình.
    // (kích thước = chiều dài thân hiện tại; max > 1 nghĩa là dám săn con to hơn một chút)
    minTargetSizeRatio: 0.2,
    maxTargetSizeRatio: 1.2,

    aggroRange: 60,            // m: phát hiện và có thể bắt đầu săn mục tiêu trong tầm này
    loseInterestRange: 110,    // m: mục tiêu chạy xa hơn mức này thì bỏ cuộc
    huntGiveUpSeconds: 40,     // giây: đuổi mãi không được thì bỏ
    huntBelowHunger: 0.5,     // chỉ chủ động săn khi đói hơn mức này. 1 = lúc nào cũng săn
    aggroRollSeconds: 20,      // cứ sau chừng này giây NPC "tung xúc xắc" lại xem có muốn săn một mục tiêu cụ thể không

    newPlayerProtectionSeconds: 60,  // người chơi mới xuất hiện được NPC bỏ qua trong thời gian này

    // Bị đánh trúng thì NPC luôn phản công kẻ đánh nó (bỏ qua huntBelowHunger / aggroRoll).
    provokedAlwaysFights: true,

    // Loài ăn cỏ (Triceratops, Dryosaurus):
    herbivoresFleeFromPredators: true,  // thấy thú săn mồi lớn hơn thì chạy trốn
    herbivoresFightBack: true,          // bị dồn vào đường cùng / bị đánh thì chống trả
    fearRange: 45,                      // m: bắt đầu sợ khi thú săn mồi lại gần trong tầm này

    packHunting: true,   // Utahraptor săn theo đàn: cả đàn cùng đuổi một mục tiêu
    packRange: 50,       // m: đồng loại trong tầm này được kéo vào cuộc săn

    // Nhân hệ số sức mạnh của NPC (1 = giống người chơi cùng loài/giai đoạn).
    attackDamageMultiplier: 1.0,
    speedMultiplier: 1.0,
  },

  // ---------------------------------------------------------------------------------
  //  XÁC: thời gian tồn tại, thối rữa, tha xác
  // ---------------------------------------------------------------------------------
  carcass: {
    freshSeconds: 120,   // giây xác còn TƯƠI (đủ dinh dưỡng, an toàn). Xác to tồn tại lâu hơn xác nhỏ.
    rotSeconds: 180,     // giây thối rữa sau đó: dinh dưỡng giảm dần, dễ ngộ độc, rồi BIẾN MẤT
    sizeLifetimeFactor: 1,  // 0 = mọi xác tồn tại như nhau; 1 = xác to lâu hơn, xác nhỏ nhanh hơn

    meatPerSquareMeter: 0.08,   // lượng thịt của khủng long = hệ số x (kích thước m)^2  (T-rex trưởng thành ~ 11)
    poisonChanceWhenRotten: 0.6,  // xác thối hết mức: xác suất ngộ độc mỗi miếng cắn (nhân theo độ thối)
    poisonSeconds: 20,            // thời gian ngộ độc (mất máu dần)
    poisonDamagePerSecond: 0.006, // % máu tối đa mất mỗi giây khi ngộ độc (0.006 = 0.6%/giây)
    rottenMeatNutritionLoss: 0.6, // thịt thối hết mức chỉ còn (1 - giá trị này) dinh dưỡng

    canDrag: true,              // cho phép tha xác (phím G)
    carryInMouthMaxSizeRatio: 0.4,   // xác nhỏ hơn 40% thân mình thì NGẬM đi (nhẹ, gần như không chậm)
    maxDragMassRatio: 1.2,      // chỉ kéo được xác nặng tối đa 1.2 lần mình (khối lượng ~ kích thước^2)
  },

  // ---------------------------------------------------------------------------------
  //  CON MỒI NPC (động vật nhỏ do server điều khiển). Chết thì sau ~20 giây con mới xuất hiện ở chỗ khác.
  //  Thịt (khi ăn hết xác): chuột 6%, chim 10%, thằn lằn 12%, thỏ 22%, gà 28%, rùa 30%, lợn rừng 60% thanh đói.
  // ---------------------------------------------------------------------------------
  prey: {
    counts: {
      chicken: 30,   // gà
      rabbit: 36,    // thỏ
      mouse: 40,     // chuột (rất nhỏ, khó thấy)
      bird: 34,      // chim (bay lên khi bị doạ)
      lizard: 32,    // thằn lằn: nhanh, chạy ziczac
      turtle: 18,    // rùa: chậm, rất lì; bị doạ thì rụt vào mai nằm im
      boar: 20,      // lợn rừng: con mồi cỡ vừa, nhiều thịt cho khủng long lớn
    },
  },

  // ---------------------------------------------------------------------------------
  //  AI chung
  // ---------------------------------------------------------------------------------
  ai: {
    thinkInterval: 0.25,   // giây giữa hai lần NPC suy nghĩ (nhỏ hơn = nhanh nhạy hơn, tốn CPU hơn)
    roamRadius: 2000,       // m: NPC lang thang quanh chỗ sinh ra trong bán kính này
    roarBeforeHunt: 0.5,  // xác suất gầm một tiếng trước khi lao vào săn (cho sống động)
  },
};

// ---- Gộp ghi đè từ biến môi trường ISLE_CONFIG (nếu có) ----
function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}
let override = {};
try { if (process.env.ISLE_CONFIG) override = JSON.parse(process.env.ISLE_CONFIG); } catch (e) { console.warn('[config] ISLE_CONFIG không phải JSON hợp lệ, bỏ qua:', e.message); }

export const CONFIG = deepMerge(DEFAULTS, override);
export { DEFAULTS as DEFAULT_CONFIG, deepMerge };
