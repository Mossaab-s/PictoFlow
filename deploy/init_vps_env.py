"""Create a private, authenticated VPS configuration for a public DNS name."""

import argparse
import ipaddress
import os
import re
import secrets
from pathlib import Path


def public_domain(value: str) -> str:
    value = value.lower()
    labels = value.split(".")
    if (
        len(value) > 253
        or len(labels) < 2
        or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", s) for s in labels
        )
        or not re.fullmatch(r"[a-z]{2,63}", labels[-1])
        or labels[-1] in {"local", "localhost", "internal", "test", "invalid"}
    ):
        raise argparse.ArgumentTypeError(
            "Use a public DNS name without scheme, port or path"
        )
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return value
    raise argparse.ArgumentTypeError("Use a public DNS name, not an IP address")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    parser.add_argument("--domain", type=public_domain, required=True)
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}", args.release):
        parser.error(
            "Use a release identifier containing letters, digits, dots, underscores or hyphens"
        )
    args.path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(args.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SystemExit("Existing server configuration preserved.") from None
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        target.write(
            f"POSTGRES_PASSWORD={secrets.token_urlsafe(48)}\n"
            "PICTOFLOW_DEPLOYMENT_MODE=vps\n"
            f"PICTOFLOW_PUBLIC_DOMAIN={args.domain}\n"
            f"PICTOFLOW_RELEASE={args.release}\n"
            "PICTOFLOW_AUTH_ENABLED=true\n"
            f"PICTOFLOW_AUTH_ORIGIN=https://{args.domain}\n"
            "PICTOFLOW_AI_PROVIDER=disabled\n"
        )
    print("Created private VPS configuration; credentials are not printed.")


if __name__ == "__main__":
    main()
