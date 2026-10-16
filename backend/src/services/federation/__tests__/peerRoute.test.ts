import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, randomBytes, sign } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { getInstanceSettings } from "../../instanceSettingsService";
import { hash } from "../security";
import peer from "../../../routes/comparisonPeer";

jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));

const LOCAL = "https://local.peer-route.test";
const REMOTE = "https://remote.peer-route.test";
const remote = generateKeyPairSync("ed25519");
const local = generateKeyPairSync("ed25519");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-route-"));
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use("/api/v1/comparison-peer", peer);

function signed(body: string) {
  const unsigned = {
    origin: REMOTE,
    destination: LOCAL,
    nonce: randomBytes(32).toString("hex"),
    time: Date.now(),
    body,
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(JSON.stringify(unsigned)), remote.privateKey).toString(
      "base64"
    ),
  };
}
const nonceRow = (m: { nonce: string }) =>
  prisma.comparisonNonce.findUnique({ where: { id: hash(REMOTE + m.nonce) } });

beforeAll(async () => {
  fs.writeFileSync(
    path.join(dir, "local.key"),
    local.privateKey.export({ type: "pkcs8", format: "pem" })
  );
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = LOCAL;
  process.env.FEDERATION_KEY_FILE = path.join(dir, "local.key");
  await prisma.comparisonPeer.upsert({
    where: { origin: REMOTE },
    create: {
      origin: REMOTE,
      publicKey: remote.publicKey.export({ type: "spki", format: "pem" }).toString(),
      enabled: true,
    },
    update: { enabled: true, verifiedAt: null },
  });
});
beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
});
afterAll(async () => {
  await prisma.comparisonPeer.delete({ where: { origin: REMOTE } });
  for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"])
    delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

it("answers an unverified peer's ping but stores no nonce for anything it sends", async () => {
  // Nonce rows were written for every signed packet before admission was checked, so an
  // admitted-but-unverified key could fill the table with packets it was never allowed to send.
  const ping = signed('{"action":"ping"}');
  const pong = await request(app).post("/api/v1/comparison-peer").send(ping);
  expect(pong.status).toBe(200);
  const state = signed(
    JSON.stringify({
      action: "state",
      channel: "00000000-0000-4000-8000-000000000000",
      confirmed: true,
      revoked: false,
    })
  );
  expect((await request(app).post("/api/v1/comparison-peer").send(state)).status).toBe(403);
  expect(await nonceRow(ping)).toBeNull();
  expect(await nonceRow(state)).toBeNull();
});

it("refuses an oversized packet before parsing it and logs why it refused", async () => {
  const warn = jest.spyOn(logger, "warn");
  const parse = jest.spyOn(JSON, "parse");
  const huge = signed(JSON.stringify({ action: "ping", pad: "x".repeat(20_000) }));
  parse.mockClear();
  const res = await request(app).post("/api/v1/comparison-peer").send(huge);
  expect(res.status).toBe(403);
  expect(parse.mock.calls.some(([text]) => text === huge.body)).toBe(false);
  expect(await nonceRow(huge)).toBeNull();
  expect(warn).toHaveBeenCalled();
  parse.mockRestore();
  warn.mockRestore();
});

it("reads the instance key once, not on every packet", async () => {
  const read = jest.spyOn(fs, "readFileSync");
  for (let i = 0; i < 3; i++)
    expect(
      (await request(app).post("/api/v1/comparison-peer").send(signed('{"action":"ping"}'))).status
    ).toBe(200);
  expect(
    read.mock.calls.filter(([file]) => String(file).endsWith("local.key")).length
  ).toBeLessThanOrEqual(1);
  read.mockRestore();
});

it("logs the refusal kind for an unverified peer's non-ping packet", async () => {
  const warn = jest.spyOn(logger, "warn");
  const state = signed(
    JSON.stringify({
      action: "state",
      channel: "00000000-0000-4000-8000-000000000000",
      confirmed: true,
      revoked: false,
    })
  );
  expect((await request(app).post("/api/v1/comparison-peer").send(state)).status).toBe(403);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "comparison_peer_refused", kind: "unverified-peer" }),
    "Comparison peer packet refused"
  );
  warn.mockRestore();
});

it("logs packet-too-large for an oversized body", async () => {
  const warn = jest.spyOn(logger, "warn");
  const huge = signed(JSON.stringify({ action: "ping", pad: "x".repeat(20_000) }));
  await request(app).post("/api/v1/comparison-peer").send(huge);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "packet-too-large" }),
    "Comparison peer packet refused"
  );
  warn.mockRestore();
});
