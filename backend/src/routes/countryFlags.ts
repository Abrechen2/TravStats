import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { authenticate, AuthRequest } from "../middleware/auth";
import { countryFlagLimiter } from "../middleware/rateLimit";

/**
 * Country flags as SVG, served from the vendored MIT `flag-icons` package.
 *
 * The Companion draws a flag beside every country it lists and has no bundle
 * of its own to carry 270 files in two aspect ratios, so it asks here. Two
 * shapes: one flag by ISO code, and a batch of up to MAX_BATCH_CODES for a
 * list view, so N countries do not cost N round trips.
 *
 * The iso is the only thing a caller controls that reaches the filesystem.
 * It is checked against ISO_ALPHA2 BEFORE any path is built, and the built
 * path is checked to still sit under FLAGS_ROOT — `../de` never gets as far
 * as `path.join`.
 */

/** Exactly two ASCII letters — an ISO 3166-1 alpha-2 code and nothing else. */
const ISO_ALPHA2 = /^[A-Za-z]{2}$/;
const MAX_BATCH_CODES = 250;
const CACHE_CONTROL = "private, max-age=86400";

const variantSchema = z.enum(["flat", "square"]).default("flat");
const singleParamsSchema = z.object({ iso: z.string().regex(ISO_ALPHA2) });
const singleQuerySchema = z.object({ variant: variantSchema });
const batchQuerySchema = z.object({ codes: z.string().min(1), variant: variantSchema });

type FlagVariant = z.infer<typeof variantSchema>;

/** flag-icons ships the same flag twice: `4x3` (flat) and `1x1` (square). */
const VARIANT_DIR: Record<FlagVariant, string> = { flat: "4x3", square: "1x1" };

/**
 * Resolved through the package's own manifest rather than a `../../node_modules`
 * guess, so a hoisted or nested install lands on the same directory as the
 * production image (`/app/backend/node_modules/flag-icons/flags`).
 */
const FLAGS_ROOT = path.join(path.dirname(require.resolve("flag-icons/package.json")), "flags");

interface FlagEntry {
  body: Buffer;
  etag: string;
}

/**
 * Positive results only: a flag file never changes between deploys, so once
 * read it stays. A miss is a cheap ENOENT and is not remembered — caching a
 * negative answer would only ever hide a package upgrade.
 */
const flagCache = new Map<string, FlagEntry>();

const strongEtag = (body: Buffer): string => `"${createHash("sha1").update(body).digest("hex")}"`;

/**
 * Reads one flag. Returns null when flag-icons has no file for the code —
 * the 404 case. The code must already have passed ISO_ALPHA2; the prefix
 * check below is defence in depth, not the validation.
 */
export const readFlag = async (iso: string, variant: FlagVariant): Promise<FlagEntry | null> => {
  if (!ISO_ALPHA2.test(iso)) return null;
  const key = `${variant}:${iso.toUpperCase()}`;
  const cached = flagCache.get(key);
  if (cached) return cached;

  const file = path.resolve(FLAGS_ROOT, VARIANT_DIR[variant], `${iso.toLowerCase()}.svg`);
  if (!file.startsWith(FLAGS_ROOT + path.sep)) return null;

  try {
    const body = await fs.readFile(file);
    const entry: FlagEntry = { body, etag: strongEtag(body) };
    flagCache.set(key, entry);
    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** `If-None-Match` may carry several tags and a weak prefix; match on the bare value. */
const matchesEtag = (header: string | undefined, etag: string): boolean =>
  (header ?? "")
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === etag || tag === "*");

/**
 * The same headers on every SVG. `default-src 'none'` plus `sandbox` keeps a
 * flag inert when opened as a top-level document — same reasoning as the
 * airline-logo proxy, and these files are third-party markup too.
 */
const svgHeaders = (res: Response, etag: string): Response =>
  res
    .setHeader("Content-Type", "image/svg+xml")
    .setHeader("Cache-Control", CACHE_CONTROL)
    .setHeader("ETag", etag)
    .setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    .setHeader("X-Content-Type-Options", "nosniff");

/**
 * Splits `DE,fr, it` into upper-cased codes. Returns null when any entry is
 * not two letters or the list is empty or over the cap — the whole request
 * is refused rather than silently trimmed, so a client learns about its bug.
 */
const parseCodes = (raw: string): string[] | null => {
  const codes = raw.split(",").map((code) => code.trim());
  if (codes.length === 0 || codes.length > MAX_BATCH_CODES) return null;
  if (!codes.every((code) => ISO_ALPHA2.test(code))) return null;
  return [...new Set(codes.map((code) => code.toUpperCase()))];
};

const router = Router();

/** GET /country-flags?codes=DE,FR&variant=flat — many flags in one answer. */
router.get(
  "/",
  countryFlagLimiter,
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = batchQuerySchema.safeParse(req.query);
      const codes = query.success ? parseCodes(query.data.codes) : null;
      if (!query.success || !codes) {
        res.status(400).json({
          error: "invalid_request",
          details: [`codes: 1–${MAX_BATCH_CODES} comma-separated ISO 3166-1 alpha-2 codes; variant: flat|square`],
        });
        return;
      }

      const entries = await Promise.all(
        codes.map(async (code) => [code, await readFlag(code, query.data.variant)] as const),
      );
      const flags = Object.fromEntries(
        entries.flatMap(([code, entry]) => (entry ? [[code, entry.body.toString("utf8")]] : [])),
      );
      const missing = entries.flatMap(([code, entry]) => (entry ? [] : [code]));

      const body = Buffer.from(JSON.stringify({ flags, missing }), "utf8");
      const etag = strongEtag(body);
      res.setHeader("Cache-Control", CACHE_CONTROL).setHeader("ETag", etag);
      if (matchesEtag(req.headers["if-none-match"], etag)) {
        res.status(304).end();
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8").send(body);
    } catch (error) {
      next(error);
    }
  },
);

/** GET /country-flags/:iso?variant=flat|square — one flag as SVG. */
router.get(
  "/:iso",
  countryFlagLimiter,
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = singleParamsSchema.safeParse(req.params);
      const query = singleQuerySchema.safeParse(req.query);
      if (!params.success || !query.success) {
        res.status(400).json({
          error: "invalid_request",
          details: ["iso: an ISO 3166-1 alpha-2 code; variant: flat|square"],
        });
        return;
      }

      const entry = await readFlag(params.data.iso, query.data.variant);
      if (!entry) {
        // A 404 is a real answer here — the code is well-formed, the package
        // simply has no flag for it — so the client may cache it like a hit.
        res.setHeader("Cache-Control", CACHE_CONTROL).status(404).json({ error: "unknown_country" });
        return;
      }

      if (matchesEtag(req.headers["if-none-match"], entry.etag)) {
        svgHeaders(res, entry.etag).status(304).end();
        return;
      }
      svgHeaders(res, entry.etag).send(entry.body);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
