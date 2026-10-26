import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { JobLostError, jobErrorCode } from "../../lib/api/jobs";
import {
  rerouteLocalTransit,
  type LocalTransitRerouteResult,
} from "../../lib/api/railRoutingAdmin";
import { logger } from "../../lib/logger";
import Button from "../ui/Button";

type State =
  | { kind: "idle" }
  | { kind: "running"; progress: { done: number; total: number } | null }
  | { kind: "done"; result: LocalTransitRerouteResult }
  | { kind: "error"; key: string };

/**
 * The one-off repair for tram and U-Bahn rides routed as trains before they
 * had a network of their own (tester report 2026-10-25). Every outcome is
 * named — routed, dropped to the straight line, kept, or stopped because the
 * router went away — never a bare "done".
 */
export default function RailLocalTransitReroute(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = async (): Promise<void> => {
    setState({ kind: "running", progress: null });
    try {
      const result = await rerouteLocalTransit((progress) =>
        setState({ kind: "running", progress })
      );
      setState({ kind: "done", result });
    } catch (err) {
      logger.warn("Re-routing tram and U-Bahn rides failed", err);
      const key =
        err instanceof JobLostError
          ? "lost"
          : jobErrorCode(err) === "notConfigured"
            ? "notConfigured"
            : "failed";
      setState({ kind: "error", key: `settings:railRouting.reroute.${key}` });
    }
  };

  const line =
    state.kind === "running"
      ? state.progress
        ? t("settings:railRouting.reroute.progress", {
            done: state.progress.done,
            total: state.progress.total,
          })
        : t("settings:railRouting.reroute.running")
      : state.kind === "done"
        ? [
            t("settings:railRouting.reroute.done", {
              routed: state.result.routed,
              straight: state.result.straight,
              kept: state.result.kept,
              skipped: state.result.skipped,
              total: state.result.total,
            }),
            state.result.stoppedBy
              ? t("settings:railRouting.reroute.stopped", { remaining: state.result.remaining })
              : null,
          ]
            .filter(Boolean)
            .join(" ")
        : state.kind === "error"
          ? t(state.key)
          : null;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <p className="t-caption">{t("settings:railRouting.reroute.hint")}</p>
      <div>
        <Button onClick={() => void run()} disabled={state.kind === "running"}>
          {t("settings:railRouting.reroute.action")}
        </Button>
      </div>
      {line && (
        <p
          className="t-caption"
          role={state.kind === "error" ? "alert" : "status"}
          data-testid="rail-reroute-local-transit"
        >
          {line}
        </p>
      )}
    </div>
  );
}
