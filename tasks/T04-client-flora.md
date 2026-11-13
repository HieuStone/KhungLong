# T04 – Client: cây cối và đá đa dạng, thực tế hơn

## Mục tiêu
Thay cây hình nón và đá khối đơn điệu hiện tại bằng thực vật và đá đa dạng, nhìn thật hơn (vẫn low-poly cách điệu, không dùng asset ngoài). Dữ liệu vị trí/loại đã có sẵn trong `getWorld()` (xem hợp đồng ở đầu `shared/world.js`: `plants[]` và `rocks[]`). KHÔNG sinh vị trí mới: chỉ vẽ đúng dữ liệu đó (server dùng cùng dữ liệu để tính va chạm).

## File được phép
- TẠO `client/src/render/flora.js` và `client/src/render/flora-preview.html`
- SỬA `client/src/render/terrain.js` CHỈ để XOÁ phần vẽ cây/đá và các import không còn dùng (terrain.js chỉ còn mặt đất + nước).
- KHÔNG sửa `main.js`, `shared/`, `server/` (Claude sẽ gọi `createFlora(scene)` từ main.js).

## Giao diện bắt buộc
```js
export function createFlora(scene)  // -> { update(timeSeconds) }  (update tạo gió đung đưa nhẹ; có thể là no-op nếu bạn bỏ qua phần gió)
```
Đọc dữ liệu bằng `import { getWorld } from '@isle/shared'` (`plants` và `rocks`).

## Cây (6 loại, mỗi loại geometry gộp 1 lần + 1 `InstancedMesh`)
Dùng `mergeGeometries` từ `three/examples/jsm/utils/BufferGeometryUtils.js`, tô màu bằng vertex colors (thân nâu, tán xanh...), `MeshLambertMaterial({ vertexColors: true })` (+ `flatShading` nếu hợp). Gốc geometry ở y=0 (chân cây), cao 1 đơn vị "chuẩn" của loại đó: chiều cao thực = `plant.h` => scale đều theo `plant.scale`.
- **pine** (thông): thân thon, 5-7 tầng cành/nón chồng nhau nhỏ dần, hơi lệch/không đối xứng hoàn hảo, xanh đậm.
- **broadleaf** (lá rộng): thân có 2-3 nhánh lớn, tán gồm 5-8 khối cầu (Icosahedron detail 1, đỉnh hơi xô lệch bằng noise xác định) chồng nhau, hai tông xanh.
- **palm** (cọ): thân cong nhẹ có đốt vằn, ngọn có 8-12 lá dài rủ cong xuống (dùng hình dẹp/cone kéo dài uốn cong), có chùm quả.
- **dead** (cây chết): thân xám nâu, nhiều cành trơ trụi chia nhánh, không lá.
- **fern** (dương xỉ/ tuế): thân thấp, 8-14 lá dài vòng cung toả ra, xanh tươi (thực vật cổ đại, hợp thời khủng long).
- **bush** (bụi): 3-6 khối cầu nhỏ lệch nhau, xanh/ vàng lá lốm đốm.
- Đa dạng mỗi cá thể: `setColorAt` đổi sắc độ nhẹ (±10% sáng/ ngả vàng-xanh ngẫu nhiên xác định theo vị trí, KHÔNG dùng Math.random vì phải ổn định); xoay Y theo `plant.rot`; co giãn ngang hơi khác dọc (±10% xác định theo vị trí).
- (Tuỳ chọn, ưu tiên thấp) gió: dùng `onBeforeCompile` thêm uniform thời gian, đung đưa đỉnh theo độ cao (tán/lá lay mạnh hơn thân). `update(t)` cập nhật uniform.

## Đá (5 loại x 4 biến thể hình dạng theo `rock.seed` 0..3)
Sinh geometry unit từ `IcosahedronGeometry`/`BoxGeometry` chia nhỏ rồi dịch đỉnh bằng hàm noise xác định (không Math.random), `flatShading: true`. Gốc ở đáy (y=0), bán kính ngang 1, cao 1 => scale theo (`w`, `hgt`, `w`).
- **boulder**: tảng lớn tròn lốm đốm, bề mặt gồ ghề.
- **rock**: đá vừa góc cạnh hơn.
- **slab**: phiến dẹt rộng, mép lởm chởm.
- **spire**: mũi đá nhọn cao, thon và có mặt phẳng.
- **pebbles**: cụm 3-6 viên sỏi nhỏ gộp trong 1 geometry.
- Màu: xám/ nâu/ cát nhạt, đáy tối hơn, có rêu xanh nhạt phủ mặt trên một số tảng (vertex color theo pháp tuyến hướng lên + noise). Biến thiên sắc độ theo từng cá thể. Chìm nhẹ xuống đất (~10-15% chiều cao). Áp `rotX` (nghiêng) và `rotY`.

## Hiệu năng
- Tổng draw call của flora < 45. Không tạo từng Mesh riêng lẻ cho mỗi cây/đá. Tạo xong toàn bộ trong < 1 giây trên máy thường.

## Cách tự kiểm tra bằng mắt (BẮT BUỘC làm)
1. Viết `flora-preview.html` (Vite) hiển thị lưới mỗi loại cây và mỗi loại/biến thể đá đứng cạnh nhau trên nền phẳng, có OrbitControls (`three/examples/jsm/controls/OrbitControls.js`), ánh sáng như game (HemisphereLight + DirectionalLight).
2. Bật Vite: trong `client` chạy `npx vite --port 5201` (chạy nền, ghi nhớ PID để tắt đúng tiến trình đó khi xong; KHÔNG dùng taskkill/Stop-Process cho mọi node).
3. Chụp ảnh: `NODE_PATH=e:/GITHUB/TheIsle/node_modules node C:/Users/Hieu/AppData/Local/Temp/claude/0152f559f49d19bb/948853d6-91a8-4b4a-909c-eb413f35c327/scratchpad/shot.cjs "http://[::1]:5201/src/render/flora-preview.html" C:/Users/Hieu/AppData/Local/Temp/shots/flora.png 6000` rồi dùng công cụ Read mở file PNG để xem. Điều chỉnh tới khi từng loại cây/đá nhận ra được và đẹp. Có thể chụp thêm trong game thật: cần server (`node server/index.js`, cổng 8080, chạy nền) rồi URL `http://[::1]:5201/?auto=tyrannosaurus&walk=1&yaw=0.8` (cũng tắt đúng tiến trình sau khi xong).
4. `npx vite build` trong `client` thành công.

## Nghiệm thu
- Ảnh preview cho thấy 6 loại cây khác biệt rõ và 5 loại đá có hình dạng/kích thước đa dạng, không còn "hình nón" đơn điệu.
- Không lỗi console; build OK; terrain.js chỉ còn đất + nước.
- Ghi mục `## Kết quả` trung thực cuối phiếu (đã làm, đã chạy gì, thấy gì trong ảnh, còn dang dở).

## Kết quả
- Tạo `client/src/render/flora.js` (export `createFlora(scene)` -> `{ update(t) }`, thêm `createFloraFrom(scene, plants, rocks)` dùng cho preview) và `flora-preview.html` (`?v=trees|small|rocks|world`). `terrain.js` đã xoá phần cây/đá (chỉ còn đất + nước; code cũ dùng `world.trees`/`p.s` đã lỗi thời).
- 6 loại cây dựng bằng tube/nón/lá uốn/cầu xô noise + vertex color, gió bằng onBeforeCompile (đung đưa theo độ cao, pha theo vị trí); 5 loại đá x 4 biến thể (20 InstancedMesh, có rêu một số biến thể, đáy tối hơn). Tổng 26 draw call (6 cây + 20 đá). Màu/ xoay/ co giãn từng cá thể xác định theo hash vị trí (không Math.random).
- Đã chạy: vite dev cổng 5201 + chụp 4 view (trees/small/rocks/world) qua shot.cjs, xem ảnh, chỉnh lá cọ và đỉnh spire; không lỗi console; `npx vite build` OK. Dựng flora ~0.2-0.9s (số 903ms trong view world gồm cả getWorld + terrain).
- Chưa ưng/ dang dở: ở xa lá cọ khá mỏng; pebbles rất nhỏ khi w~0.3-0.8 (đúng dữ liệu); chưa thử trong game thật với server (main.js chưa gọi createFlora); gió chỉ kiểm tra tĩnh qua ảnh, chưa xem chuyển động.
