// Transport + world state.
// Owns: the socket, your id, the snapshot ring, keyboard input.
// The renderer reads across the seam: samples + id.

import type { ClientMsg, Input, ServerMsg } from "@ghomedah/shared";

type SnapshotMsg = Extract<ServerMsg, { type: "snapshot" }>;

export type Snapshot = SnapshotMsg & {
	at: number; // arrival time (performance.now) — client-only field, added here
};

// -- the seam: the only things the renderer is allowed to read --
export const samples: Snapshot[] = [];
export let id: string | null = null; // live binding: importers see the update when welcome lands

const ws = new WebSocket("ws://localhost:8787");

ws.addEventListener("message", (e) => {
	const msg = JSON.parse(e.data) as ServerMsg; // assertion — the `type` field narrows the union below

	if (msg.type === "welcome") {
		id = msg.payload.id;
	} else if (msg.type === "snapshot") {
		samples.push({ ...msg, at: performance.now() });
		if (samples.length > 3) samples.shift();
	}
});

// -- input --
type Key = keyof Input;

const inputs: Input = { w: false, s: false, a: false, d: false };

function sendInput() {
	const msg: ClientMsg = { type: "input", payload: inputs };
	ws.send(JSON.stringify(msg));
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
