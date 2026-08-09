# Loyalty programmes bind to chains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a stay's loyalty programme derive from its hotel's chain instead of being typed at the stay, give independent hotels their own programme link, and give the user one place to see and manage every card.

**Architecture:** A pure precedence function in `shared/` (mirrored front and back, same convention as `statusDerivation.ts` and `ratingDerivation.ts`) decides which card applies to a stay. `LodgingStay.membershipId` stops being the answer and becomes an override; a new `membership_opt_out` flag expresses "no card used". A new `LodgingMembershipLodging` join table mirrors the existing chain link so coverage is one idea. The `MembershipManager` mount inside `StayEditor` — the sole cause of chain-less orphan programmes — is removed and replaced by a settings section.

**Tech Stack:** Express + TypeScript + Prisma (PostgreSQL) backend; React + Vite + TypeScript frontend; Jest (backend), Vitest + Testing Library (frontend); react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-09-loyalty-programmes-bind-to-chains-design.md`

## Global Constraints

- Branch `dev/hotels`, worktree `.claude/worktrees/hotels`. Never commit to `main`.
- Do NOT touch `backend/VERSION` or `CHANGELOG.md` — owned by `/deploy` on main.
- Backend DB for this worktree: `postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_hotels`.
- `any` is FORBIDDEN — use `unknown` plus type guards.
- Logger: `import logger from "../utils/logger"` (default export). No `console.log`.
- Prettier: printWidth 100, `singleQuote: false`.
- All code, comments and commit messages in English. All user-facing UI copy: German primary AND English mirror, updated in the same change.
- Zod validates every request body; schemas live in `backend/src/schemas/`.
- Ownership is never implied by a foreign key — every membership/lodging id in a request body must be re-checked against `userId`.
- File size 200–400 lines ideal, 800 hard maximum.
- Run tests from `backend/` with `npm test -- --forceExit`, from `frontend/` with `npx vitest --run`.

---

### Task 1: Shared membership derivation

**Files:**
- Create: `backend/src/shared/membershipDerivation.ts`
- Create: `backend/src/shared/__tests__/membershipDerivation.test.ts`
- Create: `frontend/src/shared/membershipDerivation.ts`
- Create: `frontend/src/shared/__tests__/membershipDerivation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveStayMembership(input): StayMembershipResolution`, the types `StayMembershipSource = "override" | "chain" | "lodging" | "none"`, `MembershipCoverage = { id: string; createdAt: string; chainIds: number[]; lodgingIds: string[] }`, and `StayMembershipResolution = { membershipId: string | null; source: StayMembershipSource }`. Tasks 4, 5 and 7 import this.

- [ ] **Step 1: Write the failing backend test**

Create `backend/src/shared/__tests__/membershipDerivation.test.ts`:

```ts
import { deriveStayMembership, type MembershipCoverage } from "../membershipDerivation";

const chainCard: MembershipCoverage = {
  id: "m-chain",
  createdAt: "2026-01-01T00:00:00.000Z",
  chainIds: [7],
  lodgingIds: [],
};
const hotelCard: MembershipCoverage = {
  id: "m-hotel",
  createdAt: "2026-01-02T00:00:00.000Z",
  chainIds: [],
  lodgingIds: ["lodging-1"],
};

const base = {
  overrideId: null,
  optOut: false,
  lodgingId: "lodging-1",
  lodgingChainId: null as number | null,
  memberships: [chainCard, hotelCard],
};

describe("deriveStayMembership", () => {
  it("uses the card covering the hotel's chain", () => {
    expect(deriveStayMembership({ ...base, lodgingChainId: 7 })).toEqual({
      membershipId: "m-chain",
      source: "chain",
    });
  });

  it("falls back to a card covering the hotel itself when it has no chain", () => {
    expect(deriveStayMembership(base)).toEqual({
      membershipId: "m-hotel",
      source: "lodging",
    });
  });

  it("lets a chain link win over a direct hotel link", () => {
    // The "only when no chain is set" rule is PRECEDENCE, not prohibition:
    // assigning a chain later makes the direct link dormant, never invalid.
    const both = { ...base, lodgingChainId: 7 };
    expect(deriveStayMembership(both).source).toBe("chain");
  });

  it("lets an explicit override win over any derived card", () => {
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, overrideId: "m-hotel" })
    ).toEqual({ membershipId: "m-hotel", source: "override" });
  });

  it("lets opt-out win over everything, including an override", () => {
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, overrideId: "m-hotel", optOut: true })
    ).toEqual({ membershipId: null, source: "none" });
  });

  it("resolves an overlap to the OLDEST card, so the answer is stable", () => {
    const younger: MembershipCoverage = {
      id: "m-younger",
      createdAt: "2026-05-01T00:00:00.000Z",
      chainIds: [7],
      lodgingIds: [],
    };
    // Order in the array must not decide the winner.
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, memberships: [younger, chainCard] })
        .membershipId
    ).toBe("m-chain");
  });

  it("is none when nothing covers the stay", () => {
    expect(
      deriveStayMembership({ ...base, lodgingId: "lodging-9", lodgingChainId: 99 })
    ).toEqual({ membershipId: null, source: "none" });
  });

  it("ignores an override id that is not one of the user's cards", () => {
    // A stale id (the card was deleted) must fall through to derivation
    // rather than resolving to a membership that no longer exists.
    expect(
      deriveStayMembership({ ...base, lodgingChainId: 7, overrideId: "m-deleted" }).source
    ).toBe("chain");
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `cd backend && npx jest src/shared/__tests__/membershipDerivation.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../membershipDerivation'`. Create the file with a stub returning `{ membershipId: null, source: "none" }` and re-run so the failures are assertion failures, not a resolution error.

- [ ] **Step 3: Implement the backend deriver**

Create `backend/src/shared/membershipDerivation.ts`:

```ts
/**
 * Which loyalty card applies to a stay. The stored `membership_id` on a stay
 * is an OVERRIDE, not the answer — the answer is derived from the hotel it
 * belongs to, so a card attached to a chain covers every stay at that chain
 * without the user restating it per stay.
 *
 * MIRRORED in `frontend/src/shared/membershipDerivation.ts` (the convention of
 * shared/domains.ts, shared/statusDerivation.ts and shared/ratingDerivation.ts)
 * because the stay editor shows the reader the same card the server resolves.
 * Both sides are covered by tests asserting the same truth table.
 */

export type StayMembershipSource = "override" | "chain" | "lodging" | "none";

export interface MembershipCoverage {
  id: string;
  /** ISO string. Used only for the overlap tie-break below. */
  createdAt: string;
  chainIds: number[];
  lodgingIds: string[];
}

export interface StayMembershipResolution {
  membershipId: string | null;
  source: StayMembershipSource;
}

export interface StayMembershipInput {
  /** The stay's stored override, or null to derive. */
  overrideId: string | null;
  /** true = the user explicitly used NO programme for this stay. */
  optOut: boolean;
  lodgingId: string;
  lodgingChainId: number | null;
  memberships: MembershipCoverage[];
}

/**
 * An overlap (two cards covering the same chain or hotel) resolves to the
 * OLDEST card, so the answer does not depend on query order and cannot change
 * between two requests. The settings list is where the user untangles it.
 */
function oldest(candidates: MembershipCoverage[]): MembershipCoverage | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.createdAt < best.createdAt ? c : best));
}

export function deriveStayMembership(input: StayMembershipInput): StayMembershipResolution {
  if (input.optOut) return { membershipId: null, source: "none" };

  // A stale override (the card was deleted) must fall through to derivation
  // rather than naming a membership that no longer exists.
  if (input.overrideId !== null) {
    const hit = input.memberships.find((m) => m.id === input.overrideId);
    if (hit) return { membershipId: hit.id, source: "override" };
  }

  if (input.lodgingChainId !== null) {
    const byChain = oldest(
      input.memberships.filter((m) => m.chainIds.includes(input.lodgingChainId as number))
    );
    if (byChain) return { membershipId: byChain.id, source: "chain" };
  }

  const byLodging = oldest(input.memberships.filter((m) => m.lodgingIds.includes(input.lodgingId)));
  if (byLodging) return { membershipId: byLodging.id, source: "lodging" };

  return { membershipId: null, source: "none" };
}
```

- [ ] **Step 4: Run the backend test and watch it pass**

Run: `cd backend && npx jest src/shared/__tests__/membershipDerivation.test.ts --forceExit`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mirror the test on the frontend**

Create `frontend/src/shared/__tests__/membershipDerivation.test.ts` with the SAME truth table. Copy the backend test body verbatim, then change only the imports:

```ts
import { describe, expect, it } from "vitest";
import { deriveStayMembership, type MembershipCoverage } from "../membershipDerivation";
```

Add this comment above the `describe`:

```ts
/**
 * The SAME truth table as `backend/src/shared/__tests__/membershipDerivation.test.ts`.
 * The editor must resolve exactly the card the server resolves; these two
 * suites disagreeing is the failure this mirror exists to catch.
 */
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/shared/__tests__/membershipDerivation.test.ts`
Expected: FAIL — module not found. Stub, re-run, confirm assertion failures.

- [ ] **Step 7: Mirror the implementation**

Create `frontend/src/shared/membershipDerivation.ts` with the same body as the backend file. Change the header comment's first mirror line to read:

```ts
/**
 * Frontend MIRROR of `backend/src/shared/membershipDerivation.ts`, following
 * the same convention as shared/domains.ts, shared/statusDerivation.ts and
 * shared/ratingDerivation.ts.
 *
 * The rules MUST stay identical to the backend. Both sides are covered by
 * tests asserting the same truth table.
 */
```

Note the Prettier difference already present in the other mirrors: the backend uses trailing commas in multi-line call args, the frontend does not. Run lint and take what it gives you.

- [ ] **Step 8: Run both suites and lint**

Run: `cd frontend && npx vitest --run src/shared/__tests__/membershipDerivation.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, 8 tests; tsc and lint clean.

- [ ] **Step 9: Commit**

```bash
git add backend/src/shared/membershipDerivation.ts backend/src/shared/__tests__/membershipDerivation.test.ts frontend/src/shared/membershipDerivation.ts frontend/src/shared/__tests__/membershipDerivation.test.ts
git commit -m "feat(lodging): shared deriver for a stay's loyalty programme"
```

---

### Task 2: Schema, join table and the normalising migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `Lodging`, `LodgingStay`, `LodgingMembership`; new model `LodgingMembershipLodging`)
- Create: `backend/prisma/migrations/<timestamp>_membership_lodging_links/migration.sql`
- Create (temporary, deleted in Step 6): `backend/verify-membership-migration.tmp.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `lodging_membership_lodgings` table, `lodging_stays.membership_opt_out`, and the Prisma relations `LodgingMembership.lodgings`, `Lodging.membershipLinks`. Tasks 3, 4 and 7 rely on these names.

- [ ] **Step 1: Add the model and relations**

In `backend/prisma/schema.prisma`, add to `model LodgingMembership` (alongside the existing `chains` relation):

```prisma
  lodgings LodgingMembershipLodging[]
```

Add to `model Lodging`:

```prisma
  membershipLinks LodgingMembershipLodging[]
```

Add to `model LodgingStay`, next to `membershipId`:

```prisma
  /// true = the user explicitly used NO programme for this stay. Distinct from
  /// `membershipId = null`, which means "derive it from the hotel"
  /// (shared/membershipDerivation.ts).
  membershipOptOut Boolean @default(false) @map("membership_opt_out")
```

Add the new model after `LodgingMembershipChain`:

```prisma
/// Which INDEPENDENT hotels a membership covers, linked BY ID.
///
/// Mirrors LodgingMembershipChain so that "what does this card cover" is one
/// idea with one editor. It exists for a hotel that offers a programme without
/// belonging to a chain.
///
/// There is deliberately NO constraint tying this to `lodging.chain_id IS
/// NULL`. A chain link always WINS over one of these
/// (shared/membershipDerivation.ts), so assigning a chain to the hotel later
/// makes this row dormant rather than invalid. The alternative — enforcing the
/// rule in the database — would force a choice between blocking a legitimate
/// chain correction and silently deleting the user's link.
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

- [ ] **Step 2: Generate the migration without applying it**

Run:

```bash
cd backend && npx prisma migrate dev --create-only --name membership_lodging_links
```

Expected: a new folder under `prisma/migrations/` containing `CREATE TABLE "lodging_membership_lodgings"` and `ALTER TABLE "lodging_stays" ADD COLUMN "membership_opt_out"`. Do NOT hand-write these two statements — Prisma generates them from the schema.

- [ ] **Step 3: Append the normalising UPDATE to the generated migration**

Append to the generated `migration.sql`:

```sql
-- Data step: existing `membership_id` values were the ANSWER; they are now an
-- OVERRIDE. Any stay whose stored card is exactly the one derivation will now
-- produce from its hotel's chain must be cleared, or every historic stay would
-- render as an explicit "abweichend" override on the day this ships.
--
-- Only the chain case is considered: the lodging link table is created empty by
-- this same migration, so no stay can yet derive through it. Stays whose stored
-- card does NOT cover their hotel's chain keep it — those are real deviations.
UPDATE "lodging_stays" AS s
SET "membership_id" = NULL
FROM "lodgings" AS l, "lodging_membership_chains" AS mc
WHERE s."lodging_id" = l."id"
  AND l."chain_id" IS NOT NULL
  AND s."membership_id" IS NOT NULL
  AND mc."membership_id" = s."membership_id"
  AND mc."chain_id" = l."chain_id";
```

- [ ] **Step 4: Write the verification script**

Create `backend/verify-membership-migration.tmp.ts` (temporary; it must live inside `backend/` or Prisma module resolution fails):

```ts
/**
 * Seeds each case the normalising UPDATE must handle, runs that statement
 * verbatim, prints before/after and cleans up.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NORMALISE = `
UPDATE "lodging_stays" AS s
SET "membership_id" = NULL
FROM "lodgings" AS l, "lodging_membership_chains" AS mc
WHERE s."lodging_id" = l."id"
  AND l."chain_id" IS NOT NULL
  AND s."membership_id" IS NOT NULL
  AND mc."membership_id" = s."membership_id"
  AND mc."chain_id" = l."chain_id";`;

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { username: `mig-verify-${Date.now()}`, passwordHash: "x" },
  });
  const chain = await prisma.lodgingChain.create({
    data: { name: `Verify Chain ${Date.now()}`, isUserAdded: true },
  });
  const chained = await prisma.lodging.create({
    data: { userId: user.id, name: "Chained Hotel", chainId: chain.id },
  });
  const independent = await prisma.lodging.create({
    data: { userId: user.id, name: "Independent Hotel" },
  });

  const covering = await prisma.lodgingMembership.create({
    data: { userId: user.id, programName: `Covering ${Date.now()}`, chains: { create: [{ chainId: chain.id }] } },
  });
  const unrelated = await prisma.lodgingMembership.create({
    data: { userId: user.id, programName: `Unrelated ${Date.now()}` },
  });

  const mkStay = async (lodgingId: string, membershipId: string | null): Promise<string> => {
    const s = await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId,
        checkIn: new Date("2026-01-01T00:00:00.000Z"),
        checkOut: new Date("2026-01-02T00:00:00.000Z"),
        membershipId,
      },
    });
    return s.id;
  };

  const cases = [
    { label: "stored card == derived (must clear)", id: await mkStay(chained.id, covering.id), expect: null },
    { label: "stored card deviates (must keep)", id: await mkStay(chained.id, unrelated.id), expect: unrelated.id },
    { label: "hotel has no chain (must keep)", id: await mkStay(independent.id, unrelated.id), expect: unrelated.id },
    { label: "no card at all (stays null)", id: await mkStay(chained.id, null), expect: null },
  ];

  await prisma.$executeRawUnsafe(NORMALISE);

  let failures = 0;
  for (const c of cases) {
    const row = await prisma.lodgingStay.findUnique({ where: { id: c.id } });
    const ok = (row?.membershipId ?? null) === c.expect;
    if (!ok) failures += 1;
    console.log(`${ok ? "OK  " : "FAIL"} ${c.label} -> ${row?.membershipId ?? "null"}`);
  }

  await prisma.lodgingStay.deleteMany({ where: { userId: user.id } });
  await prisma.lodging.deleteMany({ where: { userId: user.id } });
  await prisma.lodgingMembership.deleteMany({ where: { userId: user.id } });
  await prisma.lodgingChain.delete({ where: { id: chain.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();

  console.log(failures === 0 ? "\nALL CASES PASS" : `\n${failures} CASE(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 5: Apply the migration and run the verification**

Run:

```bash
cd backend && npx prisma migrate dev
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_hotels" npx tsx verify-membership-migration.tmp.ts
```

Expected: `ALL CASES PASS` (4 cases). If a case fails, the SQL is wrong — fix it in the migration file, reset with `npx prisma migrate reset --force`, and repeat.

- [ ] **Step 6: Confirm no drift, delete the temp script, commit**

```bash
cd backend && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

Expected: `-- This is an empty migration.`

```bash
rm backend/verify-membership-migration.tmp.ts
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(lodging): membership<->lodging links and a stay opt-out flag"
```

---

### Task 3: Membership API carries hotel coverage

**Files:**
- Modify: `backend/src/schemas/lodging.ts:133-144` (`baseMembershipSchema`)
- Modify: `backend/src/routes/lodgingMemberships.ts` (MEMBERSHIP_INCLUDE, serialize, resolve helper, POST, PATCH)
- Modify: `backend/src/routes/__tests__/lodgingMemberships.test.ts`
- Modify: `frontend/src/types/lodging.ts:36-48` and `:191-200`

**Interfaces:**
- Consumes: the `lodging_membership_lodgings` table from Task 2.
- Produces: memberships serialise with `lodgingIds: string[]` and `lodgings: { id: string; name: string }[]`; `POST`/`PATCH /api/v1/lodging-memberships` accept `lodgingIds?: string[]` with replace-on-present semantics. Tasks 5 and 7 consume this shape.

- [ ] **Step 1: Write the failing route tests**

Append to `backend/src/routes/__tests__/lodgingMemberships.test.ts`, inside the existing top-level `describe`. Reuse that file's existing `authCookie`, `userId` and chain fixtures; add the two lodgings in a local `beforeAll`:

```ts
describe("hotel coverage on a membership", () => {
  let ownHotelId: string;
  let foreignHotelId: string;

  beforeAll(async () => {
    const own = await prisma.lodging.create({
      data: { userId, name: "Coverage Own Hotel" },
    });
    ownHotelId = own.id;
    const foreign = await prisma.lodging.create({
      data: { userId: otherUserId, name: "Coverage Foreign Hotel" },
    });
    foreignHotelId = foreign.id;
  });

  it("creates a membership covering an independent hotel", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-memberships")
      .set("Cookie", authCookie)
      .send({ programName: "Familotel Club", lodgingIds: [ownHotelId] });
    expect(res.status).toBe(201);
    expect(res.body.data.lodgingIds).toEqual([ownHotelId]);
    expect(res.body.data.lodgings[0].name).toBe("Coverage Own Hotel");
  });

  it("refuses a hotel the caller does not own, without saying it exists", async () => {
    // A foreign key would happily accept this id — it proves the row exists,
    // never that the caller owns it.
    const res = await request(app)
      .post("/api/v1/lodging-memberships")
      .set("Cookie", authCookie)
      .send({ programName: "Foreign Coverage", lodgingIds: [foreignHotelId] });
    expect(res.status).toBe(400);
    const leaked = await prisma.lodgingMembership.findFirst({
      where: { userId, programName: "Foreign Coverage" },
    });
    expect(leaked).toBeNull();
  });

  it("accepts a hotel that HAS a chain — the link is dormant, not rejected", async () => {
    const chain = await prisma.lodgingChain.create({
      data: { name: `Dormant Chain ${Date.now()}`, isUserAdded: true },
    });
    const chained = await prisma.lodging.create({
      data: { userId, name: "Chained Coverage Hotel", chainId: chain.id },
    });
    const res = await request(app)
      .post("/api/v1/lodging-memberships")
      .set("Cookie", authCookie)
      .send({ programName: "Dormant Card", lodgingIds: [chained.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.lodgingIds).toEqual([chained.id]);
  });

  it("leaves hotel links alone when lodgingIds is absent from a PATCH", async () => {
    const created = await request(app)
      .post("/api/v1/lodging-memberships")
      .set("Cookie", authCookie)
      .send({ programName: "Keep My Hotels", lodgingIds: [ownHotelId] });
    const res = await request(app)
      .patch(`/api/v1/lodging-memberships/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ tier: "Gold" });
    expect(res.status).toBe(200);
    expect(res.body.data.lodgingIds).toEqual([ownHotelId]);
  });

  it("replaces hotel links when lodgingIds is present, and [] clears them", async () => {
    const created = await request(app)
      .post("/api/v1/lodging-memberships")
      .set("Cookie", authCookie)
      .send({ programName: "Replace My Hotels", lodgingIds: [ownHotelId] });
    const res = await request(app)
      .patch(`/api/v1/lodging-memberships/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ lodgingIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.lodgingIds).toEqual([]);
  });
});
```

If the test file does not already expose `otherUserId`, add a second user in its top-level `beforeAll` exactly as `backend/src/routes/__tests__/lodging.test.ts` does, and delete it in `afterAll`.

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/routes/__tests__/lodgingMemberships.test.ts -t "hotel coverage" --forceExit`
Expected: FAIL — `lodgingIds` is undefined on the response (Zod strips the unknown key).

- [ ] **Step 3: Extend the Zod schema**

In `backend/src/schemas/lodging.ts`, add to `baseMembershipSchema` after `chainIds`:

```ts
  // Independent hotels this card covers. Same replace-on-present semantics as
  // `chainIds`: absent leaves the links alone, an array replaces them.
  lodgingIds: z.array(z.string().uuid()).max(500).optional(),
```

- [ ] **Step 4: Implement the route changes**

In `backend/src/routes/lodgingMemberships.ts`:

Extend the include and serializer:

```ts
const MEMBERSHIP_INCLUDE = {
  chains: { include: { chain: { select: { id: true, name: true } } } },
  lodgings: { include: { lodging: { select: { id: true, name: true } } } },
} as const;
```

```ts
function serialize(membership: MembershipWithChains) {
  const { chains, lodgings, ...rest } = membership;
  return {
    ...rest,
    chainIds: chains.map((link) => link.chainId),
    chains: chains.map((link) => link.chain),
    lodgingIds: lodgings.map((link) => link.lodgingId),
    lodgings: lodgings.map((link) => link.lodging),
  };
}
```

Add the ownership-checking resolver next to `resolveChainIds`:

```ts
/**
 * Unlike chains — a shared catalogue where existence is the only question — a
 * lodging is user-owned, so the lookup is scoped to the caller. An id belonging
 * to someone else comes back as "unknown", identical to one that never existed,
 * which is what keeps this from confirming another user's rows. A foreign key
 * alone would have accepted it.
 */
async function resolveLodgingIds(lodgingIds: string[], userId: string): Promise<string[]> {
  const unique = Array.from(new Set(lodgingIds));
  if (unique.length === 0) return [];
  const found = await prisma.lodging.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const known = new Set(found.map((l) => l.id));
    const missing = unique.filter((id) => !known.has(id));
    throw new AppError(`Unknown lodging id(s): ${missing.join(", ")}`, 400);
  }
  return unique;
}
```

In `POST`, destructure and link:

```ts
    const { chainIds, lodgingIds, ...fields } = parsed.data;
    const linkIds = await resolveChainIds(chainIds ?? []);
    const lodgingLinkIds = await resolveLodgingIds(lodgingIds ?? [], userId);
```

and inside `prisma.lodgingMembership.create({ data: { ... } })` add, after the `chains` line:

```ts
          lodgings: { create: lodgingLinkIds.map((lodgingId) => ({ lodgingId })) },
```

In `PATCH`, mirror the chain handling:

```ts
    const { chainIds, lodgingIds, ...fields } = parsed.data;
    const linkIds = chainIds === undefined ? null : await resolveChainIds(chainIds);
    const lodgingLinkIds =
      lodgingIds === undefined ? null : await resolveLodgingIds(lodgingIds, userId);
```

and inside the transaction, after the chain block:

```ts
        if (lodgingLinkIds !== null) {
          await tx.lodgingMembershipLodging.deleteMany({ where: { membershipId: existing.id } });
          if (lodgingLinkIds.length > 0) {
            await tx.lodgingMembershipLodging.createMany({
              data: lodgingLinkIds.map((lodgingId) => ({ membershipId: existing.id, lodgingId })),
            });
          }
        }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd backend && npx jest src/routes/__tests__/lodgingMemberships.test.ts --forceExit`
Expected: PASS, including the five new cases.

- [ ] **Step 6: Mirror the shape in the frontend types**

In `frontend/src/types/lodging.ts`, add to `interface LodgingMembership` after `chains`:

```ts
  /** Independent hotels this membership covers, linked by id. */
  lodgingIds: string[];
  lodgings: LodgingRef[];
```

and add near `LodgingChainRef`:

```ts
export interface LodgingRef {
  id: string;
  name: string;
}
```

Add to `interface MembershipInput`:

```ts
  /**
   * Independent hotels this membership covers. Same rule as `chainIds`: OMIT to
   * leave them alone, an array replaces them (`[]` covers no hotel).
   */
  lodgingIds?: string[];
```

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd backend && npx tsc --noEmit && npm run lint` then `cd ../frontend && npx tsc --noEmit && npm run lint`
Expected: clean both sides.

```bash
git add backend/src/schemas/lodging.ts backend/src/routes/lodgingMemberships.ts backend/src/routes/__tests__/lodgingMemberships.test.ts frontend/src/types/lodging.ts
git commit -m "feat(lodging): memberships cover independent hotels, not just chains"
```

---

### Task 4: Stay routes accept the opt-out

**Files:**
- Modify: `backend/src/schemas/lodging.ts` (`baseStaySchema`)
- Modify: `backend/src/routes/__tests__/lodging.test.ts`
- Modify: `frontend/src/types/lodging.ts` (`LodgingStay`, `StayInput`)

**Interfaces:**
- Consumes: `lodging_stays.membership_opt_out` from Task 2.
- Produces: `membershipOptOut` accepted on stay create/update and returned on every stay. Task 5 writes it.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/routes/__tests__/lodging.test.ts`, inside the top-level `describe`:

```ts
describe("POST/PATCH /api/v1/lodging/:id/stays — membership opt-out", () => {
  let optOutLodgingId: string;

  beforeAll(async () => {
    const l = await prisma.lodging.create({ data: { userId, name: "Opt Out Hotel" } });
    optOutLodgingId = l.id;
  });

  it("defaults to false and round-trips true", async () => {
    const created = await request(app)
      .post(`/api/v1/lodging/${optOutLodgingId}/stays`)
      .set("Cookie", authCookie)
      .send({ checkIn: "2026-02-01T15:00:00.000Z", checkOut: "2026-02-02T11:00:00.000Z" });
    expect(created.status).toBe(201);
    expect(created.body.data.membershipOptOut).toBe(false);

    const patched = await request(app)
      .patch(`/api/v1/lodging/${optOutLodgingId}/stays/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ membershipOptOut: true });
    expect(patched.status).toBe(200);
    expect(patched.body.data.membershipOptOut).toBe(true);
  });

  it("can be turned back off, and does not clear the override on its own", async () => {
    const created = await request(app)
      .post(`/api/v1/lodging/${optOutLodgingId}/stays`)
      .set("Cookie", authCookie)
      .send({
        checkIn: "2026-02-03T15:00:00.000Z",
        checkOut: "2026-02-04T11:00:00.000Z",
        membershipOptOut: true,
      });
    const res = await request(app)
      .patch(`/api/v1/lodging/${optOutLodgingId}/stays/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ membershipOptOut: false });
    expect(res.status).toBe(200);
    expect(res.body.data.membershipOptOut).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/routes/__tests__/lodging.test.ts -t "membership opt-out" --forceExit`
Expected: FAIL — `membershipOptOut` is `undefined` (Zod strips it before the write).

- [ ] **Step 3: Add the field to the stay schema**

In `backend/src/schemas/lodging.ts`, add to `baseStaySchema` next to the existing `membershipId` field:

```ts
  // "I used no programme for this stay" — deliberately distinct from
  // membershipId = null, which means "derive it from the hotel's chain"
  // (shared/membershipDerivation.ts).
  membershipOptOut: z.boolean().optional(),
```

No route change is needed: both handlers already spread `...input` into the Prisma write.

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx jest src/routes/__tests__/lodging.test.ts --forceExit`
Expected: PASS, whole file.

- [ ] **Step 5: Mirror in the frontend types**

In `frontend/src/types/lodging.ts`, add to `interface LodgingStay` after `membershipId`:

```ts
  /** true = no programme was used for this stay; false = derive from the hotel. */
  membershipOptOut: boolean;
```

and to `interface StayInput`:

```ts
  membershipOptOut?: boolean;
```

Update the `baseStay` fixture in `frontend/src/components/lodging/__tests__/StayEditor.test.tsx` with `membershipOptOut: false` so the object still satisfies `LodgingStay`.

- [ ] **Step 6: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit` then `cd ../frontend && npx tsc --noEmit`

```bash
git add backend/src/schemas/lodging.ts backend/src/routes/__tests__/lodging.test.ts frontend/src/types/lodging.ts frontend/src/components/lodging/__tests__/StayEditor.test.tsx
git commit -m "feat(lodging): a stay can record that no programme was used"
```

---

### Task 5: Stay editor shows the derived card and drops programme creation

**Files:**
- Modify: `frontend/src/components/lodging/StayEditor.tsx` (imports; state near `:100`; the loyalty `Section` at `:402-430`; the submit payload near `:212`)
- Modify: `frontend/src/components/lodging/__tests__/StayEditor.test.tsx`
- Modify: `frontend/src/i18n/resources/de/lodging.json`, `frontend/src/i18n/resources/en/lodging.json`

**Interfaces:**
- Consumes: `deriveStayMembership` (Task 1), `membershipOptOut` (Task 4), `LodgingMembership.lodgingIds` (Task 3).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/lodging/__tests__/StayEditor.test.tsx`. The editor needs the stay's hotel chain id; pass it through the existing `lodgingChainId` prop added in this step (see Step 3):

```ts
it("shows the card that covers the hotel's chain, without asking", async () => {
  vi.mocked(listMemberships).mockResolvedValue([
    {
      ...baseMembership,
      id: "m-1",
      programName: "Minor DISCOVERY",
      chainIds: [7],
      lodgingIds: [],
    },
  ]);

  render(
    <StayEditor
      mode="edit"
      lodgingId="lodging-1"
      lodgingChainId={7}
      stay={baseStay}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );

  expect(await screen.findByTestId("stay-editor-membership")).toHaveTextContent(
    "Minor DISCOVERY"
  );
  // The mount that created chain-less orphan programmes is gone.
  expect(screen.queryByText("lodging:stayEditor.manageMemberships")).not.toBeInTheDocument();
});

it("sends no override when the derived card is accepted as-is", async () => {
  vi.mocked(listMemberships).mockResolvedValue([
    { ...baseMembership, id: "m-1", chainIds: [7], lodgingIds: [] },
  ]);
  vi.mocked(updateStay).mockResolvedValue(baseStay);

  render(
    <StayEditor
      mode="edit"
      lodgingId="lodging-1"
      lodgingChainId={7}
      stay={baseStay}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
  await screen.findByTestId("stay-editor-membership");
  await userEvent.click(screen.getByTestId("stay-editor-save"));

  await waitFor(() => expect(updateStay).toHaveBeenCalled());
  const payload = vi.mocked(updateStay).mock.calls[0][2];
  expect(payload.membershipId).toBeNull();
  expect(payload.membershipOptOut).toBe(false);
});

it("records an explicit 'no programme' distinctly from 'derive it'", async () => {
  vi.mocked(listMemberships).mockResolvedValue([
    { ...baseMembership, id: "m-1", chainIds: [7], lodgingIds: [] },
  ]);
  vi.mocked(updateStay).mockResolvedValue(baseStay);

  render(
    <StayEditor
      mode="edit"
      lodgingId="lodging-1"
      lodgingChainId={7}
      stay={baseStay}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
  await screen.findByTestId("stay-editor-membership");
  await userEvent.click(screen.getByTestId("stay-editor-membership-override-toggle"));
  await userEvent.selectOptions(screen.getByTestId("stay-editor-membership-select"), "__none__");
  await userEvent.click(screen.getByTestId("stay-editor-save"));

  await waitFor(() => expect(updateStay).toHaveBeenCalled());
  const payload = vi.mocked(updateStay).mock.calls[0][2];
  expect(payload.membershipOptOut).toBe(true);
  expect(payload.membershipId).toBeNull();
});
```

Add this fixture next to `baseStay` in the same file:

```ts
const baseMembership: LodgingMembership = {
  id: "m-0",
  userId: "user-1",
  programName: "Test Programme",
  membershipNumber: null,
  tier: null,
  chainIds: [],
  chains: [],
  lodgingIds: [],
  lodgings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
```

and import `LodgingMembership` from `../../../types/lodging`.

- [ ] **Step 2: Run and watch them fail**

Run: `cd frontend && npx vitest --run src/components/lodging/__tests__/StayEditor.test.tsx`
Expected: FAIL — `stay-editor-membership` not found, and the manage-memberships button still present.

- [ ] **Step 3: Implement the editor changes**

In `frontend/src/components/lodging/StayEditor.tsx`:

Remove the `MembershipManager` import and the `showMembershipManager` state. Add:

```ts
import { deriveStayMembership } from "../../shared/membershipDerivation";
```

Add `lodgingChainId?: number | null` to the component's props interface, defaulting to `null`, and add state:

```ts
const [membershipOptOut, setMembershipOptOut] = useState<boolean>(stay?.membershipOptOut ?? false);
const [showMembershipOverride, setShowMembershipOverride] = useState<boolean>(
  (stay?.membershipId ?? null) !== null || (stay?.membershipOptOut ?? false)
);
```

Derive above the return:

```ts
// The SAME function the server resolves with (shared/membershipDerivation.ts).
// `membershipId` is an OVERRIDE, never the answer — a card attached to the
// hotel's chain covers this stay without the user restating it here.
const resolvedMembership = deriveStayMembership({
  overrideId: membershipId || null,
  optOut: membershipOptOut,
  lodgingId,
  lodgingChainId: lodgingChainId ?? null,
  memberships: memberships.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    chainIds: m.chainIds,
    lodgingIds: m.lodgingIds,
  })),
});
const resolvedMembershipName =
  memberships.find((m) => m.id === resolvedMembership.membershipId)?.programName ?? null;
```

Replace the loyalty `Section`'s membership block (the `<select>`, the manage button and the `showMembershipManager` block) with:

```tsx
<div data-testid="stay-editor-membership" className="text-sm">
  <span className="text-[var(--text-primary)]">
    {resolvedMembershipName ?? t("lodging:field.noMembership")}
  </span>
  <span className="ml-2 text-xs text-[var(--text-muted)]">
    {t(`lodging:field.membershipSource.${resolvedMembership.source}`)}
  </span>
</div>
<button
  type="button"
  data-testid="stay-editor-membership-override-toggle"
  onClick={(): void => setShowMembershipOverride((v) => !v)}
  className="mt-1 text-xs text-[var(--accent)] hover:underline"
>
  {t("lodging:stayEditor.overrideMembership")}
</button>
{showMembershipOverride && (
  <select
    data-testid="stay-editor-membership-select"
    aria-label={t("lodging:field.membership")}
    className={`mt-2 ${INPUT_CLASS}`}
    value={membershipOptOut ? "__none__" : membershipId}
    onChange={(e): void => {
      const v = e.target.value;
      setMembershipOptOut(v === "__none__");
      setMembershipId(v === "__none__" ? "" : v);
    }}
  >
    <option value="">{t("lodging:field.membershipDerive")}</option>
    <option value="__none__">{t("lodging:field.membershipNone")}</option>
    {memberships.map((m) => (
      <option key={m.id} value={m.id}>
        {m.programName}
      </option>
    ))}
  </select>
)}
```

In the submit payload, replace `membershipId: membershipId || null` with:

```ts
        // Only ever the override — never the derived value. Writing the
        // resolved card back would give the rule a second stored copy, which
        // is exactly how the overall-rating derivation drifted out of the
        // import paths (9fcf5de1).
        membershipId: membershipOptOut ? null : membershipId || null,
        membershipOptOut,
```

- [ ] **Step 4: Add the i18n keys, DE and EN together**

`frontend/src/i18n/resources/de/lodging.json`, under `field`:

```json
      "membershipDerive": "Automatisch (aus der Kette)",
      "membershipNone": "Kein Programm genutzt",
      "membershipSource": {
        "override": "abweichend zugeordnet",
        "chain": "aus der Kette",
        "lodging": "diesem Hotel zugeordnet",
        "none": "kein Programm"
      },
```

under `stayEditor`:

```json
      "overrideMembership": "Abweichend zuordnen",
```

`frontend/src/i18n/resources/en/lodging.json`, same positions:

```json
      "membershipDerive": "Automatic (from the chain)",
      "membershipNone": "No programme used",
      "membershipSource": {
        "override": "manually assigned",
        "chain": "from the chain",
        "lodging": "assigned to this hotel",
        "none": "no programme"
      },
```

```json
      "overrideMembership": "Assign a different one",
```

Remove the now-unused `stayEditor.manageMemberships` key from BOTH files.

- [ ] **Step 5: Pass the chain id from the callers**

Find every `<StayEditor` mount (`grep -rn "<StayEditor" frontend/src --include=*.tsx | grep -v __tests__`) and pass `lodgingChainId={lodging.chainId}` where the lodging object is in scope. Where it is not, pass nothing — the prop defaults to `null` and derivation falls through to the hotel link.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd frontend && npx vitest --run src/components/lodging/__tests__/StayEditor.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS; tsc and lint clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/lodging/StayEditor.tsx frontend/src/components/lodging/__tests__/StayEditor.test.tsx frontend/src/i18n/resources/de/lodging.json frontend/src/i18n/resources/en/lodging.json frontend/src/pages
git commit -m "feat(lodging): the stay shows its derived programme instead of asking"
```

---

### Task 6: The duplicate-name 409 offers to extend the existing card

**Files:**
- Modify: `frontend/src/components/lodging/MembershipManager.tsx`
- Modify: `frontend/src/components/lodging/__tests__/MembershipManager.test.tsx`
- Modify: `frontend/src/i18n/resources/de/lodging.json`, `frontend/src/i18n/resources/en/lodging.json`

**Interfaces:**
- Consumes: `updateMembership` (existing), `LodgingMembership.chainIds` (existing).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/lodging/__tests__/MembershipManager.test.tsx`:

```ts
it("offers to extend the existing card when the name is already taken", async () => {
  // Alex, 2026-08-08: creating "GHA Discovery" on a second chain returned a
  // clean 409 and dead-ended. The card he wants already exists; the action he
  // wants is "cover this chain too".
  const existing = {
    ...baseMembership,
    id: "m-existing",
    programName: "GHA Discovery",
    chainIds: [4],
  };
  vi.mocked(listMemberships).mockResolvedValue([existing]);
  vi.mocked(createMembership).mockRejectedValue({ response: { status: 409 } });
  vi.mocked(updateMembership).mockResolvedValue({ ...existing, chainIds: [4, 9] });

  render(
    <MembershipManager scopeChain={{ id: 9, suggestedChains: [{ id: 9, name: "NH Hotels" }] }} />
  );

  await userEvent.click(await screen.findByTestId("membership-add"));
  await userEvent.type(screen.getByTestId("membership-name-input"), "GHA Discovery");
  await userEvent.click(screen.getByTestId("membership-save"));

  const extend = await screen.findByTestId("membership-extend-existing");
  await userEvent.click(extend);

  await waitFor(() => expect(updateMembership).toHaveBeenCalled());
  expect(vi.mocked(updateMembership).mock.calls[0][0]).toBe("m-existing");
  expect(vi.mocked(updateMembership).mock.calls[0][1].chainIds).toEqual([4, 9]);
});
```

Reuse the file's existing `baseMembership` fixture; if it lacks `lodgingIds`/`lodgings`, add them as `[]`. Align `membership-add`, `membership-name-input` and `membership-save` with the `data-testid`s already in `MembershipManager.tsx`; add them if absent.

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npx vitest --run src/components/lodging/__tests__/MembershipManager.test.tsx -t "extend the existing card"`
Expected: FAIL — `membership-extend-existing` not found; the 409 renders only a message.

- [ ] **Step 3: Implement the offer**

In `MembershipManager.tsx`, where the 409 is currently caught and turned into a message, capture the clashing card and render the offer. Add state:

```ts
const [clash, setClash] = useState<LodgingMembership | null>(null);
```

In the create error handler, when `httpStatus(err) === 409` and `scopeChain` is set, find the existing card by name and store it:

```ts
      if (httpStatus(err) === 409) {
        // The name is taken by a card the user already has. Creating is the
        // wrong verb — extending the existing card to cover this chain is
        // what they meant, and it was previously unreachable.
        //
        // `submittedName` below is the programme-name value the component just
        // sent. Use the component's OWN draft state here (read the form state
        // at the top of MembershipManager.tsx and use that variable) rather
        // than introducing a parallel copy.
        const taken = memberships.find(
          (m) => m.programName.trim().toLowerCase() === submittedName.trim().toLowerCase()
        );
        setClash(taken ?? null);
        setError(t("lodging:membership.duplicate"));
        return;
      }
```

Render below the error, only when `clash && scopeChain`:

```tsx
{clash && scopeChain && (
  <button
    type="button"
    data-testid="membership-extend-existing"
    onClick={(): void => {
      void (async () => {
        const chainIds = Array.from(new Set([...clash.chainIds, scopeChain.id]));
        await updateMembership(clash.id, { chainIds });
        setClash(null);
        setError(null);
        await load();
      })();
    }}
    className="mt-2 text-xs text-[var(--accent)] hover:underline"
  >
    {t("lodging:membership.extendExisting", { name: clash.programName })}
  </button>
)}
```

Clear `clash` wherever the form is reset or closed.

- [ ] **Step 4: Add the i18n keys**

DE: `"extendExisting": "„{{name}}\" stattdessen um diese Kette erweitern"`
EN: `"extendExisting": "Extend \"{{name}}\" to cover this chain instead"`

Both under `membership`, in both files.

- [ ] **Step 5: Run and watch it pass**

Run: `cd frontend && npx vitest --run src/components/lodging/__tests__/MembershipManager.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/lodging/MembershipManager.tsx frontend/src/components/lodging/__tests__/MembershipManager.test.tsx frontend/src/i18n/resources/de/lodging.json frontend/src/i18n/resources/en/lodging.json
git commit -m "fix(lodging): a taken programme name offers to extend that card"
```

---

### Task 7: Bonusprogramme section in the lodging settings tab

**Files:**
- Create: `frontend/src/components/Settings/MembershipsSection.tsx`
- Create: `frontend/src/components/Settings/__tests__/MembershipsSection.test.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx:144-148` (section registry) and `:476-487` (render block)
- Modify: `frontend/src/i18n/resources/de/settings.json`, `frontend/src/i18n/resources/en/settings.json`

**Interfaces:**
- Consumes: `listMemberships`, `updateMembership`, `deleteMembership` (existing API client), `MembershipManager` (Task 6), `LodgingMembership.lodgingIds`/`lodgings` (Task 3).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Settings/__tests__/MembershipsSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MembershipsSection from "../MembershipsSection";
import { listMemberships } from "../../../lib/api/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  listMemberships: vi.fn(),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
}));

const card = {
  id: "m-1",
  userId: "u-1",
  programName: "Minor DISCOVERY",
  membershipNumber: "1234",
  tier: "Gold",
  chainIds: [1, 2],
  chains: [
    { id: 1, name: "NH Hotels" },
    { id: 2, name: "nhow" },
  ],
  lodgingIds: [],
  lodgings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("MembershipsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every card with its coverage", async () => {
    vi.mocked(listMemberships).mockResolvedValue([card]);
    render(<MembershipsSection />);
    expect(await screen.findByText("Minor DISCOVERY")).toBeInTheDocument();
    expect(screen.getByText(/NH Hotels/)).toBeInTheDocument();
    expect(screen.getByText(/nhow/)).toBeInTheDocument();
  });

  it("shows a card that covers NO chain — the case that used to vanish", async () => {
    // Unticking the last chain hid the membership entirely; this list is
    // unconditional, so it is always reachable.
    vi.mocked(listMemberships).mockResolvedValue([
      { ...card, id: "m-2", programName: "Orphan Card", chainIds: [], chains: [] },
    ]);
    render(<MembershipsSection />);
    expect(await screen.findByText("Orphan Card")).toBeInTheDocument();
  });

  it("offers only chain-less hotels when adding hotel coverage", async () => {
    // Alex: a direct hotel link is for independent hotels. A hotel that has a
    // chain is covered through the chain instead, and a link on it would be
    // dormant — so it is not offered here.
    vi.mocked(listMemberships).mockResolvedValue([card]);
    vi.mocked(listLodgings).mockResolvedValue([
      { ...lodgingRow, id: "l-indie", name: "Hotel Sonnenhof", chainId: null },
      { ...lodgingRow, id: "l-chained", name: "NH Berlin", chainId: 1 },
    ]);

    render(<MembershipsSection />);
    await userEvent.click(await screen.findByTestId("membership-hotels-m-1"));

    const picker = screen.getByTestId("membership-hotel-picker-m-1");
    expect(within(picker).getByText("Hotel Sonnenhof")).toBeInTheDocument();
    expect(within(picker).queryByText("NH Berlin")).not.toBeInTheDocument();
  });

  it("saves a hotel link through lodgingIds", async () => {
    vi.mocked(listMemberships).mockResolvedValue([card]);
    vi.mocked(listLodgings).mockResolvedValue([
      { ...lodgingRow, id: "l-indie", name: "Hotel Sonnenhof", chainId: null },
    ]);
    vi.mocked(updateMembership).mockResolvedValue({ ...card, lodgingIds: ["l-indie"] });

    render(<MembershipsSection />);
    await userEvent.click(await screen.findByTestId("membership-hotels-m-1"));
    await userEvent.click(screen.getByLabelText("Hotel Sonnenhof"));

    await waitFor(() => expect(updateMembership).toHaveBeenCalled());
    expect(vi.mocked(updateMembership).mock.calls[0][0]).toBe("m-1");
    expect(vi.mocked(updateMembership).mock.calls[0][1].lodgingIds).toEqual(["l-indie"]);
  });
});
```

Extend the mock and imports at the top of the file accordingly:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listMemberships, listLodgings, updateMembership } from "../../../lib/api/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  listMemberships: vi.fn(),
  listLodgings: vi.fn(),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
}));
```

and add a minimal lodging fixture beside `card`. Copy the field list from the `Lodging` interface in `frontend/src/types/lodging.ts` so the object typechecks:

```tsx
const lodgingRow = {
  id: "l-0",
  name: "Fixture Hotel",
  chainId: null as number | null,
  // …remaining required Lodging fields, copied from types/lodging.ts
};
```

Check the exact name of the list function in `frontend/src/lib/api/lodging.ts` before writing the mock — if it is not `listLodgings`, use the real one throughout this task.

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npx vitest --run src/components/Settings/__tests__/MembershipsSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the section**

Create `frontend/src/components/Settings/MembershipsSection.tsx`. It renders the unscoped `MembershipManager` (which already does create/edit/delete and the chain checkboxes) under a heading, plus a coverage summary line per card:

```tsx
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { MembershipManager } from "../lodging/MembershipManager";
import { listMemberships } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import type { LodgingMembership } from "../../types/lodging";

/**
 * The one place every loyalty card is visible.
 *
 * Before this existed, a card was only reachable through a chain page that
 * covered it — so unticking its last chain made it disappear, and a card
 * created from the stay editor (which linked no chain at all) was invisible
 * from the start while its name stayed taken. Alex asked for exactly this:
 * "wo finde ich alle bisherigen Bonusprogramme?" (Discord, 2026-08-08).
 */
export default function MembershipsSection(): JSX.Element {
  const { t } = useTranslation();
  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listMemberships();
        if (!cancelled) setMemberships(rows);
      } catch (err) {
        logger.error("MembershipsSection: failed to load memberships", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const coverage = (m: LodgingMembership): string => {
    const names = [...m.chains.map((c) => c.name), ...m.lodgings.map((l) => l.name)];
    return names.length > 0 ? names.join(", ") : t("settings:memberships.coversNothing");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("settings:memberships.title")}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {t("settings:memberships.description")}
        </p>
      </div>

      <ul className="space-y-1 text-sm">
        {memberships.map((m) => (
          <li key={m.id} className="text-[var(--text-secondary)]">
            <span className="text-[var(--text-primary)]">{m.programName}</span>
            {" — "}
            {coverage(m)}
          </li>
        ))}
      </ul>

      <MembershipManager onChanged={setMemberships} />
    </div>
  );
}
```

- [ ] **Step 4: Add the hotel coverage editor**

The chain checkboxes already live in `MembershipManager`. Hotel coverage is new
and belongs here, next to the coverage line. Add to `MembershipsSection.tsx`:

```tsx
const [openPicker, setOpenPicker] = useState<string | null>(null);
const [lodgings, setLodgings] = useState<Lodging[]>([]);
```

Load the user's lodgings in the same effect that loads memberships, then render
per card, under the coverage line:

```tsx
<button
  type="button"
  data-testid={`membership-hotels-${m.id}`}
  onClick={(): void => setOpenPicker((cur) => (cur === m.id ? null : m.id))}
  className="ml-2 text-xs text-[var(--accent)] hover:underline"
>
  {t("settings:memberships.editHotels")}
</button>
{openPicker === m.id && (
  <div data-testid={`membership-hotel-picker-${m.id}`} className="mt-1 space-y-1 pl-4">
    {/* Only chain-less hotels. A hotel WITH a chain is covered through that
        chain, and a direct link on it would be dormant
        (shared/membershipDerivation.ts) — offering it would promise something
        that never takes effect. */}
    {lodgings
      .filter((l) => l.chainId === null)
      .map((l) => (
        <label key={l.id} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={m.lodgingIds.includes(l.id)}
            onChange={(e): void => {
              const next = e.target.checked
                ? [...m.lodgingIds, l.id]
                : m.lodgingIds.filter((id) => id !== l.id);
              void (async () => {
                await updateMembership(m.id, { lodgingIds: next });
                setMemberships(await listMemberships());
              })();
            }}
          />
          {l.name}
        </label>
      ))}
  </div>
)}
```

Import `updateMembership` and the lodging list function alongside
`listMemberships`, and `Lodging` from `../../types/lodging`.

- [ ] **Step 5: Register the section**

In `frontend/src/pages/SettingsPage.tsx`, extend `lodgingTab`:

```ts
    const lodgingTab: SectionRef[] = [
      {
        id: "lodgingPreferences",
        label: t("settings:lodgingPreferences.title") || "Präferenzen",
      },
      {
        id: "lodgingMemberships",
        label: t("settings:memberships.title") || "Bonusprogramme",
      },
    ];
```

and add the render branch beside the `lodgingPreferences` one:

```tsx
            {activeSection === "lodgingMemberships" && <MembershipsSection />}
```

with `import MembershipsSection from "../components/Settings/MembershipsSection";` at the top.

- [ ] **Step 6: Add the i18n keys, DE and EN**

DE `settings.json`:

```json
  "memberships": {
    "title": "Bonusprogramme",
    "description": "Alle deine Programme an einem Ort — mit den Ketten und einzelnen Hotels, für die sie gelten.",
    "coversNothing": "noch keiner Kette zugeordnet",
    "editHotels": "Einzelne Hotels"
  },
```

EN `settings.json`:

```json
  "memberships": {
    "title": "Loyalty programmes",
    "description": "Every programme in one place, with the chains and individual hotels it covers.",
    "coversNothing": "not linked to a chain yet",
    "editHotels": "Individual hotels"
  },
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd frontend && npx vitest --run src/components/Settings/__tests__/MembershipsSection.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, 4 tests; clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Settings/MembershipsSection.tsx frontend/src/components/Settings/__tests__/MembershipsSection.test.tsx frontend/src/pages/SettingsPage.tsx frontend/src/i18n/resources/de/settings.json frontend/src/i18n/resources/en/settings.json
git commit -m "feat(lodging): one place to see and manage every loyalty programme"
```

---

### Task 8: Full gates and browser verification

**Files:** none modified unless a defect is found.

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence that the three reported scenarios actually work.

- [ ] **Step 1: Run every gate**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd ../backend && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

Expected: both suites fully green; the drift check prints `-- This is an empty migration.` Record the actual counts — do not claim a number you did not read.

- [ ] **Step 2: Start an isolated dev stack**

Cookies are shared across ports on `localhost`, so a second stack on 3000/8000 silently clobbers the session. Bind everything to `127.0.0.1`:

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_hotels" \
  PORT=8002 FRONTEND_URL=http://127.0.0.1:3002 CORS_ORIGIN=http://127.0.0.1:3002 \
  NODE_ENV=development COOKIE_SECURE=false LOG_LEVEL=warn npx tsx src/index.ts
cd frontend && VITE_API_URL=http://127.0.0.1:8002 npx vite --port 3002 --host 127.0.0.1
```

Re-seed the admin first — the full backend suite wipes it:

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_hotels" npm run seed:dev-admin
```

Then enable the lodging domain for `admin` if it is not already on.

- [ ] **Step 3: Prove the running server has the new code**

Before trusting any UI result, confirm the process is not a stale orphan: `curl` a stay PATCH with `membershipOptOut: true` and check the response echoes it. Old code would strip the key.

- [ ] **Step 4: Walk Alex's three scenarios in the browser**

1. Open a stay at a hotel whose chain has a card — the programme shows as derived, and there is **no** "Programme verwalten" button.
2. On a second chain's page, create a programme with a name you already use — the 409 appears with the "extend that card" offer; click it and confirm the chain page then shows the card.
3. Untick a chain from a card, then find that card in `Einstellungen › Unterkünfte › Bonusprogramme`.

Screenshot each. Read the request payloads, not just the status codes.

- [ ] **Step 5: Clean up and report**

Delete any hotels, stays and memberships created during the walk. Report the dev-server PIDs for the owner to stop — never run `taskkill`.

- [ ] **Step 6: Final commit and push**

```bash
git add -A
git commit -m "test(lodging): browser verification of the programme rebinding"
git push forgejo dev/hotels
```

---

## Notes for the implementer

- The two board items `membership-extend-to-another-chain` (Task 6) and `membership-untick-vanishes` (Task 7) are closed by this plan. Update `roadmap.local.yaml` in the same session that finishes them — a board that lags is worse than no board.
- Merging to `main` is the owner's release decision. Do not merge, and do not bundle the question into a list of next steps.
