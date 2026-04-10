# v1 API Unification & Permission Refactor — Plan

## Current state (what the agent will walk into)

- **v1 is currently broken / mid-refactor.** Most of `src/api/utils/services/*` (`permissions.ts`, `packages.ts`, `roles.ts`, `pkg-releases.ts`, ...) references schema objects that don't exist: `DB.Tables.publisherGroups`, `DB.Tables.roles`, `publisherMembers.group_id`, `publisherMembers.permissions`, `packages.group_id`, `packages.owner_user_id`, `packages.created_by_user_id`, `roleAssignments.publisher_id`, `publishers.visibility`. None of them exist in [src/db/schema.ts](../src/db/schema.ts).
- **`PermissionHelper` is a stub.** [src/utils/permission-helper.ts:7](../src/utils/permission-helper.ts#L7) has `static getRole` with no body. The namespace below it fully defines `OrgRoles` (ADMIN/MAINTAINER/DEVELOPER/VIEWER), `OrgPermissions`, and a complete `RolePermissions` lookup — that's the source of truth to build against.
- **Current working schema** (what `PermissionHelper` must work with): `publishers.owner_user_id`, `publisherMembers {publisher_id, user_id, role: OrgRoles, is_publicly_hidden}`, `roleAssignments {package_id, user_id, role: OrgRoles}` (package-scoped only — the "per-package override" table).
- **Tests are also drifted.** [tests/api-routes-v1.test.ts](../tests/api-routes-v1.test.ts) imports `PublicPackagesModel` from `v1/routes/public/packages/model` (doesn't exist), writes `packages.owner_user_id` and `packageReleases.versionWithLeiosPatch` (both nonexistent). Most package blocks are commented out.
- **Admin-only resources that aren't publishers or packages**: `admin/users`, `admin/os-releases`, `admin/tasks`, `admin/stable-promotion-requests`. These need a new home once the admin prefix goes away.

---

## Phase 0 — Align on open questions (do this first)

Surface to the user before touching code:

1. **Non-publisher/package admin resources** (`users`, `os-releases`, `tasks`, `stable-promotion-requests`): move to top-level `/users`, `/os-releases`, `/tasks`, `/stable-promotion-requests` each gated by a per-route "must be `user_role === 'admin'`" check? Or drop them from v1 entirely? Assume top-level + per-route admin check unless told otherwise.
2. **"Permission management on packages"** = CRUD on `roleAssignments` rows (grant a user an `OrgRoles` value for a specific package), right? Assuming yes.
3. **Admin bypass semantics**: the v0 `admin` middleware used `user_role === 'admin'`. In v1, admin bypass is computed inline by `PermissionHelper` — any site admin implicitly has the highest effective permission. Confirm that's the intended behaviour.
4. **Transfer-ownership semantics**: does it also rewrite the new owner's `publisherMembers` row to `ADMIN`, and demote the old owner to `ADMIN` (or leave as-is)? Plan assumes: new owner becomes/upserts to `ADMIN`; old owner stays `ADMIN`.

---

## Phase 1 — Flesh out `PermissionHelper`

File: [src/utils/permission-helper.ts](../src/utils/permission-helper.ts)

Fill in the empty class. This is the single source of truth for on-the-fly permission computation.

Add static methods (all `async`, all use `DB.instance()`):

- `getEffectiveRole({ userId, publisherId, packageId? }): Promise<OrgRoles | null>` — look up publisher membership row, look up package-level `roleAssignments` row if `packageId` given, return the **highest** role of the two (precedence: `ADMIN > MAINTAINER > DEVELOPER > VIEWER`). Return `null` if the user has no relationship at all.
- `getEffectivePermissions({ userId, publisherId, packageId? }): Promise<OrgPermissions | null>` — wraps `getEffectiveRole` then returns `RolePermissions[role]`; returns `null` when `getEffectiveRole` is `null`.
- `can({ authContext, publisherId, packageId?, permission: (perms) => boolean }): Promise<boolean>` — the main check. Accepts a selector callback against `OrgPermissions` (e.g. `perms => perms.packages.releases.publish`). Rules inside:
  1. If `authContext.type === 'unauthenticated'` → `false`.
  2. If `authContext.user_role === 'admin'` (site admin) → `true`.
  3. If the user is the publisher's `owner_user_id` → `true`.
  4. Otherwise compute effective permissions via `getEffectivePermissions` and return the result of the selector (falsy → `false`).
- `isPublisherOwner({ userId, publisherId })` — small helper used by routes where only ownership matters (e.g. delete publisher, transfer ownership).
- `compareRoles(a, b)` — helper returning `-1 | 0 | 1` based on the fixed precedence tuple.

Keep the class free of Hono `Context` — it only knows about DB and `AuthHandler.AuthContext`, so tests can call it directly.

**Extend `OrgPermissions` if needed.** Routes in Phase 5 need publisher-level "update" and "delete" bits that the current `OrgPermissions` interface lacks. Add a `publisher: { update: boolean; delete: boolean }` section (delete is owner-only so stays `false` everywhere; update is `true` for ADMIN) and update the `RolePermissions` table accordingly. Do it here so downstream phases can rely on it.

---

## Phase 2 — Restructure v1 routing

Edit [src/api/versions/v1/index.ts](../src/api/versions/v1/index.ts):

- Remove the `adminRouter` mount entirely.
- Final top-level mounts: `auth`, `account`, `publishers`, `packages`, plus (per Phase 0 outcome) `users`, `os-releases`, `tasks`, `stable-promotion-requests`.
- Collapse `DOCS_TAGS` in [src/api/versions/v1/docs/](../src/api/versions/v1/docs/) to drop the "Admin API /" / "Developer API /" tag groups and replace with resource-oriented groups: `Publishers`, `Packages`, `Users`, `OS Releases`, `Tasks`, `Stable Promotion Requests`, `Account & Authentication`. Delete the "Admin API" and "Developer API" `x-tagGroups` in the v1 `openAPIConfig`.

Delete:
- [src/api/versions/v1/routes/admin/](../src/api/versions/v1/routes/admin/) directory wholesale.

Re-home its contents:
- `admin/users/*` → `src/api/versions/v1/routes/users/`
- `admin/os-releases/*` → `src/api/versions/v1/routes/os-releases/`
- `admin/tasks/*` → `src/api/versions/v1/routes/tasks/`
- `admin/stable-promotion-requests/*` → `src/api/versions/v1/routes/stable-promotion-requests/` (top-level listing/admin ops)
- `admin/packages/releases.ts` and `admin/packages/stable-promotion-requests.ts` → merge any missing pieces into the existing dev counterparts under `packages/releases.ts` and `packages/stable-promotion-requests.ts`.

Inside each of the re-homed admin files, replace `if (authContext.user_role !== 'admin') return unauthorized` with per-route checks using `PermissionHelper.can` (when the action is scoped) or a tiny inline check `authContext.user_role === 'admin'` (for truly site-admin-only routes like user management).

---

## Phase 3 — Inline the services back into the routes

Per user instruction: "move shared service utilities back into the api spec itself."

Delete, after porting logic:
- `src/api/utils/services/packages.ts`
- `src/api/utils/services/permissions.ts` (superseded by `PermissionHelper`)
- `src/api/utils/services/pkg-releases.ts`
- `src/api/utils/services/pkg-stable-promotion-requests.ts`
- `src/api/utils/services/roles.ts`
- `src/api/utils/services/taskinfo.ts`

Rewrite each route handler so that the DB query + permission check + response live directly in the route file. Conventions:

- Inside a route: load the entity → call `PermissionHelper.can(...)` with the right selector → run the DB op → return via `APIResponse.*`.
- Use a **local** `packageMiddleware` / `publisherMiddleware` inside the relevant `index.ts` (not a shared service) that looks up the entity by URL param, sets it on the Hono context (`c.set("package", pkg)`), and fast-exits with 404. Permission checks happen **per route** after middleware, not inside the middleware — because the required permission varies per endpoint (e.g. GET needs none/viewer, PUT needs edit, DELETE needs delete).
- Shared Zod schemas stay colocated in the route's `model.ts`. Cross-version shared models in [src/api/utils/shared-models/](../src/api/utils/shared-models/) stay where they are — those aren't services.

Fix references that are currently broken against the real schema:
- Remove all `group_id`, `publisherGroups`, `roles` references.
- Package URL param stays `:publisherName/:packageName` (not `:packageFullName`) — look up via `packagesFullView` or an inner join on `publishers`.
- Drop `publisher.visibility` logic completely (no such column).

---

## Phase 4 — New routes

### Publishers — transfer ownership

File: [src/api/versions/v1/routes/publishers/index.ts](../src/api/versions/v1/routes/publishers/index.ts)

`POST /publishers/:publisherName/transfer-ownership` (body = `PublisherModel.TransferOwnership.Body`, which already exists at [publishers/model.ts:129](../src/api/versions/v1/routes/publishers/model.ts#L129)):
- Auth required; must be current owner (`PermissionHelper.isPublisherOwner`) OR site admin.
- Validate the new owner user exists.
- In a single `DB.instance().transaction`:
  1. `UPDATE publishers SET owner_user_id = :new` where id = ... .
  2. Upsert `publisherMembers` row for new owner with `role = ADMIN` and `is_publicly_hidden = false`.
  3. Leave the previous owner's membership as-is (it will already exist as `ADMIN` from the publisher-create flow).
- Return 200 + no data.
- Responses spec: `successNoData`, `notFound("Publisher not found")`, `notFound("New owner user not found")`, `forbidden("Only the current owner can transfer ownership")`.

### Publishers — members CRUD (rewrite)

File: [src/api/versions/v1/routes/publishers/members.ts](../src/api/versions/v1/routes/publishers/members.ts) — the current file references nonexistent things; rewrite against the real schema.

- `GET /publishers/:publisherName/members` — list rows from `publisherMembers` (filter out `is_publicly_hidden` unless caller is a member themselves or admin). Public.
- `POST /publishers/:publisherName/members` — body `{ user_id, role: OrgRoles, is_publicly_hidden? }`. Requires `PermissionHelper.can(..., p => p.members.invite)`. Conflict if row exists.
- `PUT /publishers/:publisherName/members/:userId` — body `{ role?, is_publicly_hidden? }`. Requires `p => p.members.updateRole`. Cannot modify the owner's row (owner role is implicit and always max).
- `DELETE /publishers/:publisherName/members/:userId` — requires `p => p.members.remove`. Cannot remove the owner; owner must transfer first.

Add matching Zod models in [publishers/model.ts](../src/api/versions/v1/routes/publishers/model.ts) — `AddMember.Body`, `UpdateMember.Body`, `ListMembers.Response`, using `PermissionHelper.OrgRolesAsTuple` for the role enum.

### Packages — per-package permission management (new)

New file: `src/api/versions/v1/routes/packages/role-assignments.ts`
New model: `src/api/versions/v1/routes/packages/role-assignments.model.ts` (or extend the existing package model).

The `roleAssignments` table is the per-package override. Routes:

- `GET /packages/:publisherName/:packageName/role-assignments` — list all `{user_id, role}` rows for this package. Visible to any user with `p => p.members.invite` on the publisher OR site admin.
- `POST /packages/:publisherName/:packageName/role-assignments` — body `{ user_id, role: OrgRoles }`. Requires caller to have `p => p.members.updateRole` at the **publisher** level. Conflict (409) if a row already exists for that user+package (use `UPDATE` endpoint instead).
- `PUT /packages/:publisherName/:packageName/role-assignments/:userId` — body `{ role }`. Same permission.
- `DELETE /packages/:publisherName/:packageName/role-assignments/:userId` — same permission.

Invariant the handlers must enforce, per user spec ("the specified role of the assignment have to be higher than the role in the parent scope" — this comment is already in [schema.ts:125-126](../src/db/schema.ts#L125-L126)):

- Before insert/update: compute the target user's publisher-level role (via `publisherMembers`). Reject with 400 if the new package-level role is **not strictly higher** than the publisher-level role — use `PermissionHelper.compareRoles` to enforce. A package assignment equal-or-lower than the publisher role is meaningless.

---

## Phase 5 — Wire permission checks into every existing route

Go through each currently-broken route file and replace any `PermissionsService.*` / `authContext.user_role !== 'admin'` check with a `PermissionHelper.can` call using the correct selector:

| Route | Selector |
|---|---|
| `POST /publishers` | always allowed if authenticated |
| `PUT /publishers/:name` | `p => p.publisher.update` (added in Phase 1) |
| `DELETE /publishers/:name` | owner-only — enforce via `isPublisherOwner` |
| `POST /packages` | `p => p.packages.create` |
| `PUT /packages/:.../:...` | `p => p.packages.update` |
| `DELETE /packages/:.../:...` | `p => p.packages.delete` |
| `POST /packages/.../releases` | `p => p.packages.releases.publish` |
| `POST /packages/.../releases/.../:arch` | `p => p.packages.releases.publish` |
| `POST /packages/.../stable-promotion-requests` | `p => p.packages.releases.requestStable` |

---

## Phase 6 — Tests

Test file: [tests/api-routes-v1.test.ts](../tests/api-routes-v1.test.ts) — **repair first, then extend**. Also consider splitting into per-resource files (`tests/v1-publishers.test.ts`, `tests/v1-packages.test.ts`, `tests/v1-permissions.test.ts`) now that v1 surface is growing.

### Repairs

- Delete the `PublicPackagesModel` import (doesn't exist) and the `GET /v1/public/packages` test block or retarget it at the real `/v1/packages` listing.
- Fix the `packages.owner_user_id` / `packageReleases.versionWithLeiosPatch` writes — use real column names (`publisher_id`, `version_with_leios_patch`) and seed a publisher first.
- Fix the `/v1/dev` and `/v1/admin` access tests — those prefixes no longer exist. Replace with tests against the new per-route permission gates.

### Shared seed helpers

Add `tests/helpers/seed.ts` with `seedPublisher(ownerUserId)`, `seedPackage(publisherId, overrides)`, `seedMembership(publisherId, userId, role)`, `seedPackageRoleAssignment(packageId, userId, role)` — keeps each test file compact.

### Coverage to add

One `describe` block per area.

1. **`PermissionHelper` unit tests** (`tests/permission-helper.test.ts`): hit `getEffectiveRole`, `getEffectivePermissions`, `can` directly against a seeded DB. Cases:
   - Unauthenticated → always `false`.
   - Site admin → always `true`, even with no membership.
   - Publisher owner → always `true`.
   - `MAINTAINER` at publisher level with no package assignment → uses publisher role.
   - `DEVELOPER` at publisher level + `MAINTAINER` at package level → effective is `MAINTAINER` for that package.
   - `DEVELOPER` at publisher level + no package assignment + `canDeletePackages` → `false`.
   - User with no membership at all → `null` / `false`.
2. **Publishers CRUD + ownership transfer**:
   - Create publisher as authenticated user → creator becomes owner + publisher_member ADMIN.
   - `POST transfer-ownership` by owner → succeeds, `owner_user_id` updated, new owner upserted to `ADMIN`.
   - `POST transfer-ownership` by non-owner → 403.
   - `POST transfer-ownership` to nonexistent user → 404.
   - `DELETE /publishers/:name` by owner with no packages → success; with packages → 400; by non-owner → 403.
3. **Publisher members**:
   - Owner invites DEVELOPER → 201.
   - Non-admin DEVELOPER tries to invite → 403.
   - Update member role as ADMIN → 200; target role written; target's sessions/api-keys not affected.
   - Delete member → 200; can't delete owner → 403/400.
4. **Packages CRUD with permission enforcement**:
   - DEVELOPER publisher member can create a package → 201.
   - VIEWER cannot create → 403.
   - MAINTAINER can update own package → 200; DEVELOPER cannot → 403.
   - Only ADMIN (or publisher owner or site admin) can delete → 200 vs 403.
   - Non-member can GET (if public) but not modify.
5. **Package role assignments (new)**:
   - Publisher ADMIN creates a role assignment on a package → 201.
   - Attempting to assign a role **equal or lower** than the target user's publisher role → 400.
   - A DEVELOPER with a `MAINTAINER` package-level assignment can now call `PUT /packages/...` on that specific package but not on sibling packages.
   - Deleting an assignment restores the old effective role.
6. **Package releases permission gates**:
   - User with `packages.releases.publish` can `POST /releases`.
   - VIEWER with no package override cannot.

Each HTTP test uses the existing [tests/helpers/api.ts](../tests/helpers/api.ts) `makeAPIRequest` helper. Assert the response envelope via Zod schemas from the route models.

---

## Phase 7 — Typecheck + run tests

- `bun run typecheck` — must pass cleanly (it currently does not, because of the broken services layer; removing them should be net-positive).
- `bun test tests/permission-helper.test.ts` first (fastest feedback, no HTTP).
- Then `bun test tests/api-routes-v1.test.ts` etc.
- Finally full `bun test`.

---

## Suggested execution order

1. Phase 0 questions → wait for answers.
2. Phase 1 `PermissionHelper` + its unit tests (Phase 6.1) — gives a green island to build against.
3. Phase 3 service inlining on the existing broken routes so the tree typechecks again.
4. Phase 2 routing restructure (delete `admin/`, re-home files) — purely mechanical once Phase 3 is clean.
5. Phase 4 new routes + models.
6. Phase 5 pass over every route to wire `PermissionHelper.can`.
7. Phase 6 remaining tests.
8. Phase 7 full check.

## Risk hotspots

- **Phase 1's role-precedence semantics** — easy to get "higher role wins" wrong when combining publisher + package scopes.
- **Phase 3 is large** and touches nearly every v1 route file.
- **`packagesFullView` + URL param change** from `:packageFullName` → `:publisherName/:packageName` will ripple through admin/dev routes and tests.