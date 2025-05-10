// test/main.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
	getBlockMesh,
	loadResourcePack,
	updateAnimatedTextures,
} from "../src/BlockMesh";

// Canvas and Three.js setup...
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	1000
);

// add a axis helper

const renderer = new THREE.WebGLRenderer({ canvas });
const controls = new OrbitControls(camera, renderer.domElement);
controls.update();
renderer.setSize(window.innerWidth, window.innerHeight);

// Add lighting and grid helper...
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 5, 5).normalize();
scene.add(light);
const gridHelper = new THREE.GridHelper(10, 10);
//make it a bit thicker
gridHelper.material.linewidth = 2;
//make it render before the sub grid
gridHelper.renderOrder = 1;
scene.add(gridHelper);

// sub grid helper dividing each unit into 16 parts
const subGridUnitPerBlock = 16;
const subGridSize = 2; // size of the sub grid
const subGridDivisions = subGridUnitPerBlock * subGridSize; // number of divisions
const subGridHelper = new THREE.GridHelper(subGridSize, subGridDivisions);
// make it more transparent
//make it a different color
subGridHelper.material.color.set(0x00ff00);
subGridHelper.material.opacity = 0.8;
subGridHelper.material.transparent = true;

const subGridHelperX = new THREE.GridHelper(subGridSize, subGridDivisions);
subGridHelperX.material.color.set(0x0000ff);
subGridHelperX.material.opacity = 0.8;
subGridHelperX.material.transparent = true;
subGridHelperX.rotation.x = Math.PI / 2; // rotate it to be horizontal
scene.add(subGridHelperX);

// make a third grid helper for the z axis
const subGridHelperZ = new THREE.GridHelper(subGridSize, subGridDivisions);
subGridHelperZ.material.color.set(0xff0000);
subGridHelperZ.material.opacity = 0.8;
subGridHelperZ.material.transparent = true;
subGridHelperZ.rotation.z = Math.PI / 2; // rotate it to be horizontal
scene.add(subGridHelperZ);

// make a axes helper from 3 cylinders
function createAxesHelper(size: number) {
	const axesHelper = new THREE.Group();

	const xAxis = new THREE.CylinderGeometry(0.02, 0.02, size, 8);
	const yAxis = new THREE.CylinderGeometry(0.02, 0.02, size, 8);
	const zAxis = new THREE.CylinderGeometry(0.02, 0.02, size, 8);

	const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
	const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });

	const xMesh = new THREE.Mesh(xAxis, xMaterial);
	xMesh.rotation.z = Math.PI / 2;
	xMesh.position.set(size / 2, 0, 0);

	const yMesh = new THREE.Mesh(yAxis, yMaterial);
	yMesh.position.set(0, size / 2, 0);

	const zMesh = new THREE.Mesh(zAxis, zMaterial);
	zMesh.rotation.x = Math.PI / 2;
	zMesh.position.set(0, 0, size / 2);

	axesHelper.add(xMesh);
	axesHelper.add(yMesh);
	axesHelper.add(zMesh);

	return axesHelper;
}
const axesHelper = createAxesHelper(0.5);
axesHelper.renderOrder = 2; // make sure it renders after the grid helper
axesHelper.position.set(0, 0.01, 0); // move it up a bit
scene.add(axesHelper);
scene.add(subGridHelper);
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
	// currentMesh.position.set(0, 0.5, 0);
	scene.add(currentMesh);

	// Update camera to look at the new mesh
	camera.lookAt(currentMesh.position);
});

function animate() {
	requestAnimationFrame(animate);

	// required if controls.enableDamping or controls.autoRotate are set to true
	controls.update();

	renderer.render(scene, camera);
}
animate();

//default to minecraft:chest as a first block
const defaultBlock = "minecraft:bell";
currentMesh = await getBlockMesh(defaultBlock);
scene.add(currentMesh);
camera.lookAt(currentMesh.position);
