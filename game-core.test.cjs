"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./game-core.js");
const JUMP_WINDUP_FRAMES = Math.round(Core.FINAL_BOSS_JUMP_WINDUP * 60);
const JUMP_FLIGHT_FRAMES = Math.round(Core.FINAL_BOSS_JUMP_DURATION * 60);
const JUMP_SLAM_FRAMES = JUMP_WINDUP_FRAMES + JUMP_FLIGHT_FRAMES;

function startedGame(profile = Core.createProfile()) {
  const game = new Core.Game(() => 0.5);
  game.start(profile);
  game.drainEvents();
  return game;
}

function enemyAt(game, x, y, hp = 50) {
  return { x, y, hp, maxHp: hp, radius: 17, speed: 0, damage: 8, type: "drone", color: "#a8d673", contactTimer: 0, hitFlash: 0, angle: 0, wobble: 0 };
}

function chickenEncounter(distance = 60, profile = Core.createProfile()) {
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.random = () => 0.9;
  game.spawnEnemy();
  const chicken = game.enemies[0];
  chicken.x = game.player.x + distance;
  chicken.y = game.player.y;
  chicken.speed = 0;
  game.enemies.push(enemyAt(game, 40, 40, 1000000000));
  game.fireTimer = 100;
  game.drainEvents();
  return { game, chicken };
}

function skeletonEncounter(distance = 300, wave = Core.SKELETON_START_WAVE) {
  const game = startedGame();
  game.beginWave(wave);
  game.spawnRemaining = 0;
  game.fireTimer = 100;
  game.random = () => 0.7;
  game.spawnEnemy();
  const skeleton = game.enemies[0];
  skeleton.x = game.player.x + distance;
  skeleton.y = game.player.y;
  game.drainEvents();
  return { game, skeleton };
}

function finalBossEncounter(distance = 300, profile = Core.createProfile()) {
  const game = startedGame(profile);
  game.beginWave(Core.LEVEL_WAVES);
  game.fireTimer = 10000;
  const boss = game.enemies[0];
  boss.x = game.player.x + distance;
  boss.y = game.player.y;
  boss.speed = 0;
  boss.nextJumpAt = 0;
  game.drainEvents();
  return { game, boss };
}

function advanceFrames(game, count, input) {
  for (let i = 0; i < count; i += 1) game.update(1 / 60, input);
}

function fireballAt(x, y, vx, vy = 0, damage = 18, life = Core.FIREBALL_LIFETIME) {
  return { x, y, prevX: x, prevY: y, vx, vy, damage, life, radius: Core.FIREBALL_RADIUS };
}

test("new profiles are valid and invalid saves are rejected", () => {
  const profile = Core.createProfile();
  assert.equal(Core.isValidProfile(profile), true);
  assert.equal(Core.isValidProfile(null), false);
  assert.equal(Core.isValidProfile({ ...profile, gold: -1 }), false);
  assert.equal(Core.isValidProfile({ ...profile, bestTime: Infinity }), false);
  assert.equal(Core.isValidProfile({ ...profile, levels: { ...profile.levels, hp: 100 } }), false);
  assert.equal(Core.isValidProfile({ ...profile, version: 2 }), false);
});

test("all upgrades improve their corresponding stat", () => {
  const profile = Core.createProfile();
  profile.gold = 10000;
  for (const key of Object.keys(Core.UPGRADES)) {
    const before = Core.getStats(profile)[key];
    const cost = Core.upgradeCost(profile, key);
    const gold = profile.gold;
    assert.equal(Core.buyUpgrade(profile, key).success, true);
    assert.equal(profile.gold, gold - cost);
    assert.ok(Core.getStats(profile)[key] > before);
  }
  assert.equal(Core.isValidProfile(profile), true);
});

test("weapon range starts at 360 and upgrades by 40 units up to level 15", () => {
  const profile = Core.createProfile();
  profile.gold = 100000;
  assert.equal(Core.getStats(profile).range, 360);
  assert.equal(Core.upgradeCost(profile, "range"), 25);
  for (let level = 1; level <= 15; level += 1) {
    const before = profile.gold;
    const cost = Core.upgradeCost(profile, "range");
    assert.equal(Core.buyUpgrade(profile, "range").success, true);
    assert.equal(profile.gold, before - cost);
    assert.equal(Core.getStats(profile).range, 360 + 40 * level);
  }
  const gold = profile.gold;
  assert.equal(Core.getStats(profile).range, 960);
  assert.equal(Core.upgradeCost(profile, "range"), null);
  assert.equal(Core.buyUpgrade(profile, "range").success, false);
  assert.equal(profile.gold, gold);
  assert.equal(Core.isValidProfile(profile), true);
});

test("old saves gain new level-zero upgrades without losing or mutating progress", () => {
  const oldSave = {
    version: 1,
    gold: 1234,
    levels: { damage: 2, fireRate: 3, speed: 1, hp: 4, pickup: 2 },
    bestWave: 7,
    bestKills: 90,
    bestTime: 240,
    totalRuns: 5,
  };
  const original = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), original);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, range: 0, bullets: 0, wavePickup: 0, critChance: 0, healthRegen: 0, projectileSpeed: 0 }, wavePickupEnabled: true });
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.getStats(migrated).range, 360);
  assert.equal(Core.getStats(migrated).bullets, 1);
  assert.equal(Core.getStats(migrated).wavePickup, 0);
  assert.equal(Core.migrateProfile(migrated), migrated);
});

test("fire rate supports twenty-five levels with the existing pricing and twelve-percent scaling", () => {
  const profile = Core.createProfile();
  profile.gold = 10000000;
  assert.equal(Core.UPGRADES.fireRate.maxLevel, 25);
  for (let level = 1; level <= 25; level += 1) {
    const cost = Math.ceil(30 * Math.pow(1.38, level - 1));
    assert.equal(Core.upgradeCost(profile, "fireRate"), cost);
    assert.deepEqual(Core.buyUpgrade(profile, "fireRate"), { success: true, cost });
    assert.equal(Core.getStats(profile).fireRate, 2.1 * Math.pow(1.12, level));
  }
  assert.equal(Core.upgradeCost(profile, "fireRate"), null);
  const maxed = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "fireRate").success, false);
  assert.equal(JSON.stringify(profile), maxed);
  assert.equal(Core.isValidProfile(profile), true);
  assert.equal(Core.isValidProfile({ ...profile, levels: { ...profile.levels, fireRate: 26 } }), false);
});

test("old saves retain level-fifteen fire rate and gain base projectile speed without mutation", () => {
  const oldSave = Core.createProfile();
  delete oldSave.levels.projectileSpeed;
  oldSave.gold = 100000;
  oldSave.levels.fireRate = 15;
  oldSave.levels.critChance = 4;
  oldSave.levels.healthRegen = 3;
  oldSave.levels.bullets = 2;
  oldSave.levels.wavePickup = 1;
  oldSave.wavePickupEnabled = false;
  oldSave.bestWave = 13;
  const original = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), original);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, projectileSpeed: 0, bullets: 1 } });
  assert.equal(Core.getStats(migrated).projectileSpeed, 1080);
  assert.equal(Core.upgradeCost(migrated, "fireRate"), Math.ceil(30 * Math.pow(1.38, 15)));
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.migrateProfile(migrated), migrated);
  for (const level of [-1, 16, 0.5, null, "1", true]) {
    const invalid = { ...migrated, levels: { ...migrated.levels, projectileSpeed: level } };
    assert.equal(Core.migrateProfile(invalid), invalid);
    assert.equal(Core.isValidProfile(invalid), false);
  }
});

test("projectile speed costs fifty gold and adds twenty per level from 1080 to 1380", () => {
  const profile = Core.createProfile();
  const baseline = Core.getStats(profile);
  assert.equal(baseline.projectileSpeed, 1080);
  assert.equal(Core.upgradeCost(profile, "projectileSpeed"), 50);
  profile.gold = 49;
  const before = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "projectileSpeed").success, false);
  assert.equal(JSON.stringify(profile), before);
  profile.gold = 100000;
  for (let level = 1; level <= 15; level += 1) {
    const cost = Math.ceil(50 * Math.pow(1.38, level - 1));
    const gold = profile.gold;
    assert.deepEqual(Core.buyUpgrade(profile, "projectileSpeed"), { success: true, cost });
    assert.equal(profile.gold, gold - cost);
    assert.deepEqual(Core.getStats(profile), { ...baseline, projectileSpeed: 1080 + level * 20 });
  }
  assert.equal(Core.getStats(profile).projectileSpeed, 1380);
  assert.equal(Core.upgradeCost(profile, "projectileSpeed"), null);
  const maxed = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "projectileSpeed").success, false);
  assert.equal(JSON.stringify(profile), maxed);
});

test("projectile speed purchases apply next run and persist without speeding up existing bullets", () => {
  const profile = Core.createProfile();
  profile.gold = 50;
  const game = startedGame(profile);
  const target = enemyAt(game, game.player.x + 200, game.player.y);
  game.shoot(target);
  const oldBullet = game.bullets[0];
  assert.equal(Core.buyUpgrade(profile, "projectileSpeed").success, true);
  game.shoot(target);
  assert.equal(game.stats.projectileSpeed, 1080);
  assert.ok(game.bullets.every(bullet => Math.abs(Math.hypot(bullet.vx, bullet.vy) - 1080) < 1e-9));
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(restored.gold, 0);
  assert.equal(restored.levels.projectileSpeed, 1);
  assert.equal(Core.isValidProfile(restored), true);
  game.start(restored);
  game.shoot(target);
  assert.equal(game.stats.projectileSpeed, 1100);
  assert.ok(Math.abs(Math.hypot(game.bullets[0].vx, game.bullets[0].vy) - 1100) < 1e-9);
  assert.ok(Math.abs(Math.hypot(oldBullet.vx, oldBullet.vy) - 1080) < 1e-9);
});

test("upgraded projectile speed affects every critical bullet without changing enemy fireballs", () => {
  const profile = Core.createProfile();
  profile.levels.projectileSpeed = 15;
  profile.levels.bullets = 1;
  profile.levels.critChance = 10;
  const game = startedGame(profile);
  game.random = () => 0;
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y + 200));
  assert.equal(game.bullets.length, 4);
  for (const bullet of game.bullets) {
    assert.ok(Math.abs(Math.hypot(bullet.vx, bullet.vy) - 1380) < 1e-9);
    assert.equal(bullet.critical, true);
    assert.equal(bullet.damage, game.stats.damage * Core.CRIT_DAMAGE_MULTIPLIER);
  }
  game.shootFireball(enemyAt(game, game.player.x + 300, game.player.y));
  assert.equal(Math.hypot(game.fireballs[0].vx, game.fireballs[0].vy), 260);
});

test("maximum projectile speed clips single and dual bullets from both guns to circular weapon range", () => {
  for (const bulletsLevel of [0, 1]) {
    for (const rangeLevel of [0, 15]) {
      const profile = Core.createProfile();
      profile.levels.projectileSpeed = 15;
      profile.levels.bullets = bulletsLevel;
      profile.levels.range = rangeLevel;
      const game = startedGame(profile);
      game.player.x = 200;
      const origin = { x: game.player.x, y: game.player.y };
      game.shoot(enemyAt(game, origin.x + 200, origin.y));
      const bullets = [...game.bullets];
      const outside = enemyAt(game, origin.x + game.stats.range + 30, origin.y, 1000);
      game.enemies = [outside];
      const frames = Math.ceil(game.stats.range / game.stats.projectileSpeed / 0.1) + 1;
      for (let frame = 0; frame < frames; frame += 1) game.update(0.1);
      for (const bullet of bullets) {
        assert.ok(Math.abs(Math.hypot(bullet.x - origin.x, bullet.y - origin.y) - game.stats.range) < 1e-9);
        assert.equal(bullet.remainingRange, 0);
      }
      assert.equal(game.bullets.length, 0);
      assert.equal(outside.hp, 1000);
    }
  }
});

test("maximum projectile speed cannot skip an alien crossed within a simulation step", () => {
  const profile = Core.createProfile();
  profile.levels.projectileSpeed = 15;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  const enemy = enemyAt(game, game.player.x + 100, game.player.y, game.stats.damage);
  game.enemies = [enemy];
  game.update(0.1);
  assert.equal(game.kills, 1);
  assert.equal(enemy.hp, 0);
  assert.equal(game.pickups.find(pickup => pickup.kind === "gold").value, Core.enemyGold(enemy));
});

test("health regeneration unlocks at 0.5 HP per second and upgrades to a five-HP cap", () => {
  const profile = Core.createProfile();
  assert.equal(Core.getStats(profile).healthRegen, 0);
  assert.equal(Core.upgradeCost(profile, "healthRegen"), 100);
  profile.gold = 99;
  const before = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "healthRegen").success, false);
  assert.equal(JSON.stringify(profile), before);
  profile.gold = 100000;
  for (let level = 1; level <= 10; level += 1) {
    const cost = Core.upgradeCost(profile, "healthRegen");
    assert.equal(cost, Math.ceil(100 * Math.pow(1.38, level - 1)));
    const gold = profile.gold;
    assert.deepEqual(Core.buyUpgrade(profile, "healthRegen"), { success: true, cost });
    assert.equal(profile.gold, gold - cost);
    assert.equal(Core.getStats(profile).healthRegen, level * 0.5);
  }
  assert.equal(Core.getStats(profile).healthRegen, 5);
  assert.equal(Core.upgradeCost(profile, "healthRegen"), null);
  const maxed = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "healthRegen").success, false);
  assert.equal(JSON.stringify(profile), maxed);
  assert.equal(Core.isValidProfile(profile), true);
});

test("old saves gain locked health regeneration without losing or mutating progress", () => {
  const oldSave = Core.createProfile();
  delete oldSave.levels.healthRegen;
  oldSave.gold = 1234;
  oldSave.levels.hp = 4;
  oldSave.levels.critChance = 3;
  oldSave.levels.wavePickup = 1;
  oldSave.wavePickupEnabled = false;
  oldSave.bestWave = 13;
  oldSave.bestKills = 500;
  oldSave.bestTime = 400;
  oldSave.totalRuns = 7;
  const original = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), original);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, healthRegen: 0 } });
  assert.equal(Core.getStats(migrated).healthRegen, 0);
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.migrateProfile(migrated), migrated);
  for (const level of [-1, 11, 0.5, null, "1", true]) {
    const invalid = { ...migrated, levels: { ...migrated.levels, healthRegen: level } };
    assert.equal(Core.migrateProfile(invalid), invalid);
    assert.equal(Core.isValidProfile(invalid), false);
  }
});

test("health regeneration scales with elapsed time and never exceeds upgraded maximum health", () => {
  for (const level of [0, 1, 5, 10]) {
    for (const dt of [1 / 60, 0.1]) {
      const profile = Core.createProfile();
      profile.levels.healthRegen = level;
      profile.levels.hp = 3;
      const game = startedGame(profile);
      game.player.hp = 50;
      for (let frame = 0; frame < Math.round(1 / dt); frame += 1) game.update(dt);
      assert.ok(Math.abs(game.player.hp - (50 + level * 0.5)) < 1e-9);
      if (level > 0) {
        game.player.hp = game.player.maxHp - 0.001;
        game.update(dt);
        assert.equal(game.player.hp, 160);
      }
    }
  }
});

test("health regeneration purchases apply next run, persist in saves, and stop while paused or ended", () => {
  const profile = Core.createProfile();
  profile.gold = 100;
  const game = startedGame(profile);
  assert.equal(Core.buyUpgrade(profile, "healthRegen").success, true);
  game.player.hp = 50;
  game.update(0.1);
  assert.equal(game.player.hp, 50);
  assert.equal(game.stats.healthRegen, 0);
  const saved = JSON.parse(JSON.stringify(profile));
  assert.equal(Core.isValidProfile(saved), true);
  assert.equal(saved.gold, 0);
  game.start(saved);
  assert.equal(game.stats.healthRegen, 0.5);
  game.hurt(10, game.player.x, game.player.y);
  game.beginWave(1);
  game.spawnTimer = 10000;
  advanceFrames(game, 60);
  assert.ok(Math.abs(game.player.hp - 90.5) < 1e-9);
  assert.equal(game.damageTaken, 10);
  const hp = game.player.hp;
  game.pause();
  advanceFrames(game, 60);
  assert.equal(game.player.hp, hp);
  game.resume();
  game.finish("retreated");
  advanceFrames(game, 60);
  assert.equal(game.player.hp, hp);
  assert.equal(game.report.damageTaken, 10);
  game.start(saved);
  game.hurt(1000, game.player.x, game.player.y);
  advanceFrames(game, 60);
  assert.equal(game.phase, "ended");
  assert.equal(game.player.hp, 0);
});

test("health regeneration continues during the countdown between waves", () => {
  const profile = Core.createProfile();
  profile.levels.healthRegen = 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.player.hp = 50;
  game.update(1 / 60);
  assert.equal(game.waveActive, false);
  assert.ok(game.countdown > 0);
  const hp = game.player.hp;
  advanceFrames(game, 60);
  assert.ok(Math.abs(game.player.hp - hp - 0.5) < 1e-9);
  assert.equal(game.wavesCleared, 1);
});

test("critical chance starts at zero and upgrades by five percentage points to a fifty-percent cap", () => {
  const profile = Core.createProfile();
  assert.equal(Core.getStats(profile).critChance, 0);
  assert.equal(Core.upgradeCost(profile, "critChance"), 500);
  profile.gold = 499;
  const before = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "critChance").success, false);
  assert.equal(JSON.stringify(profile), before);
  profile.gold = 100000;
  let previousCost = 0;
  for (let level = 1; level <= 10; level += 1) {
    const cost = Core.upgradeCost(profile, "critChance");
    assert.equal(cost, Math.ceil(500 * Math.pow(1.38, level - 1)));
    const gold = profile.gold;
    assert.ok(cost > previousCost);
    assert.deepEqual(Core.buyUpgrade(profile, "critChance"), { success: true, cost });
    assert.equal(profile.gold, gold - cost);
    assert.equal(Core.getStats(profile).critChance, level * 5);
    previousCost = cost;
  }
  assert.equal(Core.upgradeCost(profile, "critChance"), null);
  const maxed = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "critChance").success, false);
  assert.equal(JSON.stringify(profile), maxed);
  assert.equal(Core.isValidProfile(profile), true);
});

test("old saves gain zero critical chance without losing gold, existing upgrades, records, or an OFF toggle", () => {
  const oldSave = Core.createProfile();
  delete oldSave.levels.critChance;
  oldSave.gold = 1234;
  oldSave.levels.damage = 4;
  oldSave.levels.bullets = 2;
  oldSave.levels.wavePickup = 1;
  oldSave.wavePickupEnabled = false;
  oldSave.bestWave = 13;
  oldSave.bestKills = 500;
  oldSave.bestTime = 400;
  oldSave.totalRuns = 7;
  const before = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), before);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, critChance: 0, bullets: 1 } });
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.getStats(migrated).critChance, 0);
  assert.equal(Core.migrateProfile(migrated), migrated);
  for (const level of [-1, 11, 0.5, null, "1", true]) {
    const invalid = { ...migrated, levels: { ...migrated.levels, critChance: level } };
    assert.equal(Core.migrateProfile(invalid), invalid);
    assert.equal(Core.isValidProfile(invalid), false);
  }
});

test("critical chance purchases apply next run and survive saving without rerolling existing bullets", () => {
  const profile = Core.createProfile();
  profile.gold = 500;
  const game = startedGame(profile);
  game.random = () => 0;
  const target = enemyAt(game, game.player.x + 200, game.player.y);
  Core.buyUpgrade(profile, "critChance");
  assert.equal(game.stats.critChance, 0);
  game.shoot(target);
  const oldBullet = game.bullets[0];
  assert.equal(oldBullet.critical, false);
  assert.equal(oldBullet.damage, game.stats.damage);
  const saved = JSON.parse(JSON.stringify(profile));
  assert.equal(Core.migrateProfile(saved), saved);
  assert.equal(saved.gold, 0);
  game.start(saved);
  assert.equal(game.stats.critChance, 5);
  game.shoot(target);
  assert.equal(game.bullets[0].critical, true);
  assert.equal(game.bullets[0].damage, game.stats.damage * 2);
  assert.equal(oldBullet.critical, false);
  assert.equal(oldBullet.damage, game.stats.damage);
});

test("each simultaneous bullet rolls critical chance independently and doubles full upgraded damage", () => {
  const profile = Core.createProfile();
  profile.levels.critChance = 1;
  profile.levels.damage = 2;
  profile.levels.bullets = 1;
  const game = startedGame(profile);
  const rolls = [0.049, 0.05, 0.99, 0];
  let index = 0;
  game.random = () => rolls[index++];
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  assert.equal(index, 4);
  assert.deepEqual(game.bullets.map(bullet => bullet.critical), [true, false, false, true]);
  assert.deepEqual(game.bullets.map(bullet => bullet.damage), [60, 30, 30, 60]);
  assert.equal(game.bulletsFired, 4);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 1);
  assert.ok(game.bullets.every(bullet => Number.isFinite(bullet.remainingRange)));
});

test("critical rolls match the displayed percentage at low, mid, and maximum levels", () => {
  for (const level of [1, 5, 10]) {
    const profile = Core.createProfile();
    profile.levels.critChance = level;
    const game = startedGame(profile);
    let roll = 0;
    game.random = () => (roll++ % 100) / 100;
    const target = enemyAt(game, game.player.x + 200, game.player.y);
    for (let shot = 0; shot < 100; shot += 1) game.shoot(target);
    assert.equal(game.bullets.filter(bullet => bullet.critical).length, level * 10);
    assert.equal(game.bulletsFired, 200);
  }
});

test("zero critical chance keeps normal damage without consuming randomness", () => {
  const game = startedGame();
  let rolls = 0;
  game.random = () => { rolls += 1; return 0; };
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  assert.equal(rolls, 0);
  assert.equal(game.bullets[0].damage, 18);
  assert.equal(game.bullets[0].critical, false);
});

test("critical bullets deliver doubled damage and marked hit events only below the probability threshold", () => {
  for (const [roll, critical] of [[0.049, true], [0.05, false]]) {
    const profile = Core.createProfile();
    profile.levels.critChance = 1;
    const game = startedGame(profile);
    game.random = () => roll;
    const target = enemyAt(game, game.player.x + 80, game.player.y, 1000);
    game.enemies.push(target);
    game.update(0.1);
    const damage = game.stats.damage * (critical ? Core.CRIT_DAMAGE_MULTIPLIER : 1);
    assert.equal(target.hp, target.maxHp - damage * 2);
    const hit = game.drainEvents().find(event => event.type === "hit");
    assert.equal(hit.damage, damage);
    assert.equal(hit.critical, critical);
    assert.equal(game.bulletsFired, 2);
  }
});

test("lethal critical bullets award exactly one kill and the enemy's normal gold reward", () => {
  const profile = Core.createProfile();
  profile.levels.critChance = 1;
  const game = startedGame(profile);
  game.random = () => 0;
  const target = enemyAt(game, game.player.x + 80, game.player.y, 30);
  game.enemies.push(target);
  game.update(0.1);
  advanceFrames(game, 30);
  assert.equal(game.kills, 1);
  assert.equal(game.bulletsFired, 2);
  const gold = game.pickups.filter(pickup => pickup.kind === "gold");
  assert.equal(gold.length, 1);
  assert.equal(gold[0].value, Core.enemyGold(target));
  assert.equal(game.drainEvents().filter(event => event.type === "kill").length, 1);
});

test("a critical chicken kill still explodes for normal blast damage without critical collateral", () => {
  const profile = Core.createProfile();
  profile.levels.critChance = 1;
  const { game, chicken } = chickenEncounter(160, profile);
  const collateral = enemyAt(game, game.player.x + 180, game.player.y, 200);
  game.enemies.push(collateral);
  game.random = () => 0;
  game.fireTimer = 0;
  game.update(0.1);
  game.update(1 / 60);
  assert.equal(chicken.hp, 0);
  assert.equal(collateral.hp, collateral.maxHp - chicken.damage);
  assert.equal(game.damageTaken, 0);
  const hits = game.drainEvents().filter(event => event.type === "hit");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].critical, true);
  assert.equal(hits[0].damage, 36);
  assert.equal(hits[1].critical, false);
  assert.equal(hits[1].damage, chicken.damage);
});

test("dual bullets cost 2500 once for two bullets per gun capped at four total", () => {
  const profile = Core.createProfile();
  assert.equal(Core.getStats(profile).bullets, 1);
  assert.equal(Core.upgradeCost(profile, "bullets"), 2500);
  profile.gold = 2499;
  const before = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "bullets").success, false);
  assert.equal(JSON.stringify(profile), before);
  profile.gold = 2500;
  assert.deepEqual(Core.buyUpgrade(profile, "bullets"), { success: true, cost: 2500 });
  assert.equal(profile.gold, 0);
  assert.equal(profile.levels.bullets, 1);
  assert.equal(Core.getStats(profile).bullets, 2);
  assert.equal(Core.UPGRADES.bullets.maxLevel, 1);
  profile.gold = 10000;
  const maxed = JSON.stringify(profile);
  assert.equal(Core.upgradeCost(profile, "bullets"), null);
  assert.equal(Core.buyUpgrade(profile, "bullets").success, false);
  assert.equal(JSON.stringify(profile), maxed);
  assert.equal(Core.isValidProfile(profile), true);
});

test("current saves add locked dual bullets without resetting range or any existing progress", () => {
  const oldSave = Core.createProfile();
  delete oldSave.levels.bullets;
  oldSave.gold = 1500;
  oldSave.levels.range = 4;
  oldSave.levels.damage = 3;
  oldSave.bestWave = 8;
  oldSave.bestKills = 150;
  oldSave.bestTime = 270;
  oldSave.totalRuns = 12;
  const before = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), before);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, bullets: 0 } });
  assert.equal(Core.getStats(migrated).range, 520);
  assert.equal(Core.getStats(migrated).bullets, 1);
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.migrateProfile(migrated), migrated);
});

test("migration preserves purchased dual bullets and rejects invalid upgrade levels", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  delete profile.levels.range;
  const migrated = Core.migrateProfile(profile);
  assert.equal(migrated.levels.range, 0);
  assert.equal(migrated.levels.bullets, 1);
  assert.equal(Core.getStats(migrated).bullets, 2);
  for (const level of [-1, 3, 0.5, 2.5, null, "1", "2", true]) {
    const invalid = { ...migrated, levels: { ...migrated.levels, bullets: level } };
    assert.equal(Core.migrateProfile(invalid), invalid);
    assert.equal(Core.isValidProfile(invalid), false);
  }
});

test("dual bullets apply next run and remain unlocked after a save round trip", () => {
  const profile = Core.createProfile();
  profile.gold = 2750;
  const game = startedGame(profile);
  Core.buyUpgrade(profile, "bullets");
  assert.equal(game.stats.bullets, 1);
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
  game.start(restored);
  assert.equal(game.stats.bullets, 2);
  assert.equal(restored.gold, 250);
  assert.equal(restored.levels.bullets, 1);
  assert.equal(Core.isValidProfile(restored), true);
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  assert.equal(game.bullets.length, 4);
});

test("existing dual bullets and wave collection stay purchased without an extra charge", () => {
  const profile = Core.createProfile();
  profile.gold = 1234;
  profile.levels.bullets = 1;
  profile.levels.wavePickup = 1;
  const before = JSON.stringify(profile);
  const restored = Core.migrateProfile(JSON.parse(before));
  assert.equal(Core.isValidProfile(restored), true);
  assert.equal(JSON.stringify(restored), before);
  assert.equal(Core.getStats(restored).bullets, 2);
  assert.equal(Core.upgradeCost(restored, "bullets"), null);
  assert.equal(Core.upgradeCost(restored, "wavePickup"), null);
});

test("legacy third-bullet saves migrate to four total without mutating or resetting other progress", () => {
  const oldSave = Core.createProfile();
  oldSave.levels.bullets = 2;
  oldSave.levels.damage = 4;
  oldSave.levels.fireRate = 25;
  oldSave.levels.projectileSpeed = 15;
  oldSave.levels.wavePickup = 1;
  oldSave.wavePickupEnabled = false;
  oldSave.gold = 8000;
  oldSave.bestWave = 13;
  oldSave.bestKills = 400;
  oldSave.bestTime = 500;
  oldSave.totalRuns = 9;
  const before = JSON.stringify(oldSave);
  assert.equal(Core.isValidProfile(oldSave), false);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), before);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, bullets: 1 } });
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.migrateProfile(migrated), migrated);
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(restored, migrated);
  const game = startedGame(restored);
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  assert.equal(game.stats.bullets, 2);
  assert.equal(game.bullets.length, 4);
  assert.deepEqual([0, 1].map(index => game.bullets.filter(bullet => bullet.gunIndex === index).length), [2, 2]);
  assert.equal(Core.upgradeCost(restored, "bullets"), null);
  assert.equal(Core.buyUpgrade(restored, "bullets").success, false);
  assert.deepEqual(restored, migrated);
});

test("two bullets from each gun deal full upgraded damage without increasing fire rate", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  profile.levels.damage = 2;
  const game = startedGame(profile);
  const target = enemyAt(game, game.player.x + 55, game.player.y, 300);
  game.enemies.push(target);
  game.update(1 / 60);
  assert.equal(target.hp, 180);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === "hit" && event.damage === 30).length, 4);
  assert.equal(events.filter(event => event.type === "shot").length, 1);
  game.update(1 / 60);
  assert.equal(target.hp, 180);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 0);
});

test("dual bullets fire two parallel projectiles from each gun with full damage and one cooldown", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  profile.levels.damage = 2;
  const game = startedGame(profile);
  game.enemies.push(enemyAt(game, game.player.x + 200, game.player.y, 1000));
  game.update(1 / 60);
  assert.equal(game.bullets.length, 4);
  for (const index of [0, 1]) {
    const [left, right] = game.bullets.filter(bullet => bullet.gunIndex === index);
    assert.ok(Math.abs(Math.hypot(right.x - left.x, right.y - left.y) - 10) < 1e-9);
    assert.ok(Math.abs((right.x - left.x) * left.vx + (right.y - left.y) * left.vy) < 1e-9);
    assert.equal(left.vx, right.vx);
    assert.equal(left.vy, right.vy);
    assert.equal(left.damage, 30);
    assert.equal(right.damage, 30);
    assert.ok(left.remainingRange > 0 && right.remainingRange > 0);
  }
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 1);
  game.update(1 / 60);
  assert.equal(game.bullets.length, 4);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 0);
});

test("both guns can damage the same enemy without duplicating kill rewards", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  const target = enemyAt(game, game.player.x + 55, game.player.y, 100);
  game.enemies.push(target);
  game.update(1 / 60);
  assert.equal(target.hp, 100 - game.stats.damage * 4);
  assert.equal(game.drainEvents().filter(event => event.type === "hit").length, 4);
  game.hitEnemy(target, target.hp);
  assert.equal(game.kills, 1);
  assert.equal(game.pickups.filter(pickup => pickup.kind === "gold").length, 1);

  const lethal = startedGame(profile);
  lethal.beginWave(1);
  lethal.spawnRemaining = 0;
  lethal.enemies.push(enemyAt(lethal, lethal.player.x + 55, lethal.player.y, 18));
  lethal.update(1 / 60);
  assert.equal(lethal.kills, 1);
  assert.equal(lethal.pickups.filter(pickup => pickup.kind === "gold").length, 1);
});

test("single and dual bullets from both guns stay inside circular weapon range at every firing angle", () => {
  for (const level of [0, 1]) {
    const profile = Core.createProfile();
    profile.levels.bullets = level;
    for (let i = 0; i < 8; i += 1) {
      const game = startedGame(profile);
      const angle = i * Math.PI / 4;
      const origin = { x: game.player.x, y: game.player.y };
      game.shoot(enemyAt(game, origin.x + Math.cos(angle) * 200, origin.y + Math.sin(angle) * 200));
      const bullets = [...game.bullets];
      for (let frame = 0; frame < 4; frame += 1) game.update(0.1);
      for (const bullet of bullets) {
        assert.ok(Math.abs(Math.hypot(bullet.x - origin.x, bullet.y - origin.y) - game.stats.range) < 1e-9);
        assert.equal(bullet.remainingRange, 0);
      }
      assert.equal(game.bullets.length, 0);
    }
  }
});

test("paired bullets from both guns can hit a large target on the final clipped range segment", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  const game = startedGame(profile);
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  const target = enemyAt(game, game.player.x + game.stats.range + 19, game.player.y, 100);
  target.radius = 36;
  game.enemies.push(target);
  for (let i = 0; i < 4; i += 1) game.update(0.1);
  assert.equal(target.hp, 100 - game.stats.damage * 4);
  assert.equal(game.bullets.length, 0);
});

test("single and dual bullets from both guns keep the full upgraded range up to 960 units", () => {
  for (const level of [0, 1]) {
    const profile = Core.createProfile();
    profile.levels.bullets = level;
    profile.levels.range = Core.UPGRADES.range.maxLevel;
    const game = startedGame(profile);
    game.player.x = 200;
    const origin = { x: game.player.x, y: game.player.y };
    game.shoot(enemyAt(game, origin.x + 200, origin.y));
    const bullets = [...game.bullets];
    for (let i = 0; i < 10; i += 1) game.update(0.1);
    assert.equal(game.stats.range, 960);
    for (const bullet of bullets) {
      assert.ok(Math.abs(Math.hypot(bullet.x - origin.x, bullet.y - origin.y) - 960) < 1e-9);
      assert.equal(bullet.remainingRange, 0);
    }
    assert.equal(game.bullets.length, 0);
  }
});

test("wave gold collection costs 2500 gold and unlocks permanently only once", () => {
  const profile = Core.createProfile();
  assert.equal(Core.getStats(profile).wavePickup, 0);
  assert.equal(Core.upgradeCost(profile, "wavePickup"), 2500);
  profile.gold = 2499;
  const before = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "wavePickup").success, false);
  assert.equal(JSON.stringify(profile), before);
  profile.gold = 2500;
  assert.deepEqual(Core.buyUpgrade(profile, "wavePickup"), { success: true, cost: 2500 });
  assert.equal(profile.gold, 0);
  assert.equal(profile.levels.wavePickup, 1);
  assert.equal(Core.getStats(profile).wavePickup, 1);
  profile.gold = 2000;
  assert.equal(Core.upgradeCost(profile, "wavePickup"), null);
  assert.equal(Core.buyUpgrade(profile, "wavePickup").success, false);
  assert.equal(profile.gold, 2000);
  assert.equal(profile.levels.wavePickup, 1);
  assert.equal(Core.isValidProfile(profile), true);
});

test("old saves add locked wave collection without resetting purchased dual bullets or records", () => {
  const oldSave = Core.createProfile();
  delete oldSave.levels.wavePickup;
  oldSave.gold = 1500;
  oldSave.levels.bullets = 1;
  oldSave.levels.range = 4;
  oldSave.bestWave = 9;
  oldSave.totalRuns = 7;
  const before = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), before);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, wavePickup: 0 } });
  assert.equal(Core.getStats(migrated).bullets, 2);
  assert.equal(Core.getStats(migrated).wavePickup, 0);
  assert.equal(Core.isValidProfile(migrated), true);
  for (const level of [-1, 2, 0.5, null, "1"]) {
    const invalid = { ...migrated, levels: { ...migrated.levels, wavePickup: level } };
    assert.equal(Core.migrateProfile(invalid), invalid);
    assert.equal(Core.isValidProfile(invalid), false);
  }
});

test("wave collection waits for a full clear, collects every distant coin once, and removes medkits", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 1;
  game.spawnTimer = 100;
  game.fireTimer = 100;
  const medkit = { kind: "health", x: 200, y: 200, age: 0 };
  game.pickups.push(
    { kind: "gold", x: 40, y: 40, value: 7, age: 0 },
    { kind: "gold", x: Core.WIDTH - 40, y: Core.HEIGHT - 40, value: 11, age: 0 },
    medkit,
  );
  game.update(1 / 60);
  assert.equal(profile.gold, 0);
  game.spawnRemaining = 0;
  game.enemies.push(enemyAt(game, 40, 40, 100));
  game.update(1 / 60);
  assert.equal(profile.gold, 0);
  game.enemies = [];
  game.fireballs.push(fireballAt(50, 50, 20));
  game.update(1 / 60);
  assert.equal(profile.gold, 0);
  assert.equal(game.waveActive, true);
  game.fireballs = [];
  game.update(1 / 60);
  assert.equal(profile.gold, 18);
  assert.equal(game.coins, 18);
  assert.equal(game.waveActive, false);
  assert.deepEqual(game.pickups, []);
  const events = game.drainEvents();
  const collected = events.filter(event => event.type === "gold");
  assert.equal(collected.length, 1);
  assert.equal(collected[0].value, 18);
  assert.equal(events.filter(event => event.type === "clear").length, 1);
  game.update(1 / 60);
  assert.equal(profile.gold, 18);
  assert.equal(game.drainEvents().filter(event => event.type === "gold").length, 0);
});

test("unused medkits disappear at wave clear and cannot carry into the next wave", () => {
  for (const [owned, enabled] of [[0, true], [1, true], [1, false]]) {
    const profile = Core.createProfile();
    profile.levels.wavePickup = owned;
    profile.wavePickupEnabled = enabled;
    const game = startedGame(profile);
    game.beginWave(1);
    game.spawnRemaining = 0;
    game.nextBossAt = Infinity;
    game.player.hp = 50;
    const gold = { kind: "gold", x: 40, y: 40, value: 7, age: 0 };
    game.pickups.push(gold, { kind: "health", x: 200, y: 200, age: 0 });
    game.update(0.1);
    assert.equal(game.waveActive, false);
    assert.equal(game.player.hp, 62);
    assert.equal(game.pickups.some(pickup => pickup.kind === "health"), false);
    assert.equal(profile.gold, owned && enabled ? 7 : 0);
    assert.deepEqual(game.pickups, owned && enabled ? [] : [gold]);
    game.pickups.push({ kind: "health", x: 200, y: 200, age: 0 });
    advanceFrames(game, 211);
    assert.equal(game.wave, 2);
    assert.equal(game.pickups.some(pickup => pickup.kind === "health"), false);
    assert.deepEqual(game.pickups, owned && enabled ? [] : [gold]);
  }
});

test("unused medkits disappear on the final wave before victory", () => {
  const { game, boss } = finalBossEncounter();
  game.pickups.push({ kind: "health", x: 200, y: 200, age: 0 });
  game.killEnemy(boss);
  game.update(1 / 60);
  assert.equal(game.report.reason, "victory");
  assert.equal(game.pickups.some(pickup => pickup.kind === "health"), false);
});

test("wave collection includes final kill loot and does not duplicate normally collected gold", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.pickups.push(
    { kind: "gold", x: game.player.x, y: game.player.y, value: 4, age: 0 },
    { kind: "gold", x: 40, y: 40, value: 9, age: 0 },
  );
  const enemy = enemyAt(game, 40, 40, 26);
  game.enemies.push(enemy);
  game.killEnemy(enemy);
  game.update(1 / 60);
  assert.equal(profile.gold, 4 + 9 + Core.enemyGold(enemy));
  assert.equal(game.coins, profile.gold);
  assert.equal(game.pickups.length, 0);
  assert.equal(game.drainEvents().filter(event => event.type === "gold").reduce((sum, event) => sum + event.value, 0), profile.gold);
});

test("wave collection works at every wave and respects the wallet cap", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  const game = startedGame(profile);
  for (const wave of [1, 2]) {
    game.beginWave(wave);
    game.spawnRemaining = 0;
    game.pickups.push({ kind: "gold", x: 40, y: 40, value: wave * 3, age: 0 });
    game.update(1 / 60);
    assert.equal(game.waveActive, false);
    assert.equal(game.pickups.length, 0);
  }
  assert.equal(profile.gold, 9);
  profile.gold = Core.MAX_GOLD - 3;
  game.beginWave(3);
  game.spawnRemaining = 0;
  game.pickups.push(
    { kind: "gold", x: 40, y: 40, value: Core.MAX_GOLD, age: 0 },
    { kind: "gold", x: 60, y: 40, value: Core.MAX_GOLD, age: 0 },
  );
  game.update(1 / 60);
  assert.equal(profile.gold, Core.MAX_GOLD);
  assert.equal(game.coins, 12);
  assert.equal(game.pickups.length, 0);
  assert.equal(Core.isValidProfile(profile), true);
});

test("locked wave collection preserves manual pickup behavior", () => {
  const game = startedGame();
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.pickups.push({ kind: "gold", x: 40, y: 40, value: 50, age: 0 });
  game.update(1 / 60);
  assert.equal(game.waveActive, false);
  assert.equal(game.profile.gold, 0);
  assert.equal(game.pickups.length, 1);
});

test("wave collection applies next run and survives saving", () => {
  const profile = Core.createProfile();
  profile.gold = 2500;
  const game = startedGame(profile);
  Core.buyUpgrade(profile, "wavePickup");
  assert.equal(game.stats.wavePickup, 0);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.pickups.push({ kind: "gold", x: 40, y: 40, value: 9, age: 0 });
  game.update(1 / 60);
  assert.equal(profile.gold, 0);
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
  game.start(restored);
  assert.equal(game.stats.wavePickup, 1);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.pickups.push({ kind: "gold", x: 40, y: 40, value: 9, age: 0 });
  game.update(1 / 60);
  assert.equal(restored.gold, 9);
  assert.equal(restored.levels.wavePickup, 1);
});

test("old purchased wave-collection saves migrate to ON without losing or mutating progress", () => {
  const oldSave = Core.createProfile();
  oldSave.levels.wavePickup = 1;
  oldSave.levels.bullets = 2;
  oldSave.gold = 1234;
  oldSave.bestWave = 7;
  delete oldSave.wavePickupEnabled;
  const before = JSON.stringify(oldSave);
  const migrated = Core.migrateProfile(oldSave);
  assert.equal(JSON.stringify(oldSave), before);
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, bullets: 1 }, wavePickupEnabled: true });
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.migrateProfile(migrated), migrated);
});

test("the wave-collection toggle preserves OFF across migration and save round trips", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  profile.wavePickupEnabled = false;
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(restored.wavePickupEnabled, false);
  assert.equal(Core.isValidProfile(restored), true);
  for (const enabled of [null, 0, 1, "true", {}]) {
    const invalid = { ...profile, wavePickupEnabled: enabled };
    assert.equal(Core.migrateProfile(invalid), invalid);
    assert.equal(Core.isValidProfile(invalid), false);
    assert.throws(() => Core.toggleWavePickup(invalid), TypeError);
  }
});

test("only an owned wave-collection upgrade can be toggled and doing so never costs gold", () => {
  const profile = Core.createProfile();
  profile.gold = 3000;
  const before = JSON.stringify(profile);
  assert.equal(Core.toggleWavePickup(profile).success, false);
  assert.equal(JSON.stringify(profile), before);
  Core.buyUpgrade(profile, "wavePickup");
  assert.deepEqual(Core.toggleWavePickup(profile), { success: true, enabled: false });
  assert.equal(profile.gold, 500);
  assert.equal(profile.levels.wavePickup, 1);
  assert.equal(Core.upgradeCost(profile, "wavePickup"), null);
  assert.deepEqual(Core.toggleWavePickup(profile), { success: true, enabled: true });
  assert.equal(profile.gold, 500);
});

test("the toggle applies live to future wave clears while manual pickup still works", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  const game = startedGame(profile);
  Core.toggleWavePickup(profile);
  assert.equal(game.stats.wavePickup, 1);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.pickups.push(
    { kind: "gold", x: 40, y: 40, value: 7, age: 0 },
    { kind: "gold", x: game.player.x, y: game.player.y, value: 4, age: 0 },
  );
  game.update(1 / 60);
  assert.equal(profile.gold, 4);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "gold").some(event => Object.hasOwn(event, "coins")), false);
  Core.toggleWavePickup(profile);
  game.beginWave(2);
  game.spawnRemaining = 0;
  game.pickups.push({ kind: "gold", x: Core.WIDTH - 40, y: Core.HEIGHT - 40, value: 11, age: 0 });
  game.update(1 / 60);
  assert.equal(profile.gold, 22);
  assert.equal(game.coins, 22);
  assert.equal(game.pickups.length, 0);
  const event = game.drainEvents().find(event => event.type === "gold");
  assert.equal(event.value, 18);
  assert.equal(event.coins.length, 2);
});

test("wave collection supplies copied positions for every coin and banks before animation", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  const first = { kind: "gold", x: 40, y: 40, value: 7, age: 0 };
  const second = { kind: "gold", x: Core.WIDTH - 40, y: Core.HEIGHT - 40, value: 11, age: 0 };
  game.pickups.push(first, second, { kind: "health", x: 200, y: 200, age: 0 });
  game.update(1 / 60);
  assert.equal(profile.gold, 18);
  assert.equal(game.coins, 18);
  assert.equal(game.pickups.length, 0);
  const event = game.drainEvents().find(event => event.type === "gold");
  assert.deepEqual(event.coins, [{ x: 40, y: 40 }, { x: Core.WIDTH - 40, y: Core.HEIGHT - 40 }]);
  first.x = 0;
  second.y = 0;
  assert.deepEqual(event.coins, [{ x: 40, y: 40 }, { x: Core.WIDTH - 40, y: Core.HEIGHT - 40 }]);
  game.pause();
  Core.toggleWavePickup(profile);
  game.finish("retreated");
  assert.equal(game.report.gold, 18);
  assert.equal(profile.gold, 18);
  game.start(profile);
  assert.equal(profile.gold, 18);
  assert.equal(profile.wavePickupEnabled, false);
  assert.equal(game.coins, 0);
});

test("wallet-capped wave collection still supplies all coin animations without extra credit", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  profile.gold = Core.MAX_GOLD;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.pickups.push(
    { kind: "gold", x: 40, y: 40, value: 7, age: 0 },
    { kind: "gold", x: Core.WIDTH - 40, y: Core.HEIGHT - 40, value: 11, age: 0 },
  );
  game.update(1 / 60);
  const event = game.drainEvents().find(event => event.type === "gold");
  assert.equal(event.value, 0);
  assert.equal(event.coins.length, 2);
  assert.equal(profile.gold, Core.MAX_GOLD);
  assert.equal(game.coins, 0);
  assert.equal(game.pickups.length, 0);
});

test("dying or retreating never sweeps gold even with wave collection unlocked", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  for (const reason of ["retreated", "overrun"]) {
    const game = startedGame(profile);
    game.beginWave(1);
    game.spawnRemaining = 0;
    game.pickups.push({ kind: "gold", x: 40, y: 40, value: 50, age: 0 });
    if (reason === "overrun") {
      game.player.hp = 1;
      game.fireballs.push(fireballAt(game.player.x - 20, game.player.y, Core.FIREBALL_SPEED));
      game.update(1 / 60);
    } else {
      game.finish(reason);
      game.update(1 / 60);
    }
    assert.equal(game.phase, "ended");
    assert.equal(game.profile.gold, 0);
    assert.equal(game.pickups.length, 1);
    assert.equal(game.drainEvents().filter(event => event.type === "gold").length, 0);
  }
});

test("save migration does not conceal invalid data or reset existing range levels", () => {
  const profile = Core.createProfile();
  profile.levels.range = 4;
  assert.equal(Core.migrateProfile(profile), profile);
  assert.equal(Core.getStats(profile).range, 520);
  const corrupt = { ...profile, gold: -1, levels: { damage: 0, fireRate: 0, speed: 0, hp: 0, pickup: 0 } };
  assert.equal(Core.isValidProfile(Core.migrateProfile(corrupt)), false);
  for (const saved of [null, { version: 2, levels: {} }, { version: 1, levels: null }, { version: 1, levels: "invalid" }]) {
    assert.equal(Core.migrateProfile(saved), saved);
    assert.equal(Core.isValidProfile(saved), false);
  }
  profile.levels.range = 16;
  assert.equal(Core.isValidProfile(Core.migrateProfile(profile)), false);
});

test("unaffordable, unknown, and maxed upgrades cannot modify progress", () => {
  const profile = Core.createProfile();
  const original = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "damage").success, false);
  assert.equal(JSON.stringify(profile), original);
  assert.throws(() => Core.buyUpgrade(profile, "not-an-upgrade"), TypeError);
  assert.throws(() => Core.buyUpgrade(profile, "__proto__"), TypeError);
  profile.gold = 10000;
  profile.levels.damage = Core.UPGRADES.damage.maxLevel;
  assert.equal(Core.upgradeCost(profile, "damage"), null);
  assert.equal(Core.buyUpgrade(profile, "damage").success, false);
  assert.equal(profile.gold, 10000);
});

test("movement stays within the fixed map and diagonals are not faster", () => {
  const straight = startedGame();
  const diagonal = startedGame();
  straight.update(0.1, { x: 1, y: 0 });
  diagonal.update(0.1, { x: 1, y: 1 });
  assert.ok(Math.abs(Math.hypot(diagonal.player.x - Core.WIDTH / 2, diagonal.player.y - Core.HEIGHT / 2) - (straight.player.x - Core.WIDTH / 2)) < 1e-8);
  straight.player.x = Core.WIDTH - 28;
  straight.player.y = 28;
  straight.update(0.1, { x: 1, y: -1 });
  assert.equal(straight.player.x, Core.WIDTH - 27);
  assert.equal(straight.player.y, 27);
});

test("the soldier has exactly two gun poses which rotate and move with its body", () => {
  const idle = new Core.Game();
  assert.equal(idle.getGunPoses().length, 2);
  assert.ok(idle.getGunPoses().every(gun => gun.target === null));
  const game = startedGame();
  for (let i = 0; i < 8; i += 1) {
    game.player.angle = i * Math.PI / 4;
    const guns = game.getGunPoses();
    assert.equal(guns.length, 2);
    assert.deepEqual(guns.map(gun => gun.index), [0, 1]);
    assert.ok(Math.abs(Math.hypot(guns[0].x - guns[1].x, guns[0].y - guns[1].y) - 32) < 1e-9);
    for (const gun of guns) {
      const side = gun.index === 0 ? -1 : 1;
      assert.ok(Math.abs(gun.x - game.player.x - Math.cos(game.player.angle) * 4 + Math.sin(game.player.angle) * side * 16) < 1e-9);
      assert.ok(Math.abs(gun.y - game.player.y - Math.sin(game.player.angle) * 4 - Math.cos(game.player.angle) * side * 16) < 1e-9);
      assert.equal(gun.angle, game.player.angle);
      assert.ok(Math.abs(Math.hypot(gun.x - game.player.x, gun.y - game.player.y) - Math.hypot(4, 16)) < 1e-9);
    }
  }
  game.player.angle = 0;
  const before = game.getGunPoses();
  game.update(0.1, { x: 1, y: 0 });
  for (const gun of game.getGunPoses()) {
    assert.ok(Math.abs(gun.x - before[gun.index].x - game.stats.speed * 0.1) < 1e-9);
    assert.equal(gun.y, before[gun.index].y);
  }
});

test("each gun keeps its closest living enemy when the preferred targets already differ", () => {
  const game = startedGame();
  game.player.angle = 0;
  const upper = enemyAt(game, game.player.x + 140, game.player.y - 35, 1000);
  const lower = enemyAt(game, game.player.x + 136, game.player.y + 35, 1000);
  const dead = enemyAt(game, game.player.x + 4, game.player.y - 16, 0);
  game.enemies = [dead, lower, upper];
  assert.equal(game.closestEnemy(), lower);
  const guns = game.getGunPoses();
  assert.deepEqual(guns.map(gun => gun.target), [upper, lower]);
  game.shoot();
  assert.equal(game.bullets.length, 2);
  for (const bullet of game.bullets) {
    const gun = guns[bullet.gunIndex];
    assert.ok(Math.abs(Math.hypot(bullet.x - gun.x, bullet.y - gun.y) - 29) < 1e-9);
    assert.ok(Math.abs(Math.atan2(bullet.vy, bullet.vx) - gun.angle) < 1e-9);
  }
  game.fireTimer = 100;
  game.update(0.1);
  assert.equal(upper.hp, 982);
  assert.equal(lower.hp, 982);
  game.killEnemy(upper);
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [lower, lower]);
});

test("guns split a shared preferred target, giving the alternate to the closer gun at either bullet tier", () => {
  for (const level of [0, 1]) {
    for (const side of [-1, 1]) {
      for (const explicit of [false, true]) {
        const profile = Core.createProfile();
        profile.levels.bullets = level;
        const game = startedGame(profile);
        game.player.angle = 0;
        const near = enemyAt(game, game.player.x + 80, game.player.y, 1000);
        const alternate = enemyAt(game, game.player.x + 140, game.player.y + side * 50, 1000);
        game.enemies = [alternate, near];
        const guns = game.getGunPoses();
        assert.ok(guns.every(gun => game.closestEnemy(gun) === near));
        assert.deepEqual(guns.map(gun => gun.target), side < 0 ? [alternate, near] : [near, alternate]);
        if (explicit) game.shoot(near);
        else game.update(1 / 60);
        assert.equal(game.bullets.length, (level + 1) * 2);
        for (const bullet of game.bullets) {
          assert.ok(Math.abs(Math.atan2(bullet.vy, bullet.vx) - guns[bullet.gunIndex].angle) < 1e-9);
        }
        game.fireTimer = 100;
        game.update(0.1);
        assert.equal(near.hp, 1000 - game.stats.damage * (level + 1));
        assert.equal(alternate.hp, 1000 - game.stats.damage * (level + 1));
        assert.equal(game.bulletsFired, (level + 1) * 2);
        assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 1);
      }
    }
  }
});

test("distinct gun targeting retargets after deaths and only shares the final available enemy", () => {
  const game = startedGame();
  game.player.angle = 0;
  const near = enemyAt(game, game.player.x + 80, game.player.y);
  const alternate = enemyAt(game, game.player.x + 140, game.player.y + 50);
  const third = enemyAt(game, game.player.x - 280, game.player.y);
  game.enemies = [near, alternate, third];
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [near, alternate]);
  game.killEnemy(near);
  assert.deepEqual(new Set(game.getGunPoses().map(gun => gun.target)), new Set([alternate, third]));
  game.killEnemy(alternate);
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [third, third]);
  game.killEnemy(third);
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [null, null]);
  game.shoot();
  assert.equal(game.bulletsFired, 0);
});

test("sharing a sole in-range target ignores dead enemies, queued spawns, and out-of-range enemies", () => {
  const game = startedGame();
  game.player.angle = 0;
  game.spawnRemaining = 20;
  const near = enemyAt(game, game.player.x + 80, game.player.y);
  const other = enemyAt(game, game.player.x + game.stats.range + 1, game.player.y);
  const dead = enemyAt(game, game.player.x + 4, game.player.y - 16, 0);
  game.enemies = [dead, other, near];
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [near, near]);
  other.x -= 1;
  assert.deepEqual(new Set(game.getGunPoses().map(gun => gun.target)), new Set([near, other]));
  other.x += 1;
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [near, near]);
  near.hp = 0;
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [null, null]);
});

test("two-target assignments minimize combined gun-to-enemy distance across torso angles and swarms", () => {
  for (const offsets of [
    [[80, 0], [140, 50], [-280, 0]],
    [[150, -55], [150, 55], [-210, -90]],
    [[10, -50], [-30, 90], [210, 60], [280, -180]],
  ]) {
    const game = startedGame();
    const eligible = offsets.map(([x, y]) => enemyAt(game, game.player.x + x, game.player.y + y));
    game.enemies = [
      enemyAt(game, game.player.x, game.player.y, 0),
      enemyAt(game, game.player.x + game.stats.range + 1, game.player.y),
      ...eligible,
    ];
    for (let i = 0; i < 8; i += 1) {
      game.player.angle = i * Math.PI / 4;
      const [first, second] = game.getGunPoses();
      assert.notEqual(first.target, second.target);
      assert.ok(eligible.includes(first.target) && eligible.includes(second.target));
      const distance = (gun, enemy) => Math.hypot(enemy.x - gun.x, enemy.y - gun.y);
      const actual = distance(first, first.target) + distance(second, second.target);
      let minimum = Infinity;
      for (const left of eligible) {
        for (const right of eligible) {
          if (left !== right) minimum = Math.min(minimum, distance(first, left) + distance(second, right));
        }
      }
      assert.ok(Math.abs(actual - minimum) < 1e-9);
      assert.deepEqual(game.getGunPoses().map(gun => gun.target), [first.target, second.target]);
    }
  }
});

test("automatic fire sends each gun's own bullets toward a different nearest target", () => {
  for (const level of [0, 1]) {
    const profile = Core.createProfile();
    profile.levels.bullets = level;
    const game = startedGame(profile);
    game.player.angle = 0;
    const upper = enemyAt(game, game.player.x + 140, game.player.y - 35, 1000);
    const lower = enemyAt(game, game.player.x + 136, game.player.y + 35, 1000);
    game.enemies = [lower, upper];
    game.update(0.1);
    assert.equal(upper.hp, 1000 - (level + 1) * game.stats.damage);
    assert.equal(lower.hp, 1000 - (level + 1) * game.stats.damage);
    assert.equal(game.bulletsFired, 2 * (level + 1));
    assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 1);
  }
});

test("both guns use the existing circular range even when an excluded enemy is closer to one gun", () => {
  const game = startedGame();
  game.player.angle = 0;
  const inside = enemyAt(game, game.player.x, game.player.y + game.stats.range - 1);
  const outside = enemyAt(game, game.player.x, game.player.y - game.stats.range - 1);
  game.enemies = [outside, inside];
  const guns = game.getGunPoses();
  assert.ok(Math.hypot(outside.x - guns[0].x, outside.y - guns[0].y) < Math.hypot(inside.x - guns[0].x, inside.y - guns[0].y));
  assert.deepEqual(guns.map(gun => gun.target), [inside, inside]);
  game.enemies = [outside];
  game.shoot();
  assert.equal(game.bulletsFired, 0);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 0);
});

test("each gun starts with one bullet and retains two per gun after upgrading and saving", () => {
  for (const level of [0, 1]) {
    const profile = Core.createProfile();
    profile.levels.bullets = level;
    const saved = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
    const game = startedGame(saved);
    game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
    assert.equal(game.getGunPoses().length, 2);
    assert.equal(game.bullets.length, 2 * (level + 1));
    for (const index of [0, 1]) {
      const bullets = game.bullets.filter(bullet => bullet.gunIndex === index);
      assert.equal(bullets.length, level + 1);
      assert.ok(bullets.every(bullet => bullet.damage === game.stats.damage));
    }
  }
});

test("both guns clip independently aimed bullet lanes to the shared range at every torso angle", () => {
  for (const level of [0, 1]) {
    for (let i = 0; i < 8; i += 1) {
      const profile = Core.createProfile();
      profile.levels.bullets = level;
      profile.levels.projectileSpeed = 15;
      const game = startedGame(profile);
      game.player.angle = i * Math.PI / 4;
      game.enemies = [
        enemyAt(game, game.player.x + 160, game.player.y - 80, 1000000),
        enemyAt(game, game.player.x - 140, game.player.y + 90, 1000000),
      ];
      game.shoot();
      const bullets = [...game.bullets];
      game.enemies = [];
      for (let frame = 0; frame < 4; frame += 1) game.update(0.1);
      for (const bullet of bullets) {
        assert.ok(Math.abs(Math.hypot(bullet.x - game.player.x, bullet.y - game.player.y) - game.stats.range) < 1e-9);
        assert.equal(bullet.remainingRange, 0);
      }
      assert.equal(game.bullets.length, 0);
    }
  }
});

test("both guns share the upgraded fire-rate cooldown and cannot fire early after target changes", () => {
  const game = startedGame();
  game.player.angle = 0;
  game.enemies = [enemyAt(game, game.player.x + 140, game.player.y - 35, 1000)];
  game.update(1 / 60);
  assert.equal(game.bulletsFired, 2);
  game.enemies.push(enemyAt(game, game.player.x + 136, game.player.y + 35, 1000));
  game.update(1 / 60);
  assert.equal(game.bulletsFired, 2);
  const guns = game.getGunPoses();
  game.pause();
  advanceFrames(game, 60, { x: 1, y: 0 });
  assert.deepEqual(game.getGunPoses(), guns);
  assert.equal(game.bulletsFired, 2);
});

test("both guns retain accurate range limits at maximum weapon-range and bullet upgrades", () => {
  const profile = Core.createProfile();
  profile.levels.range = 15;
  profile.levels.bullets = 1;
  const game = startedGame(profile);
  game.enemies = [
    enemyAt(game, game.player.x + 160, game.player.y - 80),
    enemyAt(game, game.player.x - 140, game.player.y + 90),
  ];
  for (let i = 0; i < 8; i += 1) {
    game.player.angle = i * Math.PI / 4;
    game.bullets = [];
    game.shoot();
    assert.equal(game.bullets.length, 4);
    for (const bullet of game.bullets) {
      const speed = Math.hypot(bullet.vx, bullet.vy);
      const endX = bullet.x + bullet.vx / speed * bullet.remainingRange;
      const endY = bullet.y + bullet.vy / speed * bullet.remainingRange;
      assert.ok(bullet.remainingRange > 0);
      assert.ok(Math.abs(Math.hypot(endX - game.player.x, endY - game.player.y) - 960) < 1e-9);
    }
  }
});

test("auto-fire splits between two living aliens even when both guns prefer the nearer one", () => {
  const game = startedGame();
  const far = enemyAt(game, game.player.x - 200, game.player.y);
  const near = enemyAt(game, game.player.x + 100, game.player.y);
  const dead = enemyAt(game, game.player.x, game.player.y + 5, 0);
  game.enemies.push(far, near, dead);
  assert.equal(game.closestEnemy(), near);
  game.update(1 / 60);
  assert.equal(game.bullets.length, 2);
  assert.ok(game.bullets.some(bullet => bullet.vx > 0));
  assert.ok(game.bullets.some(bullet => bullet.vx < 0));
  assert.deepEqual(game.getGunPoses().map(gun => gun.target), [near, far]);
});

test("auto-fire ignores enemies outside range and includes the exact range boundary", () => {
  const game = startedGame();
  const alien = enemyAt(game, game.player.x + game.stats.range + 1, game.player.y, 1000);
  game.enemies.push(alien);
  assert.equal(game.closestEnemy(), null);
  game.update(0.05);
  assert.equal(game.bullets.length, 0);
  alien.x = game.player.x + game.stats.range;
  assert.equal(game.closestEnemy(), alien);
  game.update(0.05);
  assert.equal(game.bullets.length, 2);
});

test("targeting uses circular range rather than separate horizontal and vertical limits", () => {
  const game = startedGame();
  game.enemies.push(enemyAt(game, game.player.x + 350, game.player.y + 350));
  assert.equal(game.closestEnemy(), null);
});

test("moving into range starts automatic fire", () => {
  const game = startedGame();
  game.enemies.push(enemyAt(game, game.player.x + 400, game.player.y, 1000));
  game.update(0.1, { x: 1, y: 0 });
  assert.equal(game.bullets.length, 0);
  game.update(0.1, { x: 1, y: 0 });
  assert.equal(game.bullets.length, 2);
});

test("a range purchase extends targeting in the next run and survives saving", () => {
  const profile = Core.createProfile();
  profile.gold = 50;
  const game = startedGame(profile);
  const alien = enemyAt(game, game.player.x + 390, game.player.y);
  game.enemies.push(alien);
  assert.equal(game.closestEnemy(), null);
  Core.buyUpgrade(profile, "range");
  assert.equal(game.stats.range, 360);
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
  game.start(restored);
  game.enemies.push(alien);
  assert.equal(game.stats.range, 400);
  assert.equal(game.closestEnemy(), alien);
  assert.equal(restored.gold, 25);
});

test("bullets from offset guns stop at the shared circular range including muzzle offsets", () => {
  const game = startedGame();
  const origin = game.player.x;
  game.shoot(enemyAt(game, origin + 200, game.player.y));
  const bullet = game.bullets[0];
  const outside = enemyAt(game, origin + game.stats.range + 30, game.player.y, 50);
  game.enemies = [outside];
  for (let i = 0; i < 4; i += 1) game.update(0.1);
  assert.ok(Math.abs(Math.hypot(bullet.x - origin, bullet.y - game.player.y) - game.stats.range) < 1e-9);
  assert.equal(bullet.remainingRange, 0);
  assert.equal(game.bullets.length, 0);
  assert.equal(outside.hp, 50);
});

test("the final clipped bullet segment can still hit a target intersecting the range limit", () => {
  const game = startedGame();
  const origin = game.player.x;
  game.shoot(enemyAt(game, origin + 200, game.player.y));
  const bullet = game.bullets[0];
  game.bullets = [bullet];
  const speed = Math.hypot(bullet.vx, bullet.vy);
  const endX = bullet.x + bullet.vx / speed * bullet.remainingRange;
  const endY = bullet.y + bullet.vy / speed * bullet.remainingRange;
  const target = enemyAt(game, endX + (endX - origin) / game.stats.range * 19, endY + (endY - game.player.y) / game.stats.range * 19, 50);
  game.enemies = [target];
  for (let i = 0; i < 4; i += 1) game.update(0.1);
  assert.equal(target.hp, 50 - game.stats.damage);
  assert.equal(game.bullets.length, 0);
});

test("leaving and re-entering range does not bypass the fire-rate cooldown", () => {
  const game = startedGame();
  const alien = enemyAt(game, game.player.x + game.stats.range + 1, game.player.y, 1000);
  game.enemies.push(alien);
  game.fireTimer = 0.2;
  game.update(0.05);
  assert.ok(game.fireTimer > 0.14);
  alien.x = game.player.x + game.stats.range;
  game.update(0.05);
  assert.equal(game.bullets.length, 0);
});

test("swept bullets hit aliens even when crossing them within one step", () => {
  assert.ok(Core.segmentCircleHit(0, 0, 200, 0, 100, 0, 12) !== null);
  assert.equal(Core.segmentCircleHit(0, 30, 200, 30, 100, 0, 12), null);
  assert.equal(Core.segmentCircleHit(0, 0, 0, 0, 100, 0, 12), null);
  const game = startedGame();
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.enemies = [enemyAt(game, game.player.x + 55, game.player.y, 18)];
  game.update(0.1);
  assert.equal(game.kills, 1);
  assert.equal(game.enemies.length, 0);
  assert.ok(game.pickups.some(p => p.kind === "gold"));
});

test("a killed alien drops gold only once", () => {
  const game = startedGame();
  game.beginWave(1);
  const enemy = enemyAt(game, 40, 40, 10);
  game.hitEnemy(enemy, 18);
  game.hitEnemy(enemy, 18);
  assert.equal(game.kills, 1);
  assert.equal(game.pickups.filter(p => p.kind === "gold").length, 1);
});

test("auto-fire can hit an alien that overlaps the soldier", () => {
  const game = startedGame();
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.player.invulnerable = 1;
  game.enemies = [enemyAt(game, game.player.x, game.player.y, 18)];
  game.update(1 / 60);
  assert.equal(game.kills, 1);
});

test("upgraded fire rates do not lose shots to simulation-step rounding", () => {
  for (const [fireRateLevel, bulletsLevel] of [[15, 0], [15, 1], [25, 0], [25, 1]]) {
    const profile = Core.createProfile();
    profile.levels.fireRate = fireRateLevel;
    profile.levels.bullets = bulletsLevel;
    const game = startedGame(profile);
    game.beginWave(1);
    game.spawnRemaining = 0;
    game.enemies = [enemyAt(game, game.player.x + 200, game.player.y, 1000000)];
    game.drainEvents();
    let shots = 0;
    for (let i = 0; i < 600; i += 1) {
      game.update(1 / 60);
      shots += game.drainEvents().filter(event => event.type === "shot").length;
    }
    assert.ok(Math.abs(shots - game.stats.fireRate * 10) < 1);
  }
});

test("collected gold is banked immediately and distant coins stay on the map", () => {
  const profile = Core.createProfile();
  const game = startedGame(profile);
  game.pickups.push({ kind: "gold", x: game.player.x, y: game.player.y, value: 4, age: 0, magnetized: false });
  game.pickups.push({ kind: "gold", x: 40, y: 40, value: 2, age: 0, magnetized: false });
  game.update(1 / 60);
  assert.equal(profile.gold, 4);
  assert.equal(game.coins, 4);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0].x, 40);
});

test("pickup-radius upgrades attract coins outside the default radius", () => {
  const profile = Core.createProfile();
  profile.levels.pickup = 4;
  const game = startedGame(profile);
  game.pickups.push({ kind: "gold", x: game.player.x + 110, y: game.player.y, value: 2, age: 0, magnetized: false });
  game.update(1 / 60);
  assert.equal(game.pickups[0].magnetized, true);
  for (let i = 0; i < 30; i += 1) game.update(1 / 60);
  assert.equal(profile.gold, 2);
});

test("waves get stronger and advance after all aliens are killed", () => {
  assert.ok(Core.waveSettings(2).hp > Core.waveSettings(1).hp);
  assert.ok(Core.waveSettings(2).damage > Core.waveSettings(1).damage);
  assert.ok(Core.waveSettings(2).count > Core.waveSettings(1).count);
  const game = startedGame();
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.player.hp = 50;
  game.update(1 / 60);
  assert.equal(game.player.hp, 62);
  assert.equal(game.waveActive, false);
  for (let i = 0; i < 212; i += 1) game.update(1 / 60);
  assert.equal(game.wave, 2);
  assert.ok(game.enemies.length > 0);
});

test("wave 1 spawns seventy-two enemies 3.75 times faster while keeping its original health, movement, and attack", () => {
  const settings = Core.waveSettings(1);
  assert.equal(settings.hp, 26);
  assert.equal(settings.speed, 61);
  assert.equal(settings.damage, 8);
  assert.equal(settings.count, 72);
  assert.equal(settings.spawnInterval, 0.64 / 3.75);
  assert.equal(settings.gold, 4);
});

test("every swarm wave has exactly triple its previously doubled enemy budget", () => {
  for (const wave of [...Array.from({ length: Core.LEVEL_WAVES - 1 }, (_, index) => index + 1), 28, 100]) {
    const settings = Core.waveSettings(wave);
    assert.equal(settings.count, 3 * (2 * Math.min(120, 8 + wave * 4)));
    assert.equal(settings.spawnInterval, Math.max(0.17, 0.64 - (wave - 1) * 0.028) / 3.75);
  }
  assert.equal(Core.waveSettings(8).count, 240);
  assert.equal(Core.waveSettings(100).count, 720);
});

test("the spawner is 50 percent faster than the previous 2.5x cadence in every swarm wave", () => {
  const duration = 0.9;
  for (let wave = 1; wave < Core.LEVEL_WAVES; wave += 1) {
    const game = startedGame();
    game.beginWave(wave);
    game.nextBossAt = Infinity;
    game.fireTimer = 10000;
    const previousInterval = Math.max(0.17, 0.64 - (wave - 1) * 0.028) / 2.5;
    assert.ok(Math.abs(previousInterval / game.settings.spawnInterval - 1.5) < 1e-9);
    const expectedSpawns = Math.floor(duration * 1.5 / previousInterval) + 1;
    advanceFrames(game, Math.round(duration * 60));
    assert.equal(game.enemies.length, expectedSpawns, `Spawn cadence at wave ${wave}`);
    assert.equal(game.spawnRemaining, game.settings.count - expectedSpawns);
    assert.equal(game.waveActive, true);
  }
});

test("remaining enemies include queued and living enemies, but not dead enemies or fireballs", () => {
  assert.equal(new Core.Game().enemiesRemaining, 0);
  const game = startedGame();
  assert.equal(game.enemiesRemaining, 0);
  game.beginWave(1);
  assert.equal(game.enemiesRemaining, 72);
  game.fireTimer = 10000;
  game.update(1 / 60);
  assert.equal(game.spawnRemaining, 71);
  assert.equal(game.enemiesRemaining, 72);
  game.killEnemy(game.enemies[0]);
  assert.equal(game.enemiesRemaining, 71);
  game.fireballs.push(fireballAt(40, 40, Core.FIREBALL_SPEED));
  assert.equal(game.enemiesRemaining, 71);
  game.pause();
  advanceFrames(game, 60);
  assert.equal(game.enemiesRemaining, 71);
  game.resume();
  game.spawnEnemy(true);
  assert.equal(game.enemiesRemaining, 72);
  game.killEnemy(game.enemies.at(-1));
  assert.equal(game.enemiesRemaining, 71);
  game.beginWave(8);
  assert.equal(game.enemiesRemaining, 240);
  game.start(game.profile);
  assert.equal(game.enemiesRemaining, 0);
});

test("the final wave counts one overlord remaining and reaches zero on victory", () => {
  const { game, boss } = finalBossEncounter();
  assert.equal(game.enemiesRemaining, 1);
  game.killEnemy(boss);
  assert.equal(game.enemiesRemaining, 0);
  game.update(1 / 60);
  assert.equal(game.report.reason, "victory");
  assert.equal(game.enemiesRemaining, 0);
});

test("the spawner delivers the full tripled budget and waits for the last enemy before clearing", () => {
  for (let wave = 1; wave < Core.LEVEL_WAVES; wave += 1) {
    const game = startedGame();
    game.beginWave(wave);
    game.nextBossAt = Infinity;
    game.fireTimer = 10000;
    game.player.invulnerable = 10000;
    let spawned = 0;
    const maxFrames = Math.ceil(Core.waveSettings(wave).count * Core.waveSettings(wave).spawnInterval * 10) + 10;
    for (let frame = 0; frame < maxFrames && game.spawnRemaining > 0; frame += 1) {
      game.enemies = [];
      game.update(0.1);
      spawned += game.enemies.length;
    }
    assert.equal(game.spawnRemaining, 0);
    assert.equal(spawned, Core.waveSettings(wave).count);
    assert.equal(game.waveActive, true);
    game.enemies = [];
    game.update(0.1);
    assert.equal(game.waveActive, false);
    assert.equal(game.wavesCleared, wave);
  }
});

test("expanded swarms queue excess enemies at the live cap instead of losing their spawn budget", () => {
  const game = startedGame();
  game.beginWave(8);
  game.nextBossAt = Infinity;
  game.fireTimer = 10000;
  game.enemies = Array.from({ length: 85 }, () => enemyAt(game, 40, 40, 1000000));
  game.update(0.1);
  assert.equal(game.spawnRemaining, 240);
  assert.equal(game.enemiesRemaining, 325);
  game.enemies.pop();
  game.update(0.1);
  assert.equal(game.enemies.length, 85);
  assert.equal(game.spawnRemaining, 239);
  assert.equal(game.enemiesRemaining, 324);
  assert.equal(game.waveActive, true);
});

test("health, speed, attack, and normal-alien gold increase every wave with a steeper curve", () => {
  let previous = Core.waveSettings(1);
  for (let wave = 2; wave <= 60; wave += 1) {
    const current = Core.waveSettings(wave);
    assert.ok(current.hp > previous.hp, `Health did not increase at wave ${wave}`);
    assert.ok(current.speed > previous.speed, `Speed did not increase at wave ${wave}`);
    assert.ok(current.damage > previous.damage, `Attack did not increase at wave ${wave}`);
    assert.ok(current.gold > previous.gold, `Gold did not increase at wave ${wave}`);
    assert.ok(current.hp > Math.round(26 * Math.pow(1.17, Math.min(wave - 1, 90))));
    assert.ok(current.speed > Math.min(135, 61 + (wave - 1) * 3));
    assert.ok(current.damage > 8 + Math.min(wave - 1, 200) * 1.4);
    previous = current;
  }
  assert.deepEqual(
    [2, 5, 10].map(wave => {
      const { hp, speed, damage, gold } = Core.waveSettings(wave);
      return { hp, speed, damage, gold };
    }),
    [
      { hp: 34, speed: 67, damage: 10, gold: 6 },
      { hp: 74, speed: 85, damage: 17, gold: 12 },
      { hp: 276, speed: 115, damage: 41, gold: 42 },
    ],
  );
});

test("normal enemy rewards scale with strength while bosses drop 150-gold crystals", () => {
  const rewards = {};
  for (const [name, wave, roll, boss] of [
    ["drone", 1, 0.5, false],
    ["chicken", 1, 0.9, false],
    ["boss", 1, 0.5, true],
    ["wave4drone", 4, 0.5, false],
    ["brute", 4, 0.1, false],
  ]) {
    const game = startedGame();
    game.beginWave(wave);
    game.random = () => roll;
    game.spawnEnemy(boss);
    const enemy = game.enemies[0];
    game.killEnemy(enemy);
    rewards[name] = game.pickups.find(pickup => pickup.kind === (boss ? "crystal" : "gold")).value;
    assert.equal(rewards[name], Core.enemyGold(enemy));
  }
  assert.equal(rewards.drone, 4);
  assert.equal(rewards.chicken, 8);
  assert.equal(rewards.boss, 150);
  assert.equal(rewards.wave4drone, 10);
  assert.equal(rewards.brute, 20);
  assert.ok(rewards.boss > rewards.chicken);
  assert.ok(rewards.chicken > rewards.drone);
  assert.ok(rewards.brute > rewards.wave4drone);
});

test("every wave preserves doubled normal rewards and fixed 150-gold boss crystals", () => {
  const types = new Set();
  for (let wave = 1; wave <= Core.LEVEL_WAVES; wave += 1) {
    for (const [roll, boss, finalBoss] of [[0.1, false, false], [0.3, false, false], [0.5, false, false], [0.7, false, false], [0.9, false, false], [0.5, true, false], ...(wave === Core.LEVEL_WAVES ? [[0.5, true, true]] : [])]) {
      const game = startedGame();
      game.beginWave(wave);
      game.enemies = [];
      game.random = () => roll;
      game.spawnEnemy(boss, { finalBoss });
      const enemy = game.enemies[0];
      types.add(enemy.type);
      const strength = enemy.maxHp / 26 * Math.max(1, enemy.speed / 61) * Math.max(1, enemy.damage / 8);
      const previousGold = Math.max(1, Math.ceil(2 * Math.sqrt(strength)));
      const expected = boss ? 150 : Math.min(Core.MAX_GOLD, previousGold * 2);
      assert.equal(Core.enemyGold(enemy), expected, `${enemy.type} at wave ${wave}`);
      game.killEnemy(enemy);
      assert.equal(game.kills, 1);
      if (finalBoss) assert.equal(game.profile.gold, expected);
      else assert.equal(game.pickups.find(pickup => pickup.kind === (boss ? "crystal" : "gold")).value, expected);
    }
  }
  assert.deepEqual([...types].sort(), ["boss", "brute", "chicken", "drone", "overlord", "runner", "skeleton"]);
});

test("each regular boss drops exactly one red crystal worth 150 gold regardless of wave or wounds", () => {
  assert.equal(Core.BOSS_CRYSTAL_VALUE, 150);
  for (let wave = 1; wave <= Core.LEVEL_WAVES; wave += 1) {
    const game = startedGame();
    game.beginWave(wave);
    game.enemies = [];
    game.spawnEnemy(true);
    const boss = game.enemies[0];
    game.hitEnemy(boss, boss.hp - 1);
    game.killEnemy(boss);
    game.killEnemy(boss);
    assert.equal(game.kills, 1);
    assert.equal(game.profile.gold, 0);
    assert.deepEqual(game.pickups, [{ kind: "crystal", x: boss.x, y: boss.y, value: 150, age: 0, magnetized: false }]);
    assert.equal(game.drainEvents().filter(event => event.type === "kill").length, 1);
  }
});

test("crystals use normal and upgraded pickup attraction, freeze on pause, and credit 150 gold once", () => {
  for (const [level, distance] of [[0, 60], [3, 110]]) {
    const profile = Core.createProfile();
    profile.levels.pickup = level;
    const game = startedGame(profile);
    game.beginWave(1);
    game.spawnRemaining = 1;
    game.spawnTimer = 100;
    game.fireTimer = 100;
    game.spawnEnemy(true);
    const boss = game.enemies[0];
    boss.x = game.player.x + distance;
    boss.y = game.player.y;
    game.killEnemy(boss);
    const crystal = game.pickups[0];
    game.update(1 / 60);
    assert.equal(crystal.magnetized, true);
    assert.ok(crystal.x < boss.x);
    game.pause();
    const paused = JSON.stringify(game.pickups);
    advanceFrames(game, 60);
    assert.equal(JSON.stringify(game.pickups), paused);
    assert.equal(profile.gold, 0);
    game.resume();
    advanceFrames(game, 180);
    assert.equal(profile.gold, 150);
    assert.equal(game.coins, 150);
    assert.equal(game.pickups.length, 0);
    const events = game.drainEvents().filter(event => event.type === "gold");
    assert.equal(events.length, 1);
    assert.equal(events[0].value, 150);
    assert.equal(events[0].kind, "crystal");
    assert.equal(Core.isValidProfile(JSON.parse(JSON.stringify(profile))), true);
  }
});

test("wave collection banks mixed crystals and coins once and preserves crystal animation metadata", () => {
  for (const bank of [0, Core.MAX_GOLD - 100, Core.MAX_GOLD]) {
    const profile = Core.createProfile();
    profile.gold = bank;
    profile.levels.wavePickup = 1;
    const game = startedGame(profile);
    game.beginWave(1);
    game.spawnRemaining = 0;
    game.fireTimer = 100;
    for (let i = 0; i < 2; i += 1) {
      game.spawnEnemy(true);
      const boss = game.enemies.at(-1);
      boss.x = 40 + i * 50;
      boss.y = 40;
      game.killEnemy(boss);
    }
    const crystal = game.pickups[0];
    game.pickups.push(
      { kind: "gold", x: 40, y: Core.HEIGHT - 40, value: 7, age: 0 },
      { kind: "health", x: 200, y: 200, age: 0 },
    );
    game.update(1 / 60);
    const credited = Math.min(307, Core.MAX_GOLD - bank);
    assert.equal(profile.gold, bank + credited);
    assert.equal(game.coins, credited);
    assert.equal(game.pickups.length, 0);
    const events = game.drainEvents().filter(event => event.type === "gold");
    assert.equal(events.length, 1);
    assert.equal(events[0].value, credited);
    assert.deepEqual(events[0].coins, [
      { x: 40, y: 40, kind: "crystal" },
      { x: 90, y: 40, kind: "crystal" },
      { x: 40, y: Core.HEIGHT - 40 },
    ]);
    crystal.kind = "gold";
    crystal.x = 300;
    assert.equal(events[0].coins[0].kind, "crystal");
    assert.equal(events[0].coins[0].x, 40);
    game.update(1 / 60);
    assert.equal(profile.gold, bank + credited);
    assert.equal(game.drainEvents().some(event => event.type === "gold"), false);
  }
});

test("uncollected crystals survive wave boundaries when collection is locked or off", () => {
  for (const [owned, enabled] of [[0, true], [1, false]]) {
    const profile = Core.createProfile();
    profile.levels.wavePickup = owned;
    profile.wavePickupEnabled = enabled;
    const game = startedGame(profile);
    game.beginWave(1);
    game.spawnRemaining = 0;
    game.fireTimer = 100;
    game.spawnEnemy(true);
    const boss = game.enemies[0];
    boss.x = 40;
    boss.y = 40;
    game.killEnemy(boss);
    const crystal = game.pickups[0];
    game.pickups.push({ kind: "health", x: 200, y: 200, age: 0 });
    game.update(1 / 60);
    assert.equal(profile.gold, 0);
    assert.deepEqual(game.pickups, [crystal]);
    game.beginWave(2);
    assert.deepEqual(game.pickups, [crystal]);
    game.player.x = crystal.x;
    game.player.y = crystal.y;
    game.update(1 / 60);
    assert.equal(profile.gold, 150);
    assert.equal(game.pickups.some(pickup => pickup.kind === "crystal"), false);
  }
});

test("a boss killed by a chicken explosion still drops a single 150-gold crystal", () => {
  const { game, chicken } = chickenEncounter(260);
  game.spawnEnemy(true);
  const boss = game.enemies.at(-1);
  boss.x = chicken.x + 70;
  boss.y = chicken.y;
  boss.hp = 1;
  game.random = () => 0.5;
  game.killEnemy(chicken);
  game.killEnemy(boss);
  assert.equal(game.kills, 2);
  assert.deepEqual(game.pickups.map(pickup => [pickup.kind, pickup.value]), [["gold", 8], ["crystal", 150]]);
  game.stats.pickup = Core.WIDTH;
  for (let i = 0; i < 30; i += 1) game.update(0.1);
  assert.equal(game.profile.gold, 158);
  assert.equal(game.coins, 158);
});

test("health, speed, and attack buffs each increase gold rewards", () => {
  const base = { maxHp: 26, speed: 61, damage: 8 };
  const reward = Core.enemyGold(base);
  assert.ok(Core.enemyGold({ ...base, maxHp: 52 }) > reward);
  assert.ok(Core.enemyGold({ ...base, speed: 122 }) > reward);
  assert.ok(Core.enemyGold({ ...base, damage: 16 }) > reward);
});

test("wounded enemies retain their reward even if the current wave changes", () => {
  const game = startedGame();
  game.beginWave(1);
  game.spawnEnemy();
  const enemy = game.enemies[0];
  game.hitEnemy(enemy, enemy.hp - 1);
  assert.equal(enemy.hp, 1);
  game.beginWave(8);
  game.killEnemy(enemy);
  game.killEnemy(enemy);
  const gold = game.pickups.filter(pickup => pickup.kind === "gold");
  assert.equal(gold.length, 1);
  assert.equal(gold[0].value, 4);
  assert.equal(game.kills, 1);
});

test("chicken chain kills award full strength-based rewards that can be collected", () => {
  const { game, chicken } = chickenEncounter(260);
  game.spawnEnemy();
  const second = game.enemies.at(-1);
  second.x = chicken.x + 100;
  second.y = chicken.y;
  game.killEnemy(chicken);
  assert.equal(game.kills, 2);
  assert.deepEqual(game.pickups.filter(pickup => pickup.kind === "gold").map(pickup => pickup.value), [8, 8]);
  game.stats.pickup = Core.WIDTH;
  for (let i = 0; i < 30; i += 1) game.update(0.1);
  assert.equal(game.profile.gold, 16);
  assert.equal(game.coins, 16);
  assert.equal(Core.isValidProfile(game.profile), true);
});

test("boss crystal pickups respect the wallet limit and remain valid save data", () => {
  const profile = Core.createProfile();
  profile.gold = Core.MAX_GOLD - 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnEnemy(true);
  const boss = game.enemies[0];
  boss.x = game.player.x;
  boss.y = game.player.y;
  game.killEnemy(boss);
  assert.equal(game.pickups[0].kind, "crystal");
  assert.equal(game.pickups[0].value, 150);
  game.update(1 / 60);
  assert.equal(profile.gold, Core.MAX_GOLD);
  assert.equal(game.coins, 1);
  assert.equal(Core.isValidProfile(profile), true);
});

test("extreme wave stats and rewards remain finite and currency stays bounded", () => {
  const settings = Core.waveSettings(10000);
  assert.ok(Number.isFinite(settings.hp));
  assert.ok(Number.isFinite(settings.speed));
  assert.ok(Number.isFinite(settings.damage));
  assert.ok(Number.isInteger(settings.gold));
  assert.equal(settings.gold, Core.MAX_GOLD);
});

test("skeletons begin at wave 3 with a 15% spawn share and preserve existing enemy types", () => {
  for (const wave of [1, 2]) {
    const { skeleton } = skeletonEncounter(300, wave);
    assert.equal(skeleton.type, "drone");
  }
  const game = startedGame();
  game.beginWave(4);
  const counts = {};
  for (let i = 0; i < 100; i += 1) {
    game.random = () => i / 100;
    game.spawnEnemy();
    const type = game.enemies.at(-1).type;
    counts[type] = (counts[type] || 0) + 1;
  }
  assert.deepEqual(counts, { brute: 16, runner: 29, drone: 20, skeleton: 15, chicken: 20 });
  game.random = () => 0.7;
  game.spawnEnemy(true);
  assert.equal(game.enemies.at(-1).type, "boss");
  assert.equal(skeletonEncounter().skeleton.type, "skeleton");
});

test("skeleton health, movement, fireball damage, and gold scale with their wave", () => {
  let previous;
  for (const wave of [3, 7]) {
    const { game, skeleton } = skeletonEncounter(300, wave);
    const normal = Core.waveSettings(wave);
    assert.equal(skeleton.maxHp, Math.round(normal.hp * 1.3));
    assert.equal(skeleton.speed, normal.speed * 0.85);
    assert.equal(skeleton.damage, normal.damage * 1.5);
    assert.ok(Core.enemyGold(skeleton) > normal.gold);
    if (previous) {
      assert.ok(skeleton.maxHp > previous.maxHp);
      assert.ok(skeleton.speed > previous.speed);
      assert.ok(skeleton.damage > previous.damage);
      assert.ok(Core.enemyGold(skeleton) > Core.enemyGold(previous));
    }
    game.killEnemy(skeleton);
    assert.equal(game.pickups[0].value, Core.enemyGold(skeleton));
    game.player.x = skeleton.x;
    game.update(1 / 60);
    assert.equal(game.profile.gold, Core.enemyGold(skeleton));
    assert.equal(Core.isValidProfile(game.profile), true);
    previous = skeleton;
  }
});

test("skeletons approach from afar, retreat up close, and hold their firing distance", () => {
  for (const [distance, direction] of [[500, -1], [100, 1], [300, 0]]) {
    const { game, skeleton } = skeletonEncounter(distance);
    const x = skeleton.x;
    game.update(0.1);
    assert.equal(Math.sign(skeleton.x - x), direction);
  }
  const { game, skeleton } = skeletonEncounter(400);
  skeleton.castUntil = game.time + Core.SKELETON_CAST_TIME;
  const position = { x: skeleton.x, y: skeleton.y };
  game.update(0.1);
  assert.deepEqual({ x: skeleton.x, y: skeleton.y }, position);
});

test("skeletons telegraph each fireball for 0.45 seconds and fire twice as fast at one-second intervals", () => {
  assert.equal(Core.SKELETON_FIRE_INTERVAL, 1);
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 32);
  assert.equal(skeleton.castUntil, null);
  assert.equal(game.fireballs.length, 0);
  advanceFrames(game, 1);
  assert.ok(Math.abs(skeleton.castUntil - game.time - Core.SKELETON_CAST_TIME) < 1e-9);
  assert.equal(game.drainEvents().filter(event => event.type === "skeletonCast").length, 1);
  advanceFrames(game, 26);
  assert.equal(game.fireballs.length, 0);
  advanceFrames(game, 1);
  assert.equal(game.fireballs.length, 1);
  assert.equal(skeleton.castUntil, null);
  const ball = game.fireballs[0];
  assert.equal(ball.damage, skeleton.damage);
  assert.equal(ball.radius, Core.FIREBALL_RADIUS);
  assert.equal(ball.life, Core.FIREBALL_LIFETIME);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - Core.FIREBALL_SPEED) < 1e-9);
  assert.ok(ball.vx < 0);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballShot").length, 1);
  advanceFrames(game, 59);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballShot").length, 0);
  advanceFrames(game, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballShot").length, 1);
});

test("skeletons aim at the player's position when firing, not when charging", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 33);
  game.player.y += 80;
  advanceFrames(game, 27);
  const ball = game.fireballs[0];
  const angle = Math.atan2(game.player.y - skeleton.y, game.player.x - skeleton.x);
  assert.ok(Math.abs(ball.vx - Math.cos(angle) * Core.FIREBALL_SPEED) < 1e-9);
  assert.ok(Math.abs(ball.vy - Math.sin(angle) * Core.FIREBALL_SPEED) < 1e-9);
});

test("fireballs travel straight and can be dodged instead of homing on the player", () => {
  const { game } = skeletonEncounter();
  advanceFrames(game, 60);
  const ball = game.fireballs[0];
  const velocity = { vx: ball.vx, vy: ball.vy };
  const y = ball.y;
  game.player.y += 100;
  advanceFrames(game, 60);
  assert.equal(game.player.hp, game.player.maxHp);
  assert.ok(game.fireballs.includes(ball));
  assert.deepEqual({ vx: ball.vx, vy: ball.vy }, velocity);
  assert.ok(Math.abs(ball.y - y) < 1e-9);
});

test("skeletons do not fire outside range and give a full warning when entering range", () => {
  const { game, skeleton } = skeletonEncounter(Core.SKELETON_ATTACK_RANGE + 1);
  skeleton.speed = 0;
  advanceFrames(game, 180);
  assert.equal(skeleton.castUntil, null);
  assert.equal(game.fireballs.length, 0);
  skeleton.x = game.player.x + Core.SKELETON_ATTACK_RANGE;
  game.update(1 / 60);
  assert.ok(skeleton.castUntil > game.time);
  assert.equal(game.fireballs.length, 0);
  advanceFrames(game, 26);
  assert.equal(game.fireballs.length, 0);
  advanceFrames(game, 1);
  assert.equal(game.fireballs.length, 1);
});

test("leaving a skeleton's attack range cancels its current cast", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 33);
  assert.notEqual(skeleton.castUntil, null);
  skeleton.speed = 0;
  game.player.x = skeleton.x - Core.SKELETON_ATTACK_RANGE - 10;
  advanceFrames(game, 30);
  assert.equal(skeleton.castUntil, null);
  assert.equal(game.fireballs.length, 0);
  game.player.x = skeleton.x - 300;
  game.update(1 / 60);
  assert.equal(game.fireballs.length, 0);
  assert.ok(skeleton.castUntil > game.time);
});

test("touching a skeleton does not cause contact damage", () => {
  const { game } = skeletonEncounter(0);
  game.update(0.1);
  assert.equal(game.player.hp, game.player.maxHp);
});

test("a player bullet can kill a skeleton on the final cast frame and prevent its shot", () => {
  const { game, skeleton } = skeletonEncounter();
  skeleton.castUntil = game.time + 1 / 60;
  game.bullets.push({
    x: skeleton.x - 1, y: skeleton.y, prevX: skeleton.x - 1, prevY: skeleton.y,
    vx: 1080, vy: 0, life: 1, remainingRange: 100, damage: skeleton.maxHp,
  });
  game.update(1 / 60);
  assert.equal(game.kills, 1);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballShot").length, 0);
  assert.equal(game.pickups[0].value, Core.enemyGold(skeleton));
});

test("auto-fire targets and kills skeletons before their first fireball", () => {
  const { game, skeleton } = skeletonEncounter();
  game.fireTimer = 0;
  assert.equal(game.closestEnemy(), skeleton);
  advanceFrames(game, 120);
  assert.equal(skeleton.hp, 0);
  assert.equal(game.kills, 1);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.pickups[0].value, Core.enemyGold(skeleton));
});

test("chicken explosions can kill a casting skeleton and award its full gold", () => {
  const { game, skeleton } = skeletonEncounter();
  skeleton.castUntil = game.time + Core.SKELETON_CAST_TIME;
  game.hitEnemy(skeleton, skeleton.hp - 1);
  game.random = () => 0.9;
  game.spawnEnemy();
  const chicken = game.enemies.at(-1);
  chicken.x = skeleton.x - 50;
  chicken.y = skeleton.y;
  game.killEnemy(chicken);
  advanceFrames(game, 30);
  assert.equal(game.kills, 2);
  assert.equal(skeleton.hp, 0);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.pickups.filter(pickup => pickup.kind === "gold").length, 2);
  assert.ok(game.pickups.some(pickup => pickup.kind === "gold" && pickup.value === Core.enemyGold(skeleton)));
});

test("fired fireballs remain dangerous after the skeleton dies and delay wave clear", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 60);
  const ball = game.fireballs[0];
  const x = ball.x;
  game.killEnemy(skeleton);
  game.update(1 / 60);
  assert.ok(ball.x < x);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.enemiesRemaining, 0);
  assert.equal(game.waveActive, true);
  advanceFrames(game, 60);
  assert.equal(game.player.hp, game.player.maxHp - skeleton.damage + game.player.maxHp * 0.12);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.waveActive, false);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === "hurt").length, 1);
  assert.equal(events.filter(event => event.type === "clear").length, 1);
});

test("swept fireball collisions hit the player even when both endpoints miss", () => {
  const game = startedGame();
  game.fireballs.push(fireballAt(game.player.x - 80, game.player.y, 1600));
  game.update(0.1);
  assert.equal(game.player.hp, game.player.maxHp - 18);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballImpact").length, 1);
});

test("relative collision sweeps catch a player crossing a moving fireball", () => {
  const game = startedGame();
  game.stats.speed = 1000;
  game.fireballs.push(fireballAt(game.player.x, game.player.y + 50, Core.FIREBALL_SPEED));
  game.update(0.1, { x: 0, y: 1 });
  assert.equal(game.player.hp, game.player.maxHp - 18);
  assert.equal(game.fireballs.length, 0);
});

test("fireballs expire, leave the arena, and never travel beyond their remaining lifetime", () => {
  const game = startedGame();
  game.fireballs.push(fireballAt(game.player.x - 100, game.player.y, 1600, 0, 18, 0.02));
  game.update(0.1);
  assert.equal(game.player.hp, game.player.maxHp);
  assert.equal(game.fireballs.length, 0);
  game.fireballs.push(fireballAt(10, 50, -Core.FIREBALL_SPEED));
  game.update(0.1);
  assert.equal(game.fireballs.length, 0);
  game.fireballs.push(fireballAt(50, 50, 0, 10));
  advanceFrames(game, 240);
  assert.equal(game.fireballs.length, 0);
});

test("simultaneous fireball hits respect the player's damage invulnerability", () => {
  const game = startedGame();
  game.player.hp = 20;
  game.fireballs.push(
    fireballAt(game.player.x - 20, game.player.y, Core.FIREBALL_SPEED),
    fireballAt(game.player.x + 20, game.player.y, -Core.FIREBALL_SPEED),
  );
  game.update(1 / 60);
  assert.equal(game.player.hp, 2);
  assert.equal(game.phase, "running");
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.drainEvents().filter(event => event.type === "hurt").length, 1);
});

test("lethal fireballs end the run once, clear pending shots, and stop further damage", () => {
  const game = startedGame();
  game.player.hp = 10;
  const later = fireballAt(game.player.x + 200, game.player.y, -Core.FIREBALL_SPEED);
  game.fireballs.push(fireballAt(game.player.x - 20, game.player.y, Core.FIREBALL_SPEED), later);
  game.update(1 / 60);
  assert.equal(game.phase, "ended");
  assert.equal(game.player.hp, 0);
  assert.equal(game.report.reason, "overrun");
  assert.equal(game.profile.totalRuns, 1);
  assert.equal(game.fireballs.length, 0);
  const time = game.time;
  const x = later.x;
  advanceFrames(game, 60);
  assert.equal(game.time, time);
  assert.equal(later.x, x);
  assert.equal(game.profile.totalRuns, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "ended").length, 1);
});

test("pausing freezes skeleton casts and fireballs; retreat and restart discard them", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 33);
  const castUntil = skeleton.castUntil;
  const time = game.time;
  game.pause();
  advanceFrames(game, 300);
  assert.equal(game.time, time);
  assert.equal(skeleton.castUntil, castUntil);
  assert.equal(game.fireballs.length, 0);
  game.resume();
  advanceFrames(game, 27);
  assert.equal(game.fireballs.length, 1);
  const ball = game.fireballs[0];
  const snapshot = { ...ball };
  game.pause();
  advanceFrames(game, 300);
  assert.deepEqual(ball, snapshot);
  game.finish("retreated");
  assert.equal(game.fireballs.length, 0);
  game.start(game.profile);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.time, 0);
});

test("restarting a live run discards incoming fireballs and old skeleton casts", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 33);
  assert.notEqual(skeleton.castUntil, null);
  game.shootFireball(skeleton);
  const ball = game.fireballs[0];
  const snapshot = { ...ball };
  game.start(game.profile);
  assert.equal(game.fireballs.length, 0);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.time, 0);
  advanceFrames(game, 120);
  assert.deepEqual(ball, snapshot);
  assert.equal(game.fireballs.length, 0);
});

test("bosses spawn at 15, 30, and 45 seconds, never before the first interval", () => {
  assert.equal(Core.BOSS_INTERVAL, 15);
  const game = startedGame();
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.player.invulnerable = 10000;
  game.enemies = [enemyAt(game, 40, 40, 1000000000)];
  for (let i = 0; i < 899; i += 1) game.update(1 / 60);
  assert.equal(game.enemies.some(enemy => enemy.type === "boss"), false);
  game.update(1 / 60);
  assert.equal(game.enemies.filter(enemy => enemy.type === "boss").length, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "boss").length, 1);
  assert.equal(game.nextBossAt, 30);
  for (const nextSpawn of [45, 60]) {
    for (let i = 0; i < 900; i += 1) game.update(1 / 60);
    assert.equal(game.drainEvents().filter(event => event.type === "boss").length, 1);
    assert.equal(game.nextBossAt, nextSpawn);
  }
});

test("boss health and speed preserve the current 20x and 4x tuning", () => {
  for (const wave of [1, 4, 8]) {
    const game = startedGame();
    game.beginWave(wave);
    game.spawnEnemy(true);
    const boss = game.enemies[0];
    const settings = Core.waveSettings(wave);
    assert.equal(boss.type, "boss");
    assert.equal(boss.hp, settings.hp * 20);
    assert.equal(boss.maxHp, settings.hp * 20);
    assert.equal(boss.speed, settings.speed * 4);
    assert.equal(boss.damage, settings.damage);
    assert.ok(boss.radius > 25);
  }
});

test("boss spawns are additional to normal waves and continue while a boss is alive", () => {
  const game = startedGame();
  game.beginWave(1);
  game.enemies = Array.from({ length: 85 }, () => enemyAt(game, 40, 40, 1000000));
  game.time = 14.9;
  game.update(0.1);
  assert.equal(game.enemies.length, 86);
  assert.equal(game.enemies.filter(enemy => enemy.type === "boss").length, 1);
  assert.equal(game.spawnRemaining, Core.waveSettings(1).count);
  game.time = 29.9;
  game.update(0.1);
  assert.equal(game.enemies.filter(enemy => enemy.type === "boss").length, 2);
});

test("boss timers stop while paused or ended and reset for a new run", () => {
  const game = startedGame();
  game.beginWave(1);
  game.time = 14.9;
  game.pause();
  for (let i = 0; i < 200; i += 1) game.update(0.1);
  assert.equal(game.time, 14.9);
  assert.equal(game.enemies.length, 0);
  game.resume();
  game.update(0.1);
  assert.equal(game.enemies.filter(enemy => enemy.type === "boss").length, 1);
  game.finish("retreated");
  game.update(0.1);
  assert.equal(game.time, 15);
  game.start(game.profile);
  assert.equal(game.nextBossAt, 15);
  assert.equal(game.time, 0);
  assert.equal(game.enemies.length, 0);
  game.update(0.1);
  assert.equal(game.enemies.length, 0);
});

test("bosses also spawn during the countdown between normal waves", () => {
  const game = startedGame();
  game.beginWave(2);
  game.spawnRemaining = 0;
  game.time = 14.9;
  game.update(0.05);
  assert.equal(game.waveActive, false);
  assert.ok(game.countdown > 0);
  game.update(0.05);
  const boss = game.enemies.find(enemy => enemy.type === "boss");
  assert.ok(boss);
  assert.equal(boss.maxHp, Core.waveSettings(2).hp * 20);
  assert.equal(game.wave, 2);
});

test("bosses are auto-targeted, take bullet damage, drop crystals, and block wave completion", () => {
  const game = startedGame();
  game.beginWave(1);
  game.spawnRemaining = 0;
  game.spawnEnemy(true);
  const boss = game.enemies[0];
  boss.x = game.player.x + 60;
  boss.y = game.player.y;
  assert.equal(game.closestEnemy(), boss);
  game.update(0.05);
  assert.ok(boss.hp < boss.maxHp);
  assert.equal(game.waveActive, true);
  game.hitEnemy(boss, boss.maxHp);
  assert.equal(game.kills, 1);
  assert.ok(game.pickups.some(pickup => pickup.kind === "crystal" && pickup.value === 150));
  game.update(1 / 60);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.waveActive, false);
  assert.ok(game.countdown > 0);
});

test("Level 1 has eight swarm waves and exactly one giant boss on wave nine", () => {
  assert.equal(Core.LEVEL_WAVES, 9);
  const game = startedGame();
  for (let wave = 1; wave < Core.LEVEL_WAVES; wave += 1) {
    game.beginWave(wave);
    assert.equal(game.spawnRemaining, Core.waveSettings(wave).count);
    assert.equal(game.enemies.length, 0);
  }
  game.beginWave(Core.LEVEL_WAVES);
  assert.equal(game.spawnRemaining, 0);
  assert.equal(game.enemies.length, 1);
  assert.equal(game.enemies[0].type, "overlord");
  const settings = Core.waveSettings(Core.LEVEL_WAVES);
  const boss = game.enemies[0];
  assert.equal(boss.maxHp, settings.hp * 20 * 30);
  assert.equal(boss.hp, boss.maxHp);
  assert.equal(boss.speed, 210);
  assert.ok(boss.speed < Core.getStats(Core.createProfile()).speed);
  assert.ok(boss.radius > 36 * 2);
  assert.equal(boss.damage, settings.damage);
  assert.ok(boss.x >= boss.radius && boss.x <= Core.WIDTH - boss.radius);
  assert.ok(boss.y >= boss.radius && boss.y <= Core.HEIGHT - boss.radius);
  assert.equal(game.drainEvents().filter(event => event.type === "boss" && event.finalBoss).length, 1);
  game.spawnEnemy(true);
  assert.equal(boss.maxHp, game.enemies.at(-1).maxHp * Core.FINAL_BOSS_HEALTH_MULTIPLIER);
  for (const wave of [0, 10, 13, 14, 1.5, Infinity]) assert.throws(() => game.beginWave(wave), RangeError);
});

test("the wave-8 countdown leads into the finale without timed boss reinforcements", () => {
  const game = startedGame();
  game.beginWave(8);
  game.spawnRemaining = 0;
  game.time = 14.8;
  game.update(0.1);
  assert.equal(game.wavesCleared, 8);
  advanceFrames(game, 211);
  assert.equal(game.wave, 9);
  assert.deepEqual(game.enemies.map(enemy => enemy.type), ["overlord"]);
  game.player.invulnerable = 10000;
  game.fireTimer = 10000;
  advanceFrames(game, 2700);
  assert.equal(game.wave, 9);
  assert.deepEqual(game.enemies.map(enemy => enemy.type), ["overlord"]);
  assert.equal(game.drainEvents().filter(event => event.type === "boss" && !event.finalBoss).length, 0);
});

test("even an unupgraded soldier can outrun the final boss's grounded chase", () => {
  const game = startedGame();
  game.beginWave(Core.LEVEL_WAVES);
  const boss = game.enemies[0];
  boss.x = 350;
  boss.y = game.player.y;
  boss.nextJumpAt = 10000;
  game.fireTimer = 10000;
  const before = game.player.x - boss.x;
  advanceFrames(game, 60, { x: 1, y: 0 });
  assert.ok(Math.abs((game.player.x - boss.x) - before - (game.stats.speed - boss.speed)) < 1e-8);
  assert.equal(game.damageTaken, 0);
});

test("the final boss warns, leaps to a fixed target, slams once, and recovers", () => {
  const { game, boss } = finalBossEncounter();
  game.update(1 / 60);
  assert.equal(boss.jump.phase, "windup");
  assert.equal(boss.jump.targetX, game.player.x);
  assert.equal(boss.jump.targetY, game.player.y);
  const startX = boss.x;
  advanceFrames(game, JUMP_WINDUP_FRAMES - 1);
  assert.equal(boss.jump.phase, "windup");
  assert.equal(boss.x, startX);
  assert.equal(game.damageTaken, 0);
  game.update(1 / 60);
  assert.equal(boss.jump.phase, "airborne");
  advanceFrames(game, JUMP_FLIGHT_FRAMES - 1);
  assert.equal(boss.jump.phase, "airborne");
  assert.equal(game.damageTaken, 0);
  game.update(1 / 60);
  assert.equal(boss.jump.phase, "recovery");
  assert.equal(boss.x, boss.jump.targetX);
  assert.equal(boss.y, boss.jump.targetY);
  assert.equal(game.damageTaken, boss.damage);
  const events = game.drainEvents();
  for (const type of ["bossWindup", "bossLeap", "bossSlam", "hurt"]) {
    assert.equal(events.filter(event => event.type === type).length, 1);
  }
  game.player.y = 150;
  advanceFrames(game, 38);
  assert.equal(boss.jump.phase, "recovery");
  game.update(1 / 60);
  assert.equal(boss.jump, null);
  advanceFrames(game, 179);
  assert.equal(boss.jump, null);
  game.update(1 / 60);
  assert.equal(boss.jump.phase, "windup");
  assert.equal(game.damageTaken, boss.damage);
});

test("moving away from the marked landing zone dodges the jump without homing", () => {
  const { game, boss } = finalBossEncounter();
  game.update(1 / 60);
  const target = { x: boss.jump.targetX, y: boss.jump.targetY };
  advanceFrames(game, JUMP_SLAM_FRAMES, { x: 0, y: -1 });
  assert.equal(boss.jump.phase, "recovery");
  assert.equal(boss.x, target.x);
  assert.equal(boss.y, target.y);
  assert.equal(game.player.hp, game.player.maxHp);
  assert.equal(game.damageTaken, 0);
  assert.equal(game.drainEvents().filter(event => event.type === "bossSlam").length, 1);
});

test("the final boss reaches 900 units in a 0.25-second leap after a shorter warning", () => {
  assert.equal(Core.FINAL_BOSS_JUMP_RANGE, 900);
  assert.equal(Core.FINAL_BOSS_JUMP_WINDUP, 0.5);
  assert.equal(Core.FINAL_BOSS_JUMP_DURATION, 0.25);
  const { game, boss } = finalBossEncounter();
  game.player.x = 450;
  game.player.invulnerable = 10000;
  boss.x = game.player.x + Core.FINAL_BOSS_JUMP_RANGE;
  const startX = boss.x;
  game.update(1 / 60);
  assert.equal(boss.jump.phase, "windup");
  advanceFrames(game, JUMP_WINDUP_FRAMES);
  assert.equal(boss.jump.phase, "airborne");
  const elapsedFrames = Math.floor(JUMP_FLIGHT_FRAMES / 2);
  advanceFrames(game, elapsedFrames);
  const expectedTravel = Core.FINAL_BOSS_JUMP_RANGE * elapsedFrames / JUMP_FLIGHT_FRAMES;
  assert.ok(Math.abs((startX - boss.x) - expectedTravel) < 1e-8);
  advanceFrames(game, JUMP_FLIGHT_FRAMES - elapsedFrames);
  assert.equal(boss.jump.phase, "recovery");
  assert.equal(boss.x, game.player.x);
  assert.equal(startX - boss.x, 900);
});

test("the tighter jump window rewards a quick reaction but catches a delayed dodge", () => {
  for (const [reactionFrames, hit] of [[12, false], [18, true]]) {
    const { game, boss } = finalBossEncounter();
    game.update(1 / 60);
    advanceFrames(game, reactionFrames);
    advanceFrames(game, JUMP_SLAM_FRAMES - reactionFrames, { x: 0, y: -1 });
    assert.equal(boss.jump.phase, "recovery");
    assert.equal(game.damageTaken, hit ? boss.damage : 0);
    assert.equal(game.drainEvents().filter(event => event.type === "bossSlam").length, 1);
  }
});

test("final boss jumps only begin in range and landing circles include the soldier's body", () => {
  const { game, boss } = finalBossEncounter();
  game.player.x = Core.WIDTH - 100;
  boss.x = 100;
  game.update(1 / 60);
  assert.equal(boss.jump, null);
  assert.equal(game.drainEvents().some(event => event.type === "bossWindup"), false);
  for (const offset of [Core.FINAL_BOSS_SLAM_RADIUS + 17, Core.FINAL_BOSS_SLAM_RADIUS + 17.01]) {
    const encounter = finalBossEncounter();
    encounter.game.update(1 / 60);
    encounter.game.player.x += offset;
    advanceFrames(encounter.game, JUMP_SLAM_FRAMES);
    assert.equal(encounter.boss.jump.phase, "recovery");
    assert.equal(encounter.game.damageTaken, offset === Core.FINAL_BOSS_SLAM_RADIUS + 17 ? encounter.boss.damage : 0);
  }
});

test("final boss landing targets stay in bounds near every arena edge", () => {
  for (const [x, y] of [[27, 27], [Core.WIDTH - 27, 27], [27, Core.HEIGHT - 27], [Core.WIDTH - 27, Core.HEIGHT - 27]]) {
    const { game, boss } = finalBossEncounter();
    game.player.x = x;
    game.player.y = y;
    boss.x = Core.WIDTH / 2;
    boss.y = Core.HEIGHT / 2;
    boss.nextJumpAt = 0;
    boss.x = x < Core.WIDTH / 2 ? 250 : Core.WIDTH - 250;
    boss.y = y < Core.HEIGHT / 2 ? 250 : Core.HEIGHT - 250;
    game.update(1 / 60);
    assert.equal(boss.jump.phase, "windup");
    assert.ok(boss.jump.targetX >= boss.radius && boss.jump.targetX <= Core.WIDTH - boss.radius);
    assert.ok(boss.jump.targetY >= boss.radius && boss.jump.targetY <= Core.HEIGHT - boss.radius);
    advanceFrames(game, JUMP_SLAM_FRAMES);
    assert.equal(boss.x, boss.jump.targetX);
    assert.equal(boss.y, boss.jump.targetY);
  }
});

test("pause freezes the final boss's warning and flight; restart discards the encounter", () => {
  const { game, boss } = finalBossEncounter();
  game.update(1 / 60);
  for (const count of [0, JUMP_WINDUP_FRAMES + Math.floor(JUMP_FLIGHT_FRAMES / 2)]) {
    advanceFrames(game, count);
    const snapshot = JSON.parse(JSON.stringify(boss));
    const time = game.time;
    game.pause();
    advanceFrames(game, 300, { x: 1, y: 0 });
    assert.equal(game.time, time);
    assert.deepEqual(boss, snapshot);
    game.resume();
  }
  game.finish("retreated");
  const snapshot = JSON.parse(JSON.stringify(boss));
  advanceFrames(game, 120);
  assert.deepEqual(boss, snapshot);
  game.start(game.profile);
  assert.equal(game.wave, 0);
  assert.equal(game.bulletsFired, 0);
  assert.equal(game.damageTaken, 0);
  assert.equal(game.wavesCleared, 0);
  assert.equal(game.report, null);
  assert.equal(game.enemies.length, 0);
  advanceFrames(game, 97);
  assert.equal(game.wave, 1);
});

test("killing the final boss during windup or flight prevents its remaining attacks", () => {
  for (const count of [1, 1 + JUMP_WINDUP_FRAMES + Math.floor(JUMP_FLIGHT_FRAMES / 2)]) {
    const { game, boss } = finalBossEncounter();
    advanceFrames(game, count);
    game.drainEvents();
    game.hitEnemy(boss, boss.maxHp);
    game.hitEnemy(boss, boss.maxHp);
    game.update(1 / 60);
    assert.equal(game.phase, "ended");
    assert.equal(game.report.reason, "victory");
    assert.equal(game.report.kills, 1);
    assert.equal(game.damageTaken, 0);
    assert.equal(game.report.gold, Core.enemyGold(boss));
    assert.equal(game.drainEvents().some(event => ["bossLeap", "bossSlam"].includes(event.type)), false);
  }
});

test("automatic bullets can defeat the final boss and finalize its kill and shot statistics", () => {
  const { game, boss } = finalBossEncounter(120);
  boss.hp = game.stats.damage;
  game.fireTimer = 0;
  game.update(1 / 60);
  assert.equal(game.phase, "ended");
  assert.equal(game.report.reason, "victory");
  assert.equal(game.report.kills, 1);
  assert.equal(game.report.bulletsFired, 2);
  assert.equal(game.report.damageTaken, 0);
  assert.equal(game.report.gold, Core.enemyGold(boss));
  assert.equal(game.drainEvents().some(event => event.type === "bossWindup"), false);
});

test("a lethal landing loses the run rather than granting victory", () => {
  const { game, boss } = finalBossEncounter();
  game.player.hp = 10;
  advanceFrames(game, 1 + JUMP_SLAM_FRAMES);
  assert.equal(game.phase, "ended");
  assert.equal(game.report.reason, "overrun");
  assert.equal(game.report.damageTaken, 10);
  assert.equal(game.report.wavesCleared, 0);
  assert.ok(boss.hp > 0);
  advanceFrames(game, 600);
  assert.equal(game.report.reason, "overrun");
});

test("all nine wave clears end in a single victory without wave ten", () => {
  const profile = Core.createProfile();
  profile.levels.wavePickup = 1;
  const game = startedGame(profile);
  for (let wave = 1; wave <= Core.LEVEL_WAVES; wave += 1) {
    game.beginWave(wave);
    game.spawnRemaining = 0;
    if (wave < Core.LEVEL_WAVES) game.enemies.push(enemyAt(game, 40, 40));
    game.shoot(game.enemies[0]);
    game.bullets = [];
    game.player.invulnerable = 0;
    game.hurt(1, game.player.x, game.player.y);
    for (const enemy of game.enemies) game.killEnemy(enemy);
    game.update(1 / 60);
    assert.equal(game.wavesCleared, wave);
    assert.equal(game.phase, wave === Core.LEVEL_WAVES ? "ended" : "running");
  }
  assert.equal(game.report.reason, "victory");
  assert.equal(game.report.level, 1);
  assert.equal(game.report.wave, 9);
  assert.equal(game.report.wavesCleared, 9);
  assert.equal(game.report.kills, 9);
  assert.equal(game.report.bulletsFired, 18);
  assert.equal(game.report.damageTaken, 9);
  assert.equal(game.report.gold, profile.gold);
  assert.equal(game.report.gold, game.coins);
  assert.equal(game.pickups.filter(pickup => pickup.kind === "gold").length, 0);
  const report = { ...game.report };
  const gold = profile.gold;
  const runs = profile.totalRuns;
  advanceFrames(game, 3600);
  game.finish("victory");
  assert.deepEqual(game.report, report);
  assert.equal(game.wave, 9);
  assert.equal(game.countdown, 0);
  assert.equal(game.waveActive, false);
  assert.equal(profile.gold, gold);
  assert.equal(profile.totalRuns, runs);
  assert.equal(game.drainEvents().filter(event => event.type === "ended").length, 1);
  assert.equal(Core.isValidProfile(JSON.parse(JSON.stringify(profile))), true);
});

test("the final boss's 150-gold crystal is banked once even with wave pickup off or a full wallet", () => {
  for (const bank of [0, Core.MAX_GOLD - 2, Core.MAX_GOLD]) {
    const profile = Core.createProfile();
    profile.gold = bank;
    profile.wavePickupEnabled = false;
    const { game, boss } = finalBossEncounter(300, profile);
    assert.equal(Core.enemyGold(boss), 150);
    const reward = Math.min(Core.MAX_GOLD - bank, Core.enemyGold(boss));
    game.killEnemy(boss);
    game.killEnemy(boss);
    assert.equal(profile.gold, bank + reward);
    assert.equal(game.coins, reward);
    assert.equal(game.pickups.some(pickup => pickup.kind === "gold" || pickup.kind === "crystal"), false);
    const collected = game.drainEvents().filter(event => event.type === "gold");
    assert.equal(collected.length, 1);
    assert.equal(collected[0].kind, "crystal");
    assert.equal(collected[0].value, reward);
    game.update(1 / 60);
    assert.equal(game.report.reason, "victory");
    assert.equal(game.report.gold, reward);
  }
});

test("victory waits for lingering fireballs rather than finishing while shots remain dangerous", () => {
  const { game, boss } = finalBossEncounter();
  game.killEnemy(boss);
  game.fireballs.push(fireballAt(40, 40, 0, 0, 10, 0.1));
  game.update(1 / 60);
  assert.equal(game.phase, "running");
  advanceFrames(game, 6);
  assert.equal(game.phase, "ended");
  assert.equal(game.report.reason, "victory");
});

test("bullets fired count two or four individual projectiles from both guns", () => {
  for (const level of [0, 1]) {
    const profile = Core.createProfile();
    profile.levels.bullets = level;
    const game = startedGame(profile);
    const target = enemyAt(game, game.player.x + 200, game.player.y, 10000);
    game.enemies.push(target);
    advanceFrames(game, 60);
    const shots = game.drainEvents().filter(event => event.type === "shot").length;
    assert.ok(shots > 0);
    assert.equal(game.bulletsFired, shots * (level + 1) * 2);
    const fired = game.bulletsFired;
    game.pause();
    advanceFrames(game, 60);
    assert.equal(game.bulletsFired, fired);
    game.finish("retreated");
    assert.equal(game.report.bulletsFired, fired);
    game.start(profile);
    assert.equal(game.bulletsFired, 0);
  }
});

test("damage taken counts actual health lost, excludes blocked hits, and is not reduced by healing", () => {
  const game = startedGame();
  game.hurt(13.5, game.player.x, game.player.y);
  assert.equal(game.damageTaken, 13.5);
  game.hurt(50, game.player.x, game.player.y);
  assert.equal(game.damageTaken, 13.5);
  game.player.invulnerable = 0;
  game.pickups.push({ kind: "health", x: game.player.x, y: game.player.y, age: 0 });
  game.update(1 / 60);
  assert.equal(game.player.hp, 100);
  assert.equal(game.damageTaken, 13.5);
  game.hurt(7.25, game.player.x, game.player.y);
  assert.equal(game.damageTaken, 20.75);
  game.player.invulnerable = 0;
  game.pause();
  game.hurt(1000, game.player.x, game.player.y);
  assert.equal(game.damageTaken, 20.75);
  game.resume();
  game.hurt(1000, game.player.x, game.player.y);
  assert.equal(game.report.damageTaken, 113.5);
  game.hurt(1000, game.player.x, game.player.y);
  assert.equal(game.damageTaken, 113.5);
});

test("normal waves spawn chickens without changing guaranteed boss spawns", () => {
  const game = startedGame();
  game.random = () => 0.9;
  game.beginWave(1);
  game.update(1 / 60);
  const chicken = game.enemies[0];
  assert.equal(chicken.type, "chicken");
  assert.equal(chicken.maxHp, Math.round(Core.waveSettings(1).hp * 0.8));
  assert.equal(chicken.speed, Core.waveSettings(1).speed * 1.6);
  assert.equal(chicken.damage, Core.waveSettings(1).damage * 3);
  assert.equal(chicken.explodeAt, null);
  assert.equal(game.spawnRemaining, Core.waveSettings(1).count - 1);
  game.spawnEnemy(true);
  assert.equal(game.enemies[1].type, "boss");
  game.random = () => 0.5;
  game.spawnEnemy();
  assert.equal(game.enemies[2].type, "drone");
});

test("chicken proximity starts one fuse, never before entering the trigger distance", () => {
  const { game, chicken } = chickenEncounter(Core.CHICKEN_TRIGGER_DISTANCE + 1);
  game.update(1 / 60);
  assert.equal(chicken.explodeAt, null);
  chicken.x = game.player.x + Core.CHICKEN_TRIGGER_DISTANCE;
  game.update(1 / 60);
  assert.equal(chicken.explodeAt, game.time + 1.5);
  const deadline = chicken.explodeAt;
  game.update(1 / 60);
  assert.equal(chicken.explodeAt, deadline);
  assert.equal(game.drainEvents().filter(event => event.type === "chickenArmed").length, 1);
});

test("chickens explode exactly 1.5 seconds after arming and only once", () => {
  assert.equal(Core.CHICKEN_FUSE_DELAY, 1.5);
  const { game, chicken } = chickenEncounter();
  game.update(1 / 60);
  for (let i = 0; i < 89; i += 1) game.update(1 / 60);
  assert.ok(game.enemies.includes(chicken));
  assert.equal(game.player.hp, 100);
  assert.equal(game.drainEvents().some(event => event.type === "explosion"), false);
  game.update(1 / 60);
  assert.equal(chicken.hp, 0);
  assert.equal(game.enemies.includes(chicken), false);
  assert.equal(game.player.hp, 100 - chicken.damage);
  assert.equal(game.kills, 1);
  const explosions = game.drainEvents().filter(event => event.type === "explosion");
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].radius, Core.CHICKEN_EXPLOSION_RADIUS);
  for (let i = 0; i < 120; i += 1) game.update(1 / 60);
  assert.equal(game.drainEvents().some(event => event.type === "explosion"), false);
});

test("touching a chicken does not damage the player before its fuse expires", () => {
  const { game, chicken } = chickenEncounter(5);
  game.update(1 / 60);
  assert.ok(chicken.explodeAt !== null);
  for (let i = 0; i < 60; i += 1) game.update(1 / 60);
  assert.equal(game.player.hp, 100);
  assert.equal(game.phase, "running");
});

test("armed chickens stop moving and keep their fuse lit after the player escapes", () => {
  const { game, chicken } = chickenEncounter();
  chicken.speed = 100;
  game.update(1 / 60);
  const origin = { x: chicken.x, y: chicken.y };
  const deadline = chicken.explodeAt;
  game.player.x = chicken.x + Core.CHICKEN_EXPLOSION_RADIUS + game.player.radius + 1;
  for (let i = 0; i < 90; i += 1) game.update(1 / 60);
  assert.equal(chicken.x, origin.x);
  assert.equal(chicken.y, origin.y);
  assert.equal(chicken.explodeAt, deadline);
  assert.equal(game.player.hp, 100);
  assert.equal(game.drainEvents().filter(event => event.type === "explosion").length, 1);
});

test("shooting an armed chicken detonates it immediately and awards loot once", () => {
  const { game, chicken } = chickenEncounter();
  game.update(1 / 60);
  assert.ok(chicken.explodeAt !== null);
  game.hitEnemy(chicken, chicken.hp);
  game.hitEnemy(chicken, 10);
  assert.equal(game.player.hp, 100 - chicken.damage);
  assert.ok(game.time < chicken.explodeAt);
  assert.equal(game.kills, 1);
  assert.equal(game.pickups.filter(pickup => pickup.kind === "gold").length, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "explosion").length, 1);
  for (let i = 0; i < 120; i += 1) game.update(1 / 60);
  assert.equal(game.enemies.includes(chicken), false);
  assert.equal(game.player.hp, 100 - chicken.damage);
  assert.equal(game.drainEvents().some(event => event.type === "explosion"), false);
});

test("an unarmed chicken's death damages nearby aliens and bosses, but not distant enemies", () => {
  const { game, chicken } = chickenEncounter(260);
  const nearby = enemyAt(game, chicken.x + 80, chicken.y, 50);
  const edge = enemyAt(game, chicken.x + Core.CHICKEN_EXPLOSION_RADIUS + 17, chicken.y, 50);
  const outside = enemyAt(game, edge.x + 1, chicken.y, 50);
  game.spawnEnemy(true);
  const boss = game.enemies.at(-1);
  boss.x = chicken.x - 80;
  boss.y = chicken.y;
  game.enemies.push(nearby, edge, outside);
  assert.equal(chicken.explodeAt, null);
  game.hitEnemy(chicken, chicken.hp);
  assert.equal(nearby.hp, 50 - chicken.damage);
  assert.equal(edge.hp, 50 - chicken.damage);
  assert.equal(outside.hp, 50);
  assert.equal(boss.hp, boss.maxHp - chicken.damage);
  assert.equal(game.player.hp, 100);
  assert.equal(game.kills, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "explosion").length, 1);
});

test("timed chicken explosions also damage nearby aliens", () => {
  const { game, chicken } = chickenEncounter();
  const alien = enemyAt(game, chicken.x + 60, chicken.y, 50);
  game.enemies.push(alien);
  game.update(1 / 60);
  for (let i = 0; i < 90; i += 1) game.update(1 / 60);
  assert.equal(alien.hp, 50 - chicken.damage);
  assert.equal(game.player.hp, 100 - chicken.damage);
});

test("chicken chain reactions award one explosion and one loot drop per defeated enemy", () => {
  const { game, chicken } = chickenEncounter(260);
  game.spawnEnemy();
  game.spawnEnemy();
  const second = game.enemies[2];
  const third = game.enemies[3];
  second.x = chicken.x + 100;
  second.y = chicken.y;
  third.x = chicken.x + 200;
  third.y = chicken.y;
  const alien = enemyAt(game, third.x + 80, chicken.y, 20);
  game.enemies.push(alien);
  game.hitEnemy(chicken, chicken.hp);
  game.hitEnemy(chicken, 100);
  game.killEnemy(second);
  assert.equal(second.hp, 0);
  assert.equal(third.hp, 0);
  assert.equal(alien.hp, 0);
  assert.equal(game.kills, 4);
  assert.equal(game.pickups.filter(pickup => pickup.kind === "gold").length, 4);
  assert.equal(game.drainEvents().filter(event => event.type === "explosion").length, 3);
  assert.equal(game.explosionQueue.length, 0);
  assert.equal(game.player.hp, 100);
  game.update(1 / 60);
  assert.equal(game.enemies.length, 1);
});

test("a chicken that survives blast damage does not detonate", () => {
  const { game, chicken } = chickenEncounter(260);
  game.spawnEnemy();
  const survivor = game.enemies.at(-1);
  survivor.x = chicken.x + 80;
  survivor.y = chicken.y;
  survivor.hp = survivor.maxHp = 100;
  game.hitEnemy(chicken, chicken.hp);
  assert.equal(survivor.hp, 100 - chicken.damage);
  assert.equal(survivor.explodeAt, null);
  assert.equal(game.kills, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "explosion").length, 1);
});

test("dense chicken clusters resolve once without recursive explosions", () => {
  const { game, chicken } = chickenEncounter(260);
  const cluster = Array.from({ length: 80 }, () => ({ ...chicken }));
  game.enemies = [game.enemies[1], ...cluster];
  game.hitEnemy(cluster[0], cluster[0].hp);
  assert.ok(cluster.every(enemy => enemy.hp === 0));
  assert.equal(game.kills, 80);
  assert.equal(game.pickups.filter(pickup => pickup.kind === "gold").length, 80);
  assert.equal(game.drainEvents().filter(event => event.type === "explosion").length, 80);
  assert.equal(game.explosionQueue.length, 0);
});

test("a lethal bullet-triggered blast records collateral kills and stops later bullets", () => {
  const { game, chicken } = chickenEncounter();
  game.player.hp = 1;
  const distant = game.enemies[1];
  distant.hp = distant.maxHp = 1;
  const collateral = enemyAt(game, chicken.x + 70, chicken.y, 1);
  game.enemies.push(collateral);
  game.bullets = [
    { x: game.player.x + 30, y: game.player.y, vx: 1080, vy: 0, life: 2, remainingRange: game.stats.range - 30, damage: 1000 },
    { x: distant.x, y: distant.y, vx: 0, vy: 0, life: 2, remainingRange: game.stats.range, damage: 2 },
  ];
  game.update(0.05);
  assert.equal(game.phase, "ended");
  assert.equal(game.player.hp, 0);
  assert.equal(game.kills, 2);
  assert.equal(game.report.kills, 2);
  assert.equal(game.profile.bestKills, 2);
  assert.equal(distant.hp, 1);
  assert.equal(collateral.hp, 0);
  assert.equal(game.enemies.includes(chicken), false);
});

test("pausing freezes chicken fuses and ending or restarting a run discards them", () => {
  const { game, chicken } = chickenEncounter();
  game.update(1 / 60);
  const pausedTime = game.time;
  game.pause();
  for (let i = 0; i < 100; i += 1) game.update(0.1);
  assert.equal(game.time, pausedTime);
  assert.ok(game.enemies.includes(chicken));
  game.resume();
  for (let i = 0; i < 60; i += 1) game.update(1 / 60);
  assert.ok(chicken.hp > 0);
  game.finish("retreated");
  for (let i = 0; i < 100; i += 1) game.update(0.1);
  assert.equal(game.drainEvents().some(event => event.type === "explosion"), false);
  game.start(game.profile);
  assert.equal(game.enemies.length, 0);
});

test("a chicken explosion can end a run and records its death before the result", () => {
  const { game, chicken } = chickenEncounter();
  game.player.hp = 1;
  game.update(1 / 60);
  for (let i = 0; i < 90; i += 1) game.update(1 / 60);
  assert.equal(game.phase, "ended");
  assert.equal(game.player.hp, 0);
  assert.equal(game.enemies.includes(chicken), false);
  assert.equal(game.report.kills, 1);
  assert.equal(game.profile.totalRuns, 1);
});

test("self-destructing chickens do not block the next wave", () => {
  const { game, chicken } = chickenEncounter();
  game.enemies = [chicken];
  game.update(1 / 60);
  for (let i = 0; i < 90; i += 1) game.update(1 / 60);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.waveActive, false);
  assert.ok(game.countdown > 0);
  assert.equal(game.kills, 1);
});

test("contact damage ends a run once and preserves gold and records", () => {
  const profile = Core.createProfile();
  profile.gold = 15;
  const game = startedGame(profile);
  game.beginWave(4);
  game.kills = 12;
  game.time = 40;
  game.hurt(200, 0, 0);
  assert.equal(game.phase, "ended");
  assert.equal(game.player.hp, 0);
  assert.equal(profile.bestWave, 4);
  assert.equal(profile.bestKills, 12);
  assert.equal(profile.totalRuns, 1);
  assert.equal(profile.gold, 15);
  game.finish("overrun");
  assert.equal(profile.totalRuns, 1);
  assert.equal(Core.isValidProfile(profile), true);
});

test("pausing stops time and movement, and a new run restores upgraded health", () => {
  const profile = Core.createProfile();
  profile.levels.hp = 2;
  const game = startedGame(profile);
  game.pause();
  game.update(0.1, { x: 1, y: 0 });
  assert.equal(game.time, 0);
  assert.equal(game.player.x, Core.WIDTH / 2);
  game.resume();
  game.update(0.1, { x: 1, y: 0 });
  assert.equal(game.time, 0.1);
  game.finish("retreated");
  game.start(profile);
  assert.equal(game.player.hp, 140);
  assert.equal(game.kills, 0);
  assert.equal(game.coins, 0);
  assert.equal(game.time, 0);
});

test("health pickups heal without exceeding the suit's maximum", () => {
  const game = startedGame();
  game.player.hp = 90;
  game.pickups.push({ kind: "health", x: game.player.x, y: game.player.y, age: 0 });
  game.update(1 / 60);
  assert.equal(game.player.hp, 100);
  assert.equal(game.pickups.length, 0);
});

test("profile data survives a JSON save round trip", () => {
  const profile = Core.createProfile();
  profile.gold = 70;
  Core.buyUpgrade(profile, "hp");
  const restored = JSON.parse(JSON.stringify(profile));
  assert.equal(Core.isValidProfile(restored), true);
  assert.equal(Core.getStats(restored).hp, 120);
  assert.equal(restored.gold, 45);
});
