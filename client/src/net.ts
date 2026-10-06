import type { ClientMsg, Input, ServerMsg } from "@ghomedah/shared";

type SnapshotMsg = Extract<ServerMsg, { type: "snapshot" }>;

export type Snapshot = SnapshotMsg & {
	at: number;
};

type MapMsg = Extract<ServerMsg, { type: "map" }>;

export const samples: Snapshot[] = [];
export let id: string | null = null;
export let mapData: MapMsg | null = null;

const ws = new WebSocket("ws://192.168.100.2:8787");

ws.addEventListener("message", (e) => {
	const msg = JSON.parse(e.data) as ServerMsg;

	if (msg.type === "welcome") {
		id = msg.payload.id;
	} else if (msg.type === "snapshot") {
		samples.push({ ...msg, at: performance.now() });
		if (samples.length > 3) samples.shift();
	} else if (msg.type === "map") {
		mapData = msg;
	} else if (msg.type === "boxSearched") {
		const box = mapData?.cabinets.find((c) => c.id === msg.id);
		if (box) box.search = true;
	}
});

// -- input --
type Key = keyof Input;

// e is a held "I want to search" bit — the server checks you're near a cabinet
export const inputs: Input = { w: false, s: false, a: false, d: false, e: false };

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
