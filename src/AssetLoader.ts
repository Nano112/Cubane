import * as THREE from "three";
import JSZip from "jszip";
import { AnimatedTextureManager } from "./AnimatedTextureManager";
import { TintManager } from "./TintManager";
import { BlockModel, BlockStateDefinition } from "./types";

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
	}

	/**
	 * Load a resource pack from a blob
	 */
	public async loadResourcePack(blob: Blob): Promise<void> {
		try {
			console.log("🔍 Loading resource pack from blob...");

			// Ensure fully loaded and safe Blob
			const arrayBuffer = await blob.arrayBuffer();
			console.log("📦 Blob size:", arrayBuffer.byteLength, "type:", blob.type);

			// Optional: Verify ZIP signature at start
			const header = new Uint8Array(arrayBuffer.slice(0, 4));
			if (
				header[0] !== 0x50 ||
				header[1] !== 0x4b ||
				header[2] !== 0x03 ||
				header[3] !== 0x04
			) {
				throw new Error("❌ Invalid ZIP: missing PK\x03\x04 header");
			}

			// Optional: Verify EOCD record at the end
			const eocdOffset = this.findEOCD(arrayBuffer);
			if (eocdOffset === -1) {
				throw new Error("❌ ZIP missing End of Central Directory (EOCD)");
			}
			console.log("📍 EOCD found at byte offset:", eocdOffset);

			// Pass raw buffer to JSZip directly
			const zip = await JSZip.loadAsync(arrayBuffer);
			console.log("✅ ZIP loaded, entries:", Object.keys(zip.files).length);

			// Filter and log structure
			const assetFiles = Object.keys(zip.files).filter(
				(path) => path.includes("assets/minecraft/") && !zip.files[path].dir
			);
			const blockstates = assetFiles.filter((p) => p.includes("blockstates/"));
			const models = assetFiles.filter((p) => p.includes("models/"));
			const textures = assetFiles.filter((p) => p.includes("textures/"));

			console.log("📁 blockstates:", blockstates.length);
			console.log("📁 models:", models.length);
			console.log("📁 textures:", textures.length);

			// Register pack
			const packId = `pack_${Date.now()}`;
			this.resourcePacks.set(packId, zip);
			this.resourcePackOrder.unshift(packId);
		} catch (error) {
			console.error("❌ Failed to load resource pack:", error);
			throw error;
		}
	}

	// Detect EOCD location for ZIP validity
	private findEOCD(buffer: ArrayBuffer): number {
		const view = new Uint8Array(buffer);
		for (let i = buffer.byteLength - 22; i >= 0; i--) {
			if (
				view[i] === 0x50 && // P
				view[i + 1] === 0x4b && // K
				view[i + 2] === 0x05 &&
				view[i + 3] === 0x06
			) {
				return i;
			}
		}
		return -1;
	}

	/**
	 * Get a string resource (JSON files, etc.)
	 */
	public async getResourceString(
		path: string,
		silent: boolean = true
	): Promise<string | undefined> {
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
					if (!silent) {
						console.error(`Error reading ${path} from pack ${packId}:`, error);
					}
				}
			}
		}

		if (!silent) {
			console.warn(`Resource not found: ${path}`);
		}
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
			}

			// Calculate liquid height based on level
			// In Minecraft:
			// Level 0 = full/source block
			// Level 1-7 = progressively lower flowing blocks
			const liquidHeight = level === 0 ? 16 : 16 - level * 2;

			// Special case: water source blocks are 14px high, not 16px
			const actualHeight = isWater && level === 0 ? 14 : liquidHeight;

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
				}

				if (jsonString) {
					originalModelFound = true;
					const originalModel = JSON.parse(jsonString) as BlockModel;

					// Merge textures, keeping our specific ones if not overridden
					if (originalModel.textures) {
						Object.assign(liquidModel.textures || {}, originalModel.textures);
					}

					// If original model has elements but we're dealing with a level-specific variant,
					// don't use them since we need our custom height
					if (originalModel.elements && !levelMatch) {
						liquidModel.elements = originalModel.elements;
					}
				}
			} catch (error) {
				console.warn(`Error loading original liquid model: ${error}`);
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
			return this.textureCache.get(cacheKey)!;
		}

		// Check for animation
		const isAnimated = await this.animatedTextureManager.isAnimated(
			`textures/${texturePath}`
		);

		if (isAnimated) {
			const animatedTexture =
				await this.animatedTextureManager.createAnimatedTexture(texturePath);
			if (animatedTexture) {
				`Successfully created animated texture for ${texturePath}`;
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

		// Load texture blob from resource pack
		const blob = await this.getResourceBlob(`textures/${fullPath}`);
		if (!blob) {
			console.warn(`Texture blob not found for ${texturePath}`);

			// Special fallback for minecraft textures that might have different locations
			if (texturePath.startsWith("block/")) {
				// Try without the "block/" prefix
				const altPath = texturePath.replace("block/", "");
				const altBlob = await this.getResourceBlob(`textures/${altPath}.png`);
				if (altBlob) {
					// Continue with this blob
					return this.createTextureFromBlob(altBlob, cacheKey);
				}
			}

			console.error(`Texture ${texturePath} not found, using missing texture`);
			return this.createMissingTexture();
		}

		return this.createTextureFromBlob(blob, cacheKey, texturePath);
	}

	// Helper for creating a texture from a blob
	private async createTextureFromBlob(
		blob: Blob,
		cacheKey: string,
		texturePath: string = ""
	): Promise<THREE.Texture> {
		// Convert blob to data URL
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

			this.textureCache.set(cacheKey, texture);

			return texture;
		} catch (error) {
			console.error(`Failed to load texture ${texturePath}:`, error);
			return this.createMissingTexture();
		}
	}

	public getTint(
		blockId: string,
		properties: Record<string, string>,
		biome: string = "plains",
		position?: THREE.Vector3
	): THREE.Color {
		return this.tintManager.getTint(blockId, properties, biome, position);
	}

	// Add these methods to your AssetLoader class

	/**
	 * Analyze PNG texture transparency by examining alpha channel data
	 */
	public analyzeTextureTransparency(texture: THREE.Texture): {
		hasTransparency: boolean;
		transparencyType: "opaque" | "cutout" | "blend";
		averageAlpha: number;
		visibleAlpha: number; // Average alpha of only visible pixels
		opaquePixelCount: number;
		transparentPixelCount: number;
		semiTransparentPixelCount: number;
	} {
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");

		if (!ctx || !texture.image) {
			return {
				hasTransparency: false,
				transparencyType: "opaque",
				averageAlpha: 1.0,
				visibleAlpha: 1.0,
				opaquePixelCount: 0,
				transparentPixelCount: 0,
				semiTransparentPixelCount: 0,
			};
		}

		canvas.width = texture.image.width;
		canvas.height = texture.image.height;
		ctx.drawImage(texture.image, 0, 0);

		try {
			const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const data = imageData.data;

			let totalAlpha = 0;
			let visibleAlphaSum = 0;
			let transparentPixels = 0;
			let opaquePixels = 0;
			let semiTransparentPixels = 0;
			let visiblePixels = 0;
			let totalPixels = 0;

			// Analyze alpha values with better thresholds
			for (let i = 3; i < data.length; i += 4) {
				// Every 4th value is alpha
				const alpha = data[i] / 255;
				totalAlpha += alpha;
				totalPixels++;

				if (alpha < 0.01) {
					// Nearly fully transparent
					transparentPixels++;
				} else if (alpha > 0.99) {
					// Nearly fully opaque
					opaquePixels++;
					visibleAlphaSum += alpha;
					visiblePixels++;
				} else {
					// Semi-transparent
					semiTransparentPixels++;
					visibleAlphaSum += alpha;
					visiblePixels++;
				}
			}

			const averageAlpha = totalAlpha / totalPixels;
			const visibleAlpha =
				visiblePixels > 0 ? visibleAlphaSum / visiblePixels : 1.0;
			const hasTransparency =
				transparentPixels > 0 || semiTransparentPixels > 0;

			if (!hasTransparency) {
				console.log(`Opaque texture detected`);
				return {
					hasTransparency: false,
					transparencyType: "opaque",
					averageAlpha: 1.0,
					visibleAlpha: 1.0,
					opaquePixelCount: opaquePixels,
					transparentPixelCount: transparentPixels,
					semiTransparentPixelCount: semiTransparentPixels,
				};
			}

			// Better logic for determining transparency type
			const semiTransparentRatio = semiTransparentPixels / totalPixels;
			const transparentRatio = transparentPixels / totalPixels;

			let transparencyType: "cutout" | "blend";

			// If most pixels are either fully transparent or fully opaque, it's cutout
			if (
				semiTransparentRatio < 0.1 &&
				(transparentRatio > 0.1 || opaquePixels > totalPixels * 0.5)
			) {
				transparencyType = "cutout";
			} else {
				transparencyType = "blend";
			}

			console.log(`Texture transparency analysis: ${transparencyType}`);
			console.log(`  - Total pixels: ${totalPixels}`);
			console.log(
				`  - Transparent: ${transparentPixels} (${(
					transparentRatio * 100
				).toFixed(1)}%)`
			);
			console.log(
				`  - Semi-transparent: ${semiTransparentPixels} (${(
					semiTransparentRatio * 100
				).toFixed(1)}%)`
			);
			console.log(
				`  - Opaque: ${opaquePixels} (${(
					(opaquePixels / totalPixels) *
					100
				).toFixed(1)}%)`
			);
			console.log(`  - Average alpha: ${averageAlpha.toFixed(3)}`);
			console.log(`  - Visible alpha: ${visibleAlpha.toFixed(3)}`);

			return {
				hasTransparency: true,
				transparencyType,
				averageAlpha,
				visibleAlpha,
				opaquePixelCount: opaquePixels,
				transparentPixelCount: transparentPixels,
				semiTransparentPixelCount: semiTransparentPixels,
			};
		} catch (error) {
			console.warn("Could not analyze texture transparency:", error);
			return {
				hasTransparency: false,
				transparencyType: "opaque",
				averageAlpha: 1.0,
				visibleAlpha: 1.0,
				opaquePixelCount: 0,
				transparentPixelCount: 0,
				semiTransparentPixelCount: 0,
			};
		}
	}


	// Replace the getMaterial method in AssetLoader with this simplified version
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
        alphaTest?: number;
        opacity?: number;
        biome?: string;
    } = {}
): Promise<THREE.Material> {
    // Create cache key including all options
    const tintKey = options.tint
        ? `:tint:${options.tint.r.toFixed(3)},${options.tint.g.toFixed(3)},${options.tint.b.toFixed(3)}`
        : "";

    const liquidKey = options.isLiquid
        ? `:liquid:${options.isWater ? "water" : "lava"}:${options.faceDirection || ""}`
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
        if (options.faceDirection === "up" || options.faceDirection === "down") {
            finalTexturePath = "block/water_still";
        } else {
            finalTexturePath = "block/water_flow";
        }
    } else if (options.isLava) {
        if (options.faceDirection === "up" || options.faceDirection === "down") {
            finalTexturePath = "block/lava_still";
        } else {
            finalTexturePath = "block/lava_flow";
        }
    }

    // Load texture (animated or static)
    let texture: THREE.Texture;
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
            const animatedTexture = await this.animatedTextureManager.createAnimatedTexture(
                finalTexturePath
            );
            texture = animatedTexture || (await this.getTexture(finalTexturePath));
        } else {
            texture = await this.getTexture(finalTexturePath);
        }
    } else {
        texture = await this.getTexture(finalTexturePath);
    }

    // Simple approach: Let PNG alpha channels handle transparency naturally
    const materialConfig: any = {
        map: texture,
        transparent: true,  // Always true - let PNG alpha do the work
        alphaTest: 0.01,    // Very low threshold to discard nearly transparent pixels
        depthWrite: true,   // Default to true, override for special cases
        opacity: 1.0,       // Default to full opacity, let PNG alpha handle it
        side: THREE.FrontSide
    };

    // Special handling for specific material types
    if (options.isWater) {
        materialConfig.alphaTest = 0.0;      // Water uses blending, not cutout
        materialConfig.depthWrite = false;   // Water needs proper blending
        materialConfig.opacity = options.opacity || 0.8;
    } else if (options.isLava) {
        materialConfig.alphaTest = 0.0;      // Lava is usually opaque but might have edges
        materialConfig.depthWrite = true;
        materialConfig.opacity = 1.0;
    } else if (finalTexturePath.includes('glass')) {
        // Glass materials need blending, not cutout
        materialConfig.alphaTest = 0.0;
        materialConfig.depthWrite = false;
        materialConfig.opacity = options.opacity || 0.85; // Slightly transparent for realistic glass
    } else {
        // For everything else, use a low alphaTest to handle cutout transparency
        // This includes leaves, grass, redstone dust, torches, etc.
        materialConfig.alphaTest = options.alphaTest || 0.01;
        materialConfig.depthWrite = true;
        materialConfig.opacity = options.opacity || 1.0;
    }

    const material = new THREE.MeshStandardMaterial(materialConfig);

    // Apply tint if provided
    if (options.tint) {
        material.color = options.tint;
        material.defines = material.defines || {};
        material.defines.USE_COLOR = "";
    }

    // Apply special properties for water
    if (options.isWater) {
        material.userData.isWater = true;
        material.userData.faceDirection = options.faceDirection;
        material.userData.renderToWaterPass = true;

        // Add water-specific material properties
        material.roughness = options.faceDirection === "up" ? 0.1 : 0.3;
        material.metalness = options.faceDirection === "up" ? 0.05 : 0.0;
    }

    // Apply special properties for lava
    if (options.isLava) {
        material.emissive = new THREE.Color(0xff2200);
        material.emissiveIntensity = 0.5;
        material.roughness = 0.7;
        material.metalness = 0.0;

        material.userData.isLava = true;
        material.userData.faceDirection = options.faceDirection;
        material.userData.renderToLavaPass = true;
        material.userData.lavaAnimationParams = {
            pulseSpeed: 0.4,
            pulseMin: 0.4,
            pulseMax: 0.6,
        };
    }

    // Store general liquid status
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
				const texture = await this.getTexture(path);
				if (texture) {
					return texture;
				}
			} catch (error) {}
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
		// Create a purple/black checkerboard for missing textures
		const size = 16;

		// Create a data array for pixels
		const data = new Uint8Array(size * size * 4);

		// Fill with magenta
		for (let i = 0; i < size * size; i++) {
			data[i * 4] = 255; // R
			data[i * 4 + 1] = 0; // G
			data[i * 4 + 2] = 255; // B
			data[i * 4 + 3] = 255; // A
		}

		// Add black checkerboard pattern
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				if (
					(x < size / 2 && y < size / 2) ||
					(x >= size / 2 && y >= size / 2)
				) {
					const i = (y * size + x) * 4;
					data[i] = 0; // R
					data[i + 1] = 0; // G
					data[i + 2] = 0; // B
					data[i + 3] = 255; // A
				}
			}
		}

		// Create texture directly from pixel data
		const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);

		texture.needsUpdate = true;
		texture.minFilter = THREE.NearestFilter;
		texture.magFilter = THREE.NearestFilter;

		return texture;
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
	}
}
