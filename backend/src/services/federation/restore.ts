import { prisma } from "../../db";
/** Restoring an older consent must never restore a permission that has since been revoked. */
export async function suspendComparisonAfterRestore(): Promise<void> {
  await prisma.$transaction([
    prisma.comparisonGrant.updateMany({ data: { active: false, revision: { increment: 1 } } }),
    prisma.comparisonLink.updateMany({ data: { revoked: true } }),
    prisma.comparisonPeer.updateMany({ data: { enabled: false, verifiedAt: null } }),
    prisma.comparisonInvite.updateMany({ where: { usedAt: null }, data: { usedAt: new Date() } }),
  ]);
}
