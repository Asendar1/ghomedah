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
export const SPAWN_BOUNDS = { x: 823, y: 822, w: 120, h: 120 };

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
// The office floor (downloaded model, prepped by map/prep-office2.py; blockers
// generated from its raycast occupancy grid by map/occupancy-to-config.cjs —
// non-floor cells = walls, furniture and the void past the slice edge).
export const MAP = {
	walls: [
		{ x: 595, y: 677, w: 12, h: 297 },
		{ x: 607, y: 677, w: 23, h: 83 },
		{ x: 636, y: 677, w: 6, h: 6 },
		{ x: 672, y: 677, w: 6, h: 18 },
		{ x: 684, y: 677, w: 6, h: 6 },
		{ x: 720, y: 677, w: 5, h: 18 },
		{ x: 731, y: 677, w: 12, h: 6 },
		{ x: 767, y: 677, w: 12, h: 18 },
		{ x: 785, y: 677, w: 6, h: 6 },
		{ x: 821, y: 677, w: 6, h: 18 },
		{ x: 832, y: 677, w: 6, h: 6 },
		{ x: 868, y: 677, w: 6, h: 18 },
		{ x: 880, y: 677, w: 12, h: 83 },
		{ x: 892, y: 677, w: 261, h: 101 },
		{ x: 1153, y: 677, w: 12, h: 357 },
		{ x: 642, y: 754, w: 6, h: 6 },
		{ x: 678, y: 820, w: 6, h: 95 },
		{ x: 999, y: 861, w: 6, h: 12 },
		{ x: 1088, y: 861, w: 6, h: 6 },
		{ x: 1100, y: 861, w: 6, h: 6 },
		{ x: 1124, y: 861, w: 6, h: 6 },
		{ x: 999, y: 885, w: 6, h: 12 },
		{ x: 1088, y: 885, w: 6, h: 6 },
		{ x: 1100, y: 885, w: 6, h: 6 },
		{ x: 1124, y: 885, w: 6, h: 12 },
		{ x: 999, y: 909, w: 6, h: 12 },
		{ x: 1088, y: 909, w: 6, h: 6 },
		{ x: 1100, y: 909, w: 6, h: 12 },
		{ x: 1124, y: 909, w: 6, h: 12 },
		{ x: 999, y: 933, w: 6, h: 11 },
		{ x: 1088, y: 933, w: 6, h: 6 },
		{ x: 1100, y: 933, w: 6, h: 11 },
		{ x: 1124, y: 933, w: 6, h: 11 },
		{ x: 999, y: 956, w: 6, h: 12 },
		{ x: 1088, y: 956, w: 6, h: 6 },
		{ x: 1100, y: 956, w: 6, h: 12 },
		{ x: 1124, y: 962, w: 6, h: 6 },
		{ x: 595, y: 974, w: 18, h: 113 },
		{ x: 613, y: 974, w: 23, h: 12 },
		{ x: 654, y: 974, w: 42, h: 12 },
		{ x: 702, y: 974, w: 18, h: 12 },
		{ x: 773, y: 974, w: 6, h: 6 },
		{ x: 797, y: 974, w: 65, h: 12 },
		{ x: 886, y: 974, w: 6, h: 60 },
		{ x: 999, y: 980, w: 6, h: 12 },
		{ x: 1088, y: 980, w: 6, h: 12 },
		{ x: 1100, y: 980, w: 6, h: 12 },
		{ x: 1124, y: 986, w: 6, h: 6 },
		{ x: 648, y: 1010, w: 36, h: 6 },
		{ x: 702, y: 1010, w: 35, h: 6 },
		{ x: 785, y: 1010, w: 18, h: 6 },
		{ x: 803, y: 1010, w: 6, h: 77 },
		{ x: 809, y: 1010, w: 18, h: 6 },
		{ x: 838, y: 1010, w: 18, h: 6 },
		{ x: 856, y: 1010, w: 6, h: 77 },
		{ x: 862, y: 1010, w: 18, h: 6 },
		{ x: 613, y: 1022, w: 6, h: 6 },
		{ x: 720, y: 1022, w: 5, h: 12 },
		{ x: 767, y: 1022, w: 6, h: 6 },
		{ x: 648, y: 1034, w: 36, h: 6 },
		{ x: 702, y: 1034, w: 35, h: 6 },
		{ x: 785, y: 1034, w: 18, h: 6 },
		{ x: 809, y: 1034, w: 18, h: 6 },
		{ x: 838, y: 1034, w: 18, h: 6 },
		{ x: 862, y: 1034, w: 18, h: 6 },
		{ x: 886, y: 1034, w: 279, h: 53 },
		{ x: 613, y: 1045, w: 6, h: 6 },
		{ x: 690, y: 1045, w: 6, h: 12 },
		{ x: 767, y: 1045, w: 6, h: 6 },
		{ x: 815, y: 1051, w: 6, h: 6 },
		{ x: 613, y: 1057, w: 17, h: 6 },
		{ x: 731, y: 1057, w: 6, h: 6 },
		{ x: 749, y: 1057, w: 18, h: 6 },
		{ x: 613, y: 1069, w: 6, h: 6 },
	] satisfies Rect[],
	cabinets: [
		{ x: 599, y: 1056, w: 56, h: 44, id: 1, search: false },
		{ x: 760, y: 1056, w: 56, h: 44, id: 2, search: false },
		{ x: 914, y: 1003, w: 56, h: 44, id: 3, search: false },
		{ x: 1075, y: 1003, w: 56, h: 44, id: 4, search: false },
		{ x: 677, y: 914, w: 56, h: 44, id: 5, search: false },
		{ x: 831, y: 866, w: 56, h: 44, id: 6, search: false },
		{ x: 992, y: 860, w: 56, h: 44, id: 7, search: false },
		{ x: 588, y: 777, w: 56, h: 44, id: 8, search: false },
		{ x: 742, y: 729, w: 56, h: 44, id: 9, search: false },
		{ x: 1116, y: 890, w: 56, h: 44, id: 10, search: false },
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