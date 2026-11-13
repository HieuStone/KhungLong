import { WORLD_SEED, WORLD_HALF } from './constants.js';

// Noise giá trị xác định (deterministic) -> client và server tính ra cùng một độ cao.
function hash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = smooth(x - x0), fz = smooth(z - z0);
  const a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed);
  const c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Noise giá trị 0..1 xác định, dùng chung (vd chia vùng rừng/ẩm). */
export const noise2 = (x, z, seed = WORLD_SEED) => valueNoise(x, z, seed);

/** Độ cao địa hình (mét) tại (x, z). Âm/<=0 là nước. */
export function heightAt(x, z, seed = WORLD_SEED) {
  let h = 0, amp = 1, freq = 1 / 180, norm = 0;
  for (let o = 0; o < 4; o++) {
    h += valueNoise(x * freq, z * freq, seed + o * 101) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  h = h / norm;                        // 0..1
  const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
  const falloff = Math.max(0, edge - 0.75) / 0.25; // đảo: biển ở rìa
  return (h - 0.42) * 60 - falloff * falloff * 40;
}
