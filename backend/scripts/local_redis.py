"""Manage a disposable localhost Redis process for local verification."""

import os
import secrets
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import ConnectionError, TimeoutError
from redis.retry import Retry


@contextmanager
def temporary_redis(server: Path, local_root: Path):
    server = server.resolve()
    if not server.is_file():
        raise ValueError("Redis server binary does not exist")
    local_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="redis-test-", dir=local_root) as directory:
        root = Path(directory).resolve()
        if not root.is_relative_to(local_root.resolve()):
            raise RuntimeError("Temporary Redis directory must stay inside .local")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        password = secrets.token_urlsafe(32)
        (root / "redis.conf").write_text(
            f"bind 127.0.0.1\nport {port}\nrequirepass {password}\n"
            'save ""\nappendonly no\ndaemonize no\n',
            encoding="utf-8",
        )
        url = f"redis://:{password}@127.0.0.1:{port}/0"
        client = Redis.from_url(
            url,
            socket_timeout=0.2,
            socket_connect_timeout=0.2,
            retry=Retry(NoBackoff(), 0),
            protocol=2,
        )
        with (root / "server.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [str(server), "redis.conf"],
                cwd=root,
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            try:
                deadline = time.monotonic() + 10
                while True:
                    if process.poll() is not None:
                        raise RuntimeError("Temporary Redis server exited during startup")
                    try:
                        if client.ping():
                            break
                    except (ConnectionError, TimeoutError):
                        if time.monotonic() >= deadline:
                            raise RuntimeError(
                                "Temporary Redis server did not become ready"
                            ) from None
                        time.sleep(0.1)
                yield url
            finally:
                try:
                    if process.poll() is None:
                        try:
                            client.shutdown(nosave=True)
                        except (ConnectionError, TimeoutError):
                            process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                finally:
                    client.close()
