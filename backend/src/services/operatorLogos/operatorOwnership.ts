/**
 * Whether a user may make the server look an operator up (forgejo#323 review).
 *
 * The mark endpoints take a free-text name, and every unknown name is up to
 * two serial Wikimedia searches. So only a name the server already has a
 * reason to know is ever looked up: one in the vendored catalogues, or one
 * the user's OWN journeys record for that domain. An arbitrary string answers
 * "no logo" without a request leaving the instance.
 */
import { prisma } from "../../db";
import { findRailOperator } from "../rail/operatorCatalog";
import { findRentalProvider } from "../rentalProviders/providerCatalog";
import type { OperatorDomain } from "./operatorMarkService";

export async function isKnownOperatorName(
  userId: string,
  domain: OperatorDomain,
  name: string
): Promise<boolean> {
  if (domain === "rail" && findRailOperator(name)) return true;
  if (domain === "rental" && findRentalProvider(name)) return true;
  const same = { equals: name, mode: "insensitive" as const };
  switch (domain) {
    case "rail":
      return (await prisma.railJourney.count({ where: { userId, operator: same }, take: 1 })) > 0;
    case "bus":
      return (await prisma.busJourney.count({ where: { userId, operator: same }, take: 1 })) > 0;
    case "ferry":
      return (await prisma.ferryJourney.count({ where: { userId, operator: same }, take: 1 })) > 0;
    case "rental":
      return (
        (await prisma.rentalBooking.count({
          where: { userId, OR: [{ provider: same }, { operatedBy: same }] },
          take: 1,
        })) > 0
      );
    case "cruise":
      return (
        (await prisma.cruise.count({
          where: { userId, OR: [{ cruiseLine: same }, { ship: { cruiseLine: same } }] },
          take: 1,
        })) > 0
      );
  }
}
