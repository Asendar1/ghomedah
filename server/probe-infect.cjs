// E2E check: infection is a CLICK (one swing) with a cooldown — not proximity,
// not a hold. Wire-wise the probe sends the same {type:"attack"} a left-click sends.
// A (1st joiner, in cabinet 1's search band) searches the planted poison (id 1)
// -> hunter, walks to idle B. C joins into reach after the walk. Asserts: with two
// prey in reach and NO click they both stay prey; one click converts exactly one;
// a click during the cooldown is dropped (the other stays prey); after
// INFECT_COOLDOWN the next click converts them.
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
	// deterministic spawns: A next to cabinet 1, B a short clear walk down,
	// C joins later straight into A's swing reach
	.replace(
		"const [sx, sy] = getRandomPos(ws.id, room.players);",
		"const [sx, sy] = [[108, 158], [100, 260], [150, 215]][room.players.size] ?? getRandomPos(ws.id, room.players);",
	)
	.replaceAll("1 + Math.floor(Math.random() * MAP.cabinets.length)", "1") // poison = cabinet 1
	.replace(
		"h.wantAttack = false;",
		"h.wantAttack = false; console.error('[tap]', h.id.slice(0, 4), 'readyAt', h.infectReadyAt, 'now', Date.now());",
	)
	.replace(
		'if (target) target.role = "zombie";',
		'if (target) target.role = "zombie"; console.error(\'[swing]\', h.id.slice(0, 4), \'->\', target ? \'hit\' : \'WHIFF\');',
	);
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
	const attack = () => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "attack" }));
	};
	return { st, send, attack };
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

		// 2. walk A down to idle B (clear path), stop pressed up (< 55px)
		let reached = false;
		mover = setInterval(() => {
			const me = pos(A, A.st.id);
			const b = pos(A, B.st.id);
			if (!me || !b || reached) return;
			if (Math.hypot(b.x - me.x, b.y - me.y) < 55) {
				reached = true;
				A.send({}); // stop pressing
				console.log("OK  A reached B (dist < 55)");
				return;
			}
			A.send({ s: b.y - me.y > 8, w: b.y - me.y < -8, d: b.x - me.x > 8, a: b.x - me.x < -8 });
		}, 100);
		await waitFor(() => reached, 10000, "walk completed");

		// 3. C joins right after A stops: inside swing reach, so click 1 can't
		// end the round (last-prey check) and the cooldown has a live target
		const C = mkClient();
		await sleep(500);
		check(role(A, C.st.id) === "prey", "C joined as prey, in reach");

		// 4. the regression: two prey in reach, NO click -> both stay prey
		await sleep(400);
		check(role(A, B.st.id) === "prey" && role(A, C.st.id) === "prey", "no click -> both still prey");

		// 5. click 1 -> exactly ONE converts (the nearest); cooldown starts now
		const zOf = () => [B.st.id, C.st.id].filter((i) => role(A, i) === "zombie");
		A.attack();
		await waitFor(() => zOf().length === 1, 1200, "click 1 -> exactly one prey converted");
		const first = zOf()[0];
		const other = first === B.st.id ? C.st.id : B.st.id;

		// 6. click 2 during the cooldown -> dropped; the other stays prey
		A.attack();
		await sleep(450);
		check(role(A, other) === "prey", "click during cooldown -> other still prey");

		// 7. after the cooldown, click 3 -> the other converts
		await sleep(1200); // click 1 ~t=0, click 2 ~t=150; cooldown 1500ms
		A.attack();
		await waitFor(() => role(A, other) === "zombie", 1200, "click after cooldown -> other turned zombie");

		console.log("INFECT-CLICK OK");
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
