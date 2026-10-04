import * as three from "three";

export function startGame(canvas: HTMLCanvasElement) {
	const scene = new three.Scene();
	scene.background = new three.Color("#040355");
	const camera = new three.PerspectiveCamera(
		75,
		canvas.width / canvas.height,
		0.1,
		800,
	);
	const renderer = new three.WebGLRenderer({ canvas });
	renderer.setSize(canvas.width, canvas.height);


	const geometry = new three.BoxGeometry( 1, 1, 1);
	const material = new three.MeshBasicMaterial({color : "#00ff00"});
	const cube = new three.Mesh(geometry, material);
	scene.add(cube);

	const plane_geo = new three.PlaneGeometry(3,3);
	const plane = new three.Mesh(plane_geo, material);
	plane.rotation.x = -Math.PI / 2;
	scene.add(plane);

	camera.position.y = 5;
	camera.position.z = 0;
	camera.rotation.x = -Math.PI / 2;

	function animate (time) {
		cube.rotation.x = time / 2000;
		cube.rotation.z = time/ 300;

		const hue = (time / 5000) % 1;
		material.color.setHSL(hue, 1, 0.5);
		renderer.render(scene, camera);
	}
	renderer.setAnimationLoop(animate);
}
