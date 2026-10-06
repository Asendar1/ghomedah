export interface Input {
	w: boolean;
	s: boolean;
	a: boolean;
	d: boolean;
	e: boolean; // hold-E: wants to search. The server checks you're actually near a cabinet.
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

export interface Cabinet extends Rect {
	id: number;
	search: boolean;
}

export type ClientMsg = { type: "input"; payload: Input };

export type ServerMsg =
	| { type: "welcome"; payload: { id: string } }
	| { type: "snapshot"; tick: number; players: WirePlayer[] }
	| { type: "map"; walls: Rect[]; cabinets: Cabinet[]; searchRange: number; searchTime: number }
	| { type: "boxSearched"; id: number };
