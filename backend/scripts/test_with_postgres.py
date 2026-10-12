"""Run pytest against a temporary local PostgreSQL cluster, then stop it.

Usage from backend/: python scripts/test_with_postgres.py --bin-dir PATH_TO_PG_BIN
Use a normal (non-root) account on Unix, as required by PostgreSQL initdb.
"""

import argparse
import os
import secrets
import socket
import subprocess
import sys
import tempfile
from contextlib import nullcontext
from pathlib import Path

from local_redis import temporary_redis
from sqlalchemy.engine import URL


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin-dir", required=True, type=Path)
    parser.add_argument("--redis-server", type=Path, help="Also start a disposable Redis server")
    parser.add_argument(
        "--serve", type=int, help="Serve the API on this localhost port instead of pytest"
    )
    parser.add_argument(
        "--seed-demo", action="store_true", help="Create a synthetic profile for --serve"
    )
    args, pytest_args = parser.parse_known_args()
    if args.serve is not None and not 1 <= args.serve <= 65535:
        parser.error("Serve port must be between 1 and 65535")
    if args.seed_demo and args.serve is None:
        parser.error("--seed-demo requires --serve")
    bin_dir = args.bin_dir.resolve()
    suffix = ".exe" if os.name == "nt" else ""
    for name in ("initdb", "pg_ctl", "createdb"):
        if not (bin_dir / f"{name}{suffix}").is_file():
            parser.error(f"Missing PostgreSQL binary: {name}")
    backend = Path(__file__).resolve().parents[1]
    local_root = backend.parent / ".local"
    local_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="postgres-test-", dir=local_root) as directory:
        task_root = Path(directory).resolve()
        if not task_root.is_relative_to(local_root.resolve()):
            raise RuntimeError("Temporary cluster must stay inside .local")
        cluster = task_root / "data"
        password = secrets.token_urlsafe(32)
        password_file = task_root / "password"
        password_file.write_text(password, encoding="utf-8")
        env = dict(os.environ, PGPASSWORD=password)

        def run(name: str, *arguments: str, check: bool = True) -> subprocess.CompletedProcess:
            # A server started by pg_ctl may inherit pipe handles on Windows.
            # Write to a file so waiting for pg_ctl never waits for server EOF.
            with (task_root / "commands.log").open("a", encoding="utf-8") as output:
                return subprocess.run(
                    [str(bin_dir / f"{name}{suffix}"), *arguments],
                    env=env,
                    check=check,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=60,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )

        run(
            "initdb",
            "-D",
            str(cluster),
            "-U",
            "pictoflow_test",
            "--encoding=UTF8",
            "--locale=C",
            "--auth=scram-sha-256",
            "--pwfile",
            str(password_file),
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = str(sock.getsockname()[1])
        try:
            run(
                "pg_ctl",
                "-D",
                str(cluster),
                "-l",
                str(task_root / "postgres.log"),
                "-o",
                f"-h 127.0.0.1 -p {port}",
                "-w",
                "start",
            )
            run("createdb", "-h", "127.0.0.1", "-p", port, "-U", "pictoflow_test", "pictoflow_test")
            env["PICTOFLOW_TEST_DATABASE_URL"] = URL.create(
                "postgresql+psycopg",
                username="pictoflow_test",
                password=password,
                host="127.0.0.1",
                port=int(port),
                database="pictoflow_test",
            ).render_as_string(hide_password=False)
            redis_context = (
                temporary_redis(args.redis_server, local_root)
                if args.redis_server
                else (nullcontext(None))
            )
            with redis_context as redis_url:
                if redis_url is not None:
                    env["PICTOFLOW_TEST_REDIS_URL"] = redis_url
                if args.serve is not None:
                    env["PICTOFLOW_DATABASE_URL"] = env["PICTOFLOW_TEST_DATABASE_URL"]
                    env["PICTOFLOW_REDIS_URL"] = redis_url or ""
                    env["PICTOFLOW_AI_PROVIDER"] = "disabled"
                    subprocess.run(
                        [sys.executable, "-m", "alembic", "upgrade", "head"],
                        cwd=backend,
                        env=env,
                        check=True,
                    )
                    if args.seed_demo:
                        subprocess.run(
                            [sys.executable, "scripts/seed_demo.py"],
                            cwd=backend,
                            env=env,
                            check=True,
                        )
                    print("Serving disposable local demo; stop with Ctrl+C", flush=True)
                    try:
                        return subprocess.run(
                            [
                                sys.executable,
                                "-m",
                                "uvicorn",
                                "app.main:app",
                                "--host",
                                "127.0.0.1",
                                "--port",
                                str(args.serve),
                                "--no-access-log",
                            ],
                            cwd=backend,
                            env=env,
                            check=False,
                        ).returncode
                    except KeyboardInterrupt:
                        return 0
                print("Running tests against disposable local services", flush=True)
                return subprocess.run(
                    [sys.executable, "-m", "pytest", *pytest_args],
                    cwd=backend,
                    env=env,
                    check=False,
                ).returncode
        finally:
            stopped = run("pg_ctl", "-D", str(cluster), "-w", "-m", "fast", "stop", check=False)
            if stopped.returncode != 0:
                status = run("pg_ctl", "-D", str(cluster), "status", check=False)
                if status.returncode == 0:
                    raise RuntimeError("Temporary PostgreSQL could not be stopped")


if __name__ == "__main__":
    raise SystemExit(main())
