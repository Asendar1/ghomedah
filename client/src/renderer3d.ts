import * as three from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Cabinet, Rect } from "@ghomedah/shared";
import { samples, id, mapData, inputs, phase } from "./net";
import { contains, inflate } from "@ghomedah/shared/geometry";

const INTERP_MS = 66;

// The server speaks px and this is the border crossing to world metres: the px
// GRID is fixed (1 px = 3.75 cm — 30 m at the original 800). A bigger office
// keeps the scale and grows outward: `half` is the map centre in px, taken
// from the map msg, so every coordinate stays relative to centre.
const SCALE = 30 / 800;

let half = 400; // px centre — overwritten from md.size the moment the map lands

function toWorld(gx: number, gy: number) {
	return { x: (gx - half) * SCALE, z: (gy - half) * SCALE };
}

export function startGame(canvas: HTMLCanvasElement) {
	const scene = new three.Scene();
	scene.background = new three.Color("#040355");

	const camera = new three.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 800);
	camera.position.set(0, 32, 10); // wide default; the per-frame camera block takes over
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
		// the room's own light, by phase: SEARCH is the office LIT — flat neutral
		// ambience (the Escapists-style reference), everything readable. The
		// moment the poison is found the lights die to near-pitch-black and the
		// flashlights are the only light there is. (÷π: three's physical
		// lighting — 3.2 lands surfaces on their own albedo; hunt 0.0022 was
		// measured pitch black with this white.)
		ambient: { color: 0xe8ecf5, search: 3.2, hunt: 0.0022 },
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
	const wallMat = new three.MeshLambertMaterial({ color: "#b4b8c2" }); // light partitions — the search phase is lit now
	const cabinetMat = new three.MeshLambertMaterial({ color: "#5a5a62" });
	const lidMat = new three.MeshLambertMaterial({ color: "#6e6e76" });
	const outlineMaterial = new three.MeshBasicMaterial({
		color: 0x000000,
		side: three.BackSide, // only renders interior/back faces
	});

	const planeGeo = new three.PlaneGeometry(300, 300); // far past any arena (covers ≤ 200 m maps) so widescreen shows floor, not void
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
	const ghostMap = new Map<string, three.Group>(); // blink-echo copies (one per player)
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

	// one entry per animated panel (bookcase doors, or the fallback lid): lerp
	// `axis` toward `open` while its cabinet is searched, back to 0 when reset
	const openables: { node: three.Object3D; axis: "x" | "y"; open: number; cab: Cabinet }[] = [];
	// lids that came with office.glb, keyed by cabinet id (bound when the map
	// message arrives — both sides of the race are covered by propsReady)
	const glbDoor = new Map<number, three.Object3D>();

	// walls: tile the 2 m modular panel along the rect, one exact segment scale
	// per run (no stretch slop accumulates). Model still loading → the old box.
	function addWall(r: Rect) {
		// the hand-modelled office IS the walls (its rects still collide server-side)
		if (officeHas.walls) return;
		// chunky rects (the centre pillar) are solids, not wall runs — keep the box
		if (props.wall === null || Math.min(r.w, r.h) * SCALE > 1) {
			addBox(r, 2.5, wallMat);
			return;
		}
		const horizontal = r.w >= r.h;
		const len = (horizontal ? r.w : r.h) * SCALE;
		const n = Math.max(1, Math.round(len / 2));
		const seg = len / n;
		const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
		for (let i = 0; i < n; i++) {
			const m = props.wall.clone();
			m.traverse((o) => {
				const mesh = o as three.Mesh;
				if (mesh.isMesh) {
					mesh.material = wallMat;
					mesh.castShadow = true;
					mesh.receiveShadow = true;
				}
			});
			const off = -len / 2 + seg * (i + 0.5);
			m.rotation.y = horizontal ? Math.PI / 2 : 0; // the panel's long axis is local z
			m.scale.set(1, 2.5 / 2.4, seg / 2);
			m.position.set(c.x + (horizontal ? off : 0), 0, c.z + (horizontal ? 0 : off));
			scene.add(m);
		}
	}

	// cabinets: a row of three door-bookcases inside the old rect footprint —
	// the hitbox keeps its size, the furniture becomes real. Search swings all
	// six doors (pivots already sit on the hinges). Model missing → box + lid.
	function addCabinet(r: Cabinet) {
		// the model brought its own chests (their lids bind further down)
		if (officeHas.cabinets) return;
		const c = toWorld(r.x + r.w / 2, r.y + r.h / 2);
		if (props.bookcase === null) {
			addBox(r, 1.1, cabinetMat);
			openables.push({ node: addLid(r), axis: "x", open: -1.45, cab: r });
			return;
		}
		const k = 1.15 / 0.85; // stand as tall as the old cabinet looked
		const slot = (r.w * SCALE) / 3;
		for (let i = -1; i <= 1; i++) {
			const u = props.bookcase.clone();
			u.scale.setScalar(k);
			u.position.set(c.x + i * slot, 0, c.z);
			u.traverse((o) => {
				const mesh = o as three.Mesh;
				if (mesh.isMesh) {
					mesh.material = /door/i.test(o.name) ? lidMat : cabinetMat;
					mesh.castShadow = true;
				}
			});
			const dl = u.getObjectByName("doorLeft");
			const dr = u.getObjectByName("doorRight");
			if (dl) openables.push({ node: dl, axis: "y", open: -1.9, cab: r });
			if (dr) openables.push({ node: dr, axis: "y", open: 1.9, cab: r });
			scene.add(u);
		}
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
		g.userData.mat = self ? playerMat : enemyMat;
		return g;
	}

	// CC0 character (Kenney, Animated Characters 3): an FBX rig + separate
	// idle/run clips, loaded once. Every player gets a skinned clone and a flat
	// role color replaces the skin texture — the tint is the tell, not the face.
	const CHAR_H = 1.75; // world units — the figure stands this tall (tune by eye)
	const MODEL_YAW = 0; // if walking reads backwards, flip to Math.PI
	let charProto: three.Group | null = null;
	let idleClip: three.AnimationClip | null = null;
	let runClip: three.AnimationClip | null = null;
	{
		const fbx = new FBXLoader();
		const loadFbx = (url: string) => new Promise<three.Group>((res, rej) => fbx.load(url, res, undefined, rej));
		void Promise.all([loadFbx("/models/character.fbx"), loadFbx("/models/idle.fbx"), loadFbx("/models/run.fbx")])
			.then(([proto, idle, run]) => {
				// each Kenney FBX ships TWO takes: a 1-frame "Targeting Pose" and
				// the real cycle — pick by name, not by index (index 0 is the stub
				// in run.fbx and a 42 ms clip silently pins every limb)
				const pick = (clips: three.AnimationClip[], re: RegExp) =>
					clips.find((c) => re.test(c.name)) ?? clips.reduce((a, b) => (b.duration > a.duration ? b : a));
				idleClip = pick(idle.animations, /idle/i);
				runClip = pick(run.animations, /run/i);
				const h = new three.Box3().setFromObject(proto).getSize(new three.Vector3()).y || 1;
				proto.scale.setScalar(CHAR_H / h); // normalize whatever unit the pack ships
				charProto = proto;
			})
			.catch((err) => console.error("character model failed to load — blockout stays", err));
	}

	// office props: modular wall panels + door-bookcases for the cabinets.
	// Blender-authorable contract: export .glb at real-world METERS, base at
	// the origin, and name any animatable parts ("doorLeft"/"doorRight" here) —
	// we find them BY NODE NAME at load. Drop a replacement at the same path
	// (or hand me one and I'll point the loader at it) and it just appears.
	const props: { wall: three.Group | null; bookcase: three.Group | null } = { wall: null, bookcase: null };
	const officeHas = { walls: false, cabinets: false }; // office.glb brought its own
	let propsReady = false;
	{
		const gl = new GLTFLoader();
		const loadGlb = (url: string) => new Promise<three.Group>((res, rej) => gl.load(url, (g) => res(g.scene), undefined, rej));
		void Promise.allSettled([
			loadGlb("/models/props/wall.glb"),
			loadGlb("/models/props/bookcase.glb"),
			loadGlb("/models/props/office.glb"), // hand-modelled office — optional for now
		]).then(([w, bk, o]) => {
			if (w.status === "fulfilled") props.wall = w.value;
			if (bk.status === "fulfilled") props.bookcase = bk.value;
			if (o.status === "fulfilled") {
				// the office model IS the level: its walls are the visual, the
				// server rects are the collision — never tile Kenney panels over it
				officeHas.walls = true;
				o.value.traverse((n) => {
					const m = n as three.Mesh;
					if (m.isMesh) {
						m.receiveShadow = true;
						m.castShadow = true;
					}
					if (/^cabinet/.test(n.name)) officeHas.cabinets = true;
					const cm = /^cabinet_(\d+)/.exec(n.name);
					if (cm) {
						n.traverse((c) => {
							if (/^door/i.test(c.name)) glbDoor.set(Number(cm[1]), c);
						});
					}
				});
				scene.add(o.value);
				plane.visible = false;
			}
			propsReady = true; // even on failure — the map always builds, boxes stand in
		});
	}

	// the loaded model lands in a group that may still hold blockout boxes: once,
	// clear them and swap in the clone. freeze = the ghost echo, posed mid-stride
	// (a T-pose echo would read wrong) and left static.
	function dressModel(g: three.Group, mat: three.Material, freeze = false) {
		if (charProto === null || g.userData.modeled) return;
		g.userData.modeled = true;
		g.clear();
		const model = cloneSkinned(charProto);
		model.traverse((o) => {
			if ((o as three.Mesh).isMesh) {
				(o as three.Mesh).material = mat;
				(o as three.Mesh).frustumCulled = false; // skinned bounds lie when posed
				o.castShadow = true;
			}
		});
		g.add(model);
		g.userData.mat = mat;
		if (freeze) {
			if (runClip) {
				const m = new three.AnimationMixer(model);
				m.clipAction(runClip).play();
				m.update(0.25);
			}
			return;
		}
		if (idleClip || runClip) {
			const mixer = new three.AnimationMixer(model);
			const idle = mixer.clipAction((idleClip ?? runClip) as three.AnimationClip);
			idle.play();
			const run = idleClip && runClip ? mixer.clipAction(runClip) : null;
			if (run) {
				run.play();
				run.weight = 0;
			}
			g.userData.anim = { mixer, idle, run, w: 0 };
		}
	}

	// the ghost echo: a glowing copy of a hiding prey — emissive, so it reads in
	// the near-black hunt without any actual light (tune emissive by feel)
	const ghostMat = new three.MeshLambertMaterial({ color: "#d9d9e6", emissive: 0x9c9cb4 });
	function mkGhost() {
		const g = new three.Group();
		const body = new three.Mesh(torsoGeo, ghostMat);
		body.position.y = 0.55;
		const head = new three.Mesh(headGeo, ghostMat);
		head.position.y = 1.5;
		g.add(body, head);
		return g;
	}

	let searchBoxes: Rect[] = [];
	let searchMs = 2000; // overwritten by md.searchTime once the map arrives
	let searchT = 0; // local meter fill; server truth lands as boxSearched
	let lastFrame = 0;

	function animate(time: number) {
		const dt = Math.min(time - lastFrame, 100);
		lastFrame = time;

		if (mapData && !builtMap && propsReady) {
			builtMap = true;
			const md = mapData;
			half = md.size / 2;
			for (const r of md.walls) addWall(r);
			for (const r of md.cabinets) addCabinet(r);
			// the model's own lids: swing open on search, keyed by cabinet id
			for (const r of md.cabinets) {
				const d = glbDoor.get(r.id);
				if (d) openables.push({ node: d, axis: "x", open: -2.2, cab: r });
			}
			searchBoxes = md.cabinets.map((c) => inflate(c, md.searchRange));
			searchMs = md.searchTime;
			const c0 = md.cabinets[0]; // all cabinets share size
			if (c0) outline.scale.set(c0.w * SCALE, 1.1, c0.h * SCALE);
		}

		// searched cabinets swing their doors open (driven by the server flag)
		const k = Math.min(1, dt * 0.01);
		for (const o of openables) {
			const target = o.cab.search ? o.open : 0;
			o.node.rotation[o.axis] += (target - o.node.rotation[o.axis]) * k;
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
				if (mesh.userData.mat !== roleMat) {
					mesh.userData.mat = roleMat;
					mesh.traverse((o) => {
						if ((o as three.Mesh).isMesh) (o as three.Mesh).material = roleMat;
					});
				}
				dressModel(mesh, roleMat); // no-op until the model loads (and after)

				// facing from movement — every client derives it identically, so a
				// beam's aim needs no wire field and reads synced
				let f = faces.get(p.id);
				if (!f) {
					f = { lx: w.x, lz: w.z, fx: 0, fz: 1 };
					faces.set(p.id, f);
				}
				const moved = Math.hypot(w.x - f.lx, w.z - f.lz);
				if (moved > 0.02) {
					f.fx = w.x - f.lx;
					f.fz = w.z - f.lz;
					const fl = Math.hypot(f.fx, f.fz);
					f.fx /= fl;
					f.fz /= fl;
				}
				f.lx = w.x;
				f.lz = w.z;

				// the model faces where it walks and runs only while moving
				mesh.rotation.y = Math.atan2(f.fx, f.fz) + MODEL_YAW;
				const anim = mesh.userData.anim as
					| { mixer: three.AnimationMixer; idle: three.AnimationAction; run: three.AnimationAction | null; w: number }
					| undefined;
				if (anim) {
					anim.w += ((moved > 0.01 ? 1 : 0) - anim.w) * Math.min(1, dt * 0.012);
					if (anim.run) anim.run.weight = anim.w;
					anim.idle.weight = 1 - anim.w;
					anim.mixer.update(dt / 1000);
				}
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

				// the ghost echo: blink a glowing copy at the captured spot
				let ghostMesh = ghostMap.get(p.id);
				if (!ghostMesh) {
					ghostMesh = mkGhost();
					scene.add(ghostMesh);
					ghostMap.set(p.id, ghostMesh);
				}
				dressModel(ghostMesh, ghostMat, true);
				if (p.ghost) {
					const gw = toWorld(p.ghost.x, p.ghost.y);
					ghostMesh.position.set(gw.x, 0, gw.z);
					ghostMesh.visible = true;
				} else {
					ghostMesh.visible = false;
				}

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
					const gm = ghostMap.get(pid);
					if (gm) {
						scene.remove(gm);
						ghostMap.delete(pid);
					}
				}
			}

			// camera: locked above the player, no sway, NO edge clamp — it rides free
			// (it sits far above wall height, so nothing clips; clamping made walls
			// seem to push the camera mid-map). The seeker just gets a wider lens.
			const k = camera.aspect < 0.9 ? 0.9 / camera.aspect : 1;
			const s = camScale * k;
			camera.position.set(selfX, 32 * s, selfZ + 10 * s);
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
