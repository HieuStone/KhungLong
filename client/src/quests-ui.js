// Bảng nhiệm vụ trên màn hình: danh sách nhiệm vụ của loài đang chơi + tiến độ (server gửi trong snapshot.you.q).
// Phím J (hoặc nút 📜 trên điện thoại) để ẩn/hiện.
import { questsOf } from '@isle/shared';

const CSS = `
#qp { position: fixed; z-index: 5; width: 260px; padding: 10px 12px; border-radius: 10px; background: #0a0f0acc;
  color: #f2efe6; font: 12px sans-serif; line-height: 1.35; box-shadow: 0 2px 10px #0006; pointer-events: none; display: none; }
#qp.on { display: block; }
#qp h3 { margin: 0 0 6px; font-size: 13px; letter-spacing: .3px; color: #e8d39a; display: flex; justify-content: space-between; }
#qp h3 small { color: #bbb; font-weight: normal; }
#qp .q { margin: 7px 0; }
#qp .t { font-weight: bold; display: flex; gap: 6px; align-items: baseline; }
#qp .d { color: #c9c4b6; font-size: 11px; margin: 1px 0 3px 18px; }
#qp .bar { margin-left: 18px; height: 6px; border-radius: 3px; background: #ffffff22; overflow: hidden; }
#qp .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #c9a43a, #f0d070); transition: width .3s; }
#qp .n { margin-left: auto; font-weight: normal; color: #d8d2c0; font-size: 11px; white-space: nowrap; }
#qp .q.done .t { color: #9fdc8a; } #qp .q.done .bar i { background: #6fbf5a; } #qp .q.done .d { text-decoration: line-through; opacity: .6; }
#qp .q.flash { animation: qflash 1.4s ease-out; }
@keyframes qflash { 0% { background: #f0d07055; } 100% { background: transparent; } }
`;

function fmt(def, v) {
  if (def.on === 'survive') { const m = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; return `${m(v)} / ${m(def.goal)}`; }
  const unit = def.on === 'move' || def.on === 'altitude' ? ' m' : '';
  return `${Math.floor(v)}/${def.goal}${unit}`;
}

/** touch: bố trí cho điện thoại (góc trên trái, dưới thanh chỉ số). */
export function createQuestPanel({ touch = false } = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'qp';
  el.style.cssText = touch ? 'left:max(8px,env(safe-area-inset-left));top:118px;width:210px;font-size:11px' : 'right:16px;top:16px';
  document.body.appendChild(el);
  let defs = [], rows = [], visible = !touch, last = []; // điện thoại: mặc định ẩn (che cần điều khiển), bấm 📜 để mở
  return {
    /** Dựng lại bảng cho loài vừa vào game. */
    setSpecies(species, speciesName) {
      defs = questsOf(species); last = defs.map(() => 0);
      el.innerHTML = `<h3>Nhiệm vụ — ${speciesName}<small>J ẩn/hiện</small></h3>` + defs.map((d) =>
        `<div class="q"><div class="t"><span class="ic">○</span>${d.title}<span class="n">${fmt(d, 0)}</span></div><div class="d">${d.desc}</div><div class="bar"><i></i></div></div>`).join('');
      rows = [...el.querySelectorAll('.q')];
      if (touch) el.querySelector('small').textContent = '';
    },
    /** Cập nhật tiến độ (mảng số theo thứ tự nhiệm vụ). */
    update(progress) {
      if (!Array.isArray(progress)) return;
      defs.forEach((d, i) => {
        const v = Math.min(d.goal, progress[i] || 0), row = rows[i];
        if (!row || v === last[i]) return;
        const done = v >= d.goal;
        row.classList.toggle('done', done);
        row.querySelector('.ic').textContent = done ? '✔' : '○';
        row.querySelector('.n').textContent = fmt(d, v);
        row.querySelector('.bar i').style.width = `${(v / d.goal) * 100}%`;
        if (done && last[i] < d.goal) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
        last[i] = v;
      });
    },
    show(on) { el.classList.toggle('on', on && visible); },
    toggle() { visible = !visible; el.classList.toggle('on', visible); return visible; },
  };
}
