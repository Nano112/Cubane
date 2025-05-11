# Cubane

A Three.js-based Minecraft block and entity renderer that supports resource packs, animated textures, and block states.

## Features

- Load official Minecraft resource packs directly
- Render blocks with accurate models and textures
- Support for block states and variants
- Special liquid rendering for water and lava with animations
- Entity rendering (chests, signs, etc.)
- Automatic resource pack caching using IndexedDB
- Biome-specific block tinting

## Installation

```bash
npm install cubane three
# or
yarn add cubane three
```

## Basic Usage

```javascript
import * as THREE from "three";
import { Cubane } from "cubane";

// Setup Three.js
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	1000
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Create Cubane instance
const cubane = new Cubane();

// Load a resource pack
async function init() {
	// Load from file input
	const fileInput = document.getElementById("resource-pack");
	fileInput.addEventListener("change", async (e) => {
		const file = e.target.files[0];
		await cubane.loadResourcePack(
			{
				packId: "default-pack",
				useCache: true,
			},
			async () => file
		);

		createBlocks();
	});

	// Try loading from cache first
	const loaded = await cubane.loadMostRecentPack();
	if (loaded) createBlocks();
}

// Create some blocks
async function createBlocks() {
	// Simple stone block
	const stone = await cubane.getBlockMesh("minecraft:stone");
	stone.position.set(0, 0, 0);
	scene.add(stone);

	// Block with state
	const log = await cubane.getBlockMesh("minecraft:oak_log[axis=y]");
	log.position.set(0, 1, 0);
	scene.add(log);

	// Water with level
	const water = await cubane.getBlockMesh("minecraft:water[level=2]");
	water.position.set(1, 0, 0);
	scene.add(water);

	// Entity
	const chest = await cubane.getEntityMesh("chest");
	chest.position.set(1, 1, 0);
	scene.add(chest);
}

// Animation loop
function animate() {
	requestAnimationFrame(animate);

	// Update animations (water, lava, etc.)
	cubane.updateAnimations();

	renderer.render(scene, camera);
}

init();
animate();
```

## API Reference

### Cubane

Main class that handles block rendering, resource packs, and animations.

#### Methods

- `loadResourcePack(options, loader)` - Load a resource pack with caching options
- `getBlockMesh(blockString, biome?, position?)` - Get a Three.js mesh for a block
- `getEntityMesh(entityType, position?)` - Get a Three.js mesh for an entity
- `updateAnimations()` - Update animated textures (call in render loop)
- `loadMostRecentPack()` - Load the most recently used resource pack from cache
- `listCachedResourcePacks()` - List all resource packs in the cache
- `loadCachedPack(packId)` - Load a specific resource pack from cache by ID
- `deleteCachedPack(packId)` - Delete a resource pack from cache
- `dispose()` - Clean up resources

### Block States

Cubane supports Minecraft's block state syntax:

```
minecraft:block_name[property1=value1,property2=value2]
```

Examples:

- `minecraft:stone` - Basic stone block
- `minecraft:oak_log[axis=y]` - Oak log oriented along Y axis
- `minecraft:water[level=3]` - Water with level 3
- `minecraft:chest[facing=north]` - Chest facing north

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
