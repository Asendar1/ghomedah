// glb-to-map — regenerates the collision tables in server/config.ts from the
// hand-built office.glb. Run:  node map/glb-to-map.cjs
//   * wall*   node bounding boxes -> MAP.walls  (collinear modules merged)
//   * cabinet_N node bounding boxes -> MAP.cabinets (search zones, id = N)
// The model is the visual; these rects are the collision. Re-run after every
// Blender edit, then paste the printed block into server/config.ts.
const fs = require("fs");
const path = require("path");

const GLB = path.join(__dirname, "..", "client", "public", "models", "props", "office.glb");
const PX = 0.0375; // metres per game px
const HALF = 880; // MAP_SIZE/2 for the 1760 px arena

// ---- minimal glTF: parse JSON chunk
const buf = fs.readFileSync(GLB);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8"));

// ---- mat4 helpers (column-major, glTF convention)
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const compose = (n) => {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
};
const xf = (m, v) => ({
  x: m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  y: m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  z: m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
});

// ---- walk scene, collect named world AABBs
const nodes = json.nodes ?? [];
const world = new Map(); // index -> world matrix
const visit = (i, parent) => {
  const m = mul(parent, compose(nodes[i]));
  world.set(i, m);
  for (const c of nodes[i].children ?? []) visit(c, m);
};
for (const s of json.scenes?.[0]?.nodes ?? []) visit(s, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const pieces = [];
for (const [i, n] of nodes.entries()) {
  if (!n.mesh || !n.name) continue;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  let any = false;
  for (const p of json.meshes[n.mesh].primitives ?? []) {
    const a = json.accessors?.[p.attributes?.POSITION];
    if (!a?.min) continue;
    any = true;
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], a.min[k]);
      mx[k] = Math.max(mx[k], a.max[k]);
    }
  }
  if (!any) continue;
  const m = world.get(i);
  let wmn = [1e9, 1e9, 1e9], wmx = [-1e9, -1e9, -1e9];
  for (const cx of [mn[0], mx[0]])
    for (const cy of [mn[1], mx[1]])
      for (const cz of [mn[2], mx[2]]) {
        const v = xf(m, [cx, cy, cz]);
        wmn = [Math.min(wmn[0], v.x), Math.min(wmn[1], v.y), Math.min(wmn[2], v.z)];
        wmx = [Math.max(wmx[0], v.x), Math.max(wmx[1], v.y), Math.max(wmx[2], v.z)];
      }
  // glTF y-up: game x = x, game z = z; px = m / 0.0375 + 864
  pieces.push({
    name: n.name,
    x0: wmn[0] / PX + HALF, y0: wmn[2] / PX + HALF,
    x1: wmx[0] / PX + HALF, y1: wmx[2] / PX + HALF,
    height: wmx[1] - wmn[1],
  });
}

// ---- walls: merge collinear contiguous modules into runs
const walls = pieces.filter((p) => p.name.startsWith("wall"));
const runs = [];
for (const w of walls) {
  const horiz = w.x1 - w.x0 >= w.y1 - w.y0;
  const hit = runs.find(
    (r) =>
      r.horiz === horiz &&
      Math.abs((horiz ? r.cy : r.cx) - (horiz ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2)) < 6 &&
      (horiz
        ? w.x0 < r.x1 + 6 && w.x1 > r.x0 - 6
        : w.y0 < r.y1 + 6 && w.y1 > r.y0 - 6),
  );
  if (hit) {
    hit.x0 = Math.min(hit.x0, w.x0); hit.x1 = Math.max(hit.x1, w.x1);
    hit.y0 = Math.min(hit.y0, w.y0); hit.y1 = Math.max(hit.y1, w.y1);
    hit.cx = (hit.x0 + hit.x1) / 2; hit.cy = (hit.y0 + hit.y1) / 2;
  } else {
    runs.push({
      horiz, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1,
      cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2,
    });
  }
}
// second pass: absorb leftovers whose centres now coincide with a merged run
for (let pass = 0; pass < 3; pass++) {
  for (let i = runs.length - 1; i >= 0; i--) {
    const a = runs[i];
    const hit = runs.find(
      (b) =>
        b !== a && b.horiz === a.horiz &&
        Math.abs((b.horiz ? b.cy : b.cx) - (a.horiz ? a.cy : a.cx)) < 6 &&
        (b.horiz ? a.x0 < b.x1 + 6 && a.x1 > b.x0 - 6 : a.y0 < b.y1 + 6 && a.y1 > b.y0 - 6),
    );
    if (hit) {
      hit.x0 = Math.min(hit.x0, a.x0); hit.x1 = Math.max(hit.x1, a.x1);
      hit.y0 = Math.min(hit.y0, a.y0); hit.y1 = Math.max(hit.y1, a.y1);
      hit.cx = (hit.x0 + hit.x1) / 2; hit.cy = (hit.y0 + hit.y1) / 2;
      runs.splice(i, 1);
    }
  }
}
runs.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

// ---- cabinets: chest body bboxes, id from the node name
const cabs = pieces
  .map((p) => ({ p, m: /^cabinet_(\d+)/.exec(p.name) }))
  .filter((x) => x.m)
  .map(({ p, m }) => ({
    id: Number(m[1]),
    x: Math.round(p.x0), y: Math.round(p.y0),
    w: Math.round(p.x1 - p.x0), h: Math.round(p.y1 - p.y0),
  }))
  .sort((a, b) => a.id - b.id);

// ---- report + the paste-ready block
const r = (v) => Math.round(v);
console.log(`walls: ${walls.length} modules -> ${runs.length} runs`);
console.log(`cabinets: ${cabs.length}`);
const all = [...runs.map((x) => [x.x0, x.y0, x.x1, x.y1]), ...cabs.map((c) => [c.x, c.y, c.x + c.w, c.y + c.h])];
console.log(`px extents: x ${r(Math.min(...all.map((a) => a[0])))}..${r(Math.max(...all.map((a) => a[2])))}  y ${r(Math.min(...all.map((a) => a[1])))}..${r(Math.max(...all.map((a) => a[3])))}`);
if (runs.length === 0 || cabs.length === 0) throw new Error("empty result — check node names in the glb");
console.log("\n---- paste into server/config.ts ----");
console.log("\twalls: [");
for (const x of runs) console.log(`\t\t{ x: ${r(x.x0)}, y: ${r(x.y0)}, w: ${r(x.x1 - x.x0)}, h: ${r(x.y1 - x.y0)} },`);
console.log("\t] satisfies Rect[],");
console.log("\tcabinets: [");
for (const c of cabs) console.log(`\t\t{ x: ${c.x}, y: ${c.y}, w: ${c.w}, h: ${c.h}, id: ${c.id}, search: false },`);
console.log("\t] satisfies Cabinet[],");
