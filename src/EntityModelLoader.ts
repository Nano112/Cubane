import modelData from "./minecraft_entities.json";
import { EntityModelPart, EntityModelBox, EntityModel } from "./types";

export class EntityModelLoader {
	private modelCache: Map<string, EntityModel> = new Map();
	private entities: any[] = [];
	private entityModels: Record<string, any> = {};
	private entityTextures: Record<string, string> = {};

	constructor() {
		// Parse the full JSON structure
		this.entities = modelData.entities || [];
		this.entityModels = modelData.entity_models || {};
		this.entityTextures = modelData.entity_textures || {};

		console.log(`Loaded ${this.entities.length} entities`);
		console.log(
			`Loaded ${Object.keys(this.entityModels).length} entity models`
		);
		console.log(
			`Loaded ${Object.keys(this.entityTextures).length} entity textures`
		);
	}

	/**
	 * Find entity info by name
	 */
	public getEntityInfo(entityName: string): any {
		// Look for the entity in the entities array
		const entity = this.entities.find((e) => e.name === entityName);
		if (!entity) {
			console.warn(`Entity not found: ${entityName}`);
			return null;
		}
		return entity;
	}

	/**
	 * Get the entity model for the given entity name
	 */
	public getEntityModel(entityName: string): EntityModel | null {
		// Check cache first
		if (this.modelCache.has(entityName)) {
			return this.modelCache.get(entityName);
		}

		// Get entity info to find the model name
		const entityInfo = this.getEntityInfo(entityName);
		if (!entityInfo) return null;

		// Get the model name from the entity info
		const modelName = entityInfo.model;

		// Get the model data
		const modelData = this.entityModels[modelName];
		if (!modelData) {
			console.warn(
				`Model not found for entity ${entityName} (model: ${modelName})`
			);
			return null;
		}

		// Cache and return the model
		this.modelCache.set(entityName, modelData);
		return modelData;
	}

	/**
	 * Get the texture data for the given entity name
	 */
	public getEntityTexture(entityName: string): string | null {
		// Get entity info to find the texture name
		const entityInfo = this.getEntityInfo(entityName);
		if (!entityInfo) return null;

		// First try the entity name directly (most common case)
		if (this.entityTextures[entityName]) {
			return this.entityTextures[entityName];
		}

		// Otherwise, look up by the texture name in the entity info
		const textureName = entityInfo.texture;

		const textureData =
			this.entityTextures[textureName] || this.entityTextures[entityName];

		if (!textureData) {
			console.warn(
				`Texture not found for entity ${entityName} (texture: ${textureName})`
			);
			return null;
		}

		return textureData;
	}

	/**
	 * Get both model and texture for an entity
	 */
	public getEntityData(entityName: string): {
		model: EntityModel | null;
		texture: string | null;
	} {
		return {
			model: this.getEntityModel(entityName),
			texture: this.getEntityTexture(entityName),
		};
	}
}
