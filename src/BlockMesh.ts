import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { EntityRenderer } from "./EntityRenderer";
import { Block } from "./types";
import { ModelResolver } from "./ModelResolver";
import { BlockMeshBuilder } from "./BlockMeshBuilder";

const BLOCK_ENTITY_MAP = {
	"minecraft:chest": "chest",
	"minecraft:trapped_chest": "trapped_chest",
	"minecraft:ender_chest": "ender_chest",
	"minecraft:bell": "bell",
};

/**
 * Parse a block string like "minecraft:oak_log[axis=y]" into structured data
 */
function parseBlockString(blockString: string): Block {
	const result: Block = {
		namespace: "minecraft",
		name: "",
		properties: {},
	};

	// Parse namespace and name
	const namespaceParts = blockString.split(":");
	if (namespaceParts.length > 1) {
		result.namespace = namespaceParts[0];
		const remaining = namespaceParts[1];

		// Parse properties if they exist
		const propertyIndex = remaining.indexOf("[");
		if (propertyIndex !== -1) {
			result.name = remaining.substring(0, propertyIndex);
			const propertiesString = remaining.substring(
				propertyIndex + 1,
				remaining.length - 1
			);

			// Split properties by comma and extract key-value pairs
			propertiesString.split(",").forEach((prop) => {
				const [key, value] = prop.split("=");
				if (key && value) {
					result.properties[key.trim()] = value.trim();
				}
			});
		} else {
			result.name = remaining;
		}
	} else {
		result.name = blockString;
	}

	return result;
}

// Create singleton instances
const assetLoader = new AssetLoader();
const modelResolver = new ModelResolver(assetLoader);
const meshBuilder = new BlockMeshBuilder(assetLoader);
const entityRenderer = new EntityRenderer();

// Track initialization status
let initialized = false;
const initPromise = Promise.resolve().then(() => {
	initialized = true;
});

export function updateAnimatedTextures(): void {
	// Access the singleton assetLoader instance and call updateAnimations
	assetLoader.updateAnimations();
}

/**
 * Load a resource pack for use with block rendering
 */
export async function loadResourcePack(blob: Blob): Promise<void> {
	if (!initialized) {
		await initPromise;
	}

	await assetLoader.loadResourcePack(blob);
}

/**
 * Get a Three.js mesh for a Minecraft block string
 * @param blockString Block string like "minecraft:oak_log[axis=y]"
 * @param biome Optional biome identifier for tinting, defaults to "plains"
 * @param position Optional position for additional context
 */
export async function getBlockMesh(
	blockString: string,
	biome: string = "plains",
	position?: THREE.Vector3
): Promise<THREE.Object3D> {
	if (!initialized) {
		await initPromise;
	}

	try {
		console.log(`Creating mesh for block: ${blockString}`);

		// Parse block string
		const block = parseBlockString(blockString);
		console.log("Parsed block:", block);

		// Check if this is a block entity
		const blockId = `${block.namespace}:${block.name}`;
		let entityType = BLOCK_ENTITY_MAP[blockId as keyof typeof BLOCK_ENTITY_MAP];

		//if the block.namespace is entity, use entity renderer
		if (block.namespace === "entity") {
			entityType = block.name;
		}
		if (entityType) {
			// This is a block entity, use entity renderer
			return entityRenderer.createEntityMesh(entityType);
		}

		// Resolve model data
		const modelDataList = await modelResolver.resolveBlockModel(block);
		console.log("Resolved model data:", modelDataList);

		if (modelDataList.length === 0) {
			console.warn(`No models found for block: ${blockString}`);
			return new THREE.Mesh(
				new THREE.BoxGeometry(1, 1, 1),
				new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
			);
		}

		// Get meshes for all models
		const objectPromises = modelDataList.map(async (modelData) => {
			try {
				// Load model
				const model = await assetLoader.getModel(modelData.model);
				console.log(`Loaded model ${modelData.model}:`, model);

				// Create mesh - passing the block and biome
				return await meshBuilder.createBlockMesh(
					model,
					{
						x: modelData.x,
						y: modelData.y,
						uvlock: modelData.uvlock,
					},
					block, // Pass the block for tinting
					biome // Pass the biome
				);
			} catch (error) {
				console.error(
					`Error creating mesh for model ${modelData.model}:`,
					error
				);
				return null;
			}
		});

		// Wait for all objects
		const objects = (await Promise.all(objectPromises)).filter(
			Boolean
		) as THREE.Object3D[];

		if (objects.length === 0) {
			console.warn(`Failed to create any meshes for block: ${blockString}`);
			return new THREE.Mesh(
				new THREE.BoxGeometry(1, 1, 1),
				new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
			);
		}

		// If only one object, return it
		if (objects.length === 1) {
			return objects[0];
		}

		// For multiple objects, create a parent group
		const group = new THREE.Group();
		objects.forEach((obj) => group.add(obj.clone())); // Clone to avoid removing from original parent

		// Store block and biome information on the group for later reference
		(group as any).blockData = block;
		(group as any).biome = biome;
		if (position) {
			group.position.copy(position);
		}

		// Set the name of the group for debugging
		group.name = `block_${block.name.replace("minecraft:", "")}`;

		return group;
	} catch (error) {
		console.error(`Error creating block mesh:`, error);

		// Return fallback mesh
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
		);
	}
}
