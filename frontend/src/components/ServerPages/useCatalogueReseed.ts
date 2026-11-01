import { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { API_TIMEOUTS } from "../../config/constants";
import { api } from "../../lib/api/client";
import { logger } from "../../lib/logger";
import type { JobView } from "../ui/settings";

export type CatalogueKind = "airports" | "airlines" | "aircraft";
export const CATALOGUE_KINDS: readonly CatalogueKind[] = ["airports", "airlines", "aircraft"];

interface SeedingStatus {
  status: "pending" | "running" | "completed" | "failed";
  totalAirports?: number;
  processedAirports?: number;
}

const POLL_MS = 2000;

/** Why a catalogue re-read did not start or finish, as the sentence key under `settingsRows:maintenance.reseed.*`. */
export type ReseedFailure =
  "rateLimited" | "forbidden" | "failed" | "statusFailed" | "seedingFailed";

/**
 * Re-reads the shipped airport, airline and aircraft catalogues as background
 * jobs (forgejo#397). Airports seed on the server and are polled; airlines and
 * aircraft answer when finished, on the long timeout. A timeout is an UNKNOWN
 * outcome, not a failure; a 429 (three an hour) and a 403 have their own
 * sentence. Entries an admin added are never touched by the server.
 */
export function useCatalogueReseed(labels: {
  running: (kind: CatalogueKind) => string;
  done: (kind: CatalogueKind, count: number | null) => string;
  failure: (reason: ReseedFailure) => string;
}): {
  jobs: Record<CatalogueKind, JobView | null>;
  busy: boolean;
  run: () => Promise<void>;
} {
  const [jobs, setJobs] = useState<Record<CatalogueKind, JobView | null>>({
    airports: null,
    airlines: null,
    aircraft: null,
  });
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const set = useCallback((kind: CatalogueKind, job: JobView | null): void => {
    if (mounted.current) setJobs((prev) => ({ ...prev, [kind]: job }));
  }, []);

  const failureOf = (error: unknown): ReseedFailure => {
    if (isAxiosError(error)) {
      if (error.response?.status === 429) return "rateLimited";
      if (error.response?.status === 403) return "forbidden";
    }
    return "failed";
  };

  const pollAirports = useCallback(
    async (retry: () => void): Promise<void> => {
      try {
        const { data } = await api.get<SeedingStatus | null>("/admin/airports/seeding-status");
        if (!mounted.current) return;
        if (data && (data.status === "running" || data.status === "pending")) {
          set("airports", {
            kind: "running",
            what: labelsRef.current.running("airports"),
            done: data.processedAirports,
            total: data.totalAirports,
          });
          timer.current = setTimeout(() => void pollAirports(retry), POLL_MS);
        } else if (data?.status === "failed") {
          set("airports", {
            kind: "failed",
            reason: labelsRef.current.failure("seedingFailed"),
            onRetry: retry,
          });
        } else {
          set("airports", {
            kind: "done",
            result: labelsRef.current.done("airports", data?.totalAirports ?? null),
          });
        }
      } catch (error) {
        logger.error("Catalogue reseed: seeding status failed", error);
        // A run whose state cannot be read is not "running" for ever: release it and say so.
        set("airports", {
          kind: "failed",
          reason: labelsRef.current.failure("statusFailed"),
          onRetry: retry,
        });
      }
    },
    [set]
  );

  const run = useCallback(async (): Promise<void> => {
    const retry = (): void => void run();
    for (const kind of CATALOGUE_KINDS) set(kind, { kind: "waiting" });
    set("airports", { kind: "running", what: labelsRef.current.running("airports") });
    try {
      await api.post("/admin/airports/reseed");
      void pollAirports(retry);
    } catch (error) {
      logger.error("Catalogue reseed: airports failed", error);
      set("airports", {
        kind: "failed",
        reason: labelsRef.current.failure(failureOf(error)),
        onRetry: retry,
      });
    }
    for (const kind of ["airlines", "aircraft"] as const) {
      set(kind, { kind: "running", what: labelsRef.current.running(kind) });
      try {
        const { data } = await api.post<{ inserted: number }>(
          `/admin/${kind}/reseed`,
          {},
          { timeout: API_TIMEOUTS.PARSER }
        );
        set(kind, { kind: "done", result: labelsRef.current.done(kind, data.inserted) });
      } catch (error) {
        logger.error(`Catalogue reseed: ${kind} failed`, error);
        if (isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")) {
          set(kind, { kind: "unknown", onCheck: retry });
        } else {
          set(kind, {
            kind: "failed",
            reason: labelsRef.current.failure(failureOf(error)),
            onRetry: retry,
          });
        }
      }
    }
  }, [pollAirports, set]);

  const busy = Object.values(jobs).some((j) => j?.kind === "running" || j?.kind === "waiting");
  return { jobs, busy, run };
}
