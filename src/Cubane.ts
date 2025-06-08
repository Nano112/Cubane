import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { EntityRenderer } from "./EntityRenderer";
import { Block, ResourcePackLoader, ResourcePackLoadOptions } from "./types";
import { ModelResolver } from "./ModelResolver";
import { BlockMeshBuilder } from "./BlockMeshBuilder";

// Define a type for dynamic parts of hybrid blocks
export interface HybridBlockDynamicPart {
	entityType: string; // The "entity" name for this part (e.g., "lectern_book", "bell_body")
	// Optional: offset, rotation if the dynamic part needs fixed adjustment relative to the static model's origin
	offset?: [number, number, number]; // In 0-1 block units
	rotation?: [number, number, number]; // Euler angles in degrees [x, y, z]
	// You might add more properties here if needed, e.g., scale
}

/**
 * Cubane - A Minecraft block and entity renderer for Three.js
 */
export class Cubane {
	private assetLoader: AssetLoader;
	private modelResolver: ModelResolver;
	private blockMeshBuilder: BlockMeshBuilder;
	private entityRenderer: EntityRenderer; // Will be used for the dynamic parts
	private initialized: boolean = false;
	private initPromise: Promise<void>;
	private db: IDBDatabase | null = null;
	private dbName: string = "cubane-cache";
	private dbVersion: number = 1;

	// Mesh caching
	private blockMeshCache: Map<string, THREE.Object3D> = new Map();
	private entityMeshCache: Map<string, THREE.Object3D> = new Map();

	// Block entity mapping for blocks that are *purely* entities
	private pureBlockEntityMap: Record<string, string> = {
		"minecraft:chest": "chest",
		"minecraft:trapped_chest": "trapped_chest",
		"minecraft:ender_chest": "ender_chest",

		// Note: "minecraft:bell" is removed from here as it's now hybrid
	};

	private getShulkerBoxEntityMap(): Record<string, string> {
		// Returns a map of shulker box colors to their entity type
		return {
			"minecraft:white_shulker_box": "shulker_box",
			"minecraft:orange_shulker_box": "shulker_box",
			"minecraft:magenta_shulker_box": "shulker_box",
			"minecraft:light_blue_shulker_box": "shulker_box",
			"minecraft:yellow_shulker_box": "shulker_box",
			"minecraft:lime_shulker_box": "shulker_box",
			"minecraft:pink_shulker_box": "shulker_box",
			"minecraft:gray_shulker_box": "shulker_box",
			"minecraft:light_gray_shulker_box": "shulker_box",
			"minecraft:cyan_shulker_box": "shulker_box",
			"minecraft:purple_shulker_box": "shulker_box",
			"minecraft:blue_shulker_box": "shulker_box",
			"minecraft:brown_shulker_box": "shulker_box",
			"minecraft:green_shulker_box": "shulker_box",
			"minecraft:red_shulker_box": "shulker_box",
			"minecraft:black_shulker_box": "shulker_box",
		};
	}

	// New map for hybrid blocks: blockId -> configuration for its dynamic part(s)
	private hybridBlockConfig: Record<string, HybridBlockDynamicPart[]> = {
		"minecraft:lectern": [
			{
				entityType: "lectern_book", // This will map to a specific model in your EntityRenderer
				// The lectern book is often placed based on the model's geometry,
				// but an offset might be needed if your BookModel origin isn't perfectly aligned.
				// Example (adjust these values based on your lectern and book models):
				// offset: [0.5, 0.6875, 0.5], // Centered X/Z, Y based on lectern top height (11/16)
			},
		],
		"minecraft:bell": [
			{
				entityType: "bell", // This will map to the swinging bell model
				// The bell body's attachment point might vary slightly depending on the
				// static support model (floor, ceiling, wall). For simplicity, start with one.
				// Example (adjust based on your bell_body model's pivot and static model):
				// offset: [0.5, 0.875, 0.5], // Centered X/Z, Y for hanging point (e.g., 14/16)
			},
		],
		// Add other hybrid blocks here
	};

	constructor() {
		this.assetLoader = new AssetLoader();
		this.modelResolver = new ModelResolver(this.assetLoader);
		this.blockMeshBuilder = new BlockMeshBuilder(this.assetLoader);
		this.entityRenderer = new EntityRenderer(); // Make sure EntityRenderer can load "lectern_book", "bell_body"

		this.initPromise = Promise.resolve().then(() => {
			this.initialized = true;
		});

		// Register shulker box entities
		const shulkerBoxEntityMap = this.getShulkerBoxEntityMap();
		for (const [blockId, entityType] of Object.entries(shulkerBoxEntityMap)) {
			this.registerBlockEntity(blockId, entityType);
		}
	}

	// --- Database and Resource Pack methods (assumed to be correct and complete) ---
	private async initDatabase(): Promise<IDBDatabase | null> {
		const isBrowser = typeof window !== "undefined";
		if (!isBrowser) {
			return Promise.resolve(null);
		}
		if (this.db) return this.db;
		if (!window.indexedDB) {
			throw new Error("IndexedDB not supported");
		}
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.dbVersion);
			request.onerror = (event) =>
				reject(
					new Error("Failed to open IndexedDB: " + (event.target as any)?.error)
				);
			request.onsuccess = () => {
				this.db = request.result;
				resolve(this.db);
			};
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains("resourcePacks")) {
					db.createObjectStore("resourcePacks", { keyPath: "id" }).createIndex(
						"timestamp",
						"timestamp",
						{ unique: false }
					);
				}
			};
		});
	}
	private async storeResourcePack(packId: string, blob: Blob): Promise<void> {
		try {
			const db = await this.initDatabase();
			if (!db) return;
			return new Promise((resolve, reject) => {
				// reject on error
				const transaction = db.transaction(["resourcePacks"], "readwrite");
				const store = transaction.objectStore("resourcePacks");
				const request = store.put({
					id: packId,
					blob: blob,
					timestamp: Date.now(),
				});
				request.onsuccess = () => resolve();
				request.onerror = (e) =>
					reject(
						new Error("Failed to store pack: " + (e.target as any)?.error)
					);
			});
		} catch (error) {
			console.error("Error storing resource pack:", error);
		}
	}
	private async getResourcePackFromCache(
		packId: string,
		expirationTime?: number | null
	): Promise<Blob | null> {
		try {
			const db = await this.initDatabase();
			if (!db) return null;
			return new Promise((resolve, reject) => {
				// reject on error
				const transaction = db.transaction(["resourcePacks"], "readonly");
				const store = transaction.objectStore("resourcePacks");
				const request = store.get(packId);
				request.onsuccess = () => {
					const data = request.result;
					if (
						!data ||
						(expirationTime && Date.now() - data.timestamp > expirationTime)
					) {
						resolve(null);
					} else {
						resolve(data.blob);
					}
				};
				request.onerror = (e) =>
					reject(
						new Error(
							"Failed to get pack from cache: " + (e.target as any)?.error
						)
					);
			});
		} catch (error) {
			console.error("Error getting resource pack from cache:", error);
			return null;
		}
	}
	private async cleanupExpiredResourcePacks(
		expirationTime: number
	): Promise<void> {
		try {
			const db = await this.initDatabase();
			if (!db) return;
			const transaction = db.transaction(["resourcePacks"], "readwrite");
			const store = transaction.objectStore("resourcePacks");
			const index = store.index("timestamp");
			const cutoffTime = Date.now() - expirationTime;
			const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					store.delete(cursor.primaryKey);
					cursor.continue();
				}
			};
		} catch (error) {
			console.error("Error cleaning up expired resource packs:", error);
		}
	}
	public async loadResourcePack(
		options: ResourcePackLoadOptions | Blob,
		loader?: ResourcePackLoader
	): Promise<void> {
		if (!this.initialized) await this.initPromise;
		if (options instanceof Blob) {
			await this.assetLoader.loadResourcePack(options);
			this.lastPackLoadedFromCache = false; // Not from cache
			// Clear mesh caches when new resource pack is loaded
			this.clearMeshCaches();
			return;
		}
		const defaultOptions: ResourcePackLoadOptions = {
			packId: `pack_${Date.now()}`,
			useCache: true,
			forceReload: false,
			cacheExpiration: 7 * 24 * 60 * 60 * 1000,
		};
		const finalOptions = { ...defaultOptions, ...options };
		let resourcePackBlob: Blob | null = null;
		this.lastPackLoadedFromCache = false;
		if (finalOptions.useCache && !finalOptions.forceReload) {
			try {
				resourcePackBlob = await this.getResourcePackFromCache(
					finalOptions.packId!,
					finalOptions.cacheExpiration
				);
				if (resourcePackBlob) this.lastPackLoadedFromCache = true;
			} catch (error) {
				console.warn("Cubane: Error accessing cache:", error);
			}
		}
		if (!resourcePackBlob) {
			if (!loader) throw new Error("No loader and pack not in cache");
			resourcePackBlob = await loader();
			if (finalOptions.useCache && resourcePackBlob) {
				// Ensure blob is not null
				try {
					await this.storeResourcePack(finalOptions.packId!, resourcePackBlob);
					if (finalOptions.cacheExpiration)
						await this.cleanupExpiredResourcePacks(
							finalOptions.cacheExpiration
						);
				} catch (storeError) {
					console.warn("Cubane: Failed to cache resource pack:", storeError);
				}
			}
		}
		if (!resourcePackBlob)
			throw new Error("Failed to load or retrieve resource pack blob");
		await this.assetLoader.loadResourcePack(resourcePackBlob);
		// Clear mesh caches when new resource pack is loaded
		this.clearMeshCaches();
	}
	public async listCachedResourcePacks(): Promise<
		Array<{ id: string; name: string; size: number; timestamp: number }>
	> {
		try {
			const db = await this.initDatabase();
			if (!db) return [];
			return new Promise((resolve, reject) => {
				const transaction = db.transaction(["resourcePacks"], "readonly");
				const store = transaction.objectStore("resourcePacks");
				const request = store.openCursor(null, "prev"); // Sort by newest first (if IDBKey is timestamp or similar)
				const results: Array<{
					id: string;
					name: string;
					size: number;
					timestamp: number;
				}> = [];
				request.onsuccess = () => {
					const cursor = request.result;
					if (cursor) {
						const { id, timestamp, blob } = cursor.value;
						results.push({
							id,
							name: id.replace(/^cubane_pack_/, "").replace(/_/g, " "),
							size: blob.size,
							timestamp,
						});
						cursor.continue();
					} else {
						results.sort((a, b) => b.timestamp - a.timestamp); // Explicit sort just in case
						resolve(results);
					}
				};
				request.onerror = (e) =>
					reject(
						new Error("Failed to list packs: " + (e.target as any)?.error)
					);
			});
		} catch (error) {
			console.error("Error listing cached packs:", error);
			return [];
		}
	}
	public async loadMostRecentPack(): Promise<boolean> {
		try {
			const packs = await this.listCachedResourcePacks();
			if (packs.length === 0) return false;
			await this.loadCachedPack(packs[0].id); // Assumes list is sorted by recency
			return true;
		} catch (error) {
			console.error("Error loading most recent pack:", error);
			return false;
		}
	}
	public async loadCachedPack(packId: string): Promise<boolean> {
		try {
			const blob = await this.getResourcePackFromCache(packId);
			if (!blob) {
				console.warn(`Pack ${packId} not found in cache for direct load.`);
				return false;
			}
			await this.assetLoader.loadResourcePack(blob);
			this.lastPackLoadedFromCache = true;
			// Clear mesh caches when new resource pack is loaded
			this.clearMeshCaches();
			return true;
		} catch (error) {
			console.error(`Error loading cached pack ${packId}:`, error);
			return false;
		}
	}
	public async deleteCachedPack(packId: string): Promise<boolean> {
		try {
			const db = await this.initDatabase();
			if (!db) return false;
			return new Promise((resolve, reject) => {
				const transaction = db.transaction(["resourcePacks"], "readwrite");
				const store = transaction.objectStore("resourcePacks");
				const request = store.delete(packId);
				request.onsuccess = () => resolve(true);
				request.onerror = (e) =>
					reject(
						new Error(
							`Failed to delete pack ${packId}: ` + (e.target as any)?.error
						)
					);
			});
		} catch (error) {
			console.error(`Error deleting pack ${packId}:`, error);
			return false;
		}
	}
	// --- End Database and Resource Pack methods ---

	public lastPackLoadedFromCache: boolean = false;

	/**
	 * Get a block mesh with optional caching
	 * @param blockString The block string (e.g., "minecraft:stone[variant=smooth]")
	 * @param biome The biome for tinting (default: "plains")
	 * @param useCache Whether to use cached meshes (default: true)
	 * @returns Promise<THREE.Object3D> The block mesh
	 */
	public async getBlockMesh(
		blockString: string,
		biome: string = "plains",
		useCache: boolean = true
	): Promise<THREE.Object3D> {
		if (!this.initialized) {
			await this.initPromise;
		}

		const cacheKey = `${blockString}:${biome}`;

		if (useCache && this.blockMeshCache.has(cacheKey)) {
			const cachedMesh = this.blockMeshCache.get(cacheKey)!;
			return cachedMesh.clone(); // Return a clone for safety
		}

		const block = this.parseBlockString(blockString);
		const blockId = `${block.namespace}:${block.name}`;

		if (this.pureBlockEntityMap[blockId]) {
			const entityMesh = await this.getEntityMesh(
				this.pureBlockEntityMap[blockId],
				useCache
			);
			// For pure entities, the entityMesh is the final block mesh.
			// It might already have its own internal origin and structure.
			if (useCache) {
				// Clone before caching as getEntityMesh might also return a clone from its cache
				this.blockMeshCache.set(cacheKey, entityMesh.clone());
			}
			return entityMesh; // Already cloned if from entity cache, or the original if newly created
		}

		const rootGroup = new THREE.Group();
		rootGroup.name = `block_${block.name.replace("minecraft:", "")}`;
		(rootGroup as any).blockData = block;
		(rootGroup as any).biome = biome;

		let staticModelRendered = false;
		try {
			const modelDataList = await this.modelResolver.resolveBlockModel(block);
			if (modelDataList.length > 0) {
				const objectPromises = modelDataList.map(async (modelData) => {
					try {
						const modelJson = await this.assetLoader.getModel(modelData.model);

						// --- MODIFICATION START ---
						// Pass only uvlock and block data for BlockMeshBuilder to use internally.
						// x and y rotations will be applied to the object returned by BlockMeshBuilder.
						const baseBlockPartObject =
							await this.blockMeshBuilder.createBlockMesh(
								modelJson,
								{
									// x: undefined, // Explicitly not passing x rotation
									// y: undefined, // Explicitly not passing y rotation
									uvlock: modelData.uvlock,
								},
								block, // Pass block data for context
								biome
							);

						// Apply blockstate rotations (modelData.x, modelData.y) here
						// to the Object3D returned by BlockMeshBuilder.
						if (modelData.y !== undefined && modelData.y !== 0) {
							baseBlockPartObject.rotateY(-(modelData.y * Math.PI) / 180);
						}
						if (modelData.x !== undefined && modelData.x !== 0) {
							baseBlockPartObject.rotateX(-(modelData.x * Math.PI) / 180);
						}
						// --- MODIFICATION END ---

						return baseBlockPartObject; // This is the (now rotated if needed) part
					} catch (modelError) {
						console.error(
							`Error creating mesh for sub-model ${modelData.model} of ${blockString}:`,
							modelError
						);
						return null;
					}
				});

				const staticParts = (await Promise.all(objectPromises)).filter(
					Boolean
				) as THREE.Object3D[];

				// Add all static parts to the rootGroup.
				// Each part is now an Object3D that has its blockstate rotation applied.
				// Their internal element rotations were baked by BlockMeshBuilder.
				staticParts.forEach((part) => {
					// Ensure part is valid before adding
					if (part && part.isObject3D) {
						rootGroup.add(part);
					}
				});
				staticModelRendered = rootGroup.children.length > 0;
			}
		} catch (error) {
			console.warn(
				`Cubane: Error resolving/rendering static model for ${blockId} (${blockString}):`,
				error
			);
		}

		if (this.hybridBlockConfig[blockId]) {
			const dynamicPartsConfig = this.hybridBlockConfig[blockId];
			for (const partConfig of dynamicPartsConfig) {
				try {
					const dynamicMesh = await this.getEntityMesh(
						partConfig.entityType,
						useCache
					);
					if (dynamicMesh) {
						if (partConfig.offset) {
							dynamicMesh.position.set(
								partConfig.offset[0] - 0.5, // Assuming hybrid offsets are 0-1, convert to -0.5 to 0.5 if block is centered
								partConfig.offset[1] - 0.5,
								partConfig.offset[2] - 0.5
								// If your block models from BlockMeshBuilder are already centered,
								// and hybrid parts are also designed to be centered or relative to center,
								// you might not need the -0.5. Test this.
								// Or, if offsets are in MC coords (0-16), divide by 16 then subtract 0.5.
							);
						}
						if (partConfig.rotation) {
							dynamicMesh.rotation.set(
								THREE.MathUtils.degToRad(partConfig.rotation[0]),
								THREE.MathUtils.degToRad(partConfig.rotation[1]),
								THREE.MathUtils.degToRad(partConfig.rotation[2])
							);
						}
						dynamicMesh.userData.isDynamicBlockPart = true;
						dynamicMesh.userData.entityType = partConfig.entityType;
						rootGroup.add(dynamicMesh);
					}
				} catch (entityError) {
					console.error(
						`Error creating dynamic part ${partConfig.entityType} for ${blockId}:`,
						entityError
					);
				}
			}
		}

		if (rootGroup.children.length === 0) {
			console.warn(
				`Cubane: No parts rendered for ${blockId} (${blockString}), returning fallback.`
			);
			// The fallback mesh is simple and has no internal rotations to worry about.
			// If you cache it, clone it.
			const fallback = this.createFallbackMesh(`block_fallback_${blockId}`);
			if (useCache) {
				this.blockMeshCache.set(cacheKey, fallback.clone());
			}
			return fallback;
		}

		if (useCache) {
			// The rootGroup now contains all parts, correctly transformed.
			// Cache a clone of this assembled rootGroup.
			this.blockMeshCache.set(cacheKey, rootGroup.clone());
		}

		// rootGroup itself is at origin (0,0,0) with no rotation.
		// Its children (the block parts) have their blockstate rotations.
		// The meshes within those children have their element rotations baked into vertices.
		return rootGroup;
	}

	/**
	 * Get an entity mesh with optional caching
	 * @param entityType The entity type
	 * @param useCache Whether to use cached meshes (default: true)
	 * @returns Promise<THREE.Object3D> The entity mesh
	 */
	public async getEntityMesh(
		entityType: string,
		useCache: boolean = true
	): Promise<THREE.Object3D> {
		if (!this.initialized) {
			await this.initPromise;
		}

		// Check cache first if enabled
		if (useCache && this.entityMeshCache.has(entityType)) {
			const cachedMesh = this.entityMeshCache.get(entityType)!;
			// Return a clone to avoid modifying the cached mesh
			const clonedMesh = cachedMesh.clone();
			clonedMesh.name = `entity_${entityType}`;
			return clonedMesh;
		}

		try {
			// console.log(`Cubane: Creating mesh for entity: ${entityType}`);
			const mesh = await this.entityRenderer.createEntityMesh(entityType);
			if (!mesh) {
				console.warn(`No mesh created by EntityRenderer for: ${entityType}`);
				const fallback = this.createFallbackMesh("entity_" + entityType);
				if (useCache) {
					this.entityMeshCache.set(entityType, fallback.clone());
				}
				return fallback;
			}
			mesh.name = `entity_${entityType}`;

			// Cache the mesh if caching is enabled
			if (useCache) {
				this.entityMeshCache.set(entityType, mesh.clone());
			}

			return mesh;
		} catch (error) {
			console.error(`Error creating entity mesh ${entityType}:`, error);
			const fallback = this.createFallbackMesh("entity_" + entityType);
			if (useCache) {
				this.entityMeshCache.set(entityType, fallback.clone());
			}
			return fallback;
		}
	}

	/**
	 * Clear all mesh caches
	 */
	public clearMeshCaches(): void {
		this.blockMeshCache.clear();
		this.entityMeshCache.clear();
		console.log("Cubane: Mesh caches cleared");
	}

	/**
	 * Clear block mesh cache only
	 */
	public clearBlockMeshCache(): void {
		this.blockMeshCache.clear();
		console.log("Cubane: Block mesh cache cleared");
	}

	/**
	 * Clear entity mesh cache only
	 */
	public clearEntityMeshCache(): void {
		this.entityMeshCache.clear();
		console.log("Cubane: Entity mesh cache cleared");
	}

	/**
	 * Get cache statistics
	 */
	public getCacheStats(): { blockMeshCount: number; entityMeshCount: number } {
		return {
			blockMeshCount: this.blockMeshCache.size,
			entityMeshCount: this.entityMeshCache.size,
		};
	}

	/**
	 * Check if a block mesh is cached
	 */
	public isBlockMeshCached(
		blockString: string,
		biome: string = "plains"
	): boolean {
		const cacheKey = `${blockString}:${biome}`;
		return this.blockMeshCache.has(cacheKey);
	}

	/**
	 * Check if an entity mesh is cached
	 */
	public isEntityMeshCached(entityType: string): boolean {
		return this.entityMeshCache.has(entityType);
	}

	public registerBlockEntity(blockId: string, entityType: string): void {
		// Decide if this is a pure entity or a dynamic part of a hybrid
		// For now, this method is for pure entities. Hybrids are via hybridBlockConfig.
		this.pureBlockEntityMap[blockId] = entityType;
	}

	public registerHybridBlock(
		blockId: string,
		dynamicParts: HybridBlockDynamicPart[]
	): void {
		this.hybridBlockConfig[blockId] = dynamicParts;
	}

	public updateAnimations(): void {
		this.assetLoader.updateAnimations();
		// TODO: Add logic to update animations for dynamic block parts (e.g., bell swing, book page turn)
		// This would involve iterating through scene objects tagged with `isDynamicBlockPart`
		// and calling an update method on them or their controllers.
		// For example:
		// scene.traverse(object => {
		//    if (object.userData.isDynamicBlockPart) {
		//        this.entityRenderer.updateDynamicPartAnimation(object, object.userData.entityType /*, any_state_needed */);
		//    }
		// });
	}

	private parseBlockString(blockString: string): Block {
		const result: Block = { namespace: "minecraft", name: "", properties: {} };
		const namespaceParts = blockString.split(":");
		if (namespaceParts.length > 1) {
			result.namespace = namespaceParts[0];
			const remaining = namespaceParts[1];
			const propertyIndex = remaining.indexOf("[");
			if (propertyIndex !== -1) {
				result.name = remaining.substring(0, propertyIndex);
				const propertiesString = remaining.substring(
					propertyIndex + 1,
					remaining.length - 1
				);
				propertiesString.split(",").forEach((prop) => {
					const [key, value] = prop.split("=");
					if (key && value) result.properties[key.trim()] = value.trim();
				});
			} else {
				result.name = remaining;
			}
		} else {
			// Handle simple block names without namespace (assume minecraft) or properties
			const propertyIndex = blockString.indexOf("[");
			if (propertyIndex !== -1) {
				result.name = blockString.substring(0, propertyIndex);
				const propertiesString = blockString.substring(
					propertyIndex + 1,
					blockString.length - 1
				);
				propertiesString.split(",").forEach((prop) => {
					const [key, value] = prop.split("=");
					if (key && value) result.properties[key.trim()] = value.trim();
				});
			} else {
				result.name = blockString;
			}
		}
		return result;
	}

	private createFallbackMesh(name: string = "fallback"): THREE.Mesh {
		const fallback = new THREE.Mesh(
			new THREE.BoxGeometry(0.8, 0.8, 0.8), // Slightly smaller to distinguish
			new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
		);
		fallback.name = name;
		return fallback;
	}

	public getAssetLoader(): AssetLoader {
		return this.assetLoader;
	}
	public getBlockMeshBuilder(): BlockMeshBuilder {
		return this.blockMeshBuilder;
	}
	public getEntityRenderer(): EntityRenderer {
		return this.entityRenderer;
	}
	public dispose(): void {
		this.assetLoader.dispose();
		this.clearMeshCaches();
	}
}
