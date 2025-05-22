import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { Block, BlockModel, BlockModelElement } from "./types";

const FACING_UV_ROT: Record<string, 0 | 90 | 180 | 270> = {
	south: 180,
	east: 180,
	north: 180,
	west: 180,
	up: 180,
	down: 180,
};

interface GeometryGroup {
	geometry: THREE.BufferGeometry;
	material: THREE.Material;
	isLiquid?: boolean;
	isWater?: boolean;
	isLava?: boolean;
}

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
		if (!model.elements || model.elements.length === 0) {
			return this.createPlaceholderCube();
		}

		const blockData = block || transform.block;
		const isLiquid = blockData && this.isLiquidBlock(blockData);
		const isWater = blockData && this.isWaterBlock(blockData);

		// Collect all geometries grouped by material
		const geometryGroups = new Map<string, GeometryGroup>();

		for (const element of model.elements) {
			try {
				const elementGeometries = await this.createElementGeometries(
					element,
					model,
					blockData,
					biome
				);

				// Group geometries by material key
				for (const {
					geometry,
					material,
					materialKey,
					isLiquid,
					isWater,
					isLava,
				} of elementGeometries) {
					if (!geometryGroups.has(materialKey)) {
						geometryGroups.set(materialKey, {
							geometry: new THREE.BufferGeometry(),
							material: material,
							isLiquid,
							isWater,
							isLava,
						});
					}

					// Merge this geometry into the group
					const group = geometryGroups.get(materialKey)!;
					group.geometry = this.mergeGeometries([group.geometry, geometry]);
				}
			} catch (error) {
				console.error("Error creating element geometries:", error);
			}
		}

		// Create final group with merged meshes
		const finalGroup = new THREE.Group();

		for (const [
			materialKey,
			{ geometry, material, isLiquid, isWater, isLava },
		] of geometryGroups) {
			if (
				geometry.attributes.position &&
				geometry.attributes.position.count > 0
			) {
				const mesh = new THREE.Mesh(geometry, material);

				if (isLiquid) {
					mesh.userData.isLiquid = true;
					mesh.userData.isWater = isWater;
					mesh.userData.isLava = isLava;
					mesh.renderOrder = isWater ? 1 : 0;
				}

				finalGroup.add(mesh);
			}
		}

		// Apply transforms
		if (transform.y !== undefined) {
			finalGroup.rotateY((transform.y * Math.PI) / 180);
		}
		if (transform.x !== undefined) {
			finalGroup.rotateX((transform.x * Math.PI) / 180);
		}

		if (finalGroup.children.length === 0) {
			return this.createPlaceholderCube();
		}

		// Add metadata
		if (blockData) {
			(finalGroup as any).blockData = blockData;
		}
		(finalGroup as any).biome = biome;
		if (isLiquid) {
			(finalGroup as any).isLiquid = true;
			(finalGroup as any).isWater = isWater;
			(finalGroup as any).isLava = isLiquid && !isWater;
		}

		return finalGroup;
	}

	private async createElementGeometries(
		element: BlockModelElement,
		model: BlockModel,
		blockData?: Block,
		biome: string = "plains"
	): Promise<
		Array<{
			geometry: THREE.BufferGeometry;
			material: THREE.Material;
			materialKey: string;
			isLiquid?: boolean;
			isWater?: boolean;
			isLava?: boolean;
		}>
	> {
		const fromJSON = element.from || [0, 0, 0];
		const toJSON = element.to || [16, 16, 16];

		const from = fromJSON.map((c) => c / 16);
		const to = toJSON.map((c) => c / 16);

		let size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];

		let center = [
			from[0] + size[0] / 2,
			from[1] + size[1] / 2,
			from[2] + size[2] / 2,
		];

		// Water level adjustment
		if (blockData && this.isWaterBlock(blockData) && toJSON[1] === 16) {
			const adjustedToY_mc = 14;
			to[1] = adjustedToY_mc / 16;
			size[1] = to[1] - from[1];
			center[1] = from[1] + size[1] / 2;
		}

		const geometries: Array<{
			geometry: THREE.BufferGeometry;
			material: THREE.Material;
			materialKey: string;
			isLiquid?: boolean;
			isWater?: boolean;
			isLava?: boolean;
		}> = [];

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

				const { geometry, material, materialKey, isLiquid, isWater, isLava } =
					await this.createFaceGeometry(
						direction,
						size,
						faceData,
						model,
						blockData,
						biome
					);

				// Apply transformations to geometry
				this.applyElementTransforms(geometry, element, center, size, direction);

				geometries.push({
					geometry,
					material,
					materialKey,
					isLiquid,
					isWater,
					isLava,
				});
			}
		}

		return geometries;
	}

	private async createFaceGeometry(
		direction: string,
		size: number[],
		faceData: any,
		model: BlockModel,
		blockData?: Block,
		biome?: string
	): Promise<{
		geometry: THREE.BufferGeometry;
		material: THREE.Material;
		materialKey: string;
		isLiquid?: boolean;
		isWater?: boolean;
		isLava?: boolean;
	}> {
		let geometry: THREE.PlaneGeometry;
		let position: [number, number, number] = [0, 0, 0];

		// Create geometry based on direction
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

		// Apply position to geometry
		geometry.translate(...position);

		// Map UV coordinates
		this.mapUVCoordinates(geometry, direction, faceData);

		// Get texture and material
		let texturePath = this.assetLoader.resolveTexture(faceData.texture, model);
		const isWater = this.isWaterBlock(blockData);
		const isLava = this.isLavaBlock(blockData);
		const isLiquid = isWater || isLava;

		if (isWater) {
			texturePath =
				direction === "up" || direction === "down"
					? "block/water_still"
					: "block/water_flow";
		} else if (isLava) {
			texturePath =
				direction === "up" || direction === "down"
					? "block/lava_still"
					: "block/lava_flow";
		}

		// Create material
		const material = await this.createFaceMaterial(
			texturePath,
			direction,
			faceData,
			model,
			blockData,
			biome,
			size,
			isLiquid,
			isWater,
			isLava
		);

		// Create a unique key for this material combination
		const materialKey = this.getMaterialKey(
			texturePath,
			direction,
			faceData,
			blockData,
			biome
		);

		return {
			geometry: geometry,
			material,
			materialKey,
			isLiquid,
			isWater,
			isLava,
		};
	}

	private applyElementTransforms(
		geometry: THREE.BufferGeometry,
		element: BlockModelElement,
		center: number[],
		size: number[],
		direction: string
	): void {
		if (element.rotation) {
			const rotationOriginJSON = element.rotation.origin || [8, 8, 8];
			const rotationOrigin = rotationOriginJSON.map((c) => c / 16);

			// Translate to center first
			geometry.translate(center[0], center[1], center[2]);

			// Then translate to rotation origin
			geometry.translate(
				-rotationOrigin[0],
				-rotationOrigin[1],
				-rotationOrigin[2]
			);

			// Apply rotation
			const angle = (element.rotation.angle * Math.PI) / 180;
			switch (element.rotation.axis) {
				case "x":
					geometry.rotateX(angle);
					break;
				case "y":
					geometry.rotateY(angle);
					break;
				case "z":
					geometry.rotateZ(angle);
					break;
			}

			// Translate back from rotation origin
			geometry.translate(
				rotationOrigin[0],
				rotationOrigin[1],
				rotationOrigin[2]
			);
		} else {
			// Just translate to center
			geometry.translate(center[0], center[1], center[2]);
		}
	}

	private getMaterialKey(
		texturePath: string,
		direction: string,
		faceData: any,
		blockData?: Block,
		biome?: string
	): string {
		const tintIndex =
			faceData.tintindex !== undefined ? faceData.tintindex : "none";
		const blockId = blockData
			? `${blockData.namespace}:${blockData.name}`
			: "none";
		const props = blockData?.properties
			? JSON.stringify(blockData.properties)
			: "none";

		return `${texturePath}_${direction}_${tintIndex}_${blockId}_${props}_${biome}`;
	}

	private async createFaceMaterial(
		texturePath: string,
		direction: string,
		faceData: any,
		model: BlockModel,
		blockData?: Block,
		biome?: string,
		size?: number[],
		isLiquid?: boolean,
		isWater?: boolean,
		isLava?: boolean
	): Promise<THREE.Material> {
		try {
			const isTransparentTexture =
				texturePath.includes("glass") || texturePath.includes("leaves");
			const effectiveTransparent = isTransparentTexture || isWater;

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

			const material = await this.assetLoader.getMaterial(
				texturePath,
				materialOptions
			);
			const clonedMaterial = material.clone();

			// Set material properties
			const isThinElementHeuristic =
				size && (size[0] < 0.01 || size[1] < 0.01 || size[2] < 0.01);
			const isKnownThinTexture =
				texturePath.includes("tendril") ||
				texturePath.includes("pane") ||
				texturePath.includes("fence") ||
				texturePath.includes("rail") ||
				texturePath.includes("door") ||
				texturePath.includes("trapdoor") ||
				texturePath.includes("ladder");

			if (isThinElementHeuristic || isKnownThinTexture) {
				clonedMaterial.side = THREE.DoubleSide;
			} else {
				clonedMaterial.side = THREE.FrontSide;
			}

			if (effectiveTransparent) {
				clonedMaterial.transparent = true;
			}

			if (isWater) {
				clonedMaterial.opacity =
					materialOptions.opacity !== undefined ? materialOptions.opacity : 0.8;
				clonedMaterial.userData.isWater = true;
				clonedMaterial.userData.faceDirection = direction;
				if (
					direction === "up" &&
					clonedMaterial instanceof THREE.MeshStandardMaterial
				) {
					clonedMaterial.roughness = 0.1;
					clonedMaterial.metalness = 0.3;
				}
			}

			if (isLava && clonedMaterial instanceof THREE.MeshStandardMaterial) {
				clonedMaterial.emissive = new THREE.Color(0xff2200);
				clonedMaterial.emissiveIntensity = 0.5;
				clonedMaterial.roughness = 0.7;
				clonedMaterial.userData.isLava = true;
				clonedMaterial.userData.faceDirection = direction;
			}

			return clonedMaterial;
		} catch (error) {
			console.warn(`Failed to create material for ${texturePath}:`, error);
			return new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
				side: THREE.DoubleSide,
			});
		}
	}

	private mergeGeometries(
		geometries: THREE.BufferGeometry[]
	): THREE.BufferGeometry {
		// Filter out empty geometries
		const validGeometries = geometries.filter(
			(geo) => geo.attributes.position && geo.attributes.position.count > 0
		);

		if (validGeometries.length === 0) {
			return new THREE.BufferGeometry();
		}

		if (validGeometries.length === 1) {
			return validGeometries[0];
		}

		// Use THREE.js BufferGeometryUtils if available, otherwise manual merge
		if ((THREE as any).BufferGeometryUtils) {
			return (THREE as any).BufferGeometryUtils.mergeGeometries(
				validGeometries
			);
		} else {
			// Manual merge (simplified - you might want to import BufferGeometryUtils)
			return this.manualMergeGeometries(validGeometries);
		}
	}

	private manualMergeGeometries(
		geometries: THREE.BufferGeometry[]
	): THREE.BufferGeometry {
		const merged = new THREE.BufferGeometry();

		let totalVertices = 0;
		let totalIndices = 0;

		// Calculate totals
		for (const geometry of geometries) {
			totalVertices += geometry.attributes.position.count;
			if (geometry.index) {
				totalIndices += geometry.index.count;
			} else {
				totalIndices += geometry.attributes.position.count;
			}
		}

		// Create merged arrays
		const positions = new Float32Array(totalVertices * 3);
		const normals = new Float32Array(totalVertices * 3);
		const uvs = new Float32Array(totalVertices * 2);
		const indices = new Uint32Array(totalIndices);

		let vertexOffset = 0;
		let indexOffset = 0;
		let currentVertexCount = 0;

		for (const geometry of geometries) {
			const positionAttr = geometry.attributes.position;
			const normalAttr = geometry.attributes.normal;
			const uvAttr = geometry.attributes.uv;

			// Copy positions
			positions.set(positionAttr.array as Float32Array, vertexOffset * 3);

			// Copy normals if they exist
			if (normalAttr) {
				normals.set(normalAttr.array as Float32Array, vertexOffset * 3);
			}

			// Copy UVs if they exist
			if (uvAttr) {
				uvs.set(uvAttr.array as Float32Array, vertexOffset * 2);
			}

			// Copy indices
			if (geometry.index) {
				const geometryIndices = geometry.index.array;
				for (let i = 0; i < geometryIndices.length; i++) {
					indices[indexOffset + i] = geometryIndices[i] + currentVertexCount;
				}
				indexOffset += geometryIndices.length;
			} else {
				// Generate indices for non-indexed geometry
				for (let i = 0; i < positionAttr.count; i++) {
					indices[indexOffset + i] = currentVertexCount + i;
				}
				indexOffset += positionAttr.count;
			}

			currentVertexCount += positionAttr.count;
			vertexOffset += positionAttr.count;
		}

		// Set attributes
		merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
		merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
		merged.setIndex(new THREE.BufferAttribute(indices, 1));

		// Compute normals if they weren't provided
		merged.computeVertexNormals();

		return merged;
	}

	// Keep existing helper methods
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
		const baseRotation =
			FACING_UV_ROT[direction as keyof typeof FACING_UV_ROT] ?? 0;
		const rot = ((faceData.rotation ?? 0) + baseRotation) % 360;

		if (rot !== 0) {
			this.applyUVRotation(uvCoords, rot);
		}
		uvAttribute.array.set(uvCoords);
		uvAttribute.needsUpdate = true;
	}

	private getBaseUVs(
		u1: number,
		v1: number,
		u2: number,
		v2: number
	): Float32Array {
		return new Float32Array([u1, 1 - v2, u2, 1 - v2, u1, 1 - v1, u2, 1 - v1]);
	}

	private applyUVRotation(uvCoords: Float32Array, rotation: number): void {
		const temp = new Float32Array(uvCoords);
		switch (rotation) {
			case 0:
				break;
			case 90:
				uvCoords[0] = temp[4];
				uvCoords[1] = temp[5];
				uvCoords[2] = temp[0];
				uvCoords[3] = temp[1];
				uvCoords[4] = temp[6];
				uvCoords[5] = temp[7];
				uvCoords[6] = temp[2];
				uvCoords[7] = temp[3];
				break;
			case 180:
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
