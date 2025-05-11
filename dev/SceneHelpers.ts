import * as THREE from "three";

interface GridHelperOptions {
	size: number;
	divisions: number;
	colorCenterLine?: number;
	colorGrid?: number;
	axis?: "x" | "y" | "z";
	opacity?: number;
	renderOrder?: number;
	transparent?: boolean;
}
function createGridHelper(options: GridHelperOptions): THREE.GridHelper {
	const {
		size,
		divisions,
		colorCenterLine = 0x000000,
		colorGrid = 0x000000,
		axis = "y",
		opacity = 0.5,
		renderOrder = 1,
		transparent = true,
	} = options;

	const gridHelper = new THREE.GridHelper(
		size,
		divisions,
		colorCenterLine,
		colorGrid
	);
	gridHelper.material.opacity = opacity;
	gridHelper.material.transparent = transparent;
	gridHelper.renderOrder = renderOrder;

	if (axis === "x") {
		gridHelper.rotation.x = Math.PI / 2;
	} else if (axis === "z") {
		gridHelper.rotation.z = Math.PI / 2;
	}

	return gridHelper;
}
export function getGridHelper(
	subGrid: boolean = false,
	subGridSize: number = 2,
	subGridDivisions: number = 16,
	subGridOpacity: number = 0.4
): THREE.Group {
	const group = new THREE.Group();
	group.name = "gridHelper";
	group.add(
		createGridHelper({
			size: 10,
			divisions: 10,
			colorCenterLine: 0xffffff,
			colorGrid: 0xffffff,
			axis: "y",
			opacity: 0.5,
			renderOrder: 1,
		})
	);

	if (subGrid) {
		const subGridOptions = {
			size: subGridSize,
			divisions: subGridDivisions * subGridSize,
			opacity: subGridOpacity,
			renderOrder: 2,
		};
		group.add(
			createGridHelper({
				...subGridOptions,
				colorCenterLine: 0x0000ff,
				colorGrid: 0x0000ff,
				axis: "x",
			}),
			createGridHelper({
				...subGridOptions,
				colorCenterLine: 0xff0000,
				colorGrid: 0xff0000,
				axis: "z",
			}),
			createGridHelper({
				...subGridOptions,
				colorCenterLine: 0x00ff00,
				colorGrid: 0x00ff00,
				axis: "y",
			})
		);
	}
	return group;
}

export function createAxesHelper(size: number) {
	const axesHelper = new THREE.Group();
	axesHelper.name = "axesHelper";

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
	axesHelper.renderOrder = 2; // make sure it renders after the grid helper
	axesHelper.position.set(0, 0.01, 0); // move it up a bit

	return axesHelper;
}

interface SceneLightOptions {
	color?: number;
	intensity?: number;
	position?: THREE.Vector3;
	castShadow?: boolean;
	receiveShadow?: boolean;
}

function createDirectionalLight(
	options: SceneLightOptions = {}
): THREE.DirectionalLight {
	const {
		color = 0xffffff,
		intensity = 1,
		position = new THREE.Vector3(5, 5, 5),
		castShadow = true,
		receiveShadow = true,
	} = options;

	const light = new THREE.DirectionalLight(color, intensity);
	light.position.copy(position);
	light.castShadow = castShadow;
	light.receiveShadow = receiveShadow;

	return light;
}

function createAmbientLight(
	color: number = 0xffffff,
	intensity: number = 1
): THREE.AmbientLight {
	return new THREE.AmbientLight(color, intensity);
}

export function getSceneLights(
	lights: SceneLightOptions[] = [
		{ color: 0xffffff, intensity: 1, position: new THREE.Vector3(5, 5, 5) },
		{ color: 0xffffff, intensity: 0.5, position: new THREE.Vector3(-5, 3, -5) },
	]
): THREE.Group {
	const group = new THREE.Group();
	group.name = "sceneLights";

	lights.forEach((lightOptions) => {
		const light = createDirectionalLight(lightOptions);
		group.add(light);
	});

	const ambientLight = createAmbientLight(0x404040, 0.5);
	group.add(ambientLight);

	return group;
}
