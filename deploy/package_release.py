"""Package local source (including uncommitted work), excluding credentials and caches."""

import argparse
import tarfile
from pathlib import Path

EXCLUDED = {
    ".git",
    ".local",
    ".venv",
    "node_modules",
    ".next",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "htmlcov",
    "build",
    "dist",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    candidates = [
        root / name for name in (".dockerignore", ".env.example", "README.md")
    ]
    for name in ("backend", "admin", "deploy", "docs"):
        candidates.extend((root / name).rglob("*"))
    files = []
    for path in candidates:
        relative = path.relative_to(root)
        if not path.is_file() or path.is_symlink():
            continue
        if any(
            part in EXCLUDED or part.endswith(".egg-info") for part in relative.parts
        ):
            continue
        if path.name.startswith(".env") and path.name != ".env.example":
            continue
        if path.suffix in (".pyc", ".pyo", ".tsbuildinfo") or path.name == ".coverage":
            continue
        files.append(path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.output, "w:gz") as archive:
        directories = {
            parent
            for path in files
            for parent in path.relative_to(root).parents
            if parent != Path(".")
        }
        for directory in sorted(
            directories, key=lambda path: (len(path.parts), str(path))
        ):
            entry = tarfile.TarInfo(directory.as_posix())
            entry.type = tarfile.DIRTYPE
            entry.mode = 0o755
            archive.addfile(entry)
        for path in sorted(set(files)):
            entry = archive.gettarinfo(
                str(path), arcname=path.relative_to(root).as_posix()
            )
            entry.mode = 0o644
            with path.open("rb") as source:
                archive.addfile(entry, source)
    print(f"Packaged {len(files)} source files: {args.output}")


if __name__ == "__main__":
    main()
