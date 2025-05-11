import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Cubane, ResourcePackLoadOptions } from "../src/index";
import {
	createAxesHelper,
	getGridHelper,
	getSceneLights,
} from "./SceneHelpers";

// Initialize the scene
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	1000
);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;

// Setup controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Initialize Cubane
const cubane = new Cubane();

// Set up scene
let debug = false;
let gridHelper: THREE.Group;
let axesHelper: THREE.Group;

// Setup camera
camera.position.set(5, 3, 5);
camera.lookAt(0, 0, 0);

// Block management
type BlockData = {
	id: string;
	blockString: string;
	position: THREE.Vector3;
	mesh: THREE.Object3D;
};

const blocks: BlockData[] = [];
let selectedBlockId: string | null = null;
let placementMode: "add" | "move" | "delete" = "add";

// Grid for block placement
const gridSize = 1; // Size of each grid cell

// Raycaster for block placement
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const planeGeometry = new THREE.PlaneGeometry(100, 100);
const planeMaterial = new THREE.MeshBasicMaterial({
	visible: false,
});
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.position.y = 0;
scene.add(plane);

// Temporary mesh for preview
let previewMesh: THREE.Object3D | null = null;

// Update scene based on debug mode
function updateDebugMode() {
	// Safely check if the checkbox exists before using it
	const checkbox = document.getElementById("debugMode") as HTMLInputElement;
	debug = checkbox ? checkbox.checked : false;

	// Remove existing helpers
	if (gridHelper) scene.remove(gridHelper);
	if (axesHelper) scene.remove(axesHelper);

	// Add helpers if debug mode is on
	if (debug) {
		gridHelper = getGridHelper(true);
		axesHelper = createAxesHelper(1);
		scene.add(gridHelper);
		scene.add(axesHelper);
	} else {
		gridHelper = getGridHelper(false);
		scene.add(gridHelper);
	}
}

// Initialize the scene with lights
function initScene() {
	scene.add(getSceneLights());
	updateDebugMode();
}

// Update the status message
function updateStatus(message: string) {
	const statusElement = document.getElementById("status");
	if (statusElement) statusElement.textContent = message;
	console.log(message);
}

// Update the block list UI
function updateBlockList() {
	const blockListItems = document.getElementById("blockListItems");
	if (!blockListItems) return;

	blockListItems.innerHTML = "";

	if (blocks.length === 0) {
		blockListItems.innerHTML = "<p>No blocks placed</p>";
		return;
	}

	blocks.forEach((block) => {
		const item = document.createElement("div");
		item.className = `block-item ${
			block.id === selectedBlockId ? "active" : ""
		}`;

		const pos = block.position;
		item.innerHTML = `
      <span>${block.blockString}<br>
      <small>Position: ${pos.x.toFixed(1)}, ${pos.y.toFixed(
			1
		)}, ${pos.z.toFixed(1)}</small></span>
      <button class="delete-block" data-id="${block.id}">×</button>
    `;

		item.addEventListener("click", (e) => {
			// Ignore clicks on the delete button
			if ((e.target as HTMLElement).className === "delete-block") return;

			selectBlock(block.id);
		});

		blockListItems.appendChild(item);
	});

	// Add event listeners for delete buttons
	document.querySelectorAll(".delete-block").forEach((button) => {
		button.addEventListener("click", () => {
			const id = (button as HTMLElement).getAttribute("data-id");
			if (id) removeBlock(id);
		});
	});
}

// Select a block
function selectBlock(id: string) {
	selectedBlockId = id;
	updateBlockList();

	// Highlight the selected block
	blocks.forEach((block) => {
		if (block.mesh instanceof THREE.Mesh) {
			if (block.id === selectedBlockId) {
				// Add outline or highlight effect
				if (!block.mesh.userData.originalMaterial) {
					if (block.mesh.material instanceof THREE.Material) {
						block.mesh.userData.originalMaterial = block.mesh.material;

						if (Array.isArray(block.mesh.material)) {
							// Handle multi-material case
							block.mesh.material.forEach((mat: THREE.Material) => {
								if (mat instanceof THREE.MeshStandardMaterial) {
									mat.emissive = new THREE.Color(0x444444);
								}
							});
						} else {
							// Single material
							if (block.mesh.material instanceof THREE.MeshStandardMaterial) {
								block.mesh.material.emissive = new THREE.Color(0x444444);
							}
						}
					}
				}
			} else {
				// Remove highlight
				if (block.mesh.userData.originalMaterial) {
					if (Array.isArray(block.mesh.material)) {
						// Handle multi-material case
						block.mesh.material.forEach((mat: THREE.Material) => {
							if (mat instanceof THREE.MeshStandardMaterial) {
								mat.emissive = new THREE.Color(0x000000);
							}
						});
					} else {
						// Single material
						if (block.mesh.material instanceof THREE.MeshStandardMaterial) {
							block.mesh.material.emissive = new THREE.Color(0x000000);
						}
					}
					delete block.mesh.userData.originalMaterial;
				}
			}
		}
	});
}

// Add a new block
async function addBlock(blockString: string, position: THREE.Vector3) {
	try {
		const mesh = await cubane.getBlockMesh(blockString);
		mesh.position.copy(position);

		const id = `block_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

		const blockData: BlockData = {
			id,
			blockString,
			position: position.clone(),
			mesh,
		};

		blocks.push(blockData);
		scene.add(mesh);

		updateStatus(
			`Added ${blockString} at ${position.x.toFixed(1)}, ${position.y.toFixed(
				1
			)}, ${position.z.toFixed(1)}`
		);
		updateBlockList();

		return id;
	} catch (error) {
		updateStatus(`Error adding block: ${error}`);
		return null;
	}
}

// Remove a block
function removeBlock(id: string) {
	const index = blocks.findIndex((block) => block.id === id);

	if (index !== -1) {
		const block = blocks[index];
		scene.remove(block.mesh);
		blocks.splice(index, 1);

		if (selectedBlockId === id) {
			selectedBlockId = null;
		}

		updateStatus(`Removed ${block.blockString}`);
		updateBlockList();
	}
}

// Move a block
function moveBlock(id: string, position: THREE.Vector3) {
	const block = blocks.find((block) => block.id === id);

	if (block) {
		block.position.copy(position);
		block.mesh.position.copy(position);

		updateStatus(
			`Moved ${block.blockString} to ${position.x.toFixed(
				1
			)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`
		);
		updateBlockList();
	}
}

// Clear all blocks
function clearAllBlocks() {
	blocks.forEach((block) => {
		scene.remove(block.mesh);
	});

	blocks.length = 0;
	selectedBlockId = null;

	updateStatus("Cleared all blocks");
	updateBlockList();
}

// Get position snapped to grid
function getSnappedPosition(position: THREE.Vector3): THREE.Vector3 {
	return new THREE.Vector3(
		Math.round(position.x / gridSize) * gridSize,
		Math.round(position.y / gridSize) * gridSize,
		Math.round(position.z / gridSize) * gridSize
	);
}

async function loadResourcePackFromFile(file: File) {
	try {
		updateStatus("Loading resource pack...");

		const packId = `cubane_pack_${file.name.replace(/\W/g, "_")}`;

		const options: ResourcePackLoadOptions = {
			packId,
			useCache: true,
			forceReload: false,
		};

		await cubane.loadResourcePack(options, async () => {
			updateStatus("Downloading resource pack...");
			return file;
		});

		// Check if it was loaded from cache
		const loadedFromCache = cubane.lastPackLoadedFromCache;

		updateStatus(
			`Resource pack ${
				loadedFromCache ? "loaded from cache" : "downloaded and cached"
			} successfully!`
		);
		const packStatusElement = document.getElementById("packStatus");
		if (packStatusElement)
			packStatusElement.textContent = `Loaded: ${file.name} ${
				loadedFromCache ? "(from cache)" : "(downloaded)"
			}`;
	} catch (error) {
		updateStatus(`Error loading resource pack: ${error}`);
	}
}

// Update preview mesh
async function updatePreviewMesh() {
	// Remove existing preview
	if (previewMesh) {
		scene.remove(previewMesh);
		previewMesh = null;
	}

	if (placementMode === "add") {
		try {
			const blockInput = document.getElementById(
				"blockInput"
			) as HTMLInputElement;
			if (!blockInput) return;

			const blockString = blockInput.value;
			previewMesh = await cubane.getBlockMesh(blockString);

			// Make it semi-transparent
			previewMesh.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					if (Array.isArray(child.material)) {
						child.material.forEach((mat) => {
							mat.transparent = true;
							mat.opacity = 0.5;
						});
					} else {
						child.material.transparent = true;
						child.material.opacity = 0.5;
					}
				}
			});

			scene.add(previewMesh);
		} catch (error) {
			console.error("Error creating preview mesh:", error);
		}
	}
}

// Handle mouse move
function onMouseMove(event: MouseEvent) {
	// Calculate mouse position in normalized device coordinates (-1 to +1)
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

	// Update raycaster
	raycaster.setFromCamera(mouse, camera);

	if (placementMode === "add" && previewMesh) {
		// Raycast against the plane or other objects
		const intersects = raycaster.intersectObjects([
			plane,
			...blocks.map((b) => b.mesh),
		]);

		if (intersects.length > 0) {
			const intersection = intersects[0];
			let position;

			if (intersection.object === plane) {
				// Placing on the ground plane
				position = intersection.point;
			} else {
				// Placing on another block
				position = intersection.point.add(
					intersection.face!.normal.multiplyScalar(0.5)
				);
			}

			// Snap to grid
			const snappedPosition = getSnappedPosition(position);
			previewMesh.position.copy(snappedPosition);
		}
	} else if (placementMode === "move" && selectedBlockId) {
		// Move the selected block
		const intersects = raycaster.intersectObject(plane);

		if (intersects.length > 0) {
			const position = getSnappedPosition(intersects[0].point);

			// Find the selected block
			const block = blocks.find((block) => block.id === selectedBlockId);
			if (block) {
				block.mesh.position.copy(position);
			}
		}
	}
}

// Handle mouse click
function onMouseClick(event: MouseEvent) {
	// Calculate mouse position
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

	// Update raycaster
	raycaster.setFromCamera(mouse, camera);

	if (placementMode === "add") {
		// Place a new block
		const intersects = raycaster.intersectObjects([
			plane,
			...blocks.map((b) => b.mesh),
		]);

		if (intersects.length > 0) {
			const intersection = intersects[0];
			let position;

			if (intersection.object === plane) {
				// Placing on the ground plane
				position = intersection.point;
			} else {
				// Placing on another block
				position = intersection.point.add(
					intersection.face!.normal.multiplyScalar(0.5)
				);
			}

			// Snap to grid
			const snappedPosition = getSnappedPosition(position);

			const blockInput = document.getElementById(
				"blockInput"
			) as HTMLInputElement;
			if (blockInput) {
				addBlock(blockInput.value, snappedPosition);
			}
		}
	} else if (placementMode === "move" && selectedBlockId) {
		// Finalize the move
		const intersects = raycaster.intersectObject(plane);

		if (intersects.length > 0) {
			const position = getSnappedPosition(intersects[0].point);
			moveBlock(selectedBlockId, position);
		}
	} else if (placementMode === "delete") {
		// Delete a block
		const intersects = raycaster.intersectObjects(blocks.map((b) => b.mesh));

		if (intersects.length > 0) {
			const clickedMesh = intersects[0].object;

			// Find the block that contains this mesh
			const block = blocks.find((block) => {
				if (block.mesh === clickedMesh) return true;

				// Check if the mesh is a child of the block
				let isChild = false;
				block.mesh.traverse((child) => {
					if (child === clickedMesh) isChild = true;
				});

				return isChild;
			});

			if (block) {
				removeBlock(block.id);
			}
		}
	} else {
		// Select a block
		const intersects = raycaster.intersectObjects(blocks.map((b) => b.mesh));

		if (intersects.length > 0) {
			const clickedMesh = intersects[0].object;

			// Find the block that contains this mesh
			const block = blocks.find((block) => {
				if (block.mesh === clickedMesh) return true;

				// Check if the mesh is a child of the block
				let isChild = false;
				block.mesh.traverse((child) => {
					if (child === clickedMesh) isChild = true;
				});

				return isChild;
			});

			if (block) {
				selectBlock(block.id);
			}
		} else {
			// Clicked on empty space, deselect
			selectedBlockId = null;
			updateBlockList();
		}
	}
}

// Handle window resize
function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
	requestAnimationFrame(animate);

	// Update controls
	controls.update();

	// Update animations
	cubane.updateAnimations();

	// Render
	renderer.render(scene, camera);
}

// Show resource pack manager
async function showPackManager() {
	// Get modal
	const modal = document.getElementById("pack-manager");
	if (!modal) return;

	modal.style.display = "block";

	// Load and display cached packs
	await refreshPackList();
}

// Hide resource pack manager
function hidePackManager() {
	const modal = document.getElementById("pack-manager");
	if (modal) modal.style.display = "none";
}

// Refresh pack list
async function refreshPackList() {
	const availablePacks = document.getElementById("available-packs");
	if (!availablePacks) return;

	// Get list of cached packs
	const packs = await cubane.listCachedResourcePacks();

	if (packs.length === 0) {
		availablePacks.innerHTML =
			"<p>No resource packs in cache. Upload one first.</p>";
		return;
	}

	// Create list
	const listElement = document.createElement("div");
	listElement.className = "pack-list";

	packs.forEach((pack) => {
		const item = document.createElement("div");
		item.className = "pack-item";
		item.dataset.id = pack.id;

		// Format date
		const date = new Date(pack.timestamp);
		const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();

		// Format size in MB
		const sizeMB = (pack.size / (1024 * 1024)).toFixed(2);

		item.innerHTML = `
            <div>
                <strong>${pack.name}</strong>
                <div class="pack-info">Size: ${sizeMB} MB • Added: ${dateStr}</div>
            </div>
        `;

		item.addEventListener("click", () => {
			// Deselect all
			document.querySelectorAll(".pack-item").forEach((el) => {
				el.classList.remove("selected");
			});

			// Select this one
			item.classList.add("selected");
		});

		listElement.appendChild(item);
	});

	// Replace content
	availablePacks.innerHTML = "";
	availablePacks.appendChild(listElement);
}

// Load the selected resource pack
async function loadSelectedPack() {
	const selectedItem = document.querySelector(".pack-item.selected");
	if (!selectedItem) {
		alert("Please select a resource pack first");
		return;
	}

	const packId = selectedItem.getAttribute("data-id");
	if (!packId) return;

	updateStatus("Loading resource pack from cache...");

	const success = await cubane.loadCachedPack(packId);

	if (success) {
		updateStatus("Resource pack loaded successfully from cache!");
		const packName =
			selectedItem.querySelector("strong")?.textContent || "Unknown";

		const packStatusElement = document.getElementById("packStatus");
		if (packStatusElement) {
			packStatusElement.textContent = `Loaded: ${packName} (from cache)`;
		}

		hidePackManager();
		updatePreviewMesh();
	} else {
		updateStatus("Failed to load resource pack from cache.");
	}
}

// Delete the selected resource pack
async function deleteSelectedPack() {
	const selectedItem = document.querySelector(".pack-item.selected");
	if (!selectedItem) {
		alert("Please select a resource pack first");
		return;
	}

	const packId = selectedItem.getAttribute("data-id");
	if (!packId) return;

	const packName =
		selectedItem.querySelector("strong")?.textContent || "this pack";

	if (confirm(`Are you sure you want to delete "${packName}" from cache?`)) {
		const success = await cubane.deleteCachedPack(packId);

		if (success) {
			updateStatus(`Deleted resource pack "${packName}" from cache`);
			await refreshPackList();
		} else {
			updateStatus("Failed to delete resource pack.");
		}
	}
}

// Try to load the most recent resource pack on startup
async function tryLoadMostRecentPack() {
	updateStatus("Checking for cached resource packs...");

	const loaded = await cubane.loadMostRecentPack();

	if (loaded) {
		// Get the pack info
		const packs = await cubane.listCachedResourcePacks();
		if (packs.length > 0) {
			const packName = packs[0].name;
			updateStatus(`Automatically loaded resource pack: ${packName}`);

			const packStatusElement = document.getElementById("packStatus");
			if (packStatusElement) {
				packStatusElement.textContent = `Loaded: ${packName} (auto-loaded)`;
			}

			return true;
		}
	} else {
		updateStatus("No cached resource packs found. Please upload one.");
		return false;
	}
}

// Set up event listeners
function setupEventListeners() {
	// Resource pack loading
	document.getElementById("loadResourcePack")?.addEventListener("click", () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".zip";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				await loadResourcePackFromFile(file);
				updatePreviewMesh();
			}
		};
		input.click();
	});

	// Block loading
	document.getElementById("addBlock")?.addEventListener("click", () => {
		const blockInput = document.getElementById(
			"blockInput"
		) as HTMLInputElement;
		if (!blockInput) return;

		if (previewMesh) {
			addBlock(blockInput.value, previewMesh.position.clone());
		} else {
			addBlock(blockInput.value, new THREE.Vector3(0, 0.5, 0));
		}
	});

	// Mode selection
	document.getElementById("addMode")?.addEventListener("click", () => {
		placementMode = "add";
		document
			.querySelectorAll(".mode-select button")
			.forEach((btn) => btn.classList.remove("active"));
		document.getElementById("addMode")?.classList.add("active");
		updatePreviewMesh();
	});

	document.getElementById("moveMode")?.addEventListener("click", () => {
		placementMode = "move";
		document
			.querySelectorAll(".mode-select button")
			.forEach((btn) => btn.classList.remove("active"));
		document.getElementById("moveMode")?.classList.add("active");
		if (previewMesh) {
			scene.remove(previewMesh);
			previewMesh = null;
		}
	});

	document.getElementById("deleteMode")?.addEventListener("click", () => {
		placementMode = "delete";
		document
			.querySelectorAll(".mode-select button")
			.forEach((btn) => btn.classList.remove("active"));
		document.getElementById("deleteMode")?.classList.add("active");
		if (previewMesh) {
			scene.remove(previewMesh);
			previewMesh = null;
		}
	});

	// Block input change
	const blockInput = document.getElementById("blockInput") as HTMLInputElement;
	if (blockInput) {
		blockInput.addEventListener("input", updatePreviewMesh);
	}

	// Preset buttons
	document.querySelectorAll(".preset-button").forEach((button) => {
		button.addEventListener("click", () => {
			const blockString = (button as HTMLElement).getAttribute("data-block");
			const blockInput = document.getElementById(
				"blockInput"
			) as HTMLInputElement;
			if (blockString && blockInput) {
				blockInput.value = blockString;
				updatePreviewMesh();
			}
		});
	});

	// Debug mode toggle
	const debugModeCheckbox = document.getElementById(
		"debugMode"
	) as HTMLInputElement;
	if (debugModeCheckbox) {
		debugModeCheckbox.addEventListener("change", updateDebugMode);
	}

	// Clear all blocks
	document.getElementById("clearAll")?.addEventListener("click", () => {
		if (confirm("Are you sure you want to clear all blocks?")) {
			clearAllBlocks();
		}
	});

	// Mouse events
	window.addEventListener("mousemove", onMouseMove);
	window.addEventListener("click", onMouseClick);

	// Window resize
	window.addEventListener("resize", onWindowResize);

	// Manage packs button
	document
		.getElementById("manage-packs")
		?.addEventListener("click", showPackManager);

	// Close pack manager
	document
		.getElementById("close-pack-manager")
		?.addEventListener("click", hidePackManager);
	document.querySelector(".close")?.addEventListener("click", hidePackManager);

	// Load selected pack
	document
		.getElementById("load-selected-pack")
		?.addEventListener("click", loadSelectedPack);

	// Delete selected pack
	document
		.getElementById("delete-selected-pack")
		?.addEventListener("click", deleteSelectedPack);
}

// Main initialization function
async function init() {
	// Initialize the scene
	initScene();
	setupEventListeners();
	updateBlockList();

	// Try to auto-load the most recent resource pack
	await tryLoadMostRecentPack();

	// Start animation loop
	animate();
}

// Wait for DOM to be fully loaded before initializing
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	// If DOMContentLoaded already fired, run init immediately
	init();
}
