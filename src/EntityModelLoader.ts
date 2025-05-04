import modelData from "./combined_models.json";
import { EntityModelPart, EntityModelBox, EntityModel } from "./types";

export class EntityModelLoader {
	private modelCache: Map<string, EntityModel> = new Map();
	private modelsJson: Record<string, { model: string }>;

	constructor() {
		this.modelsJson = modelData.models || modelData;
		console.log(`Loaded ${Object.keys(this.modelsJson).length} entity models`);
	}

	public getEntityModel(entityName: string): EntityModel | null {
		// Check cache first
		if (this.modelCache.has(entityName)) {
			return this.modelCache.get(entityName);
		}

		// Get from combined JSON
		if (!this.modelsJson[entityName]) {
			console.warn(`Entity model not found: ${entityName}`);
			return null;
		}

		try {
			// Parse the model string back to an object
			const modelData = JSON.parse(
				this.modelsJson[entityName].model
			) as EntityModel;
			this.modelCache.set(entityName, modelData);
			return modelData;
		} catch (error) {
			console.error(`Error parsing entity model ${entityName}:`, error);
			return null;
		}
	}
}
