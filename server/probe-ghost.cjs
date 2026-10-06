// E2E check: the late-hunt ghost echo. After GHOST_DELAY of hunt (sed'd to 6s
// here), each PREY gets a glowing copy that blinks — GHOST_VISIBLE (1s) on, the
// rest of GHOST_CYCLE (3s) off — at the spot where they stood when the cycle
// started. Hunters never get one; nothing blinks before the delay; moving
// re-captures the echo at the new spot on the next cycle.
// A (prey) hides while B searches the planted poison (cabinet 1) -> hunter.
// Usage: node server/probe-ghost.cjs   (self-stages server/_probe, cleans up)
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
	// deterministic spawns: A (prey) parked in the open, B (searcher) in cabinet 1's band
	.replace(
		"const [sx, sy] = getRandomPos(ws.id, room.players);",
		"const [sx, sy] = [[400, 250], [108, 158]][room.players.size] ?? getRandomPos(ws.id, room.players);",
	)
	.replaceAll("1 + Math.floor(Math.random() * MAP.cabinets.length)", "1"); // poison = cabinet 1
fs.writeFileSync(path.join(dir, "server.ts"), src);
// ghosts fire after 6s instead of 60s, so the probe doesn't wait a minute
const cfgsrc = fs
	.readFileSync(path.join(__dirname, "config.ts"), "utf8")
	.replace("export const GHOST_DELAY = 60_000;", "export const GHOST_DELAY = 6_000;");
if (!cfgsrc.includes("6_000")) throw new Error("GHOST_DELAY sed failed");
fs.writeFileSync(path.join(dir, "config.ts"), cfgsrc);
fs.copyFileSync(path.join(__dirname, "helper.ts"), path.join(dir, "helper.ts"));

const srv = spawn(process.execPath, ["server.ts"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => console.log("[server]", String(d).trim()));

function mkClient() {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?room=ghost`);
	const st = { ws, id: null, players: [], phase: null };
	ws.on("message", (d) => {
		const m = JSON.parse(d);
		if (m.type === "welcome") st.id = m.payload.id;
		else if (m.type === "snapshot") st.players = m.players;
		else if (m.type === "phase") st.phase = m.phase;
	});
	const send = (o) => {
		if (ws.readyState === WebSocket.OPEN)
			ws.send(JSON.stringify({ type: "input", payload: { w: false, s: false, a: false, d: false, e: false, lit: true, ...o } }));
	};
	return { st, send };
}

const me = (c) => c.st.players.find((p) => p.id === c.st.id);
const other = (c, id) => c.st.players.find((p) => p.id === id);

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

function walkTo(A, tx, ty, label) {
	return new Promise((resolve, reject) => {
		const iv = setInterval(() => {
			const m = me(A);
			if (!m) return;
			if (Math.hypot(tx - m.x, ty - m.y) < 12) {
				clearInterval(iv);
				A.send({});
				console.log("OK  " + label);
				resolve();
				return;
			}
			A.send({ s: ty - m.y > 6, w: ty - m.y < -6, d: tx - m.x > 6, a: tx - m.x < -6 });
		}, 100);
		setTimeout(() => {
			clearInterval(iv);
			reject(new Error("TIMEOUT: " + label));
		}, 6000);
	});
}

(async () => {
	try {
		await sleep(1500);
		const A = mkClient();
		await sleep(150);
		const B = mkClient();
		await sleep(600);
		check(A.st.id && B.st.id, "both welcomed");

		// B searches cabinet 1 = the poison -> hunter, phase HUNT
		const eHold = setInterval(() => B.send({ e: true }), 100);
		await waitFor(() => B.st.phase === "HUNT", 5000, "poison found -> HUNT");
		clearInterval(eHold);
		const huntT0 = Date.now();

		// 1. before the delay: nobody blinks (check from B's view of both players)
		await sleep(700);
		const pre = B.st.players;
		check(pre.every((p) => p.ghost === null), "no ghost before the delay");

		// 2. after the delay: sample the blink for ~6s from B's view of A
		await waitFor(() => Date.now() - huntT0 >= 6900, 9000, "delay elapsed");
		const samples = [];
		const t0 = Date.now();
		while (Date.now() - t0 < 6000) {
			const a = other(B, A.st.id);
			if (a) samples.push({ on: a.ghost !== null, gx: a.ghost?.x, gy: a.ghost?.y, ax: a.x, ay: a.y, self: me(B)?.ghost });
			await sleep(100);
		}
		const onN = samples.filter((s) => s.on).length;
		const runs = samples.filter((s, i) => s.on && (i === 0 || !samples[i - 1].on)).length;
		check(onN > 0 && runs >= 2, `blink cycle seen: ${runs} on-runs, ${onN}/${samples.length} on-samples`);
		const ratio = onN / samples.length;
		check(ratio > 0.15 && ratio < 0.55, `duty cycle ≈ 1/3 (got ${ratio.toFixed(2)})`);
		check(
			samples.filter((s) => s.on).every((s) => Math.abs(s.gx - s.ax) <= 2 && Math.abs(s.gy - s.ay) <= 2),
			"while standing still the echo is pinned exactly to the prey",
		);
		check(samples.every((s) => s.self === null), "the hunter never gets a ghost");
		check(samples.every((s) => s.on || s.gx === undefined), "off-samples carry no position (null ghost)");

		// 3. moving re-captures the echo at the new spot on a later cycle
		await walkTo(A, 400, 320, "A moved to a new spot");
		let seen = null;
		const t1 = Date.now();
		while (Date.now() - t1 < 4600 && !seen) {
			const a = other(B, A.st.id);
			if (a && a.ghost && Math.hypot(a.ghost.x - 400, a.ghost.y - 320) <= 12) seen = a.ghost;
			await sleep(100);
		}
		check(!!seen, "echo re-captured at the new spot after the move");

		console.log("GHOST OK");
		process.exitCode = 0;
	} catch (e) {
		console.log(String(e.message || e));
		process.exitCode = 1;
	} finally {
		srv.kill();
		await sleep(400); // let the child die before Windows unlocks its cwd
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
		} catch {
			console.log("[cleanup] could not remove _probe (left for next run)");
		}
	}
})();
