import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  routeShareErrorKey,
  routeShareWasRevoked,
  travTrackApi,
  type TripRouteSnapshot,
} from "../../lib/api/travtrack";
import { logger } from "../../lib/logger";
import { Button, Dialog } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
  tripId: string;
}

/** Loaded: the snapshot or null. `failed`: the state is not known, and is not guessed. */
type State =
  | { kind: "loading" }
  | { kind: "loaded"; snapshot: TripRouteSnapshot | null }
  | {
      kind: "failed";
    };

/**
 * "Route mitteilen" (TravTrack plan T7): the people this trip is shared with
 * see the line TravTrack recorded on it — geometry only, no times, nothing in
 * a privacy zone, nothing within a kilometre of home. Nothing is shared until
 * the owner asks; a refresh takes in what was recorded since; "Nicht mehr
 * mitteilen" takes it back for everyone at once. Every refusal is said in its
 * own words, and a failed read never shows as "not shared".
 */
export default function ShareRouteDialog({ open, onClose, tripId }: Props): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ kind: "loading" });
    setError(null);
    travTrackApi
      .routeSnapshot(tripId)
      .then((snapshot) => {
        if (live) setState({ kind: "loaded", snapshot });
      })
      .catch((err: unknown) => {
        logger.warn("Failed to load the shared route", err);
        if (!live) return;
        setState({ kind: "failed" });
        setError(routeShareErrorKey(err));
      });
    return () => {
      live = false;
    };
  }, [open, tripId]);

  if (!open) return null;

  const run = async (action: () => Promise<TripRouteSnapshot | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setState({ kind: "loaded", snapshot: await action() });
    } catch (err) {
      logger.warn("Sharing the route failed", err);
      // A revoke won the race: show the route as not shared, not as it was.
      if (routeShareWasRevoked(err)) setState({ kind: "loaded", snapshot: null });
      setError(routeShareErrorKey(err));
    } finally {
      setBusy(false);
    }
  };
  const share = () => run(() => travTrackApi.shareRoute(tripId));
  const revoke = () => run(async () => (await travTrackApi.revokeRoute(tripId), null));

  const snapshot = state.kind === "loaded" ? state.snapshot : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={t("sharing:route.title")}
      action={
        state.kind === "loaded" ? (
          <Button variant="primary" disabled={busy} onClick={() => void share()}>
            {t(snapshot ? "sharing:route.refresh" : "sharing:route.share")}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-caption">{t("sharing:route.intro")}</p>
        {state.kind === "loading" && <p className="t-body">{t("sharing:route.loading")}</p>}
        {state.kind === "loaded" && !snapshot && (
          <p className="t-body">{t("sharing:route.notShared")}</p>
        )}
        {snapshot && (
          <>
            <p className="t-body">{t("sharing:route.shared", { count: snapshot.pointCount })}</p>
            <div>
              <Button disabled={busy} onClick={() => void revoke()}>
                {t("sharing:route.revoke")}
              </Button>
            </div>
          </>
        )}
        {error && (
          <p className="t-body" role="alert" style={{ color: "var(--ts-bad)" }}>
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
