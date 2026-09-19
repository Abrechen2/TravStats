import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { CruiseBookingParser, parseCruiseBookingText } from "../cruiseBookingParser";
import { parseLodgingBookingText } from "../lodging/lodgingBookingParser";
import { requestTextWithDeadline } from "../lodging/boundedHttp";
import { parseBookingEmail } from "../bookingParser";
import { getOllamaTextParser } from "../parsers/text/ollamaTextParser";
import { clearAvailabilityCache } from "../parsers/config";

/**
 * Finding 3 of the cold security audit of 2026-09-19: the operator's Ollama was
 * open to the shared demo account through every parse route, because the
 * parsers resolve the ADMIN's endpoint for whoever asks. On a public preview
 * the demo password is printed on the login page, so that is the operator's
 * hardware answering strangers — minutes of compute per document — while the
 * summarize route beside it is guarded against precisely this.
 *
 * The ruling was NOT to put `rejectDemo` on the parse routes. The template
 * readers are what a visitor came to try and they cost nothing, so what closes
 * is the fallthrough behind them, in all three places it lives:
 *
 *   flight  — `services/parsers/config.ts`, `getParserConfig`
 *   cruise  — `services/cruiseBookingParser.ts`, `parseCruiseBookingText`
 *   lodging — `services/lodging/lodgingBookingParser.ts`, `parseLodgingBookingText`
 *
 * Each answers as an instance with no model configured already answers, so no
 * new error exists and the routes take their own "not recognised" path.
 *
 * Each case below mocks that parser's OWN transport and asserts zero calls —
 * a test that merely read the result would pass while the model was being
 * asked and its answer discarded.
 */

jest.mock("../lodging/boundedHttp", () => ({
  requestTextWithDeadline: jest.fn(async () => {
    throw new Error("the lodging parser must not reach Ollama in this suite");
  }),
}));

jest.mock("../parsers/text/ollamaTextParser", () => {
  const actual = jest.requireActual("../parsers/text/ollamaTextParser");
  return {
    ...actual,
    getOllamaTextParser: jest.fn(() => ({
      provider: "ollama",
      checkAvailability: async () => ({ available: false, reason: "mocked out" }),
      parseEmail: async () => [],
      parseText: async () => [],
    })),
  };
});

/** A document no template in any domain recognises, so every parser reaches
 *  the step this suite is about. */
const UNKNOWN_DOCUMENT =
  "Guten Tag, anbei die Bestaetigung Ihrer Buchung bei einem Anbieter, den kein Muster kennt. Vielen Dank.";

describe("the shared demo account never reaches the operator's Ollama", () => {
  let demoId: string;
  let userId: string;
  let adminSettingsId: number | null = null;
  let previousOllamaUrl: string | null = null;
  let previousOllamaModel: string | null = null;
  /** Whether THIS suite created the row. If it did, nulling its columns in
   *  `afterAll` would leave an `adminSettings` row behind that the database did
   *  not have before — enough on its own to change what
   *  `getAdminParserSettings` returns for every suite that runs after, since it
   *  answers `null` only when no row exists at all. */
  let createdAdminSettings = false;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "llmUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "llmUser", passwordHash: await hashPassword("password123") },
    });
    demoId = demo.id;
    userId = user.id;

    // An Ollama IS configured — otherwise every assertion below would pass for
    // the wrong reason.
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (admin) {
      adminSettingsId = admin.id;
      previousOllamaUrl = admin.ollamaUrl;
      previousOllamaModel = admin.ollamaModel;
      await prisma.adminSettings.update({
        where: { id: admin.id },
        // Port 9 is the discard port: nothing listens, so even a leak cannot
        // reach a real model — the assertion is the call count, not the answer.
        data: { ollamaUrl: "http://127.0.0.1:9", ollamaModel: "audit-model" },
      });
    } else {
      const created = await prisma.adminSettings.create({
        data: { ollamaUrl: "http://127.0.0.1:9", ollamaModel: "audit-model" },
      });
      adminSettingsId = created.id;
      createdAdminSettings = true;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [demoId, userId] } } });
    if (adminSettingsId !== null) {
      if (createdAdminSettings) {
        await prisma.adminSettings.delete({ where: { id: adminSettingsId } });
      } else {
        await prisma.adminSettings.update({
          where: { id: adminSettingsId },
          data: { ollamaUrl: previousOllamaUrl, ollamaModel: previousOllamaModel },
        });
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearAvailabilityCache();
  });

  describe("cruise", () => {
    it("does not ask the model for the shared demo account, and says so without naming the endpoint", async () => {
      const reached = jest.spyOn(CruiseBookingParser.prototype, "checkAvailability");
      try {
        const result = await parseCruiseBookingText(UNKNOWN_DOCUMENT, undefined, demoId);

        expect(reached).not.toHaveBeenCalled();
        expect(result.parserUsed).toBe("none");
        expect(result.cruises).toEqual([]);
        expect(result.ollamaAvailable).toBe(false);
        expect(result.fallbackReason).toMatch(/demo account/);
        // The unreachable-Ollama reason quotes the admin's URL; this one must not.
        expect(result.fallbackReason).not.toMatch(/127\.0\.0\.1/);
      } finally {
        reached.mockRestore();
      }
    });

    it("still asks the model for a normal account", async () => {
      const reached = jest
        .spyOn(CruiseBookingParser.prototype, "checkAvailability")
        .mockResolvedValue(false);
      try {
        await parseCruiseBookingText(UNKNOWN_DOCUMENT, undefined, userId);
        expect(reached).toHaveBeenCalled();
      } finally {
        reached.mockRestore();
      }
    });
  });

  describe("lodging", () => {
    it("does not ask the model for the shared demo account", async () => {
      const result = await parseLodgingBookingText(UNKNOWN_DOCUMENT, undefined, demoId);

      expect(requestTextWithDeadline).not.toHaveBeenCalled();
      expect(result.parserUsed).toBe("none");
      expect(result.bookings).toEqual([]);
      expect(result.ollamaAvailable).toBe(false);
      expect(result.fallbackReason).toMatch(/demo account/);
    });

    it("still asks the model for a normal account", async () => {
      await parseLodgingBookingText(UNKNOWN_DOCUMENT, undefined, userId);
      expect(requestTextWithDeadline).toHaveBeenCalled();
    });
  });

  describe("flight", () => {
    it("does not build an Ollama parser for the shared demo account", async () => {
      await parseBookingEmail("Eine Buchung", UNKNOWN_DOCUMENT, undefined, { userId: demoId });
      expect(getOllamaTextParser).not.toHaveBeenCalled();
    });

    it("still builds one for a normal account", async () => {
      await parseBookingEmail("Eine Buchung", UNKNOWN_DOCUMENT, undefined, { userId });
      expect(getOllamaTextParser).toHaveBeenCalled();
    });
  });
});
