(function () {
  "use strict";

  const Core = window.SpaceSurvivorCore;
  const $ = id => document.getElementById(id);
  const canvas = $("arena");
  const ctx = canvas.getContext("2d");
  const menu = $("menuDialog");
  const shop = $("shopDialog");
  const pause = $("pauseDialog");
  const SAVE_KEY = "space-survivor.save.v1";
  const keys = new Set();
  const movementKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = { x: 0, y: 0, pointer: null };
  const particles = [];
  const floaters = [];
  const blasts = [];
  let savingDisabled = false;
  let dirty = false;
  let saveClock = 0;
  let shake = 0;
  let toastTime = 0;
  let soundEnabled = true;
  let audio = null;
  let lastFrame = 0;
  let accumulator = 0;
  let uiClock = 0;

  function notice(message) {
    $("notice").textContent = message;
    $("notice").hidden = false;
  }

  function loadProfile() {
    let raw;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (error) {
      savingDisabled = true;
      notice(`Browser storage is unavailable (${error.name}). Progress will only last while this page stays open.`);
      return Core.createProfile();
    }
    if (!raw) return Core.createProfile();
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      savingDisabled = true;
      notice("Your saved game could not be read. It has not been overwritten. Use 'Reset saved progress' in the armory to start a new save.");
      return Core.createProfile();
    }
    const migrated = Core.migrateProfile(saved);
    if (!Core.isValidProfile(migrated)) {
      savingDisabled = true;
      notice("Your saved game has invalid or unsupported values. It has not been overwritten. Reset it in the armory to enable saving again.");
      return Core.createProfile();
    }
    if (migrated !== saved) dirty = true;
    return migrated;
  }

  let profile = loadProfile();
  const game = new Core.Game();

  function saveProfile() {
    if (savingDisabled) {
      $("saveStatus").textContent = "Saving unavailable / see notice above";
      return;
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(profile));
      dirty = false;
      $("saveStatus").textContent = "Progress saved on this browser";
    } catch (error) {
      savingDisabled = true;
      $("saveStatus").textContent = "Saving unavailable / see notice above";
      notice(`Progress could not be saved (${error.name}). Keep this page open; collected gold and upgrades are currently only in memory.`);
    }
  }

  function startAudio() {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      soundEnabled = false;
      $("soundButton").textContent = "No audio";
      $("soundButton").setAttribute("aria-pressed", "false");
      return;
    }
    if (!audio) audio = new AudioContext();
    if (audio.state === "suspended") {
      audio.resume().catch(error => {
        notice(`Sound could not start (${error.name}). You can continue playing without sound.`);
      });
    }
  }

  function tone(frequency, duration, volume, type = "sine", endFrequency = frequency) {
    if (!soundEnabled || !audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), audio.currentTime + duration);
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  function resetInput() {
    keys.clear();
    touch.x = 0;
    touch.y = 0;
    touch.pointer = null;
    $("joystickThumb").style.transform = "";
  }

  function startRun() {
    menu.close();
    shop.close();
    pause.close();
    resetInput();
    particles.length = 0;
    floaters.length = 0;
    blasts.length = 0;
    accumulator = 0;
    shake = 0;
    game.start(profile);
    startAudio();
    canvas.focus({ preventScroll: true });
    updateHud();
  }

  function pauseRun() {
    if (game.phase !== "running") return;
    game.pause();
    resetInput();
    saveProfile();
    pause.showModal();
    updateHud();
  }

  function resumeRun() {
    if (game.phase !== "paused") return;
    pause.close();
    resetInput();
    game.resume();
    accumulator = 0;
    canvas.focus({ preventScroll: true });
    updateHud();
  }

  const symbols = {
    damage: '<path d="m8 22 13-13 3 3-13 13H8Zm13-13 3-3 3 3-3 3M6 26l-2 2m0-7 3-1m8 8-1 3"/>',
    fireRate: '<path d="m5 9 12-3-4 9 12-3-10 15 2-11-12 3ZM4 5h6M3 27h6"/>',
    range: '<circle cx="16" cy="16" r="9"/><path d="M16 3v8m0 10v8M3 16h8m10 0h8"/><circle cx="16" cy="16" r="2"/>',
    speed: '<path d="m17 6 7 8-6 5 6 7H12l-4-5 5-6-3-5ZM3 11h5M3 17h6M3 23h3"/>',
    hp: '<path d="M16 4 27 8v9c0 6-11 12-11 12S5 23 5 17V8ZM16 11v10m-5-5h10"/>',
    pickup: '<path d="M7 5v12a9 9 0 0 0 18 0V5h-6v12a3 3 0 0 1-6 0V5ZM7 11h6m6 0h6"/>',
    bullets: '<path d="M6 25V10l4-5 4 5v15Zm12 0V10l4-5 4 5v15ZM6 18h8m4 0h8"/>',
    wavePickup: '<circle cx="7" cy="7" r="3"/><circle cx="25" cy="7" r="3"/><circle cx="7" cy="18" r="3"/><circle cx="25" cy="18" r="3"/><path d="M16 5v17m-5-5 5 5 5-5M8 27h16"/>',
  };

  function displayStat(key, stats) {
    if (key === "damage") return `${stats.damage} dmg`;
    if (key === "fireRate") return `${stats.fireRate.toFixed(1)} / sec`;
    if (key === "range") return `${stats.range} range`;
    if (key === "speed") return `${stats.speed} speed`;
    if (key === "hp") return `${stats.hp} HP`;
    if (key === "bullets") return `${stats.bullets} ${stats.bullets === 1 ? "bullet" : "bullets"} / shot`;
    if (key === "wavePickup") return stats.wavePickup === 1 ? "All gold after each wave" : "Manual pickup";
    return `${stats.pickup} radius`;
  }

  function renderShop() {
    $("shopGold").textContent = profile.gold.toLocaleString();
    const grid = $("upgradeGrid");
    grid.replaceChildren();
    const current = Core.getStats(profile);
    for (const [key, upgrade] of Object.entries(Core.UPGRADES)) {
      const cost = Core.upgradeCost(profile, key);
      const maxed = cost === null;
      const affordable = !maxed && profile.gold >= cost;
      const nextProfile = { ...profile, levels: { ...profile.levels, [key]: profile.levels[key] + (maxed ? 0 : 1) } };
      const next = Core.getStats(nextProfile);
      const card = document.createElement("article");
      card.className = `upgrade-card${affordable ? " affordable" : ""}${key === "bullets" || key === "wavePickup" ? " advanced" : ""}`;
      card.innerHTML = `<div class="upgrade-top"><svg class="upgrade-symbol" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[key]}</svg><span class="upgrade-level">LVL ${profile.levels[key]} / ${upgrade.maxLevel}</span></div><h3>${upgrade.name}</h3><p>${upgrade.description}</p><div class="upgrade-values">${displayStat(key, current)}${maxed ? "" : `<span>&rarr;</span>${displayStat(key, next)}`}</div>`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "buy-button";
      button.dataset.upgrade = key;
      button.disabled = !affordable;
      button.setAttribute("aria-label", maxed ? `${upgrade.name}: maximum level` : `Upgrade ${upgrade.name} for ${cost} gold`);
      button.innerHTML = maxed ? "<span>Maximum level</span>" : `<span>Upgrade</span><span class="price">${cost.toLocaleString()} gold</span>`;
      button.addEventListener("click", () => {
        const result = Core.buyUpgrade(profile, key);
        if (!result.success) {
          $("shopMessage").textContent = result.reason;
          return;
        }
        dirty = true;
        saveProfile();
        startAudio();
        tone(540, 0.13, 0.05, "sine", 940);
        renderShop();
        updateHud();
        $("shopMessage").textContent = `${upgrade.name} upgraded to level ${profile.levels[key]}. Ready for your next run.`;
        const replacement = grid.querySelector(`[data-upgrade="${key}"]`);
        if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      });
      card.append(button);
      grid.append(card);
    }
    const note = document.createElement("aside");
    note.className = "armory-note";
    note.innerHTML = "<strong>Your gold stays with you.</strong><span>Collected coins and upgrades are saved locally. Clearing a wave restores 12% health. Green medkits heal another 22%.</span>";
    grid.append(note);
  }

  function openShop(showReport) {
    menu.close();
    pause.close();
    $("runSummary").hidden = !showReport;
    if (showReport && game.report) {
      const report = game.report;
      $("summaryWave").textContent = report.wave;
      $("summaryKills").textContent = report.kills;
      $("summaryTime").textContent = formatTime(report.time);
      $("summaryGold").textContent = `+${report.gold}`;
      $("shopIntro").textContent = report.reason === "overrun" ? "The swarm won this round. Your collected gold survived. Refit and try again." : "Mission ended. Your collected gold is banked. Refit before your next run.";
    } else {
      $("shopIntro").textContent = "Upgrades are permanent and carry over to every future run.";
    }
    $("shopMessage").textContent = profile.gold < 20 ? "Deploy and collect gold to buy your first upgrade." : "Choose your upgrades, then deploy again.";
    renderShop();
    if (!shop.open) shop.showModal();
  }

  $("startButton").addEventListener("click", startRun);
  $("shopStartButton").addEventListener("click", startRun);
  $("menuShopButton").addEventListener("click", () => openShop(false));
  $("pauseButton").addEventListener("click", pauseRun);
  $("resumeButton").addEventListener("click", resumeRun);
  $("retreatButton").addEventListener("click", () => {
    pause.close();
    game.finish("retreated");
    processEvents();
    updateHud();
  });
  $("shopBackButton").addEventListener("click", () => {
    shop.close();
    menu.showModal();
  });
  $("resetButton").addEventListener("click", () => {
    if (!window.confirm("Reset all saved gold, upgrades, and records? This cannot be undone.")) return;
    profile = Core.createProfile();
    savingDisabled = false;
    $("notice").hidden = true;
    game.report = null;
    $("runSummary").hidden = true;
    dirty = true;
    saveProfile();
    renderShop();
    updateHud();
    $("shopMessage").textContent = "Progress reset. A new soldier is ready to deploy.";
  });
  $("soundButton").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    $("soundButton").setAttribute("aria-pressed", String(soundEnabled));
    $("soundButton").textContent = soundEnabled ? "Sound on" : "Sound off";
    if (soundEnabled) startAudio();
  });
  $("fullscreenButton").addEventListener("click", () => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request.catch(error => notice(`Fullscreen is unavailable (${error.name}). The game still works in the normal browser window.`));
  });
  menu.addEventListener("cancel", event => event.preventDefault());
  shop.addEventListener("cancel", event => event.preventDefault());
  pause.addEventListener("cancel", event => {
    event.preventDefault();
    resumeRun();
  });
  window.addEventListener("keydown", event => {
    if (movementKeys.has(event.code) && game.phase === "running") {
      event.preventDefault();
      keys.add(event.code);
    }
    if (event.repeat) return;
    if (event.code === "KeyP" || event.code === "Escape") {
      if (game.phase === "running") {
        event.preventDefault();
        pauseRun();
      } else if (game.phase === "paused") {
        event.preventDefault();
        resumeRun();
      }
    }
  });
  window.addEventListener("keyup", event => keys.delete(event.code));
  window.addEventListener("blur", pauseRun);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseRun();
      if (dirty) saveProfile();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (dirty) saveProfile();
  });

  const joystick = $("joystick");
  function moveJoystick(event) {
    const rect = joystick.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const radius = rect.width * 0.36;
    const divisor = Math.max(radius, Math.hypot(x, y));
    touch.x = x / divisor;
    touch.y = y / divisor;
    $("joystickThumb").style.transform = `translate(${touch.x * radius}px, ${touch.y * radius}px)`;
  }
  joystick.addEventListener("pointerdown", event => {
    if (game.phase !== "running" || touch.pointer !== null) return;
    event.preventDefault();
    touch.pointer = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    moveJoystick(event);
  });
  joystick.addEventListener("pointermove", event => {
    if (event.pointerId === touch.pointer) moveJoystick(event);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    joystick.addEventListener(type, event => {
      if (event.pointerId === touch.pointer) resetInput();
    });
  }

  function formatTime(seconds) {
    return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
  }

  function updateHud() {
    const active = game.phase === "running" || game.phase === "paused";
    const stats = active ? game.stats : Core.getStats(profile);
    const hp = active || game.phase === "ended" ? game.player.hp : stats.hp;
    const maxHp = active || game.phase === "ended" ? game.player.maxHp : stats.hp;
    $("bankGold").textContent = profile.gold.toLocaleString();
    $("bestWave").textContent = profile.bestWave || "--";
    $("runGold").textContent = game.coins.toLocaleString();
    $("kills").textContent = game.kills.toLocaleString();
    $("runTime").textContent = formatTime(game.time);
    $("damageStat").textContent = stats.damage;
    $("fireRateStat").innerHTML = `${stats.fireRate.toFixed(1)}<span class="unit"> / s</span>`;
    $("rangeStat").textContent = stats.range;
    $("healthLabel").textContent = `${Math.ceil(hp)} / ${maxHp}`;
    $("healthBar").setAttribute("aria-valuemax", String(maxHp));
    $("healthBar").setAttribute("aria-valuenow", String(Math.ceil(hp)));
    $("healthFill").style.width = `${hp / maxHp * 100}%`;
    $("healthFill").style.background = hp / maxHp < 0.3 ? "#f08080" : "#7df1d5";
    $("pauseButton").disabled = game.phase !== "running";
    $("missionStatus").textContent = game.phase === "paused" ? "MISSION PAUSED" : game.phase === "running" ? (game.countdown > 0 ? "NEXT WAVE INCOMING" : "SWARM DETECTED") : game.phase === "ended" ? "MISSION COMPLETE" : "AWAITING DEPLOYMENT";
    $("waveLabel").textContent = active ? (game.countdown > 0 ? `WAVE ${game.wave + 1} / ${Math.ceil(game.countdown)}s` : `WAVE ${game.wave}`) : game.wave ? `WAVE ${game.wave}` : "SECTOR 07";
    if (savingDisabled) $("saveStatus").textContent = "Saving unavailable / see notice above";
  }

  function burst(x, y, color, count, force) {
    if (reducedMotion) count = Math.min(3, count);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * force;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, life: 0.3 + Math.random() * 0.35, maxLife: 0.65, size: 1.5 + Math.random() * 2.8 });
    }
  }

  function showWaveToast(text) {
    $("waveToast").textContent = text;
    $("waveToast").hidden = false;
    toastTime = 2.1;
  }

  function processEvents() {
    for (const event of game.drainEvents()) {
      if (event.type === "start") showWaveToast("STAY MOBILE. STAY ALIVE.");
      if (event.type === "wave") {
        showWaveToast(`WAVE ${event.wave} / INCOMING`);
        tone(180, 0.3, 0.045, "triangle", 340);
      }
      if (event.type === "boss") {
        showWaveToast("BOSS ALIEN / INCOMING");
        tone(95, 0.5, 0.05, "sawtooth", 210);
      }
      if (event.type === "clear") {
        showWaveToast(`WAVE ${event.wave} CLEAR / +12% HEALTH`);
        tone(440, 0.25, 0.045, "sine", 880);
      }
      if (event.type === "shot") tone(135, 0.045, 0.024, "square", 45);
      if (event.type === "hit") floaters.push({ x: event.x, y: event.y - 17, text: String(Math.round(event.damage)), color: "#f7efce", life: 0.55 });
      if (event.type === "kill") {
        burst(event.x, event.y, event.color, 11, 130);
        tone(85, 0.06, 0.018, "triangle", 38);
      }
      if (event.type === "gold") {
        dirty = true;
        if (event.value > 0) floaters.push({ x: event.x, y: event.y - 15, text: `+${event.value}`, color: "#f4c46c", life: 0.75 });
        burst(event.x, event.y, "#f4c46c", 4, 65);
        tone(820, 0.055, 0.018, "sine", 1200);
      }
      if (event.type === "heal") {
        floaters.push({ x: event.x, y: event.y - 25, text: "+HEALTH", color: "#7df1d5", life: 0.8 });
        tone(520, 0.1, 0.035, "sine", 780);
      }
      if (event.type === "hurt") {
        shake = reducedMotion ? 0 : 7;
        burst(event.x, event.y, "#f58c84", 6, 100);
        tone(110, 0.12, 0.04, "sawtooth", 40);
      }
      if (event.type === "chickenArmed") tone(680, 0.12, 0.04, "triangle", 320);
      if (event.type === "skeletonCast") tone(220, 0.18, 0.025, "triangle", 440);
      if (event.type === "fireballShot") {
        burst(event.x, event.y, "#fb923c", 5, 55);
        tone(180, 0.14, 0.025, "sawtooth", 65);
      }
      if (event.type === "fireballImpact") burst(event.x, event.y, "#fb923c", 9, 110);
      if (event.type === "explosion") {
        blasts.push({ x: event.x, y: event.y, radius: event.radius, life: 0.45, maxLife: 0.45 });
        burst(event.x, event.y, "#ffc56b", 28, 260);
        burst(event.x, event.y, "#f4e8c9", 12, 160);
        shake = reducedMotion ? 0 : Math.max(shake, 8);
        tone(90, 0.25, 0.06, "sawtooth", 25);
      }
      if (event.type === "ended") {
        dirty = true;
        saveProfile();
        resetInput();
        $("waveToast").hidden = true;
        if (event.report.reason === "overrun") burst(game.player.x, game.player.y, "#7df1d5", 24, 160);
        openShop(true);
      }
    }
  }

  const floor = document.createElement("canvas");
  floor.width = Core.WIDTH;
  floor.height = Core.HEIGHT;
  const floorCtx = floor.getContext("2d");
  const floorGradient = floorCtx.createLinearGradient(0, 0, Core.WIDTH, Core.HEIGHT);
  floorGradient.addColorStop(0, "#12242f");
  floorGradient.addColorStop(1, "#0a1924");
  floorCtx.fillStyle = floorGradient;
  floorCtx.fillRect(0, 0, Core.WIDTH, Core.HEIGHT);
  floorCtx.strokeStyle = "#243744";
  floorCtx.lineWidth = 1;
  for (let x = 16; x < Core.WIDTH; x += 64) {
    floorCtx.beginPath(); floorCtx.moveTo(x, 0); floorCtx.lineTo(x, Core.HEIGHT); floorCtx.stroke();
  }
  for (let y = 2; y < Core.HEIGHT; y += 64) {
    floorCtx.beginPath(); floorCtx.moveTo(0, y); floorCtx.lineTo(Core.WIDTH, y); floorCtx.stroke();
  }
  floorCtx.strokeStyle = "#49626a";
  floorCtx.lineWidth = 2;
  floorCtx.strokeRect(30, 30, Core.WIDTH - 60, Core.HEIGHT - 60);
  floorCtx.strokeStyle = "#d7b96c55";
  floorCtx.lineWidth = 4;
  floorCtx.setLineDash([14, 14]);
  floorCtx.strokeRect(13, 13, Core.WIDTH - 26, Core.HEIGHT - 26);
  floorCtx.setLineDash([]);
  floorCtx.strokeStyle = "#4e8f8c33";
  for (const radius of [118, 128, 215]) {
    floorCtx.beginPath(); floorCtx.arc(Core.WIDTH / 2, Core.HEIGHT / 2, radius, 0, Math.PI * 2); floorCtx.stroke();
  }
  floorCtx.strokeStyle = "#57868d44";
  floorCtx.beginPath();
  floorCtx.moveTo(Core.WIDTH / 2 - 250, Core.HEIGHT / 2);
  floorCtx.lineTo(Core.WIDTH / 2 + 250, Core.HEIGHT / 2);
  floorCtx.moveTo(Core.WIDTH / 2, Core.HEIGHT / 2 - 250);
  floorCtx.lineTo(Core.WIDTH / 2, Core.HEIGHT / 2 + 250);
  floorCtx.stroke();
  floorCtx.fillStyle = "#536d7540";
  floorCtx.font = '700 65px "Segoe UI", sans-serif';
  floorCtx.textAlign = "center";
  floorCtx.fillText("07", Core.WIDTH / 2, Core.HEIGHT / 2 + 22);
  floorCtx.font = '11px "Segoe UI", sans-serif';
  floorCtx.fillText("C I N D E R   /   L A N D I N G   Z O N E", Core.WIDTH / 2, Core.HEIGHT / 2 + 150);
  for (const [x, y] of [[150, 180], [1120, 180], [150, 670], [1120, 670]]) {
    floorCtx.fillStyle = "#203340";
    floorCtx.fillRect(x, y, 170, 70);
    floorCtx.strokeStyle = "#36505b";
    floorCtx.strokeRect(x, y, 170, 70);
    floorCtx.fillStyle = "#58818a55";
    for (let n = 0; n < 5; n += 1) floorCtx.fillRect(x + 17 + n * 30, y + 17, 15, 36);
    floorCtx.fillStyle = "#93b5b96b";
    floorCtx.font = '9px "Segoe UI", sans-serif';
    floorCtx.textAlign = "left";
    floorCtx.fillText("MAINTENANCE PLATING / WALKABLE", x, y - 9);
  }
  for (let i = 0; i < 100; i += 1) {
    const x = (i * 157 + 53) % Core.WIDTH;
    const y = (i * 271 + 91) % Core.HEIGHT;
    floorCtx.fillStyle = "#020b142e";
    floorCtx.beginPath(); floorCtx.ellipse(x, y, 4 + i % 9, 2 + i % 4, i, 0, Math.PI * 2); floorCtx.fill();
  }

  function circle(x, y, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemyHealth(enemy) {
    if (enemy.type !== "boss" && enemy.hp >= enemy.maxHp) return;
    const r = enemy.radius;
    ctx.fillStyle = "#0009"; ctx.fillRect(enemy.x - r, enemy.y - r - 13, r * 2, 4);
    ctx.fillStyle = enemy.color; ctx.fillRect(enemy.x - r, enemy.y - r - 13, r * 2 * Math.max(0, enemy.hp / enemy.maxHp), 4);
  }

  function drawChicken(enemy) {
    const r = enemy.radius;
    const armed = enemy.explodeAt !== null;
    const remaining = armed ? Math.max(0, enemy.explodeAt - game.time) : 0;
    const pulse = armed && !reducedMotion && Math.sin(game.time * 10) > 0;
    if (armed) {
      ctx.save();
      ctx.fillStyle = pulse ? "#ef44441c" : "#ef44440c";
      ctx.strokeStyle = pulse ? "#ff7777" : "#ef4444";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(enemy.x, enemy.y, Core.CHICKEN_EXPLOSION_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(enemy.angle);
    ctx.fillStyle = "#0006";
    ctx.beginPath(); ctx.ellipse(0, 5, r * 1.15, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    const feathers = enemy.hitFlash > 0 ? "#ffffff" : pulse ? "#ffb6a0" : enemy.color;
    const stride = armed ? 0 : Math.sin(game.time * 24 + enemy.wobble) * 4;
    ctx.strokeStyle = "#e9a742";
    ctx.lineWidth = 3;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-3 + side * stride, side * 9); ctx.lineTo(-8 + side * stride, side * 18); ctx.lineTo(-3 + side * stride, side * 20); ctx.stroke();
    }
    ctx.fillStyle = feathers;
    ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-26, -10); ctx.lineTo(-22, 0); ctx.lineTo(-26, 10); ctx.lineTo(-10, 6); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2, 0, r, r * 0.74, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pulse ? "#dc8068" : "#d7c8a5";
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(-4, side * 8, 11, 4, side * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    circle(11, 0, 10, feathers);
    ctx.fillStyle = "#efb543";
    ctx.beginPath(); ctx.moveTo(18, -4); ctx.lineTo(30, 0); ctx.lineTo(18, 4); ctx.fill();
    circle(13, -6, 2.3, "#17222d");
    circle(13, 6, 2.3, "#17222d");
    for (const x of [3, 8, 13]) circle(x, 0, 3.5, "#e44f54");
    ctx.restore();
    drawEnemyHealth(enemy);
    if (armed) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '700 13px "Segoe UI", sans-serif';
      ctx.fillStyle = "#ffcf9c";
      ctx.fillText(`${remaining.toFixed(1)}s`, enemy.x, enemy.y - r - 22);
      ctx.restore();
    }
  }

  function drawSkeleton(enemy) {
    const casting = enemy.castUntil !== null;
    const charge = casting ? Math.max(0, Math.min(1, 1 - (enemy.castUntil - game.time) / Core.SKELETON_CAST_TIME)) : 0;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(enemy.angle);
    ctx.fillStyle = "#0006";
    ctx.beginPath(); ctx.ellipse(-3, 5, 24, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = enemy.hitFlash > 0 ? "#ffffff" : enemy.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    const stride = casting ? 0 : Math.sin(game.time * 12 + enemy.wobble) * 3;
    ctx.beginPath(); ctx.moveTo(-19, 0); ctx.lineTo(5, 0); ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-15, side * 4); ctx.lineTo(-22 + side * stride, side * 12); ctx.lineTo(-26 + side * stride, side * 17); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, side * 5); ctx.lineTo(-4, side * 16); ctx.lineTo(15, side * 13); ctx.stroke();
      for (const x of [-10, -5, 0]) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x - 4, side * 8, x + 3, side * 9); ctx.stroke();
      }
    }
    circle(10, 0, 11, enemy.hitFlash > 0 ? "#ffffff" : enemy.color);
    ctx.fillStyle = "#1a2430"; ctx.fillRect(16, -4, 5, 8);
    for (const side of [-1, 1]) {
      circle(12, side * 4, 3.5, "#17222d");
      circle(13, side * 4, 1.6, "#ff7951");
    }
    ctx.strokeStyle = "#705641"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(15, 13); ctx.lineTo(30, 0); ctx.stroke();
    circle(30, 0, casting ? 13 + charge * 4 : 7, casting ? "#fb923c44" : "#fb923c22");
    circle(30, 0, casting ? 6 + charge * 3 : 4, "#fb923c");
    circle(30, 0, casting ? 3 + charge * 2 : 2, "#fff0a5");
    ctx.restore();
    drawEnemyHealth(enemy);
    if (casting) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '700 11px "Segoe UI", sans-serif';
      ctx.fillStyle = "#ffc078";
      ctx.fillText("CASTING", enemy.x, enemy.y - enemy.radius - 22);
      ctx.fillStyle = "#fb923c";
      ctx.fillRect(enemy.x - 20, enemy.y + enemy.radius + 8, 40 * charge, 3);
      ctx.restore();
    }
  }

  function drawFireball(ball) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const dx = ball.vx / speed;
    const dy = ball.vy / speed;
    ctx.strokeStyle = "#f9731677";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(ball.x - dx * 24, ball.y - dy * 24); ctx.lineTo(ball.x, ball.y); ctx.stroke();
    circle(ball.x, ball.y, ball.radius + 6, "#fb923c33");
    circle(ball.x, ball.y, ball.radius, "#f97316");
    circle(ball.x + dx * 2, ball.y + dy * 2, ball.radius * 0.55, "#fff0a5");
  }

  function drawEnemy(enemy) {
    if (enemy.type === "chicken") {
      drawChicken(enemy);
      return;
    }
    if (enemy.type === "skeleton") {
      drawSkeleton(enemy);
      return;
    }
    const r = enemy.radius;
    const isBoss = enemy.type === "boss";
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(enemy.angle);
    ctx.fillStyle = "#0006";
    ctx.beginPath(); ctx.ellipse(0, 5, r * 1.3, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = enemy.hitFlash > 0 ? "#e9ffe0" : enemy.color;
    ctx.lineWidth = isBoss || enemy.type === "brute" ? 5 : 3;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const x = (i - 1) * r * 0.65;
        const step = Math.sin(game.time * enemy.speed * 0.13 + i * 1.8 + enemy.wobble) * 4;
        ctx.beginPath(); ctx.moveTo(x, side * r * 0.5); ctx.lineTo(x - 5 + step, side * r * 1.15); ctx.lineTo(x + 2 + step, side * r * 1.5); ctx.stroke();
      }
    }
    ctx.fillStyle = enemy.hitFlash > 0 ? "#e9ffe0" : enemy.color;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#26372d77";
    ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 0.55, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    for (const side of [-1, 1]) {
      circle(r * 0.45, side * r * 0.35, r * 0.24, "#19212b");
      circle(r * 0.55, side * r * 0.35, r * 0.1, "#ffecbc");
    }
    ctx.strokeStyle = "#1c2b2c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(r * 0.65, -r * 0.1); ctx.lineTo(r * 0.95, 0); ctx.lineTo(r * 0.65, r * 0.1); ctx.stroke();
    if (isBoss || enemy.type === "brute") {
      ctx.fillStyle = isBoss ? "#ffe1bc" : "#e2c9f3";
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(-r * 0.48, side * r * 0.56); ctx.lineTo(-r * 1.04, side * r * 0.96); ctx.lineTo(-r * 0.88, side * r * 0.24); ctx.fill();
      }
    }
    ctx.restore();
    drawEnemyHealth(enemy);
    if (isBoss) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '700 11px "Segoe UI", sans-serif';
      ctx.fillStyle = "#ffe1bc";
      ctx.fillText("BOSS", enemy.x, enemy.y - r - 20);
      ctx.restore();
    }
  }

  function drawPlayer() {
    const p = game.player;
    if (game.phase === "ended" && p.hp <= 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (game.phase === "running") {
      ctx.strokeStyle = "#f4c46c33";
      ctx.lineWidth = 1;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(0, 0, game.stats.range, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#7df1d515";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 11]);
      ctx.beginPath(); ctx.arc(0, 0, game.stats.pickup, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    circle(0, 6, 21, "#0007");
    ctx.rotate(p.angle);
    if (p.invulnerable > 0 && Math.floor(p.invulnerable * 18) % 2 === 0) ctx.globalAlpha = 0.5;
    const stride = Math.sin(game.time * 22) * p.moving * 6;
    ctx.fillStyle = "#507784";
    ctx.fillRect(-15 + stride, -14, 13, 8);
    ctx.fillRect(-15 - stride, 6, 13, 8);
    ctx.fillStyle = "#243a4e"; ctx.fillRect(-16, -10, 12, 20);
    ctx.fillStyle = "#719aab"; ctx.beginPath(); ctx.roundRect(-10, -12, 22, 24, 6); ctx.fill();
    ctx.fillStyle = "#c3dae0"; ctx.beginPath(); ctx.roundRect(-4, -10, 18, 20, 6); ctx.fill();
    ctx.fillStyle = "#44c5c2"; ctx.beginPath(); ctx.roundRect(5, -7, 7, 14, 3); ctx.fill();
    ctx.fillStyle = "#a4d4da"; ctx.fillRect(3, 8, 16, 5);
    const bulletCount = game.stats?.bullets ?? 1;
    for (let i = 0; i < bulletCount; i += 1) {
      const center = bulletCount === 1 ? 3.5 : (i - (bulletCount - 1) / 2) * 10;
      ctx.fillStyle = "#364d61"; ctx.beginPath(); ctx.roundRect(10, center - 3.5, 23, 7, 2); ctx.fill();
      ctx.fillStyle = "#e3d7af"; ctx.fillRect(28, center - 2.5, 7, 5);
      if (p.muzzleFlash > 0) {
        ctx.fillStyle = "#ffe8a7";
        ctx.beginPath(); ctx.moveTo(34, center - 6.5); ctx.lineTo(48, center - 0.5); ctx.lineTo(34, center + 7.5); ctx.lineTo(38, center - 0.5); ctx.fill();
      }
    }
    ctx.restore();
  }

  function render() {
    const scaleX = canvas.width / Core.WIDTH;
    const scaleY = canvas.height / Core.HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, Core.WIDTH, Core.HEIGHT);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.drawImage(floor, 0, 0);
    for (const pickup of game.pickups) {
      if (pickup.kind === "gold") {
        circle(pickup.x, pickup.y + 4, 9, "#0005");
        ctx.save(); ctx.translate(pickup.x, pickup.y); ctx.scale(0.55 + Math.abs(Math.sin(pickup.age * 3)) * 0.45, 1);
        circle(0, 0, 7, "#c18b40");
        circle(0, 0, 5, "#f5c76e");
        ctx.strokeStyle = "#ffe7a5"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#fff0bd"; ctx.fillRect(-1, -3, 2, 6);
        ctx.restore();
      } else {
        ctx.fillStyle = "#153f35"; ctx.fillRect(pickup.x - 10, pickup.y - 10, 20, 20);
        ctx.strokeStyle = "#7df1d5"; ctx.strokeRect(pickup.x - 10, pickup.y - 10, 20, 20);
        ctx.fillStyle = "#7df1d5"; ctx.fillRect(pickup.x - 2, pickup.y - 6, 4, 12); ctx.fillRect(pickup.x - 6, pickup.y - 2, 12, 4);
      }
    }
    const target = game.phase === "running" ? game.closestEnemy() : null;
    if (target) {
      ctx.strokeStyle = "#eaca8644"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(target.x, target.y, target.radius + 8, 0, Math.PI * 2); ctx.stroke();
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
        const x = Math.cos(angle); const y = Math.sin(angle);
        ctx.beginPath(); ctx.moveTo(target.x + x * (target.radius + 5), target.y + y * (target.radius + 5)); ctx.lineTo(target.x + x * (target.radius + 12), target.y + y * (target.radius + 12)); ctx.stroke();
      }
    }
    for (const enemy of game.enemies) drawEnemy(enemy);
    for (const bullet of game.bullets) {
      const length = Math.hypot(bullet.vx, bullet.vy);
      ctx.strokeStyle = "#d6b75c66"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bullet.x - bullet.vx / length * 27, bullet.y - bullet.vy / length * 27); ctx.lineTo(bullet.x, bullet.y); ctx.stroke();
      circle(bullet.x, bullet.y, 2.6, "#fff3b9");
    }
    for (const fireball of game.fireballs) drawFireball(fireball);
    drawPlayer();
    for (const blast of blasts) {
      ctx.save();
      ctx.globalAlpha = blast.life / blast.maxLife;
      const radius = blast.radius * (reducedMotion ? 1 : Math.sqrt(1 - blast.life / blast.maxLife));
      circle(blast.x, blast.y, radius, "#ef444438");
      ctx.strokeStyle = "#ff7777";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(blast.x, blast.y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    for (const particle of particles) {
      ctx.globalAlpha = Math.min(1, particle.life / particle.maxLife);
      circle(particle.x, particle.y, particle.size, particle.color);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.font = '700 13px "Segoe UI", sans-serif';
    for (const floater of floaters) {
      ctx.globalAlpha = Math.min(1, floater.life * 2);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (game.phase === "running" && game.player.hp < game.player.maxHp * 0.3) {
      const gradient = ctx.createRadialGradient(Core.WIDTH / 2, Core.HEIGHT / 2, 250, Core.WIDTH / 2, Core.HEIGHT / 2, 800);
      gradient.addColorStop(0, "#ba393900"); gradient.addColorStop(1, "#c4434338");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, Core.WIDTH, Core.HEIGHT);
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    render();
  }
  new ResizeObserver(resize).observe(canvas);

  function frame(timestamp) {
    const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.08) : 0;
    lastFrame = timestamp;
    if (game.phase === "running") {
      accumulator += dt;
      const input = {
        x: Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) + touch.x,
        y: Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")) + touch.y,
      };
      while (accumulator >= 1 / 60 && game.phase === "running") {
        game.update(1 / 60, input);
        accumulator -= 1 / 60;
      }
      processEvents();
    } else {
      accumulator = 0;
    }
    if (game.phase !== "paused") {
      for (let i = blasts.length - 1; i >= 0; i -= 1) {
        blasts[i].life -= dt;
        if (blasts[i].life <= 0) blasts.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt);
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = floaters.length - 1; i >= 0; i -= 1) {
        floaters[i].life -= dt; floaters[i].y -= dt * 45;
        if (floaters[i].life <= 0) floaters.splice(i, 1);
      }
      shake = Math.max(0, shake - dt * 24);
      toastTime = Math.max(0, toastTime - dt);
      if (toastTime === 0) $("waveToast").hidden = true;
    }
    saveClock += dt;
    if (dirty && saveClock >= 1) { saveProfile(); saveClock = 0; }
    uiClock += dt;
    if (uiClock >= 0.08) { updateHud(); uiClock = 0; }
    render();
    requestAnimationFrame(frame);
  }

  updateHud();
  menu.showModal();
  resize();
  requestAnimationFrame(frame);
})();
