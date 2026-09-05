import { prisma } from "../../db";
import {
  briefFromTrip,
  buildSystemPrompt,
  buildUserPrompt,
  cleanSummary,
  resolveOllamaTarget,
  summariseTrip,
  TRIP_BRIEF_INCLUDE,
  type GenerateFn,
} from "../tripSummaryService";
import * as parserSettings from "../parserSettings";

/**
 * The summary had no test until 2026-09-05, and every bug the beta gate
 * named lived in the parts a test could have seen without a model: which
 * Ollama it talks to, which language it writes, what the brief carries.
 * The model call is a seam (`generate`), so none of this needs one.
 */
describe("tripSummaryService", () => {
  describe("resolveOllamaTarget — the admin's Ollama first, then the environment", () => {
    const envUrl = process.env.OLLAMA_URL;
    const envModel = process.env.OLLAMA_MODEL;
    afterEach(() => {
      jest.restoreAllMocks();
      if (envUrl === undefined) delete process.env.OLLAMA_URL;
      else process.env.OLLAMA_URL = envUrl;
      if (envModel === undefined) delete process.env.OLLAMA_MODEL;
      else process.env.OLLAMA_MODEL = envModel;
    });

    it("takes the admin's parser settings when they name an Ollama", async () => {
      jest.spyOn(parserSettings, "getAdminParserSettings").mockResolvedValue({
        ollamaUrl: "http://mac-mini:11434",
        ollamaModel: "gemma3:27b",
      });
      process.env.OLLAMA_URL = "http://env:11434";
      process.env.OLLAMA_MODEL = "env-model";
      await expect(resolveOllamaTarget()).resolves.toEqual({
        url: "http://mac-mini:11434",
        model: "gemma3:27b",
      });
    });

    it("falls back to the environment, then to the defaults every Ollama caller here assumes", async () => {
      jest.spyOn(parserSettings, "getAdminParserSettings").mockResolvedValue(null);
      process.env.OLLAMA_URL = "http://env:11434";
      delete process.env.OLLAMA_MODEL;
      await expect(resolveOllamaTarget()).resolves.toEqual({
        url: "http://env:11434",
        model: "gemma3:12b",
      });
    });
  });

  describe("prompts", () => {
    it("writes in the reader's language — the German prompt is not the only one any more", () => {
      expect(buildSystemPrompt("de")).toMatch(/Deutsch/);
      expect(buildSystemPrompt("en")).toMatch(/English/);
      expect(buildSystemPrompt("en")).not.toMatch(/Absätze/);
      expect(buildUserPrompt("en", "{}")).toMatch(/^Trip data:/);
      expect(buildUserPrompt("de", "{}")).toMatch(/^Reisedaten:/);
    });

    it("names stays and places among the sources in both languages", () => {
      expect(buildSystemPrompt("de")).toMatch(/Aufenthalten, Orten/);
      expect(buildSystemPrompt("en")).toMatch(/stays, places/);
    });
  });

  describe("cleanSummary", () => {
    it("strips reasoning tags and surrounding quotes", () => {
      expect(cleanSummary('<think>hmm</think>\n"Ein schöner Text."')).toBe("Ein schöner Text.");
    });
  });

  describe("with a real trip", () => {
    let userId: string;
    let tripId: string;

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: { username: `summary-${Date.now()}-${Math.random()}`, passwordHash: "x" },
      });
      userId = user.id;
      const trip = await prisma.trip.create({
        data: { userId, name: "Köln im Mai", countries: ["DE"] },
      });
      tripId = trip.id;
      const lodging = await prisma.lodging.create({
        data: { userId, name: "Hotel Chelsea", city: "Köln", country: "Deutschland" },
      });
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          tripId,
          checkIn: new Date("2026-05-10T00:00:00Z"),
          checkOut: new Date("2026-05-12T00:00:00Z"),
          roomCategory: "Doppelzimmer",
          notes: "Ruhig, Frühstück gut. ".repeat(40),
        },
      });
      const place = await prisma.place.create({
        data: {
          userId,
          name: "Kölner Dom",
          category: "landmark",
          lat: 50.9413,
          lon: 6.9583,
          city: "Köln",
        },
      });
      await prisma.placeVisit.create({
        data: { userId, placeId: place.id, tripId, visitedAt: new Date("2026-05-11T00:00:00Z") },
      });
    });

    afterAll(async () => {
      await prisma.user.delete({ where: { id: userId } });
    });

    it("the brief carries the stay and the place visit, with the note clipped", async () => {
      const trip = await prisma.trip.findFirstOrThrow({
        where: { id: tripId },
        include: TRIP_BRIEF_INCLUDE,
      });
      const brief = briefFromTrip(trip);
      expect(brief.stays).toEqual([
        expect.objectContaining({
          lodging: "Hotel Chelsea",
          city: "Köln",
          checkIn: "2026-05-10",
          checkOut: "2026-05-12",
          room: "Doppelzimmer",
        }),
      ]);
      expect(brief.stays[0].notes).toHaveLength(300);
      expect(brief.places).toEqual([
        expect.objectContaining({ name: "Kölner Dom", category: "landmark", date: "2026-05-11" }),
      ]);
    });

    it("sends the brief in the requested language to the given Ollama and persists the cleaned answer", async () => {
      const calls: Array<{ url: string; model: string; system: string; prompt: string }> = [];
      const generate: GenerateFn = async (target, { system, prompt }) => {
        calls.push({ ...target, system, prompt });
        return '<think>…</think>"Two nights at Hotel Chelsea, one afternoon at the cathedral."';
      };

      const result = await summariseTrip(tripId, userId, {
        language: "en",
        target: { url: "http://fake:11434", model: "fake-model" },
        generate,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://fake:11434");
      expect(calls[0].model).toBe("fake-model");
      expect(calls[0].system).toMatch(/English/);
      expect(calls[0].prompt).toMatch(/Hotel Chelsea/);
      expect(calls[0].prompt).toMatch(/Kölner Dom/);

      expect(result.summary).toBe("Two nights at Hotel Chelsea, one afternoon at the cathedral.");
      expect(result.language).toBe("en");
      expect(result.model).toBe("fake-model");

      const stored = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(stored.summary).toBe(result.summary);
    });

    it("refuses a trip that belongs to someone else — not found, never a summary", async () => {
      const other = await prisma.user.create({
        data: { username: `summary-other-${Date.now()}-${Math.random()}`, passwordHash: "x" },
      });
      try {
        await expect(
          summariseTrip(tripId, other.id, {
            language: "de",
            target: { url: "http://fake:11434", model: "fake" },
            generate: async () => "never",
          })
        ).rejects.toThrow("Trip not found");
      } finally {
        await prisma.user.delete({ where: { id: other.id } });
      }
    });

    it("an empty answer is a failure, not an empty summary written over the old one", async () => {
      await prisma.trip.update({ where: { id: tripId }, data: { summary: "Bestand" } });
      await expect(
        summariseTrip(tripId, userId, {
          language: "de",
          target: { url: "http://fake:11434", model: "fake" },
          generate: async () => '""',
        })
      ).rejects.toThrow("empty summary");
      const stored = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(stored.summary).toBe("Bestand");
    });
  });
});
