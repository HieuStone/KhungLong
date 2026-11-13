// Cấu hình GỐC CỐ ĐỊNH dành riêng cho test (giá trị mặc định ban đầu của game).
// Test dùng bản này thay vì server/game.config.js để việc bạn tự chỉnh cấu hình KHÔNG làm test fail.
export const BASELINE = {
  npcDinos: {
    enabled: true,
    counts: { tyrannosaurus: 2, utahraptor: 5, triceratops: 4, dryosaurus: 8, pteranodon: 3 },
    spawnStage: { min: 'hatchling', max: 'adult' },
    maxStage: 'adult',
    growthSpeedMultiplier: 1.0,
    respawnDelay: 60,
    minSpawnDistanceFromPlayers: 80,
    nameSuffix: ' (NPC)',
  },
  predation: {
    huntPlayers: 0.5, huntDinos: 0.6, huntPrey: 1.0,
    cannibalism: false,
    minTargetSizeRatio: 0.2, maxTargetSizeRatio: 1.2,
    aggroRange: 60, loseInterestRange: 110, huntGiveUpSeconds: 40, huntBelowHunger: 0.65, aggroRollSeconds: 20,
    newPlayerProtectionSeconds: 30,
    provokedAlwaysFights: true,
    herbivoresFleeFromPredators: true, herbivoresFightBack: true, fearRange: 45,
    packHunting: true, packRange: 50,
    attackDamageMultiplier: 1.0, speedMultiplier: 1.0,
  },
  carcass: {
    freshSeconds: 120, rotSeconds: 180, sizeLifetimeFactor: 1,
    meatPerSquareMeter: 0.08, poisonChanceWhenRotten: 0.6, poisonSeconds: 20, poisonDamagePerSecond: 0.006,
    rottenMeatNutritionLoss: 0.6,
    canDrag: true, carryInMouthMaxSizeRatio: 0.4, maxDragMassRatio: 1.2,
  },
  ai: { thinkInterval: 0.25, roamRadius: 160, roarBeforeHunt: 0.35 },
};
