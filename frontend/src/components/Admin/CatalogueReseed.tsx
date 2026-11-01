import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { isAxiosError } from "axios";

import { API_TIMEOUTS } from "../../config/constants";
import { useTranslation } from "../../hooks/useTranslation";
import { api } from "../../lib/api/client";
import { logger } from "../../lib/logger";

const POLL_MS = 2000;

type Kind = "airports" | "airlines" | "aircraft";
type Phase =
  { s: "idle" } | { s: "running" } | { s: "done"; text: string } | { s: "error"; text: string };

interface SeedingStatus {
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  totalAirports?: number;
  processedAirports?: number;
  error?: string;
}

/**
 * Admin: re-seed the airport, airline and aircraft catalogues, and see the
 * airport seeding's state (forgejo#397). Airports seed in the background and
 * are polled; airlines and aircraft answer when finished, so their request is
 * given the long timeout and a timeout is reported as an UNKNOWN outcome, not a
 * failure. A 429 (the admin reseed limiter) and a 403 have their own sentence.
 */
export default function CatalogueReseed(): JSX.Element {
  const { t } = useTranslation("admin");
  const [phase, setPhase] = useState<Record<Kind, Phase>>({
    airports: { s: "idle" },
    airlines: { s: "idle" },
    aircraft: { s: "idle" },
  });
  const [status, setStatus] = useState<SeedingStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const set = (kind: Kind, p: Phase): void => setPhase((prev) => ({ ...prev, [kind]: p }));

  const failureText = useCallback(
    (err: unknown): string => {
      if (isAxiosError(err)) {
        if (err.response?.status === 429) return t("catalogues.errors.rateLimited");
        if (err.response?.status === 403) return t("catalogues.errors.forbidden");
        if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT")
          return t("catalogues.errors.unknownOutcome");
      }
      return t("catalogues.errors.failed");
    },
    [t]
  );

  const pollStatus = useCallback(async (): Promise<void> => {
    try {
      const { data } = await api.get<SeedingStatus | null>("/admin/airports/seeding-status");
      if (!mounted.current) return;
      setStatus(data);
      setStatusFailed(false);
      if (data && (data.status === "running" || data.status === "pending")) {
        timer.current = setTimeout(() => void pollStatus(), POLL_MS);
      } else if (data?.status === "failed") {
        set("airports", { s: "error", text: t("catalogues.airports.seedingFailed") });
      } else if (data?.status === "completed") {
        setPhase((p) =>
          p.airports.s === "running"
            ? { ...p, airports: { s: "done", text: t("catalogues.airports.done") } }
            : p
        );
      }
    } catch (err: unknown) {
      logger.error("CatalogueReseed: seeding status failed", err);
      if (mounted.current) setStatusFailed(true);
    }
  }, [t]);

  useEffect(() => {
    mounted.current = true;
    void pollStatus();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // Mount-only: `t` has a fresh identity per render in tests and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reseedAirports = async (): Promise<void> => {
    set("airports", { s: "running" });
    try {
      await api.post("/admin/airports/reseed");
      void pollStatus();
    } catch (err: unknown) {
      logger.error("CatalogueReseed: airport reseed failed", err);
      set("airports", { s: "error", text: failureText(err) });
    }
  };

  const reseedSync = async (kind: "airlines" | "aircraft"): Promise<void> => {
    set(kind, { s: "running" });
    try {
      const { data } = await api.post<{ inserted: number }>(
        `/admin/${kind}/reseed`,
        {},
        { timeout: API_TIMEOUTS.PARSER }
      );
      set(kind, { s: "done", text: t(`catalogues.${kind}.done`, { count: data.inserted }) });
    } catch (err: unknown) {
      logger.error(`CatalogueReseed: ${kind} reseed failed`, err);
      set(kind, { s: "error", text: failureText(err) });
    }
  };

  const row = (kind: Kind, onRun: () => void): JSX.Element => {
    const p = phase[kind];
    return (
      <div className="flex flex-col gap-1" key={kind}>
        <span className="label">{t(`catalogues.${kind}.title`)}</span>
        <p className="t-caption">{t(`catalogues.${kind}.description`)}</p>
        <button
          type="button"
          className="btn-secondary self-start"
          disabled={p.s === "running"}
          onClick={onRun}
        >
          {p.s === "running" ? t("catalogues.running") : t("catalogues.run")}
        </button>
        {p.s === "done" && (
          <p role="status" className="text-sm" style={{ color: "var(--success)" }}>
            {p.text}
          </p>
        )}
        {p.s === "error" && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {p.text}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      {row("airports", () => void reseedAirports())}
      {statusFailed ? (
        <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
          {t("catalogues.airports.statusFailed")}
        </p>
      ) : (
        status && (
          <p className="t-caption" data-testid="airport-seeding-status">
            {t(`catalogues.airports.status.${status.status}`, {
              processed: status.processedAirports ?? 0,
              total: status.totalAirports ?? 0,
            })}
          </p>
        )
      )}
      {row("airlines", () => void reseedSync("airlines"))}
      {row("aircraft", () => void reseedSync("aircraft"))}
    </div>
  );
}
