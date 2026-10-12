"""Create a local .env from the example without overwriting existing settings."""

import secrets
from pathlib import Path


def create_env(root: Path) -> None:
    example = (root / ".env.example").read_text(encoding="utf-8")
    marker = "POSTGRES_PASSWORD=\n"
    if marker not in example:
        raise ValueError("Environment example must contain an empty POSTGRES_PASSWORD")
    content = example.replace(marker, f"POSTGRES_PASSWORD={secrets.token_hex(24)}\n", 1)
    # Exclusive creation preserves any user-owned .env, including native dev configuration.
    with (root / ".env").open("x", encoding="utf-8") as target:
        target.write(content)


if __name__ == "__main__":
    try:
        create_env(Path(__file__).resolve().parents[1])
    except FileExistsError:
        raise SystemExit(
            "Existing .env preserved. Set POSTGRES_PASSWORD locally before starting Compose."
        ) from None
    print("Created local .env with a generated development password (not printed).")
