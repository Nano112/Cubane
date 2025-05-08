import * as THREE from "three";
import { EntityModelLoader } from "./EntityModelLoader"; // Assuming this is correct

// --- Interfaces (ensure these match your actual EntityModel structure) ---
interface MinecraftEntityModel {
	textureSize: [number, number];
	models: MinecraftModelPart[];
}

interface MinecraftModelPart {
	part: string;
	id: string;
	invertAxis?: "xy" | "yz" | "xz" | string; // We'll use this as a flag for MC coords
	translate?: [number, number, number]; // Pivot point of this part
	rotate?: [number, number, number]; // Rotation in degrees (X, Y, Z) around the pivot
	mirror?: boolean;
	boxes?: MinecraftModelBox[];
	submodels?: MinecraftModelPart[];
}

interface MinecraftModelBox {
	coordinates: [number, number, number, number, number, number]; // [originX, originY, originZ, sizeX, sizeY, sizeZ]
	textureOffset: [number, number];
	sizeAdd?: number;
	// UV face definitions...
	uvNorth?: [number, number, number, number];
	uvEast?: [number, number, number, number];
	uvSouth?: [number, number, number, number];
	uvWest?: [number, number, number, number];
	uvUp?: [number, number, number, number];
	uvDown?: [number, number, number, number];
}

export class EntityRenderer {
	private entityModelLoader: EntityModelLoader;
	private textureLoader: THREE.TextureLoader;
	private debug: boolean = false;
	private readonly mcScale: number = 1 / 16; // Minecraft pixels to Three.js units

	constructor(entityModelLoader: EntityModelLoader, debug: boolean = false) {
		this.entityModelLoader = entityModelLoader;
		this.textureLoader = new THREE.TextureLoader();
		this.debug = debug;
	}

	public async createEntityMesh(
		entityName: string
	): Promise<THREE.Object3D | null> {
		const entityData = this.entityModelLoader.getEntityData(entityName);

		if (!entityData.model) {
			if (this.debug)
				console.warn(`[EntityRenderer] No model data for ${entityName}`);
			return null;
		}
		const modelJson = entityData.model as unknown as MinecraftEntityModel;

		if (!entityData.texture) {
			if (this.debug)
				console.warn(`[EntityRenderer] No texture data for ${entityName}`);
			return null;
		}
		const textureBase64 = entityData.texture;

		let texture: THREE.Texture;
		try {
			const dataUri = textureBase64.startsWith("data:image/")
				? textureBase64
				: `data:image/png;base64,${textureBase64}`;

			if (this.debug)
				console.log(
					`[EntityRenderer] Loading texture for "${entityName}" from: ${dataUri.substring(
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
								`[EntityRenderer] Texture loaded for "${entityName}"`
							);
						loadedTexture.magFilter = THREE.NearestFilter;
						loadedTexture.minFilter = THREE.NearestMipmapNearestFilter;
						loadedTexture.flipY = false;
						resolve(loadedTexture);
					},
					undefined,
					(errorEvent) => {
						console.error(
							`[EntityRenderer] Failed to load texture for "${entityName}"`,
							errorEvent
						);
						reject(new Error(`Texture load failed for ${entityName}`));
					}
				);
			});
		} catch (error) {
			return null;
		}

		const entityGroup = new THREE.Object3D();
		entityGroup.name = entityName;

		// This is the root container for the entity model.
		// Minecraft renders entities often with Y up, but models might be authored differently.
		// A common transform for models authored in tools like Blockbench (Z up default) to
		// Minecraft's Y-up rendering is to rotate -90 degrees around X.
		// However, the `invertAxis: 'xy'` and specific negations in Blockbench's JEM exporter
		// suggest a different approach where coordinates are pre-adjusted.

		// Let's assume the `invertAxis: 'xy'` in the JSON implies a coordinate system adjustment
		// that's already handled by how the `translate` and `rotate` values are stored.

		if (modelJson.models) {
			for (const partJson of modelJson.models) {
				// Pass true for isRootPart if these are the direct children of modelJson.models
				const partGroup = this.createPartMeshRecursive(
					partJson,
					modelJson.textureSize,
					texture,
					true
				);
				entityGroup.add(partGroup);
			}
		} else {
			if (this.debug)
				console.warn(
					`[EntityRenderer] Model for "${entityName}" has no "models" array.`
				);
		}

		console.log("--- Verifying entityGroup Rotation ---");

		// What IS entityGroup.rotation right now?
		console.log("1. entityGroup.rotation object itself:", entityGroup.rotation);

		// If it's an Euler, what are its properties?
		if (entityGroup.rotation instanceof THREE.Euler) {
			console.log("2. Is Euler: true");
			console.log("3. Euler X:", entityGroup.rotation.x);
			console.log("4. Euler Y:", entityGroup.rotation.y);
			console.log("5. Euler Z:", entityGroup.rotation.z);
			const currentOrder = entityGroup.rotation.order;
			console.log("6. Euler Order (direct access):", currentOrder);
			console.log("7. typeof Euler Order:", typeof currentOrder); // Should be 'string'

			// Now, let's call toArray on THIS Euler object
			const eulerArray = entityGroup.rotation.toArray();
			console.log("8. entityGroup.rotation.toArray() output:", eulerArray);
			console.log("9. Fourth element of toArray():", eulerArray[3]);
			console.log("10. typeof fourth element:", typeof eulerArray[3]); // Should be 'string'
		} else {
			console.log("2. Is Euler: false");
			console.log("--- entityGroup is using Quaternion ---");
			console.log("Quaternion components:", entityGroup.quaternion.toArray());
			if (entityGroup.quaternion.toArray().some(isNaN)) {
				console.error("QUATERNION HAS NaN!");
			}
		}

		// Explicitly reset to be safe, as discussed before:
		console.log("--- Applying Explicit Rotation Reset ---");
		entityGroup.rotation.set(0, 0, 0); // Set X, Y, Z
		entityGroup.rotation.order = "YXZ"; // Set order
		console.log("After reset - Euler Order:", entityGroup.rotation.order);
		console.log("After reset - toArray():", entityGroup.rotation.toArray());

		console.log("--- End Verification ---");

		console.log("Final entityGroup properties BEFORE adding to scene:"); // Your existing logs
		console.log("entityGroup.position:", entityGroup.position.toArray());

		return entityGroup;
	}

	private createPartMeshRecursive(
		partJson: MinecraftModelPart,
		modelTextureSize: [number, number],
		texture: THREE.Texture,
		isRootPart: boolean // Pass true for models in modelJson.models
	): THREE.Group {
		const partGroup = new THREE.Group();
		partGroup.name = partJson.id || partJson.part || "unnamed_part";

		let pivotX = 0,
			pivotY = 0,
			pivotZ = 0;
		if (partJson.translate) {
			[pivotX, pivotY, pivotZ] = partJson.translate;
		}

		if (isRootPart) {
			// For root parts, negate the pivot components from JEM.
			partGroup.position.set(
				-pivotX * this.mcScale,
				-pivotY * this.mcScale,
				-pivotZ * this.mcScale
			);
			console.log(
				`ROOT Part: ${partJson.id}, JEM translate: [${pivotX}, ${pivotY}, ${pivotZ}], APPLIED partGroup.position:`,
				partGroup.position.toArray().map((c) => c / this.mcScale)
			); // Log it in JEM units
		} else {
			// For submodels
			partGroup.position.set(
				pivotX * this.mcScale,
				pivotY * this.mcScale,
				pivotZ * this.mcScale
			);
			console.log(
				`SUB Part: ${partJson.id}, JEM translate: [${pivotX}, ${pivotY}, ${pivotZ}], APPLIED partGroup.position:`,
				partGroup.position.toArray().map((c) => c / this.mcScale)
			);
		}

		if (partJson.rotate) {
			// Rotation values from JEM are used directly.
			// The YXZ order is common for Minecraft entities.
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

		partGroup.updateMatrix();
		partGroup.updateMatrixWorld(true);

		if (partJson.boxes) {
			for (const boxJson of partJson.boxes) {
				// Box coordinates are relative to the part's pivot (now partGroup.position).
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
				// Pass false for isRootPart for submodels.
				const subPartGroup = this.createPartMeshRecursive(
					subPartJson,
					modelTextureSize,
					texture,
					false
				);
				partGroup.add(subPartGroup);
			}
		}
		partGroup.updateMatrix();
		partGroup.updateMatrixWorld(true);
		return partGroup;
	}

	private createBoxMesh(
		boxJson: MinecraftModelBox,
		modelTextureSize: [number, number],
		texture: THREE.Texture,
		parentPartJson: MinecraftModelPart // For context, e.g., debug naming
	): THREE.Mesh | null {
		// ... (UV calculation logic remains the same as before)
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
			if (this.debug)
				console.warn(
					`[EntityRenderer] Zero/negative size box for part "${parentPartJson.id}"`,
					boxJson
				);
			return null;
		}

		const boxGeom = new THREE.BoxGeometry(finalSizeX, finalSizeY, finalSizeZ);
		// ... (UV attribute and mapping logic as before)
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
					if (this.debug)
						console.warn(
							`[EntityRenderer] Missing custom UV for face ${i} on box in part "${parentPartJson.id}".`
						);
				}
			} else {
				switch (i /* Standard MC UV layout */) {
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
		// --- End of UV logic ---

		const material = new THREE.MeshBasicMaterial({
			map: texture,
			alphaTest: 0.1,
			transparent: true,
			side: parentPartJson.mirror ? THREE.DoubleSide : THREE.FrontSide,
		});

		const boxMesh = new THREE.Mesh(boxGeom, material);
		const boxIndex = parentPartJson.boxes?.indexOf(boxJson) ?? "unknown";
		boxMesh.name = `${parentPartJson.id || "part"}_box${boxIndex}`;

		// Position the box. BoxGeometry is centered at (0,0,0) in its local space.
		// originX,Y,Z from the JSON is the "min corner" of the box *before* scaling,
		// and it's relative to the part's pivot.
		// So, the center of the box in the part's local space is:
		boxMesh.position.set(
			(originX + sizeX / 2) * this.mcScale,
			(originY + sizeY / 2) * this.mcScale,
			(originZ + sizeZ / 2) * this.mcScale
		);

		return boxMesh;
	}
}
