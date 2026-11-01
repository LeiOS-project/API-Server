# LeiOS API Server

The API behind the LeiOS package hub: accounts, publishers, packages and releases, stable promotion
and OS releases, backed by an Aptly repository that is published to S3. Built with Bun, Hono,
hono-openapi and Drizzle (SQLite), following the
[LeiCraftMC Style Guide](https://git.leicraftmc.de/LeiCraftMC/Style-Guides).

## Development

```bash
bun install
cp example.env .env   # then fill in the S3 settings and key paths
bun run dev           # http://localhost:12151 — API docs at /docs/v1
```

On first start the server downloads Aptly (needs network and `unzip`) and creates an `admin` user;
the password-reset link for it is logged and written to
`<LRA_CONFIG_BASE_DIR>/initial_admin_password_reset_token.txt`.

| Command | What it does |
| --- | --- |
| `bun run check:ci` | Biome format + lint check |
| `bun run typecheck` | TypeScript check of `src`, `tests`, `scripts` |
| `bun test` | Integration tests (temp DB, local S3, Aptly; needs `dpkg`, `dpkg-dev`, `build-essential`) |
| `bun run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `bun run compile linux-x64-baseline --no-version-tag` | Build the binary the Docker image uses (needs Bun ≥ 1.4.4, which embeds the migrations) |

## Deployment

CI builds the binary and the Docker image (`docker/Dockerfile`) from the default branch. Run it with
`docker/docker-compose.yml`; configuration is `LRA_*` environment variables (see `example.env`).
Everything stateful lives in the `data/` and `config/` volumes.

The API refuses to start when the S3 bucket already serves a published LeiOS repository that its
Aptly data (`LRA_APTLY_ROOT`) does not know, for example after a volume was moved or not mounted.
Publishing from an empty Aptly state would replace the live repository and break `apt` for every
installation, so fix the data path instead.

## License

[AGPL-3.0](LICENSE)
