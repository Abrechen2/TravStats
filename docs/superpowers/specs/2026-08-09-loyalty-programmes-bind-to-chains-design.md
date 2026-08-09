# Loyalty programmes bind to chains, not to stays — design

**Date:** 2026-08-09
**Rides:** 2.6.0 (branch `dev/hotels`)
**Status:** approved by the owner 2026-08-09
**Origin:** Alex, Discord `#dev-talk` 2026-08-08 15:18–15:28, plus the two open
findings from the 2.6.0-beta.3 UAT

## Problem

`MembershipManager` is mounted in exactly two places:

- `LodgingChainDetailPage` — **scoped** to a chain, so a programme created there
  gets a `LodgingMembershipChain` row for that chain;
- `StayEditor` — **unscoped**, so a programme created there gets **no chain link
  at all**.

A programme created from the stay editor is therefore invisible on every chain
page (that page lists only memberships linked to the chain being viewed), while
its name is permanently taken by `@@unique([userId, programName])`. Trying to
create it again from the chain page returns a clean 409 and dead-ends.

Alex hit this and diagnosed it himself:

> Wenn ein Programm manuell bei einem Aufenthalt hinzugefügt wurde gilt es als
> bereits zugeordnet und kann nicht mehr einer Kette zugeordnet werden. Die
> Bonusprogramme sollten also nur an Ketten gebunden sein, nicht an einzelne
> Aufenthalte. Für unabhängige Hotels die aber ein Bonusprogramm bieten könnte
> man erlauben einem einzelnen Hotel ein Bonusprogramm zuzuweisen, aber nur wenn
> keine Kette hinterlegt ist.

He also asked a question nobody had answered — *where do I see all the
programmes I already have?* — and there is no screen that answers it.

Two board items are the same defect seen from different angles:

- `membership-extend-to-another-chain` — extending one card to a second chain is
  unreachable; the coverage checkboxes only offer chains the catalogue already
  groups.
- `membership-untick-vanishes` — unticking the current chain hides the
  membership with no feedback (the data survives, but the only way back is the
  stay editor).

## Verified before designing

- `LodgingStay.membershipId` exists and is a **manually chosen** dropdown value
  (`StayEditor.tsx`), stored with `onDelete: SetNull`.
- `LodgingMembershipChain` (membership ↔ chain, by id) already exists from
  `4d8a059d`; `LodgingChain.loyaltyProgram` is a **suggestion only** and no
  longer load-bearing.
- **Flights have no loyalty-programme entity.** `frequentFlyerNumber` is a
  free-text `String?` on `Flight` (schema line ~239), not a user-level card. A
  cross-domain programme page would have nothing to manage on the flight side.
- `prisma migrate diff --from-migrations --to-schema-datamodel` reports an empty
  migration on this branch — `prisma migrate dev` works normally.

## Decisions

| Question | Decision |
|---|---|
| Stay ↔ programme | Keep the column, change its meaning to an **override**; the value is otherwise **derived** from the hotel's chain |
| Independent hotels | New join table `LodgingMembershipLodging`, mirroring the chain link |
| "Only when no chain is set" | Implemented as **precedence, not prohibition** — see below |
| Third state ("no card used") | New `membership_opt_out` boolean on `lodging_stays` |
| Existing `stay.membership_id` | Normalised by the migration: nulled where it equals the derived value, kept where it genuinely deviates |
| Central management | **Lodging only**, a section in the Unterkünfte settings tab |
| Airline programmes / cross-domain page | **Out of scope** |
| Programme creation in the stay editor | **Removed** — that mount is the cause |

### Why precedence rather than a hard invariant

A literal "a hotel may carry a programme only when it has no chain" has to answer
what happens when a user later assigns a chain to a hotel that already has a
direct link. Both answers are bad: block a legitimate correction, or silently
delete the user's link.

Instead: **a chain link always wins over a direct hotel link**, and the UI offers
the direct assignment only while the hotel has no chain. Assigning a chain later
makes the direct link dormant rather than invalid. The user-visible behaviour is
what Alex asked for; nothing is destroyed and no edit is blocked.

## Data model

```prisma
/// Which independent hotels a membership covers, linked BY ID.
///
/// Mirrors LodgingMembershipChain so that "what does this card cover" is one
/// idea with one editor. Used for a hotel that offers a programme without
/// belonging to a chain; a chain link always takes precedence over one of
/// these (see deriveStayMembership), so setting a chain later makes the row
/// dormant rather than wrong.
model LodgingMembershipLodging {
  membershipId String   @map("membership_id")
  lodgingId    String   @map("lodging_id")
  createdAt    DateTime @default(now()) @map("created_at")

  membership LodgingMembership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  lodging    Lodging           @relation(fields: [lodgingId], references: [id], onDelete: Cascade)

  @@id([membershipId, lodgingId])
  @@index([lodgingId])
  @@map("lodging_membership_lodgings")
}
```

`LodgingStay` gains one column:

```prisma
  /// true = the user explicitly used NO programme for this stay. Distinct from
  /// membershipId = null, which means "derive it from the hotel".
  membershipOptOut Boolean @default(false) @map("membership_opt_out")
```

`LodgingMembership` and `LodgingMembershipChain` keep their fields; both
`LodgingMembership` and `Lodging` gain the back-relation the join table needs
(`lodgings LodgingMembershipLodging[]` and `membershipLinks
LodgingMembershipLodging[]` respectively).

Because a direct link may legally coexist with a chain (it simply loses), there
is **no** database-level constraint tying `lodging_membership_lodgings` to
`lodging.chain_id IS NULL`. The "only when no chain" rule is a UI affordance and
a precedence rule, deliberately — see above.

## Derivation

`shared/membershipDerivation.ts`, mirrored in `frontend/src/shared/` under the
same convention as `statusDerivation.ts` and `ratingDerivation.ts`. It is a pure
function over data both sides already hold, so the editor readout cannot promise
a card the server then stores differently.

```ts
export type StayMembershipSource = "override" | "chain" | "lodging" | "none";

export interface StayMembershipResolution {
  membershipId: string | null;
  source: StayMembershipSource;
}

export function deriveStayMembership(input: {
  overrideId: string | null;
  optOut: boolean;
  lodgingId: string;
  lodgingChainId: number | null;
  /** The user's cards with their coverage, already loaded. */
  memberships: Array<{
    id: string;
    chainIds: number[];
    lodgingIds: string[];
  }>;
}): StayMembershipResolution;
```

Precedence, first match wins:

1. `optOut` → `{ null, "none" }`
2. `overrideId` set → `{ overrideId, "override" }`
3. a membership covering `lodgingChainId` → `{ id, "chain" }`
4. a membership covering `lodgingId` → `{ id, "lodging" }`
5. otherwise → `{ null, "none" }`

Ambiguity rule: if more than one card covers the same chain (or the same hotel),
resolve to the **oldest** membership by `createdAt`, so the answer is stable
across requests rather than dependent on query order. The settings list is where
the user resolves such an overlap.

The stored `stay.membership_id` remains the override slot only. Nothing writes a
derived value back into it — a derived field with a second stored copy is how the
overall-rating bug happened (`9fcf5de1`).

## Migration

One migration, three steps:

1. `CREATE TABLE lodging_membership_lodgings` (+ index).
2. `ALTER TABLE lodging_stays ADD COLUMN membership_opt_out BOOLEAN NOT NULL DEFAULT false`.
3. **Normalise existing overrides.** Set `membership_id = NULL` for every stay
   whose stored membership is exactly the one derivation would produce from its
   hotel's chain. Without this, every historic stay reads as an explicit
   "abweichend" override on day one.

Step 3 in SQL terms: null the column where a `lodging_membership_chains` row
exists joining the stay's stored membership to the stay's hotel's `chain_id`.
Stays whose stored membership does not cover their hotel's chain keep it — those
are genuine deviations.

Verified the way the rating backfill was: seed rows covering each case (derived
match, genuine deviation, no chain, no membership), run the migration SQL, assert
before/after.

## UI

**Stay editor** (`StayEditor.tsx`)
- The embedded `MembershipManager` and its "Programme verwalten" button are
  removed. This is the single change that stops orphaned programmes being
  created.
- The programme becomes a read-only readout of the derived card, labelled with
  its source ("aus der Kette").
- A disclosure — "abweichend zuordnen" — reveals the existing dropdown plus a
  "kein Programm" choice, writing `membershipId` / `membershipOptOut`.

**Chain detail page** (`LodgingChainDetailPage.tsx`)
- Keeps the scoped manager.
- On the duplicate-name **409**, offer *"add this chain to your existing
  programme"* — one PATCH appending the chain id. Closes
  `membership-extend-to-another-chain`.

**New settings section** — `Einstellungen › Unterkünfte › Bonusprogramme`
- Lists every card with number, tier and its full coverage (chains and
  independent hotels).
- Coverage editor: tick chains, and add independent hotels (offered only for
  hotels with no chain).
- Because this list is unconditional, unticking a chain can no longer make a
  membership unreachable. Closes `membership-untick-vanishes`, and answers
  Alex's "wo finde ich alle bisherigen Bonusprogramme?".
- DE primary, EN mirrored in the same change.

## Testing

Test-first throughout.

- **Derivation** — the same truth table asserted in
  `backend/src/shared/__tests__/` and `frontend/src/shared/__tests__/`: each
  precedence level, opt-out beating an override, chain beating a direct hotel
  link, the oldest-membership tie-break, and no coverage at all.
- **Routes** — creating a membership with chain and lodging coverage; the 409
  path plus the PATCH that appends a chain; a direct hotel link on a hotel that
  *does* have a chain is **accepted and dormant**, not rejected (that is the
  precedence decision — a rejection here would contradict it); ownership, with a
  victim row genuinely owned by another user, since a foreign-key match proves
  the row exists, never that the caller owns it.
- **Migration** — seeded before/after assertion per case, as above.
- **Frontend** — the stay editor renders the derived card and no longer offers
  programme creation; the override disclosure writes the right payload; the
  settings section lists a chain-less membership.
- **Browser pass** on the isolated `127.0.0.1` stack over all three of Alex's
  scenarios: create at a stay (now impossible by design), extend a card to a
  second chain, untick a chain and still find the card.

## What this closes

| Item | |
|---|---|
| `membership-extend-to-another-chain` | Fund 2 of the beta.3 UAT |
| `membership-untick-vanishes` | Fund 3 of the beta.3 UAT |
| Alex 2026-08-08 (a) | programmes bind to chains, not to stays |
| Alex 2026-08-08 (b) | independent hotels may carry a programme |
| Alex 2026-08-08 (c) | a central place to manage programmes |
| Alex's open question | where he sees the programmes he already has |

## Out of scope

- Airline / frequent-flyer programmes as an entity, and any cross-domain
  programme page. `Flight.frequentFlyerNumber` stays the free-text field it is.
- The pre-existing stays-only CSV dead end (`missing_lodging_reference` when the
  hotel does not exist yet) — a separate finding, its own block.
