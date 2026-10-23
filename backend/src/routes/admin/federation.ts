/**
 * Admin: this server's federation identity and the peers it trusts (comparison rework
 * 2026-10-16). Mounted under /api/v1/admin/federation; the parent applies authenticate +
 * requireAdmin + requireWriteScope. Outside the published spec with the whole `admin` mount.
 * The peer routes moved here unchanged from the comparison router, where any admin
 * reached them through a user page.
 *
 * No rate limiter, like every route here (see `admin/index.ts`): all are admin-only and
 * cheap; the connection-file upload is capped at 64 KB and inflates one bounded entry.
 */
import { Router, type Response, type NextFunction } from "express";
import { generateKeyPairSync } from "crypto";
import multer, { MulterError } from "multer";
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
  buildConnectionFile,
  connectionFileName,
  CONNECTION_FILE_MAX_BYTES,
  readConnectionFile,
} from "../../services/federation/connectionFile";
import { parsePeerPublicKey } from "../../services/federation/peerKey";
import { holdPeerMemberships } from "../../services/sharing/federation/lifecycle";
import {
  federationSettingsSchema,
  peerOriginSchema,
  peerPinSchema,
  pingReplySchema,
  tripSharingSwitchSchema,
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
    select: { federationEnabled: true, federationOrigin: true, tripFederationEnabled: true },
  });
  const local = await currentIdentity();
  const peers = await prisma.comparisonPeer.findMany({ orderBy: { origin: "asc" } });
  return {
    source: local?.source ?? null,
    enabled: envOverrideActive() || row.federationEnabled,
    origin: local?.origin ?? row.federationOrigin,
    publicKey: local?.publicKey ?? null,
    fingerprint: local?.fingerprint ?? null,
    tripSharingEnabled: row.tripFederationEnabled,
    peers: peers.map((p) => ({
      origin: p.origin,
      fingerprint: hash(p.publicKey),
      enabled: p.enabled,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      leaderboardVersions: p.leaderboardVersions,
    })),
  };
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

/**
 * Trip sharing across servers on or off (spec 2026-10-20 F8). Its own endpoint, not a field of
 * `PUT /`: it is settable while FEDERATION_* env vars hold the identity, which `PUT /` refuses.
 */
router.put(
  "/trip-sharing",
  handle(async (req, res) => {
    const { enabled } = tripSharingSwitchSchema.parse(req.body);
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { tripFederationEnabled: enabled },
    });
    logger.info(
      { operation: "trip_federation_switched", enabled, userId: req.userId },
      "Trip sharing across servers switched"
    );
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
    const pem = parsePeerPublicKey(body.publicKey);
    if (!pem)
      throw comparisonError("COMPARISON_PEER_KEY_INVALID", 400, "Not an Ed25519 public key", {
        origin: body.origin,
      });
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
      // Leaderboard friendships (LeaderboardRemote) deliberately survive (controller ruling):
      // they are addressed by origin + channel, not by the key, and nothing flows over them
      // until the admin re-verifies the new pin (verifiedAt is reset below).
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
    // Trips shared across servers through it pause until each person confirms them again
    // (spec 2026-10-20 O9): a new key is a new party until someone says otherwise.
    if (previous && previous.publicKey !== pem) await holdPeerMemberships(body.origin, "repinned");
    else if (previous && !body.enabled) await holdPeerMemberships(body.origin, "peer-blocked");
    res.json(await state());
  })
);

/** The upload of `POST /connection-file/inspect`: one small file in the multipart field `file`. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONNECTION_FILE_MAX_BYTES, files: 1, fields: 0 },
});
const uploadFile = (req: AuthRequest, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(comparisonError("COMPARISON_CONNECTION_FILE_TOO_LARGE", 413, "The file is too large"));
      return;
    }
    next(err);
  });
};

/**
 * This server's identity as a file for the other admin. Read-only, so it is served under an
 * env-held identity too. Without a key and an address there is nothing to hand over.
 */
router.get(
  "/connection-file",
  handle(async (_req, res) => {
    const own = await currentIdentity();
    if (!own)
      throw comparisonError(
        "COMPARISON_FEDERATION_OFF",
        409,
        "No federation key or public address to put in a connection file"
      );
    const zip = buildConnectionFile(own, new Date());
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${connectionFileName(own.origin)}"`
    );
    // `private` on top of the /api no-store default: never a shared cache, never stored.
    res.setHeader("Cache-Control", "private, no-store");
    res.send(zip);
  })
);

/**
 * Reads another server's connection file and answers what it says — NEVER pins. The admin
 * compares the values over a second channel and pins them through `POST /peers`, which
 * checks them all again.
 */
router.post(
  "/connection-file/inspect",
  uploadFile,
  handle(async (req, res) => {
    if (!req.file)
      throw comparisonError("COMPARISON_CONNECTION_FILE_UNREADABLE", 422, "No file uploaded");
    const values = readConnectionFile(req.file.buffer);
    const own = await currentIdentity();
    const ownOrigin =
      own?.origin ??
      (
        await prisma.adminSettings.findUnique({
          where: { id: await ensureAdminSettingsRow() },
          select: { federationOrigin: true },
        })
      )?.federationOrigin;
    if (values.origin === ownOrigin)
      throw comparisonError(
        "COMPARISON_CONNECTION_FILE_SELF",
        422,
        "The file describes this server"
      );
    const known = await prisma.comparisonPeer.findUnique({
      where: { origin: values.origin },
      select: { publicKey: true },
    });
    res.json({
      ...values,
      existingPeer: known
        ? { fingerprint: hash(known.publicKey), sameKey: known.publicKey === values.publicKey }
        : null,
    });
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
    await holdPeerMemberships(origin, "peer-blocked");
    res.json({ suspended: true });
  })
);

export default router;
