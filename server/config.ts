import type { Cabinet, Light, Rect } from "@ghomedah/shared";

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

// Ceiling lamps start helping the hunter this many wall-ms into the hunt:
// a lamp switches on wherever prey are hiding within LIGHT_REACH of it.
export const LIGHT_DELAY = 60_000;

// Lamp trigger/lit radius in px (must match the client's rendered pool).
export const LIGHT_REACH = 130;

// How long a lamp flutters as a hint (wall-ms) before it goes dark again.
// Leaving its reach re-arms it, so hiding there again hints once more.
export const LIGHT_HINT = 5_000;

// How long the result stays on screen before the room resets itself.
export const END_TIME = 10_000;

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

// The office. Single source of truth for shape: the server collides with these
// rects, the client draws boxes from them. Blockout v1 — nudge by eye.
export const MAP = {
	walls: [
		// border
		{ x: 0, y: 0, w: 800, h: 24 },
		{ x: 0, y: 776, w: 800, h: 24 },
		{ x: 0, y: 0, w: 24, h: 800 },
		{ x: 776, y: 0, w: 24, h: 800 },
		// left divider — doorway between the two segments
		{ x: 200, y: 24, w: 24, h: 280 },
		{ x: 200, y: 460, w: 24, h: 316 },
		// right divider — pass around its left end
		{ x: 520, y: 280, w: 256, h: 24 },
		// lower-right partial wall
		{ x: 560, y: 540, w: 216, h: 24 },
		// center pillar
		{ x: 360, y: 360, w: 80, h: 80 },
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
	// ceiling lamps — one per office area. LIGHT_DELAY into the hunt they light
	// up wherever prey are hiding in reach, giving the hunter away-they're-hiding.
	lights: [
		{ x: 100, y: 200 },
		{ x: 100, y: 550 },
		{ x: 420, y: 150 },
		{ x: 400, y: 570 },
		{ x: 650, y: 620 },
		{ x: 700, y: 200 },
	] satisfies Light[],
};

// Collision solids: every rect inflated by the player radius (Minkowski).
// Lives here so helper.ts can import it without a server⇄helper cycle.
export const solids = [...MAP.walls, ...MAP.cabinets].map((r) => ({
	x: r.x - PLAYER_R,
	y: r.y - PLAYER_R,
	w: r.w + 2 * PLAYER_R,
	h: r.h + 2 * PLAYER_R,
}));
