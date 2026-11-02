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
│   ├── utils/                    # api-res, specHelpers, authHandler, email, emailVerification,
│   │                             # auditLog, rateLimiter, metadata, shared-models/
│   └── versions/v1/
│       ├── index.ts              # openAPIConfig (tags from docs/index.ts DOCS_TAGS) + router
│       ├── middleware/auth.ts    # resolves the auth context
│       └── routes/               # one folder per resource: index.ts (router) + model.ts (Zod)
│           ├── auth/ (+ reset-password/, signup/, verify-email/)   account/ (+ apikeys/)   users/
│           ├── meta/ (features, public stats)   os-releases/ (public)   reports/
│           ├── publishers/ (+ members/)
│           ├── packages/ (+ releases/, releases/stable-promotion-requests/, role-assignments/)
│           └── admin/ (users/, publishers/, packages/, reports/, audit-log/, stats/,
│                       os-releases/, tasks/, stable-promotion-requests/)
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
- Stable promotion (`StablePromotion` in `src/api/utils/stablePromotion.ts`): a publisher member
  requests it per release (`pending`); site staff queue (`queued`) or deny it and can set it back
  to `pending`. The queued requests are the stable queue. An admin creates an OS release with any
  subset of the queue; when its task finishes, those requests become `released`
  (`os_release_id`). Every request has a conversation (`stable_promotion_request_messages`:
  comments and status changes) between the publisher's members and staff. While an OS release
  publishes, its requests and releases cannot change, and no second OS release can start.
- `os_release_packages` records what each OS release moves into stable. The `metadata` table
  (`RuntimeMetadata`) is a free key/value store; the stable queue no longer lives there.
- Site roles are `admin | moderator | developer | user`. Moderators (`PermissionHelper.isSiteStaff`)
  use `/admin/*` but cannot create or edit OS releases, administer accounts (only suspend regular
  users) or get publisher rights; admin-only routes check `PermissionHelper.isSiteAdmin`.
  Publisher/package roles are `ADMIN > MAINTAINER > DEVELOPER > VIEWER` (`PermissionHelper`).
- Descriptions, changelogs and conversation messages are Markdown (the Hub renders them).
- Signup (`LRA_SIGNUP_ENABLED` + SMTP) creates unconfirmed accounts; publishers and reports need a
  confirmed email (`users.email_verified_at`). Suspended users (`users.status`) cannot sign in.
- System packages (`src/utils/system-packages.ts`, created by `DB.init` under the `leios`
  publisher) carry `SYSTEM-MANAGED` and are read-only through the API for everyone: the
  package-loading middleware in `routes/packages` refuses every non-GET request on them (package,
  releases, uploads, stable requests, role assignments), and admin moderation refuses them too.
  Today that is `leios.system.branding-meta-files`, which the tasks build themselves; they record
  each published build with `BrandingBuilder.recordPublishedBuild` (testing version per testing
  update, stable version and a release with the OS release notes per OS release).
- Packages flagged `HIDDEN` are visible only to site staff, the owner and members
  (`PermissionHelper.canViewPackage`, applied by the package-loading middleware and the list).
- Record admin and publisher-management actions with `AuditLog.record(...)` (inside the action's
  transaction when there is one); paginated lists return `{ items, total }`.
