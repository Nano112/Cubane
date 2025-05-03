import * as THREE from "three";
import { AssetLoader, BlockModel, BlockModelElement } from "./AssetLoader";

export class MeshBuilder {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	public async createBlockMesh(
		model: BlockModel,
		transform: { x?: number; y?: number; uvlock?: boolean } = {}
	): Promise<THREE.Mesh> {
		console.log("Creating mesh for model:", model);

		// If no elements, return an empty mesh
		if (!model.elements || model.elements.length === 0) {
			console.warn("Model has no elements");
			return new THREE.Mesh(
				new THREE.BoxGeometry(0, 0, 0),
				new THREE.MeshBasicMaterial()
			);
		}

		// Create a group to hold element meshes
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

		// If the group is empty, return empty mesh
		if (group.children.length === 0) {
			console.warn("No valid elements in model");
			return new THREE.Mesh(
				new THREE.BoxGeometry(0, 0, 0),
				new THREE.MeshBasicMaterial()
			);
		}

		// If only one child, return it directly
		if (
			group.children.length === 1 &&
			group.children[0] instanceof THREE.Mesh
		) {
			return group.children[0] as THREE.Mesh;
		}

		// Otherwise create a single mesh from all elements
		return this.combineGroupToMesh(group);
	}

	private async createElementMesh(
		element: BlockModelElement,
		model: BlockModel
	): Promise<THREE.Object3D> {
		// Default values
		const from = element.from || [0, 0, 0];
		const to = element.to || [16, 16, 16];

		// Calculate size in block units (1 block = 1 unit)
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

		// Create a group for this element
		const elementGroup = new THREE.Group();
		elementGroup.position.set(center[0], center[1], center[2]);

		// Process each face (if available)
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
				if (!faceData) continue; // Skip undefined faces

				// Create mesh for this face
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
			// Create rotation group
			const rotationGroup = new THREE.Group();

			// Calculate origin in block units
			const origin = [
				element.rotation.origin[0] / 16 - 0.5,
				element.rotation.origin[1] / 16 - 0.5,
				element.rotation.origin[2] / 16 - 0.5,
			];

			// Position rotation group at origin
			rotationGroup.position.set(origin[0], origin[1], origin[2]);

			// Add element group at position relative to origin
			elementGroup.position.set(
				center[0] - origin[0],
				center[1] - origin[1],
				center[2] - origin[2]
			);

			rotationGroup.add(elementGroup);

			// Apply rotation
			const angleRad = (element.rotation.angle * Math.PI) / 180;
			switch (element.rotation.axis) {
				case "x":
					rotationGroup.rotateX(angleRad);
					break;
				case "y":
					rotationGroup.rotateY(angleRad);
					break;
				case "z":
					rotationGroup.rotateZ(angleRad);
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
		// Create geometry based on direction and size
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

		// Apply UV mapping if specified
		if (faceData.uv) {
			const [u1, v1, u2, v2] = faceData.uv;
			const uvs = geometry.attributes.uv as THREE.BufferAttribute;

			// Scale UVs to 0-1 range (Minecraft uses 0-16)
			const uvArray = [
				u1 / 16,
				1 - v2 / 16,
				u2 / 16,
				1 - v2 / 16,
				u1 / 16,
				1 - v1 / 16,
				u2 / 16,
				1 - v1 / 16,
			];

			uvs.set(uvArray);
			uvs.needsUpdate = true;
		}

		// Get texture path
		const texturePath = this.assetLoader.resolveTexture(
			faceData.texture,
			model
		);
		console.log(`Face ${direction} using texture: ${texturePath}`);

		// Create material
		let material: THREE.Material;
		try {
			// Determine if texture should be transparent
			const isTransparent =
				texturePath.includes("glass") ||
				texturePath.includes("leaves") ||
				texturePath.includes("water");

			// Get texture
			const texture = await this.assetLoader.getTexture(texturePath);

			// Apply texture rotation if specified
			if (faceData.rotation) {
				texture.center.set(0.5, 0.5);
				texture.rotation = (faceData.rotation * Math.PI) / 180;
				texture.needsUpdate = true;
			}

			// Create material
			material = new THREE.MeshStandardMaterial({
				map: texture,
				transparent: isTransparent,
				side: THREE.DoubleSide,
				alphaTest: 0.5,
			});
		} catch (error) {
			console.warn(`Error loading texture ${texturePath}:`, error);

			// Fallback material
			material = new THREE.MeshStandardMaterial({
				color: 0xff00ff,
				wireframe: true,
			});
		}

		// Create mesh
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(...position);

		return mesh;
	}

	private combineGroupToMesh(group: THREE.Group): THREE.Mesh {
		// For simplicity in this implementation, we'll just return the first mesh
		// In a full implementation, you'd merge all meshes into one
		for (const child of group.children) {
			if (child instanceof THREE.Mesh) {
				return child.clone();
			}
		}

		// Fallback if no meshes found
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ color: 0xff00ff, wireframe: true })
		);
	}

	private async createElement(
		element: BlockModelElement,
		model: BlockModel
	): Promise<THREE.Group> {
		// Calculate dimensions
		const size = [
			(element.to[0] - element.from[0]) / 16,
			(element.to[1] - element.from[1]) / 16,
			(element.to[2] - element.from[2]) / 16,
		];

		// Calculate center position
		const position = [
			(element.from[0] + element.to[0]) / 32,
			(element.from[1] + element.to[1]) / 32,
			(element.from[2] + element.to[2]) / 32,
		];

		// Create box geometry
		const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);

		// Group to hold the element and apply transformations
		const group = new THREE.Group();

		// Create faces for each direction
		const faceDirections = [
			"down",
			"up",
			"north",
			"south",
			"west",
			"east",
		] as const;
		const faceNormals = [
			[0, -1, 0],
			[0, 1, 0],
			[0, 0, -1],
			[0, 0, 1],
			[-1, 0, 0],
			[1, 0, 0],
		];

		for (let i = 0; i < faceDirections.length; i++) {
			const face = faceDirections[i];
			const faceData = element.faces?.[face];

			if (!faceData) continue;

			// Resolve texture for this face
			const texturePath = this.assetLoader.resolveTexture(
				faceData.texture,
				model
			);

			// Create material
			const isTransparent =
				texturePath.includes("glass") || texturePath.includes("water");
			const material = await this.assetLoader.getMaterial(texturePath, {
				transparent: isTransparent,
			});

			// Create a mesh for this face
			const facePlane = this.createFacePlane(face, size, faceData.rotation);
			facePlane.material = material;

			// Add to the group
			group.add(facePlane);
		}

		// Apply position
		group.position.set(position[0] - 0.5, position[1] - 0.5, position[2] - 0.5);

		// Apply rotation if specified
		if (element.rotation) {
			const origin = [
				element.rotation.origin[0] / 16 - 0.5,
				element.rotation.origin[1] / 16 - 0.5,
				element.rotation.origin[2] / 16 - 0.5,
			];

			// Set the rotation origin
			group.position.set(origin[0], origin[1], origin[2]);

			// Apply rotation
			const angle = (element.rotation.angle * Math.PI) / 180;
			switch (element.rotation.axis) {
				case "x":
					group.rotation.x = angle;
					break;
				case "y":
					group.rotation.y = angle;
					break;
				case "z":
					group.rotation.z = angle;
					break;
			}
		}

		return group;
	}

	private createFacePlane(
		face: string,
		size: number[],
		rotation?: number
	): THREE.Mesh {
		// Create a plane geometry for the face
		let planeGeometry: THREE.PlaneGeometry;
		let position: [number, number, number] = [0, 0, 0];

		switch (face) {
			case "down":
				planeGeometry = new THREE.PlaneGeometry(size[0], size[2]);
				planeGeometry.rotateX(-Math.PI / 2);
				position = [0, -size[1] / 2, 0];
				break;
			case "up":
				planeGeometry = new THREE.PlaneGeometry(size[0], size[2]);
				planeGeometry.rotateX(Math.PI / 2);
				position = [0, size[1] / 2, 0];
				break;
			case "north":
				planeGeometry = new THREE.PlaneGeometry(size[0], size[1]);
				planeGeometry.rotateY(Math.PI);
				position = [0, 0, -size[2] / 2];
				break;
			case "south":
				planeGeometry = new THREE.PlaneGeometry(size[0], size[1]);
				position = [0, 0, size[2] / 2];
				break;
			case "west":
				planeGeometry = new THREE.PlaneGeometry(size[2], size[1]);
				planeGeometry.rotateY(-Math.PI / 2);
				position = [-size[0] / 2, 0, 0];
				break;
			case "east":
				planeGeometry = new THREE.PlaneGeometry(size[2], size[1]);
				planeGeometry.rotateY(Math.PI / 2);
				position = [size[0] / 2, 0, 0];
				break;
			default:
				planeGeometry = new THREE.PlaneGeometry(1, 1);
		}

		// Apply texture rotation if specified
		if (rotation) {
			// TODO: Implement proper texture rotation by modifying UVs
		}

		// Create mesh with placeholder material (will be replaced later)
		const mesh = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial());

		// Apply position
		mesh.position.set(position[0], position[1], position[2]);

		return mesh;
	}

	private mergeGroupGeometry(group: THREE.Group): THREE.BufferGeometry {
		// Create arrays to hold all vertices, normals, uvs, etc.
		const geometries: THREE.BufferGeometry[] = [];

		// Collect geometries
		group.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				// Clone the geometry and apply the mesh's transform
				const geometry = child.geometry.clone();
				geometry.applyMatrix4(child.matrixWorld);
				geometries.push(geometry);
			}
		});

		// Merge the geometries
		const mergedGeometry =
			BufferGeometryUtils.mergeBufferGeometries(geometries);
		return mergedGeometry;
	}

	private extractMaterials(group: THREE.Group): THREE.Material[] {
		const materials: THREE.Material[] = [];

		// Collect materials
		group.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				if (
					child.material instanceof THREE.Material &&
					!materials.includes(child.material)
				) {
					materials.push(child.material);
				}
			}
		});

		return materials;
	}
}

// Utility class for merging geometries (simplified version)
class BufferGeometryUtils {
	static mergeBufferGeometries(
		geometries: THREE.BufferGeometry[]
	): THREE.BufferGeometry {
		// If only one geometry, return it
		if (geometries.length === 1) return geometries[0];
		if (geometries.length === 0) return new THREE.BufferGeometry();

		// Create a new geometry
		const mergedGeometry = new THREE.BufferGeometry();

		// Calculate total sizes
		let vertexCount = 0;
		let indexCount = 0;

		geometries.forEach((geometry) => {
			vertexCount += geometry.getAttribute("position").count;
			if (geometry.index) {
				indexCount += geometry.index.count;
			} else {
				indexCount += geometry.getAttribute("position").count;
			}
		});

		// Create merged attributes
		const positionArray = new Float32Array(vertexCount * 3);
		const normalArray = new Float32Array(vertexCount * 3);
		const uvArray = new Float32Array(vertexCount * 2);
		const indexArray = new Uint32Array(indexCount);

		// Copy data
		let positionOffset = 0;
		let normalOffset = 0;
		let uvOffset = 0;
		let indexOffset = 0;
		let indexBase = 0;

		geometries.forEach((geometry) => {
			// Copy positions
			const positions = geometry.getAttribute("position").array;
			positionArray.set(positions, positionOffset);
			positionOffset += positions.length;

			// Copy normals
			const normals = geometry.getAttribute("normal").array;
			normalArray.set(normals, normalOffset);
			normalOffset += normals.length;

			// Copy UVs if present
			if (geometry.getAttribute("uv")) {
				const uvs = geometry.getAttribute("uv").array;
				uvArray.set(uvs, uvOffset);
				uvOffset += uvs.length;
			}

			// Copy indices
			if (geometry.index) {
				const indices = geometry.index.array;
				for (let i = 0; i < indices.length; i++) {
					indexArray[indexOffset++] = indices[i] + indexBase;
				}
			} else {
				// Generate indices if not present
				const count = geometry.getAttribute("position").count;
				for (let i = 0; i < count; i++) {
					indexArray[indexOffset++] = i + indexBase;
				}
			}

			// Update index base
			indexBase += geometry.getAttribute("position").count;
		});

		// Set attributes
		mergedGeometry.setAttribute(
			"position",
			new THREE.BufferAttribute(positionArray, 3)
		);
		mergedGeometry.setAttribute(
			"normal",
			new THREE.BufferAttribute(normalArray, 3)
		);
		mergedGeometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
		mergedGeometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

		return mergedGeometry;
	}
}
