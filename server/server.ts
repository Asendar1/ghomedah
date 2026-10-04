import { WebSocketServer, WebSocket } from "ws";
import { getRandomPos } from "./helper.ts";
import type { ClientMsg, Input, ServerMsg } from "@ghomedah/shared";

const TICK_MS = 1000 / 30; // 30 ticks per second
const wss = new WebSocketServer({ port: 8787 });
let tick = 0;

// server-internal storage shape — NOT part of the wire contract
interface Players {
	id: string;
	x: number;
	y: number;
	inputs: Input;
}

interface CustomWebScoket extends WebSocket {
	id: string;
}

const players = new Map<string, Players>();

const SPEED = 5;

wss.on("connection", (ws: CustomWebScoket) => {
	ws.id = crypto.randomUUID();
	const newPlayer: Players = {
		id: ws.id,
		x: getRandomPos(),
		y: getRandomPos(),
		inputs: { w: false, s: false, a: false, d: false },
	};
	players.set(ws.id, newPlayer);
	const welcome: ServerMsg = { type: "welcome", payload: { id: ws.id } };
	ws.send(JSON.stringify(welcome));

	ws.on("message", (rawMsg: string) => {
		try {
			const msg = JSON.parse(rawMsg) as ClientMsg; // compile-time assertion — the runtime whitelist below stays the real defense

			if (msg.type === "input") {
				const player = players.get(ws.id);
				if (player) {
					const p = msg.payload;
					player.inputs = { w: !!p?.w, s: !!p?.s, a: !!p?.a, d: !!p?.d };
				}
			}
		} catch (err) {
			console.error("failed to parse incoming player message: ", err);
		}
	});

	ws.on("close", () => {
		players.delete(ws.id);
	});
});

setInterval(() => {
	tick++;

	players.forEach((v, k) => {
		const player: Players = players.get(k) as Players;

		const i = player.inputs;
		const dx = (i.d ? 1 : 0) - (i.a ? 1 : 0);
		const dy = (i.s ? 1 : 0) - (i.w ? 1 : 0);
		const len = Math.hypot(dx, dy) || 1;

		player.x += (dx / len) * SPEED;
		player.y += (dy / len) * SPEED;

		player.x = Math.max(10, Math.min(790, player.x));
		player.y = Math.max(10, Math.min(790, player.y));
	});

	const snap: ServerMsg = {
		type: "snapshot",
		tick,
		players: Array.from(players.values(), ({ id, x, y }) => ({ id, x, y })),
	};
	const snapJson = JSON.stringify(snap);
	for (const c of wss.clients)
		if (c.readyState === WebSocket.OPEN) c.send(snapJson);
}, TICK_MS);
