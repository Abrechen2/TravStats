import { z } from "zod";
import { BAHN_HANDOFF_PATH, MAX_HANDOFF_FRAGMENT } from "./bahnBookmarklet";

/**
 * Reading what the „In TravStats übernehmen“ bookmarklet hands over
 * (forgejo#204). The fragment arrives from a page anyone can craft a link to,
 * so it is untrusted: bounded before it is decoded, decoded without eval,
 * validated with a schema, and only then sent to the server — which reads it
 * again with its own schema. Nothing here renders anything; the page shows the
 * result through React only.
 */

/** Failures the bookmarklet reports on bahn.de, by code. */
export const BOOKMARKLET_FAILURES = [
  "notBahn",
  "noVbid",
  "blocked",
  "expired",
  "rateLimited",
  "providerError",
  "fetchFailed",
  "unreadable",
  "tooLarge",
] as const;
export type BookmarkletFailure = (typeof BOOKMARKLET_FAILURES)[number];

/** Failures found here, before anything is sent. */
export type HandoffDecodeFailure =
  /** The page was opened without a hand-over (or it was already used). */
  | "empty"
  /** A fragment that is not one the bookmarklet writes: tampered, cut off, or foreign. */
  | "damaged"
  | "tooLarge";

export type HandoffFailure = BookmarkletFailure | HandoffDecodeFailure;

const text = (max: number) => z.string().max(max).optional();

const section = z.object({
  abfahrtsOrt: text(120),
  ankunftsOrt: text(120),
  abfahrtsZeitpunkt: text(40),
  ankunftsZeitpunkt: text(40),
  verkehrsmittel: z
    .object({
      name: text(60),
      kurzText: text(30),
      nummer: text(20),
      typ: text(40),
      produktGattung: text(40),
    })
    .optional(),
  abfahrtsOrtExtId: text(12),
  ankunftsOrtExtId: text(12),
});

/** The connection answer, trimmed — the server's `railBahnHandoffSchema` bounds, mirrored. */
const answerSchema = z
  .object({
    hinfahrtRecon: z.string().max(20_000).optional(),
    klasse: text(40),
    verbindungsAbschnitte: z.array(section).max(30).optional(),
  })
  .refine((a) => a.hinfahrtRecon !== undefined || a.verbindungsAbschnitte !== undefined);

const payloadSchema = z.object({ v: z.literal(1), answer: answerSchema });

export type BahnHandoffAnswer = z.infer<typeof answerSchema>;

export type DecodedHandoff =
  { kind: "answer"; answer: BahnHandoffAnswer } | { kind: "failed"; reason: HandoffFailure };

const isBookmarkletFailure = (value: string): value is BookmarkletFailure =>
  (BOOKMARKLET_FAILURES as readonly string[]).includes(value);

/** The hand-over in a location fragment (`#d=…` or `#e=…`). */
export function decodeBahnHandoff(hash: string): DecodedHandoff {
  const fragment = hash.replace(/^#/, "");
  if (fragment.length === 0) return { kind: "failed", reason: "empty" };
  if (fragment.length > MAX_HANDOFF_FRAGMENT) return { kind: "failed", reason: "tooLarge" };
  const params = new URLSearchParams(fragment);
  const error = params.get("e");
  if (error !== null) {
    return { kind: "failed", reason: isBookmarkletFailure(error) ? error : "damaged" };
  }
  const data = params.get("d");
  if (data === null) return { kind: "failed", reason: "empty" };
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { kind: "failed", reason: "damaged" };
  }
  const parsed = payloadSchema.safeParse(json);
  return parsed.success
    ? { kind: "answer", answer: parsed.data.answer }
    : { kind: "failed", reason: "damaged" };
}

/**
 * A hand-over that arrived while nobody was signed in — or whose session ran
 * out while it was being read — waits in this tab's session storage until the
 * login is done, for ten minutes, then it is dropped. Session storage, not
 * local: it never outlives the tab, and the page removes it as soon as it has
 * read it.
 *
 * Bound to an account when one is known (`owner`): a hand-over read for A goes
 * back to A after a re-login and is discarded, unread, when anyone else signs
 * in. One that arrived signed out has no owner to bind, and goes to whoever
 * signs in first — the person who just clicked the bookmark in this tab, in
 * every ordinary case. A deliberate logout drops it (`clearBahnHandoff`).
 */
const STASH_KEY = "travstats.railBahnHandoff";
const STASH_TTL_MS = 10 * 60 * 1000;

interface Stash {
  hash: string;
  at: number;
  /** The account it was read for; null when it arrived signed out. */
  owner: string | null;
}

export function stashBahnHandoff(hash: string, now: number, owner: string | null = null): void {
  if (hash.replace(/^#/, "").length === 0) return;
  try {
    sessionStorage.setItem(STASH_KEY, JSON.stringify({ hash, at: now, owner } satisfies Stash));
  } catch {
    // Storage blocked (private mode, policy): the hand-over then needs a second click.
  }
}

/** Drops a waiting hand-over (a deliberate logout, or one that is not this account's). */
export function clearBahnHandoff(): void {
  try {
    sessionStorage.removeItem(STASH_KEY);
  } catch {
    // Nothing to clean up if storage is blocked.
  }
}

/** The waiting hand-over for `account`; another account's is discarded on sight. */
function readStash(now: number, account: string | null): Stash | null {
  let stash: Partial<Stash>;
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    if (!raw) return null;
    stash = JSON.parse(raw) as Partial<Stash>;
  } catch {
    return null;
  }
  if (typeof stash.hash !== "string" || typeof stash.at !== "number") return null;
  if (!(now - stash.at <= STASH_TTL_MS && now >= stash.at)) return null;
  const owner = typeof stash.owner === "string" ? stash.owner : null;
  if (owner !== null && owner !== account) {
    clearBahnHandoff();
    return null;
  }
  return { hash: stash.hash, at: stash.at, owner };
}

/** The stashed hand-over's fragment for `account`, removed as it is read. */
export function takeStashedBahnHandoff(now: number, account: string | null = null): string | null {
  const stash = readStash(now, account);
  clearBahnHandoff();
  return stash?.hash ?? null;
}

/** Where to go after a login: the hand-over page while one waits for `account`, else nowhere special. */
export function pendingBahnHandoffPath(now: number, account: string | null = null): string | null {
  return readStash(now, account) ? BAHN_HANDOFF_PATH : null;
}
