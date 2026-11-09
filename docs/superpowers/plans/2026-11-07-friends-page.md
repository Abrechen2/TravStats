# Friends Page and Server Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Freunde page that compares you and up to three friends side by side (stats and achievements), and a server-to-server connection set up by invitation link plus one admin approval per server.

**Architecture:** Extends the 2026-10-16 comparison stack (`services/comparison/**`, `/api/v1/comparison`, `/api/v1/comparison-peer`). A peer protocol version 2 carries the mutual-consent assertion and an optional achievements section; v1 stays served unchanged. Server admission is a new table plus one unauthenticated-by-pin bootstrap route that only a valid invitation token opens.

**Tech Stack:** Express + Prisma 7 (Postgres), Zod, Jest/supertest; React + Vite, Zustand, react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-07-friends-page-design.md` (owner-approved 2026-11-07). Read it before your package; section numbers below (§) refer to it.

## Global Constraints

- Prisma: schema changes only via `npx prisma migrate dev` in a throwaway clone (memory: the shared dev DB takes `migrate deploy` only); `npm run check:drift` stays green. Import `Prisma` from `backend/src/prisma.ts`.
- Every new endpoint: in OpenAPI with a JSON response schema (`openapi.coverage.test.ts`, `openapi.responseSchema.test.ts`); a new router file is assigned a response family in `apiResponseShape.baseline.json` — comparison/federation are **bare** (ADR 0001).
- Errors: named codes added to `ApiErrorCode` (`COMPARISON_*`, new `FEDERATION_ADMISSION_*`), mapped to DE+EN copy on the frontend; never raw English prose in the UI.
- Limiters from `middleware/rateLimit.ts` with `userOrIpKey` (IPv6 /56), never a raw `req.ip` key.
- Frontend: DE first, EN mirrored in the same commit (`localeKeyParity.test.ts`); `useTranslation` from `../hooks/useTranslation`; touch sizes via `useCoarsePointer`; iPad first.
- Time: no host-local `Date` getters (`time/*` lint rules).
- The leaderboard never imports anything under `components/encryptedShare/` (`separation.test.ts`).
- Totals only across servers: no record id, date, place or cost in any peer payload (rework spec G3); achievements carry no `unlockedAt`.
- No file over 800 lines (`check:size`); `consents.ts` is at 450, `remote.ts` at 357 — add new modules rather than growing them past 800.
- Beta key `comparison` keeps gating the page; do not touch `betaFeatures.ts` entries.
- Each package: own worktree + DB via `.claude/workers/worker-env.sh up <slug> forgejo/feat/friends-compare`; one Codex review at the end (P1/P2 follow-ups only); report ≤ 15 lines.

## Review Focus

1. **A v1-only peer** (older TravStats) — stats keep comparing, achievements read "nicht verfügbar", nothing 500s. Test in Task 2.3.
2. **The same invitation redeemed twice / concurrently** — one claim, the second gets a named refusal. Test in Task 3.4.
3. **Peer key changed between invite and redeem** (admin regenerated the key) — refused as `FEDERATION_ADMISSION_KEY_MISMATCH`, never silently re-pinned. Test in Task 3.3.
4. **A friend who withdrew** while the page is open — their column reads "teilt nicht mehr", the difference column is empty, not 0. Test in Task 4.3.
5. **Malformed or oversized `#payload`** (truncated paste, foreign link) — the accept page says the link is damaged and sends nothing. Test in Task 4.4.

---

## Package A (P1): mutual consent and remote consent state — one worker

### Task 1.1: Protocol version 2 negotiation and the mutual assertion

**Files:**
- Modify: `backend/src/schemas/comparison.ts` (`SERVED_VERSIONS`, `aggregateRequestSchema`)
- Modify: `backend/src/services/comparison/remote.ts:107-166` (`pullRemote`)
- Modify: `backend/src/services/comparison/peerActions.ts:34-71` (`serveAggregate`)
- Modify: `frontend/src/shared/comparisonMetrics.ts` only if the mirror test requires it
- Test: `backend/src/services/comparison/__tests__/mutualConsent.test.ts`

**Interfaces:**
- Produces: `SERVED_VERSIONS = [1, 2] as const`; `aggregateRequestV2Schema` = v1 fields + `viewerShares: z.boolean()`; `aggregateRequestSchema` becomes `z.union([v1, v2])` discriminated by presence of `viewerShares` and checked against `accept`. `pullRemote` sends v2 (with `viewerShares` = the local user's own consent to that remote is `accepted`) only when `ComparisonPeer.leaderboardVersions` includes 2, else today's v1 body byte for byte.
- Produces: `serveAggregate` — v2 request with `viewerShares: false` → `{ status: "notShared" }`; v1 request → today's behaviour (an old server cannot assert; recorded in the spec as the legacy path).

- [ ] **Step 1: Write the failing tests** — `"a v2 request whose viewer does not share gets notShared"`, `"a v2 request whose viewer shares gets the snapshot"`, `"a v1 request is served as before"`, `"pullRemote sends a v1 body to a peer that only speaks v1"` (assert the serialised body has no `viewerShares` key).
- [ ] **Step 2: Run, verify FAIL** — `cd backend && npx jest src/services/comparison/__tests__/mutualConsent.test.ts --forceExit` → fails on the missing field/branch.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run, verify PASS**, plus `npx jest src/services/comparison src/services/federation --forceExit`.
- [ ] **Step 5: Commit** `feat(comparison): peer protocol v2 asserts whether the viewer shares (forgejo#416)`

### Task 1.2: Local mutual rule (retroactive)

**Files:**
- Modify: `backend/src/services/comparison/leaderboard.ts` (`readLeaderboard`, local rows)
- Modify: `backend/src/services/comparison/consents.ts` (`listPeople` request view)
- Test: `backend/src/services/comparison/__tests__/mutualConsent.local.test.ts`

**Interfaces:**
- Produces: a local friend's figures appear for viewer V only if owner→V AND V→owner consents are both `accepted`. A one-sided accepted pair lists the missing side under `requests` for the user who has not answered (spec §9.1).

- [ ] **Step 1: Failing tests** — `"one-sided accepted consent shows no figures"`, `"the side that has not answered sees it as a request"`, `"both accepted shows figures"`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, verify PASS** (whole `src/services/comparison` + `src/routes/__tests__/comparison*`).
- [ ] **Step 5: Commit** `fix(comparison): a friend's figures flow only when both have agreed (forgejo#416)`

### Task 1.3: Claim no longer shares before the inviter answers

**Files:**
- Modify: `backend/src/services/comparison/remote.ts:240-290` (`recordClaim`)
- Modify: `backend/src/services/comparison/peerActions.ts` (`serveClaim` consent row)
- Test: extend `mutualConsent.test.ts`

**Interfaces:**
- Produces: the claimant's consent is still stored `accepted` with its scope (the claimant agreed), but it is only SERVED via Task 1.1's rule, i.e. after the inviter's server asserts `viewerShares: true`. No schema change.

- [ ] **Step 1: Failing test** — `"B redeems, A has not answered: A's aggregate request for B gets notShared"` (spec §6.1.1 test, verbatim).
- [ ] **Step 2–4:** run FAIL → implement → PASS.
- [ ] **Step 5: Commit** `fix(comparison): redeeming an invitation shares nothing until the inviter accepts (forgejo#416)`

### Task 1.4: Remote consent state reaches the people view

**Files:**
- Migration: `LeaderboardRemote` gains `theirStatus String? @map("their_status")` (values `ok|notShared|withdrawn|yearNotShared|unsupportedVersion|unreachable`) and `theirStatusAt DateTime? @map("their_status_at")`
- Modify: `backend/src/services/comparison/remote.ts` (`pullRemote` writes both after every answer or failure)
- Modify: `backend/src/schemas/comparison.ts:156-168` (`personViewSchema.theirs` → `z.strictObject({ status: z.enum([...consentStatus, "unknown"]), at: z.string().datetime().nullable() }).nullable()` — for remote people never null any more)
- Modify: `backend/src/services/comparison/consents.ts` (`personView`, `listPeople`)
- Modify: `frontend/src/components/comparison/PeopleSection.tsx:60-80` (render the state; `unknown` → `comparison:people.theirs.unknown` = DE "noch keine Antwort" / EN "no answer yet")
- Test: `backend/src/services/comparison/__tests__/remoteTheirStatus.test.ts`, `frontend/src/components/comparison/__tests__/PeopleSection.test.tsx`

- [ ] **Step 1: Failing tests** — backend `"a remote person's theirs status follows the last aggregate answer"`, `"before any answer it is unknown"`; frontend `"a remote friend with no answer reads 'noch keine Antwort', never '—'"`.
- [ ] **Step 2–4:** FAIL → implement (migration via throwaway clone) → PASS; `npm run check:drift` green.
- [ ] **Step 5: Commit** `fix(comparison): show what a friend on another server shares with you (forgejo#416)`

---

## Package B (P2): achievements in snapshot v2 — one worker, parallel to C

### Task 2.1: Comparable flag and catalogue version

**Files:**
- Modify: `backend/src/data/achievements.ts` (definition type gains `comparable: boolean`; default rule: false for any achievement whose requirement names a specific place, country, airport, ship, route or record; true otherwise)
- Create: `backend/src/services/comparison/achievementCatalogue.ts`
- Test: `backend/src/services/comparison/__tests__/achievementCatalogue.test.ts`

**Interfaces:**
- Produces: `comparableAchievements(): readonly AchievementDefinition[]`; `catalogueVersion(): string` = sha256 hex (first 16 chars) over the sorted `code:requirement:tier` lines of the comparable set.

- [ ] **Step 1: Failing tests** — `"catalogueVersion is stable across calls and changes when a requirement changes"`, `"no comparable achievement names a place"` (scan codes/descriptions against the place-specific list you defined, and assert the list is non-empty).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(comparison): mark which achievements may be compared (forgejo#416)`

### Task 2.2: Achievements consent group and snapshot builder

**Files:**
- Modify: `backend/src/shared/comparisonMetrics.ts` + `frontend/src/shared/comparisonMetrics.ts` (`METRIC_GROUPS` gains `"achievements"`; mirror test stays green)
- Create: `backend/src/services/comparison/achievementSection.ts`
- Modify: `backend/src/schemas/comparison.ts` (`leaderboardSnapshotV2Schema` = v1 + optional `achievements: z.strictObject({ catalogue: z.string().regex(/^[a-f0-9]{16}$/), items: z.array(z.strictObject({ code: z.string().regex(/^[A-Z0-9_]{1,64}$/), unlocked: z.boolean(), progress: z.number().min(0).max(1).nullable() })).max(400) })`)
- Modify: `backend/src/services/comparison/aggregates.ts` (`buildLeaderboardSnapshot(userId, scope, year, version: 1 | 2)`)
- Test: `backend/src/services/comparison/__tests__/achievementSection.test.ts`

**Interfaces:**
- Produces: `buildAchievementSection(userId: string, scope: LeaderboardScope): Promise<AchievementSection | undefined>` — undefined unless `scope.groups` has `"achievements"` and `scope.year === null`; held-ness via `isAchievementHeld`, visibility via `loadAchievementVisibility`; an item whose domains are not all in `scope.domains` is omitted.
- Existing grants keep their stored `groups` (no `"achievements"`) — default off, no data migration.

- [ ] **Step 1: Failing tests** — `"no section without the achievements group"`, `"no section for a year scope"`, `"a badge of an unshared domain is omitted"`, `"no item carries a date"` (assert `JSON.stringify(section)` matches no ISO date), `"a v1 snapshot is byte-identical to before"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(comparison): achievements travel in snapshot v2, lifetime only (forgejo#416)`

### Task 2.3: Serve and read v2; degrade for v1

**Files:**
- Modify: `peerActions.ts` (`serveAggregate` picks the highest version in `accept` ∩ `SERVED_VERSIONS`), `remote.ts` (`pullRemote` parses the reply against the negotiated version), `leaderboard.ts` (rows carry `achievements` or `achievementsUnavailable: "olderServer" | "notShared" | "yearView"`)
- Modify: `backend/src/schemas/comparison.ts` (`leaderboardRowSchema` gains those two optional fields)
- Test: `backend/src/services/comparison/__tests__/snapshotV2.test.ts`

- [ ] **Step 1: Failing tests** — `"a v1-only peer still yields stats and achievementsUnavailable: olderServer"` (Review Focus 1), `"a v2 peer yields the section"`, `"a local friend gets the same section as a remote one would"`.
- [ ] **Step 2–4:** FAIL → implement → PASS; full `src/services/comparison` + `comparisonMetrics.mirror.test.ts`.
- [ ] **Step 5: Commit** `feat(comparison): negotiate snapshot v2 and fall back to v1 (forgejo#416)`

---

## Package C (P3): server admission and invitation links — one worker, parallel to B

### Task 3.1: Public identity endpoint

**Files:**
- Create: `backend/src/routes/federationIdentity.ts`, mount `{ id: "federation-identity", base: "/api/v1/federation" }` in `routes/mounts.ts`
- OpenAPI: `backend/src/services/openapi/paths/federation.ts` (or the existing federation paths file)
- Test: `backend/src/routes/__tests__/federationIdentity.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/federation/identity` → `{ origin: string, publicKey: string /* base64url raw 32 bytes */, fingerprint: string, protocolVersions: number[] }`; 404 `FEDERATION_OFF` when `loadIdentity()` refuses. Unauthenticated, own limiter (60/min per IP key), `Cache-Control: no-store` (default).

- [ ] **Step 1: Failing tests** — `"answers 404 while federation is off"`, `"answers origin, key and fingerprint when on"`, `"the fingerprint matches identity.ts"`.
- [ ] **Step 2–4:** FAIL → implement → PASS (+ OpenAPI and response-shape ratchets).
- [ ] **Step 5: Commit** `feat(federation): publish the server identity for invitation links (forgejo#416)`

### Task 3.2: Admission table and admin API

**Files:**
- Migration: model `FederationAdmissionRequest` (`federation_admission_requests`): `id uuid`, `direction` (`outgoing|incoming`), `origin`, `publicKey`, `fingerprint`, `localUserId` (FK users, cascade), `inviteRef String` (encrypted with `encryptApiKey`), `status` (`pending|sent|approved|declined|failed|expired`), `failureReason String?`, `createdAt`, `decidedAt?`, `decidedBy?`; `@@index([status, direction])`, `@@unique([direction, origin, localUserId])`
- Create: `backend/src/services/federation/admission.ts`
- Modify: `backend/src/routes/admin/federation.ts` (two routes; extract the pin into `pinPeer(...)` in `services/federation/pinning.ts` and call it from both the manual pin and approve)
- Test: `backend/src/services/federation/__tests__/admission.test.ts`, `backend/src/routes/admin/__tests__/federationAdmissions.test.ts`

**Interfaces:**
- Produces: `listAdmissions(): Promise<AdmissionView[]>`; `approveAdmission(id, adminId)` → pins via `pinPeer({ origin, publicKey, fingerprint, enabled: true })`, sets `approved`/`sent`, logs `federation_admission_approved` with admin id, origin, fingerprint; `declineAdmission(id, adminId)`; `GET /api/v1/admin/federation/admissions`, `POST …/:id/approve`, `POST …/:id/decline`.
- Approving never replaces an existing different key and never re-enables a suspended peer (`FEDERATION_ADMISSION_KEY_MISMATCH`, `FEDERATION_ADMISSION_SUSPENDED`).

- [ ] **Step 1: Failing tests** — `"approve pins the peer and logs the admin"`, `"approve refuses a key that differs from an existing pin"`, `"approve refuses a suspended peer"`, `"non-admin gets 403"`.
- [ ] **Step 2–4:** FAIL → implement → PASS; drift green.
- [ ] **Step 5: Commit** `feat(federation): admin approves a new server with one click (forgejo#416)`

### Task 3.3: Invitation link create and redeem

**Files:**
- Create: `backend/src/services/comparison/inviteLinks.ts`, `backend/src/schemas/inviteLink.ts`
- Modify: `backend/src/routes/comparison.ts` (two routes)
- Test: `backend/src/services/comparison/__tests__/inviteLinks.test.ts`

**Interfaces:**
- Produces: `inviteLinkPayloadSchema` = `{ v: 1, kind: "travstats-friend-invite", origin, publicKey, fingerprint, token /* 32 random bytes base64url */, expiresAt }`, encoded base64url, ≤ 1024 chars. `createInviteLink(userId) → { url: \`${origin}/freunde/einladung#${payload}\`, expiresAt }` (reuses `LeaderboardInvite` rows: token stored hashed, 72 h, the same 20-open cap).
- Produces: `redeemInviteLink(userId, payload, scope) → { status: "claimed" | "awaitingAdmin" | "awaitingPeerAdmin" }` per spec §6.2 step 2 and §9: federation off → `FEDERATION_ADMISSION_DISABLED`; identity fetch through `exchange`'s egress-checked client must match the payload (`FEDERATION_ADMISSION_KEY_MISMATCH`); pinned with same key → existing `claimInvite`; suspended → `FEDERATION_ADMISSION_SUSPENDED`; else an `outgoing` request.
- Routes: `POST /api/v1/comparison/invite-links`, `POST /api/v1/comparison/invite-links/redeem` (body `{ payload, scope }`), `GET /api/v1/comparison/admissions` (the user's own outgoing requests).
- Caps (§6.2 Limits): 5 open outgoing requests per user, 20 per instance (`FEDERATION_ADMISSION_FULL`).
- Private origins (Codex 11): a user's redeem never makes this server fetch a private-range origin. If the payload's origin is private (allowed only under `FEDERATION_PRIVATE_PEERS`), the redeem skips the identity fetch and creates the outgoing request; the fetch and key match happen when the ADMIN approves (Task 3.2's approve calls the same check). Public origins are checked at redeem time as above.

- [ ] **Step 1: Failing tests** — `"redeem against a pinned peer claims at once"`, `"redeem against an unknown server creates an outgoing request"`, `"a changed key is refused"` (Review Focus 3), `"federation off is refused"`, `"an oversized payload is a 400"`, `"a sixth open request of one user is refused"`, `"a private origin is not fetched on redeem, only on approve"` (assert the transport mock is not called before approve).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(comparison): invitation links that carry the server's identity (forgejo#416)`

### Task 3.4: Bootstrap admission action and delivery job

**Files:**
- Create: `backend/src/routes/federationAdmission.ts` (mount `{ id: "federation-admission", base: "/api/v1/federation-admission" }`), `backend/src/services/federation/admissionDelivery.ts`
- Modify: `backend/src/services/federation/admission.ts` (approve of an `outgoing` request enqueues delivery)
- Test: `backend/src/services/federation/__tests__/admissionBootstrap.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/federation-admission` — envelope signed by the sender (`envelope`/`verifyEnvelope`), body `{ action: "admit", origin, token }`. Receiver: fetch sender's `/federation/identity` (egress-checked), verify the envelope with that key, require a valid unexpired unused invitation token, then: sender already pinned → run the claim; else create an `incoming` request. Otherwise 403, nothing stored. Limiter 10/min per IP key; global cap 20 open incoming (`FEDERATION_ADMISSION_FULL`); body ≤ 8 192 bytes.
- Produces: `deliverAdmission(requestId)` job: retries with backoff (1 min → 6 h, capped) until answered or 14 days; maps the answer to `sent`/`failed` (+ `failureReason`)/`expired`. A token attached to a pending request stays redeemable up to 14 days (§6.2 step 6); it is consumed atomically when the claim completes.
- When SA's admin approves an `incoming` request: pin, ping (sets `verifiedAt`, `leaderboardVersions`), then complete the claim so A sees B's request.

- [ ] **Step 1: Failing tests** — `"an unsigned or wrongly signed admit is 403 and stores nothing"`, `"an admit without a valid token is 403 and stores nothing"`, `"a valid admit creates one incoming request"`, `"the same token admitted twice concurrently yields one request"` (Review Focus 2, `Promise.all`), `"an unreachable peer is retried and expires after 14 days"` (fake timers).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(federation): a server asks to be admitted with its user's invitation (forgejo#416)`

---

## Package D (P4): Freunde page — one worker, after B and C have merged into the feature branch

### Task 4.1: Route, redirect, navigation, settings link

**Files:** `frontend/src/App.tsx:234` (`/freunde`, `/freunde/einladung`, `/freunde/annehmen`; `/compare` → `<Navigate to="/freunde" replace />`, keeping the `encryptedShare` redirect target pointed at `/freunde`), `components/Nav/useNavItems.ts:201`, `components/Settings/CompareHandoverRow.tsx:9`, `i18n/resources/{de,en}/comparison.json` + nav strings (DE "Freunde" / EN "Friends").
**Test:** `frontend/src/__tests__/routes/freundeRedirect.test.tsx` — `"/compare redirects to /freunde"`, `"the Mehr menu lists Freunde behind the comparison key"`.
- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(web): the friends comparison lives at /freunde (forgejo#416)`

### Task 4.2: API client and store

**Files:** `frontend/src/lib/api/comparison.ts` (add `createInviteLink`, `redeemInviteLink`, `listAdmissions`, `compare(friends: string[], year: number | "all")`; extend `KNOWN_COMPARISON_CODES` with the new codes), backend `GET /api/v1/comparison/compare?friends=&year=` in `routes/comparison.ts` + `services/comparison/compareView.ts` returning `{ self: LeaderboardRow, friends: LeaderboardRow[] }` (max 3 keys, `personKeySchema` each).
**Test:** `backend/src/routes/__tests__/comparisonCompare.test.ts` (`"returns self plus the requested friends only"`, `"refuses more than three"`), `frontend/src/lib/api/__tests__/comparison.test.ts`.
- [ ] Steps: failing tests → FAIL → implement → PASS → commit `feat(comparison): fetch exactly the friends being compared (forgejo#416)`

### Task 4.3: FriendsPage — requests, picker, comparison table, achievements

**Files:** Create `frontend/src/components/friends/{FriendsPage,RequestsSection,FriendPicker,CompareTable,AchievementsCompare,FriendDetailSheet,AddFriendDialog}.tsx` (each < 300 lines); delete `LeaderboardTile.tsx` and `LeaderboardPage.tsx` once nothing imports them; reuse `ConsentDialog.tsx`, `BoardsSection` logic as the picker's "Gruppe" filter.
**Behaviour (spec §6.5):** filters Zeitraum (Gesamt / year) and domains (display only; cross-domain rows marked "nicht neu berechnet"); per-domain table metric | Du | Freund(e) | Differenz, colours from `useDomainColors`, units via existing formatters; difference empty with "nicht vergleichbar" when either side is partial, null, or domain coverage differs; every unavailable value names its reason (`notShared`, `withdrawn`, `olderServer`, `yearView`, `partial`, unknown catalogue).
**Tests:** `frontend/src/components/friends/__tests__/CompareTable.test.tsx` — `"a withdrawn friend's column reads 'teilt nicht mehr' and the difference is empty, not 0"` (Review Focus 4), `"a partial value gets no difference"`, `"null renders its reason, never 0"`; `AchievementsCompare.test.tsx` — `"groups badges into ihr beide / nur du / nur <Name>"`, `"year view shows 'nur für die Gesamtzeit'"`, `"an unknown-catalogue code reads 'auf dem anderen Server unbekannt'"`.
- [ ] Steps: failing tests → FAIL → implement → PASS → browser look at 1366 and 820 → commit `feat(web): compare friends side by side, stats and achievements (forgejo#416)`

### Task 4.4: Invitation landing and accept pages

**Files:** Create `frontend/src/pages/FriendInvitePage.tsx` (`/freunde/einladung`, public, no API call; own-server field remembered in `localStorage` under `travstats.friends.homeServer`, wrapped in try/catch), `frontend/src/pages/FriendAcceptPage.tsx` (`/freunde/annehmen`, signed-in, `BetaFeatureRouteGuard feature="comparison"`; decodes with a frontend mirror of `inviteLinkPayloadSchema`; shows inviter origin + fingerprint; POST only on the button; `history.replaceState` drops the fragment afterwards; maps every redeem status and error code to its sentence).
**Tests:** `FriendAcceptPage.test.tsx` — `"a truncated payload says the link is damaged and calls no API"` (Review Focus 5), `"redeem is not called on load"`, `"awaitingAdmin reads 'Wartet auf die Freigabe deines Admins'"`, `"the fragment is cleared after redeeming"`; `FriendInvitePage.test.tsx` — `"navigates to <own server>/freunde/annehmen#<payload>"`, `"works with localStorage throwing"`.
- [ ] Steps: failing tests → FAIL → implement → PASS → commit `feat(web): open a friend's invitation on your own server (forgejo#416)`

---

## Package E (P5): admin page — one worker, parallel to D, after C

### Task 5.1: One switch, requests, connected servers

**Files:** Modify `frontend/src/components/Admin/FederationSetupChecklist.tsx` (shrinks to the switch), create `frontend/src/components/Admin/{FederationAdmissionCards,FederationPeerList}.tsx`; move `FederationConnectionFile`/`FederationPeerForm` under a collapsed "Erweitert"; backend: `PUT /api/v1/admin/federation` switching on with no key generates one (same code path as `POST /key`, logged), origin pre-filled from `admin_settings.public_url` when empty.
**Tests:** backend `federation.switchOn.test.ts` — `"switching on without a key generates one"`, `"an existing key is kept"`; frontend `FederationAdmissionCards.test.tsx` — `"a card shows origin, fingerprint and who asked"`, `"approve calls the API and the card leaves"`, `"the card states that trip-share requests become possible when that switch is on"`.
- [ ] Steps: failing tests → FAIL → implement → PASS → browser look → commit `feat(admin): federation is one switch plus a queue of server requests (forgejo#416)`

---

## Integration (coordinator)

- [ ] After each package: verify the worker's green with one command on its head (`npx jest <its suites> --forceExit` / `npx vitest --run <its dir>`), merge into `feat/friends-compare`, push to forgejo.
- [ ] After all five: two-instance end-to-end on the dev DB (two backend ports, two `*_test` DBs, `FEDERATION_PRIVATE_PEERS` for localhost): link → accept → both admins approve → A accepts → page shows both columns and achievements; then the full Build Checks list once; update the spec's phase table and `fj-416` in `roadmap.local.yaml`. The merge to `main` is the owner's decision.
