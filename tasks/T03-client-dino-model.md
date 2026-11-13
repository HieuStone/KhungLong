# T03 – Client: mô hình khủng long procedural (KHÔNG dùng hộp vuông)

## Mục tiêu
Dựng khủng long 3D cách điệu (low-poly) bằng primitive Three.js, mỗi loài một hình dáng riêng, có animation đi/chạy/tấn công/ngủ. Không dùng asset ngoài.

## File được phép
- TẠO `client/src/render/dino.js`. KHÔNG sửa file khác (Claude sẽ tự ghép vào `main.js`).

## Giao diện bắt buộc
```js
import * as THREE from 'three';
export function createDino(speciesId)
// -> { group: THREE.Group, update(dt, anim, speed01), dispose() }
//   group: gốc tại chân (y=0 là mặt đất), hướng mũi về trục -Z (khớp server: yaw=0 đi về -Z).
//   Đơn vị mét, kích thước theo SPECIES[speciesId].bodyLength (từ '@isle/shared') = chiều dài mũi->đuôi.
//   anim: 'idle'|'walk'|'run'|'attack'|'sleep'|'dead'; speed01: 0..1 (tốc độ so với tối đa) để chỉnh nhịp chân.
```

## Hình dáng (low-poly, cách điệu, dùng SphereGeometry/CapsuleGeometry/ConeGeometry/CylinderGeometry kéo giãn, flatShading)
Mọi loài: thân hình elip (sphere scale kéo dài), cổ, đầu (hộp sọ + hàm dưới riêng để có thể há miệng), mắt, đuôi gồm 6-8 đốt thuôn nhỏ dần nối theo chuỗi (để vẫy được), chân gồm đùi + cẳng + bàn (2 khớp), có màu hơi khác nhau giữa lưng và bụng (2 vật liệu, bụng sáng hơn).
- **tyrannosaurus** (2 chân): đầu RẤT to, hàm đầy răng (vài cone trắng nhỏ), tay cực nhỏ 2 ngón, đùi to, thân nghiêng ~15° (đầu cao hơn hông), đuôi dài cân bằng. Màu nâu xanh rêu.
- **utahraptor** (2 chân): thân thon, đầu hẹp, đuôi dài thẳng cứng, tay dài có vuốt, móng liềm lớn ở chân sau, thêm lông vũ đơn giản (vài plane/cone nhỏ ở tay & đuôi). Màu cam/nâu sọc tối.
- **triceratops** (4 chân): thân đồ sộ, chân cột trụ, đầu thấp với mỏ vẹt, mề đay (frill) lớn hình đĩa phía sau đầu, 3 sừng (2 dài trên mắt, 1 ngắn ở mũi). Màu xám xanh.
- **dryosaurus** (2 chân): nhỏ, cổ dài, đầu nhỏ, chân dài mảnh, đuôi cứng. Màu be/vàng đất.

## Animation (procedural, trong `update`)
- Mỗi chân là chuỗi pivot (hông -> gối -> cổ chân); đi/chạy dùng sin lệch pha giữa các chân; biên độ & tần số theo `speed01` và anim (run nhanh hơn).
- Thân nhấp nhô nhẹ; đầu đối pha; đuôi vẫy theo sóng sin dọc theo các đốt (đốt càng xa càng trễ pha).
- `idle`: thở (thân phồng nhẹ), đầu quay chậm. `attack`: đầu lao tới + hàm mở/đóng nhanh khoảng 0.4s rồi quay về. `sleep`: hạ thân sát đất, đầu gục. `dead`: nằm nghiêng 90° quanh trục Z, đứng yên.
- Chuyển trạng thái mượt (lerp), không giật.

## Hiệu năng
- Mỗi con < 60 mesh; dùng chung geometry/material giữa các instance nếu tiện (cache theo loài). `dispose()` giải phóng geometry/material không dùng chung.

## Nghiệm thu
- Viết kèm `client/src/render/dino-preview.html` (trang demo riêng, tự import `./dino.js` qua Vite): hiển thị 4 loài cạnh nhau, nút bấm đổi anim (idle/walk/run/attack/sleep/dead), OrbitControls từ `three/examples/jsm/controls/OrbitControls.js`. Mở bằng `npm run dev -w client` rồi vào `/src/render/dino-preview.html`.
- `npx vite build` ở thư mục `client` thành công; không lỗi console khi mở trang preview.
- Hình dáng nhìn từ bên hông nhận ra được là khủng long đúng loài (không phải khối hộp).

## Kết quả
- Đã tạo `client/src/render/dino.js` (createDino: 4 loài riêng hình dáng, thân/bụng 2 màu, cổ/đuôi chuỗi đốt, chân 3 khớp, tay, hàm há được; triceratops có mề đay + 3 sừng 4 chân; utahraptor có móng liềm, lông vũ, sọc; 29-54 mesh/con) và `dino-preview.html` (lưới 4 loài, nút anim, slider speed, OrbitControls).
- Chạy `npx vite build` ở client: thành công (lưu ý dino.js chưa được main.js import nên build không bundle nó). Chạy thêm script node tạm (đã xoá) gọi createDino + update 6 anim: không NaN, chiều dài mũi->đuôi đúng bodyLength, chân chạm y=0 ở idle/attack.
- CHƯA xem bằng mắt trên trình duyệt (không có GPU/trình duyệt trong phiên này): tỉ lệ, góc sleep/dead chỉ kiểm bằng số; sleep/dead có thể hơi lún đất ~0.3-0.6m (đã nâng bớt), cần tinh chỉnh khi nhìn thật.
