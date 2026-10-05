// Dev harness: N bot clients against a ghomedah server, validating the invariant
// "no player position ever lands inside a solid" while bots grind around the map.
// Usage: node server/bots.cjs [--spawn] [--port 8789] [--bots 20] [--seconds 8]
// --spawn boots a port-swapped copy of the server (leaves :8787 alone) and cleans up after.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

// --- args ---
const opt = { spawn: false, port: 8789, bots: 20, seconds: 8 };
{
	const a = process.argv.slice(2);
	for (let i = 0; i < a.length; i++) {
		if (a[i] === "--spawn") opt.spawn = true;
		else if (a[i] === "--port") opt.port = +a[++i];
		else if (a[i] === "--bots") opt.bots = +a[++i];
		else if (a[i] === "--seconds") opt.seconds = +a[++i];
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
const seen = new Set(); // player ids ever observed
const bounds = new Map(); // id -> [minX, maxX, minY, maxY], from the checker client
const violators = new Set();
let checks = 0;
let welcomes = 0;
let maps = 0;

const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function mkBot(isChecker) {
	const ws = new WebSocket(`ws://127.0.0.1:${opt.port}`);
	let hold = 0;
	let dir = [0, 0];
	ws.on("message", (d) => {
		let m;
		try { m = JSON.parse(d); } catch { return; }
		if (m.type === "welcome") welcomes++;
		else if (m.type === "map") {
			maps++;
			if (!solids)
				solids = [...m.walls, ...m.cabinets].map((r) => ({
					x: r.x - PLAYER_R,
					y: r.y - PLAYER_R,
					w: r.w + 2 * PLAYER_R,
					h: r.h + 2 * PLAYER_R,
				}));
		} else if (m.type === "snapshot" && isChecker && solids) {
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
	});
	ws.on("error", (e) => console.log("[bot]", e.message));
	const iv = setInterval(() => {
		if (ws.readyState !== WebSocket.OPEN) return;
		if (--hold <= 0) {
			dir = DIRS[(Math.random() * DIRS.length) | 0];
			hold = 5 + ((Math.random() * 25) | 0);
		}
		ws.send(
			JSON.stringify({
				type: "input",
				payload: { d: dir[0] > 0, a: dir[0] < 0, s: dir[1] > 0, w: dir[1] < 0 },
			}),
		);
	}, 150);
	return { ws, iv };
}

(async () => {
	const bots = [];
	try {
		if (opt.spawn) spawnCopy();
		await sleep(opt.spawn ? 1700 : 400);
		for (let i = 0; i < opt.bots; i++) {
			bots.push(mkBot(i === 0));
			await sleep(35);
		}
		await sleep(opt.seconds * 1000);
		const moved = [...bounds.entries()].filter(
			([, b]) => b[1] - b[0] > 40 || b[3] - b[2] > 40,
		).length;
		const frozen = [...bounds.entries()].filter(
			([, b]) => b[1] - b[0] < 1 && b[3] - b[2] < 1,
		).length;
		console.log(`${opt.bots} bots x ${opt.seconds}s @ :${opt.port}`);
		console.log(`welcomes ${welcomes} | maps ${maps} | players seen ${seen.size}`);
		console.log(`position checks ${checks} | inside-solid violations ${violators.size}`);
		console.log(`moved >40px: ${moved} | never moved: ${frozen}`);
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
