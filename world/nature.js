// Laws of nature that drive the world: astronomy, climate, wind, water cycle,
// vegetation growth and wildfire. Everything here is deterministic physics or
// simple ecological rules, evaluated once per game hour (and once per day).

import { tkey, T } from './terrain.js';

const DEG = Math.PI / 180;
export const LATITUDE = 42 * DEG;     // a temperate mid-latitude
export const DAYS_PER_YEAR = 24;      // game days in a full year (4 seasons × 6 days)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const N = {
  temp: 12,            // °C air temperature
  anomaly: 0,          // slow-moving weather-system offset (°C)
  windSpeed: 5,        // m/s at hub height
  windDir: 0.6,        // radians the wind blows towards (0 = +x / east)
  groundwater: 0.7,    // aquifer level 0..1
  ice: 0,              // lake/sea ice cover 0..1
  dryness: 0.3,        // fuel dryness 0..1 (wildfire risk)
  rainToday: 0,
  burning: new Map(),  // tile key -> hours burning
  treeAge: new Map(),  // planted tile key -> age in days
  focus: [0, 0],       // tile around which ecology is simulated
  events: [],
};

let terrain = null, onEvent = () => {}, onIgnite = () => {};
export function bindNature(t, hooks) { terrain = t; onEvent = hooks.onEvent; onIgnite = hooks.onIgnite; }

/* ------------------------------------------------------------------ */
/*  Astronomy                                                          */
/* ------------------------------------------------------------------ */
/** Day of the (real) year for a game time; spring equinox ≈ day 79. */
export function dayOfYear(t) { return (79 + ((t / 24) % DAYS_PER_YEAR) / DAYS_PER_YEAR * 365) % 365; }
export function declination(doy) { return 23.44 * DEG * Math.sin(2 * Math.PI * (284 + doy) / 365); }

/** Sun elevation/azimuth from the standard solar position equations. */
export function sunPosition(t) {
  const doy = dayOfYear(t), dec = declination(doy);
  const hourAngle = (15 * ((t % 24) - 12)) * DEG;
  const sinEl = Math.sin(LATITUDE) * Math.sin(dec) + Math.cos(LATITUDE) * Math.cos(dec) * Math.cos(hourAngle);
  const el = Math.asin(clamp(sinEl, -1, 1));
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(LATITUDE)) / (Math.cos(el) * Math.cos(LATITUDE));
  let az = Math.acos(clamp(cosAz, -1, 1)); // from north, clockwise
  if (hourAngle > 0) az = 2 * Math.PI - az;
  return { elevation: el, azimuth: az, declination: dec };
}
/** Unit vector pointing at the sun (world: +x east, -z north, +y up). */
export function sunVector(t, out) {
  const { elevation: el, azimuth: az } = sunPosition(t);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
export function dayLength(t) {
  const dec = declination(dayOfYear(t));
  const x = -Math.tan(LATITUDE) * Math.tan(dec);
  return x <= -1 ? 24 : x >= 1 ? 0 : (2 * Math.acos(x) / DEG) / 15;
}
/** Moon: 29.5-day synodic month compressed to 7.4 game days. 0 = new, 0.5 = full. */
export function moonPhase(t) { return ((t / 24) / 7.4) % 1; }
export const moonLight = (t) => (1 - Math.cos(2 * Math.PI * moonPhase(t))) / 2;
export function moonVector(t, out) {
  // the moon trails the sun by its phase angle
  return sunVector(t - moonPhase(t) * 24, out);
}

/* ------------------------------------------------------------------ */
/*  Climate                                                            */
/* ------------------------------------------------------------------ */
const ANNUAL_MEAN = 12, ANNUAL_AMP = 13, DIURNAL_AMP = 5.5;
export function climateTemp(t, kind) {
  const doy = dayOfYear(t);
  const seasonal = ANNUAL_MEAN - ANNUAL_AMP * Math.cos(2 * Math.PI * (doy - 20) / 365); // coldest ~20 Jan
  const cloud = { sun: 0, cloudy: 0.6, rain: 0.8, storm: 0.9, snow: 0.8 }[kind] ?? 0;
  const diurnal = DIURNAL_AMP * (1 - cloud * 0.65) * Math.sin(2 * Math.PI * ((t % 24) - 9) / 24); // min ~03:00, max ~15:00
  const wetCool = { rain: -1.5, storm: -3, snow: -1 }[kind] ?? 0;
  return seasonal + diurnal + wetCool + N.anomaly;
}

/** Hourly weather: a slow random walk of pressure systems, precipitation by temperature. */
export function stepWeather(G) {
  N.anomaly = clamp(N.anomaly + (Math.random() - 0.5) * 0.6 - N.anomaly * 0.02, -6, 6);
  const w = G.weather;
  if (G.t >= w.until) {
    const r = Math.random();
    // hot dry spells are less rainy, cold spells bring precipitation as snow
    const dryBias = clamp((N.temp - 22) / 20, 0, 0.2);
    let kind = r < 0.42 + dryBias ? 'sun' : r < 0.68 ? 'cloudy' : r < 0.93 ? 'rain' : 'storm';
    const t = climateTemp(G.t, kind);
    if ((kind === 'rain' || kind === 'storm') && t < 1) kind = 'snow';
    if (kind === 'storm' && t < 8) kind = 'rain';
    w.kind = kind;
    w.until = G.t + 4 + Math.random() * 10;
    N.targetWind = kind === 'storm' ? 15 + Math.random() * 13 : kind === 'sun' ? 1 + Math.random() * 7 : 3 + Math.random() * 9;
    if (kind === 'storm') onEvent(`⛈️ Storm: winds up to ${Math.round(N.targetWind * 3.6)} km/h, lightning likely`, 'bad');
    if (kind === 'snow') onEvent('🌨️ Snow is falling', '');
  }
  // wind eases toward the weather system's strength; direction veers slowly
  N.windSpeed += ((N.targetWind ?? 5) - N.windSpeed) * 0.25 + (Math.random() - 0.5) * 1.2;
  N.windSpeed = clamp(N.windSpeed, 0, 32);
  N.windDir += (Math.random() - 0.5) * 0.15;
  w.wind = clamp(N.windSpeed / 25, 0, 1);
  w.windSpeed = N.windSpeed;
  N.temp = climateTemp(G.t, w.kind);
  w.temp = N.temp;
}

/* ------------------------------------------------------------------ */
/*  Energy physics                                                     */
/* ------------------------------------------------------------------ */
/** Wind turbine power curve: cut-in 3 m/s, P ∝ v³ up to rated 12 m/s, cut-out at 25 m/s. */
export function windPower(v = N.windSpeed) {
  if (v < 3 || v > 25) return 0;
  if (v >= 12) return 1;
  return (v ** 3 - 27) / (12 ** 3 - 27);
}
/** Solar panels: irradiance from sun elevation (with air mass), clouds, haze and heat. */
export function solarPower(t, kind, haze = 0) {
  const el = sunPosition(t).elevation;
  if (el <= 0) return 0;
  const airMass = 1 / Math.max(0.05, Math.sin(el));
  const clear = 1.1 * Math.pow(0.7, Math.pow(airMass, 0.678)); // Meinel clear-sky model (fraction of 1 kW/m²)
  const clouds = { sun: 1, cloudy: 0.45, rain: 0.25, storm: 0.12, snow: 0.2 }[kind] ?? 1;
  const tilt = 0.75 + 0.25 * Math.sin(el); // panels are tilted towards the sun
  const heat = 1 - Math.max(0, N.temp - 25) * 0.004; // −0.4 %/°C above 25 °C
  const snowed = kind === 'snow' ? 0.3 : 1;
  return clamp(clear * clouds * tilt * heat * (1 - haze * 0.25) * snowed, 0, 1);
}
/** Building energy demand rises with heating below 16 °C and cooling above 24 °C. */
export function heatingFactor(temp = N.temp) { return 1 + Math.max(0, 16 - temp) * 0.045 + Math.max(0, temp - 24) * 0.06; }
/** Crops: no growth below 5 °C, optimum 18–28 °C, heat stress above 32 °C; drought halves yield. */
export function cropFactor(temp = N.temp) {
  const t = temp < 5 ? 0 : temp < 18 ? (temp - 5) / 13 : temp <= 28 ? 1 : temp < 38 ? 1 - (temp - 28) / 14 : 0.3;
  return t * (0.5 + 0.5 * clamp(N.groundwater * 1.6, 0, 1)) * 1.15;
}
export function waterDemandFactor(temp = N.temp) { return 1 + Math.max(0, temp - 22) * 0.03; }
export function wellFactor() { return clamp(0.15 + N.groundwater * 1.1, 0.15, 1); }
export function pumpFactor() { return 1 - N.ice * 0.6; }

/* ------------------------------------------------------------------ */
/*  Water cycle, ice, vegetation, wildfire                             */
/* ------------------------------------------------------------------ */
export function hourlyNature(G) {
  stepWeather(G);
  const kind = G.weather.kind;
  // aquifer: recharged by rain and snowmelt, drained by evaporation and pumping
  const rain = { rain: 0.012, storm: 0.022, snow: 0.003 }[kind] ?? 0;
  const melt = N.temp > 2 && N.snowpack > 0 ? Math.min(N.snowpack, 0.004) : 0;
  N.snowpack = clamp((N.snowpack || 0) + (kind === 'snow' ? 0.006 : 0) - melt, 0, 1);
  const evaporation = Math.max(0, N.temp) * 0.00012 * (kind === 'sun' ? 1.5 : 0.6);
  N.groundwater = clamp(N.groundwater + rain + melt - evaporation - (G.wellDraw || 0) * 0.00004, 0, 1);
  if (rain) N.rainToday += rain;
  // lakes freeze after sustained frost and thaw above zero
  N.ice = clamp(N.ice + (N.temp < -1 ? -N.temp * 0.015 : -Math.max(0.02, N.temp * 0.01)), 0, 1);
  // vegetation dries out in heat and wind, soaks up rain
  N.dryness = clamp(N.dryness + (N.temp > 20 ? 0.006 : -0.002) + N.windSpeed * 0.0002 - rain * 3 - (kind === 'snow' ? 0.02 : 0), 0, 1);
  if (N.groundwater < 0.18 && Math.random() < 0.05) onEvent('🏜️ Drought: wells are running low', 'bad');
  wildfire(G);
}

const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
function wildfire(G) {
  if (!terrain) return;
  const kind = G.weather.kind;
  // ignition: dry lightning in storms, or rare heat-wave ignitions
  const risk = N.dryness > 0.55 ? (kind === 'storm' ? 0.12 : N.temp > 28 ? 0.01 : 0) : 0;
  if (Math.random() < risk) {
    const [fi, fj] = N.focus;
    for (let k = 0; k < 30; k++) {
      const i = fi + Math.round((Math.random() - 0.5) * 70), j = fj + Math.round((Math.random() - 0.5) * 70);
      if (terrain.hasTree(i, j)) { N.burning.set(tkey(i, j), 0); onEvent('🔥 Wildfire! Dry forest has caught fire', 'bad'); break; }
    }
  }
  if (!N.burning.size) return;
  const wx = Math.cos(N.windDir), wz = Math.sin(N.windDir);
  const spread = [];
  for (const [k, h] of N.burning) {
    const [i, j] = k.split(',').map(Number);
    const nh = h + 1;
    // rain and firefighters put fires out
    const firefighters = G.fireCover ? G.fireCover(i, j) : false;
    if ((kind === 'rain' || kind === 'storm' || kind === 'snow') && Math.random() < 0.45) { N.burning.delete(k); continue; }
    if (firefighters && Math.random() < 0.35) { N.burning.delete(k); continue; }
    if (nh >= 4) {
      N.burning.delete(k);
      terrain.planted.delete(k);
      terrain.cleared.add(k);
      terrain.burned.set(k, G.t);
      terrain.markDirty(i, j, i, j);
      continue;
    }
    N.burning.set(k, nh);
    for (const [di, dj] of NEIGH) {
      const ni = i + di, nj = j + dj, nk = tkey(ni, nj);
      if (N.burning.has(nk) || !terrain.hasTree(ni, nj)) {
        // fire reaching a building sets it alight
        if (G.buildingAt && Math.random() < 0.15 * N.dryness) { const b = G.buildingAt(ni, nj); if (b && !b.fire) { b.fire = 1; onIgnite(b); } }
        continue;
      }
      // downwind neighbours catch fire far more easily
      const align = (di * wx + dj * wz) / Math.hypot(di, dj);
      const p = 0.18 * N.dryness * (1 + align * (0.5 + N.windSpeed / 10));
      if (Math.random() < p) spread.push(nk);
    }
  }
  for (const k of spread) if (N.burning.size < 400) N.burning.set(k, 0);
}

/** Daily ecology: saplings grow, forests reseed cleared and burned land. */
export function dailyNature(G) {
  N.rainToday = 0;
  if (!terrain) return;
  const growing = N.temp > 5;
  for (const [k, age] of N.treeAge) {
    if (growing) N.treeAge.set(k, age + 1);
    if (age > 8) N.treeAge.delete(k);
  }
  if (!growing) return;
  // natural regeneration: burned or cleared ground next to forest slowly reseeds
  let reseeded = 0;
  const [fi, fj] = N.focus;
  for (const k of [...terrain.cleared]) {
    if (reseeded > 40) break;
    const [i, j] = k.split(',').map(Number);
    if (Math.abs(i - fi) > 60 || Math.abs(j - fj) > 60 || terrain.isBlocked(i, j) || terrain.isWater(i, j)) continue;
    const burnedAt = terrain.burned.get(k);
    if (burnedAt !== undefined && G.t - burnedAt < 24 * 3) continue;
    let seeds = 0;
    for (const [di, dj] of NEIGH) if (terrain.hasTree(i + di, j + dj)) seeds++;
    if (seeds && Math.random() < 0.02 * seeds) {
      terrain.cleared.delete(k);
      terrain.burned.delete(k);
      if (!terrain.naturalTree(i, j)) terrain.planted.add(k);
      N.treeAge.set(k, 0);
      terrain.markDirty(i, j, i, j);
      reseeded++;
    }
  }
}

/** Saplings grow from 30 % to full size over about a week of growing days. */
export function treeGrowth(k) {
  const age = N.treeAge.get(k);
  return age === undefined ? 1 : 0.3 + 0.7 * Math.min(1, age / 7);
}

export function serializeNature() {
  return { temp: N.temp, anomaly: N.anomaly, windSpeed: N.windSpeed, windDir: N.windDir, groundwater: N.groundwater, ice: N.ice, dryness: N.dryness, snowpack: N.snowpack || 0, burning: [...N.burning], treeAge: [...N.treeAge], burned: [...terrain.burned] };
}
export function restoreNature(d) {
  if (!d) return;
  Object.assign(N, { temp: d.temp, anomaly: d.anomaly, windSpeed: d.windSpeed, windDir: d.windDir, groundwater: d.groundwater, ice: d.ice, dryness: d.dryness, snowpack: d.snowpack });
  N.burning = new Map(d.burning || []);
  N.treeAge = new Map(d.treeAge || []);
  for (const [k, t] of d.burned || []) terrain.burned.set(k, t);
}
export const tileSize = T;
