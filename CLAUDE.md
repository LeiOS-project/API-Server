# CLAUDE.md — Claude Code specifics

Read `AGENTS.md` first; it points to the LeiCraftMC Style Guide and lists the rules. This file adds
the repo map and Claude-Code-specific notes.

## Slash commands

Defined in `.claude/settings.json`:

- `/verify` — Biome + typecheck + relevant tests.
- `/typecheck` — `bun run typecheck`.
- `/test` — `bun test` (focused file or full suite).

## Commands

| Action | Command |
| --- | --- |
| Dev server (auto-migrates by default) | `bun run dev` |
| Start like production (forces migrations) | `bun run start` |
| Format / lint gate | `bun run format` / `bun run check:ci` |
| Typecheck | `bun run typecheck` |
| Tests | `bun test` (one file: `bun test tests/permission-helper.test.ts`) |
| After schema edits | `bun run db:generate`, commit `drizzle/migrations/` |
| Aptly client | `bun run aptly-api-client:generate` |
| Binary for the Docker image | `bun run compile linux-x64-baseline --no-version-tag` |

## Repo map

```
src/
├── index.ts                      # Main: config → DB → permissions → email → branding → Aptly → API
├── api/
│   ├── index.ts                  # API: CORS, onError, /v1, /docs/v1, /health
│   ├── utils/                    # api-res, specHelpers, authHandler, email, metadata, shared-models/
│   └── versions/v1/
│       ├── index.ts              # openAPIConfig (tags from docs/index.ts DOCS_TAGS) + router
│       ├── middleware/auth.ts    # resolves the auth context
│       └── routes/               # one folder per resource: index.ts (router) + model.ts (Zod)
│           ├── auth/ (+ reset-password/)   account/ (+ apikeys/)   users/
│           ├── publishers/ (+ members/)
│           ├── packages/ (+ releases/, releases/stable-promotion-requests/, role-assignments/)
│           └── admin/ (users/, os-releases/, tasks/, stable-promotion-requests/)
├── aptly/                        # AptlyAPIServer (process), AptlyAPI (calls), api-client/ (generated)
├── db/                           # DB (DB.Tables / DB.Models), schema.ts, utils.ts
├── tasks/                        # TaskScheduler: os-release:create, testing-repo:update
└── utils/                        # config, constants, logger, permission-helper, branding-builder, live-repo
```

## Domain notes

- Packages are addressed as `<publisher>.<package>` (`fullname`, from `packages_full_view`).
- Repos: `leios-archive` (every upload), `leios-testing` (latest upload per architecture),
  `leios-stable` (one version per architecture, promoted by the `os-release:create` task).
- Package/release uploads and deletes enqueue `testing-repo:update`. A queued one skips itself when
  a later one is already queued; it ends with Aptly's `db cleanup`.
- Stable promotion: a publisher member requests it per release, an admin approves or denies, and
  approved releases are moved into stable by the next OS release.
- Site roles are `admin | developer | user`; publisher/package roles are
  `ADMIN > MAINTAINER > DEVELOPER > VIEWER` (`PermissionHelper`).
