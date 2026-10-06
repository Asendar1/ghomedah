// E2E check: the late-hunt ghost flashes. The hunt is sed'd to 12s with flashes
// at 6s and 2s remaining (= one with 30s left, one with 10s left in real time).
// At each flash window every PREY gets a glowing copy for GHOST_VISIBLE (1s) at
// the spot where they stood when the window opened — exactly once per window,
// nothing in between, hunters never get one, and a mid-hunt move re-pins the
// second flash to the new spot.
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
// tiny hunt: 12s long, flashes at 6s and 2s remaining (elapsed 6s and 10s)
const cfgsrc = fs
	.readFileSync(path.join(__dirname, "config.ts"), "utf8")
	.replace("export const HUNT_TIME = 90_000;", "export const HUNT_TIME = 12_000;")
	.replace("export const GHOST_FLASHES = [30_000, 10_000];", "export const GHOST_FLASHES = [6_000, 2_000];");
if (!cfgsrc.includes("12_000") || !cfgsrc.includes("[6_000, 2_000]")) throw new Error("probe sed failed");
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
		const sampleFor = async (ms) => {
			const out = [];
			const t = Date.now();
			while (Date.now() - t < ms) {
				const a = other(B, A.st.id);
				if (a) out.push({ on: a.ghost !== null, gx: a.ghost?.x, gy: a.ghost?.y, ax: a.x, ay: a.y, self: me(B)?.ghost });
				await sleep(100);
			}
			return out;
		};
		const runsOf = (s) => s.filter((x, i) => x.on && (i === 0 || !s[i - 1].on)).length;
		const pinned = (s, px, py) => s.filter((x) => x.on).every((x) => Math.abs(x.gx - px) <= 2 && Math.abs(x.gy - py) <= 2);

		// 1. nothing before the first flash
		await waitFor(() => Date.now() - huntT0 >= 3400, 5000, "waiting out the early hunt");
		check(B.st.players.every((p) => p.ghost === null), "no flash in the early hunt");

		// 2. flash 1 (elapsed 6-7s): exactly one ~1s appearance, pinned at A's spot
		await waitFor(() => Date.now() - huntT0 >= 5500, 6000, "first flash window opening");
		const s1 = await sampleFor(1900);
		check(runsOf(s1) === 1, `flash 1 appears exactly once (${runsOf(s1)} run(s))`);
		const on1 = s1.filter((x) => x.on);
		check(on1.length >= 8 && on1.length <= 14, `flash 1 lasts ~1s (${on1.length} on-samples)`);
		check(pinned(s1, 400, 250), "flash 1 is pinned to where A stood");
		check(s1.every((x) => x.self === null), "the hunter never gets a ghost");
		check(s1.slice(-4).every((x) => !x.on), "flash 1 is gone a second later");

		// 3. A moves between flashes; nothing flashes in between
		await walkTo(A, 400, 320, "A moved to a new spot");
		const s2 = await sampleFor(800);
		check(s2.every((x) => !x.on), "no repeat between the two flashes");

		// 4. flash 2 (~elapsed 10-11s): once, pinned at the NEW spot
		await waitFor(() => Date.now() - huntT0 >= 9700, 10500, "second flash window opening");
		const s3 = await sampleFor(1900);
		check(runsOf(s3) === 1, `flash 2 appears exactly once (${runsOf(s3)} run(s))`);
		const on3 = s3.filter((x) => x.on);
		check(on3.length >= 8 && on3.length <= 14, `flash 2 lasts ~1s (${on3.length} on-samples)`);
		check(
			on3.every((x) => Math.abs(x.gx - x.ax) <= 2 && Math.abs(x.gy - x.ay) <= 2),
			"flash 2 pinned exactly to where A now stands",
		);
		const aPos = other(B, A.st.id);
		check(Math.hypot(aPos.x - 400, aPos.y - 250) > 40, "A really is at the new spot (moved >40px)");
		check(s3.every((x) => x.self === null), "still no ghost for the hunter");

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
