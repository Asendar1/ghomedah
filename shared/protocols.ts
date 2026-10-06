export interface Input {
	w: boolean;
	s: boolean;
	a: boolean;
	d: boolean;
	e: boolean; // hold-E: wants to search. The server checks you're actually near a cabinet.
	lit: boolean; // flashlight toggle (F flips it client-side). Display-only: the server relays it so every client can hide that player's beam.
}

export type Phase = "SEARCH" | "HUNT" | "END";
export type Role = "prey" | "hunter" | "zombie";

export interface WirePlayer {
	id: string;
	x: number;
	y: number;
	role: Role;
	lit: boolean; // flashlight on — display-only relay of that player's input bit
	ghost: { x: number; y: number } | null; // the blink-echo copy of a hiding prey, when visible
	score: number; // session points — survives round resets
	name: string; // display name (sanitized server-side; default P1, P2, ...)
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

export type ClientMsg =
	| { type: "input"; payload: Input }
	| { type: "attack" }
	| { type: "name"; payload: { name: string } };

export type ServerMsg =
	| { type: "welcome"; payload: { id: string } }
	| { type: "snapshot"; tick: number; players: WirePlayer[] }
	| { type: "map"; walls: Rect[]; cabinets: Cabinet[]; searchRange: number; searchTime: number }
	| { type: "boxSearched"; id: number }
	| { type: "newRound" }
	| { type: "phase"; phase: Phase; endsAt: number; winner: "prey" | "hunters" | null; round: number };
