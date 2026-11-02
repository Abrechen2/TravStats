# User connections across servers — one confirmed connection carries everything (2026-11-02)

Owner, 2026-11-02, verbatim: „Wir haben doch eingerichtet das die Admins beider Server die Schlüssel
austauschen, danach sollten alle Funktionen zwischen User der Server nach beidseitiger Bestätigung
funktionieren. Also einmal Admin für die Server to Server Verbindung, dann User zu User. Das bedeutet
das Plan auch darunter fällt. Das einzige ist das man mit Companion die Server to Server vereinfachen
kann mit QR, das betrifft aber nur Admin User. Für die User schaltet sich dann nur die Möglichkeit frei
sich mit dem User zu verbinden; nach Bestätigung beider können sie festlegen was sie teilen möchten,
bzw. vor dem Bestätigen der User-Verbindung. Das wären dann Schalter wie Pläne teilbar machen, Stats
voll oder einfach, Erfolge, und was sonst geht." — „ja bau das so".

Second opinion: Codex, 2026-11-02 (same direction; its cautions are under *Risks*).

Supersedes: the guest door of `docs/features/travplan-guests.md` (vouch, guest session, guest PAT,
guest QR, claim code — beta key `travPlanGuests`, never released beyond the RC server) and the
"pairing without confirmation" part of `2026-10-20-federated-trip-sharing-design.md` → *As built —
simplified setup* (`directory-pair` turns a findable person into an accepted pairing on the asker's
word alone).

## 1. The model

| Layer | Who | Once | What it unlocks |
|---|---|---|---|
| Server ↔ server | the two admins | pin each other's key (connection file + fingerprint), unchanged. The Companion may carry the connection file by QR — **the only QR in federation** | users of both servers may *ask* each other for a connection |
| User ↔ user | the two people | A asks, B confirms; each sets their switches before confirming | exactly what each side switched on, nothing else |
| Per resource | the owner of a plan / trip | invite a connected person | that one plan / trip |

A connection is **eligibility**, never blanket access: a plan is still shared plan by plan.

## 2. The connection record

`remote_share_accounts` evolves into the connection (one row per side, as today; the pair is linked by
`origin` + the two channels):

| Column | Meaning |
|---|---|
| `state` | `pending_out` (I asked) · `pending_in` (they asked) · `active` · `declined` · `revoked` · `reconfirm` (pairing made before this change) — CHECK |
| `generation` | int, bumped on every state or switch change; a message carrying an older generation is refused as stale |
| `share_plans` | bool — I may invite this person into my plans and accept theirs |
| `stats_level` | `off · overview · full` — exists |
| `share_achievements` | bool — they see my achievements |
| leaderboard | the existing `LeaderboardConsent` via `leaderboard_remote_id` — exists |
| `share_trip_offers` | bool — they may offer me trips (inbox) |
| `remote_switches` | JSON, the other side's switches as last announced (read-only display: "teilt mit dir: …") |
| `requested_at`, `confirmed_at`, `ended_at` | timestamps |

All switches default **off** and are **directional**: each side decides what *it* gives. Features that
need both (plans) require both sides' switch on.

`users.federation_findable` stays and means only "people on connected servers may send me a
connection request". It never creates a connection.

**Existing pairings** (invitation codes and `directory-pair`) migrate to `state = reconfirm`: they
keep the trips already shared with them working (no data breaks), but no *new* feature starts on them
until both sides confirm once. The inbox shows each as "Verbindung bestätigen".

## 3. Wire (purpose `trip-share/1`, signed, existing replay/pin checks)

New peer kinds, each idempotent on `(origin, channel, generation)`:

| Kind | Body | Effect on the receiver |
|---|---|---|
| `connect-request` | `{fromUsername, fromDisplayName, toUsername, channel, switches}` | row `pending_in` + inbox item; the answer is `{received:true}` for every case (unknown, not findable, blocked, limit) — no oracle |
| `connect-accept` | `{channel, generation, switches}` | `pending_out` → `active` |
| `connect-decline` | `{channel}` | → `declined`; a new request from the same person is silently dropped for 30 days |
| `connect-revoke` | `{channel, generation}` | → `revoked`; cascades: plan memberships of that person end, stats/leaderboard/achievement reads refuse, pending offers withdrawn. Trips already shared keep the linked copies (same rule as today's revoke) |
| `connect-settings` | `{channel, generation, switches}` | updates `remote_switches`; switching *off* takes effect on the sender's side immediately (the sender enforces its own switches) |

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

| Call | Answer |
|---|---|
| `GET /api/v1/remote-plans` | `[{connectionId, origin, planId, tripId, title, ownerDisplayName, role, state}]` |
| `GET /api/v1/remote-plans/:connectionId/:planId` | the same plan view the owner route returns |
| `POST …/mutations` | same body + `clientRef`; same answers and conflict 409 |
| `GET …/collab` · `POST …/notices/read` · `GET|POST …/documents` · `GET …/documents/:id/file` · `GET …/export` | as the owner routes |
| `POST …/leave` | ends the membership |

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

| Call | Body | Answer |
|---|---|---|
| `GET /sharing/connections` | | `[connection]` — `{id, origin, username, displayName, state, mine:{plans, stats, achievements, leaderboard, tripOffers}, theirs:{…}, requestedAt, confirmedAt}` |
| `POST /sharing/connections` | `{origin, username, switches}` | connection `pending_out` (201); the answer never says whether the person exists |
| `POST /sharing/connections/:id/accept` | `{switches}` | `active` |
| `POST /sharing/connections/:id/decline` | | `declined` |
| `PUT /sharing/connections/:id/switches` | `{switches}` | connection |
| `DELETE /sharing/connections/:id` | | `revoked` |

`switches = {plans: bool, stats: "off"|"overview"|"full", achievements: bool, leaderboard: bool,
tripOffers: bool}`. The old `/sharing/remote/people*` calls stay as read aliases for one release
(Companion contract of 2026-11-02 is still served).

Inbox: `GET /sharing/inbox/count` gains `connectionRequests` and `planInvites` (additive, counted in
`count`, like `remoteOffers`).

## 6. Admin pairing by QR (Companion)

Admin → Instanz shows the connection file as a QR (`{"v":1,"k":"server","u":<origin>,"key":<public
key>,"fp":<fingerprint>}`, the data the connection file already carries). An admin's Companion scans
the other server's QR and calls `POST /api/v1/admin/federation/peers {connectionFile}` on its own
server (admin session; same validation as the upload). The fingerprint is still compared: the app
shows it and asks the admin to confirm it with the other admin. No user-level QR exists.

## 7. What is removed

Beta key `travPlanGuests`, `routes/guest.ts`, `middleware/guestAuth.ts`, the `/federation/vouch` page,
`GuestPlanPage` and guest mode, tables `travel_plan_guest_invites|joins|sessions|claims` (dropped by
migration; the feature never left the RC server), `docs/features/travplan-guests.md` (its threat-model
content moves into §9 here).

## 8. Phases

| Phase | Side | Content | State |
|---|---|---|---|
| S1 | Server | connection record + migration (`reconfirm`), wire kinds §3, user API §5, findable = requests only, inbox counts, web: Einstellungen → Teilen → „Verbindungen" (request with switches, confirm with switches, change, end) and inbox items | open |
| S2 | Server | plans over the connection §4 (host checks + member proxy + API), web: remote plans in the plan list and the plan screens through an API adapter; owner "Mitplaner hinzufügen" lists active connections with plans on | open |
| S3 | Server | remove the guest door §7; admin QR + `POST /admin/federation/peers` §6 | open |
| C1 | Companion | connections screen (request, confirm with switches, change, end) + inbox items | open |
| C2 | Companion | remote plans through the own server's `/remote-plans` API (offline queue keeps `clientRef`) | open |
| C3 | Companion | admin: scan server QR, show fingerprint, pin | open |

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

## Open for Companion

- (none yet)
