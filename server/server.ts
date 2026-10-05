import { WebSocketServer, WebSocket } from "ws";
import { collidesWithAnyPlayer, getRandomPos} from "./helper.ts";
import { MAP, SEARCH_RANGE, SPEED, PLAYER_R } from "./config.ts";
import type { ClientMsg, Input, ServerMsg, Cabinet } from "@ghomedah/shared";
import { contains } from "@ghomedah/shared/geometry";

const TICK_MS = 1000 / 30; // 30 ticks per second
const wss = new WebSocketServer({ port: 8787, host: "0.0.0.0" });
let tick = 0;

export const solids = [...MAP.walls, ...MAP.cabinets].map((r) => ({
	x: r.x - PLAYER_R,
	y: r.y - PLAYER_R,
	w: r.w + 2 * PLAYER_R,
	h: r.h + 2 * PLAYER_R,
}));

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

wss.on("connection", (ws: CustomWebScoket) => {
	ws.id = crypto.randomUUID();
	const [sx, sy] = getRandomPos(ws.id, players);
	const newPlayer: Players = {
		id: ws.id,
		x: sx,
		y: sy,
		inputs: { w: false, s: false, a: false, d: false },
	};
	players.set(ws.id, newPlayer);
	const welcome: ServerMsg = { type: "welcome", payload: { id: ws.id } };
	ws.send(JSON.stringify(welcome));
	const map: ServerMsg = {
		type: "map",
		walls: MAP.walls,
		cabinets: MAP.cabinets,
		searchRange: SEARCH_RANGE,
	};
	ws.send(JSON.stringify(map));

	ws.on("message", (rawMsg: string) => {
		try {
			const msg = JSON.parse(rawMsg) as ClientMsg;

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

		//btw y here is for the z axis. might rename this later
		// rect collision
		const moveX = len > 0 ? (dx / len) * SPEED : 0;
		const moveY = len > 0 ? (dy / len) * SPEED : 0;

		const nextX = Math.max(10, Math.min(790, player.x + moveX));
		if (!solids.some((b) => contains(b, nextX, player.y)) && !collidesWithAnyPlayer({x: nextX, y: player.y}, player.id, players)) {
			player.x = nextX;
		}

		const nextY = Math.max(10, Math.min(790, player.y + moveY));
		if (!solids.some((b) => contains(b, player.x, nextY)) && !collidesWithAnyPlayer({x: player.x, y: nextY}, player.id, players)) {
			player.y = nextY;
		}
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
