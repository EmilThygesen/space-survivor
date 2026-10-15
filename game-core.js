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
  const CRIT_DAMAGE_MULTIPLIER = 2;
  const BASE_ALIEN_STATS = Object.freeze({ hp: 26, speed: 61, damage: 8 });
  const BOSS_INTERVAL = 15;
  const BOSS_HEALTH_MULTIPLIER = 20;
  const BOSS_CRYSTAL_VALUE = 150;
  const LEVEL_WAVES = 9;
  const FINAL_BOSS_HEALTH_MULTIPLIER = 30;
  const FINAL_BOSS_RADIUS = 76;
  const FINAL_BOSS_SPEED = 210;
  const FINAL_BOSS_JUMP_RANGE = 900;
  const FINAL_BOSS_JUMP_COOLDOWN = 3;
  const FINAL_BOSS_JUMP_WINDUP = 0.5;
  const FINAL_BOSS_JUMP_DURATION = 0.25;
  const FINAL_BOSS_JUMP_RECOVERY = 0.65;
  const FINAL_BOSS_SLAM_RADIUS = 115;
  const CHICKEN_SPAWN_CHANCE = 0.2;
  const CHICKEN_TRIGGER_DISTANCE = 90;
  const CHICKEN_FUSE_DELAY = 1.5;
  const CHICKEN_EXPLOSION_RADIUS = 120;
  const SKELETON_START_WAVE = 3;
  const SKELETON_SPAWN_CHANCE = 0.15;
  const SKELETON_ATTACK_RANGE = 520;
  const SKELETON_KEEP_DISTANCE = 280;
  const SKELETON_FIRE_INTERVAL = 1;
  const SKELETON_CAST_TIME = 0.45;
  const FIREBALL_SPEED = 260;
  const FIREBALL_RADIUS = 8;
  const FIREBALL_LIFETIME = 4;
  const UPGRADES = Object.freeze({
    damage: { name: "Bullet damage", description: "Make every shot count.", baseCost: 25, maxLevel: 25 },
    fireRate: { name: "Fire rate", description: "Put more rounds downrange.", baseCost: 30, maxLevel: 25 },
    projectileSpeed: { name: "Projectile speed", description: "Make your bullets reach enemies faster.", baseCost: 50, maxLevel: 15 },
    range: { name: "Weapon range", description: "Engage enemies from farther away.", baseCost: 25, maxLevel: 15 },
    speed: { name: "Run speed", description: "Stay ahead of the swarm.", baseCost: 25, maxLevel: 12 },
    hp: { name: "Max health", description: "Reinforce your combat suit.", baseCost: 25, maxLevel: 25 },
    healthRegen: { name: "Health regeneration", description: "Restore health automatically each second.", baseCost: 100, maxLevel: 10 },
    pickup: { name: "Gold pickup radius", description: "Pull in coins and crystals from farther away.", baseCost: 20, maxLevel: 15 },
    critChance: { name: "Crit Chance %", description: "Give each bullet a chance to deal double damage.", baseCost: 500, maxLevel: 10 },
    bullets: { name: "Dual bullets", description: "Make each gun fire two full-damage bullets, four total.", baseCost: 2500, maxLevel: 1 },
    wavePickup: { name: "Wave gold collection", description: "Collect all remaining coins and crystals when you clear a wave.", baseCost: 2500, maxLevel: 1 },
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createProfile() {
    return {
      version: 1,
      gold: 0,
      levels: { damage: 0, fireRate: 0, projectileSpeed: 0, range: 0, speed: 0, hp: 0, healthRegen: 0, pickup: 0, critChance: 0, bullets: 0, wavePickup: 0 },
      wavePickupEnabled: true,
      bestWave: 0,
      bestKills: 0,
      bestTime: 0,
      totalRuns: 0,
    };
  }

  function migrateProfile(profile) {
    if (profile?.version !== 1 || !profile.levels || typeof profile.levels !== "object") return profile;
    const missing = ["range", "bullets", "wavePickup", "critChance", "healthRegen", "projectileSpeed"].filter(key => !Object.hasOwn(profile.levels, key));
    const missingToggle = !Object.hasOwn(profile, "wavePickupEnabled");
    const legacyBulletTier = profile.levels.bullets === 2;
    if (missing.length === 0 && !missingToggle && !legacyBulletTier) return profile;
    const levels = { ...profile.levels };
    for (const key of missing) levels[key] = 0;
    if (legacyBulletTier) levels.bullets = 1;
    return { ...profile, levels, ...(missingToggle ? { wavePickupEnabled: true } : {}) };
  }

  function isValidProfile(profile) {
    if (!profile || profile.version !== 1 || !profile.levels) return false;
    if (typeof profile.wavePickupEnabled !== "boolean") return false;
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
      projectileSpeed: 1080 + level.projectileSpeed * 20,
      range: 360 + level.range * 40,
      speed: 245 + level.speed * 16,
      hp: 100 + level.hp * 20,
      healthRegen: level.healthRegen * 0.5,
      pickup: 72 + level.pickup * 15,
      critChance: level.critChance * 5,
      bullets: 1 + level.bullets,
      wavePickup: level.wavePickup,
    };
  }

  function upgradeCost(profile, key) {
    if (!Object.hasOwn(UPGRADES, key)) throw new TypeError("Unknown upgrade.");
    if (profile.levels[key] >= UPGRADES[key].maxLevel) return null;
    return Math.ceil(UPGRADES[key].baseCost * Math.pow(UPGRADES[key].costMultiplier ?? 1.38, profile.levels[key]));
  }

  function buyUpgrade(profile, key) {
    const cost = upgradeCost(profile, key);
    if (cost === null) return { success: false, reason: "This upgrade is already at maximum level." };
    if (profile.gold < cost) return { success: false, reason: "Collect more gold before buying this upgrade." };
    profile.gold -= cost;
    profile.levels[key] += 1;
    return { success: true, cost };
  }

  function toggleWavePickup(profile) {
    if (!isValidProfile(profile)) throw new TypeError("Invalid player profile.");
    if (profile.levels.wavePickup !== 1) return { success: false, reason: "Purchase Wave gold collection before toggling it." };
    profile.wavePickupEnabled = !profile.wavePickupEnabled;
    return { success: true, enabled: profile.wavePickupEnabled };
  }

  function waveSettings(wave) {
    const difficulty = Math.max(0, wave - 1);
    const hp = Math.min(Number.MAX_SAFE_INTEGER, Math.round(BASE_ALIEN_STATS.hp * Math.pow(1.3, difficulty)));
    const speed = BASE_ALIEN_STATS.speed + difficulty * 6;
    const damage = Math.min(Number.MAX_SAFE_INTEGER, Math.round(BASE_ALIEN_STATS.damage * Math.pow(1.2, difficulty)));
    return {
      count: 6 * Math.min(120, 8 + wave * 4),
      hp,
      speed,
      damage,
      spawnInterval: Math.max(0.17, 0.64 - difficulty * 0.028) / 3.75,
      gold: enemyGold({ maxHp: hp, speed, damage }),
    };
  }

  function enemyGold(enemy) {
    if (enemy.type === "boss" || enemy.type === "overlord") return BOSS_CRYSTAL_VALUE;
    const strength = enemy.maxHp / BASE_ALIEN_STATS.hp
      * Math.max(1, enemy.speed / BASE_ALIEN_STATS.speed)
      * Math.max(1, enemy.damage / BASE_ALIEN_STATS.damage);
    return Math.min(MAX_GOLD, 2 * Math.max(1, Math.ceil(2 * Math.sqrt(strength))));
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
      this.fireballs = [];
      this.pickups = [];
      this.events = [];
      this.explosionQueue = [];
      this.wave = 0;
      this.spawnRemaining = 0;
      this.kills = 0;
      this.bulletsFired = 0;
      this.damageTaken = 0;
      this.wavesCleared = 0;
      this.coins = 0;
      this.time = 0;
      this.report = null;
    }

    get enemiesRemaining() {
      return this.spawnRemaining + this.enemies.reduce((count, enemy) => count + (enemy.hp > 0 ? 1 : 0), 0);
    }

    start(profile) {
      if (!isValidProfile(profile)) throw new TypeError("Invalid player profile.");
      this.profile = profile;
      this.stats = getStats(profile);
      this.player = { x: WIDTH / 2, y: HEIGHT / 2, radius: 17, angle: -Math.PI / 2, hp: this.stats.hp, maxHp: this.stats.hp, invulnerable: 0, moving: 0, muzzleFlash: 0 };
      this.enemies = [];
      this.bullets = [];
      this.fireballs = [];
      this.pickups = [];
      this.events = [];
      this.explosionQueue = [];
      this.wave = 0;
      this.kills = 0;
      this.bulletsFired = 0;
      this.damageTaken = 0;
      this.wavesCleared = 0;
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
      if (!Number.isInteger(wave) || wave < 1 || wave > LEVEL_WAVES) throw new RangeError(`Level 1 has waves 1 through ${LEVEL_WAVES}.`);
      this.pickups = this.pickups.filter(pickup => pickup.kind !== "health");
      this.wave = wave;
      this.settings = waveSettings(wave);
      this.spawnRemaining = wave === LEVEL_WAVES ? 0 : this.settings.count;
      this.spawnTimer = 0;
      this.countdown = 0;
      this.waveActive = true;
      this.events.push({ type: "wave", wave });
      if (wave === LEVEL_WAVES) this.spawnEnemy(true, { finalBoss: true });
    }

    spawnEnemy(isBoss = false, { finalBoss = false } = {}) {
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
      const type = finalBoss ? "overlord" : isBoss ? "boss" : roll >= 1 - CHICKEN_SPAWN_CHANCE ? "chicken" : this.wave >= SKELETON_START_WAVE && roll >= 0.6 && roll < 0.6 + SKELETON_SPAWN_CHANCE ? "skeleton" : this.wave >= 4 && roll < 0.16 ? "brute" : this.wave >= 2 && roll < 0.45 ? "runner" : "drone";
      const hpMultiplier = finalBoss ? BOSS_HEALTH_MULTIPLIER * FINAL_BOSS_HEALTH_MULTIPLIER : type === "boss" ? BOSS_HEALTH_MULTIPLIER : type === "brute" ? 3.2 : type === "runner" ? 0.75 : type === "chicken" ? 0.8 : type === "skeleton" ? 1.3 : 1;
      const maxHp = Math.round(this.settings.hp * hpMultiplier);
      if (finalBoss) {
        point.x = clamp(point.x, FINAL_BOSS_RADIUS, WIDTH - FINAL_BOSS_RADIUS);
        point.y = clamp(point.y, FINAL_BOSS_RADIUS, HEIGHT - FINAL_BOSS_RADIUS);
      }
      this.enemies.push({
        ...point,
        type,
        radius: finalBoss ? FINAL_BOSS_RADIUS : type === "boss" ? 36 : type === "brute" ? 25 : type === "runner" ? 12 : type === "chicken" ? 18 : type === "skeleton" ? 20 : 17,
        hp: maxHp,
        maxHp,
        speed: finalBoss ? FINAL_BOSS_SPEED : this.settings.speed * (type === "boss" ? 4 : type === "brute" ? 0.68 : type === "runner" ? 1.38 : type === "chicken" ? 1.6 : type === "skeleton" ? 0.85 : 1),
        damage: this.settings.damage * (type === "chicken" ? 3 : type === "brute" ? 1.7 : type === "skeleton" ? 1.5 : 1),
        color: finalBoss ? "#f06a83" : type === "boss" ? "#ffa35d" : type === "brute" ? "#ba8deb" : type === "runner" ? "#f295a6" : type === "chicken" ? "#f4e8c9" : type === "skeleton" ? "#e4ddc9" : "#a8d673",
        angle: 0,
        hitFlash: 0,
        contactTimer: 0,
        explodeAt: null,
        nextFireAt: type === "skeleton" ? this.time + SKELETON_FIRE_INTERVAL : null,
        castUntil: null,
        nextJumpAt: finalBoss ? this.time + FINAL_BOSS_JUMP_COOLDOWN : null,
        jump: null,
        wobble: this.random() * Math.PI * 2,
      });
      if (isBoss || finalBoss) this.events.push({ type: "boss", finalBoss });
    }

    closestEnemy(origin = this.player, excluded = null) {
      let nearest = null;
      let distance = Infinity;
      const maxDistance = this.stats.range ** 2;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0 || enemy === excluded) continue;
        const inRange = (enemy.x - this.player.x) ** 2 + (enemy.y - this.player.y) ** 2 <= maxDistance;
        const squared = (enemy.x - origin.x) ** 2 + (enemy.y - origin.y) ** 2;
        if (inRange && squared < distance) {
          nearest = enemy;
          distance = squared;
        }
      }
      return nearest;
    }

    getGunPoses() {
      const p = this.player;
      const dx = Math.cos(p.angle);
      const dy = Math.sin(p.angle);
      const active = this.stats && (this.phase === "running" || this.phase === "paused");
      const guns = [-1, 1].map((side, index) => {
        const x = p.x + dx * 4 - dy * side * 16;
        const y = p.y + dy * 4 + dx * side * 16;
        const target = active ? this.closestEnemy({ x, y }) : null;
        return { index, x, y, angle: p.angle, target, muzzleFlash: p.muzzleFlash };
      });
      const [first, second] = guns;
      if (first.target && first.target === second.target) {
        const firstAlternative = this.closestEnemy(first, first.target);
        const secondAlternative = this.closestEnemy(second, second.target);
        if (firstAlternative && secondAlternative) {
          // Split a shared nearest target using the smaller extra aiming distance.
          const firstDetour = Math.hypot(firstAlternative.x - first.x, firstAlternative.y - first.y)
            - Math.hypot(first.target.x - first.x, first.target.y - first.y);
          const secondDetour = Math.hypot(secondAlternative.x - second.x, secondAlternative.y - second.y)
            - Math.hypot(second.target.x - second.x, second.target.y - second.y);
          if (firstDetour < secondDetour) first.target = firstAlternative;
          else second.target = secondAlternative;
        }
      }
      for (const gun of guns) {
        if (gun.target) gun.angle = Math.atan2(gun.target.y - gun.y, gun.target.x - gun.x);
      }
      return guns;
    }

    shoot(target = null) {
      if (target) this.player.angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
      let fired = false;
      for (const gun of this.getGunPoses()) {
        const aim = gun.target || target;
        if (!aim) continue;
        const angle = Math.atan2(aim.y - gun.y, aim.x - gun.x);
        const offset = Math.min(29, Math.hypot(aim.x - gun.x, aim.y - gun.y));
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        for (let i = 0; i < this.stats.bullets; i += 1) {
          const lane = (i - (this.stats.bullets - 1) / 2) * 10;
          const x = gun.x + dx * offset - dy * lane;
          const y = gun.y + dy * offset + dx * lane;
          // Clip rays from both offset guns to the soldier's shared range circle.
          const forward = (x - this.player.x) * dx + (y - this.player.y) * dy;
          const sideways = (x - this.player.x) * dy - (y - this.player.y) * dx;
          const remainingRange = Math.sqrt(this.stats.range ** 2 - sideways ** 2) - forward;
          const critical = this.stats.critChance > 0 && this.random() < this.stats.critChance / 100;
          this.bullets.push({ x, y, prevX: x, prevY: y, vx: dx * this.stats.projectileSpeed, vy: dy * this.stats.projectileSpeed, life: 2, remainingRange, damage: this.stats.damage * (critical ? CRIT_DAMAGE_MULTIPLIER : 1), critical, gunIndex: gun.index });
          this.bulletsFired += 1;
        }
        fired = true;
      }
      if (fired) {
        this.player.muzzleFlash = 0.065;
        this.events.push({ type: "shot" });
      }
    }

    shootFireball(enemy) {
      const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      const offset = Math.min(enemy.radius + FIREBALL_RADIUS + 2, Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y));
      const x = enemy.x + Math.cos(angle) * offset;
      const y = enemy.y + Math.sin(angle) * offset;
      this.fireballs.push({
        x, y, prevX: x, prevY: y,
        vx: Math.cos(angle) * FIREBALL_SPEED,
        vy: Math.sin(angle) * FIREBALL_SPEED,
        radius: FIREBALL_RADIUS,
        damage: enemy.damage,
        life: FIREBALL_LIFETIME,
      });
      this.events.push({ type: "fireballShot", x, y });
    }

    updateSkeleton(enemy) {
      const distance = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y);
      if (distance > SKELETON_ATTACK_RANGE) {
        enemy.castUntil = null;
        enemy.nextFireAt = Math.max(enemy.nextFireAt, this.time + SKELETON_CAST_TIME);
      } else if (enemy.castUntil !== null) {
        if (this.time + 1e-9 >= enemy.castUntil) {
          this.shootFireball(enemy);
          enemy.castUntil = null;
          enemy.nextFireAt = this.time + SKELETON_FIRE_INTERVAL;
        }
      } else if (this.time + 1e-9 >= enemy.nextFireAt - SKELETON_CAST_TIME) {
        enemy.castUntil = this.time + SKELETON_CAST_TIME;
        this.events.push({ type: "skeletonCast", x: enemy.x, y: enemy.y });
      }
    }

    updateFinalBoss(enemy) {
      if (enemy.jump === null) {
        if (this.time + 1e-9 < enemy.nextJumpAt || Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) > FINAL_BOSS_JUMP_RANGE) return;
        enemy.jump = {
          phase: "windup",
          startedAt: this.time,
          endsAt: this.time + FINAL_BOSS_JUMP_WINDUP,
          startX: enemy.x, startY: enemy.y,
          targetX: clamp(this.player.x, enemy.radius, WIDTH - enemy.radius),
          targetY: clamp(this.player.y, enemy.radius, HEIGHT - enemy.radius),
        };
        this.events.push({ type: "bossWindup", x: enemy.x, y: enemy.y, targetX: enemy.jump.targetX, targetY: enemy.jump.targetY, radius: FINAL_BOSS_SLAM_RADIUS });
        return;
      }
      const jump = enemy.jump;
      if (jump.phase === "windup" && this.time + 1e-9 >= jump.endsAt) {
        jump.phase = "airborne";
        jump.startedAt = jump.endsAt;
        jump.endsAt = jump.startedAt + FINAL_BOSS_JUMP_DURATION;
        this.events.push({ type: "bossLeap", x: enemy.x, y: enemy.y });
      }
      if (jump.phase === "airborne") {
        const progress = clamp((this.time - jump.startedAt) / FINAL_BOSS_JUMP_DURATION, 0, 1);
        enemy.x = jump.startX + (jump.targetX - jump.startX) * progress;
        enemy.y = jump.startY + (jump.targetY - jump.startY) * progress;
        if (this.time + 1e-9 >= jump.endsAt) {
          enemy.x = jump.targetX;
          enemy.y = jump.targetY;
          jump.phase = "recovery";
          jump.startedAt = jump.endsAt;
          jump.endsAt = jump.startedAt + FINAL_BOSS_JUMP_RECOVERY;
          this.events.push({ type: "bossSlam", x: enemy.x, y: enemy.y, radius: FINAL_BOSS_SLAM_RADIUS });
          if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) <= FINAL_BOSS_SLAM_RADIUS + this.player.radius) {
            this.hurt(enemy.damage, enemy.x, enemy.y);
          }
        }
      }
      if (jump.phase === "recovery" && this.time + 1e-9 >= jump.endsAt) {
        enemy.nextJumpAt = jump.endsAt + FINAL_BOSS_JUMP_COOLDOWN;
        enemy.jump = null;
      }
    }

    hurt(damage, x, y) {
      if (this.phase !== "running" || this.player.invulnerable > 0) return;
      this.damageTaken += Math.min(this.player.hp, damage);
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

    hitEnemy(enemy, damage, critical = false) {
      if (enemy.hp <= 0) return;
      enemy.hitFlash = 0.1;
      this.events.push({ type: "hit", x: enemy.x, y: enemy.y, damage, critical });
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
      const kind = enemy.type === "boss" || enemy.type === "overlord" ? "crystal" : "gold";
      if (enemy.type === "overlord") this.collectGold(value, enemy.x, enemy.y, { kind });
      else this.pickups.push({ kind, x: enemy.x, y: enemy.y, value, age: 0, magnetized: false });
      if (this.random() < 0.065) this.pickups.push({ kind: "health", x: enemy.x + 12, y: enemy.y + 10, age: 0 });
      this.events.push({ type: "kill", x: enemy.x, y: enemy.y, color: enemy.color, radius: enemy.radius });
      if (enemy.type === "chicken") {
        this.explosionQueue.push(enemy);
        if (this.explosionQueue.length === 1) this.resolveExplosions();
      }
    }

    collectGold(value, x, y, { coins, kind = "gold" } = {}) {
      const credited = Math.min(value, MAX_GOLD - this.profile.gold);
      this.coins += credited;
      this.profile.gold += credited;
      this.events.push({ type: "gold", x, y, value: credited, ...(coins ? { coins } : {}), ...(kind === "crystal" ? { kind } : {}) });
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
      this.waveActive = false;
      this.countdown = 0;
      this.fireballs = [];
      this.profile.bestWave = Math.max(this.profile.bestWave, this.wave);
      this.profile.bestKills = Math.max(this.profile.bestKills, this.kills);
      this.profile.bestTime = Math.max(this.profile.bestTime, this.time);
      this.profile.totalRuns += 1;
      this.report = { reason, level: 1, wave: this.wave, wavesCleared: this.wavesCleared, kills: this.kills, bulletsFired: this.bulletsFired, damageTaken: this.damageTaken, gold: this.coins, time: this.time };
      this.events.push({ type: "ended", report: this.report });
    }

    update(dt, input = { x: 0, y: 0 }) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 0.1) throw new RangeError("Simulation step must be between 0 and 0.1 seconds.");
      if (this.phase !== "running" || dt === 0) return;
      this.time += dt;
      const p = this.player;
      p.hp = Math.min(p.maxHp, p.hp + this.stats.healthRegen * dt);
      const prevPlayerX = p.x;
      const prevPlayerY = p.y;
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
      while (this.wave < LEVEL_WAVES && this.wavesCleared < LEVEL_WAVES - 1 && this.time + 1e-9 >= this.nextBossAt) {
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
        const direction = enemy.type === "skeleton" ? distance > SKELETON_KEEP_DISTANCE + 40 ? 1 : distance < SKELETON_KEEP_DISTANCE - 40 ? -1 : 0 : 1;
        if (distance > 0 && (enemy.type !== "chicken" || enemy.explodeAt === null) && (enemy.type !== "skeleton" || enemy.castUntil === null) && (enemy.type !== "overlord" || enemy.jump === null)) {
          enemy.x = clamp(enemy.x + (dx / distance * enemy.speed * direction + sx) * dt, enemy.radius, WIDTH - enemy.radius);
          enemy.y = clamp(enemy.y + (dy / distance * enemy.speed * direction + sy) * dt, enemy.radius, HEIGHT - enemy.radius);
        }
        const playerDistance = Math.hypot(p.x - enemy.x, p.y - enemy.y);
        if (enemy.type === "chicken") {
          if (enemy.explodeAt === null && playerDistance <= CHICKEN_TRIGGER_DISTANCE) {
            enemy.explodeAt = this.time + CHICKEN_FUSE_DELAY;
            this.events.push({ type: "chickenArmed", x: enemy.x, y: enemy.y });
          }
        } else if (enemy.type !== "skeleton" && !(enemy.type === "overlord" && enemy.jump?.phase === "airborne") && playerDistance < p.radius + enemy.radius && enemy.contactTimer === 0) {
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
          this.shoot();
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
          this.hitEnemy(hit, bullet.damage, bullet.critical);
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

      for (const fireball of this.fireballs) {
        fireball.prevX = fireball.x;
        fireball.prevY = fireball.y;
        const duration = Math.min(dt, fireball.life);
        fireball.x += fireball.vx * duration;
        fireball.y += fireball.vy * duration;
        fireball.life = Math.max(0, fireball.life - dt);
        if (fireball.life < 1e-9) fireball.life = 0;
        // Sweep relative motion so neither a fast fireball nor a moving soldier can skip a hit.
        const playerX = prevPlayerX + (p.x - prevPlayerX) * duration / dt;
        const playerY = prevPlayerY + (p.y - prevPlayerY) * duration / dt;
        const hit = segmentCircleHit(
          fireball.prevX - prevPlayerX, fireball.prevY - prevPlayerY,
          fireball.x - playerX, fireball.y - playerY,
          0, 0, p.radius + fireball.radius,
        );
        if (hit !== null) {
          const x = fireball.prevX + (fireball.x - fireball.prevX) * hit;
          const y = fireball.prevY + (fireball.y - fireball.prevY) * hit;
          fireball.life = 0;
          this.events.push({ type: "fireballImpact", x, y });
          this.hurt(fireball.damage, x, y);
          if (this.phase === "ended") return;
        }
      }
      this.fireballs = this.fireballs.filter(ball => ball.life > 0 && ball.x > -ball.radius && ball.x < WIDTH + ball.radius && ball.y > -ball.radius && ball.y < HEIGHT + ball.radius);
      for (const enemy of this.enemies) {
        if (enemy.type === "skeleton") this.updateSkeleton(enemy);
        if (enemy.type === "overlord") this.updateFinalBoss(enemy);
        if (this.phase === "ended") return;
      }

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
          this.collectGold(pickup.value, pickup.x, pickup.y, { kind: pickup.kind });
          return false;
        }
        if (pickup.magnetized && distance > 0) {
          const movement = Math.min(distance, Math.max(430, this.stats.speed * 1.6) * dt);
          pickup.x += dx / distance * movement;
          pickup.y += dy / distance * movement;
        }
        return pickup.age < 120;
      });

      if (this.waveActive && this.spawnRemaining === 0 && this.enemies.length === 0 && this.fireballs.length === 0) {
        this.pickups = this.pickups.filter(pickup => pickup.kind !== "health");
        if (this.stats.wavePickup === 1 && this.profile.wavePickupEnabled) {
          let value = 0;
          const coins = [];
          this.pickups = this.pickups.filter(pickup => {
            if (pickup.kind !== "gold" && pickup.kind !== "crystal") return true;
            value = Math.min(MAX_GOLD, value + pickup.value);
            coins.push({ x: pickup.x, y: pickup.y, ...(pickup.kind === "crystal" ? { kind: pickup.kind } : {}) });
            return false;
          });
          // Bank immediately; copied pickups animate without risking saved rewards.
          if (value > 0) this.collectGold(value, p.x, p.y, { coins });
        }
        this.waveActive = false;
        this.wavesCleared = this.wave;
        if (this.wave === LEVEL_WAVES) {
          this.finish("victory");
          return;
        }
        this.countdown = 3.5;
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.12);
        this.events.push({ type: "clear", wave: this.wave });
      }
    }

    drainEvents() {
      return this.events.splice(0);
    }
  }

  return { WIDTH, HEIGHT, MAX_GOLD, CRIT_DAMAGE_MULTIPLIER, BASE_ALIEN_STATS, BOSS_INTERVAL, BOSS_CRYSTAL_VALUE, LEVEL_WAVES, FINAL_BOSS_HEALTH_MULTIPLIER, FINAL_BOSS_SPEED, FINAL_BOSS_JUMP_RANGE, FINAL_BOSS_JUMP_COOLDOWN, FINAL_BOSS_JUMP_WINDUP, FINAL_BOSS_JUMP_DURATION, FINAL_BOSS_JUMP_RECOVERY, FINAL_BOSS_SLAM_RADIUS, CHICKEN_SPAWN_CHANCE, CHICKEN_TRIGGER_DISTANCE, CHICKEN_FUSE_DELAY, CHICKEN_EXPLOSION_RADIUS, SKELETON_START_WAVE, SKELETON_SPAWN_CHANCE, SKELETON_ATTACK_RANGE, SKELETON_KEEP_DISTANCE, SKELETON_FIRE_INTERVAL, SKELETON_CAST_TIME, FIREBALL_SPEED, FIREBALL_RADIUS, FIREBALL_LIFETIME, UPGRADES, createProfile, migrateProfile, isValidProfile, getStats, upgradeCost, buyUpgrade, toggleWavePickup, waveSettings, enemyGold, segmentCircleHit, Game };
});
