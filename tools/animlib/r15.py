"""Minimal R15 rig: forward kinematics + numerical IK for authoring poses.

Conventions match Roblox:
  * Character space = HumanoidRootPart space: +X right, +Y up, character faces -Z.
  * Motor6D: Part1.CFrame = Part0.CFrame * C0 * Transform * C1:Inverse()
    Pose.CFrame in a KeyframeSequence is exactly that `Transform`.
  * R15 rig attachments have identity rotation, so a Transform rotation is
    expressed in the parent part's axes, pivoting at the joint.
Dimensions follow the default R15 block rig (HipHeight 2).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize
from scipy.spatial.transform import Rotation

# joint (Part1 name) -> (Part0 name, C0 position, C1 position)
JOINTS = {
    "LowerTorso": ("HumanoidRootPart", (0, -1.0, 0), (0, -0.2, 0)),
    "UpperTorso": ("LowerTorso", (0, 0.2, 0), (0, -0.8, 0)),
    "Head": ("UpperTorso", (0, 0.8, 0), (0, -0.5, 0)),
    "LeftUpperArm": ("UpperTorso", (-1.0, 0.563, 0), (0.5, 0.42, 0)),
    "LeftLowerArm": ("LeftUpperArm", (0, -0.334, 0), (0, 0.261, 0)),
    "LeftHand": ("LeftLowerArm", (0, -0.5, 0), (0, 0.125, 0)),
    "RightUpperArm": ("UpperTorso", (1.0, 0.563, 0), (-0.5, 0.42, 0)),
    "RightLowerArm": ("RightUpperArm", (0, -0.334, 0), (0, 0.261, 0)),
    "RightHand": ("RightLowerArm", (0, -0.5, 0), (0, 0.125, 0)),
    "LeftUpperLeg": ("LowerTorso", (-0.5, -0.2, 0), (0, 0.42, 0)),
    "LeftLowerLeg": ("LeftUpperLeg", (0, -0.4, 0), (0, 0.35, 0)),
    "LeftFoot": ("LeftLowerLeg", (0, -0.45, 0), (0, 0.08, 0)),
    "RightUpperLeg": ("LowerTorso", (0.5, -0.2, 0), (0, 0.42, 0)),
    "RightLowerLeg": ("RightUpperLeg", (0, -0.4, 0), (0, 0.35, 0)),
    "RightFoot": ("RightLowerLeg", (0, -0.45, 0), (0, 0.08, 0)),
    # the bow: Motor6D "BowGrip" created by the Tool (Part0 = LeftHand, Part1 = BowHandle)
    "BowHandle": ("LeftHand", (0, -0.1, 0), (0, 0, 0)),
}
ORDER = list(JOINTS)
SIZES = {
    "HumanoidRootPart": (2, 2, 1),
    "LowerTorso": (2, 0.4, 1),
    "UpperTorso": (2, 1.6, 1),
    "Head": (1.2, 1.2, 1.2),
    "LeftUpperArm": (1, 1.169, 1), "RightUpperArm": (1, 1.169, 1),
    "LeftLowerArm": (1, 1.052, 1), "RightLowerArm": (1, 1.052, 1),
    "LeftHand": (1, 0.3, 1), "RightHand": (1, 0.3, 1),
    "LeftUpperLeg": (1, 1.217, 1), "RightUpperLeg": (1, 1.217, 1),
    "LeftLowerLeg": (1, 1.193, 1), "RightLowerLeg": (1, 1.193, 1),
    "LeftFoot": (1, 0.3, 1), "RightFoot": (1, 0.3, 1),
}
# Bow orientation inside the grip joint: bow +Y (upper tip) = hand -Z, bow +Z (string) = hand +Y.
BOW_C0_ROT = Rotation.from_euler("x", -90, degrees=True).as_matrix()
HAND_GRIP = np.array([0, -0.1, 0.0])       # in hand space (matches BowHandle C0)
RIGHT_PINCH = np.array([0, -0.2, 0.0])     # where the right hand hooks the string

UPPER_BODY = ["UpperTorso", "Head", "LeftUpperArm", "LeftLowerArm", "LeftHand",
              "RightUpperArm", "RightLowerArm", "RightHand", "BowHandle"]
LOWER_BODY = ["LowerTorso", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
              "RightUpperLeg", "RightLowerLeg", "RightFoot"]


def cf(rot=None, pos=(0, 0, 0)):
    m = np.eye(4)
    if rot is not None:
        m[:3, :3] = rot
    m[:3, 3] = pos
    return m


def euler(x=0.0, y=0.0, z=0.0):
    """Degrees, applied yaw (Y) -> pitch (X) -> roll (Z); like CFrame.fromEulerAnglesYXZ."""
    return Rotation.from_euler("YXZ", [y, x, z], degrees=True).as_matrix()


def rotvec(v):
    return Rotation.from_rotvec(v).as_matrix()


def inv(m):
    r = m[:3, :3].T
    out = np.eye(4)
    out[:3, :3] = r
    out[:3, 3] = -r @ m[:3, 3]
    return out


def fk(transforms, root_cf=None):
    """World (HRP-space) CFrames of every part for the given joint Transforms."""
    world = {"HumanoidRootPart": np.eye(4) if root_cf is None else root_cf}
    for name in ORDER:
        p0, c0, c1 = JOINTS[name]
        c0m = cf(BOW_C0_ROT, c0) if name == "BowHandle" else cf(None, c0)
        t = transforms.get(name, np.eye(4))
        world[name] = world[p0] @ c0m @ t @ inv(cf(None, c1))
    return world


def joint_pivot(world, name):
    p0, c0, _ = JOINTS[name]
    return (world[p0] @ cf(None, c0))[:3, 3]


def point(world, part, local):
    return (world[part] @ np.append(local, 1.0))[:3]


# ---------------------------------------------------------------------------
# IK
# ---------------------------------------------------------------------------
def _limb_names(side, kind):
    s = "Left" if side == "L" else "Right"
    if kind == "arm":
        return f"{s}UpperArm", f"{s}LowerArm", f"{s}Hand"
    return f"{s}UpperLeg", f"{s}LowerLeg", f"{s}Foot"


def solve_limb(transforms, side, kind, target_pos, local_point, target_rot=None, pole=None,
               w_rot=2.0, w_pole=0.4, hinge_range=None, reg=0.02, seeds=None):
    """Solve shoulder/hip (3 DOF) + elbow/knee hinge (about X) + wrist/ankle (3 DOF).

    target_pos : desired world position of `local_point` (in hand/foot space)
    target_rot : desired world rotation (3x3) of the hand/foot (optional)
    pole       : world point the elbow/knee should lean toward (optional)
    """
    upper, lower, end = _limb_names(side, kind)
    if hinge_range is None:
        hinge_range = (0.0, 2.6) if kind == "arm" else (-2.6, 0.0)
    target_pos = np.asarray(target_pos, float)

    def build(x):
        t = dict(transforms)
        t[upper] = cf(rotvec(x[0:3]))
        t[lower] = cf(rotvec([x[3], 0, 0]))
        t[end] = cf(rotvec(x[4:7]))
        return t

    def cost(x):
        t = build(x)
        w = fk(t)
        p = point(w, end, local_point)
        c = 60.0 * np.sum((p - target_pos) ** 2)
        if target_rot is not None:
            c += w_rot * np.sum((w[end][:3, :3] - target_rot) ** 2)
        if pole is not None:
            elbow = joint_pivot(w, lower)
            c += w_pole * np.sum((elbow - np.asarray(pole)) ** 2)
        c += reg * (np.sum(x[4:7] ** 2) * 2.0 + np.sum(x[0:3] ** 2) * 0.2)
        return c

    bounds = [(-np.pi, np.pi)] * 3 + [hinge_range] + [(-1.4, 1.4)] * 3
    if seeds is None:
        seeds = [np.zeros(7)]
        mid = sum(hinge_range) / 2
        rng = np.random.default_rng(7)
        for _ in range(6):
            s = rng.normal(0, 0.9, 7)
            s[3] = mid
            s[4:7] *= 0.3
            seeds.append(s)
    best = None
    for s in seeds:
        r = minimize(cost, s, method="L-BFGS-B", bounds=bounds, options={"maxiter": 400})
        if best is None or r.fun < best.fun:
            best = r
    t = build(best.x)
    w = fk(t)
    err = float(np.linalg.norm(point(w, end, local_point) - target_pos))
    return t, err


def bow_rotation(up, string_dir):
    """World rotation of the bow from its up (+Y) axis and string (+Z) direction."""
    y = np.asarray(up, float)
    y /= np.linalg.norm(y)
    z = np.asarray(string_dir, float)
    z = z - np.dot(z, y) * y
    z /= np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], axis=1)


def hand_rot_for_bow(bow_rot):
    """Hand rotation that yields `bow_rot` through the grip joint (with identity Transform)."""
    return bow_rot @ BOW_C0_ROT.T
