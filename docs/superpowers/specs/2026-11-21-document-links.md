# One document, many entries (owner, 2026-11-21)

## Owner's words

> "Wenn ich bei einem Flug ein Dokument hinterlege, wie Ticket, dann ist es der
> Beweis für den Flug. Wenn ich eine Reise habe, gibt es vielleicht ein Dokument
> von einer Rundreise, wo der Flug auch integriert ist. Dann müsste bei diesem
> Flug auch das Dokument von der Reise referenziert werden."
> Decision: a real link, not a derived "show the trip's documents" view.
> "Das gilt ja für alle Domains."

## Today

`Document` (schema.prisma, model `Document`) has at most ONE owner: ten nullable
FKs (`flightId`, `cruiseId`, `lodgingStayId`, `tripId`, `placeVisitId`,
`railJourneyId`, `rentalBookingId`, `busJourneyId`, `ferryJourneyId`,
`tripExpenseId`) and a CHECK that at most one is set. Deleting the entry
cascades to the document. An unfiled document expires 30 days after
`unlinkedAt`. A package booking filed on the trip is therefore invisible on the
flight, stay and transfer it covers.

## Rules

1. **Every domain.** Any document can be linked to any number of entries of any
   domain the schema has a document FK for today, plus the trip. A new domain
   registers its link target in one registry; a test fails when a domain in
   `shared/domains.ts` has no entry (or a written reason why not), as
   `shareTypes.test.ts` does for sharing.
2. **One file, many links.** Never a copy per entry. A link has a role:
   `primary` (where it was filed, at most one per document) or `covers` (an
   entry it is evidence for). The primary is a display and compatibility
   choice, never an authorisation or retention owner.
3. **Provenance visible.** Each link says how it came to be: `user`, `parser`
   (package/multi-leg import), `suggestion` (accepted from the inbox),
   `legacy` (backfilled from the old FK). The entry's document list says
   "Beleg aus: <primary entry>" for a `covers` link.
4. **Never silent.** A parser links only what the user confirmed in the
   package review. Links for documents already stored are proposed in the
   inbox and wait for a decision; a decision persists (content key, as the
   inbox fix of rc.38).
5. **Deleting an entry removes its links, not the document.** The document's
   row and file go only on an explicit "delete document everywhere", account
   deletion, or when the last link is gone and the 30-day grace from
   `unlinkedAt` has run out. The UI offers "remove from this entry" and
   "delete everywhere" separately, and the latter lists every entry it affects.
6. **No new visibility.** A document stays readable only by its own account.
   A link never grants access: trip membership, a shared trip or a federated
   copy sees no document, file name or link metadata (today's
   `trip/exchange/memberScope.ts` strip stays). The target of a link must
   belong to the document's account, checked in the same transaction.
7. **Counted once.** Counts are distinct documents per scope: once per entry,
   once per place/trip/account. A `covers` link never creates an expense or
   copies a booking total; costs stay where they are allocated today.

## Data model (expand → contract)

- New table `document_links`: `id`, `document_id` (FK, cascade), one nullable
  FK per target type (real FKs, not `entityType + entityId`, so cascades and
  ownership hold in the database), `role`, `provenance`, `created_at`.
  CHECK exactly one target set; unique `(document_id, <target>)` per type;
  partial unique "one primary per document"; an index per target FK.
- `rentalCategory` moves onto the rental link (it describes the document's
  role for that rental).
- **Expand:** create the table; backfill every filed document as one
  `primary / legacy` link; switch the old FK cascades to `SET NULL` so deleting
  the primary entry no longer deletes a document that other entries still
  use; keep the old columns as a projection of the primary link (dual-write)
  for installed Companion versions. Migration replay test against rows of
  every old shape (each FK, receipts, unfiled), template
  `migration.loyaltyMemberships.test.ts`; `check:drift` stays green.
- **Contract (later release, own plan entry):** drop the old CHECK and FK
  columns once no reader and no supported app version uses them.

## Lifecycle

- `unlinkedAt` is stamped on the transition to zero links and cleared on the
  first link; the sweep re-checks "zero links and expired" inside the delete
  transaction (today it selects, then deletes by id — a relink in between
  would be lost).
- Trip delete removes links to entries actually deleted; entries detached from
  the trip keep theirs. Trip merge remaps and de-duplicates links before the
  source is removed (`tripCleanupService.ts` moves `Document.tripId` today).
  Undo restores exactly the links it removed.
- Receipts (`documents/receipts.ts`) reconcile only the links they manage and
  never remove `user`/`parser` links.
- Account export/import and backup carry the links; restore entities and
  documents before links; remap both ends.
- `.travstats` trip archives get a version with one document and several
  archive-local references; import adds missing links even when the bytes
  already exist (today a hash match skips the row and would drop them); the old
  single-owner format still imports.

## How links are made

1. **Package/multi-leg import** (`trip/package/proposal.ts`, `commit.ts`,
   `parsers/userTemplates/packageDeriver.ts`): the review shows which entries
   the booking covers; commit links the kept original to each confirmed
   entry (created or matched) plus the trip, atomically, provenance `parser`.
2. **Inbox suggestions** for documents already stored: a trip-filed booking
   whose parsed payload names a flight number, PNR, hotel or date range that
   matches entries of the trip → "Dieses Dokument belegt auch …". Pending until
   decided.
3. **Manual:** on a document, "Auch verknüpfen mit …" with a multi-select of
   the account's entries (trip entries first), and on an entry, "Dokument aus
   der Reise verknüpfen".

## Companion (additive)

Existing routes, response shapes and the single-owner projection stay. Links
are added as optional data behind a capability flag the documents API
reports (the app probes it before relying on links); a new sync
entity is appended (cursor indices never reordered) with deletion tombstones.
An old app that unfiles a document removes only the projected primary link,
never "all links". Minimum server version for link-aware app builds: the
release that carries phase D2.

## Phases

| Phase | Side | What | State |
|---|---|---|---|
| D1 | server | table, backfill, cascades to `SET NULL`, dual-write, replay test, registry + domain test, sweep transaction | planned |
| D2 | server + web | read links everywhere (entry lists show "Beleg aus …", distinct counts), manual link/unlink UI, "delete everywhere" | planned |
| D3 | server + web | package import links confirmed entries; `.travstats` archive v-next; export/backup | planned |
| D4 | server + web | inbox suggestions for existing documents | planned |
| D5 | Companion | show "Beleg aus …" on an entry; link-aware filing | after D2 |
| D6 | server | contract: drop old CHECK and FK columns | after the last app version without links |

## Tests that gate the release

Migration replay; concurrent link/delete/sweep; deleting the primary entry vs.
the last link; package commit retry idempotency; merge and undo; archive and
account export round trips with legacy fixtures; old Companion payload
fixtures; cross-account and shared-trip denial (no document, name or link
leaks).

## Council (2026-11-21: Codex, Gemini, Copilot)

Answers in `~/.cache/tmp/ai-council.ri4raY/` on lisbeth. All three agree on a
join table with role and provenance, backfill as primary links, entry delete
removes links only, distinct counts, package commit linking, an additive
Companion projection. Codex and Copilot want real FKs per type and
expand/contract; Gemini wanted polymorphic ids and dropping the old columns at
once — rejected (no cascades or ownership in the database; breaks installed
app versions). Gemini also proposed "access if you can see any linked entry" —
rejected: it would hand shared-trip members documents that `memberScope.ts`
strips today (rule 6). Codex found the sweep's select-then-delete race and
the archive import that skips a known hash and would lose links.

## Decisions (2026-11-21)

The owner delegated both open points ("entscheide du, was am besten ist"):

- **Place visits:** a package booking's `covers` links go to transport and
  lodging entries (and the trip), not automatically to place visits — a
  booking rarely names the places visited. A place visit can still be linked
  by hand or by an accepted suggestion.
- **Inbox suggestions (D4):** one pass over all stored documents when D4
  ships, then for every new document. Without the pass, the owner's existing
  round trips would stay unlinked. The pass is a job with progress, and a
  decision persists, so it never asks twice.
