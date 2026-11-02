/**
 * Mail intake (forgejo#313): booking mails arrive by themselves. Mounted at
 * `/api/v1/mail-intake`. Bare response family (ADR 0001).
 *
 * The user's own routes sit at the top level; the instance mailbox behind the
 * forwarding addresses is admin-only under `/instance`. Everything is off until
 * a mailbox is saved AND switched on, and the admin can switch the whole
 * service off like any other external service.
 */
import { Router, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

import { authenticate, requireAdmin, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { userOrIpKey } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  idParamsSchema,
  instanceSourceBodySchema,
  personalSourceBodySchema,
  senderBodySchema,
  fileOriginalBodySchema,
} from "../schemas/mailIntake";
import { prisma } from "../db";
import {
  allowSenderOf,
  buildInbox,
  dismissMessage,
  fileOriginalWithEntry,
  retryMessage,
} from "../services/mailIntake/inbox";
import { runSource } from "../services/mailIntake/runSource";
import {
  addSender,
  buildStatus,
  deleteSource,
  issueAddress,
  offFor,
  removeSender,
  revokeAddress,
  saveSource,
  testSource,
  viewOf,
} from "../services/mailIntake/sourceSettings";

const router = Router();
router.use(authenticate);
router.use((req: AuthRequest, res: Response, next: NextFunction) =>
  req.method === "GET" ? next() : requireWriteScope(req, res, next)
);
router.use(rejectDemoWrites);

/** "Jetzt prüfen" and "Verbindung testen" open a socket to a third party: bounded per user. */
const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many mailbox checks, please try again later" },
  keyGenerator: userOrIpKey,
});

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const wrap =
  (handler: Handler) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

async function assertAllowed(userId: string): Promise<void> {
  if ((await offFor(userId)) !== null) {
    throw new AppError("Mail intake is switched off for this account", 409, "MAIL_INTAKE_OFF");
  }
}

router.get(
  "/",
  wrap(async (req, res) => void res.json(await buildStatus(req.userId!)))
);

router.put(
  "/source",
  wrap(async (req, res) => {
    await assertAllowed(req.userId!);
    const body = personalSourceBodySchema.parse(req.body);
    res.json(await saveSource(req.userId!, body));
  })
);

router.delete(
  "/source",
  wrap(async (req, res) => {
    await deleteSource(req.userId!);
    res.json({ ok: true });
  })
);

router.post(
  "/source/test",
  connectLimiter,
  wrap(async (req, res) => {
    await assertAllowed(req.userId!);
    res.json(await testSource(req.userId!));
  })
);

router.post(
  "/source/run",
  connectLimiter,
  wrap(async (req, res) => {
    await assertAllowed(req.userId!);
    const source = await prisma.mailIntakeSource.findUnique({ where: { userId: req.userId! } });
    if (!source) throw new AppError("No mailbox is set up", 404, "MAIL_SOURCE_NOT_FOUND");
    const result = await runSource(source.id);
    res.json({
      ran: result.ran,
      skipped: result.skipped ?? null,
      error: result.error ?? null,
      seen: result.seen,
      proposed: result.proposed,
    });
  })
);

router.post(
  "/address",
  wrap(async (req, res) => {
    await assertAllowed(req.userId!);
    res.json({ address: await issueAddress(req.userId!) });
  })
);

router.delete(
  "/address",
  wrap(async (req, res) => {
    await revokeAddress(req.userId!);
    res.json({ address: null });
  })
);

router.post(
  "/senders",
  wrap(async (req, res) => {
    await addSender(req.userId!, senderBodySchema.parse(req.body).address);
    res.json(await buildStatus(req.userId!));
  })
);

router.delete(
  "/senders/:id",
  wrap(async (req, res) => {
    await removeSender(req.userId!, idParamsSchema.parse(req.params).id);
    res.json(await buildStatus(req.userId!));
  })
);

router.get(
  "/inbox",
  wrap(async (req, res) => void res.json(await buildInbox(req.userId!)))
);

router.post(
  "/messages/:id/dismiss",
  wrap(async (req, res) => {
    await dismissMessage(req.userId!, idParamsSchema.parse(req.params).id);
    res.json({ ok: true });
  })
);

router.post(
  "/messages/:id/retry",
  wrap(async (req, res) => {
    await retryMessage(req.userId!, idParamsSchema.parse(req.params).id);
    res.json({ ok: true });
  })
);

router.post(
  "/messages/:id/file-original",
  wrap(async (req, res) => {
    const { openedAt } = fileOriginalBodySchema.parse(req.body);
    const entry = await fileOriginalWithEntry(
      req.userId!,
      idParamsSchema.parse(req.params).id,
      new Date(openedAt)
    );
    res.json({ entry });
  })
);

router.post(
  "/messages/:id/allow-sender",
  wrap(async (req, res) => {
    await allowSenderOf(req.userId!, idParamsSchema.parse(req.params).id);
    res.json({ ok: true });
  })
);

// ---- the instance mailbox (admin) ------------------------------------------------------------

router.get(
  "/instance",
  requireAdmin,
  wrap(async (_req, res) => {
    const source = await prisma.mailIntakeSource.findFirst({ where: { userId: null } });
    res.json({ source: source ? viewOf(source) : null });
  })
);

router.put(
  "/instance",
  requireAdmin,
  wrap(async (req, res) => {
    const body = instanceSourceBodySchema.parse(req.body);
    res.json({ source: await saveSource(null, body) });
  })
);

router.delete(
  "/instance",
  requireAdmin,
  wrap(async (_req, res) => {
    await deleteSource(null);
    res.json({ ok: true });
  })
);

router.post(
  "/instance/test",
  requireAdmin,
  connectLimiter,
  wrap(async (_req, res) => void res.json(await testSource(null)))
);

export default router;
