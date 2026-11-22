# Overflow menus ("Mehr" / ⋯) — one component, one rule

Owner, 2026-11-22: rare actions are tidied into a ⋯ menu. Audit: six hand-rolled menus and
detail headers with two to five inline buttons.

## Rule

> Rare and destructive actions live in a ⋯ at the right of the header; a row with more than two
> actions gets a row ⋯; delete is always last, red, and confirmed.

Also on the doc comment of `frontend/src/components/ui/OverflowMenu.tsx`.

## Component

`ui/OverflowMenu` (extracted from the trip head's `TripMoreMenu`): trigger "Mehr" + ⋯ (header) or
the bare ⋯ (row, card); portaled panel; keyboard (Enter/Space open and focus the first entry,
arrows/Home/End, Escape/Tab close and return focus to the trigger); 44 px rows and trigger on a
coarse pointer; entries `{label, onSelect | href, disabled, disabledReason, danger, confirm}`.
Danger entries are sorted last under a separator. `confirm` opens the shared confirm dialog;
the detail pages leave it out because their delete already opens its own dialog. An entry whose
feature is off is left out, not greyed.

## Package 1 (this change)

- Migrated onto it: trip head, person row, trips list (clean-up / merge, now ⋯ at every width),
  TravPlan header (edit, refresh, statistics, members, delete; now ⋯ at every width).
- Detail headers of flight, lodging, rail, bus, ferry, rental, cruise, place: `[Bearbeiten] [Mehr]`.
  Share link, enrich, restay, add connection, merge and delete are in Mehr (`detail/DetailMoreMenu`).
  Ferry's delete is now red like the others.
- Documents: per row the name link (open) and the original download stay; stored values, extract
  values, rental category, link to more entries, unlink here and delete everywhere are in the row ⋯.
  The section keeps "+ Dokument hinzufügen"; "Dokument aus der Reise verknüpfen" is in a section ⋯.

## Not in this package

Row ⋯ on domain lists, list headers, roadtrip header, route cards (re-route, GPX/KML), flight row
duplicate menu, settings rows, inbox cards. The document person picker stays inline: it shows who
the document is for.
