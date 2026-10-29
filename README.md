# Purpose Green — Island Lab 🌱

A 3D sandbox game in the browser. Build a floating eco-island, then experiment with sun, wind, rain and storms and watch what happens to your energy, CO₂ and eco score.

**Play:** open `index.html` through any static server, or turn on GitHub Pages (Settings → Pages → `main` / root).

## How to play
- Pick a tool in the hotbar (`1`–`0`, `X`) and click the island to place it. `R` rotates.
- Drag to orbit, scroll to zoom, `H` for photo mode, `N` to flip between day and night.
- Powered homes earn coins. Spend them on trees, solar panels, wind turbines, ponds… or a dirty coal plant.
- Complete the 10 missions, from "Plant 5 trees" to "Reach eco score 90 🏆".

## Experiment Lab
| Control | What it does |
|---|---|
| Time of day / Day cycle | Moves the sun. Solar output follows it; windows and turbine beacons light up at night |
| Wind speed | Turbines spin faster and make more power; trees sway, clouds and smoke drift |
| Rain | Wet grass and less solar output |
| Storm | Dark skies, stronger wind, and lightning that can strike your trees |
| Growth speed | How fast new things grow in |
| Seed bomb | Throw seeds; a random plant grows where they land |

Pollution is visible: coal smoke rises, the grass browns and the sky turns hazy as CO₂ goes up.

Your island is saved in the browser. In the dev console, `island` exposes the game state (for example `island.lightning()`).

Built with three.js (vendored in `vendor/`, no build step).

```bash
python3 -m http.server 8000
```
