import { useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { locationProviderApi, locationProviderErrorKey } from "../../lib/api/locationProvider";
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
 * A failed switch says why.
 */
export default function DawarichProviderHint({ check }: { check: number }): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (check === 0) return;
    let cancelled = false;
    setDone(false);
    setError(null);
    void locationProviderApi
      .get()
      .then((state) => {
        if (!cancelled) setOffer(state.kind === "none" && state.choices.dawarich);
      })
      .catch(() => {
        if (!cancelled) setOffer(false);
      });
    return () => {
      cancelled = true;
    };
  }, [check]);

  const use = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await locationProviderApi.set("dawarich");
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
