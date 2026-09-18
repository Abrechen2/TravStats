import { prisma } from "../../db";
import {
  briefEntityNouns,
  briefFromTrip,
  briefHasVoice,
  buildSystemPrompt,
  compactBrief,
  routeLine,
  type SummaryBrief,
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

    it("names the sources of a summary in both languages", () => {
      expect(buildSystemPrompt("de")).toMatch(/"notes"/);
      expect(buildSystemPrompt("de")).toMatch(/"journal"/);
      expect(buildSystemPrompt("en")).toMatch(/"notes"/);
      expect(buildSystemPrompt("en")).toMatch(/"journal"/);
    });

    // Measured 2026-09-18 against gemma3:12b on the 2.7.0-beta.1 build: on a
    // trip with no notes and no journal, the model invented both and labelled
    // them as quotes (`*notes: Der Flug war überraschend ruhig …*`), plus a
    // hotel the trip does not have. Given a real journal entry the same build
    // wrote a clean summary — so the absence is the trigger, and the prompt
    // must stop naming fields the brief cannot carry.
    it("does not name notes or journal when the trip has neither", () => {
      for (const language of ["de", "en"] as const) {
        const prompt = buildSystemPrompt(language, false);
        expect(prompt).not.toMatch(/"notes"/);
        expect(prompt).not.toMatch(/"journal"/);
        // The rest of the instruction survives — this is a removal of two
        // phrases, not a different prompt.
        expect(prompt).toMatch(/"perspective"/);
        expect(prompt).toMatch(/"completed"/);
      }
    });

    // The same defect one level down: with rule 3 listing "Hotels, Orte,
    // Stopps", a trip holding one flight and nothing else was given three
    // invented hotels ("The Knickerbocker", "The Dominick", "Four Seasons").
    // A category named in the prompt but absent from the brief is an
    // invitation, exactly as the two field names were.
    it("names only the kinds of entry the trip actually holds", () => {
      const flightOnly = buildSystemPrompt("de", false, ["Flüge"]);
      expect(flightOnly).toMatch(/— Flüge\./);
      expect(flightOnly).not.toMatch(/Hotels/);
      expect(flightOnly).not.toMatch(/Stopps/);

      const withStays = buildSystemPrompt("en", false, ["flights", "hotels"]);
      expect(withStays).toMatch(/— flights, hotels\./);
      expect(withStays).not.toMatch(/places/);
    });

    it("writes no dangling dash when the trip holds nothing to walk", () => {
      for (const language of ["de", "en"] as const) {
        const prompt = buildSystemPrompt(language, false, []);
        expect(prompt).not.toMatch(/—\s*\./);
        expect(prompt).toMatch(/(mit ihren Namen\.|with their names\.)/);
      }
    });

    // Second round, same lesson one word further. With "Du erzählst
    // ausschließlich, was in den Daten steht" the build answered "Die
    // restlichen Tage unserer Reise sind leider nicht in den Daten
    // festgehalten" — an absence as news, about the data rather than the trip.
    // The opening line ("you are given the data of one trip") stays; it is
    // framing, and nothing reached for it there.
    //
    // The "only" must NOT go with the noun. Dropping the whole clause was
    // measured and was far worse than the sentence it removed: on the same
    // one-flight trip the model wrote ten days of invented itinerary — a hotel
    // in Greenwich Village, the Statue of Liberty, the Met, Brooklyn Bridge.
    it("keeps the 'only' that anchors the text, without naming the data", () => {
      for (const [language, only, noun] of [
        ["de", /ausschließlich/, /in den Daten steht/],
        ["en", /only the stops you are given/, /what the data holds/],
      ] as const) {
        const prompt = buildSystemPrompt(language, false);
        expect(prompt).toMatch(only);
        expect(prompt).not.toMatch(noun);
      }
    });

    // The user prompt asked for three paragraphs while rules 1 and 9 asked for
    // two. The model settled it differently from run to run.
    it("asks for one shape only — the rules carry the paragraph count, the user prompt does not", () => {
      for (const language of ["de", "en"] as const) {
        expect(buildUserPrompt(language, "{}")).not.toMatch(/3-|3 /);
        expect(buildSystemPrompt(language)).toMatch(/(Zwei Absätze|Two paragraphs)/);
      }
    });

    // Measured 2026-09-17 on gemma3:12b: "You took a business trip" in English
    // and "ich" beside "wir" in one German text, from a rule that left the
    // choice to the model. The brief decides now, and the prompt says so.
    it("takes the person from the brief rather than leaving it to the model", () => {
      for (const language of ["de", "en"] as const) {
        expect(buildSystemPrompt(language)).toMatch(/"perspective"/);
      }
    });

    // The first probe (2026-09-05, gemma3:12b) wrote a finished trip as
    // anticipation, so the tense is tied to the status in both languages.
    it("ties the tense to the trip status", () => {
      for (const language of ["de", "en"] as const) {
        expect(buildSystemPrompt(language)).toMatch(/"completed"/);
        expect(buildSystemPrompt(language)).toMatch(/"planned"/);
        expect(buildSystemPrompt(language)).toMatch(/"in_progress"/);
      }
    });
  });

  // Measured 2026-09-17: with `companions: []` in the brief, the model wrote
  // "I embarked on this journey alone, with no companions joining me" — an
  // absence told as a fact. No wording stopped it; dropping the key did.
  describe("compactBrief", () => {
    it("drops what is empty and keeps what is there", () => {
      const compacted = compactBrief({
        name: "Trip",
        perspective: "I",
        nights: 2,
        status: "completed",
        category: null,
        startDate: "2024-05-01",
        endDate: "2024-05-03",
        origin: null,
        destination: "Porto",
        countries: [],
        companions: [],
        tags: [],
        flights: [],
        cruises: [],
        stays: [
          {
            lodging: "Casa",
            nights: 2,
            city: "Porto",
            country: null,
            checkIn: "2024-05-01",
            checkOut: "2024-05-03",
            room: null,
            notes: null,
          },
        ],
        places: [],
        stops: [],
        journal: [],
        notes: null,
      });
      expect(Object.keys(compacted).sort()).toEqual(
        [
          "destination",
          "endDate",
          "name",
          "nights",
          "perspective",
          "stays",
          "startDate",
          "status",
        ].sort()
      );
      expect(compacted.stays).toEqual([
        {
          lodging: "Casa",
          nights: 2,
          city: "Porto",
          checkIn: "2024-05-01",
          checkOut: "2024-05-03",
        },
      ]);
    });
  });

  // Which prompt a trip gets hangs on this one question, so it is asked in
  // every place the traveller can actually write something — not just the two
  // that gave the defect its name.
  describe("briefHasVoice", () => {
    const silent = (): SummaryBrief => ({
      name: "Trip",
      perspective: "I",
      nights: 2,
      status: "completed",
      category: null,
      startDate: "2024-05-01",
      endDate: "2024-05-03",
      origin: null,
      destination: "Porto",
      countries: [],
      companions: [],
      tags: [],
      flights: [],
      cruises: [],
      stays: [],
      places: [],
      stops: [],
      journal: [],
      notes: null,
    });

    it("is false for a trip nobody wrote anything on", () => {
      expect(briefHasVoice(silent())).toBe(false);
    });

    it("is true for trip notes, a journal entry, a stay note or a place note", () => {
      expect(briefHasVoice({ ...silent(), notes: "Schön war es." })).toBe(true);
      expect(
        briefHasVoice({
          ...silent(),
          journal: [{ date: "2024-05-01", title: null, body: "Angekommen." }],
        })
      ).toBe(true);
      expect(
        briefHasVoice({
          ...silent(),
          stays: [
            {
              lodging: "Casa",
              nights: 2,
              city: "Porto",
              country: null,
              checkIn: null,
              checkOut: null,
              room: null,
              notes: "Laut, aber zentral.",
            },
          ],
        })
      ).toBe(true);
      expect(
        briefHasVoice({
          ...silent(),
          places: [
            {
              name: "Livraria Lello",
              category: "landmark",
              city: null,
              country: null,
              date: null,
              notes: "Voll.",
            },
          ],
        })
      ).toBe(true);
    });

    it("lists exactly the kinds the brief carries, in walking order", () => {
      expect(briefEntityNouns(silent(), "de")).toEqual([]);
      expect(
        briefEntityNouns({ ...silent(), flights: [{ from: "FRA", to: "JFK", date: null }] }, "de")
      ).toEqual(["Flüge"]);
      expect(
        briefEntityNouns(
          {
            ...silent(),
            flights: [{ from: "FRA", to: "JFK", date: null }],
            places: [
              {
                name: "Met",
                category: "museum",
                city: null,
                country: null,
                date: null,
                notes: null,
              },
            ],
          },
          "en"
        )
      ).toEqual(["flights", "places"]);
    });

    it("stays false when the only entries carry no words of their own", () => {
      expect(
        briefHasVoice({
          ...silent(),
          stays: [
            {
              lodging: "Casa",
              nights: 2,
              city: "Porto",
              country: null,
              checkIn: null,
              checkOut: null,
              room: null,
              notes: null,
            },
          ],
          flights: [{ from: "FRA", to: "OPO", date: "2024-05-01" }],
        })
      ).toBe(false);
    });
  });

  // The model counted "five days and six nights" for five, and listed a bakery
  // and a hotel as stops on the route. Both are written here now.
  describe("routeLine", () => {
    const brief = (over: Partial<SummaryBrief>): SummaryBrief =>
      ({
        name: "T",
        perspective: "we",
        nights: 5,
        status: "completed",
        category: null,
        startDate: null,
        endDate: null,
        origin: null,
        destination: "Lissabon",
        countries: [],
        companions: [],
        tags: [],
        flights: [],
        cruises: [],
        places: [],
        stops: [],
        journal: [],
        notes: null,
        stays: [],
        ...over,
      }) as SummaryBrief;

    it("names the cities in the order they were visited, once each, with the nights", () => {
      const line = routeLine(
        brief({
          stays: [
            {
              lodging: "A",
              nights: 3,
              city: "Lissabon",
              country: null,
              checkIn: null,
              checkOut: null,
              room: null,
              notes: null,
            },
            {
              lodging: "B",
              nights: 2,
              city: "Lissabon",
              country: null,
              checkIn: null,
              checkOut: null,
              room: null,
              notes: null,
            },
          ],
          places: [
            {
              name: "Pena",
              category: "sight",
              city: "Sintra",
              country: null,
              date: null,
              notes: null,
            },
          ],
        }),
        "de"
      );
      expect(line).toBe("Route: Lissabon – Sintra. 5 Nächte.");
    });

    it("says nothing when there is no city or no night count to report", () => {
      expect(routeLine(brief({ destination: null }), "en")).toBe("");
      expect(routeLine(brief({ nights: null }), "en")).toBe("");
    });

    it("counts one night as a night", () => {
      expect(routeLine(brief({ nights: 1 }), "en")).toBe("Route: Lissabon. 1 night.");
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
