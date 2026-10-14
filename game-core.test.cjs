"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("./game-core.js");

function startedGame(profile = Core.createProfile()) {
  const game = new Core.Game(() => 0.5);
  game.start(profile);
  game.drainEvents();
  return game;
}

function enemyAt(game, x, y, hp = 50) {
  return { x, y, hp, maxHp: hp, radius: 17, speed: 0, damage: 8, type: "drone", color: "#a8d673", contactTimer: 0, hitFlash: 0, angle: 0, wobble: 0 };
}

function chickenEncounter(distance = 60) {
  const game = startedGame();
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
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, range: 0, bullets: 0, wavePickup: 0 } });
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.getStats(migrated).range, 360);
  assert.equal(Core.getStats(migrated).bullets, 1);
  assert.equal(Core.getStats(migrated).wavePickup, 0);
  assert.equal(Core.migrateProfile(migrated), migrated);
});

test("dual bullets cost 2500 for two bullets and 7500 for three, capped at level two", () => {
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
  assert.equal(Core.upgradeCost(profile, "bullets"), 7500);
  profile.gold = 7499;
  const beforeSecondLevel = JSON.stringify(profile);
  assert.equal(Core.buyUpgrade(profile, "bullets").success, false);
  assert.equal(JSON.stringify(profile), beforeSecondLevel);
  profile.gold = 7500;
  assert.deepEqual(Core.buyUpgrade(profile, "bullets"), { success: true, cost: 7500 });
  assert.equal(profile.gold, 0);
  assert.equal(profile.levels.bullets, 2);
  assert.equal(Core.getStats(profile).bullets, 3);
  profile.gold = 10000;
  assert.equal(Core.upgradeCost(profile, "bullets"), null);
  assert.equal(Core.buyUpgrade(profile, "bullets").success, false);
  assert.equal(profile.gold, 10000);
  assert.equal(profile.levels.bullets, 2);
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
  for (const level of [-1, 3, 0.5, null, "1"]) {
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
  assert.equal(game.bullets.length, 2);
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
  assert.equal(Core.upgradeCost(restored, "bullets"), 7500);
  assert.equal(Core.upgradeCost(restored, "wavePickup"), null);
});

test("the three-bullet upgrade applies next run and survives saving at level two", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  profile.gold = 8000;
  const game = startedGame(profile);
  assert.deepEqual(Core.buyUpgrade(profile, "bullets"), { success: true, cost: 7500 });
  assert.equal(game.stats.bullets, 2);
  const restored = Core.migrateProfile(JSON.parse(JSON.stringify(profile)));
  assert.equal(restored.gold, 500);
  assert.equal(restored.levels.bullets, 2);
  assert.equal(Core.isValidProfile(restored), true);
  game.start(restored);
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  assert.equal(game.stats.bullets, 3);
  assert.equal(game.bullets.length, 3);
  assert.equal(Core.upgradeCost(restored, "bullets"), null);
});

test("three bullets deal full upgraded damage simultaneously without increasing fire rate", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 2;
  profile.levels.damage = 2;
  const game = startedGame(profile);
  const target = enemyAt(game, game.player.x + 55, game.player.y, 120);
  game.enemies.push(target);
  game.update(1 / 60);
  assert.equal(target.hp, 30);
  const events = game.drainEvents();
  assert.equal(events.filter(event => event.type === "hit" && event.damage === 30).length, 3);
  assert.equal(events.filter(event => event.type === "shot").length, 1);
  game.update(1 / 60);
  assert.equal(target.hp, 30);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 0);
});

test("dual bullets fire simultaneously in parallel with full damage and one cooldown", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  profile.levels.damage = 2;
  const game = startedGame(profile);
  game.enemies.push(enemyAt(game, game.player.x + 200, game.player.y, 1000));
  game.update(1 / 60);
  assert.equal(game.bullets.length, 2);
  const [left, right] = game.bullets;
  assert.equal(left.x, right.x);
  assert.equal(right.y - left.y, 10);
  assert.equal(left.vx, right.vx);
  assert.equal(left.vy, right.vy);
  assert.equal(left.damage, 30);
  assert.equal(right.damage, 30);
  assert.equal(left.remainingRange, right.remainingRange);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 1);
  game.update(1 / 60);
  assert.equal(game.bullets.length, 2);
  assert.equal(game.drainEvents().filter(event => event.type === "shot").length, 0);
});

test("both bullets can damage the same enemy without duplicating rewards for a kill", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnRemaining = 0;
  const target = enemyAt(game, game.player.x + 55, game.player.y, 100);
  game.enemies.push(target);
  game.update(1 / 60);
  assert.equal(target.hp, 100 - game.stats.damage * 2);
  assert.equal(game.drainEvents().filter(event => event.type === "hit").length, 2);
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

test("two and three bullets stay inside circular weapon range at every firing angle", () => {
  for (const level of [1, 2]) {
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

test("both paired bullets can hit on the final clipped range segment", () => {
  const profile = Core.createProfile();
  profile.levels.bullets = 1;
  const game = startedGame(profile);
  game.shoot(enemyAt(game, game.player.x + 200, game.player.y));
  const target = enemyAt(game, game.player.x + game.stats.range + 19, game.player.y, 100);
  game.enemies.push(target);
  for (let i = 0; i < 4; i += 1) game.update(0.1);
  assert.equal(target.hp, 100 - game.stats.damage * 2);
  assert.equal(game.bullets.length, 0);
});

test("two and three bullets keep the full upgraded range up to 960 units", () => {
  for (const level of [1, 2]) {
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

test("wave collection waits for a full clear, collects every distant coin once, and leaves medkits", () => {
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
  assert.deepEqual(game.pickups, [medkit]);
  const events = game.drainEvents();
  const collected = events.filter(event => event.type === "gold");
  assert.equal(collected.length, 1);
  assert.equal(collected[0].value, 18);
  assert.equal(events.filter(event => event.type === "clear").length, 1);
  game.update(1 / 60);
  assert.equal(profile.gold, 18);
  assert.equal(game.drainEvents().filter(event => event.type === "gold").length, 0);
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

test("auto-fire chooses the nearest living alien", () => {
  const game = startedGame();
  const far = enemyAt(game, game.player.x - 200, game.player.y);
  const near = enemyAt(game, game.player.x + 100, game.player.y);
  const dead = enemyAt(game, game.player.x, game.player.y + 5, 0);
  game.enemies.push(far, near, dead);
  assert.equal(game.closestEnemy(), near);
  game.update(1 / 60);
  assert.equal(game.bullets.length, 1);
  assert.ok(game.bullets[0].vx > 0);
  assert.ok(Math.abs(game.bullets[0].vy) < 1e-8);
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
  assert.equal(game.bullets.length, 1);
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
  assert.equal(game.bullets.length, 1);
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

test("bullets stop at their full range measured from the launch position, including muzzle offset", () => {
  const game = startedGame();
  const origin = game.player.x;
  game.shoot(enemyAt(game, origin + 200, game.player.y));
  const bullet = game.bullets[0];
  const outside = enemyAt(game, origin + game.stats.range + 30, game.player.y, 50);
  game.enemies = [outside];
  for (let i = 0; i < 4; i += 1) game.update(0.1);
  assert.equal(bullet.x, origin + game.stats.range);
  assert.equal(bullet.remainingRange, 0);
  assert.equal(game.bullets.length, 0);
  assert.equal(outside.hp, 50);
});

test("the final clipped bullet segment can still hit a target intersecting the range limit", () => {
  const game = startedGame();
  const origin = game.player.x;
  game.shoot(enemyAt(game, origin + 200, game.player.y));
  const target = enemyAt(game, origin + game.stats.range + 19, game.player.y, 50);
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
  for (const bulletsLevel of [0, 1, 2]) {
    const profile = Core.createProfile();
    profile.levels.fireRate = 15;
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

test("wave 1 keeps its original health, movement, attack, and spawn pressure", () => {
  const settings = Core.waveSettings(1);
  assert.equal(settings.hp, 26);
  assert.equal(settings.speed, 61);
  assert.equal(settings.damage, 8);
  assert.equal(settings.count, 12);
  assert.equal(settings.spawnInterval, 0.64);
  assert.equal(settings.gold, 2);
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
      { hp: 34, speed: 67, damage: 10, gold: 3 },
      { hp: 74, speed: 85, damage: 17, gold: 6 },
      { hp: 276, speed: 115, damage: 41, gold: 21 },
    ],
  );
});

test("stronger enemy types drop higher-value gold using their actual stats", () => {
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
    rewards[name] = game.pickups.find(pickup => pickup.kind === "gold").value;
    assert.equal(rewards[name], Core.enemyGold(enemy));
  }
  assert.equal(rewards.drone, 2);
  assert.equal(rewards.chicken, 4);
  assert.equal(rewards.boss, 18);
  assert.equal(rewards.wave4drone, 5);
  assert.equal(rewards.brute, 10);
  assert.ok(rewards.boss > rewards.chicken);
  assert.ok(rewards.chicken > rewards.drone);
  assert.ok(rewards.brute > rewards.wave4drone);
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
  game.beginWave(10);
  game.killEnemy(enemy);
  game.killEnemy(enemy);
  const gold = game.pickups.filter(pickup => pickup.kind === "gold");
  assert.equal(gold.length, 1);
  assert.equal(gold[0].value, 2);
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
  assert.deepEqual(game.pickups.filter(pickup => pickup.kind === "gold").map(pickup => pickup.value), [4, 4]);
  game.stats.pickup = Core.WIDTH;
  for (let i = 0; i < 30; i += 1) game.update(0.1);
  assert.equal(game.profile.gold, 8);
  assert.equal(game.coins, 8);
  assert.equal(Core.isValidProfile(game.profile), true);
});

test("high-value gold drops respect the wallet limit and remain valid save data", () => {
  const profile = Core.createProfile();
  profile.gold = Core.MAX_GOLD - 1;
  const game = startedGame(profile);
  game.beginWave(1);
  game.spawnEnemy(true);
  const boss = game.enemies[0];
  boss.x = game.player.x;
  boss.y = game.player.y;
  game.killEnemy(boss);
  assert.equal(game.pickups[0].value, 18);
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

test("skeletons telegraph each fireball for 0.45 seconds and fire every 2 seconds", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 92);
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
  advanceFrames(game, 119);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballShot").length, 0);
  advanceFrames(game, 1);
  assert.equal(game.drainEvents().filter(event => event.type === "fireballShot").length, 1);
});

test("skeletons aim at the player's position when firing, not when charging", () => {
  const { game, skeleton } = skeletonEncounter();
  advanceFrames(game, 93);
  game.player.y += 80;
  advanceFrames(game, 27);
  const ball = game.fireballs[0];
  const angle = Math.atan2(game.player.y - skeleton.y, game.player.x - skeleton.x);
  assert.ok(Math.abs(ball.vx - Math.cos(angle) * Core.FIREBALL_SPEED) < 1e-9);
  assert.ok(Math.abs(ball.vy - Math.sin(angle) * Core.FIREBALL_SPEED) < 1e-9);
});

test("fireballs travel straight and can be dodged instead of homing on the player", () => {
  const { game } = skeletonEncounter();
  advanceFrames(game, 120);
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
  advanceFrames(game, 93);
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
  advanceFrames(game, 120);
  const ball = game.fireballs[0];
  const x = ball.x;
  game.killEnemy(skeleton);
  game.update(1 / 60);
  assert.ok(ball.x < x);
  assert.equal(game.enemies.length, 0);
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
  advanceFrames(game, 93);
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
  advanceFrames(game, 93);
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
  for (const wave of [1, 4, 12]) {
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

test("bosses are auto-targeted, take bullet damage, drop gold, and block wave completion", () => {
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
  assert.ok(game.pickups.some(pickup => pickup.kind === "gold"));
  game.update(1 / 60);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.waveActive, false);
  assert.ok(game.countdown > 0);
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
