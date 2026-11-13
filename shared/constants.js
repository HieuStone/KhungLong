// Hằng số dùng chung client/server. KHÔNG sửa khi chưa được Claude duyệt.
export const SERVER_PORT = +(globalThis.process?.env?.ISLE_PORT || 8080);
export const TICK_RATE = 20;              // tick/giây
export const TICK_DT = 1 / TICK_RATE;
export const WORLD_SIZE = 1000;           // mét, bản đồ vuông [-500, 500]
export const WORLD_HALF = WORLD_SIZE / 2;
export const WORLD_SEED = 1337;
export const WATER_LEVEL = 0;             // y <= WATER_LEVEL là nước
export const MAX_PLAYERS = 32;

export const GROWTH_STAGES = ['hatchling', 'juvenile', 'subadult', 'adult'];
// Hệ số scale / stats theo giai đoạn lớn
export const STAGE_SCALE = { hatchling: 0.25, juvenile: 0.5, subadult: 0.75, adult: 1.0 };
