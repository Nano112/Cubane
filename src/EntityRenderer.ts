import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { EntityModel, EntityModelPart, EntityModelBox } from "./types"; // Assuming these types are defined in a separate file
import { EntityModelLoader } from "./EntityModelLoader"; // Assuming this is the correct path

export class EntityRenderer {
	private assetLoader: AssetLoader;
	private entityModelLoader: EntityModelLoader;

	constructor(assetLoader: AssetLoader, entityModelLoader: EntityModelLoader) {
		this.assetLoader = assetLoader;
		this.entityModelLoader = entityModelLoader;
	}

	public async createEntityMesh(entityName: string): Promise<THREE.Object3D> {
		// Get the model
		const model = await this.entityModelLoader.getEntityModel(entityName);
		if (!model) {
			console.warn(`No model found for entity: ${entityName}`);
			return this.createPlaceholderMesh();
		}

		// Load texture
		const texture = await this.assetLoader.getEntityTexture(entityName);

		// Create a group for the entire entity
		const entityGroup = new THREE.Group();
		entityGroup.name = entityName;

		// Process each model part
		for (const part of model.models) {
			const partMesh = await this.createModelPart(part, model, texture);
			entityGroup.add(partMesh);
		}

		return entityGroup;
	}

	private async createModelPart(
		part: EntityModelPart,
		model: EntityModel,
		texture: THREE.Texture
	): Promise<THREE.Object3D> {
		// Create part group
		const partGroup = new THREE.Group();
		partGroup.name = part.id || part.part || "unnamed_part";

		// Apply translation (pivot point)
		if (part.translate) {
			let [tx, ty, tz] = part.translate;

			// Handle axis inversion
			if (part.invertAxis) {
				if (part.invertAxis.includes("x")) tx = -tx;
				if (part.invertAxis.includes("y")) ty = -ty;
				if (part.invertAxis.includes("z")) tz = -tz;
			}

			partGroup.position.set(tx / 16, ty / 16, tz / 16); // Convert to Three.js units
		}

		// Apply base rotation
		if (part.rotate) {
			let [rx, ry, rz] = part.rotate;

			// Convert to radians
			rx = (rx * Math.PI) / 180;
			ry = (ry * Math.PI) / 180;
			rz = (rz * Math.PI) / 180;

			// Handle axis inversion
			if (part.invertAxis) {
				if (part.invertAxis.includes("x")) rx = -rx;
				if (part.invertAxis.includes("y")) ry = -ry;
				if (part.invertAxis.includes("z")) rz = -rz;
			}

			partGroup.rotation.set(rx, ry, rz);
		}

		// Create boxes (cuboids)
		if (part.boxes) {
			for (const box of part.boxes) {
				const cubeMesh = this.createBoxMesh(box, part, model, texture);
				partGroup.add(cubeMesh);
			}
		}

		// Process submodels recursively
		if (part.submodels) {
			for (const submodel of part.submodels) {
				const submodelMesh = await this.createModelPart(
					submodel,
					model,
					texture
				);
				partGroup.add(submodelMesh);
			}
		}

		return partGroup;
	}

	private createBoxMesh(
		box: EntityModelBox,
		part: EntityModelPart,
		model: EntityModel,
		texture: THREE.Texture
	): THREE.Mesh {
		// Extract coordinates and size
		const [ox, oy, oz, width, height, depth] = box.coordinates;

		// Apply size inflation if specified
		const sizeAdd = box.sizeAdd || 0;
		const inflatedWidth = width + sizeAdd * 2;
		const inflatedHeight = height + sizeAdd * 2;
		const inflatedDepth = depth + sizeAdd * 2;

		// Account for position adjustment due to inflation
		let adjustedX = ox - sizeAdd;
		let adjustedY = oy - sizeAdd;
		let adjustedZ = oz - sizeAdd;

		// Handle axis inversion for position
		if (part.invertAxis) {
			if (part.invertAxis.includes("x")) adjustedX = -adjustedX - inflatedWidth;
			if (part.invertAxis.includes("y"))
				adjustedY = -adjustedY - inflatedHeight;
			if (part.invertAxis.includes("z")) adjustedZ = -adjustedZ - inflatedDepth;
		}

		// Create geometry
		const geometry = new THREE.BoxGeometry(
			inflatedWidth / 16,
			inflatedHeight / 16,
			inflatedDepth / 16
		);

		// Position the box correctly relative to the part's pivot
		geometry.translate(
			(adjustedX + inflatedWidth / 2) / 16,
			(adjustedY + inflatedHeight / 2) / 16,
			(adjustedZ + inflatedDepth / 2) / 16
		);

		// Set up UV mapping
		this.applyUVMapping(geometry, box, part, model);

		// Create material
		const material = new THREE.MeshStandardMaterial({
			map: texture,
			transparent: true,
			alphaTest: 0.5,
		});

		// Create and return mesh
		return new THREE.Mesh(geometry, material);
	}

	private applyUVMapping(
		geometry: THREE.BoxGeometry,
		box: EntityModelBox,
		part: EntityModelPart,
		model: EntityModel
	): void {
		// Extract texture size
		const [textureWidth, textureHeight] = model.textureSize;

		// Get UV coordinates from box
		if (box.textureOffset) {
			const [u, v] = box.textureOffset;
			const [width, height, depth] = [
				box.coordinates[3],
				box.coordinates[4],
				box.coordinates[5],
			];

			// Apply standard Minecraft UV mapping pattern
			// This is complex - would implement the full UV mapping here
			// For brevity, this is simplified
		} else if (
			box.uvDown &&
			box.uvUp &&
			box.uvNorth &&
			box.uvSouth &&
			box.uvWest &&
			box.uvEast
		) {
			// Apply per-face UV mapping
			// Would implement custom UV mapping per face
		}

		// Handle mirror texture if specified
		if (part.mirrorTexture) {
			// Apply texture mirroring
		}
	}

	private createPlaceholderMesh(): THREE.Mesh {
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
		);
	}
}
