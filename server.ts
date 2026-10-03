import { WebSocketServer, WebSocket } from "ws";
import { getRandomPos } from "./helper.ts";

const TICK_MS = 1000 / 30; // 30 ticks per second
const wss = new WebSocketServer({ port: 8787 });
let tick = 0;

interface Input {
	w: boolean;
	s: boolean;
	a: boolean;
	d: boolean;
}

interface Players {
	id: string;
	x: number;
	y: number;
	inputs: Input;
}

interface CustomWebScoket extends WebSocket {
	id: string;
}

const DIRECTION_MAP = {
	w: { dx: 0, dy: -1 }, // Up
	s: { dx: 0, dy: 1 }, // Down
	a: { dx: -1, dy: 0 }, // Left
	d: { dx: 1, dy: 0 }, // Right
};

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
	ws.send(JSON.stringify({ type: "welcome", payload: { id: ws.id } }));

	ws.on("message", (rawMsg: string) => {
		try {
			const payload = JSON.parse(rawMsg);

			if (payload.type === "input") {
				const player = players.get(ws.id);
				if (player) {
					player.inputs = payload.payload;
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

		for (const [key, isPressed] of Object.entries(player.inputs)) {
			if (isPressed) {
				const dir = DIRECTION_MAP[key as keyof typeof DIRECTION_MAP];

				if (dir) {
					player.x += dir.dx * SPEED;
					player.y += dir.dy * SPEED;
				}
			}
		}
	});

	const snap = JSON.stringify({
		type: "snapshot",
		tick,
		players: Array.from(players.values()),
	});
	for (const c of wss.clients)
		if (c.readyState === WebSocket.OPEN) c.send(snap);
}, TICK_MS);
