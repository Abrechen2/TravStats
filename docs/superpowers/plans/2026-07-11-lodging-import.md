# Lodging Import Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lodging bookings importable — Booking.com email/PDF confirmations via a deterministic template parser with an LLM fallback, and one-time CSV migrations (places-only and hotels+stays) — both paths ending in the same editable preview and the same revertible batch commit.

**Architecture:** The existing `DomainImportPanel` shell + `DomainImportAdapter` contract is reused verbatim: lodging plugs in with one adapter file. The backend gets its OWN preview/commit path (`services/lodging/*` + `routes/lodgingImport.ts`) because the existing `services/importPreview.ts` is flight-shaped to the bone (IATA codes, airport timezones, `fromIata`/`toIata` are *required* fields of `PreviewRowInput`, dedupe keyed on normalised flight numbers) — generalising it would mean rewriting it, not extending it. Email/PDF parsing DOES reuse the existing infrastructure: `routes/emailParse.ts` and `routes/pdfParse.ts` already branch on `parsed.domain`, and `.msg`/`.eml`/`.txt` extraction already works via `@kenjiuno/msgreader`. Both import paths converge on one candidate model (`LodgingImportCandidate`), one preview builder, one commit that writes everything under a `LodgingImportBatch` so it can be reverted as a unit. Geocoding never runs during a commit — a throttled background pass fills coordinates afterwards.

**Tech Stack:** Express 4 + TypeScript (strict), Prisma + PostgreSQL, Zod, Jest (backend), React 18 + Vite + TypeScript, Vitest + Testing Library (frontend), react-i18next, Ollama (LLM, optional and never load-bearing).

## Global Constraints

Every task's requirements implicitly include this section. These are copied verbatim from `CLAUDE.md` and the user's global rules.

- **TypeScript `strict: true`.** `any` is **FORBIDDEN** — always use `unknown` + type guards. The only exception is `.d.ts` files.
- **Pino logger only** — no `console.log`. Import: `import logger from '../utils/logger'` (backend). Frontend uses `import { logger } from '../lib/logger'`.
- **Zod is mandatory** for all user input and API requests. Schemas live in `backend/src/schemas/`.
- **Async: always `async/await`, never `.then()`.**
- **Immutability:** spread `{...obj, field: value}`, no in-place mutation.
- **Error handling:** explicit at every level, never swallow silently.
- **`useTranslation` is imported from the project wrapper `'../hooks/useTranslation'`**, never directly from `react-i18next`.
- **Every user-facing string needs a DE *and* an EN value**, added in the same change. DE is primary. **Plurals must carry `{{count}}` inside the string** (e.g. `"{{count}} Nächte"`), never as a bare number concatenated outside it.
- **English code, comments, commit messages, docs.**
- **Prettier: printWidth 100, `singleQuote: false`** (double quotes). ESLint must pass.
- **File size:** 200–400 lines ideal, **800 lines hard maximum**.
- **NEVER touch `backend/VERSION` or `CHANGELOG.md`** — both are owned by the `/deploy` skill on `main`. This is a `dev/hotels` branch.
- **NEVER run `taskkill`.** If a port is busy, ask the user.
- **Prisma migrations always via `npx prisma migrate dev`**, never hand-written SQL.
- **Prisma JSON fields** cast via `as unknown as Prisma.InputJsonValue`.
- **Domain gating:** any new parser target must register in `backend/src/shared/domains.ts` and its frontend mirror `frontend/src/shared/domains.ts`.

## Private fixtures — read this before Task 3

`test-samples/Hotel Buchungen/` holds **7 real booking confirmations belonging to the owner** (6 Booking.com German confirmations, 1 direct hotel booking).

- **They must never be committed, logged, or copied into a deployed instance.** `.gitignore` already covers them (`test-samples/**/*.msg`); do not weaken that, do not `git add -f` them, and never echo a sample's body into a log line or a test failure message.
- They exist only in the owner's **main checkout** (`D:\TravStats_Projekt\TravStats\test-samples\Hotel Buchungen\`). Because they are gitignored, they are **NOT present in the `hotels` worktree**. Before running the Task 3 tests, copy the directory into the worktree once:
  ```bash
  cp -r "D:/TravStats_Projekt/TravStats/test-samples/Hotel Buchungen" \
        "D:/TravStats_Projekt/TravStats/.claude/worktrees/hotels/test-samples/"
  ```
  The copy stays gitignored. It is a local convenience, not a repo change.
- **Tests assert on extracted values, not on the files' contents.** Every suite that reads them must `describe.skip` itself when the directory is absent, so CI and any other machine stay green without the private data.

## File Structure

### Backend — create

| File | Responsibility |
|---|---|
| `backend/src/schemas/lodgingImport.ts` | Zod schemas + inferred types for the shared import-candidate model, preview rows, commit rows. Single source of truth for the wire contract. |
| `backend/src/services/lodging/bookingComTemplate.ts` | Deterministic, offline Booking.com German confirmation parser. No LLM, no network. |
| `backend/src/services/lodging/lodgingBookingParser.ts` | Orchestrator: template first → Ollama fallback → `parserUsed: "none"` (never throws, never blocks). Resolves LLM settings options > admin_settings > env > default. |
| `backend/src/services/lodging/lodgingCandidates.ts` | `ParsedLodgingBooking[]` → `LodgingImportCandidate[]`. |
| `backend/src/services/lodging/lodgingImportPreview.ts` | Dedup + flags + ordering (questionable first) + summary counts. |
| `backend/src/services/lodging/lodgingImportCommit.ts` | Batch creation, per-row isolation, chain find-or-create, FX snapshot, no geocoding. |
| `backend/src/services/lodging/lodgingImportBatches.ts` | List batches; revert (delete) a batch as a unit. |
| `backend/src/services/lodging/geocodeBackfill.ts` | Throttled background pass that fills missing coordinates after a commit. |
| `backend/src/services/lodging/mappingSuggestion.ts` | LLM-suggested CSV column mapping. Returns `{}` on any failure — never in the critical path. |
| `backend/src/routes/lodgingImport.ts` | `POST /preview`, `POST /commit`, `GET /batches`, `DELETE /batches/:id`, `POST /suggest-mapping`. |

### Backend — modify

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | `Lodging.externalRef` + `batchId`, `LodgingStay.externalRef` + `batchId`, new `LodgingImportBatch` model. |
| `backend/src/shared/domains.ts` | `PARSER_SUPPORTED_DOMAINS` gains `'lodging'`. |
| `backend/src/routes/emailParse.ts` | Add the `lodging` branch (both `/parse-email` and `/parse-email-file`). |
| `backend/src/routes/pdfParse.ts` | Add the `lodging` branch. |
| `backend/src/index.ts` | Mount `lodgingImport` router at `/api/v1/lodging-import`. |
| `backend/src/middleware/rateLimit.ts` | Add `lodgingImportLimiter`. |

### Frontend — create

| File | Responsibility |
|---|---|
| `frontend/src/types/lodgingImport.ts` | Mirror of the backend wire types. |
| `frontend/src/lib/api/lodgingImport.ts` | Axios client for the five endpoints. |
| `frontend/src/lib/importers/lodgingCsv.ts` | Field spec + header heuristic + shape detection + candidate builder. Pure, no network. |
| `frontend/src/components/lodging/LodgingImportPreviewModal.tsx` | The one editable preview both paths land in. |
| `frontend/src/components/import/LodgingCsvImportTile.tsx` | CSV tile: file → mapping (LLM-suggested, heuristic fallback) → preview → commit. |
| `frontend/src/components/import/adapters/lodgingAdapter.tsx` | The one adapter file that plugs lodging into `DomainImportPanel`. |

### Frontend — modify

| File | Change |
|---|---|
| `frontend/src/components/import/types.ts` | `ImportDomain` gains `"lodging"`. |
| `frontend/src/components/import/ColumnMappingWizard.tsx` | Generalise: field list, labels, aliases and an optional `initialMapping` come in as props. Flight behaviour unchanged. |
| `frontend/src/components/import/GenericCsvImportTile.tsx` | Pass the flight field spec into the now-generic wizard. |
| `frontend/src/components/import/__tests__/ColumnMappingWizard.test.tsx` *(currently `frontend/src/components/import/ColumnMappingWizard.test.tsx`)* | Update to the new props. |
| `frontend/src/lib/api/parse.ts` | `domain` unions gain `"lodging"`; add `ParseEmailLodgingResult` / `ParsePdfLodgingResult`. |
| `frontend/src/pages/LodgingListPage.tsx` | Mount `DomainImportButton` (email/PDF/manual) + `LodgingCsvImportTile`. |
| `frontend/src/i18n/resources/de/import.json`, `en/import.json` | `lodging.panelTitle` / `panelHint`. |
| `frontend/src/i18n/resources/de/lodging.json`, `en/lodging.json` | The whole `import.*` subtree (preview, wizard fields, batch revert, errors). |

---

## Task 1: Data model — externalRef, batchId, LodgingImportBatch

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `Lodging` ~948-974, `LodgingStay` ~976-1025, `User`)
- Create: `backend/prisma/migrations/<timestamp>_lodging_import/migration.sql` (generated)
- Test: `backend/src/__tests__/lodgingImportSchema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Lodging.externalRef: string | null`, `Lodging.batchId: string | null`, `LodgingStay.externalRef: string | null`, `LodgingStay.batchId: string | null`, and model `LodgingImportBatch { id: string; userId: string; source: string; fileName: string | null; createdAt: Date }`. Unique constraints `Lodging @@unique([userId, externalRef])` and `LodgingStay @@unique([userId, externalRef])`. Prisma client accessor: `prisma.lodgingImportBatch`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingImportSchema.test.ts`:

```ts
import { prisma } from "../db";
import { Prisma } from "@prisma/client";

const USERNAME = "lodging-import-schema-test";

describe("lodging import schema", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, password: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates an import batch and stamps its id on the rows it created", async () => {
    const batch = await prisma.lodgingImportBatch.create({
      data: { userId, source: "csv", fileName: "places.csv" },
    });
    expect(batch.source).toBe("csv");

    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Hotel Batch",
        externalRef: "google:ChIJtest1",
        batchId: batch.id,
      },
    });
    expect(lodging.batchId).toBe(batch.id);
    expect(lodging.externalRef).toBe("google:ChIJtest1");

    const stay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-01-01T00:00:00.000Z"),
        checkOut: new Date("2026-01-03T00:00:00.000Z"),
        externalRef: "booking:1111111111",
        batchId: batch.id,
      },
    });
    expect(stay.batchId).toBe(batch.id);

    await prisma.lodgingStay.deleteMany({ where: { batchId: batch.id } });
    await prisma.lodging.deleteMany({ where: { batchId: batch.id } });
    await prisma.lodgingImportBatch.delete({ where: { id: batch.id } });
  });

  it("rejects a duplicate externalRef for the same user on lodgings", async () => {
    const first = await prisma.lodging.create({
      data: { userId, name: "Dup A", externalRef: "google:ChIJdup" },
    });
    await expect(
      prisma.lodging.create({ data: { userId, name: "Dup B", externalRef: "google:ChIJdup" } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await prisma.lodging.delete({ where: { id: first.id } });
  });

  it("rejects a duplicate externalRef for the same user on stays", async () => {
    const lodging = await prisma.lodging.create({ data: { userId, name: "Stay Host" } });
    const first = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-02-01T00:00:00.000Z"),
        checkOut: new Date("2026-02-02T00:00:00.000Z"),
        externalRef: "booking:2222222222",
      },
    });
    await expect(
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkIn: new Date("2026-03-01T00:00:00.000Z"),
          checkOut: new Date("2026-03-02T00:00:00.000Z"),
          externalRef: "booking:2222222222",
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await prisma.lodgingStay.delete({ where: { id: first.id } });
    await prisma.lodging.delete({ where: { id: lodging.id } });
  });

  it("allows many rows with a NULL externalRef", async () => {
    const a = await prisma.lodging.create({ data: { userId, name: "Null Ref A" } });
    const b = await prisma.lodging.create({ data: { userId, name: "Null Ref B" } });
    expect(a.externalRef).toBeNull();
    expect(b.externalRef).toBeNull();
    await prisma.lodging.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingImportSchema.test.ts --forceExit
```
Expected: FAIL — TypeScript/runtime error `Property 'lodgingImportBatch' does not exist on type 'PrismaClient'` (and `Unknown arg 'externalRef'`).

- [ ] **Step 3: Add the schema changes**

In `backend/prisma/schema.prisma`, inside `model Lodging`, add after the `dataSource` line:

```prisma
  externalRef   String?  @map("external_ref") // e.g. "google:ChIJd8BlQ2Bo5kcRAFTLmuLK8bA"
  batchId       String?  @map("batch_id")
```

and inside the same model's relation/index block:

```prisma
  batch LodgingImportBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)

  @@unique([userId, externalRef])
  @@index([batchId])
```

In `model LodgingStay`, add after the `dataSource` line:

```prisma
  externalRef      String?   @map("external_ref") // e.g. "booking:5087376273"
  batchId          String?   @map("batch_id")
```

and in its relation/index block:

```prisma
  batch LodgingImportBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)

  @@unique([userId, externalRef])
  @@index([batchId])
```

Append the new model after `LodgingMembership`:

```prisma
/// One import run (CSV file, e-mail or PDF). Every row it created carries its
/// id, so a 232-row import that turns out wrong is revertible as a unit.
model LodgingImportBatch {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  source    String   // csv | email | pdf
  fileName  String?  @map("file_name")
  createdAt DateTime @default(now()) @map("created_at")

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  lodgings Lodging[]
  stays    LodgingStay[]

  @@index([userId])
  @@map("lodging_import_batches")
}
```

In `model User`, add to the relation list:

```prisma
  lodgingImportBatches LodgingImportBatch[]
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  npx prisma migrate dev --name lodging_import
```
Expected: a new folder `backend/prisma/migrations/<timestamp>_lodging_import/` containing `ALTER TABLE "lodgings" ADD COLUMN "external_ref"`, `"batch_id"`, the same on `lodging_stays`, `CREATE TABLE "lodging_import_batches"`, and two `CREATE UNIQUE INDEX ... ON ... ("user_id", "external_ref")`.

**If Prisma reports drift and offers to reset the database, STOP and report to the user — do not accept the reset.** The migration must contain ONLY the lodging-import changes above; if it bundles unrelated `ALTER`s, the drift fix has regressed and this task is blocked.

- [ ] **Step 5: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingImportSchema.test.ts --forceExit
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/__tests__/lodgingImportSchema.test.ts
git commit -m "feat(lodging): add externalRef, batchId and LodgingImportBatch"
```

---

## Task 2: Wire contract — Zod schemas and types for the import candidate model

**Files:**
- Create: `backend/src/schemas/lodgingImport.ts`
- Test: `backend/src/__tests__/lodgingImportSchemas.test.ts`

**Interfaces:**
- Consumes: `LODGING_TYPES`, `BOARD_TYPES`, `CURRENCIES` from `backend/src/schemas/lodging.ts`.
- Produces (every later backend AND frontend task consumes these exact names):

```ts
export const IMPORT_SOURCES = ["csv", "email", "pdf"] as const;
export type LodgingImportSource = (typeof IMPORT_SOURCES)[number];

export interface LodgingCandidateFields {
  name: string;
  type?: LodgingTypeValue | null;      // "hotel" | "campsite" | "guesthouse" | "apartment" | "hostel"
  chainName?: string | null;
  stars?: number | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  externalRef?: string | null;         // "google:<place_id>"
  notes?: string | null;
}

export interface StayCandidateFields {
  checkIn: string;                     // "YYYY-MM-DD"
  checkOut: string;                    // "YYYY-MM-DD"
  roomCategory?: string | null;
  board?: BoardValue | null;
  totalPrice?: number | null;
  currency?: CurrencyValue | null;
  ratingRoom?: number | null;
  ratingBreakfast?: number | null;
  ratingOverall?: number | null;
  bookingReference?: string | null;
  externalRef?: string | null;         // "booking:<confirmation no>"
  notes?: string | null;
}

export interface LodgingImportCandidate {
  sourceRowIndex: number;
  /** null on a stays-only row — the stay joins an existing lodging by `lodgingName`. */
  lodging: LodgingCandidateFields | null;
  /** Free-text hotel name used to join a stays-only row. */
  lodgingName?: string | null;
  stay: StayCandidateFields | null;
}

export type LodgingImportFlag =
  | "missing_name"
  | "unresolvable_lodging_name"
  | "ambiguous_lodging_name"
  | "malformed_date"
  | "invalid_date_range"
  | "missing_coordinates";

export type LodgingDedupeHint =
  | "none"
  | "lodging_exact_ref"
  | "lodging_name_city"
  | "stay_exact_ref"
  | "stay_same_dates";

export type LodgingImportAction = "create" | "skip" | "needs_input";

export interface LodgingImportPreviewRow extends LodgingImportCandidate {
  flags: LodgingImportFlag[];
  dedupeHint: LodgingDedupeHint;
  matchedLodgingId: string | null;
  matchedStayId: string | null;
  action: LodgingImportAction;
}

export interface LodgingImportSummary {
  /** rows that will create something */
  newRows: number;
  /** rows already in the DB — skipped */
  alreadyPresent: number;
  /** rows the user must resolve */
  needsInput: number;
}

export interface LodgingImportBatchSummary {
  id: string;
  source: LodgingImportSource;
  fileName: string | null;
  createdAt: string;
  lodgingCount: number;
  stayCount: number;
}

export const MAX_LODGING_IMPORT_ROWS = 1000;

// Zod schemas (exported for the routes):
export const lodgingCandidateFieldsSchema: z.ZodType<LodgingCandidateFields>;
export const stayCandidateFieldsSchema: z.ZodType<StayCandidateFields>;
export const lodgingImportCandidateSchema: z.ZodType<LodgingImportCandidate>;
export const lodgingImportPreviewRequestSchema; // { candidates: LodgingImportCandidate[] }
export const lodgingImportCommitRequestSchema;  // { source, fileName, rows: CommitRowInput[] }
export const suggestMappingRequestSchema;       // { headers: string[], sampleRows: Record<string,string>[] }

export interface CommitRowInput {
  sourceRowIndex: number;
  action: "create" | "skip";
  matchedLodgingId?: string | null;
  lodging: LodgingCandidateFields | null;
  stay: StayCandidateFields | null;
}
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingImportSchemas.test.ts`:

```ts
import {
  lodgingImportCandidateSchema,
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  MAX_LODGING_IMPORT_ROWS,
} from "../schemas/lodgingImport";

describe("lodgingImport schemas", () => {
  it("accepts a places-only candidate (no stay)", () => {
    const parsed = lodgingImportCandidateSchema.parse({
      sourceRowIndex: 0,
      lodging: {
        name: "Hotel Adlon",
        type: "hotel",
        city: "Berlin",
        country: "Deutschland",
        lat: 52.5163,
        lon: 13.3807,
        externalRef: "google:ChIJabc",
      },
      stay: null,
    });
    expect(parsed.lodging?.name).toBe("Hotel Adlon");
    expect(parsed.stay).toBeNull();
  });

  it("accepts a stays-only candidate joined by lodgingName, with no price", () => {
    const parsed = lodgingImportCandidateSchema.parse({
      sourceRowIndex: 3,
      lodging: null,
      lodgingName: "NH Ludwigsburg",
      stay: { checkIn: "2026-03-30", checkOut: "2026-03-31", ratingRoom: 4 },
    });
    expect(parsed.stay?.totalPrice).toBeUndefined();
    expect(parsed.lodgingName).toBe("NH Ludwigsburg");
  });

  it("rejects a stay whose dates are not YYYY-MM-DD", () => {
    const result = lodgingImportCandidateSchema.safeParse({
      sourceRowIndex: 0,
      lodging: null,
      lodgingName: "X",
      stay: { checkIn: "30.03.2026", checkOut: "2026-03-31" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a candidate with neither a lodging nor a lodgingName", () => {
    const result = lodgingImportCandidateSchema.safeParse({
      sourceRowIndex: 0,
      lodging: null,
      stay: { checkIn: "2026-03-30", checkOut: "2026-03-31" },
    });
    expect(result.success).toBe(false);
  });

  it("caps the preview payload at MAX_LODGING_IMPORT_ROWS", () => {
    const candidates = Array.from({ length: MAX_LODGING_IMPORT_ROWS + 1 }, (_, i) => ({
      sourceRowIndex: i,
      lodging: { name: `Hotel ${i}` },
      stay: null,
    }));
    const result = lodgingImportPreviewRequestSchema.safeParse({ candidates });
    expect(result.success).toBe(false);
  });

  it("accepts a commit request with a skip row", () => {
    const parsed = lodgingImportCommitRequestSchema.parse({
      source: "csv",
      fileName: "hotels.csv",
      rows: [
        { sourceRowIndex: 0, action: "skip", lodging: { name: "Dup" }, stay: null },
        {
          sourceRowIndex: 1,
          action: "create",
          matchedLodgingId: null,
          lodging: { name: "New Hotel" },
          stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
        },
      ],
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.source).toBe("csv");
  });

  it("rejects a commit row with action needs_input", () => {
    const result = lodgingImportCommitRequestSchema.safeParse({
      source: "csv",
      fileName: null,
      rows: [{ sourceRowIndex: 0, action: "needs_input", lodging: { name: "X" }, stay: null }],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingImportSchemas.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../schemas/lodgingImport'`.

- [ ] **Step 3: Implement the schemas**

Create `backend/src/schemas/lodgingImport.ts`:

```ts
import { z } from "zod";
import { BOARD_TYPES, CURRENCIES, LODGING_TYPES } from "./lodging";

export const IMPORT_SOURCES = ["csv", "email", "pdf"] as const;
export type LodgingImportSource = (typeof IMPORT_SOURCES)[number];

export const MAX_LODGING_IMPORT_ROWS = 1000;

/** Calendar day only. The DB column is a DateTime, but an import row carries a
 *  hotel-local calendar day — never an instant — so it stays a plain date here
 *  and is widened to UTC midnight exactly once, at commit time. */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const rating = z.number().min(1).max(5).nullable().optional();

export const lodgingCandidateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(LODGING_TYPES).nullable().optional(),
  chainName: z.string().trim().max(120).nullable().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  externalRef: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type LodgingCandidateFields = z.infer<typeof lodgingCandidateFieldsSchema>;

export const stayCandidateFieldsSchema = z.object({
  checkIn: isoDay,
  checkOut: isoDay,
  roomCategory: z.string().max(120).nullable().optional(),
  board: z.enum(BOARD_TYPES).nullable().optional(),
  totalPrice: z.number().min(0).nullable().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  ratingRoom: rating,
  ratingBreakfast: rating,
  ratingOverall: rating,
  bookingReference: z.string().max(40).nullable().optional(),
  externalRef: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type StayCandidateFields = z.infer<typeof stayCandidateFieldsSchema>;

export const lodgingImportCandidateSchema = z
  .object({
    sourceRowIndex: z.number().int().nonnegative(),
    lodging: lodgingCandidateFieldsSchema.nullable(),
    lodgingName: z.string().trim().max(200).nullable().optional(),
    stay: stayCandidateFieldsSchema.nullable(),
  })
  // A row must identify a lodging one way or the other — either it carries the
  // lodging's own fields, or it names one to join against. Neither means the
  // row cannot be attached to anything and would create an orphan stay.
  .refine((c) => c.lodging !== null || !!c.lodgingName, {
    message: "A candidate needs either `lodging` or `lodgingName`",
    path: ["lodgingName"],
  });
export type LodgingImportCandidate = z.infer<typeof lodgingImportCandidateSchema>;

export type LodgingImportFlag =
  | "missing_name"
  | "unresolvable_lodging_name"
  | "ambiguous_lodging_name"
  | "malformed_date"
  | "invalid_date_range"
  | "missing_coordinates";

export type LodgingDedupeHint =
  | "none"
  | "lodging_exact_ref"
  | "lodging_name_city"
  | "stay_exact_ref"
  | "stay_same_dates";

export type LodgingImportAction = "create" | "skip" | "needs_input";

export interface LodgingImportPreviewRow extends LodgingImportCandidate {
  flags: LodgingImportFlag[];
  dedupeHint: LodgingDedupeHint;
  matchedLodgingId: string | null;
  matchedStayId: string | null;
  action: LodgingImportAction;
}

export interface LodgingImportSummary {
  newRows: number;
  alreadyPresent: number;
  needsInput: number;
}

export interface LodgingImportBatchSummary {
  id: string;
  source: LodgingImportSource;
  fileName: string | null;
  createdAt: string;
  lodgingCount: number;
  stayCount: number;
}

export const lodgingImportPreviewRequestSchema = z.object({
  candidates: z.array(lodgingImportCandidateSchema).min(1).max(MAX_LODGING_IMPORT_ROWS),
});

// `needs_input` is deliberately NOT accepted here: the preview may produce it,
// but the user has to resolve it into create/skip before a commit is allowed.
export const commitRowSchema = z.object({
  sourceRowIndex: z.number().int().nonnegative(),
  action: z.enum(["create", "skip"]),
  matchedLodgingId: z.string().uuid().nullable().optional(),
  lodging: lodgingCandidateFieldsSchema.nullable(),
  stay: stayCandidateFieldsSchema.nullable(),
});
export type CommitRowInput = z.infer<typeof commitRowSchema>;

export const lodgingImportCommitRequestSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string().max(260).nullable(),
  rows: z.array(commitRowSchema).min(1).max(MAX_LODGING_IMPORT_ROWS),
});
export type LodgingImportCommitRequest = z.infer<typeof lodgingImportCommitRequestSchema>;

export const suggestMappingRequestSchema = z.object({
  headers: z.array(z.string().max(200)).min(1).max(80),
  sampleRows: z.array(z.record(z.string(), z.string().max(500))).max(5),
});
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingImportSchemas.test.ts --forceExit
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/lodgingImport.ts backend/src/__tests__/lodgingImportSchemas.test.ts
git commit -m "feat(lodging): add import candidate wire contract (Zod)"
```

---

## Task 3: Booking.com template parser — deterministic, offline

**Files:**
- Create: `backend/src/services/lodging/bookingComTemplate.ts`
- Test: `backend/src/__tests__/bookingComTemplate.test.ts`

**Interfaces:**
- Consumes: `CURRENCIES` from `backend/src/schemas/lodging.ts`; `extractEmailFromFile(buffer: Buffer, filename: string): { subject: string; text: string; html?: string }` from `backend/src/services/emailExtractor.ts` (test only).
- Produces:

```ts
export interface ParsedLodgingBooking {
  hotelName: string;
  checkIn: string;                    // "YYYY-MM-DD"
  checkOut: string;                   // "YYYY-MM-DD"
  nights: number;
  roomCategory: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  totalPrice: number | null;
  currency: "EUR" | "USD" | "GBP" | "CHF" | null;
  confirmationNumber: string | null;
  parserTemplate: string;             // "booking.com"
  parserConfidence: number;           // 0-100
  missing: string[];                  // names of critical fields that came back empty
}

export function isBookingComConfirmation(subject: string | undefined, body: string): boolean;
export function parseBookingComEmail(
  subject: string | undefined,
  body: string,
): ParsedLodgingBooking | null;
```

- [ ] **Step 1: Copy the private samples into the worktree (once)**

```bash
cp -r "D:/TravStats_Projekt/TravStats/test-samples/Hotel Buchungen" \
      "D:/TravStats_Projekt/TravStats/.claude/worktrees/hotels/test-samples/"
```
They stay gitignored (`test-samples/**/*.msg`). Never `git add` them.

- [ ] **Step 2: Write the failing test**

Create `backend/src/__tests__/bookingComTemplate.test.ts`:

```ts
import fs from "fs";
import path from "path";
import { extractEmailFromFile } from "../services/emailExtractor";
import {
  isBookingComConfirmation,
  parseBookingComEmail,
  type ParsedLodgingBooking,
} from "../services/lodging/bookingComTemplate";

// The owner's REAL booking confirmations. Gitignored, present only on his
// machine — the suite skips itself everywhere else so CI stays green. We assert
// on EXTRACTED VALUES only; no sample content is ever printed or logged.
const SAMPLE_DIR = path.resolve(__dirname, "../../..", "test-samples", "Hotel Buchungen");
const hasSamples = fs.existsSync(SAMPLE_DIR);
const describeSamples = hasSamples ? describe : describe.skip;

/** Sample filenames carry emoji + umlauts; match on a stable substring instead. */
function loadSample(nameFragment: string): { subject: string; text: string } {
  const file = fs
    .readdirSync(SAMPLE_DIR)
    .find((f) => f.includes(nameFragment) && f.endsWith(".msg"));
  if (!file) throw new Error(`No sample matching "${nameFragment}"`);
  const buffer = fs.readFileSync(path.join(SAMPLE_DIR, file));
  const extracted = extractEmailFromFile(buffer, file);
  return { subject: extracted.subject, text: extracted.text };
}

function parseSample(nameFragment: string): ParsedLodgingBooking {
  const { subject, text } = loadSample(nameFragment);
  const parsed = parseBookingComEmail(subject, text);
  if (!parsed) throw new Error(`Template parser returned null for "${nameFragment}"`);
  return parsed;
}

describeSamples("Booking.com template parser (real samples)", () => {
  it("recognises a Booking.com confirmation and rejects a direct hotel booking", () => {
    const booking = loadSample("Bastion");
    expect(isBookingComConfirmation(booking.subject, booking.text)).toBe(true);

    const direct = loadSample("Novina");
    expect(isBookingComConfirmation(direct.subject, direct.text)).toBe(false);
    expect(parseBookingComEmail(direct.subject, direct.text)).toBeNull();
  });

  it("parses the Bastion Hotel Zoetermeer confirmation (3 nights, NL postcode)", () => {
    const r = parseSample("Bastion");
    expect(r.hotelName).toBe("Bastion Hotel Zoetermeer");
    expect(r.confirmationNumber).toBe("6546766578");
    expect(r.checkIn).toBe("2026-06-04");
    expect(r.checkOut).toBe("2026-06-07");
    expect(r.nights).toBe(3);
    expect(r.roomCategory).toBe("Deluxe Zimmer mit Kingsize-Bett");
    expect(r.address).toBe("Zilverstraat 6");
    expect(r.postcode).toBe("2718 RL");
    expect(r.city).toBe("Zoetermeer");
    expect(r.country).toBe("Niederlande");
    expect(r.totalPrice).toBeCloseTo(451.7, 2);
    expect(r.currency).toBe("EUR");
    expect(r.missing).toEqual([]);
  });

  it("parses the Engimatt confirmation (1 night, CHF, district in the address)", () => {
    const r = parseSample("Engimatt");
    expect(r.hotelName).toBe("Engimatt City & Garden Hotel");
    expect(r.confirmationNumber).toBe("5980532080");
    expect(r.checkIn).toBe("2026-06-30");
    expect(r.checkOut).toBe("2026-07-01");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Comfort Doppelzimmer mit Balkon");
    expect(r.address).toBe("Engimattstrasse 14, Enge");
    expect(r.postcode).toBe("8002");
    expect(r.city).toBe("Zürich");
    expect(r.country).toBe("Schweiz");
    expect(r.totalPrice).toBeCloseTo(292.83, 2);
    expect(r.currency).toBe("CHF");
  });

  it("parses the Hotel Stiegler confirmation (AT)", () => {
    const r = parseSample("Stiegler");
    expect(r.hotelName).toBe("Hotel Stiegler Bed & Breakfast");
    expect(r.confirmationNumber).toBe("5803862656");
    expect(r.checkIn).toBe("2026-07-19");
    expect(r.checkOut).toBe("2026-07-20");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Standard Doppelzimmer");
    expect(r.address).toBe("13 Leidern");
    expect(r.postcode).toBe("4850");
    expect(r.city).toBe("Timelkam");
    expect(r.country).toBe("Österreich");
    expect(r.totalPrice).toBeCloseTo(103.2, 2);
    expect(r.currency).toBe("EUR");
  });

  it("parses the NH Ludwigsburg confirmation (DE)", () => {
    const r = parseSample("NH Ludwigsburg");
    expect(r.hotelName).toBe("NH Ludwigsburg");
    expect(r.confirmationNumber).toBe("5087376273");
    expect(r.checkIn).toBe("2026-03-30");
    expect(r.checkOut).toBe("2026-03-31");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Standard Doppel- oder Zweibettzimmer");
    expect(r.address).toBe("Pflugfelder Straße 36");
    expect(r.postcode).toBe("71636");
    expect(r.city).toBe("Ludwigsburg");
    expect(r.country).toBe("Deutschland");
    expect(r.totalPrice).toBeCloseTo(98.1, 2);
  });

  it("parses the Novotel Suites Berlin confirmation (2 nights, district in the address)", () => {
    const r = parseSample("Novotel");
    expect(r.hotelName).toBe("Novotel Suites Berlin City Potsdamer Platz");
    expect(r.confirmationNumber).toBe("5967563369");
    expect(r.checkIn).toBe("2026-04-22");
    expect(r.checkOut).toBe("2026-04-24");
    expect(r.nights).toBe(2);
    expect(r.roomCategory).toBe("Standard Suite mit 1 Doppelbett und 1 Sofa");
    expect(r.address).toBe("Anhalter Str. 2, Friedrichshain-Kreuzberg");
    expect(r.postcode).toBe("10963");
    expect(r.city).toBe("Berlin");
    expect(r.totalPrice).toBeCloseTo(385.07, 2);
  });

  it("parses the Vienna House confirmation (whole-euro total, no decimals)", () => {
    const r = parseSample("Vienna House");
    expect(r.hotelName).toBe("Vienna House Easy by Wyndham Landsberg");
    expect(r.confirmationNumber).toBe("6220453895");
    expect(r.checkIn).toBe("2025-12-03");
    expect(r.checkOut).toBe("2025-12-04");
    expect(r.nights).toBe(1);
    expect(r.roomCategory).toBe("Comfort Zimmer");
    expect(r.city).toBe("Landsberg am Lech");
    expect(r.totalPrice).toBeCloseTo(112, 2);
    expect(r.currency).toBe("EUR");
  });
});

// These run everywhere — they use synthetic text, not the private samples.
describe("Booking.com template parser (synthetic)", () => {
  const synthetic = [
    "<https://booking.com> \t Bestätigungsnummer: 1234567890",
    "Buchungsinformationen",
    "Anreise\t Montag, 5. Januar 2026 (ab 15:00)\t",
    "Abreise\t Mittwoch, 7. Januar 2026 (bis 11:00)\t",
    "Ihre Buchung\t 2 Nächte, Superior Zimmer\t",
    "Lage\t Musterweg 1, 12345 Musterstadt, Deutschland",
    "Preisangaben",
    "Gesamtpreis",
    "€ 1.234,50",
    "",
  ].join("\n");

  it("parses a synthetic confirmation including a thousands separator", () => {
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", synthetic);
    expect(r?.hotelName).toBe("Musterhotel");
    expect(r?.checkIn).toBe("2026-01-05");
    expect(r?.checkOut).toBe("2026-01-07");
    expect(r?.nights).toBe(2);
    expect(r?.totalPrice).toBeCloseTo(1234.5, 2);
    expect(r?.currency).toBe("EUR");
  });

  it("returns null for text that is not a Booking.com confirmation", () => {
    expect(parseBookingComEmail("Rechnung", "Sehr geehrter Kunde, anbei Ihre Rechnung.")).toBeNull();
  });

  it("reports a missing total price instead of failing", () => {
    const withoutPrice = synthetic.replace("Gesamtpreis\n€ 1.234,50", "");
    const r = parseBookingComEmail("Ihre Buchung ist bestätigt: Musterhotel", withoutPrice);
    expect(r).not.toBeNull();
    expect(r?.totalPrice).toBeNull();
    expect(r?.missing).toContain("totalPrice");
  });
});
```

- [ ] **Step 3: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/bookingComTemplate.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/bookingComTemplate'`.

- [ ] **Step 4: Implement the parser**

Create `backend/src/services/lodging/bookingComTemplate.ts`:

```ts
import { CURRENCIES } from "../../schemas/lodging";

export type LodgingCurrency = (typeof CURRENCIES)[number];

export interface ParsedLodgingBooking {
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomCategory: string | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  totalPrice: number | null;
  currency: LodgingCurrency | null;
  confirmationNumber: string | null;
  parserTemplate: string;
  parserConfidence: number;
  missing: string[];
}

const TEMPLATE_NAME = "booking.com";

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

const CURRENCY_SYMBOLS: Record<string, LodgingCurrency> = {
  "€": "EUR",
  EUR: "EUR",
  CHF: "CHF",
  $: "USD",
  USD: "USD",
  "£": "GBP",
  GBP: "GBP",
};

const CONFIRMATION_RE = /Bestätigungsnummer:\s*‌?\s*(\d{6,})/;

function toLines(body: string): string[] {
  return body.replace(/\r/g, "").split("\n").map((line) => line.trim());
}

/** A Booking.com confirmation always carries the brand link AND a numeric
 *  "Bestätigungsnummer:". A direct hotel booking (the 7th sample) says
 *  "Buchungsnummer" and never links booking.com — it must fall through to the
 *  LLM, not be mangled by this template. */
export function isBookingComConfirmation(subject: string | undefined, body: string): boolean {
  const haystack = `${subject ?? ""}\n${body}`;
  return /booking\.com/i.test(haystack) && CONFIRMATION_RE.test(haystack);
}

function findValue(lines: string[], label: string): string | null {
  const re = new RegExp(`^${label}[\\s\\u00a0]+(.+)$`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** "Donnerstag, 4. Juni 2026 (ab 14:00)" -> "2026-06-04". */
function parseGermanDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/);
  if (!m) return null;
  const month = GERMAN_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "3 Nächte, Deluxe Zimmer mit Kingsize-Bett" / "1 Nacht, Comfort Zimmer". */
function parseBookingLine(value: string | null): { nights: number | null; room: string | null } {
  if (!value) return { nights: null, room: null };
  const m = value.match(/^(\d+)\s+N(?:acht|ächte)\s*,\s*(.+)$/);
  if (!m) return { nights: null, room: null };
  return { nights: Number(m[1]), room: m[2].trim() };
}

interface AddressParts {
  address: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
}

/**
 * "Zilverstraat 6, 2718 RL Zoetermeer, Niederlande"
 * "Anhalter Str. 2, Friedrichshain-Kreuzberg, 10963 Berlin, Deutschland"
 * The last segment is the country; the LAST segment that starts with a postal
 * code carries the city. Everything before it is the street (which may include
 * a district, as in the Berlin sample — preserved rather than dropped).
 */
function parseLage(raw: string | null): AddressParts {
  if (!raw) return { address: null, postcode: null, city: null, country: null };
  const segments = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return { address: null, postcode: null, city: null, country: null };

  const country = segments.length > 1 ? segments[segments.length - 1] : null;
  const rest = country ? segments.slice(0, -1) : segments;

  // NL codes look like "2718 RL"; DE/AT/CH are 4-5 digits.
  const postcodeRe = /^(\d{4,5}(?:\s+[A-Z]{2})?)\s+(.+)$/;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i].match(postcodeRe);
    if (m) {
      const address = rest.slice(0, i).join(", ");
      return {
        address: address.length > 0 ? address : null,
        postcode: m[1],
        city: m[2],
        country,
      };
    }
  }
  return {
    address: rest.slice(0, -1).join(", ") || null,
    postcode: null,
    city: rest[rest.length - 1] ?? null,
    country,
  };
}

/** "€ 1.234,50" -> 1234.5 · "CHF 292,83" -> 292.83 · "€ 112" -> 112. */
function parseAmount(line: string): { amount: number; currency: LodgingCurrency } | null {
  const m = line.match(/^(€|CHF|EUR|USD|GBP|\$|£)\s*([\d.,]+)$/);
  if (!m) return null;
  const currency = CURRENCY_SYMBOLS[m[1]];
  if (!currency) return null;
  const numeric = Number(m[2].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  return { amount: numeric, currency };
}

/**
 * The literal word "Gesamtpreis" also appears mid-sentence in the cancellation
 * prose ("… des Gesamtpreises …"), so we anchor on a line that is EXACTLY
 * "Gesamtpreis" and take the next non-empty line as the amount.
 */
function findTotal(lines: string[]): { amount: number; currency: LodgingCurrency } | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "Gesamtpreis") continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (lines[j] === "") continue;
      const parsed = parseAmount(lines[j]);
      if (parsed) return parsed;
      break;
    }
  }
  return null;
}

/** Subject: "🛄 Danke! Ihre Buchung ist bestätigt: NH Ludwigsburg". */
function hotelNameFromSubject(subject: string | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(/bestätigt:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Fallback: the first non-empty line after the property's booking.com link. */
function hotelNameFromBody(lines: string[]): string | null {
  const linkIndex = lines.findIndex((l) => /booking\.com\/hotel\//i.test(l));
  if (linkIndex < 0) return null;
  for (let i = linkIndex + 1; i < Math.min(linkIndex + 5, lines.length); i++) {
    if (lines[i].length > 0) return lines[i];
  }
  return null;
}

export function parseBookingComEmail(
  subject: string | undefined,
  body: string,
): ParsedLodgingBooking | null {
  if (!isBookingComConfirmation(subject, body)) return null;

  const lines = toLines(body);
  const hotelName = hotelNameFromSubject(subject) ?? hotelNameFromBody(lines);
  if (!hotelName) return null;

  const checkIn = parseGermanDate(findValue(lines, "Anreise"));
  const checkOut = parseGermanDate(findValue(lines, "Abreise"));
  if (!checkIn || !checkOut) return null;

  const { nights, room } = parseBookingLine(findValue(lines, "Ihre Buchung"));
  const lage = parseLage(findValue(lines, "Lage"));
  const total = findTotal(lines);
  const confirmation = `${subject ?? ""}\n${body}`.match(CONFIRMATION_RE);

  const nightsFromDates = Math.max(
    0,
    Math.round(
      (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) /
        (24 * 60 * 60 * 1000),
    ),
  );

  const missing: string[] = [];
  if (!room) missing.push("roomCategory");
  if (!lage.city) missing.push("city");
  if (!total) missing.push("totalPrice");
  if (!confirmation) missing.push("confirmationNumber");

  return {
    hotelName,
    checkIn,
    checkOut,
    // The printed night count is authoritative; the date delta is the fallback.
    nights: nights ?? nightsFromDates,
    roomCategory: room,
    address: lage.address,
    postcode: lage.postcode,
    city: lage.city,
    country: lage.country,
    totalPrice: total?.amount ?? null,
    currency: total?.currency ?? null,
    confirmationNumber: confirmation ? confirmation[1] : null,
    parserTemplate: TEMPLATE_NAME,
    parserConfidence: missing.length === 0 ? 95 : 80,
    missing,
  };
}
```

- [ ] **Step 5: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/bookingComTemplate.test.ts --forceExit
```
Expected: PASS — 10 tests (7 sample tests + 3 synthetic). If the samples were not copied in Step 1, the 7 sample tests report as *skipped* and the 3 synthetic ones pass; that is a valid CI outcome but **not** an acceptable local outcome for this task — copy the samples and see all 10 green before committing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/lodging/bookingComTemplate.ts backend/src/__tests__/bookingComTemplate.test.ts
git commit -m "feat(lodging): add deterministic Booking.com confirmation parser"
```
Verify with `git status` that **no `.msg` file is staged**.

---

## Task 4: Parser orchestrator — template first, LLM fallback, never blocks

**Files:**
- Create: `backend/src/services/lodging/lodgingBookingParser.ts`
- Create: `backend/src/services/lodging/lodgingCandidates.ts`
- Test: `backend/src/__tests__/lodgingBookingParser.test.ts`

**Interfaces:**
- Consumes: `parseBookingComEmail`, `isBookingComConfirmation`, `ParsedLodgingBooking` (Task 3); `getAdminParserSettings(): Promise<{ ollamaUrl?: string | null; ollamaModel?: string | null } | null>` from `backend/src/services/parserSettings.ts`; `LodgingImportCandidate` (Task 2).
- Produces:

```ts
export interface LodgingBookingParserOptions { url?: string; model?: string }
export type LodgingParserUsed = "template" | "ollama" | "none";
export interface LodgingParseResult {
  bookings: ParsedLodgingBooking[];
  parserUsed: LodgingParserUsed;
  ollamaAvailable: boolean;
  /** Set only when parserUsed === "none" — the UI shows manual entry with whatever fields it has. */
  fallbackReason?: string;
}
export async function parseLodgingBookingText(
  text: string,
  options?: LodgingBookingParserOptions,
): Promise<LodgingParseResult>;

// lodgingCandidates.ts
export function bookingsToCandidates(bookings: ParsedLodgingBooking[]): LodgingImportCandidate[];
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingBookingParser.test.ts`:

```ts
import { parseLodgingBookingText } from "../services/lodging/lodgingBookingParser";
import { bookingsToCandidates } from "../services/lodging/lodgingCandidates";
import type { ParsedLodgingBooking } from "../services/lodging/bookingComTemplate";

jest.mock("../services/parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: null })),
}));

const BOOKING_COM_TEXT = [
  "<https://booking.com> \t Bestätigungsnummer: 1234567890",
  "Anreise\t Montag, 5. Januar 2026 (ab 15:00)",
  "Abreise\t Mittwoch, 7. Januar 2026 (bis 11:00)",
  "Ihre Buchung\t 2 Nächte, Superior Zimmer",
  "Lage\t Musterweg 1, 12345 Musterstadt, Deutschland",
  "Gesamtpreis",
  "€ 250,00",
].join("\n");

describe("parseLodgingBookingText", () => {
  it("uses the template for a Booking.com confirmation and never calls the LLM", async () => {
    const result = await parseLodgingBookingText(
      `Ihre Buchung ist bestätigt: Musterhotel\n\n${BOOKING_COM_TEXT}`,
      // A deliberately unreachable Ollama: if the template path is taken, this
      // is never dialled, so the call must still succeed fast.
      { url: "http://127.0.0.1:1", model: "nonexistent" },
    );
    expect(result.parserUsed).toBe("template");
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].hotelName).toBe("Musterhotel");
    expect(result.bookings[0].totalPrice).toBeCloseTo(250, 2);
  });

  it("never throws when the LLM is unreachable — it reports parserUsed 'none'", async () => {
    const result = await parseLodgingBookingText("Buchungsnummer: 260308233983\nAnreise\nAbreise", {
      url: "http://127.0.0.1:1",
      model: "nonexistent",
    });
    expect(result.parserUsed).toBe("none");
    expect(result.bookings).toEqual([]);
    expect(result.ollamaAvailable).toBe(false);
    expect(typeof result.fallbackReason).toBe("string");
  });
});

describe("bookingsToCandidates", () => {
  const booking: ParsedLodgingBooking = {
    hotelName: "Musterhotel",
    checkIn: "2026-01-05",
    checkOut: "2026-01-07",
    nights: 2,
    roomCategory: "Superior Zimmer",
    address: "Musterweg 1",
    postcode: "12345",
    city: "Musterstadt",
    country: "Deutschland",
    totalPrice: 250,
    currency: "EUR",
    confirmationNumber: "1234567890",
    parserTemplate: "booking.com",
    parserConfidence: 95,
    missing: [],
  };

  it("maps a parsed booking to one candidate carrying both externalRefs", () => {
    const [candidate] = bookingsToCandidates([booking]);
    expect(candidate.sourceRowIndex).toBe(0);
    expect(candidate.lodging?.name).toBe("Musterhotel");
    expect(candidate.lodging?.type).toBe("hotel");
    expect(candidate.lodging?.city).toBe("Musterstadt");
    expect(candidate.lodging?.externalRef).toBeNull();
    expect(candidate.stay?.checkIn).toBe("2026-01-05");
    expect(candidate.stay?.checkOut).toBe("2026-01-07");
    expect(candidate.stay?.totalPrice).toBe(250);
    expect(candidate.stay?.currency).toBe("EUR");
    expect(candidate.stay?.externalRef).toBe("booking:1234567890");
    expect(candidate.stay?.bookingReference).toBe("1234567890");
  });

  it("omits the stay externalRef when there is no confirmation number", () => {
    const [candidate] = bookingsToCandidates([{ ...booking, confirmationNumber: null }]);
    expect(candidate.stay?.externalRef).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingBookingParser.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/lodgingBookingParser'`.

- [ ] **Step 3: Implement the orchestrator**

Create `backend/src/services/lodging/lodgingBookingParser.ts`:

```ts
import http from "http";
import https from "https";
import logger from "../../utils/logger";
import { getAdminParserSettings } from "../parserSettings";
import { CURRENCIES, LODGING_TYPES } from "../../schemas/lodging";
import {
  isBookingComConfirmation,
  parseBookingComEmail,
  type LodgingCurrency,
  type ParsedLodgingBooking,
} from "./bookingComTemplate";

export interface LodgingBookingParserOptions {
  url?: string;
  model?: string;
}

export type LodgingParserUsed = "template" | "ollama" | "none";

export interface LodgingParseResult {
  bookings: ParsedLodgingBooking[];
  parserUsed: LodgingParserUsed;
  ollamaAvailable: boolean;
  fallbackReason?: string;
}

const OLLAMA_TIMEOUT_MS = 120_000;
const AVAILABILITY_TIMEOUT_MS = 5_000;

const SYSTEM_PROMPT = `You extract structured data from hotel booking confirmations (German or English).

Return ONLY this JSON, with no prose before or after: {"bookings":[ BOOKING ]}.
There is almost always exactly ONE booking — return a single-element array.

Copy every value VERBATIM from the document. If a value is not in the text, use null. NEVER output placeholder strings like "Hotel Name", "City", "string".

A BOOKING object has these fields:
- hotelName: the property's name, e.g. "Novina Sleep Inn Herzogenaurach".
- checkIn, checkOut: ISO "YYYY-MM-DD". German "04.06.2026" or "4. Juni 2026" -> "2026-06-04".
- nights: number of nights as an integer.
- roomCategory: the room type as printed, e.g. "Deluxe Zimmer mit Kingsize-Bett".
- address: street and house number only.
- postcode, city, country: as printed.
- totalPrice: the total price as a number ("€ 1.234,50" -> 1234.50).
- currency: 3-letter ISO code; "€" -> "EUR", "CHF" -> "CHF".
- confirmationNumber: the booking/confirmation number as printed, digits only.

EXAMPLE OUTPUT:
{"bookings":[{"hotelName":"Novina Sleep Inn Herzogenaurach","checkIn":"2026-03-08","checkOut":"2026-03-09","nights":1,"roomCategory":"Doppelzimmer","address":"Beethovenstraße 4","postcode":"91074","city":"Herzogenaurach","country":"Deutschland","totalPrice":89.00,"currency":"EUR","confirmationNumber":"260308233983"}]}`;

function postJson(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.setTimeout(OLLAMA_TIMEOUT_MS, () =>
      req.destroy(new Error(`Ollama request timeout after ${OLLAMA_TIMEOUT_MS}ms`)),
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "GET",
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.setTimeout(AVAILABILITY_TIMEOUT_MS, () =>
      req.destroy(new Error("Ollama availability check timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Merge explicit options over admin_settings over env over the localhost
 * default — the exact precedence the cruise parser uses
 * (`resolveCruiseParserOptions`). A correctly configured remote Ollama must
 * never be bypassed in favour of localhost.
 */
async function resolveOptions(
  options?: LodgingBookingParserOptions,
): Promise<Required<LodgingBookingParserOptions>> {
  let adminUrl: string | undefined;
  let adminModel: string | undefined;
  if (!options?.url || !options?.model) {
    try {
      const admin = await getAdminParserSettings();
      adminUrl = admin?.ollamaUrl ?? undefined;
      adminModel = admin?.ollamaModel ?? undefined;
    } catch (err) {
      logger.warn({ err }, "[Lodging Parser] Failed to load admin parser settings");
    }
  }
  return {
    url: options?.url ?? adminUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: options?.model ?? adminModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b",
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value
      .replace(/[^\d.,-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asCurrency(value: unknown): LodgingCurrency | null {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value)
    ? (value as LodgingCurrency)
    : null;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBooking(raw: Record<string, unknown>): ParsedLodgingBooking | null {
  const hotelName = asString(raw.hotelName);
  const checkIn = asString(raw.checkIn);
  const checkOut = asString(raw.checkOut);
  // Without a name and a usable date range there is nothing to build a stay
  // from — drop the entry rather than emit a half-row the preview cannot show.
  if (!hotelName || !checkIn || !checkOut) return null;
  if (!ISO_DAY_RE.test(checkIn) || !ISO_DAY_RE.test(checkOut)) return null;

  const nightsRaw = asNumber(raw.nights);
  const nightsFromDates = Math.max(
    0,
    Math.round(
      (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const totalPrice = asNumber(raw.totalPrice);
  const city = asString(raw.city);
  const roomCategory = asString(raw.roomCategory);
  const confirmationNumber = asString(raw.confirmationNumber);

  const missing: string[] = [];
  if (!roomCategory) missing.push("roomCategory");
  if (!city) missing.push("city");
  if (totalPrice === null) missing.push("totalPrice");
  if (!confirmationNumber) missing.push("confirmationNumber");

  return {
    hotelName,
    checkIn,
    checkOut,
    nights: nightsRaw !== null && nightsRaw > 0 ? Math.floor(nightsRaw) : nightsFromDates,
    roomCategory,
    address: asString(raw.address),
    postcode: asString(raw.postcode),
    city,
    country: asString(raw.country),
    totalPrice,
    currency: asCurrency(raw.currency),
    confirmationNumber,
    parserTemplate: "ollama-lodging",
    parserConfidence: 70,
    missing,
  };
}

function unwrapBookings(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;
  for (const key of ["bookings", "data", "result", "results", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if ("hotelName" in obj || "checkIn" in obj) return [obj];
  return [];
}

async function checkAvailability(url: string): Promise<boolean> {
  try {
    const res = await getText(`${url}/api/tags`);
    const parsed: unknown = JSON.parse(res);
    return typeof parsed === "object" && parsed !== null && "models" in parsed;
  } catch {
    return false;
  }
}

async function parseWithOllama(
  text: string,
  url: string,
  model: string,
): Promise<ParsedLodgingBooking[]> {
  const snippet = text.slice(0, 12_000);
  const body = JSON.stringify({
    model,
    system: SYSTEM_PROMPT,
    prompt: `Extract every hotel booking from this confirmation. Output JSON in the shape shown in the EXAMPLE OUTPUT block. If you cannot find a value, use null.\n\nDOCUMENT:\n${snippet}`,
    stream: false,
    think: false,
    format: "json",
    options: { temperature: 0, num_ctx: 8192 },
  });

  const raw = await postJson(`${url}/api/generate`, body);
  const response: unknown = JSON.parse(raw);
  if (typeof response !== "object" || response === null || !("response" in response)) {
    throw new Error("Invalid Ollama response structure");
  }
  const responseText = (response as Record<string, unknown>).response;
  if (typeof responseText !== "string") throw new Error("Ollama response.response is not a string");

  const cleaned = responseText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();

  const parsed: unknown = JSON.parse(cleaned);
  return unwrapBookings(parsed)
    .map((entry) => normalizeBooking((entry ?? {}) as Record<string, unknown>))
    .filter((b): b is ParsedLodgingBooking => b !== null);
}

/**
 * Template first, LLM only as a fallback, and NEVER a dead end: every failure
 * path resolves to `{ bookings: [], parserUsed: "none" }` so the caller can
 * drop the user into manual entry with whatever it has. The owner's LLM runs
 * on weak hardware and has timed out in production — no lodging import may
 * depend on it.
 */
export async function parseLodgingBookingText(
  text: string,
  options?: LodgingBookingParserOptions,
): Promise<LodgingParseResult> {
  const templateHit = isBookingComConfirmation(undefined, text)
    ? parseBookingComEmail(firstLineAsSubject(text), text)
    : null;
  if (templateHit) {
    logger.info(
      { template: templateHit.parserTemplate, confidence: templateHit.parserConfidence },
      "[Lodging Parser] Template match",
    );
    return { bookings: [templateHit], parserUsed: "template", ollamaAvailable: false };
  }

  const { url, model } = await resolveOptions(options);
  const ollamaAvailable = await checkAvailability(url);
  if (!ollamaAvailable) {
    logger.warn({ url }, "[Lodging Parser] Ollama unavailable — falling back to manual entry");
    return {
      bookings: [],
      parserUsed: "none",
      ollamaAvailable: false,
      fallbackReason: `Ollama is not reachable at ${url}`,
    };
  }

  try {
    const bookings = await parseWithOllama(text, url, model);
    if (bookings.length === 0) {
      return {
        bookings: [],
        parserUsed: "none",
        ollamaAvailable: true,
        fallbackReason: "The parser found no booking in this document",
      };
    }
    return { bookings, parserUsed: "ollama", ollamaAvailable: true };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), model },
      "[Lodging Parser] Ollama parse failed — falling back to manual entry",
    );
    return {
      bookings: [],
      parserUsed: "none",
      ollamaAvailable: true,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The email routes hand us `subject + "\n\n" + body`, so the template's
 * subject-based hotel-name extraction still works when we re-split here.
 */
function firstLineAsSubject(text: string): string | undefined {
  const first = text.split("\n", 1)[0];
  return first && first.trim().length > 0 ? first.trim() : undefined;
}

export const LODGING_DEFAULT_TYPE = LODGING_TYPES[0]; // "hotel"
```

Create `backend/src/services/lodging/lodgingCandidates.ts`:

```ts
import type { LodgingImportCandidate } from "../../schemas/lodgingImport";
import type { ParsedLodgingBooking } from "./bookingComTemplate";

/** Join the street with the postcode so the geocoder has a full address line. */
function composeAddress(booking: ParsedLodgingBooking): string | null {
  const parts = [booking.address, booking.postcode].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * A parsed confirmation always yields BOTH a lodging and its stay: the hotel is
 * the place, the confirmation is the visit. `externalRef` on the stay makes a
 * re-upload of the same e-mail a provable no-op; the lodging has no proven id
 * from an e-mail, so it falls back to name+city matching in the preview.
 */
export function bookingsToCandidates(bookings: ParsedLodgingBooking[]): LodgingImportCandidate[] {
  return bookings.map((booking, index) => ({
    sourceRowIndex: index,
    lodging: {
      name: booking.hotelName,
      type: "hotel" as const,
      chainName: null,
      stars: null,
      address: composeAddress(booking),
      city: booking.city,
      country: booking.country,
      lat: null,
      lon: null,
      externalRef: null,
      notes: null,
    },
    lodgingName: booking.hotelName,
    stay: {
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      roomCategory: booking.roomCategory,
      board: null,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      ratingRoom: null,
      ratingBreakfast: null,
      ratingOverall: null,
      bookingReference: booking.confirmationNumber,
      externalRef: booking.confirmationNumber ? `booking:${booking.confirmationNumber}` : null,
      notes: null,
    },
  }));
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingBookingParser.test.ts --forceExit
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/lodgingBookingParser.ts backend/src/services/lodging/lodgingCandidates.ts backend/src/__tests__/lodgingBookingParser.test.ts
git commit -m "feat(lodging): add booking parser orchestrator with non-blocking LLM fallback"
```

---

## Task 5: Wire the `lodging` branch into the e-mail and PDF parse routes

**Files:**
- Modify: `backend/src/shared/domains.ts:68`
- Modify: `frontend/src/shared/domains.ts` (mirror — update its `PARSER_SUPPORTED_DOMAINS` twin if one exists)
- Modify: `backend/src/routes/emailParse.ts` (both handlers)
- Modify: `backend/src/routes/pdfParse.ts:69`
- Test: `backend/src/__tests__/lodgingParseRoutes.test.ts`

**Interfaces:**
- Consumes: `parseLodgingBookingText` (Task 4), `bookingsToCandidates` (Task 4).
- Produces: the wire shape all three routes return for `domain: "lodging"`. The frontend `parse.ts` client (Task 12) mirrors it exactly:

```ts
{
  domain: "lodging",
  candidates: LodgingImportCandidate[],
  parserUsed: "template" | "ollama" | "none",
  ollamaAvailable: boolean,
  fallbackReason?: string,
  subject?: string,
  text?: string,
  html?: string,           // /parse-email-file only
  pdfTextLength?: number,  // /parse-pdf only
}
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingParseRoutes.test.ts`:

```ts
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

jest.mock("../services/lodging/lodgingBookingParser", () => ({
  parseLodgingBookingText: jest.fn(async () => ({
    bookings: [
      {
        hotelName: "Musterhotel",
        checkIn: "2026-01-05",
        checkOut: "2026-01-07",
        nights: 2,
        roomCategory: "Superior Zimmer",
        address: "Musterweg 1",
        postcode: "12345",
        city: "Musterstadt",
        country: "Deutschland",
        totalPrice: 250,
        currency: "EUR",
        confirmationNumber: "1234567890",
        parserTemplate: "booking.com",
        parserConfidence: 95,
        missing: [],
      },
    ],
    parserUsed: "template",
    ollamaAvailable: false,
  })),
}));

describe("POST /api/v1/parse-email (domain=lodging)", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-parse-route-test", password: await hashPassword("pw123456") },
    });
    userId = user.id;
    token = generateToken(user.id);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns lodging candidates for domain=lodging", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", [`token=${token}`])
      .send({
        emailContent: "Bestätigungsnummer: 1234567890",
        subject: "Ihre Buchung ist bestätigt: Musterhotel",
        domain: "lodging",
      });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("lodging");
    expect(res.body.parserUsed).toBe("template");
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].lodging.name).toBe("Musterhotel");
    expect(res.body.candidates[0].stay.externalRef).toBe("booking:1234567890");
  });

  it("still accepts domain=flight (regression)", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", [`token=${token}`])
      .send({ emailContent: "no flights here", domain: "flight" });
    expect(res.status).toBeLessThan(500);
    expect(res.body.domain).not.toBe("lodging");
  });
});
```

> The auth helpers (`hashPassword`, `generateToken`) and the `token=` cookie name are the ones already used by `backend/src/__tests__/flights.test.ts` — copy the exact import paths from there if they differ on this branch.

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingParseRoutes.test.ts --forceExit
```
Expected: FAIL — the lodging request comes back `400 Validation failed`, because `PARSER_SUPPORTED_DOMAINS` does not contain `'lodging'` and the Zod enum rejects it.

- [ ] **Step 3: Register the domain**

In `backend/src/shared/domains.ts`, replace line 68:

```ts
export const PARSER_SUPPORTED_DOMAINS = [
  'flight',
  'cruise',
  'lodging',
] as const satisfies readonly DomainKey[];
```

and delete the now-stale comment inside the `lodging` descriptor (`// parserSupported stays false until Phase B adds the lodging parser.`).

Check `frontend/src/shared/domains.ts` for a mirrored `PARSER_SUPPORTED_DOMAINS` constant and apply the same change there if it exists.

- [ ] **Step 4: Add the lodging branch to `routes/emailParse.ts`**

Add the imports next to the cruise ones:

```ts
import { parseLodgingBookingText } from '../services/lodging/lodgingBookingParser';
import { bookingsToCandidates } from '../services/lodging/lodgingCandidates';
```

In the `/parse-email` handler, immediately after the existing `if (parsed.domain === 'cruise') { … }` block:

```ts
    if (parsed.domain === 'lodging') {
      const combined = subject ? `${subject}\n\n${emailContent}` : emailContent;
      const lodgingResult = await parseLodgingBookingText(combined);
      return res.json({
        domain: 'lodging',
        candidates: bookingsToCandidates(lodgingResult.bookings),
        parserUsed: lodgingResult.parserUsed,
        ollamaAvailable: lodgingResult.ollamaAvailable,
        fallbackReason: lodgingResult.fallbackReason,
        text: emailContent,
        subject: subject ?? undefined,
      });
    }
```

In the `/parse-email-file` handler, immediately after the existing `if (domainValue === 'cruise') { … }` block:

```ts
      if (domainValue === 'lodging') {
        const combined = extracted.subject
          ? `${extracted.subject}\n\n${extracted.text}`
          : extracted.text;
        const lodgingResult = await parseLodgingBookingText(combined);

        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.debug({ filePath }, '[Email Parse File] Temporary file deleted');
        }

        return res.json({
          domain: 'lodging',
          candidates: bookingsToCandidates(lodgingResult.bookings),
          parserUsed: lodgingResult.parserUsed,
          ollamaAvailable: lodgingResult.ollamaAvailable,
          fallbackReason: lodgingResult.fallbackReason,
          subject: extracted.subject,
          text: extracted.text,
          html: extracted.html ?? undefined,
        });
      }
```

- [ ] **Step 5: Add the lodging branch to `routes/pdfParse.ts`**

Add the same two imports, then insert immediately after the existing `if (parsed.domain === 'cruise') { … }` block:

```ts
    if (parsed.domain === 'lodging') {
      const lodgingResult = await parseLodgingBookingText(pdfText);
      return res.json({
        domain: 'lodging',
        candidates: bookingsToCandidates(lodgingResult.bookings),
        parserUsed: lodgingResult.parserUsed,
        ollamaAvailable: lodgingResult.ollamaAvailable,
        fallbackReason: lodgingResult.fallbackReason,
        pdfTextLength: pdfText.length,
      });
    }
```

- [ ] **Step 6: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingParseRoutes.test.ts --forceExit && npx tsc --noEmit
```
Expected: PASS (2 tests) and a clean `tsc`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/shared/domains.ts frontend/src/shared/domains.ts backend/src/routes/emailParse.ts backend/src/routes/pdfParse.ts backend/src/__tests__/lodgingParseRoutes.test.ts
git commit -m "feat(lodging): parse lodging bookings from email and PDF"
```

---

## Task 6: Preview service — dedup, flags, questionable-first ordering

**Files:**
- Create: `backend/src/services/lodging/lodgingImportPreview.ts`
- Test: `backend/src/__tests__/lodgingImportPreview.test.ts`

**Interfaces:**
- Consumes: `LodgingImportCandidate`, `LodgingImportPreviewRow`, `LodgingImportSummary`, `LodgingImportFlag`, `LodgingDedupeHint`, `LodgingImportAction` (Task 2); `prisma` from `backend/src/db.ts`.
- Produces:

```ts
export function normalizeLodgingName(name: string): string;
export async function buildLodgingPreviewRows(
  userId: string,
  candidates: LodgingImportCandidate[],
): Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }>;
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingImportPreview.test.ts`:

```ts
import { prisma } from "../db";
import {
  buildLodgingPreviewRows,
  normalizeLodgingName,
} from "../services/lodging/lodgingImportPreview";
import type { LodgingImportCandidate } from "../schemas/lodgingImport";

describe("buildLodgingPreviewRows", () => {
  let userId: string;
  let existingId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-import-preview-test", password: "x" },
    });
    userId = user.id;
    const existing = await prisma.lodging.create({
      data: {
        userId,
        name: "NH Ludwigsburg",
        city: "Ludwigsburg",
        externalRef: "google:ChIJexisting",
      },
    });
    existingId = existing.id;
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: existing.id,
        checkIn: new Date("2026-03-30T00:00:00.000Z"),
        checkOut: new Date("2026-03-31T00:00:00.000Z"),
        externalRef: "booking:5087376273",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("normalizes names for matching", () => {
    expect(normalizeLodgingName("NH  Ludwigsburg!")).toBe("nh ludwigsburg");
  });

  it("skips a row whose lodging externalRef already exists (re-import is a no-op)", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "NH Ludwigsburg", externalRef: "google:ChIJexisting", city: "Ludwigsburg" },
        stay: null,
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].dedupeHint).toBe("lodging_exact_ref");
    expect(rows[0].action).toBe("skip");
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(summary).toEqual({ newRows: 0, alreadyPresent: 1, needsInput: 0 });
  });

  it("skips a row whose stay externalRef already exists", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "NH Ludwigsburg", city: "Ludwigsburg" },
        lodgingName: "NH Ludwigsburg",
        stay: { checkIn: "2026-03-30", checkOut: "2026-03-31", externalRef: "booking:5087376273" },
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].dedupeHint).toBe("stay_exact_ref");
    expect(rows[0].action).toBe("skip");
    expect(summary.alreadyPresent).toBe(1);
  });

  it("flags a name+city match for confirmation instead of silently skipping", async () => {
    const candidates: LodgingImportCandidate[] = [
      { sourceRowIndex: 0, lodging: { name: "nh ludwigsburg", city: "LUDWIGSBURG" }, stay: null },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].dedupeHint).toBe("lodging_name_city");
    expect(rows[0].action).toBe("needs_input");
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(summary.needsInput).toBe(1);
  });

  it("resolves a stays-only row against an existing lodging by name", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: null,
        lodgingName: "NH Ludwigsburg",
        stay: { checkIn: "2027-01-01", checkOut: "2027-01-03", ratingRoom: 4 },
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].matchedLodgingId).toBe(existingId);
    expect(rows[0].flags).toEqual([]);
    expect(rows[0].action).toBe("create");
    expect(summary.newRows).toBe(1);
  });

  it("flags an unresolvable hotel name rather than creating an orphan", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: null,
        lodgingName: "Hotel Does Not Exist",
        stay: { checkIn: "2027-01-01", checkOut: "2027-01-03" },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].flags).toContain("unresolvable_lodging_name");
    expect(rows[0].action).toBe("needs_input");
    expect(rows[0].matchedLodgingId).toBeNull();
  });

  it("resolves a stays-only row against a lodging created earlier in the SAME payload", async () => {
    const candidates: LodgingImportCandidate[] = [
      { sourceRowIndex: 0, lodging: { name: "Brand New Hotel" }, stay: null },
      {
        sourceRowIndex: 1,
        lodging: null,
        lodgingName: "brand new hotel",
        stay: { checkIn: "2027-05-01", checkOut: "2027-05-02" },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    const stayRow = rows.find((r) => r.sourceRowIndex === 1);
    expect(stayRow?.flags).not.toContain("unresolvable_lodging_name");
    expect(stayRow?.action).toBe("create");
  });

  it("accepts a row without coordinates and only marks it informationally", async () => {
    const candidates: LodgingImportCandidate[] = [
      { sourceRowIndex: 0, lodging: { name: "No Coords Hotel", city: "Nowhere" }, stay: null },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].flags).toEqual(["missing_coordinates"]);
    expect(rows[0].action).toBe("create");
    expect(summary.newRows).toBe(1);
    expect(summary.needsInput).toBe(0);
  });

  it("flags an inverted date range", async () => {
    const candidates: LodgingImportCandidate[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "Inverted Hotel", lat: 1, lon: 2 },
        stay: { checkIn: "2027-01-05", checkOut: "2027-01-01" },
      },
    ];
    const { rows } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows[0].flags).toContain("invalid_date_range");
    expect(rows[0].action).toBe("needs_input");
  });

  it("sorts questionable rows to the top, keeping source order within each group", async () => {
    const candidates: LodgingImportCandidate[] = [
      { sourceRowIndex: 0, lodging: { name: "Fresh A", lat: 1, lon: 2 }, stay: null },
      {
        sourceRowIndex: 1,
        lodging: null,
        lodgingName: "Nope Hotel",
        stay: { checkIn: "2027-01-01", checkOut: "2027-01-02" },
      },
      { sourceRowIndex: 2, lodging: { name: "Fresh B", lat: 3, lon: 4 }, stay: null },
      {
        sourceRowIndex: 3,
        lodging: { name: "NH Ludwigsburg", externalRef: "google:ChIJexisting" },
        stay: null,
      },
    ];
    const { rows, summary } = await buildLodgingPreviewRows(userId, candidates);
    expect(rows.map((r) => r.sourceRowIndex)).toEqual([1, 0, 2, 3]);
    expect(summary).toEqual({ newRows: 2, alreadyPresent: 1, needsInput: 1 });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingImportPreview.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/lodgingImportPreview'`.

- [ ] **Step 3: Implement the preview builder**

Create `backend/src/services/lodging/lodgingImportPreview.ts`:

```ts
import { prisma } from "../../db";
import logger from "../../utils/logger";
import type {
  LodgingDedupeHint,
  LodgingImportAction,
  LodgingImportCandidate,
  LodgingImportFlag,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../schemas/lodgingImport";

/** Case/punctuation-insensitive key for name matching. */
export function normalizeLodgingName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCity(city: string | null | undefined): string {
  return city ? normalizeLodgingName(city) : "";
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ExistingLodging {
  id: string;
  name: string;
  city: string | null;
  externalRef: string | null;
}

interface ExistingStay {
  id: string;
  lodgingId: string;
  externalRef: string | null;
  checkIn: Date;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface RowVerdict {
  flags: LodgingImportFlag[];
  dedupeHint: LodgingDedupeHint;
  matchedLodgingId: string | null;
  matchedStayId: string | null;
  action: LodgingImportAction;
}

interface Indexes {
  byExternalRef: Map<string, ExistingLodging>;
  byNameCity: Map<string, ExistingLodging[]>;
  byName: Map<string, ExistingLodging[]>;
  payloadNames: Set<string>;
  staysByExternalRef: Map<string, ExistingStay>;
  staysByLodging: Map<string, ExistingStay[]>;
}

/**
 * Classify one candidate. The rules, in the order they bind:
 *
 * 1. `externalRef` is a PROVEN identity — an exact hit is a safe, silent skip.
 *    That is what makes re-importing the same file or e-mail a no-op instead of
 *    232 duplicates.
 * 2. A name+city hit is a GUESS. It is surfaced for confirmation
 *    (`needs_input`), never skipped behind the user's back.
 * 3. A stays-only row that resolves to no lodging is `needs_input` — never an
 *    orphan stay.
 * 4. Missing coordinates is informational ONLY. The row commits; it just has no
 *    map pin. Nominatim's 1 req/s makes geocode-on-commit a ~4-minute stall on
 *    232 rows, so it happens in the background afterwards.
 */
function classify(candidate: LodgingImportCandidate, idx: Indexes): RowVerdict {
  const flags: LodgingImportFlag[] = [];
  let dedupeHint: LodgingDedupeHint = "none";
  let matchedLodgingId: string | null = null;
  let matchedStayId: string | null = null;

  const lodging = candidate.lodging;
  const joinName = candidate.lodgingName ?? lodging?.name ?? null;

  if (!lodging && !joinName) flags.push("missing_name");

  if (lodging?.externalRef) {
    const hit = idx.byExternalRef.get(lodging.externalRef);
    if (hit) {
      dedupeHint = "lodging_exact_ref";
      matchedLodgingId = hit.id;
    }
  }

  if (!matchedLodgingId && lodging) {
    const key = `${normalizeLodgingName(lodging.name)}|${normalizeCity(lodging.city)}`;
    const hits = idx.byNameCity.get(key) ?? [];
    if (hits.length === 1) {
      dedupeHint = "lodging_name_city";
      matchedLodgingId = hits[0].id;
    } else if (hits.length > 1) {
      dedupeHint = "lodging_name_city";
      flags.push("ambiguous_lodging_name");
    }
  }

  if (!lodging && joinName) {
    const hits = idx.byName.get(normalizeLodgingName(joinName)) ?? [];
    if (hits.length === 1) {
      matchedLodgingId = hits[0].id;
    } else if (hits.length > 1) {
      flags.push("ambiguous_lodging_name");
    } else if (!idx.payloadNames.has(normalizeLodgingName(joinName))) {
      // Neither in the DB nor created by an earlier row of this same import.
      flags.push("unresolvable_lodging_name");
    }
  }

  if (lodging && (lodging.lat == null || lodging.lon == null)) {
    flags.push("missing_coordinates");
  }

  const stay = candidate.stay;
  if (stay) {
    if (!ISO_DAY_RE.test(stay.checkIn) || !ISO_DAY_RE.test(stay.checkOut)) {
      flags.push("malformed_date");
    } else if (Date.parse(stay.checkOut) < Date.parse(stay.checkIn)) {
      flags.push("invalid_date_range");
    }

    if (stay.externalRef) {
      const hit = idx.staysByExternalRef.get(stay.externalRef);
      if (hit) {
        dedupeHint = "stay_exact_ref";
        matchedStayId = hit.id;
        matchedLodgingId = matchedLodgingId ?? hit.lodgingId;
      }
    }

    if (!matchedStayId && matchedLodgingId) {
      const existing = idx.staysByLodging.get(matchedLodgingId) ?? [];
      const sameDay = existing.find((s) => dayKey(s.checkIn) === stay.checkIn);
      if (sameDay) {
        dedupeHint = "stay_same_dates";
        matchedStayId = sameDay.id;
      }
    }
  }

  // `missing_coordinates` never blocks — a pin-less lodging is valid data.
  const blocking = flags.filter((f) => f !== "missing_coordinates");
  let action: LodgingImportAction;
  if (blocking.length > 0) {
    action = "needs_input";
  } else if (dedupeHint === "lodging_name_city" || dedupeHint === "stay_same_dates") {
    action = "needs_input";
  } else if (dedupeHint === "stay_exact_ref") {
    action = "skip";
  } else if (dedupeHint === "lodging_exact_ref" && !stay) {
    action = "skip";
  } else {
    action = "create";
  }

  return { flags, dedupeHint, matchedLodgingId, matchedStayId, action };
}

const ACTION_RANK: Record<LodgingImportAction, number> = {
  needs_input: 0,
  create: 1,
  skip: 2,
};

export async function buildLodgingPreviewRows(
  userId: string,
  candidates: LodgingImportCandidate[],
): Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }> {
  const [lodgings, stays] = await Promise.all([
    prisma.lodging.findMany({
      where: { userId },
      select: { id: true, name: true, city: true, externalRef: true },
    }),
    prisma.lodgingStay.findMany({
      where: { userId },
      select: { id: true, lodgingId: true, externalRef: true, checkIn: true },
    }),
  ]);

  const byExternalRef = new Map<string, ExistingLodging>();
  const byNameCity = new Map<string, ExistingLodging[]>();
  const byName = new Map<string, ExistingLodging[]>();
  for (const l of lodgings) {
    if (l.externalRef) byExternalRef.set(l.externalRef, l);
    const nameKey = normalizeLodgingName(l.name);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), l]);
    const cityKey = `${nameKey}|${normalizeCity(l.city)}`;
    byNameCity.set(cityKey, [...(byNameCity.get(cityKey) ?? []), l]);
  }

  const staysByExternalRef = new Map<string, ExistingStay>();
  const staysByLodging = new Map<string, ExistingStay[]>();
  for (const s of stays) {
    if (s.externalRef) staysByExternalRef.set(s.externalRef, s);
    staysByLodging.set(s.lodgingId, [...(staysByLodging.get(s.lodgingId) ?? []), s]);
  }

  // Lodgings THIS payload will create — a stays-only row may legitimately point
  // at one of them (the "both" CSV shape).
  const payloadNames = new Set<string>();
  for (const c of candidates) {
    if (c.lodging) payloadNames.add(normalizeLodgingName(c.lodging.name));
  }

  const idx: Indexes = {
    byExternalRef,
    byNameCity,
    byName,
    payloadNames,
    staysByExternalRef,
    staysByLodging,
  };

  const rows: LodgingImportPreviewRow[] = candidates.map((candidate) => ({
    ...candidate,
    ...classify(candidate, idx),
  }));

  // Questionable rows first (spec §3.1), stable within each group so the user
  // can still follow the source file's order.
  const sorted = [...rows].sort((a, b) => {
    const rank = ACTION_RANK[a.action] - ACTION_RANK[b.action];
    return rank !== 0 ? rank : a.sourceRowIndex - b.sourceRowIndex;
  });

  const summary: LodgingImportSummary = {
    newRows: sorted.filter((r) => r.action === "create").length,
    alreadyPresent: sorted.filter((r) => r.action === "skip").length,
    needsInput: sorted.filter((r) => r.action === "needs_input").length,
  };

  logger.info(
    { operation: "lodging_import_preview", userId, ...summary },
    "Lodging import preview built",
  );

  return { rows: sorted, summary };
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingImportPreview.test.ts --forceExit
```
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/lodgingImportPreview.ts backend/src/__tests__/lodgingImportPreview.test.ts
git commit -m "feat(lodging): add import preview with dedup and questionable-first ordering"
```

---

## Task 7: Commit service — one batch, per-row isolation, no geocoding

**Files:**
- Create: `backend/src/services/lodging/lodgingImportCommit.ts`
- Test: `backend/src/__tests__/lodgingImportCommit.test.ts`

**Interfaces:**
- Consumes: `CommitRowInput`, `LodgingCandidateFields`, `StayCandidateFields`, `LodgingImportSource` (Task 2); `normalizeLodgingName` (Task 6); `applyFxSnapshot(input: { totalPrice?: number | null; currency?: string | null; checkIn: string | Date }, baseCurrency: string): Promise<FxSnapshotOutcome>` and `getBaseCurrency(userId: string): Promise<string>` — **both are already exported from `backend/src/routes/lodging.ts`** and are imported from there (no refactor; do not duplicate the FX logic).
- Produces:

```ts
export interface CommitResult {
  batchId: string;
  createdLodgings: number;
  createdStays: number;
  skipped: number;
  failed: { sourceRowIndex: number; error: string }[];
}
export async function commitLodgingImport(
  userId: string,
  source: LodgingImportSource,
  fileName: string | null,
  rows: CommitRowInput[],
): Promise<CommitResult>;
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingImportCommit.test.ts`:

```ts
import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import type { CommitRowInput } from "../schemas/lodgingImport";

// FX reaches out to Frankfurter — stub it so the suite is offline and
// deterministic. A missing price must still be a normal, non-error outcome.
jest.mock("../services/fx/frankfurter", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
  })),
  getRate: jest.fn(async () => 1),
}));

// Geocoding must NOT run during a commit.
const geocodeSpy = jest.fn(async () => null);
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: () => geocodeSpy(),
  resolveCoordinates: () => geocodeSpy(),
}));

describe("commitLodgingImport", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-import-commit-test", password: "x" },
    });
    userId = user.id;
  });

  beforeEach(() => {
    geocodeSpy.mockClear();
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.lodgingChain.deleteMany({ where: { name: "NH Hotels", isUserAdded: true } });
    await prisma.$disconnect();
  });

  it("writes lodgings and stays under one batch and never geocodes", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: {
          name: "Hotel Commit A",
          type: "hotel",
          chainName: "NH Hotels",
          city: "Berlin",
          country: "Deutschland",
          address: "Anhalter Str. 2",
          externalRef: "google:ChIJcommitA",
        },
        stay: {
          checkIn: "2026-04-22",
          checkOut: "2026-04-24",
          totalPrice: 385.07,
          currency: "EUR",
          externalRef: "booking:5967563369",
        },
      },
      { sourceRowIndex: 1, action: "skip", lodging: { name: "Skipped" }, stay: null },
    ];

    const result = await commitLodgingImport(userId, "email", "confirmation.msg", rows);

    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toEqual([]);
    expect(geocodeSpy).not.toHaveBeenCalled();

    const batch = await prisma.lodgingImportBatch.findUnique({ where: { id: result.batchId } });
    expect(batch?.source).toBe("email");
    expect(batch?.fileName).toBe("confirmation.msg");

    const lodging = await prisma.lodging.findFirst({ where: { batchId: result.batchId } });
    expect(lodging?.dataSource).toBe("import");
    expect(lodging?.lat).toBeNull();
    expect(lodging?.chainId).not.toBeNull();

    const stay = await prisma.lodgingStay.findFirst({ where: { batchId: result.batchId } });
    expect(stay?.totalPriceBase).toBeCloseTo(385.07, 2);
    expect(stay?.checkIn.toISOString()).toBe("2026-04-22T00:00:00.000Z");
  });

  it("commits a priceless stay without an FX snapshot — that is not an error", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Hotel No Price" },
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-02", ratingRoom: 4, ratingBreakfast: 3 },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "stays.csv", rows);
    expect(result.failed).toEqual([]);
    expect(result.createdStays).toBe(1);

    const stay = await prisma.lodgingStay.findFirst({ where: { batchId: result.batchId } });
    expect(stay?.totalPrice).toBeNull();
    expect(stay?.totalPriceBase).toBeNull();
    expect(stay?.fxRate).toBeNull();
    expect(stay?.ratingRoom).toBe(4);
  });

  it("attaches a stay to an existing lodging via matchedLodgingId", async () => {
    const host = await prisma.lodging.create({ data: { userId, name: "Existing Host" } });
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        matchedLodgingId: host.id,
        lodging: null,
        stay: { checkIn: "2026-06-01", checkOut: "2026-06-02" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "stays.csv", rows);
    expect(result.createdLodgings).toBe(0);
    expect(result.createdStays).toBe(1);

    const stay = await prisma.lodgingStay.findFirst({ where: { batchId: result.batchId } });
    expect(stay?.lodgingId).toBe(host.id);
  });

  it("treats a duplicate externalRef as skipped, not failed (re-import is a no-op)", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Rerun Hotel", externalRef: "google:ChIJrerun" },
        stay: null,
      },
    ];
    const first = await commitLodgingImport(userId, "csv", "places.csv", rows);
    expect(first.createdLodgings).toBe(1);

    const second = await commitLodgingImport(userId, "csv", "places.csv", rows);
    expect(second.createdLodgings).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.failed).toEqual([]);

    const all = await prisma.lodging.findMany({ where: { userId, name: "Rerun Hotel" } });
    expect(all).toHaveLength(1);
  });

  it("isolates a failing row — the rest of the batch still commits", async () => {
    const rows: CommitRowInput[] = [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Good Row" }, stay: null },
      {
        sourceRowIndex: 1,
        action: "create",
        matchedLodgingId: "00000000-0000-0000-0000-000000000000",
        lodging: null,
        stay: { checkIn: "2026-07-01", checkOut: "2026-07-02" },
      },
      { sourceRowIndex: 2, action: "create", lodging: { name: "Also Good" }, stay: null },
    ];
    const result = await commitLodgingImport(userId, "csv", "mixed.csv", rows);
    expect(result.createdLodgings).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].sourceRowIndex).toBe(1);
  });

  it("reuses a lodging created earlier in the same batch for a later row with the same name", async () => {
    const rows: CommitRowInput[] = [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Same Batch Hotel" }, stay: null },
      {
        sourceRowIndex: 1,
        action: "create",
        lodging: { name: "Same Batch Hotel" },
        stay: { checkIn: "2026-08-01", checkOut: "2026-08-02" },
      },
    ];
    const result = await commitLodgingImport(userId, "csv", "both.csv", rows);
    expect(result.createdLodgings).toBe(1);
    expect(result.createdStays).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingImportCommit.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/lodgingImportCommit'`.

- [ ] **Step 3: Implement the commit service**

Create `backend/src/services/lodging/lodgingImportCommit.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { applyFxSnapshot, getBaseCurrency } from "../../routes/lodging";
import type {
  CommitRowInput,
  LodgingCandidateFields,
  LodgingImportSource,
  StayCandidateFields,
} from "../../schemas/lodgingImport";
import { normalizeLodgingName } from "./lodgingImportPreview";

export interface CommitResult {
  batchId: string;
  createdLodgings: number;
  createdStays: number;
  skipped: number;
  failed: { sourceRowIndex: number; error: string }[];
}

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
}

/** A hotel-local calendar day widened to the UTC-midnight instant the column stores. */
function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Find-or-create a chain by name. `isUserAdded` marks it as not seeded. */
async function resolveChainId(chainName: string | null | undefined): Promise<number | null> {
  const name = chainName?.trim();
  if (!name) return null;
  const existing = await prisma.lodgingChain.findUnique({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.lodgingChain.create({ data: { name, isUserAdded: true } });
  return created.id;
}

async function createLodging(
  userId: string,
  batchId: string,
  fields: LodgingCandidateFields,
): Promise<string> {
  const chainId = await resolveChainId(fields.chainName);
  const lodging = await prisma.lodging.create({
    data: {
      userId,
      batchId,
      name: fields.name,
      type: fields.type ?? "hotel",
      chainId,
      stars: fields.stars ?? null,
      address: fields.address ?? null,
      city: fields.city ?? null,
      country: fields.country ?? null,
      // NO geocoding here (spec §3.1). Coordinates the source carried are used
      // as-is; missing ones are filled later by the throttled background pass.
      lat: fields.lat ?? null,
      lon: fields.lon ?? null,
      notes: fields.notes ?? null,
      externalRef: fields.externalRef ?? null,
      dataSource: "import",
    },
  });
  return lodging.id;
}

async function createStay(
  userId: string,
  batchId: string,
  lodgingId: string,
  fields: StayCandidateFields,
  baseCurrency: string,
): Promise<void> {
  const checkIn = toDate(fields.checkIn);
  const currency = fields.currency ?? "EUR";

  // A stay with no price simply has no FX snapshot. Alex's 380 stays carry no
  // price at all — that is correct data, not an error.
  const fxOutcome =
    fields.totalPrice != null
      ? await applyFxSnapshot({ totalPrice: fields.totalPrice, currency, checkIn }, baseCurrency)
      : null;
  const fx =
    fxOutcome?.status === "snapshotted"
      ? fxOutcome.fields
      : { totalPriceBase: null, fxRate: null, fxRateDate: null, fxBaseCurrency: null };

  await prisma.lodgingStay.create({
    data: {
      userId,
      batchId,
      lodgingId,
      checkIn,
      checkOut: toDate(fields.checkOut),
      status: "completed",
      roomCategory: fields.roomCategory ?? null,
      board: fields.board ?? null,
      totalPrice: fields.totalPrice ?? null,
      currency,
      ...fx,
      ratingRoom: fields.ratingRoom ?? null,
      ratingBreakfast: fields.ratingBreakfast ?? null,
      ratingOverall: fields.ratingOverall ?? null,
      bookingReference: fields.bookingReference ?? null,
      externalRef: fields.externalRef ?? null,
      notes: fields.notes ?? null,
      dataSource: "import",
    },
  });
}

/**
 * Commit an import as one revertible batch.
 *
 * - Every row is written in its own try/catch: **a failed row never fails the
 *   batch** (spec §5). Failures come back with their source row index.
 * - A unique-constraint hit on `externalRef` is a SKIP, not a failure — that is
 *   exactly what makes re-importing the same file a no-op.
 * - No geocoding runs here. See `geocodeBackfill.ts`.
 */
export async function commitLodgingImport(
  userId: string,
  source: LodgingImportSource,
  fileName: string | null,
  rows: CommitRowInput[],
): Promise<CommitResult> {
  const batch = await prisma.lodgingImportBatch.create({ data: { userId, source, fileName } });
  const baseCurrency = await getBaseCurrency(userId);

  // Lodgings created by THIS run, so a later row naming the same hotel attaches
  // to it instead of creating a second copy.
  const createdByName = new Map<string, string>();

  let createdLodgings = 0;
  let createdStays = 0;
  let skipped = 0;
  const failed: { sourceRowIndex: number; error: string }[] = [];

  for (const row of rows) {
    if (row.action === "skip") {
      skipped++;
      continue;
    }

    try {
      let lodgingId = row.matchedLodgingId ?? null;

      if (!lodgingId && row.lodging) {
        const nameKey = normalizeLodgingName(row.lodging.name);
        const already = createdByName.get(nameKey);
        if (already) {
          lodgingId = already;
        } else {
          try {
            lodgingId = await createLodging(userId, batch.id, row.lodging);
            createdByName.set(nameKey, lodgingId);
            createdLodgings++;
          } catch (err) {
            if (!isUniqueViolation(err) || !row.lodging.externalRef) throw err;
            // Someone (or an earlier run) already owns this externalRef: the row
            // is a duplicate, which is a skip, not a failure.
            const existing = await prisma.lodging.findFirst({
              where: { userId, externalRef: row.lodging.externalRef },
              select: { id: true },
            });
            if (!existing) throw err;
            lodgingId = existing.id;
            createdByName.set(nameKey, existing.id);
            skipped++;
            if (!row.stay) continue;
          }
        }
      }

      if (!lodgingId) {
        throw new Error("Row has neither a lodging to create nor a lodging to attach to");
      }

      if (row.stay) {
        try {
          await createStay(userId, batch.id, lodgingId, row.stay, baseCurrency);
          createdStays++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          skipped++;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          operation: "lodging_import_row_failed",
          userId,
          sourceRowIndex: row.sourceRowIndex,
          message,
        },
        "Lodging import row failed — batch continues",
      );
      failed.push({ sourceRowIndex: row.sourceRowIndex, error: message });
    }
  }

  logger.info(
    {
      operation: "lodging_import_commit",
      userId,
      batchId: batch.id,
      source,
      createdLodgings,
      createdStays,
      skipped,
      failedCount: failed.length,
    },
    "Lodging import committed",
  );

  return { batchId: batch.id, createdLodgings, createdStays, skipped, failed };
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingImportCommit.test.ts --forceExit
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/lodgingImportCommit.ts backend/src/__tests__/lodgingImportCommit.test.ts
git commit -m "feat(lodging): commit an import as one revertible batch"
```

---

## Task 8: Batches — list and revert

**Files:**
- Create: `backend/src/services/lodging/lodgingImportBatches.ts`
- Test: `backend/src/__tests__/lodgingImportBatches.test.ts`

**Interfaces:**
- Consumes: `LodgingImportBatchSummary`, `IMPORT_SOURCES`, `LodgingImportSource` (Task 2); `commitLodgingImport` (Task 7, test only); `AppError` from `backend/src/middleware/errorHandler.ts`.
- Produces:

```ts
export async function listLodgingImportBatches(userId: string): Promise<LodgingImportBatchSummary[]>;
export interface RevertResult { deletedLodgings: number; deletedStays: number }
/** Throws `AppError("Import batch not found", 404)` when the batch is not this user's. */
export async function revertLodgingImportBatch(
  userId: string,
  batchId: string,
): Promise<RevertResult>;
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingImportBatches.test.ts`:

```ts
import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import {
  listLodgingImportBatches,
  revertLodgingImportBatch,
} from "../services/lodging/lodgingImportBatches";
import type { CommitRowInput } from "../schemas/lodgingImport";

jest.mock("../services/fx/frankfurter", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
  })),
  getRate: jest.fn(async () => 1),
}));

describe("lodging import batches", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-import-batches-test", password: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("lists batches with their row counts", async () => {
    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Batch List Hotel" },
        stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
      },
    ];
    const { batchId } = await commitLodgingImport(userId, "csv", "list.csv", rows);

    const batches = await listLodgingImportBatches(userId);
    const found = batches.find((b) => b.id === batchId);
    expect(found).toBeDefined();
    expect(found?.source).toBe("csv");
    expect(found?.fileName).toBe("list.csv");
    expect(found?.lodgingCount).toBe(1);
    expect(found?.stayCount).toBe(1);
  });

  it("reverts a batch: its rows are gone, pre-existing rows survive", async () => {
    const preExisting = await prisma.lodging.create({ data: { userId, name: "Survivor Hotel" } });

    const rows: CommitRowInput[] = [
      {
        sourceRowIndex: 0,
        action: "create",
        lodging: { name: "Revert Me Hotel" },
        stay: { checkIn: "2026-02-01", checkOut: "2026-02-03" },
      },
      {
        // a stay added to a lodging that already existed BEFORE the import:
        // the stay must go, the lodging must stay.
        sourceRowIndex: 1,
        action: "create",
        matchedLodgingId: preExisting.id,
        lodging: null,
        stay: { checkIn: "2026-02-10", checkOut: "2026-02-11" },
      },
    ];
    const { batchId } = await commitLodgingImport(userId, "csv", "revert.csv", rows);

    const result = await revertLodgingImportBatch(userId, batchId);
    expect(result.deletedLodgings).toBe(1);
    expect(result.deletedStays).toBe(2);

    expect(
      await prisma.lodging.findFirst({ where: { userId, name: "Revert Me Hotel" } }),
    ).toBeNull();
    expect(await prisma.lodging.findUnique({ where: { id: preExisting.id } })).not.toBeNull();
    expect(await prisma.lodgingStay.count({ where: { lodgingId: preExisting.id } })).toBe(0);
    expect(await prisma.lodgingImportBatch.findUnique({ where: { id: batchId } })).toBeNull();

    await prisma.lodging.delete({ where: { id: preExisting.id } });
  });

  it("refuses to revert another user's batch", async () => {
    const other = await prisma.user.create({
      data: { username: "lodging-import-batches-other", password: "x" },
    });
    const { batchId } = await commitLodgingImport(other.id, "csv", "theirs.csv", [
      { sourceRowIndex: 0, action: "create", lodging: { name: "Theirs" }, stay: null },
    ]);

    await expect(revertLodgingImportBatch(userId, batchId)).rejects.toThrow(
      "Import batch not found",
    );
    expect(await prisma.lodgingImportBatch.findUnique({ where: { id: batchId } })).not.toBeNull();

    await prisma.user.delete({ where: { id: other.id } });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingImportBatches.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/lodgingImportBatches'`.

- [ ] **Step 3: Implement it**

Create `backend/src/services/lodging/lodgingImportBatches.ts`:

```ts
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
import {
  IMPORT_SOURCES,
  type LodgingImportBatchSummary,
  type LodgingImportSource,
} from "../../schemas/lodgingImport";

/** The column is a plain String; narrow it back to the union on the way out. */
function asSource(value: string): LodgingImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value)
    ? (value as LodgingImportSource)
    : "csv";
}

export async function listLodgingImportBatches(
  userId: string,
): Promise<LodgingImportBatchSummary[]> {
  const batches = await prisma.lodgingImportBatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { lodgings: true, stays: true } } },
  });

  return batches.map((b) => ({
    id: b.id,
    source: asSource(b.source),
    fileName: b.fileName,
    createdAt: b.createdAt.toISOString(),
    lodgingCount: b._count.lodgings,
    stayCount: b._count.stays,
  }));
}

export interface RevertResult {
  deletedLodgings: number;
  deletedStays: number;
}

/**
 * Revert an import as a unit (spec §5). Deletes the stays and lodgings the batch
 * CREATED — a stay the batch added to a lodging the user already had is removed,
 * but that lodging is not (its `batchId` is null).
 *
 * One transaction, stays first: they FK the lodgings, and deleting the lodgings
 * first would cascade the stays away before `deleteMany` could count them.
 */
export async function revertLodgingImportBatch(
  userId: string,
  batchId: string,
): Promise<RevertResult> {
  const batch = await prisma.lodgingImportBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new AppError("Import batch not found", 404);

  const [stays, lodgings] = await prisma.$transaction([
    prisma.lodgingStay.deleteMany({ where: { userId, batchId } }),
    prisma.lodging.deleteMany({ where: { userId, batchId } }),
    prisma.lodgingImportBatch.delete({ where: { id: batchId } }),
  ]);

  logger.info(
    {
      operation: "lodging_import_revert",
      userId,
      batchId,
      deletedStays: stays.count,
      deletedLodgings: lodgings.count,
    },
    "Lodging import batch reverted",
  );

  return { deletedLodgings: lodgings.count, deletedStays: stays.count };
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingImportBatches.test.ts --forceExit
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/lodgingImportBatches.ts backend/src/__tests__/lodgingImportBatches.test.ts
git commit -m "feat(lodging): list and revert import batches"
```

---

## Task 9: Background geocode backfill

**Files:**
- Create: `backend/src/services/lodging/geocodeBackfill.ts`
- Test: `backend/src/__tests__/lodgingGeocodeBackfill.test.ts`

**Interfaces:**
- Consumes: `geocodeAddress(parts: { address?: string | null; city?: string | null; country?: string | null }): Promise<{ lat: number; lon: number } | null>` from `backend/src/services/geo/nominatim.ts` (already throttled to 1 req/s process-wide and never throws).
- Produces:

```ts
export const MAX_BACKFILL_ROWS = 500;
export interface BackfillResult { attempted: number; filled: number }
/** Never throws. Awaitable in tests, fire-and-forget in the route. */
export async function backfillMissingCoordinates(
  userId: string,
  batchId?: string,
): Promise<BackfillResult>;
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingGeocodeBackfill.test.ts`:

```ts
import { prisma } from "../db";
import { backfillMissingCoordinates } from "../services/lodging/geocodeBackfill";

const geocodeAddress = jest.fn();
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: (parts: unknown) => geocodeAddress(parts),
}));

describe("backfillMissingCoordinates", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-geocode-backfill-test", password: "x" },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    geocodeAddress.mockReset();
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("fills coordinates only for rows that lack them and have address material", async () => {
    geocodeAddress.mockResolvedValue({ lat: 52.5, lon: 13.4 });

    const needsCoords = await prisma.lodging.create({
      data: { userId, name: "Needs Coords", city: "Berlin", country: "Deutschland" },
    });
    const hasCoords = await prisma.lodging.create({
      data: { userId, name: "Has Coords", city: "Berlin", lat: 1, lon: 2 },
    });
    const noAddress = await prisma.lodging.create({ data: { userId, name: "No Address" } });

    const result = await backfillMissingCoordinates(userId);

    expect(result.attempted).toBe(1);
    expect(result.filled).toBe(1);
    expect(geocodeAddress).toHaveBeenCalledTimes(1);

    expect((await prisma.lodging.findUnique({ where: { id: needsCoords.id } }))?.lat).toBeCloseTo(
      52.5,
      3,
    );
    expect((await prisma.lodging.findUnique({ where: { id: hasCoords.id } }))?.lat).toBeCloseTo(
      1,
      3,
    );
    expect((await prisma.lodging.findUnique({ where: { id: noAddress.id } }))?.lat).toBeNull();
  });

  it("leaves a row pin-less when the geocoder finds nothing — and never throws", async () => {
    geocodeAddress.mockResolvedValue(null);
    const row = await prisma.lodging.create({
      data: { userId, name: "Unfindable", city: "Atlantis" },
    });

    const result = await backfillMissingCoordinates(userId);

    expect(result.attempted).toBe(1);
    expect(result.filled).toBe(0);
    expect((await prisma.lodging.findUnique({ where: { id: row.id } }))?.lat).toBeNull();
  });

  it("swallows a geocoder throw and keeps going with the next row", async () => {
    geocodeAddress
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ lat: 48.1, lon: 11.6 });

    await prisma.lodging.create({ data: { userId, name: "A Boom", city: "Boomtown" } });
    await prisma.lodging.create({ data: { userId, name: "B Fine", city: "München" } });

    const result = await backfillMissingCoordinates(userId);

    expect(result.attempted).toBe(2);
    expect(result.filled).toBe(1);
  });

  it("scopes to a single batch when a batchId is given", async () => {
    geocodeAddress.mockResolvedValue({ lat: 10, lon: 20 });
    const batch = await prisma.lodgingImportBatch.create({
      data: { userId, source: "csv", fileName: "b.csv" },
    });
    await prisma.lodging.create({
      data: { userId, name: "In Batch", city: "Rome", batchId: batch.id },
    });
    await prisma.lodging.create({ data: { userId, name: "Out Of Batch", city: "Paris" } });

    const result = await backfillMissingCoordinates(userId, batch.id);

    expect(result.attempted).toBe(1);
    expect((await prisma.lodging.findFirst({ where: { userId, name: "Out Of Batch" } }))?.lat).toBeNull();

    await prisma.lodging.deleteMany({ where: { batchId: batch.id } });
    await prisma.lodgingImportBatch.delete({ where: { id: batch.id } });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingGeocodeBackfill.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/geocodeBackfill'`.

- [ ] **Step 3: Implement it**

Create `backend/src/services/lodging/geocodeBackfill.ts`:

```ts
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { geocodeAddress } from "../geo/nominatim";

/** A guardrail, not a policy: a single pass never walks more than this many rows. */
export const MAX_BACKFILL_ROWS = 500;

export interface BackfillResult {
  attempted: number;
  filled: number;
}

/**
 * Fill in coordinates for lodgings that have none, AFTER the import has already
 * committed (spec §3.1). Nominatim allows 1 req/s, so 232 rows would stall a
 * commit for ~4 minutes — unacceptable. A row without coordinates is valid data;
 * it simply has no map pin until this pass reaches it.
 *
 * `geocodeAddress` is already serialized + throttled process-wide, so this loop
 * must stay sequential — firing them in parallel would only queue behind the
 * same 1 req/s chain while holding N promises open.
 *
 * Never throws: it is fire-and-forget from the commit route.
 */
export async function backfillMissingCoordinates(
  userId: string,
  batchId?: string,
): Promise<BackfillResult> {
  let attempted = 0;
  let filled = 0;

  try {
    const rows = await prisma.lodging.findMany({
      where: {
        userId,
        ...(batchId ? { batchId } : {}),
        OR: [{ lat: null }, { lon: null }],
        // Nothing to geocode without at least a city or an address.
        NOT: [{ city: null, address: null }],
      },
      select: { id: true, address: true, city: true, country: true },
      orderBy: { createdAt: "asc" },
      take: MAX_BACKFILL_ROWS,
    });

    for (const row of rows) {
      attempted++;
      try {
        const coords = await geocodeAddress({
          address: row.address,
          city: row.city,
          country: row.country,
        });
        if (!coords) continue;
        await prisma.lodging.update({
          where: { id: row.id },
          data: { lat: coords.lat, lon: coords.lon },
        });
        filled++;
      } catch (err) {
        logger.warn(
          {
            operation: "lodging_geocode_backfill_row_failed",
            lodgingId: row.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "Geocode backfill row failed — continuing",
        );
      }
    }

    logger.info(
      { operation: "lodging_geocode_backfill", userId, batchId, attempted, filled },
      "Lodging geocode backfill finished",
    );
  } catch (err) {
    logger.error(
      {
        operation: "lodging_geocode_backfill_failed",
        userId,
        batchId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Lodging geocode backfill failed",
    );
  }

  return { attempted, filled };
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingGeocodeBackfill.test.ts --forceExit
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/geocodeBackfill.ts backend/src/__tests__/lodgingGeocodeBackfill.test.ts
git commit -m "feat(lodging): backfill missing coordinates after an import commit"
```

---

## Task 10: LLM column-mapping suggestion — advisory only

**Files:**
- Create: `backend/src/services/lodging/mappingSuggestion.ts`
- Test: `backend/src/__tests__/lodgingMappingSuggestion.test.ts`

**Interfaces:**
- Consumes: `getAdminParserSettings` from `backend/src/services/parserSettings.ts`.
- Produces (the frontend `lodgingCsv.ts` in Task 14 imports the SAME field union by re-declaring it in its mirror file — the names must match exactly):

```ts
export const LODGING_CSV_FIELDS = [
  "name", "type", "chainName", "stars", "address", "city", "country",
  "lat", "lon", "googlePlaceId",
  "checkIn", "checkOut", "roomCategory", "board", "totalPrice", "currency",
  "ratingRoom", "ratingBreakfast", "ratingOverall", "bookingReference", "notes",
] as const;
export type LodgingCsvField = (typeof LODGING_CSV_FIELDS)[number];
export type LodgingCsvMapping = Partial<Record<LodgingCsvField, string>>;

export interface MappingSuggestionOptions { url?: string; model?: string }

/**
 * Returns `{}` on ANY failure — the caller falls back to its header heuristic.
 * `options` mirrors `parseLodgingBookingText`'s bag (options > admin_settings >
 * env > default) so a test can point it at a dead port.
 */
export async function suggestLodgingCsvMapping(
  headers: string[],
  sampleRows: Record<string, string>[],
  options?: MappingSuggestionOptions,
): Promise<LodgingCsvMapping>;
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingMappingSuggestion.test.ts`:

```ts
import {
  LODGING_CSV_FIELDS,
  suggestLodgingCsvMapping,
} from "../services/lodging/mappingSuggestion";

jest.mock("../services/parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: null })),
}));

describe("suggestLodgingCsvMapping", () => {
  it("returns an empty mapping when Ollama is unreachable — never throws", async () => {
    const mapping = await suggestLodgingCsvMapping(["Hotel", "Anreise"], [{ Hotel: "NH", Anreise: "30.03.2026" }], {
      url: "http://127.0.0.1:1",
      model: "nonexistent",
    });
    expect(mapping).toEqual({});
  });

  it("exposes every field the CSV importer can map", () => {
    expect(LODGING_CSV_FIELDS).toContain("name");
    expect(LODGING_CSV_FIELDS).toContain("googlePlaceId");
    expect(LODGING_CSV_FIELDS).toContain("checkIn");
    expect(LODGING_CSV_FIELDS).toContain("ratingBreakfast");
    expect(new Set(LODGING_CSV_FIELDS).size).toBe(LODGING_CSV_FIELDS.length);
  });
});
```

> Note the third argument: `suggestLodgingCsvMapping` takes an optional
> `{ url?: string; model?: string }` options bag as its third parameter, exactly
> like `parseLodgingBookingText`, so a test can point it at a dead port.

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingMappingSuggestion.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../services/lodging/mappingSuggestion'`.

- [ ] **Step 3: Implement it**

Create `backend/src/services/lodging/mappingSuggestion.ts`:

```ts
import http from "http";
import https from "https";
import logger from "../../utils/logger";
import { getAdminParserSettings } from "../parserSettings";

export const LODGING_CSV_FIELDS = [
  "name",
  "type",
  "chainName",
  "stars",
  "address",
  "city",
  "country",
  "lat",
  "lon",
  "googlePlaceId",
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "totalPrice",
  "currency",
  "ratingRoom",
  "ratingBreakfast",
  "ratingOverall",
  "bookingReference",
  "notes",
] as const;
export type LodgingCsvField = (typeof LODGING_CSV_FIELDS)[number];
export type LodgingCsvMapping = Partial<Record<LodgingCsvField, string>>;

export interface MappingSuggestionOptions {
  url?: string;
  model?: string;
}

// Deliberately short. This is an ADVISORY call — if the model is slow, the user
// gets the header heuristic instead of a spinner.
const SUGGEST_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You map spreadsheet column headers to TravStats lodging fields.

Return ONLY JSON: {"mapping":{"<travstatsField>":"<csvHeader>", …}}.
Use ONLY these field names: ${LODGING_CSV_FIELDS.join(", ")}.
Every value MUST be one of the CSV headers given, copied VERBATIM.
Omit a field entirely if no header fits — NEVER invent a header, NEVER map two fields to the same header.

Hints: German headers are common. "Hotel"/"Name"/"Unterkunft" -> name. "Anreise"/"Check-in" -> checkIn. "Abreise" -> checkOut. "Bew. Zimmer"/"Bewertung Zimmer" -> ratingRoom. "Bew. Frühstück" -> ratingBreakfast. "Kette"/"Marke" -> chainName. "Straße"/"Adresse" -> address. "PLZ" belongs with address, not city. "Ort"/"Stadt" -> city. "Land" -> country. "Sterne" -> stars. "Preis"/"Gesamtpreis" -> totalPrice. "place_id"/"Google Place ID" -> googlePlaceId.`;

function postJson(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.setTimeout(SUGGEST_TIMEOUT_MS, () =>
      req.destroy(new Error(`Mapping suggestion timeout after ${SUGGEST_TIMEOUT_MS}ms`)),
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function resolveOptions(
  options?: MappingSuggestionOptions,
): Promise<Required<MappingSuggestionOptions>> {
  let adminUrl: string | undefined;
  let adminModel: string | undefined;
  if (!options?.url || !options?.model) {
    try {
      const admin = await getAdminParserSettings();
      adminUrl = admin?.ollamaUrl ?? undefined;
      adminModel = admin?.ollamaModel ?? undefined;
    } catch (err) {
      logger.warn({ err }, "[Lodging Mapping] Failed to load admin parser settings");
    }
  }
  return {
    url: options?.url ?? adminUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: options?.model ?? adminModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b",
  };
}

function isLodgingField(value: string): value is LodgingCsvField {
  return (LODGING_CSV_FIELDS as readonly string[]).includes(value);
}

/**
 * Keep only entries whose field name is one of ours AND whose value is one of
 * the headers actually present in the file. A hallucinated header would drive
 * the whole import off a cliff, so it is dropped rather than trusted.
 */
function sanitize(raw: unknown, headers: string[]): LodgingCsvMapping {
  if (typeof raw !== "object" || raw === null) return {};
  const container = raw as Record<string, unknown>;
  const mappingRaw = container.mapping ?? container;
  if (typeof mappingRaw !== "object" || mappingRaw === null) return {};

  const headerSet = new Set(headers);
  const used = new Set<string>();
  const mapping: LodgingCsvMapping = {};
  for (const [field, header] of Object.entries(mappingRaw as Record<string, unknown>)) {
    if (typeof header !== "string") continue;
    if (!isLodgingField(field)) continue;
    if (!headerSet.has(header)) continue;
    if (used.has(header)) continue;
    mapping[field] = header;
    used.add(header);
  }
  return mapping;
}

/**
 * Ask the LLM for a column mapping. **The LLM is never in the critical path**
 * (spec §3.1): every failure — unreachable, slow, malformed, hallucinated —
 * resolves to `{}`, and the caller falls back to its header-name heuristic.
 */
export async function suggestLodgingCsvMapping(
  headers: string[],
  sampleRows: Record<string, string>[],
  options?: MappingSuggestionOptions,
): Promise<LodgingCsvMapping> {
  try {
    const { url, model } = await resolveOptions(options);
    const body = JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      prompt: `CSV headers: ${JSON.stringify(headers)}\nSample rows: ${JSON.stringify(
        sampleRows.slice(0, 3),
      )}\n\nReturn the mapping JSON.`,
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_ctx: 4096 },
    });

    const raw = await postJson(`${url}/api/generate`, body);
    const response: unknown = JSON.parse(raw);
    if (typeof response !== "object" || response === null || !("response" in response)) return {};
    const text = (response as Record<string, unknown>).response;
    if (typeof text !== "string") return {};

    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
      .trim();

    const mapping = sanitize(JSON.parse(cleaned) as unknown, headers);
    logger.info(
      { operation: "lodging_mapping_suggested", fields: Object.keys(mapping).length },
      "Lodging CSV mapping suggested",
    );
    return mapping;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[Lodging Mapping] Suggestion failed — the client falls back to its heuristic",
    );
    return {};
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingMappingSuggestion.test.ts --forceExit
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/mappingSuggestion.ts backend/src/__tests__/lodgingMappingSuggestion.test.ts
git commit -m "feat(lodging): add advisory LLM column-mapping suggestion"
```

---

## Task 11: Routes — `/api/v1/lodging-import`

**Files:**
- Create: `backend/src/routes/lodgingImport.ts`
- Modify: `backend/src/index.ts` (mount the router)
- Modify: `backend/src/middleware/rateLimit.ts` (add `lodgingImportLimiter`)
- Test: `backend/src/__tests__/lodgingImportRoutes.test.ts`

**Interfaces:**
- Consumes: `buildLodgingPreviewRows` (Task 6), `commitLodgingImport` (Task 7), `listLodgingImportBatches` + `revertLodgingImportBatch` (Task 8), `backfillMissingCoordinates` (Task 9), `suggestLodgingCsvMapping` (Task 10), all schemas from Task 2.
- Produces the HTTP surface the frontend client (Task 12) calls. Every response uses the project envelope `{ success: true, data: … }`:

| Method + path | Body | `data` |
|---|---|---|
| `POST /api/v1/lodging-import/preview` | `{ candidates: LodgingImportCandidate[] }` | `{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }` |
| `POST /api/v1/lodging-import/commit` | `{ source, fileName, rows: CommitRowInput[] }` | `CommitResult` |
| `GET /api/v1/lodging-import/batches` | — | `LodgingImportBatchSummary[]` |
| `DELETE /api/v1/lodging-import/batches/:id` | — | `{ deletedLodgings, deletedStays }` |
| `POST /api/v1/lodging-import/suggest-mapping` | `{ headers, sampleRows }` | `{ mapping: LodgingCsvMapping }` |

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/lodgingImportRoutes.test.ts`:

```ts
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

jest.mock("../services/fx/frankfurter", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
  })),
  getRate: jest.fn(async () => 1),
}));

const backfillSpy = jest.fn(async () => ({ attempted: 0, filled: 0 }));
jest.mock("../services/lodging/geocodeBackfill", () => ({
  MAX_BACKFILL_ROWS: 500,
  backfillMissingCoordinates: () => backfillSpy(),
}));

jest.mock("../services/lodging/mappingSuggestion", () => {
  const actual = jest.requireActual("../services/lodging/mappingSuggestion");
  return { ...actual, suggestLodgingCsvMapping: jest.fn(async () => ({ name: "Hotel" })) };
});

describe("/api/v1/lodging-import", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-import-routes-test", password: await hashPassword("pw123456") },
    });
    userId = user.id;
    token = generateToken(user.id);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const auth = (): [string] => [`token=${token}`];

  it("rejects an unauthenticated preview", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/preview")
      .send({ candidates: [{ sourceRowIndex: 0, lodging: { name: "X" }, stay: null }] });
    expect(res.status).toBe(401);
  });

  it("previews, commits, lists and reverts a batch", async () => {
    const preview = await request(app)
      .post("/api/v1/lodging-import/preview")
      .set("Cookie", auth())
      .send({
        candidates: [
          {
            sourceRowIndex: 0,
            lodging: { name: "Route Hotel", city: "Wien", lat: 48.2, lon: 16.3 },
            stay: { checkIn: "2026-09-01", checkOut: "2026-09-03", totalPrice: 200, currency: "EUR" },
          },
        ],
      });

    expect(preview.status).toBe(200);
    expect(preview.body.success).toBe(true);
    expect(preview.body.data.rows).toHaveLength(1);
    expect(preview.body.data.summary).toEqual({ newRows: 1, alreadyPresent: 0, needsInput: 0 });

    const commit = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", auth())
      .send({
        source: "csv",
        fileName: "routes.csv",
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            lodging: { name: "Route Hotel", city: "Wien", lat: 48.2, lon: 16.3 },
            stay: { checkIn: "2026-09-01", checkOut: "2026-09-03", totalPrice: 200, currency: "EUR" },
          },
        ],
      });

    expect(commit.status).toBe(201);
    expect(commit.body.data.createdLodgings).toBe(1);
    expect(commit.body.data.createdStays).toBe(1);
    const batchId = commit.body.data.batchId;

    // The commit must kick off the background geocode pass, not await it.
    expect(backfillSpy).toHaveBeenCalled();

    const list = await request(app)
      .get("/api/v1/lodging-import/batches")
      .set("Cookie", auth());
    expect(list.status).toBe(200);
    expect(list.body.data.some((b: { id: string }) => b.id === batchId)).toBe(true);

    const revert = await request(app)
      .delete(`/api/v1/lodging-import/batches/${batchId}`)
      .set("Cookie", auth());
    expect(revert.status).toBe(200);
    expect(revert.body.data.deletedLodgings).toBe(1);

    expect(await prisma.lodging.count({ where: { userId, name: "Route Hotel" } })).toBe(0);
  });

  it("400s on a commit row whose action is needs_input", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/commit")
      .set("Cookie", auth())
      .send({
        source: "csv",
        fileName: null,
        rows: [{ sourceRowIndex: 0, action: "needs_input", lodging: { name: "X" }, stay: null }],
      });
    expect(res.status).toBe(400);
  });

  it("404s when reverting an unknown batch", async () => {
    const res = await request(app)
      .delete("/api/v1/lodging-import/batches/00000000-0000-0000-0000-000000000000")
      .set("Cookie", auth());
    expect(res.status).toBe(404);
  });

  it("returns a mapping suggestion", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-import/suggest-mapping")
      .set("Cookie", auth())
      .send({ headers: ["Hotel", "Anreise"], sampleRows: [{ Hotel: "NH", Anreise: "2026-03-30" }] });
    expect(res.status).toBe(200);
    expect(res.body.data.mapping).toEqual({ name: "Hotel" });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd backend && npx jest src/__tests__/lodgingImportRoutes.test.ts --forceExit
```
Expected: FAIL — every request returns 404 (the router is not mounted).

- [ ] **Step 3: Add the rate limiter**

In `backend/src/middleware/rateLimit.ts`, next to the existing limiters (copy the shape of `fxPreviewLimiter`):

```ts
/** The import endpoints do real work (DB scans, an LLM call). Keep them modest. */
export const lodgingImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many import requests, please try again later" },
});
```

- [ ] **Step 4: Create the router**

Create `backend/src/routes/lodgingImport.ts`:

```ts
import { Router, Response, NextFunction } from "express";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { lodgingImportLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import {
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  suggestMappingRequestSchema,
} from "../schemas/lodgingImport";
import { buildLodgingPreviewRows } from "../services/lodging/lodgingImportPreview";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import {
  listLodgingImportBatches,
  revertLodgingImportBatch,
} from "../services/lodging/lodgingImportBatches";
import { backfillMissingCoordinates } from "../services/lodging/geocodeBackfill";
import { suggestLodgingCsvMapping } from "../services/lodging/mappingSuggestion";

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(lodgingImportLimiter);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

router.post("/preview", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = lodgingImportPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const result = await buildLodgingPreviewRows(userId, parsed.data.candidates);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/commit", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = lodgingImportCommitRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const result = await commitLodgingImport(
      userId,
      parsed.data.source,
      parsed.data.fileName,
      parsed.data.rows,
    );

    // Fire-and-forget: the rows are already committed and usable. Geocoding is
    // 1 req/s (Nominatim) — awaiting it here would stall the response for
    // minutes on a large import. A row without coordinates is valid; it just has
    // no pin until this pass reaches it.
    void backfillMissingCoordinates(userId, result.batchId).catch((error: unknown) => {
      logger.error({
        operation: "lodging_geocode_backfill_unhandled",
        batchId: result.batchId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/batches", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    res.json({ success: true, data: await listLodgingImportBatches(userId) });
  } catch (err) {
    next(err);
  }
});

router.delete("/batches/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const result = await revertLodgingImportBatch(userId, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/suggest-mapping", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireUser(req);
    const parsed = suggestMappingRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    // Never throws — `{}` means "use your heuristic".
    const mapping = await suggestLodgingCsvMapping(parsed.data.headers, parsed.data.sampleRows);
    res.json({ success: true, data: { mapping } });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 5: Mount it**

In `backend/src/index.ts`, next to the existing lodging routers:

```ts
import lodgingImportRoutes from "./routes/lodgingImport";
```

and, **before** `app.use("/api/v1/lodging", lodgingRoutes)` is irrelevant — the path is distinct, so mount order does not matter, but keep it adjacent for readability:

```ts
app.use("/api/v1/lodging-import", lodgingImportRoutes);
```

> The router lives at `/api/v1/lodging-import`, **not** under `/api/v1/lodging/import`, on purpose: `routes/lodging.ts` has a `GET /:id` handler that would swallow `import` as a lodging id.

- [ ] **Step 6: Run the test and see it pass**

```bash
cd backend && npx jest src/__tests__/lodgingImportRoutes.test.ts --forceExit && npx tsc --noEmit && npm run lint
```
Expected: PASS (6 tests), clean `tsc`, clean lint.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/lodgingImport.ts backend/src/index.ts backend/src/middleware/rateLimit.ts backend/src/__tests__/lodgingImportRoutes.test.ts
git commit -m "feat(lodging): expose the import preview, commit, batch and mapping endpoints"
```

---

## Task 12: Frontend wire types and API client

**Files:**
- Create: `frontend/src/types/lodgingImport.ts`
- Create: `frontend/src/lib/api/lodgingImport.ts`
- Modify: `frontend/src/components/import/types.ts:3`
- Modify: `frontend/src/lib/api/parse.ts`
- Test: `frontend/src/lib/api/__tests__/lodgingImport.test.ts`

**Interfaces:**
- Consumes: the HTTP surface from Task 11; `api` from `frontend/src/lib/api/client.ts`; `parserApi` from the same file.
- Produces:

```ts
// frontend/src/types/lodgingImport.ts — a hand mirror of backend/src/schemas/lodgingImport.ts
export type LodgingImportSource = "csv" | "email" | "pdf";
export interface LodgingCandidateFields { name: string; type?: LodgingType | null; chainName?: string | null; stars?: number | null; address?: string | null; city?: string | null; country?: string | null; lat?: number | null; lon?: number | null; externalRef?: string | null; notes?: string | null }
export interface StayCandidateFields { checkIn: string; checkOut: string; roomCategory?: string | null; board?: BoardType | null; totalPrice?: number | null; currency?: Currency | null; ratingRoom?: number | null; ratingBreakfast?: number | null; ratingOverall?: number | null; bookingReference?: string | null; externalRef?: string | null; notes?: string | null }
export interface LodgingImportCandidate { sourceRowIndex: number; lodging: LodgingCandidateFields | null; lodgingName?: string | null; stay: StayCandidateFields | null }
export type LodgingImportFlag = "missing_name" | "unresolvable_lodging_name" | "ambiguous_lodging_name" | "malformed_date" | "invalid_date_range" | "missing_coordinates";
export type LodgingDedupeHint = "none" | "lodging_exact_ref" | "lodging_name_city" | "stay_exact_ref" | "stay_same_dates";
export type LodgingImportAction = "create" | "skip" | "needs_input";
export interface LodgingImportPreviewRow extends LodgingImportCandidate { flags: LodgingImportFlag[]; dedupeHint: LodgingDedupeHint; matchedLodgingId: string | null; matchedStayId: string | null; action: LodgingImportAction }
export interface LodgingImportSummary { newRows: number; alreadyPresent: number; needsInput: number }
export interface LodgingImportCommitRow { sourceRowIndex: number; action: "create" | "skip"; matchedLodgingId?: string | null; lodging: LodgingCandidateFields | null; stay: StayCandidateFields | null }
export interface LodgingImportCommitResult { batchId: string; createdLodgings: number; createdStays: number; skipped: number; failed: { sourceRowIndex: number; error: string }[] }
export interface LodgingImportBatchSummary { id: string; source: LodgingImportSource; fileName: string | null; createdAt: string; lodgingCount: number; stayCount: number }

// frontend/src/lib/api/lodgingImport.ts
export const previewLodgingImport: (candidates: LodgingImportCandidate[]) => Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }>;
export const commitLodgingImport: (source: LodgingImportSource, fileName: string | null, rows: LodgingImportCommitRow[]) => Promise<LodgingImportCommitResult>;
export const listLodgingImportBatches: () => Promise<LodgingImportBatchSummary[]>;
export const revertLodgingImportBatch: (batchId: string) => Promise<{ deletedLodgings: number; deletedStays: number }>;
/** Never rejects — resolves to `{}` so the caller falls back to its heuristic. */
export const suggestLodgingCsvMapping: (headers: string[], sampleRows: Record<string, string>[]) => Promise<Record<string, string>>;
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/api/__tests__/lodgingImport.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  commitLodgingImport,
  previewLodgingImport,
  revertLodgingImportBatch,
  suggestLodgingCsvMapping,
} from "../lodgingImport";
import { api } from "../client";

vi.mock("../client", () => ({
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
  parserApi: { post: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe("lodgingImport api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts candidates to /lodging-import/preview and unwraps the envelope", async () => {
    mockedApi.post.mockResolvedValue({
      data: { success: true, data: { rows: [], summary: { newRows: 0, alreadyPresent: 0, needsInput: 0 } } },
    });

    const result = await previewLodgingImport([
      { sourceRowIndex: 0, lodging: { name: "X" }, stay: null },
    ]);

    expect(mockedApi.post).toHaveBeenCalledWith("/lodging-import/preview", {
      candidates: [{ sourceRowIndex: 0, lodging: { name: "X" }, stay: null }],
    });
    expect(result.summary.newRows).toBe(0);
  });

  it("posts source, fileName and rows to /lodging-import/commit", async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        data: { batchId: "b1", createdLodgings: 1, createdStays: 0, skipped: 0, failed: [] },
      },
    });

    const result = await commitLodgingImport("csv", "places.csv", [
      { sourceRowIndex: 0, action: "create", lodging: { name: "X" }, stay: null },
    ]);

    expect(mockedApi.post).toHaveBeenCalledWith("/lodging-import/commit", {
      source: "csv",
      fileName: "places.csv",
      rows: [{ sourceRowIndex: 0, action: "create", lodging: { name: "X" }, stay: null }],
    });
    expect(result.batchId).toBe("b1");
  });

  it("deletes a batch", async () => {
    mockedApi.delete.mockResolvedValue({
      data: { success: true, data: { deletedLodgings: 2, deletedStays: 3 } },
    });
    const result = await revertLodgingImportBatch("b1");
    expect(mockedApi.delete).toHaveBeenCalledWith("/lodging-import/batches/b1");
    expect(result.deletedStays).toBe(3);
  });

  it("resolves to {} when the mapping suggestion fails — it never rejects", async () => {
    mockedApi.post.mockRejectedValue(new Error("ollama down"));
    const mapping = await suggestLodgingCsvMapping(["Hotel"], [{ Hotel: "NH" }]);
    expect(mapping).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd frontend && npx vitest --run src/lib/api/__tests__/lodgingImport.test.ts
```
Expected: FAIL — `Failed to resolve import "../lodgingImport"`.

- [ ] **Step 3: Create the types**

Create `frontend/src/types/lodgingImport.ts` with exactly the interfaces listed under **Produces** above. Import `LodgingType`, `BoardType` and `Currency` from `frontend/src/types/lodging.ts` (they already exist there; if a name differs, use the existing one and keep this file's own names as written).

- [ ] **Step 4: Create the client**

Create `frontend/src/lib/api/lodgingImport.ts`:

```ts
import { api } from "./client";
import { logger } from "../logger";
import type {
  LodgingImportBatchSummary,
  LodgingImportCandidate,
  LodgingImportCommitResult,
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSource,
  LodgingImportSummary,
} from "../../types/lodgingImport";

interface Envelope<T> {
  success: boolean;
  data: T;
}

export const previewLodgingImport = async (
  candidates: LodgingImportCandidate[],
): Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }> => {
  const { data } = await api.post<
    Envelope<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }>
  >("/lodging-import/preview", { candidates });
  return data.data;
};

export const commitLodgingImport = async (
  source: LodgingImportSource,
  fileName: string | null,
  rows: LodgingImportCommitRow[],
): Promise<LodgingImportCommitResult> => {
  const { data } = await api.post<Envelope<LodgingImportCommitResult>>("/lodging-import/commit", {
    source,
    fileName,
    rows,
  });
  return data.data;
};

export const listLodgingImportBatches = async (): Promise<LodgingImportBatchSummary[]> => {
  const { data } = await api.get<Envelope<LodgingImportBatchSummary[]>>("/lodging-import/batches");
  return data.data;
};

export const revertLodgingImportBatch = async (
  batchId: string,
): Promise<{ deletedLodgings: number; deletedStays: number }> => {
  const { data } = await api.delete<Envelope<{ deletedLodgings: number; deletedStays: number }>>(
    `/lodging-import/batches/${batchId}`,
  );
  return data.data;
};

/**
 * The LLM is NEVER in the critical path: any failure resolves to `{}` and the
 * caller falls back to its header-name heuristic. It must not reject.
 */
export const suggestLodgingCsvMapping = async (
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<Record<string, string>> => {
  try {
    const { data } = await api.post<Envelope<{ mapping: Record<string, string> }>>(
      "/lodging-import/suggest-mapping",
      { headers, sampleRows: sampleRows.slice(0, 3) },
    );
    return data.data.mapping ?? {};
  } catch (err) {
    logger.warn("lodging mapping suggestion failed — using the header heuristic", err);
    return {};
  }
};
```

- [ ] **Step 5: Widen the import-domain and parse types**

In `frontend/src/components/import/types.ts`, line 3:

```ts
export type ImportDomain = "flight" | "cruise" | "lodging";
```

In `frontend/src/lib/api/parse.ts`, add the lodging result shapes and widen the three `domain` unions (`parseEmail`, `parseEmailFile`, `parsePdf`) to include `"lodging"`:

```ts
import type { LodgingImportCandidate } from "../../types/lodgingImport";

export interface ParseEmailLodgingResult {
  domain: "lodging";
  candidates: LodgingImportCandidate[];
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  fallbackReason?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export interface ParsePdfLodgingResult {
  domain: "lodging";
  candidates: LodgingImportCandidate[];
  parserUsed: "template" | "ollama" | "none";
  ollamaAvailable: boolean;
  fallbackReason?: string;
  pdfTextLength: number;
}

export function isLodgingEmailResult(r: ParseEmailResult): r is ParseEmailLodgingResult {
  return r.domain === "lodging";
}
export function isLodgingPdfResult(r: ParsePdfResult): r is ParsePdfLodgingResult {
  return r.domain === "lodging";
}
```

and extend the unions:

```ts
export type ParseEmailResult =
  | ParseEmailFlightResult
  | ParseEmailCruiseResult
  | ParseEmailLodgingResult;
export type ParsePdfResult = ParsePdfFlightResult | ParsePdfCruiseResult | ParsePdfLodgingResult;
```

Then add the `"lodging"` overloads to `parseApi.parseEmail`, `parseApi.parseEmailFile` and `parseApi.parsePdf` (each already has one overload per domain — add a fourth that returns the lodging result, and widen the catch-all `"flight" | "cruise"` parameters to `"flight" | "cruise" | "lodging"`).

- [ ] **Step 6: Run the test and see it pass**

```bash
cd frontend && npx vitest --run src/lib/api/__tests__/lodgingImport.test.ts && npx tsc --noEmit
```
Expected: PASS (4 tests) and a clean `tsc`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/lodgingImport.ts frontend/src/lib/api/lodgingImport.ts frontend/src/lib/api/__tests__/lodgingImport.test.ts frontend/src/components/import/types.ts frontend/src/lib/api/parse.ts
git commit -m "feat(lodging): add the frontend import wire types and API client"
```

---

## Task 13: Generalise `ColumnMappingWizard` (flight behaviour unchanged)

**Files:**
- Modify: `frontend/src/components/import/ColumnMappingWizard.tsx`
- Modify: `frontend/src/components/import/GenericCsvImportTile.tsx`
- Modify: `frontend/src/components/import/ColumnMappingWizard.test.tsx`
- Test: the file above, plus a new case for the generic props.

**Why this task exists:** the wizard the owner asked to reuse ("so eine Zuweisung wie in TravStats Excel import") is **not** domain-agnostic today — it hard-codes `GenericMapping` (flight fields), the flight `ALIASES` table and the `settings:import.preview.wizard.fields.*` label keys. It has to become generic before lodging can use it. The flight caller keeps behaving exactly as it does now.

**Interfaces:**
- Produces:

```ts
export interface MappingFieldSpec<F extends string> {
  key: F;
  /** Already-translated label. The wizard does not know the caller's namespace. */
  label: string;
  required?: boolean;
  /** Header aliases, compared lower-cased with non-alphanumerics stripped. */
  aliases: string[];
}

export interface ColumnMappingWizardProps<F extends string> {
  fields: MappingFieldSpec<F>[];
  csvHeaders: string[];
  csvSamples: Record<string, string>;
  /** Pre-selected mapping (e.g. the LLM suggestion). Overrides the heuristic per field. */
  initialMapping?: Partial<Record<F, string>>;
  onSubmit: (mapping: Partial<Record<F, string>>) => void;
  onCancel: () => void;
}

export function ColumnMappingWizard<F extends string>(
  props: ColumnMappingWizardProps<F>,
): JSX.Element;

/** Exported so callers (and tests) can pre-compute the heuristic. */
export function autoMapHeaders<F extends string>(
  fields: MappingFieldSpec<F>[],
  headers: string[],
): Partial<Record<F, string>>;
```
- Consumes (in `GenericCsvImportTile.tsx`): a new local `FLIGHT_MAPPING_FIELDS` built from the existing `REQUIRED_FIELDS` / `OPTIONAL_FIELDS` / `ALIASES` tables that currently live inside the wizard — move them out into the tile.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/import/ColumnMappingWizard.test.tsx` (keep every existing case; they now have to pass `fields`):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnMappingWizard, autoMapHeaders, type MappingFieldSpec } from "./ColumnMappingWizard";

type LodgingField = "name" | "city" | "checkIn";

const LODGING_FIELDS: MappingFieldSpec<LodgingField>[] = [
  { key: "name", label: "Name", required: true, aliases: ["name", "hotel", "unterkunft"] },
  { key: "city", label: "Stadt", aliases: ["city", "ort", "stadt"] },
  { key: "checkIn", label: "Anreise", aliases: ["checkin", "anreise"] },
];

describe("ColumnMappingWizard (generic)", () => {
  it("auto-maps by alias regardless of case and punctuation", () => {
    const mapping = autoMapHeaders(LODGING_FIELDS, ["Hotel", "Ort", "Check-In"]);
    expect(mapping).toEqual({ name: "Hotel", city: "Ort", checkIn: "Check-In" });
  });

  it("lets an initialMapping override the heuristic", () => {
    render(
      <ColumnMappingWizard
        fields={LODGING_FIELDS}
        csvHeaders={["Hotel", "Unterkunft", "Ort"]}
        csvSamples={{ Hotel: "NH", Unterkunft: "NH Lu", Ort: "Ludwigsburg" }}
        initialMapping={{ name: "Unterkunft" }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Name") as HTMLSelectElement;
    expect(select.value).toBe("Unterkunft");
  });

  it("blocks submit while a required field is unmapped, and submits once it is", () => {
    const onSubmit = vi.fn();
    render(
      <ColumnMappingWizard
        fields={LODGING_FIELDS}
        csvHeaders={["Spalte A", "Ort"]}
        csvSamples={{ "Spalte A": "NH", Ort: "Ludwigsburg" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: /weiter|continue/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spalte A" } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Spalte A", city: "Ort" });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd frontend && npx vitest --run src/components/import/ColumnMappingWizard.test.tsx
```
Expected: FAIL — `autoMapHeaders` is not exported; `ColumnMappingWizard` does not accept a `fields` prop.

- [ ] **Step 3: Refactor the wizard**

In `frontend/src/components/import/ColumnMappingWizard.tsx`:

1. **Delete** the module-level `REQUIRED_FIELDS`, `OPTIONAL_FIELDS` and `ALIASES` constants and the `FieldKey`/`GenericMapping` imports — they move to `GenericCsvImportTile.tsx`.
2. Replace the props interface and `autoMap` with:

```tsx
export interface MappingFieldSpec<F extends string> {
  key: F;
  /** Already-translated label — the wizard does not know the caller's namespace. */
  label: string;
  required?: boolean;
  /** Header aliases; compared lower-cased with non-alphanumerics stripped. */
  aliases: string[];
}

export interface ColumnMappingWizardProps<F extends string> {
  fields: MappingFieldSpec<F>[];
  csvHeaders: string[];
  csvSamples: Record<string, string>;
  initialMapping?: Partial<Record<F, string>>;
  onSubmit: (mapping: Partial<Record<F, string>>) => void;
  onCancel: () => void;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header-name heuristic. This is the SAFETY NET the whole CSV path leans on:
 * the LLM suggestion is advisory, so if it is slow, unreachable or wrong, this
 * still gives the user a sane starting mapping (spec §3.1 / §5).
 * The first match wins; a header already taken by an earlier field is not
 * re-used, so two fields can never collide by accident.
 */
export function autoMapHeaders<F extends string>(
  fields: MappingFieldSpec<F>[],
  headers: string[],
): Partial<Record<F, string>> {
  const used = new Set<string>();
  const mapping: Partial<Record<F, string>> = {};
  const normalized = headers.map((h) => ({ raw: h, norm: normalize(h) }));
  for (const field of fields) {
    const aliases = field.aliases.map(normalize);
    const match = normalized.find((h) => aliases.includes(h.norm) && !used.has(h.raw));
    if (match) {
      mapping[field.key] = match.raw;
      used.add(match.raw);
    }
  }
  return mapping;
}
```

3. Make the component generic and drive its two sections off `fields`:

```tsx
export function ColumnMappingWizard<F extends string>({
  fields,
  csvHeaders,
  csvSamples,
  initialMapping,
  onSubmit,
  onCancel,
}: ColumnMappingWizardProps<F>): JSX.Element {
  const { t } = useTranslation("settings");

  const initial = useMemo(() => {
    const heuristic = autoMapHeaders(fields, csvHeaders);
    // The LLM's suggestion wins per field where it has one; the heuristic fills
    // every remaining gap. A suggestion naming a header that is not in the file
    // is dropped (the backend already sanitises, this is belt and braces).
    const merged: Partial<Record<F, string>> = { ...heuristic };
    for (const [key, header] of Object.entries(initialMapping ?? {}) as [F, string][]) {
      if (csvHeaders.includes(header)) merged[key] = header;
    }
    return merged;
  }, [fields, csvHeaders, initialMapping]);

  const [mapping, setMapping] = useState<Partial<Record<F, string>>>(initial);
  const [autoFilled, setAutoFilled] = useState<Set<F>>(
    () => new Set(Object.keys(initial) as F[]),
  );

  useEffect(() => {
    setMapping(initial);
    setAutoFilled(new Set(Object.keys(initial) as F[]));
  }, [initial]);

  const setField = (field: F, value: string | undefined): void => {
    setMapping((prev) => ({ ...prev, [field]: value || undefined }));
    setAutoFilled((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields]);
  const optionalFields = useMemo(() => fields.filter((f) => !f.required), [fields]);

  const collisions = useMemo(() => {
    const seen = new Map<string, F[]>();
    for (const [field, header] of Object.entries(mapping) as [F, string | undefined][]) {
      if (!header) continue;
      seen.set(header, [...(seen.get(header) ?? []), field]);
    }
    const dup = new Set<F>();
    for (const list of seen.values()) {
      if (list.length > 1) list.forEach((f) => dup.add(f));
    }
    return dup;
  }, [mapping]);

  const missingRequired = requiredFields.filter((f) => !mapping[f.key]);
  const skippedOptionalCount = optionalFields.filter((f) => !mapping[f.key]).length;
  const canSubmit = missingRequired.length === 0 && collisions.size === 0;
  // …render exactly as before, but pass `fields={requiredFields}` /
  // `fields={optionalFields}` to `<FieldSection>` and render `field.label`
  // instead of `t("settings:import.preview.wizard.fields." + field)`.
}
```

4. Change `FieldSectionProps` to `fields: MappingFieldSpec<F>[]`, `mapping: Partial<Record<F, string>>`, `autoFilled: Set<F>`, `collisions: Set<F>`, `setField: (field: F, value: string | undefined) => void`, and render `{field.label}` and `key={field.key}`. Everything else in the markup — the auto-detected badge, the collision styling, the sample-value hints, the footer — stays byte-for-byte the same.

Note `missingRequired` is now a `MappingFieldSpec[]`, so the footer's join becomes:

```tsx
{t("settings:import.preview.wizard.missingFields", {
  fields: missingRequired.map((f) => f.label).join(", "),
})}
```

- [ ] **Step 4: Update the flight caller**

In `frontend/src/components/import/GenericCsvImportTile.tsx`, add the field spec (moving the tables the wizard used to own) and pass it in:

```tsx
import { ColumnMappingWizard, type MappingFieldSpec } from "./ColumnMappingWizard";
import type { GenericMapping } from "../../lib/importers/genericCsv";

type FlightField = keyof GenericMapping;

/** The flight field spec — identical aliases and required/optional split as before. */
function useFlightMappingFields(): MappingFieldSpec<FlightField>[] {
  const { t } = useTranslation("settings");
  return useMemo(
    () => [
      { key: "date", required: true, aliases: ["date", "flightdate", "datum", "depdate", "departuredate"], label: t("settings:import.preview.wizard.fields.date") },
      { key: "fromIata", required: true, aliases: ["fromiata", "from", "origin", "originiata", "departure", "dep", "depiata", "departureiata", "von"], label: t("settings:import.preview.wizard.fields.fromIata") },
      { key: "toIata", required: true, aliases: ["toiata", "to", "destination", "destinationiata", "arrival", "arr", "arriata", "arrivaliata", "dest", "nach"], label: t("settings:import.preview.wizard.fields.toIata") },
      { key: "depTimeLocal", aliases: ["deptimelocal", "deptime", "departuretime", "dptlocal", "dpt", "abflugzeit"], label: t("settings:import.preview.wizard.fields.depTimeLocal") },
      { key: "arrTimeLocal", aliases: ["arrtimelocal", "arrtime", "arrivaltime", "arrlocal", "ankunftszeit"], label: t("settings:import.preview.wizard.fields.arrTimeLocal") },
      { key: "flightNumber", aliases: ["flightnumber", "flightno", "flight", "flightid", "flugnummer"], label: t("settings:import.preview.wizard.fields.flightNumber") },
      { key: "airline", aliases: ["airline", "carrier", "fluggesellschaft"], label: t("settings:import.preview.wizard.fields.airline") },
      { key: "aircraft", aliases: ["aircraft", "ac", "plane", "type", "flugzeug", "flugzeugtyp"], label: t("settings:import.preview.wizard.fields.aircraft") },
      { key: "registration", aliases: ["registration", "reg", "tail", "tailnumber", "kennzeichen"], label: t("settings:import.preview.wizard.fields.registration") },
      { key: "seatNumber", aliases: ["seatnumber", "seat", "seatno", "sitzplatz", "sitzplatznummer"], label: t("settings:import.preview.wizard.fields.seatNumber") },
      { key: "notes", aliases: ["notes", "note", "remarks", "remark", "comment", "comments", "notiz", "notizen"], label: t("settings:import.preview.wizard.fields.notes") },
    ],
    [t],
  );
}
```

and in the JSX:

```tsx
<ColumnMappingWizard
  fields={flightFields}
  csvHeaders={csvHeaders}
  csvSamples={csvSamples}
  onSubmit={(mapping) => void handleMappingSubmit(mapping as GenericMapping)}
  onCancel={() => {
    setCsvText(null);
    setCsvHeaders([]);
    setCsvSamples({});
  }}
/>
```

(`const flightFields = useFlightMappingFields();` inside the component body.)

- [ ] **Step 5: Run the tests and see them pass**

```bash
cd frontend && npx vitest --run src/components/import && npx tsc --noEmit
```
Expected: PASS — the pre-existing flight cases (now passing `fields`) plus the 3 new generic ones. Clean `tsc`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/import/ColumnMappingWizard.tsx frontend/src/components/import/ColumnMappingWizard.test.tsx frontend/src/components/import/GenericCsvImportTile.tsx
git commit -m "refactor(import): make ColumnMappingWizard domain-agnostic"
```

---

## Task 14: Lodging CSV importer — field spec, heuristic, shape detection, candidates

**Files:**
- Create: `frontend/src/lib/importers/lodgingCsv.ts`
- Test: `frontend/src/lib/importers/__tests__/lodgingCsv.test.ts`

**Interfaces:**
- Consumes: `MappingFieldSpec` (Task 13); `LodgingImportCandidate` (Task 12); `parseCsv(content: string): Record<string, string>[]` from `frontend/src/lib/csvParser.ts`.
- Produces:

```ts
export const LODGING_CSV_FIELDS: readonly LodgingCsvField[]; // same 21 names as the backend
export type LodgingCsvField =
  | "name" | "type" | "chainName" | "stars" | "address" | "city" | "country"
  | "lat" | "lon" | "googlePlaceId"
  | "checkIn" | "checkOut" | "roomCategory" | "board" | "totalPrice" | "currency"
  | "ratingRoom" | "ratingBreakfast" | "ratingOverall" | "bookingReference" | "notes";
export type LodgingCsvMapping = Partial<Record<LodgingCsvField, string>>;

/** Field specs (labels come from i18n at the call site — see `buildLodgingMappingFields`). */
export const LODGING_FIELD_ALIASES: Record<LodgingCsvField, string[]>;
export function buildLodgingMappingFields(
  label: (field: LodgingCsvField) => string,
): MappingFieldSpec<LodgingCsvField>[];

export type LodgingCsvShape = "places" | "stays" | "both";
export function detectCsvShape(mapping: LodgingCsvMapping): LodgingCsvShape;

export interface LodgingCsvParseResult {
  candidates: LodgingImportCandidate[];
  shape: LodgingCsvShape;
  /** Rows that could not be turned into a candidate at all, with a reason. */
  rowErrors: { rowIndex: number; message: string }[];
}
export function buildLodgingCandidates(
  records: Record<string, string>[],
  mapping: LodgingCsvMapping,
): LodgingCsvParseResult;
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/importers/__tests__/lodgingCsv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../csvParser";
import {
  buildLodgingCandidates,
  buildLodgingMappingFields,
  detectCsvShape,
  type LodgingCsvMapping,
} from "../lodgingCsv";
import { autoMapHeaders } from "../../../components/import/ColumnMappingWizard";

describe("lodgingCsv heuristic", () => {
  it("auto-maps the owner's places export (German + Google headers)", () => {
    const fields = buildLodgingMappingFields((f) => f);
    const mapping = autoMapHeaders(fields, [
      "Name",
      "Typ",
      "Kette",
      "Sterne",
      "Adresse",
      "Ort",
      "Land",
      "lat",
      "lon",
      "google_place_id",
    ]);
    expect(mapping).toMatchObject({
      name: "Name",
      type: "Typ",
      chainName: "Kette",
      stars: "Sterne",
      address: "Adresse",
      city: "Ort",
      country: "Land",
      lat: "lat",
      lon: "lon",
      googlePlaceId: "google_place_id",
    });
  });

  it("auto-maps Alex's stays sheet", () => {
    const fields = buildLodgingMappingFields((f) => f);
    const mapping = autoMapHeaders(fields, [
      "Hotel",
      "Anreise",
      "Abreise",
      "Bew. Zimmer",
      "Bew. Frühstück",
    ]);
    expect(mapping).toMatchObject({
      name: "Hotel",
      checkIn: "Anreise",
      checkOut: "Abreise",
      ratingRoom: "Bew. Zimmer",
      ratingBreakfast: "Bew. Frühstück",
    });
  });
});

describe("detectCsvShape", () => {
  it("detects places-only", () => {
    const mapping: LodgingCsvMapping = { name: "Name", city: "Ort", lat: "lat", lon: "lon" };
    expect(detectCsvShape(mapping)).toBe("places");
  });

  it("detects stays-only (joined by hotel name)", () => {
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };
    expect(detectCsvShape(mapping)).toBe("stays");
  });

  it("detects both", () => {
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      city: "Ort",
      checkIn: "Anreise",
      checkOut: "Abreise",
    };
    expect(detectCsvShape(mapping)).toBe("both");
  });
});

describe("buildLodgingCandidates", () => {
  it("builds places-only candidates with a google externalRef and no stay", () => {
    const csv = [
      "Name,Typ,Kette,Sterne,Adresse,Ort,Land,lat,lon,google_place_id",
      "Hotel Adlon,hotel,Kempinski,5,Unter den Linden 77,Berlin,Deutschland,52.5163,13.3807,ChIJd8BlQ2Bo5kcRAFTLmuLK8bA",
    ].join("\n");
    const mapping: LodgingCsvMapping = {
      name: "Name",
      type: "Typ",
      chainName: "Kette",
      stars: "Sterne",
      address: "Adresse",
      city: "Ort",
      country: "Land",
      lat: "lat",
      lon: "lon",
      googlePlaceId: "google_place_id",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("places");
    expect(result.rowErrors).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.lodging?.name).toBe("Hotel Adlon");
    expect(c.lodging?.chainName).toBe("Kempinski");
    expect(c.lodging?.stars).toBe(5);
    expect(c.lodging?.lat).toBeCloseTo(52.5163, 4);
    expect(c.lodging?.externalRef).toBe("google:ChIJd8BlQ2Bo5kcRAFTLmuLK8bA");
    expect(c.stay).toBeNull();
  });

  it("builds stays-only candidates joined by hotel name, with no price and no FX", () => {
    const csv = [
      "Hotel,Anreise,Abreise,Bew. Zimmer,Bew. Frühstück",
      "NH Ludwigsburg,30.03.2026,31.03.2026,4,3",
      "Novotel Suites Berlin,2026-04-22,2026-04-24,5,4",
    ].join("\n");
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      checkIn: "Anreise",
      checkOut: "Abreise",
      ratingRoom: "Bew. Zimmer",
      ratingBreakfast: "Bew. Frühstück",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("stays");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].lodging).toBeNull();
    expect(result.candidates[0].lodgingName).toBe("NH Ludwigsburg");
    // German DD.MM.YYYY and ISO both normalise to YYYY-MM-DD.
    expect(result.candidates[0].stay?.checkIn).toBe("2026-03-30");
    expect(result.candidates[0].stay?.checkOut).toBe("2026-03-31");
    expect(result.candidates[0].stay?.ratingRoom).toBe(4);
    expect(result.candidates[0].stay?.totalPrice).toBeNull();
    expect(result.candidates[1].stay?.checkIn).toBe("2026-04-22");
  });

  it("builds a lodging AND its stay per row in the both shape", () => {
    const csv = [
      "Hotel,Ort,Anreise,Abreise,Preis,Währung",
      "Bastion Hotel,Zoetermeer,04.06.2026,07.06.2026,\"451,70\",EUR",
    ].join("\n");
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      city: "Ort",
      checkIn: "Anreise",
      checkOut: "Abreise",
      totalPrice: "Preis",
      currency: "Währung",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("both");
    expect(result.candidates[0].lodging?.name).toBe("Bastion Hotel");
    expect(result.candidates[0].stay?.totalPrice).toBeCloseTo(451.7, 2);
    expect(result.candidates[0].stay?.currency).toBe("EUR");
  });

  it("reports an unparseable date as a row error instead of dropping the row silently", () => {
    const csv = ["Hotel,Anreise,Abreise", "Broken Hotel,not-a-date,31.03.2026"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.candidates).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].rowIndex).toBe(0);
    expect(result.rowErrors[0].message).toContain("date");
  });

  it("skips a row with an empty name rather than creating a nameless lodging", () => {
    const csv = ["Name,Ort", ",Berlin", "Real Hotel,Berlin"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Name", city: "Ort" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].lodging?.name).toBe("Real Hotel");
    expect(result.rowErrors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd frontend && npx vitest --run src/lib/importers/__tests__/lodgingCsv.test.ts
```
Expected: FAIL — `Failed to resolve import "../lodgingCsv"`.

- [ ] **Step 3: Implement it**

Create `frontend/src/lib/importers/lodgingCsv.ts`:

```ts
import type { MappingFieldSpec } from "../../components/import/ColumnMappingWizard";
import type {
  LodgingCandidateFields,
  LodgingImportCandidate,
  StayCandidateFields,
} from "../../types/lodgingImport";

export const LODGING_CSV_FIELDS = [
  "name",
  "type",
  "chainName",
  "stars",
  "address",
  "city",
  "country",
  "lat",
  "lon",
  "googlePlaceId",
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "totalPrice",
  "currency",
  "ratingRoom",
  "ratingBreakfast",
  "ratingOverall",
  "bookingReference",
  "notes",
] as const;
export type LodgingCsvField = (typeof LODGING_CSV_FIELDS)[number];
export type LodgingCsvMapping = Partial<Record<LodgingCsvField, string>>;

/** German first — both real files are German. Compared with non-alphanumerics stripped. */
export const LODGING_FIELD_ALIASES: Record<LodgingCsvField, string[]> = {
  name: ["name", "hotel", "unterkunft", "hotelname", "lodging", "property"],
  type: ["type", "typ", "art", "kategorie"],
  chainName: ["chain", "kette", "marke", "brand", "hotelkette"],
  stars: ["stars", "sterne", "sternekategorie", "rating"],
  address: ["address", "adresse", "strasse", "straße", "street"],
  city: ["city", "ort", "stadt", "town"],
  country: ["country", "land", "staat"],
  lat: ["lat", "latitude", "breitengrad"],
  lon: ["lon", "lng", "long", "longitude", "laengengrad", "längengrad"],
  googlePlaceId: ["googleplaceid", "placeid", "googleid", "cid"],
  checkIn: ["checkin", "anreise", "von", "startdate", "arrival"],
  checkOut: ["checkout", "abreise", "bis", "enddate", "departure"],
  roomCategory: ["roomcategory", "zimmer", "zimmerkategorie", "zimmertyp", "roomtype"],
  board: ["board", "verpflegung", "mahlzeiten", "meals"],
  totalPrice: ["totalprice", "preis", "gesamtpreis", "price", "kosten", "betrag"],
  currency: ["currency", "waehrung", "währung"],
  ratingRoom: ["ratingroom", "bewzimmer", "bewertungzimmer", "zimmerbewertung"],
  ratingBreakfast: [
    "ratingbreakfast",
    "bewfruehstueck",
    "bewfrühstück",
    "bewertungfruehstueck",
    "fruehstuecksbewertung",
  ],
  ratingOverall: ["ratingoverall", "bewgesamt", "gesamtbewertung", "bewertung"],
  bookingReference: ["bookingreference", "buchungsnummer", "bestaetigungsnummer", "referenz"],
  notes: ["notes", "notiz", "notizen", "bemerkung", "kommentar", "comment"],
};

/** `name` is the only required column: every shape needs something to key on. */
const REQUIRED_FIELDS: LodgingCsvField[] = ["name"];

export function buildLodgingMappingFields(
  label: (field: LodgingCsvField) => string,
): MappingFieldSpec<LodgingCsvField>[] {
  return LODGING_CSV_FIELDS.map((field) => ({
    key: field,
    label: label(field),
    required: REQUIRED_FIELDS.includes(field),
    aliases: LODGING_FIELD_ALIASES[field],
  }));
}

const LODGING_ONLY: LodgingCsvField[] = [
  "type",
  "chainName",
  "stars",
  "address",
  "city",
  "country",
  "lat",
  "lon",
  "googlePlaceId",
];
const STAY_ONLY: LodgingCsvField[] = [
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "totalPrice",
  "currency",
  "ratingRoom",
  "ratingBreakfast",
  "ratingOverall",
  "bookingReference",
];

export type LodgingCsvShape = "places" | "stays" | "both";

/**
 * Infer from the CONFIRMED mapping what the file holds (spec §3.1):
 * - only lodging fields → places only (the owner's 232-row export),
 * - stay fields + a name column → stays resolved against existing lodgings by
 *   free-text hotel name (Alex's second sheet),
 * - both → a flat table producing a lodging and its stay per row.
 */
export function detectCsvShape(mapping: LodgingCsvMapping): LodgingCsvShape {
  const hasLodging = LODGING_ONLY.some((f) => !!mapping[f]);
  const hasStay = STAY_ONLY.some((f) => !!mapping[f]);
  if (hasLodging && hasStay) return "both";
  if (hasStay) return "stays";
  return "places";
}

export interface LodgingCsvParseResult {
  candidates: LodgingImportCandidate[];
  shape: LodgingCsvShape;
  rowErrors: { rowIndex: number; message: string }[];
}

function cell(record: Record<string, string>, header: string | undefined): string {
  if (!header) return "";
  return (record[header] ?? "").trim();
}

/** "2026-03-30" and German "30.03.2026" both normalise; anything else is an error. */
function toIsoDay(raw: string): string | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return null;
}

/** German ("451,70" / "1.234,50") and plain ("451.70") both parse. */
function toNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toRating(raw: string): number | null {
  const n = toNumber(raw);
  if (n === null) return null;
  return n >= 1 && n <= 5 ? n : null;
}

const LODGING_TYPES = ["hotel", "campsite", "guesthouse", "apartment", "hostel"] as const;
const BOARD_TYPES = ["none", "breakfast", "half", "full", "all_inclusive"] as const;
const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

function toLodgingType(raw: string): LodgingCandidateFields["type"] {
  const v = raw.toLowerCase();
  return (LODGING_TYPES as readonly string[]).includes(v)
    ? (v as (typeof LODGING_TYPES)[number])
    : null;
}

function toBoard(raw: string): StayCandidateFields["board"] {
  const v = raw.toLowerCase();
  return (BOARD_TYPES as readonly string[]).includes(v)
    ? (v as (typeof BOARD_TYPES)[number])
    : null;
}

function toCurrency(raw: string): StayCandidateFields["currency"] {
  const v = raw.toUpperCase();
  return (CURRENCIES as readonly string[]).includes(v)
    ? (v as (typeof CURRENCIES)[number])
    : null;
}

function buildLodgingFields(
  record: Record<string, string>,
  m: LodgingCsvMapping,
  name: string,
): LodgingCandidateFields {
  const placeId = cell(record, m.googlePlaceId);
  return {
    name,
    type: toLodgingType(cell(record, m.type)),
    chainName: cell(record, m.chainName) || null,
    stars: (() => {
      const n = toNumber(cell(record, m.stars));
      return n !== null && n >= 1 && n <= 5 ? Math.round(n) : null;
    })(),
    address: cell(record, m.address) || null,
    city: cell(record, m.city) || null,
    country: cell(record, m.country) || null,
    lat: toNumber(cell(record, m.lat)),
    lon: toNumber(cell(record, m.lon)),
    // A Google place id is a PROVEN identity — it is what makes a re-import of
    // the owner's 232-row file a no-op rather than 232 duplicates.
    externalRef: placeId ? `google:${placeId}` : null,
    notes: cell(record, m.notes) || null,
  };
}

export function buildLodgingCandidates(
  records: Record<string, string>[],
  mapping: LodgingCsvMapping,
): LodgingCsvParseResult {
  const shape = detectCsvShape(mapping);
  const candidates: LodgingImportCandidate[] = [];
  const rowErrors: { rowIndex: number; message: string }[] = [];

  records.forEach((record, rowIndex) => {
    const name = cell(record, mapping.name);
    if (!name) {
      rowErrors.push({ rowIndex, message: "Row has no hotel name" });
      return;
    }

    let stay: StayCandidateFields | null = null;
    if (shape !== "places") {
      const checkIn = toIsoDay(cell(record, mapping.checkIn));
      const checkOut = toIsoDay(cell(record, mapping.checkOut));
      if (!checkIn || !checkOut) {
        rowErrors.push({
          rowIndex,
          message: `Row has an unreadable check-in/check-out date`,
        });
        return;
      }
      stay = {
        checkIn,
        checkOut,
        roomCategory: cell(record, mapping.roomCategory) || null,
        board: toBoard(cell(record, mapping.board)),
        // Alex's stays have no price column at all — null here is correct data,
        // and the backend simply writes no FX snapshot for it.
        totalPrice: toNumber(cell(record, mapping.totalPrice)),
        currency: toCurrency(cell(record, mapping.currency)),
        ratingRoom: toRating(cell(record, mapping.ratingRoom)),
        ratingBreakfast: toRating(cell(record, mapping.ratingBreakfast)),
        ratingOverall: toRating(cell(record, mapping.ratingOverall)),
        bookingReference: cell(record, mapping.bookingReference) || null,
        externalRef: null,
        notes: null,
      };
    }

    candidates.push({
      sourceRowIndex: rowIndex,
      // In the "stays" shape the file has no lodging columns at all — the row
      // joins an EXISTING lodging by free-text name; the preview resolves it.
      lodging: shape === "stays" ? null : buildLodgingFields(record, mapping, name),
      lodgingName: name,
      stay,
    });
  });

  return { candidates, shape, rowErrors };
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd frontend && npx vitest --run src/lib/importers/__tests__/lodgingCsv.test.ts
```
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/importers/lodgingCsv.ts frontend/src/lib/importers/__tests__/lodgingCsv.test.ts
git commit -m "feat(lodging): add the CSV field spec, shape detection and candidate builder"
```

---

## Task 15: The editable preview modal — both paths land here

**Files:**
- Create: `frontend/src/components/lodging/LodgingImportPreviewModal.tsx`
- Test: `frontend/src/__tests__/components/lodging/LodgingImportPreviewModal.test.tsx`

**Mirror:** `frontend/src/components/Cruise/CruiseImportPreviewModal.tsx` for the modal shell, the "save / cancel" footer and the overall look. This one is a **table**, not a form, because it has to handle 232+ rows.

**Interfaces:**
- Consumes: `LodgingImportPreviewRow`, `LodgingImportSummary`, `LodgingImportCommitRow` (Task 12); `useTranslation` from `'../../hooks/useTranslation'`.
- Produces:

```tsx
export interface LodgingImportPreviewModalProps {
  rows: LodgingImportPreviewRow[];
  summary: LodgingImportSummary;
  /** Called with the user's final decisions. Rows the user left as `needs_input` are excluded. */
  onCommit: (rows: LodgingImportCommitRow[]) => Promise<void>;
  onCancel: () => void;
}
export function LodgingImportPreviewModal(props: LodgingImportPreviewModalProps): JSX.Element;
```

Behaviour the tests pin down:
1. The header reads `{{newRows}} neu · {{alreadyPresent}} bereits vorhanden · {{needsInput}} brauchen dich` (i18n key `lodging:import.preview.counts`), driven by the **live** row state, not by the server summary — editing a row updates the counts.
2. Rows arrive already sorted (the backend put `needs_input` first). The modal does NOT re-sort — re-sorting on every keystroke would make the row the user is typing in jump away.
3. Every row's name, city, check-in, check-out and price is an editable input.
4. Each row has an action selector: **create** / **skip**. A `needs_input` row starts on neither (an empty select) and cannot be committed until the user picks one.
5. `onCommit` receives only rows whose action is `create` or `skip`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/components/lodging/LodgingImportPreviewModal.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LodgingImportPreviewModal } from "../../../components/lodging/LodgingImportPreviewModal";
import type {
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../../types/lodgingImport";

const rows: LodgingImportPreviewRow[] = [
  {
    sourceRowIndex: 1,
    lodging: null,
    lodgingName: "Unknown Hotel",
    stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
    flags: ["unresolvable_lodging_name"],
    dedupeHint: "none",
    matchedLodgingId: null,
    matchedStayId: null,
    action: "needs_input",
  },
  {
    sourceRowIndex: 0,
    lodging: { name: "Fresh Hotel", city: "Berlin" },
    stay: null,
    flags: ["missing_coordinates"],
    dedupeHint: "none",
    matchedLodgingId: null,
    matchedStayId: null,
    action: "create",
  },
  {
    sourceRowIndex: 2,
    lodging: { name: "Dup Hotel", externalRef: "google:ChIJdup" },
    stay: null,
    flags: [],
    dedupeHint: "lodging_exact_ref",
    matchedLodgingId: "existing-id",
    matchedStayId: null,
    action: "skip",
  },
];

const summary: LodgingImportSummary = { newRows: 1, alreadyPresent: 1, needsInput: 1 };

describe("LodgingImportPreviewModal", () => {
  it("shows the three counts and keeps the questionable row first", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const counts = screen.getByTestId("lodging-import-counts");
    expect(counts.textContent).toContain("1");

    const nameInputs = screen.getAllByTestId(/lodging-import-name-/);
    expect(nameInputs[0]).toHaveValue("Unknown Hotel");
  });

  it("cannot commit while a row is still unresolved", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("lodging-import-commit")).toBeDisabled();
  });

  it("commits create/skip rows once the unresolved row is decided, with the user's edits", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("lodging-import-name-0"), {
      target: { value: "Fresh Hotel (edited)" },
    });
    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "skip" },
    });

    const commit = screen.getByTestId("lodging-import-commit");
    expect(commit).not.toBeDisabled();
    fireEvent.click(commit);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as { sourceRowIndex: number; action: string }[];
    expect(committed).toHaveLength(3);
    expect(committed.find((r) => r.sourceRowIndex === 1)?.action).toBe("skip");
    const edited = committed.find((r) => r.sourceRowIndex === 0);
    expect(edited?.action).toBe("create");
  });

  it("updates the live counts when the user flips a row to skip", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("lodging-import-action-0"), { target: { value: "skip" } });
    const counts = screen.getByTestId("lodging-import-counts");
    // 0 new · 2 already present · 1 needs input
    expect(counts.textContent).toMatch(/\b0\b/);
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd frontend && npx vitest --run src/__tests__/components/lodging/LodgingImportPreviewModal.test.tsx
```
Expected: FAIL — `Failed to resolve import ".../LodgingImportPreviewModal"`.

- [ ] **Step 3: Implement the modal**

Create `frontend/src/components/lodging/LodgingImportPreviewModal.tsx`. Structure (keep it under 400 lines; extract a `<PreviewRowLine>` sub-component in the same file):

```tsx
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type {
  LodgingImportAction,
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../types/lodgingImport";

export interface LodgingImportPreviewModalProps {
  rows: LodgingImportPreviewRow[];
  summary: LodgingImportSummary;
  onCommit: (rows: LodgingImportCommitRow[]) => Promise<void>;
  onCancel: () => void;
}

/** The row plus the user's in-modal edits. Immutable updates only. */
interface EditableRow extends LodgingImportPreviewRow {
  /** "" while a needs_input row is still undecided. */
  decision: LodgingImportAction | "";
}

export function LodgingImportPreviewModal({
  rows,
  summary,
  onCommit,
  onCancel,
}: LodgingImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The backend already sorted questionable rows to the top (spec §3.1). We
  // deliberately do NOT re-sort as the user edits — a row that jumps away
  // mid-keystroke is worse than a stale position.
  const [edited, setEdited] = useState<EditableRow[]>(() =>
    rows.map((r) => ({ ...r, decision: r.action === "needs_input" ? "" : r.action })),
  );

  const updateRow = useCallback((index: number, patch: Partial<EditableRow>): void => {
    setEdited((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  // Live counts — they must react to the user's edits, not restate the server's
  // first impression.
  const counts = useMemo(() => {
    const newRows = edited.filter((r) => r.decision === "create").length;
    const alreadyPresent = edited.filter((r) => r.decision === "skip").length;
    const needsInput = edited.filter((r) => r.decision === "").length;
    return { newRows, alreadyPresent, needsInput };
  }, [edited]);

  const canCommit = counts.needsInput === 0 && !saving;

  const handleCommit = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const payload: LodgingImportCommitRow[] = edited
        .filter((r): r is EditableRow & { decision: "create" | "skip" } => r.decision !== "")
        .map((r) => ({
          sourceRowIndex: r.sourceRowIndex,
          action: r.decision,
          matchedLodgingId: r.matchedLodgingId,
          lodging: r.lodging,
          stay: r.stay,
        }));
      await onCommit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [edited, onCommit]);

  // …modal shell mirroring CruiseImportPreviewModal:
  //   header  → <p data-testid="lodging-import-counts">
  //               {t("lodging:import.preview.counts", counts)}
  //             </p>
  //             plus, when `summary.needsInput > 0`, the hint
  //             {t("lodging:import.preview.needsInputHint")}
  //   body    → a scrollable table, one <PreviewRowLine> per row
  //   footer  → cancel + <button data-testid="lodging-import-commit" disabled={!canCommit}>
  //   error   → <p role="alert">{error}</p> when `error !== null`
}

interface PreviewRowLineProps {
  row: EditableRow;
  index: number;
  onChange: (index: number, patch: Partial<EditableRow>) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function PreviewRowLine({ row, index, onChange, t }: PreviewRowLineProps): JSX.Element {
  const name = row.lodging?.name ?? row.lodgingName ?? "";
  return (
    <tr>
      <td>
        <input
          data-testid={`lodging-import-name-${index}`}
          value={name}
          onChange={(e) =>
            onChange(index, {
              // Immutable: a NEW lodging object, never a mutation of the prop.
              lodging: row.lodging ? { ...row.lodging, name: e.target.value } : null,
              lodgingName: e.target.value,
            })
          }
          aria-label={t("lodging:import.fields.name")}
        />
      </td>
      {/* city, checkIn, checkOut, totalPrice inputs follow the same shape, with
          data-testids lodging-import-city-<i> / -checkin-<i> / -checkout-<i> /
          -price-<i>, each producing a NEW lodging/stay object on change. */}
      <td>
        {row.flags.map((flag) => (
          <span key={flag} title={t(`lodging:import.flags.${flag}`)}>
            {t(`lodging:import.flags.${flag}`)}
          </span>
        ))}
      </td>
      <td>
        <select
          data-testid={`lodging-import-action-${index}`}
          value={row.decision}
          onChange={(e) =>
            onChange(index, { decision: e.target.value as LodgingImportAction | "" })
          }
          aria-label={t("lodging:import.fields.action")}
        >
          <option value="">{t("lodging:import.actions.choose")}</option>
          <option value="create">{t("lodging:import.actions.create")}</option>
          <option value="skip">{t("lodging:import.actions.skip")}</option>
        </select>
      </td>
    </tr>
  );
}
```

Fill in the commented regions with the real markup, copying the class names / CSS-variable styling from `CruiseImportPreviewModal.tsx` so it looks native. Keep every string behind `t(...)` — Task 17 adds the DE/EN values.

- [ ] **Step 4: Run the test and see it pass**

```bash
cd frontend && npx vitest --run src/__tests__/components/lodging/LodgingImportPreviewModal.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/lodging/LodgingImportPreviewModal.tsx frontend/src/__tests__/components/lodging/LodgingImportPreviewModal.test.tsx
git commit -m "feat(lodging): add the editable import preview modal"
```

---

## Task 16: The adapter, the CSV tile, and the page wiring

**Files:**
- Create: `frontend/src/components/import/adapters/lodgingAdapter.tsx`
- Create: `frontend/src/components/import/LodgingCsvImportTile.tsx`
- Modify: `frontend/src/pages/LodgingListPage.tsx`
- Test: `frontend/src/components/import/__tests__/lodgingAdapter.test.tsx`

**Mirror:** `frontend/src/components/import/adapters/cruiseAdapter.tsx` (the adapter) and `frontend/src/components/import/GenericCsvImportTile.tsx` (the tile).

**Interfaces:**
- Consumes: `DomainImportAdapter`, `ReviewModalProps` from `frontend/src/components/import/types.ts`; `LodgingImportPreviewModal` (Task 15); `previewLodgingImport`, `commitLodgingImport`, `suggestLodgingCsvMapping` (Task 12); `buildLodgingCandidates`, `buildLodgingMappingFields`, `LodgingCsvMapping` (Task 14); `ColumnMappingWizard` (Task 13); `LodgingFormModal` from `frontend/src/components/lodging/LodgingFormModal.tsx` (the existing manual-entry form).
- Produces:

```tsx
export function useLodgingImportAdapter(): DomainImportAdapter;  // domain: "lodging"
export function LodgingCsvImportTile(props: { onImported: () => void | Promise<void> }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/import/__tests__/lodgingAdapter.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useLodgingImportAdapter } from "../adapters/lodgingAdapter";

const previewLodgingImport = vi.fn();
vi.mock("../../../lib/api/lodgingImport", () => ({
  previewLodgingImport: (...args: unknown[]) => previewLodgingImport(...args),
  commitLodgingImport: vi.fn(async () => ({
    batchId: "b1",
    createdLodgings: 1,
    createdStays: 1,
    skipped: 0,
    failed: [],
  })),
  suggestLodgingCsvMapping: vi.fn(async () => ({})),
}));

describe("useLodgingImportAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewLodgingImport.mockResolvedValue({
      rows: [
        {
          sourceRowIndex: 0,
          lodging: { name: "Musterhotel" },
          stay: { checkIn: "2026-01-05", checkOut: "2026-01-07" },
          flags: [],
          dedupeHint: "none",
          matchedLodgingId: null,
          matchedStayId: null,
          action: "create",
        },
      ],
      summary: { newRows: 1, alreadyPresent: 0, needsInput: 0 },
    });
  });

  it("declares the lodging domain and accepts the e-mail formats the route supports", () => {
    const { result } = renderHook(() => useLodgingImportAdapter());
    expect(result.current.domain).toBe("lodging");
    expect(result.current.acceptedEmailExtensions).toEqual([".eml", ".msg", ".txt"]);
  });

  it("sends the parse result's candidates to /preview and renders the preview modal", async () => {
    const { result } = renderHook(() => useLodgingImportAdapter());

    render(
      <>
        {result.current.renderReviewModal({
          parseResult: {
            domain: "lodging",
            candidates: [
              {
                sourceRowIndex: 0,
                lodging: { name: "Musterhotel" },
                stay: { checkIn: "2026-01-05", checkOut: "2026-01-07" },
              },
            ],
            parserUsed: "template",
            ollamaAvailable: false,
          },
          onCommit: vi.fn(),
          onCancel: vi.fn(),
        })}
      </>,
    );

    await waitFor(() => expect(previewLodgingImport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("lodging-import-counts")).toBeInTheDocument());
  });

  it("falls back to manual entry when the parser found nothing", async () => {
    const onCancel = vi.fn();
    const { result } = renderHook(() => useLodgingImportAdapter());

    render(
      <>
        {result.current.renderReviewModal({
          parseResult: {
            domain: "lodging",
            candidates: [],
            parserUsed: "none",
            ollamaAvailable: false,
            fallbackReason: "Ollama is not reachable",
          },
          onCommit: vi.fn(),
          onCancel,
        })}
      </>,
    );

    // No preview, and the panel is released so the user can switch to manual.
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(previewLodgingImport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd frontend && npx vitest --run src/components/import/__tests__/lodgingAdapter.test.tsx
```
Expected: FAIL — `Failed to resolve import "../adapters/lodgingAdapter"`.

- [ ] **Step 3: Write the adapter**

Create `frontend/src/components/import/adapters/lodgingAdapter.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { LodgingFormModal } from "../../lodging/LodgingFormModal";
import { LodgingImportPreviewModal } from "../../lodging/LodgingImportPreviewModal";
import { commitLodgingImport, previewLodgingImport } from "../../../lib/api/lodgingImport";
import type {
  LodgingImportCandidate,
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../../types/lodgingImport";
import type { DomainImportAdapter, ReviewModalProps } from "../types";

interface LodgingParseResult {
  domain?: string;
  candidates?: LodgingImportCandidate[];
  fallbackReason?: string;
}

function extractCandidates(result: unknown): LodgingImportCandidate[] | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as LodgingParseResult;
  if (r.domain !== "lodging" || !Array.isArray(r.candidates)) return null;
  return r.candidates;
}

/**
 * Plugs the Lodging domain into `<DomainImportPanel>` — the one adapter file the
 * shell's contract asks for. Email/PDF parse → candidates → the SAME preview and
 * the SAME batch commit the CSV path uses.
 */
export function useLodgingImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["lodging", "import"]);
  const addToast = useToastStore((s) => s.addToast);

  return {
    domain: "lodging",
    panelTitle: t("import:lodging.panelTitle"),
    panelHint: t("import:lodging.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    renderManual: ({ onClose, onSaved }) => (
      <LodgingFormModal
        mode="create"
        onClose={onClose}
        onSaved={async () => {
          await onSaved();
        }}
      />
    ),
    renderReviewModal: (props) => (
      <LodgingReviewSlot
        {...props}
        onEmpty={(reason) => addToast("error", reason ?? t("lodging:import.noBookings"))}
      />
    ),
  };
}

interface LodgingReviewSlotProps extends ReviewModalProps {
  onEmpty: (reason?: string) => void;
}

function LodgingReviewSlot({
  parseResult,
  onCommit,
  onCancel,
  onEmpty,
}: LodgingReviewSlotProps): JSX.Element | null {
  const [rows, setRows] = useState<LodgingImportPreviewRow[] | null>(null);
  const [summary, setSummary] = useState<LodgingImportSummary | null>(null);

  const candidates = extractCandidates(parseResult);
  const fallbackReason =
    typeof parseResult === "object" && parseResult !== null
      ? (parseResult as LodgingParseResult).fallbackReason
      : undefined;

  useEffect(() => {
    // The parser never dead-ends (spec §3.2): nothing extracted means we release
    // the review slot and tell the user, so they can use the Manual tab with
    // whatever they have.
    if (!candidates || candidates.length === 0) {
      onEmpty(fallbackReason);
      onCancel();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await previewLodgingImport(candidates);
        if (cancelled) return;
        setRows(result.rows);
        setSummary(result.summary);
      } catch (err) {
        if (cancelled) return;
        onEmpty(err instanceof Error ? err.message : String(err));
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
    };
    // `candidates` is derived from the (stable) parseResult prop.
  }, [candidates, fallbackReason, onCancel, onEmpty]);

  if (!rows || !summary) return null;

  return (
    <LodgingImportPreviewModal
      rows={rows}
      summary={summary}
      onCancel={onCancel}
      onCommit={async (commitRows: LodgingImportCommitRow[]) => {
        await commitLodgingImport("email", null, commitRows);
        await onCommit();
      }}
    />
  );
}
```

> `LodgingFormModal`'s real props may differ from `mode`/`onClose`/`onSaved` — open
> `frontend/src/components/lodging/LodgingFormModal.tsx` and use its actual
> signature; the adapter only has to render it and call `onSaved` afterwards.

- [ ] **Step 4: Write the CSV tile**

Create `frontend/src/components/import/LodgingCsvImportTile.tsx`:

```tsx
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCsv } from "../../lib/csvParser";
import {
  buildLodgingCandidates,
  buildLodgingMappingFields,
  type LodgingCsvField,
  type LodgingCsvMapping,
} from "../../lib/importers/lodgingCsv";
import {
  commitLodgingImport,
  previewLodgingImport,
  suggestLodgingCsvMapping,
} from "../../lib/api/lodgingImport";
import { LodgingImportPreviewModal } from "../lodging/LodgingImportPreviewModal";
import { ColumnMappingWizard } from "./ColumnMappingWizard";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import type {
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../types/lodgingImport";

interface Props {
  onImported: () => void | Promise<void>;
}

export function LodgingCsvImportTile({ onImported }: Props): JSX.Element {
  const { t } = useTranslation(["lodging", "settings"]);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<LodgingCsvMapping>({});
  const [preview, setPreview] = useState<{
    rows: LodgingImportPreviewRow[];
    summary: LodgingImportSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(
    () => buildLodgingMappingFields((f: LodgingCsvField) => t(`lodging:import.fields.${f}`)),
    [t],
  );

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setError(null);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) {
        setError(t("lodging:import.errors.emptyCsv"));
        return;
      }
      setRecords(rows);
      setFileName(file.name);
      setHeaders(Object.keys(rows[0]));
      setSamples(rows[0]);

      // Advisory only: the wizard already has its header heuristic, so a slow or
      // dead LLM costs nothing but this await (the client resolves to `{}`).
      setSuggested(await suggestLodgingCsvMapping(Object.keys(rows[0]), rows.slice(0, 3)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  const handleMappingSubmit = useCallback(
    async (mapping: LodgingCsvMapping): Promise<void> => {
      if (!records) return;
      const built = buildLodgingCandidates(records, mapping);
      if (built.candidates.length === 0) {
        setError(t("lodging:import.errors.noRows"));
        return;
      }
      try {
        const result = await previewLodgingImport(built.candidates);
        setPreview(result);
        if (built.rowErrors.length > 0) {
          // Never silently dropped (spec §5) — surfaced with a count.
          setError(t("lodging:import.errors.skippedRows", { count: built.rowErrors.length }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [records, t],
  );

  const reset = useCallback((): void => {
    setRecords(null);
    setFileName(null);
    setHeaders([]);
    setSamples({});
    setSuggested({});
    setPreview(null);
  }, []);

  return (
    <ImportTileShell
      title={t("lodging:import.csv.title")}
      description={t("lodging:import.csv.description")}
      picker={
        <ImportFilePicker
          label={t("lodging:import.csv.uploadLabel")}
          accept=".csv"
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {records && !preview && (
        <ColumnMappingWizard
          fields={fields}
          csvHeaders={headers}
          csvSamples={samples}
          initialMapping={suggested}
          onSubmit={(mapping) => void handleMappingSubmit(mapping)}
          onCancel={reset}
        />
      )}
      {preview && (
        <LodgingImportPreviewModal
          rows={preview.rows}
          summary={preview.summary}
          onCancel={reset}
          onCommit={async (rows) => {
            await commitLodgingImport("csv", fileName, rows);
            reset();
            await onImported();
          }}
        />
      )}
    </ImportTileShell>
  );
}
```

- [ ] **Step 5: Wire the page**

In `frontend/src/pages/LodgingListPage.tsx`, next to the existing "add lodging" control, render the import button and the CSV tile. `refresh` is whatever the page already calls to re-fetch `rows`/`stats` after a create — reuse it:

```tsx
import DomainImportButton from "../components/import/DomainImportButton";
import { useLodgingImportAdapter } from "../components/import/adapters/lodgingAdapter";
import { LodgingCsvImportTile } from "../components/import/LodgingCsvImportTile";

// inside the component:
const importAdapter = useLodgingImportAdapter();

// in the header action row, beside the existing "+ Unterkunft" button:
<DomainImportButton adapter={importAdapter} onItemsCreated={refresh} />

// and, below the list (the CSV path is a one-time migration tool, not the
// everyday path — it does not belong in the header):
<LodgingCsvImportTile onImported={refresh} />
```

- [ ] **Step 6: Run the tests and see them pass**

```bash
cd frontend && npx vitest --run src/components/import && npx tsc --noEmit && npm run lint
```
Expected: PASS (3 new adapter tests plus everything from Task 13), clean `tsc`, clean lint.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/import/adapters/lodgingAdapter.tsx frontend/src/components/import/LodgingCsvImportTile.tsx frontend/src/components/import/__tests__/lodgingAdapter.test.tsx frontend/src/pages/LodgingListPage.tsx
git commit -m "feat(lodging): plug lodging into the import panel and add the CSV tile"
```

---

## Task 17: i18n (DE + EN) and the full green build

**Files:**
- Modify: `frontend/src/i18n/resources/de/import.json`
- Modify: `frontend/src/i18n/resources/en/import.json`
- Modify: `frontend/src/i18n/resources/de/lodging.json`
- Modify: `frontend/src/i18n/resources/en/lodging.json`
- Test: `frontend/src/i18n/__tests__/lodgingImportKeys.test.ts`

**Interfaces:**
- Consumes: every `t(...)` key used in Tasks 15 and 16.
- Produces: the `lodging:import.*` subtree and `import:lodging.*`, in **both** locales.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/i18n/__tests__/lodgingImportKeys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import deImport from "../resources/de/import.json";
import enImport from "../resources/en/import.json";
import deLodging from "../resources/de/lodging.json";
import enLodging from "../resources/en/lodging.json";
import { LODGING_CSV_FIELDS } from "../../lib/importers/lodgingCsv";

const FLAGS = [
  "missing_name",
  "unresolvable_lodging_name",
  "ambiguous_lodging_name",
  "malformed_date",
  "invalid_date_range",
  "missing_coordinates",
];

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("lodging import i18n", () => {
  it("has the panel strings in both locales", () => {
    expect(deImport.lodging.panelTitle).toBeTruthy();
    expect(deImport.lodging.panelHint).toBeTruthy();
    expect(enImport.lodging.panelTitle).toBeTruthy();
    expect(enImport.lodging.panelHint).toBeTruthy();
  });

  it("has a label for every CSV field in both locales", () => {
    for (const field of LODGING_CSV_FIELDS) {
      expect(deLodging.import.fields[field]).toBeTruthy();
      expect(enLodging.import.fields[field]).toBeTruthy();
    }
  });

  it("has a label for every preview flag in both locales", () => {
    for (const flag of FLAGS) {
      expect(deLodging.import.flags[flag]).toBeTruthy();
      expect(enLodging.import.flags[flag]).toBeTruthy();
    }
  });

  it("carries {{count}} INSIDE the pluralised strings", () => {
    expect(deLodging.import.errors.skippedRows).toContain("{{count}}");
    expect(enLodging.import.errors.skippedRows).toContain("{{count}}");
  });

  it("interpolates all three counters in the preview header", () => {
    for (const s of [deLodging.import.preview.counts, enLodging.import.preview.counts]) {
      expect(s).toContain("{{newRows}}");
      expect(s).toContain("{{alreadyPresent}}");
      expect(s).toContain("{{needsInput}}");
    }
  });

  it("keeps the DE and EN lodging trees structurally identical", () => {
    expect(flatten(deLodging).sort()).toEqual(flatten(enLodging).sort());
    expect(flatten(deImport).sort()).toEqual(flatten(enImport).sort());
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

```bash
cd frontend && npx vitest --run src/i18n/__tests__/lodgingImportKeys.test.ts
```
Expected: FAIL — `Cannot read properties of undefined (reading 'panelTitle')`.

- [ ] **Step 3: Add the DE strings**

In `frontend/src/i18n/resources/de/import.json`, add alongside `cruise` and `flight`:

```json
  "lodging": {
    "panelTitle": "Übernachtung importieren",
    "panelHint": "Buchungs-E-Mail oder PDF einlesen, manuell hinzufügen — alles an einer Stelle."
  }
```

In `frontend/src/i18n/resources/de/lodging.json`, add a top-level `import` object:

```json
  "import": {
    "noBookings": "In diesem Dokument wurde keine Buchung gefunden. Du kannst die Unterkunft manuell anlegen.",
    "csv": {
      "title": "CSV-Import (einmalige Migration)",
      "description": "Bestehende Hotel- oder Aufenthaltslisten aus einer Tabelle übernehmen. Für laufende Buchungen nutze den E-Mail-/PDF-Import.",
      "uploadLabel": "CSV-Datei wählen"
    },
    "preview": {
      "counts": "{{newRows}} neu · {{alreadyPresent}} bereits vorhanden · {{needsInput}} brauchen dich",
      "needsInputHint": "Zeilen, die du prüfen musst, stehen oben.",
      "commit": "Importieren",
      "cancel": "Abbrechen"
    },
    "fields": {
      "action": "Aktion",
      "name": "Name",
      "type": "Typ",
      "chainName": "Kette",
      "stars": "Sterne",
      "address": "Adresse",
      "city": "Ort",
      "country": "Land",
      "lat": "Breitengrad",
      "lon": "Längengrad",
      "googlePlaceId": "Google-Place-ID",
      "checkIn": "Anreise",
      "checkOut": "Abreise",
      "roomCategory": "Zimmerkategorie",
      "board": "Verpflegung",
      "totalPrice": "Gesamtpreis",
      "currency": "Währung",
      "ratingRoom": "Bewertung Zimmer",
      "ratingBreakfast": "Bewertung Frühstück",
      "ratingOverall": "Gesamtbewertung",
      "bookingReference": "Buchungsnummer",
      "notes": "Notizen"
    },
    "flags": {
      "missing_name": "Kein Name",
      "unresolvable_lodging_name": "Unterkunft nicht gefunden",
      "ambiguous_lodging_name": "Mehrere Unterkünfte passen",
      "malformed_date": "Datum unlesbar",
      "invalid_date_range": "Abreise liegt vor Anreise",
      "missing_coordinates": "Keine Koordinaten (kein Kartenpin)"
    },
    "actions": {
      "choose": "Bitte wählen …",
      "create": "Anlegen",
      "skip": "Überspringen"
    },
    "errors": {
      "emptyCsv": "Die CSV-Datei ist leer.",
      "noRows": "Aus dieser Datei ließ sich keine Zeile lesen.",
      "skippedRows": "{{count}} Zeile(n) konnten nicht gelesen werden und wurden übersprungen.",
      "commitFailed": "Der Import ist fehlgeschlagen."
    },
    "batches": {
      "title": "Bisherige Importe",
      "revert": "Import rückgängig machen",
      "reverted": "{{count}} Unterkünfte wurden entfernt.",
      "empty": "Noch keine Importe."
    }
  }
```

- [ ] **Step 4: Add the EN mirror**

`frontend/src/i18n/resources/en/import.json`:

```json
  "lodging": {
    "panelTitle": "Import lodging",
    "panelHint": "Read a booking e-mail or PDF, or add it by hand — all in one place."
  }
```

`frontend/src/i18n/resources/en/lodging.json` — the same tree, same keys:

```json
  "import": {
    "noBookings": "No booking was found in this document. You can add the lodging by hand.",
    "csv": {
      "title": "CSV import (one-time migration)",
      "description": "Bring an existing hotel or stay list over from a spreadsheet. For ongoing bookings use the e-mail / PDF import.",
      "uploadLabel": "Choose a CSV file"
    },
    "preview": {
      "counts": "{{newRows}} new · {{alreadyPresent}} already present · {{needsInput}} need you",
      "needsInputHint": "Rows you need to look at are listed first.",
      "commit": "Import",
      "cancel": "Cancel"
    },
    "fields": {
      "action": "Action",
      "name": "Name",
      "type": "Type",
      "chainName": "Chain",
      "stars": "Stars",
      "address": "Address",
      "city": "City",
      "country": "Country",
      "lat": "Latitude",
      "lon": "Longitude",
      "googlePlaceId": "Google place ID",
      "checkIn": "Check-in",
      "checkOut": "Check-out",
      "roomCategory": "Room category",
      "board": "Board",
      "totalPrice": "Total price",
      "currency": "Currency",
      "ratingRoom": "Room rating",
      "ratingBreakfast": "Breakfast rating",
      "ratingOverall": "Overall rating",
      "bookingReference": "Booking reference",
      "notes": "Notes"
    },
    "flags": {
      "missing_name": "No name",
      "unresolvable_lodging_name": "Lodging not found",
      "ambiguous_lodging_name": "Several lodgings match",
      "malformed_date": "Unreadable date",
      "invalid_date_range": "Check-out precedes check-in",
      "missing_coordinates": "No coordinates (no map pin)"
    },
    "actions": {
      "choose": "Please choose …",
      "create": "Create",
      "skip": "Skip"
    },
    "errors": {
      "emptyCsv": "The CSV file is empty.",
      "noRows": "No usable row could be read from this file.",
      "skippedRows": "{{count}} row(s) could not be read and were skipped.",
      "commitFailed": "The import failed."
    },
    "batches": {
      "title": "Previous imports",
      "revert": "Undo this import",
      "reverted": "{{count}} lodgings were removed.",
      "empty": "No imports yet."
    }
  }
```

- [ ] **Step 5: Run the test and see it pass**

```bash
cd frontend && npx vitest --run src/i18n/__tests__/lodgingImportKeys.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 6: Run the FULL build checks**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```
Expected: green. Two backend suites are **known-flaky and pre-existing** (a cruise achievements teardown deadlock and a parser live-LLM timeout) — they are not caused by this work; everything added here must be green.

- [ ] **Step 7: Confirm no private fixture was ever staged**

```bash
git log --oneline --name-only -20 | grep -i "Hotel Buchungen" && echo "LEAK" || echo "clean"
git status --short
```
Expected: `clean`, and no `.msg` file in `git status`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/i18n/resources/de/import.json frontend/src/i18n/resources/en/import.json frontend/src/i18n/resources/de/lodging.json frontend/src/i18n/resources/en/lodging.json frontend/src/i18n/__tests__/lodgingImportKeys.test.ts
git commit -m "feat(lodging): add DE and EN copy for the import pipeline"
```

---

## Deferred to the `LocationInput` plan (spec §4)

Not in scope here, by instruction: the `LocationInput` component, Photon search-as-you-type, coordinate paste-detection, the map pin, and the configurable geocoder URLs in settings. This plan only relies on the **existing** `services/geo/nominatim.ts`, which already never blocks a save.
