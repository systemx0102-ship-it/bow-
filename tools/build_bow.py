"""Build the Lunar Bow model: meshes, PBR textures, exports and preview renders.

Run from the repository root:
    python3 tools/build_bow.py            # meshes + textures + exports + previews
    python3 tools/build_bow.py --no-render

Requires: bpy==4.5.4 numpy pillow scipy  (see tools/requirements.txt)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from bowlib import bow, textures  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL = os.path.join(ROOT, "model")
TEX = os.path.join(MODEL, "textures")
PREV = os.path.join(MODEL, "previews")
LUA_OUT = os.path.join(ROOT, "roblox", "src", "LunarBowShared", "BowLayout.luau")

SMOOTH_ANGLE = {"Limbs": 42, "Armor": 35, "Grip": 50, "Crystals": 1, "Aura": 80, "LunarArrow": 20}


# ---------------------------------------------------------------------------
# Blender helpers
# ---------------------------------------------------------------------------
def to_blender(V):
    """Roblox space (Y up, -Z forward) -> Blender space (Z up, +Y forward)."""
    V = np.asarray(V)
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=-1)


def make_object(name, mesh, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(to_blender(mesh.V).tolist(), [], [list(f) for f in mesh.F])
    uv = me.uv_layers.new(name="UVMap")
    flat = [c for face in mesh.UV for corner in face for c in corner]
    uv.data.foreach_set("uv", flat)
    me.validate(clean_customdata=False)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(SMOOTH_ANGLE.get(name, 40)))
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def image_node(nodes, path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    n = nodes.new("ShaderNodeTexImage")
    n.image = img
    return n


def pbr_material(name, tex_paths):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    col = image_node(nodes, tex_paths["ColorMap"], False)
    rough = image_node(nodes, tex_paths["RoughnessMap"], True)
    metal = image_node(nodes, tex_paths["MetalnessMap"], True)
    nrm = image_node(nodes, tex_paths["NormalMap"], True)
    nmap = nodes.new("ShaderNodeNormalMap")
    links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(metal.outputs["Color"], bsdf.inputs["Metallic"])
    links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def aura_material(name, color, strength, alpha):
    """Additive-looking translucent glow (stand-in for Roblox's ForceField material)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        if n.type != "OUTPUT_MATERIAL":
            nodes.remove(n)
    out = nodes["Material Output"]
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1.0)
    em.inputs["Strength"].default_value = strength
    tr = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = alpha
    links.new(tr.outputs[0], mix.inputs[1])
    links.new(em.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def glow_material(name, color, strength, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.1
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else None
    return mat


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def build_textures():
    os.makedirs(TEX, exist_ok=True)
    print("textures: body")
    body = textures.write_set("Body", textures.dragon_steel(), TEX)
    print("textures: armor")
    armor = textures.write_set("Armor", textures.engraved_gold(), TEX)
    print("textures: grip")
    grip = textures.write_set("Grip", textures.leather_wrap(), TEX)
    return {"Body": body, "Armor": armor, "Grip": grip}


def write_layout(parts, arrow):
    layout = {"parts": {}, "attachments": bow.attachments()}
    for name, m in list(parts.items()) + [("LunarArrow", arrow)]:
        lo, hi = m.bounds()
        layout["parts"][name] = {
            "center": [round(float(x), 5) for x in (lo + hi) / 2],
            "size": [round(float(x), 5) for x in (hi - lo)],
            "triangles": m.tri_count(),
        }
    os.makedirs(os.path.dirname(LUA_OUT), exist_ok=True)

    def v3(v):
        return f"Vector3.new({v[0]:.5f}, {v[1]:.5f}, {v[2]:.5f})"

    lines = [
        "--!strict",
        "-- AUTO-GENERATED by tools/build_bow.py. Do not edit by hand.",
        "-- Geometry layout of the Lunar Bow in bow space (studs, origin = hand grip).",
        "-- +Y = upper tip, +Z = string side (toward the archer), +X = lateral.",
        "",
        "local BowLayout = {}",
        "",
        "-- Bounding-box centre/size of every imported MeshPart (a MeshPart's pivot is its box centre).",
        "BowLayout.Parts = {",
    ]
    for name, p in layout["parts"].items():
        lines.append(f"\t{name} = {{ Center = {v3(p['center'])}, Size = {v3(p['size'])} }},")
    lines += ["}", "", "-- Named points used for the string, trails, lights and arrow.", "BowLayout.Points = {"]
    for name, p in layout["attachments"].items():
        lines.append(f"\t{name} = {v3(p)},")
    d = np.linspace(-bow.HALF + 0.02, bow.HALF - 0.02, 23)
    P, _, _, _ = bow.frame_at(d)
    radius = (bow.half_width(np.abs(d)) + bow.half_thick(np.abs(d))) / 2 * bow.SCALE
    lines += ["}", "", "-- Limb centreline (used to build a primitive placeholder before the meshes are imported).",
              "BowLayout.Centerline = {"]
    for p_, r_ in zip(P * bow.SCALE, radius):
        lines.append(f"\t{{ Position = {v3(p_)}, Radius = {r_:.4f} }},")
    lines += [
        "}",
        "",
        "-- Arrow mesh: its tail (nock) sits this far behind the box centre along +Z.",
        f"BowLayout.ArrowLength = {layout['parts']['LunarArrow']['size'][2]:.5f}",
        f"BowLayout.ArrowTailOffset = {layout['parts']['LunarArrow']['center'][2]:.5f}",
        "",
        "return BowLayout",
        "",
    ]
    with open(LUA_OUT, "w") as f:
        f.write("\n".join(lines))
    with open(os.path.join(MODEL, "layout.json"), "w") as f:
        json.dump(layout, f, indent=2)
    print("layout ->", LUA_OUT)
    return layout


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    return sc


def export_selection(objs, basename):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    base = os.path.join(MODEL, basename)
    bpy.ops.export_scene.fbx(
        filepath=base + ".fbx",
        use_selection=True,
        object_types={"MESH"},
        axis_forward="-Z",
        axis_up="Y",
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        mesh_smooth_type="OFF",
        use_mesh_modifiers=True,
        path_mode="STRIP",
        embed_textures=False,
        bake_anim=False,
    )
    bpy.ops.wm.obj_export(
        filepath=base + ".obj",
        export_selected_objects=True,
        forward_axis="NEGATIVE_Z",
        up_axis="Y",
        export_materials=True,
        path_mode="RELATIVE",
        export_triangulated_mesh=True,
        export_normals=True,
        export_uv=True,
    )
    bpy.ops.export_scene.gltf(
        filepath=base + ".glb",
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=90,
        export_apply=True,
    )
    print("exported", base)


# ---------------------------------------------------------------------------
# preview rendering (Cycles, CPU)
# ---------------------------------------------------------------------------
def setup_render(sc, w, h, samples):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    world = bpy.data.worlds.new("Night") if sc.world is None else sc.world
    sc.world = world
    world.use_nodes = True
    wn = world.node_tree.nodes
    bg = wn["Background"]
    grad = wn.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    ramp = wn.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.004, 0.008, 0.025, 1)
    ramp.color_ramp.elements[1].color = (0.03, 0.07, 0.16, 1)
    coord = wn.new("ShaderNodeTexCoord")
    world.node_tree.links.new(coord.outputs["Generated"], grad.inputs["Vector"])
    world.node_tree.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    world.node_tree.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0

    sc.use_nodes = True
    tree = sc.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    try:
        glare.threshold = 1.2
        glare.size = 8
    except Exception:
        pass
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], comp.inputs["Image"])


def add_lights():
    def area(name, loc, energy, color, size):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.color = color
        ld.size = size
        o = bpy.data.objects.new(name, ld)
        bpy.context.scene.collection.objects.link(o)
        o.location = loc
        d = Vector((0, 0, 0)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return o

    area("Key", (6, -5, 5), 1400, (1.0, 0.95, 0.9), 4)
    area("Rim", (-5, 6, 2), 1600, (0.45, 0.7, 1.0), 3)
    area("Fill", (5, 3, -3), 500, (0.6, 0.75, 1.0), 5)
    area("Top", (0, 0, 8), 500, (0.9, 0.95, 1.0), 6)


def add_camera(loc, target, ortho=None, lens=50):
    cd = bpy.data.cameras.new("Cam")
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    cd.lens = lens
    cam = bpy.data.objects.new("Cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("render ->", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--turntable", type=int, default=36)
    ap.add_argument("--views", default="side,threequarter,tip,grip,arrow")
    args = ap.parse_args()

    os.makedirs(PREV, exist_ok=True)
    tex = build_textures()
    parts = bow.build_all()
    arrow = bow.build_arrow()
    for name, m in list(parts.items()) + [("LunarArrow", arrow)]:
        print(f"{name:10s} {m.tri_count():6d} tris")
        assert m.tri_count() < 20000, f"{name} exceeds the Roblox 20k triangle limit"
    write_layout(parts, arrow)

    sc = reset_scene()
    mats = {
        "Limbs": pbr_material("Body", tex["Body"]),
        "Armor": pbr_material("Armor", tex["Armor"]),
        "Grip": pbr_material("Grip", tex["Grip"]),
        "Crystals": glow_material("Crystal", (0.25, 0.8, 1.0), 6.0),
        "Aura": aura_material("Aura", (0.15, 0.55, 1.0), 3.0, alpha=0.12),
    }
    objs = {name: make_object(name, m, mats[name]) for name, m in parts.items()}
    arrow_obj = make_object("LunarArrow", arrow, glow_material("ArrowGlow", (0.35, 0.85, 1.0), 2.5))

    export_selection([objs[k] for k in ("Limbs", "Armor", "Grip", "Crystals", "Aura")], "LunarBow")  # noqa
    export_selection([arrow_obj], "LunarArrow")

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL, "LunarBow.blend"), compress=True)

    if args.no_render:
        return

    add_lights()
    arrow_obj.hide_render = True
    # preview-only string (in Roblox the string is a pair of glowing Beams)
    pts = bow.attachments()
    top, bot = Vector(to_blender(np.array([pts["StringTop"]]))[0]), Vector(to_blender(np.array([pts["StringBottom"]]))[0])
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=(top - bot).length, location=(top + bot) / 2, vertices=8)
    string = bpy.context.object
    string.data.materials.append(glow_material("StringGlow", (0.3, 0.85, 1.0), 12.0))
    objs["_String"] = string
    views = set(args.views.split(","))
    if "side" in views:  # side profile (like the concept art): string on the left
        setup_render(sc, 900, 1350, 96)
        add_camera((12, 0.05, 0.0), (0, 0.05, 0.0), ortho=5.3)
        render(os.path.join(PREV, "bow_side.png"))
    if "threequarter" in views:  # three-quarter hero shot
        setup_render(sc, 1000, 1250, 96)
        add_camera((5.6, -5.6, 1.7), (0, -0.3, 0.05), lens=55)
        render(os.path.join(PREV, "bow_threequarter.png"))
    if "tip" in views:  # detail of the upper limb
        setup_render(sc, 1000, 1000, 96)
        add_camera((1.6, -1.3, 2.3), (0, 0.2, 1.65), lens=60)
        render(os.path.join(PREV, "bow_detail_tip.png"))
    if "grip" in views:  # grip / heart crystal detail from the target side
        setup_render(sc, 1000, 1000, 96)
        add_camera((1.2, 1.9, 0.6), (0, 0.15, 0.15), lens=60)
        render(os.path.join(PREV, "bow_detail_grip.png"))
    if "arrow" in views:
        arrow_obj.hide_render = False
        for o in objs.values():
            o.hide_render = True
        setup_render(sc, 1000, 500, 64)
        add_camera((1.9, 1.3, 1.1), (0, 1.3, 0.0), lens=24)
        render(os.path.join(PREV, "arrow.png"))
        arrow_obj.hide_render = True
        for o in objs.values():
            o.hide_render = False

    # 6) turntable frames -> GIF
    if args.turntable > 0:
        from PIL import Image

        setup_render(sc, 420, 560, 24)
        pivot = bpy.data.objects.new("Pivot", None)
        sc.collection.objects.link(pivot)
        for o in objs.values():
            o.parent = pivot
        add_camera((0, -9.5, 0.4), (0, 0, 0.05), lens=50)
        frames = []
        for i in range(args.turntable):
            pivot.rotation_euler = (0, 0, 2 * math.pi * i / args.turntable)
            p = os.path.join(PREV, f"_tt_{i:03d}.png")
            render(p)
            frames.append(Image.open(p).convert("RGB"))
            os.remove(p)
        pal = [f.quantize(colors=200, method=Image.Quantize.MEDIANCUT) for f in frames]
        pal[0].save(os.path.join(PREV, "bow_turntable.gif"), save_all=True, append_images=pal[1:],
                    duration=80, loop=0, optimize=True)


if __name__ == "__main__":
    main()
