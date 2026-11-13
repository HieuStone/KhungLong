import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL, heightAt } from '@isle/shared';

// smoothstep: nội suy mượt từ 0 (x<=a) tới 1 (x>=b)
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SAND = new THREE.Color(0xd9c58e);
const GRASS = new THREE.Color(0x4f8a3c);
const ROCK = new THREE.Color(0x7d7d80);

/** Tạo địa hình và mặt nước (cây/đá nằm ở flora.js). Trả về Group đã add vào scene. */
export function createTerrain(scene) {
  const group = new THREE.Group();

  // ---- Địa hình: lưới 200x200 ô, đỉnh y = heightAt(x, z) ----
  // PlaneGeometry nằm trên mặt XY; xoay -90° quanh X để thành mặt XZ.
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    // Màu theo độ cao: cát (gần nước) -> cỏ -> đá (cao), chuyển tiếp mượt
    c.copy(GRASS).lerp(SAND, 1 - ss(1.5, 3, y)).lerp(ROCK, ss(16, 20, y));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  group.add(ground);

  // ---- Mặt nước: phẳng, rộng hơn đảo, xanh trong suốt ----
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3),
    new THREE.MeshLambertMaterial({ color: 0x2a6fa8, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  group.add(water);

  scene.add(group);
  return group;
}
