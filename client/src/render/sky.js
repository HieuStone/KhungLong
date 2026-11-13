import * as THREE from 'three';

const SKY_COLOR = 0x87ceeb;

/** Bầu trời (màu nền + sương mù cùng màu) và mặt trời hướng cố định. */
export function createSky(scene) {
  scene.background = new THREE.Color(SKY_COLOR);
  // Sương mù che mép xa, giấu chỗ bản đồ kết thúc
  scene.fog = new THREE.Fog(SKY_COLOR, 120, 440);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(300, 400, 200); // hướng cố định, chiếu về gốc (0,0,0)
  scene.add(sun);
  return sun;
}
