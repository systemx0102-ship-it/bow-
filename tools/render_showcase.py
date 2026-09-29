"""Render a showcase GIF of the animations with the real bow (Blender / Cycles).

    python3 tools/render_showcase.py [--frames N] [--size 480] [--samples 20]

Needs model/LunarBow.blend (run tools/build_bow.py first).
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from animlib import anims, export, poses, r15  # noqa: E402
from bowlib import bow as bowgeo  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "animations", "previews")
C = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float)  # Roblox -> Blender
CI = np.linalg.inv(C)
FPS = 24

# (clip, duration, lower-body clip or None)
SEQUENCE = [
    ("Equip", None, None),
    ("Hold", 0.5, None),
    ("Draw", None, "AimStance"),
    ("Aim", 1.0, "AimStance"),
    ("ShootCharged", None, None),
    ("Hold", 0.35, None),
    ("Special", None, None),
    ("Hold", 0.6, None),
]
HOOKED = {"Draw": (0.13, 99), "Aim": (0, 99), "Special": (0.62, 0.84)}
PALETTE = {
    "Head": (0.93, 0.78, 0.66), "UpperTorso": (0.05, 0.1, 0.32), "LowerTorso": (0.04, 0.06, 0.16),
    "Arm": (0.93, 0.78, 0.66), "UpperArm": (0.06, 0.12, 0.38), "Hand": (0.9, 0.75, 0.63),
    "UpperLeg": (0.04, 0.05, 0.1), "LowerLeg": (0.04, 0.05, 0.1), "Foot": (0.75, 0.66, 0.45),
}


def to_bl(m):
    return Matrix((C @ m @ CI).tolist())


def solve_all():
    out = {}
    for a in anims.build_all():
        solved = []
        for k in a.keys:
            tr, _, _ = poses.solve(k.pose)
            for j in r15.ORDER:
                tr.setdefault(j, np.eye(4))
            solved.append((k, tr))
        out[a.name] = (a, solved)
    return out


def timeline(clips):
    """Frame-by-frame list of (clip name, local time, lower clip, lower weight, global time)."""
    frames = []
    t_global = 0.0
    lower_prev = None
    for name, dur, lower in SEQUENCE:
        a, solved = clips[name]
        length = dur if dur is not None else solved[-1][0].time
        n = int(round(length * FPS))
        for i in range(n):
            t = i / FPS
            local = t % solved[-1][0].time if a.loop else min(t, solved[-1][0].time)
            if lower:
                w = min(1.0, t / 0.25) if lower_prev != lower else 1.0
            else:
                w = max(0.0, 1.0 - t / 0.2) if lower_prev else 0.0
            frames.append((name, local, lower or lower_prev, w, t_global + t))
        t_global += n / FPS
        lower_prev = lower
    return frames


def blend(a, b, w):
    from scipy.spatial.transform import Rotation, Slerp

    if w <= 0:
        return a
    if w >= 1:
        return b
    r = Slerp([0, 1], Rotation.from_matrix(np.stack([a[:3, :3], b[:3, :3]])))(w).as_matrix()
    m = np.eye(4)
    m[:3, :3] = r
    m[:3, 3] = a[:3, 3] * (1 - w) + b[:3, 3] * w
    return m


def material(name, color, rough=0.6, metal=0.0, emit=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = emit
    return mat


def make_box(name, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    o.data.transform(Matrix.Diagonal((size[0], size[2], size[1], 1)))  # Roblox (x,y,z) -> Blender (x,z,y)
    mod = o.modifiers.new("Bevel", "BEVEL")
    mod.width = 0.06
    mod.segments = 3
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


def stretch(obj, a, b, radius):
    a, b = Vector(a), Vector(b)
    d = b - a
    obj.location = (a + b) / 2
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    obj.scale = (radius, radius, max(d.length, 1e-4) / 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=480)
    ap.add_argument("--samples", type=int, default=20)
    ap.add_argument("--frames", type=int, default=0, help="limit frames (debug)")
    ap.add_argument("--stride", type=int, default=1)
    args = ap.parse_args()

    clips = solve_all()
    frames = timeline(clips)
    if args.frames:
        frames = frames[: args.frames]
    frames = frames[:: args.stride]

    bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "model", "LunarBow.blend"))
    sc = bpy.context.scene
    for o in list(sc.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o)
    bow_objs = [bpy.data.objects[n] for n in ("Limbs", "Armor", "Grip", "Crystals", "Aura")]
    arrow_obj = bpy.data.objects["LunarArrow"]
    bow_root = bpy.data.objects.new("BowRoot", None)
    sc.collection.objects.link(bow_root)
    for o in bow_objs:
        o.parent = bow_root
    arrow_root = bpy.data.objects.new("ArrowRoot", None)
    sc.collection.objects.link(arrow_root)
    arrow_obj.parent = arrow_root
    flying_root = bpy.data.objects.new("FlyRoot", None)
    sc.collection.objects.link(flying_root)
    fly = arrow_obj.copy()
    sc.collection.objects.link(fly)
    fly.parent = flying_root

    # character
    parts = {}
    for name, size in r15.SIZES.items():
        if name == "HumanoidRootPart":
            continue
        key = next((k for k in ("UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot") if k in name), name)
        col = PALETTE.get(key, PALETTE.get("Arm"))
        parts[name] = make_box(name, size, material("M_" + name, col, rough=0.55))
    # simple anime hair tuft on the head
    hair = make_box("Hair", (1.3, 0.45, 1.3), material("M_Hair", (0.85, 0.9, 1.0), rough=0.4))
    hair.parent = parts["Head"]
    hair.location = (0, 0.05, 0.62)
    eye_mat = material("M_Eye", (0.02, 0.15, 0.35), rough=0.2, emit=0.6)
    for x in (-0.24, 0.24):
        eye = make_box("Eye", (0.16, 0.26, 0.05), eye_mat)
        eye.modifiers.clear()
        eye.parent = parts["Head"]
        eye.location = (x, 0.61, 0.02)  # Roblox front (-Z) is Blender +Y

    # string & ground
    string_mat = material("M_String", (0.35, 0.85, 1.0), emit=14)
    strings = []
    for i in range(2):
        bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, vertices=8)
        s = bpy.context.object
        s.data.materials.append(string_mat)
        strings.append(s)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -3))
    ground = bpy.context.object
    ground.data.materials.append(material("M_Ground", (0.03, 0.04, 0.07), rough=0.35, metal=0.2))

    # lights, world, camera
    def area(name, loc, energy, color, size):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.color, ld.size = energy, color, size
        o = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

    area("Key", (-6, 7, 8), 2200, (0.85, 0.9, 1.0), 5)
    area("Rim", (6, -8, 4), 2200, (0.35, 0.6, 1.0), 4)
    area("Fill", (-8, -2, 2), 600, (0.6, 0.7, 1.0), 6)
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = args.samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = args.size
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    world = sc.world or bpy.data.worlds.new("W")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.006, 0.01, 0.028, 1)
    sc.use_nodes = True
    tree = sc.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "MEDIUM"
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], comp.inputs["Image"])
    cd = bpy.data.cameras.new("Cam")
    cd.lens = 48
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    pts = {k: np.array(v) for k, v in bowgeo.attachments().items()}
    aura_mix = bpy.data.materials["Aura"].node_tree.nodes.get("Mix Shader")
    arrow_len = 2.55
    jump = None
    fly_state = None
    last_arrow = None
    cam_target = np.zeros(3)
    from PIL import Image

    images = []
    for fi, (name, t, lower, lw, tg) in enumerate(frames):
        a, solved = clips[name]
        tr = {j: np.eye(4) for j in r15.ORDER}
        if lower and lw > 0:
            la, lsolved = clips[lower]
            lt = tg % lsolved[-1][0].time
            for j, m in export.sample(lsolved, la.joints, lt).items():
                tr[j] = blend(np.eye(4), m, lw)
        tr.update(export.sample(solved, a.joints, t))
        world = r15.fk(tr)

        # special jump arc (root motion is physics in game)
        off = np.zeros(3)
        if name == "Special" and 0.22 <= t <= 1.08:
            x = (t - 0.22) / 0.86
            off = np.array([0, 4 * 5.0 * x * (1 - x), 7.0 * x])
            jump = off
        elif name == "Special" and t > 1.08:
            off = np.array([0, 0, 7.0])
        elif jump is not None and name == "Hold" and fi > 0:
            off = np.array([0, 0, 7.0])
        shift = np.eye(4)
        shift[:3, 3] = off

        for pname, obj in parts.items():
            obj.matrix_world = to_bl(shift @ world[pname])
        bow_m = shift @ world["BowHandle"]
        bow_root.matrix_world = to_bl(bow_m)

        def bw(p):
            return (bow_m @ np.append(p, 1))[:3]

        hooked_rng = HOOKED.get(name)
        hooked = hooked_rng is not None and hooked_rng[0] <= t < hooked_rng[1]
        top, bot = bw(pts["StringTop"]), bw(pts["StringBottom"])
        if hooked:
            nock = (shift @ world["RightHand"] @ np.append(r15.RIGHT_PINCH, 1))[:3]
        else:
            nock = bw(pts["StringRest"])
        stretch(strings[0], (C[:3, :3] @ top), (C[:3, :3] @ nock), 0.013)
        stretch(strings[1], (C[:3, :3] @ nock), (C[:3, :3] @ bot), 0.013)

        rest = bw(pts["ArrowRest"])
        d = rest - nock
        if hooked and np.linalg.norm(d) > 0.1:
            d = d / np.linalg.norm(d)
            m = np.eye(4)
            z = -d
            x = np.cross([0, 1, 0], z)
            x /= np.linalg.norm(x)
            y = np.cross(z, x)
            m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, nock
            arrow_root.matrix_world = to_bl(m)
            arrow_obj.hide_render = False
            last_arrow = (m.copy(), d)
        else:
            if arrow_obj.hide_render is False and last_arrow is not None:
                fly_state = [last_arrow[0].copy(), last_arrow[1], 0]
            arrow_obj.hide_render = True
        if fly_state is not None:
            m0, d0, k = fly_state
            m1 = m0.copy()
            m1[:3, 3] += d0 * (k + 1) * 3.2
            flying_root.matrix_world = to_bl(m1)
            fly.hide_render = False
            fly_state[2] += 1
            if fly_state[2] > 8:
                fly_state = None
        else:
            fly.hide_render = True

        if aura_mix is not None:
            charge = 0.0
            if name == "Aim":
                charge = min(1.0, t / 0.9)
            aura_mix.inputs["Fac"].default_value = 0.12 + 0.35 * charge

        # camera: front-left three-quarter, following the root smoothly
        root_pos = off + np.array([0, -0.6, 0])
        cam_target = root_pos if fi == 0 else cam_target + (root_pos - cam_target) * 0.3
        eye = cam_target + np.array([-8.5, 2.2, -9.0])
        cam.location = Vector(C[:3, :3] @ eye)
        look = Vector(C[:3, :3] @ cam_target) - cam.location
        cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()

        path = os.path.join(OUT, f"_sc_{fi:04d}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        images.append(Image.open(path).convert("RGB"))
        os.remove(path)
        print(f"frame {fi + 1}/{len(frames)} {name} t={t:.2f}", flush=True)

    pal = [im.quantize(colors=192, method=Image.Quantize.MEDIANCUT) for im in images]
    pal[0].save(os.path.join(OUT, "showcase.gif"), save_all=True, append_images=pal[1:],
                duration=int(1000 / FPS * args.stride), loop=0, optimize=True)
    images[len(images) // 3].save(os.path.join(OUT, "showcase_still.png"))
    print("showcase ->", os.path.join(OUT, "showcase.gif"))


if __name__ == "__main__":
    main()
