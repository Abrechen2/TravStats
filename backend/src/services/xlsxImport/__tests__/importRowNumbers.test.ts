import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets } from "../importSheets";
import type { IncomingSheet, SheetOutcome } from "../types";

/**
 * The row an outcome names must be the row Excel shows (browser acceptance,
 * 2026-09-25). The export writes a hint line above the header and the reader
 * skips blank lines, so `index + 2` said "Zeile 2" for what was row 3 — and
 * drifted further after every blank line. The client now sends the sheet row
 * of each record; `index + 2` is only the guess for callers that send none.
 */

const USER = "xlsx-row-numbers";
let userId: string;

const run = (sheets: IncomingSheet[]) =>
  importSheets(sheets, { userId, dryRun: true, mode: "merge" });

const sheetOf = (result: SheetOutcome[], key: string): SheetOutcome => {
  const sheet = result.find((s) => s.key === key);
  if (!sheet) throw new Error(`no ${key} outcome`);
  return sheet;
};

const place = (name: string) => ({ name, category: "museum", lat: "48.1", lon: "11.5" });

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  const u = await prisma.user.create({
    data: { username: USER, passwordHash: await hashPassword("password123") },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  await prisma.$disconnect();
});

it("reports the sheet row the client recorded for each record", async () => {
  const result = await run([{ key: "places", rows: [place("A"), place("B")], rowNumbers: [3, 5] }]);
  expect(sheetOf(result, "places").rows.map((r) => r.row)).toEqual([3, 5]);
});

it("falls back to index + 2 for a caller that sends no row numbers", async () => {
  const result = await run([{ key: "places", rows: [place("A"), place("B")] }]);
  expect(sheetOf(result, "places").rows.map((r) => r.row)).toEqual([2, 3]);
});

it("falls back per row where a recorded number is missing or not a positive integer", async () => {
  const result = await run([
    { key: "places", rows: [place("A"), place("B"), place("C")], rowNumbers: [0, 7.5] },
  ]);
  expect(sheetOf(result, "places").rows.map((r) => r.row)).toEqual([2, 3, 4]);
});
