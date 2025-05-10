import * as THREE from "three";
import { EntityModelLoader } from "./EntityModelLoader";

// Type definitions for OptiFine JEM model format
interface OptifineEntityModel {
	textureSize: [number, number];
	shadowSize?: number;
	models: OptifineModelPart[];
}

interface OptifineModelPart {
	part: string;
	id: string;
	invertAxis?: string;
	translate: [number, number, number];
	rotate?: [number, number, number];
	mirrorTexture?: string;
	boxes?: OptifineModelBox[];
	submodels?: OptifineModelPart[];
	animations?: any[];
	attach?: boolean;
}

interface OptifineModelBox {
	coordinates: [number, number, number, number, number, number]; // [x, y, z, width, height, depth]
	textureOffset?: [number, number];
	sizeAdd?: number;
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

	/**
	 * Create a THREE.js mesh for the given entity
	 */
	public async createEntityMesh(
		entityName: string
	): Promise<THREE.Object3D | null> {
		// Get model and texture data
		const entityData = this.entityModelLoader.getEntityData(entityName);

		if (!entityData.model) {
			console.error(`Failed to load model for ${entityName}`);
			return null;
		}

		const modelJson = entityData.model as unknown as OptifineEntityModel;

		// Create parent group for the entire entity
		const entityGroup = new THREE.Group();
		entityGroup.name = entityName;

		// Load the texture from base64
		let texture: THREE.Texture | null = null;
		if (entityData.texture) {
			try {
				const dataUri = entityData.texture.startsWith("data:image/")
					? entityData.texture
					: `data:image/png;base64,${entityData.texture}`;

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
						(error) => {
							console.error(`Failed to load texture for ${entityName}:`, error);
							reject(error);
						}
					);
				});
			} catch (error) {
				console.error(`Error loading texture for ${entityName}:`, error);

				// Create a fallback texture - gray checkerboard
				texture = this.createFallbackTexture();
			}
		} else {
			console.warn(`No texture found for ${entityName}, using fallback`);
			texture = this.createFallbackTexture();
		}

		// Create material with the texture
		const material = new THREE.MeshStandardMaterial({
			map: texture,
			transparent: true,
			side: THREE.DoubleSide,
			alphaTest: 0.1,
		});

		// Process each model part
		if (modelJson.models && Array.isArray(modelJson.models)) {
			for (const partJson of modelJson.models) {
				try {
					const partGroup = this.createModelPart(
						partJson,
						modelJson.textureSize,
						material
					);
					if (partGroup) {
						entityGroup.add(partGroup);
					}
				} catch (error) {
					console.error(
						`Error creating part ${partJson.id || partJson.part}:`,
						error
					);
				}
			}
		} else {
			console.warn(`Model for ${entityName} has no "models" array`);
		}

		// Scale the entity to match Minecraft's scale
		entityGroup.scale.set(this.mcScale, this.mcScale, this.mcScale);

		// Add debug helpers if enabled
		if (this.debug) {
			const axesHelper = new THREE.AxesHelper(16);
			entityGroup.add(axesHelper);
		}

		return entityGroup;
	}

	/**
	 * Create a fallback texture (checkerboard pattern)
	 */
	private createFallbackTexture(): THREE.Texture {
		const size = 16;
		const canvas = document.createElement("canvas");
		canvas.width = size * 2;
		canvas.height = size * 2;

		const ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.fillStyle = "#888888";
			ctx.fillRect(0, 0, size * 2, size * 2);

			ctx.fillStyle = "#AAAAAA";
			ctx.fillRect(0, 0, size, size);
			ctx.fillRect(size, size, size, size);
		}

		const texture = new THREE.CanvasTexture(canvas);
		texture.magFilter = THREE.NearestFilter;
		texture.minFilter = THREE.NearestFilter;
		return texture;
	}

	/**
	 * Create a THREE.js group for a model part
	 */
	private createModelPart(
		part: OptifineModelPart,
		textureSize: [number, number],
		material: THREE.Material
	): THREE.Group {
		// Create a group for this part
		const group = new THREE.Group();
		group.name = part.id || part.part || "unknown";

		// Process inversion settings from invertAxis
		const invertX = part.invertAxis?.includes("x") ?? true;
		const invertY = part.invertAxis?.includes("y") ?? true;
		const invertZ = part.invertAxis?.includes("z") ?? false;

		// Apply translations - invert axes as specified in model
		const translateX = part.translate[0] * (invertX ? -1 : 1);
		const translateY = part.translate[1] * (invertY ? -1 : 1);
		const translateZ = part.translate[2] * (invertZ ? -1 : 1);

		group.position.set(translateX, translateY, translateZ);

		// Apply rotations (converting from degrees to radians)
		if (part.rotate) {
			const rotX = THREE.MathUtils.degToRad(part.rotate[0]);
			const rotY = THREE.MathUtils.degToRad(part.rotate[1]);
			const rotZ = THREE.MathUtils.degToRad(part.rotate[2]);
			group.rotation.set(rotX, rotY, rotZ);
		}

		// Process boxes in this part
		if (part.boxes && Array.isArray(part.boxes)) {
			for (const box of part.boxes) {
				try {
					const boxMesh = this.createBox(box, textureSize, material, part);
					if (boxMesh) {
						group.add(boxMesh);
					}
				} catch (error) {
					console.error(
						`Error creating box in part ${part.id || part.part}:`,
						error
					);
				}
			}
		}

		// Process submodels recursively
		if (part.submodels && Array.isArray(part.submodels)) {
			for (const submodel of part.submodels) {
				try {
					const subGroup = this.createModelPart(
						submodel,
						textureSize,
						material
					);
					group.add(subGroup);
				} catch (error) {
					console.error(
						`Error creating submodel in part ${part.id || part.part}:`,
						error
					);
				}
			}
		}

		return group;
	}

	/**
	 * Create a THREE.js mesh for a model box
	 */
	private createBox(
		box: OptifineModelBox,
		textureSize: [number, number],
		material: THREE.Material,
		parentPart: OptifineModelPart
	): THREE.Mesh | null {
		if (!box || !box.coordinates) return null;

		const [x, y, z, width, height, depth] = box.coordinates;

		// Skip boxes with invalid dimensions
		if (width <= 0 || height <= 0 || depth <= 0) {
			console.warn(`Invalid box dimensions: [${width}, ${height}, ${depth}]`);
			return null;
		}

		// Create box geometry
		const geometry = new THREE.BoxGeometry(width, height, depth);

		// Check for mirror settings
		const mirrorU = parentPart.mirrorTexture?.includes("u") ?? false;

		// Apply appropriate UV mapping
		if (box.textureOffset) {
			// Box UV mapping (Minecraft-style)
			this.applyBoxUV(
				geometry,
				box.textureOffset,
				[width, height, depth],
				textureSize,
				mirrorU
			);
		} else if (
			box.uvNorth ||
			box.uvEast ||
			box.uvSouth ||
			box.uvWest ||
			box.uvUp ||
			box.uvDown
		) {
			// Face UV mapping (per-face UVs)
			this.applyFaceUV(geometry, box, textureSize, mirrorU);
		}

		// Create mesh and position it
		const mesh = new THREE.Mesh(geometry, material.clone());
		mesh.position.set(x + width / 2, y + height / 2, z + depth / 2);

		// Apply inflation (sizeAdd) if specified
		if (typeof box.sizeAdd === "number" && box.sizeAdd !== 0) {
			// Scale the box from its center
			const inflation = box.sizeAdd / Math.min(width, height, depth);
			mesh.scale.set(1 + inflation, 1 + inflation, 1 + inflation);
		}

		// Add debug wireframe if debug is enabled
		if (this.debug) {
			const wireframe = new THREE.LineSegments(
				new THREE.WireframeGeometry(geometry),
				new THREE.LineBasicMaterial({
					color: 0x00ff00,
					transparent: true,
					opacity: 0.5,
				})
			);
			mesh.add(wireframe);
		}

		return mesh;
	}

	/**
	 * Apply Minecraft-style box UV mapping to a geometry
	 */
	private applyBoxUV(
		geometry: THREE.BoxGeometry,
		textureOffset: [number, number],
		size: [number, number, number],
		textureSize: [number, number],
		mirrorU: boolean
	): void {
		const [u, v] = textureOffset;
		const [width, height, depth] = size;
		const [texWidth, texHeight] = textureSize;

		// Get UV attribute for modification
		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;
		const uvArray = new Float32Array(uvAttribute.array.length);

		// Helper function to normalize texture coordinates
		const normalizeU = (u: number) =>
			mirrorU ? 1 - u / texWidth : u / texWidth;
		const normalizeV = (v: number) => v / texHeight;

		// UV mapping for each face following Minecraft's box UV layout
		// Face order in THREE.js BoxGeometry: +X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (back)

		// Right/East face (+X)
		let faceIdx = 0;
		uvArray[faceIdx * 8 + 0] = normalizeU(u + depth);
		uvArray[faceIdx * 8 + 1] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 2] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 3] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 4] = normalizeU(u + depth);
		uvArray[faceIdx * 8 + 5] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 6] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 7] = normalizeV(v + depth);

		// Left/West face (-X)
		faceIdx = 1;
		uvArray[faceIdx * 8 + 0] = normalizeU(u + depth * 2 + width);
		uvArray[faceIdx * 8 + 1] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 2] = normalizeU(u + depth * 2 + width * 2);
		uvArray[faceIdx * 8 + 3] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 4] = normalizeU(u + depth * 2 + width);
		uvArray[faceIdx * 8 + 5] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 6] = normalizeU(u + depth * 2 + width * 2);
		uvArray[faceIdx * 8 + 7] = normalizeV(v + depth);

		// Top/Up face (+Y)
		faceIdx = 2;
		uvArray[faceIdx * 8 + 0] = normalizeU(u + depth);
		uvArray[faceIdx * 8 + 1] = normalizeV(v);
		uvArray[faceIdx * 8 + 2] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 3] = normalizeV(v);
		uvArray[faceIdx * 8 + 4] = normalizeU(u + depth);
		uvArray[faceIdx * 8 + 5] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 6] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 7] = normalizeV(v + depth);

		// Bottom/Down face (-Y)
		faceIdx = 3;
		uvArray[faceIdx * 8 + 0] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 1] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 2] = normalizeU(u + depth + width * 2);
		uvArray[faceIdx * 8 + 3] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 4] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 5] = normalizeV(v + depth * 2);
		uvArray[faceIdx * 8 + 6] = normalizeU(u + depth + width * 2);
		uvArray[faceIdx * 8 + 7] = normalizeV(v + depth * 2);

		// Front/South face (+Z)
		faceIdx = 4;
		uvArray[faceIdx * 8 + 0] = normalizeU(u + depth * 2 + width);
		uvArray[faceIdx * 8 + 1] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 2] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 3] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 4] = normalizeU(u + depth * 2 + width);
		uvArray[faceIdx * 8 + 5] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 6] = normalizeU(u + depth + width);
		uvArray[faceIdx * 8 + 7] = normalizeV(v + depth);

		// Back/North face (-Z)
		faceIdx = 5;
		uvArray[faceIdx * 8 + 0] = normalizeU(u);
		uvArray[faceIdx * 8 + 1] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 2] = normalizeU(u + depth);
		uvArray[faceIdx * 8 + 3] = normalizeV(v + depth + height);
		uvArray[faceIdx * 8 + 4] = normalizeU(u);
		uvArray[faceIdx * 8 + 5] = normalizeV(v + depth);
		uvArray[faceIdx * 8 + 6] = normalizeU(u + depth);
		uvArray[faceIdx * 8 + 7] = normalizeV(v + depth);

		// Update the geometry's UV attribute
		geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
	}

	/**
	 * Apply per-face UV mapping to a geometry
	 */
	private applyFaceUV(
		geometry: THREE.BoxGeometry,
		box: OptifineModelBox,
		textureSize: [number, number],
		mirrorU: boolean
	): void {
		const [texWidth, texHeight] = textureSize;

		// Get UV attribute for modification
		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;
		const uvArray = new Float32Array(uvAttribute.array.length);

		// Copy existing UVs as default
		for (let i = 0; i < uvAttribute.array.length; i++) {
			uvArray[i] = uvAttribute.array[i];
		}

		// Helper function to normalize texture coordinates
		const normalizeU = (u: number) =>
			mirrorU ? 1 - u / texWidth : u / texWidth;
		const normalizeV = (v: number) => v / texHeight;

		// Apply UVs for each face if provided

		// East face (+X) - face index 0
		if (box.uvEast) {
			const faceIdx = 0;
			uvArray[faceIdx * 8 + 0] = normalizeU(box.uvEast[0]);
			uvArray[faceIdx * 8 + 1] = normalizeV(box.uvEast[3]);
			uvArray[faceIdx * 8 + 2] = normalizeU(box.uvEast[2]);
			uvArray[faceIdx * 8 + 3] = normalizeV(box.uvEast[3]);
			uvArray[faceIdx * 8 + 4] = normalizeU(box.uvEast[0]);
			uvArray[faceIdx * 8 + 5] = normalizeV(box.uvEast[1]);
			uvArray[faceIdx * 8 + 6] = normalizeU(box.uvEast[2]);
			uvArray[faceIdx * 8 + 7] = normalizeV(box.uvEast[1]);
		}

		// West face (-X) - face index 1
		if (box.uvWest) {
			const faceIdx = 1;
			uvArray[faceIdx * 8 + 0] = normalizeU(box.uvWest[0]);
			uvArray[faceIdx * 8 + 1] = normalizeV(box.uvWest[3]);
			uvArray[faceIdx * 8 + 2] = normalizeU(box.uvWest[2]);
			uvArray[faceIdx * 8 + 3] = normalizeV(box.uvWest[3]);
			uvArray[faceIdx * 8 + 4] = normalizeU(box.uvWest[0]);
			uvArray[faceIdx * 8 + 5] = normalizeV(box.uvWest[1]);
			uvArray[faceIdx * 8 + 6] = normalizeU(box.uvWest[2]);
			uvArray[faceIdx * 8 + 7] = normalizeV(box.uvWest[1]);
		}

		// Up face (+Y) - face index 2
		if (box.uvUp) {
			const faceIdx = 2;
			uvArray[faceIdx * 8 + 0] = normalizeU(box.uvUp[0]);
			uvArray[faceIdx * 8 + 1] = normalizeV(box.uvUp[1]);
			uvArray[faceIdx * 8 + 2] = normalizeU(box.uvUp[2]);
			uvArray[faceIdx * 8 + 3] = normalizeV(box.uvUp[1]);
			uvArray[faceIdx * 8 + 4] = normalizeU(box.uvUp[0]);
			uvArray[faceIdx * 8 + 5] = normalizeV(box.uvUp[3]);
			uvArray[faceIdx * 8 + 6] = normalizeU(box.uvUp[2]);
			uvArray[faceIdx * 8 + 7] = normalizeV(box.uvUp[3]);
		}

		// Down face (-Y) - face index 3
		if (box.uvDown) {
			const faceIdx = 3;
			uvArray[faceIdx * 8 + 0] = normalizeU(box.uvDown[0]);
			uvArray[faceIdx * 8 + 1] = normalizeV(box.uvDown[1]);
			uvArray[faceIdx * 8 + 2] = normalizeU(box.uvDown[2]);
			uvArray[faceIdx * 8 + 3] = normalizeV(box.uvDown[1]);
			uvArray[faceIdx * 8 + 4] = normalizeU(box.uvDown[0]);
			uvArray[faceIdx * 8 + 5] = normalizeV(box.uvDown[3]);
			uvArray[faceIdx * 8 + 6] = normalizeU(box.uvDown[2]);
			uvArray[faceIdx * 8 + 7] = normalizeV(box.uvDown[3]);
		}

		// South face (+Z) - face index 4
		if (box.uvSouth) {
			const faceIdx = 4;
			uvArray[faceIdx * 8 + 0] = normalizeU(box.uvSouth[0]);
			uvArray[faceIdx * 8 + 1] = normalizeV(box.uvSouth[3]);
			uvArray[faceIdx * 8 + 2] = normalizeU(box.uvSouth[2]);
			uvArray[faceIdx * 8 + 3] = normalizeV(box.uvSouth[3]);
			uvArray[faceIdx * 8 + 4] = normalizeU(box.uvSouth[0]);
			uvArray[faceIdx * 8 + 5] = normalizeV(box.uvSouth[1]);
			uvArray[faceIdx * 8 + 6] = normalizeU(box.uvSouth[2]);
			uvArray[faceIdx * 8 + 7] = normalizeV(box.uvSouth[1]);
		}

		// North face (-Z) - face index 5
		if (box.uvNorth) {
			const faceIdx = 5;
			uvArray[faceIdx * 8 + 0] = normalizeU(box.uvNorth[0]);
			uvArray[faceIdx * 8 + 1] = normalizeV(box.uvNorth[3]);
			uvArray[faceIdx * 8 + 2] = normalizeU(box.uvNorth[2]);
			uvArray[faceIdx * 8 + 3] = normalizeV(box.uvNorth[3]);
			uvArray[faceIdx * 8 + 4] = normalizeU(box.uvNorth[0]);
			uvArray[faceIdx * 8 + 5] = normalizeV(box.uvNorth[1]);
			uvArray[faceIdx * 8 + 6] = normalizeU(box.uvNorth[2]);
			uvArray[faceIdx * 8 + 7] = normalizeV(box.uvNorth[1]);
		}

		// Update the geometry's UV attribute
		geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
	}
}
