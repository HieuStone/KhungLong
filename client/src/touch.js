// Điều khiển cảm ứng cho điện thoại/máy tính bảng:
//  - Nửa trái màn hình: cần điều khiển ảo (chạm ở đâu thì cần hiện ở đó). Đẩy ra sát mép = chạy nhanh.
//  - Nửa phải: vuốt để xoay camera, chụm/mở 2 ngón để zoom.
//  - Cụm nút bên phải: Cắn, Ăn/Uống (giữ để làm liên tục), Gầm, Tha xác, Ngủ; loài bay có thêm Bay lên / Hạ xuống.
//  - Góc trên phải: toàn màn hình, tắt/bật âm thanh.

/** Thiết bị cảm ứng là chính (điện thoại/tablet). ?touch=1 / ?touch=0 để ép bật/tắt khi thử. */
export function isTouchDevice() {
  const f = new URLSearchParams(location.search).get('touch');
  if (f != null) return f === '1';
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
}

const CSS = `
#tc { position: fixed; inset: 0; z-index: 4; touch-action: none; user-select: none; -webkit-user-select: none; display: none; }
#tc.on { display: block; }
#tc .stick { position: absolute; width: 130px; height: 130px; margin: -65px 0 0 -65px; border-radius: 50%;
  background: radial-gradient(circle, #ffffff14 0 55%, #ffffff30 56% 60%, #ffffff10 61%); box-shadow: 0 0 0 2px #fff4 inset; display: none; pointer-events: none; }
#tc .knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  background: #ffffffa0; box-shadow: 0 2px 8px #0006; }
#tc .stick.run .knob { background: #ffd34dd0; }
#tc .hint { position: absolute; left: 7%; bottom: 14%; color: #fff9; font: 13px sans-serif; text-shadow: 0 1px 2px #000; pointer-events: none; }
#tc .btns { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: max(14px, env(safe-area-inset-bottom));
  display: grid; grid-template-columns: repeat(3, 64px); gap: 10px; justify-items: center; align-items: center; }
#tc .b { width: 64px; height: 64px; border-radius: 50%; border: 2px solid #fff6; background: #0006; color: #fff; font: bold 12px sans-serif;
  display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.1; text-shadow: 0 1px 2px #000; touch-action: none; }
#tc .b.big { width: 82px; height: 82px; font-size: 15px; background: #b8323280; }
#tc .b.on, #tc .b:active { background: #ffffff55; border-color: #fff; }
#tc .b.hide { visibility: hidden; }
#tc .top { position: absolute; right: max(10px, env(safe-area-inset-right)); top: max(10px, env(safe-area-inset-top)); display: flex; gap: 8px; }
#tc .s { width: 42px; height: 42px; border-radius: 10px; border: 1px solid #fff5; background: #0006; color: #fff; font: 18px sans-serif;
  display: flex; align-items: center; justify-content: center; touch-action: none; }
#tc .rot { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; padding: 20px;
  background: #000b; color: #fff; font: 16px sans-serif; pointer-events: none; }
@media (orientation: portrait) { #tc.on .rot.show { display: flex; } }
`;

/**
 * cb: { onLook(dx, dy), onZoom(factor), onAction(id, down: boolean) }
 * Trả về { state: { mx, mz, sprint, held }, show(on), setFlyer(on) }.
 *   mx, mz: -1..1 (mz âm = tiến, như phím W); held[id]: nút đang giữ.
 */
export function createTouchControls(cb) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'tc';
  root.innerHTML = `
    <div class="stick"><div class="knob"></div></div>
    <div class="hint">Chạm & kéo để đi • đẩy ra mép để chạy</div>
    <div class="btns">
      <div class="b fly" data-id="up" data-hold>▲<br>Bay lên</div>
      <div class="b" data-id="roar">Gầm</div>
      <div class="b" data-id="grab">Tha<br>xác</div>
      <div class="b fly" data-id="down" data-hold>▼<br>Hạ</div>
      <div class="b" data-id="sleep">Ngủ</div>
      <div class="b" data-id="interact" data-hold>Ăn<br>Uống</div>
      <div></div><div></div>
      <div class="b big" data-id="attack" data-hold>Cắn</div>
    </div>
    <div class="top"><div class="s" data-id="quests">📜</div><div class="s" data-id="mute">🔊</div><div class="s" data-id="fullscreen">⛶</div></div>
    <div class="rot">Xoay ngang điện thoại để chơi dễ hơn</div>`;
  document.body.appendChild(root);

  const stick = root.querySelector('.stick'), knob = root.querySelector('.knob'), hint = root.querySelector('.hint');
  const state = { mx: 0, mz: 0, sprint: false, held: {} };
  const R = 52; // bán kính kéo tối đa (px)

  // ---- Cần điều khiển (nửa trái) và xoay camera (nửa phải) ----
  let stickId = null, sx = 0, sy = 0;
  const looks = new Map(); // pointerId -> {x, y}
  let pinchD = 0;
  const pinchDist = () => { const p = [...looks.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };

  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.b, .s')) return; // nút tự xử lý
    e.preventDefault();
    if (e.clientX < innerWidth * 0.45 && stickId == null) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.style.display = 'block';
      knob.style.transform = ''; hint.style.display = 'none';
    } else {
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (looks.size === 2) pinchD = pinchDist();
    }
    root.setPointerCapture?.(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const k = Math.min(1, d / R);
      const dead = 0.12; // vùng chết nhỏ ở giữa
      const mag = k < dead ? 0 : (k - dead) / (1 - dead);
      state.mx = d > 0 ? (dx / Math.max(d, 1e-3)) * mag : 0;
      state.mz = d > 0 ? (dy / Math.max(d, 1e-3)) * mag : 0;
      state.sprint = d > R * 0.92;
      stick.classList.toggle('run', state.sprint);
      return;
    }
    const p = looks.get(e.pointerId);
    if (!p) return;
    if (looks.size >= 2) {
      p.x = e.clientX; p.y = e.clientY;
      const d = pinchDist();
      if (pinchD > 0 && d > 0) cb.onZoom?.(pinchD / d);
      pinchD = d;
      return;
    }
    cb.onLook?.(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
  });
  const end = (e) => {
    if (e.pointerId === stickId) {
      stickId = null; state.mx = 0; state.mz = 0; state.sprint = false;
      stick.style.display = 'none'; stick.classList.remove('run');
    }
    looks.delete(e.pointerId);
    if (looks.size < 2) pinchD = 0;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  // ---- Nút hành động ----
  for (const el of root.querySelectorAll('.b, .s')) {
    const id = el.dataset.id, hold = el.hasAttribute('data-hold');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('on');
      if (hold) state.held[id] = true;
      if (id === 'fullscreen') toggleFullscreen();
      else if (id === 'mute') el.textContent = cb.onAction?.(id, true) ? '🔇' : '🔊';
      else cb.onAction?.(id, true);
      navigator.vibrate?.(12);
    });
    const up = () => { el.classList.remove('on'); if (hold) { state.held[id] = false; cb.onAction?.(id, false); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    else requestFull();
  }

  const rot = root.querySelector('.rot');
  return {
    state,
    show(on) {
      root.classList.toggle('on', on);
      if (!on) { stickId = null; looks.clear(); state.mx = state.mz = 0; state.sprint = false; state.held = {}; stick.style.display = 'none'; }
      else { hint.style.display = ''; rot.classList.add('show'); setTimeout(() => rot.classList.remove('show'), 4000); }
    },
    setFlyer(on) { for (const el of root.querySelectorAll('.b.fly')) el.classList.toggle('hide', !on); },
  };
}

/** Toàn màn hình + khoá xoay ngang (Android Chrome hỗ trợ; iPhone Safari bỏ qua, không lỗi). */
export function requestFull() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(el, { navigationUI: 'hide' }))
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}
