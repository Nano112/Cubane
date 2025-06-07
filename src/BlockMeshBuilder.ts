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
		const blockData = block || transform.block;

		// Check if this block is waterlogged
		if (blockData?.properties?.waterlogged === "true") {
			return this.createWaterloggedBlockMesh(model, transform, block, biome);
		}

		// Otherwise, create normal block
		return this.createBlockMeshNoWater(model, transform, block, biome);
	}

	public async createBlockMeshNoWater(
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
		// console.log("Creating block mesh for model:", model); // Keep for debugging if needed
		const blockData = block || transform.block;
		const isLiquidBlockType = blockData && this.isLiquidBlock(blockData);
		const isWaterBlockType = blockData && this.isWaterBlock(blockData);

		const geometryGroups = new Map<string, GeometryGroup>();

		for (const element of model.elements) {
			try {
				const elementGeometries = await this.createElementGeometries(
					element,
					model,
					blockData,
					biome
				);

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
							geometry: new THREE.BufferGeometry(), // Start with an empty geometry
							material: material,
							isLiquid,
							isWater,
							isLava,
						});
					}

					const group = geometryGroups.get(materialKey)!;
					// Ensure group.geometry is valid before merging
					if (
						group.geometry.attributes.position &&
						group.geometry.attributes.position.count > 0
					) {
						group.geometry = this.mergeGeometries([group.geometry, geometry]);
					} else {
						group.geometry = geometry; // First geometry for this material
					}
				}
			} catch (error) {
				console.error(
					"Error creating element geometries for element:",
					element,
					error
				);
			}
		}

		const finalGroup = new THREE.Group();

		for (const [
			,
			/* materialKey */ // Not directly used after grouping
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
					mesh.renderOrder = isWater ? 1 : 0; // Water renders after opaque
				}

				finalGroup.add(mesh);
			}
		}

		if (finalGroup.children.length === 0) {
			// This case should ideally return a centered placeholder too if transforms are applied
			const placeholder = this.createPlaceholderCube();
			if (transform.y !== undefined) {
				placeholder.rotateY((transform.y * Math.PI) / 180);
			}
			if (transform.x !== undefined) {
				placeholder.rotateX((transform.x * Math.PI) / 180);
			}
			return placeholder;
		}

		// Add metadata
		if (blockData) {
			(finalGroup as any).blockData = blockData;
		}
		(finalGroup as any).biome = biome;
		if (isLiquidBlockType) {
			// Use the block-level liquid status
			(finalGroup as any).isLiquid = true;
			(finalGroup as any).isWater = isWaterBlockType;
			(finalGroup as any).isLava = isLiquidBlockType && !isWaterBlockType;
		}

		return finalGroup;
	}

	// Add this method to your BlockMeshBuilder class
	public async createWaterloggedBlockMesh(
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
		const blockData = block || transform.block;

		// Create the main block mesh
		const mainBlockMesh = await this.createBlockMeshNoWater(
			model,
			transform,
			block,
			biome
		);

		// Check if this block is waterlogged
		const isWaterlogged = blockData?.properties?.waterlogged === "true";

		if (!isWaterlogged) {
			return mainBlockMesh;
		}

		// Create a container group for both the block and water
		const waterloggedGroup = new THREE.Group();

		// Add the main block
		waterloggedGroup.add(mainBlockMesh);

		// Create water block - use a simple cube model for water
		const waterModel: BlockModel = {
			elements: [
				{
					from: [0, 0, 0],
					to: [16, 16, 16],
					faces: {
						down: { texture: "block/water_still" },
						up: { texture: "block/water_still" },
						north: { texture: "block/water_flow" },
						south: { texture: "block/water_flow" },
						west: { texture: "block/water_flow" },
						east: { texture: "block/water_flow" },
					},
				},
			],
		};

		// Create water block data
		const waterBlock: Block = {
			namespace: "minecraft",
			name: "water",
			properties: {},
		};

		// Create the water mesh
		const waterMesh = await this.createBlockMesh(
			waterModel,
			transform,
			waterBlock,
			biome
		);

		// Set water-specific properties
		if (waterMesh instanceof THREE.Group) {
			waterMesh.children.forEach((child) => {
				if (child instanceof THREE.Mesh) {
					// Ensure water renders after solid blocks
					child.renderOrder = 1;
					// Make sure water material is properly transparent
					if (child.material instanceof THREE.Material) {
						child.material.transparent = true;
						child.material.depthWrite = false;
					}
				}
			});
		}

		// Add water to the group
		waterloggedGroup.add(waterMesh);

		// Add metadata to indicate this is waterlogged
		(waterloggedGroup as any).isWaterlogged = true;
		(waterloggedGroup as any).blockData = blockData;
		(waterloggedGroup as any).biome = biome;

		return waterloggedGroup;
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

		// Map coordinates to [-0.5, 0.5] space (block centered at origin)
		const from = fromJSON.map((c) => c / 16 - 0.5);
		const to = toJSON.map((c) => c / 16 - 0.5);

		let size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
		// Ensure size is not negative (can happen with "incorrect" models, though rare)
		size = size.map((s) => Math.max(0, s));

		// Center of the element in the new [-0.5, 0.5] block-centered space
		let center = [
			from[0] + size[0] / 2,
			from[1] + size[1] / 2,
			from[2] + size[2] / 2,
		];

		// Water level adjustment
		if (blockData && this.isWaterBlock(blockData) && toJSON[1] === 16) {
			// toJSON[1] is original 0-16 value
			const adjustedToY_mc = 14; // Minecraft units for water level top
			to[1] = adjustedToY_mc / 16 - 0.5; // Convert to centered space
			// Recalculate Y size and center for this element
			size[1] = to[1] - from[1];
			size[1] = Math.max(0, size[1]); // ensure positive size
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

				// Cullface check could be added here if needed:
				// if (faceData.cullface && shouldCull(faceData.cullface, neighborBlocks)) continue;

				const { geometry, material, materialKey, isLiquid, isWater, isLava } =
					await this.createFaceGeometry(
						direction,
						size, // element's size
						faceData,
						model,
						blockData,
						biome
					);

				// Apply element's rotation and positioning
				this.applyElementTransforms(geometry, element, center); // Pass element's center

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
		elementSize: number[], // Renamed from 'size' to avoid confusion with local var 'size' if any
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
		// Position of the face relative to the element's center ([0,0,0] in element local space)
		let facePositionOffset: [number, number, number] = [0, 0, 0];

		switch (direction) {
			case "down":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[2]);
				geometry.rotateX(Math.PI / 2);
				facePositionOffset = [0, -elementSize[1] / 2, 0];
				break;
			case "up":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[2]);
				geometry.rotateX(-Math.PI / 2);
				facePositionOffset = [0, elementSize[1] / 2, 0];
				break;
			case "north":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[1]);
				geometry.rotateY(Math.PI); // Face towards -Z
				facePositionOffset = [0, 0, -elementSize[2] / 2];
				break;
			case "south":
				geometry = new THREE.PlaneGeometry(elementSize[0], elementSize[1]);
				// No rotation, face is towards +Z by default for PlaneGeometry if X,Y
				facePositionOffset = [0, 0, elementSize[2] / 2];
				break;
			case "west":
				geometry = new THREE.PlaneGeometry(elementSize[2], elementSize[1]);
				geometry.rotateY(-Math.PI / 2); // Face towards -X
				facePositionOffset = [-elementSize[0] / 2, 0, 0];
				break;
			case "east":
				geometry = new THREE.PlaneGeometry(elementSize[2], elementSize[1]);
				geometry.rotateY(Math.PI / 2); // Face towards +X
				facePositionOffset = [elementSize[0] / 2, 0, 0];
				break;
			default:
				throw new Error(`Unknown face direction: ${direction}`);
		}

		// Translate face to its position relative to the element's center
		geometry.translate(...facePositionOffset);

		this.mapUVCoordinates(geometry, direction, faceData);

		let texturePath = this.assetLoader.resolveTexture(faceData.texture, model);
		const isWater = this.isWaterBlock(blockData); // Check block type, not face
		const isLava = this.isLavaBlock(blockData); // Check block type, not face
		const isLiquid = isWater || isLava;

		if (isWater) {
			texturePath =
				direction === "up" // Minecraft water uses still for top/bottom, flow for sides
					? "block/water_still"
					: "block/water_flow";
		} else if (isLava) {
			texturePath = direction === "up" ? "block/lava_still" : "block/lava_flow";
		}

		const material = await this.createFaceMaterial(
			texturePath,
			direction,
			faceData,
			model,
			blockData,
			biome,
			elementSize, // Pass element size for thin heuristics
			isLiquid, // Pass liquid status derived from block type
			isWater,
			isLava
		);

		const materialKey = this.getMaterialKey(
			texturePath,
			direction,
			faceData,
			blockData,
			biome
		);

		return {
			geometry: geometry, // This geometry is now a face, positioned relative to its element's center
			material,
			materialKey,
			isLiquid, // These reflect the block type, not just this face/element
			isWater,
			isLava,
		};
	}

	private applyElementTransforms(
		geometry: THREE.BufferGeometry, // Geometry of a single face, relative to element center
		element: BlockModelElement,
		elementCenterInBlock: number[] // Element's center in block's [-0.5, 0.5] space
	): void {
		// The geometry is already positioned as a face of an element centered at (0,0,0).
		// First, if there's rotation, apply it. The rotation origin is specified in block coordinates.
		if (element.rotation) {
			const rotationOriginJSON = element.rotation.origin || [8, 8, 8]; // Default MC pivot is block center
			// Convert MC rotation origin to current block-centered space [-0.5, 0.5]
			const rotationOriginInBlock = rotationOriginJSON.map((c) => c / 16 - 0.5);

			// The pivot for rotation is (rotationOriginInBlock - elementCenterInBlock)
			// in the element's local coordinate system (where element's center is 0,0,0).
			const pivotLocalX = rotationOriginInBlock[0] - elementCenterInBlock[0];
			const pivotLocalY = rotationOriginInBlock[1] - elementCenterInBlock[1];
			const pivotLocalZ = rotationOriginInBlock[2] - elementCenterInBlock[2];

			// Translate geometry so the local pivot is at origin
			geometry.translate(-pivotLocalX, -pivotLocalY, -pivotLocalZ);

			// Apply rescaling if specified
			if (element.rotation.rescale) {
				const angle = (element.rotation.angle * Math.PI) / 180;
				const rescaleFactor = 1 / Math.cos(angle);

				// Apply rescaling to the geometry vertices
				const positionAttribute = geometry.attributes
					.position as THREE.BufferAttribute;
				const positions = positionAttribute.array as Float32Array;

				// Rescale coordinates perpendicular to the rotation axis
				for (let i = 0; i < positions.length; i += 3) {
					const x = positions[i];
					const y = positions[i + 1];
					const z = positions[i + 2];

					switch (element.rotation.axis) {
						case "x":
							// Rescale Y and Z coordinates
							positions[i + 1] = y * rescaleFactor;
							positions[i + 2] = z * rescaleFactor;
							break;
						case "y":
							// Rescale X and Z coordinates
							positions[i] = x * rescaleFactor;
							positions[i + 2] = z * rescaleFactor;
							break;
						case "z":
							// Rescale X and Y coordinates
							positions[i] = x * rescaleFactor;
							positions[i + 1] = y * rescaleFactor;
							break;
					}
				}

				positionAttribute.needsUpdate = true;
			}

			// Apply rotation
			const angle = (element.rotation.angle * Math.PI) / 180;
			// Note: Minecraft's rotation can be -45, -22.5, 0, 22.5, 45.

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

			// Translate back from local pivot
			geometry.translate(pivotLocalX, pivotLocalY, pivotLocalZ);
		}

		// Finally, translate the (now possibly rotated and rescaled) element face
		// by the element's center in block space to position it correctly within the block.
		geometry.translate(
			elementCenterInBlock[0],
			elementCenterInBlock[1],
			elementCenterInBlock[2]
		);
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
		const cullFace = faceData.cullface || "none";
		const blockId = blockData
			? `${blockData.namespace}:${blockData.name}`
			: "none";
		const props = blockData?.properties
			? JSON.stringify(blockData.properties) // Consider sorted stringify for consistency
			: "none";

		return `${texturePath}_dir:${direction}_tint:${tintIndex}_cull:${cullFace}_block:${blockId}_props:${props}_biome:${biome}`;
	}

	private async createFaceMaterial(
		texturePath: string,
		direction: string,
		faceData: any,
		model: BlockModel,
		blockData?: Block,
		biome?: string,
		elementSize?: number[],
		isLiquid?: boolean,
		isWater?: boolean,
		isLava?: boolean
	): Promise<THREE.Material> {
		try {
			let tint: THREE.Color | undefined = undefined;
			if (blockData && faceData.tintindex !== undefined) {
				const blockIdForTint = `${blockData.namespace}:${blockData.name}`;
				tint = this.assetLoader.getTint(
					blockIdForTint,
					blockData.properties,
					biome
				);
			}
			if (isWater && !tint) {
				tint = this.assetLoader.getTint("minecraft:water", {}, "default");
			}

			const materialOptions: any = {
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

			const isThinElementHeuristic =
				elementSize &&
				(elementSize[0] < 0.01 ||
					elementSize[1] < 0.01 ||
					elementSize[2] < 0.01);
			const knownThinTexture =
				texturePath.includes("pane") ||
				texturePath.includes("fence") ||
				texturePath.includes("rail") ||
				texturePath.includes("ladder") ||
				texturePath.includes("chain") ||
				texturePath.includes("bars");

			const isRedstoneTorchElement =
				texturePath.includes("redstone_torch") || texturePath.includes("lit");

			if (
				!isRedstoneTorchElement &&
				(isThinElementHeuristic ||
					knownThinTexture ||
					(faceData.cullface === undefined && !isLiquid))
			) {
				clonedMaterial.side = THREE.DoubleSide;
			} else {
				clonedMaterial.side = THREE.FrontSide;
			}

			clonedMaterial.transparent = material.transparent;
			clonedMaterial.alphaTest = material.alphaTest;
			clonedMaterial.depthWrite = material.depthWrite;
			clonedMaterial.opacity = material.opacity;

			clonedMaterial.userData = { ...material.userData };

			console.log(
				`Material for ${texturePath}: side=${
					clonedMaterial.side === THREE.DoubleSide ? "DoubleSide" : "FrontSide"
				}, alphaTest=${clonedMaterial.alphaTest}, opacity=${
					clonedMaterial.opacity
				}`
			);

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
		const validGeometries = geometries.filter(
			(geo) =>
				geo.attributes.position &&
				geo.attributes.position.count > 0 &&
				geo.index &&
				geo.index.count > 0
		);

		if (validGeometries.length === 0) {
			return new THREE.BufferGeometry();
		}
		if (validGeometries.length === 1) {
			return validGeometries[0].clone(); 
		}

		return this.manualMergeGeometries(validGeometries); 
	}

	private manualMergeGeometries(
		geometries: THREE.BufferGeometry[]
	): THREE.BufferGeometry {
		const merged = new THREE.BufferGeometry();
		const attributesToMerge = ["position", "normal", "uv"];
		const mergedAttributes: {
			[name: string]: { array: number[]; itemSize: number };
		} = {};

		let totalVertices = 0;
		let totalIndices = 0;
		let hasNormals = true;
		let hasUVs = true;

		for (const geometry of geometries) {
			totalVertices += geometry.attributes.position.count;
			if (geometry.index) {
				totalIndices += geometry.index.count;
			} else {
				totalIndices += geometry.attributes.position.count; // Non-indexed
			}
			if (!geometry.attributes.normal) hasNormals = false;
			if (!geometry.attributes.uv) hasUVs = false;
		}

		for (const attrName of attributesToMerge) {
			if (attrName === "normal" && !hasNormals) continue;
			if (attrName === "uv" && !hasUVs) continue;

			const firstGeoWithAttr = geometries.find((g) => g.attributes[attrName]);
			if (!firstGeoWithAttr) continue; // Should not happen for position

			mergedAttributes[attrName] = {
				array: [],
				itemSize: firstGeoWithAttr.attributes[attrName].itemSize,
			};
		}
		const indices: number[] = [];
		let vertexOffset = 0;

		for (const geometry of geometries) {
			for (const attrName in mergedAttributes) {
				const sourceAttr = geometry.attributes[attrName];
				if (sourceAttr) {
					mergedAttributes[attrName].array.push(
						...Array.from(sourceAttr.array as Float32Array)
					);
				} else if (attrName === "normal" || attrName === "uv") {
					// Fill with zeros if an attribute is missing for this geometry
					const numVertices = geometry.attributes.position.count;
					const itemSize = mergedAttributes[attrName].itemSize;
					mergedAttributes[attrName].array.push(
						...new Array(numVertices * itemSize).fill(0)
					);
				}
			}

			if (geometry.index) {
				const geometryIndices = Array.from(geometry.index.array);
				for (const index of geometryIndices) {
					indices.push(index + vertexOffset);
				}
			} else {
				// Non-indexed geometry
				const numVertices = geometry.attributes.position.count;
				for (let i = 0; i < numVertices; i++) {
					indices.push(vertexOffset + i);
				}
			}
			vertexOffset += geometry.attributes.position.count;
		}

		for (const attrName in mergedAttributes) {
			const { array, itemSize } = mergedAttributes[attrName];
			merged.setAttribute(
				attrName,
				new THREE.Float32BufferAttribute(array, itemSize)
			);
		}
		merged.setIndex(indices);

		if (!hasNormals && merged.attributes.position) {
			merged.computeVertexNormals();
		}
		return merged;
	}

	private isLiquidBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		const blockId = `${blockData.namespace}:${blockData.name}`;
		return blockId === "minecraft:water" || blockId === "minecraft:lava";
	}

	private isWaterBlock(blockData?: Block): boolean {
		if (!blockData) return false;

		return `${blockData.namespace}:${blockData.name}` === "minecraft:water";
	}

	private isLavaBlock(blockData?: Block): boolean {
		if (!blockData) return false;
		return `${blockData.namespace}:${blockData.name}` === "minecraft:lava";
	}

	private mapUVCoordinates(
		geometry: THREE.PlaneGeometry,
		direction: string,
		faceData: any
	): void {
		if (!faceData.uv) {
			// Default UVs [0,0,16,16] effectively
			faceData.uv = [0, 0, 16, 16];
		}
		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;
		// Minecraft UVs are pixel coordinates on a 16x16 texture atlas sheet (typically)
		// Or, if texture is larger, UVs are still 0-16 range on that texture.
		const [uMinPx, vMinPx, uMaxPx, vMaxPx] = faceData.uv;

		// Normalize UVs to 0-1 range based on a 16-unit texture dimension
		// This assumes textures are resolved to individual image files or a well-managed atlas
		// where these 0-16 coords map to a 0-1 range on THAT specific texture.
		// If AssetLoader returns textures from a larger atlas, UV remapping might be needed there.
		// For now, assume 1/16 normalization is correct for individual textures.
		const u1 = uMinPx / 16;
		const v1 = vMinPx / 16;
		const u2 = uMaxPx / 16;
		const v2 = vMaxPx / 16;

		// PlaneGeometry UVs: (0,1) TL, (1,1) TR, (0,0) BL, (1,0) BR
		// Desired mapping from texture (origin top-left):
		// TL vertex -> (u1, v1) tex
		// TR vertex -> (u2, v1) tex
		// BL vertex -> (u1, v2) tex
		// BR vertex -> (u2, v2) tex
		// THREE.js UV y-coord is often inverted (0 at bottom), so use 1-v for texture v.
		const uvCoords = new Float32Array([
			u1,
			1 - v1, // TL
			u2,
			1 - v1, // TR
			u1,
			1 - v2, // BL
			u2,
			1 - v2, // BR
		]);

		// UV Rotation (optional, from model spec)
		// The FACING_UV_ROT seems to be a custom addition; vanilla MC handles this via model variants or baked rotations.
		// If uvlock is true, face rotation doesn't affect UVs. If false, it does. This is complex.
		// For now, only consider explicit `faceData.rotation`.
		const rotDeg = faceData.rotation || 0; // Explicit UV rotation in degrees (0, 90, 180, 270)

		if (rotDeg !== 0) {
			this.applyUVRotation(uvCoords, rotDeg);
		}
		uvAttribute.array.set(uvCoords);
		uvAttribute.needsUpdate = true;
	}

	// This function assumes uvCoords are [TL, TR, BL, BR]
	private applyUVRotation(uvCoords: Float32Array, rotation: number): void {
		const uvs = [
			{ u: uvCoords[0], v: uvCoords[1] }, // TL
			{ u: uvCoords[2], v: uvCoords[3] }, // TR
			{ u: uvCoords[4], v: uvCoords[5] }, // BL
			{ u: uvCoords[6], v: uvCoords[7] }, // BR
		];

		let rotatedUVs;

		switch (rotation) {
			case 0:
				return; // No change
			case 90: // TL->BL, TR->TL, BL->BR, BR->TR
				rotatedUVs = [uvs[2], uvs[0], uvs[3], uvs[1]]; // BL, TL, BR, TR (mapping to new TL, TR, BL, BR positions)
				break;
			case 180: // TL->BR, TR->BL, BL->TR, BR->TL
				rotatedUVs = [uvs[3], uvs[2], uvs[1], uvs[0]]; // BR, BL, TR, TL
				break;
			case 270: // TL->TR, TR->BR, BL->TL, BR->BL
				rotatedUVs = [uvs[1], uvs[3], uvs[0], uvs[2]]; // TR, BR, TL, BL
				break;
			default:
				console.warn(`Unsupported UV rotation: ${rotation}`);
				return;
		}

		uvCoords[0] = rotatedUVs[0].u;
		uvCoords[1] = rotatedUVs[0].v;
		uvCoords[2] = rotatedUVs[1].u;
		uvCoords[3] = rotatedUVs[1].v;
		uvCoords[4] = rotatedUVs[2].u;
		uvCoords[5] = rotatedUVs[2].v;
		uvCoords[6] = rotatedUVs[3].u;
		uvCoords[7] = rotatedUVs[3].v;
	}

	private createPlaceholderCube(): THREE.Mesh {
		// BoxGeometry is 1x1x1 centered at origin, which is consistent
		// with the new centered coordinate system for blocks.
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0x800080, // Purple, less jarring than magenta
				wireframe: true,
				side: THREE.FrontSide, // Placeholder is solid
			})
		);
	}
}
