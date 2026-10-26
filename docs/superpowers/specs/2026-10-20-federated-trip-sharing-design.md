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

Every "today" below was read on `main` at `5aacc4ca4`, before anything was built; phases F-S4a
to F-S4e are built since, see §14.

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

### As built — F-S4c (2026-10-20, `dev/federated-trip-sharing`)

Built as §12's row lists it: `offer` / `offer-answer` / `entries`, natural-key resolution,
`copyInto` from wire rows, `TripShareRemoteMember`, the trip page's people on other servers. What
the build decided where the spec left room, and where it deviates:

**Wire.**
- An entry is `{ entity, shareKey, facts }` (`services/sharing/federation/wire/shapes.ts`). The
  references stand inline in `facts` where the catalogue id stood (`ship`, `departurePort`,
  `depStation`, `pickupAirport`, a stop's `port`, a leg's `fromPort`/`toPort`, a house's `chain`,
  a timeline stop's `sourceRef`/`lodgingStayRef` as `{ entity, shareKey }`); there is no separate
  `refs` key and no `zones` — the zones are facts already, and the receiver's adapter reads them
  off its own copy. Each shape is typed `Record<field, Codec>` against its fact list, so a new fact
  is a compile error until it is given a wire form; `wireShapes.test.ts` holds the same inventory
  at run time against `ADAPTERS[e].fields`, and every shape is a strict object, so a key outside it
  is refused on arrival.
- The shared public half (`services/trip/exchange/publicHalf.ts`) is the port and ship references
  and the position and zone validators; `format.ts` now reads them from there. Station and airport
  references are wire-only: the file's station carries its own name, code and zone, the wire's
  only the keys to match (`sourceId`, `uic`; `icao`, `iata`) beside name and position, because the
  rest are rail and rental facts already.
- Time: instants `Z` only (an offset or a missing designator is refused), days `YYYY-MM-DD`, read
  back as the stored `@db.Date`. A line over 5 000 points travels as `null`.
- Status: only a state no clock can produce survives (`FLIGHT_PASSTHROUGH` …: cancelled,
  historical, duplicated); anything else starts as `scheduled` and `copyInto`'s `DERIVE` decides.
- Catalogue misses: an unmatched cruise departure/arrival port is a null id (the cruise has no
  name column for it), an unmatched ship keeps its name as `shipNameOverride`, a leg into a port
  the receiver lacks is left out; stations fall back from source id to UIC, airports from ICAO to
  IATA, an open airport before a closed one. A sender's user-added catalogue row goes with its
  natural key nulled.

**Messages and order.**
- `seq` lives on `TripSharePeerStream (groupId, peerOrigin, lastSentSeq, lastReceivedSeq)`, not on
  the member row: §4 numbers per (sending origin, group), and two people on one peer share one
  stream. The receiver takes the stream's next seq inside the message's own transaction
  (`streams.ts` `takeSeq`), so a message applies wholly or not at all; a gap answers
  `{ rejected: "gap", expected }` and writes nothing. A sender advances `lastSentSeq` only on the
  ack and resends once at `expected`.
- `TripShareInbound` is keyed `(peerOrigin, messageId)` — a peer cannot make this server read
  another peer's id as a repeat — and keeps acks only: a rejection is not remembered, because what
  it would be answered can change once a gap is filled. Pruned at 30 days on every insert.
- Answers are `ack { received }` or `ack { rejected: gap | not-member | consent | schema,
  expected?, field? }`, under signature. A group message whose header parses but whose body does
  not is answered `schema` with the first failing path; anything less is the uniform 403.
- Budgets: nothing over 1 MB is read at all; after the signature each kind has its own
  (`transport.ts` `BODY_BUDGET`: control 8 KB, **offer 32 KB** — the trip's facts and roster can
  outgrow 8 KB — entries 1 MB and ≤ 50 entries). Three transports carry them (control with a 64 KB
  reply, offer, entries). More than 500 entries refuses the offer (`SHARE_REMOTE_TRIP_TOO_LARGE`);
  a single entry too large for any message is skipped and recorded as `entries-too-large`.

**Offer and answer.**
- `offer` names the offering member's pairing channel (`from`) and the person's (`to`); the
  receiver resolves it to a pairing by `(origin, channel, localChannel)` and refuses one whose
  consent is not accepted. Offering again re-asks an invited or declined person (and heals an
  offer lost on the way); an active one is `SHARE_REMOTE_ALREADY_MEMBER`.
- The offer is kept in wire form on the receiving member row (`offer`) until answered. State
  vocabulary gained **`declined`** (CHECK + `REMOTE_MEMBER_STATES`), so a refusal does not read as
  a member who left.
- **Accept creates the person's trip before the answer leaves**, so entries the home sends right
  after its ack always find it. If the answer does not arrive, the trip is taken back unless an
  entry already reached it (which proves the home had the answer); the undo takes the stream row
  lock `serveEntries` takes first, so the two never interleave. Decline is told first and recorded
  only once the home has it.
- **A trip page's invitation carries its offer inside `invite-claim-reply`** (`offer`, beside
  `federatedRef`): the claimant's server records the pairing and then the offer, so no offer can
  reach a server before the pairing it is addressed to exists. A trip that can no longer be offered
  leaves the pairing standing without one.
- Only the home offers (`SHARE_REMOTE_NOT_HOME` on a trip that came from elsewhere, naming it).
- The receiver copies into the trip of the person paired through `from` — per pairing, not to
  every member on that server. `receivingRemotes()` reaches people only through the actor's own
  pairing, with an accepted consent (`acceptedParties`).
- New codes: `SHARE_REMOTE_CONSENT_MISSING`, `_NOT_HOME`, `_ALREADY_MEMBER`, `_TRIP_TOO_LARGE`,
  `_PERSON_NOT_FOUND`, `_OFFER_NOT_FOUND`, `_REFUSED` (`extra.reason` = the peer's rejection).

**Delivery (the part F-S4d replaces).** No outbox yet: once an accept is committed, the home sends
the entries directly in the background (`entries.ts` `deliverEntries`, tracked by `trackDelivery`;
tests and a shutdown can `settleDeliveries()`). A failure is recorded on the member as
`stateReason` (`entries-undelivered`, `entries-refused`, `entries-too-large`) and shown on the trip
page; a repeated accept, or calling `deliverEntries` again, resends everything and the receiver
keeps only what it lacks (`heldKeys`).

**Elsewhere.** A restore suspends every invited/active/unreachable membership (`stateReason:
restore`). `detachTrip` no longer deletes a group that has remote members — the rows are the
tombstones a later message is refused against — and a leave is not yet told to the other server
(F-S4e). No `ShareNotice` is written when a trip arrives: the person accepted it on the spot, and
`remoteActorId` arrives with F-S4d. The user endpoints that contact another server share the
30/h limit of the invitation endpoints. Booking totals are not sent (O6).

**Tests.** `wireShapes` (inventory per entity and nested, a private column on a real row never on
the wire, offsets refused, geometry cap, status), `wireResolve` (each catalogue hit and miss),
`streams` (repeat, gap, chunking), the route's budgets and `schema`/`not-member` acks, `offers`
(each refusal, the trip-page invitation's offer, `receivingRemotes`, restore), and
`twoServersCopy` — over real TLS a trip with a flight, a stay, a rail ride and a cruise with five
port calls is offered, accepted and lands on B as the recipient's own trip with A's instants and
zones, B's catalogue ids and statuses, unmatched and user-added ports unresolved, and none of seven
private values in any message B received; decline copies nothing; an offer to a switched-off
server leaves no member and no group behind. The two-server harness moved to
`twoServerHarness.ts`.

**What F-S4d needs from this.**
- Replace `sendOnStream`'s direct send and `trackDelivery` with `TripShareOutbox`, keeping the
  stream numbering (advance on ack; one seq space per group and peer) and the `takeSeq`-first
  order on the receiving side that the accept undo relies on. `deliverEntries`' `stateReason`
  values become the retry/backoff states of §7 (`unreachable` after 14 days).
- `fact-update`, `entry-create`, `entry-removed` join `tripSharePacket` and `BODY_BUDGET` (256 KB);
  `entry-create` reuses `wireEntrySchema` → `fromWireEntries` → `copyInto`; `fact-update` encodes
  `before`/`after` with the same codecs (`ENTRY_SHAPES[e][field]`), and the precondition compares
  decoded values — for a reference, its natural key, never the two servers' ids.
- `propagateWrite(s)` calls `receivingRemotes(groupId, actorId)` and writes one outbox row per peer
  origin inside the write's transaction; the home relays incoming changes to its other spokes.
  Incoming changes find copies by `(origin, groupRef)` → group, then `copiesOf(shareKey, groupId)`,
  inside `propagationGuard`.
- `ShareNotice.remoteActorId` (and the `conflict` kind, CHECK migration) — then the arriving trip
  and each received change get their notices, naming „Ben (origin)".
- A person on a spoke who shares the received trip on locally is a local member there whom the
  home does not reach: the roster and `add-request` (F-S4e) decide that, nothing here does.

### As built — F-S4d (2026-10-20, `dev/federated-trip-sharing`)

Built as §12's row lists it: outbox and scheduler, `fact-update` / `entry-create` /
`entry-removed`, the precondition with `conflict` notices on both sides, undo across servers, the
delivery state on the trip page, a notice when a trip arrives. What the build decided, and where it
deviates:

**Outbox.**
- `TripShareOutbox { id = messageId, position (serial), groupId, memberId, peerOrigin, kind,
  payload, label, attempts, nextAttemptAt, failingSince, lastError, parkedAt, parkedReason }`,
  written in the transaction of the local write (`federation/outbound.ts`, called from
  `propagate.ts`); `outbox.test.ts` holds "a row iff the write committed". CHECKs: kind
  (`OUTBOX_KINDS`, in `shareVocabulary.test.ts`), attempts ≥ 0.
- **One row per remote member, not per server** (deviation from §5). A message names one pairing
  (`from` / `to`), and the receiver copies into that person's trip only (F-S4c's rule); two
  people on one server share the server's stream, so they still arrive in order.
- The seq is taken at SEND time from `TripSharePeerStream.lastSentSeq` (through F-S4c's
  `sendOnStream`, which now returns the ack), not at queue time: a parked message must not leave a
  hole the receiver would answer `gap` forever. The row id is the message id on every attempt, so
  a lost ack is answered from the receiver's inbound table.
- `jobs/tripShareDeliveryScheduler.ts`: a pass every 30 s and one second after a queue (debounced
  nudge, `deliveryKick.ts`); passes are serial in-process. Off locally → the rows wait.
- Before each send the member must still be queueable (active, unreachable, or suspended as `off`
  / `peer-blocked`) and the consent accepted; otherwise the row is deleted (`dropped`).
- Outcomes: ack → row deleted, members of that stream back to `active`; transport failure →
  backoff 1 min, 5 min, 30 min, 2 h, 12 h, then daily, the stream waits behind its head; 14 days
  after the first failure → `unreachable` (`stateSince` = first failure); 404 → `suspended`/`off`;
  a disabled pin here → `suspended`/`peer-blocked`; both recover on the next delivered message
  (deviation: §7 says nothing is sent while suspended — this keeps retrying at backoff, the only
  way to notice the switch is back on; F-S4e's re-pin may want a stop). `schema` / `not-member` /
  `consent` → parked with the reason (and field), not retried, kept 30 days for the trip page.
- F-S4c's direct entries send is gone: `serveOfferAnswer` queues the entries in its own
  transaction (`queueEntries`). `settleDeliveries()` is now a delivery pass.
- A restore deletes every outbox row.

**Messages.**
- `fact-update { from, to, actor, entity, shareKey, changes: [{ field, before, after }] }`, each
  value in its field's wire form, checked against `ENTRY_SHAPES[entity][field]` by the schema
  (≤ 100 changes, 256 KB). A geometry that would not fit is dropped from the change (logged).
- `entry-create { …, entry }` (one wire entry, 256 KB); `entry-removed { …, entity, shareKey,
  reason }` (notice only, 8 KB). `PROPAGATION_TRANSPORT` has a 256 KB reply: the ack can carry
  `conflicts: [{ field, held }]`.
- **Precondition.** The receiver decodes `before` and `after` against ITS catalogue
  (`fromWireFacts`, the same resolver that made the copy), so a reference is compared by its
  natural key and the two servers' ids never meet. Per fact: copy = after → settled (open
  conflict notices on it close); copy = before → written; otherwise a conflict. `status` is
  advisory and skips the precondition: only whether it is a clock-free state crosses, then
  `DERIVE`. Facts written also close open conflicts on them (the other side decided).
- **Conflict**: nothing written for those facts; a `conflict` notice for the receiver (mine /
  theirs) and the held values in the ack → the sender's person gets one too (one open notice per
  entry and facts, never two). `POST /sharing/notices/:id/resolve { choice: theirs | mine }`:
  theirs writes the other value and propagates (the other side already holds it and settles);
  mine re-sends the own value with the other one as `before`. A copy that moved since →
  `SHARE_REMOTE_CONFLICT_STALE` naming the fields.
- **Undo across servers** needed nothing new: an undo is a write, so it travels as a
  `fact-update` whose `before` is the notice's `after`; undo of undo works the same way.

**Hub relay and authorship.**
- A received change is applied under the propagation guard, then spread explicitly
  (`spreadUpdate` / `spreadCreate` / `spreadRemoval`, extracted from `propagate.ts`): to local
  members through the recipient's consents (LWW locally, as ever), and to remote members through
  the pairings of the recipient and of every local member it reached — never to the origin it
  came from. With two test servers the "on to another spoke" leg is exercised only as "nothing
  goes back".
- Notices carry `remoteActorId` (FK SetNull, CHECK `share_notices_actor_check`: at most one
  actor) and the name in `after.remoteActor`; the inbox shows „Ben (origin)".
- **Security fix (coordinator review):** the wire `actor` is a CLAIM. It is honoured only from
  the group's home and only for an origin known here as a remote member of the group; otherwise
  the author is the sending pairing under its own name. A relayed author carries `via`. The actor
  origin must be canonical (`envelope.ts` `origin`, `local` refused) or the message is `schema`.
  Consequence today: a spoke knows only the home's origin, so a third server's author is shown as
  the home's pairing until F-S4e's roster tells the spoke who the members are.
- A `shared` notice is written when a person accepts an offered trip (it arrives then), naming
  the offering member and server.

**UI.** The trip page shows each remote member's delivery as its own sentence (delivered, on the
way, retrying since, unreachable since, refused with entry and reason, off there, blocked here,
entry too large). Conflict card with both values. The buttons read „Den anderen Wert übernehmen" /
„Meinen Wert behalten": the spec's „Ihre übernehmen" fails the informal-address guard.

**§7 rows covered by tests** (`twoServersPropagation.test.ts`): unreachable (backoff timing, 14
days, recovery), blocked by admin, switched off there (and back), schema rejection parked (and the
next message still goes), gap resumed silently, conflict on both sides; version unsupported is
F-S4b's `claim.test.ts`; revoked/left is F-S4e. Also order across retries, a dropped message after
a withdrawn consent, rollback, natural-key references.

**What F-S4e needs from this.**
- `leave` / `revoke`: on the sending side delete the member's outbox rows and stop (today a
  non-queueable member's rows are only dropped at the next send); on the receiving side detach and
  refuse (`not-member` is already answered for a member not `active`/`unreachable`/`off`).
- `roster`: the spoke's list of members with origins — `authorOf` (inbound.ts) must read relayed
  authors' origins from it; today only the home's origin is known on a spoke. Also the consent
  gate "a newcomer's writes reach a member only after that member's consent" is NOT applied to
  relays yet: the home relays through its members' pairings without asking the receiving person.
- `add-request`: nothing here; offers stay home-only.
- Peer suspend / re-pin: decide whether a `peer-blocked` / re-pinned stream stops retrying (O9:
  suspend per group until the user re-confirms) — today it retries and recovers on success.
- Restore safety: outbox rows deleted and members suspended (`restore`); a re-confirmation path
  must flip `restore` members back and should re-queue a full `entries` resync, because changes
  made while suspended were never queued.
- Parked messages are kept 30 days and shown; there is no "dismiss" yet.

**Review fixes (cold review of F-S4d, same day).** The stream's seq advance and the outbox's
bookkeeping commit in one transaction (`sendOnStream`'s `onAck`), and an ack for an earlier seq
is the peer's remembered answer to the same message id, not a malformed one. The receiver locks
the copy's row (`FOR UPDATE` on its registry table) from the precondition to the write. A
reference that leaves a name on the copy — only the cruise's ship, `shipNameOverride` — is
compared by what it names, not by an id two catalogue misses share (`refIdentity.ts`). Sizes are
UTF-8 bytes as the envelope carries them (`wireBytes`), and a message that can never fit is
parked as `too-large` instead of retried. Tests: `twoServersDeliveryRobustness.test.ts`.

**F-S4d leftovers, fixed with F-S4e (2026-10-21).** The receiver's lock now covers the rows a
change lands on, not only the entry's own: a cruise's `cruise_stops` and `cruise_legs`, a stay's
`lodgings` row (`rowLock.ts` `lockCopy`, parent first; `twoServersChildRowLock.test.ts`). And an
error of one of the two servers is no longer read as a silent peer: `kindOf` names anything that
is not a `PeerRefusal` or a malformed answer `local-error` (`exchange()` turns a failed DNS lookup
into `unreachable` first), and the peer route answers a group message it failed to apply with a
signed `ack { rejected: "error" }`, retried by the sender as `remote-error`. Both are retried at
the usual backoff but never turn a member `unreachable`, and the trip page says which server erred
(`twoServersLocalErrors.test.ts`). A local error in a person's own claim or offer is passed on as
itself (a 500), not as `SHARE_REMOTE_UNREACHABLE`.

### As built — F-S4e (2026-10-21, `dev/federated-trip-sharing`)

Built as §12's row lists it: `leave`, `revoke`, `roster`, `add-request`, peer suspend and re-pin,
the restore path with its confirmation, plus dismissing a refused message. What the build decided
where the spec left room, and where it deviates:

**Wire.** Four group messages join `tripSharePacket`, each with `groupRef`/`seq` and the pairing's
`from`/`to`: `roster { self, you, members[≤100] }` (32 KB), `leave`, `revoke` (8 KB each) and
`add-request { person: { displayName, origin? }, note? }` (8 KB). `roster`, `leave` and `revoke`
leave through the outbox (`OUTBOX_KINDS`, CHECK widened); `add-request` is a person's click and is
sent directly, like `offer-answer`. A roster entry is `{ ref, displayName, origin }`; the offer
carries the same roster plus `self`/`you`. `changeActor` gains an optional `ref`. The ack gains
`suspended` — retried by the sender like `error`, never parked.

**Roster (`roster.ts`).**
- A person is named by a `ref` per group: random for a person on another server
  (`TripShareRemoteMember.rosterRef`), a SHA-256 of `federatedRef` and the account id, shaped as a
  UUID, for a member of the home's own server. Neither is an account id of either server.
- The home sends the roster to every spoke member whose messages queue, whenever someone joins
  (an accepted offer, a local share into a federated home group) or leaves (leave, revoke, a local
  member leaving), and once after a restore is confirmed. A spoke keeps it in
  `TripShareRosterEntry` (`present` false for someone no longer named, so an old notice keeps a
  name) and stores this pairing's own two refs (`rosterRef` = the home person, `localRef` = its
  own person). No version number: one stream per (group, peer) orders them, so the latest one
  received is true — a version would have broken after a restored home counts from an older
  number.
- **Authorship.** From a spoke the author is always the sending pairing (as in F-S4d). From the
  home, `actor.ref` names the author: the pairing itself if it is that pairing's ref, else the
  roster entry — name and origin read from the roster, never from the message. A ref the spoke
  does not know names nobody and the change is **not applied** (taken in order, acknowledged —
  the home did nothing a spoke can call wrong). A message without a ref is the home pairing's own
  word, as before; a home that leaves refs out could equally lie about the name, which the threat
  model already concedes (§9, "impersonate one of its own users").
- **Consent on relays (`mayReach`).** A change by a person on another server reaches a member's
  copy only through the member's own pairing with that person or after the member's yes on the
  roster (`TripShareRosterConsent`, `accepted | declined`, no row = not asked). The rule holds on
  every server that holds a copy: on a spoke for its person (in `servePropagation`), at the home
  for its own members (in the spreads of `propagate.ts`, `reachedHere`). Accepting an offer says
  yes to everyone the offer's roster named; anyone who joins later is `pending` on the trip page
  with "Zustimmen" / "Ablehnen". **What a member missed before the yes is not replayed** (as
  locally, `receivingMembers`): the newcomer's next change to the same fact meets the older value
  and becomes a conflict notice, not a silent overwrite.
- The trip page shows the roster for the reader (`tripRemoteSharing.roster`: `you`, `paired`,
  `here` for someone on the same server, `pending`, `accepted`, `declined`).

**Leave and revoke (`lifecycle.ts`).**
- `detachTrip` (leaving, deleting the trip, merging it away) calls `departLocally`: every
  membership through the leaving member's pairings ends `left`, its queued messages are deleted,
  and a `leave` row is queued — sent although the member no longer receives anything else
  (`stillReceives` lets `leave`/`revoke` through for a member in exactly that end state). The
  receiver ends its row, gives every member of the group there a `left` notice naming the person
  and server, and — at the home — sends the new roster. The copies stay (decision 5).
- `POST /sharing/remote/people/:id/withdraw` withdraws the consent of a pairing: every membership
  of it ends `revoked` in one transaction, its queue is deleted, and a `revoke` is queued per
  shared group. On the spoke's side the person's copy leaves its group (`detachTrip`) unless
  another of their pairings still carries it; at the home the others get the roster. The receiver
  of `revoke` does the same for the whole pairing (consent `withdrawn`, every membership
  `revoked`, the spoke detaches) and a `left` notice says `revoked`. Afterwards nothing queues for
  the pairing on either side, and a message sent anyway is refused (`not-member` / `consent`) —
  `twoServersLifecycle.test.ts` sends one on the old stream after each direction's revoke.
- A pairing with no shared trip has no group to carry a `revoke`: the other server learns of it
  from the refusal of its next offer or message. The pairing row stays (tombstone); a new code
  pairs the two again.
- The end of a membership is told only where a message could still go: one held by a restore, a
  blocked server or a new key is ended without a word, and that server learns it from the refusal
  of its next message.

**Held: suspend, re-pin, restore (O9).**
- Admin → Instanz: suspending a peer holds every membership through it as `peer-blocked`;
  pinning a different key holds them as `repinned` (`holdPeerMemberships`, called from
  `routes/admin/federation.ts`). Re-pinning the same key changes nothing. A send that meets an
  unknown or unverified pin holds the stream the same way (F-S4d's `peer-blocked`, which no longer
  recovers by itself).
- **Held means the stream stops**: the outbox does not send a held member's rows, counts no
  attempt, and keeps them (`repinned`, `peer-blocked` still queue); a message that arrives for a
  held membership is answered `suspended`, which its sender keeps and retries at the usual backoff
  (shown as "waiting for a confirmation there"). Deviation from F-S4d: only `off` and
  `unreachable` recover on their own now.
- A restore holds as `restore` (and an offer still open as `restore-invited`), deletes the outbox
  and puts remote consents back to `pending`, as before.
- `POST /sharing/remote/trips/:tripId/reconfirm` confirms the caller's held memberships of one
  trip: the server must be admitted and verified again (`SHARE_REMOTE_PEER_NOT_ADMITTED`
  otherwise), the pairing's consent goes from `pending` back to `accepted` (a withdrawn or
  declined one is `SHARE_REMOTE_CONSENT_MISSING`), the membership is `active` again (`invited` for
  `restore-invited`), and after a restore the home queues the trip's entries once more and its
  roster. The receiver keeps only the entries it lacks (`heldKeys`): an entry's facts that changed
  while held are not refreshed by the resend — the next change to them travels as usual, and a
  difference shows as a conflict. The trip page draws "Neu bestätigen" while anything of the
  caller's waits (`reconfirmable`).
- Deviation from §8 "re-confirms per group": a pairing whose consent a restore put back to
  `pending` but which shares no trip has no group to confirm; withdrawing it and pairing again
  with a new code is the way out.

**Add-request (`addRequest.ts`).** A spoke member asks from the trip page with a name, optionally
the person's server and a note (`POST …/trips/:tripId/add-requests`, the invitation limiter,
30/h). The home member of that pairing gets an inbox notice of the new kind `add-request` (CHECK
widened) linking to the trip, where they offer it to a paired person or make a code for the trip.
Nothing is offered by the request; the spoke learns nothing of the home's pairings. At the home
the endpoint answers `SHARE_REMOTE_IS_HOME`.

**Dismiss.** `DELETE …/trips/:tripId/members/:memberId/parked` deletes the parked messages towards
one member the caller's page shows; they are not sent again.

**Codes** beyond §7: `SHARE_REMOTE_NOTHING_TO_CONFIRM`, `SHARE_REMOTE_NOT_MEMBER`,
`SHARE_REMOTE_IS_HOME`, `SHARE_REMOTE_ROSTER_NOT_FOUND`; each has DE/EN copy.

**Tests.** `twoServersLifecycle.test.ts` (leave both ways; revoke both ways with a forged message
afterwards; re-pin holds, `suspended` answered and retried, confirmation resumes both ways; a
restored clone sends nothing and its confirmation resends the entries; confirmation needs an
admitted server; dismiss; add-request; local onward share refused; the home-side roster gate),
`threeServersRoster.test.ts` (A home, B and C admitted by A only: each spoke learns the roster;
Cleo's change reaches Ben only after his yes, and what he missed comes back as a conflict, not a
silent write; Ben's reaches Cleo at once, named by the roster with `via`; B and C never exchange
a message; an unknown ref is not applied; a leave updates the other spoke's roster), the admin
hooks in `routes/admin/__tests__/federation.test.ts`, the vocabulary CHECKs. The harness runs a
third server (`useThreeServers`, database `<db>c_test`).

**Review fixes (cold review of F-S4e, same day; one commit each, tests in
`twoServersReviewFs4e.test.ts` and `threeServersRoster.test.ts`).**
1. A restore's resend could copy an entry the spoke's person had declined on the roster (the
   relay withheld it, the resend did not). The home now records who brought each entry into a
   group (`TripShareEntryAuthor`, `entryAuthors.ts`) — only where it is provable: when a row gets
   its key on its owner's own trip (`assignShareKeys`, a new or moved-in entry in `spreadCreate`;
   a copy arrives keyed already) and when an entry from another server first spreads at the home;
   before a group is federated, as `local:<account>`, read as the roster ref later. Every
   `entries` message names each entry's recorded author (`authors`, required on the wire),
   unchanged even if they left the trip; the spoke copies an entry only when its author is the
   home member of the pairing, the recipient themselves, or someone they agreed to. **An entry
   with no record is named by nobody and copied for nobody** — fail closed (security review of
   the fixes: an earlier version inferred the offering member for unrecorded entries and renamed
   departed authors to them; both are gone).
2. A received message read its membership and consent unlocked, so a withdrawal committed between
   the check and the write was overtaken. The member row is locked (`FOR UPDATE`) when a message is
   resolved to it (`peerMember.ts` `addressed`): a concurrent end or hold waits for the message or
   is what it reads.
3. A delivery that passed its check and then waited for its turn on the stream (behind a person's
   own request to the same server) still left after a withdrawal had returned. `sendOnStream` takes
   a ready check that runs once the message holds the stream; the outbox asks there again.
4. Confirming a trip again could resurrect a membership that a leave ended meanwhile. The held rows
   are read again under their locks inside the write; only those still held, on a trip still in the
   group, resume.
5. A restored spoke's unanswered offer (`restore-invited`) disappeared from the list and had no way
   back. It is listed again; accepting it checks the server's admission and answers the consent the
   restore put back to a question.
6. Entries for a membership the spoke showed as `unreachable` or `off` were refused `not-member`
   and parked for good. They are taken for every membership that takes ordinary messages.
7. Two roster changes at once could queue the older snapshot last. `queueRoster` takes its snapshot
   under the group row's lock.

**Second review round (same day).** The locks of the fixes were ordered against each other:
the membership lock of a received message and the roster's group lock are `FOR NO KEY UPDATE`
(an outbox row naming the member only takes a key-share lock), `serveEntries` locks its
memberships like every other received message, `detachTrip` ends cross-server memberships before
it touches the entries (the order a received change takes them in), and `reconfirmTrip` answers
the consents before it locks the memberships (a withdrawal's order). Tests in
`twoServersReviewFs4e.test.ts` ("review round 2"); the confirm-versus-withdraw case passed before
its fix too and stays as a guard — the order there is by reasoning, not a reproduced deadlock.

**Owner decisions on the open questions (2026-10-21).** Each item keeps its text as it stood;
the outcome follows it.
1. **A received trip cannot be shared on locally on the spoke** (`shareTrip` answers
   `SHARE_REMOTE_NOT_HOME`): a member added there would receive the others' changes and send
   their own up under the spoke member's name, without anyone at the home agreeing. The way is the
   `add-request`. The F-S4d note left this to "roster and add-request"; refusing is the narrower
   reading.
   **Outcome: CONFIRMED as built.**
2. **A remote newcomer needs the yes of the home's own members too** (Dora on A, who shared
   Anna's trip locally before Ben joined), not only of the spokes — the local rule that a newcomer
   needs every member's consent (`missingGroupConsent`), applied to remote newcomers at join time
   by asking instead of refusing.
   **Outcome: CONFIRMED.**
3. **Blocking a peer holds its memberships until each person confirms again**, like a re-pin
   (O9 names only the re-pin); unblocking alone does not resume them.
   **Outcome: CONFIRMED.**
4. Changes withheld before a roster yes are not replayed (above). A replay on yes would need a
   resync request from spoke to home, a message §4 does not have.
   **Outcome: BUILD NOW, before rc.19** — the `resync` request below.
5. A spoke that was restored resumes on confirmation but sends nothing it missed: the spoke has no
   message to push its entries to the home (`entries` is home → spoke only). Only a restored home
   resends.
   **Outcome: BUILD NOW, before rc.19** — the same `resync`, and `entries-up` below.
6. A held membership on the other side is retried at the outbox backoff (up to a day): after that
   person confirms, their server can take up to a day to receive what was queued here. A nudge
   message would close that gap; it is not in §4.
   **Outcome: BUILD NOW, before rc.19** — the `nudge` below.
7. **The entry-author gate also applies to the first delivery.** Accepting an offer says yes to
   the people its roster named; an entry brought in by someone not on that roster (who left before
   the offer, or joined after it without the person's yes), or one keyed before authors were
   recorded at all, is not copied. Correct for consent, a loss for the copy; the alternative —
   treating the accepted offer as a yes to everything it contained — would need the offer to list
   those authors so the person sees them. An entry with no recorded author is a loss the home
   knows of: the member carries `entries-unattributed` and the trip page says so (rc.19 review).
   No author is inferred for it — a keyed row on the owner's trip may be a copy of someone else's.
   **Outcome: CONFIRMED.**

### Catch-up, push-up and nudge — Q4, Q5, Q6 (2026-10-21, `feat/federation-resync`)

Design, decided before the build; what the build changed is noted in place.

**Wire.** Three messages join §4, and two answers:

| kind | from → to | carries | budget |
|---|---|---|---|
| `resync` | spoke → home | group message, pairing `from`/`to`, `accepted: ref[] ≤ 100` — the roster refs the spoke's person said yes to | 8 KB |
| `entries-up` | spoke → home | group message, pairing `from`/`to`, ≤ 50 entries the spoke's own person brought in | 1 MB |
| `nudge` | either | control message (no group, no seq), pairing `from`/`to` | 8 KB |

`entries` gains `resync: true` (only in an answer to a `resync`, so only towards a server that
asked). `ack` gains the rejection `unsupported`: a group message whose `kind` this server does not
know is answered with it under signature (from rc.19 on). **An older peer (rc.18) does not know
any of this** and answers an unknown kind with the uniform 403. So the ping answer gains
`features: ["resync", "entries-up", "nudge"]` (the ping reply schema is open; rc.18 answers
without it), and a server asks before it sends one of these: the outbox pings (cached ten minutes)
before a `resync` or `entries-up` leaves, and a peer without the feature parks the message as
`unsupported` — kept, shown on the trip page as "the other server needs an update", not retried,
never read as delivered. A `nudge` to a peer without the feature is simply not sent.

**Q4 — catch-up after a roster yes (`resync`).** When a spoke's person says yes to someone on the
roster, the spoke queues a `resync` per membership of that person in the group (outbox, so an
unreachable home is retried). The home answers by queueing the current state of the trip's entries
for that member — filtered to entries whose recorded author is the home member of the pairing, the
person themselves, or someone in `accepted`: an entry by someone the person has not agreed to
never leaves the home on a resync (normal delivery sends all and lets the spoke decide; a resync
narrows it). The spoke still applies the entry-author gate exactly as for `entries`. An answer
still waiting in the home's outbox is replaced by the newer one (it may name a newer yes), so a
remote peer cannot make the home queue the trip more than once per member; on the spoke a request
is not queued again while a waiting one already names every yes. A resync from a member the home
shows `unreachable` or switched `off` is answered like any message that member may send. On the spoke, per entry of a `resync: true`
message:
- **missing** → copied (author gate), with a `created` notice naming the author from the roster;
- **held, identical** (every fact but the advisory `status`) → nothing written; open conflict
  notices on those facts close;
- **held, different** → never silently overwritten. The spoke records every change it withheld
  (`TripShareWithheld`: group, person, entry, fact, the author's ref, and the value the copy held
  when it was withheld — recorded only where the copy then still held the change's `before`, so
  only a provable transition is kept, read under the copy's row lock). A fact whose difference is
  exactly a withheld change by someone now agreed to — the copy still holds the value recorded —
  is written, with an `updated` notice naming that author. A fact withheld from someone still not agreed to stays as it is. Any other
  difference (an own edit, a value lost by a restore, a joined own entry) becomes a `conflict`
  notice with both values; a second resync does not add a second one (`recordConflict`). An entry
  with a change of the spoke's own still in its outbox towards the home is left alone: that change
  is on its way and settles there.

Idempotent: a repeated resync copies nothing twice (`heldKeys`) and finds identical facts
identical.

**Q5 — a restored spoke.** Confirming the trip again on a restored spoke (`reconfirmTrip`,
`stateReason` `restore`, a group whose home is elsewhere) queues (1) the same `resync`, and (2)
`entries-up` with the entries the spoke's own person brought into the group. For that the spoke
now records authorship too (`TripShareEntryAuthor`, `local:<account>`, only for its own people:
`recordEntryAuthor` on a spoke group). The home takes an `entries-up` exactly like an
`entry-create` from that spoke — the sending pairing is the author whatever the entry says, the
membership must receive and the consent hold, the seq is taken — and copies an entry only if it
**never knew it**: no copy held and no author record in the group. An entry the home knew and
removed (deleted, moved out) is not brought back. A copied entry spreads on at the home as any
received one (roster gate, relays). Nothing is overwritten at the home: an entry it holds is left
as it is. An own entry too large for any message is not sent and the membership carries
`entries-too-large`, which the trip page names.

What remains (stated, not built): a fact the spoke's person changed on an entry the home already
holds, while the restore held the membership, is not pushed — the spoke cannot tell its own
change from a value it missed without a base value; the next change to that fact travels as
usual, and a difference shows as a conflict. A restored HOME still only resends (spokes do not
push to it). Entries a spoke's person brought in before spokes recorded authorship are not pushed.

**Q6 — `nudge`.** After a person confirms a trip again (`reconfirmTrip`, any held reason — a
restore, an unblock, a re-pin), their server sends each paired peer of the confirmed memberships a
signed `nudge` naming the pairing, after the commit, best effort (a failure is logged, never shown
as an error of the confirmation). The peer moves every waiting outbox row of the streams that
pairing's memberships use to "due now" and runs a delivery pass, instead of waiting for the
backoff (up to a day). At most one nudge per sending server per minute is honoured (in memory);
the rest are answered `{ nudged: false }` and change nothing. An unknown pairing changes nothing.

**Not in scope, stated:** a home member's own yes to a remote newcomer still does not replay at
the home (as locally, `receivingMembers`).

**As built (same day, `feat/federation-resync`).** As designed above. Code: `resync.ts`
(request, home answer, the spoke-message checks `fromSpoke`), `resyncApply.ts` (the spoke's
comparison), `withheld.ts` (`TripShareWithheld`), `entriesUp.ts`, `nudge.ts`, `peerFeatures.ts`;
`queueEntries` takes a `resync` option; `recordEntryAuthor` records a spoke's own people. The
trip page says "`<origin>` needs an update to catch up" for a parked `unsupported`; the roster
hint no longer says nothing is caught up. Tests: `threeServersCatchUp.test.ts` (withheld flight
and gate arrive after the yes; a second resync is a no-op; one request and one answer at a time;
nothing by a declined author leaves the home; the spoke gates a forged `accepted` again),
`twoServersCatchUp.test.ts` (a restored spoke catches up both ways with a conflict for what it
cannot attribute; a repeat changes nothing; a removed entry is not pushed back; only own entries
go up; a confirmation's nudge delivers at once, without it the backoff holds; the nudge rate
limit; an rc.18 peer gets a parked `unsupported` and no nudge; an unknown kind is answered
`unsupported`).

Also built with it (owner, item D): redeeming a code the other server answers "used" reports
success — "Ist schon verbunden" / "Already connected", HTTP 200 with `alreadyConnected` — when
this account redeemed exactly that code with that server before (the pairing keeps the code's
SHA-256, `claimedCodeHash`). A different code, or another account, still reads as used; the
issuer's one-time rule is unchanged. A reply lost before the claimant recorded the pairing still
reads as used (nothing to find locally); a new code is the way out, as before.

**Cold review (Codex, same day), four findings, each fixed with a test that failed first**
(`… review` cases in the two catch-up suites): a withheld change recorded over an own edit would
have let a resync overwrite that edit (now only a provable transition is recorded); a newer yes
could be lost behind a waiting request or answer (requests compare their `accepted`, answers are
replaced); a resync from a member shown unreachable was acknowledged but never answered; an own
entry too large to push up vanished without a word (now `entries-too-large`).


## Owner direction 2026-10-26 — simplify the setup

Owner, after trying RC ↔ Prod: "Das Konzept ist gut, aber viel zu umständlich."
Direction (concept board: https://claude.ai/artifact/UPvVWW7fkBxa9Z9sWS8obB):

1. **Server keys are enough at the server level.** Two admins pin each other's
   key (connection file + fingerprint compared out of band); that is the whole
   server-to-server trust. No separate per-person invite codes.
2. **One place per remote person** (Einstellungen → Teilen → „Personen auf
   verbundenen Servern"): each person on a connected server gets individual
   switches for the leaderboard and for one's own statistics. A person appears
   only after opting in to being findable by connected servers.
3. **Trips are shared from the trip's „Teilen" button.** Choosing „Auf anderem
   Server" asks for the server and the user (lookup among findable users of
   that server only), shows warnings (data is stored on the other server and
   readable by its admin; edits flow both ways; private notes, costs and
   documents stay; what was sent cannot be recalled), and sends an offer the
   person accepts in their inbox.

Not built yet; planned after 2.7. The existing invite codes stay until it is.
