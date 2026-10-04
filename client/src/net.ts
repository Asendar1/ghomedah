// Transport + world state.
// Owns: the socket, your id, the snapshot ring, keyboard input.
// The renderer reads across the seam: samples + id.

export interface Player {
	id: string;
	x: number;
	y: number;
}

export interface Snapshot {
	tick: number;
	players: Player[];
	at: number; // arrival time (performance.now) — stamped here, not by the server
}

// -- the seam: the only things the renderer is allowed to read --
export const samples: Snapshot[] = [];
export let id: string | null = null; // live binding: importers see the update when welcome lands

const ws = new WebSocket("ws://localhost:8787");

ws.addEventListener("message", (e) => {
	const data = JSON.parse(e.data); // full protocol typing arrives with shared/protocol.ts (serving 2)

	if (data.type === "welcome") {
		id = data.payload.id;
	} else if (data.type === "snapshot") {
		samples.push({ ...data, at: performance.now() });
		if (samples.length > 3) samples.shift();
	}
});

// -- input --
type Key = "w" | "s" | "a" | "d";

const inputs: Record<Key, boolean> = { w: false, s: false, a: false, d: false };

function sendInput() {
	ws.send(JSON.stringify({ type: "input", payload: inputs }));
}

function isGameKey(key: string): key is Key {
	return key in inputs;
}

function onKeyDown(e: KeyboardEvent) {
	const key = e.key.toLowerCase();
	if (isGameKey(key) && !inputs[key]) {
		inputs[key] = true;
		sendInput();
	}
}

function onKeyUp(e: KeyboardEvent) {
	const key = e.key.toLowerCase();
	if (isGameKey(key) && inputs[key]) {
		inputs[key] = false;
		sendInput();
	}
}

// alt-tab while holding a key: the browser never sends the keyup — clear so you don't run forever
function onBlur() {
	for (const k of Object.keys(inputs) as Key[]) inputs[k] = false;
	sendInput();
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", onBlur);

// dev-only: on hot reload, dispose this module's socket + listeners,
// otherwise every save leaks a connection and a set of listeners
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		ws.close();
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("keyup", onKeyUp);
		window.removeEventListener("blur", onBlur);
	});
}
