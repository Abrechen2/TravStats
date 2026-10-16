/**
 * Leaderboard groups (spec §5): a private, named filter over people whose consent the owner
 * already holds. Nothing is relayed and nobody is asked — unlike the E2E circles, a board
 * grants no one anything. Only accepted consents make a person visible: a withdrawn one keeps
 * its member row (FK) but the person is hidden from every reader here, and comes back if the
 * same consent is accepted again; a pending offer or question never admits anyone.
 */
import { prisma } from "../../db";
import type { BoardView } from "../../schemas/comparison";
import { localKey, remoteKey } from "./consents";
import { comparisonError } from "./errors";

const boardNotFound = (userId: string, boardId: string) =>
  comparisonError("COMPARISON_BOARD_NOT_FOUND", 404, "No such group", { userId, boardId });

export async function listBoards(userId: string): Promise<BoardView[]> {
  const boards = await prisma.leaderboardBoard.findMany({
    where: { userId },
    include: {
      members: {
        where: {
          OR: [
            { remoteId: { not: null } },
            { consent: { status: "accepted", owner: { isActive: true } } },
          ],
        },
        include: { consent: { select: { ownerId: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    members: b.members.map((m) =>
      m.consent ? localKey(m.consent.ownerId) : remoteKey(m.remoteId as string)
    ),
  }));
}
async function resolveMembers(userId: string, keys: readonly string[]) {
  const unique = [...new Set(keys)];
  const invalid = () =>
    comparisonError(
      "COMPARISON_BOARD_MEMBER_INVALID",
      400,
      "A group holds only people whose numbers you can see",
      {
        userId,
      }
    );
  if (unique.some((k) => !k.startsWith("local:") && !k.startsWith("remote:"))) throw invalid();
  const localIds = unique
    .filter((k) => k.startsWith("local:"))
    .map((k) => k.slice("local:".length));
  const remoteIds = unique
    .filter((k) => k.startsWith("remote:"))
    .map((k) => k.slice("remote:".length));
  const [consents, remotes] = await Promise.all([
    prisma.leaderboardConsent.findMany({
      where: {
        viewerId: userId,
        ownerId: { in: localIds },
        status: "accepted",
        owner: { isActive: true },
      },
      select: { id: true },
    }),
    prisma.leaderboardRemote.findMany({
      where: { userId, id: { in: remoteIds } },
      select: { id: true },
    }),
  ]);
  if (consents.length !== localIds.length || remotes.length !== remoteIds.length) throw invalid();
  return [
    ...consents.map((c) => ({ consentId: c.id })),
    ...remotes.map((r) => ({ remoteId: r.id })),
  ];
}

export async function saveBoard(
  userId: string,
  input: { name: string; members: string[] },
  boardId?: string
): Promise<BoardView> {
  if (boardId && !(await prisma.leaderboardBoard.findFirst({ where: { id: boardId, userId } })))
    throw boardNotFound(userId, boardId);
  const members = await resolveMembers(userId, input.members);
  let id = boardId;
  if (id) {
    await prisma.$transaction([
      prisma.leaderboardBoardMember.deleteMany({ where: { boardId: id } }),
      prisma.leaderboardBoard.update({
        where: { id },
        data: { name: input.name, members: { create: members } },
      }),
    ]);
  } else {
    id = (
      await prisma.leaderboardBoard.create({
        data: { userId, name: input.name, members: { create: members } },
      })
    ).id;
  }
  const saved = (await listBoards(userId)).find((b) => b.id === id);
  if (!saved) throw boardNotFound(userId, id);
  return saved;
}

export async function deleteBoard(userId: string, boardId: string): Promise<{ deleted: true }> {
  const removed = await prisma.leaderboardBoard.deleteMany({ where: { id: boardId, userId } });
  if (removed.count === 0) throw boardNotFound(userId, boardId);
  return { deleted: true };
}

export async function boardMemberKeys(userId: string, boardId: string): Promise<Set<string>> {
  const board = (await listBoards(userId)).find((b) => b.id === boardId);
  if (!board) throw boardNotFound(userId, boardId);
  return new Set(board.members);
}
