// Tiến độ nhiệm vụ của một người chơi (logic thuần, test được). Định nghĩa nhiệm vụ ở shared/quests.js.
import { questsOf } from '@isle/shared';

/** Trạng thái nhiệm vụ mới cho loài: { list: [{ def, progress, done }], dirty }. */
export function createQuestState(species) {
  return { list: questsOf(species).map((def) => ({ def, progress: 0, done: false })), dirty: true };
}

/**
 * Ghi nhận một sự kiện. Trả về các nhiệm vụ VỪA hoàn thành (để server trao thưởng và thông báo).
 */
export function questEvent(qs, type, data = {}) {
  if (!qs) return [];
  const finished = [];
  for (const q of qs.list) {
    if (q.done || q.def.on !== type) continue;
    if (q.def.when && !q.def.when(data)) continue;
    const amt = q.def.amount ? q.def.amount(data) : 1;
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const before = q.progress;
    q.progress = q.def.mode === 'max' ? Math.max(q.progress, amt) : q.progress + amt;
    if (q.progress >= q.def.goal) { q.progress = q.def.goal; q.done = true; finished.push(q); }
    // chỉ báo client khi phần hiển thị (số nguyên) thay đổi, tránh gửi mỗi tick khi đi bộ
    if (q.done || Math.floor(q.progress) !== Math.floor(before)) qs.dirty = true;
  }
  return finished;
}

/** Dạng gửi cho client: mảng tiến độ theo đúng thứ tự định nghĩa (số nguyên). */
export const questView = (qs) => qs.list.map((q) => Math.floor(q.progress));
