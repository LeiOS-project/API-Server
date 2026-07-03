# LeiOS API Server — Claude Code Guide

## Project Overview

Single Bun + TypeScript service providing a package repository API (Aptly-backed) with user management, S3 storage, and task scheduling. This is **not** a monorepo.

- **Framework**: Hono (Bun-optimized HTTP framework) with OpenAPI spec generation via `hono-openapi`
- **Database**: SQLite via Drizzle ORM (`bun:sqlite` driver) with migrations in `src/db/drizzle/`
- **Validation**: Zod for request/response validation and OpenAPI schema generation
- **Task Queue**: In-process `TaskScheduler` with a DB-backed processing loop
- **Package Storage**: S3-compatible (configurable endpoint via `LRA_S3_*` env vars)
- **Auth**: Session tokens (`lra_sess_`) and API keys (`lra_apikey_`) with Bearer token header

---

## Code Architecture & Directory Layout

```
src/
├── index.ts                          # Bootstrap, graceful shutdown
├── api/
│   ├── index.ts                      # Hono app setup, CORS, error handler, version registration
│   ├── utils/
│   │   ├── api-res.ts                # APIResponse class + Zod schemas + types
│   │   ├── specHelpers.ts            # APIRouteSpec, APIResponseSpec (OpenAPI helpers)
│   │   ├── apiVersionRouter.ts       # Abstract APIVersionRouter base class
│   │   ├── authHandler.ts            # AuthHandler, SessionHandler, APIKeyHandler
│   │   ├── metadata.ts              # RuntimeMetadata (generic DB-backed key-value)
│   │   └── shared-models/           # Zod models per resource (package, auth, publisher, etc.)
│   └── versions/v1/
│       ├── index.ts                  # V1 router, mounts sub-routers
│       ├── middleware/auth.ts        # Bearer token auth middleware
│       ├── docs/index.ts            # OpenAPI tag constants
│       └── routes/                   # Route handlers organized by resource
│           ├── auth/
│           ├── account/
│           ├── packages/
│           ├── publishers/
│           └── admin/
├── db/
│   ├── index.ts                      # DB class + DB.Tables + DB.Models namespaces
│   ├── schema.ts                     # Drizzle table/view definitions (snake_case columns)
│   └── drizzle/                     # Migration files (auto-generated)
├── aptly/api-client/                 # Generated — DO NOT hand-edit
├── utils/
│   ├── config.ts                     # ConfigSchema builder + ConfigHandler
│   ├── permission-helper.ts          # Role-based access control
│   ├── logger.ts                     # Leveled logger
│   └── index.ts                      # General utilities (Utils class)
├── types/                            # Shared types
└── middleware/                        # Global middleware
```

---

## Entrypoints & Runtime Flow

- **Main boot** (`src/index.ts`): load config → init DB → init permission helper → ensure log dir → start task queue processing → init Aptly → sync additional live-repo files → init API → start Aptly → start Hono API
- **`bun run start`** (and compiled binaries) use `scripts/entrypoint.ts`, which force-sets `LRA_DB_AUTO_MIGRATE=true` (auto-migrate on startup)
- **`bun run dev`** runs `src/index.ts` directly — does **not** force migrations
- When the users table is empty, startup creates a default `admin` user and writes a reset URL to `${LRA_CONFIG_BASE_DIR}/initial_admin_password_reset_token.txt`

---

## Required Environment & Host Tools

- Required env vars are enforced in `src/utils/config.ts`; missing required keys exit the process
- **Required keys**: `LRA_PRIVATE_KEY_PATH`, `LRA_PUBLIC_KEY_PATH`, all `LRA_S3_*` settings
- Boolean env parsing is strict: only the string `"true"` → `true`; everything else → `false`
- First Aptly startup downloads a binary to `${LRA_APTLY_ROOT}/bin/aptly`; host needs network access and `unzip`
- Package upload verification runs `dpkg --info`; keep `dpkg` available for release upload flows and tests

---

## Commands (Source of Truth)

| Action | Command |
|--------|---------|
| Install deps | `bun install` |
| Dev server | `bun run dev` |
| Start (auto-migrate) | `bun run start` |
| Typecheck | `bun run typecheck` (checks `src`, `tests`, `scripts`) |
| Run all tests | `bun test` |
| Run one test file | `bun test tests/permission-helper.test.ts` |
| DB workflow after schema edits | `bun run db:generate` then `bun run db:migrate` |
| Regenerate Aptly API client | `bun run aptly-api-client:generate` |
| Compile binary | `bun run compile <platform\|auto\|all> [version] [--no-version-tag]` |
| Docker build input | `build/bin/leios-api-linux-x64-baseline` — generate with `bun run compile linux-x64-baseline --no-version-tag` |

---

## Testing Gotchas

- `bunfig.toml` preloads `tests/helpers/preload.ts` for every test run
- Preload builds a self-contained test env: temp DB, generated GPG keys, local `s3rver`, then starts Aptly/API on fixed ports **12150** and **12151**
- Tests are **integration-heavy** (DB + Aptly + S3-style publish config + generated local GPG keys), not pure unit tests
- The test preload does **not** start `TaskScheduler.processQueue()` — routes that enqueue tasks only create DB task records unless a test starts the scheduler explicitly
- `tests/aptly.test.ts` needs `.deb` fixtures under `testdata/`

---

## Route Handler Pattern (4-Step)

Every route handler follows this exact sequence:

```ts
router.get('/',
    // 1. OpenAPI spec
    APIRouteSpec.authenticated({ summary: "List packages", ... }),
    // 2. Zod validation (query, param, body, or form)
    zValidator("query", PackageModel.GetAll.Query),
    // 3. Handler — destructure valid data + auth context
    async (c) => {
        const { limit, offset } = c.req.valid("query");
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // 4. Return via APIResponse
        return APIResponse.success(c, "Packages retrieved successfully", results);
    }
);
```

### Key details:
- **Route composition**: Each resource exports a `Hono` router with `.basePath()`; sub-routers are mounted via `parentRouter.route('/:param', subRouter)`
- **Parameter loading middleware**: `router.use('/:fullPackageName/*', zValidator("param", ...), async (c, next) => { ... })` loads a DB resource and stores it with `c.set("key", value)`, then `return await next()`
- **Auth check inside handlers**: Always check `authContext.type` — it can be `'unauthenticated'`, `'session'`, or `'apikey'`. Some endpoints branch behavior based on auth level
- **@ts-ignore**: Used before `c.get("authContext")` casts because Hono context isn't strictly typed for custom `c.set` values

---

## Response Format

### Success Responses (`APIResponse` static methods)

All success responses have the shape:
```ts
{ success: true, code: 200, message: string, data: T }
```

| Method | HTTP Code |
|--------|-----------|
| `APIResponse.success(c, msg, data)` | 200 |
| `APIResponse.successNoData(c, msg)` | 200 (data: null) |
| `APIResponse.created(c, msg, data)` | 201 |
| `APIResponse.createdNoData(c, msg)` | 201 |
| `APIResponse.accepted(c, msg, data)` | 202 |

### Error Responses

Error responses have **no `data` field** — shape is:
```ts
{ success: false, code: 4xx|5xx, message: string }
```

| Method | HTTP Code |
|--------|-----------|
| `APIResponse.badRequest(c, msg)` | 400 |
| `APIResponse.unauthorized(c, msg)` | 401 |
| `APIResponse.forbidden(c, msg)` | 403 |
| `APIResponse.notFound(c, msg)` | 404 |
| `APIResponse.conflict(c, msg)` | 409 |
| `APIResponse.tooManyRequests(c, msg)` | 429 |
| `APIResponse.serverError(c, msg)` | 500 |

### Namespace Extensions
- `APIResponse.Types` — Type-level helpers (`RequiredReturnData`, `NonRequiredReturnData`, `BasicReturnData`)
- `APIResponse.Schema` — Zod schemas for each response (used in OpenAPI spec)
- `APIResponse.Utils` — `genericErrorSchema()` factory, `createErrorSchemaFactory()` curried helper

### OpenAPI Spec Helpers (`src/api/utils/specHelpers.ts`)
- `APIRouteSpec.authenticated({...})` — wraps `describeRoute` with `security: [{ bearerAuth: [] }]`
- `APIRouteSpec.unauthenticated({...})` — no security
- `APIResponseSpec.success(msg, dataSchema)` / `.created()` / `.accepted()` / `.serverError()` etc.
- `APIResponseSpec.describeBasic(responses)` — merges multiple response schemas
- `APIResponseSpec.describeWithWrongInputs(responses)` — same as basic but auto-adds 400 response

---

## Auth Pattern

- **Global middleware** (`src/api/versions/v1/middleware/auth.ts`) runs on every v1 route
- If no `Authorization` header: sets `c.set("authContext", { type: 'unauthenticated' })` and continues
- If `Bearer <token>` present: validates via `AuthHandler.getAuthContext(token)`, sets authenticated context on success, returns 401 on failure
- **Per-subtree guards**: admin routes add a second middleware checking `authContext.user_role !== 'admin'`; account routes check `authContext.type !== 'session'`

### Auth context shape (in `AuthHandler.AuthContext`):
```ts
type AuthContext = {
    type: 'unauthenticated'
} | {
    type: 'session' | 'apikey'
    user_id: number
    user_role: string
    publisher_memberships: number[]
    session_id?: number
}
```

### Token handling:
- Session tokens prefix: `lra_sess_`
- API keys prefix: `lra_apikey_`
- Format: `{prefix}{id}:{base64random}`
- Bases are hashed with `Bun.password.hash()` before DB storage

---

## DB Access Patterns

All queries go through Drizzle ORM via the `DB` singleton:

```ts
import { DB } from "../../../db";
import { and, eq, ilike, or, SQL } from "drizzle-orm";
```

### Common patterns:

```ts
// Simple select with get()
const user = DB.instance().select()
    .from(DB.Tables.users)
    .where(eq(DB.Tables.users.username, username))
    .get();

// Select specific columns
const publisher = DB.instance()
    .select({ id: DB.Tables.publishers.id })
    .from(DB.Tables.publishers)
    .where(eq(DB.Tables.publishers.name, publisherName))
    .get();

// Dynamic filter arrays (preferred for optional filters)
const filters: Array<SQL<unknown> | undefined> = [];
if (publisherID) filters.push(eq(DB.Tables.packages.publisher_id, publisherID));
if (search) filters.push(or(ilike(DB.Tables.packages.name, `%${search}%`)));
const results = await DB.instance().select()
    .from(DB.Tables.packages)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .limit(limit).offset(offset);

// Insert with returning
const newUser = DB.instance().insert(DB.Tables.users)
    .values({ username, hashed_password })
    .returning().get();

// Update
DB.instance().update(DB.Tables.users)
    .set({ role: 'admin' })
    .where(eq(DB.Tables.users.id, userId));

// Transaction
DB.instance().transaction(async (tx) => {
    await tx.delete(DB.Tables.sessionTokens).where(eq(DB.Tables.sessionTokens.user_id, userId));
    await tx.insert(DB.Tables.auditLog).values({ ... });
});

// Dynamic query with $dynamic()
let query = DB.instance().select({ ... }).from(DB.Tables.publishers).$dynamic();
if (condition) query = query.innerJoin(DB.Tables.publisherMembers, and(...));
```

### Table & Model accessors:
- `DB.Tables.*` — Drizzle table instances (maps camelCase to snake_case)
- `DB.Models.*` — TypeScript type aliases for table rows (`DB.Models.PackageFullView`)
- All tables have snake_case DB columns but camelCase TS property names (Drizzle handles the mapping)

---

## TypeScript Patterns

### Class + Namespace (the dominant pattern)

Every major module uses a class with a same-namespace for associated types:

```ts
export class AuthHandler { ... }
export namespace AuthHandler.AuthContext { /* types */ }
export namespace AuthHandler.TokenParts { /* types */ }
```

Used by: `APIResponse`, `AuthHandler`, `PermissionHelper`, `DB`, `Logger`, `Utils`, `APIVersionRouter`

### Model Organization (nested namespaces per operation)

Each route model group uses nested namespaces for request/response types:

```ts
export namespace PackageModel.GetAll {
    export const Query = z.object({ limit: z.number(), offset: z.number() });
    export type Query = z.infer<typeof Query>;
    export const Response = z.object({ ... });
    export type Response = z.infer<typeof Response>;
}
```

### Strict TypeScript settings:
- `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`
- Use `import type` for type-only imports (required by `verbatimModuleSyntax`)
- `satisfies` over `as` for return type verification: `results satisfies PackageModel.GetAll.Response`
- `as` casts for `c.get()`: `c.get("authContext") as AuthHandler.AuthContext`
- `Utils.asExact<Shape>()` — identity function enforcing exact shape (no extra properties)

---

## Naming Conventions

| Category | Convention | Examples |
|----------|-----------|---------|
| File names | kebab-case | `api-res.ts`, `permission-helper.ts`, `os-release-utils.ts` |
| Module entry | `index.ts` | Always the barrel/entry file |
| Functions/methods | camelCase | `getUserRole()`, `createSession()`, `isValidSession()` |
| Classes/types/namespaces | PascalCase | `APIResponse`, `AuthHandler`, `PackageModel` |
| Constants | UPPER_SNAKE_CASE | `SESSION_TOKEN_PREFIX`, `LOGIN_MAX_ATTEMPTS` |
| Env vars | UPPER_SNAKE_CASE | `LRA_LOG_LEVEL`, `LRA_DB_PATH` |
| DB tables/columns | snake_case | `publisher_members`, `created_at`, `user_id` |
| Test files | `*.test.ts` | `permission-helper.test.ts` |

---

## Error Handling

- **Global error handler** registered in `src/api/index.ts` via `app.onError()`
- Catches `HTTPException` (Hono's native error) — extracts Zod validation issues from the response body
- Unknown errors → log with `Logger.error()` and return 500
- Per-route: use `try/catch` around DB/aptly operations, returning appropriate `APIResponse.*` error
- Per-route validation: `zValidator` middleware auto-returns 400 on schema mismatch

---

## Config Validation Pattern

Uses a custom fluent `ConfigSchema` builder (not Zod):

```ts
private static schema = new ConfigSchema()
    .add("LRA_LOG_LEVEL", false, ["debug", "info", "warn", "error", "critical"])  // optional, validated
    .add("LRA_API_DISABLE_DOCS", false, [true, false])  // optional boolean (parses "true"/"false")
    .add("LRA_DB_PATH", false)                           // optional string
    .add("LRA_PRIVATE_KEY_PATH", true)                   // required string (exit if missing)
```

- Config is typed via conditional types: required fields are `string | boolean`, optional fields are `string | boolean | undefined`
- Parsed once at startup via `ConfigHandler.loadConfig()`, cached in a private static field
- Accessed via `ConfigHandler.getConfig()` typed getter

---

## Codegen & Edit Boundaries

- `src/aptly/api-client/**` is generated by `openapi-ts` — **do not hand-edit**
- After DB schema changes, commit both `drizzle/*.sql` and `drizzle/meta/*`
- Keep all API responses aligned with `APIResponse` (never return ad-hoc JSON from handlers)
- Package/release delete/upload routes enqueue `testing-repo:update` tasks — these only execute when the task scheduler loop is running

---

## Claude Code Custom Commands

Custom `/` commands defined in `.claude/settings.json`:
- **`/verify`** — Typecheck then run relevant tests
- **`/typecheck`** — Run TypeScript typecheck only
- **`/test`** — Run the test suite (with test env context)
