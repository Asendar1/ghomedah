import type { Cabinet, Rect } from "@ghomedah/shared";

// Balance knobs + the office layout. The one place to turn dials.
export const SPEED = 5; // game px per tick

// Player hitbox radius in game px — matches the capsule's 1 world unit (≈26.7 px).
export const PLAYER_R = 26;

// Search reach: how far from a cabinet's edge (game px) a search can trigger.
// Must exceed PLAYER_R to be reachable; the usable band = SEARCH_RANGE - PLAYER_R. Tune by feel.
export const SEARCH_RANGE = 40;

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
};
