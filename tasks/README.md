# Quy ước giao việc (Claude giám sát, Gemini thực thi)

- Chỉ sửa/tạo ĐÚNG các file ghi trong mục "File được phép" của phiếu. Không đụng file khác.
- KHÔNG sửa `shared/` (hợp đồng client-server). Cần đổi gì thì ghi vào cuối file phiếu mục "Đề xuất thay đổi shared", Claude sẽ duyệt.
- JavaScript ES modules, không TypeScript, không thêm dependency mới nếu phiếu không cho phép.
- Import dùng `@isle/shared` (vd: `import { SPECIES, heightAt } from '@isle/shared'`).
- Code ngắn gọn, có comment tiếng Việt ở chỗ khó. Không viết file README/tài liệu thừa.
- Làm xong: chạy lệnh test trong phiếu, rồi ghi 3-5 dòng "Kết quả" vào cuối file phiếu (đã làm gì, chạy lệnh gì, còn gì dang dở).
- Claude sẽ review và ghi lỗi vào `REVIEW.md`.
