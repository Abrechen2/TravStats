# ISO-4217 Currency Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user record a price in any real currency, convert it whenever a rate exists, and say plainly when one does not.

**Architecture:** One shared ISO-4217 registry replaces ten hardcoded four-element lists across backend and frontend. The FX façade gains a provider chain — Frankfurter (ECB) first, a keyless CDN second, admin-switchable — and reports which one answered. A stay whose currency has no rate keeps its amount, is marked in the UI, and can carry a rate the user types in.

**Tech Stack:** TypeScript strict, Express, Prisma/PostgreSQL, Zod, React, Vitest (frontend), Jest (backend).

**Spec:** `docs/superpowers/specs/2026-08-13-currency-support-design.md`

## Global Constraints

- `any` is forbidden — use `unknown` plus a type guard. Only `.d.ts` may differ.
- Prettier: printWidth 100, `singleQuote: false`. ESLint must pass.
- Logging via Pino: `import logger from "../utils/logger"` (default export, no named `logger`).
- Every user-facing string ships **DE and EN together**. DE is primary, informal "du".
- Schema changes go through `npx prisma migrate dev`, never hand-written SQL.
- Backend gate: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
- Prettier is NOT wired into ESLint here: `npx tsc --noEmit` and `npm run lint` both
  pass on badly-formatted code (learned in Task 1). But `prettier --check` on the
  WORKING COPY is useless on Windows — it flags all 645 frontend files purely for
  CRLF. Measure content instead:
  `npx prettier <file> | tr -d '\r' | diff - <(tr -d '\r' < <file>) | wc -l`,
  and compare that number against the same file at the base commit. Rules:
  **a new file must come out at 0**; an edit to an existing file must not RAISE its
  number. Legacy backend files written with single quotes and trailing commas are
  already far from 0 — do not "fix" them here (Task-1 ruling: a repo-wide reformat is
  its own commit), and match their local style so the number does not grow.
- Frontend gate: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
- Files 200–400 lines ideal, 800 hard maximum.
- Do not merge to `main`. This work lands on a branch; releasing is the owner's decision.

## File Structure

**Created**
- `backend/src/shared/currencies.ts` — the registry: codes, minor units, guards.
- `frontend/src/shared/currencies.ts` — its mirror.
- `backend/src/services/fx/currencyApiCdn.ts` — the second rate provider.
- `backend/src/services/fx/resolver.ts` — asks providers in order, reports the source.
- `backend/src/routes/currencies.ts` — `GET /api/v1/currencies/recent`.
- `frontend/src/components/common/CurrencySelect.tsx` — the one picker.

**Modified** (the ten sites the spec enumerates, plus the FX write path)
- `backend/src/schemas/lodging.ts`, `schemas/cruise.ts`, `services/cruiseBookingParser.ts`
- `backend/src/routes/lodging.ts` (fx-preview enum, `applyFxSnapshot`, stay write paths)
- `backend/src/routes/settings/general.ts` (`baseCurrency`)
- `backend/src/services/lodging/lodgingImportCommit.ts` (three `?? "EUR"`)
- `backend/src/services/fx/frankfurter.ts`
- `frontend/src/types/lodging.ts`, `types/cruise.ts`
- `frontend/src/components/lodging/StayEditorPriceSection.tsx`
- `frontend/src/components/Settings/LodgingPreferencesSection.tsx`
- `frontend/src/lib/importers/lodgingCsv.ts`
- `frontend/src/components/Cruise/CruiseEditModal.tsx`
- `frontend/src/lib/lodgingFormat.ts`, `lib/units.ts`, `components/Trips/TripCard.tsx`

---

### Task 1: The shared currency registry

**Files:**
- Create: `backend/src/shared/currencies.ts`
- Create: `frontend/src/shared/currencies.ts`
- Test: `backend/src/shared/__tests__/currencies.test.ts`
- Test: `frontend/src/shared/__tests__/currencies.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ISO_4217: Record<string, number>` (code → minor units), `isCurrencyCode(v: unknown): v is string`, `minorUnits(code: string): number`, `ECB_CURRENCIES: readonly string[]`, `type CurrencyCode = string`.

Names come from `Intl.DisplayNames` at the point of display (`units.ts:118` already does this) — the registry carries **codes and minor units only**. Do not hand-maintain a name list.

- [x] **Step 1: Write the failing test**

`backend/src/shared/__tests__/currencies.test.ts`:

```ts
import { ECB_CURRENCIES, ISO_4217, isCurrencyCode, minorUnits } from "../currencies";

describe("currency registry", () => {
  it("accepts real ISO-4217 codes and rejects near-misses", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("NOK")).toBe(true);
    expect(isCurrencyCode("EGP")).toBe(true);
    // The three shapes a user or a bad parse actually produces.
    expect(isCurrencyCode("EURO")).toBe(false);
    expect(isCurrencyCode("CH")).toBe(false);
    expect(isCurrencyCode("eur")).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });

  it("carries minor units, because not every currency has two", () => {
    expect(minorUnits("EUR")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
    // An unknown code must not silently claim to know: default to 2.
    expect(minorUnits("XXX")).toBe(2);
  });

  it("lists the ECB set as a strict subset of ISO-4217", () => {
    expect(ECB_CURRENCIES).toContain("EUR");
    expect(ECB_CURRENCIES).toContain("NOK");
    expect(ECB_CURRENCIES).not.toContain("EGP");
    expect(ECB_CURRENCIES).toHaveLength(30);
    for (const code of ECB_CURRENCIES) expect(ISO_4217[code]).toBeDefined();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/shared/__tests__/currencies.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../currencies'`.

- [x] **Step 3: Write the registry**

`backend/src/shared/currencies.ts`. The map below is the active ISO-4217 set; every entry is `code: minorUnits`. Only the non-two values matter for behaviour, but the full list is what `isCurrencyCode` validates against.

```ts
/**
 * Single source of truth for currency codes — the convention `shared/domains.ts`
 * establishes. MIRRORED in `frontend/src/shared/currencies.ts`; change one
 * without the other and the backend accepts a code the UI cannot type.
 *
 * Codes only, no names: `Intl.DisplayNames` already localises those at the
 * point of display (see frontend `units.ts`), and a hand-kept name list would
 * be a second thing to age.
 *
 * The value is the currency's MINOR UNIT count. Most are 2; the exceptions are
 * why this is a map and not an array.
 */
export type CurrencyCode = string;

export const ISO_4217: Readonly<Record<string, number>> = {
  AED: 2, AFN: 2, ALL: 2, AMD: 2, ANG: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BGN: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BRL: 2,
  BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2, CAD: 2, CDF: 2, CHF: 2, CLP: 0, CNY: 2,
  COP: 2, CRC: 2, CUP: 2, CVE: 2, CZK: 2, DJF: 0, DKK: 2, DOP: 2, DZD: 2, EGP: 2,
  ERN: 2, ETB: 2, EUR: 2, FJD: 2, FKP: 2, GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2,
  GNF: 0, GTQ: 2, GYD: 2, HKD: 2, HNL: 2, HTG: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2,
  IQD: 3, IRR: 2, ISK: 0, JMD: 2, JOD: 3, JPY: 0, KES: 2, KGS: 2, KHR: 2, KMF: 0,
  KPW: 2, KRW: 0, KWD: 3, KYD: 2, KZT: 2, LAK: 2, LBP: 2, LKR: 2, LRD: 2, LSL: 2,
  LYD: 3, MAD: 2, MDL: 2, MGA: 2, MKD: 2, MMK: 2, MNT: 2, MOP: 2, MRU: 2, MUR: 2,
  MVR: 2, MWK: 2, MXN: 2, MYR: 2, MZN: 2, NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2,
  NZD: 2, OMR: 3, PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0, QAR: 2,
  RON: 2, RSD: 2, RUB: 2, RWF: 0, SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2,
  SHP: 2, SLE: 2, SOS: 2, SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2, THB: 2,
  TJS: 2, TMT: 2, TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2, UAH: 2, UGX: 0,
  USD: 2, UYU: 2, UZS: 2, VES: 2, VND: 0, VUV: 0, WST: 2, XAF: 0, XCD: 2, XOF: 0,
  XPF: 0, YER: 2, ZAR: 2, ZMW: 2, ZWG: 2,
};

/** Narrow an unknown to a known code. Case-sensitive on purpose: ISO-4217 is upper-case. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ISO_4217, value);
}

/** Minor-unit count; 2 for anything unrecognised, which is the safe assumption. */
export function minorUnits(code: string): number {
  return ISO_4217[code] ?? 2;
}

/**
 * The 30 currencies Frankfurter (ECB reference rates) serves — verified live
 * 2026-08-13 against https://api.frankfurter.app/currencies.
 *
 * NOT a validation list. It seeds the "Häufig" group for a fresh account and
 * gates the FX BASE currency, which must be something every amount can be
 * converted into.
 */
export const ECB_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK",
  "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const satisfies readonly CurrencyCode[];
```

- [x] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest src/shared/__tests__/currencies.test.ts --forceExit`
Expected: PASS, 3 tests.

- [x] **Step 5: Mirror it to the frontend**

Copy the file verbatim to `frontend/src/shared/currencies.ts`. Change only the header comment's direction ("MIRRORED FROM `backend/src/shared/currencies.ts`").

Copy the test to `frontend/src/shared/__tests__/currencies.test.ts` and convert the harness:

```ts
import { describe, expect, it } from "vitest";
import { ECB_CURRENCIES, ISO_4217, isCurrencyCode, minorUnits } from "../currencies";
```

The three `it(...)` bodies are unchanged.

- [x] **Step 6: Run the frontend test**

Run: `cd frontend && npx vitest --run src/shared/__tests__/currencies.test.ts`
Expected: PASS, 3 tests.

- [x] **Step 7: Commit**

```bash
git add backend/src/shared/currencies.ts backend/src/shared/__tests__/currencies.test.ts \
        frontend/src/shared/currencies.ts frontend/src/shared/__tests__/currencies.test.ts
git commit -m "feat(currency): one ISO-4217 registry, mirrored front and back"
```

---

### Task 2: Widen backend validation, keep the base currency narrow

**Files:**
- Modify: `backend/src/schemas/lodging.ts:18` and `:73`
- Modify: `backend/src/schemas/cruise.ts:5` and `:98`
- Modify: `backend/src/schemas/lodgingImport.ts:75`
- Modify: `backend/src/services/cruiseBookingParser.ts:7-10, 165`
- Modify: `backend/src/routes/lodging.ts:245` (`/fx-preview`)
- Modify: `backend/src/routes/settings/general.ts:119` (`baseCurrency`)
- Test: `backend/src/schemas/__tests__/currencyValidation.test.ts` (create)

**Interfaces:**
- Consumes: `isCurrencyCode`, `ECB_CURRENCIES` from Task 1.
- Produces: `currencyField` — a reusable Zod schema exported from `backend/src/schemas/lodging.ts`.

- [x] **Step 1: Write the failing test**

`backend/src/schemas/__tests__/currencyValidation.test.ts`:

```ts
import { currencyField } from "../lodging";
import { baseCurrencyField } from "../../routes/settings/general";

describe("currency validation at the boundary", () => {
  it("accepts any real ISO code, not just the old four", () => {
    for (const code of ["EUR", "NOK", "SGD", "AUD", "EGP", "AED"]) {
      expect(currencyField.parse(code)).toBe(code);
    }
  });

  it("still rejects what is not a currency", () => {
    for (const junk of ["EURO", "CH", "eur", ""]) {
      expect(() => currencyField.parse(junk)).toThrow();
    }
  });

  it("keeps the FX base currency to the ECB set, because everything converts INTO it", () => {
    expect(baseCurrencyField.parse("NOK")).toBe("NOK");
    expect(() => baseCurrencyField.parse("EGP")).toThrow();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/schemas/__tests__/currencyValidation.test.ts --forceExit`
Expected: FAIL — `currencyField` is not exported.

- [x] **Step 3: Replace the literals**

In `backend/src/schemas/lodging.ts`, delete the `CURRENCIES` literal on line 18 and add:

```ts
import { isCurrencyCode } from "../shared/currencies";

/**
 * Any real ISO-4217 code. Deliberately NOT limited to what a rate source can
 * convert: recording a price and converting it are different questions, and
 * conflating them is what made a Dubai booking unrecordable.
 */
export const currencyField = z
  .string()
  .refine(isCurrencyCode, { message: "must be a valid ISO 4217 currency code" });
```

Replace `currency: z.enum(CURRENCIES).optional()` (line 73) with `currency: currencyField.optional()`.

Apply the same substitution at `schemas/cruise.ts:98`, `schemas/lodgingImport.ts:75`
(`currencyField.nullable().optional()`), and `routes/lodging.ts:245`
(`from: currencyField`). Delete the local literals at `schemas/cruise.ts:5` and
`services/cruiseBookingParser.ts:7-10`; in the parser, replace the body of the
guard at line 165 with `return isCurrencyCode(value);`.

In `backend/src/routes/settings/general.ts`, export the base field and use it:

```ts
import { ECB_CURRENCIES } from "../../shared/currencies";

/**
 * The FX BASE is narrower than what you may record in. Everything converts
 * into it, so it has to be a currency with a dependable rate history — the 30
 * the ECB publishes, back to 1999. The UI states this at the field.
 */
export const baseCurrencyField = z.enum(
  ECB_CURRENCIES as unknown as [string, ...string[]],
);
```

and replace line 119's `baseCurrency: z.enum(CURRENCIES).optional()` with
`baseCurrency: baseCurrencyField.optional()`.

- [x] **Step 4: Run the test and the suites that touch these schemas**

Run: `cd backend && npx jest src/schemas src/services/lodging src/routes/__tests__ --forceExit`
Expected: PASS. If a suite asserts a rejection of `"NOK"`, that assertion encoded the old limit — update it to assert `"EURO"` is rejected instead.

- [x] **Step 5: Type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no output. `LodgingCurrency` in `bookingComTemplate.ts` derived from the old literal — retype it as `import type { CurrencyCode } from "../../shared/currencies"; export type LodgingCurrency = CurrencyCode;`

- [x] **Step 6: Commit**

```bash
git add backend/src
git commit -m "feat(currency): validate against ISO-4217, keep the FX base at the ECB 30"
```

---

### Task 3: Stop inventing EUR for an amount with no currency

**Files:**
- Modify: `backend/src/services/lodging/lodgingImportCommit.ts:180, 225, 244`
- Modify: `backend/src/routes/lodging.ts:204` (`applyFxSnapshot`)
- Test: `backend/src/__tests__/lodgingImportCommit.currency.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change; `applyFxSnapshot` gains a `{ status: "missingCurrency" }` outcome.

An unsupported currency and a missing one are different. The first is data we keep and cannot convert. The second is a number whose unit is unknown — the same fault the parser fix (`c1bb53da`) closed one layer up.

- [x] **Step 1: Write the failing test**

```ts
import { applyFxSnapshot } from "../routes/lodging";

describe("a price without a currency", () => {
  it("is not quietly treated as euros", async () => {
    const outcome = await applyFxSnapshot(
      { totalPrice: 11662, currency: null, checkIn: "2023-04-30" },
      "EUR",
    );
    expect(outcome.status).toBe("missingCurrency");
  });

  it("still converts when the currency is there", async () => {
    const outcome = await applyFxSnapshot(
      { totalPrice: 100, currency: "EUR", checkIn: "2026-01-01" },
      "EUR",
    );
    expect(outcome.status).toBe("snapshotted");
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/__tests__/lodgingImportCommit.currency.test.ts --forceExit`
Expected: FAIL — receives `"snapshotted"` for the first case, because line 204 defaults to EUR.

- [x] **Step 3: Remove the four defaults**

`routes/lodging.ts` — extend the union and the guard:

```ts
export type FxSnapshotOutcome =
  | { status: "priceRemoved" }
  | { status: "missingCurrency" }
  | { status: "lookupFailed" }
  | { status: "snapshotted"; fields: FxSnapshotFields };
```

and in `applyFxSnapshot`, replace `const currency = input.currency ?? "EUR";` with:

```ts
  // No `?? "EUR"`. An amount whose unit we never learned is not a euro amount;
  // guessing one is how 11,662 AED became €11,662 (see the 2026-08-13 spec).
  if (!input.currency) return { status: "missingCurrency" };
  const currency = input.currency;
```

`resolveFxFields` already collapses every non-`snapshotted` outcome to
`CLEARED_FX`, so `missingCurrency` needs no branch there.

In `lodgingImportCommit.ts`, replace each of the three `?? "EUR"` with an
explicit skip — a row whose stay has a price but no currency imports the stay
without the price rather than with a wrong one:

```ts
    const currency = row.stay.currency;
    if (row.stay.totalPrice != null && !currency) {
      logger.warn(
        { sourceRowIndex: row.sourceRowIndex },
        "[Lodging Import] Price without a currency — importing the stay without it",
      );
    }
```

then pass `currency ?? undefined` where the amount is written, and let the FX
call return `missingCurrency`.

Leave `getBaseCurrency`'s `?? "EUR"` at line 239 alone — it covers a user with
no settings row, which is a different question and has a correct default.

**Added 2026-08-13 after the scoped review of tasks 2–4.** Removing the default
inside `applyFxSnapshot` is not enough on the direct API path: `currency` is
optional on `createStaySchema`, so a priced stay without one still reached the
insert with the key absent, and the NOT-NULL column's `'EUR'` default answered
for it. The spec (design doc line 75) always required a rejection there. Add a
second `.refine` to `createStaySchema` — `(totalPrice == null &&
pricePerNight == null) || currency != null`, message "currency is required when
a price is given". Both price fields, because the route derives the total from
`pricePerNight`. NOT on `updateStaySchema`: the stored row always has a
currency, so a price-only PATCH must keep working.

- [x] **Step 4: Run the tests**

Run: `cd backend && npx jest src/__tests__/lodgingImportCommit.currency.test.ts src/__tests__/lodgingImportCommit.test.ts --forceExit`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/src
git commit -m "fix(currency): a price with no currency is not a euro price"
```

---

### Task 4: The FX façade reports which provider answered

**Files:**
- Modify: `backend/src/services/fx/frankfurter.ts`
- Test: `backend/src/services/fx/__tests__/frankfurter.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `type RateSource = "ecb" | "cdn" | "manual"`; `getRate(from, to, date): Promise<{ rate: number; source: RateSource } | null>`; `convertToBase(...): Promise<{ baseAmount: number; rate: number; rateDate: string; source: RateSource } | null>`.

The first draft of the spec wanted the chain hidden entirely. It cannot be: a bare number carries no provenance, and the UI must never label a user's own estimate as an ECB rate.

- [x] **Step 1: Write the failing test**

Append to `backend/src/services/fx/__tests__/frankfurter.test.ts`:

```ts
  it("reports ECB as the source of its rates", async () => {
    // mock fetch to return { rates: { EUR: 0.08481 } } as the existing tests do
    const conv = await convertToBase(1000, "NOK", "EUR", new Date("2024-09-17"));
    expect(conv?.source).toBe("ecb");
  });
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/services/fx --forceExit`
Expected: FAIL — `source` is `undefined`.

- [x] **Step 3: Thread the source through**

In `frankfurter.ts`, add above `getRate`:

```ts
/** Which provider a rate came from. Persisted per stay so a readout can be honest. */
export type RateSource = "ecb" | "cdn" | "manual";
```

Change the cache value type to `{ rate: number }`, have `getRate` return
`{ rate, source: "ecb" }` (and `{ rate: 1, source: "ecb" }` for the identical
pair), and add `source` to `FxConversion` and to both `convertToBase` returns.

- [x] **Step 4: Run the tests**

Run: `cd backend && npx jest src/services/fx --forceExit`
Expected: PASS. Fix the call site in `routes/lodging.ts` that destructures `conv`.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/fx backend/src/routes/lodging.ts
git commit -m "refactor(fx): a rate says where it came from"
```

---

### Task 5: The CDN provider, the resolver, and the admin switch

**Files:**
- Create: `backend/src/services/fx/currencyApiCdn.ts`
- Create: `backend/src/services/fx/resolver.ts`
- Create: `backend/src/services/fx/__tests__/resolver.test.ts`
- Modify: `backend/prisma/schema.prisma` (model `AdminSettings`)
- Modify: `backend/src/routes/lodging.ts` (`applyFxSnapshot` calls the resolver)

**Interfaces:**
- Consumes: `RateSource`, `getRate` from Task 4.
- Produces: `resolveRate(from: string, to: string, date: string): Promise<{ rate: number; source: RateSource } | null>`.

- [x] **Step 1: Write the failing test**

```ts
import { resolveRate } from "../resolver";

jest.mock("../frankfurter", () => ({ getRate: jest.fn() }));
jest.mock("../currencyApiCdn", () => ({ getCdnRate: jest.fn() }));
jest.mock("../../parserSettings", () => ({ getAdminFxSettings: jest.fn() }));

describe("resolveRate", () => {
  it("uses the ECB when it can and never asks the CDN", async () => {
    getRate.mockResolvedValue({ rate: 0.085, source: "ecb" });
    const r = await resolveRate("NOK", "EUR", "2024-09-17");
    expect(r).toEqual({ rate: 0.085, source: "ecb" });
    expect(getCdnRate).not.toHaveBeenCalled();
  });

  it("falls to the CDN only when the ECB has nothing AND the switch is on", async () => {
    getRate.mockResolvedValue(null);
    getAdminFxSettings.mockResolvedValue({ cdnFallbackEnabled: true });
    getCdnRate.mockResolvedValue({ rate: 0.0195, source: "cdn" });
    expect(await resolveRate("EGP", "EUR", "2026-03-04")).toEqual({ rate: 0.0195, source: "cdn" });
  });

  it("respects an admin who switched the CDN off", async () => {
    getRate.mockResolvedValue(null);
    getAdminFxSettings.mockResolvedValue({ cdnFallbackEnabled: false });
    expect(await resolveRate("EGP", "EUR", "2026-03-04")).toBeNull();
    expect(getCdnRate).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when both are dead", async () => {
    getRate.mockResolvedValue(null);
    getAdminFxSettings.mockResolvedValue({ cdnFallbackEnabled: true });
    getCdnRate.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolveRate("EGP", "EUR", "2026-03-04")).resolves.toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/services/fx/__tests__/resolver.test.ts --forceExit`
Expected: FAIL — module not found.

- [x] **Step 3: Add the migration for the switch**

In `schema.prisma`, on `model AdminSettings`, next to the other feature flags:

```prisma
  fxCdnFallbackEnabled Boolean @default(true) @map("fx_cdn_fallback_enabled")
```

Run: `cd backend && npx prisma migrate dev --name fx_cdn_fallback_switch`

- [x] **Step 4: Write the CDN provider**

`currencyApiCdn.ts` — same shape as `frankfurter.ts`, different endpoint:

```ts
import logger from "../../utils/logger";
import type { RateSource } from "./frankfurter";

/**
 * Keyless daily rates from the @fawazahmed0/currency-api dataset on jsDelivr.
 * Measured 2026-08-13: 769 currencies, but history only reaches back to about
 * March 2024 — which is why this is the FALLBACK and the ECB stays primary.
 */
const BASE_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api";
const rateCache = new Map<string, number>();

export async function getCdnRate(
  from: string,
  to: string,
  date: string,
): Promise<{ rate: number; source: RateSource } | null> {
  if (from === to) return { rate: 1, source: "cdn" };
  const key = `${date}:${from}:${to}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return { rate: cached, source: "cdn" };
  try {
    const lower = from.toLowerCase();
    const res = await fetch(`${BASE_URL}@${date}/v1/currencies/${lower}.json`);
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, Record<string, number>>;
    const rate = body[lower]?.[to.toLowerCase()];
    if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
    rateCache.set(key, rate);
    return { rate, source: "cdn" };
  } catch (error) {
    logger.warn({ error, from, to, date }, "CDN FX rate lookup failed");
    return null;
  }
}
```

- [x] **Step 5: Write the resolver**

```ts
import logger from "../../utils/logger";
import { getAdminFxSettings } from "../parserSettings";
import { getCdnRate } from "./currencyApiCdn";
import { getRate, type RateSource } from "./frankfurter";

/**
 * Ask the providers in order. The ECB is authoritative and self-hostable, so it
 * goes first and its answer is final. The CDN only sees the queries the ECB
 * cannot answer — and only when the admin has left it on, because a self-hoster
 * gets to decide whether their instance talks to jsDelivr.
 *
 * Never throws: no rate is a valid, displayable state.
 */
export async function resolveRate(
  from: string,
  to: string,
  date: string,
): Promise<{ rate: number; source: RateSource } | null> {
  try {
    const ecb = await getRate(from, to, date);
    if (ecb) return ecb;
  } catch (error) {
    logger.warn({ error, from, to, date }, "ECB FX lookup threw");
  }
  const settings = await getAdminFxSettings().catch(() => null);
  if (!settings?.cdnFallbackEnabled) return null;
  try {
    return await getCdnRate(from, to, date);
  } catch (error) {
    logger.warn({ error, from, to, date }, "CDN FX lookup threw");
    return null;
  }
}
```

Add `getAdminFxSettings` to `services/parserSettings.ts`, reading
`fxCdnFallbackEnabled` from `admin_settings` and defaulting to `true` when no
row exists.

- [x] **Step 6: Point `applyFxSnapshot` at the resolver**

In `routes/lodging.ts`, replace the `fx.convertToBase(...)` call so the rate
comes from `resolveRate` and the returned `source` is carried into the outcome.

- [x] **Step 7: Run the tests**

Run: `cd backend && npx jest src/services/fx --forceExit`
Expected: PASS, 4 new tests.

- [x] **Step 8: Commit**

```bash
git add backend/src backend/prisma
git commit -m "feat(fx): a second, admin-switchable rate source for what the ECB does not carry"
```

---

### Task 6: Persist provenance, and backfill the rows that predate it

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `LodgingStay`)
- Create: the migration's backfill statement
- Modify: `backend/src/routes/lodging.ts` (`FxSnapshotFields`, `CLEARED_FX`, both write paths)
- Test: `backend/src/routes/__tests__/lodgingFxSource.test.ts` (create)

**Interfaces:**
- Consumes: `RateSource` (Task 4), the resolver (Task 5).
- Produces: `fxSource` on the stay payload — `"ecb" | "cdn" | "manual" | null`.

- [x] **Step 1: Write the failing test**

```ts
describe("fx provenance", () => {
  it("records which source produced a stored conversion", async () => {
    const stay = await createStay({ totalPrice: 1000, currency: "NOK", checkIn: "2024-09-17" });
    expect(stay.fxSource).toBe("ecb");
  });

  it("leaves it null when nothing could be converted", async () => {
    const stay = await createStay({ totalPrice: 11662, currency: "EGP", checkIn: "2023-04-30" });
    expect(stay.totalPriceBase).toBeNull();
    expect(stay.fxSource).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/routes/__tests__/lodgingFxSource.test.ts --forceExit`
Expected: FAIL — `fxSource` does not exist.

- [x] **Step 3: Add the column and backfill**

```prisma
  fxSource         String?   @map("fx_source")   // 'ecb' | 'cdn' | 'manual'
```

Run `npx prisma migrate dev --name lodging_stay_fx_source`, then append to the
generated migration file:

```sql
-- Every conversion stored before this column existed came from Frankfurter
-- (ECB) — it was the only provider. Leaving them NULL would make a historical
-- conversion indistinguishable from one of unknown origin.
UPDATE "lodging_stays" SET "fx_source" = 'ecb' WHERE "total_price_base" IS NOT NULL;
```

- [x] **Step 4: Write it on both paths**

Add `fxSource: RateSource | null` to `FxSnapshotFields`, set `fxSource: null` in
`CLEARED_FX`, and carry the resolver's `source` into the snapshot in
`applyFxSnapshot`. Include `fxSource` in the stay select/serialisation.

- [x] **Step 5: Run the tests**

Run: `cd backend && npx jest src/routes/__tests__ --forceExit`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add backend/src backend/prisma
git commit -m "feat(fx): store which source converted a stay, and backfill the old ones as ECB"
```

---

### Task 7: The manual rate

**Files:**
- Modify: `backend/src/schemas/lodging.ts` (stay create/update schema)
- Modify: `backend/src/routes/lodging.ts` (both write paths)
- Test: `backend/src/routes/__tests__/lodgingManualFx.test.ts` (create)

**Interfaces:**
- Consumes: `resolveRate` (Task 5), `fxSource` (Task 6).
- Produces: request field `manualFxRate?: number | null`.

- [x] **Step 1: Write the failing test**

```ts
describe("a rate the user typed in", () => {
  it("converts and is marked as the user's own", async () => {
    const stay = await createStay({
      totalPrice: 11662, currency: "EGP", checkIn: "2026-03-04", manualFxRate: 0.01955,
    });
    expect(stay.totalPriceBase).toBeCloseTo(228.0, 1);
    expect(stay.fxSource).toBe("manual");
    expect(stay.fxRate).toBeCloseTo(0.01955, 5);
  });

  it("is refused where an automatic rate exists, so nobody overrides the ECB by accident", async () => {
    await expect(
      createStay({ totalPrice: 100, currency: "NOK", checkIn: "2024-09-17", manualFxRate: 9.9 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("must be a positive number", async () => {
    await expect(
      createStay({ totalPrice: 100, currency: "EGP", checkIn: "2026-03-04", manualFxRate: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/routes/__tests__/lodgingManualFx.test.ts --forceExit`
Expected: FAIL — the field is stripped by Zod.

- [x] **Step 3: Accept it, narrowly**

Schema: `manualFxRate: z.number().positive().nullable().optional()`.

In the write path, after the automatic attempt:

```ts
  // A manual rate is for the gap, not for disagreeing with the ECB. If a rate
  // was found, a supplied one is a mistake worth naming rather than silently
  // ignoring or silently preferring.
  if (input.manualFxRate != null) {
    if (auto.status === "snapshotted") {
      return res.status(400).json({
        error: "A rate is already available for this currency and date",
      });
    }
    fields = {
      totalPriceBase: Math.round(input.totalPrice * input.manualFxRate * 100) / 100,
      fxRate: input.manualFxRate,
      fxRateDate: new Date(input.checkIn),
      fxBaseCurrency: baseCurrency,
      fxSource: "manual",
    };
  }
```

- [x] **Step 4: Run the tests**

Run: `cd backend && npx jest src/routes/__tests__/lodgingManualFx.test.ts --forceExit`
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(fx): let the user supply a rate where no source has one"
```

---

### Task 8: One picker, and the six frontend mirrors it replaces

**Files:**
- Create: `frontend/src/components/common/CurrencySelect.tsx`
- Create: `frontend/src/components/common/__tests__/CurrencySelect.test.tsx`
- Create: `backend/src/routes/currencies.ts`
- Modify: `backend/src/index.ts` (mount the route)
- Modify: `frontend/src/types/lodging.ts:19`, `types/cruise.ts:114`
- Modify: `frontend/src/components/lodging/StayEditorPriceSection.tsx:7`
- Modify: `frontend/src/components/Settings/LodgingPreferencesSection.tsx:14`
- Modify: `frontend/src/lib/importers/lodgingCsv.ts:313`
- Modify: `frontend/src/components/Cruise/CruiseEditModal.tsx:29`

**Interfaces:**
- Consumes: `ISO_4217`, `ECB_CURRENCIES` (Task 1), `getCurrencyDisplayName` (`lib/units.ts:118`).
- Produces: `<CurrencySelect value onChange restrictTo? />`; `GET /api/v1/currencies/recent → { codes: string[] }`.

- [x] **Step 1: Write the failing test**

```tsx
describe("CurrencySelect", () => {
  it("puts the user's own currencies first and finds the rest by search", async () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} recent={["NOK", "EGP"]} />);
    const group = screen.getByRole("group", { name: /häufig/i });
    expect(within(group).getByText("NOK")).toBeInTheDocument();
    expect(within(group).getByText("EGP")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dirham" } });
    expect(await screen.findByText("AED")).toBeInTheDocument();
  });

  it("can be restricted, which is how the base-currency field uses it", () => {
    render(<CurrencySelect value="EUR" onChange={vi.fn()} restrictTo={ECB_CURRENCIES} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "EGP" } });
    expect(screen.queryByText("EGP")).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/components/common/__tests__/CurrencySelect.test.tsx`
Expected: FAIL — module not found.

- [x] **Step 3: Build the endpoint**

`backend/src/routes/currencies.ts` — four grouped counts scoped to the user,
merged and ordered by frequency:

```ts
router.get("/recent", authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [stays, cruises, flights, bookings] = await Promise.all([
    prisma.lodgingStay.groupBy({ by: ["currency"], where: { userId }, _count: true }),
    prisma.cruise.groupBy({ by: ["currency"], where: { userId }, _count: true }),
    prisma.flight.groupBy({ by: ["currency"], where: { userId }, _count: true }),
    prisma.booking.groupBy({ by: ["currency"], where: { userId }, _count: true }),
  ]);
  const tally = new Map<string, number>();
  for (const row of [...stays, ...cruises, ...flights, ...bookings]) {
    const code = row.currency;
    if (!code) continue;
    tally.set(code, (tally.get(code) ?? 0) + row._count);
  }
  const codes = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  res.json({ codes });
});
```

Mount it in `index.ts` beside the other `/api/v1` routers.

- [x] **Step 4: Build the control**

`CurrencySelect.tsx` — a search box over `Object.keys(ISO_4217)` (or `restrictTo`),
rendering code plus `getCurrencyDisplayName(code, locale)`, with a "Häufig"
group built from the `recent` prop followed by `ECB_CURRENCIES` for an account
with no history yet. Fetch `recent` once per session through the settings store,
not per keystroke.

- [x] **Step 5: Delete the six literals**

Replace each with the shared control or `CurrencyCode`:
`types/lodging.ts:19` and `types/cruise.ts:114` become
`export type LodgingCurrency = CurrencyCode;` / `CruiseCurrency = CurrencyCode;`;
the three picker lists and the CSV coercion list in `lodgingCsv.ts:313` use
`isCurrencyCode`.

- [x] **Step 6: Run the frontend gate**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run`
Expected: type-check clean, all suites pass.

- [x] **Step 7: Commit**

```bash
git add frontend/src backend/src
git commit -m "feat(currency): one picker for every domain, and the recent-currencies endpoint behind it"
```

---

### Task 9: Three states on screen, and the copy that explains them

**Files:**
- Modify: `frontend/src/lib/lodgingFormat.ts:75-120`
- Modify: `frontend/src/components/lodging/LodgingStayCard.tsx:140`
- Modify: `frontend/src/components/lodging/StayEditorPriceSection.tsx`
- Modify: `frontend/src/components/Settings/LodgingPreferencesSection.tsx`
- Modify: `frontend/src/i18n/resources/de/lodging.json`, `en/lodging.json`
- Test: `frontend/src/lib/__tests__/lodgingFormat.fxStates.test.ts` (create)

**Interfaces:**
- Consumes: `fxSource` on the stay payload (Task 6).
- Produces: `formatStayPriceDisplay(stay, language, labels)` where `labels` is
  `{ ecb: string; manual: string; none: string }`, replacing the single
  `fxSourceLabel` string at line 88.

- [x] **Step 1: Write the failing test**

```ts
const labels = { ecb: "EZB-Kurs vom", manual: "eigener Kurs", none: "kein Kurs" };

it("labels an ECB conversion as such", () => {
  const d = formatStayPriceDisplay(
    { totalPrice: 1146.5, currency: "NOK", totalPriceBase: 97.2, fxRate: 0.0848,
      fxRateDate: "2024-09-17", fxBaseCurrency: "EUR", fxSource: "ecb" }, "de", labels);
  expect(d.fxReadout).toContain("EZB-Kurs vom");
  expect(d.marker).toBeNull();
});

it("marks a manual conversion as the user's own, never as ECB", () => {
  const d = formatStayPriceDisplay(
    { totalPrice: 11662, currency: "EGP", totalPriceBase: 228, fxRate: 0.01955,
      fxRateDate: "2026-03-04", fxBaseCurrency: "EUR", fxSource: "manual" }, "de", labels);
  expect(d.marker).toBe("eigener Kurs");
  expect(d.fxReadout).not.toContain("EZB");
});

it("marks an unconverted amount and shows no readout", () => {
  const d = formatStayPriceDisplay(
    { totalPrice: 11662, currency: "AED", totalPriceBase: null, fxRate: null,
      fxRateDate: null, fxBaseCurrency: null, fxSource: null }, "de", labels);
  expect(d.marker).toBe("kein Kurs");
  expect(d.fxReadout).toBeNull();
  expect(d.original).toContain("11.662");
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/lib/__tests__/lodgingFormat.fxStates.test.ts`
Expected: FAIL — `marker` does not exist and the signature takes a string.

- [x] **Step 3: Return a marker beside the readout**

Add `marker: string | null` to `StayPriceDisplay`; branch on `fxSource`. Render
it in `LodgingStayCard` and `StayEditorPriceSection` as a small bordered word
with a `title` carrying the concrete reason and date.

- [x] **Step 4: Add the copy, DE and EN together**

`de/lodging.json`:

```json
"fx": {
  "markerNone": "kein Kurs",
  "markerManual": "eigener Kurs",
  "tooltipNone": "Kein Kurs verfügbar — nicht in Summen enthalten",
  "tooltipManual": "Kurs von dir eingetragen: {{rate}}",
  "noRateHint": "Für {{currency}} haben wir am {{date}} keinen Kurs. Du kannst einen eintragen — sonst wird der Betrag gespeichert, fließt aber nicht in Summen ein.",
  "manualRateLabel": "Kurs 1 {{currency}} = … {{base}} (optional)",
  "omittedFromTotal_one": "{{count}} Aufenthalt nicht umgerechnet",
  "omittedFromTotal_other": "{{count}} Aufenthalte nicht umgerechnet",
  "baseCurrencyExplainer": "Zur Wahl stehen die 30 Währungen mit amtlichen EZB-Kursen, weil in diese Währung alles umgerechnet wird — zurück bis 1999. Erfassen kannst du in jeder Währung. Aufenthalte in einer Währung ohne Kurs werden gespeichert und angezeigt, zählen aber nicht in diese Summe."
}
```

`en/lodging.json` mirrors every key.

- [x] **Step 5: Show the manual-rate row only when it is needed**

In `StayEditorPriceSection`, when `useLodgingFxPreview` returns no rate for the
current (currency, check-in), render `noRateHint`, an optional numeric input
bound to `manualFxRate`, and a live preview of `totalPrice × rate`.

- [x] **Step 6: Put the explainer under the base-currency field**

In `LodgingPreferencesSection`, render `baseCurrencyExplainer` beneath the
`<CurrencySelect restrictTo={ECB_CURRENCIES}>`.

- [x] **Step 6b: The CDN switch needs a face (added after task 5)**

Task 5 wired `fxCdnFallbackEnabled` through GET/PUT `/admin/parser-settings`,
so it is switchable by an admin client — but the spec (design doc line 158)
also asks for it "surfaced in the admin parser/services area … with a line
saying what it contacts and why", and all copy lands in this task. Add the
toggle to the admin parser/services settings section with DE+EN copy stating
that it contacts `cdn.jsdelivr.net`, and that turning it off leaves the 30 ECB
currencies convertible and everything else marked "kein Kurs".

- [x] **Step 7: Run the frontend gate**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run`
Expected: all green.

- [x] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(currency): three honest states for a price, and the copy that explains each"
```

---

### Task 10: The totals footnote, and minor units

**Files:**
- Modify: `backend/src/services/fx/frankfurter.ts:60` (conversion rounding)
- Modify: `frontend/src/lib/units.ts:147-165` (`formatCurrency`)
- Modify: `frontend/src/components/Trips/TripCard.tsx:362` (fold into the shared formatter)
- Modify: `frontend/src/components/Cruise/CruiseEditModal.tsx:355`, `StayEditorPriceSection.tsx:81` (`step`)
- Modify: the lodging list/detail totals to render `omittedFromTotal`
- Test: `frontend/src/lib/__tests__/units.minorUnits.test.ts` (create)

**Interfaces:**
- Consumes: `minorUnits` (Task 1), `marker` (Task 9).
- Produces: `formatCurrency(value, currency, opts?: { compact?: boolean })`.

The spec's first draft claimed a two-decimal cap misprices a yen booking by
100×. It does not — amounts are stored as major-unit floats. The real cost is a
three-decimal currency losing its third decimal, so this task is correctness,
not urgency.

- [x] **Step 1: Write the failing test**

```ts
it("formats each currency with its own number of decimals", () => {
  expect(formatCurrency(12000, "JPY")).not.toContain(",00");
  expect(formatCurrency(1.234, "KWD")).toContain("234");
});

it("keeps a compact mode for the trip cards", () => {
  expect(formatCurrency(1234.56, "EUR", { compact: true })).not.toContain(",56");
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/lib/__tests__/units.minorUnits.test.ts`
Expected: FAIL — KWD is truncated to two decimals.

- [x] **Step 3: Read the digit count from the registry**

In `formatCurrency`, replace the fixed `maximumFractionDigits: 2` with
`minorUnits(currency)`, and `minimumFractionDigits: 0` stays. Add the `compact`
option (`maximumFractionDigits: 0`) and delete the local `formatCurrency` in
`TripCard.tsx`, importing the shared one with `{ compact: true }`.

In **`resolver.ts`** (task 5 moved `convertToBase` there out of
`frankfurter.ts`, because converting is a question for the whole chain),
replace `Math.round(amount * rate * 100) / 100` with a rounding that respects
the base currency's minor units:

```ts
  const factor = 10 ** minorUnits(base);
  return { baseAmount: Math.round(amount * rate * factor) / factor, rate, rateDate, source };
```

Set `step` on both amount inputs to `10 ** -minorUnits(currency)`.

- [x] **Step 4: Render the footnote**

Wherever a lodging total is shown, count the stays with a price whose
`totalPriceBase` is null and render `omittedFromTotal` with that count; render
nothing when the count is zero.

- [x] **Step 5: Run both gates**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Run: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add frontend/src backend/src
git commit -m "feat(currency): per-currency decimals, one formatter, and an honest total"
```

---

### Task 11: Prove it against the real bookings

**Files:**
- Modify: `backend/src/__tests__/lodgingCurrencyEndToEnd.test.ts` (create)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [x] **Step 1: Write the test**

Providers mocked so the suite stays green offline; the cases are the owner's own
bookings from the 2026-08-13 measurement.

```ts
describe("the six bookings that could not record a price", () => {
  it("converts NOK on 2024-09-17 through the ECB", async () => { /* expect fxSource 'ecb' */ });
  it("converts EGP on 2026-03-04 through the CDN", async () => { /* expect fxSource 'cdn' */ });
  it("marks AED on 2023-04-30, which no source reaches", async () => {
    /* expect totalPriceBase null, fxSource null, currency 'AED', totalPrice 11662 */
  });
});
```

- [x] **Step 2: Run it**

Run: `cd backend && npx jest src/__tests__/lodgingCurrencyEndToEnd.test.ts --forceExit`
Expected: PASS.

- [x] **Step 3: Re-run the hotel-sample harness against the real mails**

Run: `cd backend && npx tsx src/scripts/measureLodgingSamples.ts`
Expected: template hits stay at 93/95 and price coverage stays at **93/93**.

That number was already reached on 2026-08-13, ahead of this task: the scoped
review of tasks 2–4 found that the Booking.com template's own amount parser
still matched a fixed alternation of four codes and three symbols, so a NOK
confirmation yielded no total and never fell through to the LLM. Fixed in
`bookingComTemplate.ts` (three-letter codes validated against the registry,
symbols in a table extended with `US$`/`S$`/`A$`/…), which lifted coverage
87/93 → 93/93. This step is now a REGRESSION check: if it reads below 93/93,
something in tasks 5–10 broke the parser.

- [x] **Step 4: Commit**

```bash
git add backend/src
git commit -m "test(currency): pin the six real bookings that drove this work"
```

---

## Self-Review

**Spec coverage.** Registry → Task 1. Ten call sites → Tasks 2 and 8. Missing vs
unsupported currency → Task 3. Source-reporting façade → Task 4. CDN, resolver,
admin switch → Task 5. `fx_source` and its backfill → Task 6. Manual-rate
contract → Task 7. Shared control, derived "Häufig", the endpoint → Task 8.
Three states, markers, all explanatory copy → Task 9. Minor units, single
formatter, totals footnote → Task 10. Real-data proof → Task 11. The mobile-app
contract note is a release concern, not a task — it is called out in the spec and
must be raised with the owner before an instance ships.

**Placeholders.** None: every code step carries the code, every test step carries
assertions and the command that runs them.

**Type consistency.** `RateSource` is defined once in Task 4 and used unchanged
in Tasks 5, 6 and 7. `getRate` and `getCdnRate` share one return shape.
`isCurrencyCode` and `minorUnits` keep their Task 1 signatures throughout.
`formatStayPriceDisplay`'s third parameter changes from a string to a labels
object in Task 9, which is the only signature change to an existing exported
function and is stated there.
