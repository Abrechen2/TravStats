# Private and shareable notes — what "shareable" means

Tracks `dennis/TravStats` forgejo#146 (owner decision **D4**, 2026-10-01: the daily journal
builds on forgejo#137's standalone note "with a private/shareable flag"). Branch
`feat/notes-on-trips-146`.

## The flag

`Note.visibility` — `private` (the default, also for every note written before the flag
existed) or `shareable`. Written through `POST`/`PATCH /api/v1/notes` like any other field,
carried in the sync feed record and in the all-data export. Any other value is a 400; a stored
value outside the vocabulary is read as `private`.

## What "shareable" means

**A shareable note may appear where its owner has already deliberately shared a trip — and
nowhere else.** The flag publishes nothing by itself; it only lets a note ride along with a
share the owner made on purpose. There are exactly two such places:

1. **Trip sharing between accounts** (`2026-10-09-trip-sharing-design.md`). A member of a
   trip's share group reads the other members' shareable notes whose day falls on the days of
   that member's own trip in the group *and* of the reader's trip — read live through the group
   (`GET /api/v1/notes/trip/:tripId`, `memberNotes`), never copied. Notes are not facts:
   nothing is propagated, no notice is written, and a member cannot edit, delete or open
   another's note (its id answers its owner only). The consent rule of propagation applies:
   a member with a withdrawn consent towards the reader and no accepted one is left out
   (`withdrawnTowards`). What a member sees: the text, the place name as typed, the moment on
   the clock it was written on and the author — no position, no photo.
2. **Public share links** (`2026-10-10-share-links-design.md`). A trip link offers `notes` as
   a field. Chosen, it lists the owner's shareable notes on the trip's days (at most 50,
   oldest first, `truncated` when there are more) — text, place name and moment only. The
   flag is re-read on every request, like expiry: a note made private disappears from the link
   at once, and one made shareable later appears, because "notes" was the owner's choice of
   *what kind* of thing to show, made with the link's preview in front of them.

**A private note never leaves its owner** — not to a share-group member, not to a link, not
in a member's sync feed (the feed carries only the reader's own rows). Every read for someone
else filters `visibility = 'shareable'` in the query itself, so a private row is never loaded
on another reader's behalf. Tests: `routes/__tests__/notes.trip.test.ts`,
`routes/__tests__/shareLinks.routes.test.ts` ("trip notes").

## Which notes are a trip's

A note belongs to no trip by a stored link (forgejo#137). It is on a trip when its day —
`times.day`, the day on the clock of the zone it was written in — lies between the trip's
first and last day inclusive. A trip without a first or last day places no note
(`span: null`). The bound is 200 notes per list; `truncated` says a list was cut.

## Not done here

- Notes on a *flight* link or a *wrapped* link — neither has days a note could belong to in a
  way the owner would recognise.
- Notes in the single-trip `.travstats` package (`services/trip/exchange/`) — it carries no
  standalone notes today, private or shareable; whether it should is open.
- Sharing a note's photo. The photo route answers the owner only; a member or a link
  visitor sees text.
