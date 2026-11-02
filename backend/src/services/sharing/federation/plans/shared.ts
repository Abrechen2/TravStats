/**
 * What the host and the member side of a remote plan agree on (spec 2026-11-02 §4): the ETag of a
 * plan view and the limits that moved over from the guest door unchanged.
 */
import type { PlanView } from "../../../travplan/types";

/** The ETag of a plan view: its revision and the member it was drawn for. */
export const planEtag = (view: Pick<PlanView, "revision" | "self">): string =>
  `"${view.revision}-${view.self?.memberId ?? ""}"`;

export const REMOTE_WRITES_PER_MINUTE = 120;
export const REMOTE_READS_PER_MINUTE = 600;
/** The member's own server answers a read from its copy this long without asking the host. */
export const READ_CACHE_MS = 5_000;
/** Open invitations a person can hold from one connection: a flood is dropped, not stored. */
export const MAX_OPEN_INVITES = 50;
