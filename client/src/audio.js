// Âm thanh tổng hợp bằng Web Audio API (không dùng file âm thanh).
// createAudio({ ctx? }): nếu truyền ctx (AudioContext/OfflineAudioContext) thì dựng đồ thị ngay trên ctx đó (dùng để đo offline).
// Quy ước: mọi bộ tổng hợp nhận (v, o) với v = bộ công cụ của một "giọng" (voice), o = tuỳ chọn play().

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r = (a, b) => a + Math.random() * (b - a);
const P = (x) => Math.max(x, 1e-4); // tránh 0 cho exponentialRamp
const MAX_VOICES = 24;
const CUTOFF = 150; // m: xa hơn thì bỏ qua (âm to như gầm của con lớn được nới thêm)

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

function softClipCurve() {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.2) / Math.tanh(1.2); }
  return c;
}
function distCurve(k) {
  const n = 512, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k); }
  return c;
}

// ---------- Bộ công cụ cho một giọng ----------
// ---- Mẫu âm thanh thật (tuỳ chọn) ----
// Người dùng thả file vào client/public/sounds và khai báo trong manifest.json (xem README.md ở đó).
// Có mẫu cho (tên âm, loại) thì dùng mẫu (đổi cao độ theo cỡ thân), không thì dùng âm tổng hợp bên dưới.
const SAMPLES = new Map(); // 'roar:carnivore' -> [AudioBuffer, ...]
// Mỗi mẫu: { buf, minSize, maxSize }. Có size thì chỉ chọn mẫu hợp cỡ thân (con to dùng tiếng trầm/dài, con nhỏ dùng tiếng ngắn/cao).
function pickSample(name, kind, size) {
  const arr = SAMPLES.get(`${name}:${kind || '*'}`) || SAMPLES.get(`${name}:*`);
  if (!arr || !arr.length) return null;
  let cand = arr;
  if (size != null) { const f = arr.filter((e) => size >= e.minSize && size <= e.maxSize); if (f.length) cand = f; }
  return cand[Math.floor(Math.random() * cand.length)].buf;
}
/** Cắt đoạn [start, end] giây của một AudioBuffer (bản sao), có vuốt 10 ms hai đầu để không bị "click". */
function sliceBuffer(ctx, srcBuf, start, end) {
  const sr = srcBuf.sampleRate, a = Math.max(0, Math.floor(start * sr)), b = Math.min(srcBuf.length, Math.floor(end * sr));
  const len = Math.max(1, b - a), out = ctx.createBuffer(srcBuf.numberOfChannels, len, sr);
  const fade = Math.min(len >> 1, Math.floor(sr * 0.01));
  for (let c = 0; c < srcBuf.numberOfChannels; c++) {
    const d = out.getChannelData(c); d.set(srcBuf.getChannelData(c).subarray(a, b));
    for (let i = 0; i < fade; i++) { const g = i / fade; d[i] *= g; d[len - 1 - i] *= g; }
  }
  return out;
}
function normalizeBuffer(buf, target = 0.85) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  if (peak > 1e-4) { const g = target / peak; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } }
  return buf;
}

function makeVoice(ctx, out, t0, onDone) {
  const nodes = [], srcs = [];
  let live = 0, dur = 0, done = false;
  const bus = ctx.createGain();
  nodes.push(bus);
  bus.connect(out);
  const track = (n) => { nodes.push(n); return n; };
  const finish = () => {
    if (done) return; done = true;
    for (const n of nodes) { try { n.disconnect(); } catch { /* đã ngắt */ } }
    onDone && onDone();
  };
  const begin = (s, a, b) => {
    s.start(a); s.stop(b); live++; srcs.push(s); dur = Math.max(dur, b - t0);
    s.onended = () => { if (--live === 0) finish(); };
  };
  const v = {
    ctx, t0, bus, nodes, track,
    get dur() { return dur; },
    // envelope: attack a (s) tới peak rồi giảm mũ trong d (s). Trả về thời điểm kết thúc.
    env(param, t, a, peak, d) {
      param.setValueAtTime(1e-4, t);
      param.exponentialRampToValueAtTime(P(peak), t + Math.max(a, 0.002));
      param.exponentialRampToValueAtTime(1e-4, t + a + d);
      return t + a + d;
    },
    // dao động: f0 -> f1 (trượt mũ), có vibrato tuỳ chọn {rate, depth(Hz)}; dest mặc định bus
    tone({ type = 'sine', f0, f1 = f0, t = t0, dur: d = 0.2, peak = 0.3, a = 0.005, dest = bus, vib, detune = 0, filt }) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(P(f0), t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(P(f1), t + d);
      o.detune.value = detune;
      const g = ctx.createGain(); track(g);
      const end = v.env(g.gain, t, a, peak, Math.max(d - a, 0.01));
      let node = o;
      if (filt) { const f = track(ctx.createBiquadFilter()); f.type = filt.type; f.frequency.value = filt.f; f.Q.value = filt.q ?? 1; o.connect(f); node = f; }
      node.connect(g); g.connect(dest);
      if (vib) {
        const l = ctx.createOscillator(); l.frequency.value = vib.rate;
        const lg = track(ctx.createGain()); lg.gain.value = vib.depth;
        l.connect(lg); lg.connect(o.frequency); begin(l, t, end + 0.03);
      }
      begin(o, t, end + 0.03);
      return { osc: o, gain: g, end };
    },
    // nhiễu trắng qua bộ lọc (type, f0->f1, q), envelope a/d
    noise({ t = t0, dur: d = 0.2, type = 'lowpass', f0 = 1000, f1 = f0, q = 1, peak = 0.3, a = 0.005, dest = bus }) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx); s.loop = true;
      const f = track(ctx.createBiquadFilter()); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(P(f0), t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(P(f1), t + d);
      const g = track(ctx.createGain());
      const end = v.env(g.gain, t, a, peak, Math.max(d - a, 0.01));
      s.connect(f); f.connect(g); g.connect(dest);
      s.start(t, Math.random() * 1.5); s.stop(end + 0.03); live++; srcs.push(s); dur = Math.max(dur, end + 0.03 - t0);
      s.onended = () => { if (--live === 0) finish(); };
      return { src: s, filter: f, gain: g, end };
    },
    shaper(k, dest = bus) { const w = track(ctx.createWaveShaper()); w.curve = distCurve(k); w.connect(dest); return w; },
    // phát một mẫu (AudioBuffer) với tốc độ rate (đổi cao độ), có vào/ra mượt để không bị "click"
    sample(buf, { rate = 1, peak = 0.9, t = t0, a = 0.015, fadeOut = 0.12, dest = bus } = {}) {
      const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
      const g = track(ctx.createGain());
      const d = buf.duration / rate;
      g.gain.setValueAtTime(1e-4, t);
      g.gain.linearRampToValueAtTime(P(peak), t + a);
      g.gain.setValueAtTime(P(peak), t + Math.max(a, d - fadeOut));
      g.gain.linearRampToValueAtTime(1e-4, t + d);
      s.connect(g); g.connect(dest);
      s.start(t); s.stop(t + d + 0.05); live++; srcs.push(s); dur = Math.max(dur, d + 0.05);
      s.onended = () => { if (--live === 0) finish(); };
      return { src: s, end: t + d };
    },
    // dừng sớm (khi bị đẩy khỏi hàng đợi do quá 24 giọng)
    kill() {
      if (done) return;
      const now = ctx.currentTime;
      try { bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(0, now, 0.01); } catch { /* bỏ */ }
      for (const s of srcs) { try { s.stop(now + 0.06); } catch { /* chưa start/đã stop */ } }
    },
  };
  return v;
}

// ---------- Thư viện âm thanh ----------
const SND = {
  step(v, o) {
    const k = clamp(o.size ?? 1, 0.3, 15), I = clamp(o.intensity ?? 1, 0, 1.5), t = v.t0;
    const surf = o.surface || 'grass';
    const heavy = clamp(k / 5, 0.1, 1);
    const f = clamp(150 / (1 + k * 0.7), 26, 110) * r(0.92, 1.08); // con to -> trầm
    const amp = (0.25 + 0.5 * I) * 1.7;
    // thân bước: thump sub
    v.tone({ f0: f * 1.9, f1: f, dur: 0.14 + Math.min(k * 0.02, 0.35), peak: 0.7 * heavy * amp, a: 0.006 });
    if (k > 4) v.noise({ type: 'lowpass', f0: 160, q: 0.7, dur: 0.3, peak: 0.4 * amp, a: 0.008 }); // rung nền
    // bề mặt
    const light = 1 - heavy * 0.6;
    if (surf === 'grass') v.noise({ type: 'bandpass', f0: 900 + 400 / k, f1: 400, q: 0.8, dur: 0.12, peak: 0.3 * amp, a: 0.004 });
    else if (surf === 'sand') v.noise({ type: 'bandpass', f0: 1800, f1: 900, q: 0.6, dur: 0.2, peak: 0.28 * amp, a: 0.012 });
    else if (surf === 'rock') {
      v.noise({ type: 'highpass', f0: 2500, q: 0.7, dur: 0.05, peak: 0.35 * amp, a: 0.001 });
      v.tone({ type: 'triangle', f0: 380 * r(0.9, 1.1), f1: 260, dur: 0.07, peak: 0.12 * amp });
    } else if (surf === 'water') {
      v.noise({ type: 'bandpass', f0: 500, f1: 1400, q: 1.2, dur: 0.3, peak: 0.45 * amp, a: 0.02 });
      for (let i = 0; i < 2; i++) { const bf = r(500, 900); v.tone({ f0: bf, f1: bf * 2, t: t + 0.04 + i * r(0.06, 0.12), dur: 0.08, peak: 0.1 * amp }); }
    } else if (surf === 'wood') {
      v.tone({ f0: 210 * r(0.95, 1.05), f1: 170, dur: 0.22, peak: 0.4 * amp, a: 0.002 });
      v.noise({ type: 'bandpass', f0: 600, q: 6, dur: 0.18, peak: 0.3 * amp, a: 0.002 });
    }
    // con nhỏ: lách tách móng
    if (k < 2.5) v.noise({ type: 'highpass', f0: 3500, dur: 0.025, peak: 0.25 * light * amp, a: 0.001 });
  },
  bite(v, o) {
    const k = clamp(o.size ?? 1, 0.3, 15), I = o.intensity ?? 1;
    v.noise({ type: 'bandpass', f0: 2200, f1: 900, q: 0.9, dur: 0.07, peak: 0.6 * I, a: 0.001 });
    v.tone({ f0: 160 / (1 + k * 0.15), f1: 45, dur: 0.22, peak: 0.6 * I });
    v.noise({ type: 'lowpass', f0: 400, dur: 0.12, peak: 0.3 * I, a: 0.003 });
  },
  miss(v, o) {
    v.noise({ type: 'bandpass', f0: 1400, f1: 450, q: 1.5, dur: 0.2, peak: 0.35, a: 0.05 });
    v.noise({ type: 'highpass', f0: 2500, t: v.t0 + 0.14, dur: 0.03, peak: 0.15, a: 0.001 });
  },
  chew(v, o) {
    const n = 3 + Math.floor(Math.random() * 2), k = clamp(o.size ?? 1, 0.3, 15);
    for (let i = 0; i < n; i++) {
      const t = v.t0 + i * r(0.14, 0.2);
      v.noise({ t, type: 'bandpass', f0: r(500, 900), f1: r(250, 400), q: 3, dur: 0.12, peak: 0.45, a: 0.01 });
      v.tone({ t, f0: r(110, 160) / (1 + k * 0.05), f1: 70, dur: 0.1, peak: 0.25 });
    }
  },
  crunch(v) {
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = v.t0 + i * r(0.03, 0.07) + (i > 2 ? 0.05 : 0);
      v.noise({ t, type: 'highpass', f0: r(2500, 4500), q: 1, dur: r(0.025, 0.05), peak: r(0.25, 0.5), a: 0.001 });
    }
    v.noise({ type: 'bandpass', f0: 1200, q: 1, dur: 0.15, peak: 0.2, a: 0.003 });
  },
  gulp(v) {
    for (let i = 0; i < 2; i++) {
      const t = v.t0 + i * 0.17, f = r(230, 300) * (1 - i * 0.2);
      v.tone({ t, f0: f, f1: f * 0.35, dur: 0.14, peak: 0.5 - i * 0.15, a: 0.012 });
    }
    v.noise({ type: 'bandpass', f0: 500, q: 2, dur: 0.1, peak: 0.12, a: 0.01 });
  },
  slurp(v) {
    v.noise({ type: 'bandpass', f0: 600, f1: 2200, q: 4, dur: 0.35, peak: 0.35, a: 0.04 });
    v.noise({ type: 'bandpass', f0: 1800, f1: 700, q: 3, t: v.t0 + 0.3, dur: 0.15, peak: 0.25, a: 0.01 });
    for (let i = 0; i < 3; i++) v.tone({ t: v.t0 + 0.05 + i * 0.1, f0: r(500, 800), f1: r(1000, 1500), dur: 0.05, peak: 0.1 });
  },
  roar(v, o) {
    const k = clamp(o.size ?? 1, 0.3, 15), I = clamp(o.intensity ?? 1, 0.2, 1.5), kind = o.kind || 'carnivore', t = v.t0;
    if (kind === 'pterosaur') {
      const f = r(1800, 2500) / (1 + k * 0.03), d = (0.45 + 0.03 * k) * r(0.9, 1.1);
      const hp = v.track(v.ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 1200; hp.connect(v.bus);
      v.tone({ type: 'sawtooth', f0: f * 1.25, f1: f * 0.7, dur: d, peak: 0.28 * I, a: 0.02, dest: hp, vib: { rate: 35, depth: f * 0.06 } });
      v.tone({ type: 'sawtooth', f0: f * 1.27, f1: f * 0.72, dur: d, peak: 0.18 * I, a: 0.02, dest: hp, detune: 25 });
      v.noise({ type: 'bandpass', f0: 3500, q: 1.5, dur: d, peak: 0.1 * I, a: 0.02 });
      return;
    }
    const big = kind === 'carnivore';
    const f0 = clamp(520 / Math.pow(k, 0.9), 45, 800) * (big ? 1 : 1.5) * r(0.95, 1.05);
    const d = clamp(0.55 + 0.18 * k, 0.6, 2.8) * (big ? 1 : 0.9) * r(0.92, 1.08);
    const lpF = big ? clamp(f0 * 6, 330, 2600) : clamp(f0 * 5, 700, 3000);
    const lp = v.track(v.ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = lpF; lp.Q.value = 0.8;
    const sh = v.shaper(big ? 3 : 1.5, lp); const body = v.track(v.ctx.createGain());
    body.gain.setValueAtTime(1, t); body.connect(sh);
    lp.connect(v.bus);
    const pk = (big ? 0.55 : 0.5) * I;
    const mk = (f1, f2, f3, peak, det) => v.tone({
      type: 'sawtooth', f0: f1, f1: f3, dur: d, peak, a: Math.min(0.08, d * 0.15), dest: body, detune: det,
      vib: { rate: big ? 11 : 5.5, depth: f0 * (big ? 0.03 : 0.04) },
    });
    // đường cao độ: vọt lên rồi giảm dần
    mk(f0 * 1.3, f0, f0 * 0.8, pk, 0); mk(f0 * 1.31, f0, f0 * 0.82, pk * 0.6, 9);
    if (big) {
      // rền (AM ~ 26Hz) làm tiếng gừ
      const am = v.ctx.createOscillator(); am.frequency.value = r(22, 30);
      const ag = v.track(v.ctx.createGain()); ag.gain.value = 0.35; am.connect(ag); ag.connect(body.gain);
      body.gain.setValueAtTime(0.65, t); am.start(t); am.stop(t + d + 0.1);
      v.tone({ f0: Math.max(f0, 40), f1: Math.max(f0 * 0.7, 36), dur: d, peak: 0.5 * I * clamp(k / 6, 0.3, 1), a: 0.06 }); // sub
    } else {
      // herbivore: formant rống
      v.noise({ type: 'bandpass', f0: f0 * 4, f1: f0 * 5, q: 2, dur: d, peak: 0.12 * I, a: 0.05 });
    }
    v.noise({ type: 'bandpass', f0: clamp(f0 * 5, 300, 2500), q: 1, dur: d * 0.8, peak: 0.08 * I, a: 0.05 }); // hơi thở
  },
  flap(v, o) {
    const k = clamp(o.size ?? 1, 0.3, 15), lo = 1 / (1 + k * 0.12);
    v.noise({ type: 'bandpass', f0: 250 + 500 * lo, f1: 800 * lo + 250, q: 0.9, dur: 0.38, peak: 0.45, a: 0.12 });
    v.noise({ type: 'bandpass', f0: 800 * lo + 250, f1: 220, q: 0.9, t: v.t0 + 0.2, dur: 0.3, peak: 0.25, a: 0.05 });
    if (k > 2) v.tone({ f0: 70, f1: 45, dur: 0.25, peak: 0.2 * clamp(k / 8, 0.2, 1), a: 0.06 });
  },
  wing_whoosh(v, o) {
    const k = clamp(o.size ?? 3, 0.3, 15);
    v.noise({ type: 'bandpass', f0: 180, f1: 420, q: 0.8, dur: 0.6, peak: 0.55, a: 0.2 });
    v.noise({ type: 'lowpass', f0: 600, f1: 200, q: 0.7, t: v.t0 + 0.25, dur: 0.5, peak: 0.35, a: 0.05 });
    v.tone({ f0: 60, f1: 38, dur: 0.45, peak: 0.35 * clamp(k / 6, 0.3, 1), a: 0.12 });
  },
  hurt(v, o) {
    const kind = o.kind || 'dino', k = clamp(o.size ?? 1, 0.3, 15), I = o.intensity ?? 1;
    if (kind === 'dino') {
      const f = clamp(420 / Math.pow(k, 0.6), 90, 700) * r(0.95, 1.05);
      const lp = v.track(v.ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = clamp(f * 5, 500, 2500); lp.connect(v.bus);
      v.tone({ type: 'sawtooth', f0: f * 1.4, f1: f * 0.6, dur: 0.45, peak: 0.45 * I, a: 0.02, dest: lp, vib: { rate: 14, depth: f * 0.05 } });
      v.noise({ type: 'bandpass', f0: f * 4, q: 1, dur: 0.3, peak: 0.08, a: 0.02 });
    } else if (kind === 'chicken') {
      v.tone({ type: 'square', f0: 900, f1: 500, dur: 0.3, peak: 0.2, a: 0.01, vib: { rate: 30, depth: 120 }, filt: { type: 'bandpass', f: 1200, q: 1 } });
    } else if (kind === 'rabbit') {
      v.tone({ f0: 1700, f1: 900, dur: 0.22, peak: 0.3, a: 0.01, vib: { rate: 20, depth: 80 } });
      v.tone({ f0: 3400, f1: 1800, dur: 0.18, peak: 0.08 });
    } else if (kind === 'mouse') {
      v.tone({ f0: 3200, f1: 2400, dur: 0.1, peak: 0.25, a: 0.004 });
      v.tone({ f0: 3600, f1: 2700, t: v.t0 + 0.09, dur: 0.1, peak: 0.2, a: 0.004 });
    } else { // bird
      v.tone({ f0: 3600, f1: 2200, dur: 0.18, peak: 0.25, a: 0.005, vib: { rate: 40, depth: 150 } });
    }
  },
  die(v, o) {
    const kind = o.kind || 'dino', k = clamp(o.size ?? 1, 0.3, 15);
    if (kind === 'dino') {
      v.tone({ f0: 85 / (1 + k * 0.1), f1: 28, dur: 0.7, peak: 0.8, a: 0.01 });
      v.noise({ type: 'lowpass', f0: 300, f1: 90, dur: 0.6, peak: 0.5, a: 0.008 });
      v.tone({ type: 'sawtooth', f0: 160 / (1 + k * 0.2), f1: 40, t: v.t0 + 0.1, dur: 0.9, peak: 0.2, a: 0.1, filt: { type: 'lowpass', f: 500 } });
    } else {
      SND.hurt(v, { ...o, kind });
      v.tone({ f0: 1200, f1: 200, t: v.t0 + 0.12, dur: 0.25, peak: 0.12 });
    }
  },
  splash(v, o) {
    const k = clamp(o.size ?? 1, 0.3, 15), I = o.intensity ?? 1;
    v.noise({ type: 'lowpass', f0: 3000, f1: 700, q: 0.7, dur: 0.5 + 0.03 * k, peak: 0.5 * I, a: 0.01 });
    v.noise({ type: 'bandpass', f0: 1500, f1: 500, q: 0.8, dur: 0.7, peak: 0.3 * I, a: 0.03 });
    for (let i = 0; i < 4; i++) { const f = r(400, 900); v.tone({ t: v.t0 + 0.05 + i * r(0.05, 0.1), f0: f, f1: f * 2.2, dur: 0.08, peak: 0.12 * I }); }
    if (k > 2) v.tone({ f0: 90, f1: 40, dur: 0.3, peak: 0.3 * clamp(k / 8, 0.2, 1) });
  },
  thud(v, o) {
    const k = clamp(o.size ?? 1, 0.3, 15), I = o.intensity ?? 1;
    v.tone({ f0: 130 / (1 + k * 0.3), f1: 30, dur: 0.25 + 0.04 * k, peak: 0.8 * I * clamp(0.3 + k / 5, 0.3, 1), a: 0.004 });
    v.noise({ type: 'lowpass', f0: 500, f1: 120, dur: 0.2 + 0.02 * k, peak: 0.45 * I, a: 0.003 });
  },
  cluck(v) {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const f = r(450, 600);
      v.tone({ type: 'square', f0: f, f1: f * 0.7, t: v.t0 + i * r(0.09, 0.13), dur: 0.07, peak: 0.2, a: 0.004, filt: { type: 'bandpass', f: 900, q: 1.5 } });
    }
  },
  squeak(v) {
    for (let i = 0; i < 2; i++) { const f = r(3200, 4000); v.tone({ f0: f, f1: f * 1.3, t: v.t0 + i * 0.11, dur: 0.09, peak: 0.2, a: 0.004 }); }
  },
  peep(v) {
    for (let i = 0; i < 2; i++) { const f = r(3000, 3800); v.tone({ f0: f, f1: f * 0.8, t: v.t0 + i * 0.15, dur: 0.1, peak: 0.2, a: 0.006, vib: { rate: 30, depth: 60 } }); }
  },
  rabbit_thump(v) {
    for (let i = 0; i < 2; i++) {
      v.tone({ f0: r(110, 130), f1: 45, t: v.t0 + i * 0.12, dur: 0.12, peak: 0.6, a: 0.004 });
      v.noise({ t: v.t0 + i * 0.12, type: 'lowpass', f0: 300, dur: 0.06, peak: 0.25, a: 0.002 });
    }
  },
  ui_click(v) {
    v.tone({ f0: 1400, f1: 900, dur: 0.05, peak: 0.25, a: 0.002 });
    v.noise({ type: 'highpass', f0: 3000, dur: 0.015, peak: 0.1, a: 0.001 });
  },
  notice(v) {
    [[880, 0], [1318.5, 0.14]].forEach(([f, dt]) => {
      v.tone({ f0: f, t: v.t0 + dt, dur: 0.9, peak: 0.22, a: 0.004 });
      v.tone({ f0: f * 2.76, t: v.t0 + dt, dur: 0.35, peak: 0.05, a: 0.003 });
    });
  },
  level_up(v) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      v.tone({ type: 'triangle', f0: f, t: v.t0 + i * 0.11, dur: i === 3 ? 1.0 : 0.35, peak: 0.25, a: 0.01 });
      v.tone({ f0: f * 2, t: v.t0 + i * 0.11, dur: 0.3, peak: 0.06, a: 0.01 });
    });
  },
  // Chim hót (dùng cho lớp rừng; cũng gọi được bằng play). o.variant 0..2
  bird_song(v, o) {
    const variant = o.variant ?? Math.floor(Math.random() * 3), base = r(3000, 4200);
    if (variant === 0) {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) v.tone({ f0: base * r(0.9, 1.1), f1: base * r(1.2, 1.5), t: v.t0 + i * 0.12, dur: 0.08, peak: 0.2, a: 0.006 });
    } else if (variant === 1) { // trill
      v.tone({ f0: base, f1: base * 0.9, dur: 0.5, peak: 0.18, a: 0.03, vib: { rate: 38, depth: base * 0.12 } });
    } else { // huýt dài trượt cao độ
      v.tone({ f0: base * 0.7, f1: base * 1.2, dur: 0.3, peak: 0.2, a: 0.03 });
      v.tone({ f0: base * 1.2, f1: base * 0.85, t: v.t0 + 0.3, dur: 0.3, peak: 0.2, a: 0.01 });
    }
  },
};
SND.eat_done = SND.level_up;

// ---------- Bộ điều khiển chính ----------
/** Phát mẫu thật: gầm thì hạ cao độ theo cỡ thân (con to trầm hơn) và trộn thêm tiếng trầm cho nặng. */
function playSample(v, buf, name, o) {
  const size = clamp(o.size ?? 3, 0.3, 15), I = clamp(o.intensity ?? 1, 0.2, 1.5);
  let rate = name === 'roar' ? clamp(Math.pow(6 / size, 0.25), 0.7, 1.6) : 1;
  rate *= r(0.96, 1.04);
  v.sample(buf, { rate, peak: 0.9 * I });
  if (name === 'roar' && size > 4 && o.kind !== 'pterosaur') {
    const f = clamp(90 / Math.pow(size / 6, 0.6), 38, 110);
    v.tone({ f0: f, f1: f * 0.7, dur: Math.min(1.4, buf.duration / rate), peak: 0.26 * clamp(size / 8, 0.3, 1) * I, a: 0.05 });
  }
}

export const SOUND_NAMES = Object.keys(SND);

export function createAudio(opts = {}) {
  let ctx = opts.ctx || null;
  const ownCtx = !opts.ctx;
  let master = null, tone = null, ambBus = null, muted = false, volume = 0.8, disposed = false;
  let voices = [];
  let L = { x: 0, y: 0, z: 0, yaw: 0 };
  const amb = { ready: false, birdT: 2, roarT: 30 };
  const lastEnv = { waterProx: 0, forest: 0, wind: 0, altitude: 0, speed: 0, underwater: false };

  function build() {
    if (master || !ctx) return;
    // chuỗi cuối: master gain -> lowpass (dưới nước) -> compressor -> soft clip (đảm bảo |x| <= 1)
    master = ctx.createGain(); master.gain.value = muted ? 0 : volume;
    tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 20000; tone.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.2;
    const clip = ctx.createWaveShaper(); clip.curve = softClipCurve();
    master.connect(tone); tone.connect(comp); comp.connect(clip); clip.connect(ctx.destination);
    ambBus = ctx.createGain(); ambBus.gain.value = 0.5; ambBus.connect(master);
  }
  let samplesLoading = false;
  async function loadSamples() {
    if (samplesLoading || opts.ctx || typeof fetch !== 'function' || typeof document === 'undefined') return;
    samplesLoading = true;
    try {
      // Luôn tính từ gốc của ứng dụng (BASE_URL), không phụ thuộc trang đang mở nằm ở thư mục nào
      const base = new URL(`${(import.meta.env && import.meta.env.BASE_URL) || '/'}sounds/`, document.baseURI);
      const res = await fetch(new URL('manifest.json', base));
      if (!res.ok) return;
      const man = await res.json();
      const decoded = new Map(); // mỗi file chỉ giải mã một lần dù có nhiều đoạn cắt từ nó
      for (const [name, kinds] of Object.entries(man)) {
        if (name.startsWith('_') || typeof kinds !== 'object') continue;
        for (const [kind, files] of Object.entries(kinds)) {
          for (const item of Array.isArray(files) ? files : []) {
            // item: "file.ogg" hoặc { file, start, end, minSize, maxSize, gain } (start/end tính bằng giây; min/maxSize theo mét)
            const e = typeof item === 'string' ? { file: item } : item;
            try {
              let full = decoded.get(e.file);
              if (!full) {
                const r2 = await fetch(new URL(e.file, base));
                if (!r2.ok) continue;
                full = await ctx.decodeAudioData(await r2.arrayBuffer());
                decoded.set(e.file, full);
              }
              const cut = e.start != null || e.end != null;
              const buf = normalizeBuffer(cut ? sliceBuffer(ctx, full, e.start ?? 0, e.end ?? full.duration) : full, e.gain ?? 0.85);
              const key = `${name}:${kind}`;
              if (!SAMPLES.has(key)) SAMPLES.set(key, []);
              SAMPLES.get(key).push({ buf, minSize: e.minSize ?? 0, maxSize: e.maxSize ?? Infinity });
            } catch (err) { console.warn('Không nạp được âm thanh', e.file, err.message || err); }
          }
        }
      }
      if (SAMPLES.size) console.info('[audio] đã nạp mẫu âm thanh thật:', [...SAMPLES.entries()].map(([k, v]) => `${k} x${v.length}`).join(', '));
    } catch { /* không có manifest thì dùng âm tổng hợp */ }
  }
  const ready = () => !disposed && ctx && master && (opts.ctx || ctx.state === 'running');
  if (ctx) build();

  // Spatial: trả về { vol, pan, lp } hoặc null nếu quá xa
  function spatial(o) {
    if (o.x === undefined || o.z === undefined) return { vol: 1, pan: 0, lp: 20000 };
    const dx = o.x - L.x, dz = o.z - L.z, dy = (o.y ?? L.y) - L.y;
    const dh = Math.hypot(dx, dz), d = Math.hypot(dh, dy);
    const size = o.size ?? 1;
    const cut = CUTOFF + (o.name === 'roar' ? 8 * size : 0);
    if (d > cut) return null;
    const ref = 6 + 3 * Math.sqrt(size);
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = dh > 1e-3 ? clamp(((dx * rx + dz * rz) / dh) * Math.min(1, dh / 3), -1, 1) : 0;
    return { vol: 1 / (1 + d / ref), pan, lp: Math.max(1500, 20000 / (1 + d / 18)) };
  }

  function play(name, o = {}) {
    if (!ready()) return;
    const fn = SND[name];
    if (!fn) return;
    try {
      const sp = spatial({ ...o, name });
      if (!sp) return;
      const gain = sp.vol * (o.gain ?? 1);
      voices = voices.filter((x) => !x.done);
      if (voices.length >= MAX_VOICES) {
        let lo = voices[0];
        for (const x of voices) if (x.prio < lo.prio) lo = x;
        if (lo.prio >= gain) return; // âm mới yếu nhất -> bỏ
        lo.v.kill(); lo.done = true; voices.splice(voices.indexOf(lo), 1);
      }
      const t0 = ctx.currentTime + 0.005;
      const out = ctx.createGain(); // nhánh định vị: lowpass -> pan -> master
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sp.lp; lp.Q.value = 0.5;
      let tail = lp;
      let pn = null;
      if (ctx.createStereoPanner) { pn = ctx.createStereoPanner(); pn.pan.value = sp.pan * 0.85; lp.connect(pn); tail = pn; }
      tail.connect(master);
      out.connect(lp);
      const rec = { prio: gain, done: false, v: null };
      rec.v = makeVoice(ctx, out, t0, () => { rec.done = true; try { out.disconnect(); lp.disconnect(); pn && pn.disconnect(); } catch { /* bỏ */ } });
      rec.v.bus.gain.value = gain;
      const buf = pickSample(name, o.kind, o.size);
      if (buf) playSample(rec.v, buf, name, o); else fn(rec.v, o);
      voices.push(rec);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('audio.play lỗi', name, e);
    }
  }

  // ----- Lớp nền -----
  function noiseSrc() {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx); s.loop = true; s.start(0, Math.random()); return s;
  }
  function lfo(rate, depth, target, phaseT = 0) {
    const o = ctx.createOscillator(); o.frequency.value = rate;
    const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(target); o.start(phaseT); return o;
  }
  function buildAmbient() {
    amb.ready = true;
    // Gió: nhiễu bandpass, tâm lọc lắc chậm bằng LFO
    amb.windG = ctx.createGain(); amb.windG.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.7;
    noiseSrc().connect(wf); wf.connect(amb.windG); amb.windG.connect(ambBus);
    lfo(0.13, 180, wf.frequency); lfo(0.31, 90, wf.frequency);
    // Sóng biển: nhiễu lowpass, biên độ dâng/rút ~7.5 s
    amb.waveG = ctx.createGain(); amb.waveG.gain.value = 0;
    const wm = ctx.createGain(); wm.gain.value = 0.55;
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 600; wl.Q.value = 0.6;
    noiseSrc().connect(wl); wl.connect(wm); wm.connect(amb.waveG); amb.waveG.connect(ambBus);
    lfo(1 / 7.5, 0.45, wm.gain); lfo(1 / 7.5, 350, wl.frequency);
    // Rừng: lá xào xạc + côn trùng
    amb.leafG = ctx.createGain(); amb.leafG.gain.value = 0;
    const lf = ctx.createBiquadFilter(); lf.type = 'bandpass'; lf.frequency.value = 3200; lf.Q.value = 0.6;
    const lm = ctx.createGain(); lm.gain.value = 0.7; lfo(0.2, 0.3, lm.gain); // xào xạc lúc mạnh lúc nhẹ
    noiseSrc().connect(lf); lf.connect(lm); lm.connect(amb.leafG); amb.leafG.connect(ambBus);
    amb.bugG = ctx.createGain(); amb.bugG.gain.value = 0;
    const carrier = ctx.createOscillator(); carrier.frequency.value = 4300;
    const chirp = ctx.createGain(); chirp.gain.value = 0.5; // rả rích: AM ~ 24 Hz, bật/tắt chậm
    carrier.connect(chirp); chirp.connect(amb.bugG); amb.bugG.connect(ambBus); carrier.start();
    lfo(24, 0.5, chirp.gain); lfo(0.4, 0.3, chirp.gain);
  }
  const smooth = (param, target, tc = 1.2) => param.setTargetAtTime(target, ctx.currentTime, tc);

  function update(dt, env = {}) {
    if (!ready()) return;
    try {
      if (!amb.ready) buildAmbient();
      const e = { ...lastEnv, ...env }; Object.assign(lastEnv, env);
      const uw = !!e.underwater;
      const wind = clamp(e.wind, 0, 1), alt = clamp((e.altitude || 0) / 200, 0, 1);
      smooth(tone.frequency, uw ? 450 : 20000, 0.15);
      smooth(amb.windG.gain, uw ? 0 : 0.2 * (0.12 + 0.6 * wind + 0.5 * alt) * (1 + 0.5 * clamp(e.speed, 0, 1) * 0.3));
      smooth(amb.waveG.gain, (uw ? 0.12 : 0.28) * clamp(e.waterProx, 0, 1));
      const forest = uw ? 0 : clamp(e.forest, 0, 1);
      smooth(amb.leafG.gain, 0.05 * forest);
      smooth(amb.bugG.gain, 0.012 * forest);
      // chim hót ngẫu nhiên + tiếng gầm vọng xa hiếm
      if (forest > 0.1) {
        amb.birdT -= dt;
        if (amb.birdT <= 0) {
          amb.birdT = r(1.5, 5) / forest;
          const a = Math.random() * Math.PI * 2, d = r(15, 60);
          play('bird_song', { x: L.x + Math.cos(a) * d, z: L.z + Math.sin(a) * d, y: L.y + r(2, 10), gain: 0.6 * forest });
        }
        amb.roarT -= dt;
        if (amb.roarT <= 0) {
          amb.roarT = r(30, 80);
          if (forest > 0.3) { const a = Math.random() * Math.PI * 2; play('roar', { x: L.x + Math.cos(a) * 130, z: L.z + Math.sin(a) * 130, size: r(6, 12), gain: 0.35, kind: 'carnivore' }); }
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('audio.update lỗi', err);
    }
  }

  return {
    get ctx() { return ctx; },
    names: SOUND_NAMES,
    get voiceCount() { return voices.filter((x) => !x.done).length; },
    get sampleCount() { let n = 0; for (const a of SAMPLES.values()) n += a.length; return n; },
    resume() {
      if (disposed) return;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC(); build();
        }
        if (ctx.resume) ctx.resume();
        loadSamples();
      } catch (e) { if (typeof console !== 'undefined') console.warn('audio.resume lỗi', e); }
    },
    setMasterVolume(v) {
      volume = clamp(+v || 0, 0, 1);
      if (master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.03);
      return muted;
    },
    setListener(pos, yaw = 0) {
      if (pos) { L.x = pos.x || 0; L.y = pos.y || 0; L.z = pos.z || 0; }
      L.yaw = yaw || 0;
    },
    play, update,
    dispose() {
      disposed = true;
      try { for (const x of voices) x.v.kill(); } catch { /* bỏ */ }
      voices = [];
      if (ctx && ownCtx && ctx.close) { try { ctx.close(); } catch { /* bỏ */ } }
    },
  };
}
