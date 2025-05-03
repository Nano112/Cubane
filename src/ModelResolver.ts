import { AssetLoader, BlockStateDefinition, BlockModel } from "./AssetLoader";
import { Block } from "./BlockStateParser";

export interface BlockModelData {
	model: string;
	x?: number;
	y?: number;
	uvlock?: boolean;
}

export class ModelResolver {
	private assetLoader: AssetLoader;

	constructor(assetLoader: AssetLoader) {
		this.assetLoader = assetLoader;
	}

	public async resolveBlockModel(block: Block): Promise<BlockModelData[]> {
		// Get block state definition - REMOVE minecraft: prefix if present
		const blockName = block.name.replace("minecraft:", "");
		const blockStateDefinition = await this.assetLoader.getBlockState(
			blockName
		);

		// Log for debugging
		console.log(`Looking for blockstate: ${blockName}`);
		console.log("Block properties:", block.properties);
		console.log("Block state definition:", blockStateDefinition);

		// If no definition found, return a default cube model
		if (
			!blockStateDefinition ||
			(!blockStateDefinition.variants && !blockStateDefinition.multipart)
		) {
			console.warn(
				`No blockstate definition found for ${blockName}, using default cube`
			);
			return [{ model: "block/cube" }];
		}

		// Handle variants
		if (blockStateDefinition.variants) {
			return this.resolveVariants(block, blockStateDefinition);
		}

		// Handle multipart
		if (blockStateDefinition.multipart) {
			return this.resolveMultipart(block, blockStateDefinition);
		}

		// Default fallback
		return [{ model: "block/cube" }];
	}

	private async resolveVariants(
		block: Block,
		blockState: BlockStateDefinition
	): Promise<BlockModelData[]> {
		const variants = blockState.variants;
		if (!variants) return [{ model: "block/cube" }];

		// Find the matching variant
		let variantKey = "";

		// Handle empty variant (common for simple blocks like diamond_block)
		if (variants[""] !== undefined) {
			console.log("Found empty variant");
			variantKey = "";
		} else {
			// Build variant key from properties
			const propertyStrings: string[] = [];

			for (const [key, value] of Object.entries(block.properties)) {
				propertyStrings.push(`${key}=${value}`);
			}

			if (propertyStrings.length > 0) {
				// Sort for consistency
				variantKey = propertyStrings.sort().join(",");
			}

			// Log available variants for debugging
			console.log(`Looking for variant with key: "${variantKey}"`);
			console.log("Available variants:", Object.keys(variants));

			// If no exact match, try more flexible matching
			if (!variants[variantKey]) {
				// For single property blocks like logs, try just matching that property
				// For example, oak_log has axis=y, axis=x, etc.
				const singleProps = Object.entries(block.properties);
				if (singleProps.length === 1) {
					const [key, value] = singleProps[0];
					const simpleKey = `${key}=${value}`;
					console.log(`Trying simplified key: ${simpleKey}`);

					if (variants[simpleKey]) {
						variantKey = simpleKey;
					}
				}
			}
		}

		// Get the variant model
		const variant = variants[variantKey];
		if (!variant) {
			console.warn(
				`No variant found for ${block.name} with key "${variantKey}"`
			);

			// If no matching variant, try to use the first available variant
			const firstVariantKey = Object.keys(variants)[0];
			if (firstVariantKey) {
				console.log(
					`Falling back to first available variant: ${firstVariantKey}`
				);
				return this.processVariantModel(variants[firstVariantKey]);
			}

			return [{ model: "block/cube" }];
		}

		return this.processVariantModel(variant);
	}

	private processVariantModel(variant: any): BlockModelData[] {
		// Handle variant array (randomly selected models)
		if (Array.isArray(variant)) {
			// For simplicity, we'll just use the first one
			const selectedVariant = variant[0];
			return [
				{
					model: selectedVariant.model,
					x: selectedVariant.x,
					y: selectedVariant.y,
					uvlock: selectedVariant.uvlock,
				},
			];
		}

		// Handle single variant
		return [
			{
				model: variant.model,
				x: variant.x,
				y: variant.y,
				uvlock: variant.uvlock,
			},
		];
	}

	private async resolveMultipart(
		block: Block,
		blockState: BlockStateDefinition
	): Promise<BlockModelData[]> {
		const multipart = blockState.multipart;
		if (!multipart) return [{ model: "block/cube" }];

		const models: BlockModelData[] = [];

		// Check each multipart entry
		for (const part of multipart) {
			let applies = true;

			// Check conditions
			if (part.when) {
				if ("OR" in part.when) {
					// OR condition - any of the subconditions must match
					applies = false;
					for (const subCondition of part.when.OR) {
						if (this.matchesCondition(block, subCondition)) {
							applies = true;
							break;
						}
					}
				} else {
					// AND condition - all properties must match
					applies = this.matchesCondition(block, part.when);
				}
			}

			// If conditions met, add the model
			if (applies) {
				if (Array.isArray(part.apply)) {
					// Multiple models, take the first for simplicity
					const model = part.apply[0];
					models.push({
						model: model.model,
						x: model.x,
						y: model.y,
						uvlock: model.uvlock,
					});
				} else {
					// Single model
					models.push({
						model: part.apply.model,
						x: part.apply.x,
						y: part.apply.y,
						uvlock: part.apply.uvlock,
					});
				}
			}
		}

		// If no models resolved, use a default
		if (models.length === 0) {
			return [{ model: "block/cube" }];
		}

		return models;
	}

	private matchesCondition(
		block: Block,
		condition: Record<string, string>
	): boolean {
		for (const [property, value] of Object.entries(condition)) {
			const blockValue = block.properties[property];

			// If property doesn't exist, no match
			if (blockValue === undefined) {
				return false;
			}

			// Handle OR within a property (value1|value2|value3)
			if (value.includes("|")) {
				const values = value.split("|");
				if (!values.includes(blockValue)) {
					return false;
				}
			} else {
				// Simple equality
				if (blockValue !== value) {
					return false;
				}
			}
		}

		return true;
	}
}
