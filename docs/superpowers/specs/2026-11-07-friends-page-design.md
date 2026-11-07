# Friends page: side-by-side comparison and admin-approved server admission

Date: 2026-11-07 · Tracks `dennis/TravStats` forgejo#416 · Status: design, awaiting owner approval.
Code base: `forgejo/main` at `f9fd9efa3`. Builds on the comparison rework
(`docs/superpowers/specs/2026-10-16-comparison-rework-design.md`, "the rework spec" below), whose
G3 (totals only, never a record) and whose separation from the encrypted share stay in force.
Reviewed with Codex on 2026-11-07 (findings folded in below and marked "Codex").

## 1. Why

Owner, 2026-11-06 (forgejo#416): comparing with friends across servers works, but it is
cumbersome, hard to understand and cluttered. Comparisons should be real side-by-side
comparisons on a **Freunde** page reachable from the header's **Mehr** menu, not a list —
stats **and** achievements. Owner, 2026-11-07: build that, and the improved server-to-server
connection with it.

Measured today: 12 steps from two unconfigured servers to the first number, 6 of them admin
work on both sides (origin, enable, key, connection-file exchange, out-of-band fingerprint
check, pin, ping). `LeaderboardPage.tsx` mixes ranking and management on one scroll.
Achievements cannot be compared at all.

## 2. Owner decisions

- D1 (2026-11-06): page name **Freunde**, entry in the header's Mehr menu; side-by-side, not a
  ranked list; stats and achievements.
- D2 (2026-11-07, verbatim "Admin muss es zugelassen haben"): **a new server only becomes a
  peer once that server's admin has admitted it.** A user accepting an invitation never
  admits a server by itself. What goes away is the file exchange and the out-of-band
  fingerprint step, not the admin's say.

## 3. Goals

- G1. Two users on one instance: A opens "Freund hinzufügen", enters B's username; B accepts
  the request on their Freunde page. Two steps, no admin.
- G2. Across instances, first time between two servers: A creates an invitation link and
  sends it; B opens it and accepts on their own server; each server's admin approves the
  other server once with one click on a card that shows origin, fingerprint and who asked;
  A accepts B. Afterwards, every further friendship between the same two servers is G1-short
  (link + accept), with no admin step.
- G3. Admin setup is one switch: "Föderation einschalten" with the origin pre-filled from the
  instance's public URL and the server key generated on the spot. The manual pin / connection
  file flow stays available under "Erweitert" for admins who want it.
- G4. The Freunde page compares **Du | Freund** (up to three friends as further columns) per
  metric, with the difference, and achievements side by side. Every value that cannot be
  shown says why (not shared, not available on that server version, partial, incompatible
  achievement catalogue) — never a zero, never a dash that could mean "nothing".
- G5. Nothing flows before both people have agreed (fixes the false promise, §6.1).

## 4. Non-goals

- No change to the encrypted share (`/encrypted-share`, beta key `encryptedShare`); the
  separation test `components/encryptedShare/__tests__/separation.test.ts` stays green.
- No arbitrary date ranges: the protocol knows lifetime or one calendar year (Codex), and so
  does the page.
- No Companion work. The Companion has no comparison feature; nothing in its contract changes.
- No un-gating: the page stays behind beta key `comparison` until the owner says otherwise.

## 5. Anti-goals (would be a failure even if it works)

- A user, a link, or a remote server can make this server trust a new peer without its admin.
- An invitation link whose token reaches a server log, a referrer or analytics.
- Achievements carrying a date, a place, a record id, or progress in a domain the person did
  not share (G3 of the rework spec).
- An old peer (snapshot v1 only) breaking or showing "0 badges"; it shows "not available on
  that server".

## 6. Design

### 6.1 Protocol fixes first (both found by Codex, verified)

1. **Redeeming already shares.** `recordClaim()` writes the claimant's consent as `accepted`
   (`services/comparison/remote.ts:269`) and `serveAggregate()` serves it without checking the
   inviter (`peerActions.ts:38-50`). New rule: a consent is served only while the friendship is
   **mutual** — both sides accepted. Locally that is two accepted rows; remotely the serving
   server must know the other side accepted, carried by the existing state message
   (`lbStateRequestSchema`) or an additive field on it. Mechanism is the builder's; the test is
   "B redeems, A has not answered → A's aggregate request for B gets `notShared`".
2. **Remote "teilt mit dir" is always "—".** `personViewSchema.theirs` is `null` for remote
   people (`schemas/comparison.ts:167`), `PeopleSection.tsx:73` renders the dash. The remote
   side's consent state must reach the view: derived from the last aggregate answer
   (`ok` / `notShared` / `withdrawn` / `yearNotShared`) with its timestamp, or from the state
   message. Unknown is its own state ("noch keine Antwort"), not "—".

### 6.2 Server admission with admin approval

New table `federation_admission_requests`: id, direction (`outgoing` = this server asked to
be admitted by a peer because a local user accepted an invite; `incoming` = a peer asked to be
admitted here), origin, public key, fingerprint, requesting local user (outgoing) or invited
local user (incoming), invite reference (encrypted at rest, like API keys), status
(`pending | approved | declined | expired`), created/decided at, decided by.

**Public identity endpoint.** `GET /api/v1/federation/identity` → `{ origin, publicKey,
fingerprint, protocolVersions }`, unauthenticated, 404 when federation is off. A public key is
public; this is what lets a server prove it controls its origin (below) without a file.

**Flow, A on server SA invites B on server SB, servers not yet peers:**

1. A creates an invitation (§6.3) on SA.
2. B opens it on SB and accepts (scope dialog as today). SB validates the payload, applies the
   peer address policy (public HTTPS; `FEDERATION_PRIVATE_PEERS` admission stays admin-only —
   Codex 11), fetches `https://SA/api/v1/federation/identity` through the existing
   egress-checked client (`services/federation/security.ts`) and requires origin + key to
   match the invitation's fingerprint.
   - SA already pinned with that key → straight to the existing claim (today's path).
   - SA pinned with a **different** key → refuse with a named code; a user never replaces a
     key (Codex 13).
   - SA suspended → refuse; a user never re-enables a peer.
   - Otherwise → an `outgoing` admission request on SB, status `pending`. B sees "Wartet auf
     die Freigabe deines Admins".
3. SB's admin sees the request in Admin → Instanz → Föderation as a card: origin, fingerprint
   (with the same "compare with your friend if in doubt" hint), who asked, when. **Zulassen**
   pins SA (same code path as the manual pin, audited with the admin's id) and immediately
   sends SA a signed **admission request** carrying SB's origin and the invitation token.
   **Ablehnen** ends it; B sees why.
4. SA receives the admission request on a new bootstrap peer action that accepts an unpinned
   sender **only** when it carries a valid, unexpired, unused invitation token of SA, and only
   after fetching SB's identity endpoint and verifying the request signature with that key.
   Anything else answers 403 and stores nothing. It creates an `incoming` request on SA.
   This is the only route an unknown origin can reach; ordinary peer actions stay closed to
   unpinned origins (Codex 14).
5. SA's admin approves the same way → SA pins SB, verifies with the existing ping, and the
   pending claim runs: A gets B's friend request as today and accepts. The invitation token is
   consumed atomically at this point, not earlier.
6. Expiry: an invitation lives 72 h as today, but a token that is attached to a pending
   admission request stays redeemable until that request is decided or 14 days pass, so a
   slow admin does not kill it. Both requests expire with it.

**Limits (Codex 12).** Bootstrap action: its own limiter per IP and a global cap of open
incoming requests (20); payload ≤ the existing 8 192-byte peer body cap. Outgoing requests: per
user 5 open, per instance 20 open. A pinned peer gains nothing new from this spec; the existing
per-action rules of `/comparison-peer` and `/trip-share-peer` (separate switch) are unchanged —
the admin card says that admitting a server also lets its users ask for trip shares when that
switch is on (Codex 8).

**Audit.** Every admission decision logs operation, admin id, origin, fingerprint
(`logger.info`, as `federation_key_generated` does).

### 6.3 Invitation link

`https://<SA origin>/freunde/einladung#<payload>`; the payload sits in the **fragment**, so it
never reaches a server, a log or a referrer (Codex 17). Payload = base64url of
`{ v: 1, kind: "travstats-friend-invite", origin, publicKey, fingerprint, token, expiresAt }`
(`publicKey` as the raw 32-byte Ed25519 key, base64url; fingerprint encoding as
`identity.ts` already defines it; token cryptographically random, single use, stored hashed on
SA). Bounded by its own Zod schema (≤ 1 KB), separate from today's `origin#secret` code, which
keeps working (Codex 18).

Landing page on SA (public, no session needed, no request carrying the fragment):
- Opened by a signed-in user of SA → "Das ist eine Einladung auf deinem eigenen Server"
  and, for a local friend, the local add flow.
- Anyone else → "Öffne die Einladung auf deinem TravStats-Server": a field for their own
  server address (remembered in `localStorage`), which navigates to
  `https://<their server>/freunde/annehmen#<payload>`, plus "Link kopieren" for pasting. The
  inviter's page never sends anything to the friend's server and never sees the friend's
  session (Codex 16).
- `/freunde/annehmen` on SB parses the fragment client-side, shows inviter name, server origin
  and fingerprint, and redeems only on an explicit button (POST), never on load or prefetch;
  afterwards it clears the fragment from history (`history.replaceState`).

### 6.4 Achievements in the snapshot (snapshot v2)

v1 is a `strictObject`, so even an optional field breaks old receivers (Codex 20). Hence
**snapshot v2** = v1 plus an optional `achievements` section; servers advertise and serve
`[1, 2]`, negotiate the highest common version, and keep producing an unchanged v1 for v1
peers. `SERVED_VERSIONS` and the mirror test `comparisonMetrics.mirror.test.ts` move with it.

```
achievements: {
  catalogue: string,          // definition version: hash of the comparable codes + requirements
  items: [{ code: string, unlocked: boolean, progress: number | null }]   // progress 0..1, ≤ 400 items
} | absent
```

- Only **comparable** achievements: a new `comparable` flag in the catalogue
  (`backend/src/data/achievements.ts`), false for anything place- or record-specific. No
  `unlockedAt`, ever (`remoteAchievements.ts` carries it and must not be reused unchanged —
  Codex 21).
- Held-ness reads `isAchievementHeld` (live measure, owner ruling 2026-09-20), the same as the
  user's own page, and the domain-visibility rule (`achievementVisibility`).
- Its own consent group: `achievements` joins `METRIC_GROUPS`; existing grants do not gain it
  (default off). A cross-domain badge is included only if every domain it reads is shared.
- **Lifetime only.** In a year view the achievement section reads "nur für die Gesamtzeit"
  (Codex 25).
- Different `catalogue` on the two sides → per item: same code present on both → compared;
  otherwise "auf dem anderen Server unbekannt". Never shown as locked (Codex 22).
- Local friends (same instance) get the same section through the same builder, so local and
  remote never disagree.

### 6.5 The Freunde page

Route `/freunde`; `/compare` redirects there (bookmarks keep working). Mehr menu: "Freunde"
replaces "Vergleich mit Freunden". Settings' "Rangliste" row becomes a link to it; the
encrypted share row stays where it is.

Top to bottom:
1. **Anfragen** — only when there is something: incoming friend requests (accept / decline,
   with the scope dialog), and the user's own pending admissions ("wartet auf deinen Admin" /
   "wartet auf den Admin von <origin>" / declined, with reason).
2. **Freund wählen** — chips of the user's friends (local and remote alike) plus
   **"Freund hinzufügen"** (one dialog: username on this server, or create / paste an
   invitation link). Up to three friends can be selected at once.
3. **Vergleich** — filters: Zeitraum (Gesamt / a year — the protocol's two options) and
   domains (display filter: hides domain metrics; cross-domain totals are not recomputed and say
   so — Codex 24). Then per domain, in the domain colour (`useDomainColors`), a table:
   metric | Du | Freund(e) | Differenz. Units through the existing formatters (distance unit,
   `formatDuration`, `useDisplayFormat`). No difference is computed against a partial value or
   across different domain coverage (Codex 23); it reads "nicht vergleichbar".
4. **Auszeichnungen** — counts and points side by side, then badges grouped as "ihr beide",
   "nur du", "nur <Freund>", with progress bars for the not-yet-held ones.
5. **Freund-Detail** (opened from the chip): what I share with them (scope, edit), what they
   share with me (§6.1.2), remove friend. Boards survive as an optional filter on the chip row
   ("Gruppe"), not as their own section.

The ranked tiles (`LeaderboardTile.tsx`) leave the page. *My call:* the three-friend columns
replace the ranking; if the owner misses the ranking, a per-metric sort of the columns brings it
back cheaply.

Built for iPad first (CLAUDE.md: the web build is drawn for iPads; touch sizing via
`useCoarsePointer`). DE copy first, EN mirrored (`localeKeyParity` guards it).

### 6.6 Admin page

Admin → Instanz → Föderation becomes: one switch (origin pre-filled from `public_url`,
key generated when switched on for the first time; a later key regeneration keeps today's
warning), then **Anfragen** (§6.2 cards), then **Verbundene Server** (origin, fingerprint,
since, admitted by, suspend). Connection file, manual pin and verify move under **Erweitert**
unchanged (`FederationConnectionFile.tsx`, `FederationPeerForm.tsx`).
`FederationSetupChecklist.tsx` shrinks to what is still a step.

## 7. Contract (server ↔ web; peer ↔ peer)

New cookie API (bare responses per the comparison router's family, ADR 0001; every endpoint in
OpenAPI with a response schema; errors as named `COMPARISON_*` / new `FEDERATION_ADMISSION_*`
codes mapped to DE/EN copy):

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/comparison/invite-links` | create a link → `{ url, expiresAt }` |
| `POST /api/v1/comparison/invite-links/redeem` | body `{ payload, scope }` → `{ status: "claimed" | "awaitingAdmin" | "awaitingPeerAdmin" }` |
| `GET /api/v1/comparison/admissions` | the user's own pending admissions |
| `GET /api/v1/comparison/compare?friends=<key,…>&year=` | selected friends' snapshots + self, for the page (avoids pulling the whole leaderboard — Codex 26) |
| `GET /api/v1/admin/federation/admissions` | admin queue |
| `POST /api/v1/admin/federation/admissions/:id/approve` · `/decline` | admin decision |
| `GET /api/v1/federation/identity` | public, §6.2 |

Peer ↔ peer: snapshot v2 (§6.4, negotiated); the bootstrap admission action (§6.2 step 4) on
`/api/v1/comparison-peer`; the mutual-consent signal (§6.1.1). All additive: a v1-only peer
keeps comparing stats.

## 8. Phases

| Phase | Content | Depends on |
|---|---|---|
| P1 | §6.1 protocol fixes (mutual consent, remote consent state) + tests | — |
| P2 | snapshot v2 + achievements builder, consent group, version negotiation | P1 |
| P3 | identity endpoint, admission table, bootstrap action, admin approve/decline API, invitation link create/redeem | P1 |
| P4 | Freunde page, add dialog, landing pages, redirect, Mehr entry, Settings link | P2, P3 |
| P5 | admin page simplification (switch, requests, connected servers, Erweitert) | P3 |

**Status 2026-11-07:** P1–P5 built and merged on `feat/friends-compare` (@ 13415242d), plus an integration pass (four follow-up fixes, two-instance e2e in `scripts/e2e/friends-federation.mjs`, full Build Checks, Codex review without P1/P2). Not merged to `main`.

P2 and P3 can run in parallel (two workers). Two-instance end-to-end test on the
dev database with two backend ports before the RC (the sandbox recipe already runs two
servers), plus a browser look at iPad 1366/820.

## 9. Calls made after the builder check (mine, not the owner's)

1. **The mutual rule is retroactive.** An existing one-sided `accepted` consent stops being
   served until the other side accepts; the other side sees it as a request under Anfragen.
   The old behaviour broke a stated promise, the feature is beta, and the cost is a request to
   answer, not lost data. No migration of rows, only the serving rule and the request view.
2. **Federation off on the friend's server** → redeem refuses with
   `FEDERATION_ADMISSION_DISABLED`, copy: "Dein Server ist nicht für Verbindungen zu anderen
   Servern freigeschaltet — frag deinen Admin." Nothing is queued; there is no admin queue while
   federation is off.
3. **After SB's admin approves, SB's pin stands** whatever SA does — it is SB's admin's
   decision. The admission request to SA is sent by a job (`services/jobs/jobRegistry.ts`
   pattern) and retried with backoff until SA answers or the 14-day window ends. Outgoing
   request states: `pending` (own admin) → `sent` (waiting for SA's admin) → `approved` |
   `declined` | `failed` (SA refused the token: expired, used, unknown — reason shown) |
   `expired`. B sees each as its own sentence. The redeem response gains
   `"awaitingPeerAdmin"` for `sent`.
4. **Each side decides only for itself.** Step 2 asks "has SB pinned SA?"; step 4 asks "has SA
   pinned SB?". If SA already pinned SB (old manual flow), the bootstrap action skips SA's
   admin queue and goes straight to the claim; if SB already pinned SA, step 3 is skipped.
5. **The landing page `/freunde/einladung` is a static client page** that reads the fragment
   and sends nothing, so it needs no beta flag and no session; gating happens on the friend's
   own server at `/freunde/annehmen`, which follows that instance's `comparison` key (off →
   "Diese Funktion ist auf deinem Server noch nicht eingeschaltet").

## 10. Left to the builder

- How the mutual-consent state travels (§6.1.1) and how remote consent state is stored.
- The exact `catalogue` hash and which achievements are `comparable` (rule above; list goes
  into the PR for the owner to glance at).
- Copy wording within the DE/EN rule.
- Whether `/comparison/compare` replaces `/leaderboard` for the page or sits beside it
  (the leaderboard endpoint stays for boards).
