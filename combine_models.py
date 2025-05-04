#!/usr/bin/env python3
"""
Combine individual model JSON files into a single JSON file.
Reads all JSON files from input directory and combines them into a single models.json file.
"""

import json
import pathlib
from typing import Dict, Any

# Source directory containing individual model JSON files
SRC_DIR = pathlib.Path("models")  # directory with individual model files
OUTPUT_FILE = "combined_models.json"  # output file name


def read_model_files(directory: pathlib.Path) -> Dict[str, Any]:
    """Read all JSON files from the directory and combine them into a single dictionary."""
    combined_models = {"models": {}}

    for json_file in directory.glob("*.json"):
        # Skip the pretty-printed reference file if it exists
        if json_file.name == "_pretty_models.json":
            continue

        try:
            # Read the model data
            model_data = json.loads(json_file.read_text())

            # Use the filename (without extension) as the model name
            model_name = json_file.stem

            # Add the model to the combined dictionary, escaping it as a JSON string
            combined_models["models"][model_name] = {"model": json.dumps(model_data)}

            print(f"• Added {model_name} to combined file")

        except json.JSONDecodeError as e:
            print(f"! Error reading {json_file.name}: {e}")
            continue

    return combined_models


def main() -> None:
    if not SRC_DIR.exists() or not SRC_DIR.is_dir():
        print(
            f"Error: Source directory '{SRC_DIR}' does not exist or is not a directory."
        )
        return

    # Get all models from individual files
    combined_data = read_model_files(SRC_DIR)

    # Write the combined data to the output file
    output_path = pathlib.Path(OUTPUT_FILE)
    output_path.write_text(json.dumps(combined_data, indent=2, sort_keys=True))

    print(f"\nDone – Combined {len(combined_data['models'])} models into {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
