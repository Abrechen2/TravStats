# Parser correctness (package 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No document in the owner's corpus is read wrong any more — every reader either produces a result it can defend or declines — and the lodging matcher stops treating a city name as identity.

**Architecture:** Five independent fixes on one branch, each with a test that fails on today's code: the lodging name matcher strips place, location-decor and brand words before counting shared identity; the generic flight regex returns a booking only when every segment carries full evidence; an airline template declines instead of returning a leg without a flight number; Booking.com's location line reads spaced postcodes and refuses code-shaped cities. The ALL Accor template is already committed on the branch.

**Tech Stack:** Node/TypeScript backend, Jest (serial, needs Postgres), `scripts/parser-corpus.ts` for corpus measurement.

**Spec:** `docs/superpowers/specs/2026-09-30-parser-system-design.md` §3 (package 1). Read it first.

## Global Constraints

- Code, comments, commits in English; Conventional Commits; commit body says why.
- Every behaviour change ships with a test that fails without it (run it against the unfixed code once).
- No real mail content, names, booking numbers or addresses in committed tests — synthetic text only. Real-corpus checks run locally via `scripts/parser-corpus.ts` and are never committed.
- `backend/src/**` files stay ≤ 800 lines (`npm run check:size`).
- Backend Jest needs a disposable Postgres whose DB name ends in `_test`; run the full suite serially (`npm test -- --forceExit`), never with `--maxWorkers`.
- Merging into `main` is the owner's decision, asked as its own question after the branch is green.

## Review Focus

1. **Two different hotels of one brand in one city** ("Novotel Basel City" / "Novotel Basel SBB") must not match by name — only by pin proximity. Pinned in Task 1.
2. **OSM enrichment must still find a hotel's own OSM object** when the OSM name adds a co-brand ("Novotel / ibis Budget Basel City"). Pinned in Task 2.
3. **A one-leg booking read by the generic regex that IS complete** (flight number, two different IATA, date) must still be returned — the gate must not decline everything. Pinned in Task 3.
4. **A Lufthansa single-flight mail** (the 27 LH mails that read right today) must be unaffected by the "no leg without flight number" rule. Pinned in Task 4 and re-measured in Task 6.
5. **A German/Austrian/Swiss Booking.com location line** ("Musterstraße 1, 80331 München, Deutschland") must read exactly as today after the postcode change. Pinned in Task 5.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Rename the Accor branch to the package branch and publish it**

The ALL Accor template (`92c00b8ca`) is spec §3.1.1 and belongs to this package.

```bash
cd D:/TravStats_Projekt/TravStats/.worktrees/accor
git branch -m feat/accor-lodging-template fix/parser-correctness
git push -q forgejo fix/parser-correctness
git push -q forgejo --delete feat/accor-lodging-template
git log --oneline -1   # 92c00b8ca feat(lodging): read ALL Accor booking confirmations without an LLM
```

- [ ] **Step 2: Test database for this branch**

```bash
docker run -d --name travstats-db-correctness -e POSTGRES_USER=flights_dev \
  -e POSTGRES_PASSWORD=dev_password_change_me_123 -e POSTGRES_DB=correctness_test \
  -e TZ=UTC -p 5476:5432 postgis/postgis:15-3.4
# wait until ready (PostGIS restarts once during init)
until docker exec travstats-db-correctness pg_isready -U flights_dev -d correctness_test -h 127.0.0.1; do sleep 2; done; sleep 8
cd backend
export DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5476/correctness_test"
npx prisma migrate deploy && npx tsx scripts/seed-test-catalogues.ts
```

All later `npx jest` commands in this plan use this `DATABASE_URL`.

---

### Task 1: The name matcher stops treating place, decor and brand words as identity

**Files:**
- Create: `backend/src/services/lodging/nameTokens.ts`
- Modify: `backend/src/services/lodging/nameSimilarity.ts` (`namesCouldBeOneHouse`, lines ~140–168)
- Test: `backend/src/services/lodging/__tests__/nameSimilarity.test.ts`

**Interfaces:**
- Produces: `export interface SameHouseContext { places?: ReadonlyArray<string | null | undefined>; nearby?: boolean }` and `namesCouldBeOneHouse(nameA: string, nameB: string, sameCity: boolean | null, context?: SameHouseContext): boolean` (context optional, so existing callers compile unchanged until Task 2).
- Produces: `BRAND_TOKENS: ReadonlySet<string>`, `LOCATION_TOKENS: ReadonlySet<string>` from `nameTokens.ts`.

- [ ] **Step 1: Write the failing tests** — append to `nameSimilarity.test.ts`:

```ts
describe("a place, a decoration or a brand is not identity", () => {
  // Prod, 2026-09-30: an ALL Accor booking for Novotel Basel City became a
  // stay at Hotel Krafft Basel. The one shared word was the city itself.
  it("does not match two hotels whose only shared word is their city", () => {
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "Hotel Krafft Basel", true, {
        places: ["Basel", "Basel"],
      })
    ).toBe(false);
  });

  it("does not match two hotels of one brand in one city by name", () => {
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "Novotel Basel SBB", true, {
        places: ["Basel", "Basel"],
      })
    ).toBe(false);
  });

  it("does not match on location decoration alone", () => {
    expect(
      namesCouldBeOneHouse("Mercure Zentrum", "Hotel Zentrum", true, { places: ["Zürich"] })
    ).toBe(false);
  });

  it("still matches a decorated name of one house (forgejo#84)", () => {
    expect(
      namesCouldBeOneHouse("Hotel Meteora", "Hotel Restaurant Meteora", true, {
        places: ["Kalambaka", "Kalambaka"],
      })
    ).toBe(true);
  });

  it("still matches two identifying words with no city known", () => {
    expect(
      namesCouldBeOneHouse("Emirates Palace", "Emirates Palace Mandarin Oriental", null)
    ).toBe(true);
  });

  it("lets pins decide: nearby, a brand and a place count as before", () => {
    // The OSM enrichment searches around the hotel's own coordinates, so the
    // place is already proven; its own OSM object must still be found.
    expect(
      namesCouldBeOneHouse("Novotel Basel City", "Novotel / ibis Budget Basel City", true, {
        nearby: true,
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run them — expect the first three to FAIL**

Run: `npx jest src/services/lodging/__tests__/nameSimilarity.test.ts -t "not identity"`
Expected: "only shared word is their city", "one brand in one city" and "location decoration" FAIL (receive `true`); the other three pass.

- [ ] **Step 3: Create `nameTokens.ts`**

```ts
/**
 * Words that sit in hotel names without saying WHICH house.
 *
 * Both lists are folded the way `nameSimilarity.ts` folds (lower case,
 * ä→ae …), because they are compared against its tokens.
 *
 * Found in prod on 2026-09-30: "Novotel Basel City" and "Hotel Krafft Basel"
 * were one house to the matcher because both contain "basel". A city, a
 * "City"/"Zentrum" suffix or a brand shared by dozens of hotels is not
 * identity; a house's own name is.
 */

/** Location decoration — tells where in a town, never which building. */
export const LOCATION_TOKENS: ReadonlySet<string> = new Set([
  "city",
  "centre",
  "center",
  "centrum",
  "zentrum",
  "mitte",
  "downtown",
  "central",
  "airport",
  "flughafen",
  "station",
  "bahnhof",
  "hbf",
]);

/**
 * Brands carried by many houses. Two Novotels in one city are two hotels, so
 * a brand alone never proves identity — coordinates can, the name cannot.
 * Keep in step with the chains in `chainFromWebsite.ts`.
 */
export const BRAND_TOKENS: ReadonlySet<string> = new Set([
  "novotel",
  "ibis",
  "mercure",
  "pullman",
  "sofitel",
  "swissotel",
  "mgallery",
  "adagio",
  "hilton",
  "conrad",
  "doubletree",
  "hampton",
  "marriott",
  "courtyard",
  "sheraton",
  "westin",
  "moxy",
  "radisson",
  "scandic",
  "melia",
  "hyatt",
  "intercontinental",
  "kempinski",
  "leonardo",
]);
```

- [ ] **Step 4: Change `namesCouldBeOneHouse`** in `nameSimilarity.ts` — add the import at the top and replace the function (keep its doc comment, extend it):

```ts
import { BRAND_TOKENS, LOCATION_TOKENS } from "./nameTokens";

/** What the caller knows beyond the two names. */
export interface SameHouseContext {
  /** City names known for either record. In the same city they prove nothing. */
  places?: ReadonlyArray<string | null | undefined>;
  /**
   * Coordinates already put both within a short radius (the OSM enrichment
   * searches around the hotel's own pin). The place is proven, so brand and
   * place words count as they always did.
   */
  nearby?: boolean;
}

export function namesCouldBeOneHouse(
  nameA: string,
  nameB: string,
  sameCity: boolean | null,
  context: SameHouseContext = {}
): boolean {
  if (sameCity === false) return false;

  const placeTokens = new Set(
    sameCity === true ? (context.places ?? []).flatMap((p) => (p ? strictTokens(p) : [])) : []
  );
  const identity = (tokens: string[]): string[] =>
    context.nearby
      ? tokens
      : tokens.filter(
          (t) => !placeTokens.has(t) && !LOCATION_TOKENS.has(t) && !BRAND_TOKENS.has(t)
        );

  const shared = identity(sharedSignificantTokens(nameA, nameB));
  if (sameCity === true) return shared.length >= 1;

  if (shared.length >= 2) return true;
  const a = identity(strictTokens(nameA));
  const b = identity(strictTokens(nameB));
  const [shorter, longer] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  return shorter.length >= 2 && shorter.every((t) => longer.has(t));
}
```

Add to the function's doc comment: "- Place words (same city only), location decoration and brands are removed before counting (`nameTokens.ts`), unless `nearby` says coordinates already proved the place."

- [ ] **Step 5: Run the whole file — all pass**

Run: `npx jest src/services/lodging/__tests__/nameSimilarity.test.ts`
Expected: PASS. If an OLD test fails, read it: if it pinned a brand- or city-only match as correct, it pinned today's defect — change its expectation and say so in the commit body; otherwise the implementation is wrong.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/lodging/nameTokens.ts backend/src/services/lodging/nameSimilarity.ts backend/src/services/lodging/__tests__/nameSimilarity.test.ts
git commit -m "fix(lodging): a city, a 'City' suffix or a brand no longer proves two hotels are one" -m "Prod 2026-09-30: an ALL Accor booking for Novotel Basel City was imported as a stay at Hotel Krafft Basel — in the same city one shared word was enough, and the word was 'basel'. Place words (same city), location decoration and brand names are removed before counting; a nearby context keeps the old rule where coordinates already prove the place."
```

---

### Task 2: The three callers say what they know

**Files:**
- Modify: `backend/src/services/lodging/lodgingImportPreview.ts:297`
- Modify: `backend/src/services/lodging/proposeMatch.ts:199`
- Modify: `backend/src/services/openData/openStreetMap.ts:96`
- Test: `backend/src/__tests__/lodgingImportPreview.test.ts`, `backend/src/services/lodging/__tests__/proposeMatch.test.ts`

**Interfaces:**
- Consumes: `namesCouldBeOneHouse(..., context?: SameHouseContext)` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `lodgingImportPreview.test.ts`, next to the existing `lodging_name_similar` cases (read one of them first and reuse its setup helper exactly), add a case: a stored lodging "Hotel Krafft Basel", city "Basel"; an incoming parsed lodging "Novotel Basel City", city "Basel". Assert the preview row does NOT carry `matchedLodgingId` of the Krafft record and its `dedupeHint` is not `"lodging_name_similar"`.

In `proposeMatch.test.ts`, add:

```ts
it("does not propose a same-city hotel that shares only the city's name", () => {
  const result = proposeMatch(
    { name: "Novotel Basel City", city: "Basel", lat: null, lon: null },
    [{ id: "krafft", name: "Hotel Krafft Basel", city: "Basel", lat: null, lon: null }]
  );
  expect(result.action).not.toBe("merge");
});
```

(Match the argument shapes to the existing tests in that file; if `proposeMatch` takes an options object or extra fields, copy them from the nearest existing test.)

- [ ] **Step 2: Run them — expect FAIL**

Run: `npx jest src/__tests__/lodgingImportPreview.test.ts src/services/lodging/__tests__/proposeMatch.test.ts -t "Krafft|only the city"`
Expected: both FAIL (today's matcher merges Krafft).

- [ ] **Step 3: Pass the context at the three call sites**

`lodgingImportPreview.ts:297`:
```ts
return namesCouldBeOneHouse(lodging.name, stored.name, sameCity, {
  places: [lodging.city, stored.city],
});
```

`proposeMatch.ts:199`:
```ts
if (
  !namesCouldBeOneHouse(candidate.name, incoming.name, sameCity, {
    places: [candidate.city, incoming.city],
  })
)
  continue;
```

`openStreetMap.ts:96`:
```ts
if (!at || !osmName || !namesCouldBeOneHouse(name, osmName, true, { nearby: true })) return [];
```

Add one comment line above the OSM call: `// The search runs around this hotel's own pin, so the place is proven.`

- [ ] **Step 4: Run the lodging and open-data tests**

Run: `npx jest src/services/lodging src/services/openData src/__tests__/lodgingImportPreview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/lodgingImportPreview.ts backend/src/services/lodging/proposeMatch.ts backend/src/services/openData/openStreetMap.ts backend/src/__tests__/lodgingImportPreview.test.ts backend/src/services/lodging/__tests__/proposeMatch.test.ts
git commit -m "fix(lodging): import preview and match proposals pass the known cities to the name matcher" -m "The OSM enrichment searches around the hotel's own pin and keeps the old rule (nearby)."
```

---

### Task 3: The generic flight regex returns a booking only with full evidence

**Files:**
- Modify: `backend/src/services/parsers/text/regexParser.ts` (`parseMultipleFlights`, lines ~99–240)
- Test: `backend/src/services/parsers/text/__tests__/regexParser.evidence.test.ts` (create)

**Interfaces:**
- Produces: `export function segmentHasEvidence(f: ParsedBooking): boolean` in `regexParser.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { getRegexParser, segmentHasEvidence } from "../regexParser";

/**
 * Corpus 2026-09-30: the generic reader turned tour-operator invoices and
 * Emirates mails into plausible wrong flights — "WHO→WHO", a date taken from
 * "ERSETZT RECHNUNG VOM", missing legs. It returns a booking now only when
 * EVERY leg carries a flight number, two different known airports and a date.
 */
describe("the generic flight reader earns its result", () => {
  it("returns a complete single flight", async () => {
    const text = "Flug: LH 400\nVon: Frankfurt (FRA)\nNach: New York (JFK)\nAbflug: 12.03.2027 10:15\nAnkunft: 12.03.2027 12:55";
    const flights = await getRegexParser().parseEmail("Ihre Buchung", text);
    expect(flights).toHaveLength(1);
    expect(flights[0].flightNumber).toBe("LH400");
  });

  it("declines a leg whose two ends are the same airport", () => {
    expect(
      segmentHasEvidence({ flightNumber: "QR70", departureCode: "DOH", arrivalCode: "DOH", departureTime: "2027-03-12T10:15:00" } as never)
    ).toBe(false);
  });

  it("declines a leg without a date", () => {
    expect(
      segmentHasEvidence({ flightNumber: "QR70", departureCode: "FRA", arrivalCode: "DOH" } as never)
    ).toBe(false);
  });

  it("declines the whole document when one of several legs is incomplete", async () => {
    // Two flight numbers, only one route: returning one leg would present a
    // round trip as a one-way flight.
    const text = "Flug QR 070 Frankfurt (FRA) - Doha (DOH) 15.11.2027 10:35\nFlug QR 071\nRECHNUNG";
    expect(await getRegexParser().parseEmail("Rechnung", text)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect the two document tests' behaviour to show the defect**

Run: `npx jest src/services/parsers/text/__tests__/regexParser.evidence.test.ts`
Expected: FAIL — `segmentHasEvidence` is not exported; after adding a stub that returns `true`, "declines the whole document" still FAILS (today one partial leg is returned). If "returns a complete single flight" fails on today's code, adjust ITS fixture wording until today's reader reads it (it is the positive control and must pass before and after).

- [ ] **Step 3: Implement the gate** — in `regexParser.ts`, above the class:

```ts
/**
 * The generic reader has no knowledge of any sender, so a leg is only real
 * when it carries everything a flight is: a flight number, two DIFFERENT
 * airports from the IATA list and a date. Measured 2026-09-30: every one of
 * the four corpus mails it read, it read wrong.
 */
export function segmentHasEvidence(f: ParsedBooking): boolean {
  const dep = f.departureCode;
  const arr = f.arrivalCode;
  const date = f.departureTime ? Date.parse(f.departureTime) : Number.NaN;
  return Boolean(
    f.flightNumber &&
      dep &&
      arr &&
      dep !== arr &&
      isValidIATACode(dep) &&
      isValidIATACode(arr) &&
      Number.isFinite(date)
  );
}
```

Then make `parseMultipleFlights` end in ONE place that applies it — replace every `return flights;` / `return [singleFlight];` in that method with a call to:

```ts
private withEvidence(flights: ParsedBooking[]): ParsedBooking[] {
  if (flights.length === 0) return [];
  if (flights.every(segmentHasEvidence)) return flights;
  logger.debug({
    operation: "regex_parser_insufficient_evidence",
    reason: "generic_insufficient_evidence",
    legs: flights.length,
  });
  return [];
}
```

(i.e. `return this.withEvidence(flights);` and `return this.withEvidence([singleFlight]);`). The existing "neither a flight number nor a route" early return stays.

- [ ] **Step 4: Run the regex tests**

Run: `npx jest src/services/parsers/text`
Expected: PASS. An existing test that expects a partial or date-less result pinned today's defect — change it and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/text/regexParser.ts backend/src/services/parsers/text/__tests__/regexParser.evidence.test.ts
git commit -m "fix(parser): the generic flight reader returns a booking only when every leg is complete" -m "Corpus 2026-09-30: it read all four mails it answered wrong (Emirates, Egyptair) and turned tour invoices into flights like WHO→WHO. A leg needs a flight number, two different known airports and a date; one incomplete leg declines the document."
```

---

### Task 4: An airline template declines a leg without a flight number

**Files:**
- Modify: `backend/src/services/parsers/text/templateParser.ts:47-53`
- Test: `backend/src/services/parsers/text/__tests__/templateParser.legs.test.ts` (create)

The Lufthansa information mails for a connection carry the legs only in `.ics` attachments; the template read them as one direct flight without a flight number. Reading the attachments needs attachments to reach the parser — that is package 2 (spec §4). This task delivers the other half: no wrong read.

- [ ] **Step 1: Write the failing test**

Read `templateParser.ts` and the airline template tests under `backend/src/services/parsers/templates/__tests__/` first. Build the test from the LH-old template (`templates/airlines/LH-old.json`): take its own `testCases[0].input`, remove the flight-number line(s) from it, and assert:

```ts
it("declines instead of returning a leg without a flight number", async () => {
  const parser = new TemplateParser();
  const result = await parser.parse(subjectFromTestCase, inputWithoutFlightNumber, "");
  expect(result).toEqual([]);
});

it("still reads the template's own complete test case", async () => {
  const parser = new TemplateParser();
  const result = await parser.parse(subjectFromTestCase, testCaseInput, "");
  expect(result.length).toBeGreaterThan(0);
  expect(result.every((r) => Boolean(r.flightNumber))).toBe(true);
});
```

(Use the exact `parse` signature and subject the class takes — copy from its callers in `parsers/email.ts`.)

- [ ] **Step 2: Run — expect the first test to FAIL**

Run: `npx jest src/services/parsers/text/__tests__/templateParser.legs.test.ts`
Expected: "declines…" FAILS (one leg without flight number returned); the positive control passes.

- [ ] **Step 3: Implement** — in `templateParser.ts`, replace the final `return applyTemplateAll(...)…` with:

```ts
const legs = applyTemplateAll(template, text, html ?? "");
// A leg without a flight number is not a flight this template understood —
// the LH connection mails collapsed two legs into one numberless direct
// flight (corpus 2026-09-30). Declining lets the next reader try.
if (legs.length === 0 || legs.some((leg) => !leg.flightNumber)) {
  logger.debug({ template: template.iata, legs: legs.length }, "template declined: leg without flight number");
  return [];
}
return legs.map((parsed) => ({ ...parsed, airlineNotice: notice }));
```

- [ ] **Step 4: Run the parser tests**

Run: `npx jest src/services/parsers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/text/templateParser.ts backend/src/services/parsers/text/__tests__/templateParser.legs.test.ts
git commit -m "fix(parser): an airline template declines rather than return a leg without a flight number" -m "Two Lufthansa connection mails became one numberless direct flight. The legs live in .ics attachments, which reach the parser only with package 2; until then the honest answer is no answer."
```

---

### Task 5: Booking.com location line — spaced postcodes and code-shaped cities

**Files:**
- Modify: `backend/src/services/lodging/bookingComTemplate.ts` (`parseLage`, lines ~253–335; export it)
- Test: `backend/src/__tests__/bookingComTemplate.test.ts`

**Interfaces:**
- Produces: `export function parseLage(raw: string | null): AddressParts` (was module-private; exported for the test).

- [ ] **Step 1: Write the failing tests** — append to `bookingComTemplate.test.ts`:

```ts
import { parseLage } from "../services/lodging/bookingComTemplate";

describe("the location line with foreign postcodes", () => {
  it("reads a Czech postcode with an inner space", () => {
    expect(parseLage("Náměstí 1, 767 01 Kroměříž, Tschechien")).toEqual({
      address: "Náměstí 1",
      postcode: "767 01",
      city: "Kroměříž",
      country: "Tschechien",
    });
  });

  it("does not take a plus-code for the city", () => {
    const parts = parseLage(
      "West Corniche Road, Abu Dhabi, F869C3J, Vereinigte Arabische Emirate"
    );
    expect(parts.city).toBe("Abu Dhabi");
    expect(parts.country).toBe("Vereinigte Arabische Emirate");
  });

  it("reads a German line exactly as before", () => {
    expect(parseLage("Musterstraße 1, 80331 München, Deutschland")).toEqual({
      address: "Musterstraße 1",
      postcode: "80331",
      city: "München",
      country: "Deutschland",
    });
  });
});
```

- [ ] **Step 2: Run — expect the first two to FAIL**

Run: `npx jest src/__tests__/bookingComTemplate.test.ts -t "foreign postcodes"`
Expected: Czech FAILS (city "767…"), plus-code FAILS (city "F869C3J"), German passes (positive control).

- [ ] **Step 3: Implement** in `parseLage`:

1. `export function parseLage(...)`.
2. Widen the European pattern to the spaced form:
   ```ts
   // NL codes look like "2718 RL"; DE/AT/CH are 4-5 digits; CZ/SK/SE/GR write
   // "767 01".
   const postcodeRe = /^(\d{3}\s\d{2}|\d{4,5}(?:\s+[A-Z]{2})?)\s+(.+)$/;
   ```
3. Before the final fallback (`const lastSegment = …`), drop a trailing code-shaped segment so the city is read from the segment before it:
   ```ts
   // A plus-code or bare code in the city slot ("F869C3J") is not a city —
   // the UAE line put one there, and it became the stay's city.
   const codeShaped = /^(?=.*\d)[A-Z0-9+]{4,}$/;
   if (rest.length >= 2 && codeShaped.test(rest[rest.length - 1])) rest.pop();
   ```
   (`rest` must be `let`/mutable at this point, or build a new array: `const cityRest = … ? rest.slice(0, -1) : rest;` and use `cityRest` in the fallback — prefer the new array.)

- [ ] **Step 4: Run the Booking.com and lodging parser tests**

Run: `npx jest src/__tests__/bookingComTemplate.test.ts src/__tests__/lodgingBookingParser.test.ts src/services/lodging`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lodging/bookingComTemplate.ts backend/src/__tests__/bookingComTemplate.test.ts
git commit -m "fix(lodging): Booking.com's location line reads spaced postcodes and refuses a code as the city" -m "Corpus 2026-09-30: a Czech stay imported with the city '767' and a UAE stay with the city 'F869C3J'."
```

---

### Task 6: Measure, record, gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-parser-system-design.md` §3.1.4 (only if not yet amended: attachment reading moved to package 2)
- Modify (gitignored, not committed): `test-samples/*/expectations.json`, `roadmap.local.yaml`

- [ ] **Step 1: Corpus, regex only, every domain**

```bash
cd backend
for d in "Hotel Buchungen:lodging" "AllAccor:lodging" "Flug-emails:flight" "Kreuzfahrt-emails:cruise" "Rundreisen Mails:flight"; do
  dir="${d%%:*}"; dom="${d##*:}"
  npx tsx scripts/parser-corpus.ts --dir "D:/TravStats_Projekt/TravStats/test-samples/$dir" --domain "$dom" --tag correctness --regex-only | tail -4
done
```

Expected: lodging 108 read, the two formerly wrong cities now right; Accor 2/2; flights: the 4 generic mails and 2 LH connection mails now **declined** (0 candidates), the 25 others unchanged; round trips: 0 wrong flights (declined). Any other change is a regression — stop and investigate.

Note: the Kreuzfahrt expectations fail on a DB without the ship catalogue (known measuring artefact, spec §4). Run `npx tsx scripts/seed-test-catalogues.ts` against the measuring DB first.

- [ ] **Step 2: Tighten `test-samples/Flug-emails/expectations.json`** (gitignored) so the six formerly wrong mails expect **zero** candidates, and the corpus run exits 0. This is the ratchet that keeps them from coming back as wrong reads.

- [ ] **Step 3: Full gates**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd .. && npm run check:size
```

Expected: all green. Prettier is checked by the pre-commit hook; measure CI's view with an LF archive (`git -c core.autocrlf=false archive HEAD`) if the Windows checkout disagrees.

- [ ] **Step 4: Board** — in `roadmap.local.yaml`, add an item `parser-correctness-2026-09-30` (`source: { type: owner }`, title "Parser package 1: no wrong reads", version "2.7.0", status `active`, `branch: fix/parser-correctness`). Rebuild the board (`D:\Projekte\CC\tools\leitstand\leitstand.cmd --no-open`).

- [ ] **Step 5: Push and report**

```bash
git push -q forgejo fix/parser-correctness
```

Report the corpus table before/after to the owner and ask — as a single question — whether to merge `fix/parser-correctness` into `main`.
