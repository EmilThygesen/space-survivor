# Space Survivor

A small, offline game built with plain HTML, CSS, and JavaScript. No dependencies or build step.

## Play

Open `index.html` in Edge, Chrome, or Firefox, then select **Deploy soldier**.

- Move with **WASD** or the **arrow keys**. On a touchscreen, drag the joystick.
- Your soldier automatically shoots the closest living enemy **within weapon range**, including chickens and skeletons. The outer gold circle shows this range; bullets stop at its limit.
- Weapon range starts at **360 map units**. The armory's **Weapon range** upgrade adds **40 units per level**, up to **960 units at level 15**. Its first level costs 25 gold; later levels cost more.
- The armory's **Dual bullets** upgrade costs **2,500 gold** for **two simultaneous bullets per shot**. Its second and final level costs **7,500 gold** and increases this to **three bullets per shot**. Each parallel bullet deals your full upgraded damage and keeps your normal weapon range and fire rate. Both levels are permanent and apply starting with your next run.
- **Wave gold collection**, beside Dual bullets in the armory, is a **one-time, 2,500-gold** upgrade. Starting with your next run, clearing each wave banks **all remaining gold coins anywhere on the map**, including the final enemy's drop, then animates them flying along glowing, curved trails to your soldier. Rewards are banked immediately, so pausing or ending the run mid-animation cannot lose gold. Normal pickup still works; medkits are not swept up. It activates only after all enemies and incoming fireballs are gone, not when you die or retreat.
- After purchasing Wave gold collection, use its **ON/OFF button in the armory** or **Wave gold: ON/OFF in the game footer** to toggle it for future wave clears, including during a run. The setting is saved, and turning it off does not remove the upgrade or cost gold to re-enable. Already-started collection animations finish normally. Pausing freezes coin flights; reduced-motion mode uses short, straight flights without trails.
- Wave 1 keeps its original normal-alien stats: **26 HP, 61 speed, and 8 attack damage**. Later waves scale base health by **30% per wave**, add **6 speed per wave**, and scale attack damage by **20% per wave** (health and damage are rounded). Enemy counts and spawn pressure also increase.
- A large orange boss spawns every **15 seconds of active play**, with **20x the current wave's normal alien health** and **4x its movement speed**. Pausing stops the timer; each new run resets it.
- Explosive chickens make up roughly 20% of normal wave spawns. They stop and light a **1.5-second fuse** when they get within 90 map units of you, and also **explode immediately when killed**, even before their fuse is lit. Blasts damage both you and nearby enemies within the 120-unit radius, dealing three times the wave's normal contact damage. Killing another chicken with a blast starts a chain reaction. Shoot chickens from a safe distance to use them against the swarm. Chickens do not deal contact damage; their fuse stays lit if you move away but freezes while paused. Every enemy killed by a blast awards normal kill credit and loot.
- Bone-white **skeletons appear from wave 3**, making up roughly **15%** of normal spawns without replacing chickens or bosses. They approach or retreat to stay about 280 units away and attack within 520 units. A glowing staff, `CASTING` label, and charge bar warn you **0.45 seconds before firing**, roughly every **2 seconds**. Fireballs aim at your position when fired and travel straight at 260 units/second, so you can dodge them; they expire after 4 seconds or leaving the arena. Skeletons have **1.3x normal health**, **0.85x movement speed**, and fireballs deal **1.5x normal attack damage**, all using the current wave's stats. They deal no contact damage. Shoot them or use chicken blasts to kill them for strength-based gold; already-fired fireballs stay dangerous until they hit or expire. Waves clear once enemies and incoming fireballs are gone. Pausing freezes casting and projectiles; ending or restarting a run clears them.
- Walk near gold coins to collect them. The smaller teal circle around your soldier shows your pickup radius.
- Gold rewards scale with each enemy's maximum health and its speed/attack bonuses, rather than a small random reward. A wave-1 normal alien drops **2 gold**, a chicken **4**, and a boss **18**; stronger enemies in later waves pay more. Coins can be worth multiple gold, shown as `+N` when collected. Wounded enemies and kills caused by chicken explosions still pay their full reward.
- Clearing a wave restores 12% of your maximum health. Green medkits restore 22%.
- Press **P** or **Esc** to pause. You can end a run early from the pause menu.

After a run, spend gold in the armory to improve **bullet damage**, **fire rate**, **weapon range**, **run speed**, **maximum health**, and **gold pickup radius**, or unlock **dual bullets** and **automatic wave gold collection**. Upgrades apply to the next run and are permanent.

Collected gold, upgrades, and records save automatically in this browser's local storage. Use the same browser and file location to continue your progress. Private browsing or clearing browser data can remove the save. If saving is blocked, the game displays a warning rather than pretending progress was saved.

Existing saves retain their gold, upgrades, and records. Missing weapon-range, dual-bullet, and wave-gold-collection upgrades start at level zero. Previously purchased dual bullets stay at level one with two bullets; the third bullet must be purchased separately. Wave gold collection stays unlocked if already purchased, without an additional charge, and its new toggle defaults to ON.

Sound and fullscreen can be toggled in the interface. Nothing is sent to a server.

## Development

`game-core.js` contains the simulation and upgrade rules. `game.js` handles rendering, controls, menus, audio, and browser saves.

With Node.js installed, run `npm test` to exercise the simulation and upgrade rules. No installation is needed.
