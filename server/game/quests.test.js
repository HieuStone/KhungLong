import { describe, it, expect } from 'vitest';
import { QUESTS, SPECIES_IDS } from '@isle/shared';
import { createQuestState, questEvent, questView } from './quests.js';

describe('nhiệm vụ', () => {
  it('mỗi loài có nhiệm vụ riêng, id không trùng', () => {
    const ids = new Set();
    for (const sp of SPECIES_IDS) {
      expect(QUESTS[sp]?.length).toBeGreaterThanOrEqual(3);
      for (const q of QUESTS[sp]) { expect(ids.has(q.id)).toBe(false); ids.add(q.id); }
    }
  });
  it('đếm theo điều kiện, hoàn thành đúng một lần', () => {
    const qs = createQuestState('tyrannosaurus');
    expect(questEvent(qs, 'kill_prey', { kind: 'rabbit' })).toHaveLength(0); // thỏ không tính cho nhiệm vụ lợn rừng
    expect(questEvent(qs, 'kill_prey', { kind: 'boar' })).toHaveLength(0);
    const done = questEvent(qs, 'kill_prey', { kind: 'boar' });
    expect(done.map((q) => q.def.id)).toEqual(['rex_boar']);
    expect(questEvent(qs, 'kill_prey', { kind: 'boar' })).toHaveLength(0); // đã xong thì không trao lại
    expect(questView(qs)[0]).toBe(2);
  });
  it('quãng đường cộng dồn, độ cao lấy giá trị lớn nhất', () => {
    const qs = createQuestState('pteranodon');
    for (let i = 0; i < 100; i++) questEvent(qs, 'move', { dist: 10, sprint: false, fly: true });
    questEvent(qs, 'move', { dist: 500, fly: false }); // đi bộ không tính
    questEvent(qs, 'altitude', { alt: 30 }); questEvent(qs, 'altitude', { alt: 12 });
    const v = questView(qs);
    expect(v[0]).toBe(1000);
    expect(v[1]).toBe(30);
  });
});
