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

// every send goes through here: typing before the socket opens (or after it
// dies) must not throw — drop the message instead
function send(msg: ClientMsg) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

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

// e is a held "I want to search" bit — the server checks you're near a cabinet.
// lit is a TOGGLE (F flips it client-side), not a held key — it survives blur
// and is only ever relayed to other clients (display-only).
export const inputs: Input = { w: false, s: false, a: false, d: false, e: false, lit: true };

function sendInput() {
	send({ type: "input", payload: inputs });
}

function isGameKey(key: string): key is Key {
	return key in inputs;
}

function onKeyDown(e: KeyboardEvent) {
	const key = e.key.toLowerCase();
	if (key === "f") {
		// flashlight toggle — a state, not a held bit. e.repeat guard: holding F
		// must not strobe the beam.
		if (!e.repeat) {
			inputs.lit = !inputs.lit;
			sendInput();
		}
		return;
	}
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
	// clear held keys only — lit is a toggle and must survive alt-tab
	for (const k of Object.keys(inputs) as Key[]) if (k !== "lit") inputs[k] = false;
	sendInput();
}

// left-click = attack (one swing per click). A click is an EVENT — sent as one
// message so it can't fall between ticks like a sampled held-bit could.
function onMouseDown(e: MouseEvent) {
	if (e.button !== 0) return;
	send({ type: "attack" });
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
