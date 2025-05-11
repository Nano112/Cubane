import os
import glob
import json
import base64
import tempfile
from pygltflib import GLTF2


def create_base64_model_mapping(input_dir, output_json):
    """
    Creates a JSON file mapping model names to their Base64 encoded glTF data
    """
    model_mapping = {}
    gltf_files = glob.glob(os.path.join(input_dir, "*.gltf"))
    total_files = len(gltf_files)

    for i, file_path in enumerate(gltf_files):
        # Get the filename without extension as the key
        filename = os.path.splitext(os.path.basename(file_path))[0]

        print(f"Processing {i+1}/{total_files}: {filename}...")

        try:
            # Load the glTF file
            gltf = GLTF2().load(file_path)

            # Create a temporary file to save the GLB
            temp_dir = tempfile.gettempdir()
            tmp_filename = os.path.join(temp_dir, f"{filename}_temp.glb")

            # Save as GLB to the temporary file
            gltf.save_binary(tmp_filename)

            # Read the binary data
            with open(tmp_filename, "rb") as f:
                glb_data = f.read()

            # Delete the temporary file
            os.remove(tmp_filename)

            # Encode as Base64
            base64_data = base64.b64encode(glb_data).decode("utf-8")

            # Add to mapping
            model_mapping[filename] = base64_data

            size_kb = len(base64_data) / 1024
            print(f"Successfully processed {filename} - {size_kb:.2f} KB")

        except Exception as e:
            print(f"Error processing {filename}: {str(e)}")

    # Save the mapping to a JSON file
    with open(output_json, "w") as f:
        json.dump(model_mapping, f)

    print(f"Created model mapping with {len(model_mapping)} models at {output_json}")
    print(f"Total JSON size: {os.path.getsize(output_json) / (1024 * 1024):.2f} MB")


# Usage
create_base64_model_mapping("./gltf", "./models.json")
