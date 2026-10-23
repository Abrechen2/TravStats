import express from "express";
import request from "supertest";
import { generateKeyPairSync } from "crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { ensureAdminSettingsRow } from "../../../services/adminSettingsRow";
import { resetIdentityCache } from "../../../services/federation/identity";
import { hash } from "../../../services/federation/refusal";
import federation from "../federation";

// The parent admin router applies authenticate + requireAdmin + requireWriteScope.
const app = express();
app.use(express.json());
app.use("/api/v1/admin/federation", federation);
app.use(errorHandler);

const BASE = "/api/v1/admin/federation";
const ME = "https://me.connection-file.test";
const PEER = "https://peer.connection-file.test";
let rowId: number;

const pemOf = () =>
  generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

const fileJson = (over: Record<string, unknown> = {}) => {
  const publicKey = pemOf();
  return {
    format: "travstats-federation-connection",
    version: 1,
    origin: PEER,
    publicKey,
    fingerprint: hash(publicKey),
    createdAt: "2026-10-23T10:00:00.000Z",
    ...over,
  };
};
const zipOf = (entries: Record<string, Uint8Array>) => Buffer.from(zipSync(entries));
const zipOfJson = (json: unknown) =>
  zipOf({ "travstats-connection.json": strToU8(JSON.stringify(json)) });

const inspect = (bytes: Buffer, filename = "connection.zip") =>
  request(app).post(`${BASE}/connection-file/inspect`).attach("file", bytes, filename);

/** Downloads with supertest's binary parser, so the ZIP arrives as a Buffer. */
const download = () =>
  request(app)
    .get(`${BASE}/connection-file`)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
});
beforeEach(async () => {
  delete process.env.FEDERATION_ENABLED;
  resetIdentityCache();
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  await prisma.$disconnect();
});

async function withIdentity() {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: true, federationOrigin: ME, federationPrivateKey: null },
  });
  const res = await request(app).post(`${BASE}/key`).send({});
  expect(res.status).toBe(200);
  return res.body as { fingerprint: string; publicKey: string };
}

describe("GET /connection-file", () => {
  it("refuses with a code while there is no key", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { federationEnabled: true, federationOrigin: ME, federationPrivateKey: null },
    });
    const res = await request(app).get(`${BASE}/connection-file`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COMPARISON_FEDERATION_OFF");
  });

  it("refuses with a code while there is no public address", async () => {
    await withIdentity();
    await prisma.adminSettings.update({ where: { id: rowId }, data: { federationOrigin: null } });
    resetIdentityCache();
    const res = await request(app).get(`${BASE}/connection-file`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COMPARISON_FEDERATION_OFF");
  });

  it("answers a ZIP whose key hashes to the fingerprint the server shows", async () => {
    const state = await withIdentity();
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="travstats-verbindung-me.connection-file.test.zip"'
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const entries = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Object.keys(entries).sort()).toEqual(["LIESMICH.txt", "travstats-connection.json"]);
    const json = JSON.parse(Buffer.from(entries["travstats-connection.json"]).toString("utf8"));
    expect(json).toMatchObject({
      format: "travstats-federation-connection",
      version: 1,
      origin: ME,
      publicKey: state.publicKey,
      fingerprint: state.fingerprint,
    });
    expect(hash(json.publicKey)).toBe(json.fingerprint);
    expect(Number.isNaN(Date.parse(json.createdAt))).toBe(false);
    const readme = Buffer.from(entries["LIESMICH.txt"]).toString("utf8");
    expect(readme).toContain(state.fingerprint);
    expect(readme).toContain("am Telefon");
    expect(readme).toContain("by phone");
    expect(JSON.stringify(json)).not.toMatch(/PRIVATE KEY/);
  });

  it("is what another server's inspect accepts, byte for byte", async () => {
    const state = await withIdentity();
    const zip = (await download()).body as Buffer;
    // Read as if uploaded elsewhere: pretend this server has another address meanwhile.
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { federationOrigin: "https://elsewhere.connection-file.test" },
    });
    resetIdentityCache();
    const res = await inspect(zip);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      origin: ME,
      publicKey: state.publicKey,
      fingerprint: state.fingerprint,
      existingPeer: null,
    });
  });
});

describe("POST /connection-file/inspect", () => {
  beforeEach(async () => {
    await withIdentity();
  });

  it("reads a ZIP and its bare JSON alike, and pins nothing", async () => {
    const json = fileJson();
    for (const [bytes, name] of [
      [zipOfJson(json), "connection.zip"],
      [Buffer.from(JSON.stringify(json)), "travstats-connection.json"],
    ] as const) {
      const res = await inspect(bytes, name);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        origin: PEER,
        publicKey: json.publicKey,
        fingerprint: json.fingerprint,
        existingPeer: null,
      });
    }
    expect(await prisma.comparisonPeer.count({ where: { origin: PEER } })).toBe(0);
  });

  it("says whether the server is already pinned with this key or another one", async () => {
    const json = fileJson();
    const pinned = await request(app).post(`${BASE}/peers`).send({
      origin: PEER,
      publicKey: json.publicKey,
      fingerprint: json.fingerprint,
      enabled: true,
    });
    expect(pinned.status).toBe(200);
    const same = await inspect(zipOfJson(json));
    expect(same.body.existingPeer).toEqual({ fingerprint: json.fingerprint, sameKey: true });

    const other = fileJson();
    const changed = await inspect(zipOfJson(other));
    expect(changed.status).toBe(200);
    expect(changed.body.existingPeer).toEqual({ fingerprint: json.fingerprint, sameKey: false });
    // The stored key is untouched until the admin pins the new one.
    const stored = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } });
    expect(stored.publicKey).toBe(json.publicKey);
  });

  const refusals: Array<[string, () => Buffer, number, string]> = [
    ["neither ZIP nor JSON", () => Buffer.from("hello, not a file"), 422, "UNREADABLE"],
    [
      "a damaged ZIP",
      () => Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(200, 7)]),
      422,
      "UNREADABLE",
    ],
    [
      "a ZIP without the entry",
      () => zipOf({ "other.json": strToU8(JSON.stringify(fileJson())) }),
      422,
      "UNREADABLE",
    ],
    [
      "the entry in a folder only",
      () => zipOf({ "x/travstats-connection.json": strToU8(JSON.stringify(fileJson())) }),
      422,
      "UNREADABLE",
    ],
    ["another format", () => zipOfJson(fileJson({ format: "something-else" })), 422, "FORMAT"],
    ["another version", () => zipOfJson(fileJson({ version: 2 })), 422, "FORMAT"],
    ["a wrong shape", () => zipOfJson({ hello: "world" }), 422, "FORMAT"],
    [
      "an http address",
      () => zipOfJson(fileJson({ origin: "http://peer.example" })),
      422,
      "ORIGIN",
    ],
    [
      "an address with a path",
      () => zipOfJson(fileJson({ origin: `${PEER}/travstats` })),
      422,
      "ORIGIN",
    ],
    [
      "credentials in the address",
      () => zipOfJson(fileJson({ origin: "https://u:p@peer.example" })),
      422,
      "ORIGIN",
    ],
    [
      "a fingerprint of another key",
      () => zipOfJson(fileJson({ fingerprint: hash(pemOf()) })),
      422,
      "FINGERPRINT",
    ],
    [
      "text that is not a key",
      () => zipOfJson(fileJson({ publicKey: "x".repeat(80) })),
      422,
      "KEY",
    ],
    ["this server itself", () => zipOfJson(fileJson({ origin: ME })), 422, "SELF"],
    ["an upload past 64 KB", () => Buffer.alloc(65 * 1024, 0x20), 413, "TOO_LARGE"],
  ];
  it.each(refusals)("refuses %s with its own code", async (_label, bytes, status, code) => {
    const res = await inspect(bytes());
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(`COMPARISON_CONNECTION_FILE_${code}`);
    expect(await prisma.comparisonPeer.count({ where: { origin: PEER } })).toBe(0);
  });

  it("refuses a private key, even one whose public half matches the fingerprint", async () => {
    const pair = generateKeyPairSync("ed25519");
    const pub = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const priv = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const res = await inspect(zipOfJson(fileJson({ publicKey: priv, fingerprint: hash(pub) })));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("COMPARISON_CONNECTION_FILE_KEY");
  });

  it("refuses the entry twice", async () => {
    const one = zipOfJson(fileJson());
    // fflate refuses duplicate names, so splice two local headers together by hand: the
    // streaming reader meets the second entry after the first and must refuse the file.
    const firstEntryEnd = one.indexOf(Buffer.from("PK\x01\x02"));
    const doubled = Buffer.concat([one.subarray(0, firstEntryEnd), one]);
    const res = await inspect(doubled);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("COMPARISON_CONNECTION_FILE_UNREADABLE");
  });

  it("stops a ZIP bomb by the bytes it inflates, not by what the header declares", async () => {
    // ~10 MB of one character deflates to a few KB, well under the upload cap.
    const bomb = zipOf({
      "travstats-connection.json": new Uint8Array(10 * 1024 * 1024).fill(0x20),
    });
    expect(bomb.length).toBeLessThan(64 * 1024);
    // Lie in both headers: claim the entry inflates to 100 bytes.
    const lied = Buffer.from(bomb);
    lied.writeUInt32LE(100, 22); // local file header: uncompressed size
    const central = lied.indexOf(Buffer.from("PK\x01\x02"));
    lied.writeUInt32LE(100, central + 24); // central directory: uncompressed size
    for (const bytes of [bomb, lied]) {
      const res = await inspect(bytes);
      expect(res.status).toBe(413);
      expect(res.body.code).toBe("COMPARISON_CONNECTION_FILE_TOO_LARGE");
    }
  });

  it("refuses a request without a file", async () => {
    const res = await request(app).post(`${BASE}/connection-file/inspect`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("COMPARISON_CONNECTION_FILE_UNREADABLE");
  });
});
