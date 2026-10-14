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

test("new profiles are valid and invalid saves are rejected", () => {
  const profile = Core.createProfile();
  assert.equal(Core.isValidProfile(profile), true);
  assert.equal(Core.isValidProfile(null), false);
  assert.equal(Core.isValidProfile({ ...profile, gold: -1 }), false);
  assert.equal(Core.isValidProfile({ ...profile, bestTime: Infinity }), false);
  assert.equal(Core.isValidProfile({ ...profile, levels: { ...profile.levels, hp: 100 } }), false);
  assert.equal(Core.isValidProfile({ ...profile, version: 2 }), false);
});

test("all six upgrades improve their corresponding stat", () => {
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

test("old saves gain a level-zero range upgrade without losing or mutating progress", () => {
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
  assert.deepEqual(migrated, { ...oldSave, levels: { ...oldSave.levels, range: 0 } });
  assert.equal(Core.isValidProfile(migrated), true);
  assert.equal(Core.getStats(migrated).range, 360);
  assert.equal(Core.migrateProfile(migrated), migrated);
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
  const profile = Core.createProfile();
  profile.levels.fireRate = 15;
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
