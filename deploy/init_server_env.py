"""Create private server configuration without overwriting existing credentials."""

import argparse
import ipaddress
import os
import secrets
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--bind-address", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--release", default="local")
    args = parser.parse_args()
    ipaddress.IPv4Address(args.bind_address)
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    if not args.release or not all(c.isalnum() or c in "_.-" for c in args.release):
        parser.error(
            "Release must contain only letters, digits, underscores, dots and hyphens"
        )
    args.path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(args.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SystemExit("Existing server configuration preserved.") from None
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        target.write(
            f"POSTGRES_PASSWORD={secrets.token_urlsafe(48)}\n"
            f"PICTOFLOW_BIND_ADDRESS={args.bind_address}\n"
            f"PICTOFLOW_ADMIN_PORT={args.port}\n"
            f"PICTOFLOW_RELEASE={args.release}\n"
        )
    print("Created private server configuration; credentials are not printed.")


if __name__ == "__main__":
    main()
