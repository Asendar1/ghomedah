import type { Cabinet, Rect } from "@ghomedah/shared";

// Balance knobs + the office layout. The one place to turn dials.
export const SPEED = 7; // game px per tick (real ticks ~21/s on Windows ≈ 150 px/s)

// Player hitbox radius in game px — matches the capsule's 1 world unit (≈26.7 px).
export const PLAYER_R = 10;

// Search reach: how far from a cabinet's edge (game px) a search can trigger.
// Must exceed PLAYER_R to be reachable; the usable band = SEARCH_RANGE - PLAYER_R. Tune by feel.
export const SEARCH_RANGE = 40;

export const SEARCH_TIME = 2000; // 2 seconds

// Hunt phase length (wall ms). The map is small — 90s is plenty.
export const HUNT_TIME = 90_000;

// Ghost flashes: at each of these wall-ms REMAINING in the hunt, a glowing
// copy of every hiding prey appears for GHOST_VISIBLE ms at the spot where
// they stood — once with 30s left, once with 10s left. A late ping, not a loop.
export const GHOST_FLASHES = [30_000, 10_000];
export const GHOST_VISIBLE = 1_000;

// How long the result stays on screen before the room resets itself.
export const END_TIME = 10_000;

// Round scoring (points), awarded live: find the poison, per infection, and
// surviving the hunt with time left on the clock. Tune by feel.
export const SCORE = { find: 25, infect: 75, survive: 100 };

// Infection reach in px — a TAPPED E (one swing) converts the nearest prey
// within this. Must exceed the 52px movement standoff; 55 = pressed up against
// them. Tune by feel.
export const INFECT_REACH = 55;

// Infection cooldown (wall ms): after a swing the infected cannot swing again
// until this elapses. Short enough to keep chases chasing, long enough to give
// prey a window to break away.
export const INFECT_COOLDOWN = 1500;

// Max players per room.
export const MAX_PLAYERS = 8;

// Where fresh players spawn (px) — the assembly hall's floor. The re-roll
// loop still keeps them out of solids, so this only needs to be the room.
export const SPAWN_BOUNDS = { x: 600, y: 813, w: 667, h: 560 };

// The play area in game pixels. The px grid is FIXED (1 px = 3.75 cm — speeds,
// reach and collision are all in these units); a bigger office = a bigger
// number here + new MAP rects inside it. The client centres the world on
// size / 2, and it rides the map msg so nothing drifts.
export const MAP_SIZE = 1760;

// The office. Single source of truth for shape: the server collides with these
// rects, the client draws boxes from them. Blockout v1 — nudge by eye.
// The facility. Single source of truth for shape: the server collides with
// these rects, the client draws boxes from them. Auto-generated from
// office.glb by map/glb-to-map.cjs — rerun that after every Blender edit.
export const MAP = {
	walls: [
		{ x: 80, y: 7, w: 1600, h: 40 },
		{ x: 27, y: 60, w: 107, h: 40 },
		{ x: 560, y: 60, w: 213, h: 40 },
		{ x: 987, y: 60, w: 107, h: 40 },
		{ x: 1627, y: 60, w: 107, h: 40 },
		{ x: 27, y: 167, w: 107, h: 40 },
		{ x: 667, y: 167, w: 107, h: 40 },
		{ x: 1627, y: 167, w: 107, h: 40 },
		{ x: 27, y: 273, w: 107, h: 40 },
		{ x: 667, y: 273, w: 107, h: 40 },
		{ x: 1627, y: 273, w: 107, h: 40 },
		{ x: 27, y: 380, w: 107, h: 40 },
		{ x: 560, y: 380, w: 213, h: 40 },
		{ x: 987, y: 380, w: 107, h: 40 },
		{ x: 1627, y: 380, w: 107, h: 40 },
		{ x: 720, y: 433, w: 107, h: 40 },
		{ x: 933, y: 433, w: 107, h: 40 },
		{ x: 27, y: 487, w: 107, h: 40 },
		{ x: 560, y: 487, w: 107, h: 40 },
		{ x: 987, y: 487, w: 107, h: 40 },
		{ x: 1627, y: 487, w: 107, h: 40 },
		{ x: 27, y: 593, w: 107, h: 40 },
		{ x: 560, y: 593, w: 107, h: 40 },
		{ x: 987, y: 593, w: 107, h: 40 },
		{ x: 1627, y: 593, w: 107, h: 40 },
		{ x: 80, y: 647, w: 427, h: 40 },
		{ x: 613, y: 647, w: 107, h: 40 },
		{ x: 933, y: 647, w: 107, h: 40 },
		{ x: 1147, y: 647, w: 533, h: 40 },
		{ x: 453, y: 700, w: 107, h: 40 },
		{ x: 1200, y: 700, w: 107, h: 40 },
		{ x: 453, y: 807, w: 107, h: 40 },
		{ x: 1200, y: 807, w: 107, h: 40 },
		{ x: 453, y: 913, w: 107, h: 40 },
		{ x: 1200, y: 913, w: 107, h: 40 },
		{ x: 80, y: 967, w: 427, h: 40 },
		{ x: 27, y: 1020, w: 107, h: 40 },
		{ x: 1200, y: 1020, w: 107, h: 40 },
		{ x: 27, y: 1127, w: 107, h: 40 },
		{ x: 240, y: 1127, w: 107, h: 40 },
		{ x: 453, y: 1127, w: 107, h: 40 },
		{ x: 1200, y: 1127, w: 107, h: 40 },
		{ x: 80, y: 1180, w: 213, h: 40 },
		{ x: 400, y: 1180, w: 107, h: 40 },
		{ x: 27, y: 1233, w: 107, h: 40 },
		{ x: 453, y: 1233, w: 107, h: 40 },
		{ x: 1200, y: 1233, w: 107, h: 40 },
		{ x: 507, y: 1287, w: 320, h: 40 },
		{ x: 1040, y: 1287, w: 640, h: 40 },
		{ x: 27, y: 1340, w: 107, h: 40 },
		{ x: 240, y: 1340, w: 107, h: 40 },
		{ x: 453, y: 1340, w: 107, h: 40 },
		{ x: 667, y: 1340, w: 107, h: 40 },
		{ x: 1627, y: 1340, w: 107, h: 40 },
		{ x: 27, y: 1447, w: 107, h: 40 },
		{ x: 240, y: 1447, w: 107, h: 40 },
		{ x: 453, y: 1447, w: 107, h: 40 },
		{ x: 667, y: 1447, w: 107, h: 40 },
		{ x: 1627, y: 1447, w: 107, h: 40 },
		{ x: 80, y: 1500, w: 213, h: 40 },
		{ x: 400, y: 1500, w: 107, h: 40 },
		{ x: 27, y: 1553, w: 107, h: 40 },
		{ x: 453, y: 1553, w: 107, h: 40 },
		{ x: 667, y: 1553, w: 107, h: 40 },
		{ x: 1627, y: 1553, w: 107, h: 40 },
		{ x: 27, y: 1660, w: 107, h: 40 },
		{ x: 240, y: 1660, w: 107, h: 40 },
		{ x: 453, y: 1660, w: 107, h: 40 },
		{ x: 667, y: 1660, w: 107, h: 40 },
		{ x: 1627, y: 1660, w: 107, h: 40 },
		{ x: 80, y: 1713, w: 427, h: 40 },
		{ x: 720, y: 1713, w: 960, h: 40 },
	] satisfies Rect[],
	cabinets: [
		{ x: 407, y: 599, w: 38, h: 29, id: 1, search: false },
		{ x: 834, y: 385, w: 38, h: 29, id: 2, search: false },
		{ x: 1335, y: 492, w: 49, h: 29, id: 3, search: false },
		{ x: 1549, y: 172, w: 49, h: 29, id: 4, search: false },
		{ x: 541, y: 919, w: 38, h: 29, id: 5, search: false },
		{ x: 962, y: 812, w: 49, h: 29, id: 6, search: false },
		{ x: 167, y: 1025, w: 38, h: 29, id: 7, search: false },
		{ x: 375, y: 1319, w: 49, h: 29, id: 8, search: false },
		{ x: 1282, y: 1372, w: 49, h: 29, id: 9, search: false },
		{ x: 1442, y: 1612, w: 49, h: 29, id: 10, search: false },
	] satisfies Cabinet[],
};

// Collision solids: every rect inflated by the player radius (Minkowski).
// Lives here so helper.ts can import it without a server⇄helper cycle.
export const solids = [...MAP.walls, ...MAP.cabinets].map((r) => ({
	x: r.x - PLAYER_R,
	y: r.y - PLAYER_R,
	w: r.w + 2 * PLAYER_R,
	h: r.h + 2 * PLAYER_R,
}));