function startGame() {
	const ctx = document.getElementById("c").getContext("2d");

	(function frame() {
		ctx.fillStyle = "#050505";
		ctx.fillRect(0, 0, 800, 800);

		if (!samples.length) {
			requestAnimationFrame(frame);
			return;
		}
		const render_at = performance.now() - INTERP_MS;

		let a = samples[0];
		let b = samples[samples.length - 1];
		for (let i = 0; i < samples.length - 1; i++)
			if (render_at <= samples[i + 1].at) {
				a = samples[i];
				b = samples[i + 1];
				break;
			}

		const span = b.at - a.at;
		const t =
			span > 0 ? Math.min(1, Math.max(0, (render_at - a.at) / span)) : 1;

		for (const p of b.players) {
			const q = a.players.find((o) => o.id === p.id);
			const x = q ? q.x + (p.x - q.x) * t : p.x;
			const y = q ? q.y + (p.y - q.y) * t : p.y;
			ctx.fillStyle = p.id === id ? "#e8c555" : "#e8c";
			ctx.beginPath();
			ctx.arc(x, y, 10, 0, Math.PI * 2);
			ctx.fill();
		}

		requestAnimationFrame(frame);
	})();
}
