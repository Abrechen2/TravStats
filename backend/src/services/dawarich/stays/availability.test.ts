import { nextStayScanAt } from "./availability";
jest.mock("../../../db", () => ({ prisma: {} }));
it.each([
  ["2026-10-15T00:14:59Z", "2026-10-15T00:15:00.000Z"],
  ["2026-10-15T00:15:00Z", "2026-10-15T06:15:00.000Z"],
  ["2026-10-15T12:16:00Z", "2026-10-15T18:15:00.000Z"],
  ["2026-10-15T23:59:59Z", "2026-10-16T00:15:00.000Z"],
])("next UTC slot after %s is %s", (now, expected) => {
  expect(nextStayScanAt(new Date(now)).toISOString()).toBe(expected);
});
