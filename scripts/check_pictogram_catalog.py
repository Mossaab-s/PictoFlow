"""Check the shared catalog contract without importing either application runtime."""

import ast
import re
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    source = ast.parse(
        (root / "backend/app/domain/pcl/pictograms.py").read_text(encoding="utf-8")
    )
    enum = next(
        node
        for node in source.body
        if isinstance(node, ast.ClassDef) and node.name == "PictogramKey"
    )
    backend = [
        ast.literal_eval(node.value)
        for node in enum.body
        if isinstance(node, ast.Assign)
    ]
    frontend = []
    for name in ("pictograms.ts", "daily-pictograms.ts"):
        frontend.extend(
            re.findall(
                r'\bkey:\s*"([a-z_]+)"',
                (root / "admin/src/lib" / name).read_text(encoding="utf-8"),
            )
        )
    if len(set(frontend)) != len(frontend) or sorted(frontend) != sorted(backend):
        raise SystemExit("Pictogram catalog mismatch between backend and admin")
    print(f"Pictogram contract matches: {len(frontend)} drawings")


if __name__ == "__main__":
    main()
