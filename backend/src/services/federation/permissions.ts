import { prisma } from "../../db";
import { scopeSchema, type Scope } from "./contract";
import { refused } from "./security";
export type PreparedScope = Scope & { acceptedAt: string; allExisting?: boolean };
/** The preview and saved consent resolve exactly the same selected resource population. */
export async function prepareScope(userId: string, input: Scope): Promise<PreparedScope> {
  const scope = scopeSchema.parse(input);
  const allExisting = !scope.futureTrips && !scope.tripIds.length;
  if (scope.tripIds.length || allExisting) {
    const owned = await prisma.trip.findMany({
      where: { userId, ...(scope.tripIds.length ? { id: { in: scope.tripIds } } : {}) },
      select: { id: true },
      take: 501,
    });
    if (
      owned.length > 500 ||
      (scope.tripIds.length && owned.length !== new Set(scope.tripIds).size)
    )
      throw refused();
    if (allExisting) scope.tripIds = owned.map((t) => t.id);
  }
  return { ...scope, allExisting, acceptedAt: new Date().toISOString() };
}
