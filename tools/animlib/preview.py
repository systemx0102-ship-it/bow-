"""Tiny software renderer (numpy + PIL, painter's algorithm) for pose previews."""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bowlib import bow as bowgeo  # noqa: E402

from . import r15  # noqa: E402

COLORS = {
    "Head": (236, 196, 160),
    "UpperTorso": (40, 58, 110), "LowerTorso": (30, 40, 80),
    "LeftUpperArm": (70, 120, 200), "RightUpperArm": (200, 110, 70),
    "LeftLowerArm": (236, 196, 160), "RightLowerArm": (236, 196, 160),
    "LeftHand": (150, 200, 255), "RightHand": (255, 170, 120),
    "LeftUpperLeg": (40, 60, 110), "RightUpperLeg": (110, 50, 50),
    "LeftLowerLeg": (32, 36, 52), "RightLowerLeg": (32, 36, 52),
    "LeftFoot": (20, 20, 26), "RightFoot": (20, 20, 26),
}
LIGHT = np.array([0.4, 0.8, 0.45])
LIGHT /= np.linalg.norm(LIGHT)

_BOX_FACES = [
    ((1, 0, 0), [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)]),
    ((-1, 0, 0), [(-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)]),
    ((0, 1, 0), [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1)]),
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
]

# bow centreline in bow space (final units)
_d = np.linspace(-bowgeo.HALF + 0.01, bowgeo.HALF - 0.01, 40)
_P, _, _, _ = bowgeo.frame_at(_d)
BOW_LINE = _P * bowgeo.SCALE
BOW_PTS = bowgeo.attachments()


class Camera:
    def __init__(self, yaw_deg, pitch_deg, dist=16.0, target=(0, -0.3, 0), size=480, fov=36):
        yaw, pitch = np.radians(yaw_deg), np.radians(pitch_deg)
        fwd = np.array([np.sin(yaw) * np.cos(pitch), -np.sin(pitch), -np.cos(yaw) * np.cos(pitch)])
        # camera sits opposite to where it looks
        self.pos = np.asarray(target, float) - fwd * dist
        self.fwd = fwd
        self.right = np.cross(fwd, [0, 1, 0])
        self.right /= np.linalg.norm(self.right)
        self.up = np.cross(self.right, fwd)
        self.size = size
        self.f = size / 2 / np.tan(np.radians(fov) / 2)

    def project(self, p):
        v = np.asarray(p, float) - self.pos
        z = v @ self.fwd
        x = v @ self.right
        y = v @ self.up
        return np.stack([self.size / 2 + x / z * self.f, self.size / 2 - y / z * self.f], -1), z


def render_pose(world, cam, draw_state=None, title=None, arrow=False, root_offset=(0, 0, 0)):
    """world: dict of part CFrames (HRP space). draw_state: None or world-space nock point."""
    img = Image.new("RGB", (cam.size, cam.size), (10, 16, 34))
    dr = ImageDraw.Draw(img)
    off = np.asarray(root_offset, float)
    # ground grid
    for gx in np.arange(-6, 6.01, 1.0):
        a, _ = cam.project(np.array([[gx, -3, -6], [gx, -3, 6]]) + off * [1, 0, 1])
        dr.line([tuple(a[0]), tuple(a[1])], fill=(24, 34, 60), width=1)
        a, _ = cam.project(np.array([[-6, -3, gx], [6, -3, gx]]) + off * [1, 0, 1])
        dr.line([tuple(a[0]), tuple(a[1])], fill=(24, 34, 60), width=1)
    prims = []
    for name, col in COLORS.items():
        m = world[name].copy()
        m[:3, 3] += off
        half = np.array(r15.SIZES[name]) / 2
        for n, corners in _BOX_FACES:
            nw = m[:3, :3] @ np.array(n, float)
            pts = np.array([(m @ np.append(np.array(c) * half, 1))[:3] for c in corners])
            center = pts.mean(0)
            if (center - cam.pos) @ nw >= 0:
                continue
            shade = 0.35 + 0.65 * max(0.0, nw @ LIGHT)
            c = tuple(int(v * shade) for v in col)
            p2, z = cam.project(pts)
            prims.append((z.mean(), "poly", [tuple(q) for q in p2], c))
    # bow
    bm = world["BowHandle"].copy()
    bm[:3, 3] += off

    def bw(p):
        return (bm @ np.append(p, 1))[:3]

    line = np.array([bw(p) for p in BOW_LINE])
    p2, z = cam.project(line)
    for i in range(len(line) - 1):
        prims.append(((z[i] + z[i + 1]) / 2, "line", [tuple(p2[i]), tuple(p2[i + 1])], (230, 200, 120), 6))
    top, bot = bw(BOW_PTS["StringTop"]), bw(BOW_PTS["StringBottom"])
    nock = bw(BOW_PTS["StringRest"]) if draw_state is None else np.asarray(draw_state) + off
    for a, b in ((top, nock), (nock, bot)):
        q, zz = cam.project(np.array([a, b]))
        prims.append((zz.mean(), "line", [tuple(q[0]), tuple(q[1])], (110, 220, 255), 2))
    if arrow and draw_state is not None:
        rest = bw(BOW_PTS["ArrowRest"])
        d = rest - nock
        tip = nock + d / np.linalg.norm(d) * 2.55
        q, zz = cam.project(np.array([nock, tip]))
        prims.append((zz.mean(), "line", [tuple(q[0]), tuple(q[1])], (170, 240, 255), 3))
    prims.sort(key=lambda t: -t[0])
    for pr in prims:
        if pr[1] == "poly":
            dr.polygon(pr[2], fill=pr[3], outline=(0, 0, 0))
        else:
            dr.line(pr[2], fill=pr[3], width=pr[4])
    if title:
        dr.text((8, 8), title, fill=(220, 230, 255))
    return img
