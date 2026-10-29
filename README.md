# Purpose Green 🌱

Two browser games built with three.js. Both are static files with no build step, and three.js is vendored in `vendor/`.

## 🌍 World (`index.html`), an endless city builder
Explore a procedurally generated world with no edges: plains, forests, rivers, lakes, seas and snowy mountains stream in as you move. Build a working city and keep its citizens alive.

**Infrastructure that really works**
- Roads carry power and water. A building only works if it touches a road network that has enough supply.
- Power: coal (always on, dirty), solar (sun and weather dependent), wind (wind dependent, shuts down in storms). Brownouts happen when demand beats supply, for example on winter nights.
- Water: pumps must touch water, towers work anywhere. Pumps need power.
- Food from farms, goods from factories, garbage to landfills. Shortages can be covered by imports, which cost money.

**Citizens who live there**
- Every citizen has a name, age, home, job, education, health and happiness.
- They move in when homes have power and water, take jobs on their road network, commute in cars and walk the sidewalks.
- They grow up, go to school, get educated for office jobs, have babies, get sick, retire and pass away. They move out if they're unhappy.
- Click any car, pedestrian or building to see who they are and what they need, or follow them with the camera.

**Real-life effects**
- Day and night, four seasons (winter heating, weak harvests, snow), rain, storms with lightning, and wind.
- Pollution from industry and traffic hurts health. Trees and parks clean the air.
- Fires break out and burn buildings down without a fire station. Crime rises without police.
- Schools, hospitals and shops only help homes within their radius.
- Budget: taxes on wages, businesses and property, minus upkeep and imports. The tax rate affects happiness.
- City needs panel with live alerts plus homes/shops/industry demand bars.

**Controls**: drag to pan, right-drag or `Q`/`E` to rotate, scroll to zoom, `WASD` to pan, `R` to rotate a building, `F` to walk around in first person, `Space` to pause, `H` to hide the UI, `1`–`9` for tools.

The world autosaves in your browser. Each world has a seed, so you can share good ones.

## 🏝️ Island Lab (`island.html`)
A small sandbox: build a floating eco-island and experiment with the sun, wind, rain and storms.

## Run locally
```bash
python3 -m http.server 8000
```
Or enable GitHub Pages (Settings → Pages → `main` / root).
