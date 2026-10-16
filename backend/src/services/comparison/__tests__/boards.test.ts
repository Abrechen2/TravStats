import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { boardMemberKeys, deleteBoard, listBoards, saveBoard } from "../boards";
import { endLocal } from "../consents";

const users: string[] = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-b-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
const scope = { groups: ["trips"], domains: ["flight"], year: null };
const share = (owner: string, viewer: string, status: string) =>
  prisma.leaderboardConsent.create({ data: { ownerId: owner, viewerId: viewer, status, scope } });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("groups people whose numbers the owner can see", async () => {
  const [a, b] = [await user(), await user()];
  await share(b, a, "accepted");
  const board = await saveBoard(a, { name: "Familie", members: [`local:${b}`] });
  expect(board).toMatchObject({ name: "Familie", members: [`local:${b}`] });
  expect(await boardMemberKeys(a, board.id)).toEqual(new Set([`local:${b}`]));
  const renamed = await saveBoard(a, { name: "Family", members: [] }, board.id);
  expect(renamed).toMatchObject({ id: board.id, name: "Family", members: [] });
  expect(await listBoards(a)).toHaveLength(1);
});

it("refuses a member whose numbers the owner cannot see", async () => {
  const [a, c] = [await user(), await user()];
  await expect(saveBoard(a, { name: "X", members: [`local:${c}`] })).rejects.toMatchObject({
    code: "COMPARISON_BOARD_MEMBER_INVALID",
  });
});

it("refuses a person who only has a pending offer or question", async () => {
  const [a, offerer, asked] = [await user(), await user(), await user()];
  await share(offerer, a, "pending"); // they offered; nothing accepted yet
  await share(a, asked, "accepted"); // a shares with them; a still sees nothing of theirs
  for (const other of [offerer, asked])
    await expect(saveBoard(a, { name: "X", members: [`local:${other}`] })).rejects.toMatchObject({
      code: "COMPARISON_BOARD_MEMBER_INVALID",
    });
  expect(await listBoards(a)).toHaveLength(0);
});

it("refuses a malformed or own key", async () => {
  const a = await user();
  for (const key of ["nonsense", "", `local:${a}`])
    await expect(saveBoard(a, { name: "X", members: [key] })).rejects.toMatchObject({
      code: "COMPARISON_BOARD_MEMBER_INVALID",
    });
});

it("hides a member once the consent ends, and shows them again on a new yes", async () => {
  const [a, b] = [await user(), await user()];
  const consent = await share(b, a, "accepted");
  const board = await saveBoard(a, { name: "G", members: [`local:${b}`] });
  await endLocal(a, b);
  expect((await listBoards(a))[0].members).toEqual([]);
  expect(await boardMemberKeys(a, board.id)).toEqual(new Set());
  await prisma.leaderboardConsent.update({
    where: { id: consent.id },
    data: { status: "accepted" },
  });
  expect(await boardMemberKeys(a, board.id)).toEqual(new Set([`local:${b}`]));
});

it("does not find another user's board", async () => {
  const [a, b] = [await user(), await user()];
  const board = await saveBoard(a, { name: "Mine", members: [] });
  await expect(deleteBoard(b, board.id)).rejects.toMatchObject({
    code: "COMPARISON_BOARD_NOT_FOUND",
  });
  await expect(boardMemberKeys(b, board.id)).rejects.toMatchObject({
    code: "COMPARISON_BOARD_NOT_FOUND",
  });
  await expect(saveBoard(b, { name: "Theirs", members: [] }, board.id)).rejects.toMatchObject({
    code: "COMPARISON_BOARD_NOT_FOUND",
  });
  expect(await deleteBoard(a, board.id)).toEqual({ deleted: true });
});

it("refuses the 51st group and persists nothing", async () => {
  const a = await user();
  await prisma.leaderboardBoard.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({ userId: a, name: `g${i}` })),
  });
  await expect(saveBoard(a, { name: "one too many", members: [] })).rejects.toMatchObject({
    code: "COMPARISON_BOARD_LIMIT",
  });
  expect(await prisma.leaderboardBoard.count({ where: { userId: a } })).toBe(50);
});

it("reaches any group however many others exist, and still edits at the limit", async () => {
  const [a, b] = [await user(), await user()];
  await share(b, a, "accepted");
  const board = await saveBoard(a, { name: "Target", members: [`local:${b}`] });
  await prisma.leaderboardBoard.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({ userId: a, name: `later${i}` })),
  });
  expect(await boardMemberKeys(a, board.id)).toEqual(new Set([`local:${b}`]));
  const last = await prisma.leaderboardBoard.findFirstOrThrow({
    where: { userId: a, name: "later49" },
  });
  expect(await boardMemberKeys(a, last.id)).toEqual(new Set());
  expect(await saveBoard(a, { name: "Renamed", members: [] }, last.id)).toMatchObject({
    id: last.id,
    name: "Renamed",
  });
});

it("keeps the old members when a replacement names someone invalid", async () => {
  const [a, b, c] = [await user(), await user(), await user()];
  await share(b, a, "accepted");
  const board = await saveBoard(a, { name: "G", members: [`local:${b}`] });
  await expect(
    saveBoard(a, { name: "G2", members: [`local:${c}`] }, board.id)
  ).rejects.toMatchObject({ code: "COMPARISON_BOARD_MEMBER_INVALID" });
  expect(await boardMemberKeys(a, board.id)).toEqual(new Set([`local:${b}`]));
});
