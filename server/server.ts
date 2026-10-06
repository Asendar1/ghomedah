import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collidesWithAnyPlayer, getRandomPos } from "./helper.ts";
import {
	MAP,
	SEARCH_RANGE,
	SPEED,
	SEARCH_TIME,
	solids,
	HUNT_TIME,
	END_TIME,
	INFECT_REACH,
	INFECT_COOLDOWN,
	MAX_PLAYERS,
} from "./config.ts";
import type { ClientMsg, Input, ServerMsg, Cabinet, Phase, Role } from "@ghomedah/shared";
import { contains, inflate } from "@ghomedah/shared/geometry";

const TICK_MS = 1000 / 30; // 30 ticks per second

// one process serves everything in prod: the built client, /health, /stats and
// the ws upgrades. In dev the vite dev server proxies /ws here (see client/vite.config.ts).
const PORT = Number(process.env.PORT) || 8787;
const DIST = fileURLToPath(new URL("../client/dist", import.meta.url)); // repo-relative, cwd-independent
const TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".json": "application/json",
	".map": "application/json",
};

const httpServer = createServer((req, res) => {
	const url = (req.url ?? "/").split("?")[0] ?? "/";
	if (url === "/health") {
		res.setHeader("content-type", "application/json");
		res.end('{"ok":true}');
		return;
	}
	if (url === "/stats") {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				rooms: rooms.size,
				players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
				uptime: Math.round(process.uptime()),
			}),
		);
		return;
	}
	const file = path.normalize(path.join(DIST, url === "/" ? "index.html" : url.slice(1)));
	if (!file.startsWith(DIST + path.sep) || !existsSync(file)) {
		res.statusCode = 404;
		res.end("not found");
		return;
	}
	res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
	res.end(readFileSync(file));
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, "0.0.0.0");
let tick = 0;
let lastTickAt = Date.now();

interface Players {
	id: string;
	x: number;
	y: number;
	inputs: Input;
	searchT: number;
	role: Role;
	wantAttack: boolean; // queued by the attack msg, resolved by the tick
	infectReadyAt: number; // wall-ms until the next swing is allowed
}

interface CustomWebScoket extends WebSocket {
	id: string;
}

interface Room {
	players: Map<string, Players>;
	sockets: Set<WebSocket>;
	cabinets: Cabinet[]; // per-room search flags — MAP.cabinets is only the template
	phase: Phase;
	endsAt: number; // wall-ms deadline for the current phase (0 = none)
	winner: "prey" | "hunters" | null;
	poisonId: number;
}

const rooms = new Map<string, Room>();

function send(room: Room, msg: ServerMsg) {
	const json = JSON.stringify(msg);
	for (const s of room.sockets) if (s.readyState === WebSocket.OPEN) s.send(json);
}

function endRound(room: Room, winner: "prey" | "hunters", now: number) {
	room.phase = "END";
	room.endsAt = now + END_TIME;
	room.winner = winner;
	send(room, { type: "phase", phase: "END", endsAt: room.endsAt, winner });
}

function resetRound(room: Room) {
	for (const c of room.cabinets) c.search = false;
	for (const p of room.players.values()) {
		p.role = "prey";
		p.searchT = 0;
		p.wantAttack = false;
		p.infectReadyAt = 0;
	}
	room.phase = "SEARCH";
	room.endsAt = 0;
	room.winner = null;
	room.poisonId = 1 + Math.floor(Math.random() * MAP.cabinets.length);
	send(room, { type: "phase", phase: "SEARCH", endsAt: 0, winner: null });
}

wss.on("connection", (ws: CustomWebScoket, req) => {
	const code = new URL(req.url ?? "", "http://x").searchParams.get("room") ?? "lobby";
	let room = rooms.get(code);
	if (!room) {
		room = {
			players: new Map(),
			sockets: new Set(),
			cabinets: MAP.cabinets.map((c) => ({ ...c })),
			phase: "SEARCH",
			endsAt: 0,
			winner: null,
			poisonId: 1 + Math.floor(Math.random() * MAP.cabinets.length),
		};
		rooms.set(code, room);
	}
	if (room.players.size >= MAX_PLAYERS) return ws.close();
	ws.id = crypto.randomUUID();
	const [sx, sy] = getRandomPos(ws.id, room.players);
	const newPlayer: Players = {
		id: ws.id,
		x: sx,
		y: sy,
		inputs: { w: false, s: false, a: false, d: false, e: false, lit: true },
		searchT: 0,
		role: "prey",
		wantAttack: false,
		infectReadyAt: 0,
	};
	room.players.set(ws.id, newPlayer);
	room.sockets.add(ws);
	const welcome: ServerMsg = { type: "welcome", payload: { id: ws.id } };
	ws.send(JSON.stringify(welcome));
	const map: ServerMsg = {
		type: "map",
		walls: MAP.walls,
		cabinets: room.cabinets,
		searchRange: SEARCH_RANGE,
		searchTime: SEARCH_TIME,
	};
	ws.send(JSON.stringify(map));
	const ph: ServerMsg = { type: "phase", phase: room.phase, endsAt: room.endsAt, winner: room.winner };
	ws.send(JSON.stringify(ph));

	ws.on("message", (rawMsg: string) => {
		try {
			const msg = JSON.parse(rawMsg) as ClientMsg;
			const player = room.players.get(ws.id);

			if (player === undefined) return;

			if (msg.type === "input") {
				const p = msg.payload;
				player.inputs = {
					w: !!p?.w,
					s: !!p?.s,
					a: !!p?.a,
					d: !!p?.d,
					e: !!p?.e,
					lit: p?.lit ?? true, // display-only relay; absent (old client/bot) = on
				};
			} else if (msg.type === "attack") {
				// handlers only queue intent — the tick owns the swing + world mutation
				player.wantAttack = true;
			}
		} catch (err) {
			console.error("failed to parse incoming player message: ", err);
		}
	});

	ws.on("close", () => {
		room.players.delete(ws.id);
		room.sockets.delete(ws);
		if (room.players.size === 0) rooms.delete(code);
	});
});

setInterval(() => {
	tick++;
	// real ms between ticks — setInterval(33.33) actually fires every ~46ms on
	// Windows (15.625ms timer quantum), so tick-time ≠ wall-time. The search
	// meter counts wall seconds; clamp caps sleep/resume skips.
	const now = Date.now();
	const tickDt = Math.min(now - lastTickAt, 250);
	lastTickAt = now;

	rooms.forEach((room) => {
		room.players.forEach((v, k) => {
			const player: Players = room.players.get(k) as Players;

			const i = player.inputs;
			const dx = (i.d ? 1 : 0) - (i.a ? 1 : 0);
			const dy = (i.s ? 1 : 0) - (i.w ? 1 : 0);
			const len = Math.hypot(dx, dy) || 1;

			//btw y here is for the z axis. might rename this later
			// rect collision
			const moveX = len > 0 ? (dx / len) * SPEED : 0;
			const moveY = len > 0 ? (dy / len) * SPEED : 0;

			const nextX = Math.max(10, Math.min(790, player.x + moveX));
			if (
				!solids.some((b) => contains(b, nextX, player.y)) &&
				!collidesWithAnyPlayer({ x: nextX, y: player.y }, player.id, room.players)
			) {
				player.x = nextX;
			}

			const nextY = Math.max(10, Math.min(790, player.y + moveY));
			if (
				!solids.some((b) => contains(b, player.x, nextY)) &&
				!collidesWithAnyPlayer({ x: player.x, y: nextY }, player.id, room.players)
			) {
				player.y = nextY;
			}

			// search: only during SEARCH — by HUNT the poison is already found.
			// The client only sends intent (E held); the tick owns the timer and
			// the world mutation. wall-ms accumulate so SEARCH_TIME = real seconds.
			// typed: config's `satisfies` keeps `search` literal-typed, Cabinet makes it mutable
			const nearCabinet: Cabinet | undefined = room.cabinets.find(
				(c) => !c.search && contains(inflate(c, SEARCH_RANGE), player.x, player.y),
			);
			if (room.phase === "SEARCH" && nearCabinet && player.inputs.e) {
				player.searchT += tickDt;
				if (player.searchT >= SEARCH_TIME) {
					nearCabinet.search = true;
					player.searchT = 0;

					//broadcast
					send(room, { type: "boxSearched", id: nearCabinet.id });
					if (nearCabinet.id === room.poisonId) {
						player.role = "hunter";
						room.phase = "HUNT";
						room.endsAt = now + HUNT_TIME;
						send(room, { type: "phase", phase: "HUNT", endsAt: room.endsAt, winner: null });
					}
				}
			} else {
				player.searchT = 0;
			}
		});

		// infection — the infected TAP E (one keydown = one swing): converts the
		// nearest prey within reach, then locked for INFECT_COOLDOWN. Taps during
		// the cooldown (or outside HUNT) are dropped.
		// n <= MAX_PLAYERS, O(n²) is fine; revisit only if the cap grows
		if (room.phase === "HUNT") {
			for (const h of room.players.values()) {
				if (h.role === "prey" || !h.wantAttack) continue;
				h.wantAttack = false;
				if (now < h.infectReadyAt) continue;
				h.infectReadyAt = now + INFECT_COOLDOWN;
				let target: Players | undefined;
				let best = INFECT_REACH * INFECT_REACH;
				for (const v of room.players.values()) {
					if (v.role !== "prey") continue;
					const d = (h.x - v.x) ** 2 + (h.y - v.y) ** 2;
					if (d < best) {
						best = d;
						target = v;
					}
				}
				if (target) target.role = "zombie";
			}

			const preyLeft = [...room.players.values()].filter((p) => p.role === "prey").length;
			if (preyLeft === 0) endRound(room, "hunters", now);
			else if (now >= room.endsAt) endRound(room, "prey", now);
		} else if (room.phase === "END" && now >= room.endsAt) {
			resetRound(room);
		} else {
			// SEARCH / mid-END: taps do nothing — drop any queued swing
			for (const p of room.players.values()) p.wantAttack = false;
		}

		const snap: ServerMsg = {
			type: "snapshot",
			tick,
			players: Array.from(
				room.players.values(),
				({ id, x, y, role, inputs }) => ({ id, x, y, role, lit: inputs.lit }),
			),
		};
		send(room, snap);
	});
}, TICK_MS);
