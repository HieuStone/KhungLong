// Dữ liệu loài. Giá trị là của bản trưởng thành (adult); stats thực = giá trị * STAGE_SCALE[stage] (xem task T05).
// diet: 'carnivore' | 'herbivore'
export const SPECIES = {
  tyrannosaurus: {
    name: 'Tyrannosaurus', diet: 'carnivore',
    health: 1000, speed: 9, sprintSpeed: 15, stamina: 100, bodyLength: 12,
    attacks: { bite: { damage: 60, range: 4, cooldown: 1.5, staminaCost: 15, bleed: 2 } },
    hungerRate: 0.35, thirstRate: 0.45, packSize: 2,
  },
  utahraptor: {
    name: 'Utahraptor', diet: 'carnivore',
    health: 350, speed: 12, sprintSpeed: 20, stamina: 100, bodyLength: 5,
    attacks: { slash: { damage: 20, range: 2.5, cooldown: 0.8, staminaCost: 8, bleed: 3 } },
    hungerRate: 0.45, thirstRate: 0.5, packSize: 6,
  },
  triceratops: {
    name: 'Triceratops', diet: 'herbivore',
    health: 900, speed: 7, sprintSpeed: 12, stamina: 120, bodyLength: 9,
    attacks: { horn: { damage: 45, range: 3.5, cooldown: 1.6, staminaCost: 14, bleed: 1 } },
    hungerRate: 0.3, thirstRate: 0.4, packSize: 5,
  },
  // Khủng long bay (thằn lằn cánh). Đi bộ vụng về trên đất, bay nhanh. `flight` bật cơ chế bay (Space bay lên, Ctrl hạ xuống).
  pteranodon: {
    name: 'Pteranodon', diet: 'carnivore',
    health: 220, speed: 5, sprintSpeed: 8, stamina: 100, bodyLength: 4.5, // bodyLength: mũi -> đuôi; sải cánh ~ 1.7 x
    attacks: { beak: { damage: 18, range: 2.4, cooldown: 0.9, staminaCost: 8, bleed: 1 } },
    hungerRate: 0.45, thirstRate: 0.5, packSize: 4,
    flight: { speed: 20, sprintSpeed: 32, maxAlt: 90, climb: 9, descend: 13, turn: 2.6 },
  },
  dryosaurus: {
    name: 'Dryosaurus', diet: 'herbivore',
    health: 120, speed: 11, sprintSpeed: 19, stamina: 90, bodyLength: 3,
    attacks: { kick: { damage: 6, range: 1.5, cooldown: 1.0, staminaCost: 6, bleed: 0 } },
    hungerRate: 0.5, thirstRate: 0.55, packSize: 10,
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);
