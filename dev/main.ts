// test/main.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
	getBlockMesh,
	loadResourcePack,
	updateAnimatedTextures,
} from "../src/BlockMesh";
import {
	createAxesHelper,
	getGridHelper,
	getSceneLights,
} from "./SceneHelpers";
let debug = false;
// Canvas and Three.js setup...
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	1000
);

const renderer = new THREE.WebGLRenderer({ canvas });
const controls = new OrbitControls(camera, renderer.domElement);
controls.update();
renderer.setSize(window.innerWidth, window.innerHeight);
scene.add(getGridHelper(debug));
if (debug) {
	scene.add(createAxesHelper(0.5));
}
scene.add(getSceneLights());
camera.position.z = 5;
camera.position.y = 2;

let currentMesh: THREE.Mesh | null = null;
async function updateBlockFromInput() {
	const blockString = (
		document.getElementById("blockInput") as HTMLInputElement
	).value;
	// Remove current mesh if it exists
	if (currentMesh) {
		scene.remove(currentMesh);
	}
	// Load new mesh
	currentMesh = (await getBlockMesh(blockString)) as THREE.Mesh;
	// currentMesh.position.set(0, 0.5, 0);
	scene.add(currentMesh);
	// Update camera to look at the new mesh
	camera.lookAt(currentMesh.position);
	console.log("Block loaded successfully!");
}
// Set up resource pack loading
document
	.getElementById("loadResourcePack")
	?.addEventListener("click", async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".zip";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				await loadResourcePack(file);
				// alert("Resource pack loaded successfully!");
				console.log("Resource pack loaded successfully!");
			}
		};
		input.click();
		updateBlockFromInput();
	});

// Set up block loading

document.getElementById("loadBlock")?.addEventListener("click", async () => {
	updateBlockFromInput();
	// alert("Block loaded successfully!");
});

function animate() {
	requestAnimationFrame(animate);
	controls.update();
	renderer.render(scene, camera);
	updateAnimatedTextures();
}
animate();

updateBlockFromInput();
