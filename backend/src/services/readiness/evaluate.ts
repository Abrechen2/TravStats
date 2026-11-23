/**
 * Builds the `GET /api/v1/readiness` answer (spec 2026-11-14 §11) from the
 * registries, the stored results and the account's own state. No secret value
 * and no admin detail for an ordinary account ever enters the answer: an admin
 * item is dropped for a non-admin and a blocked user item names only the item's
 * id.
 */
import type { CheckId, NoteAction } from "../../shared/readinessCatalogue";
import { appVersion, buildVersion } from "../../utils/version";
import { compareVersions, isValidVersion } from "../parsers/templates/v2/version";
import { loadReadinessContext, type ReadinessContext } from "./context";
import { CHECKS } from "./registry";
import {
  loadAccountState,
  loadInvitationState,
  markInvitationSeen,
  recordRunningVersion,
  type AccountReadinessState,
  type InvitationState,
} from "./state";
import type { CheckStatus, Evaluation, RegisteredCheck } from "./types";
import { ReadinessFactError } from "./factError";
import logger from "../../utils/logger";
import { NOTES } from "./upgrades/notes";

const DAY_MS = 24 * 60 * 60 * 1000;

export type UserState = null | { kind: "snoozed"; until: string } | { kind: "optedOut" };

export interface ReadinessItem {
  id: string;
  revision: number;
  scope: "admin" | "user";
  severity: "required" | "recommended";
  status: CheckStatus;
  checkedAt: string | null;
  /** The number the copy names; null where the check counts nothing. */
  count: number | null;
  titleKey: string;
  consequenceKey: string;
  actionKey: string | null;
  /** The page lists the entries this check found (`GET /readiness/items/:id/entries`). */
  entryList: boolean;
  /**
   * The check itself could not run (status `unknown`): its facts could not be
   * loaded, or the evaluator threw. Shown as "Prüfung fehlgeschlagen"; the
   * detail is in the server log, never in the answer.
   */
  failure: CheckFailure | null;
  action: string | null;
  blockedBy: string | null;
  optOutAllowed: boolean;
  userState: UserState;
}

export interface ReadinessNote {
  id: string;
  version: string;
  audience: "admin" | "user";
  beforeKey: string;
  afterKey: string;
  action: NoteAction | null;
  noActionReason: string | null;
  acknowledged: boolean;
  open: boolean;
}

export interface ReadinessInvitation {
  show: boolean;
  reason: "update" | "required" | null;
  snoozedUntil: string | null;
  /** The keys behind the card; the page sends back what it rendered (`invitation/seen`). */
  keys: string[];
}

export interface ReadinessBanner {
  show: boolean;
  itemIds: string[];
}

export interface ReadinessView {
  runningVersion: string;
  summary: {
    required: number;
    recommended: number;
    unknown: number;
    newNotes: number;
    blockedByAdmin: number;
    ready: number;
  };
  items: ReadinessItem[];
  notes: ReadinessNote[];
  invitation: ReadinessInvitation;
  banner: ReadinessBanner;
}

export interface CheckFailure {
  reason: "factsUnavailable" | "evaluatorError";
}

interface Evaluated {
  check: RegisteredCheck;
  status: CheckStatus;
  checkedAt: Date | null;
  count: number | null;
  failure: CheckFailure | null;
}

/** Run one check on its own: a throw is that check's failure, never the whole answer's. */
function runCheck(
  check: RegisteredCheck,
  ctx: ReadinessContext
): Evaluation | null | { failure: CheckFailure } {
  try {
    if (!check.appliesWhen(ctx)) return null;
    return check.evaluate(ctx);
  } catch (err) {
    const reason = err instanceof ReadinessFactError ? "factsUnavailable" : "evaluatorError";
    logger.error(
      {
        checkId: check.id,
        reason,
        error: err instanceof Error ? err.message : String(err),
      },
      "readiness: a check failed; it is shown as failed and the others still answer"
    );
    return { failure: { reason } };
  }
}

/** Evaluate every applicable check; a result older than the check's `maxAgeDays` reads `unknown`. */
export function evaluateChecks(ctx: ReadinessContext): Map<CheckId, Evaluated> {
  const out = new Map<CheckId, Evaluated>();
  for (const check of CHECKS) {
    const result = runCheck(check, ctx);
    if (result === null) continue;
    if ("failure" in result) {
      out.set(check.id, {
        check,
        status: "unknown",
        checkedAt: null,
        count: null,
        failure: result.failure,
      });
      continue;
    }
    const stale =
      check.maxAgeDays !== null &&
      result.checkedAt !== null &&
      ctx.now.getTime() - result.checkedAt.getTime() > check.maxAgeDays * DAY_MS;
    out.set(check.id, {
      check,
      status: stale ? "unknown" : result.status,
      checkedAt: result.checkedAt,
      count: result.count ?? null,
      failure: null,
    });
  }
  return out;
}

function userStateOf(check: RegisteredCheck, state: AccountReadinessState, now: Date): UserState {
  const row = state.items.get(check.id);
  // A raised revision ignores what was said about the old meaning.
  if (!row || row.revision !== check.revision) return null;
  if (row.kind === "optedOut") return check.severity === "required" ? null : { kind: "optedOut" };
  if (!row.until || row.until <= now) return null;
  return { kind: "snoozed", until: row.until.toISOString() };
}

/** A note whose condition cannot be read is left out and logged, never the whole answer. */
function noteApplies(note: (typeof NOTES)[number], ctx: ReadinessContext): boolean {
  try {
    return note.appliesWhen(ctx);
  } catch (err) {
    logger.error(
      { noteId: note.id, error: err instanceof Error ? err.message : String(err) },
      "readiness: an update note's condition failed; the note is left out"
    );
    return false;
  }
}

function inRange(version: string, from: string, to: string): boolean {
  if (![version, from, to].every(isValidVersion)) return false;
  return compareVersions(version, from) > 0 && compareVersions(version, to) <= 0;
}

/**
 * What would make the invitation card appear (spec 2026-11-14 §12): the ids of
 * open notes, then of `required` items that verifiably need action and that the
 * account has not snoozed. `unknown` is never a key. Notes come first in the
 * list so a caller can tell which kind a key is.
 */
export function invitationKeys(
  items: readonly ReadinessItem[],
  notes: readonly ReadinessNote[]
): { noteKeys: string[]; itemKeys: string[] } {
  return {
    noteKeys: notes.filter((n) => n.open).map((n) => n.id),
    itemKeys: items
      .filter(
        (i) =>
          i.severity === "required" &&
          i.status === "needsAction" &&
          i.blockedBy === null &&
          i.userState?.kind !== "snoozed"
      )
      .map((i) => i.id),
  };
}

export function invitationOf(
  items: readonly ReadinessItem[],
  notes: readonly ReadinessNote[],
  state: InvitationState,
  now: Date
): ReadinessInvitation {
  const snoozed = state.snoozedUntil !== null && state.snoozedUntil > now;
  const snoozedUntil = snoozed ? state.snoozedUntil!.toISOString() : null;
  const { noteKeys, itemKeys } = invitationKeys(items, notes);
  const keys = [...noteKeys, ...itemKeys];
  if (snoozed) return { show: false, reason: null, snoozedUntil, keys };
  const fresh = (k: string) => !state.seen.has(k);
  if (noteKeys.some(fresh)) return { show: true, reason: "update", snoozedUntil, keys };
  if (itemKeys.some(fresh)) return { show: true, reason: "required", snoozedUntil, keys };
  return { show: false, reason: null, snoozedUntil, keys };
}

/** Admins only; ignores snoozes ("until it is resolved") and never counts `unknown` (§9). */
export function bannerOf(items: readonly ReadinessItem[], isAdmin: boolean): ReadinessBanner {
  const itemIds = isAdmin
    ? items
        .filter(
          (i) => i.scope === "admin" && i.severity === "required" && i.status === "needsAction"
        )
        .map((i) => i.id)
    : [];
  return { show: itemIds.length > 0, itemIds };
}

/** Severity counts for the shell: the header dot and the settings menu (owner, 2026-11-23). */
export interface ReadinessAttention {
  /** `required` items that need action — red. */
  problem: number;
  /** `recommended` items that need action — amber. */
  warning: number;
}

/**
 * The items this account is shown and the counts over them. Snoozed and opted-out
 * items are listed but not counted; an item blocked by an admin item counts as
 * the admin's, never twice.
 */
function buildItems(
  evaluated: Map<CheckId, Evaluated>,
  state: AccountReadinessState,
  isAdmin: boolean,
  now: Date
): { items: ReadinessItem[]; summary: ReadinessView["summary"] } {
  const items: ReadinessItem[] = [];
  const summary = {
    required: 0,
    recommended: 0,
    unknown: 0,
    newNotes: 0,
    blockedByAdmin: 0,
    ready: 0,
  };

  for (const { check, status, checkedAt, count, failure } of evaluated.values()) {
    if (check.scope === "admin" && !isAdmin) continue;
    const blocker = check.blockedBy ? evaluated.get(check.blockedBy) : undefined;
    const blocked = status === "needsAction" && blocker?.status === "needsAction";
    const userState = userStateOf(check, state, now);
    items.push({
      id: check.id,
      revision: check.revision,
      scope: check.scope,
      severity: check.severity,
      status,
      checkedAt: checkedAt ? checkedAt.toISOString() : null,
      count,
      titleKey: check.titleKey,
      consequenceKey: check.consequenceKey,
      actionKey: check.actionKey,
      entryList: check.entryList,
      failure,
      action: blocked ? null : check.action,
      blockedBy: blocked ? check.blockedBy : null,
      optOutAllowed: check.severity !== "required",
      userState,
    });
    if (userState) continue;
    if (status === "ready") summary.ready++;
    else if (status === "unknown") summary.unknown++;
    else if (blocked) summary.blockedByAdmin++;
    else summary[check.severity]++;
  }
  return { items, summary };
}

/**
 * The light read behind the header dot: the same evaluation as the page, but no
 * notes, no invitation bookkeeping and no write — counts only.
 */
export async function buildReadinessAttention(
  userId: string,
  isAdmin: boolean,
  now: Date = new Date()
): Promise<ReadinessAttention> {
  const [ctx, state] = await Promise.all([
    loadReadinessContext(userId, isAdmin, now),
    loadAccountState(userId),
  ]);
  const { summary } = buildItems(evaluateChecks(ctx), state, isAdmin, now);
  return { problem: summary.required, warning: summary.recommended };
}

export async function buildReadinessView(
  userId: string,
  isAdmin: boolean,
  now: Date = new Date()
): Promise<ReadinessView> {
  await recordRunningVersion();
  const [ctx, state, invitationState] = await Promise.all([
    loadReadinessContext(userId, isAdmin, now),
    loadAccountState(userId),
    loadInvitationState(userId),
  ]);
  const evaluated = evaluateChecks(ctx);
  const { items, summary } = buildItems(evaluated, state, isAdmin, now);

  const notes: ReadinessNote[] = [];
  for (const note of NOTES) {
    if (note.audience === "admin" && !isAdmin) continue;
    if (!inRange(note.version, state.ackVersion, appVersion)) continue;
    if (!noteApplies(note, ctx)) continue;
    const acknowledged = state.ackedNotes.has(note.id);
    // A note with a check stays open until that check is ready, whatever "seen" says.
    const open =
      note.action?.kind === "check"
        ? evaluated.get(note.action.checkId)?.status !== undefined &&
          evaluated.get(note.action.checkId)?.status !== "ready"
        : !acknowledged;
    notes.push({
      id: note.id,
      version: note.version,
      audience: note.audience,
      beforeKey: note.beforeKey,
      afterKey: note.afterKey,
      action: note.action,
      noActionReason: note.noActionReason,
      acknowledged,
      open,
    });
    if (open) summary.newNotes++;
  }

  // A seen key that is no longer current (the item resolved, the note closed) is
  // forgotten, so it is new again when it returns. Written only when it changes.
  const { noteKeys, itemKeys } = invitationKeys(items, notes);
  const current = new Set([...noteKeys, ...itemKeys]);
  const kept = [...invitationState.seen].filter((k) => current.has(k));
  let seen = invitationState.seen;
  if (kept.length !== seen.size) {
    await markInvitationSeen(userId, kept);
    seen = new Set(kept);
  }

  return {
    runningVersion: buildVersion,
    summary,
    items,
    notes,
    invitation: invitationOf(items, notes, { ...invitationState, seen }, now),
    banner: bannerOf(items, isAdmin),
  };
}

/** Who may act on an item id: it must exist, apply to this account and, if admin-scoped, be visible to it. */
export async function findApplicableItem(
  userId: string,
  isAdmin: boolean,
  itemId: string
): Promise<RegisteredCheck | null> {
  const ctx = await loadReadinessContext(userId, isAdmin);
  const hit = evaluateChecks(ctx).get(itemId as CheckId);
  if (!hit) return null;
  if (hit.check.scope === "admin" && !isAdmin) return null;
  return hit.check;
}

/** Notes this account is shown (range, audience, appliesWhen) — the ones it may acknowledge. */
export async function findApplicableNote(
  userId: string,
  isAdmin: boolean,
  noteId: string
): Promise<boolean> {
  const [ctx, state] = await Promise.all([
    loadReadinessContext(userId, isAdmin),
    loadAccountState(userId),
  ]);
  const note = NOTES.find((n) => n.id === noteId);
  if (!note) return false;
  if (note.audience === "admin" && !isAdmin) return false;
  return inRange(note.version, state.ackVersion, appVersion) && noteApplies(note, ctx);
}
