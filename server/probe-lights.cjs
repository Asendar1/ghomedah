// E2E check: the late-hunt ceiling lamps. After LIGHT_DELAY of hunt (sed'd to 6s
// here), a lamp flutters on as a hint wherever PREY are hiding within
// LIGHT_REACH — for LIGHT_HINT (5s), then it goes dark even if they stay.
// Leaving the reach re-arms it; coming back hints again. Hunters under a lamp
// never trigger it. A (prey) hides in lamp 3's reach; B searches the planted
// poison (cabinet 1) and becomes the hunter.
// Usage: node server/probe-lights.cjs   (self-stages server/_probe, cleans up)
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
	// deterministic spawns: A (prey) in lamp 3's reach, B (searcher) in cabinet 1's band
	.replace(
		"const [sx, sy] = getRandomPos(ws.id, room.players);",
		"const [sx, sy] = [[400, 250], [108, 158]][room.players.size] ?? getRandomPos(ws.id, room.players);",
	)
	.replaceAll("1 + Math.floor(Math.random() * MAP.cabinets.length)", "1"); // poison = cabinet 1
fs.writeFileSync(path.join(dir, "server.ts"), src);
// lamps fire after 6s instead of 60s, so the probe doesn't wait a minute
const cfgsrc = fs
	.readFileSync(path.join(__dirname, "config.ts"), "utf8")
	.replace("export const LIGHT_DELAY = 60_000;", "export const LIGHT_DELAY = 6_000;");
if (!cfgsrc.includes("6_000")) throw new Error("LIGHT_DELAY sed failed");
fs.writeFileSync(path.join(dir, "config.ts"), cfgsrc);
fs.copyFileSync(path.join(__dirname, "helper.ts"), path.join(dir, "helper.ts"));

const srv = spawn(process.execPath, ["server.ts"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => console.log("[server]", String(d).trim()));

function mkClient() {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?room=lights`);
	const st = { ws, id: null, players: [], lights: [], phase: null };
	ws.on("message", (d) => {
		const m = JSON.parse(d);
		if (m.type === "welcome") st.id = m.payload.id;
		else if (m.type === "snapshot") {
			st.players = m.players;
			st.lights = m.lights;
		} else if (m.type === "phase") st.phase = m.phase;
	});
	const send = (o) => {
		if (ws.readyState === WebSocket.OPEN)
			ws.send(JSON.stringify({ type: "input", payload: { w: false, s: false, a: false, d: false, e: false, lit: true, ...o } }));
	};
	return { st, send };
}

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

// a little walker: A walks to (tx, ty) at ~7px/tick
function walkTo(A, tx, ty, label) {
	return new Promise((resolve, reject) => {
		const iv = setInterval(() => {
			const me = pos(A, A.st.id);
			if (!me) return;
			if (Math.hypot(tx - me.x, ty - me.y) < 12) {
				clearInterval(iv);
				A.send({});
				console.log("OK  " + label);
				resolve();
				return;
			}
			A.send({ s: ty - me.y > 6, w: ty - me.y < -6, d: tx - me.x > 6, a: tx - me.x < -6 });
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
		const t0 = Date.now();
		check(A.st.lights.length === 6, "snapshot carries 6 lamp states");

		// 1. right after the hunt starts: no help yet
		await sleep(700);
		check(B.st.lights.every((v) => !v), "no lamp before the delay: " + JSON.stringify(B.st.lights));

		// 2. after the delay: exactly the lamp over hiding A; lamp 1 stays off
		//    even though hunter B stands under it (only prey trigger)
		await waitFor(() => Date.now() - t0 >= 7600, 9000, "delay elapsed");
		await sleep(250);
		check(B.st.lights[2] === true, "lamp 3 (over hiding A) is ON: " + JSON.stringify(B.st.lights));
		check(B.st.lights[0] === false, "lamp 1 off (hunter under it doesn't trigger)");
		check(B.st.lights.filter(Boolean).length === 1, "exactly one lamp on");

		// 3. the hint is short: A never moved, but 5s of hinting is up -> dark
		await sleep(5000);
		check(B.st.lights.every((v) => !v), "hint spent: lamp off after LIGHT_HINT while still hiding");

		// 4. leaving the reach re-arms it; returning hints again
		await walkTo(A, 400, 320, "A walked out of reach");
		await waitFor(() => B.st.lights.every((v) => !v), 1500, "stays dark outside reach");
		await walkTo(A, 400, 250, "A walked back into reach");
		await waitFor(() => B.st.lights[2] === true, 1500, "re-armed: lamp hints again on return");

		console.log("LIGHTS OK");
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
