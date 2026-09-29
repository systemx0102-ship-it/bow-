"""Anime-style bow animations for R15, authored as key poses.

Timing follows the classic principles: anticipation -> fast action (Out
easing) -> overshoot -> settle, with short "freeze" holds on the strongest
silhouettes (release, landing) to sell the impact.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import r15
from .poses import Pose, aim_nock, bow_dir, string_rest

# ---------------------------------------------------------------------------
# key poses
# ---------------------------------------------------------------------------
RELAXED_R = dict(shoulder=(4, 0, 7), elbow=14, wrist=(0, 0, 0))


def neutral():
    return Pose(larm=dict(shoulder=(0, 0, 0), elbow=0), rarm=dict(shoulder=(0, 0, 0), elbow=0))


def hold(breath=0.0, sway=0.0):
    up, string = bow_dir(42 + sway * 3, cant_deg=-6)
    return Pose(
        waist=(1.5 + breath, 7, 0),
        neck=(-3 - breath * 0.5, -5, 1),
        larm=dict(target=(-1.66, -0.66 + breath * 0.02, -0.42 - sway * 0.02), bow_up=up, bow_string=string,
                  pole=(-2.4, -0.1, 0.8), w_rot=3.0),
        rarm=dict(shoulder=(5 + breath, 0, 8), elbow=16 + breath * 2, wrist=(0, 0, 0)),
    )


def aim(draw_len=2.18, waist=(-4, -68, 2), neck=(-5, 63, 7), grip=(-0.36, 0.96, -2.62), cant=12,
        lift=0.0, pole_r=(1.45, 0.95, 1.05), bow_spin=(0, 0, 0)):
    up, string = bow_dir(0, cant_deg=cant)
    return Pose(
        waist=waist, neck=neck, bow=bow_spin,
        larm=dict(target=grip, bow_up=up, bow_string=string, pole=(-0.9, 0.2, -1.6), w_rot=4.0),
        rarm=dict(target=aim_nock(draw_len, lift), pole=pole_r, w_pole=0.8),
        draw=aim_nock(draw_len, lift),
    )


def nock_pose():
    """Bow raised in front, canted, right hand hooking the string (start of the draw)."""
    up, string = bow_dir(10, cant_deg=40, yaw_deg=-18)
    return Pose(
        waist=(2, -34, 0), neck=(4, 26, 3),
        larm=dict(target=(-0.45, 0.42, -1.75), bow_up=up, bow_string=string, pole=(-1.4, -0.3, -1.2), w_rot=4.0),
        rarm=dict(target=string_rest((0, 0, 0.05)), pole=(1.2, 0.0, -0.4), w_pole=0.5),
        draw=string_rest((0, 0, 0.05)),
    )


def release(extra=1.0, charged=False):
    """Follow-through right after the string is loosed."""
    p = aim(draw_len=2.18, waist=(-8 - 6 * charged, -74 - 4 * charged, 3), neck=(-9, 66, 9),
            grip=(-0.36, 0.93, -2.72 - 0.06 * charged), bow_spin=(-22 * extra, 0, 0))
    back = np.array([0.42, 0.16, 0.45]) * extra
    if charged:
        back = np.array([0.8, 0.55, 0.55])
    p.rarm = dict(target=lambda w, b=back: aim_nock(2.18)(w) + b, pole=(1.6, 1.2, 1.2), w_pole=0.8)
    p.draw = None
    return p


def present():
    """Equip flourish end: bow held out vertically at the side like the concept art."""
    up, string = bow_dir(-4, cant_deg=-4, yaw_deg=25)
    return Pose(
        waist=(-2, 16, -2), neck=(-4, 12, -6),
        larm=dict(target=(-2.05, 0.55, -1.35), bow_up=up, bow_string=string, pole=(-2.2, -0.4, 0.4), w_rot=4.0),
        rarm=dict(shoulder=(-6, 0, 22), elbow=24, wrist=(0, 0, -10)),
    )


# ---------------------------------------------------------------------------
# animation containers
# ---------------------------------------------------------------------------
@dataclass
class Key:
    time: float
    pose: Pose
    style: str = "CubicV2"      # Linear | Constant | CubicV2 | Elastic | Bounce
    direction: str = "Out"      # In | Out | InOut
    markers: list = field(default_factory=list)


@dataclass
class Anim:
    name: str
    priority: str
    loop: bool
    joints: list
    keys: list
    description: str = ""
    markers: list = field(default_factory=list)   # (time, name, value)


UPPER = r15.UPPER_BODY
UPPER_NO_BOW = [j for j in UPPER if j != "BowHandle"]
LOWER = r15.LOWER_BODY
FULL = UPPER + LOWER


def with_legs(p: Pose, legs: str):
    if legs == "stand":
        p.lleg = dict(hip=(0, 0, 0), knee=0, ankle=(0, 0, 0))
        p.rleg = dict(hip=(0, 0, 0), knee=0, ankle=(0, 0, 0))
    return p


def build_all():
    A = []

    # -- Hold (idle while equipped) -------------------------------------------
    A.append(Anim("Hold", "Movement", True, UPPER, [
        Key(0.0, hold(0.0, 0.0), "CubicV2", "InOut"),
        Key(1.6, hold(1.2, 1.0), "CubicV2", "InOut"),
        Key(3.2, hold(0.0, 0.0), "CubicV2", "InOut"),
    ], "Idle con el arco en la mano izquierda, respiración y balanceo sutil."))

    # -- Equip: summon + baton twirl + presentation ----------------------------
    def eq_sweep(spin):
        up, string = bow_dir(-20, cant_deg=-70, yaw_deg=60)
        return Pose(waist=(-4, 24, -4), neck=(-6, 14, -4), bow=(spin, 0, 0),
                    larm=dict(target=(-2.35, 0.95, -0.55), bow_up=up, bow_string=string, pole=(-1.8, -0.2, 1.0),
                              w_rot=1.5),
                    rarm=dict(shoulder=(-12, 0, 38), elbow=30, wrist=(0, 0, -20)))

    def eq_antic():
        up, string = bow_dir(150, cant_deg=10, yaw_deg=-20)
        return Pose(waist=(6, -22, 2), neck=(10, 14, 0),
                    larm=dict(target=(0.35, -0.55, -0.85), bow_up=up, bow_string=string, pole=(-0.6, -0.4, -1.5),
                              w_rot=1.0),
                    rarm=dict(shoulder=(10, 0, 18), elbow=35, wrist=(0, 0, 0)))

    pres = present()
    pres_os = present()
    pres_os.waist = (-3, 18, -3)
    pres_os.neck = (-5, 14, -8)
    A.append(Anim("Equip", "Action", False, UPPER, [
        Key(0.00, hold(), "CubicV2", "Out"),
        Key(0.14, eq_antic(), "CubicV2", "In", markers=[("Summon", "")]),
        Key(0.30, eq_sweep(0), "Linear", "InOut"),
        Key(0.38, eq_sweep(-90), "Linear", "InOut"),
        Key(0.46, eq_sweep(-180), "Linear", "InOut"),
        Key(0.55, eq_sweep(-270), "CubicV2", "Out"),
        Key(0.68, pres_os, "CubicV2", "Out", markers=[("Flourish", "")]),
        Key(0.82, pres, "CubicV2", "InOut"),
        Key(1.15, hold(), "CubicV2", "InOut"),
    ], "Invocación: el arco aparece, gira como bastón y se presenta."))

    # -- Draw: raise, nock, pull with overshoot ---------------------------------
    A.append(Anim("Draw", "Action", False, UPPER, [
        Key(0.00, hold(), "CubicV2", "Out"),
        Key(0.13, nock_pose(), "CubicV2", "Out", markers=[("Nock", "")]),
        Key(0.30, aim(draw_len=2.30, waist=(-6, -72, 3), neck=(-6, 66, 8)), "CubicV2", "InOut"),
        Key(0.45, aim(), "CubicV2", "InOut", markers=[("FullDraw", "")]),
    ], "Levanta el arco, engancha la cuerda y tensa hasta la mejilla."))

    # -- Aim: tension loop at full draw ----------------------------------------
    A.append(Anim("Aim", "Action", True, UPPER, [
        Key(0.0, aim(), "CubicV2", "InOut"),
        Key(1.0, aim(draw_len=2.21, waist=(-5, -68.5, 2), grip=(-0.36, 0.975, -2.62), neck=(-5.5, 63.5, 7)),
            "CubicV2", "InOut"),
        Key(2.0, aim(), "CubicV2", "InOut"),
    ], "Tensión sostenida con micro-temblor y respiración."))

    # -- AimStance: legs while standing still and aiming -------------------------
    def stance(sway=0.0):
        p = Pose(root_pos=(0, -0.24 - sway * 0.03, 0), root_rot=(0, -12, 0))
        p.lleg = dict(foot=(-0.95, -2.85, -0.72), yaw=-8, pole=(-1.2, -1.6, -2.0))
        p.rleg = dict(foot=(0.95, -2.85, 0.7), yaw=-62, pole=(1.4, -1.6, -0.6))
        return p

    A.append(Anim("AimStance", "Action", True, LOWER, [
        Key(0.0, stance(0), "CubicV2", "InOut"),
        Key(1.0, stance(1), "CubicV2", "InOut"),
        Key(2.0, stance(0), "CubicV2", "InOut"),
    ], "Postura de piernas abierta (solo cuando estás quieto apuntando)."))

    # -- Shoot ------------------------------------------------------------------
    A.append(Anim("Shoot", "Action2", False, UPPER, [
        Key(0.00, aim(), "CubicV2", "Out", markers=[("Release", "")]),
        Key(0.06, release(1.0), "CubicV2", "Out"),
        Key(0.24, release(1.15), "CubicV2", "InOut"),
        Key(0.62, hold(), "CubicV2", "InOut"),
    ], "Suelta: latigazo de la mano derecha, retroceso y follow-through."))

    # -- Charged shot ------------------------------------------------------------
    A.append(Anim("ShootCharged", "Action2", False, UPPER, [
        Key(0.00, aim(draw_len=2.32), "CubicV2", "Out", markers=[("Release", "charged")]),
        Key(0.07, release(1.0, charged=True), "CubicV2", "Out"),
        Key(0.34, release(1.1, charged=True), "CubicV2", "InOut"),
        Key(0.85, hold(), "CubicV2", "InOut"),
    ], "Disparo cargado: retroceso fuerte con pose congelada."))

    # -- Special: "Salto Lunar" (backflip, aerial shot, hero landing) -------------
    def sp_crouch():
        up, string = bow_dir(120, cant_deg=-10)
        p = Pose(root_pos=(0, -0.75, 0.15), root_rot=(-16, 0, 0), waist=(-8, 6, 0), neck=(12, 0, 0),
                 larm=dict(target=(-1.5, -0.95, 0.85), bow_up=up, bow_string=string, pole=(-2, 0, 0), w_rot=1.0),
                 rarm=dict(shoulder=(-40, 0, 12), elbow=20, wrist=(0, 0, 0)))
        p.lleg = dict(foot=(-0.55, -2.85, -0.45), yaw=4, pole=(-0.7, -1.5, -2.5))
        p.rleg = dict(foot=(0.55, -2.85, 0.35), yaw=-4, pole=(0.7, -1.5, -2.5))
        return p

    def sp_launch():
        up, string = bow_dir(-10, cant_deg=0)
        p = Pose(root_pos=(0, 0.35, 0), root_rot=(12, 0, 0), root_pivot=1.1, waist=(6, 0, 0), neck=(10, 0, 0),
                 larm=dict(target=(-1.35, 2.0, -0.25), bow_up=up, bow_string=string, pole=(-2.2, 1.0, 0.5), w_rot=1.0),
                 rarm=dict(shoulder=(165, 0, -12), elbow=10, wrist=(0, 0, 0)))
        p.lleg = dict(hip=(-6, 0, 0), knee=-8, ankle=(-20, 0, 0))
        p.rleg = dict(hip=(-14, 0, 0), knee=-14, ankle=(-25, 0, 0))
        return p

    def sp_tuck(angle):
        up, string = bow_dir(80, cant_deg=0)
        p = Pose(root_pos=(0, 0.3, 0), root_rot=(angle, 0, 0), root_pivot=1.1, waist=(-18, 0, 0), neck=(-12, 0, 0),
                 larm=dict(target=(-1.25, 0.1, -0.9), bow_up=up, bow_string=string, pole=(-2, 0, 0), w_rot=0.8),
                 rarm=dict(shoulder=(60, 0, 10), elbow=95, wrist=(0, 0, 0)))
        p.lleg = dict(hip=(105, 0, -4), knee=-125, ankle=(-10, 0, 0))
        p.rleg = dict(hip=(95, 0, 4), knee=-120, ankle=(-10, 0, 0))
        return p

    def sp_air_aim(draw_len, pitch=-24):
        p = aim(draw_len=draw_len, waist=(-2, -64, 4), neck=(-2, 60, 6), grip=(-0.3, 0.85, -2.6), cant=18)
        p.root_rot = (pitch, 0, 0)
        p.root_pivot = 1.1
        p.lleg = dict(hip=(70, 0, -6), knee=-80, ankle=(-15, 0, 0))
        p.rleg = dict(hip=(-35, 0, 8), knee=-70, ankle=(-30, 0, 0))
        return p

    def sp_air_release():
        p = release(1.3, charged=True)
        p.root_rot = (-14, 0, 0)
        p.root_pivot = 1.1
        p.lleg = dict(hip=(55, 0, -8), knee=-60, ankle=(-10, 0, 0))
        p.rleg = dict(hip=(-45, 0, 10), knee=-50, ankle=(-30, 0, 0))
        return p

    def sp_land():
        up, string = bow_dir(125, cant_deg=-20, yaw_deg=30)
        p = Pose(root_pos=(0, -1.15, 0.2), root_rot=(-22, -12, 0), waist=(-4, 18, -6), neck=(4, -8, 6),
                 larm=dict(target=(-2.45, -0.45, 0.45), bow_up=up, bow_string=string, pole=(-2.5, 0.5, 0.5),
                           w_rot=1.0),
                 rarm=dict(target=(0.95, -2.55, -1.0), local=np.array([0, -0.15, 0]), pole=(1.8, -1.0, 0.0)))
        p.lleg = dict(foot=(-0.65, -2.85, -1.05), yaw=-10, pole=(-0.9, -1.5, -3.0))
        p.rleg = dict(foot=(0.6, -2.85, 1.05), yaw=-10, foot_rot=(-60, -10, 0), pole=(0.8, -2.8, -1.2), w_rot=0.5)
        return p

    A.append(Anim("Special", "Action4", False, FULL, [
        Key(0.00, with_legs(hold(), "stand"), "CubicV2", "Out"),
        Key(0.14, sp_crouch(), "CubicV2", "In"),
        Key(0.22, sp_launch(), "Linear", "InOut", markers=[("Jump", "")]),
        Key(0.31, sp_tuck(100), "Linear", "InOut"),
        Key(0.40, sp_tuck(190), "Linear", "InOut"),
        Key(0.49, sp_tuck(280), "CubicV2", "Out"),
        Key(0.62, sp_air_aim(2.05, pitch=-16), "CubicV2", "Out", markers=[("Draw", "")]),
        Key(0.80, sp_air_aim(2.25, pitch=-24), "CubicV2", "Out"),
        Key(0.84, sp_air_aim(2.25, pitch=-24), "CubicV2", "Out", markers=[("Release", "special")]),
        Key(0.92, sp_air_release(), "CubicV2", "InOut"),
        Key(1.08, sp_land(), "CubicV2", "Out", markers=[("Land", "")]),
        Key(1.30, sp_land(), "CubicV2", "InOut"),
        Key(1.62, with_legs(hold(), "stand"), "CubicV2", "InOut"),
    ], "Salto Lunar: voltereta hacia atrás, disparo aéreo triple y aterrizaje de héroe."))

    # -- Unequip: flick the bow away (it dissolves into moonlight) ----------------
    up, string = bow_dir(-30, cant_deg=-20)
    flick = Pose(waist=(-4, 14, -2), neck=(-10, 8, -4),
                 larm=dict(target=(-1.9, 1.75, -0.9), rot=r15.euler(170, 10, 0), pole=(-2.5, 0.6, 0.4), w_rot=0.6),
                 rarm=dict(shoulder=(0, 0, 14), elbow=18, wrist=(0, 0, 0)))
    A.append(Anim("Unequip", "Action", False, UPPER_NO_BOW, [
        Key(0.00, hold(), "CubicV2", "Out"),
        Key(0.16, flick, "CubicV2", "InOut", markers=[("Dismiss", "")]),
        Key(0.26, flick, "CubicV2", "InOut"),
        Key(0.60, neutral(), "CubicV2", "InOut"),
    ], "Lanza el arco al aire y se disuelve en luz lunar."))
    return A
