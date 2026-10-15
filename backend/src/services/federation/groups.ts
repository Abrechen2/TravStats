import { prisma } from "../../db";
import { refused } from "./security";

/** Personal board collections. Data is never copied into the group row or relayed to others. */
export async function saveBoard(
  userId: string,
  input: { id?: string; name: string; channels: string[] }
) {
  const unique = [...new Set(input.channels)];
  const links = await prisma.comparisonLink.findMany({
    where: {
      userId,
      channel: { in: unique },
      confirmed: true,
      remoteConfirmed: true,
      revoked: false,
    },
  });
  if (links.length !== unique.length || unique.length > 20) throw refused();
  if (input.id) {
    const prior = await prisma.comparisonGroup.findFirst({ where: { id: input.id, userId } });
    if (!prior) throw refused();
    return prisma.comparisonGroup.update({
      where: { id: prior.id },
      data: { name: input.name, channels: unique, version: { increment: 1 } },
    });
  }
  return prisma.comparisonGroup.create({ data: { userId, name: input.name, channels: unique } });
}
