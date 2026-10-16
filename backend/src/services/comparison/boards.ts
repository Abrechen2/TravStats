/**
 * Leaderboard groups (spec §5): a private, named filter over people whose consent the owner
 * already holds. Nothing is relayed and nobody is asked — unlike the E2E circles, a board
 * grants no one anything. Only accepted consents make a person visible: a withdrawn one keeps
 * its member row (FK) but the person is hidden from every reader here, and comes back if the
 * same consent is accepted again; a pending offer or question never admits anyone.
 */
import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import type { BoardView } from "../../schemas/comparison";
import { localKey, remoteKey } from "./consents";
import { comparisonError } from "./errors";

const boardNotFound = (userId: string, boardId: string) =>
  comparisonError("COMPARISON_BOARD_NOT_FOUND", 404, "No such group", { userId, boardId });

/** Per-user cap on groups; saveBoard enforces it so no group is ever persisted out of reach. */
export const MAX_BOARDS_PER_USER = 50;

type Db = Pick<typeof prisma, "leaderboardBoard" | "leaderboardConsent" | "leaderboardRemote">;

/** Members the owner can see right now: remotes, and locals whose consent is accepted. */
const visibleMembers = {
  where: {
    OR: [
      { remoteId: { not: null } },
      { consent: { status: "accepted", owner: { isActive: true } } },
    ],
  },
  include: { consent: { select: { ownerId: true } } },
} satisfies Prisma.LeaderboardBoard$membersArgs;

type BoardRow = Prisma.LeaderboardBoardGetPayload<{ include: { members: typeof visibleMembers } }>;

const toView = (b: BoardRow): BoardView => ({
  id: b.id,
  name: b.name,
  members: b.members.map((m) =>
    m.consent ? localKey(m.consent.ownerId) : remoteKey(m.remoteId as string)
  ),
});

async function findBoard(db: Db, userId: string, boardId: string): Promise<BoardView> {
  const board = await db.leaderboardBoard.findFirst({
    where: { id: boardId, userId },
    include: { members: visibleMembers },
  });
  if (!board) throw boardNotFound(userId, boardId);
  return toView(board);
}

export async function listBoards(userId: string): Promise<BoardView[]> {
  const boards = await prisma.leaderboardBoard.findMany({
    where: { userId },
    include: { members: visibleMembers },
    orderBy: { createdAt: "asc" },
    take: MAX_BOARDS_PER_USER,
  });
  return boards.map(toView);
}

async function resolveMembers(db: Db, userId: string, keys: readonly string[]) {
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
    db.leaderboardConsent.findMany({
      where: {
        viewerId: userId,
        ownerId: { in: localIds },
        status: "accepted",
        owner: { isActive: true },
      },
      select: { id: true },
    }),
    db.leaderboardRemote.findMany({
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
  return prisma.$transaction(async (tx) => {
    // Serialises this user's group writes so the limit check and the create cannot interleave.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`boards|${userId}`}::text, 0))) l`;
    if (boardId) await findBoard(tx, userId, boardId);
    else if ((await tx.leaderboardBoard.count({ where: { userId } })) >= MAX_BOARDS_PER_USER)
      throw comparisonError(
        "COMPARISON_BOARD_LIMIT",
        409,
        `At most ${MAX_BOARDS_PER_USER} groups are allowed`,
        { userId }
      );
    const members = await resolveMembers(tx, userId, input.members);
    let id = boardId;
    if (id) {
      await tx.leaderboardBoardMember.deleteMany({ where: { boardId: id } });
      await tx.leaderboardBoard.update({
        where: { id },
        data: { name: input.name, members: { create: members } },
      });
    } else {
      id = (
        await tx.leaderboardBoard.create({
          data: { userId, name: input.name, members: { create: members } },
        })
      ).id;
    }
    return findBoard(tx, userId, id);
  });
}

export async function deleteBoard(userId: string, boardId: string): Promise<{ deleted: true }> {
  const removed = await prisma.leaderboardBoard.deleteMany({ where: { id: boardId, userId } });
  if (removed.count === 0) throw boardNotFound(userId, boardId);
  return { deleted: true };
}

export async function boardMemberKeys(userId: string, boardId: string): Promise<Set<string>> {
  return new Set((await findBoard(prisma, userId, boardId)).members);
}
