import type { ClientMsg, Input, ServerMsg } from "@ghomedah/shared";

type SnapshotMsg = Extract<ServerMsg, { type: "snapshot" }>;

export type Snapshot = SnapshotMsg & {
	at: number;
};

type MapMsg = Extract<ServerMsg, { type: "map" }>;

export const samples: Snapshot[] = [];
export let id: string | null = null;
export let mapData: MapMsg | null = null;
export let phase: Extract<ServerMsg, { type: "phase" }> | null = null;

// phase changes are rare (a few per round) — let the shell react immediately
type PhaseMsg = Extract<ServerMsg, { type: "phase" }>;
const phaseListeners: ((m: PhaseMsg) => void)[] = [];
export function onPhase(fn: (m: PhaseMsg) => void) {
	phaseListeners.push(fn);
}

const room = new URLSearchParams(location.search).get("room") ?? "lobby";
const scheme = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${scheme}//${location.host}/ws?room=${room}`);

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
	} else if (msg.type === "phase") {
		phase = msg;
		for (const fn of phaseListeners) fn(msg);
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

// left-click = attack (one swing per click). A click is an EVENT — sent as one
// message so it can't fall between ticks like a sampled held-bit could.
function onMouseDown(e: MouseEvent) {
	if (e.button !== 0) return;
	const msg: ClientMsg = { type: "attack" };
	ws.send(JSON.stringify(msg));
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", onBlur);
window.addEventListener("mousedown", onMouseDown);

// dev-only: on hot reload, dispose this module's socket + listeners,
// otherwise every save leaks a connection and a set of listeners
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		ws.close();
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("keyup", onKeyUp);
		window.removeEventListener("blur", onBlur);
		window.removeEventListener("mousedown", onMouseDown);
	});
}
