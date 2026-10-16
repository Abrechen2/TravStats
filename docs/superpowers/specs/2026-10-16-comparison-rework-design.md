# Comparison rework — leaderboard from aggregates, encrypted share set apart

Date: 2026-10-16 · Tracks `dennis/TravStats` forgejo#40 · Status: design, approved direction (owner
decisions below), not implemented.
Code base: `main` after `fix/ct142-federation` (main 0400dc137 + the federation fixes up to
`b2cde5bcb`). Every file and function named here was read in that tree.

## 1. Why

The feature behind `/compare` fused two products into one surface:

1. **A leaderboard** — "who flew further this year". It needs nine domains' worth of totals
   per person and nothing else. `services/federation/snapshots.ts` and `domainMetrics.ts`
   already build those totals from the same loaders `/stats` uses (`computeSummary`,
   `loadCruiseStatsData`, `loadLodgingStatsData`, `loadRailStats`, `loadBusStats`,
   `rentalStatsFor`, `loadPassport`, `loadDaysAway`). That part is sound.
2. **An end-to-end encrypted transfer of every travel record** — device keys in IndexedDB,
   recovery files and codes, three kinds of fingerprints (server, device, comparison code),
   grants of six categories × nine domains × trip selection × year × precision × expiry,
   publications chunked into Postgres (`comparison_publications`/`comparison_chunks`, up to
   1 GiB per owner), raw Prisma rows as the wire format (`e2e/fieldInventory.json`,
   `e2e/graph.ts`).

The leaderboard was implemented ON TOP of the second: `SealedWorkspace.refresh()`
(`frontend/src/components/comparison/SealedWorkspace.tsx:105-171`) decrypts every friend's full
publication (`readPublication`) only to read `opened.data.snapshot`, and refuses to show
anything until the viewer has created a device key. Measured on the code: a same-instance user
needs about 14 steps and 18 concepts (invite, claim, comparison code, label, device key,
recovery file, recovery code, device fingerprint verification, grant categories, domains,
trips, year, precision, expiry, preview, consent tick, publish, refresh) before one number
appears in the table. Two people on the same server, whose numbers the server already holds,
still need device keys.

## 2. Owner decisions (2026-10-16, verbatim)

- The leaderboard is rebuilt as aggregates only. Across servers, the aggregate numbers travel
  WITHOUT end-to-end encryption over the existing signed (Ed25519) server-to-server peer link;
  this explicitly lifts the rule "no unencrypted fallback" for leaderboard aggregates only.
  Full records never travel unencrypted.
- The full-record E2E transfer is separated from the comparison page, kept behind its OWN beta
  key (e.g. `encryptedShare`), not deleted, until the owner decides to keep or cut it.

## 3. Goals

- G1. Two users on one instance compare in three steps: A enters B's username and confirms
  one dialog ("B sieht diese Zahlen"); B confirms the same dialog the other way. No keys.
- G2. Across instances: A creates an invitation code, B redeems it on their own server and
  confirms the dialog, A confirms the dialog. The admins have pinned each other's server key
  once, in **Admin → Instanz**, with a key generated in the UI.
- G3. What crosses a server boundary is one small, versioned, Zod-validated snapshot of
  totals (`leaderboardSnapshotSchema` v1 in `backend/src/schemas/comparison.ts`). Never a
  record, a trip name, a place, a date, a cost.
- G4. The page reads like `/stats`: one tile per metric with the people ranked under it, the
  domain colour from `useDomainColors`, distances in the reader's unit, durations through
  `formatDuration`, dates through `useDisplayFormat`.
- G5. Ferry, tours and places join the metric set (they were missing).
- G6. The code meets the house conventions it skipped: Zod in `src/schemas`, limiters from
  `middleware/rateLimit.ts` (`userOrIpKey`, `patAwareMax`), a logged, named error code on
  every refusal (`COMPARISON_*` in `ApiErrorCode`) instead of one `refused()` 403, OpenAPI
  coverage with response schemas for the cookie API.
- G7. The E2E transfer keeps working, unchanged in behaviour, at `/encrypted-share` behind the
  new beta key `encryptedShare`; the comparison page no longer imports anything from it.

## 4. Non-goals

- No costs on the leaderboard. Totals in different base currencies cannot be ranked, and a
  spend total is the most sensitive figure the old snapshot carried. (Old `metrics.cost` is
  gone from the new schema.)
- No "rounded" precision option and no trip selection. The consent scope is metric groups,
  domains and period — that is the whole dial. A person who wants less shares fewer groups.
- No caching of remote numbers. A remote friend whose server does not answer shows a status,
  not yesterday's figure (the old rule "an offline host reveals no stale data" stands).
- No notifications/inbox entry for incoming comparison requests in this rework; the page
  shows them at the top. (Candidate for a follow-up, not a silent gap.)
- No change to the E2E protocol, crypto, grant model or its UI beyond moving it.
- No release decision. Un-gating `comparison` stays the owner's call (see §12).

## 5. Verified design review conclusions (and two corrections)

| Review claim | Verified? | Consequence |
|---|---|---|
| snapshots/domainMetrics reuse the stats loaders | Yes (`snapshots.ts:56-148`, `domainMetrics.ts`) | New builder reuses the same loaders; E2E keeps its own copy |
| Leaderboard depends on full decrypt | Yes (`SealedWorkspace.tsx:105-171`) | Leaderboard reads server-built aggregates |
| `/boards` and `/audit` unused | Yes — no frontend caller (grep `"/boards"`, `"/audit"` in `frontend/src`: none) | Delete endpoints and `ComparisonGroup`; `ComparisonAudit` stays (E2E writes it) |
| Reuse `ShareConsent` for "X may see my numbers" | **Corrected.** A `ShareConsent(requester, target, accepted)` row means "requester may push trips INTO target" (`services/sharing/consent.ts:7-12`), and withdrawing it detaches the target's trip copies (`detachAfterWithdrawal`). Reusing the row would let accepting a comparison request also authorise trip pushes, and ending a comparison would detach trips. | Reuse the **people model** (`SharePerson`, `PERSON_SELECT`, `toPerson` from `services/sharing/people.ts`) and the **state machine** (pending/accepted/declined/withdrawn, re-ask after decline) — in a table of its own, `LeaderboardConsent`. |
| Replace `ComparisonCircle` | **Corrected.** Circles are the E2E group audience (`e2e/relay.ts` `groupDevices`/`groupRead`); E2E must keep working. | `ComparisonCircle` stays with E2E. Leaderboard groups are new `LeaderboardBoard`s: a named set of people whose consent the owner already holds. |
| FEDERATION_* env only | Yes (`security.ts:24-37`) | Admin settings, env as override |

## 6. Architecture

```
                    ┌──────────── cookie API /api/v1/comparison (enveloped, documented) ───────────┐
browser /compare ──▶│ routes/comparison.ts → services/comparison/{consents,leaderboard,boards,     │
                    │                         invites,aggregates,domainAggregates,remote}.ts       │
                    └──────────────────────────────────────────────────────────────────────────────┘
                                      │ same instance: read owner's totals under consent (server-side)
                                      │ other instance: signed pull ↓
             /api/v1/comparison-peer (routes/comparisonPeer.ts, one signed endpoint, two protocols)
               ├─ leaderboard actions: aggregate, lb-claim, lb-state   (services/comparison/peerActions.ts)
               └─ E2E actions: claim, state, sealed, circle            (unchanged)
             transport: services/federation/security.ts (Ed25519 envelopes, DNS pinning, nonces)
             identity:  services/federation/identity.ts (admin_settings, env override)

browser /encrypted-share ──▶ /api/v1/encrypted-share (routes/encryptedShare.ts + encryptedShareSealed.ts,
                              enveloped, undocumented: beta protocol under review) → services/federation/**
admin console Instanz ──▶ /api/v1/admin/federation (routes/admin/federation.ts, bare, admin mount)
```

Ownership after the rework:

| Path | Owner |
|---|---|
| `services/federation/security.ts`, `identity.ts`, `contract.ts` (`packetBody`, `origin`, `id`) | shared transport |
| `services/federation/{links,circles,permissions,records,snapshots,domainMetrics,restore}.ts`, `e2e/**` | E2E (frozen) |
| `services/comparison/**`, `schemas/comparison.ts`, `shared/comparisonMetrics.ts` | leaderboard |

E2E keeps `snapshots.ts`/`domainMetrics.ts` because its package embeds the old v1 snapshot
(`e2e/source.ts:collectComparison` → `buildSnapshot`) and its consent preview calls `/preview`.
Duplicating ~100 lines of loader calls is the price of the leaderboard not importing anything
the owner may cut.

## 7. Data model and migrations

### 7.1 New tables (migration `*_leaderboard_tables`)

```prisma
/// One direction: the owner's totals may be seen by ONE viewer — a local account or a remote
/// friend. pending | accepted | declined | withdrawn. Comparison rework 2026-10-16.
model LeaderboardConsent {
  id        String    @id @default(uuid())
  ownerId   String    @map("owner_id")
  viewerId  String?   @map("viewer_id")
  remoteId  String?   @map("remote_id")
  status    String    @default("pending")
  /// LeaderboardScope (schemas/comparison.ts); null until accepted.
  scope     Json?
  createdAt DateTime  @default(now()) @map("created_at")
  decidedAt DateTime? @map("decided_at")
  owner   User   @relation("LeaderboardConsentOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  viewer  User?  @relation("LeaderboardConsentViewer", fields: [viewerId], references: [id], onDelete: Cascade)
  remote  LeaderboardRemote? @relation(fields: [remoteId], references: [id], onDelete: Cascade)
  boardMembers LeaderboardBoardMember[]
  @@unique([ownerId, viewerId])
  @@unique([ownerId, remoteId])
  @@index([viewerId, status])
  @@map("leaderboard_consents")
}

/// A person on another instance, as one local user knows them. Both servers hold one row
/// with the same random channel.
model LeaderboardRemote {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  origin      String
  channel     String
  username    String
  displayName String   @map("display_name")
  createdAt   DateTime @default(now()) @map("created_at")
  user     User @relation(fields: [userId], references: [id], onDelete: Cascade)
  consents LeaderboardConsent[]
  boardMembers LeaderboardBoardMember[]
  @@unique([origin, channel])
  @@index([userId])
  @@map("leaderboard_remotes")
}

model LeaderboardInvite {
  hash      String    @id
  userId    String    @map("user_id")
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("leaderboard_invites")
}

model LeaderboardBoard {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  user    User @relation(fields: [userId], references: [id], onDelete: Cascade)
  members LeaderboardBoardMember[]
  @@index([userId])
  @@map("leaderboard_boards")
}

/// A board member is a person the board owner can SEE: a local consent where the owner is the
/// viewer, or one of the owner's remote friends.
model LeaderboardBoardMember {
  id        String  @id @default(uuid())
  boardId   String  @map("board_id")
  consentId String? @map("consent_id")
  remoteId  String? @map("remote_id")
  board   LeaderboardBoard    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  consent LeaderboardConsent? @relation(fields: [consentId], references: [id], onDelete: Cascade)
  remote  LeaderboardRemote?  @relation(fields: [remoteId], references: [id], onDelete: Cascade)
  @@unique([boardId, consentId])
  @@unique([boardId, remoteId])
  @@map("leaderboard_board_members")
}
```

Hand-added to the generated SQL (Prisma cannot express them; `check:drift` does not see CHECK
constraints): `CHECK (("viewer_id" IS NULL) <> ("remote_id" IS NULL))` and
`CHECK ("status" IN ('pending','accepted','declined','withdrawn'))` on consents, and
`CHECK (("consent_id" IS NULL) <> ("remote_id" IS NULL))` on board members.

### 7.2 Changed tables

- `admin_settings`: `federation_enabled boolean default false`, `federation_origin text null`,
  `federation_private_key text null` (PKCS#8 PEM, encrypted with `encryptApiKey`, like the push
  secret). Migration `*_federation_admin_settings`.
- `comparison_peers`: `leaderboard_versions integer[] default '{}'` — the snapshot versions
  the peer said it serves (read from its ping; see §10).
- `comparison_groups`: **dropped** (migration `*_drop_comparison_groups`). It had no UI and no
  reader; its rows are deleted. Nobody can have seen them.

### 7.3 Existing data (prod runs this behind the beta switch)

The data copy runs inside `*_leaderboard_tables`, between the markers
`-- BEGIN LEADERBOARD DATA COPY` / `-- END LEADERBOARD DATA COPY`:

| Today | After | What the user sees |
|---|---|---|
| Local friendship (two `comparison_links`, origin `local`, both confirmed, not revoked) where one side holds an active, unexpired direct grant (`audience ''`) with `statistics: true` | `LeaderboardConsent(owner = granter, viewer = friend, accepted, scope = {groups: all four, domains: grant domains, year: grant year})` | The friend appears on the granter's friend's leaderboard immediately. Costs, trips, precision and expiry of the old grant are not carried — the new scope has no such dials. |
| Local friendship without such a grant | nothing | Neither side appears; they ask again by username (one dialog). |
| Remote friendship (`origin` ≠ `local`) | nothing | Remote friends are missing from the leaderboard and need a new invitation code; their servers need the new version anyway (§10). |
| Group circles, group grants | nothing | Leaderboard groups start empty; boards are recreated in one dialog. |
| `comparison_groups` | dropped | — (never shown) |

**E2E data is untouched**: links, grants, devices, publications, circles keep working at
`/encrypted-share`. The migration logs how many consents it created (`RAISE NOTICE`).

### 7.4 Restore

`suspendComparisonAfterRestore` (`services/federation/restore.ts`) also resets every accepted
`LeaderboardConsent` to `pending` (the owner re-confirms in one dialog) and deletes every
`LeaderboardInvite`. A restored backup must never revive a consent withdrawn after it was
taken; "pending" asks the owner again instead of destroying the friendship.

### 7.5 Export

`EXPORT_EXCLUDED_USER_RELATIONS` (`services/export/allDataExport.ts`) loses `comparisonGroups`
and gains `leaderboardConsentsOwned`, `leaderboardConsentsViewed`, `leaderboardRemotes`,
`leaderboardInvites`, `leaderboardBoards` ("permissions and friendships, re-established after
restore").

## 8. Metrics

One catalogue, mirrored backend ↔ frontend (`shared/comparisonMetrics.ts`, "change both
together" header, like `shared/placeCounting.ts`):

| Group (`MetricGroup`) | Metric key | Domain | Unit | Source (existing loader) | Partial when |
|---|---|---|---|---|---|
| distance | flightKm | flight | km | `computeSummary().stats.totalDistance` | — |
| distance | cruiseKm | cruise | km | `calculateCruiseStats().totalDistanceKm` | — |
| distance | railKm | rail | km | `loadRailStats().distance.totalKm` | `unmeasuredJourneys > 0` |
| distance | busKm | bus | km | `loadBusStats().distance.totalKm` | `unmeasuredRides > 0` |
| distance | rentalKm | rental | km | `rentalStatsFor().km.total` | `km.covered < km.of` |
| distance | ferryKm | ferry | km | Σ `FerryJourney.distanceKm` of `countableFerryWhere()` rows in `ferryYear` | a counted crossing has no distance |
| distance | tourKm | roadtrip | km | Σ `TourFacts.km` of completed tours (`loadTourFacts`) | a completed tour has no km |
| trips | flights | flight | count | `totalFlights` | — |
| trips | cruises | cruise | count | `cruisesCount` | — |
| trips | stays | lodging | count | `staysCount` | — |
| trips | railRides | rail | count | `journeys` | — |
| trips | busRides | bus | count | `rides` | — |
| trips | rentals | rental | count | `rentals` | — |
| trips | ferryCrossings | ferry | count | counted crossings | — |
| trips | tours | roadtrip | count | completed tours | — |
| trips | placeVisits | poi | count | `countCompletedVisits` / `visitCountsForYear` | — |
| time | flightMinutes | flight | minutes | `totalFlightTime` | — |
| time | nights | lodging | nights | `totalNights` | — |
| time | rentalDays | rental | days | `days` | — |
| time | daysAway | — | days | `loadDaysAway().total` | — |
| places | countries | — | count | `loadPassport().summary.countries` (lifetime only) | — |
| places | cruisePorts | cruise | count | `cruisePortsUnique` | — |
| places | places | poi | count | `countVisitedPlaces` / places with a visit in the year | — |

Rules (all existing house rules, restated where they bind):

- **Absent ≠ null.** A metric outside the consent scope is absent from `metrics`; a metric in
  scope that cannot be derived is `null`; never 0 (CLAUDE.md "Abstention is a result").
- Cross-domain metrics (`domain: null`) are present whenever their group is shared, and carry a
  number only when the consent covers every domain the owner has visible (else `null`);
  `countries` is a number only for the lifetime view — the same restriction
  `snapshots.ts:85-92` applies today, for the same reason (the loaders have no domain mask).
- `partial` lists metrics that are a lower bound; the UI prints "≥".
- Ranking: like-for-like only. A value ranks when the row's status is `ok`, its snapshot's
  `year` equals the requested year, and the value is a number; `countries`/`daysAway` rank only
  between rows whose `domains` equal the viewer's own. Ties share a rank (1, 1, 3). Unranked rows
  sort after ranked ones by name.

## 9. API contract

### 9.1 Cookie API `/api/v1/comparison` — family **enveloped** (`{success: true, data}`), documented in OpenAPI

Gate: `authenticate`, `rejectDemo`; a PAT gets `403 COMPARISON_TOKEN_REFUSED`; the beta switch
off gets `403 COMPARISON_DISABLED`. Limiters: `comparisonReadLimiter` (60/min) on reads,
`comparisonWriteLimiter` (30/h) on requests, invitations and claims; both
`keyGenerator: userOrIpKey`, `max: patAwareMax(n)`.

| Method & path | Body / query | 200/201 `data` | Errors |
|---|---|---|---|
| `GET /leaderboard` | `?year=<1900-2200>|all&board=<uuid>` | `{year, rows: LeaderboardRow[]}` | `COMPARISON_BOARD_NOT_FOUND` 404 |
| `POST /preview` | `LeaderboardScope` | `LeaderboardSnapshot` (own, for the dialog) | 400 validation |
| `GET /people` | — | `{requests: RequestView[], people: PersonView[], boards: BoardView[]}` | — |
| `POST /requests` | `{username, scope}` | 201 `PersonView` | `COMPARISON_USER_NOT_FOUND` 404, `COMPARISON_SELF` 400, `COMPARISON_DUPLICATE` 409 |
| `POST /consents/{id}/accept` | `{scope}` | `PersonView` | `COMPARISON_NOT_FOUND` 404, `COMPARISON_NOT_PENDING` 409 |
| `POST /consents/{id}/decline` | — | `{declined: true}` | same |
| `PUT /consents/{id}` | `{scope}` | `PersonView` | `COMPARISON_NOT_FOUND` 404 |
| `DELETE /people/{key}` | — | `{ended: true}` | `COMPARISON_NOT_FOUND` 404 |
| `POST /invites` | — | 201 `{code, expiresAt}` | `COMPARISON_FEDERATION_OFF` 409, `COMPARISON_INVITE_LIMIT` 429 |
| `POST /invites/claim` | `{code, scope}` | 201 `PersonView` | `COMPARISON_INVITE_INVALID` 400, `COMPARISON_PEER_UNKNOWN` 403, `COMPARISON_PEER_UNREACHABLE` 502, `COMPARISON_PEER_OUTDATED` 409 |
| `POST /boards` | `{name, members: PersonKey[]}` | 201 `BoardView` | `COMPARISON_BOARD_MEMBER_INVALID` 400 |
| `PUT /boards/{id}` | same | `BoardView` | `COMPARISON_BOARD_NOT_FOUND` 404 |
| `DELETE /boards/{id}` | — | `{deleted: true}` | `COMPARISON_BOARD_NOT_FOUND` 404 |

Shapes (Zod in `schemas/comparison.ts`):

- `LeaderboardScope = {groups: MetricGroup[1..4], domains: DomainKey[1..9], year: int|null}`
- `PersonKey = "local:<uuid>" | "remote:<uuid>"` (user id or `LeaderboardRemote.id`)
- `Person = {key, kind: "local"|"remote", username, displayName, origin: string|null}`
- `LeaderboardRow = {person: Person | {key: "self", kind: "self", …}, status: RowStatus, snapshot: LeaderboardSnapshot|null, sharedYear: int|null}`
- `RowStatus = "ok" | "notShared" | "yearNotShared" | "withdrawn" | "unreachable" | "outdated" | "federationOff"`
- `RequestView = {consentId, person, createdAt}` — someone asked to see MY numbers
- `PersonView = {person, mine: {consentId, status, scope}|null, theirs: {status}|null}` (`theirs` null for remote: the other server holds it)
- `BoardView = {id, name, members: PersonKey[]}`

### 9.2 Admin API `/api/v1/admin/federation` — family **bare**, admin mount (already undocumented)

`GET /` → `{source: "env"|"settings"|null, enabled, origin, publicKey, fingerprint, peers: Peer[]}`;
`PUT /` `{enabled, origin}`; `POST /key` (generate a fresh Ed25519 key; refused with
`COMPARISON_FEDERATION_ENV` 409 while the env override is active);
`POST /peers` `{origin, publicKey, fingerprint, enabled}`; `POST /peers/verify` `{origin}`;
`POST /peers/suspend` `{origin}`. The three peer routes move here unchanged in behaviour from
`routes/comparison.ts:185-247,297-308`.

### 9.3 Peer protocol `/api/v1/comparison-peer` (undocumented, says why in `coverage.ts`)

`packetBody` gains three actions; the E2E actions are unchanged:

| Action | Request | Signed reply |
|---|---|---|
| `ping` | `{}` | `{ready: true, leaderboard: [1]}` (old servers: `{ready: true}`) |
| `aggregate` | `{channel, year, accept: [1]}` | `{status: "ok", snapshot} | {status: "notShared"} | {status: "withdrawn"} | {status: "yearNotShared", year} | {status: "unsupportedVersion", supported: number[]}` |
| `lb-claim` | `{code, username, displayName}` | `{accepted: true, channel, username, displayName}` |
| `lb-state` | `{channel, status: "withdrawn"}` | `{ok: true}` |

All three need a verified peer, consume a nonce, and are matched by `(origin of the signed
envelope, channel)`. A refusal still answers `403 {error: "COMPARISON_REFUSED"}` to the peer
(it learns nothing) but is logged with a **kind**: `beta-off`, `packet-too-large`, `malformed`,
`unknown-peer`, `bad-signature`, `stale`, `unverified-peer`, `replay`, `unknown-channel`,
`federation-off`, or `refused` (E2E paths, unchanged).

## 10. Mixed versions between instances

- Snapshot schema is versioned (`schema: "travstats-leaderboard", version: 1`). A requester
  lists the versions it reads (`accept`); a server answers with one of them or
  `unsupportedVersion`. **Adding a metric is not a version change**: `metrics` is a record and
  the receiver shows only keys its own catalogue knows. A new version is for a change of
  meaning.
- A server that predates this rework answers `ping` without `leaderboard` and refuses the
  unknown action. Admin "verify" stores `leaderboardVersions` from the ping. A pull to a peer
  whose stored list lacks `1` pings once more (it may have been updated); still lacking → row
  status `outdated`, copy "Der Server von {{name}} muss aktualisiert werden" /
  "{{name}}'s server needs an update". A claim against such a server → `COMPARISON_PEER_OUTDATED`.
- An old server can still run the E2E protocol against a new one: the E2E actions and
  `/api/v1/comparison-peer` path are unchanged.

## 11. UI

### 11.1 `/compare` — "Vergleich mit Freunden" / "Compare with friends"

Built only from primitives (`components/ui`): `AppShell width="list"`, `PageHeader` (title,
meta "Nur Summen, nie einzelne Reisen" / "Totals only, never single trips", action
"Person hinzufügen" / "Add person"), `Segmented` for the four metric groups
(Strecke · Reisen · Zeit · Orte / Distance · Trips · Time · Places), a `Select` for the period
(Gesamt / All time, then years), a `Select` for the board when boards exist, then a grid of
`Card`s — one per metric of the group the viewer has enabled — each with a `StatTile` (own value,
metric label, unit) and the ranked people under it (`ListRow dense`, rank as mark, value as
trailing, partial as "≥", unranked as "—" with the status in the subtitle). The card's left
border carries the domain colour (`useDomainColors().colorOf`); cross-domain metrics use
`var(--ts-accent)`. `EmptyState kind="nothing"` when nobody else is on the board, with the
"Person hinzufügen" action.

Below: **Anfragen** (requests) — "{{name}} möchte deine Zahlen sehen" with Annehmen / Ablehnen;
**Personen** — a `Table` (name, server, "sieht" = what they see, "teilt" = what they share,
action "Ändern" / "Beenden"); **Gruppen** — boards (name + member checkboxes).

### 11.2 The one consent dialog

`Dialog` title "{{name}} sieht diese Zahlen" / "{{name}} sees these numbers". Body: the four
groups and the domains as two labelled rows of toggle `Chip`s (`aria-pressed`; all on by
default — not `Switch`, whose contract is "takes effect when touched", while this choice takes
effect only on "Teilen"), period
`Select` ("Alle Jahre" / "All years", "Nur {{year}}" / "Only {{year}}"), and the actual numbers
from `POST /preview` under exactly that scope. Fine print: "Nur Summen – keine Reisen, Orte,
Daten oder Kosten. Du kannst das jederzeit ändern oder beenden." / "Totals only — no trips,
places, dates or costs. You can change or stop this at any time." For a remote person an
additional line: "Die Zahlen gehen an den Server {{origin}}. Wer diesen Server betreibt, kann
sie lesen." / "The numbers go to the server {{origin}}. Whoever runs that server can read them."
One action: "Teilen" / "Share".

### 11.3 Admin → Instanz → "Server-Verbindungen" / "Server connections"

`FederationSettings` (a `SectionCard` like `ShareLinksSettings`): switch "Mit anderen
TravStats-Servern verbinden", origin input, "Schlüssel erzeugen" button (warns that pinned
peers must re-pin), the public key + fingerprint to hand to other admins, the peer list with
add / verify / suspend. When `source === "env"`, everything is read-only with
"Über Umgebungsvariablen festgelegt" / "Set by environment variables".

### 11.4 Navigation

`/compare` leaf in "Sammlungen" right after the year review, icon `users` (new Lucide entry;
Achievements keeps `trophy`). `/encrypted-share` leaf "Verschlüsselt teilen" / "Encrypted
sharing" in "Werkzeuge" with icon `key-round`, visible only with `encryptedShare`.

### 11.5 Removed

`comparison.css` leaves the comparison page; it moves with the E2E surface as
`encryptedShare.css` (class `encrypted-share-surface`) because the frozen E2E forms still use
raw controls — recorded as E2E debt, not fixed here. `PeerManager` is replaced by the admin
card. The ranking table and `ranking.ts` leave `SealedWorkspace`.

## 12. Rollout

1. Separation tasks first (E2E moves to `/api/v1/encrypted-share`; `/compare` still renders the
   old workspace against the moved API). Shippable.
2. Admin federation settings and identity. Shippable (env installs unchanged).
3. Leaderboard backend behind the instance beta switch, documented. Shippable (no UI yet).
4. Leaderboard frontend components, unrouted. Shippable.
5. Last task: `/compare` renders the leaderboard (still behind `comparison`), `/encrypted-share`
   renders the E2E workspace behind `encryptedShare`, nav and registry updated. The
   `comparison` gate stays; its `returnsWhen` is rewritten to name the owner's acceptance of
   this design on the RC.

Prod note: the prod instance runs with the beta switch on, so step 5 changes prod's `/compare`
on the next deploy. Existing E2E users find their data under "Verschlüsselt teilen".

## 13. What gets deleted

- `routes/comparison.ts` handlers `/audit`, `/boards` (GET, POST); `services/federation/groups.ts`;
  `ComparisonGroup` model and table.
- `/peers*` handlers from the comparison router (moved to admin).
- `frontend/src/components/comparison/{PeerManager.tsx, ranking.ts, __tests__/ranking.test.ts}`
  and the leaderboard half of `SealedWorkspace`.
- `frontend/src/lib/api/comparison.ts` `Board` type. (`COMPARISON_METRICS` moves with the E2E
  client to `lib/api/encryptedShare.ts` and stays: `lib/encryptedShare/schema.ts` validates the
  old v1 snapshot inside E2E packages with it.)

## 14. Risks

| Risk | Mitigation |
|---|---|
| Aggregates now leave the server in plaintext to the peer's operator | Owner decision §2; dialog states it in plain words; only totals, no records; peers are admin-pinned and verified |
| Leaderboard load runs ~9 loaders per person | Cap 50 local + 20 remote rows; `comparisonReadLimiter`; remote pulls in parallel with the existing 10 s deadline; measure on the RC before un-gating |
| Ranking a lower bound against an exact figure | `partial` + "≥"; a partial value still ranks (it is a true lower bound), stated in the tile help |
| Identity moves from sync env read to async DB read | Cached per config; env path unchanged and still read once (existing test) |
| Mixed versions | §10; tests pin both directions |
| Restore reviving a withdrawn consent | §7.4 resets to pending |
| Old remote friendships silently vanish | §7.3 table is release-note material; `CHANGELOG` entry at `/deploy` names it |
