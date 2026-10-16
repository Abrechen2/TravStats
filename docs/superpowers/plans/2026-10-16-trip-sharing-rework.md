# Trip Sharing Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shareable entry type (ferry included) come from one registry with one copy path, recipient-correct derivation, a per-call propagation guard and checked vocabularies, and give the trip page one people section, one "Teilen" entry point and an inbox card consistent with pending updates.
**Architecture:** `services/sharing/shareTypes.ts` declares the shareable types keyed to `DomainKey`; `ADAPTERS`, `DERIVE` and `keyOps.ts` are exhaustive over it, and `copyInto.ts` is the single copy path used by sharing, propagation and the ferry backfill. The frontend replaces `TripSharingPanel`, the trip's `ShareLinkButton` and `ShareNoticeRow` with `TripPeopleSection`, `TripShareMenu` and `ShareNoticeCard` built on the `ui/` primitives.
**Tech Stack:** Express 5 + TypeScript, Prisma 7 (`backend/src/prisma.ts` re-export) on Postgres/PostGIS, Jest + supertest; React 19 + Vite + Tailwind, Vitest + Testing Library, react-i18next (DE primary, EN mirror), zustand.
**Spec:** docs/superpowers/specs/2026-10-16-trip-sharing-rework-design.md

## Global Constraints

- Base: main after merging `fix/ct142-sharing`, `fix/ct142-transport`, `fix/ct142-stats` (`restatusTrips` lives in `backend/src/services/trip/restatusTrips.ts`).
- Branch: `dev/trip-sharing-rework` off main; never commit to main; merge into main is the owner's isolated release question.
- Backend test command: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/travstats_sharing_test" NODE_ENV=test JWT_SECRET=ci-only-jwt-secret-not-used-anywhere-else-0000 ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx jest --forceExit <file>` (abbreviated below as `$JEST <file>`). The DB `travstats_sharing_test` is this session's own: `npx prisma migrate deploy` then `npx tsx scripts/seed-test-catalogues.ts` against it once before Task 1. Never 5434 (design worktree).
- Frontend test command: `cd frontend && npx vitest --run <file>`.
- Prisma imports: `Prisma`, model types from `backend/src/prisma.ts` (`"../../prisma"` etc.), never `@prisma/client`.
- Logger: `import logger from "../utils/logger"` (default export).
- Enveloped router `/api/v1/sharing` (ADR 0001); no router changes family.
- Every new user-facing string: DE in `frontend/src/i18n/resources/de/<ns>.json` first, EN mirror in the same commit, informal "du".
- File-size ratchet: no source file over 800 lines; `frontend/src/pages/TripDetailPage.tsx` (frozen at 1056) is not edited.
- Migrations: `npx prisma migrate dev --create-only --name <name>` against the dev DB, SQL written into the generated file, then `npm run check:drift` green.
- Commit messages: Conventional Commits, English, body says why, ending with the two attribution lines of the session.
- After each task: `cd backend && npx tsc --noEmit && npm run lint` / `cd frontend && npx tsc --noEmit && npm run lint` for the tree touched; `npx prettier --check` on touched files.

## Review Focus

1. **A member of a group created before the consent rule silently receives nothing.** `receivingMembers` skips unconsented pairs; nothing tells either side. Pinned: Task 10 `tripPeople.test.ts` "lists a member who is no companion of the trip, and marks a member without consent"; Task 15 `TripPeopleSection.test.tsx` "shows Zustimmung offen and the hint for a member without consent".
2. **Joining on propagation hangs a new flight on the recipient's different flight across a local midnight.** Pinned: Task 3 `sharing.copyPath.test.ts` "does not join the recipient's same flight number on the next local day".
3. **The share card re-parses formatted values as dates** (`ChangeDiffView`'s built-in formatter treats any string containing a `T` as a date — an English share time "Tue, 2 Jun 2026, 09:15" would be re-read in the browser's zone). Pinned: Task 13 `ChangeDiffView.test.tsx` "shows a preformatted value as given, under the caller's label".
4. **Superseding a pending update that still proposes something.** Pinned: Task 9 `sharing.supersede.test.ts` "keeps a partially satisfied update open" and "keeps an edited update whose edit differs".
5. **A ferry linked to a roadtrip leg leaks the leg, or linking it into a shared trip copies nothing.** Pinned: Task 5 `sharing.ferry.test.ts` "linking a crossing to a leg of a shared trip copies it without the leg".

---

## File Structure

Backend (`backend/`):

| File | Responsibility | Task |
|---|---|---|
| `src/services/sharing/shareTypes.ts` (create) | `SHARE_ENTITIES`, `ShareEntity`, `SHARE_TYPES` (delegate, table, count key, exchange kind, domain), `DOMAIN_SHARING`, `SHARED_SOURCE`, `CopyCounts`, `emptyCounts` | 1, 5, 11 |
| `src/services/sharing/adapters/types.ts` (modify) | `EntityAdapter` gains `ownMatch?`; re-exports vocabulary from `shareTypes` | 1, 3 |
| `src/services/sharing/__tests__/shareTypes.test.ts` (create) | registry vs DB `share_key` columns, domains, adapters, inbox labels, exchange | 1, 5, 11 |
| `src/services/sharing/keyOps.ts` (create) | `keyedDelegate`, `delegateOf`, `assignShareKeys`, `assignKeysFor`, `clearTripKeys`, `sharedIdsOf`, `heldKeys`, `keyedIdsOnTrip`, `idsOnTrips`, `findByUserKey`, `REF_DELEGATES` | 2 |
| `src/services/sharing/__tests__/keyOps.test.ts` (create) | key operations over every registered type | 2 |
| `src/services/sharing/detach.ts`, `bulkSync.ts`, `adapters/stop.ts`, `services/tripCleanupService.ts` (modify) | per-type ladders replaced by registry loops | 2 |
| `src/services/sharing/copyInto.ts` (create) | the one copy path: `ownMatch` → join, else `createCopy`, then `DERIVE` | 3, 4 |
| `src/services/sharing/copyEntries.ts` (delete) | — | 3 |
| `src/services/sharing/shareTrip.ts`, `propagate.ts` (modify) | share loop over the registry; create-path via `copyInto`; exported `recordEntryNotice`, `noticeMeta` | 3, 4, 9, 10, 19 |
| `src/services/sharing/adapters/flat.ts` (modify) | flight `ownMatch` | 3 |
| `src/routes/__tests__/sharing.copyPath.test.ts` (create) | counts per registry, join on propagate, midnight pin | 3 |
| `src/shared/time/profileZone.ts` (modify) | `dayAnchorNowFor(userId)` | 4 |
| `src/services/sharing/deriveCopy.ts` (create) | `DERIVE: Record<ShareEntity, DeriveCopy>` | 4, 5 |
| `src/services/lodging/stayWrites.ts`, `services/cruise/createCruise.ts`, `adapters/lodgingStay.ts` (modify) | use `dayAnchorNowFor`; adapter stops deriving | 4, 8 |
| `src/routes/__tests__/sharing.deriveCopy.test.ts` (create) | recipient-zone status | 4 |
| `src/services/sharing/facts/ferry.ts`, `adapters/ferry.ts` (create) | ferry facts and adapter (with `ownMatch`) | 5 |
| `src/routes/ferry.ts`, `src/routes/ferry/roadtrip.ts` (modify) | propagate ferry writes | 5 |
| `src/routes/__tests__/sharing.ferry.test.ts` (create) | ferry end to end | 5 |
| `prisma/migrations/<ts>_share_vocabulary_checks/migration.sql` (create) | CHECK constraints | 6 |
| `src/schemas/sharing.ts` (create) | Zod unions for status, kind, entity type | 6 |
| `src/services/sharing/notices.ts`, `undo.ts`, `consent.ts` (modify), `prisma/schema.prisma` (comments) | parse with the unions | 6 |
| `src/services/sharing/__tests__/shareVocabulary.test.ts` (create) | DB CHECKs equal code lists | 6 |
| `src/services/sharing/__tests__/propagate.writePaths.test.ts` (rewrite) | per-call guard | 7 |
| `src/services/trip/exchange/commit.ts`, `services/lodging/lodgingImportBatches.ts`, `routes/trips.ts`, others the guard lists (modify) | `// share-exempt:` reasons / propagation | 7 |
| `src/routes/__tests__/sharing.lowRatioPaths.test.ts` (create) | exchange import, merge, trip delete on a shared trip | 7 |
| `src/services/pendingUpdateService.ts`, `routes/trips.ts` (modify) | same-transaction propagation | 8 |
| `src/routes/__tests__/sharing.sameTransaction.test.ts` (create) | rollback when propagation fails | 8 |
| `src/services/sharing/pendingSupersede.ts` (create) | D7 rule | 9 |
| `src/routes/__tests__/sharing.supersede.test.ts` (create) | D7 cases | 9 |
| `src/services/sharing/tripPeople.ts` (create) | `TripPerson` rows, `linkableUsers` | 10 |
| `src/services/openapi/paths/sharing.ts` (modify) | new view shape, counts, enums | 5, 6, 10, 19 |
| `src/services/sharing/__tests__/tripPeople.test.ts` (create) | row states | 10 |
| `src/services/trip/exchange/{format,collect,commitRows,commit,proposal,types,writeArchive}.ts`, `services/trip/package/matchingEntries.ts` (modify) | ferry in `.travstats`, version 3 | 11 |
| `src/routes/__tests__/tripExchange.ferry.test.ts` (create) | round trip with crossings | 11 |
| `src/services/sharing/backfillFerries.ts`, `src/scripts/reportShareGroupConsent.ts`, `src/scripts/backfillSharedFerries.ts` (create), `package.json` (scripts) | rollout | 12 |
| `src/services/sharing/__tests__/backfillSharedFerries.test.ts` (create) | dry run and apply, consent report | 12 |

Frontend (`frontend/`):

| File | Responsibility | Task |
|---|---|---|
| `src/types/sharing.ts`, `src/lib/api/sharing.ts` (modify) | `TripPerson`, `ShareEntityType` incl. ferry, view shape | 3, 5, 13, 19 |
| `src/components/ChangeDiffView.tsx` (modify) | `formatValue`, `fieldLabel` props; `ChangeEntry` exported | 13 |
| `src/i18n/resources/{de,en}/pendingUpdates.json` | `status.superseded` | 9 |
| `src/components/sharing/ShareTripDialog.tsx`, `LinkAccountDialog.tsx` (create) | the two row dialogs | 14 |
| `src/store/tripSharingStore.ts` (create) | revision counter per trip | 15 |
| `src/components/ui/PeopleList.tsx` (modify) | optional `rows` with meta, badges and an action | 15 |
| `src/components/sharing/TripPeopleSection.tsx` (create) | "Reisende" with sharing state | 15 |
| `src/components/Trips/TripOverview.tsx` (modify) | uses the section; drops panel and link button | 15, 16 |
| `src/components/sharing/TripSharingPanel.tsx` + test (delete) | — | 15 |
| `src/components/sharing/TripShareMenu.tsx` (create), `src/components/Trips/TripHead.tsx` (modify) | "Teilen" menu | 16 |
| `src/components/inbox/ShareNoticeCard.tsx` (create), `SharingTab.tsx` (rewrite), `ShareNoticeRow.tsx` (delete) | inbox | 17 |
| `src/i18n/__tests__/sharingTerminology.test.ts` (create) | D11 guard | 18 |
| `src/i18n/resources/{de,en}/sharing.json` | keys per task | 3, 5, 14–18 |

Docs: `docs/superpowers/specs/2026-10-16-trip-sharing-rework-design.md` (create), `docs/superpowers/specs/2026-10-09-trip-sharing-design.md` (pointer), `CLAUDE.md` (invariant + enforced rows) — Task 19.

---

### Task 1: Share type registry and its guard

**Files:**
- Create: `backend/src/services/sharing/shareTypes.ts`
- Modify: `backend/src/services/sharing/adapters/types.ts:1-20` (vocabulary moves out)
- Test: `backend/src/services/sharing/__tests__/shareTypes.test.ts`

**Interfaces:**
- Consumes: `DomainKey`, `DOMAIN_KEYS` (`shared/domains.ts`), `ADAPTERS` (`adapters/index.ts`).
- Produces: `SHARE_ENTITIES: readonly ["flight","lodgingStay","cruise","rail","bus","rental","stop"]`, `type ShareEntity`, `SHARE_TYPES: Readonly<Record<ShareEntity, ShareTypeMeta>>`, `interface ShareTypeMeta { domain: DomainKey | null; delegate: ShareDelegate; table: string; countKey: string; exchangeKind: ExchangeKind | null }`, `type ShareDelegate`, `type ExchangeKind`, `DOMAIN_SHARING: Readonly<Record<DomainKey, ShareEntity | { notShared: string }>>`, `SHARED_SOURCE = "shared"`, `type CopyCounts = Record<CountKey, number>`, `emptyCounts(): CopyCounts`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/sharing/__tests__/shareTypes.test.ts
import { afterAll, describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { prisma } from "../../../db";
import { DOMAIN_KEYS } from "../../../shared/domains";
import { ADAPTERS } from "../adapters";
import { DOMAIN_SHARING, SHARE_ENTITIES, SHARE_TYPES } from "../shareTypes";

/**
 * The shareable entry types are ONE list (spec 2026-10-16, D1). Bus was missing
 * from ten hand-kept lists until forgejo#288, and ferry carried a `share_key`
 * column nothing read. This suite holds the registry against the database,
 * the domain registry, the adapters and the inbox's own labels.
 */

/** Tables that carry `share_key` but are not shareable YET. Only shrinks. */
const UNWIRED_SHARE_KEY_TABLES: readonly string[] = ["ferry_journeys"];

const sharingJson = (lang: "de" | "en") =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../../frontend/src/i18n/resources/${lang}/sharing.json`),
      "utf8"
    )
  ) as { entityTypes: Record<string, string>; fields: Record<string, unknown> };

afterAll(async () => {
  await prisma.$disconnect();
});

describe("share type registry", () => {
  it("lists exactly the tables that carry a share_key column", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE column_name = 'share_key' AND table_schema = current_schema()`;
    const inDb = rows.map((r) => r.table_name).sort();
    const registered = SHARE_ENTITIES.map((e) => SHARE_TYPES[e].table);
    expect(inDb).toEqual([...registered, ...UNWIRED_SHARE_KEY_TABLES].sort());
  });

  it("has no stale unwired table", () => {
    const registered = new Set(SHARE_ENTITIES.map((e) => SHARE_TYPES[e].table));
    expect(UNWIRED_SHARE_KEY_TABLES.filter((t) => registered.has(t))).toEqual([]);
  });

  it("classifies every domain, and a shared domain names a type of its own", () => {
    for (const domain of DOMAIN_KEYS) {
      const rule = DOMAIN_SHARING[domain];
      if (typeof rule === "string") {
        expect(SHARE_TYPES[rule].domain).toBe(domain);
      } else {
        expect(rule.notShared.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it("has an adapter for every type, under its own name", () => {
    for (const entity of SHARE_ENTITIES) expect(ADAPTERS[entity].entity).toBe(entity);
  });

  it("keeps stops last: a stop resolves the entry it wraps by key", () => {
    expect(SHARE_ENTITIES[SHARE_ENTITIES.length - 1]).toBe("stop");
  });

  it.each(["de", "en"] as const)("names every type in the %s inbox", (lang) => {
    expect(Object.keys(sharingJson(lang).entityTypes).sort()).toEqual(
      ["trip", ...SHARE_ENTITIES].sort()
    );
  });

  it.each(["de", "en"] as const)("labels every fact field in %s", (lang) => {
    const labels = new Set(Object.keys(sharingJson(lang).fields));
    const missing = SHARE_ENTITIES.flatMap((e) =>
      ADAPTERS[e].fields.filter((f) => !labels.has(f)).map((f) => `${e}.${f}`)
    );
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/services/sharing/__tests__/shareTypes.test.ts`
Expected: FAIL — `Cannot find module '../shareTypes'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/sharing/shareTypes.ts
import type { DomainKey } from "../../shared/domains";

/**
 * The shareable entry types (design 2026-10-09; rework 2026-10-16, D1) — the
 * ONE list every per-type piece of sharing derives from: the notice
 * vocabulary, the share loop, key operations, detach, bulk sync, the merge,
 * the `.travstats` kinds, the coverage guard and the inbox labels.
 *
 * Order is copy order. Stops come last: a stop resolves the entry it wraps by
 * share key in the recipient's account, so that entry must exist first.
 *
 * `shareTypes.test.ts` holds this list against the database (every table with
 * a `share_key` column), against `DOMAIN_KEYS` and against the inbox labels.
 */
export const SHARE_ENTITIES = [
  "flight",
  "lodgingStay",
  "cruise",
  "rail",
  "bus",
  "rental",
  "stop",
] as const;
export type ShareEntity = (typeof SHARE_ENTITIES)[number];

/** The Prisma delegate behind a type — what `keyOps.delegateOf` switches over. */
export type ShareDelegate =
  | "flight"
  | "lodgingStay"
  | "cruise"
  | "railJourney"
  | "busJourney"
  | "ferryJourney"
  | "rentalBooking"
  | "tripStop";

/** The entry kinds of a `.travstats` file (`trip/exchange/format.ts`). */
export type ExchangeKind =
  | "flight"
  | "stay"
  | "cruise"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "stop";

export interface ShareTypeMeta {
  /** The domain whose entries these are; null for a timeline stop, which belongs to no domain. */
  readonly domain: DomainKey | null;
  readonly delegate: ShareDelegate;
  /** The SQL table (`@@map`), as `information_schema` names it. */
  readonly table: string;
  /** The key in a share's `created` counts — the wire name since S1. */
  readonly countKey: string;
  /** The `.travstats` kind; null while the file format does not carry the type. */
  readonly exchangeKind: ExchangeKind | null;
}

export const SHARE_TYPES = {
  flight: {
    domain: "flight",
    delegate: "flight",
    table: "flights",
    countKey: "flights",
    exchangeKind: "flight",
  },
  lodgingStay: {
    domain: "lodging",
    delegate: "lodgingStay",
    table: "lodging_stays",
    countKey: "lodgingStays",
    exchangeKind: "stay",
  },
  cruise: {
    domain: "cruise",
    delegate: "cruise",
    table: "cruises",
    countKey: "cruises",
    exchangeKind: "cruise",
  },
  rail: {
    domain: "rail",
    delegate: "railJourney",
    table: "rail_journeys",
    countKey: "railJourneys",
    exchangeKind: "rail",
  },
  bus: {
    domain: "bus",
    delegate: "busJourney",
    table: "bus_journeys",
    countKey: "busJourneys",
    exchangeKind: "bus",
  },
  rental: {
    domain: "rental",
    delegate: "rentalBooking",
    table: "rental_bookings",
    countKey: "rentals",
    exchangeKind: "rental",
  },
  stop: {
    domain: null,
    delegate: "tripStop",
    table: "trip_stops",
    countKey: "stops",
    exchangeKind: "stop",
  },
} as const satisfies Readonly<Record<ShareEntity, ShareTypeMeta>>;

type CountKey = (typeof SHARE_TYPES)[ShareEntity]["countKey"];
/** What one share created in the recipient's account, per type. */
export type CopyCounts = Record<CountKey, number>;

export function emptyCounts(): CopyCounts {
  return Object.fromEntries(
    SHARE_ENTITIES.map((e) => [SHARE_TYPES[e].countKey, 0])
  ) as CopyCounts;
}

/**
 * Every domain, shared or not, with the reason. `Record<DomainKey, …>` makes a
 * domain added to `shared/domains.ts` a compile error here until someone
 * decides — the step forgotten for bus and ferry.
 */
export const DOMAIN_SHARING: Readonly<Record<DomainKey, ShareEntity | { notShared: string }>> = {
  flight: "flight",
  cruise: "cruise",
  lodging: "lodgingStay",
  poi: { notShared: "A place visit is the visitor's own; owner decision 2 keeps it private." },
  roadtrip: { notShared: "Roadtrips and their stations are not shared (S1 scope, 2026-10-09)." },
  rail: "rail",
  rental: "rental",
  bus: "bus",
  ferry: { notShared: "Crossings join the registry with their adapter (rework 2026-10-16, Task 5)." },
};

/** What a copy is marked with where the table has a `dataSource` column. */
export const SHARED_SOURCE = "shared";
```

In `backend/src/services/sharing/adapters/types.ts` replace the block from the `SHARE_ENTITIES` doc comment through `export type ShareEntity = (typeof SHARE_ENTITIES)[number];` with:

```ts
import type { ShareEntity } from "../shareTypes";

export { SHARE_ENTITIES, type ShareEntity } from "../shareTypes";
```

(`adapters/index.ts` keeps `export { SHARE_ENTITIES, type EntityAdapter, type ShareEntity, type SharedRow } from "./types";`, so every importer is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/services/sharing/__tests__/shareTypes.test.ts` → PASS (9 tests).
Run: `$JEST src/routes/__tests__/sharing` → PASS (unchanged behaviour).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing/shareTypes.ts backend/src/services/sharing/adapters/types.ts backend/src/services/sharing/__tests__/shareTypes.test.ts
git commit -m "refactor(sharing): one registry of shareable entry types

Bus was missing from ten hand-kept lists until forgejo#288 and ferry carries a
share_key nothing reads. The registry is keyed to the domain registry and a
test holds it against every share_key column, every domain and the inbox
labels; ferry stands in the ratchet until its adapter lands."
```

### Task 2: Key operations over the registry

**Files:**
- Create: `backend/src/services/sharing/keyOps.ts`
- Modify: `backend/src/services/sharing/detach.ts:18-32`, `backend/src/services/sharing/bulkSync.ts:17-40`, `backend/src/services/sharing/adapters/stop.ts:14-75`, `backend/src/services/sharing/copyEntries.ts:51-88` (remove `assignShareKeys`), `backend/src/services/sharing/shareTrip.ts` (import), `backend/src/services/tripCleanupService.ts:266-370` (`moved`)
- Test: `backend/src/services/sharing/__tests__/keyOps.test.ts`

**Interfaces:**
- Consumes: `SHARE_ENTITIES`, `SHARE_TYPES`, `ShareEntity`, `ShareDelegate` (Task 1); `DbTransaction` (`db.ts`).
- Produces:
  - `interface KeyedDelegate { findMany(args: { where: Where; select: { id: true; shareKey: true }; orderBy?: { id: "asc" } }): Promise<KeyedRow[]>; findFirst(args: { where: Where; select: { id: true } }): Promise<{ id: string } | null>; update(args: { where: { id: string }; data: { shareKey?: string | null; tripId?: string } }): Promise<unknown>; updateMany(args: { where: Where; data: { shareKey?: null; tripId?: string } }): Promise<{ count: number }> }`
  - `delegateOf(c: DbTransaction, delegate: ShareDelegate): KeyedDelegate`; `keyedDelegate(c, entity: ShareEntity): KeyedDelegate`
  - `assignKeysFor(c, entity, ownerId, tripId): Promise<number>`; `assignShareKeys(c, ownerId, tripId): Promise<void>`
  - `clearTripKeys(c, userId, tripId): Promise<void>`
  - `keyedIdsOnTrip(c, entity, ownerId, tripId): Promise<string[]>`
  - `heldKeys(c, entity, recipientId, recipientTripId, keys: readonly string[]): Promise<Map<string, string>>`
  - `sharedIdsOf(c, userId, entity): Promise<string[]>`
  - `idsOnTrips(c, entity, tripIds: readonly string[]): Promise<string[]>`
  - `REF_DELEGATES: readonly ShareDelegate[]` (every delegate a stop may wrap)
  - `findByUserKey(c, delegate, userId, key): Promise<{ id: string } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/sharing/__tests__/keyOps.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import {
  assignShareKeys,
  clearTripKeys,
  keyedDelegate,
  keyedIdsOnTrip,
  sharedIdsOf,
} from "../keyOps";
import { SHARE_ENTITIES } from "../shareTypes";

/**
 * Keying, clearing and finding shared rows is one loop over the registry
 * (spec 2026-10-16, D2) — so a type added there is keyed on share, cleared on
 * detach and found by the bulk sync without a line elsewhere.
 */
describe("key operations over every registered type", () => {
  let anna: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-keys");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  /** makeFullTrip holds one flight, stay, cruise, rail ride and rental, two stops, no bus or ferry ride. */
  const expected = (entity: string) =>
    entity === "stop" ? 2 : entity === "bus" || entity === "ferry" ? 0 : 1;

  it("keys every entry of the trip once, and clears them again", async () => {
    const full = await makeFullTrip(anna);
    await prisma.$transaction((tx) => assignShareKeys(tx, anna.id, full.trip.id));
    for (const entity of SHARE_ENTITIES) {
      const ids = await prisma.$transaction((tx) =>
        keyedIdsOnTrip(tx, entity, anna.id, full.trip.id)
      );
      expect({ entity, n: ids.length }).toEqual({ entity, n: expected(entity) });
    }
    const first = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    await prisma.$transaction((tx) => assignShareKeys(tx, anna.id, full.trip.id));
    const again = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(again.shareKey).toBe(first.shareKey);

    await prisma.$transaction((tx) => clearTripKeys(tx, anna.id, full.trip.id));
    for (const entity of SHARE_ENTITIES) {
      const left = await prisma.$transaction((tx) =>
        keyedDelegate(tx, entity).findMany({
          where: entity === "stop" ? { tripId: full.trip.id } : { userId: anna.id },
          select: { id: true, shareKey: true },
        })
      );
      expect({ entity, keyed: left.filter((r) => r.shareKey).length }).toEqual({
        entity,
        keyed: 0,
      });
    }
  });

  it("finds a user's rows on a shared trip for the bulk sync", async () => {
    const full = await makeFullTrip(anna);
    const group = await prisma.tripShareGroup.create({ data: { createdById: anna.id } });
    await prisma.trip.update({ where: { id: full.trip.id }, data: { shareGroupId: group.id } });
    for (const entity of SHARE_ENTITIES) {
      const ids = await prisma.$transaction((tx) => sharedIdsOf(tx, anna.id, entity));
      expect({ entity, n: ids.length }).toEqual({ entity, n: expected(entity) });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/services/sharing/__tests__/keyOps.test.ts`
Expected: FAIL — `Cannot find module '../keyOps'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/sharing/keyOps.ts
import { randomUUID } from "crypto";

import type { DbTransaction } from "../../db";
import {
  SHARE_ENTITIES,
  SHARE_TYPES,
  type ShareDelegate,
  type ShareEntity,
} from "./shareTypes";

/**
 * Share keys, generically over the registry (spec 2026-10-16, D2): keying a
 * trip's entries on first share, clearing them on detach, finding a user's
 * shared rows for the bulk sync, and what a recipient already holds.
 *
 * A timeline stop has no user column — its trip's owner owns it — and only
 * timeline stops are keyed (roadtrip stations and route corrections are not
 * shared). That is the one special case, and it lives in `ownedOnTrip`.
 */
type Where = Record<string, unknown>;
interface KeyedRow {
  id: string;
  shareKey: string | null;
}

/**
 * The structural slice of a Prisma delegate the key operations use. The cast
 * in `delegateOf` is the price of one switch instead of eight copies: the
 * generated delegates share these shapes but not a common type.
 */
export interface KeyedDelegate {
  findMany(args: {
    where: Where;
    select: { id: true; shareKey: true };
    orderBy?: { id: "asc" };
  }): Promise<KeyedRow[]>;
  findFirst(args: { where: Where; select: { id: true } }): Promise<{ id: string } | null>;
  update(args: {
    where: { id: string };
    data: { shareKey?: string | null; tripId?: string };
  }): Promise<unknown>;
  updateMany(args: {
    where: Where;
    data: { shareKey?: null; tripId?: string };
  }): Promise<{ count: number }>;
}

export function delegateOf(c: DbTransaction, delegate: ShareDelegate): KeyedDelegate {
  switch (delegate) {
    case "flight":
      return c.flight as unknown as KeyedDelegate;
    case "lodgingStay":
      return c.lodgingStay as unknown as KeyedDelegate;
    case "cruise":
      return c.cruise as unknown as KeyedDelegate;
    case "railJourney":
      return c.railJourney as unknown as KeyedDelegate;
    case "busJourney":
      return c.busJourney as unknown as KeyedDelegate;
    case "ferryJourney":
      return c.ferryJourney as unknown as KeyedDelegate;
    case "rentalBooking":
      return c.rentalBooking as unknown as KeyedDelegate;
    case "tripStop":
      return c.tripStop as unknown as KeyedDelegate;
    default: {
      const unknownDelegate: never = delegate;
      throw new Error(`No delegate for ${String(unknownDelegate)}`);
    }
  }
}

export const keyedDelegate = (c: DbTransaction, entity: ShareEntity): KeyedDelegate =>
  delegateOf(c, SHARE_TYPES[entity].delegate);

/** Only timeline stops are keyed — roadtrip stations and route corrections are not shared. */
const TIMELINE_STOP = { routeId: null, viaPoint: false } as const;

/** The owner's rows of `entity` filed on `tripId` (every stop of the trip for `stop`). */
function ownedOnTrip(entity: ShareEntity, ownerId: string, tripId: string): Where {
  return entity === "stop" ? { tripId } : { tripId, userId: ownerId };
}

/** Every delegate a timeline stop may wrap (`sourceId` / `lodgingStayId`). */
export const REF_DELEGATES: readonly ShareDelegate[] = SHARE_ENTITIES.filter(
  (e) => e !== "stop"
).map((e) => SHARE_TYPES[e].delegate);

/** Key the unkeyed rows of one type on the owner's trip; one uuid per row. */
export async function assignKeysFor(
  c: DbTransaction,
  entity: ShareEntity,
  ownerId: string,
  tripId: string
): Promise<number> {
  const delegate = keyedDelegate(c, entity);
  const rows = await delegate.findMany({
    where: {
      ...ownedOnTrip(entity, ownerId, tripId),
      ...(entity === "stop" ? TIMELINE_STOP : {}),
      shareKey: null,
    },
    select: { id: true, shareKey: true },
  });
  for (const row of rows) {
    await delegate.update({ where: { id: row.id }, data: { shareKey: randomUUID() } });
  }
  return rows.length;
}

/** Give every entry of the sharer's trip a key, if it has none yet (first share). */
export async function assignShareKeys(
  c: DbTransaction,
  ownerId: string,
  tripId: string
): Promise<void> {
  for (const entity of SHARE_ENTITIES) await assignKeysFor(c, entity, ownerId, tripId);
}

/** Detach: clear every key on the member's trip; the rows stay theirs. */
export async function clearTripKeys(
  c: DbTransaction,
  userId: string,
  tripId: string
): Promise<void> {
  for (const entity of SHARE_ENTITIES) {
    await keyedDelegate(c, entity).updateMany({
      where: { ...ownedOnTrip(entity, userId, tripId), shareKey: { not: null } },
      data: { shareKey: null },
    });
  }
}

/** The keyed rows of one type on the owner's trip, oldest id first. */
export async function keyedIdsOnTrip(
  c: DbTransaction,
  entity: ShareEntity,
  ownerId: string,
  tripId: string
): Promise<string[]> {
  const rows = await keyedDelegate(c, entity).findMany({
    where: {
      ...ownedOnTrip(entity, ownerId, tripId),
      ...(entity === "stop" ? TIMELINE_STOP : {}),
      shareKey: { not: null },
    },
    select: { id: true, shareKey: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

/** Which of `keys` the recipient already holds: key → row id (on their trip, for stops). */
export async function heldKeys(
  c: DbTransaction,
  entity: ShareEntity,
  recipientId: string,
  recipientTripId: string,
  keys: readonly string[]
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const where =
    entity === "stop"
      ? { tripId: recipientTripId, shareKey: { in: [...keys] } }
      : { userId: recipientId, shareKey: { in: [...keys] } };
  const rows = await keyedDelegate(c, entity).findMany({
    where,
    select: { id: true, shareKey: true },
  });
  return new Map(rows.flatMap((r) => (r.shareKey ? [[r.shareKey, r.id] as const] : [])));
}

/** A user's rows of `entity` that are keyed or filed on one of their shared trips. */
export async function sharedIdsOf(
  c: DbTransaction,
  userId: string,
  entity: ShareEntity
): Promise<string[]> {
  const owned = entity === "stop" ? { trip: { userId } } : { userId };
  const rows = await keyedDelegate(c, entity).findMany({
    where: {
      ...owned,
      OR: [{ shareKey: { not: null } }, { trip: { shareGroupId: { not: null } } }],
    },
    select: { id: true, shareKey: true },
  });
  return rows.map((r) => r.id);
}

/** Ids of one type filed on any of `tripIds` — what a merge moves. */
export async function idsOnTrips(
  c: DbTransaction,
  entity: ShareEntity,
  tripIds: readonly string[]
): Promise<string[]> {
  const rows = await keyedDelegate(c, entity).findMany({
    where: { tripId: { in: [...tripIds] } },
    select: { id: true, shareKey: true },
  });
  return rows.map((r) => r.id);
}

/** `userId`'s row with `key` in one table (the `(userId, shareKey)` unique index). */
export async function findByUserKey(
  c: DbTransaction,
  delegate: ShareDelegate,
  userId: string,
  key: string
): Promise<{ id: string } | null> {
  if (delegate === "tripStop") return null;
  return delegateOf(c, delegate).findFirst({
    where: { userId, shareKey: key },
    select: { id: true },
  });
}
```

`detach.ts` — replace the eight writes (the `const own`/`clear` block, six `updateMany` and the `tripStop.updateMany`) with:

```ts
  await clearTripKeys(tx, userId, trip.id);
```

and add `import { clearTripKeys } from "./keyOps";`.

`bulkSync.ts` — delete the local `sharedIds` function and its ternary ladder; import `sharedIdsOf` from `./keyOps`; in both loops replace `sharedIds(prisma, userId, entity)` by `prisma.$transaction((tx) => sharedIdsOf(tx, userId, entity))`.

`adapters/stop.ts` — replace `EntryRef.table`'s literal union with `ShareDelegate`, delete `REF_TABLES`, and rewrite `refsOf` and `resolveRef`:

```ts
import { REF_DELEGATES, delegateOf, findByUserKey } from "../keyOps";
import type { ShareDelegate } from "../shareTypes";

export interface EntryRef {
  table: ShareDelegate;
  key: string;
}

/** id → reference by share key, for every id that names a keyed entry. */
async function refsOf(c: DbTransaction, ids: string[]): Promise<Map<string, EntryRef>> {
  const out = new Map<string, EntryRef>();
  if (ids.length === 0) return out;
  for (const table of REF_DELEGATES) {
    const rows = await delegateOf(c, table).findMany({
      where: { id: { in: ids }, shareKey: { not: null } },
      select: { id: true, shareKey: true },
    });
    for (const row of rows) if (row.shareKey) out.set(row.id, { table, key: row.shareKey });
  }
  return out;
}

/** The id of `userId`'s own copy behind `ref`, or null. */
async function resolveRef(
  c: DbTransaction,
  ref: EntryRef | null | undefined,
  userId: string
): Promise<string | null> {
  if (!ref || !REF_DELEGATES.includes(ref.table)) return null;
  return (await findByUserKey(c, ref.table, userId, ref.key))?.id ?? null;
}
```

`copyEntries.ts` — delete `assignShareKeys`; `shareTrip.ts` imports `assignShareKeys` from `./keyOps` instead.

`tripCleanupService.ts` (merge) — replace the hand-written `moved` object with:

```ts
    const moved = new Map<ShareEntity, string[]>();
    for (const entity of SHARE_ENTITIES) {
      moved.set(entity, await idsOnTrips(tx, entity, sourceIds));
    }
```

and the propagation loop at the end of the transaction with:

```ts
    for (const [entity, ids] of moved) {
      await propagateWrites(tx, userId, entity, ids);
    }
```

with `import { idsOnTrips } from "./sharing/keyOps"; import { SHARE_ENTITIES, type ShareEntity } from "./sharing/shareTypes";`. The explicit `updateMany(move)` calls stay — they also move bookings, routes, journal, documents, expenses and photos, which are not shareable.

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/services/sharing/__tests__/keyOps.test.ts` → PASS.
Run: `$JEST src/routes/__tests__/sharing src/routes/__tests__/trips` → PASS (detach, merge, bulk unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing/keyOps.ts backend/src/services/sharing/__tests__/keyOps.test.ts backend/src/services/sharing/detach.ts backend/src/services/sharing/bulkSync.ts backend/src/services/sharing/adapters/stop.ts backend/src/services/sharing/copyEntries.ts backend/src/services/sharing/shareTrip.ts backend/src/services/tripCleanupService.ts
git commit -m "refactor(sharing): key, clear and find shared rows over the registry

Detach, bulk sync, the stop's entry references and the trip merge each kept
their own list of seven tables. One loop over the registry now does each of
them, so the next shareable type needs no line in any of them."
```

### Task 3: One copy path

**Files:**
- Create: `backend/src/services/sharing/copyInto.ts`
- Modify: `backend/src/services/sharing/adapters/types.ts` (`EntityAdapter.ownMatch?`), `backend/src/services/sharing/adapters/flat.ts` (flight `ownMatch`, `SHARED_SOURCE` import), `adapters/lodgingStay.ts`, `adapters/cruise.ts` (`SHARED_SOURCE` import), `backend/src/services/sharing/shareTrip.ts:1-170`, `backend/src/services/sharing/propagate.ts:110-160` (`notice` → exported `recordEntryNotice`, `meta` → exported `noticeMeta`, `createCopies`), `backend/src/services/sharing/__tests__/propagate.writePaths.test.ts` (exemptions), `frontend/src/types/sharing.ts` (`ShareNoticeAfter.joined`), `frontend/src/components/inbox/ShareNoticeRow.tsx` (joined text), `frontend/src/i18n/resources/{de,en}/sharing.json` (`inbox.notices.joined`)
- Delete: `backend/src/services/sharing/copyEntries.ts`
- Test: `backend/src/routes/__tests__/sharing.copyPath.test.ts`

**Interfaces:**
- Consumes: `ADAPTERS`, `keyedDelegate`, `heldKeys`, `keyedIdsOnTrip`, `assignShareKeys`, `SHARE_ENTITIES`, `SHARE_TYPES`, `emptyCounts`, `CopyCounts`, `ownFlightCandidates`, `sameFlight`, `FlightIdentity` (`ownFlightMatch.ts`).
- Produces:
  - `EntityAdapter.ownMatch?(c: DbTransaction, source: SharedRow, recipientId: string): Promise<{ id: string; tripId: string | null } | null>`
  - `interface Recipient { userId: string; tripId: string }`
  - `copyInto(c: DbTransaction, entity: ShareEntity, source: SharedRow, recipient: Recipient): Promise<{ id: string; joined: boolean }>`
  - `copyMissing(c: DbTransaction, entity: ShareEntity, owner: Recipient, recipient: Recipient): Promise<CopiedEntry[]>` with `interface CopiedEntry { source: SharedRow; id: string; joined: boolean }`
  - `recordEntryNotice(c: DbTransaction, n: NoticeInput): Promise<string>` (returns the notice id), `noticeMeta(row: SharedRow, recipient: MemberTrip, copyId: string)` — both exported from `propagate.ts`
  - `ShareResult.created: CopyCounts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/sharing.copyPath.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { propagateWrite } from "../../services/sharing/propagate";
import { SHARE_ENTITIES, SHARE_TYPES } from "../../services/sharing/shareTypes";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * One copy path (spec 2026-10-16, D3): sharing a trip and propagating a new
 * entry both go through `copyInto`, so both join the recipient's own logged
 * flight instead of copying a duplicate — and neither joins a different one.
 */
describe("trip sharing — one copy path", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-copy");
    ben = await makeAccount("ben-copy");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("counts what it created per registered type", async () => {
    const full = await makeFullTrip(anna);
    const companion = await linkWithConsent(anna, ben);
    const result = await shareTrip(anna.id, full.trip.id, companion.id);
    expect(Object.keys(result.created).sort()).toEqual(
      SHARE_ENTITIES.map((e) => SHARE_TYPES[e].countKey).sort()
    );
    expect(result.created.flights).toBe(1);
    expect(result.created.stops).toBe(2);
  });

  it("joins the recipient's own logged flight when a new one is added to the shared trip", async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    const bensOwn = await prisma.flight.create({
      data: {
        userId: ben.id,
        flightNumber: "TP 0576",
        depIata: "LIS",
        arrIata: "FRA",
        departureTime: new Date("2025-05-08T18:00:00.000Z"),
        depTimezone: "Europe/Lisbon",
        seatNumber: "BEN-SEAT",
      },
    });
    const annas = await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        departureTime: new Date("2025-05-08T18:00:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    await propagateWrite(prisma, anna.id, "flight", annas.id);

    const keyed = await prisma.flight.findUniqueOrThrow({ where: { id: annas.id } });
    const joined = await prisma.flight.findUniqueOrThrow({ where: { id: bensOwn.id } });
    expect(joined.shareKey).toBe(keyed.shareKey);
    expect(joined.tripId).toBe(memberTrip.id);
    expect(joined.seatNumber).toBe("BEN-SEAT");
    expect(
      await prisma.flight.count({ where: { userId: ben.id, flightNumber: { contains: "576" } } })
    ).toBe(1);
    const notice = await prisma.shareNotice.findFirstOrThrow({
      where: { userId: ben.id, kind: "created", entityType: "flight" },
    });
    expect((notice.after as { joined?: boolean }).joined).toBe(true);
  });

  it("does not join the recipient's same flight number on the next local day", async () => {
    const { full } = await sharedPair(anna, ben);
    // Anna's departs 23:30 in Lisbon on the 8th (22:30Z); Ben's 00:30 local on the 9th.
    await prisma.flight.create({
      data: {
        userId: ben.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        departureTime: new Date("2025-05-08T23:30:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    const annas = await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        departureTime: new Date("2025-05-08T22:30:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    await propagateWrite(prisma, anna.id, "flight", annas.id);
    expect(await prisma.flight.count({ where: { userId: ben.id, flightNumber: "TP576" } })).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/sharing.copyPath.test.ts`
Expected: test 1 PASSES already (the old `CopyCounts` keys equal the registry's count keys — it guards the switch to `emptyCounts()`); test 2 FAILS — `expect(joined.shareKey).toBe(keyed.shareKey)` receives `null`, because propagation creates a second `TP576` row for Ben instead of joining his own; test 3 PASSES (the control that the join stays conservative).

- [ ] **Step 3: Write minimal implementation**

`adapters/types.ts` — add to `EntityAdapter`:

```ts
  /**
   * The recipient's own unkeyed row that IS this entry — a flight the
   * companion logged themselves — or null. Joined instead of copied
   * (`copyInto`), so no statistic counts the journey twice. Absent: never joins.
   */
  ownMatch?(
    c: DbTransaction,
    source: SharedRow,
    recipientId: string
  ): Promise<{ id: string; tripId: string | null } | null>;
```

`adapters/flat.ts` — `import { SHARED_SOURCE } from "../shareTypes";` (replacing the `../copyEntries` import), `import { ownFlightCandidates, sameFlight, type FlightIdentity } from "../ownFlightMatch";`, and on `flightAdapter`:

```ts
  async ownMatch(c, source, recipientId) {
    const identity = source.facts as unknown as FlightIdentity;
    const candidates = await ownFlightCandidates(c, recipientId, [identity]);
    const hit = candidates.find((f) => sameFlight(identity, f));
    return hit ? { id: hit.id, tripId: hit.tripId } : null;
  },
```

(`ownFlightCandidates` already filters `shareKey: null`, so a row joined earlier in the same transaction is not offered twice.) `adapters/lodgingStay.ts` and `adapters/cruise.ts` import `SHARED_SOURCE` from `"../shareTypes"`.

```ts
// backend/src/services/sharing/copyInto.ts
import type { DbTransaction } from "../../db";
import { ADAPTERS, type SharedRow } from "./adapters";
import { heldKeys, keyedDelegate, keyedIdsOnTrip } from "./keyOps";
import type { ShareEntity } from "./shareTypes";

/**
 * The one copy path (spec 2026-10-16, D3). Sharing a trip, propagating a new
 * entry and the ferry backfill all put an entry into another member's
 * account through here:
 *
 * 1. the recipient's own unkeyed row that IS this entry (`adapter.ownMatch`)
 *    takes the key — and is filed on their trip of the group when it had no
 *    trip; its private fields (their seat, their notes) stay as they are;
 * 2. otherwise the adapter creates a copy from the facts.
 *
 * Before the rework the share path joined own flights and propagation did
 * not, and each had its own house-reuse code.
 */
export interface Recipient {
  userId: string;
  tripId: string;
}

export async function copyInto(
  c: DbTransaction,
  entity: ShareEntity,
  source: SharedRow,
  recipient: Recipient
): Promise<{ id: string; joined: boolean }> {
  const adapter = ADAPTERS[entity];
  const own = adapter.ownMatch ? await adapter.ownMatch(c, source, recipient.userId) : null;
  if (own) {
    await keyedDelegate(c, entity).update({
      where: { id: own.id },
      data: { shareKey: source.shareKey, ...(own.tripId ? {} : { tripId: recipient.tripId }) },
    });
    return { id: own.id, joined: true };
  }
  const id = await adapter.createCopy(c, source, recipient.userId, recipient.tripId);
  return { id, joined: false };
}

export interface CopiedEntry {
  source: SharedRow;
  id: string;
  joined: boolean;
}

/** The owner trip's keyed entries of one type that the recipient does not hold yet, copied. */
export async function copyMissing(
  c: DbTransaction,
  entity: ShareEntity,
  owner: Recipient,
  recipient: Recipient
): Promise<CopiedEntry[]> {
  const ids = await keyedIdsOnTrip(c, entity, owner.userId, owner.tripId);
  const sources = await ADAPTERS[entity].load(c, ids);
  const have = await heldKeys(
    c,
    entity,
    recipient.userId,
    recipient.tripId,
    sources.flatMap((s) => (s.shareKey ? [s.shareKey] : []))
  );
  const out: CopiedEntry[] = [];
  for (const source of sources) {
    if (!source.shareKey || have.has(source.shareKey)) continue;
    out.push({ source, ...(await copyInto(c, entity, source, recipient)) });
  }
  return out;
}
```

`shareTrip.ts` — remove the `./copyEntries` import; import `assignShareKeys` from `./keyOps`, `copyMissing` from `./copyInto`, `SHARE_ENTITIES, SHARE_TYPES, emptyCounts, type CopyCounts` from `./shareTypes`; `ShareResult.created: CopyCounts`; replace the `const ctx … const created: CopyCounts = {…}` block with:

```ts
      // Registry order: stops last, they resolve the entries they wrap by key.
      const created = emptyCounts();
      for (const entity of SHARE_ENTITIES) {
        const copied = await copyMissing(
          tx,
          entity,
          { userId, tripId: trip.id },
          { userId: recipientId, tripId: target.id }
        );
        created[SHARE_TYPES[entity].countKey] = copied.filter((e) => !e.joined).length;
      }
```

(The `after.created` notice payload stays `{ ...created }`.)

`propagate.ts` — rename `notice` to exported `recordEntryNotice` returning the id, and `meta` to exported `noticeMeta` (same body):

```ts
export async function recordEntryNotice(c: DbTransaction, n: NoticeInput): Promise<string> {
  const row = await c.shareNotice.create({
    data: {
      userId: n.recipient.userId,
      groupId: n.groupId,
      actorId: n.actorId,
      kind: n.kind,
      entityType: n.entity,
      entityKey: n.shareKey,
      ...(n.before ? { before: n.before } : {}),
      after: n.after,
    },
    select: { id: true },
  });
  return row.id;
}
```

`NoticeInput` is exported too. `createCopies` becomes:

```ts
async function createCopies(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  groupId: string
): Promise<void> {
  const key = randomUUID();
  await adapter.setKey(c, row.id, key);
  const source = { ...row, shareKey: key };
  for (const member of await receivingMembers(c, groupId, actorId)) {
    const copy = await copyInto(c, adapter.entity, source, {
      userId: member.userId,
      tripId: member.id,
    });
    await recomputeTripStatus(member.id, c);
    await recordEntryNotice(c, {
      recipient: member,
      groupId,
      actorId,
      kind: "created",
      entity: adapter.entity,
      shareKey: key,
      after: { ...noticeMeta(source, member, copy.id), ...(copy.joined ? { joined: true } : {}) },
    });
  }
}
```

Every other `notice(`/`meta(` call in `propagate.ts` is renamed accordingly. Delete `backend/src/services/sharing/copyEntries.ts`. In `propagate.writePaths.test.ts` remove the `"services/sharing/copyEntries.ts"` entry and add `"services/sharing/copyInto.ts": "propagation writes (the copies and joins)"` and `"services/sharing/keyOps.ts": "share keys only — no fact"` to `EXEMPT`.

Frontend (same commit): `de/sharing.json` `inbox.notices.joined`: "{{name}} hat {{type}} „{{entry}}“ zur geteilten Reise hinzugefügt. Dein eigener Eintrag ist jetzt damit verbunden."; `en/sharing.json`: "{{name}} added {{type}} “{{entry}}” to the shared trip. Your own entry is now linked to it." `ShareNoticeAfter` in `frontend/src/types/sharing.ts` gains `joined?: boolean;`; in `ShareNoticeRow.tsx` the `kindKey` becomes `notice.kind === "deleted" && after.reason === "movedOut" ? "movedOut" : notice.kind === "created" && after.joined ? "joined" : notice.kind` (the row is replaced in Task 17; the key survives).

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/sharing.copyPath.test.ts` → PASS (3).
Run: `$JEST src/routes/__tests__/sharing src/services/sharing` → PASS (`sharing.ownFlight.test.ts` still green: the share path joins through `copyInto` now).
Run: `cd frontend && npx vitest --run src/i18n/__tests__/localeKeyParity.test.ts src/components/inbox` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing backend/src/routes/__tests__/sharing.copyPath.test.ts frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json frontend/src/types/sharing.ts frontend/src/components/inbox/ShareNoticeRow.tsx
git commit -m "refactor(sharing): one copy path for share and propagation

copyEntries.ts copied seven types by hand beside the adapters' createCopy,
with its own house reuse; only the share path joined a flight the companion
had logged. copyInto is now the only way an entry reaches another account,
so a flight added to a shared trip later is joined too, not duplicated."
```

### Task 4: Derived columns of a copy, for the recipient

**Files:**
- Modify: `backend/src/shared/time/profileZone.ts` (add `dayAnchorNowFor`)
- Create: `backend/src/services/sharing/deriveCopy.ts`
- Modify: `backend/src/services/sharing/copyInto.ts` (derive after create), `backend/src/services/sharing/propagate.ts` (`updateCopies`, `createCopies`: derive + `restatusTrips`), `backend/src/services/sharing/shareTrip.ts` (restatus the recipient trip), `backend/src/services/sharing/adapters/lodgingStay.ts:98-106,151-156,173-175` (stop deriving), `backend/src/services/lodging/stayWrites.ts:63-65` (use the helper), `backend/src/services/cruise/createCruise.ts:80`, `backend/src/services/sharing/__tests__/propagate.writePaths.test.ts` (`deriveCopy.ts` exempt)
- Test: `backend/src/routes/__tests__/sharing.deriveCopy.test.ts`

**Interfaces:**
- Consumes: `deriveFlightStatus`, `deriveLodgingStatus`, `deriveCruiseStatus`, `deriveRailStatus`, `deriveBusStatus`, `deriveRentalStatus` (`shared/statusDerivation.ts`), `rideEndsAt` (`shared/railClock.ts`), `dayAnchorNow` (`shared/time/clock.ts`), `profileZoneOf`, `restatusTrips` (`services/trip/restatusTrips.ts`).
- Produces: `dayAnchorNowFor(userId: string): Promise<Date>`; `type DeriveCopy = (c: DbTransaction, copyId: string, recipientId: string) => Promise<void>`; `DERIVE: Readonly<Record<ShareEntity, DeriveCopy>>`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/sharing.deriveCopy.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A copy's status is derived for its RECIPIENT (spec 2026-10-16, D4). A stay's
 * status is a day question answered on the user's own calendar (ADR 0002 D4,
 * `stayWrites.ts`); the copy path answered it on the server's clock.
 */
describe("trip sharing — derived columns of a copy", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-derive");
    ben = await makeAccount("ben-derive");
    await prisma.userSettings.create({
      data: { userId: ben.id, data: { display: { timezone: "Pacific/Kiritimati" } } },
    });
    // 12:00Z on the 9th: still the 9th in UTC, already 02:00 on the 10th in Kiritimati (UTC+14).
    setClockForTests("2026-03-09T12:00:00.000Z");
  });
  afterEach(() => setClockForTests(null));
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("completes a copied stay on the recipient's calendar", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Kiribati" } });
    const lodging = await prisma.lodging.create({
      data: { userId: anna.id, name: "Ocean Lodge", city: "London", country: "KI" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: anna.id,
        tripId: trip.id,
        lodgingId: lodging.id,
        checkIn: day("2026-03-05"),
        checkOut: day("2026-03-10"),
        checkInDate: day("2026-03-05"),
        checkOutDate: day("2026-03-10"),
        status: "in_progress",
      },
    });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, trip.id, companion.id);

    const bens = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bens.status).toBe("completed");
    const annas = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: anna.id } });
    expect(annas.status).toBe("in_progress");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/sharing.deriveCopy.test.ts`
Expected: FAIL — `Expected: "completed"`, `Received: "in_progress"` (the adapter derives on the server clock).

- [ ] **Step 3: Write minimal implementation**

`shared/time/profileZone.ts` — add (and import `dayAnchorNow` from `./clock`):

```ts
/**
 * "Now" against a DAY column, on `userId`'s own calendar (ADR 0002 D4) — the
 * one home of what `stayWrites.ts` (`stayStatusNow`) and `createCruise.ts`
 * each wrote inline, and what a shared copy is derived with for its recipient.
 */
export async function dayAnchorNowFor(userId: string): Promise<Date> {
  return dayAnchorNow((await profileZoneOf(userId)).zone);
}
```

`stayWrites.ts` — delete `stayStatusNow`; both call sites become `now: await dayAnchorNowFor(userId)`. `createCruise.ts:80` — `now: await dayAnchorNowFor(userId),`.

```ts
// backend/src/services/sharing/deriveCopy.ts
import type { DbTransaction } from "../../db";
import { rideEndsAt } from "../../shared/railClock";
import {
  deriveBusStatus,
  deriveCruiseStatus,
  deriveFlightStatus,
  deriveLodgingStatus,
  deriveRailStatus,
  deriveRentalStatus,
} from "../../shared/statusDerivation";
import { dayAnchorNowFor } from "../../shared/time/profileZone";
import type { ShareEntity } from "./shareTypes";

/**
 * The derived columns of a copy (spec 2026-10-16, D4). Facts travel as stored
 * (ADR 0002); a status is a CACHE of the facts and the clock, so each copy's is
 * derived afresh with its domain's own function — for the recipient: a stay or
 * a cruise asks the recipient's calendar, as its own write path does. The
 * trip's status is re-derived by the caller (`restatusTrips`), once per trip.
 */
export type DeriveCopy = (c: DbTransaction, copyId: string, recipientId: string) => Promise<void>;

const RIDE_SELECT = {
  status: true,
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
} as const;

export const DERIVE: Readonly<Record<ShareEntity, DeriveCopy>> = {
  async flight(c, id) {
    const f = await c.flight.findUniqueOrThrow({
      where: { id },
      select: { status: true, departureTime: true, arrivalTime: true, actualArrival: true },
    });
    const status = deriveFlightStatus({ ...f, current: f.status });
    if (status !== f.status) await c.flight.update({ where: { id }, data: { status } });
  },
  async lodgingStay(c, id, recipientId) {
    const s = await c.lodgingStay.findUniqueOrThrow({
      where: { id },
      select: { status: true, checkIn: true, checkOut: true },
    });
    const status = deriveLodgingStatus({
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      current: s.status,
      now: await dayAnchorNowFor(recipientId),
    });
    if (status !== s.status) await c.lodgingStay.update({ where: { id }, data: { status } });
  },
  async cruise(c, id, recipientId) {
    const r = await c.cruise.findUniqueOrThrow({
      where: { id },
      select: { status: true, startDate: true, endDate: true },
    });
    const status = deriveCruiseStatus({
      startDate: r.startDate,
      endDate: r.endDate,
      current: r.status,
      now: await dayAnchorNowFor(recipientId),
    });
    if (status !== r.status) await c.cruise.update({ where: { id }, data: { status } });
  },
  async rail(c, id) {
    const r = await c.railJourney.findUniqueOrThrow({ where: { id }, select: RIDE_SELECT });
    const status = deriveRailStatus({ ...r, current: r.status, endsAt: rideEndsAt(r) });
    if (status !== r.status) await c.railJourney.update({ where: { id }, data: { status } });
  },
  async bus(c, id) {
    const r = await c.busJourney.findUniqueOrThrow({ where: { id }, select: RIDE_SELECT });
    const status = deriveBusStatus({ ...r, current: r.status, endsAt: rideEndsAt(r) });
    if (status !== r.status) await c.busJourney.update({ where: { id }, data: { status } });
  },
  async rental(c, id) {
    const r = await c.rentalBooking.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        pickupTime: true,
        returnTime: true,
        returnPrecision: true,
        returnTimezone: true,
      },
    });
    const status = deriveRentalStatus({ ...r, current: r.status });
    if (status !== r.status) await c.rentalBooking.update({ where: { id }, data: { status } });
  },
  // A timeline stop caches nothing.
  async stop() {},
};
```

`copyInto.ts` — after `createCopy`: `await DERIVE[entity](c, id, recipient.userId);` (import `DERIVE` from `./deriveCopy`).

`propagate.ts` — `import { restatusTrips } from "../trip/restatusTrips";` and `import { DERIVE } from "./deriveCopy";`; in `createCopies` replace `await recomputeTripStatus(member.id, c);` by `await restatusTrips([member.id], c);`; in `updateCopies` replace

```ts
    await adapter.apply(c, copy, row.facts, keys, before.facts);
```

with

```ts
    await adapter.apply(c, copy, row.facts, keys, before.facts);
    await DERIVE[adapter.entity](c, copy.id, member.userId);
```

and its `recomputeTripStatus(member.id, c)` by `restatusTrips([member.id], c)`; drop the `recomputeTripStatus` import.

`shareTrip.ts` — after the copy loop: `await restatusTrips([target.id], tx);`.

`adapters/lodgingStay.ts` — delete `derivedStatus`; in `createCopy` drop the `status: deriveLodgingStatus({...})` property (the fact `status` from `lodgingStayFacts` is written, `DERIVE` corrects it); in `apply` delete the `if (["checkIn", "checkOut", "status"].some(...)) data.status = derivedStatus(data, copy);` statement; drop the `deriveLodgingStatus` import.

`propagate.writePaths.test.ts` — `EXEMPT` gains `"services/sharing/deriveCopy.ts": "a copy's derived status, written by propagation"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/sharing.deriveCopy.test.ts` → PASS.
Run: `$JEST src/routes/__tests__/sharing src/routes/__tests__/lodging src/routes/__tests__/cruises src/services/sharing` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shared/time/profileZone.ts backend/src/services/sharing backend/src/services/lodging/stayWrites.ts backend/src/services/cruise/createCruise.ts backend/src/routes/__tests__/sharing.deriveCopy.test.ts
git commit -m "fix(sharing): derive a copy's status for its recipient

The lodging status of a copy was derived in three places, each on the
server's clock, while the stay's own write path asks the user's calendar. A
recipient across the date line saw a finished stay as in progress. One DERIVE
entry per type now uses each domain's own function and the recipient's day."
```

### Task 5: Ferry crossings are shareable

**Files:**
- Create: `backend/src/services/sharing/facts/ferry.ts`, `backend/src/services/sharing/adapters/ferry.ts`
- Modify: `backend/src/services/sharing/facts/index.ts` (export), `backend/src/services/sharing/adapters/index.ts` (`ferry: ferryAdapter`), `backend/src/services/sharing/shareTypes.ts` (entity + `DOMAIN_SHARING.ferry`), `backend/src/services/sharing/deriveCopy.ts` (`ferry`), `backend/src/services/sharing/__tests__/shareTypes.test.ts` (empty `UNWIRED_SHARE_KEY_TABLES`), `backend/src/services/sharing/__tests__/propagate.writePaths.test.ts` (`ferryJourney` in `WRITE`; `adapters/ferry.ts` exempt), `backend/src/routes/ferry.ts:218-372`, `backend/src/routes/ferry/roadtrip.ts:104-150`, `backend/src/services/openapi/paths/sharing.ts` (`counts.ferryJourneys`, share description), `backend/prisma/schema.prisma` (`ShareNotice.entityType` comment), `frontend/src/types/sharing.ts` (`ShareEntityType`, `ShareCounts`), `frontend/src/i18n/resources/{de,en}/sharing.json` (`entityTypes.ferry`, `fields.vesselName`, `trip.privateHint`)
- Test: `backend/src/routes/__tests__/sharing.ferry.test.ts`

**Interfaces:**
- Consumes: `EntityAdapter`, `pickFacts`, `jsonForWrite`, `plainData`, `joinLabel`, `localDay` (`shared/time/instant.ts`), `haversineKm` (`shared/geo/haversine.ts`), `shareSnapshot`, `propagateWrite`, `propagateDelete`.
- Produces: `FERRY_FACT_FIELDS`, `type FerryFactField`, `ferryFacts(row)`, `ferryAdapter: EntityAdapter` (with `ownMatch`), `SAME_TERMINAL_KM = 1`, `SHARE_ENTITIES` = `["flight","lodgingStay","cruise","rail","bus","ferry","rental","stop"]`, `SHARE_TYPES.ferry = { domain: "ferry", delegate: "ferryJourney", table: "ferry_journeys", countKey: "ferryJourneys", exchangeKind: null }` (Task 11 sets `"ferry"`).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/sharing.ferry.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { detachTrip } from "../../services/sharing/detach";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Ferry crossings in a shared trip (spec 2026-10-16, G2). Rail's and bus's
 * rule: operator, vessel, terminals, times and distance are facts; fare class,
 * seat, cabin, booking and ticket references, price, notes, companions, the
 * vehicle on board and the roadtrip leg stay private.
 */
describe("trip sharing — ferry crossings", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  const crossing = (userId: string, extra: object = {}) =>
    prisma.ferryJourney.create({
      data: {
        userId,
        operator: "Stena Line",
        vesselName: "Stena Germanica",
        depStationName: "Kiel Schwedenkai",
        depLat: 54.3167,
        depLon: 10.1394,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationName: "Göteborg Stigberget",
        arrLat: 57.6995,
        arrLon: 11.9364,
        arrCountry: "SE",
        arrTimezone: "Europe/Stockholm",
        departureTime: new Date("2026-06-01T16:45:00Z"),
        arrivalTime: new Date("2026-06-02T07:15:00Z"),
        depPrecision: "minute",
        arrPrecision: "minute",
        distanceKm: 452,
        status: "scheduled",
        fareClass: "Comfort",
        seat: "PRIVATE-SEAT",
        cabinType: "outside",
        ticketReference: "TICKET-PRIV",
        bookingReference: "BOOK-PRIV",
        vehicleType: "car",
        vehicleRegistration: "KI-AB 123",
        price: 389,
        notes: "PRIVATE ferry note",
        ...extra,
      },
    });
  const bens = () => prisma.ferryJourney.findMany({ where: { userId: ben.id } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-ferry");
    ben = await makeAccount("ben-ferry");
    tripId = (await prisma.trip.create({ data: { userId: anna.id, name: "Schweden" } })).id;
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("copies a crossing's facts and none of its private fields", async () => {
    await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    const result = await shareTrip(anna.id, tripId, companion.id);
    expect(result.created.ferryJourneys).toBe(1);
    const [copy] = await bens();
    expect(copy).toMatchObject({
      operator: "Stena Line",
      vesselName: "Stena Germanica",
      depStationName: "Kiel Schwedenkai",
      distanceKm: 452,
      seat: null,
      cabinType: null,
      ticketReference: null,
      bookingReference: null,
      vehicleType: null,
      vehicleRegistration: null,
      price: null,
      notes: null,
      roadtripLegId: null,
    });
    expect(copy.shareKey).not.toBeNull();
  });

  it("joins Ben's own logged crossing instead of copying it", async () => {
    await crossing(anna.id, { tripId });
    const own = await crossing(ben.id, { depLat: 54.317, seat: "BEN-SEAT" });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const rows = await bens();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: own.id, seat: "BEN-SEAT" });
  });

  it("follows an edit and tells Ben about a delete", async () => {
    const annas = await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    await prisma.shareNotice.deleteMany({ where: { userId: ben.id } });

    const patched = await request(app)
      .patch(`/api/v1/ferry/${annas.id}`)
      .set("Cookie", anna.cookie)
      .send({ vesselName: "Stena Scandinavica" });
    expect(patched.status).toBe(200);
    expect((await bens())[0].vesselName).toBe("Stena Scandinavica");
    const updated = await prisma.shareNotice.findFirstOrThrow({
      where: { userId: ben.id, kind: "updated" },
    });
    expect(updated.entityType).toBe("ferry");

    const removed = await request(app)
      .delete(`/api/v1/ferry/${annas.id}`)
      .set("Cookie", anna.cookie);
    expect(removed.status).toBe(204);
    expect(await bens()).toHaveLength(1);
    expect(
      await prisma.shareNotice.count({
        where: { userId: ben.id, kind: "deleted", entityType: "ferry" },
      })
    ).toBe(1);
  });

  it("clears the crossing's key when Ben leaves", async () => {
    await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const bensTrip = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    await prisma.$transaction((tx) => detachTrip(tx, ben.id, bensTrip));
    expect((await bens())[0].shareKey).toBeNull();
  });

  it("linking a crossing to a leg of a shared trip copies it without the leg", async () => {
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const route = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, name: "Südschweden", mode: "car", kind: "roadtrip" },
    });
    const [from, to] = await Promise.all(
      [0, 1].map((orderIdx) =>
        prisma.tripStop.create({
          data: { tripId, routeId: route.id, orderIdx, title: orderIdx ? "Göteborg" : "Kiel" },
        })
      )
    );
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: from.id,
        toStopId: to.id,
        distanceKm: 460,
        source: "osrm",
        mode: "car",
      },
    });
    const annas = await crossing(anna.id);

    const linked = await request(app)
      .put(`/api/v1/ferry/${annas.id}/roadtrip-leg`)
      .set("Cookie", anna.cookie)
      .send({ legId: leg.id });
    expect(linked.status).toBe(200);

    const rows = await bens();
    expect(rows).toHaveLength(1);
    expect(rows[0].roadtripLegId).toBeNull();
    expect(rows[0].roadtripLegBefore).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/sharing.ferry.test.ts`
Expected: FAIL — `result.created.ferryJourneys` is `undefined`, and Ben holds no crossing in every other case.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/sharing/facts/ferry.ts
import type { FerryJourney, Prisma } from "../../../prisma";
import { jsonForWrite, pickFacts } from "./pick";

/**
 * A ferry crossing's facts (rework 2026-10-16; bus's and rail's rule): operator
 * and vessel, both terminals with address, position, country and zone, the
 * times as stored (real instants, ADR 0002), the frozen sea line, what actually
 * happened, status and delay. Private: fare class, seat, cabin type, booking
 * and ticket references, price and FX snapshot, notes, tags, companions, the
 * vehicle on board (type, registration, size, passengers) and the roadtrip
 * leg it is linked to — a roadtrip is not shared.
 */
export const FERRY_FACT_FIELDS = [
  "operator",
  "vesselName",
  "depStationName",
  "depAddress",
  "depLat",
  "depLon",
  "depCountry",
  "depTimezone",
  "arrStationName",
  "arrAddress",
  "arrLat",
  "arrLon",
  "arrCountry",
  "arrTimezone",
  "departureTime",
  "arrivalTime",
  "depPrecision",
  "arrPrecision",
  "distanceKm",
  "distanceSource",
  "geometry",
  "geometrySource",
  "actualDepartureTime",
  "actualArrivalTime",
  "status",
  "delayMinutes",
] as const satisfies readonly (keyof FerryJourney)[];

export type FerryFactField = (typeof FERRY_FACT_FIELDS)[number];

export function ferryFacts(row: Pick<FerryJourney, FerryFactField>) {
  const facts = pickFacts(row, FERRY_FACT_FIELDS);
  return {
    ...facts,
    geometry: jsonForWrite(facts.geometry),
  } satisfies Partial<Prisma.FerryJourneyUncheckedCreateInput>;
}
```

`facts/index.ts`: add `export * from "./ferry";` after `./bus`.

```ts
// backend/src/services/sharing/adapters/ferry.ts
import type { FerryJourney, Prisma } from "../../../prisma";
import { haversineKm } from "../../../shared/geo/haversine";
import { localDay } from "../../../shared/time/instant";
import { FERRY_FACT_FIELDS, ferryFacts, pickFacts, type FerryFactField } from "../facts";
import { joinLabel, plainData, type EntityAdapter, type SharedRow } from "./types";

/** A crossing: facts are its own columns, as for bus and rail. */
const FERRY_JSON = ["geometry"] as const;

/**
 * Two terminals are the same within this distance. A port's pin is typed or
 * geocoded by each member on their own — Kiel Schwedenkai lands a few hundred
 * metres apart depending on who looked it up — while two terminals of one city
 * served by the same line on the same day are rare enough to stay apart.
 */
export const SAME_TERMINAL_KM = 1;
/** A local departure day is the same instant ± 14 h of offset; two days cover it. */
const WINDOW_MS = 2 * 86_400_000;

function ferryRow(row: FerryJourney): SharedRow {
  return {
    id: row.id,
    userId: row.userId,
    tripId: row.tripId,
    shareKey: row.shareKey,
    facts: pickFacts(row, FERRY_FACT_FIELDS),
    label: joinLabel(row.operator, row.vesselName, `${row.depStationName} → ${row.arrStationName}`),
    zones: {
      departureTime: row.depTimezone,
      actualDepartureTime: row.depTimezone,
      arrivalTime: row.arrTimezone,
      actualArrivalTime: row.arrTimezone,
    },
  };
}

export const ferryAdapter: EntityAdapter = {
  entity: "ferry",
  fields: FERRY_FACT_FIELDS,
  async load(c, ids) {
    return (await c.ferryJourney.findMany({ where: { id: { in: [...ids] } } })).map(ferryRow);
  },
  async copiesOf(c, shareKey, groupId) {
    return (
      await c.ferryJourney.findMany({ where: { shareKey, trip: { shareGroupId: groupId } } })
    ).map(ferryRow);
  },
  async setKey(c, id, key) {
    await c.ferryJourney.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.ferryJourney.create({
      data: {
        ...ferryFacts(source.facts as Pick<FerryJourney, FerryFactField>),
        userId: recipientId,
        tripId: recipientTripId,
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, FERRY_FACT_FIELDS, FERRY_JSON);
    await c.ferryJourney.update({
      where: { id: copy.id },
      data: data as Prisma.FerryJourneyUncheckedUpdateInput,
    });
  },
  async remove(c, id) {
    await c.ferryJourney.delete({ where: { id } });
  },
  /** The recipient's own crossing: the same two terminals on the same local day. */
  async ownMatch(c, source, recipientId) {
    const f = source.facts as Pick<FerryJourney, FerryFactField>;
    if (!f.depTimezone) return null;
    const day = localDay(f.departureTime, f.depTimezone);
    const at = f.departureTime.getTime();
    const rows = await c.ferryJourney.findMany({
      where: {
        userId: recipientId,
        shareKey: null,
        status: { not: "cancelled" },
        departureTime: { gte: new Date(at - WINDOW_MS), lte: new Date(at + WINDOW_MS) },
      },
      select: {
        id: true,
        tripId: true,
        departureTime: true,
        depTimezone: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
      },
      orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    });
    const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
      haversineKm(a, b) <= SAME_TERMINAL_KM;
    const hit = rows.find(
      (r) =>
        localDay(r.departureTime, r.depTimezone ?? f.depTimezone!) === day &&
        near({ lat: r.depLat, lon: r.depLon }, { lat: f.depLat, lon: f.depLon }) &&
        near({ lat: r.arrLat, lon: r.arrLon }, { lat: f.arrLat, lon: f.arrLon })
    );
    return hit ? { id: hit.id, tripId: hit.tripId } : null;
  },
};
```

`adapters/index.ts`: `import { ferryAdapter } from "./ferry";` and `ferry: ferryAdapter,` between `bus` and `rental`.

`shareTypes.ts`: insert `"ferry"` between `"bus"` and `"rental"` in `SHARE_ENTITIES`; add

```ts
  ferry: {
    domain: "ferry",
    delegate: "ferryJourney",
    table: "ferry_journeys",
    countKey: "ferryJourneys",
    exchangeKind: null,
  },
```

and `DOMAIN_SHARING.ferry = "ferry"`. `ShareTypeMeta.exchangeKind` keeps `null` allowed; Task 11 sets it.

`deriveCopy.ts`: add

```ts
  async ferry(c, id) {
    const r = await c.ferryJourney.findUniqueOrThrow({ where: { id }, select: RIDE_SELECT });
    // Ferry derives with bus's rule (`ferryJourneyWrite.ts`: deriveBusStatus as deriveFerryStatus).
    const status = deriveBusStatus({ ...r, current: r.status, endsAt: rideEndsAt(r) });
    if (status !== r.status) await c.ferryJourney.update({ where: { id }, data: { status } });
  },
```

`shareTypes.test.ts`: `const UNWIRED_SHARE_KEY_TABLES: readonly string[] = [];`.

`routes/ferry.ts` — add `import { propagateDelete, propagateWrite, shareSnapshot } from "../services/sharing/propagate";`. In `createFerryRide`, after `await claim(tx, created.id);`:

```ts
    // On a shared trip: copied to the other members (design 2026-10-09).
    await propagateWrite(tx, userId, "ferry", created.id);
```

In `PATCH /:id`, first line inside the transaction: `const before = await shareSnapshot(tx, "ferry", existing.id);`, and after `tx.ferryJourney.update(...)`: `await propagateWrite(tx, userId, "ferry", existing.id, before);`. Replace the `DELETE /:id` body's delete with:

```ts
    await prisma.$transaction(async (tx) => {
      const gone = await shareSnapshot(tx, "ferry", existing.id);
      const deleted = await tx.ferryJourney.deleteMany({
        where: {
          id: existing.id,
          userId,
          ...(baseVersion === null ? {} : { updatedAt: new Date(baseVersion) }),
        },
      });
      if (deleted.count !== 1) throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
      // The others keep their copies and are told (decision 3).
      await propagateDelete(tx, userId, gone);
    });
```

`routes/ferry/roadtrip.ts` — inside the transaction, after the `findFirst` of the crossing: `const before = await shareSnapshot(tx, "ferry", ferry.id);`; before each `return` inside the transaction (unlink and link branches): `await propagateWrite(tx, req.userId!, "ferry", ferry.id, before);` — linking files the crossing on the roadtrip's trip, which is a move into a shared trip; `roadtripLegId` is not a fact, so a link on an already-filed crossing propagates nothing.

`propagate.writePaths.test.ts`: add `ferryJourney` to the `WRITE` alternation and `"services/sharing/adapters/ferry.ts": "propagation writes (the copies)"` to `EXEMPT`.

`openapi/paths/sharing.ts`: `counts` gains `ferryJourneys: z.number().int(),`; the share description lists "ferry crossing". `schema.prisma` — `ShareNotice.entityType` comment: `/// trip | flight | lodgingStay | cruise | rail | bus | ferry | rental | stop — services/sharing/shareTypes.ts`.

Frontend: `types/sharing.ts` — `ShareEntityType` adds `"ferry"`, `ShareCounts` adds `ferryJourneys: number`. `de/sharing.json`: `entityTypes.ferry` "die Fährfahrt", `fields.vesselName` "Schiff", `trip.privateHint` "Kopiert werden nur Fakten — Flüge, Unterkünfte, Kreuzfahrten, Bahn-, Bus- und Fährfahrten, Mietwagen und Stopps. Sitzplatz, Kabine, Zimmer, Preis, Bewertungen und Notizen bleiben privat."; `en/sharing.json`: `entityTypes.ferry` "the ferry crossing", `fields.vesselName` "Vessel", `trip.privateHint` "Only facts are copied — flights, stays, cruises, train, bus and ferry rides, rentals and stops. Seat, cabin, room, price, ratings and notes stay private."

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/sharing.ferry.test.ts src/services/sharing/__tests__/shareTypes.test.ts src/services/sharing/__tests__/propagate.writePaths.test.ts src/routes/__tests__/ferry.test.ts` → PASS.
Run: `cd frontend && npx vitest --run src/i18n/__tests__/localeKeyParity.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing backend/src/routes/ferry.ts backend/src/routes/ferry/roadtrip.ts backend/src/routes/__tests__/sharing.ferry.test.ts backend/src/services/openapi/paths/sharing.ts backend/prisma/schema.prisma frontend/src/types/sharing.ts frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json
git commit -m "feat(sharing): ferry crossings travel with a shared trip

FerryJourney carried a share_key that nothing read: a shared trip silently
held no crossing, an edit reached nobody and the write-path guard did not look
at the table. Crossings now follow bus's rule — facts copied and kept in step,
a member's own logged crossing joined, vehicle and roadtrip leg private."
```

### Task 6: Checked vocabularies for consents and notices

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_share_vocabulary_checks/migration.sql` (via `npx prisma migrate dev --create-only --name share_vocabulary_checks`)
- Create: `backend/src/schemas/sharing.ts`
- Modify: `backend/src/services/sharing/notices.ts:12-50`, `backend/src/services/sharing/undo.ts:26-31`, `backend/src/services/sharing/consent.ts:30-40`, `backend/prisma/schema.prisma` (comments on `ShareConsent.status`, `ShareNotice.kind`), `backend/src/services/openapi/paths/sharing.ts` (`entityType` enum)
- Test: `backend/src/services/sharing/__tests__/shareVocabulary.test.ts`

**Interfaces:**
- Consumes: `SHARE_ENTITIES`, `ShareEntity`.
- Produces: `CONSENT_STATUSES`, `consentStatusSchema`, `type ConsentStatus`; `SHARE_NOTICE_KINDS`, `shareNoticeKindSchema`, `type ShareNoticeKind`; `SHARE_ENTITY_TYPES` (`["trip", ...SHARE_ENTITIES]`), `shareEntityTypeSchema`, `type ShareEntityType`; `ShareNoticeView.kind: ShareNoticeKind`, `.entityType: ShareEntityType | null`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/sharing/__tests__/shareVocabulary.test.ts
import { afterAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import { CONSENT_STATUSES, SHARE_ENTITY_TYPES, SHARE_NOTICE_KINDS } from "../../../schemas/sharing";

/**
 * The sharing vocabularies live twice — as Zod unions in code and as CHECK
 * constraints in the database (spec 2026-10-16, D6). A value added on one side
 * only either cannot be written or cannot be read; this holds them together,
 * as `syncTriggers.test.ts` does for the sync feed.
 */
const CHECKS = {
  share_consents_status_check: CONSENT_STATUSES,
  share_notices_kind_check: SHARE_NOTICE_KINDS,
  share_notices_entity_type_check: SHARE_ENTITY_TYPES,
} as const;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sharing vocabularies — code and database agree", () => {
  it.each(Object.entries(CHECKS))("%s lists exactly the code's values", async (name, values) => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
    expect(rows).toHaveLength(1);
    const inDb = [...rows[0].def.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...values].sort());
  });

  it("refuses a notice kind outside the list", async () => {
    const user = await prisma.user.create({
      data: { username: "share-test-vocab", passwordHash: "x" },
    });
    try {
      await expect(
        prisma.shareNotice.create({ data: { userId: user.id, kind: "renamed" } })
      ).rejects.toThrow(/share_notices_kind_check/);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/services/sharing/__tests__/shareVocabulary.test.ts`
Expected: FAIL — `Cannot find module '../../../schemas/sharing'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/schemas/sharing.ts
import { z } from "zod";

import { SHARE_ENTITIES, type ShareEntity } from "../services/sharing/shareTypes";

/**
 * The vocabularies of trip sharing (spec 2026-10-16, D6). Each list is also a
 * CHECK constraint (migration `share_vocabulary_checks`) and
 * `shareVocabulary.test.ts` holds the two together. Not Prisma enums: the
 * entity list IS the share registry, and a Prisma enum cannot be derived from
 * code — the loyalty domains made the same choice.
 */
export const CONSENT_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export const consentStatusSchema = z.enum(CONSENT_STATUSES);
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const SHARE_NOTICE_KINDS = ["shared", "created", "updated", "deleted", "left"] as const;
export const shareNoticeKindSchema = z.enum(SHARE_NOTICE_KINDS);
export type ShareNoticeKind = z.infer<typeof shareNoticeKindSchema>;

/** `trip` for shared/left notices, an entry type otherwise. */
export const SHARE_ENTITY_TYPES: readonly ("trip" | ShareEntity)[] = ["trip", ...SHARE_ENTITIES];
export const shareEntityTypeSchema = z.enum(SHARE_ENTITY_TYPES as ["trip", ...ShareEntity[]]);
export type ShareEntityType = z.infer<typeof shareEntityTypeSchema>;
```

Migration (create with `cd backend && npx prisma migrate dev --create-only --name share_vocabulary_checks`, then write):

```sql
-- Trip sharing vocabularies as CHECK constraints (spec 2026-10-16, D6).
-- Lists mirror backend/src/schemas/sharing.ts; shareVocabulary.test.ts holds
-- them together. Offending rows are counted first so a failure names them
-- instead of surfacing as a bare constraint violation at boot.
DO $$
DECLARE
  bad_status integer;
  bad_kind integer;
  bad_type integer;
BEGIN
  SELECT count(*) INTO bad_status FROM share_consents
    WHERE status NOT IN ('pending', 'accepted', 'declined', 'withdrawn');
  SELECT count(*) INTO bad_kind FROM share_notices
    WHERE kind NOT IN ('shared', 'created', 'updated', 'deleted', 'left');
  SELECT count(*) INTO bad_type FROM share_notices
    WHERE entity_type IS NOT NULL AND entity_type NOT IN
      ('trip', 'flight', 'lodgingStay', 'cruise', 'rail', 'bus', 'ferry', 'rental', 'stop');
  IF bad_status + bad_kind + bad_type > 0 THEN
    RAISE EXCEPTION 'share vocabulary: % consent status, % notice kind and % entity type values are outside the lists',
      bad_status, bad_kind, bad_type;
  END IF;
END $$;

ALTER TABLE share_consents ADD CONSTRAINT share_consents_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn'));
ALTER TABLE share_notices ADD CONSTRAINT share_notices_kind_check
  CHECK (kind IN ('shared', 'created', 'updated', 'deleted', 'left'));
ALTER TABLE share_notices ADD CONSTRAINT share_notices_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN
    ('trip', 'flight', 'lodgingStay', 'cruise', 'rail', 'bus', 'ferry', 'rental', 'stop'));
```

Then `npx prisma migrate dev` (applies it) and `npm run check:drift` (green: CHECKs are invisible to the schema diff).

`notices.ts` — import `shareEntityTypeSchema, shareNoticeKindSchema, type ShareEntityType, type ShareNoticeKind` from `"../../schemas/sharing"`; `ShareNoticeView.kind: ShareNoticeKind; entityType: ShareEntityType | null;`; in the mapper `kind: shareNoticeKindSchema.parse(row.kind), entityType: row.entityType === null ? null : shareEntityTypeSchema.parse(row.entityType),` — a value the database refuses cannot be read either; a parse failure is a 500 with the value in the log, never a silently dropped notice.

`undo.ts` — `entityOf` becomes:

```ts
function entityOf(type: string | null): ShareEntity {
  const parsed = shareEntityTypeSchema.safeParse(type);
  if (!parsed.success || parsed.data === "trip") {
    throw new AppError("This notice names no entry", 409, "SHARE_UNDO_UNAVAILABLE");
  }
  return parsed.data;
}
```

`consent.ts` — the local `ConsentStatus` type becomes `export type { ConsentStatus } from "../../schemas/sharing";` and the `row.status as ConsentStatus` cast becomes `consentStatusSchema.parse(row.status)`.

`schema.prisma` comments: `ShareConsent.status` → `/// pending | accepted | declined | withdrawn — CHECK share_consents_status_check, schemas/sharing.ts`; `ShareNotice.kind` → `/// shared | created | updated | deleted | left — CHECK share_notices_kind_check`.

`openapi/paths/sharing.ts` — `notice.entityType: z.enum(SHARE_ENTITY_TYPES as ["trip", ...ShareEntity[]]).nullable()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/services/sharing/__tests__/shareVocabulary.test.ts src/routes/__tests__/sharing.undo.test.ts src/routes/__tests__/sharing.consent.test.ts src/__tests__/openapi.responseSchema.test.ts` → PASS.
Run: `cd backend && DATABASE_URL=… npm run check:drift` → no drift.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/migrations backend/prisma/schema.prisma backend/src/schemas/sharing.ts backend/src/services/sharing backend/src/services/openapi/paths/sharing.ts
git commit -m "feat(sharing): consent status, notice kind and entry type are checked vocabularies

Three free string columns carried the sharing vocabulary and the schema
comment on entity_type had already gone stale. CHECK constraints in the
database and Zod unions in code now hold them, and a test fails when the two
lists disagree."
```

### Task 7: Per-call propagation guard and the low-ratio paths

**Files:**
- Rewrite: `backend/src/services/sharing/__tests__/propagate.writePaths.test.ts`
- Modify (annotations / propagation): `backend/src/services/trip/exchange/commit.ts:430-490` (`createEntry`), `backend/src/services/lodging/lodgingImportBatches.ts:136-143`, `backend/src/routes/trips.ts:571`, `backend/src/services/travplan/execution.ts:405`, `backend/src/services/lodging/lodgingImportCommit.ts:132`, `backend/src/services/trip/exchange/commit.ts:388-400` (`SHARED_KINDS` from the registry), and every further `file:line` the new guard prints (reasons below)
- Test: `backend/src/routes/__tests__/sharing.lowRatioPaths.test.ts`

**Interfaces:**
- Consumes: `SHARE_ENTITIES`, `SHARE_TYPES`.
- Produces: the annotation convention `// share-exempt: <reason>` (one line, directly above the write or one line higher).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/sharing/__tests__/propagate.writePaths.test.ts
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import { SHARE_ENTITIES, SHARE_TYPES } from "../shareTypes";

/**
 * Every WRITE to a shareable table propagates — or says why not, at the call
 * (spec 2026-10-16, D5). The file-level guard this replaces passed a file with
 * eight writes and one propagate call; it proved "this file mentions
 * propagation", not "this write propagates".
 *
 * A write is covered when
 *   (a) a propagation call follows it inside the same top-level declaration
 *       (from one column-0 declaration to the next), or
 *   (b) `// share-exempt: <reason>` stands on one of the two lines above it, or
 *   (c) its file is in FILE_EXEMPT — files whose every write shares one reason.
 * A `share-exempt` comment with no write in the two lines below it is stale and
 * fails, as is a FILE_EXEMPT entry that no longer writes or now propagates.
 *
 * This is a source scanner and it will age (memory: "Quelltext-scannende
 * Waechter altern"): `sharing.lowRatioPaths.test.ts` proves the paths it once
 * found weakest by running them.
 */
const SRC = join(__dirname, "../../..");
const TABLES = [
  ...SHARE_ENTITIES.map((e) => SHARE_TYPES[e].delegate),
  "lodging",
  "cruiseStop",
  "cruiseLeg",
];
const WRITE = new RegExp(
  `\\.(${TABLES.join("|")})\\s*\\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\\(`,
  "g"
);
const PROPAGATES = /\b(propagateWrites?|propagateDeletes?|detachTrip|propagateBulk)\(/;
const MARK = /\/\/ share-exempt: \S/;
const DECLARATION = /^(export |async |function |const |let |router\.|class )/;

const FILE_EXEMPT: Record<string, string> = {
  "services/sharing/adapters/flat.ts": "propagation writes (the copies)",
  "services/sharing/adapters/bus.ts": "propagation writes (the copies)",
  "services/sharing/adapters/ferry.ts": "propagation writes (the copies)",
  "services/sharing/adapters/lodgingStay.ts": "propagation writes (the copies)",
  "services/sharing/adapters/cruise.ts": "propagation writes (the copies)",
  "services/sharing/adapters/stop.ts": "propagation writes (the copies)",
  "services/sharing/copyInto.ts": "propagation writes (the copies and joins)",
  "services/sharing/deriveCopy.ts": "a copy's derived status, written by propagation",
  "services/sharing/keyOps.ts": "share keys only — no fact",
  "index.ts": "boot-time aircraft-name normalisation, applied to every account",
  "services/statusSweep.ts": "status sweep, runs over every account's rows",
  "services/flightAutoUpdate.ts": "provider tracking job, per account",
  "services/flightLandedStatus.ts": "provider tracking job, per account",
  "services/finalArrivalLookup.ts": "provider lookup job, per account",
  "services/bulkFlightRefresh.ts": "provider refresh, per account",
  "services/nextApiCheckBackfill.ts": "scheduling column — private",
  "services/lodging/geocodeBackfill.ts": "geocoding job, per account",
  "services/lodging/stayFxBackfill.ts": "FX snapshot — private",
  "services/openData/lodgingEnrichment.ts": "open-data enrichment job, per account",
  "services/timeMigration/flights.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/cruises.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/rail.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/tripStops.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/dayColumns.ts": "ADR 0002 migration, every account alike",
  "services/timeMigration/reResolve.ts": "ADR 0002 migration, every account alike",
  "services/xlsxImport/flights.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/rail.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/bus.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/cruises.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/lodging.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/prune.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/routeLists.ts": "xlsx run, propagated by importSheets.ts",
  "services/xlsxImport/companionLinks.ts": "companions — private",
  "services/roadtrip/companionStations.ts": "roadtrip stations — not shared",
  "services/roadtrip/replaceStations.ts": "roadtrip stations — not shared",
  "services/tour/replaceTourPoints.ts": "tour points — not shared",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ["generated", "__tests__", "scripts", "seedDemo"].includes(name) ? [] : sources(path);
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.startsWith("seed")) return [];
    return [path];
  });
}

interface Write {
  rel: string;
  line: number;
}

function uncovered(rel: string, text: string): Write[] {
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) => (DECLARATION.test(l) ? [i] : []));
  const blockEnd = (line: number) => starts.find((s) => s > line) ?? lines.length;
  const out: Write[] = [];
  for (const match of text.matchAll(WRITE)) {
    const line = text.slice(0, match.index).split("\n").length - 1;
    const marked = [line - 1, line - 2].some((i) => i >= 0 && MARK.test(lines[i]));
    const after = lines.slice(line, blockEnd(line)).join("\n");
    if (!marked && !PROPAGATES.test(after.slice(after.indexOf(match[0]) + match[0].length))) {
      out.push({ rel, line: line + 1 });
    }
  }
  return out;
}

function staleMarks(rel: string, text: string): Write[] {
  const lines = text.split("\n");
  return lines.flatMap((l, i) => {
    if (!MARK.test(l)) return [];
    const below = lines.slice(i + 1, i + 3).join("\n");
    return new RegExp(WRITE.source).test(below) ? [] : [{ rel, line: i + 1 }];
  });
}

describe("sharing — every write to a shareable table propagates, per call", () => {
  const files = sources(SRC).map((path) => ({
    rel: relative(SRC, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }));
  const writes = (text: string) => new RegExp(WRITE.source).test(text);

  it("finds the writers at all", () => {
    expect(files.filter((f) => writes(f.text)).length).toBeGreaterThan(30);
  });

  it("each write propagates or carries its reason", () => {
    const missing = files
      .filter((f) => !(f.rel in FILE_EXEMPT))
      .flatMap((f) => uncovered(f.rel, f.text))
      .map((w) => `${w.rel}:${w.line}`);
    expect(missing).toEqual([]);
  });

  it("no share-exempt comment is stale", () => {
    const stale = files.flatMap((f) => staleMarks(f.rel, f.text)).map((w) => `${w.rel}:${w.line}`);
    expect(stale).toEqual([]);
  });

  it("no file exemption is stale", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.text]));
    const stale = Object.keys(FILE_EXEMPT).filter((rel) => {
      const text = byRel.get(rel);
      return !text || !writes(text) || PROPAGATES.test(text);
    });
    expect(stale).toEqual([]);
  });
});
```

```ts
// backend/src/routes/__tests__/sharing.lowRatioPaths.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { mergeTrips } from "../../services/tripCleanupService";
import { SHARE_ENTITIES, SHARE_TYPES } from "../../services/sharing/shareTypes";
import {
  makeAccount,
  makeFullTrip,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * The write paths the old per-file guard rated weakest (2026-10-16 count:
 * trip/exchange/commit.ts 8 writes / 1 propagate call, tripCleanupService.ts
 * 8/2, lodgingImportBatches.ts 3/1, routes/trips.ts 3/2), run end to end on a
 * shared trip: whatever they write must reach — or be reported to — Ben.
 */
describe("trip sharing — the low-ratio write paths", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-low");
    ben = await makeAccount("ben-low");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const countsOf = async (userId: string) =>
    Object.fromEntries(
      await Promise.all(
        SHARE_ENTITIES.filter((e) => e !== "stop").map(async (e) => [
          e,
          await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*)::bigint AS n FROM ${SHARE_TYPES[e].table} WHERE user_id = $1`,
            userId
          ).then((r) => Number(r[0].n)),
        ])
      )
    );

  it("a .travstats file imported into the shared trip reaches Ben", async () => {
    const { memberTrip } = await sharedPair(anna, ben);
    // Carl's trip covers the same days (the import attaches to Anna's sole
    // overlapping trip, the shared one) but holds different journeys, so the
    // proposal creates every entry instead of matching Anna's own.
    const carl = await makeAccount("carl-low");
    const carls = await makeFullTrip(carl);
    await prisma.flight.update({ where: { id: carls.flight.id }, data: { flightNumber: "LH1172" } });
    await prisma.lodging.update({ where: { id: carls.lodging.id }, data: { name: "Casa Carl" } });
    await prisma.cruise.update({ where: { id: carls.cruise.id }, data: { cruiseLine: "TUI Cruises" } });
    await prisma.railJourney.update({ where: { id: carls.rail.id }, data: { trainNumber: "777" } });
    await prisma.rentalBooking.update({ where: { id: carls.rental.id }, data: { provider: "Europcar" } });
    const exported = await request(app)
      .get(`/api/v1/trips/${carls.trip.id}/export`)
      .set("Cookie", carl.cookie)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);

    const before = await countsOf(ben.id);
    await commitTripFile(anna.id, readTripArchive(exported.body as Buffer));
    const after = await countsOf(ben.id);
    for (const e of ["flight", "lodgingStay", "cruise", "rail", "rental"]) {
      expect({ e, grew: after[e] > before[e] }).toEqual({ e, grew: true });
    }
    expect(await prisma.tripStop.count({ where: { tripId: memberTrip.id } })).toBeGreaterThan(2);
  });

  it("merging a trip into the shared one copies what moved", async () => {
    const { full } = await sharedPair(anna, ben);
    const other = await makeFullTrip(anna);
    const before = await countsOf(ben.id);
    await mergeTrips(anna.id, { tripIds: [full.trip.id, other.trip.id], targetId: full.trip.id });
    const after = await countsOf(ben.id);
    expect(after.flight).toBe(before.flight + 1);
    expect(after.rail).toBe(before.rail + 1);
  });

  it("deleting the shared trip detaches it and tells Ben", async () => {
    const { full } = await sharedPair(anna, ben);
    const res = await request(app).delete(`/api/v1/trips/${full.trip.id}`).set("Cookie", anna.cookie);
    expect(res.status).toBe(204);
    expect(await prisma.shareNotice.count({ where: { userId: ben.id, kind: "left" } })).toBe(1);
    expect(await prisma.flight.count({ where: { userId: ben.id, shareKey: { not: null } } })).toBe(0);
  });
});
```

(The import attaches to the shared trip through the proposal's own rule — the sole trip of Anna's overlapping the file's days, `tripOverlapping` — so the test needs no choice argument.)

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/services/sharing/__tests__/propagate.writePaths.test.ts src/routes/__tests__/sharing.lowRatioPaths.test.ts`
Expected: `propagate.writePaths` FAILS on "each write propagates or carries its reason", listing at least `services/trip/exchange/commit.ts:<line>` (each create in `createEntry`), `services/lodging/lodgingImportBatches.ts:<lines>` (`lodging.deleteMany`, `lodging.updateMany`), `routes/trips.ts:<line>` (roadtrip `tripStop.updateMany`), plus the former per-file exemptions (`routes/uploads.ts`, `services/documents/*.ts`, `services/rail/railConnection.ts`, `routes/rental/links.ts`, `services/rental/rentalImport.ts`, `services/places/placeMerge.ts`, `services/flights/flightReimport.ts`, `services/cruiseDistance/cruiseLegService.ts`, `services/tripDetectionService.ts`, `services/lodging/createLodging.ts`, `routes/trips/tourRoutes.ts`, `services/tour/legRecompute.ts`). `sharing.lowRatioPaths` PASSES its first and third case and FAILS the merge case only if Task 2 was skipped — it is the regression net for this task's edits.

- [ ] **Step 3: Write minimal implementation**

Annotate each listed call with the reason it had at file level (carried over verbatim from the old `EXEMPT` table), one comment per call, e.g. in `routes/uploads.ts`:

```ts
        // share-exempt: clears a receipt URL — private
        await prisma.flight.updateMany({
```

Reasons per file (from the old table): `routes/uploads.ts`, `services/documents/documentService.ts` "clears a receipt URL — private"; `services/documents/receipts.ts` "receipt links — private"; `services/rail/railConnection.ts` "booking link — private"; `routes/rental/links.ts` "roadtrip link — private (no roadtrip is shared)"; `services/rental/rentalImport.ts` "last-mail mark only; real updates go through rentalRowWrite.ts"; `services/places/placeMerge.ts` "re-points the owner's own stations to the kept place; copies point at their own places"; `services/flights/flightReimport.ts` "onlineCheckInOpensAt/Zone — booking terms, not a shared fact"; `services/cruiseDistance/cruiseLegService.ts` "legs recomputed inside the cruise writes, which propagate after it"; `services/tripDetectionService.ts` "files unfiled flights into a trip it just created — never shared"; `services/lodging/createLodging.ts` "a new house has no stay yet"; `routes/trips/tourRoutes.ts` "route membership of stops — not a fact"; `services/tour/legRecompute.ts` "stop update helper; routes/trips/tripStops.ts propagates around it".

New reasons for the low-ratio files:

`services/trip/exchange/commit.ts` — above each `tx.<model>.create` in `createEntry` (flight, lodging, lodgingStay, cruise, railJourney, busJourney, rentalBooking):

```ts
      // share-exempt: returns the id to writeEntries, which propagates ids[kind] after every kind is written
```

and replace the `SHARED_KINDS` constant with a registry-derived list:

```ts
/** Imported into a shared trip: copied to its members — registry order, stops last. */
const SHARED_KINDS = SHARE_ENTITIES.flatMap((entity) => {
  const kind = SHARE_TYPES[entity].exchangeKind;
  return kind === null ? [] : [[kind === "stay" ? "stay" : kind, entity] as const];
});
```

(`import { SHARE_ENTITIES, SHARE_TYPES } from "../../sharing/shareTypes";`; `ids[kind]` is indexed with `kind as keyof IdMaps`.)

`services/lodging/lodgingImportBatches.ts`:

```ts
      // share-exempt: deletes houses this batch created that nothing hangs from — a shared stay's house is never empty
      const lodgings = emptyIds.length
```

```ts
        // share-exempt: clears the batch link of an occupied house — import bookkeeping, not a fact
        ? await tx.lodging.updateMany({
```

`routes/trips.ts` (trip delete):

```ts
          // share-exempt: roadtrip stations leave the trip with their roadtrip — not shared
          await tx.tripStop.updateMany({
```

`services/travplan/execution.ts` (house of a replaced stay):

```ts
      // share-exempt: deletes the house the plan itself created for the stay it just replaced
      await tx.lodging.deleteMany({ where: { id: old.source.auxId, userId } });
```

`services/lodging/lodgingImportCommit.ts` (house create before the stay):

```ts
  // share-exempt: a new house has no stay yet; the stay below propagates
  const lodging = await prisma.lodging.create({
```

Any further line the guard prints after these edits gets either a propagation call (if the write moves an entry into or out of a trip, or changes a fact column listed in `services/sharing/facts/*`) or a `share-exempt` reason that names why the column is private or the row is never on a shared trip. Re-run until the guard is green; do not widen `FILE_EXEMPT` for a file that also has propagating writes.

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/services/sharing/__tests__/propagate.writePaths.test.ts src/routes/__tests__/sharing.lowRatioPaths.test.ts src/routes/__tests__/tripExchange` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "test(sharing): guard propagation per write call, not per file

A file with eight writes and one propagate call passed the old guard. Each
write to a shareable table now has to be followed by propagation in its own
declaration or carry its reason on the line above, and the four paths the old
count rated weakest run end to end on a shared trip."
```

### Task 8: Propagation in the write's own transaction

**Files:**
- Modify: `backend/src/services/lodging/stayWrites.ts:67-86,359-395`, `backend/src/routes/trips.ts:620-640`, `backend/src/services/pendingUpdateService.ts:518-536`
- Test: `backend/src/routes/__tests__/sharing.sameTransaction.test.ts`

**Interfaces:**
- Consumes: `shareSnapshot(s)`, `propagateWrite(s)`, `ADAPTERS` (spied in tests).
- Produces: no new exports; `createStayRecord`, `updateStayRecord`, `applyPendingUpdate` keep their signatures.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/sharing.sameTransaction.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { ADAPTERS } from "../../services/sharing/adapters";
import { applyPendingUpdate } from "../../services/pendingUpdateService";
import { updateStayRecord } from "../../services/lodging/stayWrites";
import { sharedPair, makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";

/**
 * A member never sees "saved" for a change the others did not get (spec
 * 2026-10-16, D8). These three paths wrote first and propagated in a
 * transaction of their own; a failed propagation left the write stored.
 */
describe("trip sharing — propagation shares the write's transaction", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-tx");
    ben = await makeAccount("ben-tx");
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("assigning a flight to the shared trip rolls back when the copy fails", async () => {
    const { full } = await sharedPair(anna, ben);
    const loose = await prisma.flight.create({
      data: { userId: anna.id, flightNumber: "LH1170", depIata: "FRA", arrIata: "LIS" },
    });
    jest.spyOn(ADAPTERS.flight, "createCopy").mockRejectedValueOnce(new Error("copy failed"));
    const res = await request(app)
      .post(`/api/v1/trips/${full.trip.id}/flights`)
      .set("Cookie", anna.cookie)
      .send({ flightIds: [loose.id], action: "add" });
    expect(res.status).toBe(500);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: loose.id } })).tripId).toBeNull();
  });

  it("a stay edit rolls back when the copy cannot follow", async () => {
    const { full } = await sharedPair(anna, ben);
    jest.spyOn(ADAPTERS.lodgingStay, "apply").mockRejectedValueOnce(new Error("apply failed"));
    await expect(
      updateStayRecord(anna.id, full.stay, { board: "half_board" })
    ).rejects.toThrow("apply failed");
    expect((await prisma.lodgingStay.findUniqueOrThrow({ where: { id: full.stay.id } })).board).toBe(
      "breakfast"
    );
  });

  it("an accepted pending update stays pending when the copy cannot follow", async () => {
    const { full } = await sharedPair(anna, ben);
    const update = await prisma.pendingFlightUpdate.create({
      data: {
        flightId: full.flight.id,
        userId: anna.id,
        status: "pending",
        originalData: { gate: null },
        proposedData: { gate: "B12" },
        changes: [{ field: "gate", type: "added", oldValue: null, newValue: "B12" }],
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    jest.spyOn(ADAPTERS.flight, "apply").mockRejectedValueOnce(new Error("apply failed"));
    await expect(applyPendingUpdate(update.id, anna.id)).rejects.toThrow();
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } })).gate).toBeNull();
    expect((await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: update.id } })).status).toBe(
      "pending"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/sharing.sameTransaction.test.ts`
Expected: FAIL ×3 — the flight's `tripId` is the trip, the stay's `board` is `half_board`, the gate is `B12` (each write committed before its propagation threw).

- [ ] **Step 3: Write minimal implementation**

`stayWrites.ts` — `createStayRecord`:

```ts
  // One transaction: on a shared trip the copies are created with the stay or not at all.
  return prisma.$transaction(async (tx) => {
    const created = await tx.lodgingStay.create({ data: { ...columns, lodgingId, userId } });
    await propagateWrite(tx, userId, "lodgingStay", created.id);
    return created;
  });
```

`updateStayRecord` — replace `const before = await shareSnapshot(prisma, …); const updated = await prisma.lodgingStay.update({…}); await propagateWrite(prisma, …); return updated;` with:

```ts
  return prisma.$transaction(async (tx) => {
    const before = await shareSnapshot(tx, "lodgingStay", stay.id);
    const updated = await tx.lodgingStay.update({
      // … the existing `where` and `data` object, unchanged …
    });
    await propagateWrite(tx, userId, "lodgingStay", stay.id, before);
    return updated;
  });
```

(All `await`s that compute `data` — FX, `dayAnchorNowFor` — stay above the transaction, so it holds no network call.)

`routes/trips.ts` (`POST /trips/:id/flights`):

```ts
      await prisma.$transaction(async (tx) => {
        const before = await shareSnapshots(tx, "flight", flightIds);
        if (action === "add") {
          await tx.flight.updateMany({
            where: { id: { in: flightIds }, userId },
            data: { tripId: trip.id },
          });
        } else {
          await tx.flight.updateMany({
            where: { id: { in: flightIds }, userId, tripId: trip.id },
            data: { tripId: null },
          });
        }
        // Into a shared trip: copied to the others; out of one: they are told.
        await propagateWrites(tx, userId, "flight", flightIds, before);
      });
      await recomputeTripStatus(trip.id);
```

`pendingUpdateService.ts` (`applyPendingUpdate`) — replace the snapshot / `flight.update` / `propagateWrite` / `pendingFlightUpdate.update` sequence with:

```ts
    // An accepted suggestion is the member's own change: on a shared trip it
    // reaches the other copies (design 2026-10-09) — in one transaction, so
    // neither the flight nor the suggestion's status moves if the copies cannot.
    const updatedFlight = await prisma.$transaction(async (tx) => {
      const before = await shareSnapshot(tx, "flight", flight.id);
      const written = await tx.flight.update({ where: { id: flight.id }, data: updateData });
      await propagateWrite(tx, userId, "flight", flight.id, before);
      await tx.pendingFlightUpdate.update({
        where: { id },
        data: { status: "applied", appliedAt: new Date(), updatedAt: new Date() },
      });
      return written;
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/sharing.sameTransaction.test.ts src/routes/__tests__/lodging src/routes/__tests__/pendingUpdates src/routes/__tests__/trips` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/stayWrites.ts backend/src/routes/trips.ts backend/src/services/pendingUpdateService.ts backend/src/routes/__tests__/sharing.sameTransaction.test.ts
git commit -m "fix(sharing): a stay edit, a trip assignment and an accepted update roll back with their copies

These three paths stored the member's write and then propagated in a
transaction of its own; when the copies could not follow, the member saw
'saved' for a change nobody else got. Write and propagation now commit
together, as the other write paths already did."
```

### Task 9: One provider change, one inbox item

**Files:**
- Create: `backend/src/services/sharing/pendingSupersede.ts`
- Modify: `backend/src/services/sharing/propagate.ts` (`updateCopies` calls it for flights), `backend/prisma/schema.prisma` (comment on `PendingFlightUpdate.status`), `frontend/src/i18n/resources/{de,en}/pendingUpdates.json` (`status.superseded`)
- Test: `backend/src/routes/__tests__/sharing.supersede.test.ts`

**Interfaces:**
- Consumes: `recordEntryNotice` (returns id, Task 3).
- Produces: `supersedeSatisfied(c: DbTransaction, flightId: string, by: { noticeId: string; actorId: string }): Promise<number>`; status value `"superseded"`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/sharing.supersede.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
import { sharedPair, makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";

/**
 * One provider change reaches a member once (spec 2026-10-16, D7): when
 * another member's change brings the copy to what a pending update proposes,
 * that update is superseded — the share notice is the item. Only when it
 * proposes nothing the copy lacks.
 */
describe("trip sharing — a propagated change supersedes the member's own suggestion", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let annasFlightId: string;
  let bensFlightId: string;

  const pendingFor = (proposed: object, edited?: object) =>
    prisma.pendingFlightUpdate.create({
      data: {
        flightId: bensFlightId,
        userId: ben.id,
        status: edited ? "edited" : "pending",
        originalData: {},
        proposedData: proposed,
        ...(edited ? { editedData: edited } : {}),
        changes: [],
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  const annaChanges = async (data: { gate?: string; terminal?: string }) => {
    const before = await shareSnapshot(prisma, "flight", annasFlightId);
    await prisma.flight.update({ where: { id: annasFlightId }, data });
    await propagateWrite(prisma, anna.id, "flight", annasFlightId, before);
  };
  const statusOf = async (id: string) =>
    (await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id } })).status;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-sup");
    ben = await makeAccount("ben-sup");
    const { full } = await sharedPair(anna, ben);
    annasFlightId = full.flight.id;
    bensFlightId = (await prisma.flight.findFirstOrThrow({ where: { userId: ben.id } })).id;
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("supersedes an update whose every field the change brought", async () => {
    const update = await pendingFor({ gate: "B12" });
    await annaChanges({ gate: "B12" });
    expect(await statusOf(update.id)).toBe("superseded");
    const meta = (await prisma.pendingFlightUpdate.findUniqueOrThrow({ where: { id: update.id } }))
      .metadata as { supersededBy?: { actorId: string } };
    expect(meta.supersededBy?.actorId).toBe(anna.id);
  });

  it("keeps a partially satisfied update open", async () => {
    const update = await pendingFor({ gate: "B12", terminal: "2" });
    await annaChanges({ gate: "B12" });
    expect(await statusOf(update.id)).toBe("pending");
  });

  it("keeps an edited update whose edit differs", async () => {
    const update = await pendingFor({ gate: "B12" }, { gate: "C3" });
    await annaChanges({ gate: "B12" });
    expect(await statusOf(update.id)).toBe("edited");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/sharing.supersede.test.ts`
Expected: FAIL — first case receives `"pending"`; the other two pass (controls).

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/sharing/pendingSupersede.ts
import type { DbTransaction } from "../../db";
import type { Prisma } from "../../prisma";

/**
 * One provider change, one inbox item (spec 2026-10-16, D7). Two members of a
 * shared trip each get the provider's suggestion for their own copy; when one
 * accepts, propagation brings the other's copy to the same values and leaves a
 * share notice. The other's suggestion would now offer what is already there,
 * so it is `superseded` — the share notice (with its undo) is the item.
 *
 * Only a suggestion with NOTHING left to propose: every field it proposes (its
 * edit, when the member edited it) already holds on the copy. A partial match
 * stays open, because it still proposes something the copy does not have.
 */
const OPEN = ["pending", "edited"];

const asObject = (v: Prisma.JsonValue | null): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A proposed JSON value against the stored column: dates arrive as ISO strings. */
function holds(proposed: unknown, current: unknown): boolean {
  if (current instanceof Date) {
    return typeof proposed === "string" && new Date(proposed).getTime() === current.getTime();
  }
  return (proposed ?? null) === (current ?? null);
}

export async function supersedeSatisfied(
  c: DbTransaction,
  flightId: string,
  by: { noticeId: string; actorId: string }
): Promise<number> {
  const flight = await c.flight.findUnique({ where: { id: flightId } });
  if (!flight) return 0;
  const row = flight as unknown as Record<string, unknown>;
  const open = await c.pendingFlightUpdate.findMany({
    where: { flightId, status: { in: OPEN } },
  });
  let superseded = 0;
  for (const update of open) {
    const proposed = asObject(update.editedData ?? update.proposedData);
    const fields = Object.keys(proposed).filter((k) => k in row);
    if (fields.length === 0 || !fields.every((k) => holds(proposed[k], row[k]))) continue;
    await c.pendingFlightUpdate.update({
      where: { id: update.id },
      data: {
        status: "superseded",
        metadata: { ...asObject(update.metadata), supersededBy: by } as Prisma.InputJsonValue,
      },
    });
    superseded += 1;
  }
  return superseded;
}
```

`propagate.ts` — in `updateCopies`, take the notice id and supersede on flights:

```ts
    const noticeId = await recordEntryNotice(c, {
      recipient: member,
      groupId,
      actorId,
      kind: "updated",
      entity: adapter.entity,
      shareKey: row.shareKey as string,
      before: { facts: jsonSubset(copy.facts, keys), zones: copy.zones },
      after: { ...noticeMeta(row, member, copy.id), facts: jsonSubset((applied ?? row).facts, keys) },
    });
    // Flights are the one type with provider suggestions (PendingFlightUpdate).
    if (adapter.entity === "flight") await supersedeSatisfied(c, copy.id, { noticeId, actorId });
```

`schema.prisma` — `PendingFlightUpdate.status` comment: `// "pending" | "applied" | "rejected" | "expired" | "edited" | "superseded" (a shared trip's propagated change brought every proposed field — services/sharing/pendingSupersede.ts)`.

`pendingUpdates.json`: DE `status.superseded` "Durch geteilte Reise übernommen"; EN "Applied through shared trip".

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/sharing.supersede.test.ts src/routes/__tests__/sharing.propagateFlights.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing/pendingSupersede.ts backend/src/services/sharing/propagate.ts backend/prisma/schema.prisma backend/src/routes/__tests__/sharing.supersede.test.ts frontend/src/i18n/resources/de/pendingUpdates.json frontend/src/i18n/resources/en/pendingUpdates.json
git commit -m "fix(sharing): a propagated change supersedes the same suggestion on the copy

When one member accepted a provider's suggestion on a shared flight, the
other got a share notice for it and kept their own suggestion offering the
same values again. A suggestion whose every field the change already brought
is now superseded; one that still proposes something stays open."
```

### Task 10: People of a trip, with their sharing state

**Files:**
- Create: `backend/src/services/sharing/tripPeople.ts`
- Modify: `backend/src/services/sharing/shareTrip.ts` (`tripSharingView` adds `people`, `linkableUsers`), `backend/src/services/openapi/paths/sharing.ts:173-207`
- Test: `backend/src/services/sharing/__tests__/tripPeople.test.ts`

**Interfaces:**
- Consumes: `acceptedWith` (`members.ts`), `PERSON_SELECT`, `toPerson`, `SharePerson` (`people.ts`), `ConsentStatus` (`schemas/sharing.ts`).
- Produces:
  ```ts
  export type ShareBlock = "notLinked" | "consentMissing" | "consentPending" | "groupConsentMissing" | "alreadyMember";
  export interface TripPerson {
    key: string; companionId: string | null; name: string; account: SharePerson | null;
    consent: "none" | ConsentStatus; member: boolean; receivesChanges: boolean | null;
    shareBlockedBy: ShareBlock | null;
  }
  export function tripPeople(userId: string, trip: { id: string; shareGroupId: string | null }):
    Promise<{ people: TripPerson[]; linkableUsers: SharePerson[] }>;
  ```
  `TripSharingView` gains `people: TripPerson[]; linkableUsers: SharePerson[]` (`members`, `candidates` stay until Task 19).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/sharing/__tests__/tripPeople.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  linkWithConsent,
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { tripPeople } from "../tripPeople";

/**
 * One row per person on a trip (spec 2026-10-16, D9): every companion of the
 * trip and every member of its group, each with what the trip page needs to
 * say about them — and why sharing with them is not possible yet.
 */
describe("tripPeople", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let carl: TestAccount;

  const companionOnTrip = async (tripId: string, name: string, linkedUserId: string | null) => {
    const companion = await prisma.companion.create({
      data: {
        userId: anna.id,
        canonicalName: name.toLowerCase(),
        displayName: name,
        searchName: name.toLowerCase(),
        linkedUserId,
      },
    });
    const position = await prisma.tripCompanion.count({ where: { tripId } });
    await prisma.tripCompanion.create({ data: { tripId, companionId: companion.id, position } });
    return companion;
  };

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-people");
    ben = await makeAccount("ben-people");
    carl = await makeAccount("carl-people");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("says why an unlinked, a pending and a consenting companion can or cannot be shared with", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Rom" } });
    await companionOnTrip(trip.id, "Oma Ilse", null);
    await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: carl.id, status: "pending" },
    });
    await companionOnTrip(trip.id, "Carl", carl.id);
    const benLink = await linkWithConsent(anna, ben);
    await prisma.tripCompanion.create({
      data: { tripId: trip.id, companionId: benLink.id, position: 2 },
    });

    const { people, linkableUsers } = await tripPeople(anna.id, trip);
    const by = (name: string) => people.find((p) => p.name === name)!;
    expect(by("Oma Ilse")).toMatchObject({ account: null, shareBlockedBy: "notLinked" });
    expect(by("Carl")).toMatchObject({ consent: "pending", shareBlockedBy: "consentPending" });
    expect(by(ben.username)).toMatchObject({ consent: "accepted", member: false, shareBlockedBy: null });
    expect(linkableUsers.map((u) => u.id)).toEqual([ben.id]);
  });

  it("lists a member who is no companion of the trip, and marks a member without consent", async () => {
    const { full } = await sharedPair(anna, ben);
    // Carl joined the group onward through Ben, before the consent rule: no
    // consent between Anna and Carl in either direction.
    const group = (await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } })).shareGroupId!;
    await prisma.trip.create({ data: { userId: carl.id, name: "Lissabon 2025", shareGroupId: group } });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    const { people } = await tripPeople(anna.id, trip);
    const benRow = people.find((p) => p.account?.id === ben.id)!;
    const carlRow = people.find((p) => p.account?.id === carl.id)!;
    expect(benRow).toMatchObject({ member: true, receivesChanges: true, shareBlockedBy: "alreadyMember" });
    expect(carlRow).toMatchObject({
      key: `u:${carl.id}`,
      companionId: null,
      member: true,
      receivesChanges: false,
    });
  });

  it("blocks a newcomer whom a current member has not agreed to", async () => {
    const { full } = await sharedPair(anna, ben);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    const carlLink = await linkWithConsent(anna, carl);
    await prisma.tripCompanion.create({
      data: { tripId: trip.id, companionId: carlLink.id, position: 5 },
    });
    const { people } = await tripPeople(anna.id, trip);
    expect(people.find((p) => p.account?.id === carl.id)).toMatchObject({
      consent: "accepted",
      shareBlockedBy: "groupConsentMissing",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/services/sharing/__tests__/tripPeople.test.ts`
Expected: FAIL — `Cannot find module '../tripPeople'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/sharing/tripPeople.ts
import { prisma } from "../../db";
import type { ConsentStatus } from "../../schemas/sharing";
import { acceptedWith } from "./members";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * The people of one trip as its page shows them (spec 2026-10-16, D9): each
 * companion on the trip, then each member of the trip's share group who is not
 * one of them — with whether they are linked to an account, what the caller's
 * consent request to that account says, whether they hold the trip, whether
 * changes reach them, and the ONE reason sharing with them is not possible yet.
 *
 * The reason is decided here, before a click, so the page never draws an
 * action the server would refuse (`shareTrip` checks the same rules).
 */
export type ShareBlock =
  | "notLinked"
  | "consentMissing"
  | "consentPending"
  | "groupConsentMissing"
  | "alreadyMember";

export interface TripPerson {
  /** "c:<companionId>" for a companion, "u:<userId>" for a member who is none. */
  key: string;
  companionId: string | null;
  name: string;
  account: SharePerson | null;
  /** The caller's request to `account`; "none" when there is no row. */
  consent: "none" | ConsentStatus;
  member: boolean;
  /** Members only: an accepted consent in either direction lets changes through. */
  receivesChanges: boolean | null;
  shareBlockedBy: ShareBlock | null;
}

export async function tripPeople(
  userId: string,
  trip: { id: string; shareGroupId: string | null }
): Promise<{ people: TripPerson[]; linkableUsers: SharePerson[] }> {
  const [links, memberTrips, outgoing] = await Promise.all([
    prisma.tripCompanion.findMany({
      where: { tripId: trip.id },
      orderBy: { position: "asc" },
      include: { companion: { include: { linkedUser: { select: PERSON_SELECT } } } },
    }),
    trip.shareGroupId
      ? prisma.trip.findMany({
          where: { shareGroupId: trip.shareGroupId, NOT: { userId } },
          select: { user: { select: PERSON_SELECT } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.shareConsent.findMany({
      where: { requesterId: userId },
      include: { target: { select: PERSON_SELECT } },
      orderBy: { decidedAt: "desc" },
    }),
  ]);
  const members = memberTrips.map((t) => toPerson(t.user));
  const memberIds = members.map((m) => m.id);
  const consentOf = new Map(outgoing.map((c) => [c.targetId, c.status as ConsentStatus]));
  const receiving = await acceptedWith(prisma, userId, memberIds);

  const groupAgrees = async (accountId: string): Promise<boolean> => {
    if (memberIds.length === 0) return true;
    const ok = await acceptedWith(prisma, accountId, memberIds);
    return memberIds.every((id) => id === accountId || ok.has(id));
  };

  const rowFor = async (
    key: string,
    companionId: string | null,
    name: string,
    account: SharePerson | null
  ): Promise<TripPerson> => {
    const member = account !== null && memberIds.includes(account.id);
    const consent = account ? (consentOf.get(account.id) ?? "none") : "none";
    let shareBlockedBy: ShareBlock | null = null;
    if (!account) shareBlockedBy = "notLinked";
    else if (member) shareBlockedBy = "alreadyMember";
    else if (consent === "pending") shareBlockedBy = "consentPending";
    else if (consent !== "accepted") shareBlockedBy = "consentMissing";
    else if (!(await groupAgrees(account.id))) shareBlockedBy = "groupConsentMissing";
    return {
      key,
      companionId,
      name,
      account,
      consent,
      member,
      receivesChanges: member && account ? receiving.has(account.id) : null,
      shareBlockedBy,
    };
  };

  const people: TripPerson[] = [];
  for (const link of links) {
    const c = link.companion;
    people.push(
      await rowFor(`c:${c.id}`, c.id, c.displayName, c.linkedUser ? toPerson(c.linkedUser) : null)
    );
  }
  const shown = new Set(people.flatMap((p) => (p.account ? [p.account.id] : [])));
  for (const member of members) {
    if (!shown.has(member.id)) {
      people.push(await rowFor(`u:${member.id}`, null, member.displayName, member));
    }
  }
  return {
    people,
    linkableUsers: outgoing.filter((c) => c.status === "accepted").map((c) => toPerson(c.target)),
  };
}
```

`shareTrip.ts` — `TripSharingView` gains `people: TripPerson[]; linkableUsers: SharePerson[];`; `tripSharingView` adds `...(await tripPeople(userId, trip))` to its returned object.

`openapi/paths/sharing.ts` — the 200 schema of `GET /sharing/trips/{tripId}` gains:

```ts
        people: z
          .array(
            z.object({
              key: z.string(),
              companionId: z.string().nullable(),
              name: z.string(),
              account: person.nullable(),
              consent: z.enum(["none", ...CONSENT_STATUSES]),
              member: z.boolean(),
              receivesChanges: z
                .boolean()
                .nullable()
                .describe("Members only: whether changes travel between the caller and them"),
              shareBlockedBy: z
                .enum(["notLinked", "consentMissing", "consentPending", "groupConsentMissing", "alreadyMember"])
                .nullable(),
            })
          )
          .describe("Every companion of the trip, then every group member who is none of them"),
        linkableUsers: z.array(person).describe("Accounts that accepted the caller's consent request"),
```

(`import { CONSENT_STATUSES } from "../../../schemas/sharing";`.) The response description becomes "The trip's people with their sharing state; members/candidates are deprecated".

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/services/sharing/__tests__/tripPeople.test.ts src/routes/__tests__/sharing.share.test.ts src/__tests__/openapi.responseSchema.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing/tripPeople.ts backend/src/services/sharing/shareTrip.ts backend/src/services/sharing/__tests__/tripPeople.test.ts backend/src/services/openapi/paths/sharing.ts
git commit -m "feat(sharing): the trip's people with their sharing state

The trip page drew a share tick per linked companion and found out at click
time that a member had not agreed, and a member brought in before the consent
rule looked connected while no change reached them. One row per person now
says whether they are linked, what the consent says, whether changes reach
them, and the one reason sharing is not possible yet."
```

### Task 11: Ferry crossings in the `.travstats` file

**Files:**
- Modify: `backend/src/services/trip/exchange/format.ts:25-40,365-395,524-600` (schema, kinds, version 3), `backend/src/services/trip/exchange/collect.ts:95,164,404-440,565-620`, `backend/src/services/trip/exchange/commitRows.ts:100-150,477-520` (`ferryRow`, FX), `backend/src/services/trip/exchange/commit.ts:140-175,255-262,405-480,545-555`, `backend/src/services/trip/exchange/proposal.ts:20-30,220-245`, `backend/src/services/trip/exchange/types.ts:9-10`, `backend/src/services/trip/package/matchingEntries.ts:100-135` (`existingFerry`), `backend/src/services/trip/exchange/writeArchive.ts:40-50`, `backend/src/services/sharing/shareTypes.ts` (`ferry.exchangeKind = "ferry"`), `backend/src/services/sharing/__tests__/shareTypes.test.ts`, `backend/src/services/openapi/paths/tripExchange.ts:90` (version text)
- Test: `backend/src/routes/__tests__/tripExchange.ferry.test.ts`

**Interfaces:**
- Consumes: `busEnd` (format.ts), `optStr`, `str`, `money`, `currency`, `names`, `key`, `instant`, `dayAt`, `windowAround`, `same` (`matchingEntries.ts`).
- Produces: `TRIP_FILE_VERSION = 3`, `TRIP_FILE_SUPPORTED_VERSIONS = [1, 2, 3]`, `tripFileVersionFor(file: { bus?: readonly unknown[]; ferry?: readonly unknown[] }): 1 | 2 | 3`, `ferrySchema`, `type TripFileFerry`, `ENTITY_KINDS` + `"ferry"`, `ferryRow(userId, r, ctx, link): Prisma.FerryJourneyUncheckedCreateInput`, `existingFerry(userId, q: FerryQuery): Promise<ExistingEntry | null>`, `TripFileEntryKind` + `"ferry"`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/tripExchange.ferry.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive, unpackEntries } from "../../services/trip/exchange/readArchive";
import { makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";

/**
 * A crossing travels in a `.travstats` file (spec 2026-10-16, §8): facts in
 * the open, the passenger's own fields only in a private file, the vehicle and
 * the roadtrip leg never. A file with crossings is version 3, so an older
 * importer refuses it by name instead of importing the trip minus its ferry.
 */
describe("trip export / import — ferry crossings", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  const binary = (
    res: NodeJS.ReadableStream,
    done: (err: Error | null, body: Buffer) => void
  ): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };
  const exportAs = (who: TestAccount, query = "") =>
    request(app)
      .get(`/api/v1/trips/${tripId}/export${query}`)
      .set("Cookie", who.cookie)
      .buffer(true)
      .parse(binary);

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xferry");
    ben = await makeAccount("ben-xferry");
    tripId = (
      await prisma.trip.create({
        data: { userId: anna.id, name: "Ostsee", startDate: new Date("2026-06-01T00:00:00Z") },
      })
    ).id;
    await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        operator: "Color Line",
        vesselName: "Color Fantasy",
        depStationName: "Kiel Norwegenkai",
        depLat: 54.3234,
        depLon: 10.1356,
        depTimezone: "Europe/Berlin",
        arrStationName: "Oslo",
        arrLat: 59.9021,
        arrLon: 10.7392,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2026-06-01T12:00:00Z"),
        arrivalTime: new Date("2026-06-02T08:00:00Z"),
        status: "scheduled",
        cabinType: "inside",
        seat: "PRIVATE",
        vehicleRegistration: "KI-XY 1",
        price: 520,
      },
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("writes crossings as version 3, without private or vehicle fields by default", async () => {
    const res = await exportAs(anna);
    expect(res.status).toBe(200);
    const entries = unpackEntries(res.body as Buffer);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    const file = JSON.parse(entries.get("trip.json")!.toString());
    expect(manifest.formatVersion).toBe(3);
    expect(file.ferry).toHaveLength(1);
    expect(file.ferry[0]).toMatchObject({ operator: "Color Line", vesselName: "Color Fantasy" });
    expect(file.ferry[0].private).toBeUndefined();
    expect(JSON.stringify(file)).not.toContain("KI-XY 1");
  });

  it("imports a crossing into another account", async () => {
    const res = await exportAs(anna, "?private=1");
    await commitTripFile(ben.id, readTripArchive(res.body as Buffer));
    const crossing = await prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben.id } });
    expect(crossing).toMatchObject({
      vesselName: "Color Fantasy",
      cabinType: "inside",
      seat: "PRIVATE",
      vehicleRegistration: null,
      roadtripLegId: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/tripExchange.ferry.test.ts`
Expected: FAIL — `formatVersion` is `1` and `file.ferry` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

`format.ts`:

```ts
/**
 * What this build WRITES. Version 1 had no bus rides, version 2 no ferry
 * crossings; a file is stamped with the lowest version that can carry it
 * (`tripFileVersionFor`), so an importer that predates a key refuses the file
 * by name ("format version 3 is not supported", 422) instead of importing the
 * trip without those journeys — and a trip without them stays readable by
 * every older importer.
 */
export const TRIP_FILE_VERSION = 3;
/** What this build READS: 1 (no `bus`, no `ferry`), 2 (no `ferry`) and 3. */
export const TRIP_FILE_SUPPORTED_VERSIONS = [1, 2, 3] as const;

export function tripFileVersionFor(file: {
  bus?: readonly unknown[];
  ferry?: readonly unknown[];
}): 1 | 2 | 3 {
  if ((file.ferry?.length ?? 0) > 0) return 3;
  return (file.bus?.length ?? 0) > 0 ? 2 : 1;
}
```

`manifestSchema`: `formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)])`. After `busSchema`:

```ts
/** Cabin, seat, own price and both references travel only in a private file; the vehicle never. */
const ferryPrivate = z
  .object({
    fareClass: optStr(200),
    seat: optStr(200),
    cabinType: optStr(200),
    bookingReference: optStr(200),
    ticketReference: optStr(200),
    price: money,
    currency,
    notes: optStr(10_000),
    companions: names,
  })
  .strict();

const ferrySchema = z
  .object({
    key,
    bookingKey: key.nullable(),
    externalRef: optStr(200),
    operator: optStr(200),
    vesselName: optStr(200),
    dep: busEnd,
    arr: busEnd,
    departureTime: z.iso.datetime({ offset: true }),
    arrivalTime: instant,
    depPrecision: optStr(200),
    arrPrecision: optStr(200),
    distanceKm: z.number().min(0).max(50_000).nullable(),
    distanceSource: optStr(200),
    status: str(200),
    private: ferryPrivate.optional(),
  })
  .strict();
```

`ENTITY_KINDS` gains `"ferry"` after `"bus"`; `tripFileSchema` gains `/** Absent before version 3. */ ferry: z.array(ferrySchema).max(300).default([]),` after `bus`; `byKind` gains `ferry: keysOf(file.ferry),`; the booking-key loop gains `[file.ferry, "ferry"],`; export `export type TripFileFerry = TripFile["ferry"][number];`.

`writeArchive.ts` — `buildManifest(options, now, file: Pick<TripFile, "bus" | "ferry">)`.

`collect.ts` — `loadTrip` include gains `ferryJourneys: { orderBy: { departureTime: "asc" }, include: { companionLinks: byPosition } },`; `const ferryKey = keyer("fe");`; after the `bus` list:

```ts
    ferry: trip.ferryJourneys.map((r) => ({
      key: ferryKey(r.id),
      bookingKey: bk(r.bookingId),
      externalRef: r.externalRef,
      operator: r.operator,
      vesselName: r.vesselName,
      dep: {
        name: r.depStationName,
        address: r.depAddress,
        lat: r.depLat,
        lon: r.depLon,
        country: r.depCountry,
        timezone: r.depTimezone,
      },
      arr: {
        name: r.arrStationName,
        address: r.arrAddress,
        lat: r.arrLat,
        lon: r.arrLon,
        country: r.arrCountry,
        timezone: r.arrTimezone,
      },
      departureTime: r.departureTime.toISOString(),
      arrivalTime: iso(r.arrivalTime),
      depPrecision: r.depPrecision,
      arrPrecision: r.arrPrecision,
      distanceKm: r.distanceKm,
      distanceSource: r.distanceSource,
      status: r.status,
      ...(priv
        ? {
            private: {
              fareClass: r.fareClass,
              seat: r.seat,
              cabinType: r.cabinType,
              bookingReference: r.bookingReference,
              ticketReference: r.ticketReference,
              price: r.price,
              currency: r.currency,
              notes: r.notes,
              companions: companionNames(r.companionLinks, r.companions),
            },
          }
        : {}),
    })),
```

`collectDocuments` keys gain `ferry: ferryKey`; its `OR` gains `{ ferryJourneyId: { in: ids(trip.ferryJourneys) } },`; the entity ladder gains, after the bus arm, `: d.ferryJourneyId ? { kind: "ferry", key: keys.ferry(d.ferryJourneyId) }`.

`commitRows.ts` — the companion-name collector gains `...file.ferry.flatMap((r) => r.private?.companions ?? []),`; after the bus FX loop:

```ts
  for (const r of file.ferry) {
    fx.set(
      r.key,
      await fxFor(r.private?.price, r.private?.currency, dayAt(r.departureTime, r.dep.timezone), base)
    );
  }
```

and after `busRow`:

```ts
export function ferryRow(
  userId: string,
  r: TripFileFerry,
  ctx: ResolvedContext,
  link: Linked
): Prisma.FerryJourneyUncheckedCreateInput {
  const p = r.private;
  return {
    userId,
    ...link,
    externalRef: r.externalRef,
    operator: r.operator,
    vesselName: r.vesselName,
    depStationName: r.dep.name,
    depAddress: r.dep.address,
    depLat: r.dep.lat,
    depLon: r.dep.lon,
    depCountry: r.dep.country,
    depTimezone: r.dep.timezone,
    arrStationName: r.arr.name,
    arrAddress: r.arr.address,
    arrLat: r.arr.lat,
    arrLon: r.arr.lon,
    arrCountry: r.arr.country,
    arrTimezone: r.arr.timezone,
    departureTime: new Date(r.departureTime),
    arrivalTime: date(r.arrivalTime),
    depPrecision: r.depPrecision,
    arrPrecision: r.arrPrecision,
    distanceKm: r.distanceKm,
    distanceSource: r.distanceSource,
    status: r.status,
    ...(p
      ? {
          fareClass: p.fareClass,
          seat: p.seat,
          cabinType: p.cabinType,
          bookingReference: p.bookingReference,
          ticketReference: p.ticketReference,
          price: p.price,
          currency: p.currency,
          ...fxOf(ctx, r.key),
          notes: p.notes,
          companions: p.companions,
          companionLinks: companionLinks(ctx, p.companions),
        }
      : { currency: null }),
  };
}
```

`commit.ts` — `attach`'s `model` union and `MODEL` gain `ferry: "ferryJourney"`; the `IdMaps` initialiser gains `ferry: new Map(),`; `bookingOfEntry`'s ladder gains `: entry.kind === "ferry" ? file.ferry`; `createEntry` gains

```ts
    case "ferry":
      // share-exempt: returns the id to writeEntries, which propagates ids[kind] after every kind is written
      return (
        await tx.ferryJourney.create({
          data: ferryRow(userId, byKey(file.ferry), ctx, link),
          select,
        })
      ).id;
```

`ENTRY_TYPE` gains `ferry: "ferryJourney"`, the second `MODEL`-like map at ~549 gains `ferry: "ferryJourney"`. `SHARED_KINDS` (Task 7) picks ferry up once `SHARE_TYPES.ferry.exchangeKind = "ferry"`.

`types.ts` — `TripFileEntryKind` gains `"ferry"`.

`matchingEntries.ts` — after `existingBus`:

```ts
// ------------------------------------------------------------------ ferry

export interface FerryQuery {
  externalRef: string | null;
  operator: string | null;
  depName: string;
  arrName: string;
  /** Local day of departure. */
  day: string;
}

/** Bus's rule on the ferry table: the provenance key, else the same two terminals on the same local day. */
export async function existingFerry(userId: string, q: FerryQuery): Promise<ExistingEntry | null> {
  const select = { id: true, tripId: true, bookingId: true } as const;
  if (q.externalRef) {
    const byRef = await prisma.ferryJourney.findFirst({
      where: { userId, externalRef: q.externalRef },
      select,
    });
    if (byRef) return byRef;
  }
  const rows = await prisma.ferryJourney.findMany({
    where: { userId, departureTime: windowAround(q.day) },
    select: {
      ...select,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
    },
    take: 50,
  });
  const hit = rows.find(
    (r) =>
      dayAt(r.departureTime, r.depTimezone) === q.day &&
      same(r.depStationName, q.depName) &&
      same(r.arrStationName, q.arrName)
  );
  return hit ? { id: hit.id, tripId: hit.tripId, bookingId: hit.bookingId } : null;
}
```

`proposal.ts` — import `existingFerry`; the day-span collector gains `...file.ferry.map((r) => dayAt(r.departureTime, r.dep.timezone)),`; after the bus loop:

```ts
  for (const r of file.ferry) {
    const day = dayAt(r.departureTime, r.dep.timezone)!;
    const existing = await existingFerry(userId, {
      externalRef: r.externalRef,
      operator: r.operator,
      depName: r.dep.name,
      arrName: r.arr.name,
      day,
    });
    entries.push({
      key: r.key,
      kind: "ferry",
      ...decide(existing, tripId, r.bookingKey !== null),
      label: `${r.operator ?? ""} ${r.dep.name}–${r.arr.name}`.trim(),
      day,
    });
  }
```

`shareTypes.ts`: `ferry.exchangeKind: "ferry"`. `shareTypes.test.ts` gains:

```ts
  it("carries every shareable type in the .travstats file", () => {
    expect(SHARE_ENTITIES.filter((e) => SHARE_TYPES[e].exchangeKind === null)).toEqual([]);
  });
```

`openapi/paths/tripExchange.ts:90` — the `TRIP_FILE_VERSION_UNSUPPORTED` description adds "versions 1–3 are read". Frontend `TripFileImportModal` shows `proposal.entries` by kind: add `"ferry"` to its kind label map in `frontend/src/i18n/resources/{de,en}/trips.json` (`import.kinds.ferry`: "Fährfahrt" / "Ferry crossing") if the map exists there (`grep -n "kinds" frontend/src/i18n/resources/de/trips.json`); otherwise nothing renders a kind label and no key is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/tripExchange.ferry.test.ts src/routes/__tests__/trips.exchange.test.ts src/services/sharing/__tests__/shareTypes.test.ts` → PASS (the existing exchange suite still sees version 1/2 for files without crossings).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/trip backend/src/services/sharing/shareTypes.ts backend/src/services/sharing/__tests__/shareTypes.test.ts backend/src/services/openapi/paths/tripExchange.ts backend/src/routes/__tests__/tripExchange.ferry.test.ts frontend/src/i18n/resources
git commit -m "feat(exchange): ferry crossings travel in a .travstats file

A trip exported with its crossings arrived without them. Crossings now travel
on bus's rule — facts in the open, cabin, seat, references and price only in a
private file, the vehicle and the roadtrip leg never — and a file that carries
any is version 3, refused by name by an older importer."
```

### Task 12: Rollout tools — consent report and ferry backfill

**Files:**
- Create: `backend/src/scripts/reportShareGroupConsent.ts`, `backend/src/scripts/backfillSharedFerries.ts`, `backend/src/services/sharing/backfillFerries.ts`
- Modify: `backend/package.json` (scripts `sharing:report-consent`, `sharing:backfill-ferries`)
- Test: `backend/src/services/sharing/__tests__/backfillSharedFerries.test.ts`

**Interfaces:**
- Consumes: `assignKeysFor`, `copyMissing`, `acceptedWith`, `recordEntryNotice`, `noticeMeta`, `restatusTrips`.
- Produces:
  - `unconsentedPairs(): Promise<{ groupId: string; pairs: [string, string][] }[]>` (in `backfillFerries.ts`)
  - `backfillSharedFerries(opts: { apply: boolean }): Promise<{ groups: number; keyed: number; joined: number; copied: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/sharing/__tests__/backfillSharedFerries.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { backfillSharedFerries, unconsentedPairs } from "../backfillFerries";
import { shareTrip } from "../shareTrip";

/**
 * Production holds groups shared before crossings were shareable, and groups
 * joined onward before the consent rule (spec 2026-10-16, §10). The backfill
 * copies the missing crossings through the share path's own `copyInto`; the
 * report names the half-connected pairs. A dry run writes nothing.
 */
describe("sharing rollout — ferry backfill and consent report", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-backfill");
    ben = await makeAccount("ben-backfill");
    tripId = (await prisma.trip.create({ data: { userId: anna.id, name: "Fjorde" } })).id;
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    // A crossing filed on the shared trip as if before ferry was shareable:
    // written straight to the table, so nothing propagated it.
    await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        operator: "Fjord Line",
        depStationName: "Hirtshals",
        depLat: 57.5927,
        depLon: 9.9628,
        depTimezone: "Europe/Copenhagen",
        arrStationName: "Bergen",
        arrLat: 60.3958,
        arrLon: 5.3141,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2026-07-01T18:00:00Z"),
        status: "scheduled",
      },
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("counts on a dry run and writes nothing", async () => {
    const result = await backfillSharedFerries({ apply: false });
    expect(result).toMatchObject({ keyed: 1, copied: 1, joined: 0 });
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(0);
    expect(await prisma.ferryJourney.count({ where: { shareKey: { not: null } } })).toBe(0);
  });

  it("copies the crossing with a created notice when applied, once", async () => {
    await backfillSharedFerries({ apply: true });
    await backfillSharedFerries({ apply: true });
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(1);
    expect(
      await prisma.shareNotice.count({ where: { userId: ben.id, kind: "created", entityType: "ferry" } })
    ).toBe(1);
  });

  it("reports a member pair without consent", async () => {
    const carl = await makeAccount("carl-backfill");
    const group = (await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).shareGroupId!;
    await prisma.trip.create({ data: { userId: carl.id, name: "Fjorde", shareGroupId: group } });
    const report = await unconsentedPairs();
    const entry = report.find((r) => r.groupId === group)!;
    expect(entry.pairs.map((p) => [...p].sort())).toEqual(
      expect.arrayContaining([[anna.id, carl.id].sort(), [ben.id, carl.id].sort()])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/services/sharing/__tests__/backfillSharedFerries.test.ts`
Expected: FAIL — `Cannot find module '../backfillFerries'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/sharing/backfillFerries.ts
import { prisma } from "../../db";
import { restatusTrips } from "../trip/restatusTrips";
import { copyMissing } from "./copyInto";
import { assignKeysFor } from "./keyOps";
import { acceptedWith } from "./members";
import { noticeMeta, recordEntryNotice } from "./propagate";

/**
 * The two rollout tools of the rework (spec 2026-10-16, §10).
 *
 * `backfillSharedFerries` gives every existing group the crossings it would
 * hold had ferry been shareable from the start: per group, per member trip,
 * per consenting other member, exactly what sharing again would do — key the
 * crossings, join the other's own logged crossing or copy it, tell them. A dry
 * run runs the same code in a transaction it then rolls back, so the counts it
 * prints are the counts an apply would produce.
 *
 * `unconsentedPairs` names member pairs of a group with no accepted consent
 * in either direction — they do not receive each other's changes
 * (`receivingMembers`). It changes nothing: consent is given, never inferred.
 */
class DryRun extends Error {}

export interface BackfillResult {
  groups: number;
  keyed: number;
  joined: number;
  copied: number;
}

export async function backfillSharedFerries(opts: { apply: boolean }): Promise<BackfillResult> {
  const groups = await prisma.tripShareGroup.findMany({ select: { id: true } });
  const total: BackfillResult = { groups: groups.length, keyed: 0, joined: 0, copied: 0 };
  for (const group of groups) {
    const counted: BackfillResult = { groups: 0, keyed: 0, joined: 0, copied: 0 };
    try {
      await prisma.$transaction(
        async (tx) => {
          const trips = await tx.trip.findMany({
            where: { shareGroupId: group.id },
            select: { id: true, userId: true },
            orderBy: { createdAt: "asc" },
          });
          for (const source of trips) {
            counted.keyed += await assignKeysFor(tx, "ferry", source.userId, source.id);
            const others = trips.filter((t) => t.userId !== source.userId);
            const consenting = await acceptedWith(tx, source.userId, others.map((t) => t.userId));
            for (const member of others.filter((t) => consenting.has(t.userId))) {
              const copied = await copyMissing(
                tx,
                "ferry",
                { userId: source.userId, tripId: source.id },
                { userId: member.userId, tripId: member.id }
              );
              for (const entry of copied) {
                counted[entry.joined ? "joined" : "copied"] += 1;
                await recordEntryNotice(tx, {
                  recipient: member,
                  groupId: group.id,
                  actorId: source.userId,
                  kind: "created",
                  entity: "ferry",
                  shareKey: entry.source.shareKey as string,
                  after: {
                    ...noticeMeta(entry.source, member, entry.id),
                    ...(entry.joined ? { joined: true } : {}),
                  },
                });
              }
              if (copied.length > 0) await restatusTrips([member.id], tx);
            }
          }
          if (!opts.apply) throw new DryRun();
        },
        { timeout: 60_000 }
      );
    } catch (err) {
      if (!(err instanceof DryRun)) throw err;
    }
    total.keyed += counted.keyed;
    total.joined += counted.joined;
    total.copied += counted.copied;
  }
  return total;
}

export async function unconsentedPairs(): Promise<{ groupId: string; pairs: [string, string][] }[]> {
  const trips = await prisma.trip.findMany({
    where: { shareGroupId: { not: null } },
    select: { userId: true, shareGroupId: true },
  });
  const byGroup = new Map<string, string[]>();
  for (const t of trips) {
    const list = byGroup.get(t.shareGroupId as string) ?? [];
    if (!list.includes(t.userId)) list.push(t.userId);
    byGroup.set(t.shareGroupId as string, list);
  }
  const out: { groupId: string; pairs: [string, string][] }[] = [];
  for (const [groupId, users] of byGroup) {
    const pairs: [string, string][] = [];
    for (const [i, a] of users.entries()) {
      const ok = await acceptedWith(prisma, a, users.slice(i + 1));
      for (const b of users.slice(i + 1)) if (!ok.has(b)) pairs.push([a, b]);
    }
    if (pairs.length > 0) out.push({ groupId, pairs });
  }
  return out;
}
```

```ts
// backend/src/scripts/backfillSharedFerries.ts
import { prisma } from "../db";
import { backfillSharedFerries } from "../services/sharing/backfillFerries";
import logger from "../utils/logger";

/**
 * Rollout of the sharing rework (spec 2026-10-16, §10, step 3). Dry run by
 * default; `--apply` writes. Run on the RC server's copy of production first;
 * apply on production only on the owner's word.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const result = await backfillSharedFerries({ apply });
  logger.info({ operation: "sharing_backfill_ferries", apply, ...result });
  process.stdout.write(`${apply ? "APPLIED" : "DRY RUN"} ${JSON.stringify(result)}\n`);
}

main()
  .catch((err: unknown) => {
    logger.error({ operation: "sharing_backfill_ferries_failed", err });
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
```

```ts
// backend/src/scripts/reportShareGroupConsent.ts
import { prisma } from "../db";
import { unconsentedPairs } from "../services/sharing/backfillFerries";
import logger from "../utils/logger";

/** Read-only: share groups whose members include a pair with no accepted consent (spec 2026-10-16, §10, step 2). */
async function main(): Promise<void> {
  const report = await unconsentedPairs();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(report.flatMap((r) => r.pairs.flat()))] } },
    select: { id: true, username: true },
  });
  const name = new Map(users.map((u) => [u.id, u.username]));
  for (const entry of report) {
    const pairs = entry.pairs.map(([a, b]) => `${name.get(a)} ↔ ${name.get(b)}`).join(", ");
    process.stdout.write(`group ${entry.groupId}: ${pairs}\n`);
  }
  process.stdout.write(`${report.length} group(s) with unconsented pairs\n`);
}

main()
  .catch((err: unknown) => {
    logger.error({ operation: "sharing_report_consent_failed", err });
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
```

`backend/package.json` scripts:

```json
    "sharing:report-consent": "tsx src/scripts/reportShareGroupConsent.ts",
    "sharing:backfill-ferries": "tsx src/scripts/backfillSharedFerries.ts",
```

(`services/sharing/backfillFerries.ts` writes through `copyInto`/`keyOps`/`recordEntryNotice` only — no direct table write — so the per-call guard of Task 7 has nothing to flag.)

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/services/sharing/__tests__/backfillSharedFerries.test.ts src/services/sharing/__tests__/propagate.writePaths.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing/backfillFerries.ts backend/src/scripts/backfillSharedFerries.ts backend/src/scripts/reportShareGroupConsent.ts backend/src/services/sharing/__tests__/backfillSharedFerries.test.ts backend/package.json
git commit -m "feat(sharing): rollout tools for crossings and half-connected groups

Groups shared before crossings were shareable hold none of them, and groups
joined onward before the consent rule hold pairs that no longer receive each
other's changes. A dry-run-first backfill copies the crossings through the
share path itself; a read-only report names the unconsented pairs."
```

### Task 13: Frontend contract and a diff view that shows formatted values as given

**Files:**
- Modify: `frontend/src/types/sharing.ts` (`TripPerson`, `ShareBlock`, `TripSharing.people/linkableUsers`), `frontend/src/components/ChangeDiffView.tsx:11-60`
- Test: `frontend/src/components/__tests__/ChangeDiffView.test.tsx`

**Interfaces:**
- Consumes: backend `GET /sharing/trips/:tripId` shape (Task 10).
- Produces:
  ```ts
  export type ShareBlock = "notLinked" | "consentMissing" | "consentPending" | "groupConsentMissing" | "alreadyMember";
  export interface TripPerson { key: string; companionId: string | null; name: string; account: SharePerson | null;
    consent: "none" | ConsentStatus; member: boolean; receivesChanges: boolean | null; shareBlockedBy: ShareBlock | null }
  // TripSharing gains: people: TripPerson[]; linkableUsers: SharePerson[];
  // ChangeDiffView props gain: formatValue?: (value: unknown) => string; fieldLabel?: (field: string) => string;
  export interface ChangeEntry { field: string; type: "added" | "removed" | "changed"; oldValue: …; newValue: … } // now exported
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/__tests__/ChangeDiffView.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChangeDiffView from "../ChangeDiffView";

/**
 * The diff view serves two inboxes. A pending update carries raw provider
 * values it formats itself; a share notice carries values the time helpers
 * already formatted on the PLACE's clock (ADR 0002). Re-parsing those — an
 * English "Tue, 2 Jun 2026, 09:15" contains a "T" — would move them into the
 * browser's zone. With `formatValue`, a value is shown as given.
 */
describe("ChangeDiffView", () => {
  const change = {
    field: "departureTime",
    type: "changed" as const,
    oldValue: "Mon, 1 Jun 2026, 22:40",
    newValue: "Tue, 2 Jun 2026, 09:15",
  };

  it("shows a preformatted value as given, under the caller's label", async () => {
    render(
      <ChangeDiffView
        original={{}}
        proposed={{}}
        changes={[change]}
        formatValue={(v) => String(v)}
        fieldLabel={(f) => `label:${f}`}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /label:departureTime/ }));
    expect(screen.getByText("Tue, 2 Jun 2026, 09:15")).toBeTruthy();
    expect(screen.getByText("Mon, 1 Jun 2026, 22:40")).toBeTruthy();
  });

  it("keeps formatting raw values itself without the props (pending updates)", async () => {
    render(<ChangeDiffView original={{}} proposed={{}} changes={[{ ...change, newValue: null }]} />);
    await userEvent.click(screen.getByRole("button", { name: /departureTime/ }));
    expect(screen.getByText("-")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/__tests__/ChangeDiffView.test.tsx`
Expected: FAIL — no button named `label:departureTime` (the field name is printed raw); the second case passes.

- [ ] **Step 3: Write minimal implementation**

`ChangeDiffView.tsx`:

```tsx
export interface ChangeEntry {
  field: string;
  type: "added" | "removed" | "changed";
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
}

interface ChangeDiffViewProps {
  original: Record<string, unknown>;
  proposed: Record<string, unknown>;
  changes: ChangeEntry[];
  /**
   * Values the caller already formatted — a share notice's, read on the
   * place's clock (ADR 0002). Shown as given: the built-in formatter re-parses
   * any string with a "T" as a date in the browser's zone.
   */
  formatValue?: (value: unknown) => string;
  /** The field's label; the raw field name when absent. */
  fieldLabel?: (field: string) => string;
}

export default function ChangeDiffView({
  changes,
  formatValue: formatGiven,
  fieldLabel,
}: ChangeDiffViewProps): JSX.Element {
```

Inside, rename the local `formatValue` to `formatRaw`, then `const show = formatGiven ?? formatRaw; const label = fieldLabel ?? ((field: string) => field);`, render `{label(change.field)}` in place of `{change.field}` and `{show(change.oldValue)}` / `{show(change.newValue)}` in place of the two `formatValue(...)` calls.

`types/sharing.ts` — add `ShareBlock` and `TripPerson` (as in Interfaces), extend `TripSharing` with `people: TripPerson[]; linkableUsers: SharePerson[];` (`members`/`candidates` stay until Task 19).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/__tests__/ChangeDiffView.test.tsx src/components/__tests__/PendingUpdateCard*.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChangeDiffView.tsx frontend/src/components/__tests__/ChangeDiffView.test.tsx frontend/src/types/sharing.ts
git commit -m "feat(inbox): the change diff can show values formatted on the place's clock

The diff view re-parsed any string holding a T as a date in the browser's
zone, so an English share time would move. It now takes the caller's
formatter and labels, which the share notice card uses next."
```

### Task 14: The two row dialogs — share a trip, link an account

**Files:**
- Create: `frontend/src/components/sharing/ShareTripDialog.tsx`, `frontend/src/components/sharing/LinkAccountDialog.tsx`
- Modify: `frontend/src/i18n/resources/{de,en}/sharing.json` (`shareDialog.*`, `linkDialog.*`)
- Test: `frontend/src/components/sharing/__tests__/ShareTripDialog.test.tsx`, `frontend/src/components/sharing/__tests__/LinkAccountDialog.test.tsx`

**Interfaces:**
- Consumes: `Dialog`, `Button`, `Field`, `Select`, `Input` (`components/ui`), `sharingApi.shareTrip/linkCompanion/requestConsent`, `sharingErrorKey`, `useToastStore`, `TripPerson`, `SharePerson`.
- Produces:
  ```ts
  ShareTripDialog(props: { open: boolean; onClose: () => void; tripId: string; people: readonly TripPerson[];
    preselectedKey?: string; onShared: () => void }): JSX.Element
  LinkAccountDialog(props: { open: boolean; onClose: () => void; companion: { id: string; name: string };
    linkableUsers: readonly SharePerson[]; onLinked: () => void }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/sharing/__tests__/ShareTripDialog.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ShareTripDialog from "../ShareTripDialog";
import { sharingApi } from "../../../lib/api/sharing";
import type { TripPerson } from "../../../types/sharing";

/**
 * Sharing copies the trip into another account and cannot be taken back
 * (decision 5), so it is a dialog that says what is copied and what stays
 * private, with ONE confirm — never a checkbox (spec 2026-10-16, D9).
 */
vi.mock("../../../lib/api/sharing", () => ({ sharingApi: { shareTrip: vi.fn() } }));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
const api = vi.mocked(sharingApi);

const ben: TripPerson = {
  key: "c:c-ben",
  companionId: "c-ben",
  name: "Ben",
  account: { id: "u-ben", username: "ben", displayName: "Ben" },
  consent: "accepted",
  member: false,
  receivesChanges: null,
  shareBlockedBy: null,
};
const ilse: TripPerson = { ...ben, key: "c:c-ilse", companionId: "c-ilse", name: "Ilse", account: null, consent: "none", shareBlockedBy: "notLinked" };

describe("ShareTripDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says what is copied, what stays private and that it is final, then shares on confirm", async () => {
    api.shareTrip.mockResolvedValue({ groupId: "g", tripCreated: true, created: {} as never });
    const onShared = vi.fn();
    render(
      <ShareTripDialog open onClose={vi.fn()} tripId="t1" people={[ben, ilse]} preselectedKey="c:c-ben" onShared={onShared} />
    );
    expect(screen.getByText("sharing:shareDialog.copied")).toBeTruthy();
    expect(screen.getByText("sharing:shareDialog.private")).toBeTruthy();
    expect(screen.getByText("sharing:shareDialog.final")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect(api.shareTrip).toHaveBeenCalledWith("t1", "c-ben");
    await waitFor(() => expect(onShared).toHaveBeenCalled());
  });

  it("offers only people who can be shared with, and keeps a refusal on the dialog", async () => {
    api.shareTrip.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { code: "SHARE_GROUP_CONSENT_REQUIRED" } },
    });
    render(<ShareTripDialog open onClose={vi.fn()} tripId="t1" people={[ben, ilse]} onShared={vi.fn()} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Ben (@ben)"]);
    await userEvent.click(screen.getByRole("button", { name: "sharing:shareDialog.confirm" }));
    expect((await screen.findByRole("alert")).textContent).toBe("sharing:errors.groupConsentRequired");
  });
});
```

```tsx
// frontend/src/components/sharing/__tests__/LinkAccountDialog.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LinkAccountDialog from "../LinkAccountDialog";
import { sharingApi } from "../../../lib/api/sharing";

/** Linking a companion from the trip page (spec 2026-10-16, D9) — until now only in Einstellungen. */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: { linkCompanion: vi.fn(), requestConsent: vi.fn() },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
const api = vi.mocked(sharingApi);
const ben = { id: "u-ben", username: "ben", displayName: "Ben" };

describe("LinkAccountDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links to an account that agreed", async () => {
    api.linkCompanion.mockResolvedValue({ id: "c1", name: "Ben", linkedUser: ben });
    const onLinked = vi.fn();
    render(
      <LinkAccountDialog open onClose={vi.fn()} companion={{ id: "c1", name: "Ben" }} linkableUsers={[ben]} onLinked={onLinked} />
    );
    await userEvent.selectOptions(screen.getByLabelText("sharing:linkDialog.account"), "u-ben");
    await userEvent.click(screen.getByRole("button", { name: "sharing:linkDialog.link" }));
    expect(api.linkCompanion).toHaveBeenCalledWith("c1", "u-ben");
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
  });

  it("asks for consent by username when nobody has agreed yet", async () => {
    api.requestConsent.mockResolvedValue({} as never);
    render(
      <LinkAccountDialog open onClose={vi.fn()} companion={{ id: "c1", name: "Ilse" }} linkableUsers={[]} onLinked={vi.fn()} />
    );
    await userEvent.type(screen.getByLabelText("sharing:linkDialog.username"), "ilse");
    await userEvent.click(screen.getByRole("button", { name: "sharing:linkDialog.request" }));
    expect(api.requestConsent).toHaveBeenCalledWith("ilse");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/sharing/__tests__/ShareTripDialog.test.tsx src/components/sharing/__tests__/LinkAccountDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "../ShareTripDialog"` / `"../LinkAccountDialog"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/sharing/ShareTripDialog.tsx
import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { TripPerson } from "../../types/sharing";
import { Button, Dialog, Field, Select } from "../ui";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:shareDialog";

/**
 * Sharing a trip copies it into another account, and the copy stays theirs
 * (design 2026-10-09, decision 5) — so it is asked, not ticked (spec
 * 2026-10-16, D9): what is copied, what stays private, that it is final, one
 * confirm. Only people the server would accept are offered; a refusal stays
 * on the dialog in its own words.
 */
export default function ShareTripDialog({
  open,
  onClose,
  tripId,
  people,
  preselectedKey,
  onShared,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  people: readonly TripPerson[];
  preselectedKey?: string;
  onShared: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const addToast = useToastStore((s) => s.addToast);
  const eligible = people.filter((p) => p.shareBlockedBy === null && p.companionId && p.account);
  const [key, setKey] = useState(preselectedKey ?? eligible[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = eligible.find((p) => p.key === key) ?? null;

  const share = async (): Promise<void> => {
    if (!person?.companionId) return;
    setBusy(true);
    setError(null);
    try {
      await sharingApi.shareTrip(tripId, person.companionId);
      addToast("success", t(`${NS}.done`, { name: person.name }));
      onShared();
      onClose();
    } catch (err) {
      logger.error("Failed to share trip:", err);
      setError(t(sharingErrorKey(err, "sharing:trip.errors.shareFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={person ? t(`${NS}.title`, { name: person.name }) : t(`${NS}.titlePick`)}
      action={
        person ? (
          <Button variant="primary" disabled={busy} onClick={() => void share()}>
            {t(`${NS}.confirm`)}
          </Button>
        ) : undefined
      }
    >
      {eligible.length === 0 ? (
        <p className="text-sm">{t(`${NS}.nobody`)}</p>
      ) : (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
          {!preselectedKey && (
            <Field label={t(`${NS}.person`)} htmlFor="share-trip-person">
              <Select id="share-trip-person" value={key} onChange={(e) => setKey(e.target.value)}>
                {eligible.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} (@{p.account?.username})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <p className="text-sm">{t(`${NS}.copied`, { name: person?.name ?? "" })}</p>
          <p className="text-sm">{t(`${NS}.private`)}</p>
          <p className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {t(`${NS}.final`, { name: person?.name ?? "" })}
          </p>
          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
```

```tsx
// frontend/src/components/sharing/LinkAccountDialog.tsx
import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { SharePerson } from "../../types/sharing";
import { Button, Dialog, Field, Input, Select } from "../ui";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:linkDialog";

/**
 * "Mit Konto verknüpfen…" on a companion's row (spec 2026-10-16, D9). A link
 * needs an accepted consent from that account (decision 4): with one, pick the
 * account; without any, the dialog sends the request instead — the link
 * follows once the other side agrees. Einstellungen keeps the full list.
 */
export default function LinkAccountDialog({
  open,
  onClose,
  companion,
  linkableUsers,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  companion: { id: string; name: string };
  linkableUsers: readonly SharePerson[];
  onLinked: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const addToast = useToastStore((s) => s.addToast);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLink = linkableUsers.length > 0;

  const run = async (action: () => Promise<string>, fallback: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      addToast("success", await action());
      onClose();
    } catch (err) {
      logger.error("Sharing link dialog failed:", err);
      setError(t(sharingErrorKey(err, fallback)));
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const linked = await sharingApi.linkCompanion(companion.id, userId);
      onLinked();
      return t(`${NS}.linked`, { name: companion.name, username: linked.linkedUser?.username ?? "" });
    }, "sharing:settings.errors.linkFailed");

  const request = () =>
    run(async () => {
      await sharingApi.requestConsent(username.trim());
      return t(`${NS}.requested`, { username: username.trim() });
    }, "sharing:settings.errors.requestFailed");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={t(`${NS}.title`, { name: companion.name })}
      action={
        canLink ? (
          <Button variant="primary" disabled={busy || !userId} onClick={() => void link()}>
            {t(`${NS}.link`)}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !username.trim()} onClick={() => void request()}>
            {t(`${NS}.request`)}
          </Button>
        )
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {canLink ? (
          <Field label={t(`${NS}.account`)} htmlFor="link-account">
            <Select id="link-account" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t(`${NS}.choose`)}</option>
              {linkableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} (@{u.username})
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <p className="text-sm">{t(`${NS}.requestIntro`, { name: companion.name })}</p>
            <Field label={t(`${NS}.username`)} htmlFor="link-username">
              <Input id="link-username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
```

i18n — `de/sharing.json`:

```json
  "shareDialog": {
    "title": "Reise mit {{name}} teilen",
    "titlePick": "Reise teilen",
    "person": "Mit wem",
    "copied": "{{name}} bekommt eine eigene Kopie dieser Reise: Flüge, Unterkünfte, Kreuzfahrten, Bahn-, Bus- und Fährfahrten, Mietwagen und Stopps mit Zeiten, Orten und Status. Ändert einer von euch später etwas daran, kommt es bei allen an und lässt sich im Posteingang rückgängig machen.",
    "private": "Privat bleiben: Sitzplatz, Kabine und Zimmer, dein Preis, Buchungsnummern, Bewertungen, Notizen, Fotos, Tagebuch und Dokumente.",
    "final": "Das lässt sich nicht zurücknehmen: {{name}} behält die Kopie, auch wenn einer von euch die geteilte Reise verlässt.",
    "confirm": "Reise teilen",
    "done": "Reise mit {{name}} geteilt.",
    "nobody": "Gerade kannst du diese Reise mit niemandem teilen. Verknüpfe Reisende mit ihrem Konto — das geht, sobald die Person deiner Anfrage zugestimmt hat."
  },
  "linkDialog": {
    "title": "{{name}} mit Konto verknüpfen",
    "account": "Konto",
    "choose": "Konto wählen",
    "link": "Verknüpfen",
    "linked": "{{name}} ist jetzt mit @{{username}} verknüpft.",
    "requestIntro": "Noch hat niemand deiner Anfrage zugestimmt. Schick {{name}} eine Anfrage über den Benutzernamen; sobald sie zustimmt, kannst du hier verknüpfen.",
    "username": "Benutzername",
    "request": "Anfrage senden",
    "requested": "Anfrage an @{{username}} gesendet."
  },
```

`en/sharing.json`:

```json
  "shareDialog": {
    "title": "Share trip with {{name}}",
    "titlePick": "Share trip",
    "person": "With whom",
    "copied": "{{name}} gets their own copy of this trip: flights, stays, cruises, train, bus and ferry rides, rentals and stops with their times, places and status. When one of you changes something later, it reaches everyone and can be undone in the inbox.",
    "private": "Staying private: seat, cabin and room, your price, booking references, ratings, notes, photos, journal and documents.",
    "final": "This cannot be taken back: {{name}} keeps the copy even if one of you leaves the shared trip.",
    "confirm": "Share trip",
    "done": "Trip shared with {{name}}.",
    "nobody": "Right now you can't share this trip with anyone. Link travellers to their account — that works once they have accepted your request."
  },
  "linkDialog": {
    "title": "Link {{name}} to an account",
    "account": "Account",
    "choose": "Choose an account",
    "link": "Link",
    "linked": "{{name}} is now linked to @{{username}}.",
    "requestIntro": "Nobody has accepted your request yet. Send {{name}} a request by username; once they accept, you can link here.",
    "username": "Username",
    "request": "Send request",
    "requested": "Request sent to @{{username}}."
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/sharing/__tests__ src/i18n/__tests__/localeKeyParity.test.ts src/i18n/__tests__/germanInformalAddress.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sharing/ShareTripDialog.tsx frontend/src/components/sharing/LinkAccountDialog.tsx frontend/src/components/sharing/__tests__ frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json
git commit -m "feat(sharing): dialogs to share a trip and to link a companion's account

A raw checkbox copied the trip into another account irreversibly, and a
companion could be linked only in Einstellungen. The share dialog now says
what is copied, what stays private and that it is final; the link dialog
links or, without consent yet, sends the request."
```

### Task 15: One "Reisende" section on the trip page

**Files:**
- Create: `frontend/src/store/tripSharingStore.ts`, `frontend/src/components/sharing/TripPeopleSection.tsx`
- Modify: `frontend/src/components/ui/PeopleList.tsx`, `frontend/src/components/Trips/TripOverview.tsx:22,242-244,448-455`, `frontend/src/i18n/resources/{de,en}/sharing.json` (`people.*`; delete `trip.{title,notShared,members,candidates,shareTick,sharedTick,noConsent,noCandidates,settingsLink,shared}`; rename `trip.leave*`/`trip.left`)
- Delete: `frontend/src/components/sharing/TripSharingPanel.tsx`, `frontend/src/components/sharing/__tests__/TripSharingPanel.test.tsx`
- Test: `frontend/src/components/sharing/__tests__/TripPeopleSection.test.tsx`, `frontend/src/components/ui/__tests__/PeopleList.test.tsx`

**Interfaces:**
- Consumes: `sharingApi.tripSharing/leaveGroup`, `ShareTripDialog`, `LinkAccountDialog`, `DetailSection`, `Pill`, `Button`, `useConfirmDialog`, `useIsDemoAccount`, `formatCurrency`.
- Produces:
  ```ts
  // store/tripSharingStore.ts
  export const useTripSharingStore: UseBoundStore<StoreApi<{ revision: Record<string, number>; bump(tripId: string): void }>>;
  // ui/PeopleList.tsx
  export interface PersonRow { key: string; name: string; meta?: ReactNode; badges?: ReactNode; action?: ReactNode }
  export default function PeopleList(props: { names: readonly string[] } | { rows: readonly PersonRow[] }): JSX.Element;
  // components/sharing/TripPeopleSection.tsx
  export default function TripPeopleSection(props: { tripId: string; companionNames: readonly string[]; onChanged?: () => void }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/sharing/__tests__/TripPeopleSection.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import TripPeopleSection from "../TripPeopleSection";
import { sharingApi } from "../../../lib/api/sharing";
import type { TripPerson, TripSharing } from "../../../types/sharing";

/**
 * "Reisende" is the one place a trip's people are (spec 2026-10-16, D9): a
 * row each, what is true about them as pills, and at most one action. A member
 * whose consent with the reader is missing says so — changes do not travel.
 */
vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: { tripSharing: vi.fn(), shareTrip: vi.fn(), leaveGroup: vi.fn(), linkCompanion: vi.fn(), requestConsent: vi.fn() },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
const api = vi.mocked(sharingApi);

const account = (id: string) => ({ id: `u-${id}`, username: id, displayName: id });
const row = (over: Partial<TripPerson>): TripPerson => ({
  key: "c:x",
  companionId: "x",
  name: "x",
  account: null,
  consent: "none",
  member: false,
  receivesChanges: null,
  shareBlockedBy: "notLinked",
  ...over,
});
const view: TripSharing = {
  groupId: "g1",
  members: [],
  candidates: [],
  bookingTotals: [],
  linkableUsers: [account("ben")],
  people: [
    row({ key: "c:ilse", companionId: "ilse", name: "Ilse" }),
    row({ key: "c:ben", companionId: "ben", name: "Ben", account: account("ben"), consent: "accepted", shareBlockedBy: null }),
    row({ key: "u:u-carl", companionId: null, name: "Carl", account: account("carl"), member: true, receivesChanges: false, shareBlockedBy: "alreadyMember" }),
    row({ key: "c:dora", companionId: "dora", name: "Dora", account: account("dora"), member: true, receivesChanges: true, consent: "accepted", shareBlockedBy: "alreadyMember" }),
  ],
};

const renderSection = () =>
  render(
    <MemoryRouter>
      <TripPeopleSection tripId="t1" companionNames={["Ilse", "Ben", "Dora"]} />
    </MemoryRouter>
  );

describe("TripPeopleSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.tripSharing.mockResolvedValue(view);
  });

  it("shows the names at once, before the sharing state has loaded", () => {
    api.tripSharing.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByText("Ilse")).toBeTruthy();
    expect(screen.getByText("Dora")).toBeTruthy();
  });

  it("states each person's sharing state and offers one action each", async () => {
    renderSection();
    await screen.findByText("Carl");
    expect(screen.getByRole("button", { name: "sharing:people.actions.link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "sharing:people.actions.share" })).toBeTruthy();
    expect(screen.getAllByText("sharing:people.badges.member")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows Zustimmung offen and the hint for a member without consent", async () => {
    renderSection();
    await screen.findByText("Carl");
    expect(screen.getByText("sharing:people.badges.consentPending")).toBeTruthy();
    expect(screen.getByText("sharing:people.noChangesHint")).toBeTruthy();
  });

  it("opens the share dialog for a row instead of sharing on click", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "sharing:people.actions.share" }));
    expect(api.shareTrip).not.toHaveBeenCalled();
    expect(screen.getByText("sharing:shareDialog.final")).toBeTruthy();
  });

  it("keeps the names and says so when the sharing state cannot load", async () => {
    api.tripSharing.mockRejectedValue(new Error("down"));
    renderSection();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("sharing:trip.errors.loadFailed"));
    expect(screen.getByText("Ilse")).toBeTruthy();
  });
});
```

```tsx
// frontend/src/components/ui/__tests__/PeopleList.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import PeopleList from "../PeopleList";

describe("PeopleList", () => {
  it("draws a name list as before", () => {
    render(<PeopleList names={["Anna Berg"]} />);
    expect(screen.getByText("Anna Berg")).toBeTruthy();
    expect(screen.getByText("AB")).toBeTruthy();
  });

  it("draws rows with meta, badges and an action", () => {
    render(
      <PeopleList
        rows={[{ key: "b", name: "Ben", meta: "@ben", badges: <span>linked</span>, action: <button>act</button> }]}
      />
    );
    expect(screen.getByText("@ben")).toBeTruthy();
    expect(screen.getByText("linked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "act" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/sharing/__tests__/TripPeopleSection.test.tsx src/components/ui/__tests__/PeopleList.test.tsx`
Expected: FAIL — `Failed to resolve import "../TripPeopleSection"`; PeopleList's second case finds no `@ben`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/store/tripSharingStore.ts
import { create } from "zustand";

/**
 * A revision per trip, bumped when its sharing changed (spec 2026-10-16, D10):
 * the head's "Teilen" menu and the overview's "Reisende" section load their
 * own state, and this is how one tells the other — without threading a prop
 * through `TripDetailPage.tsx`, which the file-size ratchet keeps frozen.
 * Never persisted: it means "reload", nothing more.
 */
interface TripSharingState {
  revision: Record<string, number>;
  bump: (tripId: string) => void;
}

export const useTripSharingStore = create<TripSharingState>((set) => ({
  revision: {},
  bump: (tripId) =>
    set((state) => ({
      revision: { ...state.revision, [tripId]: (state.revision[tripId] ?? 0) + 1 },
    })),
}));
```

```tsx
// frontend/src/components/ui/PeopleList.tsx
import type { JSX, ReactNode } from "react";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/** One person: a name, and on the trip page what is true about them and what can be done. */
export interface PersonRow {
  key: string;
  name: string;
  /** A line under the name — "@username". */
  meta?: ReactNode;
  /** Pills: facts about the person, never actions. */
  badges?: ReactNode;
  /** At most one action, at the end of the row. */
  action?: ReactNode;
}

type PeopleListProps = { names: readonly string[] } | { rows: readonly PersonRow[] };

/**
 * Companions on a detail page: one row per person with an initials mark, as
 * round 4 draws the "Mitreisende" section. A comma list ran the names into
 * one wrapped line the eye had to split again. The trip page passes rows with
 * the sharing state (spec 2026-10-16, D9); every other page passes names.
 */
export default function PeopleList(props: PeopleListProps): JSX.Element {
  const rows: readonly PersonRow[] =
    "rows" in props ? props.rows : props.names.map((name) => ({ key: name, name }));
  return (
    <ul className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {rows.map((row) => (
        <li key={row.key} className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: "var(--ts-surface2)",
              fontFamily: "var(--ts-font-mono)",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--ts-text-bright)",
            }}
          >
            {initials(row.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
            <span style={{ fontSize: 14, color: "var(--ts-text-bright)" }}>{row.name}</span>
            {row.meta && <span className="t-caption">{row.meta}</span>}
            {row.badges && <span className="flex flex-wrap" style={{ gap: 6 }}>{row.badges}</span>}
          </span>
          {row.action && <span className="shrink-0">{row.action}</span>}
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// frontend/src/components/sharing/TripPeopleSection.tsx
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { formatCurrency } from "../../lib/units";
import { useToastStore } from "../../store/toastStore";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { TripPerson, TripSharing } from "../../types/sharing";
import { Button, Pill } from "../ui";
import DetailSection from "../ui/DetailSection";
import PeopleList, { type PersonRow } from "../ui/PeopleList";
import LinkAccountDialog from "./LinkAccountDialog";
import ShareTripDialog from "./ShareTripDialog";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:people";

/**
 * "Reisende" on the trip overview (spec 2026-10-16, D9) — the trip's people
 * and its sharing in one place: who is linked to an account, who holds this
 * trip, whose consent is missing, and the ONE thing to do next for each (link,
 * or share through a dialog). The names show at once from the trip; the
 * sharing state follows, and a failed load says so without hiding the names.
 */
export default function TripPeopleSection({
  tripId,
  companionNames,
  onChanged,
}: {
  tripId: string;
  companionNames: readonly string[];
  onChanged?: () => void;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["sharing", "trips"]);
  const isSharedDemo = useIsDemoAccount();
  const addToast = useToastStore((s) => s.addToast);
  const revision = useTripSharingStore((s) => s.revision[tripId] ?? 0);
  const bump = useTripSharingStore((s) => s.bump);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [view, setView] = useState<TripSharing | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sharing, setSharing] = useState<TripPerson | null>(null);
  const [linking, setLinking] = useState<TripPerson | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await sharingApi.tripSharing(tripId));
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load trip sharing:", error);
      setLoadFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    if (!isSharedDemo) void load();
  }, [load, revision, isSharedDemo]);

  const changed = (): void => {
    bump(tripId);
    onChanged?.();
  };

  const leave = async (): Promise<void> => {
    if (!(await confirm({ message: t("sharing:trip.leaveConfirm"), confirmText: t(`${NS}.leave`) }))) return;
    setBusy(true);
    try {
      await sharingApi.leaveGroup(tripId);
      addToast("success", t("sharing:trip.left"));
      changed();
    } catch (error) {
      logger.error("Failed to leave share group:", error);
      addToast("error", t(sharingErrorKey(error, "sharing:trip.errors.leaveFailed")));
    } finally {
      setBusy(false);
    }
  };

  if (companionNames.length === 0 && (view?.people.length ?? 0) === 0) return null;
  if (isSharedDemo || !view) {
    return (
      <DetailSection title={t("trips:detail.companions")}>
        <PeopleList names={companionNames} />
        {loadFailed && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {t("sharing:trip.errors.loadFailed")}
          </p>
        )}
      </DetailSection>
    );
  }

  const badges = (p: TripPerson): JSX.Element => (
    <>
      {p.account && <Pill color="var(--ts-muted)">{t(`${NS}.badges.linked`)}</Pill>}
      {p.member && <Pill color="var(--ts-good)">{t(`${NS}.badges.member`)}</Pill>}
      {(p.consent === "pending" || p.receivesChanges === false) && (
        <Pill color="var(--ts-warn)">{t(`${NS}.badges.consentPending`)}</Pill>
      )}
    </>
  );
  const meta = (p: TripPerson): string | undefined => {
    if (p.receivesChanges === false) return t(`${NS}.noChangesHint`);
    if (p.shareBlockedBy === "consentMissing") return t(`${NS}.blocked.consentMissing`, { name: p.name });
    if (p.shareBlockedBy === "groupConsentMissing") {
      return t(`${NS}.blocked.groupConsentMissing`, { name: p.name });
    }
    return p.account ? `@${p.account.username}` : undefined;
  };
  const action = (p: TripPerson): JSX.Element | undefined => {
    if (p.shareBlockedBy === "notLinked" && p.companionId) {
      return <Button onClick={() => setLinking(p)}>{t(`${NS}.actions.link`)}</Button>;
    }
    if (p.shareBlockedBy === null) {
      return <Button onClick={() => setSharing(p)}>{t(`${NS}.actions.share`)}</Button>;
    }
    return undefined;
  };
  const rows: PersonRow[] = view.people.map((p) => ({
    key: p.key,
    name: p.name,
    meta: meta(p),
    badges: badges(p),
    action: action(p),
  }));

  return (
    <>
      <DetailSection title={t("trips:detail.companions")}>
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <PeopleList rows={rows} />
          {view.bookingTotals.length > 0 && (
            <div data-testid="share-booking-totals" className="text-sm">
              <p className="t-label-mono">{t("sharing:trip.bookingTotals")}</p>
              <ul className="flex flex-col gap-1">
                {view.bookingTotals.map((entry) => (
                  <li key={entry.member.id}>
                    {entry.member.displayName}:{" "}
                    {entry.totals
                      .map((sum) => formatCurrency(sum.amount, sum.currency, { language: i18n.language }))
                      .join(" + ")}
                  </li>
                ))}
              </ul>
              <p className="t-caption">{t("sharing:trip.bookingTotalsHint")}</p>
            </div>
          )}
          {view.groupId && (
            <div>
              <Button disabled={busy} onClick={() => void leave()}>
                {t(`${NS}.leave`)}
              </Button>
            </div>
          )}
        </div>
      </DetailSection>
      {sharing && (
        <ShareTripDialog
          open
          onClose={() => setSharing(null)}
          tripId={tripId}
          people={view.people}
          preselectedKey={sharing.key}
          onShared={changed}
        />
      )}
      {linking?.companionId && (
        <LinkAccountDialog
          open
          onClose={() => setLinking(null)}
          companion={{ id: linking.companionId, name: linking.name }}
          linkableUsers={view.linkableUsers}
          onLinked={changed}
        />
      )}
      {confirmDialog}
    </>
  );
}
```

`TripOverview.tsx` — replace the import of `TripSharingPanel` with `import TripPeopleSection from "../sharing/TripPeopleSection";`, drop the `PeopleList` import if no other use remains, change `hasSide` to `const hasSide = trip.companions.length > 0 || trip.tags.length > 0 || Boolean(trip.summary) || !isSharedDemo;` (unchanged — the section hides itself when there is nobody), and replace the companions block plus the panel line with:

```tsx
            <TripPeopleSection
              tripId={trip.id}
              companionNames={trip.companions}
              onChanged={onChanged}
            />
```

i18n — `de/sharing.json`, new `people` object:

```json
  "people": {
    "badges": {
      "linked": "Konto verknüpft",
      "member": "Teilt diese Reise",
      "consentPending": "Zustimmung offen"
    },
    "noChangesHint": "Eure Änderungen kommen gegenseitig nicht an, bis ihr beide zugestimmt habt.",
    "actions": { "link": "Mit Konto verknüpfen…", "share": "Reise teilen…" },
    "blocked": {
      "consentMissing": "{{name}} hat dem Teilen noch nicht zugestimmt.",
      "groupConsentMissing": "Nicht alle, die diese Reise teilen, haben dem Teilen mit {{name}} zugestimmt."
    },
    "leave": "Geteilte Reise verlassen"
  },
```

`en/sharing.json`:

```json
  "people": {
    "badges": {
      "linked": "Account linked",
      "member": "Shares this trip",
      "consentPending": "Consent pending"
    },
    "noChangesHint": "Your changes don't reach each other until you have both agreed.",
    "actions": { "link": "Link to account…", "share": "Share trip…" },
    "blocked": {
      "consentMissing": "{{name}} has not agreed to sharing yet.",
      "groupConsentMissing": "Not everyone on this shared trip has agreed to sharing with {{name}}."
    },
    "leave": "Leave shared trip"
  },
```

In both files delete `trip.title`, `trip.notShared`, `trip.members`, `trip.candidates`, `trip.shareTick`, `trip.sharedTick`, `trip.noConsent`, `trip.noCandidates`, `trip.settingsLink`, `trip.shared`, `trip.leave`; rewrite `trip.leaveConfirm` (DE "Geteilte Reise verlassen? Deine Kopie bleibt als eigene Reise erhalten; die anderen werden benachrichtigt." / EN "Leave the shared trip? Your copy stays as your own trip; the others are notified."), `trip.left` (DE "Du hast die geteilte Reise verlassen. Deine Reise bleibt erhalten." / EN "You left the shared trip. Your trip stays."), `trip.errors.loadFailed` (DE "Wer diese Reise teilt, konnte nicht geladen werden." / EN "Who shares this trip could not be loaded."), `trip.errors.leaveFailed` (DE "Die geteilte Reise konnte nicht verlassen werden." / EN "The shared trip could not be left.").

Delete `frontend/src/components/sharing/TripSharingPanel.tsx` and its test.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/sharing src/components/ui/__tests__/PeopleList.test.tsx src/components/Trips src/i18n/__tests__` → PASS.
Browser check (memory: "Im Browser pruefen"): production build on the isolated verification stack (`reference_browser_verification_stack`), open a shared trip as the owner: the section shows pills and one action per row; the share dialog opens; nothing copies before confirm.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/tripSharingStore.ts frontend/src/components/ui/PeopleList.tsx frontend/src/components/ui/__tests__/PeopleList.test.tsx frontend/src/components/sharing frontend/src/components/Trips/TripOverview.tsx frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json
git commit -m "feat(trips): one Reisende section with each person's sharing state

The trip page listed its companions in one box and its sharing in a second
one with a raw checkbox, and a member who no longer received changes looked
connected. One row per person now carries linked, shares-this-trip and
consent-pending pills and the one next action, through a dialog."
```

### Task 16: One "Teilen" entry point in the trip head

**Files:**
- Create: `frontend/src/components/sharing/TripShareMenu.tsx`
- Modify: `frontend/src/components/Trips/TripHead.tsx:11,148-154`, `frontend/src/components/Trips/TripOverview.tsx:456-461` (remove `ShareLinkButton`), `frontend/src/i18n/resources/{de,en}/sharing.json` (`menu.*`)
- Test: `frontend/src/components/sharing/__tests__/TripShareMenu.test.tsx`

**Interfaces:**
- Consumes: `ShareTripDialog`, `ShareLinkDialog` (`components/shareLinks/ShareLinkDialog.tsx`, props `open, onClose, kind, targetId`), `sharingApi.tripSharing`, `useTripSharingStore`, `useIsDemoAccount`.
- Produces: `TripShareMenu(props: { tripId: string }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/sharing/__tests__/TripShareMenu.test.tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TripShareMenu from "../TripShareMenu";
import { sharingApi } from "../../../lib/api/sharing";

/**
 * "Teilen" is ONE entry point with two meanings kept apart (spec 2026-10-16,
 * D10/D11): a copy for travel companions, or a public link.
 */
vi.mock("../../../lib/api/sharing", () => ({ sharingApi: { tripSharing: vi.fn(), shareTrip: vi.fn() } }));
vi.mock("../../shareLinks/ShareLinkDialog", () => ({
  default: ({ kind, targetId }: { kind: string; targetId: string }) => <div>link-dialog {kind} {targetId}</div>,
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}));
const demo = { value: false };
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.value }));
const api = vi.mocked(sharingApi);

describe("TripShareMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo.value = false;
    api.tripSharing.mockResolvedValue({ groupId: null, members: [], candidates: [], bookingTotals: [], people: [], linkableUsers: [] });
  });

  it("offers the companions copy and the public link", async () => {
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    expect(screen.getByRole("menuitem", { name: "sharing:menu.companions" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "sharing:menu.link" }));
    expect(screen.getByText("link-dialog trip t1")).toBeTruthy();
  });

  it("opens the share dialog with a person picker", async () => {
    render(<TripShareMenu tripId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "sharing:menu.button" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "sharing:menu.companions" }));
    expect(await screen.findByText("sharing:shareDialog.nobody")).toBeTruthy();
  });

  it("is absent for the shared demo account", () => {
    demo.value = true;
    render(<TripShareMenu tripId="t1" />);
    expect(screen.queryByRole("button", { name: "sharing:menu.button" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/sharing/__tests__/TripShareMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "../TripShareMenu"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/sharing/TripShareMenu.tsx
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { TripPerson } from "../../types/sharing";
import ShareLinkDialog from "../shareLinks/ShareLinkDialog";
import { Button } from "../ui";
import ShareTripDialog from "./ShareTripDialog";

/**
 * The trip head's "Teilen" (spec 2026-10-16, D10): one entry point, two kinds
 * of sharing kept apart in words (D11) — "Mit Mitreisenden (eigene Kopie)"
 * copies the trip into a companion's account, "Öffentlicher Link" is the
 * public, expiring link of forgejo#281. Not for the shared demo account,
 * which is every visitor at once.
 */
export default function TripShareMenu({ tripId }: { tripId: string }): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const isSharedDemo = useIsDemoAccount();
  const bump = useTripSharingStore((s) => s.bump);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"companions" | "link" | null>(null);
  const [people, setPeople] = useState<TripPerson[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (dialog !== "companions") return;
    sharingApi
      .tripSharing(tripId)
      .then((view) => setPeople(view.people))
      .catch((error: unknown) => {
        logger.error("Failed to load trip sharing:", error);
        setPeople([]);
      });
  }, [dialog, tripId]);

  if (isSharedDemo) return null;
  const pick = (which: "companions" | "link") => {
    setOpen(false);
    setPeople(null);
    setDialog(which);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("sharing:menu.button")}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-70 mt-1.5 flex min-w-[260px] flex-col rounded-lg p-2 shadow-xl"
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          {(["companions", "link"] as const).map((which) => (
            <button
              key={which}
              type="button"
              role="menuitem"
              onClick={() => pick(which)}
              className="rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--ts-tile)]"
              style={{ color: "var(--ts-text)" }}
            >
              {t(`sharing:menu.${which}`)}
            </button>
          ))}
        </div>
      )}
      {dialog === "link" && (
        <ShareLinkDialog open onClose={() => setDialog(null)} kind="trip" targetId={tripId} />
      )}
      {dialog === "companions" && people && (
        <ShareTripDialog
          open
          onClose={() => setDialog(null)}
          tripId={tripId}
          people={people}
          onShared={() => bump(tripId)}
        />
      )}
    </div>
  );
}
```

`TripHead.tsx` — `import TripShareMenu from "../sharing/TripShareMenu";` and, as the first child of the actions `div`: `<TripShareMenu tripId={trip.id} />`.

`TripOverview.tsx` — delete the `ShareLinkButton` block and its import (`ShareLinkButton` stays on flights and the year in review).

i18n — DE `"menu": { "button": "Teilen", "companions": "Mit Mitreisenden (eigene Kopie)", "link": "Öffentlicher Link" }`; EN `"menu": { "button": "Share", "companions": "With travel companions (own copy)", "link": "Public link" }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/sharing src/components/Trips src/components/shareLinks src/i18n/__tests__` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sharing/TripShareMenu.tsx frontend/src/components/sharing/__tests__/TripShareMenu.test.tsx frontend/src/components/Trips/TripHead.tsx frontend/src/components/Trips/TripOverview.tsx frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json
git commit -m "feat(trips): one Teilen menu for a companion's copy and a public link

Sharing with a companion lived in the overview's side column and the public
link in a button beside it, both called share. The trip head now has one
Teilen menu that names the two apart: an own copy for travel companions, or a
public link."
```

### Task 17: The inbox's share notices on the pending-update card

**Files:**
- Create: `frontend/src/components/inbox/ShareNoticeCard.tsx`
- Rewrite: `frontend/src/components/inbox/SharingTab.tsx`
- Delete: `frontend/src/components/inbox/ShareNoticeRow.tsx`
- Modify: `frontend/src/components/inbox/__tests__/SharingTab.test.tsx`, `SharingTab.notices.test.tsx` (selectors), `frontend/src/i18n/resources/{de,en}/sharing.json` (`inbox.notices.kinds.*`, `inbox.notices.details`)
- Test: `frontend/src/components/inbox/__tests__/ShareNoticeCard.test.tsx`

**Interfaces:**
- Consumes: `Card`, `Button`, `Pill` (`ui`), `ChangeDiffView` (`formatValue`, `fieldLabel`; Task 13), `formatShareValue`, `shareFieldLabel` (`sharing/noticeValues.ts`), `GlobeLoader`, `EmptyState`, `formatDateTime`.
- Produces: `ShareNoticeCard(props: { notice: ShareNotice; busy: boolean; error: string | null; onRead(): void; onUndo(): void; onDeleteCopy(): void }): JSX.Element` (same callbacks as the row it replaces).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/inbox/__tests__/ShareNoticeCard.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ShareNoticeCard from "../ShareNoticeCard";
import type { ShareNotice } from "../../../types/sharing";

/**
 * A share notice is a change already applied (owner decision 3, kept), shown on
 * the pending-update card's anatomy (spec 2026-10-16, D12): a kind pill, the
 * entry, the first changes inline, the rest behind Details — and undo as the
 * primary action while it is still possible.
 */
const notice = (over: Partial<ShareNotice>): ShareNotice => ({
  id: "n1",
  kind: "updated",
  entityType: "flight",
  entityKey: null,
  after: { label: "TP571 FRA → LIS", tripId: "t1", entryId: "f1" },
  createdAt: "2026-10-16T08:00:00.000Z",
  readAt: null,
  undoneAt: null,
  actor: { id: "u-anna", username: "anna", displayName: "Anna" },
  changes: [
    { field: "gate", before: { kind: "text", value: "A1" }, after: { kind: "text", value: "B12" } },
    { field: "terminal", before: { kind: "empty" }, after: { kind: "text", value: "2" } },
    { field: "aircraft", before: { kind: "text", value: "A320" }, after: { kind: "text", value: "A321" } },
    { field: "status", before: { kind: "text", value: "scheduled" }, after: { kind: "text", value: "flown" } },
  ],
  ...over,
});
const renderCard = (n: ShareNotice, handlers = { onRead: vi.fn(), onUndo: vi.fn(), onDeleteCopy: vi.fn() }) => {
  render(
    <MemoryRouter>
      <ShareNoticeCard notice={n} busy={false} error={null} {...handlers} />
    </MemoryRouter>
  );
  return handlers;
};

describe("ShareNoticeCard", () => {
  it("makes undo the primary action of an applied change", async () => {
    const h = renderCard(notice({}));
    expect(screen.getByText("sharing:inbox.notices.kinds.updated")).toBeTruthy();
    expect(screen.getByText("TP571 FRA → LIS")).toBeTruthy();
    const undo = screen.getByRole("button", { name: "sharing:inbox.notices.undo" });
    expect(undo.getAttribute("data-variant")).toBe("primary");
    await userEvent.click(undo);
    expect(h.onUndo).toHaveBeenCalled();
  });

  it("shows three changes inline and the rest in the details", async () => {
    renderCard(notice({}));
    expect(screen.getByText("B12")).toBeTruthy();
    expect(screen.queryByText("flown")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "sharing:inbox.notices.details" }));
    await userEvent.click(screen.getByRole("button", { name: /sharing:fields.status/ }));
    expect(screen.getByText("flown")).toBeTruthy();
  });

  it("offers deleting the own copy after a delete, and no undo once undone", () => {
    renderCard(notice({ kind: "deleted", changes: [] }));
    expect(screen.getByRole("button", { name: "sharing:inbox.notices.deleteCopy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "sharing:inbox.notices.undo" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/inbox/__tests__/ShareNoticeCard.test.tsx`
Expected: FAIL — `Failed to resolve import "../ShareNoticeCard"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/inbox/ShareNoticeCard.tsx
import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { formatDateTime } from "../../lib/displayFormat";
import type { ShareNotice } from "../../types/sharing";
import ChangeDiffView, { type ChangeEntry } from "../ChangeDiffView";
import { formatShareValue, shareFieldLabel } from "../sharing/noticeValues";
import { Button, Card, Pill } from "../ui";

const NS = "sharing:inbox.notices";
const INLINE = 3;
const KIND_COLOR: Record<ShareNotice["kind"], string> = {
  shared: "var(--ts-info)",
  created: "var(--ts-good)",
  updated: "var(--ts-info)",
  deleted: "var(--ts-warn)",
  left: "var(--ts-muted)",
};

/**
 * One notice about a shared trip (owner decision 3, 2026-10-09: changes are
 * applied at once and the others are told, with undo). Since the rework
 * (spec 2026-10-16, D12) it wears the pending-update card's anatomy — kind
 * pill, actor and time, the entry, three changes inline and the rest behind
 * Details — and undo is the primary action while it is still possible. Values
 * arrive formatted on the place's clock and are shown as given.
 */
export default function ShareNoticeCard({
  notice,
  busy,
  error,
  onRead,
  onUndo,
  onDeleteCopy,
}: {
  notice: ShareNotice;
  busy: boolean;
  error: string | null;
  onRead: () => void;
  onUndo: () => void;
  onDeleteCopy: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["sharing"]);
  const [details, setDetails] = useState(false);
  const locale = i18n.language?.startsWith("en") ? "en-GB" : "de-DE";
  const after = notice.after ?? {};
  const textKey =
    notice.kind === "deleted" && after.reason === "movedOut"
      ? "movedOut"
      : notice.kind === "created" && after.joined
        ? "joined"
        : notice.kind;
  const text = t(`${NS}.${textKey}`, {
    name: notice.actor?.displayName ?? t(`${NS}.someone`),
    trip: after.tripName ?? t(`${NS}.unknownTrip`),
    entry: after.label || t(`${NS}.unknownEntry`),
    type: t(`sharing:entityTypes.${notice.entityType ?? "trip"}`),
  });
  const unread = notice.readAt === null;
  const tripLink = notice.entityType === "trip" ? notice.entityKey : (after.tripId ?? null);
  const canUndo = notice.kind === "updated" && notice.undoneAt === null;
  const changes: ChangeEntry[] = notice.changes.map((c) => ({
    field: c.field,
    type: "changed",
    oldValue: formatShareValue(c.before, locale, t),
    newValue: formatShareValue(c.after, locale, t),
  }));

  return (
    <Card data-testid="share-notice" style={unread ? { borderColor: "var(--ts-accent)" } : undefined}>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: 8 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Pill color={KIND_COLOR[notice.kind]}>{t(`${NS}.kinds.${notice.kind}`)}</Pill>
            <span className="t-caption">
              {notice.actor?.displayName ?? t(`${NS}.someone`)} · {formatDateTime(notice.createdAt)}
            </span>
          </div>
          {notice.undoneAt && <span className="t-caption">{t(`${NS}.undone`)}</span>}
        </div>
        {after.label && (
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ts-text-bright)" }}>{after.label}</h3>
        )}
        <p className="text-sm" style={{ fontWeight: unread ? 600 : 400 }}>
          {text}
        </p>
        {changes.length > 0 && (
          <ul className="flex flex-col text-sm" style={{ gap: 4 }}>
            {changes.slice(0, INLINE).map((c) => (
              <li key={c.field} data-testid="share-change">
                <span className="t-caption">{shareFieldLabel(c.field, t)}: </span>
                <span style={{ textDecoration: "line-through", opacity: 0.7 }}>{c.oldValue}</span>
                {" → "}
                <span>{c.newValue}</span>
              </li>
            ))}
          </ul>
        )}
        {details && (
          <ChangeDiffView
            original={{}}
            proposed={{}}
            changes={changes}
            formatValue={(v) => String(v ?? "—")}
            fieldLabel={(f) => shareFieldLabel(f, t)}
          />
        )}
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          {canUndo && (
            <Button variant="primary" disabled={busy} onClick={onUndo}>
              {t(`${NS}.undo`)}
            </Button>
          )}
          {notice.kind === "deleted" && (
            <Button variant="danger" disabled={busy} onClick={onDeleteCopy}>
              {t(`${NS}.deleteCopy`)}
            </Button>
          )}
          {changes.length > INLINE && (
            <Button onClick={() => setDetails((d) => !d)}>{t(`${NS}.details`)}</Button>
          )}
          {unread && (
            <Button disabled={busy} onClick={onRead}>
              {t(`${NS}.markRead`)}
            </Button>
          )}
          {tripLink && (
            <Link to={`/trips/${tripLink}`} className="text-sm">
              {t(`${NS}.open`)}
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
```

`SharingTab.tsx` — keep its state and handlers; replace the `ShareNoticeRow` import with `ShareNoticeCard` and render `<ShareNoticeCard … />` with the same props; replace the loading paragraph with

```tsx
    return (
      <div className="flex justify-center py-12">
        <GlobeLoader size={120} label={t("common:loading.default")} />
      </div>
    );
```

(`import { GlobeLoader } from "../GlobeLoader";`), and render each consent request inside `<Card data-testid="share-request">` instead of the hand-styled `div`. Delete `ShareNoticeRow.tsx`. In `SharingTab.test.tsx` / `SharingTab.notices.test.tsx` replace any lookup of the old `"common:loading.default"` paragraph with `screen.getByRole("status", { name: "common:loading.default" })` (`GlobeLoader` renders `role="status"` with its label as `aria-label`), and keep the `share-notice` / `share-request` test ids.

i18n — DE `inbox.notices.kinds`: `{ "shared": "Geteilt", "created": "Hinzugefügt", "updated": "Geändert", "deleted": "Gelöscht", "left": "Verlassen" }`, `inbox.notices.details` "Details"; EN `{ "shared": "Shared", "created": "Added", "updated": "Changed", "deleted": "Deleted", "left": "Left" }`, "Details". DE `inbox.notices.left` becomes "{{name}} hat die geteilte Reise „{{trip}}“ verlassen. Die eigene Kopie behält {{name}}." (already says "geteilte Reise" — unchanged).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/components/inbox src/pages/__tests__/PendingUpdatesPage* src/i18n/__tests__` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/inbox frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json
git commit -m "feat(inbox): share notices on the pending-update card, undo first

A share notice was a hand-styled row beside the pending-update cards, with
undo as one button among three. Notices now use the same card: kind pill,
entry, three changes inline and the rest in the diff view, and undo as the
primary action while it is still possible. Changes stay applied first and
told after (owner decision 3)."
```

### Task 18: Terminology guard

**Files:**
- Create: `frontend/src/i18n/__tests__/sharingTerminology.test.ts`
- Modify: `frontend/src/i18n/resources/de/sharing.json` (`settings.errors.loadFailed`, any further hit), `frontend/src/i18n/resources/en/sharing.json`

**Interfaces:**
- Consumes: the two `sharing.json` files.
- Produces: the D11 rule as a test.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/i18n/__tests__/sharingTerminology.test.ts
import { describe, expect, it } from "vitest";

import de from "../resources/de/sharing.json";
import en from "../resources/en/sharing.json";

/**
 * Three features share one word family (spec 2026-10-16, D11): "teilen" is a
 * copy in a companion's account, "Link" a public link, and "Freigabe" /
 * "Reisegruppe" belong to Vergleichen. Trip sharing's copy said "Freigabe" and
 * "Gruppe verlassen" — a reader could not tell the features apart.
 */
const strings = (node: unknown, path = ""): [string, string][] =>
  typeof node === "string"
    ? [[path, node]]
    : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        strings(v, path ? `${path}.${k}` : k)
      );

const outsideLinks = (file: unknown) =>
  strings(file).filter(([path]) => !path.startsWith("links.") && !path.startsWith("admin"));

describe("trip sharing terminology", () => {
  it("never says Freigabe or Gruppe for a shared trip (DE)", () => {
    const hits = outsideLinks(de).filter(([, s]) => /freigab|freigeb|gruppe/i.test(s));
    expect(hits).toEqual([]);
  });

  it("never says group for a shared trip (EN)", () => {
    const hits = outsideLinks(en).filter(([, s]) => /\bgroup\b/i.test(s));
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/i18n/__tests__/sharingTerminology.test.ts`
Expected: FAIL — DE lists `settings.errors.loadFailed` ("Die Freigaben konnten nicht geladen werden."), plus any `inbox`/`errors` string still saying "Gruppe" (e.g. `errors.groupConsentRequired`); EN lists the matching "group" strings.

- [ ] **Step 3: Write minimal implementation**

Rewrite each listed string. Known ones: DE `settings.errors.loadFailed` → "Die Einstellungen zum Teilen konnten nicht geladen werden."; EN → "The sharing settings could not be loaded."; DE `errors.groupConsentRequired` → "Nicht alle, die diese Reise teilen, haben dem Teilen mit dieser Person zugestimmt."; EN → "Not everyone on this shared trip has agreed to sharing with this person." Every further hit the test prints is rewritten with "geteilte Reise" / "shared trip" in place of "Gruppe" / "group", and "Teilen" / "sharing" in place of "Freigabe".

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest --run src/i18n/__tests__` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/__tests__/sharingTerminology.test.ts frontend/src/i18n/resources/de/sharing.json frontend/src/i18n/resources/en/sharing.json
git commit -m "test(i18n): trip sharing never says Freigabe or Gruppe

Freigabe and Reisegruppe are the comparison feature's words; trip sharing's
copy borrowed both, so a reader could not tell which feature a message was
about. A test now keeps them apart."
```

### Task 19: Remove the old view shape and record the rework

**Files:**
- Modify: `backend/src/services/sharing/shareTrip.ts` (drop `members`, `candidates`, `ShareCandidate`), `backend/src/services/openapi/paths/sharing.ts` (schema), `frontend/src/types/sharing.ts` (drop `ShareCandidate`, `TripSharing.members/candidates`), every frontend test fixture that still sets them, `backend/src/routes/__tests__/sharing.share.test.ts` (assertions on `candidates` → `people`)
- Create: `docs/superpowers/specs/2026-10-16-trip-sharing-rework-design.md` (the spec, copied from the plan scratchpad)
- Modify: `docs/superpowers/specs/2026-10-09-trip-sharing-design.md` (pointer section), `CLAUDE.md` (Critical Gotchas line, two Enforced rows)
- Test: `backend/src/routes/__tests__/sharing.share.test.ts` (shape)

**Interfaces:**
- Produces: `TripSharingView = { groupId: string | null; people: TripPerson[]; linkableUsers: SharePerson[]; bookingTotals: MemberBookingTotal[] }`.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/routes/__tests__/sharing.share.test.ts`:

```ts
  it("answers the trip view in its one shape: people, linkable accounts, booking totals", async () => {
    const res = await request(app).get(`/api/v1/sharing/trips/${tripId}`).set("Cookie", anna.cookie);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ["bookingTotals", "groupId", "linkableUsers", "people"].sort()
    );
  });
```

(`tripId`/`anna` are the suite's existing fixtures; use the names that suite already binds.)

- [ ] **Step 2: Run test to verify it fails**

Run: `$JEST src/routes/__tests__/sharing.share.test.ts`
Expected: FAIL — keys also contain `candidates` and `members`.

- [ ] **Step 3: Write minimal implementation**

`shareTrip.ts` — delete `ShareCandidate`, `members`/`candidates` from `TripSharingView`, and from `tripSharingView` the `companions`/`consents` queries and the `members`/`candidates` mapping; the function becomes:

```ts
export async function tripSharingView(userId: string, tripId: string): Promise<TripSharingView> {
  const trip = await ownTrip(prisma, userId, tripId);
  const [people, bookingTotals] = await Promise.all([
    tripPeople(userId, trip),
    trip.shareGroupId ? groupBookingTotals(trip.shareGroupId, userId) : Promise.resolve([]),
  ]);
  return { groupId: trip.shareGroupId, ...people, bookingTotals };
}
```

OpenAPI: remove `members` and `candidates` from the 200 schema. Frontend: remove `ShareCandidate`, `members`, `candidates` from `types/sharing.ts` and from the fixtures in `TripPeopleSection.test.tsx` and `TripShareMenu.test.tsx`; `npx tsc --noEmit` finds any other reader.

Docs: copy the spec into `docs/superpowers/specs/2026-10-16-trip-sharing-rework-design.md`. Append to `2026-10-09-trip-sharing-design.md`:

```markdown
## Rework (2026-10-16)

The per-type lists of this design (seven entry types, one `copyX` each, detach,
bulk sync) are now one registry, `services/sharing/shareTypes.ts`, and ferry
crossings are the eighth shareable type. Copy path, derivation, the per-call
write-path guard, the vocabulary CHECKs, the superseded pending update and the
trip page's single "Reisende" section are described in
`2026-10-16-trip-sharing-rework-design.md`. Decisions 1–7 above stand unchanged.
```

`CLAUDE.md` — Critical Gotchas, after the "Domain gating" bullet:

```markdown
- **Shareable entry types are one registry** (since 2026-10-16) —
  `backend/src/services/sharing/shareTypes.ts`. A domain added to
  `shared/domains.ts` is classified in `DOMAIN_SHARING` (shared, or why not);
  a table with a `share_key` column needs a `SHARE_TYPES` entry, an adapter and
  a `DERIVE` entry, or `shareTypes.test.ts` fails. Bus was missing from ten
  hand-kept lists until forgejo#288 and ferry carried a `share_key` nothing read.
  Every write to a shareable table propagates or carries
  `// share-exempt: <reason>` on the line above.
```

Enforced table, two rows:

```markdown
| Every table with a `share_key` column is a registered shareable type, every domain is classified, every type has DE+EN labels | `backend/src/services/sharing/__tests__/shareTypes.test.ts` |
| Every write to a shareable table propagates or names its reason at the call | `backend/src/services/sharing/__tests__/propagate.writePaths.test.ts` |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$JEST src/routes/__tests__/sharing src/services/sharing src/__tests__/openapi.coverage.test.ts src/__tests__/openapi.responseSchema.test.ts src/__tests__/apiResponseShape.ratchet.test.ts` → PASS.
Run: `cd frontend && npx tsc --noEmit && npx vitest --run` → PASS.
Run the full Build Checks of `CLAUDE.md` (both trees: tsc, lint, tests; root `npm run check`; coverage ratchet for both) → green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sharing/shareTrip.ts backend/src/services/openapi/paths/sharing.ts backend/src/routes/__tests__/sharing.share.test.ts frontend/src/types/sharing.ts frontend/src/components/sharing/__tests__ docs/superpowers/specs/2026-10-16-trip-sharing-rework-design.md docs/superpowers/specs/2026-10-09-trip-sharing-design.md CLAUDE.md
git commit -m "refactor(sharing): drop the old trip view shape and record the rework

members and candidates were served beside people for one deploy so a cached
bundle kept working; nothing reads them now. The spec, the 2026-10-09
design's pointer and CLAUDE.md's invariant and enforced rows record the
registry and the per-call guard."
```

Then, per `CLAUDE.md` "PFLICHT: den Leitstand aktuell halten": add the rework as an item to `roadmap.local.yaml` (`source: { type: owner }`, title "Trip sharing rework 2026-10-16") and the two rollout runs (`sharing:report-consent`, `sharing:backfill-ferries`) as items blocked on the owner's word; rebuild the board. Report the branch as done and ask the merge question in isolation.

---

## Self-Review

**Spec coverage** (spec section → task):
- D1 registry, G1 → Task 1 (registry, domains, DB columns, labels), Task 5 (ferry wired, ratchet emptied), Task 11 (exchange kinds), Task 19 (CLAUDE.md).
- D2 key ops → Task 2 (assign, clear/detach, bulk, stop refs, merge).
- D3 one copy path, join on propagate → Task 3; used by the backfill in Task 12.
- D4 derivation for the recipient, `dayAnchorNowFor`, `restatusTrips` → Task 4 (+ ferry entry in Task 5).
- D5 per-call guard and the four low-ratio files → Task 7.
- D6 vocabularies → Task 6.
- D7 superseded → Task 9 (+ `pendingUpdates:status.superseded`).
- D8 same transaction → Task 8.
- D9 people section, dialogs, linking from the row → Tasks 10, 13, 14, 15.
- D10 one Teilen menu → Task 16. D11 terminology → Tasks 15 (keys), 18 (guard). D12 inbox card → Tasks 13 (diff view), 17.
- G2 ferry end to end: share/propagate/detach/merge/undo/notices (Task 5, merge via Task 2's registry loop), `.travstats` (Task 11), labels (Task 5), backfill (Task 12).
- §10 rollout → Task 12 (scripts), Task 6 (migration pre-count), Task 19 (old shape served until last). §11 beta gate: no key, each task swaps one surface whole — Tasks 15–17 each delete what they replace. §12 deletions → Tasks 3 (`copyEntries.ts`), 2 (ladders), 4 (`derivedStatus`, `stayStatusNow`), 15 (`TripSharingPanel`), 16 (overview `ShareLinkButton`), 17 (`ShareNoticeRow`), 19 (`members`/`candidates`). §14 docs → Task 19.

**Placeholder scan:** every code step carries code. Two steps hand the implementer a list the code itself produces rather than a guess: Task 7 Step 3 (lines the per-call guard prints after the named annotations — rule and reasons are given, carried over verbatim from the old exemption table) and Task 11 (whether `trips.json` has an import-kind label map — a `grep` decides). The migration folder's timestamp is generated by `prisma migrate dev --create-only`.

**Type consistency:** `ShareEntity` (Task 1) feeds `ADAPTERS`, `DERIVE` (Task 4), `keyedDelegate` (Task 2), `shareEntityTypeSchema` (Task 6). `CopyCounts`/`emptyCounts` (Task 1) are what `ShareResult.created` returns (Task 3) and the frontend `ShareCounts` mirrors with `ferryJourneys` (Task 5). `recordEntryNotice` returns `Promise<string>` (Task 3) — Task 9 uses the id, Task 12 ignores it. `copyMissing` returns `CopiedEntry[]` (Task 3) — `shareTrip` counts `!joined`, the backfill counts both. `TripPerson`/`ShareBlock` are identical in `tripPeople.ts` (Task 10) and `types/sharing.ts` (Task 13); `ConsentStatus` comes from `schemas/sharing.ts` (Task 6) on the backend. `ChangeEntry` is exported in Task 13 and imported in Task 17. `useTripSharingStore.bump` (Task 15) is called from Task 16.

**Review focus pins:** (1) Task 10 "lists a member who is no companion…, and marks a member without consent" + Task 15 "shows Zustimmung offen and the hint"; (2) Task 3 "does not join … on the next local day"; (3) Task 13 "shows a preformatted value as given" with an English "Tue, 2 Jun 2026, 09:15"; (4) Task 9 "keeps a partially satisfied update open" + "keeps an edited update whose edit differs"; (5) Task 5 "linking a crossing to a leg of a shared trip copies it without the leg".

**Ordering / shippable main:** Tasks 1–2 and 4 are refactors with unchanged behaviour except the recipient-zone status (a correction). Task 3 changes propagation to join own entries (stated in the spec). Task 5 makes ferry shareable on the backend; the frontend shows crossings behind `ferryDomain` as before. Tasks 6–12 are backend-only. Task 10 adds `people` beside the old fields, so the old panel keeps working until Task 15 replaces it; Task 19 removes the old fields last.
