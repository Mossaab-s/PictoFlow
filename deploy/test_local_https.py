"""Exercise Caddy TLS, certificate persistence and proxy headers in an isolated stack."""

import json
import os
import ssl
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    root = Path(__file__).resolve().parents[1]
    local = root / ".local"
    local.mkdir(exist_ok=True)
    project = "pictoflow-tls-test-" + uuid4().hex[:12]
    upstream = """
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Set-Cookie', '__Host-pictoflow-session=fictitious; Path=/; Secure; HttpOnly; SameSite=Strict')
        self.end_headers()
        self.wfile.write(json.dumps({key:self.headers.get(key) for key in ('Origin','Cookie','X-CSRF-Token','X-Forwarded-Proto')}).encode())
    def log_message(self, *args): pass
HTTPServer(('0.0.0.0',3000),Handler).serve_forever()
"""
    with tempfile.TemporaryDirectory(prefix="tls-test-", dir=local) as directory:
        work = Path(directory).resolve()
        assert work.is_relative_to(local.resolve())
        config = {
            "services": {
                "admin": {
                    "image": "python:3.13-alpine",
                    "command": ["python", "-u", "-c", upstream],
                },
                "https": {
                    "image": "caddy:2-alpine",
                    "environment": {"PICTOFLOW_HTTPS_ADDRESS": "127.0.0.1"},
                    "ports": ["127.0.0.1::443", "127.0.0.1::80"],
                    "volumes": [
                        f"{(root / 'deploy/Caddyfile').as_posix()}:/etc/caddy/Caddyfile:ro",
                        "tls_data:/data",
                        "tls_config:/config",
                    ],
                    "depends_on": ["admin"],
                    "healthcheck": {
                        "test": [
                            "CMD",
                            "wget",
                            "-q",
                            "-O",
                            "/dev/null",
                            "http://127.0.0.1:2019/config/",
                        ],
                        "interval": "1s",
                        "timeout": "2s",
                        "retries": 30,
                    },
                },
            },
            "volumes": {"tls_data": {}, "tls_config": {}},
        }
        path = work / "compose.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        command = ["docker", "compose", "-p", project, "-f", str(path)]

        def run(*args, capture=False):
            return subprocess.run(
                [*command, *args], check=True, text=True, capture_output=capture
            )

        # Check the actual production profile too; never print the resolved environment.
        env = dict(
            os.environ,
            POSTGRES_PASSWORD="fictitious-test-only",
            PICTOFLOW_HTTPS_ADDRESS="127.0.0.1",
            PICTOFLOW_BIND_ADDRESS="127.0.0.1",
            PICTOFLOW_ADMIN_PORT="3001",
            COMPOSE_PROFILES="https",
        )
        production = subprocess.check_output(
            [
                "docker",
                "compose",
                "-f",
                str(root / "deploy/docker-compose.server.yml"),
                "config",
                "--format",
                "json",
            ],
            env=env,
            text=True,
        )
        services = json.loads(production)["services"]
        assert services["admin"]["ports"][0]["host_ip"] == "127.0.0.1"
        assert "PICTOFLOW_PROVIDER_API_KEY" not in services["https"].get(
            "environment", {}
        )
        assert len(services["https"]["ports"]) == 3

        try:
            run("up", "-d", "--wait", "--wait-timeout", "90")
            run(
                "exec",
                "-T",
                "https",
                "caddy",
                "validate",
                "--config",
                "/etc/caddy/Caddyfile",
            )
            port = int(
                run("port", "https", "443", capture=True)
                .stdout.strip()
                .rsplit(":", 1)[1]
            )
            http_port = int(
                run("port", "https", "80", capture=True)
                .stdout.strip()
                .rsplit(":", 1)[1]
            )
            root_path = "/data/caddy/pki/authorities/local/root.crt"
            certificate = run(
                "exec", "-T", "https", "cat", root_path, capture=True
            ).stdout
            context = ssl.create_default_context(cadata=certificate)
            request = urllib.request.Request(
                f"https://127.0.0.1:{port}/api/pictoflow/auth/session",
                headers={
                    "Origin": "https://127.0.0.1",
                    "Cookie": "fictitious=value",
                    "X-CSRF-Token": "synthetic",
                },
            )
            with urllib.request.urlopen(
                request, context=context, timeout=20
            ) as response:
                assert json.load(response) == {
                    "Origin": "https://127.0.0.1",
                    "Cookie": "fictitious=value",
                    "X-CSRF-Token": "synthetic",
                    "X-Forwarded-Proto": "https",
                }
                assert "Secure" in response.headers["Set-Cookie"]
                assert response.headers["Strict-Transport-Security"] == "max-age=86400"
            # An untrusted machine must fail verification, not silently bypass trust.
            try:
                urllib.request.urlopen(
                    request, context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT), timeout=10
                )
            except urllib.error.URLError as exc:
                assert isinstance(exc.reason, ssl.SSLCertVerificationError)
            else:
                raise AssertionError("Untrusted local CA unexpectedly accepted")
            opener = urllib.request.build_opener(NoRedirect)
            try:
                opener.open(
                    urllib.request.Request(
                        f"http://127.0.0.1:{http_port}/communication/example?x=1",
                        headers={"Host": "evil.example"},
                    ),
                    timeout=10,
                )
            except urllib.error.HTTPError as exc:
                assert exc.code == 308
                assert (
                    exc.headers["Location"]
                    == "https://127.0.0.1/communication/example?x=1"
                )
            else:
                raise AssertionError("HTTP did not redirect")
            run("restart", "https")
            run("up", "-d", "--wait", "--wait-timeout", "90")
            assert (
                run("exec", "-T", "https", "cat", root_path, capture=True).stdout
                == certificate
            )
            print(
                "TLS verified: trusted IP certificate, refusal without CA, fixed redirect, session/CSRF headers, persistent CA."
            )
        except BaseException:
            run("logs", "--tail", "60", "https")
            raise
        finally:
            assert project.startswith("pictoflow-tls-test-")
            run("down", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    main()
