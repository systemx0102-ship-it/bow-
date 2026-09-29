"""Small procedural-geometry toolkit used to build the Lunar Bow meshes.

Everything is expressed in *Roblox space*: +Y up, -Z forward, units = studs.
Meshes are plain numpy containers (vertices, polygon index tuples and
per-corner UVs) so they can be merged freely before being handed to Blender.
"""
from __future__ import annotations

import numpy as np
from scipy.interpolate import CubicSpline


def normalize(v, axis=-1):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.where(n < 1e-12, 1.0, n)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


class Mesh:
    """Polygon soup with per-corner UVs and a smoothing hint."""

    def __init__(self):
        self.V = np.zeros((0, 3))
        self.F: list[tuple[int, ...]] = []
        self.UV: list[list[tuple[float, float]]] = []

    def add(self, V, F, UV=None):
        base = len(self.V)
        self.V = np.vstack([self.V, np.asarray(V, float).reshape(-1, 3)])
        for i, f in enumerate(F):
            self.F.append(tuple(int(x) + base for x in f))
            self.UV.append(list(UV[i]) if UV is not None else [(0.0, 0.0)] * len(f))
        return self

    def merge(self, other: "Mesh"):
        base = len(self.V)
        self.V = np.vstack([self.V, other.V])
        self.F.extend(tuple(i + base for i in f) for f in other.F)
        self.UV.extend(list(uv) for uv in other.UV)
        return self

    def transform(self, fn):
        self.V = fn(self.V)
        return self

    def flip(self):
        self.F = [tuple(reversed(f)) for f in self.F]
        self.UV = [list(reversed(uv)) for uv in self.UV]
        return self

    def tri_count(self):
        return sum(len(f) - 2 for f in self.F)

    def signed_volume(self):
        vol = 0.0
        V = self.V
        for f in self.F:
            a = V[f[0]]
            for i in range(1, len(f) - 1):
                vol += np.dot(a, np.cross(V[f[i]], V[f[i + 1]])) / 6.0
        return vol

    def bounds(self):
        return self.V.min(axis=0), self.V.max(axis=0)


class Curve:
    """Arc-length parametrised cubic spline through control points."""

    def __init__(self, ctrl, dense=6000, bc="natural"):
        ctrl = np.asarray(ctrl, float)
        d = np.linalg.norm(np.diff(ctrl, axis=0), axis=1)
        t = np.concatenate([[0.0], np.cumsum(d)])
        cs = CubicSpline(t, ctrl, bc_type=bc)
        tt = np.linspace(0.0, t[-1], dense)
        P = cs(tt)
        seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
        self.P = P
        self.s = np.concatenate([[0.0], np.cumsum(seg)])
        self.length = float(self.s[-1])

    def point(self, s):
        s = np.atleast_1d(np.asarray(s, float))
        return np.stack([np.interp(s, self.s, self.P[:, k]) for k in range(3)], axis=-1)

    def tangent(self, s, eps=1e-3):
        s = np.atleast_1d(np.asarray(s, float))
        a = self.point(np.clip(s - eps, 0, self.length))
        b = self.point(np.clip(s + eps, 0, self.length))
        return normalize(b - a)


def bezier(points, n):
    """Evaluate a Bezier curve of any degree at n samples; returns (P, T)."""
    pts = np.asarray(points, float)
    deg = len(pts) - 1
    t = np.linspace(0.0, 1.0, n)[:, None]
    from math import comb

    P = sum(comb(deg, i) * (1 - t) ** (deg - i) * t ** i * pts[i] for i in range(deg + 1))
    dP = sum(
        comb(deg - 1, i) * (1 - t) ** (deg - 1 - i) * t ** i * (pts[i + 1] - pts[i]) * deg
        for i in range(deg)
    )
    return P, normalize(dP)


def frames_from_reference(T, ref):
    """Frames (N, B) where N is `ref` (per-sample or constant) made orthogonal to T."""
    T = normalize(T)
    ref = np.broadcast_to(np.asarray(ref, float), T.shape)
    N = normalize(ref - np.sum(ref * T, axis=1, keepdims=True) * T)
    B = normalize(np.cross(T, N))
    return N, B


def transport_frames(T, ref):
    """Rotation-minimising frames along tangents T starting from `ref`."""
    T = normalize(T)
    N = np.zeros_like(T)
    n0 = np.asarray(ref, float) - np.dot(ref, T[0]) * T[0]
    N[0] = normalize(n0)
    for i in range(1, len(T)):
        v = np.cross(T[i - 1], T[i])
        s = np.linalg.norm(v)
        c = np.dot(T[i - 1], T[i])
        if s < 1e-9:
            N[i] = N[i - 1]
            continue
        k = v / s
        n = N[i - 1]
        ang = np.arctan2(s, c)
        n = n * np.cos(ang) + np.cross(k, n) * np.sin(ang) + k * np.dot(k, n) * (1 - np.cos(ang))
        N[i] = normalize(n - np.dot(n, T[i]) * T[i])
    B = normalize(np.cross(T, N))
    return N, B


def sweep(P, N, B, prof, v_coord=None, cap_start=None, cap_end=None, u_scale=1.0):
    """Sweep closed 2D profiles along a path.

    P, N, B : (M,3) path points and frame axes.
    prof    : (M,K,2) profile coordinates (a along B, b along N), CCW when
              viewed from the path's end looking back toward its start.
    v_coord : (M,) texture V coordinate per ring (defaults to arc length).
    cap_*   : None, "flat" or "point" (point collapses to an apex that lies
              `apex` along the tangent; pass a float to use that distance).
    """
    P = np.asarray(P, float)
    M, K = prof.shape[:2]
    if v_coord is None:
        seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
        v_coord = np.concatenate([[0.0], np.cumsum(seg)])
    V = P[:, None, :] + prof[..., 0:1] * B[:, None, :] + prof[..., 1:2] * N[:, None, :]
    mesh = Mesh()
    verts = V.reshape(-1, 3)
    faces, uvs = [], []
    for i in range(M - 1):
        for k in range(K):
            k2 = (k + 1) % K
            a, b_, c, d = i * K + k, i * K + k2, (i + 1) * K + k2, (i + 1) * K + k
            faces.append((a, d, c, b_))
            u0, u1 = k / K * u_scale, (k + 1) / K * u_scale
            uvs.append([(u0, v_coord[i]), (u0, v_coord[i + 1]), (u1, v_coord[i + 1]), (u1, v_coord[i])])
    mesh.add(verts, faces, uvs)

    def cap(ring_idx, at_start, mode):
        if mode is None:
            return
        ring = [ring_idx * K + k for k in range(K)]
        center = V[ring_idx].mean(axis=0)
        tan = normalize(P[1] - P[0]) if at_start else normalize(P[-1] - P[-2])
        if mode == "flat":
            apex = center
        else:
            dist = float(mode) if not isinstance(mode, str) else 0.0
            apex = center + (-tan if at_start else tan) * dist
        ci = len(mesh.V)
        mesh.V = np.vstack([mesh.V, apex[None]])
        for k in range(K):
            k2 = (k + 1) % K
            if at_start:
                f = (ring[k], ring[k2], ci)
            else:
                f = (ring[k2], ring[k], ci)
            mesh.F.append(f)
            mesh.UV.append([(0.5, 0.5)] * 3)

    cap(0, True, cap_start)
    cap(M - 1, False, cap_end)
    return mesh


def polygon_param(poly, n):
    """Resample a closed polygon (K,2) to n points evenly by perimeter."""
    poly = np.asarray(poly, float)
    closed = np.vstack([poly, poly[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.linspace(0.0, s[-1], n, endpoint=False)
    return np.stack([np.interp(t, s, closed[:, 0]), np.interp(t, s, closed[:, 1])], axis=-1)


def rhombus(w, h):
    """Diamond cross-section (CCW) with half-width w (a axis) and half-height h (b axis)."""
    return np.array([[w, 0.0], [0.0, h], [-w, 0.0], [0.0, -h]])


def bipyramid(center, axis_long, axis_wide, axis_out, long_len, wide_len, out_len, back_len, star=False):
    """Faceted gem: a (star) polygon in the long/wide plane with apexes along +/- out."""
    c = np.asarray(center, float)
    L, W, O = normalize(axis_long), normalize(axis_wide), normalize(axis_out)
    if star:
        # four-pointed star: long tips on +-L, wide tips on +-W, short inner corners
        ring = [
            c + L * long_len,
            c + (L * 0.28 * long_len + W * 0.28 * wide_len) * 0.9,
            c + W * wide_len,
            c + (-L * 0.28 * long_len + W * 0.28 * wide_len) * 0.9,
            c - L * long_len,
            c + (-L * 0.28 * long_len - W * 0.28 * wide_len) * 0.9,
            c - W * wide_len,
            c + (L * 0.28 * long_len - W * 0.28 * wide_len) * 0.9,
        ]
    else:
        ring = [c + L * long_len, c + W * wide_len, c - L * long_len, c - W * wide_len]
    ring = np.array(ring)
    top = c + O * out_len
    bot = c - O * back_len
    V = np.vstack([ring, top[None], bot[None]])
    n = len(ring)
    it, ib = n, n + 1
    F, UV = [], []
    # orientation: ring goes L -> W, so (L x W) is the ring normal
    flip = np.dot(np.cross(L, W), O) < 0
    for k in range(n):
        k2 = (k + 1) % n
        f1 = (k, k2, it)
        f2 = (k2, k, ib)
        if flip:
            f1, f2 = f1[::-1], f2[::-1]
        F += [f1, f2]
        UV += [[(0, 0), (1, 0), (0.5, 1)]] * 2
    m = Mesh()
    m.add(V, F, UV)
    return m
