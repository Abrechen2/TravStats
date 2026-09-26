/**
 * GET /api/v1/version — public, so the About section can show the right
 * version before login.
 *
 * Returns the runtime version (what the user sees) and the build version
 * baked into the image (for diagnostics, shown only when it differs), the
 * latest stable GitHub release for the update banner (network failures
 * degrade to `latestAvailable: null`, so air-gapped installs hide it), and the
 * tzdata release this server converts times with.
 *
 * `tzdata` is part of the time model's contract (ADR 0002 D3): a client whose
 * own zone database is older or newer than the server's can say so instead of
 * silently disagreeing about an offset after a political zone change.
 *
 * Lived inline in index.ts until the time model needed it documented; the
 * OpenAPI coverage guard only sees routers in the mount table.
 */

import { Router } from "express";
import { appVersion, buildVersion } from "../utils/version";

const router = Router();

router.get("/version", async (_req, res, next) => {
  try {
    const { getCachedLatestRelease, isUpdateAvailable } = await import("../services/updateChecker");
    const latest = await getCachedLatestRelease();

    res.json({
      version: appVersion,
      buildVersion,
      latestAvailable: latest?.latestAvailable ?? null,
      updateAvailable: latest ? isUpdateAvailable(appVersion, latest.latestAvailable) : false,
      releaseUrl: latest?.releaseUrl ?? null,
      releaseNotes: latest?.releaseNotes ?? null,
      publishedAt: latest?.publishedAt ?? null,
      // Absent only on a Node built without ICU — then there is no zone
      // database to name, and null says so rather than inventing a release.
      tzdata: process.versions.tz ?? null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
