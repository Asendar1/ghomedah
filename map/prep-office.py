# prep the downloaded office floor for the game:
#   - cut everything above the office storey
#   - floor to z=0, centred on origin
#   - join 1675 meshes into one (1 draw call), textures capped 1024 + JPEG
#   - export a single .glb, render review previews, emit the collision grid
import bpy, math, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SRC = "C:/Users/Asendar1/Desktop/test2.glb"
OUT = "G:/dev/ghomedah/map"
GLB = "G:/dev/ghomedah/client/public/models/props/office.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
SCN = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in SCN.objects if o.type == "MESH"]
print(f"IMPORTED {len(meshes)} meshes")

def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3)))
            mx = Vector((max(mx[i], w[i]) for i in range(3)))
    return mn, mx

def build_bvh(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    verts = []; polys = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        base = len(verts)
        mw = o.matrix_world
        verts.extend([mw @ v.co for v in me.vertices])
        polys.extend([[i + base for i in p.vertices] for p in me.polygons])
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, all_triangles=False)

mn, mx = world_bbox(meshes)
print(f"RAW BBOX z {mn.z:.2f}..{mx.z:.2f}")

# ---- find the office storey floor: dominant ray-hit height in the lower half
bvh = build_bvh(meshes)
from collections import Counter
hist = Counter()
for x in [mn.x + (mx.x - mn.x) * (i + 0.5) / 40 for i in range(40)]:
    for y in [mn.y + (mx.y - mn.y) * (j + 0.5) / 24 for j in range(24)]:
        hit = bvh.ray_cast(Vector((x, y, mx.z + 2)), Vector((0, 0, -1)))
        if hit[0] is not None:
            hist[round(hit[0].z * 2) / 2] += 1
low = sorted([kv for kv in hist.items()], key=lambda kv: -kv[1])
if not low:
    raise RuntimeError("no ray hits — nothing to prep")
fz = low[0][0]
print(f"FLOOR z={fz}  (top heights: {sorted(hist.items(), key=lambda kv:-kv[1])[:6]})")

# ---- cut: delete objects fully above the storey (fz + 3.4)
CUT = fz + 3.4
doomed = []
for o in meshes:
    omn, omx = world_bbox([o])
    if omn.z > CUT:
        doomed.append(o)
print(f"CUT at z={CUT:.2f}: deleting {len(doomed)} objects")
bpy.ops.object.select_all(action="DESELECT")
for o in doomed:
    o.select_set(True)
if doomed:
    bpy.ops.object.delete()

# ---- shift: floor to z=0, plan centred on x/y
meshes = [o for o in SCN.objects if o.type == "MESH"]
mn2, mx2 = world_bbox(meshes)
cx, cy = (mn2.x + mx2.x) / 2, (mn2.y + mx2.y) / 2
shift = Vector((-cx, -cy, -fz))
roots = [o for o in SCN.objects if o.parent is None]
for r in roots:
    r.location = r.location + shift
bpy.context.view_layer.update()
mn3, mx3 = world_bbox(meshes)
print(f"PREPPED BBOX min=({mn3.x:.2f},{mn3.y:.2f},{mn3.z:.2f}) max=({mx3.x:.2f},{mx3.y:.2f},{mx3.z:.2f})")
print(f"PLAN {mx3.x-mn3.x:.1f} x {mx3.y-mn3.y:.1f} m, height {mx3.z-mn3.z:.1f}")

# ---- join everything into one mesh (1 draw call), textures capped
bpy.ops.object.select_all(action="DESELECT")
meshes = [o for o in SCN.objects if o.type == "MESH"]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
joined.name = "office_floor"
print(f"JOINED -> {joined.name}: {len(joined.data.polygons)} tris")

# apply transforms (local == world), then slab-cut: keep only the storey
bpy.ops.object.select_all(action="DESELECT")
joined.select_set(True)
bpy.context.view_layer.objects.active = joined
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
import bmesh
bm = bmesh.new(); bm.from_mesh(joined.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                       plane_co=(0, 0, 2.6), plane_no=(0, 0, 1), clear_outer=True)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                       plane_co=(0, 0, -0.6), plane_no=(0, 0, 1), clear_inner=True)
bm.to_mesh(joined.data); bm.free()
print(f"SLAB CUT -> tris now {len(joined.data.polygons)}")
for img in bpy.data.images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        s = 1024 / max(img.size[0], img.size[1])
        img.scale(int(img.size[0] * s), int(img.size[1] * s))
print("TEXTURES capped at 1024")

# ---- collision grid on the prepped model (rays down, fz now 0)
bvh = build_bvh([joined])
COLS = 96
step = (mx3.x - mn3.x) / COLS
rows = max(1, int((mx3.y - mn3.y) / step))
solid = floor = void = 0
cells = []
for r in range(rows):
    line = ""
    crow = []
    for c in range(COLS):
        x = mn3.x + (c + 0.5) * step
        y = mn3.y + (r + 0.5) * step
        hit = bvh.ray_cast(Vector((x, y, 6.0)), Vector((0, 0, -1)))
        loc = hit[0]
        if loc is None:
            line += " "; crow.append(0); void += 1
        elif loc.z > 0.55:
            line += "#"; crow.append(2); solid += 1
        else:
            line += "."; crow.append(1); floor += 1
    cells.append(crow)
    print("  " + line)
print(f"GRID TOTALS floor={floor} solid={solid} void={void} step={step:.2f}")
json.dump(
    {"x0": mn3.x, "y0": mn3.y, "step": step, "cols": COLS, "rows": rows, "cells": cells},
    open(f"{OUT}/office-occupancy.json", "w"),
)

# ---- export single-file glb
bpy.ops.export_scene.gltf(
    filepath=GLB, export_format="GLB", use_visible=True,
    export_image_format="JPEG", export_yup=True,
)
print("EXPORTED", GLB)

# ---- review renders (top + 45, EEVEE w/ textures)
world = bpy.data.worlds.new("w"); SCN.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.95, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(35), math.radians(10), math.radians(25))
SCN.collection.objects.link(sun)
for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    try:
        SCN.render.engine = e; break
    except Exception:
        continue
print("ENGINE:", SCN.render.engine)
SCN.render.resolution_x = 1500; SCN.render.resolution_y = 1500
cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.ortho_scale = max(mx3.x - mn3.x, mx3.y - mn3.y) * 1.05
cam = bpy.data.objects.new("c", cd); SCN.collection.objects.link(cam)
cam.location = (0, 0, 20); cam.rotation_euler = (0, 0, 0)
SCN.camera = cam
SCN.render.filepath = f"{OUT}/prep-top.png"
bpy.ops.render.render(write_still=True)
cd.type = "PERSP"; cd.lens = 28
cam.location = (14, -14, 16)
cam.rotation_euler = (Vector((0, 0, 1)) - cam.location).to_track_quat("-Z", "Y").to_euler()
SCN.render.filepath = f"{OUT}/prep-45.png"
bpy.ops.render.render(write_still=True)
print("PREP DONE")
