// E2E check: infection is an ACTION (hold E while touching) — not proximity.
// A (first joiner, spawns inside cabinet 1's search band) searches the planted
// poison (id 1) -> becomes hunter. B (second joiner) stands still nearby.
// Asserts: adjacent WITHOUT E -> B stays prey (the reported bug), then E held ->
// B turns zombie (seen in both clients' snapshots). ~5s.
// Usage: node server/probe-infect.cjs   (self-stages server/_probe, cleans up)
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
	// deterministic spawns: A next to cabinet 1, B a short clear walk down
	.replace(
		"const [sx, sy] = getRandomPos(ws.id, room.players);",
		"const [sx, sy] = [[108, 158], [100, 260]][room.players.size] ?? getRandomPos(ws.id, room.players);",
	)
	.replaceAll("1 + Math.floor(Math.random() * MAP.cabinets.length)", "1"); // poison = cabinet 1
fs.writeFileSync(path.join(dir, "server.ts"), src);
for (const f of ["config.ts", "helper.ts"]) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));

const srv = spawn(process.execPath, ["server.ts"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => console.log("[server]", String(d).trim()));

function mkClient() {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?room=probe`);
	const st = { ws, id: null, players: [], phase: null, boxes: [] };
	ws.on("message", (d) => {
		const m = JSON.parse(d);
		if (m.type === "welcome") st.id = m.payload.id;
		else if (m.type === "snapshot") st.players = m.players;
		else if (m.type === "phase") st.phase = m.phase;
		else if (m.type === "boxSearched") st.boxes.push(m.id);
	});
	const send = (o) => {
		if (ws.readyState === WebSocket.OPEN)
			ws.send(JSON.stringify({ type: "input", payload: { w: false, s: false, a: false, d: false, e: false, ...o } }));
	};
	return { st, send };
}

const role = (c, id) => c.st.players.find((p) => p.id === id)?.role;
const pos = (c, id) => c.st.players.find((p) => p.id === id);

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

(async () => {
	let mover = null;
	try {
		await sleep(1500);
		const A = mkClient();
		await sleep(150);
		const B = mkClient();
		await sleep(600);
		check(A.st.id && B.st.id && A.st.id !== B.st.id, "both welcomed");

		// 1. A searches cabinet 1 = the poison -> hunter, phase HUNT
		const eHold = setInterval(() => A.send({ e: true }), 100);
		await waitFor(() => A.st.phase === "HUNT", 4500, "poison found -> HUNT");
		clearInterval(eHold);
		check(A.st.boxes.includes(1), "boxSearched frame for cabinet 1");
		check(role(A, A.st.id) === "hunter", "A is the hunter");

		// 2. walk A to idle B (B spawns 102px down, no obstacles between)
		let reached = false;
		let holdE = false;
		mover = setInterval(() => {
			const me = pos(A, A.st.id);
			const b = pos(A, B.st.id);
			if (!me || !b) return;
			if (reached) {
				A.send({ e: holdE }); // stationary, just hold the attack key
				return;
			}
			if (Math.hypot(b.x - me.x, b.y - me.y) < 55) {
				reached = true;
				console.log("OK  A reached B (pressed up, dist < 55)");
				return;
			}
			A.send({ s: b.y - me.y > 8, w: b.y - me.y < -8, d: b.x - me.x > 8, a: b.x - me.x < -8 });
		}, 100);
		await waitFor(() => reached, 10000, "walk completed");

		// 3. the regression: adjacent, NO E held -> B must stay prey
		await sleep(400);
		check(role(B, B.st.id) === "prey", "no E held -> B still prey");

		// 4. hold E -> converts; both clients see it in snapshots
		holdE = true;
		await waitFor(() => role(B, B.st.id) === "zombie", 1200, "E held -> B turned zombie");
		check(role(A, B.st.id) === "zombie", "A's snapshot agrees");

		console.log("INFECT-E OK");
		process.exitCode = 0;
	} catch (e) {
		console.log(String(e.message || e));
		process.exitCode = 1;
	} finally {
		if (mover) clearInterval(mover);
		srv.kill();
		await sleep(400); // let the child die before Windows unlocks its cwd
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
		} catch {
			console.log("[cleanup] could not remove _probe (left for next run)");
		}
	}
})();
