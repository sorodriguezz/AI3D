#!/usr/bin/env python3
"""Fija la versión de la app en todos los archivos donde se declara.

Uso: python3 scripts/bump_version.py 0.2.0
Luego: git commit -am "Release v0.2.0" && git tag v0.2.0 && git push --follow-tags
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        raise SystemExit("uso: bump_version.py X.Y.Z")
    v = sys.argv[1]

    for rel in ("src-tauri/tauri.conf.json", "package.json"):
        path = ROOT / rel
        data = json.loads(path.read_text())
        data["version"] = v
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    lock = ROOT / "package-lock.json"
    if lock.exists():
        data = json.loads(lock.read_text())
        data["version"] = v
        data.get("packages", {}).get("", {})["version"] = v
        lock.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    cargo = ROOT / "src-tauri/Cargo.toml"
    cargo.write_text(re.sub(r'(?m)^version = "[^"]+"', f'version = "{v}"', cargo.read_text(), count=1))

    print(f"versión fijada en {v}")
    print(f'siguiente: git commit -am "Release v{v}" && git tag v{v} && git push --follow-tags')


if __name__ == "__main__":
    main()
