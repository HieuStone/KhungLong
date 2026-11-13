# T02 – Server: logic sinh tồn thuần (đói, khát, stamina, máu, chảy máu, lớn dần)

## Mục tiêu
Viết module logic THUẦN (không dùng WebSocket, không đọc đồng hồ thật) để dễ test. Claude sẽ tự ghép vào vòng tick của `server/index.js`.

## File được phép
- TẠO `server/game/survival.js` và `server/game/survival.test.js` (Vitest). KHÔNG sửa `server/index.js`.

## Giao diện bắt buộc (`survival.js`)
```js
export function createVitals(speciesId, stage = 'hatchling')
// -> { hp, maxHp, hunger, thirst, stamina, maxStamina, growth, bleed, sleeping }
//    hunger/thirst/stamina: 0..1 (1 = đầy/khoẻ). growth: 0..1 tổng tiến độ lớn (0..1 chia 4 chặng cho GROWTH_STAGES).
//    maxHp = SPECIES[speciesId].health * STAGE_SCALE[stage]

export function stepVitals(v, speciesId, dt, { moving, sprinting, inWater })
// Biến đổi v tại chỗ theo dt (giây):
//  - hunger giảm = species.hungerRate * 0.01 * dt (x2 nếu sprinting); thirst giảm = species.thirstRate * 0.01 * dt.
//  - stamina: sprinting trừ 0.15/giây; không sprint thì hồi 0.08/giây (0.2/giây nếu sleeping). Kẹp 0..1. Hết stamina => không được sprint (trả cờ trong kết quả).
//  - hunger hoặc thirst == 0 => hp giảm 1% maxHp/giây. Cả hai > 0.5 và không bleed => hp hồi 0.5% maxHp/giây.
//  - bleed > 0 => hp giảm bleed% maxHp/giây, bleed giảm 0.2/giây (về 0 thì dừng).
//  - growth tăng chậm 1/1200 mỗi giây nếu hunger > 0.3 và thirst > 0.3 (cần ~20 phút lên adult).
// Trả về { dead: boolean, canSprint: boolean, stage: string }

export function eat(v, speciesId, amount)   // cộng hunger (kẹp 1), cộng growth thêm amount*0.02
export function drink(v, amount)            // cộng thirst (kẹp 1)
export function applyDamage(v, dmg, bleed = 0) // trừ hp (kẹp 0), cộng bleed (kẹp 0..5). Trả { dead }
export function stageOf(growth)             // 'hatchling'|'juvenile'|'subadult'|'adult' theo mốc 0/0.25/0.5/0.75
export function stageStats(speciesId, stage) // -> { maxHp, speed, sprintSpeed, scale } nhân theo STAGE_SCALE (speed: 0.5+0.5*scale như server/index.js)
```
Khi `stageOf` đổi chặng, `stepVitals` phải cập nhật `maxHp` (giữ nguyên tỉ lệ hp/maxHp).

## Test (Vitest) tối thiểu
- Đói/khát giảm đúng theo thời gian; sprint tốn stamina và hết thì `canSprint=false`.
- hunger=0 làm hp giảm đến chết (`dead=true`); `eat`/`drink` kẹp ở 1.
- Chảy máu giảm dần về 0; lên chặng mới thì maxHp tăng và tỉ lệ hp giữ nguyên.

## Nghiệm thu
- `npm test` ở thư mục gốc: tất cả pass.

## Kết quả
- Đã tạo `server/game/survival.js` (đủ 7 hàm theo giao diện phiếu) và `server/game/survival.test.js` (14 test). Không sửa file nào khác, không commit.
- Chạy `npm test` ở thư mục gốc: 14/14 test của T02 pass (1 lần fail do test tự lệch tỉ lệ hp vì hồi máu, đã sửa test, không đổi code).
- Diễn giải tự quyết: `maxStamina = 1` (thang 0..1); `bleed` hiểu là % maxHp/giây (bleed/100); `inWater` nhận nhưng chưa dùng vì phiếu không có công thức; `eat` cũng đồng bộ chặng lớn (maxHp) ngay khi growth vượt mốc.
- Chưa làm: chưa ghép vào `server/index.js` (việc của Claude theo phiếu).
