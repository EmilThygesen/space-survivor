# Space Survivor

A small, offline game built with plain HTML, CSS, and JavaScript. No dependencies or build step.

## Play

Open `index.html` in Edge, Chrome, or Firefox, then select **Deploy soldier**.

- Move with **WASD** or the **arrow keys**. On a touchscreen, drag the joystick.
- Your soldier automatically shoots the closest living alien.
- Each wave adds more aliens with increasing health, damage, and speed.
- A large orange boss spawns every **15 seconds of active play**, with **10x the current wave's normal alien health** and **2x its movement speed**. Pausing stops the timer; each new run resets it.
- Walk near gold coins to collect them. The faint circle around your soldier shows your pickup radius.
- Clearing a wave restores 12% of your maximum health. Green medkits restore 22%.
- Press **P** or **Esc** to pause. You can end a run early from the pause menu.

After a run, spend gold in the armory to improve **bullet damage**, **fire rate**, **run speed**, **maximum health**, and **gold pickup radius**. Upgrades apply to the next run and are permanent.

Collected gold, upgrades, and records save automatically in this browser's local storage. Use the same browser and file location to continue your progress. Private browsing or clearing browser data can remove the save. If saving is blocked, the game displays a warning rather than pretending progress was saved.

Sound and fullscreen can be toggled in the interface. Nothing is sent to a server.

## Development

`game-core.js` contains the simulation and upgrade rules. `game.js` handles rendering, controls, menus, audio, and browser saves.

With Node.js installed, run `npm test` to exercise the simulation and upgrade rules. No installation is needed.
