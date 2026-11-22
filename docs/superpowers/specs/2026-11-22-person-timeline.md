# Person timeline — one page per companion (2026-11-22)

Council idea, owner "weiter bauen" (2026-11-22). A page `/mitreisende/:id` for every
companion of the caller, reached from the companions list ("Mit wem unterwegs") and from a
traveller chip on an entry. API: `GET /api/v1/companions/:id/timeline` (bare family, like the
rest of `routes/companions.ts`; additive, documented in OpenAPI). No schema change.

## What is counted, and by which rule

The population is the one "Mit wem unterwegs" already uses
(`services/companions/companionTogether.ts`): an entry counts once it has HAPPENED by its own
domain's rule (flights `flightCounting`, a stay only after check-out `lodgingCounting`, a trip
once it has started, ...). Domains the caller has switched off are not counted and not listed.
Paying an expense is not travelling together.

| Figure | Rule |
| --- | --- |
| `firstTogether` / `lastTogether` | first / last calendar day of any happened shared entry, each on its own entry's clock; null with no dated entry |
| `trips`, `flights` | happened shared entries of that kind; `flights` is null when the flight domain is off (abstain, not 0) |
| `nights` | days covered by happened shared stays (`dayKeys`); 0 with no stay, null when stays exist but none has dates, or the lodging domain is off |
| `countries` | the passport's visited rule over the shared entries (`countriesTogether`); null when no shared entry could prove one |
| `days` | distinct days covered, a day two entries share counts once |

## Timeline

Happened shared entries plus the person's PLANNED trips (not started yet), oldest first;
undated entries last. Each row carries `state: "happened" | "planned"`; planned rows are marked
and feed no figure. Planned flights/stays are not listed (a trip is the umbrella a plan lives in).

## Documents and facts

- Documents: `document_links.companion_id` = this person, of the caller's own documents, on
  entries of visible domains ("für: <Person>").
- Seat history: `seatNumber`/`seatClass` (cruise: `cabin`) of the person's link rows on HAPPENED
  shared entries, oldest first.
- Loyalty numbers: distinct numbers over all the person's link rows (stays included), with the
  kinds they were recorded on.

## Privacy

Own account only. The companion id is looked up under the caller's `userId`; another
account's companion, and a linked companion opening the id of the entry owner's list, is a
404 `COMPANION_NOT_FOUND`. A linked companion's own account sees nothing new: the page is
built from the owner's data and has no share path.

## Contract delta

Additive: one endpoint. Minimum server version: the release carrying this plan.
