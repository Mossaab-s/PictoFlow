"""Encrypted server backups and isolated restore rehearsals. Linux + Docker + age."""

import argparse
import hashlib
import io
import json
import os
import re
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

KIND = "pictoflow-server-backup"
NAME = re.compile(r"pictoflow-\d{8}T\d{6}Z-[a-f0-9]{8}")
IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]*")
MEMBERS = {
    "database.dump",
    "server.env",
    "sources.tar.gz",
    "manifest.json",
    "caddy.tar",
}

# The exported snapshot stays open until pg_dump has finished. Both the dump and
# fingerprints therefore describe the same committed state, even during usage.
EXPORT = r"""
import hashlib,json,sys
from sqlalchemy import text
from app.config import Settings
from app.infrastructure.postgres.database import create_database_engine
engine=create_database_engine(Settings(_env_file=None))
with engine.execution_options(isolation_level="REPEATABLE READ").connect() as c:
    print(json.dumps({"snapshot":c.scalar(text("SELECT pg_export_snapshot()"))}),flush=True)
    tables={}
    for name in c.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")):
        import re
        assert re.fullmatch(r"[a-z_][a-z0-9_]*",name)
        hashes=[hashlib.sha256(row.encode()).hexdigest() for row in c.scalars(text(f'SELECT to_jsonb(t)::text FROM public."{name}" t'))]
        tables[name]={"rows":len(hashes),"sha256":hashlib.sha256(''.join(sorted(hashes)).encode()).hexdigest()}
    print(json.dumps({"tables":tables,"revision":c.scalar(text("SELECT version_num FROM alembic_version")),"postgres_version":c.scalar(text("SHOW server_version_num"))}),flush=True)
    sys.stdin.readline()
engine.dispose()
"""


class BackupError(Exception):
    pass


def now():
    return datetime.now(UTC)


def run(args, **kwargs):
    result = subprocess.run(
        args, check=False, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **kwargs
    )
    if result.returncode:
        raise BackupError(f"{args[0]} failed (exit {result.returncode})")
    return result.stdout


def sha_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise BackupError("Expected a private regular file (mode 0600)")
    return path


def write_json(path, value):
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as target:
            json.dump(value, target, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        temporary.chmod(0o600)
        temporary.replace(path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def environment(path):
    return dict(
        line.split("=", 1)
        for line in path.read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )


def configuration(root):
    root = root.resolve(strict=True)
    config = json.loads(private_file(root / "backup-config.json").read_text())
    if (
        set(config)
        != {"version", "destination", "recipients_file", "retain", "project"}
        or config["version"] != 1
    ):
        raise BackupError("Unsupported backup configuration")
    if type(config["retain"]) is not int or not 2 <= config["retain"] <= 365:
        raise BackupError("Retention must be between 2 and 365 completed backups")
    if not re.fullmatch(r"pictoflow-[a-z0-9-]+", config["project"]):
        raise BackupError("Expected a PictoFlow Compose project")
    destination = Path(config["destination"])
    if not destination.is_absolute() or destination.is_symlink():
        raise BackupError(
            "Backup destination must be an absolute non-symlink directory"
        )
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.stat().st_mode & 0o077:
        raise BackupError("Backup directory must have mode 0700")
    recipients = Path(config["recipients_file"])
    keys = [
        line.strip()
        for line in recipients.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if (
        not keys
        or len(keys) > 10
        or any(not re.fullmatch(r"age1[0-9a-z]{58}", key) for key in keys)
    ):
        raise BackupError(
            "Use native age public recipients, never a private identity or plugin"
        )
    return root, config, destination.resolve(), keys


@contextmanager
def locked(destination):
    import fcntl

    with (destination / ".backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError("Another backup is running") from None
        yield


class Server:
    def __init__(self, root, project):
        self.root = root
        self.release = (root / "current").resolve(strict=True)
        if self.release.parent != root / "releases":
            raise BackupError("Current release must stay inside the releases directory")
        self.env = private_file(root / ".env.server")
        self.env_bytes = self.env.read_bytes()
        self.settings = environment(self.env)
        self.project = project
        self.command = [
            "docker",
            "compose",
            "-p",
            project,
            "--env-file",
            str(self.env),
            "-f",
            str(self.release / "deploy/docker-compose.server.yml"),
        ]
        mode = self.settings.get("PICTOFLOW_DEPLOYMENT_MODE", "lan")
        if mode not in {"lan", "vps", "proxy"}:
            raise BackupError("Unsupported deployment mode")
        if mode == "vps":
            self.command.extend(["-f", str(self.release / "deploy/docker-compose.vps.yml")])
        if mode == "proxy":
            self.command.extend(["-f", str(self.release / "deploy/docker-compose.proxy.yml")])
            if not self.settings.get("PICTOFLOW_AUTH_ORIGIN", "").startswith("https://"):
                raise BackupError("External proxy deployments require an HTTPS origin")
        self.tls_mode = {"vps": "public", "proxy": "external", "lan": "local"}[mode]
        self.ids = {}
        self.images = {}
        services = ["postgres", "backend", "admin"]
        self.tls = mode == "vps" or (mode == "lan" and "https" in self.settings.get("COMPOSE_PROFILES", "").split(","))
        if self.tls:
            services.append("https")
        if self.settings.get("PICTOFLOW_AUTH_ENABLED") == "true" and not self.tls and mode != "proxy":
            raise BackupError("Authenticated server must include the HTTPS backup")
        for service in services:
            identifier = run([*self.command, "ps", "-q", service], text=True).strip()
            if not re.fullmatch(r"[a-f0-9]{64}", identifier):
                raise BackupError("Expected one running container per service")
            item = json.loads(run(["docker", "inspect", identifier]))[0]
            labels = item["Config"]["Labels"]
            if (
                labels.get("com.docker.compose.project") != project
                or labels.get("com.docker.compose.service") != service
            ):
                raise BackupError("Container ownership check failed")
            self.ids[service] = identifier
            self.images[service] = item["Image"]

    def unchanged(self):
        if (
            self.env_bytes != self.env.read_bytes()
            or self.release != (self.root / "current").resolve()
        ):
            raise BackupError("Deployment changed during backup; retry")
        for service, identifier in self.ids.items():
            if (
                run([*self.command, "ps", "-q", service], text=True).strip()
                != identifier
            ):
                raise BackupError("Container changed during backup; retry")

    def pg(self, *args):
        return ["docker", "exec", self.ids["postgres"], *args]


def line_json(process):
    content = bytearray()
    deadline = time.monotonic() + 120
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while True:
            if not selector.select(max(0, deadline - time.monotonic())):
                raise BackupError("Snapshot export timed out")
            byte = os.read(process.stdout.fileno(), 1)
            if byte == b"\n":
                break
            if not byte or len(content) > 1024 * 1024:
                raise BackupError("Snapshot export failed")
            content.extend(byte)
    try:
        return json.loads(content)
    except (ValueError, TypeError):
        raise BackupError("Snapshot export failed") from None


def copy_entry(bundle, name, stream):
    digest = hashlib.sha256()
    with bundle.open(name, "w", force_zip64=True) as target:
        while chunk := stream.read(1024 * 1024):
            target.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def process_entry(bundle, name, command):
    with subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ) as process:
        try:
            digest = copy_entry(bundle, name, process.stdout)
            if process.wait(timeout=30):
                raise BackupError("Archive component export failed")
            return digest
        finally:
            if process.poll() is None:
                process.kill()


def receipt(directory, verify=True):
    if directory.is_symlink() or not NAME.fullmatch(directory.name):
        raise BackupError("Not a managed backup directory")
    if {item.name for item in directory.iterdir()} != {"backup.age", "receipt.json"}:
        raise BackupError("Unexpected backup directory contents")
    payload = directory / "backup.age"
    private_file(payload)
    value = json.loads(private_file(directory / "receipt.json").read_text())
    if (
        value.get("kind") != KIND
        or value.get("version") != 1
        or value.get("id") != directory.name
    ):
        raise BackupError("Invalid backup receipt")
    if payload.stat().st_size != value["bytes"] or (
        verify and sha_file(payload) != value["sha256"]
    ):
        raise BackupError("Encrypted backup checksum mismatch")
    return value


def prune(destination, retain):
    candidates = []
    for directory in destination.iterdir():
        if NAME.fullmatch(directory.name):
            try:
                created = datetime.fromisoformat(receipt(directory)["created_at"])
            except (BackupError, OSError, ValueError, KeyError):
                continue  # Never remove unknown, incomplete or manually altered directories.
            candidates.append((created, directory))
    for _, directory in sorted(candidates, reverse=True)[retain:]:
        (directory / "backup.age").unlink()
        (directory / "receipt.json").unlink()
        directory.rmdir()


def export_bundle(server, bundle, snapshot, exporter, started):
    hashes = {}
    hashes["database.dump"] = process_entry(
        bundle,
        "database.dump",
        server.pg(
            "pg_dump",
            "-U",
            "pictoflow",
            "-d",
            "pictoflow",
            "-Fc",
            "--snapshot",
            snapshot,
        ),
    )
    proof = line_json(exporter)
    exporter.stdin.write("done\n")
    exporter.stdin.flush()
    exporter.communicate(timeout=15)
    if exporter.returncode:
        raise BackupError("Snapshot verification failed")
    hashes["server.env"] = copy_entry(
        bundle, "server.env", io.BytesIO(server.env_bytes)
    )
    release = server.settings["PICTOFLOW_RELEASE"]
    if not re.fullmatch("[a-zA-Z0-9_.-]+", release):
        raise BackupError("Invalid release name")
    source = server.root / "releases" / f"pictoflow-{release}.tar.gz"
    with source.open("rb") as stream:
        hashes["sources.tar.gz"] = copy_entry(bundle, "sources.tar.gz", stream)
    deployment = json.loads((server.release / "deployment-manifest.json").read_text())
    if (
        deployment["archive_sha256"] != hashes["sources.tar.gz"]
        or deployment["release"] != release
    ):
        raise BackupError("Source package does not match the deployed release")
    if server.tls:
        hashes["caddy.tar"] = process_entry(
            bundle,
            "caddy.tar",
            [
                "docker",
                "exec",
                server.ids["https"],
                "tar",
                "-C",
                "/data",
                "-cf",
                "-",
                "caddy",
            ],
        )
    server.unchanged()
    manifest = {
        "kind": KIND,
        "version": 1,
        "created_at": started,
        "release": release,
        "images": server.images,
        "tls": server.tls,
        "tls_mode": server.tls_mode,
        "proof": proof,
        "files": hashes,
        "deployment": deployment,
    }
    bundle.writestr("manifest.json", json.dumps(manifest))


def encrypt_bundle(server, payload, keys, started):
    exporter = subprocess.Popen(
        [
            "docker",
            "exec",
            "-i",
            server.ids["backend"],
            "python",
            "scripts/container_entrypoint.py",
            "python",
            "-u",
            "-c",
            EXPORT,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )
    try:
        snapshot = line_json(exporter)["snapshot"]
        if not re.fullmatch("[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+", snapshot):
            raise BackupError("Invalid exported snapshot")
        with payload.open("xb") as output:
            encrypt_args = ["age", "--encrypt"]
            for key in keys:
                encrypt_args.extend(["--recipient", key])
            with subprocess.Popen(
                encrypt_args,
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=subprocess.DEVNULL,
            ) as encrypt:
                try:
                    with zipfile.ZipFile(
                        encrypt.stdin, "w", compression=zipfile.ZIP_STORED
                    ) as bundle:
                        export_bundle(server, bundle, snapshot, exporter, started)
                    encrypt.stdin.close()
                    if encrypt.wait(timeout=60):
                        raise BackupError("Encryption failed")
                finally:
                    if encrypt.poll() is None:
                        encrypt.kill()
            output.flush()
            os.fsync(output.fileno())
    finally:
        if exporter.poll() is None:
            exporter.stdin.close()
            try:
                exporter.wait(timeout=10)
            except subprocess.TimeoutExpired:
                exporter.kill()
        exporter.stdout.close()
    payload.chmod(0o600)


def backup(root):
    root, config, destination, keys = configuration(root)
    with locked(destination):
        status_path = destination / "status.json"
        previous = json.loads(status_path.read_text()) if status_path.exists() else {}
        started = now().isoformat()
        status = {
            "state": "running",
            "started_at": started,
            "last_success": previous.get("last_success"),
        }
        write_json(status_path, status)
        try:
            server = Server(root, config["project"])
            identifier = (
                "pictoflow-" + now().strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
            )
            with tempfile.TemporaryDirectory(
                prefix=".incomplete-", dir=destination
            ) as directory:
                work = Path(directory)
                payload = work / "backup.age"
                encrypt_bundle(server, payload, keys, started)
                value = {
                    "kind": KIND,
                    "version": 1,
                    "id": identifier,
                    "created_at": started,
                    "bytes": payload.stat().st_size,
                    "sha256": sha_file(payload),
                }
                write_json(work / "receipt.json", value)
                sync_directory(work)
                work.rename(destination / identifier)
                sync_directory(destination)
            status.update(state="completed", last_success=value)
            write_json(status_path, status)
            prune(destination, config["retain"])
            print(
                json.dumps(
                    {"state": "completed", "id": identifier, "bytes": value["bytes"]}
                )
            )
        except BaseException as error:
            status.update(
                state="failed",
                failed_at=now().isoformat(),
                error_type=type(error).__name__,
            )
            write_json(status_path, status)
            raise


def validate_bundle(bundle):
    names = bundle.namelist()
    if (
        len(names) != len(set(names))
        or set(names) - MEMBERS
        or not MEMBERS - {"caddy.tar"} <= set(names)
    ):
        raise BackupError("Unexpected recovery archive entries")
    manifest = json.loads(bundle.read("manifest.json"))
    if manifest.get("kind") != KIND or manifest.get("version") != 1:
        raise BackupError("Unsupported recovery archive")
    expected = set(names) - {"manifest.json"}
    if set(manifest["files"]) != expected or manifest["tls"] != ("caddy.tar" in names):
        raise BackupError("Incomplete recovery archive")
    for name, digest in manifest["files"].items():
        with bundle.open(name) as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != digest:
                raise BackupError("Recovery component checksum mismatch")
    if manifest["tls"]:
        with (
            bundle.open("caddy.tar") as source,
            tarfile.open(fileobj=source) as archive,
        ):
            members = archive.getmembers()
            if any(
                Path(item.name).is_absolute()
                or ".." in Path(item.name).parts
                or not (item.isdir() or item.isfile())
                for item in members
            ):
                raise BackupError("Unsafe TLS archive entries")
            mode = manifest.get("tls_mode", "local")
            if mode == "local":
                prefixes = ["caddy/pki/authorities/local/" + stem for stem in ("root", "intermediate")]
            elif mode == "public":
                prefixes = [
                    item.name[:-4] for item in members
                    if item.isfile() and item.name.startswith("caddy/certificates/")
                    and item.name.endswith(".crt")
                ]
                if not prefixes:
                    raise BackupError("Public TLS archive has no issued certificate")
            else:
                raise BackupError("Unsupported TLS recovery mode")
            for prefix in prefixes:
                if prefix + ".key" not in archive.getnames() or prefix + ".crt" not in archive.getnames():
                    raise BackupError("TLS certificate or private key is missing")
                certificate = archive.extractfile(prefix + ".crt").read()
                key = archive.extractfile(prefix + ".key").read()
                public_cert = run(
                    ["openssl", "x509", "-pubkey", "-noout"], input=certificate
                )
                public_key = run(["openssl", "pkey", "-pubout"], input=key)
                if public_cert != public_key:
                    raise BackupError("TLS certificate and private key do not match")
    return manifest


def restore_check(directory, identity, report):
    directory = directory.absolute()
    value = receipt(directory)
    private_file(identity)
    # Only this generated container is ever a restore target; no production name,
    # port, network, bind mount, Docker socket or persistent volume is accepted.
    name = "pictoflow-restore-" + uuid4().hex
    label = "io.pictoflow.restore-check=" + name
    image = "postgres:18-bookworm"
    with tempfile.TemporaryDirectory(prefix="pictoflow-recovery-") as temporary:
        work = Path(temporary)
        decoded = work / "backup.zip"
        run(
            [
                "age",
                "--decrypt",
                "--identity",
                str(identity),
                "--output",
                str(decoded),
                str(directory / "backup.age"),
            ]
        )
        with zipfile.ZipFile(decoded) as bundle:
            manifest = validate_bundle(bundle)
            uid = run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--pull",
                    "never",
                    "--network",
                    "none",
                    "--entrypoint",
                    "id",
                    image,
                    "-u",
                    "postgres",
                ],
                text=True,
            ).strip()
            gid = run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--pull",
                    "never",
                    "--network",
                    "none",
                    "--entrypoint",
                    "id",
                    image,
                    "-g",
                    "postgres",
                ],
                text=True,
            ).strip()
            if not uid.isdecimal() or not gid.isdecimal():
                raise BackupError("Invalid PostgreSQL identity")
            try:
                run(
                    [
                        "docker",
                        "run",
                        "-d",
                        "--pull",
                        "never",
                        "--name",
                        name,
                        "--label",
                        label,
                        "--network",
                        "none",
                        "--read-only",
                        "--user",
                        f"{uid}:{gid}",
                        "--cap-drop",
                        "ALL",
                        "--security-opt",
                        "no-new-privileges:true",
                        "--memory",
                        "1g",
                        "--cpus",
                        "1",
                        "--pids-limit",
                        "128",
                        "--tmpfs",
                        f"/var/lib/postgresql:rw,noexec,nosuid,size=512m,uid={uid},gid={gid}",
                        "--tmpfs",
                        f"/var/run/postgresql:rw,noexec,nosuid,uid={uid},gid={gid}",
                        "--tmpfs",
                        "/tmp:rw,noexec,nosuid",
                        "-e",
                        "POSTGRES_HOST_AUTH_METHOD=trust",
                        "-e",
                        "POSTGRES_USER=pictoflow",
                        "-e",
                        "POSTGRES_DB=pictoflow",
                        image,
                    ]
                )
                deadline = time.monotonic() + 60
                while True:
                    # The image first starts a socket-only initialization server.
                    # Wait for the final TCP listener, after that server restarts.
                    probe = subprocess.run(
                        [
                            "docker",
                            "exec",
                            name,
                            "pg_isready",
                            "-h",
                            "127.0.0.1",
                            "-U",
                            "pictoflow",
                            "-d",
                            "pictoflow",
                        ],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    )
                    if probe.returncode == 0:
                        break
                    if time.monotonic() > deadline:
                        raise BackupError("Isolated PostgreSQL did not start")
                    time.sleep(0.5)
                with (
                    bundle.open("database.dump") as dump,
                    subprocess.Popen(
                        [
                            "docker",
                            "exec",
                            "-i",
                            name,
                            "pg_restore",
                            "-U",
                            "pictoflow",
                            "-d",
                            "pictoflow",
                            "--exit-on-error",
                            "--single-transaction",
                            "--no-owner",
                            "--no-acl",
                        ],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    ) as restore,
                ):
                    try:
                        shutil.copyfileobj(dump, restore.stdin)
                        restore.stdin.close()
                        if restore.wait(timeout=120):
                            raise BackupError("Isolated database restore failed")
                    finally:
                        if restore.poll() is None:
                            restore.kill()

                def sql(query):
                    return run(
                        [
                            "docker",
                            "exec",
                            name,
                            "psql",
                            "-X",
                            "-U",
                            "pictoflow",
                            "-d",
                            "pictoflow",
                            "-At",
                            "-c",
                            query,
                        ]
                    )

                tables = manifest["proof"]["tables"]
                actual = (
                    sql(
                        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
                    )
                    .decode()
                    .splitlines()
                )
                if set(actual) != set(tables):
                    raise BackupError("Restored table set differs")
                for table, expected in tables.items():
                    if not IDENTIFIER.fullmatch(table):
                        raise BackupError("Invalid table name")
                    data = sql(
                        f'SELECT to_jsonb(t)::text FROM public."{table}" t'
                    ).splitlines()
                    hashes = [hashlib.sha256(row).hexdigest() for row in data]
                    if {
                        "rows": len(hashes),
                        "sha256": hashlib.sha256(
                            "".join(sorted(hashes)).encode()
                        ).hexdigest(),
                    } != expected:
                        raise BackupError("Restored row fingerprints differ")
                    if table == "photo_asset":
                        for row in data:
                            photo = json.loads(row)
                            if (
                                hashlib.sha256(
                                    bytes.fromhex(photo["content"][2:])
                                ).hexdigest()
                                != photo["digest"]
                            ):
                                raise BackupError("Restored photo integrity failed")
                result = {
                    "state": "verified",
                    "backup_id": value["id"],
                    "checked_at": now().isoformat(),
                    "tables_verified": len(tables),
                    "tls_keys_verified": manifest["tls"],
                    "network": "none",
                    "production_modified": False,
                }
                write_json(report, result)
                print(json.dumps(result))
            finally:
                inspection = subprocess.run(
                    ["docker", "inspect", name],
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
                if inspection.returncode == 0:
                    container = json.loads(inspection.stdout)[0]
                    if (
                        container["Config"]["Labels"].get("io.pictoflow.restore-check")
                        == name
                    ):
                        run(["docker", "rm", "-f", name])


def status(root, hours):
    _, _, destination, _ = configuration(root)
    result = json.loads((destination / "status.json").read_text())
    success = result.get("last_success")
    healthy = bool(
        success
        and result["state"] == "completed"
        and (now() - datetime.fromisoformat(success["created_at"])).total_seconds()
        < hours * 3600
    )
    if success:
        receipt(destination / success["id"])
    print(json.dumps(result))
    return 0 if healthy else 1


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "status"):
        sub = commands.add_parser(name)
        sub.add_argument("--root", type=Path, required=True)
        if name == "status":
            sub.add_argument("--max-age-hours", type=int, default=36)
    check = commands.add_parser("restore-check")
    check.add_argument("--backup", type=Path, required=True)
    check.add_argument("--identity", type=Path, required=True)
    check.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            backup(args.root)
        elif args.command == "restore-check":
            restore_check(args.backup, args.identity, args.report)
        else:
            return status(args.root, args.max_age_hours)
    except BackupError as error:
        print(f"Backup operation failed: {error}", file=sys.stderr)
        return 1
    except (
        OSError,
        ValueError,
        KeyError,
        subprocess.SubprocessError,
        zipfile.BadZipFile,
        tarfile.TarError,
    ):
        # Never echo captured subprocess output, archive data, passwords or keys.
        print(
            "Backup operation failed; no production restoration was attempted.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
