/**
 * Admin: this server's federation identity and the peers it trusts (comparison rework
 * 2026-10-16). Mounted under /api/v1/admin/federation; the parent applies authenticate +
 * requireAdmin + requireWriteScope. Outside the published spec with the whole `admin` mount.
 * The peer routes moved here unchanged from the comparison router, where any admin
 * reached them through a user page.
 */
import { Router, type Response, type NextFunction } from "express";
import { createPublicKey, generateKeyPairSync } from "crypto";
import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import logger from "../../utils/logger";
import { encryptApiKey } from "../../utils/encryption";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import {
  envOverrideActive,
  loadIdentity,
  resetIdentityCache,
  type Identity,
} from "../../services/federation/identity";
import { exchange, hash, PeerRefusal } from "../../services/federation/security";
import { comparisonError } from "../../services/comparison/errors";
import {
  federationSettingsSchema,
  peerOriginSchema,
  peerPinSchema,
  pingReplySchema,
  type FederationState,
} from "../../schemas/federationAdmin";

const router = Router();
type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

async function currentIdentity(): Promise<Identity | null> {
  try {
    return await loadIdentity();
  } catch (error) {
    if (error instanceof PeerRefusal) return null;
    throw error;
  }
}

async function state(): Promise<FederationState> {
  const id = await ensureAdminSettingsRow();
  const row = await prisma.adminSettings.findUniqueOrThrow({
    where: { id },
    select: { federationEnabled: true, federationOrigin: true },
  });
  const local = await currentIdentity();
  const peers = await prisma.comparisonPeer.findMany({ orderBy: { origin: "asc" } });
  return {
    source: local?.source ?? null,
    enabled: envOverrideActive() || row.federationEnabled,
    origin: local?.origin ?? row.federationOrigin,
    publicKey: local?.publicKey ?? null,
    fingerprint: local?.fingerprint ?? null,
    peers: peers.map((p) => ({
      origin: p.origin,
      fingerprint: hash(p.publicKey),
      enabled: p.enabled,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      leaderboardVersions: p.leaderboardVersions,
    })),
  };
}

/**
 * A pasted PEM often arrives with its newlines flattened to spaces or dropped (single-line
 * inputs, chat clients, e-mail). Re-wrap header, 64-column body and footer so
 * createPublicKey sees what it requires; anything that is not a PEM block passes unchanged
 * and is refused by the key parse as before.
 */
export function normalisePastedPem(input: string): string {
  const match = /^\s*-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----\s*$/.exec(input);
  if (!match) return input;
  const body = match[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${match[1]}-----\n${lines.join("\n")}\n-----END ${match[1]}-----\n`;
}

async function requirePeer(origin: string): Promise<void> {
  if (!(await prisma.comparisonPeer.findUnique({ where: { origin }, select: { origin: true } })))
    throw comparisonError("COMPARISON_PEER_UNKNOWN", 404, "No such peer is pinned", { origin });
}

const envHoldsIdentity = () =>
  comparisonError(
    "COMPARISON_FEDERATION_ENV",
    409,
    "The server identity is set by FEDERATION_* environment variables"
  );

router.get(
  "/",
  handle(async (_req, res) => {
    res.json(await state());
  })
);

router.put(
  "/",
  handle(async (req, res) => {
    if (envOverrideActive()) throw envHoldsIdentity();
    const body = federationSettingsSchema.parse(req.body);
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { federationEnabled: body.enabled, federationOrigin: body.origin },
    });
    resetIdentityCache();
    res.json(await state());
  })
);

router.post(
  "/key",
  handle(async (req, res) => {
    if (envOverrideActive()) throw envHoldsIdentity();
    const pem = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { federationPrivateKey: encryptApiKey(pem) },
    });
    resetIdentityCache();
    // Peers pinned the old key: they refuse this server until their admins pin the new one.
    logger.info(
      { operation: "federation_key_generated", userId: req.userId },
      "Federation key generated"
    );
    res.json(await state());
  })
);

router.post(
  "/peers",
  handle(async (req, res) => {
    const body = peerPinSchema.parse(req.body);
    const own = await currentIdentity();
    if (own && body.origin === own.origin)
      throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "A server cannot pin itself");
    let pem: string;
    try {
      const key = createPublicKey(normalisePastedPem(body.publicKey));
      if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
      pem = key.export({ type: "spki", format: "pem" }).toString();
    } catch {
      throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "Not an Ed25519 public key", {
        origin: body.origin,
      });
    }
    if (hash(pem) !== body.fingerprint)
      throw comparisonError(
        "COMPARISON_PEER_KEY_INVALID",
        400,
        "Fingerprint does not match the key",
        {
          origin: body.origin,
        }
      );
    const previous = await prisma.comparisonPeer.findUnique({ where: { origin: body.origin } });
    if (previous && previous.publicKey !== pem) {
      // A replaced key ends every E2E friendship through it, exactly as before the move.
      await prisma.comparisonLink.updateMany({
        where: { origin: body.origin },
        data: { revoked: true },
      });
    }
    await prisma.comparisonPeer.upsert({
      where: { origin: body.origin },
      create: { origin: body.origin, publicKey: pem, enabled: body.enabled },
      update: { publicKey: pem, enabled: body.enabled, verifiedAt: null, leaderboardVersions: [] },
    });
    res.json(await state());
  })
);

router.post(
  "/peers/verify",
  handle(async (req, res) => {
    const { origin } = peerOriginSchema.parse(req.body);
    await requirePeer(origin);
    let reply;
    try {
      reply = pingReplySchema.parse(await exchange(origin, { action: "ping" }));
    } catch (error) {
      throw comparisonError(
        "COMPARISON_PEER_UNREACHABLE",
        502,
        "The peer did not answer the ping",
        {
          origin,
          kind: error instanceof PeerRefusal ? error.kind : "error",
        }
      );
    }
    await prisma.comparisonPeer.update({
      where: { origin },
      data: { verifiedAt: new Date(), leaderboardVersions: reply.leaderboard ?? [] },
    });
    res.json({ verified: true });
  })
);

router.post(
  "/peers/suspend",
  handle(async (req, res) => {
    const { origin } = peerOriginSchema.parse(req.body);
    await requirePeer(origin);
    await prisma.comparisonPeer.update({
      where: { origin },
      data: { enabled: false, verifiedAt: null },
    });
    res.json({ suspended: true });
  })
);

export default router;
