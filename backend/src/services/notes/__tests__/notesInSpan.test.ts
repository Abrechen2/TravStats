import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { notesInSpan } from "../tripNotes";

/**
 * The query reads a day's margin on both sides of the span (every zone's day
 * fits inside it) and the local day decides. The bound used to be applied to
 * that wider read: notes from the margin filled the page, were then dropped,
 * and a span with notes came back empty and "truncated".
 */
describe("notesInSpan", () => {
  let anna: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-notes");
    const note = (iso: string, body: string) => ({
      userId: anna.id,
      body,
      occurredAt: new Date(iso),
      occurredZone: "UTC",
    });
    await prisma.note.createMany({
      data: [
        note("2025-05-01T08:00:00Z", "day before 1"),
        note("2025-05-01T09:00:00Z", "day before 2"),
        note("2025-05-01T10:00:00Z", "day before 3"),
        note("2025-05-02T08:00:00Z", "in span 1"),
        note("2025-05-02T09:00:00Z", "in span 2"),
      ],
    });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const span = { start: "2025-05-02", end: "2025-05-02" };

  it("fills the page with notes of the span, not of the margin", async () => {
    const { notes, truncated } = await notesInSpan(anna.id, span, { limit: 2 });
    expect(notes.map((n) => n.body)).toEqual(["in span 1", "in span 2"]);
    expect(truncated).toBe(false);
  });

  it("says truncated only when notes of the span were left out", async () => {
    const { notes, truncated } = await notesInSpan(anna.id, span, { limit: 1 });
    expect(notes.map((n) => n.body)).toEqual(["in span 1"]);
    expect(truncated).toBe(true);
  });
});
