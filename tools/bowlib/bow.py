"""Procedural geometry of the Lunar Bow ("Arco Lunar").

The bow lives in the YZ plane of *bow space*:
  +Y  toward the upper tip          origin = centre of the hand grip
  +Z  toward the string / archer    +X    = lateral side
All values below are authored at DESIGN scale (≈5 studs tip to tip) and the
final meshes are multiplied by SCALE.
"""
from __future__ import annotations

import math

import numpy as np

from .geom import (
    Curve,
    Mesh,
    bezier,
    bipyramid,
    frames_from_reference,
    lerp,
    normalize,
    rhombus,
    smoothstep,
    sweep,
)

SCALE = 0.92
Z_STRING = 0.70          # string plane (design units)
NOCK_Y = 2.29            # where the string meets each limb
ARROW_Y = 0.30           # arrow rest height above the grip centre
K = 16                   # limb cross-section resolution

# Upper-limb centreline (y, z). The lower limb is its mirror image.
UPPER = [
    (0.00, 0.00), (0.30, -0.07), (0.60, -0.14), (0.95, -0.16), (1.30, -0.08),
    (1.60, 0.07), (1.90, 0.26), (2.15, 0.46), (2.33, 0.64),
]
CTRL = [(0.0, -y, z) for (y, z) in reversed(UPPER[1:])] + [(0.0, y, z) for (y, z) in UPPER]
CURVE = Curve(CTRL)
HALF = CURVE.length / 2.0
LATERAL = np.array([1.0, 0.0, 0.0])

# helical armour plates
PLATE_LEN = 0.20
THREADS = 2
PLATE_AMP = 0.12


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def frame_at(d):
    """Point, tangent (toward +Y along the path), in-plane normal N (toward string), lateral B."""
    s = np.atleast_1d(HALF + np.asarray(d, float))
    P = CURVE.point(s)
    T = CURVE.tangent(s)
    N, B = frames_from_reference(T, np.array([0.0, 0.0, 1.0]))
    return P, T, N, B


def half_width(ad):
    u = np.clip(ad / HALF, 0, 1)
    return lerp(0.15, 0.074, smoothstep(0.08, 1.0, u))


def half_thick(ad):
    u = np.clip(ad / HALF, 0, 1)
    return 0.19 - 0.06 * smoothstep(0.05, 0.30, u) - 0.064 * smoothstep(0.30, 1.0, u)


def base_profile(psi, a, b):
    """Blade-lens cross-section: full lateral faces, sharp keels on belly/back."""
    c, s = np.cos(psi), np.sin(psi)
    return np.stack([a * np.sign(c) * np.abs(c) ** 0.8, b * np.sign(s) * np.abs(s) ** 1.4], axis=-1)


PSI = np.arange(K) * 2 * np.pi / K


def plate_amp(ad):
    return smoothstep(0.30, 0.40, ad) * (1.0 - smoothstep(2.08, 2.2, ad))


def plate_scale(ad, psi):
    f = np.mod(ad / PLATE_LEN - THREADS * psi / (2 * np.pi), 1.0)
    return 1.0 + plate_amp(ad) * PLATE_AMP * (-1.0 + 2.0 * f ** 1.6)


def limb_samples():
    """Adaptive ring distribution: dense where plates live, coarse in the riser."""
    end = CURVE.length / 2.0 - 0.005
    ds = []
    x = 0.0
    while x < end:
        ds.append(x)
        step = 0.028 if x < 0.30 else (0.0095 if x < 2.12 else 0.02)
        x += step
    ds.append(end)
    ad = np.array(ds)
    return np.concatenate([-ad[::-1], ad[1:]])


# ---------------------------------------------------------------------------
# parts
# ---------------------------------------------------------------------------
def build_limbs():
    d = limb_samples()
    ad = np.abs(d)
    P, T, N, B = frame_at(d)
    a, b = half_width(ad), half_thick(ad)
    prof = base_profile(PSI[None, :], a[:, None], b[:, None])
    sc = plate_scale(ad[:, None], PSI[None, :])
    prof = prof * sc[..., None]
    v = np.where(d >= 0, ad, -ad) / 0.6
    return sweep(P, N, B, prof, v_coord=v, cap_start=0.03, cap_end=0.03)


def build_veins():
    """Glowing crystal filaments tucked under the helical plate edges."""
    m = Mesh()
    for side in (1, -1):
        for j in range(1):  # only one of the two plate threads glows: keeps the limbs dark
            psi0 = (0.40 / PLATE_LEN - j) * 2 * np.pi / THREADS
            psi1 = (2.06 / PLATE_LEN - j) * 2 * np.pi / THREADS
            psi = np.arange(psi0, psi1, 2 * np.pi / 44)
            ad = PLATE_LEN * (j + THREADS * psi / (2 * np.pi)) + 0.035
            d = side * ad
            P, T, N, B = frame_at(d)
            a, b = half_width(ad), half_thick(ad)
            pr = base_profile(psi, a, b) * 0.955
            pts = P + pr[:, 0:1] * B + pr[:, 1:2] * N
            Th = normalize(np.gradient(pts, axis=0))
            radial = normalize(pts - P)
            Nv = normalize(radial - np.sum(radial * Th, axis=1, keepdims=True) * Th)
            Bv = normalize(np.cross(Th, Nv))
            taper = smoothstep(0.0, 0.12, ad - ad[0]) * smoothstep(0.0, 0.12, ad[-1] - ad)
            taper = 0.25 + 0.75 * taper
            prof = np.stack([rhombus(0.011 * t, 0.018 * t) for t in taper])
            m.merge(sweep(pts, Nv, Bv, prof, cap_start="flat", cap_end="flat"))
    return m


def collar(dc, width, scales=(1.14, 1.30, 1.20, 1.30, 1.14)):
    offs = np.array([-0.5, -0.5 + 0.16, 0.0, 0.5 - 0.16, 0.5]) * width
    d = dc + offs
    ad = np.abs(d)
    P, T, N, B = frame_at(d)
    a, b = half_width(ad), half_thick(ad)
    prof = base_profile(PSI[None, :], a[:, None], b[:, None]) * np.array(scales)[:, None, None]
    v = np.linspace(0, width / 0.5, len(d))
    return sweep(P, N, B, prof, v_coord=v, cap_start="flat", cap_end="flat")


def spike(dc, side, length, t1, t2, w0, h0, tilt_deg=0.0, n=16, base_scale=0.55):
    """Curved blade growing out of the limb inside the bow plane (optionally tilted)."""
    sgn = 1.0 if dc >= 0 else -1.0
    P0, T0, N0, B0 = frame_at(dc)
    P0, T0, N0 = P0[0], T0[0] * sgn, N0[0]   # T0 points toward the tip of this limb
    ad = abs(dc)
    b = float(half_thick(ad)) * 1.12
    tau = math.radians(tilt_deg)

    def local(t, nn):
        # rotate the in-plane offset around the tangent by the tilt angle
        return P0 + T0 * t + (N0 * math.cos(tau) + LATERAL * math.sin(tau)) * nn

    ctrl = [
        local(-0.005, side * b * base_scale),
        local(t1, side * (b + length * 0.55)),
        local(t2, side * (b + length)),
    ]
    Ps, Ts = bezier(ctrl, n)
    lat = normalize(np.cross(T0, N0 * math.cos(tau) + LATERAL * math.sin(tau)))
    lat = np.broadcast_to(lat, Ts.shape)
    Xs = normalize(lat - np.sum(lat * Ts, axis=1, keepdims=True) * Ts)
    Ws = normalize(np.cross(Xs, Ts))
    t = np.linspace(0, 1, n)
    taper = (1.0 - t) ** 0.85 + 0.02
    prof = np.stack([rhombus(h0 * k, w0 * k) for k in taper])
    return sweep(Ps, Ws, Xs, prof, v_coord=t * length / 0.5, cap_start="flat", cap_end=0.01)


def path_blade(pts_yz, w0, h0, sgn, n=28, lateral_offset=0.0, power=1.2):
    """Blade following a Bezier given in (y, z) design coords; sgn mirrors y for the lower limb."""
    ctrl = [np.array([lateral_offset, sgn * y, z]) for (y, z) in pts_yz]
    Ps, Ts = bezier(ctrl, n)
    lat = np.broadcast_to(LATERAL, Ts.shape)
    Xs = normalize(lat - np.sum(lat * Ts, axis=1, keepdims=True) * Ts)
    Ws = normalize(np.cross(Xs, Ts))
    t = np.linspace(0, 1, n)
    taper = (1.0 - t ** power) * 0.98 + 0.02
    prof = np.stack([rhombus(h0 * k, w0 * k) for k in taper])
    return sweep(Ps, Ws, Xs, prof, v_coord=t * 0.6, cap_start="flat", cap_end=0.01), Ps, Ts


SPIKES = [
    # (distance from grip, side(+1 string/-1 back), length, t1, t2, base width, thickness, tilts)
    (0.56, -1, 0.44, -0.02, -0.27, 0.080, 0.036, (-15, 15)),
    (0.56, -1, 0.28, 0.08, 0.22, 0.062, 0.032, (0,)),
    (0.56, +1, 0.15, 0.03, 0.12, 0.042, 0.026, (-22, 22)),
    (1.24, -1, 0.32, 0.00, -0.19, 0.064, 0.032, (-12, 12)),
    (1.24, -1, 0.20, 0.06, 0.16, 0.050, 0.028, (0,)),
    (1.92, +1, 0.22, 0.02, 0.17, 0.050, 0.028, (-16, 16)),
    (1.92, -1, 0.20, 0.05, 0.13, 0.046, 0.026, (0,)),
    (0.25, -1, 0.12, 0.03, 0.10, 0.034, 0.022, (-28, 28)),
]
COLLARS = [(0.25, 0.075), (0.56, 0.13), (1.24, 0.11), (1.92, 0.10), (2.20, 0.10)]

TIP_HOOK = [(2.24, 0.575), (2.44, 0.75), (2.59, 0.69), (2.67, 0.50)]
NOCK_HORN = [(2.25, 0.60), (2.27, 0.75), (2.34, 0.84)]


def build_armor():
    m = Mesh()
    for sgn in (1.0, -1.0):
        for dc, w in COLLARS:
            m.merge(collar(sgn * dc, w))
        for dc, side, length, t1, t2, w0, h0, tilts in SPIKES:
            for tilt in tilts:
                m.merge(spike(sgn * dc, side, length, t1, t2, w0, h0, tilt))
        hook, _, _ = path_blade(TIP_HOOK, 0.088, 0.062, sgn)
        m.merge(hook)
        horn, _, _ = path_blade(NOCK_HORN, 0.045, 0.038, sgn, n=14)
        m.merge(horn)
    return m


def build_grip():
    d = np.linspace(-0.215, 0.215, 64)
    ad = np.abs(d)
    P, T, N, B = frame_at(d)
    a, b = half_width(ad), half_thick(ad)
    psi = PSI[None, :]
    prof = base_profile(psi, a[:, None], b[:, None])
    wrap = 1.09 + 0.045 * (0.5 + 0.5 * np.cos(2 * np.pi * (d[:, None] / 0.072 + psi / (2 * np.pi))))
    prof = prof * wrap[..., None]
    v = (d + 0.215) / 0.43
    return sweep(P, N, B, prof, v_coord=v, cap_start="flat", cap_end="flat")


def build_crystals():
    m = build_veins()
    for sgn in (1.0, -1.0):
        big = sgn > 0
        dc = sgn * 0.39
        P, T, N, B = frame_at(dc)
        P, T, N, B = P[0], T[0], N[0], B[0]
        b = float(half_thick(abs(dc)))
        a = float(half_width(abs(dc)))
        # heart star on the back of the riser
        m.merge(bipyramid(P - N * b * 0.9, T, B, -N,
                          0.17 if big else 0.12, 0.12 if big else 0.085,
                          0.10 if big else 0.07, 0.06, star=True))
        # lateral diamonds
        for lat in (1, -1):
            m.merge(bipyramid(P + B * lat * a * 0.95, T, N, B * lat,
                              0.12 if big else 0.09, 0.05, 0.05, 0.04))
        # mid-limb lateral gems
        for adg, L_, W_ in ((0.90, 0.10, 0.045), (1.58, 0.085, 0.04)):
            Pg, Tg, Ng, Bg = frame_at(sgn * adg)
            ag = float(half_width(adg))
            for lat in (1, -1):
                m.merge(bipyramid(Pg[0] + Bg[0] * lat * ag * 1.02, Tg[0], Ng[0], Bg[0] * lat,
                                  L_, W_, 0.045, 0.04))
        # tip gems set into the hooks
        _, Ps, Ts = path_blade(TIP_HOOK, 0.088, 0.062, sgn)
        i = 7
        for lat in (1, -1):
            m.merge(bipyramid(Ps[i] + LATERAL * lat * 0.035, Ts[i], np.cross(Ts[i], LATERAL), LATERAL * lat,
                              0.075, 0.032, 0.04, 0.03))
    return m


def build_aura():
    """Two translucent spiral ribbons around the bow (rendered as ForceField in Roblox)."""
    m = Mesh()
    d = np.linspace(-2.45, 2.45, 260)
    P, T, N, B = frame_at(np.clip(d, -HALF + 0.01, HALF - 0.01))
    x = (d - d[0]) / (d[-1] - d[0])
    radius = 0.28 + 0.40 * np.sin(np.pi * x) ** 0.8
    width = 0.012 + 0.10 * np.sin(np.pi * x) ** 1.6
    for phase in (0.0, np.pi):
        th = phase + 2 * np.pi * 1.25 * x
        R = np.cos(th)[:, None] * B + np.sin(th)[:, None] * N
        C = P + R * radius[:, None] + np.array([0, 0, 0.18])  # centred between bow and string
        H = normalize(np.gradient(C, axis=0))
        W = normalize(np.cross(H, R))
        for flip, off in ((False, 0.004), (True, -0.004)):
            left = C - W * width[:, None] / 2 + R * off
            right = C + W * width[:, None] / 2 + R * off
            V = np.vstack([left, right])
            n = len(d)
            F, UV = [], []
            for i in range(n - 1):
                f = (i, i + 1, n + i + 1, n + i)
                uv = [(0, x[i]), (0, x[i + 1]), (1, x[i + 1]), (1, x[i])]
                if flip:
                    f, uv = f[::-1], uv[::-1]
                F.append(f)
                UV.append(uv)
            m.add(V, F, UV)
    return m


def build_arrow():
    """Crystal energy arrow in FINAL units; tail (nock) at the origin, flies toward -Z."""
    m = Mesh()
    length = 2.55
    head0 = length - 0.42
    # hexagonal shaft
    z = np.linspace(-0.02, -head0, 24)
    P = np.stack([np.zeros_like(z), np.zeros_like(z), z], axis=-1)
    T = np.broadcast_to(np.array([0, 0, -1.0]), P.shape)
    N = np.broadcast_to(np.array([0, 1.0, 0]), P.shape)
    B = normalize(np.cross(T, N))
    ang = np.arange(6) * np.pi / 3
    r = 0.028 + 0.006 * np.cos(np.linspace(0, 12 * np.pi, len(z)))
    prof = np.stack([np.stack([np.cos(ang) * rr, np.sin(ang) * rr], -1) for rr in r])
    m.merge(sweep(P, N, B, prof, cap_start="flat", cap_end="flat"))
    # arrow head: long faceted diamond blade with two side barbs
    m.merge(bipyramid([0, 0, -(head0 + 0.16)], [0, 0, -1], [1, 0, 0], [0, 1, 0], 0.30, 0.10, 0.035, 0.035))
    for lat in (1, -1):
        ctrl = [np.array([lat * 0.05, 0, -(head0 + 0.02)]), np.array([lat * 0.14, 0, -(head0 - 0.02)]),
                np.array([lat * 0.17, 0, -(head0 - 0.12)])]
        Ps, Ts = bezier(ctrl, 10)
        up = np.broadcast_to(np.array([0, 1.0, 0]), Ts.shape)
        Xs = normalize(up - np.sum(up * Ts, axis=1, keepdims=True) * Ts)
        Ws = normalize(np.cross(Xs, Ts))
        t = np.linspace(0, 1, 10)
        prof = np.stack([rhombus(0.02 * (1 - t_) + 0.002, 0.04 * (1 - t_) + 0.002) for t_ in t])
        m.merge(sweep(Ps, Ws, Xs, prof, cap_start="flat", cap_end=0.005))
    # three fletching vanes
    for k in range(3):
        ang = k * 2 * np.pi / 3 + np.pi / 2
        dirv = np.array([np.cos(ang), np.sin(ang), 0.0])
        root0 = np.array([0, 0, -0.05]) + dirv * 0.02
        root1 = np.array([0, 0, -0.50]) + dirv * 0.02
        tipA = np.array([0, 0, -0.02]) + dirv * 0.13
        tipB = np.array([0, 0, -0.16]) + dirv * 0.12
        side = normalize(np.cross(dirv, [0, 0, 1.0])) * 0.006
        quad = [root0, tipA, tipB, root1]
        Vf = np.array([p + side for p in quad] + [p - side for p in quad])
        F = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        m.add(Vf, F)
    # nock
    m.merge(bipyramid([0, 0, 0.0], [0, 0, 1], [1, 0, 0], [0, 1, 0], 0.05, 0.035, 0.03, 0.03))
    return m


def attachments():
    """Named points in bow space (FINAL units) used by the Roblox scripts."""
    pts = {}
    for name, sgn in (("Top", 1.0), ("Bottom", -1.0)):
        pts[f"String{name}"] = (0.0, sgn * NOCK_Y, Z_STRING)
        _, Ps, _ = path_blade(TIP_HOOK, 0.088, 0.062, sgn)
        tip = Ps[-1]
        pts[f"Tip{name}A"] = tuple(tip)
        P, _, _, _ = frame_at(sgn * 1.95)
        pts[f"Tip{name}B"] = tuple(P[0])
    pts["StringRest"] = (0.0, ARROW_Y, Z_STRING)
    pts["ArrowRest"] = (-0.17, ARROW_Y, 0.02)
    P, T, N, B = frame_at(0.39)
    pts["CoreLight"] = tuple(P[0] - N[0] * (float(half_thick(0.39)) + 0.05))
    pts["Grip"] = (0.0, 0.0, 0.0)
    return {k: tuple(float(c) * SCALE for c in v) for k, v in pts.items()}


def build_all():
    parts = {
        "Limbs": build_limbs(),
        "Armor": build_armor(),
        "Grip": build_grip(),
        "Crystals": build_crystals(),
        "Aura": build_aura(),
    }
    for m in parts.values():
        m.V = m.V * SCALE
    return parts
