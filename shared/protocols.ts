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

export type ClientMsg = { type: "input"; payload: Input };

export type ServerMsg =
	| { type: "welcome"; payload: { id: string } }
	| { type: "snapshot"; tick: number; players: WirePlayer[] };
