# What's-New Modal — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorming), pending implementation plan
**Branch:** `dev/usage-stats` (Phase 0 — lands before the usage-stats client)
**Repos touched:** `TravStats` (frontend + backend)

## 1. Summary

Show users a "What's new in vX.Y.Z" modal once per version bump, rendering the
release highlights for the version they just upgraded to. It stands on its own
(users currently have no in-app way to learn what changed), and it is the host
surface for the usage-statistics consent card designed in
`2026-07-10-anonymous-usage-stats-design.md`.

This is Phase 0 of that work: it ships first, standalone, and the consent card
slots into it afterwards.

## 2. Goals / Non-goals

**Goals**
- Show release highlights once, on the first login after the running version changed.
- Dismissable, never nagging: dismissing persists per user for that version.
- Provide a stable extension slot so the usage-stats consent card can be injected
  without reworking the modal.
- DE primary + EN mirror, per the project language policy.

**Non-goals**
- Rendering `CHANGELOG.md` verbatim. The changelog is written for developers; the
  modal is written for users. Content is curated by hand per release.
- A full release-notes archive page in the app. Users can read the GitHub release.
- Push notifications, e-mail, or any out-of-app announcement.

## 3. Content source

Highlights live in a typed, hand-authored frontend module
`frontend/src/content/whatsNew.ts`:

```ts
export interface WhatsNewEntry {
  version: string;              // exact match against backend VERSION, e.g. "2.4.0"
  highlights: WhatsNewItem[];   // 2-5 items; more than 5 is a changelog, not a modal
}

export interface WhatsNewItem {
  icon: string;                 // lucide icon name
  titleKey: string;             // i18n key, DE + EN both present
  bodyKey: string;
}
```

Rationale for hand-authored over parsing `CHANGELOG.md`: the changelog is
English-only and developer-facing, while modal copy must be DE-primary and
user-facing. Parsing would force a translation step at runtime and couple the
modal to changelog formatting. A missing entry for the current version is not an
error — the modal simply does not show.

Adding a `WhatsNewEntry` becomes part of the release routine, documented in
`CLAUDE.md` next to the `/deploy` section.

## 4. Trigger logic

The modal shows when **all** of these hold:

1. The user is authenticated (never on the login or setup screen).
2. A `WhatsNewEntry` exists whose `version` equals the running backend version.
   Obtained via the **existing** `versionApi.get()` (`GET /api/v1/version`, defined
   in `frontend/src/lib/api/version.ts`), whose `version` field is already
   prerelease-stripped by `appVersion`. No new endpoint, no `/health` call — the
   frontend never talks to `/health` today and should not start.
3. That version is not recorded as seen for this user.

**Seen-state storage:** a new nullable column `whatsNewSeenVersion String?` on
`UserSettings`, written via the existing user-settings update route. Server-side
rather than `localStorage` so the modal does not re-appear on every new browser
or device — a modal that reappears is the thing users hate most about this
pattern.

Fresh installs: `SetupPage` completes and creates the admin user. The setup flow
writes `whatsNewSeenVersion` to the current version at account creation, so a
brand-new install never greets its first user with "what's new" about a version
they never ran.

## 5. Components

| File | Responsibility |
|---|---|
| `frontend/src/content/whatsNew.ts` | The entries. Data only, no JSX. |
| `frontend/src/hooks/useWhatsNew.ts` | Resolves running version → entry → should-show; exposes `dismiss()`. |
| `frontend/src/components/WhatsNewModal.tsx` | Presentation. Renders highlights + an optional `extraSlot` child. |

`WhatsNewModal` takes `extraSlot?: ReactNode` rendered below the highlights and
above the dismiss button. The usage-stats consent card passes through this slot
and the modal knows nothing about consent. This is the whole reason the two
features are separable.

Each unit is independently testable: `whatsNew.ts` is data, `useWhatsNew` is a
pure-ish hook over version + settings, `WhatsNewModal` is a presentational
component driven by props.

## 6. Data flow

```
versionApi.get().version ─┐
                          ├─> useWhatsNew() ─> { entry, shouldShow, dismiss }
userSettings ─────────────┘                            │
  .whatsNewSeenVersion                       v
                                    <WhatsNewModal extraSlot={…} />
                                             │ dismiss()
                                             v
                             PATCH user settings { whatsNewSeenVersion }
```

## 7. Error handling

- `/version` unreachable → no version → modal never shows. Silent; the modal is not
  important enough to surface an error.
- `dismiss()` PATCH fails → keep the modal closed for this session (local state)
  and log via the frontend logger. It will re-appear on the next session; that is
  the correct failure direction (annoying but not data-losing), and it must not
  block the user.
- Malformed / missing entry for the running version → no modal. No throw.

## 8. Testing

- `useWhatsNew`: shows when version matches an entry and `whatsNewSeenVersion`
  differs; hides when equal; hides when no entry exists; hides when unauthenticated.
- `WhatsNewModal`: renders all highlights; renders `extraSlot` when provided;
  omits the slot region entirely when not.
- `dismiss()` persists and the modal does not re-open on remount.
- Setup flow stamps `whatsNewSeenVersion` on the created admin user.
- i18n: every `titleKey`/`bodyKey` resolves in both `de` and `en` (a loop over
  `whatsNew.ts` asserting no missing keys — catches the classic "EN forgotten").

## 9. Migration

One additive Prisma migration: `user_settings.whats_new_seen_version TEXT NULL`.
Nullable, no backfill — existing users get the modal once on the next release,
which is the intended behaviour.

Generated via `npx prisma migrate dev`. **Caveat:** `schema.prisma` carries
known pre-existing drift vs. the migration history (see the cruise-migrations
note in `CLAUDE.md`). Inspect the generated SQL and strip anything unrelated to
this column before committing.

## 10. Risks

- **Modal fatigue.** Mitigated by the ≤5-highlight cap and once-per-version
  showing. If a release has nothing user-visible, omit the entry entirely.
- **Forgotten entry at release time.** The failure mode is benign (no modal), so
  this is a documentation task, not a build-time check.
- **Drift-tainted migration.** Covered above; review the SQL by hand.
