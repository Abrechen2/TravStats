import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { encryptApiKey } from "../../../utils/encryption";
import { parseLodgingBookingText } from "../../lodging/lodgingBookingParser";
import { parseCruiseBookingText } from "../../cruiseBookingParser";
import { parseRailBookingText } from "../../rail/parser/railBookingParser";
import { parseDocument } from "../../parsing/parseDocument";
import { clearAvailabilityCache } from "../../parsers/config";
import { clearLlmAvailabilityCache } from "../../parsers/llmAvailability";
import { LLM_CLOUD_NOT_CONSENTED_REASON } from "../llmGate";

/**
 * An OpenAI-compatible provider, end to end, against a fake on a loopback port
 * that records every request at the socket — so "nothing was sent" is counted,
 * not inferred from a result. No test here reaches the network: the only
 * endpoints ever contacted are this loopback server, and the cloud case is a
 * public host the refusal must stop BEFORE any request.
 */

const HOTEL_MAIL = [
  "Buchungsbestaetigung",
  "Hotel Seeblick Konstanz",
  "Anreise: 04.06.2026  Abreise: 06.06.2026",
  "Gesamtpreis: 240,00 EUR",
  "Buchungsnummer: 99887766",
].join("\n");

const MODEL_ANSWER = JSON.stringify({
  bookings: [
    {
      hotelName: "Hotel Seeblick Konstanz",
      checkIn: "2026-06-04",
      checkOut: "2026-06-06",
      nights: 2,
      totalPrice: 240,
      currency: "EUR",
      confirmationNumber: "99887766",
    },
  ],
});

const SECRET_KEY = "sk-test-0123456789abcdef";

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

let server: http.Server;
let base: string;
const seen: Seen[] = [];
/** What the fake answers for `/chat/completions`: a status and a content. */
let completion: { status: number; content: string } = { status: 200, content: MODEL_ANSWER };

let adminSettingsId: number;
let snapshot: Record<string, unknown> | null = null;
let createdRow = false;
let adminId: string;
let userId: string;
let adminCookie: string;

async function configure(data: Record<string, unknown>): Promise<void> {
  await prisma.adminSettings.update({ where: { id: adminSettingsId }, data });
  clearAvailabilityCache();
  clearLlmAvailabilityCache();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      });
      res.setHeader("Content-Type", "application/json");
      const authorised = req.headers.authorization === `Bearer ${SECRET_KEY}`;
      if (req.url === "/v1/models") {
        res.statusCode = authorised ? 200 : 401;
        res.end(JSON.stringify(authorised ? { data: [{ id: "gpt-test" }] } : { error: "no" }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        res.statusCode = completion.status;
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: completion.content } }],
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
  if (row) {
    adminSettingsId = row.id;
    snapshot = {
      llmEnabled: row.llmEnabled,
      parserOrder: row.parserOrder,
      ollamaUrl: row.ollamaUrl,
      ollamaModel: row.ollamaModel,
      llmProvider: row.llmProvider,
      openaiCompatBaseUrl: row.openaiCompatBaseUrl,
      openaiCompatModel: row.openaiCompatModel,
      openaiCompatApiKey: row.openaiCompatApiKey,
      llmCloudOptIn: row.llmCloudOptIn,
    };
  } else {
    adminSettingsId = (await prisma.adminSettings.create({ data: {} })).id;
    createdRow = true;
  }

  await prisma.user.deleteMany({ where: { username: { in: ["llmprov_admin", "llmprov_user"] } } });
  const admin = await prisma.user.create({
    data: {
      username: "llmprov_admin",
      passwordHash: await hashPassword("pw123456"),
      isAdmin: true,
    },
  });
  const user = await prisma.user.create({
    data: { username: "llmprov_user", passwordHash: await hashPassword("pw123456") },
  });
  adminId = admin.id;
  userId = user.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  if (createdRow) await prisma.adminSettings.delete({ where: { id: adminSettingsId } });
  else if (snapshot)
    await prisma.adminSettings.update({ where: { id: adminSettingsId }, data: snapshot });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  seen.length = 0;
  completion = { status: 200, content: MODEL_ANSWER };
  await configure({
    llmEnabled: true,
    parserOrder: "template_first",
    ollamaUrl: null,
    ollamaModel: null,
    llmProvider: "openai_compatible",
    openaiCompatBaseUrl: base,
    openaiCompatModel: "gpt-test",
    openaiCompatApiKey: encryptApiKey(SECRET_KEY),
    llmCloudOptIn: false,
  });
});

describe("an OpenAI-compatible provider reads a document the templates do not know", () => {
  it("sends the same prompt to /chat/completions with the key, and the stay comes back", async () => {
    const result = await parseLodgingBookingText(HOTEL_MAIL, undefined, userId);

    expect(result.parserUsed).toBe("ollama");
    expect(result.bookings[0]?.hotelName).toBe("Hotel Seeblick Konstanz");

    const generate = seen.find((r) => r.url === "/v1/chat/completions");
    expect(generate?.authorization).toBe(`Bearer ${SECRET_KEY}`);
    const body = JSON.parse(generate?.body ?? "{}") as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format?: { type: string };
      temperature: number;
    };
    expect(body.model).toBe("gpt-test");
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[1].content).toContain("Hotel Seeblick Konstanz");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0);
  });

  it("names the provider on the parse result, and no host for a LAN endpoint", async () => {
    const outcome = await parseDocument({
      text: HOTEL_MAIL,
      domain: "lodging",
      source: "document",
      userId,
    });
    expect(outcome.body.parserUsed).toBe("ollama");
    expect(outcome.body.llmProvider).toEqual({
      kind: "openai_compatible",
      model: "gpt-test",
      isCloud: false,
      host: null,
    });
  });

  it("a provider that fails mid-parse is reported with its status, not as 'nothing found'", async () => {
    completion = { status: 429, content: "" };
    const result = await parseLodgingBookingText(HOTEL_MAIL, undefined, userId);
    expect(result.parserUsed).toBe("none");
    expect(result.fallbackReason).toBe("OpenAI-compatible request returned HTTP 429");
  });

  it("a cruise the provider fails on says so instead of throwing or claiming an empty success", async () => {
    completion = { status: 500, content: "" };
    const result = await parseCruiseBookingText("Eine Kreuzfahrt ohne Muster.", undefined, userId);
    expect(result.parserUsed).toBe("none");
    expect(result.fallbackReason).toBe(
      "The AI parser failed: OpenAI-compatible request returned HTTP 500"
    );
  });

  it("a wrong key is 'not reachable' with the status, before any document is sent", async () => {
    await configure({ openaiCompatApiKey: encryptApiKey("sk-wrong-000000000000") });
    const result = await parseLodgingBookingText(HOTEL_MAIL, undefined, userId);
    expect(result.parserUsed).toBe("none");
    expect(result.fallbackReason).toBe(
      "OpenAI-compatible provider is not reachable (OpenAI-compatible availability check returned HTTP 401)"
    );
    expect(seen.some((r) => r.url === "/v1/chat/completions")).toBe(false);
  });
});

describe("a provider outside the local network needs the admin's consent", () => {
  beforeEach(() =>
    configure({ openaiCompatBaseUrl: "https://api.provider.example/v1", llmCloudOptIn: false })
  );

  it("lodging: templates only, the reason names the missing consent, nothing is sent", async () => {
    const result = await parseLodgingBookingText(HOTEL_MAIL, undefined, userId);
    expect(result.parserUsed).toBe("none");
    expect(result.fallbackReason).toBe(LLM_CLOUD_NOT_CONSENTED_REASON);
    expect(seen).toEqual([]);
  });

  it("rail: the refusal carries its own code for the client to word", async () => {
    const result = await parseRailBookingText("Ein Dokument ohne Muster.", [], userId);
    expect(result.fallbackCode).toBe("llmCloudNotConsented");
    expect(seen).toEqual([]);
  });

  it("the import screen is told before a document is dropped", async () => {
    const res = await request(app).get("/api/v1/parser-capabilities").expect(200);
    expect(res.body).toMatchObject({ hasLlm: false, llmRefusal: "cloud_not_consented" });
  });
});

describe("admin settings for the provider", () => {
  it("never returns the key, only its masked echo — and a masked echo keeps it", async () => {
    const get = await request(app).get("/api/v1/admin/parser-settings").set("Cookie", adminCookie);
    expect(get.status).toBe(200);
    expect(get.body.openaiCompatApiKey).toBe("sk-t****cdef");
    expect(JSON.stringify(get.body)).not.toContain(SECRET_KEY);

    const put = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ openaiCompatApiKey: get.body.openaiCompatApiKey, openaiCompatModel: "gpt-test" });
    expect(put.status).toBe(200);
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: adminSettingsId } });
    expect(row.openaiCompatApiKey).not.toBeNull();
    expect(row.openaiCompatApiKey).not.toContain(SECRET_KEY);
  });

  it("refuses plain http to a public host with a stable code", async () => {
    const res = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ openaiCompatBaseUrl: "http://api.provider.example/v1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LLM_BASE_URL_HTTPS_REQUIRED");
  });

  it("reports a cloud endpoint as cloud, so the page can show the warning", async () => {
    await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ openaiCompatBaseUrl: "https://api.provider.example/v1/" })
      .expect(200);
    const get = await request(app).get("/api/v1/admin/parser-settings").set("Cookie", adminCookie);
    expect(get.body.openaiCompatBaseUrl).toBe("https://api.provider.example/v1");
    expect(get.body.openaiCompatIsCloud).toBe(true);
    expect(get.body.llmCloudOptIn).toBe(false);
  });

  it("'Verbindung testen' tells a rejected key apart from an unreachable host", async () => {
    const bad = await request(app)
      .post("/api/v1/admin/test-llm-provider")
      .set("Cookie", adminCookie)
      .send({ baseUrl: base, model: "gpt-test", apiKey: "sk-wrong-000000000000" });
    expect(bad.body).toMatchObject({ ok: false, errorCode: "auth" });

    const good = await request(app)
      .post("/api/v1/admin/test-llm-provider")
      .set("Cookie", adminCookie)
      // The masked echo tests the STORED key.
      .send({ baseUrl: base, model: "gpt-test", apiKey: "sk-t****cdef" });
    expect(good.body).toMatchObject({ ok: true, modelFound: true, isCloud: false });
    expect(seen.every((r) => r.url === "/v1/models")).toBe(true);
  });
});
