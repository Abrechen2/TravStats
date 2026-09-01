/**
 * Pins the three rules the classifier's header claims for itself, not just the
 * happy path. Each of the three came out of a shipped bug, so the tests that
 * matter here are the adversarial ones: a flight mail that also sells a hotel,
 * a newsletter that quotes a price, and a document with one thin clue.
 *
 * A happy-path test would pass against a classifier that simply counts the word
 * "Hotel" — which is exactly the classifier we must not have.
 */

import { scoreDocument, type DomainScore } from "../documentDomain";
import { PARSER_SUPPORTED_DOMAINS, type ParserSupportedDomain } from "../../../shared/domains";

/**
 * Reads one domain out of the candidate list. Written as a lookup with an
 * explicit throw rather than a non-null assertion so a missing domain fails
 * with a sentence instead of a TypeError three lines later.
 */
const candidate = (
  candidates: readonly DomainScore[],
  domain: ParserSupportedDomain
): DomainScore => {
  const found = candidates.find((entry) => entry.domain === domain);
  if (found === undefined) {
    throw new Error(`No candidate for domain "${domain}" — candidates are incomplete`);
  }
  return found;
};

// --- Fixtures ---------------------------------------------------------------
// Multi-line and shaped like the real thing. A one-line fixture cannot show
// whether the STRUCTURE was recognised or just a noun, and structure is the
// whole point of the weighting.

const DE_FLIGHT = `Lufthansa – Ihre Buchungsbestätigung

Buchungscode: X7K2QP
Flug LH 401 am 14. März 2026
Strecke: FRA – JFK
Frankfurt am Main, Terminal 1, Gate B24
Abflug 10:25 Uhr, Boarding ab 09:45 Uhr
Freigepäck: 1 Gepäckstück bis 23 kg
Online-Check-in ab 24 Stunden vor Abflug möglich`;

const DE_LODGING = `Booking.com – Ihre Buchung ist bestätigt

Hotel Alpenblick, Garmisch-Partenkirchen
Anreise: Freitag, 12. Juni 2026 ab 15:00 Uhr
Abreise: Montag, 15. Juni 2026 bis 11:00 Uhr
3 Nächte, 2 Gäste
Zimmerkategorie: Doppelzimmer mit Balkon
Frühstück inklusive`;

const DE_CRUISE = `AIDA Cruises – Ihre Reiseunterlagen

Kreuzfahrt "Kanaren im Winter"
Einschiffung: 07. Februar 2026, Hafen Las Palmas
Ausschiffung: 14. Februar 2026
Kabine 8215, Deck 8 (Balkonkabine)
Seetag am 09. Februar
Bordguthaben: 100 EUR pro Person`;

/** The adversarial one: a real flight document whose footer sells a hotel. */
const DE_FLIGHT_WITH_HOTEL_OFFER = `Lufthansa – Ihre Buchungsbestätigung

Buchungscode: X7K2QP
Flug LH 401 am 14. März 2026
Strecke: FRA – JFK
Terminal 1, Gate B24, Boarding ab 09:45 Uhr
Freigepäck: 1 Gepäckstück bis 23 kg

Passend zu Ihrem Flug: Hotel in Manhattan ab 129 EUR pro Nacht dazubuchen.`;

/**
 * Content-free marketing mail. Carries the literal price from forgejo#35 twice:
 * once lowercase as it was reported, once shouted in a headline, because the
 * uppercase form is the one that actually looks like the Air Berlin flight
 * number AB380 and therefore the one the guard has to survive.
 */
const DE_MARKETING = `SOMMER-SPECIAL 2026

Jetzt buchen und sparen: Städtetrips ab 380 EUR pro Person!
AB 380 EUR nach Mallorca, ab 149 EUR nach Rom.
Flug und Hotel bequem zusammen buchen.

Newsletter abbestellen? Klicken Sie hier.`;

const EN_FLIGHT = `British Airways — Booking confirmation

Booking reference: QT4L9Z
Flight BA 286 on 3 May 2026
LHR – SFO
Departure 11:40, Terminal 5, Gate A12
Boarding time 11:05
Checked baggage: 1 x 23 kg
Online check-in opens 24 hours before departure`;

const EN_LODGING = `Booking.com — Your reservation is confirmed

The Riverside Inn, Bath
Check-in: Friday, 12 June 2026 from 15:00
Check-out: Monday, 15 June 2026 until 11:00
3 nights, 2 adults
Room type: Double room, breakfast included`;

const EN_CRUISE = `Royal Caribbean — Cruise ticket booklet

Ship: Anthem of the Seas
Embarkation: 7 February 2026, Southampton
Cabin 8215, Deck 8 — balcony stateroom
Day at sea on 9 February
Port of call: Vigo`;

describe("scoreDocument — realistic confirmations", () => {
  it("reads a German airline confirmation as a flight, on structure not on nouns", () => {
    const result = scoreDocument(DE_FLIGHT);

    expect(result.domain).toBe("flight");
    expect(result.confidence).toBe(1);
    // The two weight-5 signals are what make this a flight; if only the word
    // "Flug" had matched, the answer would be right for the wrong reason.
    const flight = candidate(result.candidates, "flight");
    expect(flight.matched).toEqual(expect.arrayContaining(["flight-number", "iata-route"]));
    expect(candidate(result.candidates, "lodging").score).toBe(0);
    expect(candidate(result.candidates, "cruise").score).toBe(0);
  });

  it("reads a German Booking.com confirmation as lodging", () => {
    const result = scoreDocument(DE_LODGING);

    expect(result.domain).toBe("lodging");
    expect(result.confidence).toBe(1);
    const lodging = candidate(result.candidates, "lodging");
    // Anreise/Abreise as a pair and a night count — the lodging shape.
    expect(lodging.matched).toEqual(expect.arrayContaining(["checkin-checkout", "nights"]));
    expect(candidate(result.candidates, "flight").score).toBe(0);
  });

  it("reads a German cruise confirmation as a cruise", () => {
    const result = scoreDocument(DE_CRUISE);

    expect(result.domain).toBe("cruise");
    expect(result.confidence).toBe(1);
    const cruise = candidate(result.candidates, "cruise");
    expect(cruise.matched).toEqual(
      expect.arrayContaining(["cabin-deck", "sea-day", "embarkation"])
    );
    expect(candidate(result.candidates, "lodging").score).toBe(0);
  });
});

describe("scoreDocument — rule 2: a bare noun is weak, a structure is strong", () => {
  it("keeps a flight confirmation that also offers a hotel on flight", () => {
    // This is the case the weights exist for. Half of all airline mail sells a
    // hotel in its footer; if the bare noun could outvote a flight number, every
    // such mail would be filed as a stay.
    const result = scoreDocument(DE_FLIGHT_WITH_HOTEL_OFFER);

    expect(result.domain).toBe("flight");
    expect(result.confidence).toBeGreaterThan(0.8);

    const lodging = candidate(result.candidates, "lodging");
    // The hotel offer IS seen — it just isn't evidence of a stay. Only the
    // weight-1 noun fires; no check-in/check-out pair, no night count.
    expect(lodging.matched).toEqual(["hotel-noun"]);
    expect(lodging.score).toBe(1);
    expect(candidate(result.candidates, "flight").score).toBeGreaterThan(lodging.score * 10);
  });

  it("does not let the word Hotel alone outrank a single flight structure", () => {
    // Deliberately lopsided in the noun's favour: three lodging nouns against
    // one flight number. Weight, not count, has to decide.
    const result = scoreDocument("Hotel, Pension oder Hostel gefällig? Ihr Flug LH 401 wartet.");

    expect(result.domain).toBe("flight");
  });
});

describe("scoreDocument — rule 1: a signal counts once, however often it repeats", () => {
  it("scores one occurrence and twenty occurrences identically", () => {
    // Otherwise the longest document wins, and marketing mail is the longest
    // thing anybody forwards (forgejo#17).
    const once = scoreDocument("Boarding");
    const many = scoreDocument(Array.from({ length: 20 }, () => "Boarding").join("\n"));

    const flightOnce = candidate(once.candidates, "flight");
    const flightMany = candidate(many.candidates, "flight");

    expect(flightMany.score).toBe(flightOnce.score);
    expect(flightMany.matched).toEqual(flightOnce.matched);
    expect(many.confidence).toBe(once.confidence);
  });

  it("does not let a repeated weak noun beat a single strong structure", () => {
    // The direct consequence of rule 1: shouting "Hotel" thirty times must not
    // add up to a check-in/check-out pair.
    const shouted = Array.from({ length: 30 }, () => "Hotel").join(" ");
    const result = scoreDocument(`${shouted}\nFlug LH 401, Strecke FRA – JFK`);

    expect(result.domain).toBe("flight");
    expect(candidate(result.candidates, "lodging").score).toBe(1);
  });
});

describe("scoreDocument — forgejo#35: a price is not a flight number", () => {
  it("does not fire the flight-number signal on 'ab 380 EUR'", () => {
    const result = scoreDocument(DE_MARKETING);

    const flight = candidate(result.candidates, "flight");
    expect(flight.matched).not.toContain("flight-number");
    expect(flight.matched).not.toContain("iata-route");
  });

  it("leaves content-free marketing mail at a confidence nobody would act on", () => {
    const result = scoreDocument(DE_MARKETING);

    // The nouns "Flug" and "Hotel" each fire once, so the mail is not silent —
    // but two weight-1 nouns are not a booking, and the number has to say so.
    expect(result.confidence).toBeLessThan(0.15);
    expect(candidate(result.candidates, "flight").score).toBe(1);
    expect(candidate(result.candidates, "lodging").score).toBe(1);
  });

  it("still recognises a genuine flight number that is not followed by a currency", () => {
    // The guard has to be narrow: AB 380 really is an Air Berlin flight number.
    // Suppressing every "AB 380" would trade one bug for the opposite one.
    const result = scoreDocument("Ihr Flug AB 380 nach Mallorca startet pünktlich.");

    expect(candidate(result.candidates, "flight").matched).toContain("flight-number");
    expect(result.domain).toBe("flight");
  });
});

describe("scoreDocument — rule 3: thin evidence stays uncertain even when unanimous", () => {
  it("reports a lone weak match as low confidence, not as certainty", () => {
    // Exactly one weight-1 signal, for exactly one domain, contradicted by
    // nothing. Its SHARE of the evidence is 100%; its worth is not.
    const result = scoreDocument("Das Hotel war wirklich schön.");

    expect(result.domain).toBe("lodging");
    const lodging = candidate(result.candidates, "lodging");
    expect(lodging.matched).toEqual(["hotel-noun"]);
    expect(lodging.score).toBe(1);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.confidence).toBe(0.1); // share 1.0 × damping 1/10
  });

  it("applies the damping formula share × min(1, score / 10), rounded to 2 places", () => {
    // "Boarding" (flight, weight 3) beside "Hotel" (lodging, weight 1).
    // flight:  3/4 × 3/10 = 0.225 → 0.22
    // lodging: 1/4 × 1/10 = 0.025 → 0.03
    //
    // The two look inconsistent and are: 0.225 is not representable in binary
    // and evaluates to 0.22499999999999998, so it rounds down, while 0.025
    // lands just above and rounds up. Pinned as measured rather than as the
    // decimal arithmetic suggests — a confidence is a hint for a UI, so a
    // hundredth either way is not worth a rounding helper of our own, but a
    // silent change of the formula is worth catching.
    const result = scoreDocument("Boarding im Hotel");

    expect(candidate(result.candidates, "flight").confidence).toBeCloseTo(0.22, 5);
    expect(candidate(result.candidates, "lodging").confidence).toBeCloseTo(0.03, 5);
  });

  it("stops damping once the evidence is substantial", () => {
    // Above the substantial threshold the confidence is pure share, so an
    // uncontested well-evidenced document reaches a clean 1.
    const result = scoreDocument(DE_CRUISE);

    expect(candidate(result.candidates, "cruise").score).toBeGreaterThan(10);
    expect(result.confidence).toBe(1);
  });
});

describe("scoreDocument — it never refuses", () => {
  const nothingToGoOn: readonly string[] = [
    "",
    "   \n\t  \r\n ",
    "lorem ipsum dolor sit amet 1234 #### zzz qqq",
  ];

  it.each(nothingToGoOn)("returns the fallback domain instead of throwing for %j", (text) => {
    // The caller asked for `auto` and must get an answer it can act on — the
    // alternative is the "send the document three times" behaviour this exists
    // to remove. Falling back to the first supported domain keeps the historical
    // default (flight) rather than inventing a null the callers cannot handle.
    expect(() => scoreDocument(text)).not.toThrow();

    const result = scoreDocument(text);
    expect(result.domain).toBe(PARSER_SUPPORTED_DOMAINS[0]);
    expect(result.domain).not.toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.candidates.every((entry) => entry.score === 0)).toBe(true);
    expect(result.candidates.every((entry) => entry.matched.length === 0)).toBe(true);
  });

  it("keeps the headline and the candidate list agreeing when two domains tie", () => {
    // Regression, found by this suite: the candidate list used to tie-break
    // alphabetically while the headline tie-broke on PARSER_SUPPORTED_DOMAINS
    // order. "Boarding" (flight, 3) against "an Bord" (cruise, 3) is a genuine
    // tie, and every evidence-free document is one too — so the client was shown
    // `domain: flight` beside a switch list that opened with `cruise`.
    const result = scoreDocument("Boarding an Bord");

    expect(candidate(result.candidates, "flight").score).toBe(
      candidate(result.candidates, "cruise").score
    );
    expect(result.candidates[0].domain).toBe(result.domain);
    expect(result.domain).toBe("flight");
  });

  it("breaks a tie towards the first supported domain rather than picking at random", () => {
    // One weight-1 noun each. The evidence did not decide, so the historical
    // default does — deterministically, so a retry gives the same answer.
    const result = scoreDocument("Flug und Hotel");

    expect(candidate(result.candidates, "flight").score).toBe(
      candidate(result.candidates, "lodging").score
    );
    expect(result.domain).toBe(PARSER_SUPPORTED_DOMAINS[0]);
  });
});

describe("scoreDocument — the candidate list is a usable offer to switch", () => {
  const documents: ReadonlyArray<readonly [string, string]> = [
    ["German flight", DE_FLIGHT],
    ["German lodging", DE_LODGING],
    ["German cruise", DE_CRUISE],
    ["marketing", DE_MARKETING],
    ["empty", ""],
  ];

  it.each(documents)("%s: lists every supported domain exactly once", (_label, text) => {
    const result = scoreDocument(text);

    expect(result.candidates).toHaveLength(PARSER_SUPPORTED_DOMAINS.length);
    expect(new Set(result.candidates.map((entry) => entry.domain))).toEqual(
      new Set(PARSER_SUPPORTED_DOMAINS)
    );
  });

  it.each(documents)("%s: sorts candidates best first", (_label, text) => {
    const scores = scoreDocument(text).candidates.map((entry) => entry.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it.each(documents)("%s: the headline answer agrees with candidates[0]", (_label, text) => {
    // The client renders the headline and the runners-up from the same object.
    // If those two ever disagree it offers a switch to the domain it already
    // chose, which reads as a bug to the user even though both fields are
    // internally consistent.
    const result = scoreDocument(text);
    const best = result.candidates[0];

    expect(result.domain).toBe(best.domain);
    expect(result.confidence).toBe(best.confidence);
  });
});

describe("scoreDocument — English documents, not only German", () => {
  it("reads an English airline confirmation as a flight", () => {
    const result = scoreDocument(EN_FLIGHT);

    expect(result.domain).toBe("flight");
    expect(result.confidence).toBe(1);
    expect(candidate(result.candidates, "flight").matched).toEqual(
      expect.arrayContaining(["flight-number", "iata-route", "pnr"])
    );
    // "Booking reference: QT4L9Z" must not be read as a flight number, and
    // "check-in ... before departure" must not be read as a check-in/check-out
    // pair — both are the kind of near-miss that only shows up in real copy.
    expect(candidate(result.candidates, "lodging").score).toBe(0);
  });

  it("reads an English hotel confirmation as lodging", () => {
    const result = scoreDocument(EN_LODGING);

    expect(result.domain).toBe("lodging");
    expect(candidate(result.candidates, "lodging").matched).toEqual(
      expect.arrayContaining(["checkin-checkout", "nights", "room-category"])
    );
    expect(candidate(result.candidates, "flight").score).toBe(0);
  });

  it("reads an English cruise booklet as a cruise", () => {
    const result = scoreDocument(EN_CRUISE);

    expect(result.domain).toBe("cruise");
    expect(candidate(result.candidates, "cruise").matched).toEqual(
      expect.arrayContaining(["cabin-deck", "sea-day", "embarkation"])
    );
  });
});

describe("scoreDocument — the scan is bounded", () => {
  it("ignores evidence past the 20k scan limit", () => {
    // The cost must depend on the document, not on the size of the mail thread
    // somebody forwarded it in. The trade is explicit: a confirmation quoted at
    // the bottom of a very long thread is not seen.
    const padding = "x".repeat(20_000);

    expect(scoreDocument(`Boarding Gate B24 ${padding}`).confidence).toBeGreaterThan(0);
    expect(scoreDocument(`${padding} Boarding Gate B24`).confidence).toBe(0);
  });
});
