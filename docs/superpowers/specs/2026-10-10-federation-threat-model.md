# Federation — consent, friends, leaderboards and threat model

Status: revised concept for owner review, **2026-10-13**. Tracks `dennis/TravStats` forgejo#40.
Supersedes the aggregates-only draft of 2026-10-10. Documentation only; no implementation,
migration, deployment or security approval is implied.

## 1. Product direction and decision status

Owner direction on 2026-10-13: people who explicitly want to compare should be able to
compare all their travel data. The owner requested a revised concept, a leaderboard example
and support for multiple friends. The former absolute ban on records and the four-metric
ceiling no longer apply. Details below are design proposals, not additional owner decisions.

The governing rule is: **send only data the owner explicitly authorised for this recipient,
for this purpose, within the selected scope and while the permission remains active.**
A schema helps enforce field boundaries; it does not prove that data cannot disclose sensitive
information. Precise statistics, records and combinations of fields can all reveal movements.

The feature supports multiple friends, on the same instance or on different admitted
instances. A friendship does not require exclusive pairing. Server admission, friendship,
data permission and group membership are separate decisions.

Comparison is read-only. It must not create trips in the recipient's travel log, change their
statistics or grant edit rights. Copying/importing trips and collaborative editing remain
separate workflows governed by `2026-10-09-trip-sharing-design.md`. That design's automatic
fact propagation and retained independent copies do not define comparison semantics.

## 2. What a user may share

| Permission | Available content | Default before explicit approval |
|---|---|---|
| Statistics | All supported metrics across enabled travel domains: counts, distances, durations, countries, airlines, airports, accommodation, cruise, rail, road and other domain analyses | Off |
| Travel details | Selected trips or all trips, dates, places, routes, transport and accommodation details, maps and tracks | Off |
| Costs | Prices, expenses and cost analyses, with currency/conversion basis displayed | Off; separate choice |
| Personal content | Notes, journal, ratings and named companions where applicable | Off; separate choice |
| Photos | Selected photos or the selected trips' photo collection | Off; separate choice |
| Documents and booking details | Documents, booking references and other explicitly listed travel fields | Off; separate choice with exact preview |

“All travel data” is a supported preset that visibly selects these categories and requires
confirmation of the resulting preview. It is not a hidden exclusion of inconvenient fields.
Account passwords, API keys, session tokens and server credentials are never travel data and
are never available for sharing. Documents and companions may concern other people: the
preview must make the included content apparent rather than treating it as an anonymous total.
New field categories added in future releases do not inherit an old “all” permission.

Each directional grant includes:

- Named recipient and their server; purpose: personal comparison or a named group.
- Categories and fields; enabled domains; all trips or a specific selection; date range.
- Whether future matching trips/updates are included, explicitly chosen (default: a fixed selection).
- Precision and freshness: exact or reduced precision; snapshot or continuing updates.
- Optional expiry; preview of the actual outgoing content and a persistent permission summary.

A may share full details with B while B shares only statistics with A. Neither choice expands
the other. A statistic-only grant is computed at the source and sends no underlying records.
A details grant never implicitly enables photos, costs, documents or personal text.

## 3. Multiple friends and groups

### Personal view: “Meine Freunde” / “My friends”

A can link independently with B, C and D and compare their authorised statistics locally.
B does not thereby learn that C exists or see C's values. This view is private to A; there is
no shareable board URL or server-side export of other people's rows in the initial design.
The comparison interface cannot prevent screenshots or manual copying.

### Shared view: “Reisegruppe” / “Travel group”

A group is a separate, explicitly accepted audience. Each member sees the roster and the
participating server origins before sharing. Joining is not consent to disclose every field.
Group statistics and permission to open another member's trip details are separate grants.
A group organiser manages invitations and the roster; they cannot approve data sharing for
another person or increase anyone's permissions.

Proposed first version: at most **20 members per group**, a product/operational limit to review,
not an anonymity guarantee. Three friends on three servers can form one group. Every required
server pair must be admitted; the setup screen names missing admin approvals.

Membership has a version. Existing grants enumerate their approved recipients and membership
version. Adding a member starts a pending expansion: the new member receives no existing
member's values until that member approves sharing with them. Existing members can keep
comparing within the previous audience. The newcomer sees “awaiting sharing approval”, not
ranks or totals from which hidden values can be inferred. Removing a member blocks future
access immediately and invalidates queued deliveries to them. Invitations and full roster
visibility themselves require an accepted group invitation; no public group directory.

Each source sends its own authorised data directly to each approved recipient's instance;
an organiser or group coordinator must not relay friends' data. A coordinator may distribute
versioned membership proposals, but sources validate membership changes against their own
users' decisions. Audience expansion needs an authenticated approval from each data owner.
Same-instance access uses the same grants and audience rules without unnecessary network calls.

There is no anonymous/public/global leaderboard in this scope. A small group of consenting,
identified friends needs no artificial minimum group size. A minimum size by itself would
not anonymise visible individual rows anyway.

## 4. Leaderboard concept

Illustrative data only. Every visible cell below assumes permission for this viewer.

```text
Vergleichen                                     [+ Freund verbinden]
[Meine Freunde] [Reisegruppe: Fernweh · 4]        [Freigaben verwalten]

Zeitraum [2026 ▾]  Bereich [Alle ▾]  Rang nach [Flugdistanz ▾]
Ansicht  [Rangliste] [Direktvergleich] [Karte]

Platz  Person       Flüge   Flugdistanz   Länder   Tage unterwegs
  1    Anna           32     68.420 km       14          46
  2    Du             27     54.810 km       11          39
  3    Ben            18     31.260 km        —          28
  —    Chris          12       privat         7          21

— = nicht freigegeben oder nicht verfügbar (Details am Feld)
3 von 4 Personen nach Flugdistanz vergleichbar.
Anna: Stand 13.10., 08:00 · Ben: Stand 11.10., 18:20 · Chris: Stand 13.10., 08:00

[Anna und mich vergleichen]    [Weitere Kennzahlen auswählen]
```

The private “Meine Freunde” tab contains only direct contacts. The group tab uses group-scoped
grants; broader personal grants do not silently supply cells or drilldowns in the group view.
The app can offer an explicit switch to the separately authorised personal comparison.

Selecting a row opens a read-only comparison with tabs such as Übersicht / Reisen / Karte /
Kosten / Fotos, **only when the viewer has the corresponding permission**. No permission is
inferred from an enabled tab on the sender or from seeing the person's rank. A full-details
comparison can show both people's routes, visited places and individual journeys side by side.
Document access remains a deliberate action, not an automatic leaderboard download.

Ranking rules:

- Sort by one selected, mutually comparable metric; ties share rank (1, 1, 3).
- Missing, withheld or unsupported values are never zero and receive no rank.
- Show source freshness and coverage per person. Stale/offline rows remain visibly stale and
  can be excluded; do not silently label an incomplete table “current”.
- Use existing TravStats counting rules, completed/planned status rules and local-date
  conventions. Transmit metric definition/version, period, units, precision and coverage.
- Partial trip selections are labelled “selected trips” and excluded from a full-year ranking
  by default. A clearly labelled selection comparison may be chosen separately.
- Incompatible definitions, currencies or precision cannot produce a false exact ranking.
  Reduced-precision ranges that overlap are shown as indeterminate, not arbitrarily ordered.
- The user chooses metrics rather than receiving a universal “best traveller” score.
- Values are reported by the source server; signatures prove origin, not truthful travel.

For DE/EN delivery, use equivalent labels: Vergleichen / Compare, Meine Freunde / My friends,
Reisegruppe / Travel group, Nicht freigegeben / Not shared, Stand / Updated,
Freigaben verwalten / Manage sharing. Full UI copy ships together in both languages.

## 5. User journey and permissions

1. Both admins admit the peer origins and verify key fingerprints out of band. This allows
   communication but exposes no user data. Same-instance friendships skip this step.
2. A creates a high-entropy single-use invitation, stored hashed, proposed expiry 72 hours.
   B accepts while logged in. Both confirm a short comparison code bound to this specific
   handshake and both participants; the six digits are not a standalone login credential.
3. Each person chooses their own directional permission, previews values and recipients,
   and confirms. Nothing is enabled by accepting a friendship alone.
4. Multiple accepted friends populate the private board. A shared group is offered as a
   separate action with explicit audience and membership rules from section 3.
5. “Who can see what?” shows active permissions, recipients, server origins, last successful
   disclosure, scope and expiry. Users may narrow, pause or revoke each grant independently.

Example confirmation:

> Du teilst mit Anna auf ihrem TravStats-Server: alle Reisen von 2020 bis 2026 einschließlich
> genauer Orte und Zeitpunkte. Kosten und Fotos sind eingeschlossen; Dokumente und
> Buchungsreferenzen nicht. Neue Reisen werden nicht automatisch ergänzt.
> Anna und die Betreiber ihres Servers können übertragene Daten speichern.
> Ein Widerruf stoppt weitere Zugriffe, kann bereits angefertigte Kopien aber nicht zurückholen.

Proposal for continuing updates: source-controlled refresh no more often than daily by default;
a user may explicitly send a new snapshot. A privacy-oriented monthly/rounded mode remains an
option rather than a mandatory restriction. Exact timestamps and current/future trips require
clear inclusion in the preview. The peer cannot poll around the selected freshness boundary.

## 6. Authorisation and protocol contract

Use separate versioned, strict Zod message schemas for control, statistics, travel records and
attachment manifests. Do not send an entire ORM object, database dump or generic JSON blob.
Free text and records are now allowed only in named categories with bounded lengths, field
allowlists and domain-specific schemas. Unknown fields fail closed on sender and receiver.

A proposed grant records owner, recipient identity (instance + opaque local subject), purpose,
optional group ID and membership version, resource selection, field categories, date scope,
future-data policy, precision, freshness, expiry, status and monotonically increasing revision.
Remote identities are scoped to their pinned instance; a remote ID must never resolve directly
to a local user or trip ID. External comparison data stays separate from owned travel records.

Every read or outgoing delivery checks the current source-side grant, authenticated recipient,
resource ownership and group audience. The sender filters the projection **before serialising**,
then validates it. Client-provided user IDs, group roles or requested fields cannot widen it.
Receiver checks the addressed local recipient and stores data in a recipient-scoped cache.

Queued jobs contain a grant reference, not a permanently authorised payload. They recheck the
latest revision immediately before sending. Grant narrowing/revocation invalidates pending
jobs and attachment access; requests already delivered or in flight cannot be recalled.
Use sequence/revision checks and revocation tombstones so delayed messages do not resurrect
removed content. Honest recipients purge removed fields, search indexes, thumbnails and cached
records. A grant that expands fields requires a new user confirmation.

Attachments are fetched only on explicit access using short-lived, audience-bound authorisation
that still checks the live grant. No public bucket URL, source credential or provider token is
forwarded. Validate MIME/content, cap bytes and counts, and isolate document rendering. Serving
photos must account for embedded location metadata and selected redaction. Do not fetch arbitrary
URLs embedded in peer records. Controls may use a small body cap; record pages and attachment
streams need separately specified limits, pagination, quotas and cancellation. The old universal
4 KB cap is unsuitable for this design. Exact budgets are an implementation review gate.

## 7. Trust, transport and deployment isolation

Retain these protections from the previous draft:

- Explicit canonical HTTPS origins and pinned instance signing keys; mutual peer admission.
  No public user search or enumeration. Uniform unauthorised responses and bounded work.
- Authenticated, recipient-bound requests with replay protection, nonce/time validation and
  monotonically increasing message revisions. Signing format and canonicalisation require
  documented test vectors and security review before implementation is accepted.
- Peer egress accepts public destinations only, validates DNS at connection time and connects
  to the checked address. Block private/link-local and equivalent IPv6/mapped ranges; reject
  redirects. Deliberately different from LAN-capable Immich integration.
- Limits per authenticated peer, user/link and source address, plus total bandwidth, storage
  and fan-out budgets. One large group must not exhaust the instance.
- `Cache-Control: no-store` for authenticated comparisons and federation endpoints; no payloads,
  invitation codes, signed attachment credentials or travel details in ordinary logs.
- An authenticated user-visible disclosure audit records recipient, category/resource IDs,
  grant revision, time and result. Avoid a second permanent copy of all shared documents in
  the audit. Audit retention and cache retention must be specified before implementation.
- Private keys stay outside database dumps. A restored/staging clone starts with federation
  disabled until explicitly re-enrolled; origin checks alone do not detect a same-origin clone.
  Backups/restores must not silently reactivate grants or outbound jobs. Compromised keys
  require out-of-band re-pinning; ordinary signed rotation is insufficient after compromise.

Retain the previous proposal that LAN-only instances do not expose federation UI/routes;
require verified peer reachability during setup. Same-instance comparisons do not inherently
require public internet reachability and should remain available locally. LAN-only cross-server
participation is a separate unresolved product choice, not smuggled in through group support.

## 8. Threats and honest limits

| Threat | Main control | Remaining limit |
|---|---|---|
| More fields or trips sent than approved | Source authorisation, field projection, strict schemas, negative permission tests | Authorised precise details intentionally disclose movements |
| A friend's friend sees data without consent | Recipient-scoped grants; no transitive friendship or data relaying | Recipients can manually copy data |
| Group addition silently widens audience | Versioned membership; approval by each data owner for new recipients | Group membership itself reveals social connections |
| Foreign server/admin stores travel history | Explicit server identity and informed consent; minimise transferred data | Plaintext processed on that server is accessible to its operators; no E2E confidentiality is claimed |
| Inferring trips from exact or repeated statistics | User-selected scope/precision/cadence; explain inference | Even aggregates are not anonymous |
| Revocation races, retries or stale attachments | Current-grant checks, revisions, tombstones and cache purge | Delivered/in-flight data and external copies cannot be recalled |
| Malicious documents, text or photos | Bounded schemas, output escaping, isolated rendering and file validation | Rich content increases parser and storage attack surface |
| Peer impersonation, stolen invitation, replay | Pinned keys, verified handshake, signed audience-bound requests | A compromised peer can impersonate its local users |
| Internal network access via peer/media URLs | Connection-time public-address checks; no arbitrary media fetch | Egress rules require ongoing coverage |
| False rankings or incompatible totals | Metric versions, coverage/precision labels, source attribution | A source can fabricate its own numbers |
| Database clone starts publishing | Disabled-on-restore federation and explicit enrollment | Full environment copies require operational isolation too |

The user's own administrator already controls local data. Application consent checks cannot
protect against an administrator modifying the database or software. They prevent ordinary
product actions from silently sharing users' data; they are not a cryptographic barrier to
that administrator.

## 9. Validation required for implementation

- Permission matrix across all domain fields/categories: no grant, narrow grant, all-data
  grant, expired grant, wrong recipient, wrong instance, wrong trip owner, unknown new field.
- Three users A/B/C: A's links to B and C do not allow B to discover C or receive C's values.
- Groups across three instances: adding D reveals nothing until each sender approves D;
  removal, invitation expiry, membership conflicts and blocked peers fail closed.
- Revocation/narrowing during queue execution, attachment transfer, retries, offline recovery
  and restore; no resurrection after tombstones and no access through old attachment URLs.
- Statistics-only mode emits no detail records; all-data mode includes exactly the selected
  travel categories, never account/server credentials. No remote data enters owned trip stats.
- Leaderboard handles ties, missing/withheld values, stale data, partial coverage, differing
  definitions, precision and currencies without inventing ranks or zeroes.
- Existing counting homes remain authoritative; comparison matches source statistics for
  equivalent filters. Disabled domains and mixed-version peers are explicitly handled.
- Protocol vectors, replay and SSRF cases, request/file quotas, injection/rendering tests,
  private caching rules and payload-free logs. Two/three-instance end-to-end tests.

No application tests have been added by this documentation revision. The list is the delivery
acceptance plan, not a claim that these checks exist or pass.

## 10. Delivery sequence and remaining decisions

| Phase | Deliverable | Exit condition |
|---|---|---|
| F0 | This revised concept, UX review, field inventory and security review | Approved scope; concrete schemas, budgets and retention rules |
| F1 | Instance admission, identity, transport and restore isolation; no travel data | Authentication/refusal/clone tests on isolated test instances |
| F2 | Multiple friendships, directional grants, broad statistics and private friends board | Permission matrix and counting/ranking tests; beta-gated |
| F3 | Scoped read-only travel details, then costs/personal content/photos/documents | Category-specific preview, authorisation and content-handling gates |
| F4 | Shared group board with membership-version consent and direct source delivery | Three-instance group/audience-change tests and security review |

All travel categories are part of the target concept; phased implementation must clearly label
which are actually supported. Do not advertise “all travel data” before the inventory is covered.
Register behind `betaFeaturesEnabled` with `why`/`returnsWhen`; respect `useEnabledDomains()` and
shared domain registration; deliver DE/EN together. No release estimate is asserted here.

Review choices still open: mutual admin admission UX; daily versus other refresh defaults;
20-member initial cap; attachment quotas and retention; exact handshake/signing format; whether
LAN-only cross-server participation should later be supported. These do not undo the owner's
requested direction of explicit sharing up to all travel data and multiple friends.
