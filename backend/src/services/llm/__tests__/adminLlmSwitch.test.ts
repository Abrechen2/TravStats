import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { parseBookingEmail } from "../../bookingParser";
import { parseCruiseBookingText } from "../../cruiseBookingParser";
import { parseLodgingBookingText } from "../../lodging/lodgingBookingParser";
import { suggestLodgingCsvMapping } from "../../lodging/mappingSuggestion";
import { summariseTrip } from "../../tripSummaryService";
import { OllamaTextParser } from "../../parsers/text/ollamaTextParser";
import { clearAvailabilityCache } from "../../parsers/config";
import { clearLlmAvailabilityCache } from "../../parsers/llmAvailability";
import { parseDocument } from "../../parsing/parseDocument";
import { LLM_DISABLED_REASON } from "../llmGate";

/**
 * The admin switch "KI-Parser aus" (owner decision 2026-09-25): off means no
 * model call at all — even with an Ollama URL in the admin settings AND in
 * `OLLAMA_URL` — while the template readers keep working.
 *
 * The model is a real HTTP server on a loopback port that counts what it is
 * asked. Reading a parser's RESULT would pass while the model was asked and
 * its answer thrown away; counting requests at the socket cannot. Each "off"
 * case has an "on" twin that must reach the same server, so a count of zero
 * means the switch held rather than that the harness never worked.
 */

/** A document no template in any domain recognises, so every pipeline reaches
 *  the step where it would ask the model. */
const UNKNOWN_DOCUMENT =
  "Guten Tag, anbei die Bestaetigung Ihrer Buchung bei einem Anbieter, den kein Muster kennt. Vielen Dank.";

let server: http.Server;
let serverUrl: string;
const generateCalls: string[] = [];

let adminSettingsId: number;
let createdAdminSettings = false;
let previous: {
  ollamaUrl: string | null;
  ollamaModel: string | null;
  llmEnabled: boolean;
  parserOrder: string;
} | null = null;
const savedEnvUrl = process.env.OLLAMA_URL;
const savedEnvModel = process.env.OLLAMA_MODEL;

let adminId: string;
let userId: string;
let adminCookie: string;
let userCookie: string;

async function setSwitch(llmEnabled: boolean): Promise<void> {
  await prisma.adminSettings.update({ where: { id: adminSettingsId }, data: { llmEnabled } });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/generate")) generateCalls.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/api/tags")) {
      res.end(JSON.stringify({ models: [{ name: "switch-model" }] }));
      return;
    }
    // Drain the body before answering, or the client may see a reset.
    req.resume();
    req.on("end", () => res.end(JSON.stringify({ response: "{}" })));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The environment names the model too: the switch must hold against both
  // sources, since every caller falls back to OLLAMA_URL.
  process.env.OLLAMA_URL = serverUrl;
  process.env.OLLAMA_MODEL = "switch-model";

  const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
  if (row) {
    adminSettingsId = row.id;
    previous = {
      ollamaUrl: row.ollamaUrl,
      ollamaModel: row.ollamaModel,
      llmEnabled: row.llmEnabled,
      parserOrder: row.parserOrder,
    };
    await prisma.adminSettings.update({
      where: { id: row.id },
      data: { ollamaUrl: serverUrl, ollamaModel: "switch-model", parserOrder: "llm_first" },
    });
  } else {
    const created = await prisma.adminSettings.create({
      data: { ollamaUrl: serverUrl, ollamaModel: "switch-model", parserOrder: "llm_first" },
    });
    adminSettingsId = created.id;
    createdAdminSettings = true;
  }

  await prisma.user.deleteMany({
    where: { username: { in: ["llmswitch_admin", "llmswitch_user"] } },
  });
  const admin = await prisma.user.create({
    data: {
      username: "llmswitch_admin",
      passwordHash: await hashPassword("password123"),
      isAdmin: true,
    },
  });
  const user = await prisma.user.create({
    data: { username: "llmswitch_user", passwordHash: await hashPassword("password123") },
  });
  adminId = admin.id;
  userId = user.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
  userCookie = `auth_token=${generateToken(user.id)}`;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  if (createdAdminSettings) {
    await prisma.adminSettings.delete({ where: { id: adminSettingsId } });
  } else if (previous) {
    await prisma.adminSettings.update({ where: { id: adminSettingsId }, data: previous });
  }
  if (savedEnvUrl === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = savedEnvUrl;
  if (savedEnvModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = savedEnvModel;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  generateCalls.length = 0;
  clearAvailabilityCache();
  clearLlmAvailabilityCache();
});

describe("with the model switched OFF", () => {
  beforeEach(() => setSwitch(false));

  it("flight: the parser never asks the model, even under llm_first", async () => {
    const result = await parseBookingEmail("Eine Buchung", UNKNOWN_DOCUMENT, undefined, {
      userId,
    });
    expect(generateCalls).toEqual([]);
    expect(result.parserUsed).toBe("regex");
    expect(result.ollamaAvailable).toBe(false);
  });

  it("cruise: templates only, and the reason says it was the admin", async () => {
    const result = await parseCruiseBookingText(UNKNOWN_DOCUMENT, undefined, userId);
    expect(generateCalls).toEqual([]);
    expect(result.parserUsed).toBe("none");
    expect(result.fallbackReason).toBe(LLM_DISABLED_REASON);
  });

  it("lodging: templates only, and the reason says it was the admin", async () => {
    const result = await parseLodgingBookingText(UNKNOWN_DOCUMENT, undefined, userId);
    expect(generateCalls).toEqual([]);
    expect(result.parserUsed).toBe("none");
    expect(result.fallbackReason).toBe(LLM_DISABLED_REASON);
  });

  it("lodging CSV mapping: no suggestion is asked for", async () => {
    const mapping = await suggestLodgingCsvMapping(["Hotel", "Check-in"], [{ Hotel: "A" }]);
    expect(generateCalls).toEqual([]);
    expect(mapping).toEqual({});
  });

  it("trip summary: refused as LLM_DISABLED before the generator runs", async () => {
    const generate = jest.fn(async () => "never");
    await expect(
      summariseTrip("00000000-0000-0000-0000-000000000000", userId, {
        language: "de",
        target: { url: serverUrl, model: "switch-model" },
        generate,
      })
    ).rejects.toMatchObject({ statusCode: 503, code: "LLM_DISABLED" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("a caller that skipped the refusal still fails closed at the request", async () => {
    const parser = new OllamaTextParser(serverUrl, "switch-model");
    await expect(parser.parseEmail("s", UNKNOWN_DOCUMENT)).rejects.toMatchObject({
      code: "LLM_DISABLED",
    });
    expect(generateCalls).toEqual([]);
  });

  it("a parse answer tells 'switched off' apart from 'unreachable'", async () => {
    const outcome = await parseDocument({
      text: UNKNOWN_DOCUMENT,
      domain: "lodging",
      source: "document",
      userId,
    });
    expect(outcome.body.llmDisabledByAdmin).toBe(true);
    expect(outcome.body.ollamaAvailable).toBe(false);
  });

  it("parser-capabilities reports the switch, not a missing model", async () => {
    const res = await request(app).get("/api/v1/parser-capabilities").expect(200);
    expect(res.body).toEqual({ hasLlm: false, llmDisabledByAdmin: true });
  });
});

describe("with the model switched ON (controls: the harness does see calls)", () => {
  beforeEach(() => setSwitch(true));

  it("flight asks the model", async () => {
    await parseBookingEmail("Eine Buchung", UNKNOWN_DOCUMENT, undefined, { userId });
    expect(generateCalls.length).toBeGreaterThan(0);
  });

  it("cruise asks the model", async () => {
    await parseCruiseBookingText(UNKNOWN_DOCUMENT, undefined, userId).catch(() => undefined);
    expect(generateCalls.length).toBeGreaterThan(0);
  });

  it("lodging asks the model", async () => {
    await parseLodgingBookingText(UNKNOWN_DOCUMENT, undefined, userId);
    expect(generateCalls.length).toBeGreaterThan(0);
  });

  it("lodging CSV mapping asks the model", async () => {
    await suggestLodgingCsvMapping(["Hotel", "Check-in"], [{ Hotel: "A" }]);
    expect(generateCalls.length).toBeGreaterThan(0);
  });

  it("parser-capabilities reports a model", async () => {
    const res = await request(app).get("/api/v1/parser-capabilities").expect(200);
    expect(res.body).toEqual({ hasLlm: true, llmDisabledByAdmin: false });
  });
});

describe("the admin setting", () => {
  it("defaults to on, so an instance with a model keeps using it", async () => {
    const column = await prisma.$queryRaw<{ column_default: string }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'admin_settings' AND column_name = 'llm_enabled'`;
    expect(column[0]?.column_default).toBe("true");
  });

  it("round-trips through the admin API", async () => {
    const off = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ llmEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body.settings.llmEnabled).toBe(false);
    const read = await request(app).get("/api/v1/admin/parser-settings").set("Cookie", adminCookie);
    expect(read.body.llmEnabled).toBe(false);
    await setSwitch(true);
  });

  it("is not writable by a non-admin", async () => {
    await setSwitch(true);
    const res = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", userCookie)
      .send({ llmEnabled: false });
    expect(res.status).toBe(403);
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: adminSettingsId } });
    expect(row.llmEnabled).toBe(true);
  });
});
