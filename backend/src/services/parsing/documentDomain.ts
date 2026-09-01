/**
 * What kind of travel document is this? — Forgejo #57.
 *
 * Every parse route takes a `domain` and dispatches on it, which means the
 * caller has to have decided already. That is the one decision a caller cannot
 * make: whether a photographed confirmation is a hotel, a sailing or a flight
 * is a property of the DOCUMENT, not of the tap that sent it. Without this,
 * a client either asks the user in front of an empty screen, guesses, or sends
 * the same document three times and keeps whichever answer parsed.
 *
 * ## Why a scorer and not the LLM
 *
 * The LLM path is optional and frequently absent: it exists only when an admin
 * has configured `ollamaUrl` and `ollamaModel` (`services/parserSettings.ts`),
 * and on the preview hardware it was measured at 0.3 tokens/second, so every
 * parse ran into its timeout. A classifier that only works where Ollama works
 * is not a classifier. This is cheap, synchronous, dependency-free and
 * explainable: it returns the signals it matched, so a wrong answer can be
 * argued with rather than merely retried.
 *
 * (The `USE_LLM_PARSER` env var named in older notes is dead — no TypeScript
 * file reads it. Measured 2026-09-01; the only occurrence is a preview compose
 * file. Do not gate anything on it.)
 *
 * ## Three rules the scoring follows, each learned from a real bug
 *
 * 1. A SIGNAL COUNTS ONCE, however often it appears. Otherwise the longest
 *    document wins, and marketing mail is the longest thing anybody forwards.
 *    This is the same failure mode as #17 and #35 — a newsletter mentioning
 *    "ab 380 EUR" became flight AB380 — where repetition, not evidence, was
 *    doing the deciding.
 * 2. A BARE NOUN IS WEAK, A STRUCTURE IS STRONG. The word "Hotel" appears in
 *    half of all airline mail; a check-in date beside a check-out date does
 *    not. Weights encode that difference, so a flight confirmation offering a
 *    hotel does not become a hotel.
 * 3. THIN EVIDENCE MEANS LOW CONFIDENCE, EVEN WHEN IT IS UNANIMOUS. One weak
 *    match that nothing contradicts is not proof. The confidence formula damps
 *    for that explicitly rather than reporting a clean 1.0 for a single hit.
 *
 * ## What it deliberately does not do
 *
 * It never refuses. A caller asking for `auto` gets the leading domain even
 * when confidence is low, together with the runners-up — because the issue's
 * own ask is that a weak answer still returns what it parsed, so the client can
 * offer to switch without a second round trip. Refusing would force exactly the
 * "send it three times" behaviour this exists to remove.
 */

import { PARSER_SUPPORTED_DOMAINS, type ParserSupportedDomain } from "../../shared/domains";

/** One piece of evidence: a pattern, what it is worth, and a name for it. */
interface Signal {
  readonly id: string;
  readonly pattern: RegExp;
  readonly weight: number;
}

/**
 * Weights are on one scale across all three domains, so they can be compared:
 *
 *   5  structural — a shape only this kind of document has
 *   3  strong     — a term the other domains do not use
 *   2  supporting — typical, but imaginable elsewhere
 *   1  weak       — a bare noun; never decisive on its own
 *
 * German first and English beside it, because the sample corpus this was built
 * against is German and the product's primary locale is too.
 */
const SIGNALS: Record<ParserSupportedDomain, readonly Signal[]> = {
  flight: [
    // A flight number next to a route is the shape nothing else has. The
    // boundary and the airline-prefix rule matter: "ab 380 EUR" must not match,
    // which is the bug #35 was filed for.
    { id: "flight-number", pattern: /\b[A-Z]{2}\s?\d{2,4}\b(?!\s*(EUR|USD|GBP|€|\$))/, weight: 5 },
    {
      id: "iata-route",
      pattern: /\b[A-Z]{3}\s*(?:-|–|—|→|>|\bnach\b|\bto\b)\s*[A-Z]{3}\b/,
      weight: 5,
    },
    { id: "boarding", pattern: /\b(boarding|einsteigen|boardingzeit|boarding time)\b/i, weight: 3 },
    { id: "gate-terminal", pattern: /\b(gate|terminal)\s*[:\s]?\s*[A-Z]?\d{1,3}\b/i, weight: 3 },
    { id: "pnr", pattern: /\b(buchungscode|booking reference|record locator|pnr)\b/i, weight: 3 },
    {
      id: "baggage",
      pattern: /\b(freigep(ä|ae)ck|checked baggage|handgep(ä|ae)ck|carry-on)\b/i,
      weight: 2,
    },
    { id: "checkin-online", pattern: /\b(online[- ]check[- ]?in|web check[- ]?in)\b/i, weight: 2 },
    {
      id: "airport-word",
      pattern: /\b(flughafen|airport|abflug|departure|ankunft|arrival)\b/i,
      weight: 2,
    },
    { id: "flight-noun", pattern: /\b(flug|flight|airline|fluggesellschaft)\b/i, weight: 1 },
  ],
  cruise: [
    // Only a ship has a cabin and a deck together, and only a cruise has a
    // day at sea.
    {
      id: "cabin-deck",
      pattern: /\b(kabine|stateroom|cabin)\b[\s\S]{0,80}\b(deck|deck\s*\d)/i,
      weight: 5,
    },
    { id: "sea-day", pattern: /\b(seetag|day at sea|erholung auf see)\b/i, weight: 5 },
    {
      id: "embarkation",
      pattern: /\b(einschiffung|ausschiffung|embarkation|disembarkation)\b/i,
      weight: 5,
    },
    {
      id: "cruise-line",
      pattern:
        /\b(aida|tui cruises|mein schiff|msc kreuzfahrten|costa kreuzfahrten|norwegian cruise|royal caribbean|hapag[- ]lloyd cruises)\b/i,
      weight: 3,
    },
    { id: "port-call", pattern: /\b(hafen|anlaufhafen|port of call|liegezeit)\b/i, weight: 3 },
    {
      id: "on-board",
      pattern: /\b(an bord|on board|bordguthaben|trinkgeld an bord)\b/i,
      weight: 3,
    },
    { id: "ship-noun", pattern: /\b(schiff|kreuzfahrt|cruise|sailing)\b/i, weight: 2 },
    {
      id: "cabin-noun",
      pattern: /\b(kabine|stateroom|cabin|balkonkabine|innenkabine)\b/i,
      weight: 1,
    },
  ],
  lodging: [
    // A check-in date beside a check-out date is the lodging shape. The word
    // "Hotel" on its own is not — it appears in half of all airline mail.
    {
      id: "checkin-checkout",
      pattern: /\b(check[- ]?in|anreise)\b[\s\S]{0,200}\b(check[- ]?out|abreise)\b/i,
      weight: 5,
    },
    {
      id: "nights",
      pattern: /\b(\d+\s*(n(ä|ae)chte?|nights?|(ü|ue)bernachtungen?))\b/i,
      weight: 5,
    },
    {
      id: "room-category",
      pattern:
        /\b(doppelzimmer|einzelzimmer|zimmerkategorie|room type|suite|apartment|ferienwohnung)\b/i,
      weight: 3,
    },
    {
      id: "board",
      pattern:
        /\b(fr(ü|ue)hst(ü|ue)ck inklusive|halbpension|vollpension|all[- ]inclusive|breakfast included)\b/i,
      weight: 3,
    },
    {
      id: "platform",
      pattern: /\b(booking\.com|expedia|hrs|airbnb|hotels\.com|agoda|trivago)\b/i,
      weight: 3,
    },
    { id: "guests", pattern: /\b(\d+\s*(g(ä|ae)ste?|erwachsene|guests?|adults?))\b/i, weight: 2 },
    {
      id: "stay-noun",
      pattern: /\b(unterkunft|aufenthalt|accommodation|lodging|stay)\b/i,
      weight: 2,
    },
    { id: "hotel-noun", pattern: /\b(hotel|pension|hostel|gasthof)\b/i, weight: 1 },
  ],
};

/**
 * The score above which the evidence is considered substantial rather than
 * incidental. Two structural hits, or one structural plus two supporting.
 * Below it, confidence is damped proportionally — see `scoreDocument`.
 */
const SUBSTANTIAL_SCORE = 10;

/** How much text is examined. A confirmation announces itself early, and an
 *  unbounded scan makes the cost depend on the size of somebody's mail thread. */
const SCAN_LIMIT = 20_000;

export interface DomainScore {
  domain: ParserSupportedDomain;
  /** Summed weight of the distinct signals matched. */
  score: number;
  /** Share of the leader's evidence, damped for thin evidence. 0…1. */
  confidence: number;
  /** Which signals fired, so a wrong answer can be argued with rather than retried. */
  matched: string[];
}

export interface DomainDetection {
  /** The leading domain. Never null — see the header: this does not refuse. */
  domain: ParserSupportedDomain;
  confidence: number;
  /** Every domain, best first. The client can offer a switch without asking again. */
  candidates: DomainScore[];
}

/**
 * Score one document against all three domains.
 *
 * Ties are broken by the order of `PARSER_SUPPORTED_DOMAINS`, which puts flight
 * first — the historical default. A tie means the evidence did not decide, and
 * preserving the old behaviour there is the least surprising thing to do.
 */
export function scoreDocument(text: string): DomainDetection {
  const haystack = text.slice(0, SCAN_LIMIT);

  const scored = PARSER_SUPPORTED_DOMAINS.map((domain) => {
    const matched: string[] = [];
    let score = 0;
    for (const signal of SIGNALS[domain]) {
      // Rule 1: once per signal, however often it occurs.
      if (signal.pattern.test(haystack)) {
        matched.push(signal.id);
        score += signal.weight;
      }
    }
    return { domain, score, matched, confidence: 0 };
  });

  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  const leader = scored.reduce((best, entry) => (entry.score > best.score ? entry : best));

  /**
   * Rule 3. The share of the evidence pointing at a domain, multiplied by how
   * much evidence there was at all. A single weak match that nothing
   * contradicts scores 1.0 on share and would otherwise be reported as
   * certainty; the damping turns it into 0.1, which is what it is worth.
   */
  const withConfidence = scored.map((entry) => ({
    ...entry,
    confidence:
      total === 0
        ? 0
        : round2((entry.score / total) * Math.min(1, entry.score / SUBSTANTIAL_SCORE)),
  }));

  return {
    domain: leader.score > 0 ? leader.domain : PARSER_SUPPORTED_DOMAINS[0],
    confidence: withConfidence.find((e) => e.domain === leader.domain)?.confidence ?? 0,
    // Ties fall back to the same order the leader was picked in, NOT to
    // alphabetical — otherwise a tie makes `candidates[0]` disagree with
    // `domain` (every evidence-free document sorted `cruise` to the front while
    // the leader was `flight`), and the client renders a switch offer whose
    // first entry contradicts the answer beside it.
    candidates: [...withConfidence].sort(
      (a, b) => b.score - a.score || domainOrder(a.domain) - domainOrder(b.domain)
    ),
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Position in the canonical domain order — the one tie-break this file uses. */
const domainOrder = (domain: ParserSupportedDomain): number =>
  PARSER_SUPPORTED_DOMAINS.indexOf(domain);
