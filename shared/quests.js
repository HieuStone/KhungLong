// Nhiệm vụ riêng cho từng loài khủng long (dùng chung server — tính tiến độ — và client — hiển thị).
// Mỗi nhiệm vụ lắng nghe một loại sự kiện (on) do server phát ra khi người chơi làm việc gì đó:
//   kill_prey {kind}       hạ một con mồi nhỏ (gà, thỏ, chuột, chim, thằn lằn, rùa, lợn rừng)
//   kill_dino {species}    hạ một khủng long khác
//   hit_dino {diet}        đánh trúng một khủng long khác (diet của nạn nhân)
//   eat_meat {type}        cắn một miếng xác ('npc' = con mồi nhỏ, 'dino' = khủng long)
//   eat_plant / drink      gặm một miếng cây / uống một ngụm
//   roar {audience}        gầm; audience = số khủng long khác trong 50 m
//   move {dist, sprint, fly}  quãng đường đi được trong tick (m)
//   altitude {alt}         độ cao khi bay (m)
//   escape                 thoát khỏi thú săn mồi lớn hơn (từ < 15 m ra > 50 m)
//   survive {sec}          sống thêm sec giây
// when(data): điều kiện tính; amount(data): cộng bao nhiêu (mặc định 1); mode 'max': tiến độ = giá trị lớn nhất đạt được.
// reward: { growth (cộng vào thanh Lớn 0..1), heal (phần máu tối đa hồi lại) }

const SMALL_PREY = ['chicken', 'rabbit', 'mouse', 'bird', 'lizard', 'turtle'];

export const QUESTS = {
  tyrannosaurus: [
    { id: 'rex_boar', title: 'Bạo chúa săn mồi', desc: 'Hạ 2 con lợn rừng', goal: 2, on: 'kill_prey', when: (d) => d.kind === 'boar', reward: { growth: 0.06, heal: 0.2 } },
    { id: 'rex_roar', title: 'Tiếng gầm thống trị', desc: 'Gầm (R) khi có khủng long khác trong 50 m', goal: 5, on: 'roar', when: (d) => d.audience > 0, reward: { growth: 0.03, heal: 0.1 } },
    { id: 'rex_scav', title: 'Kẻ dọn xác', desc: 'Ăn 15 miếng xác khủng long', goal: 15, on: 'eat_meat', when: (d) => d.type === 'dino', reward: { growth: 0.05, heal: 0.25 } },
    { id: 'rex_kill', title: 'Không đối thủ', desc: 'Hạ 1 khủng long khác', goal: 1, on: 'kill_dino', reward: { growth: 0.1, heal: 0.4 } },
  ],
  utahraptor: [
    { id: 'raptor_prey', title: 'Thợ săn nhanh nhẹn', desc: 'Hạ 6 con mồi nhỏ', goal: 6, on: 'kill_prey', when: (d) => SMALL_PREY.includes(d.kind), reward: { growth: 0.05, heal: 0.2 } },
    { id: 'raptor_claw', title: 'Móng liềm', desc: 'Cắn/cào trúng khủng long khác 10 lần', goal: 10, on: 'hit_dino', reward: { growth: 0.04, heal: 0.15 } },
    { id: 'raptor_sprint', title: 'Chạy như gió', desc: 'Chạy nước rút (Shift) tổng 600 m', goal: 600, on: 'move', when: (d) => d.sprint && !d.fly, amount: (d) => d.dist, reward: { growth: 0.03, heal: 0.1 } },
    { id: 'raptor_kill', title: 'Hạ con mồi lớn', desc: 'Hạ 1 khủng long khác', goal: 1, on: 'kill_dino', reward: { growth: 0.1, heal: 0.4 } },
  ],
  triceratops: [
    { id: 'trike_graze', title: 'Đồng cỏ', desc: 'Gặm cây 30 lần (E cạnh dương xỉ/bụi)', goal: 30, on: 'eat_plant', reward: { growth: 0.05, heal: 0.2 } },
    { id: 'trike_horn', title: 'Sừng phòng thủ', desc: 'Húc trúng loài ăn thịt 6 lần', goal: 6, on: 'hit_dino', when: (d) => d.diet === 'carnivore', reward: { growth: 0.06, heal: 0.3 } },
    { id: 'trike_roam', title: 'Đàn du mục', desc: 'Đi tổng cộng 1500 m', goal: 1500, on: 'move', when: (d) => !d.fly, amount: (d) => d.dist, reward: { growth: 0.04, heal: 0.1 } },
    { id: 'trike_drink', title: 'Bến nước', desc: 'Uống 20 ngụm nước', goal: 20, on: 'drink', reward: { growth: 0.03, heal: 0.15 } },
  ],
  dryosaurus: [
    { id: 'dryo_escape', title: 'Thoát hiểm', desc: 'Thoát khỏi thú săn mồi 3 lần (bị áp sát < 15 m rồi chạy xa > 50 m)', goal: 3, on: 'escape', reward: { growth: 0.07, heal: 0.3 } },
    { id: 'dryo_graze', title: 'Lá non', desc: 'Gặm cây 20 lần', goal: 20, on: 'eat_plant', reward: { growth: 0.04, heal: 0.15 } },
    { id: 'dryo_sprint', title: 'Đôi chân thoăn thoắt', desc: 'Chạy nước rút tổng 800 m', goal: 800, on: 'move', when: (d) => d.sprint && !d.fly, amount: (d) => d.dist, reward: { growth: 0.04, heal: 0.1 } },
    { id: 'dryo_survive', title: 'Sống sót', desc: 'Sống sót 10 phút', goal: 600, on: 'survive', amount: (d) => d.sec, reward: { growth: 0.08, heal: 0.5 } },
  ],
  pteranodon: [
    { id: 'ptero_fly', title: 'Cưỡi gió', desc: 'Bay tổng cộng 2500 m', goal: 2500, on: 'move', when: (d) => d.fly, amount: (d) => d.dist, reward: { growth: 0.04, heal: 0.1 } },
    { id: 'ptero_alt', title: 'Đỉnh trời', desc: 'Bay lên độ cao 60 m', goal: 60, on: 'altitude', mode: 'max', amount: (d) => d.alt, reward: { growth: 0.03, heal: 0.1 } },
    { id: 'ptero_dive', title: 'Bổ nhào săn mồi', desc: 'Hạ 4 con mồi nhỏ', goal: 4, on: 'kill_prey', when: (d) => SMALL_PREY.includes(d.kind), reward: { growth: 0.05, heal: 0.2 } },
    { id: 'ptero_drink', title: 'Hồ nước trên đảo', desc: 'Uống 12 ngụm nước', goal: 12, on: 'drink', reward: { growth: 0.03, heal: 0.15 } },
  ],
};

/** Danh sách nhiệm vụ của một loài (mảng rỗng nếu chưa có). */
export const questsOf = (species) => QUESTS[species] || [];
