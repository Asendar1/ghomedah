// occupancy-to-config — turns the Blender raycast grid (map/office-occupancy.json)
// into the game's collision tables. Blockers = every non-floor cell (walls,
// furniture AND the void outside the slice edge). Cabinets + spawn are picked
// from open floor cells. Blender plan (x,y,z-up) -> glTF/game (x, up, z=-y).
// run: node map/occupancy-to-config.cjs
const fs = require("fs");
const path = require("path");

const grid = JSON.parse(fs.readFileSync(path.join(__dirname, "office-occupancy.json"), "utf8"));
const { x0, y0, step, cols, rows, cells } = grid;
const PX = 0.0375;
const HALF = 880;

// cell (r,c) -> game meters of the cell centre
const gx = (c) => x0 + (c + 0.5) * step;
const gz = (r) => -(y0 + (r + 0.5) * step);
const px = (m) => Math.round(m / PX + HALF);

// ---- merge all non-floor cells into rects (greedy: widest run, then down)
const block = cells.map((row) => row.map((v) => v !== 1));
const used = cells.map((row) => row.map(() => false));
const rects = [];
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (!block[r][c] || used[r][c]) continue;
    let c1 = c;
    while (c1 + 1 < cols && block[r][c1 + 1] && !used[r][c1 + 1]) c1++;
    let r1 = r;
    grow: while (r1 + 1 < rows) {
      for (let cc = c; cc <= c1; cc++) {
        if (!block[r1 + 1][cc] || used[r1 + 1][cc]) break grow;
      }
      r1++;
    }
    for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr][cc] = true;
    rects.push({ c0: c, c1, r0: r, r1 });
  }
}

// rect -> px: game z from -(blender y); note rows grow with blender y
const walls = [];
for (const { c0, c1, r0, r1 } of rects) {
  const xa = px(x0 + c0 * step);
  const xb = px(x0 + (c1 + 1) * step);
  const za = px(-(y0 + (r1 + 1) * step));
  const zb = px(-(y0 + r0 * step));
  walls.push({ x: xa, y: za, w: xb - xa, h: zb - za });
}
walls.sort((a, b) => a.y - b.y || a.x - b.x);

// ---- cabinets: open floor cells (all 8 neighbours floor), spread >= 4 m
const open = [];
for (let r = 1; r < rows - 1; r++)
  for (let c = 1; c < cols - 1; c++) {
    let ok = cells[r][c] === 1;
    for (let dr = -1; dr <= 1 && ok; dr++)
      for (let dc = -1; dc <= 1 && ok; dc++) if (cells[r + dr][c + dc] !== 1) ok = false;
    if (ok) open.push({ r, c });
  }
// stride across the candidate list so picks span the whole plan, not one band
const picks = [];
const stride = Math.max(1, Math.floor(open.length / 10));
for (const minD of [0, 4.5, 3]) {
  for (let k = 0; k < open.length && picks.length < 10; k += stride) {
    const cell = open[k];
    const gxm = gx(cell.c), gzm = gz(cell.r);
    if (picks.every((p) => Math.hypot(gx(p.c) - gxm, gz(p.r) - gzm) >= minD)) picks.push(cell);
  }
  if (picks.length >= 10) break;
}
if (picks.length < 10) throw new Error(`only ${picks.length} cabinet spots — lower spacing`);
const cabinets = picks.map((cell, i) => {
  const cx = px(gx(cell.c)), cz = px(gz(cell.r));
  return { x: cx - 28, y: cz - 22, w: 56, h: 44, id: i + 1, search: false };
});

// ---- spawn: open cell nearest the plan centre -> a small box there
const spawn = open.reduce((best, cell) =>
  Math.hypot(gx(cell.c), gz(cell.r)) < Math.hypot(gx(best.c), gz(best.r)) ? cell : best,
);
const sb = { x: px(gx(spawn.c)) - 60, y: px(gz(spawn.r)) - 60, w: 120, h: 120 };

console.log(`grid ${cols}x${rows} step ${step.toFixed(3)} | blocked cells -> ${walls.length} rects | cabinets ${cabinets.length}`);
console.log(`spawn cell (${spawn.c},${spawn.r}) -> px ${sb.x},${sb.y}`);
console.log("\n---- paste into server/config.ts ----");
console.log("\twalls: [");
for (const w of walls) console.log(`\t\t{ x: ${w.x}, y: ${w.y}, w: ${w.w}, h: ${w.h} },`);
console.log("\t] satisfies Rect[],");
console.log("\tcabinets: [");
for (const c of cabinets) console.log(`\t\t{ x: ${c.x}, y: ${c.y}, w: ${c.w}, h: ${c.h}, id: ${c.id}, search: false },`);
console.log("\t] satisfies Cabinet[],");
console.log(`\nSPAWN_BOUNDS = { x: ${sb.x}, y: ${sb.y}, w: ${sb.w}, h: ${sb.h} }`);
