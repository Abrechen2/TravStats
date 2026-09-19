import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { EVIDENCE_MEASURES, type MeasureScope } from "../../../shared/evidenceMeasures";
import { RANKING_DIMENSIONS, rankingKey, type EvidenceScope } from "../../../shared/evidence";
import { resolveMetricEvidence, servedMetricKeys } from "../metricEvidence";
import { resolveRankingEvidence } from "../rankingEvidence";

/**
 * `shared/evidenceMeasures.ts` is 139 entries of `aggregation`, `unit`,
 * `scopes` and `servedIn` that NOTHING read: imported by its own tests and
 * by no resolver, no route and no component. 78 entries said `servedIn: 1`
 * while 18 had a resolver, so the field documented an intention rather than
 * describing the instance — and the next author, wiring the remaining 60
 * tiles, would have believed it.
 *
 * This test is the binding. It does not re-state the registry (a second copy
 * would drift the same way); it reads the resolver map and the registry and
 * requires them to agree on every served key, then does the same for the
 * ranking dimensions, which have no registry entries at all and whose
 * contract therefore lives here.
 */
describe("the evidence registry binds the resolvers that exist", () => {
  let userId: string;
  const page = { offset: 0, limit: 10 };

  /**
   * `domainFiltered` is a registry vocabulary word on a DIFFERENT axis from
   * the other three: it says the tile narrows by domain chip, not that it
   * has no period. The `crossDomainKpis` strip carries it and still offers
   * lifetime or a single year, which is why it maps to a real period here
   * and why the scope loop below treats it apart.
   */
  const scopeFor = (scope: MeasureScope): EvidenceScope | null => {
    if (scope === "allTime") return { period: { kind: "allTime" } };
    if (scope === "rolling12m") return { period: { kind: "rolling12m" } };
    if (scope === "year") return { period: { kind: "year", year: 2025 } };
    return { period: { kind: "allTime" }, domains: ["flight", "cruise", "lodging", "place"] };
  };

  const ALL_PERIOD_SCOPES: MeasureScope[] = ["allTime", "year", "rolling12m"];

  /** Which periods a `domainFiltered` measure must accept — the strip's own two. */
  const DOMAIN_FILTERED_PERIODS: MeasureScope[] = ["allTime", "year"];

  const acceptedPeriodsOf = (scopes: MeasureScope[]): MeasureScope[] =>
    scopes.includes("domainFiltered")
      ? DOMAIN_FILTERED_PERIODS
      : scopes.filter((scope) => scope !== "domainFiltered");

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceregistrybinding" } });
    const user = await prisma.user.create({
      data: { username: "evidenceregistrybinding", passwordHash: await hashPassword("pw123456") },
    });
    userId = user.id;
    await prisma.flight.create({
      data: {
        userId,
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 51.47,
        arrLon: -0.4543,
        depIata: "FRA",
        arrIata: "LHR",
        departureTime: new Date("2025-01-10T08:00:00Z"),
        arrivalTime: new Date("2025-01-10T09:30:00Z"),
        status: "flown",
        flightNumber: "RB100",
        airline: "Lufthansa",
        airlineIata: "LH",
        aircraft: "A320",
      },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("every resolver key is a registered measure marked servedIn: 1", () => {
    const unregistered = servedMetricKeys().filter((key) => !EVIDENCE_MEASURES[key]);
    expect(unregistered).toEqual([]);

    const notMarkedServed = servedMetricKeys().filter(
      (key) => EVIDENCE_MEASURES[key].servedIn !== 1
    );
    expect(notMarkedServed).toEqual([]);
  });

  /**
   * The converse is NOT asserted, deliberately: `servedIn: 1` means "release
   * 1 will serve it", and 60 of those keys are still waiting for a resolver.
   * Turning that into a failure would break the build for work that has not
   * started. What must never happen is the other direction — a resolver
   * answering for a key the registry does not describe, or describes as
   * release 2.
   */
  it("reports how far release 1 has got, without failing on the gap", () => {
    const promised = Object.keys(EVIDENCE_MEASURES).filter(
      (key) => EVIDENCE_MEASURES[key].servedIn === 1
    );
    expect(promised.length).toBeGreaterThanOrEqual(servedMetricKeys().length);
  });

  it("each resolver answers with the aggregation and unit its registry entry declares", async () => {
    for (const key of servedMetricKeys()) {
      const entry = EVIDENCE_MEASURES[key];
      const scope = scopeFor(entry.scopes[0]);
      expect([key, scope]).not.toEqual([key, null]);

      const res = await resolveMetricEvidence(userId, key, scope!, page);
      expect([key, res === null]).toEqual([key, false]);
      // The key rides in every assertion so a failure names WHICH measure
      // disagreed instead of printing two bare words.
      expect([key, res!.measure.aggregation]).toEqual([key, entry.aggregation]);
      expect([key, res!.measure.unit]).toEqual([key, entry.unit]);
      expect([key, res!.measure.key]).toEqual([key, key]);
    }
  });

  it("each resolver accepts exactly the scopes its registry entry lists, and 400s on the others", async () => {
    for (const key of servedMetricKeys()) {
      const entry = EVIDENCE_MEASURES[key];
      const accepts = acceptedPeriodsOf(entry.scopes);
      for (const candidate of ALL_PERIOD_SCOPES) {
        const scope = scopeFor(candidate)!;
        const declared = accepts.includes(candidate);
        let accepted = true;
        try {
          await resolveMetricEvidence(userId, key, scope, page);
        } catch (err) {
          accepted = false;
          // A rejected scope is a BAD REQUEST, not a missing key and not a
          // crash: the measure exists, the population asked for does not.
          expect([key, candidate, (err as { statusCode?: number }).statusCode]).toEqual([
            key,
            candidate,
            400,
          ]);
        }
        expect([key, candidate, accepted]).toEqual([key, candidate, declared]);
      }
    }
  });

  /**
   * Ranking dimensions are deliberately absent from `EVIDENCE_MEASURES` — a
   * ranking row is addressed by `rankingKey()`, not by a measure key — so
   * their aggregation/unit contract has no registry to live in and lives
   * here instead. `continent` is in `RANKING_DIMENSIONS` and served by
   * nobody, on purpose: no `/stats/continents` ranking exists for evidence to
   * agree with.
   */
  const RANKING_CONTRACT: Record<string, { unit: string; sample: string } | null> = {
    airline: { unit: "flights", sample: "iata:LH" },
    airport: { unit: "visits", sample: "FRA" },
    country: { unit: "flights", sample: "DE" },
    aircraftType: { unit: "flights", sample: "A320" },
    continent: null,
  };

  it("names every ranking dimension, and says which one is deliberately unserved", () => {
    expect(Object.keys(RANKING_CONTRACT).sort()).toEqual([...RANKING_DIMENSIONS].sort());
  });

  it("each served ranking dimension answers with its declared unit, all-time only", async () => {
    const allTime: EvidenceScope = { period: { kind: "allTime" } };
    for (const [dimension, contract] of Object.entries(RANKING_CONTRACT)) {
      if (!contract) {
        const res = await resolveRankingEvidence(
          userId,
          rankingKey(dimension as (typeof RANKING_DIMENSIONS)[number], "Europe"),
          allTime,
          page
        );
        expect([dimension, res]).toEqual([dimension, null]);
        continue;
      }
      const res = await resolveRankingEvidence(
        userId,
        rankingKey(dimension as (typeof RANKING_DIMENSIONS)[number], contract.sample),
        allTime,
        page
      );
      expect([dimension, res === null]).toEqual([dimension, false]);
      expect([dimension, res!.measure.aggregation]).toEqual([dimension, "sum"]);
      expect([dimension, res!.measure.unit]).toEqual([dimension, contract.unit]);
      expect([dimension, res!.measure.kind]).toEqual([dimension, "ranking"]);

      await expect(
        resolveRankingEvidence(
          userId,
          rankingKey(dimension as (typeof RANKING_DIMENSIONS)[number], contract.sample),
          { period: { kind: "year", year: 2025 } },
          page
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
