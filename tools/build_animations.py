"""Solve the authored key poses and export the Lunar Bow animations.

Outputs
  animations/LunarBow_<Name>.rbxmx                    KeyframeSequences (import/publish in Studio)
  roblox/src/LunarBowShared/BowAnimationData.luau     same data for the built-in player
  animations/previews/<Name>.gif                      quick software-rendered previews

Run from the repository root:  python3 tools/build_animations.py [--no-gif]
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from animlib import anims, export, poses, preview, r15  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "animations")
LUA = os.path.join(ROOT, "roblox", "src", "LunarBowShared", "BowAnimationData.luau")

# when the string is hooked by the right hand (preview only; the game uses markers)
STRING_FOLLOW = {
    "Draw": (0.13, 99), "Aim": (0, 99), "Special": (0.62, 0.84),
}
# vertical root motion for the Special preview (the game drives a real jump arc)
JUMP = (0.22, 1.08, 3.5)


def solve_anim(anim):
    solved = []
    worst = 0.0
    for key in anim.keys:
        tr, _, rep = poses.solve(key.pose)
        for j in r15.ORDER:
            tr.setdefault(j, np.eye(4))
        solved.append((key, tr))
        if rep:
            worst = max(worst, max(rep.values()))
    return solved, worst


def gif(anim, solved, path, fps=30):
    from PIL import Image

    length = solved[-1][0].time
    n = max(2, int(round(length * fps)) + 1)
    cams = [preview.Camera(145, 8, 16, target=(0, -0.2, 0), size=340),
            preview.Camera(90, 4, 16, target=(0, -0.2, 0), size=340)]
    frames = []
    for i in range(n):
        t = min(length, i / fps)
        tr = export.sample(solved, anim.joints, t)
        world = r15.fk(tr)
        nock = None
        follow = STRING_FOLLOW.get(anim.name)
        if follow and follow[0] <= t < follow[1]:
            nock = r15.point(world, "RightHand", r15.RIGHT_PINCH)
        off = (0, 0, 0)
        if anim.name == "Special" and JUMP[0] <= t <= JUMP[1]:
            x = (t - JUMP[0]) / (JUMP[1] - JUMP[0])
            off = (0, 4 * JUMP[2] * x * (1 - x), 0)
        tiles = [preview.render_pose(world, c, nock, title=f"{anim.name}  {t:0.2f}s" if c is cams[0] else None,
                                     arrow=nock is not None, root_offset=off) for c in cams]
        frame = Image.new("RGB", (680, 340))
        frame.paste(tiles[0], (0, 0))
        frame.paste(tiles[1], (340, 0))
        frames.append(frame.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    hold = [frames[-1]] * int(0.4 * fps) if not anim.loop else []
    frames[0].save(path, save_all=True, append_images=frames[1:] + hold, duration=int(1000 / fps), loop=0,
                   optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-gif", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    os.makedirs(os.path.join(OUT, "previews"), exist_ok=True)
    os.makedirs(os.path.dirname(LUA), exist_ok=True)
    entries = []
    for anim in anims.build_all():
        solved, worst = solve_anim(anim)
        entries.append((anim, solved))
        with open(os.path.join(OUT, f"LunarBow_{anim.name}.rbxmx"), "w") as f:
            f.write(export.to_rbxmx(anim, solved))
        print(f"{anim.name:13s} {len(anim.keys):2d} keys  {solved[-1][0].time:.2f}s  "
              f"priority={anim.priority:9s} loop={anim.loop}  max IK error={worst:.3f}")
        if not args.no_gif and (not args.only or anim.name in args.only.split(",")):
            gif(anim, solved, os.path.join(OUT, "previews", f"{anim.name}.gif"))
    with open(LUA, "w") as f:
        f.write(export.to_luau(entries))
    print("luau ->", LUA)


if __name__ == "__main__":
    main()
