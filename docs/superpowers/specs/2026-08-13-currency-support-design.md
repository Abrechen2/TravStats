# Currency support across the app — design

**Date:** 2026-08-13
**Status:** revised after peer review, awaiting implementation plan
**Scope:** all four domains that carry a currency (flight, booking, cruise, lodging)

> Revision note: the first draft of this spec was reviewed by Codex (gpt-5.4)
> against the actual tree and came back with five substantive corrections. They
> are folded in below and called out where they changed a decision, because a
> reader deserves to know which parts were wrong before.

## Why

TravStats accepts four currencies: EUR, USD, GBP, CHF. Measured against the
owner's 95 real hotel confirmations, six bookings cannot record their price at
all — three in NOK, one SGD, one AUD, one EGP. A seventh (AED, Armani Hotel
Dubai) exposed something worse: the LLM read `11662 AED` correctly, `asCurrency`
dropped the unsupported currency, and the bare number survived. Downstream
`applyFxSnapshot` defaults a null currency to EUR, so the stay would have been
booked as €11,662 against a real cost of roughly €2,900.

That specific hole is closed (`c1bb53da`: no currency, no price). This design
removes the cause.

The constraint was never the rate source. FX already runs on
`api.frankfurter.app` — free, keyless, ECB reference rates, per-day history back
to 1999, 30 currencies including NOK, SGD and AUD.

## Measurements this design rests on

Taken 2026-08-13 with live requests.

| Source | Currencies | History | Key | Self-hostable |
|---|---|---|---|---|
| Frankfurter (in use) | 30 (ECB) | back to 1999 | no | yes — open source + Docker |
| currency-api (jsDelivr CDN) | 769 incl. AED, EGP | only from ~March 2024 | no | CDN/npm only |
| ExchangeRate-API | 161 | paid tier only | free for latest | no |
| exchangerate.host | ~170 | yes | key required since 2024 | no |

Probes: `AED→EUR` on 2026-08-12 = 0.23603, on 2023-04-30 = HTTP 404. `EGP→EUR`
on 2024-06-01 = 0.019527. Frankfurter answers `{"message":"not found"}` for EGP
on any date.

**No single free keyless API covers everything.** The two free ones are
complementary: narrow-and-deep versus broad-and-shallow. The check-in dates of
the six failing bookings — 2024-06-10, 2024-09-17, 2024-12-01, 2025-10-19,
2026-03-04, 2026-05-10 — all fall after the CDN's history begins, so the two
together cover 6 of 6. Only the 2023 Dubai booking stays unconvertible, and no
free source fixes that.

## Decisions

| Question | Decision |
|---|---|
| Rate sources | Frankfurter primary, currency-api fallback |
| CDN fallback default | **on**, admin-switchable |
| Validation | ISO-4217, static list in code |
| Picker | search field with a self-growing "Häufig" group |
| Currency with no rate | store amount + currency, do not convert, mark it |
| Missing currency (none given) | **reject the price** — not the same thing as an unsupported one |
| Manual rate | optional, offered only when no automatic rate exists |
| Marker style | word in a frame — `kein Kurs` / `eigener Kurs` |
| Base currency | limited to the 30 ECB currencies, reason stated at the field |

## Two distinctions the first draft blurred

**Unsupported ≠ missing.** A booking in EGP has a currency we cannot convert —
the amount is real and must be kept. A booking with *no* currency has an amount
whose unit is unknown, and there is nothing honest to do with it. Today four
places silently turn the second into EUR:

- `services/lodging/lodgingImportCommit.ts:180, 225, 244`
- `routes/lodging.ts:204` (`applyFxSnapshot`)

All four go. A stay with a price and no currency is rejected at the boundary,
the same way the parser now refuses one.

`getBaseCurrency` (`routes/lodging.ts:239`) keeps its `?? "EUR"` — that fallback
covers a user with no settings row at all, which is a different question.

**Display currency ≠ FX base currency.** The app already has both:
`units.currency` (`routes/settings/types.ts`) formats numbers, `baseCurrency`
(`routes/settings/general.ts:119`) is what lodging spend converts *into*.
Unifying them is **out of scope** here, but the spec must not pretend they are
one thing. The shared control and formatter below govern *an amount's own
currency* — entry and display — not that settings-level split.

## Architecture

### 1. One registry — and the real blast radius

`backend/src/shared/currencies.ts` with a mirror at
`frontend/src/shared/currencies.ts`, the convention `shared/domains.ts` already
establishes.

- `ISO_4217` — the ~180 active codes as a static list, each with name and
  minor-unit count.
- `isCurrencyCode(x)` — type guard.
- `ECB_CURRENCIES` — the 30 Frankfurter serves. Not used for validation; it
  seeds the "Häufig" group and gates the base-currency choice.

The first draft said "four call sites". It is **ten**, and missing six of them
would have shipped a backend that accepts NOK next to a frontend that cannot
type it:

| Where | What |
|---|---|
| `backend/src/schemas/lodging.ts:18` | the exported `CURRENCIES` literal |
| `backend/src/schemas/cruise.ts:5` | its own copy |
| `backend/src/services/cruiseBookingParser.ts:7` | its own copy |
| `backend/src/routes/lodging.ts:245` | `/fx-preview` `z.enum` |
| `backend/src/routes/settings/general.ts:119` | `baseCurrency` `z.enum` |
| `frontend/src/types/lodging.ts:19` | hand-mirrored union |
| `frontend/src/types/cruise.ts:114` | hand-mirrored union |
| `frontend/src/components/lodging/StayEditorPriceSection.tsx:7` | picker list |
| `frontend/src/components/Settings/LodgingPreferencesSection.tsx:14` | picker list |
| `frontend/src/lib/importers/lodgingCsv.ts:313` | CSV coercion list |
| `frontend/src/components/Cruise/CruiseEditModal.tsx:29` | picker list |

Validation moves from `z.enum(CURRENCIES)` to `z.string().refine(isCurrencyCode)`,
except `baseCurrency`, which becomes `z.enum(ECB_CURRENCIES)` deliberately.

**No migration for this part.** Every currency column is already `String`
defaulting to `"EUR"`; the enum only ever lived in Zod and in the mirrors.

**External consumers.** The mobile app (separate private repo, Bearer PAT) reads
these endpoints. Widening what the API *accepts* is backward compatible; what it
now *emits* is not necessarily — a client with its own four-value union will
break on `"NOK"`. That client must be updated before an instance running this
version meets it. Named here so it is a decision, not a surprise.

### 2. A rate chain that reports where the rate came from

The first draft claimed the chain could hide behind the existing façade *and*
record its source. It cannot: `getRate` returns a bare number and
`convertToBase` returns `{baseAmount, rate, rateDate}` — there is nothing to
write into `fx_source`.

So the façade keeps its *shape* but gains one field:

```ts
type RateSource = "ecb" | "cdn" | "manual";
getRate(from, to, date): Promise<{ rate: number; source: RateSource } | null>
convertToBase(...): Promise<{ baseAmount; rate; rateDate; source } | null>
```

`frankfurter.ts` keeps its logic and reports `"ecb"`; `currencyApiCdn.ts` joins
it and reports `"cdn"`; a resolver asks them in order. `applyFxSnapshot` passes
the source through to the write. Callers other than the FX write path are
unaffected.

1. **Frankfurter (ECB).** Knows both currencies → it is the answer.
2. **currency-api (CDN).** Only when Frankfurter has nothing, and only when the
   admin switch is on. A self-hoster who does not want their instance talking to
   jsDelivr turns it off and keeps the 30.
3. **No rate.** Not an error: amount and currency are stored, FX columns stay
   empty, and that *is* the marker.

The switch is a boolean column on `admin_settings`
(`fx_cdn_fallback_enabled`, default `true`), surfaced in the admin parser/services
area next to the existing Ollama and geocoder settings, with a line saying what
it contacts and why.

Rates are not persisted. The per-process cache is enough — historical rates never
change. A rate table would be infrastructure for a problem nobody reported.

### 3. Provenance, and the rows that already exist

```
lodging_stays.fx_source  TEXT NULL   -- 'ecb' | 'cdn' | 'manual'
```

The migration **backfills `'ecb'` for every existing row that already has an FX
snapshot** — every one of them came from Frankfurter, so leaving them null would
make historical conversions indistinguishable from unknown ones. Rows without a
snapshot stay null.

This column lives on `lodging_stays` because that is where the FX snapshot lives
(`schema.prisma:1170-1173`). `Flight`, `Booking` and `Cruise` carry a bare
`currency` with no snapshot at all, so the three-state presentation is a
**lodging capability**, not an app-wide one. The shared control and formatter
still apply everywhere; the *converted-to-base readout* only exists where a
snapshot does. The first draft promised more than the data model can deliver.

### 4. Manual rate — the contract the first draft omitted

Request, on stay create and update:

```ts
manualFxRate?: number | null   // units of base per 1 stay currency
```

Accepted only when an automatic lookup returned nothing for that
(currency, check-in date) pair; supplied alongside a supported currency it is
rejected, so a user cannot quietly override an ECB rate. On acceptance the write
fills `totalPriceBase = totalPrice * manualFxRate`, `fxRate`, `fxRateDate` =
check-in date, `fxBaseCurrency`, and `fxSource = 'manual'`.

Response: `fxSource` joins the existing FX fields on the stay payload, so
`lodgingFormat.ts` can pick a state instead of collapsing "no readout" for both
the no-rate and the manual case (`lodgingFormat.ts:97`,
`LodgingStayCard.tsx:140`, `StayEditorPriceSection.tsx:125` all need this).

### 5. One control, one formatter — scoped honestly

A single `<CurrencySelect>` shared by flight, cruise, lodging and booking, and a
single formatter for rendering an amount. `TripCard.tsx:362` currently has its
own `formatCurrency` with `maximumFractionDigits: 0`; it folds into the shared
one, keeping a "compact" option so trip cards can still drop the decimals.

"Häufig" is **derived, not stored**: the distinct currencies in the user's own
rows, ordered by frequency, ECB set behind them for a fresh account.

**Where it is computed** — the first draft never said, which invited a scan on
every render. It is one endpoint, `GET /api/v1/currencies/recent`, four grouped
counts (`Flight`, `Booking`, `Cruise`, `LodgingStay`, each `groupBy currency`
scoped to `userId`), cached in the frontend store for the session. Grouped counts
over indexed `user_id` columns, fetched once per session, not per keystroke.

### 6. Minor units — corrected

The first draft claimed rounding to two decimals misprices a yen booking by a
factor of 100. **That is wrong.** This codebase stores major-unit floats, not
integer minor units, so ¥12,000 is stored as `12000` and merely *displays*
awkwardly. The genuine breakpoints are narrower:

- `services/fx/frankfurter.ts:60` — `Math.round(amount * rate * 100) / 100`
  truncates a KWD or BHD conversion at two decimals.
- `frontend/src/lib/units.ts:156` — formatter caps at 2 fraction digits.
- `step={0.01}` on the amount inputs (`CruiseEditModal.tsx:355`,
  `StayEditorPriceSection.tsx:81`) blocks a third decimal.

All three read the minor-unit count from the registry instead of assuming 2.
Nobody in the sample set is affected today; this is correctness, not urgency.

### 7. Nothing happens silently

Every limit is explained where it is met:

- **Base currency setting** — "Zur Wahl stehen die 30 Währungen mit amtlichen
  EZB-Kursen, weil in diese Währung alles umgerechnet wird — zurück bis 1999.
  **Erfassen kannst du in jeder Währung.** Aufenthalte in einer Währung ohne Kurs
  werden gespeichert und angezeigt, zählen aber nicht in diese Summe."
- **On picking a currency with no rate source** — inline, calm, not an error:
  "Für EGP haben wir am 04.03.2026 keinen Kurs. Du kannst einen eintragen —
  sonst wird der Betrag gespeichert, fließt aber nicht in Summen ein."
- **On the marker** — tooltip with the concrete reason and date.
- **Under any total that omitted something** — "1 Aufenthalt nicht umgerechnet".
- **At the CDN switch** — what it contacts, and that turning it off leaves 30
  currencies convertible.

All copy ships DE and EN together.

## Three states, one presentation

| State | Display | Tooltip |
|---|---|---|
| converted automatically | `1.146,50 NOK` · `≈ 97,20 €` | "EZB-Kurs vom 17.09.2024" |
| converted from a manual rate | `11.662 EGP` · `≈ 228,00 €` + `eigener Kurs` | "Kurs von dir eingetragen: 0,01955" |
| no rate | `11.662 AED` + `kein Kurs` | "Kein Kurs verfügbar — nicht in Summen enthalten" |

The marker is a small bordered word, chosen over a bare dot and a footnote
asterisk because it reads without hovering. The manual-rate row is absent until a
lookup has come back empty.

## Error handling

Every failure falls downward, never outward. Unreachable provider, timeout,
malformed response — all end in state three. An import must never fail because a
rate lookup did; that is the rule `applyFxSnapshot` already follows.

## Testing

- Registry: minor units for JPY (0), KWD (3), EUR (2); `isCurrencyCode` rejects
  "EURO" and "CH".
- Chain: Frankfurter wins when it can; CDN only when Frankfurter has nothing
  **and** the switch is on; both dead → state three, no throw; each reports its
  own `source`.
- Missing vs unsupported: a price with no currency is rejected; a price in EGP is
  stored and marked.
- Manual rate: accepted only where no automatic rate exists, rejected against a
  supported currency, sets `fx_source = 'manual'`, never labelled ECB.
- Migration: an existing stay with a snapshot reads back `fx_source = 'ecb'`.
- The real cases, mocked so the suite stays green offline: NOK 2024-09-17
  converts, EGP 2026-03-04 marked, AED 2023-04-30 marked.
- A total that omitted a stay renders the footnote; one that omitted nothing does
  not.

## Explicitly out of scope

- No rate table in the database.
- No crypto, though the CDN carries it.
- No retroactive re-conversion of stored stays.
- Widening `baseCurrency` beyond the ECB 30.
- Unifying `units.currency` with `baseCurrency` — named above, deliberately left.
- Bringing the FX snapshot to flight/booking/cruise.
