import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { RailImportPreviewModal } from "../components/rail/RailImportPreviewModal";
import { useTranslation } from "../hooks/useTranslation";
import { railApi } from "../lib/api/rail";
import { logger } from "../lib/logger";
import { BAHN_HANDOFF_PATH } from "../lib/rail/bahnBookmarklet";
import {
  decodeBahnHandoff,
  stashBahnHandoff,
  takeStashedBahnHandoff,
  type HandoffFailure,
} from "../lib/rail/bahnHandoff";
import { useToastStore } from "../store/toastStore";
import type { RailImportBooking } from "../types/rail";

/** Failures after the hand-over was decoded: the server's reading, or the request to it. */
type PageFailure = HandoffFailure | "noTrain" | "requestRateLimited" | "requestFailed";

type State =
  | { kind: "reading" }
  | { kind: "review"; booking: RailImportBooking }
  | { kind: "failed"; reason: PageFailure };

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;

/** Where a failure sends the user next: bahn.de again, or setting the bookmark up. */
const SETUP_HINT: ReadonlySet<PageFailure> = new Set(["empty", "notBahn", "damaged"]);

/**
 * Where the „In TravStats übernehmen“ bookmarklet lands (forgejo#204). The
 * connection it read on bahn.de arrives in the fragment; this page takes it out
 * of the address at once (a reload or the history must not import it again),
 * has the server read it, and opens the ordinary rail review — nothing is
 * stored until the user saves there. Every failure is named as itself.
 *
 * Gated like every rail page (`railHandoffRoutes.tsx`). Signed out, the
 * hand-over waits in session storage through the login.
 */
export default function RailBahnHandoffPage(): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState<State>({ kind: "reading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const now = Date.now();
    const stashed = takeStashedBahnHandoff(now);
    const hash = window.location.hash || stashed || "";
    if (window.location.hash) navigate(BAHN_HANDOFF_PATH, { replace: true });
    const decoded = decodeBahnHandoff(hash);
    if (decoded.kind === "failed") {
      setState({ kind: "failed", reason: decoded.reason });
      return;
    }
    // Kept until the server has answered: a session that expired on the way
    // sends the user to the login, and the hand-over must survive that.
    stashBahnHandoff(hash, now);
    railApi
      .readBahnHandoff(decoded.answer)
      .then((outcome) => {
        takeStashedBahnHandoff(now);
        if (outcome.outcome === "read") setState({ kind: "review", booking: outcome.booking });
        else {
          setState({
            kind: "failed",
            reason: outcome.reason === "noTrain" ? "noTrain" : "unreadable",
          });
        }
      })
      .catch((err: unknown) => {
        const status = statusOf(err);
        if (status !== 401) takeStashedBahnHandoff(now);
        logger.error("RailBahnHandoffPage: the hand-over could not be read", err);
        setState({
          kind: "failed",
          reason: status === 429 ? "requestRateLimited" : "requestFailed",
        });
      });
  }, [navigate]);

  return (
    <AppShell width="reading">
      <Link to="/rail" className="ts-back-link text-sm text-(--text-muted)">
        ← {t("rail:title")}
      </Link>
      <h1 className="t-screen-title mt-2">{t("rail:bahnHandoff.title")}</h1>
      {state.kind === "reading" && (
        <p className="mt-3 text-(--text-muted)" role="status">
          {t("rail:bahnHandoff.reading")}
        </p>
      )}
      {state.kind === "review" && (
        <>
          <p className="mt-3 text-sm">{t("rail:bahnHandoff.review")}</p>
          <RailImportPreviewModal
            booking={state.booking}
            onCancel={() => navigate("/rail")}
            onSaved={(count) => {
              addToast("success", t("rail:import.saved", { count }));
              navigate("/rail");
            }}
          />
        </>
      )}
      {state.kind === "failed" && (
        <div className="mt-4 flex flex-col gap-3" data-testid="rail-bahn-handoff-failed">
          <div
            role="alert"
            className="rounded-md border border-(--warning)/50 bg-(--warning)/10 p-4 text-sm"
          >
            {t(`rail:bahnHandoff.reason.${state.reason}`)}
          </div>
          <p className="text-sm">{t("rail:bahnHandoff.otherWays")}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link to="/rail" className="underline">
              {t("rail:bahnHandoff.toRail")}
            </Link>
            {SETUP_HINT.has(state.reason) && (
              <Link to="/settings/data?section=import" className="underline">
                {t("rail:bahnHandoff.toSetup")}
              </Link>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
