# Immich admin UI + "External services" rename — Design

**Issue:** #182 · **Branch:** `dev/immich-albums` · **Date:** 2026-07-11
**Status:** approved, ready for planning

## Problem

The user-facing Immich settings card renders a badge reading **"Provided by the
administrator"** (`immich:shared`, `ImmichConnectionCard.tsx:118`). It promises a
capability that **no admin can reach**: there is no UI anywhere to configure a
global Immich instance.

This is not a feature flag hiding the section — the component was never written.
The backend is complete and tested:

- `backend/src/routes/admin/immich.ts` — `GET /` , `PUT /`, `POST /test`, with
  key masking identical to `admin/apiKeys.ts`, mounted behind `authenticate` +
  `requireAdmin` + `requireWriteScope`
- `admin_settings.global_immich_base_url` / `global_immich_api_key`
  (migration `20260709120000_immich_albums`)
- `services/immich/immichResolver.ts` — three-tier resolution:
  **user → admin-global → env**
- `frontend/src/lib/api/immich.ts:59-78` — `getAdminSettings`,
  `updateAdminSettings`, `testAdminConnection` … **with zero call sites**

`AdminPage.tsx` contains no Immich reference at all. This is the **merge blocker
for 2.4.0**.

A second, related problem surfaced while designing: the section that *should*
host Immich is called **"API keys"** — in both the admin area and the user
settings. That name is why the gap went unnoticed: someone looking for "Immich"
in the admin sidebar sees only "API keys" and moves on. The section already
holds more than keys (it carries the parser permission toggles), and it will
grow further (Dawarich, the Photon geocoder for POI search).

## Scope

**In scope**

1. Rename the section to **"External services"** in **both** the admin area and
   the user settings, including the internal section id, with a backward-compatible
   alias for existing deep links.
2. A new self-contained `ImmichGlobalSettings` component in the admin area that
   drives the three existing endpoints.
3. Lift the `failureKey` helper out of `ImmichConnectionCard` so both cards share
   one error vocabulary.

**Explicitly out of scope** (owner decisions)

- **No `allowUserImmich` toggle.** The flight/parser keys let an admin forbid
  users from configuring their own; Immich has no such column and will not get
  one here. It is a genuine inconsistency, but it is not the merge blocker and it
  would drag in a migration, a resolver check and a lock-out state on the user
  card. Can be retrofitted later without touching this work.
- **`settings:apiTokens` is untouched.** Those are the personal access tokens for
  the mobile app — a different concept that must keep its name.

## Design

### 1. Rename `apiKeys` → `externalServices`

| | Section id (before → after) | Label (DE / EN) |
|---|---|---|
| Admin (`AdminPage.tsx`) | `apiKeys` → `externalServices` | Externe Dienste / External services |
| User settings (`SettingsPage.tsx`) | `apikeys` → `externalServices` | Externe Dienste / External services |

Touches the `ActiveSection` union and `TAB_FOR_SECTION` in `AdminPage.tsx`, and
the section list in `SettingsPage.tsx`.

**How deep the i18n rename goes.** Only the keys that *name the section* are
renamed:

- `admin:tabs.apiKeys` → `admin:tabs.externalServices`
- `settings:apiKeys.title` → `settings:externalServices.title`
- `settings:apiKeys.description` → `settings:externalServices.description`

Everything else under `settings:apiKeys.*` — notably `help.title` /
`help.description`, which explain the third-party **flight** providers — keeps
its key. That copy is genuinely about API keys, it lives *inside* the section,
and renaming it would be churn with no reader benefit. `parser.apiKeys.*` is a
separate subtree and is not touched at all.

**Deep-link compatibility.** Both pages read the active section from
`?section=`, and `SettingsPage` additionally from the URL hash. Every read site
maps the legacy value onto the new one:

```ts
const SECTION_ALIASES: Record<string, string> = { apiKeys: "externalServices", apikeys: "externalServices" };
const normalizeSection = (raw: string | null): string | null =>
  raw === null ? null : (SECTION_ALIASES[raw] ?? raw);
```

Three read sites: `AdminPage` `searchParams.get("section")`, `SettingsPage`
`searchParams.get("section")`, `SettingsPage` hash. Without this, an existing
bookmark silently lands on the default section.

**Copy.** The user-settings description currently reads *"Verwalte API-Schlüssel
für externe Dienste"*. It becomes *"Verbindungen zu externen Diensten"* — the
section now configures an Immich instance, not only keys. DE and EN together.

### 2. `ImmichGlobalSettings` — self-contained, zero props

Modelled on **`UsageStatsSettings`**, not on `GlobalApiKeysManager`.

`GlobalApiKeysManager` is a presentational component: `AdminPage` owns its state,
fetches, and saves, and passes six props down. That pattern is precisely why
`AdminPage.tsx` is **821 lines — already over the 800-line hard cap in
CLAUDE.md**. `UsageStatsSettings` is the newer pattern: `<UsageStatsSettings />`,
zero props, fetches and saves itself, owns its loading state and toasts.

Following it means `AdminPage` grows by exactly two lines (import + render), and
the new component stays independently testable.

Rendered inside the `externalServices` section, **below** `GlobalApiKeysManager`.

**Behaviour against the existing contract:**

| Action | Call | Semantics |
|---|---|---|
| Load | `GET /admin/immich` | Returns `{ baseUrl, apiKey }` with the key **masked** (`abcd****wxyz`). Both may be `null`. |
| Test | `POST /admin/immich/test` | Empty fields → tests the **stored** connection (`immichTestSchema` coerces `"" → undefined`, and the route falls back to the stored pair). Filled fields → tests that ad-hoc pair **before** saving. |
| Save | `PUT /admin/immich` | A masked key echoed back means "unchanged" — `looksMasked()` on the server refuses to store it. |
| Clear | `PUT` with `null` | `immichConnectionSchema` is `.nullable().optional()`: an explicit `null` clears the field. Clearing both removes the global connection, and the "provided by the administrator" badge disappears for users. |

**Errors** reuse the existing machine-readable vocabulary — `notConfigured`,
`unreachable`, `auth`, `notFound`, `protocol`, `invalidUrl` — rendered via
`failureKey(kind) → immich:errors.${kind}`, falling back to `errors.unknown`.

### 3. Share `failureKey`

`failureKey` is a three-line module-private function in `ImmichConnectionCard`.
Both cards need it. It moves to `frontend/src/lib/api/immich.ts`, next to
`isImmichFailureKind` and the `FAILURE_KINDS` list that define the vocabulary, and
both cards import it. This keeps a future seventh failure kind from being handled
in one card and forgotten in the other.

### 4. i18n

New keys under the existing `immich` namespace: `immich:admin.title`,
`admin.subtitle`, `admin.baseUrl`, `admin.apiKey`, `admin.apiKeyHint` (explaining
that a masked value left untouched keeps the stored key), `admin.save`,
`admin.test`, `admin.cleared`, `admin.saved`. DE and EN written together.

## Testing

Vitest, component-level, against a mocked `immichApi`:

- loads and displays the **masked** key, never a plaintext secret
- saving with the mask untouched sends **no new secret** (asserts the payload)
- clearing both fields sends `null` for both and reports the connection removed
- **Test** with empty fields calls `testAdminConnection({})` — i.e. tests the
  stored connection rather than sending empty strings
- a failure kind renders the localised message; an unknown kind falls back to
  `errors.unknown`
- **deep-link alias:** `?section=apiKeys` still resolves to the renamed section
  (both pages)

## Risks

- **The rename is the risky part, not the new card.** The section id appears in
  the union type, the tab map, i18n keys, URL params and the hash. `tsc` catches
  the type-level sites; the alias test covers the string-level ones. Missing an
  i18n key surfaces as a raw key on screen — the class of bug that shipped in
  2.3.0 (see `commonKeys.test.ts`, which guards `common:*` only).
- The user-settings section id is `apikeys` (lowercase k) while the admin one is
  `apiKeys`. Both legacy spellings must alias.
