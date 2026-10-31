/** Isolated test driver. Never mounted by the application; no published ports. */
import express from "express";
import https from "node:https";
import fs from "node:fs";
import { randomUUID, createHash, generateKeyPairSync } from "node:crypto";
import peerRouter from "../../backend/src/routes/comparisonPeer";
import { prisma } from "../../backend/src/db";
import { loadIdentity, exchange, envelope } from "../../backend/src/services/federation/security";
import {
  invite,
  claim,
  listLinks,
  changeLink,
  saveGrant,
  revokeGrant,
} from "../../backend/src/services/federation/links";
import {
  registerDevice,
  beginPublication,
  putChunk,
  finishPublication,
  revokeDevice,
} from "../../backend/src/services/federation/e2e/store";
import { ask } from "../../backend/src/services/federation/e2e/relay";
import { scopeSchema } from "../../backend/src/services/federation/contract";
import {
  generateDevice,
  createPublication,
  openPublication,
  type PublicDevice,
  type Manifest,
} from "../../frontend/src/lib/encryptedShare/crypto";

if (
  process.env.FEDERATION_SANDBOX !== "1" ||
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.startsWith("/federation_sandbox_")
)
  throw Error("Sandbox-only driver requires a dedicated database");
const scope = scopeSchema.parse({
  statistics: true,
  details: true,
  personal: true,
  costs: true,
  photos: true,
  documents: true,
  domains: ["flight", "cruise", "lodging", "poi", "roadtrip", "rail", "rental", "bus", "ferry"],
  tripIds: [],
  futureTrips: true,
  year: null,
  precision: "exact",
  expiresAt: null,
});
let user: string;
let device: Awaited<ReturnType<typeof generateDevice>>;
let unavailable = false;
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(
  "/api/v1/comparison-peer",
  (_req, res, next) => (unavailable ? res.sendStatus(503) : next()),
  peerRouter
);
const directory = process.env.QA_KEYS!;
const server = https.createServer(
  { key: fs.readFileSync(`${directory}/tls.key`), cert: fs.readFileSync(`${directory}/tls.crt`) },
  app
);
const control = express();
control.use(express.json({ limit: "32kb" }));
async function link() {
  return prisma.comparisonLink.findFirstOrThrow({ where: { userId: user, revoked: false } });
}
async function raw(remote: string, body: unknown) {
  return new Promise<number>((resolve, reject) => {
    const r = https.request(
      `${remote}/api/v1/comparison-peer`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      }
    );
    r.on("error", reject);
    r.end(JSON.stringify(body));
  });
}
control.post("/", async (req, res) => {
  try {
    const p = req.body;
    let result: unknown;
    switch (p.action) {
      case "info": {
        const local = await loadIdentity();
        result = { origin: local.origin, publicKey: local.publicKey, device: device.device.public };
        break;
      }
      case "peer":
        await prisma.comparisonPeer.upsert({
          where: { origin: p.origin },
          create: {
            origin: p.origin,
            publicKey: p.publicKey,
            enabled: true,
            verifiedAt: new Date(),
          },
          update: { publicKey: p.publicKey, enabled: p.enabled !== false, verifiedAt: new Date() },
        });
        result = { ok: true };
        break;
      case "ping":
        result = await exchange(p.origin, { action: "ping" });
        break;
      case "invite":
        result = await invite(user);
        break;
      case "claim":
        result = await claim(user, { ...p.invite, label: "Sandbox friend" });
        break;
      case "confirm": {
        const l = (await listLinks(user))[0];
        await changeLink(user, l.id, "confirm", "Sandbox friend", l.code);
        result = { ok: true };
        break;
      }
      case "devices":
        result = await ask(await link(), { operation: "devices", audience: "" });
        break;
      case "publish": {
        const l = await link();
        const recipient = (
          (await ask(l, { operation: "devices", audience: "" })) as PublicDevice[]
        )[0];
        const grant = await saveGrant(user, l.id, "", scope);
        const context = {
          version: 2 as const,
          id: randomUUID(),
          channel: l.channel,
          audience: "",
          revision: grant.revision,
          sender: device.device.public.fingerprint,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
        const crypto = await createPublication(device.device, context, [recipient]);
        await beginPublication(user, l.id, context);
        const sha = createHash("sha256");
        const count = p.chunks ?? 1;
        if (!Number.isInteger(count) || count < 1 || count > 1024) throw Error("test bound");
        for (let n = 0; n < count; n++) {
          const bytes = new Uint8Array(256 * 1024).fill(n % 251);
          sha.update(bytes);
          const part = await crypto.chunk(bytes);
          await putChunk(user, context.id, part);
          if (n === 0) await putChunk(user, context.id, part); // Lost acknowledgement: retry identical chunk.
        }
        if (!p.incomplete) await finishPublication(user, context.id, await crypto.finish());
        result = {
          id: context.id,
          size: count * 256 * 1024,
          sha256: sha.digest("hex"),
          incomplete: !!p.incomplete,
        };
        break;
      }
      case "read": {
        const l = await link();
        const request = {
          operation: "read" as const,
          audience: "",
          recipient: device.device.public.fingerprint,
        };
        const head = (await ask(l, request)) as { sender: PublicDevice; manifest: Manifest } | null;
        if (!head) {
          result = null;
          break;
        }
        // The runner transfers the sender fingerprint independently of the peer response.
        if (head.sender.fingerprint !== p.pinnedSender) throw Error("unverified sender");
        const decrypt = await openPublication(device.device, head.sender, head.manifest, {
          channel: l.channel,
          audience: "",
        });
        const sha = createHash("sha256");
        let size = 0;
        for (let part = 0; part < head.manifest.digests.length; part++) {
          const chunk = (await ask(l, {
            ...request,
            publication: head.manifest.context.id,
            part,
          })) as { bytes: string };
          const bytes = await decrypt(part, chunk.bytes);
          sha.update(bytes);
          size += bytes.length;
        }
        result = { size, sha256: sha.digest("hex") };
        break;
      }
      case "revoke-grant":
        await revokeGrant(user, (await link()).id, "");
        result = { ok: true };
        break;
      case "revoke-device":
        await revokeDevice(user, device.device.public.id);
        result = { ok: true };
        break;
      case "new-device":
        device = await generateDevice("Sandbox rotated device");
        await registerDevice(user, device.device.public);
        result = { device: device.device.public };
        break;
      case "unavailable":
        unavailable = !!p.value;
        result = { ok: true };
        break;
      case "replay": {
        const signed = envelope({ action: "ping" }, p.origin, await loadIdentity());
        result = {
          first: await raw(p.origin, signed),
          second: await raw(p.origin, signed),
          tampered: await raw(p.origin, { ...signed, nonce: "a".repeat(64) }),
        };
        break;
      }
      case "legacy":
        result = await exchange(p.origin, {
          action: "read",
          channel: (await link()).channel,
          audience: "",
          year: null,
        });
        break;
      case "wrong-pin": {
        const peer = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: p.origin } });
        const wrong = generateKeyPairSync("ed25519")
          .publicKey.export({ type: "spki", format: "pem" })
          .toString();
        await prisma.comparisonPeer.update({
          where: { origin: p.origin },
          data: { publicKey: wrong },
        });
        let refused = false;
        try {
          await exchange(p.origin, { action: "ping" });
        } catch {
          refused = true;
        } finally {
          await prisma.comparisonPeer.update({
            where: { origin: p.origin },
            data: { publicKey: peer.publicKey },
          });
        }
        result = { refused };
        break;
      }
      default:
        throw Error("unknown QA action");
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "refused" });
  }
});
async function main() {
  user = (
    await prisma.user.create({
      data: {
        username: `federation-sandbox-${randomUUID()}`,
        passwordHash: "synthetic-not-a-login",
      },
    })
  ).id;
  await prisma.userSettings.create({
    data: { userId: user, enabledDomains: scope.domains, data: {} },
  });
  // Get the singleton through the service so its normal defaults are respected.
  const { updateInstanceSettings } =
    await import("../../backend/src/services/instanceSettingsService");
  await updateInstanceSettings({ betaFeaturesEnabled: true });
  // The server identity lives in the instance settings (FEDERATION_* are no longer read).
  const { ensureAdminSettingsRow } = await import("../../backend/src/services/adminSettingsRow");
  const { encryptApiKey } = await import("../../backend/src/utils/encryption");
  await prisma.adminSettings.update({
    where: { id: await ensureAdminSettingsRow() },
    data: {
      federationEnabled: true,
      federationOrigin: process.env.SANDBOX_PUBLIC_ORIGIN!,
      federationPrivateKey: encryptApiKey(fs.readFileSync(process.env.SANDBOX_KEY_FILE!, "utf8")),
    },
  });
  device = await generateDevice("Sandbox device");
  await registerDevice(user, device.device.public);
  server.listen(443, "0.0.0.0");
  control.listen(8080, "127.0.0.1", () => console.log("FEDERATION_SANDBOX_READY"));
}
void main().catch(() => {
  console.error("Sandbox startup failed");
  process.exitCode = 1;
});
