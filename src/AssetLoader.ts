import * as THREE from "three";
import JSZip from "jszip";
import { Block } from "./BlockStateParser";

export interface BlockStateDefinition {
	variants?: Record<string, BlockStateModelHolder | BlockStateModelHolder[]>;
	multipart?: BlockStateMultipart[];
}

export interface BlockStateModelHolder {
	model: string;
	x?: number;
	y?: number;
	uvlock?: boolean;
	weight?: number;
}

export interface BlockStateMultipart {
	when?:
		| BlockStateDefinitionVariant<string>
		| { OR: BlockStateDefinitionVariant<string>[] };
	apply: BlockStateModelHolder | BlockStateModelHolder[];
}

export interface BlockStateDefinitionVariant<T> {
	[property: string]: T;
}

export interface BlockModel {
	parent?: string;
	textures?: Record<string, string>;
	elements?: BlockModelElement[];
	display?: Record<string, any>;
}

export interface BlockModelElement {
	from: [number, number, number];
	to: [number, number, number];
	rotation?: {
		origin: [number, number, number];
		axis: "x" | "y" | "z";
		angle: number;
	};
	faces?: {
		[face in "down" | "up" | "north" | "south" | "west" | "east"]?: {
			texture: string;
			cullface?: string;
			rotation?: number;
			tintindex?: number;
			uv?: [number, number, number, number];
		};
	};
}

export class AssetLoader {
	private resourcePacks: Map<string, JSZip> = new Map();
	private resourcePackOrder: string[] = [];

	// Caches
	private stringCache: Map<string, string> = new Map();
	private blockStateCache: Map<string, BlockStateDefinition> = new Map();
	private modelCache: Map<string, BlockModel> = new Map();
	private textureCache: Map<string, THREE.Texture> = new Map();
	private materialCache: Map<string, THREE.Material> = new Map();

	// Texture loader
	private textureLoader = new THREE.TextureLoader();

	constructor() {
		console.log("AssetLoader initialized");
	}

	/**
	 * Load a resource pack from a blob
	 */
	public async loadResourcePack(blob: Blob): Promise<void> {
		try {
			console.log("Loading resource pack...");
			const zip = await JSZip.loadAsync(blob);

			// Log structure for debugging
			const assetFiles = Object.keys(zip.files).filter(
				(path) => path.includes("assets/minecraft/") && !zip.files[path].dir
			);

			console.log(`Resource pack has ${assetFiles.length} assets`);

			// Log some sample files for debugging
			const blockstates = assetFiles.filter((path) =>
				path.includes("blockstates/")
			);
			const models = assetFiles.filter((path) => path.includes("models/"));
			const textures = assetFiles.filter((path) => path.includes("textures/"));

			console.log(`Found ${blockstates.length} blockstate files`);
			console.log(`Found ${models.length} model files`);
			console.log(`Found ${textures.length} texture files`);

			if (blockstates.length > 0) {
				console.log("Sample blockstates:", blockstates.slice(0, 5));
			}

			if (models.length > 0) {
				console.log("Sample models:", models.slice(0, 5));
			}

			// Generate a unique ID for this resource pack
			const packId = `pack_${Date.now()}`;
			this.resourcePacks.set(packId, zip);

			// Add to the front of the order list for priority
			this.resourcePackOrder.unshift(packId);

			console.log(`Resource pack loaded with ID: ${packId}`);
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

		// Load from resource pack
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
				parentPath = parentModel.parent;
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

	/**
	 * Get a texture for a given path
	 */
	public async getTexture(texturePath: string): Promise<THREE.Texture> {
		// Handle missing texture path
		if (
			!texturePath ||
			texturePath === "missing_texture" ||
			texturePath === "block/missing_texture"
		) {
			return this.createMissingTexture();
		}

		// Check cache first
		const cacheKey = `texture:${texturePath}`;
		if (this.textureCache.has(cacheKey)) {
			return this.textureCache.get(cacheKey)!;
		}

		console.log(`Loading texture: ${texturePath}`);

		// If path doesn't end with .png, add it
		const fullPath = texturePath.endsWith(".png")
			? texturePath
			: `${texturePath}.png`;

		// Load texture blob from resource pack
		const blob = await this.getResourceBlob(`textures/${fullPath}`);
		if (!blob) {
			console.warn(`Texture ${texturePath} not found`);
			return this.createMissingTexture();
		}

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

			// Cache the texture
			this.textureCache.set(cacheKey, texture);

			return texture;
		} catch (error) {
			console.error(`Failed to load texture ${texturePath}:`, error);
			return this.createMissingTexture();
		}
	}

	/**
	 * Create a material for a texture
	 */
	public async getMaterial(
		texturePath: string,
		options: { transparent?: boolean } = {}
	): Promise<THREE.Material> {
		// Create cache key
		const cacheKey = `material:${texturePath}:${
			options.transparent ? "transparent" : "opaque"
		}`;

		// Check cache first
		if (this.materialCache.has(cacheKey)) {
			return this.materialCache.get(cacheKey)!;
		}

		// Create the material
		try {
			const texture = await this.getTexture(texturePath);

			const material = new THREE.MeshStandardMaterial({
				map: texture,
				transparent: options.transparent || false,
				alphaTest: 0.5,
				roughness: 0.8,
				metalness: 0.1,
				side: options.transparent ? THREE.DoubleSide : THREE.FrontSide,
			});

			// Cache and return
			this.materialCache.set(cacheKey, material);
			return material;
		} catch (error) {
			console.error(`Error creating material for ${texturePath}:`, error);

			// Create a fallback material
			const material = new THREE.MeshStandardMaterial({
				color: 0xff00ff, // Magenta for missing textures
				wireframe: true,
			});

			return material;
		}
	}

	/**
	 * Create a texture for missing textures
	 */
	private createMissingTexture(): THREE.Texture {
		// Create a purple/black checkerboard for missing textures
		const size = 16;
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;

		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "#FF00FF"; // Magenta
		ctx.fillRect(0, 0, size, size);

		ctx.fillStyle = "#000000"; // Black
		ctx.fillRect(0, 0, size / 2, size / 2);
		ctx.fillRect(size / 2, size / 2, size / 2, size / 2);

		const texture = new THREE.CanvasTexture(canvas);
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

		console.log("AssetLoader disposed");
	}
}
