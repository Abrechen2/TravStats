# TravPlan guests — a person from another server edits one plan

Status: built behind the beta key `travPlanGuests` (forgejo#404, spec
`docs/superpowers/specs/2026-10-17-travplan-v2-design.md` §6.5, decision D4 path A). This file is
the threat model the spec asks to have reviewed before the key is removed.

## What it is

The owner of a plan on server **H** (host) invites a person who has an account on server **G**
(guest server). G's admin and H's admin have pinned each other's Ed25519 key and verified it
(Admin → Instanz, the connection file with the fingerprint compared out of band). The guest opens
a link on H, G signs a short statement "this account is who the invitation meant", and H gives the
guest's browser a session for **that one plan**. The guest works in H's own web UI (`/guest/plan/<tripId>`)
or, with a phone token, in the Companion. G never sees a byte of the plan; H never calls G.

## Trust, in one sentence

Server-level key pinning is the whole trust: H believes a vouch exactly when it is signed by the key
H's admin pinned for the origin the vouch names, and it re-checks that pin on **every request**.

## The flow

1. Owner: `POST /trips/:id/plan/guests {origin, username}` (owner only; `origin` must be a pinned,
   enabled, verified peer). Creates a `remote` member in status `invited` and an invitation: 32
   random bytes, stored as a SHA-256 hash, single use, seven days. The answer carries the link
   `https://<host>/plan/join#<inviteId>.<secret>` once. `username` is a label, never an identity.
2. Guest opens the link (the secret lives in the fragment, which is not sent to a server). The page
   calls `POST /guest/join/start`; H checks the secret in constant time and answers one 404
   (`PLAN_GUEST_INVITE_INVALID`) for unknown, wrong, used, expired and withdrawn alike. H stores a
   fresh 256-bit nonce **bound to this browser** by an HttpOnly cookie `ts_guest_join` (hash kept),
   valid ten minutes, and returns the vouch URL on G.
3. On G: `/federation/vouch?host=&invite=&nonce=`. G requires the person's own session, checks that
   `host` is one of its admin's verified peers (otherwise `PLAN_GUEST_HOST_NOT_ADMITTED`), shows
   "Bei <host> als <name> bestätigen?" and on consent signs the **vouch**
   `{v:1, iss, aud, sub, name, invite, nonce, iat, exp}` (exp − iat ≤ 120 s) with its Ed25519 key over
   `"travstats-vouch/1\n" + canonical JSON`. `sub` is an HMAC of the account id per host: stable for
   H, unlinkable across hosts. The browser is redirected to `https://<host>/plan/join/callback#vouch=…`
   — the fragment keeps the token out of every proxy and access log; the callback path is fixed.
4. `POST /guest/join/complete`: H looks the issuer up in its pins (enabled **and** verified), verifies
   the signature with the pinned key, the audience (= H), the clock window, canonical encoding, the
   nonce's browser cookie, that the invitation id and the member's origin match, then consumes nonce
   **and** invitation with conditional updates (`used_at IS NULL` → count 1) in one transaction. The
   member becomes `active` (`remote_subject = sub`) and H issues the session: cookie `ts_guest`
   (HttpOnly, SameSite=Lax, `Secure` by the instance's cookie rule, path `/api/v1/guest`), 30 days
   sliding, only a hash stored, remembering the **fingerprint of the issuer's pinned key**.
5. Phone: a browser session may mint up to five `ts_gpat_…` tokens for the same plan (90 days).

## Principals and isolation

- A guest is never a user. `authenticateGuest` reads only `ts_guest` or `Bearer ts_gpat_…`, sets
  `req.guest` and never `req.userId`. A user JWT/PAT at the guest door is refused (401
  `PLAN_GUEST_REQUIRED`) and `authenticate` reads neither guest credential, so a guest credential
  opens nothing else. `guestDoor.enumeration.test.ts` walks the mounted router table: every
  endpoint that answers 401 to an anonymous caller answers 401 to a valid guest cookie and token.
- Plan scope: `:planId` must equal the credential's plan (404 `PLAN_NOT_FOUND`, the answer for a
  plan that does not exist); `planAccess` re-checks it against the member row.
- Cookies are scoped by path to `/api/v1/guest`, so the browser does not even send them elsewhere.
- CSRF: a cookie-authenticated write needs the header `X-TravStats-Guest: 1` (a cross-site form or
  image cannot set it without a CORS pre-flight, which the API does not grant). Bearer tokens are
  not ambient and need no marker.
- What a guest may do = what a local editor may do (D3). Owner-only acts (delete, members, AI policy,
  anything that writes the owner's logbook) refuse with `PLAN_OWNER_ONLY`; there is no route for
  deleting a plan or managing members on the guest door. Weather, climate, routing and place
  searches count against the **owner's** daily limits, never a guest's.
- Documents (D6): a guest sees only documents on the plan's bookings and ones members uploaded for
  the plan (`travel_plan_documents`); the owner's other documents answer 404. Files are served as
  attachments with `nosniff` and `Content-Security-Policy: sandbox`.

## Revocation — all of it fails closed

| Event | Effect |
|---|---|
| Owner removes the guest | member `revoked`, subject released, **all** credentials and open invitations deleted in one transaction; the next request is 401 |
| Guest leaves / logs out | member `left` / this credential deleted |
| Peer disabled, suspended, unverified | every request of that server's guests is refused (`PLAN_GUEST_REVOKED`) at once, because each request asks the pin; the admin hooks additionally revoke the members for good |
| Peer key replaced | credentials remember the old fingerprint → refused; the hook revokes the members; re-enabling later does **not** bring them back, the owner invites again |
| Restore of a backup | `end_plan_guests` step: every remote member revoked, every credential, join and invitation deleted |
| Plan deleted | member rows cascade; the credential finds no plan |
| Federation switched off | invitations and joins refuse (`PLAN_GUEST_FEDERATION_OFF`); existing credentials keep working only while the pin does |

## Limits

120 writes/min and 600 reads/min per **member** (not per address), 30 join attempts per 10 min per
masked address, uploads ≤ 20 MB and ≤ 50 documents per member per plan, at most 5 phone tokens per
member, ≤ 10 non-owner members per plan, ≤ 20 remote members per host.

## Threats considered

| Threat | Answer |
|---|---|
| Forged vouch / rogue server | Verified only with the pinned key of `iss`; unknown or unverified issuer → same refusal; tests: forged key, unadmitted issuer |
| Vouch for another host (token reuse) | `aud` must equal H's origin; G signs only for hosts its admin verified |
| Replay of a vouch | nonce is single use (conditional update) and bound to one browser; exp − iat ≤ 120 s |
| Login CSRF (an attacker's vouch finishing in the victim's browser) | the nonce is bound to the browser that started the join (cookie hash) |
| Cross-protocol signature reuse | domain prefix `travstats-vouch/1\n`; envelope purposes are distinct |
| Non-canonical encodings | only the canonical spelling verifies |
| Open redirect | G redirects only to a verified peer, to a fixed path; the page also checks the origin |
| Invitation guessing / probing | 256-bit secret, hashed, constant-time compare, one answer for every failure, rate limited |
| Token theft from the host's database | only hashes stored |
| Stolen guest cookie | scoped to one plan, ends with the member, the pin or the 30-day idle expiry; no way to the owner's account |
| Malicious guest content | all plan JSON is Zod-validated like any member's; documents are sandboxed attachments |
| Guest exhausting the owner's quota | per-day owner limits apply; per-member rate limits |
| Host trusting a changed key silently | fingerprint is part of every credential; replacing the pin ends them |

## Residual risks and open points

- G's admin controls G's accounts: a malicious G admin can vouch for anyone **as a person named in an
  invitation addressed to G**. The invitation is addressed to the origin, not a person; an owner must
  send the link to the right person. This is inherent to server-level trust (D4) and is why the
  owner sees the guest's display name and can remove them at once.
- `username` in the invitation is a label only; the member's display name is what G vouches.
- Rate limits are in-process (single instance), as elsewhere in the app.
- Not built (see the spec): the guest's own logbook copy of the confirmed trip (§6.7) and the route
  in the co-planner's linked copy (D5) need the roadtrip exchange format v4.
