#!/usr/bin/env python3
"""
Process Wynem CEM template data into a structured format with textures.
Creates a JSON file with entities, models, and base64-encoded textures.
Includes caching to avoid redownloading assets.
"""

import json
import pathlib
import urllib.request
import base64
import time
import os
from typing import Dict, List, Any, Optional

# Source URL for the CEM template models
SOURCE_URL = "https://wynem.com/assets/json/cem_template_models.json"
TEXTURE_BASE_URL = "https://wynem.com/assets/images/minecraft/entities/"
OUTPUT_FILE = "minecraft_entities.json"  # Output file
CACHE_DIR = pathlib.Path("cache")  # Cache directory for downloaded assets
CACHE_DIR.mkdir(exist_ok=True)  # Create cache directory if it doesn't exist
TEXTURE_CACHE_DIR = CACHE_DIR / "textures"
TEXTURE_CACHE_DIR.mkdir(
    exist_ok=True
)  # Create texture cache directory if it doesn't exist

# Browser-like headers to avoid 403 Forbidden errors
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive",
    "Referer": "https://wynem.com/",
    "Upgrade-Insecure-Requests": "1",
}


def download_source_data() -> dict:
    """Download the CEM template data from Wynem's website with caching."""
    cache_file = CACHE_DIR / "cem_template_models.json"

    # Check if the file exists in cache
    if cache_file.exists():
        print(f"Loading data from cache: {cache_file}")
        return json.loads(cache_file.read_text())

    print(f"Downloading data from {SOURCE_URL}...")

    # Create a request with custom headers
    req = urllib.request.Request(SOURCE_URL, headers=HEADERS)

    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode("utf-8"))

        # Save to cache
        cache_file.write_text(json.dumps(data))
        print(f"Saved data to cache: {cache_file}")

        return data


def download_texture(entity_name: str) -> Optional[str]:
    """Download texture based on entity name and convert to base64 string with caching."""
    # Create safe filename for cache
    safe_name = entity_name.replace("/", "_").replace("\\", "_")
    cache_file = TEXTURE_CACHE_DIR / f"{safe_name}.png"

    # Check if texture exists in cache
    if cache_file.exists():
        print(f"Loading texture from cache: {cache_file}")
        with open(cache_file, "rb") as f:
            texture_data = f.read()
            base64_str = base64.b64encode(texture_data).decode("utf-8")
            return base64_str

    url = f"{TEXTURE_BASE_URL}{entity_name}.png"

    try:
        print(f"Downloading texture from {url}...")
        # Create a request with custom headers
        req = urllib.request.Request(url, headers=HEADERS)

        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                texture_data = response.read()

                # Save to cache
                with open(cache_file, "wb") as f:
                    f.write(texture_data)
                print(f"Saved texture to cache: {cache_file}")

                # Convert to base64
                base64_str = base64.b64encode(texture_data).decode("utf-8")
                return base64_str
    except Exception as e:
        print(f"Error downloading from {url}: {e}")

    print(f"Failed to download texture for {entity_name}")
    return None


def process_entity(entity_entry: Any) -> dict:
    """Process an entity entry (can be string or dict) into a structured format."""
    # If entity is just a string, it's a simple entity with the same name for model and texture
    if isinstance(entity_entry, str):
        return {
            "name": entity_entry,
            "model": entity_entry,
            "texture": entity_entry,
            "variants": [],
        }

    # Otherwise, it's a complex entity with additional information
    # Make sure we're dealing with a dictionary
    if not isinstance(entity_entry, dict):
        print(
            f"WARNING: Unexpected entity format: {type(entity_entry)}, {entity_entry}"
        )
        # Return a minimal valid entity to avoid breaking the script
        return {
            "name": "unknown",
            "model": "unknown",
            "texture": "unknown",
            "variants": [],
        }

    result = {
        "name": entity_entry.get("name", "unknown"),
        "model": entity_entry.get("model", entity_entry.get("name", "unknown")),
        "texture": entity_entry.get(
            "texture_name", entity_entry.get("name", "unknown")
        ),
        "variants": [],
    }

    # Process variants if any
    if "variants" in entity_entry and isinstance(entity_entry["variants"], list):
        for variant in entity_entry["variants"]:
            if not isinstance(variant, dict):
                print(f"WARNING: Unexpected variant format: {type(variant)}, {variant}")
                continue

            variant_entry = {
                "name": variant.get("name", "unknown_variant"),
                "display_name": variant.get(
                    "display_name", variant.get("name", "unknown_variant")
                ),
                "model": variant.get("model", result["model"]),
                "texture": variant.get("texture_name", result["texture"]),
            }
            result["variants"].append(variant_entry)

    return result


def main() -> None:
    try:
        # Download source data
        source_data = download_source_data()

        # Initialize output structure
        output = {"entities": [], "entity_models": {}, "entity_textures": {}}

        texture_download_count = 0
        error_count = 0

        # Process all categories and entities
        for category in source_data.get("categories", []):
            if not isinstance(category, dict):
                print(f"WARNING: Unexpected category format: {type(category)}")
                continue

            print(f"Processing category: {category.get('name', 'Unknown')}")
            entities_list = category.get("entities", [])

            if not isinstance(entities_list, list):
                print(f"WARNING: 'entities' is not a list: {type(entities_list)}")
                continue

            for entity_entry in entities_list:
                try:
                    entity = process_entity(entity_entry)
                    output["entities"].append(entity)

                    # Add entity's model
                    model_name = entity["model"]
                    if model_name in source_data.get("models", {}):
                        model_data = source_data["models"][model_name]
                        if isinstance(model_data, dict) and "model" in model_data:
                            try:
                                output["entity_models"][model_name] = json.loads(
                                    model_data["model"]
                                )
                            except json.JSONDecodeError as e:
                                print(f"Error parsing model JSON for {model_name}: {e}")

                    # Download and add entity's texture - using entity name for URL
                    entity_name = entity["name"]
                    if entity_name not in output["entity_textures"]:
                        texture_data = download_texture(entity_name)
                        if texture_data:
                            output["entity_textures"][entity_name] = texture_data
                            texture_download_count += 1
                            # Sleep briefly to avoid overloading the server
                            time.sleep(0.2)

                    # Add potential variants' models and textures
                    for variant in entity["variants"]:
                        # Handle variant model
                        variant_model = variant["model"]
                        if (
                            variant_model != model_name
                            and variant_model in source_data.get("models", {})
                        ):
                            model_data = source_data["models"][variant_model]
                            if isinstance(model_data, dict) and "model" in model_data:
                                try:
                                    output["entity_models"][variant_model] = json.loads(
                                        model_data["model"]
                                    )
                                except json.JSONDecodeError as e:
                                    print(
                                        f"Error parsing model JSON for variant {variant_model}: {e}"
                                    )

                        # Handle variant texture - using variant name for URL
                        variant_name = variant["name"]
                        if variant_name not in output["entity_textures"]:
                            texture_data = download_texture(variant_name)
                            if texture_data:
                                output["entity_textures"][variant_name] = texture_data
                                texture_download_count += 1
                                # Sleep briefly to avoid overloading the server
                                time.sleep(0.2)

                except Exception as e:
                    print(f"Error processing entity {entity_entry}: {e}")
                    error_count += 1

        # Write output to file
        output_path = pathlib.Path(OUTPUT_FILE)
        output_path.write_text(json.dumps(output, indent=2, sort_keys=False))

        print(f"\nDone – Processed data written to {OUTPUT_FILE}")
        print(f"- Found {len(output['entities'])} entities")
        print(f"- Found {len(output['entity_models'])} models")
        print(f"- Downloaded {texture_download_count} textures")
        if error_count > 0:
            print(f"- Encountered {error_count} errors during processing")

    except Exception as e:
        print(f"Fatal error: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    main()
