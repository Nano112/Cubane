import { AssetLoader } from "./AssetLoader";
import { ModelData, Block, BlockStateDefinitionVariant } from "./types";

export class ModelResolver {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	/**
	 * Resolve a block to its models
	 */
	public async resolveBlockModel(block: Block): Promise<ModelData[]> {
		// Special handling for liquids - use the minimal model files that exist
		if (
			block.name === "water" ||
			block.name === "flowing_water" ||
			block.name === "lava" ||
			block.name === "flowing_lava"
		) {
			console.log(`Handling special liquid block: ${block.name}`);
			return this.createLiquidModelData(block);
		}

		// Regular block state handling
		const blockName = block.name.replace("minecraft:", "");
		const blockStateDefinition = await this.assetLoader.getBlockState(
			blockName
		);

		console.log(
			`Resolving models for block ${blockName}`,
			blockStateDefinition
		);

		// If no definition, return empty array
		if (
			!blockStateDefinition ||
			(!blockStateDefinition.variants && !blockStateDefinition.multipart)
		) {
			console.warn(`No blockstate definition found for ${blockName}`);
			return [];
		}

		const models: ModelData[] = [];

		// Handle variants
		if (blockStateDefinition.variants) {
			// Get properties that are used in variants
			const variantKeys = Object.keys(blockStateDefinition.variants);
			const validVariantProperties = new Set<string>();

			// Extract property names from variant keys
			for (const key of variantKeys) {
				if (key === "") continue; // Skip empty key

				const parts = key.split(",");
				for (const part of parts) {
					const propertyName = part.split("=")[0];
					validVariantProperties.add(propertyName);
				}
			}

			// Build variant key from block properties
			let variantKey = "";
			if (Object.keys(block.properties).length > 0) {
				// Only include properties that are part of the variants
				const filteredProps = Object.entries(block.properties)
					.filter(([key]) => validVariantProperties.has(key))
					.map(([key, value]) => `${key}=${value}`);

				// Sort for consistency and join with commas
				variantKey = filteredProps.sort().join(",");
			}

			console.log(`Looking for variant: "${variantKey}"`);

			// Try to find the variant with multiple approaches
			let variant;

			// First approach: exact match with our properties
			if (blockStateDefinition.variants[variantKey]) {
				variant = blockStateDefinition.variants[variantKey];
			}

			// Second approach: If not found and using empty variant
			else if (!variant && blockStateDefinition.variants[""]) {
				console.log(`Variant "${variantKey}" not found, using default variant`);
				variant = blockStateDefinition.variants[""];
			}

			// Third approach: Find the best matching variant
			else if (!variant) {
				// Get all property keys we're looking for
				const targetProps = Object.entries(block.properties);

				// Find variants that match ALL our requested properties
				// (they might have additional properties we didn't specify)
				let bestVariantKey = "";
				let bestMatchCount = -1;

				for (const key of Object.keys(blockStateDefinition.variants)) {
					// Skip empty key
					if (key === "") continue;

					const variantProps = key.split(",").map((prop) => {
						const [name, value] = prop.split("=");
						return { name, value };
					});

					// Count how many of our target properties match this variant
					let matchCount = 0;
					let allMatch = true;

					for (const [propName, propValue] of targetProps) {
						const matchingProp = variantProps.find((p) => p.name === propName);
						if (matchingProp && matchingProp.value === propValue) {
							matchCount++;
						} else if (matchingProp) {
							// Property exists but with wrong value
							allMatch = false;
							break;
						}
					}

					// If all properties match and we found more matches than before,
					// update the best match
					if (allMatch && matchCount > bestMatchCount) {
						bestMatchCount = matchCount;
						bestVariantKey = key;
					}
				}

				// If we found a matching variant, use it
				if (bestVariantKey) {
					console.log(
						`Found best matching variant: ${bestVariantKey} for requested ${variantKey}`
					);
					variant = blockStateDefinition.variants[bestVariantKey];
				}

				// Fourth approach: try single property variants
				if (!variant && Object.keys(block.properties).length > 0) {
					// For blocks like logs with only axis property
					for (const [key, value] of Object.entries(block.properties)) {
						const singlePropKey = `${key}=${value}`;
						if (blockStateDefinition.variants[singlePropKey]) {
							console.log(`Using single property variant: ${singlePropKey}`);
							variant = blockStateDefinition.variants[singlePropKey];
							break;
						}
					}
				}

				// Fifth approach: use first available variant
				if (!variant && variantKeys.length > 0) {
					const firstKey = variantKeys[0];
					console.log(
						`No matching variant found, using first available: ${firstKey}`
					);
					variant = blockStateDefinition.variants[firstKey];
				}
			}

			// Add the variant model(s) if found
			if (variant) {
				if (Array.isArray(variant)) {
					// Multiple models with weights, just use the first one for simplicity
					models.push(this.createModelData(variant[0]));
				} else {
					models.push(this.createModelData(variant));
				}
			}
		}

		// Handle multipart models
		if (blockStateDefinition.multipart) {
			for (const part of blockStateDefinition.multipart) {
				let applies = true;

				// Check conditions
				if (part.when) {
					if ("OR" in part.when) {
						// OR condition - any of the conditions can match
						applies = false;
						for (const condition of part.when.OR as BlockStateDefinitionVariant<string>[]) {
							if (this.matchesCondition(block, condition as Record<string, string>)) {
								applies = true;
								break;
							}
						}
					} else {
						// AND condition - all conditions must match
						applies = this.matchesCondition(block, part.when);
					}
				}

				// If conditions are met, add the model(s)
				if (applies) {
					if (Array.isArray(part.apply)) {
						// Multiple models, just use the first one for simplicity
						models.push(this.createModelData(part.apply[0]));
					} else {
						models.push(this.createModelData(part.apply));
					}
				}
			}
		}

		return models;
	}

	private createLiquidModelData(block: Block): ModelData[] {
		const isWater = block.name.includes("water");

		// Get level property - defaults to 0 (full block) if not specified
		const levelStr = block.properties?.level;
		const level = levelStr ? parseInt(levelStr, 10) : 0;

		// Calculate level information
		// const _isFullBlock = level === 0; // Not used currently

		// Create a model path that encodes the level information
		const modelPath = isWater
			? level === 0
				? "block/water"
				: `block/water_level_${level}`
			: level === 0
			? "block/lava"
			: `block/lava_level_${level}`;

		console.log(`Creating liquid model: ${modelPath} with level ${level}`);

		return [
			{
				model: modelPath,
				x: 0,
				y: 0,
				uvlock: false,
			},
		];
	}

	private createModelData(modelHolder: any): ModelData {
		return {
			model: modelHolder.model,
			x: modelHolder.x,
			y: modelHolder.y,
			uvlock: modelHolder.uvlock,
		};
	}

	private matchesCondition(
		block: Block,
		condition: Record<string, string>
	): boolean {
		for (const [property, value] of Object.entries(condition)) {
			const blockValue = block.properties[property];

			// If property not found, condition fails
			if (blockValue === undefined) {
				return false;
			}

			// Check for OR value (pipe separated)
			if (value.includes("|")) {
				const values = value.split("|");
				if (!values.includes(blockValue)) {
					return false;
				}
			} else if (blockValue !== value) {
				// Simple equality check
				return false;
			}
		}

		return true;
	}
}