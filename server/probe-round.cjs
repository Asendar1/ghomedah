// E2E check: rounds + points. Staged: hunt 10s, result screen 2s, poison =
// cabinet 1, deterministic spawns. A (prey) stands still; B (prey) searches
// the poison (+25, becomes hunter); B routes through the doorway and infects A
// (+75); C (prey, far away) survives the hunt (+100). Then the reset: round 2,
// everyone prey again, scores kept, newRound broadcast, names relayed.
// Usage: node server/probe-round.cjs   (self-stages server/_probe, cleans up)
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8788;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = path.join(__dirname, "_probe");
fs.mkdirSync(dir, { recursive: true });
const src = fs
	.readFileSync(path.join(__dirname, "server.ts"), "utf8")
	.replaceAll("8787", String(PORT))
	.replace(
		"const [sx, sy] = getRandomPos(ws.id, room.players);",
		"const [sx, sy] = [[400, 250], [108, 158], [700, 400]][room.players.size] ?? getRandomPos(ws.id, room.players);",
	)
	.replaceAll("1 + Math.floor(Math.random() * MAP.cabinets.length)", "1");
if (!src.includes("[700, 400]") || src.includes("8787")) throw new Error("stage failed");
fs.writeFileSync(path.join(dir, "server.ts"), src);
// fast round: 10s hunt, 2s result screen
const cfgsrc = fs
	.readFileSync(path.join(__dirname, "config.ts"), "utf8")
	.replace("export const HUNT_TIME = 90_000;", "export const HUNT_TIME = 10_000;")
	.replace("export const END_TIME = 10_000;", "export const END_TIME = 2_000;");
if (!cfgsrc.includes("HUNT_TIME = 10_000") || !cfgsrc.includes("END_TIME = 2_000")) throw new Error("knob sed failed");
fs.writeFileSync(path.join(dir, "config.ts"), cfgsrc);
fs.copyFileSync(path.join(__dirname, "helper.ts"), path.join(dir, "helper.ts"));

const srv = spawn(process.execPath, ["server.ts"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => console.log("[server]", String(d).trim()));

function mkClient() {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?room=round`);
	const st = { ws, id: null, players: [], phase: null, rounds: 0, welcomes: 0 };
	ws.on("message", (d) => {
		const m = JSON.parse(d);
		if (m.type === "welcome") {
			st.id = m.payload.id;
			st.welcomes++;
		} else if (m.type === "snapshot") st.players = m.players;
		else if (m.type === "phase") st.phase = m;
		else if (m.type === "newRound") st.rounds++;
	});
	const send = (o) => {
		if (ws.readyState === WebSocket.OPEN)
			ws.send(JSON.stringify({ type: "input", payload: { w: false, s: false, a: false, d: false, e: false, lit: true, ...o } }));
	};
	const swing = () => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "attack" }));
	};
	const rename = (n) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "name", payload: { name: n } }));
	};
	return { st, send, swing, rename };
}

const me = (c) => c.st.players.find((p) => p.id === c.st.id);
const ofId = (c, id) => c.st.players.find((p) => p.id === id);
const scoreOf = (c, id) => ofId(c, id)?.score;

async function waitFor(cond, ms, label) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		if (cond()) {
			console.log("OK  " + label);
			return;
		}
		await sleep(40);
	}
	throw new Error("TIMEOUT: " + label);
}
function check(cond, label) {
	if (!cond) throw new Error("FAIL: " + label);
	console.log("OK  " + label);
}

// walk until within `stop` px of a target (fixed point or live player), no
// pathfinding — callers waypoint around walls (the doorway at x=200, y 304..460)
function walkTo(c, getTarget, stop, label, budgetMs = 9000) {
	return new Promise((resolve, reject) => {
		const iv = setInterval(() => {
			const m = me(c);
			const t = getTarget();
			if (!m || !t) return;
			if (Math.hypot(t.x - m.x, t.y - m.y) < stop) {
				clearInterval(iv);
				c.send({});
				console.log("OK  " + label);
				resolve();
				return;
			}
			c.send({ s: t.y - m.y > 6, w: t.y - m.y < -6, d: t.x - m.x > 6, a: t.x - m.x < -6 });
		}, 100);
		setTimeout(() => {
			clearInterval(iv);
			reject(new Error("TIMEOUT: " + label));
		}, budgetMs);
	});
}

(async () => {
	try {
		await sleep(1500);
		const A = mkClient();
		await sleep(150);
		const B = mkClient();
		await sleep(150);
		const C = mkClient();
		await sleep(600);
		check(A.st.welcomes && B.st.welcomes && C.st.welcomes, "all three welcomed");
		A.rename("ALPHA"); // exercise the name msg — assert it lands in others' snapshots
		await waitFor(() => ofId(B, A.st.id)?.name === "ALPHA", 2000, "name reaches other clients");

		// 1. B searches cabinet 1 (the planted poison) -> hunter, +25
		const eHold = setInterval(() => B.send({ e: true }), 100);
		await waitFor(() => B.st.phase?.phase === "HUNT", 6000, "B found the poison -> HUNT");
		clearInterval(eHold);
		check(B.st.phase.round === 1, "still round 1");
		await waitFor(() => scoreOf(C, B.st.id) === 25 && scoreOf(C, A.st.id) === 0, 1500, "finder +25, everyone else 0");

		// 2. B walks to A (via the doorway) and infects -> +75
		await walkTo(B, () => ({ x: 185, y: 390 }), 15, "B slipped through the doorway", 6000);
		await walkTo(B, () => ofId(B, A.st.id), 40, "B closed in on A", 5000);
		B.swing();
		await waitFor(() => ofId(C, A.st.id)?.role === "zombie", 2000, "A got infected");
		await waitFor(() => scoreOf(C, B.st.id) === 100, 1500, "B at 100 after the infect");
		check(scoreOf(C, A.st.id) === 0, "the infected prey scored nothing");

		// 3. hunt runs out: C is the last prey standing -> +100 survive
		await waitFor(() => C.st.phase?.phase === "END", 9000, "hunt ended on the clock");
		check(C.st.phase.winner === "prey", "winner: prey");
		check(scoreOf(C, C.st.id) === 100 && scoreOf(C, B.st.id) === 100 && scoreOf(C, A.st.id) === 0, "survivor +100; totals 100/100/0");

		// 4. reset: round 2, roles back to prey, scores persist, newRound sent
		await waitFor(() => C.st.phase?.phase === "SEARCH" && C.st.phase.round === 2, 5000, "round 2 started");
		check(C.st.rounds === 1, "newRound broadcast received");
		check(C.st.players.every((p) => p.role === "prey"), "everyone prey again");
		check(scoreOf(C, B.st.id) === 100 && scoreOf(C, C.st.id) === 100, "scores persisted across the reset");

		console.log("ROUND OK");
		process.exitCode = 0;
	} catch (e) {
		console.log(String(e.message || e));
		process.exitCode = 1;
	} finally {
		srv.kill();
		await sleep(400);
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
		} catch {
			console.log("[cleanup] could not remove _probe (left for next run)");
		}
	}
})();
