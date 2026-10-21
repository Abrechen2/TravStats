import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { templateRepoLimiter } from "../../middleware/templateRepoLimiter";
import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { templateRegistry } from "../../services/parsers/templates/registry";
import { FetchJsonError, fetchJson } from "../../services/parsers/templates/fetchJson";
import { templateIndexSchema } from "../../services/parsers/templates/v2/envelope";
import {
  checkTemplateRepoUrl,
  DEFAULT_TEMPLATE_REPO_BASE_URL,
  type TemplateRepoUrlProblem,
} from "../../services/parsers/templates/v2/source";
import logger from "../../utils/logger";

/**
 * The template repository as an instance setting (forgejo#309). Mounted under
 * `/admin`, so `authenticate` + `requireAdmin` + `requireWriteScope` already
 * ran; bare family, like every admin router.
 *
 * - `GET  /admin/template-repo`       what is stored, and what the sync reads
 * - `PUT  /admin/template-repo`       store (or clear) it and re-sync at once
 * - `POST /admin/template-repo/test`  read `<url>/index.json` and say how it went
 *
 * The stored URL wins over `TEMPLATE_REPO_BASE_URL`. A new URL whose index
 * cannot be read changes nothing that is active: the last good set keeps
 * serving (the loader's rule), and the answer says so.
 */
const router = Router();

/** The test's verdict, as a code the admin UI words in DE/EN. */
export type TemplateRepoTestResult =
  | "ok"
  | "invalidUrl"
  | "httpsRequired"
  | "credentialsInUrl"
  | "unreachable"
  | "tooLarge"
  | "notAnIndex";

const PROBLEM_RESULT: Record<TemplateRepoUrlProblem, TemplateRepoTestResult> = {
  invalid_url: "invalidUrl",
  unsupported_protocol: "invalidUrl",
  credentials_in_url: "credentialsInUrl",
  https_required: "httpsRequired",
};

const urlBody = z.object({ url: z.string().trim().max(500).nullable() }).strict();

async function storedUrl(): Promise<string | null> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { templateRepoBaseUrl: true },
  });
  return row?.templateRepoBaseUrl ?? null;
}

function describe(stored: string | null) {
  const effective = templateRegistry.getRepository();
  return {
    url: stored,
    effectiveUrl: effective.url,
    origin: effective.origin,
    defaultUrl: DEFAULT_TEMPLATE_REPO_BASE_URL,
  };
}

/** The URL as stored, or the 400 that names why it cannot be. */
function normalised(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  const check = checkTemplateRepoUrl(raw);
  if (check.ok) return check.url;
  throw new AppError(
    `Invalid template repository URL: ${check.problem}`,
    400,
    check.problem === "https_required"
      ? "TEMPLATE_REPO_URL_HTTPS_REQUIRED"
      : "TEMPLATE_REPO_URL_INVALID",
    "url"
  );
}

router.get("/template-repo", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(describe(await storedUrl()));
  } catch (err) {
    next(err);
  }
});

router.put(
  "/template-repo",
  templateRepoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = urlBody.safeParse(req.body);
      if (!parsed.success) throw new AppError("Send { url: string | null }", 400);
      const url = normalised(parsed.data.url);
      const id = await ensureAdminSettingsRow();
      await prisma.adminSettings.update({ where: { id }, data: { templateRepoBaseUrl: url } });
      templateRegistry.useRepository(url);
      // A fresh sync from the new source, now: a changed URL that only took
      // effect at the next daily run would look like a setting that did not
      // stick. The sync never throws; its outcome is in the status.
      await templateRegistry.syncNow();
      const v2 = templateRegistry.getV2Status();
      logger.info(
        { origin: templateRegistry.getRepository().origin, index: v2.index },
        "Template repository changed by an admin — re-synced"
      );
      res.json({
        ...describe(url),
        sync: {
          index: v2.index,
          ranAt: v2.ranAt,
          active: v2.templates.filter((t) => t.state === "active").length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/template-repo/test",
  templateRepoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = urlBody.safeParse(req.body);
      if (!parsed.success) throw new AppError("Send { url: string | null }", 400);
      // An empty field tests what the sync reads without a stored URL.
      const raw = parsed.data.url || templateRegistry.getRepository().url;
      const check = checkTemplateRepoUrl(raw);
      if (!check.ok) {
        res.json({ result: PROBLEM_RESULT[check.problem], templates: null });
        return;
      }
      let index: unknown;
      try {
        index = await fetchJson(`${check.url}/index.json`);
      } catch (err) {
        logger.info(
          { err: err instanceof Error ? err.message : String(err) },
          "Template repository test: index unreachable"
        );
        // A body over the fetcher's cap is a server answering, not a dead
        // one: say so, rather than send the admin checking the network.
        const tooLarge = err instanceof FetchJsonError && err.reason === "too_large";
        res.json({ result: tooLarge ? "tooLarge" : "unreachable", templates: null });
        return;
      }
      const read = templateIndexSchema.safeParse(index);
      res.json(
        read.success
          ? { result: "ok", templates: read.data.templates.length }
          : { result: "notAnIndex", templates: null }
      );
    } catch (err) {
      next(err);
    }
  }
);

export default router;
