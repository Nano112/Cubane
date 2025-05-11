import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { EntityRenderer } from "./EntityRenderer";
import { Block, ResourcePackLoader, ResourcePackLoadOptions } from "./types";
import { ModelResolver } from "./ModelResolver";
import { BlockMeshBuilder } from "./BlockMeshBuilder";

/**
 * Cubane - A Minecraft block and entity renderer for Three.js
 */
export class Cubane {
	private assetLoader: AssetLoader;
	private modelResolver: ModelResolver;
	private blockMeshBuilder: BlockMeshBuilder;
	private entityRenderer: EntityRenderer;
	private initialized: boolean = false;
	private initPromise: Promise<void>;
	private db: IDBDatabase | null = null;
	private dbName: string = "cubane-cache";
	private dbVersion: number = 1;

	// Block entity mapping
	private blockEntityMap: Record<string, string> = {
		"minecraft:chest": "chest",
		"minecraft:trapped_chest": "trapped_chest",
		"minecraft:ender_chest": "ender_chest",
		"minecraft:bell": "bell",
	};

	/**
	 * Create a new Cubane renderer
	 */
	constructor() {
		this.assetLoader = new AssetLoader();
		this.modelResolver = new ModelResolver(this.assetLoader);
		this.blockMeshBuilder = new BlockMeshBuilder(this.assetLoader);
		this.entityRenderer = new EntityRenderer();

		// Initialize components
		this.initPromise = Promise.resolve().then(() => {
			this.initialized = true;
		});
	}

	/**
	 * Initialize the IndexedDB database
	 * @private
	 */
	private async initDatabase(): Promise<IDBDatabase> {
		if (this.db) return this.db;

		// Check if IndexedDB is supported
		if (!window.indexedDB) {
			console.error("Cubane: IndexedDB is not supported in this browser");
			throw new Error("IndexedDB not supported");
		}

		console.log("Cubane: Initializing IndexedDB database");

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.dbVersion);

			request.onerror = (event) => {
				console.error("Cubane: IndexedDB error:", event);
				reject(new Error("Failed to open IndexedDB"));
			};

			request.onsuccess = (event) => {
				this.db = request.result;
				console.log("Cubane: IndexedDB opened successfully");

				// Test if database is accessible
				try {
					const testTransaction = this.db.transaction(
						["resourcePacks"],
						"readonly"
					);
					console.log("Cubane: IndexedDB test transaction successful");
				} catch (err) {
					console.warn("Cubane: IndexedDB test transaction failed:", err);
				}

				resolve(this.db);
			};

			request.onupgradeneeded = (event) => {
				const db = request.result;
				console.log("Cubane: Upgrading database schema");

				// Create resource packs store
				if (!db.objectStoreNames.contains("resourcePacks")) {
					const store = db.createObjectStore("resourcePacks", {
						keyPath: "id",
					});
					store.createIndex("timestamp", "timestamp", { unique: false });
					console.log("Cubane: Created resourcePacks store");
				}
			};
		});
	}

	/**
	 * Store a resource pack in IndexedDB
	 * @private
	 */
	private async storeResourcePack(packId: string, blob: Blob): Promise<void> {
		try {
			const db = await this.initDatabase();

			return new Promise((resolve, reject) => {
				const transaction = db.transaction(["resourcePacks"], "readwrite");
				const store = transaction.objectStore("resourcePacks");

				const item = {
					id: packId,
					blob: blob,
					timestamp: Date.now(),
				};

				const request = store.put(item);

				request.onsuccess = () => resolve();
				request.onerror = () =>
					reject(new Error("Failed to store resource pack"));
			});
		} catch (error) {
			console.error("Error storing resource pack:", error);
			// Silently fail on storage errors - we can still use the blob directly
		}
	}

	/**
	 * Get a resource pack from IndexedDB
	 * @private
	 */
	private async getResourcePackFromCache(
		packId: string,
		expirationTime?: number | null
	): Promise<Blob | null> {
		try {
			const db = await this.initDatabase();

			return new Promise((resolve, reject) => {
				const transaction = db.transaction(["resourcePacks"], "readonly");
				const store = transaction.objectStore("resourcePacks");

				const request = store.get(packId);

				request.onsuccess = () => {
					const data = request.result;

					if (!data) {
						resolve(null);
						return;
					}

					// Check if cached item is expired
					if (expirationTime && Date.now() - data.timestamp > expirationTime) {
						console.log(
							`Cached resource pack ${packId} is expired, will reload`
						);
						resolve(null);
						return;
					}

					resolve(data.blob);
				};

				request.onerror = () => {
					console.error("Error reading from cache:", request.error);
					resolve(null); // Resolve with null on error to continue with direct loading
				};
			});
		} catch (error) {
			console.error("Error getting resource pack from cache:", error);
			return null;
		}
	}

	/**
	 * Clean up expired resource packs
	 * @private
	 */
	private async cleanupExpiredResourcePacks(
		expirationTime: number
	): Promise<void> {
		try {
			const db = await this.initDatabase();

			const transaction = db.transaction(["resourcePacks"], "readwrite");
			const store = transaction.objectStore("resourcePacks");
			const index = store.index("timestamp");

			const cutoffTime = Date.now() - expirationTime;

			const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));

			request.onsuccess = (event) => {
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

	/**
	 * Load a Minecraft resource pack with caching support
	 * @param options Options for loading the resource pack, or a direct Blob
	 * @param loader Callback function to get the Blob if not found in cache
	 */
	/**
	 * Load a Minecraft resource pack with caching support
	 * @param options Options for loading the resource pack, or a direct Blob
	 * @param loader Callback function to get the Blob if not found in cache
	 */
	public async loadResourcePack(
		options: ResourcePackLoadOptions | Blob,
		loader?: ResourcePackLoader
	): Promise<void> {
		if (!this.initialized) {
			await this.initPromise;
		}

		// If options is a Blob, use it directly with no caching
		if (options instanceof Blob) {
			console.log("Cubane: Using direct blob (no caching)");
			await this.assetLoader.loadResourcePack(options);
			return;
		}

		// Default options
		const defaultOptions: ResourcePackLoadOptions = {
			packId: `pack_${Date.now()}`,
			useCache: true,
			forceReload: false,
			cacheExpiration: 7 * 24 * 60 * 60 * 1000, // 7 days
		};

		const finalOptions = { ...defaultOptions, ...options };
		console.log("Cubane: Resource pack options:", finalOptions);

		let resourcePackBlob: Blob | null = null;
		let loadedFromCache = false;

		// Try to get from cache if enabled and not forcing reload
		if (finalOptions.useCache && !finalOptions.forceReload) {
			try {
				console.log(`Cubane: Checking cache for pack "${finalOptions.packId}"`);
				resourcePackBlob = await this.getResourcePackFromCache(
					finalOptions.packId!,
					finalOptions.cacheExpiration
				);

				if (resourcePackBlob) {
					console.log(
						`Cubane: ✅ Loaded pack "${
							finalOptions.packId
						}" from cache (${Math.round(resourcePackBlob.size / 1024)} KB)`
					);
					loadedFromCache = true;
				} else {
					console.log(
						`Cubane: ❌ Pack "${finalOptions.packId}" not found in cache`
					);
				}
			} catch (error) {
				console.warn("Cubane: Error accessing IndexedDB cache:", error);
				// Continue with direct loading
			}
		} else {
			console.log(
				`Cubane: Skipping cache ${
					finalOptions.forceReload ? "(forceReload=true)" : "(useCache=false)"
				}`
			);
		}

		// If not found in cache or not using cache, get it from loader
		if (!resourcePackBlob) {
			if (!loader) {
				throw new Error(
					"No resource pack loader provided and pack not found in cache"
				);
			}

			console.log("Cubane: Loading resource pack from loader");
			resourcePackBlob = await loader();
			console.log(
				`Cubane: Resource pack loaded from loader (${Math.round(
					resourcePackBlob.size / 1024
				)} KB)`
			);

			// Store in cache if caching is enabled
			if (finalOptions.useCache) {
				console.log(
					`Cubane: Storing resource pack in cache as "${finalOptions.packId}"`
				);
				this.storeResourcePack(finalOptions.packId!, resourcePackBlob)
					.then(() => console.log(`Cubane: ✅ Successfully stored in cache`))
					.catch((error) =>
						console.warn("Cubane: Failed to cache resource pack:", error)
					);

				// Clean up expired packs in the background
				if (finalOptions.cacheExpiration) {
					this.cleanupExpiredResourcePacks(finalOptions.cacheExpiration).catch(
						(error) =>
							console.warn("Cubane: Failed to clean up expired packs:", error)
					);
				}
			}
		}

		// Load the resource pack
		await this.assetLoader.loadResourcePack(resourcePackBlob);

		// Set a property for external code to check
		this.lastPackLoadedFromCache = loadedFromCache;
	}

	/**
	 * List all resource packs available in the cache
	 * @returns Array of cached pack information
	 */
	public async listCachedResourcePacks(): Promise<
		Array<{
			id: string;
			name: string;
			size: number;
			timestamp: number;
		}>
	> {
		try {
			const db = await this.initDatabase();

			return new Promise((resolve, reject) => {
				const transaction = db.transaction(["resourcePacks"], "readonly");
				const store = transaction.objectStore("resourcePacks");
				const request = store.openCursor();

				const results: Array<{
					id: string;
					name: string;
					size: number;
					timestamp: number;
				}> = [];

				request.onsuccess = (event) => {
					const cursor = request.result;
					if (cursor) {
						// Extract basic info without the actual blob to save memory
						const { id, timestamp } = cursor.value;
						const blob = cursor.value.blob;
						const size = blob.size;
						const name = id.replace(/^cubane_pack_/, "").replace(/_/g, " ");

						results.push({ id, name, size, timestamp });
						cursor.continue();
					} else {
						// Sort by most recently used
						results.sort((a, b) => b.timestamp - a.timestamp);
						resolve(results);
					}
				};

				request.onerror = () => {
					reject(new Error("Failed to list cached resource packs"));
				};
			});
		} catch (error) {
			console.error("Error listing cached resource packs:", error);
			return [];
		}
	}

	/**
	 * Load the most recent resource pack from cache
	 * @returns True if a pack was loaded, false otherwise
	 */
	public async loadMostRecentPack(): Promise<boolean> {
		try {
			const packs = await this.listCachedResourcePacks();

			if (packs.length === 0) {
				console.log("No cached resource packs available");
				return false;
			}

			// Get the most recent pack (already sorted)
			const mostRecent = packs[0];
			console.log(`Found most recent pack: ${mostRecent.name}`, mostRecent);

			// Load it from cache
			await this.loadResourcePack(
				{
					packId: mostRecent.id,
					useCache: true,
					forceReload: false,
				},
				async () => {
					throw new Error("Pack not found in cache");
				}
			);

			console.log(`Successfully loaded cached pack: ${mostRecent.name}`);
			return true;
		} catch (error) {
			console.error("Error loading most recent pack:", error);
			return false;
		}
	}

	/**
	 * Load a resource pack by ID from cache
	 * @param packId The ID of the resource pack to load
	 * @returns True if successfully loaded, false otherwise
	 */
	public async loadCachedPack(packId: string): Promise<boolean> {
		try {
			await this.loadResourcePack(
				{
					packId,
					useCache: true,
					forceReload: false,
				},
				async () => {
					throw new Error(`Pack ${packId} not found in cache`);
				}
			);

			return true;
		} catch (error) {
			console.error(`Error loading cached pack ${packId}:`, error);
			return false;
		}
	}

	/**
	 * Delete a resource pack from cache
	 * @param packId The ID of the resource pack to delete
	 */
	public async deleteCachedPack(packId: string): Promise<boolean> {
		try {
			const db = await this.initDatabase();

			return new Promise((resolve, reject) => {
				const transaction = db.transaction(["resourcePacks"], "readwrite");
				const store = transaction.objectStore("resourcePacks");
				const request = store.delete(packId);

				request.onsuccess = () => resolve(true);
				request.onerror = () =>
					reject(new Error(`Failed to delete pack ${packId}`));
			});
		} catch (error) {
			console.error(`Error deleting pack ${packId}:`, error);
			return false;
		}
	}

	// Add a property to track if the last load was from cache
	public lastPackLoadedFromCache: boolean = false;

	/**
	 * Get a Three.js mesh for a Minecraft block
	 * @param blockString Block string like "minecraft:oak_log[axis=y]"
	 * @param biome Optional biome identifier for tinting, defaults to "plains"
	 * @param position Optional position for the block
	 */
	public async getBlockMesh(
		blockString: string,
		biome: string = "plains",
		position?: THREE.Vector3
	): Promise<THREE.Object3D> {
		if (!this.initialized) {
			await this.initPromise;
		}

		try {
			console.log(`Creating mesh for block: ${blockString}`);

			// Parse block string
			const block = this.parseBlockString(blockString);
			console.log("Parsed block:", block);

			// Check if this is a block entity
			const blockId = `${block.namespace}:${block.name}`;
			if (this.blockEntityMap[blockId]) {
				return this.getEntityMesh(this.blockEntityMap[blockId]);
			}

			// Resolve model data
			const modelDataList = await this.modelResolver.resolveBlockModel(block);
			console.log("Resolved model data:", modelDataList);

			if (modelDataList.length === 0) {
				console.warn(`No models found for block: ${blockString}`);
				return this.createFallbackMesh();
			}

			// Get meshes for all models
			const objectPromises = modelDataList.map(async (modelData) => {
				try {
					// Load model
					const model = await this.assetLoader.getModel(modelData.model);
					console.log(`Loaded model ${modelData.model}:`, model);

					// Create mesh - passing the block and biome
					return await this.blockMeshBuilder.createBlockMesh(
						model,
						{
							x: modelData.x,
							y: modelData.y,
							uvlock: modelData.uvlock,
						},
						block,
						biome
					);
				} catch (error) {
					console.error(
						`Error creating mesh for model ${modelData.model}:`,
						error
					);
					return null;
				}
			});

			// Wait for all objects
			const objects = (await Promise.all(objectPromises)).filter(
				Boolean
			) as THREE.Object3D[];

			if (objects.length === 0) {
				console.warn(`Failed to create any meshes for block: ${blockString}`);
				return this.createFallbackMesh();
			}

			// If only one object, return it
			if (objects.length === 1) {
				const obj = objects[0];
				if (position) {
					obj.position.copy(position);
				}
				return obj;
			}

			// For multiple objects, create a parent group
			const group = new THREE.Group();
			objects.forEach((obj) => group.add(obj.clone()));

			// Store block and biome information
			(group as any).blockData = block;
			(group as any).biome = biome;
			if (position) {
				group.position.copy(position);
			}

			// Set name for debugging
			group.name = `block_${block.name.replace("minecraft:", "")}`;

			return group;
		} catch (error) {
			console.error(`Error creating block mesh:`, error);
			return this.createFallbackMesh();
		}
	}

	/**
	 * Get a Three.js mesh for a Minecraft entity
	 * @param entityType Entity type name (e.g., "chest", "creeper")
	 * @param position Optional position for the entity
	 */
	public async getEntityMesh(
		entityType: string,
		position?: THREE.Vector3
	): Promise<THREE.Object3D> {
		if (!this.initialized) {
			await this.initPromise;
		}

		try {
			console.log(`Creating mesh for entity: ${entityType}`);

			// Get entity mesh
			const mesh = await this.entityRenderer.createEntityMesh(entityType);

			if (position) {
				mesh.position.copy(position);
			}

			// Set name for debugging
			mesh.name = `entity_${entityType}`;

			return mesh;
		} catch (error) {
			console.error(`Error creating entity mesh:`, error);
			return this.createFallbackMesh();
		}
	}

	/**
	 * Register a custom block entity mapping
	 * @param blockId Block ID like "minecraft:chest"
	 * @param entityType Entity type to render
	 */
	public registerBlockEntity(blockId: string, entityType: string): void {
		this.blockEntityMap[blockId] = entityType;
	}

	/**
	 * Update all animated textures (call in your render loop)
	 */
	public updateAnimations(): void {
		this.assetLoader.updateAnimations();
	}

	/**
	 * Parse a block string into structured data
	 * @private
	 */
	private parseBlockString(blockString: string): Block {
		const result: Block = {
			namespace: "minecraft",
			name: "",
			properties: {},
		};

		// Parse namespace and name
		const namespaceParts = blockString.split(":");
		if (namespaceParts.length > 1) {
			result.namespace = namespaceParts[0];
			const remaining = namespaceParts[1];

			// Parse properties if they exist
			const propertyIndex = remaining.indexOf("[");
			if (propertyIndex !== -1) {
				result.name = remaining.substring(0, propertyIndex);
				const propertiesString = remaining.substring(
					propertyIndex + 1,
					remaining.length - 1
				);

				// Split properties by comma and extract key-value pairs
				propertiesString.split(",").forEach((prop) => {
					const [key, value] = prop.split("=");
					if (key && value) {
						result.properties[key.trim()] = value.trim();
					}
				});
			} else {
				result.name = remaining;
			}
		} else {
			result.name = blockString;
		}

		return result;
	}

	/**
	 * Create a fallback mesh for when block/entity creation fails
	 * @private
	 */
	private createFallbackMesh(): THREE.Mesh {
		return new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
		);
	}

	/**
	 * Get the asset loader instance
	 * For advanced use cases
	 */
	public getAssetLoader(): AssetLoader {
		return this.assetLoader;
	}

	/**
	 * Get the block mesh builder instance
	 * For advanced use cases
	 */
	public getBlockMeshBuilder(): BlockMeshBuilder {
		return this.blockMeshBuilder;
	}

	/**
	 * Get the entity renderer instance
	 * For advanced use cases
	 */
	public getEntityRenderer(): EntityRenderer {
		return this.entityRenderer;
	}

	/**
	 * Clean up resources when done
	 */
	public dispose(): void {
		this.assetLoader.dispose();
	}
}
