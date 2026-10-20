# Federated trip sharing — one trip, two servers (S4)

Status: **proposed 2026-10-20**, documentation only. Tracks `dennis/TravStats` forgejo#301
(owner wish 2026-10-16, verbatim: „Reiseteilen […] es ging darum im Server eine komplette Reise
mit einem Reiseteilnehmer zu teilen, dass er sie auch in seiner TravStats-Instanz hat, egal ob
selber Server oder nicht.").

Builds on, and does not reopen:

- `2026-10-09-trip-sharing-design.md` — decisions 1–7 (linked copies, facts sync, changes apply
  and say so with undo, deletes never propagate, consent first, per trip, `.travstats`).
- `2026-10-16-trip-sharing-rework-design.md` — the registry (`services/sharing/shareTypes.ts`),
  one copy path (`copyInto.ts`), derivation for the recipient (`deriveCopy.ts`), the onward
  consent rule (`members.ts`), the vocabulary CHECKs.
- `2026-10-10-federation-threat-model.md` — server identity, pinned peers, signed envelopes,
  restore isolation, egress rules. §8 of that document is the baseline the deltas in §9 below
  are measured against.

Every "today" below was read on `main` at `5aacc4ca4`, before anything was built; phases F-S4a and
F-S4b are built since, see §14.

## 1. What exists, and what is missing

**Local sharing** (same server) is complete: a member's write calls `shareSnapshot(s)` before
and `propagateWrite(s)` / `propagateDelete(s)` after (`services/sharing/propagate.ts`); the
recipients are `receivingMembers()` (`members.ts`) — the group's other trips whose owner has an
accepted `ShareConsent` with the writer; each adapter (`adapters/*.ts`, typed by
`adapters/types.ts`) loads, copies, applies and removes; `ShareNotice` rows carry `before`/`after`
for the inbox and `undo.ts` restores `before` only if the copy still equals `after`
(`SHARE_UNDO_STALE`). Every participant is a row in `users`: `ShareConsent.requesterId/targetId`,
`ShareNotice.actorId`, `Trip.userId` are all user FKs.

**Cross-server** today is the comparison feature only:

| Piece | File | What it gives |
|---|---|---|
| Server identity (Ed25519, origin) | `services/federation/identity.ts` | `loadIdentity()`, admin_settings or `FEDERATION_*` env |
| Pinned peers | `ComparisonPeer` (`origin`, `publicKey`, `enabled`, `verifiedAt`), `routes/admin/federation.ts` | admin pins key + fingerprint, verifies by ping, suspends |
| Signed envelope | `services/federation/security.ts` `envelope()` / `verifyEnvelope()` | `{origin, destination, nonce, time, body, signature}`, ±5 min clock window |
| Replay protection | `consumeNonce()` + `ComparisonNonce` | 10 min nonce rows, only for verified peers |
| Egress | `exchange()` + `publicAddress()` | DNS checked and pinned, private ranges blocked, no redirects, 10 s, port 443 |
| Refusal | `services/federation/refusal.ts` | uniform 403 to the peer, named kind in the log |
| Restore isolation | `services/federation/restore.ts` | peers disabled, consents back to a question |
| Wire contract | `services/federation/contract.ts` `packetBody`, `schemas/comparison.ts` | strict discriminated union; `leaderboardSnapshotSchema` has no field that can hold a record |
| Remote friend | `LeaderboardRemote` (`origin`, `channel`, `username`, `displayName`), `services/comparison/remote.ts` | invitation code `<origin>#<64 hex>`, single use, 72 h |

The missing piece is everything between: a remote person as a sharing participant, a wire
contract that can carry the facts of one trip, delivery that survives a peer being offline, and
a conflict rule for two databases that no longer serialise each other's writes.

## 2. Goals and non-goals

- G1. A member can share one trip with a person on another admitted TravStats server; that
  person gets an ordinary trip in their own account — counted, backed up and exported by their
  server (CLAUDE.md, "The server is the record").
- G2. The same fact lists as local sharing (`services/sharing/facts/*`), the same privacy line,
  the same notice + undo, deletes never automatic, consent first on the receiving side.
- G3. A group can mix local and remote members; `shareKey` stays the one key per entry.
- G4. Each server authenticates the other on every message; revocation is immediate on the
  revoking side and no update crosses afterwards.
- G5. Off means absent: with the admin switch off, or on an instance not reachable from the
  internet, no route answers, no menu entry is drawn, nothing half-works.
- G6. The comparison leaderboard stays unable to carry or import a record.

Non-goals: E2E encryption of trip facts (see Owner decision O1 — the receiving server must
read them to keep the trip); sharing with someone who has no TravStats account anywhere;
roadtrips, tours, places, notes, photos, journal, documents, expenses (owner decision 2);
trip-level facts (still open from S2, same as locally); the Companion talking to a foreign
server.

## 3. Decisions proposed

**F1 — Addressing: an invitation code first, handles later.** The sharer creates a
`TripShareInvite` (hashed, single use, 72 h — the `LeaderboardInvite` shape, a separate table)
and passes `<origin>#trip:<64 hex>` out of band (link, QR, chat). The companion pastes or opens
it **on their own server**, which redeems it against the sharer's server (`invite-claim`). The
`trip:` tag makes a leaderboard code and a trip code mutually unredeemable — the two parsers
(`parseInviteCode` in `services/comparison/remote.ts` and a new `parseTripInviteCode`) each
refuse the other's form. A handle (`anna@travstats.example.org`) needs a lookup endpoint that
answers whether a user exists — enumeration the codes avoid; it is phase F-S4f, behind its own
rate limit and uniform answers.

**F2 — A remote person is a row of its own, never a `users` row.** `RemoteShareAccount { id,
origin, channel, username, displayName, createdAt }`, unique `(origin, channel)` — the
`LeaderboardRemote` shape, deliberately a **separate table**: a leaderboard friendship is not
trip consent (CLAUDE.md: "A comparison consent is NOT a `ShareConsent`"), and a code path that
could read one as the other is the failure this separation prevents. `channel` is random
handshake entropy (as in `links.ts` `receiveClaim`), never the remote account id: a remote id
must never resolve to a local user or trip id (threat model §6).

**F3 — Consent and membership tables gain a remote half, the local ones keep their FKs.**
- `ShareConsent` gets nullable `remoteRequesterId` / `remoteTargetId` (FK
  `RemoteShareAccount`, cascade) and a CHECK that each side is exactly one of user / remote.
  Then `acceptedWith`, `withdrawnTowards` and `missingGroupConsent` (`members.ts`) keep one
  home and answer for both kinds; a second consent table would be a second rule.
- `TripShareGroup` gets `federatedRef uuid?` (the group's id on the wire, random, the same on
  every server holding the group) and `homeOrigin text?` (null = this server is home, see F5).
- `TripShareRemoteMember { id, groupId, remoteId, state, lastDeliveredSeq, lastReceivedSeq,
  stateReason, stateSince }` — the remote counterpart of a member's trip. `state` ∈
  `invited | active | unreachable | suspended | left | revoked` (CHECK, Zod union in
  `schemas/sharing.ts`, held against `pg_constraint` like `shareVocabulary.test.ts`).
- `ShareNotice` gets `remoteActorId?` (FK, SetNull) beside `actorId`; CHECK at most one set.
  The inbox names a remote actor as „Ben (travstats.example.org)".

**F4 — Share keys cross to a peer, and only inside its group.** The issue requires `shareKey`
to stay the common key per entry, so a receiving server stores the sender's key on its copy.
This amends the rule in S2 ("Share keys never leave the server"): they still never reach a
client (`wireGuard.ts` replacer unchanged, Zod strips them on input), they reach a peer only in
a signed message about a group that peer has an active member in. Knowing a key gains a peer
nothing: `copiesOf(c, shareKey, groupId)` already never looks by key alone, and an incoming
message is resolved to the group by `(peer origin, federatedRef)` before any key is read.

**F5 — Topology: hub and spoke, the home server relays.** The server on which the group was
first shared to a remote member is its **home**. Every other server talks only to the home,
never to each other. The home fans an incoming change out to its local members (`receivingMembers`)
and forwards it to the other spokes; it already holds every fact, so relaying discloses nothing
new to it. This needs one admission per spoke (home ↔ spoke) instead of a mesh, and matches the
comparison circles' "named host" model (threat model §3). Onward sharing **to a third server**
is done from the home only: a spoke member asking to add someone sends an `add-request`, the
home runs the onward-consent rule.

**F6 — Conflicts: the version precondition, not last writer wins.** Locally, one database
orders writes and LWW + notice is safe. Two servers can both apply their own edit and then
each receive the other's — they end swapped. So every `fact-update` carries, per changed fact,
the value the **sender** held before (`before`, exactly what a notice already records) — the
same precondition `undo.ts` uses. The receiver applies a fact only where its copy still equals
`before` (`sameFact`, `factValues.ts`). A fact that differs is not written: both sides get a
`conflict` notice (new kind) showing mine / theirs with **Ihre übernehmen** / **Meine
behalten**; either choice is an ordinary write that propagates with a fresh `before`, so the
group converges after one human decision. Facts without a conflict in the same message apply.
The hub orders all messages of a group (F7), so two spokes never conflict without the hub
seeing it.

**F7 — Delivery: a transactional outbox, ordered per group and peer.** Propagation writes a
`TripShareOutbox { id (= messageId), peerOrigin, groupId, seq, kind, payload jsonb, attempts,
nextAttemptAt, lastError }` row **inside the write's transaction** (same rule as rework D8), and
never makes a network call there (rule stated in `services/comparison/remote.ts`). A scheduler
(`jobs/tripShareDeliveryScheduler.ts`) sends rows per `(peer, group)` strictly in `seq` order.
Before sending, it re-checks that the member is still `active` and the consent accepted — a
queued row is a reference to a permission that must still hold (threat model §6), and is
deleted when it does not.

**F8 — Two switches and a beta key.** `admin_settings.tripFederationEnabled` (default false,
Admin → Instanz, beside the identity), effective only when `loadIdentity()` succeeds; a beta key
`federatedTripSharing` in `frontend/src/config/betaFeatures.ts` with `why` / `returnsWhen`. Local
sharing has no beta key (rework §11) and keeps none. Per user, the consent of F3 — per remote
person, the existing granularity — plus the acceptance of each offered trip (F9).

## 4. Wire contract

**Separate route, separate schemas, shared crypto.** `POST /api/v1/trip-share-peer`
(`routes/tripSharePeer.ts`), body `tripSharePacket` in a new `schemas/tripSharePeer.ts`. It
reuses `authenticatePeer`, `consumeNonce`, `publicAddress` and the `ComparisonPeer` pin table
as they are. What must change in `services/federation/`:

| Today | Change | Why |
|---|---|---|
| `exchange()` hard-codes `/api/v1/comparison-peer`, a 16 KB request and 10 MB reply | `exchange(origin, body, { path, maxRequest, maxReply })`; comparison passes today's values | one egress implementation, two budgets |
| `envelope()` signs `{origin, destination, nonce, time, body}` | envelope v2 adds `purpose: "comparison/1" \| "trip-share/1"` to the signed fields; each route accepts only its own purpose; comparison keeps accepting v1 for one release | a packet signed for one protocol must never verify for the other, even if a schema ever overlapped |
| `PeerRefusal` says "Comparison request refused" | neutral text; kinds gain `not-member`, `gap`, `conflict` (logged only) | the log must name the protocol |
| `comparisonPeer.ts` requires `betaFeaturesEnabled` | the new route requires F8's switches and answers **404** when off | off = absent (G5) |
| `restore.ts` `suspendComparisonAfterRestore` | sibling `suspendTripFederationAfterRestore` (§8) | a restored clone must not resume deliveries |

`ComparisonPeer` keeps its name in F-S4a (renaming a pinned-key table is a migration with no
user benefit); a later rename to `FederationPeer` is a chore item, not a prerequisite.

**Separation, enforced.** A backend test `services/sharing/federation/__tests__/separation.test.ts`,
mirroring `frontend/src/components/encryptedShare/__tests__/separation.test.ts`: no file under
`services/comparison/**`, `routes/comparisonPeer.ts` or `schemas/comparison.ts` imports from
`services/sharing/federation/**` or `schemas/tripSharePeer.ts`, and the reverse; the `action`
literals of `packetBody` and `tripSharePacket` are disjoint; `leaderboardSnapshotSchema` still
fails to parse an object carrying any fact field name from `services/sharing/facts/*`.

**Messages** (all `z.strictObject`, discriminated on `kind`; every message carries
`messageId uuid`, `groupRef uuid` except the invite pair, `seq int` per `(sender origin,
groupRef)`, `sentAt` instant):

| kind | from → to | carries |
|---|---|---|
| `ping` | any | `{ tripShare: [1] }` — the versions served; a server without it "needs an update" |
| `invite-claim` | spoke → home | code (64 hex), claimant `channel`, `username`, `displayName` |
| `invite-claim-reply` | home → spoke | `accepted`, home member's `channel`/names, `federatedRef` |
| `offer` | home → spoke | roster (display names + origins, F5), trip facts, entry count; no entries yet |
| `offer-answer` | spoke → home | `accept \| decline` — consent on the receiving side, decided by the person |
| `entries` | home → spoke | ≤ 50 entries per message: `{ entity, shareKey, facts, zones, refs }` |
| `fact-update` | either | `{ entity, shareKey, actor, changes: [{ field, before, after }] }` (F6) |
| `entry-create` | either | one entry, as in `entries` |
| `entry-removed` | either | `{ entity, shareKey, actor, reason: deleted \| movedOut }` — notice only |
| `roster` | home → spokes | versioned roster; a newcomer's writes reach a member only after that member's consent |
| `add-request` | spoke → home | ask the home to offer the trip to a further person (F5) |
| `leave` | either | a member left; their copy stays (decision 5) |
| `revoke` | either | consent withdrawn; the sender stops at once, the receiver detaches |
| `ack` | reply | `{ received: seq }` or `{ rejected: reason, field? }` |

`entity` is `z.enum(SHARE_ENTITIES)` from the registry, so a ninth shareable type is a wire
change the compiler points at. `facts` per entity is a strict object built **from the fact
lists** (`FLIGHT_FACT_FIELDS` …, `CRUISE_STOP_FACT_FIELDS`, `LODGING_FACT_FIELDS` for the house
pseudo-fact) minus local ids, plus `refs`:

- **Catalogue ids never travel.** `shipId`, `departurePortId`/`arrivalPortId`/`portId`,
  `fromPortId`/`toPortId`, `depStationId`/`arrStationId`, `pickupAirportId`/`returnAirportId`
  are autoincrement ids of the sender's catalogue. They travel as natural keys — `Ship.imo`,
  `Port.unlocode`, `RailStation.sourceId`/`uic`, `Airport.icao`/`iata` — with name and
  coordinates, exactly as `services/trip/exchange/format.ts` does for `.travstats` (`unlocode`,
  `imo`). The receiver resolves against its own catalogue; an unmatched port becomes the cruise
  stop's third state (`unresolvedPortName`, CLAUDE.md cruise invariant), an unmatched station or
  airport keeps name + coordinates with a null id. A user-added catalogue row of the sender is
  sent as name + coordinates only.
- **A stop's wrapped entry** travels as `{ entity, shareKey }` and is resolved on the receiver
  like locally (stops last in copy order).
- **The lodging chain**: a catalogue chain by name, a sender-owned chain not at all (S1 rule).
- **Derived columns are advisory.** `status` and the trip's status are re-derived on the
  receiver by `DERIVE[entity]` for the recipient (rework D4); a wire `status` is not trusted.

Recommendation: the per-entity wire schemas and the `.travstats` schemas share one public-half
definition, so file and wire cannot drift; the wire has **no** private half at all.

**Idempotency.** `messageId` is stored in `TripShareInbound { messageId, peerOrigin, groupRef,
receivedAt }` (pruned after 30 days) and a repeat answers the original `ack`. `entries` and
`entry-create` are idempotent by `(groupRef, shareKey)` — `heldKeys` (`keyOps.ts`) already makes
a repeated share create only what is missing.

**Ordering.** The receiver accepts `seq = lastReceivedSeq + 1` only; a higher seq answers
`ack { rejected: "gap", expected }` and the sender resumes from there. The hub assigns one seq
space per group, so every spoke sees the same order.

**Replay.** Envelope nonce (10 min, `consumeNonce`) + ±5 min time window + `messageId` dedupe +
`seq` monotonicity. A message replayed after the nonce expired is stopped by `seq`; a message
after `revoke` is refused because the member is no longer `active` (tombstone = the member row
in state `revoked`, never deleted while the group exists).

**Size limits** (proposals; an implementation review gate, as the threat model requires):
control messages ≤ 8 KB body (today's `MAX_PACKET_BODY`); `fact-update` and `entry-create`
≤ 256 KB; `entries` ≤ 1 MB and ≤ 50 entries; ≤ 500 entries per trip; a geometry
(`actualRoute`, a road or rail line) ≤ 5 000 points — a longer one travels without the
geometry and the receiver's copy shows the straight line (a stated loss, not a silent
re-derivation). Per peer: 600 messages/min, 50 MB/day; per group: 2 000 messages/day.

## 5. Mapping local concepts to remote members

| Local | Remote counterpart |
|---|---|
| `ShareConsent` user ↔ user | same table, one side a `RemoteShareAccount` (F3); asked through the invite, accepted by the person on their own server |
| Group = trips with one `shareGroupId` | one `TripShareGroup` per server, joined by `federatedRef`; remote members listed in `TripShareRemoteMember` |
| `receivingMembers()` | unchanged for local members; new `receivingRemotes()` beside it, same consent rule; propagation writes an outbox row per remote member's server (one per server, not per member — the receiving server fans out locally) |
| `missingGroupConsent()` | at the home, across both kinds; a remote newcomer's writes reach a member only after that member's consent (`roster`) |
| `copyInto()` | the receiver calls it with a `SharedRow` built from the wire entry — own-flight/crossing join included, so a companion who logged the flight themselves is joined, not duplicated |
| `propagateWrite(s)` | gains the outbox step; incoming messages apply through the adapters inside `propagationGuard` (no echo back to the sender), then fan out to local members, then — at the home — to the other spokes |
| `ShareNotice` | same row, `remoteActorId` set; kinds gain `conflict` (CHECK migration, `shareVocabulary.test.ts`) |
| Undo (`undo.ts`) | unchanged locally; the undo is a write and travels as a `fact-update` whose `before` is the notice's `after` — so the original author can undo the undo across servers too |
| `deleteOwnCopy` | local only; the others get `entry-removed` (`reason: deleted`) |
| `detachTrip` (`detach.ts`) | on `leave`/`revoke`: keys and group cleared on the leaving side, copies stay |
| Booking totals | **not** sent in F-S4 (O6) |
| `SHARED_SOURCE` (`dataSource = "shared"`) | the same marker; the origin is on the membership, not the row |

## 6. Time model (ADR 0002)

Instants travel as ISO-8601 with `Z` and their stored IANA zone; local dates as `"YYYY-MM-DD"`
with their zone where the day belongs to a place; precision alongside. The wire schemas reject
an offset-less datetime (ADR 0002 D3). The receiver stores the zone as sent and never runs
`zoneOf` over it — a zone frozen on the sender is frozen on the copy (D2: "not re-derived on
read"). A missing zone stays missing: the receiver never fills it from its own, the user's
profile or the host zone. The receiver's tzdata may differ from the sender's; the instant is
the truth, so at worst a displayed wall clock differs by a political zone change one side has
not installed — stated, not hidden. The notice's change rows use the existing API time shapes
(`TimeValue`/`LocalDateValue`), as locally. Fact equality for the precondition (F6) compares the
stored instant + zone, never a rendered clock.

## 7. Failure paths — each with its own reason, shown to the user

Per CLAUDE.md "A failure must reach the user as itself": every remote member row in the trip's
"Reisende" section (`TripPeopleSection`) carries its state, and the person who made a change
sees where it did not arrive.

| Situation | Behaviour | What the user sees (DE / EN) |
|---|---|---|
| Peer unreachable / 5xx / timeout | retry with backoff 1 min, 5 min, 30 min, 2 h, 12 h, then every 24 h; after 14 days the member becomes `unreachable`, the queue is kept | „Änderungen kommen bei Ben nicht an — sein Server ist seit 12.10. nicht erreichbar." / "Changes are not reaching Ben — his server has been unreachable since 12 Oct." |
| Peer suspended by an admin, or its key re-pinned | members via that origin → `suspended`, nothing sent or accepted | „Der Server von Ben ist von deiner Instanz gesperrt." / "Ben's server is blocked by your instance." |
| Feature switched off on either side | other side receives 404 → `suspended` with reason `off` | „Teilen über Server ist bei Ben ausgeschaltet." |
| Schema rejection (`ack rejected: schema`) | the message is parked, not retried; the member stays `active` for other messages | „Bens Server konnte eine Änderung an ‚TP571' nicht annehmen (Format nicht unterstützt)." |
| Version unsupported (ping lacks `tripShare: [1]`) | no invite or offer is sent | „Bens Server ist zu alt für geteilte Reisen." |
| `gap` | resume from `expected`, no user message unless it repeats | — |
| Conflict | F6: nothing overwritten, a `conflict` notice on both sides | inbox card „Gleichzeitig geändert" / "Changed at the same time" |
| Revoked / left | sender stops at once, outbox rows for that member deleted; receiver detaches | `left` notice, as locally |

Error codes, enveloped family like `/sharing`: `SHARE_REMOTE_INVITE_INVALID`,
`SHARE_REMOTE_PEER_NOT_ADMITTED`, `SHARE_REMOTE_PEER_OUTDATED`, `SHARE_REMOTE_UNREACHABLE`,
`SHARE_REMOTE_DISABLED`, `SHARE_REMOTE_CONFLICT_STALE` (a conflict resolved against a value that
moved since). The frontend maps each to DE/EN copy; no server English reaches the UI.

## 8. Admin, user, restore

- **Admin** (Admin → Instanz): the existing identity and peer pins, plus F8's switch. Peer
  admission stays an admin act with fingerprint comparison out of band — no user-level
  trust-on-first-use (O7). The invite claim fails with `SHARE_REMOTE_PEER_NOT_ADMITTED` and
  names the origin, so the user can ask their admin.
- **User**: consent per remote person (F3), accept per trip (`offer-answer`), leave per trip,
  withdraw consent per person (detaches every group with them, as locally). Einstellungen →
  Reisen teilen lists remote persons with their server.
- **Restore**: `suspendTripFederationAfterRestore()` — every `TripShareRemoteMember` →
  `suspended`, every outbox row deleted, every open `TripShareInvite` consumed, remote
  `ShareConsent` rows back to `pending`. A restored clone therefore cannot resume talking to
  peers as this server; the owner re-confirms per group.

## 9. Threat model deltas vs 2026-10-10

The 2026-10-10 table (§8) stands. What trip sharing adds:

| A malicious or compromised peer could … | Control | Residual risk, stated openly |
|---|---|---|
| learn more than the facts of the shared trip | the sender projects through the fact lists **before** serialising, then validates with the strict wire schema; a column not in a fact list cannot be sent (whitelist, `facts/pick.ts`) | the facts themselves are precise movements: where and when two people travelled together |
| learn about other trips or users | a message names only `groupRef` + keys of that group; no lookup endpoint in F-S4a–e; invite codes, not handles | the roster shows display names and origins of all members (needed for consent) |
| inject false facts into members' copies | applies only to copies in a group it has an active member in; precondition + conflict; every change is a notice with undo; size and rate caps | a member (or their server) can lie about a shared flight, as a local member can; the copy counts in the recipient's statistics until undone |
| create entries in members' accounts (`entry-create`) | per-group daily cap; a notice per entry; the member can leave | a flood up to the cap appears before the member leaves; stats include them until deleted |
| replay or reorder old changes | nonce, time window, `messageId`, `seq`, revoke tombstone | — |
| keep sending after revocation | refused on arrival (`not-member`); the revoking side already stopped | data delivered before the revoke stays on the peer and cannot be recalled |
| mount a cross-protocol attack (comparison ↔ trip share) | envelope `purpose`, separate routes and schemas, separation test | — |
| read stored copies on its own disk | none — the receiving server must read facts to keep the trip (O1) | that server's operator can read them; this is the same trust as a local admin |
| impersonate one of its own users | — | as in 2026-10-10: a compromised peer speaks for all its users |
| exhaust this server | per-peer and per-group budgets, bounded `entries`, geometry cap, outbox per peer | a peer can use its budget |
| reach internal hosts | `publicAddress()` + pinned DNS answer, unchanged | egress rules need ongoing coverage |

New stored data: `RemoteShareAccount` (display names of foreign users), outbox payloads (facts
already in the database), inbound message ids. Logs carry kinds and ids, never facts or codes.

## 10. Reachability and LAN instances

An instance participates only when `loadIdentity()` succeeds (an `https` origin without port,
`contract.ts` `origin`) **and** the admin switch is on **and** at least one peer is verified by
a ping that reached it. Otherwise the route answers 404, the trip's "Teilen" menu shows no
remote entry, and the people section offers no invite code. A LAN-only instance keeps sharing
across servers through the `.travstats` file (S3) — the menu says so instead of drawing a
button that cannot work. There is no partially reachable mode: a server that can send but not
receive would queue forever and look broken.

## 11. The Companion

The Companion talks only to its own server (CLAUDE.md, "The server is the record"); it never
contacts a peer and never holds a key. A federated copy is an ordinary trip on the companion's
own server, so the Companion sees it through the sync feed like any trip — no Companion change
is needed for F-S4a–e. It does not call `/sharing` today (rework §8, checked 2026-10-16); when
it gains the inbox, a notice's `remoteActor` is a display name and an origin, and undo/conflict
answers go to its own server, which propagates them. Opening an invite link on the phone is a
deep link into the Companion that hands the code to its own server (later; F-S4f).

## 12. Rollout phases

Each phase lands behind the beta key and F8's switch, with its tests; each is releasable.

| Phase | Deliverable | Tests that must fail without it |
|---|---|---|
| **F-S4a** transport | `exchange()` parametrised; envelope v2 with `purpose`; neutral `PeerRefusal`; `routes/tripSharePeer.ts` with `ping` only; switch + beta key; 404 when off | envelope vectors; a comparison-signed packet refused by the trip route and vice versa; comparison suites unchanged; separation test; 404 off; odd-zone runs |
| **F-S4b** people | `TripShareInvite`, `RemoteShareAccount`, `ShareConsent` remote half + CHECK; `invite-claim`; settings UI | single use, expiry, wrong tag (leaderboard code refused), unadmitted origin named, restore consumes invites; `members.ts` truth table for mixed consents |
| **F-S4c** copy | `offer` / `offer-answer` / `entries`; natural-key resolution; `copyInto` from wire rows; `TripShareRemoteMember`; people section shows remote members | per entity: wire keys ⊆ fact list ∪ refs (inventory test against `facts/*`); a private field added to a row never appears on the wire; catalogue miss → unresolved port / null station; idempotent repeat; size caps |
| **F-S4d** propagation | outbox + scheduler; `fact-update`, `entry-create`, `entry-removed`; precondition + `conflict` notice; undo across servers; failure states in the UI | two-instance test: concurrent edit → conflict on both, nothing swapped; undo of undo; offline peer → backoff → `unreachable` shown; schema rejection parked with its reason; a failure path test per row of §7 asserting what the user sees |
| **F-S4e** lifecycle | `leave`, `revoke`, `roster`, `add-request`, peer suspend / re-pin, `suspendTripFederationAfterRestore` | no message after revoke (both directions); re-pin suspends; restore clone sends nothing; three servers: a spoke's newcomer reaches a member only after that member's consent |
| **F-S4f** later | handles `name@instance` with lookup, Companion deep link, booking totals if O6 says yes | enumeration: uniform answers, rate limit |

Migrations are created with `prisma migrate dev --create-only`; the CHECKs are hand-added as in
`share_vocabulary_checks`, and `check:drift` stays green. OpenAPI: the user-facing endpoints
(`/sharing/remote/*`) enter the spec with schemas; the peer route is documented like
`comparison-peer`. DE and EN copy land together.

## 13. Owner decisions

**Decided 2026-10-20.** O1 by the owner, verbatim answer „ja und umsetzen" to the recommendation
below, with this wording: *private fields never travel; the facts of a shared trip travel
Ed25519-signed over TLS to the co-traveller's chosen server.* This narrows the 2026-10-16 ruling
("full records never travel unencrypted"): that ruling guards full records including the private
half, and that half still never travels here; complete records keep going only through
`/encrypted-share`. O2–O10 follow the recommendations below as **working assumptions** for the
build on `dev/federated-trip-sharing`; any of them can be overturned by the owner, and the
affected phase changes then.


| # | Question | Recommendation |
|---|---|---|
| O1 | The 2026-10-16 ruling says "Full records never travel unencrypted." Trip facts ARE records, and E2E cannot apply: the receiving server must read them to keep the trip in the account (G1). May facts of an accepted shared trip travel Ed25519-signed over TLS, not E2E, as leaderboard totals do? | **Yes**, for the fact lists only; private fields still never travel at all. Without this ruling F-S4 cannot be built. |
| O2 | Addressing: handle or invitation link? | **Invitation code/link first** (F1), handles in F-S4f. |
| O3 | S4 after the local S1/S2 (and the 2026-10-16 rework) are merged? | **Yes** — F-S4 reuses the registry, `copyInto`, `members.ts` and the vocabulary CHECKs; building it on the pre-rework shape would double the work. |
| O4 | Conflict rule across servers: precondition + `conflict` notice instead of local LWW? | **Yes** (F6); locally LWW stays. |
| O5 | Share keys may travel to peers of the group (amends the S2 rule)? | **Yes**, peer-only, group-scoped (F4); clients never see them. |
| O6 | Show other members' booking totals across servers? | **No** in F-S4: a price is the closest thing to a private field; revisit on request. |
| O7 | Peer admission stays an admin act (no user trust-on-first-use)? | **Yes** — a user cannot admit a server for the whole instance. |
| O8 | Topology: home server relays (hub) or full mesh? | **Hub** (F5): one admission per spoke, one order per group. |
| O9 | A re-pinned peer key: suspend memberships until each user re-confirms, or end them? | **Suspend** and ask the user per group; the copies are theirs either way. |
| O10 | Beta key `federatedTripSharing` although local sharing has none? | **Yes** — it needs an RC look across two real servers first. |

Open beyond these: the exact budgets of §4 and the 14-day `unreachable` threshold are
proposals for review, not measurements; whether a spoke member may propose (not perform) onward
shares in F-S4e or only in a later phase; and how the leaderboard should label totals that
include federated copies (they are the user's own rows by decision 1, so they count — no
separation rule is touched, since nothing crosses through the comparison wire).

## 14. As built — F-S4a / F-S4b (2026-10-20, `dev/federated-trip-sharing`)

Both phases are built as §12 lists them. What the build decided where the spec left room, and
where it deviates:

**Transport (F-S4a).**
- The envelope moved to `services/federation/envelope.ts` (protocol-neutral: it imports no
  body schema); `contract.ts` re-exports `origin` / `signedEnvelope` for the comparison side.
  Version 2 is `{ v: 2, purpose, origin, destination, nonce, time, body, signature }`; the signed
  bytes are built field by field (`signingBytes`), version 1's byte-for-byte as before. Vectors:
  `services/federation/__tests__/envelope.vectors.json` (RFC 8032 test-1 key).
- **The comparison protocol still SENDS version 1** in this release. A server one release behind
  refuses an envelope with unknown fields (strict schema), and the cross-purpose guard does not
  need it: the trip route refuses every version-1 envelope. The comparison route reads v1 and v2
  `comparison/1` and answers in the version it was asked in. Next release: comparison sends v2;
  the release after drops v1.
- `exchange(origin, body, transport)` takes a `PeerTransport` (`path`, `maxRequest`, `maxReply`,
  `sendPurpose`, `accepts`, `beforeVerification`); `COMPARISON_TRANSPORT` is today's values.
  Its failures are now named kinds (`remote-absent` for a 404, `remote-refused`, `unreachable`,
  `private-address`, `unknown-peer`, `unverified-peer`, `packet-too-large`), which is how a
  claim tells "switched off there" from "does not answer". `PeerRefusal` says "Peer request
  refused"; the one comparison assertion on the old text was updated.
- The server-side gate is three conditions (`availability.ts`): the beta switch (like
  `calendarFeed`, because a peer keeps sending after the page is hidden), the admin's
  `tripFederationEnabled`, and an identity that loads. Off → the route's plain 404 before any
  limiter or parser. The admin switch is `PUT /admin/federation/trip-sharing`, its own endpoint
  so it works while `FEDERATION_*` env vars hold the identity.
- Trip messages discriminate on `kind`, comparison packets on `action`; both have a `ping`, so
  "disjoint action literals" is enforced as: the trip schema has no `action` key at all, and no
  packet of one protocol parses as the other (`separation.test.ts`).
- Peer route budget: 8 KB body (control messages only), 600 requests/min per sending address.

**People (F-S4b).**
- **`RemoteShareAccount` is a pairing**, not a free-standing person: it carries `userId` (the
  local side, cascade) and `localChannel` beside `channel`. Each server mints the channel for
  its own user (`invite-claim.channel` / `invite-claim-reply.channel`); A's `channel` is B's
  `localChannel` and vice versa. A second local user pairing with the same remote person gets a
  second row. This lets a later message name "Anna in this pairing" without any account id.
- Claiming IS both yeses: the home stores `requester = issuer → remoteTarget = claimant`,
  the claimant's server `remoteRequester = issuer → target = claimant`, both `accepted`.
  `share_consents_party_check` also forbids a remote↔remote row: such a consent is not this
  server's to hold. Local endpoints (`/sharing/consents`, companion links, trip people) read
  local pairs only; withdrawing a remote consent arrives with F-S4e's `revoke`.
- `members.ts` is generalised to `Party = user | remote` (`acceptedParties`,
  `withdrawnParties`); `acceptedWith` / `withdrawnTowards` keep their signatures and answers.
- The claim reply names why a code was not redeemed (`unknown | used | expired | duplicate`):
  the secret is 256 bits, so this tells the holder nothing about other codes, and §7 wants each
  failure as itself. A duplicate pairing is refused before the code is spent. A withdrawn code
  reads as `unknown`.
- Error codes beyond §7's list: `SHARE_REMOTE_INVITE_WRONG_TAG`, `_USED`, `_EXPIRED`,
  `_OWN_SERVER`, `_LIMIT` (20 open), `_NOT_FOUND`, `SHARE_REMOTE_DUPLICATE`,
  `SHARE_REMOTE_PEER_DISABLED` (a 404 there: off, or too old to have the route — the two are
  indistinguishable from outside). `SHARE_REMOTE_PEER_NOT_ADMITTED` and the peer codes carry the
  origin beside `code`, so the screen names the server.
- F-S4b invitations are person-level (Einstellungen → Reisen teilen); `federatedRef` is always
  `null` in the reply. An invitation from a trip page belongs to F-S4c.
- `GET /sharing/remote/status` answers while off (so the section draws nothing instead of a
  failing button); every other `/sharing/remote/*` endpoint refuses with
  `SHARE_REMOTE_DISABLED` (404). Issue and claim share a 30/h per-user limit.
- `suspendTripFederationAfterRestore()` exists now (open invitations consumed, remote consents
  back to `pending`) and runs in the restore aftermath; F-S4c–e add members and outbox to it.
- The 2.7.0 announcement's beta item names the feature (the `whatsNew` guard requires every
  beta key there).

**Tests.** Two servers run in one process (`twoServers.test.ts`): B gets its own module graph
and database (`peerDatabase.ts`, `<db>b_test` from `template_postgis`), but shares the generated
Prisma client — loading it twice breaks its WebAssembly query compiler. They talk over real TLS
through the production `exchange()`; only the socket and the DNS answer are redirected.

**What F-S4c builds on.** `tripSharePacket` gains `offer` / `offer-answer` / `entries` with
`groupRef` + `seq` in the header and a per-kind body budget (the route's 8 KB and the
transport's 16 KB request are control-message sizes); `receivingRemotes()` calls
`acceptedParties` with remote parties; `TripShareGroup.federatedRef/homeOrigin` and
`TripShareRemoteMember` hang off the pairing rows; a trip-page invitation fills `federatedRef`.
