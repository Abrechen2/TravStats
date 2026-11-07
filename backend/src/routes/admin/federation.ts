/**
 * Admin: this server's federation identity and the peers it trusts (comparison rework
 * 2026-10-16). Mounted under /api/v1/admin/federation; the parent applies authenticate +
 * requireAdmin + requireWriteScope. Outside the published spec with the whole `admin` mount.
 * The peer routes moved here unchanged from the comparison router, where any admin
 * reached them through a user page.
 *
 * `POST /peers` carries its own limiter (a PAT-driven Companion reaches it); the rest have none, like
 * every route here (see `admin/index.ts`): all are admin-only and
 * cheap; the connection-file upload is capped at 64 KB and inflates one bounded entry.
 */
import { Router, type Response, type NextFunction } from "express";
import { generateKeyPairSync } from "crypto";
import multer, { MulterError } from "multer";
import { prisma } from "../../db";
import { peerPinLimiter } from "../../middleware/peerPinLimiter";
import type { AuthRequest } from "../../middleware/auth";
import logger from "../../utils/logger";
import { encryptApiKey } from "../../utils/encryption";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import {
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
  readServerQrPayload,
} from "../../services/federation/connectionFile";
import { pinPeer } from "../../services/federation/pinning";
import {
  approveAdmission,
  declineAdmission,
  listAdmissions,
} from "../../services/federation/admission";
import { uuidParamSchema } from "../../schemas/comparison";
import { holdAllConnections } from "../../services/sharing/federation/connections/hooks";
import { holdPeerMemberships } from "../../services/sharing/federation/lifecycle";
import {
  federationSettingsSchema,
  peerOriginSchema,
  peerPinFromFileSchema,
  peerPinFromQrSchema,
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
    select: {
      federationEnabled: true,
      federationOrigin: true,
      federationPrivateKey: true,
      tripFederationEnabled: true,
    },
  });
  const local = await currentIdentity();
  const peers = await prisma.comparisonPeer.findMany({ orderBy: { origin: "asc" } });
  return {
    source: local?.source ?? null,
    enabled: row.federationEnabled,
    origin: local?.origin ?? row.federationOrigin,
    publicKey: local?.publicKey ?? null,
    fingerprint: local?.fingerprint ?? null,
    hasKey: Boolean(row.federationPrivateKey),
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

router.get(
  "/",
  handle(async (_req, res) => {
    res.json(await state());
  })
);

router.put(
  "/",
  handle(async (req, res) => {
    const body = federationSettingsSchema.parse(req.body);
    const id = await ensureAdminSettingsRow();
    const before = await prisma.adminSettings.findUnique({
      where: { id },
      select: { federationOrigin: true },
    });
    // Peers address this server by its origin: a different one is a new party to them, so their
    // side has re-pinned or lost us; do locally what a re-pin does (first-time set: nothing to
    // hold). The hold comes FIRST: if the write below then fails, the connections are merely
    // reconfirm-able, and a retry still sees the old origin and holds again.
    if (before?.federationOrigin && before.federationOrigin !== body.origin)
      await holdAllConnections();
    await prisma.adminSettings.update({
      where: { id },
      data: { federationEnabled: body.enabled, federationOrigin: body.origin },
    });
    resetIdentityCache();
    res.json(await state());
  })
);

/**
 * Trip sharing across servers on or off (spec 2026-10-20 F8). Its own endpoint, not a field of
 * `PUT /`: it is settable on its own, independent of `PUT /`.
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
    const pem = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    // Peers pinned the old key: they refuse this server until their admins pin the new one, and
    // their re-pin sends their side of every connection to reconfirm. Mirror that here, or this
    // side keeps showing active connections and plan members the peers have already ended. Held
    // before the key is written, so a failure in between fails closed and a retry holds again.
    await holdAllConnections();
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { federationPrivateKey: encryptApiKey(pem) },
    });
    resetIdentityCache();
    logger.info(
      { operation: "federation_key_generated", userId: req.userId },
      "Federation key generated"
    );
    res.json(await state());
  })
);

/** What the pin route answers: the federation state plus the peer exactly as the server stored it. */
async function pin(
  body: { origin: string; publicKey: string; fingerprint: string; enabled: boolean },
  res: Response
): Promise<void> {
  const pem = await pinPeer(body);
  const full = await state();
  // `peer` and `computedFingerprint` serve the Companion (spec 2026-11-02 §6): the fingerprint
  // is the one THIS server hashed from the key, to show beside the one printed in the QR.
  res.json({
    ...full,
    peer: full.peers.find((p) => p.origin === body.origin) ?? null,
    computedFingerprint: hash(pem),
  });
}

/**
 * Pins a peer from explicit values (the web form), a scanned QR payload `{qr}` or a connection
 * file as base64 `{connectionFile}` (the Companion). All three are validated alike; a pin is
 * unverified (`verifiedAt: null`) until `POST /peers/verify` succeeds.
 */
router.post(
  "/peers",
  peerPinLimiter,
  handle(async (req, res) => {
    const raw: unknown = req.body;
    if (raw && typeof raw === "object" && "qr" in raw) {
      const { qr, enabled } = peerPinFromQrSchema.parse(raw);
      await pin({ ...readServerQrPayload(qr), enabled }, res);
      return;
    }
    if (raw && typeof raw === "object" && "connectionFile" in raw) {
      const { connectionFile, enabled } = peerPinFromFileSchema.parse(raw);
      const bytes = Buffer.from(connectionFile, "base64");
      await pin({ ...readConnectionFile(bytes), enabled }, res);
      return;
    }
    await pin(peerPinSchema.parse(raw), res);
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
    // Two files, another field name, extra fields: not the one file this route reads.
    if (err instanceof MulterError) {
      next(
        comparisonError("COMPARISON_CONNECTION_FILE_UNREADABLE", 400, "Not one file in `file`", {
          multer: err.code,
        })
      );
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

/** The admission queue (spec 2026-11-07 §6.2): servers waiting to be admitted, in both directions. */
router.get(
  "/admissions",
  handle(async (_req, res) => {
    res.json({ admissions: await listAdmissions() });
  })
);

router.post(
  "/admissions/:id/approve",
  handle(async (req, res) => {
    res.json(await approveAdmission(uuidParamSchema.parse(req.params.id), req.userId!));
  })
);

router.post(
  "/admissions/:id/decline",
  handle(async (req, res) => {
    res.json(await declineAdmission(uuidParamSchema.parse(req.params.id), req.userId!));
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
