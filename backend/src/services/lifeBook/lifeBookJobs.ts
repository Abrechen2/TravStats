import { randomUUID } from "crypto";
import fsp from "fs/promises";
import path from "path";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { now } from "../../shared/time/clock";
import { archiveWorkDir } from "../accountArchive/format";
import { startJob, type JobView } from "../jobs/jobRegistry";
import { PhotoLoader } from "./images";
import { buildLoose, buildTrip, listScopeTrips, type BookScope } from "./loadBook";
import { renderHead, renderLoose, renderTail, renderTrip } from "./render";
import { bookStrings } from "./strings";
import type { BookFrame, BookLang } from "./types";

/**
 * The life book as a background job (docs/superpowers/specs/2026-11-22-life-book.md).
 * One run per account; the finished file waits in the archive work directory for
 * its download and is removed after `LIFE_BOOK_TTL_MS`. A restart forgets the
 * handle; the next run sweeps the orphan.
 */

export const LIFE_BOOK_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const FILE_PREFIX = "life-book-";

/** `LIFE_BOOK_MAX_BYTES` overrides the size ceiling of one book. */
export function lifeBookMaxBytes(): number {
  const raw = Number(process.env.LIFE_BOOK_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

interface StoredBook {
  userId: string;
  path: string;
  filename: string;
  createdAt: number;
}

const books = new Map<string, StoredBook>();
const running = new Set<string>();

export interface LifeBookResult {
  exportId: string;
  filename: string;
  bytes: number;
  trips: number;
  entries: number;
  photos: number;
  photosSkipped: number;
}

async function workDir(): Promise<string> {
  const dir = archiveWorkDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function sweepLifeBooks(at = Date.now()): Promise<void> {
  for (const [id, stored] of books) {
    if (at - stored.createdAt > LIFE_BOOK_TTL_MS) {
      books.delete(id);
      await fsp.rm(stored.path, { force: true });
    }
  }
  const dir = archiveWorkDir();
  const known = new Set([...books.values()].map((b) => path.basename(b.path)));
  for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!name.startsWith(FILE_PREFIX) || known.has(name)) continue;
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (stat && at - stat.mtimeMs > LIFE_BOOK_TTL_MS)
      await fsp.rm(path.join(dir, name), { force: true });
  }
}

export function findLifeBook(exportId: string, userId: string): StoredBook | null {
  const stored = books.get(exportId);
  // Expired books are refused even before the sweep has removed the file.
  if (!stored || stored.userId !== userId || Date.now() - stored.createdAt > LIFE_BOOK_TTL_MS)
    return null;
  return stored;
}

/** A deleted account's finished books go with it. */
export async function deleteAccountLifeBooks(userId: string): Promise<void> {
  for (const [id, stored] of books) {
    if (stored.userId !== userId) continue;
    books.delete(id);
    await fsp.rm(stored.path, { force: true });
  }
}

export interface LifeBookRequest {
  scope: BookScope;
  lang: BookLang;
}

/** Checks the scope against the account before a job is started, so a bad request is a plain 404. */
export async function checkLifeBookRequest(userId: string, req: LifeBookRequest): Promise<void> {
  if (req.scope.kind !== "trip") return;
  const trip = await prisma.trip.findFirst({
    where: { id: req.scope.tripId, userId },
    select: { id: true },
  });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
}

export function startLifeBook(userId: string, username: string, req: LifeBookRequest): JobView {
  if (running.has(userId)) {
    throw new AppError("A life book is already being built", 409, "LIFE_BOOK_BUSY");
  }
  running.add(userId);
  try {
    return startJob("lifeBook.export", userId, async (report): Promise<LifeBookResult> => {
      try {
        return await buildBook(userId, username, req, report);
      } finally {
        running.delete(userId);
      }
    });
  } catch (err) {
    running.delete(userId);
    throw err;
  }
}

async function buildBook(
  userId: string,
  username: string,
  req: LifeBookRequest,
  report: (done: number, total: number) => void
): Promise<LifeBookResult> {
  const { scope, lang } = req;
  const s = bookStrings(lang);
  const max = lifeBookMaxBytes();
  const metas = await listScopeTrips(userId, scope);
  const looseLoader = new PhotoLoader(userId);
  const loose = scope.kind === "trip" ? [] : await buildLoose(userId, scope, lang, looseLoader);
  if (metas.length === 0 && loose.length === 0) {
    throw new AppError("Nothing to put into the book", 422, "LIFE_BOOK_EMPTY");
  }

  const scopeTitle =
    scope.kind === "year"
      ? `${s.scopeYear} ${scope.year}`
      : scope.kind === "trip"
        ? (metas[0]?.name ?? s.scopeTrip)
        : s.scopeAll;
  const today = now().toISOString().slice(0, 10);
  const frame: BookFrame = { lang, generatedOn: today, username, scopeTitle };

  const dir = await workDir();
  await sweepLifeBooks();
  const exportId = randomUUID();
  const target = path.join(dir, `${FILE_PREFIX}${exportId}.html`);
  const handle = await fsp.open(target, "w", 0o600);
  let registered = false;
  let bytes = 0;
  const loader = new PhotoLoader(userId);
  let entries = loose.length;
  let photos = loose.reduce((n, e) => n + e.photos.length, 0);
  const write = async (chunk: string): Promise<void> => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > max) {
      throw new AppError("The life book is too large", 413, "LIFE_BOOK_TOO_LARGE");
    }
    await handle.write(chunk);
  };
  try {
    await write(renderHead(frame, metas, loose.length > 0));
    report(0, metas.length);
    for (const [i, meta] of metas.entries()) {
      const trip = await buildTrip(userId, username, meta, lang, loader);
      entries += trip.entries.length;
      photos += trip.photos.length + trip.entries.reduce((n, e) => n + e.photos.length, 0);
      await write(renderTrip(trip, frame));
      report(i + 1, metas.length);
    }
    if (loose.length > 0) await write(renderLoose(loose, frame));
    await write(renderTail(frame));
    await handle.close();
    const account = await prisma.user.findFirst({
      where: { id: userId, deletionStartedAt: null },
      select: { id: true },
    });
    if (!account) throw new AppError("The account was deleted while its book was built", 409);
    const safe = username.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "account";
    const filename = `travstats-lebensbuch-${safe}-${today}.html`;
    books.set(exportId, { userId, path: target, filename, createdAt: Date.now() });
    registered = true;
    return {
      exportId,
      filename,
      bytes,
      trips: metas.length,
      entries,
      photos,
      photosSkipped: loader.skipped + looseLoader.skipped,
    };
  } finally {
    await handle.close().catch(() => undefined);
    if (!registered) await fsp.rm(target, { force: true });
  }
}
