# Currency support across the app — design

**Date:** 2026-08-13
**Status:** approved, awaiting implementation plan
**Scope:** all four domains that carry a currency (flight, booking, cruise, lodging)

## Why

TravStats accepts four currencies: EUR, USD, GBP, CHF. Measured against the
owner's 95 real hotel confirmations, six bookings cannot record their price at
all — three in NOK, one SGD, one AUD, one EGP. A seventh (AED, Armani Hotel
Dubai) exposed something worse: the LLM read `11662 AED` correctly, `asCurrency`
dropped the unsupported currency, and the bare number survived. Downstream
`applyFxSnapshot` defaults a null currency to EUR, so the stay would have been
booked as €11,662 against a real cost of roughly €2,900.

That specific hole is already closed (`c1bb53da`: no currency, no price). This
design removes the cause rather than the symptom.

The constraint was never the rate source. FX already runs on
`api.frankfurter.app` — a free, keyless wrapper over ECB reference rates with
per-day history back to 1999. It serves 30 currencies, including NOK, SGD and
AUD. The blocker is a four-element list, duplicated in four places:
`schemas/lodging.ts`, `schemas/cruise.ts`, `services/cruiseBookingParser.ts` and
`components/Cruise/CruiseEditModal.tsx`. The same list also gates
`baseCurrency`, so a Norwegian user cannot pick NOK as their base.

## Measurements this design rests on

Taken 2026-08-13 with live requests, not from memory.

| Source | Currencies | History | Key | Self-hostable |
|---|---|---|---|---|
| Frankfurter (in use) | 30 (ECB) | back to 1999 | no | yes — open source + Docker |
| currency-api (jsDelivr CDN) | 769 incl. AED, EGP | only from ~March 2024 | no | CDN/npm only |
| ExchangeRate-API | 161 | paid tier only | free for latest | no |
| exchangerate.host | ~170 | yes | key required since 2024 | no |

Probe results: `AED→EUR` on 2026-08-12 = 0.23603, on 2023-04-30 = HTTP 404.
`EGP→EUR` on 2024-06-01 = 0.019527. Frankfurter answers `{"message":"not
found"}` for EGP on any date.

**No single free keyless API covers everything.** The two free ones are
complementary: narrow-and-deep versus broad-and-shallow.

The check-in dates of the six failing bookings are 2024-06-10, 2024-09-17,
2024-12-01, 2025-10-19, 2026-03-04 and 2026-05-10 — **all after the CDN's
history begins**. The two sources together therefore cover 6 of 6. Only the 2023
Dubai booking stays unconvertible, and no free source can fix that: the ECB never
carried AED and the CDN does not reach back that far.

## Decisions

| Question | Decision |
|---|---|
| Rate sources | Frankfurter primary, currency-api as fallback |
| CDN fallback default | **on**, admin-switchable |
| Validation | ISO-4217, static list in code |
| Picker | search field with a self-growing "Häufig" group |
| Currency with no rate | store amount + currency, do not convert, mark it |
| Manual rate | optional, offered only when no automatic rate exists |
| Marker style | word in a frame — `kein Kurs` (variant A of three shown) |
| Base currency | limited to the 30 ECB currencies, with the reason stated at the field |

## Architecture

### 1. One registry, four call sites removed

`backend/src/shared/currencies.ts` with a mirror at
`frontend/src/shared/currencies.ts` — the convention `shared/domains.ts` and
`shared/statusDerivation.ts` already establish.

- `ISO_4217` — the ~180 active codes as a static list, each with name and
  **minor-unit count**. The last part is not cosmetic: JPY has 0 decimals, KWD
  has 3. Rounding everything to 2 misprices a yen booking by a factor of 100.
- `isCurrencyCode(x)` — type guard.
- `ECB_CURRENCIES` — the 30 Frankfurter serves. **Not used for validation**;
  only to seed the "Häufig" group and to gate the base-currency choice.

The four existing `CURRENCIES` literals are deleted and import from here.
Validation moves from `z.enum(CURRENCIES)` to `z.string().refine(isCurrencyCode)`.

**No migration for this part.** Every currency column is already `String` with a
default of `"EUR"`; the enum only ever lived in Zod. Existing rows carry the old
four and stay valid.

### 2. A rate chain behind the existing façade

`services/fx/` gains a resolver that asks providers in order. `frankfurter.ts`
stays exactly as it is; `currencyApiCdn.ts` joins it; both keep today's
`getRate(from, to, date)` signature so `applyFxSnapshot` never learns there is a
chain.

1. **Frankfurter (ECB).** If it knows both currencies, it is the answer.
2. **currency-api (CDN).** Asked only when Frankfurter has nothing, and only
   when the admin has left the switch on. A self-hoster who does not want their
   instance talking to jsDelivr turns it off and keeps the 30.
3. **No rate.** Not an error: amount and currency are stored, the FX columns
   stay empty, and that *is* the marker.

Rates are not persisted. The current per-process cache is enough — historical
rates never change and restarts are rare. A rate table would be infrastructure
for a problem nobody has reported.

### 3. Provenance

A manual rate fills the same FX columns an automatic one does, which would make
the two indistinguishable — and the UI must never present someone's own estimate
as an ECB rate. So one nullable column on `lodging_stays`:

```
fx_source  TEXT NULL   -- 'ecb' | 'cdn' | 'manual'
```

This is the only migration in the design.

### 4. One control, one formatter, everywhere

Not a lodging feature. A single `<CurrencySelect>` shared by flight, cruise,
lodging and booking — same search, same "Häufig" group, same ordering — and a
single formatter that renders an amount identically wherever it appears,
including the marker. Today the cruise modal carries its own four-element list;
that duplication is exactly what this removes.

"Häufig" is **derived, not stored**: the distinct currencies already present in
the user's own rows, ordered by frequency, with the ECB set behind them for a
fresh account. It grows by itself as soon as a new currency is used, so there is
no list to maintain and nothing that can drift.

### 5. Nothing happens silently

Every limit is explained where it is encountered, not in documentation:

- **Base currency setting** — under the field: "Zur Wahl stehen die 30 Währungen
  mit amtlichen EZB-Kursen, weil in diese Währung alles umgerechnet wird — zurück
  bis 1999. **Erfassen kannst du in jeder Währung.** Aufenthalte in einer Währung
  ohne Kurs werden gespeichert und angezeigt, zählen aber nicht in diese Summe."
- **On picking a currency with no rate source** — inline in the form, calm, not
  an error: "Für EGP haben wir am 04.03.2026 keinen Kurs. Du kannst einen
  eintragen — sonst wird der Betrag gespeichert, fließt aber nicht in Summen ein."
- **On the marker** — tooltip with the concrete reason and date.
- **Under any total that omitted something** — "1 Aufenthalt nicht umgerechnet".

All user-facing copy ships DE and EN together.

## Three states, one presentation

| State | Display | Tooltip |
|---|---|---|
| converted automatically | `1.146,50 NOK` · `≈ 97,20 €` | "EZB-Kurs vom 17.09.2024" |
| converted from a manual rate | `11.662 EGP` · `≈ 228,00 €` + marker | "Kurs von dir eingetragen: 0,01955" |
| no rate | `11.662 AED` + marker | "Kein Kurs verfügbar — nicht in Summen enthalten" |

The marker is a small bordered word (`kein Kurs` / `eigener Kurs`), chosen over a
bare dot and a footnote asterisk because it reads without hovering.

The manual-rate row is absent until it is needed: it appears only once a lookup
has come back empty, carries an optional rate field and a live preview of the
converted amount.

## Error handling

Every failure falls downward, never outward. An unreachable provider, a timeout,
a malformed response — all end in state three. An import must never fail because
a rate lookup did; that is the rule `applyFxSnapshot` already follows and it
stays.

## Testing

- Registry: JPY has 0 minor units, KWD has 3; `isCurrencyCode` rejects "EURO"
  and "CH".
- Chain: Frankfurter wins when it can; the CDN is consulted only when
  Frankfurter has nothing **and** the switch is on; both dead → state three, no
  throw.
- Provenance: a manual rate sets `fx_source = 'manual'` and is never labelled as
  an ECB rate.
- The real cases, pinned to the owner's own data with mocked providers so the
  suite stays green offline: NOK on 2024-09-17 converts, EGP on 2026-03-04 gets
  the marker, AED on 2023-04-30 gets the marker.
- A total that omitted a stay renders the footnote; one that omitted nothing
  does not.

## Explicitly out of scope

- No rate table in the database.
- No crypto, though the CDN carries it.
- No retroactive change to stored stays — existing conversions stay as they are.
- Widening `baseCurrency` beyond the ECB 30.
