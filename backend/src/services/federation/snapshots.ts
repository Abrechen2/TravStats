import { domainMetrics } from "./domainMetrics";
import { validateAudience } from "./circles";
import { prisma } from "../../db";
import { type ComparisonGrant, type ComparisonLink, type Prisma } from "../../prisma";
import { loadVisibleDomains } from "../domainVisibility";
import { buildWhere, computeSummary } from "../stats/summary";
import { loadPassport } from "../stats/passportLoader";
import { loadDaysAway } from "../stats/daysAwayLoader";
import { scopeSchema, snapshotSchema, type Scope, type Snapshot } from "./contract";
import { refused } from "./security";

export function storedScope(raw: unknown): Scope & { acceptedAt: string; allExisting?: boolean } {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("acceptedAt" in raw) ||
    typeof raw.acceptedAt !== "string"
  )
    throw refused();
  const { acceptedAt, ...rest } = raw;
  const allExisting = "allExisting" in rest && rest.allExisting === true;
  delete (rest as Record<string, unknown>).allExisting;
  return { ...scopeSchema.parse(rest), acceptedAt, allExisting };
}
export async function currentGrant(link: ComparisonLink, audience: string) {
  if (link.revoked || !link.confirmed || !link.remoteConfirmed) throw refused();
  const owner = await prisma.user.findUnique({
    where: { id: link.userId },
    select: { isActive: true },
  });
  const grant = await prisma.comparisonGrant.findUnique({
    where: { linkId_audience: { linkId: link.id, audience } },
  });
  if (!owner?.isActive || !grant?.active || (grant.expiresAt && grant.expiresAt <= new Date()))
    throw refused();
  await validateAudience(link, audience);
  return grant;
}
export async function assertUnchanged(link: ComparisonLink, grant: ComparisonGrant) {
  const latest = await prisma.comparisonLink.findUnique({ where: { id: link.id } });
  if (!latest) throw refused();
  const current = await currentGrant(latest, grant.audience);
  if (current.revision !== grant.revision) throw refused();
}
export async function audit(link: ComparisonLink, grant: ComparisonGrant, operation: string) {
  await prisma.comparisonAudit.create({
    data: {
      ownerId: link.userId,
      channel: link.channel,
      audience: grant.audience,
      revision: grant.revision,
      operation,
    },
  });
}
export async function buildSnapshot(
  userId: string,
  scope: Scope & { acceptedAt: string; allExisting?: boolean },
  requestedYear: number | null
): Promise<Snapshot> {
  const year = scope.year ?? requestedYear;
  const visible = await loadVisibleDomains(userId);
  const domains = visible.filter((d) => scope.domains.includes(d));
  const selection = scope.tripIds.length > 0 || !scope.futureTrips;
  const where: Prisma.FlightWhereInput = await buildWhere(
    userId,
    undefined,
    undefined,
    year ?? undefined
  );
  if (selection) {
    if (scope.allExisting)
      where.OR = [
        { tripId: { in: scope.tripIds } },
        { tripId: null, createdAt: { lte: new Date(scope.acceptedAt) } },
      ];
    else where.tripId = { in: scope.tripIds };
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { baseCurrency: true },
  });
  const currency = settings?.baseCurrency ?? "EUR";
  const summary =
    (scope.statistics || scope.costs) && domains.includes("flight")
      ? (await computeSummary(where, currency)).stats
      : null;
  // The shared loaders do not yet accept a selected-trip/domain mask. Abstain rather than leak
  // excluded journeys through a full-account aggregate or invent a second counting definition.
  const allDomains = visible.length === domains.length;
  const passport =
    scope.statistics && !selection && allDomains && year === null
      ? await loadPassport(userId)
      : null;
  const away =
    scope.statistics && !selection && allDomains
      ? await loadDaysAway(userId, { year: year ?? undefined })
      : null;
  const trips =
    scope.details && scope.year === null
      ? await prisma.trip.findMany({
          where: {
            userId,
            ...(selection ? { id: { in: scope.tripIds } } : {}),
            ...(!scope.futureTrips ? { createdAt: { lte: new Date(scope.acceptedAt) } } : {}),
          },
          select: { id: true, name: true },
          take: 500,
          orderBy: { id: "asc" },
        })
      : [];
  const distance = scope.statistics ? (summary?.totalDistance ?? null) : null;
  return snapshotSchema.parse({
    version: 1,
    definition: "travstats-comparison-1",
    asOf: new Date().toISOString(),
    year,
    precision: scope.precision,
    coverage: selection ? "selection" : "all",
    domains,
    currency,
    metrics: {
      ...(await domainMetrics(
        userId,
        domains,
        year,
        scope.statistics && !selection && scope.precision === "exact"
      )),
      flights: scope.statistics ? (summary?.totalFlights ?? null) : null,
      distance:
        distance === null
          ? null
          : scope.precision === "rounded"
            ? Math.floor(distance / 1000) * 1000
            : distance,
      minutes:
        scope.statistics && scope.precision === "exact" ? (summary?.totalFlightTime ?? null) : null,
      countries: passport?.summary.countries ?? null,
      daysAway: away?.total ?? null,
      cost: scope.costs ? (summary?.totalCost ?? null) : null,
    },
    details: scope.details,
    trips,
  });
}
