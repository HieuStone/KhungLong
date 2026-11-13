# Âm thanh thật cho tiếng gầm / kêu

Game dùng các file âm thanh trong thư mục này cho **tiếng gầm** (phím R, và khi cắn/đánh nhau) và **tiếng kêu đau của khủng long**.
Loại nào không có file thì tự dùng âm tổng hợp (không cần file). Tải lại trang (F5) sau khi sửa để áp dụng.

## Cách game dùng
- **Chọn theo loại**: `carnivore` (T-rex, Utahraptor), `herbivore` (Triceratops, Dryosaurus), `pterosaur` (Pteranodon).
- **Chọn theo cỡ thân**: mỗi mục có thể có `minSize` / `maxSize` (mét, chiều dài thân hiện tại của con vật). Con to chọn tiếng trầm/dài, con nhỏ chọn tiếng ngắn/cao. Có nhiều file hợp thì chọn ngẫu nhiên.
- **Cao độ tự đổi theo cỡ thân** (con to trầm hơn) và con to được trộn thêm một lớp trầm cho nặng.
- **Cắt đoạn trong file dài**: `{ "file": "trex_calls.mp3", "start": 4.5, "end": 7.5 }` (giây). Mỗi file chỉ giải mã một lần.
- Định vị gần/xa và trái/phải vẫn áp dụng như âm tổng hợp.

## Cấu trúc manifest.json
```json
{
  "roar": {
    "carnivore": [ "tenfile.ogg", { "file": "dai.mp3", "start": 1.0, "end": 3.5, "minSize": 8 } ],
    "herbivore": [],
    "pterosaur": []
  },
  "hurt": { "dino": [ "kêu-đau.ogg" ] }
}
```
File `.ogg`, `.mp3`, `.wav` đều dùng được; mỗi file nên nhỏ (dưới ~300 KB).

## Ghi công / giấy phép
Các file đang dùng được người dùng tải từ OpenGameArt (theo trang nguồn là **CC0**, không cần ghi công; Claude KHÔNG tự xác nhận được giấy phép vì trang chặn công cụ tải tự động, nên người dùng cần tự kiểm tra lại trên trang nguồn):

| File | Nguồn | Giấy phép (theo trang nguồn) |
|------|-------|------------------------------|
| `roar_*`, `monster_*`, `grunt_*`, `troll_*`, `howl`, `scream_*`, `alien_*`, `barking_01`, `hurt_*` (.ogg) | gói "80 CC0 creature SFX" (opengameart.org/content/80-cc0-creature-sfx) | CC0 |
| `monster_roar_deep.wav` (cắt và đổi sang mono từ `monster_roar.wav`) | "CC0 deep monster roar" (opengameart.org/content/cc0-deep-monster-roar) | CC0 |
| `trex_calls.mp3` | "t rex calls" (opengameart.org/content/t-rex-calls) | CC0 |

Nếu thêm file có yêu cầu ghi công (CC-BY...), ghi vào bảng trên: tên file - tác giả - nguồn - giấy phép. Không dùng âm thanh trích từ phim hoặc thư viện trả phí nếu giấy phép không cho phép.
