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

	// Block entity mapping for blocks that are *purely* entities
	private pureBlockEntityMap: Record<string, string> = {
		"minecraft:chest": "chest",
		"minecraft:trapped_chest": "trapped_chest",
		"minecraft:ender_chest": "ender_chest",
		// Note: "minecraft:bell" is removed from here as it's now hybrid
	};

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

	public async getBlockMesh(
		blockString: string,
		biome: string = "plains"
	): Promise<THREE.Object3D> {
		if (!this.initialized) {
			await this.initPromise;
		}

		// console.log(`Cubane: Creating mesh for block: ${blockString}`);
		const block = this.parseBlockString(blockString);
		const blockId = `${block.namespace}:${block.name}`;

		// Handle pure entity blocks first
		if (this.pureBlockEntityMap[blockId]) {
			// console.log(`Cubane: Rendering ${blockId} as pure entity: ${this.pureBlockEntityMap[blockId]}`);
			return this.getEntityMesh(this.pureBlockEntityMap[blockId]);
		}

		// Create a root group for the combined mesh (static + dynamic)
		const rootGroup = new THREE.Group();
		rootGroup.name = `block_${block.name.replace("minecraft:", "")}`;
		(rootGroup as any).blockData = block; // Store block data for main.ts
		(rootGroup as any).biome = biome;

		// Attempt to render the static JSON model part
		let staticModelRendered = false;
		try {
			const modelDataList = await this.modelResolver.resolveBlockModel(block);
			if (modelDataList.length > 0) {
				const objectPromises = modelDataList.map(async (modelData) => {
					try {
						const modelJson = await this.assetLoader.getModel(modelData.model);
						return await this.blockMeshBuilder.createBlockMesh(
							modelJson,
							{ x: modelData.x, y: modelData.y, uvlock: modelData.uvlock },
							block,
							biome
						);
					} catch (modelError) {
						console.error(
							`Error creating mesh for sub-model ${modelData.model}:`,
							modelError
						);
						return null;
					}
				});
				const staticParts = (await Promise.all(objectPromises)).filter(
					Boolean
				) as THREE.Object3D[];

				if (staticParts.length === 1) {
					rootGroup.add(staticParts[0]);
				} else if (staticParts.length > 1) {
					// If resolveBlockModel returns multiple models (e.g. multipart),
					// BlockMeshBuilder should ideally return a single group for each,
					// or this logic needs to handle combining them.
					// For now, assuming createBlockMesh returns a single root for its model.
					staticParts.forEach((part) => rootGroup.add(part));
				}
				staticModelRendered = rootGroup.children.length > 0;
			}
		} catch (error) {
			console.warn(
				`Cubane: Error resolving/rendering static model for ${blockId}:`,
				error
			);
		}

		// Check for and render dynamic parts if it's a hybrid block
		if (this.hybridBlockConfig[blockId]) {
			// console.log(`Cubane: Rendering dynamic parts for hybrid block ${blockId}`);
			const dynamicPartsConfig = this.hybridBlockConfig[blockId];
			for (const partConfig of dynamicPartsConfig) {
				try {
					const dynamicMesh = await this.getEntityMesh(partConfig.entityType);
					if (dynamicMesh) {
						if (partConfig.offset) {
							dynamicMesh.position.set(
								partConfig.offset[0],
								partConfig.offset[1],
								partConfig.offset[2]
							);
						}
						if (partConfig.rotation) {
							dynamicMesh.rotation.set(
								THREE.MathUtils.degToRad(partConfig.rotation[0]),
								THREE.MathUtils.degToRad(partConfig.rotation[1]),
								THREE.MathUtils.degToRad(partConfig.rotation[2])
							);
						}
						// Tag it for animation updates if necessary
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

		// If nothing was rendered (neither static nor dynamic for a hybrid), return fallback
		if (rootGroup.children.length === 0) {
			console.warn(
				`Cubane: No parts rendered for ${blockId}, returning fallback.`
			);
			return this.createFallbackMesh();
		}

		return rootGroup;
	}

	public async getEntityMesh(entityType: string): Promise<THREE.Object3D> {
		if (!this.initialized) {
			await this.initPromise;
		}
		try {
			// console.log(`Cubane: Creating mesh for entity: ${entityType}`);
			const mesh = await this.entityRenderer.createEntityMesh(
				entityType,
				this.assetLoader
			); // Pass AssetLoader if needed
			if (!mesh) {
				console.warn(`No mesh created by EntityRenderer for: ${entityType}`);
				return this.createFallbackMesh("entity_" + entityType);
			}
			mesh.name = `entity_${entityType}`;
			return mesh;
		} catch (error) {
			console.error(`Error creating entity mesh ${entityType}:`, error);
			return this.createFallbackMesh("entity_" + entityType);
		}
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
	}
}
