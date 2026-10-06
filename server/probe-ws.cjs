// Tiny ws smoke test: connects like a fresh browser client and requires the
// three frames every new connection must get — welcome, map, phase.
// Usage: node server/probe-ws.cjs [ws://host:port/ws?room=x]
const WebSocket = require("ws");

const url = process.argv[2] ?? "ws://127.0.0.1:8787/ws?room=smoke";
const seen = new Set();
const ws = new WebSocket(url);
const done = (code, msg) => {
	console.log(msg);
	try {
		ws.terminate();
	} catch {}
	process.exit(code);
};
ws.on("message", (d) => {
	const m = JSON.parse(d);
	seen.add(m.type);
	if (seen.has("welcome") && seen.has("map") && seen.has("phase")) {
		done(0, "WS OK: welcome + map + phase received");
	}
});
ws.on("error", (e) => done(1, "WS ERROR: " + e.message));
setTimeout(() => done(1, "WS TIMEOUT — seen: " + ([...seen].join(",") || "(nothing)")), 3000);
