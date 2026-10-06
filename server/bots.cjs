// Dev harness: N bot clients against a ghomedah server, validating the invariant
// "no player position ever lands inside a solid" while bots grind around the map.
// Searchers (--searchers per room) bias toward unsearched cabinets and hold E, so the
// search path stays warm under load. Bots are spread across rooms (room cap = 8).
// One checker per room. Reports snapshot cadence + throughput = the README numbers.
// Usage: node server/bots.cjs [--spawn] [--port 8789] [--bots 20] [--seconds 8] [--searchers 2] [--rooms 1]
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

// --- args ---
const opt = { spawn: false, port: 8789, bots: 20, seconds: 8, searchers: 2, rooms: 1 };
{
	const a = process.argv.slice(2);
	for (let i = 0; i < a.length; i++) {
		if (a[i] === "--spawn") opt.spawn = true;
		else if (a[i] === "--port") opt.port = +a[++i];
		else if (a[i] === "--bots") opt.bots = +a[++i];
		else if (a[i] === "--seconds") opt.seconds = +a[++i];
		else if (a[i] === "--searchers") opt.searchers = +a[++i];
		else if (a[i] === "--rooms") opt.rooms = +a[++i];
	}
}

// read PLAYER_R from config so the harness can't drift from the game's numbers
const cfg = fs.readFileSync(path.join(__dirname, "config.ts"), "utf8");
const PLAYER_R = +cfg.match(/PLAYER_R\s*=\s*([\d.]+)/)[1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let srv = null;
let copyDir = null;
function spawnCopy() {
	copyDir = path.join(__dirname, "_bots");
	fs.mkdirSync(copyDir, { recursive: true });
	for (const f of ["server.ts", "config.ts", "helper.ts"]) {
		const src = fs.readFileSync(path.join(__dirname, f), "utf8");
		fs.writeFileSync(path.join(copyDir, f), src.replace("8787", String(opt.port)));
	}
	srv = spawn(process.execPath, ["server.ts"], {
		cwd: copyDir,
		stdio: ["ignore", "pipe", "pipe"],
	});
	srv.stderr.on("data", (d) => console.log("[server]", String(d).trim()));
}
function cleanup() {
	if (srv) srv.kill();
	if (copyDir && fs.existsSync(copyDir)) {
		try {
			fs.rmSync(copyDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
		} catch (e) {
			console.log("[cleanup] could not remove _bots (left for next run):", e.code);
		}
	}
}

// --- state ---
let solids = null;
const seen = new Set(); // player ids ever observed (all rooms)
const bounds = new Map(); // id -> [minX, maxX, minY, maxY], from the checkers
const violators = new Set();
let checks = 0;
let welcomes = 0;
let maps = 0;

// load-test counters
let snaps = 0;
let inputsSent = 0;
let boxes = 0;
const snapGaps = []; // bot-0-only snapshot inter-arrival times

const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function mkBot(isChecker, isSearcher, collectGaps, room) {
	const ws = new WebSocket(`ws://127.0.0.1:${opt.port}/?room=${room}`);
	const self = { id: null, x: 0, y: 0, stuckAt: 0, overrideUntil: 0 };
	const roomCabs = new Map(); // this bot's room only: id -> { cx, cy, search }
	let hold = 0;
	let dir = [0, 0];
	let lastSnapAt = 0;
	const send = (o) => {
		if (ws.readyState !== WebSocket.OPEN) return;
		inputsSent++;
		ws.send(JSON.stringify({ type: "input", payload: { d: false, a: false, s: false, w: false, e: false, ...o } }));
	};
	ws.on("message", (d) => {
		let m;
		try { m = JSON.parse(d); } catch { return; }
		if (m.type === "welcome") { welcomes++; self.id = m.payload.id; }
		else if (m.type === "map") {
			maps++;
			for (const c of m.cabinets) roomCabs.set(c.id, { cx: c.x + c.w / 2, cy: c.y + c.h / 2, search: c.search });
			if (!solids)
				solids = [...m.walls, ...m.cabinets].map((r) => ({
					x: r.x - PLAYER_R,
					y: r.y - PLAYER_R,
					w: r.w + 2 * PLAYER_R,
					h: r.h + 2 * PLAYER_R,
				}));
		} else if (m.type === "boxSearched") {
			boxes++;
			const c = roomCabs.get(m.id);
			if (c) c.search = true;
		} else if (m.type === "snapshot") {
			snaps++;
			if (collectGaps) {
				const now = Date.now();
				if (lastSnapAt) snapGaps.push(now - lastSnapAt);
				lastSnapAt = now;
			}
			if (self.id) {
				const p = m.players.find((q) => q.id === self.id);
				if (p) {
					if (Math.hypot(p.x - self.x, p.y - self.y) > 3) self.stuckAt = 0;
					else if (!self.stuckAt) self.stuckAt = Date.now();
					self.x = p.x;
					self.y = p.y;
				}
			}
			if (isChecker && solids) {
				for (const p of m.players) {
					checks++;
					const inside = solids.some(
						(b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h,
					);
					if (inside) violators.add(p.id);
					seen.add(p.id);
					const b = bounds.get(p.id);
					if (!b) bounds.set(p.id, [p.x, p.x, p.y, p.y]);
					else {
						if (p.x < b[0]) b[0] = p.x;
						if (p.x > b[1]) b[1] = p.x;
						if (p.y < b[2]) b[2] = p.y;
						if (p.y > b[3]) b[3] = p.y;
					}
				}
			}
		}
	});
	ws.on("error", (e) => console.log("[bot]", e.message));
	const iv = setInterval(() => {
		if (ws.readyState !== WebSocket.OPEN) return;
		if (isSearcher) {
			const now = Date.now();
			// pick the nearest unsearched cabinet from THIS room's knowledge
			let best = null, bd = Infinity;
			for (const c of roomCabs.values()) {
				if (c.search) continue;
				const dd = Math.hypot(c.cx - self.x, c.cy - self.y);
				if (dd < bd) { bd = dd; best = c; }
			}
			if (!best) {
				send({});
				return;
			}
			if (bd < 70) {
				// parked at the target: hold E, keep micro-steering. No unstick here —
				// being blocked by the cabinet you're searching is the intended state,
				// and nudging away would reset the 2s search.
				const dx = best.cx - self.x, dy = best.cy - self.y;
				send({ e: true, d: dx > 8, a: dx < -8, s: dy > 8, w: dy < -8 });
				return;
			}
			if (now < self.overrideUntil) {
				send({ d: dir[0] > 0, a: dir[0] < 0, s: dir[1] > 0, w: dir[1] < 0 });
				return;
			}
			if (self.stuckAt && now - self.stuckAt > 500) {
				// wedged on a wall while travelling — random nudge for 300ms, then resume
				self.stuckAt = 0;
				self.overrideUntil = now + 300;
				dir = DIRS[(Math.random() * DIRS.length) | 0];
				send({ d: dir[0] > 0, a: dir[0] < 0, s: dir[1] > 0, w: dir[1] < 0 });
				return;
			}
			const dx = best.cx - self.x, dy = best.cy - self.y;
			send({ d: dx > 8, a: dx < -8, s: dy > 8, w: dy < -8 });
			return;
		}
		if (--hold <= 0) {
			dir = DIRS[(Math.random() * DIRS.length) | 0];
			hold = 5 + ((Math.random() * 25) | 0);
		}
		send({ d: dir[0] > 0, a: dir[0] < 0, s: dir[1] > 0, w: dir[1] < 0 });
	}, 150);
	return { ws, iv };
}

(async () => {
	const bots = [];
	try {
		if (opt.spawn) spawnCopy();
		await sleep(opt.spawn ? 1700 : 400);
		const perRoom = Math.ceil(opt.bots / opt.rooms);
		for (let i = 0; i < opt.bots; i++) {
			const idx = i % perRoom;
			bots.push(mkBot(idx === 0, idx > 0 && idx <= opt.searchers, i === 0, `r${(i / perRoom) | 0}`));
			await sleep(35);
		}
		await sleep(opt.seconds * 1000);
		const moved = [...bounds.entries()].filter(
			([, b]) => b[1] - b[0] > 40 || b[3] - b[2] > 40,
		).length;
		const frozen = [...bounds.entries()].filter(
			([, b]) => b[1] - b[0] < 1 && b[3] - b[2] < 1,
		).length;
		const pct = (q) => (snapGaps.length ? snapGaps.slice().sort((a, b) => a - b)[Math.floor(snapGaps.length * q)] : -1);
		console.log(`${opt.bots} bots (${opt.searchers}/room searchers, ${opt.rooms} room(s)) x ${opt.seconds}s @ :${opt.port}`);
		console.log(`welcomes ${welcomes} | maps ${maps} | players seen ${seen.size}`);
		console.log(`position checks ${checks} | inside-solid violations ${violators.size}`);
		console.log(`moved >40px: ${moved} | never moved: ${frozen}`);
		console.log(`snapshots ${snaps} | checker gap p50 ${pct(0.5)}ms p99 ${pct(0.99)}ms`);
		console.log(`inputs sent ${inputsSent} | boxSearched msgs seen ${boxes} | msgs/s ~${((snaps + inputsSent) / opt.seconds).toFixed(0)}`);
		const ok = violators.size === 0 && frozen === 0 && moved >= Math.ceil(seen.size * 0.75);
		console.log(ok ? "SIM OK" : "SIM FAIL");
		process.exitCode = ok ? 0 : 1;
	} catch (e) {
		console.log("SIM ERROR", e);
		process.exitCode = 1;
	} finally {
		for (const b of bots) {
			clearInterval(b.iv);
			try { b.ws.terminate(); } catch {}
		}
		if (srv) srv.kill();
		await sleep(400); // beat: let the child die before Windows unlocks its cwd
		cleanup();
	}
})();
