// Entity model interfaces
export interface EntityModel {
	textureSize: [number, number];
	models: EntityModelPart[];
	texture?: string;
}

export interface EntityModelPart {
	id: string;
	part: string;
	invertAxis?: string;
	translate?: [number, number, number];
	rotate?: [number, number, number];
	mirrorTexture?: string;
	boxes?: EntityModelBox[];
	submodels?: EntityModelPart[];
}

export interface EntityModelBox {
	coordinates: [number, number, number, number, number, number]; // [x, y, z, width, height, depth]
	textureOffset?: [number, number];
	sizeAdd?: number;
	sizesAdd?: [number, number, number];
	uvDown?: [number, number, number, number];
	uvUp?: [number, number, number, number];
	uvNorth?: [number, number, number, number];
	uvSouth?: [number, number, number, number];
	uvWest?: [number, number, number, number];
	uvEast?: [number, number, number, number];
}
