"""Validate public deployment boundaries without real credentials or ACME requests."""

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import init_vps_env
import server_backup

ROOT = Path(__file__).resolve().parents[1]
DOCKER = "--docker" in sys.argv
if DOCKER:
    sys.argv.remove("--docker")


class ConfigurationTests(unittest.TestCase):
    def test_refuses_non_dns_input(self):
        for value in (
            "51.210.107.114",
            "localhost",
            "x.local",
            "x.test",
            "https://example.org",
            "example.org/path",
            "example.org:443",
            "*.example.org",
            "x\nSECRET=yes",
            "a..org",
            "-a.example.org",
            "a" * 64 + ".org",
        ):
            with (
                self.subTest(value=value),
                self.assertRaises(argparse.ArgumentTypeError),
            ):
                init_vps_env.public_domain(value)
        self.assertEqual(
            init_vps_env.public_domain("Testers.Example.org"), "testers.example.org"
        )

    def test_private_generator_preserves_existing_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "server.env"
            command = [
                sys.executable,
                str(ROOT / "deploy/init_vps_env.py"),
                str(path),
                "--domain",
                "testers.example.org",
                "--release",
                "test-release",
            ]
            result = subprocess.run(command, check=True, capture_output=True, text=True)
            first = path.read_bytes()
            config = server_backup.environment(path)
            self.assertEqual(config["PICTOFLOW_AUTH_ENABLED"], "true")
            self.assertEqual(config["PICTOFLOW_AI_PROVIDER"], "disabled")
            self.assertEqual(
                config["PICTOFLOW_AUTH_ORIGIN"], "https://testers.example.org"
            )
            self.assertNotIn(config["POSTGRES_PASSWORD"], result.stdout + result.stderr)
            if os.name == "posix":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            again = subprocess.run(command, check=False, capture_output=True)
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual(path.read_bytes(), first)

    def test_backup_selects_the_public_overlay_and_tls(self):
        self.check_backup_mode("vps")

    def test_external_proxy_backup_does_not_require_a_caddy_container(self):
        self.check_backup_mode("proxy")

    def check_backup_mode(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "releases/test"
            release.mkdir(parents=True)
            env = root / ".env.server"
            env.write_text(
                f"PICTOFLOW_DEPLOYMENT_MODE={mode}\nPICTOFLOW_AUTH_ENABLED=true\n"
                "PICTOFLOW_AUTH_ORIGIN=https://testers.example.org\n"
            )
            # Only path resolution is substituted on Windows, which cannot create
            # directory symlinks without privileges. Container ownership is still checked.
            with (
                patch.object(Path, "resolve", side_effect=[release]),
                patch.object(server_backup, "private_file", return_value=env),
            ):

                def docker(args, **kwargs):
                    if args[1] == "inspect":
                        service = {
                            "a": "postgres",
                            "b": "backend",
                            "c": "admin",
                            "d": "https",
                        }[args[2][0]]
                        return json.dumps(
                            [
                                {
                                    "Config": {
                                        "Labels": {
                                            "com.docker.compose.project": "pictoflow-vps",
                                            "com.docker.compose.service": service,
                                        }
                                    },
                                    "Image": "synthetic",
                                }
                            ]
                        ).encode()
                    service = args[-1]
                    return {
                        "postgres": "a",
                        "backend": "b",
                        "admin": "c",
                        "https": "d",
                    }[service] * 64

                with patch.object(server_backup, "run", side_effect=docker):
                    server = server_backup.Server(root, "pictoflow-vps")
            self.assertEqual(server.tls, mode == "vps")
            self.assertEqual(server.tls_mode, "public" if mode == "vps" else "external")
            self.assertEqual(
                server.command[-2:],
                ["-f", str(release / f"deploy/docker-compose.{mode}.yml")],
            )

    def test_external_proxy_generator_and_port_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "server.env"
            command = [
                sys.executable,
                str(ROOT / "deploy/init_vps_env.py"),
                str(path),
                "--domain",
                "testers.example.org",
                "--release",
                "proxy-test",
                "--proxy-port",
            ]
            invalid = subprocess.run([*command, "80"], check=False, capture_output=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertFalse(path.exists())
            subprocess.run([*command, "3001"], check=True, capture_output=True)
            config = server_backup.environment(path)
            self.assertEqual(config["PICTOFLOW_DEPLOYMENT_MODE"], "proxy")
            self.assertEqual(config["PICTOFLOW_PROXY_PORT"], "3001")
            self.assertEqual(config["PICTOFLOW_AUTH_ENABLED"], "true")

    @unittest.skipUnless(
        shutil.which("openssl"),
        "OpenSSL required for recovery certificate verification",
    )
    def test_public_tls_recovery_checks_issued_certificate_and_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    str(root / "cert.key"),
                    "-out",
                    str(root / "cert.crt"),
                    "-days",
                    "1",
                    "-subj",
                    "/CN=testers.example.org",
                ],
                check=True,
                capture_output=True,
            )
            cert = (root / "cert.crt").read_bytes()
            key = (root / "cert.key").read_bytes()

            def bundle(
                key_content,
                *,
                mode="public",
                prefix="caddy/certificates/test/testers.example.org/site",
            ):
                tls = io.BytesIO()
                with tarfile.open(fileobj=tls, mode="w") as archive:
                    for suffix, value in ((".crt", cert), (".key", key_content)):
                        entry = tarfile.TarInfo(prefix + suffix)
                        entry.size = len(value)
                        archive.addfile(entry, io.BytesIO(value))
                entries = {
                    "database.dump": b"synthetic",
                    "server.env": b"synthetic",
                    "sources.tar.gz": b"synthetic",
                    "caddy.tar": tls.getvalue(),
                }
                output = io.BytesIO()
                with zipfile.ZipFile(output, "w") as target:
                    for name, value in entries.items():
                        target.writestr(name, value)
                    target.writestr(
                        "manifest.json",
                        json.dumps(
                            {
                                "kind": server_backup.KIND,
                                "version": 1,
                                "tls": True,
                                "tls_mode": mode,
                                "files": {
                                    name: hashlib.sha256(value).hexdigest()
                                    for name, value in entries.items()
                                },
                            }
                        ),
                    )
                output.seek(0)
                return zipfile.ZipFile(output)

            with bundle(key) as value:
                self.assertEqual(
                    server_backup.validate_bundle(value)["tls_mode"], "public"
                )
            for value in (
                bundle(b"invalid key"),
                bundle(key, mode="unknown"),
                bundle(key, prefix="caddy/pki/authorities/local/root"),
                bundle(key, prefix="../outside/site"),
            ):
                with value, self.assertRaises(server_backup.BackupError):
                    server_backup.validate_bundle(value)


@unittest.skipUnless(DOCKER, "Run with --docker in Linux CI")
class PublicComposeTests(unittest.TestCase):
    def test_existing_proxy_never_exposes_application_ports_publicly(self):
        env = dict(
            os.environ,
            POSTGRES_PASSWORD="synthetic-only",
            PICTOFLOW_PUBLIC_DOMAIN="testers.example.org",
            PICTOFLOW_PROXY_PORT="3001",
            PICTOFLOW_AUTH_ENABLED="false",
            PICTOFLOW_BIND_ADDRESS="0.0.0.0",
            COMPOSE_PROFILES="standalone-tls",
        )
        resolved = json.loads(
            subprocess.check_output(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(ROOT / "deploy/docker-compose.server.yml"),
                    "-f",
                    str(ROOT / "deploy/docker-compose.proxy.yml"),
                    "config",
                    "--format",
                    "json",
                ],
                env=env,
                text=True,
            )
        )
        self.assertEqual(resolved["name"], "pictoflow-vps")
        services = resolved["services"]
        for name, service in services.items():
            if name != "admin":
                self.assertFalse(service.get("ports"), name)
        ports = services["admin"]["ports"]
        self.assertEqual(len(ports), 1)
        self.assertEqual(
            (ports[0]["host_ip"], int(ports[0]["published"]), ports[0]["target"]),
            ("127.0.0.1", 3001, 3000),
        )
        self.assertEqual(
            services["backend"]["environment"]["PICTOFLOW_AUTH_ENABLED"], "true"
        )
        self.assertEqual(
            services["backend"]["environment"]["PICTOFLOW_AUTH_ORIGIN"],
            "https://testers.example.org",
        )

    def test_public_ports_authentication_and_certificate_policy(self):
        # Hostile legacy values must not expose another service or disable login.
        env = dict(
            os.environ,
            POSTGRES_PASSWORD="synthetic-only",
            PICTOFLOW_PUBLIC_DOMAIN="testers.example.org",
            PICTOFLOW_AUTH_ENABLED="false",
            PICTOFLOW_AUTH_ORIGIN="http://wrong.example.org",
            PICTOFLOW_BIND_ADDRESS="0.0.0.0",
            PICTOFLOW_ADMIN_PORT="9999",
            PICTOFLOW_HTTPS_LEGACY_PORT="8888",
            PICTOFLOW_PROVIDER_API_KEY="synthetic-key",
        )
        command = [
            "docker",
            "compose",
            "-f",
            str(ROOT / "deploy/docker-compose.server.yml"),
            "-f",
            str(ROOT / "deploy/docker-compose.vps.yml"),
            "config",
            "--format",
            "json",
        ]
        resolved = json.loads(subprocess.check_output(command, env=env, text=True))
        self.assertEqual(resolved["name"], "pictoflow-vps")
        services = resolved["services"]
        self.assertFalse(services["https"].get("profiles"))
        for name in ("admin", "backend", "postgres", "redis", "migrate"):
            self.assertFalse(services[name].get("ports"), name)
        ports = services["https"]["ports"]
        self.assertEqual(
            {(p["host_ip"], int(p["published"]), p["target"]) for p in ports},
            {("0.0.0.0", 80, 80), ("0.0.0.0", 443, 443)},
        )
        backend = services["backend"]["environment"]
        self.assertEqual(backend["PICTOFLOW_AUTH_ENABLED"], "true")
        self.assertEqual(
            backend["PICTOFLOW_AUTH_ORIGIN"], "https://testers.example.org"
        )
        for name, service in services.items():
            if name != "backend":
                self.assertNotIn(
                    "PICTOFLOW_PROVIDER_API_KEY", service.get("environment", {})
                )
        caddyfile = next(
            v["source"]
            for v in services["https"]["volumes"]
            if v["target"] == "/etc/caddy/Caddyfile"
        )
        self.assertEqual(Path(caddyfile), ROOT / "deploy/Caddyfile.public")
        # Adapt only: never start a public CA request from CI.
        adapted = json.loads(
            subprocess.check_output(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "-e",
                    "PICTOFLOW_PUBLIC_DOMAIN=testers.example.org",
                    "-v",
                    f"{caddyfile}:/etc/caddy/Caddyfile:ro",
                    "caddy:2-alpine",
                    "caddy",
                    "adapt",
                    "--config",
                    "/etc/caddy/Caddyfile",
                ],
                text=True,
            )
        )
        encoded = json.dumps(adapted)
        self.assertIn("testers.example.org", encoded)
        self.assertIn("admin:3000", encoded)
        self.assertNotIn('"module": "internal"', encoded)
        tls = adapted["apps"].get("tls", {})
        self.assertFalse(tls.get("certificates"))
        secure_servers = [
            server
            for server in adapted["apps"]["http"]["servers"].values()
            if ":443" in server["listen"]
        ]
        self.assertEqual(len(secure_servers), 1)
        self.assertTrue(secure_servers[0]["automatic_https"]["disable_redirects"])


if __name__ == "__main__":
    unittest.main()
