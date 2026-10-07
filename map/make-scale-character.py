# make a scale-reference character: the game's own model, scaled to exactly
# its in-game height (CHAR_H = 1.75 m). Import it next to your furniture.
import bpy
from mathutils import Vector

SRC = "G:/dev/ghomedah/client/public/models/character.fbx"
OUT = "G:/dev/ghomedah/map/character-175.glb"
TARGET_H = 1.75

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
h = mx.z - mn.z
print(f"RAW height {h:.3f} m (z {mn.z:.3f}..{mx.z:.3f})")
k = TARGET_H / h

roots = [o for o in bpy.context.scene.objects if o.parent is None]
for r in roots:
    r.scale = (r.scale[0] * k, r.scale[1] * k, r.scale[2] * k)
bpy.context.view_layer.update()

# drop to the ground plane and re-measure (bound_box is stale after scale)
bpy.context.view_layer.update()
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
print(f"SCALED height {mx.z - mn.z:.3f} m (x {mn.x:.2f}..{mx.x:.2f})")
for r in roots:
    r.location.z -= mn.z  # feet on z=0

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True)
print("EXPORTED", OUT)
