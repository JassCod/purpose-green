"""Builds every Purpose Green 3D asset in Blender and exports them as GLB.

Run headless with the `bpy` module (pip install bpy) or Blender itself:
    python tools/blender/build_assets.py            # bpy module
    blender -b -P tools/blender/build_assets.py     # full Blender

Models are built in real-world metres (one map tile = 10 m), textured with the
images from assets/textures, then scaled to game units (1 unit = 5 m) on export.
Conventions: origin at the footprint centre on the ground, front faces -Y in
Blender (which becomes +Z in glTF / three.js).

Special names read by the game:
  materials  Window, Paint, Lamp, HeadLight, TailLight, SirenRed, SirenBlue, Leaves, Needles, Water
  objects    Rotor (spins), Smoke* / Steam* (emitters), Flag (waves)
"""
import math
import os
import random
import sys

import bpy  # must come first: it makes bmesh/mathutils importable
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "assets", "textures")
OUT = os.path.join(ROOT, "assets", "models")
GAME_SCALE = 0.2  # metres -> game units
os.makedirs(OUT, exist_ok=True)
random.seed(3)


# ====================================================================== materials
_mats = {}
UV_SCALE = {}  # material name -> metres covered by one texture repeat


def material(name, tex=None, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, uv=2.0, normal=True,
             emit=None, emit_strength=1.0, alpha=False):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex:
        path = os.path.join(TEX, tex)
        img = bpy.data.images.load(path, check_existing=True)
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(node.outputs["Alpha"], bsdf.inputs["Alpha"])
        stem = os.path.splitext(tex)[0]
        npath = os.path.join(TEX, stem + "_n.jpg")
        if normal and os.path.exists(npath):
            nimg = bpy.data.images.load(npath, check_existing=True)
            nimg.colorspace_settings.name = "Non-Color"
            nn = nt.nodes.new("ShaderNodeTexImage")
            nn.image = nimg
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = 0.8
            nt.links.new(nn.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha:
        for attr, val in (("blend_method", "CLIP"), ("alpha_threshold", 0.5)):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
    UV_SCALE[name] = uv
    _mats[name] = m
    return m


def M():
    """Shared material palette."""
    return dict(
        brick=material("Brick", "brick_red.jpg", uv=2.0),
        brick_tan=material("BrickTan", "brick_tan.jpg", uv=2.0),
        siding_w=material("SidingWhite", "siding_white.jpg", uv=2.0),
        siding_b=material("SidingBlue", "siding_blue.jpg", uv=2.0),
        siding_s=material("SidingSage", "siding_sage.jpg", uv=2.0),
        plaster_c=material("PlasterCream", "plaster_cream.jpg", uv=3.0),
        plaster_w=material("PlasterWhite", "plaster_white.jpg", uv=3.0),
        plaster_p=material("PlasterPeach", "plaster_peach.jpg", uv=3.0),
        concrete=material("Concrete", "concrete.jpg", uv=6.0),
        roof_r=material("RoofRed", "roof_red.jpg", uv=3.0),
        roof_s=material("RoofSlate", "roof_slate.jpg", uv=3.0),
        roof_b=material("RoofBrown", "roof_brown.jpg", uv=3.0),
        metal=material("Metal", "metal.jpg", uv=3.0, rough=0.45, metal=0.6),
        metal_b=material("MetalBlue", "metal_blue.jpg", uv=3.0, rough=0.5, metal=0.5),
        steel=material("Steel", None, (0.62, 0.64, 0.66), rough=0.35, metal=0.9),
        dark_steel=material("DarkSteel", None, (0.12, 0.13, 0.14), rough=0.4, metal=0.8),
        white=material("WhitePaint", None, (0.9, 0.9, 0.88), rough=0.5),
        trim=material("Trim", None, (0.93, 0.93, 0.9), rough=0.45),
        red=material("RedPaint", None, (0.62, 0.06, 0.05), rough=0.4),
        blue=material("BluePaint", None, (0.06, 0.2, 0.55), rough=0.4),
        yellow=material("YellowPaint", None, (0.95, 0.68, 0.08), rough=0.45),
        green=material("GreenPaint", None, (0.08, 0.38, 0.2), rough=0.5),
        black=material("Black", None, (0.03, 0.03, 0.035), rough=0.6),
        wood=material("Wood", "wood.jpg", uv=1.5),
        barn=material("BarnWood", "wood_barn.jpg", uv=3.0),
        asphalt=material("AsphaltLot", "asphalt.jpg", uv=6.0, rough=0.9),
        dirt=material("Dirt", "dirt.jpg", uv=6.0),
        grass=material("Lawn", "grass.jpg", uv=6.0, rough=0.95),
        gravel=material("Gravel", "sand.jpg", uv=4.0),
        wheat=material("Wheat", "crop_wheat.jpg", uv=8.0, normal=False),
        crop=material("Crop", "crop_green.jpg", uv=8.0, normal=False),
        pv=material("Solar", "pv.jpg", uv=1.0, rough=0.15, metal=0.4, normal=False),
        garbage=material("Garbage", "garbage.jpg", uv=4.0),
        coal=material("Coal", None, (0.04, 0.04, 0.045), rough=0.85),
        bark=material("Bark", "bark.jpg", uv=1.5),
        leaves=material("Leaves", "leaves.png", uv=1.0, rough=0.7, alpha=True, normal=False),
        needles=material("Needles", "needles.png", uv=1.0, rough=0.7, alpha=True, normal=False),
        hedge=material("Hedge", "grass.jpg", uv=1.0, rough=0.9),
        rubber=material("Rubber", "rubber.jpg", uv=1.0, rough=0.9, normal=False),
        window=material("Window", None, (0.18, 0.24, 0.3), rough=0.05, metal=0.6),
        paint=material("Paint", None, (0.92, 0.92, 0.92), rough=0.25, metal=0.4),
        glass=material("CarGlass", None, (0.04, 0.05, 0.07), rough=0.05, metal=0.8),
        lamp=material("Lamp", None, (1, 0.95, 0.8), rough=0.3, emit=(1, 0.85, 0.55), emit_strength=0.0),
        head=material("HeadLight", None, (1, 1, 0.95), rough=0.1, emit=(1, 0.95, 0.85), emit_strength=0.5),
        tail=material("TailLight", None, (0.6, 0.02, 0.02), rough=0.2, emit=(1, 0.05, 0.03), emit_strength=0.6),
        siren_r=material("SirenRed", None, (0.9, 0.05, 0.05), rough=0.2, emit=(1, 0, 0), emit_strength=0.0),
        siren_b=material("SirenBlue", None, (0.05, 0.15, 0.9), rough=0.2, emit=(0, 0.2, 1), emit_strength=0.0),
        water=material("Water", None, (0.08, 0.35, 0.5), rough=0.05, metal=0.3),
        skin=material("Skin", None, (0.82, 0.62, 0.48), rough=0.6),
        hair=material("Hair", None, (0.12, 0.08, 0.05), rough=0.8),
        pants=material("Pants", None, (0.12, 0.16, 0.26), rough=0.85),
        shoes=material("Shoes", None, (0.06, 0.05, 0.05), rough=0.7),
        awning_r=material("AwningRed", "awning_red.jpg", uv=2.0, normal=False),
        awning_g=material("AwningGreen", "awning_green.jpg", uv=2.0, normal=False),
        pitch=material("Pitch", "pitch.jpg", uv=0, normal=False),
        helipad=material("Helipad", "helipad.jpg", uv=0, normal=False),
        flowers_r=material("FlowersRed", None, (0.8, 0.12, 0.2), rough=0.8),
        flowers_y=material("FlowersYellow", None, (0.95, 0.75, 0.1), rough=0.8),
        hay=material("Hay", "crop_wheat.jpg", uv=2.0, normal=False),
        flag=material("FlagCloth", None, (0.1, 0.55, 0.3), rough=0.7),
    )


# ====================================================================== mesh builder
class Builder:
    """Accumulates primitives into one bmesh with material slots and box-mapped UVs."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.fit = self.bm.faces.layers.int.new("fit")
        self.mats = []
        self.extra = []  # extra objects (rotor, emitters)

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _faces(self, verts):
        return list({f for v in verts for f in v.link_faces})

    def _finish(self, verts, mat, smooth=False, fit=False):
        idx = self.mi(mat)
        faces = self._faces(verts)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
            f[self.fit] = 1 if fit else 0
        return faces

    # ---------------- primitives (z = bottom unless noted)
    def box(self, sx, sy, sz, x, y, z, mat, rz=0.0, bevel=0.0, rx=0.0, ry=0.0):
        m = Matrix.Translation((x, y, z + sz / 2)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Diagonal((sx, sy, sz, 1))
        before = set(self.bm.verts) if bevel > 0 else None
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)["verts"]
        self._finish(verts, mat)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges + verts, offset=bevel, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
            verts = [v for v in self.bm.verts if v not in before]  # bevel replaces the cube's verts
        return verts

    def cyl(self, r1, r2, h, x, y, z, mat, seg=16, smooth=True, rx=0.0, ry=0.0, rz=0.0, center=False):
        m = Matrix.Translation((x, y, z + (0 if center else h / 2))) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")
        verts = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=m)["verts"]
        faces = self._finish(verts, mat, smooth)
        for f in faces:  # caps stay flat
            if abs(f.normal.z) > 0.99 and len(f.verts) > 4:
                f.smooth = False
        return verts

    def sphere(self, r, x, y, z, mat, seg=16, sz=1.0, sx=1.0, sy=1.0):
        m = Matrix.Translation((x, y, z)) @ Matrix.Diagonal((sx, sy, sz, 1))
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r, matrix=m)["verts"]
        self._finish(verts, mat, smooth=True)
        return verts

    def lathe(self, profile, x, y, z, mat, seg=24, smooth=True):
        rings = []
        for r, h in profile:
            ring = []
            for k in range(seg):
                a = k / seg * math.tau
                ring.append(self.bm.verts.new((x + math.cos(a) * r, y + math.sin(a) * r, z + h)))
            rings.append(ring)
        verts = [v for ring in rings for v in ring]
        for a, b in zip(rings[:-1], rings[1:]):
            for k in range(seg):
                self.bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
        self._finish(verts, mat, smooth)
        return verts

    def quad(self, pts, mat, fit=True, double=False):
        """A single quad with 0..1 UVs (for signs, leaf cards, decals)."""
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mat)
        f[self.fit] = 1 if fit else 0
        for loop, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            loop[self.uv].uv = uv
        if double:
            vs2 = [self.bm.verts.new(p) for p in reversed(pts)]
            f2 = self.bm.faces.new(vs2)
            f2.material_index = f.material_index
            f2[self.fit] = 1
            for loop, uv in zip(f2.loops, [(0, 1), (1, 1), (1, 0), (0, 0)]):
                loop[self.uv].uv = uv
        return vs

    def ground(self, sx, sy, mat, x=0, y=0, z=0.02, fit=False):
        return self.quad([(x - sx / 2, y - sy / 2, z), (x + sx / 2, y - sy / 2, z), (x + sx / 2, y + sy / 2, z), (x - sx / 2, y + sy / 2, z)], mat, fit=fit)

    def gable_roof(self, w, d, h, x, y, z, roof_mat, wall_mat, overhang=0.45, thick=0.18, ridge_x=True):
        """Gable roof with the ridge along X (or Y) and wall-coloured gable ends."""
        if not ridge_x:
            w, d = d, w
        half = d / 2
        slope = math.atan2(h, half)
        length = math.hypot(half + overhang, h + overhang * math.tan(slope))
        for side in (-1, 1):
            cy = side * (half + overhang) / 2
            cz = z + h / 2 - overhang * math.tan(slope) / 2
            rz = 0 if ridge_x else math.pi / 2
            verts = self.box(w + overhang * 2, length, thick, 0, 0, -thick / 2, roof_mat)
            rot = Matrix.Rotation(-side * slope, 4, "X")
            mt = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Translation((0, cy, cz)) @ rot
            bmesh.ops.transform(self.bm, matrix=mt, verts=verts)
        # gable triangles
        for end in (-1, 1):
            ex = end * w / 2
            pts = [(ex, -half, z), (ex, half, z), (ex, 0, z + h)]
            if not ridge_x:
                pts = [(p[1], p[0], p[2]) for p in pts]
            vs = [self.bm.verts.new((x + p[0], y + p[1], p[2])) for p in pts]
            f = self.bm.faces.new(vs if (end > 0) == ridge_x else list(reversed(vs)))
            f.material_index = self.mi(wall_mat)

    def window(self, w, h, x, y, z, facing, mats, frame=0.08, sill=True):
        """Framed window on a wall. facing: '-y','+y','-x','+x' (outward normal)."""
        d = 0.06
        rz = {"-y": 0, "+y": math.pi, "-x": -math.pi / 2, "+x": math.pi / 2}[facing]
        parts = []
        parts.append(self.box(w, d, h, 0, -d / 2, 0, mats["window"]))
        parts.append(self.box(w + frame * 2, d * 1.6, frame, 0, -d * 0.8, -frame, mats["trim"]))
        parts.append(self.box(w + frame * 2, d * 1.6, frame, 0, -d * 0.8, h, mats["trim"]))
        parts.append(self.box(frame, d * 1.6, h, -w / 2 - frame / 2, -d * 0.8, 0, mats["trim"]))
        parts.append(self.box(frame, d * 1.6, h, w / 2 + frame / 2, -d * 0.8, 0, mats["trim"]))
        if w > 0.9:
            parts.append(self.box(frame * 0.6, d * 1.2, h, 0, -d * 0.6, 0, mats["trim"]))
        if sill:
            parts.append(self.box(w + frame * 3, 0.18, 0.06, 0, -0.1, -frame - 0.06, mats["trim"]))
        mt = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z")
        bmesh.ops.transform(self.bm, matrix=mt, verts=[v for p in parts for v in p])

    def text(self, s, size, x, y, z, mat, depth=0.08, facing="-y"):
        cu = bpy.data.curves.new("txt", "FONT")
        cu.body = s
        cu.size = size
        cu.extrude = depth
        cu.resolution_u = 2  # coarse curves keep lettering light
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        ob = bpy.data.objects.new("txt", cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        rz = {"-y": 0, "+y": math.pi, "-x": -math.pi / 2, "+x": math.pi / 2}[facing]
        me.transform(Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"))
        tmp = bmesh.new()
        tmp.from_mesh(me)
        vmap = {v: self.bm.verts.new(v.co) for v in tmp.verts}
        idx = self.mi(mat)
        for f in tmp.faces:
            nf = self.bm.faces.new([vmap[v] for v in f.verts])
            nf.material_index = idx
        tmp.free()
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)

    def emitter(self, name, x, y, z):
        e = bpy.data.objects.new(name, None)
        e.location = (x * GAME_SCALE, y * GAME_SCALE, z * GAME_SCALE)
        self.extra.append(e)

    def sub(self, name, build, origin):
        """A separate object (e.g. a spinning rotor) with its own pivot."""
        b = Builder(name)
        build(b)
        ob = b.to_object()
        ob.location = Vector(origin) * GAME_SCALE
        self.extra.append(ob)
        return ob

    # ---------------- finishing
    def uv_map(self):
        for f in self.bm.faces:
            if f[self.fit]:
                continue
            mat = self.mats[f.material_index]
            s = UV_SCALE.get(mat.name, 2.0) or 1.0
            n = f.normal
            ax = max(range(3), key=lambda k: abs(n[k]))
            for loop in f.loops:
                co = loop.vert.co
                if ax == 2:
                    u, v = co.x, co.y
                elif ax == 0:
                    u, v = co.y * (1 if n.x > 0 else -1), co.z
                else:
                    u, v = co.x * (-1 if n.y > 0 else 1), co.z
                loop[self.uv].uv = (u / s, v / s)

    def to_object(self, origin_offset=(0, 0, 0)):
        self.uv_map()
        bmesh.ops.translate(self.bm, vec=-Vector(origin_offset), verts=self.bm.verts)
        bmesh.ops.scale(self.bm, vec=(GAME_SCALE,) * 3, verts=self.bm.verts)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def export(builder, filename):
    ob = builder.to_object()
    for e in builder.extra:
        if e.name not in bpy.context.scene.collection.objects:
            bpy.context.scene.collection.objects.link(e)
        e.parent = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    for e in builder.extra:
        e.select_set(True)
    # .gltf + .bin with external textures, so all models share one copy of each image
    path = os.path.join(OUT, filename + ".gltf")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE", export_texture_dir="../textures",
                              use_selection=True, export_apply=True, export_yup=True)
    path = os.path.join(OUT, filename + ".bin")
    for o in [ob] + builder.extra:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f"  {filename}  {os.path.getsize(path) / 1024:.0f} KB geometry")


# ====================================================================== assets
def house(v, m):
    walls = [m["brick"], m["siding_w"], m["plaster_c"], m["siding_b"], m["siding_s"]][v % 5]
    roofm = [m["roof_r"], m["roof_s"], m["roof_b"], m["roof_r"], m["roof_s"]][v % 5]
    floors = 2 if v in (1, 3) else 1
    W, D, FH = 7.6, 6.4, 2.9
    b = Builder(f"house_{v}")
    b.ground(9.6, 9.6, m["grass"], z=0.03)
    b.box(2.6, 4.2, 0.08, 2.6 if v % 2 else -2.6, -2.9, 0.0, m["concrete"])  # driveway
    b.box(1.0, 1.6, 0.06, -0.6 if v % 2 else 0.6, -4.0, 0.0, m["concrete"])  # path
    b.box(W + 0.3, D + 0.3, 0.35, 0, 0.5, 0, m["concrete"])
    H = FH * floors
    b.box(W, D, H, 0, 0.5, 0.35, walls, bevel=0.03)
    b.gable_roof(W, D, 2.4 + 0.2 * v % 3, 0, 0.5, 0.35 + H, roofm, walls)
    b.box(0.7, 0.7, 2.6, W / 2 - 1.4, 1.6, 0.35 + H + 0.6, m["brick"])
    b.box(0.85, 0.85, 0.12, W / 2 - 1.4, 1.6, 0.35 + H + 3.2, m["concrete"])
    front = 0.5 - D / 2
    door_x = -0.6 if v % 2 else 0.6
    b.box(1.0, 0.12, 2.1, door_x, front - 0.02, 0.35, m["wood"])
    b.box(1.3, 0.1, 0.1, door_x, front - 0.06, 2.45, m["trim"])
    b.box(1.6, 0.9, 0.17, door_x, front - 0.5, 0.0, m["concrete"])
    b.box(1.6, 0.6, 0.17, door_x, front - 0.4, 0.17, m["concrete"])
    b.box(1.8, 1.2, 0.08, door_x, front - 0.6, 2.75, roofm, rx=0.2)
    for f in range(floors):
        z = 0.35 + f * FH + 0.9
        for wx in ([-2.6, 2.6] if f == 0 else [-2.6, door_x, 2.6]):
            if f == 0 and abs(wx - door_x) < 1.2:
                continue
            b.window(1.3, 1.3, wx, front, z, "-y", m)
        for wx in (-2.2, 2.2):
            b.window(1.3, 1.3, wx, 0.5 + D / 2, z, "+y", m)
        b.window(1.1, 1.2, -W / 2, 0.5, z, "-x", m)
        b.window(1.1, 1.2, W / 2, 0.5, z, "+x", m)
    # hedges and a garden fence
    for hx in (-4.4, 4.4):
        b.box(0.7, 7.5, 0.9, hx, 0.6, 0.0, m["hedge"], bevel=0.2)
    for k in range(10):
        b.box(0.08, 0.08, 0.9, -4.4 + k * 0.98, 4.7, 0, m["trim"])
    b.box(9.0, 0.06, 0.1, 0, 4.7, 0.75, m["trim"])
    b.box(0.35, 0.3, 0.45, door_x + 2.0 * (1 if door_x < 0 else -1), -4.5, 1.0, m["red"])  # mailbox
    b.cyl(0.04, 0.04, 1.0, door_x + 2.0 * (1 if door_x < 0 else -1), -4.5, 0, m["dark_steel"], seg=6)
    export(b, f"house_{v}")


def apartment(v, m):
    walls = [m["plaster_w"], m["plaster_p"], m["plaster_c"]][v % 3]
    floors = 5 + v
    W, D, FH = 16.0, 12.0, 3.1
    b = Builder(f"apartment_{v}")
    b.ground(19.6, 19.6, m["concrete"], z=0.03)
    b.ground(19.0, 3.0, m["grass"], y=7.5, z=0.05)
    H = FH * floors
    b.box(W, D, H, 0, 0.5, 0, walls, bevel=0.04)
    b.box(W + 0.4, D + 0.4, 1.0, 0, 0.5, H, walls)
    b.box(W - 0.6, D - 0.6, 0.12, 0, 0.5, H + 0.6, m["concrete"])
    front, back = 0.5 - D / 2, 0.5 + D / 2
    for f in range(floors):
        z = f * FH + 0.9
        for k in range(6):
            x = -W / 2 + (k + 0.5) * W / 6
            if f == 0 and k in (2, 3):
                continue
            b.window(1.5, 1.6, x, front, z, "-y", m)
            b.window(1.5, 1.6, x, back, z, "+y", m)
        for k in range(4):
            y = 0.5 - D / 2 + (k + 0.5) * D / 4
            b.window(1.3, 1.5, -W / 2, y, z, "-x", m)
            b.window(1.3, 1.5, W / 2, y, z, "+x", m)
        if f > 0:
            for k in (1, 4):
                x = -W / 2 + (k + 0.5) * W / 6
                b.box(3.4, 1.4, 0.18, x, front - 0.7, f * FH, m["concrete"])
                b.box(3.4, 0.05, 1.0, x, front - 1.38, f * FH + 0.18, m["window"])
                b.box(3.4, 0.08, 0.06, x, front - 1.4, f * FH + 1.18, m["steel"])
    b.box(4.0, 0.2, 2.6, 0, front - 0.05, 0, m["window"])
    b.box(5.0, 2.4, 0.25, 0, front - 1.2, 3.0, m["concrete"])
    b.text("RESIDENCE", 0.55, 0, front - 2.45, 3.12, m["trim"], depth=0.05)
    for k, (x, y) in enumerate([(-5, 3), (-2, 3), (4, 1)]):
        b.box(1.4, 1.0, 1.0, x, y, H + 0.72, m["metal"])
    b.cyl(1.2, 1.2, 2.2, 5.5, 4.0, H + 0.72, m["steel"], seg=14)
    for k in range(6):  # parking spaces
        x = -8 + k * 3.2
        b.box(0.12, 4.6, 0.02, x, -7.2, 0.04, m["white"])
    export(b, f"apartment_{v}")


def office(v, m):
    H = [22, 28, 34, 40][v % 4]
    W = 8.4
    b = Builder(f"office_{v}")
    b.ground(9.8, 9.8, m["concrete"], z=0.03)
    b.box(W, W, H, 0, 0, 0, m["window"])
    n = 6
    for k in range(n + 1):
        t = -W / 2 + k * W / n
        for (x, y, rz) in [(t, -W / 2, 0), (t, W / 2, 0), (-W / 2, t, 0), (W / 2, t, 0)]:
            b.box(0.14, 0.14, H, x, y, 0, m["steel"])
    for z in range(0, H + 1, 4):
        b.box(W + 0.2, W + 0.2, 0.35, 0, 0, z, m["concrete"])
    b.box(W - 2, W - 2, 3.2, 0, 0, H + 0.35, m["concrete"])
    b.cyl(0.08, 0.04, 7, 1.5, 1.5, H + 3.5, m["steel"], seg=6)
    b.box(4.0, 2.2, 0.25, 0, -W / 2 - 1.1, 3.6, m["dark_steel"])
    b.text(["NOVA", "APEX", "ORBIT", "VERDE"][v % 4], 0.8, 0, -W / 2 - 0.05, H - 1.2, m["trim"], depth=0.08)
    export(b, f"office_{v}")


def shop(v, m):
    walls = [m["brick"], m["plaster_c"], m["brick_tan"], m["plaster_p"]][v % 4]
    awn = [m["awning_r"], m["awning_g"]][v % 2]
    name = ["MARKET", "CAFE", "BAKERY", "GROCER"][v % 4]
    W, D, H = 9.0, 7.0, 4.4
    b = Builder(f"shop_{v}")
    b.ground(9.8, 9.8, m["concrete"], z=0.03)
    b.box(W, D, H, 0, 0.8, 0, walls, bevel=0.03)
    b.box(W + 0.3, D + 0.3, 0.9, 0, 0.8, H, walls)
    front = 0.8 - D / 2
    b.box(W - 1.6, 0.08, 2.7, 0, front - 0.02, 0.2, m["window"])
    for k in range(5):
        b.box(0.1, 0.12, 2.7, -W / 2 + 0.8 + k * (W - 1.6) / 4, front - 0.06, 0.2, m["dark_steel"])
    b.box(W - 1.4, 0.14, 0.12, 0, front - 0.06, 2.9, m["dark_steel"])
    b.box(W - 0.4, 1.8, 0.06, 0, front - 0.9, 3.25, awn, rx=-0.32)
    b.box(W - 3, 0.2, 0.9, 0, front - 0.1, 4.4, m["green"] if v % 2 else m["red"])
    b.text(name, 0.6, 0, front - 0.22, 4.82, m["trim"], depth=0.05)
    b.box(1.6, 1.2, 0.9, 2.5, 2.5, H + 0.9, m["metal"])
    for k in range(3):  # cafe tables on the sidewalk
        x = -3 + k * 3
        b.cyl(0.45, 0.45, 0.05, x, front - 2.6, 0.75, m["white"], seg=12)
        b.cyl(0.04, 0.04, 0.75, x, front - 2.6, 0, m["dark_steel"], seg=6)
    export(b, f"shop_{v}")


def factory(m):
    b = Builder("factory")
    b.ground(19.6, 19.6, m["asphalt"], z=0.03)
    b.box(17, 12, 8, 0, 1.5, 0, m["metal"], bevel=0.05)
    for k in range(5):  # sawtooth roof
        x = -17 / 2 + 1.7 + k * 3.4
        vs = b.box(3.4, 12, 0.2, 0, 0, 0, m["metal_b"], ry=0.55)
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((x, 1.5, 9.0)), verts=vs)
        b.box(0.1, 12, 1.8, x + 1.55, 1.5, 8.0, m["window"])
    b.box(6, 5, 6, -5, -7.0, 0, m["brick"], bevel=0.03)
    for k in range(3):
        b.window(1.4, 1.3, -6.8 + k * 1.8, -9.5, 3.4, "-y", m)
    for k in range(3):
        b.box(3.2, 0.2, 4.2, 1.5 + k * 4.2, -4.6, 0, m["metal_b"])
        b.box(3.8, 1.5, 0.15, 1.5 + k * 4.2, -5.2, 4.4, m["dark_steel"])
    for (x, h) in [(-6, 18), (-2.5, 15)]:
        b.cyl(0.9, 0.7, h, x, 7.0, 0, m["concrete"], seg=20)
        for z in (h - 3, h - 1.5):
            b.cyl(0.74, 0.74, 0.8, x, 7.0, z, m["red"], seg=20)
        b.emitter("Smoke", x, 7.0, h + 0.3)
    for k in range(2):
        b.cyl(1.8, 1.8, 6, 6 + k * 4, 8.5, 0, m["steel"], seg=18)
        b.sphere(1.8, 6 + k * 4, 8.5, 6, m["steel"], seg=18, sz=0.4)
    b.cyl(0.25, 0.25, 9, 4, 8.5, 5, m["steel"], seg=8, ry=math.pi / 2, center=True)
    b.text("STEELWORKS", 0.9, 1.5, -4.53, 6.6, m["trim"], depth=0.06)
    b.box(2.4, 6, 2.6, -8, -2.5, 0.0, m["blue"], bevel=0.1)  # parked lorry
    export(b, "factory")


def farm(v, m):
    b = Builder(f"farm_{v}")
    cropm = [m["wheat"], m["crop"], m["wheat"]][v % 3]
    b.ground(19.6, 19.6, m["dirt"], z=0.02)
    b.box(12.5, 18, 0.35, -3.2, 0, 0, cropm)
    b.box(6.5, 8.5, 5.0, 6.2, -4.5, 0, m["barn"], bevel=0.03)
    # gambrel roof as two pitches per side
    for side in (-1, 1):
        vs = b.box(6.9 * 0.5, 9.2, 0.15, 0, 0, 0, m["roof_s"], ry=side * 1.0)
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((6.2 + side * 2.6, -4.5, 5.8)), verts=vs)
        vs = b.box(6.9 * 0.42, 9.2, 0.15, 0, 0, 0, m["roof_s"], ry=side * 0.35)
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((6.2 + side * 1.0, -4.5, 7.15)), verts=vs)
    for end in (-1, 1):
        b.box(5.2, 0.05, 2.0, 6.2, -4.5 + end * 4.27, 5.0, m["barn"])
    b.box(2.6, 0.12, 3.4, 6.2, -8.8, 0, m["white"])
    b.box(0.12, 0.14, 3.6, 6.2, -8.85, 0, m["white"], ry=0.65)
    b.cyl(1.9, 1.9, 11, 6.5, 4.5, 0, m["metal"], seg=24)
    b.sphere(1.9, 6.5, 4.5, 11, m["steel"], seg=24, sz=0.55)
    for k in range(7):
        b.box(0.12, 0.12, 1.2, -9.4, -8.8 + k * 2.9, 0, m["wood"])
    b.box(0.08, 18, 0.1, -9.4, 0, 1.0, m["wood"])
    for k in range(4):
        b.cyl(0.65, 0.65, 1.2, 3.0 + k * 1.5, 8.6, 0.65, m["hay"], seg=16, rx=math.pi / 2, center=True)
    # a small tractor
    b.box(2.4, 1.6, 1.2, 4.4, 1.2, 0.8, m["green"], bevel=0.08)
    b.box(1.1, 1.4, 1.2, 4.0, 1.2, 2.0, m["window"])
    for (x, r) in [(3.4, 0.8), (5.4, 0.5)]:
        for y in (0.35, 2.05):
            b.cyl(r, r, 0.4, x, y, r, m["rubber"], seg=14, rx=math.pi / 2, center=True)
    export(b, f"farm_{v}")


def coal(m):
    b = Builder("coal")
    b.ground(19.6, 19.6, m["asphalt"], z=0.03)
    prof = [(6.0, 0), (5.2, 4), (4.2, 9), (3.8, 13), (3.9, 16), (4.3, 19)]
    b.lathe(prof, 4.5, 4.5, 0, m["concrete"], seg=32)
    b.lathe([(r - 0.3, h) for r, h in reversed(prof)], 4.5, 4.5, 0, m["concrete"], seg=32)
    b.emitter("Steam", 4.5, 4.5, 19.5)
    b.box(8, 7, 11, -4.5, -3.5, 0, m["metal"], bevel=0.05)
    b.box(8.4, 7.4, 0.4, -4.5, -3.5, 11, m["dark_steel"])
    for k in range(4):
        b.box(1.2, 0.08, 6, -7.5 + k * 2, -7.05, 3, m["window"])
    b.cyl(1.3, 0.9, 32, -6.5, 5.5, 0, m["concrete"], seg=20)
    for z in (26, 28.5, 31):
        b.cyl(0.98, 0.98, 1.0, -6.5, 5.5, z, m["red"], seg=20)
    b.emitter("Smoke", -6.5, 5.5, 32.3)
    b.cyl(4.5, 0.4, 4, 5, -6, 0, m["coal"], seg=12, smooth=False)
    vs = b.box(1.4, 12, 0.5, 0, 0, 0, m["dark_steel"], rx=0.35)
    bmesh.ops.transform(b.bm, matrix=Matrix.Translation((1.5, -5.5, 4.5)) @ Matrix.Rotation(math.pi / 2, 4, "Z"), verts=vs)
    b.text("POWER STATION", 0.8, -4.5, -7.1, 9.6, m["trim"], depth=0.06)
    export(b, "coal")


def solar(m):
    b = Builder("solar")
    b.ground(19.6, 19.6, m["gravel"], z=0.03)
    for r in range(4):
        for c in range(3):
            x, y = -6 + c * 6, -7 + r * 4.6
            for px in (-2, 2):
                b.cyl(0.07, 0.07, 1.6, x + px, y + 0.4, 0, m["steel"], seg=6)
                b.cyl(0.07, 0.07, 0.8, x + px, y - 0.8, 0, m["steel"], seg=6)
            panel = b.box(5.4, 2.4, 0.08, 0, 0, 0, m["pv"])
            frame = b.box(5.6, 2.6, 0.06, 0, 0, -0.05, m["steel"])
            bmesh.ops.transform(b.bm, matrix=Matrix.Translation((x, y, 1.25)) @ Matrix.Rotation(0.45, 4, "X"), verts=panel + frame)
    b.box(2, 1.4, 2.2, 8.2, 8.2, 0, m["white"], bevel=0.05)
    for k in range(9):
        b.cyl(0.05, 0.05, 2, -9.6 + k * 2.4, -9.6, 0, m["steel"], seg=6)
    export(b, "solar")


def wind(m):
    b = Builder("wind")
    b.ground(9.6, 9.6, m["grass"], z=0.03)
    b.cyl(3.0, 3.0, 0.5, 0, 0, 0, m["concrete"], seg=24)
    H = 52
    b.cyl(1.6, 0.85, H, 0, 0, 0.5, m["white"], seg=24)
    b.box(2.4, 6.0, 2.6, 0, 0.8, H + 0.2, m["white"], bevel=0.6)
    b.box(0.6, 0.4, 0.3, 0, 3.4, H + 2.9, m["red"])

    def rotor(r):
        r.sphere(1.3, 0, 0, 0, m["white"], seg=18, sy=1.6)
        for k in range(3):
            a = k / 3 * math.tau
            vs = r.box(1.6, 0.35, 24, 0, 0, 0.8, m["white"], bevel=0.15)
            # taper the blade towards the tip
            for vv in vs:
                t = max(0.0, min(1.0, (vv.co.z - 0.8) / 24))
                vv.co.x *= 1 - 0.75 * t
            bmesh.ops.transform(r.bm, matrix=Matrix.Rotation(a, 4, "Y"), verts=vs)
    b.sub("Rotor", rotor, (0, -2.4, H + 1.5))
    export(b, "wind")


def pump(m):
    b = Builder("pump")
    b.ground(9.6, 9.6, m["concrete"], z=0.03)
    b.box(5.2, 4.4, 3.6, -1.6, 0.6, 0, m["brick"], bevel=0.03)
    b.gable_roof(5.2, 4.4, 1.6, -1.6, 0.6, 3.6, m["roof_s"], m["brick"])
    b.box(1.1, 0.1, 2.2, -1.6, -1.65, 0, m["metal_b"])
    b.window(1.0, 1.0, -3.2, -1.62, 1.6, "-y", m)
    b.cyl(1.4, 1.4, 3.0, 2.8, 2.4, 0, m["steel"], seg=20)
    b.sphere(1.4, 2.8, 2.4, 3.0, m["steel"], seg=20, sz=0.35)
    for y in (-0.6, 0.4):
        b.cyl(0.25, 0.25, 6.5, 2.0, y - 2.0, 0.6, m["blue"], seg=10, rx=math.pi / 2, rz=math.pi / 2, center=True)
    b.cyl(0.35, 0.35, 1.2, 4.6, -1.0, 0, m["blue"], seg=10)
    b.text("WATERWORKS", 0.45, -1.6, -1.62, 3.0, m["trim"], depth=0.04)
    export(b, "pump")


def tower(m):
    b = Builder("tower")
    b.ground(9.6, 9.6, m["gravel"], z=0.03)
    for (x, y) in [(-2.4, -2.4), (2.4, -2.4), (-2.4, 2.4), (2.4, 2.4)]:
        b.cyl(0.18, 0.22, 17, x, y, 0, m["steel"], seg=8)
        b.box(0.6, 0.6, 0.4, x, y, 0, m["concrete"])
    for z in (5, 10, 15):
        for (x, y, rz) in [(0, -2.4, 0), (0, 2.4, 0), (-2.4, 0, math.pi / 2), (2.4, 0, math.pi / 2)]:
            b.box(4.8, 0.12, 0.15, x, y, z, m["steel"], rz=rz)
    b.cyl(3.6, 3.6, 4.5, 0, 0, 17, m["blue"], seg=28)
    b.cyl(3.6, 0.3, 1.8, 0, 0, 21.5, m["steel"], seg=28)
    b.cyl(0.4, 0.4, 17, 0, 0, 0, m["steel"], seg=10)
    b.text("H2O", 1.2, 0, -3.62, 19.2, m["trim"], depth=0.06)
    export(b, "tower")


def landfill(m):
    b = Builder("landfill")
    b.ground(19.6, 19.6, m["dirt"], z=0.03)
    for (x, y, r, h) in [(-4, -3, 5, 3.5), (3, 3, 4.5, 3.0), (4, -5, 3.2, 2.0), (-5, 5, 3.4, 2.3)]:
        b.sphere(r, x, y, 0, m["garbage"], seg=14, sz=h / r)
    for k in range(16):
        a = k / 16 * math.tau
        b.cyl(0.06, 0.06, 2.2, math.cos(a) * 9.4, math.sin(a) * 9.4, 0, m["steel"], seg=6)
    b.box(3.0, 2.4, 2.6, 7, 7, 0, m["siding_s"])
    b.box(2.6, 1.5, 1.4, -1, 7.5, 0.6, m["yellow"], bevel=0.1)
    b.box(1.2, 1.4, 1.2, -1.5, 7.5, 2.0, m["window"])
    b.box(0.3, 2.0, 1.0, 0.6, 7.5, 0.3, m["dark_steel"])
    export(b, "landfill")


def school(m):
    b = Builder("school")
    b.ground(19.6, 19.6, m["concrete"], z=0.03)
    b.quad([(-9.6, 1.0, 0.05), (1.5, 1.0, 0.05), (1.5, 9.6, 0.05), (-9.6, 9.6, 0.05)], m["pitch"])
    b.box(18, 7, 7.2, 0, -5.5, 0, m["brick_tan"], bevel=0.03)
    b.gable_roof(18, 7, 2.6, 0, -5.5, 7.2, m["roof_r"], m["brick_tan"])
    b.box(6, 8, 7.2, 6.0, 3.8, 0, m["brick_tan"], bevel=0.03)
    b.gable_roof(6, 8, 2.4, 6.0, 3.8, 7.2, m["roof_r"], m["brick_tan"], ridge_x=False)
    for f in range(2):
        for k in range(8):
            x = -8 + k * 2.2
            if f == 0 and k in (3, 4):
                continue
            b.window(1.4, 1.5, x, -9.0, 1.0 + f * 3.4, "-y", m)
    b.box(3.4, 0.12, 2.6, -0.6, -9.05, 0, m["window"])
    b.box(5, 2.5, 0.25, -0.6, -10.2, 3.0, m["red"])
    b.text("SCHOOL", 0.7, -0.6, -9.06, 5.0, m["trim"], depth=0.05)
    b.cyl(0.06, 0.06, 9, -8.5, -0.5, 0, m["steel"], seg=8)
    b.box(2.2, 0.05, 1.4, -7.35, -0.5, 7.4, m["flag"])
    for gx in (-9.2, 1.2):
        b.box(0.08, 0.08, 2.2, gx, 5.3, 0, m["white"])
        b.box(0.08, 2.6, 0.08, gx, 5.3, 2.2, m["white"])
    export(b, "school")


def hospital(m):
    b = Builder("hospital")
    b.ground(19.6, 19.6, m["asphalt"], z=0.03)
    W, D, FH, floors = 14, 10, 3.4, 5
    H = FH * floors
    b.box(W, D, H, -1.5, 1.5, 0, m["plaster_w"], bevel=0.04)
    b.box(W + 0.4, D + 0.4, 0.5, -1.5, 1.5, H, m["concrete"])
    b.quad([(-6.0, -2.5, H + 0.52), (3.0, -2.5, H + 0.52), (3.0, 6.0, H + 0.52), (-6.0, 6.0, H + 0.52)], m["helipad"])
    front = 1.5 - D / 2
    for f in range(floors):
        for k in range(7):
            x = -1.5 - W / 2 + (k + 0.5) * W / 7
            if f == 0 and k in (3,):
                continue
            b.window(1.3, 1.6, x, front, f * FH + 0.9, "-y", m)
            b.window(1.3, 1.6, x, 1.5 + D / 2, f * FH + 0.9, "+y", m)
        for k in range(5):
            y = 1.5 - D / 2 + (k + 0.5) * D / 5
            b.window(1.2, 1.6, -1.5 - W / 2, y, f * FH + 0.9, "-x", m)
            b.window(1.2, 1.6, -1.5 + W / 2, y, f * FH + 0.9, "+x", m)
    b.box(2.6, 0.12, 2.8, -1.5, front - 0.02, 0, m["window"])
    b.box(6, 4, 0.3, 6.5, -6.5, 3.6, m["concrete"])
    for (x, y) in [(4, -8.3), (9, -8.3)]:
        b.cyl(0.12, 0.12, 3.6, x, y, 0, m["steel"], seg=8)
    b.box(3.2, 0.25, 0.9, -1.5, front - 0.15, H - 1.6, m["red"])
    b.box(0.9, 0.25, 3.2, -1.5, front - 0.15, H - 2.75, m["red"])
    b.text("HOSPITAL", 0.9, -1.5, front - 0.05, 3.6, m["red"], depth=0.08)
    # ambulance
    b.box(2.0, 5.0, 2.4, 6.5, -6.0, 0.3, m["white"], bevel=0.12)
    b.box(2.05, 1.0, 0.25, 6.5, -6.0, 1.6, m["red"])
    export(b, "hospital")


def police(m):
    b = Builder("police")
    b.ground(9.8, 9.8, m["asphalt"], z=0.03)
    b.box(8.4, 6.6, 6.4, 0, 1.2, 0, m["plaster_w"], bevel=0.03)
    b.box(8.6, 6.8, 0.6, 0, 1.2, 6.4, m["metal_b"])
    b.box(8.45, 6.65, 0.5, 0, 1.2, 2.9, m["blue"])
    front = 1.2 - 3.3
    for f in range(2):
        for x in (-2.8, 2.8):
            b.window(1.4, 1.3, x, front, 0.9 + f * 3.3, "-y", m)
    b.box(1.6, 0.12, 2.4, 0, front - 0.02, 0, m["window"])
    b.box(2.4, 1.6, 0.18, 0, front - 0.8, 2.6, m["concrete"])
    b.text("POLICE", 0.75, 0, front - 0.05, 5.2, m["blue"], depth=0.06)
    b.box(1.6, 0.5, 0.3, -1.0, 2.0, 7.0, m["dark_steel"])
    b.box(0.7, 0.45, 0.3, -1.4, 2.0, 7.3, m["siren_r"])
    b.box(0.7, 0.45, 0.3, -0.6, 2.0, 7.3, m["siren_b"])
    b.box(1.9, 4.5, 1.4, 3.0, -3.6, 0.3, m["white"], bevel=0.12)
    b.box(1.95, 1.4, 1.42, 3.0, -3.6, 0.3, m["blue"])
    export(b, "police")


def fire(m):
    b = Builder("fire")
    b.ground(9.8, 9.8, m["concrete"], z=0.03)
    b.box(8.4, 7.2, 6.2, 0, 1.0, 0, m["brick"], bevel=0.03)
    b.box(8.6, 7.4, 0.4, 0, 1.0, 6.2, m["concrete"])
    front = 1.0 - 3.6
    for x in (-2.0, 2.0):
        b.box(3.0, 0.15, 3.6, x, front - 0.02, 0, m["white"])
        for z in (0.9, 1.8, 2.7):
            b.box(3.0, 0.2, 0.05, x, front - 0.04, z, m["trim"])
    b.text("FIRE STATION", 0.6, 0, front - 0.05, 4.6, m["trim"], depth=0.05)
    b.box(3.0, 3.0, 11, 3.2, 3.2, 0, m["brick"])
    b.box(3.4, 3.4, 0.4, 3.2, 3.2, 11, m["concrete"])
    b.box(2.2, 6.0, 2.6, -2.0, -6.4, 0.3, m["red"], bevel=0.15)
    b.box(2.0, 1.6, 1.2, -2.0, -8.6, 1.7, m["window"])
    b.box(2.0, 4.2, 0.12, -2.0, -5.7, 2.95, m["steel"])
    export(b, "fire")


def park(v, m):
    b = Builder(f"park_{v}")
    b.ground(9.9, 9.9, m["grass"], z=0.04)
    b.box(9.9, 1.6, 0.04, 0, 0, 0.04, m["gravel"])
    b.box(1.6, 9.9, 0.04, 0, 0, 0.04, m["gravel"])
    b.lathe([(2.0, 0), (2.0, 0.6), (1.75, 0.6), (1.75, 0.2)], 0, 0, 0.04, m["concrete"], seg=28)
    b.cyl(1.75, 1.75, 0.45, 0, 0, 0.0, m["water"], seg=28)
    b.cyl(0.25, 0.35, 1.4, 0, 0, 0.3, m["concrete"], seg=12)
    b.sphere(0.5, 0, 0, 1.8, m["concrete"], seg=12, sz=0.4)
    for (x, y, rz) in [(-3.0, -1.6, 0), (3.0, 1.6, math.pi), (-1.6, 3.0, -math.pi / 2)]:
        seat = b.box(1.8, 0.5, 0.08, 0, 0, 0.45, m["wood"])
        back = b.box(1.8, 0.08, 0.45, 0, 0.25, 0.55, m["wood"])
        legs = b.box(0.08, 0.5, 0.45, -0.8, 0, 0, m["dark_steel"]) + b.box(0.08, 0.5, 0.45, 0.8, 0, 0, m["dark_steel"])
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((x, y - 0.6 if rz == 0 else y + 0.6 if rz == math.pi else y, 0)) @ Matrix.Rotation(rz, 4, "Z"), verts=seat + back + legs)
    for (x, y) in [(-3.2, 3.2), (3.2, -3.2)]:
        b.cyl(0.07, 0.09, 4.2, x, y, 0, m["dark_steel"], seg=8)
        b.sphere(0.3, x, y, 4.3, m["lamp"], seg=10)
    for (x, y, mat) in [(3.5, 3.5, m["flowers_r"]), (-3.5, -3.5, m["flowers_y"])]:
        b.cyl(1.3, 1.3, 0.3, x, y, 0.04, m["dirt"], seg=16)
        for k in range(14):
            a = random.random() * math.tau
            r = random.random() * 1.1
            b.sphere(0.16, x + math.cos(a) * r, y + math.sin(a) * r, 0.45, mat, seg=6)
    # two small trees
    for (x, y) in [(-3.5, 3.5), (3.5, -3.5)]:
        tree_into(b, m, x, y, 0.55 + 0.1 * v, seed=v * 7 + int(x))
    export(b, f"park_{v}")


# ---------------------------------------------------------------- vegetation
def tree_into(b, m, x, y, s=1.0, seed=0):
    rnd = random.Random(seed)
    h = 4.5 * s
    b.cyl(0.32 * s, 0.18 * s, h, x, y, 0, m["bark"], seg=8)
    for k in range(3):
        a = rnd.random() * math.tau
        vs = b.cyl(0.13 * s, 0.05 * s, 2.6 * s, 0, 0, 0, m["bark"], seg=6)
        bmesh.ops.transform(b.bm, matrix=Matrix.Translation((x, y, h * (0.55 + k * 0.12))) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(0.8, 4, "X"), verts=vs)
    crown_c = Vector((x, y, h + 1.6 * s))
    for k in range(26):
        u, w = rnd.uniform(-1, 1), rnd.uniform(0, math.tau)
        r = math.sqrt(1 - u * u)
        p = crown_c + Vector((math.cos(w) * r * 2.6 * s, math.sin(w) * r * 2.6 * s, u * 2.0 * s))
        sz = rnd.uniform(1.6, 2.4) * s
        rot = Matrix.Rotation(rnd.uniform(0, math.tau), 3, "Z") @ Matrix.Rotation(rnd.uniform(-0.7, 0.7), 3, "X")
        corners = [Vector((-sz, 0, -sz)), Vector((sz, 0, -sz)), Vector((sz, 0, sz)), Vector((-sz, 0, sz))]
        b.quad([tuple(p + rot @ c) for c in corners], m["leaves"], double=True)
        rot2 = rot @ Matrix.Rotation(math.pi / 2, 3, "Z")
        b.quad([tuple(p + rot2 @ c) for c in corners], m["leaves"], double=True)


def oak(v, m):
    b = Builder(f"oak_{v}")
    tree_into(b, m, 0, 0, 1.0 + v * 0.15, seed=11 + v)
    export(b, f"oak_{v}")


def pine(v, m):
    b = Builder(f"pine_{v}")
    rnd = random.Random(20 + v)
    H = 13 + v * 2
    b.cyl(0.38, 0.1, H, 0, 0, 0, m["bark"], seg=8)
    # dense inner foliage so the tree reads as solid from a distance
    core = material("PineCore", None, (0.05, 0.15, 0.07), rough=0.95)
    b.cyl(3.0, 0.15, H - 2.2, 0, 0, 2.2, core, seg=10)
    tiers = 10
    for t in range(tiers):
        z = 2.4 + t * (H - 3) / tiers
        R = 3.6 * (1 - t / tiers) + 0.6
        for k in range(11):
            a = k / 11 * math.tau + rnd.uniform(-0.2, 0.2) + t
            dirv = Vector((math.cos(a), math.sin(a), 0))
            side = Vector((-dirv.y, dirv.x, 0)) * (R * 0.55)
            base = Vector((0, 0, z))
            tip = base + dirv * R + Vector((0, 0, -R * 0.45))
            b.quad([tuple(p) for p in [base - side * 0.3, tip - side, tip + side, base + side * 0.3]], m["needles"], double=True)
    export(b, f"pine_{v}")


# ---------------------------------------------------------------- vehicles & people
# ---------------------------------------------------------------- vehicles
def extrude_profile(b, pts, width, mat, x=0.0, smooth=False):
    """Extrude a side silhouette [(y, z), ...] across the car's width."""
    L = [b.bm.verts.new((x - width / 2, y, z)) for y, z in pts]
    R = [b.bm.verts.new((x + width / 2, y, z)) for y, z in pts]
    faces = [b.bm.faces.new(L), b.bm.faces.new(list(reversed(R)))]
    n = len(pts)
    for k in range(n):
        faces.append(b.bm.faces.new((L[k], R[k], R[(k + 1) % n], L[(k + 1) % n])))
    bmesh.ops.recalc_face_normals(b.bm, faces=faces)
    idx = b.mi(mat)
    for f in faces:
        f.material_index = idx
        f.smooth = smooth and len(f.verts) == 4
    return L + R


def arch(cy, r, z0, n=7):
    """Points over a wheel arch from rear to front."""
    return [(cy + r * math.cos(t), z0 + r * math.sin(t)) for t in [k / n * math.pi for k in range(n + 1)]]


def wheel_part(b, m, name, x, y, r, w, z=None):
    z = r if z is None else z
    def build(q):
        q.cyl(r, r, w, 0, 0, 0, m["rubber"], seg=22, ry=math.pi / 2, center=True)
        q.cyl(r * 0.62, r * 0.62, w + 0.02, 0, 0, 0, m["steel"], seg=16, ry=math.pi / 2, center=True)
        for k in range(5):  # spokes so the rotation is visible
            vs = q.box(w + 0.03, r * 0.16, r * 1.15, 0, 0, -r * 0.575, m["dark_steel"])
            bmesh.ops.transform(q.bm, matrix=Matrix.Rotation(k / 5 * math.tau, 4, "X"), verts=vs)
        q.cyl(r * 0.18, r * 0.18, w + 0.05, 0, 0, 0, m["steel"], seg=8, ry=math.pi / 2, center=True)
    b.sub(name, build, (x, y, z))


def plate(b, m, y, z, facing):
    pm = material("Plate", None, (0.95, 0.95, 0.9), rough=0.4)
    b.box(0.52, 0.03, 0.12, 0, y, z, pm)
    off = -0.016 if facing == "-y" else 0.016
    for k in range(6):  # printed characters
        b.box(0.04, 0.01, 0.07, -0.19 + k * 0.075 + (0.02 if k > 2 else 0), y + off, z + 0.025, m["black"])


def passenger_car(name, m, kind="sedan"):
    """Sedan / hatchback / SUV / taxi / police built from a real side profile (front = -Y)."""
    b = Builder(name)
    W = 1.82 if kind != "suv" else 1.92
    lift = 0.12 if kind == "suv" else 0.0
    wr = 0.33 if kind != "suv" else 0.38
    fy, ry = -1.38, 1.4
    if kind == "hatch":
        ry = 1.2
    top = [(-2.3, 0.62), (-2.25, 0.82), (-2.0, 0.88), (-1.15, 0.97), (-0.5, 1.42), (0.7, 1.45)]
    if kind == "hatch":
        rear = [(1.62, 1.36), (1.92, 0.95), (1.95, 0.4)]
    elif kind == "suv":
        top = [(-2.35, 0.7), (-2.3, 0.98), (-2.05, 1.05), (-1.3, 1.12), (-0.75, 1.68), (1.6, 1.72)]
        rear = [(2.2, 1.66), (2.35, 1.05), (2.35, 0.45)]
    else:
        rear = [(1.45, 1.38), (1.75, 1.0), (2.28, 0.96), (2.32, 0.78), (2.3, 0.42)]
    L = rear[-1][0]
    bottom = [(L - 0.15, 0.3 + lift)] + list(reversed(arch(ry, wr + 0.08, wr + lift * 0.3, 8)))[::-1][::-1]
    bottom = [(L - 0.15, 0.3 + lift)]
    bottom += arch(ry, wr + 0.08, wr + lift * 0.3)[::1]
    bottom = [(L - 0.15, 0.3 + lift)] + [(y, max(z, 0.3 + lift)) for y, z in arch(ry, wr + 0.08, wr + lift * 0.3)]
    bottom += [(y, max(z, 0.3 + lift)) for y, z in arch(fy, wr + 0.08, wr + lift * 0.3)]
    bottom += [(-2.2, 0.32 + lift)]
    pts = [(y, z + lift) for y, z in top] + [(y, z + lift) for y, z in rear] + bottom
    extrude_profile(b, pts, W, m["paint"], smooth=False)
    # glass: side windows, windscreen and rear window sit just proud of the body
    g = m["glass"]
    if kind == "suv":
        side = [(-1.25, 1.14), (-0.75, 1.62), (1.55, 1.66), (2.15, 1.6), (2.25, 1.14)]
    elif kind == "hatch":
        side = [(-1.1, 0.99), (-0.52, 1.37), (0.68, 1.4), (1.55, 1.32), (1.62, 0.99)]
    else:
        side = [(-1.1, 0.99), (-0.52, 1.37), (0.68, 1.4), (1.4, 1.33), (1.58, 1.0)]
    extrude_profile(b, [(y, z + lift) for y, z in side], W + 0.02, g)
    ws = [p for p in top][-3:-1]
    (y0, z0), (y1, z1) = ws[0], ws[1]
    nY, nZ = -(z1 - z0), (y1 - y0)
    ln = math.hypot(nY, nZ); nY, nZ = nY / ln * 0.012, nZ / ln * 0.012
    hw = W / 2 - 0.1
    b.quad([(-hw, y0 + nY + 0.03, z0 + lift + nZ + 0.03), (hw, y0 + nY + 0.03, z0 + lift + nZ + 0.03), (hw, y1 + nY - 0.02, z1 + lift + nZ - 0.02), (-hw, y1 + nY - 0.02, z1 + lift + nZ - 0.02)][::-1], g, fit=True)
    # lights, grille, bumpers, plates
    fz = 0.68 + lift
    for x in (-0.62, 0.62):
        b.box(0.42, 0.06, 0.12, x, -2.28, fz, m["head"], bevel=0.02)
        b.box(0.36, 0.06, 0.12, x, L - 0.02, fz + 0.12, m["tail"], bevel=0.02)
    b.box(0.85, 0.05, 0.16, 0, -2.29, fz - 0.06, m["black"])
    for k in range(4):
        b.box(0.8, 0.02, 0.015, 0, -2.32, fz - 0.12 + k * 0.04, m["steel"])
    b.box(W + 0.04, 0.2, 0.18, 0, -2.24, 0.34 + lift, m["dark_steel"], bevel=0.05)
    b.box(W + 0.04, 0.2, 0.18, 0, L - 0.08, 0.36 + lift, m["dark_steel"], bevel=0.05)
    plate(b, m, -2.36, 0.4 + lift, "-y")
    plate(b, m, L + 0.0, 0.5 + lift, "+y")
    # mirrors, door seams, handles
    for sx in (-1, 1):
        b.box(0.18, 0.08, 0.1, sx * (W / 2 + 0.08), -0.95, 1.02 + lift, m["paint"], bevel=0.02)
        b.box(0.12, 0.05, 0.08, sx * (W / 2 + 0.12), -0.94, 1.02 + lift, m["glass"])
        for y in (-0.05, 0.95 if kind != "hatch" else 0.85):
            b.box(0.012, 0.012, 0.55, sx * (W / 2 + 0.003), y, 0.4 + lift, m["black"])
        for y in (-0.35, 0.65):
            b.box(0.02, 0.14, 0.035, sx * (W / 2 + 0.01), y, 0.88 + lift, m["steel"])
    if kind == "taxi":
        b.box(0.6, 0.25, 0.18, 0, 0.1, 1.45, material("TaxiSign", None, (1, 0.85, 0.2), rough=0.4, emit=(1, 0.8, 0.2), emit_strength=0.4))
        b.text("TAXI", 0.12, 0, -0.03, 1.54, m["black"], depth=0.01)
    if kind == "police":
        b.box(1.1, 0.3, 0.12, 0, 0.0, 1.45, m["dark_steel"])
        b.box(0.5, 0.26, 0.12, -0.28, 0.0, 1.55, m["siren_r"])
        b.box(0.5, 0.26, 0.12, 0.28, 0.0, 1.55, m["siren_b"])
        for sx, f in ((-1, "-x"), (1, "+x")):
            b.box(0.02, 3.6, 0.16, sx * (W / 2 + 0.01), 0.0, 0.62, m["blue"])
            b.text("POLICE", 0.24, sx * (W / 2 + 0.03), 0.0, 0.9, m["blue"], depth=0.01, facing=f)
    for k, (x, y) in enumerate([(W / 2 - 0.12, fy), (-W / 2 + 0.12, fy), (W / 2 - 0.12, ry), (-W / 2 + 0.12, ry)]):
        wheel_part(b, m, f"Wheel{k}", x, y, wr, 0.24)
    export(b, name)


def van(name, m, kind="ambulance"):
    b = Builder(name)
    W = 2.0
    pts = [(-2.6, 0.62), (-2.55, 1.0), (-2.2, 1.15), (-1.6, 2.3), (2.6, 2.4), (2.6, 0.4)]
    bottom = [(y, max(z, 0.35)) for y, z in arch(1.75, 0.44, 0.36)] + [(y, max(z, 0.35)) for y, z in arch(-1.65, 0.44, 0.36)] + [(-2.55, 0.38)]
    extrude_profile(b, pts + bottom, W, m["paint"])
    extrude_profile(b, [(-2.1, 1.2), (-1.62, 2.12), (-0.8, 2.15), (-0.8, 1.2)], W + 0.02, m["glass"])
    b.quad([(-0.92, -2.08, 1.25), (0.92, -2.08, 1.25), (0.92, -1.66, 2.1), (-0.92, -1.66, 2.1)][::-1], m["glass"])
    for x in (-0.7, 0.7):
        b.box(0.32, 0.06, 0.14, x, -2.58, 0.8, m["head"])
        b.box(0.22, 0.06, 0.3, x, 2.6, 1.0, m["tail"])
    b.box(W + 0.04, 0.2, 0.2, 0, -2.55, 0.4, m["dark_steel"])
    plate(b, m, -2.66, 0.48, "-y")
    if kind == "ambulance":
        for sx, f in ((-1, "-x"), (1, "+x")):
            b.box(0.02, 4.4, 0.25, sx * (W / 2 + 0.01), 0.3, 1.25, m["red"])
            b.text("AMBULANCE", 0.26, sx * (W / 2 + 0.03), 0.6, 1.8, m["red"], depth=0.01, facing=f)
        b.box(0.5, 0.06, 0.5, 0, 2.62, 1.7, m["red"])
        b.box(0.16, 0.07, 0.5, 0, 2.63, 1.7, m["white"])
        b.box(0.5, 0.07, 0.16, 0, 2.63, 1.7, m["white"])
        b.box(1.2, 0.3, 0.14, 0, -1.4, 2.32, m["dark_steel"])
        b.box(0.55, 0.26, 0.14, -0.3, -1.4, 2.42, m["siren_r"])
        b.box(0.55, 0.26, 0.14, 0.3, -1.4, 2.42, m["siren_b"])
    for k, (x, y) in enumerate([(W / 2 - 0.15, -1.65), (-W / 2 + 0.15, -1.65), (W / 2 - 0.15, 1.75), (-W / 2 + 0.15, 1.75)]):
        wheel_part(b, m, f"Wheel{k}", x, y, 0.38, 0.26)
    export(b, name)


def fire_engine(m):
    b = Builder("firetruck")
    W = 2.45
    pts = [(-4.6, 0.6), (-4.6, 2.8), (-3.0, 2.95), (-3.0, 2.2), (4.4, 2.2), (4.4, 0.5)]
    bottom = [(y, max(z, 0.45)) for y, z in arch(3.0, 0.55, 0.5)] + [(y, max(z, 0.45)) for y, z in arch(1.6, 0.55, 0.5)] + [(y, max(z, 0.45)) for y, z in arch(-3.4, 0.55, 0.5)] + [(-4.55, 0.5)]
    extrude_profile(b, pts + bottom, W, m["paint"])
    extrude_profile(b, [(-4.5, 1.75), (-4.5, 2.65), (-3.15, 2.75), (-3.15, 1.75)], W + 0.02, m["glass"])
    b.quad([(-1.1, -4.62, 1.8), (1.1, -4.62, 1.8), (1.1, -4.62, 2.65), (-1.1, -4.62, 2.65)][::-1], m["glass"])
    for k in range(4):  # equipment lockers
        b.box(0.02, 1.4, 1.1, W / 2 + 0.01, -2.2 + k * 1.6, 0.9, m["steel"])
        b.box(0.02, 1.4, 1.1, -W / 2 - 0.01, -2.2 + k * 1.6, 0.9, m["steel"])
    for sx in (-0.45, 0.45):  # ladder on the roof
        b.box(0.08, 7.2, 0.08, sx, 0.6, 2.55, m["steel"])
    for k in range(18):
        b.box(0.9, 0.05, 0.05, 0, -2.8 + k * 0.4, 2.55, m["steel"])
    b.box(0.4, 0.4, 0.35, 0, -2.6, 2.2, m["steel"])
    b.box(1.6, 0.3, 0.16, 0, -3.8, 2.95, m["dark_steel"])
    b.box(0.7, 0.26, 0.15, -0.38, -3.8, 3.06, m["siren_r"])
    b.box(0.7, 0.26, 0.15, 0.38, -3.8, 3.06, m["siren_r"])
    for x in (-0.8, 0.8):
        b.box(0.35, 0.06, 0.18, x, -4.62, 1.0, m["head"])
        b.box(0.3, 0.06, 0.3, x, 4.42, 1.0, m["tail"])
    b.box(1.4, 0.06, 0.6, 0, -4.63, 1.1, m["steel"])
    for sx, f in ((-1, "-x"), (1, "+x")):
        b.box(0.02, 8.8, 0.12, sx * (W / 2 + 0.012), 0, 2.08, m["white"])
        b.text("FIRE RESCUE", 0.3, sx * (W / 2 + 0.03), -3.8, 1.3, m["yellow"], depth=0.01, facing=f) if False else None
    for k, (x, y) in enumerate([(W / 2 - 0.2, -3.4), (-W / 2 + 0.2, -3.4), (W / 2 - 0.2, 1.6), (-W / 2 + 0.2, 1.6), (W / 2 - 0.2, 3.0), (-W / 2 + 0.2, 3.0)]):
        wheel_part(b, m, f"Wheel{k}", x, y, 0.5, 0.36)
    export(b, "firetruck")


def city_bus(m):
    b = Builder("bus")
    W = 2.5
    pts = [(-5.9, 0.55), (-5.95, 2.9), (-5.7, 3.15), (5.8, 3.15), (5.95, 2.9), (5.95, 0.55)]
    bottom = [(y, max(z, 0.4)) for y, z in arch(3.9, 0.56, 0.5)] + [(y, max(z, 0.4)) for y, z in arch(-3.6, 0.56, 0.5)] + [(-5.85, 0.42)]
    extrude_profile(b, pts + bottom, W, m["paint"])
    extrude_profile(b, [(-5.6, 1.35), (-5.6, 2.75), (5.6, 2.75), (5.6, 1.35)], W + 0.02, m["glass"])
    b.quad([(-1.15, -5.97, 1.0), (1.15, -5.97, 1.0), (1.15, -5.97, 2.8), (-1.15, -5.97, 2.8)][::-1], m["glass"])
    dest = material("BusSign", None, (0.05, 0.05, 0.05), rough=0.3, emit=(1, 0.6, 0.1), emit_strength=0.6)
    b.box(1.8, 0.05, 0.3, 0, -5.98, 2.82, dest)
    for k in range(9):  # window pillars
        b.box(W + 0.06, 0.12, 1.4, 0, -4.8 + k * 1.25, 1.35, m["black"])
    for y in (-4.6, 0.4):  # doors
        b.box(0.03, 1.2, 2.2, -W / 2 - 0.02, y, 0.55, m["glass"])
        b.box(0.04, 0.05, 2.2, -W / 2 - 0.03, y, 0.55, m["dark_steel"])
    for x in (-0.85, 0.85):
        b.box(0.35, 0.06, 0.2, x, -5.98, 0.85, m["head"])
        b.box(0.3, 0.06, 0.4, x, 5.97, 1.0, m["tail"])
    b.box(W + 0.04, 0.2, 0.3, 0, -5.9, 0.42, m["dark_steel"])
    b.text("CITY BUS", 0.32, W / 2 + 0.03, 0, 3.0, m["white"], depth=0.01, facing="+x")
    for k, (x, y) in enumerate([(W / 2 - 0.2, -3.6), (-W / 2 + 0.2, -3.6), (W / 2 - 0.2, 3.9), (-W / 2 + 0.2, 3.9)]):
        wheel_part(b, m, f"Wheel{k}", x, y, 0.5, 0.32)
    export(b, "bus")


def truck(m):
    b = Builder("truck")
    W = 2.35
    cab = [(-4.0, 0.6), (-4.0, 2.55), (-3.7, 2.75), (-2.0, 2.75), (-2.0, 0.6)]
    bottom = [(y, max(z, 0.45)) for y, z in arch(-3.0, 0.55, 0.5)]
    extrude_profile(b, [(-1.9, 0.6), (-1.9, 0.5)] + [(y, z) for y, z in cab[1:4]] + [(-3.95, 0.6)], W, m["paint"]) if False else None
    extrude_profile(b, cab, W, m["paint"])
    extrude_profile(b, [(-3.95, 1.75), (-3.95, 2.5), (-2.9, 2.6), (-2.9, 1.75)], W + 0.02, m["glass"])
    b.quad([(-1.0, -4.02, 1.7), (1.0, -4.02, 1.7), (1.0, -4.02, 2.55), (-1.0, -4.02, 2.55)][::-1], m["glass"])
    b.box(W + 0.05, 5.7, 3.0, 0, 1.0, 0.7, m["white"], bevel=0.05)
    b.box(W - 0.1, 7.8, 0.25, 0, -0.3, 0.45, m["dark_steel"])
    b.box(1.2, 0.06, 0.5, 0, -4.03, 0.9, m["steel"])
    for x in (-0.8, 0.8):
        b.box(0.32, 0.06, 0.18, x, -4.03, 0.75, m["head"])
        b.box(0.28, 0.06, 0.24, x, 3.86, 0.95, m["tail"])
        b.box(0.12, 0.1, 0.4, x * 1.55, -3.6, 2.0, m["dark_steel"])  # mirrors
    b.text("FRESH GOODS", 0.42, W / 2 + 0.05, 1.0, 2.1, m["green"], depth=0.02, facing="+x")
    b.text("FRESH GOODS", 0.42, -W / 2 - 0.05, 1.0, 2.1, m["green"], depth=0.02, facing="-x")
    plate(b, m, -4.05, 0.55, "-y")
    for k, (x, y) in enumerate([(W / 2 - 0.2, -3.0), (-W / 2 + 0.2, -3.0), (W / 2 - 0.2, 2.2), (-W / 2 + 0.2, 2.2), (W / 2 - 0.2, 3.2), (-W / 2 + 0.2, 3.2)]):
        wheel_part(b, m, f"Wheel{k}", x, y, 0.5, 0.32)
    export(b, "truck")


# ---------------------------------------------------------------- transport: rail, air, sea
def extrude_top(b, pts, z0, z1, mat):
    """Extrude a top-view outline [(x, y), ...] vertically from z0 to z1 (hulls, platforms)."""
    lo = [b.bm.verts.new((x, y, z0)) for x, y in pts]
    hi = [b.bm.verts.new((x, y, z1)) for x, y in pts]
    faces = [b.bm.faces.new(lo), b.bm.faces.new(list(reversed(hi)))]
    n = len(pts)
    for k in range(n):
        faces.append(b.bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k])))
    bmesh.ops.recalc_face_normals(b.bm, faces=faces)
    idx = b.mi(mat)
    for f in faces:
        f.material_index = idx
    return lo + hi


def station(m):
    b = Builder("station")
    b.ground(19.6, 19.6, m["concrete"], z=0.03)
    b.box(19.6, 4.2, 1.05, 0, -7.7, 0, m["concrete"])  # platform at rail height
    b.box(19.6, 0.4, 0.02, 0, -9.55, 1.05, m["yellow"])  # stand-behind line
    for x in range(-8, 9, 4):
        b.cyl(0.12, 0.12, 3.6, x, -7.0, 1.05, m["dark_steel"], seg=8)
    b.box(19.4, 4.6, 0.18, 0, -7.6, 4.65, m["metal_b"], rx=0.05)
    for x in (-5, 0, 5):
        b.box(1.6, 0.45, 0.08, x, -6.6, 1.5, m["wood"])
        b.box(0.08, 0.4, 0.45, x - 0.75, -6.6, 1.05, m["dark_steel"])
        b.box(0.08, 0.4, 0.45, x + 0.75, -6.6, 1.05, m["dark_steel"])
    b.box(1.2, 0.1, 0.6, 7.5, -5.8, 3.6, m["black"])  # departure board
    b.box(13, 7, 6.2, 0, 3.0, 0, m["brick"], bevel=0.03)
    b.gable_roof(13, 7, 2.6, 0, 3.0, 6.2, m["roof_s"], m["brick"])
    for x in (-4.5, -2.0, 2.0, 4.5):
        b.window(1.3, 2.2, x, -0.5, 1.0, "-y", m)
    b.box(2.2, 0.12, 2.8, 0, -0.52, 0, m["window"])
    face = material("ClockFace", None, (0.95, 0.94, 0.88), rough=0.4)
    b.cyl(0.7, 0.7, 0.08, 0, -0.55, 4.9, face, seg=20, rx=math.pi / 2, center=True)
    b.text("STATION", 0.7, 0, -0.56, 3.7, m["trim"], depth=0.04)
    export(b, "station")


def locomotive(m):
    b = Builder("locomotive")
    W = 2.9
    side = [(-8.5, 1.2), (-8.5, 2.6), (-7.6, 4.1), (8.5, 4.2), (8.5, 1.2)]
    extrude_profile(b, side, W, m["paint"])
    extrude_profile(b, [(-8.4, 2.75), (-7.75, 3.85), (-6.6, 3.85), (-6.6, 2.75)], W + 0.02, m["glass"])
    b.quad([(-1.2, -8.55, 2.75), (1.2, -8.55, 2.75), (1.2, -7.8, 3.9), (-1.2, -7.8, 3.9)][::-1], m["glass"])
    b.box(W + 0.03, 15.5, 0.35, 0, 0.5, 1.6, m["yellow"])  # livery stripe
    for k in range(6):
        b.box(0.04, 1.4, 1.0, W / 2 + 0.02, -4 + k * 2.2, 2.6, m["metal"])
        b.box(0.04, 1.4, 1.0, -W / 2 - 0.02, -4 + k * 2.2, 2.6, m["metal"])
    for x in (-0.9, 0.9):
        b.box(0.35, 0.06, 0.22, x, -8.55, 1.8, m["head"])
    b.box(1.6, 1.4, 0.4, 0, 2, 4.2, m["dark_steel"])  # roof equipment
    for y in (-5.5, 5.5):  # bogies with wheels
        b.box(2.4, 3.6, 0.7, 0, y, 0.45, m["dark_steel"])
        for dy in (-1.1, 1.1):
            for x in (-0.75, 0.75):
                b.cyl(0.5, 0.5, 0.15, x, y + dy, 0.5, m["steel"], seg=14, ry=math.pi / 2, center=True)
    b.box(2.6, 0.4, 0.5, 0, -8.55, 0.9, m["dark_steel"])
    export(b, "locomotive")


def carriage(m):
    b = Builder("carriage")
    W, L = 2.9, 20.0
    b.box(W, L, 2.9, 0, 0, 1.2, m["paint"], bevel=0.12)
    vs = b.cyl(W / 2, W / 2, L - 0.2, 0, 0, 4.1, m["white"], seg=16, rx=math.pi / 2, center=True)
    for v in vs:  # flatten the roof arc
        v.co.z = 4.1 + (v.co.z - 4.1) * 0.28
    for side in (-1, 1):
        b.box(0.03, L - 3, 0.9, side * (W / 2 + 0.01), 0, 2.55, m["glass"])
        for y in (-L / 2 + 1.4, L / 2 - 1.4):
            b.box(0.04, 1.2, 2.2, side * (W / 2 + 0.02), y, 1.25, m["metal"])
        b.box(0.03, L - 0.6, 0.18, side * (W / 2 + 0.01), 0, 1.9, m["yellow"])
    for y in (-7.0, 7.0):
        b.box(2.4, 3.0, 0.7, 0, y, 0.45, m["dark_steel"])
        for dy in (-0.9, 0.9):
            for x in (-0.75, 0.75):
                b.cyl(0.45, 0.45, 0.15, x, y + dy, 0.45, m["steel"], seg=14, ry=math.pi / 2, center=True)
    export(b, "carriage")


def airport(m):
    """A regional airfield on an 80 x 80 m plot: runway along X at the back, apron and terminal at the front."""
    b = Builder("airport")
    b.ground(79.6, 79.6, m["grass"], z=0.03)
    b.box(76, 12, 0.06, 0, 18, 0.0, m["asphalt"])
    for k in range(14):  # centre line
        b.box(2.6, 0.3, 0.02, -32 + k * 5, 18, 0.06, m["white"])
    for end in (-1, 1):  # threshold piano keys and runway numbers
        for k in range(8):
            b.box(2.8, 0.6, 0.02, end * 34, 13.4 + k * 1.3, 0.06, m["white"])
        for k in range(10):
            b.cyl(0.12, 0.12, 0.25, end * (37 - k * 0.0) if False else -36 + k * 8, 18 + end * 6.3, 0.05, m["lamp"], seg=6)
    b.box(6, 22, 0.05, 30, 3, 0.01, m["asphalt"])  # taxiway
    b.box(48, 18, 0.05, 0, -12, 0.0, m["concrete"])  # apron
    for x in (-12, 0, 12):
        b.box(0.25, 14, 0.02, x, -12, 0.06, m["yellow"])
    # terminal
    b.box(44, 10, 7.5, 0, -30, 0, m["window"])
    for x in range(-22, 23, 4):
        b.box(0.25, 0.25, 7.5, x, -25, 0, m["steel"])
    b.box(46, 12, 0.6, 0, -30, 7.5, m["white"])
    b.box(12, 3, 1.2, 0, -24.5, 6.6, m["white"])
    b.text("AIRPORT", 1.6, 0, -35.06, 5.8, m["blue"], depth=0.08)
    # control tower
    b.cyl(2.0, 2.4, 26, -32, -10, 0, m["concrete"], seg=18)
    b.cyl(4.0, 3.2, 1.0, -32, -10, 26, m["white"], seg=18)
    b.cyl(3.8, 3.8, 3.0, -32, -10, 27, m["window"], seg=18)
    b.cyl(4.2, 4.2, 0.5, -32, -10, 30, m["dark_steel"], seg=18)
    b.cyl(0.06, 0.06, 4, -32, -10, 30.5, m["steel"], seg=6)
    # arched hangar
    vs = b.cyl(8, 8, 18, -18, 2, 0, m["metal"], seg=24, rx=math.pi / 2, center=True)
    for v in vs:
        if v.co.z < 0:
            v.co.z = 0
    b.box(15.8, 0.1, 7.6, -18, -7.0, 0, m["metal_b"])
    # windsock
    b.cyl(0.1, 0.1, 8, 36, 4, 0, m["steel"], seg=6)
    hivis = material("HiVis", None, (1.0, 0.45, 0.02), rough=0.5)
    b.cyl(0.6, 0.3, 3, 36, 2.6, 7.6, hivis, seg=10, rx=math.pi / 2, center=True)
    export(b, "airport")


def plane(m):
    """A high-wing regional turboprop (~22 m long, 26 m span). Front = -Y. Props spin."""
    b = Builder("plane")
    body = material("Fuselage", None, (0.95, 0.95, 0.96), rough=0.35, metal=0.2)
    b.cyl(1.35, 1.35, 15, 0, 0, 2.6, body, seg=20, rx=math.pi / 2, center=True)
    b.sphere(1.35, 0, -7.5, 2.6, body, seg=20, sy=2.0)
    vs = b.cyl(1.35, 0.35, 6.5, 0, 10.7, 2.6, body, seg=20, rx=-math.pi / 2, center=True)
    for v in vs:  # tail sweeps up
        if v.co.y > 9:
            v.co.z += (v.co.y - 9) * 0.25
    b.box(2.0, 0.6, 0.5, 0, -8.7, 3.2, m["glass"], rx=0.4)
    for k in range(13):  # cabin windows
        for side in (-1, 1):
            b.box(0.05, 0.35, 0.45, side * 1.33, -5.2 + k * 0.95, 3.0, m["glass"])
    b.box(2.74, 22.0, 0.35, 0, 1.5, 1.9, m["paint"]) if False else None
    for side in (-1, 1):
        b.box(0.03, 17.5, 0.28, side * 1.36, 0.8, 2.2, m["paint"])  # livery stripe
    b.box(26, 2.6, 0.35, 0, -0.5, 3.9, body, bevel=0.1)  # high wing
    vs = b.box(0.35, 4.2, 4.6, 0, 11.8, 3.6, body)  # fin
    for v in vs:
        if v.co.z > 5:
            v.co.y += 1.4
    b.box(8.5, 1.8, 0.25, 0, 13.4, 8.1, body)  # T-tail stabiliser
    for x in (-4.3, 4.3):
        b.cyl(0.6, 0.5, 4.0, x, -1.2, 3.6, body, seg=12, rx=math.pi / 2, center=True)
        b.box(0.3, 0.3, 1.6, x, 0.5, 1.0, m["dark_steel"])
        b.cyl(0.4, 0.4, 0.3, x, 0.5, 0.4, m["rubber"], seg=12, ry=math.pi / 2, center=True)

        def prop(r):
            r.sphere(0.35, 0, 0, 0, m["dark_steel"], seg=10, sy=1.4)
            for k in range(6):
                vs2 = r.box(0.22, 0.05, 1.7, 0, 0, 0.2, m["black"])
                bmesh.ops.transform(r.bm, matrix=Matrix.Rotation(k / 6 * math.tau, 4, "Y"), verts=vs2)
        b.sub("Prop0" if x < 0 else "Prop1", prop, (x, -3.35, 3.6))
    b.box(0.2, 0.2, 1.4, 0, -6.2, 1.0, m["dark_steel"])
    b.cyl(0.3, 0.3, 0.25, 0, -6.2, 0.3, m["rubber"], seg=10, ry=math.pi / 2, center=True)
    export(b, "plane")


def port(m):
    """A container port on a 40 x 40 m plot; the quay (front, -Y) faces the water."""
    b = Builder("port")
    b.ground(39.6, 39.6, m["concrete"], z=0.03)
    b.box(39.6, 1.0, 1.2, 0, -19.5, -1.0, m["concrete"])  # quay wall
    for x in range(-18, 19, 4):
        b.cyl(0.25, 0.3, 0.6, x, -18.8, 0.0, m["dark_steel"], seg=8)  # bollards
    cols = [material(f"Container{k}", None, c, rough=0.6) for k, c in enumerate([(0.6, 0.1, 0.08), (0.05, 0.25, 0.55), (0.1, 0.45, 0.2), (0.8, 0.55, 0.05), (0.5, 0.5, 0.5)])]
    rnd = random.Random(5)
    for r_ in range(3):
        for c_ in range(5):
            h = rnd.randint(1, 4)
            for k in range(h):
                b.box(6.0, 2.4, 2.55, -14 + c_ * 7, -4 + r_ * 3.0, k * 2.6, cols[rnd.randint(0, 4)], bevel=0.04)
    # ship-to-shore gantry crane overhanging the water
    blue = m["blue"]
    for x in (-6, 6):
        for y in (-17, -9):
            b.box(0.9, 0.9, 26, x, y, 0, blue)
    b.box(13, 0.9, 1.2, 0, -17, 18, blue)
    b.box(13, 0.9, 1.2, 0, -9, 18, blue)
    b.box(3.0, 40, 1.6, 0, -18, 26, blue)
    b.box(3.4, 3.4, 2.6, 0, -16, 23.4, m["white"])
    b.cyl(0.04, 0.04, 14, 0, -28, 12, m["dark_steel"], seg=4)
    b.box(6.2, 2.6, 0.6, 0, -28, 11.4, m["yellow"])
    b.box(18, 10, 9, 8, 12, 0, m["metal"], bevel=0.05)
    b.text("PORT", 2.0, 8, 6.95, 6.0, m["trim"], depth=0.08)
    b.box(6, 6, 7, -12, 13, 0, m["plaster_w"])
    for x in (-13.5, -10.5):
        b.window(1.6, 1.6, x, 9.95, 3.5, "-y", m)
    export(b, "port")


def cargo_ship(m):
    b = Builder("cargo_ship")
    hull = [(0, -26), (2.8, -21), (5.0, -14), (5.2, 18), (4.5, 22), (-4.5, 22), (-5.2, 18), (-5.0, -14), (-2.8, -21)]
    anti = material("Antifouling", None, (0.45, 0.06, 0.05), rough=0.7)
    extrude_top(b, hull, -3.0, 0.0, anti)
    extrude_top(b, hull, 0.0, 3.2, m["paint"])
    extrude_top(b, [(x * 0.96, y * 0.98) for x, y in hull], 3.2, 3.35, m["dark_steel"])
    cols = [material(f"Container{k}", None, c, rough=0.6) for k, c in enumerate([(0.6, 0.1, 0.08), (0.05, 0.25, 0.55), (0.1, 0.45, 0.2), (0.8, 0.55, 0.05), (0.5, 0.5, 0.5)])]
    rnd = random.Random(9)
    for row in range(5):
        for col in range(3):
            for tier in range(rnd.randint(1, 3)):
                b.box(2.9, 5.8, 2.55, -3.2 + col * 3.2, -16 + row * 6.2, 3.35 + tier * 2.6, cols[rnd.randint(0, 4)], bevel=0.03)
    b.box(9.4, 6, 8, 0, 17, 3.35, m["white"], bevel=0.05)  # bridge
    b.box(11, 2.5, 0.3, 0, 15.5, 11.2, m["white"])
    for k in range(5):
        b.box(1.4, 0.05, 1.0, -3.6 + k * 1.8, 13.98, 9.6, m["glass"])
    b.cyl(1.0, 1.1, 4, 0, 20.5, 11.35, m["red"], seg=12)
    b.emitter("Smoke", 0, 20.5, 15.6)
    export(b, "cargo_ship")


def ferry(m):
    b = Builder("ferry")
    hull = [(0, -17), (3.5, -12), (5.0, -6), (5.0, 15), (-5.0, 15), (-5.0, -6), (-3.5, -12)]
    extrude_top(b, hull, -2.2, 0.0, m["blue"])
    extrude_top(b, hull, 0.0, 2.6, m["white"])
    extrude_top(b, [(x * 0.85, y * 0.82 + 1.5) for x, y in hull], 2.6, 5.2, m["white"])
    extrude_top(b, [(x * 0.65, y * 0.5 + 4) for x, y in hull], 5.2, 7.4, m["white"])
    for z, sc in ((3.4, 0.86), (5.9, 0.66)):
        for side in (-1, 1):
            b.box(0.04, 14 * sc + 4, 1.0, side * (5.0 * sc - 0.05 if sc < 0.8 else 4.27), 2.5, z, m["glass"])
    b.box(10.06, 30, 0.5, 0, -0.5, 1.4, m["blue"])
    b.text("FERRY", 1.0, 5.06, 2, 1.6, m["white"], depth=0.04, facing="+x")
    b.cyl(0.7, 0.8, 2.6, 0, 9, 7.4, m["yellow"], seg=12)
    b.emitter("Smoke", 0, 9, 10.2)
    export(b, "ferry")


def sailboat(m):
    b = Builder("sailboat")
    hull = [(0, -4.6), (1.3, -2.5), (1.6, 1.0), (1.2, 4.2), (-1.2, 4.2), (-1.6, 1.0), (-1.3, -2.5)]
    extrude_top(b, hull, -0.7, 0.0, m["blue"])
    extrude_top(b, hull, 0.0, 0.9, m["white"])
    b.box(1.6, 2.2, 0.6, 0, 0.8, 0.9, m["white"], bevel=0.1)
    b.cyl(0.07, 0.06, 11, 0, -1.0, 0.9, m["steel"], seg=8)
    b.box(0.08, 4.2, 0.08, 0, 1.1, 2.2, m["steel"])
    sail = material("Sail", None, (0.96, 0.95, 0.9), rough=0.8)
    b.quad([(0, -0.95, 2.3), (0, 3.2, 2.3), (0, -0.95, 11.6), (0, -0.95, 11.6)], sail, double=True)
    b.quad([(0, -1.1, 1.4), (0, -1.1, 10.5), (0, -4.4, 1.1), (0, -4.4, 1.1)], sail, double=True)
    export(b, "sailboat")


def car(m):
    passenger_car("car", m, "sedan")
    passenger_car("hatch", m, "hatch")
    passenger_car("suv", m, "suv")
    passenger_car("taxi", m, "taxi")
    passenger_car("policecar", m, "police")
    van("ambulance", m, "ambulance")
    fire_engine(m)
    city_bus(m)


def person(m, female=False):
    """A detailed person ~1.75 m with separate limbs (pivoting at hips and shoulders) for walking.
    Shirt uses 'Paint' and trousers/skirt 'Paint2' so every citizen can wear their own clothes."""
    name = "person_f" if female else "person_m"
    pants = material("Paint2", None, (0.9, 0.9, 0.9), rough=0.85)
    shirt = material("Shirt", None, (0.92, 0.92, 0.92), rough=0.88)
    m = dict(m, paint=shirt)
    lip = material("Lips", None, (0.55, 0.22, 0.2), rough=0.5)
    eye_w = material("EyeWhite", None, (0.95, 0.95, 0.93), rough=0.2)
    iris = material("Iris", None, (0.12, 0.08, 0.05), rough=0.1)
    hair = m["hair"]
    b = Builder(name)
    sh = 0.19 if female else 0.22  # half shoulder width
    # hips, torso, collar, neck
    if female:
        b.cyl(0.17, 0.3, 0.42, 0, 0, 0.58, pants, seg=14)  # skirt
    else:
        b.box(0.36, 0.22, 0.2, 0, 0, 0.86, pants, bevel=0.05)
        b.box(0.37, 0.23, 0.05, 0, 0, 1.02, m["black"])  # belt
        b.box(0.05, 0.02, 0.04, 0, -0.12, 1.025, m["steel"])  # buckle
    torso = b.box(sh * 2, 0.24, 0.42, 0, 0, 1.05, m["paint"], bevel=0.07)
    for v in torso:  # taper the waist
        if v.co.z < 1.2:
            v.co.x *= 0.82
    if female:
        b.sphere(0.06, -0.07, -0.085, 1.3, m["paint"], seg=10, sy=0.8)
        b.sphere(0.06, 0.07, -0.085, 1.3, m["paint"], seg=10, sy=0.8)
    b.cyl(0.13, 0.11, 0.06, 0, 0, 1.46, m["paint"], seg=12)  # collar
    b.cyl(0.055, 0.06, 0.1, 0, 0, 1.5, m["skin"], seg=10)
    # head and face
    hz = 1.69
    b.sphere(0.115, 0, 0, hz, m["skin"], seg=18, sz=1.18, sy=1.05)
    b.sphere(0.07, 0, -0.02, hz - 0.085, m["skin"], seg=12, sx=1.15, sz=0.8)  # jaw
    for x in (-0.042, 0.042):
        b.sphere(0.019, x, -0.1, hz + 0.02, eye_w, seg=8)
        b.sphere(0.01, x, -0.115, hz + 0.02, iris, seg=6)
        b.box(0.045, 0.012, 0.01, x, -0.108, hz + 0.05, hair)  # eyebrow
        b.sphere(0.028, x * 2.75, 0, hz, m["skin"], seg=8, sy=0.5)  # ears
    nose = b.cyl(0.018, 0.012, 0.05, 0, -0.118, hz - 0.035, m["skin"], seg=6)
    b.box(0.05, 0.012, 0.012, 0, -0.112, hz - 0.065, lip)
    # hair
    if female:
        b.sphere(0.128, 0, 0.012, hz + 0.02, hair, seg=16, sz=1.1, sy=1.08)
        b.box(0.22, 0.08, 0.26, 0, 0.075, hz - 0.2, hair, bevel=0.035)  # long hair at the back
    else:
        cap = b.sphere(0.122, 0, 0.012, hz + 0.035, hair, seg=16, sz=0.85, sy=1.06)
        for v in cap:  # short cut: only the top of the head
            if v.co.z < hz - 0.01:
                v.co.z = hz - 0.01 + (v.co.z - (hz - 0.01)) * 0.15

    def leg(side):
        def build(r):
            x = 0
            if female:
                r.cyl(0.06, 0.055, 0.42, x, 0, -0.42, pants, seg=10)
                r.cyl(0.05, 0.04, 0.45, x, 0, -0.87, m["skin"], seg=10)
            else:
                r.cyl(0.075, 0.06, 0.45, x, 0, -0.45, pants, seg=10)
                r.cyl(0.06, 0.05, 0.42, x, 0, -0.87, pants, seg=10)
            r.box(0.1, 0.26, 0.08, x, -0.05, -0.95, m["shoes"], bevel=0.03)
        return build
    hip = 1.0 if not female else 0.95
    for side, x in (("LegL", 0.09), ("LegR", -0.09)):
        b.sub(side, leg(side), (x, 0, hip))

    def arm(side, s_):
        def build(r):
            r.sphere(0.065, 0, 0, 0, m["paint"], seg=10)
            r.cyl(0.055, 0.048, 0.3, 0, 0, -0.32, m["paint"], seg=10)
            r.cyl(0.042, 0.036, 0.27, 0, 0, -0.6, m["skin"], seg=10)
            r.box(0.06, 0.035, 0.09, 0, 0, -0.7, m["skin"], bevel=0.015)  # hand
            r.box(0.02, 0.03, 0.05, s_ * 0.035, -0.02, -0.67, m["skin"])  # thumb
        return build
    for side, x, s_ in (("ArmL", sh + 0.03, 1), ("ArmR", -sh - 0.03, -1)):
        b.sub(side, arm(side, s_), (x, 0, 1.4))
    export(b, name)


def restaurant(v, m):
    walls = [m["brick"], m["plaster_c"], m["plaster_p"]][v % 3]
    name = ["BISTRO", "PIZZERIA", "DINER"][v % 3]
    b = Builder(f"restaurant_{v}")
    b.ground(9.8, 9.8, m["concrete"], z=0.03)
    b.box(8.6, 6.2, 4.4, 0, 1.4, 0, walls, bevel=0.03)
    b.gable_roof(8.6, 6.2, 2.0, 0, 1.4, 4.4, m["roof_r"] if v % 2 == 0 else m["roof_s"], walls)
    front = 1.4 - 3.1
    for x in (-2.6, 0.0, 2.6):
        b.window(1.8, 2.0, x, front, 0.7, "-y", m)
    b.box(1.0, 0.12, 2.2, 3.7, front - 0.02, 0, m["wood"])
    b.box(4.2, 0.2, 0.8, 0, front - 0.1, 3.2, m["green"] if v % 2 else m["red"])
    b.text(name, 0.5, 0, front - 0.22, 3.6, m["trim"], depth=0.04)
    b.box(0.7, 0.7, 2.0, -3.0, 2.6, 5.6, m["brick"])  # kitchen chimney
    b.emitter("Steam", -3.0, 2.6, 7.8)
    for k in range(3):  # terrace: tables, chairs, parasols
        x = -3 + k * 3
        b.cyl(0.4, 0.4, 0.04, x, -3.4, 0.74, m["white"], seg=12)
        b.cyl(0.035, 0.035, 0.74, x, -3.4, 0, m["dark_steel"], seg=6)
        b.cyl(0.03, 0.03, 2.3, x, -3.4, 0.78, m["steel"], seg=6)
        b.cyl(1.25, 0.05, 0.45, x, -3.4, 2.3, m["awning_r"] if k % 2 else m["awning_g"], seg=8)
        for cx in (-0.65, 0.65):
            b.box(0.4, 0.4, 0.05, x + cx, -3.4, 0.45, m["wood"])
            b.box(0.4, 0.05, 0.45, x + cx, -3.2, 0.5, m["wood"])
    export(b, f"restaurant_{v}")


def bank(m):
    stone = material("Stone", "concrete.jpg", uv=3.0)
    gold = material("Gold", None, (0.85, 0.65, 0.2), rough=0.3, metal=1.0)
    b = Builder("bank")
    b.ground(9.8, 9.8, m["concrete"], z=0.03)
    for k in range(3):  # steps
        b.box(8.2 - k * 0.4, 1.4 - k * 0.35, 0.18, 0, -3.4 + k * 0.18, k * 0.18, stone)
    b.box(8.0, 6.0, 6.0, 0, 1.0, 0.5, m["plaster_w"], bevel=0.03)
    b.box(8.4, 6.4, 0.5, 0, 1.0, 6.5, stone)
    for x in (-3.0, -1.0, 1.0, 3.0):  # portico columns
        b.cyl(0.32, 0.28, 5.0, x, -2.6, 0.54, stone, seg=16)
        b.box(0.8, 0.8, 0.25, x, -2.6, 5.5, stone)
    b.box(8.2, 1.6, 0.6, 0, -2.4, 5.7, stone)
    vs = b.box(8.2, 0.4, 1.3, 0, 0, 0, stone)
    for v in vs:  # triangular pediment
        if v.co.z > 0.6:
            v.co.x *= 0.02
    bmesh.ops.transform(b.bm, matrix=Matrix.Translation((0, -2.6, 6.3)), verts=vs)
    b.text("BANK", 0.75, 0, -3.25, 5.95, gold, depth=0.05)
    b.box(1.6, 0.12, 2.8, 0, -2.0, 0.54, m["window"])
    for x in (-2.6, 2.6):
        b.window(1.2, 2.2, x, -2.0, 1.8, "-y", m)
    export(b, "bank")


def university(m):
    b = Builder("university")
    b.ground(19.6, 19.6, m["grass"], z=0.03)
    b.box(3.0, 9.0, 0.04, 0, -5.0, 0.04, m["gravel"])
    b.box(17, 8, 9.5, 0, 4.5, 0, m["brick"], bevel=0.04)
    b.gable_roof(17, 8, 3.2, 0, 4.5, 9.5, m["roof_s"], m["brick"])
    for f in range(3):
        for k in range(8):
            x = -7.5 + k * 2.14
            if f == 0 and k in (3, 4):
                continue
            b.window(1.2, 1.8, x, 0.5, 1.0 + f * 3.0, "-y", m)
    for x in (-1.8, -0.6, 0.6, 1.8):
        b.cyl(0.25, 0.22, 5.5, x, -0.4, 0, m["plaster_w"], seg=14)
    b.box(5.0, 1.6, 0.6, 0, -0.2, 5.5, m["plaster_w"])
    b.text("UNIVERSITY", 0.6, 0, -1.02, 5.8, m["trim"], depth=0.04)
    b.box(3.0, 3.0, 17.0, 0, 4.5, 0, m["brick"])  # clock tower
    b.box(3.4, 3.4, 0.4, 0, 4.5, 17.0, m["plaster_w"])
    b.cyl(1.9, 0.05, 4.5, 0, 4.5, 17.4, m["roof_s"], seg=4)
    face = material("ClockFace", None, (0.95, 0.94, 0.88), rough=0.4)
    b.cyl(1.0, 1.0, 0.1, 0, 2.95, 14.2, face, seg=24, rx=math.pi / 2, center=True)
    b.box(0.06, 0.04, 0.8, 0, 2.88, 14.2, m["black"])
    b.box(0.6, 0.04, 0.06, 0.25, 2.88, 14.2, m["black"])
    for (x, y) in [(-6, -6), (6, -6), (-6, -3), (6, -3)]:
        tree_into(b, m, x, y, 0.55, seed=int(x * 3 + y))
    export(b, "university")


def yard(m):
    hivis = material("HiVis", None, (1.0, 0.45, 0.02), rough=0.5)
    b = Builder("yard")
    b.ground(19.6, 19.6, m["dirt"], z=0.03)
    for k in range(20):  # site fence
        a = k / 20
        for (x, y) in [(-9.5 + a * 19, -9.5), (-9.5 + a * 19, 9.5), (-9.5, -9.5 + a * 19), (9.5, -9.5 + a * 19)]:
            b.cyl(0.04, 0.04, 2.0, x, y, 0, m["steel"], seg=4)
    # tower crane: lattice mast, jib, counter-jib, cab and counterweights
    for z in range(0, 30, 3):
        for (dx, dy) in [(-0.8, -0.8), (0.8, -0.8), (-0.8, 0.8), (0.8, 0.8)]:
            b.box(0.12, 0.12, 3.0, -5 + dx, 5 + dy, z, m["yellow"])
        b.box(1.7, 0.08, 0.08, -5, 4.2, z + 1.5, m["yellow"], rx=0.9)
        b.box(0.08, 1.7, 0.08, -5.8, 5, z + 1.5, m["yellow"], ry=0.9)
    b.box(1.8, 1.8, 0.5, -5, 5, 0, m["concrete"])
    b.box(22, 0.9, 0.9, 2.0, 5, 30, m["yellow"])
    b.box(6, 1.2, 1.2, -10.5, 5, 29.8, m["yellow"])
    b.box(2.0, 1.6, 1.6, -12.0, 5, 28.2, m["concrete"])
    b.box(1.6, 1.4, 1.6, -5, 3.9, 28.4, m["window"])
    b.cyl(0.02, 0.02, 14, 9.0, 5, 16, m["dark_steel"], seg=4)
    b.box(1.2, 1.2, 0.4, 9.0, 5, 15.6, m["yellow"])
    # materials: pallets of bricks, steel beams, pipes
    for k in range(3):
        b.box(1.2, 1.0, 0.15, 3 + k * 1.6, -5, 0, m["wood"])
        b.box(1.1, 0.9, 0.8, 3 + k * 1.6, -5, 0.15, m["brick"])
    for k in range(4):
        b.box(5.0, 0.25, 0.3, 4.0, -1.5 + k * 0.4, 0, m["red"])
    for k in range(3):
        b.cyl(0.4, 0.4, 5, 2.5, 1.5 + k * 0.85, 0.4, m["concrete"], seg=12, ry=math.pi / 2, center=True)
    # site office container and an excavator
    b.box(6, 2.4, 2.6, -4.5, -7.5, 0, m["metal_b"], bevel=0.04)
    b.text("BUILDCO", 0.6, -4.5, -8.72, 1.6, m["trim"], depth=0.03)
    b.box(2.6, 3.4, 0.8, 5.5, 6.5, 0, m["dark_steel"], bevel=0.1)
    b.box(2.4, 2.4, 1.6, 5.5, 6.8, 0.8, m["yellow"], bevel=0.1)
    b.box(1.2, 1.2, 1.2, 5.0, 5.9, 2.4, m["window"])
    vs = b.box(0.5, 3.5, 0.5, 0, 0, 0, m["yellow"], rx=-0.5)
    bmesh.ops.transform(b.bm, matrix=Matrix.Translation((5.5, 4.2, 2.6)), verts=vs)
    b.box(1.0, 0.8, 0.8, 5.5, 2.6, 0.6, m["dark_steel"])
    b.box(0.6, 0.6, 1.0, 1.0, -8.5, 0, hivis)  # traffic barrels / cones
    export(b, "yard")


def streetlight(m):
    b = Builder("streetlight")
    b.cyl(0.14, 0.09, 7.5, 0, 0, 0, m["dark_steel"], seg=10)
    b.cyl(0.22, 0.22, 0.4, 0, 0, 0, m["dark_steel"], seg=10)
    b.box(0.12, 2.0, 0.12, 0, 0.95, 7.3, m["dark_steel"])
    b.box(0.5, 0.9, 0.2, 0, 1.9, 7.15, m["dark_steel"], bevel=0.05)
    b.box(0.38, 0.7, 0.05, 0, 1.9, 7.1, m["lamp"])
    export(b, "streetlight")


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    m = M()
    print("Building assets ->", OUT)
    for v in range(5):
        house(v, m)
    for v in range(3):
        apartment(v, m)
    for v in range(4):
        office(v, m)
        shop(v, m)
    for v in range(3):
        farm(v, m)
    for v in range(2):
        park(v, m)
        oak(v, m)
        pine(v, m)
    factory(m); coal(m); solar(m); wind(m); pump(m); tower(m); landfill(m)
    school(m); hospital(m); police(m); fire(m)
    for v in range(3):
        restaurant(v, m)
    bank(m); university(m); yard(m)
    station(m); locomotive(m); carriage(m); airport(m); plane(m); port(m); cargo_ship(m); ferry(m); sailboat(m)
    car(m); truck(m); person(m); person(m, female=True); streetlight(m)
    print("done")


if __name__ == "__main__":
    main()
