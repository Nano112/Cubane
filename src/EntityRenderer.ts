import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { EntityModel, EntityModelPart, EntityModelBox } from "./types";
import { EntityModelLoader } from "./EntityModelLoader";

export class EntityRenderer {
	private assetLoader: AssetLoader;
	private entityModelLoader: EntityModelLoader;
	private textureCache: Map<string, THREE.Texture> = new Map();
	private debug: boolean = true;

	constructor(assetLoader: AssetLoader, entityModelLoader: EntityModelLoader) {
		this.assetLoader = assetLoader;
		this.entityModelLoader = entityModelLoader;
	}

	public async createEntityMesh(entityName: string): Promise<THREE.Object3D> {
		console.log(`Creating entity mesh for ${entityName}`);

		// Get entity data (model and texture)
		const entityData = this.entityModelLoader.getEntityData(entityName);

		if (!entityData.model) {
			console.warn(`No model found for entity: ${entityName}`);
			return this.createPlaceholderMesh();
		}

		// Load texture from base64 data or asset loader
		let texture: THREE.Texture;
		if (entityData.texture) {
			texture = await this.createTextureFromBase64(entityData.texture);
		} else {
			texture = await this.assetLoader.getEntityTexture(entityName);
		}

		// Create a group for the entire entity
		const entityGroup = new THREE.Group();
		entityGroup.name = entityName;

		// Map to store created parts by ID for hierarchy building
		const partMap = new Map<string, THREE.Object3D>();

		// First, create all parts without hierarchy
		for (const part of entityData.model.models) {
			try {
				const partMesh = await this.createModelPart(
					part,
					entityData.model,
					texture
				);
				partMap.set(part.id || part.part || "unknown", partMesh);

				// Initially add to the root
				entityGroup.add(partMesh);

				if (this.debug) {
					console.log(`Added part ${part.id || part.part} to entity:`, {
						position: partMesh.position.clone(),
						rotation: partMesh.rotation.clone(),
						parent: entityGroup.name,
					});
				}
			} catch (error) {
				console.error(
					`Error creating part ${part.id || part.part} for ${entityName}:`,
					error
				);
			}
		}

		// Calculate the bounding box of the entire model
		const boundingBox = new THREE.Box3().setFromObject(entityGroup);
		const modelCenter = new THREE.Vector3();
		boundingBox.getCenter(modelCenter);

		// Create a wrapper group that will be properly centered
		const centeredGroup = new THREE.Group();
		centeredGroup.name = `${entityName}_centered`;

		// Add the entity group to the centered group
		centeredGroup.add(entityGroup);

		// Offset the entity group to center the model
		entityGroup.position.set(-modelCenter.x, -modelCenter.y, -modelCenter.z);

		// Position the centered group at the center of the block
		centeredGroup.position.set(0.5, 0, 0.5);

		if (this.debug) {
			console.log(`Model bounding box:`, {
				min: boundingBox.min,
				max: boundingBox.max,
				center: modelCenter,
				size: boundingBox.getSize(new THREE.Vector3()),
			});

			// Add debug helpers to show the center
			const centerHelper = new THREE.Mesh(
				new THREE.SphereGeometry(0.05),
				new THREE.MeshBasicMaterial({ color: 0xff0000 })
			);
			centeredGroup.add(centerHelper);
		}

		return centeredGroup;
	}

	/**
	 * Create a model part with proper translation and rotation
	 */
	private async createModelPart(
		part: EntityModelPart,
		model: EntityModel,
		texture: THREE.Texture
	): Promise<THREE.Object3D> {
		const partGroup = new THREE.Group();
		partGroup.name = part.id || part.part || "unnamed_part";

		if (this.debug) {
			console.log(`Creating part: ${partGroup.name}`, {
				jemData: part,
			});
		}

		// Always invert translations consistently for ALL parts
		if (part.translate) {
			const [tx, ty, tz] = part.translate;
			partGroup.position.set(-tx / 16, -ty / 16, -tz / 16);
		}

		// Process boxes
		if (part.boxes) {
			for (const box of part.boxes) {
				try {
					const cubeMesh = this.createBoxMesh(box, part, model, texture);
					partGroup.add(cubeMesh);
				} catch (error) {
					console.error(
						`Error creating box for part ${partGroup.name}:`,
						error
					);
				}
			}
		}

		// Apply rotations directly
		if (part.rotate) {
			const [rx, ry, rz] = part.rotate;

			// Convert degrees to radians
			const rxRad = (rx * Math.PI) / 180;
			const ryRad = (ry * Math.PI) / 180;
			const rzRad = (rz * Math.PI) / 180;

			partGroup.rotation.order = "XYZ";
			partGroup.rotation.set(rxRad, ryRad, rzRad);

			if (this.debug) {
				console.log(`Part ${partGroup.name} rotation:`, {
					jemRotateDeg: [rx, ry, rz],
					finalRotationRadTHREE: partGroup.rotation.clone(),
				});
			}
		}

		// Process submodels (recursively)
		if (part.submodels) {
			for (const submodel of part.submodels) {
				try {
					const submodelMesh = await this.createModelPart(
						submodel,
						model,
						texture
					);
					partGroup.add(submodelMesh);
				} catch (error) {
					console.error(
						`Error creating submodel for ${partGroup.name}:`,
						error
					);
				}
			}
		}

		if (this.debug) {
			this.addDebugHelpers(partGroup);
		}

		return partGroup;
	}

	/**
	 * Create a box mesh with proper geometry and UVs
	 */
	private createBoxMesh(
		box: EntityModelBox,
		part: EntityModelPart,
		model: EntityModel,
		texture: THREE.Texture
	): THREE.Mesh {
		const [ox, oy, oz, width, height, depth] = box.coordinates;
		const posX = ox + width / 2;
		const posY = oy + height / 2;
		const posZ = oz + depth / 2;
		const sizeAdd = box.sizeAdd || 0;
		const inflatedWidth = width + sizeAdd * 2;
		const inflatedHeight = height + sizeAdd * 2;
		const inflatedDepth = depth + sizeAdd * 2;

		const geometry = new THREE.BoxGeometry(
			inflatedWidth / 16,
			inflatedHeight / 16,
			inflatedDepth / 16
		);

		this.applyUVMapping(geometry, box, part, model);

		const material = new THREE.MeshStandardMaterial({
			map: texture,
			transparent: true,
			alphaTest: 0.5,
			side: THREE.DoubleSide,
		});

		const mesh = new THREE.Mesh(geometry, material);

		mesh.position.set(posX / 16, posY / 16, posZ / 16);

		if (this.debug) {
			const wireframe = new THREE.LineSegments(
				new THREE.WireframeGeometry(geometry),
				new THREE.LineBasicMaterial({ color: 0x00ff00 })
			);
			mesh.add(wireframe);

			const debugSphere = new THREE.Mesh(
				new THREE.SphereGeometry(0.03),
				new THREE.MeshBasicMaterial({ color: 0xff00ff }) // Magenta sphere at box center
			);
			mesh.add(debugSphere);

			console.log(
				`Box created for part ${part.id || part.part || "unnamed_part"}:`,
				{
					name: mesh.name,
					originalCoordinates: [ox, oy, oz],
					size: [width, height, depth],
					inflatedSize: [inflatedWidth, inflatedHeight, inflatedDepth],
					calculatedCenterInPartLocal: [posX, posY, posZ],
					finalMeshPositionInPart: mesh.position.clone(),
				}
			);
		}

		return mesh;
	}
	/**
	 * Create a texture from base64 encoded data
	 */
	private async createTextureFromBase64(
		base64Data: string
	): Promise<THREE.Texture> {
		// Check cache first
		if (this.textureCache.has(base64Data.substring(0, 50))) {
			// biome-ignore lint/style/noNonNullAssertion: cache key check
			return this.textureCache.get(base64Data.substring(0, 50))!;
		}

		return new Promise((resolve, reject) => {
			const textureLoader = new THREE.TextureLoader();
			const dataUrl = `data:image/png;base64,${base64Data}`;

			textureLoader.load(
				dataUrl,
				(texture) => {
					// Configure texture
					texture.minFilter = THREE.NearestFilter;
					texture.magFilter = THREE.NearestFilter;
					texture.wrapS = THREE.RepeatWrapping;
					texture.wrapT = THREE.RepeatWrapping;
					texture.needsUpdate = true;

					// Cache using a prefix of the base64 string as key
					this.textureCache.set(base64Data.substring(0, 50), texture);

					resolve(texture);
				},
				undefined,
				(error) => {
					console.error("Error loading texture from base64:", error);
					reject(error);
				}
			);
		});
	}

	private addDebugHelpers(
		object: THREE.Object3D,
		color: number = 0xff0000
	): void {
		const axesHelper = new THREE.AxesHelper(0.5); // Length of axes lines
		object.add(axesHelper);

		const pivotGeometry = new THREE.SphereGeometry(0.05); // Size of pivot sphere
		const pivotMaterial = new THREE.MeshBasicMaterial({ color });
		const pivotSphere = new THREE.Mesh(pivotGeometry, pivotMaterial);
		object.add(pivotSphere); // Add to the object itself to mark its origin/pivot

		console.log(`Debug helpers added to ${object.name}:`, {
			position: object.position.clone(),
			rotation: object.rotation.clone(),
			worldPosition: new THREE.Vector3().setFromMatrixPosition(
				object.matrixWorld
			),
		});
	}

	private applyUVMapping(
		geometry: THREE.BoxGeometry,
		box: EntityModelBox,
		part: EntityModelPart,
		model: EntityModel
	): void {
		const [textureWidth, textureHeight] = model.textureSize || [64, 64];
		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;

		if (box.textureOffset) {
			const [u, v] = box.textureOffset;
			const width = box.coordinates[3];
			const height = box.coordinates[4];
			const depth = box.coordinates[5];

			if (this.debug) {
				console.log(`UV mapping for box in ${part.id || part.part}:`, {
					offset: [u, v],
					textureSize: [textureWidth, textureHeight],
					boxDimensions: [width, height, depth],
				});
			}

			const uvs = new Float32Array(6 * 4 * 2);
			let index = 0;
			const setFaceUVs = (u1: number, v1: number, u2: number, v2: number) => {
				const nu1 = u1 / textureWidth;
				const nv1 = v1 / textureHeight;
				const nu2 = u2 / textureWidth;
				const nv2 = v2 / textureHeight;
				uvs[index++] = nu1;
				uvs[index++] = nv2;
				uvs[index++] = nu2;
				uvs[index++] = nv2;
				uvs[index++] = nu1;
				uvs[index++] = nv1;
				uvs[index++] = nu2;
				uvs[index++] = nv1;
			};

			setFaceUVs(
				u + depth + width,
				v + depth,
				u + depth + width + depth,
				v + depth + height
			); // Right (+X)
			setFaceUVs(u, v + depth, u + depth, v + depth + height); // Left (-X)
			setFaceUVs(u + depth, v, u + depth + width, v + depth); // Top (+Y)
			setFaceUVs(
				u + depth,
				v + depth + height,
				u + depth + width,
				v + depth + height + depth
			); // Bottom (-Y)

			setFaceUVs(u + depth, v + depth, u + depth + width, v + depth + height); // Front (+Z)
			setFaceUVs(
				u + depth + width + depth,
				v + depth,
				u + depth + width + depth + width,
				v + depth + height
			); // Back (-Z)

			if (part.mirrorTexture) {
				this.applyMirrorTexture(uvs, part.mirrorTexture);
			}
			uvAttribute.set(uvs);
			uvAttribute.needsUpdate = true;
		} else if (
			box.uvDown ||
			box.uvUp ||
			box.uvNorth ||
			box.uvSouth ||
			box.uvWest ||
			box.uvEast
		) {
			this.applyPerFaceUVs(
				geometry,
				box,
				textureWidth,
				textureHeight,
				part.mirrorTexture
			);
		}
	}

	private applyPerFaceUVs(
		geometry: THREE.BoxGeometry,
		box: EntityModelBox,
		textureWidth: number,
		textureHeight: number,
		mirrorTexture?: string
	): void {
		const uvAttribute = geometry.attributes.uv as THREE.BufferAttribute;
		const allUVs: number[] = []; // Use number[] for easier push

		const normalizeUVs = (faceUVs?: number[]) => {
			if (!faceUVs || faceUVs.length !== 4) {
				// Default to full texture if not specified, or a small area to make it obvious
				return [0, 1, 1, 1, 0, 0, 1, 0]; // Vertex order: BL, BR, TL, TR
			}
			const [u1, v1, u2, v2] = faceUVs;
			// Three.js UV order for a face: (bottom-left), (bottom-right), (top-left), (top-right)
			// Input: u1,v1 (top-left of UV rect), u2,v2 (bottom-right of UV rect)
			return [
				u1 / textureWidth,
				v2 / textureHeight, // BL v
				u2 / textureWidth,
				v2 / textureHeight, // BR v
				u1 / textureWidth,
				v1 / textureHeight, // TL v
				u2 / textureWidth,
				v1 / textureHeight, // TR v
			];
		};

		allUVs.push(...normalizeUVs(box.uvEast)); // Right
		allUVs.push(...normalizeUVs(box.uvWest)); // Left
		allUVs.push(...normalizeUVs(box.uvUp)); // Top
		allUVs.push(...normalizeUVs(box.uvDown)); // Bottom
		allUVs.push(...normalizeUVs(box.uvSouth)); // Front
		allUVs.push(...normalizeUVs(box.uvNorth)); // Back

		if (mirrorTexture) {
			this.applyMirrorTexture(allUVs, mirrorTexture);
		}

		uvAttribute.set(allUVs);
		uvAttribute.needsUpdate = true;
	}

	private applyMirrorTexture(
		uvs: Float32Array | number[],
		mirrorTexture: string
	): void {
		const mirrorU = mirrorTexture.includes("u");
		const mirrorV = mirrorTexture.includes("v");

		if (!mirrorU && !mirrorV) return;

		for (let i = 0; i < uvs.length; i += 2) {
			if (mirrorU) {
				uvs[i] = 1.0 - uvs[i];
			}
			if (mirrorV) {
				uvs[i + 1] = 1.0 - uvs[i + 1];
			}
		}
	}

	private createPlaceholderMesh(): THREE.Mesh {
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
		);
	}
}
