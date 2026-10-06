export interface Input {
	w: boolean;
	s: boolean;
	a: boolean;
	d: boolean;
	e: boolean; // hold-E: wants to search. The server checks you're actually near a cabinet.
}

export type Phase = "SEARCH" | "HUNT" | "END";
export type Role = "prey" | "hunter" | "zombie";

export interface WirePlayer {
	id: string;
	x: number;
	y: number;
	role: Role;
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

export type ClientMsg = { type: "input"; payload: Input } | { type: "attack" };

export type ServerMsg =
	| { type: "welcome"; payload: { id: string } }
	| { type: "snapshot"; tick: number; players: WirePlayer[] }
	| { type: "map"; walls: Rect[]; cabinets: Cabinet[]; searchRange: number; searchTime: number }
	| { type: "boxSearched"; id: number }
	| { type: "phase"; phase: Phase; endsAt: number; winner: "prey" | "hunters" | null };
