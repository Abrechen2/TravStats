import http from "http";
import type { AddressInfo } from "net";

jest.mock("../../../parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: "test-model" })),
  getParserOrder: jest.fn(async () => "template_first"),
}));
jest.mock("../../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => true),
  recordLlmProbe: jest.fn(),
}));
jest.mock("../../../../utils/sharedDemo", () => ({
  isSharedDemoUser: jest.fn(async () => false),
}));

import { getAdminParserSettings, getParserOrder } from "../../../parserSettings";
import { isSharedDemoUser } from "../../../../utils/sharedDemo";
import { parseRailBookingText } from "../railBookingParser";
import { buildRailPrompt, promptFieldsFor } from "../railLlmParser";
import {
  DB_CONFIRMATION_SINGLE,
  DB_ORDER_WITHOUT_ITINERARY,
  FLIGHT_MAIL_MUC_FRA,
  FOREIGN_TICKET_THIN,
} from "./railFixtures";

const mockAdmin = getAdminParserSettings as jest.Mock;
const mockOrder = getParserOrder as jest.Mock;
const mockDemo = isSharedDemoUser as jest.Mock;

interface FakeOllama {
  url: string;
  prompts: string[];
  close: () => Promise<void>;
}

/** A stand-in for Ollama: `/api/tags` answers, `/api/generate` answers `reply`. */
function fakeOllama(reply: (system: string) => string | null): Promise<FakeOllama> {
  const prompts: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/api/tags") {
        res.end(JSON.stringify({ models: [{ name: "test-model" }] }));
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const system = (JSON.parse(body) as { system: string }).system;
        prompts.push(system);
        const answer = reply(system);
        if (answer === null) {
          res.statusCode = 500;
          res.end("boom");
          return;
        }
        res.end(JSON.stringify({ response: answer }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        prompts,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** A port nothing listens on: the model is configured and unreachable. */
const DEAD_URL = "http://127.0.0.1:9";

describe("parseRailBookingText", () => {
  beforeEach(() => {
    mockOrder.mockResolvedValue("template_first");
    mockDemo.mockResolvedValue(false);
    mockAdmin.mockResolvedValue({ ollamaUrl: DEAD_URL, ollamaModel: "test-model" });
  });

  it("answers from the template without asking the model", async () => {
    const result = await parseRailBookingText(DB_CONFIRMATION_SINGLE);
    expect(result.parserUsed).toBe("template");
    expect(result.booking?.legs).toHaveLength(1);
    expect(result.fallbackCode).toBeUndefined();
  });

  it("says the model is unreachable — as a code — when no template knows the layout", async () => {
    const result = await parseRailBookingText(FOREIGN_TICKET_THIN);
    expect(result).toMatchObject({
      booking: null,
      parserUsed: "none",
      ollamaAvailable: false,
      fallbackCode: "llmUnreachable",
    });
  });

  it("names the order of a legless DB mail instead of blaming the model", async () => {
    const result = await parseRailBookingText(DB_ORDER_WITHOUT_ITINERARY);
    expect(result).toMatchObject({
      booking: null,
      fallbackCode: "noItinerary",
      orderReference: "Q7X2KT",
    });
  });

  it("never lets the shared demo account reach the model", async () => {
    mockDemo.mockResolvedValue(true);
    const ollama = await fakeOllama(() => "{}");
    mockAdmin.mockResolvedValue({ ollamaUrl: ollama.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(FOREIGN_TICKET_THIN, [], "demo-user");
      expect(result.fallbackCode).toBe("demoNoLlm");
      expect(ollama.prompts).toHaveLength(0);
    } finally {
      await ollama.close();
    }
  });

  it("never reaches the model when an admin has switched it off", async () => {
    const ollama = await fakeOllama(() => "{}");
    mockAdmin.mockResolvedValue({
      ollamaUrl: ollama.url,
      ollamaModel: "test-model",
      llmEnabled: false,
    });
    try {
      const result = await parseRailBookingText(FOREIGN_TICKET_THIN, [], "some-user");
      expect(result.fallbackCode).toBe("llmDisabled");
      expect(result.ollamaAvailable).toBe(false);
      expect(ollama.prompts).toHaveLength(0);
    } finally {
      await ollama.close();
    }
  });

  it("keeps a thin ticket's leg but drops the train the model invented", async () => {
    const ollama = await fakeOllama(() =>
      JSON.stringify({
        legs: [
          {
            from: "Paris Gare de Lyon",
            to: "Lyon Part Dieu",
            departure: "2026-04-12T08:04",
            arrival: "2026-04-12T10:00",
            category: "TGV",
            number: "6601",
            coach: "12",
            seat: "64",
          },
        ],
        class: null,
        reference: "ABC123",
        total: "89,00",
        currency: "EUR",
      })
    );
    mockAdmin.mockResolvedValue({ ollamaUrl: ollama.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(FOREIGN_TICKET_THIN);
      expect(result.parserUsed).toBe("ollama");
      const [leg] = result.booking!.legs;
      expect(leg).toMatchObject({
        depStationName: "Paris Gare de Lyon",
        arrStationName: "Lyon Part Dieu",
        trainCategory: null,
        trainNumber: null,
        coach: "12",
        seat: "64",
      });
      // Neither a reference nor a total stands in the text; neither survives.
      expect(result.booking).toMatchObject({ bookingReference: null, price: null });
      // The prompt did not ask for what the ticket cannot carry.
      expect(ollama.prompts[0]).not.toMatch(/"category"|"number"|"reference"|"total"/);
      expect(ollama.prompts[0]).toMatch(/"coach", "seat"/);
    } finally {
      await ollama.close();
    }
  });

  // forgejo#161: the legs came through, the four booking facts printed under
  // plain labels did not — the model never returns an operator, and here it
  // answers without class, reference and total. The labels decide, not the model.
  it("keeps the operator, reference, class and total a plain confirmation labels", async () => {
    const ticket = [
      "Synthetische QA-Buchungsbestätigung",
      "Deutsche Bahn, ICE 578",
      "Buchungsnummer: QARAIL20261002",
      "Reisender: Alice Tester",
      "Reisedatum: 15.10.2026",
      "Abfahrt: München Hbf, 08:00 Uhr",
      "Ankunft: Berlin Hbf, 12:30 Uhr",
      "2. Klasse, Wagen 7, Sitz 42",
      "Gesamtpreis: 59,90 EUR",
    ].join("\n");
    const ollama = await fakeOllama(() =>
      JSON.stringify({
        legs: [
          {
            from: "München Hbf",
            to: "Berlin Hbf",
            departure: "2026-10-15T08:00",
            arrival: "2026-10-15T12:30",
            category: "ICE",
            number: "578",
            coach: "7",
            seat: "42",
          },
        ],
        total: "59.9",
      })
    );
    mockAdmin.mockResolvedValue({ ollamaUrl: ollama.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(ticket);
      expect(result.parserUsed).toBe("ollama");
      expect(result.booking).toMatchObject({
        operator: "Deutsche Bahn",
        bookingReference: "QARAIL20261002",
        travelClass: "second",
        price: 59.9,
        currency: "EUR",
      });
      expect(result.booking!.legs[0]).toMatchObject({
        trainCategory: "ICE",
        trainNumber: "578",
        coach: "7",
        seat: "42",
      });
    } finally {
      await ollama.close();
    }
  });

  it("drops a train the model answers that is not the one the ticket prints", async () => {
    const ticket = "Billet\nIC 2217 Kiel Hbf -> Bremen Hbf\nDépart 14/03/2026 08:05";
    const ollama = await fakeOllama(() =>
      JSON.stringify({
        legs: [
          {
            from: "Kiel Hbf",
            to: "Bremen Hbf",
            departure: "2026-03-14T08:05",
            category: "IC",
            number: "2218",
          },
        ],
      })
    );
    mockAdmin.mockResolvedValue({ ollamaUrl: ollama.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(ticket);
      expect(result.booking?.legs[0]).toMatchObject({ trainCategory: null, trainNumber: null });
      expect(ollama.prompts[0]).toMatch(/"category", "number"/);
    } finally {
      await ollama.close();
    }
  });

  it("reports a model that found no provable ride, and one that answered garbage", async () => {
    const invented = await fakeOllama(() =>
      JSON.stringify({
        legs: [{ from: "Wien Hbf", to: "Graz Hbf", departure: "2026-01-01T08:00" }],
      })
    );
    mockAdmin.mockResolvedValue({ ollamaUrl: invented.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(FOREIGN_TICKET_THIN);
      expect(result).toMatchObject({ booking: null, fallbackCode: "llmFoundNothing" });
    } finally {
      await invented.close();
    }

    const broken = await fakeOllama(() => "this is not json");
    mockAdmin.mockResolvedValue({ ollamaUrl: broken.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(FOREIGN_TICKET_THIN);
      expect(result).toMatchObject({ booking: null, fallbackCode: "llmFailed" });
    } finally {
      await broken.close();
    }
  });

  // Acceptance D1: a Lufthansa mail in the rail dialog came back as two
  // "train rides" MUC→FRA and FRA→MUC. The model is never asked for a
  // document the classifier clearly places elsewhere.
  it("never asks the model about a document that is clearly a flight", async () => {
    const ollama = await fakeOllama(() =>
      JSON.stringify({
        legs: [{ from: "MUC", to: "FRA", departure: "2024-05-06T07:00" }],
      })
    );
    mockAdmin.mockResolvedValue({ ollamaUrl: ollama.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(FLIGHT_MAIL_MUC_FRA);
      expect(result).toMatchObject({ booking: null, fallbackCode: "otherDomain" });
      expect(ollama.prompts).toHaveLength(0);
    } finally {
      await ollama.close();
    }
  });

  it("refuses a model answer that runs between airport codes", async () => {
    // Inconclusive to the classifier, so the model is asked — and answers
    // with the airport codes the text prints, which are no stations.
    const ticket = "Ticket\nMUC -> FRA 06.05.2024 07:00";
    const ollama = await fakeOllama(() =>
      JSON.stringify({
        legs: [{ from: "MUC", to: "FRA", departure: "2024-05-06T07:00" }],
      })
    );
    mockAdmin.mockResolvedValue({ ollamaUrl: ollama.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(ticket);
      expect(ollama.prompts).toHaveLength(1);
      expect(result).toMatchObject({ booking: null, fallbackCode: "looksLikeFlight" });
    } finally {
      await ollama.close();
    }
  });

  it("falls back to the template when the model fails under llm_first", async () => {
    mockOrder.mockResolvedValue("llm_first");
    const broken = await fakeOllama(() => null);
    mockAdmin.mockResolvedValue({ ollamaUrl: broken.url, ollamaModel: "test-model" });
    try {
      const result = await parseRailBookingText(DB_CONFIRMATION_SINGLE);
      expect(result.parserUsed).toBe("template");
      expect(result.booking?.legs).toHaveLength(1);
    } finally {
      await broken.close();
    }
  });
});

describe("the rail prompt names only what the document can carry", () => {
  it("asks for trains, a reference and a total only when the text shows them", () => {
    const thin = buildRailPrompt(promptFieldsFor("Paris -> Lyon 12/04/2026 08:04"));
    expect(thin).not.toMatch(/"category"|"number"|"coach"|"reference"|"total"/);

    const rich = buildRailPrompt(
      promptFieldsFor("ICE 578 Wagen 12 Platz 45 Auftragsnummer 1234 Gesamtpreis 89,00 EUR")
    );
    expect(rich).toMatch(/"category", "number"/);
    expect(rich).toMatch(/"coach", "seat"/);
    expect(rich).toMatch(/"reference"/);
    expect(rich).toMatch(/"total", "currency"/);
  });
});
