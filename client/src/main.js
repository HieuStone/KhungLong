import * as THREE from 'three';
import {
  SPECIES, SPECIES_IDS, STAGE_SCALE, NPC_KINDS, SERVER_PORT, C2S, S2C, encode, decode, heightAt, groundAt, getWorld, WATER_LEVEL,
} from '@isle/shared';
import { createTerrain } from './render/terrain.js';
import { createFlora } from './render/flora.js';
import { createBridge } from './render/bridge.js';
import { createSky } from './render/sky.js';
import { createDino } from './render/dino.js';
import { createPterosaur } from './render/pterosaur.js';
import { createAudio } from './audio.js';
import { DEFAULT_COLORS, BODY_PRESETS, suggestAccent, normalizeColors } from './render/colorize.js';

// Mỗi loài một mô hình: loài bay dùng mô hình thằn lằn cánh, còn lại dùng khủng long chân đất
const createCreature = (species, colors = null) => (SPECIES[species]?.flight ? createPterosaur(species, colors) : createDino(species, colors));
import { createAnimal } from './render/animals.js';

// ---- Menu ----
const sel = document.getElementById('species');
for (const id of SPECIES_IDS) sel.add(new Option(`${SPECIES[id].name} (${SPECIES[id].diet})`, id));
const menu = document.getElementById('menu');

// ---- Chọn màu khủng long + xem trước 3D ----
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* không lưu được thì thôi */ } } };
let colorMemo = {};
try { colorMemo = JSON.parse(store.get('isle.colors') || '{}') || {}; } catch { colorMemo = {}; }
const colBody = document.getElementById('colBody'), colAccent = document.getElementById('colAccent'), swBox = document.getElementById('swatches');
const nameInput = document.getElementById('name');
nameInput.value = store.get('isle.name') || '';
if (store.get('isle.species') && SPECIES[store.get('isle.species')]) sel.value = store.get('isle.species');

/** Màu đang chọn của loài hiện tại (mặc định nếu chưa chỉnh). */
const currentColors = () => colorMemo[sel.value] || { ...DEFAULT_COLORS[sel.value] };
/** Màu gửi cho server: null nếu là màu mặc định. */
const colorsToSend = () => normalizeColors(sel.value, currentColors());

for (const hex of BODY_PRESETS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'sw'; b.style.background = hex; b.dataset.hex = hex; b.title = hex;
  b.onclick = () => setColors({ body: hex, accent: suggestAccent(hex) });
  swBox.appendChild(b);
}

function setColors(c) {
  colorMemo[sel.value] = { body: c.body, accent: c.accent };
  store.set('isle.colors', JSON.stringify(colorMemo));
  syncColorUi(); rebuildPreview();
}
function syncColorUi() {
  const c = currentColors();
  colBody.value = c.body; colAccent.value = c.accent;
  for (const s of swBox.children) s.classList.toggle('on', s.dataset.hex.toLowerCase() === c.body.toLowerCase());
}
colBody.oninput = () => setColors({ body: colBody.value, accent: currentColors().accent });
colAccent.oninput = () => setColors({ body: currentColors().body, accent: colAccent.value });
document.getElementById('colDefault').onclick = () => { delete colorMemo[sel.value]; store.set('isle.colors', JSON.stringify(colorMemo)); syncColorUi(); rebuildPreview(); };
document.getElementById('colRandom').onclick = () => {
  const hex = '#' + new THREE.Color().setHSL(Math.random(), 0.35 + Math.random() * 0.4, 0.28 + Math.random() * 0.32).getHexString();
  setColors({ body: hex, accent: suggestAccent(hex) });
};

// Khung xem trước: một renderer nhỏ riêng, chỉ chạy khi menu đang hiện
const prevCanvas = document.getElementById('preview');
const prev = {
  renderer: new THREE.WebGLRenderer({ canvas: prevCanvas, antialias: true, alpha: true }),
  scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(32, 340 / 210, 0.1, 200), creature: null,
};
prev.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
prev.renderer.setSize(340, 210, false);
prev.scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.3));
const prevSun = new THREE.DirectionalLight(0xfff4e0, 1.1); prevSun.position.set(4, 8, 5); prev.scene.add(prevSun);
function rebuildPreview() {
  if (prev.creature) { prev.scene.remove(prev.creature.group); prev.creature.dispose(); }
  prev.creature = createCreature(sel.value, colorsToSend());
  prev.scene.add(prev.creature.group);
  const sp = SPECIES[sel.value], size = sp.bodyLength * (sp.flight ? 1.75 : 1);
  prev.camera.position.set(size * 0.78, size * 0.42, size * 1.22);
  prev.camera.lookAt(0, size * 0.16, 0);
}
let prevLast = performance.now();
function previewLoop(now) {
  requestAnimationFrame(previewLoop);
  if (menu.classList.contains('hidden') || !prev.creature) { prevLast = now; return; }
  const dt = Math.min(0.1, (now - prevLast) / 1000); prevLast = now;
  prev.creature.group.rotation.y += dt * 0.7;
  prev.creature.update(dt, 'idle', 0);
  prev.renderer.render(prev.scene, prev.camera);
}
sel.addEventListener('change', () => { store.set('isle.species', sel.value); syncColorUi(); rebuildPreview(); });
syncColorUi(); rebuildPreview(); requestAnimationFrame(previewLoop);

// ---- HUD (thanh chỉ số) ----
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:16px;bottom:16px;width:240px;font:12px sans-serif;color:#fff;z-index:5;display:none;text-shadow:0 1px 2px #000';
const bars = {};
for (const [k, label, color] of [['hp', 'Máu', '#d33'], ['hunger', 'Đói', '#d82'], ['thirst', 'Khát', '#39d'], ['stamina', 'Thể lực', '#4c4'], ['growth', 'Lớn', '#c9c']]) {
  const row = document.createElement('div');
  row.style.cssText = 'margin:4px 0;display:flex;align-items:center;gap:6px';
  // Phần nền xám là phần đã tụt: thanh màu càng ngắn thì phần xám càng dài
  row.innerHTML = `<span style="width:52px">${label}</span>`
    + '<div style="flex:1;height:11px;background:#7b7f86;border-radius:6px;overflow:hidden;box-shadow:inset 0 0 0 1px #0009">'
    + `<div class="fill" style="height:100%;width:100%;background:${color};transition:width .15s,filter .25s"></div></div>`
    + '<span class="val" style="width:34px;text-align:right">100%</span>'
    + '<span class="delta" style="width:38px;color:#9f9;font-weight:bold"></span>';
  hud.appendChild(row);
  bars[k] = { fill: row.querySelector('.fill'), val: row.querySelector('.val'), delta: row.querySelector('.delta'), prev: null, timer: 0 };
}
const info = document.createElement('div');
info.style.cssText = 'margin-top:6px;opacity:.85;line-height:1.35';
info.innerHTML = 'WASD đi • Shift chạy • <b>Giữ chuột trái / F</b>: cắn (cạnh xác thì ăn xác) • <b>Giữ E</b>: uống (mặt hướng ra nước) / ăn xác / gặm cây • C ngủ • <b>R</b> gầm • <b>G</b> ngậm/kéo xác đi • <b>M</b> tắt/bật âm thanh<br><b>Loài bay (Pteranodon): giữ Space cất cánh / bay lên, Ctrl hạ xuống, nhả phím thì lướt chìm dần</b><br>Cuộn chuột zoom • click để khoá chuột';
hud.appendChild(info);
document.body.appendChild(hud);
// Chỉ báo độ cao (chỉ hiện khi đang bay)
const altBox = document.createElement('div');
altBox.style.cssText = 'position:fixed;right:18px;bottom:18px;padding:6px 12px;background:#0007;color:#fff;font:14px sans-serif;border-radius:8px;z-index:5;display:none';
document.body.appendChild(altBox);
// Chỉ báo trạng thái: đang tha xác, ngộ độc
const stateBox = document.createElement('div');
stateBox.style.cssText = 'position:fixed;right:18px;bottom:60px;padding:6px 12px;background:#0007;color:#fff;font:14px sans-serif;border-radius:8px;z-index:5;display:none;text-align:right;line-height:1.5';
document.body.appendChild(stateBox);
const setBar = (k, v) => {
  const b = bars[k];
  v = Math.max(0, Math.min(1, v));
  b.fill.style.width = `${v * 100}%`;
  b.val.textContent = `${Math.round(v * 100)}%`;
  // Tăng (ăn/uống/hồi máu): nháy sáng và hiện +x% một lúc để dễ thấy
  if (b.prev !== null && v > b.prev + 0.004) {
    b.fill.style.filter = 'brightness(1.9)';
    b.delta.textContent = `+${Math.max(1, Math.round((v - b.prev) * 100))}%`;
    clearTimeout(b.timer);
    b.timer = setTimeout(() => { b.fill.style.filter = ''; b.delta.textContent = ''; }, 900);
  }
  b.prev = v;
};

// Thông báo ngắn giữa màn hình (vd khi bấm E mà không có nước/xác)
const toast = document.createElement('div');
toast.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);padding:8px 14px;background:#000a;color:#fff;font:14px sans-serif;border-radius:8px;z-index:6;display:none;max-width:70vw;text-align:center';
document.body.appendChild(toast);
let toastTimer = 0;
function showToast(msg) {
  toast.textContent = msg; toast.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// ---- Three.js ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
// ?px=0.3: giảm độ phân giải vẽ (dùng khi kiểm thử bằng trình duyệt headless chạy phần mềm, quá chậm ở độ phân giải đầy đủ)
renderer.setPixelRatio(+new URLSearchParams(location.search).get('px') || Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
createTerrain(scene);
createBridge(scene);
const flora = createFlora(scene);
createSky(scene);

// ---- Âm thanh (tổng hợp bằng Web Audio, không dùng file) ----
const audio = createAudio();
const wakeAudio = () => audio.resume(); // trình duyệt chỉ cho phát âm thanh sau một cử chỉ của người dùng
addEventListener('pointerdown', wakeAudio);
addEventListener('keydown', wakeAudio);

// Loại âm kêu đau/chết theo con vật
const VOICE_KIND = { chicken: 'chicken', rabbit: 'rabbit', mouse: 'mouse', bird: 'bird', dino: 'dino' };
const roarKind = (species) => (SPECIES[species]?.flight ? 'pterosaur' : SPECIES[species]?.diet === 'herbivore' ? 'herbivore' : 'carnivore');

/** Xử lý sự kiện một lần từ server (snapshot.ev): gầm, cắn, chết, hạ cánh... */
function handleEvent(e) {
  const at = { x: e.x, z: e.z, y: e.y ?? groundAt(e.x, e.z) + 0.5 };
  switch (e.kind) {
    case 'roar': audio.play('roar', { ...at, size: e.size || 3, kind: roarKind(e.species) }); break;
    case 'bite': audio.play('bite', { ...at, size: e.size || 1, kind: e.victim }); break;
    case 'miss': audio.play('miss', { ...at, size: e.size || 1 }); break;
    case 'npc_hurt': audio.play('hurt', { ...at, kind: VOICE_KIND[e.victim] || 'dino' }); break;
    case 'npc_die': audio.play('die', { ...at, kind: VOICE_KIND[e.victim] || 'dino', size: 0.3 }); break;
    case 'player_hurt': audio.play('hurt', { ...at, kind: 'dino', size: SPECIES[e.species]?.bodyLength || 3 }); break;
    case 'land': audio.play('thud', { ...at, size: e.size || 2 }); break;
    case 'takeoff': audio.play('wing_whoosh', { ...at, size: e.size || 2 }); break;
    default: break;
  }
}

/** Nền đất dưới chân để chọn tiếng bước chân. */
function surfaceAt(x, z) {
  const h = heightAt(x, z), g = groundAt(x, z);
  if (g > h + 0.3) return 'wood';       // đang trên cầu
  if (h < WATER_LEVEL + 0.35) return 'water';
  if (h < 3) return 'sand';
  if (h > 14) return 'rock';
  return 'grass';
}

// ---- Trạng thái ----
let ws, myId = null, yaw = 0, pitch = 0.22, seq = 0, zoomMul = 1;
const keys = {};
const ents = new Map();     // khủng long (người chơi)
const npcEnts = new Map();  // con mồi NPC
const carcEnts = new Map(); // xác (con mồi và khủng long đã chết)
const UP = new THREE.Vector3(0, 1, 0), FWD_Z = new THREE.Vector3(0, 0, 1), RIGHT_X = new THREE.Vector3(1, 0, 0);
const qPitch = new THREE.Quaternion();

function addEntity(p) {
  const dino = createCreature(p.species, p.colors);
  scene.add(dino.group);
  const e = {
    dino, species: p.species,
    pos: new THREE.Vector3(p.x, p.y, p.z), yawNow: p.yaw, scaleNow: STAGE_SCALE[p.stage] || 0.25,
    speed01: 0, tilt: new THREE.Quaternion(), roll: 0, pitch: 0, altNow: p.alt || 0, t: p,
    stepAcc: 0, flapT: 0, feedT: 0,
  };
  ents.set(p.id, e);
  return e;
}
function removeEntity(id) {
  const e = ents.get(id);
  if (!e) return;
  scene.remove(e.dino.group);
  e.dino.dispose();
  ents.delete(id);
}

function addNpc(n) {
  const animal = createAnimal(n.kind);
  scene.add(animal.group);
  const e = { animal, kind: n.kind, pos: new THREE.Vector3(n.x, n.y, n.z), yawNow: n.yaw, speed01: 0, t: n };
  npcEnts.set(n.id, e);
  return e;
}
function removeNpc(id) {
  const e = npcEnts.get(id);
  if (!e) return;
  scene.remove(e.animal.group);
  e.animal.dispose();
  npcEnts.delete(id);
}

const ROT_COLOR = new THREE.Color(0x6d7a3f); // xanh xám thối rữa

function addCarcass(c) {
  const creature = c.type === 'dino' ? createCreature(c.kind, c.colors) : createAnimal(c.kind);
  scene.add(creature.group);
  // Mỗi xác có vật liệu riêng (nhân bản) để đổi màu theo độ thối mà không ảnh hưởng con khác cùng loài
  const mats = [];
  creature.group.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.color) return;
    o.material = o.material.clone();
    mats.push({ m: o.material, base: o.material.color.clone() });
  });
  const e = {
    creature, mats, c, pos: new THREE.Vector3(c.x, c.y, c.z), yawNow: c.yaw,
    baseScale: c.type === 'dino' ? (STAGE_SCALE[c.stage] || 1) : 1, rot: c.rot, meat: c.meat01,
  };
  carcEnts.set(c.id, e);
  return e;
}
function removeCarcass(id) {
  const e = carcEnts.get(id);
  if (!e) return;
  scene.remove(e.creature.group);
  e.creature.dispose();
  for (const x of e.mats) x.m.dispose();
  carcEnts.delete(id);
}

function applySnapshot(m) {
  const seen = new Set();
  for (const p of m.players) {
    seen.add(p.id);
    const e = ents.get(p.id) || addEntity(p);
    e.t = p; // mục tiêu mới; vị trí hiển thị sẽ nội suy tới đây mỗi khung hình
  }
  for (const id of [...ents.keys()]) if (!seen.has(id)) removeEntity(id);

  const seenN = new Set();
  for (const n of m.npcs || []) {
    seenN.add(n.id);
    const e = npcEnts.get(n.id) || addNpc(n);
    e.t = n;
  }
  for (const id of [...npcEnts.keys()]) if (!seenN.has(id)) removeNpc(id);

  const seenC = new Set();
  for (const c of m.carcasses || []) {
    seenC.add(c.id);
    (carcEnts.get(c.id) || addCarcass(c)).c = c;
  }
  for (const id of [...carcEnts.keys()]) if (!seenC.has(id) && !carcEnts.get(id).debug) removeCarcass(id); // debug: xác mẫu do kiểm thử tạo, giữ lại

  if (m.you) {
    setBar('hp', m.you.hp / m.you.maxHp);
    setBar('hunger', m.you.hunger);
    setBar('thirst', m.you.thirst);
    setBar('stamina', m.you.stamina);
    setBar('growth', m.you.growth01);
    altBox.style.display = m.you.flying ? 'block' : 'none';
    if (m.you.flying) altBox.textContent = `Độ cao ${Math.round(m.you.alt)} m`;
    const tags = [];
    if (m.you.carrying) tags.push('🍖 Đang tha xác (G để thả)');
    if (m.you.poisoned) tags.push('<span style="color:#9f6">☠ Ngộ độc thịt thối</span>');
    stateBox.innerHTML = tags.join('<br>');
    stateBox.style.display = tags.length ? 'block' : 'none';
  }
}

function showMenu(msg) {
  hud.style.display = 'none';
  menu.classList.remove('hidden');
  let note = document.getElementById('note');
  if (!note) { note = document.createElement('div'); note.id = 'note'; menu.prepend(note); }
  note.textContent = msg || '';
  if (document.pointerLockElement) document.exitPointerLock();
}

document.getElementById('play').onclick = () => {
  audio.resume(); audio.play('ui_click');
  if (ws) ws.close();
  for (const id of [...ents.keys()]) removeEntity(id);
  for (const id of [...npcEnts.keys()]) removeNpc(id);
  for (const id of [...carcEnts.keys()]) removeCarcass(id);
  myId = null;
  ws = new WebSocket(`ws://${location.hostname}:${SERVER_PORT}`);
  store.set('isle.name', nameInput.value);
  ws.onopen = () => ws.send(encode({ t: C2S.JOIN, name: nameInput.value || 'dino', species: sel.value, colors: colorsToSend() }));
  ws.onclose = () => { if (myId != null) { myId = null; showMenu('Mất kết nối server'); } };
  ws.onmessage = (e) => {
    const m = decode(e.data);
    if (!m) return;
    if (m.t === S2C.WELCOME) { myId = m.id; menu.classList.add('hidden'); hud.style.display = 'block'; }
    else if (m.t === S2C.SNAPSHOT) { applySnapshot(m); for (const ev of m.ev || []) handleEvent(ev); }
    else if (m.t === S2C.DEAD) {
      myId = null;
      showMenu(m.cause === 'starvation' ? 'Bạn đã chết vì đói hoặc khát' : m.cause === 'poison' ? 'Bạn đã chết vì ngộ độc thịt thối' : m.cause === 'killed' ? `Bạn bị ${m.by || 'một con khác'} giết` : 'Bạn đã chết vì vết thương');
    } else if (m.t === S2C.NOTICE) { showToast(m.msg); audio.play('notice'); }
    else if (m.t === S2C.ERROR) showMenu(m.msg);
  };
};

// ---- Input ----
const send = (o) => { if (ws && ws.readyState === 1 && myId != null) ws.send(encode(o)); };
let sleeping = false;
addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault(); // không cuộn trang khi bay lên
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyE') send({ t: C2S.INTERACT });
  if (e.code === 'KeyF') send({ t: C2S.ATTACK });
  if (e.code === 'KeyC') { sleeping = !sleeping; send({ t: C2S.SLEEP, on: sleeping }); }
  if (e.code === 'KeyR') send({ t: C2S.ROAR });
  if (e.code === 'KeyG') send({ t: C2S.GRAB });
  if (e.code === 'KeyM') showToast(audio.toggleMute() ? 'Đã tắt âm thanh (M để bật)' : 'Đã bật âm thanh');
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  yaw -= e.movementX * 0.002;
  pitch = Math.max(-0.15, Math.min(1.1, pitch + e.movementY * 0.002));
});
let mouseHeld = false;
addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement) { mouseHeld = true; send({ t: C2S.ATTACK }); } });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; });
addEventListener('wheel', (e) => { zoomMul = Math.max(0.5, Math.min(2.5, zoomMul * (e.deltaY > 0 ? 1.1 : 1 / 1.1))); }, { passive: true });
renderer.domElement.addEventListener('click', () => { if (!document.pointerLockElement) renderer.domElement.requestPointerLock(); });

// Giữ E để ăn/uống liên tục (mỗi ngụm/miếng cắn có hồi chiêu ở server)
setInterval(() => {
  if (keys.KeyE) send({ t: C2S.INTERACT });
  if (keys.KeyF || mouseHeld) send({ t: C2S.ATTACK }); // giữ chuột/F để cắn liên tục (cũng là ăn khi đứng cạnh xác)
}, 250);

setInterval(() => {
  send({
    t: C2S.INPUT, seq: ++seq, yaw,
    mx: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    mz: (keys.KeyW ? -1 : 0) + (keys.KeyS ? 1 : 0),
    sprint: !!keys.ShiftLeft,
    up: (keys.Space ? 1 : 0) - (keys.ControlLeft || keys.KeyX ? 1 : 0), // loài bay: Space bay lên/cất cánh, Ctrl (hoặc X) hạ xuống
  });
}, 50);

// Tham số debug cho kiểm thử tự động: ?auto=<loài> tự vào game, &walk=1 tự đi tới, &sprint=1 chạy
const q = new URLSearchParams(location.search);
if (q.get('auto')) {
  sel.value = q.get('auto');
  if (q.get('walk')) keys.KeyW = true;
  if (q.get('sprint')) keys.ShiftLeft = true;
  if (q.get('fly')) keys.Space = true; // loài bay: tự giữ Space để cất cánh
  if (q.get('yaw')) yaw = +q.get('yaw');
  if (q.get('body')) colorMemo[sel.value] = { body: '#' + q.get('body'), accent: '#' + (q.get('accent') || q.get('body')) }; // debug: ?body=ff0000&accent=000000
  if (q.get('zoom')) zoomMul = +q.get('zoom');
  document.getElementById('play').click();
}

// Cổng debug cho kiểm thử tự động (đọc trạng thái từ trình duyệt headless)
window.__game = { keys, addCarcass, groundAt, audio, get cam() { return camera.position.toArray(); }, get carcs() { return [...carcEnts.values()].map((e) => ({ id: e.c.id, pos: e.creature.group.position.toArray().map((v) => +v.toFixed(1)), scale: e.creature.group.scale.toArray().map((v) => +v.toFixed(2)), attached: !!e.creature.group.parent, kids: e.creature.group.children.length })); }, get yaw() { return yaw; }, get myId() { return myId; }, get me() { const e = ents.get(myId); return e && { species: e.species, fly: e.t.fly, alt: e.t.alt, anim: e.t.anim, x: e.t.x, y: e.t.y, z: e.t.z }; }, get sent() { return seq; } };

// ---- Vòng lặp vẽ ----
const clock = new THREE.Clock();
const camDir = new THREE.Vector3();
const qYaw = new THREE.Quaternion(), qTarget = new THREE.Quaternion(), qRoll = new THREE.Quaternion(), normal = new THREE.Vector3();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camInit = false, camDist = 0;
const damp = (k, dt) => 1 - Math.exp(-k * dt); // hệ số nội suy không phụ thuộc FPS
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angleLerp = (a, b, t) => a + wrap(b - a) * t;

/** Âm thanh suy ra từ chuyển động/trạng thái hiển thị: bước chân, vỗ cánh, nhai, uống. */
function entitySounds(e, dt, v, flying) {
  const sp = SPECIES[e.species];
  const size = sp.bodyLength * e.scaleNow;
  const at = { x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z };
  const anim = e.t.anim;
  // Bước chân: cứ đi được một sải thì một tiếng (con to sải dài, tiếng trầm nặng)
  if (!flying && v > 0.6) {
    e.stepAcc += v * dt;
    const stride = Math.min(4.5, Math.max(0.3, size * 0.42));
    if (e.stepAcc >= stride) {
      e.stepAcc = 0;
      audio.play('step', { ...at, size, intensity: Math.min(1, 0.35 + e.speed01), surface: surfaceAt(e.pos.x, e.pos.z) });
    }
  } else e.stepAcc = Math.min(e.stepAcc, 0.1);
  // Vỗ cánh: nhịp nhanh hơn khi bay nhanh
  if (flying && anim === 'fly') {
    e.flapT -= dt;
    if (e.flapT <= 0) { e.flapT = 0.62 / (0.7 + e.speed01); audio.play('flap', { ...at, size }); }
  }
  // Ăn / uống
  if (anim === 'eat' || anim === 'drink') {
    e.feedT -= dt;
    if (e.feedT <= 0) {
      if (anim === 'drink') { e.feedT = 0.42; audio.play(Math.random() < 0.3 ? 'gulp' : 'slurp', { ...at, size }); }
      else { e.feedT = 0.42; audio.play(sp.diet === 'carnivore' ? 'chew' : 'crunch', { ...at, size }); }
    }
  } else e.feedT = 0;
}

function updateEntities(dt) {
  for (const e of ents.values()) {
    const t = e.t;
    const px = e.pos.x, pz = e.pos.z, pyaw = e.yawNow;
    // Nội suy vị trí về mục tiêu từ server (20 Hz) cho mượt ở 60+ FPS
    e.pos.x += (t.x - e.pos.x) * damp(14, dt);
    e.pos.z += (t.z - e.pos.z) * damp(14, dt);
    const flying = !!t.fly;
    const prevAlt = e.altNow;
    e.altNow += ((t.alt || 0) - e.altNow) * damp(10, dt); // độ cao khi bay (0 khi đứng đất)
    e.pos.y = groundAt(e.pos.x, e.pos.z) + e.altNow;      // bám mặt đất (địa hình hoặc mặt cầu) + độ cao bay
    e.yawNow = angleLerp(e.yawNow, t.yaw, damp(12, dt));
    e.scaleNow += ((STAGE_SCALE[t.stage] || 0.25) - e.scaleNow) * damp(2, dt);

    // Tốc độ thực tế để chỉnh nhịp chân / nhịp đập cánh
    const sp = SPECIES[e.species];
    const v = Math.hypot(e.pos.x - px, e.pos.z - pz) / Math.max(dt, 1e-4);
    const vmax = (flying ? sp.flight.sprintSpeed : sp.sprintSpeed) * (0.5 + 0.5 * e.scaleNow);
    e.speed01 += (Math.min(1, v / vmax) - e.speed01) * damp(8, dt);
    entitySounds(e, dt, v, flying);

    // Nghiêng thân theo độ dốc mặt đất (không nghiêng quá 25 độ); đang bay thì không bám dốc
    if (flying) qTarget.identity();
    else {
      const h = 1.5;
      normal.set(groundAt(e.pos.x - h, e.pos.z) - groundAt(e.pos.x + h, e.pos.z), 2 * h, groundAt(e.pos.x, e.pos.z - h) - groundAt(e.pos.x, e.pos.z + h)).normalize();
      if (normal.y < Math.cos(0.44)) { normal.y = Math.cos(0.44); normal.normalize(); }
      qTarget.setFromUnitVectors(UP, normal);
    }
    e.tilt.slerp(qTarget, damp(6, dt));
    qYaw.setFromAxisAngle(UP, e.yawNow);

    // Nghiêng người vào phía trong khi quẹo (càng nhanh, quẹo càng gắt càng nghiêng; loài bay nghiêng mạnh hơn)
    const yawRate = wrap(e.yawNow - pyaw) / Math.max(dt, 1e-4);
    const rollMax = flying ? 0.7 : 0.28, rollGain = flying ? 0.32 : 0.13;
    const rollTarget = Math.max(-rollMax, Math.min(rollMax, yawRate * e.speed01 * rollGain));
    e.roll += (rollTarget - e.roll) * damp(7, dt);
    qRoll.setFromAxisAngle(FWD_Z, e.roll);

    // Chúc mũi lên khi bay lên, chúi xuống khi hạ độ cao
    const vy = (e.altNow - prevAlt) / Math.max(dt, 1e-4);
    const pitchTarget = flying ? Math.max(-0.6, Math.min(0.6, Math.atan2(vy, Math.max(v, 6)) * 0.8)) : 0;
    e.pitch += (pitchTarget - e.pitch) * damp(5, dt);
    qPitch.setFromAxisAngle(RIGHT_X, e.pitch);

    const g = e.dino.group;
    g.position.copy(e.pos);
    g.quaternion.copy(e.tilt).multiply(qYaw).multiply(qPitch).multiply(qRoll);
    g.scale.setScalar(Math.max(0.05, e.scaleNow));
    e.dino.update(dt, t.anim, e.speed01);
  }

  for (const e of npcEnts.values()) {
    const t = e.t, def = NPC_KINDS[e.kind];
    const px = e.pos.x, pz = e.pos.z;
    e.pos.x += (t.x - e.pos.x) * damp(14, dt);
    e.pos.z += (t.z - e.pos.z) * damp(14, dt);
    e.pos.y += (t.y - e.pos.y) * damp(14, dt); // y từ server đã gồm độ cao khi bay
    e.yawNow = angleLerp(e.yawNow, t.yaw, damp(12, dt));
    const v = Math.hypot(e.pos.x - px, e.pos.z - pz) / Math.max(dt, 1e-4);
    e.speed01 += (Math.min(1, v / (def.flies ? def.fly : def.run)) - e.speed01) * damp(8, dt);
    const g = e.animal.group;
    g.position.copy(e.pos);
    g.rotation.y = e.yawNow;
    e.animal.update(dt, t.anim, e.speed01);
  }
}

/** Xác: nội suy vị trí, nằm bất động, đổi màu và xẹp dần khi thối, co lại khi bị ăn, chìm xuống đất khi sắp biến mất. */
function updateCarcasses(dt) {
  for (const e of carcEnts.values()) {
    const c = e.c;
    e.pos.x += (c.x - e.pos.x) * damp(14, dt);
    e.pos.z += (c.z - e.pos.z) * damp(14, dt);
    e.pos.y += (c.y - e.pos.y) * damp(14, dt);
    e.yawNow = angleLerp(e.yawNow, c.yaw, damp(10, dt));
    e.rot += (c.rot - e.rot) * damp(1, dt);
    e.meat += (c.meat01 - e.meat) * damp(4, dt);
    const g = e.creature.group;
    const s = e.baseScale * (0.45 + 0.55 * e.meat);         // bị ăn thì nhỏ dần
    g.position.set(e.pos.x, e.pos.y - e.rot * 0.25 * s, e.pos.z); // thối nhiều thì lún xuống đất
    g.rotation.set(0, e.yawNow, c.carried && c.mode === 'mouth' ? 0.35 : 0);
    g.scale.set(s, s * (1 - 0.3 * e.rot), s);                 // xẹp dần khi thối
    const k = Math.min(1, e.rot * 0.85);
    for (const x of e.mats) x.m.color.copy(x.base).lerp(ROT_COLOR, k);
    e.creature.update(dt, 'dead', 0);
  }
}

let npcVoiceT = 0;
/** Mỗi nửa giây chọn ngẫu nhiên một con mồi ở gần để kêu (gà cục tác, chim hót, chuột chít, thỏ thình thịch). */
function npcVoices(dt) {
  npcVoiceT -= dt;
  if (npcVoiceT > 0 || !npcEnts.size) return;
  npcVoiceT = 0.5;
  const list = [...npcEnts.values()];
  const e = list[Math.floor(Math.random() * list.length)];
  if (!e || e.t.anim === 'dead') return;
  const at = { x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z };
  const run = e.t.anim === 'run';
  if (e.kind === 'chicken' && Math.random() < 0.18) audio.play('cluck', at);
  else if (e.kind === 'bird' && Math.random() < (e.t.anim === 'fly' ? 0.1 : 0.25)) audio.play('peep', at);
  else if (e.kind === 'mouse' && run && Math.random() < 0.5) audio.play('squeak', at);
  else if (e.kind === 'rabbit' && run && Math.random() < 0.6) audio.play('rabbit_thump', at);
}

/** Môi trường quanh người nghe để điều khiển âm thanh nền (gió, sóng, rừng). */
let envT = 0, envCache = { waterProx: 0, forest: 0, wind: 0.2, altitude: 0, speed: 0, underwater: false };
function updateAmbient(dt) {
  envT -= dt;
  if (envT > 0) return;
  envT = 0.25;
  const c = camera.position;
  // Gần nước: tỉ lệ điểm là nước trong hai vòng quanh người nghe
  let water = 0, n = 0;
  for (const rad of [12, 30, 60]) for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (heightAt(c.x + Math.cos(a) * rad, c.z + Math.sin(a) * rad) < WATER_LEVEL) water += 1 / (1 + rad / 25);
    n += 1 / (1 + rad / 25);
  }
  // Rừng: đếm cây trong 35 m
  let trees = 0;
  for (const p of world.plants) { if (Math.abs(p.x - c.x) < 35 && Math.abs(p.z - c.z) < 35 && p.kind !== 'bush' && p.kind !== 'fern') trees++; }
  const me = ents.get(myId);
  const alt = me ? me.altNow : Math.max(0, c.y - groundAt(c.x, c.z));
  envCache = {
    waterProx: Math.min(1, (water / n) * 2.2),
    forest: Math.min(1, trees / 40),
    wind: 0.25 + Math.min(0.6, alt / 60),
    altitude: alt,
    speed: me ? me.speed01 : 0,
    underwater: c.y < WATER_LEVEL - 0.1,
  };
}

const world = getWorld();
/** Tỉ lệ 0..1 đoạn từ focus tới want không bị cây/đá chắn (1 = thoáng hoàn toàn). */
function clearDistance(focus, want) {
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = focus.x + (want.x - focus.x) * t, z = focus.z + (want.z - focus.z) * t, y = focus.y + (want.y - focus.y) * t;
    for (const o of world.nearby(x, z, 1)) {
      const top = o.y + (o.h || o.hgt || 2); // chiều cao cây hoặc đá
      if (y < top && Math.hypot(x - o.x, z - o.z) < o.r + 0.4) return Math.max(0, (i - 1.5) / steps);
    }
  }
  return 1;
}

/**
 * Camera tỉ lệ theo kích thước nhân vật: nhỏ thì sát lại, lớn lên thì lùi ra,
 * nên nhân vật luôn chiếm cỡ tương đương trên màn hình (cuộn chuột để chỉnh).
 */
function updateCamera(dt) {
  // Debug (?cam=bridge | bridgeside): xem cây cầu từ đầu cầu hoặc từ bên hông
  const br = world.bridge;
  if (br && (q.get('cam') === 'bridge' || q.get('cam') === 'bridgeside')) {
    const at = (s, lat, up) => new THREE.Vector3(br.ax + br.dx * s + br.nx * lat, br.deckY(Math.min(1, Math.max(0, s / br.len))) + up, br.az + br.dz * s + br.nz * lat);
    if (q.get('cam') === 'bridge') { camera.position.copy(at(-16, 3, 7)); camera.lookAt(at(br.len * 0.55, 0, 0)); }
    else { camera.position.copy(at(br.len * 0.5, 30, 9)); camera.lookAt(at(br.len * 0.5, 0, 1)); }
    return;
  }
  // Debug (?cam=npc): nhìn cận con mồi gần người chơi nhất, để kiểm tra hình dáng/kích thước thật
  if (q.get('cam') === 'npc' && npcEnts.size) {
    const me0 = ents.get(myId);
    let best = null, bd = Infinity;
    for (const n of npcEnts.values()) {
      if (n.kind === 'bird' && n.t.anim === 'fly') continue;
      const d = me0 ? Math.hypot(n.pos.x - me0.pos.x, n.pos.z - me0.pos.z) : 0;
      if (d < bd) { bd = d; best = n; }
    }
    if (best) {
      const s = NPC_KINDS[best.kind].bodyLength;
      camera.position.set(best.pos.x + s * 1.6, best.pos.y + s * 0.8, best.pos.z + s * 1.6);
      camera.lookAt(best.pos.x, best.pos.y + s * 0.3, best.pos.z);
      return;
    }
  }
  const me = ents.get(myId);
  if (!me) {
    camera.position.set(0, 120, 220); camera.lookAt(0, 0, 0); camInit = false;
    return;
  }
  const size = Math.max(0.3, SPECIES[me.species].bodyLength * me.scaleNow); // chiều dài thân hiện tại (m)
  const wantDist = (size * 1.15 + 0.9) * zoomMul * (me.t.fly ? 1.5 : 1); // đang bay: lùi xa hơn để thấy sải cánh
  camDist = camInit ? camDist + (wantDist - camDist) * damp(5, dt) : wantDist;
  const focus = new THREE.Vector3(me.pos.x, me.pos.y + size * 0.3 + 0.25, me.pos.z);
  const want = new THREE.Vector3(
    focus.x + Math.sin(yaw) * Math.cos(pitch) * camDist,
    focus.y + Math.sin(pitch) * camDist + size * 0.1,
    focus.z + Math.cos(yaw) * Math.cos(pitch) * camDist,
  );
  // Camera không bị cây/đá che: kéo lại gần nếu có vật cản trên đường nhìn
  const clear = clearDistance(focus, want);
  if (clear < 1) want.lerpVectors(focus, want, Math.max(0.3, clear));
  // Camera không chui xuống đất
  want.y = Math.max(want.y, groundAt(want.x, want.z) + 0.25 + size * 0.15);
  if (!camInit) { camPos.copy(want); camLook.copy(focus); camInit = true; }
  camPos.lerp(want, damp(me.t.fly ? 18 : 10, dt));
  camLook.lerp(focus, damp(me.t.fly ? 24 : 14, dt));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  updateEntities(dt);
  updateCarcasses(dt);
  updateCamera(dt);
  npcVoices(dt);
  updateAmbient(dt);
  camera.getWorldDirection(camDir);
  audio.setListener(camera.position, Math.atan2(-camDir.x, -camDir.z));
  audio.update(dt, envCache);
  flora.update(performance.now() / 1000, camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
window.__game.renderInfo = () => ({ ...renderer.info.render, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length, dpr: renderer.getPixelRatio(), ents: ents.size });
window.__game.sceneStats = () => { const out = {}; scene.traverse((o) => { if (!o.isMesh) return; const g = o.geometry; const tri = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); const k = o.isInstancedMesh ? 'instanced' : (o.isSkinnedMesh ? 'skinned' : 'mesh'); const s = out[k] || (out[k] = { meshes: 0, tris: 0 }); s.meshes++; s.tris += tri; if (o.isInstancedMesh) { (out.top ||= []).push([o.count, Math.round(tri)]); } }); if (out.top) out.top = out.top.sort((a, b) => b[1] - a[1]).slice(0, 6); return out; };
