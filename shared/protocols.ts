// The wire contract: every shape that crosses the websocket lives here.
// Rule: wire shapes → this file; process-internal shapes → their own package.

export interface Input {
	w: boolean;
	s: boolean;
	a: boolean;
	d: boolean;
}

export interface WirePlayer {
	id: string;
	x: number;
	y: number;
}

// A rectangle in game space (0..800). x,y = top-left corner.
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type ClientMsg = { type: "input"; payload: Input };

export type ServerMsg =
	| { type: "welcome"; payload: { id: string } }
	| { type: "snapshot"; tick: number; players: WirePlayer[] }
	| { type: "map"; walls: Rect[]; cabinets: Rect[] };
