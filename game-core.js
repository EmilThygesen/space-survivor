(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SpaceSurvivorCore = factory();
  }
})(globalThis, function () {
  "use strict";

  const WIDTH = 1440;
  const HEIGHT = 900;
  const MAX_GOLD = 1000000000;
  const BASE_ALIEN_STATS = Object.freeze({ hp: 26, speed: 61, damage: 8 });
  const BOSS_INTERVAL = 15;
  const CHICKEN_SPAWN_CHANCE = 0.2;
  const CHICKEN_TRIGGER_DISTANCE = 90;
  const CHICKEN_FUSE_DELAY = 1.5;
  const CHICKEN_EXPLOSION_RADIUS = 120;
  const UPGRADES = Object.freeze({
    damage: { name: "Bullet damage", description: "Make every shot count.", baseCost: 25, maxLevel: 25 },
    fireRate: { name: "Fire rate", description: "Put more rounds downrange.", baseCost: 30, maxLevel: 15 },
    range: { name: "Weapon range", description: "Engage enemies from farther away.", baseCost: 25, maxLevel: 15 },
    speed: { name: "Run speed", description: "Stay ahead of the swarm.", baseCost: 25, maxLevel: 12 },
    hp: { name: "Max health", description: "Reinforce your combat suit.", baseCost: 25, maxLevel: 25 },
    pickup: { name: "Gold pickup radius", description: "Pull in coins from farther away.", baseCost: 20, maxLevel: 15 },
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createProfile() {
    return {
      version: 1,
      gold: 0,
      levels: { damage: 0, fireRate: 0, range: 0, speed: 0, hp: 0, pickup: 0 },
      bestWave: 0,
      bestKills: 0,
      bestTime: 0,
      totalRuns: 0,
    };
  }

  function migrateProfile(profile) {
    if (profile?.version !== 1 || !profile.levels || typeof profile.levels !== "object" || Object.hasOwn(profile.levels, "range")) return profile;
    return { ...profile, levels: { ...profile.levels, range: 0 } };
  }

  function isValidProfile(profile) {
    if (!profile || profile.version !== 1 || !profile.levels) return false;
    if (!Number.isInteger(profile.gold) || profile.gold < 0 || profile.gold > MAX_GOLD) return false;
    for (const [key, upgrade] of Object.entries(UPGRADES)) {
      const level = profile.levels[key];
      if (!Number.isInteger(level) || level < 0 || level > upgrade.maxLevel) return false;
    }
    for (const key of ["bestWave", "bestKills", "totalRuns"]) {
      if (!Number.isSafeInteger(profile[key]) || profile[key] < 0) return false;
    }
    return Number.isFinite(profile.bestTime) && profile.bestTime >= 0;
  }

  function getStats(profile) {
    const level = profile.levels;
    return {
      damage: 18 + level.damage * 6,
      fireRate: 2.1 * Math.pow(1.12, level.fireRate),
      range: 360 + level.range * 40,
      speed: 245 + level.speed * 16,
      hp: 100 + level.hp * 20,
      pickup: 72 + level.pickup * 15,
    };
  }

  function upgradeCost(profile, key) {
    if (!Object.hasOwn(UPGRADES, key)) throw new TypeError("Unknown upgrade.");
    if (profile.levels[key] >= UPGRADES[key].maxLevel) return null;
    return Math.ceil(UPGRADES[key].baseCost * Math.pow(1.38, profile.levels[key]));
  }

  function buyUpgrade(profile, key) {
    const cost = upgradeCost(profile, key);
    if (cost === null) return { success: false, reason: "This upgrade is already at maximum level." };
    if (profile.gold < cost) return { success: false, reason: "Collect more gold before buying this upgrade." };
    profile.gold -= cost;
    profile.levels[key] += 1;
    return { success: true, cost };
  }

  function waveSettings(wave) {
    const difficulty = Math.max(0, wave - 1);
    const hp = Math.min(Number.MAX_SAFE_INTEGER, Math.round(BASE_ALIEN_STATS.hp * Math.pow(1.3, difficulty)));
    const speed = BASE_ALIEN_STATS.speed + difficulty * 6;
    const damage = Math.min(Number.MAX_SAFE_INTEGER, Math.round(BASE_ALIEN_STATS.damage * Math.pow(1.2, difficulty)));
    return {
      count: Math.min(120, 8 + wave * 4),
      hp,
      speed,
      damage,
      spawnInterval: Math.max(0.17, 0.64 - difficulty * 0.028),
      gold: enemyGold({ maxHp: hp, speed, damage }),
    };
  }

  function enemyGold(enemy) {
    const strength = enemy.maxHp / BASE_ALIEN_STATS.hp
      * Math.max(1, enemy.speed / BASE_ALIEN_STATS.speed)
      * Math.max(1, enemy.damage / BASE_ALIEN_STATS.damage);
    return Math.min(MAX_GOLD, Math.max(1, Math.ceil(2 * Math.sqrt(strength))));
  }

  function segmentCircleHit(x1, y1, x2, y2, cx, cy, radius) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const ox = x1 - cx;
    const oy = y1 - cy;
    const c = ox * ox + oy * oy - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (ox * dx + oy * dy);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }

  class Game {
    constructor(random = Math.random) {
      this.random = random;
      this.phase = "idle";
      this.player = { x: WIDTH / 2, y: HEIGHT / 2, radius: 17, angle: -Math.PI / 2, hp: 100, maxHp: 100, invulnerable: 0, moving: 0, muzzleFlash: 0 };
      this.enemies = [];
      this.bullets = [];
      this.pickups = [];
      this.events = [];
      this.explosionQueue = [];
      this.wave = 0;
      this.kills = 0;
      this.coins = 0;
      this.time = 0;
      this.report = null;
    }

    start(profile) {
      if (!isValidProfile(profile)) throw new TypeError("Invalid player profile.");
      this.profile = profile;
      this.stats = getStats(profile);
      this.player = { x: WIDTH / 2, y: HEIGHT / 2, radius: 17, angle: -Math.PI / 2, hp: this.stats.hp, maxHp: this.stats.hp, invulnerable: 0, moving: 0, muzzleFlash: 0 };
      this.enemies = [];
      this.bullets = [];
      this.pickups = [];
      this.events = [];
      this.explosionQueue = [];
      this.wave = 0;
      this.kills = 0;
      this.coins = 0;
      this.time = 0;
      this.nextBossAt = BOSS_INTERVAL;
      this.fireTimer = 0;
      this.spawnTimer = 0;
      this.spawnRemaining = 0;
      this.waveActive = false;
      this.countdown = 1.6;
      this.report = null;
      this.phase = "running";
      this.events.push({ type: "start" });
    }

    pause() {
      if (this.phase === "running") this.phase = "paused";
    }

    resume() {
      if (this.phase === "paused") this.phase = "running";
    }

    beginWave(wave) {
      this.wave = wave;
      this.settings = waveSettings(wave);
      this.spawnRemaining = this.settings.count;
      this.spawnTimer = 0;
      this.countdown = 0;
      this.waveActive = true;
      this.events.push({ type: "wave", wave });
    }

    spawnEnemy(isBoss = false) {
      let point;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const side = Math.floor(this.random() * 4);
        if (side === 0) point = { x: 25 + this.random() * (WIDTH - 50), y: 25 };
        if (side === 1) point = { x: WIDTH - 25, y: 25 + this.random() * (HEIGHT - 50) };
        if (side === 2) point = { x: 25 + this.random() * (WIDTH - 50), y: HEIGHT - 25 };
        if (side === 3) point = { x: 25, y: 25 + this.random() * (HEIGHT - 50) };
        if (Math.hypot(point.x - this.player.x, point.y - this.player.y) > 260) break;
      }
      const roll = this.random();
      const type = isBoss ? "boss" : roll >= 1 - CHICKEN_SPAWN_CHANCE ? "chicken" : this.wave >= 4 && roll < 0.16 ? "brute" : this.wave >= 2 && roll < 0.45 ? "runner" : "drone";
      const hpMultiplier = type === "boss" ? 20 : type === "brute" ? 3.2 : type === "runner" ? 0.75 : type === "chicken" ? 0.8 : 1;
      const maxHp = Math.round(this.settings.hp * hpMultiplier);
      this.enemies.push({
        ...point,
        type,
        radius: type === "boss" ? 36 : type === "brute" ? 25 : type === "runner" ? 12 : type === "chicken" ? 18 : 17,
        hp: maxHp,
        maxHp,
        speed: this.settings.speed * (type === "boss" ? 4 : type === "brute" ? 0.68 : type === "runner" ? 1.38 : type === "chicken" ? 1.6 : 1),
        damage: this.settings.damage * (type === "chicken" ? 3 : type === "brute" ? 1.7 : 1),
        color: type === "boss" ? "#ffa35d" : type === "brute" ? "#ba8deb" : type === "runner" ? "#f295a6" : type === "chicken" ? "#f4e8c9" : "#a8d673",
        angle: 0,
        hitFlash: 0,
        contactTimer: 0,
        explodeAt: null,
        wobble: this.random() * Math.PI * 2,
      });
      if (isBoss) this.events.push({ type: "boss" });
    }

    closestEnemy() {
      let nearest = null;
      let distance = Infinity;
      const maxDistance = this.stats.range ** 2;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const squared = (enemy.x - this.player.x) ** 2 + (enemy.y - this.player.y) ** 2;
        if (squared <= maxDistance && squared < distance) {
          nearest = enemy;
          distance = squared;
        }
      }
      return nearest;
    }

    shoot(target) {
      const angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
      this.player.angle = angle;
      const offset = Math.min(29, Math.hypot(target.x - this.player.x, target.y - this.player.y));
      const x = this.player.x + Math.cos(angle) * offset;
      const y = this.player.y + Math.sin(angle) * offset;
      this.bullets.push({ x, y, prevX: x, prevY: y, vx: Math.cos(angle) * 1080, vy: Math.sin(angle) * 1080, life: 2, remainingRange: this.stats.range - offset, damage: this.stats.damage });
      this.player.muzzleFlash = 0.065;
      this.events.push({ type: "shot" });
    }

    hurt(damage, x, y) {
      if (this.phase !== "running" || this.player.invulnerable > 0) return;
      this.player.hp = Math.max(0, this.player.hp - damage);
      this.player.invulnerable = 0.55;
      this.events.push({ type: "hurt", x: this.player.x, y: this.player.y });
      const distance = Math.hypot(this.player.x - x, this.player.y - y);
      if (distance > 0) {
        this.player.x = clamp(this.player.x + (this.player.x - x) / distance * 18, 27, WIDTH - 27);
        this.player.y = clamp(this.player.y + (this.player.y - y) / distance * 18, 27, HEIGHT - 27);
      }
      if (this.player.hp <= 0) this.finish("overrun");
    }

    hitEnemy(enemy, damage) {
      if (enemy.hp <= 0) return;
      enemy.hitFlash = 0.1;
      this.events.push({ type: "hit", x: enemy.x, y: enemy.y, damage });
      if (enemy.hp > damage) {
        enemy.hp -= damage;
        return;
      }
      this.killEnemy(enemy);
    }

    killEnemy(enemy) {
      if (enemy.hp <= 0) return;
      enemy.hp = 0;
      this.kills += 1;
      const value = enemyGold(enemy);
      this.pickups.push({ kind: "gold", x: enemy.x, y: enemy.y, value, age: 0, magnetized: false });
      if (this.random() < 0.065) this.pickups.push({ kind: "health", x: enemy.x + 12, y: enemy.y + 10, age: 0 });
      this.events.push({ type: "kill", x: enemy.x, y: enemy.y, color: enemy.color, radius: enemy.radius });
      if (enemy.type === "chicken") {
        this.explosionQueue.push(enemy);
        if (this.explosionQueue.length === 1) this.resolveExplosions();
      }
    }

    resolveExplosions() {
      let playerHit = null;
      // Resolve chains iteratively and settle enemy deaths before a blast can end the run.
      try {
        for (let i = 0; i < this.explosionQueue.length; i += 1) {
          const source = this.explosionQueue[i];
          this.events.push({ type: "explosion", x: source.x, y: source.y, radius: CHICKEN_EXPLOSION_RADIUS });
          for (const target of this.enemies) {
            if (target.hp > 0 && Math.hypot(target.x - source.x, target.y - source.y) <= CHICKEN_EXPLOSION_RADIUS + target.radius) {
              this.hitEnemy(target, source.damage);
            }
          }
          if (!playerHit && Math.hypot(this.player.x - source.x, this.player.y - source.y) <= CHICKEN_EXPLOSION_RADIUS + this.player.radius) {
            playerHit = source;
          }
        }
      } finally {
        this.explosionQueue.length = 0;
      }
      if (playerHit) this.hurt(playerHit.damage, playerHit.x, playerHit.y);
    }

    finish(reason) {
      if (this.phase !== "running" && this.phase !== "paused") return;
      this.phase = "ended";
      this.profile.bestWave = Math.max(this.profile.bestWave, this.wave);
      this.profile.bestKills = Math.max(this.profile.bestKills, this.kills);
      this.profile.bestTime = Math.max(this.profile.bestTime, this.time);
      this.profile.totalRuns += 1;
      this.report = { reason, wave: this.wave, kills: this.kills, gold: this.coins, time: this.time };
      this.events.push({ type: "ended", report: this.report });
    }

    update(dt, input = { x: 0, y: 0 }) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 0.1) throw new RangeError("Simulation step must be between 0 and 0.1 seconds.");
      if (this.phase !== "running" || dt === 0) return;
      this.time += dt;
      const p = this.player;
      p.invulnerable = Math.max(0, p.invulnerable - dt);
      p.muzzleFlash = Math.max(0, p.muzzleFlash - dt);
      const length = Math.hypot(input.x, input.y);
      const divisor = Math.max(1, length);
      p.x = clamp(p.x + input.x / divisor * this.stats.speed * dt, 27, WIDTH - 27);
      p.y = clamp(p.y + input.y / divisor * this.stats.speed * dt, 27, HEIGHT - 27);
      p.moving = Math.min(1, length);
      if (length > 0 && !this.closestEnemy()) p.angle = Math.atan2(input.y, input.x);

      if (this.countdown > 0) {
        this.countdown = Math.max(0, this.countdown - dt);
        if (this.countdown === 0) this.beginWave(this.wave + 1);
      }
      if (this.waveActive) {
        this.spawnTimer -= dt;
        while (this.spawnRemaining > 0 && this.spawnTimer <= 0 && this.enemies.length < 85) {
          this.spawnEnemy();
          this.spawnRemaining -= 1;
          this.spawnTimer += this.settings.spawnInterval;
        }
      }

      // Allow for floating-point rounding at exact 15-second boundaries.
      while (this.time + 1e-9 >= this.nextBossAt) {
        this.spawnEnemy(true);
        this.nextBossAt += BOSS_INTERVAL;
      }

      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const dx = p.x - enemy.x;
        const dy = p.y - enemy.y;
        const distance = Math.hypot(dx, dy);
        enemy.angle = Math.atan2(dy, dx);
        enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
        enemy.contactTimer = Math.max(0, enemy.contactTimer - dt);
        let sx = 0;
        let sy = 0;
        for (const other of this.enemies) {
          if (other === enemy || other.hp <= 0) continue;
          const ox = enemy.x - other.x;
          const oy = enemy.y - other.y;
          const separation = Math.hypot(ox, oy);
          const minimum = enemy.radius + other.radius + 3;
          if (separation > 0 && separation < minimum) {
            sx += ox / separation * (minimum - separation) * 2;
            sy += oy / separation * (minimum - separation) * 2;
          }
        }
        if (distance > 0 && (enemy.type !== "chicken" || enemy.explodeAt === null)) {
          enemy.x = clamp(enemy.x + (dx / distance * enemy.speed + sx) * dt, enemy.radius, WIDTH - enemy.radius);
          enemy.y = clamp(enemy.y + (dy / distance * enemy.speed + sy) * dt, enemy.radius, HEIGHT - enemy.radius);
        }
        const playerDistance = Math.hypot(p.x - enemy.x, p.y - enemy.y);
        if (enemy.type === "chicken") {
          if (enemy.explodeAt === null && playerDistance <= CHICKEN_TRIGGER_DISTANCE) {
            enemy.explodeAt = this.time + CHICKEN_FUSE_DELAY;
            this.events.push({ type: "chickenArmed", x: enemy.x, y: enemy.y });
          }
        } else if (playerDistance < p.radius + enemy.radius && enemy.contactTimer === 0) {
          enemy.contactTimer = 0.7;
          this.hurt(enemy.damage, enemy.x, enemy.y);
          if (this.phase === "ended") return;
        }
      }

      const target = this.closestEnemy();
      this.fireTimer -= dt;
      if (target) {
        p.angle = Math.atan2(target.y - p.y, target.x - p.x);
        if (this.fireTimer <= 0) {
          this.shoot(target);
          this.fireTimer += 1 / this.stats.fireRate;
        }
      } else {
        this.fireTimer = Math.max(0, this.fireTimer);
      }

      for (const bullet of this.bullets) {
        bullet.prevX = bullet.x;
        bullet.prevY = bullet.y;
        const speed = Math.hypot(bullet.vx, bullet.vy);
        const travel = Math.min(bullet.remainingRange, speed * dt);
        const duration = speed > 0 ? travel / speed : 0;
        bullet.x += bullet.vx * duration;
        bullet.y += bullet.vy * duration;
        bullet.remainingRange = Math.max(0, bullet.remainingRange - travel);
        bullet.life -= dt;
        if (bullet.remainingRange === 0) bullet.life = 0;
        let hit = null;
        let first = Infinity;
        for (const enemy of this.enemies) {
          if (enemy.hp <= 0) continue;
          // Sweep the whole movement segment so fast bullets cannot skip small aliens.
          const t = segmentCircleHit(bullet.prevX, bullet.prevY, bullet.x, bullet.y, enemy.x, enemy.y, enemy.radius + 3);
          if (t !== null && t < first) {
            hit = enemy;
            first = t;
          }
        }
        if (hit) {
          this.hitEnemy(hit, bullet.damage);
          bullet.life = 0;
          if (this.phase === "ended") break;
        }
      }
      this.bullets = this.bullets.filter(b => b.life > 0 && b.x > -40 && b.x < WIDTH + 40 && b.y > -40 && b.y < HEIGHT + 40);
      for (const enemy of this.enemies) {
        if (this.phase === "ended") break;
        if (enemy.type === "chicken" && enemy.hp > 0 && enemy.explodeAt !== null && this.time + 1e-9 >= enemy.explodeAt) {
          this.killEnemy(enemy);
        }
      }
      this.enemies = this.enemies.filter(enemy => enemy.hp > 0);
      if (this.phase === "ended") return;

      this.pickups = this.pickups.filter(pickup => {
        pickup.age += dt;
        const dx = p.x - pickup.x;
        const dy = p.y - pickup.y;
        const distance = Math.hypot(dx, dy);
        if (pickup.kind === "health") {
          if (distance < p.radius + 12 && p.hp < p.maxHp) {
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.22);
            this.events.push({ type: "heal", x: p.x, y: p.y });
            return false;
          }
          return pickup.age < 90;
        }
        if (distance <= this.stats.pickup) pickup.magnetized = true;
        if (distance <= p.radius + 7) {
          const credited = Math.min(pickup.value, MAX_GOLD - this.profile.gold);
          this.coins += credited;
          this.profile.gold += credited;
          this.events.push({ type: "gold", x: pickup.x, y: pickup.y, value: credited });
          return false;
        }
        if (pickup.magnetized && distance > 0) {
          const movement = Math.min(distance, Math.max(430, this.stats.speed * 1.6) * dt);
          pickup.x += dx / distance * movement;
          pickup.y += dy / distance * movement;
        }
        return pickup.age < 120;
      });

      if (this.waveActive && this.spawnRemaining === 0 && this.enemies.length === 0) {
        this.waveActive = false;
        this.countdown = 3.5;
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.12);
        this.events.push({ type: "clear", wave: this.wave });
      }
    }

    drainEvents() {
      return this.events.splice(0);
    }
  }

  return { WIDTH, HEIGHT, MAX_GOLD, BASE_ALIEN_STATS, BOSS_INTERVAL, CHICKEN_SPAWN_CHANCE, CHICKEN_TRIGGER_DISTANCE, CHICKEN_FUSE_DELAY, CHICKEN_EXPLOSION_RADIUS, UPGRADES, createProfile, migrateProfile, isValidProfile, getStats, upgradeCost, buyUpgrade, waveSettings, enemyGold, segmentCircleHit, Game };
});
