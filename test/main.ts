// test/main.ts
import * as THREE from "three";
import { getBlockMesh, loadResourcePack } from "../src/BlockMesh";

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
renderer.setSize(window.innerWidth, window.innerHeight);

// Add lighting and grid helper...
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 5, 5).normalize();
scene.add(light);
const gridHelper = new THREE.GridHelper(10, 10);
scene.add(gridHelper);

// Add ambient light to ensure no face is completely dark
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

// Add directional lights from multiple angles
const light1 = new THREE.DirectionalLight(0xffffff, 0.7);
light1.position.set(5, 5, 5);
scene.add(light1);

const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
light2.position.set(-5, 3, -5);
scene.add(light2);

// Set up camera
camera.position.z = 5;
camera.position.y = 2;

// Add an input field and button to test different blocks
const controls = document.createElement("div");
controls.className = "absolute top-4 left-4 flex gap-2";
controls.innerHTML = `
  <input id="blockInput" class="px-2 py-1 bg-gray-800 border border-gray-700 rounded" 
         value="minecraft:oak_log[axis=y]" />
  <button id="loadBlock" class="px-3 py-1 bg-blue-600 rounded">Load Block</button>
  <button id="loadResourcePack" class="px-3 py-1 bg-green-600 rounded">Load Resource Pack</button>
`;
document.body.appendChild(controls);

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
				alert("Resource pack loaded successfully!");
			}
		};
		input.click();
	});

// Set up block loading
let currentMesh: THREE.Mesh | null = null;
document.getElementById("loadBlock")?.addEventListener("click", async () => {
	const blockString = (
		document.getElementById("blockInput") as HTMLInputElement
	).value;

	// Remove current mesh if it exists
	if (currentMesh) {
		scene.remove(currentMesh);
	}

	// Load new mesh
	currentMesh = await getBlockMesh(blockString);
	currentMesh.position.set(0, 0.5, 0);
	scene.add(currentMesh);

	// Update camera to look at the new mesh
	camera.lookAt(currentMesh.position);
});

// Animation loop
let angle = 0;
const speed = 0.005;
const animate = function () {
	requestAnimationFrame(animate);
	camera.position.x = 5 * Math.cos(angle);
	camera.position.z = 5 * Math.sin(angle);
	if (currentMesh) {
		camera.lookAt(currentMesh.position);
	}
	angle += speed;
	renderer.render(scene, camera);
};
animate();
