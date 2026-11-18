# Âm thanh thật cho tiếng gầm / kêu

Game dùng các file âm thanh trong thư mục này cho **tiếng gầm** (phím R, và khi cắn/đánh nhau) và **tiếng kêu đau của khủng long**.
Loại nào không có file thì tự dùng âm tổng hợp (không cần file). Tải lại trang (F5) sau khi sửa để áp dụng.

## Cách game dùng
- **Chọn theo loại**: `carnivore` (T-rex, Utahraptor), `herbivore` (Triceratops, Dryosaurus), `pterosaur` (Pteranodon). Tiếng kêu đau / chết của khủng long: `hurt.dino`, `die.dino`.
- **Không lặp liền**: không phát lại đúng mẫu vừa phát.
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

## Nghe thử
Chạy dev server rồi mở `/sounds/preview.html`: phát từng mẫu trong manifest với cao độ theo cỡ thân (kéo thanh trượt). Mẫu nào không ưng thì xoá dòng đó trong `manifest.json`.

## Ghi công / giấy phép
Bộ tiếng khủng long trong `dino/` (gầm, kêu đau, chết) được cắt từ các bản ghi dưới đây, đổi sang mono .ogg, vuốt đầu/cuối và chuẩn hoá âm lượng. Tất cả là **CC0** (Freesound, đã kiểm tra trên từng trang) hoặc **Public domain** (Wikimedia Commons), không bắt buộc ghi công; vẫn ghi lại để tiện tra cứu. Bản Freesound lấy từ bản xem trước chất lượng cao (mp3 128 kbps).

| File trong `dino/` | Bản gốc | Tác giả | Giấy phép |
|---|---|---|---|
| carnivore_01 | [T-rex roar -KingofTheForest](https://freesound.org/s/643747/) | Nerdwizard78 | CC0 |
| carnivore_02 | [dinosaur roar 1](https://freesound.org/s/810951/) | Logicogonist | CC0 |
| carnivore_03, 04; herbivore_06, 07; die_04 | [Dinosaur Breath, Moan, and Roar](https://freesound.org/s/670510/) | 2create | CC0 |
| carnivore_05, 06; herbivore_08; die_03 | [T Rex Closed Mouth Vocalizations](https://freesound.org/s/688734/) (tiếng "ầm" ngậm miệng, kiểu khoa học cho là khủng long thật có thể phát ra) | mescamilla1980 | CC0 |
| carnivore_07; herbivore_02–04 | [Alligator bellow](https://commons.wikimedia.org/wiki/File:27alligator2bellow.ogg) (cá sấu Mỹ thật, họ hàng gần của khủng long) | Wikimedia Commons | Public domain |
| carnivore_08 | [T-Rex Calls](https://freesound.org/s/529462/) | CaveboyTup | CC0 |
| carnivore_09–11, 21; hurt_03, 04; die_02 | [Dinosaur Roars and Growls V2](https://freesound.org/s/641743/) | GojiS.O.S. | CC0 |
| carnivore_12; hurt_01, 02 | [DINOSAUR ROAR](https://freesound.org/s/578601/) | Podcapocalipsis | CC0 |
| carnivore_13–15 | [Angry Dinosaur](https://freesound.org/s/328832/) | dinodilopho | CC0 |
| carnivore_16–19 | Dinosaur [2](https://freesound.org/s/233277/), [3](https://freesound.org/s/233278/), [4](https://freesound.org/s/233279/), [5](https://freesound.org/s/233284/) | JarredGibb | CC0 |
| carnivore_20; hurt_05 | [Large Theropod dinosaur noise](https://freesound.org/s/871814/) | OddlakePro | CC0 |
| carnivore_22–25; hurt_06 | [raptor.wav](https://freesound.org/s/340272/) | taure | CC0 |
| carnivore_26 | [Dinosaur Snarl](https://freesound.org/s/639448/) | LaurenPonder | CC0 |
| carnivore_27; carnivore_30; hurt_09 | [Dino Growl](https://freesound.org/s/727775/), [Dinosaur call](https://freesound.org/s/708641/) | Alessandrobraz | CC0 |
| carnivore_28 | [Velociraptor_Growls](https://freesound.org/s/154637/) | crcavol | CC0 |
| carnivore_29 | [dinosaur.wav](https://freesound.org/s/455906/) | JhennaSide | CC0 |
| herbivore_01 | [brachiosaurus breying](https://freesound.org/s/643924/) | Nerdwizard78 | CC0 |
| herbivore_05 | [Wildlife Creature Warning Howl](https://freesound.org/s/743078/) | qubodup | CC0 |
| herbivore_09–13 | [grazer_call.wav](https://freesound.org/s/157818/) | slugzilla | CC0 |
| herbivore_14–17; hurt_07, 08 | [Herbivorous Alien Dinosaur Sound](https://freesound.org/s/720906/) | Mastersoundboy2005 | CC0 |
| pterosaur_01, 02 | [pterodactyl.wav](https://freesound.org/s/53263/) | stomachache | CC0 |
| pterosaur_03 | [pterodactyl.wav](https://freesound.org/s/263530/) | dinodilopho | CC0 |
| pterosaur_04–07 | [Angry Horror Movie Phlegmy Pterodactyl Bird](https://freesound.org/s/579674/) | psychetorics | CC0 |
| pterosaur_08 | [Alien Pterodactyl Sound Effect](https://freesound.org/s/757293/) | Mastersoundboy2005 | CC0 |
| die_01 | [Dragons Dying Breath](https://freesound.org/s/276577/) | MickBoere | CC0 |

### Bước chân (`steps/`)
Mỗi bước phát chồng 3 lớp: **bề mặt** (`step.grass|sand|rock|water|wood`, theo chỗ đang đứng) + **"thịch"** (`stomp.thud`, từ ~1.8 m) + **rung đất** (`stomp.sub`, từ ~5 m). Cao độ và độ to đổi theo cỡ thân. Các đoạn được tách tự động từng bước một từ bản ghi gốc. Tất cả **CC0** (Freesound).

| File trong `steps/` | Bản gốc | Tác giả |
|---|---|---|
| stomp_sub_01 | [DinoSteps1.wav](https://freesound.org/s/77027/) | andysm |
| stomp_sub_02–07 | [Monster footsteps](https://freesound.org/s/744789/) (ghi bằng geophone - cảm biến rung đất) | lori.mortimer |
| stomp_sub_08, 09 | [Giant Stepping](https://freesound.org/s/770586/) | The_Mind_of_Sound_Official |
| stomp_thud_01–04 | [giant footsteps.mp3](https://freesound.org/s/531725/) | Beefmaster69 |
| stomp_thud_05, 06 | [Monster Footsteps 01.wav](https://freesound.org/s/339439/) | juansua990 |
| stomp_thud_07–12 | [Stomping Ground Super Bassy](https://freesound.org/s/334228/) | oscaraudiogeek |
| stomp_thud_13, 14 | [Hard Stomp Sound](https://freesound.org/s/512483/) | phiIRaco |
| stomp_thud_15–18 | [GiantStompFootsteps.mp3](https://freesound.org/s/622737/) | RobHorror240 |
| step_grass_01–06 | [grass footsteps.mp3](https://freesound.org/s/362250/) | DSOADigital |
| step_grass_07–10 | [Hiking Boot Footsteps on Grass](https://freesound.org/s/521587/) | Fission9 |
| step_grass_11 | [Footstomp_Mulch.wav](https://freesound.org/s/682876/) | drewsimko |
| step_sand_01–06 | [Footsteps on sand.wav](https://freesound.org/s/383490/) | Daphne_in_Wonderland |
| step_sand_07–09 | [Footsteps Mountain Boots Wet Sand](https://freesound.org/s/564893/) | Nox_Sound |
| step_rock_01–04 | [Gravel Footsteps 1](https://freesound.org/s/750797/) | simonjeffery13 |
| step_rock_05–07 | [Footsteps Mountain Boots Gravel](https://freesound.org/s/556002/) | Nox_Sound |
| step_rock_08–11 | [Monster footsteps on gravel](https://freesound.org/s/712066/) | AudioPapkin |
| step_water_01–04 | [Splashing Footsteps Shallow Water](https://freesound.org/s/861369/) | ChristopherJngs |
| step_water_05–09 | [Splashing Stomps Impacts Shallow Water](https://freesound.org/s/861370/) | ChristopherJngs |
| step_water_10, 11 | [Slow Water Footsteps](https://freesound.org/s/369580/) | Adielees9 |
| step_wood_01–05 | [Footsteps over Wooden Bridge](https://freesound.org/s/253091/) | OBXJohn |
| step_wood_06–09 | [Footsteps on a wooden bridge](https://freesound.org/s/397670/) | felix.blume |

Các file cũ ở thư mục gốc (không còn dùng trong manifest), lấy từ OpenGameArt (CC0 theo trang nguồn; người dùng cần tự kiểm tra lại):

| File | Nguồn | Giấy phép (theo trang nguồn) |
|------|-------|------------------------------|
| `roar_*`, `monster_*`, `grunt_*`, `troll_*`, `howl`, `scream_*`, `alien_*`, `barking_01`, `hurt_*` (.ogg) | gói "80 CC0 creature SFX" (opengameart.org/content/80-cc0-creature-sfx) | CC0 |
| `monster_roar_deep.wav` (cắt và đổi sang mono từ `monster_roar.wav`) | "CC0 deep monster roar" (opengameart.org/content/cc0-deep-monster-roar) | CC0 |
| `trex_calls.mp3` | "t rex calls" (opengameart.org/content/t-rex-calls) | CC0 |

Nếu thêm file có yêu cầu ghi công (CC-BY...), ghi vào bảng trên: tên file - tác giả - nguồn - giấy phép. Không dùng âm thanh trích từ phim hoặc thư viện trả phí nếu giấy phép không cho phép.
