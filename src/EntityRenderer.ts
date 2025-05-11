import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import models from "./models.json";

export class EntityRenderer {
    private debug: boolean = false;
    private loader: GLTFLoader;
    private modelCache: Map<string, THREE.Object3D> = new Map();

    constructor() {
        this.loader = new GLTFLoader();
    }

    /**
     * Create a THREE.js mesh for the given entity
     */
    public async createEntityMesh(
        entityName: string
    ): Promise<THREE.Object3D | null> {
        // Check cache first
        if (this.modelCache.has(entityName)) {
            if (this.debug) console.log(`Using cached model for ${entityName}`);
            return this.modelCache.get(entityName)!.clone();
        }

        // Check if the model exists
        if (!(models as Record<string, string>)[entityName]) {
            console.warn(`Model for entity "${entityName}" not found`);
            return null;
        }

        try {
            // Get the base64 model data
            const base64Data = (models as Record<string, string>)[entityName];

            // Convert base64 to binary data
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);

            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Load the model using GLTFLoader
            return new Promise((resolve, reject) => {
                this.loader.parse(
                    bytes.buffer,
                    "",
                    (gltf: { scene: THREE.Object3D }) => {
                        if (this.debug) {
                            console.log(`Loaded entity model: ${entityName}`);
                        }

                        // Apply any transformations or setup here if needed
                        const model = gltf.scene;

                        // Cache the original model
                        this.modelCache.set(entityName, model);

                        // Return a clone to avoid reference issues
                        resolve(model.clone());
                    },
                    (error: any) => {
                        console.error(`Error loading entity model ${entityName}:`, error);
                        reject(error);
                    }
                );
            });
        } catch (error) {
            console.error(`Failed to create mesh for entity ${entityName}:`, error);
            return null;
        }
    }

    /**
     * Preload specific models for better performance
     */
    public async preloadModels(entityNames: string[]): Promise<void> {
        const promises = entityNames.map((name) => this.createEntityMesh(name));
        await Promise.all(promises);
        if (this.debug) console.log(`Preloaded ${entityNames.length} models`);
    }

    /**
     * Set debug mode
     */
    public setDebug(debug: boolean): void {
        this.debug = debug;
    }
}