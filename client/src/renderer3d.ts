import * as three from "three";
import type { Cabinet, Rect } from "@ghomedah/shared";
import { samples, id, mapData, inputs, phase } from "./net";
import { contains, inflate } from "@ghomedah/shared/geometry";

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
	const hunterMat = new three.MeshBasicMaterial({ color: "#ff2e2e" });
	const zombieMat = new three.MeshBasicMaterial({ color: "#3dff6e" });
	const wallMat = new three.MeshBasicMaterial({ color: "#1c1c1c" }); // palette: yours
	const cabinetMat = new three.MeshBasicMaterial({ color: "#4a4a4a" });
	const lidMat = new three.MeshBasicMaterial({ color: "#5c5c5c" });
	const outlineMaterial = new three.MeshBasicMaterial({
		color: 0x000000,
		side: three.BackSide, // only renders interior/back faces
	});

	const playerGeo = new three.CapsuleGeometry(1, 1);
	const planeGeo = new three.PlaneGeometry(WORLD, WORLD);
	const plane = new three.Mesh(planeGeo, planeMat);
	plane.rotation.x = -Math.PI / 2;
	scene.add(plane);

	// cabient outline when close by it
	const edges = new three.EdgesGeometry(new three.BoxGeometry());
	const outline = new three.LineSegments(edges, outlineMaterial);

	// search meter above your head. Client-side estimate — the server owns the
	// real timer, this bar just follows "E held + close enough" locally.
	const meter = new three.Group();
	const meterBg = new three.Mesh(
		new three.PlaneGeometry(1.7, 0.24),
		new three.MeshBasicMaterial({ color: "#0a0a0a" }),
	);
	const meterGeo = new three.PlaneGeometry(1.6, 0.14);
	meterGeo.translate(0.8, 0, 0.01); // pivot at the left edge so scale.x fills rightward
	const meterFill = new three.Mesh(
		meterGeo,
		new three.MeshBasicMaterial({ color: "#00ffff" }),
	);
	meter.add(meterBg, meterFill);
	meter.visible = false;
	scene.add(meter);

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

	// hinged lid per cabinet: hinged on the back edge, tilts open when searched
	function addLid(r: Rect) {
		const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
		const halfH = (r.h * SCALE) / 2;
		const hinge = new three.Group();
		hinge.position.set(c.x, 1.1, c.z - halfH);
		const lid = new three.Mesh(
			new three.BoxGeometry(r.w * SCALE, 0.06, r.h * SCALE),
			lidMat,
		);
		lid.position.z = halfH;
		hinge.add(lid);
		scene.add(hinge);
		return hinge;
	}

	let cabinets: Cabinet[] = [];
	const lids: three.Group[] = [];
	let searchBoxes: Rect[] = [];
	let searchMs = 2000; // overwritten by md.searchTime once the map arrives
	let searchT = 0; // local meter fill; server truth lands as boxSearched
	let lastFrame = 0;

	function animate(time: number) {
		const dt = Math.min(time - lastFrame, 100);
		lastFrame = time;

		if (mapData && !builtMap) {
			builtMap = true;
			const md = mapData;
			for (const r of md.walls) addBox(r, 2.5, wallMat);
			for (const r of md.cabinets) {
				addBox(r, 1.1, cabinetMat);
				lids.push(addLid(r));
			}
			cabinets = md.cabinets;
			searchBoxes = md.cabinets.map((c) => inflate(c, md.searchRange));
			searchMs = md.searchTime;
			const c0 = md.cabinets[0]; // all cabinets share size
			if (c0) outline.scale.set(c0.w * SCALE, 1.1, c0.h * SCALE);
		}

		// searched cabinets pop their lid open (driven by the server flag)
		const k = Math.min(1, dt * 0.01);
		for (let i = 0; i < lids.length; i++) {
			const target = cabinets[i].search ? -1.45 : 0;
			lids[i].rotation.x += (target - lids[i].rotation.x) * k;
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
				mesh.material =
					p.role === "hunter" ? hunterMat : p.role === "zombie" ? zombieMat : p.id === id ? playerMat : enemyMat;

				//box outline + search meter — only while searching is possible
				if (p.id === id && searchBoxes.length && (!phase || phase.phase === "SEARCH")) {
					const closeCabinet = mapData?.cabinets.find(
						(c, i) => !c.search && contains(searchBoxes[i], gx, gy),
					);
					if (closeCabinet) {
						const { x, z } = toWorld(
							closeCabinet.x + closeCabinet.w / 2,
							closeCabinet.y + closeCabinet.h / 2,
						);
						outline.position.set(x, 0.55, z);
						scene.add(outline);
					} else {
						scene.remove(outline);
					}

					// meter fills while E is held next to an unsearched cabinet
					if (closeCabinet && inputs.e) {
						searchT = Math.min(searchT + dt, searchMs);
					} else {
						searchT = 0;
					}
					meter.visible = searchT > 0;
					if (meter.visible) {
						meter.position.set(w.x, 3.2, w.z);
						meterFill.scale.x = searchT / searchMs;
						meter.lookAt(camera.position);
					}
				} else if (p.id === id) {
					// not searchable right now (HUNT/END) — no stuck outline or meter
					scene.remove(outline);
					meter.visible = false;
				}
			}

			// if a websocket dies. so no frozen mesh is left hanging
			for (const [pid, mesh] of playerMap) {
				if (!b.players.some((p) => p.id === pid)) {
					scene.remove(mesh);
					playerMap.delete(pid);
				}
			}
		}

		renderer.render(scene, camera);
	}

	renderer.setAnimationLoop(animate);

	return () => {
		renderer.setAnimationLoop(null);
		renderer.dispose();
	};
}
