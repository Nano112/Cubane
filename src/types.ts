export interface ModelData {
	model: string;
	x?: number;
	y?: number;
	uvlock?: boolean;
}

export interface Block {
	namespace: string;
	name: string;
	properties: Record<string, string>;
}

export interface TextureAnimationMetadata {
	animation: {
		frametime?: number; // How long each frame lasts (in ticks, default: 1)
		frames?: number[]; // Optional custom frame order
		interpolate?: boolean; // Whether to interpolate between frames
		width?: number; // Optional frame width
		height?: number; // Optional frame height
	};
}

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

export interface ResourcePackLoadOptions {
	/** Unique ID for this resource pack in the cache */
	packId?: string;
	/** Whether to use IndexedDB caching (default: true) */
	useCache?: boolean;
	/** Whether to ignore existing cache and force reloading (default: false) */
	forceReload?: boolean;
	/** Time in milliseconds to expire cache (default: 7 days) */
	cacheExpiration?: number | null;
}

/**
 * Callback to get the resource pack blob if not found in cache
 */
export type ResourcePackLoader = () => Promise<Blob>;
