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
	sizesAdd?: [number, number, number];
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

	constructor(entityModelLoader: EntityModelLoader, debug: boolean = true) {
		this.entityModelLoader = entityModelLoader;
		this.textureLoader = new THREE.TextureLoader();
		this.debug = debug;
		if (this.debug) {
			console.log("[EntityRenderer] Debug mode enabled.");
			console.log("[EntityRenderer] mcScale:", this.mcScale);
			console.log(
				"[EntityRenderer] THREE.Object3D.DEFAULT_MATRIX_AUTO_UPDATE:",
				THREE.Object3D.DEFAULT_MATRIX_AUTO_UPDATE
			);
		}
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
			texture = await new Promise<THREE.Texture>((resolve, reject) => {
				this.textureLoader.load(
					dataUri,
					(loadedTexture) => {
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
		const modelIndexToShow = -1; // -1 means show all models
		if (modelJson.models) {
			if (modelIndexToShow < 0 || modelJson.models.length <= modelIndexToShow) {
				for (const partJson of modelJson.models) {
					const partGroup = this.createPartMeshRecursive(
						partJson,
						modelJson.textureSize,
						texture,
						true
					);
					entityGroup.add(partGroup);
				}
			} else {
				//only do the first part for now
				const partJson = modelJson.models[modelIndexToShow];
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

		return entityGroup;
	}

	private applyModelTransforms(
		partGroup: THREE.Group,
		partJson: MinecraftModelPart,
		isRootPart: boolean
	): void {
		// Extract translation values
		let pivotX_jem = 0,
			pivotY_jem = 0,
			pivotZ_jem = 0;
		if (partJson.translate) {
			[pivotX_jem, pivotY_jem, pivotZ_jem] = partJson.translate;
		}

		// Determine which axes to invert
		let invertX = false,
			invertY = false,
			invertZ = false;
		if (partJson.invertAxis) {
			invertX = partJson.invertAxis.includes("x");
			invertY = partJson.invertAxis.includes("y");
			invertZ = partJson.invertAxis.includes("z");
		}

		// Apply inversion to translation values
		let translatedX = pivotX_jem;
		let translatedY = pivotY_jem;
		let translatedZ = pivotZ_jem;

		if (invertX) translatedX = -translatedX;
		if (invertY) translatedY = -translatedY;
		if (invertZ) translatedZ = -translatedZ;

		// Apply translation (pivot position)
		// partGroup.position.set(
		// 	translatedX * this.mcScale,
		// 	translatedY * this.mcScale,
		// 	translatedZ * this.mcScale
		// );

		// // Apply rotation - use the values directly from the model file
		// if (partJson.rotate) {
		// 	partGroup.rotation.set(
		// 		THREE.MathUtils.degToRad(partJson.rotate[0]),
		// 		THREE.MathUtils.degToRad(partJson.rotate[1]),
		// 		THREE.MathUtils.degToRad(partJson.rotate[2]),
		// 		"XYZ" // Standard rotation order
		// 	);
		// }

		// Apply mirroring if needed
		if (partJson.mirror) {
			partGroup.scale.x = -1;
		}
	}

	private createPartMeshRecursive(
		partJson: MinecraftModelPart,
		modelTextureSize: [number, number],
		texture: THREE.Texture,
		isRootPart: boolean
	): THREE.Group {
		const partGroup = new THREE.Group(); // Single group for this part
		partGroup.name = partJson.id || partJson.part || "unnamed_part";

		if (this.debug) {
			console.log(
				`Creating part: ${partGroup.name}, matrixAutoUpdate initial: ${partGroup.matrixAutoUpdate}`
			);
		}

		// Apply all transformations to the part group
		this.applyModelTransforms(partGroup, partJson, isRootPart);

		// Add boxes as children of this partGroup
		if (partJson.boxes) {
			for (const boxJson of partJson.boxes) {
				const boxMesh = this.createBoxMesh(
					boxJson,
					modelTextureSize,
					texture,
					partJson
				);
				if (boxMesh) {
					partGroup.add(boxMesh); // boxMesh.position is local to partGroup
				}
			}
		}

		// Add submodels as children of this partGroup
		if (partJson.submodels) {
			for (const subPartJson of partJson.submodels) {
				const subPartGroup = this.createPartMeshRecursive(
					subPartJson,
					modelTextureSize,
					texture,
					false // Submodels are not root parts
				);
				partGroup.add(subPartGroup); // subPartGroup.position is local to this partGroup
			}
		}

		return partGroup;
	}

	private createBoxMesh(
		boxJson: MinecraftModelBox,
		modelTextureSize: [number, number],
		texture: THREE.Texture,
		parentPartJson: MinecraftModelPart
	): THREE.Mesh | null {
		// Create geometry
		const boxGeometry = this.createBoxGeometry(boxJson);
		if (!boxGeometry) return null;

		// Set up UVs
		this.setupBoxUVs(boxGeometry, boxJson, modelTextureSize, parentPartJson);

		// Create material and mesh
		const material = new THREE.MeshBasicMaterial({
			map: texture,
			alphaTest: 0.1,
			transparent: true,
			side: parentPartJson.mirror ? THREE.DoubleSide : THREE.FrontSide,
		});

		const boxMesh = new THREE.Mesh(boxGeometry, material);
		const boxIndex = parentPartJson.boxes?.indexOf(boxJson) ?? "unknown";
		boxMesh.name = `${parentPartJson.id || "part"}_box${boxIndex}`;

		// Get box dimensions
		let [originX, originY, originZ, sizeX, sizeY, sizeZ] =
			this.calculateBoxDimensions(boxJson);

		// Apply invertAxis transformations to match Blockbench's export logic
		// This transforms coordinates based on the parent part's invertAxis setting
		let invertX = false,
			invertY = false,
			invertZ = false;

		if (parentPartJson.invertAxis) {
			invertX = parentPartJson.invertAxis.includes("x");
			invertY = parentPartJson.invertAxis.includes("y");
			invertZ = parentPartJson.invertAxis.includes("z");
		}

		// Apply the inversion to the box coordinates
		// When an axis is inverted, we need to flip both origin and account for size
		if (invertX) {
			originX = -originX - sizeX;
		}
		if (invertY) {
			originY = -originY - sizeY;
		}
		if (invertZ) {
			originZ = -originZ - sizeZ;
		}

		if (this.debug) {
			console.log(
				`Box ${boxMesh.name} (parent: ${parentPartJson.id}):`,
				{
					originalCoords: boxJson.coordinates,
					invertedCoords: [originX, originY, originZ],
					size: [sizeX, sizeY, sizeZ],
					invertAxis: parentPartJson.invertAxis || "none",
				},
				{
					invertX: invertX,
					invertY: invertY,
					invertZ: invertZ,
					originX: originX,
					originY: originY,
					originZ: originZ,
					sizeX: sizeX,
					sizeY: sizeY,
					sizeZ: sizeZ,
				}
			);
		}

		// Position the box mesh - converting from corner-based to center-based
		boxMesh.position.set(
			(originX + sizeX / 2) * this.mcScale,
			(originY + sizeY / 2) * this.mcScale,
			(originZ + sizeZ / 2) * this.mcScale
		);

		// Debug logging
		if (this.debug) {
			console.log(`Box ${boxMesh.name}:`, {
				originalCoords: boxJson.coordinates,
				afterInversion: [originX, originY, originZ, sizeX, sizeY, sizeZ],
				finalPosition: boxMesh.position.toArray().map((v) => v.toFixed(3)),
				parentInvertAxis: parentPartJson.invertAxis || "none",
			});

			this.addDebugWireframe(boxMesh);
			this.addDebugOriginMarker(boxMesh, [originX, originY, originZ]);
		}

		return boxMesh;
	}

	/**
	 * Adds a wireframe overlay to a box mesh for debugging
	 */
	private addDebugWireframe(boxMesh: THREE.Mesh): void {
		// Create wireframe material
		const wireframeMaterial = new THREE.LineBasicMaterial({
			color: 0x00ff00, // Bright green for visibility
			transparent: true,
			opacity: 0.8,
			depthTest: true,
		});

		// Create wireframe geometry from the box's geometry
		const wireframeGeometry = new THREE.WireframeGeometry(boxMesh.geometry);

		// Create and add the wireframe
		const wireframe = new THREE.LineSegments(
			wireframeGeometry,
			wireframeMaterial
		);
		wireframe.name = `${boxMesh.name}_wireframe`;
		boxMesh.add(wireframe);

		// Make the original mesh semi-transparent to see inside
		if (boxMesh.material instanceof THREE.MeshBasicMaterial) {
			boxMesh.material.transparent = true;
			boxMesh.material.opacity = 0.7;
		}
	}

	/**
	 * Adds a marker at the box's origin point for debugging
	 */
	private addDebugOriginMarker(
		boxMesh: THREE.Mesh,
		originCoords: [number, number, number]
	): void {
		const [originX, originY, originZ] = originCoords;

		// Create a small sphere to mark the origin
		const originGeometry = new THREE.SphereGeometry(0.05, 8, 8);
		const originMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red
		const originMarker = new THREE.Mesh(originGeometry, originMaterial);

		// Calculate the position relative to the box center
		originMarker.position.set(
			-boxMesh.position.x + originX * this.mcScale,
			-boxMesh.position.y + originY * this.mcScale,
			-boxMesh.position.z + originZ * this.mcScale
		);

		originMarker.name = `${boxMesh.name}_origin`;
		boxMesh.add(originMarker);

		// Optional: Add coordinate axes at the origin
		this.addCoordinateAxes(boxMesh, originMarker.position);
	}

	/**
	 * Adds RGB coordinate axes at a point for debugging
	 */
	private addCoordinateAxes(
		parent: THREE.Object3D,
		position: THREE.Vector3,
		axisLength: number = 0.15
	): void {
		// X-axis (red)
		const xGeometry = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(axisLength, 0, 0),
		]);
		const xMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
		const xAxis = new THREE.Line(xGeometry, xMaterial);

		// Y-axis (green)
		const yGeometry = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(0, axisLength, 0),
		]);
		const yMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
		const yAxis = new THREE.Line(yGeometry, yMaterial);

		// Z-axis (blue)
		const zGeometry = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(0, 0, axisLength),
		]);
		const zMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
		const zAxis = new THREE.Line(zGeometry, zMaterial);

		// Create a group for all axes
		const axesGroup = new THREE.Group();
		axesGroup.add(xAxis);
		axesGroup.add(yAxis);
		axesGroup.add(zAxis);

		// Position the axes group
		axesGroup.position.copy(position);
		axesGroup.name = `${parent.name}_axes`;

		parent.add(axesGroup);
	}

	private calculateBoxDimensions(
		boxJson: MinecraftModelBox
	): [number, number, number, number, number, number] {
		let [originX, originY, originZ, sizeX, sizeY, sizeZ] = boxJson.coordinates;

		// Handle both sizeAdd (uniform) and sizesAdd (per-axis)
		if (
			"sizesAdd" in boxJson &&
			Array.isArray(boxJson.sizesAdd) &&
			boxJson.sizesAdd.length === 3
		) {
			const [xAdd, yAdd, zAdd] = boxJson.sizesAdd;
			originX -= xAdd;
			originY -= yAdd;
			originZ -= zAdd;
			sizeX += xAdd * 2;
			sizeY += yAdd * 2;
			sizeZ += zAdd * 2;
		} else if (boxJson.sizeAdd) {
			const sizeAdd = boxJson.sizeAdd || 0;
			originX -= sizeAdd;
			originY -= sizeAdd;
			originZ -= sizeAdd;
			sizeX += sizeAdd * 2;
			sizeY += sizeAdd * 2;
			sizeZ += sizeAdd * 2;
		}

		return [originX, originY, originZ, sizeX, sizeY, sizeZ];
	}

	private createBoxGeometry(
		boxJson: MinecraftModelBox
	): THREE.BoxGeometry | null {
		const [_, __, ___, sizeX, sizeY, sizeZ] =
			this.calculateBoxDimensions(boxJson);

		const finalSizeX = sizeX * this.mcScale;
		const finalSizeY = sizeY * this.mcScale;
		const finalSizeZ = sizeZ * this.mcScale;

		if (finalSizeX <= 0 || finalSizeY <= 0 || finalSizeZ <= 0) {
			if (this.debug)
				console.warn(`[EntityRenderer] Zero/negative size box`, boxJson);
			return null;
		}

		return new THREE.BoxGeometry(finalSizeX, finalSizeY, finalSizeZ);
	}

	private setupBoxUVs(
		boxGeometry: THREE.BoxGeometry,
		boxJson: MinecraftModelBox,
		modelTextureSize: [number, number],
		parentPartJson: MinecraftModelPart
	): void {
		const [texU_offset, texV_offset] = boxJson.textureOffset;
		const [textureWidth, textureHeight] = modelTextureSize;
		const [_, __, ___, sizeX, sizeY, sizeZ] =
			this.calculateBoxDimensions(boxJson);

		const uvAttribute = boxGeometry.getAttribute("uv") as THREE.BufferAttribute;
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
				// Standard Minecraft UV layout
				switch (i) {
					case 0:
						[u, v, w, h] = [
							texU_offset + sizeZ,
							texV_offset + sizeZ,
							sizeZ,
							sizeY,
						];
						break; // Right (+X)
					case 1:
						[u, v, w, h] = [texU_offset, texV_offset + sizeZ, sizeZ, sizeY];
						break; // Left (-X)
					case 2:
						[u, v, w, h] = [texU_offset + sizeZ, texV_offset, sizeX, sizeZ];
						break; // Top (+Y)
					case 3:
						[u, v, w, h] = [
							texU_offset + sizeZ + sizeX,
							texV_offset,
							sizeX,
							sizeZ,
						];
						break; // Bottom (-Y)
					case 4:
						[u, v, w, h] = [
							texU_offset + sizeZ + sizeX,
							texV_offset + sizeZ,
							sizeX,
							sizeY,
						];
						break; // Front (+Z)
					case 5:
						[u, v, w, h] = [
							texU_offset + sizeZ + sizeX + sizeX,
							texV_offset + sizeZ,
							sizeX,
							sizeY,
						];
						break; // Back (-Z)
					default:
						[u, v, w, h] = [0, 0, 0, 0];
						break;
				}
			}

			if (w === 0 || h === 0) {
				// Skip UV update for zero-area texture regions
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
			const uvIdx = i * 4; // UV order for BoxGeometry faces: BR, BL, TR, TL
			uvAttribute.setXY(uvIdx + 0, u1, v1);
			uvAttribute.setXY(uvIdx + 1, u0, v1);
			uvAttribute.setXY(uvIdx + 2, u1, v0);
			uvAttribute.setXY(uvIdx + 3, u0, v0);
		}

		uvAttribute.needsUpdate = true;
	}
}
