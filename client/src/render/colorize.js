import * as THREE from 'three';

// Màu mặc định của từng loài (khớp với màu trong dino.js / pterosaur.js): thân và điểm nhấn.
// "Điểm nhấn" là các chi tiết như bàn chân, sọc, gờ mày, mề đay Triceratops, mào Pteranodon...
export const DEFAULT_COLORS = {
  tyrannosaurus: { body: '#5b6b3a', accent: '#3c4727' },
  utahraptor: { body: '#c2662b', accent: '#3a2615' },
  triceratops: { body: '#6c7d88', accent: '#8b5a48' },
  dryosaurus: { body: '#b99a5e', accent: '#8a6c38' },
  pteranodon: { body: '#6f8796', accent: '#e0612a' },
};

// Bảng màu thân gợi ý (bấm để chọn nhanh); màu điểm nhấn tự sinh ra từ màu thân nhưng vẫn chỉnh riêng được.
export const BODY_PRESETS = [
  '#5b6b3a', '#c2662b', '#6c7d88', '#b99a5e', '#3f6fa8', '#8e3b3b',
  '#2e2e33', '#e8e2d0', '#7a4fa3', '#d4a72c', '#2f8f6b', '#c46a8f',
];

/** Màu điểm nhấn gợi ý cho một màu thân: tối hơn và hơi đậm hơn. */
export function suggestAccent(bodyHex) {
  const c = new THREE.Color(bodyHex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL((hsl.h + 0.04) % 1, Math.min(1, hsl.s * 1.05), Math.max(0.12, hsl.l * 0.55));
  return '#' + c.getHexString();
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Chuẩn hoá {body, accent}: trả về null nếu không hợp lệ hoặc trùng màu mặc định của loài. */
export function normalizeColors(species, colors) {
  if (!colors || !HEX.test(colors.body) || !HEX.test(colors.accent)) return null;
  const d = DEFAULT_COLORS[species];
  if (d && d.body.toLowerCase() === colors.body.toLowerCase() && d.accent.toLowerCase() === colors.accent.toLowerCase()) return null;
  return { body: colors.body.toLowerCase(), accent: colors.accent.toLowerCase() };
}

/**
 * Tô màu riêng cho MỘT con: nhân bản các vật liệu dùng chung rồi đổi màu, nên không ảnh hưởng con khác.
 * pairs: [{ from: vậtLiệuGốc, color: '#rrggbb' }]. Trả về hàm giải phóng các vật liệu đã nhân bản.
 */
export function recolor(group, pairs) {
  const clones = new Map();
  for (const { from, color } of pairs) {
    if (!from) continue;
    const m = from.clone();
    m.color.set(color);
    clones.set(from, m);
  }
  group.traverse((o) => {
    if (o.isMesh && clones.has(o.material)) o.material = clones.get(o.material);
  });
  return () => { for (const m of clones.values()) m.dispose(); clones.clear(); };
}

/** Bụng sáng hơn màu thân (như bản gốc: bụng nhạt hơn lưng). */
export function bellyOf(bodyHex) {
  return '#' + new THREE.Color(bodyHex).lerp(new THREE.Color(0xffffff), 0.42).getHexString();
}
