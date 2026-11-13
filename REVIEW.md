# REVIEW (Claude ghi kết quả duyệt từng phiếu)

Giao việc tạm thời: agent Claude (Haiku/Sonnet). Khi Antigravity sửa xong (lỗi "certificate has expired" -> cập nhật IDE), các phiếu sau chuyển lại cho Gemini (dán thủ công prompt trong Antigravity; Gemini CLI không dùng được với gói Pro).

| Phiếu | Người làm | Trạng thái | Ghi chú |
|-------|-----------|-----------|---------|
| Scaffold + shared + server tối thiểu | Claude | Xong | |
| T01 client terrain | Haiku | Đã duyệt | |
| T02 server survival | Haiku | Đã duyệt + ghép server | 14 test |
| T03 client dino model | Sonnet | Đã duyệt + ghép client | nhận ra đúng 4 loài |
| Va chạm + vật lý | Claude | Xong | shared/world.js, shared/physics.js |
| T04 cây/đá đa dạng | Sonnet | Đã duyệt + ghép client | 6 loại cây, 5 loại đá x 4 biến thể, 26 draw call, gió đung đưa |
| T05 con mồi NPC (mô hình) | Sonnet | Đã duyệt + ghép client | gà, thỏ, chuột, chim |
| NPC server (AI, tấn công, ăn xác) | Claude | Xong | server/game/npcs.js |
| Camera zoom theo kích thước, quay thân, nghiêng khi quẹo | Claude | Xong | |

## Cập nhật: NPC chậm hơn, ăn/uống dùng được, cầu nối hai đảo
- NPC chạy chậm hơn: gà 3.6, thỏ 5.0, chuột 2.8 m/s (trước đây 6.5 / 11 / 5.5); chim bay 7.
- Ăn/uống: giữ E. Uống cần có nước ở phía trước mặt (hoặc đang lội nước) -> anim `drink` (vục đầu xuống). Loài ăn thịt cạnh xác -> quay mặt về xác, anim `eat` (cắn); loài ăn cỏ gần dương xỉ/bụi -> gặm. Không có gì thì hiện thông báo trên màn hình. Đang ăn/uống thì đứng yên.
- Cầu: shared/world.js `computeBridge()` tìm hai đảo lớn nhất (175.800 và 169.425 m2, cách nhau 76 m), nối bằng cầu vòm rộng 6 m, lan can liền (vật cản dày 0.7 m), hai đầu hoà vào bờ. `groundAt(x,z)` = độ cao mặt đứng (địa hình hoặc mặt cầu), server/client/vật lý đều dùng. Cây/đá được dọn khỏi lối cầu.
- Test mới: bridge.test.js (10 test: nối đúng hai đảo, đi qua được với 4 loài, lan can chặn lách ra mép), tổng 48/48 pass.
- Integration: giữ E ở bờ nước -> khát hồi, anim `drink` xuất hiện; hạ gà rồi ăn xác -> anim `eat`, xác biến mất.
- Chưa kiểm: người chơi thật đi bộ qua cầu trong trình duyệt (chỉ kiểm bằng mô phỏng vật lý và ảnh chụp cầu). Khi đứng trên cầu (cao 2-4 m) vẫn "uống" được nếu mặt hướng ra nước bên dưới, chưa chặn.
- Herbivore gặm cây vô hạn (cây không biến mất/hồi lại), chưa có hiệu ứng hình ảnh trên cây.

## Cập nhật: khủng long bay + âm thanh
- Loài `pteranodon` (shared/species.js, có `flight`). Giữ Space cất cánh/bay lên, Ctrl hoặc X hạ xuống, nhả phím thì lướt chìm dần; hạ cánh khi chạm đất liền hoặc nước nông, trên nước sâu chỉ lướt sát mặt nước. Bay tốn thể lực (lướt rẻ, vỗ cánh/lao nhanh tốn), hết thì rơi. Bay thấp bị thân cây/đá chắn (`stepFlyer`, `pushOutOfTallObstacles` trong shared/physics.js), bay cao hơn ngọn thì lướt qua. Phải hạ cánh mới ăn/uống được. Đánh nhau chỉ trúng mục tiêu cùng tầm cao (< 3.5 m).
- Gầm (R): doạ con mồi, phát tiếng cho người chơi gần. Hàng đợi sự kiện server -> client (`snapshot.ev`: roar, bite, miss, npc_hurt, npc_die, player_hurt, land, takeoff).
- Âm thanh (T07, Sonnet): client/src/audio.js, tổng hợp bằng Web Audio, không dùng file. 46 cấu hình đã đo bằng OfflineAudioContext (không NaN, không clip, phổ đúng: T-rex gầm 90% năng lượng dưới 200 Hz, gầm pterosaur 99% trên 2 kHz). Nối vào main.js: bước chân theo cỡ thân và nền (cỏ/cát/đá/nước/gỗ), vỗ cánh, nhai/gặm/uống, tiếng gà/chim/chuột/thỏ, sự kiện server, nền gió/sóng/rừng theo môi trường. M để tắt/bật.
- Chưa kiểm được bằng tai: âm sắc, cân bằng âm lượng (bước chân khá nhỏ so với gầm), độ phiền của chim/côn trùng lặp. Người dùng nghe thử ở /src/audio-preview.html khi chạy dev.
- T06 (Sonnet) mô hình Pteranodon: client/src/render/pterosaur.js, 42 mesh, 10 anim, 0 NaN. Đã xem trong game thật: cánh xoè khi bay, chỉ báo độ cao hoạt động, thể lực giảm khi bay. Chưa ưng: mào hơi to/cứng, cánh gập nhô ngón ra sau đuôi, đi bộ chưa chống cánh như tay, `dead` nằm sấp cánh xoè (chưa kiểm cánh có xuyên đất).
- Hạn chế môi trường kiểm thử: Edge headless chạy WebGL bằng phần mềm rất chậm ở độ phân giải đầy đủ (chỉ ~2-6 lệnh input trong 15 s), nên ảnh chụp trong game dùng `?px=0.35`. Trên máy có GPU thì không bị. Chưa kiểm cảm giác điều khiển/camera ở 60 FPS thật.
- Tham số debug: `?auto=<loài>&walk=1&sprint=1&fly=1&yaw=&zoom=&px=&cam=npc|bridge|bridgeside`, và `window.__game` (đọc trạng thái từ headless).
- Test mới: flight.test.js (6 test). Tổng 54/54.

## Cập nhật: xác (tha/thối rữa) và khủng long NPC
- **Cấu hình**: `server/game.config.js` (có chú thích tiếng Việt từng tham số). Sửa rồi khởi động lại server; có thể ghi đè tạm bằng `ISLE_CONFIG='{"predation":{"huntPlayers":1}}'`. `ISLE_DEBUG=1` in thống kê toàn bản đồ mỗi 10 giây (trạng thái AI, sự kiện cắn/chết...).
- **Xác** (`server/game/carcasses.js`): mọi sinh vật chết (con mồi nhỏ, khủng long NPC, người chơi) đều để lại xác. Tươi `freshSeconds` (đủ dinh dưỡng) rồi thối `rotSeconds` (dinh dưỡng giảm, dễ ngộ độc: mất máu dần) rồi biến mất; xác to tồn tại lâu hơn. Lượng thịt = 0.08 x kích thước^2 (T-rex trưởng thành ~11). **G** ngậm (xác nhỏ <= 40% thân mình, gần như không chậm) hoặc kéo phía sau (xác nặng <= 1.2 lần mình, chậm theo độ nặng); bấm G lần nữa để thả; đánh nhau thì buông xác đang kéo; không cất cánh khi đang kéo xác nặng (xác nhỏ thì bay được). Client: xác nằm bẹp, đổi màu xanh xám, xẹp và lún dần khi thối, nhỏ lại khi bị ăn.
- **Khủng long NPC** (`server/game/bots.js`): "người chơi" do AI điều khiển, dùng đúng vật lý/thể lực/tấn công/ăn uống/bay của người chơi (nên client không cần sửa). 22 con mặc định (T-rex 2, Utahraptor 5, Triceratops 4, Dryosaurus 8, Pteranodon 3). Hành vi: lang thang, uống nước khi khát, gặm cây (ăn cỏ) / ăn xác hoặc săn (ăn thịt) khi đói, chạy trốn thú săn mồi lớn hơn, chống trả khi bị dồn/bị đánh, Utahraptor săn theo đàn, gầm trước khi săn. Săn con mồi nhỏ, khủng long NPC khác và người chơi theo `predation.*`. Mức tiến hoá tối đa `npcDinos.maxStage`, tốc độ lớn `growthSpeedMultiplier`, giai đoạn xuất hiện `spawnStage`.
- **Tìm đường**: NPC đi bộ nhận biết đảo (`islandAt` trong shared/world.js) và chỉ đi qua cầu giữa hai đảo lớn; mục tiêu ở đảo khác không có cầu thì bị bỏ qua (loài bay thì bay thẳng). Lỗi đã phát hiện nhờ thử thật: ban đầu NPC đi thẳng nên không bao giờ tới được mục tiêu ở đảo khác.
- Kiểm chứng: 93/93 test (thêm carcasses 10, bots 29). Chạy thật: 22 NPC sống 3 phút, hạ 13 con mồi, đánh nhau 15 đòn, 2 con chết để lại xác, con mới tự xuất hiện lại. Cấu hình `huntPlayers=1`: T-rex NPC săn và hạ người chơi đứng yên (113 s, `killed by Tyrannosaurus (NPC)`). Tha xác: xác bám sát người tha (<= 1.5 m) khi đi 21 m. Thối rữa: độ thối 0 -> 1 rồi xác biến mất đúng hạn.
- Hạn chế: NPC không có tìm đường tránh vật cản (chỉ đi thẳng + qua cầu, có phát hiện kẹt và đổi hướng); đòn đánh của NPC trượt khá nhiều; Pteranodon NPC cất/hạ cánh hơi thường xuyên; chưa cân bằng độ khó trong chơi dài; chưa có tên hiển thị trên đầu NPC; thể xác NPC chưa có thông tin "ai đã giết" cho người chơi ngoài thông báo khi chết.

## Cập nhật: chọn màu khủng long + âm thanh gầm thật
- **Chọn màu** (menu): màu thân + điểm nhấn, bảng 12 màu mẫu, hộp chọn màu tự do, mặc định/ngẫu nhiên, xem trước 3D xoay, nhớ lựa chọn (localStorage). Màu đi qua `JOIN.colors` -> server kiểm tra `#rrggbb` -> `PlayerState.colors` -> client tô riêng từng con (render/colorize.js nhân bản vật liệu nên không ảnh hưởng con khác). Xác khủng long giữ màu. Màng cánh Pteranodon chưa đổi màu.
- **Âm thanh thật**: người dùng tải về E:\GITHUB\Sounds (gói "80 CC0 creature SFX", monster_roar.wav, t-rex_calls.mp3; theo trang nguồn là CC0 nhưng Claude không tự xác nhận được vì OpenGameArt chặn công cụ tải tự động, 403). Phân tích phổ từng file bằng FFT trong trình duyệt để chọn: gầm ăn thịt (12 mẫu: monster_04/07, roar_02, monster_roar_deep.wav, 3 đoạn cắt từ t-rex_calls.mp3...), ăn cỏ (9), Pteranodon (4), kêu đau khủng long (3). `client/public/sounds/manifest.json` hỗ trợ cắt đoạn (`start`/`end`) và chọn theo cỡ thân (`minSize`/`maxSize`); cao độ đổi theo cỡ, trộn thêm lớp trầm cho con to. Không có file thì tự dùng âm tổng hợp.
- Lỗi tìm ra khi kiểm thử: đường dẫn nạp âm thanh tính tương đối theo trang đang mở (sai ở trang con) -> dùng BASE_URL. Test fail khi người dùng tự chỉnh game.config.js -> test dùng cấu hình gốc cố định (server/game/test-baseline.config.js).
- Chưa kiểm được bằng tai: âm sắc các file có hợp khủng long không, độ to nhỏ tương quan. Gợi ý: nghe thử bằng phím R trong game, rồi chỉnh manifest.json (bỏ file không hợp, đổi minSize/maxSize).

## Kiểm chứng (lần cuối)
- `npx vitest run`: 38/38 pass (14 survival, 14 physics, 10 NPC/quay thân). `vite build` OK.
- Integration thật (server + client headless Edge): T-rex con hạ chuột bằng 1 nhát (3.5 s), xác hiện trạng thái chết, ăn xong thì xác biến mất. 18 client đi 20 giây: không xuyên cây/đá.
- Ảnh chụp in-game: Triceratops chiếm ~35% chiều cao màn hình, cây/đá mới đa dạng, thỏ hiển thị đúng ngoài bãi cát.

## Thiết kế chính
- Thế giới dùng chung (shared/world.js): `plants` (pine, broadleaf, palm, dead, fern, bush; 4200) và `rocks` (boulder, rock, slab, spire, pebbles; 900). Vật chắn đường là r > 0: bụi, dương xỉ, sỏi thì không chắn.
- Chuyển động: thân quay dần về hướng muốn đi (con to quay chậm, chạy nhanh quay chậm hơn), đi theo hướng mặt, quẹo gấp thì chậm lại, S = lùi chậm. Client nghiêng người vào trong khi quẹo.
- Camera: khoảng cách = (chiều dài thân x 1.15 + 0.9) x zoom (cuộn chuột 0.5..2.5), nên nhân vật luôn chiếm cỡ tương đương trên màn hình khi lớn lên.
- NPC: lang thang quanh nơi sinh, chạy trốn người chơi (đứng yên thì dễ lại gần hơn, chạy thì bị phát hiện xa; đang ngủ thì không sợ), chim bay lên, bị giết thì thành xác 90 giây, hồi sinh con mới sau 20 giây.
- Chiến đấu cơ bản: chuột trái hoặc F (nón trước 120 độ, sát thương theo giai đoạn lớn, tốn thể lực, hồi chiêu); E để uống, ăn xác (loài ăn thịt) hoặc gặm cỏ (loài ăn cỏ).

## Hạn chế / việc còn lại
- Con mồi nhỏ chạy nhanh hơn khủng long con: săn bằng cách rình lại gần (đang đứng yên thì NPC sợ ít hơn). Cần cân bằng sau khi chơi thử.
- Chuột rất nhỏ (14 cm) nên khó thấy; lá cọ nhìn xa hơi mỏng; cánh chim gấp hơi giống một khối tròn; chân Triceratops hơi tròn.
- Chưa có dự đoán phía client (client prediction); đã nội suy hiển thị.
- Cây con nhỏ có thể che camera khi nhân vật nhỏ sát đất (bụi/dương xỉ không chặn camera).
- Chưa có ngày đêm, bệnh, bầy đàn, chat, âm thanh.
- Tham số debug trong client/src/main.js: ?auto=<loài>&walk=1&sprint=1&yaw=<rad>&zoom=<x>&cam=npc (có thể xoá khi phát hành).
