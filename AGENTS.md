# AGENTS.md — operating manual for AI coding agents

This is the LeiOS API server: a backend service (Bun + Hono + Zod + hono-openapi + Drizzle/SQLite)
in front of an Aptly package repository published to S3. LeiOS is its own product (initiated by
LeiCraft_MC, not a LeiCraft_MC product); its code follows the LeiCraftMC Style Guide: https://git.leicraftmc.de/LeiCraftMC/Style-Guides. The guide plus this repo are the
authority; generic internet advice is not.

## Must read

- [docs/00-overview.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/-/blob/main/docs/00-overview.md)
- [docs/04-backend-hono.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/-/blob/main/docs/04-backend-hono.md)
- [docs/05-api-contract.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/-/blob/main/docs/05-api-contract.md)
- [docs/08-database.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/-/blob/main/docs/08-database.md)
- [docs/10-auth.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/-/blob/main/docs/10-auth.md)
- [docs/12-testing.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/-/blob/main/docs/12-testing.md)

## Non-negotiable

- Every route uses the `{ success, code, message, data }` envelope via `APIResponse.*` helpers
  (errors omit `data`). Paginated lists return `data: { items, total }` (`ApiHelperModels.Paginated`).
- Register endpoints as `APIRouteSpec.*` → `zValidator(...)` → handler. Validate with
  `hono-openapi`'s validator (`import { validator as zValidator } from "hono-openapi"`).
- Read the auth context only through `AuthHandler.AuthContext.get(c)` / `getAsSession(c)`; never
  `c.get("authContext")`. Other per-request values go in the router's typed `Variables`.
- Publisher/package permissions go through `PermissionHelper.can(...)` inside handlers.
- Never hand-edit generated code: `drizzle/migrations/` (use `bun run db:generate`) and
  `src/aptly/api-client/` (use `bun run aptly-api-client:generate`).
- Aptly calls that create Aptly tasks go through `AptlyAPI.Tasks.run` (one at a time, polled with a
  time limit — Aptly's own task queue can deadlock).
- Static classes for services (`API`, `DB`, `Logger`, `ConfigHandler`, `AuthHandler`,
  `TaskScheduler`, `AptlyAPIServer`).
- Before finishing: `bun run check:ci`, `bun run typecheck`, and the relevant `bun test`.
- Conventional Commits.

## Repo specifics

- Env prefix `LRA_`, token prefix `lra_` (`src/utils/constants.ts`); config schema in
  `src/utils/config.ts`, documented in `example.env`. Port 12151; the Hub runs on 12153.
- Startup (`src/index.ts`) deviates from the guide in one place: the task queue starts after
  Aptly, because resumed tasks call Aptly directly.
- Host tools: `dpkg` (upload checks), `dpkg-dev` + `build-essential` (branding package build),
  `git`, `gnupg`, `unzip` + network on first start (Aptly download).
- Tests are integration tests: `tests/helpers/preload.ts` builds a temp DB, GPG keys, a local
  `s3rver`, Aptly on a random port and the API on 12151. The preload does not start the task
  queue; tests that need queued tasks to run start it themselves.
