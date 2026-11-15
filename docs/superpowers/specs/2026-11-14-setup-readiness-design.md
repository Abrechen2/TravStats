# Setup & readiness — design

Status: concept approved by the owner on 2026-11-14 (artifact "TravStats
Einrichtungsassistent", https://claude.ai/artifact/HiRFooXgFyGazQg9dyZDgC), including the
three recommendations at its end. Second opinion: Codex, same day.

## 1. Intent

Owner, 2026-11-14: "Als neues Feature brauchen wir einen durchdachten Einrichtungsassistenten,
der auch nach großen Änderungen mit Updates noch mal auftaucht und dem Admin und normalen
Usern alles zeigt und erklärt, was sich ändert bzw. was man einstellen muss, was fehlt." And:
"Das ist ein allgemeines Problem, dass es nicht so leicht ist, alles zu wissen oder zu bedenken."

The real problem is forgetting, on three sides: the admin does not know what an update expects
of them, an ordinary account does not know what is missing for a feature to work, and we
developers forget to tell either. TravStats should know this itself and say it at the right time.

## 2. Goals, non-goals, anti-goals

Goals
- One permanent page, **Einrichtung & Zustand**, for every account: what is missing now, and
  what changed that needs action. Role-scoped (admin sees instance items, every account sees
  its own; an ordinary account sees an admin-owned blocker only as "Braucht den Admin" with the
  consequence, never configuration details).
- A short guided path on first run (after today's setup) and after an update that concerns the
  viewer.
- A developer contract enforced by a test, so a new feature or a removal cannot ship without
  declaring its readiness check or update note.

Non-goals
- No completeness score over all settings. An unused feature is not a gap.
- No replacement for the WhatsNewModal's release highlights; those stay what they are.
- Companion app display is a second stage (§7), not part of the first build.

Anti-goals (a failure even if it works)
- A modal that is dismissed reflexively and counted as done or as consent (the WhatsNewModal
  lesson, see the comment at the top of `frontend/src/components/WhatsNewModal.tsx`).
- A stack of dialogs on login.
- Network probes or test mails fired on login.
- A hand-kept list of features that drifts from the code.

## 3. Model

Two inputs, one list.

### 3.1 Readiness checks ("what is missing now")
Declared per feature in a backend registry (`backend/src/services/readiness/registry.ts`,
name is the builder's). Each entry:
- `id` (stable), `revision` (raised when the check's meaning changes, so a snooze expires)
- `scope`: `admin` | `user`
- `severity`: `required` | `recommended`
- `appliesWhen(ctx)`: enabled domains, selected providers, feature availability (beta gate,
  TravTrack instance switch). Not applicable → not shown.
- `evaluate(ctx)` → `ready` | `needsAction` | `unknown` (with evidence time). Evaluated on the
  server from stored state; never sends mail or probes the network on request. Where a check
  needs a live probe (external reachability of the public URL), it reads the result of the
  last scheduled or user-triggered test and says when that was.
- `consequence` and `title` as i18n keys (DE primary, EN mirror), `action` = a settings address
  that `resolveAddress` (`frontend/src/pages/Settings/area/redirects.ts`) accepts.
- Admin-owned prerequisites of a user item point to the admin item (`blockedBy`).

A result never carries a secret value.

### 3.2 Update notes ("what changed, what do I do")
Declared per version in a registry beside the checks (`backend/src/services/readiness/upgrades/`).
Each note: `id`, `version` (introduced in), `audience` (`admin` | `user`), `appliesWhen(ctx)`
(e.g. "had automatic backups off before"), `before` / `after` text keys, and either one
`action` (a check id or settings address) or `noAction: "<reason>"`.
- The instance records its upgrade history (versions it has run). An account sees the notes
  of every version between its last acknowledged version and the running one, filtered by
  audience and `appliesWhen`.
- New accounts start at the running version and see no historical notes — keep the
  creation-time behaviour of `backend/src/services/whatsNewStamp.ts`.
- An informational note can be acknowledged; a note with an action stays until its check is
  ready, independent of "seen".

### 3.3 States shown
`muss` (required, needs action) · `empfohlen` (recommended, needs action) · `neu in X.Y`
(update note with an open action or unread information) · `Braucht den Admin` (user item
blocked by an admin item) · `bereit` (collapsed) · `nutze ich nicht` (user opted out of an
optional item; per item and revision). Items clear from state, never from a click.

## 4. Surfaces

1. **The page** under Settings (Mein Konto area, plus a Server section for admins). Summary
   chips first, then groups in the order muss → neu → empfohlen → Braucht den Admin → bereit.
   Each item: title, consequence in one sentence, evidence time where relevant, one action.
2. **After an update or a newly failing required check**: at most one small invitation card
   (not a modal) with "Jetzt ansehen" and "Morgen erinnern". It never carries a question or
   consent. Sequenced after the WhatsNewModal and the telemetry consent step have settled;
   never more than one of these surfaces at a time.
3. **Admin banner (owner decision)**: a `required` admin item that needs action shows a thin
   banner at the top for admins until it is resolved. Not for ordinary accounts, not for
   `recommended`.
4. **First run (owner decision)**: the guided path follows today's `SetupPage.tsx` (admin
   account, domain picker, free services stay as they are) and then opens the page with the
   first-run items. Returning users never repeat admin creation.

## 5. Developer contract (the part that fights forgetting)

- A shared feature registry key list: every feature that has settings or prerequisites names
  either `checks: [ids]` or `noChecksReason`. Removals and behaviour changes that affect
  existing installs need an update note or `noUpgradeImpact: "<reason>"`.
- A test fails when: an id is duplicated; an i18n key misses DE or EN; an `action` does not
  resolve through `resolveAddress`; a check lacks an evaluator; a version in `CHANGELOG.md`
  under `[Unreleased]` carries an "Upgrading to …" paragraph without a matching note — or the
  other way round (the builder picks the direction that can be machine-checked; the goal is
  that both cannot drift).
- Pattern to follow: `frontend/src/config/betaFeatures.ts` (each entry has a reason) and
  `backend/src/services/sharing/shareTypes.ts` (exhaustive mapping + test).
- Add the rule to the CLAUDE.md "Enforced" table once the test exists.

## 6. First checks (scope of the first build)

Admin: SMTP configured and last test succeeded · public URL valid and last external
reachability test ok · scheduled backup recent and not failing, disk space · off-site copy
(WebDAV) configured (recommended) · flight/map providers with valid keys where enabled ·
booking-mail mailbox healthy where the feature is on.

Every account: domains chosen · Home set when TravTrack is in use · phone paired AND first
position received (two different states) · own API keys valid where any are stored ·
forwarding address and first allowed sender where booking mail is on · notification email
when reminders are on.

First update notes: the 2.8.0 notes already written in `CHANGELOG.md` (settings removed,
backups always on, retention prunes only scheduled archives, friends merged, external-service
settings moved out of the environment, own Immich/Dawarich must be public).

## 7. Stages

1. Server registry + evaluation endpoint + the page + update notes + contract test.
2. Invitation card and admin banner.
3. Companion: the same endpoint shown in the app (owner decision: yes, second stage). Contract
   goes into this document when stage 1's endpoint is fixed.

## 8. Constraints

- Additive API only; ADR 0001 response family to be declared for the new router.
- Every new endpoint in the OpenAPI spec with a response schema (ratchets).
- DE and EN copy together (parity test). The web build is drawn for iPads.
- Evaluation must be cheap: no external calls per request; the page may be opened often.
- Demo account: read-only, shows its own items, actions disabled as elsewhere.

## 9. Decisions from the builder check (coordinator's calls, 2026-11-14)

- **Existing installs and accounts.** Every existing account starts at last-acknowledged
  version `2.7.0` (the last final release); the instance's history starts at the running
  version. Notes are filtered by `appliesWhen`, so a 2.8.0 note reaches only the installs and
  accounts it concerns (e.g. "backups always on" only where backups were off). New accounts
  start at the running version (§3.2).
- **Probe results.** No new scheduled job in stage 1. Where an existing user-triggered test
  exists (SMTP test, external services, mailbox test), its outcome and time are persisted and
  the check reads them. A check with no stored result shows `unknown` — "noch nicht geprüft"
  with the test action. The booking-mail source already stores `lastOkAt`/`lastErrorAt`.
- **`unknown` never raises the banner** and is not shown as `muss`; it appears in its group
  marked "ungeprüft". Only a verified `needsAction` on a `required` admin check raises the
  banner. A stale result (older than the check's own `maxAge`) reads as `unknown`.
- **Notes whose action is only an address** are informational: acknowledged by the account,
  with the address as a link. A note that must stay until something is done references a check
  id; if no check exists yet, the builder adds one.
- **Snooze and "nutze ich nicht"** are stored per account and per item revision; admin items
  are per admin, not per instance.
- **CHANGELOG contract.** Stage 1 does not machine-check the CHANGELOG. The notes registry is
  the source; the contract test checks the registry itself (ids, DE/EN keys, actions,
  evaluators, every note has `action` or `noAction`). Generating the "Upgrading to …" paragraphs
  from it is a later step.
- **Severity per first check (owner, 2026-11-14: "ja mach erstmal"):** `required` (raises the
  admin banner on a verified failure): scheduled backup failing or older than 2 days; disk
  nearly full; public URL invalid or last external reachability test failed. `recommended`
  (no banner): SMTP, off-site copy, provider keys, booking-mail mailbox. `unknown` never
  raises the banner. Every account item is `recommended` in stage 1.

## 10. Left to the builder

File and module names, the exact endpoint shape, how upgrade history is stored (a table or an
admin_settings field), the visual layout within the existing settings design system, and how
snoozes are stored.

## 11. Stage 1 contract (coordinator, 2026-11-14)

Router `routes/readiness.ts`, mounted at `/api/v1/readiness`, authenticated, **bare** response
family (ADR 0001, like settings). All fields below are always present; `null` where stated.

`GET /api/v1/readiness` → 200
```
{
  runningVersion: string,                    // backend/VERSION
  summary: { required: number, recommended: number, unknown: number,
             newNotes: number, blockedByAdmin: number, ready: number },
  items: Array<{
    id: string, revision: number,
    scope: "admin" | "user",                 // admin items only reach admins
    severity: "required" | "recommended",
    status: "ready" | "needsAction" | "unknown",
    checkedAt: string | null,                // ISO; evidence time of the stored result
    titleKey: string, consequenceKey: string, // i18n keys, namespace "readiness"
    action: string | null,                   // settings address for resolveAddress; null for a
                                             // user item blocked by an admin item
    blockedBy: string | null,                // admin item id; for ordinary accounts no detail
    optOutAllowed: boolean,                  // false for every "required" item
    userState: null | { kind: "snoozed", until: string } | { kind: "optedOut" }
  }>,                                        // only items whose appliesWhen holds
  notes: Array<{
    id: string, version: string, audience: "admin" | "user",
    beforeKey: string, afterKey: string,
    action: null | { kind: "check", checkId: string } | { kind: "address", address: string },
    noActionReason: string | null,           // exactly one of action / noActionReason is non-null
    acknowledged: boolean,
    open: boolean                            // check-backed: until the check is ready;
                                             // otherwise until acknowledged
  }>                                         // versions in (account's ackVersion, runningVersion]
}
```

Writes (each 204, 404 for an unknown or non-applicable id, 400 on a bad body):
- `POST /items/:id/snooze` `{ until?: string }` — default +1 day, at most +30 days.
- `POST /items/:id/opt-out` — 409 when `optOutAllowed` is false.
- `DELETE /items/:id/state` — clears snooze / opt-out.
- `POST /notes/:id/ack` — acknowledges one note; a check-backed note stays `open` regardless.

States are stored per account, per item id and revision; a raised revision ignores old rows.
Demo account: GET works, writes 403 like other demo writes.

Persistence (builder picks names): an item-state table (account, item id, revision, kind,
until); the account's last acknowledged version (existing accounts `2.7.0`, new accounts the
running version at creation, as `whatsNewStamp.ts` does); the instance's upgrade history;
stored outcome + time of the SMTP test and the external reachability test where none is
stored today.

Ownership: the backend owns ids, revisions, evaluation and the catalogue; the frontend owns the
DE/EN copy under the `readiness` namespace. The contract test covers both sides: every key the
catalogue names exists in DE and EN, every `action` and note address resolves through
`resolveAddress`.

## 12. Stage 2 contract (coordinator, 2026-11-15)

Additive to §11. Two packages: **S2a** server (reachability producer, invitation state) and
**S2b** web (invitation card, admin banner, check button).

`GET /api/v1/readiness` gains two always-present fields:
```
invitation: {
  show: boolean,                  // false while snoozed or nothing new
  reason: "update" | "required" | null,   // "update" wins when both apply
  snoozedUntil: string | null     // ISO
},
banner: {
  show: boolean,                  // admins only; always false for other accounts
  itemIds: string[]               // required admin items with status "needsAction"
}
```
- *Invitation keys* = ids of open notes + ids of `required` items with `needsAction` that the
  viewer sees and has not snoozed. `show` is true when a key exists that is not in the
  account's seen set and the account is not snoozed. `unknown` is never a key.
- `banner` ignores snoozes ("until it is resolved", §4.3); `unknown` never raises it (§9).

Writes (204; demo 403 like other demo writes):
- `POST /readiness/invitation/seen`: stores the current invitation keys as seen. The web
  calls it when the page is opened, so a visit ends the card for what was shown.
- `POST /readiness/invitation/snooze`: "Morgen erinnern", +1 day.

Persistence: two columns on `users` (seen keys as text[], snoozed-until timestamp).

Reachability producer (admin.publicUrl):
- `POST /api/v1/admin/public-url/check` (admin; cookie or admin-scope token; rate limited) →
  200 `{ ok: boolean, checkedAt: string, url: string | null, httpStatus: number | null,
  errorCode: null | "NO_PUBLIC_URL" | "OUTBOUND_DISABLED" | "TIMEOUT" | "DNS" | "TLS" |
  "CONNECTION" | "HTTP_STATUS" | "NOT_THIS_INSTANCE" }`.
- Probe: `GET <publicUrl>/health`, 10 s timeout, redirects not followed. It is ok only when
  the answer is 2xx, has `status: "ok"`, and the instance identifies itself as this one: the
  check sends a one-time nonce, and `/health` echoes it only when it holds it. A mere version
  match is not enough, because prod and the RC can run the same version.
- `NO_PUBLIC_URL` and `OUTBOUND_DISABLED` store no result, so the item stays `unknown`. Every
  other outcome stores `publicUrlCheckedAt`, `publicUrlCheckOk` and `publicUrlCheckedUrl`.
- A daily scheduled run (once, off the hour, UTC) runs the same probe when a public URL is
  set and outbound traffic is allowed. Never on login or on `GET /readiness`.
- The evaluator reads the stored result as today. A stored URL that differs from the current
  public URL reads as `unknown`.

Web (S2b):
- **Invitation card**, not a modal, in the app shell. It shows when `invitation.show`, but
  only after the WhatsNewModal and the telemetry consent step have settled, and never at the
  same time as either. Buttons: "Jetzt ansehen" (→ `/settings/einrichtung`) and "Morgen
  erinnern" (snooze). Copy by `reason`. No question, no consent.
- **Admin banner**: a thin bar above the content while `banner.show`. It names the count and
  links to the page, and it has no close button.
- The page calls `invitation/seen` once per open.
- On the public-URL setting row, the admin gets a button "Erreichbarkeit prüfen". It shows the
  result, with DE/EN copy per `errorCode`.
- Refresh `GET /readiness` on login, on focus (at most every 10 min) and after any readiness
  write. No polling loop.
