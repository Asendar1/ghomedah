# ghomedah map builder — the facility, assembled from KayKit Dungeon Pack 1.0.
# Run headless:  blender -b -P map/build-map.py
#
#   The plan is ONE rect table + ONE door table. Floors fill each rect's inner
#   face; walls are DERIVED from the union of rect edges (minus door spans), so
#   floors and walls can never disagree. Doorways are 4 m or 8 m gaps exactly on
#   the 4 m module grid — matching the reference map's "doors are gaps" style.
#
# Contract for the game side: wall* = collision rects, cabinet_* = searchables
# (+ "door" children swing on search), everything else = decoration.
import bpy
import math

PACK = "C:/Users/Asendar1/Downloads/kaykit_dungeon_pack_1.0/Models/gltf"
REPO = "G:/dev/ghomedah"
OUT_GLB = f"{REPO}/client/public/models/props/office.glb"
OUT_BLEND = f"{REPO}/map/ghomedah-map.blend"
OUT_PREVIEW = f"{REPO}/map/preview.png"
M = 4.0      # module metres
INSET = 0.75  # wall half-thickness: floors stop at the wall's inner face
OFF = (2.0, 4.0)  # recentre: plan coords minus this land the map on the origin

bpy.ops.wm.read_factory_settings(use_empty=True)
SCN = bpy.context.scene
COL = SCN.collection
TPL_COL = bpy.data.collections.new("templates")
SCN.collection.children.link(TPL_COL)

# ---------------------------------------------------------------- templates
_tpl = {}
def tpl(name):
    if name not in _tpl:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f"{PACK}/{name}.gltf.glb")
        new = [o for o in bpy.data.objects if o not in before]
        root = next(o for o in new if o.parent is None)
        root.name = "TPL_" + name
        for o in new:
            if o.name not in TPL_COL.objects:
                TPL_COL.objects.link(o)
            if o.name in COL.objects:
                COL.objects.unlink(o)
        _tpl[name] = root
    return _tpl[name]

PLACED = []
def put(name, x, z, rot=0, scale=1.0, obj_name=None, parent=None):
    """x/z are PLAN coords (z south); recentre + blender y = -z."""
    t = tpl(name)
    o = t.copy()
    o.data = t.data
    COL.objects.link(o)
    o.location = (x - OFF[0], -(z - OFF[1]), 0)
    o.rotation_euler = (0, 0, math.radians(rot))
    if scale != 1.0:
        o.scale = (scale, scale, scale)
    if obj_name:
        o.name = obj_name
    else:
        o.name = name  # keep the piece's own name ("wall", "wall.001", ...)
    if parent:
        o.parent = parent
    PLACED.append(o)
    return o

TILE_K = 4.0 / 4.05  # tiles authored 4.05 for the 4.0 grid — land them exact

# ================================================================ THE PLAN
# rects: (x0, z0, x1, z1) on the 4 m grid, centreline coordinates.
RECTS = {
    "lab":        (-28, -28, -8, -4),
    "labcorr":    (-8, -28, -4, -12),
    "office":     (-4, -28, 8, -12),
    "officecorr": (-8, -12, 8, -4),
    "storage":    (8, -28, 32, -4),
    "assembly":   (-12, -4, 16, 20),
    "q_r1c1":     (-28, 8, -20, 16),
    "q_r1c2":     (-20, 8, -12, 16),
    "q_r2c1":     (-28, 16, -20, 28),
    "q_r2c2":     (-20, 16, -12, 28),
    "q_r3c1":     (-28, 28, -20, 36),
    "q_r3c2":     (-20, 28, -12, 36),
    "vault":      (-4, 20, 32, 36),
}
# doors: (axis, fixed-coord, from, to) — span on the shared edge line
DOORS = [
    ("x", -8, -24, -16),   # lab <-> labcorr
    ("z", -12, -8, -4),    # labcorr <-> officecorr
    ("z", -12, 0, 4),      # office <-> officecorr
    ("x", 8, -24, -16),    # office <-> storage
    ("z", -4, -4, 4),      # officecorr <-> assembly
    ("z", -4, -12, -8),    # lab <-> assembly
    ("z", -4, 8, 12),      # storage <-> assembly
    ("x", -12, 8, 12),     # assembly <-> quarters r1c2
    ("x", -20, 8, 12),     # r1c1 <-> r1c2
    ("x", -20, 16, 20),    # r2c1 <-> r2c2
    ("x", -20, 28, 32),    # r3c1 <-> r3c2
    ("z", 16, -20, -16),   # r1c2 <-> r2c2
    ("z", 28, -20, -16),   # r2c2 <-> r3c2
    ("z", 20, 0, 8),       # assembly <-> vault
]

# ---------------------------------------------------------------- floors
for x0, z0, x1, z1 in RECTS.values():
    nx = max(1, round((x1 - x0 - 2 * INSET) / M))
    nz = max(1, round((z1 - z0 - 2 * INSET) / M))
    for i in range(nx):
        for j in range(nz):
            put("tileBrickA_medium",
                x0 + INSET + M * (i + 0.5), z0 + INSET + M * (j + 0.5), scale=TILE_K)

# ---------------------------------------------------------------- walls
# every rect edge becomes a wall run on its centreline; door spans and modules
# that sit strictly inside another rect (shared edges double up) are skipped.
def in_any_rect(x, z, skip_name):
    for name, (x0, z0, x1, z1) in RECTS.items():
        if name == skip_name:
            continue
        if x0 + 0.01 < x < x1 - 0.01 and z0 + 0.01 < z < z1 - 0.01:
            return True
    return False

def door_at(axis, coord, s):
    for a, c, f, t in DOORS:
        if a == axis and abs(c - coord) < 0.01 and s < t and s + M > f:
            return True
    return False

done = set()
for name, (x0, z0, x1, z1) in RECTS.items():
    edges = [
        ("z", z0, x0, x1, 0),    # north run along x
        ("z", z1, x0, x1, 0),    # south run
        ("x", x0, z0, z1, 90),   # west run along z
        ("x", x1, z0, z1, 90),   # east run
    ]
    for axis, coord, lo, hi, rot in edges:
        n = round((hi - lo) / M)
        for i in range(n):
            s = lo + i * M
            mid = s + M / 2
            key = (axis, round(coord, 2), round(s, 2))
            if key in done:
                continue
            done.add(key)
            if door_at(axis, coord, s):
                continue
            if axis == "z":
                if in_any_rect(mid, coord, name):
                    continue
                put("wall", mid, coord, rot=0)
            else:
                if in_any_rect(coord, mid, name):
                    continue
                put("wall", coord, mid, rot=90)

# ---------------------------------------------------------------- chests
def chest(x, z, tier="common"):
    i = sum(1 for o in PLACED if o.name.startswith("cabinet_")) + 1
    c = put(f"chest_{tier}", x, z, obj_name=f"cabinet_{i}")
    lid = put(f"chestTop_{tier}", x, z, obj_name="door", parent=c)
    bpy.context.view_layer.update()
    # a raw parent reinterprets the child's transform as parent-relative and
    # would double the chest's offset onto the lid — cancel it
    lid.matrix_parent_inverse = c.matrix_world.inverted()
    # the lid piece is authored with its origin ON the hinge (its mesh runs
    # 1.12 m forward of it); the chest's back rim is 0.55 m north of centre,
    # 0.97 up — no origin games, no rotation
    lid.location = (x - OFF[0], -(z - OFF[1]) + 0.55, 0.97)
    print(f"DBG {c.name}: chest {(*c.matrix_world.translation,)}  door {(*lid.matrix_world.translation,)}")
    return c

# ---------------------------------------------------------------- dressing
# lab: tables, vats, shelves, chest
put("tableLarge", -24, -16)
put("tableLarge", -18, -12)
put("tableMedium", -25, -8, rot=90)
put("bookcase", -26.6, -24, rot=90)
put("bookcase", -26.6, -18, rot=90)
put("potA_decorated", -24, -25)
put("potB_decorated", -12, -25)
put("potionLarge_green", -22, -20)
put("potionLarge_green", -18, -20)
put("potionMedium_green", -20, -22)
put("bucket", -14, -25)
put("barrelDark", -10, -22)
put("barrelDark", -10, -19)
chest(-15, -6, "common")

# office
put("tableSmall", -1, -19)
put("chair", -1, -17, rot=180)
put("bookcase", 6.5, -26, rot=0)
put("barrel", 2, -26)
chest(1, -14, "common")

# storage hall: crate rows + barrels + sacks
for cx in (14, 18, 22, 26):
    for cz in (-24, -20, -16):
        put("crate", cx, cz)
for cz in (-24, -20, -16, -12):
    put("barrel", 30, cz)
    put("barrelDark", 30.6, cz - 1)
put("lootSackA", 16, -8)
put("lootSackB", 18, -8)
put("crateDark", 24, -8)
put("cratePlatform_large", 14, -12)
chest(20, -10, "uncommon")
chest(28, -22, "rare")

# assembly hub: platform, pillars, scaffolds
put("cratePlatform_large", -4, 8)
put("cratePlatform_medium", 2, 14)
put("pillar", -10.5, 2)
put("pillar", 14.5, 2)
put("pillar", -10.5, 18)
put("pillar", 14.5, 18)
put("scaffold_medium", 10, 14)
put("tableLarge", 0, 2)
put("barrel", -8, 16)
put("barrel", -8, 12)
put("crate", 12, 18)
put("crate", 10, 18)
put("lootSackA", -10, 10)
chest(-10, 6, "common")
chest(6, 2, "rare")

# quarters: benches + tables per room
put("bench", -26, 12)
put("tableSmall", -25, 10)
put("bench", -18, 10)
put("bench", -15, 10)
put("tableMedium", -14, 14)
put("bench", -26, 20)
put("tableSmall", -25, 26)
put("stool", -26.5, 22)
put("bench", -18, 20)
put("bench", -18, 24)
put("tableMedium", -15, 26)
put("bench", -26, 30)
put("tableSmall", -25, 34)
put("bench", -18, 30)
put("bench", -15, 33)
put("stool", -16, 34.5)
put("mug", -25.5, 10.5)
put("mug", -18.5, 10.5)
chest(-24, 10, "common")
chest(-16, 21, "uncommon")

# vault: broken pillars, cage scaffolds, dark crates, trapdoor
put("pillar_broken", 4, 24)
put("pillar_broken", 16, 28)
put("scaffold_small_high_railing", 8, 30)
put("scaffold_small_high_railing", 12, 30)
put("crateDark", 24, 24)
put("crateDark", 26, 24)
put("crateDark", 24, 26)
put("lootSackA", 28, 30)
put("trapdoor", 2, 34)
put("barrelDark", 30, 34)
chest(18, 23, "uncommon")
chest(24, 32, "rare")

# torches on wall inner faces (visual dressing for the lit phases)
for tx, tz, rot in [
    (-27.2, -20, 90), (-27.2, -10, 90), (-15, -27.2, 0), (2, -27.2, 0),
    (20, -27.2, 0), (30.5, -6, 270), (-18, -6.2, 180), (-11.2, 4, 90),
    (15.2, 4, 270), (-27.2, 12, 90), (-27.2, 32, 90), (-10, 19.2, 180),
    (2, 35.2, 0), (28, 35.2, 0), (9, -11.2, 180),
]:
    put("torchWall", tx, tz, rot=rot)

print(f"placed {len(PLACED)} objects")

# ================================================================ outputs
for o in TPL_COL.objects:
    o.hide_viewport = True
    o.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, check_existing=False)

# preview render: straight-down ortho over everything placed
xs = [o.location.x for o in PLACED]
zs = [-o.location.y for o in PLACED]
cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
span = max(max(xs) - min(xs), max(zs) - min(zs)) + 8
cam_data = bpy.data.cameras.new("preview_cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = span
cam = bpy.data.objects.new("preview_cam", cam_data)
COL.objects.link(cam)
cam.location = (cx, cz, 80)
cam.rotation_euler = (0, 0, 0)
SCN.camera = cam
SCN.render.engine = "BLENDER_WORKBENCH"
SCN.display.shading.light = "STUDIO"
SCN.display.shading.color_type = "MATERIAL"
SCN.render.resolution_x = 1400
SCN.render.resolution_y = 1400
SCN.render.filepath = OUT_PREVIEW
bpy.ops.render.render(write_still=True)

# closeup: cabinet_5 from two angles — 45° and straight down — to check the
# lid sits on the chest and the hinge is on the back rim
from mathutils import Vector
for tag, off, ortho in (("closeup", (2.6, -2.6, 3.4), False), ("closeup-top", (0, 0, 6), True)):
    cam2d = bpy.data.cameras.new(tag)
    if ortho:
        cam2d.type = "ORTHO"
        cam2d.ortho_scale = 4.0
    cam2 = bpy.data.objects.new(tag, cam2d)
    COL.objects.link(cam2)
    target = Vector((-10 - OFF[0], -(6 - OFF[1]), 0.5))
    cam2.location = target + Vector(off)
    cam2.rotation_euler = (target - cam2.location).to_track_quat("-Z", "Y").to_euler()
    SCN.camera = cam2
    SCN.render.filepath = f"{REPO}/map/preview-{tag}.png"
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam2, do_unlink=True)

for o in list(TPL_COL.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.data.objects.remove(cam, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_visible=True)
print("DONE: blend + glb + preview written")
