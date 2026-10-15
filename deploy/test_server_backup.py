"""Full encrypted recovery exercise with synthetic PCL/accounts and TLS, never production."""

import argparse
import json
import os
import subprocess
import tarfile
import tempfile
from pathlib import Path
from uuid import uuid4

import server_backup as backup


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backend-image", help="Reuse an existing PictoFlow image for local QA"
    )
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    project = "pictoflow-backup-test-" + uuid4().hex[:12]
    image = args.backend_image or project + ":backend"
    if not args.backend_image:
        subprocess.run(
            [
                "docker",
                "build",
                "-t",
                image,
                "-f",
                str(repo / "backend/Dockerfile.server"),
                str(repo),
            ],
            check=True,
        )
    local = repo / ".local"
    local.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="backup-test-", dir=local) as temporary:
        root = Path(temporary).resolve()
        assert root.is_relative_to(local.resolve())
        release = root / "releases/test"
        (release / "deploy").mkdir(parents=True)
        (root / "current").symlink_to(release, target_is_directory=True)
        (root / ".env.server").write_text(
            "PICTOFLOW_RELEASE=test\nCOMPOSE_PROFILES=https\nPICTOFLOW_AUTH_ENABLED=true\nPOSTGRES_PASSWORD=synthetic-backup-test-only\n"
        )
        (root / ".env.server").chmod(0o600)
        identity = root / "recovery.agekey"
        subprocess.run(
            ["age-keygen", "-o", str(identity)], check=True, capture_output=True
        )
        identity.chmod(0o600)
        recipients = root / "recipients.txt"
        recipients.write_bytes(
            subprocess.check_output(["age-keygen", "-y", str(identity)])
        )
        config = {
            "version": 1,
            "destination": str(root / "backups"),
            "recipients_file": str(recipients),
            "retain": 2,
            "project": project,
        }
        backup.write_json(root / "backup-config.json", config)
        environment = {
            "POSTGRES_HOST": "postgres",
            "POSTGRES_USER": "pictoflow",
            "POSTGRES_DB": "pictoflow",
            "POSTGRES_PASSWORD": "synthetic-backup-test-only",
            "PICTOFLOW_AI_PROVIDER": "disabled",
        }
        services = {
            "postgres": {
                "image": "postgres:18-bookworm",
                "environment": {
                    "POSTGRES_USER": "pictoflow",
                    "POSTGRES_DB": "pictoflow",
                    "POSTGRES_PASSWORD": "synthetic-backup-test-only",
                },
                "tmpfs": ["/var/lib/postgresql"],
                "healthcheck": {
                    "test": ["CMD", "pg_isready", "-U", "pictoflow"],
                    "interval": "1s",
                    "retries": 30,
                },
            },
            "backend": {
                "image": image,
                "environment": environment,
                "depends_on": {"postgres": {"condition": "service_healthy"}},
            },
            "admin": {
                "image": image,
                "environment": environment,
                "command": ["python", "-m", "http.server", "3000"],
            },
            "https": {
                "image": "caddy:2-alpine",
                "environment": {"PICTOFLOW_HTTPS_ADDRESS": "127.0.0.1"},
                "volumes": [
                    f"{(repo / 'deploy/Caddyfile').as_posix()}:/etc/caddy/Caddyfile:ro",
                    "tls_data:/data",
                    "tls_config:/config",
                ],
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
                    "retries": 30,
                },
            },
        }
        compose_file = release / "deploy/docker-compose.server.yml"
        compose_file.write_text(
            json.dumps(
                {"services": services, "volumes": {"tls_data": {}, "tls_config": {}}}
            )
        )
        source = root / "releases/pictoflow-test.tar.gz"
        with tarfile.open(source, "w:gz") as archive:
            archive.add(compose_file, arcname="deploy/docker-compose.server.yml")
        backup.write_json(
            release / "deployment-manifest.json",
            {
                "release": "test",
                "archive_sha256": backup.sha_file(source),
                "git_sha": "synthetic",
            },
        )
        command = [
            "docker",
            "compose",
            "-p",
            project,
            "--env-file",
            str(root / ".env.server"),
            "-f",
            str(compose_file),
        ]

        def compose(*parts, **kwargs):
            if parts[:4] == ("exec", "-T", "backend", "python"):
                parts = (
                    *parts[:4],
                    "scripts/container_entrypoint.py",
                    "python",
                    *parts[4:],
                )
            return subprocess.run([*command, *parts], check=True, **kwargs)

        seed = r"""
import base64,io
from uuid import uuid4,UUID
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text
from app.api.application import create_app
from app.config import Settings
from app.infrastructure.postgres.database import create_database_engine,create_session_factory
from app.infrastructure.postgres.access import Accounts
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits
engine=create_database_engine(Settings(_env_file=None))
account=Accounts(create_session_factory(engine)).create('synthetic-admin','Compte fictif','Une phrase fictive de sauvegarde !',admin=True)
app=create_app(Settings(environment='test',database_url=None,ai_provider='disabled',_env_file=None))
with TestClient(app) as client:
    app.state.pcl_units=PostgresPCLUnits(create_session_factory(engine))
    def call(path,**body):
        result=client.post('/api/v1'+path,json=body);result.raise_for_status();return result.json()
    p=call('/profiles',display_name='Profil fictif')['id'];base='/profiles/'+p
    image=io.BytesIO();Image.new('RGB',(16,16),'blue').save(image,format='PNG')
    block=call(base+'/blocks/photo',request_id=str(uuid4()),label='Boire',photo_base64=base64.b64encode(image.getvalue()).decode(),actor_role='user')
    call(base+'/blocks/'+block['id']+'/feedback',action='confirm',actor_role='user',confirm_representation=True)
    sequence=call(base+'/sequences',session_id=str(uuid4()))['id']
    for action in ('append','append','complete'):
        call(base+'/sequences/'+sequence+'/selection',action=action,**({'block_id':block['id']} if action=='append' else {}))
    candidate=call(base+'/sequences/'+sequence+'/interpret')['candidates'][0]
    call(base+'/interpretations/'+candidate['id']+'/feedback',action='confirm',actor_role='user')
    service=Accounts(create_session_factory(engine))
    speaker=service.create('synthetic-speaker','Personne fictive','Autre phrase fictive de sauvegarde !')
    service.grant(speaker.id,UUID(p),'communicator',None,actor_id=account.id)
    service.login('synthetic-speaker','Autre phrase fictive de sauvegarde !',8)
with engine.begin() as c:
    # Generic JSON hashing must retain bytes, Unicode, repeated messages and composite keys.
    c.execute(text('CREATE TABLE recovery_probe (a integer, b integer, value jsonb, pixels bytea, PRIMARY KEY(a,b))'))
    c.execute(text("INSERT INTO recovery_probe VALUES(1,2,'{\"message\":\"Boire → Boire 🚰\"}',decode('000102ff','hex'))"))
engine.dispose()
"""
        try:
            compose("up", "-d", "--wait", "--wait-timeout", "90")
            compose(
                "exec", "-T", "backend", "python", "-m", "alembic", "upgrade", "head"
            )
            compose("exec", "-T", "backend", "python", "-c", seed)
            destination = Path(config["destination"])
            # A competing run must fail without modifying a successful snapshot/status.
            destination.mkdir(mode=0o700)
            with backup.locked(destination):
                try:
                    backup.backup(root)
                except backup.BackupError:
                    pass
                else:
                    raise AssertionError("Concurrent backup unexpectedly allowed")
            for _ in range(2):
                backup.backup(root)
            writer_code = """
import time
from sqlalchemy import text
from app.config import Settings
from app.infrastructure.postgres.database import create_database_engine
engine=create_database_engine(Settings(_env_file=None))
for i in range(100):
    with engine.begin() as connection:
        connection.execute(text('UPDATE recovery_probe SET b=b+1'))
    time.sleep(.05)
engine.dispose()
"""
            with subprocess.Popen(
                [
                    *command,
                    "exec",
                    "-T",
                    "backend",
                    "python",
                    "scripts/container_entrypoint.py",
                    "python",
                    "-c",
                    writer_code,
                ]
            ) as writer:
                backup.backup(root)
                assert writer.wait(timeout=30) == 0
            completed = sorted(
                p for p in destination.iterdir() if backup.NAME.fullmatch(p.name)
            )
            assert (
                len(completed) == 2
            )  # Rotation only starts after successful publication.
            assert backup.status(root, 36) == 0
            latest = json.loads((destination / "status.json").read_text())[
                "last_success"
            ]
            directory = destination / latest["id"]
            report = root / "restore-report.json"
            backup.restore_check(directory, identity, report)
            assert json.loads(report.read_text())["tls_keys_verified"]
            assert json.loads(report.read_text())["tables_verified"] >= 20
            # Corruption is rejected before any restore container is created.
            payload = directory / "backup.age"
            original = payload.read_bytes()
            payload.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            try:
                backup.restore_check(directory, identity, root / "bad-report.json")
            except backup.BackupError:
                pass
            else:
                raise AssertionError("Corrupted backup accepted")
            payload.write_bytes(original)
            assert not (root / "bad-report.json").exists()
            wrong_identity = root / "wrong.agekey"
            subprocess.run(
                ["age-keygen", "-o", str(wrong_identity)],
                check=True,
                capture_output=True,
            )
            wrong_identity.chmod(0o600)
            try:
                backup.restore_check(
                    directory, wrong_identity, root / "wrong-key-report.json"
                )
            except backup.BackupError:
                pass
            else:
                raise AssertionError("Wrong recovery identity accepted")
            assert not (root / "wrong-key-report.json").exists()
            # A failed source export must retain the last successful backup and expose failure.
            source.rename(source.with_suffix(".missing"))
            try:
                backup.backup(root)
            except FileNotFoundError:
                pass
            else:
                raise AssertionError("Incomplete backup published")
            assert backup.status(root, 36) == 1
            assert (
                json.loads((destination / "status.json").read_text())["last_success"][
                    "id"
                ]
                == latest["id"]
            )
            assert (
                len([p for p in destination.iterdir() if backup.NAME.fullmatch(p.name)])
                == 2
            )
            assert not list(destination.glob(".incomplete-*"))
            # An unrelated manual directory is never eligible for retention.
            foreign = destination / "pictoflow-20000101T000000Z-00000000"
            foreign.mkdir()
            (foreign / "manual.txt").write_text("Keep this manual file")
            backup.prune(destination, 2)
            assert (foreign / "manual.txt").exists()
            # Service discovery failures are visible too, not just export failures.
            backup.write_json(
                destination / "status.json",
                {"state": "completed", "last_success": latest},
            )
            compose("stop", "admin")
            try:
                backup.backup(root)
            except backup.BackupError:
                pass
            else:
                raise AssertionError("Missing service accepted")
            assert backup.status(root, 36) == 1
            compose(
                "exec",
                "-T",
                "backend",
                "python",
                "-c",
                "from app.config import Settings; from app.infrastructure.postgres.database import create_database_engine; from sqlalchemy import text; e=create_database_engine(Settings(_env_file=None)); c=e.connect(); assert c.scalar(text('SELECT count(*) FROM recovery_probe'))==1; c.close(); e.dispose()",
            )
            print(
                "Encrypted backup/restore passed: accounts, schema, composite rows, Unicode/bytes, TLS keys, rotation, lock, tampering and failed export; source intact."
            )
        finally:
            assert project.startswith("pictoflow-backup-test-")
            compose("down", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    main()
