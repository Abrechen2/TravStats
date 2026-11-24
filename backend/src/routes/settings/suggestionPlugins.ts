/**
 * An account's suggestion plugins (spec 2026-11-23-plugins-and-calendar.md,
 * Part B). Mounted under `/api/v1/settings/suggestion-plugins`, whose parent
 * already applies `authenticate` + `requireWriteScope` and the demo guard.
 *
 * The secret comes back exactly twice in a plugin's life: on create and on
 * rotate. A failed test answers 400 with the outcome reason in `error` and
 * `PLUGIN_FAILED` in `code`.
 */
import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "../../schemas/zod";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { patAwareMax, userOrIpKey } from "../../middleware/rateLimit";
import { prisma } from "../../db";
import { egressBlock } from "../../services/externalServices/egress";
import { startJob } from "../../services/jobs/jobRegistry";
import { assertTravTrackDerivationAllowed } from "../../services/locationEvidence/allowed";
import {
  PLUGIN_SERVICE_ID,
  createPlugin,
  deletePlugin,
  listPlugins,
  ownPlugin,
  pluginCreateSchema,
  pluginUpdateSchema,
  pluginView,
  rotateSecret,
  targetOf,
  updatePlugin,
} from "../../services/plugins/registry";
import { askPlugin, SAME_STOP_M } from "../../services/plugins/ask";
import { helloPlugin } from "../../services/plugins/client";
import { assertBackfillRange, prepareBackfill, runBackfill } from "../../services/plugins/backfill";

const router = Router();

/** Test calls and backfills reach an outside server. */
const probeLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: patAwareMax(20),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * The synthetic stop of the test button: a public square (Marienplatz,
 * Munich), a fixed hour — no account data at all.
 */
export const TEST_STOP = {
  fromMs: Date.UTC(2026, 0, 15, 10, 0),
  untilMs: Date.UTC(2026, 0, 15, 11, 0),
  lat: 48.13743,
  lon: 11.57549,
  zone: "Europe/Berlin",
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const plugins = await listPlugins(req.userId!);
    res.json({ plugins: plugins.map(pluginView), blocked: await egressBlock(PLUGIN_SERVICE_ID) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { plugin, secret } = await createPlugin(req.userId!, pluginCreateSchema.parse(req.body));
    res.status(201).json({ plugin: pluginView(plugin), secret });
  } catch (error) {
    next(error);
  }
});

/** "Neu fragen" on one finding: its plugins' recorded answers are forgotten and it is owed again. */
router.post("/reask", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stayId } = z.object({ stayId: z.string().uuid() }).strict().parse(req.body);
    const userId = req.userId!;
    const stay = await prisma.dawarichStay.findFirst({
      where: { id: stayId, userId, status: "pending", provider: "travtrack" },
    });
    if (!stay) throw new AppError("Finding not found", 404);
    const plugins = await prisma.suggestionPlugin.findMany({
      where: { userId, enabled: true },
      select: { id: true },
    });
    const ids = plugins.map((p) => p.id);
    const slack = (SAME_STOP_M + 1000) / 111_320;
    await prisma.$transaction([
      prisma.suggestionPluginCall.deleteMany({
        where: {
          pluginId: { in: ids },
          outcome: { in: ["ok", "empty"] },
          stopStartAt: { lte: stay.sourceEndAt },
          stopEndAt: { gte: stay.sourceStartAt },
          lat: { gte: stay.sourceLat - slack, lte: stay.sourceLat + slack },
          lon: { gte: stay.sourceLon - slack * 2, lte: stay.sourceLon + slack * 2 },
        },
      }),
      prisma.dawarichStay.update({
        where: { id: stay.id },
        data: {
          evidence: {
            ...((stay.evidence ?? {}) as Record<string, unknown>),
            pluginsPending: ids,
          } as object,
        },
      }),
    ]);
    res.json({ pending: ids.length });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    res.json(pluginView(await updatePlugin(req.userId!, id, pluginUpdateSchema.parse(req.body))));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await deletePlugin(req.userId!, z.string().uuid().parse(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/:id/rotate", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secret = await rotateSecret(req.userId!, z.string().uuid().parse(req.params.id));
    res.json({ secret });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/test",
  probeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const plugin = await ownPlugin(req.userId!, z.string().uuid().parse(req.params.id));
      const block = await egressBlock(PLUGIN_SERVICE_ID);
      if (block) throw new AppError(block, 409, "SERVICE_DISABLED");
      // A test is asked for even while the plugin waits out a failure: that is what it is for.
      const outcome = await askPlugin({ ...plugin, retryAt: null }, TEST_STOP, "test");
      if (outcome === "held" || outcome === "known")
        throw new AppError("rateLimited", 400, "PLUGIN_FAILED");
      if (outcome.kind === "failed") throw new AppError(outcome.reason, 400, "PLUGIN_FAILED");
      const hello = await helloPlugin(await targetOf(plugin));
      res.json({
        ok: true,
        outcome: outcome.kind,
        latencyMs: outcome.latencyMs,
        version: outcome.version,
        first: outcome.kind === "ok" ? outcome.suggestions[0] : null,
        hello,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:id/backfill",
  probeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const id = z.string().uuid().parse(req.params.id);
      const { from, to } = z.object({ from: day, to: day }).strict().parse(req.body);
      assertBackfillRange(from, to);
      await prepareBackfill(userId, id);
      await assertTravTrackDerivationAllowed(userId);
      if (await egressBlock(PLUGIN_SERVICE_ID))
        throw new AppError("Plugins are switched off", 409, "SERVICE_DISABLED");
      const job = startJob("plugins.backfill", userId, (progress) =>
        runBackfill(userId, id, from, to, progress)
      );
      res.status(202).json({ jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
