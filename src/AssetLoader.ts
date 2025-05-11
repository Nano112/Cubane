import * as THREE from "three";
import JSZip from "jszip";
import { AnimatedTextureManager } from "./AnimatedTextureManager";
import { TintManager } from "./TintManager";
import { BlockModel, BlockStateDefinition } from "./types";

const isBrowser = typeof window !== "undefined";
function isBufferLike(obj: any): boolean {
	return (
		obj !== null &&
		typeof obj === "object" &&
		obj.constructor &&
		typeof obj.constructor.name === "string" &&
		obj.constructor.name === "Buffer" &&
		typeof obj.length === "number"
	);
}
export class AssetLoader {
	private resourcePacks: Map<string, JSZip> = new Map();
	private resourcePackOrder: string[] = [];
	private animatedTextureManager: AnimatedTextureManager;
	private tintManager: TintManager;

	// Caches
	private stringCache: Map<string, string> = new Map();
	private blockStateCache: Map<string, BlockStateDefinition> = new Map();
	private modelCache: Map<string, BlockModel> = new Map();
	private textureCache: Map<string, THREE.Texture> = new Map();
	private materialCache: Map<string, THREE.Material> = new Map();

	// Texture loader
	private textureLoader = new THREE.TextureLoader();

	constructor() {
		this.animatedTextureManager = new AnimatedTextureManager(this);
		this.tintManager = new TintManager();
		console.log("AssetLoader initialized");
	}

	public async loadResourcePack(
		input: Blob | ArrayBuffer | Uint8Array | any
	): Promise<void> {
		try {
			console.log("Loading resource pack...");
			let zipInput;

			// Handle different input types based on environment
			if (input instanceof Blob) {
				zipInput = input;
			} else if (isBufferLike(input)) {
				// For Node.js Buffer
				zipInput = input;
			} else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
				// For ArrayBuffer or typed arrays
				zipInput = input;
			} else {
				throw new Error("Unsupported input type for resource pack");
			}

			const zip = await JSZip.loadAsync(zipInput);

			// Rest of method remains the same...
		} catch (error) {
			console.error("Failed to load resource pack:", error);
			throw error;
		}
	}

	/**
	 * Get a string resource (JSON files, etc.)
	 */
	public async getResourceString(path: string): Promise<string | undefined> {
		// Check cache first
		const cacheKey = `string:${path}`;
		if (this.stringCache.has(cacheKey)) {
			return this.stringCache.get(cacheKey);
		}

		// Try each resource pack in order of priority
		for (const packId of this.resourcePackOrder) {
			const zip = this.resourcePacks.get(packId);
			if (!zip) continue;

			const file = zip.file(`assets/minecraft/${path}`);
			if (file) {
				try {
					const content = await file.async("string");
					this.stringCache.set(cacheKey, content);
					return content;
				} catch (error) {
					console.warn(`Error reading ${path} from pack ${packId}:`, error);
				}
			}
		}

		console.warn(`Resource not found: ${path}`);
		return undefined;
	}

	/**
	 * Get a binary resource (textures, etc.)
	 */
	public async getResourceBlob(path: string): Promise<Blob | undefined> {
		// Try each resource pack in order of priority
		for (const packId of this.resourcePackOrder) {
			const zip = this.resourcePacks.get(packId);
			if (!zip) continue;

			const file = zip.file(`assets/minecraft/${path}`);
			if (file) {
				try {
					return await file.async("blob");
				} catch (error) {
					console.warn(`Error reading ${path} from pack ${packId}:`, error);
				}
			}
		}

		console.warn(`Resource not found: ${path}`);
		return undefined;
	}

	/**
	 * Get a block state definition
	 */
	public async getBlockState(blockId: string): Promise<BlockStateDefinition> {
		// Remove minecraft: prefix if present
		blockId = blockId.replace("minecraft:", "");

		// Check cache first
		const cacheKey = `blockstate:${blockId}`;
		if (this.blockStateCache.has(cacheKey)) {
			return this.blockStateCache.get(cacheKey)!;
		}

		console.log(`Loading blockstate for ${blockId}`);

		// Load from resource pack
		const jsonString = await this.getResourceString(
			`blockstates/${blockId}.json`
		);
		if (!jsonString) {
			console.warn(`Block state definition for ${blockId} not found.`);
			return {} as BlockStateDefinition;
		}

		try {
			const blockStateDefinition = JSON.parse(
				jsonString
			) as BlockStateDefinition;
			this.blockStateCache.set(cacheKey, blockStateDefinition);
			return blockStateDefinition;
		} catch (error) {
			console.error(`Error parsing blockstate for ${blockId}:`, error);
			return {} as BlockStateDefinition;
		}
	}

	public async getModel(modelPath: string): Promise<BlockModel> {
		// Remove minecraft: prefix if present
		modelPath = modelPath.replace("minecraft:", "");

		// Check cache first
		const cacheKey = `model:${modelPath}`;
		if (this.modelCache.has(cacheKey)) {
			return this.modelCache.get(cacheKey)!;
		}

		console.log(`Loading model: ${modelPath}`);

		// Special handling for liquid models with level information
		if (
			modelPath.startsWith("block/water") ||
			modelPath.startsWith("block/lava")
		) {
			const isWater = modelPath.startsWith("block/water");

			// Extract level from model path if present
			let level = 0;
			const levelMatch = modelPath.match(/_level_(\d+)/);
			if (levelMatch) {
				level = parseInt(levelMatch[1], 10);
				console.log(
					`Detected liquid level ${level} from model path: ${modelPath}`
				);
			}

			// Calculate liquid height based on level
			// In Minecraft:
			// Level 0 = full/source block
			// Level 1-7 = progressively lower flowing blocks
			const liquidHeight = level === 0 ? 16 : 16 - level * 2;

			// Special case: water source blocks are 14px high, not 16px
			const actualHeight = isWater && level === 0 ? 14 : liquidHeight;

			console.log(
				`Creating ${
					isWater ? "water" : "lava"
				} model with height: ${actualHeight}/16 for level ${level}`
			);

			// Create an enhanced liquid model
			const liquidModel: BlockModel = {
				textures: {
					particle: isWater ? "block/water_still" : "block/lava_still",
					all: isWater ? "block/water_still" : "block/lava_still",
					top: isWater ? "block/water_still" : "block/lava_still",
					bottom: isWater ? "block/water_still" : "block/lava_still",
					north: isWater ? "block/water_flow" : "block/lava_flow",
					south: isWater ? "block/water_flow" : "block/lava_flow",
					east: isWater ? "block/water_flow" : "block/lava_flow",
					west: isWater ? "block/water_flow" : "block/lava_flow",
				},
				elements: [
					{
						from: [0, 0, 0],
						to: [16, actualHeight, 16], // Dynamic height based on level
						faces: {
							down: { texture: "#bottom", cullface: "down" },
							up: { texture: "#top", cullface: "up" },
							north: { texture: "#north", cullface: "north" },
							south: { texture: "#south", cullface: "south" },
							west: { texture: "#west", cullface: "west" },
							east: { texture: "#east", cullface: "east" },
						},
					},
				],
			};

			// Try to load the original model file if it exists and merge with our enhanced one
			let originalModelFound = false;
			try {
				// First try the exact path
				let jsonString = await this.getResourceString(
					`models/${modelPath}.json`
				);

				// If not found and this is a level-specific model, try the base model
				if (!jsonString && levelMatch) {
					const baseModelPath = isWater ? "block/water" : "block/lava";
					jsonString = await this.getResourceString(
						`models/${baseModelPath}.json`
					);
					if (jsonString) {
						console.log(
							`Using base liquid model for level variant: ${baseModelPath}`
						);
					}
				}

				if (jsonString) {
					originalModelFound = true;
					const originalModel = JSON.parse(jsonString) as BlockModel;

					// Merge textures, keeping our specific ones if not overridden
					if (originalModel.textures) {
						console.log(`Merging original model textures with enhanced model`);
						Object.assign(liquidModel.textures || {}, originalModel.textures);
					}

					// If original model has elements but we're dealing with a level-specific variant,
					// don't use them since we need our custom height
					if (originalModel.elements && !levelMatch) {
						console.log(`Using original model elements from ${modelPath}`);
						liquidModel.elements = originalModel.elements;
					}
				}
			} catch (error) {
				console.warn(`Error loading original liquid model: ${error}`);
			}

			if (!originalModelFound) {
				console.log(`No original model found, using enhanced liquid model`);
			}

			// Cache and return the enhanced model
			this.modelCache.set(cacheKey, liquidModel);
			return liquidModel;
		}

		// For non-liquid models, load from resource pack
		const jsonString = await this.getResourceString(`models/${modelPath}.json`);
		if (!jsonString) {
			console.warn(`Model definition for ${modelPath} not found.`);
			return {} as BlockModel;
		}

		try {
			// Parse the model
			const model = JSON.parse(jsonString) as BlockModel;

			// If the model has a parent, we need to merge with it
			if (model.parent) {
				const mergedModel = await this.loadAndMergeModel(model);
				this.modelCache.set(cacheKey, mergedModel);
				return mergedModel;
			}

			this.modelCache.set(cacheKey, model);
			return model;
		} catch (error) {
			console.error(`Error parsing model for ${modelPath}:`, error);
			return {} as BlockModel;
		}
	}

	private async loadAndMergeModel(model: BlockModel): Promise<BlockModel> {
		if (!model.parent) return model;

		let currentModel = { ...model };
		let parentPath = model.parent;
		let depth = 0;
		const MAX_DEPTH = 5; // Prevent infinite loops

		while (parentPath && depth < MAX_DEPTH) {
			// Fix: Remove "minecraft:" prefix if present in parent path
			parentPath = parentPath.replace("minecraft:", "");

			console.log(`Loading parent model: ${parentPath}`);

			// Now try to load the model with the correct path
			const parentModelString = await this.getResourceString(
				`models/${parentPath}.json`
			);
			if (!parentModelString) {
				console.warn(`Parent model ${parentPath} not found`);
				break;
			}

			try {
				const parentModel = JSON.parse(parentModelString) as BlockModel;

				// Merge parent and child
				currentModel = {
					...parentModel,
					...currentModel,
					textures: {
						...parentModel.textures,
						...currentModel.textures,
					},
					// Use child elements if available, otherwise parent elements
					elements: currentModel.elements || parentModel.elements,
				};

				// Get next parent or end the loop
				parentPath = parentModel.parent || "";
				depth++;
			} catch (error) {
				console.error(`Error parsing parent model ${parentPath}:`, error);
				break;
			}
		}

		// Remove parent reference from final model
		delete currentModel.parent;

		return currentModel;
	}

	/**
	 * Resolve a texture reference in a model
	 */
	public resolveTexture(textureRef: string, model: BlockModel): string {
		if (!textureRef || textureRef === "#missing") {
			return "block/missing_texture";
		}

		// If not a reference, return as is (but handle namespace)
		if (!textureRef.startsWith("#")) {
			// Remove minecraft: prefix if present
			return textureRef.replace("minecraft:", "");
		}

		// Handle reference resolution with depth limit
		const MAX_DEPTH = 5;
		let depth = 0;
		let ref = textureRef;

		while (ref.startsWith("#") && depth < MAX_DEPTH) {
			if (!model.textures) {
				console.warn(`Model has no textures defined for reference ${ref}.`);
				return "block/missing_texture";
			}

			const key = ref.substring(1);
			ref = model.textures[key] || ref;
			depth++;
		}

		if (depth >= MAX_DEPTH || ref.startsWith("#")) {
			console.warn(`Texture reference exceeded maximum depth: ${textureRef}`);
			return "block/missing_texture";
		}

		// Remove minecraft: prefix if present in the final resolved texture
		return ref.replace("minecraft:", "");
	}

	public updateAnimations(): void {
		this.animatedTextureManager.update();
	}

	public async getTexture(texturePath: string): Promise<THREE.Texture> {
		// Handle missing texture path
		if (
			!texturePath ||
			texturePath === "missing_texture" ||
			texturePath === "block/missing_texture"
		) {
			console.warn("Missing texture path requested");
			return this.createMissingTexture();
		}

		// Check cache first
		const cacheKey = `texture:${texturePath}`;
		if (this.textureCache.has(cacheKey)) {
			console.log(`Using cached texture: ${texturePath}`);
			return this.textureCache.get(cacheKey)!;
		}

		console.log(`Attempting to load texture: ${texturePath}`);

		// Special handling for liquid textures
		if (
			texturePath === "block/water_still" ||
			texturePath === "block/water_flow" ||
			texturePath === "block/lava_still" ||
			texturePath === "block/lava_flow"
		) {
			console.log(`Loading special liquid texture: ${texturePath}`);
		}

		// Check for animation
		const isAnimated = await this.animatedTextureManager.isAnimated(
			`textures/${texturePath}`
		);

		if (isAnimated) {
			const animatedTexture =
				await this.animatedTextureManager.createAnimatedTexture(texturePath);
			if (animatedTexture) {
				console.log(`Successfully created animated texture for ${texturePath}`);
				this.textureCache.set(cacheKey, animatedTexture);
				return animatedTexture;
			} else {
				console.warn(
					`Failed to create animated texture for ${texturePath}, falling back to static`
				);
			}
		}

		// If path doesn't end with .png, add it
		const fullPath = texturePath.endsWith(".png")
			? texturePath
			: `${texturePath}.png`;
		console.log(`Looking for texture at: textures/${fullPath}`);

		// Load texture blob from resource pack
		const blob = await this.getResourceBlob(`textures/${fullPath}`);
		if (!blob) {
			console.warn(`Texture blob not found for ${texturePath}`);

			// Special fallback for minecraft textures that might have different locations
			if (texturePath.startsWith("block/")) {
				// Try without the "block/" prefix
				const altPath = texturePath.replace("block/", "");
				console.log(`Trying alternate path: textures/${altPath}.png`);
				const altBlob = await this.getResourceBlob(`textures/${altPath}.png`);
				if (altBlob) {
					console.log(
						`Found texture at alternate path: textures/${altPath}.png`
					);
					// Continue with this blob
					return this.createTextureFromBlob(altBlob, cacheKey);
				}
			}

			console.error(`Texture ${texturePath} not found, using missing texture`);
			return this.createMissingTexture();
		}

		return this.createTextureFromBlob(blob, cacheKey, texturePath);
	}

	public getTint(
		blockId: string,
		properties: Record<string, string>,
		position?: THREE.Vector3
	): THREE.Color {
		return this.tintManager.getTint(blockId, properties, position);
	}

	/**
	 * Create a material for a texture with optional tinting and liquid properties
	 */
	public async getMaterial(
		texturePath: string,
		options: {
			transparent?: boolean;
			tint?: THREE.Color;
			isLiquid?: boolean;
			isWater?: boolean;
			isLava?: boolean;
			faceDirection?: string;
			forceAnimation?: boolean;
		} = {}
	): Promise<THREE.Material> {
		// Create cache key including all options
		const tintKey = options.tint
			? `:tint:${options.tint.r.toFixed(3)},${options.tint.g.toFixed(
					3
			  )},${options.tint.b.toFixed(3)}`
			: "";

		const liquidKey = options.isLiquid
			? `:liquid:${options.isWater ? "water" : "lava"}:${
					options.faceDirection || ""
			  }`
			: "";

		const cacheKey = `material:${texturePath}:${
			options.transparent ? "transparent" : "opaque"
		}${tintKey}${liquidKey}`;

		// Check cache first
		if (this.materialCache.has(cacheKey)) {
			return this.materialCache.get(cacheKey)!;
		}

		// Handle special paths for liquids
		let finalTexturePath = texturePath;
		if (options.isWater) {
			// Make sure we're using the correct water texture based on face direction
			if (options.faceDirection === "up" || options.faceDirection === "down") {
				// For top/bottom faces, use still water
				finalTexturePath = "block/water_still";
			} else {
				// For side faces, use flowing water
				finalTexturePath = "block/water_flow";
			}
		} else if (options.isLava) {
			// Make sure we're using the correct lava texture based on face direction
			if (options.faceDirection === "up" || options.faceDirection === "down") {
				// For top/bottom faces, use still lava
				finalTexturePath = "block/lava_still";
			} else {
				// For side faces, use flowing lava
				finalTexturePath = "block/lava_flow";
			}
		}

		// Try to load as animated texture for liquids or if animation is forced
		let texture: THREE.Texture;

		// Check if this path should be animated
		const shouldCheckAnimation =
			options.isLiquid ||
			options.forceAnimation ||
			finalTexturePath.includes("water") ||
			finalTexturePath.includes("lava");

		if (shouldCheckAnimation) {
			const isAnimated = await this.animatedTextureManager.isAnimated(
				`textures/${finalTexturePath}`
			);

			if (isAnimated) {
				const animatedTexture =
					await this.animatedTextureManager.createAnimatedTexture(
						finalTexturePath
					);

				if (animatedTexture) {
					texture = animatedTexture;
				} else {
					// Fallback to regular texture
					texture = await this.getTexture(finalTexturePath);
				}
			} else {
				// Not animated
				texture = await this.getTexture(finalTexturePath);
			}
		} else {
			// Regular texture
			texture = await this.getTexture(finalTexturePath);
		}

		// Create the material with appropriate settings
		const material = new THREE.MeshStandardMaterial({
			map: texture,
			transparent: options.transparent || options.isWater || false,
			opacity: options.isWater ? 0.8 : 1.0,
			alphaTest: options.transparent && !options.isWater ? 0.5 : 0,
			roughness: options.isWater && options.faceDirection === "up" ? 0.1 : 0.8,
			metalness: options.isWater && options.faceDirection === "up" ? 0.3 : 0.1,
			side: THREE.DoubleSide, // Use double-sided for liquids and transparent materials
		});

		// Apply tint if provided
		if (options.tint) {
			material.color = options.tint;
			// Enable color multiplication with texture
			material.defines = material.defines || {};
			material.defines.USE_COLOR = "";
		}

		// Apply special properties for water
		if (options.isWater) {
			// Store water data for special rendering
			material.userData.isWater = true;
			material.userData.faceDirection = options.faceDirection;
			material.userData.renderToWaterPass = true;
		}

		// Apply special properties for lava
		if (options.isLava) {
			material.emissive = new THREE.Color(0xff2200);
			material.emissiveIntensity = 0.5;
			material.roughness = 0.7;

			// Store lava data for special rendering
			material.userData.isLava = true;
			material.userData.faceDirection = options.faceDirection;
			material.userData.renderToLavaPass = true;

			// Add pulsing effect parameters
			material.userData.lavaAnimationParams = {
				pulseSpeed: 0.4,
				pulseMin: 0.4,
				pulseMax: 0.6,
			};
		}

		// Store liquidness in userData for potential rendering optimizations
		if (options.isLiquid) {
			material.userData.isLiquid = true;
		}

		// Cache and return the material
		this.materialCache.set(cacheKey, material);
		return material;
	}

	// Add to your AssetLoader class
	public async getEntityTexture(entityName: string): Promise<THREE.Texture> {
		// Specialized texture paths for known entity types
		let texturePaths: string[] = [];

		if (entityName === "chest") {
			texturePaths = [
				"entity/chest/normal",
				"entity/chest",
				"entity/chest/chest",
				"entity/chest/single",
			];
		} else if (entityName === "ender_chest") {
			texturePaths = ["entity/chest/ender", "entity/chest/ender_chest"];
		} else if (entityName === "trapped_chest") {
			texturePaths = ["entity/chest/trapped", "entity/chest/trapped_chest"];
		} else {
			// Default paths for other entity types
			texturePaths = [
				`entity/${entityName}`,
				`entity/${entityName}/${entityName}`,
				`entity/${entityName}/model`,
			];
		}

		// Try each possible path
		for (const path of texturePaths) {
			try {
				console.log(`Trying texture path: ${path}`);
				const texture = await this.getTexture(path);
				if (texture) {
					console.log(`Successfully loaded texture from ${path}`);
					return texture;
				}
			} catch (error) {
				console.log(`Failed to load texture from ${path}`);
				// Continue to next path
			}
		}

		// If we reach here, all paths failed
		console.warn(
			`Entity texture not found for ${entityName}. Tried paths: ${texturePaths.join(
				", "
			)}`
		);
		return this.createMissingTexture();
	}

	private createMissingTexture(): THREE.Texture {
		if (isBrowser) {
			// Browser version - use DOM canvas
			const size = 16;
			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;

			const ctx = canvas.getContext("2d");
			if (!ctx) {
				console.error("Failed to get canvas context for missing texture");
				return new THREE.Texture(); // Return an empty texture
			}
			ctx.fillStyle = "#FF00FF"; // Magenta
			ctx.fillRect(0, 0, size, size);

			ctx.fillStyle = "#000000"; // Black
			ctx.fillRect(0, 0, size / 2, size / 2);
			ctx.fillRect(size / 2, size / 2, size / 2, size / 2);

			const texture = new THREE.CanvasTexture(canvas);
			texture.minFilter = THREE.NearestFilter;
			texture.magFilter = THREE.NearestFilter;

			return texture;
		} else {
			// Node.js version - create a DataTexture directly
			const size = 16;
			const data = new Uint8Array(size * size * 4);

			// Fill with magenta (RGBA: 255, 0, 255, 255)
			for (let i = 0; i < size * size * 4; i += 4) {
				data[i] = 255; // R
				data[i + 1] = 0; // G
				data[i + 2] = 255; // B
				data[i + 3] = 255; // A
			}

			// Create black checkerboard pattern
			for (let y = 0; y < size / 2; y++) {
				for (let x = 0; x < size / 2; x++) {
					const i = (y * size + x) * 4;
					data[i] = 0; // R
					data[i + 1] = 0; // G
					data[i + 2] = 0; // B
				}
			}

			for (let y = size / 2; y < size; y++) {
				for (let x = size / 2; x < size; x++) {
					const i = (y * size + x) * 4;
					data[i] = 0; // R
					data[i + 1] = 0; // G
					data[i + 2] = 0; // B
				}
			}

			const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
			texture.needsUpdate = true;
			texture.minFilter = THREE.NearestFilter;
			texture.magFilter = THREE.NearestFilter;

			return texture;
		}
	}

	/**
	 * Create a texture from a blob
	 * @private
	 */
	private async createTextureFromBlob(
		blob: Blob,
		cacheKey: string,
		texturePath: string = ""
	): Promise<THREE.Texture> {
		if (isBrowser) {
			// Browser version - use URL.createObjectURL
			const url = URL.createObjectURL(blob);

			// Create texture
			try {
				const texture = await new Promise<THREE.Texture>((resolve, reject) => {
					this.textureLoader.load(
						url,
						(texture) => {
							// Configure texture
							texture.minFilter = THREE.NearestFilter;
							texture.magFilter = THREE.NearestFilter;
							texture.wrapS = THREE.RepeatWrapping;
							texture.wrapT = THREE.RepeatWrapping;

							URL.revokeObjectURL(url); // Clean up
							resolve(texture);
						},
						undefined,
						(error) => {
							URL.revokeObjectURL(url); // Clean up
							console.error(`Error loading texture ${texturePath}:`, error);
							reject(error);
						}
					);
				});

				console.log(`Successfully loaded texture: ${texturePath}`);
				// Cache the texture
				this.textureCache.set(cacheKey, texture);

				return texture;
			} catch (error) {
				console.error(`Failed to load texture ${texturePath}:`, error);
				return this.createMissingTexture();
			}
		} else {
			// Node.js version - handle blob differently
			try {
				// Convert blob to array buffer
				let buffer: ArrayBuffer;

				if (blob instanceof Blob) {
					buffer = await blob.arrayBuffer();
				} else {
					// Assume it's already a Buffer or ArrayBuffer
					buffer = blob as any;
				}

				// In a real implementation, you would:
				// 1. Use a library like sharp to decode the image
				// 2. Get the pixel data and dimensions
				// 3. Create a DataTexture

				// For now, create a placeholder texture
				console.log(
					`Node.js texture loading not fully implemented for: ${texturePath}`
				);
				const texture = this.createMissingTexture();

				// Cache the texture
				this.textureCache.set(cacheKey, texture);

				return texture;
			} catch (error) {
				console.error(
					`Failed to load texture ${texturePath} in Node.js:`,
					error
				);
				return this.createMissingTexture();
			}
		}
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		// Dispose of all textures
		this.textureCache.forEach((texture) => texture.dispose());
		this.textureCache.clear();

		// Dispose of all materials
		this.materialCache.forEach((material) => material.dispose());
		this.materialCache.clear();

		// Clear other caches
		this.blockStateCache.clear();
		this.modelCache.clear();
		this.stringCache.clear();

		// Clear resource packs
		this.resourcePacks.clear();
		this.resourcePackOrder = [];

		console.log("AssetLoader disposed");
	}
}
