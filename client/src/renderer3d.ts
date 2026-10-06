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

	const camera = new three.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 800);
	camera.position.set(0, 25, 15); // wide default; the per-frame camera block takes over
	camera.lookAt(0, 0, 0);

	const renderer = new three.WebGLRenderer({ canvas });
	renderer.shadowMap.enabled = true; // walls and cabinets must block the flashlight
	renderer.shadowMap.type = three.PCFSoftShadowMap;
	// fill the window; refit on resize (the canvas element is styled 100%)
	const setSize = () => {
		const w = window.innerWidth;
		const h = window.innerHeight;
		renderer.setSize(w, h);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	setSize();
	window.addEventListener("resize", setSize);

	// vision — client-only knobs, zero netcode. Lights need lit materials, so
	// everything is Lambert now (matte, still the flat blockout look).
	const VISION = {
		// the room's own light, by phase (tune by feel): dim enough to search in,
		// then near-pitch-black from the moment the poison is found — after that
		// the flashlights are the only light there is
		ambient: { color: 0x2a2d45, search: 0.9, hunt: 0.07 },
		cone: { color: 0xfff3d6, intensity: 3.2, dist: 30, angle: 0.45 }, // flashlight
		followScale: 0.35, // hider camera height/offset scale
		seekerScale: 0.45, // the seeker's only edge: ~28% wider lens, not the whole map
	};
	const ambient = new three.AmbientLight(VISION.ambient.color, VISION.ambient.search);
	scene.add(ambient);
	// one flashlight factory: mine + one per other player (their beams are real lights)
	const mkFlashlight = (mapSize: number, dist: number) => {
		const l = new three.SpotLight(VISION.cone.color, VISION.cone.intensity, dist, VISION.cone.angle, 0.45, 1.2);
		l.castShadow = true;
		l.shadow.mapSize.set(mapSize, mapSize);
		l.shadow.camera.near = 0.5;
		l.shadow.camera.far = 40;
		l.shadow.bias = -0.0015; // kill acne on flat Lambert floor
		l.target.position.set(0, 0, 1);
		scene.add(l, l.target);
		return l;
	};
	const cone = mkFlashlight(1024, VISION.cone.dist); // mine — the big one
	cone.position.set(0, 2.2, 0);

	const planeMat = new three.MeshLambertMaterial({ color: "#e8e8ea" });
	// no emissive: a body may only be seen by ACTUAL light — a flashlight beam
	// or the dim search-phase ambient. In the near-black hunt dark a body is
	// invisible until someone's beam sweeps it (that's what makes hiding work).
	const playerMat = new three.MeshLambertMaterial({ color: "#00ffff" });
	const enemyMat = new three.MeshLambertMaterial({ color: "#fafa00" });
	const hunterMat = new three.MeshLambertMaterial({ color: "#ff2e2e" });
	const zombieMat = new three.MeshLambertMaterial({ color: "#3dff6e" });
	const wallMat = new three.MeshLambertMaterial({ color: "#2c2c34" });
	const cabinetMat = new three.MeshLambertMaterial({ color: "#5a5a62" });
	const lidMat = new three.MeshLambertMaterial({ color: "#6e6e76" });
	const outlineMaterial = new three.MeshBasicMaterial({
		color: 0x000000,
		side: three.BackSide, // only renders interior/back faces
	});

	const planeGeo = new three.PlaneGeometry(120, 120); // bigger than the arena so widescreen shows floor, not void
	const plane = new three.Mesh(planeGeo, planeMat);
	plane.rotation.x = -Math.PI / 2;
	plane.receiveShadow = true;
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
	const playerMap = new Map<string, three.Group>();
	let builtMap = false;
	// per-player derived state: facing from movement drives everyone's flashlight
	// (same derivation on every client → beams read synced, zero wire fields)
	const faces = new Map<string, { lx: number; lz: number; fx: number; fz: number }>();
	const playerCones = new Map<string, three.SpotLight>();
	let camScale = 0.35; // set per role each frame (VISION scales)
	let selfX = 0; // my interpolated position — the camera's look-at target
	let selfZ = 0;

	// the office — one box per rect, built once when the map message arrives
	function addBox(r: Rect, height: number, mat: three.Material) {
		const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
		const box = new three.Mesh(
			new three.BoxGeometry(r.w * SCALE, height, r.h * SCALE),
			mat,
		);
		box.position.set(c.x, height / 2, c.z);
		box.castShadow = true;
		box.receiveShadow = true;
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
		lid.castShadow = true;
		lid.position.z = halfH;
		hinge.add(lid);
		scene.add(hinge);
		return hinge;
	}

	// a blocky office figure: torso + shoulders + head. Role color goes on
	// torso+head. No facing detail — remote players have no facing on the wire.
	const torsoGeo = new three.BoxGeometry(0.95, 1.05, 0.62);
	const headGeo = new three.BoxGeometry(0.6, 0.52, 0.52);
	const collarGeo = new three.BoxGeometry(1.05, 0.16, 0.72);
	const collarMat = new three.MeshLambertMaterial({ color: "#22232a" });

	function makeCharacter(self: boolean) {
		const g = new three.Group();
		const body = new three.Mesh(torsoGeo, playerMat);
		body.position.y = 0.55;
		const collar = new three.Mesh(collarGeo, collarMat);
		collar.position.y = 1.12;
		const head = new three.Mesh(headGeo, playerMat);
		head.position.y = 1.5;
		g.add(body, collar, head);
		if (self) {
			const ol = new three.Mesh(torsoGeo, outlineMaterial);
			ol.scale.setScalar(1.08);
			body.add(ol);
		}
		g.userData.parts = [body, head];
		return g;
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

		// the lights die when the poison is found — and come back at the reset.
		// Sampled live each frame; the lerp reads as the lights going out.
		const ambTarget = phase && phase.phase !== "SEARCH" ? VISION.ambient.hunt : VISION.ambient.search;
		ambient.intensity += (ambTarget - ambient.intensity) * k;

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
					// first time seeing this player: build their figure (self gets the halo)
					mesh = makeCharacter(p.id === id);
					scene.add(mesh);
					playerMap.set(p.id, mesh);
				}

				const q = a.players.find((o) => o.id === p.id);
				const gx = q ? q.x + (p.x - q.x) * t : p.x;
				const gy = q ? q.y + (p.y - q.y) * t : p.y;
				const w = toWorld(gx, gy);
				mesh.position.set(w.x, 0, w.z);
				const roleMat =
					p.role === "hunter" ? hunterMat : p.role === "zombie" ? zombieMat : p.id === id ? playerMat : enemyMat;
				for (const part of mesh.userData.parts as three.Mesh[]) part.material = roleMat;

				// facing from movement — every client derives it identically, so a
				// beam's aim needs no wire field and reads synced
				let f = faces.get(p.id);
				if (!f) {
					f = { lx: w.x, lz: w.z, fx: 0, fz: 1 };
					faces.set(p.id, f);
				}
				if (Math.hypot(w.x - f.lx, w.z - f.lz) > 0.02) {
					f.fx = w.x - f.lx;
					f.fz = w.z - f.lz;
					const fl = Math.hypot(f.fx, f.fz);
					f.fx /= fl;
					f.fz /= fl;
				}
				f.lx = w.x;
				f.lz = w.z;

				// EVERY player carries a real flashlight — including the seeker. A
				// beam is a giveaway: it sweeps the dark where everyone can see it
				let beam = playerCones.get(p.id);
				if (!beam) {
					beam = p.id === id ? cone : mkFlashlight(512, 22);
					playerCones.set(p.id, beam);
				}
				beam.visible = p.lit; // F toggles it; hidden beams still track, so re-enabling aims right
				beam.position.set(w.x, 2.2, w.z);
				beam.target.position.set(w.x + f.fx * 4, 0, w.z + f.fz * 4);

				if (p.id === id) {
					// the seeker's ONLY edge is a wider version of the same follow cam
					camScale = p.role === "hunter" ? VISION.seekerScale : VISION.followScale;
					selfX = w.x;
					selfZ = w.z;
				}

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
						meter.position.set(w.x, 2.9, w.z);
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
					faces.delete(pid);
					const beam = playerCones.get(pid);
					if (beam && beam !== cone) {
						scene.remove(beam, beam.target);
						playerCones.delete(pid);
					}
				}
			}

			// camera: locked above the player, no sway, NO edge clamp — it rides free
			// (it sits far above wall height, so nothing clips; clamping made walls
			// seem to push the camera mid-map). The seeker just gets a wider lens.
			const k = camera.aspect < 0.9 ? 0.9 / camera.aspect : 1;
			const s = camScale * k;
			camera.position.set(selfX, 25 * s, selfZ + 15 * s);
			camera.lookAt(selfX, 0.5, selfZ);
		}

		renderer.render(scene, camera);
	}

	renderer.setAnimationLoop(animate);

	return () => {
		renderer.setAnimationLoop(null);
		renderer.dispose();
		window.removeEventListener("resize", setSize);
	};
}
