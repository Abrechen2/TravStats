# Chain lists that keep themselves up to date (owner, 2026-11-22)

Status: **plan for the owner's decision; no code before his OK.**

## Owner's wish

His Places list "McDonald's" (58 visited places on prod) should continue on
its own when TravTrack/the Companion sees a stop at a McDonald's — and not as a
McDonald's feature: the user picks any chain (Subway, KFC, Burger King, …).

## Recommendation: a brand rule on an ordinary place list

1. **Any user `PlaceList` can carry a brand rule** — one or more OSM
   `brand:wikidata` ids (McDonald's `Q38076`, chosen through a search over the
   brand name, never typed by hand), a dwell window (default 5–60 min for food chains) and a
   maximum distance from the venue (default 60 m). No list per brand ships in
   the server. Curated lists stay what they are: fixed, catalogue-maintained
   checklists with known items; a chain with 40 000 outlets is not one.
2. **No new lookup.** TravTrack already resolves each stop to a venue once
   (visit suggestions V2: Overpass outlines + Photon, cached, budgeted, behind
   the external-services switch). That lookup additionally returns the venue's
   `brand` / `brand:wikidata` tags; matching against the user's brand rules is
   a local comparison. Zero extra Overpass calls, nothing per brand.
3. **Inbox first, auto-accept opt-in per list.** A match becomes the normal
   visit suggestion with a "passt zu Liste McDonald's" badge; accepting creates
   or reuses the Place, adds the visit and the list entry. A list can switch on
   "automatisch übernehmen" for confident matches (the venue is the stop's top
   candidate, inside the distance, dwell met); every automatic entry is marked
   as such, listed under "Zuletzt automatisch übernommen" and undoable — undo
   removes only what the automation created, never a manual entry.
4. **Data model (additive):** a `PlaceListBrandRule` table (`listId`,
   `brandWikidataId`, `brandName`, `minDwellMinutes`, `maxDistanceM`,
   `autoAccept`); the Place keeps the OSM id and brand wikidata id it was
   created from; list entries and visits carry `createdBy: "brandRule"` for
   undo. One existing Place per OSM venue, so repeat visits (Irschenberg, 9×)
   become visits of one place.
5. **Privacy:** stops inside a privacy zone are dropped before any lookup, as
   today. The private/business purpose (plan 2026-11-22-private-business-purpose)
   is taken from the trip the stop falls into, else left unknown; a rule never
   guesses it.
6. **Retroactive fill:** the Worktravel session is matching the Google Timeline
   (2013–2026, ~15k stops) against OSM McDonald's within ~50 m. Its rule and hit
   rate calibrate the defaults; the result is imported once, after the owner's
   review of the Excel, through the same import path (visits marked as imported).

## Owner's refinement (2026-11-22, second message)

- **Like a smart folder (Apple):** the list is defined by its rule ("alle
  McDonald's, wo ich war"), set once in the list's settings; matching outlets
  join it on their own. The list shows "Intelligente Liste: Kette McDonald's"
  in its header, and the rule is editable there.
- **The suggested visit appears on the place itself, not only in the inbox.**
  If the place already exists (Irschenberg McDonald's), the new visit is shown
  on that place's page as an unconfirmed visit: "Warst du am 22.11. um 12:40
  hier? 25 Min. — erkannt durch TravTrack", with "Bestätigen" / "War ich
  nicht". The inbox entry and the place entry are the same suggestion;
  answering it in one place answers it in the other. A new outlet appears as a
  suggested place inside the list, with the same reason, time and dwell.
- **The reason is always shown:** source (TravTrack, Google-Timeline import,
  photo), date, arrival time, dwell, distance to the outlet.
- **Dwell window per rule, not only a minimum:** a fast-food stop is short,
  so the rule has a minimum and a maximum (default for food chains: 5 to 60
  minutes). A stop of four hours next to a McDonald's is something else (the
  hotel, the office) and does not match.

## Pitfalls

- **Drive-through and passing traffic:** a stop next to a McDonald's is not a
  visit. Dwell minimum plus "the venue is the top candidate of the stop"; never
  fall back to the nearest node.
- **Tag gaps:** some outlets lack `brand:wikidata`. Fallback: exact `brand`
  string match, shown as a weaker match (always inbox, never auto-accepted).
- **Nearby duplicates** (two OSM objects for one restaurant, a closed one):
  dedupe by distance and OSM id; a closed venue (`disused:*`) never matches.

## Phases

| Phase | What |
|---|---|
| B1 | Brand tags from the existing venue lookup; brand rule on a list (UI: list ⋯ → "Kette verknüpfen"); inbox badge and accept into list |
| B2 | Opt-in auto-accept with "Zuletzt automatisch übernommen" and undo |
| B3 | One-off retroactive import from the Worktravel matching (after review) |
| B4 | Companion: show the badge and the list in the suggestion (additive) |

## Council (2026-11-22: Gemini, Copilot; Codex at its usage limit)

Both: a rule on a user list keyed by `brand:wikidata`, no built-in list per
brand; reuse the one venue lookup (no extra Overpass load); privacy zones
before lookup; auto-accept off by default with undo. Copilot added that undo
must spare manual entries and that the purpose must not be inferred from
TravTrack's recording mode — both taken into points 3 and 5. Answers:
`~/.cache/tmp/ai-council.mUhHCy/` (Gemini) and the Copilot run of the same day
on lisbeth.

## Open for the owner

- Q1: Auto-accept per list allowed at all (recommended: yes, off by default)?
