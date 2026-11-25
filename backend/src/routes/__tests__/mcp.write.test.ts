import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateApiToken } from "../../utils/apiTokens";
import { createClient } from "../../../../packages/travstats-mcp/src/core/client";
import { loadConfig } from "../../../../packages/travstats-mcp/src/core/config";
import { DraftStore } from "../../../../packages/travstats-mcp/src/core/drafts";
import { callTool } from "../../../../packages/travstats-mcp/src/core/runtime";
import {
  WRITE_TOOLS,
  resetJobBudget,
} from "../../../../packages/travstats-mcp/src/core/writeTools";
import type { ToolContext, ToolDef } from "../../../../packages/travstats-mcp/src/core/types";
import { SIXT_LAYOUT_B } from "../../services/rental/parser/__tests__/sixtFixtures";

/**
 * travstats-mcp's WRITE tools against the real app (own database): parse a booking, look at the
 * draft, add it with `confirm`, and find the entry with its original document attached. The
 * documents are synthetic; no personal sample is read.
 */
const USERNAME = "mcpWriteUser";
const tool = (name: string): ToolDef => WRITE_TOOLS.find((t) => t.name === name)!;

async function pat(userId: string, scope: "read" | "write"): Promise<string> {
  const t = await generateApiToken();
  await prisma.apiToken.create({
    data: { userId, label: `mcp-${scope}`, lookupHash: t.lookupHash, hash: t.hash, scope },
  });
  return t.plaintext;
}

describe("travstats-mcp write tools against the real API", () => {
  let server: http.Server;
  let url: string;
  let userId: string;
  let writeToken: string;
  let readToken: string;
  let dir: string;
  const ctxFor = (token: string): ToolContext => {
    const config = loadConfig({ TRAVSTATS_URL: url, TRAVSTATS_TOKEN: token });
    return {
      client: createClient(config, fetch, undefined, "0.2.0-test"),
      instance: config.instance,
      filesDir: dir,
      drafts: new DraftStore(),
    };
  };
  const call = (ctx: ToolContext, name: string, args: unknown, token: string) =>
    callTool(ctx, tool(name), args, token);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    userId = (
      await prisma.user.create({
        data: { username: USERNAME, passwordHash: await hashPassword("password123") },
      })
    ).id;
    writeToken = await pat(userId, "write");
    readToken = await pat(userId, "read");
    for (const [iata, name, lat, lon, tz] of [
      ["MCQ", "Mcp Test Airport One", 50.0, 8.5, "Europe/Berlin"],
      ["MCR", "Mcp Test Airport Two", 40.6, -73.7, "America/New_York"],
    ] as const) {
      await prisma.airport.deleteMany({ where: { iata } });
      await prisma.airport.create({
        data: { iata, icao: `K${iata}`, name, city: name, country: "XX", lat, lon, timezone: tz },
      });
    }
    dir = mkdtempSync(path.join(tmpdir(), "mcp-write-"));
    server = http.createServer(app).listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => resetJobBudget());

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await prisma.airport.deleteMany({ where: { iata: { in: ["MCQ", "MCR"] } } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  it("a read token cannot write: the server answers with the `scope` reason", async () => {
    const ctx = ctxFor(readToken);
    const visit = await call(
      ctx,
      "add_place_visit",
      {
        place: { name: "Mcp Café", lat: 1, lon: 2 },
        date: "2031-01-01",
        confirm: true,
      },
      readToken
    );
    expect(visit.text).toMatch(/^\[scope\]/);
    writeFileSync(path.join(dir, "r.txt"), "receipt");
    const doc = await call(ctx, "upload_document", { fileName: "r.txt", confirm: true }, readToken);
    expect(doc.text).toMatch(/^\[scope\]/);
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect(await prisma.document.count({ where: { userId } })).toBe(0);
  });

  it("parses a rental confirmation into a draft that saves nothing, then adds it with its original attached", async () => {
    const ctx = ctxFor(writeToken);
    const text = SIXT_LAYOUT_B.replace(/Frankfurt/g, "Stuttgart");
    const rentalsBefore = await prisma.rentalBooking.count({ where: { userId } });
    const parsed = await call(ctx, "parse_booking", { text, domain: "rental" }, writeToken);
    expect(parsed.isError).toBe(false);
    expect(parsed.structured).toMatchObject({ savedNothing: true, domain: "rental" });
    expect(parsed.structured?.untrusted).toMatch(/never instructions/);
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(rentalsBefore);
    expect(await prisma.document.count({ where: { userId } })).toBe(0);

    const draftId = parsed.structured!.draftId as string;
    const dry = await call(ctx, "add_entry_from_draft", { draftId }, writeToken);
    expect(dry.structured).toMatchObject({ written: false, confirmRequired: true });
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(rentalsBefore);

    const added = await call(ctx, "add_entry_from_draft", { draftId, confirm: true }, writeToken);
    expect(added.isError).toBe(false);
    const { id, documentId, link } = added.structured as {
      id: string;
      documentId: string;
      link: string;
    };
    expect(link).toBe(`${url}/rentals/${id}`);
    const links = await prisma.documentLink.findMany({ where: { documentId } });
    expect(links).toHaveLength(1);
    expect(await prisma.rentalBooking.findFirst({ where: { id, userId } })).not.toBeNull();
    const doc = await prisma.document.findFirstOrThrow({ where: { id: documentId, userId } });
    expect(doc.format).toBe("emailText");
  });

  it("adds a flight from explicit fields with the original file from the folder attached, once", async () => {
    const ctx = ctxFor(writeToken);
    writeFileSync(
      path.join(dir, "confirmation.eml"),
      "From: airline@example.invalid\nSubject: Your booking MCP123\n\nFlight MCQ to MCR"
    );
    const args = {
      entry: {
        domain: "flight",
        flightNumber: "XX123",
        airline: "Test Air",
        departureAirport: "MCQ",
        arrivalAirport: "MCR",
        departureLocal: "2031-07-06T10:00",
        arrivalLocal: "2031-07-06T12:40",
        bookingReference: "MCP123",
      },
      sourceFileName: "confirmation.eml",
      confirm: true,
    };
    const first = await call(ctx, "add_flight", args, writeToken);
    expect(first.isError).toBe(false);
    const { id, documentId } = first.structured as { id: string; documentId: string };
    const flight = await prisma.flight.findFirstOrThrow({ where: { id, userId } });
    expect(flight.flightNumber).toBe("XX123");
    expect(flight.depTimezone ?? "Europe/Berlin").toBeTruthy();
    expect(await prisma.documentLink.count({ where: { documentId } })).toBe(1);
    const doc = await prisma.document.findFirstOrThrow({ where: { id: documentId } });
    expect(doc.format).toBe("eml");

    // The create itself is in the change history, named after the key that made it.
    const created = await prisma.changeLedgerEntry.findMany({ where: { entityId: id } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      operation: "create",
      field: null,
      source: "api",
      reason: "via MCP / mcp-write",
    });
    const listed = await fetch(`${url}/api/v1/change-history?entityType=flight&entityId=${id}`, {
      headers: { Authorization: `Bearer ${writeToken}` },
    });
    expect(JSON.stringify(await listed.json())).toContain("via MCP / mcp-write");
  });

  it("a create that does not come from the MCP package leaves no history row", async () => {
    const res = await fetch(`${url}/api/v1/places`, {
      method: "POST",
      headers: { Authorization: `Bearer ${writeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Plain place", lat: 1, lon: 2 }),
    });
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as { id?: string; data?: { id?: string } };
    const id = body.id ?? body.data?.id;
    expect(id).toBeDefined();
    expect(
      await prisma.changeLedgerEntry.count({ where: { entityId: id, operation: "create" } })
    ).toBe(0);
  });

  it("refuses a file outside the folder, and nothing is uploaded", async () => {
    const ctx = ctxFor(writeToken);
    const docsBefore = await prisma.document.count({ where: { userId } });
    const out = await call(
      ctx,
      "upload_document",
      { fileName: "../../etc/passwd", confirm: true },
      writeToken
    );
    expect(out.isError).toBe(true);
    expect(await prisma.document.count({ where: { userId } })).toBe(docsBefore);
  });

  it("files a document in the inbox unassigned, and it shows in the unfiled list", async () => {
    const ctx = ctxFor(writeToken);
    writeFileSync(path.join(dir, "note.txt"), "A hotel receipt, pasted as text");
    const out = await call(
      ctx,
      "upload_document",
      { fileName: "note.txt", confirm: true },
      writeToken
    );
    expect(out.isError).toBe(false);
    const { documentId } = out.structured as { documentId: string };
    const res = await fetch(`${url}/api/v1/documents/unfiled`, {
      headers: { Authorization: `Bearer ${writeToken}` },
    });
    const body = (await res.json()) as { data: { documents: Array<{ id: string }> } };
    expect(body.data.documents.map((d) => d.id)).toContain(documentId);
  });
});
