# T05 – Client: mô hình các con mồi NPC (gà, thỏ, chuột, chim)

## Mục tiêu
Dựng 4 con vật nhỏ bằng primitive Three.js (low-poly cách điệu, không dùng asset ngoài), có animation procedural. Làm tương tự `client/src/render/dino.js` (hãy đọc file đó để theo cùng phong cách và cách tổ chức: vật liệu cache, pivot, damping chuyển trạng thái).

## File được phép
- TẠO `client/src/render/animals.js` và `client/src/render/animals-preview.html`. KHÔNG sửa file khác (Claude sẽ ghép vào `main.js`).

## Giao diện bắt buộc
```js
export function createAnimal(kind)   // kind: 'chicken' | 'rabbit' | 'mouse' | 'bird'
// -> { group: THREE.Group, update(dt, anim, speed01), dispose() }
//   group: gốc ở chân (y=0 là mặt đất), mũi hướng trục -Z, chiều dài mũi->đuôi ~ NPC_KINDS[kind].bodyLength (từ '@isle/shared', file shared/npcs.js).
//   anim: 'idle' | 'walk' | 'run' | 'fly' | 'dead'; speed01: 0..1 tốc độ so với tốc độ chạy tối đa.
//   Chú ý: người gọi tự đặt group.position.y (độ cao nền/bay) mỗi khung hình; bạn chỉ chuyển động BÊN TRONG group (ví dụ nhún nhảy của thỏ là offset của nhóm con bên trong).
```

## Hình dáng và hành vi
- **chicken** (gà): thân tròn trắng/nâu, cổ ngắn, mào đỏ + yếm, mỏ vàng, 2 chân mảnh vàng, đuôi cong, cánh gấp. idle: mổ đất (gật đầu xuống nhịp), đi lại: bước chân gật đầu theo nhịp; run: chạy nhanh vỗ cánh hờ; dead: nằm nghiêng, chân co.
- **rabbit** (thỏ): thân bầu, đầu nhỏ, HAI TAI DÀI, đuôi bông tròn trắng, chân sau to. idle: mũi giật, tai vểnh/xoay; walk: bước nhỏ; run: NHẢY (cả thân vòng cung lên xuống, chân sau đạp, tai ép ra sau); dead: nằm nghiêng.
- **mouse** (chuột): rất nhỏ, thân thon, tai tròn to, đuôi dài mảnh vẫy, ria mép. idle: ngửi + rung nhẹ; walk/run: bước nhanh nhỏ, đuôi vẫy; dead: ngửa bụng, chân co.
- **bird** (chim): thân thon nhỏ, đầu tròn, mỏ nhọn, cánh (gấp/mở được), đuôi xoè. Màu nổi (xanh/ đỏ/ vàng, một tông chính + bụng sáng). idle: nghiêng đầu, nhảy nhẹ; walk/run: nhún nhảy trên 2 chân; fly: cánh vỗ đập mạnh (biên độ lớn, lên xuống nhanh), thân hơi chúi, chân co gọn; dead: nằm nghiêng, cánh xoè.
- Chuyển trạng thái mượt (lerp/damping), không giật. Nhịp chân/ vỗ cánh phụ thuộc `speed01` và `dt`.
- Mỗi con < 30 mesh; dùng chung vật liệu/geometry nếu tiện; `dispose()` giải phóng phần không dùng chung.

## Cách tự kiểm tra bằng mắt (BẮT BUỘC làm)
1. Viết `animals-preview.html` (Vite): 4 con cạnh nhau, phóng to đủ nhìn (scale xem trước ~ x6 so với kích thước thật hoặc camera sát), có nút đổi anim (idle/walk/run/fly/dead), OrbitControls (`three/examples/jsm/controls/OrbitControls.js`), nền phẳng + ánh sáng như game.
2. Bật Vite: trong `client` chạy `npx vite --port 5202` (chạy nền, nhớ PID để tắt đúng tiến trình này khi xong; KHÔNG dùng taskkill/Stop-Process cho mọi node).
3. Chụp ảnh: `NODE_PATH=e:/GITHUB/TheIsle/node_modules node C:/Users/Hieu/AppData/Local/Temp/claude/0152f559f49d19bb/948853d6-91a8-4b4a-909c-eb413f35c327/scratchpad/shot.cjs "http://[::1]:5202/src/render/animals-preview.html" C:/Users/Hieu/AppData/Local/Temp/shots/animals.png 6000` rồi mở PNG bằng công cụ Read để xem. Chỉnh tới khi nhận ra được từng con. Có thể thêm tham số URL (vd `?anim=run`) vào trang preview để chụp từng trạng thái.
4. `npx vite build` trong `client` thành công.

## Nghiệm thu
- Ảnh cho thấy gà, thỏ, chuột, chim nhận ra được ngay từ bên hông; vài trạng thái (idle/run/fly/dead) khác nhau rõ.
- Không NaN trong update của cả 5 anim x 4 loài; không lỗi console.
- Ghi mục `## Kết quả` trung thực cuối phiếu (đã làm, đã chạy gì, thấy gì trong ảnh, còn dang dở).

## Kết quả
- Tạo `client/src/render/animals.js` (`createAnimal(kind)` -> `{group, update(dt, anim, speed01), dispose()}`, 4 loài, 15-20 mesh/con, geometry + vật liệu dùng chung, chuyển trạng thái bằng damping, root co giãn về `NPC_KINDS[kind].bodyLength`) và `animals-preview.html` (4 con phóng to ~3.2 đơn vị, nút anim, OrbitControls, tham số `?anim=&speed=&t=&cam=front|top`; `t` mô phỏng trước rồi đứng hình để chụp).
- Đã chạy: vite port 5202 + shot.cjs chụp idle/walk/run/fly/dead và góc trước cho chim bay, xem bằng Read: nhận ra rõ gà (mào, yếm, đuôi), thỏ (tai dài, đuôi bông, chân sau to), chuột (tai tròn, đuôi dài, ria), chim (xanh, bụng sáng, mỏ cam). Run thỏ nhảy vòng cung/tai ép sau; fly chim vỗ cánh biên độ lớn, chân co; dead nằm nghiêng (chuột ngửa bụng). Không lỗi console. Script node chạy 8400 lần update (4 loài x 5 anim + anim lạ): 0 NaN. `npx vite build` thành công.
- Chưa ưng: chuột chết ngửa nên chân co nhỏ khó thấy; cánh chim gấp là một khối xanh hơi tròn; chân chim/gà đi bộ chỉ là nhịp đơn giản (chim nhún 2 chân đồng bộ). Chưa kiểm tra ở kích thước thật trong game (mouse rất nhỏ). Chưa có đề xuất thay đổi shared.
