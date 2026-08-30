import http from "http";
import type { AddressInfo } from "net";
import { parseLodgingBookingText } from "../services/lodging/lodgingBookingParser";
import { getAdminParserSettings } from "../services/parserSettings";

jest.mock("../services/parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: null })),
}));

const mockGetAdminParserSettings = getAdminParserSettings as jest.MockedFunction<
  typeof getAdminParserSettings
>;

/**
 * Forgejo #34. An archived hotels.com confirmation came back "no booking found"
 * while the model was reachable and the booking block sat at character ~1073 —
 * nowhere near the 12,000-character window.
 *
 * The report guessed the mixed German/English date form ("Mo, Apr 6, 2009").
 * Measured against the document with a real model, that guess was wrong:
 * rewriting the dates to ISO changed nothing. Removing the links changed
 * everything — the mail was 12,360 characters of which roughly two thirds were
 * tracking and booking URLs, and at 3,995 characters the same text with the same
 * German dates parsed correctly.
 *
 * So the fix is the flight parser's own treatment, `cleanEmailBody`, applied to
 * the body before the model sees it. What has to hold is that the model is
 * shown the booking and not the link farm — asserted here on the prompt itself
 * rather than on a parse result, because a result would only prove that some
 * stand-in answered.
 */
function createMockOllama(
  onGenerate: (prompt: string) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ models: [{ name: "mock" }] }));
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          onGenerate(JSON.parse(body).prompt ?? "");
        } catch {
          onGenerate(body);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: "[]" }));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** The shape of the failing document: a small booking block, buried in links. */
const LINK_FARM = Array.from(
  { length: 60 },
  (_, i) => `https://example.test/track?id=${i}&campaign=newsletter&token=abcdefghijklmnop${i}`
).join("\n");

const DOCUMENT = [
  "Ihre Buchungsbestätigung",
  LINK_FARM,
  "Musterhotel am Bahnhof",
  "Musterweg 1",
  "Musterstadt 12345",
  "Anreise : Mo, Apr 6, 2009",
  "Abreise : Mi, Apr 15, 2009",
  LINK_FARM,
].join("\n");

describe("the lodging parser shows the model the booking, not the link farm", () => {
  beforeEach(() => {
    mockGetAdminParserSettings.mockClear();
    mockGetAdminParserSettings.mockResolvedValue({ ollamaUrl: null, ollamaModel: null });
  });

  it("strips the URLs before the document reaches the model", async () => {
    let prompt = "";
    const server = await createMockOllama((p) => (prompt = p));
    try {
      await parseLodgingBookingText(DOCUMENT, { url: server.url, model: "mock" });
    } finally {
      await server.close();
    }

    expect(prompt).not.toContain("https://example.test");
    expect(prompt).not.toContain("campaign=newsletter");
  });

  it("keeps the booking block that the links were burying", async () => {
    let prompt = "";
    const server = await createMockOllama((p) => (prompt = p));
    try {
      await parseLodgingBookingText(DOCUMENT, { url: server.url, model: "mock" });
    } finally {
      await server.close();
    }

    // The dates keep their original mixed form on purpose: that form was never
    // the problem, and a fix that "helpfully" rewrote them would hide the fact.
    expect(prompt).toContain("Anreise : Mo, Apr 6, 2009");
    expect(prompt).toContain("Abreise : Mi, Apr 15, 2009");
    expect(prompt).toContain("Musterhotel am Bahnhof");
  });

  it("shrinks the document far enough that the window stops truncating it", async () => {
    let prompt = "";
    const server = await createMockOllama((p) => (prompt = p));
    try {
      await parseLodgingBookingText(DOCUMENT, { url: server.url, model: "mock" });
    } finally {
      await server.close();
    }

    // The archived mail fell from 12,360 characters to 3,995 this way. The point
    // is not a particular ratio but that the booking survives the window; a
    // document that is mostly links must not spend its budget on them.
    expect(DOCUMENT.length).toBeGreaterThan(6_000);
    expect(prompt).not.toContain("https://");
  });
});
