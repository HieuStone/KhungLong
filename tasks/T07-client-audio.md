# T07 – Client: âm thanh tổng hợp (Web Audio, KHÔNG dùng file âm thanh)

## Mục tiêu
Tạo bộ âm thanh sống động cho game khủng long, hoàn toàn tổng hợp bằng Web Audio API (oscillator, noise, bộ lọc, envelope, LFO): không tải/không nhúng file mp3/wav. Có âm thanh định vị theo không gian (to nhỏ và trái/phải theo vị trí so với người nghe) và âm thanh môi trường liên tục.

## File được phép
- TẠO `client/src/audio.js` và `client/src/audio-preview.html`. KHÔNG sửa file khác (Claude sẽ nối vào main.js).

## Giao diện bắt buộc
```js
export function createAudio()   // -> audio
audio.resume()                  // gọi trong một cử chỉ người dùng (click) để mở AudioContext (chính sách autoplay)
audio.setMasterVolume(v)        // 0..1
audio.toggleMute()              // trả về true nếu đang tắt tiếng
audio.setListener({ x, y, z }, yaw)   // gọi mỗi khung hình: vị trí người nghe + hướng nhìn (yaw rad, 0 nhìn về -Z, vector trước = (-sin yaw, -cos yaw))
audio.play(name, opts)          // phát 1 lần, opts: { x, y, z, size = 1, intensity = 1, kind } ; có x,z => định vị 3D, không có => phát thẳng (không định vị)
audio.update(dt, env)           // gọi mỗi khung hình để chạy lớp âm thanh nền; env: { waterProx 0..1, forest 0..1, wind 0..1, altitude (m), speed 0..1, underwater? false }
audio.dispose()
```
Mọi hàm phải an toàn khi AudioContext chưa được resume (bỏ qua êm, không ném lỗi) và khi gọi dồn dập (giới hạn số âm thanh đồng thời ~24, bỏ bớt âm xa/nhỏ nhất).

## Danh sách âm thanh cần có (`play(name, opts)`)
- `step`: bước chân khủng long. `size` = chiều dài thân (m): con to thì trầm, nặng, kèm rung nền (sub bass), con nhỏ thì nhẹ, lách tách. `opts.surface`: 'grass' (mặc định), 'sand', 'rock', 'water' (lội nước: bì bõm), 'wood' (cầu gỗ: cộp rỗng). `intensity` 0..1 theo tốc độ.
- `bite`: cắn trúng (tiếng "chát" + trầm). `miss`: cắn vào không khí (tiếng gió hàm đóng).
- `chew`: nhai/xé thịt (ướt, lép nhép, ngắn lặp). `crunch`: gặm cây (giòn). `gulp`: nuốt nước (ục). `slurp`: uống nước (chóp chép).
- `roar`: gầm. `size` quyết định: T-rex to gầm trầm, dài, có rền + méo; con nhỏ rít cao hơn, ngắn. Có biến thể theo `kind`: 'carnivore' (gầm gừ) / 'herbivore' (rống, kêu to) / 'pterosaur' (kêu rít chói).
- `flap`: vỗ cánh (vút gió, size lớn thì sâu hơn), `wing_whoosh` biến thể cánh to.
- `hurt`: kêu đau (theo `kind`: 'dino', 'chicken', 'rabbit', 'mouse', 'bird'). `die`: tiếng ngã/chết (dino: thịch nặng; con vật nhỏ: kêu ngắn rồi tắt).
- `splash`: bì bõm/ té nước. `thud`: va nặng (ngã, hạ cánh) theo `size`.
- Tiếng con mồi: `cluck` (gà), `squeak` (chuột), `peep` (chim), `rabbit_thump` (thỏ thình thịch).
- `ui_click`, `notice` (chuông nhẹ cho thông báo), `eat_done`/`level_up` (âm hiệu khi lên giai đoạn lớn).

## Âm thanh nền (chạy trong `update`)
- **Gió**: nhiễu lọc bandpass biến thiên chậm (LFO), to dần theo `env.wind` và `env.altitude`.
- **Sóng biển**: nhiễu lọc low-pass, nhịp dâng rút ~6-9 s, to theo `env.waterProx`.
- **Rừng**: lá xào xạc nhẹ + chim hót/kêu xa (ngẫu nhiên, vài âm sắc khác nhau, cao độ trượt) + côn trùng rả rích, to theo `env.forest`; thỉnh thoảng có tiếng xa của khủng long gầm vọng (rất nhỏ, hiếm).
- Mọi lớp nền phải có fade mượt (không bật/tắt đột ngột), tổng âm lượng nền vừa phải, không át âm thanh sự kiện.

## Chất lượng
- Mỗi âm thanh phải có envelope (attack/decay) để không bị "click/pop", biên độ không clip (dùng DynamicsCompressor/limiter cuối chuỗi), không NaN, giải phóng node sau khi xong (không rò rỉ).
- Biến thiên ngẫu nhiên nhỏ mỗi lần phát (cao độ, độ dài) để không lặp máy móc.
- Định vị: PannerNode (HRTF hoặc equalpower) hoặc tự tính pan/gain theo khoảng cách (suy giảm ~1/(1+d/refDist), cắt ở ~150 m); lọc low-pass nhẹ theo khoảng cách để âm xa bị "đục".

## Cách tự kiểm tra (BẮT BUỘC làm, bạn không nghe được nên phải đo)
1. Viết `audio-preview.html` (Vite): lưới nút bấm cho TỪNG `name` (và vài biến thể size/kind/surface), thanh chỉnh env (waterProx, forest, wind, altitude), nút Resume/Mute. Đây là trang cho người dùng thử nghe bằng tai.
2. Kiểm tra tự động bằng trình duyệt headless qua CDP (có thể viết script Node riêng ở thư mục scratchpad, dựa theo `C:/Users/Hieu/AppData/Local/Temp/claude/0152f559f49d19bb/948853d6-91a8-4b4a-909c-eb413f35c327/scratchpad/shot.cjs`, dùng `Runtime.evaluate` thay vì chụp ảnh): trong trang, dựng các âm thanh bằng `OfflineAudioContext` (hãy thiết kế `audio.js` để phần dựng đồ thị âm thanh nhận một AudioContext bất kỳ — thật hoặc offline — nhờ đó đo được), render vài giây rồi tính cho từng âm: peak, RMS, có NaN không, có im lặng không (RMS > ngưỡng), có clip không (|peak| <= 1), độ dài thực tế, và phổ năng lượng thô (tỉ lệ năng lượng dưới 200 Hz / 200-2000 Hz / trên 2000 Hz) để chắc "trầm" thật sự trầm với size lớn và "rít" thật sự cao. In bảng kết quả.
3. Bật Vite: trong `client` chạy `npx vite --port 5204` (chạy nền, nhớ PID để tắt đúng tiến trình đó khi xong; KHÔNG taskkill/Stop-Process hàng loạt node).
4. `npx vite build` trong `client` thành công; không lỗi console khi mở trang preview.

## Nghiệm thu
- Bảng đo cho thấy mọi âm thanh: không NaN, không im lặng, không clip, độ dài hợp lý, phổ đúng ý (T-rex gầm nhiều năng lượng dưới 200 Hz, chim hót phần lớn trên 2 kHz, v.v.).
- Ghi mục `## Kết quả` trung thực cuối phiếu: đã làm gì, bảng đo (tóm tắt), điều bạn không thể kiểm bằng tai và cần người dùng nghe thử, còn dang dở.

## Kết quả
- Đã tạo `client/src/audio.js` (createAudio({ctx?}) — nhận AudioContext thật hoặc OfflineAudioContext để đo; chuỗi cuối master → lowpass (dưới nước) → DynamicsCompressor → soft-clip tanh nên |x| <= 1) và `client/src/audio-preview.html` (44 nút, thanh env, định vị X/Z, Resume/Mute/Master). Đủ danh sách âm: step (5 bề mặt), bite/miss, chew/crunch/gulp/slurp, roar (carnivore/herbivore/pterosaur theo size), flap/wing_whoosh, hurt/die (dino/chicken/rabbit/mouse/bird), splash/thud, cluck/squeak/peep/rabbit_thump, ui_click/notice/eat_done/level_up, thêm `bird_song`. Nền: gió, sóng (chu kỳ 7.5 s), rừng (lá + côn trùng + chim ngẫu nhiên + gầm vọng xa hiếm), fade bằng setTargetAtTime. Định vị: StereoPanner + gain 1/(1+d/ref) + lowpass theo khoảng cách, cắt >150 m (roar to nới thêm). Tối đa 24 giọng, đẩy giọng yếu nhất. Node tự ngắt khi xong. Thêm getter `audio.voiceCount` (để kiểm rò rỉ).
- Đo bằng OfflineAudioContext trong Edge headless qua CDP (script ở scratchpad/audtest/): 46 cấu hình âm + 7 cấu hình nền: không NaN, không im lặng (rms >= 0.002), peak tối đa 0.82 (<1), độ dài 0.04–2.4 s; sau render voiceCount = 0 (không rò). Phổ (% năng lượng <200Hz/200-2k/>2k): step 12m 100/0/0, step 0.5m 39/47/14; roar T-rex 12m 90/10/0 (2.4 s), carnivore 3m 12/88/0, 1m 0/93/7, pterosaur 0/1/99; thud 12m 100/0/0; bird_song, squeak, peep, hurt mouse/bird, crunch 0/0/100; wing_whoosh 94/6/0. Dồn 200 lệnh play: giữ 24 giọng, peak 0.96, không NaN. Định vị: nguồn x=+30 → R 0.0099 vs L 0.0012 (và ngược lại với x=-30, yaw 90° đúng); 10 m rms 0.0095, 100 m 0.0019, >150 m = 0 (im). Gọi mọi hàm trước resume không ném lỗi. Nền: wind=1 rms 0.020 vs wind=0 0.003; waves 0.027; forest 0.014 (88% >2kHz); underwater làm đục và nhỏ đi.
- `npx vite build` trong client thành công; trang preview mở ở Vite port 5204, click 44 nút với AudioContext thật: ctx running, không lỗi console (Vite dev server chỉ tắt đúng PID tự bật).
- KHÔNG kiểm được bằng tai: âm sắc có "giống" khủng long/tự nhiên không, độ cân bằng âm lượng giữa các âm (bước chân vẫn khá nhỏ so với roar: rms ~0.01–0.03 vs 0.06–0.13), độ khó chịu của chim hót/côn trùng lặp lại, độ rõ trái/phải thực tế, cảm giác "to nhỏ" theo khoảng cách. Cần người dùng nghe thử bằng audio-preview.html (http://localhost:5173/src/audio-preview.html khi chạy dev) rồi chỉnh hằng số.
- Dang dở: chưa nối vào main.js (Claude làm); đo nền offline chỉ lên lịch một lần ở t=0 nên lịch chim hót ngẫu nhiên theo thời gian thực chưa được đo dài hạn.
