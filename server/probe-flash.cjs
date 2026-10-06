// E2E check: the flashlight toggle is a display-only relay. A player's `lit`
// bit must go input -> every snapshot -> every OTHER client; a payload that
// omits `lit` (old cached client, bots, other probes) defaults to ON; and a
// late joiner must see the current state in its first snapshots.
// Usage: node server/probe-flash.cjs   (self-stages server/_probe, cleans up)
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8788;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = path.join(__dirname, "_probe");
fs.mkdirSync(dir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "server.ts"), "utf8").replaceAll("8787", String(PORT));
fs.writeFileSync(path.join(dir, "server.ts"), src);
for (const f of ["config.ts", "helper.ts"]) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));

const srv = spawn(process.execPath, ["server.ts"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", (d) => console.log("[server]", String(d).trim()));

function mkClient() {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?room=flash`);
	const st = { ws, id: null, players: [] };
	ws.on("message", (d) => {
		const m = JSON.parse(d);
		if (m.type === "welcome") st.id = m.payload.id;
		else if (m.type === "snapshot") st.players = m.players;
	});
	const raw = (payload) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", payload }));
	};
	// the shape a current client sends
	const send = (o) => raw({ w: false, s: false, a: false, d: false, e: false, lit: true, ...o });
	// the shape an old cached client sends: no `lit` field at all
	const sendLegacy = () => raw({ w: false, s: false, a: false, d: false, e: false });
	return { st, send, sendLegacy };
}

const litOf = (c, id) => c.st.players.find((p) => p.id === id)?.lit;

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
	try {
		await sleep(1500);
		const A = mkClient();
		await sleep(150);
		const B = mkClient();
		await sleep(800);
		check(A.st.id && B.st.id && A.st.id !== B.st.id, "both welcomed");

		// the wire actually carries the field (not just "falsy when missing")
		check(typeof litOf(B, A.st.id) === "boolean", "wire carries a lit field");

		// default: A never sent any input; its beam reads ON to the other client
		check(litOf(B, A.st.id) === true, "fresh client -> beam on by default");

		// toggle OFF observed by the other client
		A.send({ lit: false });
		await waitFor(() => litOf(B, A.st.id) === false, 1000, "toggle OFF -> other client sees lit:false");

		// toggle back ON
		A.send({ lit: true });
		await waitFor(() => litOf(B, A.st.id) === true, 1000, "toggle ON -> other client sees lit:true");

		// an old client (payload without lit) must not darken anyone
		A.send({ lit: false });
		await waitFor(() => litOf(B, A.st.id) === false, 1000, "off again for the legacy test");
		A.sendLegacy();
		await waitFor(() => litOf(B, A.st.id) === true, 1000, "legacy payload (no lit) -> back ON (default)");

		// late joiner sees the current state...
		const C = mkClient();
		await sleep(500);
		check(litOf(C, A.st.id) === true, "late joiner sees current state (on)");

		// ...and sees live flips
		A.send({ lit: false });
		await waitFor(() => litOf(C, A.st.id) === false, 1000, "late joiner sees a live flip (off)");
		check(litOf(B, A.st.id) === false, "both observers agree");

		console.log("FLASH OK");
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
