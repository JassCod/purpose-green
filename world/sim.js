// City simulation: buildings, utility networks, citizens, economy and real-life effects.
// Pure game logic; rendering hooks are supplied by main.js through `hooks`.

import { tkey } from './terrain.js';

/* ------------------------------------------------------------------ */
/*  Building catalog                                                   */
/* ------------------------------------------------------------------ */
export const CATS = [
  { id: 'roads', name: 'Roads', icon: '🛣️' },
  { id: 'homes', name: 'Housing', icon: '🏠' },
  { id: 'work', name: 'Jobs', icon: '🏭' },
  { id: 'power', name: 'Power', icon: '⚡' },
  { id: 'water', name: 'Water', icon: '💧' },
  { id: 'services', name: 'Services', icon: '🏥' },
  { id: 'nature', name: 'Nature', icon: '🌳' },
];

export const DEFS = {
  road:      { cat: 'roads', name: 'Road', icon: '🛣️', size: 1, cost: 20, upkeep: 0.5, desc: 'Connects buildings. Power and water travel along roads.' },
  house:     { cat: 'homes', name: 'House', icon: '🏠', size: 1, cost: 300, homes: 4, power: 1, water: 1, desc: 'Home for 4 people. Needs power and water.' },
  apartment: { cat: 'homes', name: 'Apartments', icon: '🏢', size: 2, cost: 2400, homes: 32, power: 7, water: 7, desc: 'Dense housing for 32 people.' },
  farm:      { cat: 'work', name: 'Farm', icon: '🌾', size: 2, cost: 900, jobs: 6, wage: 35, power: 1, water: 4, food: 70, profit: 120, desc: 'Grows food (70/day). Weak in winter.' },
  shop:      { cat: 'work', name: 'Shop', icon: '🛒', size: 1, cost: 700, jobs: 5, wage: 35, power: 2, water: 1, goodsUse: 14, profit: 160, radius: 14, desc: 'Sells goods to nearby residents.' },
  office:    { cat: 'work', name: 'Office', icon: '🏬', size: 1, cost: 1600, jobs: 14, wage: 90, power: 4, water: 1, profit: 260, educated: true, desc: 'High-paying jobs for educated citizens.' },
  factory:   { cat: 'work', name: 'Factory', icon: '🏭', size: 2, cost: 2600, jobs: 24, wage: 55, power: 10, water: 5, goods: 90, profit: 300, poll: 7, fireRisk: 2, desc: 'Makes goods (90/day). Pollutes.' },
  coal:      { cat: 'power', name: 'Coal plant', icon: '🏭', size: 2, cost: 6000, upkeep: 150, jobs: 10, wage: 60, powerOut: 100, poll: 11, fireRisk: 2, desc: '100 MW day and night. Very dirty.' },
  solar:     { cat: 'power', name: 'Solar farm', icon: '☀️', size: 2, cost: 5200, upkeep: 50, jobs: 2, wage: 60, powerOut: 40, solar: true, desc: 'Up to 40 MW in full sun. Nothing at night.' },
  wind:      { cat: 'power', name: 'Wind turbine', icon: '🌬️', size: 1, cost: 1900, upkeep: 30, powerOut: 16, windy: true, desc: 'Up to 16 MW depending on wind.' },
  pump:      { cat: 'water', name: 'Water pump', icon: '🚰', size: 1, cost: 1500, upkeep: 60, jobs: 3, wage: 50, power: 3, waterOut: 140, nearWater: true, desc: '140 water units. Must touch a lake, river or sea.' },
  tower:     { cat: 'water', name: 'Water tower', icon: '🗼', size: 1, cost: 900, upkeep: 30, jobs: 1, wage: 50, power: 1, waterOut: 35, desc: 'Groundwater well (35 units). Works anywhere.' },
  landfill:  { cat: 'services', name: 'Landfill', icon: '🗑️', size: 2, cost: 2000, upkeep: 50, jobs: 4, wage: 45, power: 1, capacity: 8000, poll: 3, desc: 'Collects garbage until full.' },
  school:    { cat: 'services', name: 'School', icon: '🏫', size: 2, cost: 4000, upkeep: 140, jobs: 10, wage: 70, power: 4, water: 2, radius: 22, students: 160, desc: 'Educates children within reach → office workers.' },
  hospital:  { cat: 'services', name: 'Hospital', icon: '🏥', size: 2, cost: 6000, upkeep: 220, jobs: 18, wage: 90, power: 7, water: 5, radius: 26, desc: 'Heals the sick, improves health.' },
  police:    { cat: 'services', name: 'Police', icon: '🚓', size: 1, cost: 2000, upkeep: 90, jobs: 8, wage: 60, power: 2, water: 1, radius: 18, desc: 'Reduces crime nearby.' },
  fire:      { cat: 'services', name: 'Fire station', icon: '🚒', size: 1, cost: 2000, upkeep: 90, jobs: 8, wage: 60, power: 2, water: 2, radius: 18, desc: 'Puts out fires before buildings burn down.' },
  park:      { cat: 'nature', name: 'Park', icon: '⛲', size: 1, cost: 250, upkeep: 5, radius: 8, poll: -3, desc: 'Happier, cleaner neighbourhood.' },
};
export const TOOLS = {
  inspect: { cat: null, name: 'Inspect', icon: '🔍', desc: 'Click buildings or people to see what they need.' },
  bulldoze: { cat: null, name: 'Bulldoze', icon: '🚜', cost: 0, desc: 'Remove roads, buildings or trees. Refunds 25%.' },
  tree: { cat: 'nature', name: 'Plant tree', icon: '🌳', cost: 15, desc: 'Absorbs pollution around it.' },
};
export const ALL_TOOLS = { ...DEFS, ...TOOLS };
const WAGE_SCALE = 2.5; // daily wages are taxed as income

const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Zara', 'Arjun', 'Lena', 'Omar', 'Yuki', 'Ivan', 'Priya', 'Leo', 'Sofia', 'Kai', 'Amara', 'Diego', 'Nora', 'Ravi', 'Elif', 'Tomas', 'Hana', 'Jas', 'Simran', 'Mateo', 'Chloe', 'Ibrahim', 'Freya', 'Kwame', 'Mei', 'Oscar', 'Isla', 'Aman', 'Gita', 'Felix', 'Noor', 'Theo', 'Asha', 'Luca', 'Maya', 'Emil'];
const LAST = ['Green', 'Singh', 'Rivera', 'Chen', 'Okafor', 'Novak', 'Haddad', 'Kumar', 'Silva', 'Berg', 'Tanaka', 'Moreau', 'Kaur', 'Ali', 'Jensen', 'Costa', 'Patel', 'Nakamura', 'Fischer', 'Mensah', 'Rossi', 'Ivanova', 'Lopez', 'Gill', 'Brooks'];

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
export const G = {
  seed: 1,
  money: 60000,
  t: 7,               // game hours since start (day 1, 07:00)
  speed: 1,
  tax: 10,
  imports: true,
  nextId: 1,
  buildings: new Map(),
  tiles: new Map(),   // tile key -> { road: true } | { b: id }
  roadCount: 0,
  citizens: new Map(),
  food: 300,
  goods: 150,
  streetGarbage: 0,
  weather: { kind: 'sun', wind: 0.5, until: 12 },
  history: [],
  pollution: new Map(),
  netDirty: true,
  immAcc: 0,
  ledger: { income: 0, upkeep: 0, imports: 0, taxes: 0 },
  lastDay: null,
  stats: {},
  alerts: [],
};

export const hooks = {
  onAdd: () => {}, onRemove: () => {}, onRoads: () => {}, onEvent: () => {}, onFire: () => {},
};

let terrain = null;
export function bindTerrain(t) { terrain = t; }

const rnd = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const day = () => Math.floor(G.t / 24) + 1;
export const hourOfDay = () => G.t % 24;
export const SEASONS = [
  { name: 'Spring', icon: '🌸', farm: 1.0, solar: 1.0, heat: 1.05, cool: 1.0, water: 1.0 },
  { name: 'Summer', icon: '☀️', farm: 1.25, solar: 1.2, heat: 1.0, cool: 1.15, water: 1.3 },
  { name: 'Autumn', icon: '🍂', farm: 0.9, solar: 0.85, heat: 1.1, cool: 1.0, water: 1.0 },
  { name: 'Winter', icon: '❄️', farm: 0.3, solar: 0.55, heat: 1.45, cool: 1.0, water: 0.9 },
];
export const DAYS_PER_SEASON = 6;
export const season = () => SEASONS[Math.floor((day() - 1) / DAYS_PER_SEASON) % 4];
export const sunFactor = () => Math.max(0, Math.sin(((hourOfDay() - 6) / 12) * Math.PI));
export const cloudFactor = () => ({ sun: 1, cloudy: 0.55, rain: 0.35, storm: 0.2, snow: 0.3 })[G.weather.kind];

/* ------------------------------------------------------------------ */
/*  Tiles & placement                                                  */
/* ------------------------------------------------------------------ */
export const isRoad = (i, j) => G.tiles.get(tkey(i, j))?.road === true;
export const tileAt = (i, j) => G.tiles.get(tkey(i, j));
export const buildingAt = (i, j) => { const t = tileAt(i, j); return t && t.b ? G.buildings.get(t.b) : null; };

function footprint(i, j, size) {
  const out = [];
  for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) out.push([i + a, j + b]);
  return out;
}

export function canPlace(type, i, j) {
  const d = ALL_TOOLS[type];
  if (d.cost && G.money < d.cost) return { ok: false, reason: 'Not enough money' };
  if (type === 'tree') {
    if (tileAt(i, j) || terrain.isWater(i, j)) return { ok: false, reason: 'Tile is not free' };
    if (terrain.hasTree(i, j)) return { ok: false, reason: 'Already a tree here' };
    return { ok: true };
  }
  const size = d.size;
  for (const [a, b] of footprint(i, j, size)) {
    if (tileAt(a, b)) return { ok: false, reason: 'Something is already built here' };
    const s = terrain.tileStats(a, b);
    if (s.avg < 0.15 || s.min < -0.05) return { ok: false, reason: "Can't build on water" };
    if (s.max - s.min > (type === 'road' ? 1.5 : 1.25)) return { ok: false, reason: 'Too steep' };
  }
  if (d.nearWater) {
    let near = false;
    for (let a = i - 1; a <= i + size && !near; a++) for (let b = j - 1; b <= j + size && !near; b++) if (terrain.isWater(a, b)) near = true;
    if (!near) return { ok: false, reason: 'Must be next to water' };
  }
  return { ok: true };
}

export function placeRoad(i, j) {
  if (!canPlace('road', i, j).ok) return false;
  G.money -= DEFS.road.cost;
  G.tiles.set(tkey(i, j), { road: true });
  G.roadCount++;
  terrain.cleared.add(tkey(i, j));
  G.netDirty = true;
  pathCache.clear();
  terrain.markDirty(i - 1, j - 1, i + 1, j + 1);
  return true;
}

export function placeBuilding(type, i, j, rot = 0, opts = {}) {
  const d = DEFS[type];
  if (!opts.free) {
    const chk = canPlace(type, i, j);
    if (!chk.ok) return null;
    G.money -= d.cost;
  }
  const level = terrain.flatten(i, j, d.size);
  const b = {
    id: opts.id || G.nextId++, type, i, j, size: d.size, rot, variant: opts.variant ?? Math.floor(rnd() * 8),
    level, progress: opts.progress ?? 0, residents: new Set(), workers: new Set(),
    comp: null, powered: false, watered: false, working: false, staff: 0, eff: 0,
    fire: opts.fire || 0, cov: {}, issues: [], fill: opts.fill || 0,
  };
  G.nextId = Math.max(G.nextId, b.id + 1);
  for (const [a, c] of footprint(i, j, d.size)) {
    G.tiles.set(tkey(a, c), { b: b.id });
    terrain.cleared.add(tkey(a, c));
    terrain.planted.delete(tkey(a, c));
  }
  G.buildings.set(b.id, b);
  G.netDirty = true;
  hooks.onAdd(b);
  return b;
}

export function plantTree(i, j) {
  if (!canPlace('tree', i, j).ok) return false;
  G.money -= TOOLS.tree.cost;
  terrain.planted.add(tkey(i, j));
  terrain.markDirty(i, j, i, j);
  return true;
}

export function removeBuilding(b, reason = 'bulldozed') {
  for (const [a, c] of footprint(b.i, b.j, b.size)) G.tiles.delete(tkey(a, c));
  for (const id of b.residents) { const c = G.citizens.get(id); if (c) c.home = null; }
  for (const id of b.workers) { const c = G.citizens.get(id); if (c) c.job = null; }
  G.buildings.delete(b.id);
  G.netDirty = true;
  hooks.onRemove(b, reason);
}

export function bulldoze(i, j) {
  const t = tileAt(i, j);
  if (t?.road) {
    G.tiles.delete(tkey(i, j));
    G.roadCount--;
    G.money += DEFS.road.cost * 0.25;
    G.netDirty = true;
    pathCache.clear();
    terrain.markDirty(i - 1, j - 1, i + 1, j + 1);
    return 'road';
  }
  if (t?.b) {
    const b = G.buildings.get(t.b);
    G.money += DEFS[b.type].cost * 0.25 * b.progress;
    removeBuilding(b);
    return 'building';
  }
  if (terrain.hasTree(i, j)) {
    terrain.planted.delete(tkey(i, j));
    terrain.cleared.add(tkey(i, j));
    terrain.markDirty(i, j, i, j);
    return 'tree';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Road networks & pathfinding                                        */
/* ------------------------------------------------------------------ */
const roadComp = new Map();
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function adjacentRoads(b) {
  const out = [];
  for (let a = b.i - 1; a <= b.i + b.size; a++) {
    for (let c = b.j - 1; c <= b.j + b.size; c++) {
      const edge = (a === b.i - 1 || a === b.i + b.size) !== (c === b.j - 1 || c === b.j + b.size);
      if (edge && isRoad(a, c)) out.push([a, c]);
    }
  }
  return out;
}

function rebuildNetworks() {
  roadComp.clear();
  let comp = 0;
  for (const [k, t] of G.tiles) {
    if (!t.road || roadComp.has(k)) continue;
    comp++;
    const stack = [k];
    roadComp.set(k, comp);
    while (stack.length) {
      const [i, j] = stack.pop().split(',').map(Number);
      for (const [di, dj] of N4) {
        const nk = tkey(i + di, j + dj);
        if (!roadComp.has(nk) && G.tiles.get(nk)?.road) { roadComp.set(nk, comp); stack.push(nk); }
      }
    }
  }
  for (const b of G.buildings.values()) {
    const adj = adjacentRoads(b);
    b.comp = adj.length ? roadComp.get(tkey(adj[0][0], adj[0][1])) : null;
    b.road = adj.length ? adj[0] : null;
  }
  G.netDirty = false;
}

export const pathCache = new Map();
/** BFS over road tiles; returns array of [i, j] or null. */
export function findPath(from, to, maxNodes = 6000) {
  const fk = tkey(from[0], from[1]), tk = tkey(to[0], to[1]);
  const ck = fk + '>' + tk;
  if (pathCache.has(ck)) return pathCache.get(ck);
  if (fk === tk) return [from];
  const prev = new Map([[fk, null]]);
  const q = [from];
  let head = 0, found = false;
  while (head < q.length && head < maxNodes) {
    const [i, j] = q[head++];
    for (const [di, dj] of N4) {
      const ni = i + di, nj = j + dj, nk = tkey(ni, nj);
      if (prev.has(nk) || !isRoad(ni, nj)) continue;
      prev.set(nk, tkey(i, j));
      if (nk === tk) { found = true; break; }
      q.push([ni, nj]);
    }
    if (found) break;
  }
  let path = null;
  if (found) {
    path = [];
    for (let k = tk; k; k = prev.get(k)) path.push(k.split(',').map(Number));
    path.reverse();
  }
  if (pathCache.size > 800) pathCache.clear();
  pathCache.set(ck, path);
  return path;
}

/* ------------------------------------------------------------------ */
/*  Citizens                                                           */
/* ------------------------------------------------------------------ */
function makeCitizen(home, age) {
  const c = {
    id: G.nextId++,
    name: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`,
    age, home: home.id, job: null,
    edu: age >= 18 ? (rnd() < 0.45 ? 12 : Math.floor(rnd() * 9)) : 0,
    health: 80 + rnd() * 20, happy: 65, sad: 0, sick: false, born: day(),
  };
  G.citizens.set(c.id, c);
  home.residents.add(c.id);
  return c;
}
function removeCitizen(c) {
  const h = G.buildings.get(c.home); if (h) h.residents.delete(c.id);
  const j = G.buildings.get(c.job); if (j) j.workers.delete(c.id);
  G.citizens.delete(c.id);
}
export const isAdult = (c) => c.age >= 18 && c.age < 66;

/* ------------------------------------------------------------------ */
/*  Pollution field (cells of 6×6 tiles)                               */
/* ------------------------------------------------------------------ */
const CELL = 6;
export function pollutionAt(i, j) { return G.pollution.get(tkey(Math.floor(i / CELL), Math.floor(j / CELL))) || 0; }
function rebuildPollution() {
  const field = new Map();
  const add = (ci, cj, v) => { const k = tkey(ci, cj); field.set(k, (field.get(k) || 0) + v); };
  for (const b of G.buildings.values()) {
    const p = DEFS[b.type].poll;
    if (!p || b.progress < 1) continue;
    const v = p > 0 ? p * Math.max(0.15, b.eff) : p;
    const ci = Math.floor(b.i / CELL), cj = Math.floor(b.j / CELL);
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
      const d = Math.hypot(a, c);
      if (d <= 2.3) add(ci + a, cj + c, v / (1 + d * d));
    }
  }
  for (const k of terrain.planted) {
    const [i, j] = k.split(',').map(Number);
    add(Math.floor(i / CELL), Math.floor(j / CELL), -0.25);
  }
  // traffic: every road contributes a little
  for (const [k, t] of G.tiles) {
    if (!t.road) continue;
    const [i, j] = k.split(',').map(Number);
    add(Math.floor(i / CELL), Math.floor(j / CELL), 0.04);
  }
  for (const [k, v] of field) field.set(k, Math.max(0, v));
  G.pollution = field;
}

/* ------------------------------------------------------------------ */
/*  Time                                                               */
/* ------------------------------------------------------------------ */
export function advance(hours) {
  const before = G.t;
  G.t += hours;
  // construction progresses continuously
  for (const b of G.buildings.values()) {
    if (b.progress < 1) {
      b.progress = Math.min(1, b.progress + hours / (b.size === 2 ? 5 : 2.5));
      if (b.progress >= 1) G.netDirty = true;
    }
  }
  const h0 = Math.floor(before), h1 = Math.floor(G.t);
  for (let h = h0 + 1; h <= h1; h++) {
    hourly(h);
    if (h % 24 === 0) daily();
  }
}

function serviceList(type) {
  return [...G.buildings.values()].filter((b) => b.type === type && b.working);
}
function covered(b, list, radius) {
  const cx = b.i + b.size / 2, cz = b.j + b.size / 2;
  for (const s of list) {
    const d = Math.hypot(s.i + s.size / 2 - cx, s.j + s.size / 2 - cz);
    if (d <= radius) return s;
  }
  return null;
}

function hourly(hAbs) {
  if (G.netDirty) rebuildNetworks();
  updateWeather();
  const se = season();
  const hour = hAbs % 24;
  const sun = sunFactor() * cloudFactor() * se.solar;
  const windK = G.weather.wind;
  const bl = [...G.buildings.values()];

  /* ---- utilities per road network ---- */
  const nets = new Map();
  const net = (id) => { if (!nets.has(id)) nets.set(id, { pSup: 0, pDem: 0, wSup: 0, wDem: 0 }); return nets.get(id); };
  for (const b of bl) {
    const d = DEFS[b.type];
    b.staff = d.jobs ? b.workers.size / d.jobs : 1;
    b.powered = false; b.watered = false;
    if (b.progress < 1 || b.comp == null || b.fire) continue;
    const n = net(b.comp);
    if (d.powerOut) {
      const crew = d.jobs ? 0.5 + 0.5 * b.staff : 1;
      let out = d.powerOut * crew;
      if (d.solar) out *= sun;
      if (d.windy) out *= Math.min(1, Math.pow(windK, 1.4) * 1.3) * (G.weather.kind === 'storm' && windK > 0.95 ? 0.2 : 1);
      b.output = out;
      n.pSup += out;
    }
    if (d.power) {
      const home = d.homes ? 1 : 0;
      b.pNeed = d.power * (home ? (hour >= 18 || hour < 7 ? 1.25 : 0.8) * se.heat * se.cool : (hour >= 8 && hour < 18 ? 1.2 : 0.6));
      n.pDem += b.pNeed;
    }
  }
  // allocate power (brownouts hit the newest buildings first)
  const order = bl.filter((b) => b.progress >= 1 && b.comp != null && !b.fire).sort((a, b) => a.id - b.id);
  const pLeft = new Map([...nets].map(([k, n]) => [k, n.pSup]));
  for (const b of order) {
    const d = DEFS[b.type];
    if (!d.power) { b.powered = true; continue; }
    const left = pLeft.get(b.comp);
    if (left >= b.pNeed - 1e-6) { b.powered = true; pLeft.set(b.comp, left - b.pNeed); }
  }
  for (const b of order) {
    const d = DEFS[b.type];
    if (d.waterOut && b.powered) {
      b.output = d.waterOut * (d.jobs ? 0.4 + 0.6 * b.staff : 1);
      net(b.comp).wSup += b.output;
    }
    if (d.water) { b.wNeed = d.water * se.water; net(b.comp).wDem += b.wNeed; }
  }
  const wLeft = new Map([...nets].map(([k, n]) => [k, n.wSup]));
  for (const b of order) {
    const d = DEFS[b.type];
    if (!d.water) { b.watered = true; continue; }
    const left = wLeft.get(b.comp);
    if (left >= b.wNeed - 1e-6) { b.watered = true; wLeft.set(b.comp, left - b.wNeed); }
  }
  for (const b of bl) {
    const d = DEFS[b.type];
    b.working = b.progress >= 1 && b.comp != null && !b.fire && (!d.power || b.powered) && (!d.water || b.watered);
    b.eff = b.working ? (d.jobs && !d.powerOut && !d.waterOut ? b.staff : 1) : 0;
  }

  /* ---- service coverage ---- */
  const svc = {};
  for (const t of ['school', 'hospital', 'police', 'fire', 'park', 'shop']) svc[t] = serviceList(t);
  for (const b of bl) {
    b.cov = {};
    for (const t of ['police', 'fire']) b.cov[t] = !!covered(b, svc[t], DEFS[t].radius);
    if (DEFS[b.type].homes) for (const t of ['school', 'hospital', 'park', 'shop']) b.cov[t] = !!covered(b, svc[t], DEFS[t].radius);
  }

  /* ---- production & consumption ---- */
  const pop = G.citizens.size;
  let foodMade = 0, goodsMade = 0, goodsNeed = 0;
  for (const b of bl) {
    const d = DEFS[b.type];
    if (d.food) foodMade += (d.food / 24) * b.eff * se.farm;
    if (d.goods) goodsMade += (d.goods / 24) * b.eff;
    if (d.goodsUse && b.working) goodsNeed += (d.goodsUse / 24) * Math.max(0.3, b.staff);
  }
  G.food += foodMade - pop / 24;
  G.goods += goodsMade - goodsNeed;
  G.hungry = false;
  G.shopsStarved = false;
  if (G.food < 0) {
    if (G.imports) { const cost = -G.food * 3; G.money -= cost; G.ledger.imports += cost; G.food = 0; }
    else { G.food = 0; G.hungry = pop > 0; }
  }
  if (G.goods < 0) {
    if (G.imports) { const cost = -G.goods * 4; G.money -= cost; G.ledger.imports += cost; G.goods = 0; }
    else { G.goods = 0; G.shopsStarved = true; }
  }
  G.foodRate = (foodMade - pop / 24) * 24;
  G.goodsRate = (goodsMade - goodsNeed) * 24;

  // garbage
  let trash = pop * 0.6 / 24;
  for (const b of bl) if (DEFS[b.type].jobs && b.working) trash += 1.5 / 24;
  const fills = bl.filter((b) => b.type === 'landfill' && b.working && b.fill < DEFS.landfill.capacity);
  let collectCap = fills.length * 40;
  if (fills.length) {
    const share = (trash + Math.min(G.streetGarbage, collectCap)) / fills.length;
    G.streetGarbage = Math.max(0, G.streetGarbage - collectCap);
    for (const f of fills) f.fill = Math.min(DEFS.landfill.capacity, f.fill + share);
  } else G.streetGarbage += trash;
  const garbageBad = G.streetGarbage > Math.max(20, pop * 0.4);

  if (hAbs % 3 === 0) rebuildPollution();

  /* ---- jobs ---- */
  const openings = new Map(); // comp -> list of workplaces with vacancies
  for (const b of bl) {
    const d = DEFS[b.type];
    if (!d.jobs || b.progress < 1 || b.comp == null) continue;
    if (b.workers.size < d.jobs) { if (!openings.has(b.comp)) openings.set(b.comp, []); openings.get(b.comp).push(b); }
  }
  let assigned = 0;
  for (const c of G.citizens.values()) {
    if (c.job != null) {
      if (!isAdult(c) || !G.buildings.has(c.job)) { const j = G.buildings.get(c.job); if (j) j.workers.delete(c.id); c.job = null; }
      continue;
    }
    if (!isAdult(c) || c.home == null || assigned > 300) continue;
    const home = G.buildings.get(c.home);
    const list = home && openings.get(home.comp);
    if (!list || !list.length) continue;
    let best = null, bd = Infinity;
    for (const w of list) {
      if (DEFS[w.type].educated && c.edu < 10) continue;
      const dd = Math.abs(w.i - home.i) + Math.abs(w.j - home.j);
      if (dd < bd) { bd = dd; best = w; }
    }
    if (!best) continue;
    best.workers.add(c.id);
    c.job = best.id;
    assigned++;
    if (best.workers.size >= DEFS[best.type].jobs) list.splice(list.indexOf(best), 1);
  }

  /* ---- citizens' needs ---- */
  const leaving = [];
  for (const c of G.citizens.values()) {
    let home = G.buildings.get(c.home);
    if (!home) {
      home = findVacancy();
      if (home) { c.home = home.id; home.residents.add(c.id); }
      else { leaving.push(c); continue; }
    }
    const adult = isAdult(c), child = c.age < 18;
    const p = pollutionAt(home.i, home.j);
    const job = c.job != null ? G.buildings.get(c.job) : null;
    let target = 52;
    target += home.powered ? 4 : -22;
    target += home.watered ? 4 : -30;
    target += G.hungry ? -35 : 0;
    if (adult) target += job ? (job.working ? 8 : 2) : -16;
    if (child && c.age >= 6) target += home.cov.school ? 4 : -8;
    target += home.cov.hospital ? 6 : -6;
    target += home.cov.police ? 4 : -9;
    target += home.cov.fire ? 3 : -4;
    target += home.cov.shop && !G.shopsStarved ? 6 : -7;
    target += home.cov.park ? 7 : 0;
    target -= Math.min(30, p * 2.2);
    target -= garbageBad ? 12 : 0;
    target -= (G.tax - 10) * 1.6;
    target -= c.sick ? 10 : 0;
    target -= G.weather.kind === 'storm' ? 3 : 0;
    c.happy += (clamp(target, 0, 100) - c.happy) * 0.12;

    let hTarget = 86 + (home.cov.hospital ? 10 : 0) - Math.min(40, p * 2.5) - (home.watered ? 0 : 45) - (G.hungry ? 35 : 0) - (garbageBad ? 10 : 0) - (c.age > 65 ? (c.age - 65) * 1.2 : 0);
    c.health += (clamp(hTarget, 0, 100) - c.health) * 0.04;
    if (!c.sick && rnd() < 0.0015 + p * 0.0008 + (home.watered ? 0 : 0.01) + (garbageBad ? 0.003 : 0) + (se.name === 'Winter' ? 0.001 : 0)) c.sick = true;
    if (c.sick) {
      c.health -= home.cov.hospital ? 0.2 : 1.2;
      if (rnd() < (home.cov.hospital ? 0.12 : 0.02)) c.sick = false;
    }
    if (c.happy < 22) c.sad += 1 / 24; else c.sad = Math.max(0, c.sad - 1 / 48);
    if (c.sad > 2.5) leaving.push(c);
  }
  if (leaving.length) {
    for (const c of leaving) removeCitizen(c);
    if (leaving.length >= 3) hooks.onEvent(`🧳 ${leaving.length} people moved away`, 'bad');
  }

  /* ---- immigration ---- */
  const stats = computeStats();
  const vacancies = [];
  for (const b of bl) {
    const d = DEFS[b.type];
    if (d.homes && b.working && b.residents.size < d.homes) vacancies.push(b);
  }
  if (vacancies.length && hour >= 6 && hour <= 21) {
    const appeal = stats.happy;
    let rate = stats.pop < 40 ? 2.5 : clamp((stats.jobsOpen - stats.unemployed) / 5, 0, 8);
    if (stats.pop >= 40 && stats.jobsOpen <= stats.unemployed) rate = 0.25;
    rate *= appeal > 55 ? 1.2 : appeal > 40 ? 0.7 : 0.15;
    G.immAcc += rate;
    let arrived = 0;
    while (G.immAcc >= 1 && vacancies.length) {
      G.immAcc -= 1;
      const h = vacancies[Math.floor(rnd() * vacancies.length)];
      const free = DEFS[h.type].homes - h.residents.size;
      const family = Math.min(free, 1 + Math.floor(rnd() * 3));
      for (let k = 0; k < family; k++) makeCitizen(h, k < 2 ? 18 + Math.floor(rnd() * 30) : Math.floor(rnd() * 14));
      arrived += family;
      if (h.residents.size >= DEFS[h.type].homes) vacancies.splice(vacancies.indexOf(h), 1);
    }
    G.immAcc = Math.min(G.immAcc, 10);
    if (arrived >= 4) hooks.onEvent(`🚚 ${arrived} new residents moved in`, 'good');
  }

  /* ---- fires ---- */
  for (const b of bl) {
    if (b.progress < 1) continue;
    if (b.fire) {
      b.fire += 1;
      if (b.cov.fire && b.fire >= 3) { b.fire = 0; hooks.onEvent(`🚒 Firefighters saved a ${DEFS[b.type].name.toLowerCase()}`, 'good'); hooks.onFire(b, false); }
      else if (b.fire >= 7) { hooks.onEvent(`🔥 A ${DEFS[b.type].name.toLowerCase()} burned down!`, 'bad'); removeBuilding(b, 'fire'); }
      continue;
    }
    if (b.type === 'park' || b.type === 'fire') continue;
    const risk = 0.00025 * (DEFS[b.type].fireRisk || 1) * (b.cov.fire ? 0.3 : 1) * (se.name === 'Summer' ? 1.7 : 1) * (G.weather.kind === 'storm' ? 2 : 1);
    if (rnd() < risk) { b.fire = 1; hooks.onEvent(`🔥 Fire at a ${DEFS[b.type].name.toLowerCase()}!${b.cov.fire ? '' : ' No fire station nearby!'}`, 'bad'); hooks.onFire(b, true); }
  }

  // crime
  if (stats.pop > 30 && rnd() < 0.04 * (1 - stats.cov.police)) hooks.onEvent('🦹 A burglary was reported — more police coverage needed', 'bad');

  G.stats = computeStats();
  G.alerts = computeAlerts();
  for (const b of bl) b.issues = issuesOf(b);
}

function findVacancy() {
  for (const b of G.buildings.values()) if (DEFS[b.type].homes && b.working && b.residents.size < DEFS[b.type].homes) return b;
  return null;
}

function daily() {
  /* ---- ageing, school, births, deaths ---- */
  const deaths = [];
  const births = [];
  for (const c of G.citizens.values()) {
    c.age += 1;
    const home = G.buildings.get(c.home);
    if (c.age >= 6 && c.age < 18 && home?.cov.school) c.edu = Math.min(12, c.edu + 1);
    if (c.age === 66 && c.job != null) { const j = G.buildings.get(c.job); if (j) j.workers.delete(c.id); c.job = null; }
    let pDie = c.age > 62 ? (c.age - 62) * 0.012 : 0.0005;
    if (c.health < 15) pDie += 0.25;
    if (rnd() < pDie) deaths.push(c);
  }
  for (const b of G.buildings.values()) {
    const d = DEFS[b.type];
    if (!d.homes || !b.working || b.residents.size >= d.homes) continue;
    const parents = [...b.residents].map((id) => G.citizens.get(id)).filter((c) => c && c.age >= 20 && c.age <= 42);
    if (parents.length >= 2 && rnd() < 0.14 * (parents[0].happy / 100) * 2) births.push(b);
  }
  for (const c of deaths) removeCitizen(c);
  for (const b of births) makeCitizen(b, 0);
  if (deaths.length) hooks.onEvent(`🕊️ ${deaths.length} ${deaths.length === 1 ? 'citizen' : 'citizens'} passed away`, '');
  if (births.length) hooks.onEvent(`👶 ${births.length} ${births.length === 1 ? 'baby was' : 'babies were'} born`, 'good');

  /* ---- budget ---- */
  let taxes = 0, upkeep = 0;
  for (const c of G.citizens.values()) {
    const j = c.job != null ? G.buildings.get(c.job) : null;
    if (j && j.working) taxes += DEFS[j.type].wage * WAGE_SCALE * (G.tax / 100);
  }
  for (const b of G.buildings.values()) {
    const d = DEFS[b.type];
    if (d.profit) taxes += d.profit * b.eff * (G.tax / 100) * (b.type === 'shop' && G.shopsStarved ? 0.3 : 1);
    if (d.homes) taxes += b.residents.size * 5 * (G.tax / 100); // property tax
    upkeep += d.upkeep || 0;
  }
  upkeep += G.roadCount * DEFS.road.upkeep;
  G.money += taxes - upkeep;
  G.lastDay = { taxes, upkeep, imports: G.ledger.imports, net: taxes - upkeep - G.ledger.imports };
  G.ledger.imports = 0;
  const s = computeStats();
  G.history.push({ day: day(), pop: s.pop, money: Math.round(G.money), happy: Math.round(s.happy) });
  if (G.history.length > 120) G.history.shift();
  hooks.onEvent(`📅 Day ${day()} · ${season().icon} ${season().name} · budget ${G.lastDay.net >= 0 ? '+' : '−'}$${Math.abs(Math.round(G.lastDay.net)).toLocaleString()}`, G.lastDay.net >= 0 ? '' : 'bad');
  if (day() % DAYS_PER_SEASON === 1 && day() > 1) hooks.onEvent(`${season().icon} ${season().name} has arrived`, '');
}

function updateWeather() {
  if (G.t < G.weather.until) return;
  const winter = season().name === 'Winter';
  const r = rnd();
  const kind = r < 0.45 ? 'sun' : r < 0.7 ? 'cloudy' : r < 0.93 ? (winter ? 'snow' : 'rain') : 'storm';
  const wind = kind === 'storm' ? 0.85 + rnd() * 0.15 : 0.1 + rnd() * 0.7;
  G.weather = { kind, wind, until: G.t + 4 + rnd() * 10 };
  if (kind === 'storm') hooks.onEvent('⛈️ A storm is rolling in — fire risk up, wind turbines may shut down', 'bad');
}

/* ------------------------------------------------------------------ */
/*  Stats, alerts, per-building issues                                 */
/* ------------------------------------------------------------------ */
export function computeStats() {
  const s = { pop: 0, adults: 0, kids: 0, seniors: 0, employed: 0, unemployed: 0, jobs: 0, jobsOpen: 0, homes: 0, vacancies: 0, happy: 0, health: 0, sick: 0, educated: 0,
    pSup: 0, pDem: 0, wSup: 0, wDem: 0, unpowered: 0, unwatered: 0, unconnected: 0, cov: { school: 0, hospital: 0, police: 0, fire: 0, shop: 0, park: 0 }, landfillLeft: 0, landfills: 0, homeless: 0 };
  for (const c of G.citizens.values()) {
    s.pop++;
    s.happy += c.happy; s.health += c.health;
    if (c.sick) s.sick++;
    if (c.age < 18) s.kids++; else if (c.age >= 66) s.seniors++; else { s.adults++; if (c.job != null) s.employed++; else s.unemployed++; }
    if (c.edu >= 10) s.educated++;
    if (c.home == null) s.homeless++;
  }
  s.happy = s.pop ? s.happy / s.pop : 60;
  s.health = s.pop ? s.health / s.pop : 90;
  let resCount = 0;
  for (const b of G.buildings.values()) {
    const d = DEFS[b.type];
    if (b.progress < 1) continue;
    if (d.jobs) { s.jobs += d.jobs; s.jobsOpen += Math.max(0, d.jobs - b.workers.size); }
    if (d.homes) {
      s.homes += d.homes;
      if (b.working) s.vacancies += d.homes - b.residents.size;
      const n = b.residents.size;
      resCount += n;
      for (const k of Object.keys(s.cov)) if (b.cov[k]) s.cov[k] += n;
    }
    if (d.powerOut) s.pSup += b.output || 0;
    if (d.power && b.comp != null && !b.fire) s.pDem += b.pNeed || 0;
    if (d.waterOut && b.powered) s.wSup += b.output || 0;
    if (d.water && b.comp != null) s.wDem += b.wNeed || 0;
    if (d.power && !b.powered) s.unpowered++;
    if (d.water && !b.watered) s.unwatered++;
    if (b.comp == null) s.unconnected++;
    if (b.type === 'landfill') { s.landfills++; s.landfillLeft += DEFS.landfill.capacity - b.fill; }
  }
  for (const k of Object.keys(s.cov)) s.cov[k] = resCount ? s.cov[k] / resCount : 0;
  // R / C / I demand, -1 … 1
  const scale = Math.max(8, s.pop * 0.15);
  s.demR = clamp((s.jobsOpen - s.unemployed) / scale + (s.vacancies ? -0.2 : 0.35), -1, 1);
  const shops = [...G.buildings.values()].filter((b) => b.type === 'shop').length;
  s.demC = clamp((s.pop / 45 - shops) / (shops + 2), -1, 1);
  s.demI = clamp((s.unemployed - s.jobsOpen) / scale + (G.goodsRate < 0 ? 0.4 : -0.1) + (G.foodRate < 0 ? 0.3 : 0), -1, 1);
  return s;
}

function computeAlerts() {
  const s = G.stats, a = [];
  const add = (sev, icon, text) => a.push({ sev, icon, text });
  if (!G.roadCount) add(3, '🛣️', 'Build a road first — every building needs road access.');
  if (G.roadCount && !G.buildings.size) add(2, '🏠', 'Place houses next to your road so people can move in.');
  const building = [...G.buildings.values()].filter((b) => b.progress < 1).length;
  if (building) add(0, '🚧', `${building} building${building > 1 ? 's' : ''} under construction.`);
  if (!s.pop && s.homes && !s.unpowered && !s.unwatered && !s.unconnected) add(1, '🚚', 'Homes are ready — the first families are on their way.');
  if (s.unconnected) add(3, '🛣️', `${s.unconnected} building${s.unconnected > 1 ? 's are' : ' is'} not connected to a road.`);
  if (s.unpowered) add(3, '⚡', `${s.unpowered} building${s.unpowered > 1 ? 's have' : ' has'} no power. Build a power plant on the same road network.`);
  if (s.unwatered) add(3, '💧', `${s.unwatered} building${s.unwatered > 1 ? 's have' : ' has'} no water. Build a pump by water or a water tower.`);
  if (s.pDem && s.pSup < s.pDem * 1.1 && !s.unpowered) add(2, '⚡', `Power grid almost maxed (${s.pSup.toFixed(0)}/${s.pDem.toFixed(0)} MW). Night or a calm day could cause blackouts.`);
  if (G.hungry) add(3, '🍞', 'People are starving! Build farms or turn imports on.');
  else if (G.foodRate < 0 && s.pop > 10) add(1, '🌾', `Food deficit of ${Math.round(-G.foodRate)}/day${G.imports ? ' is being imported' : ''}. Farms would save money.`);
  if (G.shopsStarved) add(2, '📦', 'Shops have run out of goods. Build factories or enable imports.');
  if (G.streetGarbage > 5) add(s.landfills ? 1 : 2, '🗑️', `${Math.round(G.streetGarbage)} t of garbage on the streets. ${s.landfills ? 'Landfills are overloaded.' : 'Build a landfill.'}`);
  if (s.landfills && s.landfillLeft < 800) add(2, '🗑️', 'Landfills are almost full. Build another one.');
  if (s.pop > 8 && s.unemployed > s.adults * 0.12) add(2, '💼', `${s.unemployed} people need jobs. Build farms, shops, factories or offices.`);
  if (s.jobsOpen > s.unemployed + 6) add(1, '👷', `${s.jobsOpen} jobs are unfilled. Build more homes.`);
  if (s.pop > 30) {
    if (s.cov.school < 0.6 && s.kids > 3) add(1, '🏫', `Only ${Math.round(s.cov.school * 100)}% of homes are near a school.`);
    if (s.cov.hospital < 0.6) add(s.sick > s.pop * 0.1 ? 2 : 1, '🏥', `${s.sick} sick citizens; ${Math.round(s.cov.hospital * 100)}% hospital coverage.`);
    if (s.cov.police < 0.6) add(1, '🚓', `Crime rising: ${Math.round(s.cov.police * 100)}% police coverage.`);
    if (s.cov.fire < 0.6) add(1, '🚒', `Fire risk: ${Math.round(s.cov.fire * 100)}% fire station coverage.`);
    if (s.cov.shop < 0.6) add(1, '🛒', `People want shops nearby (${Math.round(s.cov.shop * 100)}% covered).`);
  }
  if (G.money < 0) add(3, '💸', 'The city is in debt! Raise taxes or cut costly buildings.');
  if (G.lastDay && G.lastDay.net < 0 && G.money > 0) add(1, '📉', `Losing $${Math.round(-G.lastDay.net).toLocaleString()} per day.`);
  if (s.pop > 10 && s.happy < 40) add(2, '😟', 'Citizens are unhappy and may leave.');
  let polluted = 0;
  for (const b of G.buildings.values()) if (DEFS[b.type].homes && pollutionAt(b.i, b.j) > 6) polluted++;
  if (polluted) add(2, '🏭', `${polluted} homes suffer from heavy pollution. Plant trees, add parks, or move industry away.`);
  if (season().name === 'Winter') add(0, '❄️', 'Winter: heating raises power demand, farms produce 70% less.');
  a.sort((x, y) => y.sev - x.sev);
  return a;
}

export function issuesOf(b) {
  const d = DEFS[b.type], out = [];
  if (b.progress < 1) return ['🚧'];
  if (b.fire) out.push('🔥');
  if (b.comp == null) out.push('🛣️');
  else {
    if (d.power && !b.powered) out.push('⚡');
    if (d.water && !b.watered) out.push('💧');
  }
  if (d.jobs && b.working && b.staff < 0.34) out.push('👷');
  if (b.type === 'landfill' && b.fill >= DEFS.landfill.capacity) out.push('🗑️');
  if (d.homes && b.residents.size && pollutionAt(b.i, b.j) > 6) out.push('😷');
  return out;
}

/* ------------------------------------------------------------------ */
/*  Save / load                                                        */
/* ------------------------------------------------------------------ */
export function serialize() {
  return {
    v: 1, seed: G.seed, money: G.money, t: G.t, tax: G.tax, imports: G.imports, nextId: G.nextId,
    food: G.food, goods: G.goods, streetGarbage: G.streetGarbage, weather: G.weather, history: G.history,
    roads: [...G.tiles].filter(([, t]) => t.road).map(([k]) => k),
    buildings: [...G.buildings.values()].map((b) => [b.id, b.type, b.i, b.j, b.rot, b.variant, +b.progress.toFixed(3), Math.round(b.fill), b.fire]),
    citizens: [...G.citizens.values()].map((c) => [c.id, c.name, c.age, c.home, c.job, c.edu, Math.round(c.health), Math.round(c.happy), c.sick ? 1 : 0]),
    overrides: [...terrain.overrides],
    cleared: [...terrain.cleared],
    planted: [...terrain.planted],
  };
}

export function restore(data) {
  Object.assign(G, {
    seed: data.seed, money: data.money, t: data.t, tax: data.tax, imports: data.imports, nextId: data.nextId,
    food: data.food, goods: data.goods, streetGarbage: data.streetGarbage, weather: data.weather, history: data.history || [],
  });
  data.overrides.forEach(([k, h]) => terrain.overrides.set(k, h));
  data.cleared.forEach((k) => terrain.cleared.add(k));
  data.planted.forEach((k) => terrain.planted.add(k));
  for (const k of data.roads) { G.tiles.set(k, { road: true }); G.roadCount++; }
  for (const [id, type, i, j, rot, variant, progress, fill, fire] of data.buildings) {
    placeBuilding(type, i, j, rot, { free: true, id, variant, progress, fill, fire });
  }
  for (const [id, name, age, home, job, edu, health, happy, sick] of data.citizens) {
    const h = G.buildings.get(home);
    if (!h) continue;
    const c = { id, name, age, home, job: G.buildings.has(job) ? job : null, edu, health, happy, sad: 0, sick: !!sick, born: 1 };
    G.citizens.set(id, c);
    h.residents.add(id);
    if (c.job != null) G.buildings.get(c.job).workers.add(id);
  }
  G.netDirty = true;
  hourly(Math.floor(G.t));
}

export function initialTick() { hourly(Math.floor(G.t)); }
