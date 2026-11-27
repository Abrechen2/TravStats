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
import {
  assertMaintenanceCapable,
  candidateStops,
  offersMaintenance,
  probeHello,
  runMaintenance,
} from "../../services/plugins/maintenance";
import {
  MAINTENANCE_MAX_QUERY,
  MAINTENANCE_MAX_ROWS,
  MAINTENANCE_FILTERS,
  MAINTENANCE_SOURCES,
} from "../../services/plugins/contract";
import type { Precision } from "../../services/plugins/registry";
import {
  readMaintenanceInbox,
  refreshAccountCaches,
  refreshMaintenanceCache,
} from "../../services/plugins/maintenanceCache";
import { setPluginListEnabled, syncPluginList } from "../../services/places/pluginLists";

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

/** Maintenance writes reach an outside server and change its data: bounded per account. */
const maintenanceLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: patAwareMax(120),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});

const localeOf = (req: AuthRequest): "de" | "en" => (req.query.lang === "en" ? "en" : "de");

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "Jetzt aktualisieren" asks every plugin live: a few times an hour per account. */
const refreshLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: patAwareMax(6),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});
const localeValue = (v: unknown): "de" | "en" => (v === "en" ? "en" : "de");

/** The inbox's Plugins tab: the cached proposals and notices of every plugin (no live call). */
router.get("/maintenance/inbox", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await readMaintenanceInbox(req.userId!));
  } catch (error) {
    next(error);
  }
});

/** "Jetzt aktualisieren": ask every enabled plugin live, then answer the fresh copy. */
router.post(
  "/maintenance/refresh",
  refreshLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { locale } = z
        .object({ locale: z.enum(["de", "en"]).optional() })
        .strict()
        .parse(req.body ?? {});
      await refreshAccountCaches(req.userId!, localeValue(locale));
      res.json(await readMaintenanceInbox(req.userId!));
    } catch (error) {
      next(error);
    }
  }
);

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
router.post("/reask", probeLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    // The answers are marked, never deleted: the hourly and daily limits keep counting every
    // call ever made, so asking again can never buy a plugin more calls (security review).
    await prisma.$transaction([
      prisma.suggestionPluginCall.updateMany({
        data: { invalidatedAt: new Date() },
        where: {
          invalidatedAt: null,
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
      if (outcome === "blocked") throw new AppError("service_off", 409, "SERVICE_DISABLED");
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

/**
 * The plugin's announced capabilities (its signed hello); `[]` when it has no
 * hello. `error` names a failed hello (auth = signature refused, unreachable, …).
 */
router.get("/:id/capabilities", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const plugin = await ownPlugin(req.userId!, z.string().uuid().parse(req.params.id));
    const locale = localeOf(req);
    if (!plugin.enabled || (await egressBlock(PLUGIN_SERVICE_ID)))
      return res.json({
        capabilities: [],
        maintenance: false,
        error: null,
        list: await syncPluginList(req.userId!, plugin, null, locale),
      });
    const probe = await probeHello(plugin);
    const hello = probe.kind === "ok" ? probe.hello : null;
    res.json({
      capabilities: hello?.capabilities ?? [],
      maintenance: offersMaintenance(probe),
      error: probe.kind === "failed" ? probe.reason : null,
      list: await syncPluginList(req.userId!, plugin, hello, locale),
    });
  } catch (error) {
    next(error);
  }
});

/** "Orte dieses Plugins als Liste führen": on creates (or keeps) the list, off keeps it as a normal list. */
router.put("/:id/list", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const plugin = await ownPlugin(req.userId!, z.string().uuid().parse(req.params.id));
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const probe =
      enabled && plugin.enabled && !(await egressBlock(PLUGIN_SERVICE_ID))
        ? await probeHello(plugin)
        : null;
    res.json(
      await setPluginListEnabled(
        req.userId!,
        plugin,
        enabled,
        probe?.kind === "ok" ? probe.hello : null,
        localeOf(req)
      )
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Location maintenance (spec "Maintenance"). Owner of the registration only:
 * `ownPlugin` finds a plugin of THIS account, and the candidate stops sent with
 * the proposals request are this account's own.
 */
async function maintainedPlugin(req: AuthRequest) {
  const plugin = await ownPlugin(req.userId!, z.string().uuid().parse(req.params.id));
  const block = await egressBlock(PLUGIN_SERVICE_ID);
  if (block) throw new AppError(block, 409, "SERVICE_DISABLED");
  await assertMaintenanceCapable(plugin);
  return plugin;
}

const rowIdSchema = z.string().min(1).max(64);

/** What the user confirmed; the plugin writes exactly these (coordinates, and the text fields given). */
const applyValues = {
  rowId: rowIdSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  street: z.string().trim().min(1).max(200).optional(),
  postcode: z.string().trim().min(1).max(32).optional(),
  town: z.string().trim().min(1).max(200).optional(),
};

/** Search and paging of the maintenance list; the plugin does both (its list is longer than one page). */
const maintenanceListQuery = z
  .object({
    q: z.string().trim().max(MAINTENANCE_MAX_QUERY).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(MAINTENANCE_MAX_ROWS).optional(),
    /** Passed through to the plugin; its answer's `filter` says whether it applied it. */
    filter: z.enum(MAINTENANCE_FILTERS).optional(),
  })
  .transform(({ q, ...rest }) => ({ ...rest, ...(q ? { query: q } : {}) }));

router.get(
  "/:id/maintenance",
  // The list reloads after every apply/undo/ignore: the probe limit (20 per
  // 10 min) would lock a user out halfway through an archive.
  maintenanceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const plugin = await maintainedPlugin(req);
      const { stops, withheld } = await candidateStops(req.userId!, plugin.precision as Precision);
      const locale = req.query.locale === "en" ? "en" : "de";
      const paging = maintenanceListQuery.parse(req.query);
      const data = await runMaintenance(plugin, "proposals", { locale, stops, ...paging });
      res.json({ ...data, stopsSent: stops.length, stopsWithheld: withheld });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:id/maintenance/notices",
  maintenanceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const plugin = await maintainedPlugin(req);
      const { stops, withheld } = await candidateStops(req.userId!, plugin.precision as Precision);
      const locale = req.query.locale === "en" ? "en" : "de";
      // limit 1: only the counts and the notices are wanted, not the row list.
      const data = await runMaintenance(plugin, "proposals", { locale, stops, limit: 1 });
      res.json({
        notices: data.notices ?? [],
        noticeCount: data.noticeCount ?? 0,
        totalRows: data.totalRows ?? 0,
        stopsSent: stops.length,
        stopsWithheld: withheld,
      });
    } catch (error) {
      next(error);
    }
  }
);

/** Called when the user confirms in the dialog: a single-use ticket for exactly the values shown. */
router.post(
  "/:id/maintenance/confirm",
  maintenanceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("undo"), undoId: z.string().min(1).max(64) }).strict(),
          z.object({ kind: z.literal("apply"), ...applyValues }).strict(),
        ])
        .parse(req.body);
      const plugin = await maintainedPlugin(req);
      res.json(await runMaintenance(plugin, "confirm", body));
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:id/maintenance/apply",
  maintenanceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          ...applyValues,
          source: z.enum(MAINTENANCE_SOURCES),
          token: z.string().min(1).max(200),
        })
        .strict()
        .parse(req.body);
      const plugin = await maintainedPlugin(req);
      const answer = await runMaintenance(plugin, "apply", body);
      // The inbox's copy follows the write at once (it never throws; a failure is stored).
      await refreshMaintenanceCache(plugin);
      res.json(answer);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:id/maintenance/undo",
  maintenanceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ undoId: z.string().min(1).max(64), token: z.string().min(1).max(200) })
        .strict()
        .parse(req.body);
      const plugin = await maintainedPlugin(req);
      const answer = await runMaintenance(plugin, "undo", body);
      // The inbox's copy follows the write at once (it never throws; a failure is stored).
      await refreshMaintenanceCache(plugin);
      res.json(answer);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:id/maintenance/ignore",
  maintenanceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ rowId: rowIdSchema, ignored: z.boolean() }).strict().parse(req.body);
      const plugin = await maintainedPlugin(req);
      const answer = await runMaintenance(plugin, "ignore", body);
      // The inbox's copy follows the write at once (it never throws; a failure is stored).
      await refreshMaintenanceCache(plugin);
      res.json(answer);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
