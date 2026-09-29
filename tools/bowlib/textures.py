"""Procedural, tileable PBR textures for the Lunar Bow (numpy only).

Every generator returns float arrays in UV space: index [iv, iu] with iv = 0
at V = 0 (bottom of the texture). `save_*` flips rows so the PNG matches the
usual image convention (row 0 = top = V 1). Normal maps are OpenGL style
(+Y / green = +V), which is what Roblox SurfaceAppearance and Blender expect.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

RES = 1024


def _grid(res=RES):
    t = (np.arange(res) + 0.5) / res
    u, v = np.meshgrid(t, t)  # u varies along columns, v along rows
    return u, v


def tile_noise(res=RES, scale=16.0, seed=0, octaves=4, gain=0.5):
    """Periodic fractal noise in [0,1] built by band-limiting white noise in FFT space."""
    rng = np.random.default_rng(seed)
    fx = np.fft.fftfreq(res)[None, :] * res
    fy = np.fft.fftfreq(res)[:, None] * res
    f = np.sqrt(fx ** 2 + fy ** 2)
    out = np.zeros((res, res))
    amp, freq = 1.0, scale
    for _ in range(octaves):
        white = rng.standard_normal((res, res))
        spec = np.fft.fft2(white) * np.exp(-((f / freq) ** 2))
        layer = np.real(np.fft.ifft2(spec))
        layer /= layer.std() + 1e-9
        out += amp * layer
        amp *= gain
        freq *= 2.0
    out -= out.min()
    return out / (out.max() + 1e-9)


def _wrap(d):
    return d - np.round(d)


def height_to_normal(h, strength=4.0):
    """Tangent-space normal from a tileable height field (OpenGL convention)."""
    res = h.shape[0]
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * res / 256.0
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * res / 256.0
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def _to_img(arr):
    arr = np.clip(arr, 0.0, 1.0)
    arr = arr[::-1]  # V=0 at the bottom of the image
    return Image.fromarray((arr * 255.0 + 0.5).astype(np.uint8))


def save_color(arr, path):
    _to_img(arr).convert("RGB").save(path, optimize=True)


def save_gray(arr, path):
    _to_img(arr).convert("L").save(path, optimize=True)


def save_normal(n, path):
    _to_img(n * 0.5 + 0.5).convert("RGB").save(path, optimize=True)


def srgb(c):
    return np.array(c, float) / 255.0


# ---------------------------------------------------------------------------
# Limb: dark "dragon steel" with overlapping scales and faint inner glow
# ---------------------------------------------------------------------------
def dragon_steel(res=RES, cols=6, rows=8):
    u, v = _grid(res)
    height = np.zeros((res, res))
    edge = np.zeros((res, res))
    r = 0.62 / cols
    # rows are painted bottom -> top; each later row overlaps the previous one,
    # so the visible free edge of every scale points toward -V (the grip).
    for row in range(-2, rows + 2):
        cy = row / rows
        off = 0.5 * (row % 2)
        cx = (np.floor(u * cols - off) + 0.5 + off) / cols
        for dcol in (-1, 0, 1):
            ccx = cx + dcol / cols
            dx = _wrap(u - ccx)
            dy = _wrap(v - cy)
            d = np.sqrt((dx * 1.0) ** 2 + (dy * 1.25) ** 2) / r
            inside = (d < 1.0) & (dy < 0.35 / rows)
            dome = np.sqrt(np.clip(1.0 - d ** 2, 0.0, 1.0))
            ridge = np.exp(-((dx / (0.035 / cols)) ** 2)) * np.clip(-dy * rows, 0, 1) * 0.25
            h = 0.35 + 0.55 * dome + ridge
            height = np.where(inside, h, height)
            edge = np.where(inside, np.clip((d - 0.78) / 0.22, 0, 1), edge)
    fine = tile_noise(res, 90, seed=3, octaves=3)
    broad = tile_noise(res, 6, seed=4, octaves=2)
    height = height + 0.04 * (fine - 0.5)
    cavity = np.clip(1.0 - height / 0.55, 0.0, 1.0)

    dark = srgb((12, 15, 27))
    mid = srgb((34, 42, 66))
    rim = srgb((92, 110, 150))
    glow = srgb((20, 120, 190))
    t = np.clip(height, 0, 1)[..., None]
    albedo = dark + (mid - dark) * t
    albedo = albedo + (rim - albedo) * (edge[..., None] * 0.55)
    albedo = albedo + (glow - albedo) * (cavity[..., None] ** 2 * 0.45)
    albedo *= (0.85 + 0.3 * broad)[..., None]

    rough = 0.24 + 0.22 * cavity + 0.12 * (fine - 0.5) + 0.08 * broad
    metal = 0.92 - 0.45 * cavity
    normal = height_to_normal(height, strength=5.0)
    return albedo, normal, np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)


# ---------------------------------------------------------------------------
# Armor: champagne gold with engraved filigree
# ---------------------------------------------------------------------------
def engraved_gold(res=RES):
    u, v = _grid(res)
    two_pi = 2 * np.pi
    warp = 0.10 * np.sin(two_pi * (2 * v + 0.25)) + 0.05 * np.sin(two_pi * (3 * u))
    a = np.abs(np.sin(two_pi * (3 * (u + warp)) + 2.0 * np.sin(two_pi * 2 * v)))
    b = np.abs(np.sin(two_pi * (2 * v - u) * 2 + 1.5 * np.cos(two_pi * 2 * u)))
    groove = np.clip(1.0 - np.minimum(a / 0.10, 1.0), 0, 1) + np.clip(1.0 - np.minimum(b / 0.06, 1.0), 0, 1) * 0.7
    border = np.exp(-((_wrap(v * 4) / 0.02) ** 2))
    groove = np.clip(groove + border * 0.8, 0, 1)
    hammer = tile_noise(res, 40, seed=11, octaves=3)
    micro = tile_noise(res, 160, seed=12, octaves=2)
    height = 0.75 - 0.5 * groove + 0.06 * (hammer - 0.5) + 0.02 * (micro - 0.5)

    gold = srgb((214, 186, 128))
    pale = srgb((236, 224, 196))
    deep = srgb((96, 72, 40))
    albedo = gold + (pale - gold) * (hammer[..., None] * 0.35)
    albedo = albedo + (deep - albedo) * (groove[..., None] * 0.85)
    rough = 0.16 + 0.35 * groove + 0.10 * hammer
    metal = 1.0 - 0.15 * groove
    normal = height_to_normal(height, strength=3.5)
    return albedo, normal, np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)


# ---------------------------------------------------------------------------
# Grip: dark leather wrap with stitched bands
# ---------------------------------------------------------------------------
def leather_wrap(res=RES, bands=6):
    u, v = _grid(res)
    w = (v * bands + u) % 1.0  # helical bands (match the geometric wrap)
    band = np.sin(np.pi * w) ** 0.6
    stitch_line = np.exp(-(((w - 0.10) / 0.010) ** 2)) + np.exp(-(((w - 0.90) / 0.010) ** 2))
    stitch_dash = (np.sin(2 * np.pi * u * 32) > 0.35).astype(float)
    stitches = stitch_line * stitch_dash
    grain = tile_noise(res, 120, seed=21, octaves=3)
    blotch = tile_noise(res, 10, seed=22, octaves=2)
    height = 0.55 * band + 0.08 * (grain - 0.5) - 0.18 * stitches

    base = srgb((22, 24, 36))
    worn = srgb((52, 56, 78))
    thread = srgb((70, 105, 140))
    albedo = base + (worn - base) * ((band * 0.6 + blotch * 0.4)[..., None] * 0.5)
    albedo = albedo + (thread - albedo) * (stitches[..., None] * 0.7)
    rough = 0.62 + 0.2 * (1 - band) + 0.1 * (grain - 0.5)
    metal = np.zeros_like(rough)
    normal = height_to_normal(height, strength=4.0)
    return albedo, normal, np.clip(rough, 0.05, 1), metal


def write_set(name, maps, folder):
    albedo, normal, rough, metal = maps
    paths = {
        "ColorMap": f"{folder}/{name}_Color.png",
        "NormalMap": f"{folder}/{name}_Normal.png",
        "RoughnessMap": f"{folder}/{name}_Roughness.png",
        "MetalnessMap": f"{folder}/{name}_Metalness.png",
    }
    save_color(albedo, paths["ColorMap"])
    save_normal(normal, paths["NormalMap"])
    save_gray(rough, paths["RoughnessMap"])
    save_gray(metal, paths["MetalnessMap"])
    return paths
