# Space Survivor

A small, offline game built with plain HTML, CSS, and JavaScript. No dependencies or build step.

## Play

Open `index.html` in Edge, Chrome, or Firefox, then select **Deploy soldier**.

- Move with **WASD** or the **arrow keys**. On a touchscreen, drag the joystick.
- Your soldier automatically shoots the closest living enemy **within weapon range**, including chickens. The outer gold circle shows this range; bullets stop at its limit.
- Weapon range starts at **360 map units**. The armory's **Weapon range** upgrade adds **40 units per level**, up to **960 units at level 15**. Its first level costs 25 gold; later levels cost more.
- Wave 1 keeps its original normal-alien stats: **26 HP, 61 speed, and 8 attack damage**. Later waves scale base health by **30% per wave**, add **6 speed per wave**, and scale attack damage by **20% per wave** (health and damage are rounded). Enemy counts and spawn pressure also increase.
- A large orange boss spawns every **15 seconds of active play**, with **20x the current wave's normal alien health** and **4x its movement speed**. Pausing stops the timer; each new run resets it.
- Explosive chickens make up roughly 20% of normal wave spawns. They stop and light a **1.5-second fuse** when they get within 90 map units of you, and also **explode immediately when killed**, even before their fuse is lit. Blasts damage both you and nearby enemies within the 120-unit radius, dealing three times the wave's normal contact damage. Killing another chicken with a blast starts a chain reaction. Shoot chickens from a safe distance to use them against the swarm. Chickens do not deal contact damage; their fuse stays lit if you move away but freezes while paused. Every enemy killed by a blast awards normal kill credit and loot.
- Walk near gold coins to collect them. The smaller teal circle around your soldier shows your pickup radius.
- Gold rewards scale with each enemy's maximum health and its speed/attack bonuses, rather than a small random reward. A wave-1 normal alien drops **2 gold**, a chicken **4**, and a boss **18**; stronger enemies in later waves pay more. Coins can be worth multiple gold, shown as `+N` when collected. Wounded enemies and kills caused by chicken explosions still pay their full reward.
- Clearing a wave restores 12% of your maximum health. Green medkits restore 22%.
- Press **P** or **Esc** to pause. You can end a run early from the pause menu.

After a run, spend gold in the armory to improve **bullet damage**, **fire rate**, **weapon range**, **run speed**, **maximum health**, and **gold pickup radius**. Upgrades apply to the next run and are permanent.

Collected gold, upgrades, and records save automatically in this browser's local storage. Use the same browser and file location to continue your progress. Private browsing or clearing browser data can remove the save. If saving is blocked, the game displays a warning rather than pretending progress was saved.

Existing saves retain their gold, upgrades, and records. The new weapon-range upgrade starts at level zero.

Sound and fullscreen can be toggled in the interface. Nothing is sent to a server.

## Development

`game-core.js` contains the simulation and upgrade rules. `game.js` handles rendering, controls, menus, audio, and browser saves.

With Node.js installed, run `npm test` to exercise the simulation and upgrade rules. No installation is needed.
