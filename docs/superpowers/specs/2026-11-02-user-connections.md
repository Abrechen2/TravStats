# User connections across servers — one confirmed connection carries everything (2026-11-02)

Owner, 2026-11-02, verbatim: „Wir haben doch eingerichtet das die Admins beider Server die Schlüssel
austauschen, danach sollten alle Funktionen zwischen User der Server nach beidseitiger Bestätigung
funktionieren. Also einmal Admin für die Server to Server Verbindung, dann User zu User. Das bedeutet
das Plan auch darunter fällt. Das einzige ist das man mit Companion die Server to Server vereinfachen
kann mit QR, das betrifft aber nur Admin User. Für die User schaltet sich dann nur die Möglichkeit frei
sich mit dem User zu verbinden; nach Bestätigung beider können sie festlegen was sie teilen möchten,
bzw. vor dem Bestätigen der User-Verbindung. Das wären dann Schalter wie Pläne teilbar machen, Stats
voll oder einfach, Erfolge, und was sonst geht." — „ja bau das so".

Second opinion: Codex, 2026-11-02 (same direction; its cautions are under _Risks_).

Supersedes: the guest door of `docs/features/travplan-guests.md` (vouch, guest session, guest PAT,
guest QR, claim code — beta key `travPlanGuests`, never released beyond the RC server) and the
"pairing without confirmation" part of `2026-10-20-federated-trip-sharing-design.md` → _As built —
simplified setup_ (`directory-pair` turns a findable person into an accepted pairing on the asker's
word alone).

## 1. The model

| Layer           | Who                        | Once                                                                                                                                               | What it unlocks                                             |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Server ↔ server | the two admins             | pin each other's key (connection file + fingerprint), unchanged. The Companion may carry the connection file by QR — **the only QR in federation** | users of both servers may _ask_ each other for a connection |
| User ↔ user     | the two people             | A asks, B confirms; each sets their switches before confirming                                                                                     | exactly what each side switched on, nothing else            |
| Per resource    | the owner of a plan / trip | invite a connected person                                                                                                                          | that one plan / trip                                        |

A connection is **eligibility**, never blanket access: a plan is still shared plan by plan.

## 2. The connection record

`remote_share_accounts` evolves into the connection (one row per side, as today; the pair is linked by
`origin` + the two channels):

| Column                                     | Meaning                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                                    | `pending_out` (I asked) · `pending_in` (they asked) · `active` · `declined` · `revoked` · `reconfirm` (pairing made before this change) — CHECK |
| `generation`                               | int, bumped on every state or switch change; a message carrying an older generation is refused as stale                                         |
| `share_plans`                              | bool — I may invite this person into my plans and accept theirs                                                                                 |
| `stats_level`                              | `off · overview · full` — exists                                                                                                                |
| `share_achievements`                       | bool — they see my achievements                                                                                                                 |
| leaderboard                                | the existing `LeaderboardConsent` via `leaderboard_remote_id` — exists                                                                          |
| `share_trip_offers`                        | bool — they may offer me trips (inbox)                                                                                                          |
| `remote_switches`                          | JSON, the other side's switches as last announced (read-only display: "teilt mit dir: …")                                                       |
| `requested_at`, `confirmed_at`, `ended_at` | timestamps                                                                                                                                      |

All switches default **off** and are **directional**: each side decides what _it_ gives. Features that
need both (plans) require both sides' switch on.

`users.federation_findable` stays and means only "people on connected servers may send me a
connection request". It never creates a connection.

**Existing pairings** (invitation codes and `directory-pair`) migrate to `state = reconfirm`: they
keep the trips already shared with them working (no data breaks), but no _new_ feature starts on them
until both sides confirm once. The inbox shows each as "Verbindung bestätigen".

## 3. Wire (purpose `trip-share/1`, signed, existing replay/pin checks)

New peer kinds, each idempotent on `(origin, channel, generation)`:

| Kind               | Body                                                             | Effect on the receiver                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect-request`  | `{fromUsername, fromDisplayName, toUsername, channel, switches}` | row `pending_in` + inbox item; the answer is `{received:true}` for every case (unknown, not findable, blocked, limit) — no oracle                                                                           |
| `connect-accept`   | `{channel, generation, switches}`                                | `pending_out` → `active`                                                                                                                                                                                    |
| `connect-decline`  | `{channel}`                                                      | → `declined`; a new request from the same person is silently dropped for 30 days                                                                                                                            |
| `connect-revoke`   | `{channel, generation}`                                          | → `revoked`; cascades: plan memberships of that person end, stats/leaderboard/achievement reads refuse, pending offers withdrawn. Trips already shared keep the linked copies (same rule as today's revoke) |
| `connect-settings` | `{channel, generation, switches}`                                | updates `remote_switches`; switching _off_ takes effect on the sender's side immediately (the sender enforces its own switches)                                                                             |

Lookups keep their budgets (30/h per user, 60/h per peer). `directory-pair` stays readable for old
peers for one release and answers `paired:false` from servers that have this change.

## 4. Plans over the connection (replaces the guest door)

The owner's server stays authoritative for the plan; the member works **on their own server and app**.

- Owner: `POST /trips/:id/plan/members {connectionId}` — only for an `active` connection with
  `share_plans` on both sides. Creates a `remote` member bound to the connection
  (`travel_plan_members.connection_id`, replaces `remote_subject`) in state `invited`, sends
  `plan-invite {planId, tripTitle, ownerDisplayName}`.
- Member's server: inbox item "Plan von <name>"; accept → `plan-join`, decline → `plan-decline`.
- Then the member's server proxies plan calls under peer kinds `plan-read`, `plan-mutate`
  (body carries `clientRef`, the same receipt/idempotency as local mutations), `plan-collab`,
  `plan-notices-read`, `plan-doc-list`, `plan-doc-get`, `plan-doc-put` (≤20 MB), `plan-export`.
  The host derives the actor from the signed `channel` → connection → member; it checks on **every**
  call: peer pinned and enabled, connection `active`, both `share_plans` on, member `active`, plan id
  matches the member, role allows the operation. A signature alone grants nothing.
- Limits move from the guest door unchanged: 120 writes/min, 600 reads/min, ≤50 documents per member.
- The member's server holds no copy beyond a short-lived read cache; it must be online to use the plan
  (accepted: own server).
- Member-facing API on the member's own server (enveloped, for web and Companion):

| Call                                             | Answer                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /api/v1/remote-plans`                       | `[{connectionId, origin, planId, tripId, title, ownerDisplayName, role, state}]` |
| `GET /api/v1/remote-plans/:connectionId/:planId` | the same plan view the owner route returns                                       |
| `POST …/mutations`                               | same body + `clientRef`; same answers and conflict 409                           |
| `GET …/collab` · `POST …/notices/read` · `GET    | POST …/documents`·`GET …/documents/:id/file`·`GET …/export`                      | as the owner routes |
| `POST …/leave`                                   | ends the membership                                                              |

Companion needs (2026-11-02), part of S2:

- Invites: `GET /api/v1/remote-plans` lists invitations too (`state: "invited"`), answered by
  `POST /api/v1/remote-plans/:connectionId/:planId/accept|decline`.
- Polling: `GET …/:planId` carries an `ETag`; `If-None-Match` answers 304 from the member server's
  read cache while it is fresh (no peer round trip), otherwise the host's ETag is passed through.
- Offline: the member's server forwards `clientRef` unchanged; a replay after a 503 gets the host's
  stored receipt, never a second mutation. Clients keep their queue on 503 and drop cache and queue
  only on `REMOTE_PLAN_NOT_SHARED` / `REMOTE_PLAN_NOT_FOUND`. An on-device cache for offline reading
  is fine (as for own plans).
- Feature detection: an older server answers `/sharing/connections` with a plain 404 (no `code`);
  federation switched off answers 404 `SHARE_REMOTE_DISABLED`. The `code` tells them apart.

Error codes: `REMOTE_PLAN_UNREACHABLE` (503, host offline; `extra.origin`), `REMOTE_PLAN_NOT_SHARED`
(403 — connection inactive, switch off or membership ended; one code, the UI says "nicht mehr
geteilt"), `REMOTE_PLAN_NOT_FOUND` (404).

## 5. User API (own server, enveloped, `SHARE_REMOTE_DISABLED` 404 while federation is off)

| Call                                    | Body                           | Answer                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /sharing/connections`              |                                | `[connection]` — `{id, origin, username, displayName, state, mine:{plans, stats, achievements, leaderboard, tripOffers}, theirs:{…}, requestedAt, confirmedAt, revokedAt}`. For `pending_in`, `theirs` carries the switches the asker announced in `connect-request`, so the confirm dialog shows what the person gets before they set their own |
| `POST /sharing/connections`             | `{origin, username, switches}` | connection `pending_out` (201); the answer never says whether the person exists                                                                                                                                                                                                                                                                  |
| `POST /sharing/connections/:id/accept`  | `{switches}`                   | `active`                                                                                                                                                                                                                                                                                                                                         |
| `POST /sharing/connections/:id/decline` |                                | `declined`                                                                                                                                                                                                                                                                                                                                       |
| `PUT /sharing/connections/:id/switches` | `{switches}`                   | connection                                                                                                                                                                                                                                                                                                                                       |
| `DELETE /sharing/connections/:id`       |                                | `revoked` (a `pending_out` request is taken back, a `pending_in` one is declined)                                                                                                                                                                                                                                                                |

`switches = {plans: bool, stats: "off"|"overview"|"full", achievements: bool, leaderboard: bool,
tripOffers: bool}`. The old `/sharing/remote/people*` reads stay as aliases for one release (Companion contract of
2026-11-02 is still served), and `GET /sharing/remote/servers` and `GET|PUT /sharing/remote/findable`
stay full routes — the request form needs the server list. `POST /sharing/remote/people/find` is gone
(use `POST /sharing/connections`); `PUT /people/:id/stats-level` and `/leaderboard` now go through the
connection's switch call and announce the change.

Inbox: `GET /sharing/inbox/count` gains `connectionRequests` (S1: `pending_in` requests and `reconfirm`
pairings; additive, counted in `count`, like `remoteOffers`) and, from S2, `planInvites`.
New error codes: `SHARE_REMOTE_CONNECTION_EXISTS` (409), `SHARE_REMOTE_CONNECTION_STATE` (409),
`SHARE_REMOTE_CONNECTION_REQUIRED` (409: offering or reading statistics needs an active connection).

## 6. Admin pairing by QR (Companion)

**As built (fix/admin-server-qr).** Admin → Instanz shows the connection file as a QR
(`{"v":1,"k":"server","u":<origin>,"key":<SPKI PEM>,"fp":<sha-256 hex>}` — the file's three values,
no secret; hidden while the address field has unsaved edits). An admin's Companion scans the other
server's QR and pins it on its own server. The fingerprint is still compared: the app shows it and
asks the admin to confirm it with the other admin. No user-level QR exists.

### Companion contract

Auth: an admin user's browser session, or a PAT of an admin user with scope `admin`. A paired
Companion holds only a `write` PAT (`routes/pairing.ts`), so no standing admin token lives on a
phone: for **exactly** `POST /admin/federation/peers`, `/peers/verify` and `/peers/suspend` a
`write` PAT is accepted when the user is an admin AND the body adds **step-up** fields
`{"password": "<admin password>", "totp"?: "<6 digits>"}` (`totp` required when the account has
two-factor). Every call proves it again; nothing is remembered. Any other admin route refuses a
`write` PAT as before (403 `API token lacks admin scope`), a `read` PAT 403, a non-admin 403 (also
with a password, and without being told whether the password was right). Base `/api/v1`.

Step-up refusals (body `{code, error}`): 403 `ADMIN_STEP_UP_TOTP_REQUIRED` (two-factor on, no
`totp`; checked after the password); 403 `ADMIN_STEP_UP_FAILED` (wrong password or `totp`, or an
account with no usable password); 429 `ADMIN_STEP_UP_LOCKED` (5 wrong attempts per account in 15
minutes; the login's address limiter `authLimiter` applies on top, and the route's 20/min limit on
the pin). A passkey-only admin has no password to prove and pins from the web. The fields are
stripped before the strict body schemas run; they are never logged. Step-up fields sent with a
session or an `admin` PAT are rejected as unknown keys (400), as before.

| Call                                   | Body                                                                | Answer                                                    |
| -------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /admin/federation/peers`         | `{"qr": <payload string or object>, "enabled"?: true}`              | 200 federation state + `peer` + `computedFingerprint`     |
| same                                   | `{"connectionFile": <base64 of the ZIP or JSON>, "enabled"?: true}` | same                                                      |
| same                                   | `{origin, publicKey, fingerprint, enabled}` (existing web form)     | same                                                      |
| `POST /admin/federation/peers/verify`  | `{"origin": "<u>"}`                                                 | 200 `{verified: true}`; 502 `COMPARISON_PEER_UNREACHABLE` |
| `POST /admin/federation/peers/suspend` | `{"origin"}`                                                        | 200 `{suspended: true}`                                   |

- `peer` = `{origin, fingerprint, enabled, verifiedAt: null, leaderboardVersions}`. A new pin is
  **unverified** (`verifiedAt: null`); re-pinning resets it. `computedFingerprint` is the SHA-256
  THIS server computed from the key; the app shows it beside the QR's `fp` and the admin compares
  both with the other admin. Verify (ping over the signed channel) is what sets `verifiedAt`.
- Errors (body `{code, error}`): 400 `COMPARISON_PEER_KEY_INVALID` (not Ed25519, fingerprint
  mismatch, this server itself); 413 `COMPARISON_CONNECTION_FILE_TOO_LARGE`; 422
  `COMPARISON_CONNECTION_FILE_UNREADABLE` (QR not JSON, no entry), `_FORMAT` (wrong `v`/`k`/shape,
  extra keys), `_ORIGIN` (not an https origin), `_KEY`, `_FINGERPRINT` (forged `fp`); 400 zod
  validation for a body of none of the three shapes; 429 over 20 pins/minute/user.
- Minimum server version: the build carrying this change; older servers lack `qr`/`connectionFile`
  and `computedFingerprint` (the explicit-values form works everywhere).

## 7. What is removed

Beta key `travPlanGuests`, `routes/guest.ts`, `middleware/guestAuth.ts`, the `/federation/vouch` page,
`GuestPlanPage` and guest mode, tables `travel_plan_guest_invites|joins|sessions|claims` (dropped by
migration; the feature never left the RC server), `docs/features/travplan-guests.md` (its threat-model
content moves into §9 here).

## 8. Phases

| Phase | Side      | Content                                                                                                                                                                                                                                   | State                                                    |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| S1    | Server    | connection record + migration (`reconfirm`), wire kinds §3, user API §5, findable = requests only, inbox counts, web: Einstellungen → Teilen → „Verbindungen" (request with switches, confirm with switches, change, end) and inbox items | built on `fix/user-connections-s1` (see _S1 — as built_) |
| S2    | Server    | plans over the connection §4 (host checks + member proxy + API), web: remote plans in the plan list and the plan screens through an API adapter; owner "Mitplaner hinzufügen" lists active connections with plans on                      | open                                                     |
| S3    | Server    | remove the guest door §7; admin QR + `POST /admin/federation/peers` §6                                                                                                                                                                    | open                                                     |
| C1    | Companion | connections screen (request, confirm with switches, change, end) + inbox items                                                                                                                                                            | open                                                     |
| C2    | Companion | remote plans through the own server's `/remote-plans` API (offline queue keeps `clientRef`)                                                                                                                                               | open                                                     |
| C3    | Companion | admin: scan server QR, show fingerprint, pin                                                                                                                                                                                              | open                                                     |

Minimum server version for C1–C3: the 2.8.0 RC that ships S1–S3 (planned rc.15).

## 9. Risks and threat-model notes

- The member's server sees the plan data it proxies — it is the member's own server; stated in the
  invite dialog.
- Both servers trust the other admin's statement of who a user is (true before as well).
- Every host-side plan check runs per call; a revoked connection or a switch turned off ends access
  on the next call, not at a token's expiry.
- Version skew: a peer without §3 gets no connection request (feature flag `connections` in the ping);
  the UI says the other server must update.
- Restore of a backup: connections restore as `reconfirm`.

## S1 — as built (2026-11-02)

Deviations and decisions the spec did not fix:

- **Wire bodies.** `connect-request` carries `channel` (the asker's own name), `leaderboardChannel`,
  `generation`, `toUsername`, `fromUsername`, `fromDisplayName`, `switches`. The other four address a
  row by `from` (sender's channel) and `to` (receiver's channel, as in `offer`); `connect-accept` also
  carries the accepter's `username`, `displayName` and `leaderboardChannel`, because the asker holds a
  placeholder for the other side's channel until it is answered. A request taken back (`pending_out`
  → `connect-revoke`) is found by the asker's channel.
- **Generation is per sender.** `generation` is the sender's own counter; the receiver keeps the highest
  it accepted (`peer_generation`) and applies only a newer one. Extra columns beyond §2: `peer_generation`,
  `share_leaderboard` (the switch, so a pending choice has a home), `peer_leaderboard_channel`,
  `ended_by_me` (only a decline _this_ side made blocks the person for 30 days).
- **Crossing requests.** Two people asking each other at once: the server with the greater origin gives
  way (its own request becomes the one to answer), so exactly one request survives.
- **Send order.** Asking and confirming send first and fail as themselves (a request nobody got is taken
  back); declining, changing a switch and ending act locally first and announce once, best effort — what
  this side gives must stop at once. A missed announcement is logged; there is no retry queue yet (S2/S3
  may add one). The other side then refuses on its own, and learns on its next message.
- **Invitation-code pairings** made after this change are `active` (a code is an explicit bilateral act);
  the issuer's `remote_switches` starts with `tripOffers: true`, the claimant's `share_trip_offers` true.
  Only pairings that existed at migration time are `reconfirm`.
- **Gates.** `switches.ts`: a new offer needs `active` and the receiver's `tripOffers`; a statistics read
  needs `active` and a level above off; `reconfirm` grants nothing new. Achievements: the switch is
  stored and announced, nothing reads it yet. Leaderboard: the switch drives the existing
  `LeaderboardConsent`.
- **`directory-pair`** answers `paired: false` to everything (budget kept); `findRemotePerson` and
  `POST /sharing/remote/people/find` are removed. Offering by name needs an active connection
  (`SHARE_REMOTE_CONNECTION_REQUIRED`).
- **Restore** turns `active`/`pending_*` connections into `reconfirm` and bumps `generation` by 1000 so
  the request that confirms again is not read as an old one; an `active` connection asked again waits
  for its person (`pending_in`).
- **Revoke cascade** is `revokePairing` (statistics, leaderboard, consents, memberships, queued
  messages, pending offers), which now also sets `state = revoked`, clears the switches, and calls
  `endPlanMembershipsOfConnection` (`connections/hooks.ts`) — S2 fills that hook.
- **API field** `revokedAt` (not `endedAt`): the OpenAPI time-shape ratchet already baselines `endedAt`
  for tracks.
- **Inbox.** Requests and `reconfirm` pairings are listed at the top of the Verbindungen section and
  counted in the badge; the old „Personen auf verbundenen Servern" section is that view now.

## Open for Companion

- (none yet)
