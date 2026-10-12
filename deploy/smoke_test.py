"""Verify the real Compose stack in an isolated project, then remove its test volume.

Run from the repository root: python deploy/smoke_test.py
Requires a running Linux Docker engine and the Compose plugin.
"""

import json
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from uuid import uuid4

from init_env import create_env


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    local_root = root / ".local"
    local_root.mkdir(exist_ok=True)
    project = "pictoflow-smoke-" + uuid4().hex[:12]
    with tempfile.TemporaryDirectory(
        prefix="compose-smoke-", dir=local_root
    ) as directory:
        config_root = Path(directory).resolve()
        if not config_root.is_relative_to(local_root.resolve()):
            raise RuntimeError("Temporary Compose files must stay inside .local")
        example = (root / ".env.example").read_text(encoding="utf-8")
        example = example.replace(
            "PICTOFLOW_BACKEND_PORT=8000", "PICTOFLOW_BACKEND_PORT=0"
        )
        (config_root / ".env.example").write_text(example, encoding="utf-8")
        create_env(config_root)
        command = [
            "docker",
            "compose",
            "--project-name",
            project,
            "--env-file",
            str(config_root / ".env"),
            "-f",
            str(root / "deploy/docker-compose.yml"),
        ]
        env = dict(os.environ)
        # Shell overrides must not redirect the isolated smoke test into a user's dev configuration.
        for key in (
            "POSTGRES_USER",
            "POSTGRES_DB",
            "POSTGRES_PASSWORD",
            "PICTOFLOW_BACKEND_PORT",
            "PICTOFLOW_AI_PROVIDER",
            "PICTOFLOW_APP_NAME",
            "PICTOFLOW_DEBUG",
            "PICTOFLOW_REDIS_TIMEOUT_SECONDS",
        ):
            env.pop(key, None)

        def run(*arguments: str, capture: bool = False):
            return subprocess.run(
                [*command, *arguments],
                cwd=root,
                env=env,
                check=True,
                capture_output=capture,
                text=True,
            )

        try:
            run("config", "--quiet")
            run("up", "--build", "--wait", "--wait-timeout", "180")
            binding = run("port", "backend", "8000", capture=True).stdout.strip()
            port = int(binding.rsplit(":", 1)[1])
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/health", timeout=5
            ) as response:
                assert response.status == 200 and json.load(response) == {
                    "status": "healthy"
                }
            run("run", "--rm", "backend", "python", "-m", "alembic", "upgrade", "head")
            run("run", "--rm", "backend", "python", "-m", "alembic", "check")
            for mode in ("disabled", "fake"):
                mode_arguments = (
                    "run",
                    "--rm",
                    "-e",
                    "PICTOFLOW_ENVIRONMENT=test",
                    "-e",
                    f"PICTOFLOW_AI_PROVIDER={mode}",
                    "backend",
                )
                # Exercise the actual environment-selected provider before the suite's
                # scenarios choose their own explicit provider and repository fixtures.
                run(
                    *mode_arguments,
                    "python",
                    "-c",
                    "import os\n"
                    "from fastapi.testclient import TestClient\n"
                    "from app.api.application import create_app\n"
                    "mode = os.environ['PICTOFLOW_AI_PROVIDER']\n"
                    "with TestClient(create_app()) as client:\n"
                    "    health = client.get('/api/v1/providers').json()\n"
                    "    assert health['provider_id'] == mode\n"
                    "    assert health['status'] == "
                    "('disabled' if mode == 'disabled' else 'available')\n"
                    "    assert client.get('/api/v1/profiles').status_code == 200\n"
                    "    assert client.get('/api/v1/readiness').json()['redis'] == 'available'\n"
                    "print('Container API and configured provider verified:', mode)\n",
                )
                run(
                    *mode_arguments,
                    "python",
                    "-m",
                    "pytest",
                )
            print(
                "Compose startup, HTTP health, migrations and both local AI modes passed."
            )
        finally:
            # This random smoke project owns these resources; no development project is removed.
            subprocess.run(
                [*command, "down", "--volumes", "--remove-orphans"],
                cwd=root,
                env=env,
                check=True,
            )


if __name__ == "__main__":
    main()
