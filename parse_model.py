#!/usr/bin/env python3
"""
Unescape Wynem CEM‑template models.
Writes every inner OptiFine JSON to:   output/<model_name>.json
No textures are exported.
"""

import json, pathlib

# sourced from https://wynem.com/assets/json/cem_template_models.json
SRC = "models.json"  # change if your file lives elsewhere
DEST = pathlib.Path("models")  # flat output directory

DEST.mkdir(exist_ok=True)


def write_pretty_copy(root: dict) -> None:
    """Pretty‑prints the original file once for reference."""
    (DEST / "_pretty_models.json").write_text(
        json.dumps(root, indent=2, sort_keys=True)
    )


def dump_model(name: str, raw: str) -> None:
    """Unescape the inner JSON and write it out prettily."""
    try:
        model = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"! {name}: invalid JSON in 'model' – {e}")
        return

    (DEST / f"{name}.json").write_text(json.dumps(model, indent=2, sort_keys=True))
    print(f"• wrote  {name}.json")


def main() -> None:
    root = json.loads(pathlib.Path(SRC).read_text())
    write_pretty_copy(root)

    for name, entry in root.get("models", {}).items():
        if "model" in entry:
            dump_model(name, entry["model"])

    print("\nDone – unescaped models are in", DEST.resolve())


if __name__ == "__main__":
    main()
