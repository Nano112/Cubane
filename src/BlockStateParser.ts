/**
 * Parses a block string like "minecraft:oak_log[axis=y]" into structured data
 */
export interface Block {
	namespace: string;
	name: string;
	properties: Record<string, string>;
}

export function parseBlockString(blockString: string): Block {
	// Default values
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
