# Device-encrypted comparisons (protocol v2)

Implementation on `dev/federation-40`, 2026-10-13, `dennis/TravStats` forgejo#40.
This supersedes the v1 plaintext comparison transport, including plaintext group relaying.
No release or deployment is implied. Independent cryptographic review is still required
before production use; this is an application protocol built from Web Crypto primitives,
not an implementation of Signal, MLS, or a previously audited messaging protocol.

## Trust boundary

The logged-in owner's browser reads their travel data from their own TravStats server over
its ordinary authenticated connection. Only that browser encrypts a comparison publication.
The receiving browser verifies and decrypts it. Comparison servers store and relay ciphertext;
they receive no private device keys or publication decryption keys. The group host cannot
read another member's publication merely because it hosts the group. If its owner is a named
recipient, that owner's verified device can decrypt its copy like any other member.

This does **not** encrypt the source travel database. The source server already has the
original records. A compromised source server or a server serving malicious JavaScript can
steal plaintext or use browser keys. XSS, browser extensions, compromised devices, screenshots
and exported copies are outside this protection. Non-extractable keys prevent ordinary key
export, not malicious scripts from invoking them. Metadata remains visible: friendships,
rosters, public keys, sharing scopes, timing, sizes, recipients and access events.

There is no plaintext fallback. `/encrypted-share/links/:id/read`, `/encrypted-share/circles/read` and
the peer protocol's old travel-read operations refuse requests. Own-data preview remains
available only in the authenticated owner's session. Existing v1 grants need a device-encrypted
publication before any travel data is readable by a friend.

**Amendment 2026-10-16 (owner decision).** The leaderboard is no longer built on this protocol.
Its aggregate totals travel WITHOUT end-to-end encryption over the signed server-to-server peer
link; this lifts "no plaintext fallback" for leaderboard aggregates only (snapshot schema
`travstats-leaderboard` v1, `backend/src/schemas/comparison.ts` — totals, no records). Full
records never travel unencrypted. This protocol now lives at `/encrypted-share` behind the beta
key `encryptedShare`.

## Keys and verification

Each browser device generates separate P-256 ECDH (key agreement) and P-256 ECDSA (signing)
key pairs using `crypto.subtle`. The active private keys are imported non-extractable and
stored as CryptoKeys in origin-local IndexedDB, partitioned by account. Only SPKI public keys
are registered with the server. Up to five active devices per account are supported.

A SHA-256 fingerprint covers both public keys using sorted-key canonical JSON. Each friend
compares the full fingerprint with the other device over an independent channel (for example,
a phone call) and enters it. Alternatively, display the public-device QR code and read its image locally;
QR decoding fills the fingerprint but still requires explicit confirmation. Codes obtained
from the relay itself are not independent identity verification. Pins are stored locally, bound to the friendship channel or the
specific group member, not merely to any previously trusted fingerprint. New or substituted
keys are not silently trusted. All named recipients' devices must be verified before publishing.
The sender's current device is also included so the sender can retain an encrypted copy.

Device registration cannot replace keys or reactivate a revoked identity. A new key means
new verification. Revoking a sender device deletes its outgoing ciphertext. Revoking a
recipient device blocks ordinary retrieval with that identity, but does not undo knowledge of
old keys: ask senders to publish fresh packages excluding it. Every publication uses a new
content key. Membership changes advance the group audience version; old versions are no longer
served and every member must consent again. Previously downloaded material cannot be recalled.

At key creation the browser offers an encrypted recovery file plus a separate random 256-bit
recovery code. AES-GCM encrypts the private JWKs; neither plaintext backup nor code is uploaded.
Keep file and code separately. Recovery checks that the private-key metadata matches the
advertised public keys. A server-revoked or restore-suspended identity requires a new device
identity and fresh verification, even if its recovery file is available.

## Publication format

1. The owner chooses categories, domains, trips, year, precision and expiry, inspects the full
   data/file inventory and explicitly confirms. The preview JSON can be downloaded locally.
2. The browser rechecks the roster/device list, saves the directional grant and creates a
   random publication UUID. Signed context includes protocol version, friendship channel,
   versioned group audience, grant revision, sender fingerprint, creation and expiry times.
3. A fresh random AES-256-GCM content key encrypts the publication. For each recipient, an
   ephemeral P-256 ECDH exchange and HKDF-SHA-256 derive a wrapping key; AES-GCM wraps the
   content key. HKDF info binds protocol, context and recipient fingerprint.
4. Files are split into 256 KiB plaintext chunks. Each uses a fresh random 96-bit IV and a
   128-bit GCM tag. Associated data binds protocol, full context and chunk index. Names and
   file layout are inside the encrypted index, not public chunk metadata.
5. The sender signs the canonical manifest with ECDSA-SHA-256 (IEEE-P1363 encoding). It binds
   context, ephemeral public key, every recipient's wrapped key, the ordered SHA-256 ciphertext
   digests and the encrypted index range. This prevents a recipient who knows the content key
   from forging another sender's publication or changing recipients, content, order or length.
6. The source validates the active sender identity, grant/revision, signature, complete chunk
   inventory and quotas before atomically making the publication readable. Failed uploads
   never become partial readable publications. Superseded ciphertext is pruned.
7. Recipients require a locally verified sender pin and matching current device advertisement,
   verify the signature/context/expiry, unwrap their content key and verify each ciphertext
   digest and GCM tag. Malformed JSON, impossible file ranges and excessive nesting are rejected.
   Local freshness high-water marks reject rollback behind an already observed publication.

The implementation follows the primitives specified by the
[W3C Web Cryptography API](https://www.w3.org/TR/webcrypto/). It does not claim forward secrecy
against later compromise of recipient private keys. A malicious relay can withhold data and,
before a device has seen a newer version, replay a still-valid older publication. Signed
freshness/expiry and local rollback detection make those limits explicit, not impossible.

## Groups and server transport

The original admitted-server HTTPS and Ed25519 request/response signatures remain as a second,
server-to-server layer. They do not replace device-key verification. Same-instance comparisons
use the identical encrypted-publication format, without unnecessary HTTP calls.

A group remains a named roster of up to 20 people. The host distributes public device lists
and relays opaque manifests/chunks. Every source still checks its grant, current group version
and link before serving data. Every member approves the complete device audience locally.
Adding/removing members invalidates the old audience. A host outage does not widen access.
Personal and group publications are separate; a wider personal grant never fills group cells.
Unlike v1, a group can explicitly share all categories, not just statistics.

## Complete travel-data comparison

`e2e/graph.ts` names every traversed relation; `fieldInventory.json` explicitly classifies
all scalar fields on those models. Tests fail when a field is added without classification or
a User relation has no inclusion/exclusion decision. Nothing queries User credentials,
settings secrets or operational queues for a comparison export. Storage paths, share tokens
and device/provider bookkeeping are excluded. Unknown new fields never inherit old consent.

The full unrestricted grant includes all nine travel domains and nested stored travel content:
journeys, lodging, places/lists, tours/roadtrips, routes/tracks and recorded geometry, stops,
journals, notes, companions, bookings, expenses, loyalty data, documents, receipts, country-day
and photo/stay evidence, and achievements. Related photos and linked Immich album originals
are served through owner-authorised source endpoints; external credentials and URLs are not
forwarded. A missing file, unreachable linked library or capped album listing aborts publication
rather than producing a silently incomplete package.

The receiving UI (`/encrypted-share`) has no ranking table of its own; the leaderboard is the
separate `/compare` page, built from server-side aggregates only and never from these
packages. What the receiving UI provides is a generic comparison of any shared field,
including nested fields, across people: values, counts, sums, averages and extrema. Missing observations stay absent. Different currencies are not silently combined.
Full records can be inspected/exported, recorded lines compared locally without tile-provider
requests, photos explicitly previewed as safe bitmap blobs, and original files downloaded.
This gives field-level coverage; it does not reproduce every specialised statistics dashboard.
Derived provider routes not stored in TravStats are not invented as recorded data.

Filters still mean exclusion. Year-scoped exports omit undated/multi-year child collections
rather than leaking other years and identify those exclusions in the preview. Domain/trip
selection omits unrelated shared catalogues or trip-wide content. For all stored travel data,
choose all categories/domains and no year/trip restriction. Documents and photos share their
full contents, including any personal information or costs embedded in those files.

## Freshness, capacity and recovery

Publications are explicit snapshots, updated by publishing again from an online device.
There is no server-side automatic encryption or background plaintext fallback. The future-trip
option controls scope at republication, not an unattended server job. A package expires at
its chosen grant expiry or after 30 days, whichever comes first. The UI shows source timestamps
and ranks only matching periods/definitions/coverage/precision.

Current explicit resource limits: 20 group members, five devices per account, 100 publications
per owner, 8,192 chunks per publication, 1 GiB total encoded ciphertext per owner, 512 MiB per
file and 64 MiB encrypted-index plaintext in the browser. A fixed trip selection supports
500 trips. The old 5 MiB file ceiling is gone. Oversized inputs fail visibly; they are not
truncated. Incomplete uploads expire after one day when the next upload starts; expired
ciphertext is also pruned there. Browser previews of bitmaps are limited to 30 MiB.

Database migrations are additive. The application restore hook additionally revokes all
comparison devices and deletes ciphertext before the restored instance resumes comparisons.
External SQL/machine restores must still follow the manual federation suspension procedure.
No private key lives in the database backup; users need their separate device recovery files.

## Validation in this task

- Real Web Crypto encryption/decryption, multiple recipients, wrong keys, signature and chunk
  tampering, ordering/truncation, expiry, fresh keys after recipient removal and key recovery.
- Full transport round-trip with nested data and a file larger than 6 MiB, verified byte-for-byte
  by SHA-256; ciphertext-only uploads and rejection of unverified sender identities.
- Isolated PostgreSQL tests for complete field/root inventory, owner/category separation,
  immutable/atomic publication, grant/device revocation and three-person group membership changes.
- Real Chromium browser contexts against the real comparison routes and an isolated synthetic
  test database: device creation/IndexedDB, fingerprint verification, consent, full publication,
  recipient decryption, original document download and a full-data three-person group. Desktop
  and 390-pixel mobile smoke tests, no page errors or horizontal page overflow.
- TypeScript, targeted lint, locale parity, API-shape/no-store, restore and schema-drift checks.

The initial browser run used a loopback test server. A subsequent sandbox run exercised two
independent instances and databases through actual HTTPS, DNS/IP pinning and Ed25519 signatures.
All 13 checks passed: bidirectional exchange; nonce replay/tampering; wrong signing pin and TLS
hostname; invitation/confirmation/device discovery; plaintext fallback rejection; incomplete
publication; a 32 MiB encrypted round-trip with matching SHA-256 and duplicate chunk retry;
unverified sender rejection; outage/recovery; grant revocation; sender revocation/replacement;
and disabled peer. The transfer took 12.46 seconds in this lab, not a performance guarantee.

This found and fixed a Node 22 pinned-DNS callback incompatibility. The dedicated TLS regression
test opens a real Node socket with family autoselection enabled globally. The application now
explicitly connects using the selected family/address. No SSRF or TLS check was disabled.
See [sandbox driver and repeat instructions](../scripts/federation-sandbox/README.md).

The sandbox contains both instances on one VM and uses its own trusted test CA. Public-Internet
connectivity, reverse proxies, IPv6-only peers, mixed application versions and multi-host
failures remain untested. This was not a production rollout or an independent security audit.

## Sharing controls added after the sandbox review

The device screen exposes a QR code containing only its versioned public fingerprint. A locally
read PNG/JPEG/WebP image (maximum 5 MiB) can fill the verification field; matching and explicit
confirmation still happen against the selected friend's/group member's current public keys.
No QR image is uploaded. Manual fingerprint entry remains available; live camera scanning is
not implemented.

The owner-only sharing overview lists recipients/group membership where available, categories,
domains, year/trip selection, publication timestamp and expiry. It distinguishes completed
packages, missing/new consent revisions, expired/revoked grants and changed/unavailable groups.
It is a metadata summary, not a guarantee of current reachability: every actual retrieval
reauthorizes its grant, audience and device. New or edited travel records still require manual
republication; automatic source-change detection and resumable uploads remain open. Revocation
copy explicitly says that downloaded/decrypted copies cannot be recalled.

Additional validation after these controls: 46 selected backend tests and 103 frontend tests
passed, including owner-only publication status, QR format rejection and share-state handling.
The PostgreSQL integration run used a 30-second per-test allowance after two default-five-second
runs timed out under local load; the timeouts are not counted as passes. A Chromium smoke run
rendered a real QR, captured it as PNG, decoded it with ZXing, required manual confirmation,
and displayed synthetic sharing metadata at desktop and 390-pixel widths without page errors
or horizontal overflow. Targeted lint, TypeScript and the complete frontend/backend production builds
passed. The frontend build retains large-chunk/vendor-comment warnings.
