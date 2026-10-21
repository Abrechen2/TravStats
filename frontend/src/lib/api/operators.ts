import { api } from "./client";
import { logger } from "../logger";

/** Whom to credit for a Commons logo — mirrors `OperatorMarkCredit` in the OpenAPI spec. */
export interface OperatorMarkCredit {
  qid: string;
  file: string;
  licence: string;
  licenceUrl: string | null;
  artist: string | null;
  sourceUrl: string;
  colour: string | null;
}

export interface OperatorMark {
  available: boolean;
  /** The server's lookup is still running or was deferred: ask again on a later view. */
  pending?: boolean;
  source: "catalogue" | "wikidata" | null;
  credit: OperatorMarkCredit | null;
}

export type OperatorMarkDomain = "rail" | "bus" | "ferry" | "rental" | "cruise";

/** The logo bytes — served by this server; the browser never asks Wikimedia itself. */
export function operatorLogoPath(domain: OperatorMarkDomain, name: string): string {
  return `/api/v1/operators/logo?domain=${domain}&name=${encodeURIComponent(name.trim())}`;
}

const NONE: OperatorMark = { available: false, source: null, credit: null };
const cache = new Map<string, Promise<OperatorMark>>();

/**
 * Whether an operator has a logo, and its credit (forgejo#323). One request per
 * operator per page load: a card list of forty rides of one ferry line asks
 * once. A failure is "no logo" — the card draws the monogram — and is logged.
 */
export function getOperatorMark(domain: OperatorMarkDomain, name: string): Promise<OperatorMark> {
  const key = `${domain}:${name.trim().toLowerCase()}`;
  const known = cache.get(key);
  if (known) return known;
  const task = api
    .get<{ success: true; data: OperatorMark }>("/operators/mark", {
      params: { domain, name: name.trim() },
    })
    .then(({ data }) => {
      // A pending answer is not remembered, so the next card asks again.
      if (data.data.pending) cache.delete(key);
      return data.data;
    })
    .catch((err: unknown) => {
      logger.warn("operator mark lookup failed", err);
      cache.delete(key);
      return NONE;
    });
  cache.set(key, task);
  return task;
}

/** Test seam. */
export function __clearOperatorMarkCache(): void {
  cache.clear();
}
