# Public VPS for invited testers

This deployment is separate from the LAN installation. Start with an empty database and synthetic demonstration profiles. No LAN profile, photo, account, provider key or backup is transferred automatically.

## Prerequisites

- Ubuntu VPS with authorized SSH access, Docker Engine and Docker Compose **2.24.4 or newer**.
- A public DNS name whose A record points to the VPS; publish an AAAA record only when IPv6 is actually reachable.
- TCP 80/443 reachable at the VPS and its hosting firewall; keep SSH available to the operator.
- A reviewed source release. Commands below assume `/home/ubuntu/pictoflow`, an operator-owned directory with mode 0700, containing `releases/<release>/` and its matching `releases/pictoflow-<release>.tar.gz`.

Use the [Docker merge documentation](https://docs.docker.com/reference/compose-file/merge/) for the required `!override` support. Caddy obtains certificates automatically when the [public DNS and reachability requirements](https://caddyserver.com/docs/automatic-https) are met. Testers do not install the LAN certificate authority.

```text
Internet :80  --> Caddy redirect / certificate challenge
Internet :443 --> Caddy --> Next.js :3000 --> FastAPI :8000
                                               |-- PostgreSQL
                                               `-- Redis
```

The VPS overlay removes the LAN legacy port and all direct application port mappings. The application publishes only IPv4 TCP 80/443. The VPS itself may run other services: inspect existing listeners before installation rather than replacing them.

## First installation

From the reviewed release directory, create configuration once (replace the example DNS name and release identifier):

```sh
python3 deploy/init_vps_env.py /home/ubuntu/pictoflow/.env.server \
  --domain testers.example.org --release <release>
```

The file is private, uses a random database password, enables authentication and disables external AI initially. Do not reuse the LAN environment file. Keep configuration and release archives outside the public repository.

Use **both** Compose files for every VPS operation. The second file is essential; the base file alone is the LAN configuration.

```sh
docker compose --env-file /home/ubuntu/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml -f deploy/docker-compose.vps.yml config --quiet
docker compose --env-file /home/ubuntu/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml -f deploy/docker-compose.vps.yml up -d --build --wait
docker compose --env-file /home/ubuntu/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml -f deploy/docker-compose.vps.yml exec backend \
  python -m scripts.manage_accounts create-admin <login> --name '<display name>'
```

The console prompts for the administrator's passphrase; never put it in a command, issue or environment variable. Before bootstrap, the login screen is available but protected resources require authentication. Configure AI through **Administration → Fournisseur IA** after login. Create tester accounts privately. Hierarchical practitioner/parent/patient management is tracked in [#126](https://github.com/Mossaab-s/PictoFlow/issues/126).

Keep the Compose project name `pictoflow-vps` for updates and backups. Persist `postgres_data`, `https_data` and `https_config`; never run `down --volumes` on the deployed project.

## External verification

From a tester's device, using the real DNS name:

```sh
curl --fail --show-error https://testers.example.org/api/pictoflow/health
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://testers.example.org/api/pictoflow/profiles
curl --head http://testers.example.org/
```

Expect a healthy response, **401** for anonymous profile access, and an HTTP redirect to the configured HTTPS name. Certificate validation must succeed normally. Then verify login, profile isolation and communication using synthetic profiles. Confirm that direct ports 3000, 8000, 5432 and 6379 are not published. Record the source commit, release identifier and check results privately. Container health alone does not prove a publicly trusted certificate was issued.

## Backups and updates

Follow [the encrypted backup procedure](SERVER_BACKUPS.md). Use project `pictoflow-vps` in `backup-config.json`, retain `PICTOFLOW_DEPLOYMENT_MODE=vps` in `.env.server`, and use this release's backup script: it selects both Compose files and includes public certificate storage. Public TLS recovery verifies issued certificate/key pairs instead of requiring a LAN certificate authority. The rest of the database, source archive, private environment and isolated restore verification are unchanged.

That procedure expects `current` to point inside `releases/`, the source archive named above, and a `deployment-manifest.json` matching its SHA-256 and release identifier. Establish these records before enabling scheduled backups. Keep the age recovery identity outside the VPS and copy encrypted backups off the VPS. Perform an isolated restore rehearsal before collecting real tester data; CI exercises the synthetic recovery pipeline, not your off-server copy.

For updates: take and verify a backup, retain the previous source release, build the reviewed new release, run migrations, check health and authenticated communication, then update the `current` link and release record consistently. Do not restore an older database over newer tester activity to roll back application images. An incompatible schema rollback requires a separate recovery decision.

## Automated checks

`python deploy/test_vps.py --docker` checks the actual merged Compose configuration against hostile legacy environment values, removes extra published ports, enforces HTTPS authentication, adapts the public Caddy configuration without requesting a certificate, and verifies public TLS recovery validation. Existing LAN HTTPS and complete encrypted database restore tests remain in CI. Actual DNS issuance, SSH access and public browser checks require the selected VPS and domain.
