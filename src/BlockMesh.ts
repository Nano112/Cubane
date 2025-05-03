import * as THREE from "three";
import JSZip from "jszip";
import { AssetLoader, BlockModel, BlockModelElement } from "./AssetLoader";

// Block parser interface and function
export interface Block {
	namespace: string;
	name: string;
	properties: Record<string, string>;
}

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

/**
 * ModelResolver class to convert block states to model data
 */
class ModelResolver {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	/**
	 * Resolve a block to its models
	 */
	public async resolveBlockModel(block: Block): Promise<ModelData[]> {
		// Get block state definition
		const blockName = block.name.replace("minecraft:", "");
		const blockStateDefinition = await this.assetLoader.getBlockState(
			blockName
		);

		console.log(
			`Resolving models for block ${blockName}`,
			blockStateDefinition
		);

		// If no definition, return empty array
		if (
			!blockStateDefinition ||
			(!blockStateDefinition.variants && !blockStateDefinition.multipart)
		) {
			console.warn(`No blockstate definition found for ${blockName}`);
			return [];
		}

		const models: ModelData[] = [];

		// Handle variants
		if (blockStateDefinition.variants) {
			// Get properties that are used in variants
			const variantKeys = Object.keys(blockStateDefinition.variants);
			const validVariantProperties = new Set<string>();

			// Extract property names from variant keys
			for (const key of variantKeys) {
				if (key === "") continue; // Skip empty key

				const parts = key.split(",");
				for (const part of parts) {
					const propertyName = part.split("=")[0];
					validVariantProperties.add(propertyName);
				}
			}

			// Build variant key from block properties
			let variantKey = "";
			if (Object.keys(block.properties).length > 0) {
				// Only include properties that are part of the variants
				const filteredProps = Object.entries(block.properties)
					.filter(([key]) => validVariantProperties.has(key))
					.map(([key, value]) => `${key}=${value}`);

				// Sort for consistency and join with commas
				variantKey = filteredProps.sort().join(",");
			}

			console.log(`Looking for variant: "${variantKey}"`);

			// Try to find the variant
			let variant = blockStateDefinition.variants[variantKey];

			// If not found, try empty variant
			if (!variant && blockStateDefinition.variants[""]) {
				console.log(`Variant "${variantKey}" not found, using default variant`);
				variant = blockStateDefinition.variants[""];
			}

			// If still not found, try single property variants
			if (!variant && Object.keys(block.properties).length > 0) {
				// For blocks like logs with only axis property
				for (const [key, value] of Object.entries(block.properties)) {
					const singlePropKey = `${key}=${value}`;
					if (blockStateDefinition.variants[singlePropKey]) {
						console.log(`Using single property variant: ${singlePropKey}`);
						variant = blockStateDefinition.variants[singlePropKey];
						break;
					}
				}
			}

			// If still not found, use first available variant
			if (!variant && variantKeys.length > 0) {
				const firstKey = variantKeys[0];
				console.log(
					`No matching variant found, using first available: ${firstKey}`
				);
				variant = blockStateDefinition.variants[firstKey];
			}

			// Add the variant model(s) if found
			if (variant) {
				if (Array.isArray(variant)) {
					// Multiple models with weights, just use the first one for simplicity
					models.push(this.createModelData(variant[0]));
				} else {
					models.push(this.createModelData(variant));
				}
			}
		}

		// Handle multipart models
		if (blockStateDefinition.multipart) {
			for (const part of blockStateDefinition.multipart) {
				let applies = true;

				// Check conditions
				if (part.when) {
					if ("OR" in part.when) {
						// OR condition - any of the conditions can match
						applies = false;
						for (const condition of part.when.OR) {
							if (this.matchesCondition(block, condition)) {
								applies = true;
								break;
							}
						}
					} else {
						// AND condition - all conditions must match
						applies = this.matchesCondition(block, part.when);
					}
				}

				// If conditions are met, add the model(s)
				if (applies) {
					if (Array.isArray(part.apply)) {
						// Multiple models, just use the first one for simplicity
						models.push(this.createModelData(part.apply[0]));
					} else {
						models.push(this.createModelData(part.apply));
					}
				}
			}
		}

		return models;
	}

	private createModelData(modelHolder: any): ModelData {
		return {
			model: modelHolder.model,
			x: modelHolder.x,
			y: modelHolder.y,
			uvlock: modelHolder.uvlock,
		};
	}

	private matchesCondition(
		block: Block,
		condition: Record<string, string>
	): boolean {
		for (const [property, value] of Object.entries(condition)) {
			const blockValue = block.properties[property];

			// If property not found, condition fails
			if (blockValue === undefined) {
				return false;
			}

			// Check for OR value (pipe separated)
			if (value.includes("|")) {
				const values = value.split("|");
				if (!values.includes(blockValue)) {
					return false;
				}
			} else if (blockValue !== value) {
				// Simple equality check
				return false;
			}
		}

		return true;
	}
}

/**
 * Model data interface
 */
interface ModelData {
	model: string;
	x?: number;
	y?: number;
	uvlock?: boolean;
}

/**
 * MeshBuilder class to create Three.js meshes from models
 */
class MeshBuilder {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	/**
	 * Create a Three.js mesh from a block model
	 */
	/**
	 * Create a mesh for a block model
	 */
	public async createBlockMesh(
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean } = {}
	): Promise<THREE.Object3D> {
		console.log("Creating mesh for model:", model);

		// If no elements, return placeholder
		if (!model.elements || model.elements.length === 0) {
			console.warn("Model has no elements, creating placeholder");
			return this.createPlaceholderCube();
		}

		// Create a group to hold all elements
		const group = new THREE.Group();

		// Process each element
		for (const element of model.elements) {
			try {
				const elementMesh = await this.createElementMesh(element, model);
				group.add(elementMesh);
			} catch (error) {
				console.error("Error creating element mesh:", error);
			}
		}

		// Apply transformations
		if (transform.y !== undefined) {
			group.rotateY((transform.y * Math.PI) / 180);
		}

		if (transform.x !== undefined) {
			group.rotateX((transform.x * Math.PI) / 180);
		}

		// If group is empty, return placeholder
		if (group.children.length === 0) {
			return this.createPlaceholderCube();
		}

		// Return the group directly - don't try to combine into a single mesh
		return group;
	}

	/**
	 * Create a mesh for a single element
	 */
	private async createElementMesh(
		element: BlockModelElement,
		model: BlockModel
	): Promise<THREE.Object3D> {
		// Extract element properties
		const from = element.from || [0, 0, 0];
		const to = element.to || [16, 16, 16];

		// Calculate dimensions in Three.js units (1 block = 1 unit)
		const size = [
			(to[0] - from[0]) / 16,
			(to[1] - from[1]) / 16,
			(to[2] - from[2]) / 16,
		];

		// Calculate center position
		const center = [
			(from[0] + to[0]) / 32 - 0.5,
			(from[1] + to[1]) / 32 - 0.5,
			(from[2] + to[2]) / 32 - 0.5,
		];

		// Create group for this element
		const elementGroup = new THREE.Group();
		elementGroup.position.set(center[0], center[1], center[2]);

		// Create faces
		if (element.faces) {
			const faceDirections = [
				"down",
				"up",
				"north",
				"south",
				"west",
				"east",
			] as const;

			for (const direction of faceDirections) {
				const faceData = element.faces[direction];
				if (!faceData) continue;

				// Create face mesh
				const faceMesh = await this.createFaceMesh(
					direction,
					size,
					faceData,
					model
				);
				elementGroup.add(faceMesh);
			}
		}

		// Apply rotation if specified
		if (element.rotation) {
			const rotationGroup = new THREE.Group();

			// Set rotation origin
			const origin = [
				element.rotation.origin[0] / 16 - 0.5,
				element.rotation.origin[1] / 16 - 0.5,
				element.rotation.origin[2] / 16 - 0.5,
			];

			rotationGroup.position.set(origin[0], origin[1], origin[2]);

			// Position element relative to rotation origin
			elementGroup.position.set(
				center[0] - origin[0],
				center[1] - origin[1],
				center[2] - origin[2]
			);

			rotationGroup.add(elementGroup);

			// Apply rotation
			const angle = (element.rotation.angle * Math.PI) / 180;
			switch (element.rotation.axis) {
				case "x":
					rotationGroup.rotateX(angle);
					break;
				case "y":
					rotationGroup.rotateY(angle);
					break;
				case "z":
					rotationGroup.rotateZ(angle);
					break;
			}

			return rotationGroup;
		}

		return elementGroup;
	}

	private async createFaceMesh(
		direction: string,
		size: number[],
		faceData: any,
		model: BlockModel
	): Promise<THREE.Mesh> {
		// Create geometry based on direction
		let geometry: THREE.PlaneGeometry;
		let position: [number, number, number] = [0, 0, 0];

		// Create the appropriate geometry for each face with correct dimensions
		switch (direction) {
			case "down":
				geometry = new THREE.PlaneGeometry(size[0], size[2]);
				geometry.rotateX(-Math.PI / 2);
				position = [0, -size[1] / 2, 0];
				break;
			case "up":
				geometry = new THREE.PlaneGeometry(size[0], size[2]);
				geometry.rotateX(Math.PI / 2);
				position = [0, size[1] / 2, 0];
				break;
			case "north":
				geometry = new THREE.PlaneGeometry(size[0], size[1]);
				geometry.rotateY(Math.PI);
				position = [0, 0, -size[2] / 2];
				break;
			case "south":
				geometry = new THREE.PlaneGeometry(size[0], size[1]);
				position = [0, 0, size[2] / 2];
				break;
			case "west":
				geometry = new THREE.PlaneGeometry(size[2], size[1]);
				geometry.rotateY(-Math.PI / 2);
				position = [-size[0] / 2, 0, 0];
				break;
			case "east":
				geometry = new THREE.PlaneGeometry(size[2], size[1]);
				geometry.rotateY(Math.PI / 2);
				position = [size[0] / 2, 0, 0];
				break;
			default:
				throw new Error(`Unknown face direction: ${direction}`);
		}

		// Apply UV mapping if specified
		if (faceData.uv) {
			const [uMin, vMin, uMax, vMax] = faceData.uv;

			// Handle reversed UVs
			const u1 = Math.min(uMin, uMax) / 16;
			const u2 = Math.max(uMin, uMax) / 16;
			const v1 = Math.min(vMin, vMax) / 16;
			const v2 = Math.max(vMin, vMax) / 16;

			// Minecraft V coordinates go from top to bottom, THREE.js goes bottom to top
			const y1 = 1 - v2;
			const y2 = 1 - v1;

			const uvs = geometry.attributes.uv as THREE.BufferAttribute;

			// Default UV mapping (will be rotated if needed)
			const uvArray = [
				u1,
				y1, // bottom left
				u2,
				y1, // bottom right
				u1,
				y2, // top left
				u2,
				y2, // top right
			];

			// Apply UV mapping
			uvs.set(uvArray);

			// Apply rotation (This is separate from the rotation property and applies to the UV coordinates)
			if (faceData.rotation) {
				const tempBuffer = new Float32Array(8);

				// Clone current UVs
				tempBuffer.set(uvArray);

				// Apply rotation
				switch (faceData.rotation) {
					case 90:
						// 90° rotation: u1,v1 → u2,v1 → u2,v2 → u1,v2 → u1,v1
						uvs.setXY(0, tempBuffer[2], tempBuffer[3]); // bottom left
						uvs.setXY(1, tempBuffer[0], tempBuffer[1]); // bottom right
						uvs.setXY(2, tempBuffer[6], tempBuffer[7]); // top left
						uvs.setXY(3, tempBuffer[4], tempBuffer[5]); // top right
						break;
					case 180:
						// 180° rotation: u1,v1 → u2,v2 → u1,v2 → u2,v1 → u1,v1
						uvs.setXY(0, tempBuffer[6], tempBuffer[7]); // bottom left
						uvs.setXY(1, tempBuffer[4], tempBuffer[5]); // bottom right
						uvs.setXY(2, tempBuffer[2], tempBuffer[3]); // top left
						uvs.setXY(3, tempBuffer[0], tempBuffer[1]); // top right
						break;
					case 270:
						// 270° rotation: u1,v1 → u1,v2 → u2,v2 → u2,v1 → u1,v1
						uvs.setXY(0, tempBuffer[4], tempBuffer[5]); // bottom left
						uvs.setXY(1, tempBuffer[6], tempBuffer[7]); // bottom right
						uvs.setXY(2, tempBuffer[0], tempBuffer[1]); // top left
						uvs.setXY(3, tempBuffer[2], tempBuffer[3]); // top right
						break;
				}
			}

			uvs.needsUpdate = true;
		}

		// Resolve texture
		const texturePath = this.assetLoader.resolveTexture(
			faceData.texture,
			model
		);
		console.log(`Face ${direction} using texture: ${texturePath}`);

		// Create material
		let material: THREE.Material;
		try {
			// Check if transparent
			const isTransparent =
				texturePath.includes("glass") ||
				texturePath.includes("leaves") ||
				texturePath.includes("water");

			// Get material
			material = await this.assetLoader.getMaterial(texturePath, {
				transparent: isTransparent,
			});

			// Force double-sided rendering for all faces
			if (material instanceof THREE.Material) {
				material = material.clone();
				material.side = THREE.DoubleSide;
			}
		} catch (error) {
			console.warn(`Failed to create material for ${texturePath}:`, error);
			material = new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
				side: THREE.DoubleSide,
			});
		}

		// Create mesh
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(...position);

		return mesh;
	}

	/**
	 * Create a placeholder cube for missing models
	 */
	private createPlaceholderCube(): THREE.Mesh {
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
			})
		);
	}

	/**
	 * Combine a group of meshes into a single mesh
	 */

	private combineGroupToMesh(group: THREE.Group): THREE.Mesh {
		// Collect all face meshes
		const faceMeshes: Record<string, THREE.Mesh> = {
			up: null,
			down: null,
			north: null,
			south: null,
			east: null,
			west: null,
		};

		// Find face meshes in the group structure
		const findFaceMeshes = (obj: THREE.Object3D, parentName: string = "") => {
			// If it's a mesh, check if it's a face
			if (obj instanceof THREE.Mesh) {
				// Try to identify which face this is based on position
				const pos = obj.position;

				if (pos.y > 0.4) faceMeshes.up = obj;
				else if (pos.y < -0.4) faceMeshes.down = obj;
				else if (pos.z < -0.4) faceMeshes.north = obj;
				else if (pos.z > 0.4) faceMeshes.south = obj;
				else if (pos.x < -0.4) faceMeshes.west = obj;
				else if (pos.x > 0.4) faceMeshes.east = obj;
			}

			// Process children recursively
			obj.children.forEach((child) => {
				findFaceMeshes(child, obj.name);
			});
		};

		// Find all face meshes in the group
		findFaceMeshes(group);

		// Create a BoxGeometry for our cube
		const geometry = new THREE.BoxGeometry(1, 1, 1);

		// Create materials array for each face of the cube
		// BoxGeometry face order: [right, left, top, bottom, front, back]
		// Our face order: [east, west, up, down, north, south]
		const materials = [
			faceMeshes.east?.material ||
				new THREE.MeshStandardMaterial({ color: 0xff00ff }),
			faceMeshes.west?.material ||
				new THREE.MeshStandardMaterial({ color: 0xff00ff }),
			faceMeshes.up?.material ||
				new THREE.MeshStandardMaterial({ color: 0xff00ff }),
			faceMeshes.down?.material ||
				new THREE.MeshStandardMaterial({ color: 0xff00ff }),
			faceMeshes.north?.material ||
				new THREE.MeshStandardMaterial({ color: 0xff00ff }),
			faceMeshes.south?.material ||
				new THREE.MeshStandardMaterial({ color: 0xff00ff }),
		];

		// Create the mesh with the geometry and materials
		const cube = new THREE.Mesh(geometry, materials);

		return cube;
	}
}

// Create singleton instances
const assetLoader = new AssetLoader();
const modelResolver = new ModelResolver(assetLoader);
const meshBuilder = new MeshBuilder(assetLoader);

// Track initialization status
let initialized = false;
const initPromise = Promise.resolve().then(() => {
	initialized = true;
});

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
 */
/**
 * Get a Three.js mesh for a Minecraft block string
 * @param blockString Block string like "minecraft:oak_log[axis=y]"
 */
/**
 * Get a Three.js mesh for a Minecraft block string
 * @param blockString Block string like "minecraft:oak_log[axis=y]"
 */
export async function getBlockMesh(
	blockString: string
): Promise<THREE.Object3D> {
	if (!initialized) {
		await initPromise;
	}

	try {
		console.log(`Creating mesh for block: ${blockString}`);

		// Parse block string
		const block = parseBlockString(blockString);
		console.log("Parsed block:", block);

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

				// Create mesh
				return await meshBuilder.createBlockMesh(model, {
					x: modelData.x,
					y: modelData.y,
					uvlock: modelData.uvlock,
				});
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
