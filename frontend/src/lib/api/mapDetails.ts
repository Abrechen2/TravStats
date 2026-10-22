import { isAxiosError } from "axios";
import { api } from "./client";
import { logger } from "../logger";

/**
 * Rich map details (2026-10-21): a picture of a journey's vessel, car model
 * or train category, and the Wikipedia opening of a station. Served by this
 * server; the browser never asks Wikidata itself. One request per subject or
 * station per page load — hovering a line forty times asks once.
 */

export type SubjectKind = "vessel" | "vehicle" | "train";

/** Whom to credit for a Commons picture — mirrors `SubjectImageCredit` in the OpenAPI spec. */
export interface SubjectImageCredit {
  qid: string;
  file: string;
  licence: string;
  licenceUrl: string | null;
  artist: string | null;
  sourceUrl: string;
}

export interface SubjectImage {
  available: boolean;
  pending?: boolean;
  /** Could not ask (Wikimedia down, or our own request failed) — not "no picture". */
  unavailable?: boolean;
  /** The instance's picture switch is off — an admin may turn it on: not "no picture". */
  disabled?: boolean;
  credit: SubjectImageCredit | null;
}

/** The picture bytes, served by this server. */
export function subjectImagePath(kind: SubjectKind, name: string): string {
  return `/api/v1/map-details/subject/image?kind=${kind}&name=${encodeURIComponent(name.trim())}`;
}

const UNAVAILABLE: SubjectImage = { available: false, unavailable: true, credit: null };
const subjects = new Map<string, Promise<SubjectImage>>();

/**
 * Whether a subject has a picture, and its credit. Only an answer is kept for
 * the page load: a pending lookup, a failure (`unavailable`) or a switched-off
 * instance (`disabled`) is asked again.
 */
export function getSubjectImage(kind: SubjectKind, name: string): Promise<SubjectImage> {
  const key = `${kind}:${name.trim().toLowerCase()}`;
  const known = subjects.get(key);
  if (known) return known;
  const task = api
    .get<{ success: true; data: SubjectImage }>("/map-details/subject", {
      params: { kind, name: name.trim() },
    })
    .then(({ data }) => {
      if (data.data.pending || data.data.unavailable || data.data.disabled) subjects.delete(key);
      return data.data;
    })
    .catch((err: unknown) => {
      logger.warn("subject picture lookup failed", err);
      subjects.delete(key);
      return UNAVAILABLE;
    });
  subjects.set(key, task);
  return task;
}

export type StopDomain = "rail" | "bus" | "ferry" | "rental";

/** Whom to credit for a station photo — mirrors `imageCredit` of `StopWikipediaSummary`. */
export interface StopImageCredit {
  file: string;
  licence: string | null;
  licenceUrl: string | null;
  artist: string | null;
  /** The file's description page. */
  sourceUrl: string;
  onCommons: boolean;
}

export interface StopSummary {
  title: string;
  extract: string;
  thumbnailUrl: string | null;
  pageUrl: string;
  lang: "de" | "en";
  /** Null when the photo has no credit — then it is not shown. */
  imageCredit: StopImageCredit | null;
}

/**
 * What a station lookup came to. `disabled`: the instance does not ask open
 * data services (an admin's choice — nothing to say). `unavailable`: Wikipedia
 * or our own request failed — the card says so instead of looking empty.
 */
export type StopInfo =
  | { state: "found"; summary: StopSummary }
  | { state: "none" }
  | { state: "disabled" }
  | { state: "unavailable" };

const stops = new Map<string, Promise<StopInfo>>();

export function getStopInfo(
  domain: StopDomain,
  stop: { name: string; lat: number; lon: number },
  lang: "de" | "en"
): Promise<StopInfo> {
  const key = `${domain}|${stop.lat.toFixed(4)}|${stop.lon.toFixed(4)}|${stop.name}|${lang}`;
  const known = stops.get(key);
  if (known) return known;
  const task = api
    .get<{
      success: true;
      data: {
        summary: StopSummary | null;
        unavailable: boolean;
        /** `deadline`: the server's whole lookup (8 s, inside our 10 s) ran out. */
        reason: "unavailable" | "deadline" | null;
      };
    }>("/map-details/stop", {
      params: { domain, name: stop.name, lat: stop.lat, lon: stop.lon, lang },
    })
    .then(({ data }): StopInfo => {
      if (data.data.unavailable) {
        stops.delete(key);
        return { state: "unavailable" };
      }
      return data.data.summary ? { state: "found", summary: data.data.summary } : { state: "none" };
    })
    .catch((err: unknown): StopInfo => {
      // Switched off is the admin's state of the moment, not an answer: not kept.
      stops.delete(key);
      if (isAxiosError(err) && err.response?.status === 409) return { state: "disabled" };
      logger.warn("station Wikipedia lookup failed", err);
      return { state: "unavailable" };
    });
  stops.set(key, task);
  return task;
}

/** Test seam. */
export function __clearMapDetailsCaches(): void {
  subjects.clear();
  stops.clear();
}
