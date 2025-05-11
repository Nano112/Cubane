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
