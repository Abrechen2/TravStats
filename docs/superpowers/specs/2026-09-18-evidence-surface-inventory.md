# Evidence surface inventory — every number on Statistics and Achievements

**Task:** Task 1 of `docs/superpowers/plans/2026-09-18-evidence-panel.md`
(re-cut plan). This document is the record of the walk; `backend/src/shared/evidenceMeasures.ts`
(mirrored at `frontend/src/shared/evidenceMeasures.ts`) is what the code reads.
See `docs/superpowers/specs/2026-09-18-evidence-panel-design.md`, table
"The model: aggregation kinds", for what each aggregation column means.

Columns: **Component** (file + the prop/field), **Label** (what the user
reads, German key where one exists), **Calculator** (backend function or
endpoint, or the frontend computation when there is no backend rollup),
**Scope**, **Aggregation**, **Evidence?** (can a per-entry resolver exist at
all), **Registry key** (`—` when the number is ranking-shaped, a chart
distribution, or otherwise out of registry scope for the reasons noted).

**Scope** shows what the surface renders TODAY. The registry's own field is
`MeasureSpec.scopes: MeasureScope[]` — every scope the measure can
legitimately be shown over, not just the one in front of a reader right now
(fix round 1, 2026-09-18: a single `scope` field had no way to say a tile is
user-selectable, which is exactly `FlightScorecardBlock`'s case below). A
fixed-scope measure's `scopes` array has one element and matches this
column; `scorecardFlightCount`/`scorecardDistanceKm`/
`scorecardFlightTimeMinutes` are the only three where it does not.

A "distribution" row (seat class, status, boarding group, weekday/season
chart) is one row per number a user can see, not per bucket — the number IS
the distribution, and none of these are registered individually. Rationale
under "Distributions kept out of the registry" at the end.

## Flight tab — headline metrics

| Component | Label | Calculator | Scope | Aggregation | Evidence? | Registry key |
|---|---|---|---|---|---|---|
| `StatsOverviewCards` `totalFlights` | "Gesamtflüge" | `AdvancedStatsPage.tsx` — `flights.length` after client-side `isCountableFlight` filter over `flightsApi.getAll` (paged, all rows) | allTime | sum | yes — one row per flight | `flightCount` |
| `StatsOverviewCards` `totalFlightTime` (+ estimated-hours footnote) | "Gesamtflugzeit" | `shared/flightDuration.ts` `addFlightDuration`/`emptyDurationTotals`, folded client-side over the same flight list | allTime | sum | yes | `flightTimeMinutes` |
| `StatsOverviewCards` `avgFlightDuration` | "Ø Flugdauer" | `shared/flightDuration.ts` `averageDurationMinutes` | allTime | ratio (sum ÷ count of flights that contributed a duration) | numerator/denominator only | `avgFlightDurationMinutes` |
| `StatsOverviewCards` `airlineCount` | "Fluggesellschaften" | `shared/airlineNormalize.ts` `groupAirlines`/`airlineGroupKey`, client-side | allTime | distinct (distinct airline group keys) | yes | `airlineCount` |
| `StatsDistanceSection` `totalDistance` | "Gesamtdistanz" | `AdvancedStatsPage.tsx` client Haversine reduce over the same flight list | allTime | sum | yes | `distanceKmTotal` |
| `StatsDistanceSection` `avgDistance` | "Ø Distanz/Flug" | same, divided by flights with coordinates | allTime | ratio | numerator/denominator only | `avgDistanceKm` |
| `StatsDistanceSection` `earthCircumnavigations`/`moonPercentage`/`marsPercentage`/`voyagerPercentage` | "Erdumrundungen" / "Weg zum Mond" / "...Mars" / "...Voyager 1" | same `totalDistance`, divided by a hardcoded constant (40075/384400/225000000/24000000000 km) | allTime | ratio (to a constant, not to another measured total) | the numerator is `distanceKmTotal`'s own evidence; the denominator is not a row | `distanceMilestoneShare` (one key covers all four milestones — same numerator, four constants) |
| `StatsDistanceSection` `longestDistance`/`shortestDistance` | "Längste/Kürzeste Strecke" | same distance array, `.sort().at(0)` | allTime | extremum (1 witness) | yes | `longestFlightDistanceKm` / `shortestFlightDistanceKm` |
| `StatsFlightBreakdown` `longestFlight`/`shortestFlight` (duration) | "Längster/Kürzester Flug" | `AdvancedStatsPage.tsx` `flightDurations.sort()` | allTime | extremum | yes | `longestFlightDurationMinutes` / `shortestFlightDurationMinutes` |
| `StatsFlightBreakdown` `flightsWithoutAirline` note | "ohne Fluggesellschaft" | backend `GET /stats/airlines` — `groupAirlines`'s `withoutAirline` count (forgejo#81) | allTime | sum | yes — flights excluded from every airline group | `flightsWithoutAirlineCount` |
| `scorecard/FlightScorecardBlock` tiles (flights / distance / flight time) | "Flüge" / "Distanz" / "Flugzeit" | backend `GET /stats/timeseries` (`services/stats/timeseriesRows.ts`) | `rolling12m` \| `year` \| `allTime` — user-selectable via `rangeWindow` (`year` reuses the page's `selectedYear`) | sum | yes | `scorecardFlightCount` / `scorecardDistanceKm` / `scorecardFlightTimeMinutes` — `scopes: ["rolling12m", "year", "allTime"]` |
| `FlightYearSummaryCards` totalFlights/totalDistance/totalFlightTime/totalCost | "Gesamtflüge (Jahr)" etc. | backend `GET /stats/summary?year=` → `services/stats/summary.ts` `computeSummary` | year | sum (totalCost may be `null` — abstention, not zero, forgejo#83) | yes | `yearFlightCount` / `yearDistanceKm` / `yearFlightTimeMinutes` / `yearTotalCost` |
| `FlightYearSummaryCards` `unpricedFlights` (shown inside the totalCost note) | "keine Preise erfasst" | same `computeSummary` | year | sum | yes | `yearUnpricedFlightCount` |

## Flight tab — rankings (NOT registry entries; addressed via `rankingKey()`)

| Component | Dimension | Calculator | Scope | Aggregation |
|---|---|---|---|---|
| `AirlineRankingCard` | `airline` | backend `GET /stats/airlines` — `airlineGroupKey`/`groupAirlines` | allTime | sum (count) + ratio (percentage, denominator = attributed total) |
| `AircraftRankingCard` | `aircraft` (tail number/"Hulls") | backend `GET /stats/aircraft` | allTime | sum |
| `CountryDistributionCard` | `country` | backend `GET /stats/countries` — both flight ends fold into a per-flight `Set` (one international flight credits two countries) | allTime | sum over endpoint-touches |
| `StatsFlightBreakdown` `sortedAirports` (client top-10) | `airport` | `AdvancedStatsPage.tsx` client reduce over both `depIata`/`arrIata` — **duplicates** the shape backend `airport` ranking would serve, but is NOT the same query (no backend `/stats/airports-ranking` endpoint exists; `StatsAirportsSection`'s `topAirports` is a third, separate computation inside `calculateAirportStats`) | allTime | sum over endpoints |
| `StatsFlightBreakdown` `sortedAircraft` (client top-10, by `aircraft` **type**, not tail number) | `aircraftType` | `AdvancedStatsPage.tsx` client reduce; backend equivalent exists at `GET /stats/aircraft-types` (`backend/src/routes/stats/aircraft.ts`) but this tile does not call it | allTime | sum |
| — (design doc names `continents` as a release-1 ranking dimension) | `continent` | **NOT DETERMINED** — no `/stats/continents` ranking endpoint exists. The closest source is `continentDistribution` inside `calculateAirportStats` (`utils/stats/airportStats.ts`), embedded in `StatsAirportsSection`, not a standalone ranking response. Recorded as unknown rather than guessed — Task 2/3 must decide whether this field is repurposed or a new endpoint is built. |

## Flight tab — distributions kept out of the registry

Seat class (`StatsFlightBreakdown` + `StatsSeatSection`), flight status,
boarding group, and the weekday/season bar chart (`StatsChartsSection`) are
each a `sum` per bucket, structurally identical in shape to a ranking row —
but none of the five dimensions the design names for release 1
(airlines/airports/countries/continents/aircraft-types) covers them, and no
resolver is planned for them in the current plan. Rather than invent a
sixth-through-tenth ranking dimension unasked, or force a `sum` aggregation
into the registry for a number that is really ten numbers, these are recorded
here and left **out of the registry** — a deliberate abstention, not an
oversight. If evidence for these is ever wanted, they need their own decision
about whether they are rankings or metrics.

Affected: `seatClassStats` (per class), `SeatStats.windowCount/middleCount/aisleCount/frontCount/middleZoneCount/backCount/seatClassDistribution/mostCommonSeat/avgRowNumber` (`StatsSeatSection` — all `calculateSeatStats`-equivalent, computed inline in `routes/stats.ts` `GET /seats`, no separate function), `statusStats`, `boardingGroupStats`, `weekdayData`/`seasonalData` (`StatsChartsSection`).

## Flight tab — fun & unique statistics (`StatsFunSection`, `StatsUniqueSection`)

All backend, `calculateFunStats` (`utils/stats/funStats.ts`) and
`calculateUniqueStats` (`utils/stats/uniqueStats.ts`), both fed by
`GET /stats/fun` / `GET /stats/unique`, **allTime, no year param sent by the
page**.

| Field | Label | Aggregation | Evidence? | Registry key |
|---|---|---|---|---|
| `timezoneHopper` | "Zeitzonen-Hopper" | sum (matching flights) | yes | `timezoneHopperFlightCount` |
| `earlyBird` | "Früher Vogel" | sum | yes | `earlyBirdFlightCount` |
| `nightOwl` | "Nachteule" | sum | yes | `nightOwlFlightCount` |
| `weekendWarrior` (+ `weekendPercentage`) | "Wochenend-Krieger" | sum / ratio | yes / numerator+denominator | `weekendFlightCount` / `weekendFlightSharePct` |
| `loyaltyScore` (+ `mostUsedAirline`) | "Treue-Score" | ratio | numerator+denominator | `loyaltyScorePct` |
| `shortHaulKing` | "Kurzstrecken-König" | sum | yes | `shortHaulFlightCount` |
| `longHaulPilot` | "Langstrecken-Pilot" | sum | yes | `longHaulFlightCount` |
| `fastestDay`/`fastestDayFlights` | "Schnellster Tag" | extremum (1 witness day, N flights that day) | yes | `busiestFlightDayCount` |
| `co2FootprintKg` (+ `co2InElephants`) | "CO₂-Fußabdruck" | sum / ratio | yes / numerator+denominator | `co2FootprintKg` / `co2FootprintElephantsRatio` |
| `milestoneYear`/`milestoneYearFlights` | "Meilenstein-Jahr" | extremum (year with most flights) | yes | `milestoneYearFlightCount` |
| `routeMaster`/`routeMasterCount` | "Routen-Meister" | extremum (most-flown route) | yes | `routeMasterFlightCount` |
| `timeTravelIndex` | "Zeitreise-Index" | sum | yes | `timeTravelFlightCount` |
| `equatorCrossings` | "Äquator-Überflüge" | sum | yes | `equatorCrossingCount` |
| `arcticFlights` | "Arktis-Flüge" | sum | yes | `arcticFlightCount` |
| `oceanCrossings` | "Ozean-Überflüge" | sum | yes | `oceanCrossingCount` |
| `hemisphereHops` | "Hemisphären-Wechsel" | sum | yes | `hemisphereHopCount` |
| `dateLineCrossings` | "Datumsgrenze" | sum | yes | `dateLineCrossingCount` |
| `continentalExplorer` (+ `continents`) | "Kontinental-Entdecker" | distinct (continents touched) | yes | `continentsTouchedByFlightCount` |
| `tropicsTraveler` | "Tropen-Reisender" | sum | yes | `tropicsFlightCount` |
| `eastWestBalance.eastward`/`.westward` (+ `.ratio`) | "Ost/West-Bilanz" | sum ×2 / ratio | yes / numerator+denominator | `eastwardFlightCount` / `westwardFlightCount` / `eastWestBalanceRatio` |
| `sameDayFlights` | "Eintagesflüge" | sum | yes | `sameDayFlightCount` |
| `midnightFlights` | "Mitternachtsflüge" | sum | yes | `midnightFlightCount` |
| `seasonalExplorer` (+ `seasonsCount`) | "Saison-Entdecker" | boolean | supporting rows if true | `seasonalExplorerAchieved` |
| `internationalVsDomestic.international`/`.domestic` (+ `.ratio`) | "International/Inland" | sum ×2 / ratio | yes / numerator+denominator | `internationalFlightCount` / `domesticFlightCount` / `internationalDomesticRatio` |
| `roundTripMaster` | "Rundreisen-Meister" | sum | yes | `roundTripFlightCount` |
| `highestAirport` | "Höchster Flughafen" | extremum (1 witness airport) | yes | `highestAirportAltitudeM` |
| `northernmost`/`southernmost` | "Nördlichster/Südlichster Flughafen" | extremum | yes | `northernmostAirportLat` / `southernmostAirportLat` |
| `longestTravelChain` | "Längste Reisekette" | sequence | yes | `longestTravelChainLength` |
| `fastestRoute` | "Schnellste Route" | extremum | yes | `fastestRouteSpeedKmh` |
| `mostCountriesInDay`/`mostCountriesDate` | "Meiste Länder an einem Tag" | extremum (distinct-per-day, max over days) | yes | `mostCountriesInOneDayCount` |
| `longestLayover`/`shortestLayover` | "Längster/Kürzester Layover" | extremum — **TWO witnesses** (arrival + next departure), per design's refutation of "one winner, one row" | yes, 2 rows | `longestLayoverHours` / `shortestLayoverHours` |

## Flight tab — business statistics (`StatsBusinessSection`)

`calculateBusinessStats` (`utils/stats/businessStats.ts`), fed by
`GET /stats/business`, allTime.

| Field | Aggregation | Registry key |
|---|---|---|
| `totalCost` | sum (may be `null`) | `businessTotalCost` |
| `costPerKm` | ratio | `businessCostPerKm` |
| `costPerHour` | ratio | `businessCostPerHour` |
| `airportDiversity` | distinct (distinct airports) — **same underlying question as `StatsAirportsSection.airportCount` below; kept as one shared key rather than two,** since both read "distinct airports visited" even though the two surfaces call different functions | `airportsVisitedCount` |
| `avgFlightDuration` | ratio | `businessAvgFlightDurationMinutes` — kept **separate** from the overview's `avgFlightDurationMinutes`: same shape, different calculator (`calculateBusinessStats` vs. the page's own client reduction), and the design's own precedent (`airportLookup.ts` comment) is not to assume two same-looking numbers agree without checking |
| `busiestMonth`/`busiestMonthFlights` | extremum | `busiestMonthFlightCount` |
| `mostCommonCategory` | extremum (mode) | `mostCommonBookingCategory` |
| `seatClassDistribution` | distribution | — (see "distributions kept out") |

## Flight tab — airport statistics (`StatsAirportsSection`)

`calculateAirportStats` (`utils/stats/airportStats.ts`), fed by
`GET /stats/airports`, allTime.

| Field | Aggregation | Registry key |
|---|---|---|
| `airportCount` | distinct | `airportsVisitedCount` (shared with `businessStats.airportDiversity`, see above) |
| `countryCount` | distinct | `flightCountriesVisitedCount` — **deliberately separate from the country RANKING's implicit distinct count** (`countriesIso.length` on `GET /stats/countries`), per the design's refutation #3: "these are LISTS, and they stay lists." Two numbers, two calculators, both legitimately "how many countries by flight." |
| `continentCount`/`continentTotal` | distinct (numerator) shown against a constant denominator | `continentsVisitedCount` — the "/6" is a fixed constant, not itself evidence-backed |
| `topAirports` | ranking (see rankings table) | — |
| `topCountries` | ranking (see rankings table) | — |
| `farthestFromHome` | extremum | `farthestAirportDistanceKm` |
| `newThisYear` | list, no numeric tile (only codes+dates shown) | — not a number |
| `rarestAirports` | list, no numeric tile (only codes shown, implicitly "visited once") | — not a number |
| `continentDistribution` | distribution | — (see "distributions kept out"; also the closest existing source for the undetermined `continent` ranking, see above) |

## Flight tab — punctuality (`PunctualitySection`)

`services/punctualityStats.ts`, fed by `GET /stats/punctuality`, allTime.
Section hides itself when `sampleSize === 0`.

| Field | Aggregation | Registry key |
|---|---|---|
| `sampleSize` (shown in the subtitle) | sum | `punctualitySampleSize` |
| `avgDelayMinutes` | ratio | `punctualityAvgDelayMinutes` |
| `onTimeRate` | ratio | `punctualityOnTimeRate` |
| `bestAirline`/`worstAirline` (key, avgDelayMinutes, flights) | extremum | `punctualityBestAirlineDelay` / `punctualityWorstAirlineDelay` |
| `worstRoute` | extremum | `punctualityWorstRouteDelay` |

## Gesamt (cross-domain overview) tab (`OverviewTab` and children)

Client-side fold, `frontend/src/components/Stats/Overview/aggregate.ts`
(`aggregate()`), over each domain's adapter under
`frontend/src/lib/stats/domain-stats/*Adapter.ts`, which each read their own
backend endpoint. **Scope is deliberately recorded as `domainFiltered`** for
this whole tab: every number here additionally depends on which domain chips
are toggled on, which is the property the design doc calls out by name
("the overview's countries depend on which domains are visible") — it is
ALSO year-or-lifetime scoped, but `domainFiltered` is what makes this surface
distinct from a same-shaped single-domain metric.

| Component | Field | Aggregation | Evidence? | Registry key |
|---|---|---|---|---|
| `CrossDomainKpis` | `agg.totalEvents` ("Erlebnisse") | sum, across visible domains | yes, per domain's own rows | `crossDomainEventCount` |
| `CrossDomainKpis` | `agg.countriesCount` ("Länder") | distinct, union across visible domains | yes | `crossDomainCountryCount` |
| `CrossDomainKpis` | `agg.activeDays` ("Aktive Tage") | distinct (unioned day keys; falls back to a `sum` for domains without a `dailyActiveDays` index — a recorded, not guessed, inconsistency) | yes for domains with the index | `crossDomainActiveDayCount` |
| `CrossDomainKpis` | `achievements.unlockedAchievements`/`totalPoints` | sum | — achievement kind, release 2 regardless | `crossDomainUnlockedAchievementCount` (servedIn 2, see achievements section) |
| `DomainSummaryCard` | `stats.totalEvents`/`yearlyEvents[year]` per domain | sum | yes | reuses the domain's own metric key (`yearFlightCount` etc. for flight; cruise/lodging/poi below) |
| `DomainSummaryCard` | `headlineKpis`/`topItems` per domain | **NOT DETERMINED individually** — each domain adapter (`flightStatsAdapter.ts`, `cruiseStatsAdapter.ts`, `lodgingStatsAdapter.ts`, `poiStatsAdapter.ts`) composes its own small set of headline figures and top-item lists; this walk did not open each adapter to classify every one of them. Recorded as unknown rather than guessed. | — | unknown | — |

## Cross-domain travel account (`TravelAccountSection`)

`services/stats/travelAccount.ts` `buildTravelAccount`, fed by
`GET /stats/travel-account`, allTime (no year param — the response is
itself a per-year breakdown array).

| Field | Aggregation | Registry key |
|---|---|---|
| `hotelNights`/`seaNights`/`airNights`/`homeNights` per year (bar widths) | sum, per year | `travelAccountHotelNights` / `travelAccountSeaNights` / `travelAccountAirNights` / `travelAccountHomeNights` |
| `account.contestedNights` | sum (nights two domains both claim) | `travelAccountContestedNights` |
| `trips.fullyCoveredTrips`/`tripsWithDates` | sum ×2 (ratio shown as "X / Y") | `travelAccountFullyCoveredTripCount` / `travelAccountTripsWithDatesCount` |
| `trips.totalUncoveredDays` | sum | `travelAccountUncoveredDayCount` |
| `trips.avgTripDays`/`longestTripDays` | ratio / extremum | `travelAccountAvgTripDays` (ratio) / `travelAccountLongestTripDays` (extremum) |
| `trips.journalEntries` | sum | `travelAccountJournalEntryCount` |
| `trips.moods` (top 3, with counts) | distribution | — (see "distributions kept out") |

## Cruise tab (`CruiseStatsSection`)

`calculateCruiseStats` (`utils/cruiseStats.ts`), fed by
`GET /stats/cruise?year=`, scope **year or allTime** (`year === null` when
the page has no year selected).

| Field | Aggregation | Registry key |
|---|---|---|
| `cruisesCount` | sum | `cruiseCount` |
| `totalDistanceKm` | sum | `cruiseDistanceKmTotal` |
| `seaDays` | sum | `cruiseSeaDaysTotal` |
| `cruisePortsUnique` | distinct | `cruisePortsUniqueCount` |
| `cruiseShipsUnique` | distinct | `cruiseShipsUniqueCount` |
| `cruiseLinesUnique` | distinct | `cruiseLinesUniqueCount` |
| `totalCruiseDays` | sum | `cruiseTotalDays` |
| `countries`/`countriesIso` | distinct | `cruiseCountriesCount` |
| `avgPortsPerCruise` (derived: `totalPortCalls / cruisesCount`) | ratio | `cruiseAvgPortsPerCruise` |
| `longestLegKm` | extremum | `cruiseLongestLegKm` |
| `cruisePortsSingleMax` | extremum | `cruisePortsSingleTripMax` |
| `cruiseLineLoyaltyMax` | extremum | `cruiseLineLoyaltyMax` |
| `seaDaysStreak` | sequence | `cruiseSeaDaysStreak` |
| `maxDeck` | extremum | `cruiseMaxDeck` |
| `revisitRatePct` (derived: `(identifiableCalls - cruisePortsUnique) / identifiableCalls`) | ratio | `cruisePortRevisitRate` |
| `regionVisitCounts`, `cruiseLines`/`regions`/`countries` tag clouds | distribution | — (see "distributions kept out") |
| `hasBalconyCabin`/`hasSuiteCabin`/`hasPolar`/`hasColdWater`/`hasCanalTransit`/`hasDatelineCrossing`/`hasBirthdayAtSea`/`hasNewYearsAtSea` | boolean ×8 | `cruiseFlagAchieved` (one representative key; eight independent boolean facts, same shape) |
| `CruiseRhythmSection`/`CruiseMoneySection`/`CruiseFunSection` (via `deriveCruiseStats`, client-side over `cruisesStartedIn`-filtered rows) — longest/shortest cruise nights, average nights, per-currency spend, per-night cost, highest deck flown, cabin types, companions, "most ports single trip" | mixed: sum (spend, companions), ratio (per-night cost, average nights), extremum (longest/shortest, highest deck) | **not individually keyed** — see "Distributions and deep sub-sections kept out of the registry" below; representative sum entries added: `cruiseCompanionCount` (sum), `cruiseTotalSpend` (sum, per currency) |

## Lodging tab (`LodgingStatsSection`)

`utils/lodgingStats/index.ts` `calculateLodgingStats`, fed by
`GET /lodging/stats?year=`, scope **year or allTime**.

| Field (via `LodgingStatStrip`) | Aggregation | Registry key |
|---|---|---|
| `staysCount` | sum | `lodgingStaysCount` |
| `totalNights` | sum | `lodgingNightsTotal` |
| `lodgingsCount` | distinct | `lodgingsUniqueCount` |
| `countriesCount` | distinct | `lodgingCountriesCount` |
| `LodgingCurrencyBreakdown` — `spendByCurrency`/`spendBaseByCurrency` | sum, per currency | `lodgingSpendTotal` |
| `LodgingMoneySection` — avg/median per night, award nights/value, cheapest/dearest, by board/chain/country/year breakdowns | ratio (avg/median), sum (award nights), extremum (cheapest/dearest) | not individually keyed (see below); representative: `lodgingAvgCostPerNight` (ratio), `lodgingAwardNightsCount` (sum) |
| `LodgingQualitySection` — overall/room/service/breakfast ratings, best value, by stars/chain/country/type | ratio (averages), extremum (best value) | not individually keyed; representative: `lodgingAvgOverallRating` (ratio) |
| `LodgingGeoSection` — centre of gravity, northernmost/southernmost, top cities/countries, continents | extremum, distinct | not individually keyed; representative: `lodgingContinentsCount` (distinct) |
| `LodgingRhythmSection` — busiest month, longest gap/streak, nights away, by season/weekday | extremum, sequence, sum | not individually keyed; representative: `lodgingNightsAwayTotal` (sum) |
| `LodgingLoyaltySection` — top chain, chain share/concentration, current tier, programme years | ratio, extremum | not individually keyed; representative: `lodgingTopChainShare` (ratio) |
| `LodgingRecordsSection` — longest stay, most returns, one-nighters, perfect stays | extremum, sum (one-nighters/perfect-stays counts) | `lodgingLongestStayNights` (extremum); `lodgingOneNightStayCount` (sum); `lodgingPerfectStayCount` (sum) |

## Places tab (`PoiStatsSection`)

Client-side `derivePoiStats`/`adaptPoi` (`lib/stats/poiStatsDetail.ts`,
`lib/stats/domain-stats/poiStatsAdapter.ts`) over `listPlaces` (fetched
all-time, then cut to the selected year by `placesVisitedIn` — **there is no
backend places rollup**, per the file's own header comment). Scope
**year or allTime**.

| Field | Aggregation | Registry key |
|---|---|---|
| `visitedPlaces.length` | distinct | `placesVisitedCount` |
| `totalEvents`/`visitsTotal` (`visitsDated`+`visitsUndated`) | sum | `placeVisitCount` |
| `countries.size` | distinct | `placeCountriesCount` |
| `cities.size` | distinct | `placeCitiesCount` |
| `lists.length` (own + curated) | sum | `placeListCount` |
| `wishlistCount` | sum | `placeWishlistCount` |
| `categoryRows`/`countryRows`/`cityRows`/`mostVisited` (ranked bar lists) | distribution/ranking-shaped, not one of the five named release-1 dimensions | — (see "distributions kept out") |
| `checklistRows` (ticked/total per curated checklist) | ratio, per checklist | not individually keyed |
| `PoiRhythmSection` — busiest day/month/weekday, streak | extremum, sequence | not individually keyed; representative: `placeVisitStreakLength` (sequence) |
| `PoiFunSection` — category coverage, favourite, first visit, northernmost/southernmost | ratio (coverage), extremum | not individually keyed; representative: `placeCategoryCoveragePct` (ratio) |
| `PoiQualitySection` — average rating, best rated | ratio, extremum | not individually keyed; representative: `placeAvgRating` (ratio) |

## Distributions and deep sub-sections kept out of the registry — rationale

Two different reasons put a number outside the registry, and they are worth
telling apart:

1. **Ranking-shaped but not one of the five named dimensions** (seat class,
   status, boarding group, weekday/season chart, region/tag clouds, ranked
   bar lists on the places tab). Registering these would either misuse
   `sum`/`distinct` for something that is really N numbers, or invent
   dimensions the design doc never named. Left out on purpose.
2. **Deep leaf numbers inside a domain's own money/quality/geo/rhythm/
   loyalty/records sub-sections** (lodging, cruise, places). Every one of
   these is `extremum`, `ratio`, or `sequence` — Decision 1 already assigns
   the entire set to `servedIn: 2` regardless of how finely they are keyed,
   so exploding roughly 60 more leaf keys would not change release-1 scope by
   a single measure. One representative key per sub-section is registered
   instead (named above), and the rest are catalogued here at the
   sub-component level rather than individually. This is a scoping judgment
   made to keep the walk tractable, not a silent gap — flagged as such in
   the task report.

## Achievements page — everything here is `servedIn: 2` per Decision 1

`AchievementsPage.tsx` + `AchievementCard.tsx` + `AchievementLeaderboard.tsx`.
Calculator: `GET /achievements` reads pre-computed rows written by
`utils/achievementChecks.ts` (`checkAchievement`, ~146-case switch) via
`utils/achievementWrites.ts`; `GET /achievements/leaderboard`
(`routes/achievements.ts`) aggregates points across users. Achievements
carry no year — `unlockedAt` is a write-time timestamp, not a measurement
date, per the design doc's "Two things release 2 must settle" — so nothing
here is `year`-scoped.

**Fix round 1 (2026-09-18) correction:** the header-meta unlocked/total,
retired-unlocked, tier-strip and category-pill figures are NOT `allTime` —
`AchievementsPage.tsx` computes all four from `visibleAchievements =
filterAchievementsByDomain(achievements, enabled)`, the same
domain-chip-filtered population the `crossDomain*` measures already use, so
they are `domainFiltered`. `summary.totalPoints`, the per-card figures, and
the leaderboard read a different, unfiltered path (the server's
`AchievementSummary`, or another user's own catalogue) and stay `allTime`.

| Field | Scope | Aggregation | Registry key |
|---|---|---|---|
| Header meta — `counts.unlocked`/`counts.total` | domainFiltered | sum/distinct (count of achievement rows) | `achievementUnlockedCount` |
| Header meta — `summary.totalPoints` | allTime | sum | `achievementTotalPoints` |
| Header meta — `counts.retiredUnlocked` | domainFiltered | sum | `achievementRetiredUnlockedCount` |
| Tier strip — per-tier unlocked/total (5 tiers) | domainFiltered | sum, per tier | `achievementTierProgress` (one representative key; five tiers) |
| Category pills — per-category count (8 categories) | domainFiltered | sum, per category | `achievementCategoryCount` (one representative key; eight categories) |
| `AchievementCard` — `points` | allTime | sum | reuses `achievementTotalPoints`'s shape, per-row |
| `AchievementCard` — `progress`/`requirement`/`progressPercentage` | allTime | ratio | `achievementProgressRatio` |
| `AchievementCard` — `unlockedAt` | — | not a number (a date) — no registry entry | — |
| `AchievementLeaderboard` — `achievementCount` per entry | allTime | sum | `leaderboardAchievementCount` |
| `AchievementLeaderboard` — `totalPoints` per entry | allTime | sum | `leaderboardTotalPoints` |
| `AchievementLeaderboard` — `rank` | not a measured number (a sort position) — no registry entry | — |

## Summary

- Numbers found by the walk: **≈ 140**, counting each named field once
  (grouped distribution buckets and the ~60 deep lodging/cruise/places
  sub-section leaves as single rows per the rationale above).
- Registered in `EVIDENCE_MEASURES`: see the registry file; counts are
  stated in the commit message and the task report.
- Not determined (recorded as unknown rather than guessed): the `continent`
  ranking dimension's calculator, and the individual aggregation kind of
  each domain adapter's `headlineKpis`/`topItems` on the Gesamt tab.
