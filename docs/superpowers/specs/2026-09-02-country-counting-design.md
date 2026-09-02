# Counting countries — what proves you were somewhere

**Status:** proposal, 2026-09-02. Open decisions at the end are the owner's.
**Trigger:** the owner looked at his own figures on the RC and said the country
count was too high. Every number below was measured against that account, not
estimated.

---

## 1. The problem is not one bug, it is four

The headline number is wrong in **both directions at once**, which is why it
looked plausible for so long.

### 1.1 Transits count as visits

The passport's rule is *"a country counts if a flight began OR ended there"*.
That is a defensible rule, and it counts changing planes as having been there.
Measured on the owner's account, seven countries have **no overnight stay and a
ground time under five hours**:

| Country | longest time on the ground |
|---|---|
| Denmark | 1.4 h |
| Poland | 1.6 h |
| Belgium | 1.7 h |
| Qatar | 2.2 h |
| Canada | 2.7 h |
| Bahrain | 3.5 h |
| Ethiopia | 4.7 h |

The next country after that gap is France at **25 hours**. The data separates
connections from stays cleanly, without anyone having to pick a number.

### 1.2 Lodging is not evidence at all

`buildPassport(flights, airportCountries, homeIatas, now, portCalls, placeVisits)`
— there is no lodging parameter. A country reached **by car** and slept in for a
week does not appear, while a four-hour port call does.

Three countries in the owner's account exist only this way: **Czechia, Italy,
Slovenia** — completed hotel stays, no flight ever.

Austria proves the point most sharply: 24 houses, 9 stays — and the passport
counts it **only** because of a single 0.9-hour connection. Remove that one
transit and a country with nine stays disappears.

### 1.3 The achievements count country *names*, the passport counts codes

`UserStats.countries` unions flights, cruises and lodging — which is more correct
than the passport. But flights contribute ISO codes (`DE`) while lodging
contributes the free-text `country` column (`Deutschland`, `Germany`). They never
match, so one country is counted several times.

Measured: **33 ISO codes against 56 distinct strings** in the same account.

```
AT → "Austria" | "Österreich"
CH → "Schweiz" | "Switzerland" | "Schweiz/Suisse/Svizzera/Svizra"
DE → "Deutschland" | "Germany"
CZ → "Česko" | "Tschechien"
```

Union with free text: **88**. Union on ISO codes: **40**. This is the exact
failure `Lodging.isoCountryCode` exists to prevent, and `CLAUDE.md` already
states the rule — *"the text field keeps whatever the source wrote, everything
that GROUPS or COUNTS joins on this instead."*

### 1.4 A saved house without a stay — owner's decision, 2026-09-02

**A lodging with no stay counts as one night.** The owner's reasoning: somebody
took the trouble to enter the house, so they were there — they simply no longer
remember when. Refusing to count it would throw away a memory the user
deliberately recorded.

This is a decision, not a derivation, and it has a price worth naming: **data
quality becomes decisive.** A wrongly imported house is now a country.

The live example is in the owner's own account. `Hotel Sport` was imported on
2026-08-14 carrying a Google Place ID for **Bucharest** — one house, zero stays.
The real hotel is Grajska cesta 2, Otočec, **Slovenia**. Under this rule that one
bad row adds Romania to a passport, from a mistake in a third party's database.

Two things follow, and they are not optional:

1. **The evidence must stay visible.** An undated house counts, but the country
   row says it was proved by a stay with no date. That is how the Bucharest
   record was found in the first place — by looking at *why* a country was
   listed, not at the total.
2. **`shared/lodgingCounting.ts`'s check-out rule still governs stays that
   exist.** A stay with a check-out in the FUTURE is a booking, not a visit, and
   must not count. The new rule is about the absence of a stay, not about
   overriding a stay that says "not yet".

---

## 2. What the data cannot tell us

**We cannot know whether someone left the airport.** Six hours in Doha with a
trip into the city and six hours airside are identical in the database. Any
duration threshold is a proxy for a fact we do not hold, and the UI should never
pretend otherwise.

The measurement makes this concrete. Countries by threshold, same account:

| rule | countries |
|---|---|
| no threshold (today) | 28 |
| ≥ 3 h | 22 |
| ≥ 6 h | 20 |
| ≥ 12 h | **20** |
| overnight (calendar day changed) | 21 |

**Six hours and twelve hours give the same answer.** Nobody in this account sits
between them. A configurable hour value would offer precision the data does not
have, and invite turning a dial until the number feels right. That is not a
measurement any more.

---

## 3. The design: evidence tiers, not thresholds

The passport already carries `evidence: flight | port | place` per country with a
"strongest wins" rule. Extend that instead of bolting a threshold beside it.

### 3.1 Three tiers, all derived structurally

| Tier | What proves it |
|---|---|
| **`slept`** | a completed lodging stay · **a lodging with no stay at all** (counts as one night — see 1.4) · a flight arrival and departure on **different local calendar days** · a port call spanning a night |
| **`visited`** | arrival and departure the same local day · a recorded place · a same-day port call |
| **`transit`** | a connection and nothing else |

No hours anywhere. "Different calendar day" is in the data; "six hours" is a
guess. The tiers are computed at the departure airport's clock, which is the rule
the rest of this server already follows.

### 3.2 One setting decides what the headline counts

> **A country counts as visited from …** ○ transit ○ **stay** (default) ○ overnight

Effect on the owner's account, with undated houses counted: transit ≈ 32 ·
stay **40** · overnight ≈ 36. (Without the 2026-09-02 decision the middle figure
would be 35 — the difference is five countries whose only evidence is a house
somebody entered without a date.)

**Instance default set by admin, overridable per user.** "Does a connection
count?" is a personal definition, not a property of the server — imposing one
traveller's philosophy on everyone sharing a family instance is the wrong
default. But a fresh account must not have to decide anything, so the admin sets
the starting point.

### 3.3 The list always shows the evidence, whatever the setting

The number is one answer; the list should be honest regardless. Each row carries
its tier, so a reader can see *why* a country is counted — and spot a wrong one,
which is exactly how the Bucharest hotel was found.

---

## 4. One rule, one home

`shared/countryEvidence.ts`, alongside `placeCounting.ts`, `lodgingCounting.ts`
and `flightCounting.ts`. Every consumer reads it:

- `GET /stats/passport`
- `GET /stats/countries` and `countriesIso`
- `GET /stats/countries/:code`
- `UserStats.countries` (achievements)
- `GET /stats/wrapped` → `newCountries`
- the hero tile

They disagree **today** — the achievements say 88 where the passport says 32 —
and that is precisely the drift forgejo#42 was written to end. Folding lodging in
without unifying the rule would create a fifth answer.

The module owns three things and nothing else: the tier derivation, the
`isoCountryCode` join (never free text), and the check-out cut for stays.

---

## 5. It changes numbers people have seen

Every user's count moves. That belongs in the changelog as a decision, not as a
silent fix, and the UI should say it once:

> Zählweise geändert — vorher 32 Länder, jetzt 35. [Was zählt?]

A number that changes without explanation reads as data loss.

---

## 6. What this does not solve

**Achievements already granted.** 103 badges in the owner's account are unlocked
with a progress value **below their own requirement** — `COUNTRIES_100` stands at
86, and it unlocked on 2026-04-12 while `COUNTRIES_50` unlocked on 2026-08-15.
The harder badge came four months before the easier one. The mechanism is that
nothing ever re-locks an achievement, so a past miscount is permanent. Fixing the
count does not repair them, and whether a badge may be revoked is a separate
product decision. Filed separately.

**Hong Kong is its own ISO code**, and so are several territories a traveller may
consider part of another country. The tiers do not touch this. It should stay
untouched: the alternative is a hand-maintained list of political opinions.

**Where you actually were inside a country** — a transit through Frankfurt on the
way to Rome does not make Germany a holiday. The tiers say what kind of presence
it was and stop there.

---

## 7. Open decisions — the owner's, not the implementer's

1. **Default tier** for the instance. Proposal: `stay`.
2. **Per-user override** — yes or admin-only? Proposal: yes.
3. **Retroactive achievements** — may a badge be revoked when the count falls?
   Three options: never revoke (list stays untrue) · revoke (an earned thing is
   taken away) · keep the badge, tell the truth in the progress bar.
4. **Wrong imports are now visible in the count.** With undated houses counting,
   `Hotel Sport` puts Romania in the passport until that row is corrected. Worth
   deciding whether the import should refuse a place whose geocoded country
   contradicts the rest of its row — the source data is not ours, but the check
   would be.
5. **Overnight derived from flights** — is an arrival on the 3rd and a departure
   on the 4th an overnight stay, even with no hotel recorded? Proposal: yes; it
   is the same evidence a hotel gives, from a different source.

---

## 8. Order of work

1. `shared/countryEvidence.ts` with the tiers, plus tests that pin a transit, an
   overnight, and a lodging-only country.
2. Fold lodging into the passport — the clearest bug. An undated house counts as
   one night (owner's decision); a stay whose check-out is still in the future
   does not.
3. Fix the achievements union to join on `isoCountryCode`. This alone moves the
   owner's figure from 88 to 40.
4. Point every consumer at the module; delete the local re-derivations.
5. The setting, with the instance default.
6. Changelog and the one-time notice.

Steps 2 and 3 are bug fixes and can ship without the setting. Step 5 is the
product decision and can wait — but the numbers should not.
