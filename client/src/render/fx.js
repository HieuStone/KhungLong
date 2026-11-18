// Hiệu ứng nhỏ: bụi tung lên khi bàn chân khủng long lớn dậm xuống đất (màu theo nền: cát/đất/cỏ).
import * as THREE from 'three';

function puffTexture() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  // vài đốm mờ chồng nhau cho đám bụi không tròn xoe
  for (let i = 0; i < 6; i++) {
    const px = S / 2 + (Math.random() - 0.5) * S * 0.35, py = S / 2 + (Math.random() - 0.5) * S * 0.25, r = S * (0.22 + Math.random() * 0.16);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DUST = { sand: 0xc8b48c, grass: 0x8a7d5c, rock: 0x8c8780, water: 0xdfe8ee, wood: 0x9a8a70 };

export function createFx(scene, max = 48) {
  const tex = puffTexture();
  const pool = [];
  for (let i = 0; i < max; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    pool.push({ s, t: 0, life: 1, vx: 0, vy: 0, vz: 0, size: 1 });
  }
  let next = 0;
  return {
    /** Bụi tại (x,y,z); size = cỡ khủng long (m); surface: 'sand'|'grass'|'rock'|'water'|'wood'. */
    dust(x, y, z, size, surface = 'grass', strength = 1) {
      const n = size > 6 ? 4 : 3;
      for (let k = 0; k < n; k++) {
        const p = pool[next]; next = (next + 1) % pool.length;
        const a = Math.random() * Math.PI * 2, sp = (0.4 + Math.random() * 0.6) * Math.sqrt(size) * 0.35;
        p.s.position.set(x + Math.cos(a) * size * 0.04, y + 0.05, z + Math.sin(a) * size * 0.04);
        p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 0.15 + Math.random() * 0.25;
        p.size = size * (0.09 + Math.random() * 0.06); p.t = 0; p.life = 1.1 + Math.random() * 0.7;
        p.s.material.color.set(DUST[surface] || DUST.grass);
        p.strength = (surface === 'grass' ? 0.45 : 0.75) * strength;
        p.s.visible = true;
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.t += dt;
        const k = p.t / p.life;
        if (k >= 1) { p.s.visible = false; continue; }
        p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
        p.vx *= 0.94; p.vz *= 0.94;
        const sc = p.size * (0.6 + k * 1.8);
        p.s.scale.set(sc, sc * 0.7, 1);
        p.s.material.opacity = p.strength * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
      }
    },
  };
}
