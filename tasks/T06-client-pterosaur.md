# T06 – Client: mô hình khủng long bay (Pteranodon) procedural

## Mục tiêu
Dựng một thằn lằn cánh (Pteranodon) 3D cách điệu low-poly bằng primitive Three.js, có animation procedural. Làm cùng phong cách và cùng kiểu giao diện với `client/src/render/dino.js` (đọc file đó trước: vật liệu cache, pivot/chuỗi đốt, damping chuyển trạng thái, hàm `ell`/`spike`/`chain`... bạn có thể tái dùng ý tưởng nhưng KHÔNG sửa dino.js).

## File được phép
- TẠO `client/src/render/pterosaur.js` và `client/src/render/pterosaur-preview.html`. KHÔNG sửa file khác.

## Giao diện bắt buộc
```js
export function createPterosaur(speciesId = 'pteranodon')
// -> { group: THREE.Group, update(dt, anim, speed01), dispose() }
//   group: gốc ở chân (y=0 là mặt đất khi đang đứng), mũi hướng trục -Z.
//   Chiều dài mũi->đuôi (không tính mào) co về SPECIES.pteranodon.bodyLength (4.5 m, từ '@isle/shared'); sải cánh khi xoè ~ 1.7 x bodyLength.
//   anim: 'idle' | 'walk' | 'run' | 'fly' | 'glide' | 'attack' | 'eat' | 'drink' | 'sleep' | 'dead'
//   speed01: 0..1 (so với tốc độ tối đa) để chỉnh nhịp đập cánh / nhịp chân.
//   Người gọi tự đặt group.position.y (độ cao khi bay) và nghiêng/lượn (banking) cho toàn group; bạn chỉ chuyển động BÊN TRONG.
```

## Hình dáng
- Đầu dài nhọn với MỎ dài không răng và MÀO xương dài hướng ra sau đặc trưng, mắt, túi họng nhỏ; cổ dài thon.
- Thân nhỏ gọn, đuôi ngắn; hai CÁNH là màng da căng giữa ngón tay rất dài và thân (dùng các mảnh phẳng/tam giác ghép thành cánh, có xương cánh: cánh tay -> cẳng tay -> ngón bay dài), màu da cam nhạt/xám + xương nâu; mặt lưng sẫm hơn mặt bụng.
- Hai chân nhỏ yếu, đi bằng chân sau và gập cánh lại (4 chi khi đi: cánh gập chống như tay) hoặc đứng 2 chân với cánh gập sát thân; khi gập, cánh phải gọn, không xuyên xuống đất.
- Màu: thân xám xanh, bụng sáng, mào đỏ cam, mỏ vàng nhạt.

## Animation
- `idle`: đứng, cánh gập, thở nhẹ, đầu/cổ nghiêng nhìn quanh, mào lắc nhẹ.
- `walk`/`run`: bước vụng về nhấp nhô, cánh gập khép; run: cánh hơi dang để giữ thăng bằng, cổ chúi tới.
- `fly`: cánh xoè hết cỡ đập lên xuống mạnh (biên độ lớn, tần số theo speed01: ~1.5-3 Hz), khớp cánh gập nhẹ ở nhịp lên, thân hơi chúi, chân co gọn ra sau, cổ duỗi thẳng, đuôi ổn định.
- `glide`: cánh xoè cố định hơi vồng (dihedral), rung rất nhẹ, không đập; chân co gọn.
- `attack`: giật cổ tới và đớp mỏ (mỏ trên/dưới mở rồi khép nhanh ~0.4 s), nghỉ rồi lặp nếu giữ anim.
- `eat`: cúi đầu xuống đất, mổ nhịp nhanh (mỏ mở/khép), cánh gập. `drink`: cúi đầu thấp, hạ mỏ xuống nhấp nhẹ từng ngụm.
- `sleep`: ngồi xuống, đầu gục vào thân/cánh. `dead`: ngã nghiêng, cánh xoè nằm đất, đứng yên.
- Chuyển trạng thái mượt (lerp/damping), không giật; từ `fly` sang `idle` thì cánh khép dần.

## Giới hạn
- Dưới 70 mesh; dùng chung vật liệu/geometry nếu tiện; `dispose()` giải phóng phần không dùng chung. Không NaN.

## Cách tự kiểm tra bằng mắt (BẮT BUỘC)
1. Viết `pterosaur-preview.html` (Vite): một con Pteranodon lớn giữa màn hình, nút đổi anim (cả 10 anim), thanh speed, OrbitControls (`three/examples/jsm/controls/OrbitControls.js`), cho phép `?anim=fly&t=1.2&cam=front|side|top` để chụp từng trạng thái (t = mô phỏng trước t giây rồi đứng hình).
2. Bật Vite trong `client`: `npx vite --port 5203` (chạy nền, nhớ PID để tắt đúng tiến trình đó khi xong; KHÔNG taskkill/Stop-Process hàng loạt node).
3. Chụp: `NODE_PATH=e:/GITHUB/TheIsle/node_modules node C:/Users/Hieu/AppData/Local/Temp/claude/0152f559f49d19bb/948853d6-91a8-4b4a-909c-eb413f35c327/scratchpad/shot.cjs "http://[::1]:5203/src/render/pterosaur-preview.html?anim=fly&t=1" C:/Users/Hieu/AppData/Local/Temp/shots/ptero_fly.png 6000` rồi mở PNG bằng công cụ Read để xem. Lặp chỉnh tới khi nhìn từ bên hông/phía trước/phía trên nhận ra ngay là Pteranodon, cánh xoè đẹp, các anim khác biệt rõ.
4. `npx vite build` trong `client` thành công; script node chạy `update` cả 10 anim (+ một anim lạ) hàng nghìn lần: 0 NaN.

## Nghiệm thu
- Ảnh cho thấy: đứng (cánh gập), bay (cánh xoè đập), lướt, đớp, cúi uống/ăn nhìn đúng.
- Ghi mục `## Kết quả` trung thực cuối phiếu (đã làm, đã chạy gì, thấy gì, còn dang dở).

## Kết quả
- Đã tạo `client/src/render/pterosaur.js` (`createPterosaur(speciesId)` -> `{group, update, dispose}`, 42 mesh, vật liệu/geometry dùng chung, màng cánh là BufferGeometry cập nhật mỗi frame theo các khớp vai-khuỷu-cổ tay-ngón; mặt lưng sẫm / mặt bụng sáng) và `pterosaur-preview.html` (đủ 10 nút anim, speed, OrbitControls, `?anim=&t=&cam=front|side|top|back&speed=`).
- Đã chạy: vite port 5203 + shot.cjs, xem ảnh idle/walk/run/fly (trước, bên)/glide (bên, trên)/attack/eat/drink/sleep/dead và chỉnh lặp; `npx vite build` (client) thành công; script node gọi `update` 4800 lần trên cả 10 anim + 'bogus' + undefined + NaN dt/speed: 0 NaN. Dev server đã tắt đúng PID.
- Thấy: sải cánh/chiều dài ~1.65-1.7 (đo bằng mắt trên ảnh, không đo số); cánh gập zigzag, ngón bay gập ra sau lưng; bay đập biên độ lớn, cổ duỗi, chân co; ăn/uống mỏ chạm đất.
- Chưa ưng ý: mào hơi to/cứng (nón phẳng); cánh gập còn nhô ngón ra sau quá đuôi và màng gập là mảng tam giác đơn giản; đi bộ chưa chống cánh xuống đất như tay (chỉ gập sát); `sleep` đầu gục sang bên khá cách điệu; `dead` nằm sấp cánh xoè sát đất (không nghiêng 90 độ), chưa kiểm tra kỹ xuyên đất ở mép cánh.
