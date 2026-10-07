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

// Where fresh players spawn (px) — hand-set to the office floor. The re-roll
// loop still keeps them out of solids, so this only needs to be the room.
export const SPAWN_BOUNDS = { x: 187, y: 300, w: 414, h: 252 };

// The play area in game pixels. The px grid is FIXED (1 px = 3.75 cm — speeds,
// reach and collision are all in these units); a bigger office = a bigger
// number here + new MAP rects inside it. The client centres the world on
// size / 2, and it rides the map msg so nothing drifts.
export const MAP_SIZE = 800;

// The office. Single source of truth for shape: the server collides with these
// rects, the client draws boxes from them. Blockout v1 — nudge by eye.
export const MAP = {
	walls: [
		// the hand-modelled office (office.glb) — rects generated from its
		// wall* node bounding boxes (world m / 0.0375 + 400). The model is the
		// visual; these rects are the collision. One rect per straight run.
		{ x: 286, y: 255, w: 107, h: 40 }, // wall.001
		{ x: 180, y: 255, w: 107, h: 40 }, // wall.002
		{ x: 423, y: 253, w: 108, h: 43 }, // wall.003
		{ x: 530, y: 255, w: 107, h: 40 }, // wall.004
		{ x: 140, y: 255, w: 40, h: 107 }, // wall.005
		{ x: 140, y: 423, w: 40, h: 106 }, // wall.006
		{ x: 180, y: 558, w: 107, h: 40 }, // wall.007
		{ x: 285, y: 558, w: 107, h: 40 }, // wall.008
		{ x: 426, y: 558, w: 107, h: 40 }, // wall.009
		{ x: 531, y: 558, w: 107, h: 40 }, // wall.010
		{ x: 606, y: 452, w: 40, h: 107 }, // wall.011
		{ x: 606, y: 292, w: 40, h: 106 }, // wall.012
		{ x: 353, y: 195, w: 40, h: 84 }, // wall.013
		{ x: 424, y: 195, w: 40, h: 84 }, // wall.014
		{ x: 552, y: 195, w: 76, h: 84 }, // wall.015
		{ x: 491, y: 195, w: 84, h: 9 }, // wall.016
		// (the export still carries the old 4x4 test wall parked at py -105 —
		// beyond the arena, so no rect: delete it in Blender)
	] satisfies Rect[],
	cabinets: [
		{ x: 80, y: 80, w: 56, h: 44, id: 1, search: false },
		{ x: 320, y: 120, w: 56, h: 44, id: 2, search: false },
		{ x: 600, y: 120, w: 56, h: 44, id: 3, search: false },
		{ x: 80, y: 320, w: 56, h: 44, id: 4, search: false },
		{ x: 90, y: 620, w: 56, h: 44, id: 5, search: false },
		{ x: 480, y: 620, w: 56, h: 44, id: 6, search: false },
		{ x: 300, y: 680, w: 56, h: 44, id: 7, search: false },
		{ x: 640, y: 680, w: 56, h: 44, id: 8, search: false },
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
