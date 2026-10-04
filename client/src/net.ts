const ws = new WebSocket("ws://localhost:8787");

let id = null;

// Interpolation
let samples = [];
const INTERP_MS = 66;

const inputs = {
	w: false,
	s: false,
	a: false,
	d: false,
};

ws.addEventListener("message", (e) => {
	const data = JSON.parse(e.data);

	if (data.type === "welcome") {
		id = data.payload.id;
	} else if (data.type === "snapshot") {
		samples.push({ ...data, at: performance.now() });
		if (samples.length > 3) samples.shift();
	}
});

function sendInput() {
	ws.send(JSON.stringify({ type: "input", payload: inputs }));
}

window.addEventListener("keydown", (e) => {
	const key = e.key.toLowerCase();

	if (key in inputs && inputs[key] === false) {
		inputs[key] = true;
		sendInput();
	}
});

window.addEventListener("keyup", (e) => {
	const key = e.key.toLowerCase();

	if (key in inputs && inputs[key] === true) {
		inputs[key] = false;
		sendInput();
	}
});
