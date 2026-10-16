import { prisma } from "../../db";
/**
 * Restoring an older consent must never restore a permission that has since been revoked.
 * E2E permissions are revoked outright. A leaderboard consent goes back to a question
 * (`pending`, `decidedAt` null) so its owner confirms it again; that includes a held-back offer
 * (`pending` with `decidedAt` set), which would otherwise auto-accept when the other side
 * answers, though its owner never re-confirmed. Local and remote friends share the table. This runs in the live
 * process (admin restore), yet takes none of the per-pair consent locks: a global single-statement
 * UPDATE cannot take them, the database was just replaced wholesale so in-flight transactions are
 * already invalid, and in READ COMMITTED a writer that commits first is re-evaluated by the UPDATE.
 */
export async function suspendComparisonAfterRestore(): Promise<void> {
  await prisma.$transaction([
    prisma.comparisonDevice.updateMany({ data: { revoked: true } }),
    prisma.comparisonPublication.deleteMany(),
    prisma.comparisonGrant.updateMany({ data: { active: false, revision: { increment: 1 } } }),
    prisma.comparisonLink.updateMany({ data: { revoked: true } }),
    prisma.comparisonPeer.updateMany({ data: { enabled: false, verifiedAt: null } }),
    prisma.comparisonInvite.updateMany({ where: { usedAt: null }, data: { usedAt: new Date() } }),
    prisma.leaderboardConsent.updateMany({
      where: { OR: [{ status: "accepted" }, { status: "pending", decidedAt: { not: null } }] },
      data: { status: "pending", decidedAt: null },
    }),
    prisma.leaderboardInvite.deleteMany(),
  ]);
}
