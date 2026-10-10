# Federation — threat model and wire contract (DRAFT)

Status: **draft for owner review**, 2026-10-10. Tracks `dennis/TravStats` forgejo#40.
Nothing here is decided. Every "must" below is a proposal until the owner has read it;
the open questions at the end are the decisions this document is asking for.

Owner position this draft starts from (forgejo#40 comments, 2026-09-18 / 2026-09-19): the
feature stays on the roadmap for later; the next step is the threat model as a written spec;
**aggregates only, never records**; **a LAN-only instance gets no half feature**.

Branch: `docs/federation-threat-model-40`. No code, no migration, no beta entry yet.

---

## 1. What this is

Two TravStats users on two different instances agree to compare a small set of travel
totals — "who flew further this year", "how many countries", head to head. Each instance
sends the other a **snapshot of a few numbers** for one user, on a fixed schedule, over a
link both users opted into. Each side draws the comparison locally.

### Goals

- G1. A user on instance A and a user on instance B can see each other's totals side by side,
  after both of them — not their admins — said yes, to each other specifically.
- G2. **The protocol is incapable of carrying a record.** No flight, stay, date, airport,
  place, coordinate, price or free text can be expressed in any message, so a malicious or
  compromised peer cannot harvest one however it behaves.
- G3. Either user can end the link at any moment, and the end stops data flow at the
  sender, not only in the UI.
- G4. The user sees, before linking, exactly which numbers leave, at what precision, how
  often, and to which server; afterwards, an audit of every snapshot that left.
- G5. On an instance that is not reachable from the internet the feature does not exist —
  no menu entry, no settings card, no route.

### Non-goals (explicit)

- N1. **No records, ever, on this channel.** Server-to-server trip sharing (the "later" of
  `2026-10-09-trip-sharing-design.md`, decision 6) is a different feature with a different
  threat model. It must not be built by widening this wire format; a guard test (§4.6)
  fails if a record-shaped field appears.
- N2. No discovery and no directory. No instance lists its users, its peers, or its
  participants. No search for "people on server B".
- N3. No instance-wide or cross-instance leaderboards in v1 (see Q1).
- N4. No relaying: A never forwards B's numbers to C.
- N5. No one-way participation from a LAN-only instance (see Q4).
- N6. No anonymity between the two linked users. They know who they linked with; the design
  minimises *what* they learn, not *who* it is.
- N7. No protection against the user's own instance admin (§2.2, A6) — that admin already
  holds the full records.
- N8. No Companion (phone) surface in v1.

---

## 2. Assets and adversaries

### 2.1 Assets

| Asset | Why it matters |
|---|---|
| R. Travel records (flights, stays, cruises, rail, rentals, places, tracks, photos) | Movement history of a named person. Never on the wire (G2). |
| S. The snapshot numbers | Low sensitivity alone; sensitive **as a time series** — deltas between snapshots approximate individual trips (§4.3). |
| L. The existence of a link | "User X on A knows user Y on B" is social-graph data. |
| U. Account existence on an instance | Enumeration target ("does `norbert` have an account on B?"). |
| K. Instance signing key | Whoever holds it speaks for every user of the instance towards every peer. |
| C. Invite codes in flight | A leaked code lets a stranger take the place of the intended friend. |
| N. The internal network of each instance | A peer URL is a server-side fetch target — SSRF (§6.4). |

### 2.2 Adversaries

| # | Adversary | Capability assumed | What they want |
|---|---|---|---|
| A1 | **Malicious peer** — an instance run to harvest | Runs modified code, keeps everything it receives forever, sends crafted messages, polls as fast as allowed | Records (R), more users (U), a social graph (L), internal reach via our server (N) |
| A2 | **Compromised peer** — an honest instance someone broke into | Same as A1 plus the peer's signing key and the received snapshots | Same as A1, plus impersonating the peer towards us |
| A3 | **Passive network observer** | Sees encrypted traffic between instances, timing, sizes, endpoints | Who links with whom (L), when users travel (timing) |
| A4 | **Curious admin of the other instance** | Database and log access on B, honest code | The linked user's numbers and history of numbers (S), the link (L) |
| A5 | **Active network attacker** | Can intercept/redirect, replay captured requests, present a wrong certificate for a domain it does not control | Inject false numbers, replay old ones, impersonate a peer |
| A6 | **The user's own instance admin** | Full access to A | Already has R; federation adds the *friend's* snapshot on B (S of another person) and the link (L) |
| A7 | **Correlation over time** — any party holding many snapshots (A1, A2, A4) | Collects every snapshot of a link for years, combines with public knowledge (home airport, social media) | Reconstruct individual trips from deltas: "+1 flight, +2 country, +1,200 km in March" |
| A8 | **Unintended recipient of an invite code** | Got the code by forwarding, shoulder-surfing, chat-log leak | Become linked in place of the intended friend |
| A9 | **Abuser of our endpoints** | Unauthenticated internet client | DoS, probing, enumeration, log flooding |

A6 is listed so that it is not forgotten, and N7 says what we do about it: nothing beyond
not giving that admin a *button* to link a user (consent belongs to the user, §5.2).

---

## 3. The core invariant: the wire format cannot express a record

Encryption protects a record in transit and does nothing once the peer has it. The only
defence that holds against A1, A2 and A4 is that **no record is ever sent**. This must be a
property of the schema, not of the sender's good behaviour.

Concretely, every message on the federation channel is parsed by a Zod schema that:

1. Is `strict` at every level — an unknown key is a **rejection**, not a strip (unlike the
   app's request schemas, which strip). Stripping would let a future sender put a field on
   the wire that an old receiver silently ignores and a new one stores.
2. Contains **no free `z.string()`**. Every string is an enum, a literal, or a short regex
   with a fixed alphabet and a fixed maximum length (ids, period keys, key ids).
3. Contains **no unbounded array, no `z.record`, no `z.any`/`z.unknown`**, no nested object
   that is not itself listed here.
4. Bounds every number (`int`, `min`, `max`) to the range a real person can have.
5. Carries **no instant finer than a month** in the payload (the signature's timestamp is
   transport metadata, §6.2, and is not stored).

The sender builds the payload from typed totals and **parses it through the same schema
before signing** — a sender bug that would emit a forbidden field fails at home, loudly.

### 3.1 Schema sketch (the only payload)

```ts
// backend/src/services/federation/wire.ts (proposed) — server-only, no frontend mirror. Version 1.
import { z } from "zod";

/** A calendar month as the SENDER's user knew it (ADR 0002: a local period, no zone on the wire). */
const MonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** A period a total is about: all time, or one calendar year. */
const PeriodKey = z.union([z.literal("lifetime"), z.string().regex(/^\d{4}$/)]);
/** Opaque link id minted by the inviting instance: 128 random bits, base64url. */
const LinkId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** Abstention is a result (CLAUDE.md): null = "not shared or not derivable", never 0. */
const count = (max: number) => z.number().int().min(0).max(max).nullable();

const Totals = z.strictObject({
  flights: count(100_000),
  /** FLOORED to whole thousands of km, then sent in units of 1,000 km. See §4.2. */
  flightDistanceKkm: count(100_000),
  /** Distinct countries (ISO alpha-2 union across enabled domains). Count only, never the list. */
  countries: count(260),
  /** Days away from home, union across domains (daysAwayLoader). */
  daysAway: count(36_600),
});

export const SnapshotV1 = z.strictObject({
  v: z.literal(1),
  type: z.literal("snapshot"),
  link: LinkId,
  /** Strictly increasing per link; a receiver drops anything <= the last seq it stored. */
  seq: z.number().int().min(1).max(2 ** 31),
  /** The last COMPLETE month the totals include. Never the current month (§4.3). */
  asOf: MonthKey,
  /** At most: lifetime, the current year to `asOf`, and the previous year. */
  periods: z
    .array(z.strictObject({ period: PeriodKey, totals: Totals }))
    .min(1)
    .max(3),
});

export const RevokeV1 = z.strictObject({
  v: z.literal(1),
  type: z.literal("revoke"),
  link: LinkId,
  seq: z.number().int().min(1).max(2 ** 31),
});

export const FederationMessage = z.discriminatedUnion("type", [SnapshotV1, RevokeV1]);
```

Plus two control messages during link setup (§5.3: `claim`, `confirm`) built the same way —
ids, a code hash, a key fingerprint, nothing else. The full message is a few hundred bytes;
the receiver caps the body at 4 KB before parsing.

**What is deliberately absent, and why:**

| Absent | Why |
|---|---|
| Any name — user name, display name, avatar | Each side shows the label *its own* user gave the link. B's user is "Anna" on A because A's user typed "Anna". No identity string crosses, so nothing about the person is harvestable beyond the numbers. |
| Country *list* | A list of ISO codes is a set of places; the count is enough to compare. |
| Per-airline, per-airport, per-route, per-aircraft numbers | Each is a fingerprint of individual flights. |
| Hours aloft, cost, CO₂ | Not needed for v1; cost is private by the trip-sharing rule; CO₂ and time aloft are near-functions of distance and add precision for A7. Candidates for Q2. |
| Per-domain event counts (cruises, stays, rail…) | Useful, deferred to keep v1 minimal (Q2). |
| Any timestamp inside the payload | `asOf` is a month. A precise "generated at" would reveal when the user's data changed. |

### 3.2 How each number is computed (one home per rule)

The snapshot builder (`services/federation/snapshot.ts`, proposed) **calls the existing
counting homes and restates none of them**:

| Field | Source |
|---|---|
| `flights`, `flightDistanceKkm` | `computeSummary` in `services/stats/summary.ts` (`totalFlights`, `totalDistance`), which applies `countableFlightWhere` from `shared/flightCounting.ts`. Planned flights never count. |
| `countries` | The passport's country evidence — `services/stats/passportLoader.ts` → `buildPassport` (`shared/countryEvidence.ts`), the same set the stats screen shows, unioned per `shared/crossDomainCounting.ts` (`foldCrossDomain`, `countriesCount`). |
| `daysAway` | `services/stats/daysAwayLoader.ts` + `computeDaysAway` (`utils/stats/daysAway.ts`); the loader applies `classifyStay` (`shared/lodgingCounting.ts`) and `classifyVisit` (`shared/placeCounting.ts`). |

Year attribution follows what the stats screens already use (the departure airport's
calendar day for flights, ADR 0002 local dates for stays), so a user's own screen and the
number their friend sees agree. A guard test compares the snapshot against the stats
endpoints for the same user and period.

---

## 4. Why the numbers are shaped the way they are

### 4.1 Which aggregates

Four totals cover the issue's examples ("who flew further", "countries", "nights away") and
nothing else. Every added metric is added precision for A7, so each must earn its place (Q2).

### 4.2 Rounding and bucketing

- **Distance is floored to 1,000 km.** Exact distance is the most identifying number on the
  list: a great-circle distance between two airports is close to unique, so an exact delta
  of "+1,284 km" between two snapshots names the route for anyone who knows the user's home
  airport. At 1,000 km granularity a single trip's delta is a band, not a route. *Floor*,
  not round, so the rounding direction leaks nothing; the UI says "≥ 412,000 km".
- **Counts are exact.** A flight count, a country count and a day count do not encode a
  place. Rounding them would make a friend comparison read wrong ("you have about 10
  countries") for little gain.
- Q2 asks whether 1,000 km is the right step (500 is friendlier for short-haul users; 1,000
  is safer).

### 4.3 Time granularity and cadence — the A7 defence

The dangerous object is not a snapshot but the *difference* between two. Three rules bound
what a difference can reveal:

1. **Only complete months.** `asOf` is the last finished calendar month; totals never include
   the current month. A peer learns at most "during March: +2 flights, +1 country, +4 days
   away, +1–2 thousand km" — never which week, never "she is abroad right now".
2. **Fixed schedule, never event-driven.** Snapshots are sent by a scheduled job once a month
   (e.g. on day 3, with a random per-link jitter of up to 48 h). Editing a flight never
   triggers a send — an edit-triggered push would broadcast *when* the user is active, which
   is often *when they travel*. If nothing changed, the same numbers are re-sent with a new
   `seq` (so a missing send means "link problem", not "nothing happened").
3. **Few periods.** Lifetime, the current year to `asOf`, and the previous year. No
   per-month series is ever sent; the peer can only build one by keeping snapshots, and then
   only at month resolution.

Residual: a peer that keeps every snapshot learns a per-month activity profile with distance
in 1,000 km bands. For most users that is "travels in summer and at Christmas". For a user
with a single trip in a month and a well-known home airport, the band plus a +1 country delta
can narrow the destination to a region. This is stated to the user before linking (§8).

### 4.4 Minimum-k — why it does not apply in v1, and when it would

k-anonymity protects an individual inside a group. A link is between two identified people:
there is no group to hide in, and suppressing small values ("< 3 countries") would only make
the comparison wrong for new users. **Minimum-k becomes mandatory the day anything is
compared across more than two people** — a group view or instance leaderboard (Q1). Then: no
group with fewer than k = 5 participants is shown, and no per-member value is shown below a
threshold. Not part of v1.

### 4.5 Noise (differential privacy) — considered, not recommended for v1

Calibrated noise would bound A7's inference formally. Rejected for v1 because: (a) between
two identified friends, a total that is visibly wrong ("you: 47 flights" when you have 45) is
a broken feature; (b) DP leakage accumulates over repeated releases, so a monthly series
needs a privacy budget that either runs out or must be so loose it buys little; (c) floored
distance plus month cadence gives a *deterministic*, explainable bound that the UI can state
in one sentence. Revisit if group views (Q1) are ever built — that is where DP earns its cost.

### 4.6 Guard tests (the enforced half)

Per CLAUDE.md, a rule is only "enforced" with a named check. Proposed:

- `federation/wire.capability.test.ts` — walks the Zod schemas and fails on any free string,
  unbounded array, record, `any`/`unknown`, or non-strict object. **This is the test that
  makes "the wire cannot express a record" a fact instead of a promise.**
- `federation/wire.vectors.test.ts` — fixed vectors (like `services/push/push-vectors.json`):
  valid messages, and messages with one extra key / a long string / a 4th period each rejected.
- `federation/snapshot.agreesWithStats.test.ts` — snapshot totals equal the stats endpoints'.
- `federation/snapshot.noEventTrigger.test.ts` — writing a flight sends nothing.

---

## 5. Identity and trust

Two layers, each with its own consent: **instances** may talk (admins), **users** take part
(users). The first never implies the second.

### 5.1 Instance identity

- Each instance has an **Ed25519 signing key** generated on first enable, stored as a file
  under the data volume's `secrets/` directory beside the JWT and encryption keys — **not in
  the database**. Reason: a database dump restored elsewhere (a staging clone of production
  data, a migration to new hardware) must not carry the private key and silently speak for
  the original instance. That exact class of failure — machine identity riding along with a
  data dump — has already bitten this project once with the instance URL settings.
- Instance identity = **(canonical public origin, public key)**. The origin is the admin's
  `publicUrl` (`services/instanceSettingsService.ts`), https only. The fingerprint shown to
  admins is the first 16 bytes of SHA-256(public key), grouped for reading aloud.
- **Explicit, pinned peers, never discovered** — the rule the passkey rpId already follows
  (`services/webauthn/rpConfig.ts`). A peer is an admin-entered `(origin, fingerprint)`; the
  key it presents must match the pin.

### 5.2 Peer admission (instance layer)

Proposed v1 (Q3): **mutual admin allowlist**. Admin of A adds B (origin + fingerprint read
out of band); admin of B adds A. Until both have, no user-level link can be made between them.
The admin sees per peer: status, last contact, number of active links — **not which users**.
There is no admin endpoint that creates, reads or deletes a user's link (A6: consent belongs
to the user; the admin can only suspend a whole peer).

Alternative (open federation: any public instance a user pairs with) is simpler for users
and much weaker against A1, because the admin's out-of-band check disappears. See Q3.

### 5.3 User link (user layer) — mutual opt-in, per pair

1. **Invite.** User on A opens "Vergleichen" and creates an invite. A mints a one-time code
   (`fed_` + 128 random bits; only its SHA-256 stored, as `services/pairing/pairingService.ts`
   does for `clm_` codes), valid 72 h. The code is shown with A's origin; it carries nothing
   else. The user sends it to the friend by any channel they trust.
2. **Claim.** User on B (logged in, cookie session only — a PAT cannot create links, the same
   `cookieOnly` rule as `routes/pairing.ts` and `routes/settings/tokens.ts`) pastes the code
   and A's origin. B checks A is an admitted peer, then sends a signed `claim` to A with the
   code hash. A answers identically for "no such code", "expired", "already used" and "peer
   not admitted": a uniform refusal (§6.5, no enumeration).
3. **Confirm.** A's user sees a pending link request "from a user on B" in the inbox, with a
   **six-digit comparison code** derived from both instance keys and the link id. Both users
   read it to each other (or compare in chat). A's user confirms; A sends `confirm`. Only
   now does the link exist on both sides. This step defeats A8 (a forwarded code) and an
   instance-key substitution: the stranger would have to also be on the phone with A's user.
4. **Choose what to share.** Each side picks its own metrics (default: all four on, shown
   with current values, §8). Sharing is asymmetric by design — each user decides only about
   their own numbers.

Each user labels the link locally ("Anna"); the label never leaves the instance.

Trust the peer cannot remove: **B's admin is trusted to say which of B's users is acting.**
A malicious B can fabricate a "user on B" who accepts any invite. The confirm step limits the
harm to links the A-user actually confirmed; nothing stops B from lying about who is behind
the account. Stated in the UI ("you trust the person *and* their server").

### 5.4 Revocation

- Either user ends a link at any time ("Verbindung beenden"). The ending side **stops sending
  immediately** (the next scheduled job finds no active link), **deletes the received
  snapshot locally**, and sends a signed `revoke` to the peer, retried with backoff for 7 days.
- An honest peer, on `revoke`, deletes its stored snapshot of that link and shows the user
  "Anna hat die Verbindung beendet". **Deletion on the peer cannot be enforced or verified.**
  A malicious or compromised peer keeps everything it ever received. The UI says so before
  linking and again on revoke.
- An admin suspending a peer revokes every link with it (notices to the affected users).
- Disabling federation on the instance revokes every link first, then stops.
- Deleting an account revokes its links first (best effort), then deletes.
- A link with no successful exchange for 120 days ends itself (notice to the user).

### 5.5 Key rotation and compromise

- **Planned rotation:** the instance creates a new key and sends each admitted peer a
  `rotate` message signed by **both** old and new keys; the peer updates the pin. The old key
  is accepted for 14 days of overlap, then dropped.
- **Compromise:** a rotation signed by a stolen old key is indistinguishable from a real one,
  so after a suspected compromise the admin uses **emergency re-key**: new key, and every peer
  admin must re-pin out of band (the instance shows its new fingerprint; peers mark it
  "unverified" until done). Links survive re-pinning; snapshots stop until it is done.
- **Restore onto a different origin:** if the configured `publicUrl` differs from the origin
  the key was created under, federation suspends itself and tells the admin why — no silent
  impersonation by a cloned instance.

---

## 6. Transport and authentication

### 6.1 TLS

https only, system trust store, normal certificate validation, no "accept self-signed"
option. TLS gives confidentiality against A3 and A5; it is **not** the authentication —
the request signature is, so a TLS-terminating proxy or CDN in front of either instance does
not become a party that can forge messages.

### 6.2 Request signing

Every federation request is signed with the sender's instance key over a canonical string:

```
travstats-federation-v1\n<METHOD>\n<path>\n<receiver origin>\n<key id>\n<created unix s>\n<nonce>\n<sha256(body) base64url>
```

carried in headers (`TravStats-Key-Id`, `TravStats-Created`, `TravStats-Nonce`,
`TravStats-Signature`). **Never a bearer token, never anything in the query string** —
query strings end up in access, proxy and referrer logs (the reason pairing codes travel in
the body). Recommendation: this fixed canonical form with test vectors, rather than a full
RFC 9421 (HTTP Message Signatures) implementation — smaller surface, same properties for a
two-endpoint protocol (Q5 records the alternative).

### 6.3 Replay protection

- `created` must be within ±300 s of the receiver's clock.
- `(key id, nonce)` is remembered for 600 s and a repeat is rejected.
- The payload's per-link `seq` must be strictly greater than the last stored one, so a
  replay outside the nonce window still cannot roll a total back.
- The signature binds the receiver's origin, so a message for B cannot be replayed at C.

### 6.4 Egress — the opposite decision from Immich, deliberately

`normalizeImmichBaseUrl` (`services/immich/types.ts`) and `services/llm/llmEndpoint.ts`
deliberately allow private addresses, because their primary use case lives on the LAN.
**Federation is the mirror image**: it is online-only, so a private peer address buys
nothing and opens SSRF (an admin, or anyone who reaches the settings, could point a "peer" at
an internal service). A peer origin must:

- be `https:` with a DNS name (no IP literals);
- resolve, **at connection time**, only to public unicast addresses (reject loopback,
  RFC 1918, CGNAT, link-local, ULA, multicast, documentation ranges, and IPv4-mapped forms of
  all of these); the connection is made to the address that was checked, so DNS rebinding
  between check and connect does not work;
- never be followed through a redirect;
- answer within 10 s, with a response body capped at 4 KB.

The proposed `services/federation/peerUrl.ts` carries a header comment naming the Immich and
LLM rules and why this one differs, so a future tidy-up does not "make them consistent".

### 6.5 Inbound endpoints, rate limits, abuse

- Mounted under `/api/v1/federation/peer/*`, so the `/api` `Cache-Control: no-store` default
  applies (`apiNoStore.test.ts` gains a case). Cookies are ignored on these routes (no CSRF
  surface); no CORS.
- Body limit 4 KB on this router, Zod-parse before any database read.
- **Uniform refusals.** Unknown key, bad signature, unknown link, revoked link, unknown code
  all answer `401 {success:false, error:{code:"FEDERATION_REFUSED"}}` in the same time
  budget. Accepted messages answer `204`. Nothing answers whether a user or a link exists.
- Rate limits (new limiters in `middleware/rateLimit.ts`): per peer key id — 60 requests/hour,
  at most one accepted snapshot per link per 24 h; per source address for **failed**
  authentication — 20/hour (keyed through `ipKeyGenerator`, per the /56 rule). A peer is
  limited by its key, not its address, because a CDN or tunnel can put many peers behind
  one address.
- **Abuse handling:** 50 refused signatures from one admitted peer in a day → the peer is
  auto-suspended and the admin notified (a compromised or broken peer). The admin can suspend
  or remove a peer at any time; suspension revokes its links (§5.4).
- The user-facing router (`/api/v1/federation/*`: invites, links, comparison, audit) is a
  new domain and joins the **enveloped** family per ADR 0001; it is registered in
  `apiResponseShape.baseline.json`.

---

## 7. LAN-only detection — the feature is absent there

### 7.1 How the app decides

Federation is **available** only when all of these hold; otherwise it is **absent** — no
navigation entry, no settings card, every federation route answers `404` exactly like an
unknown path (not `409`: absent, not "disabled"):

1. The admin switch `federationEnabled` is on (instance setting, default off), and
2. `publicUrl` is set, `https:`, and its host is a public DNS name — not an IP literal, not a
   `.local`/`.lan`/`.home.arpa`/`.internal`/`.localhost` name, not single-label (the
   name-based classification already in `services/llm/llmEndpoint.ts`), and
3. the instance key exists and was created under that origin (§5.5).

The admin settings card is shown whenever the admin switch is visible and explains which
condition fails, in its own words — the pattern of `passkeyUnavailableReason()`: a switch
that can never work is replaced by an explanation. Users never see a half state.

**Reachability is proven by the peer, not guessed.** An instance cannot test from inside
whether the internet can reach it. The first time it is proven is admission (§5.2: B's admin
adding A makes B call A) and every link claim. A peer that cannot reach A gets a clear
message ("Dieser Server ist von außen nicht erreichbar").

### 7.2 Failure modes

| Situation | What happens | Acceptable? |
|---|---|---|
| `publicUrl` set and public, but the reverse proxy does not forward it | Feature visible to the admin; admission/claim fails with "not reachable from outside". Users cannot have created links yet. | Yes — fails at setup, says why. |
| Instance reachable but `publicUrl` unset | Absent; admin card says "set the public address". | Yes. |
| Public name that resolves to a LAN address internally (split DNS) | Classified public by name (like the LLM rule — errs toward the stricter path); reachability is then proven by the peer. | Yes. |
| Reachable at link time, later not (tunnel down, DynDNS stale) | Our outbound sends still work; the peer's sends to us fail and retry. Our user sees "Anna's server could not reach yours since …". After 120 days the link ends (§5.4). | Yes — visible, self-healing, bounded. |
| Admin turns federation off | All links revoked (notices sent), feature absent. | Yes. |
| Database restored onto a LAN-only test instance | Key not present / origin mismatch → absent; links frozen, nothing sent. | Yes — this is the case the file-based key exists for. |

Q4 asks whether a LAN-only instance may *push* one way. Recommendation: no, as the owner said.

---

## 8. What the UI must show before linking

German primary, English mirror, together (`localeKeyParity.test.ts`). Before the user creates
or accepts an invite, one screen states, with the user's **actual current values**:

> **Das verlässt deinen Server — und nur das:**
> Flüge: 312 · Strecke: ≥ 1.204.000 km · Länder: 47 · Tage unterwegs: 1.630
> (jeweils gesamt, für 2026 bis Ende September und für 2025)
>
> **An wen:** den Server `b.example` (Fingerabdruck `3F2A 91C0 …`) und dort an die Person,
> mit der du gleich einen Vergleichscode abgleichst.
> **Wie oft:** einmal im Monat, nur abgeschlossene Monate. Nie einzelne Flüge, Orte, Daten,
> Preise oder Fotos.
> **Wer es lesen kann:** die Person und die Administration des anderen Servers.
> **Beenden:** jederzeit. Danach wird nichts mehr gesendet. Ob der andere Server Gespeichertes
> löscht, kann TravStats nicht erzwingen.
> **Was man daraus ablesen kann:** wer die Zahlen über Monate sammelt, sieht ungefähr, in
> welchen Monaten du gereist bist und wie weit — nicht wohin.

Each metric has its own switch on that screen. Afterwards, Einstellungen → Vergleichen shows
every link, its label, what it shares, last sent/received, and an **audit list**: every
snapshot that left (date sent, period, the exact numbers) for the last 24 months.

The feature registers in `frontend/src/config/betaFeatures.ts` (`why`: threat model under
review; `returnsWhen`: owner accepted this spec and v1 passed a security review), and the
page respects `useEnabledDomains()` (a disabled domain contributes nothing to any total).

---

## 9. Data retention

| Data | Sender (A) | Receiver (B) |
|---|---|---|
| Records | Never leave. | Never received. |
| Snapshot sent | Kept in the audit log, 24 months, readable by the user; deleted with the link's user. | — |
| Snapshot received | — | **Latest one per link only**, overwritten on each receive; no history table. Deleted on revoke, on peer suspension, on account deletion. |
| Link row | Ids, peer, label, chosen metrics, status, `lastSeq`, timestamps. Deleted 30 days after revoke (kept for the audit's sake), then gone. | Same. |
| Invite code | Hash only, deleted on use or expiry + 7 days. | — |
| Nonce cache | 10 minutes, memory. | 10 minutes, memory. |
| Instance key | Data volume `secrets/`; old keys deleted after the rotation overlap. | Peer pin (public key) only. |

"Latest only" on the receiver is a promise of *our* code. A modified peer keeps a history
(A7); that is why §4.3 bounds what a history can reveal rather than relying on retention.

Backups: the received snapshot is part of the user's data and travels in a backup. The
instance key does not travel in a database dump; whether the full-instance backup
(`services/backup/*`) carries it is an implementation decision for F1, defaulting to *no*
(a restore re-keys and peers re-pin).

---

## 10. Logging without leaking

- **Never logged:** payload bodies, totals, invite codes (plaintext or hash), signatures,
  link labels, remote anything that identifies a person.
- **Logged** (via `securityLogger` for refusals, the app logger otherwise): event type, peer
  key id, peer origin, local user id for local actions, a short hash prefix of the link id,
  outcome code, `requestPathForLog(req)`.
- Refused requests log the source address and reason **at most once per peer per minute**
  per reason, so A9 cannot flood the log area.
- The admin log area and the diagnostic export (`shared/logContract.ts`) therefore contain
  no remote user's numbers — an admin reading logs learns that links exist and work, not
  what they carry.
- The user-readable audit (§8) is the one place where sent numbers are visible, and only to
  the sending user.

---

## 11. STRIDE / attack table

| # | Threat (STRIDE) | Adversary | Mitigation | Residual risk |
|---|---|---|---|---|
| T1 | **I** — peer harvests flight/stay records | A1, A2 | No record field exists (§3); strict schema; capability test (§4.6); sender self-parse | None on this channel. Records can only leak through a *different* channel, e.g. a future server-to-server trip share (N1). |
| T2 | **I** — trip inference from snapshot deltas | A7, A1, A4 | Month cadence, complete months only, schedule not event, distance floored to 1,000 km, three periods only (§4.3) | Monthly activity profile and distance bands remain derivable; a single-trip month near a known home can narrow to a region. Disclosed in UI. |
| T3 | **S** — stranger links using a forwarded invite code | A8 | One-time code, 72 h, hash-only storage, confirm step with six-digit comparison code (§5.3) | A user who confirms without comparing the code. |
| T4 | **S** — malicious peer invents a user to accept invites | A1 | Admin allowlist (§5.2), confirm step | B's admin is trusted for who B's users are; cannot be removed. |
| T5 | **S** — attacker impersonates a peer instance | A5, A2 | Pinned Ed25519 key, signed requests, TLS | Stolen peer key until rotation/re-pin (§5.5). |
| T6 | **T** — forged or rolled-back totals | A5, A1 | Signature over body digest; `seq` monotonic; bounds | A malicious peer can lie about *its own* user's numbers — a comparison is only as honest as the other server. |
| T7 | **R** — user disputes what was shared | — | Sender-side audit log of exact payloads (§8) | Receiver's claims about what it got are unverifiable. |
| T8 | **I** — enumeration of users or links | A9, A1 | No directory; uniform 401 for every refusal; random 128-bit ids; codes rate limited | Timing side channels if the uniform time budget is not held — test it. |
| T9 | **I** — social graph (who links with whom) | A3, A4 | Each side knows only its own links; peer admin sees link count per peer, not names | A3 sees that two instances talk and roughly how many links (monthly request bursts). A4 sees the existence of a link with a local user. |
| T10 | **E** — SSRF via peer URL | A6 or settings abuser | Public-only egress at connect time, no redirects, no IP literals, caps (§6.4) | A new address class not in the blocklist; keep the list tested. |
| T11 | **D** — flooding federation endpoints | A9, A1 | 4 KB body cap, Zod before DB, per-key and per-IP limiters, auto-suspend | Volumetric DoS is the reverse proxy's job, not the app's. |
| T12 | **I** — CDN/proxy caches a federation response | infra | `/api` `no-store` default; peer responses are `204` with no body | None known. |
| T13 | **I** — peer keeps data after revoke | A1, A2, A4 | Revoke message; honest peers delete; UI says it cannot be enforced | Full: anything ever received may be kept forever. |
| T14 | **E** — own admin links a user without consent | A6 | No admin link endpoint; links need the user's cookie session | Admin with database access can do anything, including this. Out of scope (N7). |
| T15 | **S** — cloned instance (restored dump) speaks for the original | ops | Key file outside the database; origin binding; self-suspend on mismatch (§5.5) | A full-volume copy that includes `secrets/` *and* the same origin is the same instance by definition. |
| T16 | **I** — logs leak numbers | A4, A6 | Logging rules (§10) | A future log line added carelessly; a test asserts federation log calls carry no payload fields. |
| T17 | **T** — schema widened later "just this once" | future us | Capability test fails on any free string or record; N1 written down | A change to the capability test itself — review rule: that test changes only with the owner. |

---

## 12. Open questions for the owner

Each with a recommendation; none is decided by this draft.

**Q1. Scope of comparison: pairwise only, or groups/leaderboards?**
Recommendation: **pairwise only in v1.** A "leaderboard of my friends" can be drawn locally
from the user's own pairwise links with no new wire field and no new consent. An
instance-wide or cross-instance leaderboard makes every participant visible to every other,
needs minimum-k and probably noise (§4.4–4.5), and is a separate decision later.

**Q2. The metric set and its precision.**
Recommendation: **four metrics** — flights, distance floored to 1,000 km, countries (count),
days away — over lifetime, current year to last complete month, previous year; monthly
cadence. Defer per-domain event counts, hours aloft, CO₂. If 1,000 km feels too coarse for
short-haul users, 500 km is the floor I would accept.

**Q3. Who admits a peer: mutual admin allowlist, or any public instance a user pairs with?**
Recommendation: **mutual admin allowlist in v1.** It costs the two admins one out-of-band
fingerprint check and turns "any server on the internet" into "servers someone vouched for",
which is the strongest single control against A1. Open federation can come later if the
allowlist proves to be the main obstacle.

**Q4. LAN-only instances: absent, or one-way push to a trusted peer?**
Recommendation: **absent**, as the owner already said. One-way push would be possible with
this design (the sender drives the cadence), but a link that can send and never receive, and
never be revoked from the other side, is exactly the half feature to avoid.

**Q5. Signature format: fixed canonical string with test vectors, or RFC 9421?**
Recommendation: **fixed canonical string** (§6.2) with a vector file, like the push seal.
RFC 9421 adds interoperability nobody needs (both ends are TravStats) and a larger parser
surface. Revisit only if a non-TravStats peer is ever wanted (it is a non-goal today).

**Q6. Confirm step with a six-digit comparison code — required or optional?**
Recommendation: **required.** It is the only control against a forwarded invite (A8) and
costs one sentence between two friends.

**Q7. Does the full-instance backup carry the federation key?**
Recommendation: **no** — a restore re-keys and asks peers to re-pin; links survive. This is
the safer default given the history of identity riding along with data dumps.

---

## 13. Phased plan

| Phase | Scope | Exit |
|---|---|---|
| **F0** | This document; owner answers Q1–Q7; security review of the answered spec. | Owner accepts. |
| **F1 — instance layer, no user data** | Instance key + origin binding, availability rule and admin card (§7), peer allowlist with fingerprints, signed `ping` both ways, egress guard, inbound router with limiters and uniform refusals, capability + vector tests. Beta-gated. | Two test instances admit each other; every refusal path tested; nothing user-related on the wire. |
| **F2 — minimal v1** | Invites, claim, confirm with comparison code, revoke (both directions, retries), snapshot builder over the existing stats homes, monthly scheduled sender, receive-latest-only store, comparison view (two columns), consent screen (§8), audit list, logging rules, DE/EN. | End-to-end between two instances; guard tests from §4.6 green; independent security review before un-gating. |
| **F3 — deferred** | Local "my links" leaderboard (Q1), key rotation messages (F1/F2 use manual re-pin only), per-domain counts if Q2 allows, Companion view. | Separate small specs. |
| **Never on this channel** | Records of any kind; server-to-server trip sharing; directory/discovery; relaying. | — |

Effort, roughly: F1 one to two weeks, F2 two to three weeks, each including tests and review.
The protocol is small; the cost is in the refusal paths and the UI copy, which is where this
feature succeeds or fails.
