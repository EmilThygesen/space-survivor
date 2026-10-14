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

test("new profiles are valid and invalid saves are rejected", () => {
  const profile = Core.createProfile();
  assert.equal(Core.isValidProfile(profile), true);
  assert.equal(Core.isValidProfile(null), false);
  assert.equal(Core.isValidProfile({ ...profile, gold: -1 }), false);
  assert.equal(Core.isValidProfile({ ...profile, bestTime: Infinity }), false);
  assert.equal(Core.isValidProfile({ ...profile, levels: { ...profile.levels, hp: 100 } }), false);
  assert.equal(Core.isValidProfile({ ...profile, version: 2 }), false);
});

test("all five upgrades improve their corresponding stat", () => {
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

test("boss health and speed are exactly 10x and 2x the current wave's normal alien", () => {
  for (const wave of [1, 4, 12]) {
    const game = startedGame();
    game.beginWave(wave);
    game.spawnEnemy(true);
    const boss = game.enemies[0];
    const settings = Core.waveSettings(wave);
    assert.equal(boss.type, "boss");
    assert.equal(boss.hp, settings.hp * 10);
    assert.equal(boss.maxHp, settings.hp * 10);
    assert.equal(boss.speed, settings.speed * 2);
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
  assert.equal(boss.maxHp, Core.waveSettings(2).hp * 10);
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
