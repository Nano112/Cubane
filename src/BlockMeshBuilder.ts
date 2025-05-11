import * as THREE from "three";
import { AssetLoader, BlockModel, BlockModelElement } from "./AssetLoader";
import { Block } from "./types";

const FACING_UV_ROT: Record<string, 0 | 90 | 180 | 270> = {
	south: 180,
	east: 180,
	north: 180,
	west: 180,
	up: 0, // ← no extra turn
	down: 0, // ← no extra turn
};
export class BlockMeshBuilder {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	/**
	 * Create a mesh for a block model
	 * @param model The block model to create a mesh from
	 * @param transform Optional transform parameters (x, y rotation and uvlock)
	 * @param block Optional block data for tinting
	 * @param biome Optional biome string for color variations, defaults to "plains"
	 */
	public async createBlockMesh(
		model: BlockModel,
		transform: {
			x?: number;
			y?: number;
			uvlock?: boolean;
			block?: Block; // Include block in transform object for backward compatibility
		} = {},
		block?: Block, // Separate parameter for block data
		biome: string = "plains" // Default biome if none specified
	): Promise<THREE.Object3D> {
		console.log("Creating mesh for model:", model);

		// If no elements, return placeholder
		if (!model.elements || model.elements.length === 0) {
			console.warn("Model has no elements, creating placeholder");
			return this.createPlaceholderCube();
		}

		// Get the block from either parameter or transform object for backward compatibility
		const blockData = block || transform.block;

		// Create a group to hold all elements
		const group = new THREE.Group();

		// Process each element
		for (const element of model.elements) {
			try {
				const elementMesh = await this.createElementMesh(
					element,
					model,
					blockData,
					biome
				);
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

		// Store the block data and biome on the group for later reference
		if (blockData) {
			(group as any).blockData = blockData;
		}
		(group as any).biome = biome;

		// Return the group directly - don't try to combine into a single mesh
		return group;
	}

	/**
	 * Create a mesh for a single element
	 */
	private async createElementMesh(
		element: BlockModelElement,
		model: BlockModel,
		block?: Block, // Add block parameter
		biome: string = "plains" // Add biome parameter with default
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

				// Create face mesh, passing block and biome
				const faceMesh = await this.createFaceMesh(
					direction,
					size,
					faceData,
					model,
					block
				);
				elementGroup.add(faceMesh);
			}
		}

		if (element.rotation) {
			const rotationGroup = new THREE.Group();

			const origin = [
				element.rotation.origin[0] / 16 - 0.5,
				element.rotation.origin[1] / 16 - 0.5,
				element.rotation.origin[2] / 16 - 0.5,
			];

			rotationGroup.position.set(origin[0], origin[1], origin[2]);

			elementGroup.position.set(
				center[0] - origin[0],
				center[1] - origin[1],
				center[2] - origin[2]
			);

			rotationGroup.add(elementGroup);

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
		model: BlockModel,
		block?: Block
	): Promise<THREE.Mesh> {
		let geometry: THREE.PlaneGeometry;
		let position: [number, number, number] = [0, 0, 0];

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

		this.mapUVCoordinates(geometry, direction, faceData);

		const texturePath = this.assetLoader.resolveTexture(
			faceData.texture,
			model
		);

		let material: THREE.Material;
		try {
			const isTransparent =
				texturePath.includes("glass") ||
				texturePath.includes("leaves") ||
				texturePath.includes("water");

			let tint: THREE.Color | undefined = undefined;
			if (block && faceData.tintindex !== undefined) {
				const blockId = `${block.namespace}:${block.name}`;
				tint = this.assetLoader.getTint(blockId, block.properties);
			}

			material = await this.assetLoader.getMaterial(texturePath, {
				transparent: isTransparent,
				tint: tint,
			});

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

		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(...position);

		return mesh;
	}

	private mapUVCoordinates(
		geometry: THREE.PlaneGeometry,
		direction: string,
		faceData: any
	): void {
		if (!faceData.uv) {
			return;
		}

		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;

		const [uMin, vMin, uMax, vMax] = faceData.uv;

		const uvCoords = this.getBaseUVs(
			uMin / 16,
			vMin / 16,
			uMax / 16,
			vMax / 16
		);

		const rot =
			((faceData.rotation ?? 0) + FACING_UV_ROT[direction]) /* ← new */ % 360;
		if (rot !== 0) {
			this.applyUVRotation(uvCoords, rot);
		}
		uvAttribute.set(uvCoords);
		uvAttribute.needsUpdate = true;
	}

	private getBaseUVs(
		u1: number,
		v1: number,
		u2: number,
		v2: number
	): Float32Array {
		const y1 = 1 - v2; // Top becomes bottom
		const y2 = 1 - v1; // Bottom becomes top

		// Single canonical ordering for every face (BL, BR, TL, TR)
		return new Float32Array([
			u1,
			y1, // Bottom left
			u2,
			y1, // Bottom right
			u1,
			y2, // Top left
			u2,
			y2, // Top right
		]);
	}

	private applyUVRotation(uvCoords: Float32Array, rotation: number): void {
		const temp = new Float32Array(uvCoords);
		switch (rotation) {
			case 0: // No rotation
				break;
			case 90: // 90 degrees clockwise
				uvCoords[0] = temp[4];
				uvCoords[1] = temp[5]; // bottom left gets top left
				uvCoords[2] = temp[0];
				uvCoords[3] = temp[1]; // bottom right gets bottom left
				uvCoords[4] = temp[6];
				uvCoords[5] = temp[7]; // top left gets top right
				uvCoords[6] = temp[2];
				uvCoords[7] = temp[3]; // top right gets bottom right
				break;
			case 180: // 180 degrees
				uvCoords[0] = temp[6];
				uvCoords[1] = temp[7]; // bottom left gets top right
				uvCoords[2] = temp[4];
				uvCoords[3] = temp[5]; // bottom right gets top left
				uvCoords[4] = temp[2];
				uvCoords[5] = temp[3]; // top left gets bottom right
				uvCoords[6] = temp[0];
				uvCoords[7] = temp[1]; // top right gets bottom left
				break;
			case 270: // 270 degrees clockwise
				uvCoords[0] = temp[2];
				uvCoords[1] = temp[3]; // bottom left gets bottom right
				uvCoords[2] = temp[6];
				uvCoords[3] = temp[7]; // bottom right gets top right
				uvCoords[4] = temp[0];
				uvCoords[5] = temp[1]; // top left gets bottom left
				uvCoords[6] = temp[4];
				uvCoords[7] = temp[5]; // top right gets top left
				break;
			default:
				console.warn(`Unsupported rotation: ${rotation}`);
		}
	}

	private createPlaceholderCube(): THREE.Mesh {
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
			})
		);
	}
}
