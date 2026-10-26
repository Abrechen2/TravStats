import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { locationProviderErrorKey } from "../../lib/api/locationProvider";
import { useLocationProviderStore } from "../../store/locationProviderStore";
import { token } from "../ui/tokens";

/**
 * The offer under a freshly saved Dawarich connection (TravTrack plan S3): a
 * connection alone no longer drives the automatic Dawarich features — the
 * location provider does. When the account's provider is `none` and the new
 * connection would be accepted, ask once whether to use it.
 *
 * `check` changes after every successful save; the hint asks the server
 * again then. A failed lookup shows nothing: this is an offer, the save it
 * follows has already succeeded, and Settings → Standort shows the real state.
 * A failed switch says why. Both the lookup and the switch go through
 * `locationProviderStore`, so the "Standortquelle" section on the same page
 * shows the new choice at once.
 */
export default function DawarichProviderHint({ check }: { check: number }): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const refresh = useLocationProviderStore((s) => s.refresh);
  const choose = useLocationProviderStore((s) => s.choose);
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (check === 0) return;
    let cancelled = false;
    setDone(false);
    setError(null);
    void refresh().then((state) => {
      if (!cancelled) setOffer(state !== null && state.kind === "none" && state.choices.dawarich);
    });
    return () => {
      cancelled = true;
    };
  }, [check, refresh]);

  const use = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await choose("dawarich");
      setOffer(false);
      setDone(true);
    } catch (err) {
      setError(t(locationProviderErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="text-sm" role="status" style={{ color: token("good") }}>
        {t("settings:locationProvider.dawarichHint.done")}
      </p>
    );
  }
  if (!offer) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="dawarich-provider-hint">
      <p className="text-sm">{t("settings:locationProvider.dawarichHint.text")}</p>
      <div>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void use()}>
          {t("settings:locationProvider.dawarichHint.use")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {error}
        </p>
      )}
    </div>
  );
}
