"""Procedural, tileable PBR textures for Purpose Green.

Run with any Python that has numpy + Pillow:
    python tools/blender/textures.py assets/textures

Every texture tiles seamlessly (noise is generated in the frequency domain),
and height-based normal maps are written alongside the materials that need them.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "assets/textures"
S = 1024
K = S / 512  # drawing scale relative to the original 512 px design
rng = np.random.default_rng(7)
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- noise helpers
def tnoise(size=S, scale=32.0, seed=None):
    """Tileable smooth noise in [0,1]; `scale` is the feature size in pixels."""
    r = np.random.default_rng(seed) if seed is not None else rng
    white = r.standard_normal((size, size))
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    sigma = 1.0 / max(scale, 1e-3)
    filt = np.exp(-(f / sigma) ** 2)
    n = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    n -= n.min()
    return n / (n.max() + 1e-9)


def fbm(size=S, base=96.0, octaves=5, seed=None, gain=0.5):
    total, amp, norm = np.zeros((size, size)), 1.0, 0.0
    for o in range(octaves):
        total += amp * tnoise(size, base / (2 ** o), None if seed is None else seed + o)
        norm += amp
        amp *= gain
    return total / norm


def lerp(a, b, t):
    return a + (b - a) * t


def colorize(t, stops):
    """Map scalar field t in [0,1] through colour stops [(pos, (r,g,b)), ...]."""
    out = np.zeros(t.shape + (3,))
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        m = (t >= p0) & (t <= p1)
        k = ((t - p0) / max(p1 - p0, 1e-6))[m][:, None]
        out[m] = np.array(c0) * (1 - k) + np.array(c1) * k
    out[t < stops[0][0]] = stops[0][1]
    out[t > stops[-1][0]] = stops[-1][1]
    return out


def save(name, rgb, alpha=None, q=88):
    arr = np.clip(rgb, 0, 255).astype(np.uint8)
    if alpha is not None:
        img = Image.fromarray(np.dstack([arr, np.clip(alpha, 0, 255).astype(np.uint8)]), "RGBA")
        img.save(os.path.join(OUT, name + ".png"), optimize=True)
    else:
        Image.fromarray(arr, "RGB").save(os.path.join(OUT, name + ".jpg"), quality=q)


def normal_map(name, h, strength=4.0):
    """Tileable normal map from a height field (OpenGL convention, +Y up)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    save(name + "_n", (n * 0.5 + 0.5) * 255, q=92)


yy, xx = np.mgrid[0:S, 0:S]


# ---------------------------------------------------------------- terrain
def grass():
    n = fbm(base=140, seed=1)
    fine = tnoise(scale=2.5, seed=2)
    blades = tnoise(scale=1.2, seed=3)
    t = np.clip(n * 0.8 + fine * 0.35 - 0.1, 0, 1)
    col = colorize(t, [(0, (52, 92, 30)), (0.45, (86, 128, 44)), (0.75, (118, 150, 58)), (1, (150, 160, 80))])
    col *= (0.82 + blades[..., None] * 0.3)
    dry = tnoise(scale=60, seed=4)[..., None]
    col = lerp(col, col * np.array([1.15, 1.02, 0.75]), np.clip(dry - 0.6, 0, 1) * 1.5)
    save("grass", col)
    normal_map("grass", fine * 0.6 + blades * 0.6, 2.5)


def rock():
    n = fbm(base=120, seed=10)
    ridge = 1 - np.abs(tnoise(scale=24, seed=11) * 2 - 1)
    strata = (np.sin((yy / S) * math.pi * 2 * 9 + n * 6) * 0.5 + 0.5)
    h = n * 0.6 + ridge ** 3 * 0.35 + strata * 0.15 + tnoise(scale=2, seed=12) * 0.12
    col = colorize(h, [(0, (70, 66, 62)), (0.5, (118, 112, 104)), (0.8, (150, 144, 134)), (1, (176, 170, 160))])
    save("rock", col)
    normal_map("rock", h, 7)


def sand():
    n = fbm(base=90, seed=20)
    ripples = np.sin((xx / S * 2 * math.pi * 14) + tnoise(scale=50, seed=21) * 8) * 0.5 + 0.5
    grain = tnoise(scale=1, seed=22)
    h = n * 0.5 + ripples * 0.2 + grain * 0.3
    col = colorize(h, [(0, (176, 152, 108)), (0.5, (212, 190, 140)), (1, (236, 220, 178))])
    save("sand", col)
    normal_map("sand", ripples * 0.4 + grain * 0.3, 2.5)


def snow():
    n = fbm(base=100, seed=30)
    sp = tnoise(scale=1, seed=31)
    col = colorize(n * 0.7 + sp * 0.3, [(0, (206, 216, 232)), (0.6, (236, 241, 248)), (1, (252, 253, 255))])
    save("snow", col)


def dirt():
    n = fbm(base=70, seed=40)
    pebbles = (tnoise(scale=3, seed=41) > 0.78) * 0.4
    h = n * 0.8 + pebbles
    col = colorize(h, [(0, (74, 54, 36)), (0.5, (110, 82, 56)), (1, (150, 120, 88))])
    save("dirt", col)
    normal_map("dirt", h, 3)


# ---------------------------------------------------------------- building materials
def bricks(name, base, mortar=(196, 190, 178), rows=26, per=9):
    img = np.zeros((S, S, 3))
    h = np.zeros((S, S))
    rh = S / rows
    bw = S / per
    noise = tnoise(scale=3, seed=50)
    for r in range(rows):
        y0, y1 = int(r * rh), int((r + 1) * rh)
        off = (bw / 2) * (r % 2)
        for b in range(per + 1):
            x0 = int(b * bw - off)
            x1 = int(x0 + bw)
            tint = rng.uniform(0.78, 1.15)
            c = np.array(base) * tint
            xs = np.arange(x0, x1) % S
            img[y0:y1][:, xs] = c
            h[y0:y1][:, xs] = 1
    m = 2
    mask = np.zeros((S, S), bool)
    for r in range(rows):
        y = int(r * rh)
        mask[max(0, y - m // 2): y + m // 2 + 1, :] = True
        off = (bw / 2) * (r % 2)
        for b in range(per + 1):
            x = int(b * bw - off) % S
            mask[int(r * rh): int((r + 1) * rh), max(0, x - 1): x + 2] = True
    img[mask] = mortar
    h[mask] = 0
    img *= (0.85 + noise[..., None] * 0.3)
    save(name, img)
    normal_map(name, np.array(Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255 + noise * 0.15, 3)


def siding(name, base):
    planks = 10
    t = (yy % (S / planks)) / (S / planks)
    shade = 0.78 + 0.22 * np.clip(t * 1.4, 0, 1)
    grain = tnoise(scale=4, seed=60)
    img = np.array(base)[None, None, :] * shade[..., None] * (0.94 + grain[..., None] * 0.1)
    save(name, img)
    normal_map(name, t + grain * 0.05, 2.5)


def plaster(name, base):
    n = fbm(base=40, seed=70) * 0.6 + tnoise(scale=1.5, seed=71) * 0.4
    img = np.array(base)[None, None, :] * (0.9 + n[..., None] * 0.16)
    save(name, img)
    normal_map(name, n, 1.5)


def concrete():
    n = fbm(base=80, seed=80)
    pores = (tnoise(scale=1.2, seed=81) > 0.82) * -0.25
    seams = ((xx % 256) < 2) | ((yy % 128) < 2)
    v = 150 + n * 50 + pores * 60
    v = np.where(seams, v * 0.78, v)
    img = np.dstack([v, v * 0.99, v * 0.96])
    save("concrete", img)
    normal_map("concrete", n * 0.6 + pores + seams * -0.4, 2)


def roof(name, base, rows=16, per=12, rounded=True):
    img = np.zeros((S, S, 3))
    h = np.zeros((S, S))
    rh, tw = S / rows, S / per
    for r in range(rows):
        off = (tw / 2) * (r % 2)
        for b in range(per + 1):
            x0 = b * tw - off
            tint = rng.uniform(0.82, 1.12)
            for y in range(int(r * rh), int((r + 1) * rh)):
                v = (y - r * rh) / rh
                xs = np.arange(int(x0), int(x0 + tw)) % S
                u = (np.arange(int(x0), int(x0 + tw)) - x0) / tw
                curve = np.sin(u * math.pi) if rounded else np.ones_like(u)
                light = 0.62 + 0.38 * v
                img[y, xs] = np.array(base)[None, :] * tint * (light * (0.85 + 0.15 * curve))[:, None]
                h[y, xs] = v * 0.6 + curve * 0.4
    img *= (0.9 + tnoise(scale=3, seed=90)[..., None] * 0.2)
    save(name, img)
    normal_map(name, h, 3)


def metal(name, base):
    corr = np.sin(xx / S * 2 * math.pi * 32) * 0.5 + 0.5
    n = fbm(base=60, seed=100)
    img = np.array(base)[None, None, :] * (0.78 + corr[..., None] * 0.22) * (0.92 + n[..., None] * 0.14)
    stains = np.clip(tnoise(scale=40, seed=101) - 0.7, 0, 1)[..., None] * 1.6
    img = lerp(img, img * np.array([0.8, 0.7, 0.6]), stains)
    save(name, img)
    normal_map(name, corr, 3)


def wood(name, base, planks=8, vertical=True):
    coord = xx if vertical else yy
    across = yy if vertical else xx
    t = (coord % (S / planks)) / (S / planks)
    grain = tnoise(scale=3, seed=110)
    rings = np.sin(across / S * 2 * math.pi * 30 + tnoise(scale=30, seed=111) * 10) * 0.5 + 0.5
    edge = np.where(t < 0.04, 0.6, 1.0)
    img = np.array(base)[None, None, :] * edge[..., None] * (0.85 + rings[..., None] * 0.12 + grain[..., None] * 0.08)
    save(name, img)
    normal_map(name, edge + rings * 0.1, 2)


def asphalt():
    n = fbm(base=90, seed=120)
    agg = tnoise(scale=0.9, seed=121)
    v = 58 + n * 22 + (agg - 0.5) * 34
    cracks = np.abs(tnoise(scale=30, seed=122) - 0.5) < 0.006
    v = np.where(cracks, v * 0.6, v)
    save("asphalt", np.dstack([v, v * 1.0, v * 1.04]))
    normal_map("asphalt", agg * 0.5 + n * 0.3 - cracks * 0.5, 2)


def crops(name, plant, soil=(104, 76, 50), rows=12):
    t = (xx % (S / rows)) / (S / rows)
    row = np.exp(-((t - 0.5) / 0.22) ** 2)
    leaves = tnoise(scale=2.5, seed=130)
    k = np.clip(row * (0.7 + leaves * 0.6), 0, 1)[..., None]
    img = lerp(np.array(soil)[None, None, :] * (0.85 + tnoise(scale=4, seed=131)[..., None] * 0.3), np.array(plant)[None, None, :] * (0.7 + leaves[..., None] * 0.5), k)
    save(name, img)


def pv():
    img = np.zeros((S, S, 3))
    cells = 8
    cs = S / cells
    for i in range(cells):
        for j in range(cells):
            tint = rng.uniform(0.9, 1.1)
            img[int(j * cs):int((j + 1) * cs), int(i * cs):int((i + 1) * cs)] = np.array([24, 44, 96]) * tint
    fingers = (yy % 16) < 1
    img[fingers] = img[fingers] * 1.6
    grid = ((xx % int(cs)) < 3) | ((yy % int(cs)) < 3)
    img[grid] = (196, 204, 214)
    save("pv", img)


def garbage():
    n = tnoise(scale=4, seed=140)
    hue = tnoise(scale=3, seed=141)
    base = colorize(hue, [(0, (70, 58, 44)), (0.25, (120, 104, 82)), (0.45, (96, 84, 60)), (0.55, (180, 70, 50)), (0.62, (110, 92, 70)), (0.72, (210, 206, 192)), (0.82, (90, 120, 70)), (0.9, (60, 90, 150)), (1, (130, 110, 80))])
    save("garbage", base * (0.6 + n[..., None] * 0.6))


def bark():
    streak = tnoise(scale=3, seed=150)
    streak = np.repeat(streak[:, :1], 1, 1)
    v = np.array([tnoise(scale=40, seed=151)[:, i % S] for i in range(S)]).T
    ridges = tnoise(size=S, scale=2.0, seed=152)
    ridges = np.array(Image.fromarray((ridges * 255).astype(np.uint8)).resize((S // 8, S)).resize((S, S))) / 255
    h = ridges * 0.7 + v * 0.3
    col = colorize(h, [(0, (40, 30, 22)), (0.5, (84, 64, 46)), (1, (120, 98, 76))])
    save("bark", col)
    normal_map("bark", h, 5)


def leaf_card(name, palette, count=1400 * 4, needle=False):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(160 if not needle else 170)
    if needle:
        # a pine bough: a central twig with many needles
        for b in range(7):
            y = (40 + b * 72) * K
            for k in range(int(150 * K)):
                x = 20 * K + k * (S - 40 * K) / (150 * K)
                c = palette[r.integers(len(palette))]
                ang = r.uniform(0.5, 1.3) * (1 if k % 2 else -1)
                L = r.uniform(26, 40) * K
                d.line([(x, y), (x + math.cos(ang) * L * 0.35, y + math.sin(ang) * L)], fill=c + (255,), width=int(4 * K))
            d.line([(20 * K, y), (S - 20 * K, y)], fill=(70, 50, 30, 255), width=int(5 * K))
    else:
        for _ in range(count):
            cx, cy = r.uniform(20 * K, S - 20 * K), r.uniform(20 * K, S - 20 * K)
            # keep a rounded silhouette for the card
            if (cx - S / 2) ** 2 + (cy - S / 2) ** 2 > (S * 0.47) ** 2:
                continue
            L, W = r.uniform(26, 42) * K, r.uniform(12, 20) * K
            ang = r.uniform(0, math.pi * 2)
            c = palette[r.integers(len(palette))]
            pts = []
            for t in np.linspace(0, math.pi * 2, 14):
                px, py = math.cos(t) * L / 2, math.sin(t) * W / 2 * (1 - 0.3 * math.cos(t))
                pts.append((cx + px * math.cos(ang) - py * math.sin(ang), cy + px * math.sin(ang) + py * math.cos(ang)))
            shade = r.uniform(0.75, 1.15)
            d.polygon(pts, fill=tuple(int(min(255, v * shade)) for v in c) + (255,))
            d.line([pts[0], pts[7]], fill=tuple(int(v * 0.7) for v in c) + (255,), width=1)
    arr = np.array(img).astype(float)
    save(name, arr[..., :3], arr[..., 3])


def stripes(name, a, b, n=10):
    t = ((xx // (S // n)) % 2)[..., None]
    img = np.where(t == 0, np.array(a), np.array(b)).astype(float)
    img *= 0.92 + tnoise(scale=3, seed=180)[..., None] * 0.12
    save(name, img)


def pitch():
    img = Image.new("RGB", (S, S), (70, 130, 55))
    a = np.array(img).astype(float)
    mow = ((xx // int(64 * K)) % 2)[..., None]
    a *= np.where(mow, 1.08, 0.94)
    img = Image.fromarray(a.astype(np.uint8))
    d = ImageDraw.Draw(img)
    w = (240, 240, 235)
    e, lw = 24 * K, int(5 * K)
    d.rectangle([e, e, S - e, S - e], outline=w, width=lw)
    d.line([(S / 2, e), (S / 2, S - e)], fill=w, width=lw)
    d.ellipse([S / 2 - 60 * K, S / 2 - 60 * K, S / 2 + 60 * K, S / 2 + 60 * K], outline=w, width=lw)
    d.rectangle([e, S / 2 - 90 * K, 100 * K, S / 2 + 90 * K], outline=w, width=lw)
    d.rectangle([S - 100 * K, S / 2 - 90 * K, S - e, S / 2 + 90 * K], outline=w, width=lw)
    img.save(os.path.join(OUT, "pitch.jpg"), quality=88)


def helipad():
    img = Image.new("RGB", (S, S), (70, 74, 80))
    d = ImageDraw.Draw(img)
    d.ellipse([40 * K, 40 * K, S - 40 * K, S - 40 * K], outline=(240, 240, 240), width=int(14 * K))
    d.rectangle([170 * K, 140 * K, 205 * K, 372 * K], fill=(240, 240, 240))
    d.rectangle([307 * K, 140 * K, 342 * K, 372 * K], fill=(240, 240, 240))
    d.rectangle([170 * K, 238 * K, 342 * K, 274 * K], fill=(240, 240, 240))
    a = np.array(img).astype(float) * (0.92 + tnoise(scale=3, seed=190)[..., None] * 0.14)
    save("helipad", a)


def water_normals():
    h = fbm(base=60, octaves=5, seed=200, gain=0.55)
    normal_map("water", h, 6)


def tire():
    v = 30 + tnoise(scale=2, seed=210) * 18
    save("rubber", np.dstack([v, v, v * 1.05]))


if __name__ == "__main__":
    grass(); rock(); sand(); snow(); dirt()
    bricks("brick_red", (150, 70, 52)); bricks("brick_tan", (196, 160, 116))
    siding("siding_white", (232, 230, 222)); siding("siding_blue", (126, 152, 178)); siding("siding_sage", (150, 170, 140))
    plaster("plaster_cream", (230, 214, 186)); plaster("plaster_white", (236, 234, 228)); plaster("plaster_peach", (226, 180, 150))
    concrete()
    roof("roof_red", (150, 66, 46)); roof("roof_slate", (78, 84, 94), rounded=False); roof("roof_brown", (110, 78, 58))
    metal("metal", (150, 158, 164)); metal("metal_blue", (78, 110, 150))
    wood("wood_barn", (150, 44, 36)); wood("wood", (150, 110, 72), vertical=False)
    asphalt()
    crops("crop_wheat", (214, 182, 84)); crops("crop_green", (86, 150, 52))
    pv(); garbage(); bark()
    leaf_card("leaves", [(58, 110, 40), (76, 130, 48), (96, 148, 56), (48, 92, 34)])
    leaf_card("needles", [(34, 82, 46), (44, 98, 54), (28, 70, 40)], needle=True)
    stripes("awning_red", (190, 46, 52), (240, 236, 228)); stripes("awning_green", (40, 130, 80), (240, 236, 228))
    pitch(); helipad(); water_normals(); tire()
    print("textures written to", OUT, len(os.listdir(OUT)))
