# T01 – Client: địa hình, nước, cây/đá, bầu trời

## Mục tiêu
Thay mặt phẳng tạm trong `client/src/main.js` bằng thế giới 3D thật, dựa trên `heightAt(x, z)` từ `@isle/shared` (server dùng đúng hàm này nên khủng long sẽ đứng đúng mặt đất).

## File được phép
- TẠO `client/src/render/terrain.js`, `client/src/render/sky.js`
- SỬA `client/src/main.js` CHỈ ở đoạn có chú thích `TODO T01` (xoá mặt phẳng tạm, gọi hàm mới). Không đụng phần mạng/input/camera.

## Yêu cầu
1. `terrain.js` export `createTerrain(scene)`:
   - PlaneGeometry phân giải 200x200 phủ `WORLD_SIZE` x `WORLD_SIZE` (hằng số từ `@isle/shared`), đặt đỉnh y = `heightAt(x, z)`, `computeVertexNormals()`.
   - Màu theo đỉnh (vertex colors): cát gần mực nước (y < 2), cỏ xanh, đá xám ở y > 18. Dùng `MeshLambertMaterial({ vertexColors: true })`.
   - Mặt nước: một plane lớn ở `y = WATER_LEVEL`, trong suốt xanh (opacity ~0.6), `depthWrite: false`.
   - Cây và đá: dùng `THREE.InstancedMesh` (KHÔNG tạo từng Mesh). ~1500 cây (thân cone/cylinder xanh), ~400 đá. Vị trí sinh bằng PRNG xác định có seed (vd mulberry32 seed `WORLD_SEED`) để mọi client giống nhau; chỉ đặt ở nơi y > 1.5 (trên cạn), độ dốc vừa phải.
2. `sky.js` export `createSky(scene)`: đặt `scene.background`, `scene.fog` (màu trùng nền), thêm `DirectionalLight` mặt trời có hướng cố định. (Chu kỳ ngày đêm làm ở phiếu sau.)
3. Hiệu năng: tổng draw call < 15, chạy ≥ 60 FPS trên máy thường.

## Nghiệm thu
- `npm run dev -w client` chạy không lỗi console; mở http://localhost:5173 thấy đảo có núi, biển, cây.
- `npx vite build` trong thư mục `client` chạy thành công.
- Không có lỗi import `@isle/shared`.

## Kết quả
- Đã tạo `client/src/render/terrain.js` (createTerrain: lưới 200x200 theo heightAt, vertex color cát/cỏ/đá, nước trong suốt, 1500 cây + 400 đá bằng InstancedMesh, PRNG mulberry32 seed WORLD_SEED) và `client/src/render/sky.js` (createSky: nền + Fog + DirectionalLight cố định).
- Sửa `client/src/main.js` chỉ trong đoạn TODO T01: thêm 2 dòng import đặt ngay trong đoạn đó, xoá mặt phẳng tạm, gọi createTerrain/createSky. Có thể chuyển 2 dòng import lên đầu file nếu muốn gọn.
- `npx vite build` trong client: thành công (chạy 3 lần, lần cuối 12 module).
- Kiểm tra headless bằng Node: 4 mesh, cây 1500, đá 400, đỉnh địa hình y từ -52.8 đến 26.1, tạo xong trong ~77 ms. `vite` dev server phục vụ 200 cho main.js, terrain.js, sky.js; đã tắt server sau khi kiểm tra.
- Dang dở: chưa mở trình duyệt xem thực tế (chưa xác nhận hình ảnh, FPS), chưa chạy `npm run dev` đầy đủ. Lần thử tắt process node bằng taskkill bị từ chối, nên không dùng cách đó; server dev do mình chạy đã được dừng bằng TaskStop.
