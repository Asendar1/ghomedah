import * as three from "three";
import type { Rect } from "@ghomedah/shared";
import { samples, id, mapData } from "./net";

const INTERP_MS = 66;

// The server speaks px: positions in 0..800. This arena is 30 world units wide.
// This is the border crossing between the two coordinate spaces.
const WORLD = 30;
const SCALE = WORLD / 800;
function toWorld(gx: number, gy: number) {
	return { x: (gx - 400) * SCALE, z: (gy - 400) * SCALE };
}

export function startGame(canvas: HTMLCanvasElement) {
	const scene = new three.Scene();
	scene.background = new three.Color("#040355");

	const camera = new three.PerspectiveCamera(
		75,
		canvas.width / canvas.height,
		0.1,
		800,
	);
	camera.position.set(0, 20, 12);
	camera.lookAt(0, 0, 0);

	const renderer = new three.WebGLRenderer({ canvas });
	renderer.setSize(canvas.width, canvas.height);

	const planeMat = new three.MeshBasicMaterial({ color: "#ffffff" });
	const playerMat = new three.MeshBasicMaterial({ color: "#00ffff" });
	const enemyMat = new three.MeshBasicMaterial({ color: "#fafa00" });
	const wallMat = new three.MeshBasicMaterial({ color: "#1c1c1c" }); // palette: yours
	const cabinetMat = new three.MeshBasicMaterial({ color: "#4a4a4a" });
	const outlineMaterial = new three.MeshBasicMaterial({
		color: 0x000000,
		side: three.BackSide, // only renders interior/back faces
	});

	const playerGeo = new three.CapsuleGeometry(1, 1);
	const planeGeo = new three.PlaneGeometry(WORLD, WORLD);
	const plane = new three.Mesh(planeGeo, planeMat);
	plane.rotation.x = -Math.PI / 2;
	scene.add(plane);

	// per-run state — lives and dies with this startGame call (StrictMode-safe)
	const playerMap = new Map<string, three.Mesh>();
	let builtMap = false;

	// the office — one box per rect, built once when the map message arrives
	function addBox(r: Rect, height: number, mat: three.Material) {
		const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
		const box = new three.Mesh(
			new three.BoxGeometry(r.w * SCALE, height, r.h * SCALE),
			mat,
		);
		box.position.set(c.x, height / 2, c.z);
		scene.add(box);
	}

	function animate(time: number) {
		if (mapData && !builtMap) {
			builtMap = true;
			for (const r of mapData.walls) addBox(r, 2.5, wallMat);
			for (const r of mapData.cabinets) addBox(r, 1.1, cabinetMat);
		}

		if (samples.length) {
			const render_at = performance.now() - INTERP_MS;

			let a = samples[0];
			let b = samples[samples.length - 1];
			for (let i = 0; i < samples.length - 1; i++) {
				if (render_at <= samples[i + 1].at) {
					a = samples[i];
					b = samples[i + 1];
					break;
				}
			}

			const span = b.at - a.at;
			const t =
				span > 0 ? Math.min(1, Math.max(0, (render_at - a.at) / span)) : 1;

			for (const p of b.players) {
				let mesh = playerMap.get(p.id);
				if (!mesh) {
					// first time seeing this player: make their mesh (self = cyan + outline)
					const isMe = p.id === id;
					mesh = new three.Mesh(playerGeo, isMe ? playerMat : enemyMat);
					if (isMe) {
						const outline = new three.Mesh(playerGeo, outlineMaterial);
						outline.scale.setScalar(1.05);
						mesh.add(outline);
					}
					scene.add(mesh);
					playerMap.set(p.id, mesh);
				}

				const q = a.players.find((o) => o.id === p.id);
				const gx = q ? q.x + (p.x - q.x) * t : p.x;
				const gy = q ? q.y + (p.y - q.y) * t : p.y;
				const w = toWorld(gx, gy);
				mesh.position.set(w.x, 1.5, w.z);
			}

			// if a websocket dies. so no frozen mesh is left hanging
			for (const [pid, mesh] of playerMap) {
				if (!b.players.some((p) => p.id === pid)) {
					scene.remove(mesh);
					playerMap.delete(pid);
				}
			}

			const hue = (time / 2000) % 1;
			outlineMaterial.color.setHSL(hue, 1, 0.5);
		}

		renderer.render(scene, camera);
	}

	renderer.setAnimationLoop(animate);

	return () => {
		renderer.setAnimationLoop(null);
		renderer.dispose();
	};
}
