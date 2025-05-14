import * as THREE from "three";
import { AssetLoader } from "./AssetLoader"; // Adjust path if necessary
import { Block, BlockModel, BlockModelElement } from "./types"; // Adjust path if necessary

const FACING_UV_ROT: Record<string, 0 | 90 | 180 | 270> = {
	south: 180,
	east: 180,
	north: 180,
	west: 180,
	up: 180,
	down: 180,
};

export class BlockMeshBuilder {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	public async createBlockMesh(
		model: BlockModel,
		transform: {
			x?: number;
			y?: number;
			uvlock?: boolean;
			block?: Block;
		} = {},
		block?: Block,
		biome: string = "plains"
	): Promise<THREE.Object3D> {
		// console.log("Creating mesh for model:", model.parent || 'base model');

		if (!model.elements || model.elements.length === 0) {
			// console.warn("Model has no elements, creating placeholder");
			return this.createPlaceholderCube();
		}

		const blockData = block || transform.block;
		const isLiquid = blockData && this.isLiquidBlock(blockData);
		const isWater = blockData && this.isWaterBlock(blockData);

		const group = new THREE.Group(); // This group's (0,0,0) will be the block's min_x, min_y, min_z

		for (const element of model.elements) {
			try {
				const elementMesh = await this.createElementMesh(
					element,
					model,
					blockData,
					biome
				);
				group.add(elementMesh); // Add directly, elementMesh is already in 0-1 local block space
			} catch (error) {
				console.error(
					"Error creating element mesh:",
					error,
					"for element:",
					element,
					"in model:",
					model
				);
			}
		}

		if (transform.y !== undefined) {
			group.rotateY((transform.y * Math.PI) / 180);
		}
		if (transform.x !== undefined) {
			group.rotateX((transform.x * Math.PI) / 180);
		}

		if (group.children.length === 0) {
			// console.warn("Group is empty after processing elements, creating placeholder");
			return this.createPlaceholderCube();
		}

		if (blockData) {
			(group as any).blockData = blockData;
		}
		(group as any).biome = biome;
		if (isLiquid) {
			(group as any).isLiquid = true;
			(group as any).isWater = isWater;
			(group as any).isLava = isLiquid && !isWater;
		}
		return group;
	}

	private isLiquidBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		const blockId = `${blockData.namespace}:${blockData.name}`;
		return blockId.includes("water") || blockId.includes("lava");
	}

	private isWaterBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		const blockId = `${blockData.namespace}:${blockData.name}`;
		return blockId.includes("water") && !blockId.includes("waterlogged");
	}

	private isLavaBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		const blockId = `${blockData.namespace}:${blockData.name}`;
		return blockId.includes("lava");
	}

	private async createElementMesh(
		element: BlockModelElement,
		model: BlockModel,
		blockData?: Block,
		biome: string = "plains"
	): Promise<THREE.Object3D> {
		const fromJSON = element.from || [0, 0, 0];
		const toJSON = element.to || [16, 16, 16];

		const from = fromJSON.map((c) => c / 16);
		const to = toJSON.map((c) => c / 16);

		let size = [
			// Mutable if water
			to[0] - from[0],
			to[1] - from[1],
			to[2] - from[2],
		];

		let center = [
			// Mutable if water
			from[0] + size[0] / 2,
			from[1] + size[1] / 2,
			from[2] + size[2] / 2,
		];

		if (blockData && this.isWaterBlock(blockData) && toJSON[1] === 16) {
			// Compare with original 0-16 scale
			const adjustedToY_mc = 14;
			to[1] = adjustedToY_mc / 16;
			size[1] = to[1] - from[1];
			center[1] = from[1] + size[1] / 2;
		}

		const elementGeometryGroup = new THREE.Group();

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

				const faceMesh = await this.createFaceMesh(
					direction,
					size,
					faceData,
					model,
					blockData,
					biome
				);
				elementGeometryGroup.add(faceMesh);
			}
		}

		let finalElementMesh: THREE.Object3D;

		if (element.rotation) {
			const rotationGroup = new THREE.Group();
			const rotationOriginJSON = element.rotation.origin || [8, 8, 8];
			const rotationOrigin = rotationOriginJSON.map((c) => c / 16);

			rotationGroup.position.set(
				rotationOrigin[0],
				rotationOrigin[1],
				rotationOrigin[2]
			);

			elementGeometryGroup.position.set(
				center[0] - rotationOrigin[0],
				center[1] - rotationOrigin[1],
				center[2] - rotationOrigin[2]
			);

			rotationGroup.add(elementGeometryGroup);

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
			finalElementMesh = rotationGroup;
		} else {
			elementGeometryGroup.position.set(center[0], center[1], center[2]);
			finalElementMesh = elementGeometryGroup;
		}

		return finalElementMesh;
	}

	private async createFaceMesh(
		direction: string,
		size: number[],
		faceData: any,
		model: BlockModel,
		blockData?: Block,
		biome?: string
	): Promise<THREE.Mesh> {
		let geometry: THREE.PlaneGeometry;
		let position: [number, number, number] = [0, 0, 0];

		switch (direction) {
			case "down":
				geometry = new THREE.PlaneGeometry(size[0], size[2]);
				geometry.rotateX(Math.PI / 2);
				position = [0, -size[1] / 2, 0];
				break;
			case "up":
				geometry = new THREE.PlaneGeometry(size[0], size[2]);
				geometry.rotateX(-Math.PI / 2);
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

		let texturePath = this.assetLoader.resolveTexture(faceData.texture, model);
		const isWater = this.isWaterBlock(blockData);
		const isLava = this.isLavaBlock(blockData);
		const isLiquid = isWater || isLava;

		if (isWater) {
			if (direction === "up" || direction === "down")
				texturePath = "block/water_still";
			else texturePath = "block/water_flow";
		} else if (isLava) {
			if (direction === "up" || direction === "down")
				texturePath = "block/lava_still";
			else texturePath = "block/lava_flow";
		}

		let material: THREE.Material;
		try {
			const isTransparentTexture =
				texturePath.includes("glass") || texturePath.includes("leaves");
			const effectiveTransparent = isTransparentTexture || isWater; // Water is transparent

			let tint: THREE.Color | undefined = undefined;
			if (blockData && faceData.tintindex !== undefined) {
				const blockId = `${blockData.namespace}:${blockData.name}`;
				tint = this.assetLoader.getTint(blockId, blockData.properties, biome);
			}
			if (isWater && !tint) tint = new THREE.Color(0x3f76e4);

			const materialOptions: any = {
				transparent: effectiveTransparent,
				tint: tint,
				isLiquid: isLiquid,
				isWater: isWater,
				isLava: isLava,
				faceDirection: direction,
				forceAnimation: isLiquid,
				biome: biome,
			};

			material = await this.assetLoader.getMaterial(
				texturePath,
				materialOptions
			);

			if (material instanceof THREE.Material) {
				material = material.clone();

				const isThinElementHeuristic =
					size[0] < 0.01 || size[1] < 0.01 || size[2] < 0.01;
				const isKnownThinTexture =
					texturePath.includes("tendril") ||
					texturePath.includes("pane") ||
					texturePath.includes("fence") ||
					texturePath.includes("rail") ||
					texturePath.includes("door") ||
					texturePath.includes("trapdoor") ||
					texturePath.includes("ladder");

				if (isThinElementHeuristic || isKnownThinTexture) {
					material.side = THREE.DoubleSide;
				} else {
					material.side = THREE.FrontSide;
				}
				// Ensure transparency is set correctly if material indicates it or it's water
				if (effectiveTransparent) {
					material.transparent = true;
				}

				if (isWater) {
					// material.transparent = true; // Already handled by effectiveTransparent
					material.opacity =
						materialOptions.opacity !== undefined
							? materialOptions.opacity
							: 0.8; // Use opacity from options if provided, else default
					material.userData.isWater = true;
					material.userData.faceDirection = direction;
					if (
						direction === "up" &&
						material instanceof THREE.MeshStandardMaterial
					) {
						material.roughness = 0.1;
						material.metalness = 0.3;
					}
				}
				if (isLava && material instanceof THREE.MeshStandardMaterial) {
					material.emissive = new THREE.Color(0xff2200);
					material.emissiveIntensity = 0.5;
					material.roughness = 0.7;
					material.userData.isLava = true;
					material.userData.faceDirection = direction;
				}
			} else {
				// Should not happen if getMaterial resolves
				throw new Error(
					"AssetLoader.getMaterial did not return a THREE.Material instance"
				);
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

		if (isLiquid) {
			mesh.userData.isLiquid = true;
			mesh.userData.isWater = isWater;
			mesh.userData.isLava = isLava;
			mesh.userData.faceDirection = direction;
			mesh.renderOrder = isWater ? 1 : 0;
		}
		return mesh;
	}

	private mapUVCoordinates(
		geometry: THREE.PlaneGeometry,
		direction: string,
		faceData: any
	): void {
		if (!faceData.uv) {
			// Default UVs (0,0 to 1,1) will be used by PlaneGeometry
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
		// Ensure FACING_UV_ROT access is safe for potentially undefined keys
		const baseRotation =
			FACING_UV_ROT[direction as keyof typeof FACING_UV_ROT] ?? 0;
		const rot = ((faceData.rotation ?? 0) + baseRotation) % 360;

		if (rot !== 0) {
			this.applyUVRotation(uvCoords, rot);
		}
		uvAttribute.array.set(uvCoords); // Use .array.set for direct manipulation
		uvAttribute.needsUpdate = true;
	}

	private getBaseUVs(
		u1: number,
		v1: number,
		u2: number,
		v2: number
	): Float32Array {
		// Standard PlaneGeometry UV order: (0,1) (1,1) (0,0) (1,0) for vertices BL, BR, TL, TR
		// Our desired output for .set needs to match this if we directly set.
		// Minecraft UV: u1,v1 is top-left; u2,v2 is bottom-right of the texture area.
		// Three.js UV: (0,0) is bottom-left; (1,1) is top-right of the texture.
		// So, v1_three = 1 - v1_mc, v2_three = 1 - v2_mc
		// Let's map to the order PlaneGeometry vertices are defined:
		// Vertices: bottom-left, bottom-right, top-left, top-right (in its local XY before rotation)
		// Corresponding UVs:
		return new Float32Array([
			u1,
			1 - v2, // Corresponds to vertex at (localX_min, localY_min) -> UV (uMin, vMax_inverted)
			u2,
			1 - v2, // Corresponds to vertex at (localX_max, localY_min) -> UV (uMax, vMax_inverted)
			u1,
			1 - v1, // Corresponds to vertex at (localX_min, localY_max) -> UV (uMin, vMin_inverted)
			u2,
			1 - v1, // Corresponds to vertex at (localX_max, localY_max) -> UV (uMax, vMin_inverted)
		]);
	}

	private applyUVRotation(uvCoords: Float32Array, rotation: number): void {
		// Assumes uvCoords is [u0,v0, u1,v1, u2,v2, u3,v3] for vertices BL, BR, TL, TR of the plane
		const temp = new Float32Array(uvCoords);
		switch (rotation) {
			case 0:
				break;
			case 90: // Rotate UVs 90 degrees clockwise around center of UV area
				// BL (0) -> TL (2)
				// BR (1) -> BL (0)
				// TL (2) -> TR (3)
				// TR (3) -> BR (1)
				uvCoords[0] = temp[4];
				uvCoords[1] = temp[5]; // BL takes TL's UV
				uvCoords[2] = temp[0];
				uvCoords[3] = temp[1]; // BR takes BL's UV
				uvCoords[4] = temp[6];
				uvCoords[5] = temp[7]; // TL takes TR's UV
				uvCoords[6] = temp[2];
				uvCoords[7] = temp[3]; // TR takes BR's UV
				break;
			case 180:
				// BL (0) -> TR (3)
				// BR (1) -> TL (2)
				// TL (2) -> BR (1)
				// TR (3) -> BL (0)
				uvCoords[0] = temp[6];
				uvCoords[1] = temp[7];
				uvCoords[2] = temp[4];
				uvCoords[3] = temp[5];
				uvCoords[4] = temp[2];
				uvCoords[5] = temp[3];
				uvCoords[6] = temp[0];
				uvCoords[7] = temp[1];
				break;
			case 270:
				// BL (0) -> BR (1)
				// BR (1) -> TR (3)
				// TL (2) -> BL (0)
				// TR (3) -> TL (2)
				uvCoords[0] = temp[2];
				uvCoords[1] = temp[3];
				uvCoords[2] = temp[6];
				uvCoords[3] = temp[7];
				uvCoords[4] = temp[0];
				uvCoords[5] = temp[1];
				uvCoords[6] = temp[4];
				uvCoords[7] = temp[5];
				break;
			default:
				console.warn(`Unsupported UV rotation: ${rotation}`);
		}
	}

	private createPlaceholderCube(): THREE.Mesh {
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
				side: THREE.FrontSide,
			})
		);
	}
}
