import * as THREE from "three";
// No AssetLoader import needed
import { EntityModelLoader } from "./EntityModelLoader";

// --- TypeScript interfaces for the model JSON structure ---
// These should align with your ./types.ts or be defined here.
// Based on your JSON example and common Minecraft model formats.

interface MinecraftEntityModel {
	textureSize: [number, number];
	models: MinecraftModelPart[]; // Array of root parts
}

interface MinecraftModelPart {
	part: string;
	id: string;
	invertAxis?: "xy" | "yz" | "xz" | string;
	translate?: [number, number, number];
	rotate?: [number, number, number];
	mirror?: boolean;
	boxes?: MinecraftModelBox[];
	submodels?: MinecraftModelPart[];
}

interface MinecraftModelBox {
	coordinates: [number, number, number, number, number, number];
	textureOffset: [number, number];
	sizeAdd?: number;
	uvNorth?: [number, number, number, number];
	uvEast?: [number, number, number, number];
	uvSouth?: [number, number, number, number];
	uvWest?: [number, number, number, number];
	uvUp?: [number, number, number, number];
	uvDown?: [number, number, number, number];
}

// --- EntityRenderer Class Implementation ---

export class EntityRenderer {
	private entityModelLoader: EntityModelLoader;
	private textureLoader: THREE.TextureLoader; // For loading textures from Base64
	private debug: boolean = false;
	private readonly mcScale: number = 1 / 16;

	constructor(entityModelLoader: EntityModelLoader, debug: boolean = false) {
		this.entityModelLoader = entityModelLoader;
		this.textureLoader = new THREE.TextureLoader();
		this.debug = debug;
	}

	/**
	 * Creates a THREE.Object3D mesh for the specified entity.
	 * @param entityName The name of the entity to create a mesh for.
	 * @returns A Promise that resolves to a THREE.Object3D or null if an error occurs.
	 */
	public async createEntityMesh(
		entityName: string
	): Promise<THREE.Object3D | null> {
		const entityData = this.entityModelLoader.getEntityData(entityName);

		if (!entityData.model) {
			if (this.debug)
				console.warn(
					`[EntityRenderer] No model data found for entity: ${entityName}`
				);
			return null;
		}
		const modelJson = entityData.model as unknown as MinecraftEntityModel;

		if (!entityData.texture) {
			if (this.debug)
				console.warn(
					`[EntityRenderer] No texture data (Base64) found for entity: ${entityName}`
				);
			return null; // Or use a default texture
		}

		const textureBase64 = entityData.texture; // This is expected to be the raw Base64 string

		let texture: THREE.Texture;
		try {
			// Construct the full Data URI for the TextureLoader
			// Assume PNG if not specified, which is common for Minecraft.
			// If your Base64 strings are already full Data URIs, this logic can be simpler.
			const dataUri = textureBase64.startsWith("data:image/")
				? textureBase64
				: `data:image/png;base64,${textureBase64}`;

			if (this.debug)
				console.log(
					`[EntityRenderer] Attempting to load texture for "${entityName}" from Data URI: ${dataUri.substring(
						0,
						70
					)}...`
				);

			texture = await new Promise<THREE.Texture>((resolve, reject) => {
				this.textureLoader.load(
					dataUri,
					(loadedTexture) => {
						if (this.debug)
							console.log(
								`[EntityRenderer] Texture loaded successfully for "${entityName}"`
							);
						loadedTexture.magFilter = THREE.NearestFilter;
						loadedTexture.minFilter = THREE.NearestMipmapNearestFilter; // Or THREE.NearestFilter
						loadedTexture.flipY = false; // IMPORTANT for Minecraft textures
						// loadedTexture.needsUpdate = true; // Usually not needed if props set before first render pass
						resolve(loadedTexture);
					},
					undefined, // onProgress
					(errorEvent) => {
						const errorMessage =
							(errorEvent.target as HTMLImageElement)?.src || dataUri;
						console.error(
							`[EntityRenderer] Failed to load texture from Data URI for "${entityName}": ${errorMessage.substring(
								0,
								100
							)}...`,
							errorEvent
						);
						reject(new Error(`Failed to load texture for ${entityName}`));
					}
				);
			});
		} catch (error) {
			// Error already logged by the promise reject
			return null;
		}

		const entityGroup = new THREE.Object3D();
		entityGroup.name = entityName;

		if (modelJson.models) {
			for (const partJson of modelJson.models) {
				const partGroup = this.createPartMeshRecursive(
					partJson,
					modelJson.textureSize,
					texture
				);
				entityGroup.add(partGroup);
			}
		} else {
			if (this.debug)
				console.warn(
					`[EntityRenderer] Model for "${entityName}" has no root parts defined in "models" array.`
				);
		}

		return entityGroup;
	}

	/**
	 * Recursively creates a THREE.Group for a model part and its submodels.
	 */
	private createPartMeshRecursive(
		partJson: MinecraftModelPart,
		modelTextureSize: [number, number],
		texture: THREE.Texture
	): THREE.Group {
		const partGroup = new THREE.Group();
		partGroup.name = partJson.id || partJson.part || "unnamed_part";

		if (partJson.translate) {
			partGroup.position.set(
				partJson.translate[0] * this.mcScale,
				partJson.translate[1] * this.mcScale,
				partJson.translate[2] * this.mcScale
			);
		}

		if (partJson.rotate) {
			partGroup.rotation.set(
				THREE.MathUtils.degToRad(partJson.rotate[0]),
				THREE.MathUtils.degToRad(partJson.rotate[1]),
				THREE.MathUtils.degToRad(partJson.rotate[2]),
				"YXZ"
			);
		}

		if (partJson.mirror) {
			partGroup.scale.x = -1;
		}

		if (partJson.boxes) {
			for (const boxJson of partJson.boxes) {
				const boxMesh = this.createBoxMesh(
					boxJson,
					modelTextureSize,
					texture,
					partJson
				);
				if (boxMesh) {
					partGroup.add(boxMesh);
				}
			}
		}

		if (partJson.submodels) {
			for (const subPartJson of partJson.submodels) {
				const subPartGroup = this.createPartMeshRecursive(
					subPartJson,
					modelTextureSize,
					texture
				);
				partGroup.add(subPartGroup);
			}
		}
		return partGroup;
	}

	/**
	 * Creates a THREE.Mesh for a single box (cuboid) of a model part.
	 */
	private createBoxMesh(
		boxJson: MinecraftModelBox,
		modelTextureSize: [number, number],
		texture: THREE.Texture,
		parentPartJson: MinecraftModelPart
	): THREE.Mesh | null {
		const [texU_offset, texV_offset] = boxJson.textureOffset;
		const [textureWidth, textureHeight] = modelTextureSize;

		let [originX, originY, originZ, sizeX, sizeY, sizeZ] = boxJson.coordinates;

		const sizeAdd = boxJson.sizeAdd || 0;
		if (sizeAdd !== 0) {
			originX -= sizeAdd;
			originY -= sizeAdd;
			originZ -= sizeAdd;
			sizeX += sizeAdd * 2;
			sizeY += sizeAdd * 2;
			sizeZ += sizeAdd * 2;
		}

		const finalSizeX = sizeX * this.mcScale;
		const finalSizeY = sizeY * this.mcScale;
		const finalSizeZ = sizeZ * this.mcScale;

		if (finalSizeX <= 0 || finalSizeY <= 0 || finalSizeZ <= 0) {
			if (this.debug) {
				console.warn(
					`[EntityRenderer] Box for part "${parentPartJson.id}" has zero or negative scaled dimension. Skipping.`,
					`Original Dims: [${sizeX}, ${sizeY}, ${sizeZ}], Scaled Dims: [${finalSizeX}, ${finalSizeY}, ${finalSizeZ}]`
				);
			}
			return null;
		}

		const boxGeom = new THREE.BoxGeometry(finalSizeX, finalSizeY, finalSizeZ);
		const uvAttribute = boxGeom.getAttribute("uv") as THREE.BufferAttribute;

		const customFaceUVs: ([number, number, number, number] | undefined)[] = [
			boxJson.uvEast,
			boxJson.uvWest,
			boxJson.uvUp,
			boxJson.uvDown,
			boxJson.uvSouth,
			boxJson.uvNorth,
		];
		const hasCustomUVs = customFaceUVs.some((uv) => uv !== undefined);

		for (let i = 0; i < 6; i++) {
			let u: number, v: number, w: number, h: number;

			if (hasCustomUVs) {
				const customUV = customFaceUVs[i];
				if (customUV) {
					[u, v, w, h] = customUV;
				} else {
					[u, v, w, h] = [0, 0, 0, 0];
					if (this.debug) {
						console.warn(
							`[EntityRenderer] Missing custom UV for face index ${i} on box in part "${parentPartJson.id}". Using (0,0,0,0). Box:`,
							boxJson
						);
					}
				}
			} else {
				switch (i) {
					case 0:
						[u, v, w, h] = [
							texU_offset + sizeZ,
							texV_offset + sizeZ,
							sizeZ,
							sizeY,
						];
						break;
					case 1:
						[u, v, w, h] = [texU_offset, texV_offset + sizeZ, sizeZ, sizeY];
						break;
					case 2:
						[u, v, w, h] = [texU_offset + sizeZ, texV_offset, sizeX, sizeZ];
						break;
					case 3:
						[u, v, w, h] = [
							texU_offset + sizeZ + sizeX,
							texV_offset,
							sizeX,
							sizeZ,
						];
						break;
					case 4:
						[u, v, w, h] = [
							texU_offset + sizeZ + sizeX,
							texV_offset + sizeZ,
							sizeX,
							sizeY,
						];
						break;
					case 5:
						[u, v, w, h] = [
							texU_offset + sizeZ + sizeX + sizeX,
							texV_offset + sizeZ,
							sizeX,
							sizeY,
						];
						break;
					default:
						[u, v, w, h] = [0, 0, 0, 0];
						break;
				}
			}

			if (w === 0 || h === 0) {
				const uvIdx = i * 4;
				uvAttribute.setXY(uvIdx + 0, 0, 0);
				uvAttribute.setXY(uvIdx + 1, 0, 0);
				uvAttribute.setXY(uvIdx + 2, 0, 0);
				uvAttribute.setXY(uvIdx + 3, 0, 0);
				continue;
			}

			const u0 = u / textureWidth;
			const v0 = v / textureHeight;
			const u1 = (u + w) / textureWidth;
			const v1 = (v + h) / textureHeight;

			const uvIdx = i * 4;
			uvAttribute.setXY(uvIdx + 0, u1, v1);
			uvAttribute.setXY(uvIdx + 1, u0, v1);
			uvAttribute.setXY(uvIdx + 2, u1, v0);
			uvAttribute.setXY(uvIdx + 3, u0, v0);
		}
		uvAttribute.needsUpdate = true;

		const material = new THREE.MeshBasicMaterial({
			map: texture,
			alphaTest: 0.1,
			transparent: true,
			side: parentPartJson.mirror ? THREE.DoubleSide : THREE.FrontSide,
		});

		const boxMesh = new THREE.Mesh(boxGeom, material);
		const boxIndex = parentPartJson.boxes?.indexOf(boxJson) ?? "unknown";
		boxMesh.name = `${parentPartJson.id || "part"}_box${boxIndex}`;

		boxMesh.position.set(
			(originX + sizeX / 2) * this.mcScale,
			(originY + sizeY / 2) * this.mcScale,
			(originZ + sizeZ / 2) * this.mcScale
		);

		return boxMesh;
	}
}
