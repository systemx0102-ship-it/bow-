"""Pose specification -> joint Transforms (with IK for hands and feet)."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import r15
from .r15 import cf, euler, fk, point

BOW = None  # filled lazily from bowlib (bow-space points)


def bow_points():
    global BOW
    if BOW is None:
        import os
        import sys

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from bowlib import bow as bowgeo

        BOW = {k: np.array(v) for k, v in bowgeo.attachments().items()}
    return BOW


@dataclass
class Pose:
    root_pos: tuple = (0.0, 0.0, 0.0)
    root_rot: tuple = (0.0, 0.0, 0.0)
    root_pivot: float = 0.0          # rotate the body about a point this far above the root joint
    waist: tuple = (0.0, 0.0, 0.0)
    neck: tuple = (0.0, 0.0, 0.0)
    larm: dict | None = None
    rarm: dict | None = None
    lleg: dict | None = None
    rleg: dict | None = None
    bow: tuple = (0.0, 0.0, 0.0)     # bow spin inside the hand (bow axes)
    draw: object = None              # None, or callable(world)->nock world point (preview only)
    meta: dict = field(default_factory=dict)


def _fk_limb(t, side, kind, spec):
    s = "Left" if side == "L" else "Right"
    if kind == "arm":
        names = (f"{s}UpperArm", f"{s}LowerArm", f"{s}Hand")
        keys = ("shoulder", "elbow", "wrist")
    else:
        names = (f"{s}UpperLeg", f"{s}LowerLeg", f"{s}Foot")
        keys = ("hip", "knee", "ankle")
    a = spec.get(keys[0], (0, 0, 0))
    b = spec.get(keys[1], 0.0)
    c = spec.get(keys[2], (0, 0, 0))
    t[names[0]] = cf(euler(*a))
    t[names[1]] = cf(euler(b, 0, 0)) if np.isscalar(b) else cf(euler(*b))
    t[names[2]] = cf(euler(*c))


def solve(pose: Pose):
    """Return (transforms, world, report) for a Pose."""
    t = {}
    R = euler(*pose.root_rot)
    pivot = np.array([0.0, pose.root_pivot, 0.0])
    t["LowerTorso"] = cf(R, np.asarray(pose.root_pos, float) + pivot - R @ pivot)
    t["UpperTorso"] = cf(euler(*pose.waist))
    t["Head"] = cf(euler(*pose.neck))
    t["BowHandle"] = cf(euler(*pose.bow))
    report = {}

    for side, kind, spec in (("L", "leg", pose.lleg), ("R", "leg", pose.rleg)):
        if spec is None:
            continue
        if "foot" in spec:
            foot_rot = euler(*spec.get("foot_rot", (0, spec.get("yaw", 0.0), 0)))
            tt, err = r15.solve_limb(t, side, "leg", spec["foot"], np.zeros(3), foot_rot,
                                     pole=spec.get("pole"), w_rot=spec.get("w_rot", 3.0))
            t.update(tt)
            report[f"{side}leg"] = err
        else:
            _fk_limb(t, side, "leg", spec)

    # left arm first: the right hand may be placed relative to the bow
    for side, spec in (("L", pose.larm), ("R", pose.rarm)):
        if spec is None:
            continue
        if "target" in spec:
            world = fk(t)
            target = spec["target"](world) if callable(spec["target"]) else spec["target"]
            rot = spec.get("rot")
            rot = rot(world) if callable(rot) else rot
            if spec.get("bow_up") is not None:
                rot = r15.hand_rot_for_bow(r15.bow_rotation(spec["bow_up"], spec["bow_string"]))
            pole = spec.get("pole")
            pole = pole(world) if callable(pole) else pole
            local = spec.get("local", r15.HAND_GRIP if side == "L" else r15.RIGHT_PINCH)
            tt, err = r15.solve_limb(t, side, "arm", target, local, rot, pole=pole,
                                     w_rot=spec.get("w_rot", 2.0), w_pole=spec.get("w_pole", 0.4))
            t.update(tt)
            report[f"{side}arm"] = err
        else:
            _fk_limb(t, side, "arm", spec)
    world = fk(t)
    return t, world, report


# ---------------------------------------------------------------------------
# helpers used by the animation definitions
# ---------------------------------------------------------------------------
def bow_world_point(world, name):
    return point(world, "BowHandle", bow_points()[name])


def aim_nock(draw_len, lift=0.0, side=0.0):
    """Nock position: `draw_len` behind the arrow rest, along the aim line (+Z = back)."""
    def f(world):
        rest = bow_world_point(world, "ArrowRest")
        return rest + np.array([side, lift, draw_len])
    return f


def string_rest(offset=(0, 0, 0)):
    def f(world):
        return bow_world_point(world, "StringRest") + np.asarray(offset, float)
    return f


def rel_head(offset):
    def f(world):
        return point(world, "Head", np.asarray(offset, float))
    return f


def bow_dir(up_deg_from_vertical_fwd, cant_deg=0.0, yaw_deg=0.0):
    """Bow up vector: tilted forward (toward -Z) by `up_deg...`, canted right by `cant_deg`."""
    a = np.radians(up_deg_from_vertical_fwd)
    c = np.radians(cant_deg)
    up = np.array([np.sin(c), np.cos(a) * np.cos(c), -np.sin(a) * np.cos(c)])
    string = np.array([0.0, np.sin(a), np.cos(a)])
    yaw = euler(0, yaw_deg, 0)
    return yaw @ up, yaw @ string
