import { useState } from "react";
import type { JSX } from "react";
import Button from "../ui/Button";
import { useBusRouting } from "../../hooks/useBusRouting";
import { useTranslation } from "../../hooks/useTranslation";
import { JobFailedError, JobLostError } from "../../lib/api/jobs";
import { busApi } from "../../lib/api/bus";
import { fallbackReasonKey } from "../../lib/bus/busRoutingWords";
import { logger } from "../../lib/logger";
import type { BusRouteAllResult } from "../../types/bus";
import { BusNoRoutingNote } from "./BusNoRoutingNote";

interface Props {
  /** Rides on this page that are still a straight line; the panel is silent without any. */
  straightRides: number;
  /** Called when a pass finished, so the list shows the new lines. */
  onDone: () => void;
}

/** Each distinct failure once, with its sentence — not one line per ride. */
function reasonSummary(result: BusRouteAllResult, say: (key: string) => string): string {
  const reasons = new Set(
    result.rides.flatMap((r) => (r.outcome === "straight" && r.fallback ? [r.fallback] : []))
  );
  return [...reasons].map((r) => say(fallbackReasonKey(r))).join(" ");
}

/**
 * "Route all straight rides" — the bulk half of B3 for the rides logged before
 * routing existed. A background job on the server (a pass makes one provider
 * call per ride); the panel shows progress, then every outcome with its
 * reason. On an instance without a routing provider it says that, once, and
 * offers no button that could only fail.
 */
export function BusRouteAllPanel({ straightRides, onDone }: Props): JSX.Element | null {
  const { t } = useTranslation(["bus"]);
  const routing = useBusRouting();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string[]>([]);

  if (straightRides === 0 && message.length === 0) return null;
  if (routing === null) return null;
  if (!routing.configured) {
    return (
      <div className="mb-4" data-testid="bus-route-all">
        <BusNoRoutingNote />
      </div>
    );
  }

  const run = async (): Promise<void> => {
    setBusy(true);
    setMessage([]);
    setProgress(null);
    try {
      const result = await busApi.routeAll(setProgress);
      const lines = [
        t("bus:routing.all.done", { routed: result.routed, straight: result.straight }),
      ];
      const reasons = reasonSummary(result, (key) => t(key));
      if (reasons) lines.push(t("bus:routing.all.reasons", { reasons }));
      if (result.stoppedBy) {
        lines.push(
          t("bus:routing.all.stopped", { reason: t(fallbackReasonKey(result.stoppedBy)) })
        );
      }
      if (result.remaining > 0) {
        lines.push(t("bus:routing.all.remaining", { count: result.remaining }));
      }
      setMessage(lines);
      onDone();
    } catch (err: unknown) {
      logger.error("BusRouteAllPanel: routing pass failed", err);
      const lost = err instanceof JobLostError;
      const refused = err instanceof JobFailedError ? err.code : null;
      setMessage([
        refused === "BUS_NO_ROUTING_PROVIDER"
          ? t("bus:routing.all.noProvider")
          : lost
            ? t("bus:routing.all.lost")
            : t("bus:routing.all.failed"),
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="mb-4 flex flex-col items-start gap-2" data-testid="bus-route-all">
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? t("bus:routing.all.busy") : t("bus:routing.all.button")}
      </Button>
      {busy && progress && (
        <p className="t-caption" role="status">
          {t("bus:routing.all.progress", { done: progress.done, total: progress.total })}
        </p>
      )}
      {message.map((line) => (
        <p key={line} className="t-caption" role="status" data-testid="bus-route-all-result">
          {line}
        </p>
      ))}
    </div>
  );
}
